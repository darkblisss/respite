/* ============================================================
   Respite · shell.js · The Tent Poles
   ------------------------------------------------------------
   Everything around the page: the topbar (the crews, the hunt,
   gold, health, the connection), the sidebar and its rows, the
   weather card, the banners and the camp log.

   Built once and painted in place several times a second. A
   part is rebuilt only when its shape changes: a nav row comes
   or goes, a dot or badge appears, the day turns, a banner is
   raised. Numbers and bars never rebuild anything.
   ============================================================ */

import { h, el, setText, setWidth, setAttr, toggleClass } from "./dom.js";
import { iconEl } from "./icons.js";
import { fmtAgo, fmtTime, fmtWhole, signedPct, titleCase } from "./format.js";
import { CONFIG } from "../../shared/config.js";
import { ARTISAN_ORDER, TRADE_ORDER, getSkill, getZone, regionOfTier, sovereignOf, skillName } from "../../shared/registry.js";
import { skillPlan } from "../../shared/skills.js";
import { campPlan, combatPlan } from "../../shared/combat.js";
import { maxHp, myClass, recovering, skillLevel } from "../../shared/stats.js";
import { slotCap, slotsUsed } from "../../shared/storage.js";
import { requisitionsLeft, requisitionsOpen } from "../../shared/world.js";
import { dayIndex, tomorrowRevealed, weatherAt, weatherForDay } from "../../shared/weather.js";

/* ================= 1. THE NAV ================= */

const TRADES = TRADE_ORDER;
const ARTISANS = ARTISAN_ORDER;

const bountyReady = (s) => !!(s.bounty && !s.bounty.claimed && s.bounty.progress >= s.bounty.amount);

function skillRow(id) {
  const skill = getSkill(id);
  return {
    route: { page: "skill", arg: id },
    label: skill.name,
    icon: skill.icon,
    meta: (s) => `Lv ${skillLevel(s, id)}`,
    dot: (s) => (s.tasks.skilling && s.tasks.skilling.skillId === id ? "violet" : null),
  };
}

// Groups and rows as UI-REQUIREMENTS lays them out. shown() false: the row is not built at all.
// The hunter's own pages first, then the realm (the online places), then the camp. The skill
// lists come last: they are also one tap away on the Character page.
const NAV = [
  { id: "navVanguard", rows: [
    { route: { page: "character" }, label: "Character", icon: "person" },
    // Inventory sits above the Hunt: what you carry into a fight, then the fight.
    { route: { page: "armaments" }, label: "Inventory", icon: "plate", meta: (s) => `${slotsUsed(s, "inv")}/${slotCap(s, "inv")}` },
    { route: { page: "discipline" }, label: "Discipline", icon: "book", meta: (s) => (myClass(s) ? myClass(s).name : "-") },
    { route: { page: "skill", arg: "warfare" }, label: "Hunt", icon: "swords",
      meta: (s) => `Lv ${skillLevel(s, "warfare")}`, dot: (s) => (s.tasks.combat ? "ember" : null) },
    // Companions are out of the live camp until the system is redesigned. Re-enable this row with the route in router.js.
    // { route: { page: "companions" }, label: "Companions", icon: "paw" },
  ] },
  { id: "navRealm", rows: [
    { route: { page: "atlas" }, label: "Atlas", icon: "atlas" },
    { route: { page: "market" }, label: "Market", icon: "market" },
    { route: { page: "party" }, label: "Party", icon: "party",
      badge: (s, store) => {
        const n = store.party && Array.isArray(store.party.invites_in) ? store.party.invites_in.length : 0;
        return n ? { text: String(n), tone: null, label: n === 1 ? "An invite is waiting" : `${n} invites are waiting` } : null;
      } },
    { route: { page: "hiscores" }, label: "Leaderboard", icon: "trophy" },
  ] },
  { id: "navCamp", rows: [
    { route: { page: "stockpile" }, label: "Stockpile", icon: "stockpile", meta: (s) => `${slotsUsed(s, "bank")}/${slotCap(s, "bank")}` },
    { route: { page: "bounties" }, label: "Bounties", icon: "scroll",
      badge: (s) => (bountyReady(s) ? { text: "1", tone: "gold", label: "A bounty is ready to claim" } : null) },
    { route: { page: "requisitions" }, label: "Requisitions", icon: "crate", shown: (s) => requisitionsOpen(s),
      meta: (s) => `${requisitionsLeft(s)}/${CONFIG.agents.requisitionsPerDay}` },
    { route: { page: "shop" }, label: "Shop", icon: "shop" },
  ] },
  { id: "navTrades", rows: TRADES.map(skillRow) },
  { id: "navArtisans", rows: ARTISANS.map(skillRow) },
];

const keyOf = (route) => (route ? `${route.page}${route.arg ? `/${route.arg}` : ""}` : "");
const hrefOf = (route) => `#/${keyOf(route)}`;

/* ================= 2. SMALL PIECES ================= */

// A phone chip holds about nine letters. "Gravemoss Poultice" becomes "Poultice": the last word carries the meaning.
function shortName(name) {
  let words = String(name).split(" ");
  while (words.length > 1 && words.join(" ").length > 9) words = words.slice(1);
  return words.join(" ");
}

const GERUND = { forgemaster: "Forging", woodwright: "Carving", tanner: "Tanning", weaver: "Weaving", artificer: "Crafting" };

const zoneIcon = (zoneId) => `zone${zoneId.charAt(0).toUpperCase()}${zoneId.slice(1)}`;

// The log carries no tone of its own; a few kinds of line are worth a colour.
function logTone(m) {
  if (/reaches level|rises to Rank|reaches Bond/.test(m)) return "good";
  if (/put you down|broke\.$|are all full|left where it fell|^Nowhere to put/.test(m)) return "ember";
  if (/^Bounty paid|^The post brought|on the market for|came back from the market/.test(m)) return "gold";
  if (/joins the camp|walks with you|trailing you/.test(m)) return "violet";
  return null;
}

const CONN_LOOK = { guest: "guest", connecting: "syncing", online: "online", syncing: "syncing", offline: "offline", outdated: "offline" };
const SYNC_SHOW_MS = 600;   // a quick request never flickers the pill

/* ================= 3. THE SHELL ================= */

/**
 * createShell(app)
 *   app.store         the current store (may change)
 *   app.router        for the current route and pages that hide themselves
 *   app.ctx           the shell's ctx
 *   app.dispatch(type, args), app.openSettings(), app.openAccount(mode), app.openSky()
 */
export function createShell(app) {
  const $ = {
    bench: el("tbBench"), benchLink: el("tbBenchLink"), benchIcon: el("tbBenchIcon"), benchName: el("tbBenchName"),
    benchShort: el("tbBenchShort"), benchMeta: el("tbBenchMeta"), benchBar: el("tbBenchBar"), benchRestart: el("tbBenchRestart"),
    hunt: el("tbHunt"), huntLink: el("tbHuntLink"), huntIcon: el("tbHuntIcon"), huntName: el("tbHuntName"),
    huntShort: el("tbHuntShort"), huntMeta: el("tbHuntMeta"), huntBar: el("tbHuntBar"), huntRestart: el("tbHuntRestart"),
    gold: el("tbGoldText"), hp: el("tbHp"), hpFill: el("tbHpFill"), hpText: el("tbHpText"),
    conn: el("tbConn"), connText: el("tbConnText"), settings: el("tbSettings"), crumbs: el("tbCrumbs"),
    weather: el("weather"), banners: el("bannerDock"), log: el("logDock"),
  };

  const icons = { bench: "hammer", hunt: "swords" };
  let navSig = null;
  let navRefs = [];
  let crumbSig = "";
  let weatherSig = "";
  let bannerSig = null;
  let logSig = null;
  let logTimes = [];
  let logTimesAt = 0;
  let logOpen = false;
  let syncingSince = 0;
  let shownConn = "";

  const phone = typeof matchMedia === "function" ? matchMedia("(max-width: 599px)") : { matches: false };

  // Set by paintHunt: whether the hunt on the bar is the party's rather than your own.
  let outWithParty = false;

  /* The bar's button starts the thing on it over rather than stopping it: the count
     back to zero, the batch from the top, without walking to the page to do it. It is
     only there while something is actually running, and it is the only place it is --
     a skill's own page keeps its Stop, which is the choice that needs the walk. */
  /* Stop first, then start: the same thing again from nothing, exactly as picking it
     afresh would. Re-issuing the start alone only rewinds the count -- the action's own
     progress and the fight in hand carry on -- which is not what "start over" means. */
  $.benchRestart.addEventListener("click", () => {
    const t = app.store && app.store.state ? app.store.state.tasks.skilling : null;
    if (!t) return;
    const args = { skillId: t.skillId, actionId: t.actionId, limit: t.limit == null ? null : t.limit };
    app.dispatch("stopSkill");
    app.dispatch("startSkill", args);
  });
  $.huntRestart.addEventListener("click", () => {
    const c = app.store && app.store.state ? app.store.state.tasks.combat : null;
    if (!c || outWithParty) return;
    const args = { tier: c.tier, zone: c.zone, limit: c.limit == null ? null : c.limit };
    app.dispatch("pullBack");
    app.dispatch("startHunt", args);
  });
  $.conn.addEventListener("click", () => app.openSettings());
  $.settings.addEventListener("click", () => app.openSettings());

  // The weather card opens the Sky: the week's forecast lives in a popup, as it does in the Atlas.
  setAttr($.weather, "role", "button");
  setAttr($.weather, "tabindex", "0");
  setAttr($.weather, "aria-label", "Open the Sky: this week's weather");
  const openSky = () => app.openSky();
  $.weather.addEventListener("click", openSky);
  $.weather.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openSky();
    }
  });

  /* ---------- topbar ---------- */

  function setIcon(which, box, name) {
    if (icons[which] === name) return;
    icons[which] = name;
    box.replaceChildren(iconEl(name));
  }

  function paintBench(s) {
    const plan = skillPlan(s);
    const state = plan ? "working" : "idle";
    setAttr($.bench, "data-state", state);
    if (!plan) {
      setIcon("bench", $.benchIcon, "hammer");
      setText($.benchName, "Idle");
      setText($.benchShort, "Idle");
      setText($.benchMeta, "No crews at work");
      setAttr($.benchLink, "href", "#/character");
      setAttr($.benchRestart, "hidden", true);
      toggleClass($.benchBar, "nojump", true);
      setWidth($.benchBar, 0);
      return;
    }
    const name = titleCase(plan.def.name);
    const count = plan.limit == null ? fmtWhole(plan.done) : `${fmtWhole(plan.done)} of ${fmtWhole(plan.limit)}`;
    const verb = GERUND[plan.def.skillId];
    setIcon("bench", $.benchIcon, plan.def.icon || getSkill(plan.def.skillId).icon);
    setText($.benchName, name);
    setText($.benchShort, shortName(name));
    setText($.benchMeta, `${verb ? `${verb} · ` : ""}${count} · ${fmtTime(plan.timeLeft)} left`);
    setAttr($.benchLink, "href", `#/skill/${plan.def.skillId}`);
    setAttr($.benchRestart, "hidden", false);
    toggleClass($.benchBar, "nojump", plan.pct < 6);
    setWidth($.benchBar, plan.pct);
  }

  /* The party's fight touches no save, so combatPlan knows nothing about it. Without
     this the chip reads "Nobody is hunting" at a member who is out with their party
     and watching the arena do it. Taken straight off the last answer, never predicted. */
  function partyLook(store) {
    const view = store.partyHunt;
    if (!view || view.over || !Array.isArray(view.hunters)) return null;
    const acc = typeof store.account === "function" ? store.account() : null;
    const me = acc && acc.userId ? String(acc.userId).toLowerCase() : "";
    const mine = me && view.hunters.find((u) => u && String(u.userId).toLowerCase() === me);
    if (!mine) return null;
    const region = regionOfTier(view.tier);
    const zone = getZone(view.zone);
    const where = `${zone.name} · ${region ? region.name : "The realm"}`;
    if (mine.down) {
      return {
        state: "recovering", icon: "skull", name: "Fallen", short: "Fallen",
        meta: `${where} · your party fights on`, pct: 0, stop: "Break away from the party's hunt",
      };
    }
    const up = view.hunters.filter((u) => !u.down).length;
    const meta = view.phase === "search"
      ? `With your party · walking, ${fmtTime(Math.max(0, view.wait))} to go`
      : `With your party · ${up} standing · ${fmtWhole(Math.round(mine.dmg))} damage`;
    return {
      state: "hunting", icon: zoneIcon(view.zone), name: where, short: zone.name,
      meta,
      // Your own health, which is the one thing on this chip that is about you.
      pct: mine.max > 0 ? (mine.hp / mine.max) * 100 : 0,
      stop: "Break away from the party's hunt",
    };
  }

  function paintHunt(s, store) {
    const plan = combatPlan(s);
    const party = plan ? null : partyLook(store);
    outWithParty = !!party;
    let look;
    if (party) {
      look = party;
    } else if (plan) {
      const kills = `${fmtWhole(plan.done)} kills`;
      const rate = plan.xpRate == null ? "Reckoning" : `${fmtWhole(Math.round(plan.xpRate))} XP/hr`;
      look = {
        state: "hunting", icon: zoneIcon(plan.zone.id), name: `${plan.zone.name} · ${plan.region.name}`, short: plan.zone.name,
        meta: `${kills} · ${rate}`,
        // The fight in hand: a health bar, draining as the foe in front of you goes down.
        pct: plan.target ? plan.pct : 0,
        stop: "Pull back from the hunt",
      };
    } else {
      look = { state: "idle", icon: "swords", name: "Idle", short: "Idle", meta: "Nobody is hunting", pct: 0, stop: "Pull back from the hunt" };
    }
    setAttr($.hunt, "data-state", look.state);
    setIcon("hunt", $.huntIcon, look.icon);
    setText($.huntName, look.name);
    setText($.huntShort, look.short);
    setText($.huntMeta, look.meta);
    // Nothing to start over when nothing is out, and the party's fight is not yours to restart.
    setAttr($.huntRestart, "hidden", look.state === "idle" || outWithParty);
    toggleClass($.huntBar, "nojump", look.state === "idle" || look.pct < 6);
    setWidth($.huntBar, look.pct);
  }

  function paintStats(s) {
    setText($.gold, fmtWhole(s.player.gold));
    // At camp the save keeps the health the hunter came back with; campPlan says how far rest has brought it.
    const camp = campPlan(s, s.clock);
    const most = camp ? camp.maxHp : maxHp(s);
    const hp = Math.max(0, Math.min(most, Math.ceil(camp ? camp.hp : s.player.hp)));
    setWidth($.hpFill, most > 0 ? (hp / most) * 100 : 0);
    setText($.hpText, `${fmtWhole(hp)}/${fmtWhole(most)}`);
    setAttr($.hp, "aria-valuemax", most);
    setAttr($.hp, "aria-valuenow", hp);
    setAttr($.hp, "aria-valuetext", `${hp} of ${most}`);
    setAttr($.hp, "data-low", most > 0 && hp / most <= 0.35);
  }

  function paintConn(store) {
    const status = store.status;
    let conn = status.conn;
    const t = performance.now();
    if (conn === "syncing") {
      if (!syncingSince) syncingSince = t;
      // Keep showing what was there until a request has taken long enough to mention.
      if (t - syncingSince < SYNC_SHOW_MS && shownConn && shownConn !== "syncing") conn = shownConn;
    } else {
      syncingSince = 0;
    }
    shownConn = conn;
    let text;
    if (conn === "guest") text = "Guest";
    else if (conn === "connecting") text = "Connecting";
    else if (conn === "online") text = store.online != null ? `${fmtWhole(store.online)} online` : "Online";
    else if (conn === "syncing") text = "Syncing";
    else if (conn === "outdated") text = "Outdated";
    else text = status.error === "unauthorized" ? "Signed out" : "Offline";
    setAttr($.conn, "data-state", CONN_LOOK[conn] || "offline");
    setText($.connText, text);
    setAttr($.conn, "aria-label", `Account and connection: ${text}`);
    setAttr($.settings, "aria-label", `Settings and account (${text})`);
  }

  /* ---------- breadcrumb ---------- */

  function setCrumbs(group, title) {
    const sig = `${group}|${title}`;
    if (sig === crumbSig) return;
    crumbSig = sig;
    $.crumbs.replaceChildren(
      h("span", group),
      iconEl("chevron-right"),
      h("span", { "aria-current": "page" }, title));
  }

  /* ---------- sidebar ---------- */

  function navModel(s, store, route) {
    const ctx = app.ctx;
    return NAV.map((g) => ({
      id: g.id,
      rows: g.rows
        .filter((r) => (!r.shown || r.shown(s)) && !(app.router && app.router.hides(r.route, ctx)))
        .map((r) => ({
          row: r,
          key: keyOf(r.route),
          current: keyOf(r.route) === keyOf(route),
          dot: r.dot ? r.dot(s) : null,
          badge: r.badge ? r.badge(s, store) : null,
        })),
    }));
  }

  function buildNav(model) {
    navRefs = [];
    for (const g of model) {
      const list = el(`${g.id}List`);
      const section = el(g.id);
      list.replaceChildren(...g.rows.map((m) => {
        const meta = m.row.meta ? h("span.nav-meta") : null;
        navRefs.push({ meta, fn: m.row.meta });
        return h("li", h("a.nav-item", { href: hrefOf(m.row.route), "aria-current": m.current ? "page" : null },
          iconEl(m.row.icon, "nav-ico"),
          h("span.nav-label", m.row.label),
          m.dot ? h("span.nav-dot", { "data-tone": m.dot === "ember" ? "ember" : null, role: "img", "aria-label": m.dot === "ember" ? "Hunting" : "Working" }) : null,
          meta,
          m.badge ? h("span.badge", { class: m.badge.tone && `badge-${m.badge.tone}`, "aria-label": m.badge.label }, m.badge.text) : null));
      }));
      // :has() hides an empty group; hidden covers browsers without it.
      section.hidden = g.rows.length === 0;
    }
  }

  function paintNav(s, store, route) {
    const model = navModel(s, store, route);
    const sig = model.map((g) => g.rows.map((m) => `${m.key}${m.current ? "*" : ""}:${m.dot || ""}:${m.badge ? `${m.badge.tone}${m.badge.text}` : ""}`).join(",")).join("|");
    if (sig !== navSig) {
      navSig = sig;
      buildNav(model);
    }
    for (const ref of navRefs) if (ref.meta) setText(ref.meta, ref.fn(s));
  }

  /* ---------- weather ---------- */

  function paintWeather(now) {
    const day = dayIndex(now);
    const revealed = tomorrowRevealed(now);
    const sig = `${day}:${revealed}`;
    if (sig === weatherSig) return;
    weatherSig = sig;
    const w = weatherAt(now);
    // replaceChildren writes a skipped part as the text "null": filter them out first.
    $.weather.replaceChildren(...[
      h("div.weather-top", iconEl(w.icon), h("span.weather-name", w.label)),
      // Bountiful Weekend is a flat bonus that stands alone: the day's favoured/hindered
      // roll doesn't also apply on top of it, so it isn't shown as if it did.
      w.bountiful ? null : h("div.weather-mods",
        h("span.up", `${signedPct(w.mods[w.favoured])} ${skillName(w.favoured)}`),
        h("span.down", `${signedPct(w.mods[w.hindered])} ${skillName(w.hindered)}`)),
      w.bountiful ? h("div.weather-bonus", `Bountiful Weekend · ${signedPct(Math.round(CONFIG.weather.bountifulXp * 100))} XP to every trade`) : null,
      revealed ? h("div.weather-next", `Tomorrow: ${weatherForDay(day + 1).label}`) : null,
    ].filter(Boolean));
    $.weather.hidden = false;
  }

  /* ---------- banners ---------- */

  function banner({ tone = null, icon, title, text, actions = [] }) {
    return h("div.banner", { "data-tone": tone, role: "status" },
      h("span.banner-ico", iconEl(icon)),
      h("div.banner-text", h("b", title), text),
      actions.length ? h("div.banner-actions", actions) : null);
  }

  function retryButton(store) {
    const btn = h("button.btn.btn-sm", { type: "button" }, iconEl("sync"), "Retry");
    btn.addEventListener("click", async () => {
      btn.classList.add("is-loading");
      btn.disabled = true;
      try {
        await store.sync();
      } finally {
        btn.classList.remove("is-loading");
        btn.disabled = false;
      }
    });
    return btn;
  }

  function paintBanners(store) {
    const st = store.status;
    const list = [];
    if (store.mode === "guest") list.push("guest");
    if (st.conn === "outdated") list.push("outdated");
    else if (st.error === "unauthorized") list.push("signedout");
    else if (st.conn === "offline") list.push("offline");
    if (st.catchingUp && st.conn !== "offline" && st.conn !== "outdated") list.push("catching");
    const sig = list.join(",");
    if (sig === bannerSig) return;
    bannerSig = sig;
    $.banners.replaceChildren(...list.map((kind) => {
      if (kind === "guest") {
        return banner({
          icon: "cloud", title: "Playing as a guest", text: "Nothing is kept once this tab closes.",
          actions: [
            h("button.btn.btn-sm", { type: "button", onClick: () => app.openAccount("create") }, "Create account"),
            h("button.btn.btn-gold.btn-sm", { type: "button", onClick: () => app.openAccount("signin") }, "Sign in"),
          ],
        });
      }
      if (kind === "outdated") {
        return banner({
          tone: "violet", icon: "sync", title: "A new version of the camp is out", text: "Reload to carry on.",
          actions: [h("button.btn.btn-primary.btn-sm", { type: "button", onClick: () => location.reload() }, "Reload")],
        });
      }
      if (kind === "signedout") {
        return banner({
          tone: "ember", icon: "lock", title: "Signed out", text: "Sign in again and the camp picks up where it left off.",
          actions: [h("button.btn.btn-gold.btn-sm", { type: "button", onClick: () => app.openAccount("signin") }, "Sign in")],
        });
      }
      if (kind === "offline") {
        return banner({
          tone: "ember", icon: "offline", title: "Offline", text: "Your camp keeps running here and syncs when the road clears.",
          actions: [retryButton(store)],
        });
      }
      return banner({
        tone: "violet", icon: "hourglass", title: "Catching up", text: "The server is playing out the time you were away.",
        actions: [h("span.spinner.spinner-sm", { role: "status", "aria-label": "Catching up" })],
      });
    }));
  }

  /* ---------- the camp log ---------- */

  function paintLog(s, now, wanted) {
    if (!wanted || !s) {
      if (!$.log.hidden) $.log.hidden = true;
      logSig = null;
      return;
    }
    const lines = Array.isArray(s.log) ? s.log : [];
    const closedCount = phone.matches ? 1 : 5;
    const count = logOpen ? lines.length : Math.min(closedCount, lines.length);
    const newest = lines[lines.length - 1];
    const sig = `${lines.length}:${newest ? `${newest.t}:${newest.m}` : ""}:${count}:${logOpen}`;
    const t = performance.now();
    if (sig !== logSig) {
      logSig = sig;
      logTimes = [];
      const shown = lines.slice(-count).reverse();
      const toggle = lines.length > closedCount
        ? h("button.btn.btn-quiet.btn-sm", {
          type: "button",
          "aria-expanded": logOpen,
          onClick: () => { logOpen = !logOpen; logSig = null; },
        }, logOpen ? "Show less" : "Show all")
        : null;
      $.log.replaceChildren(h("section.card",
        h("div.card-head",
          h("div", h("h2.card-title", "Camp log")),
          toggle ? h("div.card-actions", toggle) : null),
        shown.length
          ? h("ol.log", shown.map((line) => {
            const time = h("time", fmtAgo(now - line.t));
            logTimes.push({ node: time, t: line.t });
            return h("li.log-line", { "data-tone": logTone(String(line.m)) }, time, h("span.log-msg", String(line.m)));
          }))
          : h("p.small.muted", "Nothing has happened yet.")));
      logTimesAt = t;
    } else if (t - logTimesAt > 30 * 1000) {
      // Times move slowly; twice a minute is plenty.
      logTimesAt = t;
      for (const x of logTimes) setText(x.node, fmtAgo(now - x.t));
    }
    if ($.log.hidden) $.log.hidden = false;
  }

  /* ---------- every frame ---------- */

  function update() {
    const store = app.store;
    if (!store) return;
    paintConn(store);
    paintBanners(store);
    const s = store.state;
    if (!s) return;
    const now = s.clock;
    const current = app.router ? app.router.current : null;
    paintBench(s);
    paintHunt(s, store);
    paintStats(s);
    paintNav(s, store, current ? current.route : null);
    paintWeather(now);
    const page = current && current.page;
    const wantsLog = page && page.log !== undefined ? !!page.log : !!(current && current.route.page === "character");
    paintLog(s, now, wantsLog);
  }

  // A different store: forget every signature so the next frame paints from scratch.
  // null, not "": an empty banner list has the signature "" and would never be cleared.
  function reset() {
    navSig = null;
    bannerSig = null;
    logSig = null;
    shownConn = "";
    syncingSince = 0;
    $.log.hidden = true;
  }

  return { update, reset, setCrumbs };
}
