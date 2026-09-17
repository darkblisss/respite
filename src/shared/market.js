/* ============================================================
   Respite · market.js · The Exchange
   ------------------------------------------------------------
   The player market lives on the server: it owns the listings,
   the row locks and the post. These are the halves that touch a
   save, kept with the rules so the server and the tests agree on
   what listing, buying, taking back and claiming the post do.
   Each one is all or nothing.
   ============================================================ */

import { CONFIG } from "./config.js";
import { itemDef, itemName, parseKey, stacks, validKey, makeKey } from "./items.js";
import { ORDER, isPool, orderFor, placeFor, qtyIn, transact } from "./storage.js";
import { emit } from "./events.js";

const E = CONFIG.economy;
const refuse = (error) => ({ ok: false, error });
const TRADEABLE = ["material", "gear", "tool"];

// The house takes its cut: at least 1 gold of any sale worth gold at all.
export function marketFee(total) {
  return Math.max(total > 0 ? 1 : 0, Math.floor(total * E.marketFee));
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

// Pays for a purchase and takes the goods in; key is already reminted.
export function applyPurchase(state, { key, qty, cost } = {}, env) {
  if (!validKey(key)) return refuse("No such item.");
  if (!Number.isInteger(qty) || qty < 1) return refuse("Buy at least one.");
  if (!Number.isInteger(cost) || cost < 0) return refuse("That price makes no sense.");
  if (state.player.gold < cost) return refuse("Not enough gold.");

  const res = transact(state, (tx) => {
    tx.gold(-cost);
    if (!placeFor(state, key, orderFor(key))) tx.fail("Nowhere to put it.");
    tx.stash(key, qty, orderFor(key));
  });
  if (!res.ok) return res;
  emit(state, env, "market:bought", { key, qty, cost });
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
