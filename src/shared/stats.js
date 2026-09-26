/* ============================================================
   Respite · stats.js · The Measure
   ------------------------------------------------------------
   Levels from XP, Bond levels, and everything a fight needs to
   know about a hunter: health, attack, defence, the discipline
   and what worn relics add. combatStats() takes any loadout, so
   projections and the class picker can ask about anyone.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData, getClass, classHolds } from "./registry.js";
import { itemDef, parseKey } from "./items.js";
import { masteryMods } from "./mastery.js";
import { pathMods } from "./path.js";

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
   loadout: { level, klass, equipment, mastery }. `mastery` is a save's
   state.mastery, or anything shaped like it; left out, no weapon mastery is
   counted, which is what a bare projection wants. */
export function combatStats(loadout) {
  const lo = loadout;
  const eq = lo.equipment || {};
  const k = classDef(lo.klass) || GameData.BRUTE_FORCE;
  const has = (id) => hasPrefix(eq, id);
  const T = GameData.TECHNIQUE;
  const health = (CONFIG.baseHealth(lo.level) * k.health + equipStat(eq, "health")) * (has("vital") ? 1.05 : 1);

  /* What the hours spent carrying these two pieces are worth: a weapon pays in
     damage, a shield in Defence, and only while the piece is actually worn. */
  const mast = masteryMods(eq, lo.mastery || null);
  /* And what the path walked is worth. Both land here, beside gear, so nothing in
     the fight has to know either of them exists. */
  const pw = pathMods(k.id, lo.path || null);

  const r2 = CONFIG.round2;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const H = CONFIG.hunt;

  return {
    level: lo.level, klass: k.id, className: k.name,
    maxHp: Math.max(1, r2(health * (1 + pw.healthPct))),
    attack: r2((CONFIG.baseAttack(lo.level) * k.attack + equipStat(eq, "attack")) * mast.attack * (1 + pw.attackPct)),
    defence: r2((CONFIG.baseDefence(lo.level) * k.defence + equipStat(eq, "defence")) * (has("bulwark") ? 1.15 : 1) * mast.defence * (1 + pw.defencePct)),
    speed: Math.max(400, Math.round(k.speed * (1 - Math.min(0.5, pw.speedPct)))),
    crit: r3(Math.min(0.75, k.crit + equipStat(eq, "crit") + pw.critFlat)),
    critDmg: r3(k.critDmg + pw.critDmgFlat),
    pen: r3(Math.min(0.9, k.pen + (has("sundering") ? 0.15 : 0) + pw.penFlat)),
    // A share of every blow you land, back as health: a hundredth for everyone, and whatever gear adds.
    lifesteal: r3(Math.min(H.lifestealCap, k.lifesteal + equipStat(eq, "lifesteal"))),
    // A blocked blow lands at half; a dodged one never lands. Neither is anyone's by birth.
    block: r3(Math.min(H.blockCap, k.block + equipStat(eq, "block") + (has("stalwart") ? 0.1 : 0))),
    dodge: r3(Math.min(H.dodgeCap, k.dodge + equipStat(eq, "dodge"))),
    // Veil Power: what a full Veil is worth when it goes off. 1 until the path or an amulet says otherwise.
    tech: r3(1 + pw.techPct + equipStat(eq, "tech")),
    veilGain: k.id === "warrior" || k.id === "rogue" ? CONFIG.veilPerBlow(lo.level) + equipStat(eq, "veil") + pw.veilFlat : 0,
    /* A Mage drinks the Veil out of the air instead: a weapon's Veil a blow is worth
       T.absorbPerVeil of it a second, which grows a Mage's technique as much as it
       grows a Warrior's or a Rogue's. */
    absorb: k.id === "mage" ? T.absorb + equipStat(eq, "veil") * T.absorbPerVeil + pw.absorbFlat : 0,
    echoing: has("echoing"), furious: has("furious"), executioner: has("executioner"), wounding: has("wounding"),
    vital: has("vital"), thorned: has("thorned"), resilient: has("resilient"),
  };
}

/* The most health this save's hunter would have at another Hunt level, gear and all.
   A level's worth of new health is added to what you have, not a full bar. */
export function maxHpAtLevel(state, level) {
  return combatStats({
    level, klass: state.player.klass,
    equipment: state.equipment, mastery: state.mastery, path: state.path,
  }).maxHp;
}

/* What a recent death still costs you, as a multiplier on your Attack. It runs on
   the world clock, so it ticks down while you are away too. 1 when whole. */
export function deathPenalty(state, at = state.clock) {
  const d = state.debuff;
  if (!d || !(d.until > at)) return 1;
  return d.mult;
}

/* The save's own hunter, with a recent death's wound already taken off. Everything
   that reads a hunter's numbers comes through here, so the penalty lands on the
   fight, the projections and the stat sheet at once and cannot be read around.

   The wound is on the Attack and nothing else: you are as hard to put down as you
   ever were, you simply kill slower for ten minutes. */
export function statsOf(state, at = state.clock) {
  const s = combatStats({
    level: skillLevel(state, "warfare"), klass: state.player.klass,
    equipment: state.equipment, mastery: state.mastery, path: state.path,
  });
  const wounded = deathPenalty(state, at);
  if (wounded >= 1) return s;
  s.attack = CONFIG.round2(s.attack * wounded);
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

/* Whether a loadout may hold a piece at all. Only the armed lines are anyone's
   business: a discipline narrows what you carry in your hands, never what you
   wear on your back. Undisciplined, everything is open. */
export function classCanHold(klass, key) {
  const d = key ? itemDef(key) : null;
  if (!d || d.kind !== "gear") return true;
  return classHolds(klass, d.line);
}

// What is worn that this discipline may not hold, by slot. Empty when all is well.
export function heldWrongly(klass, equipment) {
  return GameData.EQUIP_SLOTS.filter((slot) => equipment[slot] && !classCanHold(klass, equipment[slot]));
}

/* A death no longer bars the gate; only the Attack wound remains, and that is read
   through deathPenalty. Kept returning false so any caller that has not caught up
   lets the hunt set out. */
export function recovering(_state) {
  return false;
}
