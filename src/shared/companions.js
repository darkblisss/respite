/* ============================================================
   Respite · companions.js · The Kennel
   ------------------------------------------------------------
   Each kind is bought once and one walks with you at a time. Bond
   is earned by the minute while any work or hunt is running and
   opens extra traits; Rank comes from duplicates that turn up on
   their own. Tables live in registry.js.

   Bond is kept on a whole-millisecond grid (Bond x bondMs is always
   a whole number), so a Bond level lands on the same millisecond
   however time is sliced.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData, getCompanion, isGather, isTrade } from "./registry.js";
import { bondLevelFrom } from "./stats.js";
import { roll, SALT } from "./rng.js";
import { emit } from "./events.js";
import { transact } from "./storage.js";

const C = CONFIG.companions;

export function companionOf(state, id) {
  const owned = state.companions && state.companions.owned;
  return owned && Object.hasOwn(owned, id) ? owned[id] : null;
}

export function activeCompanion(state) {
  const id = state.companions && state.companions.active;
  return id && companionOf(state, id) ? getCompanion(id) : null;
}

// Does a trait's skill list cover this skill? No list means it always applies.
function covers(skills, skillId) {
  if (!skills) return true;
  return skills.some((s) => s === "all" || s === skillId ||
    (s === "gather" && isGather(skillId)) || (s === "trade" && isTrade(skillId)));
}

const traitValue = (def, rank) => def.trait.base + def.trait.perRank * (rank - 1);
const unlockOpen = (u, level, rank) => (u.bond ? level >= u.bond : rank >= u.rank);

// Everything a companion gives, where it stands: the main trait at its Rank,
// plus each unlock it has reached.
export function companionInfo(state, id) {
  const def = getCompanion(id);
  if (!def) return null;
  const c = companionOf(state, id);
  const bond = c ? c.bond : 0;
  const rank = c ? c.rank : 1;
  const level = bondLevelFrom(bond);
  const maxed = level >= C.maxBond;
  return {
    def, owned: !!c, active: !!c && state.companions.active === id,
    rank, dupes: c ? c.dupes : 0, needDupes: rank < C.maxRank ? C.rankDupes[rank + 1] : 0,
    bond, level, maxed,
    bondInto: maxed ? 0 : bond - CONFIG.bondXpFor(level),
    bondSpan: maxed ? 0 : CONFIG.bondXpFor(level + 1) - CONFIG.bondXpFor(level),
    trait: traitValue(def, rank),
    unlocks: def.unlocks.map((u) => Object.assign({}, u, { open: !!c && unlockOpen(u, level, rank) })),
  };
}

/* What the companion at your side adds of one kind (xp, double, reagent,
   speed, gold, drops, rare) for one skill. Asked on every kill and action,
   so it adds up in place rather than building companionInfo. */
export function companionBonus(state, kind, skillId) {
  const def = activeCompanion(state);
  if (!def) return 0;
  const c = companionOf(state, def.id);
  const level = bondLevelFrom(c.bond);
  let total = 0;
  if (def.trait.kind === kind && covers(def.trait.skills, skillId)) total += traitValue(def, c.rank);
  for (const u of def.unlocks) {
    if (u.kind === kind && unlockOpen(u, level, c.rank) && covers(u.skills, skillId)) total += u.value;
  }
  return total;
}

/* ================= BOND ================= */

const bondCapMs = () => CONFIG.bondXpFor(C.maxBond) * C.bondMs;
const bondMsOf = (c) => Math.round(c.bond * C.bondMs);

// The active companion gains ranMs of shared time. One event per Bond level reached.
export function bondStep(state, ranMs, env, at) {
  const def = activeCompanion(state);
  if (!def || !(ranMs > 0)) return;
  const c = companionOf(state, def.id);
  const now = bondMsOf(c);
  if (now >= bondCapMs()) return;

  const before = bondLevelFrom(c.bond);
  c.bond = Math.min(bondCapMs(), now + Math.round(ranMs)) / C.bondMs;
  const after = bondLevelFrom(c.bond);
  for (let level = before + 1; level <= after; level++) {
    const unlocks = def.unlocks.filter((u) => u.bond === level).map((u) => u.text);
    emit(state, env, "companion:bond", { id: def.id, level, unlocks, at });
  }
}

// Running time until the active companion's next Bond level: Infinity if none or maxed.
export function nextBondIn(state) {
  const def = activeCompanion(state);
  if (!def) return Infinity;
  const c = companionOf(state, def.id);
  const level = bondLevelFrom(c.bond);
  if (level >= C.maxBond) return Infinity;
  return Math.max(1, CONFIG.bondXpFor(level + 1) * C.bondMs - bondMsOf(c));
}

/* ================= FINDS ================= */

// Does this companion turn up while doing this? source: a skill id or "warfare".
function turnsUpFrom(def, source) {
  if (def.source === "any") return true;
  if (def.source === "gather") return isGather(source);
  if (def.source === "hunt") return source === "warfare";
  return def.source === source;
}

/* Rolled once per finished action or kill, for every kind you own, on the
   counter that just happened (a:<action> or k:<tier>) at its index. */
export function companionFinds(state, source, rollKey, index, env, at) {
  GameData.COMPANIONS.forEach((def, i) => {
    const c = companionOf(state, def.id);
    if (!c || c.rank >= C.maxRank || !turnsUpFrom(def, source)) return;
    if (roll(state.rng.seed, rollKey, index, SALT.companion + i) >= def.findChance) return;

    c.dupes++;
    const need = C.rankDupes[c.rank + 1];
    const rankUp = c.dupes >= need;
    if (rankUp) {
      c.dupes -= need;
      c.rank++;
    }
    emit(state, env, "companion:found", { id: def.id, rank: c.rank, dupes: c.dupes, need, rankUp, at });
  });
}

/* ================= COMMANDS ================= */

export function buyCompanion(state, { id } = {}, env) {
  const def = typeof id === "string" ? getCompanion(id) : null;
  if (!def) return { ok: false, error: "No such companion." };
  if (companionOf(state, id)) return { ok: false, error: `${def.name} is already yours.` };
  if (state.player.gold < def.cost) return { ok: false, error: "Not enough gold." };

  const res = transact(state, (tx) => {
    tx.gold(-def.cost);
    tx.set(state.companions.owned, id, { bond: 0, rank: 1, dupes: 0 });
    if (!activeCompanion(state)) tx.set(state.companions, "active", id);
  });
  if (!res.ok) return res;
  emit(state, env, "companion:bought", { id });
  return { ok: true };
}

// id null leaves everyone at camp.
export function setCompanion(state, { id } = {}, env) {
  if (id === null) {
    state.companions.active = null;
    emit(state, env, "companion:active", { id: null });
    return { ok: true };
  }
  if (typeof id !== "string" || !companionOf(state, id)) return { ok: false, error: "That companion isn't yours." };
  state.companions.active = id;
  emit(state, env, "companion:active", { id });
  return { ok: true };
}
