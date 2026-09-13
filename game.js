/* ============================================================
   Respite — a grim, slow idle RPG
   ------------------------------------------------------------
   Framing: you hold a ruined basecamp at the edge of somewhere
   that wants you dead. Camp work and killing happen at once
   because the camp keeps turning while you're out in it.
   ============================================================ */

/* ================= 1. CONSTANTS ================= */

const SCHEMA = 5;
const SAVE_PREFIX = "respite_save_v5";
const ACCOUNTS_KEY = "respite_accounts_v1";
const IDLE_CAP_MS = 12 * 60 * 60 * 1000;
const WINDOW_MS = 12 * 60 * 60 * 1000;      // bounty + smuggler refresh, on world clock
const DAY_MS = 24 * 60 * 60 * 1000;         // weather window
const MAX_LEVEL = 99;
const PLAYER_SWING_MS = 2400;
const RESPAWN_MS = 2000;
const PACK_SLOTS = 28;
const VAULT_START = 40;
const VAULT_MAX = 200;
const WAR_UNLOCK_TOTAL = 12;

const EQUIP_SLOTS = ["weapon", "offhand", "head", "chest", "legs", "boots", "gloves", "ring", "amulet"];
const SLOT_LABELS = {
  weapon: "Weapon", offhand: "Offhand", head: "Head", chest: "Chest", legs: "Legs",
  boots: "Boots", gloves: "Gloves", ring: "Ring", amulet: "Amulet",
};

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
  band:       '<circle cx="12" cy="14" r="6"/><path d="m9 6 3-3 3 3-3 3-3-3Z"/>',
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
/* XP = floor(65(L-1) + 5(L-1)^2.5 + 2.5 * 1.165^(L-1) - 2.5)
   Linear hook early, polynomial mid, exponential wall past 70.
   lvl10 = 1,807 · lvl30 = 24,736 · lvl50 = 91,662 · lvl99 = 8,386,355 */

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
/* Action times and XP taken straight from your per-item table. */

const TIERS = [
  { i: 1, level: 1,  time: 12000, xp: 1,  fell: "Bitter Ash",  delve: "Slag Stone", harvest: "Bitterweed",     flay: "Mangy Pelt",     dredge: "Mud Pearl" },
  { i: 2, level: 10, time: 20000, xp: 3,  fell: "Blood Oak",   delve: "Bog Iron",   harvest: "Grave Moss",     flay: "Bristle Hide",   dredge: "River Amber" },
  { i: 3, level: 20, time: 29000, xp: 6,  fell: "Ironbark",    delve: "Cold Iron",  harvest: "Blood Lotus",    flay: "Dire Pelt",      dredge: "Cave Agate" },
  { i: 4, level: 30, time: 38000, xp: 10, fell: "Grave Pine",  delve: "Black Steel",harvest: "Corpse Bloom",   flay: "Cave Leather",   dredge: "Blood Pearl" },
  { i: 5, level: 40, time: 48000, xp: 15, fell: "Sallow Wood", delve: "Blood Steel",harvest: "Widowsbane",     flay: "Bog Scale",      dredge: "Ghost Opal" },
  { i: 6, level: 50, time: 58000, xp: 22, fell: "Umber Oak",   delve: "Star Iron",  harvest: "Dragon Tongue",  flay: "Troll Skin",     dredge: "Sun Ruby" },
  { i: 7, level: 60, time: 69000, xp: 30, fell: "Wyrmwood",    delve: "Drake Stone",harvest: "Moon Mandrake",  flay: "Drake Scale",    dredge: "Abyssal Coral" },
  { i: 8, level: 70, time: 80000, xp: 39, fell: "Void Root",   delve: "Deep Slate", harvest: "Fade Weed",      flay: "Manticore Pelt", dredge: "Leviathan Bone" },
  { i: 9, level: 80, time: 92000, xp: 49, fell: "Blood Knot",  delve: "Titan Core", harvest: "God Bane",       flay: "Demon Hide",     dredge: "Void Sapphire" },
];

const slug = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

/* ================= 5. GATHERING SKILLS ================= */

const GATHER_SKILLS = [
  { id: "delving",    name: "Delving",    icon: "pick",   mat: "delve",   matIcon: "ore",   feeds: "forgemaster",
    node: "seam",  verb: "Cut from the", note: "Hack ore and metal out of the ground. Everything heavy starts here." },
  { id: "felling",    name: "Felling",    icon: "axe",    mat: "fell",    matIcon: "log",   feeds: "woodwright",
    node: "stand", verb: "Fell the",     note: "Take down dense timber. Wards and staves are carved from it." },
  { id: "harvesting", name: "Harvesting", icon: "sickle", mat: "harvest", matIcon: "fibre", feeds: "weaver",
    node: "thicket", verb: "Cut the",    note: "Strip fibrous flora and silks. Light cloth, lighter protection." },
  { id: "flaying",    name: "Flaying",    icon: "knife",  mat: "flay",    matIcon: "hide",  feeds: "tanner",
    node: "range", verb: "Skin the",     note: "Strip beasts of hide and scale. Ugly work, good boots." },
  { id: "dredging",   name: "Dredging",   icon: "net",    mat: "dredge",  matIcon: "gem",   feeds: "artificer",
    node: "shallows", verb: "Dredge the",note: "Drag riverbeds and deeper places for pearl, amber and bone." },
];

/* ================= 6. PROFESSIONS ================= */

const PROFESSIONS = [
  { id: "forgemaster", name: "Forgemaster", icon: "plate", from: "delving", mat: "delve",
    note: "Ore into weapons, harness and greaves. The heaviest protection in the camp.",
    pieces: [
      { key: "blade",      label: "blade",      slot: "weapon", icon: "blade",      atk: 1.0, def: 0.15, qty: 3, off: 0 },
      { key: "greatblade", label: "greatblade", slot: "weapon", icon: "greatblade", atk: 1.75, def: 0,   qty: 5, off: 6, twoHanded: true },
      { key: "harness",    label: "harness",    slot: "chest",  icon: "plate",      atk: 0,   def: 1.0,  qty: 4, off: 4 },
      { key: "greaves",    label: "greaves",    slot: "legs",   icon: "greaves",    atk: 0,   def: 0.8,  qty: 3, off: 2 },
    ] },
  { id: "woodwright", name: "Woodwright", icon: "ward", from: "felling", mat: "fell",
    note: "Timber into wards, staves and the chests that line your vault.",
    pieces: [
      { key: "ward",  label: "ward",  slot: "offhand", icon: "ward",  atk: 0,   def: 0.9, qty: 3, off: 1 },
      { key: "stave", label: "stave", slot: "weapon",  icon: "stave", atk: 1.2, def: 0.3, qty: 4, off: 4, twoHanded: true },
    ] },
  { id: "tanner", name: "Tanner", icon: "treads", from: "flaying", mat: "flay",
    note: "Hide into treads and gauntlets. Quiet, supple, and it never stops wearing out.",
    pieces: [
      { key: "treads",    label: "treads",    slot: "boots",  icon: "treads",    atk: 0,    def: 0.45, qty: 2, off: 0 },
      { key: "gauntlets", label: "gauntlets", slot: "gloves", icon: "gauntlets", atk: 0.18, def: 0.32, qty: 2, off: 1 },
    ] },
  { id: "weaver", name: "Weaver", icon: "cowl", from: "harvesting", mat: "harvest",
    note: "Fibre into cowls and shrouds. Almost no defence, but it carries the life in it.",
    pieces: [
      { key: "cowl",   label: "cowl",   slot: "head",  icon: "cowl",   atk: 0,    def: 0.32, qty: 2, off: 0, hp: 0.7 },
      { key: "shroud", label: "shroud", slot: "chest", icon: "shroud", atk: 0.18, def: 0.42, qty: 4, off: 3, hp: 1.1 },
    ] },
  { id: "artificer", name: "Artificer", icon: "charm", from: "dredging", mat: "dredge",
    note: "Pearl, amber and bone into bands and charms. Small things that change the arithmetic.",
    pieces: [
      { key: "band",  label: "band",  slot: "ring",   icon: "band",  atk: 0.55, def: 0,   qty: 3, off: 2, hp: 0.4 },
      { key: "charm", label: "charm", slot: "amulet", icon: "charm", atk: 0.22, def: 0.2, qty: 3, off: 5, hp: 1.4 },
    ] },
];

/* ================= 7. ITEMS ================= */

const MATERIALS = {};
const GEAR = {};

function matId(tier, kind) { return `${slug(tier[kind])}_${kind}`; }

TIERS.forEach((t) => {
  const value = Math.round(4 * Math.pow(2.05, t.i - 1));
  GATHER_SKILLS.forEach((s) => {
    MATERIALS[matId(t, s.mat)] = {
      id: matId(t, s.mat), name: t[s.mat], icon: s.matIcon,
      kind: "material", value, tier: t.i,
    };
  });
});

// Provisions are bought, not cooked — there is no cooking skill.
const RATIONS = TIERS.filter((t) => t.i % 2 === 1).map((t) => ({
  id: `ration_t${t.i}`,
  name: ["Hard tack", "Salt pork", "Spiced stew", "Blood pudding", "Godsbread"][Math.floor(t.i / 2)],
  icon: "ration", kind: "material", tier: t.i,
  heal: Math.round(10 * Math.pow(1.95, t.i - 1)),
  value: Math.round(8 * Math.pow(2.3, t.i - 1)),
}));
RATIONS.forEach((r) => { MATERIALS[r.id] = r; });

MATERIALS.vault_chest = { id: "vault_chest", name: "Banded chest", icon: "crate", kind: "material", value: 600, chest: 5, tier: 2 };

PROFESSIONS.forEach((prof) => {
  TIERS.forEach((t) => {
    prof.pieces.forEach((piece) => {
      const id = `${slug(t[prof.mat])}_${piece.key}`;
      const power = Math.round(4 * Math.pow(1.52, t.i - 1));
      GEAR[id] = {
        id, name: `${t[prof.mat]} ${piece.label}`, icon: piece.icon, kind: "gear",
        slot: piece.slot, tier: t.i, prof: prof.id,
        attack: Math.round(power * piece.atk),
        defence: Math.round(power * piece.def),
        health: Math.round(power * (piece.hp || 0)),
        twoHanded: !!piece.twoHanded,
        maxDur: 400 + t.i * 220,
        repairMat: matId(t, prof.mat),
        value: Math.round(power * (piece.atk + piece.def + (piece.hp || 0)) * 34 + 50),
        craft: { prof: prof.id, tier: t.i, qty: piece.qty, level: t.level + piece.off },
      };
    });
  });
});

function makeKey(base, rarity) { return rarity ? `${base}|${rarity}` : base; }
function parseKey(key) { const b = String(key).split("|"); return { base: b[0], rarity: b[1] || null }; }

function itemDef(key) {
  const { base, rarity } = parseKey(key);
  const g = GEAR[base];
  if (g) {
    const m = rarityDef(rarity || "common").mult;
    return {
      base, rarity: rarity || "common", kind: "gear", name: g.name, icon: g.icon, slot: g.slot,
      attack: Math.round(g.attack * m), defence: Math.round(g.defence * m), health: Math.round(g.health * m),
      twoHanded: g.twoHanded, maxDur: g.maxDur, repairMat: g.repairMat,
      value: Math.round(g.value * m), tier: g.tier, prof: g.prof, craft: g.craft,
    };
  }
  const mat = MATERIALS[base];
  return mat ? Object.assign({ base, rarity: null }, mat) : null;
}

function itemName(key) {
  const d = itemDef(key);
  if (!d) return String(key);
  return d.kind === "gear" && d.rarity !== "common" ? `${rarityDef(d.rarity).name} ${d.name}` : d.name;
}

/* ================= 8. SKILLS + ACTIONS ================= */

const SKILLS = []
  .concat(GATHER_SKILLS.map((s) => ({ id: s.id, name: s.name, icon: s.icon, kind: "gather" })))
  .concat(PROFESSIONS.map((p) => ({ id: p.id, name: p.name, icon: p.icon, kind: "craft" })))
  .concat([{ id: "warfare", name: "Warfare", icon: "swords", kind: "war" }]);

const skillDef = (id) => SKILLS.find((s) => s.id === id);
const skillName = (id) => (skillDef(id) ? skillDef(id).name : id);

const GATHER_ACTIONS = {};
GATHER_SKILLS.forEach((s) => {
  GATHER_ACTIONS[s.id] = TIERS.map((t) => ({
    id: `${s.id}_t${t.i}`, skillId: s.id, tier: t.i,
    name: `${t[s.mat]} ${s.node}`, icon: s.matIcon,
    level: t.level, time: t.time, xp: t.xp,
    out: { [matId(t, s.mat)]: 1 },
  }));
});

const CRAFT_ACTIONS = {};
PROFESSIONS.forEach((prof) => {
  CRAFT_ACTIONS[prof.id] = [];
  TIERS.forEach((t) => {
    prof.pieces.forEach((piece) => {
      const id = `${slug(t[prof.mat])}_${piece.key}`;
      const g = GEAR[id];
      CRAFT_ACTIONS[prof.id].push({
        id: `craft_${id}`, skillId: prof.id, tier: t.i,
        name: g.name, icon: piece.icon,
        level: g.craft.level, time: Math.round(t.time * 1.3), xp: Math.round(t.xp * 2) + 1,
        cost: { [matId(t, prof.mat)]: piece.qty },
        craftGear: id,
      });
    });
  });
});

CRAFT_ACTIONS.woodwright.push({
  id: "craft_vault_chest", skillId: "woodwright", tier: 2,
  name: "Banded chest", icon: "crate", level: 12, time: 45000, xp: 8,
  cost: { [matId(TIERS[1], "fell")]: 20 },
  out: { vault_chest: 1 },
});

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

// Toll scaling, anchored to your numbers: t2 = 300, t6 = 2,500, t9 = 10,000.
const TOLLS = [0, 300, 600, 1100, 1700, 2500, 4200, 6500, 10000];

const MONSTER_SPEC = [
  ["Carrion rat", "beast"], ["Gibbet shade", "horror"], ["Warren goblin", "man"],
  ["Cairn wight", "horror"], ["Fen troll", "beast"], ["Umber golem", "golemMob"],
  ["Wyrmkin raider", "drakeMob"], ["Fade warden", "horror"], ["Godsdown horror", "horror"],
];

const REGIONS = TIERS.map((t, i) => ({
  id: `region_${t.i}`, tier: t.i, name: REGION_NAMES[i][0], note: REGION_NAMES[i][1],
  level: t.level, toll: TOLLS[i],
}));

const MONSTERS = TIERS.map((t, i) => {
  const s = Math.pow(2.1, t.i - 1);
  return {
    id: `mob_t${t.i}`, tier: t.i, name: MONSTER_SPEC[i][0], icon: MONSTER_SPEC[i][1],
    level: t.level, hp: Math.round(16 * s), attack: Math.round(4 * s), defence: Math.round(1.6 * s),
    speed: 3000, xp: Math.round(t.xp * 2.6), gold: [Math.round(3 * s), Math.round(8 * s)],
    drops: [
      [matId(t, "flay"), 1, 0.5],
      [matId(t, "delve"), 1, 0.22],
      [matId(t, "dredge"), 1, 0.14],
    ],
  };
});

const regionById = (id) => REGIONS.find((r) => r.id === id) || REGIONS[0];
const monsterOfTier = (tier) => MONSTERS.find((m) => m.tier === tier);
const getMonster = (id) => MONSTERS.find((m) => m.id === id) || null;

/* ================= 10. WEATHER (world clock, deterministic) ================= */

const WEATHERS = [
  { id: "clear", name: "Clear", icon: "sun",  note: "Nothing helping, nothing hindering.", mods: {} },
  { id: "rain",  name: "Rain",  icon: "rain", note: "Dredging runs faster. Felling bogs down.",
    mods: { dredging: 0.8, felling: 1.15 } },
  { id: "fog",   name: "Grave fog", icon: "fog", note: "Flaying and Harvesting slow to a crawl. Delving is unbothered underground.",
    mods: { flaying: 1.2, harvesting: 1.15, delving: 0.9 } },
  { id: "frost", name: "Hard frost", icon: "fog", note: "Everything above ground stiffens. Forge work speeds up.",
    mods: { felling: 1.12, harvesting: 1.12, forgemaster: 0.85 } },
  { id: "swelter", name: "Swelter", icon: "sun", note: "Camp work drags. Dredging the cold water is a relief.",
    mods: { forgemaster: 1.15, woodwright: 1.1, dredging: 0.88 } },
];

function seedFrom(n) { let x = Math.sin(n) * 10000; return x - Math.floor(x); }
function currentWeather() {
  const day = Math.floor(Date.now() / DAY_MS);
  return WEATHERS[Math.floor(seedFrom(day * 7.77) * WEATHERS.length)];
}

function speedMod(skillId) {
  let m = currentWeather().mods[skillId] || 1;
  if (state.pets && state.pets.golem && GATHER_SKILLS.some((s) => s.id === skillId)) m *= 0.88;
  return m;
}

function actionTime(def) { return Math.max(1000, Math.round(def.time * speedMod(def.skillId))); }

/* ================= 11. STATE ================= */

let state = freshState();

function freshState() {
  const skills = {};
  SKILLS.forEach((s) => { skills[s.id] = 0; });
  const equipment = {};
  EQUIP_SLOTS.forEach((s) => { equipment[s] = null; });
  return {
    schema: SCHEMA,
    meta: { createdAt: Date.now(), lastSeen: Date.now(), playtimeMs: 0, account: null, userId: null },
    player: { gold: 0, hp: 20 },
    skills,
    inv: { slots: PACK_SLOTS, items: {}, order: [] },
    bank: { slots: VAULT_START, items: {}, order: [] },
    equipment,
    wear: {},
    tasks: { skilling: null, combat: null },
    region: "region_1",
    travel: { unlocked: ["region_1"] },
    unlocked: { delving: true, felling: true, harvesting: true, flaying: true, dredging: true,
                forgemaster: false, woodwright: false, tanner: false, weaver: false, artificer: false,
                warfare: false },
    pets: { golem: false, sprite: false, mule: false },
    bounty: null,
    buff: null,           // { until, mult }
    smugglerBought: {},
    stats: { kills: 0, actions: 0, deaths: 0, crafted: 0, epics: 0, goldEarned: 0 },
    log: [],
  };
}

let tab = "skill";
let skillView = "delving";
let storeView = "inv";
let selected = null;

/* ================= 12. HELPERS ================= */

const el = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

function skillLevel(id) { return levelFromXp(state.skills[id] || 0); }
function totalLevel() { return SKILLS.reduce((n, s) => n + skillLevel(s.id), 0); }
function currentRegion() { return regionById(state.region); }

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

/* ---- storage ---- */

function store(w) { return w === "bank" ? state.bank : state.inv; }
function packSlots() { return PACK_SLOTS + (state.pets.mule ? 8 : 0); }
function slotCap(w) { return w === "bank" ? state.bank.slots : packSlots(); }
function qtyIn(w, k) { return store(w).items[k] || 0; }
function haveQty(k) { return qtyIn("inv", k) + qtyIn("bank", k); }
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
  const s = store(w);
  const left = (s.items[key] || 0) - qty;
  if (left > 0) s.items[key] = left;
  else {
    delete s.items[key];
    s.order = s.order.filter((k) => k !== key);
    if (selected === key) selected = null;
  }
}

function spend(key, qty) {
  const fromInv = Math.min(qty, qtyIn("inv", key));
  if (fromInv) removeFrom("inv", key, fromInv);
  const rest = qty - fromInv;
  if (rest > 0) removeFrom("bank", key, rest);
}

function canAfford(cost) { return !cost || Object.keys(cost).every((k) => haveQty(k) >= cost[k]); }
function payCost(cost) { if (cost) Object.keys(cost).forEach((k) => spend(k, cost[k])); }

function orderedKeys(w) {
  const s = store(w);
  const have = Object.keys(s.items);
  const out = s.order.filter((k) => have.includes(k));
  have.forEach((k) => { if (!out.includes(k)) out.push(k); });
  return out;
}

/* ---- stats ---- */

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

function maxHp() { return 20 + skillLevel("warfare") * 5 + equipStat("health"); }
function attackPower() { return 4 + skillLevel("warfare") * 1.6 + equipStat("attack"); }
function defencePower() { return skillLevel("warfare") * 0.9 + equipStat("defence"); }

function wearPct(key) {
  const d = itemDef(key);
  if (!d || !d.maxDur) return null;
  return clamp(Math.round((1 - (state.wear[key] || 0) / d.maxDur) * 100), 0, 100);
}

function addGold(n) { state.player.gold += n; state.stats.goldEarned += n; }

/* ================= 13. PROGRESSION ================= */

function xpMult() {
  return (state.buff && state.buff.until > Date.now()) ? state.buff.mult : 1;
}

function grantXp(skillId, amount) {
  const gain = Math.max(1, Math.round(amount * xpMult()));
  const before = skillLevel(skillId);
  state.skills[skillId] = (state.skills[skillId] || 0) + gain;
  const after = skillLevel(skillId);
  if (after > before) {
    say(`${skillName(skillId)} reaches level ${after}.`);
    if (skillId === "warfare") state.player.hp = maxHp();
    if (after % 10 === 0) toast(`${skillName(skillId)} — level ${after}`);
  }
}

function checkUnlocks() {
  const u = state.unlocked;
  const owns = (suffix) => Object.keys(state.inv.items).concat(Object.keys(state.bank.items))
    .some((k) => parseKey(k).base.endsWith(suffix));

  GATHER_SKILLS.forEach((s) => {
    if (!u[s.feeds] && owns("_" + s.mat)) {
      u[s.feeds] = true;
      const prof = PROFESSIONS.find((p) => p.id === s.feeds);
      say(`${prof.name} opens at camp.`);
      toast(`${prof.name} unlocked`);
    }
  });

  if (!u.warfare && totalLevel() >= WAR_UNLOCK_TOTAL) {
    u.warfare = true;
    say("You are ready to take the field. The camp keeps working while you fight.");
    toast("Warfare unlocked — it runs alongside your labour");
  }
}

/* ================= 14. TICK ================= */

function tick(dt) {
  if (state.tasks.skilling) skillTick(dt);
  if (state.tasks.combat) combatTick(dt);
  if (state.buff && state.buff.until <= Date.now()) state.buff = null;
}

function skillTick(dt) {
  const task = state.tasks.skilling;
  const def = findAction(task.skillId, task.actionId);
  if (!def) { state.tasks.skilling = null; return; }

  const time = actionTime(def);
  task.progress += dt;
  let guard = 0;

  while (task.progress >= time && guard++ < 200000) {
    if (!canAfford(def.cost)) { say(`Stopped — out of materials for ${def.name.toLowerCase()}.`); state.tasks.skilling = null; return; }
    if (!outputFits(def)) {
      say(`Stopped — your pack is full.`);
      toast("Pack full — move things to the vault or sell them");
      state.tasks.skilling = null;
      return;
    }

    task.progress -= time;
    payCost(def.cost);
    produce(def);
    grantXp(task.skillId, def.xp);
    task.done++;
    state.stats.actions++;
    bountyProgress("gather", def);
    checkUnlocks();

    if (task.queued) {
      const q = task.queued;
      if (q === "stop") { state.tasks.skilling = null; say("Task finished. Stopped as ordered."); return; }
      state.tasks.skilling = newSkillTask(q.skillId, q.actionId);
      say(`Moved on to ${findAction(q.skillId, q.actionId).name.toLowerCase()}.`);
      return;
    }
  }
}

function outputFits(def) {
  if (def.craftGear) return !storeFull("inv");
  if (!def.out) return true;
  return Object.keys(def.out).every((k) => state.inv.items[k] || !storeFull("inv"));
}

function produce(def) {
  if (def.out) {
    Object.keys(def.out).forEach((k) => {
      let qty = def.out[k];
      // Stone golem: sometimes hauls out a second load.
      if (state.pets.golem && GATHER_ACTIONS[def.skillId] && Math.random() < 0.15) qty *= 2;
      if (!addTo("inv", k, qty)) say(`No room for ${itemName(k)}.`);
    });
  }
  if (def.craftGear) {
    const rarity = rollRarity();
    const key = makeKey(def.craftGear, rarity);
    if (addTo("inv", key, 1)) {
      state.stats.crafted++;
      bountyProgress("craft", def);
      if (rarity !== "common") {
        say(`The ${GEAR[def.craftGear].name.toLowerCase()} comes out ${rarityDef(rarity).name.toLowerCase()}.`);
        if (rarity === "epic") { state.stats.epics++; toast(`Epic: ${GEAR[def.craftGear].name}`); }
        else if (rarity === "rare") toast(`Rare: ${GEAR[def.craftGear].name}`);
      }
    } else say(`No room for the ${GEAR[def.craftGear].name.toLowerCase()} — it was lost.`);
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
      if (c.queued === "stop") { state.tasks.combat = null; say("Fight finished. Stopped as ordered."); return; }
      if (c.queued) { state.tasks.combat = newCombatTask(c.queued); return; }
      c.mobHp = mob.hp; c.mobMax = mob.hp; c.mobTimer = mob.speed; c.playerTimer = PLAYER_SWING_MS;
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
      if (food) { spend(food, 1); state.player.hp = Math.min(maxHp(), state.player.hp + itemDef(food).heal); }
    }

    if (state.player.hp <= 0) {
      state.player.hp = maxHp();
      state.tasks.combat = null;
      state.stats.deaths++;
      say(`The ${mob.name.toLowerCase()} put you down. You keep what you carried — buy provisions.`);
      toast(`Killed by a ${mob.name.toLowerCase()}`);
    }
  }
}

function killMob(mob) {
  const c = state.tasks.combat;
  grantXp("warfare", mob.xp);
  addGold(randInt(mob.gold[0], mob.gold[1]));
  state.stats.kills++;
  c.done++;
  bountyProgress("slay", mob);

  mob.drops.forEach(([k, qty, chance]) => {
    if (Math.random() >= chance) return;
    // Looting sprite: carries drops straight to the vault when the pack is full.
    if (!addTo("inv", k, qty)) {
      if (state.pets.sprite && addTo("bank", k, qty)) return;
      say(`No room for ${itemName(k)}.`);
    }
  });

  applyWear();
  checkUnlocks();
  c.respawn = RESPAWN_MS;
}

function applyWear() {
  const w = state.equipment.weapon;
  if (w && itemDef(w).maxDur) damageItem(w, 1);
  const armour = EQUIP_SLOTS.filter((s) => !["weapon", "ring", "amulet"].includes(s))
    .map((s) => state.equipment[s]).filter((k) => k && itemDef(k).maxDur);
  if (armour.length) damageItem(armour[randInt(0, armour.length - 1)], 1);
}

function damageItem(key, amount) {
  const d = itemDef(key);
  state.wear[key] = (state.wear[key] || 0) + amount;
  if (state.wear[key] >= d.maxDur) {
    state.equipment[d.slot] = null;
    state.wear[key] = 0;
    say(`Your ${itemName(key).toLowerCase()} came apart for good.`);
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
  if (haveQty(cost.mat) < cost.qty) { say(`Need ${cost.qty} ${itemName(cost.mat).toLowerCase()}.`); render(); return; }
  spend(cost.mat, cost.qty);
  state.wear[key] = 0;
  say(`Patched up your ${itemName(key).toLowerCase()}.`);
  render();
}

function salvageValue(key) {
  const d = itemDef(key);
  if (d.kind !== "gear" || !d.craft) return null;
  const prof = PROFESSIONS.find((p) => p.id === d.prof);
  return { mat: matId(TIERS[d.craft.tier - 1], prof.mat), qty: Math.max(1, Math.floor(d.craft.qty * 0.4)) };
}

function salvage(key) {
  const out = salvageValue(key);
  if (!out) return;
  removeFrom(storeView, key, 1);
  if (!addTo("inv", out.mat, out.qty)) addTo("bank", out.mat, out.qty);
  say(`Broke down the ${itemName(key).toLowerCase()} for ${out.qty} ${itemName(out.mat).toLowerCase()}.`);
  render();
}

/* ================= 15. TASKS ================= */

function newSkillTask(skillId, actionId) {
  return { skillId, actionId, progress: 0, done: 0, startedAt: Date.now(), queued: null };
}

function newCombatTask(monsterId) {
  const mob = getMonster(monsterId);
  return { monsterId, mobHp: mob.hp, mobMax: mob.hp, playerTimer: PLAYER_SWING_MS,
    mobTimer: mob.speed, respawn: 0, done: 0, startedAt: Date.now(), queued: null };
}

function selectSkillAction(skillId, actionId) {
  const def = findAction(skillId, actionId);
  if (!def || skillLevel(skillId) < def.level) return;
  const t = state.tasks.skilling;
  if (!t) { state.tasks.skilling = newSkillTask(skillId, actionId); render(); return; }
  if (t.skillId === skillId && t.actionId === actionId) {
    t.queued = t.queued === "stop" ? null : "stop";
  } else {
    t.queued = { skillId, actionId };
    say(`Queued ${def.name.toLowerCase()} — the current action finishes first.`);
  }
  render();
}

function selectMonster(monsterId) {
  if (!state.unlocked.warfare) return;
  const t = state.tasks.combat;
  if (!t) { state.tasks.combat = newCombatTask(monsterId); state.player.hp = maxHp(); render(); return; }
  if (t.monsterId === monsterId) t.queued = t.queued === "stop" ? null : "stop";
  else { t.queued = monsterId; say("Queued a new quarry — this fight finishes first."); }
  render();
}

function skillPlan() {
  const t = state.tasks.skilling;
  if (!t) return null;
  const def = findAction(t.skillId, t.actionId);
  if (!def) return null;
  const time = actionTime(def);
  const windowLeft = Math.max(0, IDLE_CAP_MS - (Date.now() - t.startedAt));
  let remaining = Math.floor(windowLeft / time);
  let capped = null;
  if (def.cost) {
    let byMats = Infinity;
    Object.keys(def.cost).forEach((k) => { byMats = Math.min(byMats, Math.floor(haveQty(k) / def.cost[k])); });
    if (byMats < remaining) { remaining = byMats; capped = true; }
  }
  return { def, done: t.done, target: t.done + remaining, timeLeft: remaining * time - t.progress,
    capped, pct: clamp((t.progress / time) * 100, 0, 100) };
}

function combatPlan() {
  const t = state.tasks.combat;
  if (!t) return null;
  const mob = getMonster(t.monsterId);
  if (!mob) return null;
  const atk = attackPower();
  const avgHit = Math.max(1, (atk * 0.55 + atk) / 2 - mob.defence * 0.35);
  const killMs = (mob.hp / avgHit) * PLAYER_SWING_MS + RESPAWN_MS;
  const windowLeft = Math.max(0, IDLE_CAP_MS - (Date.now() - t.startedAt));
  const remaining = Math.floor(windowLeft / killMs);
  const incoming = Math.max(1, (mob.attack * 0.55 + mob.attack) / 2 - defencePower() * 0.4);
  const food = bestFood();
  const foodNeed = food ? Math.ceil((incoming / mob.speed * windowLeft) / itemDef(food).heal) : null;
  return { mob, done: t.done, target: t.done + remaining, timeLeft: remaining * killMs, killMs,
    pct: t.respawn > 0 ? 0 : clamp((t.mobHp / t.mobMax) * 100, 0, 100),
    food, foodNeed, foodHave: food ? haveQty(food) : 0 };
}

/* ================= 16. BOUNTY (world clock) ================= */

function currentWindow() { return Math.floor(Date.now() / WINDOW_MS); }
function windowEndsIn() { return WINDOW_MS - (Date.now() % WINDOW_MS); }

function makeBounty() {
  const w = currentWindow();
  const region = currentRegion();
  const t = TIERS[region.tier - 1];
  const roll = seedFrom(w * 3.31 + region.tier);

  if (roll < 0.45 && state.unlocked.warfare) {
    const mob = monsterOfTier(region.tier);
    const amount = 10 + Math.floor(seedFrom(w * 5.5) * 15);
    return { window: w, region: region.id, kind: "slay", targetId: mob.id,
      label: `Put down ${amount} ${mob.name.toLowerCase()}`, amount, progress: 0, claimed: false,
      gold: Math.round(mob.gold[1] * amount * 0.8) };
  }
  const skill = GATHER_SKILLS[Math.floor(seedFrom(w * 9.13 + region.tier) * GATHER_SKILLS.length)];
  const amount = 20 + Math.floor(seedFrom(w * 2.7) * 30);
  return { window: w, region: region.id, kind: "gather", targetId: matId(t, skill.mat),
    label: `Bring in ${amount} ${t[skill.mat].toLowerCase()}`, amount, progress: 0, claimed: false,
    gold: Math.round(MATERIALS[matId(t, skill.mat)].value * amount * 1.5) };
}

function refreshBounty() {
  const w = currentWindow();
  if (!state.bounty || state.bounty.window !== w || state.bounty.region !== state.region) {
    state.bounty = makeBounty();
  }
}

function bountyProgress(kind, thing) {
  const b = state.bounty;
  if (!b || b.claimed || b.kind !== kind) return;
  if (kind === "slay" && thing.id === b.targetId) b.progress++;
  if (kind === "gather" && thing.out && thing.out[b.targetId]) b.progress += thing.out[b.targetId];
  if (b.progress >= b.amount && !b.claimed) toast("Bounty complete — claim it on the board");
}

function claimBounty() {
  const b = state.bounty;
  if (!b || b.claimed || b.progress < b.amount) return;
  b.claimed = true;
  addGold(b.gold);
  state.buff = { until: Date.now() + 60 * 60 * 1000, mult: 2 };
  say(`Bounty paid: ${fmt(b.gold)} gold. Double experience for the next hour.`);
  toast("Double XP for one hour");
  render();
}

/* ================= 17. SHOP ================= */

function shopStock() {
  return RATIONS.map((r) => ({ key: r.id, price: Math.round(r.value * 1.6), unlockTier: r.tier }));
}

function smugglerStock() {
  const w = currentWindow();
  const picks = [];
  const pool = Object.keys(MATERIALS).filter((k) => MATERIALS[k].tier && !MATERIALS[k].heal && k !== "vault_chest");
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(seedFrom(w * (i + 2) * 1.77) * pool.length);
    const key = pool[idx];
    const qty = 5 + Math.floor(seedFrom(w * (i + 3) * 4.2) * 20);
    picks.push({ key, qty, price: Math.round(MATERIALS[key].value * qty * 2.4), slot: i });
  }
  return picks;
}

function buyShop(key, price, qty) {
  if (state.player.gold < price) { say("Not enough gold."); render(); return; }
  if (!addTo("inv", key, qty)) { say("No room in your pack."); render(); return; }
  state.player.gold -= price;
  say(`Bought ${qty}\u00D7 ${itemName(key).toLowerCase()}.`);
  render();
}

function buySmuggler(entry) {
  const w = currentWindow();
  const tag = `${w}_${entry.slot}`;
  if (state.smugglerBought[tag]) return;
  if (state.player.gold < entry.price) { say("The smuggler doesn't haggle."); render(); return; }
  if (!addTo("inv", entry.key, entry.qty)) { say("No room in your pack."); render(); return; }
  state.player.gold -= entry.price;
  state.smugglerBought = {};           // only the current window matters
  state.smugglerBought[tag] = true;
  say(`The smuggler hands over ${entry.qty}\u00D7 ${itemName(entry.key).toLowerCase()}.`);
  render();
}

/* ================= 18. PETS ================= */

const PETS = [
  { id: "golem",  name: "Stone golem",  icon: "golemMob", cost: 4000,
    note: "Works the seam beside you. Gathering runs 12% faster, and one load in seven comes out doubled." },
  { id: "sprite", name: "Looting sprite", icon: "horror", cost: 7500,
    note: "Flits between the field and the vault. Drops that won't fit your pack go straight to storage." },
  { id: "mule",   name: "Pack mule",    icon: "beast", cost: 2500,
    note: "Carries what you can't. Eight more slots in your pack, permanently." },
];

function buyPet(id) {
  const pet = PETS.find((p) => p.id === id);
  if (!pet || state.pets[id]) return;
  if (state.player.gold < pet.cost) { say(`${pet.name} costs ${fmt(pet.cost)} gold.`); render(); return; }
  state.player.gold -= pet.cost;
  state.pets[id] = true;
  say(`${pet.name} joins the camp.`);
  toast(`${pet.name} acquired`);
  render();
}

/* ================= 19. TRAVEL ================= */

function travelTo(regionId) {
  const r = regionById(regionId);
  if (!state.travel.unlocked.includes(regionId)) {
    if (state.player.gold < r.toll) { say(`The road to ${r.name} costs ${fmt(r.toll)} gold.`); render(); return; }
    state.player.gold -= r.toll;
    state.travel.unlocked.push(regionId);
    say(`Paid ${fmt(r.toll)} gold. The road to ${r.name} is open.`);
    toast(`${r.name} unlocked`);
  }
  state.region = regionId;
  refreshBounty();
  say(`Moved to ${r.name}.`);
  render();
}

/* ================= 20. EQUIPMENT ================= */

function equip(key) {
  const d = itemDef(key);
  if (!d || !d.slot) return;
  if (d.slot === "weapon" && d.twoHanded && state.equipment.offhand) {
    if (!addTo("inv", state.equipment.offhand, 1)) { say("No room to stow your offhand."); render(); return; }
    state.equipment.offhand = null;
  }
  if (d.slot === "offhand") {
    const w = state.equipment.weapon;
    if (w && itemDef(w).twoHanded) { say(`Both hands are on the ${itemName(w).toLowerCase()}.`); render(); return; }
  }
  const old = state.equipment[d.slot];
  if (old && !addTo("inv", old, 1)) { say("No room for what you're taking off."); render(); return; }
  removeFrom(storeView, key, 1);
  state.equipment[d.slot] = key;
  render();
}

function unequip(slot) {
  const key = state.equipment[slot];
  if (!key) return;
  if (!addTo("inv", key, 1)) { say("No room in your pack."); render(); return; }
  state.equipment[slot] = null;
  render();
}

function sell(key, all) {
  const qty = all ? qtyIn(storeView, key) : 1;
  if (qty <= 0) return;
  addGold(itemDef(key).value * qty);
  removeFrom(storeView, key, qty);
  render();
}

function transfer(key, all) {
  const from = storeView, to = from === "inv" ? "bank" : "inv";
  const qty = all ? qtyIn(from, key) : 1;
  if (qty <= 0) return;
  if (!store(to).items[key] && storeFull(to)) { say(`${to === "bank" ? "Vault" : "Pack"} is full.`); render(); return; }
  removeFrom(from, key, qty);
  addTo(to, key, qty);
  render();
}

function useChest(key) {
  if (parseKey(key).base !== "vault_chest") return;
  if (state.bank.slots >= VAULT_MAX) { say("The vault is as deep as it goes."); render(); return; }
  removeFrom(storeView, key, 1);
  state.bank.slots = Math.min(VAULT_MAX, state.bank.slots + MATERIALS.vault_chest.chest);
  say(`Vault widened to ${state.bank.slots} slots.`);
  render();
}

/* ================= 21. SAVE / ACCOUNTS ================= */
/* Two tiers, so the game works before and after you paste in your anon key:
   - No key set: accounts are per-browser, exactly as before.
   - Key set: accounts live in Supabase (auth.users + a `saves` table with
     row-level security), and localStorage becomes a write-through cache
     so a dropped connection never loses progress mid-session. */

const sb = (window.supabase && window.RESPITE_SUPABASE_URL && window.RESPITE_SUPABASE_ANON_KEY
  && window.RESPITE_SUPABASE_ANON_KEY !== "PASTE_YOUR_ANON_KEY_HERE")
  ? window.supabase.createClient(window.RESPITE_SUPABASE_URL, window.RESPITE_SUPABASE_ANON_KEY)
  : null;

// Supabase auth wants an email. Usernames are mapped to one under a fake
// domain so the login UI can stay "username + password".
function emailFor(user) { return `${user}@players.respite`; }
function validUsername(u) { return /^[a-z0-9_]{3,20}$/.test(u || ""); }

function hashPass(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return String(h); }
function readAccounts() { try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "{}"); } catch (e) { return {}; } }
function writeAccounts(a) { try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(a)); } catch (e) {} }
function saveKey() { return state.meta.account ? `${SAVE_PREFIX}_${state.meta.account}` : `${SAVE_PREFIX}_guest`; }

function save() {
  state.meta.lastSeen = Date.now();
  let ok = true;
  try { localStorage.setItem(saveKey(), JSON.stringify(state)); }
  catch (e) { const n = el("saveNote"); if (n) n.textContent = "Local storage is blocked here."; ok = false; }

  // Cloud write is fire-and-forget — the local write above already
  // protects this session; this just carries it to other devices.
  if (sb && state.meta.userId) {
    sb.from("saves")
      .update({ data: state, updated_at: new Date().toISOString() })
      .eq("user_id", state.meta.userId)
      .then(({ error }) => { if (error) console.error("Cloud save failed:", error.message); });
  }
  return ok;
}

async function createAccount(user, pass) {
  user = (user || "").trim().toLowerCase();
  if (!validUsername(user)) return "Username: 3–20 characters, lowercase letters, numbers, underscore only.";
  if ((pass || "").length < 4) return "Password needs at least 4 characters.";

  if (!sb) {
    const accts = readAccounts();
    if (accts[user]) return "That name is taken on this browser.";
    accts[user] = { hash: hashPass(pass), created: Date.now() };
    writeAccounts(accts);
    state.meta.account = user;
    save();
    return null;
  }

  const { data, error } = await sb.auth.signUp({ email: emailFor(user), password: pass });
  if (error) return error.message.includes("already") ? "That username is taken." : error.message;
  if (!data.session) {
    return "Created, but Supabase wants email confirmation first. In the dashboard: " +
      "Authentication → Providers → Email → turn off \"Confirm email\", then log in.";
  }

  const userId = data.session.user.id;
  const { error: insErr } = await sb.from("saves").insert({ user_id: userId, username: user, data: state });
  if (insErr) return insErr.code === "23505" ? "That username is taken." : insErr.message;

  state.meta.account = user;
  state.meta.userId = userId;
  save();
  return null;
}

async function loginAccount(user, pass) {
  user = (user || "").trim().toLowerCase();

  if (!sb) {
    const accts = readAccounts();
    if (!accts[user]) return "No account by that name on this browser.";
    if (accts[user].hash !== hashPass(pass)) return "Wrong password.";
    const raw = localStorage.getItem(`${SAVE_PREFIX}_${user}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const last = (parsed.meta && parsed.meta.lastSeen) || Date.now();
        state = migrate(parsed);
        state.meta.account = user;
        const gone = Date.now() - last;
        if (gone > 30000) catchUp({ ms: Math.min(gone, IDLE_CAP_MS), overCap: gone > IDLE_CAP_MS });
      } catch (e) { return "That account's save is corrupted."; }
    } else { state = freshState(); state.meta.account = user; }
    selected = null;
    refreshBounty();
    render();
    return null;
  }

  const { data, error } = await sb.auth.signInWithPassword({ email: emailFor(user), password: pass });
  if (error) return "Wrong username or password.";

  const userId = data.session.user.id;
  const { data: row, error: selErr } = await sb.from("saves").select("data, updated_at").eq("user_id", userId).single();
  if (selErr) return "Signed in, but couldn't load your save: " + selErr.message;

  const last = (row.data && row.data.meta && row.data.meta.lastSeen) || Date.parse(row.updated_at) || Date.now();
  state = migrate(row.data);
  state.meta.account = user;
  state.meta.userId = userId;
  const gone = Date.now() - last;
  if (gone > 30000) catchUp({ ms: Math.min(gone, IDLE_CAP_MS), overCap: gone > IDLE_CAP_MS });

  selected = null;
  refreshBounty();
  save();
  render();
  return null;
}

async function logoutAccount() {
  save();
  if (sb) { try { await sb.auth.signOut(); } catch (e) {} }
  state = freshState();
  selected = null;
  render();
}

function migrate(loaded) {
  const base = freshState();
  if (!loaded || typeof loaded !== "object") return base;
  const m = Object.assign(base, loaded);
  m.schema = SCHEMA;
  ["meta", "player", "skills", "equipment", "tasks", "travel", "unlocked", "pets", "stats"].forEach((k) => {
    m[k] = Object.assign(base[k], loaded[k] || {});
  });
  m.inv = Object.assign(base.inv, loaded.inv || {});
  m.bank = Object.assign(base.bank, loaded.bank || {});
  m.inv.items = Object.assign({}, (loaded.inv && loaded.inv.items) || {});
  m.bank.items = Object.assign({}, (loaded.bank && loaded.bank.items) || {});
  m.inv.order = ((loaded.inv && loaded.inv.order) || []).slice();
  m.bank.order = ((loaded.bank && loaded.bank.order) || []).slice();
  m.wear = Object.assign({}, loaded.wear || {});
  m.log = (loaded.log || []).slice(-60);

  ["inv", "bank"].forEach((w) => {
    Object.keys(m[w].items).forEach((k) => { if (!itemDef(k)) delete m[w].items[k]; });
    m[w].order = m[w].order.filter((k) => itemDef(k));
  });
  EQUIP_SLOTS.forEach((s) => { if (m.equipment[s] && !itemDef(m.equipment[s])) m.equipment[s] = null; });
  if (m.tasks.skilling && !findAction(m.tasks.skilling.skillId, m.tasks.skilling.actionId)) m.tasks.skilling = null;
  if (m.tasks.combat && !getMonster(m.tasks.combat.monsterId)) m.tasks.combat = null;
  if (!regionById(m.region)) m.region = "region_1";
  return m;
}

// Synchronous local boot, so the page paints instantly. If a Supabase
// session already exists (cookie/localStorage token from supabase-js),
// resumeCloudSession() below takes over a moment later and reconciles.
function bootLoad() {
  const accts = readAccounts();
  let newest = null;
  Object.keys(accts).forEach((u) => {
    const raw = localStorage.getItem(`${SAVE_PREFIX}_${u}`);
    if (!raw) return;
    try { const p = JSON.parse(raw); const ls = (p.meta && p.meta.lastSeen) || 0;
      if (!newest || ls > newest.ls) newest = { user: u, ls }; } catch (e) {}
  });
  const key = newest ? `${SAVE_PREFIX}_${newest.user}` : `${SAVE_PREFIX}_guest`;

  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) { raw = null; }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return null; }
  const last = (parsed.meta && parsed.meta.lastSeen) || Date.now();
  state = migrate(parsed);
  const gone = Date.now() - last;
  if (gone <= 30000) return null;
  return { ms: Math.min(gone, IDLE_CAP_MS), overCap: gone > IDLE_CAP_MS };
}

// Picks up an existing Supabase session on page refresh, so a signed-in
// player doesn't get dropped back to guest every reload.
async function resumeCloudSession() {
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;

  const userId = session.user.id;
  const { data: row, error } = await sb.from("saves").select("data, username, updated_at").eq("user_id", userId).single();
  if (error || !row) return;

  const last = (row.data && row.data.meta && row.data.meta.lastSeen) || Date.parse(row.updated_at) || Date.now();
  state = migrate(row.data);
  state.meta.account = row.username;
  state.meta.userId = userId;
  const gone = Date.now() - last;
  if (gone > 30000) catchUp({ ms: Math.min(gone, IDLE_CAP_MS), overCap: gone > IDLE_CAP_MS });
  refreshBounty();
  render();
}

function catchUp(result) {
  const step = 1000;
  let left = result.ms, guard = 0;
  const goldBefore = state.player.gold;
  const before = {};
  Object.keys(state.inv.items).forEach((k) => { before[k] = state.inv.items[k]; });

  while (left > 0 && (state.tasks.skilling || state.tasks.combat) && guard++ < 100000) {
    tick(Math.min(step, left));
    left -= step;
  }
  state.meta.playtimeMs += result.ms;

  const gains = [];
  Object.keys(state.inv.items).forEach((k) => {
    const d = state.inv.items[k] - (before[k] || 0);
    if (d > 0) gains.push(`${fmt(d)} ${itemName(k).toLowerCase()}`);
  });
  const goldGain = state.player.gold - goldBefore;
  if (goldGain > 0) gains.push(`${fmt(goldGain)} gold`);

  if (result.overCap && (state.tasks.skilling || state.tasks.combat)) {
    state.tasks.skilling = null;
    state.tasks.combat = null;
    say("Twelve hours passed and everything wound down. Set new orders.");
    toast("Idle limit reached — retask");
  }
  if (gains.length) say(`Away ${fmtTime(result.ms)}: ${gains.slice(0, 4).join(", ")}.`);
}

function exportSave() { state.meta.lastSeen = Date.now(); return btoa(unescape(encodeURIComponent(JSON.stringify(state)))); }

function importSave(str) {
  let json;
  try { json = decodeURIComponent(escape(atob((str || "").trim()))); } catch (e) { return "That isn't a Respite save."; }
  let parsed;
  try { parsed = JSON.parse(json); } catch (e) { return "Save string is corrupted."; }
  if (!parsed.skills) return "No character in that save.";
  const acct = state.meta.account, uid = state.meta.userId;
  state = migrate(parsed);
  state.meta.account = acct;
  state.meta.userId = uid;
  save();
  selected = null;
  render();
  return null;
}

/* ================= 22. RENDER ================= */

let keys = {};
let skillRefs = [], monsterRefs = [];

function render() { keys = {}; renderAll(); }

function renderAll() {
  renderTaskbar();
  renderWorldStrip();
  renderTabs();
  renderNav();
  if (tab === "skill") renderSkillView();
  if (tab === "atlas") renderAtlas();
  if (tab === "shop") renderShop();
  if (tab === "bounty") renderBounty();
  if (tab === "inventory") renderInventory();
  if (tab === "character") renderCharacter();
  if (tab === "kennel") renderKennel();
  renderLog();
}

function renderTaskbar() {
  el("goldText").textContent = fmt(state.player.gold);
  const hp = Math.max(0, Math.ceil(state.player.hp));
  el("hpFill").style.width = clamp((hp / maxHp()) * 100, 0, 100) + "%";
  el("hpText").textContent = `${hp}/${maxHp()}`;

  const sp = skillPlan();
  const sBar = el("tbSkillBar");
  if (sp) {
    el("tbSkillTitle").textContent = sp.def.name;
    sBar.classList.toggle("nojump", sp.pct < 6);
    sBar.style.width = sp.pct + "%";
    let line = `${fmt(sp.done)} / ${fmt(sp.target)} actions \u00B7 ${fmtTime(sp.timeLeft)} left`;
    if (sp.capped) line += " (stock)";
    if (state.tasks.skilling.queued) line += state.tasks.skilling.queued === "stop" ? " \u00B7 stopping" : " \u00B7 switching";
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
    line += cp.food ? ` \u00B7 food ${fmt(cp.foodHave)}/${fmt(cp.foodNeed)}` : " \u00B7 no provisions";
    if (state.tasks.combat.queued) line += " \u00B7 changing";
    el("tbCombatProj").textContent = line;
    el("tbCombatClear").classList.toggle("queued", !!state.tasks.combat.queued);
  } else {
    el("tbCombatTitle").textContent = "Idle";
    cBar.style.width = "0";
    el("tbCombatProj").textContent = state.unlocked.warfare
      ? "Choose a quarry in Warfare." : `Unlocks at total level ${WAR_UNLOCK_TOTAL} (now ${totalLevel()}).`;
    el("tbCombatClear").classList.remove("queued");
  }
}

function renderWorldStrip() {
  const w = currentWeather();
  el("wsWeather").innerHTML = icon(w.icon, "ico-sm") + `<span><b>${w.name}</b> \u00B7 ${w.note}</span>`;

  refreshBounty();
  const b = state.bounty;
  const bountyEl = el("wsBounty");
  if (b) {
    const done = b.claimed ? "claimed" : `${fmt(Math.min(b.progress, b.amount))}/${fmt(b.amount)}`;
    bountyEl.className = "ws-item" + (!b.claimed && b.progress >= b.amount ? " hot" : "");
    bountyEl.innerHTML = icon("scroll", "ico-sm") + `<span>Bounty <b>${done}</b> \u00B7 resets in ${fmtTime(windowEndsIn())}</span>`;
  } else bountyEl.innerHTML = "";

  const buffEl = el("wsBuff");
  if (state.buff && state.buff.until > Date.now()) {
    buffEl.className = "ws-item good";
    buffEl.innerHTML = `<span><b>Double experience</b> for ${fmtTime(state.buff.until - Date.now())}</span>`;
  } else buffEl.innerHTML = "";
}

function renderTabs() {
  if (keys.tabs === tab + skillView) return;
  keys.tabs = tab + skillView;
  document.querySelectorAll(".itab, .tabbtn").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  [["skill", "viewSkill"], ["atlas", "viewAtlas"], ["shop", "viewShop"], ["bounty", "viewBounty"],
   ["inventory", "viewInventory"], ["character", "viewCharacter"], ["kennel", "viewKennel"]]
    .forEach(([t, id]) => { el(id).hidden = tab !== t; });
}

function renderNav() {
  const sig = SKILLS.map((s) => s.id + skillLevel(s.id) + (state.unlocked[s.id] ? 1 : 0)).join(",") +
    "|" + skillView + "|" + tab + "|" + (state.tasks.skilling ? state.tasks.skilling.skillId : "-");
  if (keys.nav === sig) return;
  keys.nav = sig;

  const build = (box, list) => {
    box.innerHTML = "";
    list.forEach((s) => {
      if (!state.unlocked[s.id]) return;
      const b = document.createElement("button");
      b.className = "subbtn" + (tab === "skill" && skillView === s.id ? " on" : "") +
        (state.tasks.skilling && state.tasks.skilling.skillId === s.id ? " busy" : "");
      b.innerHTML = `<span class="subbtn-ico">${icon(s.icon, "ico-sm")}</span>` +
        `<span class="subbtn-name"></span><span class="subbtn-lvl"></span>`;
      b.querySelector(".subbtn-name").textContent = s.name;
      b.querySelector(".subbtn-lvl").textContent = "Lv. " + skillLevel(s.id);
      b.onclick = () => { skillView = s.id; tab = "skill"; render(); };
      box.appendChild(b);
    });
  };

  build(el("gatherNav"), SKILLS.filter((s) => s.kind === "gather"));
  build(el("craftNav"), SKILLS.filter((s) => s.kind === "craft"));
  build(el("warNav"), SKILLS.filter((s) => s.kind === "war"));
}

/* ---- skill / warfare view ---- */

function renderSkillView() {
  const s = skillDef(skillView) || skillDef("delving");
  const region = currentRegion();
  const lvl = skillLevel(s.id);
  const xp = state.skills[s.id] || 0;
  const base = XP_TABLE[lvl], next = XP_TABLE[Math.min(lvl + 1, MAX_LEVEL)];

  el("heroKicker").textContent = s.kind === "war" ? "Warfare" : (s.kind === "gather" ? `In ${region.name}` : "At camp");
  el("heroTitle").textContent = s.name;
  el("heroArt").innerHTML = icon(s.icon, "ico-xl tint-" + region.tier);
  el("skillLvl").textContent = "Lv. " + lvl;
  el("skillXpFill").style.width = clamp(lvl >= MAX_LEVEL ? 100 : ((xp - base) / (next - base)) * 100, 0, 100) + "%";
  el("skillXpText").textContent = `${fmt(xp)} / ${fmt(next)}`;

  const gs = GATHER_SKILLS.find((g) => g.id === s.id);
  const prof = PROFESSIONS.find((p) => p.id === s.id);
  el("heroNote").textContent = gs ? gs.note : prof ? prof.note
    : "Fights resolve on their own. Provisions get eaten automatically when you drop low.";

  const t = state.tasks.skilling, c = state.tasks.combat;
  const key = `${s.id}|${lvl}|${region.id}|${t ? t.skillId + t.actionId + (t.queued ? "q" : "") : "-"}|` +
    `${c ? c.monsterId + (c.queued ? "q" : "") : "-"}|${state.unlocked.warfare}`;
  if (keys.skill === key) { updateSkillCards(); updateMonsterCards(); return; }
  keys.skill = key;
  skillRefs = []; monsterRefs = [];

  const box = el("skillCards");
  box.innerHTML = "";

  if (s.kind === "war") {
    if (!state.unlocked.warfare) {
      const p = document.createElement("p");
      p.className = "view-note";
      p.textContent = `Warfare unlocks at total level ${WAR_UNLOCK_TOTAL}. You are ${totalLevel()}.`;
      box.appendChild(p);
    } else {
      box.appendChild(buildMonsterCard(monsterOfTier(region.tier)));
    }
  } else if (gs) {
    // One node, for the region you're standing in. Change region in the Atlas.
    box.appendChild(buildActionCard(GATHER_ACTIONS[s.id][region.tier - 1], s.id));
    const hint = document.createElement("p");
    hint.className = "view-note";
    hint.textContent = "One seam per region. Move in the Atlas to work richer ground.";
    box.appendChild(hint);
  } else {
    actionsFor(s.id).filter((a) => a.level <= lvl + 20)
      .forEach((def) => box.appendChild(buildActionCard(def, s.id)));
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
  top.innerHTML = icon(def.icon, "tint-" + (def.tier || 1)) + '<span class="card-name"></span>';
  top.querySelector(".card-name").textContent = def.name;
  card.appendChild(top);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const time = actionTime(def);
  meta.textContent = locked ? `Requires ${skillName(skillId)} ${def.level}`
    : `Lv. ${def.level} \u00B7 ${(time / 1000).toFixed(0)}s \u00B7 ${fmt(def.xp)} xp` +
      (time !== def.time ? " (weather)" : "");
  card.appendChild(meta);

  let costEl = null;
  if (def.cost && !locked) { costEl = document.createElement("div"); costEl.className = "card-cost"; card.appendChild(costEl); }
  let planEl = null;
  if (!locked) { planEl = document.createElement("div"); planEl.className = "card-plan"; card.appendChild(planEl); }

  const prog = document.createElement("div");
  prog.className = "card-prog";
  card.appendChild(prog);

  card.onclick = () => selectSkillAction(skillId, def.id);
  skillRefs.push({ def, skillId, costEl, planEl, prog });
  return card;
}

function updateSkillCards() {
  const t = state.tasks.skilling;
  skillRefs.forEach((ref) => {
    const time = actionTime(ref.def);
    if (ref.costEl) {
      ref.costEl.innerHTML = "";
      ref.costEl.appendChild(document.createTextNode("Needs "));
      Object.keys(ref.def.cost).forEach((k, i) => {
        const sp = document.createElement("span");
        if (haveQty(k) < ref.def.cost[k]) sp.className = "short";
        sp.textContent = `${i ? ", " : ""}${ref.def.cost[k]}\u00D7 ${itemName(k).toLowerCase()} (${fmt(haveQty(k))})`;
        ref.costEl.appendChild(sp);
      });
    }
    if (ref.planEl) {
      const per12h = Math.floor(IDLE_CAP_MS / time);
      let line = `12h idle: ${fmt(per12h)} actions, ${fmt(per12h * ref.def.xp)} xp`;
      if (ref.def.cost) {
        let byMats = Infinity;
        Object.keys(ref.def.cost).forEach((k) => { byMats = Math.min(byMats, Math.floor(haveQty(k) / ref.def.cost[k])); });
        if (byMats < per12h) line += ` \u2014 stock covers ${fmt(byMats)}`;
      }
      const lvl = skillLevel(ref.skillId);
      if (lvl < MAX_LEVEL) {
        const need = XP_TABLE[lvl + 1] - (state.skills[ref.skillId] || 0);
        line += ` \u00B7 next level in ${fmt(Math.ceil(need / (ref.def.xp * xpMult())))}`;
      }
      ref.planEl.textContent = line;
    }
    const isActive = t && t.skillId === ref.skillId && t.actionId === ref.def.id;
    if (isActive) {
      const pct = clamp((t.progress / time) * 100, 0, 100);
      ref.prog.classList.toggle("nojump", pct < 6);
      ref.prog.style.width = pct + "%";
    } else ref.prog.style.width = "0";
  });
}

function buildMonsterCard(mob) {
  const t = state.tasks.combat;
  const active = !!(t && t.monsterId === mob.id && (!t.queued || t.queued === "stop"));
  const card = document.createElement("button");
  card.className = "card" + (active ? " on" : "");

  const top = document.createElement("div");
  top.className = "card-top";
  top.innerHTML = icon(mob.icon, "tint-" + mob.tier) + '<span class="card-name"></span>';
  top.querySelector(".card-name").textContent = mob.name;
  card.appendChild(top);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = `Lv. ${mob.level} \u00B7 ${fmt(mob.hp)} hp \u00B7 ${fmt(mob.attack)} atk \u00B7 ${fmt(mob.xp)} xp`;
  card.appendChild(meta);

  const drops = document.createElement("div");
  drops.className = "card-cost";
  drops.textContent = "Leaves " + mob.drops.map(([k]) => itemName(k).toLowerCase()).join(", ");
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
    const avg = Math.max(1, (atk * 0.55 + atk) / 2 - ref.mob.defence * 0.35);
    const killMs = (ref.mob.hp / avg) * PLAYER_SWING_MS + RESPAWN_MS;
    ref.plan.textContent = `~${fmtTime(killMs)} a kill \u00B7 ${fmt(Math.floor(IDLE_CAP_MS / killMs))} per 12h idle`;
    const isActive = t && t.monsterId === ref.mob.id;
    if (isActive) {
      ref.hpFill.style.width = clamp((t.mobHp / t.mobMax) * 100, 0, 100) + "%";
      const swing = t.respawn > 0 ? 0 : (1 - t.playerTimer / PLAYER_SWING_MS) * 100;
      ref.prog.classList.toggle("nojump", swing < 6);
      ref.prog.style.width = clamp(swing, 0, 100) + "%";
    } else { ref.hpFill.style.width = "100%"; ref.prog.style.width = "0"; }
  });
}

/* ---- atlas ---- */

function renderAtlas() {
  const key = state.region + "|" + state.travel.unlocked.join(",") + "|" + Math.floor(state.player.gold / 50);
  if (keys.atlas === key) return;
  keys.atlas = key;

  const box = el("atlasList");
  box.innerHTML = "";
  REGIONS.forEach((r) => {
    const unlocked = state.travel.unlocked.includes(r.id);
    const here = state.region === r.id;
    const card = document.createElement("button");
    card.className = "atlas-card" + (here ? " on" : "") + (unlocked ? "" : " locked");

    const top = document.createElement("div");
    top.className = "atlas-top";
    top.innerHTML = icon("atlas", "tint-" + r.tier) +
      '<span class="atlas-name"></span><span class="atlas-tier"></span>';
    top.querySelector(".atlas-name").textContent = r.name;
    top.querySelector(".atlas-tier").textContent = `Lv. ${r.level}`;
    card.appendChild(top);

    const note = document.createElement("div");
    note.className = "atlas-note";
    note.textContent = r.note;
    card.appendChild(note);

    const foot = document.createElement("div");
    if (here) { foot.className = "atlas-here"; foot.textContent = "You are here"; }
    else if (unlocked) { foot.className = "atlas-cost"; foot.textContent = "Road open — travel free"; }
    else {
      foot.className = "atlas-cost" + (state.player.gold < r.toll ? " cant" : "");
      foot.textContent = `Toll ${fmt(r.toll)} gold`;
    }
    card.appendChild(foot);

    card.onclick = () => travelTo(r.id);
    box.appendChild(card);
  });
}

/* ---- shop ---- */

function renderShop() {
  const key = `${state.player.gold}|${currentWindow()}|${JSON.stringify(state.smugglerBought)}`;
  if (keys.shop === key) { el("smugglerTimer").textContent = `— moves on in ${fmtTime(windowEndsIn())}`; return; }
  keys.shop = key;

  el("shopGold").textContent = `${fmt(state.player.gold)} gold on hand`;
  el("smugglerTimer").textContent = `— moves on in ${fmtTime(windowEndsIn())}`;
  el("smugglerNote").textContent = "Turns up on the world clock twice a day with whatever fell off the back of something. One purchase per visit.";

  const stock = el("shopStock");
  stock.innerHTML = "";
  shopStock().forEach((entry) => {
    const d = itemDef(entry.key);
    const card = document.createElement("div");
    card.className = "card flat";
    card.innerHTML = icon(d.icon, "tint-" + d.tier) === "" ? "" : "";

    const top = document.createElement("div");
    top.className = "card-top";
    top.innerHTML = icon(d.icon, "tint-" + d.tier) + '<span class="card-name"></span>';
    top.querySelector(".card-name").textContent = d.name;
    card.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = `Restores ${fmt(d.heal)} health \u00B7 ${fmt(entry.price)} gold each`;
    card.appendChild(meta);

    const row = document.createElement("div");
    row.className = "btnrow";
    row.style.marginTop = "9px";
    [1, 10, 50].forEach((n) => {
      const b = document.createElement("button");
      b.className = "btn btn-gold";
      b.textContent = `Buy ${n} (${fmt(entry.price * n)}g)`;
      b.disabled = state.player.gold < entry.price * n;
      b.onclick = () => buyShop(entry.key, entry.price * n, n);
      row.appendChild(b);
    });
    card.appendChild(row);
    stock.appendChild(card);
  });

  const sm = el("smugglerStock");
  sm.innerHTML = "";
  smugglerStock().forEach((entry) => {
    const d = itemDef(entry.key);
    const bought = !!state.smugglerBought[`${currentWindow()}_${entry.slot}`];
    const card = document.createElement("div");
    card.className = "card flat";

    const top = document.createElement("div");
    top.className = "card-top";
    top.innerHTML = icon(d.icon, "tint-" + d.tier) + '<span class="card-name"></span>';
    top.querySelector(".card-name").textContent = `${entry.qty}\u00D7 ${d.name}`;
    card.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = `Tier ${d.tier} \u00B7 ${fmt(entry.price)} gold the lot`;
    card.appendChild(meta);

    const b = document.createElement("button");
    b.className = "btn btn-gold";
    b.style.marginTop = "9px";
    b.textContent = bought ? "Already dealt" : `Buy (${fmt(entry.price)}g)`;
    b.disabled = bought || state.player.gold < entry.price;
    b.onclick = () => buySmuggler(entry);
    card.appendChild(b);
    sm.appendChild(card);
  });
}

/* ---- bounty ---- */

function renderBounty() {
  refreshBounty();
  const b = state.bounty;
  el("bountyTimer").textContent = `New posting in ${fmtTime(windowEndsIn())}`;
  const box = el("bountyBox");
  const key = JSON.stringify(b);
  if (keys.bounty === key) return;
  keys.bounty = key;

  box.innerHTML = "";
  if (!b) return;

  const card = document.createElement("div");
  card.className = "bounty-card";

  const h = document.createElement("h3");
  h.className = "bounty-title";
  h.textContent = b.label;
  card.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "muted tiny";
  sub.textContent = `Posted for ${regionById(b.region).name}.`;
  card.appendChild(sub);

  const bar = document.createElement("div");
  bar.className = "bounty-prog";
  const fill = document.createElement("div");
  fill.style.width = clamp((b.progress / b.amount) * 100, 0, 100) + "%";
  bar.appendChild(fill);
  card.appendChild(bar);

  const rew = document.createElement("div");
  rew.className = "bounty-reward";
  rew.textContent = `${fmt(Math.min(b.progress, b.amount))} of ${fmt(b.amount)} \u00B7 pays ${fmt(b.gold)} gold and one hour of double experience.`;
  card.appendChild(rew);

  const btn = document.createElement("button");
  btn.className = "btn btn-gold";
  btn.style.marginTop = "11px";
  btn.textContent = b.claimed ? "Paid out" : (b.progress >= b.amount ? "Claim" : "Not finished");
  btn.disabled = b.claimed || b.progress < b.amount;
  btn.onclick = claimBounty;
  card.appendChild(btn);

  box.appendChild(card);
}

/* ---- inventory ---- */

function renderInventory() {
  const s = store(storeView);
  const ids = orderedKeys(storeView);
  const key = `${storeView}|${ids.map((k) => k + ":" + s.items[k]).join(",")}|${slotCap(storeView)}|${selected}|${state.player.gold}`;
  if (keys.inv !== key) {
    keys.inv = key;
    el("storeTitle").textContent = storeView === "inv" ? "Pack" : "Vault";
    el("storeCount").textContent = `${slotsUsed(storeView)} / ${slotCap(storeView)} slots`;
    el("storeNote").textContent = storeView === "inv"
      ? "What you carry. Fill it and your work stops."
      : "Camp storage. Banded chests from the Woodwright widen it.";
    renderGrid(ids);
    renderDetail();
  }
  const eKey = EQUIP_SLOTS.map((sl) => sl + ":" + state.equipment[sl] + ":" + (state.wear[state.equipment[sl]] || 0)).join(",");
  if (keys.equip !== eKey) { keys.equip = eKey; renderEquip(); }
}

function renderGrid(ids) {
  const grid = el("invGrid");
  grid.innerHTML = "";
  const s = store(storeView);
  const cap = slotCap(storeView);

  for (let i = 0; i < cap; i++) {
    const key = ids[i];
    const d = key ? itemDef(key) : null;
    const cell = document.createElement("div");
    cell.className = "cell" + (key ? "" : " empty") + (key === selected ? " on" : "") +
      (d && d.rarity && d.rarity !== "common" ? ` r-${d.rarity}` : "");
    cell.tabIndex = key ? 0 : -1;

    if (key) {
      cell.innerHTML = icon(d.icon, "ico-lg tint-" + (d.tier || 1));
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
  head.className = "detail-head";
  head.innerHTML = icon(d.icon, "tint-" + (d.tier || 1));
  const nm = document.createElement("span");
  nm.className = "dname" + (d.rarity ? " rar-" + d.rarity : "");
  nm.textContent = itemName(selected);
  head.appendChild(nm);
  const sub = document.createElement("span");
  sub.className = "muted tiny";
  sub.textContent = `\u00D7${fmt(qty)} \u00B7 ${fmt(d.value)}g each`;
  head.appendChild(sub);
  box.appendChild(head);

  const bits = [];
  if (d.attack) bits.push(`+${d.attack} attack`);
  if (d.defence) bits.push(`+${d.defence} defence`);
  if (d.health) bits.push(`+${d.health} max hp`);
  if (d.heal) bits.push(`restores ${d.heal}`);
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
  if (d.chest) add("Open chest", () => useChest(selected));
  add(storeView === "inv" ? "To vault" : "To pack", () => transfer(selected, false));
  add(storeView === "inv" ? "All to vault" : "All to pack", () => transfer(selected, true), "btn-quiet");
  const sv = salvageValue(selected);
  if (sv) add(`Break down (${sv.qty}\u00D7 ${itemName(sv.mat).toLowerCase()})`, () => salvage(selected), "btn-quiet");
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
      name.textContent = itemName(key);
      if (d.rarity && d.rarity !== "common") name.classList.add("rar-" + d.rarity);
    } else { name.textContent = "Empty"; name.classList.add("muted"); }
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
          fix.disabled = haveQty(cost.mat) < cost.qty;
          fix.title = `Repair with ${cost.qty} ${itemName(cost.mat).toLowerCase()}`;
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

/* ---- character ---- */

function renderCharacter() {
  const key = SKILLS.map((s) => s.id + (state.skills[s.id] || 0)).join(",") + "|" +
    EQUIP_SLOTS.map((s) => state.equipment[s]).join(",") + "|" + state.stats.kills;
  if (keys.char === key) return;
  keys.char = key;

  el("charSub").textContent = `Total level ${totalLevel()} of ${SKILLS.length * MAX_LEVEL}`;

  const box = el("statList");
  box.innerHTML = "";
  const rows = [
    ["Attack", Math.round(attackPower())], ["Defence", Math.round(defencePower())],
    ["Max health", maxHp()], ["Warfare level", skillLevel("warfare")],
    ["sep"],
    ["Kills", fmt(state.stats.kills)], ["Actions worked", fmt(state.stats.actions)],
    ["Items crafted", fmt(state.stats.crafted)], ["Epic rolls", fmt(state.stats.epics)],
    ["Deaths", fmt(state.stats.deaths)], ["Gold earned", fmt(state.stats.goldEarned)],
    ["Time played", fmtTime(state.meta.playtimeMs)],
  ];
  rows.forEach((r) => {
    const d = document.createElement("div");
    d.className = "statrow" + (r[0] === "sep" ? " sep" : "");
    if (r[0] === "sep") { box.appendChild(d); return; }
    d.innerHTML = "<span></span><span></span>";
    d.children[0].textContent = r[0];
    d.children[1].textContent = r[1];
    box.appendChild(d);
  });

  const table = el("skillTable");
  table.innerHTML = "";
  SKILLS.forEach((s) => {
    const lvl = skillLevel(s.id);
    const xp = state.skills[s.id] || 0;
    const base = XP_TABLE[lvl], next = XP_TABLE[Math.min(lvl + 1, MAX_LEVEL)];
    const row = document.createElement("div");
    row.className = "skillrow";
    row.innerHTML = `<span>${icon(s.icon, "ico-sm")}</span><span></span><span class="sr-lvl"></span>` +
      '<span class="bar"><div></div></span><span class="sr-xp"></span>';
    row.children[1].textContent = s.name;
    row.children[2].textContent = "Lv. " + lvl;
    row.children[3].firstChild.style.width =
      clamp(lvl >= MAX_LEVEL ? 100 : ((xp - base) / (next - base)) * 100, 0, 100) + "%";
    row.children[4].textContent = lvl >= MAX_LEVEL ? "max" : `${fmt(xp)} / ${fmt(next)}`;
    table.appendChild(row);
  });
}

/* ---- kennel ---- */

function renderKennel() {
  const key = JSON.stringify(state.pets) + state.player.gold;
  if (keys.kennel === key) return;
  keys.kennel = key;

  const box = el("petList");
  box.innerHTML = "";
  PETS.forEach((pet) => {
    const owned = state.pets[pet.id];
    const card = document.createElement("div");
    card.className = "card flat" + (owned ? " on" : "");

    const top = document.createElement("div");
    top.className = "card-top";
    top.innerHTML = icon(pet.icon, "ico-lg") + '<span class="card-name"></span>';
    top.querySelector(".card-name").textContent = pet.name;
    card.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = pet.note;
    card.appendChild(meta);

    const b = document.createElement("button");
    b.className = "btn btn-gold";
    b.style.marginTop = "9px";
    b.textContent = owned ? "In the kennel" : `Buy (${fmt(pet.cost)}g)`;
    b.disabled = owned || state.player.gold < pet.cost;
    b.onclick = () => buyPet(pet.id);
    card.appendChild(b);
    box.appendChild(card);
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

/* ================= 23. WIRING ================= */

el("brandMark").innerHTML = icon("moon");
el("coinIcon").innerHTML = icon("coin", "ico-sm");
el("icoAtlas").innerHTML = icon("atlas", "ico-sm");
el("icoShop").innerHTML = icon("shop", "ico-sm");
el("icoBounty").innerHTML = icon("scroll", "ico-sm");
el("icoInv").innerHTML = icon("pack", "ico-sm");
el("icoChar").innerHTML = icon("person", "ico-sm");
el("icoKennel").innerHTML = icon("paw", "ico-sm");

document.querySelectorAll(".itab, .tabbtn").forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
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
  say(t.queued ? "Will stop once this action finishes." : "Stop cancelled.");
  render();
};
el("tbCombatClear").onclick = () => {
  const t = state.tasks.combat;
  if (!t) return;
  t.queued = t.queued === "stop" ? null : "stop";
  say(t.queued ? "Will stop once this fight finishes." : "Stop cancelled.");
  render();
};

el("settingsBtn").onclick = () => { el("shareBox").value = exportSave(); refreshAccountUi(); el("settingsModal").hidden = false; };
el("settingsClose").onclick = () => { el("settingsModal").hidden = true; };

function refreshAccountUi() {
  const a = state.meta.account;
  const cloud = !!sb;
  el("acctStatus").textContent = a
    ? `Signed in as ${a}${cloud ? " (cloud)" : " (this browser only)"}. Autosaving.`
    : cloud
      ? "Playing as a guest. Create an account to play from any device."
      : "Playing as a guest, this browser only. Paste a Supabase anon key into index.html to enable cloud accounts.";
  el("acctFields").hidden = !!a;
  el("acctCreate").hidden = !!a;
  el("acctLogin").hidden = !!a;
  el("acctLogout").hidden = !a;
  el("acctNote").textContent = cloud
    ? "Accounts sync through Supabase — sign in from any device to keep playing the same character."
    : "Local-only mode. Move between devices with the save string below until cloud accounts are set up.";
}

el("acctCreate").onclick = async () => {
  el("acctCreate").disabled = true;
  el("acctNote").textContent = "Working...";
  const err = await createAccount(el("acctUser").value, el("acctPass").value);
  el("acctCreate").disabled = false;
  el("acctNote").textContent = err || `Account made. Signed in as ${state.meta.account}.`;
  if (!err) { el("acctPass").value = ""; refreshAccountUi(); render(); }
};
el("acctLogin").onclick = async () => {
  el("acctLogin").disabled = true;
  el("acctNote").textContent = "Working...";
  const err = await loginAccount(el("acctUser").value, el("acctPass").value);
  el("acctLogin").disabled = false;
  el("acctNote").textContent = err || `Signed in as ${state.meta.account}.`;
  if (!err) { el("acctPass").value = ""; refreshAccountUi(); }
};
el("acctLogout").onclick = async () => { await logoutAccount(); refreshAccountUi(); };

el("shareCopy").onclick = () => {
  const box = el("shareBox");
  box.select();
  navigator.clipboard.writeText(box.value).then(() => toast("Save string copied")).catch(() => toast("Select and copy manually"));
};
el("shareLoad").onclick = () => {
  if (!confirm("Loading a save replaces your current character. Continue?")) return;
  toast(importSave(el("shareBox").value) || "Save loaded");
};
el("saveBtn").onclick = () => { if (save()) el("saveNote").textContent = "Saved at " + new Date().toLocaleTimeString() + "."; };
el("wipeBtn").onclick = () => {
  if (!confirm("Delete this save permanently?")) return;
  try { localStorage.removeItem(saveKey()); } catch (e) {}
  location.reload();
};

/* ================= 24. BOOT + LOOP ================= */

const away = bootLoad();
if (away) catchUp(away);
refreshBounty();
if (state.log.length === 0) say("You put your pack down on dead ground and start clearing a place to work.");

render();
resumeCloudSession();

let lastTick = Date.now();

function loop() {
  const now = Date.now();
  const dt = now - lastTick;
  lastTick = now;
  if (dt > 0) { tick(Math.min(dt, 60000)); state.meta.playtimeMs += Math.min(dt, 60000); }

  renderTaskbar();
  renderWorldStrip();
  if (tab === "skill") { updateSkillCards(); updateMonsterCards(); }
  if (tab === "inventory") renderInventory();
  renderNav();
  renderLog();
}

setInterval(loop, 60);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { lastTick = Date.now(); render(); } });
setInterval(save, 10000);
window.addEventListener("beforeunload", save);
