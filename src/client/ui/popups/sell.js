/* ============================================================
   Respite · ui/popups/sell.js · The Stall
   ------------------------------------------------------------
   Putting goods on the player market (UI-KIT 8.14): how many,
   the price each, and what the market's cut leaves you. The
   server takes the goods and writes the listing (marketList);
   this only asks and shows the sums.

   It opens on top of the item popup, so it keeps to itself: its
   own ticker, no shared state, and it closes nothing but itself.
   Opened with no item (the Market's "Sell an item"), it first
   asks what to sell.
   ============================================================ */

import { h, setText, setAttr, toggleClass } from "../dom.js";
import { iconEl } from "../icons.js";
import { openModal, toast } from "../overlay.js";
import { fmtWhole, fmtGold } from "../format.js";
import { qtyPicker, registerPopup, openPopup } from "../widgets.js";
import { CONFIG } from "../../../shared/config.js";
import { itemDef, itemName, stacks } from "../../../shared/items.js";
import { isPool, orderedKeys, poolName, qtyIn } from "../../../shared/storage.js";
import { marketFee } from "../../../shared/market.js";

const E = CONFIG.economy;
const TRADEABLE = ["material", "gear", "tool"];   // what prepareListing accepts
const FEE_PCT = Math.round(E.marketFee * 100);
const ASK_MS = 15 * 1000;
const FROM = { inv: "From Belongings", bank: "From the Stockpile", vault: "From the Vault" };
const IN = { inv: "in Belongings", bank: "in the Stockpile", vault: "in the Vault", satchel: "in the Satchel" };

// Ids for label and hint wiring; two sell dialogs can be open in a session, never at once.
let seq = 0;

// Gear and tools show their rarity; materials sit on the market's gold.
function artOf(def) {
  const rarity = def && def.kind !== "material" && def.rarity && def.rarity !== "common" ? def.rarity : null;
  return { art: def ? def.icon : "market", artRarity: rarity, artTone: "gold" };
}

// Why this can't be listed, in a line, or null when it can. Mirrors prepareListing.
function refusal(ctx, key, from) {
  if (ctx.account.mode === "guest") return "Sign in to trade. The market pays by post, and the post needs a name.";
  const def = key ? itemDef(key) : null;
  if (!def) return "There is nothing by that name to sell.";
  const worn = from === "worn" || (!stacks(key) && Object.values(ctx.state.equipment).includes(key));
  if (worn) return "Worn gear can't go on the market. Take it off first.";
  if (!TRADEABLE.includes(def.kind)) return "Only materials, gear and tools can be traded.";
  if ((ctx.state.wear[key] || 0) > 0) return "Repair it before you list it. The market only takes sound pieces.";
  if (!isPool(from)) return "Open it from a store of your own to list it.";
  if (qtyIn(ctx.state, from, key) <= 0) return `There is no ${itemName(key)} left ${IN[from]}.`;
  return null;
}

function openRefused(ctx, key, why) {
  const def = key ? itemDef(key) : null;
  const guest = ctx.account.mode === "guest";
  return openModal({
    title: def ? itemName(key) : "The market",
    sub: "Not for sale",
    ...artOf(def),
    size: "sm",
    body: h("p.cost-note", iconEl("alert"), why),
    actions: guest
      ? [
        { label: "Sign in", onClick: () => { openPopup("account", ctx, { mode: "signin" }); } },
        { label: "Create account", kind: "gold", onClick: () => { openPopup("account", ctx, { mode: "create" }); } },
      ]
      : [{ label: "Close", kind: "quiet" }],
  });
}

/* ================= THE LISTING ================= */

function openSell(ctx, key, from) {
  const why = refusal(ctx, key, from);
  if (why) return openRefused(ctx, key, why);

  const id = ++seq;
  const def = itemDef(key);
  const name = itemName(key);
  const unique = !stacks(key);
  const value = Math.max(1, Math.floor(def.value || 1));
  let held = qtyIn(ctx.state, from, key);
  let qty = unique ? 1 : held;
  let touched = false;   // once the player types a price, the market's answer stops overwriting it
  let market = "Asking what it goes for.";
  let m = null;
  let offTick = null;

  const subLine = () => (unique ? `${FROM[from]} · One of a kind` : `${FROM[from]} · ${fmtWhole(held)} held`);

  const picker = unique ? null : qtyPicker({
    value: held,
    max: Math.max(1, held),
    allowUnlimited: false,
    presets: [1, 10, 100].filter((n) => n < held),
    onChange: (p) => { qty = p.n; recalc(); },
  });
  if (picker) setAttr(picker.input, "aria-label", `How many ${name} to list`);

  const price = h("input.input", {
    id: `sellPrice${id}`,
    type: "text",
    inputmode: "numeric",
    autocomplete: "off",
    enterkeyhint: "done",
    maxlength: String(String(E.marketMaxPrice).length),
    value: String(value),
    "aria-describedby": `sellHint${id}`,
  });
  const hint = h("span.field-hint", { id: `sellHint${id}` }, market);
  const sums = h("div.fee");
  const gone = h("p.cost-note", { hidden: true }, iconEl("alert"), h("span"));

  // Digits only; 0 means no valid price.
  function readPrice() {
    const digits = price.value.replace(/[^0-9]/g, "");
    if (digits !== price.value) price.value = digits;
    const n = digits ? Number(digits) : 0;
    return n >= 1 && n <= E.marketMaxPrice ? n : 0;
  }

  function recalc() {
    const each = readPrice();
    const n = unique ? 1 : Math.max(1, Math.min(Math.max(1, held), qty));
    const total = each * n;
    const fee = marketFee(total);
    sums.replaceChildren(
      h("div.cost-row", h("span.l", `Listing ${fmtWhole(n)} × ${fmtGold(each)}`), h("span.v", fmtGold(total))),
      h("div.cost-row", h("span.l", `Market fee (${FEE_PCT}%)`), h("span.v", `−${fmtGold(fee)}`)),
      h("div.cost-row.is-total", h("span.l", "You receive when it all sells"), h("span.v", iconEl("coin"), fmtGold(total - fee))));

    const bad = !each;
    toggleClass(price, "is-invalid", bad);
    setAttr(price, "aria-invalid", bad ? "true" : null);
    toggleClass(hint, "t-bad", bad);
    setText(hint, bad ? `Set a price of 1 to ${fmtGold(E.marketMaxPrice)} each.` : market);

    gone.hidden = held > 0;
    setText(gone.lastChild, `There is no ${name} left ${IN[from]}.`);
    if (m && m.buttons[1]) m.buttons[1].disabled = bad || held <= 0;
  }

  function submit() {
    held = qtyIn(ctx.state, from, key);
    const each = readPrice();
    const n = unique ? 1 : Math.min(held, picker.pick.n);
    if (!each || n < 1) {
      recalc();
      price.focus();
      return false;
    }
    // Resolving false keeps the dialog: a refusal (toasted by dispatch) can be fixed and tried again.
    return Promise.resolve(ctx.dispatch("marketList", { key, from, qty: n, price: each }))
      .then((res) => {
        if (!res || !res.ok) return false;
        toast(`Listed ${fmtWhole(n)} ${name} at ${fmtGold(each)} each`, { kind: "gold", icon: "market" });
        // The Market page listens so its own listings refresh; nothing else hears this.
        if (ctx.store && ctx.store.bus) ctx.store.bus.emit("realm:market", { type: "listed", listingId: res.data ? res.data.listingId : null });
        return true;
      })
      .catch(() => {
        toast("The market did not answer", { kind: "warn" });
        return false;
      });
  }

  price.addEventListener("input", () => { touched = true; recalc(); });
  price.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const go = m && m.buttons[1];
    if (go && !go.disabled) go.click();
  });

  m = openModal({
    title: `List ${name}`,
    sub: subLine(),
    ...artOf(def),
    body: [
      picker ? h("div.field", h("span.field-label", "How many"), picker.node) : null,
      h("div.field",
        h("label.field-label", { for: price.id }, "Price each"),
        h("div.input-wrap", iconEl("coin"), price, h("span.affix", "g")),
        hint),
      sums,
      gone,
      h("p.modal-note", `Paid by post when it sells. Unsold items come back by post after ${E.marketListingDays} days.`),
    ],
    actions: [
      { label: "Cancel", kind: "quiet" },
      { label: "List for sale", kind: "primary", icon: "tag", onClick: submit },
    ],
    onClose: () => { if (offTick) offTick(); },
  });
  recalc();

  // Crews keep working under the dialog: keep the most you can list honest.
  offTick = ctx.onTick(() => {
    if (m.closed) return;
    const now = qtyIn(ctx.state, from, key);
    if (now === held) return;
    held = now;
    if (picker) {
      picker.refresh(Math.max(1, held));
      qty = picker.pick.n;
    }
    m.setTitle(`List ${name}`, subLine());
    recalc();
  });

  // The cheapest listing of the same thing is the suggestion; the merchant's price until then,
  // or for good if the market is slow to say.
  Promise.race([
    Promise.resolve().then(() => ctx.net.market.browse({ q: name, sort: "price", limit: 50 })),
    new Promise((resolve) => setTimeout(() => resolve(null), ASK_MS)),
  ])
    .then((res) => {
      const merchant = `A merchant pays ${fmtGold(value)}.`;
      if (!res || res.error) {
        market = `Couldn't ask the market just now. ${merchant}`;
      } else {
        const same = (Array.isArray(res.rows) ? res.rows : [])
          .filter((r) => (unique ? r.item_name === name : r.item_key === key))
          .map((r) => Number(r.price_each))
          .filter((n) => Number.isFinite(n) && n >= 1);
        const cheapest = same.length ? Math.min(...same) : 0;
        market = cheapest ? `Cheapest listed now: ${fmtGold(cheapest)}. ${merchant}` : `Nobody is selling ${name} right now. ${merchant}`;
        if (cheapest && !touched) price.value = String(cheapest);
      }
    })
    .catch(() => { market = `Couldn't ask the market just now. A merchant pays ${fmtGold(value)}.`; })
    .then(() => { if (!m.closed) recalc(); });

  return m;
}

/* ================= WHAT TO SELL ================= */

function openChooser(ctx) {
  if (ctx.account.mode === "guest") return openRefused(ctx, null, refusal(ctx, null, null));

  let m = null;
  const state = ctx.state;
  const groups = ["inv", "bank", "vault"]
    .map((w) => ({
      w,
      keys: orderedKeys(state, w).filter((k) => {
        const d = itemDef(k);
        return d && TRADEABLE.includes(d.kind) && qtyIn(state, w, k) > 0;
      }),
    }))
    .filter((g) => g.keys.length);

  const pick = (key, w) => {
    m.close("action");
    openSell(ctx, key, w);
  };

  const row = (key, w) => {
    const d = itemDef(key);
    const rarity = d.kind !== "material" && d.rarity ? d.rarity : "common";
    const name = itemName(key);
    return h("div.list-row",
      h("div.art.art-sm", { "data-rarity": rarity, "aria-hidden": "true" }, iconEl(d.icon)),
      h("div.lr-main",
        h("div.lr-title", { class: rarity !== "common" && `rar-${rarity}` }, name),
        h("div.lr-sub", stacks(key)
          ? `${fmtWhole(qtyIn(state, w, key))} held · a merchant pays ${fmtGold(d.value || 1)} each`
          : `One of a kind · a merchant pays ${fmtGold(d.value || 1)}`)),
      h("div.lr-end", h("button.btn.btn-primary.btn-soft.btn-sm", { type: "button", "aria-label": `List ${name}`, onClick: () => pick(key, w) }, "List")));
  };

  const body = groups.length
    ? groups.map((g) => h("div.ap-block", h("div.eyebrow", poolName(g.w)), h("div.list", g.keys.map((k) => row(k, g.w)))))
    : h("div.empty.empty-sm",
      h("div.empty-art", iconEl("tag")),
      h("div.empty-title", "Nothing to sell"),
      h("p.empty-text", "Gather or make something first. Worn gear has to come off before it can be listed."));

  m = openModal({
    title: "Sell an item",
    sub: "Choose what goes on the market",
    art: "tag",
    artTone: "gold",
    body,
    actions: [{ label: "Close", kind: "quiet" }],
  });
  return m;
}

registerPopup("sell", (ctx, key = null, from = null) => (key ? openSell(ctx, key, from) : openChooser(ctx)));
