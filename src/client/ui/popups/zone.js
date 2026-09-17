/* ============================================================
   Respite · popups/zone.js · The Ground
   ------------------------------------------------------------
   Where a hunt is taken up. What a zone fields, where its Threat
   stands and what happens when it peaks, then the hunt played out
   ahead of time: three twelve-hour runs from full health with the
   remedies you hold. The runs are played one at a time after the
   popup has painted, and kept by signature while nothing that
   matters has changed, as v4 did.

   Also exports the Hunt XP chips and the party count, which the
   Hunt page shows in its hero.
   ============================================================ */

import { h, setText, setWidth, toggleClass } from "../dom.js";
import { iconEl } from "../icons.js";
import { openModal } from "../overlay.js";
import { fmt, fmtStat, fmtTime, signedPct } from "../format.js";
import { qtyPicker, registerPopup, openPopup } from "../widgets.js";
import { CONFIG } from "../../../shared/config.js";
import { GameData, foesOf, sovereignOf, regionOfTier } from "../../../shared/registry.js";
import { threatIn, projectOnce, summariseRuns, huntOddsOpts, oddsSignature } from "../../../shared/combat.js";
import { skillLevel, recovering } from "../../../shared/stats.js";
import { xpBreakdown, partyMult } from "../../../shared/progression.js";
import { activeCompanion } from "../../../shared/companions.js";
import { itemDef } from "../../../shared/items.js";
import { ORDER } from "../../../shared/storage.js";
import { huntInterval } from "../../store.js";

const H = CONFIG.hunt;
const IDLE_CAP = CONFIG.time.idleCapMs;
const HOUR = 60 * 60 * 1000;

export const ZONE_ICONS = { outer: "zoneOuter", middle: "zoneMiddle", inner: "zoneInner", core: "zoneCore" };

const pctOf = (x) => `${Math.round(x * 100)}%`;

/* ================= 1. SHARED WITH THE HUNT PAGE ================= */

/* Party members other than you whose hunt covers `at` on this ground, and
   what they add. The rule is partyMult's; each member is asked on their own
   so the names match the bonus exactly. */
export function partyHere(ctx, tier, zoneId, at = ctx.now) {
  const party = ctx.party;
  const me = ctx.account ? ctx.account.userId : null;
  const others = party && Array.isArray(party.members)
    ? party.members.filter((m) => m && m.hunt && m.user_id !== me)
    : [];
  // The server's rule, shared with the store: a member counts only while seen in the last three minutes.
  const intervals = others.map(huntInterval);
  const mult = partyMult({ party: { intervals: intervals.filter(Boolean) } }, tier, zoneId, at);
  const names = others
    .filter((m, i) => intervals[i] && partyMult({ party: { intervals: [intervals[i]] } }, tier, zoneId, at) > 1)
    .map((m) => m.username || "Someone");
  return { mult, pct: Math.round((mult - 1) * 100), names };
}

/* Everything bending Hunt XP right now, one chip each. The party chip only
   when a ground is given and the bonus applies there now. */
export function huntChips(ctx, { tier = null, zoneId = null } = {}) {
  const state = ctx.state;
  const x = xpBreakdown(state, "warfare", ctx.now);
  const out = [];
  if (x.weatherPct) out.push({ tone: x.weatherPct > 0 ? "good" : "warn", text: `${signedPct(x.weatherPct)} XP · ${x.weather.label}` });
  if (x.bountiful) out.push({ tone: "good", text: `${signedPct(Math.round(CONFIG.weather.bountifulXp * 100))} XP · Bountiful Weekend` });
  const comp = activeCompanion(state);
  if (comp && x.companion) out.push({ tone: "good", text: `${signedPct(Math.round(x.companion * 100))} XP · ${comp.name}` });
  if (x.buff > 1) out.push({ tone: "good", text: `×${x.buff} XP · Bounty reward` });
  if (tier != null && zoneId) {
    const p = partyHere(ctx, tier, zoneId);
    if (p.pct > 0) out.push({ tone: "violet", icon: "party", text: `${signedPct(p.pct)} Hunt XP · ${p.names.length} of your party here` });
  }
  return out;
}

export const chipNode = (c) => h("span.chip", { class: `chip-${c.tone}` }, c.icon ? iconEl(c.icon) : null, c.text);

/* ================= 2. PROJECTIONS ================= */

// How many kills was last asked for, this session: the next zone popup starts there.
let lastPick = { n: 1, unlimited: true };

// Projections already played, by signature. A handful covers four zones and a change of heart.
const ODDS = new Map();
const ODDS_KEEP = 8;

function remember(sig, value) {
  ODDS.delete(sig);
  ODDS.set(sig, value);
  while (ODDS.size > ODDS_KEEP) ODDS.delete(ODDS.keys().next().value);
}

// Remedies the hunt can reach, counted whole (remedyHeals stops counting at 400).
function remediesHeld(state) {
  let n = 0;
  ORDER.eat.forEach((w) => {
    const items = state[w].items;
    Object.keys(items).forEach((k) => {
      const d = itemDef(k);
      if (d && d.heal) n += items[k];
    });
  });
  return n;
}

/* ================= 3. THE POPUP ================= */

registerPopup("zone", (ctx, tier, zoneId) => {
  const region = Number.isInteger(tier) ? regionOfTier(tier) : null;
  const zone = GameData.ZONES.find((z) => z.id === zoneId);
  if (!region || !zone) return null;
  const sov = sovereignOf(tier);

  let shape = null;       // what the body and buttons were built for
  let refs = null;        // the live nodes of that build
  let odds = null;        // the summed projection, once played
  let job = null;         // the projection being played: { sig, frame, timer }
  let busy = false;       // a command is on its way: leave the buttons alone
  let offTick = () => {};

  const m = openModal({
    title: `${zone.name} · ${region.name}`,
    sub: `Hunt · Tier ${tier}`,
    art: ZONE_ICONS[zone.id],
    artTone: "ember",
    onClose: () => {
      offTick();
      stopOdds();
    },
  });

  // Recovering, where the hunt is, whether the ground is open and suited, hiding: each changes the buttons or the rows.
  function shapeOf(state) {
    const c = state.tasks.combat;
    return [recovering(state), c ? `${c.tier}:${c.zone}` : "-", state.travel.unlocked.includes(region.id),
      skillLevel(state, "warfare") < region.level, !!state.settings.hideSovereign].join("|");
  }

  const pickMax = () => (odds && odds.killMs ? Math.max(1, Math.floor(IDLE_CAP / odds.killMs)) : 9999);

  function stat(parent, label, value, tone) {
    const v = h("span.v", { class: tone && `t-${tone}` }, value);
    parent.appendChild(h("div.stat", h("span.l", label), v));
    return v;
  }

  function build() {
    const state = ctx.state;
    shape = shapeOf(state);
    const c = state.tasks.combat;
    const here = !!(c && c.tier === tier && c.zone === zone.id);
    const open = state.travel.unlocked.includes(region.id);

    const facts = h("div.stats");
    if (skillLevel(state, "warfare") < region.level) stat(facts, "Suited to", `Hunt Lv ${region.level} and up`, "bad");
    stat(facts, "Foes at once", `${zone.foesText}, never more than ${H.maxFoes}`);
    stat(facts, "Reinforcements", `One every ${zone.windowMs / 1000}s a fight runs on`);
    stat(facts, "Elites", pctOf(zone.elite));
    stat(facts, "XP a kill", `×${zone.xp}`);
    const threat = stat(facts, "Threat", "");
    // What a peak brings. The small line wraps under the name on a narrow sheet instead of squeezing the label.
    if (state.settings.hideSovereign) {
      stat(facts, "At 100 Threat", ["You hide", h("small", "for five minutes")]);
    } else {
      stat(facts, "At 100 Threat", [sov.name, h("small", zone.engage >= 1 ? "comes every time" : `comes ${pctOf(zone.engage)} of the time`)]);
      if (zone.escorts > 0) stat(facts, "At its side", zone.escorts === 1 ? "An Elite" : `${zone.escorts} Elites`);
    }

    const reckoning = () => h("small", "Reckoning");
    const played = h("div.stats");
    const xp = stat(played, "XP/hr", reckoning());
    const kills = stat(played, "Kills an hour", reckoning());
    const last = stat(played, "You last", reckoning());
    const remedies = stat(played, "Remedies", "");
    const sovs = stat(played, "Sovereigns met", reckoning());

    const runTop = h("span");
    const runRate = h("b");
    const runFill = h("i");
    const run = here
      ? h("div.ap-run", { "data-tone": "ember" }, h("div.ap-run-top", runTop, runRate), h("div.bar.bar-ember", runFill))
      : null;

    const foeRow = (mob, value) => h("div.ap-row",
      h("button.ap-link", { type: "button", "data-tone": "ember", dataset: { monster: mob.id } }, iconEl(mob.icon), h("span", mob.name)),
      h("span.ap-val", value));
    const list = h("div.ap-list",
      foesOf(tier).map((mob) => foeRow(mob, `${pctOf(zone.mix[mob.archetype])} of foes`)),
      foeRow(sov, state.settings.hideSovereign ? "Not while you hide"
        : zone.engage >= 1 ? "When Threat peaks" : `${pctOf(zone.engage)} of Threat peaks`));
    list.addEventListener("click", (e) => {
      const link = e.target instanceof Element ? e.target.closest("button.ap-link[data-monster]") : null;
      if (!link) return;
      // One popup at a time: the foe's Back button brings this one back.
      m.close("action");
      openPopup("foe", ctx, link.dataset.monster, { back: { tier, zoneId: zone.id } });
    });

    const picker = qtyPicker({
      value: lastPick.n,
      max: pickMax(),
      unlimited: lastPick.unlimited,
      allowUnlimited: true,
      onChange: (p) => {
        lastPick = { n: p.n, unlimited: p.unlimited };
        paintPlan();
      },
    });
    picker.input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const go = m.buttons[m.buttons.length - 1];
      if (go && !go.disabled) go.click();
    });

    const planText = h("span");
    const planWarn = h("span.t-warn");
    const chips = h("div.chip-row");

    refs = {
      chips, chipSig: null, threat, xp, kills, last, remedies, sovs,
      runTop, runRate, runFill, picker, max: pickMax(), planText, planWarn, planSig: null,
    };

    m.setBody([
      h("p.ap-desc", zone.note),
      chips,
      facts,
      run,
      h("div.ap-block", h("div.eyebrow", "Twelve hours from full health"), played),
      h("div.ap-block", h("div.eyebrow", "Turns up here"), list),
      h("div.ap-block", h("div.eyebrow", "How many kills"), picker.node),
      h("p.ap-plan", planText, planWarn),
    ]);

    // A Promise keeps the button loading; false (a refusal, already toasted) keeps the popup open.
    const send = (type, args) => {
      busy = true;
      return Promise.resolve(ctx.dispatch(type, args))
        .then((res) => !!(res && res.ok), () => false)
        .then((ok) => { busy = false; return ok; });
    };
    // On the same ground the fight carries on and the count starts again.
    const start = () => {
      lastPick = { n: picker.pick.n, unlimited: picker.pick.unlimited };
      return send("startHunt", { tier, zone: zone.id, limit: picker.limit() });
    };
    const pull = () => send("pullBack", {});

    let actions;
    if (recovering(state)) actions = [{ label: "Recovering", kind: "ember", disabled: true }];
    else if (!open) actions = [{ label: "Not open to you", kind: "ember", disabled: true }];
    else if (here) actions = [{ label: "Pull back", kind: "quiet", onClick: pull }, { label: "Restart the count", kind: "ember", icon: "swords", onClick: start }];
    else actions = [{ label: c ? "Move the hunt here" : "Hunt", kind: "ember", icon: "swords", onClick: start }];
    m.setActions(actions);

    startOdds();
    update();
  }

  /* Three runs, each after a frame has painted, so the popup shows first and
     the page keeps moving between them (a strong hunter's twelve hours can take
     a few hundred milliseconds to play). A run already under way for the same
     question is left to finish. */
  function startOdds() {
    const opts = huntOddsOpts(ctx.state, tier, zone.id);
    const sig = oddsSignature(opts, tier, zone.id);
    if (job && job.sig === sig) return;
    stopOdds();
    if (ODDS.has(sig)) {
      odds = ODDS.get(sig);
      paintOdds();
      return;
    }
    odds = null;
    const runs = [];
    const mine = { sig, frame: 0, timer: 0 };
    job = mine;
    const next = () => {
      mine.frame = requestAnimationFrame(() => { mine.timer = setTimeout(step, 0); });
    };
    const step = () => {
      if (job !== mine || m.closed) return;
      runs.push(projectOnce(tier, zone.id, Object.assign({}, opts, { seed: 7 + runs.length * 7919 })));
      if (runs.length < opts.runs) {
        next();
        return;
      }
      job = null;
      // Sovereigns an hour over the time the runs actually lasted (a run ends early at a death).
      const ms = runs.reduce((n, t) => n + t.ms, 0);
      const met = runs.reduce((n, t) => n + t.met, 0);
      odds = Object.assign(summariseRuns(runs, opts.horizonMs), { metPerHour: met / (Math.max(1, ms) / HOUR) });
      remember(sig, odds);
      paintOdds();
      update();
    };
    next();
  }

  function stopOdds() {
    if (!job) return;
    cancelAnimationFrame(job.frame);
    clearTimeout(job.timer);
    job = null;
  }

  function paintOdds() {
    if (!odds || !refs) return;
    const o = odds;
    setText(refs.xp, `About ${fmt(Math.round(o.xpPerHour))}`);
    setText(refs.kills, o.killsPerHour >= 10 ? `About ${fmt(Math.round(o.killsPerHour))}`
      : o.killsPerHour > 0 ? `About ${fmtStat(o.killsPerHour)}` : "Next to none");

    let last;
    let tone = null;
    if (o.survivalMs == null) {
      last = "Outlasts twelve hours";
      tone = "good";
    } else if (o.deaths < o.runs) {
      last = `${fmtTime(o.survivalMs)}, often longer`;
    } else {
      last = `About ${fmtTime(o.survivalMs)}`;
      if (o.survivalMs < HOUR) tone = "bad";
    }
    setText(refs.last, last);
    toggleClass(refs.last, "t-good", tone === "good");
    toggleClass(refs.last, "t-bad", tone === "bad");

    setText(refs.sovs, o.sovereignsMet
      ? `About ${fmtStat(o.metPerHour)} an hour, ${pctOf(o.sovereignsFelled / o.sovereignsMet)} felled`
      : ctx.state.settings.hideSovereign ? "None, you hide" : "None");
  }

  function paintPlan() {
    if (!refs) return;
    const state = ctx.state;
    const p = refs.picker.pick;
    const killMs = odds && odds.killMs;
    let lead;
    let rest;
    let warn = "";
    if (p.unlimited) {
      lead = "No limit";
      rest = " · until you pull back, fall or twelve hours pass";
    } else {
      lead = `${fmt(p.n)} ${p.n === 1 ? "kill" : "kills"}`;
      rest = killMs ? ` · about ${fmtTime(p.n * killMs)}` : "";
      if (killMs && p.n * killMs > IDLE_CAP) warn = "Stops at twelve hours.";
    }
    if (recovering(state)) warn = `Back on your feet in ${fmtTime(state.player.recoveryLeft)}.`;
    const sig = `${lead}${rest}`;
    if (refs.planSig !== sig) {
      refs.planSig = sig;
      refs.planText.replaceChildren(h("b", lead), rest);
    }
    setText(refs.planWarn, warn);
  }

  function update() {
    if (m.closed || busy || !refs) return;
    const state = ctx.state;
    if (shapeOf(state) !== shape) {
      build();
      return;
    }
    const c = state.tasks.combat;

    const chips = huntChips(ctx, { tier, zoneId: zone.id });
    const chipSig = chips.map((x) => x.text).join("|");
    if (chipSig !== refs.chipSig) {
      refs.chipSig = chipSig;
      refs.chips.replaceChildren(...chips.map(chipNode));
    }

    setText(refs.threat, `${threatIn(state, tier, zone.id)} / ${H.threatCap} · ×${zone.threat} a kill`);

    const held = remediesHeld(state);
    const perHour = odds ? odds.remediesPerHour : 0;
    setText(refs.remedies, held ? `${fmt(held)} held${perHour >= 0.05 ? ` · about ${fmtStat(perHour)} used an hour` : ""}` : "None held");
    toggleClass(refs.remedies, "t-bad", !held);

    if (c && c.tier === tier && c.zone === zone.id) {
      setText(refs.runTop, `Underway · ${c.limit == null ? fmt(c.done) : `${fmt(c.done)} of ${fmt(c.limit)}`} kills`);
      setText(refs.runRate, c.xpRate == null ? `XP/hr in ${fmtTime(c.nextMark - c.elapsed)}` : `${fmt(Math.round(c.xpRate))} XP/hr`);
      setWidth(refs.runFill, c.limit == null ? (c.elapsed / IDLE_CAP) * 100 : (c.done / c.limit) * 100);
    }

    const max = pickMax();
    if (max !== refs.max) {
      refs.max = max;
      refs.picker.refresh(max);
    }
    paintPlan();
  }

  build();
  offTick = ctx.onTick(() => update());
  return m;
});
