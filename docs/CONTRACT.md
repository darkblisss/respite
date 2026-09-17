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
supabase/functions/game/index.ts  Deno wrapper around src/server/handler.js
tests/                      node test suites (not deployed)
```

## Save state (schema 9)

ENGINE.md is the binding engine spec and adds to this shape: `rolls` (roll counters), `lootLostAt`, task ids and a hunt `rng`, and removes `meta.lastSeen` (use `clock`).

```js
{
  schema: 9,
  clock: 0,                         // ms timestamp the state has been simulated up to
  meta: { createdAt, playtimeMs, account, userId },
  player: { gold, hp, recoveryLeft, klass },
  skills: { [skillId]: xp },        // xp may be fractional
  inv:   { slots, items: {key: qty}, order: [key] },   // Belongings; a remedy costs a slot a bottle here
  bank:  { slots, items, order },   // Stockpile (was Provisions)
  vault: { slots, items, order },   // Vault
  satchel: { slots, items, order }, // the Satchel: remedies only, and the only pool a fight reaches
  uid: 1,
  equipment: { weapon, offhand, head, chest, hands, feet, neck, ring },  // item keys or null
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
  - Indexes: `(status, item_name)`, `(status, price_each)`, `(seller_id, status)`.
  - Select: authenticated may read rows where `status = 'open'`, and all of their own rows.
- `market_sales`
  - Columns: `id bigint identity pk`, `listing_id bigint`, `seller_id uuid`, `buyer_id uuid`, `item_key text`, `item_name text`, `qty int`, `price_each bigint`, `fee bigint`, `created_at timestamptz default now()`.
  - Select: authenticated may read rows where they are the buyer or the seller.
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
{ ok: true, v, now, state, results: [{ id, ok, error?, data? }] }
{ ok: false, error: "unauthorized" | "outdated" | "bad_request" | "server_error", v? }
```

The handler runs one transaction:
1. Lock the save row (create a fresh one if none exists).
2. Migrate it.
3. Claim mail.
4. For each command, advance the state to `clamp(at, state.clock, now)` and apply the command.
5. Advance to now.
6. Write the save (`rev + 1`), the profile and the hunt presence.
7. Commit.

## Commands (shared `applyCommand(state, {type, args}, env)` → `{ ok, error?, data? }`)

`startSkill {skillId, actionId, limit|null}`, `stopSkill {}`, `startHunt {tier, zone, limit|null}`, `pullBack {}`, `setHide {on}`, `pickClass {id}`, `equip {key, from}`, `unequip {slot}`, `unequipTool {skillId}`, `moveItem {key, from, to, qty}`, `sellItem {key, from, qty}`, `salvage {key, from}`, `useChest {key, from}`, `repair {key}`, `reorder {pool, key, before}`, `buyRemedy {key, qty}`, `buySmuggler {slot}`, `travel {regionId}`, `claimBounty {}`, `hireAgent {}`, `deployAgent {agentId, itemKey}`, `buyCompanion {id}`, `setCompanion {id|null}`.

Server-only commands, which need the database: `marketList {key, from, qty, price}`, `marketBuy {listingId, qty}`, `marketCancel {listingId}`.

## Events (shared emitter, `env.emit(type, payload)`)

- Skills: `skill:level`, `skill:mastery`, `task:ended`, `item:crafted`, `storage:full`
- Hunt: `hunt:ended`, `hunt:death`, `hunt:sovereign`, `hunt:felled`, `hunt:retreat`, `hunt:hide`, `hunt:passed`, `hunt:fx`, `loot:lost`, `loot:found`
- Items and companions: `item:broke`, `item:repaired`, `companion:bond`, `companion:found`, `companion:bought`, `companion:active`
- Camp: `bounty:complete`, `bounty:paid`, `agent:hired`, `agent:deployed`, `requisitions:returned`, `shop:bought`, `smuggler:bought`, `travel:unlocked`, `travel:moved`, `class:picked`, `class:available`, `chest:opened`, `item:salvaged`, `item:sold`, `item:moved`, `settings:hide`
- Market: `market:listed`, `market:bought`, `market:cancelled`, `mail:claimed`
- Sessions: `away`
