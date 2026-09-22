# Respite v5 engine specification (src/shared)

Read `CONTRACT.md` first. This file is the precise API for the shared rules. The browser (prediction + UI), the server (authority) and the tests all import these modules, so names and semantics here are binding. Where this file and CONTRACT.md disagree, this file wins.

Reference implementation it was ported from: `tests/ref-v4/` (v4 classic scripts: engine.js, combat.js, cloud.js, utils.js, data.js). Behaviour must match v4 unless this file says otherwise. Already written and tested (do not rewrite, extend only if needed): `config.js`, `registry.js`, `lore.js`, `rng.js`, `events.js`, `format.js`.

## 0. Ground rules

- ES modules, relative imports with `.js`. Runs unchanged in browsers, Node 22 and Deno 2.
- No `Date.now()`, `new Date()` (except in format.js), `Math.random()`, `window`, `document`, `setTimeout`, `localStorage`, `console` in rules. Grep-enforced by a test.
- No em dash (U+2014) or en dash (U+2013) anywhere. Grep-enforced.
- Every function that reads or writes the save takes `state` explicitly as its first argument. There is no module-level mutable game state. Module-level caches of pure data (item defs, string hashes) are fine.
- Functions that announce things take `env` (usually last). Rules never format UI text except through `chronicle.js`.
- Header comment block on every file in the style of the existing ones: `Respite · file.js · The Name`, then a short paragraph. Comments short, saying why.
- Keep CONFIG and GameData frozen: never mutate them. Copy before changing (`{ ...def }`).

## 1. Time, randomness and slicing

- `state.clock` is the millisecond timestamp the save has been simulated to. It only moves forward, through `advance()`.
- World-clock rules use `state.clock` (or an explicit `at`): weather day, bounty window, smuggler window, requisition day, buff expiry.
- Integers: `advance(state, target)` floors `target`. Skilling `progress` and `elapsed` stay integral. Hunt timers may be fractional (v4 behaviour, EPS = 1e-6).

### 1.1 Rolls

Two sources, both from `rng.js`:

1. **Counter rolls** for anything worth money. `roll(seed, key, index, salt)` = `rollAt(seed, hashKey(key), index, salt)`, always called with `state.rng.seed`. Added to rng.js:
   ```js
   export function hashKey(key)            // hashString with a Map cache (cleared past 10,000 keys)
   export function roll(seed, key, index, salt) // rollAt(seed, hashKey(key), index, salt)
   ```
   and extend `SALT` (keep existing values): `drop: 10` (plus drop index), `rare: 30`, `rareRarity: 31`, `rarePick: 32`, `sovereignPick: 40`, `sovereignPrefix: 41`, `companion: 100` (plus companion index).
   Counters live in `state.rolls` (`{ [key]: n }`) and only grow when the thing happens (an action completes, a kill lands). A player cannot burn them, so knowing the seed gives no advantage. Keys:
   - `a:<actionId>`: completed actions of that action. Index = count before this action. Used for double yield (`SALT.double`), reagent (`SALT.reagent`), extra reagent (`SALT.reagentExtra`), crafted rarity (`SALT.rarity`), relic prefix (`SALT.prefix`), companion finds (`SALT.companion + i`, i = index in `GameData.COMPANIONS`).
   - `m:<monsterId>`: kills of that monster. Drops `SALT.drop + dropIndex`.
   - `k:<tier>`: kills on that tier's ground. Companion finds on kills (`SALT.companion + i`), rare find chance (`SALT.rare`), its rarity (`SALT.rareRarity`), which piece (`SALT.rarePick`).
   - `s:<tier>`: Sovereigns felled on that tier. Epic piece pick (`SALT.sovereignPick`).
2. **Streams** (mulberry32 state kept in the save) for flow that is not worth money:
   - The hunt: `state.rng.hunt`, seeded when the save is made as `hashString(`${seed >>> 0}:hunt`)`. Everything inside the encounter engine (timers, spawns, elites, crits, echo, bleed, stalwart, sovereign engage, gold per kill, which armour piece wears) draws from `makeRng(state.rng, "hunt")`, in exactly v4's order. It is one stream for the save, not one a hunt: it carries on across hunts, pulling back, moving ground and falls, and nothing reseeds it, so no free command can pick the next fight's dice. (Engine 1 seeded a stream per hunt from `state.serial`, which startSkill and hireAgent bump for nothing, so a client could try streams before setting out.) Projections keep their own seeded streams.
   - `state.rng.world` for command-time randomness: agent rarity and name on hire.

### 1.2 Item uids

Uncommon and better items are unique. Their uid is derived, never a global counter, so the same save gives the same keys however time is sliced:
- Crafted: `c<count>` where count is the `a:<actionId>` counter index, prefixed by the action so it is unique: `c<actionIndexInRegistry>.<count>` (for example `c17.42`). Use a stable index: position of the action in the concatenation of all CRAFT_ACTIONS lists in registry order.
- Rare find on a kill: `f<tier>.<count>` (k counter index).
- Sovereign epic: `s<tier>.<count>` (s counter index).
- Market purchase (server): `m<listingId>`.
- Old numeric uids from v4 saves stay as they are.
A uid never contains `|`.

### 1.3 Slice independence (required, tested)

For the same starting state and the same commands at the same clocks, the final state must be equal whether time is advanced in one call, in 5-second steps, or in random 1 to 1000 ms frames. "Equal" means: identical structure, keys, strings, booleans, integers, array lengths and log lines (including their `t`); non-integer numbers (hunt timers, Veil, Bond, fractional XP) within 1e-6 relative. Every integer outcome (kills, items, gold, levels, counters, uids) must match exactly. `advance()` achieves this by splitting at every boundary where one system's result can change another's (section 11).

Three rules make that hold (found while building it; each is tested by slices.test.mjs):
- **Hunt times are whole milliseconds.** Inside `huntStep` the time of anything that happens is `at0 + Math.round(c.elapsed - elapsedAtStart)`, and `huntStep` returns a whole-millisecond offset. The engine's own timers stay fractional (v4), but log `t`, event `at`, recovery, Bond time and `lootLostAt` are integers, so float drift between slicings can never move them.
- **Bond sits on a whole-millisecond grid.** `bond * CONFIG.companions.bondMs` is always an integer (bondStep adds whole milliseconds; migration snaps old values). Summing `dt / bondMs` in floats would reach a Bond threshold a millisecond late in some slicings, moving the level-up (and its speed or loot unlock and its log line).
- **A death starts recovery when it happens.** advance() takes `dt` off `recoveryLeft` at the start of a step; if the hunter dies inside that step, the rest of the step (`dt - huntRan`) is taken off the fresh recovery too (section 11). Without it a later `startHunt` could be refused in one slicing and allowed in another.

In practice the saves come out byte-identical as JSON; the 1e-6 tolerance is the contract.

## 2. items.js

```js
export function parseKey(key)                    // { base, rarity|null, uid|null, prefix|null }
export function makeKey(base, rarity, uid, prefix) // material: base; common gear/tool: "base|common"; uncommon+: "base|rarity|uid"; relic: "base|relic|uid|prefix"
export function stacks(key)                      // !uid
export function itemDef(key)                     // v4 itemDef, frozen, cached by base, rarity and prefix (the uid never changes a def; cleared past 20,000); null for unknown base
export function itemName(key)                    // v4 itemName (never throws: an unknown prefix falls back to the rarity name)
export function isRemedy(key)                    // itemDef(key)?.heal > 0
export function validKey(key)                    // strict: string <= 120 chars, known base, rarity valid for the kind (materials none; gear a RARITIES key; tools their bare base, which is how v4 crafted, stored and racked them, or a RARITIES key), uid present iff rarity is not common, uid matches /^[a-z0-9.]{1,24}$/i, relic has a valid prefix for the slot family (tools count as armour, as v4's rollPrefix did), nothing extra
export function rarityFromRoll(r)                // v4 rollRarity with r in [0,1)
export function fineRarityFromRoll(r)            // v4 rollFineRarity
export function prefixFromRoll(base, r)          // v4 rollPrefix
export function agentRarityFromRoll(r)           // v4 rollAgentRarity
export function craftIndex(actionId)             // stable registry index used in crafted uids
```
Materials include remedies (`provision_t*` ids stay for saves), reagents and `vault_chest`.

## 3. storage.js: StorageManager

Pools: `inv` (Belongings, 10 slots), `bank` (Stockpile, starts 30, widened by chests to 200), `vault` (Vault, 50), `satchel` (the Satchel, 4). A stack takes one slot, with two exceptions the Satchel brought in:

- `canHold(w, key)`: the Satchel takes remedies and nothing else. Enforced in the transaction layer, not just hidden in the UI.
- `unstacked(w, key)`: a remedy in Belongings costs a slot a bottle, so a bought lot sits as separate entries and the Satchel is where it gets tidy. `slotsNeeded` and `roomFor` do that arithmetic; `placeFor` takes the quantity for the same reason.

The Satchel is the only pool a fight can reach (`ORDER.eat`). A remedy anywhere else is dead weight until it is packed.

```js
export const POOLS = ["inv", "bank", "vault", "satchel"];
export const ORDER = Object.freeze({
  loot:     ["inv", "vault", "bank"],   // hunt drops, finds, Sovereign pieces
  material: ["bank", "vault", "inv"],   // gathered and crafted materials, requisitions, smuggler
  gear:     ["inv", "bank", "vault"],   // crafted gear
  tool:     ["bank", "vault", "inv"],   // crafted and unequipped tools
  remedy:   ["inv"],                    // a remedy bought lands in Belongings; the hunter packs the Satchel
  spend:    ["bank", "vault", "inv"],   // paying costs
  eat:      ["satchel"],                // remedies a fight can reach, best heal first
  mail:     ["inv", "bank", "vault"],
});
export const orderFor = (key) => ...     // remedy -> remedy, gear -> gear, tool -> tool, else material

export const canHold = (w, key)          // satchel: remedies only
export const unstacked = (w, key)        // inv + remedy: a slot a bottle
export function slotsNeeded(state, w, key, qty)
export function roomFor(state, w, key, qty)
export function slotCap(state, w)        // inv/satchel: CONFIG.storage.slots[w], bank/vault: state[w].slots
export function slotsUsed(state, w)
export function isFull(state, w)
export function qtyIn(state, w, key)
export function haveQty(state, key)
export function heldEverywhere(state)    // { key: qty }
export function orderedKeys(state, w)    // v4 orderedKeys
export function placeFor(state, key, order) // pool already holding the stack, else first pool in order with a free slot, else null
export function canPay(state, cost)      // v4 canAfford
export function stockCovers(state, cost) // v4 stockCovers (Infinity when no cost)
export function transact(state, fn)      // see below
```

`transact(state, fn)` runs `fn(tx)`. Every mutation made through `tx` is journaled. If `fn` calls `tx.fail(msg)` (which throws an internal TxFail) or returns `false`, every journaled change is undone in reverse order and the result is `{ ok: false, error: msg }` (for `false`: "That can't be done."). Otherwise `{ ok: true, value }`. Any other exception rolls back and rethrows. Nested `transact` on the same state joins the outer journal: an inner refusal undoes only the inner changes (a savepoint), an outer refusal undoes the inner ones too. The journal of the running transaction is found through a WeakMap keyed by the state, emptied when the outermost call returns; it holds nothing between calls. Changes made without `tx` inside `fn` are not journaled.

Also exported: `isPool(w)` and `poolName(w)` (the on-screen name from CONFIG).

`tx` methods (all return what they placed or took, and fail instead of partially applying):
```js
tx.add(w, key, qty)            // into one pool; fails "<Pool> is full." if no stack and no free slot
tx.stash(key, qty, order?)     // placeFor with order (default orderFor(key)); fails "Nowhere to put <name>." ; returns pool
tx.remove(w, key, qty)         // fails "Not enough <name>." if the pool holds fewer
tx.spend(key, qty, order?)     // across pools in ORDER.spend; fails "Not enough <name>."
tx.pay(cost)                   // spends every key of a cost map; fails on the first shortfall
tx.gold(delta, earned?)        // fails "Not enough gold." if player.gold would drop below 0; earned=true also adds to stats.goldEarned
tx.set(obj, prop, value)       // journaled assignment (restores old value or deletes the prop)
tx.del(obj, prop)
tx.push(arr, value)
tx.splice(arr, start, count, ...items)
tx.fail(msg)
```
Items maps delete keys that reach 0 and the order array drops them (v4 removeFrom). Adding appends to `order` if missing. All quantities are positive integers; non-integers or <= 0 throw (a programming error, not a player error).

## 4. stats.js

```js
export function levelFromXp(xp)            // v4
export const xpForLevel = (level) => CONFIG.xpTable[level]
export function skillLevel(state, id)
export function totalLevel(state)
export function bondLevelFrom(bond)        // v4
export function equipStat(equipment, stat)
export function hasPrefix(equipment, id)
export function classDef(id)               // getClass(id) || null
export function combatStats(loadout)       // v4 combatStats; loadout { level, klass, equipment } required
export function statsOf(state)             // combatStats of the save's own loadout
export function maxHp(state)
export function mitigation(defence, tier)  // v4
export function canPickClass(state)
export function recovering(state)          // player.recoveryLeft > 0
export function myClass(state)             // classDef(state.player.klass)
export function levelsOf(state)            // { [skillId]: level }, for profiles and hiscores
export function xpProgress(state, id)      // { level, xp, base, next, maxed, toNext, pct } for XP bars
```

## 5. weather.js

All take a millisecond timestamp. Same tables and seeds as v4 (sky identical for everyone).
```js
export const dayIndex = (ms) => Math.floor(ms / CONFIG.time.dayMs)
export const weekdayOf = (dayNum) => ...
export const weekStartOf = (dayNum) => ...
export const isBountiful = (dayNum) => ...
export function weatherForDay(dayNum)       // v4 object
export function weatherAt(ms)               // weatherForDay(dayIndex(ms))
export function weekForecast(ms)            // v4
export function tomorrowRevealed(ms)
export const windowIndex = (ms) => Math.floor(ms / CONFIG.time.windowMs)
export const windowEndsIn = (ms) => CONFIG.time.windowMs - (ms % CONFIG.time.windowMs)
export const nextDayAt = (ms) => (dayIndex(ms) + 1) * CONFIG.time.dayMs
```

## 6. progression.js

```js
export function xpMult(state, skillId, at)          // weather at `at`, Bountiful Weekend at `at` (trades only), companion xp bonus, bounty buff if state.buff.until > at
export function partyMult(env, tier, zone, at)      // 1 + min(cap, perMember * members whose interval covers `at` on the same tier and zone). env.party = { intervals: [{ tier, zone, start, end }] } or null
export function xpEach(state, skillId, amount, at)  // Math.max(1, Math.round(amount * xpMult))
export function addXp(state, skillId, gain, env, at)// adds (fractions allowed); returns true on a level; emits skill:level {skillId, level}; gathering skills on a MASTERY_TRACK level also emit skill:mastery {skillId, level, label}; warfare levels set player.hp to maxHp and, if canPickClass, emit class:available {}
export function mastery(state, skillId)             // { double }
export function toolFor(state, skillId)             // tool def or null
export function speedMod(state, skillId)
export function actionTime(state, def)
export function doubleChance(state, skillId)
export function xpBreakdown(state, skillId, at)     // { weather (the day), weatherPct, bountiful, companion, buff, mult }: xpMult part by part, for chips
```
`partyMult` counts an interval when `start <= at && (end == null || at < end)`; the server passes the other members' hunts only.

## 7. companions.js

v4 section 12 with explicit state.
```js
export function companionOf(state, id)
export function activeCompanion(state)               // def or null
export function companionInfo(state, id)
export function companionBonus(state, kind, skillId)
export function bondStep(state, ranMs, env, at)      // active companion gains ranMs / bondMs (ranMs = how long a task actually ran inside the step), on the whole-ms grid: bond = (round(bond * bondMs) + round(ranMs)) / bondMs; emits companion:bond {id, level, unlocks: [text]} per level reached
export function nextBondIn(state)                    // whole ms of running time until the active companion's next Bond level (at least 1); Infinity if none or maxed
export function companionFinds(state, source, rollKey, index, env, at) // source: a skill id or "warfare". For each owned companion (registry order, index i) that turns up from this source and is below max rank: roll(seed, rollKey, index, SALT.companion + i) < findChance -> dupes++, maybe rank up; emits companion:found {id, rank, dupes, need, rankUp}
export function buyCompanion(state, { id }, env)     // command
export function setCompanion(state, { id }, env)     // command, id null leaves everyone at camp
```

## 8. skills.js: deterministic task runner

Task shape: `{ id, skillId, actionId, progress, done, elapsed, limit, startedAt }` (`id` from `state.serial++`, `startedAt` = clock).

```js
export function startSkill(state, { skillId, actionId, limit }, env)
```
- `skillId` must be a gathering or artisan skill, `actionId` one of its actions, level >= def.level ("Needs <Skill> <level>."), `limit` null or an integer 1..100000.
- Costs: `stockCovers >= 1` or fail "Not enough materials.".
- Room: something must be placeable (v4 roomFor, using `placeFor` per output; gear needs a free slot in ORDER.gear) or fail "Nowhere to put anything.".
- The same action already running keeps its `progress` (v4). Starting replaces any other skilling task silently. Returns `{ ok: true }`.
```js
export function stopSkill(state, _args, env)          // { ok: true } even if idle (idempotent)
export function nextSkillDue(state)                   // ms until the next completion or the 12h cap; Infinity when idle
export function resolveSkilling(state, dt, env, at0)  // see below; returns dt, or the offset inside the step at which the task ended
export function skillPlan(state)                      // v4 skillPlan (UI)
export function actionMax(state, def)                 // v4 actionMax (UI)
```

`resolveSkilling(state, dt, env, at0)` (no while loops, no guards):
1. `time = actionTime(state, def)`; `budget = Math.min(dt, idleCap - task.elapsed)`.
2. `due = Math.floor((task.progress + budget) / time)`; bounded by `limit - done` when limited.
3. For `i` in `0..due-1`: completion offset `max(0, (i + 1) * time - task.progress)`, `at = at0 + offset` (an action already overdue because the crews got quicker, a tool or a Bond speed unlock, lands at once). Run one action inside `transact`: pay cost, produce (section 8.1). If the cost can't be paid: end with reason `stock`. If the outputs have nowhere to go: end with reason `storage` (the action is not paid). After each action: `done++`, `stats.actions++`, XP via `xpEach(..., at)` and `addXp`, bounty progress, companion finds, and `a:<actionId>` counter++.
4. If the task is still running: `progress = progress + budget - due * time`, `elapsed += budget`; if `elapsed >= idleCap` end with reason `cap`; if `done >= limit` end with reason `limit` (check limit right after the action that reached it, as v4).
5. Ending emits `task:ended { skillId, actionId, reason, done, elapsedMs }` and clears `tasks.skilling`.

Because speed can change mid-task (a companion Bond level with a speed unlock, a tool change by command), `advance()` never lets a Bond level-up happen inside one `resolveSkilling` call (section 11), so `time` is constant within a call.

### 8.1 produce (v4 produce, with counter rolls)
- Gathering output: `qty = out[k]`, doubled if `roll(a-key, n, SALT.double) < doubleChance`. Placed with `tx.stash(key, qty)`.
- Reagent alongside: `roll(..., SALT.reagent) < reagentChance * (1 + reagentBonus)` then stash 1. Reagent node with a companion reagent bonus: `roll(..., SALT.reagentExtra) < reagentBonus` then stash 1. Reagents are placed after the action's transaction has gone through; one that can't be placed is skipped with a `storage:full { key }` event (not a task end), matching v4's "Nowhere to put".
- Events inside an action are emitted only once it has gone through, so a rolled-back action never writes a log line.
- Crafted material or tool: stash with its order.
- Crafted gear: rarity `rarityFromRoll(roll(..., SALT.rarity))`, relic prefix `prefixFromRoll(base, roll(..., SALT.prefix))`, key via `makeKey(base, rarity, uid, prefix)` with the derived uid; stash in ORDER.gear. `stats.crafted++`, epic and better `stats.epics++`, emit `item:crafted { key, rarity, skillId }`.
- If the main output can't be placed the whole action rolls back and the task ends with `storage`.

## 9. combat.js: the hunt

Port v4 combat.js sections 1 to 8 (see ref) with these changes.

Hunt task: v4 `newHunt` fields plus `id` (`state.serial++`) and `startedAt` = clock. It has no stream of its own (1.1). `c.clock` stays the encounter-local clock as in v4.

```js
export const EPS = 1e-6
export function threatKey(tier, zone)
export function threatIn(state, tier, zone)
export function foeNumbers(mob, elite)
export function foeTitle(mob)
export function pickWeighted(pairs, rng)
export function newHunt(state, tier, zone, limit)     // v4 newHunt + id + startedAt (increments state.serial)
export function startHunt(state, { tier, zone, limit }, env)
export function pullBack(state, _args, env)           // writes the camp's note and ends the hunt; { ok: true } and no change when not hunting (idempotent, like stopSkill)
export function campPlan(state, at = state.clock)     // { hp, maxHp, walkMs }: what a hunt setting out from camp at `at` starts with; null while a hunt is out
export function setHide(state, { on }, env)           // emits settings:hide {on}
export function combatPlan(state)                     // v4 combatPlan (UI)
export function stepHunt(ctx, dt)                     // v4 engine, unchanged semantics; its loop guard is 200000 + ceil(dt) passes (v4's flat 200000 could trip on one twelve-hour call, and never trips in projections)
export function nextHuntDue(state)                    // ms until the hunt's next event (0 if something is due now); Infinity when idle
export function huntStep(state, dt, env, at0)         // plays the live hunt for dt; returns dt, or the whole-ms offset inside the step at which the hunt ended
export function projectOnce(tier, zone, opts), projectHunt(tier, zone, opts), summariseRuns(results, horizonMs)   // v4, pure (opts.stats required)
export function huntOddsOpts(state, tier, zone)       // v4 huntOddsLater's opts (stats, remedies, hide, threat, xpMult at state.clock, runs 3, horizonMs)
export function oddsSignature(opts, tier, zone)       // v4 sig string, so the UI can cache
export function bestRemedy(state)                     // v4 bestFood: best heal, then ORDER.eat; returns the key (the hunt spends it from the pool it was found in)
export function remedyHeals(state)                    // v4
export function wearPct(state, key), repairCost(state, key)
export function repair(state, { key }, env)           // command; spends ORDER.spend, deletes the wear entry; emits item:repaired {key}
export function applyWear(state, rng, env, at)        // v4 applyWear; returns true when something broke; the armour piece pick uses the hunt stream
export function damageItem(state, key, amount, env, at) // v4; a piece that breaks leaves its slot and its wear entry is deleted (v4 set it to 0); emits item:broke {key}
export function huntPresence(state)                   // { tier, zone, startedAt, endsBy } or null, for hunt_presence rows
```

`startHunt` validation: tier's region unlocked ("That ground isn't open."), zone id valid, `limit` null or integer 1..100000, not recovering ("You're still recovering."). Then: the same tier and zone keeps the fight and restarts the count (v4). Moving ground keeps health (v4) and must not skip the walk: the new hunt's first `wait` is `max(searchMinMs, what is left on the old ground)`, which is `c.wait` when searching or hiding and `zone.windowMs - c.clock` in a fight. Setting out from camp reads the camp's note (below) and uses it up.

**The camp's note** (engine 2). `state.player.camp` is `{ since, hp, walkUntil }` or null. A hunt that ends alive (pullBack, `limit`, `cap`) writes it at the moment it ended: `state.clock` for pullBack, the `at` of `hunt:ended` otherwise. `hp` is `state.player.hp` then. `walkUntil` is when the walk in progress would have ended: `since + c.wait` when searching or hiding, `since + max(searchMinMs, zone.windowMs - c.clock)` for a fight broken off (a limit reached mid-fight counts as one). A hunt that sets out from camp at `clock` starts with `wait = max(searchMinMs, walkUntil - clock)` and `player.hp = min(maxHp, hp + maxHp * (clock - since) / CONFIG.hunt.recoveryMs)`, so health is whole again after five minutes at camp, and the note becomes null. No note (a fresh camp, a v4 save, or after a fall, which clears it because the fall already costs its recovery) means full health and a `searchMinMs` walk, as before. `pickClass` at camp raises the note's `hp` to the new most, keeping v4's refill. Nothing new is logged. `walkUntil` is an absolute time in fractional milliseconds (never rounded, so slicing can't move it). Why: in engine 1, pulling back and setting straight out after an encounter swapped the 30 to 60 s walk for 3 s and a full heal (the review measured gold and items an hour going from 5,028 to 13,122, Sovereign epics from 1.0 to 3.66 an hour). hunt.test.mjs plays that trick for an hour and gets exactly the plain hunt's kills, gold, health and stream.

`huntStep(state, dt, env, at0)` builds the live ctx (v4 `liveHunt`) and runs `stepHunt`. The current simulated time inside the step is `at0 + Math.round(c.elapsed - elapsedAtStart)` (whole ms, section 1.3); pass it as `at` to everything that needs a time. Payload durations (`elapsedMs`, `fightMs`) are rounded to whole ms too. Hooks:
- `rng`: `makeRng(state.rng, "hunt")`.
- `fx(who, kind, amount)`: `if (env.fx) env.emit("hunt:fx", { who, kind, amount, at })`.
- `note`: replaced by specific hooks and events: `met` emits `hunt:sovereign {monsterId}` when one comes, `passed` emits `hunt:passed {tier, zone}`, `hid` emits `hunt:hide {tier, zone}`, `retreated` emits `hunt:retreat {monsterId|null, fightMs}`. Projections count met, hid and retreated exactly as v4 did.
- `remedy`: `bestRemedy` then `transact` spend 1 from the pool it sits in; returns heal.
- `gainXp(amount)`: `gain = amount * xpMult(state, "warfare", at) * partyMult(env, tier, zone, at)`; `c.xp += gain`; `addXp`; refresh stats on a level.
- `gainGold(n)`: `Math.round(n * (1 + companionBonus(state, "gold")))` via `tx.gold(n, true)`.
- `killed(mob, elite)`: `stats.kills++`, bounty slay progress, drops (below), companion finds on `k:<tier>`, `applyWear` (refresh on break), then `m:<id>` and `k:<tier>` counters++.
- Drops: for each `mob.drops[j] = [key, qty, chance]`: `roll(seed, "m:"+id, n, SALT.drop + j) < chance * (1 + companionBonus("drops"))` then stash `qty * (elite ? ELITE.drops : 1)` in ORDER.loot. Rare find: `rare = companionBonus("rare")`; if `roll(k-key, n, SALT.rare) < rare`, rarity `fineRarityFromRoll(SALT.rareRarity)`, piece from GEAR of the mob's tier (registry order) by `SALT.rarePick`, uid `f<tier>.<n>`, relic prefix from `SALT.prefix` on the same key; emit `loot:found {key}` if placed.
- Nowhere to put loot: at most once per 10 minutes of clock (`state.lootLostAt`), emit `loot:lost {key}`.
- `sovereignDown(mob)`: `stats.bosses++`, `stats.epics++`, epic piece from GEAR of that tier by `roll(s-key, n, SALT.sovereignPick)`, uid `s<tier>.<n>`, stash ORDER.loot, `s:<tier>`++, emit `hunt:felled { monsterId, key|null, fightMs }`.
- `died(mob)`: v4 (tasks.combat = null, deaths++, hp = maxHp, recoveryLeft = recoveryMs, death wear on worn pieces), and `player.camp = null`; emit `hunt:death { monsterId, elapsedMs }`.
- `ended(reason)`: write the camp's note at `at`, then tasks.combat = null; emit `hunt:ended { reason, kills, elapsedMs }`.
- `retreated`, `hid`, `met`: emit the events above.

`nextHuntDue(state)` must return exactly v4 `untilNext` (and 0 when `fireDue` would do something), so `advance()` can cut other systems at hunt events if it needs to. Keep v4's EPS handling.

## 10. world.js: camp commands and queries

Every command returns `{ ok: true, data? }` or `{ ok: false, error }` and changes nothing on failure (use `transact`). Validate every argument's type and range; the server passes untrusted input straight in.

- Bounty (v4 section 9, world window from `state.clock`): `makeBounty(state, windowIdx)`, `refreshBounty(state)` (re-post when the window or region changed), `bountyProgress(state, kind, thing, env, at)` (emits `bounty:complete {}` once when it completes), `claimBounty(state, _args, env)` (gold earned, `state.buff = { until: clock + BOUNTY_BUFF.ms, mult: BOUNTY_BUFF.mult }` with the exported `BOUNTY_BUFF = { ms: 1h, mult: 2 }`, emits `bounty:paid { gold }`). Commands never settle the world clock themselves (a refusal must change nothing); advance() does, even when called with a target equal to the clock (section 11).
- `currentRegion(state)` (getRegion of state.region).
- Requisitions (v4 section 10): `requisitionsOpen(state)` true when any unlocked region has tier >= 2. `hireAgent` and `deployAgent` fail "Requisitions open once you reach tier 2 ground." when closed. `hireAgent(state, _args, env)` (world stream for rarity and name, drawn in that order; id `agent_<serial>`; emits `agent:hired {id, name, rarity}` and returns the same as data), `deployAgent(state, { agentId, itemKey }, env)` (itemKey must be in `requisitionTargets`; qty `requisitionQty(agent)` = `max(1, round(12 * agentRarityDef(rarity).mult))`, exported; emits `agent:deployed {agentId, name, itemKey, qty}`), `requisitionsLeft(state)` (deployments left today), `resolveRequisitions(state, env, at)` (runs when the world day changes; stashes with ORDER.material; emits `requisitions:returned { lines: [{ key, qty, placed }] }` when any were pending), `requisitionTargets(state)`.
- Shop: `shopStock(state)` (every remedy, `{ key, price }`, as v4 sold them; see the note below), `smugglerStock(state)` (v4, window from clock, plus `bought` flag), `buyRemedy(state, { key, qty }, env)` (qty integer 1..1000, price * qty, stash ORDER.remedy all-or-nothing, emits `shop:bought {key, qty, price}` with price the total), `buySmuggler(state, { slot }, env)` (slot integer 0..2; emits `smuggler:bought {key, qty, price}`; drops `smugglerBought` tags of other windows, which can never be bought again).
  - Deviation: this spec first said the Bonesetter leaves out the remedies flagged `smuggler` (Leviathan Blood, Godsbane Elixir). v4 never used that flag: its shop sold all six and its Smuggler never sells remedies, so filtering would leave the two best remedies with no source at all. v5 keeps v4: all six at the Bonesetter.
- Travel: `travel(state, { regionId }, env)` (a move to a different region stands the bench down and pulls back from the hunt first) (toll when locked, emits `travel:unlocked {regionId, toll}`, then `travel:moved {regionId}` when the region actually changes; refreshBounty).
- Items (v4 section 13, explicit state): `equip(state, { key, from }, env)` (tools emit `tool:equipped {key}`), `unequip(state, { slot }, env)`, `unequipTool(state, { skillId }, env)`, `moveItem(state, { key, from, to, qty }, env)` (qty null = whole stack; emits `item:moved`), `sellItem(state, { key, from, qty }, env)` (emits `item:sold {key, qty, gold}`; when no copy of the key is left in any pool or worn, its wear entry goes too), `useChest(state, { key, from }, env)` (emits `chest:opened {slots}`), `reorder(state, { pool, key, before }, env)` (moves key in the pool's order before `before`, or to the end when null; silent). `displacedBy(state, key)` (what equipping key would push out, for the item popup). Equipping and unequipping gear emit nothing (v4 said nothing). Where something goes follows `placeFor(state, key, order, qty, { grow })`: with `grow` (the default) a stack already held grows where it is, before the preferred pool is tried (v4 tried the preferred pool first); with `grow: false` the order is taken at its word and the first pool with room wins. The bench, the ground and the hunt all place with `grow: false`, so gathered stock lands in the Stockpile and a hunt's takings gather in Belongings whatever is stacked elsewhere. `sweepToVault(state, from = "inv")` moves everything that is not gear, a tool or a remedy out of a pool and into the Vault, as much as fits, and never fails; `pullBack`, a hunt ending and a death all call it. Breaking gear down is gone: no `salvage`, no `salvageValue`, no `item:salvaged`.
- Class: `pickClass(state, { id }, env)` (health refills; at camp the camp's note `hp` too; emits `class:picked {id}`). Engine 3: anything already worn that the discipline may not hold (`GameData.CLASS_WEAPONS`, checked by `classHolds`) is laid down into Belongings first, in one transaction, and emits `class:laidDown {keys, id}`; with nowhere to put a piece the oath refuses and nothing moves. `equip` refuses an armed line the discipline does not hold; armour is never restricted.
- The skin (engine 3): `setSkin(state, { skin }, env)` sets `player.skin` once, to a `GameData.SKINS` id, and refuses afterwards. Nothing a fight reads depends on it; emits `skin:picked {skin}`. Drawn from `assets/skin-<id>.webp` by `portraitImg` in client/ui/widgets.js, falling back to `commander-default.webp`.
- Weapon mastery (engine 3, `mastery.js`): `addMastery(state, amount, equipment)` credits the lines in `weapon` and `offhand` with `amount * CONFIG.mastery.perKill`; `combat.js` calls it through `ctx.gainMastery(base)` on every kill with the kill's base XP, before any multiplier, and `partyHunt.js` banks the same figure in `owed.mastery` for the server to settle. `masteryMods(equipment, bag)` is what `combatStats` folds in: `{ attack, defence }`, each `1 + CONFIG.mastery.perLevel * level` for the line held in that slot.
- The path (engine 3, `path.js`): `walkPath(state, { node }, env)` takes one rank (emits `path:taken {node, rank}`), `resetPath(state, _args, env)` hands every point back for `CONFIG.path.respecGold` apiece (emits `path:reset {points, gold}`). `pathMods(klass, bag)` is what `combatStats` folds in beside gear; `combatStats` also answers `tech`, the multiplier `playerSwing` puts on a full Veil.
- Fortifying (engine 6, schema 13): `enchant(state, { key, from, stones, charm }, env)` where `from` is a pool or the equipment slot the piece is worn in, and only an amulet or a ring is taken (`canFortify`; every other base reads and writes as `+0`). The stone is `essenceOfTier(def.tier)`, the charm `charmOfTier(def.tier)`; the chance is `enchantChance(level, stones, charm)` = `min(1, stones x stoneWorth / thresholds[level])`, x`charmMult` with a charm; the roll is `roll(seed, "ench", state.rolls.ench, SALT.enchant)`, so the next attempt's number is fixed before the stake is chosen. Success mints `makeKey(base, rarity, uid, prefix, plus + 1)` (a uid of `e<n>` when the piece had none); failure spends the stones and the charm and changes nothing else. Emits `item:enchanted {key, was, won, stones, charm, level, halo}` (`halo` only on the attempt that reaches one: `haloOf(level)`) and returns `{ ok, data: { won, key, level, stones, charm, halo } }`. `enchantPlan(state, key)` is everything a page needs about one piece.
- Converting (engine 6): `convert(state, { from: {key, at}, to: {key, at} }, env)` carries a worked piece's whole level onto an unworked piece of the same slot (`convertPlan` says why not otherwise) for `convertToll(level, toKey)`: `goldPerLevelSq x level^2` gold and `essencePerLevel x level` Essence of the new piece's band. Nothing is rolled. The new piece is minted as for a take; the old goes to `+0`, and a Common minted for the Veil goes back to its pile. Emits `item:converted {key, was, from, wasFrom, level, gold, stone, essence, halo}` and returns `{ ok, data: { key, from, level, gold, essence } }`.

## 11. engine.js

```js
export function makeEnv({ emitter, party = null, fx = false } = {})   // { emit(type, payload), party, fx }; emitter null gives a silent env
export function advance(state, target, env)
export function applyCommand(state, cmd, env)   // cmd { type, args }; unknown type -> { ok: false, error: "Unknown command." }; server-only types -> { ok: false, error: "That needs the server." }
export const COMMANDS                           // { [type]: { run(state, args, env), predict: boolean } }
export const SERVER_ONLY = ["marketList", "marketBuy", "marketBuyPool", "marketCancel",
                            "partyHuntStart", "partyHuntJoin", "partyHuntLeave"]
export function awaySnapshot(state)             // { held: heldEverywhere(state), gold }
export function summariseAway(before, after, ms) // { ms, gains: [{ key, qty }], gold } from two awaySnapshot()s; emit it yourself as "away" (emit from events.js)
```
`COMMANDS` also holds the three server-only types with `predict: false` (their `run` refuses with "That needs the server."). `applyCommand` treats `args` that are not a plain object as `{}`, and lets exceptions from a command propagate (after its transaction has rolled back) so the server can abort the whole request.

Every emitted payload gets `at` (defaults to `state.clock`) and `state` (the save it happened in) added by the `emit(state, env, type, payload)` helper, exported from events.js so every module can use it. Listeners must not mutate `payload.state` except the chronicle.

`advance(state, target, env)`:
```
target = Math.floor(target)
resolveRequisitions and refreshBounty (world day or window may have changed); done even when target <= clock, so a command applied right after advance(state, state.clock) sees a settled world
if target <= state.clock: return
loop while state.clock < target:
  running = tasks.skilling || tasks.combat
  next = target
  if tasks.skilling and tasks.combat: next = min(next, clock + nextSkillDue)    // hunt and bench share storage: interleave at every completion
  if running and an active companion: next = min(next, clock + nextBondIn)      // Bond levels change speed, double and reagent bonuses
  if requisitions pending: next = min(next, nextDayAt(clock))                   // unconditional: the log line carries the time
  next = min(next, (windowIndex(clock) + 1) * windowMs)                          // bounty re-posts
  if buff && buff.until > clock: next = min(next, buff.until)
  dt = next - clock
  recoveryLeft = max(0, recoveryLeft - dt)
  huntRan = tasks.combat ? huntStep(state, dt, env, clock) : 0      // first clamp player.hp to maxHp (v4 combatTick); returns dt, or the offset the hunt ended at
  if the hunter died in that step: recoveryLeft = max(0, recoveryLeft - (dt - huntRan))   // recovery runs from the fall (section 1.3)
  if !tasks.combat && player.hp > maxHp: player.hp = maxHp
  skillRan = tasks.skilling ? resolveSkilling(state, dt, env, clock) : 0   // returns dt, or the offset the task ended at
  ran = max(huntRan, skillRan)
  if ran > 0: bondStep(state, ran, env, clock + ran); meta.playtimeMs += ran
  clock = next
  if buff && buff.until <= clock: buff = null
  resolveRequisitions / refreshBounty when the day or window changed
```
Hunt before bench at equal times. When only a hunt runs, `huntStep` takes the whole `dt` (event-exact inside). When the bench runs alone, `resolveSkilling` takes the whole `dt` (maths, no per-action stepping of time). Bond accrues only for time a task actually ran, so a hunt that dies three hours into a twelve-hour step earns three hours of Bond however the time is sliced.

Commands are applied between `advance` calls, so a caller that wants a command at time T calls `advance(state, T, env)` then `applyCommand`.

`applyCommand` never advances time. The caller advances to the command's time first.

Predictable commands: `startSkill, stopSkill, startHunt, pullBack, setHide, pickClass, setSkin, walkPath, resetPath, enchant, convert, equip, unequip, unequipTool, moveItem, sellItem, useChest, repair, reorder, buyRemedy, buySmuggler, travel, claimBounty, hireAgent, deployAgent, buyCompanion, setCompanion`.

## 12. market.js (shared halves of the server-only commands)

The server handler owns rows, locks and mail. These helpers own the save side so the rules stay in one place:
```js
export function prepareListing(state, { key, from, qty, price }, env)
  // validates (validKey, pool, qty integer 1..qtyIn, price integer 1..CONFIG.economy.marketMaxPrice, item tradeable: not equipped, kind material/gear/tool, and no wear: a key with wear > 0 is refused "Repair it before you list it."), removes the items in a transaction
  // (the wear rule, engine 2: a buyer's copy is reminted under a new uid with no wear entry, so a nearly broken relic used to come back new)
  // returns { ok, error?, data: { key, base, name, kind, tier, rarity, qty, priceEach } }; emits market:listed {key, qty, priceEach}
export function applyPurchase(state, { key, qty, cost }, env)   // gold -cost, stash(key, qty, orderFor(key)); all or nothing; emits market:bought {key, qty, cost}
export function applyReturn(state, { key, qty }, env)           // stash back; fails "No room to take it back."; emits market:cancelled {key, qty}
export function applyMail(state, letters, env)             // letters [{ id, kind, gold, item_key, qty, note }]; claims in order: gold letters always (earned); item letters (ORDER.mail) until one has nowhere to go, after which later item letters wait too (gold letters behind it still claim); an item letter the camp can't take (key failing validKey, such as a retired id, qty not a safe integer >= 1, or a unique key with qty other than 1) is claimed with nothing placed, whether or not the post is blocked, so it can never hold up the batch; a gold letter with no safe amount is left unclaimed; returns { claimed: [ids], gold, items: [{key, qty}] }; emits mail:claimed {gold, items, count} when anything claimed (count includes empty letters), then mail:unknown {count} once when any letter was claimed empty
export function marketFee(total)                           // Math.floor(total * CONFIG.economy.marketFee), at least 1 when total >= 1... use Math.max(total > 0 ? 1 : 0, Math.floor(total * fee))
export function remintKey(key, listingId)                  // unique items get uid "m<listingId>"; stackables unchanged
```

## 13. chronicle.js

```js
export function chronicleLine(type, payload)    // string | null, the camp log line
export function attachChronicle(emitter)        // on("*"): line = chronicleLine; if line, push { t: payload.at, m: line } to payload.state.log; keep the last 60
```
Lines are v4's `say()` texts with Provisions renamed to the Stockpile (see v4 engine.js and combat.js). Events that were toast-only in v4 (`item:crafted` below legendary, `bounty:complete`, `hunt:sovereign`, `loot:found`, `skill:mastery`) return null here; the browser toasts them. `companion:found` had both a say() and a toast in v4: the line is kept ("A second X has been trailing you. ..."), the toast is the browser's. `hunt:fx`, `item:moved`, `item:sold`, `travel:moved`, `settings:hide`, `class:available` and `companion:active {id: null}` return null. `storage:full` writes v4's "Nowhere to put X.".
v5-only lines: `market:listed` "Listed N × X at Pg each.", `market:bought` "Bought N × X on the market for Pg.", `market:cancelled` "N × X came back from the market.", `mail:claimed` "The post brought ...", `mail:unknown` "A letter held something the camp no longer knows." (once per claim, however many), `away` v4's catch-up line "Away 3h 0m: 300 Slag Ore, 12g." (first four gains, gold last).

## 14. state.js

```js
export function createState({ now, seed, userId = null, account = null })   // schema 9, clock = now, meta.createdAt = now, rng { seed: seed >>> 0, world: hashString(`${seed >>> 0}:world`), hunt: hashString(`${seed >>> 0}:hunt`) }, player.camp null, rolls {}, serial 1, lootLostAt null, log [{ t: now, m: "You take command of a ruin." }], hp at its most, reqDay = dayIndex(now) (not 0: a deployment made before the first advance would otherwise come back at once), and the bounty posted
export function migrateSave(raw, { now, seed, userId, account, legacy = false })   // returns a schema 9 state
```
`migrateSave`:
- null or garbage: `createState`.
- `legacy: true` (engine 2) says the row was written by a v4 browser and never saved by the v5 server; the server passes it for a `saves` row whose `engine` is null. v4 browsers wrote `saves.data` directly, so such a row can hold anything: it takes the v4 path below whatever `raw.schema` claims (a row dressed as schema 9 gets no say over its clock, dice, counters or serial), and it is held to the legacy limits in the invariants below.
- Schema 9, not legacy: normalise types defensively (the server trusts nothing), keep clock.
- Older (v4 schema up to 8, which already includes the v4 migration chain in ref/cloud.js `migrate`), or legacy: port v4 `migrate` (economy, tasks, hunt, companions, belongings) with `lastSeen = min(raw.meta.lastSeen || now, now)` as the stamp (a browser clock that ran ahead is pulled back to now, in the engine, before any step uses it), then:
  - `clock = lastSeen`; delete `meta.lastSeen`.
  - `rng`: new from `seed` (`world` and `hunt` with it); `rolls: {}`; `serial`: 1; `lootLostAt: null`; `player.camp: null` (v4 kept no note, so the first hunt sets out whole as it did).
  - Skilling task: keep if its action still exists and the level allows it; give it `id` (serial++), integer `progress`/`elapsed`, `startedAt = clock`; drop `queued`.
  - Hunt task: v4 rules, plus an `id` (from `newHunt`, or `serial++`); any `rng` a row carries is dropped.
  - Any save without a `satchel` gets one packed once: remedies move in best heal first, every stack of a kind merging into its one slot, while slots last. Log once: "Remedies are carried in the Satchel now. N stacks were moved." when any moved. Idempotent, so it covers both v4 saves and schema 9 saves written before the Satchel existed.
  - Numeric uids stay. Equipment keys that no longer resolve are dropped.
  - The steps copy the pools and the tasks before changing them in place and only read the rest, so `raw` is never written to (migrate.test.mjs migrates deep-frozen v4 saves).
- Always: clamp hp to maxHp, drop unknown pools' items whose key has no def, cap log at 60.
- Every save, whatever its schema, is then rebuilt field by field from checked values (never by copying objects, so no `__proto__` key reaches a prototype), and the input object is never mutated. In detail: pool items need `validKey` (every key v4 ever minted passes) and a whole quantity of at least 1, capped at 1e12 (250,000 for a legacy save), order deduplicated and completed; gold a whole number 0..1e15 (0..5,000,000 for a legacy save); equipment keys must resolve to gear of that slot; tools must be tools of that skill; companions clamped and Bond snapped to the whole-millisecond grid; hunts are checked value by value (tier, zone, phase, kind, foes of that tier, marks, next mark just ahead) and dropped when unplayable; a skilling task needs its action and level; `serial` is raised above every task id and agent number so no id is handed out twice; `rng.hunt` kept when it is a uint32, otherwise from the seed; a missing bounty is posted. `userId` and `account` from the options replace the save's when given.
- The invariants (engine 2). Every save, legacy or not, comes out holding what play itself never breaks:
  - A unique key (one with a uid) is held once across equipment, tools and the three pools, with qty 1: what is worn wins, then Belongings, the Stockpile, the Vault. (Tools are racked as bare ids, so they never hold one.)
  - A pool keeps at most its slot count of stacks (Belongings 10, the Stockpile `bank.slots`, the Vault `vault.slots`), in the player's order and then the save's; the rest is dropped. In a v4 save this happens after `settleBelongings` has moved what it can. A piece dropped as overflow is not held, so its copy in a later pool stays.
  - `wear` only for keys still held or worn. (Play keeps to this too: selling or salvaging the last copy, a break and a repair delete the entry.)
  - A two-handed weapon leaves no offhand.
  - `bounty` and `bountyBoard` postings take kind, target, label, amount and gold from `makeBounty` for their region and window; the save keeps only `progress` (while kind and target match) and `claimed`.
  - `requisitions`: unresolved errands only, by agents on the roster, one an agent, three at most, for an item in `requisitionTargets`, with `qty = requisitionQty(agent)` and the agent's name. `reqDay` is at most today.
  - `buff`: `until` at most `clock + BOUNTY_BUFF.ms`, `mult` at most `BOUNTY_BUFF.mult`.
  - Skilling `progress` at most `max(1000, def.time)`, the longest that action ever takes.
  - A hunt holds at most 3 foes (the most any encounter holds), each with `max` from `foeNumbers` and `hp` no more than that, and a Sovereign only in its own fight, once.
  - `player.camp` only while no hunt is out: `since` a whole ms up to the clock, `hp` 0..1e9, `walkUntil` within `since - 1 .. since + 5 minutes`.
  - Legacy only: gold to 5,000,000 and a stack to 250,000 (above), and a unique piece whose uid is not v4's all digits is dropped (v4 numbered its pieces; a hand-written `c1.0` could meet a uid v5 derives later).
  For a legacy save, if anything in that list was clamped or dropped, one line is logged at the save's clock: "Your old camp's ledger didn't add up. N entries were set right." ("1 entry was set right." for one; N counts each clamp or drop once). Junk that was never an item or a number, stale wear and v4's own migration notes are not counted, so an honest v4 save gets no line unless it is past a limit or out of slots. Sound saves go through unchanged, so migrating a migrated save gives the same save.
- Linear time (engine 2): every pass is one loop over the save with Sets and Maps, never `includes`, `find` or spread inside a loop, and nothing is cloned whole. A hostile 40,000-key legacy row migrates in about 100 ms, first call (perf.test.mjs holds it under 300 ms; engine 1 took 15 to 23 s).

## 15. version.js

`export const ENGINE_VERSION = 2;` Bump when a rules change would make an older browser predict differently.

Engine 2 (the security review): one persistent hunt stream, `state.rng.hunt` (1.1); the camp's note `state.player.camp` with the walk and rest owed after a hunt ends alive, and the walk kept when moving ground (9); `migrateSave(raw, { legacy })`, the save invariants, legacy limits, the ledger line and linear time (14); `prepareListing` refuses worn pieces, `applyMail` claims letters it can't take empty and emits `mail:unknown` (12, 13); wear entries go with the last copy (9, 10). New exports: `campPlan` (combat.js), `BOUNTY_BUFF` and `requisitionQty` (world.js).

## 16. Tests (tests/engine, plain `node file.test.mjs`, same style as registry.test.mjs: prints "<n> passed", exits 1 on failure)

1. `purity.test.mjs`: no `Date.now|Math.random|window\.|document\.|setTimeout|localStorage|console\.` in src/shared except format.js's `new Date`; no U+2013/U+2014 in the repo.
2. `parity.test.mjs`: load ref v4 scripts in a `vm` context (stub DOM, toast, render, setTimeout) and compare: itemDef/itemName for every key shape of every base; combatStats for a spread of loadouts; mitigation; actionTime/speedMod/doubleChance with tools and companions; weather for 60 days; weekForecast; makeBounty for 20 windows and regions; smugglerStock for 20 windows; shopStock; repairCost; companionInfo/companionBonus; requisitionTargets; xpMult (weather, bountiful, buff) at fixed times. And **projectHunt/projectOnce must equal v4 exactly** for at least 12 loadout x zone x hide cases (same seeds).
3. `storage.test.mjs`: placement orders, full pools, stacking, transaction rollback of every tx method (state deep-equal before/after), nested transactions.
4. `skills.test.mjs`: counts, limits, stock and storage stops, cap at 12h, XP by weather day boundaries inside a long advance, doubles/reagents deterministic, gear rarity keys and uids, events emitted.
5. `hunt.test.mjs`: the scenarios ported from v4's browser hunt checks (disciplines, reinforcements, Sovereign engage/hide/retreat, death, limits, cap, XP marks, loot order, wear and breaking, remedies) against the new API. Engine 2: the camp's note after pull back, limit and cap, rest and walk on setting out, moving ground mid-walk and mid-fight, a fall leaving no note, an hour of pulling back after every encounter matching the plain hunt exactly; the hunt stream carried across hunts, pull backs and falls, and startSkill and hireAgent before setting out leaving the fight blow for blow the same.
6. `slices.test.mjs`: build a busy state (Lv 40 Mage in a tier 5 region Inner zone with remedies, hide on, an active companion with Bond near a level, a crafting task consuming a stack that runs out mid-way, a gathering alternative, pending requisitions crossing a day boundary, a buff expiring, a bounty window crossing). Advance 12 hours: once; in 5,000 ms steps; in random 1..1000 ms steps (seeded); and with commands applied at fixed clocks in all three. The final states must be equal by the rule in 1.3 (in practice their JSON is identical), command results and event times too. Also advance 1 ms at a time for the first 20 seconds, and a death inside one long step.
7. `commands.test.mjs`: every command's success path and each refusal (and that refusals leave the state deep-equal), argument validation with junk types. Engine 2: worn listings refused, letters the camp can't take claimed empty (alone, in a batch of 100, behind a full post), wear going with the last copy.
8. `migrate.test.mjs`: build v4 saves by running the ref engine in a vm (fresh, mid-craft, mid-hunt, recovering, with spoils from schema 7, overfull Belongings, remedies in Provisions, relic items with numeric uids) and check the schema 9 results. Engine 2: legacy rows dressed as schema 9, the clock pulled back, uniques deduplicated, slot caps after settling, legacy clamps and uids, wear, postings, errands, fights, progress, buff and offhand set right with the ledger count, the camp's note, and deep-frozen inputs.
9. `perf.test.mjs`: a Lv 80 Warrior in tier 9 Core with remedies, plus a crafting task, advanced 12 hours in one call must finish under 1,500 ms in Node. A 40,000-key legacy save (every key in Belongings, spread over the pools, dressed as schema 9, schema 7 with spoils, and the server's own save reloaded) migrates in under 300 ms each.
10. `deno-smoke.mjs`: imports engine.js, creates a state, applies startSkill and startHunt, advances an hour, prints a summary. Run with `npx deno run --allow-read tests/engine/deno-smoke.mjs` from tools (deno is installed there).
11. `run-all.mjs` runs every `*.test.mjs` (registry included) and the Deno smoke when Deno is found (`DENO=/path/to/deno`, or ../tools beside the repo). `harness.mjs` holds the shared harness, the deep comparison with tolerance, the v4 vm loader and a listening env.

## 17. UI query index

Every function v4's ui.js called that reads game state or derives game numbers, with where it lives now. v5 functions take the save explicitly; anything that depends on the time takes a millisecond timestamp (the browser passes its predicted now, which is `state.clock` right after `advance(state, now, env)`). The UI never writes the save: everything it changed directly in v4 is a command (end of this section).

### Levels, stats and the hunter
- `skillLevel(id)` -> `skillLevel(state, id)` -> stats.js
- `totalLevel()` -> `totalLevel(state)` -> stats.js
- XP bars (v4 read `XP_TABLE` inline) -> `xpProgress(state, id)` -> stats.js (`{ level, xp, base, next, maxed, toNext, pct }`)
- `levelFromXp(xp)`, `bondLevelFrom(bond)` -> same names -> stats.js
- `combatStats()` -> `statsOf(state)` -> stats.js; for any loadout `combatStats({ level, klass, equipment })` -> stats.js
- `maxHp()` -> `maxHp(state)` -> stats.js
- `mitigation(defence, tier)` -> `mitigation(defence, tier)` -> stats.js
- `myClass()` -> `myClass(state)` -> stats.js
- `canPickClass()` -> `canPickClass(state)` -> stats.js (the `class:available` event says when it becomes true)
- `recovering()` -> `recovering(state)` -> stats.js (time left is `state.player.recoveryLeft`)
- `classDef(id)` -> `classDef(id)` -> stats.js (or `getClass(id)` -> registry.js)

### Storage
- `slotCap(w)` -> `slotCap(state, w)` -> storage.js; `packSlots()` -> `slotCap(state, "inv")`
- `slotsUsed(w)` -> `slotsUsed(state, w)` -> storage.js
- `storeFull(w)` -> `isFull(state, w)` -> storage.js
- `qtyIn(w, key)` -> `qtyIn(state, w, key)` -> storage.js
- `haveQty(key)` -> `haveQty(state, key)` -> storage.js
- `orderedKeys(w)` -> `orderedKeys(state, w)` -> storage.js
- `store(w)` -> read `state[w]` (`bank` is the Stockpile); names from `poolName(w)` -> storage.js
- `stockCovers(def)` -> `stockCovers(state, def.cost)` -> storage.js; `canAfford(cost)` -> `canPay(state, cost)` -> storage.js
- where a new thing would land -> `placeFor(state, key, order?)`, `orderFor(key)`, `ORDER` -> storage.js
- `heldEverywhere()` -> `heldEverywhere(state)` -> storage.js

### Weather and the world clock
- `dayIndex()` -> `dayIndex(ms)` -> weather.js
- `weekStartOf(day)` -> `weekStartOf(dayNum)` -> weather.js
- `currentWeather()` -> `weatherAt(ms)` -> weather.js
- `weatherOn(offset)` -> `weatherForDay(dayIndex(ms) + offset)` -> weather.js
- `weekForecast()` -> `weekForecast(ms)` -> weather.js
- `tomorrowRevealed()` -> `tomorrowRevealed(ms)` -> weather.js
- `currentWindow()` -> `windowIndex(ms)` -> weather.js
- `windowEndsIn()` -> `windowEndsIn(ms)` -> weather.js
- `serverClock()` -> `fmtClock(ms)` -> format.js

### Work, XP and speed
- `mastery(id)` -> `mastery(state, skillId)` -> progression.js
- `toolFor(id)` -> `toolFor(state, skillId)` -> progression.js
- `actionTime(def)` -> `actionTime(state, def)` -> progression.js
- `doubleChance(id)` -> `doubleChance(state, skillId)` -> progression.js
- `xpMult(id)` -> `xpMult(state, skillId, at)` -> progression.js
- `xpEach(id, amount)` -> `xpEach(state, skillId, amount, at)` -> progression.js
- ui.js `xpMods(id)` (the XP chips) -> `xpBreakdown(state, skillId, at)` -> progression.js, with `activeCompanion(state)` for the companion's name; the party chip is `partyMult(env, tier, zone, at)` -> progression.js
- `isTrade(id)`, `isGather(id)` -> same names -> registry.js
- `skillPlan()` -> `skillPlan(state)` -> skills.js
- `actionMax(def)` -> `actionMax(state, def)` -> skills.js

### Companions
- `activeCompanion()` -> `activeCompanion(state)` -> companions.js
- `companionInfo(id)` -> `companionInfo(state, id)` -> companions.js
- `companionBonus(kind, id)` -> `companionBonus(state, kind, skillId)` -> companions.js
- `companionOf(id)` -> `companionOf(state, id)` -> companions.js

### The hunt
- `combatPlan()` -> `combatPlan(state)` -> combat.js
- `threatIn(tier, zone)` -> `threatIn(state, tier, zone)` -> combat.js
- `foeNumbers(mob, elite)`, `foeTitle(mob)` -> same names -> combat.js
- `huntOddsLater(tier, zone, done)` -> `projectHunt(tier, zone, huntOddsOpts(state, tier, zone))` -> combat.js; keep the answer while `oddsSignature(opts, tier, zone)` is unchanged; to paint first, run `projectOnce(tier, zone, { ...opts, seed: 7 + i * 7919 })` one run per frame and sum with `summariseRuns(runs, opts.horizonMs)`, exactly as v4 did
- `remedyHeals()` -> `remedyHeals(state)` -> combat.js; the next remedy taken -> `bestRemedy(state)` -> combat.js
- `wearPct(key)` -> `wearPct(state, key)` -> combat.js
- `repairCost(key)` -> `repairCost(state, key)` -> combat.js
- `combatFx` and `fx()` (the arena's floaters) -> `makeEnv({ emitter, fx: true })` -> engine.js, then listen for `hunt:fx { who, kind, amount, at }`
- where the hunt is for party presence -> `huntPresence(state)` -> combat.js
- (v5) health and first walk for a hunt setting out from camp -> `campPlan(state, at)` -> combat.js. At camp `state.player.hp` stays at what you came back with; show `campPlan(state, now).hp` to let it fill over five minutes. null while a hunt is out.

### The camp
- `currentRegion()` -> `currentRegion(state)` -> world.js
- `refreshBounty()` -> nothing to call: advance() keeps `state.bounty` current (the rule is `refreshBounty(state)` -> world.js)
- `requisitionTargets()` -> `requisitionTargets(state)` -> world.js
- `REQUISITIONS_PER_DAY - pending` -> `requisitionsLeft(state)` -> world.js; the page and nav entry show when `requisitionsOpen(state)` -> world.js
- `shopStock()` -> `shopStock(state)` -> world.js
- `smugglerStock()` plus `state.smugglerBought[...]` -> `smugglerStock(state)` -> world.js (each lot carries `bought`)
- ui.js `displacedBy(def)` -> `displacedBy(state, key)` -> world.js

### Items and tables
- `itemDef(key)`, `itemName(key)`, `parseKey(key)`, `stacks(key)` -> same names -> items.js; `validKey(key)`, `isRemedy(key)` -> items.js
- `itemLore(def)` -> lore.js
- `skillDef(id)` -> `getSkill(id)`, `regionById(id)` -> `getRegion(id)`, `zoneDef(id)` -> `getZone(id)`, `companionDef(id)` -> `getCompanion(id)` -> registry.js; `skillName`, `gatherSkillDef`, `findAction`, `actionsFor`, `actionOutput`, `regionOfTier`, `getMonster`, `foesOf`, `sovereignOf`, `benchGroupOf`, `rarityDef`, `prefixDef`, `agentRarityDef`, `stratumOf` keep their names -> registry.js
- `GATHERED_BY`, `MADE_BY`, `USED_IN`, `DROPPED_BY` -> `itemSources(baseId)` -> registry.js
- v4 constants (`XP_TABLE`, `IDLE_CAP_MS`, `THREAT_CAP`, `MAX_FOES` ...) -> `CONFIG` -> config.js; tables (`ZONES`, `CLASSES`, `COMPANIONS` ...) -> `GameData` -> registry.js
- `fmt`, `fmtTime`, `fmtGold`, `fmtWhole`, `fmtStat`, `fmtAgo`, `signedPct`, `chancePct`, `titleCase`, `clamp` -> format.js (no state)

### Time
- `tick(dt)`, `loop()`, `catchUp(...)` -> `advance(state, now, env)` -> engine.js
- the "Away ..." line -> `before = awaySnapshot(state)`; `advance(...)`; `emit(state, env, "away", summariseAway(before, awaySnapshot(state), ms))` (emit from events.js) -> engine.js

### State the UI read directly, and what changed
`state.player.gold`, `hp`, `recoveryLeft`, `klass`; `state.tasks.skilling` and `state.tasks.combat` (both now carry `id`); `state.player.camp` (the camp's note, 9; read it through `campPlan`); `state.equipment`, `state.tools`, `state.settings.hideSovereign`, `state.bounty`, `state.buff` (compare `until` with the predicted now, not the wall clock), `state.requisitions`, `state.agents`, `state.travel.unlocked`, `state.region`, `state.stats` (`bosses` is always there), `state.bank.slots`, `state.skills`, `state.meta.account` and `state.log` read as before. `state.meta.lastSeen` is gone (use `state.clock`); log `t` values are simulated times, so show `fmtAgo(now - t)`. `state.rolls`, `state.serial`, `state.lootLostAt` and `state.rng` are for the rules only.

### What the UI changed directly in v4, and the command now
`startSkillTask` -> `startSkill {skillId, actionId, limit}`; `stopSkillTask` -> `stopSkill {}`; `startHunt` -> `startHunt {tier, zone, limit}`; `pullBack` -> `pullBack {}`; the Hide checkbox (`state.settings.hideSovereign = x`) -> `setHide {on}`; ui.js `pickClass` -> `pickClass {id}`; `equipItem` -> `equip {key, from}`; `unequip` -> `unequip {slot}`; `unequipTool` -> `unequipTool {skillId}`; `moveItem` -> `moveItem {key, from, to, qty}`; `sellItem` -> `sellItem {key, from, qty}`; `useChest` -> `useChest {key, from}`; `repairItem` -> `repair {key}`; ui.js `reorder` (`store(w).order = ids`) -> `reorder {pool, key, before}`; `buyShop(key, price, n)` -> `buyRemedy {key, qty}`; `buySmuggler(entry)` -> `buySmuggler {slot}`; `travelTo` -> `travel {regionId}`; `claimBounty` -> `claimBounty {}`; `hireAgent` -> `hireAgent {}`; `deployAgent` -> `deployAgent {agentId, itemKey}`; `buyCompanion` -> `buyCompanion {id}`; `setCompanion` -> `setCompanion {id|null}`. ui.js's own `say()` lines (discipline chosen) now come from the command's event through the chronicle; its Hide lines are gone (`settings:hide` has no line, 13).

### Events, for toasts and redraws
- Payloads carry `at` and `state` (the live save): never serialise a payload whole.
- `hunt:fx` only reaches listeners when the env was made with `fx: true` (the browser's arena); the server runs without it.
- Toast-only (no log line): `item:crafted` below Legendary, `bounty:complete`, `hunt:sovereign`, `loot:found`, `skill:mastery`, `class:available`. Toast and log line: `companion:found`, `companion:bond`, `storage:full`, `loot:lost`, `item:broke`, and every event with a line in 13.
- A jump of several levels emits one `skill:level` with the final level (v4). `companion:bond` comes once per Bond level, with that level's unlock texts.
- `task:ended` reasons are `stock`, `storage`, `limit` and `cap`; `hunt:ended` reasons are `limit` and `cap`; a fall is `hunt:death`. Stopping work and pulling back emit nothing.
- `requisitions:returned` is dated at the day boundary it came back on.
- `mail:unknown { count }` follows `mail:claimed` when letters were claimed empty; it has a log line (13).
