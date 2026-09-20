# Respite v5 architecture contract

Reference implementation of the previous game (v4, classic scripts): the engine's parts are kept in `tests/ref-v4/` (data.js, utils.js, cloud.js, combat.js, engine.js); the rest is in git history before v5.
The v5 code is this repository.

Hard rules for every file:
- No em dashes (U+2014) or en dashes (U+2013) anywhere, including comments and strings.
- Vanilla JS, ES modules (`export`/`import`, relative paths with `.js` extensions). No bundler, no TypeScript in src/.
- `src/shared/**` must run unchanged in the browser, in Node 22 and in Deno 2: no DOM, no `window`, no `Date.now()` or `Math.random()` in game logic, no Supabase.
- Comments are short and say why, in the voice of the existing code.

## Layout

```
index.html                  <script type="module" src="src/client/main.js">
css/                        stylesheets
assets/                     images
src/shared/                 the game rules (browser + server)
  config.js                 CONFIG (deep-frozen constants and formula functions)
  registry.js               GameData (deep-frozen) + getters; built once from CONFIG
  lore.js                   item lore tables and itemLore()
  rng.js                    seeded randomness
  events.js                 createEmitter()
  items.js                  item keys, itemDef, itemName
  storage.js                StorageManager: pools and rollback transactions
  state.js                  createState(), migrateSave()
  stats.js                  levels, combat stats, mitigation
  progression.js            xp multipliers, addXp
  weather.js                weather by day
  companions.js
  skills.js                 skilling tasks, deterministic resolution
  combat.js                 the hunt engine
  world.js                  bounties, requisitions, shop, smuggler, travel, item actions, class
  chronicle.js              event listener that writes state.log lines
  engine.js                 tick(), advance(), applyCommand(), COMMANDS
  version.js                ENGINE_VERSION
src/server/handler.js       authoritative request handler (runs in Deno Edge Function, tested in Node)
src/client/...              browser: store, net, ui
supabase/schema.sql         run once in the Supabase SQL editor
supabase/migrations/        run by hand, in order, after schema.sql
supabase/functions/game/index.ts  Deno wrapper around src/server/handler.js
tests/                      node test suites (not deployed)
```

## Save state (schema 11)

ENGINE.md is the binding engine spec and adds to this shape: `rolls` (roll counters), `lootLostAt`, task ids and a hunt `rng`, and removes `meta.lastSeen` (use `clock`).

```js
{
  schema: 11,
  clock: 0,                         // ms timestamp the state has been simulated up to
  meta: { createdAt, playtimeMs, account, userId },
  player: { gold, hp, recoveryLeft, klass, skin },  // skin: a GameData.SKINS id or null, asked for once
  skills: { [skillId]: xp },        // xp may be fractional
  inv:   { slots, items: {key: qty}, order: [key] },   // Belongings; a remedy costs a slot a bottle here
  bank:  { slots, items, order },   // Stockpile (was Provisions)
  vault: { slots, items, order },   // Vault
  satchel: { slots, items, order }, // the Satchel: remedies only, and the only pool a fight reaches
  uid: 1,
  equipment: { weapon, offhand, head, chest, hands, feet, neck, ring },  // item keys or null
  mastery: { [gearLine]: points },  // weapon mastery, 0..CONFIG.masteryTable[100]; see mastery.js
  path: { [nodeId]: rank },         // the discipline's tree; see path.js
  tools: { [gatherSkillId]: toolBaseId },
  wear: { [itemKey]: n },
  tasks: { skilling: null | {...}, combat: null | {...} },
  region: "region_1",
  travel: { unlocked: ["region_1"] },
  companions: { owned: { [id]: { bond, rank, dupes } }, active: null },
  threat: { "tier:zone": 0..100 },
  settings: { hideSovereign: false },
  agents: [], requisitions: [], reqDay: 0,
  bounty: null, buff: null, smugglerBought: {},
  stats: { kills, actions, deaths, crafted, epics, goldEarned, bosses },
  log: [{ t, m }],                   // last 60
  rng: { seed: uint32, world: uint32 },
  serial: 1,                         // task serial counter
}
```

### What schema 10 and 11 add

Three systems, all of them read off the save alone:

- **A skin (11).** `player.skin` is a `GameData.SKINS` id (`drifter`,
  `outrider`) or null. It is a face and nothing else: no stat, no roll, no drop
  turns on it. It is drawn wherever a commander is -- the Character hero, the
  paperdoll, the arena, a party square -- from `assets/skin-<id>.webp`, falling
  back to `commander-default.webp`. A save that has never carried one is asked
  the next time the Character page opens, and `setSkin` refuses once set.
  Schema 10's `player.sex` is not read across, so every camp picks again.
- **Weapon mastery.** `mastery` holds points a gear line (`sword`, `shield`,
  `dagger`, `bow`, `staff`, and `greatsword`/`grimoire` once released). One kill
  teaches exactly one line -- the off-hand when anything is in it, the weapon
  otherwise -- with `CONFIG.mastery.perKill` of the Warfare XP the kill paid,
  before any multiplier, so no loadout earns faster than another and none earns
  twice. The bonus is a separate rule: every worn piece pays out its own line's
  level at `CONFIG.mastery.perLevel` on that line's stat (damage for a weapon,
  Defence for a shield), so a shield you are learning and a sword you are only
  carrying are both worth what they have learned. What a discipline may hold at
  all is `GameData.CLASS_WEAPONS`, filtered by `released`.
- **The path.** `path` holds a rank a node, for the ten nodes of the save's own
  discipline. Points come one every `CONFIG.path.pathPer` Hunt levels from the
  oath's level; a full tree costs more than Hunt 99 pays. `resetPath` hands them
  all back for gold. A save that spent more than it earned, or that holds another
  discipline's nodes, has those handed back at migration.

**Unreleased gear lines.** A `GameData.WEAPON_LINES` entry with
`released: false` is out of the world: its recipes and the components only it
wanted are pruned off the benches at registry build, `classWeapons()` filters it
out of every discipline so nobody may equip it, and the Mastery page and its
leaderboard do not list it. The `GameData.GEAR` entries stay, so a save holding
one still loads. `greatsword` and `grimoire` are shelved at present.

**Item keys** gained an optional enchantment on the end, `"+N"`, after the relic
prefix when there is one: `slag_sword|rare|c17.42|+7`. A piece carrying one is
unique whatever its rarity, so an enchanted Common is minted a uid and stops
stacking. Every key written before schema 10 reads as `+0`. `enchant` spends Veil
Essence of the piece's own band, one to three stones, at
`0.80 + 0.15 x (stones - 1) - 0.05 x level`; a failure takes the stones and
nothing else.

## Database contract (Supabase Postgres)

Existing table: `public.saves(user_id uuid primary key, username text, data jsonb, updated_at timestamptz)`.
The browser must no longer write it. Only the game function (a direct Postgres connection as the `postgres` role, bypassing RLS) writes it.

Tables to add (all `public`, RLS enabled on every one):

- `saves` gains `rev bigint not null default 0`, `engine int`, `clock bigint`.
  - RLS: authenticated may select their own row.
  - No insert, update or delete for `anon` or `authenticated`. Drop whatever old policies exist.
- `profiles`
  - Columns: `user_id uuid primary key`, `username text unique not null`, `total_level int not null default 0`, `levels jsonb not null default '{}'`, `skills jsonb not null default '{}'` (xp by skill), `last_seen timestamptz`, `activity jsonb not null default '{}'`, `created_at timestamptz default now()`, `updated_at timestamptz default now()`.
  - Select: any authenticated user.
  - Writes: only the server, plus the `heartbeat()` RPC.
- `hunt_presence`
  - Columns: `user_id uuid primary key`, `tier int not null`, `zone text not null`, `started_at timestamptz not null`, `ends_by timestamptz not null`, `ended_at timestamptz`, `updated_at timestamptz default now()`.
  - Server writes it. No direct client access; clients see it through `party_state()`.
- `market_listings`
  - Columns: `id bigint generated always as identity primary key`, `seller_id uuid not null`, `seller_name text not null`, `item_key text not null`, `item_base text not null`, `item_name text not null`, `item_kind text not null` (`material`, `gear` or `tool`), `item_tier int`, `rarity text`, `qty int not null check (qty > 0)`, `qty_left int not null check (qty_left >= 0)`, `price_each bigint not null check (price_each between 1 and 1000000000)`, `status text not null default 'open'` (check `open`, `sold`, `cancelled` or `expired`), `created_at timestamptz not null default now()`, `expires_at timestamptz not null`, `updated_at timestamptz not null default now()`.
  - Indexes: `(status, item_name)`, `(status, price_each)`, `(seller_id, status)`, and from migration 007 `(item_key, price_each, created_at, id) where status = 'open'` (the pool's aggregate and its fill read the same order).
  - Select: **own rows only** (migration 007: `seller_id = auth.uid()`). It was `status = 'open' or own`, which handed every signed in player every seller's name. Open listings reach a client through `market_browse()` and `market_pools()` instead.
- `market_sales`
  - Columns: `id bigint identity pk`, `listing_id bigint`, `seller_id uuid`, `buyer_id uuid`, `item_key text`, `item_name text`, `qty int`, `price_each bigint`, `fee bigint` (the seller's leg), `buyer_fee bigint not null default 0` (the buyer's, migration 007), `created_at timestamptz default now()`.
  - Select: **nobody** (migration 007: RLS on, no policy, no grant, as with `party_hunts`). Both sides are kept for moderation and for a traders board's distinct-counterparties gate, and neither side may read the other's id: `profiles` would turn a `user_id` into a name. A player reads their own trades through `market_sales_mine()`.
- `mail`
  - Columns: `id bigint identity pk`, `user_id uuid not null`, `kind text not null` (`gold` or `item`), `gold bigint not null default 0`, `item_key text`, `qty int not null default 0`, `note text not null default ''`, `created_at timestamptz default now()`, `claimed_at timestamptz`.
  - Select: own rows.
  - Index: `(user_id) where claimed_at is null`.
- `parties`
  - Columns: `id uuid primary key default gen_random_uuid()`, `name text not null` (check 1 to 24 chars), `leader_id uuid not null`, `created_at timestamptz default now()`.
  - Select: members only.
- `party_members`
  - Columns: `party_id uuid references parties(id) on delete cascade`, `user_id uuid not null unique`, `username text not null`, `joined_at timestamptz default now()`, primary key `(party_id, user_id)`.
  - Select: members of the same party.
- `party_invites`
  - Columns: `id bigint identity pk`, `party_id uuid references parties(id) on delete cascade`, `from_id uuid`, `from_name text`, `to_id uuid`, `to_name text`, `status text not null default 'pending'` (check `pending`, `accepted`, `declined` or `cancelled`), `created_at timestamptz default now()`.
  - Select: rows where the caller is the sender or the recipient.
- `party_messages`
  - Columns: `id bigint identity pk`, `party_id uuid references parties(id) on delete cascade`, `user_id uuid not null`, `username text not null`, `body text not null` (check `char_length(body) between 1 and 240`), `created_at timestamptz default now()`.
  - Select: members of that party.
  - No direct insert; use `party_say`.
- `party_hunts` (migration 006, not schema.sql): one row a party hunt session, the shared fight the server owns.
  - Columns: `id bigint identity pk`, `party_id uuid not null references parties(id) on delete cascade`, `tier int not null`, `zone text not null`, `members uuid[] not null default '{}'` (who it still owes a share), `session jsonb not null` (the `partyHunt.js` blob), `view jsonb not null default '{}'` (`sessionView(session)`), `clock bigint not null` and `started_at bigint not null` (world ms, like `saves.clock`), `next_due bigint`, `over boolean not null default false`, `over_at bigint`, `rev bigint not null default 0`, `created_at`, `updated_at`.
  - Indexes: unique `(party_id) where not over` (one live session a party), `(next_due) where not over` (what the tick reads), gin `(members)` (what a settlement reads), `(over_at) where over` (the sweep).
  - **No client access of any kind**: no grant, RLS on with no policy. The blob holds the encounter's seed and the dice position, so a client that could read it could play the fight forward and know the result. Clients read `party_hunt_view()` and nothing else.
  - Only the server writes it, and the tick does so from `POST .../functions/v1/game/tick` (docs/SERVER.md section 3).

Party size is at most 4 members.

RPCs are all `security definer`, `set search_path = public`, granted `execute` to `authenticated` only. They raise an exception with a short, human message on failure (for example `raise exception 'Only the party leader can invite.'`).

- `heartbeat(p_activity jsonb default null) returns void`: sets `profiles.last_seen = now()` (and `activity` when given) for `auth.uid()`. Does nothing if there is no profile.
- `online_count() returns int`: profiles with `last_seen > now() - interval '3 minutes'`.
- `hiscores(p_skill text default 'total', p_limit int default 50) returns table(rank bigint, username text, level int, xp numeric)`
  - `total`: order by `total_level` desc, then the sum of xp desc.
  - A skill id: order by that skill's xp desc; level comes from `levels->>skill`.
  - Clamp `p_limit` between 1 and 100.
- `party_create(p_name text) returns uuid`: the caller must have a profile and must not be in a party.
- `party_invite(p_username text) returns bigint`
  - Leader only. The target must exist, must not be the caller and must not be in a party.
  - Members plus pending invites must be under 4.
  - No duplicate pending invite to the same user from the same party.
- `party_cancel_invite(p_invite_id bigint) returns void`: leader only.
- `party_respond(p_invite_id bigint, p_accept boolean) returns void`
  - The invite must be to the caller and pending.
  - On accept: the caller must not be in a party and the party must have room. Insert the member and mark the invite accepted. Cancel any other pending invites to the caller.
- `party_leave() returns void`: removes the caller. If the leader leaves, the oldest remaining member becomes leader. If nobody is left, delete the party.
- `party_kick(p_user_id uuid) returns void`: leader only, and not themselves.
- `party_say(p_body text) returns bigint`
  - The body is trimmed, 1 to 240 chars, and the caller must be a member.
  - Rate limit: reject if the caller posted in that party less than 1.5 seconds ago.
  - Keep only the newest 200 messages per party (delete older ones).
- The market's three doors (migration 007). The market is anonymous by default both ways, so none of them selects a `seller_id`, a `seller_name` or a `buyer_id`, and the tables behind them answer about the caller's own rows alone.
  - `market_browse(p_q text default '', p_kind text default null, p_tier int default null, p_sort text default 'price', p_limit int default 50, p_offset int default 0) returns table(id, item_key, item_base, item_name, item_kind, item_tier, rarity, qty_left, price_each, created_at, expires_at, mine boolean)`: open, unexpired listings that are **not** materials, one row a listing, `price` or `newest` order, at most 100. `mine` is true on the caller's own and is the only thing here that says whose a listing is. `p_kind = 'material'` returns nothing: materials are a pool.
  - `market_pools(p_q text default '', p_tier int default null, p_limit int default 50, p_bands int default 8) returns table(item_key, item_base, item_name, item_kind, item_tier, qty_left bigint, price_min bigint, bands jsonb)`: every open material listing aggregated by item key, cheapest pool first. `bands` is the cheapest `p_bands` price bands as `[{ each, qty }]`, cheapest first. The caller's own listings are left out, because the pool is what they can buy.
  - `market_sales_mine(p_limit int default 50) returns table(id, side text, item_key, item_name, qty, price_each, fee, created_at)`: the caller's own trades, newest first. `side` is `sold` or `bought`, and `fee` is the caller's own leg of it.
- `party_hunt_view() returns jsonb` (migration 006): `sessionView()` of the live session the caller's party is on, or null. The only way a client reads `party_hunts`, and it selects the `view` column alone: no seed, no dice, no stat lines. The same value rides back on a member's own game request as `party`.
- `party_state() returns jsonb`
  ```
  { party: {id, name, leader_id} | null,
    members: [{user_id, username, joined_at, last_seen, activity, total_level, levels, hunt: {tier, zone, started_at, ends_by, ended_at} | null}],
    invites_in: [{id, party_id, party_name, from_name, created_at}],
    invites_out: [{id, to_name, created_at}],
    messages: [{id, user_id, username, body, created_at}] }   // newest 50, oldest first
  ```

Realtime: add `party_messages`, `party_members` and `party_invites` to the `supabase_realtime` publication if it exists. Guard with a DO block so the script also runs where it does not.

The script must be idempotent (safe to run twice): `create table if not exists`, `create or replace function`, and `drop policy if exists` before `create policy`.

## Game function protocol

`POST {SUPABASE_URL}/functions/v1/game` with `Authorization: Bearer <user access token>`, `apikey`, JSON body:

```
{ v: ENGINE_VERSION, commands: [{ id: "c1", type: "startSkill", args: {...}, at: 1789600000000 }] }   // at most 25 commands
```

Response:

```
{ ok: true, v, now, state, results: [{ id, ok, error?, data? }], events: [...], party? }
{ ok: false, error: "unauthorized" | "outdated" | "bad_request" | "server_error", v? }
```

`party` is `sessionView()` of the party hunt the caller is out on, and absent when they are not.

The handler runs one transaction:
1. Lock the save row (create a fresh one if none exists).
2. Migrate it.
3. Claim mail.
4. Lock the caller's party hunt rows.
5. For each command, advance the state to `clamp(at, state.clock, now)` and apply the command.
6. Advance to now.
7. Play those party sessions up to now and settle the caller's share out of each.
8. Write the save (`rev + 1`), the profile, the hunt presence and the party hunt rows.
9. Commit.

`POST .../functions/v1/game/tick` is a second door on the same function for the party hunt cron. It carries no user token: the shared secret `RESPITE_TICK_SECRET` goes in `x-respite-tick`, and it plays every live session forward.

## Commands (shared `applyCommand(state, {type, args}, env)` → `{ ok, error?, data? }`)

`startSkill {skillId, actionId, limit|null}`, `stopSkill {}`, `startHunt {tier, zone, limit|null}`, `pullBack {}`, `setHide {on}`, `pickClass {id}`, `setSkin {skin}`, `walkPath {node}`, `resetPath {}`, `enchant {key, from, stones}`, `equip {key, from}`, `unequip {slot}`, `unequipTool {skillId}`, `moveItem {key, from, to, qty}`, `sellItem {key, from, qty}`, `salvage {key, from}`, `useChest {key, from}`, `repair {key}`, `reorder {pool, key, before}`, `buyRemedy {key, qty}`, `buySmuggler {slot}`, `travel {regionId}`, `claimBounty {}`, `hireAgent {}`, `deployAgent {agentId, itemKey}`, `buyCompanion {id}`, `setCompanion {id|null}`.

Server-only commands, which need the database: `marketList {key, from, qty, price}`, `marketBuy {listingId, qty}` (gear and tools, one listing at a time), `marketBuyPool {key, qty, maxEach}` (a material out of the pool every seller's listing of it makes, cheapest first and oldest first among equal prices, never a unit above `maxEach`), `marketCancel {listingId}`, `partyHuntStart {tier, zone}`, `partyHuntJoin {}`, `partyHuntLeave {}`. The market's fee is taken off both legs (`CONFIG.economy.marketFee`): the buyer pays the ask plus it, the seller receives the ask less it, rounded up and never under 1 gold. The party's fight is played by the server alone (`src/shared/partyHunt.js`, `public.party_hunts`), so the browser cannot predict one and never tries: it draws what the server reports (docs/SERVER.md section 3).

## Events (shared emitter, `env.emit(type, payload)`)

- Skills: `skill:level`, `skill:mastery`, `task:ended`, `item:crafted`, `storage:full`
- Hunt: `hunt:ended`, `hunt:death`, `hunt:sovereign`, `hunt:felled`, `hunt:retreat`, `hunt:hide`, `hunt:passed`, `hunt:fx`, `loot:lost`, `loot:found`
- Items and companions: `item:broke`, `item:repaired`, `companion:bond`, `companion:found`, `companion:bought`, `companion:active`
- Camp: `bounty:complete`, `bounty:paid`, `agent:hired`, `agent:deployed`, `requisitions:returned`, `shop:bought`, `smuggler:bought`, `travel:unlocked`, `travel:moved`, `class:picked`, `class:available`, `class:laidDown`, `skin:picked`, `path:taken`, `path:reset`, `item:enchanted`, `chest:opened`, `item:salvaged`, `item:sold`, `item:moved`, `settings:hide`
- Market: `market:listed`, `market:bought` (`cost` is what left the purse, the fee included, and `fee` is that fee), `market:cancelled`, `mail:claimed`
- Sessions: `away`
- Party hunts (raised by the server when a share is settled, no camp log line of their own): `party:spoils { tier, zone, kills, xp, gold, drops, remedies, died }`. The events the settlement raises as it pays (`skill:level`, `loot:found`, `loot:lost`, `item:broke`, `companion:found`, `hunt:death`) are the rules' own and are logged as ever.
