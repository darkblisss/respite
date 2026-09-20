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
import { fmt, fmtWhole } from "../ui/format.js";
import { myClass, skillLevel } from "../../shared/stats.js";
import { masterySheet } from "../../shared/mastery.js";
import { pathSheet } from "../../shared/path.js";
import { confirmSpend } from "../ui/widgets.js";
import { fmtGold } from "../ui/format.js";
import { CONFIG } from "../../shared/config.js";

/* ================= 1. THE TABS ================= */

/* ================= 1a. THE PATH ================= */

/* Ten nodes in three bands, and never quite enough points for all of them. Every
   number comes off pathSheet(), so the page does no arithmetic of its own. */

const BAND_NAMES = ["Groundwork", "The Craft", "Keystones"];

// "+3% Defence", "1.5s faster", "+2 Veil a blow" -- one line a rank, in the reader's words.
const PER_WORDS = {
  attackPct: (v) => `+${pct(v)} Attack`,
  defencePct: (v) => `+${pct(v)} Defence`,
  healthPct: (v) => `+${pct(v)} health`,
  speedPct: (v) => `${pct(v)} faster`,
  critFlat: (v) => `+${pct(v)} crit`,
  critDmgFlat: (v) => `+${pct(v)} crit damage`,
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

function pathViewBuild(ctx) {
  let busy = false;
  const cards = new Map();       // node id -> refs
  const bands = new Map();       // band -> { wrap, grid, head }

  const sub = h("p.card-sub");
  const pts = h("span.chip.chip-gold");
  const reset = h("button.btn.btn-sm.btn-quiet", { type: "button" }, iconEl("sync"), "Reset path");
  const body = h("div.vstack.gap-4");
  const node = h("section.card",
    h("div.card-head", h("div", h("h2.card-title", iconEl("book"), "Path"), sub), h("div.card-actions", pts, reset)),
    body);

  const locked = h("div.well", iconEl("lock"),
    h("span", `No path without a discipline. The Veil opens at Hunt ${CONFIG.progression.classPickLevel}, and the path opens with it.`));

  async function take(id) {
    if (busy) return;
    busy = true;
    try {
      await ctx.dispatch("walkPath", { node: id });
    } finally {
      busy = false;
    }
  }

  reset.addEventListener("click", async () => {
    if (busy) return;
    const sheet = pathSheet(ctx.state);
    if (!sheet.spent) return;
    const yes = await confirmSpend(ctx, {
      title: "Take back every point?",
      body: `All ${sheet.spent} come back at once, and the path is yours to walk again. The oath itself stays where it is: a discipline is set once.`,
      gold: sheet.respecGold,
      confirmText: `Pay ${fmtGold(sheet.respecGold)}`,
      art: "sync",
    });
    if (!yes) return;
    busy = true;
    try {
      await ctx.dispatch("resetPath", {});
    } finally {
      busy = false;
    }
  });

  function cardFor(row) {
    const R = {
      pips: h("span.chip-row.path-pips"),
      now: h("p.card-sub"),
      why: h("span.small.muted"),
      btn: h("button.btn.btn-sm.btn-soft", { type: "button", dataset: { node: row.node.id } }, "Take"),
    };
    R.node = h("article.card.path-node", { dataset: { node: row.node.id } },
      h("div.card-head",
        h("div",
          h("h3.card-title", row.node.name),
          h("p.card-sub", row.node.note)),
        h("div.card-actions", R.pips)),
      R.now,
      h("div.card-foot", R.why, R.btn));
    return R;
  }

  function paintCard(R, row) {
    const { node: def, rank } = row;
    R.pips.replaceChildren(...Array.from({ length: def.ranks }, (_, i) => h(
      `span.path-pip${i < rank ? ".is-on" : ""}`, { "aria-hidden": "true" })));
    setText(R.now, rank > 0
      ? `${perLine(def.per, rank)}${row.maxed ? "" : ` \u00b7 next rank ${perLine(def.per, rank + 1)}`}`
      : `${perLine(def.per)}${def.ranks > 1 ? ` a rank, ${def.ranks} ranks` : ""}`);
    setText(R.btn, row.maxed ? "Walked" : def.cost > 1 ? `Take \u00b7 ${def.cost} points` : "Take");
    R.btn.disabled = !row.can;
    setText(R.why, row.can || row.maxed ? "" : row.why || "");
    setAttr(R.why, "hidden", !!(row.can || row.maxed));
    toggleClass(R.node, "is-maxed", row.maxed);
    toggleClass(R.node, "is-shut", !row.open);
    toggleClass(R.node, "is-keystone", def.keystone);
  }

  function paint(next) {
    const state = next.state;
    const k = myClass(state);
    if (!k) {
      if (body.firstChild !== locked) body.replaceChildren(locked);
      setText(sub, "No discipline, no path.");
      setText(pts, "\u2014");
      reset.disabled = true;
      return;
    }

    const sheet = pathSheet(state);
    setText(sub, `${k.name}. ${sheet.earned} ${sheet.earned === 1 ? "point" : "points"} earned of a tree that wants ${sheet.full}: what you leave out is the choice.`);
    setText(pts, sheet.left === 1 ? "1 point to spend" : `${fmtWhole(sheet.left)} points to spend`);
    reset.disabled = !sheet.spent;

    sheet.bands.forEach(({ band, at, open }) => {
      let B = bands.get(band);
      if (!B) {
        const grid = h("div.grid-cards.max-2");
        const label = h("p.section-sub");
        B = { grid, label, wrap: h("div", h("div.section-head", h("h3.section-title", BAND_NAMES[band - 1] || `Band ${band}`), label), grid) };
        bands.set(band, B);
        body.appendChild(B.wrap);
      }
      setText(B.label, open
        ? at > 0 ? `Open \u00b7 ${at} points down` : "Open from the oath"
        : `${at - sheet.spent} more ${at - sheet.spent === 1 ? "point" : "points"} on the path opens this`);
      toggleClass(B.wrap, "is-shut", !open);
    });

    sheet.nodes.forEach((row) => {
      let R = cards.get(row.node.id);
      if (!R) {
        R = cardFor(row);
        cards.set(row.node.id, R);
        const B = bands.get(row.node.band);
        if (B) B.grid.appendChild(R.node);
      }
      paintCard(R, row);
    });
  }

  const off = on(body, "click", "[data-node]", (e, t) => {
    if (!t.disabled) take(t.dataset.node);
  });

  paint(ctx);
  return { node, update: paint, destroy() { off(); } };
}

const pathView = (ctx) => pathViewBuild(ctx);

/* ================= 1b. MASTERY ================= */

const M = CONFIG.mastery;
const pctText = (share) => `+${(share * 100).toFixed(1).replace(/\.0$/, "")}%`;

/* The whole track, and one line read closely. Every number comes off
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

  const list = h("div.list");
  const detail = h("div");
  let detailFor = null;
  let D = null;

  const node = h("section.card.card-flush",
    h("div.card-head", { style: "padding: 0 var(--card-pad)" },
      h("div",
        h("h2.card-title", iconEl("swords"), "Weapon mastery"),
        h("p.card-sub", `One kill teaches one line: your off-hand when there is anything in it, your weapon when there is not. Maxed, a line is worth ${pctText(M.max * M.perLevel)} on what it does, and only while the piece is worn. Nothing but hunting moves it.`))),
    list,
    detail);

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
      : row.held ? "Carry it to learn it: a kill teaches your off-hand, or your weapon when the off-hand is empty." : "");
    setAttr(D.learning, "hidden", !row.held);

    setText(D.lvl, row.held ? `Mastery ${row.level}` : "Not yours to hold");
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

    sheet.forEach((row) => {
      let R = rows.get(row.line);
      if (!R) {
        R = rowFor(row);
        rows.set(row.line, R);
        list.appendChild(R.node);
      }
      // A line this discipline cannot hold reads as a dash, and says so plainly.
      setText(R.level, row.held ? String(row.level) : "\u2014");
      setText(R.grade, row.held ? `${row.grade}${row.maxed ? "" : ` \u00b7 ${fmt(Math.floor(row.into))} / ${fmt(row.band)}`}` : "Not yours to hold");
      setWidth(R.fill, row.held ? row.pct : 0);
      setAttr(R.bar, "hidden", !row.held);
      toggleClass(R.node, "is-locked", !row.held);
      toggleClass(R.node, "is-learning", !!row.learning);
      setAttr(R.node, "aria-pressed", row.line === picked ? "true" : "false");
    });

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

  const off = on(list, "click", "[data-line]", (e, t) => {
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
