/* ============================================================
   Respite · pages/character.js · The Muster
   ------------------------------------------------------------
   #/character, the page the camp opens on. Who you are and where,
   what the crews and the hunt are doing right now, how you stand
   in a fight, and every skill at a glance. Nothing a discipline
   brings (its tag, the Veil) shows before one is chosen.
   ============================================================ */

import { h, setText, setWidth, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { fmt, fmtWhole, fmtGold, fmtTime, fmtStat, chancePct, titleCase } from "../ui/format.js";
import { chipNode } from "../ui/popups/action.js";
import { CONFIG } from "../../shared/config.js";
import { ARTISAN_ORDER, GameData, SKILL_ORDER, TRADE_ORDER, getSkill, getClass } from "../../shared/registry.js";
import { totalLevel, xpProgress, statsOf } from "../../shared/stats.js";
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
    const kills = c.limit == null ? `${fmtWhole(c.done)} kills` : `${fmtWhole(c.done)} of ${fmtWhole(c.limit)} kills`;
    setText(live.count, c.phase === "hide"
      ? `${kills} · Hiding, ${fmtTime(c.wait)} left`
      : `${kills} · ${c.xpRate == null ? "XP/hr soon" : `${fmt(Math.round(c.xpRate))} XP/hr`}`);
    setText(live.left, `${fmtTime(cp.timeLeft)} left`);
  };
  return card;
}

/* ================= 3. STANDING ================= */

// Six numbers for everyone; a discipline opens three more of the fight, the Veil among them.
function standingRows(state) {
  const s = statsOf(state);
  const st = state.stats;
  const rows = [["Health", fmtWhole(s.maxHp)], ["Attack", fmtStat(s.attack)], ["Defence", fmtStat(s.defence)]];
  if (state.player.klass) {
    rows.push(
      ["Crit chance", chancePct(s.crit)],
      ["Swing", `${(s.speed / 1000).toFixed(1)}s`],
      s.klass === "mage" ? ["Veil a second", fmtStat(s.absorb)] : ["Veil a blow", fmtStat(s.veilGain)],
    );
  }
  rows.push(["Kills", fmtWhole(st.kills)], ["Deaths", fmtWhole(st.deaths)], ["Gold earned", fmtGold(st.goldEarned), "gold"]);
  return rows;
}

function standingView() {
  const grid = h("div.standing");
  const node = h("section.card",
    h("div.card-head",
      h("div", h("h2.card-title", "Standing")),
      h("div.card-actions", h("a.btn.btn-sm.btn-quiet", { href: "#/armaments" }, "Armaments", iconEl("arrow-right")))),
    grid);
  let labels = null;
  let values = [];

  return {
    node,
    update(state) {
      const rows = standingRows(state);
      const sig = rows.map((r) => r[0]).join("|");
      if (sig !== labels) {
        labels = sig;
        values = rows.map(([, , tone]) => h("div.v", { class: tone && `t-${tone}` }));
        grid.replaceChildren(...rows.map(([l], i) => h("div.standing-cell", values[i], h("div.eyebrow.l", l))));
      }
      rows.forEach((r, i) => setText(values[i], r[1]));
    },
  };
}

/* ================= 4. SKILLS ================= */

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
    update(state) {
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

/* ================= 5. THE PAGE ================= */

export default {
  id: "character",
  title: () => "Character",
  group: "The Vanguard",

  mount(view, ctx) {
    const hero = heroView();
    const bench = benchCard(ctx);
    const hunt = huntCard(ctx);
    const standing = standingView();
    const skills = skillsView();

    view.appendChild(h("div.page",
      hero.node,
      h("div.grid-cards.max-2", bench.node, hunt.node),
      standing.node,
      skills.node));

    const handle = {
      update(next) {
        const c = next || ctx;
        const state = c.state;
        hero.update(c, state);
        bench.update(state);
        hunt.update(state);
        standing.update(state);
        skills.update(state);
      },
    };
    handle.update(ctx);
    return handle;
  },
};
