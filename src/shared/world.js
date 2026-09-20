/* ============================================================
   Respite · world.js · The Camp
   ------------------------------------------------------------
   Everything outside the work and the hunt: the bounty board,
   requisition agents, the Bonesetter and the Smuggler, travel,
   equipment and item actions, and choosing a discipline.

   Commands return { ok: true, data? } or { ok: false, error } and
   change nothing when they refuse. Their arguments arrive straight
   from the network, so every one is checked for type and range.
   ============================================================ */

import { CONFIG } from "./config.js";
import {
  GameData, getRegion, getMaterial, getClass, monsterOfTier, matId, agentRarityDef,
} from "./registry.js";
import { itemDef, itemName, parseKey, validKey, agentRarityFromRoll, remedyTooWeak, tierForLevel } from "./items.js";
import {
  ORDER, canHold, isPool, poolName, qtyIn, haveQty, placeFor, orderedKeys, transact,
} from "./storage.js";
import { skillLevel, maxHp, canPickClass, statsOf } from "./stats.js";
import { dayIndex, windowIndex } from "./weather.js";
import { makeRng, randIntWith, seedFrom } from "./rng.js";
import { emit } from "./events.js";
import { fmtGold, titleCase } from "./format.js";

const refuse = (error) => ({ ok: false, error });
const OK = () => ({ ok: true });

export function currentRegion(state) {
  return getRegion(state.region);
}

/* ================= BOUNTY ================= */
/* One posting a world window (twelve hours) for the region you are in. */

export function makeBounty(state, windowIdx) {
  const w = windowIdx;
  const region = currentRegion(state);
  const t = GameData.TIERS[region.tier - 1];
  const r = seedFrom(w * 3.31 + region.tier);

  if (r < 0.45) {
    const mob = monsterOfTier(region.tier);
    const amount = 10 + Math.floor(seedFrom(w * 5.5) * 15);
    return {
      window: w, region: region.id, kind: "slay", targetTier: region.tier,
      label: `Put down ${amount} of whatever holds ${region.name}`,
      amount, progress: 0, claimed: false, gold: Math.round(mob.gold[1] * amount * 0.8),
    };
  }

  const skills = GameData.GATHER_SKILLS;
  const skill = skills[Math.floor(seedFrom(w * 9.13 + region.tier) * skills.length)];
  const amount = 20 + Math.floor(seedFrom(w * 2.7) * 30);
  const target = matId(t, skill.mat);
  return {
    window: w, region: region.id, kind: "gather", targetId: target,
    label: `Bring in ${amount} ${titleCase(t[skill.mat])}`,
    amount, progress: 0, claimed: false, gold: Math.round(getMaterial(target).value * amount * 1.5),
  };
}

// Re-posts when the window or the region changed. A posting you walk away from
// waits on the board until the window turns, so coming back finds it as you left
// it (its progress, and whether it was paid). Each region pays once per posting.
export function refreshBounty(state) {
  const w = windowIndex(state.clock);
  const b = state.bounty;
  if (b && b.window === w && b.region === state.region) return;
  if (!state.bountyBoard || typeof state.bountyBoard !== "object") state.bountyBoard = {};
  const board = state.bountyBoard;
  if (b && b.window === w) board[b.region] = b;
  Object.keys(board).forEach((id) => { if (!board[id] || board[id].window !== w) delete board[id]; });
  const kept = board[state.region];
  if (kept) {
    delete board[state.region];
    state.bounty = kept;
  } else {
    state.bounty = makeBounty(state, w);
  }
}

// kind "slay" takes a monster, "gather" an action def. Announces completion once.
export function bountyProgress(state, kind, thing, env, at) {
  const b = state.bounty;
  if (!b || b.claimed || b.kind !== kind) return;
  const before = b.progress;
  if (kind === "slay" && thing.tier === b.targetTier) b.progress++;
  if (kind === "gather" && thing.out && Object.hasOwn(thing.out, b.targetId)) b.progress += thing.out[b.targetId];
  if (before < b.amount && b.progress >= b.amount) emit(state, env, "bounty:complete", { at });
}

// A paid bounty's reward besides the gold: double experience for an hour.
export const BOUNTY_BUFF = Object.freeze({ ms: 60 * 60 * 1000, mult: 2 });

// advance() keeps the board current, so the posting here is this window's.
export function claimBounty(state, _args, env) {
  const b = state.bounty;
  if (!b) return refuse("There's no bounty posted.");
  if (b.claimed) return refuse("That bounty is already paid.");
  if (b.progress < b.amount) return refuse("The bounty isn't finished.");

  transact(state, (tx) => {
    tx.set(b, "claimed", true);
    tx.gold(b.gold, true);
    tx.set(state, "buff", { until: state.clock + BOUNTY_BUFF.ms, mult: BOUNTY_BUFF.mult });
  });
  emit(state, env, "bounty:paid", { gold: b.gold });
  return OK();
}

/* ================= REQUISITIONS ================= */
/* A roster of agents sent out for a chosen resource. Three deployments a
   day, back at the daily reset. They open once a tier 2 region is yours. */

const A = CONFIG.agents;
const CLOSED = "Requisitions open once you reach tier 2 ground.";

export function requisitionsOpen(state) {
  return state.travel.unlocked.some((id) => {
    const r = GameData.REGIONS.find((x) => x.id === id);
    return !!r && r.tier >= 2;
  });
}

export function requisitionsLeft(state) {
  return Math.max(0, A.requisitionsPerDay - state.requisitions.filter((r) => !r.resolved).length);
}

// Anything you've actually seen is fair game to ask an agent for.
export function requisitionTargets(state) {
  const out = GameData.REAGENTS.map((r) => r.id);
  GameData.TIERS.forEach((t) => {
    GameData.GATHER_SKILLS.forEach((s) => {
      if (t.level <= skillLevel(state, s.id)) out.push(matId(t, s.mat));
    });
  });
  return out;
}

export function hireAgent(state, _args, env) {
  if (!requisitionsOpen(state)) return refuse(CLOSED);
  if (state.player.gold < A.hireCost) return refuse(`Hiring costs ${fmtGold(A.hireCost)}.`);
  if (state.agents.length >= A.rosterMax) return refuse("The roster is full.");

  // The world stream: rarity first, then the name, as v4 drew them.
  const box = { s: state.rng.world };
  const rng = makeRng(box, "s");
  const rarity = agentRarityFromRoll(rng());
  const used = state.agents.map((a) => a.name);
  const names = GameData.AGENT_NAMES;
  const pool = names.filter((n) => !used.includes(n));
  const name = pool.length ? pool[randIntWith(rng, 0, pool.length - 1)] : names[randIntWith(rng, 0, names.length - 1)];
  const id = `agent_${state.serial}`;

  transact(state, (tx) => {
    tx.gold(-A.hireCost);
    tx.push(state.agents, { id, name, rarity });
    tx.set(state, "serial", state.serial + 1);
    tx.set(state.rng, "world", box.s);
  });
  emit(state, env, "agent:hired", { id, name, rarity });
  return { ok: true, data: { id, name, rarity } };
}

// How much an agent brings back: a dozen, scaled by the agent's rarity.
export function requisitionQty(agent) {
  return Math.max(1, Math.round(12 * agentRarityDef(agent.rarity).mult));
}

// A requisition is a promise for tomorrow, not an instant reward.
export function deployAgent(state, { agentId, itemKey } = {}, env) {
  if (!requisitionsOpen(state)) return refuse(CLOSED);
  const agent = typeof agentId === "string" ? state.agents.find((a) => a.id === agentId) : null;
  if (!agent) return refuse("No such agent.");
  if (typeof itemKey !== "string" || !requisitionTargets(state).includes(itemKey)) return refuse("Agents can't bring that in.");
  const pending = state.requisitions.filter((r) => !r.resolved);
  if (pending.length >= A.requisitionsPerDay) return refuse(`Only ${A.requisitionsPerDay} deployments a day.`);
  if (pending.some((r) => r.agentId === agentId)) return refuse(`${agent.name} is already out.`);

  const qty = requisitionQty(agent);
  state.requisitions.push({ agentId, agentName: agent.name, itemKey, qty, day: dayIndex(state.clock), resolved: false });
  emit(state, env, "agent:deployed", { agentId, name: agent.name, itemKey, qty });
  return OK();
}

// When the world day turns, whatever was asked for comes back to camp.
export function resolveRequisitions(state, env, at) {
  const today = dayIndex(state.clock);
  if (state.reqDay === today) return;
  const pending = state.requisitions.filter((r) => !r.resolved);
  if (pending.length) {
    const lines = pending.map((r) => {
      r.resolved = true;
      const placed = transact(state, (tx) => tx.stash(r.itemKey, r.qty, ORDER.material)).ok;
      return { key: r.itemKey, qty: r.qty, placed };
    });
    emit(state, env, "requisitions:returned", { lines, at: at == null ? state.clock : at });
  }
  state.requisitions = [];
  state.reqDay = today;
}

/* ================= SHOP ================= */

// The Bonesetter: every remedy, always open.
export function shopStock(_state) {
  return GameData.REMEDIES.map((r) => ({ key: r.id, price: r.price }));
}

// Materials with a tier, never a remedy or a chest. Fixed, so built once.
const SMUGGLER_POOL = Object.keys(GameData.MATERIALS).filter((k) => {
  const m = GameData.MATERIALS[k];
  return m.tier && !m.heal && k !== "vault_chest";
});

const smugglerTag = (w, slot) => `${w}_${slot}`;

// Three lots a window, the same for everyone.
export function smugglerStock(state) {
  const w = windowIndex(state.clock);
  const pool = SMUGGLER_POOL;
  const bought = state.smugglerBought || {};
  const picks = [];
  for (let i = 0; i < 3; i++) {
    const key = pool[Math.floor(seedFrom(w * (i + 2) * 1.77) * pool.length)];
    const qty = 5 + Math.floor(seedFrom(w * (i + 3) * 4.2) * 20);
    const tag = smugglerTag(w, i);
    picks.push({ key, qty, price: Math.round(getMaterial(key).value * qty * 2.4), slot: i, bought: Object.hasOwn(bought, tag) && !!bought[tag] });
  }
  return picks;
}

export function buyRemedy(state, { key, qty } = {}, env) {
  const entry = shopStock(state).find((e) => e.key === key);
  if (!entry) return refuse("The Bonesetter doesn't sell that.");
  if (!Number.isInteger(qty) || qty < 1 || qty > 1000) return refuse("Buy 1 to 1,000 at a time.");
  const price = entry.price * qty;
  if (state.player.gold < price) return refuse("Not enough gold.");

  /* Bought remedies go into Belongings, where they cost a slot a bottle. The
     hunter packs what they want to drink into the Satchel afterwards, so the
     loadout is always a choice and never the shop's. */
  const res = transact(state, (tx) => {
    tx.gold(-price);
    if (!placeFor(state, key, ORDER.remedy, qty)) tx.fail("Nowhere to put it.");
    tx.stash(key, qty, ORDER.remedy);
  });
  if (!res.ok) return res;
  emit(state, env, "shop:bought", { key, qty, price });
  return OK();
}

export function buySmuggler(state, { slot, key = null } = {}, env) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) return refuse("No such offer.");
  const entry = smugglerStock(state)[slot];
  // The lot the player saw: if the window turned before this landed, it is gone.
  if (key != null && key !== entry.key) return refuse("The Smuggler has moved on.");
  if (entry.bought) return refuse("That lot is already dealt.");
  if (state.player.gold < entry.price) return refuse("The smuggler doesn't haggle.");

  const w = windowIndex(state.clock);
  const res = transact(state, (tx) => {
    tx.gold(-entry.price);
    if (!placeFor(state, entry.key, ORDER.material)) tx.fail("Nowhere to put it.");
    tx.stash(entry.key, entry.qty, ORDER.material);
    // Old windows can never be bought again, so their tags are let go.
    Object.keys(state.smugglerBought).forEach((tag) => {
      if (!tag.startsWith(`${w}_`)) tx.del(state.smugglerBought, tag);
    });
    tx.set(state.smugglerBought, smugglerTag(w, slot), true);
  });
  if (!res.ok) return res;
  emit(state, env, "smuggler:bought", { key: entry.key, qty: entry.qty, price: entry.price });
  return OK();
}

/* ================= TRAVEL ================= */

export function travel(state, { regionId } = {}, env) {
  const region = typeof regionId === "string" ? GameData.REGIONS.find((r) => r.id === regionId) : null;
  if (!region) return refuse("No such region.");
  const unlocking = !state.travel.unlocked.includes(region.id);
  if (unlocking && state.player.gold < region.toll) return refuse(`Need ${fmtGold(region.toll)}.`);

  if (unlocking) {
    transact(state, (tx) => {
      tx.gold(-region.toll);
      tx.push(state.travel.unlocked, region.id);
    });
    emit(state, env, "travel:unlocked", { regionId: region.id, toll: region.toll });
  }
  if (state.region !== region.id) {
    state.region = region.id;
    emit(state, env, "travel:moved", { regionId: region.id });
  }
  refreshBounty(state);
  return OK();
}

/* ================= ITEMS & EQUIPMENT ================= */
/* `from` is the pool an item sits in: "inv", "bank", "vault" or "satchel". */

// A preferred pool first, then Belongings, the Stockpile, the Vault.
const stowOrder = (preferred) => [preferred, "inv", "bank", "vault"].filter((w, i, all) => all.indexOf(w) === i);

/* Where a piece may actually be stowed. Gear and remedies never fall back into the
   Stockpile, so unequipping cannot put there what moveItem would refuse. */
const stowOrderFor = (key, preferred) => stowOrder(preferred).filter((w) => w !== "bank" || !stockpileRefuses(key));

// Checks the key and pool an item action names, and that something is there.
function held(state, key, from) {
  if (!validKey(key)) return "No such item.";
  if (!isPool(from)) return "No such store.";
  if (qtyIn(state, from, key) <= 0) return "You don't have that there.";
  return null;
}

// null takes the whole stack; otherwise a whole number, at most what is there.
function amountOf(qty, have) {
  if (qty == null) return have;
  if (!Number.isInteger(qty) || qty < 1) return 0;
  return Math.min(have, qty);
}

// What equipping this would push out of its slot (or tool rack).
export function displacedBy(state, key) {
  const d = itemDef(key);
  if (!d) return [];
  if (d.kind === "tool") return state.tools[d.forSkill] ? [state.tools[d.forSkill]] : [];
  if (d.kind !== "gear") return [];
  const out = [state.equipment[d.slot]];
  if (d.slot === "weapon" && d.twoHanded) out.push(state.equipment.offhand);
  return out.filter(Boolean);
}

export function equip(state, { key, from } = {}, env) {
  const bad = held(state, key, from);
  if (bad) return refuse(bad);
  const d = itemDef(key);

  // Tools go in the tool rack, one per gathering skill.
  if (d.kind === "tool") {
    const old = Object.hasOwn(state.tools, d.forSkill) ? state.tools[d.forSkill] : null;
    const res = transact(state, (tx) => {
      tx.remove(from, key, 1);
      if (old) {
        if (!placeFor(state, old, stowOrderFor(old, from))) tx.fail("Nowhere to stow the old tool.");
        tx.stash(old, 1, stowOrderFor(old, from));
      }
      tx.set(state.tools, d.forSkill, d.base);
    });
    if (!res.ok) return res;
    emit(state, env, "tool:equipped", { key });
    return OK();
  }

  if (d.kind !== "gear" || !d.slot) return refuse("That can't be worn.");
  if (d.slot === "offhand") {
    const w = state.equipment.weapon;
    const wd = w ? itemDef(w) : null;
    if (wd && wd.twoHanded) return refuse(`Hands are on the ${itemName(w)}.`);
  }

  // Whatever this replaces goes back where the new piece came from.
  const displaced = [state.equipment[d.slot]];
  if (d.slot === "weapon" && d.twoHanded) displaced.push(state.equipment.offhand);

  const res = transact(state, (tx) => {
    tx.remove(from, key, 1);
    displaced.filter(Boolean).forEach((old) => {
      if (!placeFor(state, old, stowOrderFor(old, from))) tx.fail("No room to stow what you're wearing.");
      tx.stash(old, 1, stowOrderFor(old, from));
    });
    if (d.slot === "weapon" && d.twoHanded) tx.set(state.equipment, "offhand", null);
    tx.set(state.equipment, d.slot, key);
  });
  return res.ok ? OK() : res;
}

// Worn gear comes off into Belongings first.
export function unequip(state, { slot } = {}, env) {
  if (!GameData.EQUIP_SLOTS.includes(slot)) return refuse("No such slot.");
  const key = state.equipment[slot];
  if (!key) return refuse("Nothing is worn there.");
  const res = transact(state, (tx) => {
    if (!placeFor(state, key, stowOrderFor(key, "inv"))) tx.fail("Nowhere to put it.");
    tx.stash(key, 1, stowOrderFor(key, "inv"));
    tx.set(state.equipment, slot, null);
  });
  return res.ok ? OK() : res;
}

// Tools go back to the Stockpile first, where the crews keep them.
export function unequipTool(state, { skillId } = {}, env) {
  const id = typeof skillId === "string" && Object.hasOwn(state.tools, skillId) ? state.tools[skillId] : null;
  if (!id) return refuse("No tool in hand for that.");
  const res = transact(state, (tx) => {
    if (!placeFor(state, id, stowOrder("bank"))) tx.fail("Nowhere to put it.");
    tx.stash(id, 1, stowOrder("bank"));
    tx.del(state.tools, skillId);
  });
  return res.ok ? OK() : res;
}

/* What the Stockpile will not take. It is the crews' store -- ore, planks, weave --
   and a hunter's own kit has no business in it: gear and remedies go to the Vault
   or stay in Belongings, and nowhere else. */
export function stockpileRefuses(key) {
  const d = itemDef(key);
  if (!d) return false;
  return d.kind === "gear" || d.heal > 0;
}

export function moveItem(state, { key, from, to, qty } = {}, env) {
  const bad = held(state, key, from);
  if (bad) return refuse(bad);
  if (!isPool(to)) return refuse("No such store.");
  if (from === to) return refuse("It's already there.");
  // The Satchel is what a fight can reach, so only what a fight can use goes in.
  if (!canHold(to, key)) return refuse(`${poolName(to)} only takes remedies.`);
  if (to === "bank" && stockpileRefuses(key)) {
    return refuse(`The Stockpile won't hold that. It goes to the ${poolName("vault")}.`);
  }
  const n = amountOf(qty, qtyIn(state, from, key));
  if (!n) return refuse("Pick an amount to move.");

  const res = transact(state, (tx) => {
    tx.remove(from, key, n);
    tx.add(to, key, n);
  });
  if (!res.ok) return refuse(`${poolName(to)} is full.`);
  emit(state, env, "item:moved", { key, from, to, qty: n });
  return OK();
}

export function sellItem(state, { key, from, qty } = {}, env) {
  const bad = held(state, key, from);
  if (bad) return refuse(bad);
  const n = amountOf(qty, qtyIn(state, from, key));
  if (!n) return refuse("Pick an amount to sell.");
  const gold = itemDef(key).value * n;

  transact(state, (tx) => {
    tx.remove(from, key, n);
    tx.gold(gold, true);
  });
  emit(state, env, "item:sold", { key, qty: n, gold });
  return { ok: true, data: { gold } };
}

export function useChest(state, { key, from } = {}, env) {
  const bad = held(state, key, from);
  if (bad) return refuse(bad);
  if (parseKey(key).base !== "vault_chest") return refuse("That isn't a chest.");
  const max = CONFIG.storage.bankMax;
  if (state.bank.slots >= max) return refuse("The Stockpile can't be widened any further.");

  const slots = Math.min(max, state.bank.slots + getMaterial("vault_chest").chest);
  transact(state, (tx) => {
    tx.remove(from, key, 1);
    tx.set(state.bank, "slots", slots);
  });
  emit(state, env, "chest:opened", { slots });
  return OK();
}

// What breaking a piece of gear down gives back: 40% of its main material.
export function salvageValue(key) {
  const d = itemDef(key);
  if (!d || (d.kind !== "gear" && d.kind !== "tool")) return null;
  const profs = GameData.PROFESSIONS;
  const matchProf = profs.find((p) => p.id === d.prof) || profs.find((p) => d.name.includes(p.name));
  if (!matchProf) return null;
  const list = Object.hasOwn(GameData.CRAFT_ACTIONS, d.prof) ? GameData.CRAFT_ACTIONS[d.prof] : null;
  const ref = list && list.find((a) => a.craftGear === d.base || (a.out && Object.hasOwn(a.out, d.base)));
  if (!ref || !ref.cost) return null;
  const mainKey = Object.keys(ref.cost)[0];
  return { mat: mainKey, qty: Math.max(1, Math.floor(ref.cost[mainKey] * 0.4)) };
}

export function salvage(state, { key, from } = {}, env) {
  const bad = held(state, key, from);
  if (bad) return refuse(bad);
  const out = salvageValue(key);
  if (!out) return refuse("That can't be broken down.");

  const res = transact(state, (tx) => {
    tx.remove(from, key, 1);
    if (!placeFor(state, out.mat, ORDER.material)) tx.fail("No room for what it breaks down into.");
    tx.stash(out.mat, out.qty, ORDER.material);
  });
  if (!res.ok) return res;
  emit(state, env, "item:salvaged", { key, mat: out.mat, qty: out.qty });
  return OK();
}

// Debug/testing only: stashes any valid item key at will, bypassing normal
// acquisition. Never wire this to the UI or ship it reachable by a live client.
export function debugGive(state, { key, qty = 1 } = {}, env) {
  const d = itemDef(key);
  if (!d) return refuse("No such item.");
  const n = Number.isInteger(qty) && qty > 0 ? qty : 1;

  const res = transact(state, (tx) => {
    tx.stash(key, n);
  });
  if (!res.ok) return res;
  emit(state, env, "item:debugGiven", { key, qty: n });
  return OK();
}

// Moves key before `before` in the pool's order, or to the end when before is null.
export function reorder(state, { pool, key, before } = {}, _env) {
  if (!isPool(pool)) return refuse("No such store.");
  const items = state[pool].items;
  if (typeof key !== "string" || !Object.hasOwn(items, key)) return refuse("That isn't there.");
  if (before != null && (typeof before !== "string" || !Object.hasOwn(items, before))) return refuse("That isn't there.");
  if (before === key) return OK();

  const ids = orderedKeys(state, pool).filter((k) => k !== key);
  if (before == null) ids.push(key);
  else ids.splice(ids.indexOf(before), 0, key);
  state[pool].order = ids;
  return OK();
}

/* ================= REMEDIES BY HAND ================= */

/* The Satchel is what a hunt can reach on its own. This is the other way: standing
   at camp, out of a fight, you drink one yourself, and it may come from anywhere
   you keep them. Nothing heals for free any more, so this is how a hunter who came
   home on one point of health gets back on their feet. */
export function useRemedy(state, { key, from = "inv" } = {}, env) {
  const bad = held(state, key, from);
  if (bad) return refuse(bad);
  const d = itemDef(key);
  if (!d || !(d.heal > 0)) return refuse("That isn't a remedy.");
  if (state.tasks.combat) return refuse("Not in the middle of a fight.");

  const level = skillLevel(state, "warfare");
  if (remedyTooWeak(key, level)) {
    return refuse(`${itemName(key)} is too weak to do anything for you now. You need tier ${tierForLevel(level)} or better.`);
  }

  const s = statsOf(state);
  if (state.player.hp >= s.maxHp) return refuse("You're already whole.");

  const healed = Math.min(s.maxHp, state.player.hp + d.heal * (s.vital ? 1.2 : 1));
  const gain = Math.round(healed - state.player.hp);
  transact(state, (tx) => {
    tx.remove(from, key, 1);
    tx.set(state.player, "hp", healed);
  });
  // Drinking at camp is the same as resting there: the note has to agree, or the
  // next hunt sets out on the health you had before the bottle.
  if (state.player.camp) {
    state.player.camp.since = state.clock;
    state.player.camp.hp = healed;
  }
  emit(state, env, "remedy:used", { key, healed: gain });
  return { ok: true, data: { healed: gain } };
}

/* ================= DISCIPLINE ================= */

export function pickClass(state, { id } = {}, env) {
  const def = typeof id === "string" ? getClass(id) : null;
  if (!def) return refuse("No such discipline.");
  if (state.player.klass) return refuse("Your discipline is already chosen.");
  if (!canPickClass(state)) return refuse(`The Veil opens at Hunt ${CONFIG.progression.classPickLevel}.`);
  state.player.klass = def.id;
  state.player.hp = maxHp(state);
  // Chosen at camp, the refill holds for the next hunt too.
  if (state.player.camp) state.player.camp.hp = state.player.hp;
  emit(state, env, "class:picked", { id: def.id });
  return OK();
}
