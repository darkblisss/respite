/* ============================================================
   Respite · popups/zone.js · The Ground
   ------------------------------------------------------------
   Where a hunt is taken up. What a zone fields, then the hunt played
   out ahead of time: three twelve-hour runs from full health with the
   remedies in the Satchel, which are the only ones a fight can
   reach. The runs are played one at a time after the
   popup has painted, and kept by signature while nothing that
   matters has changed, as v4 did.

   The projection is shown as a warning and a record to beat, not as
   throughput: the live XP/hr and DPS belong to a run in progress.
   Threat is region-wide, so it is stated on the Hunt page instead of
   on each of four zone sheets.

   Also exports the Hunt XP chips and the party count, which the
   Hunt page shows in its hero.
   ============================================================ */

import { h, setAttr, setText, setWidth, toggleClass } from "../dom.js";
import { iconEl } from "../icons.js";
import { openModal, tipBody, tooltip } from "../overlay.js";
import { fmt, fmtStat, fmtTime, signedPct } from "../format.js";
import { registerPopup, openPopup } from "../widgets.js";
import { CONFIG } from "../../../shared/config.js";
import { GameData, foesOf, sovereignOf, regionOfTier, tierLabel } from "../../../shared/registry.js";
import { bestRun, huntRates, projectOnce, summariseRuns, huntOddsOpts, oddsSignature } from "../../../shared/combat.js";
import { skillLevel, recovering } from "../../../shared/stats.js";
import { xpBreakdown, partyMult } from "../../../shared/progression.js";
import { activeCompanion } from "../../../shared/companions.js";
import { itemDef } from "../../../shared/items.js";
import { ORDER } from "../../../shared/storage.js";
import { huntInterval } from "../../store.js";

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

/* How long a run is projected to last, as a warning rather than a number. No
   warning at all while the run outlasts the horizon: silence is the good case. */
function survivalWarning(odds) {
  const ms = odds ? odds.survivalMs : null;
  if (ms == null) return null;
  if (ms < HOUR) return { text: "You will not last here.", tone: "bad" };
  if (ms < 6 * HOUR) return { text: "You will be overwhelmed here.", tone: "ember" };
  if (ms < 12 * HOUR) return { text: "This place will break you.", tone: "warn" };
  return null;
}

/* Lore, hovered rather than given a line of its own. The count of Sovereigns met
   is meant to be a figure the whole region contributes to; until the server keeps
   that tally this is what the projection saw. */
function sovereignTip(region, sov, odds) {
  const met = odds && odds.sovereignsMet ? odds : null;
  return tipBody({
    title: sov.name,
    sub: `The Sovereign of ${region.name}`,
    rows: [
      ["Comes", "Once the region's Threat is maxed"],
      ["Met", met ? `About ${fmtStat(met.metPerHour)} an hour at this pace` : "Not on this pace"],
      ["Felled", met ? pctOf(met.sovereignsFelled / met.sovereignsMet) : "Never, so far"],
    ],
    foot: "Felling it is one of only two things that clears a region's Threat. Hiding out a full hour is the other.",
  });
}

// Projections already played, by signature. A handful covers four zones and a change of heart.
const ODDS = new Map();
const ODDS_KEEP = 8;

function remember(sig, value) {
  ODDS.delete(sig);
  ODDS.set(sig, value);
  while (ODDS.size > ODDS_KEEP) ODDS.delete(ODDS.keys().next().value);
}

/* Remedies the hunt can reach, counted whole (remedyHeals stops counting at
   400). ORDER.eat is the Satchel, so a bottle in Belongings counts for
   nothing here, exactly as it counts for nothing in the fight. */
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
    sub: `Hunt · ${tierLabel(tier)}`,
    art: ZONE_ICONS[zone.id],
    artTone: "ember",
    // One decision, so Start the Hunt sits down the middle rather than off to the right.
    className: "modal-center-foot",
    onClose: () => {
      offTick();
      stopOdds();
    },
  });

  /* Whether this player is out on the party's fight. The rules would happily predict a second
     hunt and the server would then refuse it ("You're out with your party."), so the sheet says
     so before the press rather than taking it back afterwards. */
  const outWithParty = () => {
    const view = ctx.store ? ctx.store.partyHunt : null;
    const me = ctx.account ? ctx.account.userId : null;
    if (!view || view.over || !me || !Array.isArray(view.hunters)) return false;
    return view.hunters.some((u) => u && String(u.userId).toLowerCase() === String(me).toLowerCase());
  };

  // Where the hunt is, and whether the ground is open and suited: each changes the buttons or the rows.
  function shapeOf(state) {
    const c = state.tasks.combat;
    return [c ? `${c.tier}:${c.zone}` : "-", state.travel.unlocked.includes(region.id),
      skillLevel(state, "warfare") < region.level, outWithParty()].join("|");
  }

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

    /* Threat is gone, so there is no counter to report. What the sheet says instead
       is the flat chance this ground shows its Sovereign, which is the whole of it. */
    const facts = h("div.stats");
    if (skillLevel(state, "warfare") < region.level) stat(facts, "Suited to", `Hunt Lv ${region.level} and up`, "bad");
    stat(facts, "Reinforcements", `Every ${zone.windowMs / 1000}s`);
    stat(facts, "Elites", pctOf(zone.elite));
    stat(facts, "XP a kill", `×${zone.xp}`);
    stat(facts, "Foes here", `×${zone.power} health and damage`);
    if (zone.sovereign > 0) {
      stat(facts, "Sovereign", `${pctOf(zone.sovereign)} an encounter`);
      stat(facts, "At its side", `${GameData.SOVEREIGN.escorts} Elites`);
    }
    if (zone.fragments) stat(facts, "Elites leave", "A Veil Fragment");

    /* Throughput numbers are gone from this sheet: the live XP/hr and DPS are on the
       run bar and the Hunt page, and a projected kills-an-hour only encouraged
       staring at the rate. What is left is a record to beat and an honest warning. */
    const played = h("div.stats");
    const best = stat(played, "Best run", h("small", "Reckoning"));
    const remedies = stat(played, "In the Satchel", "");
    const warn = h("p.zone-warn", { hidden: true });
    const stock = h("p.zone-warn.t-warn", { hidden: true }, "Nothing is packed. Put remedies in your Satchel before you set out.");

    const runTop = h("span");
    const runRate = h("b");
    const runFill = h("i");
    const run = here
      ? h("div.ap-run", { "data-tone": "ember" }, h("div.ap-run-top", runTop, runRate), h("div.bar.bar-ember", runFill))
      : null;

    const foeRow = (mob, value) => h("div.ap-row",
      h("button.ap-link", { type: "button", "data-tone": "ember", dataset: { monster: mob.id } }, iconEl(mob.icon), h("span", mob.name)),
      h("span.ap-val", value));
    /* The Sovereign's line is not a per-encounter chance like the rest of the list,
       and a percentage there read as though it were. It says what it is instead. */
    const sovRow = foeRow(sov, zone.sovereign > 0 ? `${pctOf(zone.sovereign)} an encounter` : "Not on this ground");
    const list = h("div.ap-list",
      foesOf(tier).map((mob) => foeRow(mob, `${pctOf(zone.mix[mob.archetype])} of foes`)),
      sovRow);
    // Flavour, not something to act on, so it hovers rather than taking a line of its own.
    tooltip(sovRow, () => sovereignTip(region, sov, odds), { placement: "top" });
    list.addEventListener("click", (e) => {
      const link = e.target instanceof Element ? e.target.closest("button.ap-link[data-monster]") : null;
      if (!link) return;
      // One popup at a time: the foe's Back button brings this one back.
      m.close("action");
      openPopup("foe", ctx, link.dataset.monster, { back: { tier, zoneId: zone.id } });
    });

    const planWarn = h("span.t-warn");
    const chips = h("div.chip-row");

    refs = { chips, chipSig: null, best, remedies, warn, stock, runTop, runRate, runFill, planWarn };

    // No kill picker: a hunt runs until you pull back, fall, or twelve hours pass.
    m.setBody([
      h("p.ap-desc", zone.note),
      chips,
      facts,
      run,
      h("div.ap-block", h("div.eyebrow", "Twelve hours from full health"), played, warn, stock),
      h("div.ap-block", h("div.eyebrow", "Turns up here"), list),
      h("p.ap-plan", planWarn),
    ]);

    // A Promise keeps the button loading; false (a refusal, already toasted) keeps the popup open.
    const send = (type, args) => {
      busy = true;
      return Promise.resolve(ctx.dispatch(type, args))
        .then((res) => !!(res && res.ok), () => false)
        .then((ok) => { busy = false; return ok; });
    };
    // No limit to send: a hunt runs on until you stop it or it stops you.
    const start = () => send("startHunt", { tier, zone: zone.id, limit: null });
    const pull = () => send("pullBack", {});

    let actions;
    if (recovering(state)) actions = [{ label: "Recovering", kind: "ember", disabled: true }];
    else if (outWithParty()) actions = [{ label: "Out with your party", kind: "ember", disabled: true }];
    else if (!open) actions = [{ label: "Not open to you", kind: "ember", disabled: true }];
    else if (here) actions = [{ label: "Pull back", kind: "quiet", onClick: pull }];
    else actions = [{ label: c ? "Move the hunt here" : "Start the Hunt", kind: "ember", icon: "swords", onClick: start }];
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

  /* The survival projection is a warning, not a number: nothing at all while the
     run holds, then amber, orange and red as it stops holding. Sentence case, and
     never shouted. A remedy shortage is said underneath, because it is the one
     thing the player can go and fix. */
  function paintOdds() {
    if (!odds || !refs) return;
    const w = survivalWarning(odds);
    setText(refs.warn, w ? w.text : "");
    ["warn", "ember", "bad"].forEach((t) => toggleClass(refs.warn, `t-${t}`, !!w && w.tone === t));
    setAttr(refs.warn, "hidden", !w);
  }

  function paintPlan() {
    if (!refs) return;
    const state = ctx.state;
    setText(refs.planWarn, recovering(state)
      ? `Back on your feet in ${fmtTime(state.player.recoveryLeft)}.`
      : outWithParty() ? "Break away from the party's fight before you set out alone." : "");
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

    // The record to beat on this ground, banked however a run ended.
    const record = bestRun(state, tier, zone.id);
    setText(refs.best, record > 0 ? fmtTime(record) : "No run yet");
    toggleClass(refs.best, "t-good", record >= IDLE_CAP);

    const held = remediesHeld(state);
    const perHour = odds ? odds.remediesPerHour : 0;
    setText(refs.remedies, held ? `${fmt(held)} packed${perHour >= 0.05 ? ` · about ${fmtStat(perHour)} used an hour` : ""}` : "None packed");
    toggleClass(refs.remedies, "t-bad", !held);
    setAttr(refs.stock, "hidden", held > 0);

    if (c && c.tier === tier && c.zone === zone.id) {
      const rates = huntRates(c);
      setText(refs.runTop, `Underway · ${fmt(c.done)} kills`);
      // Live, off a rolling window, so it moves rather than standing still for minutes.
      setText(refs.runRate, rates.xpRate == null
        ? "Reckoning"
        : `${fmt(Math.round(rates.xpRate))} XP/hr · ${fmtStat(rates.dps)} DPS`);
      setWidth(refs.runFill, (c.elapsed / IDLE_CAP) * 100);
    }

    paintPlan();
  }

  build();
  offTick = ctx.onTick(() => update());
  return m;
});
