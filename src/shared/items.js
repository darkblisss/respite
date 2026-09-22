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
     fortified           "cold_ring|rare|c17.42|+7"        (unique, always)

   A fortification rides on the end as "+N", after the prefix when there
   is one. A piece that carries one is unique whatever its rarity, so a
   fortified Common stops stacking and is minted a uid of its own. Keys
   written before the Veil was ever worked into gear simply have no "+"
   segment, and read as +0. Only an amulet or a ring takes the Veil
   (CONFIG.enchant.slots): a "+N" on anything else is read as +0, whatever
   an older save or a stale market row still carries.

   Uids are derived from roll counters (c: crafted, f: found on a
   kill, s: a Sovereign's piece, m: bought on the market). Saves
   from v4 keep their plain numbers. Nothing here reads the save.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData, getGear, getTool, getMaterial, rarityDef, prefixDef } from "./registry.js";

const { gearStat } = CONFIG;

/* The tail segments are read by what they look like rather than by where they
   sit, so a relic's prefix and an enchantment can both be there, in either
   order, and an old key with neither reads the same as it always did. */
export function parseKey(key) {
  const b = String(key).split("|");
  const out = { base: b[0], rarity: b[1] || null, uid: b[2] || null, prefix: null, plus: 0 };
  for (let i = 3; i < b.length; i++) {
    const seg = b[i];
    if (!seg) continue;
    if (seg.charCodeAt(0) === 43) out.plus = Math.max(0, Math.floor(Number(seg.slice(1))) || 0);
    else out.prefix = seg;
  }
  // The Veil goes into jewellery and nothing else: a "+N" on a sword reads as +0.
  if (out.plus > 0 && !canFortify(out.base)) out.plus = 0;
  return out;
}

/* ================= THE VEIL ================= */

const FORTIFY_SLOTS = new Set(CONFIG.enchant.slots);

// Whether a base item (or a key, or a def) is the kind of gear the Veil goes into.
export function canFortify(what) {
  const base = what && typeof what === "object" ? what.base : String(what).split("|")[0];
  const g = getGear(base);
  return !!g && FORTIFY_SLOTS.has(g.slot);
}

/* The halo a worked piece wears at this level: { at, id, name } for the highest
   halo reached, or null below the first. */
export function haloOf(plus) {
  let halo = null;
  CONFIG.enchant.halos.forEach((hl) => { if (plus >= hl.at) halo = hl; });
  return halo;
}

// A halo's name from its id, for lines that only carry the id.
export function haloName(id) {
  const hl = CONFIG.enchant.halos.find((x) => x.id === id);
  return hl ? hl.name : String(id);
}

/* What a commander wears, one effect a piece: the amulet's halo is the glow
   round them, the ring's is the ring at their feet. { neck, ring }, each a halo
   or null, keyed by the slot the piece is worn in. */
export function wornHalos(equipment) {
  const out = {};
  CONFIG.enchant.slots.forEach((slot) => {
    const key = equipment && equipment[slot];
    out[slot] = key && canFortify(key) ? haloOf(parseKey(key).plus) : null;
  });
  return out;
}

// The highest halo a commander wears, for the places that name just one.
export function wornHalo(equipment) {
  let best = null;
  Object.values(wornHalos(equipment)).forEach((halo) => {
    if (halo && (!best || halo.at > best.at)) best = halo;
  });
  return best;
}

/* Common gear stacks. Anything finer needs its uid, a relic its prefix, and
   anything the Veil has been worked into carries its "+N" -- which is what makes
   an enchanted Common unique, because two pieces at different plus are not one
   pile however alike they started. */
export function makeKey(base, rarity, uid, prefix, plus = 0) {
  if (!rarity) return base;
  const p = plus > 0 && canFortify(base) ? `|+${plus}` : "";
  if (rarity === "common" && !p) return `${base}|common`;
  if (rarity === "relic") return `${base}|relic|${uid}|${prefix}${p}`;
  return `${base}|${rarity}|${uid}${p}`;
}

export function stacks(key) {
  return !parseKey(key).uid;
}

/* ================= DEFINITIONS ================= */

// A def never depends on the uid, so defs are kept by base, rarity and prefix.
// Frozen, because every caller shares them. Cleared if junk keys pile up.
const DEFS = new Map();

function buildDef(base, rarity, prefix, plus) {
  const g = getGear(base);
  if (g) {
    /* An enchantment multiplies the whole line, rarity and all: every stat a
       piece carries rises together, so working the Veil into a Relic is worth
       what working it into a Common is, proportionally. */
    const lvl = Math.max(0, plus || 0);
    const ench = 1 + lvl * CONFIG.enchant.gainPerLevel;
    const m = rarityDef(rarity || "common").mult * ench;
    // Worth is its own curve: a worked piece sells for more than its stats alone say.
    const worth = rarityDef(rarity || "common").mult * (1 + lvl * CONFIG.enchant.valuePerLevel);
    const pfx = prefix ? prefixDef(prefix) : null;
    const line = GameData.GEAR_LINES[g.line];
    const growth = CONFIG.hunt.gearGrowth;
    return {
      base, rarity: rarity || "common", prefix: prefix || null, plus: plus || 0, kind: "gear",
      // `line` is the stat line it was cut from, and the weapon mastery it earns.
      name: g.name, icon: g.icon, slot: g.slot, line: g.line,
      attack: gearStat(line.attack, growth.attack, g.tier, m),
      defence: gearStat(line.defence, growth.defence, g.tier, m),
      health: gearStat(line.health, growth.health, g.tier, m),
      crit: line.crit ? Math.round(line.crit * m * 1000) / 1000 : 0,
      veil: g.slot === "weapon" ? gearStat(CONFIG.hunt.weaponVeil[g.tier - 1], 1, 1, m) : 0,
      twoHanded: g.twoHanded,
      value: Math.round(g.value * worth * (pfx ? 2 : 1)), tier: g.tier, prof: g.prof,
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
  const { base, rarity, prefix, plus } = parseKey(key);
  const sig = `${base}|${rarity}|${prefix}|${plus}`;
  let def = DEFS.get(sig);
  if (def === undefined) {
    def = buildDef(base, rarity, prefix, plus);
    if (!def) return null;
    if (DEFS.size >= 20000) DEFS.clear();
    DEFS.set(sig, Object.freeze(def));
  }
  return def;
}

/* What a thing is called. Rarity is NOT part of it: an Epic pair of boots is a
   pair of boots, and calling it "Epic Mangy Boots" buries the item under a word
   the colour already says. Rarity rides on data-rarity, which tints the art, the
   slot and the frame everywhere one is drawn, and is spelled out in the item
   dialog's own line ("Epic boots") where it is worth spelling out.

   What DOES earn a place in the name is something the item actually has that
   another of its kind does not: a relic's prefix in front (Stalwart Mangy
   Boots), and an enchantment on the end where a smith would read it (+7). */
export function itemName(key) {
  const d = itemDef(key);
  if (!d) return String(key);
  const plus = d.plus > 0 ? ` +${d.plus}` : "";
  const pfx = d.prefix ? prefixDef(d.prefix) : null;
  return `${pfx ? `${pfx.name} ` : ""}${d.name}${plus}`;
}

// The rarity's own word, for the places that want to say it beside the name.
export function rarityName(key) {
  const d = itemDef(key);
  return d && d.rarity ? rarityDef(d.rarity).name : null;
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
  /* An enchantment rides on the end. It is checked and cut off first, so
     everything below reads exactly the key grammar it always read. */
  const plusAt = key.lastIndexOf("|+");
  if (plusAt >= 0) {
    const n = key.slice(plusAt + 2);
    if (!/^[0-9]{1,2}$/.test(n)) return false;
    const plus = Number(n);
    if (plus < 1 || plus > CONFIG.enchant.max) return false;
    /* Only gear is ever worked, and a worked piece is always unique -- including a
       Common, which is minted a uid the moment the Veil goes into it. That is the
       one shape the grammar below would otherwise refuse, so it is read here. */
    const parts = key.slice(0, plusAt).split("|");
    if (parts.length < 3 || parts.length > 4) return false;
    if (!getGear(parts[0]) || !isRarity(parts[1]) || !UID.test(parts[2])) return false;
    if (parts[1] === "relic") return parts.length === 4 && prefixPool(parts[0]).some((x) => x.id === parts[3]);
    return parts.length === 3;
  }
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

/* The tier of ground a Hunt level stands on: 1 at Lv1, 2 at Lv10, up to 9 at Lv80.
   A remedy weaker than that does nothing at all -- the bottle is sized for lesser
   wounds than you take now. A stronger one works, it just costs more than it had
   to, which is what makes buying the right tier the thrifty move rather than a
   rule anyone has to be told. */
export function tierForLevel(level) {
  const tiers = GameData.TIERS;
  let t = tiers[0].i;
  for (const row of tiers) if (level >= row.level) t = row.i;
  return t;
}

export function remedyTooWeak(key, huntLevel) {
  const d = itemDef(key);
  if (!d || !(d.heal > 0)) return false;
  return d.tier < tierForLevel(huntLevel);
}
