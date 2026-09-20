/* ============================================================
   Respite · mastery.js · The Hours
   ------------------------------------------------------------
   What a weapon owes you for carrying it. One track a line --
   Sword, Shield, Dagger, Bow, Staff, Greatsword, Grimoire --
   running 0 to 100, earned a kill at a time and by nothing else.

   HOW IT IS EARNED
   One kill, one line. Every kill credits a single line with the
   same share of the points it paid Warfare, so no loadout earns
   faster than another and none of them earn twice: a greatsword
   and a bare sword and a sword behind a shield all advance one
   track at one rate.

   Which line is the one in your OFF-HAND, if there is anything in
   it, and otherwise the one in your hands. A shield carried is a
   shield being learned, and the sword behind it is only being
   held -- so a sword-and-board hunter masters the shield, and has
   to put it down to master the sword. That is a real choice about
   what you are becoming, which is what a mastery is for.

   Weather, a bounty's buff and the companion at your side all bend
   Warfare XP; none of them bend this. An hour with a bow is an
   hour with a bow whatever the sky is doing.

   The BONUS is not the same rule: every worn piece pays out its
   own line's mastery, so a shield at 60 is still worth its Defence
   while a sword at 40 is worth its damage. You are paid for what
   you have learned; you only go on learning one thing at a time.

   WHAT IT PAYS
   A flat CONFIG.mastery.perLevel on the line's own stat, while
   that piece is worn: a weapon pays in damage, a shield pays in
   Defence. Maxed, either is +15%. Take the piece off and the
   bonus goes with it, which is what makes a mastery a mastery
   rather than another level.

   WHAT IT DOES NOT DO
   Mastery never unlocks a weapon and never gates one. What you may
   hold is your discipline's business (registry.js, CLASS_WEAPONS);
   this only says how well you hold it.

   Nothing here throws dice, and nothing here reads the clock.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData, weaponLine, classWeapons } from "./registry.js";
import { itemDef } from "./items.js";

const M = CONFIG.mastery;
const TABLE = CONFIG.masteryTable;

/* ================= 1. THE TRACK ================= */

// Level from points earned. 0 until the first band is filled.
export function masteryLevel(points) {
  const xp = Number.isFinite(points) && points > 0 ? points : 0;
  let lvl = 0;
  for (let next = 1; next <= M.max; next++) {
    if (!(xp >= TABLE[next])) break;
    lvl = next;
  }
  return lvl;
}

export const masteryPoints = (state, line) => {
  const bag = state.mastery;
  return bag && Object.hasOwn(bag, line) ? bag[line] : 0;
};

export const levelOf = (state, line) => masteryLevel(masteryPoints(state, line));

// The grade a level reads as: Untried, Novice ... Grandmaster. Saint is a rank, not a grade.
export function gradeOf(level) {
  let name = M.grades[0].name;
  M.grades.forEach((g) => { if (level >= g.at) name = g.name; });
  return name;
}

// The five named milestones on a line, with the level each sits at and whether it is passed.
export function milestonesOf(line, level) {
  const def = weaponLine(line);
  if (!def) return [];
  return M.rankLevels.map((at, i) => ({ at, name: def.ranks[i], won: level >= at }));
}

/* Where a line stands, for the Mastery page and the stat sheet. `next` is the
   points the next level wants, `into`/`band` the progress through the one being
   worked, so a bar reads "8,214 / 9,000" without the caller doing sums. */
export function masteryProgress(state, line) {
  const def = weaponLine(line);
  const points = masteryPoints(state, line);
  const level = masteryLevel(points);
  const maxed = level >= M.max;
  const base = TABLE[level];
  const next = maxed ? TABLE[M.max] : TABLE[level + 1];
  const band = Math.max(1, next - base);
  const into = Math.max(0, Math.min(band, points - base));
  return {
    line, def, points, level, maxed,
    grade: gradeOf(level),
    milestones: milestonesOf(line, level),
    stat: def ? def.stat : "attack",
    bonus: bonusAt(level),
    base, next, band, into,
    toNext: maxed ? 0 : next - points,
    pct: maxed ? 100 : (into / band) * 100,
  };
}

// The share a level is worth on the line's own stat. +15% at 100.
export const bonusAt = (level) => Math.max(0, level) * M.perLevel;

/* ================= 2. WHAT IT IS WORTH IN A FIGHT ================= */

/* The multipliers a loadout's masteries are worth, as { attack, defence }, both 1
   when nothing is worn or nothing is earned. Only the lines actually held count:
   a hundred in the Bow does nothing at all for the sword in your hand.

   `bag` is a save's state.mastery (or anything shaped like it), so projections and
   the class picker can ask about a loadout that is not the save's. */
export function masteryMods(equipment, bag) {
  const out = { attack: 1, defence: 1 };
  if (!equipment || !bag) return out;
  const seen = [];
  ["weapon", "offhand"].forEach((slot) => {
    const line = lineOfKey(equipment[slot]);
    if (!line || seen.includes(line)) return;
    seen.push(line);
    const def = weaponLine(line);
    const points = Object.hasOwn(bag, line) ? bag[line] : 0;
    out[def.stat] += bonusAt(masteryLevel(points));
  });
  return out;
}

// The armed line a worn key belongs to, or null for anything unarmed (a helm, a ring).
export function lineOfKey(key) {
  const d = key ? itemDef(key) : null;
  if (!d || d.kind !== "gear") return null;
  return weaponLine(d.line) ? d.line : null;
}

/* ================= 3. EARNING IT ================= */

/* The one line a kill is learning: the off-hand when something is in it, the
   weapon otherwise, and nothing at all with empty hands. See the header -- this
   is what keeps every loadout earning at one rate. */
export function masteryLineFor(equipment) {
  if (!equipment) return null;
  return lineOfKey(equipment.offhand) || lineOfKey(equipment.weapon) || null;
}

/* One kill's worth, into that one line. A line already at 100 keeps taking
   points (the hiscores rank on them), it simply stops levelling. Returns the
   lines credited -- one, or none -- for a caller that wants to say so. */
export function addMastery(state, amount, equipment = state.equipment) {
  const raw = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const gain = raw * M.perKill;
  if (!gain) return [];
  const line = masteryLineFor(equipment);
  if (!line) return [];
  if (!state.mastery || typeof state.mastery !== "object") state.mastery = {};
  state.mastery[line] = (state.mastery[line] || 0) + gain;
  return [line];
}

/* ================= 4. THE PAGE ================= */

/* Every line in the Mastery page's order, with a `held` flag saying whether this
   discipline may carry it at all. An unavailable line still shows -- it reads as a
   dash rather than a number -- because what you cannot hold is worth knowing. */
export function masterySheet(state) {
  const allowed = classWeapons(state.player.klass);
  const learning = masteryLineFor(state.equipment);
  // A line not out in the world yet is not listed at all: see registry.js, `released`.
  return GameData.WEAPON_LINES.filter((def) => def.released !== false).map((def) => {
    const row = masteryProgress(state, def.line);
    row.held = allowed.includes(def.line);
    row.learning = def.line === learning;
    return row;
  });
}
