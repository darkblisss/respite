/* ============================================================
   Respite · storage.js · The Quartermaster
   ------------------------------------------------------------
   The four pools and every change to what they hold.
     inv      Belongings  (10 slots)
     bank     the Stockpile (30, widened by chests up to 200)
     vault    the Vault   (50)
     satchel  the Satchel (5), the combat loadout
   A stack takes one slot. Where a new thing goes is decided in one
   place (placeFor, ORDER) so the hunt, the bench, the shop and the
   mail all agree.

   Two rules are the Satchel's own. It takes remedies and nothing
   else, because it is what a hunt can reach and gear swaps stay a
   camp job. And nothing stacks in it: five slots, one bottle each,
   so five is every drop of healing a hunt gets and what you pack is
   the whole plan. Belongings stack them freely -- hoard all you
   like at camp, you still walk out with five.

   transact() runs a change as all or nothing: every write made
   through its `tx` is journaled and undone if anything refuses.
   ============================================================ */

import { CONFIG } from "./config.js";
import { itemDef, itemName, isRemedy } from "./items.js";

export const POOLS = Object.freeze(["inv", "bank", "vault", "satchel"]);
export const isPool = (w) => w === "inv" || w === "bank" || w === "vault" || w === "satchel";

export const ORDER = Object.freeze({
  loot:     Object.freeze(["inv", "vault", "bank"]),   // hunt drops, finds, Sovereign pieces
  material: Object.freeze(["bank", "vault", "inv"]),   // gathered and crafted materials, requisitions, smuggler
  gear:     Object.freeze(["inv", "bank", "vault"]),   // crafted gear
  tool:     Object.freeze(["bank", "vault", "inv"]),   // crafted and unequipped tools
  remedy:   Object.freeze(["inv"]),                    // a remedy bought lands in Belongings; the hunter packs the Satchel
  spend:    Object.freeze(["bank", "vault", "inv"]),   // paying costs
  eat:      Object.freeze(["satchel"]),                // remedies taken on the hunt: the Satchel alone, best heal first
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

/* ================= WHAT A POOL TAKES ================= */

/* The Satchel is the loadout for a fight, so it holds only what can be drunk
   in one: remedies. Gear swaps stay a camp job, and the Worn grid is where
   they live. */
export const canHold = (w, key) => w !== "satchel" || isRemedy(key);

/* The Satchel gives a remedy a slot a bottle and never stacks one, so its five
   slots are five bottles and no more. Belongings stack them normally: the limit
   is what you can carry into a fight, not what you can own. */
export const unstacked = (w, key) => w === "satchel" && isRemedy(key);

/* ================= READING ================= */

export function slotCap(state, w) {
  // Belongings and the Satchel are fixed; the Stockpile and the Vault widen.
  return w === "bank" || w === "vault" ? state[w].slots : CONFIG.storage.slots[w];
}

export function slotsUsed(state, w) {
  const items = state[w].items;
  let n = 0;
  for (const k of Object.keys(items)) n += unstacked(w, k) ? items[k] : 1;
  return n;
}

export function isFull(state, w) {
  return slotsUsed(state, w) >= slotCap(state, w);
}

// The slots adding qty of key would cost: none into a stack that grows, one for
// a new stack, one a unit where the pool does not stack it.
export function slotsNeeded(state, w, key, qty = 1) {
  if (unstacked(w, key)) return qty;
  return qtyIn(state, w, key) > 0 ? 0 : 1;
}

export function roomFor(state, w, key, qty = 1) {
  if (!canHold(w, key)) return false;
  return slotsUsed(state, w) + slotsNeeded(state, w, key, qty) <= slotCap(state, w);
}

/* Own keys only: a key like "constructor" is never an item. A pool the save has
   not got holds nothing, so reading one is safe on a save that came in before
   the Satchel and has not been through migrateSave yet. */
export function qtyIn(state, w, key) {
  const pool = state[w];
  const items = pool ? pool.items : null;
  return items && Object.hasOwn(items, key) ? items[key] : 0;
}

// Everything the camp holds, the Satchel included: what is packed is still owned.
export function haveQty(state, key) {
  let n = 0;
  for (const w of POOLS) n += qtyIn(state, w, key);
  return n;
}

export function heldEverywhere(state) {
  const out = {};
  POOLS.forEach((w) => {
    const items = state[w] ? state[w].items : null;
    if (!items) return;
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

/* A stack already held grows where it is; otherwise the first pool in order
   with room. `qty` matters only where a pool does not stack the thing, and
   there even a held stack needs the slots. */
export function placeFor(state, key, order = orderFor(key), qty = 1) {
  for (const w of order) if (qtyIn(state, w, key) > 0 && roomFor(state, w, key, qty)) return w;
  for (const w of order) if (qtyIn(state, w, key) === 0 && roomFor(state, w, key, qty)) return w;
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

// What normalise() will keep in the roll map: anything odder is not written in the first place.
const FOUND_KEY = /^[a-z0-9_]{1,40}$/;

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

  /* Into one pool. A new stack needs a free slot, and so does every bottle
     of a remedy going into Belongings, where they do not stack.

     This is the only door anything comes in through, from a drop, a bench, a
     purchase or a letter, so it is also where the Collection's record is kept:
     `i:<base>` counts what has passed through, and a base with anything against
     it is one this camp has held. It counts moves between pools too, which is
     why nothing reads the number -- only whether it is there at all. */
  add(w, key, qty) {
    checkQty(qty);
    if (!canHold(w, key)) this.fail(`${poolName(w)} only takes remedies.`);
    const pool = this.state[w];
    const have = qtyIn(this.state, w, key);
    if (!roomFor(this.state, w, key, qty)) this.fail(`${poolName(w)} is full.`);
    this.set(pool.items, key, have + qty);
    if (!pool.order.includes(key)) this.push(pool.order, key);
    this.found(key, qty);
    return qty;
  }

  // Marks a base as held, once, journalled so a rolled-back transaction un-marks it.
  found(key, qty) {
    const base = String(key).split("|")[0];
    if (!FOUND_KEY.test(base)) return;
    const rolls = this.state.rolls;
    if (!rolls || typeof rolls !== "object") return;
    const at = `i:${base}`;
    this.set(rolls, at, (rolls[at] || 0) + qty);
  }

  // Wherever it belongs. Returns the pool it went into.
  stash(key, qty, order = orderFor(key)) {
    checkQty(qty);
    const w = placeFor(this.state, key, order, qty);
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
