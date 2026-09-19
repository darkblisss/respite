/* ============================================================
   Respite · pages/discipline.js · The Discipline
   ------------------------------------------------------------
   Where a discipline is spent rather than chosen. Two tabs, both
   empty for now: the Path (what a Warrior, Rogue or Mage grows
   into) and Mastery (what a weapon owes you for the hours).

   The chosen discipline and the Veil stay on the Character page;
   this is the room they lead to, and it is deliberately bare
   until there is something real to put in it. The tab shell is
   the Character page's, so the three pages behave alike.
   ============================================================ */

import { h, on, setAttr } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { myClass, skillLevel } from "../../shared/stats.js";
import { CONFIG } from "../../shared/config.js";

/* ================= 1. THE TABS ================= */

function emptyCard(title, icon, blurb) {
  return {
    node: h("section.card",
      h("div.card-head", h("h2.card-title", title)),
      h("div.well", iconEl(icon), h("span", blurb))),
    update() {},
    destroy() {},
  };
}

const pathView = () => emptyCard(
  "Path",
  "book",
  "Nothing to walk yet. What a discipline grows into past the Veil will be laid out here, one choice at a time.");

const masteryView = () => emptyCard(
  "Mastery",
  "swords",
  "Nothing counted yet. What a weapon owes you for the hours spent carrying it will be kept here.");

const TABS = [
  { id: "path", name: "Path", icon: "book", build: pathView },
  { id: "mastery", name: "Mastery", icon: "swords", build: masteryView },
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
      }, t.name)));

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
