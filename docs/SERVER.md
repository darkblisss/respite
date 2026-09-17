# Respite v5 game server

The server is one Supabase Edge Function, `game`. It owns every save: the browser predicts with the same rules (`src/shared`) but only the function writes `public.saves`, the market, the post (mail), profiles and hunt presence.

| File | What it is |
| --- | --- |
| `src/server/handler.js` | The request handler. Runtime-agnostic: no Deno or Node APIs, database and user lookup passed in. |
| `src/server/db.js` | Adapters giving `db.transaction(async (q) => ...)` to postgres.js (production) and PGlite (tests). |
| `supabase/functions/game/index.ts` | The Deno wrapper: CORS, token check against Supabase Auth, one Postgres connection per isolate. |
| `supabase/config.toml` | `[functions.game]` with `verify_jwt = false`. |
| `supabase/migrations/002_server.sql` | Two market indexes. Required. |
| `supabase/migrations/003_profiles_from_saves.sql` | A profile for every v4 save, so nobody can sign up under a v4 player's name. Required, before the v5 client goes live. |
| `.github/workflows/deploy-game.yml` | Deploys on pushes to `main` that touch the rules, the server or the function. |
| `tests/server/run.mjs` | Integration tests: the real rules against PGlite, optionally through postgres.js. |
| `package.json` | Dev dependencies and scripts for the local tests. Never deployed. |
| `deno.jsonc` | Keeps Deno off the `node_modules` that `npm install` makes, so the function type-checks the way Supabase bundles it. Never deployed. |

## 1. Protocol

`POST {SUPABASE_URL}/functions/v1/game`, headers `Authorization: Bearer <access token>`, `apikey: <anon key>`, `Content-Type: application/json`.

```js
{ v: ENGINE_VERSION, commands: [{ id: "c1", type: "startSkill", args: { skillId, actionId, limit }, at: 1789600000000 }] }
```

- `commands` is required (send `[]` to sync) and holds at most 25.
- Each command: `id` string (40 chars max, echoed back), `type` string (40 max), `args` object or absent, `at` a finite number: the browser's `Date.now()` when the player acted.
- The body is at most 64,000 characters. Any key named `__proto__` is refused.

Replies (always JSON, `cache-control: no-store`, CORS open):

| Status | Body | Client should |
| --- | --- | --- |
| 200 | `{ ok: true, v, now, state, results: [{ id, ok, error?, data? }], events: [{ type, ... }] }` | Replace its save with `state`, then replay any commands it sent after this request. |
| 400 | `{ ok: false, error: "bad_request" }` | Fix the request. Not retryable. (Also 405 for a method other than POST.) |
| 401 | `{ ok: false, error: "unauthorized" }` | Refresh the session and retry once; then sign out. |
| 409 | `{ ok: false, error: "outdated", v }` | Reload: the server runs rules version `v`. Checked before everything else. |
| 500 | `{ ok: false, error: "server_error" }` | Back off and retry with the same commands. Details are only in the function logs. |

`results` has one entry per command, in order. A refused command never stops the others. `now` is the server's clock for this request; after a complete request `state.clock === now`.

`events` is news the browser could not have predicted, in the order it happened, each the rules' event payload with its `type` and `at` and never the save: `mail:claimed { gold, items, count }`, `mail:unknown { count }` (letters holding something the camp no longer knows, claimed empty) and `away { ms, gains, gold }`. The camp log in `state.log` already has their lines.

### Command times

Each command runs at `clamp(at, max(state.clock, now - 10 s), now)`: never in the future, never more than 10 seconds before the request, never before the save's clock. Queued commands therefore land at the moment the server receives them if the client held them longer than 10 s, and a browser with a wrong clock cannot move time for itself.

### Commands only the server runs

| Type | Args | `data` on success |
| --- | --- | --- |
| `marketList` | `{ key, from, qty, price }` (price is gold each) | `{ listingId }` |
| `marketBuy` | `{ listingId, qty }` (listingId a number, as PostgREST returns it) | `{ listingId, key, qty, cost }`; `key` is what the buyer now holds (unique items get a new uid `m<listingId>`) |
| `marketCancel` | `{ listingId }` | `{ listingId, key, qty }` |
| `resetCamp` | `{}`, and nothing else in the request | none |

Every other type goes to the rules' `applyCommand`. Refusal messages the server adds (the rules add their own, such as "Not enough gold.", "Nowhere to put it.", "You can list 1 to 12.", "Repair it before you list it."):

- `That listing is gone.` Not found, not open, expired, someone else's (on cancel), or a junk id.
- `You can't buy your own listing.`
- `Only N left.`
- `Choose how many to buy.` qty is not a whole number of at least 1.
- `You already have 20 listings open.`
- `Slow down. The market takes 60 listings an hour.` Counts every listing the seller made in the last hour, cancelled or not.
- `No room to take it back.` (from the rules) The listing stays open.
- `Start over on its own.` `resetCamp` sent with any other command. The other commands still run; send `resetCamp` alone.
- `The camp is still catching up.` See section 7; send the command again.
- `server_error` as a command result: the rules threw on that command. It was undone and logged; the rest of the request went on.

### Starting over

`resetCamp` must be the only command in its request. It replaces the save with a fresh camp under the same name, logs "You start over from a ruin.", cancels the player's open listings (their goods are lost) and removes their hunt presence.

The dice do not start over. The new camp keeps the old one's `rng` (seed and every stream), `rolls` counters and `serial`, so starting over (which is free) can never be used to reroll what a camp will find, hire or fight.

Letters in the post are left alone: a request that is only `resetCamp` does not claim mail, so it arrives in the new camp on the next request. The UI should demand the typed confirmation first; the server does not ask twice.

## 2. One request, one transaction

1. Lock the caller's `saves` row (`for update`), or create it with a fresh camp seeded from `crypto.getRandomValues`. The account name is, best first: the name on the player's profile (it never changes), the `username` on their own `saves` row, their email's local part when it matches `^[a-z0-9_]{3,20}$`, then `p_` and the first 8 hex digits of the user id (18 if even that is taken). A name another player's profile holds is skipped.
2. `migrateSave`. A row whose `engine` is null was written by a v4 browser, which could put anything in it, so it takes the rules' legacy path whatever `schema` it claims: clock, dice, counters and serial come from the server, a clock ahead of now is pulled back, and gold and stacks are clamped (section 4). Data over 2 MB (`octet_length(data::text)`) is never sent to the function; like data that is not an object at all, it is treated as unreadable, the player gets a fresh camp with the log line "Your old save could not be read.", and the function logs whose save it was.
3. Expire up to 50 listings anyone left open past `expires_at` (`for update skip locked`) and post each seller the unsold goods: "Your listing of 12 Slag Ore expired."
4. Claim the caller's unclaimed mail (up to 100 letters, oldest first) with the rules' `applyMail`, and mark exactly the claimed letters. Gold always arrives; an item letter with no room waits, and so do the item letters after it; a letter the camp can't take at all is claimed empty. Skipped when the request is only `resetCamp`.
5. For each command: advance the save to its time, run it, record the result.
6. Advance to now.
7. If more than 10 minutes passed, log the rules' welcome-back line ("Away 2h 0m: 600 Slag Ore, 42g.") from what the catch-up alone brought in.
8. Write the save (`rev + 1`, `engine`, `clock`, `username`).
9. Upsert the profile: `total_level`, `levels`, `skills` (xp to 2 decimals), and `last_seen` on the function's clock.
10. Hunt presence, from the rules' `huntPresence(state)`: while hunting, `{ tier, zone, started_at, ends_by, ended_at: null }`, where `ends_by` is `started_at + 12 h` (less any hunt time a migrated v4 hunt carried in), rewritten only when it changes; once the hunt stops, `ended_at` is when it stopped (the event's time, or the moment of the command that stopped it, or the request time).

The party bonus reads the other members' presence rows as intervals from `started_at` to the earliest of `ended_at ?? ends_by` and `last_seen + 3 minutes`; a member counts at a moment when their interval covers it on the same tier and zone. `last_seen` moves with every game request and every heartbeat, so a member counts while their tab is open. A hunt keeps running for twelve hours with nobody watching, but an alt that sets out and goes quiet stops lending its bonus three minutes later. The browser applies the same rule to `party_state()`'s `last_seen`.

Market maths: `cost = price_each * qty` (from the listing, never the buyer), `fee = max(1, floor(cost * 5%))`, the seller is posted `cost - fee` gold with a note naming the buyer, quantity and item, and `market_sales` gets a row. A 1 gold sale posts a letter worth 0. A seller may have 20 listings open and may make 60 an hour; `created_at` and `expires_at` are on the function's clock.

Locks, in the order taken: the caller's save row (whole request), expired listings (skip locked, so never waited on), the caller's mail rows, a listing being bought or cancelled (from that command to commit), then the caller's profile and presence rows at the very end. Party RPCs lock profile rows too, which is why the profile is written last. A deadlock or serialization failure is retried once.

## 3. Setting up the database

In the Supabase dashboard, SQL Editor, in this order. Each is safe to run again.

1. `supabase/schema.sql`.
2. `supabase/migrations/002_server.sql`. Required: without its indexes every request's expiry sweep reads every listing ever made (13 ms per request at 40,000 listings on PGlite, against 1.5 ms), and every listing reads all of the seller's past listings.
3. `supabase/migrations/003_profiles_from_saves.sql`. Required, and before the v5 client goes live: it gives every v4 save a profile under its name, so a stranger signing up as `name@anywhere` cannot take it first. Where two rows claim one name (a v4 browser could rewrite its own row), the account whose email carries the name wins. These bare profiles show total level 0 until their player's first request fills them in.
4. The legacy audit in section 4, before announcing the market.

## 4. Legacy saves: audit before announcing the market

Until a v4 player's first request, their row still holds whatever their browser last wrote, and v4 browsers could write anything. The rules hold such rows to legacy limits on first load: gold is clamped to 5,000,000, any stack to 250,000, unique pieces whose uid is not a v4 number are dropped, a unique piece is held once, and pools are cut to their slot counts. When anything was set right the camp log says "Your old camp's ledger didn't add up. N entries were set right." Clamping stops the worst of it reaching the market, but a forged save under the limits still arrives, so look before opening trade:

```sql
-- Legacy saves: rows a v4 browser wrote that the game function has not loaded yet (engine is
-- null). Read-only. Richest first; every number is read defensively, because these rows can hold
-- anything.
with legacy as (
  select s.user_id, s.username, s.data, octet_length(s.data::text) as bytes
  from public.saves s
  where s.engine is null
),
held as (
  -- Every stack in Belongings, the Stockpile and the Vault, and every worn piece.
  select l.user_id, i.key,
         case when jsonb_typeof(i.value) = 'number' then (i.value #>> '{}')::numeric end as qty
  from legacy l
  cross join lateral (values ('inv'), ('bank'), ('vault')) as p(pool)
  cross join lateral jsonb_each(
    case when jsonb_typeof(l.data -> p.pool -> 'items') = 'object' then l.data -> p.pool -> 'items' else '{}'::jsonb end
  ) as i
  union all
  select l.user_id, e.value #>> '{}', 1
  from legacy l
  cross join lateral jsonb_each(
    case when jsonb_typeof(l.data -> 'equipment') = 'object' then l.data -> 'equipment' else '{}'::jsonb end
  ) as e
  where jsonb_typeof(e.value) = 'string'
),
per_save as (
  select h.user_id,
         max(h.qty) as largest_stack,
         (array_agg(h.key order by h.qty desc nulls last))[1] as largest_stack_key,
         coalesce(sum(h.qty) filter (where h.key like '%|relic|%'), 0) as relics
  from held h
  group by h.user_id
),
duplicates as (
  -- A unique piece (a key with a uid: base|rarity|uid...) held more than once in one save.
  select d.user_id, count(*) as duplicate_unique_keys, string_agg(d.key, ', ' order by d.key) as which
  from (
    select h.user_id, h.key
    from held h
    where h.key like '%|%|%'
    group by h.user_id, h.key
    having count(*) > 1 or coalesce(sum(h.qty), 0) > 1
  ) d
  group by d.user_id
)
select l.user_id,
       l.username,
       case when jsonb_typeof(l.data -> 'player' -> 'gold') = 'number' then (l.data -> 'player' ->> 'gold')::numeric end as gold,
       ps.largest_stack,
       ps.largest_stack_key,
       coalesce(ps.relics, 0) as relics,
       coalesce(d.duplicate_unique_keys, 0) as duplicate_unique_keys,
       d.which as duplicated,
       l.bytes
from legacy l
left join per_save ps on ps.user_id = l.user_id
left join duplicates d on d.user_id = l.user_id
order by gold desc nulls last, ps.largest_stack desc nulls last, l.bytes desc nulls last
limit 200;
```

What to look for: gold or stacks far beyond anything honest play reaches, many relics, any duplicated unique piece, and very large rows (over 2 MB they will not be read at all). A suspect row can be fixed or replaced by hand before its player returns; once the function has loaded it, `engine` is set and it leaves this report.

## 5. Environment

The function needs nothing configured by hand. Supabase gives every function:

| Variable | Used for |
| --- | --- |
| `SUPABASE_URL` | `GET /auth/v1/user` to learn who holds the token. |
| `SUPABASE_ANON_KEY` | The `apikey` header on that call. |
| `SUPABASE_DB_URL` | The Postgres connection. It connects as `postgres`, the owner of the tables, so RLS does not apply to it. |

The connection is `postgres(SUPABASE_DB_URL, { prepare: false, max: 1, idle_timeout: 20 })`, made once per isolate. `prepare: false` keeps it safe behind the transaction pooler.

## 6. Deploying

Deploy from the repo root. The function imports `../../../src/server/handler.js`, which imports `src/shared`. With `--use-api` the CLI bundles on Supabase's side, follows those relative imports out of the `supabase` folder and uploads `src/server/*.js` and `src/shared/*.js` with their paths; Supabase fetches `npm:postgres@3.4.5` itself. No Docker is needed, and nothing is installed: `package.json`, `node_modules` and `deno.jsonc` stay on your machine, and the upload is the same with or without `npm install` (checked against CLI 2.117.0: the entrypoint and the `src` modules it imports, no import map).

One-off, from a terminal:

```sh
npx supabase login
npx supabase functions deploy game --project-ref <project-ref> --use-api
```

`<project-ref>` is the id in the dashboard URL (`https://supabase.com/dashboard/project/<project-ref>`). The deploy reads `supabase/config.toml`, which turns the gateway's JWT check off: the function checks tokens itself, and CORS preflights carry none.

Automatic, with GitHub Actions: add two repository secrets (Settings, Secrets and variables, Actions):

- `SUPABASE_ACCESS_TOKEN`: a personal access token from https://supabase.com/dashboard/account/tokens
- `SUPABASE_PROJECT_REF`: the project ref above

Every push to `main` that touches `src/shared/**`, `src/server/**`, `supabase/functions/**` or `supabase/config.toml` deploys. The workflow can also be run by hand (Actions, Deploy game function, Run workflow).

Deploy the function and the browser together when `ENGINE_VERSION` changes: old browsers get 409 and must reload. The SQL files are not deployed by the workflow; run new ones by hand (section 3).

## 7. Operations

**CPU.** The free plan allows 2 s of CPU per request (waiting on the database does not count). Everything but the catch-up is small: a request with no time to make up costs a few milliseconds of rules and JSON. Catch-up cost grows with what happened while the player was away, not with how long: tasks stop at twelve hours, and an idle camp costs almost nothing however long it sat. The worst case measured, a level 80 Warrior hunting tier 9 Core while the Forgemaster works, twelve hours in one request (1,767 kills, 67 Sovereigns felled, 600 crafts) took about 300 ms in Node, database work included. A hostile legacy row migrates in linear time (about 100 ms for 40,000 keys, first load only), and rows over 2 MB are never read.

**Catch-up budget.** As a safety net the handler plays a long absence in 15-minute slices (the rules give identical results however time is cut; the tests check the saves match) and stops once a request has spent 1 s in the rules. It then saves what it has, answers 200 with `state.clock < now`, and gives every command `The camp is still catching up.` The client should send the next request straight away, with those commands again, until `state.clock === now`. On a warm isolate this should never trigger; it keeps a cold start on a slow machine from failing the same request forever.

**Request rate.** Every request is one function invocation and one database transaction, and returns the whole save (about 1 KB of JSON for a new camp, 11 KB for the late-game camp above). The browser predicts between requests, so the server only needs to hear what the player did:

- Sync once on load, and when the tab becomes visible again.
- Queue commands and flush them after about 1 s without a new one, or at once for market actions. Send `resetCamp` in a request of its own. At most 25 commands per request.
- While the tab is visible and idle, sync every few minutes, and heartbeat once a minute (party chat, invites and roster changes come through Realtime, not this function; a party member counts toward the bonus only while `last_seen` is under 3 minutes old).
- Never overlap requests for one player: they queue on the save row anyway. Wait for the reply.
- On 500 or a network error, back off (2 s, 4 s, 8 s, up to 60 s) and keep the queue.

Invocations are metered per plan (check Supabase's pricing page). As a guide, a player online two hours a day syncing every few minutes plus their actions is a few thousand invocations a month.

**Logs.** Failed requests, commands that threw and unreadable saves are logged with `console.error` ("game: request failed", "game: command X threw", "game: the save for <user id> could not be read") in the dashboard's function logs. Clients never see details.

**Housekeeping.** Listings expire on other players' requests, 50 at a time, so while anyone plays a due listing goes home within seconds. Nothing needs a cron.

## 8. Tests

From the repo root, with Node 22:

```sh
npm install
npm test               # the engine, SQL, server and client store suites
npm run test:server    # this function's suite alone (node tests/server/run.mjs)
npm run test:sql       # the schema and RPC suite alone (node tests/sql/run.mjs)
```

`npm install` brings PGlite, postgres.js, Deno and Playwright for the suites. Without it, the SQL and server suites take PGlite from `PGLITE_PATH` (an `@electric-sql/pglite` package folder).

The server suite loads `tests/sql/stubs.sql`, `supabase/schema.sql` and the migrations into PGlite, runs the real handler and rules against it with a fake `getUser` and a hand-moved clock, and prints PASS or FAIL per check. The SQL suite covers the schema, RLS and the party RPCs, including an accept that loses a race to another accept.

The server suite through the production driver, postgres.js over PGlite's wire protocol. `postgres@3.4.5` comes with `npm install`; the wire server does not, so add it without saving it (or set `PG_WIRE_MODULES` to a `node_modules` folder holding both packages):

```sh
npm install --no-save @electric-sql/pglite-socket
SERVER_TEST_DRIVER=postgres npm run test:server
```

This mode matters: postgres.js JSON-encodes values bound to jsonb parameters, so SQL in the handler passes jsonb as `$1::text::jsonb`. Written as `$1::jsonb`, PGlite passes and production stores every save as a string.

Type-check the wrapper from the repo root:

```sh
npx deno check supabase/functions/game/index.ts
```

`deno.jsonc` sets `nodeModulesDir` to `none`, so Deno fetches `npm:postgres@3.4.5` into its own cache the way Supabase does, with or without `npm install`. Without that file, a `package.json` in the repo makes Deno look for postgres in `node_modules` only.
