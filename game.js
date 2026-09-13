/* ============================================================
   Respite — a slow idle RPG
   Vanilla JS. No build step, no framework, no dependencies.

   Architecture notes:
   - Logic runs on a wall-clock delta (Date.now()), never on frame count,
     so background-tab throttling cannot desync progression.
   - Rendering is split from logic and only rebuilds DOM when a cache key
     changes, so buttons are never replaced between mousedown and mouseup.
   - Two tasks run at once: one skilling, one combat. They are independent.
   ============================================================ */

/* ================= 1. CONSTANTS ================= */

const SCHEMA = 3;
const SAVE_KEY = "respite_save_v3";
const CATCHUP_CAP_MS = 12 * 60 * 60 * 1000;   // 12h idle limit, then retask
const PROJECTION_MS = 12 * 60 * 60 * 1000;    // taskbar projects over 12h
const MAX_LEVEL = 99;
const PLAYER_SWING_MS = 2000;
const RESPAWN_MS = 1500;
const STARTING_SLOTS = 20;
const MAX_SLOTS = 80;
const COMBAT_UNLOCK_TOTAL = 30;

const EQUIP_SLOTS = ["weapon", "offhand", "head", "chest", "legs", "boots", "gloves", "ring", "amulet"];
const SLOT_LABELS = {
  weapon: "Weapon", offhand: "Offhand", head: "Head", chest: "Chest", legs: "Legs",
  boots: "Boots", gloves: "Gloves", ring: "Ring", amulet: "Amulet",
};

/* ================= 2. ITEMS ================= */

const ITEMS = {
  // ---- logs (tier every 10 levels) ----
  log:        { name: "Log",         icon: "\u{1FAB5}", value: 3 },
  oak_log:    { name: "Oak log",     icon: "\u{1FAB5}", value: 8 },
  willow_log: { name: "Willow log",  icon: "\u{1FAB5}", value: 18 },
  maple_log:  { name: "Maple log",   icon: "\u{1FAB5}", value: 40 },
  yew_log:    { name: "Yew log",     icon: "\u{1FAB5}", value: 95 },
  elder_log:  { name: "Elder log",   icon: "\u{1FAB5}", value: 220 },
  ash:        { name: "Ash",         icon: "\u{2728}",  value: 1 },

  // ---- ore + bars ----
  copper_ore:  { name: "Copper ore",  icon: "\u{1F7E4}", value: 4 },
  iron_ore:    { name: "Iron ore",    icon: "\u{26AA}",  value: 10 },
  coal:        { name: "Coal",        icon: "\u{26AB}",  value: 16 },
  silver_ore:  { name: "Silver ore",  icon: "\u{1F90D}", value: 38 },
  gold_ore:    { name: "Gold ore",    icon: "\u{1F7E1}", value: 85 },
  mithril_ore: { name: "Mithril ore", icon: "\u{1F535}", value: 190 },

  bronze_bar:  { name: "Bronze bar",  icon: "\u{1F7EB}", value: 18 },
  iron_bar:    { name: "Iron bar",    icon: "\u{2B1C}",  value: 45 },
  steel_bar:   { name: "Steel bar",   icon: "\u{1F518}", value: 110 },
  mithril_bar: { name: "Mithril bar", icon: "\u{1F537}", value: 300 },

  // ---- fish ----
  raw_shrimp:    { name: "Raw shrimp",    icon: "\u{1F990}", value: 2 },
  raw_trout:     { name: "Raw trout",     icon: "\u{1F41F}", value: 7 },
  raw_salmon:    { name: "Raw salmon",    icon: "\u{1F420}", value: 16 },
  raw_lobster:   { name: "Raw lobster",   icon: "\u{1F99E}", value: 38 },
  raw_swordfish: { name: "Raw swordfish", icon: "\u{1F421}", value: 88 },

  shrimp:    { name: "Shrimp",    icon: "\u{1F35B}", value: 5,   heal: 4 },
  trout:     { name: "Trout",     icon: "\u{1F35B}", value: 15,  heal: 9 },
  salmon:    { name: "Salmon",    icon: "\u{1F35B}", value: 34,  heal: 17 },
  lobster:   { name: "Lobster",   icon: "\u{1F35B}", value: 78,  heal: 30 },
  swordfish: { name: "Swordfish", icon: "\u{1F35B}", value: 170, heal: 52 },

  // ---- combat materials ----
  bones:       { name: "Bones",       icon: "\u{1F9B4}", value: 3 },
  pelt:        { name: "Wolf pelt",   icon: "\u{1F43A}", value: 24 },
  rock_shard:  { name: "Rock shard",  icon: "\u{1FAA8}", value: 55 },
  troll_tooth: { name: "Troll tooth", icon: "\u{1F9B7}", value: 130 },
  witch_ember: { name: "Witch ember", icon: "\u{1F525}", value: 320 },

  // ---- accessories (drops only, never crafted) ----
  copper_ring:  { name: "Copper ring",  icon: "\u{1F48D}", value: 70,   slot: "ring", attack: 2 },
  silver_ring:  { name: "Silver ring",  icon: "\u{1F48D}", value: 240,  slot: "ring", attack: 5 },
  gold_ring:    { name: "Gold ring",    icon: "\u{1F48D}", value: 700,  slot: "ring", attack: 10 },
  mithril_ring: { name: "Mithril ring", icon: "\u{1F48D}", value: 2200, slot: "ring", attack: 18 },

  bone_amulet:  { name: "Bone amulet",        icon: "\u{1F4FF}", value: 55,   slot: "amulet", health: 8 },
  pelt_amulet:  { name: "Pelt amulet",        icon: "\u{1F4FF}", value: 210,  slot: "amulet", health: 20 },
  troll_amulet: { name: "Troll-tooth amulet", icon: "\u{1F4FF}", value: 640,  slot: "amulet", health: 44 },
  ember_amulet: { name: "Ember amulet",       icon: "\u{1F4FF}", value: 2000, slot: "amulet", health: 90 },
};

/* ---- Gear is generated, not hand-written, so tiers stay consistent ---- */

const GEAR_TIERS = [
  { key: "bronze",  name: "Bronze",  level: 1,  bar: "bronze_bar",  atk: 5,  def: 4,  dur: 300 },
  { key: "iron",    name: "Iron",    level: 10, bar: "iron_bar",    atk: 11, def: 9,  dur: 600 },
  { key: "steel",   name: "Steel",   level: 20, bar: "steel_bar",   atk: 20, def: 16, dur: 1100 },
  { key: "mithril", name: "Mithril", level: 30, bar: "mithril_bar", atk: 34, def: 27, dur: 2000 },
];

const GEAR_SHAPES = [
  { key: "sword",      label: "sword",      slot: "weapon",  icon: "\u{1F5E1}", atkMul: 1.0, defMul: 0,   bars: 2, lvlOff: 3 },
  { key: "greatsword", label: "greatsword", slot: "weapon",  icon: "\u{2694}",  atkMul: 1.7, defMul: 0,   bars: 4, lvlOff: 8, twoHanded: true },
  { key: "shield",     label: "shield",     slot: "offhand", icon: "\u{1F6E1}", atkMul: 0,   defMul: 0.9, bars: 2, lvlOff: 5 },
  { key: "helm",       label: "helm",       slot: "head",    icon: "\u{1FA96}", atkMul: 0,   defMul: 0.5, bars: 2, lvlOff: 2 },
  { key: "platebody",  label: "platebody",  slot: "chest",   icon: "\u{1F455}", atkMul: 0,   defMul: 1.0, bars: 3, lvlOff: 6 },
  { key: "platelegs",  label: "platelegs",  slot: "legs",    icon: "\u{1F456}", atkMul: 0,   defMul: 0.75, bars: 3, lvlOff: 4 },
  { key: "boots",      label: "boots",      slot: "boots",   icon: "\u{1F462}", atkMul: 0,   defMul: 0.35, bars: 1, lvlOff: 1 },
  { key: "gloves",     label: "gloves",     slot: "gloves",  icon: "\u{1F9E4}", atkMul: 0,   defMul: 0.35, bars: 1, lvlOff: 1 },
];

const GEAR_RECIPES = []; // filled below, consumed by the smithing action list

GEAR_TIERS.forEach((tier) => {
  GEAR_SHAPES.forEach((shape) => {
    const id = `${tier.key}_${shape.key}`;
    const attack = Math.round(tier.atk * shape.atkMul);
    const defence = Math.round(tier.def * shape.defMul);
    ITEMS[id] = {
      name: `${tier.name} ${shape.label}`,
      icon: shape.icon,
      value: Math.round((attack * 22 + defence * 18 + 20) * (1 + tier.level / 30)),
      slot: shape.slot,
      tier: tier.key,
      repairBar: tier.bar,
      maxDur: tier.dur,
    };
    if (attack) ITEMS[id].attack = attack;
    if (defence) ITEMS[id].defence = defence;
    if (shape.twoHanded) ITEMS[id].twoHanded = true;

    GEAR_RECIPES.push({
      id: `sm_${id}`,
      name: ITEMS[id].name,
      icon: shape.icon,
      level: tier.level + shape.lvlOff,
      time: 6000 + shape.bars * 2500 + tier.level * 120,
      xp: Math.round((20 + tier.level * 4) * shape.bars * 0.8),
      cost: { [tier.bar]: shape.bars },
      out: { [id]: 1 },
    });
  });
});

/* ================= 3. SKILLS + ACTIONS ================= */

const SKILLS = [
  { id: "woodcutting", name: "Woodcutting", icon: "\u{1FA93}", kind: "skilling", note: "Cut trees for logs. Logs feed Firemaking and Alchemy." },
  { id: "mining",      name: "Mining",      icon: "\u{26CF}",  kind: "skilling", note: "Pull ore from the rock. Ore becomes bars, bars become gear." },
  { id: "fishing",     name: "Fishing",     icon: "\u{1F3A3}", kind: "skilling", note: "Catch raw fish. Cook it before you take it into a fight." },
  { id: "firemaking",  name: "Firemaking",  icon: "\u{1F525}", kind: "skilling", note: "Burns logs for xp. The ash is near worthless — this is xp, not profit." },
  { id: "cooking",     name: "Cooking",     icon: "\u{1F373}", kind: "skilling", note: "Turns raw fish into food. Food is eaten automatically mid-fight." },
  { id: "smithing",    name: "Smithing",    icon: "\u{1F528}", kind: "skilling", note: "Smelt ore into bars, hammer bars into gear. Bars also repair worn gear." },
  { id: "alchemy",     name: "Alchemy",     icon: "\u{2697}",  kind: "skilling", note: "Renders logs down into gold. Slow, steady, and never stops being useful." },
  { id: "combat",      name: "Combat",      icon: "\u{2694}",  kind: "combat",   note: "Fights resolve on their own. Bring food or you will wake up on the floor." },
];

const ACTIONS = {
  woodcutting: [
    { id: "wc_1", name: "Forest tree", icon: "\u{1F333}", level: 1,  time: 6000,  xp: 11,  out: { log: 1 } },
    { id: "wc_2", name: "Oak",         icon: "\u{1F333}", level: 10, time: 9000,  xp: 30,  out: { oak_log: 1 } },
    { id: "wc_3", name: "Willow",      icon: "\u{1F332}", level: 20, time: 13000, xp: 72,  out: { willow_log: 1 } },
    { id: "wc_4", name: "Maple",       icon: "\u{1F341}", level: 30, time: 19000, xp: 170, out: { maple_log: 1 } },
    { id: "wc_5", name: "Yew",         icon: "\u{1F334}", level: 40, time: 28000, xp: 400, out: { yew_log: 1 } },
    { id: "wc_6", name: "Elder",       icon: "\u{1F5FF}", level: 50, time: 42000, xp: 950, out: { elder_log: 1 } },
  ],
  mining: [
    { id: "mi_1", name: "Copper vein",  icon: "\u{1F7E4}", level: 1,  time: 6000,  xp: 11,  out: { copper_ore: 1 } },
    { id: "mi_2", name: "Iron vein",    icon: "\u{26AA}",  level: 10, time: 9000,  xp: 30,  out: { iron_ore: 1 } },
    { id: "mi_3", name: "Coal seam",    icon: "\u{26AB}",  level: 20, time: 13000, xp: 70,  out: { coal: 1 } },
    { id: "mi_4", name: "Silver vein",  icon: "\u{1F90D}", level: 30, time: 19000, xp: 165, out: { silver_ore: 1 } },
    { id: "mi_5", name: "Gold vein",    icon: "\u{1F7E1}", level: 40, time: 28000, xp: 390, out: { gold_ore: 1 } },
    { id: "mi_6", name: "Mithril vein", icon: "\u{1F535}", level: 50, time: 42000, xp: 930, out: { mithril_ore: 1 } },
  ],
  fishing: [
    { id: "fi_1", name: "Shrimp pool",  icon: "\u{1F990}", level: 1,  time: 6000,  xp: 11,  out: { raw_shrimp: 1 } },
    { id: "fi_2", name: "River bend",   icon: "\u{1F41F}", level: 10, time: 9500,  xp: 32,  out: { raw_trout: 1 } },
    { id: "fi_3", name: "Deep water",   icon: "\u{1F420}", level: 20, time: 14000, xp: 76,  out: { raw_salmon: 1 } },
    { id: "fi_4", name: "Lobster pots", icon: "\u{1F99E}", level: 30, time: 20000, xp: 178, out: { raw_lobster: 1 } },
    { id: "fi_5", name: "Open sea",     icon: "\u{1F421}", level: 40, time: 30000, xp: 420, out: { raw_swordfish: 1 } },
  ],
  firemaking: [
    { id: "fm_1", name: "Burn log",        icon: "\u{1F525}", level: 1,  time: 4000,  xp: 22,   cost: { log: 1 },        out: { ash: 1 } },
    { id: "fm_2", name: "Burn oak log",    icon: "\u{1F525}", level: 10, time: 5500,  xp: 58,   cost: { oak_log: 1 },    out: { ash: 1 } },
    { id: "fm_3", name: "Burn willow log", icon: "\u{1F525}", level: 20, time: 7500,  xp: 140,  cost: { willow_log: 1 }, out: { ash: 2 } },
    { id: "fm_4", name: "Burn maple log",  icon: "\u{1F525}", level: 30, time: 10000, xp: 330,  cost: { maple_log: 1 },  out: { ash: 2 } },
    { id: "fm_5", name: "Burn yew log",    icon: "\u{1F525}", level: 40, time: 14000, xp: 780,  cost: { yew_log: 1 },    out: { ash: 3 } },
    { id: "fm_6", name: "Burn elder log",  icon: "\u{1F525}", level: 50, time: 20000, xp: 1850, cost: { elder_log: 1 },  out: { ash: 4 } },
  ],
  cooking: [
    { id: "ck_1", name: "Cook shrimp",    icon: "\u{1F35B}", level: 1,  time: 4000,  xp: 13,  cost: { raw_shrimp: 1 },    out: { shrimp: 1 } },
    { id: "ck_2", name: "Cook trout",     icon: "\u{1F35B}", level: 10, time: 5500,  xp: 36,  cost: { raw_trout: 1 },     out: { trout: 1 } },
    { id: "ck_3", name: "Cook salmon",    icon: "\u{1F35B}", level: 20, time: 7500,  xp: 84,  cost: { raw_salmon: 1 },    out: { salmon: 1 } },
    { id: "ck_4", name: "Cook lobster",   icon: "\u{1F35B}", level: 30, time: 10000, xp: 196, cost: { raw_lobster: 1 },   out: { lobster: 1 } },
    { id: "ck_5", name: "Cook swordfish", icon: "\u{1F35B}", level: 40, time: 14000, xp: 460, cost: { raw_swordfish: 1 }, out: { swordfish: 1 } },
  ],
  smithing: [
    { id: "sm_bar_1", name: "Bronze bar",  icon: "\u{1F7EB}", level: 1,  time: 7000,  xp: 18,  cost: { copper_ore: 2 },              out: { bronze_bar: 1 } },
    { id: "sm_bar_2", name: "Iron bar",    icon: "\u{2B1C}",  level: 10, time: 9000,  xp: 44,  cost: { iron_ore: 1, coal: 1 },       out: { iron_bar: 1 } },
    { id: "sm_bar_3", name: "Steel bar",   icon: "\u{1F518}", level: 20, time: 12000, xp: 105, cost: { iron_ore: 1, coal: 2 },       out: { steel_bar: 1 } },
    { id: "sm_bar_4", name: "Mithril bar", icon: "\u{1F537}", level: 30, time: 17000, xp: 250, cost: { mithril_ore: 1, coal: 3 },    out: { mithril_bar: 1 } },
    // gear recipes are appended below
  ],
  alchemy: [
    { id: "al_1", name: "Render log",       icon: "\u{2697}", level: 1,  time: 5000,  xp: 14,   cost: { log: 1 },        gold: 9 },
    { id: "al_2", name: "Render oak log",   icon: "\u{2697}", level: 10, time: 7000,  xp: 38,   cost: { oak_log: 1 },    gold: 26 },
    { id: "al_3", name: "Render willow log",icon: "\u{2697}", level: 20, time: 10000, xp: 90,   cost: { willow_log: 1 }, gold: 68 },
    { id: "al_4", name: "Render maple log", icon: "\u{2697}", level: 30, time: 14000, xp: 210,  cost: { maple_log: 1 },  gold: 165 },
    { id: "al_5", name: "Render yew log",   icon: "\u{2697}", level: 40, time: 20000, xp: 500,  cost: { yew_log: 1 },    gold: 420 },
    { id: "al_6", name: "Render elder log", icon: "\u{2697}", level: 50, time: 29000, xp: 1180, cost: { elder_log: 1 },  gold: 1050 },
  ],
};

ACTIONS.smithing = ACTIONS.smithing.concat(GEAR_RECIPES);

/* ================= 4. AREAS + MONSTERS ================= */

const AREAS = [
  { id: "greenwood", name: "Greenwood", cost: 0,      note: "Thin trees and thinner threats. Everyone starts here." },
  { id: "quarry",    name: "Sunken quarry", cost: 2000,  note: "Flooded diggings. Things live in the water now." },
  { id: "road",      name: "Old road",  cost: 25000,  note: "Nobody walks it unarmed. Toll collectors with knives." },
  { id: "fen",       name: "Troll fen", cost: 250000, note: "Wet, cold, and hungry. Bring more food than you think." },
];

const MONSTERS = {
  greenwood: [
    { id: "mo_rat",    name: "Sewer rat", icon: "\u{1F400}", level: 1,  hp: 12,  attack: 3,  defence: 0, speed: 3000, xp: 14,  gold: [1, 4],
      drops: [["bones", 1, 1.0], ["copper_ring", 1, 0.02]] },
    { id: "mo_goblin", name: "Goblin",    icon: "\u{1F47A}", level: 10, hp: 40,  attack: 9,  defence: 3, speed: 2800, xp: 45,  gold: [4, 12],
      drops: [["bones", 1, 1.0], ["copper_ore", 2, 0.35], ["bone_amulet", 1, 0.04]] },
  ],
  quarry: [
    { id: "mo_wolf",   name: "Grey wolf",  icon: "\u{1F43A}", level: 20, hp: 95,  attack: 19, defence: 8,  speed: 2400, xp: 120, gold: [9, 26],
      drops: [["bones", 1, 1.0], ["pelt", 1, 0.3], ["pelt_amulet", 1, 0.035], ["silver_ring", 1, 0.02]] },
    { id: "mo_golem",  name: "Rock golem", icon: "\u{1FAA8}", level: 30, hp: 220, attack: 32, defence: 20, speed: 3600, xp: 280, gold: [22, 55],
      drops: [["rock_shard", 1, 0.5], ["iron_ore", 3, 0.4], ["coal", 2, 0.3], ["silver_ring", 1, 0.04]] },
  ],
  road: [
    { id: "mo_bandit", name: "Bandit",      icon: "\u{1F977}", level: 40, hp: 400, attack: 52, defence: 30, speed: 2600, xp: 620,  gold: [60, 150],
      drops: [["iron_ore", 3, 0.45], ["steel_bar", 1, 0.15], ["gold_ring", 1, 0.03]] },
    { id: "mo_high",   name: "Highwayman",  icon: "\u{1F3AD}", level: 50, hp: 720, attack: 78, defence: 44, speed: 2400, xp: 1300, gold: [140, 330],
      drops: [["gold_ore", 2, 0.35], ["steel_bar", 2, 0.2], ["gold_ring", 1, 0.05], ["troll_amulet", 1, 0.02]] },
  ],
  fen: [
    { id: "mo_troll",  name: "Forest troll", icon: "\u{1F9CC}", level: 60, hp: 1400, attack: 115, defence: 65, speed: 3200, xp: 2800, gold: [320, 700],
      drops: [["troll_tooth", 1, 0.25], ["elder_log", 2, 0.3], ["mithril_ore", 2, 0.2], ["troll_amulet", 1, 0.04]] },
    { id: "mo_witch",  name: "Fen witch",    icon: "\u{1F9D9}", level: 70, hp: 2400, attack: 170, defence: 90, speed: 2200, xp: 5600, gold: [700, 1500],
      drops: [["witch_ember", 1, 0.2], ["mithril_ore", 3, 0.3], ["mithril_ring", 1, 0.03], ["ember_amulet", 1, 0.02]] },
  ],
};

function allMonsters() {
  return Object.keys(MONSTERS).reduce((acc, area) => acc.concat(MONSTERS[area]), []);
}

function getMonster(id) {
  return allMonsters().find((m) => m.id === id) || null;
}

function areaOf(monsterId) {
  return Object.keys(MONSTERS).find((a) => MONSTERS[a].some((m) => m.id === monsterId)) || null;
}

/* ================= 5. XP CURVE ================= */

// Exponential: gentle for the first 30 levels, brutal past 70.
// lvl10 ≈ 170, lvl30 ≈ 1.9K, lvl50 ≈ 14K, lvl70 ≈ 100K, lvl99 ≈ 1.8M.
const XP_TABLE = (() => {
  const t = [0, 0];
  for (let lvl = 2; lvl <= MAX_LEVEL; lvl++) {
    t[lvl] = Math.floor(100 * (Math.pow(2, lvl / 7) - 1));
  }
  return t;
})();

function levelFromXp(xp) {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= XP_TABLE[lvl + 1]) lvl++;
  return lvl;
}

/* ================= 6. STATE ================= */

let state = freshState();

function freshState() {
  const skills = {};
  SKILLS.forEach((s) => { skills[s.id] = 0; });
  const equipment = {};
  EQUIP_SLOTS.forEach((s) => { equipment[s] = null; });

  return {
    schema: SCHEMA,
    meta: {
      createdAt: Date.now(),
      lastSeen: Date.now(),
      playtimeMs: 0,
    },
    player: {
      gold: 0,
      hp: 10,
    },
    skills,
    bank: {
      slots: STARTING_SLOTS,
      slotsBought: 0,
      items: {},   // itemId -> qty
      order: [],   // itemId[] — player-defined display order
    },
    equipment,
    wear: {},      // itemId -> damage points accumulated (survives unequipping)
    tasks: {
      skilling: null, // { skillId, actionId, progress }
      combat: null,   // { monsterId, mobHp, mobMax, playerTimer, mobTimer, respawn }
    },
    travel: { unlocked: ["greenwood"] },
    unlocked: {
      woodcutting: true, mining: true, fishing: true,
      firemaking: false, cooking: false, smithing: false, alchemy: false, combat: false,
    },
    stats: { kills: 0, actionsDone: 0, deaths: 0 },
    log: [],
  };
}

/* UI-only state — deliberately not saved */
let tab = "skills";
let skillView = "woodcutting";
let areaView = "greenwood";
let selectedItem = null;

/* ================= 7. HELPERS ================= */

const el = (id) => document.getElementById(id);

function skillLevel(id) { return levelFromXp(state.skills[id] || 0); }
function totalLevel() { return SKILLS.reduce((n, s) => n + skillLevel(s.id), 0); }
function bankQty(id) { return state.bank.items[id] || 0; }
function slotsUsed() { return Object.keys(state.bank.items).length; }
function bankFull() { return slotsUsed() >= state.bank.slots; }

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function fmt(n) {
  n = Math.floor(n);
  if (Math.abs(n) < 10000) return n.toLocaleString();
  if (Math.abs(n) < 1e6) return (n / 1e3).toFixed(1) + "K";
  if (Math.abs(n) < 1e9) return (n / 1e6).toFixed(2) + "M";
  return (n / 1e9).toFixed(2) + "B";
}

function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}

function say(msg) {
  state.log.push(msg);
  if (state.log.length > 60) state.log.shift();
}

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

function skillName(id) {
  const s = SKILLS.find((x) => x.id === id);
  return s ? s.name : id;
}

function getAction(skillId, actionId) {
  return (ACTIONS[skillId] || []).find((a) => a.id === actionId) || null;
}

/* ---- bank ---- */

function addItem(id, qty) {
  if (!state.bank.items[id] && bankFull()) {
    return false; // no slot free — the drop is lost
  }
  state.bank.items[id] = bankQty(id) + qty;
  if (!state.bank.order.includes(id)) state.bank.order.push(id);
  return true;
}

function removeItem(id, qty) {
  const left = bankQty(id) - qty;
  if (left > 0) {
    state.bank.items[id] = left;
  } else {
    delete state.bank.items[id];
    state.bank.order = state.bank.order.filter((x) => x !== id);
    if (selectedItem === id) selectedItem = null;
  }
}

function canAfford(cost) {
  if (!cost) return true;
  return Object.keys(cost).every((id) => bankQty(id) >= cost[id]);
}

function payCost(cost) {
  if (!cost) return;
  Object.keys(cost).forEach((id) => removeItem(id, cost[id]));
}

function orderedBankIds() {
  const have = Object.keys(state.bank.items);
  const ordered = state.bank.order.filter((id) => have.includes(id));
  have.forEach((id) => { if (!ordered.includes(id)) ordered.push(id); });
  return ordered;
}

/* ---- combat stats ---- */

function equipStat(stat) {
  let total = 0;
  EQUIP_SLOTS.forEach((slot) => {
    const id = state.equipment[slot];
    if (id && typeof ITEMS[id][stat] === "number") total += ITEMS[id][stat];
  });
  return total;
}

function maxHp() { return 10 + skillLevel("combat") * 4 + equipStat("health"); }
function attackPower() { return 3 + skillLevel("combat") * 1.5 + equipStat("attack"); }
function defencePower() { return skillLevel("combat") * 0.8 + equipStat("defence"); }

function wearPct(itemId) {
  const item = ITEMS[itemId];
  if (!item || !item.maxDur) return null;
  const damage = state.wear[itemId] || 0;
  return Math.max(0, Math.round((1 - damage / item.maxDur) * 100));
}

/* ================= 8. PROGRESSION ================= */

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
  const has = (ids) => ids.some((id) => bankQty(id) > 0);

  if (!u.firemaking && has(["log", "oak_log", "willow_log", "maple_log", "yew_log", "elder_log"])) {
    u.firemaking = true; u.alchemy = true;
    say("Firemaking and Alchemy unlocked. Logs have two futures.");
    toast("Firemaking and Alchemy unlocked");
  }
  if (!u.cooking && has(["raw_shrimp", "raw_trout", "raw_salmon", "raw_lobster", "raw_swordfish"])) {
    u.cooking = true; say("Cooking unlocked. Raw fish is not food yet."); toast("Cooking unlocked");
  }
  if (!u.smithing && has(["copper_ore", "iron_ore", "coal", "silver_ore", "gold_ore", "mithril_ore"])) {
    u.smithing = true; say("Smithing unlocked. Ore wants a furnace."); toast("Smithing unlocked");
  }
  if (!u.combat && totalLevel() >= COMBAT_UNLOCK_TOTAL) {
    u.combat = true;
    say("Combat unlocked. Something is moving out past the treeline.");
    toast("Combat unlocked — you can now run a fight alongside your skilling");
  }
}

/* ================= 9. THE TICK ================= */
/* Both tasks advance independently on the same wall-clock delta. */

function tick(dt) {
  if (state.tasks.skilling) skillingTick(dt);
  if (state.tasks.combat) combatTick(dt);
}

function skillingTick(dt) {
  const task = state.tasks.skilling;
  const def = getAction(task.skillId, task.actionId);
  if (!def) { state.tasks.skilling = null; return; }

  if (!canAfford(def.cost)) {
    say(`Stopped ${def.name.toLowerCase()} — out of materials.`);
    state.tasks.skilling = null;
    return;
  }

  task.progress += dt;

  let guard = 0;
  while (task.progress >= def.time && guard++ < 100000) {
    task.progress -= def.time;

    if (!canAfford(def.cost)) {
      say(`Stopped ${def.name.toLowerCase()} — out of materials.`);
      state.tasks.skilling = null;
      return;
    }

    // Bank check before consuming inputs, so a full bank never eats materials.
    const outIds = def.out ? Object.keys(def.out) : [];
    const needsNewSlot = outIds.some((id) => !state.bank.items[id]);
    if (needsNewSlot && bankFull()) {
      say(`Stopped ${def.name.toLowerCase()} — the bank is full.`);
      toast("Bank full — sell something or buy more slots");
      state.tasks.skilling = null;
      return;
    }

    payCost(def.cost);
    outIds.forEach((id) => addItem(id, def.out[id]));
    if (def.gold) state.player.gold += def.gold;
    grantXp(task.skillId, def.xp);
    state.stats.actionsDone++;
    checkUnlocks();
  }
}

function bestFood() {
  let pick = null;
  Object.keys(state.bank.items).forEach((id) => {
    const item = ITEMS[id];
    if (item && item.heal && (!pick || item.heal > ITEMS[pick].heal)) pick = id;
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
      c.mobMax = mob.hp;
      c.mobHp = mob.hp;
      c.mobTimer = mob.speed;
      c.playerTimer = PLAYER_SWING_MS;
    }
    return;
  }

  // --- player swing ---
  c.playerTimer -= dt;
  if (c.playerTimer <= 0) {
    c.playerTimer += PLAYER_SWING_MS;
    const atk = attackPower();
    let dmg = randInt(Math.max(1, Math.floor(atk * 0.5)), Math.ceil(atk));
    dmg = Math.max(1, Math.round(dmg - mob.defence * 0.35));
    c.mobHp -= dmg;
    if (c.mobHp <= 0) { killMob(mob); return; }
  }

  // --- monster swing ---
  c.mobTimer -= dt;
  if (c.mobTimer <= 0) {
    c.mobTimer += mob.speed;
    let dmg = randInt(Math.max(1, Math.floor(mob.attack * 0.55)), mob.attack);
    dmg = Math.max(1, Math.round(dmg - defencePower() * 0.4));
    state.player.hp -= dmg;

    if (state.player.hp <= maxHp() * 0.45) {
      const food = bestFood();
      if (food) {
        removeItem(food, 1);
        state.player.hp = Math.min(maxHp(), state.player.hp + ITEMS[food].heal);
      }
    }

    if (state.player.hp <= 0) {
      state.player.hp = maxHp();
      state.tasks.combat = null;
      state.stats.deaths++;
      say(`The ${mob.name.toLowerCase()} put you down. You keep everything — but bring food next time.`);
      toast(`Killed by a ${mob.name.toLowerCase()}`);
    }
  }
}

function killMob(mob) {
  const c = state.tasks.combat;
  grantXp("combat", mob.xp);
  state.player.gold += randInt(mob.gold[0], mob.gold[1]);
  state.stats.kills++;

  mob.drops.forEach(([id, qty, chance]) => {
    if (Math.random() < chance) {
      if (!addItem(id, qty)) say(`No room for ${ITEMS[id].name} — the drop was left behind.`);
    }
  });

  applyWear();
  checkUnlocks();
  c.respawn = RESPAWN_MS;
}

// Gear wears down with use. Wear is tracked per item type, so unequipping
// and re-equipping never launders the damage away.
function applyWear() {
  const weapon = state.equipment.weapon;
  if (weapon && ITEMS[weapon].maxDur) damageItem(weapon, 1);

  const armour = EQUIP_SLOTS
    .filter((s) => s !== "weapon" && s !== "ring" && s !== "amulet")
    .map((s) => state.equipment[s])
    .filter((id) => id && ITEMS[id].maxDur);

  if (armour.length) damageItem(armour[randInt(0, armour.length - 1)], 1);
}

function damageItem(itemId, amount) {
  state.wear[itemId] = (state.wear[itemId] || 0) + amount;
  if (state.wear[itemId] >= ITEMS[itemId].maxDur) {
    const slot = ITEMS[itemId].slot;
    state.equipment[slot] = null;
    state.wear[itemId] = 0;
    say(`Your ${ITEMS[itemId].name.toLowerCase()} broke beyond repair.`);
    toast(`${ITEMS[itemId].name} broke`);
  }
}

function repairCost(itemId) {
  const item = ITEMS[itemId];
  const damage = state.wear[itemId] || 0;
  if (!item.maxDur || damage <= 0) return null;
  return { bar: item.repairBar, qty: Math.max(1, Math.ceil(damage / 60)) };
}

function repairItem(itemId) {
  const cost = repairCost(itemId);
  if (!cost) return;
  if (bankQty(cost.bar) < cost.qty) {
    say(`Need ${cost.qty} ${ITEMS[cost.bar].name.toLowerCase()} to repair that.`);
    render();
    return;
  }
  removeItem(cost.bar, cost.qty);
  state.wear[itemId] = 0;
  say(`Repaired your ${ITEMS[itemId].name.toLowerCase()}.`);
  render();
}

/* ================= 10. PROJECTIONS (taskbar) ================= */

function projectSkilling() {
  const task = state.tasks.skilling;
  if (!task) return null;
  const def = getAction(task.skillId, task.actionId);
  if (!def) return null;

  let actions = Math.floor(PROJECTION_MS / def.time);
  let limitedBy = null;

  if (def.cost) {
    let maxFromStock = Infinity;
    Object.keys(def.cost).forEach((id) => {
      maxFromStock = Math.min(maxFromStock, Math.floor(bankQty(id) / def.cost[id]));
    });
    if (maxFromStock < actions) { actions = maxFromStock; limitedBy = "materials"; }
  }

  const yields = [];
  if (def.out) {
    Object.keys(def.out).forEach((id) => {
      yields.push(`${fmt(actions * def.out[id])} ${ITEMS[id].name.toLowerCase()}`);
    });
  }
  if (def.gold) yields.push(`${fmt(actions * def.gold)} gold`);

  return {
    name: def.name,
    actions,
    xp: actions * def.xp,
    yields,
    limitedBy,
    runsOutIn: limitedBy ? actions * def.time : null,
  };
}

function projectCombat() {
  const task = state.tasks.combat;
  if (!task) return null;
  const mob = getMonster(task.monsterId);
  if (!mob) return null;

  const atk = attackPower();
  const avgHit = Math.max(1, ((atk * 0.5 + atk) / 2) - mob.defence * 0.35);
  const killMs = (mob.hp / avgHit) * PLAYER_SWING_MS + RESPAWN_MS;
  const kills = Math.floor(PROJECTION_MS / killMs);

  const incoming = Math.max(1, ((mob.attack * 0.55 + mob.attack) / 2) - defencePower() * 0.4);
  const dmgTaken = incoming * (PROJECTION_MS / mob.speed);
  const food = bestFood();
  const foodNeeded = food ? Math.ceil(dmgTaken / ITEMS[food].heal) : null;
  const foodHave = food ? bankQty(food) : 0;

  return {
    name: mob.name,
    kills,
    xp: kills * mob.xp,
    gold: kills * ((mob.gold[0] + mob.gold[1]) / 2),
    killMs,
    foodNeeded,
    foodHave,
    foodName: food ? ITEMS[food].name.toLowerCase() : null,
  };
}

/* ================= 11. SAVE / LOAD / SHARE ================= */

function save() {
  state.meta.lastSeen = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    const note = el("saveNote");
    if (note) note.textContent = "Saving is blocked here. Run the folder through a local server or the live site.";
    return false;
  }
}

function migrate(loaded) {
  const base = freshState();
  if (!loaded || typeof loaded !== "object") return base;

  const merged = Object.assign(base, loaded);
  merged.schema = SCHEMA;
  merged.meta = Object.assign(base.meta, loaded.meta || {});
  merged.player = Object.assign(base.player, loaded.player || {});
  merged.skills = Object.assign(base.skills, loaded.skills || {});
  merged.bank = Object.assign(base.bank, loaded.bank || {});
  merged.bank.items = Object.assign({}, (loaded.bank && loaded.bank.items) || {});
  merged.bank.order = ((loaded.bank && loaded.bank.order) || []).slice();
  merged.equipment = Object.assign(base.equipment, loaded.equipment || {});
  merged.wear = Object.assign({}, loaded.wear || {});
  merged.tasks = Object.assign(base.tasks, loaded.tasks || {});
  merged.travel = Object.assign(base.travel, loaded.travel || {});
  merged.unlocked = Object.assign(base.unlocked, loaded.unlocked || {});
  merged.stats = Object.assign(base.stats, loaded.stats || {});
  merged.log = (loaded.log || []).slice(-60);

  // Drop anything referencing items or actions that no longer exist.
  Object.keys(merged.bank.items).forEach((id) => { if (!ITEMS[id]) delete merged.bank.items[id]; });
  merged.bank.order = merged.bank.order.filter((id) => ITEMS[id]);
  EQUIP_SLOTS.forEach((s) => { if (merged.equipment[s] && !ITEMS[merged.equipment[s]]) merged.equipment[s] = null; });
  if (merged.tasks.skilling && !getAction(merged.tasks.skilling.skillId, merged.tasks.skilling.actionId)) merged.tasks.skilling = null;
  if (merged.tasks.combat && !getMonster(merged.tasks.combat.monsterId)) merged.tasks.combat = null;

  return merged;
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { raw = null; }
  if (!raw) return null;

  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return null; }

  const lastSeen = (parsed.meta && parsed.meta.lastSeen) || Date.now();
  state = migrate(parsed);

  const gone = Date.now() - lastSeen;
  if (gone <= 30000) return null;
  return { ms: Math.min(gone, CATCHUP_CAP_MS), overCap: gone > CATCHUP_CAP_MS };
}

// Fast-forwards both tasks through the time you were away, in coarse steps.
function catchUp(result) {
  const step = 500;
  let left = result.ms;
  let guard = 0;
  while (left > 0 && (state.tasks.skilling || state.tasks.combat) && guard++ < 200000) {
    tick(Math.min(step, left));
    left -= step;
  }
  state.meta.playtimeMs += result.ms;

  if (result.overCap) {
    if (state.tasks.skilling || state.tasks.combat) {
      state.tasks.skilling = null;
      state.tasks.combat = null;
      say("Twelve hours passed. Your tasks ran their course — set new ones.");
      toast("Idle limit reached — retask to continue");
    }
  } else if (result.ms > 5 * 60 * 1000) {
    say(`You were away ${fmtTime(result.ms)}.`);
  }
}

/* ---- export / import ---- */

function exportSave() {
  state.meta.lastSeen = Date.now();
  const json = JSON.stringify(state);
  return btoa(unescape(encodeURIComponent(json)));
}

function importSave(str) {
  let json;
  try {
    json = decodeURIComponent(escape(atob(str.trim())));
  } catch (e) {
    return "That doesn't look like a Respite save string.";
  }
  let parsed;
  try { parsed = JSON.parse(json); } catch (e) { return "Save string is corrupted and couldn't be read."; }
  if (!parsed.skills || !parsed.bank) return "Save string is missing character data.";

  state = migrate(parsed);
  state.meta.lastSeen = Date.now();
  save();
  selectedItem = null;
  render();
  return null;
}

/* ================= 12. PLAYER ACTIONS ================= */

function startSkilling(skillId, actionId) {
  const def = getAction(skillId, actionId);
  if (!def || skillLevel(skillId) < def.level) return;

  const t = state.tasks.skilling;
  if (t && t.skillId === skillId && t.actionId === actionId) {
    state.tasks.skilling = null;      // click again to stop
  } else {
    state.tasks.skilling = { skillId, actionId, progress: 0 };
  }
  render();
}

function startCombat(monsterId) {
  const mob = getMonster(monsterId);
  if (!mob) return;
  const area = areaOf(monsterId);
  if (!state.travel.unlocked.includes(area)) return;

  const t = state.tasks.combat;
  if (t && t.monsterId === monsterId) {
    state.tasks.combat = null;
  } else {
    state.tasks.combat = {
      monsterId,
      mobHp: mob.hp,
      mobMax: mob.hp,
      playerTimer: PLAYER_SWING_MS,
      mobTimer: mob.speed,
      respawn: 0,
    };
    state.player.hp = maxHp();
  }
  render();
}

function travelTo(areaId) {
  const area = AREAS.find((a) => a.id === areaId);
  if (!area) return;

  if (!state.travel.unlocked.includes(areaId)) {
    if (state.player.gold < area.cost) {
      say(`Travel to ${area.name} costs ${fmt(area.cost)} gold. You can't cover it yet.`);
      render();
      return;
    }
    state.player.gold -= area.cost;
    state.travel.unlocked.push(areaId);
    say(`Paid ${fmt(area.cost)} gold for passage to ${area.name}.`);
    toast(`${area.name} unlocked`);
  }
  areaView = areaId;
  render();
}

function equip(itemId) {
  const item = ITEMS[itemId];
  if (!item || !item.slot) return;

  if (item.slot === "weapon" && item.twoHanded && state.equipment.offhand) {
    addItem(state.equipment.offhand, 1);
    state.equipment.offhand = null;
    say("Stowed your offhand to grip the two-hander.");
  }
  if (item.slot === "offhand") {
    const w = state.equipment.weapon;
    if (w && ITEMS[w].twoHanded) {
      say(`Can't hold an offhand with a ${ITEMS[w].name.toLowerCase()} in both hands.`);
      render();
      return;
    }
  }

  const old = state.equipment[item.slot];
  if (old) {
    if (bankFull() && !state.bank.items[old]) {
      say("Bank is full — nowhere to put the gear you're taking off.");
      render();
      return;
    }
    addItem(old, 1);
  }
  removeItem(itemId, 1);
  state.equipment[item.slot] = itemId;
  render();
}

function unequip(slot) {
  const id = state.equipment[slot];
  if (!id) return;
  if (bankFull() && !state.bank.items[id]) {
    say("Bank is full — nowhere to put that.");
    render();
    return;
  }
  addItem(id, 1);
  state.equipment[slot] = null;
  render();
}

function sell(itemId, all) {
  const qty = all ? bankQty(itemId) : 1;
  if (qty <= 0) return;
  state.player.gold += ITEMS[itemId].value * qty;
  removeItem(itemId, qty);
  render();
}

function bankUpgradeCost() {
  return Math.round(800 * Math.pow(2.3, state.bank.slotsBought));
}

function buyBankSlots() {
  if (state.bank.slots >= MAX_SLOTS) return;
  const cost = bankUpgradeCost();
  if (state.player.gold < cost) {
    say(`Bank expansion costs ${fmt(cost)} gold.`);
    render();
    return;
  }
  state.player.gold -= cost;
  state.bank.slots = Math.min(MAX_SLOTS, state.bank.slots + 5);
  state.bank.slotsBought++;
  say(`Bank expanded to ${state.bank.slots} slots.`);
  render();
}

/* ================= 13. RENDER ================= */

let navKey = "", subKey = "", skillKey = "", combatKey = "", invKey = "", equipKey = "", logKey = "";
let skillRefs = [], monsterRefs = [];

function render() {
  navKey = subKey = skillKey = combatKey = invKey = equipKey = logKey = "";
  renderAll();
}

function renderAll() {
  renderTaskbar();
  renderTabs();
  renderSubnav();
  if (tab === "skills") renderSkillView();
  if (tab === "combat") renderCombatView();
  if (tab === "inventory") renderInventory();
  renderLog();
}

/* ---- taskbar ---- */

function renderTaskbar() {
  el("goldText").textContent = fmt(state.player.gold);
  el("totalLevelText").textContent = totalLevel();
  const hp = Math.max(0, Math.ceil(state.player.hp));
  el("hpFill").style.width = Math.max(0, Math.min(100, (hp / maxHp()) * 100)) + "%";
  el("hpText").textContent = `${hp} / ${maxHp()}`;

  // --- skilling slot ---
  const sTask = state.tasks.skilling;
  const sProj = projectSkilling();
  if (sTask && sProj) {
    const def = getAction(sTask.skillId, sTask.actionId);
    el("tbSkillingTitle").textContent = `${def.name} (${skillName(sTask.skillId)})`;
    el("tbSkillingBar").style.width = Math.min(100, (sTask.progress / def.time) * 100) + "%";
    let line = `12h: ${fmt(sProj.actions)} actions, ${fmt(sProj.xp)} xp`;
    if (sProj.yields.length) line += `, ${sProj.yields.join(", ")}`;
    if (sProj.limitedBy) line += ` — materials run dry in ${fmtTime(sProj.runsOutIn)}`;
    el("tbSkillingProj").textContent = line;
  } else {
    el("tbSkillingTitle").textContent = "Nothing tasked";
    el("tbSkillingBar").style.width = "0";
    el("tbSkillingProj").textContent = "Pick a skill action to begin.";
  }

  // --- combat slot ---
  const cTask = state.tasks.combat;
  const cProj = projectCombat();
  if (cTask && cProj) {
    el("tbCombatTitle").textContent = cProj.name;
    const pct = cTask.respawn > 0 ? 0 : (cTask.mobMax ? (cTask.mobHp / cTask.mobMax) * 100 : 0);
    el("tbCombatBar").style.width = Math.max(0, Math.min(100, pct)) + "%";
    let line = `12h: ${fmt(cProj.kills)} kills, ${fmt(cProj.xp)} xp, ${fmt(cProj.gold)} gold`;
    if (cProj.foodNeeded !== null) {
      line += ` — needs ~${fmt(cProj.foodNeeded)} ${cProj.foodName} (have ${fmt(cProj.foodHave)})`;
    } else {
      line += " — no food banked, you will die";
    }
    el("tbCombatProj").textContent = line;
  } else {
    el("tbCombatTitle").textContent = "Nothing tasked";
    el("tbCombatBar").style.width = "0";
    el("tbCombatProj").textContent = state.unlocked.combat
      ? "Pick a target in the Combat tab."
      : `Locked until total level ${COMBAT_UNLOCK_TOTAL} (you are ${totalLevel()}).`;
  }
}

/* ---- nav ---- */

function renderTabs() {
  const key = tab + "|" + (state.unlocked.combat ? 1 : 0);
  if (key === navKey) return;
  navKey = key;

  document.querySelectorAll(".tabbtn").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.tab === tab);
    if (btn.dataset.tab === "combat") btn.style.display = state.unlocked.combat ? "" : "none";
  });

  ["skills", "combat", "inventory"].forEach((t) => {
    const view = el("view" + t.charAt(0).toUpperCase() + t.slice(1));
    if (view) view.hidden = tab !== t;
  });
}

function renderSubnav() {
  const box = el("skillSubnav");
  if (tab !== "skills") {
    if (subKey !== "hidden") { box.innerHTML = ""; subKey = "hidden"; }
    return;
  }

  const skilling = SKILLS.filter((s) => s.kind === "skilling" && state.unlocked[s.id]);
  const key = "sub|" + skillView + "|" + skilling.map((s) => s.id + skillLevel(s.id)).join(",") +
    "|" + (state.tasks.skilling ? state.tasks.skilling.skillId : "-");
  if (key === subKey) return;
  subKey = key;

  box.innerHTML = "";
  skilling.forEach((s) => {
    const b = document.createElement("button");
    b.className = "subbtn" + (skillView === s.id ? " on" : "") +
      (state.tasks.skilling && state.tasks.skilling.skillId === s.id ? " busy" : "");
    b.innerHTML = '<span class="subbtn-icon"></span><span class="subbtn-name"></span><span class="subbtn-lvl"></span>';
    b.children[0].textContent = s.icon;
    b.children[1].textContent = s.name;
    b.children[2].textContent = skillLevel(s.id);
    b.onclick = () => { skillView = s.id; render(); };
    box.appendChild(b);
  });
}

/* ---- skills view ---- */

function renderSkillView() {
  const skill = SKILLS.find((s) => s.id === skillView);
  if (!skill) return;
  const lvl = skillLevel(skillView);
  const xp = state.skills[skillView] || 0;
  const base = XP_TABLE[lvl];
  const next = XP_TABLE[Math.min(lvl + 1, MAX_LEVEL)];
  const pct = lvl >= MAX_LEVEL ? 100 : ((xp - base) / (next - base)) * 100;

  el("skillTitle").textContent = skill.name;
  el("skillNote").textContent = skill.note;
  el("skillLevel").textContent = `Level ${lvl}`;
  el("skillXpFill").style.width = Math.max(0, Math.min(100, pct)) + "%";
  el("skillXpText").textContent = `${fmt(xp)} / ${fmt(next)} xp`;

  const t = state.tasks.skilling;
  const key = `${skillView}|${lvl}|${t ? t.skillId + t.actionId : "-"}`;
  if (key === skillKey) { updateSkillCards(); return; }
  skillKey = key;
  skillRefs = [];

  const list = el("skillActions");
  list.innerHTML = "";

  (ACTIONS[skillView] || []).forEach((def) => {
    const locked = lvl < def.level;
    const active = !!(t && t.skillId === skillView && t.actionId === def.id);

    const card = document.createElement("button");
    card.className = "card" + (locked ? " locked" : "") + (active ? " on" : "");
    card.disabled = locked;

    const top = document.createElement("div");
    top.className = "card-top";
    top.innerHTML = '<span class="card-icon"></span><span class="card-name"></span>';
    top.children[0].textContent = def.icon;
    top.children[1].textContent = def.name;
    card.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    if (locked) {
      meta.textContent = `Needs level ${def.level}`;
    } else {
      const bits = [`${(def.time / 1000).toFixed(1)}s`, `${fmt(def.xp)} xp`];
      if (def.gold) bits.push(`${fmt(def.gold)} gold`);
      meta.textContent = bits.join(" \u00B7 ");
    }
    card.appendChild(meta);

    let costEl = null;
    if (def.cost && !locked) {
      costEl = document.createElement("div");
      costEl.className = "card-cost";
      card.appendChild(costEl);
    }

    const prog = document.createElement("div");
    prog.className = "card-prog";
    card.appendChild(prog);

    card.onclick = () => startSkilling(skillView, def.id);
    list.appendChild(card);

    skillRefs.push({ def, active, costEl, prog });
  });

  updateSkillCards();
}

function updateSkillCards() {
  const t = state.tasks.skilling;
  skillRefs.forEach((ref) => {
    if (ref.costEl) {
      ref.costEl.innerHTML = "";
      ref.costEl.appendChild(document.createTextNode("Uses "));
      Object.keys(ref.def.cost).forEach((id, i) => {
        const span = document.createElement("span");
        if (bankQty(id) < ref.def.cost[id]) span.className = "short";
        span.textContent = `${i ? ", " : ""}${ref.def.cost[id]} ${ITEMS[id].name.toLowerCase()} (${fmt(bankQty(id))})`;
        ref.costEl.appendChild(span);
      });
    }
    if (ref.active && t) {
      ref.prog.style.width = Math.min(100, (t.progress / ref.def.time) * 100) + "%";
    } else {
      ref.prog.style.width = "0";
    }
  });
}

/* ---- combat view ---- */

function renderCombatView() {
  const lvl = skillLevel("combat");
  const xp = state.skills.combat || 0;
  const base = XP_TABLE[lvl];
  const next = XP_TABLE[Math.min(lvl + 1, MAX_LEVEL)];
  const pct = lvl >= MAX_LEVEL ? 100 : ((xp - base) / (next - base)) * 100;

  el("combatLevel").textContent = `Level ${lvl}`;
  el("combatXpFill").style.width = Math.max(0, Math.min(100, pct)) + "%";
  el("combatXpText").textContent = `${fmt(xp)} / ${fmt(next)} xp`;

  const area = AREAS.find((a) => a.id === areaView);
  el("combatNote").textContent = area ? area.note : "";

  const t = state.tasks.combat;
  const key = `${areaView}|${lvl}|${t ? t.monsterId : "-"}|${state.travel.unlocked.join(",")}|${Math.floor(state.player.gold / 100)}`;
  if (key === combatKey) { updateMonsterCards(); return; }
  combatKey = key;
  monsterRefs = [];

  // areas
  const areaBox = el("areaList");
  areaBox.innerHTML = "";
  AREAS.forEach((a) => {
    const unlocked = state.travel.unlocked.includes(a.id);
    const pill = document.createElement("button");
    pill.className = "areapill" + (areaView === a.id ? " on" : "") + (unlocked ? "" : " locked");
    pill.textContent = a.name;
    if (!unlocked) {
      const price = document.createElement("span");
      price.className = "price";
      price.textContent = `${fmt(a.cost)}g to travel`;
      pill.appendChild(price);
    }
    pill.onclick = () => travelTo(a.id);
    areaBox.appendChild(pill);
  });

  // monsters
  const list = el("monsterList");
  list.innerHTML = "";
  const unlocked = state.travel.unlocked.includes(areaView);

  if (!unlocked) {
    const note = document.createElement("p");
    note.className = "view-note";
    note.textContent = `You haven't paid for passage here yet.`;
    list.appendChild(note);
    return;
  }

  (MONSTERS[areaView] || []).forEach((mob) => {
    const active = !!(t && t.monsterId === mob.id);

    const card = document.createElement("button");
    card.className = "card" + (active ? " on" : "");

    const top = document.createElement("div");
    top.className = "card-top";
    top.innerHTML = '<span class="card-icon"></span><span class="card-name"></span>';
    top.children[0].textContent = mob.icon;
    top.children[1].textContent = mob.name;
    card.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = `Level ${mob.level} \u00B7 ${fmt(mob.hp)} hp \u00B7 ${mob.attack} attack \u00B7 ${fmt(mob.xp)} xp`;
    card.appendChild(meta);

    const drops = document.createElement("div");
    drops.className = "card-cost";
    drops.textContent = "Drops " + mob.drops.map(([id]) => ITEMS[id].name.toLowerCase()).join(", ");
    card.appendChild(drops);

    let hpFill = null;
    if (active) {
      const bar = document.createElement("div");
      bar.className = "card-hp";
      hpFill = document.createElement("div");
      hpFill.className = "card-hp-fill";
      bar.appendChild(hpFill);
      card.appendChild(bar);
    }

    const prog = document.createElement("div");
    prog.className = "card-prog combat";
    card.appendChild(prog);

    card.onclick = () => startCombat(mob.id);
    list.appendChild(card);

    monsterRefs.push({ mob, active, hpFill, prog });
  });

  updateMonsterCards();
}

function updateMonsterCards() {
  const t = state.tasks.combat;
  monsterRefs.forEach((ref) => {
    if (ref.hpFill && t) {
      const pct = t.mobMax ? (t.mobHp / t.mobMax) * 100 : 0;
      ref.hpFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
    }
    if (ref.active && t) {
      const swing = t.respawn > 0 ? 0 : (1 - t.playerTimer / PLAYER_SWING_MS) * 100;
      ref.prog.style.width = Math.max(0, Math.min(100, swing)) + "%";
    } else {
      ref.prog.style.width = "0";
    }
  });
}

/* ---- inventory view ---- */

function renderInventory() {
  const ids = orderedBankIds();
  const key = ids.map((id) => id + ":" + state.bank.items[id]).join(",") + "|" + state.bank.slots +
    "|" + selectedItem + "|" + Math.floor(state.player.gold);
  if (key !== invKey) {
    invKey = key;
    renderGrid(ids);
    renderDetail();
    el("bankCount").textContent = `${slotsUsed()} / ${state.bank.slots} slots`;

    const cost = bankUpgradeCost();
    const atMax = state.bank.slots >= MAX_SLOTS;
    el("bankUpgradeNote").textContent = atMax
      ? `Maxed at ${MAX_SLOTS} slots.`
      : `${state.bank.slots} slots. Next 5 cost ${fmt(cost)} gold.`;
    const btn = el("bankUpgradeBtn");
    btn.disabled = atMax || state.player.gold < cost;
    btn.textContent = atMax ? "Maxed" : "Buy 5 slots";
  }

  const eKey = EQUIP_SLOTS.map((s) => s + ":" + state.equipment[s] + ":" + (state.wear[state.equipment[s]] || 0)).join(",");
  if (eKey !== equipKey) {
    equipKey = eKey;
    renderEquip();
    renderStats();
  }
}

function renderGrid(ids) {
  const grid = el("invGrid");
  grid.innerHTML = "";

  for (let i = 0; i < state.bank.slots; i++) {
    const id = ids[i];
    const cell = document.createElement("div");
    cell.className = "cell" + (id ? "" : " empty") + (id && id === selectedItem ? " on" : "");
    cell.tabIndex = id ? 0 : -1;

    if (id) {
      cell.textContent = ITEMS[id].icon;
      cell.title = `${ITEMS[id].name} \u00D7 ${state.bank.items[id]}`;
      const qty = document.createElement("span");
      qty.className = "cell-qty";
      qty.textContent = fmt(state.bank.items[id]);
      cell.appendChild(qty);

      cell.draggable = true;
      cell.dataset.itemId = id;

      cell.onclick = () => {
        selectedItem = selectedItem === id ? null : id;
        invKey = "";
        renderInventory();
      };
      cell.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cell.onclick(); } };

      cell.ondragstart = (e) => { e.dataTransfer.setData("text/plain", id); };
      cell.ondragover = (e) => { e.preventDefault(); cell.classList.add("dragover"); };
      cell.ondragleave = () => cell.classList.remove("dragover");
      cell.ondrop = (e) => {
        e.preventDefault();
        cell.classList.remove("dragover");
        const dragged = e.dataTransfer.getData("text/plain");
        if (!dragged || dragged === id) return;
        reorderBank(dragged, id);
      };
    }
    grid.appendChild(cell);
  }
}

function reorderBank(draggedId, targetId) {
  const ids = orderedBankIds();
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return;
  ids.splice(from, 1);
  ids.splice(to, 0, draggedId);
  state.bank.order = ids;
  invKey = "";
  renderInventory();
}

function renderDetail() {
  const box = el("invDetail");
  box.innerHTML = "";

  if (!selectedItem || !state.bank.items[selectedItem]) {
    box.textContent = "Select an item to equip or sell it.";
    return;
  }

  const item = ITEMS[selectedItem];
  const head = document.createElement("div");
  head.innerHTML = '<span class="dname"></span> <span class="muted"></span>';
  head.children[0].textContent = `${item.icon} ${item.name}`;
  head.children[1].textContent = `\u00D7 ${fmt(bankQty(selectedItem))} \u00B7 worth ${fmt(item.value)}g each`;
  box.appendChild(head);

  const bits = [];
  if (item.attack) bits.push(`+${item.attack} attack`);
  if (item.defence) bits.push(`+${item.defence} defence`);
  if (item.health) bits.push(`+${item.health} max hp`);
  if (item.heal) bits.push(`heals ${item.heal}`);
  if (item.twoHanded) bits.push("two-handed");
  if (item.maxDur) bits.push(`${fmt(item.maxDur)} durability`);
  if (bits.length) {
    const stats = document.createElement("div");
    stats.className = "muted tiny";
    stats.textContent = bits.join(" \u00B7 ");
    box.appendChild(stats);
  }

  const row = document.createElement("div");
  row.className = "btnrow";

  if (item.slot) {
    const eq = document.createElement("button");
    eq.className = "btn";
    eq.textContent = `Equip (${SLOT_LABELS[item.slot]})`;
    eq.onclick = () => equip(selectedItem);
    row.appendChild(eq);
  }

  const sell1 = document.createElement("button");
  sell1.className = "btn";
  sell1.textContent = `Sell 1 (${fmt(item.value)}g)`;
  sell1.onclick = () => sell(selectedItem, false);
  row.appendChild(sell1);

  const sellAll = document.createElement("button");
  sellAll.className = "btn btn-quiet";
  sellAll.textContent = `Sell all (${fmt(item.value * bankQty(selectedItem))}g)`;
  sellAll.onclick = () => sell(selectedItem, true);
  row.appendChild(sellAll);

  box.appendChild(row);
}

function renderEquip() {
  const box = el("equipList");
  box.innerHTML = "";

  EQUIP_SLOTS.forEach((slot) => {
    const id = state.equipment[slot];
    const row = document.createElement("div");
    row.className = "equip-row";

    const label = document.createElement("span");
    label.className = "equip-slot";
    label.textContent = SLOT_LABELS[slot];

    const name = document.createElement("span");
    name.className = "equip-name";
    name.textContent = id ? `${ITEMS[id].icon} ${ITEMS[id].name}` : "Empty";
    if (!id) name.classList.add("muted");

    row.appendChild(label);
    row.appendChild(name);

    if (id) {
      const pct = wearPct(id);
      if (pct !== null) {
        const wear = document.createElement("span");
        wear.className = "equip-wear " + (pct > 60 ? "fine" : pct > 25 ? "worn" : "bad");
        wear.textContent = pct + "%";
        wear.title = "Condition";
        row.appendChild(wear);

        const cost = repairCost(id);
        if (cost) {
          const fix = document.createElement("button");
          fix.className = "minibtn";
          fix.textContent = `Fix ${cost.qty}\u00D7`;
          fix.title = `Repair with ${cost.qty} ${ITEMS[cost.bar].name.toLowerCase()}`;
          fix.disabled = bankQty(cost.bar) < cost.qty;
          fix.onclick = () => repairItem(id);
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
    ["Monsters killed", fmt(state.stats.kills)],
    ["Actions done", fmt(state.stats.actionsDone)],
    ["Deaths", fmt(state.stats.deaths)],
  ];
  rows.forEach(([label, val]) => {
    const r = document.createElement("div");
    r.className = "statrow";
    r.innerHTML = "<span></span><span></span>";
    r.children[0].textContent = label;
    r.children[1].textContent = val;
    box.appendChild(r);
  });
}

function renderLog() {
  const key = state.log.length + "|" + (state.log[state.log.length - 1] || "");
  if (key === logKey) return;
  logKey = key;

  const box = el("eventLog");
  box.innerHTML = "";
  state.log.slice(-10).forEach((line) => {
    const d = document.createElement("div");
    d.textContent = line;
    box.appendChild(d);
  });
}

/* ================= 14. WIRING ================= */

document.querySelectorAll(".tabbtn").forEach((btn) => {
  btn.onclick = () => { tab = btn.dataset.tab; render(); };
});

el("tbSkillingClear").onclick = () => { state.tasks.skilling = null; render(); };
el("tbCombatClear").onclick = () => { state.tasks.combat = null; render(); };
el("bankUpgradeBtn").onclick = buyBankSlots;

el("saveBtn").onclick = () => {
  if (save()) el("saveNote").textContent = "Saved at " + new Date().toLocaleTimeString() + ".";
};

el("wipeBtn").onclick = () => {
  if (!confirm("Delete your save and start over? This cannot be undone.")) return;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  location.reload();
};

el("shareBtn").onclick = () => {
  el("shareBox").value = exportSave();
  el("shareNote").textContent = "";
  el("shareModal").hidden = false;
};

el("shareClose").onclick = () => { el("shareModal").hidden = true; };

el("shareCopy").onclick = () => {
  const box = el("shareBox");
  box.select();
  navigator.clipboard.writeText(box.value)
    .then(() => { el("shareNote").textContent = "Copied to clipboard."; })
    .catch(() => { el("shareNote").textContent = "Couldn't reach the clipboard — select the text and copy manually."; });
};

el("shareLoad").onclick = () => {
  if (!confirm("Loading a save replaces your current character. Continue?")) return;
  const err = importSave(el("shareBox").value);
  if (err) {
    el("shareNote").textContent = err;
  } else {
    el("shareModal").hidden = true;
    toast("Save loaded");
  }
};

/* ================= 15. BOOT + LOOP ================= */

const away = load();
if (away) catchUp(away);
if (state.log.length === 0) {
  say("You wake under a black pine with nothing but time. The forest is quiet.");
}
if (!state.unlocked[skillView]) skillView = "woodcutting";
if (!state.travel.unlocked.includes(areaView)) areaView = "greenwood";

render();

/* Logic runs on wall-clock delta, so a throttled background tab cannot
   desync progression — it just receives a larger dt on the next tick. */
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
  if (tab === "skills") updateSkillCards();
  if (tab === "combat") updateMonsterCards();
  renderSubnav();
  renderLog();
  if (tab === "inventory") renderInventory();
}

setInterval(loop, 100);

// Coming back from a throttled/sleeping tab: settle the delta immediately
// rather than waiting for the next interval.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { loop(); render(); }
});

setInterval(save, 15000);
window.addEventListener("beforeunload", save);
