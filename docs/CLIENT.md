# Respite v5 client contract (src/client)

Binding for everyone writing browser code. Read with: `UI-REQUIREMENTS.md` (what the owner asked for), `UI-KIT.md` (every class, markup pattern and helper; build only from it), `ENGINE.md` (the rules; section 17 is the UI query index: every number a page shows comes from those functions), `SERVER.md` (the game function), `CONTRACT.md` (database, commands, events).

Serve the repo over HTTP for anything in a browser (ES modules do not load from file://): `npm run dev` starts the local stage with a fake Supabase on port 8787, or `python3 -m http.server` for static pages such as `dev/kit.html` and `dev/page.html`. Browser tests use Playwright (`npm install`, then `npx playwright install chromium`).

## 0. Rules

- Vanilla ES modules, relative `.js` imports, no build step, no dependencies.
- No em dash (U+2014), en dash (U+2013) or infinity sign (U+221E) anywhere: code, comments, strings, markdown. `node tests/engine/purity.test.mjs` fails the whole repo if one appears.
- No inline styles except bar widths via `setWidth`. No new colours. Missing a component? Add it to `css/components.css` or `css/pages.css` in the kit's style and document it in `UI-KIT.md` (append to the relevant section, keep edits small, never restyle existing components).
- Pages never write the save. Every change is `ctx.dispatch(type, args)`. Pages never call `advance` or `applyCommand`.
- Features that are not open are not rendered (UI-REQUIREMENTS 12, UI-KIT ground rule 6).
- Every gold spend goes through `confirmSpend(ctx, { title, body, gold, confirmText })` from `ui/widgets.js` (market buys included).
- Header comment on every file in the house style (`Respite · pages/shop.js · The Name`), short comments that say why.
- Keep text in the game's voice (grim, plain, short). British spelling as the existing copy (Defence, armour). Use the names: Belongings, Stockpile, Vault, the Bonesetter, the Smuggler.

## 1. Files and owners

| Path | What | Owner |
|---|---|---|
| `src/client/main.js` | boot, loop, auth switching, debug hook | core |
| `src/client/config.js` | Supabase URL and key from `window.RESPITE_SUPABASE_*`, flags | core |
| `src/client/clock.js` | server-aligned time | core |
| `src/client/net.js` | Supabase: auth, game function, RPCs, queries, realtime | core |
| `src/client/store.js` | predicted save, commands, sync, reconcile, party and online polling | core |
| `src/client/router.js` | hash routes, page mounting, update cadence | core |
| `src/client/listeners.js` | toasts from events and news | core |
| `src/client/ui/shell.js` | topbar, sidebar nav, drawer, weather card, banners, log dock | core |
| `src/client/ui/popups/settings.js` | popups `settings`, `account` | core |
| `src/client/ui/widgets.js` | `qtyPicker`, `registerPopup`/`openPopup`/`hasPopup`, `confirmSpend` (exists) | shared, extend carefully |
| `src/client/ui/popups/action.js` | popup `action` | skills |
| `src/client/pages/skill.js` | `#/skill/<gathering or artisan id>` | skills |
| `src/client/pages/character.js` | `#/character` | skills |
| `src/client/ui/popups/item.js` | popup `item` | storage |
| `src/client/pages/armaments.js` | `#/armaments` | storage |
| `src/client/pages/stockpile.js` | `#/stockpile` | storage |
| `src/client/pages/hunt.js` | `#/skill/warfare` | hunt |
| `src/client/ui/popups/zone.js`, `foe.js`, `class.js` | popups `zone`, `foe`, `class` | hunt |
| `src/client/pages/companions.js`, `bounties.js`, `requisitions.js`, `shop.js`, `atlas.js` | camp and atlas pages | camp |
| `src/client/ui/popups/sky.js` | popup `sky` (the week's weather, opened from the Atlas and the weather card) | camp |
| `src/client/pages/fortify.js` | `#/fortify`: the anvil (the circle with its sockets, the odds and the press under it, two racks of stock beside it) and Convert | camp |
| `src/client/ui/halo.js` | what a worked piece wears, one effect a piece (the amulet's glow, the ring's ring): `plusPlate`, `paintMini(node, plus, slot)`, `haloNode`/`paintHalo(node, plus, slot)`, `auraNode`/`paintAura(node, wornHalos(eq))`, `avatarHaloNode`, `haloTags` (CSS in pages.css, THE HALOS) | shared |
| `src/client/ui/popups/profile.js` | popup `profile` (a commander's card, off a name in the Party tab) | realm |
| `src/client/pages/market.js`, `party.js`, `hiscores.js` | realm pages | realm |
| `src/client/ui/popups/sell.js` | popup `sell` | realm |
| `dev/server.mjs`, `dev/fake-supabase.js`, `tests/e2e/**` | local full-stack harness and browser tests | harness |
| `dev/stub.js`, `dev/page.html`, `dev/page.js` | stub store and page runner (exist) | shared |

Only edit files you own. Shared files: add, never break.

## 2. Page modules

```js
// src/client/pages/<name>.js
export default {
  id: "shop",                                  // route page id
  title: (ctx) => "Shop",                      // breadcrumb leaf and document.title
  group: "The Camp",                           // breadcrumb group
  visible: (ctx) => true,                      // optional: false hides the nav row and redirects the route to #/character
  mount(view, ctx) {                           // build into view (it is empty); return the live handle
    return {
      update(ctx) {},                          // ~10 times a second and right after dispatches; cheap, in place (UI-KIT rule 9)
      unmount() {},                            // optional: timers you started (ctx.on/onTick subscriptions are released for you)
    };
  },
};
```

`skill.js` and `hunt.js` both serve `#/skill/<id>`; the router sends `warfare` to hunt.js and gathering/artisan ids to skill.js. `title` for skill pages is the skill name, `group` the kind ("Trades", "Artisans", "The Field").

Routes: `#/character` (default), `#/armaments`, `#/stockpile`, `#/companions`, `#/bounties`, `#/requisitions`, `#/shop`, `#/fortify`, `#/skill/<id>`, `#/atlas`, `#/market`, `#/party`, `#/hiscores`, `#/player/<name>`. The Sky is the `sky` popup, not a route. Unknown routes go to `#/character`. Route changes call `closeModals("route")`.

Rebuild a page section only when its shape changes. Compare a signature string in `update` (for example the ids of the pills shown plus which one is working) and rebuild that section when it changes; otherwise update text and bars in place.

## 3. ctx

Pages and popups receive the same shape (dev/stub.js `createCtx` builds a faithful one):

```js
ctx.state            // getter: the predicted save right now (read only; never keep a reference across frames)
ctx.now              // getter: the predicted server time in ms (equals ctx.state.clock after each frame)
ctx.store            // the store (section 4)
ctx.net              // the net API (section 5)
ctx.account          // getter: { mode: "guest" | "account", username, userId }
ctx.party            // getter: latest party_state object (CONTRACT.md shape) or null
ctx.route            // { page, arg }
ctx.go(hash)         // navigate, e.g. ctx.go("#/market")
ctx.dispatch(type, args = {}, { quiet = false } = {})   // -> Promise<{ ok, error?, data? }>; a refusal toasts error (kind "warn") unless quiet
ctx.on(type, fn)     // subscribe to store.bus for this page's (or popup's) life; returns off
ctx.onTick(fn)       // called ~10 times a second; returns off
```

Popups must call their `off`s when the modal closes (use `openModal`'s `onClose`).

## 4. Store (core implements; others read)

```js
store.mode                     // "guest" | "account"
store.state                    // predicted save
store.now()                    // server-aligned ms
store.bus                      // createEmitter(): live engine events + store events
store.status                   // { conn: "guest" | "connecting" | "online" | "syncing" | "offline" | "outdated", pending, lastSyncAt, error }
store.party                    // party_state or null (account mode only)
store.partyHunt                // sessionView() of the party fight this camp is out on, or null
store.online                   // players online (number) or null
store.dispatch(type, args)     // -> Promise<{ ok, error?, data? }>
store.frame()                  // advance the predicted save to now with the live env
store.sync()                   // push pending commands now and adopt the server's answer
store.refreshParty()           // -> Promise<party_state | null>
store.account()                // { mode, username, userId }
```

Behaviour:
- Predictable commands (`COMMANDS[type].predict`) apply locally at once and resolve with the local result; they are queued and sent in a batch (about 1s debounce, at most 25 per request).
- Server-only commands (`marketList`, `marketBuy`, `marketBuyPool`, `marketCancel`, `resetCamp`) flush the queue and wait for the server's result. Guests get `{ ok: false, error: "Sign in to trade." }` (resetCamp in guest mode starts a fresh local camp).
- Reconcile: on every response the store adopts the server state, replays still-unsent commands on top with a quiet env, advances to now quietly, and emits `store:replaced`. Toasts never repeat for replayed time.
- A predicted command the server refused emits `store:rejected { type, error }`.
- Server news (`response.events`: `mail:claimed { gold, items, count }`, `away { ms, gains, gold }`) is emitted as `store:news { type, ...payload }`.
- Cadence (account mode): sync on load, on focus/visibility, after commands (debounced), and every 5 minutes while visible; never overlapping; again soon when the answer's `state.clock < now`. Heartbeat RPC every 60s while visible (activity `{ skill, action, hunt: { tier, zone } | null }`). `online_count` every 60s. Party state every 30s while in a party or on the Party page, plus realtime pokes.
- Returning to a tab hidden more than 5 minutes: sync first (the server does the catch-up), then adopt.
- `store.bus` events: every engine event from live frames (payloads carry `at` and `state`; see ENGINE.md 17 "Events"), plus `store:replaced {}`, `store:status { status }`, `store:rejected { type, error }`, `store:news { type, ... }`, `store:party { party }`, `store:partyHunt { partyHunt }`, `store:online { online }`.
- Party hunts: the answer to a game request carries `party`, `sessionView()` of the shared fight this camp is out on (CONTRACT.md), and leaves it out otherwise. `store.partyHunt` is that value, kept word for word and cleared the moment an answer omits it or calls it `over`. Nothing reads it into the save and nothing plays it forward: a shared fight cannot be predicted at all (`src/shared/partyHunt.js`), so a page draws what came back and no more. While one is live the sync cadence drops from five minutes to `TIMING.partyHuntMs` (4 s) while the tab is visible, because that request is what plays the party's fight forward (docs/SERVER.md 3); `party_hunt_view()` would cost a request and move nothing.

## 5. Net (core implements; realm pages call)

```js
net.enabled                                   // Supabase configured
net.session()                                 // -> { userId, username, token } | null
net.signIn(username, password)                // -> error string | null
net.signUp(username, password)                // -> error string | null (username /^[a-z0-9_]{3,20}$/ lowercased, password 6+)
net.signOut()
net.game(commands)                            // -> response JSON (SERVER.md), used by the store only
net.rpc(name, args)                           // -> { data, error }  (error is the RPC's human message or null)
net.market.browse({ q = "", kind = null, tier = null, sort = "price" | "newest", limit = 50, offset = 0 })
                                              // -> { rows, error }; market_browse(): open gear and tool listings, one row each,
                                              // no seller anywhere, `mine` true on your own. Materials are never in it
net.market.pools({ q = "", tier = null, limit = 50, bands = 8 })
                                              // -> { rows, error }; market_pools(): materials aggregated by item key, cheapest
                                              // pool first: { item_key, item_name, item_base, item_kind, item_tier, qty_left,
                                              // price_min, bands: [{ each, qty }] }. Your own listings are not counted
net.market.bases({ q = "", kind = null, tier = null, rarity = null, sort = "price" | "newest", limit = 50 })
                                              // -> { rows, error }; market_bases(): gear and tools grouped by base, one row a
                                              // shelf: { item_base, item_name, item_kind, item_tier, lots, mine_lots, qty_left,
                                              // price_min, price_max, newest, rarities: [{ rarity, lots, qty, min }] }.
                                              // `rarity` is a floor ("rare" = Rare and up) and decides price_min with it
net.market.baseListings({ base, rarity = null, limit = 50 })
                                              // -> { rows, error }; market_base_listings(): every open lot of one base, in the
                                              // shape browse() answers, cheapest first. The buy still runs against one listing
net.market.mine()                             // -> { rows, error }; the player's own listings, newest first, all statuses, 50
net.market.sales()                            // -> { rows, error }; market_sales_mine(): your own trades, newest 50,
                                              // { id, side: "sold" | "bought", item_key, item_name, qty, price_each, fee, created_at }
net.party.state()                             // -> { data, error }  party_state()
net.party.huntView()                          // -> { data, error }  party_hunt_view(): the party's live fight, or null
net.party.create(name) / invite(username) / cancelInvite(id) / respond(id, accept) / leave() / kick(userId) / say(body)
                                              // -> { data, error }
net.party.subscribe(partyId, onChange)        // realtime on party_messages, party_members, party_invites; -> unsubscribe
net.hiscores(skill = "total", limit = 50)     // -> { rows, error }
net.onlineCount()                             // -> number | null
net.heartbeat(activity)
```

Usernames map to emails as `<username>@players.respite` (v4 accounts keep working).

### Supabase-js surface (net.js uses only this; the dev harness fakes exactly this)

```js
supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
client.auth.getSession()                                  // { data: { session: { access_token, user: { id, email } } | null }, error }
client.auth.signUp({ email, password })                   // { data: { session, user }, error: { message } | null }
client.auth.signInWithPassword({ email, password })       // same
client.auth.signOut()                                     // { error }
client.auth.onAuthStateChange((event, session) => {})     // { data: { subscription: { unsubscribe() } } }
client.rpc(fn, args)                                      // Promise<{ data, error: { message } | null }>
client.from(table).select(columns)
  .eq(col, v) .neq(col, v) .gt(col, v) .gte(col, v) .lt(col, v) .lte(col, v) .ilike(col, pattern) .in(col, values)
  .order(col, { ascending }) .range(from, to) .limit(n)   // awaitable: { data, error }
client.channel(name).on("postgres_changes", { event: "*", schema: "public", table, filter }, cb).subscribe(statusCb)
client.removeChannel(channel)
fetch(`${url}/functions/v1/game`, { method: "POST", headers: { Authorization: `Bearer ${access_token}`, apikey: key, "content-type": "application/json" }, body })
```

## 6. Popups (registry in ui/widgets.js)

Each popup module calls `registerPopup(name, (ctx, ...args) => handle)` at import. `main.js` (and `dev/page.js`) import every popup module. Open with `openPopup(name, ctx, ...args)`.

| Name | Arguments | Owner | What |
|---|---|---|---|
| `item` | `key, { from = null, readOnly = false }` | storage | UI-KIT 8.5. `from` is `inv`, `bank`, `vault`, `"worn"` (equipment slot) or null (not held: market or recipe preview). Actions per kind; "List on the market" (account mode, tradeable, held) opens `sell` on top |
| `action` | `skillId, actionId` | skills | UI-KIT 8.4 for gathering nodes and recipes (quantity picker, plan line, Start/Stop) |
| `zone` | `tier, zoneId` | hunt | zone popup with projections and the amount picker |
| `foe` | `monsterId, { back = null }` | hunt | foe popup; `back` is `{ tier, zoneId }` to return to a zone popup |
| `class` | none | hunt | discipline picker (non-dismissible while choosing is possible) |
| `sell` | `key, from` | realm | list on the market: quantity, price each, what the 5% fee leaves you and what a buyer will be quoted (the fee is charged on both legs), `marketList` |
| `settings` | none | core | account and settings, Start over (`resetCamp`, danger confirm typing RESET) |
| `account` | `{ mode: "signin" | "create" }` | core | sign in / create account |
| `sky` | none | camp | today's weather and the week revealed on Sunday |
| `profile` | `username` | realm | a commander at a glance: face with the halo they wear, class and where, kills / sovereigns / falls, the amulet and the ring only, "Their page", "Invite to party". Opened from a roster name and the invite form's Look up; guests are sent to make an account |

### The anvil (pages/fortify.js)

Nothing is on it when you arrive and no essence is staked. A piece goes on by a
press or a drag from the Pieces rack; an essence or a charm goes into a socket
the same way, and a filled socket empties itself and every socket after it on a
press. The odds, a three-row window of the table centred on the level you are
reaching for, and the press sit under the circle in that order; the whole table
and what a level gains are behind the one `?`. Nothing on this page is kept in
the save.

## 7. Toasts (core's listeners.js; pages do not toast events)

Only live events toast (never replays or long catch-ups). Kinds from UI-KIT 6.3. Texts are short, no full stop:
- `skill:mastery` "Delving 20: Keen Eye" (good, sparkle); `skill:level` only when level % 10 === 0: "Delving reaches level 30" (good)
- `class:available`: `openPopup("class", ctx)`
- `task:ended`: stock "Out of materials" (warn), storage "Nowhere to put anything" (bad), limit "Batch finished" (good), cap "The crews stood down" (info)
- `item:crafted` uncommon and better: "Rare: Bog Sword" (epic and better gold, else info); `storage:full` "Nowhere to put Coal" (warn, once a minute at most)
- `bounty:complete` "Bounty complete" (gold, action View -> #/bounties); `bounty:paid` "Double experience for one hour" (gold)
- `agent:hired` "Agent hired: Silt"; `requisitions:returned` "Requisitions returned" (good)
- `item:enchanted` only on the take that reaches a halo: "Cairn Ring +9 wears the Veiled halo" (gold, sparkle); `item:converted` "+12 carried onto the Cairn Ring" (gold, sparkle). The rite's own result is stamped on the anvil, so a plain take or a refusal toasts nothing
- `travel:unlocked` "Gallowmoor unlocked" (gold); `companion:bought` "Veil Hound joins you" (good); `companion:bond` one per unlock "Veil Hound: +10% gold from kills" (good); `companion:found` "Veil Hound found" or on rank up "Veil Hound: Rank III" (good)
- `hunt:ended` limit "Hunt finished" (good), cap "The hunt stood down" (info); `hunt:death` "You fell" (bad); `hunt:sovereign` "The Drowned Bailiff comes up out of the dark" (bad); `hunt:felled` "Sovereign felled: Epic Blood Bow" (gold); `hunt:retreat` "You broke away" (warn); `hunt:hide` "Hiding for five minutes" (info); `loot:lost` "No room for loot" (warn); `loot:found` "Found: Rare Bog Helm" (gold); `item:broke` "Bog Helm broke" (bad)
- `store:rejected` the error (warn); `store:news` mail: "The post: 200g" or "The post: 12 Slag Ore" (gold); away: "Welcome back: away 3h 12m" (info); `party:spoils` "Your share: 4 kills, 1,210 XP, 96g" (gold, party icon, once a minute at most) and, on a fall, "You fell beside your party" (bad). `chronicle.js` writes no camp line for a share, so these toasts are the only word the player gets.
- Market command results are toasted by the page that sent them.

## 8. Hidden features (shell and pages)

- Requisitions (nav row, route, any link): `requisitionsOpen(state)`.
- Discipline and Veil anywhere (tags, stats, bars, class names): only when `state.player.klass`. The class picker opens on `class:available` and the Hunt page shows a "Choose your discipline" card while `canPickClass(state)`.
- Bench tiers: every tier whose level the skill has reached, plus the next one. Nothing further.
- Market, Party, Hiscores: always in the nav; guests get a sign-in prompt card instead of the page body.
- No Dungeons, no "coming soon" anywhere.

## 9. Shell (core)

- Nav rows per UI-REQUIREMENTS: The Vanguard (Character, Armaments `slotsUsed/slotCap` of Belongings, Companions), The Camp (Stockpile count, Bounties with a badge when claimable, Requisitions when open with deployments left, Shop, Sky), Trades and Artisans (skill rows with level and a working dot), The Field (Hunt with level and a dot while hunting), The Realm (Atlas, Market, Party with a badge for invites, Hiscores). Active row follows the route.
- Topbar: activity chips from `skillPlan(state)` and `combatPlan(state)` (UI-KIT 5 topbar states: idle, working, hunting, recovering, hiding), gold, health (`maxHp`), connection (`store.status`, `store.online`), settings opens `settings`. Stop buttons dispatch `stopSkill` / `pullBack`.
- Weather card: `weatherAt(now)`, the day's favoured and hindered skills, Bountiful Weekend when on, tomorrow when revealed.
- Banners (`#bannerDock`): guest ("Playing as a guest. Nothing is kept." with Create account and Sign in), offline (with Retry), outdated ("A new version of the camp is out." with Reload).
- Log dock (`#logDock`): the camp log (`state.log`, newest first, `fmtAgo(now - t)`), collapsed to the latest line on phones.

## 10. Debug hook

When the page URL has `?debug` or the dev server says so (`window.RESPITE_DEV === true`), `main.js` sets `window.__respite = { store, net, ctx, go }`. Tests use it to wait for sync and to drive the store directly.

## 11. Building a page before the core exists

`dev/page.html?page=<id>&arg=<skillId>&scenario=<fresh|midgame|crafter|hunter|rich>&mode=<guest|account>&party=1&popup=<name>&args=<json array>` mounts one page on a stub save inside the real shell markup (topbar and nav stay empty). `dev/stub.js` has the stub store, ctx and scenarios; add scenarios there if you need one (add, never change existing ones). Screenshot at 1440x900 and 390x844, check there is no horizontal overflow and no console error, and look at the screenshots.

## Core notes

Readings the core took where the text above left room. Additions only; nothing above changes.

- Reconcile "advances to now quietly" means up to the moment the predicted save had already reached (and was shown); the next live frame plays on from there. No stretch of time is told twice or skipped. Tested against an unbroken camp: the live event sequence is identical.
- A predictable command the rules refuse locally resolves with that refusal and is never sent.
- Server-only commands are never retried by the store. On a network failure or 500 they resolve `{ ok: false, error: "The realm can't be reached. Try again soon." }` (a lost answer may hide a finished buy); outdated and signed-out stores refuse them at once. A result of "The camp is still catching up." is not a refusal: the command is queued again and sent.
- Long gaps: a hidden tab does not advance the save. Back in view (or after a sleep), a gap up to 15 s plays live, up to 5 min plays quietly, and longer waits for the server (account mode, online; banner "Catching up"). While the save waits, predictable dispatches resolve `{ ok: false, error: "The camp is still catching up." }`. Guests and offline accounts catch up quietly in the tab; guests get an `away` news after 10 min.
- `store.status` also carries `catchingUp` (boolean). A 401 that survives one session refresh leaves `conn: "offline"`, `error: "unauthorized"` (banner "Signed out" with Sign in; signing in as the same player resumes the queue). Background retries while offline keep `conn: "offline"` until one gets through.
- `#tbConn[data-state]` uses the four styled states: `connecting` shows as `syncing`, `outdated` as `offline`; the text says "Connecting" or "Outdated". "Syncing" only shows for a request slower than 600 ms.
- Heartbeat, online count and party polling run only while the tab is visible, like the sync cadence. The first party read happens as soon as the camp loads (for the invite badge).
- Extra store members for main.js, the harness and tests (pages should not need them): `ready` (resolves when the first save is in), `whenIdle()`, `sync({ soft })` (resolves true when a request got through), `setVisible(bool)`, `watchParty(bool)`, `resume(session)`, `destroy()`, `halted` (`null | "outdated" | "unauthorized"`), `clock`.
- `window.__respite` has getters: signing in or out replaces `store` (and its bus), so read it fresh. It also has `hasProgress(state)`.
- `ctx.now` is `ctx.state.clock`; it holds while the save waits for the server. The shell's ctx (used for `settings`, `account` and `class`) reports the current page's route.
- Page modules: `group` and `title` may be strings or `(ctx) => string` and are re-read about once a second (breadcrumb and `document.title` follow). `visible(ctx)` is re-checked about once a second (false redirects to `#/character`), and the nav hides the row of a loaded module that says false (every page module is preloaded 1.5 s after boot). The camp log dock shows under Character by default; a module may export `log: true` or `log: false` to choose.
- Toasts: at most two per event type in four seconds; news that names one thing (a level, a mastery step, a find, a road, a Bond unlock, a rank) is told once a session. `class:available` opens the picker once per store. Refusal toasts drop the trailing full stop.
- Accounts: `net.onAuthChange(fn)` hears `{ event: "signed_in" | "signed_out", session, source: "local" | "auth" }`. A sign in from another tab replaces an account camp, never a guest's. A session the server refuses at boot signs out to a guest with a toast. `signIn` takes any password (v4 accounts); `signUp` checks the name and 6 or more characters first.
- For the harness: the game call is `fetch(url, { method, headers, body, cache: "no-store", signal })`; a 401 calls `auth.refreshSession()` when the fake has it, else `getSession()`; realtime `channel.on(...)` must return the channel, and `removeChannel` gets the object `client.channel()` returned. The market's reads are RPCs now (`market_browse`, `market_pools`, `market_sales_mine`), so the only table the Market page selects from is `market_listings`, filtered to the player's own rows.
- Engine 2, the party bonus: another member's hunt counts from `started_at` to the earliest of `ended_at ?? ends_by` and `last_seen + 3 minutes`, and a member with no `last_seen` lends nothing (the server's rule). `store.js` exports `huntInterval(member)`, `partyIntervals(party, selfId)`, `PRESENCE_MS` and `serverMs(timestamp)` (Postgres microseconds rounded half up, as the server rounds them); the store's env and `popups/zone.js` `partyHere` both use `huntInterval`. The prediction is tested to match a server applying the rule: no answer moves the Hunt XP.
- Engine 2, starting over: `resetCamp` always goes as a request of its own, after every command queued before it; commands made while it waits follow in the next request.
- A store turned away before its first save (outdated or signed out) answers every dispatch with that reason, not "The camp is still waking."
- Engine 2, health at camp: the topbar meter shows `campPlan(state, now).hp` when no hunt is out (the save keeps the health the hunter came back with). Pages that show health outside a hunt should read it the same way.
- `store:news` of type `mail:unknown` toasts "A letter held something the camp no longer knows" (warn).

## Party hunts on the pages

- **Starting one lives on the Party page**, in a "The party's hunt" card: a zone picker for the region you stand in and "Set out together", then "Join them" or "Break away" once the party is out. Not in the zone popup: that sheet is a lone hunter's projection of their own twelve hours from their own Satchel, it is opened by every player whether or not they have a party, and `partyHuntStart` refuses unless you are in one and nobody is out. Founding, inviting and leaving are already on the Party page, and it is the only surface that can see whether the party is out at all.
- **The zone popup** only learns to stop you: while you are out with the party its action reads "Out with your party" and is disabled, because `startHunt` is predictable and the server would otherwise refuse it after the press.
- **The Hunt page** shows the shared fight in the same `.arena` when `store.partyHunt` names this player. It runs no float or shake layer: those are drawn from `hunt:fx` events raised by the local simulation, and a shared fight has none, so the arena is quieter by design. KPIs become Encounters, Your damage, Party damage, Your share (the split a kill actually pays by) and Time out. A member who joined after an encounter had begun is in the session but not in that fight; the arena says "Waiting · In on the next encounter" and their band row reads "Waiting".
- **The Party page** asks `party_hunt_view()` only when `store.partyHunt` is empty: the answer to a game request already carries the fight you are out on, and the RPC is worth a request only for the one thing an answer can never say, which is that the rest of the party is out without you.

## The market, anonymous and pooled

- **Nobody is named, either way.** A listing's seller and a sale's buyer never leave the realm (migration 007), so no page can show a name beside a trade and none should try. The only listings the realm will tell a player about are their own: `market_browse` marks them with `mine`, and the My listings card reads them off `market_listings` directly. "Remove" is unchanged.
- **Materials are a pool, gear is not.** The Listings card draws `net.market.pools()` rows above `net.market.browse()` rows, and the column that held the seller holds the pool's price bands ("40 at 12g · 15 at 13g"; `.listing-depth`, beside the kit's `.listing-seller`). The tabs that are only pools (Materials, Remedies) hide the sort control, because a pool is always cheapest first.
- **A pool buy carries a ceiling.** The buy sheet walks the bands with `fillPool` from `src/shared/market.js`, the same rule the server fills by, and sends `marketBuyPool { key, qty, maxEach }` with the dearest price that walk reached. A short fill is normal and the toast says so. Without the ceiling a buyer who presses while somebody else drains the cheapest band would pay whatever was left in the book.
- **The fee is on both legs**, so every number a player is asked to agree to (`confirmSpend`) is the ask plus the market's cut, and the sell sheet shows both what the seller clears and what a buyer will be quoted.

## Owner's ordering rule

Every list of skills keeps each artisan in the same position as the trade it works from. Use `TRADE_ORDER`, `ARTISAN_ORDER` and `SKILL_ORDER` from registry.js; never `GameData.SKILLS` or `GameData.GATHER_SKILLS` order for display.
