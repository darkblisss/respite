/* ============================================================
   Respite · pages/skill.js · The Works
   ------------------------------------------------------------
   #/skill/<id> for the five trades and the five artisan benches
   (the hunt has a page of its own). A hero with the level, the XP
   and what bends it; then the region's nodes and the camp for a
   trade, or the bench with its tabs and tiers for an artisan.

   Every node and recipe is one full-width pill. The pill opens the
   action popup, where work is started; its (i) shows what a node
   gives or what a recipe makes before anything is committed.
   Sections are built once and rebuilt only when their shape
   changes; everything that moves is written in place.
   ============================================================ */

import { h, html, on, qs, setText, setWidth, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl, artEl, hasArt } from "../ui/icons.js";
import { tooltip, tipBody, hideTip } from "../ui/overlay.js";
import { fmt, fmtWhole, fmtTime, titleCase } from "../ui/format.js";
import { openPopup } from "../ui/widgets.js";
import { xpChips, chipNode, nodeTip, makesTip, workingWord, firstSentence } from "../ui/popups/action.js";
import {
  GameData, getSkill, gatherSkillDef, actionsFor, actionOutput, findAction, benchGroupOf, skillName, tierLabel } from "../../shared/registry.js";
import { itemDef, itemName } from "../../shared/items.js";
import { haveQty } from "../../shared/storage.js";
import { skillLevel, xpProgress } from "../../shared/stats.js";
import { actionTime, xpEach, mastery, toolFor } from "../../shared/progression.js";
import { skillPlan } from "../../shared/skills.js";
import { currentRegion } from "../../shared/world.js";
import { itemLore } from "../../shared/lore.js";
import { campScene, CAMP_STAGES, CAMP_VIEWBOX } from "../ui/camp-art.js";

const TIERS = GameData.TIERS;

// Gathering and artisan skills live here; anything else is not this page's.
function workSkill(id) {
  const s = typeof id === "string" ? getSkill(id) : null;
  return s && (s.kind === "gather" || s.kind === "craft") ? s : null;
}

// A region's name inside a sentence: "the seams of the Ashen Verge".
const inSentence = (name) => name.replace(/^The /, "the ");

// What each trade works, for the head over its nodes.
const GROUND = { delving: "seams", felling: "timber", harvesting: "growth", flaying: "hides", dredging: "waters" };

// Closes a tooltip whose anchor is about to be rebuilt away.
function dropTipIn(node) {
  if (qs("[data-tip-open]", node)) hideTip();
}

/* ================= 1. THE HERO ================= */

function masteryTip(state, skill) {
  const lvl = skillLevel(state, skill.id);
  const dbl = Math.round(mastery(state, skill.id).double * 100);
  const next = GameData.MASTERY_TRACK.find((step) => lvl < step.level);
  let foot = `Every mastery earned: +${dbl}% double yield.`;
  if (next) foot = `${dbl ? `Now +${dbl}% double yield.` : "No mastery yet."} ${next.label} at Lv ${next.level}.`;
  return tipBody({
    title: `${skill.name} Mastery`,
    list: gatherSkillDef(skill.id).lore.concat("Every ten levels adds to the chance an action yields double."),
    track: GameData.MASTERY_TRACK.map((step) => ({
      at: `Lv ${step.level}`,
      label: step.label,
      value: `+${Math.round(step.double * 100)}%`,
      done: lvl >= step.level,
      next: step === next,
    })),
    foot,
    footTone: dbl ? "good" : null,
  });
}

function heroView(ctx, skill) {
  const gather = skill.kind === "gather";
  const eyebrow = h("div.eyebrow.hero-eyebrow");
  const lv = document.createTextNode("");
  const lvSub = h("div.hero-lv-sub");
  const fill = h("i");
  const note = h("span");
  const toNextNum = h("b");
  const toNextLv = document.createTextNode("");
  const toNext = h("span.nowrap", toNextNum, toNextLv);
  const tags = h("div.chip-row.hero-tags");

  // The chip that always sits in the tags: Mastery for a trade, what the bench makes for an artisan.
  let lead;
  let masteryLabel = null;
  if (gather) {
    masteryLabel = h("span");
    lead = h("button.tip-chip", { type: "button" }, iconEl("info"), masteryLabel);
    tooltip(lead, () => masteryTip(ctx.state, skill), { placement: "bottom" });
    setText(note, skill.note);
  } else {
    const first = firstSentence(skill.note);
    lead = chipNode({ text: first.replace(/\.$/, ""), icon: skill.icon });
    setText(note, skill.note.slice(first.length).trim());
  }

  // No art box: the skill's icon is the sidebar's job, and showing it twice read as a duplicate.
  const node = h("section.hero",
    h("div.hero-main", eyebrow, h("h1.hero-title", skill.name)),
    h("div.hero-level", h("div.hero-lv", h("small", "Lv"), lv), lvSub),
    tags,
    h("div.hero-xp", h("div.bar", fill), h("div.hero-xp-meta", note, toNext)));

  let tagSig = null;
  let shownLevel = null;

  return {
    node,
    update(state, now) {
      setText(eyebrow, gather ? `Trades · ${currentRegion(state).name}` : "Artisans · At camp");

      const p = xpProgress(state, skill.id);
      setText(lv, String(p.level));
      setText(lvSub, p.maxed ? "Mastered" : `${fmtWhole(p.xp)} / ${fmtWhole(p.next)} XP`);
      // A level up wraps the bar back to the start; it should not sweep backwards to get there.
      toggleClass(fill, "nojump", shownLevel !== null && shownLevel !== p.level);
      shownLevel = p.level;
      setWidth(fill, p.pct);
      setAttr(toNext, "hidden", p.maxed);
      if (!p.maxed) {
        setText(toNextNum, fmtWhole(Math.ceil(p.toNext)));
        setText(toNextLv, ` to Lv ${p.level + 1}`);
      }

      if (masteryLabel) {
        const dbl = Math.round(mastery(state, skill.id).double * 100);
        setText(masteryLabel, dbl ? `Mastery · +${dbl}% double yield` : "Mastery");
      }
      const chips = xpChips(state, skill.id, now);
      const sig = chips.map((c) => `${c.tone}:${c.text}`).join("|");
      if (sig !== tagSig) {
        tagSig = sig;
        const nodes = chips.map(chipNode);
        tags.replaceChildren(...(gather ? [lead, ...nodes] : [...nodes, lead]));
      }
    },
  };
}

/* ================= 2. PILLS ================= */
/* One shape for nodes and recipes (UI-KIT 7.12). The status line is rebuilt
   only when its kind changes (working, locked, short, idle); its numbers
   are written in place. */

function pillShell(def, tipLabel, tip) {
  const sub = h("div.pill-sub");
  const stats = h("div.pill-stats");
  const fill = h("i");
  const info = h("button.info-btn", { type: "button", "aria-label": tipLabel }, iconEl("info"));
  tooltip(info, tip, { placement: "left" });
  const node = h("article.item-pill", { "data-action": def.id },
    h("div.art", { class: { "art-paint": hasArt(def) }, "aria-hidden": "true" }, artEl(def)),
    h("div.pill-main", h("button.pill-hit", { type: "button" }, titleCase(def.name)), sub),
    stats,
    h("div.pill-end", info, iconEl("chevron-right", "pill-go")),
    h("span.pill-bar", { "aria-hidden": "true" }, fill));
  return { def, node, sub, stats, fill, subKey: null };
}

function paintSub(ref, key, build) {
  if (ref.subKey === key) return;
  ref.subKey = key;
  ref.sub.replaceChildren(...build());
}

// "Working · 42 of 200 · 1h 12m left", or "Forging · 18 done · No limit · 27m left".
function paintRunning(ref, plan) {
  const open = plan.limit == null;
  paintSub(ref, open ? "run-open" : "run", () => {
    ref.runDone = h("b");
    ref.runOf = document.createTextNode("");
    ref.runLeft = h("span");
    const word = h("span", workingWord(ref.def.skillId));
    return open
      ? [word, h("span", ref.runDone, " done"), h("span", "No limit"), ref.runLeft]
      : [word, h("span", ref.runDone, ref.runOf), ref.runLeft];
  });
  setText(ref.runDone, fmtWhole(plan.done));
  if (!open) setText(ref.runOf, ` of ${fmtWhole(plan.limit)}`);
  setText(ref.runLeft, `${fmtTime(plan.timeLeft)} left`);
}

function paintLocked(ref) {
  paintSub(ref, "locked", () => [iconEl("lock"), `Needs ${skillName(ref.def.skillId)} Lv ${ref.def.level}`]);
}

// The thin bar along the pill's foot. A new action starts it from nothing without a sweep back.
function paintBar(ref, plan) {
  const pct = plan ? plan.pct : 0;
  toggleClass(ref.fill, "nojump", !plan || pct < 6);
  setWidth(ref.fill, pct);
}

// ---- gathering nodes ----

function nodePill(ctx, def, locked) {
  const name = titleCase(def.name);
  const ref = pillShell(def, `${name}: what it gives`, () => nodeTip(ctx.state, def, ctx.now));
  ref.locked = locked;
  ref.note = firstSentence(itemLore(itemDef(actionOutput(def))));
  ref.time = h("span");
  ref.xp = h("span");
  ref.held = locked ? null : h("span");
  ref.stats.append(h("span.chip", iconEl("clock"), ref.time), h("span.chip.chip-violet", ref.xp));
  if (ref.held) ref.stats.append(h("span.chip", ref.held));
  return ref;
}

function paintNode(ref, state, now, plan) {
  const { def } = ref;
  const running = plan && plan.def.id === def.id ? plan : null;
  toggleClass(ref.node, "is-working", !!running);
  toggleClass(ref.node, "is-locked", ref.locked && !running);
  if (running) paintRunning(ref, running);
  else if (ref.locked) paintLocked(ref);
  else paintSub(ref, "idle", () => [ref.note]);
  setText(ref.time, fmtTime(actionTime(state, def)));
  setText(ref.xp, `${fmtWhole(xpEach(state, def.skillId, def.xp, now))} XP`);
  if (ref.held) setText(ref.held, `${fmt(haveQty(state, actionOutput(def)))} held`);
  paintBar(ref, running);
}

// ---- bench recipes ----

// A recipe's quiet line when nothing is wrong: what the thing is for.
function recipeNote(def) {
  if (def.craftGear) return "Rarity is rolled when it is made";
  const out = itemDef(actionOutput(def));
  if (out.kind === "tool") return `${skillName(out.forSkill)} actions ${Math.round(out.speed * 100)}% quicker`;
  if (out.chest) return `${out.chest} more Stockpile slots, once opened`;
  return firstSentence(itemLore(out));
}

function recipePill(ctx, def, locked) {
  const name = titleCase(def.name);
  const ref = pillShell(def, `${name}: what it makes`, () => makesTip(ctx.state, def));
  ref.locked = locked;
  ref.note = recipeNote(def);
  ref.needs = Object.keys(def.cost || {}).map((key) => {
    const have = document.createTextNode("");
    const node = h("span.need", artEl(itemDef(key)), itemName(key), h("span.have", have, h("small", `/${fmt(def.cost[key])}`)));
    return { key, need: def.cost[key], name: itemName(key), node, have };
  });
  ref.time = h("span");
  // Gear is one of a kind; stock and tools pile up, so they show what is held.
  ref.held = def.craftGear ? null : h("span");
  ref.stats.append(...ref.needs.map((n) => n.node), h("span.chip", iconEl("clock"), ref.time));
  if (ref.held) ref.stats.append(h("span.chip", ref.held));
  return ref;
}

function paintRecipe(ref, state, plan) {
  const { def } = ref;
  const running = plan && plan.def.id === def.id ? plan : null;
  const missing = [];
  ref.needs.forEach((n) => {
    const have = haveQty(state, n.key);
    setText(n.have, fmt(have));
    if (have < n.need) missing.push(n.name);
    // A tier not yet open is short of everything; it is not worth shouting about.
    toggleClass(n.node, "is-short", !ref.locked && have < n.need);
  });
  const short = !running && !ref.locked && missing.length > 0;
  toggleClass(ref.node, "is-working", !!running);
  toggleClass(ref.node, "is-locked", ref.locked && !running);
  toggleClass(ref.node, "is-short", short);
  if (running) paintRunning(ref, running);
  else if (ref.locked) paintLocked(ref);
  else if (short) paintSub(ref, `short:${missing.join("|")}`, () => [`Missing ${missing.join(", ")}`]);
  else paintSub(ref, "idle", () => [ref.note]);
  setText(ref.time, fmtTime(actionTime(state, def)));
  if (ref.held) setText(ref.held, `${fmt(haveQty(state, actionOutput(def)))} held`);
  paintBar(ref, running);
}

/* ================= 3. THE TRADE: NODES ================= */

function gatherView(ctx, skill) {
  const g = gatherSkillDef(skill.id);
  const title = h("h2.section-title");
  const toolText = h("span");
  const pills = h("div.pills");
  const node = h("section.section",
    h("div.section-head",
      h("div", title, h("p.section-sub", "Pick one to set the crews to it.")),
      h("span.chip", iconEl(g.icon), toolText)),
    pills);
  let sig = null;
  let refs = [];

  return {
    node,
    update(state, now) {
      const region = currentRegion(state);
      const level = skillLevel(state, skill.id);
      // The nodes of the ground you stand on, in registry order. Travel does not stop the crews,
      // so work still running on other ground stays on the list until it ends.
      const defs = actionsFor(skill.id).filter((a) => a.tier === region.tier);
      const t = state.tasks.skilling;
      if (t && t.skillId === skill.id && !defs.some((d) => d.id === t.actionId)) {
        const away = findAction(skill.id, t.actionId);
        if (away) defs.push(away);
      }
      const nextSig = `${region.id}|${defs.map((d) => `${d.id}:${level < d.level}`).join(",")}`;
      if (nextSig !== sig) {
        sig = nextSig;
        dropTipIn(pills);
        refs = defs.map((d) => nodePill(ctx, d, level < d.level));
        pills.replaceChildren(...refs.map((r) => r.node));
      }
      setText(title, `The ${GROUND[skill.id]} of ${inSentence(region.name)}`);
      const tool = toolFor(state, skill.id);
      setText(toolText, tool ? `${tool.name} · +${Math.round(tool.speed * 100)}% speed` : "Bare hands");
      const plan = skillPlan(state);
      refs.forEach((r) => paintNode(r, state, now, plan));
    },
  };
}

/* ================= 4. THE CAMP ================= */
/* A drawn scene under each gathering page (ui/camp-art.js). It gains a
   piece each time the skill reaches a new tier, the first at Lv 1 and the
   last at Lv 80, and each trade names its own nine. */

function campStage(state, skillId) {
  const lvl = skillLevel(state, skillId);
  return TIERS.filter((t) => t.level <= lvl).length;
}

// Where a narrow scene looks: the fire, the tent and the work beside them.
const CAMP_FOCUS = 560;

function campView(skill) {
  const stageChip = h("span.chip");
  const scene = h("div.camp-scene");
  const now = h("b");
  const next = h("span");
  const node = h("section.card.card-flush",
    h("div.card-head",
      h("div", h("h2.card-title", "The camp"), h("p.card-sub", `It grows each time ${skill.name} reaches a new tier.`)),
      h("div.card-actions", stageChip)),
    scene,
    h("div.camp-foot", now, next));
  const names = CAMP_STAGES[skill.id];
  let stage = 0;

  // The scene is drawn 1000 by 200. In a box narrower than that (phones, tablets)
  // the view slides along to keep the fire and the work in frame.
  const fit = () => {
    const svg = scene.firstElementChild;
    const w = scene.clientWidth;
    const tall = scene.clientHeight;
    if (!svg || !w || !tall) return;
    const span = (200 * w) / tall;
    if (span >= 1000) {
      svg.setAttribute("viewBox", CAMP_VIEWBOX);
      return;
    }
    const x0 = Math.max(0, Math.min(1000 - span, CAMP_FOCUS - span / 2));
    svg.setAttribute("viewBox", `${x0.toFixed(1)} 0 ${span.toFixed(1)} 200`);
  };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
  if (ro) ro.observe(scene);
  else window.addEventListener("resize", fit);

  return {
    node,
    update(state) {
      const s = campStage(state, skill.id);
      if (s === stage) return;
      stage = s;
      setText(stageChip, `${tierLabel(s)} · ${s} of ${TIERS.length}`);
      scene.replaceChildren(html(`<svg width="1000" height="200" viewBox="${CAMP_VIEWBOX}" preserveAspectRatio="xMidYMax slice" role="img" aria-label="The ${skill.name} camp">${campScene(skill.id, s, `camp-${skill.id}-`)}</svg>`));
      fit();
      setText(now, names[s - 1]);
      setText(next, s < TIERS.length ? `Next at Lv ${TIERS[s].level}: ${names[s].toLowerCase()}` : "Nothing left to build.");
    },
  };
}

/* ================= 5. THE BENCH ================= */
/* Components and Wares, one tier at a time. The tier row shows every tier
   the skill has reached and the one after it, never further. */

// The bench as it was last left, per skill, this session only.
const benchPicks = new Map();

const tiersOf = (skillId) => [...new Set(actionsFor(skillId).map((a) => a.tier))].sort((a, b) => a - b);

function benchPick(state, skillId, reached, next) {
  let pick = benchPicks.get(skillId);
  if (!pick) {
    // First visit: open where the crews already are, else the newest tier's components.
    const t = state.tasks.skilling;
    const def = t && t.skillId === skillId ? findAction(skillId, t.actionId) : null;
    pick = def ? { tab: benchGroupOf(def).tab, tier: def.tier } : { tab: "components", tier: null };
    benchPicks.set(skillId, pick);
  }
  // A remembered tier that is no longer on the row (a camp started over) falls back to the newest reached.
  if (!reached.includes(pick.tier) && !(next && pick.tier === next)) pick.tier = reached[reached.length - 1];
  if (!GameData.BENCH_TABS.some((tab) => tab.id === pick.tab)) pick.tab = GameData.BENCH_TABS[0].id;
  return pick;
}

function benchView(ctx, skill) {
  const node = h("section.section");
  let sig = null;
  let refs = [];

  function build(level, pick, reached, next) {
    dropTipIn(node);
    const inTier = actionsFor(skill.id).filter((a) => a.tier === pick.tier);
    const locked = TIERS[pick.tier - 1].level > level;

    // seg-full: on phones the two tabs share the whole row (UI-KIT 8.3).
    const seg = h("div.seg.seg-full", { role: "tablist", "aria-label": "Bench" },
      GameData.BENCH_TABS.map((tab) => h("button.seg-btn", {
        type: "button",
        role: "tab",
        "aria-selected": tab.id === pick.tab ? "true" : "false",
        "data-bench-tab": tab.id,
      }, tab.label, h("span.count", String(inTier.filter((d) => benchGroupOf(d).tab === tab.id).length)))));

    const tierRow = h("div.tier-row", { role: "group", "aria-label": "Tier" },
      reached.concat(next ? [next] : []).map((i) => h("button.tier", {
        type: "button",
        class: { "is-next": i === next },
        "aria-pressed": i === pick.tier ? "true" : "false",
        "aria-label": `Lv ${TIERS[i - 1].level}, tier ${i}${i === next ? ", not open yet" : ""}`,
        "data-bench-tier": String(i),
      }, i === next ? iconEl("lock") : null, `Lv ${TIERS[i - 1].level}`)));

    refs = [];
    const tab = GameData.BENCH_TABS.find((t) => t.id === pick.tab);
    const groups = tab.groups.map((group) => {
      const defs = inTier.filter((d) => {
        const g = benchGroupOf(d);
        return g.tab === tab.id && g.group === group;
      });
      if (!defs.length) return null;
      const pills = defs.map((d) => {
        const ref = recipePill(ctx, d, locked);
        refs.push(ref);
        return ref.node;
      });
      return h("div.bench-group",
        h("div.bench-label", h("span.eyebrow", group), h("span.count", String(defs.length))),
        h("div.pills", pills));
    }).filter(Boolean);

    node.replaceChildren(h("div.bench-bar", seg, tierRow),
      ...(groups.length ? groups : [h("div.empty.empty-sm", h("div.empty-art", iconEl("hammer")), h("div.empty-title", "Nothing to make at this tier"))]));
  }

  function update(state) {
    const level = skillLevel(state, skill.id);
    const tiers = tiersOf(skill.id);
    const reached = tiers.filter((i) => TIERS[i - 1].level <= level);
    const next = tiers.find((i) => TIERS[i - 1].level > level) || null;
    const pick = benchPick(state, skill.id, reached, next);
    const nextSig = `${reached.length}|${pick.tab}|${pick.tier}`;
    if (nextSig !== sig) {
      sig = nextSig;
      build(level, pick, reached, next);
    }
    const plan = skillPlan(state);
    refs.forEach((r) => paintRecipe(r, state, plan));
  }

  // Choosing a tab or tier rebuilds the bench; focus follows to the new button so a keyboard keeps its place.
  const choose = (b, attr, set) => {
    const pick = benchPicks.get(skill.id);
    if (!pick) return;
    const hadFocus = document.activeElement === b;
    const value = b.getAttribute(attr);
    set(pick, value);
    update(ctx.state);
    const again = hadFocus ? qs(`[${attr}="${value}"]`, node) : null;
    if (again) again.focus({ preventScroll: true });
  };
  on(node, "click", "[data-bench-tab]", (e, b) => choose(b, "data-bench-tab", (p, v) => { p.tab = v; }));
  on(node, "click", "[data-bench-tier]", (e, b) => choose(b, "data-bench-tier", (p, v) => { p.tier = Number(v); }));

  return { node, update };
}

/* ================= 6. THE PAGE ================= */

function missingPage() {
  return h("div.empty",
    h("div.empty-art", iconEl("unknown")),
    h("div.empty-title", "No such work"),
    h("p.empty-text", "Nobody in camp practises that."),
    h("a.btn.btn-sm", { href: "#/character" }, "Back to your character"));
}

/* This page serves the Trades and the Artisans, so its breadcrumb group is a
   function of ctx, like title. It also reads as the group of the skill last
   shown, for a shell that treats group as a plain string. */
let lastKind = "gather";
const seen = (ctx) => {
  const s = workSkill(ctx && ctx.route ? ctx.route.arg : null);
  if (s) lastKind = s.kind;
  return s;
};
const kindGroup = () => (lastKind === "craft" ? "Artisans" : "Trades");
function group(ctx) {
  seen(ctx);
  return kindGroup();
}
group.toString = kindGroup;

export default {
  id: "skill",
  title: (ctx) => {
    const s = seen(ctx);
    return s ? s.name : "Skills";
  },
  group,

  mount(view, ctx) {
    const root = h("div.page");
    view.appendChild(root);
    let skillId;
    let parts = [];

    function build(id) {
      skillId = id;
      dropTipIn(root);
      const skill = seen({ route: { arg: id } });
      if (!skill) {
        parts = [];
        root.replaceChildren(missingPage());
        return;
      }
      parts = [heroView(ctx, skill), skill.kind === "gather" ? gatherView(ctx, skill) : benchView(ctx, skill)];
      if (skill.kind === "gather") parts.push(campView(skill));
      root.replaceChildren(...parts.map((p) => p.node));
    }

    // One listener for every pill, however often the lists are rebuilt.
    const offPills = on(root, "click", ".item-pill .pill-hit", (e, b) => {
      openPopup("action", ctx, skillId, b.closest(".item-pill").dataset.action);
    });

    const handle = {
      update(next) {
        const c = next || ctx;
        const id = c.route ? c.route.arg : null;
        if (id !== skillId) build(id);
        const state = c.state;
        const now = c.now;
        parts.forEach((p) => p.update(state, now));
      },
      unmount() {
        offPills();
        dropTipIn(root);
      },
    };
    handle.update(ctx);
    return handle;
  },
};
