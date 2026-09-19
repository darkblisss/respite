/* ============================================================
   Respite · pages/character.js · The Muster
   ------------------------------------------------------------
   #/character, the page the camp opens on. The hero says who you
   are and where; four tabs under it hold the rest.

   Character  what you wear beside what it makes of you, and what
              the crews and the hunt are doing right now
   Skills     every skill at a glance
   Collection the bestiary: one entry a foe, a name until you have
              put one down
   Record     what the camp has done since it was founded

   The paperdoll and the Standing panel are the Satchel's own
   (pages/armaments.js exports both), so there is one of each in
   the repo. Nothing a discipline brings (its tag, the Veil) shows
   before one is chosen.

   Only the tab on screen is updated, so three quarters of the page
   costs nothing on a frame; every panel builds once and is rebuilt
   only when its shape changes.
   ============================================================ */

import { h, on, setText, setWidth, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { fmt, fmtWhole, fmtGold, fmtTime, fmtStat, titleCase } from "../ui/format.js";
import { chipNode } from "../ui/popups/action.js";
import { monsterArt, foeKills, foeFalls } from "../ui/popups/foe.js";
import { openPopup } from "../ui/widgets.js";
import { dollCard, standingCard } from "./armaments.js";
import { CONFIG } from "../../shared/config.js";
import {
  ARTISAN_ORDER, GameData, SKILL_ORDER, TRADE_ORDER, getSkill, getClass, foesOf, sovereignOf, regionOfTier, tierLabel } from "../../shared/registry.js";
import { totalLevel, xpProgress } from "../../shared/stats.js";
import { skillPlan } from "../../shared/skills.js";
import { combatPlan } from "../../shared/combat.js";
import { currentRegion } from "../../shared/world.js";
import { activeCompanion } from "../../shared/companions.js";

// The order the sidebar lists them in.
const ZONE_ICONS = { outer: "zoneOuter", middle: "zoneMiddle", inner: "zoneInner", core: "zoneCore" };

// A region's name inside a sentence: "In the Ashen Verge".
const inSentence = (name) => name.replace(/^The /, "the ");

// Your account name, or "Commander" until there is one.
function commanderName(ctx) {
  const account = ctx.account;
  const name = (account && account.username) || ctx.state.meta.account;
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Commander";
}

/* ================= 1. THE HERO ================= */

function heroView() {
  const eyebrow = h("div.eyebrow.page-eyebrow");
  const name = h("h1.char-name");
  const tags = h("div.chip-row.char-tags");
  const total = h("span.char-total-v");
  const node = h("section.char-hero",
    h("div.portrait.char-portrait", h("img", { src: "assets/commander-default.webp", alt: "" })),
    h("div", eyebrow, name, tags),
    h("div.char-total", total, h("span.eyebrow", "Total level")));
  let tagSig = null;

  return {
    node,
    update(ctx, state) {
      setText(eyebrow, `In ${inSentence(currentRegion(state).name)}`);
      setText(name, commanderName(ctx));
      setText(total, fmtWhole(totalLevel(state)));

      // The discipline tag waits for a discipline; the bounty chip for a posting still open.
      const klass = state.player.klass ? getClass(state.player.klass) : null;
      const comp = activeCompanion(state);
      const b = state.bounty && !state.bounty.claimed ? state.bounty : null;
      const bountyText = b ? `Bounty ${fmtWhole(Math.min(b.progress, b.amount))} of ${fmtWhole(b.amount)}` : null;
      const sig = [klass ? klass.id : "-", comp ? comp.id : "-", bountyText || "-"].join("|");
      if (sig === tagSig) return;
      tagSig = sig;
      // replaceChildren would write a null out as text, so the absent ones are filtered first.
      tags.replaceChildren(...[
        klass ? h("span.tag.tag-violet", klass.name) : null,
        comp ? chipNode({ text: comp.name, icon: "paw" }) : null,
        bountyText ? chipNode({ text: bountyText, tone: "gold", icon: "scroll" }) : null,
      ].filter(Boolean));
    },
  };
}

/* ================= 2. WHAT IS RUNNING ================= */
/* Two cards: the crews and the hunt. Each is rebuilt when what it shows
   changes kind (a different task, idle, recovering) and otherwise only has
   its bar and numbers written. */

function actTop(artNode, eyebrow, title, end, href) {
  const words = [h("div.eyebrow", eyebrow), h("h2.card-title", title)];
  return h("div.act-card-top", artNode, href ? h("a.grow", { href }, words) : h("div.grow", words), end);
}

function idleCard(tone, { iconName, eyebrow, title, copy, link, linkText }) {
  return h("article.card.act-card.is-idle", { "data-tone": tone },
    actTop(h("div.art", { "data-tone": "neutral", "aria-hidden": "true" }, iconEl(iconName)), eyebrow, title,
      h("a.btn.btn-sm", { href: link }, linkText)),
    h("p.act-card-idle", copy));
}

// A card that swaps itself out in place when what it shows changes kind.
function swappable() {
  const card = { node: h("article.card.act-card") };
  card.swap = (next) => {
    card.node.replaceWith(next);
    card.node = next;
  };
  return card;
}

function benchCard(ctx) {
  const card = swappable();
  let sig = null;
  let live = null;

  card.update = (state) => {
    const plan = skillPlan(state);
    const nextSig = plan ? `work:${plan.def.id}` : "idle";
    if (nextSig !== sig) {
      sig = nextSig;
      live = null;
      if (plan) {
        const skill = getSkill(plan.def.skillId);
        live = { fill: h("i"), count: h("span"), left: h("b") };
        const stop = h("button.btn.btn-sm.btn-quiet", { type: "button", onClick: () => ctx.dispatch("stopSkill", {}) }, "Stop");
        card.swap(h("article.card.act-card", { "data-tone": "violet" },
          actTop(h("div.art", { "aria-hidden": "true" }, iconEl(skill.icon)), `The crews · ${skill.name}`, titleCase(plan.def.name), stop, `#/skill/${skill.id}`),
          h("div.bar", live.fill),
          h("div.act-card-meta", live.count, live.left)));
      } else {
        card.swap(idleCard("violet", {
          iconName: "hammer", eyebrow: "The crews", title: "No crews at work",
          copy: "Your people are standing around.", link: "#/skill/delving", linkText: "Open Delving",
        }));
      }
    }
    if (!live) return;
    toggleClass(live.fill, "nojump", plan.pct < 6);
    setWidth(live.fill, plan.pct);
    setText(live.count, plan.limit == null
      ? `${fmtWhole(plan.done)} actions · No limit`
      : `${fmtWhole(plan.done)} of ${fmtWhole(plan.limit)} actions`);
    setText(live.left, `${fmtTime(plan.timeLeft)} left`);
  };
  return card;
}

function huntCard(ctx) {
  const card = swappable();
  let sig = null;
  let live = null;

  card.update = (state) => {
    const cp = combatPlan(state);
    const recovering = !cp && state.player.recoveryLeft > 0;
    const nextSig = cp ? `hunt:${cp.c.tier}:${cp.zone.id}` : recovering ? "recovering" : "idle";
    if (nextSig !== sig) {
      sig = nextSig;
      live = null;
      if (cp) {
        live = { fill: h("i"), count: h("span"), left: h("b") };
        const pull = h("button.btn.btn-sm.btn-quiet", { type: "button", onClick: () => ctx.dispatch("pullBack", {}) }, "Pull back");
        card.swap(h("article.card.act-card", { "data-tone": "ember" },
          actTop(h("div.art", { "data-tone": "ember", "aria-hidden": "true" }, iconEl(ZONE_ICONS[cp.zone.id] || "swords")),
            `The hunt · ${cp.region.name}`, `The ${cp.zone.name}`, pull, "#/skill/warfare"),
          h("div.bar.bar-ember", live.fill),
          h("div.act-card-meta", live.count, live.left)));
      } else if (recovering) {
        live = { fill: h("i"), left: h("b"), recovering: true };
        card.swap(h("article.card.act-card.is-idle", { "data-tone": "ember" },
          actTop(h("div.art", { "data-tone": "neutral", "aria-hidden": "true" }, iconEl("heart")), "The hunt", "Recovering",
            h("a.btn.btn-sm", { href: "#/skill/warfare" }, "Open the Hunt")),
          h("div.bar.bar-striped", live.fill),
          h("div.act-card-meta", h("span", "Out of the hunt after a fall"), live.left)));
      } else {
        card.swap(idleCard("ember", {
          iconName: "swords", eyebrow: "The hunt", title: "Nothing hunted",
          copy: "Take up the hunt yourself.", link: "#/skill/warfare", linkText: "Open the Hunt",
        }));
      }
    }
    if (!live) return;
    if (live.recovering) {
      const left = state.player.recoveryLeft;
      setWidth(live.fill, (1 - left / CONFIG.hunt.recoveryMs) * 100);
      setText(live.left, `Back in ${fmtTime(left)}`);
      return;
    }
    const c = cp.c;
    toggleClass(live.fill, "nojump", cp.pct < 6);
    setWidth(live.fill, cp.pct);
    const kills = `${fmtWhole(c.done)} kills`;
    setText(live.count, `${kills} · ${cp.xpRate == null ? "Reckoning" : `${fmt(Math.round(cp.xpRate))} XP/hr`}`);
    setText(live.left, `${fmtTime(cp.timeLeft)} left`);
  };
  return card;
}

/* ================= 3. TAB: CHARACTER ================= */
/* The Satchel's paperdoll and its Standing, side by side rather than
   stacked, with what is running under them. The slot grid is the Satchel's
   own and is not touched here, only put somewhere else. */

function faceView(ctx) {
  const doll = dollCard(ctx, { link: { href: "#/armaments", label: "Satchel" } });
  const standing = standingCard();
  const bench = benchCard(ctx);
  const hunt = huntCard(ctx);

  const node = h("div.char-stack",
    h("div.char-face", doll.node, standing.node),
    h("div.grid-cards.max-2", bench.node, hunt.node));

  return {
    node,
    update(next, state) {
      doll.update(next);
      standing.update(next);
      bench.update(state);
      hunt.update(state);
    },
  };
}

/* ================= 4. TAB: SKILLS ================= */

function skillsView() {
  const cards = SKILL_ORDER.map((id) => {
    const s = getSkill(id);
    const war = s.kind === "war";
    const dot = h("span.dot", { class: war ? "dot-hunting" : "dot-working", role: "img", "aria-label": war ? "Hunting" : "Working", hidden: true });
    const xp = h("div.skill-xp");
    const lv = document.createTextNode("");
    const fill = h("i");
    const node = h("a.skill-card", { href: `#/skill/${id}`, "data-tone": war ? "ember" : null },
      h("div.art.art-sm", { "data-tone": war ? "ember" : "violet", "aria-hidden": "true" }, iconEl(s.icon)),
      h("div.skill-main", h("div.skill-name", s.name, dot), xp),
      h("div.skill-lv", h("small", "Lv"), lv),
      h("div.bar", { class: war ? "bar-ember" : null }, fill));
    return { id, war, node, dot, xp, lv, fill, level: null };
  });

  // Three rows of the same shape: each artisan sits under the trade it works from.
  const group = (label, ids) => h("div.skills-group",
    h("div.eyebrow", label),
    h("div.grid-cards.skills-grid", ids.map((id) => cards.find((c) => c.id === id).node)));

  const node = h("section.section",
    h("div.section-head", h("div",
      h("h2.section-title", "Skills"),
      h("p.section-sub", `${titleCase(numberWord(GameData.SKILLS.length))} ways to spend a life. Pick one to open it.`))),
    group("Trades", TRADE_ORDER),
    group("Artisans", ARTISAN_ORDER),
    group("The Field", ["warfare"]));

  return {
    node,
    update(next, state) {
      const task = state.tasks.skilling;
      const hunting = !!state.tasks.combat;
      cards.forEach((c) => {
        const p = xpProgress(state, c.id);
        setText(c.lv, String(p.level));
        setText(c.xp, p.maxed ? "Mastered" : `${fmt(p.xp)} / ${fmt(p.next)} XP`);
        toggleClass(c.fill, "nojump", c.level !== null && c.level !== p.level);
        c.level = p.level;
        setWidth(c.fill, p.pct);
        const busy = c.war ? hunting : !!(task && task.skillId === c.id);
        toggleClass(c.node, "is-working", busy);
        setAttr(c.dot, "hidden", !busy);
      });
    },
  };
}

// Small counts in words, for copy.
function numberWord(n) {
  const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  return words[n] || fmtWhole(n);
}

/* ================= 5. TAB: COLLECTION ================= */
/* Every foe in the world, by region, three of a kind and the Sovereign
   under them as the quarry lists them. One you have never felled is a
   name and a lock: no drawing, no numbers, nothing to open. */

// Every monster, region by region, the Sovereign last.
const BESTIARY = GameData.REGIONS.map((region) => ({
  region,
  mobs: foesOf(region.tier).filter(Boolean).concat([sovereignOf(region.tier)]).filter(Boolean),
}));
const BESTIARY_COUNT = BESTIARY.reduce((n, r) => n + r.mobs.length, 0);

// What a foe you have met reads under its name.
function foeLine(state, mob) {
  const kind = mob.archetype === "sovereign" ? "Sovereign" : GameData.ARCHETYPES[mob.archetype].name;
  const falls = foeFalls(state, mob.id);
  const words = [kind, `${fmt(foeKills(state, mob.id))} felled`];
  if (falls) words.push(`${fmt(falls)} of yours`);
  return words.join(" · ");
}

function foundTile(mob) {
  const sov = mob.archetype === "sovereign";
  const sub = h("span.foe-tile-sub");
  const node = h("button.foe-tile", { type: "button", class: { "is-sovereign": sov }, dataset: { monster: mob.id } },
    h("span.foe-art", { html: monsterArt(mob) }),
    h("span.foe-tile-main", h("span.foe-tile-name", mob.name), sub),
    sov ? h("span.tag.tag-sovereign", "Sovereign") : null);
  return { mob, node, sub, kills: null, falls: null };
}

function lockedTile(mob) {
  const sov = mob.archetype === "sovereign";
  const node = h("div.foe-tile.is-locked", { class: { "is-sovereign": sov } },
    h("span.foe-art", { "aria-hidden": "true" }, iconEl("lock")),
    h("span.foe-tile-main",
      h("span.foe-tile-name", mob.name),
      // Greying alone says nothing to a reader who cannot see it.
      h("span.sr-only", "Not felled yet")),
    sov ? h("span.tag.tag-sovereign", "Sovereign") : null);
  return { mob, node, sub: null };
}

function collectionView(ctx) {
  const foundChip = h("span.chip");
  const groups = h("div.char-bestiary");
  const node = h("section.section",
    h("div.section-head",
      h("div",
        h("h2.section-title", "Collection"),
        h("p.section-sub", "Everything that lives out there. One you have felled opens; one you have not stays a name.")),
      h("div.card-actions", foundChip)),
    groups);

  let sig = null;
  let refs = [];

  // A foe you have met is worth opening, so the record inside the popup has something in it.
  const offClick = on(groups, "click", ".foe-tile[data-monster]", (e, b) => {
    openPopup("foe", ctx, b.dataset.monster);
  });

  return {
    node,
    destroy() { offClick(); },
    update(next, state) {
      // The shape changes only when something is felled for the first time.
      const nextSig = BESTIARY.map((r) => r.mobs.map((m) => (foeKills(state, m.id) ? "1" : "0")).join("")).join("");
      if (nextSig !== sig) {
        sig = nextSig;
        refs = [];
        let found = 0;
        groups.replaceChildren(...BESTIARY.map(({ region, mobs }) => {
          const tiles = mobs.map((mob) => {
            const met = foeKills(state, mob.id) > 0;
            if (met) found++;
            const ref = met ? foundTile(mob) : lockedTile(mob);
            refs.push(ref);
            return ref.node;
          });
          return h("div.skills-group",
            h("div.eyebrow", `${region.name} · ${tierLabel(region.tier)}`),
            h("div.grid-cards", tiles));
        }));
        setText(foundChip, `${fmtWhole(found)} of ${fmtWhole(BESTIARY_COUNT)} felled`);
      }
      // Counts move with every kill, so they are written in place, and only the ones that moved.
      refs.forEach((r) => {
        if (!r.sub) return;
        const kills = foeKills(state, r.mob.id);
        const falls = foeFalls(state, r.mob.id);
        if (kills === r.kills && falls === r.falls) return;
        r.kills = kills;
        r.falls = falls;
        setText(r.sub, foeLine(state, r.mob));
      });
    },
  };
}

/* ================= 6. TAB: RECORD ================= */
/* What the camp has done since it was founded. Every figure is already in
   the save; nothing here is counted a second time. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* "17 Sep 2026" for the day a camp was founded. UTC, as every reset in the
   game is, and spelled out by hand so every browser writes it the same
   (the Sky popup says its days the same way). */
function fmtDay(ms) {
  const d = new Date(Number(ms) || 0);
  if (!Number.isFinite(d.getTime())) return "Unknown";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function bigRows(state) {
  const st = state.stats;
  return [
    ["Felled", fmt(st.kills)],
    ["Falls", fmtWhole(st.deaths)],
    ["Sovereigns", fmtWhole(st.bosses || 0)],
    ["Actions worked", fmt(st.actions)],
    ["Things made", fmt(st.crafted)],
    ["Total level", fmtWhole(totalLevel(state))],
  ];
}

function detailRows(state, now) {
  const st = state.stats;
  const meta = state.meta;
  const found = BESTIARY.reduce((n, r) => n + r.mobs.filter((m) => foeKills(state, m.id)).length, 0);
  const region = currentRegion(state);
  return [
    ["Founded", fmtDay(meta.createdAt)],
    ["Standing for", fmtTime(Math.max(0, now - meta.createdAt))],
    ["Time in camp", fmtTime(meta.playtimeMs)],
    ["Gold earned", fmtGold(st.goldEarned), "gold"],
    ["Epics found", fmtWhole(st.epics)],
    ["Collection", `${fmtWhole(found)} of ${fmtWhole(BESTIARY_COUNT)}`],
    ["Ground held", `${region.name}, tier ${region.tier}`],
  ];
}

function recordView() {
  const grid = h("div.standing");
  const list = h("div.stats");
  const node = h("div.char-stack",
    h("section.card",
      h("div.card-head", h("div",
        h("h2.card-title", "The tally"),
        h("p.card-sub", "What this camp has done. Nothing but starting over clears it."))),
      grid),
    h("section.card",
      h("div.card-head", h("div",
        h("h2.card-title", "Since the founding"),
        h("p.card-sub", "Time in camp is every hour the camp has run, asleep or awake."))),
      list));

  let bigSig = null;
  let bigValues = [];
  let rowSig = null;
  let rowValues = [];

  return {
    node,
    update(next, state) {
      const big = bigRows(state);
      const nextBig = big.map((r) => r[0]).join("|");
      if (nextBig !== bigSig) {
        bigSig = nextBig;
        bigValues = big.map(() => h("div.v"));
        grid.replaceChildren(...big.map(([l], i) => h("div.standing-cell", bigValues[i], h("div.eyebrow.l", l))));
      }
      big.forEach((r, i) => setText(bigValues[i], r[1]));

      const rows = detailRows(state, next.now);
      const nextRows = rows.map((r) => r[0]).join("|");
      if (nextRows !== rowSig) {
        rowSig = nextRows;
        rowValues = rows.map(([, , tone]) => h("span.v", { class: tone && `t-${tone}` }));
        list.replaceChildren(...rows.map(([l], i) => h("div.stat", h("span.l", l), rowValues[i])));
      }
      rows.forEach((r, i) => setText(rowValues[i], r[1]));
    },
  };
}

/* ================= 7. THE TABS ================= */
/* The chip row on wide screens and a select on phones, the pattern the
   Leaderboard uses. The row is a tablist with a roving tabindex, so one
   Tab reaches it and the arrows walk it. */

const TABS = [
  { id: "character", name: "Character", icon: "person", build: faceView },
  { id: "skills", name: "Skills", icon: "book", build: skillsView },
  { id: "collection", name: "Collection", icon: "skull", build: collectionView },
  { id: "record", name: "Record", icon: "hourglass", build: recordView },
];

// The tab last opened, for the length of the session (as the Satchel keeps its filter).
const VIEW = { tab: TABS[0].id };

function tabShell(ctx) {
  if (!TABS.some((t) => t.id === VIEW.tab)) VIEW.tab = TABS[0].id;

  const row = h("div.char-tabs", { role: "tablist", "aria-label": "Character" },
    TABS.map((t) => h("button.chip", {
      type: "button",
      role: "tab",
      id: `charTab-${t.id}`,
      "aria-selected": "false",
      "aria-controls": `charPanel-${t.id}`,
      tabindex: "-1",
      dataset: { tab: t.id },
    }, iconEl(t.icon), t.name)));

  const select = h("select.select.char-tab-select", { "aria-label": "Character" },
    TABS.map((t) => h("option", { value: t.id }, t.name)));

  const panels = TABS.map((t) => {
    const part = t.build(ctx);
    part.wrap = h("div", {
      id: `charPanel-${t.id}`,
      role: "tabpanel",
      "aria-labelledby": `charTab-${t.id}`,
      hidden: true,
    }, part.node);
    return part;
  });
  const at = (id) => panels[TABS.findIndex((t) => t.id === id)];

  function paintPick() {
    row.querySelectorAll("[role=tab]").forEach((t) => {
      const picked = t.dataset.tab === VIEW.tab;
      setAttr(t, "aria-selected", picked ? "true" : "false");
      setAttr(t, "tabindex", picked ? "0" : "-1");
    });
    if (select.value !== VIEW.tab) select.value = VIEW.tab;
    panels.forEach((p, i) => setAttr(p.wrap, "hidden", TABS[i].id !== VIEW.tab));
  }

  // A tab only just shown has never been painted, so it is filled before it is seen.
  function choose(id, { focus = false } = {}) {
    if (!TABS.some((t) => t.id === id) || id === VIEW.tab) return;
    VIEW.tab = id;
    paintPick();
    at(id).update(ctx, ctx.state);
    if (!focus) return;
    const btn = row.querySelector(`[data-tab="${id}"]`);
    if (btn) {
      btn.focus();
      // Keep the chosen tab in view when the row scrolls.
      if (typeof btn.scrollIntoView === "function") btn.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
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

  return {
    nodes: [row, select, ...panels.map((p) => p.wrap)],
    update(next, state) {
      at(VIEW.tab).update(next, state);
    },
    destroy() {
      offs.forEach((off) => off());
      select.removeEventListener("change", onChange);
      panels.forEach((p) => {
        if (typeof p.destroy === "function") p.destroy();
      });
    },
  };
}

/* ================= 8. THE PAGE ================= */

export default {
  id: "character",
  title: () => "Character",
  group: "The Vanguard",

  mount(view, ctx) {
    const hero = heroView();
    const tabs = tabShell(ctx);

    view.appendChild(h("div.page", hero.node, ...tabs.nodes));

    const handle = {
      update(next) {
        const c = next || ctx;
        const state = c.state;
        hero.update(c, state);
        tabs.update(c, state);
      },
      unmount() { tabs.destroy(); },
    };
    handle.update(ctx);
    return handle;
  },
};
