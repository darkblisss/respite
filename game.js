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

const STRATA = [
  { key: "scavenged", name: "Scavenged", tiers: [1, 2, 3] },
  { key: "barrow",    name: "Barrow",    tiers: [4, 5, 6] },
  { key: "sovereign", name: "Sovereign", tiers: [7, 8, 9] },
];
const stratumOf = (tier) => STRATA.find((s) => s.tiers.includes(tier)) || STRATA[0];

const TIERS = [
  { i: 1, level: 1,  time: 12000, xp: 1,  fell: "Bitter Brush",    delve: "Slag Ore",       harvest: "Stink Weed",     flay: "Mangy Pelt",         dredge: "Mud Pebble" },
  { i: 2, level: 10, time: 20000, xp: 3,  fell: "Blood Ash",       delve: "Bog Ore",        harvest: "Grave Moss",     flay: "Bristle Pelt",       dredge: "River Amber" },
  { i: 3, level: 20, time: 29000, xp: 6,  fell: "Iron Bark",       delve: "Cold Ore",       harvest: "Pale Rush",      flay: "Dire Pelt",          dredge: "Cave Agate" },
  { i: 4, level: 30, time: 38000, xp: 10, fell: "Barrow Pine",     delve: "Cairn Steel",    harvest: "Corpse Bloom",   flay: "Cured Hide",         dredge: "Mourning Quartz" },
  { i: 5, level: 40, time: 48000, xp: 15, fell: "Sallow Timber",   delve: "Crucible Steel", harvest: "Widows Bloom",   flay: "Scaled Hide",        dredge: "Ghost Opal" },
  { i: 6, level: 50, time: 58000, xp: 22, fell: "Umber Heartwood", delve: "Star Steel",     harvest: "Dragon Bloom",   flay: "Chitin Hide",        dredge: "Blood Ruby" },
  { i: 7, level: 60, time: 69000, xp: 30, fell: "Wyrm Root",       delve: "Wyrm Core",      harvest: "Moon Frond",     flay: "Drake Carapace",     dredge: "Abyssal Coral" },
  { i: 8, level: 70, time: 80000, xp: 39, fell: "Void Root",       delve: "Void Core",      harvest: "Fade Frond",     flay: "Leviathan Carapace", dredge: "Leviathan Bone" },
  { i: 9, level: 80, time: 92000, xp: 49, fell: "Godsdown Knot",   delve: "Titan Core",     harvest: "Godsbane Frond", flay: "Demon Carapace",     dredge: "Void Sapphire" },
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
  { id: "forgemaster", name: "Forgemaster", icon: "plate", from: "delving", mat: "delve", weight: "Heavy",
    note: "Heavy plate and steel from Delving. Slow, unglamorous, and the only thing that holds a line.",
    pieces: [
      { key: "blade",      label: "Blade",      slot: "weapon",  icon: "blade",      atk: 1.0,  def: 0.15, qty: 3, off: 0 },
      { key: "greatblade", label: "Greatblade", slot: "weapon",  icon: "greatblade", atk: 1.75, def: 0,    qty: 5, off: 6, twoHanded: true },
      { key: "coif",       label: "Coif",       slot: "head",    icon: "cowl",       atk: 0,    def: 0.55, qty: 2, off: 2 },
      { key: "harness",    label: "Harness",    slot: "chest",   icon: "plate",      atk: 0,    def: 1.0,  qty: 4, off: 4 },
      { key: "greaves",    label: "Greaves",    slot: "feet",    icon: "greaves",    atk: 0,    def: 0.7,  qty: 3, off: 3 },
    ] },
  { id: "woodwright", name: "Woodwright", icon: "ward", from: "felling", mat: "fell", weight: "Heavy",
    note: "Wards and focus staves from Felling. Also the banded chests that widen your stores.",
    pieces: [
      { key: "ward",  label: "Ward",  slot: "offhand", icon: "ward",  atk: 0,   def: 0.9, qty: 3, off: 1 },
      { key: "stave", label: "Stave", slot: "weapon",  icon: "stave", atk: 1.2, def: 0.3, qty: 4, off: 4, twoHanded: true },
    ] },
  { id: "tanner", name: "Tanner", icon: "treads", from: "flaying", mat: "flay", weight: "Medium",
    note: "Medium leather from Flaying. Gambesons, treads and grips — quick, quiet, and always wearing out.",
    pieces: [
      { key: "treads",   label: "Treads",   slot: "feet",  icon: "treads",    atk: 0,    def: 0.45, qty: 2, off: 0 },
      { key: "grips",    label: "Grips",    slot: "hands", icon: "gauntlets", atk: 0.18, def: 0.32, qty: 2, off: 1 },
      { key: "gambeson", label: "Gambeson", slot: "chest", icon: "shroud",    atk: 0.1,  def: 0.7,  qty: 3, off: 3 },
    ] },
  { id: "weaver", name: "Weaver", icon: "cowl", from: "harvesting", mat: "harvest", weight: "Light",
    note: "Light woven cloth from Harvesting. Almost no defence, but it carries the life in it.",
    pieces: [
      { key: "cowl",   label: "Cowl",   slot: "head",  icon: "cowl",   atk: 0,    def: 0.3,  qty: 2, off: 0, hp: 0.8 },
      { key: "shroud", label: "Shroud", slot: "chest", icon: "shroud", atk: 0.18, def: 0.4,  qty: 4, off: 3, hp: 1.2 },
      { key: "wraps",  label: "Wraps",  slot: "hands", icon: "gauntlets", atk: 0.22, def: 0.15, qty: 2, off: 1, hp: 0.4 },
    ] },
  { id: "artificer", name: "Artificer", icon: "charm", from: "dredging", mat: "dredge", weight: "Relic",
    note: "Bands and charms from Dredging. Small things that quietly change the arithmetic.",
    pieces: [
      { key: "band",  label: "Band",  slot: "ring", icon: "band",  atk: 0.55, def: 0,   qty: 3, off: 2, hp: 0.4 },
      { key: "charm", label: "Charm", slot: "neck", icon: "charm", atk: 0.22, def: 0.2, qty: 3, off: 5, hp: 1.4 },
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

// Provisions are bought, not crafted — a placeholder until an Apothecary
// or Camp Cook profession exists. bestFood() picks the strongest you hold.
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
  tier: p.tier, heal: p.heal, value: Math.round(p.price * 0.4), price: p.price,
  smuggler: !!p.smuggler,
}));
RATIONS.forEach((r) => { MATERIALS[r.id] = r; });

MATERIALS.vault_chest = { id: "vault_chest", name: "Banded Chest", icon: "crate", kind: "material", value: 600, chest: 5, tier: 2 };

PROFESSIONS.forEach((prof) => {
  TIERS.forEach((t) => {
    prof.pieces.forEach((piece) => {
      const id = `${slug(t[prof.mat])}_${piece.key}`;
      const power = Math.round(4 * Math.pow(1.52, t.i - 1));
      GEAR[id] = {
        id, name: titleCase(`${t[prof.mat]} ${piece.label}`), icon: piece.icon, kind: "gear",
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

// Common gear stacks. Uncommon and above gets a unique instance id so each
// piece occupies its own slot and carries its own wear. Tools and materials
// have no rarity at all, so they always stack.
function makeKey(base, rarity) {
  if (!rarity) return base;
  if (rarity === "common") return `${base}|common`;
  return `${base}|${rarity}|${state.uid++}`;
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
  .concat([{ id: "warfare", name: "Combat", icon: "swords", kind: "war" }]);

const skillDef = (id) => SKILLS.find((s) => s.id === id);
const skillName = (id) => (skillDef(id) ? skillDef(id).name : id);

const GATHER_ACTIONS = {};
GATHER_SKILLS.forEach((s) => {
  GATHER_ACTIONS[s.id] = TIERS.map((t) => ({
    id: `${s.id}_t${t.i}`, skillId: s.id, tier: t.i,
    name: titleCase(`${t[s.mat]} ${s.node}`), icon: s.matIcon,
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
  name: "Banded Chest", icon: "crate", level: 12, time: 45000, xp: 8,
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


const REGIONS = TIERS.map((t, i) => ({
  id: `region_${t.i}`, tier: t.i, name: REGION_NAMES[i][0], note: REGION_NAMES[i][1],
  level: t.level, toll: TOLLS[i],
}));

/* Each region fields a roster: a Grunt you'll see most of the time, an
   Elite that hits harder, and a Sovereign that only shows up once the
   region's Threat has built to boiling point. */

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
    id: `mob_t${t.i}_${rank}`, tier: t.i, rank,
    name: nameIcon[0], icon: nameIcon[1],
    level: t.level + (rank === "elite" ? 4 : rank === "boss" ? 8 : 0),
    hp: Math.round(16 * s * mul.hp),
    attack: Math.round(4 * s * mul.atk),
    defence: Math.round(1.6 * s * mul.def),
    speed: rank === "elite" ? 2600 : rank === "boss" ? 3000 : 3000,
    xp: Math.round(t.xp * 2.6 * mul.xp),
    gold: [Math.round(3 * s * mul.gold), Math.round(8 * s * mul.gold)],
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

// 80% grunt, 20% elite — unless the region has boiled over, then the
// Sovereign takes the field and the Threat resets when it dies.
function rollSpawn(tier) {
  if (threatIn(tier) >= THREAT_CAP) return rankOf(tier, "boss");
  return rankOf(tier, Math.random() < 0.2 ? "elite" : "grunt");
}

const regionById = (id) => REGIONS.find((r) => r.id === id) || REGIONS[0];
const monsterOfTier = (tier) => rankOf(tier, "grunt");
const getMonster = (id) => MONSTERS.find((m) => m.id === id) || null;

/* ================= 11. WEATHER (weekly rotation, world clock) ================= */
/* Fixed to the UTC day of week, so it's predictable and everyone shares it.
   Weekends are bountiful — normal speed, extra experience. */

const WEATHER_WEEK = [
  { id: "bountiful", name: "Bountiful Rest", icon: "sun",
    note: "The camp works in good spirits. Every trade earns more.", xp: 1.2, mods: {} },                      // Sun
  { id: "fog", name: "Grave Fog", icon: "fog",
    note: "Flaying and Harvesting drag. Delving is untroubled underground.", xp: 1,
    mods: { flaying: 1.1, harvesting: 1.1, delving: 0.9 } },                                                   // Mon
  { id: "rain", name: "Rain", icon: "rain",
    note: "Dredging runs quick. Felling bogs down.", xp: 1,
    mods: { dredging: 0.9, felling: 1.1 } },                                                                   // Tue
  { id: "clear", name: "Clear Skies", icon: "sun",
    note: "Nothing helping, nothing hindering.", xp: 1, mods: {} },                                            // Wed
  { id: "frost", name: "Hard Frost", icon: "fog",
    note: "Open ground stiffens. Forge work goes faster in the heat.", xp: 1,
    mods: { felling: 1.1, harvesting: 1.1, forgemaster: 0.9 } },                                               // Thu
  { id: "swelter", name: "Swelter", icon: "sun",
    note: "Camp work drags in the heat. The cold water is a relief.", xp: 1,
    mods: { forgemaster: 1.1, woodwright: 1.1, dredging: 0.9 } },                                              // Fri
  { id: "bountiful", name: "Bountiful Rest", icon: "sun",
    note: "The camp works in good spirits. Every trade earns more.", xp: 1.2, mods: {} },                      // Sat
];

function weatherOn(dayOffset) {
  const d = new Date(Date.now() + (dayOffset || 0) * DAY_MS);
  return WEATHER_WEEK[d.getUTCDay()];
}
const currentWeather = () => weatherOn(0);

function serverClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

/* ================= 12. MASTERY ================= */
/* Levelling a skill permanently improves it. No item, no choice — it just
   gets better as a reward for the grind. */

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

/* ================= 13. TOOLS ================= */
/* One tool per gathering skill, forged from ore. Pure speed. */

const TOOL_SPEC = {
  delving:    { key: "pick",   label: "Pick",   icon: "pick" },
  felling:    { key: "axe",    label: "Axe",    icon: "axe" },
  harvesting: { key: "sickle", label: "Sickle", icon: "sickle" },
  flaying:    { key: "knife",  label: "Knife",  icon: "knife" },
  dredging:   { key: "net",    label: "Drag",   icon: "net" },
};

const TOOLS = {};
TIERS.forEach((t) => {
  Object.keys(TOOL_SPEC).forEach((skillId) => {
    const spec = TOOL_SPEC[skillId];
    const id = `${slug(t.delve)}_${spec.key}`;
    TOOLS[id] = {
      id, name: titleCase(`${t.delve} ${spec.label}`), icon: spec.icon, kind: "tool",
      forSkill: skillId, tier: t.i,
      speed: 0.04 + t.i * 0.02,                 // tier 1 = 6% faster, tier 9 = 22%
      value: Math.round(60 * Math.pow(2.1, t.i - 1)),
    };
    CRAFT_ACTIONS.forgemaster.push({
      id: `craft_${id}`, skillId: "forgemaster", tier: t.i,
      name: TOOLS[id].name, icon: spec.icon,
      level: t.level + 1, time: Math.round(t.time * 1.1), xp: Math.round(t.xp * 1.8) + 1,
      cost: { [matId(t, "delve")]: 3 },
      out: { [id]: 1 },
    });
  });
});

function toolFor(skillId) {
  const id = state.tools && state.tools[skillId];
  return id ? TOOLS[id] : null;
}

/* ================= 14. SPEED + YIELD ================= */

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

// A thin chance the ground gives up something from the tier above.
const RICH_FIND_CHANCE = 0.015;
function richFind(def) {
  if (!GATHER_ACTIONS[def.skillId] || def.tier >= TIERS.length) return null;
  const gs = GATHER_SKILLS.find((s) => s.id === def.skillId);
  return matId(TIERS[def.tier], gs.mat);
}

/* ================= 15. STATE ================= */

let state = freshState();

function freshState() {
  const skills = {};
  SKILLS.forEach((s) => { skills[s.id] = 0; });
  const equipment = {};
  EQUIP_SLOTS.forEach((s) => { equipment[s] = null; });
  return {
    schema: SCHEMA,
    meta: { createdAt: Date.now(), lastSeen: Date.now(), playtimeMs: 0, account: null, userId: null, name: "Commander" },
    player: { gold: 0, hp: 20, recoveryUntil: 0 },
    skills,
    inv:   { slots: PACK_SLOTS,   items: {}, order: [] },  // the pack you carry
    bank:  { slots: STORES_SLOTS, items: {}, order: [] },  // camp stores — trade output
    vault: { slots: BANK_SLOTS,   items: {}, order: [] },  // the bank — shared long-term pool
    spoils: [],       // unclaimed battlefield loot; costs no space until claimed
    uid: 1,           // instance counter for non-stacking gear
    equipment,
    tools: {},        // skillId -> tool item id
    wear: {},
    tasks: { skilling: null, combat: null },
    region: "region_1",
    travel: { unlocked: ["region_1"] },
    pets: { golem: false, sprite: false, mule: false },
    threat: {},        // regionTier -> kills toward the Sovereign
    bounty: null,
    buff: null,
    smugglerBought: {},
    yields: [],       // rolling recent-yield feed for the skill page
    stats: { kills: 0, actions: 0, deaths: 0, crafted: 0, epics: 0, goldEarned: 0 },
    log: [],
  };
}

/* Routing state — reflected in the URL hash so pages are linkable. */
let route = { page: "character", arg: null };
let storeView = "inv";
let eqTab = "pack";       // pack | bank
let campTab = "stores";   // stores | bank
let gridFilter = "all";
let gridSort = "custom";
let selected = null;
let navOpen = { vanguard: true, camp: false, trades: true, workshops: false, field: false };

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
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function say(msg) { state.log.push({ t: Date.now(), m: msg }); if (state.log.length > 60) state.log.shift(); }

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

function logYield(text) {
  state.yields.push({ t: Date.now(), m: text });
  if (state.yields.length > 12) state.yields.shift();
}

/* ---- storage ---- */

function store(w) { return w === "vault" ? state.vault : w === "bank" ? state.bank : state.inv; }
function packSlots() { return PACK_SLOTS + (state.pets.mule ? 8 : 0); }
function slotCap(w) {
  if (w === "vault") return state.vault.slots;
  if (w === "bank") return state.bank.slots;
  return packSlots();
}
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
  const s = store(w);
  const left = (s.items[key] || 0) - qty;
  if (left > 0) s.items[key] = left;
  else {
    delete s.items[key];
    s.order = s.order.filter((k) => k !== key);
    if (selected === key) selected = null;
  }
}

// Trade output goes to camp stores; if those are full it spills into the pack.
// Trade output lands in camp stores, spilling to the bank then the pack.
function deposit(key, qty) {
  return addTo("bank", key, qty) || addTo("vault", key, qty) || addTo("inv", key, qty);
}

function spend(key, qty) {
  let left = qty;
  ["bank", "vault", "inv"].forEach((w) => {
    if (left <= 0) return;
    const take = Math.min(left, qtyIn(w, key));
    if (take) { removeFrom(w, key, take); left -= take; }
  });
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

/* ================= 17. PROGRESSION ================= */

function xpMult() {
  let m = currentWeather().xp || 1;
  if (state.buff && state.buff.until > Date.now()) m *= state.buff.mult;
  return m;
}

function grantXp(skillId, amount) {
  const gain = Math.max(1, Math.round(amount * xpMult()));
  const before = skillLevel(skillId);
  state.skills[skillId] = (state.skills[skillId] || 0) + gain;
  const after = skillLevel(skillId);
  if (after > before) {
    say(`${skillName(skillId)} reaches level ${after}.`);
    if (skillId === "warfare") state.player.hp = maxHp();
    const hit = MASTERY_TRACK.find((m) => m.level === after);
    if (hit) toast(`${skillName(skillId)} ${after} — ${hit.label} (${hit.desc})`);
    else if (after % 10 === 0) toast(`${skillName(skillId)} — level ${after}`);
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

  const time = actionTime(def);
  task.progress += dt;
  let guard = 0;

  while (task.progress >= time && guard++ < 200000) {
    if (!canAfford(def.cost)) {
      say(`Work stopped — no materials left for ${def.name.toLowerCase()}.`);
      toast("Out of materials");
      state.tasks.skilling = null;
      return;
    }
    if (storeFull("bank") && storeFull("inv")) {
      say("Work stopped — camp stores and pack are both full.");
      toast("Nowhere to put anything — sell or expand your stores");
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

    if (task.queued) {
      const q = task.queued;
      if (q === "stop") { state.tasks.skilling = null; say("Work finished and stood down."); return; }
      state.tasks.skilling = newSkillTask(q.skillId, q.actionId);
      say(`Crews moved on to ${findAction(q.skillId, q.actionId).name.toLowerCase()}.`);
      return;
    }
  }
}

function produce(def) {
  if (def.out) {
    Object.keys(def.out).forEach((k) => {
      let qty = def.out[k];
      if (GATHER_ACTIONS[def.skillId] && Math.random() < doubleChance(def.skillId)) qty *= 2;
      if (deposit(k, qty)) logYield(`+${qty} ${itemName(k)}`);
      else say(`Nowhere to put ${itemName(k)}.`);
    });
    const rich = richFind(def);
    if (rich && Math.random() < RICH_FIND_CHANCE && deposit(rich, 1)) {
      logYield(`+1 ${itemName(rich)} (rich find)`);
      say(`A richer seam gave up ${itemName(rich)}.`);
    }
  }
  if (def.craftGear) {
    const rarity = rollRarity();
    const key = makeKey(def.craftGear, rarity);
    if (deposit(key, 1)) {
      state.stats.crafted++;
      logYield(`+1 ${itemName(key)}`);
      bountyProgress("craft", def);
      if (rarity !== "common") {
        say(`The ${GEAR[def.craftGear].name.toLowerCase()} comes out ${rarityDef(rarity).name.toLowerCase()}.`);
        if (rarity === "epic") { state.stats.epics++; toast(`Epic: ${itemName(key)}`); }
        else if (rarity === "rare") toast(`Rare: ${itemName(key)}`);
      }
    } else say(`Nowhere to put the ${GEAR[def.craftGear].name.toLowerCase()}.`);
  }
}

function bestFood() {
  let pick = null, best = 0;
  ["inv", "bank", "vault"].forEach((w) => {
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
      if (c.queued === "stop") { state.tasks.combat = null; say("Vanguard pulled back."); return; }
      if (c.queued) { state.tasks.combat = newCombatTask(c.queued); return; }
      const next = rollSpawn(c.tier);
      c.monsterId = next.id;
      c.mobHp = next.hp; c.mobMax = next.hp; c.mobTimer = next.speed; c.playerTimer = PLAYER_SWING_MS;
      if (next.rank === "boss") { say(`${next.name} comes up out of the dark.`); toast(`Sovereign: ${next.name}`); }
      else if (next.rank === "elite") say(`An elite — ${next.name.toLowerCase()} — takes the field.`);
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

    if (state.player.hp <= 0) die(mob);
  }
}

/* Death: you get dragged back to camp. Five minutes out of the fight, and
   your kit takes a beating for it. Your people keep working regardless. */
function die(mob) {
  state.player.hp = maxHp();
  state.tasks.combat = null;
  state.stats.deaths++;
  state.player.recoveryUntil = Date.now() + RECOVERY_MS;

  EQUIP_SLOTS.forEach((slot) => {
    const key = state.equipment[slot];
    if (key && itemDef(key).maxDur) damageItem(key, DEATH_WEAR);
  });

  say(`The ${mob.name.toLowerCase()} put you down. Dragged back to camp — five minutes to recover, and your kit is worse for it.`);
  toast("You fell. Recovering for five minutes.");
}

/* Loot from the field goes to an unclaimed spoils table. It costs no pack
   space until you decide to take it, so a full pack never loses you a drop. */
const SPOILS_CAP = 40;

function addSpoil(key, qty) {
  const existing = stacks(key) ? state.spoils.find((s) => s.key === key) : null;
  if (existing) { existing.qty += qty; existing.t = Date.now(); }
  else {
    state.spoils.push({ key, qty, t: Date.now() });
    if (state.spoils.length > SPOILS_CAP) state.spoils.shift();
  }
  logYield(`+${qty} ${itemName(key)} (spoils)`);
}

function claimSpoil(index) {
  const s = state.spoils[index];
  if (!s) return;
  const target = state.pets.sprite ? "bank" : "inv";
  if (!addTo(target, s.key, s.qty) && !addTo("inv", s.key, s.qty) && !addTo("vault", s.key, s.qty)) {
    say("Nowhere to put it — clear some space first.");
    render();
    return;
  }
  state.spoils.splice(index, 1);
  render();
}

function claimAllSpoils() {
  let stuck = 0;
  for (let i = state.spoils.length - 1; i >= 0; i--) {
    const s = state.spoils[i];
    const target = state.pets.sprite ? "bank" : "inv";
    if (addTo(target, s.key, s.qty) || addTo("inv", s.key, s.qty) || addTo("vault", s.key, s.qty)) {
      state.spoils.splice(i, 1);
    } else stuck++;
  }
  if (stuck) { say(`${stuck} lot${stuck > 1 ? "s" : ""} left on the field — no room.`); toast("Not everything fit"); }
  render();
}

function sellSpoil(index) {
  const s = state.spoils[index];
  if (!s) return;
  addGold(itemDef(s.key).value * s.qty);
  state.spoils.splice(index, 1);
  render();
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
    addSpoil(k, qty);
  });

  if (mob.rank === "boss") {
    state.threat[mob.tier] = 0;
    state.stats.bosses = (state.stats.bosses || 0) + 1;
    const spoils = dropSovereignSpoils(mob.tier);
    say(`${mob.name} is down. The region quiets — for now.`);
    toast(`Sovereign felled · ${spoils}`);
  } else {
    state.threat[mob.tier] = Math.min(THREAT_CAP, threatIn(mob.tier) + 1);
    if (threatIn(mob.tier) === THREAT_CAP) {
      say("Something bigger has noticed you. It will be waiting.");
      toast("Threat at boiling point — a Sovereign stirs");
    }
  }

  applyWear();
  c.respawn = RESPAWN_MS;
}

// A Sovereign always leaves one Epic-rarity piece behind, rolled from
// whichever profession works this tier.
function dropSovereignSpoils(tier) {
  const pool = Object.values(GEAR).filter((g) => g.tier === tier);
  const pick = pool[randInt(0, pool.length - 1)];
  const key = makeKey(pick.id, "epic");
  addSpoil(key, 1);
  state.stats.epics++;
  return itemName(key);
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
  deposit(out.mat, out.qty);
  say(`Broke down the ${itemName(key).toLowerCase()} for ${out.qty} ${itemName(out.mat).toLowerCase()}.`);
  render();
}

/* ================= 19. TASKS ================= */

function newSkillTask(skillId, actionId) {
  return { skillId, actionId, progress: 0, done: 0, startedAt: Date.now(), queued: null };
}

function newCombatTask(tier) {
  const mob = rollSpawn(tier);
  return { tier, monsterId: mob.id, mobHp: mob.hp, mobMax: mob.hp,
    playerTimer: PLAYER_SWING_MS, mobTimer: mob.speed,
    respawn: 0, done: 0, startedAt: Date.now(), queued: null };
}

function selectSkillAction(skillId, actionId) {
  const def = findAction(skillId, actionId);
  if (!def || skillLevel(skillId) < def.level) return;
  const t = state.tasks.skilling;
  if (!t) { state.tasks.skilling = newSkillTask(skillId, actionId); render(); return; }
  if (t.skillId === skillId && t.actionId === actionId) {
    t.queued = t.queued === "stop" ? null : "stop";
    say(t.queued ? "Crews will stand down once this action finishes." : "Stand-down cancelled.");
  } else {
    state.tasks.skilling = newSkillTask(skillId, actionId);
    say(`Crews instantly shifted to ${def.name.toLowerCase()}.`);
  }
  render();
}

function engageRegion(tier) {
  if (recovering()) { say("You're still being patched up. Give it a few minutes."); render(); return; }
  const t = state.tasks.combat;
  if (!t) { state.tasks.combat = newCombatTask(tier); state.player.hp = maxHp(); render(); return; }
  if (t.tier === tier) t.queued = t.queued === "stop" ? null : "stop";
  else { t.queued = tier; say("New ground queued — this fight finishes first."); }
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
  return { def, time, done: t.done, target: t.done + remaining, timeLeft: remaining * time - t.progress,
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

function seedFrom(s) {
  const x = Math.sin(s) * 10000;
  return x - Math.floor(x);
}
/* ================= 20. BOUNTY ================= */

function currentWindow() { return Math.floor(Date.now() / WINDOW_MS); }
function windowEndsIn() { return WINDOW_MS - (Date.now() % WINDOW_MS); }

function makeBounty() {
  const w = currentWindow();
  const region = currentRegion();
  const t = TIERS[region.tier - 1];
  const roll = seedFrom(w * 3.31 + region.tier);

  if (roll < 0.45) {
    const mob = monsterOfTier(region.tier);
    const amount = 10 + Math.floor(seedFrom(w * 5.5) * 15);
    return { window: w, region: region.id, kind: "slay", targetTier: region.tier,
      label: `Put down ${amount} of whatever holds ${region.name}`, amount, progress: 0, claimed: false,
      gold: Math.round(mob.gold[1] * amount * 0.8) };
  }
  const skill = GATHER_SKILLS[Math.floor(seedFrom(w * 9.13 + region.tier) * GATHER_SKILLS.length)];
  const amount = 20 + Math.floor(seedFrom(w * 2.7) * 30);
  return { window: w, region: region.id, kind: "gather", targetId: matId(t, skill.mat),
    label: `Bring in ${amount} ${titleCase(t[skill.mat])}`, amount, progress: 0, claimed: false,
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
  
  const wasDone = b.progress >= b.amount;
  
  if (kind === "slay" && thing.id === b.targetId) b.progress++;
  if (kind === "gather" && thing.out && thing.out[b.targetId]) b.progress += thing.out[b.targetId];
  
  if (!wasDone && b.progress >= b.amount) toast("Bounty complete — claim it on the board");
}

function claimBounty() {
  const b = state.bounty;
  if (!b || b.claimed || b.progress < b.amount) return;
  b.claimed = true;
  addGold(b.gold);
  state.buff = { until: Date.now() + 60 * 60 * 1000, mult: 2 };
  say(`Bounty paid: ${fmt(b.gold)} gold. Double experience for the next hour.`);
  toast("Double experience for one hour");
  render();
}

/* ================= 21. SHOP ================= */

function shopStock() { return RATIONS.map((r) => ({ key: r.id, price: Math.round(r.value * 1.6) })); }

function smugglerStock() {
  const w = currentWindow();
  const picks = [];
  const pool = Object.keys(MATERIALS).filter((k) => MATERIALS[k].tier && !MATERIALS[k].heal && k !== "vault_chest");
  for (let i = 0; i < 3; i++) {
    const key = pool[Math.floor(seedFrom(w * (i + 2) * 1.77) * pool.length)];
    const qty = 5 + Math.floor(seedFrom(w * (i + 3) * 4.2) * 20);
    picks.push({ key, qty, price: Math.round(MATERIALS[key].value * qty * 2.4), slot: i });
  }
  return picks;
}

function buyShop(key, price, qty) {
  if (state.player.gold < price) { say("Not enough gold."); render(); return; }
  if (!addTo("inv", key, qty) && !addTo("bank", key, qty)) { say("Nowhere to put it."); render(); return; }
  state.player.gold -= price;
  say(`Bought ${qty} ${itemName(key).toLowerCase()}.`);
  render();
}

function buySmuggler(entry) {
  const tag = `${currentWindow()}_${entry.slot}`;
  if (state.smugglerBought[tag]) return;
  if (state.player.gold < entry.price) { say("The smuggler doesn't haggle."); render(); return; }
  if (!deposit(entry.key, entry.qty)) { say("Nowhere to put it."); render(); return; }
  state.player.gold -= entry.price;
  state.smugglerBought = {};
  state.smugglerBought[tag] = true;
  say(`The smuggler hands over ${entry.qty} ${itemName(entry.key).toLowerCase()}.`);
  render();
}

/* ================= 22. PETS ================= */

const PETS = [
  { id: "golem",  name: "Stone Golem",    icon: "golemMob", cost: 4000,
    note: "Works the seam alongside your crews.",
    effect: "Gathering 10% faster, +10% chance of a doubled load." },
  { id: "sprite", name: "Looting Sprite", icon: "horror", cost: 7500,
    note: "Flits between the field and the camp.",
    effect: "Battlefield loot that won't fit your pack is run back to stores." },
  { id: "mule",   name: "Pack Mule",      icon: "beast", cost: 2500,
    note: "Carries what you can't.",
    effect: "Eight more slots in your pack, permanently." },
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

/* ================= 23. TRAVEL + EQUIPMENT ================= */

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

function equip(key) {
  const d = itemDef(key);
  if (d && d.kind === "tool") {
    const old = state.tools[d.forSkill];
    if (old) deposit(old, 1);
    removeFrom(storeView, key, 1);
    state.tools[d.forSkill] = d.base;
    say(`${itemName(key)} taken up for ${skillName(d.forSkill)}.`);
    render();
    return;
  }
  if (!d || !d.slot) return;

  if (d.slot === "weapon" && d.twoHanded && state.equipment.offhand) {
    if (!deposit(state.equipment.offhand, 1)) { say("Nowhere to stow your offhand."); render(); return; }
    state.equipment.offhand = null;
  }
  if (d.slot === "offhand") {
    const w = state.equipment.weapon;
    if (w && itemDef(w).twoHanded) { say(`Both hands are on the ${itemName(w).toLowerCase()}.`); render(); return; }
  }
  const old = state.equipment[d.slot];
  if (old && !deposit(old, 1)) { say("Nowhere for what you're taking off."); render(); return; }
  removeFrom(storeView, key, 1);
  state.equipment[d.slot] = key;
  render();
}

function unequip(slot) {
  const key = state.equipment[slot];
  if (!key) return;
  if (!deposit(key, 1)) { say("Nowhere to put it."); render(); return; }
  state.equipment[slot] = null;
  render();
}

function unequipTool(skillId) {
  const id = state.tools[skillId];
  if (!id) return;
  if (!deposit(id, 1)) { say("Nowhere to put it."); render(); return; }
  delete state.tools[skillId];
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
  if (!store(to).items[key] && storeFull(to)) { say(`${to === "bank" ? "Camp stores" : "Pack"} is full.`); render(); return; }
  removeFrom(from, key, qty);
  addTo(to, key, qty);
  render();
}

function useChest(key) {
  if (parseKey(key).base !== "vault_chest") return;
  if (state.bank.slots >= BANK_MAX) { say("The stores are as deep as they go."); render(); return; }
  removeFrom(storeView, key, 1);
  state.bank.slots = Math.min(BANK_MAX, state.bank.slots + MATERIALS.vault_chest.chest);
  say(`Camp stores widened to ${state.bank.slots} slots.`);
  render();
}
/* ================= 24. SAVE / ACCOUNTS ================= */
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
  ["meta", "player", "skills", "equipment", "tasks", "travel", "pets", "stats"].forEach((k) => {
    m[k] = Object.assign(base[k], loaded[k] || {});
  });
  m.inv = Object.assign(base.inv, loaded.inv || {});
  m.bank = Object.assign(base.bank, loaded.bank || {});
  m.inv.items = Object.assign({}, (loaded.inv && loaded.inv.items) || {});
  m.bank.items = Object.assign({}, (loaded.bank && loaded.bank.items) || {});
  m.inv.order = ((loaded.inv && loaded.inv.order) || []).slice();
  m.bank.order = ((loaded.bank && loaded.bank.order) || []).slice();
  m.wear = Object.assign({}, loaded.wear || {});
  m.tools = Object.assign({}, loaded.tools || {});
  m.yields = (loaded.yields || []).slice(-12);
  m.log = (loaded.log || []).slice(-60).map((e) => (typeof e === "string" ? { t: Date.now(), m: e } : e));

  ["inv", "bank"].forEach((w) => {
    Object.keys(m[w].items).forEach((k) => { if (!itemDef(k)) delete m[w].items[k]; });
    m[w].order = m[w].order.filter((k) => itemDef(k));
  });
  EQUIP_SLOTS.forEach((s) => { if (m.equipment[s] && !itemDef(m.equipment[s])) m.equipment[s] = null; });
  Object.keys(m.tools).forEach((k) => { if (!TOOLS[m.tools[k]]) delete m.tools[k]; });
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

/* ================= 25. ROUTING ================= */
/* Hash routes, so every page is linkable, bookmarkable, and the browser
   back button works — without tearing down the tick loop a real page load
   would cost. */

const PAGES = ["character", "equipment", "camp", "kennel", "atlas", "shop", "bounty", "skill"];

function parseHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  const [page, arg] = raw.split("/");
  if (!PAGES.includes(page)) return { page: "character", arg: null };
  if (page === "skill" && !skillDef(arg)) return { page: "skill", arg: "delving" };
  return { page, arg: arg || null };
}

function go(page, arg) {
  const hash = "#/" + page + (arg ? "/" + arg : "");
  if (location.hash === hash) { route = parseHash(); render(); }
  else location.hash = hash;
}

window.addEventListener("hashchange", () => { route = parseHash(); selected = null; render(); });

/* ================= 26. RENDER ================= */

let keys = {};
let liveRefs = { node: null, monster: null };

function render() { keys = {}; liveRefs = { node: null, monster: null }; renderAll(); }

function renderAll() {
  renderTopbar();
  renderSidebar();
  renderPage();
  renderLog();
}

/* ---- topbar ---- */

function renderTopbar() {
  el("goldText").textContent = fmt(state.player.gold);
  el("clockText").textContent = serverClock();
  const hp = Math.max(0, Math.ceil(state.player.hp));
  el("hpFill").style.width = clamp((hp / maxHp()) * 100, 0, 100) + "%";
  el("hpText").textContent = `${hp}/${maxHp()}`;

  const sp = skillPlan();
  const sBar = el("tbTradesBar");
  if (sp) {
    el("tbTradesName").textContent = titleCase(sp.def.name);
    sBar.classList.toggle("nojump", sp.pct < 6);
    sBar.style.width = sp.pct + "%";
    let line = `${fmt(sp.done)} / ${fmt(sp.target)} actions · ${fmtTime(sp.timeLeft)} left`;
    if (sp.capped) line += " (stock)";
    if (state.tasks.skilling.queued) line += state.tasks.skilling.queued === "stop" ? " · standing down" : " · switching";
    el("tbTradesMeta").textContent = line;
    el("tbTradesClear").classList.toggle("queued", !!state.tasks.skilling.queued);
  } else {
    el("tbTradesName").textContent = "Idle";
    sBar.style.width = "0";
    el("tbTradesMeta").textContent = "No crews tasked.";
    el("tbTradesClear").classList.remove("queued");
  }

  const cp = combatPlan();
  const cBar = el("tbFieldBar");
  if (cp) {
    el("tbFieldName").textContent = cp.mob.name;
    cBar.style.width = cp.pct + "%";
    let line = `${fmt(cp.done)} / ${fmt(cp.target)} kills · ${fmtTime(cp.timeLeft)} left`;
    line += cp.food ? ` · food ${fmt(cp.foodHave)}/${fmt(cp.foodNeed)}` : " · no provisions";
    if (state.tasks.combat.queued) line += " · changing";
    el("tbFieldMeta").textContent = line;
    el("tbFieldClear").classList.toggle("queued", !!state.tasks.combat.queued);
  } else {
    el("tbFieldName").textContent = recovering() ? "Recovering" : "Idle";
    cBar.style.width = "0";
    el("tbFieldMeta").textContent = recovering()
      ? `Back on your feet in ${fmtTime(state.player.recoveryUntil - Date.now())}.`
      : "Take the field from any region.";
    el("tbFieldClear").classList.remove("queued");
  }
}

/* ---- sidebar ---- */

function toggleNav(group) { navOpen[group] = !navOpen[group]; keys.side = ""; renderSidebar(); }

function renderSidebar() {
  const sig = SKILLS.map((s) => s.id + skillLevel(s.id)).join(",") + "|" + route.page + route.arg +
    "|" + eqTab + campTab + "|" + JSON.stringify(navOpen) + "|" + currentWeather().id +
    "|" + slotsUsed("inv") + "/" + slotsUsed("bank") + "|" + (state.tasks.skilling ? state.tasks.skilling.skillId : "-") +
    "|" + state.spoils.length;
  if (keys.side === sig) return;
  keys.side = sig;

  Object.keys(navOpen).forEach((g) => {
    const box = el("pill-" + g);
    if (box) box.classList.toggle("open", navOpen[g]);
  });

  const mkItem = ({ label, page, arg, right, active, locked, tag, onclick }) => {
    const b = document.createElement("button");
    b.className = "nav-item" + (active ? " active" : "") + (locked ? " locked" : "");
    b.innerHTML = '<span class="nav-name"></span><span class="lvl"></span>';
    b.children[0].textContent = label;
    b.children[1].textContent = right || "";
    if (tag) { b.children[1].className = "soon"; b.children[1].textContent = tag; }
    if (!locked) b.onclick = onclick || (() => go(page, arg));
    return b;
  };

  const van = el("navVanguard");
  van.innerHTML = "";
  van.appendChild(mkItem({ label: "Character", page: "character", active: route.page === "character" }));
  van.appendChild(mkItem({ label: "Equipment & Pack", page: "equipment",
    right: `${slotsUsed("inv")}/${packSlots()}`, active: route.page === "equipment" }));

  const camp = el("navCamp");
  camp.innerHTML = "";
  camp.appendChild(mkItem({ label: "Camp Stores", page: "camp",
    right: `${slotsUsed("bank")}/${slotCap("bank")}`, active: route.page === "camp" }));
  camp.appendChild(mkItem({ label: "The Kennel", page: "kennel", active: route.page === "kennel" }));
  const b = state.bounty;
  camp.appendChild(mkItem({ label: "The Board", page: "bounty", active: route.page === "bounty",
    right: b ? `${fmt(Math.min(b.progress, b.amount))}/${fmt(b.amount)}` : "" }));

  const mkSkills = (box, kind) => {
    box.innerHTML = "";
    SKILLS.filter((s) => s.kind === kind).forEach((s) => {
      const item = mkItem({ label: s.name, page: "skill", arg: s.id, right: "Lv." + skillLevel(s.id),
        active: route.page === "skill" && route.arg === s.id });
      if (kind !== "war" && state.tasks.skilling && state.tasks.skilling.skillId === s.id) item.classList.add("busy");
      if (kind === "war" && state.tasks.combat) item.classList.add("busy");
      box.appendChild(item);
    });
  };
  mkSkills(el("navTrades"), "gather");
  mkSkills(el("navWorkshops"), "craft");
  mkSkills(el("navField"), "war");
  el("navField").appendChild(mkItem({ label: "Dungeons", locked: true, tag: "Soon" }));

  const spoilTag = el("spoilsTag");
  if (spoilTag) {
    spoilTag.textContent = state.spoils.length ? `${state.spoils.length} unclaimed` : "";
    spoilTag.hidden = !state.spoils.length;
  }

  const w = currentWeather(), tm = weatherOn(1);
  el("weatherTag").textContent = w.name;
  el("weatherNote").textContent = w.note;
  el("weatherXp").textContent = w.xp > 1 ? `+${Math.round((w.xp - 1) * 100)}% experience` : "";
  el("weatherNext").textContent = `Tomorrow: ${tm.name}`;
}

/* ---- page dispatch ---- */

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
    const s = skillDef(route.arg);
    const group = s.kind === "gather" ? "Gathering" : s.kind === "craft" ? "Crafting" : "The Field";
    return `Respite &nbsp;/&nbsp; ${group} &nbsp;/&nbsp; <b>${s.name}</b>`;
  }
  return `Respite &nbsp;/&nbsp; ${r.name} &nbsp;/&nbsp; <b>${titleCase(route.page)}</b>`;
}

/* ================= SKILL PAGE ================= */

function renderSkill() {
  const s = skillDef(route.arg) || skillDef("delving");
  const region = currentRegion();
  const lvl = skillLevel(s.id);
  const xp = state.skills[s.id] || 0;
  const base = XP_TABLE[lvl], next = XP_TABLE[Math.min(lvl + 1, MAX_LEVEL)];
  const pct = lvl >= MAX_LEVEL ? 100 : ((xp - base) / (next - base)) * 100;

  el("skHeroTag").textContent = s.kind === "gather" ? `In ${region.name}` : s.kind === "war" ? "The Field" : "At Camp";
  el("skHeroName").textContent = s.name;
  el("skHeroIcon").innerHTML = icon(s.icon, "ico-xl");
  el("skHeroLvl").textContent = "Lv " + lvl;
  el("skHeroXp").textContent = lvl >= MAX_LEVEL ? "Mastered" : `${fmt(xp)} / ${fmt(next)} XP`;
  el("skHeroBar").style.width = clamp(pct, 0, 100) + "%";
  el("skHeroNote").textContent = skillBlurb(s);
  el("skHeroNext").textContent = lvl >= MAX_LEVEL ? "" : `${fmt(next - xp)} to next level`;

  const t = state.tasks.skilling, c = state.tasks.combat;
  const sig = `${s.id}|${lvl}|${region.id}|${t ? t.skillId + t.actionId + (t.queued ? "q" : "") : "-"}|` +
    `${c ? c.monsterId + (c.queued ? "q" : "") : "-"}|${state.tools[s.id] || "-"}|${recovering()}`;
  if (keys.skill === sig) { updateLive(); return; }
  keys.skill = sig;
  liveRefs = { node: null, monster: null };

  if (s.kind === "war") renderFieldBody(region);
  else if (s.kind === "gather") renderGatherBody(s, region);
  else renderCraftBody(s);

  if (s.kind !== "war") { const sp = el("skSpoils"); if (sp) sp.hidden = true; }
  renderMastery(s.id);
  renderMilestones(s.id, lvl);
  renderYieldFeed();
  updateLive();
}

function skillBlurb(s) {
  const gs = GATHER_SKILLS.find((g) => g.id === s.id);
  if (gs) return gs.note;
  const p = PROFESSIONS.find((x) => x.id === s.id);
  if (p) return p.note;
  return "You take the vanguard yourself. Provisions are eaten automatically when you drop low.";
}

function renderGatherBody(s, region) {
  const def = GATHER_ACTIONS[s.id][region.tier - 1];
  const lvl = skillLevel(s.id);
  const locked = lvl < def.level;
  const t = state.tasks.skilling;
  const active = !!(t && t.skillId === s.id && t.actionId === def.id);

  el("skWorkLabel").textContent = `Working · ${titleCase(def.name)}`;
  const box = el("skWorkBody");
  box.innerHTML = "";

  const card = document.createElement("div");
  card.className = "node-card";
  card.innerHTML = `<div class="node-icon">${icon(def.icon, "ico-lg")}</div>`;

  const info = document.createElement("div");
  info.className = "node-info";

  const h = document.createElement("h3");
  h.textContent = titleCase(def.name);
  info.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "node-sub";
  sub.textContent = locked
    ? `This ground needs ${s.name} ${def.level}. Your crews can't work it yet — move somewhere shallower in the Atlas.`
    : "One seam per region. Move in the Atlas to work richer ground.";
  info.appendChild(sub);

  const chips = document.createElement("div");
  chips.className = "stat-chips";
  const time = actionTime(def);
  const w = currentWeather();
  const mod = w.mods[s.id];
  chips.innerHTML =
    `<div class="chip">${(time / 1000).toFixed(1)}s / action</div>` +
    `<div class="chip">${fmt(def.xp)} XP base</div>` +
    `<div class="chip${mod && mod > 1 ? " warn" : ""}">${w.name}: ${mod ? (mod > 1 ? "slowed" : "quickened") : "unaffected"}</div>` +
    (doubleChance(s.id) > 0 ? `<div class="chip good">${Math.round(doubleChance(s.id) * 100)}% double yield</div>` : "");
  info.appendChild(chips);

  const prog = document.createElement("div");
  prog.className = "node-progress";
  prog.innerHTML = '<div class="bar"><i></i></div><div class="meta"><span></span><b></b></div>';
  info.appendChild(prog);

  const btn = document.createElement("button");
  btn.className = "btn btn-primary node-btn";
  btn.textContent = active ? (t.queued === "stop" ? "Standing down after this" : "Stop working") : "Put crews to work";
  btn.disabled = locked;
  btn.onclick = () => selectSkillAction(s.id, def.id);
  info.appendChild(btn);

  card.appendChild(info);
  box.appendChild(card);

  liveRefs.node = { def, skillId: s.id,
    bar: prog.querySelector("i"), left: prog.querySelector("span"), right: prog.querySelector("b") };

  renderToolPanel(s.id);
  renderYieldTable(def, s.id);
  renderOtherSeams(s.id);
}

function renderCraftBody(s) {
  const lvl = skillLevel(s.id);
  el("skWorkLabel").textContent = "Workshop";
  const box = el("skWorkBody");
  box.innerHTML = "";

  const list = document.createElement("div");
  list.className = "recipe-list";
  const t = state.tasks.skilling;

  actionsFor(s.id).filter((a) => a.level <= lvl + 20).forEach((def) => {
    const locked = lvl < def.level;
    const active = !!(t && t.skillId === s.id && t.actionId === def.id);
    const row = document.createElement("button");
    row.className = "recipe" + (locked ? " locked" : "") + (active ? " active" : "");
    row.disabled = locked;

    const costTxt = Object.keys(def.cost || {}).map((k) =>
      `${def.cost[k]}× ${itemName(k)} (${fmt(haveQty(k))})`).join(", ");
    const short = Object.keys(def.cost || {}).some((k) => haveQty(k) < def.cost[k]);

    row.innerHTML =
      `<span class="r-ico">${icon(def.icon, "ico-sm")}</span>` +
      `<span class="r-name"></span>` +
      `<span class="r-cost${short ? " short" : ""}"></span>` +
      `<span class="r-meta"></span>`;
    row.children[1].textContent = titleCase(def.name);
    row.children[2].textContent = locked ? `Needs Lv ${def.level}` : costTxt;
    row.children[3].textContent = `${(actionTime(def) / 1000).toFixed(0)}s · ${fmt(def.xp)} XP`;
    row.onclick = () => selectSkillAction(s.id, def.id);
    list.appendChild(row);
  });

  box.appendChild(list);

  const activeDef = t && t.skillId === s.id ? findAction(t.skillId, t.actionId) : null;
  if (activeDef) {
    const prog = document.createElement("div");
    prog.className = "node-progress craft-progress";
    prog.innerHTML = '<div class="bar"><i></i></div><div class="meta"><span></span><b></b></div>';
    box.appendChild(prog);
    liveRefs.node = { def: activeDef, skillId: s.id,
      bar: prog.querySelector("i"), left: prog.querySelector("span"), right: prog.querySelector("b") };
  }

  el("skRailA").hidden = true;
  el("skYield").hidden = true;
  el("skSeams").hidden = true;
}

function renderFieldBody(region) {
  const tier = region.tier;
  const t = state.tasks.combat;
  const engaged = !!(t && t.tier === tier);
  const live = engaged ? getMonster(t.monsterId) : rankOf(tier, "grunt");

  el("skWorkLabel").textContent = `The Field · ${region.name}`;
  const box = el("skWorkBody");
  box.innerHTML = "";

  const card = document.createElement("div");
  card.className = "node-card";
  card.innerHTML = `<div class="node-icon war">${icon(live.icon, "ico-lg")}</div>`;

  const info = document.createElement("div");
  info.className = "node-info";
  const h = document.createElement("h3");
  h.textContent = live.name;
  if (live.rank !== "grunt") {
    const tag = document.createElement("span");
    tag.className = "rank-tag " + live.rank;
    tag.textContent = live.rank === "boss" ? "Sovereign" : "Elite";
    h.appendChild(tag);
  }
  info.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "node-sub";
  sub.textContent = recovering()
    ? `You're still being patched up. Back on your feet in ${fmtTime(state.player.recoveryUntil - Date.now())}.`
    : "You lead the vanguard yourself. Your crews keep working while you're out here.";
  info.appendChild(sub);

  const chips = document.createElement("div");
  chips.className = "stat-chips";
  const atk = attackPower();
  const avg = Math.max(1, (atk * 0.55 + atk) / 2 - live.defence * 0.35);
  const killMs = (live.hp / avg) * PLAYER_SWING_MS + RESPAWN_MS;
  const incoming = Math.max(1, (live.attack * 0.55 + live.attack) / 2 - defencePower() * 0.4);
  const survive = maxHp() / (incoming / live.speed * 1000);
  chips.innerHTML =
    `<div class="chip">${fmt(live.hp)} HP</div>` +
    `<div class="chip">${fmt(live.attack)} attack</div>` +
    `<div class="chip">${fmt(live.xp)} XP</div>` +
    `<div class="chip${survive < 30 ? " warn" : ""}">~${fmtTime(killMs)} a kill</div>` +
    `<div class="chip${survive < 30 ? " warn" : " good"}">${survive < 30 ? "You will not last here" : "Survivable"}</div>`;
  info.appendChild(chips);

  const bar = document.createElement("div");
  bar.className = "node-progress";
  bar.innerHTML = '<div class="bar mob"><i style="width:100%"></i></div><div class="meta"><span></span><b></b></div>';
  info.appendChild(bar);

  const btn = document.createElement("button");
  btn.className = "btn btn-primary node-btn";
  btn.textContent = recovering() ? "Recovering"
    : engaged ? (t.queued === "stop" ? "Pulling back after this" : "Pull back") : "Take the field";
  btn.disabled = recovering();
  btn.onclick = () => engageRegion(tier);
  info.appendChild(btn);

  card.appendChild(info);
  box.appendChild(card);
  liveRefs.monster = { tier, bar: bar.querySelector("i"), left: bar.querySelector("span"), right: bar.querySelector("b") };

  // --- threat tracker ---
  const threat = threatIn(tier);
  const tr = document.createElement("div");
  tr.className = "threat-block";
  tr.innerHTML =
    '<div class="threat-head"><span class="label">Regional Threat</span><span class="threat-num"></span></div>' +
    '<div class="bar threat"><i></i></div><div class="threat-note"></div>';
  tr.querySelector(".threat-num").textContent = `${threat} / ${THREAT_CAP}`;
  tr.querySelector("i").style.width = (threat / THREAT_CAP) * 100 + "%";
  tr.querySelector(".threat-note").textContent = threat >= THREAT_CAP
    ? `${rankOf(tier, "boss").name} is waiting. It will take the field on the next spawn.`
    : `Every kill here draws more attention. At ${THREAT_CAP}, ${rankOf(tier, "boss").name} comes out.`;
  box.appendChild(tr);

  // --- roster rail ---
  el("skRailA").hidden = false;
  el("skRailALabel").textContent = "Regional Roster";
  const rail = el("skRailABody");
  rail.innerHTML = "";
  rosterFor(tier).forEach((m) => {
    const row = document.createElement("div");
    row.className = "roster-row" + (m.id === live.id ? " on" : "");
    row.innerHTML =
      `<div class="left">${icon(m.icon, "ico-sm")}<div><div class="rname"></div><div class="rsub"></div></div></div>` +
      `<div class="rrank ${m.rank}"></div>`;
    row.querySelector(".rname").textContent = m.name;
    row.querySelector(".rsub").textContent = `${fmt(m.hp)} HP · ${fmt(m.xp)} XP`;
    row.querySelector(".rrank").textContent =
      m.rank === "grunt" ? "80%" : m.rank === "elite" ? "20%" : "Threat " + THREAT_CAP;
    rail.appendChild(row);
  });

  el("skYield").hidden = false;
  el("skYieldBody").innerHTML = "";
  live.drops.forEach(([k, qty, chance]) => {
    const row = document.createElement("div");
    row.className = "yield-item";
    row.innerHTML = `<div class="left">${icon(itemDef(k).icon, "ico-sm")}<span></span></div><div class="chance"></div>`;
    row.querySelector("span").textContent = itemName(k);
    row.querySelector(".chance").textContent = `${Math.round(chance * 100)}% · ${qty}`;
    el("skYieldBody").appendChild(row);
  });
  if (live.rank === "boss") {
    const row = document.createElement("div");
    row.className = "yield-item";
    row.innerHTML = '<div class="left"><span class="rar-epic">Epic component</span></div><div class="chance">Guaranteed</div>';
    el("skYieldBody").appendChild(row);
  }

  renderSpoils();

  el("skSeams").hidden = false;
  el("skSeamsLabel").textContent = "Other Ground";
  const seams = el("skSeamsBody");
  seams.innerHTML = "";
  REGIONS.forEach((r) => {
    if (r.tier === tier) return;
    const unlocked = state.travel.unlocked.includes(r.id);
    const grunt = rankOf(r.tier, "grunt");
    const row = document.createElement("button");
    row.className = "seam-row";
    row.innerHTML = '<div class="name"></div><div class="region"></div>';
    row.children[0].textContent = grunt.name;
    row.children[1].textContent = `Lv ${grunt.level} · ${r.name}${unlocked ? "" : ` · ${fmt(r.toll)}g`}`;
    row.onclick = () => travelTo(r.id);
    seams.appendChild(row);
  });
}

const regionOfTier = (tier) => REGIONS.find((r) => r.tier === tier);

function renderToolPanel(skillId) {
  el("skRailA").hidden = false;
  el("skRailALabel").textContent = "Tool in Hand";
  const box = el("skRailABody");
  box.innerHTML = "";

  const tool = toolFor(skillId);
  const card = document.createElement("div");
  card.className = "tool-card";
  if (tool) {
    card.innerHTML = `<div class="tool-icon">${icon(tool.icon)}</div>` +
      `<div><div class="tool-name"></div><div class="tool-sub"></div></div>`;
    card.querySelector(".tool-name").textContent = tool.name;
    card.querySelector(".tool-sub").textContent = `+${Math.round(tool.speed * 100)}% ${skillName(skillId)} speed · Tier ${tool.tier}`;
    const off = document.createElement("button");
    off.className = "minibtn";
    off.textContent = "Stow";
    off.onclick = () => unequipTool(skillId);
    card.appendChild(off);
  } else {
    card.innerHTML = `<div class="tool-icon empty">${icon(TOOL_SPEC[skillId].icon)}</div>` +
      `<div><div class="tool-name">Bare hands</div><div class="tool-sub">Forge a ${TOOL_SPEC[skillId].label.toLowerCase()} at the Forgemaster for more speed.</div></div>`;
  }
  box.appendChild(card);
}

function renderYieldTable(def, skillId) {
  el("skYield").hidden = false;
  const box = el("skYieldBody");
  box.innerHTML = "";

  const mainKey = Object.keys(def.out)[0];
  const rows = [[mainKey, "Every action"]];
  const dbl = doubleChance(skillId);
  if (dbl > 0) rows.push([mainKey, `${Math.round(dbl * 100)}% doubled`]);
  const rich = richFind(def);
  if (rich) rows.push([rich, `${(RICH_FIND_CHANCE * 100).toFixed(1)}% rich find`]);

  rows.forEach(([k, label]) => {
    const row = document.createElement("div");
    row.className = "yield-item";
    row.innerHTML = `<div class="left">${icon(itemDef(k).icon, "ico-sm")}<span></span></div><div class="chance"></div>`;
    row.querySelector("span").textContent = itemName(k);
    row.querySelector(".chance").textContent = label;
    box.appendChild(row);
  });
}

function renderOtherSeams(skillId) {
  el("skSeams").hidden = false;
  el("skSeamsLabel").textContent = `Other ${skillName(skillId)} Grounds`;
  const box = el("skSeamsBody");
  box.innerHTML = "";
  const lvl = skillLevel(skillId);

  GATHER_ACTIONS[skillId].forEach((def) => {
    if (def.tier === currentRegion().tier) return;
    const r = regionOfTier(def.tier);
    const unlocked = state.travel.unlocked.includes(r.id);
    const row = document.createElement("button");
    row.className = "seam-row" + (lvl < def.level ? " dim" : "");
    row.innerHTML = `<div class="name"></div><div class="region"></div>`;
    row.children[0].textContent = titleCase(def.name);
    row.children[1].textContent = `Lv ${def.level} · ${r.name}${unlocked ? "" : ` · ${fmt(r.toll)}g toll`}`;
    row.onclick = () => travelTo(r.id);
    box.appendChild(row);
  });
}

function renderSpoils() {
  const box = el("skSpoils");
  if (!box) return;
  box.hidden = false;
  const list = el("skSpoilsBody");
  list.innerHTML = "";
  el("skSpoilsCount").textContent = state.spoils.length ? `${state.spoils.length} lots waiting` : "";

  if (!state.spoils.length) {
    list.innerHTML = '<div class="muted tiny">Nothing on the field. Loot waits here and costs no pack space until you claim it.</div>';
    el("skSpoilsActions").hidden = true;
    return;
  }
  el("skSpoilsActions").hidden = false;

  state.spoils.slice().reverse().forEach((s, i) => {
    const idx = state.spoils.length - 1 - i;
    const d = itemDef(s.key);
    const row = document.createElement("div");
    row.className = "spoil-row";
    row.innerHTML = `<div class="left">${icon(d.icon, "ico-sm")}<span></span></div>` +
      '<div class="sp-qty"></div>';
    const nm = row.querySelector("span");
    nm.textContent = itemName(s.key);
    if (d.rarity && d.rarity !== "common") nm.classList.add("rar-" + d.rarity);
    row.querySelector(".sp-qty").textContent = "×" + fmt(s.qty);

    const take = document.createElement("button");
    take.className = "minibtn";
    take.textContent = "Take";
    take.onclick = () => claimSpoil(idx);
    row.appendChild(take);

    const sellB = document.createElement("button");
    sellB.className = "minibtn";
    sellB.textContent = fmt(d.value * s.qty) + "g";
    sellB.title = "Sell without picking up";
    sellB.onclick = () => sellSpoil(idx);
    row.appendChild(sellB);

    list.appendChild(row);
  });
}

function renderMastery(skillId) {
  const lvl = skillLevel(skillId);
  const box = el("skMasteryBody");
  box.innerHTML = "";
  const m = mastery(skillId);
  const head = document.createElement("div");
  head.className = "mastery-summary";
  head.textContent = (m.speed || m.double)
    ? `+${Math.round(m.speed * 100)}% speed · +${Math.round(m.double * 100)}% double yield`
    : "No mastery earned yet.";
  box.appendChild(head);

  MASTERY_TRACK.forEach((step) => {
    const done = lvl >= step.level;
    const row = document.createElement("div");
    row.className = "mastery-row";
    row.innerHTML = `<div class="name"><span class="glyph${done ? " on" : ""}"></span><span></span></div><div class="val"></div>`;
    row.querySelector(".glyph").textContent = done ? "✓" : "·";
    row.querySelectorAll("span")[1].textContent = step.label;
    const val = row.querySelector(".val");
    val.textContent = done ? step.desc : "Lv " + step.level;
    if (done) val.classList.add("on");
    box.appendChild(row);
  });
}

function renderMilestones(skillId, lvl) {
  const box = el("skMilestones");
  box.innerHTML = "";
  const marks = [{ level: 1, desc: "Ground opened" }].concat(
    MASTERY_TRACK.map((m) => ({ level: m.level, desc: m.label })));
  marks.forEach((m) => {
    const d = document.createElement("div");
    d.className = "milestone" + (lvl >= m.level ? " done" : "");
    d.innerHTML = '<div class="lv"></div><div class="desc"></div>';
    d.children[0].textContent = "Lv " + m.level;
    d.children[1].textContent = m.desc;
    box.appendChild(d);
  });
}

function renderYieldFeed() {
  const box = el("skYieldFeed");
  box.innerHTML = "";
  if (!state.yields.length) {
    box.innerHTML = '<div class="log-item muted">Nothing yet.</div>';
    return;
  }
  state.yields.slice().reverse().forEach((y) => {
    const d = document.createElement("div");
    d.className = "log-item";
    d.innerHTML = '<span class="t"></span><span></span>';
    const ago = Date.now() - y.t;
    d.children[0].textContent = ago < 4000 ? "now" : fmtTime(ago);
    d.children[1].textContent = y.m;
    box.appendChild(d);
  });
}

/* ---- live per-frame updates (no DOM rebuild) ---- */

function updateLive() {
  const n = liveRefs.node;
  if (n) {
    const t = state.tasks.skilling;
    const active = t && t.skillId === n.skillId && t.actionId === n.def.id;
    const time = actionTime(n.def);
    if (active) {
      const pct = clamp((t.progress / time) * 100, 0, 100);
      n.bar.classList.toggle("nojump", pct < 6);
      n.bar.style.width = pct + "%";
      const plan = skillPlan();
      n.left.textContent = `${fmt(plan.done)} / ${fmt(plan.target)} actions`;
      n.right.textContent = fmtTime(plan.timeLeft) + " left";
    } else {
      n.bar.style.width = "0";
      const per12 = Math.floor(IDLE_CAP_MS / time);
      n.left.textContent = `${fmt(per12)} actions per 12h idle`;
      n.right.textContent = fmt(per12 * n.def.xp * xpMult()) + " XP";
    }
  }

  const m = liveRefs.monster;
  if (m) {
    const t = state.tasks.combat;
    const active = t && t.tier === m.tier;
    if (active) {
      m.bar.style.width = clamp(t.respawn > 0 ? 0 : (t.mobHp / t.mobMax) * 100, 0, 100) + "%";
      const plan = combatPlan();
      m.left.textContent = `${fmt(plan.done)} / ${fmt(plan.target)} kills`;
      m.right.textContent = fmtTime(plan.timeLeft) + " left";
    } else {
      m.bar.style.width = "100%";
      m.left.textContent = "Not engaged";
      m.right.textContent = "";
    }
  }
}

/* ================= CHARACTER PAGE ================= */

function renderCharacter() {
  const sig = SKILLS.map((s) => s.id + (state.skills[s.id] || 0)).join(",") + "|" +
    EQUIP_SLOTS.map((s) => state.equipment[s]).join(",") + "|" + state.stats.kills + "|" +
    (state.tasks.skilling ? state.tasks.skilling.actionId : "-") + "|" + (state.tasks.combat ? 1 : 0) +
    "|" + JSON.stringify(state.bounty);
  if (keys.char === sig) return;
  keys.char = sig;

  el("chName").textContent = state.meta.name || "Commander";
  el("chTags").innerHTML = `<span>Commander</span><span>${currentRegion().name}</span>`;
  el("chRegionTag").textContent = `In ${currentRegion().name}`;
  el("chTotal").textContent = "Lv " + totalLevel();

  const b = state.bounty;
  el("chBounty").innerHTML = b
    ? `Bounty <b>${fmt(Math.min(b.progress, b.amount))} / ${fmt(b.amount)}</b> · resets in ${fmtTime(windowEndsIn())}`
    : "";

  // activity cards
  const sp = skillPlan();
  const labour = el("chLabour");
  labour.innerHTML = "";
  if (sp) {
    labour.innerHTML =
      `<div class="task-name">${icon(sp.def.icon, "ico-sm")}<span></span></div>` +
      '<div class="bar"><i></i></div>' +
      '<div class="task-meta"><span></span><b></b></div>';
    labour.querySelector("span").textContent = titleCase(sp.def.name);
    labour.querySelector("i").style.width = sp.pct + "%";
    labour.querySelectorAll(".task-meta span")[0].textContent = `${fmt(sp.done)} / ${fmt(sp.target)} actions`;
    labour.querySelector("b").textContent = fmtTime(sp.timeLeft) + " left";
  } else {
    labour.innerHTML = '<div class="idle-block"><div class="big">No crews tasked</div>' +
      '<div>Your people are standing around. Put them on something.</div></div>';
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Open Delving";
    btn.onclick = () => go("skill", "delving");
    labour.querySelector(".idle-block").appendChild(btn);
  }

  const cp = combatPlan();
  const field = el("chField");
  field.innerHTML = "";
  if (cp) {
    field.innerHTML =
      `<div class="task-name">${icon(cp.mob.icon, "ico-sm")}<span></span></div>` +
      '<div class="bar mob"><i></i></div>' +
      '<div class="task-meta"><span></span><b></b></div>';
    field.querySelector("span").textContent = cp.mob.name;
    field.querySelector("i").style.width = cp.pct + "%";
    field.querySelectorAll(".task-meta span")[0].textContent = `${fmt(cp.done)} / ${fmt(cp.target)} kills`;
    field.querySelector("b").textContent = fmtTime(cp.timeLeft) + " left";
  } else {
    field.innerHTML = '<div class="idle-block"><div class="big"></div><div></div></div>';
    field.querySelector(".big").textContent = recovering() ? "Recovering" : "No quarry chosen";
    field.querySelectorAll(".idle-block div")[1].textContent = recovering()
      ? `Back on your feet in ${fmtTime(state.player.recoveryUntil - Date.now())}.`
      : "You take the field yourself. The camp keeps turning without you.";
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Open The Field";
    btn.onclick = () => go("skill", "warfare");
    field.querySelector(".idle-block").appendChild(btn);
  }

  // combat stat strip
  const strip = el("chStats");
  strip.innerHTML = "";
  [["Health", maxHp()], ["Attack", Math.round(attackPower())], ["Defence", Math.round(defencePower())],
   ["Kills", fmt(state.stats.kills)], ["Deaths", fmt(state.stats.deaths)], ["Gold Earned", fmt(state.stats.goldEarned)]]
    .forEach(([l, v]) => {
      const d = document.createElement("div");
      d.className = "stat-box";
      d.innerHTML = '<div class="v"></div><div class="l"></div>';
      d.children[0].textContent = v;
      d.children[1].textContent = l;
      strip.appendChild(d);
    });

  // skill grid
  const grid = el("chSkills");
  grid.innerHTML = "";
  SKILLS.forEach((s) => {
    const lvl = skillLevel(s.id);
    const xp = state.skills[s.id] || 0;
    const base = XP_TABLE[lvl], next = XP_TABLE[Math.min(lvl + 1, MAX_LEVEL)];
    const card = document.createElement("button");
    card.className = "skill-card";
    card.innerHTML =
      `<div class="top"><div class="name">${icon(s.icon, "ico-sm")}<span></span></div><div class="lvl"></div></div>` +
      '<div class="xp"></div><div class="bar"><i></i></div>';
    card.querySelector(".name span").textContent = s.name;
    card.querySelector(".lvl").textContent = "Lv " + lvl;
    card.querySelector(".xp").textContent = lvl >= MAX_LEVEL ? "Mastered" : `${fmt(xp)} / ${fmt(next)} XP`;
    card.querySelector("i").style.width =
      clamp(lvl >= MAX_LEVEL ? 100 : ((xp - base) / (next - base)) * 100, 0, 100) + "%";
    card.onclick = () => go("skill", s.id);
    grid.appendChild(card);
  });
}

/* ================= STORE PAGES (split pane) ================= */
/* Equipment & Pack and Camp Stores share one renderer. Each has its own
   grid plus a Bank tab, and Bank is the same 50-slot pool from either. */

const FILTERS = [
  { id: "all",       label: "ALL",  test: () => true },
  { id: "gear",      label: "Gear", icon: "blade", test: (d) => d.kind === "gear" },
  { id: "material",  label: "Mats", icon: "ore",   test: (d) => d.kind === "material" && !d.heal && !d.forSkill },
  { id: "provision", label: "Food", icon: "ration", test: (d) => !!d.heal },
  { id: "tool",      label: "Tools", icon: "pick", test: (d) => d.kind === "tool" },
];

function scopeTab(scope) { return scope === "eq" ? eqTab : campTab; }
function scopeStore(scope) {
  const tab = scopeTab(scope);
  if (tab === "bank") return "vault";
  return scope === "eq" ? "inv" : "bank";
}

function renderStorePage(scope) {
  storeView = scopeStore(scope);
  const s = store(storeView);
  const ids = sortedKeys(storeView);
  const sig = `${scope}|${scopeTab(scope)}|${storeView}|${ids.map((k) => k + ":" + s.items[k]).join(",")}` +
    `|${slotCap(storeView)}|${selected}|${gridFilter}|${gridSort}|${state.player.gold}`;

  if (keys.store !== sig) {
    keys.store = sig;
    const pre = scope === "eq" ? "eq" : "camp";

    document.querySelectorAll(`.tab-btn[data-scope="${scope}"]`).forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === scopeTab(scope)));

    el(pre + "Cap").textContent = `Capacity ${slotsUsed(storeView)} / ${slotCap(storeView)}`;
    renderFilters(pre);
    renderPillGrid(el(pre + "Grid"), ids);
    renderDetail(pre + "Detail");
  }

  if (scope === "eq") renderPaperdoll();
  else renderLedger();
}

function sortedKeys(w) {
  let ids = orderedKeys(w);
  const f = FILTERS.find((x) => x.id === gridFilter) || FILTERS[0];
  ids = ids.filter((k) => { const d = itemDef(k); return d && f.test(d); });

  if (gridSort === "rarity") {
    const order = { epic: 0, rare: 1, uncommon: 2, common: 3 };
    ids.sort((a, bb) => {
      const da = itemDef(a), db = itemDef(bb);
      const ra = order[da.rarity] != null ? order[da.rarity] : 4;
      const rb = order[db.rarity] != null ? order[db.rarity] : 4;
      return ra - rb || itemName(a).localeCompare(itemName(bb));
    });
  } else if (gridSort === "name") {
    ids.sort((a, bb) => itemName(a).localeCompare(itemName(bb)));
  }
  return ids;
}

function renderFilters(pre) {
  const box = el(pre + "Filters");
  box.innerHTML = "";
  FILTERS.forEach((f) => {
    const b = document.createElement("button");
    b.className = "ficon" + (gridFilter === f.id ? " active" : "");
    b.innerHTML = f.icon ? icon(f.icon, "ico-sm") : f.label;
    b.title = f.label;
    b.onclick = () => { gridFilter = f.id; keys.store = ""; renderStorePage(pre === "eq" ? "eq" : "camp"); };
    box.appendChild(b);
  });
  const sel = el(pre + "Sort");
  if (sel && sel.value !== gridSort) sel.value = gridSort;
}

function renderPillGrid(grid, ids) {
  grid.innerHTML = "";
  const cap = slotCap(storeView);
  const s = store(storeView);

  for (let i = 0; i < cap; i++) {
    const key = ids[i];
    const cell = document.createElement("div");

    if (!key) {
      cell.className = "item-pill empty";
      cell.innerHTML = '<div class="art"></div><div class="info"><div class="n">Empty</div><div class="r">Empty Slot</div></div>';
      grid.appendChild(cell);
      continue;
    }

    const d = itemDef(key);
    cell.className = `item-pill ${d.rarity || "common"}${key === selected ? " on" : ""}`;
    cell.tabIndex = 0;
    cell.innerHTML =
      `<div class="qty">${fmt(s.items[key])}</div>` +
      `<div class="art">${icon(d.icon, "ico-lg")}</div>` +
      '<div class="info"><div class="n"></div><div class="r"></div></div>';
    cell.querySelector(".n").textContent = itemName(key);
    cell.querySelector(".r").textContent = itemKindLabel(d);
    cell.title = `${itemName(key)} × ${s.items[key]}`;

    cell.draggable = true;
    cell.onclick = () => { selected = selected === key ? null : key; keys.store = ""; renderAll(); };
    cell.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cell.onclick(); } };
    cell.ondragstart = (e) => e.dataTransfer.setData("text/plain", key);
    cell.ondragover = (e) => { e.preventDefault(); cell.classList.add("dragover"); };
    cell.ondragleave = () => cell.classList.remove("dragover");
    cell.ondrop = (e) => {
      e.preventDefault(); cell.classList.remove("dragover");
      const from = e.dataTransfer.getData("text/plain");
      if (from && from !== key) reorder(from, key);
    };
    grid.appendChild(cell);
  }
}

function itemKindLabel(d) {
  if (d.kind === "gear") return rarityDef(d.rarity).name;
  if (d.kind === "tool") return "Tool";
  if (d.heal) return "Provision";
  if (d.chest) return "Component";
  return "Material";
}

function reorder(fromKey, toKey) {
  const ids = orderedKeys(storeView);
  const a = ids.indexOf(fromKey), b = ids.indexOf(toKey);
  if (a < 0 || b < 0) return;
  ids.splice(a, 1);
  ids.splice(b, 0, fromKey);
  store(storeView).order = ids;
  gridSort = "custom";
  keys.store = "";
  renderAll();
}

function renderDetail(targetId) {
  const box = el(targetId);
  box.innerHTML = "";
  if (!selected || !store(storeView).items[selected]) {
    box.innerHTML = '<div class="muted tiny">Select an item to equip, move or sell it.</div>';
    return;
  }

  const d = itemDef(selected);
  const qty = qtyIn(storeView, selected);

  const head = document.createElement("div");
  head.className = "detail-head";
  head.innerHTML = icon(d.icon, "ico-lg");
  const nm = document.createElement("div");
  nm.innerHTML = '<div class="dname"></div><div class="dsub muted tiny"></div>';
  nm.querySelector(".dname").textContent = itemName(selected);
  if (d.rarity) nm.querySelector(".dname").classList.add("rar-" + d.rarity);
  nm.querySelector(".dsub").textContent = `${itemKindLabel(d)} · ×${fmt(qty)} · ${fmt(d.value)}g each`;
  head.appendChild(nm);
  box.appendChild(head);

  const bits = [];
  if (d.attack) bits.push(`+${d.attack} attack`);
  if (d.defence) bits.push(`+${d.defence} defence`);
  if (d.health) bits.push(`+${d.health} max health`);
  if (d.heal) bits.push(`restores ${fmt(d.heal)}`);
  if (d.speed) bits.push(`+${Math.round(d.speed * 100)}% ${skillName(d.forSkill)} speed`);
  if (d.twoHanded) bits.push("two-handed");
  if (d.maxDur) bits.push(`${fmt(d.maxDur)} durability`);
  if (d.chest) bits.push(`+${d.chest} store slots`);
  if (bits.length) {
    const st = document.createElement("div");
    st.className = "detail-stats";
    st.textContent = bits.join(" · ");
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

  if (d.slot) add(`Equip · ${SLOT_LABELS[d.slot]}`, () => equip(selected), "btn-primary");
  if (d.kind === "tool") add(`Take up · ${skillName(d.forSkill)}`, () => equip(selected), "btn-primary");
  if (d.chest) add("Open chest", () => useChest(selected));

  // Move between any two of the three pools.
  const pools = [["inv", "Pack"], ["bank", "Stores"], ["vault", "Bank"]];
  pools.forEach(([w, label]) => {
    if (w === storeView) return;
    add(`→ ${label}`, () => moveTo(selected, w, false));
    add(`All → ${label}`, () => moveTo(selected, w, true), "btn-quiet");
  });

  const sv = salvageValue(selected);
  if (sv) add(`Break down · ${sv.qty}× ${itemName(sv.mat)}`, () => salvage(selected), "btn-quiet");
  add(`Sell 1 · ${fmt(d.value)}g`, () => sell(selected, false));
  if (qty > 1) add(`Sell all · ${fmt(d.value * qty)}g`, () => sell(selected, true), "btn-quiet");
  box.appendChild(row);
}

function moveTo(key, target, all) {
  const from = storeView;
  const qty = all ? qtyIn(from, key) : 1;
  if (qty <= 0) return;
  if (!store(target).items[key] && storeFull(target)) {
    say(`${target === "vault" ? "The bank" : target === "bank" ? "Camp stores" : "Your pack"} is full.`);
    render();
    return;
  }
  removeFrom(from, key, qty);
  addTo(target, key, qty);
  render();
}

/* ---- paperdoll: 4x2 with two-handed merge ---- */

function renderPaperdoll() {
  const sig = EQUIP_SLOTS.map((s) => s + state.equipment[s] + (state.wear[state.equipment[s]] || 0)).join(",");
  if (keys.doll === sig) return;
  keys.doll = sig;

  const twoH = state.equipment.weapon && itemDef(state.equipment.weapon).twoHanded;
  const grid = el("dollGrid");
  grid.innerHTML = "";

  DOLL_ORDER.forEach((slot) => {
    if (slot === "offhand" && twoH) return;   // merged away by the two-hander
    const key = state.equipment[slot];
    const d = key ? itemDef(key) : null;
    const box = document.createElement("div");
    box.className = `eq-slot slot-${slot} ` + (key ? (d.rarity || "common") : "empty") +
      (slot === "weapon" && twoH ? " merged" : "");
    box.innerHTML = `<span class="type">${SLOT_LABELS[slot]}</span>` +
      `<div class="art">${icon(d ? d.icon : slotGlyph(slot), twoH && slot === "weapon" ? "ico-xl" : "ico-lg")}</div>` +
      '<div class="name"></div>';
    box.querySelector(".name").textContent = key ? itemName(key) : "Empty";

    if (key) {
      const pct = wearPct(key);
      if (pct !== null) {
        const w = document.createElement("div");
        w.className = "eq-wear " + (pct > 60 ? "fine" : pct > 25 ? "worn" : "bad");
        w.textContent = pct + "%";
        box.appendChild(w);
      }
      const bar = document.createElement("div");
      bar.className = "eq-actions";
      const cost = repairCost(key);
      if (cost) {
        const fix = document.createElement("button");
        fix.className = "minibtn";
        fix.textContent = `Fix ${cost.qty}×`;
        fix.disabled = haveQty(cost.mat) < cost.qty;
        fix.title = `Uses ${cost.qty} ${itemName(cost.mat)}`;
        fix.onclick = (e) => { e.stopPropagation(); repairItem(key); };
        bar.appendChild(fix);
      }
      const off = document.createElement("button");
      off.className = "minibtn";
      off.textContent = "Remove";
      off.onclick = (e) => { e.stopPropagation(); unequip(slot); };
      bar.appendChild(off);
      box.appendChild(bar);
    }
    grid.appendChild(box);
  });

  el("dollName").textContent = state.meta.name || "Commander";
  el("dollSub").textContent = `Commander · ${currentRegion().name}`;
  el("dollSil").textContent = (state.meta.name || "C").charAt(0).toUpperCase();

  const stand = el("dollStanding");
  stand.innerHTML = "";
  [["Health", fmt(maxHp())], ["Attack Power", Math.round(attackPower()), "gold"],
   ["Defence", Math.round(defencePower())], ["Combat", "Lv " + skillLevel("warfare"), "good"],
   ["Pack Space", `${slotsUsed("inv")} / ${packSlots()}`]]
    .forEach(([l, v, cls]) => {
      const r = document.createElement("div");
      r.className = "stat-row";
      r.innerHTML = '<div class="l"></div><div class="v"></div>';
      r.children[0].textContent = l;
      r.children[1].textContent = v;
      if (cls) r.children[1].classList.add(cls);
      stand.appendChild(r);
    });
}

/* ---- camp ledger: tool rack + standing ---- */

function renderLedger() {
  const sig = JSON.stringify(state.tools) + slotsUsed("bank") + slotsUsed("vault") + state.player.gold + totalLevel();
  if (keys.ledger === sig) return;
  keys.ledger = sig;

  const tools = el("dollTools");
  tools.innerHTML = "";
  GATHER_SKILLS.forEach((s) => {
    const tool = toolFor(s.id);
    const box = document.createElement("div");
    box.className = "tool-slot" + (tool ? " filled" : "");
    box.innerHTML = `<span class="type">${skillName(s.id)}</span>` +
      `<div class="art">${icon(tool ? tool.icon : TOOL_SPEC[s.id].icon, "ico-lg")}</div>` +
      '<div class="name"></div>';
    box.querySelector(".name").textContent = tool ? tool.name : "Bare hands";
    if (tool) {
      const off = document.createElement("button");
      off.className = "minibtn";
      off.textContent = "Stow";
      off.onclick = () => unequipTool(s.id);
      box.appendChild(off);
    }
    tools.appendChild(box);
  });
  const res = document.createElement("div");
  res.className = "tool-slot reserved";
  res.innerHTML = '<span class="type">Reserved</span>' +
    `<div class="art">${icon("unknown", "ico-lg")}</div><div class="name">Scavenging</div>`;
  tools.appendChild(res);

  const list = el("dollLedger");
  list.innerHTML = "";
  const addRow = (l, v, cls) => {
    const r = document.createElement("div");
    r.className = "stat-row";
    r.innerHTML = '<div class="l"></div><div class="v"></div>';
    r.children[0].textContent = l;
    r.children[1].textContent = v;
    if (cls) r.children[1].classList.add(cls);
    list.appendChild(r);
  };
  addRow("Total Level", totalLevel(), "good");
  addRow("Gold on Hand", fmt(state.player.gold), "gold");
  addRow("Camp Stores", `${slotsUsed("bank")} / ${slotCap("bank")}`);
  addRow("Bank", `${slotsUsed("vault")} / ${slotCap("vault")}`);
  addRow("Actions Worked", fmt(state.stats.actions));
  addRow("Sovereigns Felled", fmt(state.stats.bosses || 0));
}

function slotGlyph(slot) {
  return { weapon: "blade", offhand: "ward", head: "cowl", chest: "plate",
    hands: "gauntlets", feet: "treads", neck: "charm", ring: "band" }[slot] || "unknown";
}

/* ================= OTHER PAGES ================= */

function renderAtlas() {
  const sig = state.region + state.travel.unlocked.join(",") + Math.floor(state.player.gold / 50);
  if (keys.atlas === sig) return;
  keys.atlas = sig;

  const box = el("atlasList");
  box.innerHTML = "";
  REGIONS.forEach((r) => {
    const unlocked = state.travel.unlocked.includes(r.id);
    const here = state.region === r.id;
    const card = document.createElement("button");
    card.className = "atlas-card" + (here ? " on" : "") + (unlocked ? "" : " locked");
    card.innerHTML =
      `<div class="atlas-top">${icon("atlas", "ico-lg")}<div><div class="atlas-name"></div>` +
      `<div class="atlas-tier"></div></div></div><div class="atlas-note"></div><div class="atlas-foot"></div>`;
    card.querySelector(".atlas-name").textContent = r.name;
    card.querySelector(".atlas-tier").textContent = `Tier ${r.tier} · gear and ground around Lv ${r.level}`;
    card.querySelector(".atlas-note").textContent = r.note;
    const foot = card.querySelector(".atlas-foot");
    if (here) { foot.className = "atlas-foot here"; foot.textContent = "You are here"; }
    else if (unlocked) { foot.className = "atlas-foot open"; foot.textContent = "Road open — travel free"; }
    else {
      foot.className = "atlas-foot cost" + (state.player.gold < r.toll ? " cant" : "");
      foot.textContent = `Toll ${fmt(r.toll)} gold`;
    }
    card.onclick = () => travelTo(r.id);
    box.appendChild(card);
  });
}

function renderShop() {
  el("smugglerTimer").textContent = `Moves on in ${fmtTime(windowEndsIn())}`;
  const sig = `${state.player.gold}|${currentWindow()}|${JSON.stringify(state.smugglerBought)}`;
  if (keys.shop === sig) return;
  keys.shop = sig;

  const stock = el("shopStock");
  stock.innerHTML = "";
  shopStock().forEach((entry) => {
    const d = itemDef(entry.key);
    const card = document.createElement("div");
    card.className = "shop-card";
    card.innerHTML = `<div class="shop-ico">${icon(d.icon, "ico-lg")}</div>` +
      '<div class="shop-body"><div class="shop-name"></div><div class="shop-sub"></div></div>';
    card.querySelector(".shop-name").textContent = d.name;
    card.querySelector(".shop-sub").textContent = `Restores ${fmt(d.heal)} health · ${fmt(entry.price)}g each`;
    const row = document.createElement("div");
    row.className = "btnrow";
    [1, 10, 50].forEach((n) => {
      const b = document.createElement("button");
      b.className = "btn btn-gold";
      b.textContent = `${n} · ${fmt(entry.price * n)}g`;
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
    card.className = "shop-card";
    card.innerHTML = `<div class="shop-ico">${icon(d.icon, "ico-lg")}</div>` +
      '<div class="shop-body"><div class="shop-name"></div><div class="shop-sub"></div></div>';
    card.querySelector(".shop-name").textContent = `${entry.qty}× ${d.name}`;
    card.querySelector(".shop-sub").textContent = `Tier ${d.tier} · ${fmt(entry.price)}g the lot`;
    const b = document.createElement("button");
    b.className = "btn btn-gold";
    b.textContent = bought ? "Already dealt" : `Buy · ${fmt(entry.price)}g`;
    b.disabled = bought || state.player.gold < entry.price;
    b.onclick = () => buySmuggler(entry);
    card.appendChild(b);
    sm.appendChild(card);
  });
}

function renderBounty() {
  refreshBounty();
  el("bountyTimer").textContent = `New posting in ${fmtTime(windowEndsIn())}`;
  const b = state.bounty;
  const sig = JSON.stringify(b);
  if (keys.bounty === sig) return;
  keys.bounty = sig;

  const box = el("bountyBox");
  box.innerHTML = "";
  if (!b) return;

  const card = document.createElement("div");
  card.className = "bounty-card";
  card.innerHTML =
    '<h3 class="bounty-title"></h3><div class="muted tiny"></div>' +
    '<div class="bar"><i></i></div><div class="bounty-reward"></div>';
  card.querySelector(".bounty-title").textContent = b.label;
  card.querySelector(".tiny").textContent = `Posted for ${regionById(b.region).name}.`;
  card.querySelector("i").style.width = clamp((b.progress / b.amount) * 100, 0, 100) + "%";
  card.querySelector(".bounty-reward").textContent =
    `${fmt(Math.min(b.progress, b.amount))} of ${fmt(b.amount)} · pays ${fmt(b.gold)} gold and an hour of double experience.`;

  const btn = document.createElement("button");
  btn.className = "btn btn-gold";
  btn.textContent = b.claimed ? "Paid out" : (b.progress >= b.amount ? "Claim" : "Not finished");
  btn.disabled = b.claimed || b.progress < b.amount;
  btn.onclick = claimBounty;
  card.appendChild(btn);
  box.appendChild(card);
}

function renderKennel() {
  const sig = JSON.stringify(state.pets) + state.player.gold;
  if (keys.kennel === sig) return;
  keys.kennel = sig;

  const box = el("petList");
  box.innerHTML = "";
  PETS.forEach((pet) => {
    const owned = state.pets[pet.id];
    const card = document.createElement("div");
    card.className = "pet-card" + (owned ? " owned" : "");
    card.innerHTML =
      `<div class="pet-art">${icon(pet.icon, "ico-xl")}</div>` +
      '<div class="pet-body"><div class="pet-name"></div><div class="pet-note"></div>' +
      '<div class="pet-effect"></div></div>';
    card.querySelector(".pet-name").textContent = pet.name;
    card.querySelector(".pet-note").textContent = pet.note;
    card.querySelector(".pet-effect").textContent = pet.effect;

    const b = document.createElement("button");
    b.className = "btn " + (owned ? "btn-quiet" : "btn-gold");
    b.textContent = owned ? "In the kennel" : `Buy · ${fmt(pet.cost)}g`;
    b.disabled = owned || state.player.gold < pet.cost;
    b.onclick = () => buyPet(pet.id);
    card.appendChild(b);
    box.appendChild(card);
  });

  el("kennelNote").textContent = Object.values(state.pets).some(Boolean)
    ? "Bound to the camp permanently. They work whether you're here or not."
    : "Nothing bound yet. Gold buys hands that never tire.";
}

function renderLog() {
  const sig = state.log.length + "|" + (state.log.length ? state.log[state.log.length - 1].m : "");
  if (keys.log === sig) return;
  keys.log = sig;
  const box = el("eventLog");
  box.innerHTML = "";
  state.log.slice(-8).forEach((e) => {
    const d = document.createElement("div");
    d.className = "log-item";
    d.innerHTML = '<span class="t"></span><span></span>';
    const ago = Date.now() - e.t;
    d.children[0].textContent = ago < 4000 ? "now" : fmtTime(ago);
    d.children[1].textContent = e.m;
    box.appendChild(d);
  });
}

/* ================= 27. WIRING ================= */

el("brandMark").innerHTML = icon("moon", "ico-sm");
el("coinIcon").innerHTML = icon("coin", "ico-sm");

document.querySelectorAll(".icon-btn").forEach((b) => { b.onclick = () => go(b.dataset.page); });
document.querySelectorAll(".pill-head").forEach((b) => { b.onclick = () => toggleNav(b.dataset.nav); });
document.querySelectorAll(".tab-btn").forEach((b) => {
  b.onclick = () => {
    if (b.dataset.scope === "eq") eqTab = b.dataset.tab; else campTab = b.dataset.tab;
    selected = null;
    keys.store = "";
    renderAll();
  };
});

["eqSort", "campSort"].forEach((id) => {
  const sel = el(id);
  if (sel) sel.onchange = () => { gridSort = sel.value; keys.store = ""; renderAll(); };
});

el("spoilsClaimAll").onclick = claimAllSpoils;
el("spoilsSellAll").onclick = () => {
  for (let i = state.spoils.length - 1; i >= 0; i--) sellSpoil(i);
  toast("Spoils sold");
};

el("tbTradesClear").onclick = () => {
  const t = state.tasks.skilling;
  if (!t) return;
  t.queued = t.queued === "stop" ? null : "stop";
  say(t.queued ? "Crews will stand down once this action finishes." : "Stand-down cancelled.");
  render();
};
el("tbFieldClear").onclick = () => {
  const t = state.tasks.combat;
  if (!t) return;
  t.queued = t.queued === "stop" ? null : "stop";
  say(t.queued ? "Pulling back once this fight finishes." : "Pull-back cancelled.");
  render();
};

el("settingsBtn").onclick = () => { el("shareBox").value = exportSave(); refreshAccountUi(); el("settingsModal").hidden = false; };
el("settingsClose").onclick = () => { el("settingsModal").hidden = true; };

function refreshAccountUi() {
  const a = state.meta.account;
  const cloud = !!sb;
  el("acctStatus").textContent = a
    ? `Signed in as ${a}${cloud ? " — syncing to the cloud" : " — this browser only"}.`
    : cloud ? "Playing as a guest. Make an account to play from any device."
            : "Playing as a guest, this browser only.";
  el("acctFields").hidden = !!a;
  el("acctCreate").hidden = !!a;
  el("acctLogin").hidden = !!a;
  el("acctLogout").hidden = !a;
  el("nameField").value = state.meta.name || "Commander";
}

el("acctCreate").onclick = async () => {
  el("acctCreate").disabled = true;
  el("acctNote").textContent = "Working...";
  const err = await createAccount(el("acctUser").value, el("acctPass").value);
  el("acctCreate").disabled = false;
  el("acctNote").textContent = err || `Signed in as ${state.meta.account}.`;
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

el("nameSave").onclick = () => {
  const v = (el("nameField").value || "").trim().slice(0, 18);
  if (v) { state.meta.name = v; save(); toast("Name set"); render(); }
};

el("shareCopy").onclick = () => {
  const box = el("shareBox");
  box.select();
  navigator.clipboard.writeText(box.value).then(() => toast("Save string copied")).catch(() => toast("Select and copy manually"));
};
el("shareLoad").onclick = () => {
  if (!confirm("Loading a save replaces your current character. Continue?")) return;
  toast(importSave(el("shareBox").value) || "Save loaded");
};
el("saveBtn").onclick = () => { if (save()) toast("Saved"); };
el("wipeBtn").onclick = () => {
  if (!confirm("Delete this save permanently?")) return;
  try { localStorage.removeItem(saveKey()); } catch (e) {}
  location.reload();
};

/* ================= 28. BOOT + LOOP ================= */

const away = bootLoad();
if (away) catchUp(away);
refreshBounty();
if (state.log.length === 0) {
  say("You take command of a ruin. There are people here who will work if you tell them what to do.");
}
route = parseHash();
render();
resumeCloudSession();

let lastTick = Date.now();

function loop() {
  const now = Date.now();
  const dt = now - lastTick;
  lastTick = now;
  if (dt > 0) { tick(Math.min(dt, 60000)); state.meta.playtimeMs += Math.min(dt, 60000); }

  renderTopbar();
  if (route.page === "skill") updateLive();
  if (route.page === "character") renderCharacter();
  if (route.page === "equipment") renderStorePage("eq");
  if (route.page === "camp") renderStorePage("camp");
  renderSidebar();
  renderLog();
}

setInterval(loop, 60);
setInterval(() => { if (route.page === "skill") renderYieldFeed(); }, 2000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { lastTick = Date.now(); render(); } });
setInterval(save, 10000);
window.addEventListener("beforeunload", save);
