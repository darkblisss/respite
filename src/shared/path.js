/* ============================================================
   Respite · path.js · The Walk
   ------------------------------------------------------------
   A discipline's own tree. Ten nodes in three bands: four open
   with the oath, four more once six points are down, and two
   keystones at three apiece that want sixteen spent first.

   Points come with Hunt levels, one every CONFIG.path.pathPer
   from the level the oath is taken at. Hunt 99 pays thirty-two
   and a full tree costs thirty-eight, so a path is always a
   choice about what to leave out -- and always one a reset can
   change its mind about, for gold.

   The whole of a path's effect is a set of modifiers combatStats
   folds in beside gear. Nothing in the fight knows the tree
   exists; it reads the same sheet it always did.

   Nothing here throws dice, reads the clock, or writes the save
   except through the two commands at the bottom.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData, pathOf, pathNode } from "./registry.js";
import { skillLevel } from "./stats.js";
import { transact } from "./storage.js";
import { emit } from "./events.js";

const P = CONFIG.path;
const refuse = (error) => ({ ok: false, error });
const OK = () => ({ ok: true });

/* ================= 1. POINTS ================= */

/* What a Hunt level has paid out in all. Nothing before the oath's own level,
   then one every pathPer levels -- so the first point arrives with the oath and
   the last with Hunt 98. Undisciplined, none of it applies. */
export function pointsEarned(state) {
  if (!state.player.klass) return 0;
  const level = skillLevel(state, "warfare");
  const from = CONFIG.progression.classPickLevel;
  if (level < from) return 0;
  return Math.floor((level - from) / P.pathPer) + 1;
}

export const rankOf = (state, id) => {
  const bag = state.path;
  return bag && Object.hasOwn(bag, id) ? bag[id] : 0;
};

// What every rank standing has cost, together.
export function pointsSpent(state) {
  return pathOf(state.player.klass).reduce((n, node) => n + rankOf(state, node.id) * node.cost, 0);
}

export const pointsLeft = (state) => Math.max(0, pointsEarned(state) - pointsSpent(state));

// The Hunt level the next point comes at, or null at the cap.
export function nextPointAt(state) {
  const from = CONFIG.progression.classPickLevel;
  const level = skillLevel(state, "warfare");
  if (level < from) return from;
  const next = from + pointsEarned(state) * P.pathPer;
  return next > CONFIG.progression.maxLevel ? null : next;
}

/* ================= 2. WHAT A NODE WILL TAKE ================= */

// What a band wants spent before it opens at all.
export const gateOf = (node) => P.bandGates[Math.max(0, Math.min(P.bandGates.length - 1, node.band - 1))] || 0;

/* Why a node cannot take another point, or null when it can. Ordered so the
   message is the most useful one: yours, then open, then room, then the price. */
export function blockedReason(state, node) {
  if (!node) return "No such node.";
  if (!state.player.klass) return "Take a discipline first.";
  if (!pathOf(state.player.klass).some((n) => n.id === node.id)) return "That is not on your path.";
  if (rankOf(state, node.id) >= node.ranks) return "That is as far as it goes.";
  const gate = gateOf(node);
  const spent = pointsSpent(state);
  if (spent < gate) return `${gate - spent} more ${gate - spent === 1 ? "point" : "points"} on the path first.`;
  if (pointsLeft(state) < node.cost) {
    const at = nextPointAt(state);
    return at ? `No points left. The next comes at Hunt ${at}.` : "No points left.";
  }
  return null;
}

export const canTake = (state, node) => blockedReason(state, node) === null;

/* ================= 3. WHAT IT IS WORTH ================= */

const ZERO = Object.freeze({
  attackPct: 0, defencePct: 0, healthPct: 0, speedPct: 0,
  critFlat: 0, critDmgFlat: 0, penFlat: 0, veilFlat: 0, absorbFlat: 0, techPct: 0,
});

/* Every rank standing, added up, as one set of modifiers. `bag` is a save's
   state.path and `klass` its discipline, so a projection can ask about a walk
   that is not the save's. Everything is per rank in the registry, so a node at
   three ranks is simply three times its line.

   Two of them are shares of the finished stat (attackPct and friends) and the
   rest are added outright; combatStats knows which is which. */
export function pathMods(klass, bag) {
  const out = Object.assign({}, ZERO);
  if (!klass || !bag) return out;
  pathOf(klass).forEach((node) => {
    const rank = Object.hasOwn(bag, node.id) ? bag[node.id] : 0;
    if (!(rank > 0)) return;
    const r = Math.min(rank, node.ranks);
    Object.keys(node.per).forEach((k) => {
      if (Object.hasOwn(out, k)) out[k] += node.per[k] * r;
    });
  });
  return out;
}

/* ================= 4. THE PAGE ================= */

/* The whole tree as the Path tab draws it: every node with its rank, whether it
   is open, and why not when it is not. */
export function pathSheet(state) {
  const klass = state.player.klass;
  const spent = pointsSpent(state);
  const left = pointsLeft(state);
  const nodes = pathOf(klass).map((node) => {
    const rank = rankOf(state, node.id);
    const gate = gateOf(node);
    return {
      node, rank, gate,
      maxed: rank >= node.ranks,
      open: spent >= gate,
      can: canTake(state, node),
      why: blockedReason(state, node),
    };
  });
  return {
    klass, nodes, spent, left,
    earned: pointsEarned(state),
    full: pathOf(klass).reduce((n, x) => n + x.ranks * x.cost, 0),
    nextAt: nextPointAt(state),
    respecGold: spent * P.respecGold,
    bands: P.bandGates.map((at, i) => ({ band: i + 1, at, open: spent >= at })),
  };
}

/* ================= 5. COMMANDS ================= */

// One more rank on one node. Refuses without changing anything.
export function walkPath(state, { node: id } = {}, env) {
  const node = typeof id === "string" ? pathNode(id) : null;
  const no = blockedReason(state, node);
  if (no) return refuse(no);
  if (!state.path || typeof state.path !== "object") state.path = {};
  state.path[node.id] = rankOf(state, node.id) + 1;
  emit(state, env, "path:taken", { node: node.id, rank: state.path[node.id] });
  return OK();
}

/* Every point back, for gold. The oath itself is never given back -- a discipline
   is set once -- but how it was walked is always up for argument. */
export function resetPath(state, _args, env) {
  if (!state.player.klass) return refuse("Take a discipline first.");
  const spent = pointsSpent(state);
  if (!spent) return refuse("Nothing has been spent on your path.");
  const cost = spent * P.respecGold;
  const res = transact(state, (tx) => {
    tx.gold(-cost);
    tx.set(state, "path", {});
  });
  if (!res.ok) return res;
  emit(state, env, "path:reset", { points: spent, gold: cost });
  return OK();
}
