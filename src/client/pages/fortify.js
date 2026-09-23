/* ============================================================
   Respite · pages/fortify.js · The Anvil
   ------------------------------------------------------------
   The forge, laid out the way a forge is: the piece in the middle
   of the circle, three essence sockets and a charm socket round
   it, the odds and the press under it, and two racks of stock down
   the side. Nothing is on the anvil when you arrive and no essence
   is staked: you put them there, by dragging or by clicking, and
   the numbers follow what is in the sockets.

   Convert shares the circle: a worked piece on the left, an
   unworked one of the same slot on the right, a toll, one press.

   Every number is the rules' own (enchantPlan, enchantChance,
   convertPlan off world.js); this only stages it. Nothing here is
   kept in the save: what is on the anvil lasts as long as the tab.
   ============================================================ */

import { CONFIG } from "../../shared/config.js";
import { GameData, essenceOfTier, charmOfTier } from "../../shared/registry.js";
import { itemDef, itemName, parseKey, canFortify, haloOf, rarityName } from "../../shared/items.js";
import { enchantPlan, enchantChance, convertPlan, convertToll, shopStock } from "../../shared/world.js";
import { orderedKeys, qtyIn, haveQty, poolName } from "../../shared/storage.js";
import { h, on, setText, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl, artEl, hasArt } from "../ui/icons.js";
import { toast, tooltip, tipBody } from "../ui/overlay.js";
import { confirmSpend } from "../ui/widgets.js";
import { fmt, fmtWhole, fmtGold, fmtAgo } from "../ui/format.js";
import { haloTag, haloTagClass, plusPlate, paintPlate, haloNode, paintHalo, paintMini } from "../ui/halo.js";

const EN = CONFIG.enchant;
const SPARE_POOLS = ["inv", "bank", "vault"];

// Beams take a second to converge; the stamp stays up long enough to read.
const STRIKE_MS = 1000;
const REST_MS = 2600;
const LOG_LINES = 8;

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ================= 1. NUMBERS AND WORDS ================= */

// "100%", "42.9%", "3.33%", "0.033%": the odds, with the digits that matter at that size.
function pct(share) {
  const r = Math.max(0, Math.min(1, Number(share) || 0)) * 100;
  if (r >= 100) return "100%";
  if (r >= 10) return `${r.toFixed(1)}%`;
  if (r >= 0.1) return `${r.toFixed(2)}%`;
  return `${r.toFixed(3)}%`;
}

const oddsTone = (share) => (share >= 0.5 ? "t-good" : share >= 0.15 ? "t-warn" : "t-bad");
const slotWord = (d) => (d && d.slot === "neck" ? "amulet" : "ring");
// The name without its "+N": the plate beside it says the level.
const bareName = (key) => itemName(key).replace(/ \+\d+$/, "");
const level = (key) => parseKey(key).plus;
const bandOf = (key) => {
  const d = itemDef(key);
  return d ? { stone: essenceOfTier(d.tier), charm: charmOfTier(d.tier) } : null;
};

/* Every amulet and ring in the camp, worn first, then the pools in their own
   order. `at` is what the rules want as `from`: the slot worn, or the pool. */
function pieces(state) {
  const out = [];
  EN.slots.forEach((slot) => {
    const key = state.equipment[slot];
    if (key && canFortify(key)) out.push({ key, at: slot, worn: true, qty: 1 });
  });
  SPARE_POOLS.forEach((w) => {
    orderedKeys(state, w).forEach((key) => {
      const d = itemDef(key);
      if (d && d.kind === "gear" && canFortify(key)) out.push({ key, at: w, worn: false, qty: qtyIn(state, w, key) });
    });
  });
  return out;
}

// The stock rack: the three essences on one row, the three charms under them,
// held or not, weakest band first.
function stock(state) {
  const bands = GameData.VEIL_BANDS;
  return bands.map((band) => ({ key: band.essence, kind: "essence", band: band.key, qty: haveQty(state, band.essence) }))
    .concat(bands.map((band) => ({ key: band.charm, kind: "charm", band: band.key, qty: haveQty(state, band.charm) })));
}

const samePiece = (a, b) => !!(a && b && a.key === b.key && a.at === b.at);
const findPiece = (list, p) => (p ? list.find((x) => samePiece(x, p)) || null : null);

/* ================= 2. THE PAGE ================= */

export default {
  id: "fortify",
  title: () => "Fortify",
  group: "The Camp",

  mount(view, ctx) {
    let mode = "fortify";        // "fortify" | "convert"
    let sel = null;              // { key, at } on the anvil: nothing, until you put something there
    /* What is in each hole, by item key. Holes fill in any order and hold what
       they are given, so the essence can go down before the piece does. */
    let held = { 1: null, 2: null, 3: null, charm: null };
    let phase = "idle";          // idle | strike | took | refused
    let cv = { from: null, to: null };
    let cphase = "idle";         // idle | flow | done
    let drag = null;             // what the cursor is carrying: { what, key, at }
    const refusals = [];         // this visit's failures, newest first: { t, m }
    const timers = new Set();
    let dead = false;

    function later(ms, fn) {
      const id = setTimeout(() => {
        timers.delete(id);
        if (!dead) fn();
      }, reducedMotion() ? Math.min(ms, 200) : ms);
      timers.add(id);
      return id;
    }
    const wait = (ms) => new Promise((ok) => later(ms, ok));

    /* ---------- the mode ---------- */

    const segFortify = h("button.seg-btn", { type: "button", role: "tab", "aria-selected": true, onClick: () => setMode("fortify") }, "Fortify");
    const segConvert = h("button.seg-btn", { type: "button", role: "tab", "aria-selected": false, onClick: () => setMode("convert") }, "Convert");
    const seg = h("div.seg", { role: "tablist", "aria-label": "Rite" }, segFortify, segConvert);

    function setMode(next) {
      if (mode === next || phase !== "idle" || cphase !== "idle") return;
      mode = next;
      setAttr(segFortify, "aria-selected", mode === "fortify");
      setAttr(segConvert, "aria-selected", mode === "convert");
      const forge = mode === "fortify";
      fRite.hidden = !forge;
      fUnder.hidden = !forge;
      cRite.hidden = forge;
      cUnder.hidden = forge;
      stockCard.hidden = !forge;
      sigs.pieces = null;
      sigs.stock = null;
      paint();
    }

    /* ---------- the circle ---------- */

    const rings = () => [h("div.ring.ring-outer"), h("div.ring.ring-ticks"), h("div.ring.ring-runes"), h("div.ring.ring-inner")];

    const fHalo = haloNode();
    const fCore = h("div.rite-core.bracket.is-drop", { role: "img" }, h("span.rite-core-art"));
    const fPlate = plusPlate(0, "rite-plus");
    const fFx = h("div.rite-fx");
    const sockets = [1, 2, 3].map((i) => h("button.socket", {
      type: "button", class: `s${i}`, dataset: { socket: String(i) }, "aria-pressed": false,
    }, h("span.socket-art"), h("span.socket-l", "Essence")));
    const socketCharm = h("button.socket.socket-charm.s4", { type: "button", dataset: { socket: "charm" }, "aria-pressed": false },
      h("span.socket-art"), h("span.socket-l", "Charm"));
    const fRiteNode = h("div.rite", rings(), fHalo, fFx, fCore, fPlate, sockets, socketCharm);
    const fRite = h("div.rite-scale", fRiteNode);

    /* ---------- under the circle: the odds and the press ---------- */

    const oddsV = h("span.odds-v");
    const oddsSub = h("span.odds-sub");
    const help = h("button.info-btn", { type: "button", "aria-label": "How the odds and the gain work" }, iconEl("info"));
    const oddsRows = h("div.odds-strip", { role: "list" });
    const goBtn = h("button.btn.btn-primary.btn-lg.btn-block", { type: "button", onClick: () => strike() }, "Fortify");
    const fUnder = h("div.rite-under",
      h("div.odds-head",
        h("div.odds", h("span.eyebrow", "Odds of taking"), oddsV, oddsSub),
        help),
      oddsRows,
      goBtn);

    /* ---------- convert ---------- */

    const cFromHalo = haloNode();
    const cToHalo = haloNode();
    cFromHalo.classList.add("at-from");
    cToHalo.classList.add("at-to");
    const cFrom = h("div.rite-core.bracket.core-from.is-drop", { role: "img", dataset: { core: "from" } }, h("span.rite-core-art"));
    const cTo = h("div.rite-core.bracket.core-to.is-drop", { role: "img", dataset: { core: "to" } }, h("span.rite-core-art"));
    const cFromPlate = plusPlate(0, "rite-plus at-from");
    const cToPlate = plusPlate(0, "rite-plus at-to");
    const cIdle = h("div.xbeam-idle", { hidden: true });
    const cFx = h("div.rite-fx");
    const cRiteNode = h("div.rite.is-convert", rings(), cFromHalo, cToHalo,
      h("div.rite-lbl.at-from", "From"), h("div.rite-lbl.at-to", "To"),
      cIdle, cFx, cFrom, cFromPlate, cTo, cToPlate);
    const cRite = h("div.rite-scale", { hidden: true }, cRiteNode);

    const tollV = h("span.toll-v");
    const tollSub = h("span.odds-sub");
    const cHelp = h("button.info-btn", { type: "button", "aria-label": "How the toll works" }, iconEl("info"));
    const cBtn = h("button.btn.btn-gold.btn-lg.btn-block", { type: "button", onClick: () => carry() }, "Convert");
    const cUnder = h("div.rite-under", { hidden: true },
      h("div.odds-head",
        h("div.odds", h("span.eyebrow", "The toll"), tollV, tollSub),
        cHelp),
      cBtn);

    /* ---------- the cards ---------- */

    const riteSub = h("p.card-sub");
    const riteCard = h("section.card.forge-rite", { "data-tone": "violet" },
      h("div.card-head", h("div", h("h2.card-title", "The rite"), riteSub), h("div.card-actions", seg)),
      h("div.rite-wrap", fRite, cRite, fUnder, cUnder));

    const piecesGrid = h("div.slot-grid.forge-grid");
    const piecesCard = h("section.card.forge-rack",
      h("div.card-head", h("div", h("h2.card-title", "Pieces"))),
      piecesGrid);

    const stockGrid = h("div.slot-grid.forge-grid.forge-stock");
    const stockCard = h("section.card.forge-rack",
      h("div.card-head", h("div", h("h2.card-title", "Essence"))),
      stockGrid);

    const logList = h("ol.log");
    const logEmpty = h("p.small.muted", "Nothing worked yet.");
    const logCard = h("section.card.forge-log",
      h("div.card-head", h("div", h("h2.card-title", "History"))),
      logList, logEmpty);

    view.appendChild(h("div.page.fortify-page",
      h("header.page-head",
        h("div",
          h("div.eyebrow.page-eyebrow", "The Camp"),
          h("h1.page-title", "Fortify"))),
      h("div.forge",
        h("div.forge-col", riteCard, logCard),
        h("div.forge-col", piecesCard, stockCard))));

    tooltip(help, () => oddsTip(), { placement: "left" });
    tooltip(cHelp, () => tollTip(), { placement: "left" });

    /* ---------- fitting the circle ---------- */

    const fit = () => {
      [fRite, cRite].forEach((wrap) => {
        const w = wrap.clientWidth || 440;
        wrap.style.setProperty("--rite-k", String(Math.min(1, w / 440)));
      });
    };
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    if (ro) {
      ro.observe(fRite);
      ro.observe(cRite);
    } else {
      window.addEventListener("resize", fit);
    }

    /* ================= 3. PUTTING THINGS ON THE ANVIL ================= */

    /* A piece goes on the anvil; an essence goes in a hole. Either by a drag or
       by a press, because a press is faster once you know the board and a drag is
       what the hand reaches for the first time. Nothing waits on anything else:
       the holes take essence with the anvil bare, and a dragged stone lands in
       the hole it was aimed at, not the next one along. */

    // The holes, in the order a press fills them: top left, bottom middle, top right.
    const HOLES = ["2", "1", "3"];
    const inHoles = () => HOLES.map((i) => held[i]).filter(Boolean);
    // How many of the staked essence the piece on the anvil would actually take.
    const staked = (plan) => (plan ? HOLES.filter((i) => held[i] === plan.stone).length : inHoles().length);
    // Essence in a hole that this piece does not take: it counts for nothing and blocks the press.
    const strays = (plan) => (plan ? HOLES.filter((i) => held[i] && held[i] !== plan.stone).length : 0);
    const charmOn = (plan) => !!(plan && held.charm === plan.charm);

    function clearHoles() {
      held = { 1: null, 2: null, 3: null, charm: null };
    }

    function putPiece(p) {
      if (mode === "fortify") {
        if (phase !== "idle") return;
        // The holes keep what they hold: swapping the piece does not empty the anvil.
        sel = samePiece(p, sel) ? null : { key: p.key, at: p.at };
      } else {
        if (cphase !== "idle") return;
        const lv = level(p.key);
        // A worked piece gives; an unworked one of the same slot takes.
        if (lv >= 1 && !samePiece(p, cv.to)) cv = samePiece(p, cv.from) ? { from: null, to: null } : { from: p, to: cv.to };
        else cv.to = samePiece(p, cv.to) ? null : p;
        if (cv.from && cv.to && itemDef(cv.from.key).slot !== itemDef(cv.to.key).slot) cv.to = null;
      }
      sigs.pieces = null;
      paint();
    }

    /* A hole that is free, counting from the press order, or null when all three
       are taken. A stone the camp holds only one of cannot fill two holes. */
    function freeHole(row) {
      const spare = row.qty - HOLES.filter((i) => held[i] === row.key).length;
      if (spare < 1) return null;
      return HOLES.find((i) => !held[i]) || null;
    }

    // Would this hole take this stock? Free placement: the camp's stores are the only limit.
    function canHold(row, hole) {
      if (mode !== "fortify" || phase !== "idle" || !row || row.qty < 1) return false;
      if (row.kind === "charm") return hole === "charm" ? held.charm !== row.key : false;
      if (hole === "charm") return !!freeHole(row);
      return held[hole] !== row.key && (held[hole] ? true : row.qty > HOLES.filter((i) => held[i] === row.key).length);
    }

    // Anywhere at all: what the rack highlights, and what a drag is allowed to start.
    const wanted = (row) => canHold(row, "charm") || HOLES.some((i) => canHold(row, i));

    /* `hole` is the one the cursor was over; without one the press picks the first
       free hole. A charm always goes to the charm hole and an essence never does. */
    function putStock(row, hole = null) {
      if (mode !== "fortify" || phase !== "idle" || !row) return;
      if (row.qty < 1) {
        toast(`No ${itemName(row.key)} held`, { kind: "warn" });
        return;
      }
      if (row.kind === "charm") {
        held.charm = held.charm === row.key ? null : row.key;
      } else {
        const where = hole && hole !== "charm" && canHold(row, hole) ? hole : freeHole(row);
        if (!where) {
          toast(inHoles().length >= EN.maxStones ? "All three holes are full" : `Only ${fmt(row.qty)} held`, { kind: "warn" });
          return;
        }
        held[where] = row.key;
      }
      sigs.stock = null;
      paint();
    }

    on(piecesGrid, "click", "button.slot[data-key]", (e, b) => {
      putPiece({ key: b.dataset.key, at: b.dataset.at });
    });

    on(stockGrid, "click", "button.slot[data-key]", (e, b) => {
      const row = stock(ctx.state).find((x) => x.key === b.dataset.key);
      if (row) putStock(row);
    });

    // A filled hole empties itself and nothing else.
    on(fRiteNode, "click", "button.socket[data-socket]", (e, b) => {
      if (phase !== "idle") return;
      const id = b.dataset.socket;
      if (held[id]) {
        held[id] = null;
        sigs.stock = null;
        paint();
        return;
      }
      if (id === "charm") buyCharm();
    });

    /* ---- dragging ---- */

    let landed = false;   // whether the drag just ended was taken by a hole

    const dragEnd = () => {
      drag = null;
      view.querySelectorAll(".is-over").forEach((n) => n.classList.remove("is-over"));
    };

    on(view, "dragstart", "[draggable=true]", (e, b) => {
      landed = false;
      drag = b.dataset.socket
        ? { what: "socket", hole: b.dataset.socket, key: held[b.dataset.socket] }
        : { what: b.dataset.what, key: b.dataset.key, at: b.dataset.at || null };
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", drag.key || "");
      }
    });

    /* A stone let go anywhere but a hole leaves the anvil. Dropping it back on the
       hole it came from is a change of mind, and the drop handler has already put
       it there, so only a drag nothing caught empties one. */
    on(view, "dragend", "[draggable=true]", (e, b) => {
      const carried = drag;
      dragEnd();
      if (!carried || carried.what !== "socket" || landed) return;
      if (phase !== "idle" || !held[carried.hole]) return;
      held[carried.hole] = null;
      sigs.stock = null;
      paint();
    });

    /* A hole takes the stock aimed at it, a core takes a piece, and anything else
       refuses the drop. The hole under the cursor is the hole it lands in: aiming
       at the third with two empty behind it fills the third. */
    const takes = (target) => {
      if (!drag) return false;
      const hole = target.dataset.socket;
      if (drag.what === "socket") {
        // A charm hole and an essence hole hold different things, and a hole holds its own.
        return !!hole && hole !== drag.hole && (hole === "charm") === (drag.hole === "charm");
      }
      if (!hole) return drag.what === "piece";
      if (drag.what !== "stock") return false;
      return canHold(stock(ctx.state).find((x) => x.key === drag.key), hole);
    };

    on(view, "dragover", ".socket, .rite-core.is-drop", (e, t) => {
      if (!takes(t)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      t.classList.add("is-over");
    });
    on(view, "dragleave", ".socket, .rite-core.is-drop", (e, t) => t.classList.remove("is-over"));
    on(view, "drop", ".socket, .rite-core.is-drop", (e, t) => {
      e.preventDefault();
      const carried = drag;
      landed = true;
      dragEnd();
      if (!carried) return;
      if (carried.what === "socket") {
        // Two holes trade what they hold, so a drop is never a stone lost.
        const to = t.dataset.socket;
        if (!to || to === carried.hole || phase !== "idle") return;
        const was = held[to];
        held[to] = held[carried.hole];
        held[carried.hole] = was;
        sigs.stock = null;
        paint();
        return;
      }
      if (carried.what === "piece") putPiece({ key: carried.key, at: carried.at });
      else putStock(stock(ctx.state).find((x) => x.key === carried.key), t.dataset.socket || null);
    });

    /* A charm the camp does not hold is offered from the Bonesetter right here,
       because walking to the Shop for one is friction for nothing. */
    async function buyCharm() {
      const plan = sel ? enchantPlan(ctx.state, sel.key) : null;
      if (!plan || plan.maxed) return;
      if (plan.charms >= 1) {
        held.charm = plan.charm;
        paint();
        return;
      }
      const entry = shopStock(ctx.state).find((x) => x.key === plan.charm);
      if (!entry) return;
      const ok = await confirmSpend(ctx, {
        title: `Buy a ${itemName(plan.charm)}?`,
        body: `Multiplies the odds by ×${EN.charmMult}, spent either way.`,
        gold: entry.price,
        confirmText: fmtGold(entry.price),
        art: "charm",
      });
      if (!ok || dead) return;
      const res = await ctx.dispatch("buyRemedy", { key: plan.charm, qty: 1 });
      if (dead || !res.ok) return;
      held.charm = plan.charm;
      sigs.stock = null;
      paint();
    }

    /* ================= 4. THE PRESS ================= */

    function fx(box, ...nodes) {
      box.replaceChildren(...nodes);
    }
    const sparks = () => h("div.sparks", { "aria-hidden": "true" }, Array.from({ length: 12 }, () => h("i")));
    const smoke = () => h("div.smoke", { "aria-hidden": "true" }, Array.from({ length: 6 }, () => h("i")));
    const stamp = (cls, big, small) => h("div.stamp", { class: cls, role: "status" }, h("span.stamp-t", big), h("span.stamp-s", small));

    function setPhase(next) {
      phase = next;
      ["is-striking", "is-took", "is-refused"].forEach((c) => fRiteNode.classList.remove(c));
      if (next === "strike") fRiteNode.classList.add("is-striking");
      if (next === "took") fRiteNode.classList.add("is-took");
      if (next === "refused") fRiteNode.classList.add("is-refused");
      if (next === "idle") fx(fFx);
      paint();
    }

    async function strike() {
      if (phase !== "idle" || !sel) return;
      const plan = enchantPlan(ctx.state, sel.key);
      if (!plan || plan.maxed || strays(plan)) return;
      const n = staked(plan);
      const withCharm = charmOn(plan);
      if (n < 1 || plan.have < n || (withCharm && plan.charms < 1)) return;
      const { key, at } = sel;
      const before = plan.level;

      // The beams: one a stone, and the charm's from above.
      fx(fFx,
        h("div.beam.b1", h("i")),
        n >= 2 ? h("div.beam.b2", h("i")) : null,
        n >= 3 ? h("div.beam.b3", h("i")) : null,
        withCharm ? h("div.beam.beam-charm.b4", h("i")) : null);
      setPhase("strike");
      await wait(STRIKE_MS);
      if (dead) return;

      const res = await ctx.dispatch("enchant", { key, from: at, stones: n, charm: withCharm });
      if (dead) return;
      if (!res.ok) {
        setPhase("idle");
        return;
      }
      const won = !!(res.data && res.data.won);
      if (won) {
        sel = { key: res.data.key, at };
        const hl = res.data.halo ? haloOf(res.data.level) : null;
        fx(fFx, h("div.flash"), h("div.shock"), sparks(),
          stamp("stamp-took", "Fortified", hl ? `+${res.data.level} · the ${hl.name} halo` : `+${res.data.level}`));
        setPhase("took");
      } else {
        refusals.unshift({ t: ctx.now, m: `${bareName(key)} refused at +${before + 1}. ${n} Essence lost${withCharm ? " and a charm" : ""}.` });
        refusals.splice(LOG_LINES);
        fx(fFx, h("div.flash"), smoke(), stamp("stamp-refused", "Failed", `Still +${before}`));
        setPhase("refused");
      }
      // The holes empty: a press is a fresh choice, and a charm is spent either way.
      clearHoles();
      sigs.pieces = null;
      sigs.stock = null;
      sigs.log = null;
      paint();
      later(REST_MS, () => setPhase("idle"));
    }

    /* ---------- the carrying ---------- */

    function setCPhase(next) {
      cphase = next;
      ["is-flowing", "is-done"].forEach((c) => cRiteNode.classList.remove(c));
      if (next === "flow") cRiteNode.classList.add("is-flowing");
      if (next === "done") cRiteNode.classList.add("is-done");
      if (next === "idle") fx(cFx);
      paint();
    }

    async function carry() {
      if (cphase !== "idle" || !cv.from || !cv.to) return;
      const plan = convertPlan(ctx.state, cv.from.key, cv.to.key);
      if (!plan.ok || !plan.afford) return;
      const from = { ...cv.from };
      const to = { ...cv.to };
      const ok = await confirmSpend(ctx, {
        title: `Carry +${plan.level} onto the ${bareName(to.key)}?`,
        body: `${plan.toll.essence} ${itemName(plan.toll.stone)} as well. The ${bareName(from.key)} goes back to +0.`,
        gold: plan.toll.gold,
        confirmText: fmtGold(plan.toll.gold),
        art: "coin",
      });
      if (!ok || dead || cphase !== "idle") return;

      fx(cFx, h("div.xbeam", h("i")), h("div.plate-move", `+${plan.level}`));
      setCPhase("flow");
      await wait(STRIKE_MS);
      if (dead) return;

      const res = await ctx.dispatch("convert", { from, to });
      if (dead) return;
      if (!res.ok) {
        setCPhase("idle");
        return;
      }
      cv = { from: { key: res.data.key, at: to.at }, to: null };
      fx(cFx, h("div.flash"), h("div.shock"), sparks(),
        stamp("stamp-converted", "Converted", `+${res.data.level}`));
      setCPhase("done");
      sigs.pieces = null;
      sigs.log = null;
      paint();
      later(REST_MS, () => setCPhase("idle"));
    }

    /* ================= 5. PAINTING ================= */

    const sigs = { pieces: null, stock: null, odds: null, log: null, logAt: 0 };
    const logTimes = [];

    /* The whole table, and what a level is worth, behind the one question mark:
       it is reference, wanted once, and it has no business on the board. */
    function oddsTip() {
      const at = sel ? enchantPlan(ctx.state, sel.key) : null;
      const me = at && !at.maxed ? at.level + 1 : 0;
      return tipBody({
        title: "The odds",
        text: `An essence is worth ${fmtWhole(EN.stoneWorth)} against the level you are reaching for. Stake up to ${EN.maxStones}; a charm of the band multiplies what they come to by ×${EN.charmMult}. Every level is worth ${+(EN.gainPerLevel * 100).toFixed(1)}% more of everything the piece carries.`,
        table: {
          head: ["To", "1", "2", "3"],
          rows: Array.from({ length: EN.max }, (_, i) => ({
            className: i + 1 === me ? "is-me" : null,
            cells: [`+${i + 1}`, ...[1, 2, 3].map((n) => pct(enchantChance(i, n, false)))],
          })),
        },
        foot: "A refusal costs the essence and nothing else.",
      });
    }

    function tollTip() {
      return tipBody({
        title: "The toll",
        text: `${fmtGold(EN.convert.goldPerLevelSq)} times the level squared, and ${EN.convert.essencePerLevel} essence a level of the new piece's band. Same slot, and the new piece must be unworked.`,
        table: {
          head: ["Carry", "Gold", "Essence"],
          rows: [3, 6, 9, 12, 15].map((lv) => ({
            cells: [`+${lv}`, fmtGold(EN.convert.goldPerLevelSq * lv * lv), String(EN.convert.essencePerLevel * lv)],
          })),
        },
      });
    }

    /* Three rows of the table on the board itself: the one you are reaching for
       between the one below and the one above, and the rest a scroll away. */
    function paintOdds(plan) {
      const me = plan && !plan.maxed ? plan.level + 1 : 0;
      const withCharm = charmOn(plan);
      const n = Math.max(1, staked(plan));
      const sig = `${me}|${n}|${withCharm ? 1 : 0}`;
      if (sig === sigs.odds) return;
      sigs.odds = sig;
      oddsRows.replaceChildren(...Array.from({ length: EN.max }, (_, i) => {
        const lv = i + 1;
        const hl = haloOf(lv);
        return h("div.odds-row", { class: lv === me && "is-me", role: "listitem" },
          h("span.odds-lv", `+${lv}`),
          hl && hl.at === lv ? haloTag(hl) : h("span"),
          h("span.odds-n", pct(enchantChance(i, n, withCharm))));
      }));
      const row = oddsRows.children[me - 1];
      if (row) oddsRows.scrollTop = Math.max(0, row.offsetTop - (oddsRows.clientHeight - row.offsetHeight) / 2);
    }

    /* ---------- the racks ---------- */

    function pieceTile(p, { on: isOn, tag }) {
      const d = itemDef(p.key);
      const lv = level(p.key);
      const node = h("button.slot.forge-tile", {
        type: "button", draggable: "true",
        dataset: { key: p.key, at: p.at, what: "piece" },
        class: isOn && "is-on",
        title: `${bareName(p.key)} +${lv}`,
        "aria-pressed": !!isOn,
        "aria-label": `${bareName(p.key)}, +${lv}, ${p.worn ? "worn" : poolName(p.at)}`,
      },
        lv > 0 ? plusPlate(lv, "slot-plus") : null,
        h("span.slot-art", { "data-rarity": d.rarity || "common" }, iconEl(d.icon)),
        h("span.slot-name", bareName(p.key)),
        tag ? h("span.slot-tag", { class: tag.cls }, tag.text) : p.worn ? h("span.slot-tag", "Worn") : null);
      paintMini(node.querySelector(".slot-art"), lv, d.slot);
      return node;
    }

    function stockTile(row) {
      const d = itemDef(row.key);
      return h("button.slot.forge-tile", {
        type: "button", draggable: row.qty > 0 ? "true" : null,
        dataset: { key: row.key, what: "stock", kind: row.kind },
        class: [row.qty < 1 && "is-spent", wanted(row) && "is-wanted"],
        title: itemName(row.key),
        "aria-label": `${itemName(row.key)}, ${fmtWhole(row.qty)} held`,
      },
        h("span.slot-qty", row.qty > 0 ? fmt(row.qty) : "0"),
        h("span.slot-art", { class: hasArt(d) && "art-paint" }, artEl(d, { variant: "cut" })),
        h("span.slot-name", itemName(row.key)));
    }

    function paintPieces(state, list) {
      const sig = [mode, list.map((p) => `${p.key}@${p.at}`).join(","), sel && `${sel.key}@${sel.at}`,
        cv.from && `${cv.from.key}@${cv.from.at}`, cv.to && `${cv.to.key}@${cv.to.at}`].join("|");
      if (sig === sigs.pieces) return;
      sigs.pieces = sig;
      if (!list.length) {
        piecesGrid.replaceChildren(h("p.small.muted.rack-none", "No amulet and no ring. Armour and weapons never take the Veil."));
        return;
      }
      piecesGrid.replaceChildren(...list.map((p) => (mode === "fortify"
        ? pieceTile(p, { on: samePiece(p, sel) })
        : pieceTile(p, {
          on: samePiece(p, cv.from) || samePiece(p, cv.to),
          tag: samePiece(p, cv.from) ? { cls: "tag-gold", text: "From" } : samePiece(p, cv.to) ? { cls: "tag-good", text: "To" } : null,
        }))));
    }

    function paintStock(state) {
      const rows = stock(state);
      const sig = rows.map((r) => `${r.key}:${r.qty}:${wanted(r) ? 1 : 0}`).join(",");
      if (sig === sigs.stock) return;
      sigs.stock = sig;
      stockGrid.replaceChildren(...rows.map(stockTile));
    }

    /* ---------- the anvil ---------- */

    function coreArt(core, key) {
      const d = key ? itemDef(key) : null;
      const art = core.querySelector(".rite-core-art");
      const sig = key ? `${d.icon}|${d.rarity || "common"}` : "";
      if (core.dataset.sig === sig) return;
      core.dataset.sig = sig;
      art.replaceChildren(d ? iconEl(d.icon) : iconEl("band"));
      setAttr(core, "data-rarity", d ? d.rarity || "common" : null);
      toggleClass(core, "is-empty", !d);
      setAttr(core, "aria-label", d ? bareName(key) : "Nothing on the anvil");
    }

    function socketArt(node, key) {
      const art = node.querySelector(".socket-art");
      const sig = key || "";
      if (node.dataset.sig === sig) return;
      node.dataset.sig = sig;
      const d = key ? itemDef(key) : null;
      art.replaceChildren(d ? artEl(d, { variant: "cut" }) : iconEl("plus"));
      toggleClass(art, "art-paint", !!(d && hasArt(d)));
    }

    function paintFortify(state, plan) {
      const idle = phase === "idle";
      const d = plan ? plan.def : null;
      coreArt(fCore, plan ? plan.key : null);
      setAttr(fRiteNode, "data-rarity", d ? d.rarity || "common" : null);
      paintPlate(fPlate, plan ? plan.level : 0);
      paintHalo(fHalo, plan ? plan.level : 0, d ? d.slot : null);
      fPlate.hidden = !plan || plan.level < 1;

      const have = plan ? plan.have : 0;
      const charms = plan ? plan.charms : 0;
      const n = staked(plan);
      const stray = strays(plan);
      const withCharm = charmOn(plan);

      sockets.forEach((s, i) => {
        const key = held[String(i + 1)];
        const off = !!(plan && key && key !== plan.stone);
        toggleClass(s, "is-filled", !!key);
        toggleClass(s, "is-empty", !key);
        toggleClass(s, "is-stray", off);
        setAttr(s, "aria-pressed", !!key);
        s.disabled = !idle;
        setAttr(s, "draggable", key && idle ? "true" : null);
        socketArt(s, key);
        setAttr(s, "aria-label", key ? `${itemName(key)} in hole ${i + 1}` : `Hole ${i + 1}, empty`);
      });
      toggleClass(socketCharm, "is-filled", !!held.charm);
      toggleClass(socketCharm, "is-empty", !held.charm);
      toggleClass(socketCharm, "is-stray", !!(plan && held.charm && !withCharm));
      setAttr(socketCharm, "aria-pressed", !!held.charm);
      socketCharm.disabled = !idle;
      setAttr(socketCharm, "draggable", held.charm && idle ? "true" : null);
      socketArt(socketCharm, held.charm);
      setAttr(socketCharm, "aria-label", held.charm ? `${itemName(held.charm)} in the charm hole` : "Charm hole, empty");

      if (!plan) {
        setText(riteSub, "Any amulet or ring, and up to three essence.");
        setText(oddsV, "0%");
        oddsV.className = "odds-v";
        setText(oddsSub, n ? `${n} staked, nothing on the anvil` : "");
        goBtn.disabled = true;
        setText(goBtn, "Fortify");
        paintOdds(null);
        return;
      }

      setText(riteSub, `${bareName(plan.key)} · ${rarityName(plan.key)} ${slotWord(d)} · ${plan.maxed ? `+${plan.max}, as far as it goes` : `reaching +${plan.level + 1}`}`);

      const share = plan.maxed || stray || n < 1 ? 0 : enchantChance(plan.level, n, withCharm);
      if (plan.maxed) {
        setText(oddsV, "Done");
        oddsV.className = "odds-v t-gold";
        setText(oddsSub, `+${plan.max} is the top of the rite`);
      } else if (stray) {
        setText(oddsV, "0%");
        oddsV.className = "odds-v t-bad";
        setText(oddsSub, `Takes ${itemName(plan.stone)}`);
      } else if (n < 1) {
        setText(oddsV, "0%");
        oddsV.className = "odds-v";
        setText(oddsSub, have < 1 ? `No ${itemName(plan.stone)} held` : "");
      } else {
        setText(oddsV, pct(share));
        oddsV.className = `odds-v ${oddsTone(share)}`;
        setText(oddsSub, `${n} of ${fmt(have)} ${itemName(plan.stone)}${withCharm ? ` · charm ×${EN.charmMult}` : ""}`);
      }

      goBtn.disabled = !idle || plan.maxed || !!stray || n < 1 || have < n || (withCharm && charms < 1);
      setText(goBtn, phase === "strike" ? "The Veil stirs" : phase === "took" ? "It took" : phase === "refused" ? "It failed" : "Fortify");
      paintOdds(plan);
    }

    function paintConvert(state) {
      const idle = cphase === "idle";
      const from = cv.from;
      const to = cv.to;
      const fromLv = from ? level(from.key) : 0;
      const toLv = to ? level(to.key) : 0;
      coreArt(cFrom, from ? from.key : null);
      coreArt(cTo, to ? to.key : null);
      paintPlate(cFromPlate, fromLv);
      paintPlate(cToPlate, toLv);
      cFromPlate.hidden = !from || fromLv < 1;
      cToPlate.hidden = !to || toLv < 1;
      paintHalo(cFromHalo, cphase === "flow" ? 0 : fromLv, from ? from.key : null);
      paintHalo(cToHalo, toLv, to ? to.key : null);

      const plan = from && to ? convertPlan(state, from.key, to.key) : null;
      cIdle.hidden = !(idle && plan && plan.ok);

      if (!from) {
        setText(riteSub, "A worked piece, then an unworked one of the same slot.");
        setText(tollV, "0g");
        setText(tollSub, "");
        cBtn.disabled = true;
        setText(cBtn, "Convert");
        return;
      }
      const fd = itemDef(from.key);
      if (!to) {
        const toll = convertToll(fromLv, from.key);
        setText(riteSub, `${bareName(from.key)} +${fromLv} · an unworked ${slotWord(fd)} to carry it onto`);
        setText(tollV, toll ? fmtGold(toll.gold) : "0g");
        setText(tollSub, toll ? `and ${toll.essence} essence of the new piece's band` : "");
        cBtn.disabled = true;
        setText(cBtn, "Pick the new piece");
        return;
      }
      setText(riteSub, `${bareName(from.key)} +${fromLv} onto ${bareName(to.key)}`);
      if (!plan.ok) {
        setText(tollV, "0g");
        setText(tollSub, plan.why);
        cBtn.disabled = true;
        setText(cBtn, "Convert");
        return;
      }
      setText(tollV, fmtGold(plan.toll.gold));
      setText(tollSub, `and ${plan.toll.essence} of ${fmt(plan.have.essence)} ${itemName(plan.toll.stone)}`);
      toggleClass(tollV, "is-short", !plan.afford);
      cBtn.disabled = !idle || !plan.afford;
      setText(cBtn, cphase === "flow" ? "The level crosses" : cphase === "done" ? "Carried" : !plan.afford ? "Not enough" : "Convert");
    }

    // Takes and carryings out of the camp log, and this visit's refusals, newest first.
    function paintLog(state) {
      const kept = (state.log || []).filter((l) => /took \+\d+/.test(String(l.m)));
      const lines = kept.concat(refusals).sort((a, b) => b.t - a.t).slice(0, LOG_LINES);
      const sig = lines.map((l) => `${l.t}:${l.m}`).join("|");
      const t = ctx.now;
      if (sig !== sigs.log) {
        sigs.log = sig;
        sigs.logAt = t;
        logTimes.length = 0;
        logList.replaceChildren(...lines.map((l) => {
          const m = String(l.m);
          const took = /took \+(\d+)/.exec(m);
          const lv = took ? Number(took[1]) : 0;
          const tone = !took ? "ember" : haloOf(lv) ? haloTagClass(haloOf(lv)).replace("tag-", "").replace("bone", "gold") : "good";
          const time = h("time", fmtAgo(t - l.t));
          logTimes.push({ node: time, t: l.t });
          return h("li.log-line", { "data-tone": tone }, time, h("span.log-msg", m));
        }));
        logEmpty.hidden = lines.length > 0;
      } else if (t - sigs.logAt > 30 * 1000) {
        sigs.logAt = t;
        logTimes.forEach((x) => setText(x.node, fmtAgo(t - x.t)));
      }
    }

    function paint() {
      const state = ctx.state;
      const list = pieces(state);

      if (sel && !findPiece(list, sel) && phase === "idle") sel = null;
      if (cphase === "idle") {
        if (cv.from && !findPiece(list, cv.from)) cv = { from: null, to: null };
        if (cv.to && !findPiece(list, cv.to)) cv.to = null;
      }

      const plan = sel ? enchantPlan(state, sel.key) : null;
      paintPieces(state, list);
      if (mode === "fortify") {
        paintFortify(state, plan);
        paintStock(state);
      } else {
        paintConvert(state);
      }
      paintLog(state);
    }

    paint();
    fit();

    return {
      update: paint,
      unmount() {
        dead = true;
        timers.forEach(clearTimeout);
        timers.clear();
        if (ro) ro.disconnect();
        else window.removeEventListener("resize", fit);
      },
    };
  },
};
