/* ============================================================
   Respite · combat.js · The Battlefield
   ------------------------------------------------------------
   The hunt: zones, and the encounter engine. The engine
   is event-driven. Every combatant keeps its own swing timer and
   time jumps from one event to the next, so an open tab, a sleeping
   phone and twelve hours away all play out the same fight. The same
   engine runs projections for the zone popup without a save.

   Flow inside a fight (timers, foes, crits, gold per kill) draws from the save's one hunt stream,
   state.rng.hunt, in v4's order. It runs on from hunt to hunt,
   through pulling back and falling, so no command can deal a fresh
   one. What a kill leaves (drops, finds, Sovereign pieces) rolls on
   the kill counters, so it can't be fished for.
   ============================================================ */

import { CONFIG } from "./config.js";
import {
  GameData, getMonster, getZone, foeOf, sovereignOf, regionOfTier,
  fragmentOfTier, essenceOfTier,
} from "./registry.js";
import { itemDef, validKey, remedyTooWeak } from "./items.js";
import { ORDER, transact, sweepToVault } from "./storage.js";
import { statsOf, maxHp, mitigation, skillLevel } from "./stats.js";
import { addMastery, masteryMods } from "./mastery.js";
import { xpMult, partyMult, addXp, overLevelOf } from "./progression.js";
import { companionBonus, companionFinds } from "./companions.js";
import { bountyProgress } from "./world.js";
import { makeRng, seededRng, roll, SALT } from "./rng.js";
import { emit } from "./events.js";
import { clamp, fmt } from "./format.js";

const H = CONFIG.hunt;
const IDLE_CAP = CONFIG.time.idleCapMs;
const MAX_LIMIT = 100000;
const refuse = (error) => ({ ok: false, error });

export const EPS = 1e-6;

/* Stochastic rounding: 2.3 lands as 3 three times in ten, as 2 otherwise.
   Exported, with rollFoe and playerBlow below, because partyHunt.js has to swing
   for exactly the same numbers a solo hunter would. One implementation, or a
   party blow quietly stops matching a lone one. */
export function landed(x, rng) {
  const f = Math.floor(x);
  return f + (rng() < x - f ? 1 : 0);
}

/* ================= 1. ZONES & FOES ================= */

/* Threat is gone. A Sovereign is no longer summoned by a counter filling: every
   encounter you clear rolls the zone's flat chance that the next one is it, and
   nothing accumulates between them. These two stay, returning nothing, so old
   saves and any caller that has not caught up resolve quietly. */
export const threatKey = (tier) => String(tier);
export function threatIn(_state, _tier, _zone) { return 0; }
export const threatShown = () => 0;

/* Best time survived on a given ground, in milliseconds. Banked whenever a hunt
   ends, however it ended, so pulling out early banks the lower time it earned and
   the record only moves on a genuinely longer run. */
export const recordKey = (tier, zone) => `${tier}:${zone}`;

export function bestRun(state, tier, zone) {
  const key = recordKey(tier, zone);
  return (state.records && Object.hasOwn(state.records, key) && state.records[key]) || 0;
}

function bankRun(state, c) {
  if (!c || !(c.elapsed > 0)) return;
  const key = recordKey(c.tier, c.zone);
  const ms = Math.round(c.elapsed);
  if (ms > ((state.records && state.records[key]) || 0)) state.records[key] = ms;
}

// [[value, weight], ...] -> one value.
export function pickWeighted(pairs, rng) {
  const total = pairs.reduce((n, p) => n + p[1], 0);
  let r = rng() * total;
  for (const [value, weight] of pairs) {
    if (r < weight) return value;
    r -= weight;
  }
  return pairs[pairs.length - 1][0];
}

export function rollFoe(tier, zone, rng) {
  const arch = pickWeighted(GameData.ARCHETYPE_ORDER.map((a) => [a, zone.mix[a]]), rng);
  return { mob: foeOf(tier, arch), elite: rng() < zone.elite };
}

const FLAT = Object.freeze({ hp: 1, attack: 1, defence: 1 });

// What a zone's depth does to a foe: { hp, attack, defence }. A zone, its id, or nothing (the Outer's 1s).
export function depthOf(zone) {
  const z = typeof zone === "string" ? getZone(zone) : zone;
  return z && z.scale ? z.scale : FLAT;
}

/* A foe's numbers with the Elite modifier folded in, and the zone's depth on top:
   health, attack and Defence each by the zone's own column, XP by its `xp`. Gold is
   the same foe's whatever depth it stands at. `zone` is a zone or its id; left out,
   the foe stands as it would on the Outer. */
export function foeNumbers(mob, elite, zone = null) {
  const e = elite ? GameData.ELITE : null;
  const z = typeof zone === "string" ? getZone(zone) : zone;
  const d = depthOf(z);
  return {
    hp: Math.round(mob.hp * (e ? e.hp : 1) * d.hp),
    attack: mob.attack * (e ? e.attack : 1) * d.attack,
    defence: mob.defence * d.defence,
    xp: mob.xp * (e ? e.xp : 1) * (z && Number.isFinite(z.xp) ? z.xp : 1),
    gold: mob.gold.map((g) => Math.round(g * (e ? e.gold : 1))),
    dropQty: e ? GameData.ELITE.drops : 1,
  };
}

// "The Ash Stalker", "The Ashen Warden", "What Feeds The Roots".
export const foeTitle = (mob) => (/^(The|What) /.test(mob.name) ? mob.name : `The ${mob.name}`);


/* ================= 2. TAKING UP THE HUNT ================= */
/* A hunt runs `limit` kills, or with no limit (null) until you pull back,
   fall, or twelve hours pass. Coming back alive, the camp keeps a note
   (state.player.camp): when, with what health, and when the walk you broke
   off would have ended. Setting out again, health is what you came back
   with -- the camp heals nothing, only a remedy drunk there does -- and the
   rest of that walk still has to be walked. A fall leaves a note at one
   point of health. Moving ground mid-hunt keeps your health and the walk or
   window left. */

// A hunt with no save behind it: projections play these.
function blankHunt(tier, zone, limit) {
  return {
    tier, zone, limit: limit == null ? null : limit,
    done: 0, elapsed: 0, startedAt: 0,
    phase: "search",          // search | fight
    wait: H.searchMinMs,      // ms left of the walk to the next encounter
    kind: "normal",           // normal | sovereign
    clock: 0, reinforceAt: 0,
    joins: 0,                 // reinforcements this encounter has had, held ones included
    foes: [], uid: 1,
    swing: 0, volley: 0, veil: 0, streak: 0,
    queued: 0, sovereignNext: false, encounters: 0,
    // xp and dmg run the whole hunt; marks sample both so XP/hr and DPS can be read
    // off a rolling window at any instant. See huntRates.
    xp: 0, dmg: 0, marks: [[0, 0, 0]], nextMark: H.rateMarkMs,
    // What this run has turned up so far, key -> qty. See dropLoot.
    drops: {},
  };
}

// A new hunt for the save, with its own id. Its dice are the save's hunt stream.
export function newHunt(state, tier, zone, limit) {
  const c = blankHunt(tier, zone, limit);
  c.id = state.serial++;
  c.startedAt = state.clock;
  return c;
}

// What is left of the walk (or of lying low), or of the window of a fight broken off.
function walkLeft(c) {
  return c.phase === "fight" ? getZone(c.zone).windowMs - c.clock : c.wait;
}

// The camp's note on a hunt ended alive at `at`.
function campNote(state, c, at) {
  const walk = c.phase === "fight" ? Math.max(H.searchMinMs, walkLeft(c)) : c.wait;
  return { since: at, hp: state.player.hp, walkUntil: at + walk };
}

/* Setting out from camp at `at`: { hp, maxHp, walkMs }, the health a hunt
   would start with and its first walk. null while a hunt is out. */
export function campPlan(state, at = state.clock) {
  if (state.tasks.combat) return null;
  const most = maxHp(state);
  const note = state.player.camp;
  if (!note) return { hp: most, maxHp: most, walkMs: H.searchMinMs };
  // Camp heals nothing. What you came home with is what you set out on, unless a
  // remedy out of the Satchel or your Belongings is drunk here first.
  return { hp: Math.min(most, Math.max(0, note.hp)), maxHp: most, walkMs: Math.max(H.searchMinMs, note.walkUntil - at) };
}

export function startHunt(state, { tier, zone, limit } = {}, env) {
  const region = Number.isInteger(tier) ? regionOfTier(tier) : null;
  if (!region || !state.travel.unlocked.includes(region.id)) return refuse("That ground isn't open.");
  if (typeof zone !== "string" || !GameData.ZONES.some((z) => z.id === zone)) return refuse("No such zone.");
  if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)) {
    return refuse("A hunt is 1 to 100,000 kills, or no limit.");
  }

  const c = state.tasks.combat;
  if (c && c.tier === tier && c.zone === zone) {
    // Already out on this ground: the fight carries on, the count starts again.
    // The count starting again banks whatever the run so far was worth as a record.
    bankRun(state, c);
    c.limit = limit == null ? null : limit;
    c.done = 0;
    c.elapsed = 0;
    c.nextMark = H.rateMarkMs;
    c.marks = [[0, 0, 0]];
    c.xp = 0;
    c.dmg = 0;
    c.drops = {};
    c.startedAt = state.clock;
  } else {
    const hunt = newHunt(state, tier, zone, limit);
    if (c) {
      // Moving ground: health carries over, and so does the walk.
      hunt.wait = Math.max(H.searchMinMs, walkLeft(c));
    } else {
      const plan = campPlan(state);
      state.player.hp = plan.hp;
      hunt.wait = plan.walkMs;
      state.player.camp = null;
    }
    state.tasks.combat = hunt;
  }
  return { ok: true };
}

// Pulling back is immediate. Whatever you were fighting is left behind; the walk is still owed.
export function pullBack(state, _args, _env) {
  const c = state.tasks.combat;
  if (!c) return { ok: true };
  bankRun(state, c);
  state.player.camp = campNote(state, c, state.clock);
  state.tasks.combat = null;
  sweepToVault(state);
  return { ok: true };
}

/* Hiding went with Threat: there is no counter left to duck, and nothing in the
   engine reads this flag any more. The command is kept, and kept writing, so a
   client still carrying the toggle round-trips exactly as it did rather than
   erroring or silently disagreeing with the server about what it set. */
export function setHide(state, { on } = {}, env) {
  if (typeof on !== "boolean") return refuse("Hiding is on or off.");
  state.settings.hideSovereign = on;
  emit(state, env, "settings:hide", { on });
  return { ok: true };
}

/* XP/hr and DPS as they stand this instant: from the oldest sample still inside the
   rolling window up to now. Worked out on every read rather than written once a
   mark, so the figures move continuously instead of sitting still for minutes and
   then jumping. null while the window is too short to mean anything. */
export function huntRates(c) {
  if (!c || !Array.isArray(c.marks) || !c.marks.length) return { xpRate: null, dps: null };
  const [t0, x0, d0] = c.marks[0];
  const span = c.elapsed - t0;
  if (!(span >= H.rateMinSpanMs)) return { xpRate: null, dps: null };
  return {
    xpRate: ((c.xp - x0) * 3600000) / span,
    dps: ((c.dmg - (d0 || 0)) * 1000) / span,
  };
}

// The live hunt at a glance, for the topbar, the arena and the Character page.
export function combatPlan(state) {
  const c = state.tasks.combat;
  if (!c) return null;
  const zone = getZone(c.zone);
  const target = c.phase === "fight" ? c.foes[0] || null : null;
  let pct = 0;
  if (target) pct = clamp((target.hp / target.max) * 100, 0, 100);
  const rates = huntRates(c);
  return {
    c, zone, region: regionOfTier(c.tier), phase: c.phase, kind: c.kind,
    target, mob: target ? getMonster(target.id) : null, pct,
    done: c.done, limit: c.limit, xpRate: rates.xpRate, dps: rates.dps,
    timeLeft: Math.max(0, IDLE_CAP - c.elapsed),
  };
}

// Where the hunt is and until when, for party presence. null when not hunting.
export function huntPresence(state) {
  const c = state.tasks.combat;
  if (!c) return null;
  return { tier: c.tier, zone: c.zone, startedAt: c.startedAt, endsBy: state.clock + Math.max(0, Math.ceil(IDLE_CAP - c.elapsed)) };
}

/* ================= 3. THE ENCOUNTER ENGINE ================= */
/* Works on a context, never on the save directly:
     c        the hunt (state.tasks.combat, or a scratch copy)
     s        combat stats snapshot
     p        { hp } for the hunter
     rng      () => 0..1
   and hooks for everything with a consequence: fx, remedy, gainXp, gainGold,
   killed, sovereignDown, died, ended, met, retreated. Section 4 wires them to a
   save; section 5 to a tally. */

export function stepHunt(ctx, dt) {
  let left = dt;
  // A guard that never trips in play: one pass per millisecond is already absurd.
  const guardMax = 200000 + Math.ceil(dt);
  let guard = 0;
  while (!ctx.over && guard++ < guardMax) {
    fireDue(ctx);
    if (ctx.over || left <= EPS) break;
    // fireDue has cleared everything due, so the next event is always ahead.
    const step = Math.min(left, Math.max(EPS, untilNext(ctx)));
    move(ctx, step);
    left -= step;
  }
}

// Time until the next thing happens.
function untilNext(ctx) {
  const c = ctx.c;
  let t = Math.min(c.nextMark - c.elapsed, IDLE_CAP - c.elapsed);
  if (c.phase !== "fight") return Math.min(t, c.wait);
  t = Math.min(t, c.swing);
  if (owesMore(c)) t = Math.min(t, c.reinforceAt - c.clock);
  c.foes.forEach((f) => {
    t = Math.min(t, f.timer);
    if (f.bleed > 0) t = Math.min(t, f.bleedTimer);
  });
  return t;
}

function move(ctx, ms) {
  const c = ctx.c;
  c.elapsed += ms;
  if (c.phase !== "fight") {
    // The walk heals nothing: see CONFIG.hunt.
    c.wait -= ms;
    return;
  }
  c.clock += ms;
  c.swing -= ms;
  c.foes.forEach((f) => {
    f.timer -= ms;
    if (f.bleed > 0) f.bleedTimer -= ms;
  });
  if (ctx.s.absorb && c.volley <= 0) c.veil = Math.min(H.veilMax, c.veil + (ctx.s.absorb * ms) / 1000);
}

// Everything due now, one at a time, in a fixed order.
function fireDue(ctx) {
  const c = ctx.c;
  for (let guard = 0; guard < 500 && !ctx.over; guard++) {
    if (c.elapsed >= c.nextMark - EPS) { markRate(c); continue; }
    if (c.elapsed >= IDLE_CAP - EPS) { endHunt(ctx, "cap"); return; }

    if (c.phase !== "fight") {
      if (c.wait > EPS) return;
      beginEncounter(ctx);
      continue;
    }

    if (!c.foes.length) { endEncounter(ctx); continue; }
    if (owesMore(c) && c.clock >= c.reinforceAt - EPS) { reinforce(ctx); continue; }
    if (c.swing <= EPS) { playerSwing(ctx); continue; }

    const f = c.foes.find((x) => x.timer <= EPS);
    if (f) { foeSwing(ctx, f); continue; }

    const b = c.foes.find((x) => x.bleed > 0 && x.bleedTimer <= EPS);
    if (b) { bleedTick(ctx, b); continue; }
    return;
  }
}

// Whether fireDue would do anything right now.
function somethingDue(c) {
  if (c.elapsed >= c.nextMark - EPS || c.elapsed >= IDLE_CAP - EPS) return true;
  if (c.phase !== "fight") return c.wait <= EPS;
  if (!c.foes.length) return true;
  if (owesMore(c) && c.clock >= c.reinforceAt - EPS) return true;
  if (c.swing <= EPS) return true;
  return c.foes.some((f) => f.timer <= EPS || (f.bleed > 0 && f.bleedTimer <= EPS));
}

// Milliseconds until the live hunt's next event: 0 if one is due now, Infinity when idle.
export function nextHuntDue(state) {
  const c = state.tasks.combat;
  if (!c) return Infinity;
  if (somethingDue(c)) return 0;
  return untilNext({ c });
}

/* A sample of the run so far, taken every rateMarkMs and kept for an hour. The
   rates themselves are read off this window on demand: see huntRates. */
function markRate(c) {
  c.marks.push([c.nextMark, c.xp, c.dmg]);
  while (c.marks.length > H.rateWindowMs / H.rateMarkMs + 1) c.marks.shift();
  c.nextMark += H.rateMarkMs;
}

// Damage you dealt, for DPS. Every source counts: blows, splash, bleed and thorns.
function dealt(c, n) {
  if (n > 0) c.dmg += n;
}

// A foe stands at its zone's depth, which is the hunt's own: nothing about it is stored on the foe.
function addFoe(ctx, mob, elite, ambush) {
  const c = ctx.c;
  const n = foeNumbers(mob, elite, getZone(c.zone));
  const f = {
    uid: c.uid++, id: mob.id, elite: !!elite, hp: n.hp, max: n.hp, ambush: !!ambush,
    // A reinforcement has the initiative. Everything else staggers in.
    timer: ambush ? 300 + ctx.rng() * 400 : mob.speed * (0.45 + ctx.rng() * 0.35),
    bleed: 0, bleedTimer: 0,
  };
  c.foes.push(f);
  ctx.fx(f.uid, ambush ? "join" : "spawn", 0);
  return f;
}

function beginEncounter(ctx) {
  const c = ctx.c;
  const zone = getZone(c.zone);

  // A breath before it as well: set out wounded, or still at a quarter off the walk, you drink first.
  if (ctx.p.hp > 0 && ctx.p.hp <= ctx.s.maxHp * H.remedyAt) takeRemedy(ctx);

  c.phase = "fight";
  c.clock = 0;
  c.foes = [];
  c.encounters++;
  c.volley = 0;
  c.swing = 250 + ctx.rng() * 400;

  if (c.sovereignNext) {
    // Forced into this one: no opening for you.
    c.sovereignNext = false;
    c.kind = "sovereign";
    const sov = sovereignOf(c.tier);
    /* It never comes alone: two Elites walk in first, and you strike the oldest thing
       standing, so they are the ones you go through. It steps out of the dark behind
       them, last on the roster and last to be struck. */
    for (let i = 0; i < GameData.SOVEREIGN.escorts; i++) addFoe(ctx, rollFoe(c.tier, zone, ctx.rng).mob, true, false);
    addFoe(ctx, sov, false, false);
    ctx.met(sov);
    return;
  }

  c.kind = "normal";
  c.reinforceAt = zone.windowMs;
  c.joins = 0;
  const count = pickWeighted(zone.sizes, ctx.rng);
  for (let i = 0; i < count; i++) {
    const r = rollFoe(c.tier, zone, ctx.rng);
    addFoe(ctx, r.mob, r.elite, false);
  }

  // You walked into this one: the opening is yours.
  if (ctx.s.klass === "rogue") c.veil = H.veilMax;
  if (ctx.s.klass === "mage") {
    c.veil = H.veilMax;
    c.volley = GameData.TECHNIQUE.volley.casts;
  }
}

/* Whether the dark still owes this encounter a reinforcement: an ordinary fight takes
   at most its zone's `joins`, and a Sovereign's none. Past that nothing more comes, so
   an encounter is a wave with an end even for a hunter who kills slower than the window
   turns, and clearing it is what rolls the ground's Sovereign. */
export function owesMore(c) {
  return c.kind === "normal" && (c.joins || 0) < getZone(c.zone).joins;
}

/* One reinforcement comes due each time the zone's clock comes round, until the zone's
   `joins` have come. If the ranks are already full it is held rather than thrown away,
   and steps into the first gap a kill opens: that holding is what makes a full
   encounter feel like a swarm. */
function reinforce(ctx) {
  const c = ctx.c;
  const zone = getZone(c.zone);
  c.reinforceAt += zone.windowMs;
  c.joins = (c.joins || 0) + 1;
  if (c.foes.length >= H.maxFoes) {
    c.queued = (c.queued || 0) + 1;
    return;
  }
  const r = rollFoe(c.tier, zone, ctx.rng);
  addFoe(ctx, r.mob, r.elite, true);
}

// A slot has opened and one was already owed: it steps in at once.
function fillQueued(ctx) {
  const c = ctx.c;
  const zone = getZone(c.zone);
  c.queued--;
  const r = rollFoe(c.tier, zone, ctx.rng);
  addFoe(ctx, r.mob, r.elite, true);
}

/* One blow from you: Attack, crit, and the foe's Defence (its zone's, see foeNumbers)
   after penetration. Defence stops a share by the same curve both ways: mitigation. */
export function playerBlow(s, defence, tier, mult, crit, pen, rng) {
  const raw = s.attack * mult * (crit ? s.critDmg : 1);
  const mit = mitigation(defence * (1 - Math.min(0.9, pen)), tier);
  return Math.max(1, landed(raw * (1 - mit), rng));
}

// A foe's Defence where it stands.
export const foeDefence = (mob, zone) => mob.defence * depthOf(zone).defence;

/* A foe's blow at you, after everything you wear: `null` when it is dodged, else
   { dmg, blocked }. Dodge is rolled first and a dodged blow never lands; a blocked
   one lands at blockCut; Defence takes its share of whatever is left. The dice are
   only thrown for a hunter who has the stat, so a hunter without either swings the
   stream exactly as before. `raw` is the blow as it left the foe. */
export function foeBlow(s, raw, tier, hpNow, rng) {
  if (s.dodge > 0 && rng() < s.dodge) return null;
  let hit = raw * (1 - mitigation(s.defence, tier));
  if (s.resilient && hpNow < s.maxHp * 0.35) hit *= 0.8;
  let blocked = false;
  if (s.block > 0 && rng() < s.block) {
    hit *= H.blockCut;
    blocked = true;
  }
  return { dmg: landed(hit, rng), blocked };
}

// You always strike the first foe still standing.
function playerSwing(ctx) {
  const c = ctx.c;
  const s = ctx.s;
  const rng = ctx.rng;
  const T = GameData.TECHNIQUE;
  const zone = getZone(c.zone);
  const target = c.foes[0];
  const mob = getMonster(target.id);

  let kind = "hit";
  let mult = 1;
  let crit = rng() < s.crit;
  let pen = s.pen;
  let technique = false;

  if (c.volley > 0) {
    kind = "volley";
    mult = T.volley.mult;
    technique = true;
    c.volley--;
    c.veil = c.volley > 0 ? Math.max(0, c.veil - H.veilMax / T.volley.casts) : 0;
  } else if (s.klass && c.veil >= H.veilMax - EPS) {
    technique = true;
    c.veil = 0;
    if (s.klass === "warrior") {
      kind = "strike";
      mult = T.strike.mult;
      pen += T.strike.pen;
    } else if (s.klass === "rogue") {
      kind = "ambush";
      crit = true;
      mult = T.ambush.mult;
    } else {
      kind = "empowered";
      mult = T.empowered.mult;
    }
  }

  /* Veil Power: what the path and an amulet have made of a full Veil. 1 for anyone
     with neither, so a hunter without them swings exactly as they always did. */
  if (technique && s.tech > 1) mult *= s.tech;

  const def = foeDefence(mob, zone);
  let dmg = playerBlow(s, def, c.tier, mult, crit, pen, rng);
  // Echoing relics sometimes land a second blow.
  if (s.echoing && !technique && rng() < 0.12) dmg += playerBlow(s, def, c.tier, 1, rng() < s.crit, pen, rng);
  // Furious relics build over a run of blows taken without being hurt.
  if (s.furious) {
    c.streak++;
    dmg = Math.round(dmg * (1 + Math.min(0.25, c.streak * 0.03)));
  }
  // Executioner's leans on the wounded.
  if (s.executioner && target.hp / target.max < 0.3) dmg = Math.round(dmg * 1.3);
  // Wounding leaves something behind.
  if (s.wounding && rng() < 0.2) {
    if (target.bleed <= 0) target.bleedTimer = 1000;
    target.bleed += Math.max(1, Math.round(dmg * 0.15));
  }

  if (!technique && s.veilGain) c.veil = Math.min(H.veilMax, c.veil + s.veilGain);
  c.swing = c.volley > 0 ? H.volleyGapMs : s.speed;

  target.hp -= dmg;
  dealt(c, dmg);
  ctx.fx(target.uid, technique ? kind : crit ? "crit" : "hit", dmg);
  let landedAll = dmg;

  // A Mage's empowered casts wash over everything else in the fight too.
  const splash = (kind === "volley" || kind === "empowered") ? c.foes.filter((f) => f !== target) : [];
  splash.forEach((f) => {
    const hit = playerBlow(s, foeDefence(getMonster(f.id), zone), c.tier, mult * T.splash, false, pen, rng);
    f.hp -= hit;
    dealt(c, hit);
    landedAll += hit;
    ctx.fx(f.uid, kind, hit);
  });

  // Lifesteal: a share of everything the swing landed comes back as health.
  if (s.lifesteal > 0) ctx.p.hp = Math.min(s.maxHp, ctx.p.hp + landedAll * s.lifesteal);

  if (target.hp <= 0) killFoe(ctx, target);
  splash.forEach((f) => { if (f.hp <= 0) killFoe(ctx, f); });
}

function foeSwing(ctx, f) {
  const c = ctx.c;
  const s = ctx.s;
  const p = ctx.p;
  const mob = getMonster(f.id);
  f.timer += mob.speed;

  const raw = foeNumbers(mob, f.elite, getZone(c.zone)).attack * (f.ambush ? H.foeAmbush : 1);
  const ambush = f.ambush;
  f.ambush = false;
  const blow = foeBlow(s, raw, c.tier, p.hp, ctx.rng);
  const dmg = blow ? blow.dmg : 0;
  p.hp -= dmg;
  ctx.fx("you", !blow ? "dodge" : dmg <= 0 ? "glance" : ambush ? "ambushed" : blow.blocked ? "block" : "hurt", dmg);

  // A Warrior's Veil answers every blow aimed at it, landed or not.
  if (s.klass === "warrior") c.veil = Math.min(H.veilMax, c.veil + Math.round(s.veilGain * GameData.TECHNIQUE.strike.struck));
  if (dmg > 0) {
    c.streak = 0;
    if (s.thorned) {
      const thorns = Math.max(1, Math.round(dmg * 0.15));
      f.hp -= thorns;
      dealt(c, thorns);
      ctx.fx(f.uid, "thorns", thorns);
    }
  }

  if (p.hp <= 0) {
    die(ctx, mob);
    return;
  }
  // Thorns can finish the foe on the blow that would have sent you running: the kill counts first.
  if (f.hp <= 0) killFoe(ctx, f);
  if (ctx.over || c.phase !== "fight") return;
  // Low enough in a Sovereign's fight, you break away rather than drink: the breath after is when.
  if (c.kind === "sovereign" && p.hp <= s.maxHp * H.retreatAt) {
    retreat(ctx);
    return;
  }
  /* Anywhere else, at a quarter you drink, there and then. Nothing heals for free, so
     the Satchel is the whole hunt's healing, and a bottle that waited for the breath
     after a Core wave would too often be waiting on a corpse. */
  if (p.hp <= s.maxHp * H.remedyAt) takeRemedy(ctx);
}

function bleedTick(ctx, f) {
  f.hp -= f.bleed;
  dealt(ctx.c, f.bleed);
  ctx.fx(f.uid, "bleed", f.bleed);
  f.bleed = Math.max(0, f.bleed - 1);
  f.bleedTimer = 1000;
  if (f.hp <= 0) killFoe(ctx, f);
}

/* A remedy out of the Satchel you packed, the best first, at or below a quarter of
   your health: the moment a blow puts you there, or in the breath between
   encounters if one left you there. Never in a Sovereign's fight: a quarter there
   is where you break away. */
function takeRemedy(ctx) {
  const heal = ctx.remedy();
  if (!heal) return;
  const before = ctx.p.hp;
  ctx.p.hp = Math.min(ctx.s.maxHp, ctx.p.hp + heal * (ctx.s.vital ? 1.2 : 1));
  ctx.fx("you", "heal", Math.round(ctx.p.hp - before));
}

function killFoe(ctx, f) {
  const c = ctx.c;
  const i = c.foes.indexOf(f);
  // Already gone, or the hunt ended on an earlier blow of the same swing.
  if (i < 0 || ctx.over) return;
  c.foes.splice(i, 1);

  const mob = getMonster(f.id);
  const n = foeNumbers(mob, f.elite, getZone(c.zone));
  c.done++;
  ctx.fx(f.uid, "kill", 0);
  // The zone's XP is in n.xp already: see foeNumbers.
  const base = n.xp;
  ctx.gainXp(base);
  /* The same points, unbent: weather, a bounty's buff and the companion at your
     side all move Warfare XP and none of them move a weapon's mastery. An hour
     with a bow is an hour with a bow whatever the sky is doing. */
  if (ctx.gainMastery) ctx.gainMastery(base);
  ctx.gainGold(n.gold[0] + Math.floor(ctx.rng() * (n.gold[1] - n.gold[0] + 1)));
  ctx.killed(mob, f.elite);

  if (mob.archetype === "sovereign") ctx.sovereignDown(mob);

  // A slot just opened, and the window already owed one: it walks in now.
  if (c.queued > 0 && c.foes.length < H.maxFoes && c.kind === "normal" && !ctx.over) fillQueued(ctx);

  if (c.limit != null && c.done >= c.limit) {
    endHunt(ctx, "limit");
    return;
  }
  if (!c.foes.length) endEncounter(ctx);
}

/* An encounter is over the moment nothing is left standing, however many
   reinforcements it took to get there.

   Two things settle here. The gap to the next encounter is whatever the
   reinforcement clock still had to run, capped at ten seconds: clear fast and you
   wait a moment, never a minute, because killing well must never buy an empty
   screen. And the zone's flat Sovereign chance is rolled once, deciding whether
   the next encounter is an ordinary pull or the thing that rules this ground. */
function endEncounter(ctx) {
  const c = ctx.c;
  const zone = getZone(c.zone);
  const took = c.clock;
  const wasSovereign = c.kind === "sovereign";
  // A wave that ran its whole length leaves the dark empty for the longest breath there is.
  const owed = owesMore(c) ? c.reinforceAt - took : H.reinforceGapCapMs;

  c.phase = "search";
  c.kind = "normal";
  c.foes = [];
  c.volley = 0;
  c.queued = 0;

  // The breath between encounters: still at or below a quarter (breaking away from a Sovereign leaves you there), drink now.
  if (ctx.p.hp > 0 && ctx.p.hp <= ctx.s.maxHp * H.remedyAt) takeRemedy(ctx);

  if (wasSovereign) {
    c.wait = H.searchMinMs;
    return;
  }

  // It may be waiting in the next one.
  if (zone.sovereign > 0 && ctx.rng() < zone.sovereign) {
    c.sovereignNext = true;
    c.wait = H.searchMinMs;
    return;
  }

  c.wait = Math.max(0, Math.min(owed, H.reinforceGapCapMs));
}

// Low enough in a Sovereign fight, you break away and the hunt goes on.
function retreat(ctx) {
  const c = ctx.c;
  const sov = c.foes.map((f) => getMonster(f.id)).find((m) => m.archetype === "sovereign");
  c.foes.forEach((f) => ctx.fx(f.uid, "leave", 0));
  c.foes = [];
  ctx.retreated(sov || null, c.clock);
  endEncounter(ctx);
}

/* Dying costs a debuff, a bill at the smith and every point of health you had.
   It buys nothing and bars nothing: the gate is open the moment you are up. */
function die(ctx, mob) {
  ctx.over = true;
  ctx.died(mob);
}

function endHunt(ctx, reason) {
  ctx.over = true;
  ctx.ended(reason);
}

/* ================= 4. THE LIVE HUNT ================= */

/* Plays the save's hunt forward dt milliseconds from at0. Returns dt, or the
   offset (whole ms) inside the stretch at which the hunt ended. Anything that
   happens is dated at at0 plus how far into the stretch it came, to the
   nearest millisecond, so log lines and cooldowns agree however time is cut. */
export function huntStep(state, dt, env, at0) {
  const c = state.tasks.combat;
  if (!c) return 0;
  const e0 = c.elapsed;
  const ctx = liveHunt(state, c, env, () => at0 + Math.round(c.elapsed - e0));
  if (state.player.hp > ctx.s.maxHp) state.player.hp = ctx.s.maxHp;
  stepHunt(ctx, dt);
  if (!ctx.over) return dt;
  return clamp(Math.round(c.elapsed - e0), 0, dt);
}

function liveHunt(state, c, env, nowAt) {
  const seed = state.rng.seed;
  // Stats change mid-step when a level comes or a piece breaks. Health never sits above the new most.
  const refresh = () => {
    ctx.s = statsOf(state);
    if (state.player.hp > ctx.s.maxHp) state.player.hp = ctx.s.maxHp;
  };
  const say = (type, payload) => emit(state, env, type, Object.assign(payload, { at: nowAt() }));

  const ctx = {
    c, s: statsOf(state), p: state.player, rng: makeRng(state.rng, "hunt"), over: false,
    fx: (who, kind, amount) => {
      if (env && env.fx) say("hunt:fx", { who, kind, amount: amount || 0 });
    },
    met: (sov) => say("hunt:sovereign", { monsterId: sov.id }),
    retreated: (sov, fightMs) => say("hunt:retreat", { monsterId: sov ? sov.id : null, fightMs: Math.round(fightMs) }),
    remedy: () => {
      const spot = remedySpot(state);
      if (!spot) return 0;
      transact(state, (tx) => tx.remove(spot.pool, spot.key, 1));
      return spot.heal;
    },
    gainXp: (amount) => {
      const at = nowAt();
      // Hunting beneath yourself pays less, by the level you are at when the kill lands.
      const gain = amount * xpMult(state, "warfare", at) * partyMult(env, c.tier, c.zone, at) * overLevelOf(state, c.tier).xp;
      c.xp += gain;
      if (addXp(state, "warfare", gain, env, at)) refresh();
    },
    /* Credited to whatever is in your hands, both of them, and to nothing else.
       A new level changes the Attack the very next blow swings with, so the
       snapshot is refreshed the way a Warfare level refreshes it. A blade learns
       less from things far beneath you, and in the end nothing. */
    gainMastery: (amount) => {
      const before = masteryMods(state.equipment, state.mastery);
      if (addMastery(state, amount * overLevelOf(state, c.tier).mastery).length) {
        const after = masteryMods(state.equipment, state.mastery);
        if (after.attack !== before.attack || after.defence !== before.defence) refresh();
      }
    },
    gainGold: (n) => {
      if (n > 0) transact(state, (tx) => tx.gold(Math.round(n * (1 + companionBonus(state, "gold"))), true));
    },
    killed: (mob, elite) => { creditKill(state, mob, elite, c.zone, env, nowAt()); },
    sovereignDown: (mob) => { creditSovereign(state, mob, c.clock, env, nowAt()); },
    died: (mob) => {
      const at = nowAt();
      const took = c.elapsed;
      bankRun(state, c);
      state.tasks.combat = null;
      state.stats.deaths++;
      // Which foe, and how often: the Collection's bestiary reads this beside the kill count.
      state.foeDeaths[mob.id] = (state.foeDeaths[mob.id] || 0) + 1;
      /* No gate and no free heal. You come round where you fell, on one point of
         health, with your Attack down for ten minutes: back to the hunt whenever you
         like, only slower, and only a remedy will put the health back. The camp note
         is what keeps that 1 rather than letting campPlan hand back a full bar. */
      state.debuff = { until: at + H.deathDebuffMs, mult: 1 - H.deathDebuff };
      state.player.recoveryLeft = 0;
      state.player.hp = 1;
      state.player.camp = { since: at, hp: 1, walkUntil: at };
      sweepToVault(state);
      ctx.fx("you", "fall", 0);
      emit(state, env, "hunt:death", { monsterId: mob.id, elapsedMs: Math.round(took), at });
    },
    ended: (reason) => {
      bankRun(state, c);
      state.player.camp = campNote(state, c, nowAt());
      state.tasks.combat = null;
      sweepToVault(state);
      say("hunt:ended", { reason, kills: c.done, elapsedMs: Math.round(c.elapsed) });
    },
  };
  return ctx;
}

/* ================= 5. PROJECTIONS ================= */
/* Plays a hunt forward on a scratch copy: how fast it kills, what it earns
   and how long you last. Seeded, so the same question gets the same answer. */

// opts: { stats (required), hp, remedies: [heal, ...], xpMult, horizonMs, seed, chunkMs }
export function projectOnce(tier, zoneId, opts) {
  const o = opts || {};
  if (!o.stats) throw new TypeError("projectOnce needs opts.stats.");
  const s = o.stats;
  const horizon = Math.min(IDLE_CAP, o.horizonMs || IDLE_CAP);
  const c = blankHunt(tier, zoneId, null);
  const heals = (o.remedies || []).slice();
  const t = { kills: 0, xp: 0, gold: 0, remedies: 0, sovereigns: 0, met: 0, retreats: 0, died: false, ms: 0, killer: null };

  const ctx = {
    c, s, p: { hp: o.hp == null ? s.maxHp : o.hp }, rng: seededRng(o.seed || 1), over: false,
    fx: () => {},
    met: () => { t.met++; },
    retreated: () => { t.retreats++; },
    remedy: () => {
      if (!heals.length) return 0;
      t.remedies++;
      return heals.shift();
    },
    gainXp: (x) => {
      const g = x * (o.xpMult || 1);
      c.xp += g;
      t.xp += g;
    },
    gainGold: (g) => { t.gold += g; },
    killed: () => { t.kills++; },
    sovereignDown: () => { t.sovereigns++; },
    died: (mob) => {
      t.died = true;
      t.killer = mob.id;
    },
    ended: () => {},
  };

  const chunk = o.chunkMs || 60000;
  while (!ctx.over && c.elapsed < horizon - EPS) stepHunt(ctx, Math.min(chunk, horizon - c.elapsed));
  t.ms = c.elapsed;
  return t;
}

// Several runs, summed up: XP and kills an hour, and how long you tend to last.
export function projectHunt(tier, zoneId, opts) {
  const o = opts || {};
  const results = [];
  for (let r = 0; r < (o.runs || 3); r++) {
    results.push(projectOnce(tier, zoneId, Object.assign({}, o, { seed: (o.seed || 7) + r * 7919 })));
  }
  return summariseRuns(results, o.horizonMs);
}

export function summariseRuns(results, horizonMs) {
  const runs = results.length;
  const sum = { runs, kills: 0, xp: 0, gold: 0, ms: 0, deaths: 0, deathMs: 0, remedies: 0, sovereigns: 0, met: 0, retreats: 0, killers: {} };
  results.forEach((t) => {
    sum.kills += t.kills;
    sum.xp += t.xp;
    sum.gold += t.gold;
    sum.ms += t.ms;
    sum.remedies += t.remedies;
    sum.sovereigns += t.sovereigns;
    sum.met += t.met;
    sum.retreats += t.retreats;
    if (t.died) {
      sum.deaths++;
      sum.deathMs += t.ms;
      sum.killers[t.killer] = (sum.killers[t.killer] || 0) + 1;
    }
  });
  const hours = Math.max(1, sum.ms) / 3600000;
  return {
    xpPerHour: sum.xp / hours,
    killsPerHour: sum.kills / hours,
    goldPerHour: sum.gold / hours,
    killMs: sum.kills ? sum.ms / sum.kills : null,
    // null when every run outlasted the horizon.
    survivalMs: sum.deaths ? sum.deathMs / sum.deaths : null,
    deaths: sum.deaths, runs,
    remediesPerHour: sum.remedies / hours,
    sovereignsPerHour: sum.sovereigns / hours,
    sovereignsMet: sum.met, sovereignsFelled: sum.sovereigns, retreats: sum.retreats, killers: sum.killers,
    horizonMs: Math.min(IDLE_CAP, horizonMs || IDLE_CAP),
  };
}

/* What the zone popup plays: three twelve-hour runs from full health with the
   remedies you hold. Run a projection per frame if you like; the signature
   says when the answer can be kept. */
export function huntOddsOpts(state, tier, zone) {
  return {
    stats: statsOf(state), remedies: remedyHeals(state), hp: campHp(state),
    xpMult: xpMult(state, "warfare", state.clock) * overLevelOf(state, tier).xp, runs: 3, horizonMs: IDLE_CAP,
  };
}

/* The health a projection sets out on: what the hunt out now has, or what the camp
   would send you out with. Nothing heals for free, so a projection from a full bar
   would promise hours a hunter at half health does not have. */
function campHp(state) {
  if (state.tasks.combat) return Math.max(1, state.player.hp);
  const plan = campPlan(state);
  return plan ? Math.max(1, plan.hp) : null;
}

export function oddsSignature(opts, tier, zone) {
  return [tier, zone, JSON.stringify(opts.stats), opts.remedies.length, opts.remedies[0] || 0,
    opts.xpMult.toFixed(2), Math.round(opts.hp == null ? -1 : opts.hp)].join("|");
}

/* ================= 6. REMEDIES & LOOT ================= */

/* The best remedy in the Satchel and where it is: best heal first. Only the
   Satchel is reachable in a fight, so a bottle left in Belongings or in camp
   storage does nothing, however many of them there are. */
function remedySpot(state) {
  const level = skillLevel(state, "warfare");
  let pick = null;
  for (const w of ORDER.eat) {
    for (const k of Object.keys(state[w].items)) {
      const d = itemDef(k);
      // A bottle sized for lesser wounds than you take now is passed over, not wasted.
      if (remedyTooWeak(k, level)) continue;
      if (d && d.heal && d.heal > (pick ? pick.heal : 0)) pick = { key: k, pool: w, heal: d.heal };
    }
  }
  return pick;
}

// The next remedy the hunter would drink, or null when the Satchel is empty.
export function bestRemedy(state) {
  const spot = remedySpot(state);
  return spot ? spot.key : null;
}

// Every remedy the Satchel holds, as heal amounts, best first. Capped: enough for any projection.
export function remedyHeals(state) {
  const out = [];
  const level = skillLevel(state, "warfare");
  ORDER.eat.forEach((w) => {
    const items = state[w].items;
    Object.keys(items).forEach((k) => {
      const d = itemDef(k);
      if (remedyTooWeak(k, level)) return;
      if (d && d.heal) for (let i = 0; i < Math.min(items[k], 400); i++) out.push(d.heal);
    });
  });
  return out.sort((a, b) => b - a).slice(0, 400);
}

const LOOT_LOST_QUIET_MS = 10 * 60 * 1000;

/* Loot goes into the pack: Belongings first, whatever is stacked elsewhere, so
   a run's takings sit together and the walk home can move them in one go. Then
   the Vault, then the Stockpile. When nothing fits, the camp log hears about it
   at most once every ten minutes. */
export function stashLoot(state, key, qty, env, at) {
  const res = transact(state, (tx) => tx.stash(key, qty, ORDER.loot, { grow: false }));
  if (res.ok) return res.value;
  if (state.lootLostAt == null || at - state.lootLostAt > LOOT_LOST_QUIET_MS) {
    state.lootLostAt = at;
    emit(state, env, "loot:lost", { key, at });
  }
  return null;
}

/* One kill's spoils, into a save: the kill counted, a bounty's tally, what it drops, the
   Fragment an Elite carries on ground that holds the Veil, and a companion's nose. A lone
   hunt's kill and a party's share settled on the server both pay through here, so a kill
   is worth the same however it was made. Returns how many things it left in the save. */
export function creditKill(state, mob, elite, zoneId, env, at) {
  const kKey = `k:${mob.tier}`;
  const mKey = `m:${mob.id}`;
  const kN = state.rolls[kKey] || 0;
  let n = 0;
  state.stats.kills++;
  bountyProgress(state, "slay", mob, env, at);
  n += dropLoot(state, mob, elite, kN, env, at);
  // The Inner and the Core are the only ground whose Elites carry the Veil.
  const zone = getZone(zoneId);
  if (elite && zone && zone.fragments && stashLoot(state, fragmentOfTier(mob.tier), GameData.ELITE.fragments, env, at)) n += GameData.ELITE.fragments;
  companionFinds(state, "warfare", kKey, kN, env, at);
  state.rolls[mKey] = (state.rolls[mKey] || 0) + 1;
  state.rolls[kKey] = kN + 1;
  return n;
}

/* What a Sovereign leaves, over and above the kill. No gear: the bench makes what you
   own, the hunt only makes it better. Its Essence comes whole, where twenty Elite
   Fragments would have had to be merged for the same thing. Alone or in a party, the
   same: returns the Essence's key when there was room for it, else null. */
export function creditSovereign(state, mob, fightMs, env, at) {
  const sKey = `s:${mob.tier}`;
  const sN = state.rolls[sKey] || 0;
  state.stats.bosses = (state.stats.bosses || 0) + 1;
  const key = essenceOfTier(mob.tier);
  const kept = stashLoot(state, key, GameData.SOVEREIGN.essence, env, at);
  state.rolls[sKey] = sN + 1;
  emit(state, env, "hunt:felled", { monsterId: mob.id, key: kept ? key : null, fightMs: Math.round(fightMs || 0), at });
  return kept ? key : null;
}

// kN is this kill's index on the k:<tier> counter. Returns how many things it left in the save.
export function dropLoot(state, mob, elite, kN, env, at) {
  const seed = state.rng.seed;
  const bonus = 1 + companionBonus(state, "drops");
  const qtyMult = elite ? GameData.ELITE.drops : 1;
  const mKey = `m:${mob.id}`;
  const mN = state.rolls[mKey] || 0;
  const c = state.tasks.combat;
  let left = 0;
  // What this hunt has turned up, for the little stack the arena shows.
  const tally = (key, n) => {
    left += n;
    if (c && c.drops) c.drops[key] = (c.drops[key] || 0) + n;
  };
  mob.drops.forEach(([k, qty, chance], j) => {
    if (!(roll(seed, mKey, mN, SALT.drop + j) < chance * bonus)) return;
    // "@reagent": whichever of the five this one was carrying, on the same stream.
    const key = k === "@reagent"
      ? GameData.REAGENTS[Math.floor(roll(seed, mKey, mN, SALT.drop + 50 + j) * GameData.REAGENTS.length)].id
      : k;
    const n = qty * qtyMult;
    if (stashLoot(state, key, n, env, at)) tally(key, n);
  });

  /* Companions with a nose for it turn something up now and then. It is a Veil
     Fragment, not a piece of gear: the hunt pays in reagents, gold and the Veil,
     and the bench is the only place armour and weapons come from. */
  const rare = companionBonus(state, "rare");
  const kKey = `k:${mob.tier}`;
  if (rare && roll(seed, kKey, kN, SALT.rare) < rare) {
    const key = fragmentOfTier(mob.tier);
    if (stashLoot(state, key, 1, env, at)) {
      tally(key, 1);
      emit(state, env, "loot:found", { key, at });
    }
  }
  return left;
}
