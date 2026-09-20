/* Parity test for the v5 data layer.
   Loads the v4 data.js in a vm context and the new src/shared modules by
   import, then checks they agree table by table, formula by formula and
   getter by getter. Run from the repo root:

     node tests/engine/registry.test.mjs

   The v4 sources are read from tests/ref-v4 in the repo. Set RESPITE_REF to
   point somewhere else.

   A few of v4's numbers have deliberately been left behind. Those comparisons
   are listed in DIVERGED below with the reason they moved; they report as
   CHANGED and are counted on their own. Everything else still has to match v4
   to the character, so accidental drift is still a failure. */

import vm from "node:vm";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const refDir = path.resolve(process.env.RESPITE_REF || path.join(repo, "tests", "ref-v4"));

/* ================= HARNESS ================= */

let passed = 0;
let failed = 0;
let changed = 0;

function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? `\n     ${detail}` : ""}`);
  return ok;
}

// En and em dashes, built from code points so this file holds neither.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const section = (title) => console.log(`\n# ${title}`);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const show = (v) => (v === undefined ? "undefined" : JSON.stringify(v));

// Provisions is the Stockpile in v5. Missing is null whether it was undefined or null.
function norm(v) {
  const s = JSON.stringify(v === undefined ? null : v);
  return s === undefined ? `<${typeof v}>` : s.replace(/\bProvisions\b/g, "Stockpile");
}

// A throw is a result too: both sides must throw the same kind of error.
function attempt(fn) {
  try {
    return fn();
  } catch (e) {
    return { threw: String(e && e.name) };
  }
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const cut = (s) => s.slice(Math.max(0, i - 60), i + 60);
  return `first difference at char ${i}\n     old: ${cut(a)}\n     new: ${cut(b)}`;
}

/* ================= INTENTIONAL DIVERGENCE ================= */

/* The balance has deliberately moved away from v4 in a few places, so these
   comparisons can no longer agree. Each is listed with the reason it moved, and
   reports as CHANGED rather than FAIL. `at` names the fields that were meant to
   move: they are dropped from both sides and everything else in that table still
   has to match v4 exactly, so a typo in a zone's window is still caught. A
   listing whose two sides have come back together is a failure, so this map
   cannot quietly rot. */
const DIVERGED = {
  "GameData.ZONES": {
    why: "the per-zone Threat multiplier became a power multiplier on foe health and damage, with a new mix and elite chance at each depth",
    at: ["threat", "power", "mix", "elite"],
  },
  "getZone = zoneDef": {
    why: "the same ZONES change, read back through the getter",
    at: ["threat", "power", "mix", "elite"],
  },
  "CONFIG.storage.names = STORE_NAMES": {
    why: "the Satchel is a fourth pool, the combat loadout, and v4 had no name for it",
    at: ["satchel"],
  },
  findAction: { why: "the Greatsword and Grimoire lines are marked released: false in the registry, so their recipes and the components only they wanted are pruned off the benches; v4 shipped them all" },
  "getRecipe = craft action by id": { why: "the Greatsword and Grimoire lines are marked released: false in the registry, so their recipes and the components only they wanted are pruned off the benches; v4 shipped them all" },
  "CONFIG.hunt.hideMs = HIDE_MS": { why: "going to ground is a full hour now, not five minutes" },
  "CONFIG.hunt.xpMarkMs = XP_MARK_MS": { why: "the five-minute XP mark gave way to rateMarkMs, rateWindowMs and rateMinSpanMs" },
};

// Each listing, and how many comparisons it covered.
const divergences = new Map();
const divergenceOf = (name) => (Object.hasOwn(DIVERGED, name) ? { key: name, ...DIVERGED[name] } : null);

// A copy of value with every property named in keys dropped, however deep.
function without(value, keys) {
  if (Array.isArray(value)) return value.map((v) => without(v, keys));
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((k) => { if (!keys.includes(k)) out[k] = without(value[k], keys); });
    return out;
  }
  return value;
}

function changedLine(name, d, suffix = "") {
  changed++;
  divergences.set(d.key, (divergences.get(d.key) || 0) + 1);
  console.log(`CHANGED ${name}${suffix} (${d.why})`);
  return true;
}

const STALE = "listed in DIVERGED, but v4 and v5 agree: take it out";

function same(name, oldVal, newVal) {
  const d = divergenceOf(name);
  const a = norm(oldVal);
  const b = norm(newVal);
  if (!d) return check(name, a === b, a === b ? "" : firstDiff(a, b));
  if (a === b) return check(name, false, STALE);
  if (d.at) {
    const ka = norm(without(oldVal, d.at));
    const kb = norm(without(newVal, d.at));
    if (ka !== kb) return check(name, false, `moved outside ${d.at.join(", ")}: ${firstDiff(ka, kb)}`);
  }
  return changedLine(name, d);
}

function sameOver(name, inputs, oldFn, newFn) {
  const d = divergenceOf(name);
  let moved = false;
  for (const input of inputs) {
    const oldVal = attempt(() => oldFn(input));
    const newVal = attempt(() => newFn(input));
    const a = norm(oldVal);
    const b = norm(newVal);
    if (a === b) continue;
    if (!d) return check(name, false, `input ${show(input)}: ${firstDiff(a, b)}`);
    moved = true;
    if (d.at) {
      const ka = norm(without(oldVal, d.at));
      const kb = norm(without(newVal, d.at));
      if (ka !== kb) return check(name, false, `input ${show(input)}: moved outside ${d.at.join(", ")}: ${firstDiff(ka, kb)}`);
    }
  }
  if (d) return moved ? changedLine(name, d, ` (${inputs.length} inputs)`) : check(name, false, STALE);
  return check(`${name} (${inputs.length} inputs)`, true);
}

/* ================= WHAT IS COMPARED ================= */

const TABLES = [
  "EQUIP_SLOTS", "SLOT_LABELS", "DOLL_ORDER", "SLOT_GLYPHS", "RARITIES", "WEAPON_PREFIXES", "ARMOUR_PREFIXES",
  "ALL_PREFIXES", "STRATA", "TIERS", "REAGENTS", "GATHER_SKILLS", "PROFESSIONS", "SKILLS", "MATERIALS", "GEAR",
  "TOOLS", "REMEDIES", "GATHER_ACTIONS", "CRAFT_ACTIONS", "GEAR_LINES", "REGIONS", "ZONES", "ARCHETYPES",
  "ARCHETYPE_ORDER", "ELITE", "SOVEREIGN", "REGION_FOES", "FOE_DROPS", "MONSTERS", "BENCH_TABS", "WEATHER_TYPES",
  "WEATHER_SEVERITIES", "WEEKDAY_NAMES", "MASTERY_TRACK", "CLASSES", "BRUTE_FORCE", "TECHNIQUE", "AGENT_RARITIES",
  "AGENT_NAMES", "COMPANIONS", "RANK_NUMERALS", "RETIRED_PETS",
];

const SOURCE_MAPS = ["GATHERED_BY", "MADE_BY", "USED_IN", "DROPPED_BY"];

// v4 constant -> where it lives on CONFIG.
const CONSTANTS = [
  ["IDLE_CAP_MS", "time.idleCapMs"],
  ["WINDOW_MS", "time.windowMs"],
  ["DAY_MS", "time.dayMs"],
  ["WEEK_MS", "time.weekMs"],
  ["PACK_SLOTS", "storage.slots.inv"],
  ["STORES_SLOTS", "storage.slots.bank"],
  ["BANK_SLOTS", "storage.slots.vault"],
  ["BANK_MAX", "storage.bankMax"],
  ["STORE_NAMES", "storage.names"],
  ["MAX_LEVEL", "progression.maxLevel"],
  ["CLASS_PICK_LEVEL", "progression.classPickLevel"],
  ["PLAYER_SWING_MS", "hunt.playerSwingMs"],
  ["RECOVERY_MS", "hunt.recoveryMs"],
  ["HIDE_MS", "hunt.hideMs"],
  ["DEATH_WEAR", "hunt.deathWear"],
  ["THREAT_CAP", "hunt.threatCap"],
  ["VEIL_MAX", "hunt.veilMax"],
  ["MAX_FOES", "hunt.maxFoes"],
  ["SEARCH_MIN_MS", "hunt.searchMinMs"],
  ["XP_MARK_MS", "hunt.xpMarkMs"],
  ["FOE_AMBUSH", "hunt.foeAmbush"],
  ["VOLLEY_GAP_MS", "hunt.volleyGapMs"],
  ["REMEDY_AT", "hunt.remedyAt"],
  ["RETREAT_AT", "hunt.retreatAt"],
  ["DEF_K", "hunt.defK"],
  ["DEF_GROWTH", "hunt.defGrowth"],
  ["MITIGATION_CAP", "hunt.mitigationCap"],
  ["FOE_HP", "hunt.foeHp"],
  ["FOE_ATTACK", "hunt.foeAttack"],
  ["FOE_HP_GROWTH", "hunt.foeHpGrowth"],
  ["FOE_ATTACK_GROWTH", "hunt.foeAttackGrowth"],
  ["FOE_XP", "hunt.foeXp"],
  ["FOE_GOLD", "hunt.foeGold"],
  ["GEAR_GROWTH", "hunt.gearGrowth"],
  ["WEAPON_VEIL", "hunt.weaponVeil"],
  ["VEIL_CURVE", "hunt.veilCurve"],
  ["TOLLS", "economy.tolls"],
  ["REAGENT_CHANCES", "economy.reagentChances"],
  ["COMPANION_MAX_BOND", "companions.maxBond"],
  ["COMPANION_MAX_RANK", "companions.maxRank"],
  ["RANK_DUPES", "companions.rankDupes"],
  ["BOND_MS", "companions.bondMs"],
  ["REQUISITIONS_PER_DAY", "agents.requisitionsPerDay"],
  ["AGENT_HIRE_COST", "agents.hireCost"],
  ["AGENT_ROSTER_MAX", "agents.rosterMax"],
  ["WEATHER_EFFECT_MIN", "weather.effectMin"],
  ["WEATHER_EFFECT_MAX", "weather.effectMax"],
  ["BOUNTIFUL_XP", "weather.bountifulXp"],
  ["BOUNTIFUL_WEEKDAYS", "weather.bountifulWeekdays"],
];

const FORMULAS = ["valBase", "defenceK", "compTime", "gearTime", "baseHealth", "baseAttack", "baseDefence", "veilPerBlow", "bondXpFor"];

const OLD_FUNCTIONS = [
  "gearStat", "itemDef", "itemLore", "benchGroupOf", "actionsFor", "findAction", "actionOutput", "skillDef",
  "skillName", "gatherSkillDef", "reagentOf", "isGather", "isTrade", "regionById", "regionOfTier", "zoneDef",
  "getMonster", "foeOf", "foesOf", "sovereignOf", "monsterOfTier", "classDef", "companionDef", "rarityDef",
  "prefixDef", "agentRarityDef", "stratumOf", "matId", "slug", "basePrefix",
];

/* ================= THE TEST ================= */

async function main() {
  section("Loading");
  const dataPath = path.join(refDir, "data.js");
  const enginePath = path.join(refDir, "engine.js");
  if (!check(`v4 data.js and engine.js found in ${refDir}`, existsSync(dataPath) && existsSync(enginePath),
    "set RESPITE_REF to the folder holding the v4 sources")) return;

  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(dataPath, "utf8"), ctx, { filename: dataPath });
  // isGather and isTrade lived in engine.js. Lift those two lines rather than retyping them.
  const engineLines = readFileSync(enginePath, "utf8").split("\n");
  for (const name of ["isGather", "isTrade"]) {
    const line = engineLines.find((l) => l.startsWith(`const ${name} = `));
    if (!check(`engine.js defines ${name}`, !!line)) return;
    vm.runInContext(line, ctx, { filename: enginePath });
  }

  const oldNames = [...TABLES, ...SOURCE_MAPS, ...CONSTANTS.map(([n]) => n), ...FORMULAS, ...OLD_FUNCTIONS,
    "SCHEMA", "REMEDY_SPEC", "XP_TABLE", "ITEM_LORE", "TYPE_LORE"];
  const O = vm.runInContext(`({ ${oldNames.join(", ")} })`, ctx);
  check("v4 data.js built its tables", Object.keys(O.MATERIALS).length > 200 && O.MONSTERS.length === 36);

  const shared = (file) => import(pathToFileURL(path.join(repo, "src/shared", file)).href);
  const { CONFIG } = await shared("config.js");
  const R = await shared("registry.js");
  const L = await shared("lore.js");
  const { GameData } = R;
  check("src/shared/config.js, registry.js and lore.js import", !!(CONFIG && GameData && L.itemLore));

  const TIER_NUMS = range(1, 9);
  const RARITY_MULTS = [undefined, ...O.RARITIES.map((r) => r.mult)];
  const JUNK = ["nope", "", undefined, null];
  const ITEM_IDS = [...Object.keys(O.MATERIALS), ...Object.keys(O.GEAR), ...Object.keys(O.TOOLS)];
  const SKILL_IDS = O.SKILLS.map((s) => s.id);
  const oldGather = Object.values(O.GATHER_ACTIONS).flat();
  const oldCraft = Object.values(O.CRAFT_ACTIONS).flat();
  const newGather = Object.values(GameData.GATHER_ACTIONS).flat();
  const newCraft = Object.values(GameData.CRAFT_ACTIONS).flat();
  const ACTION_IDS = [...oldGather, ...oldCraft].map((a) => a.id);

  /* ---------- GameData ---------- */
  section("GameData tables");
  same("GameData holds exactly the listed tables and SOURCES", [...TABLES, "SOURCES"].sort(), Object.keys(GameData).sort());
  for (const name of TABLES) same(`GameData.${name}`, O[name], GameData[name]);
  same("GameData.SOURCES holds the four maps", SOURCE_MAPS, Object.keys(GameData.SOURCES));
  const toIds = (map) => Object.fromEntries(Object.entries(map).map(([k, list]) => [k, list.map((x) => x.id)]));
  for (const name of SOURCE_MAPS) same(`GameData.SOURCES.${name} as ids`, toIds(O[name]), GameData.SOURCES[name]);

  /* ---------- CONFIG ---------- */
  section("CONFIG constants");
  const at = (obj, dotted) => dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  for (const [name, dotted] of CONSTANTS) same(`CONFIG.${dotted} = ${name}`, O[name], at(CONFIG, dotted));
  same("CONFIG.economy.remedies = REMEDY_SPEC numbers", O.REMEDY_SPEC.map(({ name, ...numbers }) => numbers), CONFIG.economy.remedies);
  check("CONFIG.schema has moved on from v4's 8, and only forward", CONFIG.schema > O.SCHEMA && O.SCHEMA === 8, CONFIG.schema);
  check("CONFIG.storage.names.bank is Stockpile, and the Satchel is the fourth pool",
    JSON.stringify(CONFIG.storage.names) === '{"inv":"Belongings","bank":"Stockpile","vault":"Vault","satchel":"Satchel"}');
  check("CONFIG.storage.slots.satchel is a small loadout", CONFIG.storage.slots.satchel >= 2 && CONFIG.storage.slots.satchel < GameData.REMEDIES.length);
  same("CONFIG.economy market settings",
    { marketFee: 0.05, marketMaxListings: 20, marketListingDays: 7, marketMaxPrice: 1000000000 },
    { marketFee: CONFIG.economy.marketFee, marketMaxListings: CONFIG.economy.marketMaxListings,
      marketListingDays: CONFIG.economy.marketListingDays, marketMaxPrice: CONFIG.economy.marketMaxPrice });
  // v4 had no parties, so this is v5's own number: 5% a member, three others at most.
  same("CONFIG.party", { maxSize: 4, huntBonusPerMember: 0.05, huntBonusCap: 0.15 }, CONFIG.party);

  section("CONFIG formulas");
  same("CONFIG.xpTable = XP_TABLE", O.XP_TABLE, CONFIG.xpTable);
  // Levels 1..99 and tiers 1..9 both sit inside 0..100.
  for (const name of FORMULAS) sameOver(`CONFIG.${name} for 0..100`, range(0, 100), (x) => O[name](x), (x) => CONFIG[name](x));
  const statInputs = [];
  for (const line of Object.values(O.GEAR_LINES)) {
    for (const stat of ["attack", "defence", "health"]) {
      for (const tier of TIER_NUMS) for (const m of RARITY_MULTS) statInputs.push([line[stat], O.GEAR_GROWTH[stat], tier, m]);
    }
  }
  for (const tier of TIER_NUMS) for (const m of RARITY_MULTS) statInputs.push([O.WEAPON_VEIL[tier - 1], 1, 1, m]);
  sameOver("CONFIG.gearStat for every line, stat, tier and rarity", statInputs, (a) => O.gearStat(...a), (a) => CONFIG.gearStat(...a));

  /* ---------- Lore ---------- */
  section("Lore");
  same("ITEM_LORE", O.ITEM_LORE, L.ITEM_LORE);
  same("TYPE_LORE keys", Object.keys(O.TYPE_LORE), Object.keys(L.TYPE_LORE));
  sameOver("TYPE_LORE lines for every tier",
    Object.keys(O.TYPE_LORE).flatMap((k) => TIER_NUMS.map((t) => [k, t])),
    ([k, t]) => O.TYPE_LORE[k](O.TIERS[t - 1]), ([k, t]) => L.TYPE_LORE[k](GameData.TIERS[t - 1]));
  const loreKeys = [...ITEM_IDS, ...Object.keys(O.GEAR).map((id) => `${id}|relic|7|echoing`), "nope_sword", "nope"];
  sameOver("itemLore(itemDef(key)) for every material, gear and tool", loreKeys,
    (key) => O.itemLore(O.itemDef(key)), (key) => L.itemLore(O.itemDef(key)));
  const defFromGameData = (id) => ({ base: id, ...(R.getGear(id) || R.getTool(id) || R.getMaterial(id)) });
  sameOver("itemLore on defs built from GameData", ITEM_IDS, (id) => O.itemLore(O.itemDef(id)), (id) => L.itemLore(defFromGameData(id)));
  check("itemLore(null) is empty", L.itemLore(null) === "" && O.itemLore(null) === "");

  /* ---------- Getters ---------- */
  section("Bench");
  sameOver("benchGroupOf for every craft action", range(0, oldCraft.length - 1),
    (i) => O.benchGroupOf(oldCraft[i]), (i) => R.benchGroupOf(newCraft[i]));

  section("Getters");
  check("craft action ids are unique across professions", new Set(oldCraft.map((a) => a.id)).size === oldCraft.length);
  check("gather action ids are unique across skills", new Set(oldGather.map((a) => a.id)).size === oldGather.length);

  const itemKeys = [...ITEM_IDS, ...JUNK];
  sameOver("getMaterial = MATERIALS[id]", itemKeys, (id) => O.MATERIALS[id], (id) => R.getMaterial(id));
  sameOver("getGear = GEAR[id]", itemKeys, (id) => O.GEAR[id], (id) => R.getGear(id));
  sameOver("getTool = TOOLS[id]", itemKeys, (id) => O.TOOLS[id], (id) => R.getTool(id));

  const actionKeys = [...ACTION_IDS, ...JUNK];
  sameOver("getRecipe = craft action by id", actionKeys, (id) => oldCraft.find((a) => a.id === id), (id) => R.getRecipe(id));
  sameOver("getGatherAction = gather action by id", actionKeys, (id) => oldGather.find((a) => a.id === id), (id) => R.getGatherAction(id));

  const skillKeys = [...SKILL_IDS, ...JUNK, "gather", "trade", "all"];
  sameOver("actionsFor", skillKeys, (s) => O.actionsFor(s), (s) => R.actionsFor(s));
  const findInputs = [
    ...[...oldGather, ...oldCraft].map((a) => [a.skillId, a.id]),
    ["delving", oldCraft[0].id], ["forgemaster", oldGather[0].id], ["warfare", oldGather[0].id], ["nope", "nope"], [undefined, undefined],
  ];
  sameOver("findAction", findInputs, ([s, a]) => O.findAction(s, a), ([s, a]) => R.findAction(s, a));
  const oldActions = [...oldGather, ...oldCraft];
  const newActions = [...newGather, ...newCraft];
  sameOver("actionOutput for every action", range(0, oldActions.length - 1),
    (i) => O.actionOutput(oldActions[i]), (i) => R.actionOutput(newActions[i]));

  sameOver("getSkill = skillDef", skillKeys, (s) => O.skillDef(s), (s) => R.getSkill(s));
  sameOver("skillName", skillKeys, (s) => O.skillName(s), (s) => R.skillName(s));
  sameOver("gatherSkillDef", skillKeys, (s) => O.gatherSkillDef(s), (s) => R.gatherSkillDef(s));
  sameOver("reagentOf", skillKeys, (s) => O.reagentOf(s), (s) => R.reagentOf(s));
  sameOver("isGather = engine.js isGather", skillKeys, (s) => O.isGather(s), (s) => R.isGather(s));
  sameOver("isTrade = engine.js isTrade", skillKeys, (s) => O.isTrade(s), (s) => R.isTrade(s));

  const tierKeys = [...range(-1, 11), undefined, null, "1"];
  sameOver("getRegion = regionById", [...O.REGIONS.map((r) => r.id), ...JUNK], (id) => O.regionById(id), (id) => R.getRegion(id));
  sameOver("regionOfTier", tierKeys, (t) => O.regionOfTier(t), (t) => R.regionOfTier(t));
  sameOver("getZone = zoneDef", [...O.ZONES.map((z) => z.id), ...JUNK], (id) => O.zoneDef(id), (id) => R.getZone(id));

  sameOver("getMonster", [...O.MONSTERS.map((m) => m.id), ...JUNK], (id) => O.getMonster(id), (id) => R.getMonster(id));
  const foeInputs = tierKeys.flatMap((t) => [...O.ARCHETYPE_ORDER, "sovereign", "nope", undefined].map((arch) => [t, arch]));
  sameOver("foeOf", foeInputs, ([t, arch]) => O.foeOf(t, arch), ([t, arch]) => R.foeOf(t, arch));
  sameOver("foesOf", tierKeys, (t) => O.foesOf(t), (t) => R.foesOf(t));
  sameOver("sovereignOf", tierKeys, (t) => O.sovereignOf(t), (t) => R.sovereignOf(t));
  sameOver("monsterOfTier", tierKeys, (t) => O.monsterOfTier(t), (t) => R.monsterOfTier(t));

  sameOver("getClass = classDef", [...O.CLASSES.map((c) => c.id), ...JUNK], (id) => O.classDef(id), (id) => R.getClass(id));
  check("getClass is null when unknown", R.getClass("nope") === null && R.getClass(undefined) === null);
  sameOver("getCompanion = companionDef", [...O.COMPANIONS.map((c) => c.id), ...JUNK], (id) => O.companionDef(id), (id) => R.getCompanion(id));
  sameOver("rarityDef", [...O.RARITIES.map((r) => r.key), ...JUNK], (k) => O.rarityDef(k), (k) => R.rarityDef(k));
  sameOver("prefixDef", [...O.ALL_PREFIXES.map((p) => p.id), ...JUNK], (id) => O.prefixDef(id), (id) => R.prefixDef(id));
  sameOver("agentRarityDef", [...O.AGENT_RARITIES.map((r) => r.key), ...JUNK], (k) => O.agentRarityDef(k), (k) => R.agentRarityDef(k));
  sameOver("stratumOf", tierKeys, (t) => O.stratumOf(t), (t) => R.stratumOf(t));

  sameOver("itemSources = GATHERED_BY, MADE_BY, USED_IN, DROPPED_BY", itemKeys,
    (id) => ({
      gatheredBy: O.GATHERED_BY[id] || [], madeBy: O.MADE_BY[id] || [],
      usedIn: O.USED_IN[id] || [], droppedBy: O.DROPPED_BY[id] || [],
    }),
    (id) => R.itemSources(id));

  const matInputs = TIER_NUMS.flatMap((t) => ["fell", "delve", "harvest", "flay", "dredge"].map((type) => [t, type]));
  sameOver("matId(TIERS row, type)", matInputs, ([t, type]) => O.matId(O.TIERS[t - 1], type), ([t, type]) => R.matId(GameData.TIERS[t - 1], type));
  sameOver("matId(tier number, type)", matInputs, ([t, type]) => O.matId(O.TIERS[t - 1], type), ([t, type]) => R.matId(t, type));

  const names = [
    ...O.TIERS.flatMap((t) => [t.fell, t.delve, t.harvest, t.flay, t.dredge]),
    ...[O.MATERIALS, O.GEAR, O.TOOLS].flatMap((table) => Object.values(table).map((d) => d.name)),
    ...O.ALL_PREFIXES.map((p) => p.name), ...O.MONSTERS.map((m) => m.name), ...O.REGIONS.map((r) => r.name),
    "", " leading space", "Star-Iron Golem", "Executioner's",
  ];
  sameOver("slug", names, (s) => O.slug(s), (s) => R.slug(s));
  sameOver("basePrefix", names, (s) => O.basePrefix(s), (s) => R.basePrefix(s));

  const PROTO_KEYS = ["toString", "__proto__", "constructor", "hasOwnProperty"];
  check("id getters ignore prototype keys", PROTO_KEYS.every((k) => {
    const src = R.itemSources(k);
    return R.getMaterial(k) === null && R.getGear(k) === null && R.getTool(k) === null &&
      R.getRecipe(k) === null && R.getGatherAction(k) === null && R.actionsFor(k).length === 0 &&
      Object.values(src).every((list) => list.length === 0);
  }));
  check("getters hand back GameData's own objects", R.getMaterial("coal") === GameData.MATERIALS.coal &&
    R.getRecipe(newCraft[5].id) === newCraft[5] && R.getGatherAction(newGather[3].id) === newGather[3] &&
    R.findAction("forgemaster", newCraft[0].id) === GameData.CRAFT_ACTIONS.forgemaster[0] &&
    R.itemSources("coal").usedIn[0] === R.getRecipe(GameData.SOURCES.USED_IN.coal[0]));

  /* ---------- Frozen ---------- */
  section("Frozen");
  check("this file runs in strict mode", (function () { return this === undefined; })());

  const roots = [["GameData", GameData], ["CONFIG", CONFIG], ["ITEM_LORE", L.ITEM_LORE], ["TYPE_LORE", L.TYPE_LORE]];
  for (const [label, root] of roots) {
    const stack = [[root, label]];
    const seen = new Set();
    let loose = null;
    while (stack.length && !loose) {
      const [o, where] = stack.pop();
      if (o === null || (typeof o !== "object" && typeof o !== "function") || seen.has(o)) continue;
      seen.add(o);
      if (!Object.isFrozen(o)) loose = where;
      for (const k of Reflect.ownKeys(o)) {
        const desc = Object.getOwnPropertyDescriptor(o, k);
        if ("value" in desc) stack.push([desc.value, `${where}.${String(k)}`]);
      }
    }
    check(`${label} is frozen all the way down`, !loose, `not frozen: ${loose}`);
  }

  {
    const stack = [[GameData, "GameData"]];
    const seen = new Map();
    let twice = null;
    while (stack.length && !twice) {
      const [o, where] = stack.pop();
      if (o === null || typeof o !== "object") continue;
      if (seen.has(o)) twice = `${seen.get(o)} and ${where}`;
      seen.set(o, where);
      for (const k of Object.keys(o)) stack.push([o[k], `${where}.${k}`]);
    }
    check("GameData shares no object between two places", !twice, `same object at ${twice}`);
  }

  /* What the attempts below are aimed at, as it stands before any of them. ZONES
     has moved on from v4, so v4 is no longer the yardstick for "unchanged" here:
     every one of these tables is held against itself instead, which catches a
     mutation that took wherever it landed. Their agreement with v4 is the
     GameData tables section above. */
  const TARGETED = ["MATERIALS", "GEAR", "CRAFT_ACTIONS", "GATHER_ACTIONS", "MONSTERS", "ZONES", "COMPANIONS", "GATHER_SKILLS", "RARITIES"];
  const beforeAttempts = JSON.parse(JSON.stringify(TARGETED.map((n) => GameData[n])));

  const MUTATIONS = [
    ["add a table to GameData", () => { GameData.EXTRA = {}; }],
    ["replace a table", () => { GameData.MATERIALS = {}; }],
    ["change a material's value", () => { GameData.MATERIALS.slag_delve.value = 999; }],
    ["delete a gear entry", () => { delete GameData.GEAR.slag_sword; }],
    ["push a recipe", () => { GameData.CRAFT_ACTIONS.forgemaster.push({}); }],
    ["change a recipe cost", () => { GameData.CRAFT_ACTIONS.forgemaster[0].cost.coal = 0; }],
    ["change a gather action's output", () => { GameData.GATHER_ACTIONS.delving[0].out.slag_delve = 5; }],
    ["change a monster drop", () => { GameData.MONSTERS[0].drops[0][1] = 9; }],
    ["change a zone size", () => { GameData.ZONES[0].sizes[0][0] = 9; }],
    ["change a companion unlock", () => { GameData.COMPANIONS[0].unlocks[0].value = 1; }],
    ["change a skill's lore line", () => { GameData.GATHER_SKILLS[0].lore[0] = "x"; }],
    ["push to a source list", () => { GameData.SOURCES.USED_IN.coal.push("x"); }],
    ["redefine a rarity's mult", () => { Object.defineProperty(GameData.RARITIES[0], "mult", { value: 9 }); }],
    ["change CONFIG.hunt.foeXp", () => { CONFIG.hunt.foeXp[0] = 99; }],
    ["change CONFIG.storage.names", () => { CONFIG.storage.names.bank = "Provisions"; }],
    ["replace CONFIG.valBase", () => { CONFIG.valBase = () => 0; }],
    ["change ITEM_LORE", () => { L.ITEM_LORE.coal = "x"; }],
    ["change TYPE_LORE", () => { L.TYPE_LORE.bar = null; }],
  ];
  for (const [label, fn] of MUTATIONS) {
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = e instanceof TypeError;
    }
    check(`strict mode throws a TypeError: ${label}`, threw);
  }
  same("tables unchanged after the attempts", beforeAttempts, TARGETED.map((n) => GameData[n]));

  /* ---------- Display order ---------- */
  section("Display order");
  {
    const R = await shared("registry.js");
    same("SKILL_ORDER holds every skill once", [...R.SKILL_ORDER].sort(), GameData.SKILLS.map((s) => s.id).sort());
    same("the trades and artisans in their own orders", [R.TRADE_ORDER.length, R.ARTISAN_ORDER.length], [5, 5]);
    // Each artisan sits in the same place as the trade whose raw material its first recipe takes.
    R.ARTISAN_ORDER.forEach((prof, i) => {
      const raw = R.matId(1, R.gatherSkillDef(R.TRADE_ORDER[i]).mat);
      const takes = GameData.CRAFT_ACTIONS[prof].some((a) => a.tier === 1 && a.cost && Object.hasOwn(a.cost, raw));
      check(`${prof} sits with ${R.TRADE_ORDER[i]} (works ${raw})`, takes);
    });
  }

  /* ---------- Source rules ---------- */
  section("Source rules");
  for (const file of ["src/shared/config.js", "src/shared/registry.js", "src/shared/lore.js"]) {
    const src = readFileSync(path.join(repo, file), "utf8");
    const imports = [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
    check(`${file}: no em or en dashes`, !DASHES.test(src));
    check(`${file}: no DOM, window, Date.now() or Math.random()`,
      !/\b(?:window|document)\.\w|\bDate\.now\s*\(|\bMath\.random\s*\(/.test(src));
    check(`${file}: imports are relative with .js extensions`, imports.every((p) => /^\.\.?\//.test(p) && p.endsWith(".js")));
  }
  check("this test: no em or en dashes", !DASHES.test(readFileSync(fileURLToPath(import.meta.url), "utf8")));

  section("Intentional divergences from v4");
  check("every listing in DIVERGED was reached", divergences.size === Object.keys(DIVERGED).length,
    `reached ${divergences.size} of ${Object.keys(DIVERGED).length}: a listing nothing reaches has lost its comparison`);
  divergences.forEach((n, key) => console.log(`  ${key}${n > 1 ? ` (${n} comparisons)` : ""}: ${DIVERGED[key].why}`));
}

try {
  await main();
} catch (e) {
  check("the test ran to the end", false, e && e.stack);
}
console.log(`\n${passed} passed, ${failed} failed, ${changed} changed, ${passed + failed + changed} total`);
process.exitCode = failed ? 1 : 0;
