/* ============================================================
   Respite · pages/shop.js · The Stalls
   ------------------------------------------------------------
   The Bonesetter, always open, and the Smuggler, who turns up
   twice a day on the world clock. Every purchase asks first,
   showing the cost, your gold and what is left, and says where
   the goods will land. Rows are built once; held counts, totals,
   prices you can't cover and the timers repaint in place.
   ============================================================ */

import { tierLabel } from "../../shared/registry.js";
import { CONFIG } from "../../shared/config.js";
import { h, el, setText, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl, artEl, hasArt } from "../ui/icons.js";
import { toast } from "../ui/overlay.js";
import { fmt, fmtGold, fmtWhole, fmtTime, fmtClock } from "../ui/format.js";
import { qtyPicker, confirmSpend } from "../ui/widgets.js";
import { shopStock, smugglerStock } from "../../shared/world.js";
import { windowEndsIn } from "../../shared/weather.js";
import { itemDef } from "../../shared/items.js";
import { ORDER, placeFor, qtyIn, haveQty } from "../../shared/storage.js";

const MAX_BUY = 1000;   // buyRemedy takes 1 to 1,000 at a time

// Pool names as they sit in a sentence.
const INTO = { inv: "Belongings", bank: "the Stockpile", vault: "the Vault", satchel: "the Satchel" };

const clampQty = (n) => Math.max(1, Math.min(MAX_BUY, Math.floor(n) || 1));

/* "They go into Belongings, pack them in the Satchel." Where a buy of n would land
   right now. The quantity matters: a remedy takes a slot a bottle in Belongings, so
   a lot that does not fit has to say so rather than promising a pool it cannot reach. */
function landing(state, key, order, n) {
  const w = placeFor(state, key, order, n);
  const one = n === 1;
  if (!w) {
    const names = order.map((p) => INTO[p]);
    const where = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return `${where.replace(/^the /, "The ")} ${names.length === 1 ? "is" : "are all"} full. Make room first.`;
  }
  const held = qtyIn(state, w, key);
  if (held > 0) return `${one ? "It joins" : "They join"} the ${fmtWhole(held)} in ${INTO[w]}.`;
  // Belongings is not the hunt's reach any more: it has to be packed first.
  if (w === order[0]) return `${one ? "It goes" : "They go"} into ${INTO[w]}${w === "inv" ? ", to pack in the Satchel" : ""}.`;
  return `${INTO[order[0]].replace(/^the /, "The ")} is full, so ${one ? "it goes" : "they go"} into ${INTO[w]}.`;
}

// What the camp already has of it. Nothing at all is worth no words: the row says the rest.
function heldText(state, key) {
  const all = haveQty(state, key);
  if (!all) return "";
  return qtyIn(state, "inv", key) === all ? `${fmtWhole(all)} in Belongings` : `${fmtWhole(all)} held`;
}

function cardHead(title, iconName, sub, actions) {
  return h("div.card-head",
    h("div", h("h2.card-title", iconEl(iconName), title), h("p.card-sub", sub)),
    actions ? h("div.card-actions", actions) : null);
}

export default {
  id: "shop",
  title: () => "Shop",
  group: "The Camp",

  mount(view, ctx) {
    const clockText = h("span");
    const movesOn = h("span");

    /* ---------- the Bonesetter ---------- */

    const remedies = shopStock(ctx.state).map((entry) => {
      const d = itemDef(entry.key);
      // The shared picker, trimmed to its stepper: rows get the compact one (UI-KIT 7.11).
      const picker = qtyPicker({ value: 1, max: MAX_BUY, allowUnlimited: false, presets: [], onChange: () => paintRemedy(row) });
      const stepper = picker.node.querySelector(".qty-stepper");
      stepper.classList.add("qty-sm");
      setAttr(picker.input, "aria-label", `How many ${d.name}`);

      const sub = h("div.lr-sub");
      const price = h("span.price", fmtGold(entry.price), h("small", "each"));
      const buy = h("button.btn.btn-gold.btn-soft.btn-sm", { type: "button", onClick: () => buyRemedy(row) });
      const row = { entry, d, picker, sub, price, buy };
      row.node = h("div.list-row.shop-row.stack-sm",
        h("div.art", { class: { "art-paint": hasArt(d) }, "data-tone": "good", "aria-hidden": "true" }, artEl(d)),
        h("div.lr-main", h("div.lr-title", d.name), sub),
        h("div.lr-end", price, h("div.shop-buy", stepper, buy)));
      return row;
    });

    function paintRemedy(row) {
      const state = ctx.state;
      const total = row.entry.price * clampQty(row.picker.pick.n);
      // A charm is not drunk: it rides in the rite's fourth socket and betters the odds once.
      const what = row.d.charm ? `Fortify odds ×${CONFIG.enchant.charmMult}, spent once` : `Restores ${fmt(row.d.heal)} HP`;
      setText(row.sub, [what, tierLabel(row.d.tier), heldText(state, row.entry.key)].filter(Boolean).join(" \u00b7 "));
      setText(row.buy, `Buy for ${fmtGold(total)}`);
      toggleClass(row.price, "is-short", total > state.player.gold);
    }

    async function buyRemedy(row) {
      const { entry, d } = row;
      const qty = clampQty(row.picker.pick.n);
      const total = entry.price * qty;
      const ok = await confirmSpend(ctx, {
        title: qty === 1 ? `Buy ${d.name}?` : `Buy ${fmtWhole(qty)} × ${d.name}?`,
        body: landing(ctx.state, entry.key, d.charm ? ORDER.material : ORDER.remedy, qty),
        gold: total,
        confirmText: `Buy for ${fmtGold(total)}`,
      });
      if (!ok) return;
      const res = await ctx.dispatch("buyRemedy", { key: entry.key, qty });
      if (res.ok) setText(el("srLive"), `Bought ${fmtWhole(qty)} ${d.name}`);
    }

    /* ---------- the Smuggler ---------- */

    // Always exactly three lots (smugglerStock), so this is a single row of three.
    const lotList = h("div.grid-cards.shop-grid");
    let lotSig = "";
    let lots = [];

    function buildLots(stock) {
      lots = stock.map((lot) => {
        const d = itemDef(lot.key);
        const sub = h("div.lr-sub");
        const price = lot.bought ? null : h("span.price", fmtGold(lot.price));
        const node = h("div.list-row.shop-row.stack-sm", { class: { "is-dealt": lot.bought } },
          h("div.art", { class: { "art-paint": hasArt(d) }, "data-tone": "gold", "aria-hidden": "true" }, artEl(d)),
          h("div.lr-main", h("div.lr-title", `${fmtWhole(lot.qty)}× ${d.name}`), sub),
          h("div.lr-end", lot.bought
            ? h("span.tag.tag-good", "Dealt")
            : [price, h("button.btn.btn-gold.btn-soft.btn-sm", { type: "button", "aria-label": `Buy ${fmtWhole(lot.qty)} ${d.name} for ${fmtGold(lot.price)}`, onClick: () => buyLot(lot) }, "Buy")]));
        return { lot, d, sub, price, node };
      });
      lotList.replaceChildren(...lots.map((l) => l.node));
    }

    function paintLots(state) {
      const stock = smugglerStock(state);
      const sig = stock.map((l) => `${l.key}:${l.qty}:${l.price}:${l.bought ? 1 : 0}`).join("|");
      if (sig !== lotSig) {
        lotSig = sig;
        buildLots(stock);
      }
      lots.forEach((l) => {
        setText(l.sub, [tierLabel(l.d.tier), `${fmtGold(l.lot.price)} the lot`, heldText(state, l.lot.key)].filter(Boolean).join(" \u00b7 "));
        if (l.price) toggleClass(l.price, "is-short", l.lot.price > state.player.gold);
      });
    }

    async function buyLot(lot) {
      const d = itemDef(lot.key);
      const ok = await confirmSpend(ctx, {
        title: `Buy ${fmtWhole(lot.qty)}× ${d.name}?`,
        body: `The Smuggler does not haggle and does not wait. ${landing(ctx.state, lot.key, ORDER.material, lot.qty)}`,
        gold: lot.price,
        confirmText: `Buy for ${fmtGold(lot.price)}`,
      });
      if (!ok) return;
      // The lots turn over on the world clock; never pay for one that changed while the question was open.
      const now = smugglerStock(ctx.state)[lot.slot];
      if (!now || now.key !== lot.key || now.qty !== lot.qty || now.price !== lot.price) {
        toast("The Smuggler has moved on", { kind: "warn", icon: "hourglass" });
        return;
      }
      const res = await ctx.dispatch("buySmuggler", { slot: lot.slot, key: lot.key });
      if (res.ok) setText(el("srLive"), `Bought ${fmtWhole(lot.qty)} ${d.name}`);
    }

    /* ---------- the page ---------- */

    view.appendChild(h("div.page",
      h("header.page-head",
        h("div",
          h("div.eyebrow.page-eyebrow", "The Camp"),
          h("h1.page-title", "Shop"),
          h("p.page-sub", "Remedies from the Bonesetter, and whatever the Smuggler has this visit.")),
        h("div.page-actions",
          h("span.clock", { "data-tip": "World clock. Bounties and the Smuggler run on this." }, iconEl("clock"), clockText))),
      h("section.card",
        cardHead("The Bonesetter", "bonesetter", `Always open. Remedies land in Belongings; pack the Satchel to take them out. Between encounters one is drunk at or below ${Math.round(CONFIG.hunt.remedyAt * 100)}% health. Charms go where materials go, for the Fortify anvil.`),
        h("div.grid-cards.shop-grid", remedies.map((r) => r.node))),
      h("section.card",
        cardHead("The Smuggler", "hourglass", "Turns up twice a day on the world clock with whatever fell off the back of something. Each lot goes once.",
          h("span.chip.chip-gold", iconEl("clock"), movesOn)),
        lotList)));

    function paint() {
      const state = ctx.state;
      setText(clockText, fmtClock(ctx.now));
      setText(movesOn, `Moves on in ${fmtTime(windowEndsIn(ctx.now))}`);
      remedies.forEach(paintRemedy);
      paintLots(state);
    }

    paint();
    return { update: paint };
  },
};
