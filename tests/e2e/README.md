# Respite browser tests and the local stage

Everything online (Supabase Auth, PostgREST, Realtime and the `game` Edge Function) runs on one machine: `dev/server.mjs` (the stage) serves the repo, runs the real `src/server/handler.js` on PGlite and answers the calls `dev/fake-supabase.js` makes in place of supabase-js. The browser client runs unchanged.

| File | What it is |
| --- | --- |
| `dev/server.mjs` | The stage: static files, PGlite, the game function, auth, RPC, queries, realtime changes, test controls |
| `dev/fake-supabase.js` | `window.supabase.createClient` with exactly the surface in CLIENT.md section 5 |
| `dev/harness-check.html`, `.js` | A plain page that calls the fake surface directly (`window.harness`) |
| `tests/e2e/lib.mjs` | Helpers: the stage in-process, Chromium, pages, accounts, sync, SQL seeds, screenshots, PASS/FAIL |
| `tests/e2e/harness.test.mjs` | Proves the stage and the fake client without any client code |
| `tests/e2e/client-smoke.test.mjs` | The real app through `index.html`: store, net and shell end to end |

## Running

Node 22. From the repo root, `npm install` brings PGlite and Playwright (the devDependencies in `package.json`); Playwright's browser is a separate download, `npx playwright install chromium`. Without an install, point `PGLITE_PATH` at an `@electric-sql/pglite` package folder and `PLAYWRIGHT_PATH` at a `playwright` package folder (`PLAYWRIGHT_PATH` wins when set; a global Playwright install is the last resort). Browsers come from Playwright's usual cache, or `PLAYWRIGHT_BROWSERS_PATH`.

```sh
# From the repo root.
npm install
npx playwright install chromium
npm run test:e2e                       # both files below, one after the other

node tests/e2e/harness.test.mjs        # the stage and the fake client (20 s idle, a minute on a busy machine)
node tests/e2e/client-smoke.test.mjs   # the real client (needs src/client/main.js; about as long)

# The stage by hand: the game at http://127.0.0.1:8787/, the check page at /dev/harness-check.html
npm run dev                            # the same as: node dev/server.mjs --port 8787 --allow-sql
```

Options: `--port N` (default 8787, `0` picks a free port), `--quiet` (no request log), `--allow-sql` (opens `/dev/sql`). In a script: `const stage = await startDevServer({ port: 0, allowSql: true, quiet: true })` gives `{ url, port, close(), db, clock, errors }`; `db` is the PGlite instance, `clock.offset` the game clock's lead in ms, `errors` every line the handler or the stage logged as an error.

Each test file starts its own stage on a free port, so files can run side by side. Everything is in memory: a restarted stage has no accounts, and a browser still holding an old session gets 401 from the game function.

Screenshots from the smoke test land in `tests/e2e/shots/` (ignored by git), or in the folder `RESPITE_SHOTS` names.

The other suites: `npm test` runs `node tests/engine/run-all.mjs`, `node tests/sql/run.mjs`, `node tests/server/run.mjs` and `node tests/client/store.test.mjs`.

## What the stage serves

`GET /` and `/index.html` are `index.html` with three changes: the jsdelivr supabase-js script becomes `<script src="dev/fake-supabase.js"></script>`, `window.RESPITE_SUPABASE_URL` becomes the origin the browser used, and `window.RESPITE_DEV = true` is set just before `src/client/main.js` (so `main.js` publishes `window.__respite`). Every other path is a file from the repo root with its MIME type and `cache-control: no-store`; dotfiles and anything outside the repo are 404.

The database is PGlite loaded exactly as `tests/server/run.mjs` loads it: `tests/sql/stubs.sql`, `supabase/schema.sql`, then `supabase/migrations/*.sql` in order. The stage adds one private schema, `dev_realtime`, with a trigger on each table in the `supabase_realtime` publication.

### Endpoints

Browser endpoints (auth, rpc, query, changes) answer HTTP 200 even when refusing, with the PostgREST or GoTrue status inside the body as `status`; see the differences below.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `POST /functions/v1/game` | the game protocol (SERVER.md) with `Authorization: Bearer <token>` | the real handler's status and JSON, with the Deno wrapper's CORS. `OPTIONS` is 204 |
| `POST /dev/auth/signup` | `{ email, password }` | `{ session: { access_token, token_type, expires_in, expires_at, refresh_token, user }, user, error: null }`. Refusals: `User already registered`, `Password should be at least 6 characters.`, `Signup requires a valid password`, `Unable to validate email address: invalid format`, `Anonymous sign-ins are disabled` (no email) |
| `POST /dev/auth/signin` | `{ email, password }` | the same, or `Invalid login credentials` |
| `POST /dev/auth/signout` | bearer token | `{ error: null }`; the token stops working |
| `POST /dev/rpc` | `{ fn, args }`, bearer token (none means `anon`) | `{ data, error: { message, code, details, hint } \| null, status }` |
| `POST /dev/query` | `{ table, select, filters: [[op, column, value]], order: [column, ascending], range: [from, to], limit }`, bearer token | `{ data: rows, error, status }` |
| `GET /dev/changes?since=n` | | `{ id, tables: [changed since n], changes: { table: lastChangeId } }` at once. No `since` gives the current id and no tables |
| `POST /dev/clock` | `{ advanceMs }` or `{ offset }` | `{ offset, now }`. Moves the game function's `now` forward only |
| `GET /dev/health` | | `{ ok, engine, now, offset, users, changeId, realtime, rpc, allowSql, errors }` |
| `POST /dev/sql` | `{ text, params }` | superuser SQL, `{ data: rows, error }`. With `params` (an array) it is one statement; without, `text` may hold several and the last one's rows come back. 403 unless the stage allows SQL |

**RPC.** Only functions `supabase/schema.sql` or a migration creates in `public` are callable (today `heartbeat`, `online_count`, `hiscores`, `party_create`, `party_invite`, `party_cancel_invite`, `party_respond`, `party_leave`, `party_kick`, `party_say`, `party_state`). Each call is one transaction: `set local role authenticated` (or `anon` with no token), then `request.jwt.claim.sub` (what `stubs.sql`'s `auth.uid()` reads) together with `request.jwt.claims` and `request.jwt.claim.role`. Arguments are matched by name against the catalog (unknown or missing names give PostgREST's `Could not find the function public.fn(args) in the schema cache`) and cast the way PostgREST casts a JSON body, through `jsonb_to_record`. A raised exception comes back as its message (`code` P0001). Set-returning functions give an array of rows, `void` gives `data: null` (status 204), anything else its JSON value.

**Queries.** Tables: `market_listings`, `market_sales`, `profiles`, `parties`, `party_members`, `party_invites`, `party_messages`, `mail`, `saves`. Ops: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `ilike` (`*` works as `%`, as in PostgREST), `in` (a list). `select` is `*` or a comma list of plain column names, checked against the catalog. Values are compared as PostgREST compares URL text: cast from text to the column's type, so ISO strings work against timestamps. `order` may also be a list of `[column, ascending, nullsFirst]`. Rows come from Postgres's own JSON (`json_agg`), so `bigint` is a number and timestamps are ISO strings with `+00:00`, as PostgREST sends them. RLS is real: the query runs as the caller.

**Realtime.** A row trigger on each published table (`party_invites`, `party_members`, `party_messages` today) calls `pg_notify` and the stage bumps one change id and records it against the table. Notifications fire on commit, so a refused RPC (rolled back) pokes nobody, and anything that really changes those rows pokes: party RPCs, cascades from a deleted party, `/dev/sql` seeds. Game requests do not write party tables, so they poke nothing, exactly as in production.

## The fake client

`dev/fake-supabase.js` implements CLIENT.md section 5 and nothing else, so client code that uses more than the contract fails here (a `TypeError`) instead of quietly differing in production. The session is stored in `localStorage` under `sb-<first host label>-auth-token` (`sb-127-auth-token` on the stage), like supabase-js. `onAuthStateChange` gives `INITIAL_SESSION` on its own turn, then `SIGNED_IN` and `SIGNED_OUT` (also when another tab changes the stored session); sign in and sign out wait for every listener before they resolve. `rpc()` and `from().select()` return lazy thenables like postgrest-js: nothing is sent until they are awaited, and they have `then` only. Request errors resolve as `{ data: null, error: { message } }`; nothing throws. Channels poll `GET /dev/changes` once a second (one shared poll per client), report `SUBSCRIBED` after their first poll, `CHANNEL_ERROR` if the stage cannot be reached (and `SUBSCRIBED` again when it can), and `CLOSED` from `removeChannel`.

## Writing a browser test with lib.mjs

```js
import { run, check, same, section, startStack, launch, openApp, signUp, waitForSync, dispatch } from "./lib.mjs";

await run(async () => {
  const stack = await startStack();
  const browser = await launch();
  try {
    section("a camp");
    const app = await openApp(browser, { url: `${stack.url}/`, viewport: { width: 390, height: 844 } });
    same("sign up", await signUp(app.page, "tester", "secret1"), null);
    await waitForSync(app.page);
    check("started", (await dispatch(app.page, "startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: null })).ok);
    same("no console errors", app.errors, []);
  } finally {
    await browser.close();
    await stack.close();
  }
});
```

| Helper | Does |
| --- | --- |
| `run(main)`, `check(name, ok, detail)`, `same(name, actual, expected)`, `section(title)`, `finish()` | PASS/FAIL lines, `<n> passed` (and `, <m> failed`), exit 1 on any failure |
| `startStack(options)` | the stage in-process, free port, SQL allowed, quiet |
| `sql(stack, text, params)`, `editSave(stack, username, fn)`, `put(state, pool, key, qty)`, `userIdOf(stack, username)` | seeds as the server would write them, through `/dev/sql`; `sql` throws on a database error (pass `params` as `null` for several statements); `editSave` writes only on the `rev` it read and tries again if a sync got there first. Let the page sync first (`waitForSync`), then edit, then `store.sync()` |
| `advanceServer(stack, ms)` | `POST /dev/clock { advanceMs }` |
| `launch()` | headless Chromium from Playwright (`PLAYWRIGHT_PATH`, else the repo's `node_modules`, else a global install) |
| `openApp(browser, { url, viewport })` | a fresh context and page; `errors` (console errors and page errors), `failures` (local 4xx and 5xx), `blocked` (requests that tried to leave the machine, such as Google Fonts, which are aborted) |
| `signUp(page, username, password)`, `signIn(...)` | through `window.__respite.net` on the app (waiting for it), `window.harness` on the check page, or a fresh fake client elsewhere; null or the error string |
| `waitForSync(page)` | until `store.status.conn === "online"` and nothing is pending; the timeout error carries the status |
| `dispatch(page, type, args)`, `storeStatus(page)` | `window.__respite.store.dispatch`, and `{ mode, ...status }` |
| `overflowX(page)`, `wideElements(page)` | sideways scroll in px, and the elements poking past the edge |
| `shot(page, name)` | `tests/e2e/shots/<name>.png`, or `<name>.png` in `RESPITE_SHOTS` |
| `waitFor(what, fn, { timeout })`, `sleep(ms)`, `repoHas(path)` | small Node side helpers |

`window.__respite.store` may be replaced when the player signs in or out, so read it inside each `page.evaluate` rather than keeping a handle.

## Known differences from real Supabase

- **Auth.** Users and tokens live in the stage's memory; there is no email confirmation, rate limit, refresh token flow or `refreshSession`. A token works until its owner signs out or the stage restarts (in Supabase an access token lasts an hour and stays valid for PostgREST until it expires, even after sign out). Sessions carry Supabase's one hour `expires_in`; the fake quietly moves `expires_at` forward, as autoRefreshToken would, and the token itself never changes, so `TOKEN_REFRESHED` never fires. The access token is JWT shaped (`sub`, `email`, `role`, `exp`) but its signature is random: only the stage's token table honours it. The `apikey` header is never checked.
- **No auth lock.** supabase-js serialises auth work behind a lock, and an `onAuthStateChange` callback that awaits another client call can deadlock there. The fake has no lock, so that mistake does not show up on the stage.
- **HTTP statuses.** Auth, RPC and query refusals answer HTTP 200 with the real status in the body (`status`, mirrored into the result's `status`). PostgREST and GoTrue answer 4xx, which Chromium logs as a console error; the stage keeps the console clean so tests can demand no errors. The game function keeps its real statuses, so a 401 or 409 from it is logged by Chromium as usual.
- **Queries.** Plain columns only: no embedded resources, aliases, casts, `count`, `head`, `single`, `maybeSingle`, `or`, `is`, `not`, `like`, `match`, `filter` or writes. At most 1,000 rows (Supabase's default). A table outside the list answers `Could not find the table ... in the schema cache`, even where Supabase would say `permission denied` (`hunt_presence`).
- **Realtime.** Polling once a second instead of a websocket. Payloads have `eventType: "*"`, empty `new` and `old`, and arrive for any change to the table: `filter` and RLS are not applied, so a client may be poked about another party's rows (a poke means "go and look"). Events for tables outside the publication never arrive, as on Supabase. Broadcast and presence are not played (`channel.on` warns). The poll runs on page timers, which a browser slows in a hidden tab, so pokes lag there where a websocket would not.
- **Time.** `/dev/clock` moves only the game function's clock (the command clamp, the catch-up, hunt presence, and what the function writes on it: a profile's `last_seen` on each game request, listing `created_at` and `expires_at`). Postgres `now()` stays on the wall clock: the `heartbeat` RPC's `last_seen`, other `created_at` defaults, `online_count`'s three minutes and `party_say`'s 1.5 second rate limit do not jump with it. So once the game clock has jumped, a heartbeat leaves a member's `last_seen` behind the game's time, and on the stage the party hunt bonus (which counts a member for three minutes after `last_seen`) stops counting them. The clock never moves back.
- **One connection.** PGlite runs one statement at a time, so requests queue instead of contending for row locks; deadlock and serialization retries in the handler never run here.
- **Preflight.** `OPTIONS /functions/v1/game` answers 204; the Deno wrapper answers 200 with `ok`. Both carry the same CORS headers.
- **Auth lookups.** The handler's `getUser` reads the stage's token table instead of calling `GET /auth/v1/user`, so the email it sees is the lowercased sign-up email, as GoTrue would store it.
