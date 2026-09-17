/* ============================================================
   Respite · combat.js · The Battlefield
   ------------------------------------------------------------
   The hunt: zones and Threat, and the encounter engine. The engine
   is event-driven. Every combatant keeps its own swing timer and
   time jumps from one event to the next, so an open tab, a sleeping
   phone and twelve hours away all play out the same fight. The same
   engine runs projections for the zone popup without a save.

   Flow inside a fight (timers, foes, crits, gold per kill, which
   armour piece wears) draws from the save's one hunt stream,
   state.rng.hunt, in v4's order. It runs on from hunt to hunt,
   through pulling back and falling, so no command can deal a fresh
   one. What a kill leaves (drops, finds, Sovereign pieces) rolls on
   the kill counters, so it can't be fished for.
   ============================================================ */

import { CONFIG } from "./config.js";
import {
  GameData, getMonster, getZone, foeOf, sovereignOf, regionOfTier,
} from "./registry.js";
import { itemDef, makeKey, fineRarityFromRoll, prefixFromRoll, validKey } from "./items.js";
import { ORDER, transact } from "./storage.js";
import { statsOf, maxHp, mitigation, recovering } from "./stats.js";
import { xpMult, partyMult, addXp } from "./progression.js";
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

// Stochastic rounding: 2.3 lands as 3 three times in ten, as 2 otherwise.
function landed(x, rng) {
  const f = Math.floor(x);
  return f + (rng() < x - f ? 1 : 0);
}

/* ================= 1. ZONES, THREAT & FOES ================= */

export const threatKey = (tier, zone) => `${tier}:${zone}`;

export function threatIn(state, tier, zone) {
  const key = threatKey(tier, zone);
  return (state.threat && Object.hasOwn(state.threat, key) && state.threat[key]) || 0;
}

function setThreat(state, tier, zone, n) {
  state.threat[threatKey(tier, zone)] = clamp(Math.round(n), 0, H.threatCap);
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

function rollFoe(tier, zone, rng) {
  const arch = pickWeighted(GameData.ARCHETYPE_ORDER.map((a) => [a, zone.mix[a]]), rng);
  return { mob: foeOf(tier, arch), elite: rng() < zone.elite };
}

// A foe's numbers with the Elite modifier folded in.
export function foeNumbers(mob, elite) {
  const e = elite ? GameData.ELITE : null;
  return {
    hp: Math.round(mob.hp * (e ? e.hp : 1)),
    attack: mob.attack * (e ? e.attack : 1),
    xp: mob.xp * (e ? e.xp : 1),
    threat: mob.threat + (e ? e.threat : 0),
    gold: mob.gold.map((g) => Math.round(g * (e ? e.gold : 1))),
    dropQty: e ? GameData.ELITE.drops : 1,
  };
}

// "The Ash Stalker", "The Ashen Warden", "What Feeds The Roots".
export const foeTitle = (mob) => (/^(The|What) /.test(mob.name) ? mob.name : `The ${mob.name}`);

// Gear of a tier, in registry order: where rare finds and Sovereign pieces come from.
const GEAR_BY_TIER = new Map();
function gearOfTier(tier) {
  let list = GEAR_BY_TIER.get(tier);
  if (!list) {
    list = Object.values(GameData.GEAR).filter((g) => g.tier === tier);
    GEAR_BY_TIER.set(tier, list);
  }
  return list;
}

/* ================= 2. TAKING UP THE HUNT ================= */
/* A hunt runs `limit` kills, or with no limit (null) until you pull back,
   fall, or twelve hours pass. Coming back alive, the camp keeps a note
   (state.player.camp): when, with what health, and when the walk you broke
   off would have ended. Setting out again, health is what you came back
   with plus what rest restores (all of it in CONFIG.hunt.recoveryMs), and
   the rest of that walk still has to be walked. After a fall there is no
   note: you set out whole, the recovery having been the cost. Moving ground
   mid-hunt keeps your health and the walk or window left. */

// A hunt with no save behind it: projections play these.
function blankHunt(tier, zone, limit) {
  return {
    tier, zone, limit: limit == null ? null : limit,
    done: 0, elapsed: 0, startedAt: 0,
    phase: "search",          // search | fight | hide
    wait: H.searchMinMs,      // ms left of the walk, or of hiding
    kind: "normal",           // normal | sovereign
    clock: 0, reinforceAt: 0, enrageAt: 0, enrage: 0,
    foes: [], uid: 1,
    swing: 0, volley: 0, veil: 0, streak: 0,
    peak: false, sovereignNext: false, encounters: 0,
    xp: 0, marks: [[0, 0]], nextMark: H.xpMarkMs, xpRate: null,
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
  const rested = (most * Math.max(0, at - note.since)) / H.recoveryMs;
  return { hp: Math.min(most, note.hp + rested), maxHp: most, walkMs: Math.max(H.searchMinMs, note.walkUntil - at) };
}

export function startHunt(state, { tier, zone, limit } = {}, env) {
  const region = Number.isInteger(tier) ? regionOfTier(tier) : null;
  if (!region || !state.travel.unlocked.includes(region.id)) return refuse("That ground isn't open.");
  if (typeof zone !== "string" || !GameData.ZONES.some((z) => z.id === zone)) return refuse("No such zone.");
  if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)) {
    return refuse("A hunt is 1 to 100,000 kills, or no limit.");
  }
  if (recovering(state)) return refuse("You're still recovering.");

  const c = state.tasks.combat;
  if (c && c.tier === tier && c.zone === zone) {
    // Already out on this ground: the fight carries on, the count starts again.
    c.limit = limit == null ? null : limit;
    c.done = 0;
    c.elapsed = 0;
    c.nextMark = H.xpMarkMs;
    c.marks = [[0, 0]];
    c.xp = 0;
    c.xpRate = null;
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
  state.player.camp = campNote(state, c, state.clock);
  state.tasks.combat = null;
  return { ok: true };
}

export function setHide(state, { on } = {}, env) {
  if (typeof on !== "boolean") return refuse("Hiding is on or off.");
  state.settings.hideSovereign = on;
  emit(state, env, "settings:hide", { on });
  return { ok: true };
}

// The live hunt at a glance, for the topbar, the arena and the Character page.
export function combatPlan(state) {
  const c = state.tasks.combat;
  if (!c) return null;
  const zone = getZone(c.zone);
  const target = c.phase === "fight" ? c.foes[0] || null : null;
  let pct = 0;
  if (target) pct = clamp((target.hp / target.max) * 100, 0, 100);
  return {
    c, zone, region: regionOfTier(c.tier), phase: c.phase, kind: c.kind,
    target, mob: target ? getMonster(target.id) : null, pct,
    done: c.done, limit: c.limit, xpRate: c.xpRate, threat: threatIn(state, c.tier, c.zone),
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
     hide     whether to go to ground when Threat peaks
   and hooks for everything with a consequence: fx, threat, setThreat,
   remedy, gainXp, gainGold, killed, sovereignDown, died, ended, met, hid,
   passed, retreated. Section 4 wires them to a save; section 5 to a tally. */

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
  t = Math.min(t, c.swing, c.kind === "normal" ? c.reinforceAt - c.clock : c.enrageAt - c.clock);
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
    if (c.elapsed >= c.nextMark - EPS) { markXp(c); continue; }
    if (c.elapsed >= IDLE_CAP - EPS) { endHunt(ctx, "cap"); return; }

    if (c.phase !== "fight") {
      if (c.wait > EPS) return;
      if (c.phase === "hide") leaveHiding(ctx);
      else beginEncounter(ctx);
      continue;
    }

    if (!c.foes.length) { endEncounter(ctx); continue; }
    if (c.kind === "normal" && c.clock >= c.reinforceAt - EPS) { reinforce(ctx); continue; }
    if (c.kind === "sovereign" && c.clock >= c.enrageAt - EPS) { enrageStep(ctx); continue; }
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
  if (c.kind === "normal" && c.clock >= c.reinforceAt - EPS) return true;
  if (c.kind === "sovereign" && c.clock >= c.enrageAt - EPS) return true;
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

// XP/hr: every five minutes, what the last hour (or the hunt so far) earned.
function markXp(c) {
  c.marks.push([c.nextMark, c.xp]);
  while (c.marks.length > (60 * 60 * 1000) / H.xpMarkMs + 1) c.marks.shift();
  const [t0, x0] = c.marks[0];
  c.xpRate = ((c.xp - x0) * 3600000) / Math.max(1, c.nextMark - t0);
  c.nextMark += H.xpMarkMs;
}

function addFoe(ctx, mob, elite, ambush) {
  const c = ctx.c;
  const n = foeNumbers(mob, elite);
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

  // Ticked Hide after the Sovereign was already on its way: still go to ground.
  if (c.sovereignNext && ctx.hide) {
    c.sovereignNext = false;
    goToGround(ctx);
    return;
  }

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
    c.enrage = 0;
    c.enrageAt = GameData.SOVEREIGN.enrageMs;
    const sov = sovereignOf(c.tier);
    addFoe(ctx, sov, false, false);
    for (let i = 0; i < zone.escorts; i++) addFoe(ctx, rollFoe(c.tier, zone, ctx.rng).mob, true, false);
    ctx.met(sov);
    return;
  }

  c.kind = "normal";
  c.reinforceAt = zone.windowMs;
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

function reinforce(ctx) {
  const c = ctx.c;
  const zone = getZone(c.zone);
  c.reinforceAt += zone.windowMs;
  if (c.foes.length >= H.maxFoes) return;
  const r = rollFoe(c.tier, zone, ctx.rng);
  addFoe(ctx, r.mob, r.elite, true);
}

function enrageStep(ctx) {
  const c = ctx.c;
  c.enrage++;
  c.enrageAt += GameData.SOVEREIGN.enrageMs;
  const sov = c.foes.find((f) => getMonster(f.id).archetype === "sovereign");
  if (sov) ctx.fx(sov.uid, "enrage", 0);
}

// One blow from you: Attack, crit, and the foe's Defence after penetration.
function playerBlow(s, mob, tier, mult, crit, pen, rng) {
  const raw = s.attack * mult * (crit ? s.critDmg : 1);
  const mit = mitigation(mob.defence * (1 - Math.min(0.9, pen)), tier);
  return Math.max(1, landed(raw * (1 - mit), rng));
}

// You always strike the first foe still standing.
function playerSwing(ctx) {
  const c = ctx.c;
  const s = ctx.s;
  const rng = ctx.rng;
  const T = GameData.TECHNIQUE;
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

  let dmg = playerBlow(s, mob, c.tier, mult, crit, pen, rng);
  // Echoing relics sometimes land a second blow.
  if (s.echoing && !technique && rng() < 0.12) dmg += playerBlow(s, mob, c.tier, 1, rng() < s.crit, pen, rng);
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
  ctx.fx(target.uid, technique ? kind : crit ? "crit" : "hit", dmg);

  // A Mage's empowered casts wash over everything else in the fight too.
  const splash = (kind === "volley" || kind === "empowered") ? c.foes.filter((f) => f !== target) : [];
  splash.forEach((f) => {
    const hit = playerBlow(s, getMonster(f.id), c.tier, mult * T.splash, false, pen, rng);
    f.hp -= hit;
    ctx.fx(f.uid, kind, hit);
  });

  if (target.hp <= 0) killFoe(ctx, target);
  splash.forEach((f) => { if (f.hp <= 0) killFoe(ctx, f); });
}

function foeSwing(ctx, f) {
  const c = ctx.c;
  const s = ctx.s;
  const p = ctx.p;
  const mob = getMonster(f.id);
  f.timer += mob.speed;

  let raw = foeNumbers(mob, f.elite).attack * (f.ambush ? H.foeAmbush : 1);
  if (mob.archetype === "sovereign") raw *= 1 + c.enrage * GameData.SOVEREIGN.enrage;
  raw *= 1 - mitigation(s.defence, c.tier);
  if (s.resilient && p.hp < s.maxHp * 0.35) raw *= 0.8;
  let blunted = false;
  if (s.stalwart && ctx.rng() < 0.1) {
    raw *= 0.5;
    blunted = true;
  }

  const ambush = f.ambush;
  f.ambush = false;
  const dmg = landed(raw, ctx.rng);
  p.hp -= dmg;
  ctx.fx("you", dmg <= 0 ? "glance" : ambush ? "ambushed" : blunted ? "block" : "hurt", dmg);

  // A Warrior's Veil answers every blow aimed at it.
  if (s.klass === "warrior") c.veil = Math.min(H.veilMax, c.veil + Math.round(s.veilGain / 2));
  if (dmg > 0) {
    c.streak = 0;
    if (s.thorned) {
      const thorns = Math.max(1, Math.round(dmg * 0.15));
      f.hp -= thorns;
      ctx.fx(f.uid, "thorns", thorns);
    }
  }

  if (p.hp > 0 && p.hp <= s.maxHp * H.remedyAt) takeRemedy(ctx);
  if (p.hp <= 0) {
    die(ctx, mob);
    return;
  }
  // Thorns can finish the foe on the blow that would have sent you running: the kill counts first.
  if (f.hp <= 0) killFoe(ctx, f);
  if (!ctx.over && c.phase === "fight" && c.kind === "sovereign" && p.hp <= s.maxHp * H.retreatAt) retreat(ctx);
}

function bleedTick(ctx, f) {
  f.hp -= f.bleed;
  ctx.fx(f.uid, "bleed", f.bleed);
  f.bleed = Math.max(0, f.bleed - 1);
  f.bleedTimer = 1000;
  if (f.hp <= 0) killFoe(ctx, f);
}

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
  const zone = getZone(c.zone);
  const n = foeNumbers(mob, f.elite);
  c.done++;
  ctx.fx(f.uid, "kill", 0);
  ctx.gainXp(n.xp * zone.xp);
  ctx.gainGold(n.gold[0] + Math.floor(ctx.rng() * (n.gold[1] - n.gold[0] + 1)));
  ctx.killed(mob, f.elite);

  if (mob.archetype === "sovereign") {
    ctx.sovereignDown(mob);
  } else if (c.kind === "normal") {
    const before = ctx.threat();
    const after = Math.min(H.threatCap, before + Math.round(n.threat * zone.threat));
    if (after !== before) ctx.setThreat(after);
    if (after >= H.threatCap) c.peak = true;
  }

  if (c.limit != null && c.done >= c.limit) {
    endHunt(ctx, "limit");
    return;
  }
  if (!c.foes.length) endEncounter(ctx);
}

/* An encounter is over. Cleared inside the window, the rest of the window is
   the walk to the next one. A Threat peak is settled here, between fights. */
function endEncounter(ctx) {
  const c = ctx.c;
  const zone = getZone(c.zone);
  const took = c.clock;
  const wasSovereign = c.kind === "sovereign";

  c.phase = "search";
  c.kind = "normal";
  c.foes = [];
  c.volley = 0;
  c.enrage = 0;

  if (wasSovereign) {
    ctx.setThreat(0);
    c.peak = false;
    c.wait = H.searchMinMs;
    return;
  }

  if (c.peak) {
    c.peak = false;
    if (ctx.hide) {
      goToGround(ctx);
      return;
    }
    if (ctx.rng() < zone.engage) {
      c.sovereignNext = true;
      c.wait = H.searchMinMs;
      return;
    }
    ctx.setThreat(0);
    ctx.passed();
  }

  c.wait = Math.max(H.searchMinMs, zone.windowMs - took);
}

function goToGround(ctx) {
  const c = ctx.c;
  ctx.setThreat(0);
  c.phase = "hide";
  c.wait = H.hideMs;
  ctx.hid();
}

function leaveHiding(ctx) {
  ctx.c.phase = "search";
  ctx.c.wait = H.searchMinMs;
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

function die(ctx, mob) {
  // A Sovereign that has put you down is done with this ground for now.
  if (ctx.c.kind === "sovereign") ctx.setThreat(0);
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
    hide: !!(state.settings && state.settings.hideSovereign),
    fx: (who, kind, amount) => {
      if (env && env.fx) say("hunt:fx", { who, kind, amount: amount || 0 });
    },
    met: (sov) => say("hunt:sovereign", { monsterId: sov.id }),
    hid: () => say("hunt:hide", { tier: c.tier, zone: c.zone }),
    passed: () => say("hunt:passed", { tier: c.tier, zone: c.zone }),
    retreated: (sov, fightMs) => say("hunt:retreat", { monsterId: sov ? sov.id : null, fightMs: Math.round(fightMs) }),
    threat: () => threatIn(state, c.tier, c.zone),
    setThreat: (n) => setThreat(state, c.tier, c.zone, n),
    remedy: () => {
      const spot = remedySpot(state);
      if (!spot) return 0;
      transact(state, (tx) => tx.remove(spot.pool, spot.key, 1));
      return spot.heal;
    },
    gainXp: (amount) => {
      const at = nowAt();
      const gain = amount * xpMult(state, "warfare", at) * partyMult(env, c.tier, c.zone, at);
      c.xp += gain;
      if (addXp(state, "warfare", gain, env, at)) refresh();
    },
    gainGold: (n) => {
      if (n > 0) transact(state, (tx) => tx.gold(Math.round(n * (1 + companionBonus(state, "gold"))), true));
    },
    killed: (mob, elite) => {
      const at = nowAt();
      const kKey = `k:${mob.tier}`;
      const mKey = `m:${mob.id}`;
      const kN = state.rolls[kKey] || 0;
      state.stats.kills++;
      bountyProgress(state, "slay", mob, env, at);
      dropLoot(state, mob, elite, kN, env, at);
      companionFinds(state, "warfare", kKey, kN, env, at);
      if (applyWear(state, ctx.rng, env, at)) refresh();
      state.rolls[mKey] = (state.rolls[mKey] || 0) + 1;
      state.rolls[kKey] = kN + 1;
    },
    sovereignDown: (mob) => {
      const at = nowAt();
      const sKey = `s:${mob.tier}`;
      const sN = state.rolls[sKey] || 0;
      state.stats.bosses = (state.stats.bosses || 0) + 1;
      state.stats.epics++;
      const pool = gearOfTier(mob.tier);
      const base = pool[Math.floor(roll(seed, sKey, sN, SALT.sovereignPick) * pool.length)].id;
      const key = makeKey(base, "epic", `s${mob.tier}.${sN}`, null);
      const kept = stashLoot(state, key, 1, env, at);
      state.rolls[sKey] = sN + 1;
      emit(state, env, "hunt:felled", { monsterId: mob.id, key: kept ? key : null, fightMs: Math.round(c.clock), at });
    },
    died: (mob) => {
      const at = nowAt();
      const took = c.elapsed;
      state.tasks.combat = null;
      state.player.camp = null;
      state.stats.deaths++;
      state.player.hp = maxHp(state);
      state.player.recoveryLeft = H.recoveryMs;
      GameData.EQUIP_SLOTS.forEach((slot) => {
        const key = state.equipment[slot];
        const d = key ? itemDef(key) : null;
        if (d && d.maxDur) damageItem(state, key, H.deathWear, env, at);
      });
      ctx.fx("you", "fall", 0);
      emit(state, env, "hunt:death", { monsterId: mob.id, elapsedMs: Math.round(took), at });
    },
    ended: (reason) => {
      state.player.camp = campNote(state, c, nowAt());
      state.tasks.combat = null;
      say("hunt:ended", { reason, kills: c.done, elapsedMs: Math.round(c.elapsed) });
    },
  };
  return ctx;
}

/* ================= 5. PROJECTIONS ================= */
/* Plays a hunt forward on a scratch copy: how fast it kills, what it earns
   and how long you last. Seeded, so the same question gets the same answer. */

// opts: { stats (required), hp, threat, hide, remedies: [heal, ...], xpMult, horizonMs, seed, chunkMs }
export function projectOnce(tier, zoneId, opts) {
  const o = opts || {};
  if (!o.stats) throw new TypeError("projectOnce needs opts.stats.");
  const s = o.stats;
  const horizon = Math.min(IDLE_CAP, o.horizonMs || IDLE_CAP);
  const c = blankHunt(tier, zoneId, null);
  const heals = (o.remedies || []).slice();
  let threat = o.threat || 0;
  const t = { kills: 0, xp: 0, gold: 0, remedies: 0, sovereigns: 0, met: 0, retreats: 0, hides: 0, died: false, ms: 0, killer: null };

  const ctx = {
    c, s, p: { hp: o.hp == null ? s.maxHp : o.hp }, rng: seededRng(o.seed || 1), over: false, hide: !!o.hide,
    fx: () => {},
    met: () => { t.met++; },
    hid: () => { t.hides++; },
    passed: () => {},
    retreated: () => { t.retreats++; },
    threat: () => threat,
    setThreat: (n) => { threat = n; },
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
  const sum = { runs, kills: 0, xp: 0, gold: 0, ms: 0, deaths: 0, deathMs: 0, remedies: 0, sovereigns: 0, met: 0, retreats: 0, hides: 0, killers: {} };
  results.forEach((t) => {
    sum.kills += t.kills;
    sum.xp += t.xp;
    sum.gold += t.gold;
    sum.ms += t.ms;
    sum.remedies += t.remedies;
    sum.sovereigns += t.sovereigns;
    sum.hides += t.hides;
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
    stats: statsOf(state), remedies: remedyHeals(state), hide: !!state.settings.hideSovereign,
    threat: threatIn(state, tier, zone), xpMult: xpMult(state, "warfare", state.clock), runs: 3, horizonMs: IDLE_CAP,
  };
}

export function oddsSignature(opts, tier, zone) {
  return [tier, zone, JSON.stringify(opts.stats), opts.remedies.length, opts.remedies[0] || 0,
    opts.hide, Math.floor(opts.threat / 25), opts.xpMult.toFixed(2)].join("|");
}

/* ================= 6. REMEDIES & LOOT ================= */

// The best remedy held and where it is: best heal first, then Belongings, the Stockpile, the Vault.
function remedySpot(state) {
  let pick = null;
  for (const w of ORDER.eat) {
    for (const k of Object.keys(state[w].items)) {
      const d = itemDef(k);
      if (d && d.heal && d.heal > (pick ? pick.heal : 0)) pick = { key: k, pool: w, heal: d.heal };
    }
  }
  return pick;
}

export function bestRemedy(state) {
  const spot = remedySpot(state);
  return spot ? spot.key : null;
}

// Every remedy you hold, as heal amounts, best first. Capped: enough for any projection.
export function remedyHeals(state) {
  const out = [];
  ORDER.eat.forEach((w) => {
    const items = state[w].items;
    Object.keys(items).forEach((k) => {
      const d = itemDef(k);
      if (d && d.heal) for (let i = 0; i < Math.min(items[k], 400); i++) out.push(d.heal);
    });
  });
  return out.sort((a, b) => b - a).slice(0, 400);
}

const LOOT_LOST_QUIET_MS = 10 * 60 * 1000;

/* Loot goes straight into storage: Belongings, then the Vault, then the
   Stockpile. A stack already held somewhere grows where it is. When nothing
   fits, the camp log hears about it at most once every ten minutes. */
function stashLoot(state, key, qty, env, at) {
  const res = transact(state, (tx) => tx.stash(key, qty, ORDER.loot));
  if (res.ok) return res.value;
  if (state.lootLostAt == null || at - state.lootLostAt > LOOT_LOST_QUIET_MS) {
    state.lootLostAt = at;
    emit(state, env, "loot:lost", { key, at });
  }
  return null;
}

// kN is this kill's index on the k:<tier> counter.
function dropLoot(state, mob, elite, kN, env, at) {
  const seed = state.rng.seed;
  const bonus = 1 + companionBonus(state, "drops");
  const qtyMult = elite ? GameData.ELITE.drops : 1;
  const mKey = `m:${mob.id}`;
  const mN = state.rolls[mKey] || 0;
  mob.drops.forEach(([k, qty, chance], j) => {
    if (roll(seed, mKey, mN, SALT.drop + j) < chance * bonus) stashLoot(state, k, qty * qtyMult, env, at);
  });

  // Companions with a nose for it turn up a finer piece now and then.
  const rare = companionBonus(state, "rare");
  const kKey = `k:${mob.tier}`;
  if (rare && roll(seed, kKey, kN, SALT.rare) < rare) {
    const rarity = fineRarityFromRoll(roll(seed, kKey, kN, SALT.rareRarity));
    const pool = gearOfTier(mob.tier);
    const base = pool[Math.floor(roll(seed, kKey, kN, SALT.rarePick) * pool.length)].id;
    const prefix = rarity === "relic" ? prefixFromRoll(base, roll(seed, kKey, kN, SALT.prefix)) : null;
    const key = makeKey(base, rarity, `f${mob.tier}.${kN}`, prefix);
    if (stashLoot(state, key, 1, env, at)) emit(state, env, "loot:found", { key, at });
  }
}

/* ================= 7. DURABILITY ================= */

export function wearPct(state, key) {
  const d = itemDef(key);
  if (!d || !d.maxDur) return null;
  const worn = Object.hasOwn(state.wear, key) ? state.wear[key] : 0;
  return clamp(Math.round((1 - worn / d.maxDur) * 100), 0, 100);
}

// A kill's wear: the weapon and one armour piece. True when something broke.
export function applyWear(state, rng, env, at) {
  let broke = false;
  const eq = state.equipment;
  const w = eq.weapon;
  const wd = w ? itemDef(w) : null;
  if (wd && wd.maxDur) broke = damageItem(state, w, 1, env, at) || broke;
  const armour = GameData.EQUIP_SLOTS
    .filter((s) => s !== "weapon" && s !== "ring" && s !== "neck")
    .map((s) => eq[s])
    .filter((k) => {
      const d = k ? itemDef(k) : null;
      return !!(d && d.maxDur);
    });
  if (armour.length) broke = damageItem(state, armour[Math.floor(rng() * armour.length)], 1, env, at) || broke;
  return broke;
}

export function damageItem(state, key, amount, env, at) {
  const d = itemDef(key);
  if (!d || !d.maxDur) return false;
  state.wear[key] = (Object.hasOwn(state.wear, key) ? state.wear[key] : 0) + amount;
  if (state.wear[key] < d.maxDur) return false;
  state.equipment[d.slot] = null;
  // The piece is gone, and its wear with it.
  delete state.wear[key];
  emit(state, env, "item:broke", { key, at });
  return true;
}

export function repairCost(state, key) {
  const d = itemDef(key);
  const dmg = d && Object.hasOwn(state.wear, key) ? state.wear[key] : 0;
  if (!d || !d.maxDur || dmg <= 0) return null;
  return { mat: d.repairMat, qty: Math.max(1, Math.ceil(dmg / 80)) };
}

export function repair(state, { key } = {}, env) {
  if (!validKey(key)) return refuse("No such item.");
  const cost = repairCost(state, key);
  if (!cost) return refuse("Nothing to repair.");
  const res = transact(state, (tx) => {
    tx.spend(cost.mat, cost.qty, ORDER.spend);
    tx.del(state.wear, key);
  });
  if (!res.ok) return refuse(`Need ${fmt(cost.qty)} ${itemDef(cost.mat).name}.`);
  emit(state, env, "item:repaired", { key });
  return { ok: true };
}
