/* ============================================================
   Respite · pages/discipline.js · The Discipline
   ------------------------------------------------------------
   Where a discipline is spent rather than chosen. Two tabs: the
   Path (what a Warrior, Rogue or Mage grows into) and Mastery
   (what a weapon owes you for the hours spent carrying it).

   Mastery lists every armed line there is, not only yours. A line
   your discipline cannot hold reads as a dash rather than a
   number, because what you gave up is worth seeing. Pick a line
   and the panel below says where it stands, what it is worth, and
   which of its five names you have earned.

   The chosen discipline and the Veil stay on the Character page;
   this is the room they lead to, and it is deliberately bare
   until there is something real to put in it. The tab shell is
   the Character page's, so the three pages behave alike.
   ============================================================ */

import { h, on, setText, setAttr, setWidth, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { tooltip, tipBody, confirm } from "../ui/overlay.js";
import { fmt, fmtWhole } from "../ui/format.js";
import { myClass, skillLevel } from "../../shared/stats.js";
import { GameData, classWeapons } from "../../shared/registry.js";
import { masterySheet } from "../../shared/mastery.js";
import { pathSheet, pathMods } from "../../shared/path.js";
import { confirmSpend } from "../ui/widgets.js";
import { fmtGold } from "../ui/format.js";
import { CONFIG } from "../../shared/config.js";

/* ================= 1. THE TABS ================= */

/* ================= 1a. THE PATH ================= */

/* Ten nodes in three bands, drawn as a road rather than a grid: one spine down
   the middle of the tree, lit as far as the points have gone and dark below it,
   with a rung of four hanging off it a band, two either side. A band opens on
   what has been spent and not on the node above it, so nothing inside a band
   pretends to be ordered. Every number comes off pathSheet().

   Points are STAGED, not spent. Clicking a face marks a rank and nothing else;
   the foot bar seals the lot in one command a rank. A misclick costs nothing
   until then, which is the only fair way to sell a tree that can never be
   filled -- and it puts the one warning where it belongs, on the seal.

   The rail says what the face in hand is worth rank by rank, and under it what
   the whole walk carries. The old grid said none of that: ten icons, no names. */

const BAND_NAMES = ["Groundwork", "The Craft", "Keystones"];
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const roman = (n) => ROMAN[n] || String(n);

// "+3% Defence", "1.5s faster", "+2 Veil a blow" -- one line a rank, in the reader's words.
const PER_WORDS = {
  attackPct: (v) => `+${pct(v)} Attack`,
  defencePct: (v) => `+${pct(v)} Defence`,
  healthPct: (v) => `+${pct(v)} health`,
  speedPct: (v) => `${pct(v)} faster`,
  critFlat: (v) => `+${pct(v)} Crit Chance`,
  critDmgFlat: (v) => `+${pct(v)} Crit Damage`,
  penFlat: (v) => `+${pct(v)} penetration`,
  veilFlat: (v) => `+${v} Veil a blow`,
  absorbFlat: (v) => `+${v} Veil a second`,
  techPct: (v) => `+${pct(v)} from a full Veil`,
};
const pct = (v) => `${+(v * 100).toFixed(2)}%`;
const perLine = (per, mult = 1) => Object.keys(per)
  .filter((k) => PER_WORDS[k])
  .map((k) => PER_WORDS[k](+(per[k] * mult).toFixed(4)))
  .join(", ");

/* What the walk adds up to, for the foot of the rail. Only the lines a tree
   actually moves are drawn, so a Rogue is never told its Veil absorption is nil. */
const plus = (v) => `+${pct(v)}`;
const flat = (v) => `+${+v.toFixed(2)}`;
const CARRY = [
  ["attackPct", "Attack", plus],
  ["defencePct", "Defence", plus],
  ["healthPct", "Health", plus],
  ["speedPct", "Swing speed", (v) => `${pct(v)} faster`],
  ["critFlat", "Crit chance", plus],
  ["critDmgFlat", "Crit damage", plus],
  ["penFlat", "Penetration", plus],
  ["veilFlat", "Veil a blow", flat],
  ["absorbFlat", "Veil a second", flat],
  ["techPct", "From a full Veil", plus],
];

/* The face of a node: a hex plate inside a ring of one segment a rank. 112 is the
   drawing's own grid and the CSS sizes it; the ring is the whole rank readout,
   because pips in a row read as pagination and a tree is not a carousel. */
const HEX = "90.64,76 56,96 21.36,76 21.36,36 56,16 90.64,36";
const HALO = "translate(56 56) scale(1.17) translate(-56 -56)";
const RING_R = 52;
const RING_MID = 56;
const RING_GAP = 11;      // degrees of dark between one rank and the next

function ringArc(i, n) {
  const step = 360 / n;
  const from = -90 + i * step + RING_GAP / 2;
  const to = -90 + (i + 1) * step - RING_GAP / 2;
  const at = (deg) => {
    const r = (deg * Math.PI) / 180;
    return `${(RING_MID + RING_R * Math.cos(r)).toFixed(2)} ${(RING_MID + RING_R * Math.sin(r)).toFixed(2)}`;
  };
  return `M${at(from)}A${RING_R} ${RING_R} 0 ${to - from > 180 ? 1 : 0} 1 ${at(to)}`;
}

function pathViewBuild(ctx) {
  let busy = false;
  let sheetNow = null;        // the last sheet drawn, for the tooltips and the rail
  let staged = new Map();     // node id -> ranks marked but not yet sealed
  let hand = null;            // the node the rail is reading
  let builtFor = null;        // the discipline the tree was built for
  let bands = [];
  let railSig = null;
  const cells = new Map();

  const stagedOn = (id) => staged.get(id) || 0;

  /* ---- the shell of the card ---- */

  const sub = h("p.card-sub");
  const pts = h("span.chip.chip-gold");
  const tree = h("div.path-tree");
  const rail = h("aside.path-rail");
  const body = h("div.path-body", tree, rail);

  const tallySpent = h("b");
  const tallyStaged = h("span.path-tally-staged");
  const tallyLeft = h("span.path-tally-left");
  const barSpent = h("i");
  const barStaged = h("i.is-staged");
  const tallyNote = h("p.path-tally-note");
  const reset = h("button.btn.btn-sm.btn-quiet", { type: "button" }, iconEl("sync"), "Reset");
  const seal = h("button.btn.btn-primary", { type: "button" });
  const foot = h("div.path-foot",
    h("div.path-tally",
      h("div.path-tally-top", tallySpent, tallyStaged, tallyLeft),
      h("div.path-bar", { "aria-hidden": "true" }, barSpent, barStaged),
      tallyNote),
    h("div.path-foot-acts", reset, seal));

  const node = h("section.card",
    h("div.card-head", h("div", h("h2.card-title", iconEl("book"), "Path"), sub), h("div.card-actions", pts)),
    body, foot);

  const locked = h("div.well", iconEl("lock"),
    h("span", `No path without a discipline. The Veil opens at Hunt ${CONFIG.progression.classPickLevel}, and the path opens with it.`));

  /* ---- the rail ---- */

  const R = {
    art: h("span.path-hand-art", { "aria-hidden": "true" }),
    name: h("h3.path-hand-name"),
    where: h("p.path-hand-where"),
    note: h("p.path-hand-note"),
    ranks: h("ol.path-ranks"),
    minus: h("button.path-step", { type: "button", "aria-label": "Take back a staged rank" }, "−"),
    count: h("b.path-step-count"),
    price: h("span.path-step-price"),
    plus: h("button.path-step.path-step-add", { type: "button", "aria-label": "Stage another rank" }, "+"),
    why: h("p.path-hand-why"),
    carry: h("div.path-carry"),
  };
  rail.append(
    h("section.path-panel.path-hand",
      h("div.eyebrow", "In hand"),
      h("div.path-hand-top", R.art, h("div", R.name, R.where)),
      R.note,
      R.ranks,
      h("div.path-stepper", R.minus, h("span.path-step-mid", R.count, R.price), R.plus),
      R.why),
    h("section.path-panel",
      h("div.eyebrow", "What the path carries"),
      R.carry));

  /* ================= what is staged, once it has been checked =================
     Replays every staged rank in band order and drops anything that no longer
     fits, so what the page draws is always something seal() can carry out. A
     band is judged on what is spent BEFORE the rank in question, exactly as
     blockedReason() judges it, or the page would offer a rank the engine
     refuses. */

  function effective(sheet) {
    const want = staged;
    const kept = new Map();
    let spent = sheet.spent;
    let left = sheet.earned - spent;
    sheet.nodes.slice().sort((a, b) => a.node.band - b.node.band).forEach((row) => {
      const def = row.node;
      let has = row.rank;
      let n = want.get(def.id) || 0;
      while (n > 0 && has < def.ranks && spent >= row.gate && left >= def.cost) {
        kept.set(def.id, (kept.get(def.id) || 0) + 1);
        spent += def.cost;
        left -= def.cost;
        has += 1;
        n -= 1;
      }
    });
    staged = kept;

    const rows = new Map();
    sheet.nodes.forEach((row) => {
      const def = row.node;
      const shown = row.rank + (kept.get(def.id) || 0);
      const open = spent >= row.gate;
      const short = row.gate - spent;
      rows.set(def.id, {
        open,
        shown,
        can: open && shown < def.ranks && left >= def.cost,
        why: !open ? `${short} more ${short === 1 ? "point" : "points"} on the path first.`
          : shown >= def.ranks ? "That is as far as it goes."
            : left < def.cost ? "No points left."
              : null,
      });
    });
    return { spent, left, mark: spent - sheet.spent, rows };
  }

  // The ranks on a node as a save would hold them, with or without what is staged.
  function bagOf(sheet, withStaged) {
    const bag = {};
    sheet.nodes.forEach((row) => {
      const n = row.rank + (withStaged ? stagedOn(row.node.id) : 0);
      if (n > 0) bag[row.node.id] = n;
    });
    return bag;
  }

  /* ================= staging ================= */

  function pick(id, take) {
    if (!sheetNow) return;
    const moved = hand !== id;
    hand = id;
    if (take) stage(id);
    else if (moved) paint(ctx);
  }

  function stage(id) {
    staged.set(id, stagedOn(id) + 1);
    paint(ctx);     // effective() drops it straight back out if it does not fit
  }

  function unstage(id) {
    const n = stagedOn(id);
    if (n <= 0) return;
    if (n === 1) staged.delete(id);
    else staged.set(id, n - 1);
    paint(ctx);
  }

  /* One command a rank, in band order, so a gate a lower band opens is already
     open when the next rank reaches it. The warning lives here now: this is the
     moment points stop being a sketch. */
  async function sealPath() {
    if (busy || !sheetNow) return;
    const plan = [];
    sheetNow.nodes.slice().sort((a, b) => a.node.band - b.node.band).forEach((row) => {
      for (let i = 0; i < stagedOn(row.node.id); i += 1) plan.push(row.node.id);
    });
    if (!plan.length) return;
    const names = [...new Set(plan)].map((id) => {
      const row = sheetNow.nodes.find((r) => r.node.id === id);
      const n = stagedOn(id);
      return `${row.node.name}${n > 1 ? ` ×${n}` : ""}`;
    });
    const yes = await confirm({
      title: plan.length === 1 ? "Seal one point?" : `Seal ${plan.length} points?`,
      body: `${names.join(", ")}. A point comes back only with a reset, which costs ${fmtGold(CONFIG.path.respecGold)} apiece.`,
      confirmText: plan.length === 1 ? "Spend the point" : `Spend ${plan.length} points`,
      art: "book",
    });
    if (!yes) return;
    busy = true;
    try {
      for (const id of plan) {
        await ctx.dispatch("walkPath", { node: id });
      }
    } finally {
      staged = new Map();
      busy = false;
      paint(ctx);
    }
  }

  reset.addEventListener("click", async () => {
    if (busy) return;
    const sheet = pathSheet(ctx.state);
    if (!sheet.spent) return;
    const yes = await confirmSpend(ctx, {
      title: "Take back every point?",
      body: `All ${sheet.spent} come back, and the path is yours to walk again. The oath itself stays where it is: a discipline is set once.`,
      gold: sheet.respecGold,
      confirmText: `Pay ${fmtGold(sheet.respecGold)}`,
      art: "sync",
    });
    if (!yes) return;
    busy = true;
    try {
      await ctx.dispatch("resetPath", {});
    } finally {
      staged = new Map();
      busy = false;
      paint(ctx);
    }
  });

  seal.addEventListener("click", sealPath);
  R.plus.addEventListener("click", () => { if (hand) stage(hand); });
  R.minus.addEventListener("click", () => { if (hand) unstage(hand); });

  /* ================= drawing ================= */

  /* What the tooltip says about a node: the name, the band it sits in, what a rank
     is worth, where it stands, and -- when it will not open -- why. Read fresh every
     time it opens, so it never contradicts the face under it. */
  function tipFor(id) {
    const row = sheetNow && sheetNow.nodes.find((r) => r.node.id === id);
    if (!row) return "";
    const def = row.node;
    const mark = stagedOn(id);
    const rows = [["Each rank", perLine(def.per)]];
    if (def.ranks > 1) rows.push(["Ranks", `${row.rank + mark} of ${def.ranks}`]);
    if (row.rank > 0) rows.push(["Now", perLine(def.per, row.rank), "gold"]);
    if (mark > 0) rows.push(["Staged", perLine(def.per, row.rank + mark)]);
    rows.push(["Cost", def.cost === 1 ? "1 point" : `${def.cost} points`]);
    const e = lastEff && lastEff.rows.get(id);
    return tipBody({
      title: def.name,
      sub: def.keystone ? "Keystone" : BAND_NAMES[def.band - 1] || `Band ${def.band}`,
      text: def.note,
      rows,
      foot: mark ? "Staged until the path is sealed." : (e && e.why) || "",
      footTone: mark ? null : e && e.can ? null : "bad",
    });
  }

  let lastEff = null;

  function faceFor(row) {
    const def = row.node;
    const segs = def.ranks > 1
      ? Array.from({ length: def.ranks }, (_, i) => h("path.path-seg", { d: ringArc(i, def.ranks) }))
      : [h("circle.path-seg", { cx: RING_MID, cy: RING_MID, r: RING_R })];
    const C = {
      segs,
      rank: h("span.path-rank"),
      lock: h("span.path-lock", { "aria-hidden": "true" }, iconEl("lock")),
    };
    C.face = h("button.path-face", { type: "button", dataset: { node: def.id } },
      h("svg.path-ring", { viewBox: "0 0 112 112", "aria-hidden": "true", focusable: "false" },
        def.keystone ? h("circle.path-hoop", { cx: RING_MID, cy: RING_MID, r: 60 }) : null,
        h("polygon.path-halo", { points: HEX, transform: HALO }),
        h("polygon.path-plate", { points: HEX }),
        ...segs),
      h("span.path-art", { "aria-hidden": "true" }, iconEl(def.icon || "book")),
      C.lock);
    C.node = h("div.path-node", { class: { "is-keystone": def.keystone } },
      C.face, h("span.path-name", def.name), C.rank);
    C.tip = tooltip(C.face, () => tipFor(def.id));
    return C;
  }

  // What sits under a face: where it stands, in as few words as it takes.
  function rankWord(def, held, mark) {
    const shown = held + mark;
    const tail = mark ? " · staged" : "";
    if (def.keystone) return shown ? `Taken${tail}` : `${def.cost} points`;
    if (!shown) return "";
    if (shown >= def.ranks) return `Walked out${tail}`;
    return `${roman(shown)} of ${roman(def.ranks)}${tail}`;
  }

  function paintFace(C, row, e) {
    const def = row.node;
    const mark = stagedOn(def.id);
    const shown = row.rank + mark;
    C.segs.forEach((seg, i) => {
      toggleClass(seg, "is-on", i < row.rank);
      toggleClass(seg, "is-staged", i >= row.rank && i < shown);
    });
    toggleClass(C.node, "is-shut", !e.open);
    toggleClass(C.node, "is-taken", shown > 0);
    toggleClass(C.node, "is-maxed", shown >= def.ranks);
    toggleClass(C.node, "is-staged", mark > 0);
    toggleClass(C.node, "is-ready", e.can);
    toggleClass(C.node, "is-hand", hand === def.id);
    setAttr(C.lock, "hidden", e.open);
    setText(C.rank, rankWord(def, row.rank, mark));
    setAttr(C.face, "aria-label",
      `${def.name}, ${shown} of ${def.ranks}${mark ? `, ${mark} staged` : ""}${e.open ? "" : ", shut"}`);
  }

  /* The tree is built once a discipline: its shape cannot change without the oath
     changing, and everything that moves is written in place. */
  function buildTree(sheet) {
    if (builtFor === sheet.klass) return;
    builtFor = sheet.klass;
    cells.forEach((C) => C.tip.destroy());
    cells.clear();
    bands = [];

    const byBand = new Map();
    sheet.nodes.forEach((row) => {
      if (!byBand.has(row.node.band)) byBand.set(row.node.band, []);
      byBand.get(row.node.band).push(row);
    });

    tree.replaceChildren(...[...byBand.keys()].sort((a, b) => a - b).map((band) => {
      const rows = byBand.get(band);
      const note = h("span.path-gate-note");
      const rung = h("div.path-rung", { class: { "path-rung-pair": rows.length <= 2 } },
        ...rows.map((row) => {
          const C = faceFor(row);
          cells.set(row.node.id, C);
          return C.node;
        }));
      const wrap = h("div.path-band",
        h("div.path-gate", h("span.eyebrow.path-gate-name", BAND_NAMES[band - 1] || `Band ${band}`), note),
        rung);
      bands.push({ band, wrap, note });
      return wrap;
    }));
  }

  function paintRail(sheet, eff) {
    const row = sheet.nodes.find((r) => r.node.id === hand);
    if (!row) return;
    const def = row.node;
    const e = eff.rows.get(def.id);
    const mark = stagedOn(def.id);
    const shown = row.rank + mark;

    const sig = `${def.id}|${row.rank}|${mark}|${e.can}|${e.open}|${eff.spent}|${eff.left}`;
    if (sig === railSig) return;
    railSig = sig;

    R.art.replaceChildren(iconEl(def.icon || "book"));
    setText(R.name, def.name);
    setText(R.where, def.keystone ? "Keystone" : BAND_NAMES[def.band - 1] || `Band ${def.band}`);
    setText(R.note, def.note);

    // Every rank, what it would come to, and which of them are yours.
    R.ranks.replaceChildren(...Array.from({ length: def.ranks }, (_, i) => {
      const n = i + 1;
      const where = n <= row.rank ? "held" : n <= shown ? "staged" : n === shown + 1 && e.can ? "next" : "";
      return h(`li.path-rank-row${where ? `.is-${where}` : ""}`,
        h("span.path-rank-no", def.ranks > 1 ? roman(n) : "•"),
        h("span.path-rank-what", perLine(def.per, n)),
        h("span.path-rank-tag", where === "held" ? "Taken" : where === "staged" ? "Staged" : where === "next" ? "Next" : ""));
    }));

    setText(R.count, def.ranks > 1
      ? (shown ? `${roman(shown)} of ${roman(def.ranks)}` : `None of ${roman(def.ranks)}`)
      : (shown ? "Taken" : "Not taken"));
    setText(R.price, def.cost === 1 ? "One point a rank" : `${def.cost} points`);
    R.minus.disabled = mark === 0;
    R.plus.disabled = !e.can;
    setText(R.why, mark ? "Staged. Nothing is spent until the path is sealed." : e.why || "");
    setAttr(R.why, "hidden", !(mark || e.why));

    const now = pathMods(sheet.klass, bagOf(sheet, false));
    const soon = pathMods(sheet.klass, bagOf(sheet, true));
    const lines = CARRY
      .filter(([key]) => now[key] || soon[key])
      .map(([key, label, words]) => h("div.path-carry-row",
        h("span.path-carry-label", label),
        h("span.path-carry-value", { class: { "is-staged": soon[key] !== now[key] } }, words(soon[key]))));
    R.carry.replaceChildren(...(lines.length
      ? lines
      : [h("p.path-carry-none", "Nothing on the path yet. Every rank lands on the same sheet your gear does.")]));
  }

  function paintFoot(sheet, eff) {
    setText(tallySpent, `${fmtWhole(sheet.spent)} spent`);
    setText(tallyStaged, eff.mark ? `${fmtWhole(eff.mark)} staged` : "");
    setAttr(tallyStaged, "hidden", !eff.mark);
    setText(tallyLeft, eff.left === 1 ? "1 still in hand" : `${fmtWhole(eff.left)} still in hand`);
    setWidth(barSpent, sheet.full ? (sheet.spent / sheet.full) * 100 : 0);
    setWidth(barStaged, sheet.full ? (eff.mark / sheet.full) * 100 : 0);
    setText(tallyNote, `${fmtWhole(sheet.spent + eff.mark)} of the ${sheet.full} this tree wants.${sheet.nextAt ? ` The next point comes at Hunt ${sheet.nextAt}.` : ""}`);
    reset.disabled = !sheet.spent || busy;
    seal.disabled = !eff.mark || busy;
    setText(seal, !eff.mark ? "Seal" : eff.mark === 1 ? "Seal one point" : `Seal ${eff.mark} points`);
  }

  function paint(next) {
    const state = next.state;
    const k = myClass(state);
    if (!k) {
      if (body.parentNode) node.removeChild(body);
      if (foot.parentNode) node.removeChild(foot);
      if (!locked.parentNode) node.appendChild(locked);
      setText(sub, "No discipline, no path.");
      setText(pts, "None");
      sheetNow = null;
      builtFor = null;
      return;
    }
    if (locked.parentNode) {
      node.removeChild(locked);
      node.append(body, foot);
    }

    const sheet = pathSheet(state);
    sheetNow = sheet;
    buildTree(sheet);
    const eff = effective(sheet);
    lastEff = eff;

    if (!hand || !cells.has(hand)) {
      const first = sheet.nodes.find((r) => r.rank > 0 && r.rank < r.node.ranks)
        || sheet.nodes.find((r) => eff.rows.get(r.node.id).can)
        || sheet.nodes[0];
      hand = first ? first.node.id : null;
    }

    setText(sub, `${k.name}. ${sheet.earned} ${sheet.earned === 1 ? "point" : "points"} earned of a tree that wants ${sheet.full}: what you leave out is the choice.`);
    setText(pts, eff.left === 1 ? "1 point to spend" : `${fmtWhole(eff.left)} points to spend`);

    bands.forEach((b) => {
      const gate = sheet.bands.find((x) => x.band === b.band);
      const at = gate ? gate.at : 0;
      const open = eff.spent >= at;
      const short = at - eff.spent;
      toggleClass(b.wrap, "is-shut", !open);
      setText(b.note, open
        ? (at ? `Open at ${at} spent` : "Open with the oath")
        : `${short} more ${short === 1 ? "point" : "points"} down the path`);
    });

    sheet.nodes.forEach((row) => {
      const C = cells.get(row.node.id);
      if (C) paintFace(C, row, eff.rows.get(row.node.id));
    });
    paintRail(sheet, eff);
    paintFoot(sheet, eff);
  }

  const offs = [
    on(tree, "click", "[data-node]", (e, t) => pick(t.dataset.node, true)),
    // Reading a node should not cost a click: the rail follows the pointer.
    on(tree, "pointerover", "[data-node]", (e, t) => pick(t.dataset.node, false)),
    on(tree, "focusin", "[data-node]", (e, t) => pick(t.dataset.node, false)),
  ];

  paint(ctx);
  return {
    node,
    update: paint,
    destroy() {
      offs.forEach((off) => off());
      cells.forEach((C) => C.tip.destroy());
      cells.clear();
    },
  };
}

const pathView = (ctx) => pathViewBuild(ctx);

/* ================= 1b. MASTERY ================= */

const M = CONFIG.mastery;
const pctText = (share) => `+${(share * 100).toFixed(1).replace(/\.0$/, "")}%`;

/* Who does carry this line, for the rows yours cannot. Saying "Warrior, Mage" is worth
   more than saying it is not yours, which the greying already says. */
function holders(line) {
  const names = GameData.CLASSES
    .filter((k) => classWeapons(k.id).includes(line))
    .map((k) => k.name);
  return names.length ? names.join(", ") : "Nobody carries this";
}

/* One line read closely, and then the whole track. The detail sits at the top,
   because it is what a player came for; the lines your discipline holds come next,
   and the ones it cannot are greyed underneath -- there to be seen, since what you
   gave up is worth seeing, and never in the way. Every number comes off
   masterySheet(), so the page has no arithmetic of its own to get wrong. */
function masteryView(ctx) {
  // The line last looked at, for the length of the session.
  let picked = null;
  const rows = new Map();     // line -> { node, level, grade, fill, bar }
  /* Where this camp stands in the realm, line by line: { line -> { rank, total } }.
     It is the realm's word, not this camp's, so it is asked for once on mount and
     nothing is shown until it lands. A realm that has not run migration 008 has no
     such call, and the page simply says nothing about rank rather than pretending
     nobody has any. */
  let ranks = new Map();
  let alive = true;

  const held = h("div.list");
  const shut = h("div.list");
  const shutHead = h("div.section-head.mastery-shut-head", h("h3.section-title", "Not yours to carry"));
  const detail = h("div");
  let detailFor = null;
  let D = null;

  const node = h("div.vstack.gap-4",
    detail,
    h("section.card.card-flush",
      h("div.card-head", { style: "padding: 0 var(--card-pad)" },
        h("div",
          h("h2.card-title", iconEl("swords"), "Weapon mastery"),
          h("p.card-sub", `One kill teaches one line: your off-hand when there is anything in it, your weapon when there is not. Maxed, a line is worth ${pctText(M.max * M.perLevel)} on what it does, and only while the piece is worn. Nothing but hunting moves it.`))),
      held,
      shutHead,
      shut));

  function rowFor(row) {
    const level = h("b");
    const grade = h("span.lr-sub");
    const fill = h("i");
    const bar = h("span.bar.bar-thin", { "aria-hidden": "true" }, fill);
    const btn = h("button.list-row", {
      type: "button", dataset: { line: row.line }, "aria-pressed": "false",
      style: "text-align: left; background: none; border-left: 0; border-right: 0; width: 100%; cursor: pointer;",
    },
      h("span.art.art-sm", { "aria-hidden": "true" }, iconEl(row.def.icon)),
      h("span.lr-main", h("span.lr-title", row.def.name), grade, bar),
      h("span.lr-end", level));
    return { node: btn, level, grade, fill, bar };
  }

  function buildDetail(row) {
    const R = {
      title: h("h3.card-title"), grade: h("span.tag.tag-violet"), rank: h("span.tag.tag-gold"),
      lvl: h("b"), xp: h("span"), fill: h("i"), bonus: h("p.card-sub"), stones: h("div.chip-row"),
      learning: h("p.small.muted"), note: h("p.small.muted"),
    };
    R.node = h("section.card.mastery-detail",
      h("div.card-head", h("div", R.title, R.bonus, R.learning), h("div.card-actions", R.grade, R.rank)),
      h("div.meter",
        h("div.meter-top", R.lvl, R.xp),
        h("div.bar.bar-gold", { "aria-hidden": "true" }, R.fill)),
      h("div.section-head", { style: "margin-top: var(--sp-4)" }, h("h4.section-title", "Milestones")),
      R.stones,
      R.note);
    return R;
  }

  function paintDetail(row) {
    if (detailFor !== row.line) {
      detailFor = row.line;
      D = buildDetail(row);
      detail.replaceChildren(D.node);
    }
    setText(D.title, row.def.name);
    setText(D.grade, row.maxed ? "Perfected" : row.grade);
    setAttr(D.grade, "hidden", !row.held);
    /* Rank is the realm's word, not this camp's: it arrives with the leaderboard
       and nothing is shown until it does. First on a line is not a grade but a
       title -- Saint -- and it is marked as one. */
    const rank = row.rank || null;
    setText(D.rank, rank === 1 ? M.saint : rank ? `Rank #${fmtWhole(rank)} of ${fmtWhole(row.of)}` : "");
    toggleClass(D.rank, "is-saint", rank === 1);
    setAttr(D.rank, "hidden", !rank);
    setText(D.learning, row.learning
      ? "This is what your hands are learning."
      : row.held ? "Carry it to learn it: your off-hand first, your weapon when the off-hand is empty." : "");
    setAttr(D.learning, "hidden", !row.held);

    setText(D.lvl, row.held ? `Mastery ${row.level}` : `${row.def.name} \u00b7 unlearned`);
    setText(D.xp, row.maxed ? "The whole of it" : row.held ? `${fmt(Math.floor(row.into))} / ${fmt(row.band)}` : "\u2014");
    setWidth(D.fill, row.held ? row.pct : 0);
    setText(D.bonus, row.held
      ? `${pctText(row.bonus)} ${row.def.name} ${row.stat === "defence" ? "Defence" : "damage"}, while it is held.`
      : `Your discipline does not hold a ${row.def.name.toLowerCase()}. The hours are there to be had if you never took one.`);
    D.stones.replaceChildren(...row.milestones.map((mi) => h(
      `span.chip${mi.won ? ".chip-gold" : ""}`,
      iconEl(mi.won ? "check" : "lock"),
      `${mi.name} \u00b7 ${mi.at}`)));
    setText(D.note, "A mastery is the piece, not the hunter: take it off and the bonus goes with it.");
  }

  function paint(next) {
    const sheet = masterySheet(next.state);
    sheet.forEach((row) => {
      const r = ranks.get(row.line);
      row.rank = r ? r.rank : 0;
      row.of = r ? r.total : 0;
    });
    if (!picked) picked = (sheet.find((r) => r.held && r.points > 0) || sheet.find((r) => r.held) || sheet[0]).line;

    let anyShut = false;
    sheet.forEach((row) => {
      if (!row.held) anyShut = true;
      let R = rows.get(row.line);
      if (!R) {
        R = rowFor(row);
        rows.set(row.line, R);
      }
      // Held lines on top, the rest underneath: appending an already-placed node moves it.
      (row.held ? held : shut).appendChild(R.node);
      // A line this discipline cannot hold reads as a dash under its own quiet heading.
      setText(R.level, row.held ? String(row.level) : "\u2014");
      setText(R.grade, row.held ? `${row.grade}${row.maxed ? "" : ` \u00b7 ${fmt(Math.floor(row.into))} / ${fmt(row.band)}`}` : holders(row.line));
      setWidth(R.fill, row.held ? row.pct : 0);
      setAttr(R.bar, "hidden", !row.held);
      toggleClass(R.node, "is-locked", !row.held);
      toggleClass(R.node, "is-learning", !!row.learning);
      setAttr(R.node, "aria-pressed", row.line === picked ? "true" : "false");
    });

    setAttr(shutHead, "hidden", !anyShut);
    setAttr(shut, "hidden", !anyShut);
    paintDetail(sheet.find((r) => r.line === picked) || sheet[0]);
  }

  async function askRanks() {
    const net = ctx.net;
    if (!net || typeof net.masteryRanks !== "function" || ctx.account.mode === "guest") return;
    let res;
    try {
      res = await net.masteryRanks();
    } catch (err) {
      return;
    }
    if (!alive || !res || res.missing || res.error) return;
    const next = new Map();
    res.rows.forEach((r) => {
      if (r && typeof r.line === "string") next.set(r.line, { rank: Number(r.rank) || 0, total: Number(r.total) || 0 });
    });
    ranks = next;
    paint(ctx);
  }

  const off = on(node, "click", "[data-line]", (e, t) => {
    if (t.dataset.line === picked) return;
    picked = t.dataset.line;
    paint(ctx);
  });

  paint(ctx);
  askRanks();
  return { node, update: paint, destroy() { alive = false; off(); } };
}

const TABS = [
  { id: "path", name: "Path", icon: "book", build: pathView },
  { id: "mastery", name: "Mastery", icon: "swords", build: (ctx) => masteryView(ctx) },
];

// The tab last opened, for the length of the session, as the Character page keeps its own.
const VIEW = { tab: TABS[0].id };

/* ================= 2. THE PAGE ================= */

export default {
  id: "discipline",
  title: () => "Discipline",
  group: "The Vanguard",

  mount(view, ctx) {
    if (!TABS.some((t) => t.id === VIEW.tab)) VIEW.tab = TABS[0].id;

    const row = h("div.char-tabs", { role: "tablist", "aria-label": "Discipline" },
      TABS.map((t) => h("button.chip", {
        type: "button", role: "tab", id: `discTab-${t.id}`,
        "aria-selected": "false", "aria-controls": `discPanel-${t.id}`,
        tabindex: "-1", dataset: { tab: t.id },
      }, iconEl(t.icon), t.name)));

    const select = h("select.select.char-tab-select", { "aria-label": "Discipline" },
      TABS.map((t) => h("option", { value: t.id }, t.name)));

    const parts = TABS.map((t) => {
      const part = t.build(ctx);
      part.wrap = h("div", {
        id: `discPanel-${t.id}`, role: "tabpanel", "aria-labelledby": `discTab-${t.id}`, hidden: true,
      }, part.node);
      return part;
    });

    function paintPick() {
      row.querySelectorAll("[role=tab]").forEach((t) => {
        const picked = t.dataset.tab === VIEW.tab;
        setAttr(t, "aria-selected", picked ? "true" : "false");
        setAttr(t, "tabindex", picked ? "0" : "-1");
      });
      if (select.value !== VIEW.tab) select.value = VIEW.tab;
      parts.forEach((p, i) => setAttr(p.wrap, "hidden", TABS[i].id !== VIEW.tab));
    }

    function choose(id, { focus = false } = {}) {
      if (!TABS.some((t) => t.id === id) || id === VIEW.tab) return;
      VIEW.tab = id;
      paintPick();
      if (!focus) return;
      const btn = row.querySelector(`[data-tab="${id}"]`);
      if (btn) btn.focus();
    }

    const offs = [
      on(row, "click", "[role=tab]", (e, t) => choose(t.dataset.tab)),
      // Arrow keys walk the tabs, as a tablist should.
      on(row, "keydown", "[role=tab]", (e, t) => {
        const i = TABS.findIndex((x) => x.id === t.dataset.tab);
        let next = -1;
        if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
        else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = TABS.length - 1;
        if (next < 0) return;
        e.preventDefault();
        choose(TABS[next].id, { focus: true });
      }),
    ];
    const onChange = () => choose(select.value);
    select.addEventListener("change", onChange);
    paintPick();

    const sub = h("p.page-sub");
    view.appendChild(h("div.page",
      h("header.page-head", h("div",
        h("div.eyebrow.page-eyebrow", "The Vanguard"),
        h("h1.page-title", "Discipline"),
        sub)),
      row, select, ...parts.map((p) => p.wrap)));

    const update = (next) => {
      const k = myClass(next.state);
      const lvl = skillLevel(next.state, "warfare");
      sub.textContent = k
        ? `${k.name} · ${k.veilName}. What the discipline becomes, and what your weapons owe you for the hours.`
        : `No discipline yet. The Veil opens at Hunt ${CONFIG.progression.classPickLevel}; you are Hunt ${lvl}.`;
    };
    update(ctx);

    return {
      update,
      unmount() {
        offs.forEach((off) => off());
        select.removeEventListener("change", onChange);
        parts.forEach((p) => p.destroy());
      },
    };
  },
};
