/* ============================================================
   Respite · pages/market.js · The Trading Post
   ------------------------------------------------------------
   #/market (UI-KIT 8.14): what the realm has for sale, your own
   listings and your recent trades. The realm owns every row.
   This page only asks for them (ctx.net.market) and sends
   marketBuy, marketBuyPool and marketCancel through
   ctx.dispatch, which waits on the server. Every gold spend asks
   first, and the number it asks about is the one that leaves the
   purse: the market's cut is on top of the asking price.

   Two counters, because two kinds of goods. Materials are
   fungible, so every open listing of one is merged into a pool:
   how many are to be had, the cheapest price, and the price
   bands behind it. A buy names the item, a quantity and the most
   it will pay each, and the realm fills it cheapest first across
   whoever is selling.

   Gear and tools are not fungible -- one Slag Sword is Rare and
   worked to +7, the next is a plain Common -- so they cannot
   pool. They are shelved instead: one row a base, at the
   cheapest it can be had for, and opening it shows every piece
   actually on the shelf with its own rarity, price and time
   left. The buy still runs against one listing, as it always
   did. A rarity floor on the bar reads on both, so the cheapest
   price on a shelf is the cheapest price that passes it.

   Nobody's name is on any of it: the market is anonymous both
   ways, and the only listings this page can tell you about are
   your own.

   Rows are rebuilt only when what the realm said changes; time
   left and pending buttons repaint in place. Guests get a
   sign-in card instead of the page.
   ============================================================ */

import { h, setText, setAttr, setWidth, toggleClass, on } from "../ui/dom.js";
import { iconEl, artEl, hasArt } from "../ui/icons.js";
import { openModal, confirm, toast } from "../ui/overlay.js";
import { fmtWhole, fmtGold, fmtTime, fmtAgo } from "../ui/format.js";
import { qtyPicker, confirmSpend, openPopup } from "../ui/widgets.js";
import { CONFIG } from "../../shared/config.js";
import { itemDef, isRemedy, stacks } from "../../shared/items.js";
import { GameData, rarityDef, skillName, tierLabel } from "../../shared/registry.js";
import { placeFor } from "../../shared/storage.js";
import { fillPool, marketFee } from "../../shared/market.js";

const E = CONFIG.economy;
const FEE_PCT = Math.round(E.marketFee * 100);
const REFRESH_MS = 30 * 1000;
const SEARCH_MS = 300;
const ASK_MS = 15 * 1000;
const SHOWN = 50;
const BANDS_SHOWN = 3;    // price bands in a pool's row; the buy sheet lists the rest
const RARS_SHOWN = 3;     // rarities named in a shelf's row; the sheet lists them all
const SHELF_ROWS = 50;    // lots a shelf sheet draws
const INTO = { inv: "into Belongings", bank: "into the Stockpile", vault: "into the Vault" };

/* The rarity floor, as the bar offers it: "Rare and up" is every piece that is Rare or
   better. Materials have no rarity at all, so any floor but Any hides them -- which is
   what a player asking for Epic gear meant. */
const FLOORS = [
  { id: "", label: "Any rarity" },
  { id: "uncommon", label: "Uncommon and up" },
  { id: "rare", label: "Rare and up" },
  { id: "epic", label: "Epic and up" },
  { id: "legendary", label: "Legendary and up" },
];

/* Remedies are materials to the realm, so that split is made here. `pool` asks for the
   aggregated material pools, `shelf` for gear and tools grouped by base; All wants both. */
const KINDS = [
  { id: "all", label: "All", kind: null, pool: true, shelf: true },
  { id: "material", label: "Materials", pool: true, keep: (r) => !isRemedy(r.item_key) },
  { id: "gear", label: "Gear", kind: "gear", shelf: true },
  { id: "tool", label: "Tools", kind: "tool", shelf: true },
  { id: "remedy", label: "Remedies", pool: true, keep: (r) => isRemedy(r.item_key) },
];

const STATUS = {
  open: ["Open", "tag-good"],
  sold: ["Sold", "tag-gold"],
  expired: ["Expired", null],
  cancelled: ["Taken back", null],
};

/* ================= SMALL PIECES ================= */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const when = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

// A pool's price bands as the realm sent them: cheapest first, and only what it counted.
function bandsOf(row) {
  const raw = Array.isArray(row && row.bands) ? row.bands : [];
  return raw
    .map((b) => ({ each: Math.floor(num(b && b.each)), qty: Math.floor(num(b && b.qty)) }))
    .filter((b) => b.each >= 1 && b.qty > 0)
    .sort((a, b) => a.each - b.each);
}

// "40 at 12g, 15 at 13g", and what the row could not price is left out of the count.
function bandText(bands, shown = BANDS_SHOWN) {
  const said = bands.slice(0, shown).map((b) => `${fmtWhole(b.qty)} at ${fmtGold(b.each)}`);
  const rest = bands.length - said.length;
  if (rest > 0) said.push(`${fmtWhole(rest)} more ${rest === 1 ? "band" : "bands"}`);
  return said.join(" · ");
}

// The pool as this camp can actually buy it: only the bands the realm priced.
const poolDepth = (bands) => bands.reduce((n, b) => n + b.qty, 0);

// A shelf's rarity breakdown as the realm sent it: least rarity first, only what it counted.
function rarsOf(row) {
  const raw = Array.isArray(row && row.rarities) ? row.rarities : [];
  return raw
    .map((r) => ({
      rarity: String((r && r.rarity) || "common"),
      lots: Math.floor(num(r && r.lots)),
      qty: Math.floor(num(r && r.qty)),
      min: Math.floor(num(r && r.min)),
    }))
    .filter((r) => r.lots > 0);
}

// "4 Common, 2 Rare", and what is past the count is said as a number rather than named.
function rarText(rars, shown = RARS_SHOWN) {
  const said = rars.slice(0, shown).map((r) => `${fmtWhole(r.qty)} ${rarityDef(r.rarity).name}`);
  const rest = rars.length - said.length;
  if (rest > 0) said.push(`${fmtWhole(rest)} more`);
  return said.join(" · ");
}

// The dearest rarity on a shelf, which is the one the row's art is tinted with.
function topRarity(rars) {
  return rars.length ? rars[rars.length - 1].rarity : "common";
}

// A row from the realm names either one piece (item_key) or a whole shelf (item_base).
const keyOf = (row) => String((row && (row.item_key || row.item_base)) || "");

function rarityOf(row) {
  const d = itemDef(keyOf(row));
  if (row.rarity) return row.rarity;
  return d && d.kind !== "material" && d.rarity ? d.rarity : "common";
}

function itemArt(key, rarity, cls = "art-sm") {
  const d = itemDef(key);
  // A drawn material shows itself and drops the plate; gear keeps both. A drawn
  // tool finer than Common gets its plate back, lit for its rarity.
  const paint = hasArt(d);
  const fine = rarity && rarity !== "common";
  return h("div.art", {
    class: paint ? [cls, "art-paint"] : cls,
    "data-rarity": paint ? (fine ? rarity : null) : rarity || "common",
    "aria-hidden": "true",
  }, d ? artEl(d) : iconEl("unknown"));
}

// "Weapon · Lv10", "Bars · Lv10", "Reagent", "Tool · Delving · Lv10".
function kindLine(row) {
  const d = itemDef(keyOf(row));
  const tier = row.item_tier != null ? row.item_tier : d && d.tier;
  const tierText = tier ? tierLabel(tier) : null;
  let parts;
  if (!d) parts = ["Goods", tierText];
  else if (d.kind === "gear") parts = [String(GameData.SLOT_LABELS[d.slot] || "Gear"), tierText];
  else if (d.kind === "tool") parts = ["Tool", skillName(d.forSkill), tierText];
  else if (d.heal > 0) parts = [`Remedy · Restores ${fmtWhole(d.heal)} HP`];
  else if (d.reagent) parts = ["Reagent"];
  else if (d.chest) parts = ["Chest", tierText];
  else parts = [d.category || "Material", tierText];
  return parts.filter(Boolean).join(" · ");
}

function cardHead(title, { sub = null, actions = null } = {}) {
  const subEl = sub == null ? null : h("p.card-sub", sub);
  return {
    subEl,
    node: h("div.card-head",
      h("div", h("h2.card-title", title), subEl),
      actions ? h("div.card-actions", actions) : null),
  };
}

function emptyState({ icon, title, text, action = null, small = true }) {
  return h("div.empty", { class: small && "empty-sm" },
    h("div.empty-art", iconEl(icon)),
    h("div.empty-title", title),
    text ? h("p.empty-text", text) : null,
    action);
}

function failState(error, retry) {
  return emptyState({
    icon: "offline",
    title: "The realm did not answer",
    text: `${String(error || "Something went wrong on the road.")} Your camp is fine.`,
    action: h("button.btn.btn-sm", { type: "button", onClick: retry }, iconEl("sync"), "Retry"),
  });
}

function skeletonListings(n = 4) {
  return Array.from({ length: n }, () => h("div.listing.realm-skel", { "aria-hidden": "true" },
    h("div.listing-item", h("span.skel.skel-art"), h("div.grow", h("span.skel.skel-line.skel-w-60"), h("span.skel.skel-line.skel-w-35"))),
    h("div.listing-qty", h("span.skel.skel-line.skel-w-50.ml-auto")),
    h("div.listing-price", h("span.skel.skel-line.skel-w-60.ml-auto")),
    h("div.listing-depth", h("span.skel.skel-line.skel-w-60")),
    h("div.listing-buy", h("span.skel.skel-line.skel-w-80"))));
}

function skeletonList(n = 3) {
  return h("div.list.realm-skel", { "aria-hidden": "true" }, Array.from({ length: n }, () => h("div.list-row",
    h("span.skel.skel-art"),
    h("div.lr-main", h("span.skel.skel-line.skel-w-60"), h("span.skel.skel-line.skel-w-35")),
    h("span"))));
}

// Guests see why the Market needs a name, and the way to get one.
function signInCard(ctx) {
  return h("section.card",
    h("div.empty",
      h("div.empty-art", iconEl("lock")),
      h("div.empty-title", "Sign in to trade"),
      h("p.empty-text", "The Market is run by the realm, not your camp. It holds your goods while they sell and pays you by post, and the post needs a name. Guests can't buy or sell."),
      h("div.btn-row",
        h("button.btn.btn-gold", { type: "button", onClick: () => openPopup("account", ctx, { mode: "create" }) }, "Create account"),
        h("button.btn", { type: "button", onClick: () => openPopup("account", ctx, { mode: "signin" }) }, "Sign in"))));
}

function busy(btn, on) {
  if (!btn) return;
  toggleClass(btn, "is-loading", !!on);
  btn.disabled = !!on;
}

/* ================= THE PAGE ================= */

export default {
  id: "market",
  title: () => "Market",
  group: "The Realm",

  mount(view, ctx) {
    const page = h("div.page");
    view.replaceChildren(page);
    let body = null;
    let who = null;

    // A sign-in (or out) swaps the whole page; everything below belongs to one account.
    function render() {
      const acc = ctx.account;
      who = `${acc.mode}:${acc.userId || ""}`;
      if (body) body.destroy();
      body = null;
      const guest = acc.mode === "guest";
      const actions = guest ? null : h("div.page-actions",
        h("button.btn.btn-primary", { type: "button", onClick: () => openPopup("sell", ctx) }, iconEl("tag"), "Sell an item"));
      page.replaceChildren(h("header.page-head",
        h("div",
          h("div.eyebrow.page-eyebrow", "The Realm"),
          h("h1.page-title", "Market"),
          h("p.page-sub", `Buy from the realm, or put your own goods up. Nobody is named either way, and the market takes ${FEE_PCT}% off both sides of a trade.`)),
        actions));
      if (guest) page.append(signInCard(ctx));
      else body = marketBody(ctx, page, actions);
    }

    render();
    return {
      update() {
        const acc = ctx.account;
        if (`${acc.mode}:${acc.userId || ""}` !== who) render();
        else if (body) body.update();
      },
      unmount() {
        if (body) body.destroy();
        body = null;
      },
    };
  },
};

/* ================= SIGNED IN ================= */

function marketBody(ctx, page, actions) {
  let alive = true;
  const filt = { q: "", kind: "all", tier: 0, rarity: "", sort: "price" };
  const board = { rows: null, pools: null, error: null, stale: false, token: 0, at: 0, sig: "" };
  const mine = { rows: null, error: null, token: 0, sig: "" };
  const trades = { rows: null, error: null, token: 0, sig: "" };
  const pending = new Set();   // listing ids, and pool keys, waiting on the server
  let shown = [];              // { row, node, buy, time, pool } for what is on screen
  let mineShown = [];          // { row, node, sub, cancel } for your own
  let lastSecond = -1;
  let searchTimer = 0;

  const me = () => ctx.account;
  // The realm tells a player about their own listings and nobody else's; `mine` is all there is.
  const isMine = (row) => row.mine === true;
  const kindDef = () => KINDS.find((k) => k.id === filt.kind) || KINDS[0];
  const filtered = () => !!(filt.q.trim() || filt.kind !== "all" || filt.tier || filt.rarity);

  /* ---------- the listings card ---------- */

  const search = h("input.input.input-sm", { type: "search", placeholder: "Search items", "aria-label": "Search listings", autocomplete: "off", maxlength: "40", enterkeyhint: "search" });
  const seg = h("div.seg", { role: "tablist", "aria-label": "Kind" },
    KINDS.map((k) => h("button.seg-btn", { type: "button", role: "tab", "aria-selected": k.id === filt.kind ? "true" : "false", dataset: { kind: k.id } }, k.label)));
  const tierSel = h("select.select.select-sm", { "aria-label": "Tier" },
    h("option", { value: "0" }, "All tiers"),
    GameData.TIERS.map((t) => h("option", { value: String(t.i) }, tierLabel(t.i))));
  const rarSel = h("select.select.select-sm", { "aria-label": "Rarity" },
    FLOORS.map((f) => h("option", { value: f.id }, f.label)));
  const sortSel = h("select.select.select-sm", { "aria-label": "Sort" },
    h("option", { value: "price" }, "Cheapest"),
    h("option", { value: "newest" }, "Newest"));
  // One refresh for the whole page, beside Sell an item: the bar has no room left on a desktop row.
  const refreshBtn = h("button.btn.btn-quiet", { type: "button" }, iconEl("sync"), "Refresh");
  if (actions) actions.prepend(refreshBtn);

  const listSub = h("p.card-sub", "Asking the realm");
  const listBox = h("div.listings", { role: "table", "aria-label": "Listings", "aria-busy": "true" });
  const listCard = h("section.card.card-flush",
    h("div.card-head", h("div", h("h2.card-title", "Listings"), listSub)),
    h("div.market-bar",
      h("div.input-wrap.market-search", iconEl("search"), search),
      seg,
      // The three narrowing controls travel together, so they drop to a second line as a set
      // rather than one of them trailing off on its own.
      h("div.market-filters", tierSel, rarSel, sortSel)),
    listBox);

  /* ---------- my listings and recent sales ---------- */

  const mineChip = h("span.chip", "0 open");
  const mineHead = cardHead("My listings", { sub: `Up to ${E.marketMaxListings}. Unsold goods come back by post after ${E.marketListingDays} days.`, actions: mineChip });
  const mineBox = h("div");
  const tradesHead = cardHead("Recent sales", { sub: `What you sold and what you bought. Sales pay by post, less the market's ${FEE_PCT}%; buying pays the same ${FEE_PCT}% on top.` });
  const tradesBox = h("div");

  page.append(
    listCard,
    h("div.grid-2",
      h("section.card", mineHead.node, mineBox),
      h("section.card", tradesHead.node, tradesBox)));

  /* ---------- loading ---------- */

  // Reads only. A throw or a request that never comes back becomes an answer with an error, never a stuck page.
  async function ask(fn) {
    let timer = 0;
    try {
      const res = await Promise.race([
        Promise.resolve().then(fn),
        new Promise((resolve) => { timer = setTimeout(() => resolve({ rows: null, error: "The realm is slow to answer." }), ASK_MS); }),
      ]);
      return res && typeof res === "object" ? res : { rows: null, error: "The realm sent nothing back." };
    } catch (err) {
      return { rows: null, error: "The road to the realm is closed." };
    } finally {
      clearTimeout(timer);
    }
  }

  /* Two asks, because the realm keeps two books: the material pools and the gear shelves.
     A tab that wants only one makes only one, and a rarity floor closes the pools
     altogether -- a material has no rarity, so none of them passes one. */
  async function loadListings({ quiet = false } = {}) {
    const token = ++board.token;
    const k = kindDef();
    const wantPools = !!k.pool && !filt.rarity;
    const wantRows = !!k.shelf;
    if (!quiet || (!board.rows && !board.pools)) {
      board.rows = null;
      board.pools = null;
      board.error = null;
      paintListings();
    }
    setAttr(listBox, "aria-busy", "true");
    const [pools, rows] = await Promise.all([
      wantPools
        ? ask(() => ctx.net.market.pools({ q: filt.q.trim(), tier: filt.tier || null, limit: k.keep ? SHOWN * 2 : SHOWN }))
        : { rows: [], error: null },
      wantRows
        ? ask(() => ctx.net.market.bases({ q: filt.q.trim(), kind: k.kind, tier: filt.tier || null, rarity: filt.rarity || null, sort: filt.sort, limit: SHOWN }))
        : { rows: [], error: null },
    ]);
    if (!alive || token !== board.token) return;
    setAttr(listBox, "aria-busy", "false");
    board.at = Date.now();
    const error = pools.error || rows.error;
    if (error) {
      // A quiet refresh that fails keeps what was on screen and says so.
      if (quiet && (board.rows || board.pools)) board.stale = true;
      else board.error = String(error);
    } else {
      const pooled = Array.isArray(pools.rows) ? pools.rows : [];
      board.pools = (k.keep ? pooled.filter(k.keep) : pooled).slice(0, SHOWN);
      board.rows = (Array.isArray(rows.rows) ? rows.rows : []).slice(0, SHOWN);
      board.error = null;
      board.stale = false;
    }
    paintListings();
  }

  async function loadMine() {
    const token = ++mine.token;
    const res = await ask(() => ctx.net.market.mine());
    if (!alive || token !== mine.token) return;
    if (res.error) {
      if (!mine.rows) mine.error = String(res.error);
    } else {
      mine.rows = Array.isArray(res.rows) ? res.rows : [];
      mine.error = null;
    }
    paintMine();
  }

  async function loadTrades() {
    const token = ++trades.token;
    const res = await ask(() => ctx.net.market.sales());
    if (!alive || token !== trades.token) return;
    if (res.error) {
      if (!trades.rows) trades.error = String(res.error);
    } else {
      trades.rows = Array.isArray(res.rows) ? res.rows : [];
      trades.error = null;
    }
    paintTrades();
  }

  function refreshAll({ quiet = true } = {}) {
    return Promise.all([loadListings({ quiet }), loadMine(), loadTrades()]);
  }

  /* ---------- painting the listings ---------- */

  function paintListings() {
    const sortWords = filt.sort === "newest" ? "newest first" : "cheapest first";
    if (board.error) {
      board.sig = "error";
      shown = [];
      setText(listSub, "No answer");
      listBox.replaceChildren(failState(board.error, () => loadListings()));
      return;
    }
    if (!board.rows || !board.pools) {
      board.sig = "loading";
      shown = [];
      setText(listSub, "Asking the realm");
      listBox.replaceChildren(...skeletonListings());
      return;
    }

    const pools = board.pools;
    const rows = board.rows;
    const n = pools.length + rows.length;
    // Neither a pool nor a shelf is a listing, so both are counted as one and named as what they are.
    const said = [];
    if (pools.length) said.push(`${fmtWhole(pools.length)} ${pools.length === 1 ? "pool" : "pools"}`);
    if (rows.length) said.push(`${fmtWhole(rows.length)} ${rows.length === 1 ? "shelf" : "shelves"}`);
    let count;
    if (!n) count = filtered() ? "Nothing matches" : "Nothing for sale";
    else if (n >= SHOWN) count = `The ${SHOWN} ${filt.sort === "newest" ? "newest" : "cheapest"}`;
    else count = `${said.join(" and ")}, ${sortWords}`;
    setText(listSub, board.stale ? `${count}. Couldn't refresh just now.` : count);
    toggleClass(listSub, "t-bad", board.stale);

    const acc = me();
    const sig = `${acc.userId}|${pools.map((p) => `${p.item_key}:${p.qty_left}:${p.price_min}:${bandsOf(p).length}`).join(",")}`
      + `|${rows.map((r) => `${r.item_base}:${r.lots}:${r.qty_left}:${r.price_min}:${rarsOf(r).length}`).join(",")}`;
    if (sig === board.sig) return;
    board.sig = sig;

    if (!n) {
      shown = [];
      listBox.replaceChildren(filtered()
        ? emptyState({
          icon: "search",
          title: "No listings match",
          text: filt.q.trim() ? `Nobody is selling anything like "${filt.q.trim()}" right now. Try another tier, or list your own.` : "Nobody is selling that right now. Try another kind or tier, or list your own.",
          action: h("button.btn.btn-sm", { type: "button", onClick: clearFilters }, "Clear filters"),
          small: false,
        })
        : emptyState({
          icon: "market",
          title: "The market is quiet",
          text: "Nobody has anything up for sale. Be the first.",
          action: h("button.btn.btn-sm", { type: "button", onClick: () => openPopup("sell", ctx) }, iconEl("tag"), "Sell an item"),
          small: false,
        }));
      return;
    }

    // The pools first: a commodity book is what most of a market is.
    shown = [...board.pools.map(poolRow), ...board.rows.map(shelfRow)];
    listBox.replaceChildren(
      h("div.listing-head", { role: "row" },
        h("span", { role: "columnheader" }, "Item"),
        h("span.num", { role: "columnheader" }, "Price")),
      ...shown.map((s) => s.node));
    paintClock(true);
  }

  /* One row an item key, not one a seller: how many are to be had, what the cheapest of
     them costs, and the bands behind it. Which camps they came out of is not on this page
     and does not come back from the realm. */
  function poolRow(row) {
    const bands = bandsOf(row);
    const name = String(row.item_name || "Goods");
    const depth = poolDepth(bands);
    const total = Math.max(depth, Math.floor(num(row.qty_left)));
    /* The row is the button: a Buy at the end of a line you already have to read is
       a second thing to aim at for the same result. */
    const node = h("button.listing", {
      type: "button", role: "row", "data-act": "open",
      dataset: { key: String(row.item_key) },
      "aria-label": `${name}, ${fmtWhole(total)} to be had from ${fmtGold(num(row.price_min))}`,
    },
      h("div.listing-item", { role: "cell" },
        itemArt(row.item_key, "common"),
        h("div.lr-main",
          h("span.lr-title.listing-name", name),
          h("div.lr-sub", kindLine(row)))),
      h("div.listing-price", { role: "cell" }, fmtGold(num(row.price_min)), h("small", `${fmtWhole(total)} to be had`)));
    return { row, node, buy: null, time: null, pool: true, bands, id: `pool:${row.item_key}` };
  }

  /* One row a base, not one a piece: the sword once, at the cheapest it can be had for, with
     what is actually on the shelf underneath. The art carries the dearest rarity standing
     there, so a shelf with one Legendary on it looks like one from across the page. Opening it
     is the only way to buy: every piece has its own price and its own listing. */
  function shelfRow(row) {
    const base = String(row.item_base || "");
    const rars = rarsOf(row);
    const d = itemDef(base);
    const name = d ? d.name : String(row.item_name || "Goods");
    const lots = Math.max(1, Math.floor(num(row.lots)));
    const top = topRarity(rars);
    const own = Math.floor(num(row.mine_lots)) > 0;
    const qty = Math.floor(num(row.qty_left));
    const node = h("button.listing", {
      type: "button", role: "row", "data-act": "open",
      class: { "is-mine": own },
      dataset: { base },
      "aria-label": `${name}, ${fmtWhole(qty)} on the shelf from ${fmtGold(num(row.price_min))}`,
    },
      h("div.listing-item", { role: "cell" },
        itemArt(base, top),
        h("div.lr-main",
          h("span.lr-title.listing-name", { class: top !== "common" && `rar-${top}` }, name),
          h("div.lr-sub", kindLine(row)))),
      // No "Yours" badge: a pill that isn't a button reads as one. The row's own
      // tint and left accent (.listing.is-mine) carry it instead.
      h("div.listing-price", { role: "cell" }, fmtGold(num(row.price_min)), h("small", `${fmtWhole(qty)} on the shelf`)));
    return { row, node, buy: null, time: null, shelf: true, own, rars, base, id: `base:${base}` };
  }

  // Time left and pending buttons, once a second (and right after a rebuild).
  function paintClock(force = false) {
    const second = Math.floor(ctx.now / 1000);
    if (!force && second === lastSecond) return false;
    lastSecond = second;
    const now = ctx.now;
    shown.forEach((s) => {
      // A pool and a shelf have no one expiry: the listings under them come and go on their own.
      const left = s.pool || s.shelf ? 1 : when(s.row.expires_at) - now;
      if (s.time) setText(s.time, left > 0 ? `${fmtTime(left)} left` : "Expired");
      const wait = pending.has(s.id);
      // A board row is its own button now; a shelf row has none of its own at all.
      const btn = s.buy || s.node;
      toggleClass(btn, "is-loading", wait);
      if (btn.tagName === "BUTTON") btn.disabled = wait || left <= 0;
    });
    mineShown.forEach((s) => {
      const left = when(s.row.expires_at) - now;
      setText(s.sub, mineSub(s.row, now));
      if (s.cancel) {
        const wait = pending.has(String(s.row.id));
        toggleClass(s.cancel, "is-loading", wait);
        s.cancel.disabled = wait || left <= 0;
        s.cancel.hidden = left <= 0;
      }
    });
    return true;
  }

  /* ---------- my listings ---------- */

  function mineSub(row, now) {
    const qty = num(row.qty);
    const left = num(row.qty_left);
    const status = liveStatus(row, now);
    if (status === "open") return `${fmtWhole(left)} of ${fmtWhole(qty)} left · ${fmtTime(when(row.expires_at) - now)} to go`;
    if (status === "sold") return `All ${fmtWhole(qty)} sold · ${fmtAgo(now - when(row.updated_at || row.created_at))}`;
    if (status === "expired") return `${fmtWhole(left)} of ${fmtWhole(qty)} unsold, back by post · ${fmtAgo(now - when(row.updated_at || row.expires_at))}`;
    return `${fmtWhole(left)} of ${fmtWhole(qty)} taken back · ${fmtAgo(now - when(row.updated_at || row.created_at))}`;
  }

  // An open listing past its time is already on its way home.
  function liveStatus(row, now) {
    const status = STATUS[row.status] ? row.status : "open";
    return status === "open" && when(row.expires_at) <= now ? "expired" : status;
  }

  function paintMine() {
    if (mine.error && !mine.rows) {
      mine.sig = "error";
      mineShown = [];
      mineBox.replaceChildren(failState(mine.error, () => { mine.error = null; paintMine(); loadMine(); }));
      return;
    }
    if (!mine.rows) {
      mine.sig = "loading";
      mineShown = [];
      mineBox.replaceChildren(skeletonList(2));
      return;
    }
    const now = ctx.now;
    const open = mine.rows.filter((r) => liveStatus(r, now) === "open").length;
    setText(mineChip, `${fmtWhole(open)} of ${fmtWhole(E.marketMaxListings)} open`);
    toggleClass(mineChip, "chip-warn", open >= E.marketMaxListings);

    const sig = mine.rows.map((r) => `${r.id}:${liveStatus(r, now)}:${r.qty_left}`).join(",");
    if (sig === mine.sig) return;
    mine.sig = sig;

    if (!mine.rows.length) {
      mineShown = [];
      mineBox.replaceChildren(emptyState({
        icon: "tag",
        title: "Nothing listed",
        text: "Open anything in Belongings, the Stockpile or the Vault and choose List on the market.",
        action: h("button.btn.btn-sm", { type: "button", onClick: () => openPopup("sell", ctx) }, "Sell an item"),
      }));
      return;
    }

    mineShown = mine.rows.map((row) => {
      const status = liveStatus(row, now);
      const [label, tone] = STATUS[status];
      const qty = Math.max(1, num(row.qty));
      const sold = qty - num(row.qty_left);
      const sub = h("div.lr-sub");
      const cancel = status === "open"
        ? h("button.btn.btn-quiet.btn-sm", { type: "button", "data-act": "cancel", "aria-label": `Take ${row.item_name} off the market` }, "Remove")
        : null;
      // How much of it has sold, as the kit's thin gold bar.
      let bar = null;
      if (status === "open" || status === "sold") {
        const fill = h("i");
        setWidth(fill, (sold / qty) * 100);
        bar = h("div.bar.bar-gold.bar-thin.mt-2", { role: "img", "aria-label": `${fmtWhole(sold)} of ${fmtWhole(qty)} sold` }, fill);
      }
      const node = h("div.list-row.stack-sm", { dataset: { id: String(row.id) } },
        itemArt(row.item_key, rarityOf(row)),
        h("div.lr-main",
          h("div.lr-title", `${row.item_name} · ${fmtGold(num(row.price_each))} each`),
          sub,
          bar),
        // "Open" needs no badge: the Remove button already says the listing is live.
        // Sold, Expired and Taken back still carry something worth reading.
        h("div.lr-end", status === "open" ? null : h("span.tag", { class: tone }, label), cancel));
      return { row, node, sub, cancel };
    });
    mineBox.replaceChildren(h("div.list", mineShown.map((s) => s.node)));
    paintClock(true);
  }

  /* ---------- recent sales ---------- */

  function paintTrades() {
    if (trades.error && !trades.rows) {
      trades.sig = "error";
      tradesBox.replaceChildren(failState(trades.error, () => { trades.error = null; paintTrades(); loadTrades(); }));
      return;
    }
    if (!trades.rows) {
      trades.sig = "loading";
      tradesBox.replaceChildren(skeletonList(3));
      return;
    }
    // Minute-grained "ago" texts: rebuilding when they change is cheap and rare.
    const now = ctx.now;
    const sig = `${Math.floor(now / 60000)}|${trades.rows.map((r) => r.id).join(",")}`;
    if (sig === trades.sig) return;
    trades.sig = sig;

    if (!trades.rows.length) {
      tradesBox.replaceChildren(emptyState({ icon: "coin-stack", title: "No trades yet", text: "What you sell and what you buy shows up here." }));
      return;
    }

    // side is the realm's word for which end of the trade this camp was on. Never who was on
    // the other one: a sale says what moved and what it cost, and nothing about the stranger.
    tradesBox.replaceChildren(h("div.list", trades.rows.map((r) => {
      const qty = num(r.qty);
      const each = num(r.price_each);
      const goods = qty * each;
      const fee = num(r.fee);
      const ago = fmtAgo(now - when(r.created_at));
      return r.side === "sold"
        ? h("div.list-row",
          h("div.art.art-sm", { "data-tone": "gold", "aria-hidden": "true" }, iconEl("coin")),
          h("div.lr-main",
            h("div.lr-title", `Sold ${fmtWhole(qty)} ${r.item_name}`),
            h("div.lr-sub", `${fmtWhole(qty)} × ${fmtGold(each)} = ${fmtGold(goods)} · the market kept ${fmtGold(fee)} · ${ago}`)),
          h("div.lr-end", h("span.price", `+${fmtGold(goods - fee)}`)))
        : h("div.list-row",
          itemArt(r.item_key, itemRarity(r.item_key)),
          h("div.lr-main",
            h("div.lr-title", `Bought ${fmtWhole(qty)} ${r.item_name}`),
            h("div.lr-sub", `${fmtWhole(qty)} × ${fmtGold(each)} + ${fmtGold(fee)} fee · ${ago}`)),
          h("div.lr-end", h("span.price.is-short", `−${fmtGold(goods + fee)}`)));
    })));
  }

  function itemRarity(key) {
    const d = itemDef(key);
    return d && d.kind !== "material" && d.rarity ? d.rarity : "common";
  }

  /* ---------- buying ---------- */

  function landing(key) {
    const w = placeFor(ctx.state, key);
    return w ? `It goes ${INTO[w]}.` : "Belongings, the Stockpile and the Vault are all full: make room first.";
  }

  // The market's cut is on top of the asking price, so this is what the purse pays.
  const feeLine = (goods) => `${fmtGold(goods)} + ${fmtGold(marketFee(goods))} fee = ${fmtGold(goods + marketFee(goods))}`;

  async function send(id, type, args, done) {
    pending.add(id);
    paintClock(true);
    let res;
    try {
      res = await ctx.dispatch(type, args);
    } catch (err) {
      res = { ok: false };
      toast("The market did not answer", { kind: "warn" });
    }
    pending.delete(id);
    if (res && res.ok) done(res.data || {});
    if (!alive) return res;
    paintClock(true);
    refreshAll();
    return res;
  }

  function sendBuy(row, qty) {
    const each = num(row.price_each);
    return send(String(row.id), "marketBuy", { listingId: num(row.id), qty }, (data) => {
      const got = Number.isFinite(data.qty) ? data.qty : qty;
      const cost = Number.isFinite(data.cost) ? data.cost : qty * each + marketFee(qty * each);
      toast(`Bought ${fmtWhole(got)} ${row.item_name} for ${fmtGold(cost)}`, { kind: "gold", icon: "market" });
    });
  }

  /* A pool buy carries the ceiling the player was shown, so a band drained between the
     drawing and the press is refused rather than charged for. A short fill is normal and
     says so in as many words. */
  function sendPoolBuy(row, qty, maxEach) {
    const name = String(row.item_name);
    return send(`pool:${row.item_key}`, "marketBuyPool", { key: row.item_key, qty, maxEach }, (data) => {
      const got = Number.isFinite(data.qty) ? data.qty : qty;
      const cost = Number.isFinite(data.cost) ? data.cost : 0;
      const short = data.short === true && got < qty;
      toast(short
        ? `Bought ${fmtWhole(got)} of ${fmtWhole(qty)} ${name} for ${fmtGold(cost)}: that was all at your price`
        : `Bought ${fmtWhole(got)} ${name} for ${fmtGold(cost)}`, { kind: "gold", icon: "market" });
    });
  }

  async function buyListing(row) {
    const left = Math.max(0, Math.floor(num(row.qty_left)));
    const each = num(row.price_each);
    const name = String(row.item_name);
    if (left < 1 || pending.has(String(row.id))) return;

    // One thing (or the last of a stack): straight to the confirmation.
    if (left === 1 || !stacks(row.item_key)) {
      const ok = await confirmSpend(ctx, {
        title: `Buy ${name}?`,
        body: `${landing(row.item_key)} ${feeLine(each)}.`,
        gold: each + marketFee(each),
        confirmText: `Buy for ${fmtGold(each + marketFee(each))}`,
      });
      if (ok && alive) sendBuy(row, 1);
      return;
    }

    const gold = () => Math.floor(ctx.state.player.gold);
    const paid = (n) => n * each + marketFee(n * each);
    let m = null;
    let waiting = false;
    const plan = h("p.ap-plan");
    const picker = qtyPicker({
      value: Math.max(1, Math.min(left, Math.floor(gold() / Math.max(1, each + marketFee(each))))),
      max: left,
      allowUnlimited: false,
      presets: [1, 10, 100].filter((n) => n < left),
      onChange: () => paintPlan(),
    });
    setAttr(picker.input, "aria-label", `How many ${name} to buy`);

    function paintPlan() {
      const n = picker.pick.n;
      const total = paid(n);
      const have = gold();
      plan.replaceChildren(
        h("span", h("b", `${fmtWhole(n)} × ${name}`), ` · ${feeLine(n * each)}`),
        total > have ? h("span.t-warn", `Short by ${fmtGold(total - have)}`) : h("span", `${fmtGold(have - total)} left after`));
      if (m && m.buttons[1]) setText(m.buttons[1].lastChild, `Buy for ${fmtGold(total)}`);
    }

    async function go() {
      if (waiting) return;
      const n = picker.pick.n;
      const ok = await confirmSpend(ctx, {
        title: `Buy ${fmtWhole(n)} ${name}?`,
        body: `${landing(row.item_key)} ${feeLine(n * each)}.`,
        gold: paid(n),
        confirmText: `Buy for ${fmtGold(paid(n))}`,
      });
      if (!ok || m.closed) return;
      waiting = true;
      m.buttons.forEach((b) => { b.disabled = true; });
      toggleClass(m.buttons[1], "is-loading", true);
      await sendBuy(row, n);
      if (!m.closed) m.close("action");
    }

    const rarity = rarityOf(row);
    const d = itemDef(row.item_key);
    m = openModal({
      title: `Buy ${name}`,
      sub: `${fmtWhole(left)} left · ${fmtGold(each)} each, plus the market's ${FEE_PCT}%`,
      art: d ? d.icon : "market",
      artRarity: rarity !== "common" ? rarity : null,
      artTone: "gold",
      size: "sm",
      body: [h("div.ap-block", h("div.eyebrow", "How many"), picker.node), plan],
      actions: [
        { label: "Cancel", kind: "quiet" },
        { label: "Buy", kind: "gold", icon: "coin", onClick: () => { go(); return false; } },
      ],
    });
    paintPlan();
  }

  /* Buying out of a pool. The sheet walks the bands the realm sent with the same rule the
     realm fills by (fillPool: cheapest first, oldest first among equals), so the price on
     screen is the price charged, and the dearest band the walk reaches is the ceiling the
     command carries. */
  async function buyPool(entry) {
    const row = entry.row;
    const bands = entry.bands;
    const name = String(row.item_name);
    const depth = poolDepth(bands);
    if (depth < 1 || pending.has(entry.id)) return;

    const gold = () => Math.floor(ctx.state.player.gold);
    const rows = bands.map((b, i) => ({ id: i, priceEach: b.each, qtyLeft: b.qty, at: i }));
    const ceiling = bands[bands.length - 1].each;
    const walk = (n) => fillPool(rows, { qty: Math.max(1, Math.min(depth, n)), maxEach: ceiling });

    let m = null;
    let waiting = false;
    const plan = h("p.ap-plan");
    const picker = qtyPicker({
      value: Math.max(1, Math.min(depth, Math.floor(gold() / Math.max(1, bands[0].each)))),
      max: depth,
      allowUnlimited: false,
      presets: [1, 10, 100].filter((n) => n < depth),
      onChange: () => paintPlan(),
    });
    setAttr(picker.input, "aria-label", `How many ${name} to buy`);

    function paintPlan() {
      const res = walk(picker.pick.n);
      const d = res.ok ? res.data : null;
      const have = gold();
      const total = d ? d.total : 0;
      const prices = d && d.fills.length > 1 ? `${fmtGold(d.fills[0].priceEach)} to ${fmtGold(d.dearest)}` : fmtGold(d ? d.dearest : 0);
      plan.replaceChildren(
        h("span", h("b", `${fmtWhole(d ? d.units : 0)} × ${name}`), ` · ${prices} · ${d ? feeLine(d.goods) : ""}`),
        total > have ? h("span.t-warn", `Short by ${fmtGold(total - have)}`) : h("span", `${fmtGold(have - total)} left after`));
      if (m && m.buttons[1]) setText(m.buttons[1].lastChild, `Buy for ${fmtGold(total)}`);
    }

    async function go() {
      if (waiting) return;
      const res = walk(picker.pick.n);
      if (!res.ok) return;
      const d = res.data;
      const ok = await confirmSpend(ctx, {
        title: `Buy ${fmtWhole(d.units)} ${name}?`,
        body: `${landing(row.item_key)} ${feeLine(d.goods)}. Nothing over ${fmtGold(d.dearest)} each is touched, so a band somebody else empties first is left alone.`,
        gold: d.total,
        confirmText: `Buy for ${fmtGold(d.total)}`,
      });
      if (!ok || m.closed) return;
      waiting = true;
      m.buttons.forEach((b) => { b.disabled = true; });
      toggleClass(m.buttons[1], "is-loading", true);
      await sendPoolBuy(row, d.units, d.dearest);
      if (!m.closed) m.close("action");
    }

    const def = itemDef(row.item_key);
    m = openModal({
      title: `Buy ${name}`,
      sub: `${fmtWhole(Math.max(depth, Math.floor(num(row.qty_left))))} on the market · from ${fmtGold(num(row.price_min))} each`,
      art: def ? def.icon : "market",
      artTone: "gold",
      size: "sm",
      body: [
        h("div.ap-block", h("div.eyebrow", "Price bands"), h("p.modal-note", bandText(bands, bands.length))),
        h("div.ap-block", h("div.eyebrow", "How many"), picker.node),
        plan,
      ],
      actions: [
        { label: "Cancel", kind: "quiet" },
        { label: "Buy", kind: "gold", icon: "coin", onClick: () => { go(); return false; } },
      ],
    });
    paintPlan();
  }

  /* ---------- what is on a shelf ---------- */

  /* The sheet behind a shelf row: every open lot of that base, cheapest first, each with its
     own rarity, what the Veil has been worked into it, its price and its time left. This is
     where a buy happens -- a shelf is a way of reading the market, not a thing to buy -- so
     each row carries the same Buy this page has always had, and Remove on your own. It asks
     the realm again every time it opens, because a shelf drawn thirty seconds ago is a
     promise nobody made. */
  async function openShelf(entry) {
    const base = entry.base;
    const d = itemDef(base);
    const name = d ? d.name : String(entry.row.item_name || "Goods");
    const floor = FLOORS.find((f) => f.id === filt.rarity);
    const box = h("div");
    let m = null;
    let lots = [];

    function draw() {
      if (!lots.length) {
        box.replaceChildren(emptyState({
          icon: "market",
          title: "Nothing left on it",
          text: "Every piece here has been bought or taken back. The shelf will fill again.",
        }));
        return;
      }
      /* The book, the way a book reads: price down the left, what stands at it
         down the middle, how many at the right, and the row itself is the deal. */
      const now = ctx.now;
      box.replaceChildren(
        h("div.book-head", { role: "row" },
          h("span", { role: "columnheader" }, "Price"),
          h("span", { role: "columnheader" }, "Piece"),
          h("span.num", { role: "columnheader" }, "Quantity")),
        h("div.book", { role: "table" }, lots.map((row) => {
          const rarity = rarityOf(row);
          const own = isMine(row);
          const label = String(row.item_name || name);
          const left = when(row.expires_at) - now;
          const qty = Math.max(1, Math.floor(num(row.qty_left)));
          const each = num(row.price_each);
          const node = h("button.book-row", {
            type: "button", role: "row",
            class: { "is-mine": own },
            dataset: { id: String(row.id), act: own ? "cancel" : "buy" },
            "aria-label": own
              ? `Yours: ${fmtWhole(qty)} ${label} at ${fmtGold(each)} each. Take off the market`
              : `Buy ${fmtWhole(qty)} ${label} at ${fmtGold(each)} each`,
          },
            h("span.book-price", { role: "cell" }, fmtGold(each)),
            h("span.book-what", { role: "cell" },
              h("span.book-name", { class: rarity !== "common" && `rar-${rarity}` }, label),
              h("span.book-sub", `${rarityDef(rarity).name} · ${left > 0 ? `${fmtTime(left)} left` : "Expired"}`)),
            h("span.book-qty", { role: "cell" }, fmtWhole(qty)),
            own ? h("span.book-act", "Remove") : null);
          node.disabled = pending.has(String(row.id)) || left <= 0;
          return node;
        })));
    }

    async function pull() {
      const res = await ask(() => ctx.net.market.baseListings({ base, rarity: filt.rarity || null, limit: SHELF_ROWS }));
      if (!m || m.closed) return;
      if (res.error) {
        box.replaceChildren(failState(res.error, () => { box.replaceChildren(skeletonList(3)); pull(); }));
        return;
      }
      lots = Array.isArray(res.rows) ? res.rows : [];
      draw();
    }

    const off = on(box, "click", "[data-act]", async (e, btn) => {
      const row = lots.find((r) => String(r.id) === btn.dataset.id);
      if (!row) return;
      if (btn.dataset.act === "buy") await buyListing(row);
      else if (btn.dataset.act === "cancel") await takeBack(row);
      if (m && !m.closed) pull();
    });

    m = openModal({
      title: name,
      sub: [
        `${fmtWhole(Math.floor(num(entry.row.lots)))} on the market, from ${fmtGold(num(entry.row.price_min))}`,
        floor && floor.id ? floor.label.toLowerCase() : null,
      ].filter(Boolean).join(" · "),
      art: d ? d.icon : "market",
      artRarity: topRarity(entry.rars) !== "common" ? topRarity(entry.rars) : null,
      artTone: "gold",
      size: "lg",
      body: box,
      actions: [{ label: "Close", kind: "quiet" }],
      onClose: () => off(),
    });
    box.replaceChildren(skeletonList(Math.min(4, Math.max(1, Math.floor(num(entry.row.lots))))));
    pull();
  }

  /* ---------- taking a listing back ---------- */

  async function takeBack(row) {
    const left = Math.max(0, Math.floor(num(row.qty_left)));
    const name = String(row.item_name);
    if (pending.has(String(row.id))) return;
    const ok = await confirm({
      title: `Take ${name} off the market?`,
      body: left > 1 ? `The ${fmtWhole(left)} still unsold come back to camp now.` : "It comes back to camp now.",
      confirmText: "Take it back",
    });
    if (!ok || !alive) return;
    const id = String(row.id);
    pending.add(id);
    paintClock(true);
    let res;
    try {
      res = await ctx.dispatch("marketCancel", { listingId: num(row.id) });
    } catch (err) {
      res = { ok: false };
      toast("The market did not answer", { kind: "warn" });
    }
    pending.delete(id);
    if (res && res.ok) {
      const got = res.data && Number.isFinite(res.data.qty) ? res.data.qty : left;
      toast(`${fmtWhole(got)} ${name} came back from the market`, { kind: "info", icon: "market" });
    }
    if (!alive) return;
    paintClock(true);
    refreshAll();
  }

  /* ---------- wiring ---------- */

  function paintSeg() {
    seg.querySelectorAll(".seg-btn").forEach((b) => setAttr(b, "aria-selected", b.dataset.kind === filt.kind ? "true" : "false"));
    // A pool is always cheapest first: there is no newest in a price band, so on the tabs that
    // are only pools the sort would decide nothing and is not shown.
    const k = kindDef();
    sortSel.hidden = !k.shelf;
    rarSel.hidden = !k.shelf;
  }

  function clearFilters() {
    clearTimeout(searchTimer);
    filt.q = "";
    filt.kind = "all";
    filt.tier = 0;
    filt.rarity = "";
    search.value = "";
    tierSel.value = "0";
    rarSel.value = "";
    paintSeg();
    loadListings();
  }

  const offs = [
    on(listBox, "click", "[data-act]", (e, btn) => {
      const node = btn.closest(".listing");
      let id = null;
      if (node && node.dataset.key) id = `pool:${node.dataset.key}`;
      else if (node && node.dataset.base) id = `base:${node.dataset.base}`;
      else if (node) id = node.dataset.id;
      const s = id && shown.find((x) => x.id === id);
      if (!s) return;
      // A pool has one price and buys straight off; a shelf opens, because every piece on it is its own.
      if (btn.dataset.act === "open") (s.shelf ? openShelf(s) : buyPool(s));
      else if (btn.dataset.act === "shelf") openShelf(s);
      else if (btn.dataset.act === "item") openPopup("item", ctx, s.row.item_key, { from: null, readOnly: true });
      else if (btn.dataset.act === "buy") (s.pool ? buyPool(s) : buyListing(s.row));
      else if (btn.dataset.act === "cancel") takeBack(s.row);
    }),
    on(mineBox, "click", "[data-act='cancel']", (e, btn) => {
      const node = btn.closest(".list-row");
      const s = node && mineShown.find((x) => String(x.row.id) === node.dataset.id);
      if (s) takeBack(s.row);
    }),
    on(seg, "click", ".seg-btn", (e, b) => {
      if (b.dataset.kind === filt.kind) return;
      filt.kind = b.dataset.kind;
      paintSeg();
      loadListings();
    }),
    // Tabs in a row move with the arrow keys.
    on(seg, "keydown", ".seg-btn", (e, b) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const btns = Array.from(seg.querySelectorAll(".seg-btn"));
      const next = btns[(btns.indexOf(b) + (e.key === "ArrowRight" ? 1 : btns.length - 1)) % btns.length];
      e.preventDefault();
      next.focus();
      next.click();
    }),
    ctx.on("realm:market", () => refreshAll()),
  ];

  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (search.value.trim() === filt.q.trim()) return;
      filt.q = search.value;
      loadListings();
    }, SEARCH_MS);
  });
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    clearTimeout(searchTimer);
    filt.q = search.value;
    loadListings();
  });
  tierSel.addEventListener("change", () => { filt.tier = Number(tierSel.value) || 0; loadListings(); });
  // A rarity floor is a gear question, so the tabs that are only pools lose the control with it.
  rarSel.addEventListener("change", () => {
    filt.rarity = FLOORS.some((f) => f.id === rarSel.value) ? rarSel.value : "";
    loadListings();
  });
  sortSel.addEventListener("change", () => { filt.sort = sortSel.value === "newest" ? "newest" : "price"; loadListings(); });
  // Only a refresh the player asked for spins; the quiet ones every half minute don't.
  refreshBtn.addEventListener("click", () => {
    busy(refreshBtn, true);
    refreshAll({ quiet: true }).then(() => { if (alive) busy(refreshBtn, false); });
  });

  // Every 30 seconds while the tab is seen; never under a buy still waiting on its answer.
  const timer = setInterval(() => {
    if (!alive || document.hidden || pending.size) return;
    refreshAll();
  }, REFRESH_MS);
  const onVisible = () => {
    if (!document.hidden && Date.now() - board.at >= REFRESH_MS && !pending.size) refreshAll();
  };
  document.addEventListener("visibilitychange", onVisible);

  paintSeg();
  paintMine();
  paintTrades();
  loadListings();
  loadMine();
  loadTrades();

  return {
    update() {
      // Once a second is plenty for times left and "2m ago".
      if (paintClock() && trades.rows) paintTrades();
    },
    destroy() {
      alive = false;
      clearInterval(timer);
      clearTimeout(searchTimer);
      document.removeEventListener("visibilitychange", onVisible);
      offs.forEach((off) => off());
    },
  };
}
