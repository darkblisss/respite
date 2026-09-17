/* ============================================================
   Respite · stats.js · The Measure
   ------------------------------------------------------------
   Levels from XP, Bond levels, and everything a fight needs to
   know about a hunter: health, attack, defence, the discipline
   and what worn relics add. combatStats() takes any loadout, so
   projections and the class picker can ask about anyone.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData, getClass } from "./registry.js";
import { itemDef, parseKey } from "./items.js";

const EQUIP_SLOTS = GameData.EQUIP_SLOTS;

/* ================= LEVELS ================= */

export function levelFromXp(xp) {
  const table = CONFIG.xpTable;
  let lvl = 1;
  for (let next = 2; next <= CONFIG.progression.maxLevel; next++) {
    if (!(xp >= table[next])) break;
    lvl = next;
  }
  return lvl;
}

export const xpForLevel = (level) => CONFIG.xpTable[level];

export function skillLevel(state, id) {
  return levelFromXp(state.skills[id] || 0);
}

export function totalLevel(state) {
  return GameData.SKILLS.reduce((n, s) => n + skillLevel(state, s.id), 0);
}

// Level by skill id, as the hiscores keep it.
export function levelsOf(state) {
  const out = {};
  GameData.SKILLS.forEach((s) => { out[s.id] = skillLevel(state, s.id); });
  return out;
}

// Where a skill stands inside its level, for XP bars.
export function xpProgress(state, id) {
  const max = CONFIG.progression.maxLevel;
  const xp = state.skills[id] || 0;
  const level = levelFromXp(xp);
  const maxed = level >= max;
  const base = CONFIG.xpTable[level];
  const next = CONFIG.xpTable[Math.min(level + 1, max)];
  return {
    level, xp, base, next, maxed,
    toNext: maxed ? 0 : next - xp,
    pct: maxed ? 100 : Math.max(0, Math.min(100, ((xp - base) / (next - base)) * 100)),
  };
}

// Bond level from Bond earned.
export function bondLevelFrom(bond) {
  const max = CONFIG.companions.maxBond;
  let lvl = 1;
  for (let next = 2; next <= max; next++) {
    if (!(bond >= CONFIG.bondXpFor(next))) break;
    lvl = next;
  }
  return lvl;
}

/* ================= GEAR ================= */

// Worn gear, summed.
export function equipStat(equipment, stat) {
  let total = 0;
  EQUIP_SLOTS.forEach((slot) => {
    const d = equipment[slot] ? itemDef(equipment[slot]) : null;
    if (d && typeof d[stat] === "number") total += d[stat];
  });
  return total;
}

// Relic prefixes are read straight off worn gear.
export function hasPrefix(equipment, id) {
  return EQUIP_SLOTS.some((s) => equipment[s] && parseKey(equipment[s]).prefix === id);
}

export function classDef(id) {
  return getClass(id) || null;
}

export function myClass(state) {
  return classDef(state.player.klass);
}

/* ================= COMBAT STATS ================= */

/* Everything a fight needs to know about a hunter, as one snapshot.
   loadout: { level, klass, equipment }. */
export function combatStats(loadout) {
  const lo = loadout;
  const eq = lo.equipment || {};
  const k = classDef(lo.klass) || GameData.BRUTE_FORCE;
  const has = (id) => hasPrefix(eq, id);
  const T = GameData.TECHNIQUE;
  const health = (CONFIG.baseHealth(lo.level) * k.health + equipStat(eq, "health")) * (has("vital") ? 1.05 : 1);

  return {
    level: lo.level, klass: k.id, className: k.name,
    maxHp: Math.max(1, Math.round(health)),
    attack: CONFIG.baseAttack(lo.level) * k.attack + equipStat(eq, "attack"),
    defence: (CONFIG.baseDefence(lo.level) * k.defence + equipStat(eq, "defence")) * (has("bulwark") ? 1.15 : 1),
    speed: k.speed,
    crit: Math.min(0.75, k.crit + equipStat(eq, "crit")),
    critDmg: k.critDmg,
    pen: Math.min(0.9, k.pen + (has("sundering") ? 0.15 : 0)),
    veilGain: k.id === "warrior" || k.id === "rogue" ? CONFIG.veilPerBlow(lo.level) + equipStat(eq, "veil") : 0,
    absorb: k.id === "mage" ? T.absorb + equipStat(eq, "veil") / 10 : 0,
    echoing: has("echoing"), furious: has("furious"), executioner: has("executioner"), wounding: has("wounding"),
    stalwart: has("stalwart"), vital: has("vital"), thorned: has("thorned"), resilient: has("resilient"),
  };
}

/* What a recent death still costs you, as a multiplier on every combat number.
   It runs on the world clock, so it ticks down while you are away too. 1 when
   whole. */
export function deathPenalty(state, at = state.clock) {
  const d = state.debuff;
  if (!d || !(d.until > at)) return 1;
  return d.mult;
}

/* The save's own hunter, with a recent death's wound already taken off. Everything
   that reads a hunter's numbers comes through here, so the penalty lands on the
   fight, the projections and the stat sheet at once and cannot be read around. */
export function statsOf(state, at = state.clock) {
  const s = combatStats({ level: skillLevel(state, "warfare"), klass: state.player.klass, equipment: state.equipment });
  const wounded = deathPenalty(state, at);
  if (wounded >= 1) return s;
  s.maxHp = Math.max(1, Math.round(s.maxHp * wounded));
  s.attack *= wounded;
  s.defence *= wounded;
  s.crit *= wounded;
  s.wounded = wounded;
  return s;
}

export function maxHp(state) {
  return statsOf(state).maxHp;
}

// The share of a blow that Defence stops, on ground of this tier.
export function mitigation(defence, tier) {
  if (!(defence > 0)) return 0;
  return Math.min(CONFIG.hunt.mitigationCap, defence / (defence + CONFIG.defenceK(tier)));
}

export function canPickClass(state) {
  return !state.player.klass && skillLevel(state, "warfare") >= CONFIG.progression.classPickLevel;
}

// Out of the hunt after a death. Counts down in game time, so it also runs while away.
export function recovering(state) {
  return state.player.recoveryLeft > 0;
}
