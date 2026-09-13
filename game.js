/* ============================================================
   Respite
   ------------------------------------------------------------
   Framing (placeholder, swap it whenever you land on real lore):
   you run a basecamp. You go out and fight; the camp keeps
   working while you do. That's why one combat task and one
   skilling task run at the same time — no second character
   needed, the camp is the second pair of hands.
   ============================================================ */

/* ================= 1. CONSTANTS ================= */

const SCHEMA = 4;
const SAVE_PREFIX = "respite_save_v4";
const ACCOUNTS_KEY = "respite_accounts_v1";
const IDLE_CAP_MS = 12 * 60 * 60 * 1000;
const MAX_LEVEL = 99;
const PLAYER_SWING_MS = 2400;
const RESPAWN_MS = 2000;
const INV_SLOTS = 28;
const BANK_START = 40;
const BANK_MAX = 200;
const COMBAT_UNLOCK_TOTAL = 15;

const EQUIP_SLOTS = ["weapon", "offhand", "head", "chest", "legs", "boots", "gloves", "ring", "amulet"];
const SLOT_LABELS = {
  weapon: "Weapon", offhand: "Offhand", head: "Head", chest: "Chest", legs: "Legs",
  boots: "Boots", gloves: "Gloves", ring: "Ring", amulet: "Amulet",
};

/* ---- rarity: rolled once, at craft time ---- */
const RARITIES = [
  { key: "common",   name: "Common",   mult: 1.00, chance: 0.80, colour: "r-common" },
  { key: "uncommon", name: "Uncommon", mult: 1.18, chance: 0.15, colour: "r-uncommon" },
  { key: "rare",     name: "Rare",     mult: 1.42, chance: 0.04, colour: "r-rare" },
  { key: "epic",     name: "Epic",     mult: 1.75, chance: 0.01, colour: "r-epic" },
];

function rollRarity() {
  let r = Math.random();
  for (const rar of RARITIES) {
    if (r < rar.chance) return rar.key;
    r -= rar.chance;
  }
  return "common";
}

function rarityDef(key) { return RARITIES.find((r) => r.key === key) || RARITIES[0]; }

/* ================= 2. YOUR XP TABLE ================= */
/* Verbatim from the table you supplied. Level 99 = 9,178,099. */

const XP_TABLE = [0,
  0, 84, 192, 324, 480, 645, 820, 1005, 1200, 1407,
  1735, 2082, 2449, 2838, 3249, 3684, 4144, 4631, 5146, 5691,
  6460, 7281, 8160, 9101, 10109, 11191, 12353, 13603, 14949, 16400,
  18455, 20675, 23076, 25675, 28492, 31549, 34870, 38482, 42415, 46702,
  52583, 58662, 64933, 71390, 78026, 84833, 91802, 98923, 106186, 114398,
  123502, 132734, 142077, 151515, 161029, 170602, 180216, 189852, 199491, 209115,
  220417, 232945, 246859, 262341, 279598, 298871, 320434, 344603, 371744, 402278,
  441971, 486789, 537487, 594941, 660170, 734360, 818896, 915396, 1025752, 1152182,
  1316749, 1492835, 1681248, 1882849, 2098562, 2329375, 2576345, 2840603, 3123359, 3425908,
  3749636, 4269287, 4827911, 5428432, 6073992, 6767969, 7513995, 8315973, 9178099,
];

function levelFromXp(xp) {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= XP_TABLE[lvl + 1]) lvl++;
  return lvl;
}

/* ================= 3. TIERS ================= */
/* Nine tiers, one per region, unlocking every ten levels. */

const TIERS = [
  { i: 1, level: 1,  wood: "Oak",        ore: "Copper",     fibre: "Flax",      hide: "Rabbit", fish: "Shrimp",    time: 12000,  xp: 1 },
  { i: 2, level: 10, wood: "Birch",      ore: "Iron",       fibre: "Cotton",    hide: "Wolf",   fish: "Trout",     time: 18000,  xp: 2 },
  { i: 3, level: 20, wood: "Pine",       ore: "Silver",     fibre: "Silkleaf",  hide: "Boar",   fish: "Salmon",    time: 28000,  xp: 4 },
  { i: 4, level: 30, wood: "Cedar",      ore: "Gold",       fibre: "Moonflax",  hide: "Bear",   fish: "Lobster",   time: 42000,  xp: 7 },
  { i: 5, level: 40, wood: "Ebony",      ore: "Mithril",    fibre: "Shadeweave",hide: "Drake",  fish: "Swordfish", time: 58000,  xp: 11 },
  { i: 6, level: 50, wood: "Ironwood",   ore: "Orichalcum", fibre: "Mystweave", hide: "Shadow", fish: "Manta",     time: 74000,  xp: 16 },
  { i: 7, level: 60, wood: "Dragonwood", ore: "Adamant",    fibre: "Arcane",    hide: "Dragon", fish: "Anglerfish",time: 90000,  xp: 24 },
  { i: 8, level: 70, wood: "Celestial",  ore: "Celestite",  fibre: "Aether",    hide: "Celestial", fish: "Sunfish",time: 110000, xp: 38 },
  { i: 9, level: 80, wood: "Eldertree",  ore: "Eldersteel", fibre: "Astral",    hide: "Elder",  fish: "Leviathan", time: 100000, xp: 150 },
];

const tierKey = (name) => name.toLowerCase().replace(/[^a-z]/g, "");

/* ================= 4. MATERIALS ================= */

const MATERIALS = {};

function defMat(id, name, icon, value, extra) {
  MATERIALS[id] = Object.assign({ id, name, icon, value, kind: "material" }, extra || {});
  return id;
}

TIERS.forEach((t) => {
  const v = Math.round(3 * Math.pow(2.1, t.i - 1));
  defMat(`${tierKey(t.wood)}_log`,   `${t.wood} log`,      "\u{1FAB5}", v);
  defMat(`${tierKey(t.ore)}_ore`,    `${t.ore} ore`,       "\u{1FAA8}", v);
  defMat(`${tierKey(t.fibre)}_fibre`,`${t.fibre} fibre`,   "\u{1F33E}", v);
  defMat(`${tierKey(t.hide)}_hide`,  `${t.hide} hide`,     "\u{1F9AC}", v);
  defMat(`${tierKey(t.fish)}_raw`,   `Raw ${t.fish.toLowerCase()}`, "\u{1F41F}", Math.round(v * 0.8));
  defMat(`${tierKey(t.fish)}_cooked`,`${t.fish}`,          "\u{1F35B}", Math.round(v * 2),
    { heal: Math.round(6 * Math.pow(1.72, t.i - 1)) });
});

defMat("storage_chest", "Storage chest", "\u{1F4E6}", 400, { chest: 5 });

/* ================= 5. PROFESSIONS + GEAR ================= */
/* Each gathering skill feeds exactly one crafting profession,
   and each profession owns a coherent set of equipment slots. */

const PROFESSIONS = [
  {
    id: "blacksmithing", name: "Blacksmithing", icon: "\u{1F528}", mat: "ore", gather: "mining",
    note: "Ore into heavy plate and melee steel. Feeds on Mining.",
    pieces: [
      { key: "sword",     label: "sword",     slot: "weapon",  icon: "\u{1F5E1}", atk: 1.0, def: 0.15, qty: 3, off: 0 },
      { key: "greatsword",label: "greatsword",slot: "weapon",  icon: "\u{2694}",  atk: 1.7, def: 0,    qty: 5, off: 6, twoHanded: true },
      { key: "helm",      label: "helm",      slot: "head",    icon: "\u{1FA96}", atk: 0,   def: 0.55, qty: 2, off: 2 },
      { key: "platebody", label: "platebody", slot: "chest",   icon: "\u{1F9BA}", atk: 0,   def: 1.0,  qty: 4, off: 4 },
      { key: "platelegs", label: "platelegs", slot: "legs",    icon: "\u{1F456}", atk: 0,   def: 0.8,  qty: 3, off: 3 },
    ],
  },
  {
    id: "woodworking", name: "Woodworking", icon: "\u{1FA93}", mat: "log", gather: "woodcutting",
    note: "Timber into bows, staves, shields — and chests to grow your vault. Feeds on Woodcutting.",
    pieces: [
      { key: "bow",    label: "bow",    slot: "weapon",  icon: "\u{1F3F9}", atk: 1.25, def: 0,    qty: 4, off: 1, twoHanded: true },
      { key: "staff",  label: "staff",  slot: "weapon",  icon: "\u{1FA84}", atk: 1.1,  def: 0.2,  qty: 4, off: 3, twoHanded: true },
      { key: "shield", label: "shield", slot: "offhand", icon: "\u{1F6E1}", atk: 0,    def: 0.85, qty: 3, off: 2 },
    ],
  },
  {
    id: "tailoring", name: "Tailoring", icon: "\u{1F9F5}", mat: "fibre", gather: "foraging",
    note: "Fibre into robes and charms. Light on defence, heavy on trinkets. Feeds on Foraging.",
    pieces: [
      { key: "hood",   label: "hood",   slot: "head",   icon: "\u{1F9E2}", atk: 0,    def: 0.3, qty: 2, off: 1 },
      { key: "robe",   label: "robe",   slot: "chest",  icon: "\u{1F97B}", atk: 0.15, def: 0.5, qty: 4, off: 3 },
      { key: "ring",   label: "ring",   slot: "ring",   icon: "\u{1F48D}", atk: 0.5,  def: 0,   qty: 3, off: 5, hp: 0.4 },
      { key: "amulet", label: "amulet", slot: "amulet", icon: "\u{1F4FF}", atk: 0.2,  def: 0.2, qty: 3, off: 7, hp: 1.2 },
    ],
  },
  {
    id: "hidecraft", name: "Hidecraft", icon: "\u{1FAA1}", mat: "hide", gather: "skinning",
    note: "Hide into supple gear — boots, gloves, chaps. Feeds on Skinning.",
    pieces: [
      { key: "boots",  label: "boots",  slot: "boots",  icon: "\u{1F462}", atk: 0,    def: 0.4, qty: 2, off: 0 },
      { key: "gloves", label: "gloves", slot: "gloves", icon: "\u{1F9E4}", atk: 0.15, def: 0.3, qty: 2, off: 1 },
      { key: "chaps",  label: "chaps",  slot: "legs",   icon: "\u{1F456}", atk: 0,    def: 0.6, qty: 3, off: 3 },
    ],
  },
];

/* Base gear item definitions, generated per tier × piece. */
const GEAR = {};

PROFESSIONS.forEach((prof) => {
  TIERS.forEach((t) => {
    const matName = t[prof.mat === "log" ? "wood" : prof.mat];
    prof.pieces.forEach((piece) => {
      const id = `${tierKey(matName)}_${piece.key}`;
      const power = Math.round(4 * Math.pow(1.55, t.i - 1));
      GEAR[id] = {
        id,
        name: `${matName} ${piece.label}`,
        icon: piece.icon,
        kind: "gear",
        slot: piece.slot,
        tier: t.i,
        prof: prof.id,
        attack: Math.round(power * piece.atk),
        defence: Math.round(power * piece.def),
        health: Math.round(power * (piece.hp || 0)),
        twoHanded: !!piece.twoHanded,
        maxDur: 400 + t.i * 220,
        repairMat: matId(t, prof.mat),
        value: Math.round(power * (piece.atk + piece.def + (piece.hp || 0)) * 30 + 40),
        craft: { prof: prof.id, tier: t.i, piece: piece.key, qty: piece.qty, level: t.level + piece.off },
      };
    });
  });
});

function matId(tier, kind) {
  if (kind === "log")   return `${tierKey(tier.wood)}_log`;
  if (kind === "ore")   return `${tierKey(tier.ore)}_ore`;
  if (kind === "fibre") return `${tierKey(tier.fibre)}_fibre`;
  if (kind === "hide")  return `${tierKey(tier.hide)}_hide`;
  return null;
}

/* ================= 6. ITEM KEYS ================= */
/* Materials stack by id. Gear stacks by id + rarity, so a Rare
   sword never merges with a Common one. */

function makeKey(baseId, rarity) { return rarity ? `${baseId}|${rarity}` : baseId; }
function parseKey(key) {
  const bits = String(key).split("|");
  return { base: bits[0], rarity: bits[1] || null };
}

function itemDef(key) {
  const { base, rarity } = parseKey(key);
  const gear = GEAR[base];
  if (gear) {
    const m = rarityDef(rarity || "common").mult;
    return {
      base, rarity: rarity || "common", kind: "gear",
      name: gear.name, icon: gear.icon, slot: gear.slot,
      attack: Math.round(gear.attack * m),
      defence: Math.round(gear.defence * m),
      health: Math.round(gear.health * m),
      twoHanded: gear.twoHanded, maxDur: gear.maxDur, repairMat: gear.repairMat,
      value: Math.round(gear.value * m), tier: gear.tier, prof: gear.prof,
      craft: gear.craft,
    };
  }
  const mat = MATERIALS[base];
  if (mat) return Object.assign({ base, rarity: null }, mat);
  return null;
}

function itemName(key) {
  const d = itemDef(key);
  if (!d) return key;
  return d.kind === "gear" && d.rarity !== "common" ? `${rarityDef(d.rarity).name} ${d.name}` : d.name;
}

/* ================= 7. SKILLS + ACTIONS ================= */

const GATHER_SKILLS = [
  { id: "mining",      name: "Mining",      icon: "\u{26CF}",  mat: "ore",   node: "vein",   feeds: "blacksmithing" },
  { id: "woodcutting", name: "Woodcutting", icon: "\u{1FA93}", mat: "log",   node: "grove",  feeds: "woodworking" },
  { id: "foraging",    name: "Foraging",    icon: "\u{1F33F}", mat: "fibre", node: "patch",  feeds: "tailoring" },
  { id: "skinning",    name: "Skinning",    icon: "\u{1F52A}", mat: "hide",  node: "trail",  feeds: "hidecraft" },
  { id: "fishing",     name: "Fishing",     icon: "\u{1F3A3}", mat: "fish",  node: "water",  feeds: "cooking" },
];

const SKILLS = []
  .concat(GATHER_SKILLS.map((s) => ({ id: s.id, name: s.name, icon: s.icon, kind: "gather" })))
  .concat(PROFESSIONS.map((p) => ({ id: p.id, name: p.name, icon: p.icon, kind: "craft" })))
  .concat([{ id: "cooking", name: "Cooking", icon: "\u{1F373}", kind: "craft" }])
  .concat([{ id: "combat", name: "Combat", icon: "\u{2694}", kind: "combat" }]);

/* ---- gathering actions, one per skill per region ---- */

const GATHER_ACTIONS = {};
GATHER_SKILLS.forEach((skill) => {
  GATHER_ACTIONS[skill.id] = TIERS.map((t) => {
    const out = skill.mat === "fish" ? `${tierKey(t.fish)}_raw` : matId(t, skill.mat);
    const matName = skill.mat === "fish" ? t.fish
      : skill.mat === "log" ? t.wood
      : skill.mat === "ore" ? t.ore
      : skill.mat === "fibre" ? t.fibre : t.hide;
    return {
      id: `${skill.id}_t${t.i}`,
      skillId: skill.id,
      tier: t.i,
      name: `${matName} ${skill.node}`,
      icon: skill.icon,
      level: t.level,
      time: t.time,
      xp: t.xp,
      out: { [out]: 1 },
    };
  });
});

/* ---- crafting actions ---- */

const CRAFT_ACTIONS = {};

PROFESSIONS.forEach((prof) => {
  CRAFT_ACTIONS[prof.id] = [];
  TIERS.forEach((t) => {
    prof.pieces.forEach((piece) => {
      const matName = t[prof.mat === "log" ? "wood" : prof.mat];
      const id = `${tierKey(matName)}_${piece.key}`;
      const g = GEAR[id];
      CRAFT_ACTIONS[prof.id].push({
        id: `craft_${id}`,
        skillId: prof.id,
        tier: t.i,
        name: g.name,
        icon: g.icon,
        level: g.craft.level,
        time: Math.round(t.time * 1.25),
        xp: Math.round(t.xp * 2.2) + 1,
        cost: { [matId(t, prof.mat)]: piece.qty },
        craftGear: id,
      });
    });
  });
});

// Woodworking also makes vault chests
CRAFT_ACTIONS.woodworking.push({
  id: "craft_storage_chest",
  skillId: "woodworking",
  tier: 2,
  name: "Storage chest",
  icon: "\u{1F4E6}",
  level: 12,
  time: 40000,
  xp: 6,
  cost: { [`${tierKey(TIERS[1].wood)}_log`]: 15 },
  out: { storage_chest: 1 },
});

CRAFT_ACTIONS.cooking = TIERS.map((t) => ({
  id: `cook_t${t.i}`,
  skillId: "cooking",
  tier: t.i,
  name: `Cook ${t.fish.toLowerCase()}`,
  icon: "\u{1F373}",
  level: t.level,
  time: Math.round(t.time * 0.8),
  xp: Math.round(t.xp * 1.6) + 1,
  cost: { [`${tierKey(t.fish)}_raw`]: 1 },
  out: { [`${tierKey(t.fish)}_cooked`]: 1 },
}));

function actionsFor(skillId) {
  return GATHER_ACTIONS[skillId] || CRAFT_ACTIONS[skillId] || [];
}

function findAction(skillId, actionId) {
  return actionsFor(skillId).find((a) => a.id === actionId) || null;
}

/* ================= 8. REGIONS + MONSTERS ================= */

const REGION_FLAVOUR = [
  ["Basecamp Meadow", "Tall grass and a cold firepit. Nothing here wants to kill you, which is the point."],
  ["Hollow Birchwood", "Pale trunks, no birdsong. Something scared them off years ago."],
  ["Sunken Quarry", "Flooded diggings. The pumps stopped a long time ago and nobody came back for them."],
  ["Cedar Shelf", "A wind-scoured ledge above the treeline. Good stone, worse footing."],
  ["Ebonmarsh", "Black water that doesn't reflect. Bring more food than you think you need."],
  ["Ironwood Deep", "Trees too hard to fell without proper steel. Things here are the same."],
  ["Dragonwood Rise", "Warm ground. The trees grow crooked away from something underneath."],
  ["Celestial Reach", "Thin air, thinner light. Your breath comes out wrong up here."],
  ["Eldertree Root", "The last place. Roots the width of streets, and whatever nests in them."],
];

const REGIONS = TIERS.map((t, idx) => ({
  id: `region_${t.i}`,
  tier: t.i,
  name: REGION_FLAVOUR[idx][0],
  note: REGION_FLAVOUR[idx][1],
  level: t.level,
  cost: t.i === 1 ? 0 : Math.round(300 * Math.pow(3.4, t.i - 2)),
  img: `https://picsum.photos/seed/respite-region-${t.i}/1200/380`,
}));

const MONSTER_NAMES = [
  ["Meadow rat", "\u{1F400}"], ["Birchwood wolf", "\u{1F43A}"], ["Quarry goblin", "\u{1F47A}"],
  ["Shelf harpy", "\u{1F985}"], ["Marsh troll", "\u{1F9CC}"], ["Ironwood golem", "\u{1FAA8}"],
  ["Dragonkin raider", "\u{1F409}"], ["Celestial warden", "\u{1F47C}"], ["Elder horror", "\u{1F441}"],
];

const MONSTERS = TIERS.map((t, idx) => {
  const scale = Math.pow(2.15, t.i - 1);
  return {
    id: `mob_t${t.i}`,
    tier: t.i,
    name: MONSTER_NAMES[idx][0],
    icon: MONSTER_NAMES[idx][1],
    level: t.level,
    hp: Math.round(14 * scale),
    attack: Math.round(4 * scale),
    defence: Math.round(1.6 * scale),
    speed: 3000,
    xp: t.xp * 3,
    gold: [Math.round(2 * scale), Math.round(6 * scale)],
    drops: [
      [`${tierKey(t.hide)}_hide`, 1, 0.55],
      [matId(t, "ore"), 1, 0.25],
      [`${tierKey(t.fibre)}_fibre`, 1, 0.25],
    ],
  };
});

const regionOf = (tier) => REGIONS.find((r) => r.tier === tier);
const monsterOfTier = (tier) => MONSTERS.find((m) => m.tier === tier);
const getMonster = (id) => MONSTERS.find((m) => m.id === id) || null;

/* ================= 9. STATE ================= */

let state = freshState();

function freshState() {
  const skills = {};
  SKILLS.forEach((s) => { skills[s.id] = 0; });
  const equipment = {};
  EQUIP_SLOTS.forEach((s) => { equipment[s] = null; });

  return {
    schema: SCHEMA,
    meta: { createdAt: Date.now(), lastSeen: Date.now(), playtimeMs: 0, account: null },
    player: { gold: 0, hp: 10 },
    skills,
    inv:  { slots: INV_SLOTS,  items: {}, order: [] },
    bank: { slots: BANK_START, items: {}, order: [] },
    equipment,
    wear: {},
    tasks: { skilling: null, combat: null },
    travel: { unlocked: ["region_1"] },
    unlocked: { mining: true, woodcutting: true, foraging: true, skinning: true, fishing: true,
                blacksmithing: false, woodworking: false, tailoring: false, hidecraft: false,
                cooking: false, combat: false },
    stats: { kills: 0, actions: 0, deaths: 0, crafted: 0, epics: 0 },
    log: [],
  };
}

/* UI-only, never saved */
let tab = "regions";
let regionView = "region_1";
let profView = "blacksmithing";
let storeView = "inv";
let selected = null;

/* ================= 10. HELPERS ================= */

const el = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

function skillLevel(id) { return levelFromXp(state.skills[id] || 0); }
function totalLevel() { return SKILLS.reduce((n, s) => n + skillLevel(s.id), 0); }
function skillName(id) { const s = SKILLS.find((x) => x.id === id); return s ? s.name : id; }

function fmt(n) {
  n = Math.floor(n);
  if (Math.abs(n) < 10000) return n.toLocaleString();
  if (Math.abs(n) < 1e6) return (n / 1e3).toFixed(1) + "K";
  if (Math.abs(n) < 1e9) return (n / 1e6).toFixed(2) + "M";
  return (n / 1e9).toFixed(2) + "B";
}

function fmtTime(ms) {
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function say(msg) { state.log.push(msg); if (state.log.length > 60) state.log.shift(); }

function toast(msg) {
  const stack = el("toastStack");
  if (!stack) return;
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  t.onclick = () => t.remove();
  stack.appendChild(t);
  setTimeout(() => { if (t.parentNode) t.remove(); }, 7000);
}

/* ---- storage: bag and vault are separate spaces ---- */

function store(which) { return which === "bank" ? state.bank : state.inv; }
function qtyIn(which, key) { return store(which).items[key] || 0; }
function haveQty(key) { return qtyIn("inv", key) + qtyIn("bank", key); }
function slotsUsed(which) { return Object.keys(store(which).items).length; }
function storeFull(which) { return slotsUsed(which) >= store(which).slots; }

function addTo(which, key, qty) {
  const s = store(which);
  if (!s.items[key] && storeFull(which)) return false;
  s.items[key] = (s.items[key] || 0) + qty;
  if (!s.order.includes(key)) s.order.push(key);
  return true;
}

function removeFrom(which, key, qty) {
  const s = store(which);
  const left = (s.items[key] || 0) - qty;
  if (left > 0) s.items[key] = left;
  else {
    delete s.items[key];
    s.order = s.order.filter((k) => k !== key);
    if (selected === key) selected = null;
  }
}

// Spend from the bag first, then dip into the vault.
function spend(key, qty) {
  const fromInv = Math.min(qty, qtyIn("inv", key));
  if (fromInv) removeFrom("inv", key, fromInv);
  const rest = qty - fromInv;
  if (rest > 0) removeFrom("bank", key, rest);
}

function canAfford(cost) {
  if (!cost) return true;
  return Object.keys(cost).every((k) => haveQty(k) >= cost[k]);
}

function payCost(cost) {
  if (!cost) return;
  Object.keys(cost).forEach((k) => spend(k, cost[k]));
}

function orderedKeys(which) {
  const s = store(which);
  const have = Object.keys(s.items);
  const out = s.order.filter((k) => have.includes(k));
  have.forEach((k) => { if (!out.includes(k)) out.push(k); });
  return out;
}

/* ---- combat stats ---- */

function equipStat(stat) {
  let total = 0;
  EQUIP_SLOTS.forEach((slot) => {
    const key = state.equipment[slot];
    if (!key) return;
    const d = itemDef(key);
    if (d && typeof d[stat] === "number") total += d[stat];
  });
  return total;
}

function maxHp() { return 20 + skillLevel("combat") * 5 + equipStat("health"); }
function attackPower() { return 4 + skillLevel("combat") * 1.6 + equipStat("attack"); }
function defencePower() { return skillLevel("combat") * 0.9 + equipStat("defence"); }

function wearPct(key) {
  const d = itemDef(key);
  if (!d || !d.maxDur) return null;
  return clamp(Math.round((1 - (state.wear[key] || 0) / d.maxDur) * 100), 0, 100);
}

/* ================= 11. PROGRESSION ================= */

function grantXp(skillId, amount) {
  const before = skillLevel(skillId);
  state.skills[skillId] = (state.skills[skillId] || 0) + amount;
  const after = skillLevel(skillId);
  if (after > before) {
    say(`${skillName(skillId)} level ${after}.`);
    if (skillId === "combat") state.player.hp = maxHp();
    if (after % 10 === 0) toast(`${skillName(skillId)} level ${after}`);
  }
}

function checkUnlocks() {
  const u = state.unlocked;
  const owns = (suffix) => Object.keys(state.inv.items).concat(Object.keys(state.bank.items))
    .some((k) => k.endsWith(suffix));

  const pairs = [
    ["_ore", "blacksmithing"], ["_log", "woodworking"],
    ["_fibre", "tailoring"], ["_hide", "hidecraft"], ["_raw", "cooking"],
  ];
  pairs.forEach(([suffix, prof]) => {
    if (!u[prof] && owns(suffix)) {
      u[prof] = true;
      say(`${skillName(prof)} unlocked at camp.`);
      toast(`${skillName(prof)} unlocked`);
    }
  });

  if (!u.combat && totalLevel() >= COMBAT_UNLOCK_TOTAL) {
    u.combat = true;
    say("You feel ready to fight. Combat runs alongside your camp work — both at once.");
    toast("Combat unlocked — it runs alongside skilling");
  }
}

/* ================= 12. TICK ================= */

function tick(dt) {
  if (state.tasks.skilling) skillTick(dt);
  if (state.tasks.combat) combatTick(dt);
}

function stopSkilling(reason) {
  if (reason) say(reason);
  state.tasks.skilling = null;
}

function skillTick(dt) {
  const task = state.tasks.skilling;
  const def = findAction(task.skillId, task.actionId);
  if (!def) { state.tasks.skilling = null; return; }

  task.progress += dt;
  let guard = 0;

  while (task.progress >= def.time && guard++ < 200000) {
    if (!canAfford(def.cost)) {
      stopSkilling(`Stopped ${def.name.toLowerCase()} — out of materials.`);
      return;
    }
    if (storeFull("inv") && !outputFitsInv(def)) {
      stopSkilling(`Stopped ${def.name.toLowerCase()} — your bag is full.`);
      toast("Bag full — deposit to the vault or sell something");
      return;
    }

    task.progress -= def.time;
    payCost(def.cost);
    produce(def);
    grantXp(task.skillId, def.xp);
    task.done++;
    state.stats.actions++;
    checkUnlocks();

    // Retask queue: the current action always finishes first.
    if (task.queued) {
      const q = task.queued;
      if (q === "stop") { state.tasks.skilling = null; say("Task finished and stopped."); return; }
      state.tasks.skilling = newSkillTask(q.skillId, q.actionId);
      say(`Switched to ${findAction(q.skillId, q.actionId).name.toLowerCase()}.`);
      return;
    }
  }
}

function outputFitsInv(def) {
  if (def.craftGear) return false; // rarity unknown until rolled — require a free slot
  if (!def.out) return true;
  return Object.keys(def.out).every((k) => state.inv.items[k]);
}

function produce(def) {
  if (def.out) {
    Object.keys(def.out).forEach((k) => {
      if (!addTo("inv", k, def.out[k])) say(`No bag room for ${itemName(k)} — it was left behind.`);
    });
  }
  if (def.craftGear) {
    const rarity = rollRarity();
    const key = makeKey(def.craftGear, rarity);
    if (addTo("inv", key, 1)) {
      state.stats.crafted++;
      if (rarity !== "common") {
        say(`Crafted a ${rarityDef(rarity).name} ${GEAR[def.craftGear].name.toLowerCase()}.`);
        if (rarity === "epic") { state.stats.epics++; toast(`Epic roll: ${GEAR[def.craftGear].name}`); }
        else if (rarity === "rare") toast(`Rare roll: ${GEAR[def.craftGear].name}`);
      }
    } else {
      say(`No bag room for the ${GEAR[def.craftGear].name.toLowerCase()} — it was lost.`);
    }
  }
}

function bestFood() {
  let pick = null, best = 0;
  ["inv", "bank"].forEach((w) => {
    Object.keys(store(w).items).forEach((k) => {
      const d = itemDef(k);
      if (d && d.heal && d.heal > best) { best = d.heal; pick = k; }
    });
  });
  return pick;
}

function combatTick(dt) {
  const c = state.tasks.combat;
  const mob = getMonster(c.monsterId);
  if (!mob) { state.tasks.combat = null; return; }

  if (c.respawn > 0) {
    c.respawn -= dt;
    if (c.respawn <= 0) {
      if (c.queued === "stop") { state.tasks.combat = null; say("Fight finished and stopped."); return; }
      if (c.queued) { state.tasks.combat = newCombatTask(c.queued); return; }
      c.mobHp = mob.hp; c.mobMax = mob.hp;
      c.mobTimer = mob.speed; c.playerTimer = PLAYER_SWING_MS;
    }
    return;
  }

  c.playerTimer -= dt;
  if (c.playerTimer <= 0) {
    c.playerTimer += PLAYER_SWING_MS;
    const atk = attackPower();
    let dmg = randInt(Math.max(1, Math.floor(atk * 0.55)), Math.ceil(atk));
    dmg = Math.max(1, Math.round(dmg - mob.defence * 0.35));
    c.mobHp -= dmg;
    if (c.mobHp <= 0) { killMob(mob); return; }
  }

  c.mobTimer -= dt;
  if (c.mobTimer <= 0) {
    c.mobTimer += mob.speed;
    let dmg = randInt(Math.max(1, Math.floor(mob.attack * 0.55)), mob.attack);
    dmg = Math.max(1, Math.round(dmg - defencePower() * 0.4));
    state.player.hp -= dmg;

    if (state.player.hp <= maxHp() * 0.45) {
      const food = bestFood();
      if (food) {
        spend(food, 1);
        state.player.hp = Math.min(maxHp(), state.player.hp + itemDef(food).heal);
      }
    }

    if (state.player.hp <= 0) {
      state.player.hp = maxHp();
      state.tasks.combat = null;
      state.stats.deaths++;
      say(`The ${mob.name.toLowerCase()} put you down. You keep your things — but bring food.`);
      toast(`Killed by a ${mob.name.toLowerCase()}`);
    }
  }
}

function killMob(mob) {
  const c = state.tasks.combat;
  grantXp("combat", mob.xp);
  state.player.gold += randInt(mob.gold[0], mob.gold[1]);
  state.stats.kills++;
  c.done++;

  mob.drops.forEach(([k, qty, chance]) => {
    if (Math.random() < chance && !addTo("inv", k, qty)) {
      say(`No bag room for ${itemName(k)}.`);
    }
  });

  applyWear();
  checkUnlocks();
  c.respawn = RESPAWN_MS;
}

function applyWear() {
  const w = state.equipment.weapon;
  if (w && itemDef(w).maxDur) damageItem(w, 1);

  const armour = EQUIP_SLOTS
    .filter((s) => !["weapon", "ring", "amulet"].includes(s))
    .map((s) => state.equipment[s])
    .filter((k) => k && itemDef(k).maxDur);
  if (armour.length) damageItem(armour[randInt(0, armour.length - 1)], 1);
}

function damageItem(key, amount) {
  const d = itemDef(key);
  state.wear[key] = (state.wear[key] || 0) + amount;
  if (state.wear[key] >= d.maxDur) {
    state.equipment[d.slot] = null;
    state.wear[key] = 0;
    say(`Your ${itemName(key).toLowerCase()} broke beyond saving.`);
    toast(`${itemName(key)} broke`);
  }
}

function repairCost(key) {
  const d = itemDef(key);
  const dmg = state.wear[key] || 0;
  if (!d.maxDur || dmg <= 0) return null;
  return { mat: d.repairMat, qty: Math.max(1, Math.ceil(dmg / 80)) };
}

function repairItem(key) {
  const cost = repairCost(key);
  if (!cost) return;
  if (haveQty(cost.mat) < cost.qty) { say(`Need ${cost.qty} ${itemName(cost.mat).toLowerCase()} to repair.`); render(); return; }
  spend(cost.mat, cost.qty);
  state.wear[key] = 0;
  say(`Repaired your ${itemName(key).toLowerCase()}.`);
  render();
}

/* ---- salvage ---- */

function salvageValue(key) {
  const d = itemDef(key);
  if (d.kind !== "gear" || !d.craft) return null;
  const qty = Math.max(1, Math.floor(d.craft.qty * 0.4));
  const tier = TIERS[d.craft.tier - 1];
  const prof = PROFESSIONS.find((p) => p.id === d.prof);
  return { mat: matId(tier, prof.mat), qty };
}

function salvage(key) {
  const out = salvageValue(key);
  if (!out) return;
  removeFrom(storeView, key, 1);
  if (!addTo("inv", out.mat, out.qty)) addTo("bank", out.mat, out.qty);
  say(`Salvaged ${itemName(key).toLowerCase()} into ${out.qty} ${itemName(out.mat).toLowerCase()}.`);
  render();
}

/* ================= 13. TASKS ================= */

function newSkillTask(skillId, actionId) {
  return { skillId, actionId, progress: 0, done: 0, startedAt: Date.now(), queued: null };
}

function newCombatTask(monsterId) {
  const mob = getMonster(monsterId);
  return {
    monsterId, mobHp: mob.hp, mobMax: mob.hp,
    playerTimer: PLAYER_SWING_MS, mobTimer: mob.speed,
    respawn: 0, done: 0, startedAt: Date.now(), queued: null,
  };
}

function selectSkillAction(skillId, actionId) {
  const def = findAction(skillId, actionId);
  if (!def || skillLevel(skillId) < def.level) return;

  const t = state.tasks.skilling;
  if (!t) { state.tasks.skilling = newSkillTask(skillId, actionId); render(); return; }

  if (t.skillId === skillId && t.actionId === actionId) {
    t.queued = t.queued === "stop" ? null : "stop";   // toggle a queued stop
  } else {
    t.queued = { skillId, actionId };                  // queue the switch
    say(`Queued ${def.name.toLowerCase()} — finishing the current action first.`);
  }
  render();
}

function selectMonster(monsterId) {
  if (!state.unlocked.combat) return;
  const t = state.tasks.combat;
  if (!t) { state.tasks.combat = newCombatTask(monsterId); state.player.hp = maxHp(); render(); return; }

  if (t.monsterId === monsterId) {
    t.queued = t.queued === "stop" ? null : "stop";
  } else {
    t.queued = monsterId;
    say("Queued a new target — finishing this fight first.");
  }
  render();
}

/* ---- projections for the taskbar ---- */

function skillPlan() {
  const t = state.tasks.skilling;
  if (!t) return null;
  const def = findAction(t.skillId, t.actionId);
  if (!def) return null;

  const elapsed = Date.now() - t.startedAt;
  const windowLeft = Math.max(0, IDLE_CAP_MS - elapsed);
  let remaining = Math.floor(windowLeft / def.time);
  let capped = null;

  if (def.cost) {
    let byMats = Infinity;
    Object.keys(def.cost).forEach((k) => { byMats = Math.min(byMats, Math.floor(haveQty(k) / def.cost[k])); });
    if (byMats < remaining) { remaining = byMats; capped = "materials"; }
  }

  return {
    def, done: t.done, target: t.done + remaining, remaining,
    timeLeft: remaining * def.time - t.progress, capped,
    pct: clamp((t.progress / def.time) * 100, 0, 100),
  };
}

function combatPlan() {
  const t = state.tasks.combat;
  if (!t) return null;
  const mob = getMonster(t.monsterId);
  if (!mob) return null;

  const atk = attackPower();
  const avgHit = Math.max(1, (atk * 0.55 + atk) / 2 - mob.defence * 0.35);
  const killMs = (mob.hp / avgHit) * PLAYER_SWING_MS + RESPAWN_MS;
  const elapsed = Date.now() - t.startedAt;
  const windowLeft = Math.max(0, IDLE_CAP_MS - elapsed);
  const remaining = Math.floor(windowLeft / killMs);

  const incoming = Math.max(1, (mob.attack * 0.55 + mob.attack) / 2 - defencePower() * 0.4);
  const dmgRate = incoming / mob.speed;
  const food = bestFood();
  const foodNeed = food ? Math.ceil((dmgRate * windowLeft) / itemDef(food).heal) : null;

  return {
    mob, done: t.done, target: t.done + remaining, remaining,
    timeLeft: remaining * killMs, killMs,
    pct: t.respawn > 0 ? 0 : clamp((t.mobHp / t.mobMax) * 100, 0, 100),
    food, foodNeed, foodHave: food ? haveQty(food) : 0,
  };
}

/* ================= 14. ACCOUNTS + SAVE ================= */
/* Local accounts only — the save lives in this browser under a
   per-username key. Real cross-device accounts need a server;
   syncSave() is the single place to wire that up later. */

function hashPass(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return String(h);
}

function readAccounts() {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "{}"); } catch (e) { return {}; }
}
function writeAccounts(a) {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(a)); } catch (e) { /* ignore */ }
}

function saveKey() {
  return state.meta.account ? `${SAVE_PREFIX}_${state.meta.account}` : `${SAVE_PREFIX}_guest`;
}

function save() {
  state.meta.lastSeen = Date.now();
  try {
    localStorage.setItem(saveKey(), JSON.stringify(state));
    return true;
  } catch (e) {
    const n = el("saveNote");
    if (n) n.textContent = "Can't write to storage here. Use the live site or a local server.";
    return false;
  }
}

function createAccount(user, pass) {
  user = (user || "").trim().toLowerCase();
  if (user.length < 3) return "Username needs at least 3 characters.";
  if ((pass || "").length < 4) return "Password needs at least 4 characters.";
  const accounts = readAccounts();
  if (accounts[user]) return "That username is taken on this browser.";
  accounts[user] = { hash: hashPass(pass), created: Date.now() };
  writeAccounts(accounts);
  state.meta.account = user;
  save();
  return null;
}

function loginAccount(user, pass) {
  user = (user || "").trim().toLowerCase();
  const accounts = readAccounts();
  if (!accounts[user]) return "No account with that name on this browser.";
  if (accounts[user].hash !== hashPass(pass)) return "Wrong password.";

  const raw = localStorage.getItem(`${SAVE_PREFIX}_${user}`);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const lastSeen = (parsed.meta && parsed.meta.lastSeen) || Date.now();
      state = migrate(parsed);
      state.meta.account = user;
      const gone = Date.now() - lastSeen;
      if (gone > 30000) catchUp({ ms: Math.min(gone, IDLE_CAP_MS), overCap: gone > IDLE_CAP_MS });
    } catch (e) { return "That account's save is corrupted."; }
  } else {
    state = freshState();
    state.meta.account = user;
  }
  selected = null;
  render();
  return null;
}

function logoutAccount() {
  save();
  state = freshState();
  selected = null;
  render();
}

function migrate(loaded) {
  const base = freshState();
  if (!loaded || typeof loaded !== "object") return base;

  const m = Object.assign(base, loaded);
  m.schema = SCHEMA;
  m.meta = Object.assign(base.meta, loaded.meta || {});
  m.player = Object.assign(base.player, loaded.player || {});
  m.skills = Object.assign(base.skills, loaded.skills || {});
  m.inv = Object.assign(base.inv, loaded.inv || {});
  m.bank = Object.assign(base.bank, loaded.bank || {});
  m.inv.items = Object.assign({}, (loaded.inv && loaded.inv.items) || {});
  m.bank.items = Object.assign({}, (loaded.bank && loaded.bank.items) || {});
  m.inv.order = ((loaded.inv && loaded.inv.order) || []).slice();
  m.bank.order = ((loaded.bank && loaded.bank.order) || []).slice();
  m.equipment = Object.assign(base.equipment, loaded.equipment || {});
  m.wear = Object.assign({}, loaded.wear || {});
  m.tasks = Object.assign(base.tasks, loaded.tasks || {});
  m.travel = Object.assign(base.travel, loaded.travel || {});
  m.unlocked = Object.assign(base.unlocked, loaded.unlocked || {});
  m.stats = Object.assign(base.stats, loaded.stats || {});
  m.log = (loaded.log || []).slice(-60);

  // Strip anything pointing at content that no longer exists.
  ["inv", "bank"].forEach((w) => {
    Object.keys(m[w].items).forEach((k) => { if (!itemDef(k)) delete m[w].items[k]; });
    m[w].order = m[w].order.filter((k) => itemDef(k));
  });
  EQUIP_SLOTS.forEach((s) => { if (m.equipment[s] && !itemDef(m.equipment[s])) m.equipment[s] = null; });
  if (m.tasks.skilling && !findAction(m.tasks.skilling.skillId, m.tasks.skilling.actionId)) m.tasks.skilling = null;
  if (m.tasks.combat && !getMonster(m.tasks.combat.monsterId)) m.tasks.combat = null;
  if (m.tasks.skilling && typeof m.tasks.skilling.done !== "number") m.tasks.skilling.done = 0;
  if (m.tasks.combat && typeof m.tasks.combat.done !== "number") m.tasks.combat.done = 0;
  return m;
}

function bootLoad() {
  const accounts = readAccounts();
  let key = `${SAVE_PREFIX}_guest`;
  // Reattach to the most recently used account, if any.
  let newest = null;
  Object.keys(accounts).forEach((u) => {
    const raw = localStorage.getItem(`${SAVE_PREFIX}_${u}`);
    if (!raw) return;
    try {
      const p = JSON.parse(raw);
      const ls = (p.meta && p.meta.lastSeen) || 0;
      if (!newest || ls > newest.ls) newest = { user: u, ls, raw };
    } catch (e) { /* skip */ }
  });
  if (newest) key = `${SAVE_PREFIX}_${newest.user}`;

  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) { raw = null; }
  if (!raw) return null;

  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return null; }
  const lastSeen = (parsed.meta && parsed.meta.lastSeen) || Date.now();
  state = migrate(parsed);

  const gone = Date.now() - lastSeen;
  if (gone <= 30000) return null;
  return { ms: Math.min(gone, IDLE_CAP_MS), overCap: gone > IDLE_CAP_MS };
}

function catchUp(result) {
  const step = 1000;
  let left = result.ms, guard = 0;
  while (left > 0 && (state.tasks.skilling || state.tasks.combat) && guard++ < 100000) {
    tick(Math.min(step, left));
    left -= step;
  }
  state.meta.playtimeMs += result.ms;
  if (result.overCap && (state.tasks.skilling || state.tasks.combat)) {
    state.tasks.skilling = null;
    state.tasks.combat = null;
    say("Twelve hours passed. Everything wound down — set new tasks.");
    toast("Idle limit reached — retask to continue");
  } else if (result.ms > 5 * 60 * 1000) {
    say(`Away ${fmtTime(result.ms)}. The camp kept working.`);
  }
}

function exportSave() {
  state.meta.lastSeen = Date.now();
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
}

function importSave(str) {
  let json;
  try { json = decodeURIComponent(escape(atob((str || "").trim()))); }
  catch (e) { return "That isn't a Respite save string."; }
  let parsed;
  try { parsed = JSON.parse(json); } catch (e) { return "Save string is corrupted."; }
  if (!parsed.skills) return "Save string has no character in it.";
  const acct = state.meta.account;
  state = migrate(parsed);
  state.meta.account = acct;
  save();
  selected = null;
  render();
  return null;
}

/* ================= 15. PLAYER ACTIONS ================= */

function travelTo(regionId) {
  const r = REGIONS.find((x) => x.id === regionId);
  if (!r) return;
  if (!state.travel.unlocked.includes(regionId)) {
    if (state.player.gold < r.cost) { say(`Passage to ${r.name} costs ${fmt(r.cost)} gold.`); render(); return; }
    state.player.gold -= r.cost;
    state.travel.unlocked.push(regionId);
    say(`Paid ${fmt(r.cost)} gold for passage to ${r.name}.`);
    toast(`${r.name} unlocked`);
  }
  regionView = regionId;
  tab = "regions";
  render();
}

function equip(key) {
  const d = itemDef(key);
  if (!d || !d.slot) return;

  if (d.slot === "weapon" && d.twoHanded && state.equipment.offhand) {
    if (!addTo("inv", state.equipment.offhand, 1)) { say("No bag room to stow your offhand."); render(); return; }
    state.equipment.offhand = null;
  }
  if (d.slot === "offhand") {
    const w = state.equipment.weapon;
    if (w && itemDef(w).twoHanded) { say(`Both hands are on the ${itemName(w).toLowerCase()}.`); render(); return; }
  }

  const old = state.equipment[d.slot];
  if (old && !addTo("inv", old, 1)) { say("No bag room for the gear you're taking off."); render(); return; }
  removeFrom(storeView, key, 1);
  state.equipment[d.slot] = key;
  render();
}

function unequip(slot) {
  const key = state.equipment[slot];
  if (!key) return;
  if (!addTo("inv", key, 1)) { say("No bag room for that."); render(); return; }
  state.equipment[slot] = null;
  render();
}

function sell(key, all) {
  const qty = all ? qtyIn(storeView, key) : 1;
  if (qty <= 0) return;
  state.player.gold += itemDef(key).value * qty;
  removeFrom(storeView, key, qty);
  render();
}

function transfer(key, all) {
  const from = storeView;
  const to = from === "inv" ? "bank" : "inv";
  const qty = all ? qtyIn(from, key) : 1;
  if (qty <= 0) return;
  if (!store(to).items[key] && storeFull(to)) {
    say(`${to === "bank" ? "Vault" : "Bag"} is full.`);
    render();
    return;
  }
  removeFrom(from, key, qty);
  addTo(to, key, qty);
  render();
}

function useChest(key) {
  if (parseKey(key).base !== "storage_chest") return;
  if (state.bank.slots >= BANK_MAX) { say("The vault can't hold any more shelves."); render(); return; }
  removeFrom(storeView, key, 1);
  state.bank.slots = Math.min(BANK_MAX, state.bank.slots + MATERIALS.storage_chest.chest);
  say(`Vault expanded to ${state.bank.slots} slots.`);
  render();
}

/* ================= 16. RENDER ================= */

let keys = {};
let skillRefs = [], monsterRefs = [];

function render() { keys = {}; renderAll(); }

function renderAll() {
  renderTaskbar();
  renderTabs();
  renderSideNav();
  if (tab === "regions") renderRegion();
  if (tab === "camp") renderCamp();
  if (tab === "inventory") renderInventory();
  if (tab === "skills") renderSkillTable();
  renderLog();
}

/* ---- taskbar ---- */

function renderTaskbar() {
  el("goldText").textContent = fmt(state.player.gold);
  const hp = Math.max(0, Math.ceil(state.player.hp));
  el("hpFill").style.width = clamp((hp / maxHp()) * 100, 0, 100) + "%";
  el("hpText").textContent = `${hp}/${maxHp()}`;

  const sp = skillPlan();
  const sBar = el("tbSkillBar");
  if (sp) {
    el("tbSkillTitle").textContent = `${sp.def.name} (${skillName(state.tasks.skilling.skillId)})`;
    // Avoid animating the snap back to zero at the end of each cycle.
    sBar.classList.toggle("nojump", sp.pct < 6);
    sBar.style.width = sp.pct + "%";
    let line = `${fmt(sp.done)} / ${fmt(sp.target)} actions \u00B7 ${fmtTime(sp.timeLeft)} left`;
    if (sp.capped) line += " (materials)";
    if (state.tasks.skilling.queued) {
      line += state.tasks.skilling.queued === "stop" ? " \u00B7 stopping after this" : " \u00B7 switching after this";
    }
    el("tbSkillProj").textContent = line;
    el("tbSkillClear").classList.toggle("queued", !!state.tasks.skilling.queued);
  } else {
    el("tbSkillTitle").textContent = "Idle";
    sBar.style.width = "0";
    el("tbSkillProj").textContent = "Nothing tasked.";
    el("tbSkillClear").classList.remove("queued");
  }

  const cp = combatPlan();
  const cBar = el("tbCombatBar");
  if (cp) {
    el("tbCombatTitle").textContent = cp.mob.name;
    cBar.style.width = cp.pct + "%";
    let line = `${fmt(cp.done)} / ${fmt(cp.target)} kills \u00B7 ${fmtTime(cp.timeLeft)} left`;
    if (cp.food) line += ` \u00B7 food ${fmt(cp.foodHave)}/${fmt(cp.foodNeed)}`;
    else line += " \u00B7 no food banked";
    if (state.tasks.combat.queued) line += " \u00B7 changing after this";
    el("tbCombatProj").textContent = line;
    el("tbCombatClear").classList.toggle("queued", !!state.tasks.combat.queued);
  } else {
    el("tbCombatTitle").textContent = "Idle";
    cBar.style.width = "0";
    el("tbCombatProj").textContent = state.unlocked.combat
      ? "Pick a target in a region."
      : `Unlocks at total level ${COMBAT_UNLOCK_TOTAL} (you are ${totalLevel()}).`;
    el("tbCombatClear").classList.remove("queued");
  }
}

/* ---- nav ---- */

function renderTabs() {
  if (keys.tabs === tab) return;
  keys.tabs = tab;
  document.querySelectorAll(".tabbtn").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  [["regions", "viewRegions"], ["camp", "viewCamp"], ["inventory", "viewInventory"], ["skills", "viewSkills"]]
    .forEach(([t, id]) => { el(id).hidden = tab !== t; });
}

function renderSideNav() {
  const unlockedRegions = state.travel.unlocked;
  const rKey = regionView + "|" + unlockedRegions.join(",") + "|" + REGIONS.filter((r) => state.player.gold >= r.cost).length;
  if (keys.rnav !== rKey) {
    keys.rnav = rKey;
    const box = el("regionNav");
    box.innerHTML = "";
    REGIONS.forEach((r) => {
      const unlocked = unlockedRegions.includes(r.id);
      const b = document.createElement("button");
      b.className = "subbtn" + (regionView === r.id && tab === "regions" ? " on" : "") + (unlocked ? "" : " locked");
      b.innerHTML = '<span class="subbtn-name"></span><span class="subbtn-lvl"></span>';
      b.children[0].textContent = r.name;
      b.children[1].textContent = unlocked ? `T${r.tier}` : `${fmt(r.cost)}g`;
      b.onclick = () => { if (unlocked) { regionView = r.id; tab = "regions"; render(); } else travelTo(r.id); };
      box.appendChild(b);
    });
  }

  const profs = PROFESSIONS.concat([{ id: "cooking", name: "Cooking" }]).filter((p) => state.unlocked[p.id]);
  const cKey = profView + "|" + profs.map((p) => p.id + skillLevel(p.id)).join(",") + "|" +
    (state.tasks.skilling ? state.tasks.skilling.skillId : "-");
  if (keys.cnav !== cKey) {
    keys.cnav = cKey;
    const box = el("campNav");
    box.innerHTML = "";
    profs.forEach((p) => {
      const b = document.createElement("button");
      b.className = "subbtn" + (profView === p.id && tab === "camp" ? " on" : "") +
        (state.tasks.skilling && state.tasks.skilling.skillId === p.id ? " busy" : "");
      b.innerHTML = '<span class="subbtn-name"></span><span class="subbtn-lvl"></span>';
      b.children[0].textContent = p.name;
      b.children[1].textContent = skillLevel(p.id);
      b.onclick = () => { profView = p.id; tab = "camp"; render(); };
      box.appendChild(b);
    });
  }
}

/* ---- region view ---- */

function renderRegion() {
  const r = REGIONS.find((x) => x.id === regionView) || REGIONS[0];
  const t = TIERS[r.tier - 1];
  const task = state.tasks.skilling;
  const ctask = state.tasks.combat;

  const key = `${r.id}|${GATHER_SKILLS.map((s) => skillLevel(s.id)).join(",")}|` +
    `${task ? task.skillId + task.actionId + (task.queued ? "q" : "") : "-"}|` +
    `${ctask ? ctask.monsterId + (ctask.queued ? "q" : "") : "-"}|${state.unlocked.combat}`;
  if (keys.region === key) { updateSkillCards(); updateMonsterCards(); return; }
  keys.region = key;
  skillRefs = []; monsterRefs = [];

  const img = el("regionImg");
  if (img.dataset.seed !== r.id) { img.dataset.seed = r.id; img.src = r.img; }
  el("regionName").textContent = r.name;
  el("regionNote").textContent = r.note;
  el("regionMeta").textContent = `Tier ${r.tier} \u00B7 gear and nodes around level ${r.level}`;

  // gathering nodes — one per gathering skill, all at this region's tier
  const nodes = el("regionNodes");
  nodes.innerHTML = "";
  GATHER_SKILLS.forEach((skill) => {
    const def = GATHER_ACTIONS[skill.id][r.tier - 1];
    nodes.appendChild(buildActionCard(def, skill.id));
  });

  // one monster
  const mbox = el("regionMonster");
  mbox.innerHTML = "";
  if (!state.unlocked.combat) {
    const p = document.createElement("p");
    p.className = "view-note";
    p.textContent = `Combat unlocks at total level ${COMBAT_UNLOCK_TOTAL}. You are ${totalLevel()}.`;
    mbox.appendChild(p);
  } else {
    mbox.appendChild(buildMonsterCard(monsterOfTier(r.tier)));
  }

  updateSkillCards();
  updateMonsterCards();
}

function buildActionCard(def, skillId) {
  const lvl = skillLevel(skillId);
  const locked = lvl < def.level;
  const t = state.tasks.skilling;
  const active = !!(t && t.skillId === skillId && t.actionId === def.id && (!t.queued || t.queued === "stop"));
  const queued = !!(t && t.queued && t.queued !== "stop" && t.queued.actionId === def.id);

  const card = document.createElement("button");
  card.className = "card" + (locked ? " locked" : "") + (active ? " on" : "") + (queued ? " queued" : "");
  card.disabled = locked;

  const top = document.createElement("div");
  top.className = "card-top";
  top.innerHTML = '<span class="card-icon"></span><span class="card-name"></span>';
  top.children[0].textContent = def.icon;
  top.children[1].textContent = def.name;
  card.appendChild(top);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = locked
    ? `Needs ${skillName(skillId)} ${def.level}`
    : `${(def.time / 1000).toFixed(0)}s \u00B7 ${fmt(def.xp)} xp \u00B7 ${skillName(skillId)} ${lvl}`;
  card.appendChild(meta);

  let costEl = null;
  if (def.cost && !locked) { costEl = document.createElement("div"); costEl.className = "card-cost"; card.appendChild(costEl); }

  let planEl = null;
  if (!locked) { planEl = document.createElement("div"); planEl.className = "card-plan"; card.appendChild(planEl); }

  const prog = document.createElement("div");
  prog.className = "card-prog";
  card.appendChild(prog);

  card.onclick = () => selectSkillAction(skillId, def.id);
  skillRefs.push({ def, skillId, active, costEl, planEl, prog });
  return card;
}

function updateSkillCards() {
  const t = state.tasks.skilling;
  skillRefs.forEach((ref) => {
    if (ref.costEl) {
      ref.costEl.innerHTML = "";
      ref.costEl.appendChild(document.createTextNode("Uses "));
      Object.keys(ref.def.cost).forEach((k, i) => {
        const span = document.createElement("span");
        if (haveQty(k) < ref.def.cost[k]) span.className = "short";
        span.textContent = `${i ? ", " : ""}${ref.def.cost[k]}\u00D7 ${itemName(k).toLowerCase()} (${fmt(haveQty(k))})`;
        ref.costEl.appendChild(span);
      });
    }

    // Per-action detail lives here, on the card, not in the taskbar.
    if (ref.planEl) {
      const per12h = Math.floor(IDLE_CAP_MS / ref.def.time);
      let line = `12h idle: ${fmt(per12h)} actions, ${fmt(per12h * ref.def.xp)} xp`;
      if (ref.def.cost) {
        let byMats = Infinity;
        Object.keys(ref.def.cost).forEach((k) => { byMats = Math.min(byMats, Math.floor(haveQty(k) / ref.def.cost[k])); });
        if (byMats < per12h) line += ` \u2014 stock covers ${fmt(byMats)}`;
      }
      const lvl = skillLevel(ref.skillId);
      if (lvl < MAX_LEVEL) {
        const need = XP_TABLE[lvl + 1] - (state.skills[ref.skillId] || 0);
        line += ` \u00B7 next level in ${fmt(Math.ceil(need / ref.def.xp))} actions`;
      }
      ref.planEl.textContent = line;
    }

    const isActive = t && t.skillId === ref.skillId && t.actionId === ref.def.id;
    if (isActive) {
      const pct = clamp((t.progress / ref.def.time) * 100, 0, 100);
      ref.prog.classList.toggle("nojump", pct < 6);
      ref.prog.style.width = pct + "%";
    } else {
      ref.prog.style.width = "0";
    }
  });
}

function buildMonsterCard(mob) {
  const t = state.tasks.combat;
  const active = !!(t && t.monsterId === mob.id && (!t.queued || t.queued === "stop"));
  const queued = !!(t && t.queued && t.queued !== "stop" && t.queued === mob.id);

  const card = document.createElement("button");
  card.className = "card" + (active ? " on" : "") + (queued ? " queued" : "");

  const top = document.createElement("div");
  top.className = "card-top";
  top.innerHTML = '<span class="card-icon"></span><span class="card-name"></span>';
  top.children[0].textContent = mob.icon;
  top.children[1].textContent = mob.name;
  card.appendChild(top);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = `Level ${mob.level} \u00B7 ${fmt(mob.hp)} hp \u00B7 ${fmt(mob.attack)} atk \u00B7 ${fmt(mob.xp)} xp`;
  card.appendChild(meta);

  const drops = document.createElement("div");
  drops.className = "card-cost";
  drops.textContent = "Drops " + mob.drops.map(([k]) => itemName(k).toLowerCase()).join(", ");
  card.appendChild(drops);

  const plan = document.createElement("div");
  plan.className = "card-plan";
  card.appendChild(plan);

  const bar = document.createElement("div");
  bar.className = "card-hp";
  const hpFill = document.createElement("div");
  hpFill.className = "card-hp-fill";
  bar.appendChild(hpFill);
  card.appendChild(bar);

  const prog = document.createElement("div");
  prog.className = "card-prog combat";
  card.appendChild(prog);

  card.onclick = () => selectMonster(mob.id);
  monsterRefs.push({ mob, hpFill, prog, plan });
  return card;
}

function updateMonsterCards() {
  const t = state.tasks.combat;
  monsterRefs.forEach((ref) => {
    const atk = attackPower();
    const avgHit = Math.max(1, (atk * 0.55 + atk) / 2 - ref.mob.defence * 0.35);
    const killMs = (ref.mob.hp / avgHit) * PLAYER_SWING_MS + RESPAWN_MS;
    ref.plan.textContent = `~${fmtTime(killMs)} per kill \u00B7 ${fmt(Math.floor(IDLE_CAP_MS / killMs))} kills per 12h idle`;

    const isActive = t && t.monsterId === ref.mob.id;
    if (isActive) {
      ref.hpFill.style.width = clamp((t.mobHp / t.mobMax) * 100, 0, 100) + "%";
      const swing = t.respawn > 0 ? 0 : (1 - t.playerTimer / PLAYER_SWING_MS) * 100;
      ref.prog.classList.toggle("nojump", swing < 6);
      ref.prog.style.width = clamp(swing, 0, 100) + "%";
    } else {
      ref.hpFill.style.width = "100%";
      ref.prog.style.width = "0";
    }
  });
}

/* ---- camp view ---- */

function renderCamp() {
  const prof = PROFESSIONS.find((p) => p.id === profView);
  const isCooking = profView === "cooking";
  const lvl = skillLevel(profView);
  const xp = state.skills[profView] || 0;
  const base = XP_TABLE[lvl];
  const next = XP_TABLE[Math.min(lvl + 1, MAX_LEVEL)];

  el("profTitle").textContent = skillName(profView);
  el("profNote").textContent = isCooking
    ? "Raw fish into food. Food is what keeps you standing in a long fight. Feeds on Fishing."
    : (prof ? prof.note : "");
  el("profLevel").textContent = `Level ${lvl}`;
  el("profXpFill").style.width = clamp(lvl >= MAX_LEVEL ? 100 : ((xp - base) / (next - base)) * 100, 0, 100) + "%";
  el("profXpText").textContent = `${fmt(xp)} / ${fmt(next)} xp`;

  const t = state.tasks.skilling;
  const key = `${profView}|${lvl}|${t ? t.skillId + t.actionId + (t.queued ? "q" : "") : "-"}`;
  if (keys.camp === key) { updateSkillCards(); return; }
  keys.camp = key;
  skillRefs = [];

  const box = el("profActions");
  box.innerHTML = "";
  actionsFor(profView)
    .filter((a) => a.level <= lvl + 25)   // hide far-future recipes to keep the list readable
    .forEach((def) => box.appendChild(buildActionCard(def, profView)));

  updateSkillCards();
}

/* ---- inventory ---- */

function renderInventory() {
  const s = store(storeView);
  const ids = orderedKeys(storeView);
  const key = `${storeView}|${ids.map((k) => k + ":" + s.items[k]).join(",")}|${s.slots}|${selected}|${state.player.gold}`;

  if (keys.inv !== key) {
    keys.inv = key;
    el("storeTitle").textContent = storeView === "inv" ? "Bag" : "Vault";
    el("storeCount").textContent = `${slotsUsed(storeView)} / ${s.slots} slots`;
    el("storeNote").textContent = storeView === "inv"
      ? "Everything you gather lands here. If it fills up, your task stops."
      : "Long-term storage. Craft storage chests in Woodworking to add shelves.";
    renderGrid(ids);
    renderDetail();
  }

  const eKey = EQUIP_SLOTS.map((sl) => sl + ":" + state.equipment[sl] + ":" + (state.wear[state.equipment[sl]] || 0)).join(",");
  if (keys.equip !== eKey) {
    keys.equip = eKey;
    renderEquip();
    renderStats();
  }
}

function renderGrid(ids) {
  const grid = el("invGrid");
  grid.innerHTML = "";
  const s = store(storeView);

  for (let i = 0; i < s.slots; i++) {
    const key = ids[i];
    const cell = document.createElement("div");
    const d = key ? itemDef(key) : null;
    cell.className = "cell" + (key ? "" : " empty") + (key === selected ? " on" : "") +
      (d && d.rarity && d.rarity !== "common" ? ` r-${d.rarity}` : "");
    cell.tabIndex = key ? 0 : -1;

    if (key) {
      cell.textContent = d.icon;
      cell.title = `${itemName(key)} \u00D7 ${s.items[key]}`;
      const q = document.createElement("span");
      q.className = "cell-qty";
      q.textContent = fmt(s.items[key]);
      cell.appendChild(q);

      cell.draggable = true;
      cell.onclick = () => { selected = selected === key ? null : key; keys.inv = ""; renderInventory(); };
      cell.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cell.onclick(); } };
      cell.ondragstart = (e) => e.dataTransfer.setData("text/plain", key);
      cell.ondragover = (e) => { e.preventDefault(); cell.classList.add("dragover"); };
      cell.ondragleave = () => cell.classList.remove("dragover");
      cell.ondrop = (e) => {
        e.preventDefault(); cell.classList.remove("dragover");
        const from = e.dataTransfer.getData("text/plain");
        if (from && from !== key) reorder(from, key);
      };
    }
    grid.appendChild(cell);
  }
}

function reorder(fromKey, toKey) {
  const ids = orderedKeys(storeView);
  const a = ids.indexOf(fromKey), b = ids.indexOf(toKey);
  if (a < 0 || b < 0) return;
  ids.splice(a, 1);
  ids.splice(b, 0, fromKey);
  store(storeView).order = ids;
  keys.inv = "";
  renderInventory();
}

function renderDetail() {
  const box = el("invDetail");
  box.innerHTML = "";
  if (!selected || !store(storeView).items[selected]) { box.textContent = "Select an item."; return; }

  const d = itemDef(selected);
  const qty = qtyIn(storeView, selected);

  const head = document.createElement("div");
  const nameSpan = document.createElement("span");
  nameSpan.className = "dname" + (d.rarity ? " rar-" + d.rarity : "");
  nameSpan.textContent = `${d.icon} ${itemName(selected)}`;
  const sub = document.createElement("span");
  sub.className = "muted";
  sub.textContent = ` \u00D7${fmt(qty)} \u00B7 ${fmt(d.value)}g each`;
  head.appendChild(nameSpan);
  head.appendChild(sub);
  box.appendChild(head);

  const bits = [];
  if (d.attack) bits.push(`+${d.attack} attack`);
  if (d.defence) bits.push(`+${d.defence} defence`);
  if (d.health) bits.push(`+${d.health} max hp`);
  if (d.heal) bits.push(`heals ${d.heal}`);
  if (d.twoHanded) bits.push("two-handed");
  if (d.maxDur) bits.push(`${fmt(d.maxDur)} durability`);
  if (d.chest) bits.push(`+${d.chest} vault slots`);
  if (bits.length) {
    const st = document.createElement("div");
    st.className = "muted tiny";
    st.textContent = bits.join(" \u00B7 ");
    box.appendChild(st);
  }

  const row = document.createElement("div");
  row.className = "btnrow";
  const add = (label, fn, cls) => {
    const b = document.createElement("button");
    b.className = "btn" + (cls ? " " + cls : "");
    b.textContent = label;
    b.onclick = fn;
    row.appendChild(b);
  };

  if (d.slot) add(`Equip (${SLOT_LABELS[d.slot]})`, () => equip(selected));
  if (d.chest) add("Use chest", () => useChest(selected));
  add(storeView === "inv" ? "To vault" : "To bag", () => transfer(selected, false));
  add(storeView === "inv" ? "All to vault" : "All to bag", () => transfer(selected, true), "btn-quiet");
  if (salvageValue(selected)) {
    const sv = salvageValue(selected);
    add(`Salvage (${sv.qty}\u00D7 ${itemName(sv.mat).toLowerCase()})`, () => salvage(selected), "btn-quiet");
  }
  add(`Sell 1 (${fmt(d.value)}g)`, () => sell(selected, false));
  add(`Sell all (${fmt(d.value * qty)}g)`, () => sell(selected, true), "btn-quiet");
  box.appendChild(row);
}

function renderEquip() {
  const box = el("equipList");
  box.innerHTML = "";
  EQUIP_SLOTS.forEach((slot) => {
    const key = state.equipment[slot];
    const row = document.createElement("div");
    row.className = "equip-row";

    const label = document.createElement("span");
    label.className = "equip-slot";
    label.textContent = SLOT_LABELS[slot];
    row.appendChild(label);

    const name = document.createElement("span");
    name.className = "equip-name";
    if (key) {
      const d = itemDef(key);
      name.textContent = `${d.icon} ${itemName(key)}`;
      if (d.rarity && d.rarity !== "common") name.classList.add("rar-" + d.rarity);
    } else {
      name.textContent = "Empty";
      name.classList.add("muted");
    }
    row.appendChild(name);

    if (key) {
      const pct = wearPct(key);
      if (pct !== null) {
        const w = document.createElement("span");
        w.className = "equip-wear " + (pct > 60 ? "fine" : pct > 25 ? "worn" : "bad");
        w.textContent = pct + "%";
        row.appendChild(w);

        const cost = repairCost(key);
        if (cost) {
          const fix = document.createElement("button");
          fix.className = "minibtn";
          fix.textContent = `Fix ${cost.qty}\u00D7`;
          fix.title = `Repair with ${cost.qty} ${itemName(cost.mat).toLowerCase()}`;
          fix.disabled = haveQty(cost.mat) < cost.qty;
          fix.onclick = () => repairItem(key);
          row.appendChild(fix);
        }
      }
      const off = document.createElement("button");
      off.className = "minibtn";
      off.textContent = "Off";
      off.onclick = () => unequip(slot);
      row.appendChild(off);
    }
    box.appendChild(row);
  });
}

function renderStats() {
  const box = el("statList");
  box.innerHTML = "";
  const rows = [
    ["Attack", Math.round(attackPower())],
    ["Defence", Math.round(defencePower())],
    ["Max health", maxHp()],
    ["Combat level", skillLevel("combat")],
    ["Total level", totalLevel()],
    ["sep"],
    ["Kills", fmt(state.stats.kills)],
    ["Actions", fmt(state.stats.actions)],
    ["Items crafted", fmt(state.stats.crafted)],
    ["Epic rolls", fmt(state.stats.epics)],
    ["Deaths", fmt(state.stats.deaths)],
    ["Playtime", fmtTime(state.meta.playtimeMs)],
  ];
  rows.forEach((r) => {
    const d = document.createElement("div");
    d.className = "statrow" + (r[0] === "sep" ? " sep" : "");
    if (r[0] === "sep") { d.innerHTML = ""; box.appendChild(d); return; }
    d.innerHTML = "<span></span><span></span>";
    d.children[0].textContent = r[0];
    d.children[1].textContent = r[1];
    box.appendChild(d);
  });
}

/* ---- skills table ---- */

function renderSkillTable() {
  const key = SKILLS.map((s) => s.id + (state.skills[s.id] || 0)).join(",");
  if (keys.skilltable === key) return;
  keys.skilltable = key;

  el("totalLevelText").textContent = `Total level ${totalLevel()} of ${SKILLS.length * MAX_LEVEL}`;
  const box = el("skillTable");
  box.innerHTML = "";

  SKILLS.forEach((s) => {
    const lvl = skillLevel(s.id);
    const xp = state.skills[s.id] || 0;
    const base = XP_TABLE[lvl];
    const next = XP_TABLE[Math.min(lvl + 1, MAX_LEVEL)];
    const pct = lvl >= MAX_LEVEL ? 100 : ((xp - base) / (next - base)) * 100;

    const row = document.createElement("div");
    row.className = "skillrow";
    row.innerHTML = '<span></span><span class="sr-lvl"></span><span class="bar"><div></div></span><span class="sr-xp"></span>';
    row.children[0].textContent = `${s.icon} ${s.name}`;
    row.children[1].textContent = lvl;
    row.children[2].firstChild.style.width = clamp(pct, 0, 100) + "%";
    row.children[3].textContent = lvl >= MAX_LEVEL ? "max" : `${fmt(xp)} / ${fmt(next)}`;
    box.appendChild(row);
  });
}

function renderLog() {
  const key = state.log.length + "|" + (state.log[state.log.length - 1] || "");
  if (keys.log === key) return;
  keys.log = key;
  const box = el("eventLog");
  box.innerHTML = "";
  state.log.slice(-10).forEach((line) => {
    const d = document.createElement("div");
    d.textContent = line;
    box.appendChild(d);
  });
}

/* ================= 17. WIRING ================= */

document.querySelectorAll(".tabbtn").forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
document.querySelectorAll(".stab").forEach((b) => {
  b.onclick = () => {
    storeView = b.dataset.store;
    selected = null;
    document.querySelectorAll(".stab").forEach((x) => x.classList.toggle("on", x.dataset.store === storeView));
    keys.inv = "";
    renderInventory();
  };
});

el("tbSkillClear").onclick = () => {
  const t = state.tasks.skilling;
  if (!t) return;
  t.queued = t.queued === "stop" ? null : "stop";
  say(t.queued ? "Will stop after the current action finishes." : "Stop cancelled.");
  render();
};

el("tbCombatClear").onclick = () => {
  const t = state.tasks.combat;
  if (!t) return;
  t.queued = t.queued === "stop" ? null : "stop";
  say(t.queued ? "Will stop after this fight." : "Stop cancelled.");
  render();
};

el("settingsBtn").onclick = () => {
  el("shareBox").value = exportSave();
  refreshAccountUi();
  el("settingsModal").hidden = false;
};
el("settingsClose").onclick = () => { el("settingsModal").hidden = true; };

function refreshAccountUi() {
  const acct = state.meta.account;
  el("acctStatus").textContent = acct
    ? `Signed in as ${acct}. Progress autosaves to this account.`
    : "Playing as guest. Create an account to keep this character separate.";
  el("acctFields").hidden = !!acct;
  el("acctCreate").hidden = !!acct;
  el("acctLogin").hidden = !!acct;
  el("acctLogout").hidden = !acct;
  el("acctNote").textContent = "Accounts are stored in this browser only. Use the save string to move between devices until there's a server.";
}

el("acctCreate").onclick = () => {
  const err = createAccount(el("acctUser").value, el("acctPass").value);
  el("acctNote").textContent = err || `Account created. Signed in as ${state.meta.account}.`;
  if (!err) { el("acctPass").value = ""; refreshAccountUi(); render(); }
};

el("acctLogin").onclick = () => {
  const err = loginAccount(el("acctUser").value, el("acctPass").value);
  el("acctNote").textContent = err || `Signed in as ${state.meta.account}.`;
  if (!err) { el("acctPass").value = ""; refreshAccountUi(); }
};

el("acctLogout").onclick = () => {
  logoutAccount();
  refreshAccountUi();
};

el("shareCopy").onclick = () => {
  const box = el("shareBox");
  box.select();
  navigator.clipboard.writeText(box.value)
    .then(() => toast("Save string copied"))
    .catch(() => toast("Select the text and copy manually"));
};

el("shareLoad").onclick = () => {
  if (!confirm("Loading a save replaces your current character. Continue?")) return;
  const err = importSave(el("shareBox").value);
  toast(err || "Save loaded");
};

el("saveBtn").onclick = () => {
  if (save()) el("saveNote").textContent = "Saved at " + new Date().toLocaleTimeString() + ".";
};

el("wipeBtn").onclick = () => {
  if (!confirm("Delete this save permanently?")) return;
  try { localStorage.removeItem(saveKey()); } catch (e) { /* ignore */ }
  location.reload();
};

/* ================= 18. BOOT + LOOP ================= */

const away = bootLoad();
if (away) catchUp(away);
if (state.log.length === 0) say("You set down your pack in the meadow. The camp is yours to work.");
if (!state.travel.unlocked.includes(regionView)) regionView = "region_1";

render();

/* Logic ticks on wall-clock delta so a throttled tab can never desync.
   Bars are CSS-transitioned, so 60ms updates look continuous. */
let lastTick = Date.now();

function loop() {
  const now = Date.now();
  const dt = now - lastTick;
  lastTick = now;

  if (dt > 0) {
    tick(Math.min(dt, 60000));
    state.meta.playtimeMs += Math.min(dt, 60000);
  }

  renderTaskbar();
  if (tab === "regions") { updateSkillCards(); updateMonsterCards(); }
  if (tab === "camp") updateSkillCards();
  if (tab === "inventory") renderInventory();
  renderSideNav();
  renderLog();
}

setInterval(loop, 60);

document.addEventListener("visibilitychange", () => { if (!document.hidden) { lastTick = Date.now(); render(); } });

setInterval(save, 10000);
window.addEventListener("beforeunload", save);
