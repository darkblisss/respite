/* ============================================================
   Respite — a grim, slow idle RPG
   ------------------------------------------------------------
   Framing: you hold a ruined basecamp at the edge of somewhere
   that wants you dead. Camp work and killing happen at once
   because the camp keeps turning while you're out in it.
   ============================================================ */

/* ================= 1. CONSTANTS ================= */

const SCHEMA = 6;
const IDLE_CAP_MS = 12 * 60 * 60 * 1000;
const WINDOW_MS = 12 * 60 * 60 * 1000;      // bounty + smuggler refresh, on world clock
const DAY_MS = 24 * 60 * 60 * 1000;         // weather window
const MAX_LEVEL = 99;
const PLAYER_SWING_MS = 2400;
const RESPAWN_MS = 2000;
const PACK_SLOTS = 18;
const STORES_SLOTS = 30;   // camp stores
const BANK_SLOTS = 50;     // shared bank, reachable from either page
const BANK_MAX = 200;
const RECOVERY_MS = 5 * 60 * 1000;   // knocked out of the fight after a death
const DEATH_WEAR = 25;               // extra durability every worn piece loses on death

const EQUIP_SLOTS = ["weapon", "offhand", "head", "chest", "hands", "feet", "neck", "ring"];
const SLOT_LABELS = {
  weapon: "Weapon", offhand: "Offhand", head: "Head", chest: "Chest",
  hands: "Hands", feet: "Feet", neck: "Neck", ring: "Ring",
};

// Row 1 / Row 2 of the 4x2 paperdoll. A two-hander makes Weapon span both.
const DOLL_ORDER = ["weapon", "head", "chest", "hands", "offhand", "feet", "neck", "ring"];

const RARITIES = [
  { key: "common",   name: "Common",   mult: 1.00, chance: 0.80 },
  { key: "uncommon", name: "Uncommon", mult: 1.18, chance: 0.15 },
  { key: "rare",     name: "Rare",     mult: 1.42, chance: 0.04 },
  { key: "epic",     name: "Epic",     mult: 1.75, chance: 0.01 },
];
const rarityDef = (k) => RARITIES.find((r) => r.key === k) || RARITIES[0];

function rollRarity() {
  let r = Math.random();
  for (const rar of RARITIES) { if (r < rar.chance) return rar.key; r -= rar.chance; }
  return "common";
}

/* ================= 10. TITLE CASE ================= */

const LOWER_WORDS = ["of", "the", "and"];
function titleCase(s) {
  return String(s).split(" ").map((w, i) => {
    if (i > 0 && LOWER_WORDS.includes(w.toLowerCase())) return w.toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

/* ================= 2. ICONS (hand-drawn SVG, no external assets) ================= */

const ICONS = {
  moon: '<path d="M17 3a9 9 0 1 0 4 12 7 7 0 0 1-4-12Z"/><path d="M15 6.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7Z"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',

  // gathering
  pick:   '<path d="M4 20 14 10"/><path d="M6 8c4-3 9-3 13 1-5-1-8 0-9 1-1 1-2 4-1 9-4-4-4-8-3-11Z"/>',
  axe:    '<path d="M5 19 13 11"/><path d="M12 4c3-1 6 0 7 3s0 6-3 7l-2-2 1-2-4-4 1-2Z"/>',
  sickle: '<path d="M5 19c8-1 13-6 14-14"/><path d="M19 5c-6 0-10 4-10 9l4 1c0-4 2-8 6-10Z"/>',
  knife:  '<path d="M4 20 10 14"/><path d="M10 14 18 4l2 2-8 10-2-2Z"/>',
  net:    '<path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9Z"/><path d="M3 12h18M12 3v18M6 6l12 12M18 6 6 18"/>',

  // materials
  ore:    '<path d="M12 3 5 8v8l7 5 7-5V8l-7-5Z"/><path d="M12 3v8l7-3M12 11 5 8M12 11v10"/>',
  log:    '<path d="M7 6h10a3 3 0 0 1 0 12H7a3 3 0 0 1 0-12Z"/><path d="M7 6a3 3 0 0 0 0 12"/><circle cx="7" cy="12" r="1.6"/>',
  fibre:  '<path d="M12 21c0-6-3-9-6-11 4 0 6 2 6 5"/><path d="M12 21c0-7 3-10 6-12-4 0-6 3-6 6"/><path d="M12 21V9"/>',
  hide:   '<path d="M6 4c3 1 9 1 12 0 1 4 1 8-1 11-2 3-3 5-5 5s-3-2-5-5C5 12 5 8 6 4Z"/>',
  gem:    '<path d="M12 3 4 9l8 12 8-12-8-6Z"/><path d="M4 9h16M12 3l-4 6 4 12 4-12-4-6Z"/>',
  ration: '<path d="M5 9h14l-1.2 10a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/>',
  crate:  '<rect x="3" y="6" width="18" height="14" rx="1"/><path d="M3 11h18M9 6v14M15 6v14"/>',

  // gear
  blade:      '<path d="m5 19 3-3M6 18l-2 2"/><path d="M9 15 18 3l3 3-12 9-3 3-1-1 3-2Z"/>',
  greatblade: '<path d="M12 21v-4M8 17h8"/><path d="M12 17 8 8l4-5 4 5-4 9Z"/>',
  stave:      '<path d="M7 21 17 6"/><path d="M17 6a3 3 0 1 0 0-.1Z"/><path d="M15.5 2.5 17 5l2.5-1L18 6.5"/>',
  ward:       '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/><path d="M12 8v7M9 11h6"/>',
  plate:      '<path d="M8 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6l-4-3-4 2-4-2Z"/><path d="M12 5v16"/>',
  greaves:    '<path d="M8 3h8l-1 9-1 9h-3l-1-9-1-9Z"/><path d="M7.5 12h9"/>',
  treads:     '<path d="M4 15V5h5v5c0 2 2 3 4 4l4 2v3H4v-4Z"/><path d="M4 17h13"/>',
  gauntlets:  '<path d="M7 21V9a2 2 0 0 1 4 0V4a1.5 1.5 0 0 1 3 0v5a2 2 0 0 1 3 1.7V17a4 4 0 0 1-4 4H7Z"/>',
  cowl:       '<path d="M12 3c5 0 8 4 8 9 0 4-3 9-8 9s-8-5-8-9c0-5 3-9 8-9Z"/><path d="M8 12c1.5-1 6.5-1 8 0"/>',
  shroud:     '<path d="M9 3 5 7v14h14V7l-4-4-3 3-3-3Z"/><path d="M12 6v15"/>',
  band:       '<circle cx="12" cy="14" r="6"/><path d="m9 6 3-3 3 3-3-3Z"/>',
  charm:      '<path d="M7 3h10l-5 6-5-6Z"/><path d="M12 9a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/>',

  // monsters
  beast:   '<path d="M4 8 6 3l4 3h4l4-3 2 5v5c0 4-4 7-8 7s-8-3-8-7V8Z"/><path d="M9 12h.01M15 12h.01M10 16h4"/>',
  man:     '<path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/><path d="M4 21c0-5 4-8 8-8s8 3 8 8"/>',
  golemMob:'<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M9 10h.01M15 10h.01M9 15h6"/>',
  horror:  '<path d="M12 3c5 0 9 4 9 9s-4 9-9 9-9-4-9-9 4-9 9-9Z"/><path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/><path d="M12 11.5a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1Z"/>',
  drakeMob:'<path d="M3 10c4-4 8-4 10-1 2-3 6-3 8 1-2 1-3 3-4 6-2 4-6 5-10 2 2-1 3-3 3-5-3 0-5-1-7-3Z"/>',

  // ui
  atlas:  '<path d="M9 4 3 7v13l6-3 6 3 6-3V4l-6 3-6-3Z"/><path d="M9 4v13M15 7v13"/>',
  shop:   '<path d="M4 8h16l-1 12H5L4 8Z"/><path d="M4 8 6 4h12l2 4"/><path d="M9 12a3 3 0 0 0 6 0"/>',
  scroll: '<path d="M6 3h10a2 2 0 0 1 2 2v14a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  pack:   '<path d="M6 8h12l1 13H5L6 8Z"/><path d="M9 8V5a3 3 0 0 1 6 0v3"/><path d="M9 13h6"/>',
  person: '<path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>',
  paw:    '<circle cx="7" cy="9" r="2"/><circle cx="12" cy="6.5" r="2"/><circle cx="17" cy="9" r="2"/><path d="M12 11c3 0 5 2.5 5 5a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3c0-2.5 2-5 5-5Z"/>',
  swords: '<path d="m4 4 9 9M14 14l6 6M18 4l-9 9M10 14l-6 6"/>',
  rain:   '<path d="M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 2A3.5 3.5 0 0 1 17 15H7Z"/><path d="M8 18v2M12 18v3M16 18v2"/>',
  sun:    '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"/>',
  fog:    '<path d="M3 8h14M6 12h15M3 16h13M7 20h11"/>',
  unknown:'<circle cx="12" cy="12" r="8"/><path d="M12 16h.01M9.5 9.5a2.5 2.5 0 1 1 3 3.5"/>',
};

function icon(name, cls) {
  const body = ICONS[name] || ICONS.unknown;
  return `<svg class="ico ${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* ================= 3. XP CURVE ================= */

const XP_TABLE = (() => {
  const t = [0];
  for (let L = 1; L <= MAX_LEVEL; L++) {
    t[L] = Math.floor(65 * (L - 1) + 5 * Math.pow(L - 1, 2.5) + 2.5 * Math.pow(1.165, L - 1) - 2.5);
  }
  return t;
})();

function levelFromXp(xp) {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= XP_TABLE[lvl + 1]) lvl++;
  return lvl;
}

/* ================= 4. TIERS ================= */

const STRATA = [
  { key: "scavenged", name: "Scavenged", tiers: [1, 2, 3] },
  { key: "barrow",    name: "Barrow",    tiers: [4, 5, 6] },
  { key: "sovereign", name: "Sovereign", tiers: [7, 8, 9] },
];
const stratumOf = (tier) => STRATA.find((s) => s.tiers.includes(tier)) || STRATA[0];

const TIERS = [
  { i: 1, level: 1,  time: 12000, xp: 1,  fell: "Bitter Brush",    delve: "Slag Ore",       harvest: "Stink Weed",     flay: "Mangy Pelt",         dredge: "Mud Pebble" },
  { i: 2, level: 10, time: 16000, xp: 3,  fell: "Blood Ash",       delve: "Bog Ore",        harvest: "Grave Moss",     flay: "Bristle Pelt",       dredge: "River Amber" },
  { i: 3, level: 20, time: 24000, xp: 6,  fell: "Iron Bark",       delve: "Cold Ore",       harvest: "Pale Rush",      flay: "Dire Pelt",          dredge: "Cave Agate" },
  { i: 4, level: 30, time: 32000, xp: 10, fell: "Barrow Pine",     delve: "Cairn Steel",    harvest: "Corpse Bloom",   flay: "Cured Hide",         dredge: "Mourning Quartz" },
  { i: 5, level: 40, time: 40000, xp: 15, fell: "Sallow Timber",   delve: "Crucible Steel", harvest: "Widows Bloom",   flay: "Scaled Hide",        dredge: "Ghost Opal" },
  { i: 6, level: 50, time: 48000, xp: 22, fell: "Umber Heartwood", delve: "Star Steel",     harvest: "Dragon Bloom",   flay: "Chitin Hide",        dredge: "Blood Ruby" },
  { i: 7, level: 60, time: 56000, xp: 30, fell: "Wyrm Root",       delve: "Wyrm Core",      harvest: "Moon Frond",     flay: "Drake Carapace",     dredge: "Abyssal Coral" },
  { i: 8, level: 70, time: 64000, xp: 39, fell: "Void Root",       delve: "Void Core",      harvest: "Fade Frond",     flay: "Leviathan Carapace", dredge: "Leviathan Bone" },
  { i: 9, level: 80, time: 72000, xp: 49, fell: "Godsdown Knot",   delve: "Titan Core",     harvest: "Godsbane Frond", flay: "Demon Carapace",     dredge: "Void Sapphire" },
];

const REAGENT_CHANCES = [0, 0, 0, 0.0125, 0.025, 0.0375, 0.05, 0.0625, 0.075, 0.10];

const basePrefix = (name) => name.split(" ")[0];
const slug = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

/* ================= 5. SKILLS ================= */

const GATHER_SKILLS = [
  { id: "delving",    name: "Delving",    icon: "pick",   mat: "delve",   reagent: "Coal",      matIcon: "ore",   reagIcon: "gem" },
  { id: "felling",    name: "Felling",    icon: "axe",    mat: "fell",    reagent: "Resin",     matIcon: "log",   reagIcon: "gem" },
  { id: "harvesting", name: "Harvesting", icon: "sickle", mat: "harvest", reagent: "Pulp",      matIcon: "fibre", reagIcon: "gem" },
  { id: "flaying",    name: "Flaying",    icon: "knife",  mat: "flay",    reagent: "Tallow",    matIcon: "hide",  reagIcon: "gem" },
  { id: "dredging",   name: "Dredging",   icon: "net",    mat: "dredge",  reagent: "Veil Shard",matIcon: "gem",   reagIcon: "gem" },
];

const PROFESSIONS = [
  { id: "forgemaster", name: "Forgemaster", icon: "plate",  weight: "Heavy",
    note: "Heavy plate and weapons from Delving. Slow, unglamorous, and holds a line." },
  { id: "woodwright",  name: "Woodwright",  icon: "ward",   weight: "Heavy",
    note: "Bows, shields, and timber crafts from Felling." },
  { id: "tanner",      name: "Tanner",      icon: "treads", weight: "Medium",
    note: "Medium leather and grips from Flaying. Quick, quiet, always wearing out." },
  { id: "weaver",      name: "Weaver",      icon: "cowl",   weight: "Light",
    note: "Light woven cloth from Harvesting. Almost no defence, carries the life in it." },
  { id: "artificer",   name: "Artificer",   icon: "charm",  weight: "Relic",
    note: "Magical cores, staves, and tomes from Dredging." },
];

const SKILLS = []
  .concat(GATHER_SKILLS.map((s) => ({ id: s.id, name: s.name, icon: s.icon, kind: "gather" })))
  .concat(PROFESSIONS.map((p) => ({ id: p.id, name: p.name, icon: p.icon, kind: "craft" })))
  .concat([{ id: "warfare", name: "Combat", icon: "swords", kind: "war" }]);

const skillDef = (id) => SKILLS.find((s) => s.id === id);
const skillName = (id) => (skillDef(id) ? skillDef(id).name : id);

/* ================= 6. GENERATED ECONOMY ================= */

const MATERIALS = {};
const GEAR = {};
const TOOLS = {};
const GATHER_ACTIONS = {};
const CRAFT_ACTIONS = { forgemaster: [], woodwright: [], tanner: [], weaver: [], artificer: [] };

const matId = (tier, type) => `${slug(basePrefix(tier[type]))}_${type}`;

// Provisions
const PROVISION_SPEC = [
  { tier: 1, name: "Bitter-Ash Salve",     heal: 25,   price: 50 },
  { tier: 3, name: "Gravemoss Poultice",   heal: 70,   price: 150 },
  { tier: 4, name: "Corpse-Marrow Draught",heal: 180,  price: 450 },
  { tier: 6, name: "Star-Steel Tonic",     heal: 380,  price: 1400 },
  { tier: 7, name: "Leviathan Blood",      heal: 800,  price: 4200, smuggler: true },
  { tier: 9, name: "Godsbane Elixir",      heal: 1800, price: 12000, smuggler: true },
];
const RATIONS = PROVISION_SPEC.map((p) => ({
  id: `provision_t${p.tier}`, name: p.name, icon: "ration", kind: "material",
  tier: p.tier, heal: p.heal, value: Math.round(p.price * 0.4), price: p.price, smuggler: !!p.smuggler,
}));
RATIONS.forEach((r) => { MATERIALS[r.id] = r; });

MATERIALS.vault_chest = { id: "vault_chest", name: "Banded Chest", icon: "crate", kind: "material", value: 600, chest: 5, tier: 2 };
CRAFT_ACTIONS.woodwright.push({
  id: "craft_vault_chest", skillId: "woodwright", tier: 2, name: "Banded Chest", icon: "crate",
  level: 12, time: 45000, xp: 8, cost: { [matId(TIERS[1], "fell")]: 20 }, out: { vault_chest: 1 }
});

// Generation Setup
const compTime = (t) => (45 + 75 * t) * 1000;
const gearTime = (t) => (90 + 150 * t) * 1000;
const statPwr = (t) => 4 * Math.pow(1.52, t - 1);
const valBase = (t) => 4 * Math.pow(2.05, t - 1);

function addMat(id, name, icon, tier, valMult) {
  MATERIALS[id] = { id, name, icon, kind: "material", value: Math.round(valBase(tier) * valMult), tier };
}

function addGear(id, name, icon, slot, tier, prof, atk, def, hp, twoHand, maxDur) {
  const pwr = statPwr(tier);
  GEAR[id] = {
    id, name, icon, kind: "gear", slot, tier, prof,
    attack: Math.round(pwr * atk), defence: Math.round(pwr * def), health: Math.round(pwr * hp),
    twoHanded: !!twoHand, maxDur, repairMat: matId(TIERS[tier - 1], "delve"),
    value: Math.round(pwr * (atk + def + hp) * 34 + 50),
  };
}

function addCraft(prof, id, name, icon, tier, levelOffset, time, xpOffset, cost, outItem, isGear) {
  CRAFT_ACTIONS[prof].push({
    id: `craft_${id}`, skillId: prof, tier, name, icon,
    level: TIERS[tier - 1].level + levelOffset, time, xp: Math.round(TIERS[tier - 1].xp * xpOffset) + 1,
    cost, [isGear ? "craftGear" : "out"]: isGear ? id : { [id]: 1 },
  });
}

TIERS.forEach((t) => {
  const tier = t.i;
  const tDelve = basePrefix(t.delve), tFell = basePrefix(t.fell), tHarv = basePrefix(t.harvest), tFlay = basePrefix(t.flay), tDred = basePrefix(t.dredge);

  // 1. RAW MATERIALS & GATHER ACTIONS
  GATHER_SKILLS.forEach((s) => {
    const rawId = matId(t, s.mat);
    const reagId = `${slug(basePrefix(t[s.mat]))}_${slug(s.reagent)}`;
    addMat(rawId, t[s.mat], s.matIcon, tier, 1.0);
    addMat(reagId, `${basePrefix(t[s.mat])}${s.reagent}`, s.reagIcon, tier, 1.5);

    if (!GATHER_ACTIONS[s.id]) GATHER_ACTIONS[s.id] = [];
    if (tier === 1 || tier === 2) {
      GATHER_ACTIONS[s.id].push({
        id: `${s.id}_t${tier}_raw`, skillId: s.id, tier, name: `Gather ${t[s.mat]}`, icon: s.matIcon,
        level: t.level, time: t.time, xp: t.xp, out: { [rawId]: 1 }
      });
      GATHER_ACTIONS[s.id].push({
        id: `${s.id}_t${tier}_reag`, skillId: s.id, tier, name: `Gather ${MATERIALS[reagId].name}`, icon: s.reagIcon,
        level: t.level + (tier === 1 ? 3 : 5), time: t.time, xp: t.xp + 1, out: { [reagId]: 1 }
      });
    } else {
      GATHER_ACTIONS[s.id].push({
        id: `${s.id}_t${tier}`, skillId: s.id, tier, name: `Gather ${t[s.mat]}`, icon: s.matIcon,
        level: t.level, time: t.time, xp: t.xp, out: { [rawId]: 1 },
        reagentId: reagId, reagentChance: REAGENT_CHANCES[tier]
      });
    }
  });

  const coal = `${slug(tDelve)}_coal`, resin = `${slug(tFell)}_resin`, pulp = `${slug(tHarv)}_pulp`, tallow = `${slug(tFlay)}_tallow`, shard = `${slug(tDred)}_veilshard`;

  // 2. REFINED MATERIALS
  const bar = `${slug(tDelve)}_bar`, plank = `${slug(tFell)}_plank`, weave = `${slug(tHarv)}_weave`, leather = `${slug(tFlay)}_leather`, inlay = `${slug(tDred)}_inlay`;
  addMat(bar, `${tDelve} Bar`, "ore", tier, 3.5);
  addMat(plank, `${tFell} Plank`, "log", tier, 3.5);
  addMat(weave, `${tHarv} Weave`, "fibre", tier, 3.5);
  addMat(leather, `${tFlay} Leather`, "hide", tier, 3.5);
  addMat(inlay, `${tDred} Inlay`, "gem", tier, 3.5);

  addCraft("forgemaster", bar, MATERIALS[bar].name, "ore", tier, 0, t.time, 0.5, { [matId(t, "delve")]: 2, [coal]: tier }, false, false);
  addCraft("woodwright", plank, MATERIALS[plank].name, "log", tier, 0, t.time, 0.5, { [matId(t, "fell")]: 2, [resin]: tier }, false, false);
  addCraft("weaver", weave, MATERIALS[weave].name, "fibre", tier, 0, t.time, 0.5, { [matId(t, "harvest")]: 2, [pulp]: tier }, false, false);
  addCraft("tanner", leather, MATERIALS[leather].name, "hide", tier, 0, t.time, 0.5, { [matId(t, "flay")]: 2, [tallow]: tier }, false, false);
  addCraft("artificer", inlay, MATERIALS[inlay].name, "gem", tier, 0, t.time, 0.5, { [matId(t, "dredge")]: 10, [shard]: tier * 2 }, false, false);

  // 3. COMPONENTS
  const blade = `${slug(tDelve)}_blade`, handle = `${slug(tFell)}_handle`, score = `${slug(tFell)}_score`, bind = `${slug(tFlay)}_bind`;
  const stave = `${slug(tFell)}_stave`, string = `${slug(tHarv)}_string`, grip = `${slug(tFlay)}_grip`, shaft = `${slug(tFell)}_shaft`;
  const head = `${slug(tDelve)}_head`, gblade = `${slug(tDelve)}_gblade`, ggrip = `${slug(tFell)}_ggrip`, book = `${slug(tHarv)}_book`, clasp = `${slug(tDred)}_clasp`;

  addMat(blade, `${tDelve} Blade`, "blade", tier, 10);
  addMat(handle, `${tFell} Handle`, "log", tier, 10);
  addMat(score, `${tFell} Shield Core`, "ward", tier, 10);
  addMat(bind, `${tFlay} Binding`, "hide", tier, 6);
  addMat(stave, `${tFell} Bow Stave`, "stave", tier, 10);
  addMat(string, `${tHarv} Bowstring`, "fibre", tier, 8);
  addMat(grip, `${tFlay} Grip`, "hide", tier, 8);
  addMat(shaft, `${tFell} Shaft`, "stave", tier, 10);
  addMat(head, `${tDelve} Staff Head`, "gem", tier, 10);
  addMat(gblade, `${tDelve} Great Blade`, "greatblade", tier, 14);
  addMat(ggrip, `${tFell} Great Grip`, "log", tier, 10);
  addMat(book, `${tHarv} Book Tome`, "book", tier, 14);
  addMat(clasp, `${tDred} Clasp`, "gem", tier, 6);

  const cTime = compTime(tier);
  addCraft("forgemaster", blade, MATERIALS[blade].name, "blade", tier, 1, cTime, 1.2, { [bar]: 12, [coal]: tier }, false, false);
  addCraft("woodwright", handle, MATERIALS[handle].name, "log", tier, 1, cTime, 1.2, { [plank]: 8, [leather]: 5, [resin]: tier }, false, false);
  addCraft("woodwright", score, MATERIALS[score].name, "ward", tier, 1, cTime, 1.2, { [bar]: 11, [plank]: 8, [resin]: tier }, false, false);
  addCraft("tanner", bind, MATERIALS[bind].name, "hide", tier, 1, cTime, 1.0, { [leather]: 6, [tallow]: tier }, false, false);
  addCraft("woodwright", stave, MATERIALS[stave].name, "stave", tier, 2, cTime, 1.2, { [plank]: 14, [resin]: tier }, false, false);
  addCraft("weaver", string, MATERIALS[string].name, "fibre", tier, 2, cTime, 1.2, { [weave]: 12, [pulp]: tier }, false, false);
  addCraft("tanner", grip, MATERIALS[grip].name, "hide", tier, 2, cTime, 1.2, { [leather]: 12, [tallow]: tier }, false, false);
  addCraft("woodwright", shaft, MATERIALS[shaft].name, "stave", tier, 3, cTime, 1.2, { [plank]: 13, [resin]: tier }, false, false);
  addCraft("artificer", head, MATERIALS[head].name, "gem", tier, 3, cTime, 1.2, { [bar]: 13, [inlay]: 2, [shard]: tier }, false, false);
  addCraft("forgemaster", gblade, MATERIALS[gblade].name, "greatblade", tier, 4, cTime, 1.4, { [bar]: 14, [coal]: tier }, false, false);
  addCraft("woodwright", ggrip, MATERIALS[ggrip].name, "log", tier, 4, cTime, 1.4, { [plank]: 12, [leather]: 6, [resin]: tier }, false, false);
  addCraft("weaver", book, MATERIALS[book].name, "book", tier, 4, cTime, 1.4, { [weave]: 26, [pulp]: tier }, false, false);
  addCraft("artificer", clasp, MATERIALS[clasp].name, "gem", tier, 4, cTime, 1.0, { [inlay]: 2, [shard]: tier }, false, false);

  // 4. GEAR (Weapons & Armor)
  const gTime = gearTime(tier);
  const dur = 400 + tier * 220;

  const wSword = `${slug(tDelve)}_sword`, wDagger = `${slug(tDelve)}_dagger`, wShield = `${slug(tFell)}_shield`, wBow = `${slug(tFell)}_bow`;
  const wStaff = `${slug(tDred)}_staff`, wGsword = `${slug(tDelve)}_greatsword`, wGrimoire = `${slug(tDred)}_grimoire`;

  addGear(wSword, `${tDelve} Sword`, "blade", "weapon", tier, "forgemaster", 1.0, 0.15, 0, false, dur);
  addGear(wDagger, `${tDelve} Dagger`, "blade", "weapon", tier, "forgemaster", 1.15, 0, 0, false, dur);
  addGear(wShield, `${tFell} Shield`, "ward", "offhand", tier, "woodwright", 0, 0.9, 0, false, dur);
  addGear(wBow, `${tFell} Bow`, "stave", "weapon", tier, "woodwright", 1.4, 0.1, 0, true, dur);
  addGear(wStaff, `${tDred} Staff`, "stave", "weapon", tier, "artificer", 1.2, 0.3, 0, true, dur);
  addGear(wGsword, `${tDelve} Greatsword`, "greatblade", "weapon", tier, "forgemaster", 1.75, 0, 0, true, dur);
  addGear(wGrimoire, `${tDred} Grimoire`, "book", "offhand", tier, "artificer", 0.3, 0.5, 0.6, false, dur);

  addCraft("forgemaster", wSword, GEAR[wSword].name, "blade", tier, 2, gTime, 2.5, { [blade]: 1, [handle]: 1 }, true, true);
  addCraft("forgemaster", wDagger, GEAR[wDagger].name, "blade", tier, 2, gTime, 2.5, { [blade]: 1, [handle]: 1 }, true, true);
  addCraft("woodwright", wShield, GEAR[wShield].name, "ward", tier, 2, gTime, 2.5, { [score]: 1, [bind]: 1 }, true, true);
  addCraft("woodwright", wBow, GEAR[wBow].name, "stave", tier, 3, gTime, 2.8, { [stave]: 1, [string]: 1, [grip]: 1 }, true, true);
  addCraft("artificer", wStaff, GEAR[wStaff].name, "stave", tier, 3, gTime, 2.8, { [shaft]: 1, [head]: 1, [bind]: 1 }, true, true);
  addCraft("forgemaster", wGsword, GEAR[wGsword].name, "greatblade", tier, 4, gTime, 3.2, { [gblade]: 1, [ggrip]: 1, [bind]: 1 }, true, true);
  addCraft("artificer", wGrimoire, GEAR[wGrimoire].name, "book", tier, 4, gTime, 3.2, { [book]: 1, [bind]: 1, [clasp]: 1 }, true, true);

  // Heavy Armor (Forgemaster)
  const aHH = `${slug(tDelve)}_helm`, aHC = `${slug(tDelve)}_chest`, aHB = `${slug(tDelve)}_hboots`, aHG = `${slug(tDelve)}_hgaunts`;
  addGear(aHH, `${tDelve} Helm`, "cowl", "head", tier, "forgemaster", 0, 0.55, 0, false, dur);
  addGear(aHC, `${tDelve} Chestplate`, "plate", "chest", tier, "forgemaster", 0, 1.0, 0, false, dur);
  addGear(aHB, `${tDelve} Boots`, "treads", "feet", tier, "forgemaster", 0, 0.7, 0, false, dur);
  addGear(aHG, `${tDelve} Gauntlets`, "gauntlets", "hands", tier, "forgemaster", 0.1, 0.4, 0, false, dur);
  [aHH, aHC, aHB, aHG].forEach(id => addCraft("forgemaster", id, GEAR[id].name, GEAR[id].icon, tier, 2, gTime, 2.5, { [bar]: 20, [coal]: tier }, true, true));

  // Medium Armor (Tanner)
  const aMH = `${slug(tFlay)}_hood`, aMC = `${slug(tFlay)}_jacket`, aMB = `${slug(tFlay)}_mboots`, aMG = `${slug(tFlay)}_mgloves`;
  addGear(aMH, `${tFlay} Hood`, "cowl", "head", tier, "tanner", 0, 0.4, 0.2, false, dur);
  addGear(aMC, `${tFlay} Jacket`, "shroud", "chest", tier, "tanner", 0.1, 0.7, 0, false, dur);
  addGear(aMB, `${tFlay} Boots`, "treads", "feet", tier, "tanner", 0, 0.45, 0, false, dur);
  addGear(aMG, `${tFlay} Gloves`, "gauntlets", "hands", tier, "tanner", 0.18, 0.32, 0, false, dur);
  [aMH, aMC, aMB, aMG].forEach(id => addCraft("tanner", id, GEAR[id].name, GEAR[id].icon, tier, 2, gTime, 2.5, { [leather]: 20, [tallow]: tier }, true, true));

  // Light Armor (Weaver)
  const aLH = `${slug(tHarv)}_hood`, aLC = `${slug(tHarv)}_robe`, aLB = `${slug(tHarv)}_lboots`, aLG = `${slug(tHarv)}_lgloves`;
  addGear(aLH, `${tHarv} Hood`, "cowl", "head", tier, "weaver", 0, 0.3, 0.8, false, dur);
  addGear(aLC, `${tHarv} Robe`, "shroud", "chest", tier, "weaver", 0.18, 0.4, 1.2, false, dur);
  addGear(aLB, `${tHarv} Boots`, "treads", "feet", tier, "weaver", 0, 0.2, 0.5, false, dur);
  addGear(aLG, `${tHarv} Gloves`, "gauntlets", "hands", tier, "weaver", 0.22, 0.15, 0.4, false, dur);
  [aLH, aLC, aLB, aLG].forEach(id => addCraft("weaver", id, GEAR[id].name, GEAR[id].icon, tier, 2, gTime, 2.5, { [weave]: 20, [pulp]: tier }, true, true));

  // 5. TOOLS
  const pPick = `${slug(tDelve)}_pick`, pAxe = `${slug(tFell)}_axe`, pSick = `${slug(tHarv)}_sickle`, pKni = `${slug(tFlay)}_knife`, pNet = `${slug(tDred)}_net`;
  const mTool = (id, name, icon, skill, prof, cost) => {
    TOOLS[id] = { id, name, icon, kind: "tool", forSkill: skill, tier, speed: tier * 0.02, value: Math.round(60 * Math.pow(2.1, tier - 1)) };
    addCraft(prof, id, name, icon, tier, 2, gTime, 2.5, cost, { [id]: 1 }, false);
  };
  mTool(pPick, `${tDelve} Pickaxe`, "pick", "delving", "forgemaster", { [bar]: 10, [coal]: tier });
  mTool(pAxe, `${tFell} Axe`, "axe", "felling", "woodwright", { [plank]: 10, [resin]: tier });
  mTool(pSick, `${tHarv} Sickle`, "sickle", "harvesting", "weaver", { [bar]: 10, [pulp]: tier });
  mTool(pKni, `${tFlay} Knife`, "knife", "flaying", "tanner", { [bar]: 10, [leather]: 5, [tallow]: tier });
  mTool(pNet, `${tDred} Net`, "net", "dredging", "artificer", { [leather]: 10, [plank]: 5, [shard]: tier });
});

// Common gear stacks. Uncommon and above gets a unique instance id
function makeKey(base, rarity) {
  if (!rarity) return base;
  if (rarity === "common") return `${base}|common`;
  return `${base}|${rarity}\vert{}${state.uid++}`;
}
function stacks(key) { const p = parseKey(key); return !p.uid; }
function parseKey(key) { const b = String(key).split("|"); return { base: b[0], rarity: b[1] || null, uid: b[2] || null }; }

function itemDef(key) {
  const { base, rarity } = parseKey(key);
  const g = GEAR[base];
  if (g) {
    const m = rarityDef(rarity || "common").mult;
    return {
      base, rarity: rarity || "common", kind: "gear", name: g.name, icon: g.icon, slot: g.slot,
      attack: Math.round(g.attack * m), defence: Math.round(g.defence * m), health: Math.round(g.health * m),
      twoHanded: g.twoHanded, maxDur: g.maxDur, repairMat: g.repairMat,
      value: Math.round(g.value * m), tier: g.tier, prof: g.prof
    };
  }
  const mat = MATERIALS[base] || TOOLS[base];
  return mat ? Object.assign({ base, rarity: null }, mat) : null;
}

function itemName(key) {
  const d = itemDef(key);
  if (!d) return String(key);
  return d.kind === "gear" && d.rarity !== "common" ? `${rarityDef(d.rarity).name}${d.name}` : d.name;
}

function actionsFor(skillId) { return GATHER_ACTIONS[skillId] || CRAFT_ACTIONS[skillId] || []; }
function findAction(skillId, actionId) { return actionsFor(skillId).find((a) => a.id === actionId) || null; }


/* ================= 9. ATLAS + MONSTERS ================= */

const REGION_NAMES = [
  ["The Ashen Verge", "Dead ground at the camp's edge. Everything here is already picked over — which is why it's safe."],
  ["Gallowmoor", "Peat and gibbets. The iron in the bog came from something, and nobody asks what."],
  ["The Cold Warrens", "Tunnels under the moor. Cold enough that the bodies down there never went off."],
  ["Graveshelf", "A shelf of pine and cairns above the treeline. The cairns are recent."],
  ["The Sallow Fen", "Standing water that doesn't reflect. Things move under it with purpose."],
  ["Umberdeep", "Old-growth dark. Star iron falls here and the trees grow around it."],
  ["Wyrmreach", "Warm stone, crooked trees. Something underneath breathes and the ground answers."],
  ["The Fade", "Thin light, thinner air. Your own footsteps arrive a moment late."],
  ["Godsdown", "The last ground. Roots the width of streets and whatever it is that feeds them."],
];
const TOLLS = [0, 300, 600, 1100, 1700, 2500, 4200, 6500, 10000];

const REGIONS = TIERS.map((t, i) => ({
  id: `region_${t.i}`, tier: t.i, name: REGION_NAMES[i][0], note: REGION_NAMES[i][1], level: t.level, toll: TOLLS[i]
}));

const ROSTER_SPEC = [
  { grunt: ["Carrion Rat", "beast"],       elite: ["Ash Stalker", "horror"],     boss: ["The Ashen Warden", "horror"] },
  { grunt: ["Bog Crawler", "beast"],       elite: ["Gibbet Shade", "horror"],    boss: ["The Drowned Bailiff", "man"] },
  { grunt: ["Warren Goblin", "man"],       elite: ["Warren Butcher", "man"],     boss: ["The Cold Matriarch", "horror"] },
  { grunt: ["Cairn Hound", "beast"],       elite: ["Cairn Wight", "horror"],     boss: ["The Barrow King", "man"] },
  { grunt: ["Fen Lurker", "beast"],        elite: ["Sallow Troll", "beast"],     boss: ["Mother Sallow", "horror"] },
  { grunt: ["Umber Husk", "golemMob"],     elite: ["Star-Iron Golem", "golemMob"], boss: ["The Umber Colossus", "golemMob"] },
  { grunt: ["Wyrmkin Raider", "drakeMob"], elite: ["Wyrmkin Warlord", "drakeMob"], boss: ["The Wyrm Beneath", "drakeMob"] },
  { grunt: ["Fade Echo", "horror"],        elite: ["Fade Warden", "horror"],     boss: ["The Thin Man", "horror"] },
  { grunt: ["Godsdown Spawn", "horror"],   elite: ["Godsdown Horror", "horror"], boss: ["What Feeds The Roots", "horror"] },
];

const THREAT_CAP = 100;
const MONSTERS = [];
TIERS.forEach((t, i) => {
  const s = Math.pow(2.1, t.i - 1);
  const spec = ROSTER_SPEC[i];
  const mk = (rank, nameIcon, mul) => ({
    id: `mob_t${t.i}_${rank}`, tier: t.i, rank, name: nameIcon[0], icon: nameIcon[1],
    level: t.level + (rank === "elite" ? 4 : rank === "boss" ? 8 : 0),
    hp: Math.round(16 * s * mul.hp), attack: Math.round(4 * s * mul.atk), defence: Math.round(1.6 * s * mul.def),
    speed: rank === "elite" ? 2600 : rank === "boss" ? 3000 : 3000,
    xp: Math.round(t.xp * 2.6 * mul.xp), gold: [Math.round(3 * s * mul.gold), Math.round(8 * s * mul.gold)],
    drops: [
      [matId(t, "flay"), rank === "boss" ? 3 : 1, 0.5],
      [matId(t, "delve"), rank === "boss" ? 3 : 1, 0.22],
      [matId(t, "dredge"), rank === "boss" ? 2 : 1, 0.14],
    ],
  });
  MONSTERS.push(mk("grunt", spec.grunt, { hp: 1, atk: 1, def: 1, xp: 1, gold: 1 }));
  MONSTERS.push(mk("elite", spec.elite, { hp: 1.8, atk: 1.45, def: 1.3, xp: 2.4, gold: 2.2 }));
  MONSTERS.push(mk("boss",  spec.boss,  { hp: 9, atk: 2.1, def: 1.8, xp: 14, gold: 16 }));
});

const rosterFor = (tier) => MONSTERS.filter((m) => m.tier === tier);
const rankOf = (tier, rank) => MONSTERS.find((m) => m.tier === tier && m.rank === rank);
function threatIn(tier) { return (state.threat && state.threat[tier]) || 0; }
function rollSpawn(tier) {
  if (threatIn(tier) >= THREAT_CAP) return rankOf(tier, "boss");
  return rankOf(tier, Math.random() < 0.2 ? "elite" : "grunt");
}

const regionById = (id) => REGIONS.find((r) => r.id === id) || REGIONS[0];
const monsterOfTier = (tier) => rankOf(tier, "grunt");
const getMonster = (id) => MONSTERS.find((m) => m.id === id) || null;

/* ================= 11. WEATHER ================= */

const WEATHER_WEEK = [
  { id: "bountiful", name: "Bountiful Rest", icon: "sun", note: "Every trade earns more.", xp: 1.2, mods: {} },
  { id: "fog", name: "Grave Fog", icon: "fog", note: "Flaying and Harvesting drag. Delving is untroubled.", xp: 1, mods: { flaying: 1.1, harvesting: 1.1, delving: 0.9 } },
  { id: "rain", name: "Rain", icon: "rain", note: "Dredging runs quick. Felling bogs down.", xp: 1, mods: { dredging: 0.9, felling: 1.1 } },
  { id: "clear", name: "Clear Skies", icon: "sun", note: "Nothing helping, nothing hindering.", xp: 1, mods: {} },
  { id: "frost", name: "Hard Frost", icon: "fog", note: "Open ground stiffens. Forge goes faster.", xp: 1, mods: { felling: 1.1, harvesting: 1.1, forgemaster: 0.9 } },
  { id: "swelter", name: "Swelter", icon: "sun", note: "Camp work drags. Cold water is a relief.", xp: 1, mods: { forgemaster: 1.1, woodwright: 1.1, dredging: 0.9 } },
  { id: "bountiful", name: "Bountiful Rest", icon: "sun", note: "Every trade earns more.", xp: 1.2, mods: {} },
];
function seedFrom(n) { const x = Math.sin(n) * 10000; return x - Math.floor(x); }
function weatherOn(dayOffset) { const d = new Date(Date.now() + (dayOffset || 0) * DAY_MS); return WEATHER_WEEK[d.getUTCDay()]; }
const currentWeather = () => weatherOn(0);
function serverClock() { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`; }

/* ================= 12. MASTERY ================= */

const MASTERY_TRACK = [
  { level: 10, speed: 0.03, double: 0,    label: "Steady Hands", desc: "+3% speed" },
  { level: 20, speed: 0,    double: 0.02, label: "Keen Eye",     desc: "+2% double yield" },
  { level: 30, speed: 0.03, double: 0,    label: "Practised",    desc: "+3% speed" },
  { level: 40, speed: 0,    double: 0.03, label: "Rich Pickings", desc: "+3% double yield" },
  { level: 50, speed: 0.04, double: 0,    label: "Journeyman",   desc: "+4% speed" },
  { level: 60, speed: 0,    double: 0.05, label: "Deep Instinct", desc: "+5% double yield" },
  { level: 70, speed: 0.05, double: 0,    label: "Master's Pace", desc: "+5% speed" },
  { level: 80, speed: 0,    double: 0.05, label: "Bountiful Hand", desc: "+5% double yield" },
  { level: 90, speed: 0.05, double: 0.05, label: "Peerless",     desc: "+5% speed, +5% double" },
];
function mastery(skillId) {
  const lvl = skillLevel(skillId);
  let speed = 0, dbl = 0;
  MASTERY_TRACK.forEach((m) => { if (lvl >= m.level) { speed += m.speed; dbl += m.double; } });
  return { speed, double: dbl };
}

/* ================= 13. TOOLS & MODS ================= */

function toolFor(skillId) {
  const id = state.tools && state.tools[skillId];
  return id ? TOOLS[id] : null;
}
function speedMod(skillId) {
  let m = currentWeather().mods[skillId] || 1;
  m *= (1 - mastery(skillId).speed);
  const tool = toolFor(skillId);
  if (tool) m *= (1 - tool.speed);
  if (state.pets && state.pets.golem && GATHER_SKILLS.some((s) => s.id === skillId)) m *= 0.9;
  return Math.max(0.35, m);
}
function actionTime(def) { return Math.max(1000, Math.round(def.time * speedMod(def.skillId))); }
function doubleChance(skillId) {
  let c = mastery(skillId).double;
  if (state.pets && state.pets.golem && GATHER_SKILLS.some((s) => s.id === skillId)) c += 0.1;
  return Math.min(0.75, c);
}
const RICH_FIND_CHANCE = 0.015;
function richFind(def) {
  if (!GATHER_ACTIONS[def.skillId] || def.tier >= TIERS.length) return null;
  const gs = GATHER_SKILLS.find((s) => s.id === def.skillId);
  return matId(TIERS[def.tier], gs.mat);
}

/* ================= 15. STATE ================= */

let state = freshState();
function freshState() {
  const skills = {}; SKILLS.forEach((s) => { skills[s.id] = 0; });
  const equipment = {}; EQUIP_SLOTS.forEach((s) => { equipment[s] = null; });
  return {
    schema: SCHEMA,
    meta: { createdAt: Date.now(), lastSeen: Date.now(), playtimeMs: 0, account: null, userId: null, name: "Commander" },
    player: { gold: 0, hp: 20, recoveryUntil: 0 },
    skills,
    inv:   { slots: PACK_SLOTS,   items: {}, order: [] },
    bank:  { slots: STORES_SLOTS, items: {}, order: [] },
    vault: { slots: BANK_SLOTS,   items: {}, order: [] },
    spoils: [], uid: 1, equipment, tools: {}, wear: {},
    tasks: { skilling: null, combat: null },
    region: "region_1", travel: { unlocked: ["region_1"] },
    pets: { golem: false, sprite: false, mule: false },
    threat: {}, bounty: null, buff: null, smugglerBought: {},
    yields: [], stats: { kills: 0, actions: 0, deaths: 0, crafted: 0, epics: 0, goldEarned: 0 },
    log: [],
  };
}

let route = { page: "character", arg: null };
let storeView = "inv", eqTab = "pack", campTab = "stores", gridFilter = "all", gridSort = "custom", selected = null;
let navOpen = { vanguard: true, camp: true, trades: true, workshops: true, field: true };

/* ================= 16. HELPERS ================= */

const el = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

function skillLevel(id) { return levelFromXp(state.skills[id] || 0); }
function totalLevel() { return SKILLS.reduce((n, s) => n + skillLevel(s.id), 0); }
function currentRegion() { return regionById(state.region); }
function recovering() { return state.player.recoveryUntil > Date.now(); }

function fmt(n) {
  n = Math.floor(n);
  if (Math.abs(n) < 10000) return n.toLocaleString();
  if (Math.abs(n) < 1e6) return (n / 1e3).toFixed(1) + "K";
  if (Math.abs(n) < 1e9) return (n / 1e6).toFixed(2) + "M";
  return (n / 1e9).toFixed(2) + "B";
}

function fmtTime(ms) {
  if (ms < 0) ms = 0; const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h${m % 60}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}
function say(msg) { state.log.push({ t: Date.now(), m: msg }); if (state.log.length > 60) state.log.shift(); }
function toast(msg) {
  const stack = el("toastStack"); if (!stack) return;
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  t.onclick = () => t.remove(); stack.appendChild(t); setTimeout(() => { if (t.parentNode) t.remove(); }, 7000);
}
function logYield(text) { state.yields.push({ t: Date.now(), m: text }); if (state.yields.length > 12) state.yields.shift(); }

function store(w) { return w === "vault" ? state.vault : w === "bank" ? state.bank : state.inv; }
function packSlots() { return PACK_SLOTS + (state.pets.mule ? 8 : 0); }
function slotCap(w) { return w === "vault" ? state.vault.slots : w === "bank" ? state.bank.slots : packSlots(); }
function qtyIn(w, k) { return store(w).items[k] || 0; }
function haveQty(k) { return qtyIn("inv", k) + qtyIn("bank", k) + qtyIn("vault", k); }
function slotsUsed(w) { return Object.keys(store(w).items).length; }
function storeFull(w) { return slotsUsed(w) >= slotCap(w); }

function addTo(w, key, qty) {
  const s = store(w);
  if (!s.items[key] && storeFull(w)) return false;
  s.items[key] = (s.items[key] || 0) + qty;
  if (!s.order.includes(key)) s.order.push(key);
  return true;
}
function removeFrom(w, key, qty) {
  const s = store(w); const left = (s.items[key] || 0) - qty;
  if (left > 0) s.items[key] = left;
  else { delete s.items[key]; s.order = s.order.filter((k) => k !== key); if (selected === key) selected = null; }
}
function deposit(key, qty) { return addTo("bank", key, qty) || addTo("vault", key, qty) || addTo("inv", key, qty); }
function spend(key, qty) {
  let left = qty;
  ["bank", "vault", "inv"].forEach((w) => {
    if (left <= 0) return; const take = Math.min(left, qtyIn(w, key));
    if (take) { removeFrom(w, key, take); left -= take; }
  });
}
function canAfford(cost) { return !cost || Object.keys(cost).every((k) => haveQty(k) >= cost[k]); }
function payCost(cost) { if (cost) Object.keys(cost).forEach((k) => spend(k, cost[k])); }
function orderedKeys(w) {
  const s = store(w), have = Object.keys(s.items), out = s.order.filter((k) => have.includes(k));
  have.forEach((k) => { if (!out.includes(k)) out.push(k); }); return out;
}

function equipStat(stat) {
  let total = 0;
  EQUIP_SLOTS.forEach((slot) => { const key = state.equipment[slot]; if (key && itemDef(key) && typeof itemDef(key)[stat] === "number") total += itemDef(key)[stat]; });
  return total;
}
function maxHp() { return 20 + skillLevel("warfare") * 5 + equipStat("health"); }
function attackPower() { return 4 + skillLevel("warfare") * 1.6 + equipStat("attack"); }
function defencePower() { return skillLevel("warfare") * 0.9 + equipStat("defence"); }
function wearPct(key) { const d = itemDef(key); if (!d || !d.maxDur) return null; return clamp(Math.round((1 - (state.wear[key] || 0) / d.maxDur) * 100), 0, 100); }
function addGold(n) { state.player.gold += n; state.stats.goldEarned += n; }

/* ================= 17. PROGRESSION ================= */

function xpMult() { let m = currentWeather().xp || 1; if (state.buff && state.buff.until > Date.now()) m *= state.buff.mult; return m; }
function grantXp(skillId, amount) {
  const gain = Math.max(1, Math.round(amount * xpMult())), before = skillLevel(skillId);
  state.skills[skillId] = (state.skills[skillId] || 0) + gain;
  const after = skillLevel(skillId);
  if (after > before) {
    say(`${skillName(skillId)} reaches level${after}.`);
    if (skillId === "warfare") state.player.hp = maxHp();
    const hit = MASTERY_TRACK.find((m) => m.level === after);
    if (hit) toast(`${skillName(skillId)} ${after} —${hit.label}`);
    else if (after % 10 === 0) toast(`${skillName(skillId)} — level${after}`);
  }
}

/* ================= 18. TICK ================= */

function tick(dt) {
  if (state.tasks.skilling) skillTick(dt);
  if (state.tasks.combat) combatTick(dt);
  if (state.buff && state.buff.until <= Date.now()) state.buff = null;
}

function skillTick(dt) {
  const task = state.tasks.skilling;
  const def = findAction(task.skillId, task.actionId);
  if (!def) { state.tasks.skilling = null; return; }

  const time = actionTime(def); task.progress += dt; let guard = 0;
  while (task.progress >= time && guard++ < 200000) {
    if (!canAfford(def.cost)) { say(`Work stopped — no materials left for ${def.name.toLowerCase()}.`); toast("Out of materials"); state.tasks.skilling = null; return; }
    if (storeFull("bank") && storeFull("inv")) { say("Work stopped — camp stores and pack are both full."); toast("Nowhere to put anything"); state.tasks.skilling = null; return; }

    task.progress -= time; payCost(def.cost); produce(def); grantXp(task.skillId, def.xp); task.done++; state.stats.actions++; bountyProgress("gather", def);

    if (task.queued) {
      const q = task.queued;
      if (q === "stop") { state.tasks.skilling = null; say("Work finished and stood down."); return; }
      state.tasks.skilling = newSkillTask(q.skillId, q.actionId);
      say(`Crews moved to ${findAction(q.skillId, q.actionId).name.toLowerCase()}.`);
      return;
    }
  }
}

function produce(def) {
  if (def.out) {
    Object.keys(def.out).forEach((k) => {
      let qty = def.out[k];
      if (GATHER_ACTIONS[def.skillId] && Math.random() < doubleChance(def.skillId)) qty *= 2;
      
      let deposited = false;
      const d = itemDef(k);
      if (d && d.kind === "tool") {
        deposited = addTo("bank", k, qty) || addTo("vault", k, qty) || addTo("inv", k, qty);
      } else {
        deposited = deposit(k, qty);
      }
      
      if (deposited) logYield(`+${qty}${itemName(k)}`);
      else say(`Nowhere to put ${itemName(k)}.`);
    });
    
    if (def.reagentId && Math.random() < def.reagentChance) {
      if (deposit(def.reagentId, 1)) logYield(`+1 ${itemName(def.reagentId)}`);
    }
    const rich = richFind(def);
    if (rich && Math.random() < RICH_FIND_CHANCE && deposit(rich, 1)) {
      logYield(`+1 ${itemName(rich)} (rich find)`); say(`A richer seam gave up ${itemName(rich)}.`);
    }
  }
  
  if (def.craftGear) {
    const rarity = rollRarity();
    const key = makeKey(def.craftGear, rarity);
    const d = itemDef(key);
    
    // Weapons/gear prefer inventory -> bank -> vault. Tools prefer bank.
    let deposited = false;
    if (d && d.kind === "gear") deposited = addTo("inv", key, 1) || addTo("bank", key, 1) || addTo("vault", key, 1);
    else if (d && d.kind === "tool") deposited = addTo("bank", key, 1) || addTo("vault", key, 1) || addTo("inv", key, 1);
    else deposited = deposit(key, 1);

    if (deposited) {
      state.stats.crafted++; logYield(`+1 ${itemName(key)}`); bountyProgress("craft", def);
      if (rarity !== "common") {
        say(`The ${GEAR[def.craftGear].name.toLowerCase()} comes out${rarityDef(rarity).name.toLowerCase()}.`);
        if (rarity === "epic") { state.stats.epics++; toast(`Epic: ${itemName(key)}`); }
        else if (rarity === "rare") toast(`Rare: ${itemName(key)}`);
      }
    } else say(`Nowhere to put the ${GEAR[def.craftGear].name.toLowerCase()}.`);
  }
}

function bestFood() {
  let pick = null, best = 0;
  ["inv", "bank", "vault"].forEach((w) => {
    Object.keys(store(w).items).forEach((k) => { const d = itemDef(k); if (d && d.heal && d.heal > best) { best = d.heal; pick = k; } });
  }); return pick;
}

function combatTick(dt) {
  const c = state.tasks.combat, mob = getMonster(c.monsterId);
  if (!mob) { state.tasks.combat = null; return; }

  if (c.respawn > 0) {
    c.respawn -= dt;
    if (c.respawn <= 0) {
      if (c.queued === "stop") { state.tasks.combat = null; say("Vanguard pulled back."); return; }
      if (c.queued) { state.tasks.combat = newCombatTask(c.queued); return; }
      const next = rollSpawn(c.tier); c.monsterId = next.id;
      c.mobHp = next.hp; c.mobMax = next.hp; c.mobTimer = next.speed; c.playerTimer = PLAYER_SWING_MS;
      if (next.rank === "boss") { say(`${next.name} comes up out of the dark.`); toast(`Sovereign: ${next.name}`); }
      else if (next.rank === "elite") say(`An elite takes the field.`);
    }
    return;
  }

  c.playerTimer -= dt;
  if (c.playerTimer <= 0) {
    c.playerTimer += PLAYER_SWING_MS; const atk = attackPower();
    let dmg = randInt(Math.max(1, Math.floor(atk * 0.55)), Math.ceil(atk));
    dmg = Math.max(1, Math.round(dmg - mob.defence * 0.35)); c.mobHp -= dmg;
    if (c.mobHp <= 0) { killMob(mob); return; }
  }

  c.mobTimer -= dt;
  if (c.mobTimer <= 0) {
    c.mobTimer += mob.speed;
    let dmg = randInt(Math.max(1, Math.floor(mob.attack * 0.55)), mob.attack);
    dmg = Math.max(1, Math.round(dmg - defencePower() * 0.4)); state.player.hp -= dmg;
    if (state.player.hp <= maxHp() * 0.45) {
      const food = bestFood();
      if (food) { spend(food, 1); state.player.hp = Math.min(maxHp(), state.player.hp + itemDef(food).heal); }
    }
    if (state.player.hp <= 0) die(mob);
  }
}

function die(mob) {
  state.player.hp = maxHp(); state.tasks.combat = null; state.stats.deaths++;
  state.player.recoveryUntil = Date.now() + RECOVERY_MS;
  EQUIP_SLOTS.forEach((slot) => { const key = state.equipment[slot]; if (key && itemDef(key).maxDur) damageItem(key, DEATH_WEAR); });
  say(`The ${mob.name.toLowerCase()} put you down. Recovering for five minutes.`); toast("You fell.");
}

const SPOILS_CAP = 40;
function addSpoil(key, qty) {
  const existing = stacks(key) ? state.spoils.find((s) => s.key === key) : null;
  if (existing) { existing.qty += qty; existing.t = Date.now(); }
  else { state.spoils.push({ key, qty, t: Date.now() }); if (state.spoils.length > SPOILS_CAP) state.spoils.shift(); }
  logYield(`+${qty}${itemName(key)} (spoils)`);
}
function claimSpoil(index) {
  const s = state.spoils[index]; if (!s) return;
  const target = state.pets.sprite ? "bank" : "inv";
  if (!addTo(target, s.key, s.qty) && !addTo("inv", s.key, s.qty) && !addTo("vault", s.key, s.qty)) { say("Nowhere to put it."); return; }
  state.spoils.splice(index, 1); render();
}
function claimAllSpoils() {
  let stuck = 0;
  for (let i = state.spoils.length - 1; i >= 0; i--) {
    const s = state.spoils[i], target = state.pets.sprite ? "bank" : "inv";
    if (addTo(target, s.key, s.qty) || addTo("inv", s.key, s.qty) || addTo("vault", s.key, s.qty)) state.spoils.splice(i, 1); else stuck++;
  }
  if (stuck) { say(`${stuck} lot${stuck > 1 ? "s" : ""} left on the field.`); toast("Not everything fit"); }
  render();
}
function sellSpoil(index) {
  const s = state.spoils[index]; if (!s) return;
  addGold(itemDef(s.key).value * s.qty); state.spoils.splice(index, 1); render();
}

function killMob(mob) {
  const c = state.tasks.combat;
  grantXp("warfare", mob.xp); addGold(randInt(mob.gold[0], mob.gold[1])); state.stats.kills++; c.done++; bountyProgress("slay", mob);
  mob.drops.forEach(([k, qty, chance]) => { if (Math.random() < chance) addSpoil(k, qty); });
  if (mob.rank === "boss") {
    state.threat[mob.tier] = 0; state.stats.bosses = (state.stats.bosses || 0) + 1;
    const pool = Object.values(GEAR).filter((g) => g.tier === mob.tier);
    const key = makeKey(pool[randInt(0, pool.length - 1)].id, "epic");
    addSpoil(key, 1); state.stats.epics++;
    say(`${mob.name} is down.`); toast(`Sovereign felled · ${itemName(key)}`);
  } else {
    state.threat[mob.tier] = Math.min(THREAT_CAP, threatIn(mob.tier) + 1);
    if (threatIn(mob.tier) === THREAT_CAP) { say("Something bigger has noticed you."); toast("Threat at boiling point"); }
  }
  applyWear(); c.respawn = RESPAWN_MS;
}

function applyWear() {
  const w = state.equipment.weapon; if (w && itemDef(w).maxDur) damageItem(w, 1);
  const armour = EQUIP_SLOTS.filter((s) => !["weapon", "ring", "neck"].includes(s)).map((s) => state.equipment[s]).filter((k) => k && itemDef(k).maxDur);
  if (armour.length) damageItem(armour[randInt(0, armour.length - 1)], 1);
}
function damageItem(key, amount) {
  const d = itemDef(key); state.wear[key] = (state.wear[key] || 0) + amount;
  if (state.wear[key] >= d.maxDur) { state.equipment[d.slot] = null; state.wear[key] = 0; say(`${itemName(key)} broke.`); toast(`${itemName(key)} broke`); }
}
function repairCost(key) {
  const d = itemDef(key), dmg = state.wear[key] || 0;
  if (!d.maxDur || dmg <= 0) return null;
  return { mat: d.repairMat, qty: Math.max(1, Math.ceil(dmg / 80)) };
}
function repairItem(key) {
  const cost = repairCost(key); if (!cost) return;
  if (haveQty(cost.mat) < cost.qty) { say(`Need ${cost.qty}${itemName(cost.mat)}.`); render(); return; }
  spend(cost.mat, cost.qty); state.wear[key] = 0; say(`Patched up ${itemName(key)}.`); render();
}
function salvageValue(key) {
  const d = itemDef(key);
  if (d.kind !== "gear" && d.kind !== "tool") return null;
  const matchProf = PROFESSIONS.find((p) => p.id === d.prof) || PROFESSIONS.find((p) => d.name.includes(p.name));
  if(!matchProf) return null;
  const ref = CRAFT_ACTIONS[d.prof]?.find(a => a.craftGear === d.base || (a.out && a.out[d.base]));
  if(!ref || !ref.cost) return null;
  const mainKey = Object.keys(ref.cost)[0]; 
  return { mat: mainKey, qty: Math.max(1, Math.floor(ref.cost[mainKey] * 0.4)) };
}
function salvage(key) {
  const out = salvageValue(key); if (!out) return;
  removeFrom(storeView, key, 1); deposit(out.mat, out.qty);
  say(`Broke down ${itemName(key)} for ${out.qty}${itemName(out.mat)}.`);
  if (el('itemModal')) el('itemModal').hidden = true;
  render();
}

/* ================= 19. TASKS ================= */

function newSkillTask(skillId, actionId) { return { skillId, actionId, progress: 0, done: 0, startedAt: Date.now(), queued: null }; }
function newCombatTask(tier) {
  const mob = rollSpawn(tier);
  return { tier, monsterId: mob.id, mobHp: mob.hp, mobMax: mob.hp, playerTimer: PLAYER_SWING_MS, mobTimer: mob.speed, respawn: 0, done: 0, startedAt: Date.now(), queued: null };
}

function selectSkillAction(skillId, actionId) {
  const def = findAction(skillId, actionId);
  if (!def || skillLevel(skillId) < def.level) return;
  const t = state.tasks.skilling;
  if (!t) { 
    state.tasks.skilling = newSkillTask(skillId, actionId); 
    render(); 
    return; 
  }
  
  if (t.skillId === skillId && t.actionId === actionId) {
    t.queued = t.queued === "stop" ? null : "stop";
  } else {
    // INSTANT switch
    state.tasks.skilling = newSkillTask(skillId, actionId);
    say(`Crews instantly moved to ${def.name.toLowerCase()}.`);
  }
  render();
}

function engageRegion(tier) {
  if (recovering()) { say("You're still recovering."); render(); return; }
  const t = state.tasks.combat;
  if (!t) { 
    state.tasks.combat = newCombatTask(tier); state.player.hp = maxHp(); render(); return; 
  }
  
  if (t.tier === tier) {
    t.queued = t.queued === "stop" ? null : "stop";
  } else {
    // INSTANT switch
    state.tasks.combat = newCombatTask(tier);
    state.player.hp = maxHp();
    say(`Moved to new ground in ${regionById(`region_${tier}`).name}.`);
  }
  render();
}

function skillPlan() {
  const t = state.tasks.skilling; if (!t) return null;
  const def = findAction(t.skillId, t.actionId); if (!def) return null;
  const time = actionTime(def), windowLeft = Math.max(0, IDLE_CAP_MS - (Date.now() - t.startedAt));
  let remaining = Math.floor(windowLeft / time), capped = null;
  if (def.cost) {
    let byMats = Infinity; Object.keys(def.cost).forEach((k) => { byMats = Math.min(byMats, Math.floor(haveQty(k) / def.cost[k])); });
    if (byMats < remaining) { remaining = byMats; capped = true; }
  }
  return { def, time, done: t.done, target: t.done + remaining, timeLeft: remaining * time - t.progress, capped, pct: clamp((t.progress / time) * 100, 0, 100) };
}

function combatPlan() {
  const t = state.tasks.combat; if (!t) return null;
  const mob = getMonster(t.monsterId); if (!mob) return null;
  const atk = attackPower(), avgHit = Math.max(1, (atk * 0.55 + atk) / 2 - mob.defence * 0.35);
  const killMs = (mob.hp / avgHit) * PLAYER_SWING_MS + RESPAWN_MS;
  const windowLeft = Math.max(0, IDLE_CAP_MS - (Date.now() - t.startedAt)), remaining = Math.floor(windowLeft / killMs);
  const incoming = Math.max(1, (mob.attack * 0.55 + mob.attack) / 2 - defencePower() * 0.4);
  const food = bestFood(), foodNeed = food ? Math.ceil((incoming / mob.speed * windowLeft) / itemDef(food).heal) : null;
  return { mob, done: t.done, target: t.done + remaining, timeLeft: remaining * killMs, killMs, pct: t.respawn > 0 ? 0 : clamp((t.mobHp / t.mobMax) * 100, 0, 100), food, foodNeed, foodHave: food ? haveQty(food) : 0 };
}

/* ================= 20. BOUNTY ================= */

function currentWindow() { return Math.floor(Date.now() / WINDOW_MS); }
function windowEndsIn() { return WINDOW_MS - (Date.now() % WINDOW_MS); }

function makeBounty() {
  const w = currentWindow(), region = currentRegion(), t = TIERS[region.tier - 1], roll = seedFrom(w * 3.31 + region.tier);
  if (roll < 0.45) {
    const mob = monsterOfTier(region.tier), amount = 10 + Math.floor(seedFrom(w * 5.5) * 15);
    return { window: w, region: region.id, kind: "slay", targetTier: region.tier, label: `Put down ${amount} of whatever holds${region.name}`, amount, progress: 0, claimed: false, gold: Math.round(mob.gold[1] * amount * 0.8) };
  }
  const skill = GATHER_SKILLS[Math.floor(seedFrom(w * 9.13 + region.tier) * GATHER_SKILLS.length)];
  const amount = 20 + Math.floor(seedFrom(w * 2.7) * 30);
  return { window: w, region: region.id, kind: "gather", targetId: matId(t, skill.mat), label: `Bring in ${amount}${titleCase(t[skill.mat])}`, amount, progress: 0, claimed: false, gold: Math.round(MATERIALS[matId(t, skill.mat)].value * amount * 1.5) };
}

function refreshBounty() { const w = currentWindow(); if (!state.bounty || state.bounty.window !== w || state.bounty.region !== state.region) state.bounty = makeBounty(); }
function bountyProgress(kind, thing) {
  const b = state.bounty; if (!b || b.claimed || b.kind !== kind) return;
  if (kind === "slay" && thing.tier === b.targetTier) b.progress++;
  if (kind === "gather" && thing.out && thing.out[b.targetId]) b.progress += thing.out[b.targetId];
  if (b.progress >= b.amount && !b.claimed) toast("Bounty complete");
}
function claimBounty() {
  const b = state.bounty; if (!b || b.claimed || b.progress < b.amount) return;
  b.claimed = true; addGold(b.gold); state.buff = { until: Date.now() + 60 * 60 * 1000, mult: 2 };
  say(`Bounty paid: ${fmt(b.gold)} gold.`); toast("Double experience for one hour"); render();
}

/* ================= 21. SHOP / PETS / TRAVEL ================= */

function shopStock() { return RATIONS.map((r) => ({ key: r.id, price: Math.round(r.value * 1.6) })); }
function smugglerStock() {
  const w = currentWindow(), picks = [], pool = Object.keys(MATERIALS).filter((k) => MATERIALS[k].tier && !MATERIALS[k].heal && k !== "vault_chest");
  for (let i = 0; i < 3; i++) {
    const key = pool[Math.floor(seedFrom(w * (i + 2) * 1.77) * pool.length)], qty = 5 + Math.floor(seedFrom(w * (i + 3) * 4.2) * 20);
    picks.push({ key, qty, price: Math.round(MATERIALS[key].value * qty * 2.4), slot: i });
  } return picks;
}

function buyShop(key, price, qty) {
  if (state.player.gold < price) { say("Not enough gold."); render(); return; }
  if (!addTo("inv", key, qty) && !addTo("bank", key, qty)) { say("Nowhere to put it."); render(); return; }
  state.player.gold -= price; say(`Bought ${qty}${itemName(key).toLowerCase()}.`); render();
}
function buySmuggler(entry) {
  const tag = `${currentWindow()}_${entry.slot}`; if (state.smugglerBought[tag]) return;
  if (state.player.gold < entry.price) { say("The smuggler doesn't haggle."); render(); return; }
  if (!deposit(entry.key, entry.qty)) { say("Nowhere to put it."); render(); return; }
  state.player.gold -= entry.price; state.smugglerBought[tag] = true; say(`Bought ${entry.qty}${itemName(entry.key)}.`); render();
}

const PETS = [
  { id: "golem",  name: "Stone Golem",    icon: "golemMob", cost: 4000, note: "Works the seam.", effect: "Gathering 10% faster, +10% double yield." },
  { id: "sprite", name: "Looting Sprite", icon: "horror", cost: 7500, note: "Flits around.", effect: "Field loot overflowing pack goes to stores." },
  { id: "mule",   name: "Pack Mule",      icon: "beast", cost: 2500, note: "Carries stuff.", effect: "Eight more slots in your pack." },
];
function buyPet(id) {
  const pet = PETS.find((p) => p.id === id); if (!pet || state.pets[id]) return;
  if (state.player.gold < pet.cost) { say("Not enough gold."); render(); return; }
  state.player.gold -= pet.cost; state.pets[id] = true; say(`${pet.name} joins.`); toast(`${pet.name} acquired`); render();
}

function travelTo(regionId) {
  const r = regionById(regionId);
  if (!state.travel.unlocked.includes(regionId)) {
    if (state.player.gold < r.toll) { say(`Need ${fmt(r.toll)} gold.`); render(); return; }
    state.player.gold -= r.toll; state.travel.unlocked.push(regionId); say(`Road to ${r.name} open.`); toast(`${r.name} unlocked`);
  }
  state.region = regionId; refreshBounty(); say(`Moved to ${r.name}.`); render();
}

/* ================= 23. EQUIPMENT ================= */

function equip(key) {
  const d = itemDef(key);
  if (d && d.kind === "tool") {
    const old = state.tools[d.forSkill]; if (old) deposit(old, 1);
    removeFrom(storeView, key, 1); state.tools[d.forSkill] = d.base;
    say(`${itemName(key)} taken up.`);
    if (el('itemModal')) el('itemModal').hidden = true;
    render(); return;
  }
  if (!d || !d.slot) return;
  if (d.slot === "weapon" && d.twoHanded && state.equipment.offhand) {
    if (!deposit(state.equipment.offhand, 1)) { say("Nowhere to stow offhand."); return; }
    state.equipment.offhand = null;
  }
  if (d.slot === "offhand") {
    const w = state.equipment.weapon;
    if (w && itemDef(w).twoHanded) { say(`Hands are on the ${itemName(w)}.`); return; }
  }
  const old = state.equipment[d.slot];
  if (old && !deposit(old, 1)) { say("Nowhere to stow current gear."); return; }
  removeFrom(storeView, key, 1); state.equipment[d.slot] = key;
  if (el('itemModal')) el('itemModal').hidden = true;
  render();
}
function unequip(slot) {
  const key = state.equipment[slot]; if (!key) return;
  if (!deposit(key, 1)) { say("Nowhere to put it."); return; }
  state.equipment[slot] = null; render();
}
function unequipTool(skillId) {
  const id = state.tools[skillId]; if (!id) return;
  if (!deposit(id, 1)) { say("Nowhere to put it."); return; }
  delete state.tools[skillId]; render();
}
function sell(key, all) {
  const qty = all ? qtyIn(storeView, key) : 1; if (qty <= 0) return;
  addGold(itemDef(key).value * qty); removeFrom(storeView, key, qty);
  if (qtyIn(storeView, key) <= 0 && el('itemModal')) el('itemModal').hidden = true;
  render();
}
function useChest(key) {
  if (parseKey(key).base !== "vault_chest") return;
  if (state.bank.slots >= BANK_MAX) { say("Stores are full depth."); return; }
  removeFrom(storeView, key, 1); state.bank.slots = Math.min(BANK_MAX, state.bank.slots + MATERIALS.vault_chest.chest);
  say(`Stores widened to ${state.bank.slots} slots.`);
  if (el('itemModal')) el('itemModal').hidden = true;
  render();
}

function moveTo(key, target, all) {
  const from = storeView, qty = all ? qtyIn(from, key) : 1; if (qty <= 0) return;
  if (!store(target).items[key] && storeFull(target)) { say("Target full."); return; }
  removeFrom(from, key, qty); addTo(target, key, qty);
  if (qtyIn(from, key) <= 0 && el('itemModal')) el('itemModal').hidden = true;
  else if (el('itemModal')) showItemPopup(key, storeView); // Refresh popup
  render();
}

/* ================= 24. SAVE ================= */
const sb = (window.supabase && window.RESPITE_SUPABASE_URL && window.RESPITE_SUPABASE_ANON_KEY && window.RESPITE_SUPABASE_ANON_KEY !== "PASTE_YOUR_ANON_KEY_HERE") ? window.supabase.createClient(window.RESPITE_SUPABASE_URL, window.RESPITE_SUPABASE_ANON_KEY) : null;
function emailFor(user) { return `${user}@players.respite`; }
function validUsername(u) { return /^[a-z0-9_]{3,20}$/.test(u || ""); }
let saveInFlight = false, saveQueued = false, saveTimer = null;
async function save() {
  state.meta.lastSeen = Date.now();
  if (!sb) return false;
  if (saveInFlight) { saveQueued = true; return true; }
  saveInFlight = true;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return false;
    state.meta.userId = session.user.id;
    await sb.from("saves").update({ data: state, updated_at: new Date().toISOString() }).eq("user_id", session.user.id);
    return true;
  } finally { saveInFlight = false; if (saveQueued) { saveQueued = false; save(); } }
}
function scheduleSave() { if (!sb || !state.meta.userId) return; clearTimeout(saveTimer); saveTimer = setTimeout(save, 700); }
async function createAccount(user, pass) {
  user = (user || "").trim().toLowerCase();
  if (!validUsername(user)) return "Invalid username.";
  if ((pass || "").length < 4) return "Password too short.";
  if (!sb) return "Cloud not configured.";
  const { data, error } = await sb.auth.signUp({ email: emailFor(user), password: pass });
  if (error) return error.message;
  if (!data.session) return "Verify email.";
  const userId = data.session.user.id;
  const { error: insErr } = await sb.from("saves").insert({ user_id: userId, username: user, data: state });
  if (insErr) return insErr.message;
  state.meta.account = user; state.meta.userId = userId; await save(); return null;
}
async function loginAccount(user, pass) {
  user = (user || "").trim().toLowerCase(); if (!sb) return "Cloud not configured.";
  const { data, error } = await sb.auth.signInWithPassword({ email: emailFor(user), password: pass });
  if (error) return "Wrong credentials.";
  const userId = data.session.user.id;
  const { data: row, error: selErr } = await sb.from("saves").select("data, updated_at").eq("user_id", userId).single();
  if (selErr) return "Couldn't load save.";
  applyLoadedRow(row, user, userId); return null;
}
async function logoutAccount() { await save(); if (sb) await sb.auth.signOut(); state = freshState(); render(); }
async function resetCharacter() {
  const acct = state.meta.account, userId = state.meta.userId;
  state = freshState(); state.meta.account = acct; state.meta.userId = userId; await save(); refreshBounty(); render();
}
function migrate(loaded) {
  const base = freshState(); if (!loaded || typeof loaded !== "object") return base;
  const m = Object.assign(base, loaded); m.schema = SCHEMA;
  ["meta", "player", "skills", "equipment", "tasks", "travel", "pets", "stats"].forEach((k) => m[k] = Object.assign(base[k], loaded[k] || {}));
  m.inv = Object.assign(base.inv, loaded.inv || {}); m.bank = Object.assign(base.bank, loaded.bank || {});
  m.inv.items = Object.assign({}, loaded.inv?.items || {}); m.bank.items = Object.assign({}, loaded.bank?.items || {});
  m.inv.order = (loaded.inv?.order || []).slice(); m.bank.order = (loaded.bank?.order || []).slice();
  m.wear = Object.assign({}, loaded.wear || {}); m.tools = Object.assign({}, loaded.tools || {});
  m.yields = (loaded.yields || []).slice(-12);
  m.log = (loaded.log || []).slice(-60).map((e) => (typeof e === "string" ? { t: Date.now(), m: e } : e));
  return m;
}
function applyLoadedRow(row, username, userId) {
  const last = (row.data && row.data.meta && row.data.meta.lastSeen) || Date.parse(row.updated_at) || Date.now();
  state = migrate(row.data); state.meta.account = username; state.meta.userId = userId;
  const gone = Date.now() - last;
  if (gone > 30000) catchUp({ ms: Math.min(gone, IDLE_CAP_MS), overCap: gone > IDLE_CAP_MS });
  refreshBounty(); render();
}
function bootLoad() { return null; }
async function resumeCloudSession() {
  if (!sb) return; const { data: { session } } = await sb.auth.getSession(); if (!session) return;
  const userId = session.user.id;
  const { data: row } = await sb.from("saves").select("data, username, updated_at").eq("user_id", userId).single();
  if (row) applyLoadedRow(row, row.username, userId);
}
function catchUp(result) {
  const step = 1000; let left = result.ms, guard = 0; const goldBefore = state.player.gold;
  const before = {}; Object.keys(state.inv.items).forEach((k) => { before[k] = state.inv.items[k]; });
  while (left > 0 && (state.tasks.skilling || state.tasks.combat) && guard++ < 100000) { tick(Math.min(step, left)); left -= step; }
  state.meta.playtimeMs += result.ms;
  const gains = []; Object.keys(state.inv.items).forEach((k) => { const d = state.inv.items[k] - (before[k] || 0); if (d > 0) gains.push(`${fmt(d)}${itemName(k)}`); });
  if (state.player.gold - goldBefore > 0) gains.push(`${fmt(state.player.gold - goldBefore)} gold`);
  if (result.overCap && (state.tasks.skilling || state.tasks.combat)) { state.tasks.skilling = null; state.tasks.combat = null; say("12 hours passed."); }
  if (gains.length) say(`Away ${fmtTime(result.ms)}:${gains.slice(0, 4).join(", ")}.`);
}

/* ================= 25. ROUTING ================= */

const PAGES = ["character", "equipment", "camp", "kennel", "atlas", "shop", "bounty", "skill"];
function parseHash() {
  const raw = (location.hash || "").replace(/^#\/?/, ""), [page, arg] = raw.split("/");
  if (!PAGES.includes(page)) return { page: "character", arg: null };
  if (page === "skill" && !skillDef(arg)) return { page: "skill", arg: "delving" };
  return { page, arg: arg || null };
}
function go(page, arg) {
  const hash = "#/" + page + (arg ? "/" + arg : "");
  if (location.hash === hash) { route = parseHash(); render(); } else location.hash = hash;
}
window.addEventListener("hashchange", () => { route = parseHash(); selected = null; render(); });

/* ================= 26. RENDER ================= */

let keys = {}; let liveRefs = { node: null, monster: null };
function render() { keys = {}; liveRefs = { node: null, monster: null }; renderAll(); scheduleSave(); }

function renderAll() {
  renderTopbar(); renderSidebar(); renderPage(); renderLog();
}

function renderTopbar() {
  el("goldText").textContent = fmt(state.player.gold); el("clockText").textContent = serverClock();
  const hp = Math.max(0, Math.ceil(state.player.hp));
  el("hpFill").style.width = clamp((hp / maxHp()) * 100, 0, 100) + "%"; el("hpText").textContent = `${hp}/${maxHp()}`;
  const sp = skillPlan(), sBar = el("tbTradesBar");
  if (sp) {
    el("tbTradesName").textContent = titleCase(sp.def.name);
    sBar.classList.toggle("nojump", sp.pct < 6); sBar.style.width = sp.pct + "%";
    let line = `${fmt(sp.done)} / ${fmt(sp.target)} acts · ${fmtTime(sp.timeLeft)}`;
    if (sp.capped) line += " (stock)";
    if (state.tasks.skilling.queued) line += state.tasks.skilling.queued === "stop" ? " · stopping" : " · switching";
    el("tbTradesMeta").textContent = line;
    el("tbTradesClear").classList.toggle("queued", !!state.tasks.skilling.queued);
  } else { el("tbTradesName").textContent = "Idle"; sBar.style.width = "0"; el("tbTradesMeta").textContent = "No crews tasked."; el("tbTradesClear").classList.remove("queued"); }

  const cp = combatPlan(), cBar = el("tbFieldBar");
  if (cp) {
    el("tbFieldName").textContent = cp.mob.name; cBar.style.width = cp.pct + "%";
    let line = `${fmt(cp.done)} / ${fmt(cp.target)} kills · ${fmtTime(cp.timeLeft)}`;
    line += cp.food ? ` · food ${fmt(cp.foodHave)}/${fmt(cp.foodNeed)}` : " · no food";
    if (state.tasks.combat.queued) line += " · changing";
    el("tbFieldMeta").textContent = line; el("tbFieldClear").classList.toggle("queued", !!state.tasks.combat.queued);
  } else { el("tbFieldName").textContent = recovering() ? "Recovering" : "Idle"; cBar.style.width = "0"; el("tbFieldMeta").textContent = recovering() ? `Back in ${fmtTime(state.player.recoveryUntil - Date.now())}.` : "Take the field."; el("tbFieldClear").classList.remove("queued"); }
}

function toggleNav(group) { navOpen[group] = !navOpen[group]; keys.side = ""; renderSidebar(); }
function renderSidebar() {
  const sig = SKILLS.map((s) => s.id + skillLevel(s.id)).join(",") + "|" + route.page + route.arg + "|" + eqTab + campTab + "|" + JSON.stringify(navOpen) + "|" + currentWeather().id + "|" + slotsUsed("inv") + "/" + slotsUsed("bank") + "|" + (state.tasks.skilling ? state.tasks.skilling.skillId : "-") + "|" + state.spoils.length;
  if (keys.side === sig) return; keys.side = sig;
  Object.keys(navOpen).forEach((g) => { const box = el("pill-" + g); if (box) box.classList.toggle("open", navOpen[g]); });
  const mkItem = ({ label, page, arg, right, active, locked, tag, onclick }) => {
    const b = document.createElement("button"); b.className = "nav-item" + (active ? " active" : "") + (locked ? " locked" : "");
    b.innerHTML = '<span class="nav-name"></span><span class="lvl"></span>';
    b.children[0].textContent = label; b.children[1].textContent = right || "";
    if (tag) { b.children[1].className = "soon"; b.children[1].textContent = tag; }
    if (!locked) b.onclick = onclick || (() => go(page, arg)); return b;
  };

  const van = el("navVanguard"); van.innerHTML = "";
  van.appendChild(mkItem({ label: "Character", page: "character", active: route.page === "character" }));
  van.appendChild(mkItem({ label: "Equipment & Pack", page: "equipment", right: `${slotsUsed("inv")}/${packSlots()}`, active: route.page === "equipment" }));

  const camp = el("navCamp"); camp.innerHTML = "";
  camp.appendChild(mkItem({ label: "Camp Stores", page: "camp", right: `${slotsUsed("bank")}/${slotCap("bank")}`, active: route.page === "camp" }));
  camp.appendChild(mkItem({ label: "The Kennel", page: "kennel", active: route.page === "kennel" }));
  const b = state.bounty; camp.appendChild(mkItem({ label: "The Board", page: "bounty", active: route.page === "bounty", right: b ? `${fmt(Math.min(b.progress, b.amount))}/${fmt(b.amount)}` : "" }));

  const mkSkills = (box, kind) => {
    box.innerHTML = "";
    SKILLS.filter((s) => s.kind === kind).forEach((s) => {
      const item = mkItem({ label: s.name, page: "skill", arg: s.id, right: "Lv." + skillLevel(s.id), active: route.page === "skill" && route.arg === s.id });
      if (kind !== "war" && state.tasks.skilling && state.tasks.skilling.skillId === s.id) item.classList.add("busy");
      if (kind === "war" && state.tasks.combat) item.classList.add("busy");
      box.appendChild(item);
    });
  };
  mkSkills(el("navTrades"), "gather"); mkSkills(el("navWorkshops"), "craft"); mkSkills(el("navField"), "war");
  el("navField").appendChild(mkItem({ label: "Dungeons", locked: true, tag: "Soon" }));

  const spoilTag = el("spoilsTag"); if (spoilTag) { spoilTag.textContent = state.spoils.length ? `${state.spoils.length} unclaimed` : ""; spoilTag.hidden = !state.spoils.length; }
  const w = currentWeather(), tm = weatherOn(1);
  el("weatherTag").textContent = w.name; el("weatherNote").textContent = w.note; el("weatherXp").textContent = w.xp > 1 ? `+${Math.round((w.xp - 1) * 100)}% experience` : ""; el("weatherNext").textContent = `Tomorrow: ${tm.name}`;
}

function renderPage() {
  document.querySelectorAll(".page").forEach((p) => { p.hidden = p.dataset.page !== route.page; });
  document.querySelectorAll(".icon-btn").forEach((b) => b.classList.toggle("active", b.dataset.page === route.page));
  el("crumbs").innerHTML = crumbText();
  if (route.page === "character") renderCharacter();
  if (route.page === "skill") renderSkill();
  if (route.page === "equipment") renderStorePage("eq");
  if (route.page === "camp") renderStorePage("camp");
  if (route.page === "kennel") renderKennel();
  if (route.page === "atlas") renderAtlas();
  if (route.page === "shop") renderShop();
  if (route.page === "bounty") renderBounty();
}

function crumbText() {
  const r = currentRegion();
  if (route.page === "skill") {
    const s = skillDef(route.arg), group = s.kind === "gather" ? "Gathering" : s.kind === "craft" ? "Crafting" : "The Field";
    return `Respite &nbsp;/&nbsp; ${group} &nbsp;/&nbsp; <b>${s.name}</b>`;
  }
  return `Respite &nbsp;/&nbsp; ${r.name} &nbsp;/&nbsp; <b>${titleCase(route.page)}</b>`;
}

function renderSkill() {
  const s = skillDef(route.arg) || skillDef("delving"), region = currentRegion(), lvl = skillLevel(s.id), xp = state.skills[s.id] || 0;
  const base = XP_TABLE[lvl], next = XP_TABLE[Math.min(lvl + 1, MAX_LEVEL)], pct = lvl >= MAX_LEVEL ? 100 : ((xp - base) / (next - base)) * 100;
  el("skHeroTag").textContent = s.kind === "gather" ? `In ${region.name}` : s.kind === "war" ? "The Field" : "At Camp";
  el("skHeroName").textContent = s.name; el("skHeroIcon").innerHTML = icon(s.icon, "ico-xl");
  el("skHeroLvl").textContent = "Lv " + lvl; el("skHeroXp").textContent = lvl >= MAX_LEVEL ? "Mastered" : `${fmt(xp)} /${fmt(next)} XP`;
  el("skHeroBar").style.width = clamp(pct, 0, 100) + "%"; el("skHeroNote").textContent = s.note || "You take the vanguard."; el("skHeroNext").textContent = lvl >= MAX_LEVEL ? "" : `${fmt(next - xp)} to next level`;

  const t = state.tasks.skilling, c = state.tasks.combat;
  const sig = `${s.id}|${lvl}\vert{}${region.id}|${t ? t.skillId + t.actionId + (t.queued ? "q" : "") : "-"}\vert{}${c ? c.monsterId + (c.queued ? "q" : "") : "-"}|${state.tools[s.id] \vert{}\vert{} "-"}\vert{}${recovering()}`;
  if (keys.skill === sig) { updateLive(); return; }
  keys.skill = sig; liveRefs = { node: null, monster: null };

  if (s.kind === "war") renderFieldBody(region);
  else if (s.kind === "gather") renderGatherBody(s, region);
  else renderCraftBody(s);

  if (s.kind !== "war") { const sp = el("skSpoils"); if (sp) sp.hidden = true; }
  renderMastery(s.id); renderMilestones(s.id, lvl); renderYieldFeed(); updateLive();
}

function renderGatherBody(s, region) {
  // Try to find the action for this tier (or the first available if not exact)
  const defs = GATHER_ACTIONS[s.id].filter(a => a.tier === region.tier);
  const def = defs[0];
  const lvl = skillLevel(s.id), locked = def ? lvl < def.level : true;
  const t = state.tasks.skilling;
  
  el("skWorkLabel").textContent = `Working · ${region.name}`;
  const box = el("skWorkBody"); box.innerHTML = "";
  
  if(!def) {
    box.innerHTML = `<div class="muted">No ground here for ${s.name}.</div>`;
    return;
  }

  defs.forEach(actionDef => {
    const active = !!(t && t.skillId === s.id && t.actionId === actionDef.id);
    const card = document.createElement("div"); card.className = "node-card";
    card.innerHTML = `<div class="node-icon">${icon(actionDef.icon, "ico-lg")}</div>`;
    const info = document.createElement("div"); info.className = "node-info";
    const h = document.createElement("h3"); h.textContent = titleCase(actionDef.name); info.appendChild(h);
    
    const chips = document.createElement("div"); chips.className = "stat-chips";
    const time = actionTime(actionDef), w = currentWeather(), mod = w.mods[s.id];
    chips.innerHTML = `<div class="chip">${(time / 1000).toFixed(1)}s / action</div><div class="chip">${fmt(actionDef.xp)} XP base</div>` +
      `<div class="chip${mod && mod > 1 ? " warn" : ""}">${w.name}:${mod ? (mod > 1 ? "slowed" : "quickened") : "unaffected"}</div>` +
      (doubleChance(s.id) > 0 ? `<div class="chip good">${Math.round(doubleChance(s.id) * 100)}% double yield</div>` : "");
    info.appendChild(chips);

    const prog = document.createElement("div"); prog.className = "node-progress";
    prog.innerHTML = '<div class="bar"><i></i></div><div class="meta"><span></span><b></b></div>';
    info.appendChild(prog);

    const btn = document.createElement("button"); btn.className = "btn btn-primary node-btn";
    btn.textContent = active ? (t.queued === "stop" ? "Stopping..." : "Stop working") : "Put crews to work";
    btn.disabled = locked; btn.onclick = () => selectSkillAction(s.id, actionDef.id);
    info.appendChild(btn);

    card.appendChild(info); box.appendChild(card);
    if(active) {
      liveRefs.node = { def: actionDef, skillId: s.id, bar: prog.querySelector("i"), left: prog.querySelector("span"), right: prog.querySelector("b") };
    }
  });

  renderToolPanel(s.id); renderYieldTable(def, s.id); renderOtherSeams(s.id);
}

let craftTierTab = 1, craftTierTabSkill = null;
function renderCraftBody(s) {
  const lvl = skillLevel(s.id); el("skWorkLabel").textContent = "The Bench";
  const box = el("skWorkBody"); box.innerHTML = "";
  const availableTiers = [...new Set(actionsFor(s.id).map(a => a.tier))].sort();
  if (craftTierTabSkill !== s.id) { craftTierTabSkill = s.id; craftTierTab = availableTiers.reduce((best, i) => (TIERS[i - 1].level <= lvl ? i : best), availableTiers[0]); }
  
  const tabs = document.createElement("div"); tabs.className = "tabs craft-tier-tabs";
  availableTiers.forEach((i) => {
    const tier = TIERS[i - 1], b = document.createElement("button");
    b.className = "tab-btn" + (craftTierTab === i ? " active" : "") + (lvl < tier.level ? " locked" : "");
    b.textContent = "Lv." + tier.level; b.title = stratumOf(i).name;
    b.onclick = () => { craftTierTab = i; keys.skill = ""; renderSkill(); };
    tabs.appendChild(b);
  }); box.appendChild(tabs);

  const list = document.createElement("div"); list.className = "recipe-list";
  const t = state.tasks.skilling;
  actionsFor(s.id).filter((a) => a.tier === craftTierTab).forEach((def) => {
    const locked = lvl < def.level, active = !!(t && t.skillId === s.id && t.actionId === def.id);
    const row = document.createElement("button"); row.className = "recipe" + (locked ? " locked" : "") + (active ? " active" : "");
    row.disabled = locked;
    const costTxt = Object.keys(def.cost || {}).map((k) => `${def.cost[k]}× ${itemName(k)} (${fmt(haveQty(k))})`).join(", ");
    const short = Object.keys(def.cost || {}).some((k) => haveQty(k) < def.cost[k]);
    row.innerHTML = `<span class="r-ico">${icon(def.icon, "ico-sm")}</span><span class="r-name"></span><span class="r-cost${short ? " short" : ""}"></span><span class="r-meta"></span>`;
    row.children[1].textContent = titleCase(def.name); row.children[2].textContent = locked ? `Needs Lv ${def.level}` : costTxt;
    row.children[3].textContent = `${(actionTime(def) / 1000).toFixed(0)}s · ${fmt(def.xp)} XP`;
    row.onclick = () => selectSkillAction(s.id, def.id); list.appendChild(row);
  }); box.appendChild(list);

  const activeDef = t && t.skillId === s.id ? findAction(t.skillId, t.actionId) : null;
  if (activeDef) {
    const prog = document.createElement("div"); prog.className = "node-progress craft-progress";
    prog.innerHTML = '<div class="bar"><i></i></div><div class="meta"><span></span><b></b></div>'; box.appendChild(prog);
    liveRefs.node = { def: activeDef, skillId: s.id, bar: prog.querySelector("i"), left: prog.querySelector("span"), right: prog.querySelector("b") };
  }
  el("skRailA").hidden = true; el("skYield").hidden = true; el("skSeams").hidden = true;
}

function renderFieldBody(region) {
  const tier = region.tier, t = state.tasks.combat, engaged = !!(t && t.tier === tier), live = engaged ? getMonster(t.monsterId) : rankOf(tier, "grunt");
  el("skWorkLabel").textContent = `The Field · ${region.name}`;
  const box = el("skWorkBody"); box.innerHTML = "";
  const card = document.createElement("div"); card.className = "node-card";
  card.innerHTML = `<div class="node-icon war">${icon(live.icon, "ico-lg")}</div>`;
  const info = document.createElement("div"); info.className = "node-info";
  const h = document.createElement("h3"); h.textContent = live.name;
  if (live.rank !== "grunt") { const tag = document.createElement("span"); tag.className = "rank-tag " + live.rank; tag.textContent = live.rank === "boss" ? "Sovereign" : "Elite"; h.appendChild(tag); }
  info.appendChild(h);
  
  const sub = document.createElement("div"); sub.className = "node-sub";
  sub.textContent = recovering() ? `Recovering...` : "Lead the vanguard."; info.appendChild(sub);
  
  const chips = document.createElement("div"); chips.className = "stat-chips";
  const atk = attackPower(), avg = Math.max(1, (atk * 0.55 + atk) / 2 - live.defence * 0.35);
  const killMs = (live.hp / avg) * PLAYER_SWING_MS + RESPAWN_MS, incoming = Math.max(1, (live.attack * 0.55 + live.attack) / 2 - defencePower() * 0.4), survive = maxHp() / (incoming / live.speed * 1000);
  chips.innerHTML = `<div class="chip">${fmt(live.hp)} HP</div><div class="chip">${fmt(live.attack)} attack</div><div class="