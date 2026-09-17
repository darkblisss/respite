/* ============================================================
   Respite · skills.js · The Crews
   ------------------------------------------------------------
   Gathering and the artisan benches. A task runs `limit` actions,
   or with no limit (null) until the stock or storage runs out or
   twelve hours pass, whichever comes first.

   Time is resolved by arithmetic, not by stepping: however long a
   stretch is, the completions inside it are counted up front and
   each one lands at its own millisecond. Everything worth money is
   rolled on the a:<action> counter, so the same save makes the same
   things however time is sliced.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData, findAction, getSkill, isGather } from "./registry.js";
import { makeKey, rarityFromRoll, prefixFromRoll, craftIndex } from "./items.js";
import { ORDER, orderFor, placeFor, canPay, stockCovers, isFull, transact } from "./storage.js";
import { skillLevel } from "./stats.js";
import { xpEach, addXp, actionTime, doubleChance } from "./progression.js";
import { companionBonus, companionFinds } from "./companions.js";
import { bountyProgress } from "./world.js";
import { roll, SALT } from "./rng.js";
import { emit } from "./events.js";
import { clamp } from "./format.js";

const IDLE_CAP = CONFIG.time.idleCapMs;
const MAX_LIMIT = 100000;
const refuse = (error) => ({ ok: false, error });

// Gathering and artisan skills have tasks. The hunt is combat.js.
const isWorkSkill = (skillId) => {
  const s = typeof skillId === "string" ? getSkill(skillId) : null;
  return !!s && (s.kind === "gather" || s.kind === "craft");
};

/* ================= STARTING AND STOPPING ================= */

// Whether what an action makes has somewhere to go. Rolled gear always
// needs a free slot, because it might not stack.
function roomFor(state, def) {
  if (def.craftGear) return ORDER.gear.some((w) => !isFull(state, w));
  return Object.keys(def.out || {}).every((k) => placeFor(state, k, orderFor(k)) !== null);
}

export function startSkill(state, { skillId, actionId, limit } = {}, env) {
  if (!isWorkSkill(skillId)) return refuse("No such work.");
  const def = typeof actionId === "string" ? findAction(skillId, actionId) : null;
  if (!def) return refuse("No such work.");
  if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)) {
    return refuse("A batch is 1 to 100,000, or no limit.");
  }
  if (skillLevel(state, skillId) < def.level) return refuse(`Needs ${getSkill(skillId).name} ${def.level}.`);
  if (stockCovers(state, def.cost) < 1) return refuse("Not enough materials.");
  if (!roomFor(state, def)) return refuse("Nowhere to put anything.");

  const old = state.tasks.skilling;
  const task = {
    id: state.serial++, skillId, actionId, progress: 0, done: 0, elapsed: 0,
    limit: limit == null ? null : limit, startedAt: state.clock,
  };
  // The same work again keeps the action that is already underway.
  if (old && old.skillId === skillId && old.actionId === actionId) task.progress = old.progress;
  state.tasks.skilling = task;
  return { ok: true };
}

export function stopSkill(state, _args, _env) {
  state.tasks.skilling = null;
  return { ok: true };
}

/* ================= RESOLVING ================= */

// Milliseconds until the running task's next completion or its twelve-hour
// cap. 0 when one is already due (a speed change can do that). Infinity when idle.
export function nextSkillDue(state) {
  const task = state.tasks.skilling;
  if (!task) return Infinity;
  const def = findAction(task.skillId, task.actionId);
  if (!def) return 0;
  return Math.max(0, Math.min(actionTime(state, def) - task.progress, IDLE_CAP - task.elapsed));
}

const STOCK = "stock";

/* One completed action at `at`: pays, makes, rolls. Returns null when it
   went through, or the reason the task has to end ("stock", "storage"). */
function completeAction(state, task, def, env, at) {
  const rollKey = `a:${def.id}`;
  const n = state.rolls[rollKey] || 0;
  const seed = state.rng.seed;
  const gathering = isGather(def.skillId);
  let crafted = null;

  const res = transact(state, (tx) => {
    if (!canPay(state, def.cost)) tx.fail(STOCK);
    tx.pay(def.cost);
    if (def.out) {
      const dbl = gathering && roll(seed, rollKey, n, SALT.double) < doubleChance(state, def.skillId);
      Object.keys(def.out).forEach((k) => tx.stash(k, dbl ? def.out[k] * 2 : def.out[k]));
    }
    if (def.craftGear) {
      const rarity = rarityFromRoll(roll(seed, rollKey, n, SALT.rarity));
      const uid = `c${craftIndex(def.id)}.${n}`;
      const prefix = rarity === "relic" ? prefixFromRoll(def.craftGear, roll(seed, rollKey, n, SALT.prefix)) : null;
      const key = makeKey(def.craftGear, rarity, uid, prefix);
      if (!placeFor(state, key, ORDER.gear)) tx.fail("storage");
      tx.stash(key, 1, ORDER.gear);
      crafted = { key, rarity };
    }
  });
  if (!res.ok) return res.error === STOCK ? "stock" : "storage";

  if (def.out) {
    // Reagents turn up alongside. One with nowhere to go is left, and the work goes on.
    const reagentBonus = gathering ? companionBonus(state, "reagent", def.skillId) : 0;
    const side = (key) => {
      if (!transact(state, (tx) => tx.stash(key, 1)).ok) emit(state, env, "storage:full", { key, at });
    };
    if (def.reagentId && roll(seed, rollKey, n, SALT.reagent) < def.reagentChance * (1 + reagentBonus)) side(def.reagentId);
    // On dedicated reagent ground the companion bonus is a chance of one extra.
    const node = GameData.REAGENTS.find((r) => Object.hasOwn(def.out, r.id));
    if (node && reagentBonus && roll(seed, rollKey, n, SALT.reagentExtra) < reagentBonus) side(node.id);
  }

  if (crafted) {
    state.stats.crafted++;
    bountyProgress(state, "craft", def, env, at);
    if (["epic", "legendary", "relic"].includes(crafted.rarity)) state.stats.epics++;
    emit(state, env, "item:crafted", { key: crafted.key, rarity: crafted.rarity, skillId: def.skillId, at });
  }

  task.done++;
  state.stats.actions++;
  addXp(state, def.skillId, xpEach(state, def.skillId, def.xp, at), env, at);
  bountyProgress(state, "gather", def, env, at);
  companionFinds(state, def.skillId, rollKey, n, env, at);
  state.rolls[rollKey] = n + 1;
  return null;
}

function endTask(state, task, reason, elapsedMs, env, at) {
  state.tasks.skilling = null;
  emit(state, env, "task:ended", { skillId: task.skillId, actionId: task.actionId, reason, done: task.done, elapsedMs, at });
}

/* Plays the skilling task forward dt milliseconds from at0. Returns dt, or
   the offset inside the stretch at which the task ended. The action time is
   read once: advance() never lets anything change speed inside one call. */
export function resolveSkilling(state, dt, env, at0) {
  const task = state.tasks.skilling;
  if (!task) return 0;
  const def = findAction(task.skillId, task.actionId);
  if (!def) {
    state.tasks.skilling = null;
    return 0;
  }

  const time = actionTime(state, def);
  const budget = Math.max(0, Math.min(dt, IDLE_CAP - task.elapsed));
  let due = Math.floor((task.progress + budget) / time);
  if (task.limit != null) due = Math.min(due, Math.max(0, task.limit - task.done));

  for (let i = 0; i < due; i++) {
    // An action already overdue (the crews got quicker) lands at once.
    const offset = Math.max(0, (i + 1) * time - task.progress);
    const at = at0 + offset;
    const stop = completeAction(state, task, def, env, at);
    if (stop) {
      endTask(state, task, stop, task.elapsed + offset, env, at);
      return offset;
    }
    if (task.limit != null && task.done >= task.limit) {
      endTask(state, task, "limit", task.elapsed + offset, env, at);
      return offset;
    }
  }

  task.progress = task.progress + budget - due * time;
  task.elapsed += budget;
  if (task.elapsed >= IDLE_CAP) {
    endTask(state, task, "cap", task.elapsed, env, at0 + budget);
    return budget;
  }
  return dt;
}

/* ================= PLANS (UI) ================= */

// The most a fresh task could run: twelve hours of it, or what the stock covers.
export function actionMax(state, def) {
  return Math.min(Math.floor(IDLE_CAP / actionTime(state, def)), stockCovers(state, def.cost));
}

// The running task at a glance: how far along, what stops it, when.
export function skillPlan(state) {
  const t = state.tasks.skilling;
  if (!t) return null;
  const def = findAction(t.skillId, t.actionId);
  if (!def) return null;

  const time = actionTime(state, def);
  const windowLeft = Math.max(0, IDLE_CAP - (t.elapsed || 0));
  const byTime = Math.floor((windowLeft + t.progress) / time);
  const byStock = stockCovers(state, def.cost);
  const byLimit = t.limit == null ? Infinity : Math.max(0, t.limit - t.done);
  const remaining = Math.min(byTime, byStock, byLimit);

  let capped = "time";
  if (remaining === byLimit && byLimit <= byTime) capped = "limit";
  else if (remaining === byStock && byStock < byTime) capped = "stock";

  return {
    def, time, done: t.done, limit: t.limit, remaining, target: t.done + remaining,
    timeLeft: Math.max(0, remaining * time - t.progress), capped,
    pct: clamp((t.progress / time) * 100, 0, 100),
  };
}

