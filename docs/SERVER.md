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
| `supabase/migrations/006_party_hunts.sql` | The party hunt table, the RPC a watcher reads it through, and the cron that ticks it. Required for party hunts, and the only thing here that costs money at rest (section 3). |
| `supabase/migrations/007_market_pools.sql` | The anonymous market: the tables answer about your own rows only, three functions answer everything a market page draws, and material listings are aggregated into pools. Required, and it goes out with the function and the browser bundle. |
| `supabase/migrations/010_market_bases.sql` | The shelf: gear and tools grouped by base, with a rarity floor, so a market with forty swords on it does not read as forty rows of the same word. Required with the browser bundle that draws it; the game function does not read it. |
| `supabase/migrations/018_ground_hunters.sql` | `ground_hunters(tier)` -> jsonb `{ counts, hunters }`: how many are out on each of one region's zones, and the 32 seen most recently by name (face, discipline, zone, since when), read off `hunt_presence` for the Hunt page's map. Optional: without it the map shows a player and their party alone. The game function does not read it. |
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
| 200 | `{ ok: true, v, now, state, results: [{ id, ok, error?, data? }], events: [{ type, ... }], party? }` | Replace its save with `state`, then replay any commands it sent after this request. |
| 400 | `{ ok: false, error: "bad_request" }` | Fix the request. Not retryable. (Also 405 for a method other than POST.) |
| 401 | `{ ok: false, error: "unauthorized" }` | Refresh the session and retry once; then sign out. |
| 409 | `{ ok: false, error: "outdated", v }` | Reload: the server runs rules version `v`. Checked before everything else. |
| 500 | `{ ok: false, error: "server_error" }` | Back off and retry with the same commands. Details are only in the function logs. |

`results` has one entry per command, in order. A refused command never stops the others. `now` is the server's clock for this request; after a complete request `state.clock === now`.

`events` is news the browser could not have predicted, in the order it happened, each the rules' event payload with its `type` and `at` and never the save: `mail:claimed { gold, items, count }`, `mail:unknown { count }` (letters holding something the camp no longer knows, claimed empty), `away { ms, gains, gold }` and `party:spoils { tier, zone, kills, xp, gold, drops, remedies, died }` (a share of a party hunt, section 3). The camp log in `state.log` already has their lines, except `party:spoils`, which has none: the share arrives inside the save, and what is worth a line (a fall, a find, loot with nowhere to go) is logged by the events the settlement raises as the rules do.

`party` is only there while the caller is out with their party: `sessionView()` of the fight, the same shape `party_hunt_view()` returns (section 3). It carries no seed, no dice and no stat lines.

### Command times

Each command runs at `clamp(at, max(state.clock, now - 10 s), now)`: never in the future, never more than 10 seconds before the request, never before the save's clock. Queued commands therefore land at the moment the server receives them if the client held them longer than 10 s, and a browser with a wrong clock cannot move time for itself.

### Commands only the server runs

| Type | Args | `data` on success |
| --- | --- | --- |
| `marketList` | `{ key, from, qty, price }` (price is gold each) | `{ listingId }` |
| `marketBuy` | `{ listingId, qty }` (listingId a number, as PostgREST returns it). Gear and tools only | `{ listingId, key, qty, cost, fee }`; `cost` is what left the purse, fee included; `key` is what the buyer now holds (unique items get a new uid `m<listingId>`) |
| `marketBuyPool` | `{ key, qty, maxEach }`: a material, how many, and the most it will pay each | `{ key, qty, cost, fee, asked, short }`; `qty` is how many were actually had, `asked` how many were wanted, `short` whether the fill ran out at that price |
| `marketCancel` | `{ listingId }` | `{ listingId, key, qty }` |
| `partyHuntStart` | `{ tier, zone }` | `{ tier, zone }` |
| `partyHuntJoin` | `{}` | `{ tier, zone }` |
| `partyHuntLeave` | `{}` | `{ tier, zone, kills }` (what the parting share was worth) |
| `resetCamp` | `{}`, and nothing else in the request | none |

Every other type goes to the rules' `applyCommand`. Refusal messages the server adds (the rules add their own, such as "Not enough gold.", "Nowhere to put it.", "You can list 1 to 12.", "Repair it before you list it."):

- `That listing is gone.` Not found, not open, expired, someone else's (on cancel), or a junk id.
- `You can't buy your own listing.`
- `Only N left.`
- `Choose how many to buy.` qty is not a whole number of at least 1.
- `Buy materials from the pool.` `marketBuy` on a material listing. A material's id buys nothing: it is the one thing that could pick a seller out of the pool.
- `That is sold piece by piece.` `marketBuyPool` on anything that is not a material.
- `Name the most you will pay each.` `marketBuyPool` without a whole-number ceiling of 1 to `marketMaxPrice`.
- `Nobody is selling that at your price.` The pool holds nothing at or under the ceiling (the buyer's own listings never count).
- `That is too many to buy at once.` A pool quantity past a Postgres int.
- `You already have 20 listings open.`
- `Slow down. The market takes 60 listings an hour.` Counts every listing the seller made in the last hour, cancelled or not.
- `No room to take it back.` (from the rules) The listing stays open.
- `Start over on its own.` `resetCamp` sent with any other command. The other commands still run; send `resetCamp` alone.
- `You are not in a party.`, `Your party is already out.`, `Your party isn't out.`, `The party is full.`, `You're out with your party.` (already in the fight, or `startHunt` while in it), `Pull back before you set out with your party.`, `You're still recovering.`, `That ground isn't open.`, `No such zone.`, `Your party's fight is still catching up.` (send it again). Section 3.
- `The camp is still catching up.` See section 8; send the command again.
- `server_error` as a command result: the rules threw on that command. It was undone and logged; the rest of the request went on.

### Starting over

`resetCamp` must be the only command in its request. It replaces the save with a fresh camp under the same name, logs "You start over from a ruin.", cancels the player's open listings (their goods are lost) and removes their hunt presence.

The dice do not start over. The new camp keeps the old one's `rng` (seed and every stream), `rolls` counters and `serial`, so starting over (which is free) can never be used to reroll what a camp will find, hire or fight.

Letters in the post are left alone: a request that is only `resetCamp` does not claim mail, so it arrives in the new camp on the next request. The UI should demand the typed confirmation first; the server does not ask twice.

## 2. One request, one transaction

1. Lock the caller's `saves` row (`for update`), or create it with a fresh camp seeded from `crypto.getRandomValues`. The account name is, best first: the name on the player's profile (it never changes), the `username` on their own `saves` row, their email's local part when it matches `^[a-z0-9_]{3,20}$`, then `p_` and the first 8 hex digits of the user id (18 if even that is taken). A name another player's profile holds is skipped.
2. `migrateSave`. A row whose `engine` is null was written by a v4 browser, which could put anything in it, so it takes the rules' legacy path whatever `schema` it claims: clock, dice, counters and serial come from the server, a clock ahead of now is pulled back, and gold and stacks are clamped (section 5). Data over 2 MB (`octet_length(data::text)`) is never sent to the function; like data that is not an object at all, it is treated as unreadable, the player gets a fresh camp with the log line "Your old save could not be read.", and the function logs whose save it was.
3. Expire up to 50 listings anyone left open past `expires_at` (`for update skip locked`) and post each seller the unsold goods: "Your listing of 12 Slag Ore expired."
4. Claim the caller's unclaimed mail (up to 100 letters, oldest first) with the rules' `applyMail`, and mark exactly the claimed letters. Gold always arrives; an item letter with no room waits, and so do the item letters after it; a letter the camp can't take at all is claimed empty. Skipped when the request is only `resetCamp`.
5. Lock the party hunt rows this player is owed something out of (`for update`, at most 8, oldest first), before any command runs. Section 3.
6. For each command: advance the save to its time, run it, record the result.
7. Advance to now.
8. Play each of those party sessions up to the save's clock and take this member's share out of it (section 3).
9. If more than 10 minutes passed, log the rules' welcome-back line ("Away 2h 0m: 600 Slag Ore, 42g.") from what the catch-up alone brought in.
10. Write the save (`rev + 1`, `engine`, `clock`, `username`).
11. Upsert the profile: `total_level`, `levels`, `skills` (xp to 2 decimals), and `last_seen` on the function's clock.
12. Hunt presence, from the rules' `huntPresence(state)` or, while out with the party, from the party's session: while hunting, `{ tier, zone, started_at, ends_by, ended_at: null }`, where `ends_by` is `started_at + 12 h` (less any hunt time a migrated v4 hunt carried in), rewritten only when it changes; once the hunt stops, `ended_at` is when it stopped (the event's time, or the moment of the command that stopped it, or the request time).
13. Write the party hunt rows back, and delete any that are closed and owe nobody anything.

The party bonus reads the other members' presence rows as intervals from `started_at` to the earliest of `ended_at ?? ends_by` and `last_seen + 3 minutes`; a member counts at a moment when their interval covers it on the same tier and zone. `last_seen` moves with every game request and every heartbeat, so a member counts while their tab is open. A hunt keeps running for twelve hours with nobody watching, but an alt that sets out and goes quiet stops lending its bonus three minutes later. The browser applies the same rule to `party_state()`'s `last_seen`.

### Market maths

The price is always the listing's, never the buyer's. `goods = price_each * qty`, and `fee = marketFee(goods) = max(1, ceil(goods * 5%))` (`src/shared/market.js`).

**Both legs.** The buyer pays `goods + fee` and the seller is posted `goods - fee`, so a trade of 1,000 gold costs the two of them 100 between them. The fee is rounded **up**, and never under 1 gold of a sale worth gold at all: a fee rounded down is the house paying the difference, and a round trip that costs nothing is what wash trading is made of. A 1 gold sale still posts a letter worth 0. The seller's letter says what sold and what the market kept, and never who bought it.

**Gear and tools** are bought one listing at a time, by id, as they always were.

**Materials** are a pool. `marketBuyPool { key, qty, maxEach }` locks every open listing of that key priced at or under `maxEach` that is not the buyer's own, ordered `price_each, created_at, id` (cheapest first, oldest first among equal prices: classic price-time priority), at most 25 of them, `for update` and never `skip locked`, because skipping a locked row would let a racing buyer jump the queue. `fillPool` in `src/shared/market.js` then walks them in that same order and says how many come from each listing; the browser previews the identical walk over the price bands it was shown, so the price on screen is the price charged. Each seller's listing loses its share of `qty_left`, gets a `market_sales` row and is posted its own leg (`goods_i - marketFee(goods_i)`); the buyer's leg is charged once on the whole basket and shared over the rows by `splitFee`, so `market_sales.buyer_fee` adds up to exactly what left the purse.

A partial fill is ordinary: the result says `qty` (what was had), `asked` and `short`. `maxEach` is what makes that safe. Without it, a buyer who presses while somebody else drains the cheapest band would pay whatever is left in the book; with it, the fill stops at the price they were shown and reports short.

**The race.** Both buyers lock in the same order, so they queue rather than deadlock, and the second one's `select ... for update` hands back the rows at their new versions, so it fills from what is actually left and never from what its browser saw. Nothing is written until the gold and the room for the goods are both settled, and the whole fill is in the same transaction as the save: a buyer never pays for goods they did not receive, and never receives goods they did not pay for.

**Anonymity.** Nothing identifying leaves the server to a third party, for pools or for gear. The server still records both sides in `market_sales` (moderation needs it, and a traders board will need distinct counterparties) and `market_listings.seller_name` is still written, but migration 007 narrows both tables to the caller's own rows and adds the three functions a market page reads: `market_browse` (gear and tools, with a `mine` flag and no other name), `market_pools` (aggregated materials with price bands) and `market_sales_mine` (your side of your own trades). Migration 010 adds two more with the same discretion: `market_bases` (gear and tools grouped by base, one row a shelf, with a rarity floor) and `market_base_listings` (the pieces on one shelf). A seller may have 20 listings open and may make 60 an hour; `created_at` and `expires_at` are on the function's clock.

Locks, in the order taken: the caller's save row (whole request), expired listings (skip locked, so never waited on), the caller's mail rows, their party hunt rows, the listings a command buys or cancels (from that command to commit), then the caller's profile and presence rows at the very end. **Where a statement takes more than one listing, it takes them in `price_each, created_at, id` order**: that is the pool's fill order, and `resetCamp`'s mass cancel follows it so the two agree on the order of any two rows and cannot hold half of each other's work. Nothing else locks more than one listing, and the expiry sweep waits for none of them. Party RPCs lock profile rows too, which is why the profile is written last, and the game function never locks a `parties` row for the same reason. Party hunt rows are taken before any command so two members of one party can never hold half of each other's work. A deadlock or serialization failure is retried once.

## 3. Party hunts

A party's fight is nobody's save. Two members are at different clocks, hold dice that cannot be synchronised and cannot see each other's stat lines, so neither of them can replay the same encounter and agree on it. So a party hunt is a thing of its own: one row a session in `public.party_hunts`, played by the server with `src/shared/partyHunt.js`, and each member paid out of it on their own next request, the way the post is delivered. The browser never predicts one; it draws what the server reports.

Run `supabase/migrations/006_party_hunts.sql` and deploy the function together: neither half does anything alone. The migration's header says what the operator has to set, and it is the first thing here that costs money while nobody is playing.

### The row

One row a session, not one a party, so a party can set out again the moment the last fight closed while a member who was away still has a closed row to settle out of. A partial unique index keeps at most one live session a party. `session` is the blob (the seed, the dice position, every hunter's stat line and what each is owed), `view` is `sessionView()` of it, `clock` and `started_at` are world milliseconds like `saves.clock`, `next_due` is when the session's next event falls, and `members` is the user ids it still owes something to.

`members` is what a settlement looks a session up by, not `party_members`: a member who leaves the party or is kicked mid-hunt still comes back for their share. If the whole party disbands, the row goes with the `parties` row it references and any unsettled share goes with it.

### What a client may see

Never the row. It carries the encounter's seed and the dice position, and a client holding those can play `partyHunt.js` forward itself and know every blow, every drop and every fall before they land. Three things in the way: no grant on the table for `anon` or `authenticated`, RLS on with no policy at all, and one way in, `party_hunt_view()`, which selects the single `view` column. That column is written by the engine's own `sessionView()`, never assembled from the blob in SQL, so what a watcher sees is decided in one tested place (`tests/engine/party.test.mjs` checks the view carries no seed, no dice and no stat lines). The same value rides back on a member's own request as `party`.

### Setting out, joining, leaving

`partyHuntStart { tier, zone }` needs a party, no live session, no hunt of the caller's own, no recovery to sit out, ground their save has unlocked and a real zone. `partyHuntJoin {}` needs a live session with room (four at most). Both count the rest the hunter has had at camp exactly as a lone hunt setting out does, take the remedies in their Satchel as the list the fight drinks from, and use up the camp's note; the walk the note owed is dropped, because the party keeps its own rhythm. A hunter joins on the walk, never in the middle of an encounter: the roster of foes was drawn for the party that walked into it.

**A member already out on their own hunt is refused** (`Pull back before you set out with your party.`), and `startHunt` while out with the party is refused too (`You're out with your party.`). Ending their solo hunt for them was the alternative: it would throw away a live fight, its limit and the record it was earning, and it is the one thing on screen the browser is predicting, so the player would watch a hunt they never stopped disappear. A refusal costs one tap and says why.

`partyHuntLeave {}` plays the fight up to that moment, pays the share, and takes the hunter out of it. `resetCamp` does the same without the share: a camp that starts over leaves what it was owed behind.

### What a share is worth

`owedFor()` gives a member `{ xp, gold, kills, threat, drops, died, remedies }`, and the settlement spends it through the same functions a lone kill is paid through, so a shared kill is worth what a lone one is:

- XP: `owed.xp * xpMult(state, "warfare", at) * partyMult(...)` through `addXp`, so the weather, the companion, a bounty buff and the party's own 5% a member all still apply.
- Gold: `tx.gold(round(owed.gold * (1 + companion gold bonus)), true)`.
- Threat: added to the region-wide counter, capped as ever.
- Per kill: `stats.kills`, a companion find on the `k:<tier>` counter, and a kill's wear on the weapon and one armour piece.
- The kills whose spoils they won (the engine gives a drop to whoever hurt the foe most, ties to the killing blow) also roll that foe's drops on the `m:<id>` counter, the rare find on `k:<tier>`, and count toward a slay bounty.
- A fall: `stats.deaths`, `foeDeaths`, five minutes of recovery, the ten minute wound, death wear on every worn piece, no camp note, and the usual `hunt:death` line.
- `owed.remedies` bottles come off the Satchel, strongest first, and `player.hp` follows the fight.

The share is taken **after** the request's catch-up, at the save's own clock, and cleared in the same transaction that writes the save: a request that fails pays nothing, and a request that succeeds cannot pay twice. After the catch-up rather than before, because `advance()` has cleared an expired bounty buff by then; settling first would let a buff claimed half a day ago double a whole day of somebody else's fighting. The cost is that a fall is answered for when the hunter comes back to it: the recovery and the wound run from the moment they settle, not from the moment they went down, which the fight does not date.

### The tick

The simulation is JavaScript, so Postgres cannot play it. `pg_cron` wakes every 30 seconds, `private.party_hunt_tick()` checks whether any session is live at all and posts to `POST .../functions/v1/game/tick` through `pg_net` with the shared secret in `x-respite-tick` only if one is. The function checks the secret against `RESPITE_TICK_SECRET` (whole-string compare; unset, or shorter than 16 characters, and the path refuses everyone and says so in the log), takes the due rows (`next_due <= now`, 25 at a time), and plays each in its own transaction with `for update`, so a member's own request never waits behind the batch and a session the rules choke on cannot stop the others. It spends at most a second of rules time a pass and leaves the rest for the next one. It answers `{ ok: true, due, ticked, closed, failed, swept }`.

A session runs no longer than a lone hunt: twelve hours from `started_at`, then it closes (`over`), stops ticking and waits to be settled out of. A wipe closes it the same way. A closed row is deleted as soon as it owes nobody anything, and swept up seven days after it closed whether or not the last member ever came back.

Nothing about this is required for a party to hunt while somebody is watching: a member's own request plays their party's session forward before it settles their share. Without the cron, a party moves only while at least one of them has a tab open.

### What the handler is doing that the engine should

Four things are worked around here rather than fixed where they belong. Each is a small change to `src/shared/partyHunt.js` or `combat.js`, and until it is made this file is where the reason lives.

1. **A session is not JSON round-trippable in the middle of an encounter.** The roster (`s.hunters`) and the live encounter (`s.enc.hunters`) are the same objects in memory and two sets of copies after `jsonb`, and only the encounter's copy is the one the fight moves. A share settled from a stored row would be read off a hunter who stopped fighting when the row was written. The handler points the roster back at the encounter's hunters on every read (`rehydrate`). The fix is for the engine to look its hunters up by id, or for `owedFor`, `sessionView` and `nextEncounter` to read the encounter's roster while one is live. The server suite has the regression test.
2. **`owed.kills` is a count, not the foes.** Only the kills a hunter won the spoils of carry a monster id, so shared kills cannot credit a slay bounty, the `m:<id>` counter or the bestiary the way a lone kill does. `owed` should carry the kills as ids.
3. **`dropLoot` and `stashLoot` are not exported from `combat.js`**, and neither is the Threat setter, so the settlement spells all three out again (`dropFor`, `stashLoot`, the `state.threat` line in `settleParty`). Two copies of the drop rolls is exactly how a party kill quietly stops dropping what a lone one does. Exporting them is a one-word change each.
4. **A party session never calls a Sovereign down**, and never banks a run record: `newSession` only ever builds `kind: "normal"` encounters, and `bankRun` is private. Threat still rises with every kill, so a party can push a region to its cap with nothing at the top of it and no way down but hiding alone.

## 4. Setting up the database

In the Supabase dashboard, SQL Editor, in this order. Each is safe to run again.

1. `supabase/schema.sql`.
2. `supabase/migrations/002_server.sql`. Required: without its indexes every request's expiry sweep reads every listing ever made (13 ms per request at 40,000 listings on PGlite, against 1.5 ms), and every listing reads all of the seller's past listings.
3. `supabase/migrations/003_profiles_from_saves.sql`. Required, and before the v5 client goes live: it gives every v4 save a profile under its name, so a stranger signing up as `name@anywhere` cannot take it first. Where two rows claim one name (a v4 browser could rewrite its own row), the account whose email carries the name wins. These bare profiles show total level 0 until their player's first request fills them in.
4. `supabase/migrations/004_leaderboard_boards.sql` and `005_wealth_board.sql`. Optional: the boards `hiscores()` cannot answer.
5. `supabase/migrations/006_party_hunts.sql`. Required for party hunts, and it asks for two values by hand: `RESPITE_TICK_SECRET` in the function's secrets, and the same secret plus the function's URL in `private.settings`. Its header is the instructions. Enable `pg_cron` and `pg_net` first (dashboard, Database, Extensions) or the file says in a notice that the tick is not scheduled and carries on.
6. `supabase/migrations/007_market_pools.sql`. Required, and it goes out together with the function and the static client: it closes the market's reads to everyone but the row's owner and opens the three functions the page reads instead, so a browser that predates it shows an empty market until it reloads. Run it again after any later run of `schema.sql`, which recreates the two policies it narrows.
7. `supabase/migrations/018_ground_hunters.sql`. Optional: who else is out on each region's ground, for the Hunt page's map. Without it the map draws the player and their party and says nothing about anyone else.
8. The legacy audit in section 5, before announcing the market.

## 5. Legacy saves: audit before announcing the market

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

## 6. Environment

Supabase gives every function these three, and one more is set by hand, only for party hunts:

| Variable | Used for |
| --- | --- |
| `SUPABASE_URL` | `GET /auth/v1/user` to learn who holds the token. |
| `SUPABASE_ANON_KEY` | The `apikey` header on that call. |
| `SUPABASE_DB_URL` | The Postgres connection. It connects as `postgres`, the owner of the tables, so RLS does not apply to it. |
| `RESPITE_TICK_SECRET` | The shared secret on `POST .../game/tick`, which carries no user token (section 3). Set it with `npx supabase secrets set RESPITE_TICK_SECRET=...` and put the same value in `private.settings`. Unset, or under 16 characters, the tick path refuses everyone. |

The connection is `postgres(SUPABASE_DB_URL, { prepare: false, max: 1, idle_timeout: 20 })`, made once per isolate. `prepare: false` keeps it safe behind the transaction pooler.

## 7. Deploying

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

Deploy the function and the browser together when `ENGINE_VERSION` changes: old browsers get 409 and must reload. The SQL files are not deployed by the workflow; run new ones by hand (section 4).

Migration 007 is the other case where the three pieces have to go out together, and it does not change `ENGINE_VERSION`: nothing an older browser *predicts* is different, so it is not turned away, but its market page reads listings it may no longer select and calls functions it does not know. Run 007, deploy the function and publish the client in one sitting. A tab left open from before will show an empty market until it is reloaded; bumping `ENGINE_VERSION` is the lever if that is not acceptable, at the price of reloading every tab in the realm.

## 8. Operations

**CPU.** The free plan allows 2 s of CPU per request (waiting on the database does not count). Everything but the catch-up is small: a request with no time to make up costs a few milliseconds of rules and JSON. Catch-up cost grows with what happened while the player was away, not with how long: tasks stop at twelve hours, and an idle camp costs almost nothing however long it sat. The worst case measured, a level 80 Warrior hunting tier 9 Core while the Forgemaster works, twelve hours in one request (1,767 kills, 67 Sovereigns felled, 600 crafts) took about 300 ms in Node, database work included. A hostile legacy row migrates in linear time (about 100 ms for 40,000 keys, first load only), and rows over 2 MB are never read.

**Catch-up budget.** As a safety net the handler plays a long absence in 15-minute slices (the rules give identical results however time is cut; the tests check the saves match) and stops once a request has spent 1 s in the rules. It then saves what it has, answers 200 with `state.clock < now`, and gives every command `The camp is still catching up.` The client should send the next request straight away, with those commands again, until `state.clock === now`. On a warm isolate this should never trigger; it keeps a cold start on a slow machine from failing the same request forever.

**Request rate.** Every request is one function invocation and one database transaction, and returns the whole save (about 1 KB of JSON for a new camp, 11 KB for the late-game camp above). The browser predicts between requests, so the server only needs to hear what the player did:

- Sync once on load, and when the tab becomes visible again.
- Queue commands and flush them after about 1 s without a new one, or at once for market actions. Send `resetCamp` in a request of its own. At most 25 commands per request.
- While the tab is visible and idle, sync every few minutes, and heartbeat once a minute (party chat, invites and roster changes come through Realtime, not this function; a party member counts toward the bonus only while `last_seen` is under 3 minutes old).
- Never overlap requests for one player: they queue on the save row anyway. Wait for the reply.
- On 500 or a network error, back off (2 s, 4 s, 8 s, up to 60 s) and keep the queue.

Invocations are metered per plan (check Supabase's pricing page). As a guide, a player online two hours a day syncing every few minutes plus their actions is a few thousand invocations a month.

**Logs.** Failed requests, commands that threw and unreadable saves are logged with `console.error` ("game: request failed", "game: command X threw", "game: the save for <user id> could not be read") in the dashboard's function logs, and so is a party hunt row the rules could not play or settle ("game: the party hunt N could not be played", "game: a share of party hunt N threw", "game: a tick arrived but no tick secret is set"). Clients never see details. What the cron and pg_net made of a tick is in the database: `select * from cron.job_run_details order by start_time desc` and `select * from net._http_response order by created desc`.

**Housekeeping.** Listings expire on other players' requests, 50 at a time, so while anyone plays a due listing goes home within seconds. Nothing but party hunts needs a cron.

**What party hunts cost.** A live session is one invocation every 30 seconds for as long as it is out, whether or not anybody is watching: 2,880 a day a realm, not a party, because one pass plays up to 25 sessions. `private.party_hunt_tick()` posts nothing when no session is live, so an idle realm pays for one index probe a pass and no invocations at all. A pass costs a few milliseconds of database time and at most a second of rules time in the function. If that is too much, lengthen the schedule (`cron.alter_job`, or run the migration's last block again with a different interval): the only thing a slower tick changes is how far behind an unwatched fight runs, because a member's own request catches their party's session up before settling it. Turn it off entirely by unscheduling `respite-party-tick`, and parties still hunt whenever one of them is online.

## 9. Tests

From the repo root, with Node 22:

```sh
npm install
npm test               # the engine, SQL, server and client store suites
npm run test:server    # this function's suite alone (node tests/server/run.mjs)
npm run test:sql       # the schema and RPC suite alone (node tests/sql/run.mjs)
```

`npm install` brings PGlite, postgres.js, Deno and Playwright for the suites. Without it, the SQL and server suites take PGlite from `PGLITE_PATH` (an `@electric-sql/pglite` package folder).

The server suite loads `tests/sql/stubs.sql`, `supabase/schema.sql` and the migrations into PGlite, runs the real handler and rules against it with a fake `getUser` and a hand-moved clock, and prints PASS or FAIL per check. The SQL suite covers the schema, RLS and the party RPCs, including an accept that loses a race to another accept. Party hunts are covered in the server suite (two members out together, the tick with the right secret and the wrong one, each settling on their own request, a fall, the cap, the sweep, and that no client can read the session row) because they need the handler, the migration and the rules at once.

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
