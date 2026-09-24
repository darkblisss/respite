/* ============================================================
   Respite · ui/profile.js · A Commander, Laid Out
   ------------------------------------------------------------
   The one card both the Character page (your own camp, off the
   save) and a commander's page (anyone, off player_profile())
   draw. Callers hand it a plain model; it never reads a save.

     the side   face, name, discipline and ground, the total level
                and the Hunt level side by side at one size; under
                them the numbers (Standing, Skills) or the
                Collection's kind list (Collection)
     the main   the tabs, then the worn figure, the skills with
                their progress, or the Collection's album

   Numbers: Health, Attack and Defence are pinned; every other
   stat is one list until there are more than SHEET_TAB_AT of
   them, and from then the list splits into its groups behind a
   segmented row. Nothing today has that many, so the row is
   there for later and draws nothing now.

   Extra tabs (the Record, on your own page) come in as
   { id, name, icon, node, update } and sit after the three.
   ============================================================ */

import { h, on, setText, setAttr, setWidth, toggleClass } from "./dom.js";
import { iconEl } from "./icons.js";
import { fmt, fmtWhole } from "./format.js";
import { portraitImg, paintPortrait } from "./widgets.js";
import { auraNode, paintAura, avatarHaloNode, paintAvatarHalo, haloTags } from "./halo.js";
import { collectionPanel } from "./collection.js";
import { paintDoll } from "../pages/armaments.js";
import { ARTISAN_ORDER, TRADE_ORDER, getSkill } from "../../shared/registry.js";

// More stats than this and the list splits into its groups.
export const SHEET_TAB_AT = 20;
const SHEET_GROUPS = ["Offence", "Defence", "Resist", "Utility"];

const pct = (x) => `${+((Number(x) || 0) * 100).toFixed(1)}%`;
const fmtNum = (x) => {
  const n = Number(x) || 0;
  return Number.isInteger(n) ? fmtWhole(n) : fmt(Math.round(n * 10) / 10);
};

/* The sheet a combatStats() result comes to: the pinned three, and the rest as
   rows with a group each (the groups only show once there are enough rows). */
export function sheetFrom(s, klass = null) {
  return {
    health: fmtWhole(s.maxHp),
    attack: fmtNum(s.attack),
    defence: fmtNum(s.defence),
    rows: [
      { id: "speed", label: "Attack Speed", value: `${(s.speed / 1000).toFixed(1)}s`, icon: "clock", group: "Offence" },
      { id: "crit", label: "Crit Chance", value: pct(s.crit), icon: "sparkle", group: "Offence" },
      { id: "critDmg", label: "Crit Damage", value: pct(s.critDmg), icon: "swords", group: "Offence" },
      { id: "pen", label: "Penetration", value: pct(s.pen), icon: "arrow-right", group: "Offence" },
      klass ? { id: "veil", label: "Veil", value: s.absorb ? `+${fmtNum(s.absorb)} a second` : `+${fmtNum(s.veilGain)} a blow`, icon: "moon", group: "Defence" } : null,
    ].filter(Boolean),
  };
}

/* ================= 1. THE SIDE ================= */

function sideTop() {
  const halo = avatarHaloNode();
  const face = h("div.portrait.portrait-bust.prof-portrait", portraitImg(null));
  const eyebrow = h("div.eyebrow.prof-eyebrow", "The Realm");
  const name = h("h1.prof-name");
  const tags = h("div.chip-row.prof-tags");
  const totalV = h("span.prof-lv-v");
  const huntV = h("span.prof-lv-v");
  const node = h("div.prof-top",
    h("div.prof-id", h("div.prof-face", halo, face), h("div.prof-id-text", eyebrow, name)),
    tags,
    h("div.prof-levels",
      h("div.prof-lv.is-total", h("span.eyebrow.prof-lv-l", "Total level"), totalV),
      h("div.prof-lv.is-hunt", h("span.eyebrow.prof-lv-l", "Hunt level"), huntV)));
  let skinSig;
  let tagSig = null;

  return {
    node,
    paint(m) {
      setText(name, m.name);
      if (m.eyebrow) setText(eyebrow, m.eyebrow);
      setText(totalV, fmtWhole(m.total));
      setText(huntV, fmtWhole(m.hunt));
      skinSig = paintPortrait(face, m.skin || null, skinSig);
      const halos = m.halos || {};
      const sig = [m.klass ? m.klass.id : "-", m.region ? m.region.id : "-", halos.neck ? halos.neck.id : "-",
        halos.ring ? halos.ring.id : "-", (m.extraTags || []).map((t) => t.textContent).join(",")].join("|");
      if (sig === tagSig) return;
      tagSig = sig;
      paintAvatarHalo(halo, halos);
      tags.replaceChildren(...[
        ...(m.extraTags || []),
        m.klass ? h("span.tag.tag-violet", m.klass.name) : h("span.tag", "Undisciplined"),
        m.region ? h("span.chip", iconEl("atlas"), m.region.name) : null,
      ].filter(Boolean));
    },
  };
}

function sheetView() {
  const big = ["Health", "Attack", "Defence"].map((l) => ({ l, v: h("span.prof-big-v") }));
  const segRow = h("div.seg.seg-full.prof-seg", { role: "tablist", "aria-label": "Stats", hidden: true });
  const list = h("div.prof-stats");
  const node = h("div.prof-sheet",
    h("div.prof-big", big.map((b) => h("div.prof-big-cell", h("span.eyebrow", b.l), b.v))),
    segRow, list);
  let group = SHEET_GROUPS[0];
  let rowsSig = null;
  let last = null;

  function drawRows() {
    const rows = last.rows;
    const split = rows.length > SHEET_TAB_AT;
    segRow.hidden = !split;
    const groups = SHEET_GROUPS.filter((g) => rows.some((r) => r.group === g));
    if (split && !groups.includes(group)) group = groups[0];
    if (split) {
      segRow.replaceChildren(...groups.map((g) => h("button.seg-btn", {
        type: "button", role: "tab", "aria-selected": g === group ? "true" : "false", dataset: { group: g },
      }, g)));
    }
    const shown = split ? rows.filter((r) => r.group === group) : rows;
    list.replaceChildren(...shown.map((r) => h("div.prof-stat",
      h("span.prof-stat-l", iconEl(r.icon || "sparkle"), r.label),
      h("span.prof-stat-v", r.value))));
  }

  on(segRow, "click", "[data-group]", (e, b) => {
    if (b.dataset.group === group) return;
    group = b.dataset.group;
    drawRows();
  });

  return {
    node,
    paint(sheet) {
      setText(big[0].v, sheet.health);
      setText(big[1].v, sheet.attack);
      setText(big[2].v, sheet.defence);
      last = sheet;
      const sig = JSON.stringify(sheet.rows);
      if (sig === rowsSig) return;
      rowsSig = sig;
      drawRows();
    },
  };
}

/* ================= 2. STANDING: THE FIGURE ================= */

function standingView({ onSlot }) {
  const left = h("div.doll-col");
  const right = h("div.doll-col");
  const bust = h("div.portrait", portraitImg(null));
  const aura = auraNode();
  const chip = h("div.prof-class");
  const doll = h("div.doll.doll-lg", left, h("div.doll-figure", h("div.figure-wrap", aura, bust)), right);
  const node = h("div.prof-standing", chip, doll);
  let eqSig = null;
  let skinSig;
  let haloSig = null;

  if (onSlot) on(doll, "click", "button.doll-slot[data-key]", (e, b) => onSlot(b.dataset.key));

  return {
    node,
    paint(m) {
      const eq = m.equipment || {};
      const sig = JSON.stringify(eq);
      if (sig !== eqSig) {
        eqSig = sig;
        paintDoll(left, right, eq);
        doll.querySelectorAll("button.doll-slot[data-key]").forEach((b) => setAttr(b, "aria-label", `${b.dataset.label}: ${b.dataset.name}`));
      }
      skinSig = paintPortrait(bust, m.skin || null, skinSig);
      const halos = m.halos || {};
      const hs = `${halos.neck ? halos.neck.id : ""}|${halos.ring ? halos.ring.id : ""}|${m.klass ? m.klass.id : ""}`;
      if (hs !== haloSig) {
        haloSig = hs;
        paintAura(aura, halos);
        chip.replaceChildren(...[m.klass ? h("span.chip.chip-violet", m.klass.name) : null, ...haloTags(halos)].filter(Boolean));
      }
    },
  };
}

/* ================= 3. SKILLS ================= */

// One skill: its glyph, name, what is left to the next level, the level, and a bar.
function skillCard(id, { hunt = false, link = false } = {}) {
  const s = getSkill(id);
  const sub = h("span.prof-skill-sub");
  const lv = h("span.prof-skill-lv");
  const fill = h("i");
  const barNode = h("div.bar.bar-thin", { class: hunt && "bar-good" }, fill);
  const node = h(link ? "a.prof-skill" : "div.prof-skill", { href: link ? `#/skill/${id}` : null, class: hunt && "is-hunt" },
    h("span.prof-skill-top",
      h("span.art.art-sm", { "data-tone": hunt ? "good" : "violet", "aria-hidden": "true" }, iconEl(s.icon)),
      h("span.prof-skill-text", h("span.prof-skill-name", s.name), sub),
      lv),
    barNode);
  let level = null;
  return {
    node,
    paint(p) {
      setText(lv, fmtWhole(p.level));
      const known = p.pct != null;
      barNode.hidden = !known;
      if (!known) {
        setText(sub, `Level ${fmtWhole(p.level)}`);
        return;
      }
      setText(sub, p.maxed ? "Mastered" : `${fmt(p.toNext)} XP to ${fmtWhole(p.level + 1)}`);
      toggleClass(fill, "nojump", level !== null && level !== p.level);
      level = p.level;
      setWidth(fill, p.pct);
    },
  };
}

function skillsView({ links }) {
  const totalChip = h("b");
  const hunt = skillCard("warfare", { hunt: true, link: links });
  const pairs = TRADE_ORDER.map((t, i) => [skillCard(t, { link: links }), skillCard(ARTISAN_ORDER[i], { link: links })]);
  const node = h("div.prof-skills",
    h("div.prof-panel-head", h("h2.prof-panel-title", "Skills"), h("span.chip.chip-gold", iconEl("trophy"), "Total ", totalChip)),
    hunt.node,
    h("div.prof-pairs",
      h("span.eyebrow.prof-pair-l", "Trade"), h("span.eyebrow.prof-pair-l", "Artisan"),
      pairs.flat().map((c) => c.node)));
  return {
    node,
    paint(m) {
      setText(totalChip, fmtWhole(m.total));
      const lv = (id) => (m.skills && m.skills[id]) || { level: 1, pct: null };
      hunt.paint(lv("warfare"));
      pairs.forEach(([a, b], i) => { a.paint(lv(TRADE_ORDER[i])); b.paint(lv(ARTISAN_ORDER[i])); });
    },
  };
}

/* ================= 4. THE CARD ================= */

const TABS = [
  { id: "standing", name: "Standing", icon: "shield" },
  { id: "skills", name: "Skills", icon: "book" },
  { id: "collection", name: "Collection", icon: "skull" },
];

// The tab last opened, for the length of the session, per kind of page.
const LAST = {};

/**
 * profileView({ key, onSlot, onEntry, links, extraTabs })
 *   key        which page this is, so each remembers its own tab ("self", "other")
 *   onSlot     a worn piece was pressed (its item key)
 *   onEntry    a seen Collection entry was pressed (see ui/collection.js)
 *   links      skill cards link to their pages (your own camp only)
 *   extraTabs  [{ id, name, icon, node, update(ctx) }] after the three
 * Returns { node, paint(model, ctx), destroy() }.
 */
export function profileView({ key = "self", onSlot = null, onEntry = null, links = false, extraTabs = [] } = {}) {
  const top = sideTop();
  const sheet = sheetView();
  const coll = collectionPanel({ onEntry });
  const standing = standingView({ onSlot });
  const skills = skillsView({ links });
  const tabs = TABS.concat(extraTabs.map((t) => ({ id: t.id, name: t.name, icon: t.icon, extra: t })));
  if (!tabs.some((t) => t.id === LAST[key])) LAST[key] = tabs[0].id;

  const bodies = {
    standing: standing.node,
    skills: skills.node,
    collection: coll.node,
  };
  extraTabs.forEach((t) => { bodies[t.id] = t.node; });

  const row = h("div.char-tabs.prof-tabs", { role: "tablist", "aria-label": "Commander" },
    tabs.map((t) => h("button.chip", {
      type: "button", role: "tab", id: `prof-${key}-${t.id}`, "aria-selected": "false", tabindex: "-1",
      "aria-controls": `prof-${key}-${t.id}-panel`, dataset: { tab: t.id },
    }, iconEl(t.icon), t.name)));
  const panels = tabs.map((t) => h("div.prof-panel", {
    id: `prof-${key}-${t.id}-panel`, role: "tabpanel", "aria-labelledby": `prof-${key}-${t.id}`, hidden: true, dataset: { tab: t.id },
  }, bodies[t.id]));

  const sideLower = h("div.prof-lower", sheet.node, coll.filters);
  const node = h("section.prof",
    h("div.prof-side", top.node, sideLower),
    h("div.prof-main", row, ...panels));

  let model = null;
  let ctxNow = null;

  function paintTab() {
    const tab = LAST[key];
    row.querySelectorAll("[role=tab]").forEach((b) => {
      const on2 = b.dataset.tab === tab;
      setAttr(b, "aria-selected", on2 ? "true" : "false");
      setAttr(b, "tabindex", on2 ? "0" : "-1");
    });
    panels.forEach((p) => setAttr(p, "hidden", p.dataset.tab !== tab));
    // The Collection's kinds take the numbers' place at the side.
    sheet.node.hidden = tab === "collection";
    coll.filters.hidden = tab !== "collection";
    toggleClass(node, "is-collection", tab === "collection");
  }

  function paintBody() {
    if (!model) return;
    const tab = LAST[key];
    if (tab === "standing") standing.paint(model);
    else if (tab === "skills") skills.paint(model);
    else if (tab === "collection") coll.paint(model.rolls || {});
    else {
      const t = tabs.find((x) => x.id === tab);
      if (t && t.extra && typeof t.extra.update === "function") t.extra.update(ctxNow, model);
    }
  }

  function choose(id, focus = false) {
    if (id === LAST[key] || !tabs.some((t) => t.id === id)) return;
    LAST[key] = id;
    paintTab();
    paintBody();
    if (focus) {
      const b = row.querySelector(`[data-tab="${id}"]`);
      if (b) b.focus();
    }
  }

  const offs = [
    on(row, "click", "[role=tab]", (e, b) => choose(b.dataset.tab)),
    on(row, "keydown", "[role=tab]", (e, b) => {
      const i = tabs.findIndex((t) => t.id === b.dataset.tab);
      let next = -1;
      if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      if (next < 0) return;
      e.preventDefault();
      choose(tabs[next].id, true);
    }),
  ];

  paintTab();

  return {
    node,
    paint(next, ctx = null) {
      model = next;
      ctxNow = ctx;
      top.paint(model);
      sheet.paint(model.sheet);
      paintBody();
    },
    destroy() {
      offs.forEach((off) => off());
      coll.destroy();
    },
  };
}
