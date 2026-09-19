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
import { iconEl } from "../ui/icons.js";
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
    h("div.art", { "aria-hidden": "true" }, iconEl(def.icon)),
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
    const node = h("span.need", iconEl(itemDef(key).icon), itemName(key), h("span.have", have, h("small", `/${fmt(def.cost[key])}`)));
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
/* A drawn scene under each gathering page, v4's drawing unchanged. It gains
   a piece each time the skill reaches a new tier: the first at Lv 1, the
   last at Lv 80. Drawn with the c-* classes in pages.css. */

const CAMP_STAGES = [
  "A lean-to and a fire",
  "A tent for the crew",
  "Crates and barrels",
  "A proper work site",
  "A second crew and a cart",
  "A palisade",
  "A watchtower",
  "Banners and lanterns",
  "The great hall",
];

function campStage(state, skillId) {
  const lvl = skillLevel(state, skillId);
  return TIERS.filter((t) => t.level <= lvl).length;
}

// A cloaked worker standing on ground line y, holding the tool of the trade.
function campFigure(x, y, skillId) {
  const hand = `${x + 5} ${y - 22}`;
  const tools = {
    delving: `<path class="c-tool" d="M${hand} L${x + 15} ${y - 39}"/><path class="c-tool" d="M${x + 8} ${y - 41} Q${x + 15} ${y - 41} ${x + 21} ${y - 34}"/>`,
    felling: `<path class="c-tool" d="M${hand} L${x + 15} ${y - 39}"/><path class="c-toolhead" d="M${x + 12} ${y - 42} l8 2 -2 8Z"/>`,
    harvesting: `<path class="c-tool" d="M${hand} L${x + 11} ${y - 33}"/><path class="c-tool" d="M${x + 11} ${y - 33} q10 -4 9 8"/>`,
    flaying: `<path class="c-tool" d="M${hand} L${x + 12} ${y - 28}"/><path class="c-toolhead" d="M${x + 11} ${y - 27} l7 -5 1 2Z"/>`,
    dredging: `<path class="c-tool" d="M${x + 4} ${y - 20} L${x + 30} ${y - 58}"/>`,
  };
  return `<g class="c-fig"><circle cx="${x}" cy="${y - 34}" r="4.5"/>` +
    `<path d="M${x - 6} ${y - 28} H${x + 6} L${x + 8} ${y - 12} H${x + 4} L${x + 3} ${y} H${x + 0.5} L${x} ${y - 9} L${x - 0.5} ${y} H${x - 3} L${x - 4} ${y - 12} H${x - 8}Z"/></g>` +
    (tools[skillId] || "");
}

// The part of the camp that belongs to the trade, and where its first worker stands.
function campWorksite(skillId, big) {
  if (skillId === "delving") {
    const heap = '<path class="c-dark" d="M612 186 L630 172 L642 177 L656 166 L674 180 L684 186Z"/><path class="c-rim" d="M630 172 L642 177 L656 166"/>';
    if (!big) return { svg: heap, worker: [700, 186] };
    return {
      svg: '<path class="c-hill-mid" d="M690 186 C720 152 770 124 830 124 C890 124 940 150 980 186Z"/>' +
        '<path class="c-void" d="M810 186 V160 Q835 140 860 160 V186Z"/>' +
        '<path class="c-wood" d="M804 186 V154 H866 V186"/><circle class="c-lamp-glow" cx="804" cy="150" r="9"/><circle class="c-lamp" cx="804" cy="150" r="3"/>' +
        heap +
        '<path class="c-sil" d="M730 166 H768 L762 180 H736Z"/><path class="c-dark" d="M734 166 L742 158 L750 162 L758 156 L766 166Z"/>' +
        '<circle class="c-wheel" cx="742" cy="182" r="5"/><circle class="c-wheel" cx="758" cy="182" r="5"/>',
      worker: [786, 186],
    };
  }

  if (skillId === "felling") {
    const stump = '<path class="c-sil" d="M620 186 V170 H648 V186Z"/><ellipse class="c-dark" cx="634" cy="170" rx="14" ry="4"/>' +
      '<path class="c-wood thin" d="M640 170 L654 150"/><path class="c-toolhead" d="M650 147 l10 3 -3 8Z"/>';
    const log = '<rect class="c-sil" x="664" y="176" width="70" height="10" rx="5"/><circle class="c-rim" cx="669" cy="181" r="3"/>';
    if (!big) return { svg: stump + log, worker: [752, 186] };
    let pile = "";
    [[0, 3], [1, 2], [2, 1]].forEach(([row, count]) => {
      for (let i = 0; i < count; i++) {
        const cx = 830 + row * 10 + i * 20;
        const cy = 177 - row * 17;
        pile += `<circle class="c-sil" cx="${cx}" cy="${cy}" r="9"/><circle class="c-rim" cx="${cx}" cy="${cy}" r="3.5"/>`;
      }
    });
    return {
      svg: stump + log + pile + '<path class="c-wood thin" d="M742 186 L756 164 M770 186 L756 164 M736 166 H790"/>' +
        '<rect class="c-sil" x="728" y="156" width="74" height="9" rx="4.5"/>',
      worker: [704, 186],
    };
  }

  if (skillId === "harvesting") {
    const sheaf = (x) => `<path class="c-herb" d="M${x} 186 L${x + 7} 150 L${x + 14} 186Z"/><path class="c-wood thin" d="M${x + 1} 172 H${x + 13}"/>`;
    const small = sheaf(630) + sheaf(652) + '<path class="c-sil" d="M676 172 H700 L696 186 H680Z"/>';
    if (!big) return { svg: small, worker: [720, 186] };
    let bundles = "";
    for (let x = 770; x <= 910; x += 20) bundles += `<path class="c-herb" d="M${x} 142 l-5 18 h10Z"/>`;
    return {
      svg: small + '<path class="c-wood thin" d="M750 186 L764 138 L778 186 M902 186 L916 138 L930 186"/><path class="c-rope" d="M764 140 H916"/>' + bundles,
      worker: [724, 186],
    };
  }

  if (skillId === "flaying") {
    const frame = (x) => `<path class="c-wood thin" d="M${x} 186 V146 M${x + 50} 186 V146 M${x - 4} 150 H${x + 54}"/>` +
      `<path class="c-hide" d="M${x + 6} 153 C${x + 18} 151 ${x + 32} 151 ${x + 44} 153 C${x + 46} 167 ${x + 42} 177 ${x + 25} 183 C${x + 8} 177 ${x + 4} 167 ${x + 6} 153Z"/>`;
    if (!big) return { svg: frame(640), worker: [720, 186] };
    return {
      svg: frame(640) + frame(760) + frame(880) + '<path class="c-sil" d="M712 186 V176 H736 V186Z"/><ellipse class="c-dark" cx="724" cy="176" rx="12" ry="3"/>',
      worker: [742, 186],
    };
  }

  // dredging
  const water = '<path class="c-water" d="M560 220 C588 202 610 193 642 189 C700 183 780 186 1000 180 V220Z"/><path class="c-shine" d="M630 202 H690 M730 208 H810 M850 199 H940"/>';
  if (!big) {
    return {
      svg: water + '<path class="c-wood thin" d="M664 190 L700 140"/><path class="c-rim" d="M700 140 Q716 158 706 180"/><path class="c-sil" d="M612 176 H636 L632 188 H616Z"/>',
      worker: [648, 188],
    };
  }
  return {
    svg: water + '<path class="c-plank" d="M640 179 H900"/><path class="c-wood thin" d="M660 181 V204 M730 181 V204 M800 181 V204 M870 181 V204"/>' +
      '<path class="c-wood thin" d="M886 176 V126 M884 128 H934 M930 128 V158"/><path class="c-rim" d="M890 132 L930 156 M930 132 L890 156 M890 144 H930"/>' +
      '<path class="c-sil" d="M612 176 H636 L632 188 H616Z"/>',
    worker: [800, 176],
  };
}

function campScene(skillId, stage) {
  const has = (n) => stage >= n;
  const out = [];

  out.push(
    '<defs>' +
      '<linearGradient id="campSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e1629"/><stop offset="1" stop-color="#0d0a12"/></linearGradient>' +
      '<radialGradient id="campGlow"><stop offset="0" stop-color="#c1613a" stop-opacity=".5"/><stop offset="1" stop-color="#c1613a" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="campFog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d6fd1" stop-opacity="0"/><stop offset="1" stop-color="#8d6fd1" stop-opacity=".08"/></linearGradient>' +
      '<linearGradient id="campHorizon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d6fd1" stop-opacity="0"/><stop offset=".7" stop-color="#8d6fd1" stop-opacity=".1"/><stop offset="1" stop-color="#8d6fd1" stop-opacity="0"/></linearGradient>' +
    '</defs>',
    '<rect width="1000" height="220" fill="url(#campSky)"/>',
    '<rect y="96" width="1000" height="60" fill="url(#campHorizon)"/>',
    '<path class="c-star" d="M120 58h1.5M236 76h1.5M388 52h1.5M548 66h1.5M702 50h1.5M942 82h1.5M60 90h1.5M640 88h1.5"/>',
    '<circle class="c-moon-glow" cx="860" cy="74" r="22"/><circle class="c-moon" cx="860" cy="74" r="9"/>',
    '<path class="c-hill-far" d="M0 142 C110 112 210 128 320 118 C430 108 520 134 640 122 C760 110 880 126 1000 112 V220 H0Z"/>',
    '<path class="c-tree" d="M168 122 V100 M168 108 L158 98 M168 104 L177 94 M724 116 V92 M724 102 L713 91 M724 98 L734 88 M724 108 L733 101 M930 112 V94 M930 102 L921 94"/>',
    '<path class="c-hill-near" d="M0 170 C140 156 260 168 400 160 C540 152 660 166 800 158 C880 154 950 158 1000 156 V220 H0Z"/>'
  );

  if (has(6)) {
    let stakes = "";
    for (let x = 6; x < 1000; x += 15) {
      const top = 138 + ((x * 7) % 11);
      stakes += `M${x} 178 V${top + 6} L${x + 4} ${top} L${x + 8} ${top + 6} V178Z `;
    }
    out.push(`<path class="c-stake" d="${stakes}"/><path class="c-wood thin" d="M0 160 H1000"/>`);
  }

  out.push('<rect class="c-ground" y="186" width="1000" height="34"/>');

  if (has(7)) {
    out.push(
      '<path class="c-wood" d="M70 186 L82 92 M114 186 L102 92 M76 150 H108 M80 118 H104 M76 150 L104 118 M108 150 L80 118"/>' +
      '<rect class="c-sil" x="70" y="80" width="44" height="14"/><path class="c-sil" d="M64 80 L92 58 L120 80Z"/>' +
      '<rect class="c-light" x="88" y="83" width="8" height="8"/>'
    );
  }

  if (has(9)) {
    out.push(
      '<path class="c-dark" d="M136 186 V142 L230 102 L324 142 V186Z"/><path class="c-rim" d="M126 146 L230 98 L334 146"/>' +
      '<path class="c-wood thin" d="M230 98 V84 M220 92 L230 80 L240 92"/>' +
      '<rect class="c-light" x="156" y="152" width="10" height="14"/><rect class="c-light" x="196" y="152" width="10" height="14"/>'
    );
  }

  const site = campWorksite(skillId, has(4));
  out.push(site.svg);

  if (has(2)) {
    out.push(
      '<path class="c-sil" d="M455 186 L500 124 L545 186Z"/><path class="c-rim" d="M500 124 L545 186"/>' +
      '<path class="c-door" d="M491 186 L500 150 L509 186Z"/><path class="c-wood thin" d="M500 124 V112"/>'
    );
  }

  out.push('<path class="c-sil" d="M270 186 L322 128 L350 186Z"/><path class="c-wood thin" d="M262 186 L326 122"/><path class="c-rim" d="M322 128 L350 186"/>');

  if (has(8)) {
    let lamps = '<path class="c-rope" d="M326 124 Q413 150 500 116"/>';
    [[369, 133], [413, 136], [457, 130]].forEach(([x, y]) => {
      lamps += `<circle class="c-lamp-glow" cx="${x}" cy="${y + 5}" r="8"/><rect class="c-lamp" x="${x - 2}" y="${y + 2}" width="4" height="6"/>`;
    });
    out.push(lamps);
  }

  if (has(3)) {
    out.push(
      '<rect class="c-sil" x="352" y="168" width="20" height="18"/><rect class="c-sil" x="370" y="174" width="14" height="12"/>' +
      '<path class="c-rim" d="M352 168 L372 186 M372 168 L352 186"/>' +
      '<rect class="c-sil" x="560" y="170" width="14" height="16" rx="3"/><path class="c-rim" d="M560 175 H574 M560 181 H574"/>'
    );
  }

  out.push(
    '<ellipse cx="413" cy="182" rx="84" ry="30" fill="url(#campGlow)"/>' +
    '<path class="c-wood" d="M398 188 L428 180 M400 180 L428 188"/>' +
    '<g class="camp-fire"><path class="c-ember" d="M413 184 C402 174 414 166 410 152 C424 162 426 174 413 184Z"/>' +
    '<path class="c-flame" d="M413 184 C407 178 413 173 412 165 C419 171 420 178 413 184Z"/></g>'
  );

  if (has(5)) {
    out.push(
      '<path class="c-sil" d="M150 164 H206 L200 180 H156Z"/><path class="c-dark" d="M156 164 L166 152 L178 158 L190 150 L204 164Z"/>' +
      '<path class="c-wood thin" d="M206 168 L230 160"/><circle class="c-wheel" cx="166" cy="182" r="6"/><circle class="c-wheel" cx="192" cy="182" r="6"/>' +
      campFigure(240, 186, skillId)
    );
  }

  out.push(campFigure(site.worker[0], site.worker[1], skillId));

  if (has(8)) {
    out.push(
      (has(7) ? '<path class="c-wood thin" d="M92 58 V36"/><path class="c-cloth" d="M92 37 H114 L107 44 L114 51 H92Z"/>' : "") +
      '<path class="c-wood thin" d="M590 186 V120"/><path class="c-cloth" d="M590 122 H612 L605 130 L612 138 H590Z"/>'
    );
  }

  out.push('<rect y="140" width="1000" height="80" fill="url(#campFog)"/>');
  return out.join("");
}

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
  let stage = 0;

  return {
    node,
    update(state) {
      const s = campStage(state, skill.id);
      if (s === stage) return;
      stage = s;
      setText(stageChip, `${tierLabel(s)} · ${s} of ${TIERS.length}`);
      scene.replaceChildren(html(`<svg viewBox="0 34 1000 186" preserveAspectRatio="xMidYMax slice" role="img" aria-label="The ${skill.name} camp">${campScene(skill.id, s)}</svg>`));
      setText(now, CAMP_STAGES[s - 1]);
      setText(next, s < TIERS.length ? `Next at Lv ${TIERS[s].level}: ${CAMP_STAGES[s].toLowerCase()}` : "Nothing left to build.");
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
