/* ============================================================
   Respite · popups/action.js · The Foreman
   ------------------------------------------------------------
   The popup behind every gathering node and bench recipe: what
   one action takes and gives, how many to run, and the verb that
   sets the crews to it. Registered as "action" (skillId, actionId).

   Also home to what the skill pages share with it: the XP chips
   and the tooltips that say what a node gives or what a recipe
   makes, before anything is committed.
   ============================================================ */

import { h, on, setText, setWidth, setAttr, toggleClass } from "../dom.js";
import { iconEl, artEl, hasArt } from "../icons.js";
import { openModal, tipBody, toast } from "../overlay.js";
import { fmt, fmtWhole, fmtGold, fmtTime, signedPct, chancePct, titleCase } from "../format.js";
import { qtyPicker, registerPopup, openPopup } from "../widgets.js";
import { CONFIG } from "../../../shared/config.js";
import {
  GameData, findAction, getSkill, getGear, actionOutput, regionOfTier, itemSources, skillName, tierLabel } from "../../../shared/registry.js";
import { itemDef, itemName, makeKey } from "../../../shared/items.js";
import { haveQty, stockCovers } from "../../../shared/storage.js";
import { skillLevel } from "../../../shared/stats.js";
import { xpBreakdown, xpEach, actionTime, doubleChance, toolFor } from "../../../shared/progression.js";
import { activeCompanion, companionBonus } from "../../../shared/companions.js";
import { skillPlan, actionMax } from "../../../shared/skills.js";
import { itemLore } from "../../../shared/lore.js";

const TWELVE_HOURS = CONFIG.time.idleCapMs;

/* ================= 1. SHARED WITH THE SKILL PAGES ================= */

// What the crews are said to be doing on a pill's status line.
const AT_WORK = { forgemaster: "Forging", woodwright: "Carving", tanner: "Tanning", weaver: "Weaving", artificer: "Crafting" };
export const workingWord = (skillId) => AT_WORK[skillId] || "Working";

const pct = (share) => `${Math.round(share * 100)}%`;

// "16.0s each" for quick work, "6m 30s each" once it runs past a minute.
const eachTime = (ms) => `${ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : fmtTime(ms)} each`;

// "A, B and C".
function listJoin(parts) {
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// The first sentence of a lore line: enough for a pill's status line.
export function firstSentence(text) {
  const m = String(text || "").match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : String(text || "")).trim();
}

/* Everything bending a skill's XP at `at`, as chips: { text, tone }. Nothing
   shows when nothing applies, so a plain day has no chips at all. */
export function xpChips(state, skillId, at) {
  const b = xpBreakdown(state, skillId, at);
  const out = [];
  if (b.weatherPct) out.push({ tone: b.weatherPct > 0 ? "good" : "warn", text: `${signedPct(b.weatherPct)} XP · ${b.weather.label}` });
  if (b.bountiful) out.push({ tone: "good", text: `+${Math.round(CONFIG.weather.bountifulXp * 100)}% XP · Bountiful Weekend` });
  const comp = activeCompanion(state);
  if (comp && b.companion) out.push({ tone: "good", text: `+${Math.round(b.companion * 100)}% XP · ${comp.name}` });
  if (b.buff > 1) out.push({ tone: "good", text: `×${b.buff} XP · Bounty reward` });
  return out;
}

export const chipNode = ({ text, tone = null, icon = null }) =>
  h("span.chip", { class: tone && `chip-${tone}` }, icon ? iconEl(icon) : null, text);

// Redraws a chip row only when the words on it change.
export function paintChips(row, chips, memo) {
  const sig = chips.map((c) => `${c.tone}:${c.text}`).join("|");
  if (memo.sig === sig) return;
  memo.sig = sig;
  row.replaceChildren(...chips.map(chipNode));
}

/* Label and value rows (.stats): rebuilt when the labels change, otherwise
   only the values are written. rows: [[label, value, tone?]]. */
export function paintStatRows(box, rows, memo) {
  const labels = rows.map((r) => `${r[0]}:${r[2] || ""}`).join("|");
  if (memo.labels !== labels) {
    memo.labels = labels;
    memo.values = rows.map(([, v, tone]) => h("span.v", { class: tone && `t-${tone}` }, v));
    box.replaceChildren(...rows.map(([l], i) => h("div.stat", h("span.l", l), memo.values[i])));
    return;
  }
  rows.forEach((r, i) => setText(memo.values[i], r[1]));
}

// Stat columns for gear by rarity. Veil belongs to the disciplines, so it waits for one.
const GEAR_COLS = [
  { key: "attack", head: "Attack", show: (v) => `+${fmtWhole(v)}` },
  { key: "defence", head: "Defence", show: (v) => `+${fmtWhole(v)}` },
  { key: "health", head: "Health", show: (v) => `+${fmtWhole(v)}` },
  { key: "crit", head: "Crit", show: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "veil", head: "Veil", show: (v) => `+${fmtWhole(v)}`, discipline: true },
];

/* A piece of gear at every rarity, Common to Relic, from the same defs the
   hunt reads. A Relic is Legendary with a prefix, and the prefix is what
   the foot line says. */
export function gearTable(state, base) {
  const g = getGear(base);
  const pool = g.slot === "weapon" || g.slot === "offhand" ? GameData.WEAPON_PREFIXES : GameData.ARMOUR_PREFIXES;
  const defs = GameData.RARITIES.map((r) => ({ r, d: itemDef(makeKey(base, r.key, "x1", r.key === "relic" ? pool[0].id : null)) }));
  const cols = GEAR_COLS.filter((c) => (!c.discipline || state.player.klass) && defs.some(({ d }) => d[c.key] > 0));
  return {
    head: ["Rarity", ...cols.map((c) => c.head)],
    rows: defs.map(({ r, d }) => ({ rarity: r.key, cells: [r.name, ...cols.map((c) => c.show(d[c.key]))] })),
    foot: `${g.twoHanded ? "Two-handed. " : ""}A Relic is Legendary with a prefix, such as ${pool[0].name} or ${pool[1].name}.`,
  };
}

// Where a thing goes next: a chest's slots, or the recipes that eat it, nearest its own tier first.
export function usesLine(key) {
  const d = itemDef(key);
  if (!d) return null;
  if (d.chest) return `Opened, it adds ${d.chest} slots to the Stockpile.`;
  const near = (a) => Math.abs(a.tier - (d.tier || 1));
  const names = itemSources(key).usedIn.filter(Boolean)
    .map((a, i) => ({ a, i }))
    .sort((x, y) => near(x.a) - near(y.a) || x.i - y.i)
    .map(({ a }) => titleCase(a.name));
  if (!names.length) return null;
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  return `Goes into ${listJoin(more ? shown.concat(`${more} more`) : shown)}.`;
}

// A tool's worth: how much quicker than what is in hand now.
function toolRows(state, d) {
  const inHand = toolFor(state, d.forSkill);
  const better = !inHand || d.speed > inHand.speed;
  return [
    ["Speed", `${skillName(d.forSkill)} ${pct(d.speed)} quicker`, better ? "good" : null],
    ["In hand", inHand ? `${inHand.name} · ${pct(inHand.speed)}` : "Bare hands"],
  ];
}

/* What a recipe makes, for the (i) on its pill: gear by rarity, a tool's
   speed (tools come off the bench plain, so there is one number), or a
   material's value and what it goes into. */
export function makesTip(state, def) {
  const outKey = actionOutput(def);
  if (def.craftGear) {
    const t = gearTable(state, def.craftGear);
    return tipBody({ title: getGear(def.craftGear).name, sub: "Rarity is rolled when it is made", table: t, foot: t.foot });
  }
  const d = itemDef(outKey);
  const held = fmt(haveQty(state, outKey));
  if (d.kind === "tool") {
    return tipBody({
      title: d.name,
      sub: `${skillName(d.forSkill)} tool · ${tierLabel(d.tier)}`,
      rows: [...toolRows(state, d), ["Value", fmtGold(d.value)], ["Held", held]],
    });
  }
  return tipBody({
    title: d.name,
    sub: `${d.category || "Material"} · ${tierLabel(d.tier)}`,
    rows: [["Makes", `${def.out[outKey]} × ${d.name}`], ["Value", `${fmtGold(d.value)} each`], ["Held", held]],
    foot: usesLine(outKey),
  });
}

// What else a gathering action turns up: its reagent, or with a companion's help an extra one.
function sideFinds(state, def) {
  const bonus = companionBonus(state, "reagent", def.skillId);
  const outKey = actionOutput(def);
  if (def.reagentId) {
    return [{ key: def.reagentId, label: itemName(def.reagentId), value: `${chancePct(Math.min(1, def.reagentChance * (1 + bonus)))} each` }];
  }
  if (bonus && GameData.REAGENTS.some((r) => r.id === outKey)) {
    return [{ key: outKey, label: `Extra ${itemName(outKey)}`, value: `${chancePct(bonus)} each` }];
  }
  return [];
}

// What a gathering node gives, for the (i) on its pill.
export function nodeTip(state, def, at) {
  const skill = getSkill(def.skillId);
  const outKey = actionOutput(def);
  const dbl = doubleChance(state, def.skillId);
  const rows = [];
  if (skillLevel(state, def.skillId) < def.level) rows.push(["Needs", `${skill.name} Lv ${def.level}`, "bad"]);
  rows.push(
    ["Time", eachTime(actionTime(state, def))],
    ["Experience", `${fmtWhole(xpEach(state, def.skillId, def.xp, at))} XP each`],
    ["Yield", `${def.out[outKey]} × ${itemName(outKey)}`],
  );
  if (dbl) rows.push(["Double yield", chancePct(dbl), "good"]);
  sideFinds(state, def).forEach((f) => rows.push([f.label, f.value]));
  rows.push(["Held", fmt(haveQty(state, outKey))]);
  return tipBody({ title: titleCase(def.name), sub: `${skill.name} · ${tierLabel(def.tier)} · ${regionOfTier(def.tier).name}`, rows });
}

/* ================= 2. THE POPUP ================= */

// The amount last chosen for each skill, this session only. No limit until told otherwise.
const lastPick = new Map();

registerPopup("action", openActionPopup);

function openActionPopup(ctx, skillId, actionId) {
  const skill = typeof skillId === "string" ? getSkill(skillId) : null;
  const def = skill && (skill.kind === "gather" || skill.kind === "craft") && typeof actionId === "string"
    ? findAction(skillId, actionId) : null;
  if (!def) {
    toast("No such work", { kind: "warn" });
    return null;
  }

  const craft = skill.kind === "craft";
  const outKey = actionOutput(def);
  const outDef = itemDef(outKey);
  const name = titleCase(def.name);
  // The last amount picked for this skill; else the amount this very action is already running; else No limit.
  const running = ctx.state.tasks.skilling;
  const memo = lastPick.get(skillId)
    || (running && running.skillId === skillId && running.actionId === actionId
      ? { n: running.limit || 1, unlimited: running.limit == null }
      : { n: 1, unlimited: true });
  const remember = () => lastPick.set(skillId, { n: picker.pick.n, unlimited: picker.pick.unlimited });

  // ---- the parts that stay put; update() writes into them ----
  const lore = itemLore(outDef);
  const chipRow = h("div.chip-row");
  const stats = h("div.stats");
  const rarityWell = def.craftGear ? h("div.well") : null;
  const list = h("div.ap-list");
  const listBlock = h("div.ap-block", h("div.eyebrow", craft ? "Needs" : "Also turns up"), list);
  const runText = h("span");
  const runLeft = h("b");
  const runFill = h("i");
  const run = h("div.ap-run", { hidden: true }, h("div.ap-run-top", runText, runLeft), h("div.bar", runFill));
  const plan = h("p.ap-plan");

  // No limit is gone: Max is the ceiling, so the two ends of the box are Min and Max.
  const picker = qtyPicker({
    value: memo.unlimited ? Math.max(1, actionMax(ctx.state, def)) : memo.n,
    allowUnlimited: false,
    presets: [],
    showMin: true,
    max: Math.max(1, actionMax(ctx.state, def)),
    onChange: () => { remember(); update(); },
  });

  const chipMemo = {};
  const statMemo = {};
  const listMemo = {};
  let planSig = null;
  let raritySig = null;
  let shownActive = false;   // the footer is first built without Stop
  let m = null;

  const start = () => {
    const btn = m.buttons[m.buttons.length - 1];
    if (btn && btn.disabled) return false;
    remember();
    return ctx.dispatch("startSkill", { skillId, actionId, limit: picker.limit() })
      .then((res) => (res && res.ok ? undefined : false));
  };
  const stop = () => ctx.dispatch("stopSkill", {}).then(() => undefined);
  const actionsFor = (active) => [
    active ? { label: "Stop", kind: "quiet", onClick: stop } : null,
    { label: skill.verb, kind: "primary", onClick: start },
  ];

  // Enter in the box starts the work, as the start button would.
  picker.input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !m) return;
    e.preventDefault();
    const btn = m.buttons[m.buttons.length - 1];
    if (btn && !btn.disabled) btn.click();
  });

  function statRows(state, now, locked) {
    const rows = [];
    if (locked) rows.push(["Needs", `${skill.name} Lv ${def.level}`, "bad"]);
    rows.push(
      ["Time", eachTime(actionTime(state, def))],
      ["Experience", `${fmtWhole(xpEach(state, skillId, def.xp, now))} XP each`],
    );
    // No "Yield" row and no "Held" row: the list you clicked through to get here already
    // says what this makes and how much of it you have.
    if (def.craftGear) rows.push(["Makes", `${getGear(def.craftGear).name}, rarity rolled`]);
    const dbl = craft ? 0 : doubleChance(state, skillId);
    if (dbl) rows.push(["Double yield", chancePct(dbl), "good"]);
    if (outDef.kind === "tool") rows.push(...toolRows(state, outDef));
    else if (craft && !def.craftGear) rows.push(["Value", `${fmtGold(outDef.value)} each`]);
    return rows;
  }

  // Recipe inputs (have against need for the chosen amount), or a node's side finds.
  function paintList(state, n) {
    const rows = craft
      ? Object.keys(def.cost || {}).map((key) => {
        const have = haveQty(state, key);
        const need = def.cost[key];
        return {
          key,
          label: itemName(key),
          value: n && n > 1 ? `${fmt(need * n)} for ${fmt(n)} · ${fmt(have)} held` : `${fmt(need)} each · ${fmt(have)} held`,
          short: have < need * (n || 1),
        };
      })
      : sideFinds(state, def);
    const sig = rows.map((r) => `${r.key}:${r.label}`).join("|");
    if (listMemo.sig !== sig) {
      listMemo.sig = sig;
      listMemo.vals = rows.map(() => h("span.ap-val"));
      list.replaceChildren(...rows.map((r, i) => h("div.ap-row",
        h("button.ap-link", { type: "button", "data-key": r.key }, artEl(itemDef(r.key)), h("span", r.label)),
        listMemo.vals[i])));
    }
    setAttr(listBlock, "hidden", rows.length === 0);
    rows.forEach((r, i) => {
      setText(listMemo.vals[i], r.value);
      toggleClass(listMemo.vals[i], "is-short", !!r.short);
    });
  }

  function update() {
    if (!m || m.closed) return;
    const state = ctx.state;
    const now = ctx.now;
    const locked = skillLevel(state, skillId) < def.level;
    const t = state.tasks.skilling;
    const active = !!(t && t.skillId === skillId && t.actionId === actionId);
    const time = actionTime(state, def);
    const xp = xpEach(state, skillId, def.xp, now);
    const stock = craft ? stockCovers(state, def.cost) : Infinity;

    picker.refresh(Math.max(1, actionMax(state, def)));
    const n = picker.pick.unlimited ? null : picker.pick.n;

    paintChips(chipRow, xpChips(state, skillId, now), chipMemo);
    paintStatRows(stats, statRows(state, now, locked), statMemo);
    if (rarityWell) {
      // The Veil column arrives with a discipline; nothing else here moves.
      const sig = state.player.klass || "-";
      if (raritySig !== sig) {
        raritySig = sig;
        const table = gearTable(state, def.craftGear);
        rarityWell.replaceChildren(tipBody({ table, foot: table.foot }));
      }
    }
    paintList(state, n);

    // ---- underway now ----
    const sp = active ? skillPlan(state) : null;
    setAttr(run, "hidden", !sp);
    if (sp) {
      setText(runText, sp.limit == null
        ? `Underway · ${fmtWhole(sp.done)} · No limit`
        : `Underway · ${fmtWhole(sp.done)} of ${fmtWhole(sp.limit)}`);
      setText(runLeft, `${fmtTime(sp.timeLeft)} left`);
      toggleClass(runFill, "nojump", sp.pct < 6);
      setWidth(runFill, sp.pct);
    }

    // ---- what the chosen amount comes to ----
    const per12 = Math.floor(TWELVE_HOURS / time);
    const count = n || picker.pick.n;
    const lead = `${fmtWhole(count)} × ${name}`;
    const rest = ` · ${fmtTime(count * time)} · ${fmtWhole(count * xp)} XP`;
    let warn = "";
    if (craft && stock < count) warn = `Stock covers ${fmtWhole(stock)}.`;
    else if (count > per12) warn = "Stops at twelve hours.";
    const sig = `${lead}${rest}|${warn}`;
    if (planSig !== sig) {
      planSig = sig;
      plan.replaceChildren(...[h("span", h("b", lead), rest), warn ? h("span.t-warn", warn) : null].filter(Boolean));
    }

    // ---- the buttons: Stop only while this runs; the verb says why it can't ----
    if (shownActive !== active) {
      shownActive = active;
      m.setActions(actionsFor(active));
    }
    const go = m.buttons[m.buttons.length - 1];
    if (go && !go.classList.contains("is-loading")) {
      const reason = locked ? `Needs Lv ${def.level}` : craft && stock < 1 ? "Missing materials" : null;
      setAttr(go, "disabled", !!reason);
      setText(go.lastChild, reason || skill.verb);
    }
  }

  const offTick = ctx.onTick(update);
  m = openModal({
    title: name,
    sub: [skill.name, tierLabel(def.tier), craft ? "At camp" : regionOfTier(def.tier).name].join(" · "),
    // The sheet is about one material, so it wears that material's face.
    art: hasArt(def) ? artEl(def) : def.icon,
    artClass: hasArt(def) ? "art-paint" : "",
    size: "md",
    // Centres the picker and the verb: this sheet is one decision, so it sits down the middle.
    className: "modal-center-foot",
    body: [
      lore ? h("p.ap-desc", lore) : null,
      chipRow,
      stats,
      rarityWell ? h("div.ap-block", h("div.eyebrow", "By rarity"), rarityWell) : null,
      // No "Goes into..." note: it belongs on the item, not on the order sheet.
      listBlock,
      run,
      h("div.ap-block", picker.node),
      plan,
    ],
    actions: actionsFor(false),
    onClose: () => offTick(),
  });
  on(m.body, "click", ".ap-link[data-key]", (e, b) => openPopup("item", ctx, b.dataset.key, { from: null }));
  update();
  return m;
}
