/* ============================================================
   Respite · pages/fortify.js · The Anvil
   ------------------------------------------------------------
   The Veil worked into an amulet or a ring, on a tab of its own.
   The piece sits in the circle with three essence sockets round
   it and a charm socket above; you stake one to three essences,
   press once, and the beams converge on the piece. FORTIFIED or
   FAILED, stamped over the anvil. A failure takes the essence and
   the charm and nothing else: no level is ever lost.

   Convert, on the same tab, carries a worked piece's whole level
   onto an unworked piece of the same slot for a toll. Nothing is
   rolled there and it always takes.

   Every number is the rules' own (enchantPlan, enchantChance,
   convertPlan off world.js); this only stages it. The page holds
   what is on the anvil and how many essences are staked, nothing
   the save needs, and the camp log keeps the takes: refusals are
   only remembered while the tab is open.
   ============================================================ */

import { CONFIG } from "../../shared/config.js";
import { GameData } from "../../shared/registry.js";
import { itemDef, itemName, parseKey, canFortify, haloOf, rarityName } from "../../shared/items.js";
import { enchantPlan, enchantChance, convertPlan, convertToll, stoneFor, charmFor, shopStock } from "../../shared/world.js";
import { orderedKeys, qtyIn, haveQty, poolName } from "../../shared/storage.js";
import { h, on, setText, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { toast } from "../ui/overlay.js";
import { confirmSpend, openPopup } from "../ui/widgets.js";
import { fmt, fmtWhole, fmtGold, fmtAgo } from "../ui/format.js";
import { haloTag, haloTagClass, plusPlate, paintPlate, haloNode, paintHalo, paintMini } from "../ui/halo.js";

const EN = CONFIG.enchant;
const { SLOT_LABELS } = GameData;
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

const slotWord = (d) => (SLOT_LABELS[d.slot] === "Neck" ? "amulet" : "ring");
// The name without its "+N": the plate beside it says the level.
const bareName = (key) => itemName(key).replace(/ \+\d+$/, "");
const rarityWord = (key) => rarityName(key) || "Common";
const gainPct = (level) => `${+(level * EN.gainPerLevel * 100).toFixed(1)}%`;

// Where a piece is, in a sentence: "worn", "Belongings", "the Stockpile".
const whereWord = (at) => (GameData.EQUIP_SLOTS.includes(at) ? "worn" : poolName(at));

/* Every amulet and ring in the camp, worn ones first, then the pools in their own
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

const samePiece = (a, b) => !!(a && b && a.key === b.key && a.at === b.at);
const findPiece = (list, p) => (p ? list.find((x) => samePiece(x, p)) || null : null);
const level = (key) => parseKey(key).plus;

/* ================= 2. THE PAGE ================= */

export default {
  id: "fortify",
  title: () => "Fortify",
  group: "The Camp",

  mount(view, ctx) {
    let mode = "fortify";        // "fortify" | "convert"
    let sel = null;              // { key, at } on the anvil
    let stones = 1;
    let charm = false;
    let phase = "idle";          // idle | strike | took | refused
    let cv = { from: null, to: null };
    let cphase = "idle";         // idle | flow | done
    const refusals = [];         // this visit's failures, newest first: { t, m }
    const timers = new Set();
    let dead = false;
    // The piece the link brought: picked once the list is known, then forgotten.
    let wanted = ctx.route && ctx.route.arg ? ctx.route.arg : null;

    function later(ms, fn) {
      const id = setTimeout(() => {
        timers.delete(id);
        if (!dead) fn();
      }, reducedMotion() ? Math.min(ms, 200) : ms);
      timers.add(id);
      return id;
    }
    const wait = (ms) => new Promise((ok) => later(ms, ok));

    /* ---------- the head ---------- */

    const chipEssence = h("span.chip.chip-violet", iconEl("gem"), h("span"));
    const chipCharm = h("span.chip.chip-gold", iconEl("charm"), h("span"));
    const chipPieces = h("span.chip", iconEl("band"), h("span"));
    const pageSub = h("p.page-sub");

    /* ---------- the mode ---------- */

    const segFortify = h("button.seg-btn", { type: "button", role: "tab", "aria-selected": true, onClick: () => setMode("fortify") }, "Fortify");
    const segConvert = h("button.seg-btn", { type: "button", role: "tab", "aria-selected": false, onClick: () => setMode("convert") }, "Convert");
    const seg = h("div.seg", { role: "tablist", "aria-label": "Rite" }, segFortify, segConvert);

    function setMode(next) {
      if (mode === next || phase !== "idle" || cphase !== "idle") return;
      mode = next;
      setAttr(segFortify, "aria-selected", mode === "fortify");
      setAttr(segConvert, "aria-selected", mode === "convert");
      toggleClass(view, "is-convert", mode === "convert");
      riteCard.dataset.tone = mode === "convert" ? "gold" : "violet";
      fRite.hidden = mode !== "fortify";
      fLedger.hidden = mode !== "fortify";
      cRite.hidden = mode !== "convert";
      cLedger.hidden = mode !== "convert";
      oddsCard.hidden = mode !== "fortify";
      tollCard.hidden = mode !== "convert";
      sigs.pieces = null;
      sigs.log = null;
      paint();
    }

    /* ---------- the rite: fortify ---------- */

    const rings = () => [h("div.ring.ring-outer"), h("div.ring.ring-ticks"), h("div.ring.ring-runes"), h("div.ring.ring-inner")];

    const fHalo = haloNode();
    const fCore = h("button.rite-core.bracket", { type: "button", onClick: () => look(sel) }, h("span.rite-core-art"));
    const fPlate = plusPlate(0, "rite-plus");
    const fFx = h("div.rite-fx");
    const sockets = [1, 2, 3].map((i) => h("button.socket", {
      type: "button", class: `s${i}`, dataset: { socket: String(i) }, "aria-pressed": false,
    }, iconEl("gem"), h("span.socket-l", "Essence")));
    const socketCharm = h("button.socket.socket-charm.s4", { type: "button", dataset: { socket: "charm" }, "aria-pressed": false },
      iconEl("charm"), h("span.socket-l", "Charm"));
    const fRiteNode = h("div.rite", rings(), fHalo, fFx, fCore, fPlate, sockets, socketCharm);
    const fRite = h("div.rite-scale", fRiteNode);

    const oddsV = h("span.odds-v");
    const oddsSub = h("span.odds-sub");
    const stakeChips = [1, 2, 3].map((n) => h("button.chip", { type: "button", dataset: { stake: String(n) }, "aria-pressed": false }, String(n)));
    const rowStaked = h("span.v");
    const rowCharm = h("span.v");
    const rowTakes = h("span.v.t-good");
    const rowFails = h("span.v");
    const goBtn = h("button.btn.btn-primary.btn-lg.btn-block", { type: "button", onClick: () => strike() }, "Fortify");
    const fNote = h("p.rite-note", "The Veil takes only what you stake. A charm is spent whether it takes or not.");
    const fLedger = h("div.rite-ledger",
      h("div.odds", h("span.eyebrow", "Odds of taking"), oddsV, oddsSub),
      h("div.stake", { role: "group", "aria-label": "Essence to stake" }, h("span.eyebrow", "Stake"), stakeChips),
      h("div.stats",
        h("div.stat", h("span.l", "Essence staked"), rowStaked),
        h("div.stat", h("span.l", "Charm"), rowCharm),
        h("div.stat", h("span.l", "If it takes"), rowTakes),
        h("div.stat", h("span.l", "If it fails"), rowFails)),
      goBtn,
      fNote);

    /* ---------- the rite: convert ---------- */

    const cFromHalo = haloNode();
    const cToHalo = haloNode();
    cFromHalo.classList.add("at-from");
    cToHalo.classList.add("at-to");
    const cFrom = h("button.rite-core.bracket.core-from", { type: "button", onClick: () => look(cv.from) }, h("span.rite-core-art"));
    const cTo = h("button.rite-core.bracket.core-to", { type: "button", onClick: () => look(cv.to) }, h("span.rite-core-art"));
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
    const cRowFrom = h("span.v");
    const cRowTo = h("span.v");
    const cRowEss = h("span.v");
    const cRowAfter = h("span.v.t-good");
    const cBtn = h("button.btn.btn-gold.btn-lg.btn-block", { type: "button", onClick: () => carry() }, "Convert");
    const cLedger = h("div.rite-ledger", { hidden: true },
      h("div.odds", h("span.eyebrow", "The toll"), tollV, tollSub),
      h("div.stats",
        h("div.stat", h("span.l", "From"), cRowFrom),
        h("div.stat", h("span.l", "To"), cRowTo),
        h("div.stat", h("span.l", "Essence"), cRowEss),
        h("div.stat", h("span.l", "After"), cRowAfter)),
      cBtn,
      h("p.rite-note", "Same slot only, and the new piece must be unworked. Nothing is rolled: it always takes, and the old piece goes back to +0."));

    /* ---------- the cards ---------- */

    const riteTitle = h("h2.card-title", iconEl("gem"), "The rite");
    const riteSub = h("p.card-sub");
    const riteTag = h("span.tag.tag-violet");
    const riteCard = h("section.card.forge-rite", { "data-tone": "violet" },
      h("div.card-head", h("div", riteTitle, riteSub), h("div.card-actions", seg, riteTag)),
      h("div.rite-wrap", fRite, cRite, fLedger, cLedger));

    const piecesSub = h("p.card-sub");
    const piecesList = h("div.pick-list.pieces");
    const piecesCard = h("section.card.forge-pieces",
      h("div.card-head", h("div", h("h2.card-title", "Pieces"), piecesSub), h("div.card-actions", chipPieces)),
      piecesList);

    const oddsBody = h("tbody");
    const oddsCard = h("section.card.card-flush.forge-odds",
      h("div.card-head", h("div", h("h2.card-title", "The odds"),
        h("p.card-sub", `By essence staked. A charm multiplies the row by ×${EN.charmMult}, held at 100%.`))),
      h("div.odds-table", h("table.table.table-tight",
        h("thead", h("tr", h("th", "To"), h("th.num", "1"), h("th.num", "2"), h("th.num", "3"), h("th", "Halo"))),
        oddsBody)));

    const tollBody = h("tbody");
    const tollCard = h("section.card.card-flush.forge-odds", { hidden: true },
      h("div.card-head", h("div", h("h2.card-title", "The toll"),
        h("p.card-sub", `${fmtGold(EN.convert.goldPerLevelSq)} × level², and ${EN.convert.essencePerLevel} essence a level of the new piece's band. The level carries whole.`))),
      h("div.odds-table", h("table.table.table-tight",
        h("thead", h("tr", h("th", "Carry"), h("th.num", "Gold"), h("th.num", "Essence"), h("th", "Halo"))),
        tollBody)));

    const logList = h("ol.log");
    const logEmpty = h("p.small.muted", "Nothing worked yet.");
    const logCard = h("section.card.forge-log",
      h("div.card-head", h("div", h("h2.card-title", "Worked lately"),
        h("p.card-sub", "Takes and carryings are kept in the camp log. Refusals are only remembered while you are here."))),
      logList, logEmpty);

    const empty = h("section.card", { hidden: true },
      h("div.empty",
        h("div.empty-art", iconEl("band")),
        h("div.empty-title", "Nothing takes the Veil yet"),
        h("p.empty-text", "An amulet or a ring, worn or in Belongings, the Stockpile or the Vault, goes on the anvil. Armour and weapons are never worked.")));

    view.appendChild(h("div.page.fortify-page",
      h("header.page-head",
        h("div",
          h("div.eyebrow.page-eyebrow", "The Camp"),
          h("h1.page-title", "Fortify"),
          pageSub),
        h("div.page-actions", chipEssence, chipCharm, chipPieces)),
      empty,
      h("div.forge",
        h("div.forge-col", riteCard, logCard),
        h("div.forge-col", piecesCard, oddsCard, tollCard))));

    /* ---------- fitting the circle ---------- */

    // The rite is drawn on a 440px grid and scaled to whatever width it has.
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

    /* ---------- picking ---------- */

    on(piecesList, "click", "button.pick-row[data-key]", (e, b) => {
      const p = { key: b.dataset.key, at: b.dataset.at };
      if (mode === "fortify") {
        if (phase !== "idle") return;
        sel = p;
        stones = 1;
      } else {
        if (cphase !== "idle") return;
        if (b.dataset.role === "from") {
          cv = samePiece(cv.from, p) ? { from: null, to: null } : { from: p, to: null };
        } else {
          cv.to = samePiece(cv.to, p) ? null : p;
        }
      }
      sigs.pieces = null;
      paint();
    });

    // The piece's own sheet, off the core: what it carries and what it is worth.
    function look(p) {
      if (!p) return;
      openPopup("item", ctx, p.key, { from: GameData.EQUIP_SLOTS.includes(p.at) ? "worn" : p.at });
    }

    on(fRiteNode, "click", "button.socket[data-socket]", (e, b) => {
      if (phase !== "idle" || !sel) return;
      const plan = enchantPlan(ctx.state, sel.key);
      if (!plan || plan.maxed) return;
      if (b.dataset.socket === "charm") {
        toggleCharm(plan);
        return;
      }
      const i = Number(b.dataset.socket);
      // A filled socket empties itself and the ones after it; an empty one fills up to itself.
      stones = stones >= i ? Math.max(1, i - 1) : Math.min(i, Math.max(1, plan.have));
      paint();
    });

    on(fLedger, "click", "button.chip[data-stake]", (e, b) => {
      if (phase !== "idle") return;
      stones = Number(b.dataset.stake) || 1;
      paint();
    });

    /* The charm socket: off, on, or bought. A charm the camp does not hold is
       offered from the Bonesetter right here, because walking to the Shop for one
       is friction for nothing. */
    async function toggleCharm(plan) {
      if (charm) {
        charm = false;
        paint();
        return;
      }
      if (plan.charms >= 1) {
        charm = true;
        paint();
        return;
      }
      const entry = shopStock(ctx.state).find((x) => x.key === plan.charm);
      if (!entry) {
        toast(`The Bonesetter has no ${itemName(plan.charm)}`, { kind: "warn" });
        return;
      }
      const ok = await confirmSpend(ctx, {
        title: `Buy a ${itemName(plan.charm)}?`,
        body: `It rides in the fourth socket and multiplies the odds by ×${EN.charmMult}. Spent whether the rite takes or not.`,
        gold: entry.price,
        confirmText: `Buy for ${fmtGold(entry.price)}`,
        art: "charm",
      });
      if (!ok || dead) return;
      const res = await ctx.dispatch("buyRemedy", { key: plan.charm, qty: 1 });
      if (dead || !res.ok) return;
      charm = true;
      paint();
    }

    /* ---------- the press ---------- */

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
      if (!plan || plan.maxed || plan.have < stones || (charm && plan.charms < 1)) return;
      const { key, at } = sel;
      const staked = stones;
      const withCharm = charm;
      const before = plan.level;

      // The beams: one a stone, and the charm's from above.
      fx(fFx,
        h("div.beam.b1", h("i")),
        staked >= 2 ? h("div.beam.b2", h("i")) : null,
        staked >= 3 ? h("div.beam.b3", h("i")) : null,
        withCharm ? h("div.beam.beam-charm.b4", h("i")) : null);
      setPhase("strike");
      await wait(STRIKE_MS);
      if (dead) return;

      const res = await ctx.dispatch("enchant", { key, from: at, stones: staked, charm: withCharm });
      if (dead) return;
      if (!res.ok) {
        // The toast has already said why.
        setPhase("idle");
        return;
      }
      const won = !!(res.data && res.data.won);
      if (won) {
        sel = { key: res.data.key, at };
        const hl = res.data.halo ? haloOf(res.data.level) : null;
        fx(fFx, h("div.flash"), h("div.shock"), sparks(),
          stamp("stamp-took", "Fortified", hl ? `+${res.data.level} · the ${hl.name} halo` : `+${res.data.level} · the Veil holds`));
        setPhase("took");
      } else {
        refusals.unshift({ t: ctx.now, m: `The Veil refused ${bareName(key)} at +${before + 1}. ${staked} Essence lost${withCharm ? ", and the charm" : ""}.` });
        refusals.splice(LOG_LINES);
        fx(fFx, h("div.flash"), smoke(),
          stamp("stamp-refused", "Failed", `${staked} Essence lost · still +${before}`));
        setPhase("refused");
      }
      // A charm is spent either way; the next press is a fresh choice.
      charm = false;
      sigs.pieces = null;
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
        body: `${fmtGold(plan.toll.gold)} and ${plan.toll.essence} ${itemName(plan.toll.stone)}. The ${bareName(from.key)} goes back to +0.`,
        gold: plan.toll.gold,
        confirmText: `Pay ${fmtGold(plan.toll.gold)}`,
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
        stamp("stamp-converted", "Converted", `${bareName(res.data.key)} +${res.data.level} · ${bareName(res.data.from)} +0`));
      setCPhase("done");
      sigs.pieces = null;
      sigs.log = null;
      paint();
      later(REST_MS, () => setCPhase("idle"));
    }

    /* ---------- painting ---------- */

    const sigs = { pieces: null, odds: null, toll: null, log: null, logAt: 0 };
    const logTimes = [];

    function coreArt(core, key) {
      const d = key ? itemDef(key) : null;
      const art = core.querySelector(".rite-core-art");
      const sig = key ? `${d.icon}|${d.rarity || "common"}` : "";
      if (core.dataset.sig === sig) return;
      core.dataset.sig = sig;
      art.replaceChildren(d ? iconEl(d.icon) : iconEl("band"));
      setAttr(core, "data-rarity", d ? d.rarity || "common" : null);
      toggleClass(core, "is-empty", !d);
      setAttr(core, "aria-label", d ? `${itemName(key)}: about this piece` : "Nothing on the anvil");
      core.disabled = !d;
    }

    function pieceRow(p, { selected, role = null, tag = null }) {
      const d = itemDef(p.key);
      const lv = level(p.key);
      const art = h("span.art.art-sm", { "data-rarity": d.rarity || "common", "aria-hidden": "true" }, iconEl(d.icon));
      paintMini(art, lv);
      const where = p.worn ? "Worn" : poolName(p.at);
      const sub = [`${rarityWord(p.key)} ${slotWord(d)}`, where, p.qty > 1 ? `×${fmtWhole(p.qty)}` : null].filter(Boolean).join(" · ");
      return h("button.pick-row", {
        type: "button", dataset: { key: p.key, at: p.at, role }, "aria-selected": !!selected,
        "aria-label": `${bareName(p.key)}, +${lv}, ${where}`,
      },
        art,
        h("span.lr-main", h("span.lr-title", bareName(p.key)), h("span.lr-sub", sub)),
        h("span.lr-end",
          tag ? h("span.tag", { class: tag.cls }, tag.text) : null,
          plusPlate(lv)));
    }

    function paintPieces(state, list) {
      const sig = [mode, list.map((p) => `${p.key}@${p.at}:${p.qty}`).join(","), sel && `${sel.key}@${sel.at}`,
        cv.from && `${cv.from.key}@${cv.from.at}`, cv.to && `${cv.to.key}@${cv.to.at}`].join("|");
      if (sig === sigs.pieces) return;
      sigs.pieces = sig;
      setText(chipPieces.lastChild, `${list.length} ${list.length === 1 ? "piece" : "pieces"}`);

      if (mode === "fortify") {
        setText(piecesSub, "Amulets and rings only, worn or carried. Armour and weapons are never worked.");
        piecesList.replaceChildren(...list.map((p) => pieceRow(p, { selected: samePiece(p, sel) })));
        return;
      }
      const worked = list.filter((p) => level(p.key) >= 1);
      const fromDef = cv.from ? itemDef(cv.from.key) : null;
      const bare = list.filter((p) => level(p.key) < 1 && (!fromDef || itemDef(p.key).slot === fromDef.slot) && !samePiece(p, cv.from));
      setText(piecesSub, "Pick a worked piece, then an unworked one of the same slot to carry its level onto.");
      piecesList.replaceChildren(
        h("div.pieces-group", h("div.eyebrow", "Worked"),
          worked.length
            ? worked.map((p) => pieceRow(p, { selected: samePiece(p, cv.from), role: "from", tag: samePiece(p, cv.from) ? { cls: "tag-gold", text: "From" } : null }))
            : h("p.small.muted.pieces-none", "Nothing is worked yet. Fortify a piece first.")),
        h("div.pieces-group", h("div.eyebrow", fromDef ? `Unworked ${slotWord(fromDef)}s` : "Unworked"),
          bare.length
            ? bare.map((p) => pieceRow(p, { selected: samePiece(p, cv.to), role: "to", tag: samePiece(p, cv.to) ? { cls: "tag-good", text: "To" } : null }))
            : h("p.small.muted.pieces-none", fromDef ? `No unworked ${slotWord(fromDef)} to carry it onto.` : "Nothing unworked to carry a level onto.")));
    }

    function paintFortify(state, plan) {
      const idle = phase === "idle";
      const d = plan ? plan.def : null;
      coreArt(fCore, plan ? plan.key : null);
      setAttr(fRiteNode, "data-rarity", d ? d.rarity || "common" : null);
      paintPlate(fPlate, plan ? plan.level : 0);
      paintHalo(fHalo, plan ? plan.level : 0);
      fPlate.hidden = !plan;

      const have = plan ? plan.have : 0;
      const charms = plan ? plan.charms : 0;
      if (plan && !plan.maxed) stones = Math.max(1, Math.min(EN.maxStones, Math.min(stones, Math.max(1, have))));
      if (charm && charms < 1 && idle) charm = false;

      sockets.forEach((s, i) => {
        const filled = !!plan && !plan.maxed && stones >= i + 1;
        toggleClass(s, "is-filled", filled);
        toggleClass(s, "is-empty", !filled);
        setAttr(s, "aria-pressed", filled);
        s.disabled = !plan || plan.maxed || !idle;
        setAttr(s, "aria-label", `Essence socket ${i + 1}${filled ? ", filled" : ", empty"}`);
      });
      toggleClass(socketCharm, "is-filled", charm);
      toggleClass(socketCharm, "is-empty", !charm);
      setAttr(socketCharm, "aria-pressed", charm);
      socketCharm.disabled = !plan || plan.maxed || !idle;
      setAttr(socketCharm, "aria-label", charm ? "Charm socket, filled" : charms >= 1 ? "Charm socket, empty" : "Charm socket, empty: buy a charm");

      if (!plan) {
        setText(riteSub, "Pick an amulet or a ring from the Pieces.");
        setText(riteTag, "Nothing on the anvil");
        setText(oddsV, "0%");
        oddsV.className = "odds-v";
        setText(oddsSub, "");
        [rowStaked, rowCharm, rowTakes, rowFails].forEach((r) => r.replaceChildren("None"));
        stakeChips.forEach((c) => { c.disabled = true; setAttr(c, "aria-pressed", false); });
        goBtn.disabled = true;
        setText(goBtn, "Fortify");
        return;
      }

      setText(riteSub, `${bareName(plan.key)} · ${rarityWord(plan.key)} ${slotWord(d)} · Tier ${d.tier} · ${whereWord(sel.at)}`);
      setText(riteTag, plan.maxed ? `Complete · +${plan.max}` : `Next · +${plan.level + 1}`);

      const share = plan.maxed ? 0 : enchantChance(plan.level, stones, charm);
      const base = plan.maxed ? 0 : enchantChance(plan.level, stones, false);
      if (plan.maxed) {
        setText(oddsV, "Done");
        oddsV.className = "odds-v t-gold";
        setText(oddsSub, `+${plan.max} is the top of the rite`);
      } else {
        setText(oddsV, pct(share));
        oddsV.className = `odds-v ${oddsTone(share)}`;
        setText(oddsSub, have < 1
          ? `No ${itemName(plan.stone)} to stake`
          : charm ? `${stones} essence · ${pct(base)} · charm ×${EN.charmMult}` : `${stones} essence, no charm`);
      }

      stakeChips.forEach((c, i) => {
        const n = i + 1;
        c.disabled = plan.maxed || !idle || have < n;
        setAttr(c, "aria-pressed", !plan.maxed && stones === n);
      });

      rowStaked.replaceChildren(String(plan.maxed ? 0 : stones), h("small", `of ${fmt(have)} ${itemName(plan.stone)} held`));
      rowCharm.className = `v${charm ? " t-gold" : ""}`;
      rowCharm.replaceChildren(charm ? `×${EN.charmMult}` : "None", h("small", `${fmt(charms)} ${itemName(plan.charm)} held`));
      rowTakes.replaceChildren(plan.maxed ? "Nothing more" : `+${plan.level + 1}`, h("small", plan.maxed ? "" : `every stat +${gainPct(plan.level + 1)}`));
      rowFails.replaceChildren(plan.maxed ? "Nothing" : `${stones} essence lost`, h("small", plan.maxed ? "" : `keeps +${plan.level}`));

      goBtn.disabled = !idle || plan.maxed || have < stones || (charm && charms < 1);
      setText(goBtn, phase === "strike" ? "The Veil stirs" : phase === "took" ? "It took" : phase === "refused" ? "It failed"
        : plan.maxed ? "Nothing more to work" : have < 1 ? `No ${itemName(plan.stone)} to stake` : `Fortify · ${stones} essence${charm ? " and a charm" : ""}`);
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
      cFromPlate.hidden = !from;
      cToPlate.hidden = !to;
      paintHalo(cFromHalo, cphase === "flow" ? 0 : fromLv);
      paintHalo(cToHalo, toLv);

      const plan = from && to ? convertPlan(state, from.key, to.key) : null;
      cIdle.hidden = !(idle && plan && plan.ok);
      riteCard.dataset.tone = "gold";

      if (!from) {
        setText(riteSub, "Pick a worked piece to carry a level from.");
        setText(riteTag, "Nothing to carry");
        setText(tollV, "0g");
        setText(tollSub, "");
        [cRowFrom, cRowTo, cRowEss, cRowAfter].forEach((r) => r.replaceChildren("None"));
        cBtn.disabled = true;
        setText(cBtn, "Convert");
        return;
      }
      const fd = itemDef(from.key);
      setText(riteTag, `Carries · +${fromLv}`);
      cRowFrom.replaceChildren(bareName(from.key), h("small", `+${fromLv} · ${whereWord(from.at)}`));
      if (!to) {
        const toll = convertToll(fromLv, from.key);
        setText(riteSub, `${bareName(from.key)} +${fromLv} · ${rarityWord(from.key)} ${slotWord(fd)} · pick an unworked ${slotWord(fd)} to carry it onto`);
        setText(tollV, toll ? fmtGold(toll.gold) : "0g");
        setText(tollSub, toll ? `${fmtGold(EN.convert.goldPerLevelSq)} × ${fromLv}² · and ${toll.essence} essence of the new piece's band` : "");
        cRowTo.replaceChildren("None", h("small", "not picked yet"));
        cRowEss.replaceChildren(String(toll ? toll.essence : 0), h("small", "of the new piece's band"));
        cRowAfter.replaceChildren("None");
        cBtn.disabled = true;
        setText(cBtn, "Pick the new piece");
        return;
      }
      const td = itemDef(to.key);
      setText(riteSub, `${bareName(from.key)} +${fromLv} · ${rarityWord(from.key)} ${slotWord(fd)} · Tier ${fd.tier} · to ${bareName(to.key)} · ${rarityWord(to.key)} ${slotWord(td)} · Tier ${td.tier}`);
      cRowTo.replaceChildren(bareName(to.key), h("small", `+${toLv} · ${whereWord(to.at)}`));
      if (!plan.ok) {
        setText(tollV, "0g");
        setText(tollSub, plan.why);
        cRowEss.replaceChildren("None");
        cRowAfter.replaceChildren("None");
        cBtn.disabled = true;
        setText(cBtn, "Convert");
        return;
      }
      setText(tollV, fmtGold(plan.toll.gold));
      setText(tollSub, `${fmtGold(EN.convert.goldPerLevelSq)} × ${plan.level}² · and ${plan.toll.essence} ${itemName(plan.toll.stone)}`);
      toggleClass(tollV, "is-short", plan.have.gold < plan.toll.gold);
      cRowEss.className = `v${plan.have.essence < plan.toll.essence ? " t-bad" : ""}`;
      cRowEss.replaceChildren(String(plan.toll.essence), h("small", `of ${fmt(plan.have.essence)} ${itemName(plan.toll.stone)} held`));
      cRowAfter.replaceChildren(`${bareName(to.key)} +${plan.level}`, h("small", `${bareName(from.key)} +0`));
      cBtn.disabled = !idle || !plan.afford;
      setText(cBtn, cphase === "flow" ? "The level crosses" : cphase === "done" ? "Carried"
        : plan.have.gold < plan.toll.gold ? `Short by ${fmtGold(plan.toll.gold - plan.have.gold)}`
          : plan.have.essence < plan.toll.essence ? `Needs ${plan.toll.essence - plan.have.essence} more ${itemName(plan.toll.stone)}`
            : `Convert · ${fmtGold(plan.toll.gold)}`);
    }

    function paintOdds(plan) {
      const me = plan && !plan.maxed ? plan.level + 1 : 0;
      if (sigs.odds === me) return;
      sigs.odds = me;
      oddsBody.replaceChildren(...Array.from({ length: EN.max }, (_, i) => {
        const lv = i + 1;
        const hl = haloOf(lv);
        return h("tr", { class: lv === me && "is-me" },
          h("td.strong", `+${lv}`),
          [1, 2, 3].map((n) => {
            const share = enchantChance(lv - 1, n, false);
            return h("td.num", { class: share < 1 && "dimv" }, pct(share));
          }),
          h("td", hl && hl.at === lv ? haloTag(hl) : null));
      }));
    }

    function paintToll() {
      const me = cv.from ? level(cv.from.key) : 0;
      if (sigs.toll === me) return;
      sigs.toll = me;
      tollBody.replaceChildren(...Array.from({ length: EN.max }, (_, i) => {
        const lv = i + 1;
        const hl = haloOf(lv);
        return h("tr", { class: lv === me && "is-me" },
          h("td.strong", `+${lv}`),
          h("td.num", fmtGold(EN.convert.goldPerLevelSq * lv * lv)),
          h("td.num", String(EN.convert.essencePerLevel * lv)),
          h("td", hl && hl.at === lv ? haloTag(hl) : null));
      }));
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
          const tone = !took ? "ember" : haloOf(lv) ? haloTagClass(haloOf(lv)).replace("tag-", "") : "good";
          const time = h("time", fmtAgo(t - l.t));
          logTimes.push({ node: time, t: l.t });
          return h("li.log-line", { "data-tone": tone === "bone" ? "gold" : tone }, time, h("span.log-msg", m));
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

      // What the link asked for, then the worn ring, the worn amulet, the first spare.
      if (wanted) {
        const hit = list.find((p) => p.key === wanted);
        if (hit) sel = { key: hit.key, at: hit.at };
        wanted = null;
      }
      if (sel && !findPiece(list, sel) && phase === "idle") sel = null;
      if (!sel && list.length && phase === "idle") {
        const pick = list.find((p) => p.worn && itemDef(p.key).slot === "ring") || list.find((p) => p.worn) || list[0];
        sel = { key: pick.key, at: pick.at };
        stones = 1;
      }
      if (cphase === "idle") {
        if (cv.from && !findPiece(list, cv.from)) cv = { from: null, to: null };
        if (cv.to && !findPiece(list, cv.to)) cv.to = null;
      }

      empty.hidden = list.length > 0;
      const plan = sel ? enchantPlan(state, sel.key) : null;
      const bandKey = plan ? plan.key : list.length ? list[0].key : null;
      const stone = bandKey ? stoneFor(bandKey) : null;
      const charmKey = bandKey ? charmFor(bandKey) : null;
      setText(chipEssence.lastChild, stone ? `${fmt(haveQty(state, stone))} ${itemName(stone)}` : "No piece on the anvil");
      setText(chipCharm.lastChild, charmKey ? `${fmt(haveQty(state, charmKey))} ${itemName(charmKey)}` : "");
      chipCharm.hidden = !charmKey;
      setText(pageSub, mode === "fortify"
        ? "Work Veil Essence into an amulet or a ring. Stake one to three essences and the Veil decides. A failed rite takes the essence and nothing else: no level is ever lost."
        : "Carry a worked piece's level onto a new one of the same slot. Nothing is rolled: the toll is paid and it always takes. The old piece goes back to +0.");

      paintPieces(state, list);
      if (mode === "fortify") {
        paintFortify(state, plan);
        paintOdds(plan);
      } else {
        paintConvert(state);
        paintToll();
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
