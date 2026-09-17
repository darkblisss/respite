/* ============================================================
   Respite · items.js · The Inventory Clerk
   ------------------------------------------------------------
   What an item key means. A key names the base item, and for gear
   its rarity, the instance it is and a relic's prefix:

     material            "slag_delve"
     tool (as crafted)   "slag_pick"
     common gear         "slag_sword|common"               (stacks)
     uncommon and up     "slag_sword|rare|c17.42"          (unique)
     relic               "slag_sword|relic|f9.3|echoing"   (unique, prefixed)

   Uids are derived from roll counters (c: crafted, f: found on a
   kill, s: a Sovereign's piece, m: bought on the market). Saves
   from v4 keep their plain numbers. Nothing here reads the save.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData, getGear, getTool, getMaterial, rarityDef, prefixDef } from "./registry.js";

const { gearStat } = CONFIG;

export function parseKey(key) {
  const b = String(key).split("|");
  return { base: b[0], rarity: b[1] || null, uid: b[2] || null, prefix: b[3] || null };
}

// Common gear stacks. Anything finer needs its uid, and a relic its prefix.
export function makeKey(base, rarity, uid, prefix) {
  if (!rarity) return base;
  if (rarity === "common") return `${base}|common`;
  if (rarity === "relic") return `${base}|relic|${uid}|${prefix}`;
  return `${base}|${rarity}|${uid}`;
}

export function stacks(key) {
  return !parseKey(key).uid;
}

/* ================= DEFINITIONS ================= */

// A def never depends on the uid, so defs are kept by base, rarity and prefix.
// Frozen, because every caller shares them. Cleared if junk keys pile up.
const DEFS = new Map();

function buildDef(base, rarity, prefix) {
  const g = getGear(base);
  if (g) {
    const m = rarityDef(rarity || "common").mult;
    const pfx = prefix ? prefixDef(prefix) : null;
    const line = GameData.GEAR_LINES[g.line];
    const growth = CONFIG.hunt.gearGrowth;
    return {
      base, rarity: rarity || "common", prefix: prefix || null, kind: "gear",
      name: g.name, icon: g.icon, slot: g.slot,
      attack: gearStat(line.attack, growth.attack, g.tier, m),
      defence: gearStat(line.defence, growth.defence, g.tier, m),
      health: gearStat(line.health, growth.health, g.tier, m),
      crit: line.crit ? Math.round(line.crit * m * 1000) / 1000 : 0,
      veil: g.slot === "weapon" ? gearStat(CONFIG.hunt.weaponVeil[g.tier - 1], 1, 1, m) : 0,
      twoHanded: g.twoHanded, maxDur: g.maxDur, repairMat: g.repairMat,
      value: Math.round(g.value * m * (pfx ? 2 : 1)), tier: g.tier, prof: g.prof,
      effect: pfx ? pfx.effect : null, category: "Equipment",
    };
  }
  const tool = getTool(base);
  if (tool) {
    const m = rarityDef(rarity || "common").mult;
    return Object.assign({}, tool, { base, rarity: rarity || "common", speed: tool.speed * m, category: "Tool" });
  }
  const mat = getMaterial(base);
  return mat ? Object.assign({ base, rarity: null }, mat) : null;
}

export function itemDef(key) {
  const { base, rarity, prefix } = parseKey(key);
  const sig = `${base}|${rarity}|${prefix}`;
  let def = DEFS.get(sig);
  if (def === undefined) {
    def = buildDef(base, rarity, prefix);
    if (!def) return null;
    if (DEFS.size >= 20000) DEFS.clear();
    DEFS.set(sig, Object.freeze(def));
  }
  return def;
}

export function itemName(key) {
  const d = itemDef(key);
  if (!d) return String(key);
  // A relic wears its prefix instead of the word "Relic": Echoing Slag Sword.
  const pfx = d.prefix ? prefixDef(d.prefix) : null;
  if (pfx) return `${pfx.name} ${d.name}`;
  if ((d.kind === "gear" || d.kind === "tool") && d.rarity && d.rarity !== "common") {
    return `${rarityDef(d.rarity).name} ${d.name}`;
  }
  return d.name;
}

export function isRemedy(key) {
  const d = itemDef(key);
  return !!d && d.heal > 0;
}

/* ================= VALIDATION ================= */

const UID = /^[a-z0-9.]{1,24}$/i;
// Fixed with the registry, so built once: old saves can bring tens of thousands of keys to check.
const RARITY_KEYS = new Set(GameData.RARITIES.map((r) => r.key));
const isRarity = (k) => RARITY_KEYS.has(k);

/* The strict check for keys that arrive from outside (commands, market
   rows, old saves). Tools are crafted and equipped as their bare base, so a
   bare tool base is a valid key; a tool may also carry a rarity like gear.
   A relic's prefix must belong to its slot family (tools count as armour,
   as v4's prefix roll did). */
export function validKey(key) {
  if (typeof key !== "string" || key.length === 0 || key.length > 120) return false;
  // Read part by part without splitting: a migrating save may bring tens of thousands of keys.
  const a = key.indexOf("|");
  const base = a < 0 ? key : key.slice(0, a);
  if (getMaterial(base)) return a < 0;
  const gear = getGear(base);
  if (!gear && !getTool(base)) return false;
  if (a < 0) return !gear;
  const b = key.indexOf("|", a + 1);
  const rarity = b < 0 ? key.slice(a + 1) : key.slice(a + 1, b);
  if (!isRarity(rarity)) return false;
  if (rarity === "common") return b < 0;
  if (b < 0) return false;
  const c = key.indexOf("|", b + 1);
  if (!UID.test(c < 0 ? key.slice(b + 1) : key.slice(b + 1, c))) return false;
  if (rarity !== "relic") return c < 0;
  if (c < 0 || key.indexOf("|", c + 1) >= 0) return false;
  const prefix = key.slice(c + 1);
  return prefixPool(base).some((p) => p.id === prefix);
}

/* ================= ROLLS ================= */
/* v4 threw its own dice inside these; here the caller brings the roll, a
   number in [0, 1), so the same save always rolls the same thing. */

export function rarityFromRoll(r) {
  let left = r;
  for (const rar of GameData.RARITIES) {
    if (left < rar.chance) return rar.key;
    left -= rar.chance;
  }
  return "common";
}

// Uncommon or better, weighted the way rarityFromRoll is.
export function fineRarityFromRoll(r) {
  const fine = GameData.RARITIES.filter((rar) => rar.key !== "common");
  let left = r * fine.reduce((n, rar) => n + rar.chance, 0);
  for (const rar of fine) {
    if (left < rar.chance) return rar.key;
    left -= rar.chance;
  }
  return "uncommon";
}

function prefixPool(base) {
  const g = getGear(base);
  return g && (g.slot === "weapon" || g.slot === "offhand") ? GameData.WEAPON_PREFIXES : GameData.ARMOUR_PREFIXES;
}

export function prefixFromRoll(base, r) {
  const pool = prefixPool(base);
  return pool[Math.floor(r * pool.length)].id;
}

export function agentRarityFromRoll(r) {
  let left = r;
  for (const a of GameData.AGENT_RARITIES) {
    if (left < a.chance) return a.key;
    left -= a.chance;
  }
  return "common";
}

/* ================= CRAFTED UIDS ================= */

// Every recipe's place in all the benches' lists, in registry order. Crafted
// uids start with it ("c17.42"), so two recipes never mint the same uid.
const CRAFT_INDEX = new Map();
Object.values(GameData.CRAFT_ACTIONS).flat().forEach((a, i) => {
  if (!CRAFT_INDEX.has(a.id)) CRAFT_INDEX.set(a.id, i);
});

export function craftIndex(actionId) {
  const i = CRAFT_INDEX.get(actionId);
  return i === undefined ? -1 : i;
}
