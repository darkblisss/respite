/* ============================================================
   Respite · pages/stockpile.js · The Stockpile
   ------------------------------------------------------------
   The camp's stores: the Stockpile and the Vault behind one
   segmented control, the tool rack (a tool for each trade) and
   a short ledger of the camp's work.

   The slot grid is built here and the Satchel page borrows it
   twice, for Belongings and for the Satchel: the toolbar (pools,
   filters, sort), capacity, five-across slots and drag to reorder.
   It only reads the save; every change is a command, and the item
   popup does the rest.

   One quirk to know: Belongings give a remedy a slot a bottle
   (storage.js), so a stack of five there is drawn as five cells of
   the same item and the capacity line agrees.
   ============================================================ */

import { h, el, on, setText, setWidth, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl, artEl, hasArt } from "../ui/icons.js";
import { hideTip } from "../ui/overlay.js";
import { fmt, fmtWhole, fmtGold } from "../ui/format.js";
import { openPopup } from "../ui/widgets.js";
import { itemDef, itemName, parseKey, canFortify } from "../../shared/items.js";
import { paintMini } from "../ui/halo.js";
import { poolName, slotCap, slotsUsed, qtyIn, orderedKeys, unstacked } from "../../shared/storage.js";
import { GameData, TRADE_ORDER, gatherSkillDef } from "../../shared/registry.js";
import { toolFor } from "../../shared/progression.js";

/* ================= 1. THE SLOT GRID ================= */

const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "gear", label: "Gear", icon: "blade", test: (d) => d.kind === "gear" },
  { id: "material", label: "Materials", icon: "ore", test: (d) => d.kind === "material" && !d.heal },
  { id: "remedy", label: "Remedies", icon: "ration", test: (d) => d.heal > 0 },
  { id: "tool", label: "Tools", icon: "pick", test: (d) => d.kind === "tool" },
];

const SORTS = [["custom", "Custom order"], ["rarity", "Rarity"], ["name", "Name"]];

// Best first; materials have no rarity and sort after gear.
const RARITY_RANK = { relic: 0, legendary: 1, epic: 2, rare: 3, uncommon: 4, common: 5 };

const HOLD_MS = 380;     // a finger held this long picks a slot up
const SLOP_MOUSE = 5;    // a mouse moved this far starts a drag
const SLOP_TOUCH = 10;   // a finger moved this far before the hold is a scroll, not a pick up
const EDGE = 56;         // near the top or bottom edge a drag scrolls the page

const phrase = (w) => (w === "inv" ? poolName(w) : `the ${poolName(w)}`);

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const rankOf = (key) => {
  const d = itemDef(key);
  return d && d.kind !== "material" && Object.hasOwn(RARITY_RANK, d.rarity) ? RARITY_RANK[d.rarity] : 6;
};

// The keys a view shows, in the order it shows them.
function visibleKeys(state, pool, view) {
  const f = FILTERS.find((x) => x.id === view.filter) || FILTERS[0];
  const keys = orderedKeys(state, pool).filter((k) => {
    const d = itemDef(k);
    return !!d && f.test(d);
  });
  if (view.sort === "rarity") keys.sort((a, b) => rankOf(a) - rankOf(b) || itemName(a).localeCompare(itemName(b)));
  else if (view.sort === "name") keys.sort((a, b) => itemName(a).localeCompare(itemName(b)));
  return keys;
}

/* One cell a slot the pool really spends: a stack is one, and a remedy in
   Belongings is one a bottle. `id` is the cell's own name (the key, or the key
   and which bottle it is), `key` the item it draws. */
function visibleCells(state, pool, view) {
  const out = [];
  visibleKeys(state, pool, view).forEach((k) => {
    const n = unstacked(pool, k) ? qtyIn(state, pool, k) : 1;
    if (n <= 1) {
      out.push({ id: k, key: k, one: false });
      return;
    }
    for (let i = 0; i < n; i++) out.push({ id: `${k}#${i}`, key: k, one: true });
  });
  return out;
}

/**
 * storageCard(ctx, { pools, view, idBase, filters, hint }) -> { node, update(ctx), destroy() }
 * pools   ["bank", "vault"] shows a segmented control; one pool a plain title.
 * view    { pool, filter, sort }: kept by the page for the session and changed here.
 * filters false leaves the filter chips out, for a pool that holds one kind.
 * hint    a line under the toolbar, for a pool that needs a word of explaining.
 */
export function storageCard(ctx, { pools, view, idBase, filters = true, hint = null }) {
  if (!pools.includes(view.pool)) view.pool = pools[0];

  const tabs = pools.length > 1
    ? pools.map((w) => h("button.seg-btn", {
      type: "button", role: "tab", id: `${idBase}Tab-${w}`, "aria-controls": `${idBase}Grid`, dataset: { pool: w },
    }, poolName(w), h("span.count")))
    : [];
  const lead = tabs.length
    ? h("div.seg", { role: "tablist", "aria-label": "Store" }, tabs)
    : h("h2.card-title", poolName(pools[0]));

  const chips = filters ? FILTERS.map((f) => h("button.chip", {
    type: "button",
    dataset: { filter: f.id },
    "aria-label": f.icon ? f.label : null,
    "data-tip": f.icon ? f.label : null,
    "data-tip-touch": f.icon ? "off" : null,
  }, f.icon ? iconEl(f.icon) : f.label)) : [];

  const sortSel = h("select.select.select-sm", { id: `${idBase}Sort`, value: view.sort },
    SORTS.map(([id, label]) => h("option", { value: id }, label)));

  const capText = h("b", { hidden: true });   // the pool tabs carry the count; the bar is the whole of it
  const capFill = h("i");
  const capacity = h("div.capacity", capText, h("div.bar.bar-thin", { "aria-hidden": "true" }, capFill));

  const emptyTitle = h("div.empty-title");
  const nothing = h("div.empty.empty-sm", { hidden: true },
    h("div.empty-art", iconEl("filter")),
    emptyTitle,
    h("button.btn.btn-sm", { type: "button", onClick: () => { view.filter = "all"; update(); } }, "Show everything"));

  const grid = h("div.slot-grid", {
    id: `${idBase}Grid`,
    role: tabs.length ? "tabpanel" : "group",
    "aria-label": tabs.length ? null : poolName(pools[0]),
  });

  const node = h("section.card.storage-main",
    h("div.toolbar",
      lead,
      chips.length ? h("div.filters", { role: "group", "aria-label": "Show" }, chips) : null,
      h("div.toolbar-end", h("label.sr-only", { for: `${idBase}Sort` }, "Sort"), sortSel)),
    hint ? h("p.card-sub", hint) : null,
    capacity,
    nothing,
    grid);

  const slots = new Map();   // cell id -> slot button, kept so focus and the popup's opener survive a reorder
  const names = new Map();   // cell id -> name, so a frame never rebuilds strings it already has
  const blanks = [];
  let gridSig = null;
  let shownPool = view.pool;

  function makeSlot(cell) {
    const d = itemDef(cell.key);
    const rarity = d.kind === "gear" || d.kind === "tool" ? d.rarity || "common" : "common";
    names.set(cell.id, itemName(cell.key));
    const node = h("button.slot", {
      type: "button", "data-rarity": rarity,
      dataset: { key: cell.key, cell: cell.id, one: cell.one ? "1" : false },
    },
      h("span.slot-qty"),
      h("span.slot-art", artEl(d, { variant: "cut" })),
      h("span.slot-name", names.get(cell.id)));
    // A worked amulet or ring glows in its slot from +9, as it does on the anvil.
    if (d.kind === "gear" && canFortify(cell.key)) paintMini(node, parseKey(cell.key).plus, d.slot);
    return node;
  }

  /* Moves only what is out of place, so a focused slot is not pulled from the page.
     A slot that changes place glides there (first, last, invert, play), so a
     reorder or a stack arriving reads as things moving rather than a redraw. */
  function reconcile(cells, empties) {
    const glide = grid.isConnected && slots.size > 0 && slots.size <= 200 && !reducedMotion();
    const before = new Map();
    if (glide) slots.forEach((n, id) => { if (n.isConnected) before.set(id, n.getBoundingClientRect()); });
    const keep = new Set(cells.map((c) => c.id));
    slots.forEach((n, id) => {
      if (keep.has(id)) return;
      n.remove();
      slots.delete(id);
      names.delete(id);
    });
    const want = cells.map((c) => {
      if (!slots.has(c.id)) slots.set(c.id, makeSlot(c));
      return slots.get(c.id);
    });
    while (blanks.length < empties) blanks.push(h("div.slot.is-empty", { "aria-hidden": "true" }));
    while (blanks.length > empties) blanks.pop().remove();
    want.concat(blanks).forEach((n, i) => {
      const at = grid.children[i];
      if (at !== n) grid.insertBefore(n, at || null);
    });
    if (!glide || !before.size) return;
    slots.forEach((n, id) => {
      const was = before.get(id);
      if (!was) return;
      const now = n.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if ((!dx && !dy) || typeof n.animate !== "function") return;
      n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 180, easing: "cubic-bezier(.2, .7, .2, 1)" });
    });
  }

  // How many are in the cell. A cell that is one bottle of an unstacked remedy is always the one.
  function paintSlot(n, state, pool) {
    const key = n.dataset.key;
    const qty = n.dataset.one ? 1 : qtyIn(state, pool, key);
    const corner = n.firstChild;
    toggleClass(corner, "slot-qty", true);
    // One of a thing is what a slot means on its own; only a count worth counting shows.
    setText(corner, qty > 1 ? fmt(qty) : "");
    setAttr(n, "aria-label", `${names.get(n.dataset.cell)}, ${fmtWhole(qty)}`);
    // The name is clipped to one line, so the whole of it lives here.
    setAttr(n, "title", names.get(n.dataset.cell));
  }

  function update(nextCtx) {
    if (nextCtx) ctx = nextCtx;
    const state = ctx.state;
    const pool = view.pool;

    if (pool !== shownPool) {
      // Another pool: its slots start fresh (the same key can sit in both).
      shownPool = pool;
      slots.forEach((n) => n.remove());
      slots.clear();
      names.clear();
      gridSig = null;
    }

    tabs.forEach((b) => {
      const w = b.dataset.pool;
      setAttr(b, "aria-selected", String(w === pool));
      setText(b.lastChild, `${slotsUsed(state, w)}/${slotCap(state, w)}`);
    });
    if (tabs.length) setAttr(grid, "aria-labelledby", `${idBase}Tab-${pool}`);
    chips.forEach((c) => setAttr(c, "aria-pressed", String(c.dataset.filter === view.filter)));
    if (sortSel.value !== view.sort) sortSel.value = view.sort;

    const used = slotsUsed(state, pool);
    const cap = slotCap(state, pool);
    setText(capText, `${fmtWhole(used)} / ${fmtWhole(cap)}`);
    setWidth(capFill, cap > 0 ? (used / cap) * 100 : 0);
    toggleClass(capacity, "is-full", used >= cap);

    const cells = visibleCells(state, pool, view);
    // With a filter on, the blanks are the pool's free slots, never padding that hides a full pool.
    const empties = Math.max(0, cap - used);
    const none = view.filter !== "all" && cells.length === 0;
    setAttr(nothing, "hidden", !none);
    setAttr(grid, "hidden", none);
    if (none) {
      const f = FILTERS.find((x) => x.id === view.filter);
      setText(emptyTitle, `No ${f.label.toLowerCase()} in ${phrase(pool)}`);
    }
    setAttr(grid, "data-reorder", view.sort === "custom");
    setAttr(grid, "data-pool", pool);

    const sig = `${pool}|${view.filter}|${view.sort}|${empties}|${cells.map((c) => c.id).join("\n")}`;
    // A drag in progress keeps the grid still; what changed lands when it ends.
    if (sig !== gridSig && !(drag && drag.active)) {
      gridSig = sig;
      reconcile(cells, empties);
    }
    slots.forEach((n) => paintSlot(n, state, pool));
  }

  on(node, "click", ".seg-btn[data-pool]", (e, b) => {
    if (view.pool === b.dataset.pool) return;
    view.pool = b.dataset.pool;
    update();
  });

  on(node, "click", ".filters .chip", (e, b) => {
    view.filter = b.dataset.filter;
    hideTip();
    update();
  });

  sortSel.addEventListener("change", () => {
    view.sort = sortSel.value;
    update();
  });

  /* ---- dragging: reorder, and move between stores ----
     Mouse: press and move. Touch: hold still, then move; a finger that moves
     first is scrolling. The lifted slot dims where it was and a copy rides
     under the pointer. Dropped on another slot, it takes that slot's place
     (custom order only, where the order is the thing on screen). Dropped on
     another store's tab, or on another grid on the page (Belongings onto the
     Satchel, say), the whole stack moves there; a single bottle of an
     unstacked remedy moves alone. The pointer is read once a frame, so a fast
     drag never queues up more work than the screen can show. */

  let drag = null;
  let clickHushUntil = 0;

  // What is under the pointer that a drop would mean something on.
  function dropAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    if (!(hit instanceof Element)) return null;
    const tab = hit.closest(".seg-btn[data-pool]");
    if (tab && tab.dataset.pool !== view.pool) return { pool: tab.dataset.pool, node: tab };
    const g = hit.closest(".slot-grid[data-pool]");
    if (g && g !== grid && g.dataset.pool && g.dataset.pool !== view.pool) return { pool: g.dataset.pool, node: g };
    if (g === grid && view.sort === "custom") {
      const s = hit.closest(".slot");
      return s && s !== drag.node ? { slot: s, node: s } : null;
    }
    return null;
  }

  function aim(next) {
    const was = drag.target;
    if ((was && was.node) === (next && next.node)) return;
    if (was) toggleClass(was.node, was.slot ? "is-dragover" : "is-droptarget", false);
    drag.target = next;
    if (next) toggleClass(next.node, next.slot ? "is-dragover" : "is-droptarget", true);
    if (drag.ghost) toggleClass(drag.ghost, "is-moving", !!(next && next.pool));
  }

  function lift() {
    drag.active = true;
    clearTimeout(drag.timer);
    hideTip();
    toggleClass(drag.node, "is-lifted", true);
    toggleClass(document.documentElement, "is-dragging-slot", true);
    const art = drag.node.querySelector(".slot-art");
    drag.ghost = h("div.drag-ghost", { "aria-hidden": "true" }, art ? art.cloneNode(true) : null);
    document.body.appendChild(drag.ghost);
    paintFrame();
  }

  // One read and one write a frame: the copy follows the pointer, the target is found under it.
  function paintFrame() {
    if (!drag || !drag.active) return;
    if (drag.ghost) drag.ghost.style.transform = `translate3d(${drag.x}px, ${drag.y}px, 0) translate(-50%, -50%)`;
    aim(dropAt(drag.x, drag.y));
  }

  function schedule() {
    if (!drag || drag.raf) return;
    drag.raf = requestAnimationFrame(() => {
      if (!drag) return;
      drag.raf = 0;
      paintFrame();
      edgeScroll();
    });
  }

  // Taking the target's place: before it when moving back, after it when moving on.
  function sendReorder(key, target) {
    const state = ctx.state;
    const pool = view.pool;
    if (qtyIn(state, pool, key) <= 0) return;
    // Two cells of the same unstacked stack: there is nothing between them to move.
    if (target.dataset.key === key) return;
    const full = orderedKeys(state, pool);
    const from = full.indexOf(key);
    let before = null;
    if (target.dataset.key) {
      const to = full.indexOf(target.dataset.key);
      if (from < 0 || to < 0) return;
      before = from > to ? full[to] : full[to + 1] || null;
    }
    if (before === key || (before === null && from === full.length - 1)) return;
    ctx.dispatch("reorder", { pool, key, before });
  }

  // The whole stack to another store, or the one bottle a cell stands for. A refusal
  // (the Satchel takes remedies only, a full store) says so in a toast.
  function sendMove(node, to) {
    const key = node.dataset.key;
    if (qtyIn(ctx.state, view.pool, key) <= 0) return;
    ctx.dispatch("moveItem", { key, from: view.pool, to, qty: node.dataset.one ? 1 : null });
  }

  function endDrag(drop) {
    if (!drag) return;
    const d = drag;
    drag = null;
    clearTimeout(d.timer);
    cancelAnimationFrame(d.frame);
    cancelAnimationFrame(d.raf);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    document.removeEventListener("keydown", onKey, true);
    if (!d.active) return;
    // The press that ended a drag is not also a click on the slot.
    clickHushUntil = performance.now() + 500;
    toggleClass(d.node, "is-lifted", false);
    toggleClass(document.documentElement, "is-dragging-slot", false);
    if (d.target) toggleClass(d.target.node, d.target.slot ? "is-dragover" : "is-droptarget", false);
    const t = drop ? d.target : null;
    if (d.ghost) {
      // A move flies the copy into the store it went to; anything else just lets go.
      if (t && t.pool && !reducedMotion()) {
        const r = t.node.getBoundingClientRect();
        d.ghost.classList.add("is-landing");
        d.ghost.style.transform = `translate3d(${r.left + r.width / 2}px, ${r.top + r.height / 2}px, 0) translate(-50%, -50%) scale(.4)`;
        setTimeout(() => d.ghost.remove(), 220);
      } else {
        d.ghost.remove();
      }
    }
    if (t && t.slot) sendReorder(d.node.dataset.key, t.slot);
    else if (t && t.pool) sendMove(d.node, t.pool);
    update();
  }

  function edgeScroll() {
    if (!drag || !drag.active || drag.frame) return;
    const bar = el("topbar");
    const top = (bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0) + EDGE;
    const bottom = window.innerHeight - EDGE;
    let speed = 0;
    if (drag.y < top) speed = -Math.min(18, Math.ceil((top - drag.y) / 3));
    else if (drag.y > bottom) speed = Math.min(18, Math.ceil((drag.y - bottom) / 3));
    if (!speed) return;
    drag.frame = requestAnimationFrame(() => {
      if (!drag) return;
      drag.frame = 0;
      window.scrollBy(0, speed);
      paintFrame();
      edgeScroll();
    });
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.active) {
      const dist = Math.hypot(drag.x - drag.x0, drag.y - drag.y0);
      if (drag.touch) {
        if (dist > SLOP_TOUCH) endDrag(false);
        return;
      }
      if (dist <= SLOP_MOUSE) return;
      lift();
      return;
    }
    schedule();
  }

  const onUp = (e) => { if (drag && e.pointerId === drag.id) endDrag(true); };
  const onCancel = (e) => { if (drag && e.pointerId === drag.id) endDrag(false); };
  const onKey = (e) => {
    if (drag && drag.active && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      endDrag(false);
    }
  };

  // Any order can be dragged to another store; only the custom order can be reordered.
  grid.addEventListener("pointerdown", (e) => {
    if (drag || e.button > 0 || !e.isPrimary) return;
    const n = e.target instanceof Element ? e.target.closest(".slot[data-key]") : null;
    if (!n || !grid.contains(n)) return;
    drag = {
      node: n, id: e.pointerId, touch: e.pointerType !== "mouse",
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      active: false, target: null, timer: 0, frame: 0, raf: 0, ghost: null,
    };
    if (drag.touch) drag.timer = setTimeout(() => { if (drag && !drag.active) lift(); }, HOLD_MS);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey, true);
  });

  // Once a slot is lifted the finger drags it instead of the page.
  const holdScroll = (e) => { if (drag && drag.active && e.cancelable) e.preventDefault(); };
  grid.addEventListener("touchmove", holdScroll, { passive: false });
  grid.addEventListener("contextmenu", (e) => { if (drag && drag.touch) e.preventDefault(); });

  grid.addEventListener("click", (e) => {
    if (performance.now() >= clickHushUntil) return;
    clickHushUntil = 0;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  on(grid, "click", ".slot[data-key]", (e, n) => {
    openPopup("item", ctx, n.dataset.key, { from: view.pool });
  });

  update();

  return {
    node,
    update,
    destroy() { endDrag(false); },
  };
}

/* ================= 2. THE TOOL RACK ================= */

function rackRow(state, g) {
  const tool = toolFor(state, g.id);
  if (!tool) {
    return h("div.list-row",
      h("div.art.art-sm", { "data-tone": "neutral", "aria-hidden": "true" }, iconEl(g.icon)),
      h("div.lr-main", h("div.lr-title", "Bare hands"), h("div.lr-sub", g.name)));
  }
  const name = itemName(tool.id);
  // The chip is a fact, not a control, so the row keeps one line on phones.
  return h("div.list-row",
    h("div.art.art-sm", { class: { "art-paint": hasArt(tool) }, "aria-hidden": "true" }, artEl(tool, { variant: "cut" })),
    h("div.lr-main", h("div.lr-title", name), h("div.lr-sub", g.name)),
    h("div.lr-end",
      h("span.chip.chip-good", `+${Math.round(tool.speed * 100)}% speed`),
      h("button.btn.btn-quiet.btn-sm", { type: "button", dataset: { stow: g.id }, "aria-label": `Stow the ${name}` }, "Stow")));
}

function toolRack(ctx) {
  const list = h("div.list");
  const node = h("section.card",
    h("div.card-head", h("div",
      h("h2.card-title", "Tools in hand"),
      h("p.card-sub", "One for each trade. Take up another and the old one is put away."))),
    list);
  let sig = null;

  on(list, "click", "[data-stow]", (e, b) => { ctx.dispatch("unequipTool", { skillId: b.dataset.stow }); });

  return {
    node,
    update(nextCtx) {
      ctx = nextCtx;
      const state = ctx.state;
      const next = TRADE_ORDER.map((id) => (toolFor(state, id) || { id: "" }).id).join(",");
      if (next === sig) return;
      sig = next;
      list.replaceChildren(...TRADE_ORDER.map((id) => rackRow(state, gatherSkillDef(id))));
    },
  };
}

/* ================= 3. THE LEDGER ================= */

/* What the CAMP has done. Kills, falls and Sovereigns are the vanguard's own record,
   not the camp's, and they are on the Character page where they belong. */
const LEDGER = [
  ["Gold on hand", (s) => fmtGold(s.player.gold), "gold"],
  ["Gold earned", (s) => fmtGold(s.stats.goldEarned)],
  ["Crafted", (s) => fmtWhole(s.stats.crafted)],
  ["Actions worked", (s) => fmtWhole(s.stats.actions)],
];

function campLedger() {
  const cells = LEDGER.map(([, , tone]) => h("span.v", { class: tone && `t-${tone}` }));
  const node = h("section.card",
    h("div.card-head", h("div", h("h2.card-title", "Camp ledger"))),
    h("div.stats", LEDGER.map(([label], i) => h("div.stat", h("span.l", label), cells[i]))));
  return {
    node,
    update(ctx) {
      LEDGER.forEach(([, read], i) => setText(cells[i], read(ctx.state)));
    },
  };
}

/* ================= 4. THE PAGE ================= */

// Which pool, filter and sort the page shows, for the length of the session.
const VIEW = { pool: "bank", filter: "all", sort: "custom" };

export default {
  id: "stockpile",
  title: () => "Stockpile",
  group: "The Camp",

  mount(view, ctx) {
    const store = storageCard(ctx, { pools: ["bank", "vault"], view: VIEW, idBase: "stock" });
    const rack = toolRack(ctx);
    const ledger = campLedger();

    view.appendChild(h("div.page",
      h("header.page-head", h("div",
        h("div.eyebrow.page-eyebrow", "The Camp"),
        h("h1.page-title", "Stockpile"),
        h("p.page-sub", "Materials, reagents and the odd find. When the Stockpile is full, the Vault takes the rest."))),
      h("div.storage",
        store.node,
        h("aside.storage-side", { "aria-label": "Tools and ledger" }, rack.node, ledger.node))));

    const update = (next) => {
      store.update(next);
      rack.update(next);
      ledger.update(next);
    };
    update(ctx);

    return {
      update,
      unmount() { store.destroy(); },
    };
  },
};
