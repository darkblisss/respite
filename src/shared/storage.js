/* ============================================================
   Respite · storage.js · The Quartermaster
   ------------------------------------------------------------
   The three pools and every change to what they hold.
     inv    Belongings  (10 slots)
     bank   the Stockpile (30, widened by chests up to 200)
     vault  the Vault   (50)
   A stack takes one slot. Where a new thing goes is decided in one
   place (placeFor, ORDER) so the hunt, the bench, the shop and the
   mail all agree.

   transact() runs a change as all or nothing: every write made
   through its `tx` is journaled and undone if anything refuses.
   ============================================================ */

import { CONFIG } from "./config.js";
import { itemDef, itemName } from "./items.js";

export const POOLS = Object.freeze(["inv", "bank", "vault"]);
export const isPool = (w) => w === "inv" || w === "bank" || w === "vault";

export const ORDER = Object.freeze({
  loot:     Object.freeze(["inv", "vault", "bank"]),   // hunt drops, finds, Sovereign pieces
  material: Object.freeze(["bank", "vault", "inv"]),   // gathered and crafted materials, requisitions, smuggler
  gear:     Object.freeze(["inv", "bank", "vault"]),   // crafted gear
  tool:     Object.freeze(["bank", "vault", "inv"]),   // crafted and unequipped tools
  remedy:   Object.freeze(["inv", "bank", "vault"]),   // remedies are used only by the hunter: Belongings first
  spend:    Object.freeze(["bank", "vault", "inv"]),   // paying costs
  eat:      Object.freeze(["inv", "bank", "vault"]),   // remedies taken on the hunt (best heal first, then this order)
  mail:     Object.freeze(["inv", "bank", "vault"]),
});

export const orderFor = (key) => {
  const d = itemDef(key);
  if (d && d.heal > 0) return ORDER.remedy;
  if (d && d.kind === "gear") return ORDER.gear;
  if (d && d.kind === "tool") return ORDER.tool;
  return ORDER.material;
};

export const poolName = (w) => CONFIG.storage.names[w] || String(w);

/* ================= READING ================= */

export function slotCap(state, w) {
  return w === "inv" ? CONFIG.storage.slots.inv : state[w].slots;
}

export function slotsUsed(state, w) {
  return Object.keys(state[w].items).length;
}

export function isFull(state, w) {
  return slotsUsed(state, w) >= slotCap(state, w);
}

// Own keys only: a key like "constructor" is never an item.
export function qtyIn(state, w, key) {
  const items = state[w].items;
  return Object.hasOwn(items, key) ? items[key] : 0;
}

export function haveQty(state, key) {
  return qtyIn(state, "inv", key) + qtyIn(state, "bank", key) + qtyIn(state, "vault", key);
}

export function heldEverywhere(state) {
  const out = {};
  POOLS.forEach((w) => {
    const items = state[w].items;
    Object.keys(items).forEach((k) => { out[k] = (out[k] || 0) + items[k]; });
  });
  return out;
}

// The pool's keys in the player's order, with anything the order missed at the end.
export function orderedKeys(state, w) {
  const s = state[w];
  const out = s.order.filter((k) => Object.hasOwn(s.items, k));
  const listed = new Set(out);
  Object.keys(s.items).forEach((k) => {
    if (!listed.has(k)) out.push(k);
  });
  return out;
}

// A stack already held grows where it is; otherwise the first pool in order with room.
export function placeFor(state, key, order = orderFor(key)) {
  for (const w of order) if (qtyIn(state, w, key) > 0) return w;
  for (const w of order) if (!isFull(state, w)) return w;
  return null;
}

export function canPay(state, cost) {
  return !cost || Object.keys(cost).every((k) => haveQty(state, k) >= cost[k]);
}

// How many times the stock on hand pays for a cost.
export function stockCovers(state, cost) {
  if (!cost) return Infinity;
  return Object.keys(cost).reduce((n, k) => Math.min(n, Math.floor(haveQty(state, k) / cost[k])), Infinity);
}

/* ================= TRANSACTIONS ================= */

class TxFail extends Error {
  constructor(message) {
    super(message);
    this.name = "TxFail";
  }
}

function checkQty(qty) {
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError(`Item quantities are positive whole numbers, not ${qty}.`);
}

/* The journal of the transaction running on a save, if any, so a nested
   transact joins it. Entries live only for the length of one synchronous
   call; this holds no game state between calls. */
const RUNNING = new WeakMap();

class Tx {
  constructor(state, journal) {
    this.state = state;
    this.journal = journal;
  }

  fail(msg) {
    throw new TxFail(msg);
  }

  set(obj, prop, value) {
    const had = Object.hasOwn(obj, prop);
    const old = obj[prop];
    this.journal.push(() => {
      if (had) obj[prop] = old;
      else delete obj[prop];
    });
    obj[prop] = value;
    return value;
  }

  del(obj, prop) {
    if (!Object.hasOwn(obj, prop)) return undefined;
    const old = obj[prop];
    this.journal.push(() => { obj[prop] = old; });
    delete obj[prop];
    return old;
  }

  push(arr, value) {
    const len = arr.length;
    this.journal.push(() => { arr.length = len; });
    arr.push(value);
    return value;
  }

  splice(arr, start, count, ...items) {
    const removed = arr.splice(start, count, ...items);
    this.journal.push(() => { arr.splice(start, items.length, ...removed); });
    return removed;
  }

  // Into one pool. A new stack needs a free slot.
  add(w, key, qty) {
    checkQty(qty);
    const pool = this.state[w];
    const have = qtyIn(this.state, w, key);
    if (!have && isFull(this.state, w)) this.fail(`${poolName(w)} is full.`);
    this.set(pool.items, key, have + qty);
    if (!pool.order.includes(key)) this.push(pool.order, key);
    return qty;
  }

  // Wherever it belongs. Returns the pool it went into.
  stash(key, qty, order = orderFor(key)) {
    checkQty(qty);
    const w = placeFor(this.state, key, order);
    if (!w) this.fail(`Nowhere to put ${itemName(key)}.`);
    this.add(w, key, qty);
    return w;
  }

  remove(w, key, qty) {
    checkQty(qty);
    const pool = this.state[w];
    const have = qtyIn(this.state, w, key);
    if (have < qty) this.fail(`Not enough ${itemName(key)}.`);
    if (have > qty) {
      this.set(pool.items, key, have - qty);
    } else {
      this.del(pool.items, key);
      this.set(pool, "order", pool.order.filter((k) => k !== key));
    }
    return qty;
  }

  // Across pools, in order, until qty is covered.
  spend(key, qty, order = ORDER.spend) {
    checkQty(qty);
    const held = order.reduce((n, w) => n + qtyIn(this.state, w, key), 0);
    if (held < qty) this.fail(`Not enough ${itemName(key)}.`);
    let left = qty;
    for (const w of order) {
      const take = Math.min(left, qtyIn(this.state, w, key));
      if (take > 0) {
        this.remove(w, key, take);
        left -= take;
      }
      if (left <= 0) break;
    }
    return qty;
  }

  pay(cost) {
    if (!cost) return cost;
    Object.keys(cost).forEach((k) => this.spend(k, cost[k]));
    return cost;
  }

  // Gold never goes below nothing. Earned gold also counts toward stats.goldEarned.
  gold(delta, earned = false) {
    if (!Number.isInteger(delta)) throw new RangeError(`Gold changes are whole numbers, not ${delta}.`);
    const player = this.state.player;
    const next = player.gold + delta;
    if (next < 0) this.fail("Not enough gold.");
    this.set(player, "gold", next);
    if (earned && delta > 0) this.set(this.state.stats, "goldEarned", this.state.stats.goldEarned + delta);
    return next;
  }
}

function rollBack(journal, mark) {
  while (journal.length > mark) journal.pop()();
}

/* Runs fn(tx). A tx.fail(msg) or a return of false undoes everything fn did
   through tx and gives { ok: false, error }. Anything else thrown is undone
   too, then rethrown. Otherwise { ok: true, value }. A transact inside
   another on the same save shares its journal: if the inner one refuses,
   only the inner changes are undone; if the outer one refuses later, the
   inner changes go with it. */
export function transact(state, fn) {
  const outer = RUNNING.get(state);
  const journal = outer || [];
  const mark = journal.length;
  if (!outer) RUNNING.set(state, journal);
  try {
    const value = fn(new Tx(state, journal));
    if (value === false) {
      rollBack(journal, mark);
      return { ok: false, error: "That can't be done." };
    }
    return { ok: true, value };
  } catch (e) {
    rollBack(journal, mark);
    if (e instanceof TxFail) return { ok: false, error: e.message };
    throw e;
  } finally {
    if (!outer) RUNNING.delete(state);
  }
}
