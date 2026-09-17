/* ============================================================
   Respite · registry.js · The Encyclopedia
   ------------------------------------------------------------
   Static tables and everything generated from them, built once
   from CONFIG and deep-frozen as GameData. Nothing in this file
   reads or writes the save.
   ============================================================ */

import { CONFIG, deepFreeze } from "./config.js";

export const basePrefix = (name) => name.split(" ")[0];
export const slug = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

// A raw material's id from its TIERS row and type: "slag_delve".
const rowMatId = (row, type) => `${slug(basePrefix(row[type]))}_${type}`;

function buildRegistry() {
  /* ================= 1. EQUIPMENT SLOTS ================= */

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

  /* ================= 2. RARITIES & RELIC PREFIXES ================= */

  const RARITIES = [
    { key: "common",    name: "Common",    mult: 1.00, chance: 0.800 },
    { key: "uncommon",  name: "Uncommon",  mult: 1.10, chance: 0.145 },
    { key: "rare",      name: "Rare",      mult: 1.20, chance: 0.040 },
    { key: "epic",      name: "Epic",      mult: 1.30, chance: 0.012 },
    { key: "legendary", name: "Legendary", mult: 1.50, chance: 0.0025 },
    { key: "relic",     name: "Relic",     mult: 1.50, chance: 0.0005 },
  ];

  /* Relics roll a prefix on top of Legendary stats. The prefix becomes part
     of the item's name, as in "Echoing Slag Sword", and carries one effect. */
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
  // Copies, so no object sits in two tables.
  const ALL_PREFIXES = WEAPON_PREFIXES.concat(ARMOUR_PREFIXES).map((p) => ({ ...p }));

  /* ================= 3. TIERS ================= */

  const STRATA = [
    { key: "scavenged", name: "Scavenged", tiers: [1, 2, 3] },
    { key: "barrow",    name: "Barrow",    tiers: [4, 5, 6] },
    { key: "sovereign", name: "Sovereign", tiers: [7, 8, 9] },
  ];

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

  /* ================= 4. SKILLS ================= */

  /* Five reagents shared by every region, one per gathering skill, with no
     tier prefix. Recipes ask for "T reagent", meaning tier-many of them: a T9
     bar needs 9 Coal. Dedicated nodes exist in T1 and T2; from T3 on they drop
     alongside the main resource at an increasing chance. */
  const REAGENTS = [
    { id: "coal",       name: "Coal",       icon: "coalIco",   skill: "delving",    category: "Reagent" },
    { id: "resin",      name: "Resin",      icon: "resinIco",  skill: "felling",    category: "Reagent" },
    { id: "pulp",       name: "Pulp",       icon: "pulpIco",   skill: "harvesting", category: "Reagent" },
    { id: "tallow",     name: "Tallow",     icon: "tallowIco", skill: "flaying",    category: "Reagent" },
    { id: "veil_shard", name: "Veil Shard", icon: "shardIco",  skill: "dredging",   category: "Reagent" },
  ];

  /* `verb` is the start button in the action popup.
     `note` is the quiet caption under the skill's XP bar.
     `lore` is the bullet list in the Mastery tooltip on gathering pages. */
  const GATHER_SKILLS = [
    { id: "delving",    name: "Delving",    verb: "Delve",   icon: "pick",   mat: "delve",   resource: "Ore",    reagent: "coal",       matIcon: "ore",
      note: "Ore and coal, hauled up by lamplight.",
      lore: [
        "Gather ore and coal for Delving XP.",
        "The Forgemaster smelts ore into bars for plate, blades and tools.",
        "Pickaxes from the Forgemaster make crews faster.",
      ] },
    { id: "felling",    name: "Felling",    verb: "Fell",    icon: "axe",    mat: "fell",    resource: "Timber", reagent: "resin",      matIcon: "log",
      note: "Timber and resin from trees that fought back.",
      lore: [
        "Gather timber and resin for Felling XP.",
        "The Woodwright cuts timber into planks for bows, shields and hafts.",
        "Axes from the Woodwright make crews faster.",
      ] },
    { id: "harvesting", name: "Harvesting", verb: "Harvest", icon: "sickle", mat: "harvest", resource: "Fibre",  reagent: "pulp",       matIcon: "fibre",
      note: "Fibre and pulp from ground that grows too well.",
      lore: [
        "Gather fibre and pulp for Harvesting XP.",
        "The Weaver spins fibre into weave for robes, bowstrings and tomes.",
        "Sickles from the Weaver make crews faster.",
      ] },
    { id: "flaying",    name: "Flaying",    verb: "Flay",    icon: "knife",  mat: "flay",    resource: "Hides",  reagent: "tallow",     matIcon: "hide",
      note: "Hides and tallow. Nothing is wasted.",
      lore: [
        "Gather hides and tallow for Flaying XP.",
        "The Tanner cures hides into leather for jackets, grips and bindings.",
        "Knives from the Tanner make crews faster.",
      ] },
    { id: "dredging",   name: "Dredging",   verb: "Dredge",  icon: "net",    mat: "dredge",  resource: "Finds",  reagent: "veil_shard", matIcon: "gem",
      note: "Finds and veil shards, pulled from black water.",
      lore: [
        "Gather finds and veil shards for Dredging XP.",
        "The Artificer sets finds into inlays for staves, grimoires and clasps.",
        "Nets from the Artificer make crews faster.",
      ] },
  ];

  const PROFESSIONS = [
    { id: "forgemaster", name: "Forgemaster", verb: "Forge", icon: "plate",  weight: "Heavy",
      note: "Heavy plate and weapons from Delving. Slow, unglamorous, and holds a line." },
    { id: "woodwright",  name: "Woodwright",  verb: "Carve", icon: "ward",   weight: "Heavy",
      note: "Bows, shields, and timber crafts from Felling." },
    { id: "tanner",      name: "Tanner",      verb: "Tan",   icon: "treads", weight: "Medium",
      note: "Medium leather and grips from Flaying. Quick, quiet, always wearing out." },
    { id: "weaver",      name: "Weaver",      verb: "Weave", icon: "cowl",   weight: "Light",
      note: "Light woven cloth from Harvesting. Almost no defence, carries the life in it." },
    { id: "artificer",   name: "Artificer",   verb: "Craft", icon: "charm",  weight: "Relic",
      note: "Magical cores, staves, and tomes from Dredging." },
  ];

  const SKILLS = []
    .concat(GATHER_SKILLS.map((s) => ({ id: s.id, name: s.name, verb: s.verb, icon: s.icon, kind: "gather", note: s.note })))
    .concat(PROFESSIONS.map((p) => ({ id: p.id, name: p.name, verb: p.verb, icon: p.icon, kind: "craft", note: p.note })))
    .concat([{ id: "warfare", name: "Hunt", verb: "Hunt", icon: "swords", kind: "war", note: "You take the vanguard." }]);

  /* ================= 5. GENERATED ECONOMY ================= */

  const MATERIALS = {};
  const GEAR = {};
  const TOOLS = {};
  const GATHER_ACTIONS = {};
  const CRAFT_ACTIONS = { forgemaster: [], woodwright: [], tanner: [], weaver: [], artificer: [] };

  // Remedies: taken automatically on the hunt. Numbers live in CONFIG.economy.remedies.
  // Ids keep their old "provision" name for saves.
  const REMEDY_NAMES = {
    1: "Bitter-Ash Salve",
    3: "Gravemoss Poultice",
    4: "Corpse-Marrow Draught",
    6: "Star-Steel Tonic",
    7: "Leviathan Blood",
    9: "Godsbane Elixir",
  };

  const REMEDIES = CONFIG.economy.remedies.map((p) => ({
    id: `provision_t${p.tier}`, name: REMEDY_NAMES[p.tier], icon: "ration", kind: "material",
    tier: p.tier, heal: p.heal, value: p.value, price: p.price, smuggler: !!p.smuggler,
  }));
  // MATERIALS keeps its own copy, so no object sits in two tables.
  REMEDIES.forEach((r) => { MATERIALS[r.id] = { ...r }; });

  MATERIALS.vault_chest = { id: "vault_chest", name: "Banded Chest", icon: "crate", kind: "material", value: 60, chest: 5, tier: 2 };

  REAGENTS.forEach((r) => {
    MATERIALS[r.id] = { id: r.id, name: r.name, icon: r.icon, kind: "material",
      category: "Reagent", value: 1, tier: 1, reagent: true };
  });

  // Every artisan recipe unlocks at its tier's level: 1, 10, 20 ... 80.
  CRAFT_ACTIONS.woodwright.push({
    id: "craft_vault_chest", skillId: "woodwright", tier: 2, name: "Banded Chest", icon: "crate",
    level: TIERS[1].level, time: 45000, xp: 8, cost: { [rowMatId(TIERS[1], "fell")]: 20 }, out: { vault_chest: 1 },
  });

  /* Gear stat lines, as a tier-1 Common piece. CONFIG.hunt.gearGrowth,
     CONFIG.hunt.weaponVeil and CONFIG.gearStat turn them into real stats. */
  const GEAR_LINES = {
    // weapons and offhands
    sword:       { attack: 1 },
    dagger:      { attack: 1, crit: 0.03 },
    greatsword:  { attack: 2 },
    bow:         { attack: 2 },
    staff:       { attack: 2 },
    shield:      { defence: 1 },
    grimoire:    { attack: 1 },
    // heavy: Defence on every piece
    helm:        { health: 1, defence: 1 },
    chest:       { health: 2, defence: 1 },
    hboots:      { health: 1, defence: 1 },
    hgaunts:     { health: 1, defence: 1 },
    // medium: a little Defence, a little crit
    hood_medium: { health: 1, crit: 0.01 },
    jacket:      { health: 2, defence: 1 },
    mboots:      { health: 1, crit: 0.01 },
    mgloves:     { health: 1, crit: 0.01 },
    // light: the most health
    hood_light:  { health: 2 },
    robe:        { health: 3 },
    lboots:      { health: 1 },
    lgloves:     { health: 1 },
    // jewellery
    amulet:      { attack: 1 },
    ring:        { defence: 1 },
  };

  const B = CONFIG.bench;

  // What a pile of materials is worth.
  function costValue(cost) {
    return Object.keys(cost || {}).reduce((n, k) => n + (MATERIALS[k] ? MATERIALS[k].value * cost[k] : 0), 0);
  }

  function addMat(id, name, icon, tier, valMult, category) {
    MATERIALS[id] = { id, name, icon, kind: "material",
      value: Math.max(1, Math.round(CONFIG.valBase(tier) * valMult)), tier, category: category || "Component" };
  }

  function addGear(id, name, icon, slot, tier, prof, line, twoHand, maxDur) {
    GEAR[id] = {
      id, name, icon, kind: "gear", slot, tier, prof, line,
      twoHanded: !!twoHand, maxDur, repairMat: rowMatId(TIERS[tier - 1], "delve"),
      value: 1,   // set from the recipe's materials in addCraft
    };
  }

  // A recipe's level is its tier's level. Gear recipes produce a rolled item
  // (craftGear); everything else produces one of `id` (out). Gear and tools
  // are worth a quarter more than what went into them.
  function addCraft(prof, id, name, icon, tier, time, xpScale, cost, isGear) {
    CRAFT_ACTIONS[prof].push({
      id: `craft_${id}`, skillId: prof, tier, name, icon,
      level: TIERS[tier - 1].level, time, xp: Math.round(TIERS[tier - 1].xp * xpScale) + 1,
      cost, [isGear ? "craftGear" : "out"]: isGear ? id : { [id]: 1 },
    });
    const made = GEAR[id] || TOOLS[id];
    if (made) made.value = Math.max(1, Math.round(costValue(cost) * B.valueMarkup));
  }

  TIERS.forEach((t) => {
    const tier = t.i;
    const tDelve = basePrefix(t.delve);
    const tFell = basePrefix(t.fell);
    const tHarv = basePrefix(t.harvest);
    const tFlay = basePrefix(t.flay);
    const tDred = basePrefix(t.dredge);

    // 1. RAW MATERIALS & GATHER ACTIONS (an action is named after what it yields)
    GATHER_SKILLS.forEach((s) => {
      const rawId = rowMatId(t, s.mat);
      const reag = MATERIALS[s.reagent];
      addMat(rawId, t[s.mat], s.matIcon, tier, 1.0, s.resource);

      if (!GATHER_ACTIONS[s.id]) GATHER_ACTIONS[s.id] = [];

      if (tier === 1 || tier === 2) {
        // Dedicated reagent ground, at the tier's own level so it is
        // workable the moment you arrive.
        GATHER_ACTIONS[s.id].push({
          id: `${s.id}_t${tier}_raw`, skillId: s.id, tier, name: t[s.mat], icon: s.matIcon,
          level: t.level, time: t.time, xp: t.xp, out: { [rawId]: 1 },
        });
        GATHER_ACTIONS[s.id].push({
          id: `${s.id}_t${tier}_reag`, skillId: s.id, tier, name: reag.name, icon: reag.icon,
          level: t.level, time: t.time, xp: t.xp, out: { [s.reagent]: 1 },
        });
      } else {
        GATHER_ACTIONS[s.id].push({
          id: `${s.id}_t${tier}`, skillId: s.id, tier, name: t[s.mat], icon: s.matIcon,
          level: t.level, time: t.time, xp: t.xp, out: { [rawId]: 1 },
          reagentId: s.reagent, reagentChance: CONFIG.economy.reagentChances[tier],
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

    addCraft("forgemaster", bar, MATERIALS[bar].name, "ore", tier, t.time, 0.5, { [rowMatId(t, "delve")]: 2, [coal]: tier });
    addCraft("woodwright", plank, MATERIALS[plank].name, "log", tier, t.time, 0.5, { [rowMatId(t, "fell")]: 2, [resin]: tier });
    addCraft("weaver", weave, MATERIALS[weave].name, "fibre", tier, t.time, 0.5, { [rowMatId(t, "harvest")]: 2, [pulp]: tier });
    addCraft("tanner", leather, MATERIALS[leather].name, "hide", tier, t.time, 0.5, { [rowMatId(t, "flay")]: 2, [tallow]: tier });
    addCraft("artificer", inlay, MATERIALS[inlay].name, "gem", tier, t.time, 0.5, { [rowMatId(t, "dredge")]: 10, [shard]: tier * 2 });

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

    const cTime = CONFIG.compTime(tier);
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
    const gTime = CONFIG.gearTime(tier);
    const dur = B.durBase + tier * B.durPerTier;

    const wSword = `${slug(tDelve)}_sword`;
    const wDagger = `${slug(tDelve)}_dagger`;
    const wShield = `${slug(tFell)}_shield`;
    const wBow = `${slug(tFell)}_bow`;
    const wStaff = `${slug(tDred)}_staff`;
    const wGsword = `${slug(tDelve)}_greatsword`;
    const wGrimoire = `${slug(tDred)}_grimoire`;

    addGear(wSword, `${tDelve} Sword`, "blade", "weapon", tier, "forgemaster", "sword", false, dur);
    addGear(wDagger, `${tDelve} Dagger`, "blade", "weapon", tier, "forgemaster", "dagger", false, dur);
    addGear(wShield, `${tFell} Shield`, "ward", "offhand", tier, "woodwright", "shield", false, dur);
    addGear(wBow, `${tFell} Bow`, "stave", "weapon", tier, "woodwright", "bow", true, dur);
    addGear(wStaff, `${tDred} Staff`, "stave", "weapon", tier, "artificer", "staff", true, dur);
    addGear(wGsword, `${tDelve} Greatsword`, "greatblade", "weapon", tier, "forgemaster", "greatsword", true, dur);
    addGear(wGrimoire, `${tDred} Grimoire`, "book", "offhand", tier, "artificer", "grimoire", false, dur);

    addCraft("forgemaster", wSword, GEAR[wSword].name, "blade", tier, gTime, 2.5, { [blade]: 1, [handle]: 1 }, true);
    addCraft("forgemaster", wDagger, GEAR[wDagger].name, "blade", tier, gTime, 2.5, { [blade]: 1, [handle]: 1 }, true);
    addCraft("woodwright", wShield, GEAR[wShield].name, "ward", tier, gTime, 2.5, { [score]: 1, [bind]: 1 }, true);
    addCraft("woodwright", wBow, GEAR[wBow].name, "stave", tier, gTime, 2.8, { [stave]: 1, [string]: 1, [grip]: 1 }, true);
    addCraft("artificer", wStaff, GEAR[wStaff].name, "stave", tier, gTime, 2.8, { [shaft]: 1, [head]: 1, [bind]: 1 }, true);
    addCraft("forgemaster", wGsword, GEAR[wGsword].name, "greatblade", tier, gTime, 3.2, { [gblade]: 1, [ggrip]: 1, [bind]: 1 }, true);
    addCraft("artificer", wGrimoire, GEAR[wGrimoire].name, "book", tier, gTime, 3.2, { [book]: 1, [bind]: 1, [clasp]: 1 }, true);

    // Jewellery (Artificer)
    const jAmulet = `${slug(tDred)}_amulet`;
    const jRing = `${slug(tDelve)}_ring`;

    addGear(jAmulet, `${tDred} Amulet`, "charm", "neck", tier, "artificer", "amulet", false, dur);
    addGear(jRing, `${tDelve} Ring`, "band", "ring", tier, "artificer", "ring", false, dur);

    addCraft("artificer", jAmulet, GEAR[jAmulet].name, "charm", tier, gTime, 2.5, { [clasp]: 1, [inlay]: 2, [shard]: tier }, true);
    addCraft("artificer", jRing, GEAR[jRing].name, "band", tier, gTime, 2.5, { [bar]: 6, [inlay]: 1, [shard]: tier }, true);

    // Heavy Armor (Forgemaster)
    const aHH = `${slug(tDelve)}_helm`;
    const aHC = `${slug(tDelve)}_chest`;
    const aHB = `${slug(tDelve)}_hboots`;
    const aHG = `${slug(tDelve)}_hgaunts`;

    addGear(aHH, `${tDelve} Helm`, "cowl", "head", tier, "forgemaster", "helm", false, dur);
    addGear(aHC, `${tDelve} Chestplate`, "plate", "chest", tier, "forgemaster", "chest", false, dur);
    addGear(aHB, `${tDelve} Boots`, "treads", "feet", tier, "forgemaster", "hboots", false, dur);
    addGear(aHG, `${tDelve} Gauntlets`, "gauntlets", "hands", tier, "forgemaster", "hgaunts", false, dur);

    [aHH, aHC, aHB, aHG].forEach((id) => {
      addCraft("forgemaster", id, GEAR[id].name, GEAR[id].icon, tier, gTime, 2.5, { [bar]: 20, [coal]: tier }, true);
    });

    // Medium Armor (Tanner)
    const aMH = `${slug(tFlay)}_hood`;
    const aMC = `${slug(tFlay)}_jacket`;
    const aMB = `${slug(tFlay)}_mboots`;
    const aMG = `${slug(tFlay)}_mgloves`;

    addGear(aMH, `${tFlay} Hood`, "cowl", "head", tier, "tanner", "hood_medium", false, dur);
    addGear(aMC, `${tFlay} Jacket`, "shroud", "chest", tier, "tanner", "jacket", false, dur);
    addGear(aMB, `${tFlay} Boots`, "treads", "feet", tier, "tanner", "mboots", false, dur);
    addGear(aMG, `${tFlay} Gloves`, "gauntlets", "hands", tier, "tanner", "mgloves", false, dur);

    [aMH, aMC, aMB, aMG].forEach((id) => {
      addCraft("tanner", id, GEAR[id].name, GEAR[id].icon, tier, gTime, 2.5, { [leather]: 20, [tallow]: tier }, true);
    });

    // Light Armor (Weaver)
    const aLH = `${slug(tHarv)}_hood`;
    const aLC = `${slug(tHarv)}_robe`;
    const aLB = `${slug(tHarv)}_lboots`;
    const aLG = `${slug(tHarv)}_lgloves`;

    addGear(aLH, `${tHarv} Hood`, "cowl", "head", tier, "weaver", "hood_light", false, dur);
    addGear(aLC, `${tHarv} Robe`, "shroud", "chest", tier, "weaver", "robe", false, dur);
    addGear(aLB, `${tHarv} Boots`, "treads", "feet", tier, "weaver", "lboots", false, dur);
    addGear(aLG, `${tHarv} Gloves`, "gauntlets", "hands", tier, "weaver", "lgloves", false, dur);

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
      TOOLS[id] = { id, name, icon, kind: "tool", forSkill: skill, tier, speed: tier * B.toolSpeedPerTier, value: 1 };
      addCraft(prof, id, name, icon, tier, gTime, 2.5, cost);
    };

    mTool(pPick, `${tDelve} Pickaxe`, "pick", "delving", "forgemaster", { [bar]: 10, [coal]: tier });
    mTool(pAxe, `${tFell} Axe`, "axe", "felling", "woodwright", { [plank]: 10, [resin]: tier });
    mTool(pSick, `${tHarv} Sickle`, "sickle", "harvesting", "weaver", { [bar]: 10, [pulp]: tier });
    mTool(pKni, `${tFlay} Knife`, "knife", "flaying", "tanner", { [bar]: 10, [leather]: 5, [tallow]: tier });
    mTool(pNet, `${tDred} Net`, "net", "dredging", "artificer", { [leather]: 10, [plank]: 5, [shard]: tier });
  });

  /* ================= 6. REGIONS, ZONES & FOES ================= */

  const REGION_NAMES = [
    ["The Ashen Verge", "Dead ground at the camp's edge. Everything here is already picked over, which is why it's safe."],
    ["Gallowmoor", "Peat and gibbets. The iron in the bog came from something, and nobody asks what."],
    ["The Cold Warrens", "Tunnels under the moor. Cold enough that the bodies down there never went off."],
    ["Graveshelf", "A shelf of pine and cairns above the treeline. The cairns are recent."],
    ["The Sallow Fen", "Standing water that doesn't reflect. Things move under it with purpose."],
    ["Umberdeep", "Old-growth dark. Star iron falls here and the trees grow around it."],
    ["Wyrmreach", "Warm stone, crooked trees. Something underneath breathes and the ground answers."],
    ["The Fade", "Thin light, thinner air. Your own footsteps arrive a moment late."],
    ["Godsdown", "The last ground. Roots the width of streets and whatever it is that feeds them."],
  ];

  const REGIONS = TIERS.map((t, i) => ({
    id: `region_${t.i}`, tier: t.i, name: REGION_NAMES[i][0], note: REGION_NAMES[i][1], level: t.level, toll: CONFIG.economy.tolls[i],
  }));

  /* The hunt. Every region has four zones, from the Outer edge to the Core.
     An encounter walks in with its foes; if it is still going when the zone's
     window runs out, a reinforcement joins (never more than maxFoes at once).
     Clear it early and the rest of the window is the walk to the next one.
     The maths lives in combat.js. */
  const ZONES = [
    { id: "outer", name: "Outer", xp: 1, windowMs: 60000, threat: 1, elite: 0.04, engage: 0.4, escorts: 0,
      sizes: [[1, 0.75], [2, 0.25]], mix: { skirmisher: 0.4, stalker: 0.4, brute: 0.2 },
      foesText: "1 or 2",
      note: "The picked-over edge. One thing at a time, mostly, and help is slow to reach it." },
    { id: "middle", name: "Middle", xp: 1.3, windowMs: 50000, threat: 1.25, elite: 0.08, engage: 0.6, escorts: 0,
      sizes: [[1, 0.5], [2, 0.5]], mix: { skirmisher: 0.35, stalker: 0.4, brute: 0.25 },
      foesText: "1 or 2",
      note: "Deeper in. They come in pairs as often as not, and the dark answers faster." },
    { id: "inner", name: "Inner", xp: 1.7, windowMs: 40000, threat: 1.5, elite: 0.14, engage: 0.8, escorts: 1,
      sizes: [[2, 0.5], [3, 0.5]], mix: { skirmisher: 0.3, stalker: 0.4, brute: 0.3 },
      foesText: "2 or 3",
      note: "Where the ground stops pretending. Two or three at once, and more on the way." },
    { id: "core", name: "Core", xp: 2.2, windowMs: 30000, threat: 2, elite: 0.22, engage: 1, escorts: 2,
      sizes: [[3, 1]], mix: { skirmisher: 0.25, stalker: 0.4, brute: 0.35 },
      foesText: "3",
      note: "The heart of it. Always three, always hungry, and something vast is listening." },
  ];

  /* Three kinds of foe in every region, plus its Sovereign. Multipliers are
     against a Stalker of the same tier. `defence` is the share of a blow it
     shrugs off on its own ground. An Elite is any of the three, only worse. */
  const ARCHETYPES = {
    skirmisher: { name: "Skirmisher", speed: 2000, hp: 0.7, attack: 0.7, defence: 0,    xp: 0.8, threat: 1, gold: 0.7, drops: 1,
      note: "Fast and thin. Hits often and hits light." },
    stalker:    { name: "Stalker",    speed: 2400, hp: 1,   attack: 1,   defence: 0.1,  xp: 1,   threat: 2, gold: 1,   drops: 1,
      note: "Patient and even. It keeps pace with you, blow for blow." },
    brute:      { name: "Brute",      speed: 3000, hp: 1.6, attack: 1.8, defence: 0.25, xp: 1.5, threat: 3, gold: 1.5, drops: 1,
      note: "Slow and heavy. Every blow lands like a door." },
  };
  const ARCHETYPE_ORDER = ["skirmisher", "stalker", "brute"];
  const ELITE = { hp: 1.8, attack: 1.4, xp: 2.5, threat: 2, gold: 2.5, drops: 2 };
  const SOVEREIGN = { speed: 2800, hp: 12, attack: 2.5, defence: 0.3, xp: 15, gold: 20,
    enrageMs: 30000, enrage: 0.15,
    note: "It rules this ground. When a zone's Threat peaks it may come for you, with a guard in the deeper zones, and it grows angrier the longer the fight runs. Brought low, you break away and the hunt goes on." };

  const REGION_FOES = [
    { skirmisher: ["Carrion Rat", "beast"],       stalker: ["Ash Stalker", "horror"],     brute: ["Ash Brute", "man"],             sovereign: ["The Ashen Warden", "horror"] },
    { skirmisher: ["Bog Crawler", "beast"],       stalker: ["Fen Stalker", "horror"],     brute: ["Bog Brute", "man"],             sovereign: ["The Drowned Bailiff", "man"] },
    { skirmisher: ["Warren Goblin", "man"],       stalker: ["Rime Stalker", "beast"],     brute: ["Warren Butcher", "man"],        sovereign: ["The Cold Matriarch", "horror"] },
    { skirmisher: ["Cairn Hound", "beast"],       stalker: ["Cairn Wight", "horror"],     brute: ["Barrow Brute", "man"],          sovereign: ["The Barrow King", "man"] },
    { skirmisher: ["Fen Lurker", "beast"],        stalker: ["Sallow Stalker", "horror"],  brute: ["Sallow Troll", "beast"],        sovereign: ["Mother Sallow", "horror"] },
    { skirmisher: ["Umber Husk", "golemMob"],     stalker: ["Root Stalker", "horror"],    brute: ["Star-Iron Golem", "golemMob"],  sovereign: ["The Umber Colossus", "golemMob"] },
    { skirmisher: ["Wyrmkin Raider", "drakeMob"], stalker: ["Wyrmkin Stalker", "drakeMob"], brute: ["Wyrmkin Warlord", "drakeMob"], sovereign: ["The Wyrm Beneath", "drakeMob"] },
    { skirmisher: ["Fade Echo", "horror"],        stalker: ["Fade Stalker", "horror"],    brute: ["Fade Warden", "man"],           sovereign: ["The Thin Man", "man"] },
    { skirmisher: ["Godsdown Spawn", "horror"],   stalker: ["Root Horror", "horror"],     brute: ["Godsdown Brute", "beast"],      sovereign: ["What Feeds The Roots", "horror"] },
  ];

  // What each kind leaves behind: [material type, qty, chance]. Elites double the qty.
  const FOE_DROPS = {
    skirmisher: [["flay", 1, 0.45]],
    stalker:    [["flay", 1, 0.35], ["dredge", 1, 0.15]],
    brute:      [["delve", 1, 0.35], ["flay", 1, 0.3]],
    sovereign:  [["flay", 3, 1], ["delve", 3, 1], ["dredge", 2, 1]],
  };

  const H = CONFIG.hunt;
  const MONSTERS = [];
  TIERS.forEach((t, i) => {
    const hp = H.foeHp * Math.pow(H.foeHpGrowth, t.i - 1);
    const attack = H.foeAttack * Math.pow(H.foeAttackGrowth, t.i - 1);
    const k = CONFIG.defenceK(t.i);
    const goldScale = CONFIG.valBase(t.i);
    const names = REGION_FOES[i];

    const mk = (arch, spec) => ({
      id: `mob_t${t.i}_${arch}`, tier: t.i, archetype: arch, name: names[arch][0], icon: names[arch][1],
      hp: Math.round(hp * spec.hp), attack: attack * spec.attack, speed: spec.speed,
      defence: Math.round((spec.defence / (1 - spec.defence)) * k * 10) / 10,
      xp: H.foeXp[i] * spec.xp, threat: spec.threat || 0,
      gold: [Math.floor(H.foeGold[0] * goldScale * spec.gold), Math.max(1, Math.round(H.foeGold[1] * goldScale * spec.gold))],
      drops: FOE_DROPS[arch].map(([type, qty, chance]) => [rowMatId(t, type), qty, chance]),
    });

    ARCHETYPE_ORDER.forEach((arch) => MONSTERS.push(mk(arch, ARCHETYPES[arch])));
    MONSTERS.push(mk("sovereign", SOVEREIGN));
  });

  /* ================= 7. ITEM SOURCES ================= */
  /* Built once from the tables above so the item popup can say where a thing
     comes from and who works with it. Keyed by base id. Lists hold ids, not
     objects, so nothing is shared; itemSources() resolves them. */

  const GATHERED_BY = {};   // base id -> [gather action id]
  const MADE_BY = {};       // base id -> [craft action id]
  const USED_IN = {};       // base id -> [craft action id]
  const DROPPED_BY = {};    // base id -> [monster id]

  const pushTo = (map, key, value) => { (map[key] = map[key] || []).push(value); };

  Object.keys(GATHER_ACTIONS).forEach((skillId) => {
    GATHER_ACTIONS[skillId].forEach((a) => {
      Object.keys(a.out || {}).forEach((k) => pushTo(GATHERED_BY, k, a.id));
      if (a.reagentId) pushTo(GATHERED_BY, a.reagentId, a.id);
    });
  });

  Object.keys(CRAFT_ACTIONS).forEach((prof) => {
    CRAFT_ACTIONS[prof].forEach((a) => {
      (a.craftGear ? [a.craftGear] : Object.keys(a.out || {})).forEach((k) => pushTo(MADE_BY, k, a.id));
      Object.keys(a.cost || {}).forEach((k) => pushTo(USED_IN, k, a.id));
    });
  });

  MONSTERS.forEach((m) => {
    m.drops.forEach(([k]) => pushTo(DROPPED_BY, k, m.id));
  });

  /* ================= 8. THE BENCH ================= */
  /* Artisan recipes sit under two tabs. Components are what other recipes
     eat (refined stock and parts); Wares are what leaves the bench for good. */

  const BENCH_TABS = [
    { id: "components", label: "Components", groups: ["Refined", "Parts"] },
    { id: "wares",      label: "Wares",      groups: ["Weapons", "Armour", "Jewellery", "Tools", "Supplies"] },
  ];

  /* ================= 9. WEATHER ================= */
  /* Weather touches XP only, never speed. Each day draws one weather and an
     effect between 5% and 20% that favours one trade and hinders another by
     the same amount. The week's forecast is revealed every Sunday at 00:00
     UTC. The maths lives in weather.js. */

  const WEATHER_TYPES = [
    { id: "aridity", name: "Aridity", icon: "sun",   favoured: "delving",    hindered: "dredging" },
    { id: "miasma",  name: "Miasma",  icon: "fog",   favoured: "dredging",   hindered: "felling" },
    { id: "gale",    name: "Gale",    icon: "wind",  favoured: "felling",    hindered: "flaying" },
    { id: "gloom",   name: "Gloom",   icon: "moon",  favoured: "flaying",    hindered: "harvesting" },
    { id: "frost",   name: "Frost",   icon: "frost", favoured: "harvesting", hindered: "delving" },
  ];

  const WEATHER_SEVERITIES = [
    { name: "Faint",      min: 5,  max: 9 },
    { name: "Oppressive", min: 10, max: 15 },
    { name: "Extreme",    min: 16, max: 20 },
  ];

  const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /* ================= 10. MASTERY ================= */
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

  /* ================= 11. DISCIPLINES ================= */
  /* Hunt levels 1 to 4 are Brute Force: no discipline and no Veil. At level 5
     you choose one, and the Veil (0 to 100) opens. Each shapes the same fight
     rather than forking it: its own bulk, swing and payoff when the Veil fills.
     Multipliers apply to the base stats a Hunt level gives (CONFIG.baseHealth
     and friends). */

  const BRUTE_FORCE = { id: null, name: "Brute Force", health: 1, attack: 1, defence: 1,
    speed: H.playerSwingMs, crit: 0.05, critDmg: 1.5, pen: 0 };

  const CLASSES = [
    { id: "warrior", name: "Warrior", icon: "plate",
      blurb: "Forces the Veil through the body. Slow, heavy and hard to put down.",
      health: 1.2, attack: 1, defence: 1.5, speed: 2600, crit: 0.05, critDmg: 1.5, pen: 0.1,
      veilName: "Devastating Strike",
      veilNote: "Veil builds with every blow you land, and half as much with every blow aimed at you. It carries from fight to fight. Full, your next swing lands three times over and ignores half of Defence." },
    { id: "rogue", name: "Rogue", icon: "blade",
      blurb: "Brief, precise Veil surges. Fast hands, thin margins.",
      health: 1, attack: 0.85, defence: 1, speed: 2000, crit: 0.12, critDmg: 1.75, pen: 0.15,
      veilName: "Ambush",
      veilNote: "Every encounter you walk into opens on an Ambush: a certain critical, a quarter harder again. Veil rebuilds with each blow; full, the next swing is another Ambush." },
    { id: "mage", name: "Mage", icon: "stave",
      blurb: "Shapes the Veil directly. Fragile, and worth it.",
      health: 0.9, attack: 1.3, defence: 0.7, speed: 2600, crit: 0.06, critDmg: 1.6, pen: 0.25,
      veilName: "Elemental Absorption",
      veilNote: "Every encounter you walk into opens with a volley of three empowered casts, and every empowered cast washes over the whole fight. The Veil then drinks from the air, two a second, never from your blows. Full, your next cast is empowered." },
  ];

  // What each discipline does with a full Veil.
  const TECHNIQUE = {
    strike:    { mult: 3, pen: 0.5 },     // Warrior
    ambush:    { mult: 1.25 },            // Rogue, on top of a certain critical
    volley:    { casts: 3, mult: 2 },     // Mage, opening each encounter
    empowered: { mult: 3 },               // Mage, whenever the Veil fills
    splash:    0.5,                       // Mage casts: share of the blow every other foe takes
    absorb:    2,                         // Mage Veil a second
  };

  /* ================= 12. REQUISITION AGENTS ================= */
  /* A roster of Agents you send out for a chosen resource. Three deployments
     a day, resolved at the daily reset. A supplement to gathering, never a
     replacement for it. */

  const AGENT_RARITIES = [
    { key: "common",    name: "Common",    mult: 1.0,  chance: 0.50 },
    { key: "uncommon",  name: "Uncommon",  mult: 1.6,  chance: 0.26 },
    { key: "rare",      name: "Rare",      mult: 2.5,  chance: 0.14 },
    { key: "epic",      name: "Epic",      mult: 4.0,  chance: 0.07 },
    { key: "legendary", name: "Legendary", mult: 6.5,  chance: 0.025 },
    { key: "relic",     name: "Relic",     mult: 10.0, chance: 0.005 },
  ];

  const AGENT_NAMES = [
    "Mara Voss", "Old Teague", "The Quartermaster", "Sable", "Hollis Crane",
    "Bracken", "Wren Ashby", "Doctor Pike", "The Tallyman", "Ivo Kestrel",
    "Greave", "Silt", "Marrow Jack", "Ashen Nell", "Corvin Rue",
  ];

  /* ================= 13. COMPANIONS ================= */
  /* Each kind is bought once. One walks with you at a time: its Bond grows
     for every minute it spends beside you while you work or hunt, and Bond
     milestones unlock extra traits. Now and then a second of a kind you own
     turns up while you work or hunt. Duplicates raise Rank, which strengthens
     the main trait and unlocks one more.

     Effect kinds and what they touch (companions.js):
       xp       XP multiplier for the listed skills
       double   added double-yield chance (gathering)
       reagent  more reagents found alongside a resource
       speed    shorter action time (gathering and artisans)
       gold     more gold from kills
       drops    kills drop materials more often
       rare     chance a kill turns up a piece of uncommon-or-better gear
     Skill lists may use "gather", "trade" (gathering and artisans) or "all". */

  const RANK_NUMERALS = ["", "I", "II", "III", "IV", "V"];

  const COMPANIONS = [
    {
      id: "rat", name: "Tunnel Rat", icon: "rat", cost: 150,
      source: "delving", sourceText: "while Delving", findChance: 1 / 1200,
      blurb: "Thin, clever and always the first to smell a fresh seam.",
      trait: { name: "Seam Sense", kind: "xp", skills: ["delving"], base: 0.08, perRank: 0.02, text: "Delving XP" },
      unlocks: [
        { bond: 5,  kind: "double",  skills: ["delving"], value: 0.02, text: "+2% Delving double yield" },
        { bond: 10, kind: "reagent", skills: ["delving"], value: 0.25, text: "+25% Coal found alongside ore" },
        { bond: 20, kind: "speed",   skills: ["delving"], value: 0.05, text: "Delving actions 5% quicker" },
        { rank: 3,  kind: "double",  skills: ["delving"], value: 0.03, text: "+3% Delving double yield" },
      ],
    },
    {
      id: "crow", name: "Carrion Crow", icon: "crow", cost: 250,
      source: "gather", sourceText: "while gathering", findChance: 1 / 1500,
      blurb: "It watches every crew from the ridgeline and screams when something moves.",
      trait: { name: "Far Sight", kind: "xp", skills: ["gather"], base: 0.04, perRank: 0.01, text: "gathering XP" },
      unlocks: [
        { bond: 5,  kind: "double",  skills: ["gather"], value: 0.01, text: "+1% double yield on all gathering" },
        { bond: 10, kind: "reagent", skills: ["gather"], value: 0.15, text: "+15% reagents found while gathering" },
        { bond: 20, kind: "speed",   skills: ["gather"], value: 0.03, text: "Gathering actions 3% quicker" },
        { rank: 3,  kind: "double",  skills: ["gather"], value: 0.02, text: "+2% double yield on all gathering" },
      ],
    },
    {
      id: "marshcat", name: "Marshcat", icon: "marshcat", cost: 300,
      source: "harvesting", sourceText: "while Harvesting", findChance: 1 / 1200,
      blurb: "Wet-furred and silent. It walks the rushes ahead of the sickles.",
      trait: { name: "Reedstalker", kind: "xp", skills: ["harvesting"], base: 0.08, perRank: 0.02, text: "Harvesting XP" },
      unlocks: [
        { bond: 5,  kind: "double",  skills: ["harvesting"], value: 0.02, text: "+2% Harvesting double yield" },
        { bond: 10, kind: "reagent", skills: ["harvesting"], value: 0.25, text: "+25% Pulp found alongside fibre" },
        { bond: 20, kind: "speed",   skills: ["harvesting"], value: 0.05, text: "Harvesting actions 5% quicker" },
        { rank: 3,  kind: "double",  skills: ["harvesting"], value: 0.03, text: "+3% Harvesting double yield" },
      ],
    },
    {
      id: "hound", name: "Veil Hound", icon: "hound", cost: 400,
      source: "hunt", sourceText: "while hunting", findChance: 1 / 1500,
      blurb: "Lean, grey and patient. It can follow a blood trail through a week of rain.",
      trait: { name: "Bloodhound", kind: "xp", skills: ["warfare"], base: 0.08, perRank: 0.02, text: "Hunt XP" },
      unlocks: [
        { bond: 5,  kind: "gold",  value: 0.10, text: "+10% gold from kills" },
        { bond: 10, kind: "drops", value: 0.10, text: "Kills drop materials 10% more often" },
        { bond: 20, kind: "rare",  value: 0.01, text: "+1% rare find chance on kills" },
        { rank: 3,  kind: "rare",  value: 0.01, text: "+1% rare find chance on kills" },
      ],
    },
    {
      id: "stag", name: "Veil Stag", icon: "stag", cost: 1000,
      source: "any", sourceText: "whatever you are doing", findChance: 1 / 3000,
      blurb: "It appears at the treeline at dusk and the crews work quieter for it.",
      trait: { name: "Pathfinder", kind: "xp", skills: ["all"], base: 0.03, perRank: 0.01, text: "XP to every skill" },
      unlocks: [
        { bond: 5,  kind: "double", skills: ["gather"], value: 0.01, text: "+1% double yield on all gathering" },
        { bond: 10, kind: "speed",  skills: ["trade"],  value: 0.02, text: "Trade actions 2% quicker" },
        { bond: 20, kind: "rare",   value: 0.01, text: "+1% rare find chance on kills" },
        { rank: 3,  kind: "gold",   value: 0.05, text: "+5% gold from kills" },
      ],
    },
  ];

  // The old pets were retired in favour of companions. Saves that owned them get the price back.
  const RETIRED_PETS = { golem: 400, sprite: 750, mule: 250 };

  return {
    EQUIP_SLOTS, SLOT_LABELS, DOLL_ORDER, SLOT_GLYPHS,
    RARITIES, WEAPON_PREFIXES, ARMOUR_PREFIXES, ALL_PREFIXES,
    STRATA, TIERS, REAGENTS, GATHER_SKILLS, PROFESSIONS, SKILLS,
    MATERIALS, GEAR, TOOLS, REMEDIES, GATHER_ACTIONS, CRAFT_ACTIONS, GEAR_LINES,
    REGIONS, ZONES, ARCHETYPES, ARCHETYPE_ORDER, ELITE, SOVEREIGN, REGION_FOES, FOE_DROPS, MONSTERS,
    BENCH_TABS, WEATHER_TYPES, WEATHER_SEVERITIES, WEEKDAY_NAMES, MASTERY_TRACK,
    CLASSES, BRUTE_FORCE, TECHNIQUE, AGENT_RARITIES, AGENT_NAMES,
    COMPANIONS, RANK_NUMERALS, RETIRED_PETS,
    SOURCES: { GATHERED_BY, MADE_BY, USED_IN, DROPPED_BY },
  };
}

export const GameData = deepFreeze(buildRegistry());

/* ================= GETTERS ================= */
/* Pure reads of GameData. Unknown ids give null, except where a fallback is
   noted. Lookups by key only see a table's own entries. */

const EMPTY = Object.freeze([]);
const own = (map, key) => (Object.hasOwn(map, key) ? map[key] : null);

// Action ids are unique across skills; the first one wins, as find() would.
const GATHER_BY_ID = new Map();
const RECIPE_BY_ID = new Map();
for (const list of Object.values(GameData.GATHER_ACTIONS)) {
  for (const a of list) if (!GATHER_BY_ID.has(a.id)) GATHER_BY_ID.set(a.id, a);
}
for (const list of Object.values(GameData.CRAFT_ACTIONS)) {
  for (const a of list) if (!RECIPE_BY_ID.has(a.id)) RECIPE_BY_ID.set(a.id, a);
}

// Items

export const getMaterial = (id) => own(GameData.MATERIALS, id);
export const getGear = (id) => own(GameData.GEAR, id);
export const getTool = (id) => own(GameData.TOOLS, id);

// A raw material's id: "slag_delve". `tier` is a TIERS row or a tier number.
export function matId(tier, type) {
  const row = typeof tier === "number" ? GameData.TIERS[tier - 1] : tier;
  return rowMatId(row, type);
}

// Actions

export const getRecipe = (actionId) => RECIPE_BY_ID.get(actionId) || null;
export const getGatherAction = (actionId) => GATHER_BY_ID.get(actionId) || null;

export function actionsFor(skillId) {
  return own(GameData.GATHER_ACTIONS, skillId) || own(GameData.CRAFT_ACTIONS, skillId) || EMPTY;
}

export function findAction(skillId, actionId) {
  return actionsFor(skillId).find((a) => a.id === actionId) || null;
}

// The item an action is about: what a node yields or a recipe makes.
export function actionOutput(def) {
  if (def.craftGear) return def.craftGear;
  return def.out ? Object.keys(def.out)[0] : null;
}

// Skills

export const getSkill = (id) => GameData.SKILLS.find((s) => s.id === id) || null;

// Where skills sit in every list: each artisan in the same place as the trade it
// works from, so Forgemaster lines up with Delving, Woodwright with Felling, Tanner
// with Flaying, Weaver with Harvesting and Artificer with Dredging.
export const TRADE_ORDER = Object.freeze(["delving", "felling", "flaying", "harvesting", "dredging"]);
export const ARTISAN_ORDER = Object.freeze(["forgemaster", "woodwright", "tanner", "weaver", "artificer"]);
export const SKILL_ORDER = Object.freeze([...TRADE_ORDER, ...ARTISAN_ORDER, "warfare"]);
export const skillName = (id) => {
  const s = getSkill(id);
  return s ? s.name : id;
};
export const gatherSkillDef = (id) => GameData.GATHER_SKILLS.find((s) => s.id === id) || null;
export const reagentOf = (skillId) => GameData.REAGENTS.find((r) => r.skill === skillId) || null;
export const isGather = (skillId) => GameData.GATHER_SKILLS.some((s) => s.id === skillId);

// Gathering and artisan skills. The hunt is not a trade.
export const isTrade = (skillId) => isGather(skillId) || GameData.PROFESSIONS.some((p) => p.id === skillId);

// World

export const getRegion = (id) => GameData.REGIONS.find((r) => r.id === id) || GameData.REGIONS[0];
export const regionOfTier = (tier) => GameData.REGIONS.find((r) => r.tier === tier) || null;
export const getZone = (id) => GameData.ZONES.find((z) => z.id === id) || GameData.ZONES[0];

// Foes

// Foes are looked up on every swing of a projection, so by id through a Map.
const MONSTER_BY_ID = new Map(GameData.MONSTERS.map((m) => [m.id, m]));
export const getMonster = (id) => MONSTER_BY_ID.get(id) || null;
export const foeOf = (tier, arch) => GameData.MONSTERS.find((m) => m.tier === tier && m.archetype === arch) || null;
export const foesOf = (tier) => GameData.ARCHETYPE_ORDER.map((arch) => foeOf(tier, arch));
export const sovereignOf = (tier) => foeOf(tier, "sovereign");
export const monsterOfTier = (tier) => foeOf(tier, "stalker");

// Definitions

export const getClass = (id) => GameData.CLASSES.find((c) => c.id === id) || null;
export const getCompanion = (id) => GameData.COMPANIONS.find((c) => c.id === id) || null;
export const rarityDef = (k) => GameData.RARITIES.find((r) => r.key === k) || GameData.RARITIES[0];
export const prefixDef = (id) => GameData.ALL_PREFIXES.find((p) => p.id === id) || null;
export const agentRarityDef = (k) => GameData.AGENT_RARITIES.find((a) => a.key === k) || GameData.AGENT_RARITIES[0];
export const stratumOf = (tier) => GameData.STRATA.find((s) => s.tiers.includes(tier)) || GameData.STRATA[0];

// The bench tab and group a recipe sits under.
export function benchGroupOf(def) {
  if (def.craftGear) {
    const g = getGear(def.craftGear);
    if (g.slot === "weapon" || g.slot === "offhand") return { tab: "wares", group: "Weapons" };
    return { tab: "wares", group: (g.slot === "neck" || g.slot === "ring") ? "Jewellery" : "Armour" };
  }
  const outId = actionOutput(def);
  if (getTool(outId)) return { tab: "wares", group: "Tools" };
  if (outId === "vault_chest") return { tab: "wares", group: "Supplies" };
  const mat = getMaterial(outId);
  const cat = mat ? mat.category : null;
  if (["Bars", "Planks", "Weave", "Leather", "Inlays"].includes(cat)) return { tab: "components", group: "Refined" };
  return { tab: "components", group: "Parts" };
}

// Where a thing comes from and who works with it, as action and monster defs.
export function itemSources(baseId) {
  const S = GameData.SOURCES;
  const ids = (map) => own(map, baseId) || EMPTY;
  return {
    gatheredBy: ids(S.GATHERED_BY).map((id) => getGatherAction(id)),
    madeBy: ids(S.MADE_BY).map((id) => getRecipe(id)),
    usedIn: ids(S.USED_IN).map((id) => getRecipe(id)),
    droppedBy: ids(S.DROPPED_BY).map((id) => getMonster(id)),
  };
}
