/* ============================================================
   Respite · pages/hiscores.js · The Roll of Honour
   ------------------------------------------------------------
   #/hiscores (UI-KIT 8.16): the realm's top fifty by total level
   or by any one skill, with your own row lit. Boards come from
   ctx.net.hiscores and are kept for the visit, so going back to
   one is instant while it quietly asks again. Tabs on desktop, a
   select on phones. Guests get a sign-in card instead.
   ============================================================ */

import { h, setText, setAttr, toggleClass, on } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { fmt, fmtWhole } from "../ui/format.js";
import { openPopup } from "../ui/widgets.js";
import { SKILL_ORDER, getSkill } from "../../shared/registry.js";
import { levelFromXp } from "../../shared/stats.js";

const TOP = 50;
const ASK_MS = 15 * 1000;
const BOARDS = [{ id: "total", name: "Total", title: "Total level", icon: "trophy" }]
  .concat(SKILL_ORDER.map(getSkill).map((s) => ({ id: s.id, name: s.name, title: s.name, icon: s.icon })));

const display = (name) => {
  const s = String(name == null ? "" : name);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Someone";
};

function signInCard(ctx) {
  return h("section.card",
    h("div.empty",
      h("div.empty-art", iconEl("lock")),
      h("div.empty-title", "Sign in to be counted"),
      h("p.empty-text", "The Hiscores rank commanders with a name. A guest's camp is kept nowhere, so it is counted nowhere. Make an account and yours joins the roll."),
      h("div.btn-row",
        h("button.btn.btn-gold", { type: "button", onClick: () => openPopup("account", ctx, { mode: "create" }) }, "Create account"),
        h("button.btn", { type: "button", onClick: () => openPopup("account", ctx, { mode: "signin" }) }, "Sign in"))));
}

export default {
  id: "hiscores",
  title: () => "Hiscores",
  group: "The Realm",

  mount(view, ctx) {
    const page = h("div.page");
    view.replaceChildren(page);
    let body = null;
    let who = null;

    function render() {
      const acc = ctx.account;
      who = `${acc.mode}:${acc.userId || ""}`;
      if (body) body.destroy();
      body = null;
      page.replaceChildren(h("header.page-head",
        h("div",
          h("div.eyebrow.page-eyebrow", "The Realm"),
          h("h1.page-title", "Hiscores"),
          h("p.page-sub", "The top fifty in the realm, by total level or by any one skill."))));
      if (acc.mode === "guest") page.append(signInCard(ctx));
      else body = boardBody(ctx, page);
    }

    render();
    return {
      update() {
        const acc = ctx.account;
        if (`${acc.mode}:${acc.userId || ""}` !== who) render();
      },
      unmount() {
        if (body) body.destroy();
        body = null;
      },
    };
  },
};

function boardBody(ctx, page) {
  let alive = true;
  let skill = "total";
  let token = 0;
  const cache = new Map();   // board id -> { rows, error }

  const tabs = h("div.hs-skills.hs-pick-tabs", { role: "tablist", "aria-label": "Board" },
    BOARDS.map((b) => h("button.chip", { type: "button", role: "tab", id: `hsTab-${b.id}`, "aria-selected": b.id === skill ? "true" : "false", tabindex: b.id === skill ? "0" : "-1", "aria-controls": "hsBoard", dataset: { board: b.id } },
      b.id === "total" ? null : iconEl(b.icon), b.name)));
  const select = h("select.select.hs-pick-select", { "aria-label": "Board" },
    BOARDS.map((b) => h("option", { value: b.id }, b.id === "total" ? "Total level" : b.name)));

  const title = h("h2.card-title");
  const meChip = h("span.chip", { hidden: true });
  const refreshBtn = h("button.btn.btn-quiet.btn-sm.btn-icon", { type: "button", "aria-label": "Refresh the board" }, iconEl("sync"));
  const box = h("div", { id: "hsBoard", role: "tabpanel", "aria-live": "polite" });

  page.append(tabs, select, h("section.card",
    h("div.card-head",
      h("div", title, h("p.card-sub", "Updated as commanders play")),
      h("div.card-actions", meChip, refreshBtn)),
    box));

  const board = () => BOARDS.find((b) => b.id === skill) || BOARDS[0];

  function choose(id, { focus = false } = {}) {
    if (!BOARDS.some((b) => b.id === id)) return;
    skill = id;
    tabs.querySelectorAll("[role=tab]").forEach((t) => {
      const picked = t.dataset.board === id;
      setAttr(t, "aria-selected", picked ? "true" : "false");
      setAttr(t, "tabindex", picked ? "0" : "-1");
      if (picked) {
        if (focus) t.focus();
        // Keep the chosen tab in view when the row scrolls.
        if (typeof t.scrollIntoView === "function") t.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
    if (select.value !== id) select.value = id;
    paint();
    load();
  }

  async function load() {
    const id = skill;
    const mine = ++token;
    toggleClass(refreshBtn, "is-loading", true);
    // A throw, or an answer that never comes, is shown as a failure rather than a board stuck loading.
    let res;
    let timer = 0;
    try {
      res = await Promise.race([
        Promise.resolve().then(() => ctx.net.hiscores(id, TOP)),
        new Promise((resolve) => { timer = setTimeout(() => resolve({ rows: null, error: "The realm is slow to answer." }), ASK_MS); }),
      ]);
    } catch (err) {
      res = { rows: null, error: "The road to the realm is closed." };
    } finally {
      clearTimeout(timer);
    }
    if (!alive || mine !== token) return;
    toggleClass(refreshBtn, "is-loading", false);
    const had = cache.get(id);
    if (!res || res.error) {
      // A board already on screen stays; only a board never seen shows the failure.
      if (!had || !had.rows) cache.set(id, { rows: null, error: String((res && res.error) || "The realm sent nothing back.") });
    } else {
      cache.set(id, { rows: Array.isArray(res.rows) ? res.rows.slice(0, TOP) : [], error: null });
    }
    paint();
  }

  function paint() {
    const b = board();
    setText(title, b.title);
    const got = cache.get(b.id);
    const acc = ctx.account;
    const me = String(acc.username || "").toLowerCase();

    if (!got) {
      meChip.hidden = true;
      setAttr(box, "aria-busy", "true");
      box.replaceChildren(skeleton());
      return;
    }
    setAttr(box, "aria-busy", "false");
    if (got.error) {
      meChip.hidden = true;
      box.replaceChildren(h("div.empty.empty-sm",
        h("div.empty-art", iconEl("offline")),
        h("div.empty-title", "The realm did not answer"),
        h("p.empty-text", `${got.error} Your camp is fine.`),
        h("button.btn.btn-sm", { type: "button", onClick: () => { cache.delete(b.id); paint(); load(); } }, iconEl("sync"), "Retry")));
      return;
    }
    if (!got.rows.length) {
      meChip.hidden = true;
      box.replaceChildren(h("div.empty.empty-sm",
        h("div.empty-art", iconEl(b.icon)),
        h("div.empty-title", "Nobody on this board yet"),
        h("p.empty-text", b.id === "total" ? "No commander has been counted yet." : `Nobody has trained ${b.name} yet. The first to do so tops it.`)));
      return;
    }

    const mineRow = me ? got.rows.find((r) => String(r.username || "").toLowerCase() === me) : null;
    meChip.hidden = false;
    setText(meChip, mineRow ? `You are #${fmtWhole(Number(mineRow.rank))}` : `Not in the top ${TOP}`);
    toggleClass(meChip, "chip-violet", !!mineRow);

    box.replaceChildren(h("div.table-wrap",
      h("table.table",
        h("caption.sr-only", `${b.title}: the top ${TOP}`),
        h("thead", h("tr",
          h("th", { scope: "col" }, "Rank"),
          h("th", { scope: "col" }, "Commander"),
          h("th.num", { scope: "col" }, b.id === "total" ? "Total level" : "Level"),
          h("th.num.hs-hide-sm", { scope: "col" }, "XP"))),
        h("tbody", got.rows.map((r, i) => {
          const rank = Number(r.rank) || i + 1;
          const isMe = mineRow === r;
          const xp = Number(r.xp) || 0;
          const level = r.level != null && Number.isFinite(Number(r.level)) ? Number(r.level) : levelFromXp(xp);
          return h("tr", { class: isMe && "is-me", "aria-current": isMe ? "true" : null },
            h("td", h("span.hs-rank", { class: rank <= 3 && `is-${rank}` }, fmtWhole(rank))),
            h("td.strong", h("span.hs-name",
              h("span.avatar.avatar-sm", { "data-tone": isMe ? null : "gold", "aria-hidden": "true" }, display(r.username).charAt(0)),
              h("span.truncate", display(r.username)),
              isMe ? h("span.tag.tag-violet", "You") : null)),
            h("td.num", fmtWhole(level)),
            h("td.num.hs-hide-sm", { title: `${fmtWhole(xp)} XP` }, fmt(xp)));
        })))));
  }

  function skeleton() {
    return h("div.table-wrap.realm-skel", { "aria-hidden": "true" },
      h("table.table",
        h("thead", h("tr", h("th", "Rank"), h("th", "Commander"), h("th.num", "Level"), h("th.num.hs-hide-sm", "XP"))),
        h("tbody", Array.from({ length: 8 }, () => h("tr",
          h("td", h("span.skel.skel-line.skel-w-35")),
          h("td", h("span.skel.skel-line.skel-w-60")),
          h("td", h("span.skel.skel-line.skel-w-50.ml-auto")),
          h("td.hs-hide-sm", h("span.skel.skel-line.skel-w-50.ml-auto")))))));
  }

  const offs = [
    on(tabs, "click", "[role=tab]", (e, t) => { if (t.dataset.board !== skill) choose(t.dataset.board); }),
    // Arrow keys walk the tabs, as a tablist should.
    on(tabs, "keydown", "[role=tab]", (e, t) => {
      const i = BOARDS.findIndex((b) => b.id === t.dataset.board);
      let next = -1;
      if (e.key === "ArrowRight") next = (i + 1) % BOARDS.length;
      else if (e.key === "ArrowLeft") next = (i - 1 + BOARDS.length) % BOARDS.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = BOARDS.length - 1;
      if (next < 0) return;
      e.preventDefault();
      choose(BOARDS[next].id, { focus: true });
    }),
  ];
  select.addEventListener("change", () => choose(select.value));
  refreshBtn.addEventListener("click", () => load());

  select.value = skill;
  paint();
  load();

  return {
    destroy() {
      alive = false;
      offs.forEach((off) => off());
    },
  };
}
