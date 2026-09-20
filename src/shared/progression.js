/* ============================================================
   Respite · progression.js · The Ladder
   ------------------------------------------------------------
   XP and what bends it (weather, the Bountiful Weekend, the
   companion at your side, a bounty's reward, hunting beside your
   party), levels, gathering mastery, tools and action speed.
   Weather is XP, mastery is yield, tools and companions are speed.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData, isTrade, getTool } from "./registry.js";
import { skillLevel, maxHp, canPickClass } from "./stats.js";
import { weatherAt } from "./weather.js";
import { companionBonus } from "./companions.js";
import { emit } from "./events.js";

/* ================= XP ================= */

// The day's whole-percent XP change for a skill (0 for most).
const weatherPctFor = (w, skillId) => (Object.hasOwn(w.mods, skillId) ? w.mods[skillId] : 0);

// Everything bending a skill's XP at `at`, part by part. mult is them all together.
// weather is the day's forecast, weatherPct its whole-percent change for this skill,
// companion the added share, buff the multiplier (1 when none).
export function xpBreakdown(state, skillId, at) {
  const w = weatherAt(at);
  const bountiful = !!w.bountiful && isTrade(skillId);
  // Bountiful Weekend stands alone: Mon-Fri roll for the favoured/hindered
  // change, Sat-Sun a flat bonus instead -- never both on the same day.
  return {
    weather: w,
    weatherPct: bountiful ? 0 : weatherPctFor(w, skillId),
    bountiful,
    companion: companionBonus(state, "xp", skillId),
    buff: state.buff && state.buff.until > at ? state.buff.mult : 1,
    mult: xpMult(state, skillId, at),
  };
}

export function xpMult(state, skillId, at) {
  let m = 1;
  if (skillId) {
    const w = weatherAt(at);
    const bountiful = w.bountiful && isTrade(skillId);
    // Weekend: a guaranteed flat +20%, and nothing else from the sky that day.
    // Weekday: whatever the day's favoured/hindered roll comes out to, alone.
    const mod = bountiful ? 1 + CONFIG.weather.bountifulXp : (weatherPctFor(w, skillId) ? 1 + weatherPctFor(w, skillId) / 100 : 1);
    m = mod * (1 + companionBonus(state, "xp", skillId));
  }
  if (state.buff && state.buff.until > at) m *= state.buff.mult;
  return m;
}

/* Hunting the same ground at the same time as party members.
   env.party = { intervals: [{ tier, zone, start, end }] }, one per other
   member's hunt; end null means still out. */
export function partyMult(env, tier, zone, at) {
  const intervals = env && env.party && Array.isArray(env.party.intervals) ? env.party.intervals : null;
  if (!intervals) return 1;
  let members = 0;
  for (const iv of intervals) {
    if (iv && iv.tier === tier && iv.zone === zone && iv.start <= at && (iv.end == null || at < iv.end)) members++;
  }
  const P = CONFIG.party;
  return 1 + Math.min(P.huntBonusCap, P.huntBonusPerMember * members);
}

// What one action or kill actually grants, after every multiplier.
export function xpEach(state, skillId, amount, at) {
  return Math.max(1, Math.round(amount * xpMult(state, skillId, at)));
}

/* Adds XP that already carries its multipliers. The hunt adds fractions of a
   point; the total keeps them. Returns true on a level up. */
export function addXp(state, skillId, gain, env, at) {
  const before = skillLevel(state, skillId);
  state.skills[skillId] = (state.skills[skillId] || 0) + gain;
  const after = skillLevel(state, skillId);
  if (after <= before) return false;

  emit(state, env, "skill:level", { skillId, level: after, at });
  const hit = Object.hasOwn(GameData.GATHER_ACTIONS, skillId) ? GameData.MASTERY_TRACK.find((m) => m.level === after) : null;
  if (hit) emit(state, env, "skill:mastery", { skillId, level: after, label: hit.label, at });
  if (skillId === "warfare") {
    state.player.hp = maxHp(state);
    if (canPickClass(state)) emit(state, env, "class:available", { at });
  }
  return true;
}

/* ================= MASTERY, TOOLS & SPEED ================= */

// Gathering only. Artisan benches get nothing from this.
export function mastery(state, skillId) {
  if (!Object.hasOwn(GameData.GATHER_ACTIONS, skillId)) return { double: 0 };
  const lvl = skillLevel(state, skillId);
  let dbl = 0;
  GameData.MASTERY_TRACK.forEach((m) => { if (lvl >= m.level) dbl += m.double; });
  return { double: dbl };
}

export function toolFor(state, skillId) {
  const tools = state.tools;
  const id = tools && Object.hasOwn(tools, skillId) ? tools[skillId] : null;
  return id ? getTool(id) : null;
}

// Speed comes from tools and companions.
export function speedMod(state, skillId) {
  let m = 1;
  const tool = toolFor(state, skillId);
  if (tool) m *= (1 - tool.speed);
  m *= 1 - companionBonus(state, "speed", skillId);
  return Math.max(0.35, m);
}

export function actionTime(state, def) {
  return Math.max(1000, Math.round(def.time * speedMod(state, def.skillId)));
}

export function doubleChance(state, skillId) {
  if (!Object.hasOwn(GameData.GATHER_ACTIONS, skillId)) return 0;
  return Math.min(0.75, mastery(state, skillId).double + companionBonus(state, "double", skillId));
}
