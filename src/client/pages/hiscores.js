/* ============================================================
   Respite · pages/hiscores.js · The Roll of Honour
   ------------------------------------------------------------
   #/hiscores (UI-KIT 8.16): the realm's top fifty, board by
   board. Six tabs, and the three with more than one list carry a
   second row under them: Total, Hunt (by discipline), Gathering
   (by trade), Artisans (by bench), Wealth, Monsters killed. Both
   rows are chips on wide screens and a select on phones, the
   pattern pages.css already carries for this page.

   Boards come from ctx.net.hiscores (Total, the trades, the
   benches: every realm answers those) and ctx.net.leaderboard
   (Hunt by discipline and kills need migration 004, Wealth needs
   005). Anything a realm does not keep says so plainly instead
   of showing a made up list.

   Wealth ranks what a player has *made*, summed as they made it
   (stats.selfMade), not what they are holding: nothing bought,
   traded or looted counts, so no one can buy a place on it.

   Answers are kept for the visit, so going back to a board is
   instant and asks the realm nothing again (the refresh button
   is there for a fresher one), and the chosen tab and row are
   remembered for the session. Guests get a sign-in card.
   ============================================================ */

import { h, setText, setAttr, toggleClass, on } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { fmt, fmtWhole } from "../ui/format.js";
import { openPopup } from "../ui/widgets.js";
import { GameData, TRADE_ORDER, ARTISAN_ORDER, getSkill } from "../../shared/registry.js";
import { levelFromXp } from "../../shared/stats.js";

const TOP = 50;
const ASK_MS = 15 * 1000;

/* A board is one list. `ask` says who answers it: "skill" is hiscores() from schema.sql,
   "board" is the leaderboard() migration 004 adds, null is nobody yet. `num` names the number
   column, `oneFigure` is a board that is a single count rather than a level and its XP, `note`
   replaces the card's sub line where a board needs to say what it counts, and `mark` is the
   discipline a Hunt board is for. */
const skillBoard = (id) => {
  const s = getSkill(id);
  return {
    id, name: s.name, title: s.name, icon: s.icon, num: "Level",
    ask: { how: "skill", key: id },
    empty: `Nobody has trained ${s.name} yet. The first to do so tops it.`,
  };
};

/* Every hunter on one ladder, whatever they chose and whether they chose at all.
   It reads the Hunt skill straight out of hiscores(), the same way a trade board
   does, so it needs nothing of the leaderboard() migration and it ranks the
   undisciplined beside the rest -- which is the only way to compare across
   disciplines honestly. */
const huntAllBoard = {
  id: "hunt_all", name: "All", title: "Hunt", icon: "swords", num: "Level",
  ask: { how: "skill", key: "warfare" },
  empty: "Nobody has taken the vanguard yet. The first to swing at anything tops it.",
};

const huntBoard = (c) => ({
  id: `hunt_${c.id}`, name: c.name, title: c.name, icon: c.icon, num: "Level", mark: c.id,
  ask: { how: "board", key: `hunt_${c.id}` },
  empty: `Nobody hunts as a ${c.name} yet, and nobody without a discipline has swung at anything either.`,
  unkept: "The realm does not sort its hunters by discipline yet, so nothing is ranked here.",
});

const TABS = [
  {
    id: "total", name: "Total", icon: "trophy",
    boards: [{
      id: "total", name: "Total", title: "Total level", icon: "trophy", num: "Total level",
      ask: { how: "skill", key: "total" },
      empty: "No commander has been counted yet.",
    }],
  },
  { id: "hunt", name: "Hunt", icon: "swords", pick: "Discipline", boards: [huntAllBoard, ...GameData.CLASSES.map(huntBoard)] },
  { id: "gathering", name: "Gathering", icon: "pick", pick: "Trade", boards: TRADE_ORDER.map(skillBoard) },
  { id: "artisans", name: "Artisans", icon: "hammer", pick: "Bench", boards: ARTISAN_ORDER.map(skillBoard) },
  {
    id: "wealth", name: "Wealth", icon: "coin",
    boards: [{
      id: "wealth", name: "Wealth", title: "Wealth of your own making", icon: "coin", num: "Value", oneFigure: true,
      ask: { how: "board", key: "wealth" },
      /* It ranks what a player has produced, not what they are holding, and the sub line says
         so: selling what you made does not take it back off you. Holdings restricted to
         self-made things would need provenance on every stack. */
      note: "Counted as you make it: what you pull out of the ground, and what a bench adds over the materials it ate. Nothing bought, traded or looted, so no one can buy a place here.",
      empty: "Nobody has made anything yet.",
      unkept: "The realm keeps no tally of what players make yet, so nothing is ranked here.",
    }],
  },
  {
    id: "kills", name: "Monsters killed", icon: "skull",
    boards: [{
      id: "kills", name: "Monsters killed", title: "Monsters killed", icon: "skull", num: "Kills", oneFigure: true,
      ask: { how: "board", key: "kills" },
      empty: "Nothing has been killed yet.",
      unkept: "The realm keeps no tally of kills yet, so nothing is ranked here.",
    }],
  },
];

const tabOf = (id) => TABS.find((t) => t.id === id) || TABS[0];

// Remembered for the session, so coming back to the page opens on the board you left.
let openTab = TABS[0].id;
const openSub = new Map();

const display = (name) => {
  const s = String(name == null ? "" : name);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Someone";
};

function signInCard(ctx) {
  return h("section.card",
    h("div.empty",
      h("div.empty-art", iconEl("lock")),
      h("div.empty-title", "Sign in to be counted"),
      h("p.empty-text", "The Leaderboard ranks commanders with a name. A guest's camp is kept nowhere, so it is counted nowhere. Make an account and yours joins the roll."),
      h("div.btn-row",
        h("button.btn.btn-gold", { type: "button", onClick: () => openPopup("account", ctx, { mode: "create" }) }, "Create account"),
        h("button.btn", { type: "button", onClick: () => openPopup("account", ctx, { mode: "signin" }) }, "Sign in"))));
}

export default {
  id: "hiscores",
  title: () => "Leaderboard",
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
          h("h1.page-title", "Leaderboard"),
          h("p.page-sub", "The realm's top fifty, board by board."))));
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

/* A row of chip tabs with the same list as a select beside it: the chips on wide screens, the
   select on phones (pages.css, Hiscores). Both levels of the page use one. */
function picker(name, onPick) {
  const tabs = h("div.hs-skills.hs-pick-tabs", { role: "tablist", "aria-label": name });
  const select = h("select.select.hs-pick-select", { "aria-label": name });
  let items = [];

  function fill(next, id) {
    items = next.slice();
    tabs.replaceChildren(...items.map((it) => h("button.chip", {
      type: "button",
      role: "tab",
      "aria-selected": it.id === id ? "true" : "false",
      tabindex: it.id === id ? "0" : "-1",
      "aria-controls": "hsBoard",
      dataset: { pick: it.id },
    }, it.icon ? iconEl(it.icon) : null, it.name)));
    select.replaceChildren(...items.map((it) => h("option", { value: it.id }, it.name)));
    select.value = id;
  }

  function mark(id, { focus = false } = {}) {
    tabs.querySelectorAll("[role=tab]").forEach((t) => {
      const picked = t.dataset.pick === id;
      setAttr(t, "aria-selected", picked ? "true" : "false");
      setAttr(t, "tabindex", picked ? "0" : "-1");
      if (!picked) return;
      if (focus) t.focus();
      // Keep the chosen tab in view when the row scrolls.
      if (typeof t.scrollIntoView === "function") t.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    if (select.value !== id) select.value = id;
  }

  const offs = [
    on(tabs, "click", "[role=tab]", (e, t) => onPick(t.dataset.pick)),
    // Arrow keys walk the tabs, as a tablist should.
    on(tabs, "keydown", "[role=tab]", (e, t) => {
      const i = items.findIndex((it) => it.id === t.dataset.pick);
      let next = -1;
      if (e.key === "ArrowRight") next = (i + 1) % items.length;
      else if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = items.length - 1;
      if (next < 0) return;
      e.preventDefault();
      onPick(items[next].id, { focus: true });
    }),
  ];
  select.addEventListener("change", () => onPick(select.value));

  return { tabs, select, fill, mark, destroy: () => offs.forEach((off) => off()) };
}

function boardBody(ctx, page) {
  let alive = true;
  let token = 0;
  const cache = new Map();   // board id -> { rows, error, unkept }

  const tabPick = picker("Board", (id, opts) => chooseTab(id, opts));
  const subPick = picker("List", (id, opts) => chooseBoard(id, opts));
  const subLabel = h("span.eyebrow.lb-sub-label");
  const subRow = h("div.lb-sub", subLabel, subPick.tabs, subPick.select);

  const eyebrow = h("div.eyebrow");
  const title = h("h2.card-title");
  const cardSub = h("p.card-sub");
  const meChip = h("span.chip", { hidden: true });
  const refreshBtn = h("button.btn.btn-quiet.btn-sm.btn-icon", { type: "button", "aria-label": "Refresh the board" }, iconEl("sync"));
  const box = h("div", { id: "hsBoard", role: "tabpanel", "aria-live": "polite" });

  page.append(
    h("div.lb-picks", tabPick.tabs, tabPick.select, subRow),
    h("section.card",
      h("div.card-head",
        h("div", eyebrow, title, cardSub),
        h("div.card-actions", meChip, refreshBtn)),
      box),
  );

  const tab = () => tabOf(openTab);
  function board() {
    const t = tab();
    const id = openSub.get(t.id);
    return t.boards.find((b) => b.id === id) || t.boards[0];
  }

  /* The second row only exists for a tab with more than one list, so it is rebuilt when the tab
     changes and emptied for Total, Wealth and kills: a hidden row that keeps the last tab's
     chips is still a row of stale tabs to a reader. */
  function fillSub() {
    const t = tab();
    const many = t.boards.length > 1;
    const name = t.pick || "List";
    subRow.hidden = !many;
    if (!t.boards.some((b) => b.id === openSub.get(t.id))) openSub.set(t.id, t.boards[0].id);
    setText(subLabel, many ? name : "");
    setAttr(subPick.tabs, "aria-label", name);
    setAttr(subPick.select, "aria-label", name);
    subPick.fill(many ? t.boards : [], openSub.get(t.id));
  }

  function chooseTab(id, opts) {
    if (!TABS.some((t) => t.id === id)) return;
    if (id === openTab) {
      tabPick.mark(id, opts);
      return;
    }
    openTab = id;
    tabPick.mark(id, opts);
    fillSub();
    show();
  }

  function chooseBoard(id, opts) {
    const t = tab();
    if (!t.boards.some((b) => b.id === id)) return;
    if (id === openSub.get(t.id)) {
      subPick.mark(id, opts);
      return;
    }
    openSub.set(t.id, id);
    subPick.mark(id, opts);
    show();
  }

  /* An answer kept from earlier in the visit stands: switching boards and back asks the realm
     nothing, and the refresh button is there for a fresher one. A board that failed, or one
     never seen, is asked for. */
  function show() {
    paint();
    const got = cache.get(board().id);
    if (!got || (!got.rows && !got.unkept)) load();
  }

  // One shape for every source, so paint() never asks who answered.
  async function ask(b) {
    if (!b.ask) return { rows: null, error: null, unkept: true };
    if (b.ask.how === "skill") {
      const res = await ctx.net.hiscores(b.ask.key, TOP);
      return { rows: res.rows, error: res.error, unkept: false };
    }
    // An older net (the page stub, a realm from before) has no such call: that board is unkept.
    if (typeof ctx.net.leaderboard !== "function") return { rows: null, error: null, unkept: true };
    const res = await ctx.net.leaderboard(b.ask.key, TOP);
    if (res.missing) return { rows: null, error: null, unkept: true };
    return { rows: res.rows, error: res.error, unkept: false };
  }

  async function load() {
    const b = board();
    const id = b.id;
    const mine = ++token;
    // A board nobody keeps is never asked for: there is nothing at the other end.
    if (!b.ask) {
      cache.set(id, { rows: null, error: null, unkept: true });
      paint();
      return;
    }
    toggleClass(refreshBtn, "is-loading", true);
    // A throw, or an answer that never comes, is shown as a failure rather than a board stuck loading.
    let res;
    let timer = 0;
    try {
      res = await Promise.race([
        Promise.resolve().then(() => ask(b)),
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
    if (res && res.unkept) {
      cache.set(id, { rows: null, error: null, unkept: true });
    } else if (!res || res.error) {
      // A board already on screen stays; only a board never seen shows the failure.
      if (!had || !had.rows) cache.set(id, { rows: null, error: String((res && res.error) || "The realm sent nothing back."), unkept: false });
    } else {
      cache.set(id, { rows: Array.isArray(res.rows) ? res.rows.slice(0, TOP) : [], error: null, unkept: false });
    }
    paint();
  }

  function paint() {
    const t = tab();
    const b = board();
    // The eyebrow names the tab only where the tab and the board are not the same thing, so
    // Monsters killed is not written twice over.
    const many = t.boards.length > 1;
    eyebrow.hidden = !many;
    setText(eyebrow, many ? t.name : "");
    setText(title, b.title);
    const full = many ? `${t.name}: ${b.title}` : b.title;
    const got = cache.get(b.id);
    const acc = ctx.account;
    const me = String(acc.username || "").toLowerCase();
    refreshBtn.hidden = !b.ask;
    // A board with a note says what it actually counts, which Wealth needs more than "updated".
    setText(cardSub, b.note || (b.ask ? "Updated as commanders play" : "Nothing is kept for this board yet"));

    if (!got) {
      meChip.hidden = true;
      setAttr(box, "aria-busy", "true");
      box.replaceChildren(skeleton(b));
      return;
    }
    setAttr(box, "aria-busy", "false");
    if (got.unkept) {
      meChip.hidden = true;
      setText(cardSub, "Nothing is kept for this board yet");
      box.replaceChildren(h("div.empty.empty-sm",
        h("div.empty-art", iconEl("hourglass")),
        h("div.empty-title", "This board is not kept yet"),
        h("p.empty-text", b.unkept || "The realm keeps no such roll yet, so nothing is ranked here.")));
      return;
    }
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
        h("p.empty-text", b.empty || "Nobody has been counted here yet.")));
      return;
    }

    const mineRow = me ? got.rows.find((r) => String(r.username || "").toLowerCase() === me) : null;
    meChip.hidden = false;
    setText(meChip, mineRow ? `You are #${fmtWhole(Number(mineRow.rank))}` : `Not in the top ${TOP}`);
    toggleClass(meChip, "chip-violet", !!mineRow);

    box.replaceChildren(h("div.table-wrap",
      h("table.table",
        h("caption.sr-only", `${full}: the top ${TOP}`),
        h("thead", h("tr",
          h("th", { scope: "col" }, "Rank"),
          h("th", { scope: "col" }, "Commander"),
          h("th.num", { scope: "col" }, b.num),
          b.oneFigure ? null : h("th.num.hs-hide-sm", { scope: "col" }, "XP"))),
        h("tbody", got.rows.map((r, i) => {
          const rank = Number(r.rank) || i + 1;
          const isMe = mineRow === r;
          const xp = Number(r.xp) || 0;
          const level = r.level != null && Number.isFinite(Number(r.level)) ? Number(r.level) : levelFromXp(xp);
          // The author's rule: a hunter with no discipline stands on all three boards, so say
          // which rows those are rather than letting them read as Warriors.
          const loose = !!b.mark && !r.discipline;
          return h("tr", { class: isMe && "is-me", "aria-current": isMe ? "true" : null },
            h("td", h("span.hs-rank", { class: rank <= 3 && `is-${rank}` }, fmtWhole(rank))),
            h("td.strong", h("span.hs-name",
              h("span.avatar.avatar-sm", { "data-tone": isMe ? null : "gold", "aria-hidden": "true" }, display(r.username).charAt(0)),
              h("span.truncate", display(r.username)),
              loose ? h("span.tag.hs-hide-sm", "Undisciplined") : null)),
            h("td.num", b.oneFigure ? fmtWhole(xp) : fmtWhole(level)),
            b.oneFigure ? null : h("td.num.hs-hide-sm", { title: `${fmtWhole(xp)} XP` }, fmt(xp)));
        })))));
  }

  function skeleton(b) {
    return h("div.table-wrap.realm-skel", { "aria-hidden": "true" },
      h("table.table",
        h("thead", h("tr", h("th", "Rank"), h("th", "Commander"), h("th.num", b.num), b.oneFigure ? null : h("th.num.hs-hide-sm", "XP"))),
        h("tbody", Array.from({ length: 8 }, () => h("tr",
          h("td", h("span.skel.skel-line.skel-w-35")),
          h("td", h("span.skel.skel-line.skel-w-60")),
          h("td", h("span.skel.skel-line.skel-w-50.ml-auto")),
          b.oneFigure ? null : h("td.hs-hide-sm", h("span.skel.skel-line.skel-w-50.ml-auto")))))));
  }

  refreshBtn.addEventListener("click", () => load());

  tabPick.fill(TABS, openTab);
  fillSub();
  show();

  return {
    destroy() {
      alive = false;
      tabPick.destroy();
      subPick.destroy();
    },
  };
}
