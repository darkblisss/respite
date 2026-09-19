/* ============================================================
   Respite · engine.js · The Clockwork
   ------------------------------------------------------------
   Moves a save through time and applies what the player does.

   advance(state, target, env) plays everything out to `target`. It
   cuts time at every moment where one system's result could change
   another's (a completion while the hunt shares storage, a Bond
   level, the day turning, a bounty window, a buff running out), so
   a save advanced in one call, in five-second steps or frame by
   frame ends up the same.

   applyCommand(state, cmd, env) never moves time: the caller
   advances to the command's moment first.
   ============================================================ */

import { CONFIG } from "./config.js";
import { SILENT } from "./events.js";
import { heldEverywhere } from "./storage.js";
import { maxHp } from "./stats.js";
import { windowIndex, nextDayAt } from "./weather.js";
import { activeCompanion, bondStep, nextBondIn, buyCompanion, setCompanion } from "./companions.js";
import { startSkill, stopSkill, nextSkillDue, resolveSkilling } from "./skills.js";
import { startHunt, pullBack, setHide, huntStep, repair } from "./combat.js";
import {
  refreshBounty, resolveRequisitions, claimBounty, hireAgent, deployAgent, buyRemedy, buySmuggler,
  travel, equip, unequip, unequipTool, moveItem, sellItem, useChest, useRemedy, salvage, reorder, pickClass,
} from "./world.js";

const WINDOW_MS = CONFIG.time.windowMs;

// { emit(type, payload), party, fx }. No emitter gives a silent env.
export function makeEnv({ emitter = null, party = null, fx = false } = {}) {
  return {
    emit: emitter ? (type, payload) => emitter.emit(type, payload) : () => {},
    party,
    fx: !!fx,
  };
}

// The world clock's own changes: the day's requisitions, the bounty board.
function settleWorld(state, env) {
  resolveRequisitions(state, env, state.clock);
  refreshBounty(state);
}

export function advance(state, target, env = SILENT) {
  const end = Math.floor(target);
  settleWorld(state, env);
  if (!(end > state.clock)) return;

  while (state.clock < end) {
    const clock = state.clock;
    const tasks = state.tasks;
    const running = !!(tasks.skilling || tasks.combat);

    let next = end;
    // The hunt and the bench share storage: they interleave at every completion.
    if (tasks.skilling && tasks.combat) next = Math.min(next, clock + nextSkillDue(state));
    // Bond levels change speed, double yield, reagents, gold, drops and finds.
    if (running && activeCompanion(state)) next = Math.min(next, clock + nextBondIn(state));
    // Unconditional while any are out: the log line carries the time they came back.
    if (state.requisitions.some((r) => !r.resolved)) next = Math.min(next, nextDayAt(clock));
    // Bounties re-post, and days turn (a day boundary is always a window boundary).
    next = Math.min(next, (windowIndex(clock) + 1) * WINDOW_MS);
    if (state.buff && state.buff.until > clock) next = Math.min(next, state.buff.until);
    // A death's wound changes every combat number the moment it lifts.
    if (state.debuff && state.debuff.until > clock) next = Math.min(next, state.debuff.until);
    const dt = next - clock;

    state.player.recoveryLeft = 0;

    // Hunt before bench at equal times.
    const deaths = state.stats.deaths;
    const huntRan = tasks.combat ? huntStep(state, dt, env, clock) : 0;
    // A death partway through starts recovery then, not at the end of the stretch.
    if (state.stats.deaths > deaths) state.player.recoveryLeft = 0;
    if (!state.tasks.combat && state.player.hp > maxHp(state)) state.player.hp = maxHp(state);

    const skillRan = state.tasks.skilling ? resolveSkilling(state, dt, env, clock) : 0;

    // Bond accrues only for time a task actually ran.
    const ran = Math.max(huntRan, skillRan);
    if (ran > 0) {
      bondStep(state, ran, env, clock + ran);
      state.meta.playtimeMs += ran;
    }

    state.clock = next;
    if (state.buff && state.buff.until <= state.clock) state.buff = null;
    if (state.debuff && state.debuff.until <= state.clock) state.debuff = null;
    settleWorld(state, env);
  }
}

/* ================= COMMANDS ================= */

const needsServer = () => ({ ok: false, error: "That needs the server." });

export const SERVER_ONLY = Object.freeze([
  "marketList", "marketBuy", "marketBuyPool", "marketCancel",
  "partyHuntStart", "partyHuntJoin", "partyHuntLeave",
]);

export const COMMANDS = Object.freeze({
  startSkill:   { run: startSkill, predict: true },
  stopSkill:    { run: stopSkill, predict: true },
  startHunt:    { run: startHunt, predict: true },
  pullBack:     { run: pullBack, predict: true },
  setHide:      { run: setHide, predict: true },
  pickClass:    { run: pickClass, predict: true },
  equip:        { run: equip, predict: true },
  unequip:      { run: unequip, predict: true },
  unequipTool:  { run: unequipTool, predict: true },
  moveItem:     { run: moveItem, predict: true },
  sellItem:     { run: sellItem, predict: true },
  salvage:      { run: salvage, predict: true },
  useChest:     { run: useChest, predict: true },
  useRemedy:    { run: useRemedy, predict: true },
  repair:       { run: repair, predict: true },
  reorder:      { run: reorder, predict: true },
  buyRemedy:    { run: buyRemedy, predict: true },
  buySmuggler:  { run: buySmuggler, predict: true },
  travel:       { run: travel, predict: true },
  claimBounty:  { run: claimBounty, predict: true },
  hireAgent:    { run: hireAgent, predict: true },
  deployAgent:  { run: deployAgent, predict: true },
  buyCompanion: { run: buyCompanion, predict: true },
  setCompanion: { run: setCompanion, predict: true },
  /* The market needs the database; the server handles these itself. marketBuy takes one
     listing by its id (gear and tools, one piece a row); marketBuyPool takes a material by
     name, quantity and price ceiling out of the pool every seller's listing of it makes. */
  marketList:    { run: needsServer, predict: false },
  marketBuy:     { run: needsServer, predict: false },
  marketBuyPool: { run: needsServer, predict: false },
  marketCancel:  { run: needsServer, predict: false },
  /* A party's fight belongs to the party, not to a save: it is played by the server alone
     (partyHunt.js), so the browser cannot predict one and never tries. */
  partyHuntStart: { run: needsServer, predict: false },
  partyHuntJoin:  { run: needsServer, predict: false },
  partyHuntLeave: { run: needsServer, predict: false },
});

// cmd { type, args }. Untrusted: anything that is not a plain args object counts as none.
export function applyCommand(state, cmd, env = SILENT) {
  const type = cmd && typeof cmd === "object" ? cmd.type : undefined;
  if (typeof type !== "string" || !Object.hasOwn(COMMANDS, type)) return { ok: false, error: "Unknown command." };
  if (SERVER_ONLY.includes(type)) return needsServer();
  const raw = cmd.args;
  const args = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return COMMANDS[type].run(state, args, env);
}

/* ================= TIME AWAY ================= */

// What to compare before and after a stretch away.
export function awaySnapshot(state) {
  return { held: heldEverywhere(state), gold: state.player.gold };
}

// { ms, gains: [{ key, qty }], gold } from two awaySnapshot()s. Emit it as "away".
export function summariseAway(before, after, ms) {
  const gains = [];
  Object.keys(after.held).forEach((key) => {
    const d = after.held[key] - (Object.hasOwn(before.held, key) ? before.held[key] : 0);
    if (d > 0) gains.push({ key, qty: d });
  });
  return { ms, gains, gold: Math.max(0, after.gold - before.gold) };
}
