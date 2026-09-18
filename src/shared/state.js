/* ============================================================
   Respite · state.js · The Ledger of Saves
   ------------------------------------------------------------
   A new save, and turning any stored save into a sound schema 9
   one. v4 saves (schema 8 and older) go through v4's own migration
   first and then gain what v5 adds: a clock, roll counters, task
   ids and the hunt stream. Every save, old or new, is then rebuilt
   field by field from checked values, holding to what play itself
   never breaks: a unique piece is held once, a pool holds no more
   stacks than it has slots, wear is kept only for what is still
   held, and postings, errands and fights are the ones the rules
   would have made. The server trusts nothing it reads back.

   v4 browsers wrote their own saves, so a row one wrote can hold
   anything. Migrated as `legacy`, it goes the v4 way whatever schema
   it claims, its gold and stacks are held to limits no camp earned
   past, and the log says how many entries were set right.

   All of it runs in time linear in the size of the save, so a row
   of tens of thousands of keys costs milliseconds, not seconds.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData, findAction, getSkill, getMonster, getCompanion, getClass, getTool, regionOfTier } from "./registry.js";
import { itemDef, parseKey, stacks, validKey } from "./items.js";
import { canHold, unstacked } from "./storage.js";
import { combatStats, levelFromXp, skillLevel, maxHp } from "./stats.js";
import { dayIndex, windowIndex } from "./weather.js";
import { hashString } from "./rng.js";
import { foeNumbers, newHunt } from "./combat.js";
import { BOUNTY_BUFF, makeBounty, refreshBounty, requisitionQty, requisitionTargets } from "./world.js";
import { clamp, fmtGold, fmtWhole } from "./format.js";

const H = CONFIG.hunt;
const S = CONFIG.storage;
const A = CONFIG.agents;
const IDLE_CAP = CONFIG.time.idleCapMs;
const LOG_MAX = 60;
const MAX_LIMIT = 100000;
const POOL_IDS = ["inv", "bank", "vault", "satchel"];
const ZONE_IDS = GameData.ZONES.map((z) => z.id);
// The longest walk a hunt can owe: lying low, or all of a zone's window, whichever is longer.
const WALK_MAX = Math.max(H.hideMs, H.searchMinMs, ...GameData.ZONES.map((z) => z.windowMs));
// The most foes one encounter holds: a zone's largest party, a Sovereign with its escorts, or a full reinforcement.
const FOES_MAX = Math.max(H.maxFoes, ...GameData.ZONES.map((z) => Math.max(1 + z.escorts, ...z.sizes.map((p) => p[0]))));

/* ================= CHECKED VALUES ================= */

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const obj = (v) => (isObj(v) ? v : {});
// Own keys, never one that would reach the prototype.
function keysOf(v) {
  if (!isObj(v)) return [];
  const keys = Object.keys(v);
  return Object.hasOwn(v, "__proto__") ? keys.filter((k) => k !== "__proto__") : keys;
}
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const numIn = (v, lo, hi, fallback) => (finite(v) ? clamp(v, lo, hi) : fallback);
const intIn = (v, lo, hi, fallback) => (finite(v) ? clamp(Math.floor(v), lo, hi) : fallback);
const bool = (v) => v === true;
const text = (v, max) => (typeof v === "string" && v.length <= max ? v : null);
const uint32 = (v) => (finite(v) && v >= 0 && v <= 0xffffffff && Math.floor(v) === v ? v : null);
const BIG = Number.MAX_SAFE_INTEGER;
// Task ids: far past any a save hands out, and safe to count on from.
const ID_MAX = 1e15;
// Far past anything play can reach, and far enough below 2^53 that adding to them stays exact.
const QTY_MAX = 1e12;
const GOLD_MAX = 1e15;
// What a save a v4 browser wrote may bring in. Past these, it wasn't earned.
const LEGACY_GOLD_MAX = 5000000;
const LEGACY_STACK_MAX = 250000;
// v4 numbered its unique pieces. Any other uid in a v4 row was written by hand, and could meet one v5 derives.
const V4_UID = /^\d{1,15}$/;

const isWorkSkill = (id) => {
  const s = typeof id === "string" ? getSkill(id) : null;
  return !!s && (s.kind === "gather" || s.kind === "craft");
};

// Own keys copied into a fresh object, in order.
function ownCopy(v) {
  const out = {};
  keysOf(v).forEach((k) => { out[k] = v[k]; });
  return out;
}

/* ================= NEW SAVES ================= */

function blankState(clock, seed) {
  const skills = {};
  GameData.SKILLS.forEach((s) => { skills[s.id] = 0; });
  const equipment = {};
  GameData.EQUIP_SLOTS.forEach((s) => { equipment[s] = null; });
  const s = seed >>> 0;

  return {
    schema: CONFIG.schema,
    clock,
    meta: { createdAt: clock, playtimeMs: 0, account: null, userId: null },
    player: { gold: 0, hp: 1, recoveryLeft: 0, klass: null, camp: null },
    skills,
    inv:   { slots: S.slots.inv,   items: {}, order: [] },
    bank:  { slots: S.slots.bank,  items: {}, order: [] },
    vault: { slots: S.slots.vault, items: {}, order: [] },
    // The Satchel: the remedies a fight can reach, and nothing else.
    satchel: { slots: S.slots.satchel, items: {}, order: [] },
    uid: 1,
    equipment,
    tools: {},
    wear: {},
    tasks: { skilling: null, combat: null },
    region: "region_1",
    travel: { unlocked: ["region_1"] },
    companions: { owned: {}, active: null },
    // Region-wide, keyed by tier. Kept unrounded: Threat per kill is fractional.
    threat: {},
    // Best time survived on each ground, by "tier:zone", in ms. The zone popup's record line.
    records: {},
    // Deaths by the monster that dealt them, for the Collection's bestiary.
    foeDeaths: {},
    // What a recent death still costs: { until, mult } on every combat number.
    debuff: null,
    settings: { hideSovereign: false },
    agents: [],
    requisitions: [],
    reqDay: dayIndex(clock),
    bounty: null,
    bountyBoard: {},
    buff: null,
    smugglerBought: {},
    /* selfMade is the Wealth board's whole basis: the gold value a player has
       *created*, counted the moment it is created and never again. A gathered
       material counts at its value; a craft counts only what it added over the
       materials it ate, so an ore dug and then smelted is not counted twice.
       Nothing bought, traded, looted, requisitioned or smuggled ever touches it,
       which is what stops the board being bought. */
    stats: { kills: 0, actions: 0, deaths: 0, crafted: 0, epics: 0, goldEarned: 0, bosses: 0, selfMade: 0 },
    log: [],
    rng: { seed: s, world: hashString(`${s}:world`), hunt: hashString(`${s}:hunt`) },
    rolls: {},
    serial: 1,
    lootLostAt: null,
  };
}

export function createState({ now, seed, userId = null, account = null } = {}) {
  const clock = finite(now) ? Math.max(0, Math.floor(now)) : 0;
  const state = blankState(clock, finite(seed) ? seed : 0);
  state.meta.userId = userId;
  state.meta.account = account;
  state.player.hp = maxHp(state);
  state.log.push({ t: clock, m: "You take command of a ruin." });
  refreshBounty(state);
  return state;
}

/* ================= MIGRATION ================= */

/* legacy: the row was written by a v4 browser (the server has never saved
   it), so it takes the v4 way whatever schema it claims. */
export function migrateSave(raw, { now, seed, userId, account, legacy = false } = {}) {
  const opts = {
    now: finite(now) ? Math.max(0, Math.floor(now)) : 0, seed: finite(seed) ? seed : 0, userId, account, legacy: legacy === true,
  };
  if (!isObj(raw)) return createState(opts);
  const schema = finite(raw.schema) ? raw.schema : 0;
  const shaped = opts.legacy || schema < 9 ? fromV4(raw, opts) : raw;
  const state = normalise(shaped, opts);
  if (userId !== undefined) state.meta.userId = typeof userId === "string" ? userId : null;
  if (account !== undefined) state.meta.account = typeof account === "string" ? account : null;
  return state;
}

/* ---------- v4 (schema 8 and older) ---------- */

const V5_ONLY = new Set(["meta", "player", "skills", "equipment", "tasks", "travel", "stats", "settings", "inv", "bank", "vault",
  "satchel", "wear", "tools", "log", "rng", "rolls", "serial", "clock", "schema"]);

// The three pools v4 knew. The Satchel is packed in normalise, from what they hold.
const V4_POOLS = ["inv", "bank", "vault"];

/* v4's migrate(), in the same steps and order, then what v5 adds, building
   a loose save that normalise() checks value by value afterwards. The steps
   change the pools and the tasks in place, so those are copied first; the
   caller's object is never written to. */
function fromV4(loaded, opts) {
  const meta = obj(loaded.meta);
  const seen = finite(meta.lastSeen) && meta.lastSeen > 0 ? Math.floor(meta.lastSeen) : opts.now;
  // The browser's clock stamped the save. One running ahead would freeze the camp until it caught up.
  const lastSeen = opts.now > 0 ? Math.min(seen, opts.now) : seen;
  const m = blankState(lastSeen, opts.seed);
  const stamp = lastSeen;

  // Copy the top level, then merge the nested records over their defaults.
  keysOf(loaded).forEach((k) => {
    if (!V5_ONLY.has(k)) m[k] = loaded[k];
  });
  ["meta", "player", "skills", "equipment", "tasks", "travel", "stats", "settings"].forEach((k) => {
    const src = obj(loaded[k]);
    keysOf(src).forEach((f) => { m[k][f] = src[f]; });
  });
  ["skilling", "combat"].forEach((k) => {
    if (isObj(m.tasks[k])) m.tasks[k] = ownCopy(m.tasks[k]);
  });
  V4_POOLS.forEach((w) => {
    const src = obj(loaded[w]);
    m[w] = {
      slots: typeof src.slots === "number" ? src.slots : m[w].slots,
      items: ownCopy(src.items),
      order: Array.isArray(src.order) ? src.order.slice() : [],
    };
  });
  m.inv.slots = S.slots.inv;
  // No Satchel here: leaving it off is what tells normalise to pack one.
  delete m.satchel;
  // Read, never written, from here on.
  m.wear = obj(loaded.wear);
  m.tools = obj(loaded.tools);
  m.log = (Array.isArray(loaded.log) ? loaded.log.slice(-LOG_MAX) : []).map((e) => (typeof e === "string" ? { t: stamp, m: e } : e));
  delete m.yields;
  delete m.pets;
  delete m.meta.lastSeen;

  migrateEconomy(m, loaded, stamp);
  migrateTasks(m, lastSeen);
  migrateHunt(m, loaded, lastSeen);
  migrateCompanions(m, loaded, stamp);
  settleBelongings(m, stamp);

  // What v5 adds.
  m.clock = lastSeen;
  m.rolls = {};
  m.lootLostAt = null;
  // v4 kept no note from the last hunt: the next one sets out whole, as it did.
  m.player.camp = null;
  convertSkilling(m);
  convertHunt(m);
  m.log = m.log.slice(-LOG_MAX);
  return m;
}

// Schema 8 struck new coin: prices and purses are a fifth of what they were.
function migrateEconomy(m, loaded, stamp) {
  if ((finite(loaded.schema) ? loaded.schema : 0) >= 8) return;
  m.player.gold = Math.floor((Number(m.player.gold) || 0) / 5);
  m.stats.goldEarned = Math.floor((Number(m.stats.goldEarned) || 0) / 5);
  m.bounty = null;
  m.log.push({ t: stamp, m: "The camp struck new coin. Purses and prices are a fifth of what they were." });
}

// v4's migrateStash, for a save still being migrated: a held stack grows, else the first pool with room.
function migrateStasher(m) {
  const pools = ["inv", "vault", "bank"];
  const used = {};
  const listed = {};
  pools.forEach((w) => {
    used[w] = Object.keys(m[w].items).length;
    listed[w] = new Set(m[w].order);
  });
  return (key, qty) => {
    let where = null;
    for (const w of pools) {
      if (Object.hasOwn(m[w].items, key) && m[w].items[key] != null) {
        where = w;
        break;
      }
    }
    for (let i = 0; !where && i < pools.length; i++) {
      if (used[pools[i]] < (pools[i] === "inv" ? S.slots.inv : m[pools[i]].slots)) where = pools[i];
    }
    if (!where) return false;
    const items = m[where].items;
    if (!Object.hasOwn(items, key)) used[where]++;
    items[key] = (items[key] || 0) + qty;
    if (!listed[where].has(key)) {
      listed[where].add(key);
      m[where].order.push(key);
    }
    return true;
  };
}

// Tasks from older saves have no batch limit and no running clock, rebuilt from when they started.
function migrateTasks(m, lastSeen) {
  ["skilling", "combat"].forEach((k) => {
    const t = m.tasks[k];
    if (!isObj(t)) {
      m.tasks[k] = null;
      return;
    }
    if (t.limit === undefined) t.limit = null;
    if (typeof t.elapsed !== "number") t.elapsed = clamp(lastSeen - (Number(t.startedAt) || lastSeen), 0, IDLE_CAP);
  });
}

/* Schema 8 reworked the hunt: zones, Threat by zone, loot straight into
   storage, and recovery counted in game time. */
function migrateHunt(m, loaded, lastSeen) {
  const p = obj(loaded.player);
  if (typeof p.recoveryLeft !== "number") {
    m.player.recoveryLeft = clamp((Number(p.recoveryUntil) || 0) - lastSeen, 0, H.recoveryMs);
  }
  delete m.player.recoveryUntil;
  m.settings = { hideSovereign: !!(m.settings && m.settings.hideSovereign) };

  if ((finite(loaded.schema) ? loaded.schema : 0) < 8) {
    m.threat = {};

    // Unclaimed spoils are carried in, or sold where they lie.
    let carried = 0;
    let sold = 0;
    const stash = migrateStasher(m);
    (Array.isArray(loaded.spoils) ? loaded.spoils : []).forEach((sp) => {
      const known = !!sp && validKey(sp.key);
      const qty = Math.max(0, Math.floor(Number(sp && sp.qty) || 0));
      if (!known || !qty) return;
      if (stash(sp.key, qty)) carried++;
      else sold += itemDef(sp.key).value * qty;
    });
    if (sold) m.player.gold = (Number(m.player.gold) || 0) + sold;
    if (carried || sold) {
      m.log.push({ t: lastSeen, m: `Spoils left on the field were carried in${sold ? `, and what didn't fit sold for ${fmtGold(sold)}` : ""}.` });
    }

    // A hunt already underway carries on from the Outer edge of the same ground,
    // with its kill count and limit. One that was already pulling back, had
    // reached its limit or had run twelve hours is over.
    const old = m.tasks.combat;
    const tier = old && typeof old.queued === "number" && regionOfTier(old.queued) ? old.queued : old && old.tier;
    const done = Math.max(0, Math.floor(Number(old && old.done) || 0));
    const limit = old && old.limit != null && Number.isFinite(Number(old.limit)) ? Math.max(1, Math.floor(Number(old.limit))) : null;
    const elapsed = clamp(Number(old && old.elapsed) || 0, 0, IDLE_CAP);
    const over = !old || old.queued === "stop" || (limit != null && done >= limit) || elapsed >= IDLE_CAP;
    if (!over && Number.isInteger(tier) && regionOfTier(tier)) {
      const hunt = newHunt(m, tier, "outer", limit == null ? null : Math.min(MAX_LIMIT, limit));
      hunt.done = tier === old.tier ? done : 0;
      hunt.elapsed = elapsed;
      hunt.nextMark = (Math.floor(elapsed / H.rateMarkMs) + 1) * H.rateMarkMs;
      hunt.marks = [[hunt.nextMark - H.rateMarkMs, 0, 0]];
      m.tasks.combat = hunt;
    } else {
      m.tasks.combat = null;
    }
  }
  delete m.spoils;

  // Anything that isn't a hunt this version understands is dropped.
  const c = m.tasks.combat;
  if (c && (!regionOfTier(c.tier) || !ZONE_IDS.includes(c.zone) || !Array.isArray(c.foes) || !Array.isArray(c.marks))) {
    m.tasks.combat = null;
  }
  if (c && m.tasks.combat) {
    c.foes = c.foes.filter((f) => f && getMonster(f.id) && f.hp > 0);
    if (c.phase === "fight" && !c.foes.length) {
      c.phase = "search";
      c.wait = H.searchMinMs;
    }
  }

  // Health can't sit above what this version says your most is.
  const most = combatStats({ level: levelFromXp(Number(m.skills.warfare) || 0), klass: getClass(m.player.klass) ? m.player.klass : null, equipment: obj(m.equipment) }).maxHp;
  const hp = Number(m.player.hp);
  m.player.hp = Number.isFinite(hp) ? clamp(hp, 0, most) : most;
}

function migrateCompanions(m, loaded, stamp) {
  const src = obj(loaded.companions);
  const owned = {};
  const srcOwned = obj(src.owned);
  keysOf(srcOwned).forEach((id) => {
    const c = srcOwned[id];
    if (!c || !getCompanion(id)) return;
    owned[id] = {
      bond: clamp(Number(c.bond) || 0, 0, CONFIG.bondXpFor(CONFIG.companions.maxBond)),
      rank: clamp(Math.floor(Number(c.rank) || 1), 1, CONFIG.companions.maxRank),
      dupes: Math.max(0, Math.floor(Number(c.dupes) || 0)),
    };
  });
  m.companions = { owned, active: typeof src.active === "string" && Object.hasOwn(owned, src.active) ? src.active : null };

  // The old kennel's golem, sprite and mule are retired. Owners get their gold back.
  const pets = obj(loaded.pets);
  const retired = GameData.RETIRED_PETS;
  const refund = Object.keys(retired).filter((id) => pets[id]).reduce((n, id) => n + retired[id], 0);
  if (refund) {
    m.player.gold = (Number(m.player.gold) || 0) + refund;
    m.log.push({ t: stamp, m: `Your old animals have left the camp. ${fmtGold(refund)} was paid back for them.` });
  }
}

// Belongings hold ten slots now. Anything past that moves to the Stockpile,
// then the Vault. Whatever still has nowhere to go stays put here (and
// normalise() lets go of what no slot holds).
function settleBelongings(m, stamp) {
  const inv = m.inv;
  const keys = [];
  const listed = new Set();
  const list = (k) => {
    if (typeof k === "string" && Object.hasOwn(inv.items, k) && !listed.has(k)) {
      listed.add(k);
      keys.push(k);
    }
  };
  inv.order.forEach((k) => { if (typeof k === "string" && Object.hasOwn(inv.items, k) && inv.items[k] != null) list(k); });
  Object.keys(inv.items).forEach(list);

  const dests = ["bank", "vault"];
  const used = { bank: Object.keys(m.bank.items).length, vault: Object.keys(m.vault.items).length };
  const orders = { bank: new Set(m.bank.order), vault: new Set(m.vault.order) };
  let moved = 0;
  for (let i = S.slots.inv; i < keys.length; i++) {
    const k = keys[i];
    let dest = null;
    for (const w of dests) {
      if ((Object.hasOwn(m[w].items, k) && m[w].items[k] != null) || used[w] < m[w].slots) {
        dest = w;
        break;
      }
    }
    if (!dest) continue;
    const into = m[dest].items;
    if (!Object.hasOwn(into, k)) used[dest]++;
    into[k] = (into[k] || 0) + inv.items[k];
    if (!orders[dest].has(k)) {
      orders[dest].add(k);
      m[dest].order.push(k);
    }
    delete inv.items[k];
    moved++;
  }
  inv.order = inv.order.filter((k) => typeof k === "string" && Object.hasOwn(inv.items, k) && inv.items[k] != null);

  if (moved) {
    m.log.push({ t: stamp, m: `Belongings now hold ${S.slots.inv} slots. ${moved} stack${moved === 1 ? " was" : "s were"} moved into camp storage.` });
  }
}

// A skilling task carries on if its work still exists and the level allows it.
function convertSkilling(m) {
  const t = m.tasks.skilling;
  if (!t) return;
  const def = isWorkSkill(t.skillId) && typeof t.actionId === "string" ? findAction(t.skillId, t.actionId) : null;
  const skills = obj(m.skills);
  const level = levelFromXp(finite(skills[t.skillId]) ? skills[t.skillId] : 0);
  if (!def || level < def.level) {
    m.tasks.skilling = null;
    return;
  }
  const limit = t.limit == null || !finite(Number(t.limit)) ? null : clamp(Math.floor(Number(t.limit)), 1, MAX_LIMIT);
  const done = Math.max(0, Math.floor(Number(t.done) || 0));
  if (limit != null && done >= limit) {
    m.tasks.skilling = null;
    return;
  }
  m.tasks.skilling = {
    id: m.serial++, skillId: t.skillId, actionId: t.actionId,
    progress: Math.max(0, Math.floor(Number(t.progress) || 0)), done,
    elapsed: clamp(Math.floor(Number(t.elapsed) || 0), 0, IDLE_CAP),
    limit, startedAt: m.clock,
  };
}

// A hunt from schema 8 gains an id. Its dice are the save's hunt stream now, not a stream of its own.
function convertHunt(m) {
  const c = m.tasks.combat;
  if (!c) return;
  if (!(Number.isInteger(c.id) && c.id >= 1)) c.id = m.serial++;
  delete c.rng;
  if (!(finite(c.startedAt) && c.startedAt <= m.clock)) c.startedAt = m.clock;
  delete c.queued;
}

/* The Satchel came after these saves, so a save without one has its remedies
   sitting in the pools where nothing in a fight can reach them. They move in
   once, best heal first, every stack of a kind merged into the one slot, and
   whatever the four slots cannot take stays where it lies. Returns the keys
   taken out of the pools and how many stacks were lifted. */
function packSatchel(s, src, ledger) {
  const stackMax = ledger.legacy ? LEGACY_STACK_MAX : QTY_MAX;
  const found = new Map();
  V4_POOLS.forEach((w) => {
    const items = obj(obj(src[w]).items);
    keysOf(items).forEach((k) => {
      const q = items[k];
      // Remedies are materials, and a material's key is its bare id.
      if (!finite(q) || q < 1 || k.includes("|") || !validKey(k)) return;
      const d = itemDef(k);
      if (!d || !(d.heal > 0)) return;
      const at = found.get(k) || { heal: d.heal, qty: 0, stacks: 0 };
      at.qty += Math.floor(q);
      at.stacks++;
      found.set(k, at);
    });
  });
  const picks = [...found.entries()].sort((a, b) => b[1].heal - a[1].heal).slice(0, S.slots.satchel);
  let stacks = 0;
  picks.forEach(([k, at]) => {
    if (at.qty > stackMax) ledger.fixed++;
    s.satchel.items[k] = Math.min(at.qty, stackMax);
    s.satchel.order.push(k);
    stacks += at.stacks;
  });
  return { taken: new Set(picks.map(([k]) => k)), stacks };
}

/* ---------- every save ---------- */

/* ledger.fixed counts what a legacy save needed set right: gold and stacks
   past their limits, a unique piece held twice or with a uid v4 never
   minted, a stack no slot holds, a posting, errand, fight, task or buff
   the rules would not have made. Junk that was never an item or a number
   is simply left out. */
function normalise(src, opts) {
  const legacy = opts.legacy === true;
  const ledger = { legacy, fixed: 0 };
  const clock = intIn(src.clock, 0, 8.64e15, opts.now);
  const rngSrc = obj(src.rng);
  const seed = uint32(rngSrc.seed) ?? (opts.seed >>> 0);
  const s = blankState(clock, seed);
  const world = uint32(rngSrc.world);
  if (world !== null) s.rng.world = world;
  const huntRng = uint32(rngSrc.hunt);
  if (huntRng !== null) s.rng.hunt = huntRng;

  const meta = obj(src.meta);
  s.meta.createdAt = intIn(meta.createdAt, 0, clock, clock);
  s.meta.playtimeMs = intIn(meta.playtimeMs, 0, BIG, 0);
  s.meta.account = text(meta.account, 64);
  s.meta.userId = text(meta.userId, 64);

  const skills = obj(src.skills);
  GameData.SKILLS.forEach((sk) => { s.skills[sk.id] = numIn(skills[sk.id], 0, 1e15, 0); });

  const player = obj(src.player);
  const goldMax = legacy ? LEGACY_GOLD_MAX : GOLD_MAX;
  s.player.gold = intIn(player.gold, 0, goldMax, 0);
  if (finite(player.gold) && Math.floor(player.gold) > goldMax) ledger.fixed++;
  s.player.recoveryLeft = intIn(player.recoveryLeft, 0, H.recoveryMs, 0);
  s.player.klass = typeof player.klass === "string" && getClass(player.klass) ? player.klass : null;

  // What is worn comes first: a unique piece worn is the copy that counts.
  const eq = obj(src.equipment);
  GameData.EQUIP_SLOTS.forEach((slot) => {
    const key = eq[slot];
    const d = validKey(key) ? itemDef(key) : null;
    if (d && d.kind === "gear" && d.slot === slot && !forged(key, ledger)) s.equipment[slot] = key;
  });
  const weapon = s.equipment.weapon ? itemDef(s.equipment.weapon) : null;
  if (weapon && weapon.twoHanded && s.equipment.offhand) {
    s.equipment.offhand = null;
    ledger.fixed++;
  }
  const tools = obj(src.tools);
  GameData.GATHER_SKILLS.forEach((g) => {
    const id = tools[g.id];
    const t = typeof id === "string" ? getTool(id) : null;
    if (t && t.forSkill === g.id) s.tools[g.id] = id;
  });

  normalisePools(s, src, ledger);
  s.uid = intIn(src.uid, 1, BIG, 1);

  // Wear only for what is still held or worn. Anything else has left the camp.
  const held = new Set();
  Object.values(s.equipment).forEach((k) => { if (k) held.add(k); });
  POOL_IDS.forEach((w) => Object.keys(s[w].items).forEach((k) => held.add(k)));
  const wear = obj(src.wear);
  keysOf(wear).forEach((k) => {
    if (held.has(k) && finite(wear[k]) && wear[k] > 0) s.wear[k] = Math.min(Math.floor(wear[k]), 1e9);
  });

  const unlocked = Array.isArray(obj(src.travel).unlocked) ? src.travel.unlocked : [];
  s.travel.unlocked = ["region_1"];
  unlocked.forEach((id) => {
    if (typeof id === "string" && GameData.REGIONS.some((r) => r.id === id) && !s.travel.unlocked.includes(id)) s.travel.unlocked.push(id);
  });
  s.region = typeof src.region === "string" && s.travel.unlocked.includes(src.region) ? src.region : "region_1";

  normaliseCompanions(s, obj(src.companions));

  /* Threat is region-wide now, keyed by tier alone. A save from when it was keyed
     "tier:zone" carries its hottest zone forward as the region's Threat. */
  const threat = obj(src.threat);
  keysOf(threat).forEach((k) => {
    const [tier, zone, extra] = k.split(":");
    if (extra !== undefined || !/^[1-9]$/.test(tier || "")) return;
    if (zone !== undefined && !ZONE_IDS.includes(zone)) return;
    if (!finite(threat[k])) return;
    s.threat[tier] = Math.max(s.threat[tier] || 0, clamp(threat[k], 0, H.threatCap));
  });

  const records = obj(src.records);
  keysOf(records).forEach((k) => {
    const [tier, zone, extra] = k.split(":");
    if (extra === undefined && /^[1-9]$/.test(tier || "") && ZONE_IDS.includes(zone) && finite(records[k])) {
      s.records[k] = intIn(records[k], 0, IDLE_CAP, 0);
    }
  });

  const foeDeaths = obj(src.foeDeaths);
  keysOf(foeDeaths).forEach((k) => {
    if (typeof k === "string" && getMonster(k) && finite(foeDeaths[k])) s.foeDeaths[k] = intIn(foeDeaths[k], 0, BIG, 0);
  });

  // A death's wound, never longer or deeper than the rules would have made it.
  const debuff = obj(src.debuff);
  if (finite(debuff.until) && finite(debuff.mult) && debuff.mult > 0 && debuff.mult < 1) {
    const until = Math.min(Math.floor(debuff.until), clock + H.recoveryMs + H.deathDebuffMs);
    const mult = Math.max(debuff.mult, 1 - H.deathDebuff);
    if (until > clock) s.debuff = { until, mult };
  }

  s.settings.hideSovereign = bool(obj(src.settings).hideSovereign);

  normaliseAgents(s, src, ledger);
  s.reqDay = intIn(src.reqDay, 0, dayIndex(clock), dayIndex(clock));
  s.bounty = normaliseBounty(src.bounty, ledger);
  const board = obj(src.bountyBoard);
  const here = windowIndex(clock);
  keysOf(board).forEach((id) => {
    const b = board[id];
    if (!isObj(b) || b.region !== id || !finite(b.window) || Math.floor(b.window) !== here || id === (s.bounty && s.bounty.region)) return;
    const posting = normaliseBounty(b, ledger);
    if (posting) s.bountyBoard[id] = posting;
  });
  // A bounty's buff is double experience for an hour from the claim, and never more.
  const buff = obj(src.buff);
  if (finite(buff.until) && finite(buff.mult) && buff.mult > 0 && buff.mult <= 10) {
    const until = Math.min(Math.floor(buff.until), clock + BOUNTY_BUFF.ms);
    const mult = Math.min(buff.mult, BOUNTY_BUFF.mult);
    if (until !== Math.floor(buff.until) || mult !== buff.mult) ledger.fixed++;
    s.buff = { until, mult };
  }
  const bought = obj(src.smugglerBought);
  keysOf(bought).forEach((tag) => { if (/^\d{1,9}_[0-2]$/.test(tag) && bought[tag]) s.smugglerBought[tag] = true; });

  const stats = obj(src.stats);
  Object.keys(s.stats).forEach((k) => { s.stats[k] = intIn(stats[k], 0, BIG, 0); });

  // The newest sixty lines, read from the end.
  const lines = Array.isArray(src.log) ? src.log : [];
  const log = [];
  for (let i = lines.length - 1; i >= 0 && log.length < LOG_MAX; i--) {
    const e = lines[i];
    if (typeof e === "string") log.push({ t: clock, m: e.slice(0, 500) });
    else if (isObj(e) && typeof e.m === "string") log.push({ t: finite(e.t) ? e.t : clock, m: e.m.slice(0, 500) });
  }
  s.log = log.reverse();

  // Said once, when the Satchel is first packed out of the old pools.
  if (ledger.satchelStacks) {
    const n = ledger.satchelStacks;
    s.log.push({ t: clock, m: `Remedies are carried in the Satchel now. ${fmtWhole(n)} ${n === 1 ? "stack was" : "stacks were"} moved.` });
  }

  const rolls = obj(src.rolls);
  keysOf(rolls).forEach((k) => {
    if (/^[amks]:[a-z0-9_]{1,40}$/.test(k) && finite(rolls[k])) s.rolls[k] = intIn(rolls[k], 0, BIG, 0);
  });
  s.serial = intIn(src.serial, 1, BIG, 1);
  s.lootLostAt = finite(src.lootLostAt) ? Math.floor(src.lootLostAt) : null;

  const tasks = obj(src.tasks);
  s.tasks.skilling = normaliseSkilling(s, tasks.skilling, ledger);
  s.tasks.combat = normaliseHunt(s, tasks.combat, ledger);
  // The camp's note on the last hunt stands only while no hunt is out.
  s.player.camp = s.tasks.combat ? null : normaliseCamp(player.camp, clock);

  // Ids are never handed out twice.
  const used = [s.tasks.skilling && s.tasks.skilling.id, s.tasks.combat && s.tasks.combat.id,
    ...s.agents.map((a) => Number(a.id.slice(6)))].filter(finite);
  s.serial = Math.max(s.serial, ...used.map((n) => n + 1));

  const hp = finite(player.hp) ? player.hp : Infinity;
  s.player.hp = clamp(hp, 0, maxHp(s));
  if (!s.bounty) refreshBounty(s);

  if (legacy && ledger.fixed) {
    const n = ledger.fixed;
    s.log.push({ t: clock, m: `Your old camp's ledger didn't add up. ${fmtWhole(n)} ${n === 1 ? "entry was" : "entries were"} set right.` });
  }
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
  return s;
}

// A legacy save's unique piece under a uid v4 never minted: left out, and set down in the ledger.
function forged(key, ledger) {
  if (!ledger.legacy || stacks(key) || V4_UID.test(parseKey(key).uid)) return false;
  ledger.fixed++;
  return true;
}

// A valid key's uid, or null for a stack. (A valid key has a uid exactly when it has a third part.)
function uidOf(key) {
  const a = key.indexOf("|");
  const b = a < 0 ? -1 : key.indexOf("|", a + 1);
  if (b < 0) return null;
  const c = key.indexOf("|", b + 1);
  return c < 0 ? key.slice(b + 1) : key.slice(b + 1, c);
}

/* The four pools, in one pass each. Keys must be real items in whole
   amounts of at least one; a unique piece counts once and only once across
   what is worn and every pool (worn, then Belongings, the Stockpile, the
   Vault, the Satchel); a pool keeps its stacks in the player's order up to
   its slot count and lets the rest go. */
function normalisePools(s, src, ledger) {
  const stackMax = ledger.legacy ? LEGACY_STACK_MAX : QTY_MAX;
  const taken = new Set();
  Object.values(s.equipment).forEach((k) => { if (k && !stacks(k)) taken.add(k); });

  // A save from before the Satchel packs one here, out of what the pools hold.
  const virgin = !isObj(src.satchel);
  const packed = virgin ? packSatchel(s, src, ledger) : { taken: new Set(), stacks: 0 };
  ledger.satchelStacks = packed.stacks;

  POOL_IDS.forEach((w) => {
    if (w === "satchel" && virgin) return;
    const from = obj(src[w]);
    const pool = s[w];
    if (w === "bank") pool.slots = intIn(from.slots, S.slots.bank, S.bankMax, S.slots.bank);
    if (w === "vault") pool.slots = intIn(from.slots, S.slots.vault, S.bankMax, S.slots.vault);
    const cap = w === "bank" || w === "vault" ? pool.slots : S.slots[w];

    // Real items in amounts of at least one, in the order the save lists them.
    const items = obj(from.items);
    const valid = new Set();
    for (const k of Object.keys(items)) {
      const q = items[k];
      if (!finite(q) || q < 1 || k === "__proto__" || !validKey(k)) continue;
      // Already lifted into the Satchel, and held once.
      if (packed.taken.has(k)) continue;
      // The Satchel takes remedies and nothing else, whatever a row claims.
      if (!canHold(w, k)) {
        ledger.fixed++;
        continue;
      }
      const uid = uidOf(k);
      if (uid !== null && ledger.legacy && !V4_UID.test(uid)) {
        ledger.fixed++;
        continue;
      }
      valid.add(k);
    }

    /* The player's order, then whatever it missed: a stack a slot, up to the
       pool's size, except a remedy in Belongings, which costs a slot a bottle
       and is trimmed to the room left rather than let go whole. */
    const kept = new Map();
    const listed = new Set();
    let used = 0;
    const consider = (k) => {
      if (listed.has(k) || !valid.has(k)) return;
      listed.add(k);
      const unique = uidOf(k) !== null;
      const left = cap - used;
      if ((unique && taken.has(k)) || left < 1) {
        ledger.fixed++;
        return;
      }
      const whole = Math.floor(items[k]);
      const most = unique ? 1 : stackMax;
      if (whole > most) ledger.fixed++;
      let qty = Math.min(whole, most);
      const each = unstacked(w, k);
      if (each && qty > left) {
        qty = left;
        ledger.fixed++;
      }
      if (unique) taken.add(k);
      kept.set(k, qty);
      used += each ? qty : 1;
    };
    (Array.isArray(from.order) ? from.order : []).forEach((k) => { if (typeof k === "string") consider(k); });
    valid.forEach(consider);

    // Written in the save's own order, listed in the player's.
    let placed = 0;
    for (const k of valid) {
      if (placed === kept.size) break;
      if (!kept.has(k)) continue;
      pool.items[k] = kept.get(k);
      placed++;
    }
    pool.order = [...kept.keys()];
  });
}

function normaliseCompanions(s, src) {
  const owned = obj(src.owned);
  const C = CONFIG.companions;
  const capMs = CONFIG.bondXpFor(C.maxBond) * C.bondMs;
  keysOf(owned).forEach((id) => {
    const c = owned[id];
    if (!getCompanion(id) || !isObj(c)) return;
    const bond = numIn(c.bond, 0, capMs / C.bondMs, 0);
    s.companions.owned[id] = {
      // Bond sits on the whole-millisecond grid; see companions.js.
      bond: Math.round(bond * C.bondMs) / C.bondMs,
      rank: intIn(c.rank, 1, C.maxRank, 1),
      dupes: intIn(c.dupes, 0, 100, 0),
    };
  });
  s.companions.active = typeof src.active === "string" && Object.hasOwn(s.companions.owned, src.active) ? src.active : null;
}

function normaliseAgents(s, src, ledger) {
  const seen = new Set();
  const roster = Array.isArray(src.agents) ? src.agents : [];
  for (let i = 0; i < roster.length && s.agents.length < A.rosterMax; i++) {
    const a = roster[i];
    if (!isObj(a) || typeof a.id !== "string" || !/^agent_\d{1,15}$/.test(a.id) || seen.has(a.id)) continue;
    const name = text(a.name, 60);
    if (!name || !GameData.AGENT_RARITIES.some((r) => r.key === a.rarity)) continue;
    seen.add(a.id);
    s.agents.push({ id: a.id, name, rarity: a.rarity });
  }

  // Errands the roster really runs: an agent on the roster, out once, three a day at most,
  // for something agents bring in, in the amount that agent brings. Returned ones are done with.
  const byId = new Map(s.agents.map((a) => [a.id, a]));
  const targets = new Set(requisitionTargets(s));
  const out = new Set();
  (Array.isArray(src.requisitions) ? src.requisitions : []).forEach((r) => {
    if (!isObj(r) || r.resolved === true || typeof r.agentId !== "string" || !validKey(r.itemKey) || !finite(r.day)) return;
    const agent = byId.get(r.agentId);
    if (!agent || out.has(agent.id) || !targets.has(r.itemKey) || out.size >= A.requisitionsPerDay) {
      ledger.fixed++;
      return;
    }
    const qty = requisitionQty(agent);
    if (r.qty !== qty) ledger.fixed++;
    out.add(agent.id);
    s.requisitions.push({ agentId: agent.id, agentName: agent.name, itemKey: r.itemKey, qty, day: Math.floor(r.day), resolved: false });
  });
}

/* A posting is the board's to say: its kind, target, label, amount and pay
   are what makeBounty posts for that region and window, and the save keeps
   only how far it got (while it is the same posting) and whether it was paid. */
function normaliseBounty(b, ledger) {
  if (!isObj(b) || typeof b.region !== "string" || !finite(b.window) || typeof b.label !== "string") return null;
  const region = GameData.REGIONS.find((r) => r.id === b.region);
  const window = Math.floor(b.window);
  if (!region || window < 0 || window > 1e9 || !intIn(b.amount, 1, 1e6, 0)) return null;
  const shaped = (b.kind === "slay" && Number.isInteger(b.targetTier) && !!regionOfTier(b.targetTier)) ||
    (b.kind === "gather" && typeof b.targetId === "string" && validKey(b.targetId) && itemDef(b.targetId).kind === "material");
  if (!shaped) return null;

  const posting = makeBounty({ region: region.id }, window);
  const sameWork = b.kind === posting.kind && (posting.kind === "slay" ? b.targetTier === posting.targetTier : b.targetId === posting.targetId);
  if (!sameWork || b.amount !== posting.amount || b.gold !== posting.gold) ledger.fixed++;
  posting.progress = sameWork ? intIn(b.progress, 0, BIG, 0) : 0;
  posting.claimed = bool(b.claimed);
  return posting;
}

function normaliseSkilling(s, t, ledger) {
  if (!isObj(t) || !isWorkSkill(t.skillId) || typeof t.actionId !== "string") return null;
  const def = findAction(t.skillId, t.actionId);
  if (!def || skillLevel(s, t.skillId) < def.level) return null;
  const limit = t.limit == null ? null : intIn(t.limit, 1, MAX_LIMIT, null);
  if (t.limit != null && limit == null) return null;
  const done = intIn(t.done, 0, BIG, 0);
  if (limit != null && done >= limit) return null;
  const id = Number.isInteger(t.id) && t.id >= 1 && t.id <= ID_MAX ? t.id : s.serial++;
  // Progress toward one action is always short of the slowest that action ever takes.
  const most = Math.max(1000, def.time);
  if (finite(t.progress) && t.progress > most) ledger.fixed++;
  return {
    id, skillId: t.skillId, actionId: t.actionId,
    progress: intIn(t.progress, 0, most, 0), done,
    elapsed: intIn(t.elapsed, 0, IDLE_CAP, 0),
    limit, startedAt: intIn(t.startedAt, 0, s.clock, s.clock),
  };
}

// A hunt this version can play on, checked value by value, or null.
function normaliseHunt(s, c, ledger) {
  if (!isObj(c) || !Number.isInteger(c.tier) || !regionOfTier(c.tier) || !ZONE_IDS.includes(c.zone)) return null;
  if (!Array.isArray(c.foes) || !Array.isArray(c.marks)) return null;
  const limit = c.limit == null ? null : intIn(c.limit, 1, MAX_LIMIT, null);
  if (c.limit != null && limit == null) return null;
  const done = intIn(c.done, 0, BIG, 0);
  if (limit != null && done >= limit) return null;
  const phase = ["search", "fight", "hide"].includes(c.phase) ? c.phase : null;
  const kind = ["normal", "sovereign"].includes(c.kind) ? c.kind : null;
  if (!phase || !kind) return null;

  // No more foes than an encounter holds, each at most whole, and a Sovereign only in its own fight.
  const foes = [];
  let sovereigns = 0;
  for (const f of c.foes) {
    const mob = isObj(f) && typeof f.id === "string" ? getMonster(f.id) : null;
    if (!mob || mob.tier !== c.tier || !finite(f.hp) || f.hp <= 0 || !finite(f.max) || f.max <= 0) continue;
    if (foes.length >= FOES_MAX) {
      ledger.fixed++;
      break;
    }
    const sovereign = mob.archetype === "sovereign";
    if (sovereign && (kind !== "sovereign" || sovereigns > 0)) {
      ledger.fixed++;
      continue;
    }
    const elite = bool(f.elite);
    /* A foe stands at its zone's depth, full stop. Foes never move between zones
       mid-fight, so there is nothing to carry over and no reason to trust a stored
       power: a save claiming a softer one would otherwise get a weaker foe, with
       `max` recomputed from the claim so the ledger check below never noticed. */
    const zonePower = (GameData.ZONES.find((z) => z.id === c.zone) || {}).power || 1;
    const power = zonePower;
    if (finite(f.power) && f.power !== zonePower) ledger.fixed++;
    const max = foeNumbers(mob, elite, power).hp;
    if (f.max !== max || f.hp > max) ledger.fixed++;
    if (sovereign) sovereigns++;
    foes.push({
      uid: intIn(f.uid, 1, BIG, 1), id: mob.id, elite, power, hp: Math.min(f.hp, max), max, ambush: bool(f.ambush),
      timer: numIn(f.timer, -1e6, 1e6, mob.speed), bleed: intIn(f.bleed, 0, 1e9, 0), bleedTimer: numIn(f.bleedTimer, -1e6, 1e6, 0),
    });
  }
  /* The rolling window's samples, read from the end. Each is [elapsed, xp, damage];
     a save from before DPS was tracked has two-part marks, and its damage starts at
     the reading it never took. */
  const keep = H.rateWindowMs / H.rateMarkMs + 1;
  const marks = [];
  for (let i = c.marks.length - 1; i >= 0 && marks.length < keep; i--) {
    const mk = c.marks[i];
    if (Array.isArray(mk) && mk.length >= 2 && finite(mk[0]) && finite(mk[1])) {
      marks.push([mk[0], mk[1], finite(mk[2]) ? mk[2] : 0]);
    }
  }
  marks.reverse();
  const elapsed = numIn(c.elapsed, 0, IDLE_CAP, 0);
  // The next mark is always just ahead; one far behind would stall the engine on marks.
  const markOk = finite(c.nextMark) && c.nextMark % H.rateMarkMs === 0 && c.nextMark > elapsed - 1 && c.nextMark <= elapsed + H.rateMarkMs + 1;
  const nextMark = markOk ? c.nextMark : (Math.floor(elapsed / H.rateMarkMs) + 1) * H.rateMarkMs;

  const xp = numIn(c.xp, 0, 1e15, 0);
  const dmg = numIn(c.dmg, 0, 1e15, 0);

  const hunt = {
    tier: c.tier, zone: c.zone, limit, done, elapsed,
    startedAt: intIn(c.startedAt, 0, s.clock, s.clock),
    phase, wait: numIn(c.wait, -1, H.hideMs, H.searchMinMs), kind,
    clock: numIn(c.clock, 0, IDLE_CAP, 0), reinforceAt: numIn(c.reinforceAt, 0, IDLE_CAP * 2, 0),
    enrageAt: numIn(c.enrageAt, 0, IDLE_CAP * 2, 0), enrage: intIn(c.enrage, 0, 1e6, 0),
    foes, uid: Math.max(intIn(c.uid, 1, BIG, 1), ...foes.map((f) => f.uid + 1)),
    swing: numIn(c.swing, -1e6, 1e6, 0), volley: intIn(c.volley, 0, GameData.TECHNIQUE.volley.casts, 0),
    veil: numIn(c.veil, 0, H.veilMax, 0), streak: intIn(c.streak, 0, 1e9, 0),
    peak: bool(c.peak), sovereignNext: bool(c.sovereignNext), encounters: intIn(c.encounters, 0, BIG, 0),
    xp,
    dmg,
    // With no window to fall back on, it starts here: a window that claimed the whole
    // run's XP over one sample would read as an absurd rate for its first minutes.
    marks: marks.length ? marks : [[nextMark - H.rateMarkMs, xp, dmg]],
    nextMark,
    id: Number.isInteger(c.id) && c.id >= 1 && c.id <= ID_MAX ? c.id : 0,
  };
  if (!hunt.id) hunt.id = s.serial++;
  if (hunt.phase === "fight" && !foes.length) {
    hunt.phase = "search";
    hunt.wait = H.searchMinMs;
  }
  return hunt;
}

// The camp's note on a hunt that ended alive: { since, hp, walkUntil }, or null.
function normaliseCamp(note, clock) {
  if (!isObj(note) || !finite(note.since) || !finite(note.hp) || !finite(note.walkUntil)) return null;
  const since = intIn(note.since, 0, clock, clock);
  return { since, hp: numIn(note.hp, 0, 1e9, 0), walkUntil: numIn(note.walkUntil, since - 1, since + WALK_MAX, since) };
}
