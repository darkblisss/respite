/* ============================================================
   Respite — data.js · The Encyclopedia
   ------------------------------------------------------------
   Constants, static tables, and everything generated from them.
   Nothing in this file reads or writes the save.

   Load order (index.html):
   data.js → utils.js → cloud.js → combat.js → engine.js → ui.js
   ============================================================ */

/* ================= 1. CONSTANTS ================= */

const SCHEMA = 6;
const IDLE_CAP_MS = 12 * 60 * 60 * 1000;
const WINDOW_MS = 12 * 60 * 60 * 1000;      // bounty + smuggler refresh, on world clock
const DAY_MS = 24 * 60 * 60 * 1000;         // weather window
const WEEK_MS = 7 * DAY_MS;
const MAX_LEVEL = 99;
const PLAYER_SWING_MS = 2400;
const RESPAWN_MS = 2000;
const PACK_SLOTS = 18;
const STORES_SLOTS = 30;   // camp stores
const BANK_SLOTS = 50;     // shared bank, reachable from either page
const BANK_MAX = 200;
const RECOVERY_MS = 5 * 60 * 1000;   // knocked out of the fight after a death
const DEATH_WEAR = 25;               // extra durability every worn piece loses on death
const THREAT_CAP = 100;
const SPOILS_CAP = 40;
const CLASS_PICK_LEVEL = 5;
const VEIL_MAX = 100;
const VEIL_PER_HIT = 18;
const REQUISITIONS_PER_DAY = 3;
const AGENT_HIRE_COST = 2500;
const AGENT_ROSTER_MAX = 12;

// What each storage pool is called on screen.
const STORE_NAMES = { inv: "Pack", bank: "Camp Stores", vault: "Bank" };

/* ================= 2. EQUIPMENT SLOTS ================= */

const EQUIP_SLOTS = ["weapon", "offhand", "head", "chest", "hands", "feet", "neck", "ring"];
const SLOT_LABELS = {
  weapon: "Weapon", offhand: "Offhand", head: "Head", chest: "Chest",
  hands: "Hands", feet: "Feet", neck: "Neck", ring: "Ring",
};

// Row 1 / Row 2 of the 4x2 paperdoll. A two-hander makes Weapon span both.
const DOLL_ORDER = ["weapon", "head", "chest", "hands", "offhand", "feet", "neck", "ring"];

// Placeholder art for an empty paperdoll slot.
const SLOT_GLYPHS = {
  weapon: "blade", offhand: "ward", head: "cowl", chest: "plate",
  hands: "gauntlets", feet: "treads", neck: "charm", ring: "band",
};

/* ================= 3. RARITIES & RELIC PREFIXES ================= */

const RARITIES = [
  { key: "common",    name: "Common",    mult: 1.00, chance: 0.800 },
  { key: "uncommon",  name: "Uncommon",  mult: 1.10, chance: 0.145 },
  { key: "rare",      name: "Rare",      mult: 1.20, chance: 0.040 },
  { key: "epic",      name: "Epic",      mult: 1.30, chance: 0.012 },
  { key: "legendary", name: "Legendary", mult: 1.50, chance: 0.0025 },
  { key: "relic",     name: "Relic",     mult: 1.50, chance: 0.0005 },
];
const rarityDef = (k) => RARITIES.find((r) => r.key === k) || RARITIES[0];

/* Relics roll a prefix on top of Legendary stats. The prefix becomes part
   of the item's name — "Echoing Slag Sword" — and carries one effect. */
const WEAPON_PREFIXES = [
  { id: "echoing",     name: "Echoing",      effect: "Chance to strike twice" },
  { id: "sundering",   name: "Sundering",    effect: "Ignores some Defence" },
  { id: "furious",     name: "Furious",      effect: "Consecutive hits build damage" },
  { id: "executioner", name: "Executioner's", effect: "Hits harder on wounded foes" },
  { id: "wounding",    name: "Wounding",     effect: "Chance to inflict Bleed" },
];
const ARMOUR_PREFIXES = [
  { id: "stalwart",  name: "Stalwart",  effect: "Chance to blunt incoming damage" },
  { id: "vital",     name: "Vital",     effect: "Improves health and recovery" },
  { id: "thorned",   name: "Thorned",   effect: "Reflects some damage taken" },
  { id: "resilient", name: "Resilient", effect: "Hardens when badly hurt" },
  { id: "bulwark",   name: "Bulwark",   effect: "Improves Defence" },
];
const ALL_PREFIXES = WEAPON_PREFIXES.concat(ARMOUR_PREFIXES);
const prefixDef = (id) => ALL_PREFIXES.find((p) => p.id === id) || null;

/* ================= 4. XP CURVE ================= */

const XP_TABLE = (() => {
  const t = [0];
  for (let L = 1; L <= MAX_LEVEL; L++) {
    t[L] = Math.floor(65 * (L - 1) + 5 * Math.pow(L - 1, 2.5) + 2.5 * Math.pow(1.165, L - 1) - 2.5);
  }
  return t;
})();

/* ================= 5. TIERS ================= */

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

// Tier -> chance the reagent drops alongside the resource. T1/T2 have
// dedicated nodes instead, so they sit at 0 here.
const REAGENT_CHANCES = [0, 0, 0, 0.0125, 0.025, 0.0375, 0.05, 0.0625, 0.075, 0.10];

const basePrefix = (name) => name.split(" ")[0];
const slug = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

/* ================= 6. SKILLS ================= */

/* Five reagents, global — one per gathering skill, no tier prefix.
   Recipes ask for "T reagent", meaning tier-many of them: a T9 bar needs
   9 Coal. Dedicated nodes exist in T1 and T2; from T3 on they drop
   alongside the main resource at an increasing chance. */
const REAGENTS = [
  { id: "coal",       name: "Coal",       icon: "coalIco",   skill: "delving",    category: "Reagent" },
  { id: "resin",      name: "Resin",      icon: "resinIco",  skill: "felling",    category: "Reagent" },
  { id: "pulp",       name: "Pulp",       icon: "pulpIco",   skill: "harvesting", category: "Reagent" },
  { id: "tallow",     name: "Tallow",     icon: "tallowIco", skill: "flaying",    category: "Reagent" },
  { id: "veil_shard", name: "Veil Shard", icon: "shardIco",  skill: "dredging",   category: "Reagent" },
];
const reagentOf = (skillId) => REAGENTS.find((r) => r.skill === skillId);

/* `note` is the quiet caption under the skill's XP bar.
   `lore` is the bullet list in the Mastery tooltip on gathering pages. */
const GATHER_SKILLS = [
  { id: "delving",    name: "Delving",    icon: "pick",   mat: "delve",   resource: "Ore",    reagent: "coal",       matIcon: "ore",
    note: "Ore and coal, hauled up by lamplight.",
    lore: [
      "Gather ore and coal for Delving XP.",
      "The Forgemaster smelts ore into bars for plate, blades and tools.",
      "Pickaxes from the Forgemaster make crews faster.",
    ] },
  { id: "felling",    name: "Felling",    icon: "axe",    mat: "fell",    resource: "Timber", reagent: "resin",      matIcon: "log",
    note: "Timber and resin from trees that fought back.",
    lore: [
      "Gather timber and resin for Felling XP.",
      "The Woodwright cuts timber into planks for bows, shields and hafts.",
      "Axes from the Woodwright make crews faster.",
    ] },
  { id: "harvesting", name: "Harvesting", icon: "sickle", mat: "harvest", resource: "Fibre",  reagent: "pulp",       matIcon: "fibre",
    note: "Fibre and pulp from ground that grows too well.",
    lore: [
      "Gather fibre and pulp for Harvesting XP.",
      "The Weaver spins fibre into weave for robes, bowstrings and tomes.",
      "Sickles from the Weaver make crews faster.",
    ] },
  { id: "flaying",    name: "Flaying",    icon: "knife",  mat: "flay",    resource: "Hides",  reagent: "tallow",     matIcon: "hide",
    note: "Hides and tallow. Nothing is wasted.",
    lore: [
      "Gather hides and tallow for Flaying XP.",
      "The Tanner cures hides into leather for jackets, grips and bindings.",
      "Knives from the Tanner make crews faster.",
    ] },
  { id: "dredging",   name: "Dredging",   icon: "net",    mat: "dredge",  resource: "Finds",  reagent: "veil_shard", matIcon: "gem",
    note: "Finds and veil shards, pulled from black water.",
    lore: [
      "Gather finds and veil shards for Dredging XP.",
      "The Artificer sets finds into inlays for staves, grimoires and clasps.",
      "Nets from the Artificer make crews faster.",
    ] },
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
  .concat(GATHER_SKILLS.map((s) => ({ id: s.id, name: s.name, icon: s.icon, kind: "gather", note: s.note })))
  .concat(PROFESSIONS.map((p) => ({ id: p.id, name: p.name, icon: p.icon, kind: "craft", note: p.note })))
  .concat([{ id: "warfare", name: "Combat", icon: "swords", kind: "war", note: "You take the vanguard." }]);

const skillDef = (id) => SKILLS.find((s) => s.id === id);
const skillName = (id) => (skillDef(id) ? skillDef(id).name : id);
const gatherSkillDef = (id) => GATHER_SKILLS.find((s) => s.id === id) || null;

/* ================= 7. GENERATED ECONOMY ================= */

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

REAGENTS.forEach((r) => {
  MATERIALS[r.id] = { id: r.id, name: r.name, icon: r.icon, kind: "material",
    category: "Reagent", value: 8, tier: 1, reagent: true };
});

// Every artisan recipe unlocks at its tier's level: 1, 10, 20 … 80.
CRAFT_ACTIONS.woodwright.push({
  id: "craft_vault_chest", skillId: "woodwright", tier: 2, name: "Banded Chest", icon: "crate",
  level: TIERS[1].level, time: 45000, xp: 8, cost: { [matId(TIERS[1], "fell")]: 20 }, out: { vault_chest: 1 }
});

// Generation Setup
const compTime = (t) => (45 + 75 * t) * 1000;
const gearTime = (t) => (90 + 150 * t) * 1000;
const statPwr = (t) => 4 * Math.pow(1.52, t - 1);
const valBase = (t) => 4 * Math.pow(2.05, t - 1);

function addMat(id, name, icon, tier, valMult, category) {
  MATERIALS[id] = { id, name, icon, kind: "material",
    value: Math.round(valBase(tier) * valMult), tier, category: category || "Component" };
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

// A recipe's level is its tier's level. Gear recipes produce a rolled item
// (craftGear); everything else produces one of `id` (out).
function addCraft(prof, id, name, icon, tier, time, xpScale, cost, isGear) {
  CRAFT_ACTIONS[prof].push({
    id: `craft_${id}`, skillId: prof, tier, name, icon,
    level: TIERS[tier - 1].level, time, xp: Math.round(TIERS[tier - 1].xp * xpScale) + 1,
    cost, [isGear ? "craftGear" : "out"]: isGear ? id : { [id]: 1 },
  });
}

TIERS.forEach((t) => {
  const tier = t.i;
  const tDelve = basePrefix(t.delve);
  const tFell = basePrefix(t.fell);
  const tHarv = basePrefix(t.harvest);
  const tFlay = basePrefix(t.flay);
  const tDred = basePrefix(t.dredge);

  // 1. RAW MATERIALS & GATHER ACTIONS
  GATHER_SKILLS.forEach((s) => {
    const rawId = matId(t, s.mat);
    const reag = MATERIALS[s.reagent];
    addMat(rawId, t[s.mat], s.matIcon, tier, 1.0, s.resource);

    if (!GATHER_ACTIONS[s.id]) GATHER_ACTIONS[s.id] = [];

    if (tier === 1 || tier === 2) {
      // Dedicated reagent ground. Same level as the tier — never gated
      // behind extra levels, so it's workable the moment you arrive.
      GATHER_ACTIONS[s.id].push({
        id: `${s.id}_t${tier}_raw`, skillId: s.id, tier, name: `Gather ${t[s.mat]}`, icon: s.matIcon,
        level: t.level, time: t.time, xp: t.xp, out: { [rawId]: 1 }
      });
      GATHER_ACTIONS[s.id].push({
        id: `${s.id}_t${tier}_reag`, skillId: s.id, tier, name: `Gather ${reag.name}`, icon: reag.icon,
        level: t.level, time: t.time, xp: t.xp, out: { [s.reagent]: 1 }
      });
    } else {
      GATHER_ACTIONS[s.id].push({
        id: `${s.id}_t${tier}`, skillId: s.id, tier, name: `Gather ${t[s.mat]}`, icon: s.matIcon,
        level: t.level, time: t.time, xp: t.xp, out: { [rawId]: 1 },
        reagentId: s.reagent, reagentChance: REAGENT_CHANCES[tier]
      });
    }
  });

  const coal = "coal", resin = "resin", pulp = "pulp", tallow = "tallow", shard = "veil_shard";

  // 2. REFINED MATERIALS
  const bar = `${slug(tDelve)}_bar`;
  const plank = `${slug(tFell)}_plank`;
  const weave = `${slug(tHarv)}_weave`;
  const leather = `${slug(tFlay)}_leather`;
  const inlay = `${slug(tDred)}_inlay`;

  addMat(bar, `${tDelve} Bar`, "ore", tier, 3.5, "Bars");
  addMat(plank, `${tFell} Plank`, "log", tier, 3.5, "Planks");
  addMat(weave, `${tHarv} Weave`, "fibre", tier, 3.5, "Weave");
  addMat(leather, `${tFlay} Leather`, "hide", tier, 3.5, "Leather");
  addMat(inlay, `${tDred} Inlay`, "gem", tier, 3.5, "Inlays");

  addCraft("forgemaster", bar, MATERIALS[bar].name, "ore", tier, t.time, 0.5, { [matId(t, "delve")]: 2, [coal]: tier });
  addCraft("woodwright", plank, MATERIALS[plank].name, "log", tier, t.time, 0.5, { [matId(t, "fell")]: 2, [resin]: tier });
  addCraft("weaver", weave, MATERIALS[weave].name, "fibre", tier, t.time, 0.5, { [matId(t, "harvest")]: 2, [pulp]: tier });
  addCraft("tanner", leather, MATERIALS[leather].name, "hide", tier, t.time, 0.5, { [matId(t, "flay")]: 2, [tallow]: tier });
  addCraft("artificer", inlay, MATERIALS[inlay].name, "gem", tier, t.time, 0.5, { [matId(t, "dredge")]: 10, [shard]: tier * 2 });

  // 3. COMPONENTS
  const blade = `${slug(tDelve)}_blade`;
  const handle = `${slug(tFell)}_handle`;
  const score = `${slug(tFell)}_score`;
  const bind = `${slug(tFlay)}_bind`;
  const stave = `${slug(tFell)}_stave`;
  const string = `${slug(tHarv)}_string`;
  const grip = `${slug(tFlay)}_grip`;
  const shaft = `${slug(tFell)}_shaft`;
  const head = `${slug(tDelve)}_head`;
  const gblade = `${slug(tDelve)}_gblade`;
  const ggrip = `${slug(tFell)}_ggrip`;
  const book = `${slug(tHarv)}_book`;
  const clasp = `${slug(tDred)}_clasp`;

  addMat(blade, `${tDelve} Blade`, "blade", tier, 10, "Component");
  addMat(handle, `${tFell} Handle`, "log", tier, 10, "Component");
  addMat(score, `${tFell} Shield Core`, "ward", tier, 10, "Component");
  addMat(bind, `${tFlay} Binding`, "hide", tier, 6, "Component");
  addMat(stave, `${tFell} Bow Stave`, "stave", tier, 10, "Component");
  addMat(string, `${tHarv} Bowstring`, "fibre", tier, 8, "Component");
  addMat(grip, `${tFlay} Grip`, "hide", tier, 8, "Component");
  addMat(shaft, `${tFell} Shaft`, "stave", tier, 10, "Component");
  addMat(head, `${tDelve} Staff Head`, "gem", tier, 10, "Component");
  addMat(gblade, `${tDelve} Great Blade`, "greatblade", tier, 14, "Component");
  addMat(ggrip, `${tFell} Great Grip`, "log", tier, 10, "Component");
  addMat(book, `${tHarv} Book Tome`, "book", tier, 14, "Component");
  addMat(clasp, `${tDred} Clasp`, "gem", tier, 6, "Component");

  const cTime = compTime(tier);
  addCraft("forgemaster", blade, MATERIALS[blade].name, "blade", tier, cTime, 1.2, { [bar]: 12, [coal]: tier });
  addCraft("woodwright", handle, MATERIALS[handle].name, "log", tier, cTime, 1.2, { [plank]: 8, [leather]: 5, [resin]: tier });
  addCraft("woodwright", score, MATERIALS[score].name, "ward", tier, cTime, 1.2, { [bar]: 11, [plank]: 8, [resin]: tier });
  addCraft("tanner", bind, MATERIALS[bind].name, "hide", tier, cTime, 1.0, { [leather]: 6, [tallow]: tier });
  addCraft("woodwright", stave, MATERIALS[stave].name, "stave", tier, cTime, 1.2, { [plank]: 14, [resin]: tier });
  addCraft("weaver", string, MATERIALS[string].name, "fibre", tier, cTime, 1.2, { [weave]: 12, [pulp]: tier });
  addCraft("tanner", grip, MATERIALS[grip].name, "hide", tier, cTime, 1.2, { [leather]: 12, [tallow]: tier });
  addCraft("woodwright", shaft, MATERIALS[shaft].name, "stave", tier, cTime, 1.2, { [plank]: 13, [resin]: tier });
  addCraft("artificer", head, MATERIALS[head].name, "gem", tier, cTime, 1.2, { [bar]: 13, [inlay]: 2, [shard]: tier });
  addCraft("forgemaster", gblade, MATERIALS[gblade].name, "greatblade", tier, cTime, 1.4, { [bar]: 14, [coal]: tier });
  addCraft("woodwright", ggrip, MATERIALS[ggrip].name, "log", tier, cTime, 1.4, { [plank]: 12, [leather]: 6, [resin]: tier });
  addCraft("weaver", book, MATERIALS[book].name, "book", tier, cTime, 1.4, { [weave]: 26, [pulp]: tier });
  addCraft("artificer", clasp, MATERIALS[clasp].name, "gem", tier, cTime, 1.0, { [inlay]: 2, [shard]: tier });

  // 4. GEAR (Weapons & Armor)
  const gTime = gearTime(tier);
  const dur = 400 + tier * 220;

  const wSword = `${slug(tDelve)}_sword`;
  const wDagger = `${slug(tDelve)}_dagger`;
  const wShield = `${slug(tFell)}_shield`;
  const wBow = `${slug(tFell)}_bow`;
  const wStaff = `${slug(tDred)}_staff`;
  const wGsword = `${slug(tDelve)}_greatsword`;
  const wGrimoire = `${slug(tDred)}_grimoire`;

  addGear(wSword, `${tDelve} Sword`, "blade", "weapon", tier, "forgemaster", 1.0, 0.15, 0, false, dur);
  addGear(wDagger, `${tDelve} Dagger`, "blade", "weapon", tier, "forgemaster", 1.15, 0, 0, false, dur);
  addGear(wShield, `${tFell} Shield`, "ward", "offhand", tier, "woodwright", 0, 0.9, 0, false, dur);
  addGear(wBow, `${tFell} Bow`, "stave", "weapon", tier, "woodwright", 1.4, 0.1, 0, true, dur);
  addGear(wStaff, `${tDred} Staff`, "stave", "weapon", tier, "artificer", 1.2, 0.3, 0, true, dur);
  addGear(wGsword, `${tDelve} Greatsword`, "greatblade", "weapon", tier, "forgemaster", 1.75, 0, 0, true, dur);
  addGear(wGrimoire, `${tDred} Grimoire`, "book", "offhand", tier, "artificer", 0.3, 0.5, 0.6, false, dur);

  addCraft("forgemaster", wSword, GEAR[wSword].name, "blade", tier, gTime, 2.5, { [blade]: 1, [handle]: 1 }, true);
  addCraft("forgemaster", wDagger, GEAR[wDagger].name, "blade", tier, gTime, 2.5, { [blade]: 1, [handle]: 1 }, true);
  addCraft("woodwright", wShield, GEAR[wShield].name, "ward", tier, gTime, 2.5, { [score]: 1, [bind]: 1 }, true);
  addCraft("woodwright", wBow, GEAR[wBow].name, "stave", tier, gTime, 2.8, { [stave]: 1, [string]: 1, [grip]: 1 }, true);
  addCraft("artificer", wStaff, GEAR[wStaff].name, "stave", tier, gTime, 2.8, { [shaft]: 1, [head]: 1, [bind]: 1 }, true);
  addCraft("forgemaster", wGsword, GEAR[wGsword].name, "greatblade", tier, gTime, 3.2, { [gblade]: 1, [ggrip]: 1, [bind]: 1 }, true);
  addCraft("artificer", wGrimoire, GEAR[wGrimoire].name, "book", tier, gTime, 3.2, { [book]: 1, [bind]: 1, [clasp]: 1 }, true);

  // Heavy Armor (Forgemaster)
  const aHH = `${slug(tDelve)}_helm`;
  const aHC = `${slug(tDelve)}_chest`;
  const aHB = `${slug(tDelve)}_hboots`;
  const aHG = `${slug(tDelve)}_hgaunts`;

  addGear(aHH, `${tDelve} Helm`, "cowl", "head", tier, "forgemaster", 0, 0.55, 0, false, dur);
  addGear(aHC, `${tDelve} Chestplate`, "plate", "chest", tier, "forgemaster", 0, 1.0, 0, false, dur);
  addGear(aHB, `${tDelve} Boots`, "treads", "feet", tier, "forgemaster", 0, 0.7, 0, false, dur);
  addGear(aHG, `${tDelve} Gauntlets`, "gauntlets", "hands", tier, "forgemaster", 0.1, 0.4, 0, false, dur);

  [aHH, aHC, aHB, aHG].forEach((id) => {
    addCraft("forgemaster", id, GEAR[id].name, GEAR[id].icon, tier, gTime, 2.5, { [bar]: 20, [coal]: tier }, true);
  });

  // Medium Armor (Tanner)
  const aMH = `${slug(tFlay)}_hood`;
  const aMC = `${slug(tFlay)}_jacket`;
  const aMB = `${slug(tFlay)}_mboots`;
  const aMG = `${slug(tFlay)}_mgloves`;

  addGear(aMH, `${tFlay} Hood`, "cowl", "head", tier, "tanner", 0, 0.4, 0.2, false, dur);
  addGear(aMC, `${tFlay} Jacket`, "shroud", "chest", tier, "tanner", 0.1, 0.7, 0, false, dur);
  addGear(aMB, `${tFlay} Boots`, "treads", "feet", tier, "tanner", 0, 0.45, 0, false, dur);
  addGear(aMG, `${tFlay} Gloves`, "gauntlets", "hands", tier, "tanner", 0.18, 0.32, 0, false, dur);

  [aMH, aMC, aMB, aMG].forEach((id) => {
    addCraft("tanner", id, GEAR[id].name, GEAR[id].icon, tier, gTime, 2.5, { [leather]: 20, [tallow]: tier }, true);
  });

  // Light Armor (Weaver)
  const aLH = `${slug(tHarv)}_hood`;
  const aLC = `${slug(tHarv)}_robe`;
  const aLB = `${slug(tHarv)}_lboots`;
  const aLG = `${slug(tHarv)}_lgloves`;

  addGear(aLH, `${tHarv} Hood`, "cowl", "head", tier, "weaver", 0, 0.3, 0.8, false, dur);
  addGear(aLC, `${tHarv} Robe`, "shroud", "chest", tier, "weaver", 0.18, 0.4, 1.2, false, dur);
  addGear(aLB, `${tHarv} Boots`, "treads", "feet", tier, "weaver", 0, 0.2, 0.5, false, dur);
  addGear(aLG, `${tHarv} Gloves`, "gauntlets", "hands", tier, "weaver", 0.22, 0.15, 0.4, false, dur);

  [aLH, aLC, aLB, aLG].forEach((id) => {
    addCraft("weaver", id, GEAR[id].name, GEAR[id].icon, tier, gTime, 2.5, { [weave]: 20, [pulp]: tier }, true);
  });

  // 5. TOOLS
  const pPick = `${slug(tDelve)}_pick`;
  const pAxe = `${slug(tFell)}_axe`;
  const pSick = `${slug(tHarv)}_sickle`;
  const pKni = `${slug(tFlay)}_knife`;
  const pNet = `${slug(tDred)}_net`;

  const mTool = (id, name, icon, skill, prof, cost) => {
    TOOLS[id] = { id, name, icon, kind: "tool", forSkill: skill, tier, speed: tier * 0.02, value: Math.round(60 * Math.pow(2.1, tier - 1)) };
    addCraft(prof, id, name, icon, tier, gTime, 2.5, cost);
  };

  mTool(pPick, `${tDelve} Pickaxe`, "pick", "delving", "forgemaster", { [bar]: 10, [coal]: tier });
  mTool(pAxe, `${tFell} Axe`, "axe", "felling", "woodwright", { [plank]: 10, [resin]: tier });
  mTool(pSick, `${tHarv} Sickle`, "sickle", "harvesting", "weaver", { [bar]: 10, [pulp]: tier });
  mTool(pKni, `${tFlay} Knife`, "knife", "flaying", "tanner", { [bar]: 10, [leather]: 5, [tallow]: tier });
  mTool(pNet, `${tDred} Net`, "net", "dredging", "artificer", { [leather]: 10, [plank]: 5, [shard]: tier });
});

/* ================= 8. ITEM KEYS & LOOKUPS ================= */

/* Key shapes:
     material            -> "slag_delve"
     common gear/tool    -> "slag_sword|common"          (stacks)
     uncommon+           -> "slag_sword|rare|17"         (unique instance)
     relic               -> "slag_sword|relic|17|echoing" (instance + prefix)
   Keys are minted by makeKey() in engine.js. */

function parseKey(key) {
  const b = String(key).split("|");
  return { base: b[0], rarity: b[1] || null, uid: b[2] || null, prefix: b[3] || null };
}

function stacks(key) {
  const p = parseKey(key);
  return !p.uid;
}

function itemDef(key) {
  const { base, rarity, prefix } = parseKey(key);
  const g = GEAR[base];
  if (g) {
    const m = rarityDef(rarity || "common").mult;
    const pfx = prefix ? prefixDef(prefix) : null;
    return {
      base, rarity: rarity || "common", prefix: prefix || null, kind: "gear",
      name: g.name, icon: g.icon, slot: g.slot,
      attack: Math.round(g.attack * m), defence: Math.round(g.defence * m), health: Math.round(g.health * m),
      twoHanded: g.twoHanded, maxDur: g.maxDur, repairMat: g.repairMat,
      value: Math.round(g.value * m * (pfx ? 2 : 1)), tier: g.tier, prof: g.prof,
      effect: pfx ? pfx.effect : null, category: "Equipment",
    };
  }
  const tool = TOOLS[base];
  if (tool) {
    const m = rarityDef(rarity || "common").mult;
    return Object.assign({}, tool, { base, rarity: rarity || "common",
      speed: tool.speed * m, category: "Tool" });
  }
  const mat = MATERIALS[base];
  return mat ? Object.assign({ base, rarity: null }, mat) : null;
}

function itemName(key) {
  const d = itemDef(key);
  if (!d) return String(key);
  // A relic wears its prefix instead of the word "Relic": Echoing Slag Sword.
  if (d.prefix) return `${prefixDef(d.prefix).name} ${d.name}`;
  if ((d.kind === "gear" || d.kind === "tool") && d.rarity && d.rarity !== "common") {
    return `${rarityDef(d.rarity).name} ${d.name}`;
  }
  return d.name;
}

function actionsFor(skillId) {
  return GATHER_ACTIONS[skillId] || CRAFT_ACTIONS[skillId] || [];
}

function findAction(skillId, actionId) {
  return actionsFor(skillId).find((a) => a.id === actionId) || null;
}

/* ================= 9. REGIONS & MONSTERS ================= */

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

const regionById = (id) => REGIONS.find((r) => r.id === id) || REGIONS[0];
const regionOfTier = (tier) => REGIONS.find((r) => r.tier === tier);

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
const monsterOfTier = (tier) => rankOf(tier, "grunt");
const getMonster = (id) => MONSTERS.find((m) => m.id === id) || null;

/* ================= 10. ITEM SOURCES ================= */
/* Built once from the tables above so the item popup can say where a thing
   comes from and what it feeds. Keyed by base id. */

const GATHERED_BY = {};   // base id -> [gather action]
const MADE_BY = {};       // base id -> [craft action]
const USED_IN = {};       // base id -> [craft action]
const DROPPED_BY = {};    // base id -> [monster]

const pushTo = (map, key, value) => { (map[key] = map[key] || []).push(value); };

Object.keys(GATHER_ACTIONS).forEach((skillId) => {
  GATHER_ACTIONS[skillId].forEach((a) => {
    Object.keys(a.out || {}).forEach((k) => pushTo(GATHERED_BY, k, a));
    if (a.reagentId) pushTo(GATHERED_BY, a.reagentId, a);
  });
});

Object.keys(CRAFT_ACTIONS).forEach((prof) => {
  CRAFT_ACTIONS[prof].forEach((a) => {
    (a.craftGear ? [a.craftGear] : Object.keys(a.out || {})).forEach((k) => pushTo(MADE_BY, k, a));
    Object.keys(a.cost || {}).forEach((k) => pushTo(USED_IN, k, a));
  });
});

MONSTERS.forEach((m) => {
  m.drops.forEach(([k]) => pushTo(DROPPED_BY, k, m));
});

/* ================= 11. WEATHER ================= */
/* Weather touches XP only, never speed. Each day draws one weather and a
   hidden roll of 1-10. The roll sets one effect size that favours one trade
   and hinders another by the same amount:

     Effect = 5% + (Roll - 1) × 1.67%, rounded → 5, 7, 8, 10, 12, 13, 15, 17, 18, 20

   The week's forecast is revealed every Sunday at 00:00 UTC. The maths
   lives in engine.js. */

const WEATHER_TYPES = [
  { id: "aridity", name: "Aridity", icon: "sun",   favoured: "delving",    hindered: "dredging" },
  { id: "miasma",  name: "Miasma",  icon: "fog",   favoured: "dredging",   hindered: "felling" },
  { id: "gale",    name: "Gale",    icon: "wind",  favoured: "felling",    hindered: "flaying" },
  { id: "gloom",   name: "Gloom",   icon: "moon",  favoured: "flaying",    hindered: "harvesting" },
  { id: "frost",   name: "Frost",   icon: "frost", favoured: "harvesting", hindered: "delving" },
];

const WEATHER_EFFECT_BASE = 5;      // % at roll 1
const WEATHER_EFFECT_STEP = 1.67;   // % per roll above 1

const WEATHER_SEVERITIES = [
  { name: "Faint",      min: 5,  max: 9 },
  { name: "Oppressive", min: 10, max: 15 },
  { name: "Extreme",    min: 16, max: 20 },
];

// Bountiful Weekend: Saturday and Sunday (UTC), +20% XP to every trade.
// Separate from the weather and never changes its severity.
const BOUNTIFUL_XP = 0.20;
const BOUNTIFUL_WEEKDAYS = [6, 0];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ================= 12. MASTERY ================= */
/* Gathering only. Each step adds to the chance an action yields double. */

const MASTERY_TRACK = [
  { level: 10, double: 0.01, label: "Steady Hands" },
  { level: 20, double: 0.01, label: "Keen Eye" },
  { level: 30, double: 0.01, label: "Practised" },
  { level: 40, double: 0.01, label: "Rich Pickings" },
  { level: 50, double: 0.01, label: "Journeyman" },
  { level: 60, double: 0.01, label: "Deep Instinct" },
  { level: 70, double: 0.01, label: "Seasoned" },
  { level: 80, double: 0.01, label: "Bountiful Hand" },
  { level: 90, double: 0.02, label: "Peerless" },
];

/* ================= 13. CLASSES ================= */
/* Chosen once, at Combat level 5. Each shapes the same combat loop rather
   than forking it: different base stats, different swing speed, and a
   different thing to do when the Veil fills. */

const CLASSES = [
  { id: "warrior", name: "Warrior", icon: "plate",
    blurb: "Forces the Veil through the body. Slow, heavy, hard to put down.",
    health: 24, attack: 5, defence: 1.5, speed: 2600,
    crit: 0.05, critDmg: 1.5, block: 0.12, dodge: 0.03, pen: 0.05,
    veilName: "Onslaught", veilNote: "A brutal swing that ignores half of Defence." },
  { id: "rogue", name: "Rogue", icon: "blade",
    blurb: "Brief, precise Veil surges. Fast hands, thin margins.",
    health: 20, attack: 4, defence: 0.8, speed: 2000,
    crit: 0.15, critDmg: 1.8, block: 0.02, dodge: 0.12, pen: 0.10,
    veilName: "Bleedout", veilNote: "A flurry that always crits." },
  { id: "mage", name: "Mage", icon: "stave",
    blurb: "Shapes the Veil directly. Fragile, and worth it.",
    health: 18, attack: 6, defence: 0.5, speed: 2800,
    crit: 0.08, critDmg: 1.6, block: 0.02, dodge: 0.05, pen: 0.20,
    veilName: "Unmaking", veilNote: "Detonates the Veil for heavy damage." },
];

const classDef = (id) => CLASSES.find((c) => c.id === id) || null;

/* ================= 14. REQUISITION AGENTS ================= */
/* A roster of Agents you send out for a chosen resource. Three deployments
   a day, resolved at the daily reset — a supplement to gathering, never a
   replacement for it. */

const AGENT_RARITIES = [
  { key: "common",    name: "Common",    mult: 1.0,  chance: 0.50 },
  { key: "uncommon",  name: "Uncommon",  mult: 1.6,  chance: 0.26 },
  { key: "rare",      name: "Rare",      mult: 2.5,  chance: 0.14 },
  { key: "epic",      name: "Epic",      mult: 4.0,  chance: 0.07 },
  { key: "legendary", name: "Legendary", mult: 6.5,  chance: 0.025 },
  { key: "relic",     name: "Relic",     mult: 10.0, chance: 0.005 },
];
const agentRarityDef = (k) => AGENT_RARITIES.find((a) => a.key === k) || AGENT_RARITIES[0];

const AGENT_NAMES = [
  "Mara Voss", "Old Teague", "The Quartermaster", "Sable", "Hollis Crane",
  "Bracken", "Wren Ashby", "Doctor Pike", "The Tallyman", "Ivo Kestrel",
  "Greave", "Silt", "Marrow Jack", "Ashen Nell", "Corvin Rue",
];

/* ================= 15. PETS ================= */

const PETS = [
  { id: "golem",  name: "Stone Golem",    icon: "golemMob", cost: 4000, note: "Works the seam.", effect: "Gathering 10% faster, +10% double yield." },
  { id: "sprite", name: "Looting Sprite", icon: "horror", cost: 7500, note: "Flits around.", effect: "Field loot overflowing pack goes to stores." },
  { id: "mule",   name: "Pack Mule",      icon: "beast", cost: 2500, note: "Carries stuff.", effect: "Eight more slots in your pack." },
];
