/* ============================================================
   Respite · market.js · The Exchange
   ------------------------------------------------------------
   The player market lives on the server: it owns the listings,
   the row locks and the post. These are the halves that touch a
   save, kept with the rules so the server and the tests agree on
   what listing, buying, taking back and claiming the post do.
   Each one is all or nothing.

   The fee and the material pool's fill order are here too, and
   for the same reason: the browser has to show a buyer what they
   will pay and a seller what they will clear before either of
   them commits, and there must be one answer, not two.
   ============================================================ */

import { CONFIG } from "./config.js";
import { itemDef, itemName, parseKey, stacks, validKey, makeKey } from "./items.js";
import { ORDER, isPool, orderFor, placeFor, qtyIn, transact } from "./storage.js";
import { emit } from "./events.js";

const E = CONFIG.economy;
const refuse = (error) => ({ ok: false, error });
const TRADEABLE = ["material", "gear", "tool"];

/* The house takes its cut off both legs: the buyer pays the ask plus this, the seller
   receives the ask less this. Rounded up, and never under 1 gold of a sale worth gold
   at all, because a fee rounded down is the house paying the difference, and a round
   trip that costs nothing is what wash trading is made of. Up is also the only
   direction that cannot be split into: ten sales of 1 gold pay 10, one of 10 pays 1
   either way, and floor would have made the ten free. */
export function marketFee(total) {
  if (!(total > 0)) return 0;
  return Math.max(1, Math.ceil(total * E.marketFee));
}

/* One purchase's fee, shared out over the listings it filled so the rows add up to
   exactly what was charged: each leg takes its proportion floored, then the gold left
   over goes to the largest remainders, ties to the cheaper (earlier) leg. Nothing is
   minted and nothing is lost. */
export function splitFee(fee, weights) {
  const w = (Array.isArray(weights) ? weights : []).map((n) => (Number.isFinite(n) && n > 0 ? n : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (!(fee > 0) || sum <= 0) return w.map(() => 0);
  const parts = w.map((n) => (fee * n) / sum);
  const out = parts.map((p) => Math.floor(p));
  let left = fee - out.reduce((a, b) => a + b, 0);
  const order = parts
    .map((p, i) => ({ i, rest: p - Math.floor(p) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out;
}

/* A material pool's fill: cheapest first, and among equal prices the oldest listing
   first (classic price time priority), walking across as many sellers as it takes. A
   partial fill is normal; nothing above the buyer's ceiling is ever touched, so a
   drained band refuses rather than quietly charging more than they were shown.

   Rows are { id, priceEach, qtyLeft, at }: the server hands them over locked and in
   this order, and the sort is repeated here because this is the rule, and because a
   browser previews the same walk over the price bands it was shown. */
export function fillPool(rows, { qty, maxEach, gold = Infinity } = {}) {
  if (!Number.isInteger(qty) || qty < 1) return refuse("Choose how many to buy.");
  if (!Number.isInteger(maxEach) || maxEach < 1) return refuse("Name the most you will pay each.");
  const open = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && Number.isInteger(r.qtyLeft) && r.qtyLeft > 0
      && Number.isInteger(r.priceEach) && r.priceEach >= 1 && r.priceEach <= maxEach)
    .sort((a, b) => a.priceEach - b.priceEach || (a.at || 0) - (b.at || 0) || a.id - b.id);

  const fills = [];
  let units = 0;
  let goods = 0;
  for (const r of open) {
    if (units >= qty) break;
    const take = Math.min(r.qtyLeft, qty - units);
    fills.push({ id: r.id, qty: take, priceEach: r.priceEach });
    units += take;
    goods += take * r.priceEach;
  }
  if (!units) return refuse("Nobody is selling that at your price.");
  if (!Number.isSafeInteger(goods)) return refuse("Not enough gold.");

  const fee = marketFee(goods);
  const total = goods + fee;
  if (gold < total) return refuse("Not enough gold.");
  const shares = splitFee(fee, fills.map((f) => f.qty * f.priceEach));
  return {
    ok: true,
    data: {
      fills: fills.map((f, i) => ({ ...f, buyerFee: shares[i] })),
      units, goods, fee, total, short: units < qty, dearest: fills[fills.length - 1].priceEach,
    },
  };
}

/* Unique items get a market uid ("m<listingId>") when they change hands, so
   two saves can never hold the same instance. Stackables are unchanged. */
export function remintKey(key, listingId) {
  if (stacks(key)) return key;
  const p = parseKey(key);
  return makeKey(p.base, p.rarity, `m${listingId}`, p.prefix);
}

/* Takes the items out of the save for a new listing. The server writes the
   listing row from data; if that fails it must not keep this save. */
export function prepareListing(state, { key, from, qty, price } = {}, env) {
  if (!validKey(key)) return refuse("No such item.");
  if (!isPool(from)) return refuse("No such store.");
  const have = qtyIn(state, from, key);
  if (have <= 0) return refuse("You don't have that there.");
  if (!Number.isInteger(qty) || qty < 1 || qty > have) return refuse(`You can list 1 to ${have}.`);
  if (!Number.isInteger(price) || price < 1 || price > E.marketMaxPrice) return refuse("Set a price of at least 1 gold each.");
  const d = itemDef(key);
  if (!TRADEABLE.includes(d.kind)) return refuse("That can't be traded.");
  // A unique piece being worn is not for sale. (Pools never hold what is worn, but a save may be odd.)
  if (!stacks(key) && Object.values(state.equipment).includes(key)) return refuse("Take it off first.");
  // Wear belongs to the camp that did the wearing. A buyer's copy comes back under a new uid with
  // none, so a worn piece would leave the market as good as new.
  if (Object.hasOwn(state.wear, key) && state.wear[key] > 0) return refuse("Repair it before you list it.");

  const res = transact(state, (tx) => tx.remove(from, key, qty));
  if (!res.ok) return res;
  const data = {
    key, base: d.base, name: itemName(key), kind: d.kind, tier: d.tier == null ? null : d.tier,
    rarity: d.kind === "material" ? null : d.rarity, qty, priceEach: price,
  };
  emit(state, env, "market:listed", { key, qty, priceEach: price });
  return { ok: true, data };
}

/* Pays for a purchase and takes the goods in; key is already reminted. `goods` is what
   the seller asked, `fee` the buyer's leg on top: the purse loses both, and `cost` in
   the event is what actually left it, so the camp log and the toast name the number
   the player was charged rather than the shelf price. */
export function applyPurchase(state, { key, qty, goods, fee = 0 } = {}, env) {
  if (!validKey(key)) return refuse("No such item.");
  if (!Number.isInteger(qty) || qty < 1) return refuse("Buy at least one.");
  if (!Number.isInteger(goods) || goods < 0) return refuse("That price makes no sense.");
  if (!Number.isInteger(fee) || fee < 0) return refuse("That price makes no sense.");
  const cost = goods + fee;
  if (state.player.gold < cost) return refuse("Not enough gold.");

  const res = transact(state, (tx) => {
    tx.gold(-cost);
    if (!placeFor(state, key, orderFor(key))) tx.fail("Nowhere to put it.");
    tx.stash(key, qty, orderFor(key));
  });
  if (!res.ok) return res;
  emit(state, env, "market:bought", { key, qty, cost, fee });
  return { ok: true };
}

// A cancelled or expired listing comes home.
export function applyReturn(state, { key, qty } = {}, env) {
  if (!validKey(key)) return refuse("No such item.");
  if (!Number.isInteger(qty) || qty < 1) return refuse("Nothing to take back.");
  const res = transact(state, (tx) => {
    if (!placeFor(state, key, orderFor(key))) tx.fail("No room to take it back.");
    tx.stash(key, qty, orderFor(key));
  });
  if (!res.ok) return res;
  emit(state, env, "market:cancelled", { key, qty });
  return { ok: true };
}

/* Claims the post in order. Gold always comes in (it is earned). Items
   come in while there is room; once one has nowhere to go, it and every
   item letter after it wait for next time. An item letter holding nothing
   the camp can take (an item since retired, a count that is no count) is
   claimed empty, so it can never hold up the post, and the log says so
   once. A gold letter with no sound amount is left unclaimed. Returns what
   was claimed, for the server to mark. */
export function applyMail(state, letters, env) {
  const claimed = [];
  const items = [];
  let gold = 0;
  let blocked = false;
  let unknown = 0;

  for (const letter of Array.isArray(letters) ? letters : []) {
    if (!letter || typeof letter !== "object") continue;
    if (letter.kind === "gold") {
      const amount = Number(letter.gold);
      if (!Number.isSafeInteger(amount) || amount < 0) continue;
      if (amount > 0) transact(state, (tx) => tx.gold(amount, true));
      gold += amount;
      claimed.push(letter.id);
    } else if (letter.kind === "item") {
      const key = letter.item_key;
      const qty = Number(letter.qty);
      if (!validKey(key) || !Number.isSafeInteger(qty) || qty < 1 || (!stacks(key) && qty !== 1)) {
        unknown++;
        claimed.push(letter.id);
        continue;
      }
      if (blocked) continue;
      const res = transact(state, (tx) => tx.stash(key, qty, ORDER.mail));
      if (!res.ok) {
        blocked = true;
        continue;
      }
      items.push({ key, qty });
      claimed.push(letter.id);
    }
  }

  if (claimed.length) emit(state, env, "mail:claimed", { gold, items, count: claimed.length });
  if (unknown) emit(state, env, "mail:unknown", { count: unknown });
  return { claimed, gold, items };
}
