/* ============================================================
   Respite · partyHunt.js · The Warband
   ------------------------------------------------------------
   One encounter, several hunters, one roster of foes. This is the
   shared fight: everyone swings at the same things, and what a kill
   pays is split by who actually hurt it.

   WHY THIS IS NOT combat.js WITH A LOOP
   A solo hunt is a pure function of one save's bytes and one save's
   clock, replayed by that save's owner and by the server. Two
   members of a party are at different clocks, hold unsynchronisable
   dice, and cannot see each other's stats, so they cannot each
   replay the same fight and agree. So a party encounter is not
   replayed by anybody's save: it is a thing of its own, with its own
   clock and its own dice, owned and ticked by the server, and each
   hunter's save is paid out of it afterwards.

   THE RULES THAT FALL OUT OF THAT
   - The client never predicts a party fight. It renders what the
     server reports. A wrong guess is therefore impossible rather
     than merely unlikely, and no member's damage ever arrives as a
     command argument, which is the line between a correction and a
     corruption.
   - The encounter carries `seed`, so the server can replay it from
     any point and get the same fight.
   - Nothing here writes a save. `stepEncounter` moves the encounter
     and fills each hunter's `owed`; settling that into a save is
     the caller's job, and happens on that member's own next request,
     the way mail already does.

   FAIRNESS
   Solo, at most CONFIG.hunt.maxFoes are on you at once. A party of
   four sharing three foes would be four times as safe, so the roster
   scales with the party and each foe holds one target, handed to
   whoever has fewest on them. Per hunter the pressure lands about
   where it does alone, which is what was asked for: the bonus for
   partying is the 5% and the company, not an easier fight.

   WHAT A KILL PAYS
   Every blow is recorded against the foe that took it, so a kill
   splits its XP and gold by share of the damage that killed it.
   Drops cannot be halved, so they go to whoever hurt it most, ties
   to the killing blow.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData, getMonster, getZone, sovereignOf } from "./registry.js";
import {
  EPS, foeNumbers, landed, playerBlow, pickWeighted, rollFoe,
} from "./combat.js";
import { combatStats, mitigation } from "./stats.js";
import { makeRng } from "./rng.js";
import { clamp } from "./format.js";

const H = CONFIG.hunt;

/* An encounter runs at most this long before the server gives up on it and
   settles what it has. A fight nobody can win would otherwise sit in the table
   for ever, ticking on every cron pass. */
export const ENCOUNTER_CAP_MS = 60 * 60 * 1000;

/* ================= 1. BUILDING ONE ================= */

/* A hunter as the encounter sees them: a snapshot, not a live save. `stats` is
   combatStats() for their loadout at the moment they joined, `heals` the remedy
   strengths they packed, strongest first. Nothing here is read back into a save;
   `owed` is what settling pays out. */
export function makeHunter(userId, stats, { hp = null, heals = [] } = {}) {
  return {
    userId: String(userId),
    stats,
    hp: hp == null ? stats.maxHp : clamp(hp, 0, stats.maxHp),
    // The remedies they packed, strongest first. Drunk out of here, taken off the save at settling.
    heals: Array.isArray(heals) ? heals.slice() : [],
    swing: 0, veil: 0, volley: 0, streak: 0,
    down: false,
    dmg: 0,
    owed: { xp: 0, gold: 0, kills: 0, threat: 0, drops: [], died: null, remedies: 0 },
  };
}

/* A fresh encounter on a ground. `seed` is the server's, so the fight is the
   same one however often it is replayed. `kind` is "normal", or "sovereign"
   when a member's region has called its Sovereign down on the party. */
export function newEncounter({ id, partyId, tier, zone, seed, hunters, kind = "normal" }) {
  const e = {
    id, partyId, tier, zone, seed: seed >>> 0,
    /* Where the stream stands, not just where it started. It is stored with the
       encounter, so stepping it 1s then 1s is the same fight as stepping it 2s,
       and a server that reloads the row picks the dice up mid-roll rather than
       starting them again. Slice independence is a tested promise of this engine
       and a fresh stream every tick would quietly break it. */
    dice: (seed >>> 0) + 1,
    kind: kind === "sovereign" ? "sovereign" : "normal",
    clock: 0, over: null,
    foes: [], uid: 1,
    reinforceAt: 0, enrageAt: 0, enrage: 0,
    hunters: hunters.slice(),
  };
  const rng = diceAt(e);
  const z = getZone(zone);
  e.reinforceAt = z.windowMs;
  if (e.kind === "sovereign") {
    e.enrageAt = GameData.SOVEREIGN.enrageMs;
    spawn(e, rng, sovereignOf(tier), false);
    // Its guard scales with the warband, as the roster does.
    for (let i = 0; i < z.escorts * standing(e).length; i++) spawn(e, rng, rollFoe(tier, z, rng).mob, true);
  } else {
    // Solo draws zone.sizes; a warband draws that many each, so the pressure per hunter holds.
    const each = pickWeighted(z.sizes, rng);
    const want = Math.min(maxFoes(e), each * standing(e).length);
    for (let i = 0; i < want; i++) {
      const r = rollFoe(tier, z, rng);
      spawn(e, rng, r.mob, r.elite);
    }
  }
  // A hunter opens the way they would alone: a Rogue and a Mage walk in ready.
  e.hunters.forEach((u) => {
    u.swing = 250 + rng() * 400;
    if (u.stats.klass === "rogue") u.veil = H.veilMax;
    if (u.stats.klass === "mage") {
      u.veil = H.veilMax;
      u.volley = GameData.TECHNIQUE.volley.casts;
    }
  });
  retarget(e, rng);
  return e;
}

// The encounter's own stream, picked up wherever it was left. See `dice` above.
function diceAt(e) {
  return makeRng(e, "dice");
}

export const standing = (e) => e.hunters.filter((u) => !u.down);

// Three foes a hunter, as a lone hunter faces, and never more than the party could hold.
const maxFoes = (e) => H.maxFoes * Math.max(1, standing(e).length);

function spawn(e, rng, mob, elite, ambush = false) {
  const z = getZone(e.zone);
  const power = z.power || 1;
  const n = foeNumbers(mob, elite, power);
  const f = {
    uid: e.uid++, id: mob.id, elite: !!elite, power, hp: n.hp, max: n.hp, ambush: !!ambush,
    timer: ambush ? 300 + rng() * 400 : mob.speed * (0.45 + rng() * 0.35),
    bleed: 0, bleedTimer: 0,
    target: null,
    // Who has hurt it, and by how much: the split a kill pays out by.
    by: {},
  };
  e.foes.push(f);
  return f;
}

/* Hands every untargeted foe to whoever has fewest on them, ties broken by the
   encounter's dice so it is not always the first in the list. Called on a spawn,
   and again whenever a hunter goes down. */
function retarget(e, rng) {
  const up = standing(e);
  if (!up.length) return;
  const load = new Map(up.map((u) => [u.userId, 0]));
  e.foes.forEach((f) => {
    if (f.target && load.has(f.target)) load.set(f.target, load.get(f.target) + 1);
    else f.target = null;
  });
  e.foes.forEach((f) => {
    if (f.target) return;
    let least = Infinity;
    let pick = [];
    for (const u of up) {
      const n = load.get(u.userId);
      if (n < least) {
        least = n;
        pick = [u];
      } else if (n === least) pick.push(u);
    }
    const u = pick[Math.floor(rng() * pick.length) % pick.length];
    f.target = u.userId;
    load.set(u.userId, least + 1);
  });
}

const hunterOf = (e, userId) => e.hunters.find((u) => u.userId === userId) || null;

/* ================= 2. THE LOOP ================= */

/* Moves the encounter forward dt milliseconds. `hooks.fx(who, kind, amount)` is
   optional and only for a watcher; nothing in here depends on it. Returns the
   milliseconds actually played, which is less than dt once the fight is over. */
export function stepEncounter(e, dt, hooks = {}) {
  const rng = diceAt(e);
  const fx = typeof hooks.fx === "function" ? hooks.fx : () => {};
  const ctx = { e, rng, fx };
  let left = dt;
  let played = 0;
  const guardMax = 200000 + Math.ceil(dt);
  let guard = 0;
  while (!e.over && guard++ < guardMax) {
    fireDue(ctx);
    if (e.over || left <= EPS) break;
    const step = Math.min(left, Math.max(EPS, untilNext(e)));
    move(e, step);
    left -= step;
    played += step;
  }
  return played;
}

// Time until the next thing happens anywhere in the fight.
function untilNext(e) {
  let t = ENCOUNTER_CAP_MS - e.clock;
  t = Math.min(t, e.kind === "normal" ? e.reinforceAt - e.clock : e.enrageAt - e.clock);
  standing(e).forEach((u) => { t = Math.min(t, u.swing); });
  e.foes.forEach((f) => {
    t = Math.min(t, f.timer);
    if (f.bleed > 0) t = Math.min(t, f.bleedTimer);
  });
  return t;
}

function move(e, ms) {
  e.clock += ms;
  standing(e).forEach((u) => {
    u.swing -= ms;
    if (u.stats.absorb && u.volley <= 0) u.veil = Math.min(H.veilMax, u.veil + (u.stats.absorb * ms) / 1000);
  });
  e.foes.forEach((f) => {
    f.timer -= ms;
    if (f.bleed > 0) f.bleedTimer -= ms;
  });
}

/* Everything due now, one at a time, in a fixed order. The order matters for
   replay: a different order is a different fight. */
function fireDue(ctx) {
  const e = ctx.e;
  for (let guard = 0; guard < 2000 && !e.over; guard++) {
    if (e.clock >= ENCOUNTER_CAP_MS - EPS) { e.over = "cap"; return; }
    if (!standing(e).length) { e.over = "wiped"; return; }
    if (!e.foes.length) { e.over = "cleared"; return; }

    if (e.kind === "normal" && e.clock >= e.reinforceAt - EPS) { reinforce(ctx); continue; }
    if (e.kind === "sovereign" && e.clock >= e.enrageAt - EPS) { enrageStep(ctx); continue; }

    // Hunters in a fixed order, so two servers replaying agree.
    const u = standing(e).find((x) => x.swing <= EPS);
    if (u) { hunterSwing(ctx, u); continue; }

    const f = e.foes.find((x) => x.timer <= EPS);
    if (f) { foeSwing(ctx, f); continue; }

    const b = e.foes.find((x) => x.bleed > 0 && x.bleedTimer <= EPS);
    if (b) { bleedTick(ctx, b); continue; }
    return;
  }
}

/* One reinforcement a hunter each time the window turns, not one between them.
   A lone hunter gets a fresh foe every turn of it; a warband of four sharing
   that one would be taking a quarter of the pressure each, which is exactly the
   free ride the roster scaling exists to avoid. */
function reinforce(ctx) {
  const e = ctx.e;
  const z = getZone(e.zone);
  e.reinforceAt += z.windowMs;
  const want = Math.min(standing(e).length, maxFoes(e) - e.foes.length);
  if (want <= 0) return;
  const joined = [];
  for (let i = 0; i < want; i++) {
    const r = rollFoe(e.tier, z, ctx.rng);
    joined.push(spawn(e, ctx.rng, r.mob, r.elite, true));
  }
  retarget(e, ctx.rng);
  joined.forEach((f) => ctx.fx(f.uid, "join", 0));
}

function enrageStep(ctx) {
  const e = ctx.e;
  e.enrage++;
  e.enrageAt += GameData.SOVEREIGN.enrageMs;
  const sov = e.foes.find((f) => getMonster(f.id).archetype === "sovereign");
  if (sov) ctx.fx(sov.uid, "enrage", 0);
}

/* ================= 3. BLOWS ================= */

// Their own foe first, so a hunter fights what is on them; anything else if it is down.
function pickFoe(e, u) {
  return e.foes.find((f) => f.target === u.userId) || e.foes[0] || null;
}

function hurt(e, u, f, amount) {
  if (!(amount > 0)) return;
  f.hp -= amount;
  f.by[u.userId] = (f.by[u.userId] || 0) + amount;
  u.dmg += amount;
}

function hunterSwing(ctx, u) {
  const e = ctx.e;
  const s = u.stats;
  const rng = ctx.rng;
  const T = GameData.TECHNIQUE;
  const target = pickFoe(e, u);
  if (!target) return;
  const mob = getMonster(target.id);

  let kind = "hit";
  let mult = 1;
  let crit = rng() < s.crit;
  let pen = s.pen;
  let technique = false;

  if (u.volley > 0) {
    kind = "volley";
    mult = T.volley.mult;
    technique = true;
    u.volley--;
    u.veil = u.volley > 0 ? Math.max(0, u.veil - H.veilMax / T.volley.casts) : 0;
  } else if (s.klass && u.veil >= H.veilMax - EPS) {
    technique = true;
    u.veil = 0;
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

  let dmg = playerBlow(s, mob, e.tier, mult, crit, pen, rng);
  if (s.echoing && !technique && rng() < 0.12) dmg += playerBlow(s, mob, e.tier, 1, rng() < s.crit, pen, rng);
  if (s.furious) {
    u.streak++;
    dmg = Math.round(dmg * (1 + Math.min(0.25, u.streak * 0.03)));
  }
  if (s.executioner && target.hp / target.max < 0.3) dmg = Math.round(dmg * 1.3);
  if (s.wounding && rng() < 0.2) {
    if (target.bleed <= 0) target.bleedTimer = 1000;
    target.bleed += Math.max(1, Math.round(dmg * 0.15));
    // Whose bleed it is, so its ticks pay the right hunter.
    target.bleedBy = u.userId;
  }

  if (!technique && s.veilGain) u.veil = Math.min(H.veilMax, u.veil + s.veilGain);
  u.swing = u.volley > 0 ? H.volleyGapMs : s.speed;

  hurt(e, u, target, dmg);
  ctx.fx(target.uid, technique ? kind : crit ? "crit" : "hit", dmg);

  // A Mage's wide casts wash over the rest of the fight, as they do alone.
  const splash = (kind === "volley" || kind === "empowered") ? e.foes.filter((f) => f !== target) : [];
  splash.forEach((f) => {
    const hit = playerBlow(s, getMonster(f.id), e.tier, mult * T.splash, false, pen, rng);
    hurt(e, u, f, hit);
    ctx.fx(f.uid, kind, hit);
  });

  if (target.hp <= 0) killFoe(ctx, target);
  splash.forEach((f) => { if (f.hp <= 0) killFoe(ctx, f); });
}

function foeSwing(ctx, f) {
  const e = ctx.e;
  const mob = getMonster(f.id);
  f.timer += mob.speed;

  let u = hunterOf(e, f.target);
  if (!u || u.down) {
    retarget(e, ctx.rng);
    u = hunterOf(e, f.target);
  }
  if (!u || u.down) return;
  const s = u.stats;

  let raw = foeNumbers(mob, f.elite, f.power).attack * (f.ambush ? H.foeAmbush : 1);
  if (mob.archetype === "sovereign") raw *= 1 + e.enrage * GameData.SOVEREIGN.enrage;
  raw *= 1 - mitigation(s.defence, e.tier);
  if (s.resilient && u.hp < s.maxHp * 0.35) raw *= 0.8;
  let blunted = false;
  if (s.stalwart && ctx.rng() < 0.1) {
    raw *= 0.5;
    blunted = true;
  }

  const ambush = f.ambush;
  f.ambush = false;
  const dmg = landed(raw, ctx.rng);
  u.hp -= dmg;
  ctx.fx(u.userId, dmg <= 0 ? "glance" : ambush ? "ambushed" : blunted ? "block" : "hurt", dmg);

  if (s.klass === "warrior") u.veil = Math.min(H.veilMax, u.veil + Math.round(s.veilGain / 2));
  if (dmg > 0) {
    u.streak = 0;
    if (s.thorned) {
      const thorns = Math.max(1, Math.round(dmg * 0.15));
      hurt(e, u, f, thorns);
      ctx.fx(f.uid, "thorns", thorns);
    }
  }

  if (u.hp > 0 && u.hp <= s.maxHp * H.remedyAt) takeRemedy(ctx, u);
  if (u.hp <= 0) {
    fall(ctx, u, mob);
    return;
  }
  if (f.hp <= 0) killFoe(ctx, f);
}

function bleedTick(ctx, f) {
  const e = ctx.e;
  const u = hunterOf(e, f.bleedBy);
  if (u) hurt(e, u, f, f.bleed);
  else f.hp -= f.bleed;
  ctx.fx(f.uid, "bleed", f.bleed);
  f.bleed = Math.max(0, f.bleed - 1);
  f.bleedTimer = 1000;
  if (f.hp <= 0) killFoe(ctx, f);
}

/* A remedy comes out of the snapshot of what they packed. The save is not
   touched here: `owed.remedies` says how many to take off it at settling. */
function takeRemedy(ctx, u) {
  if (!Array.isArray(u.heals) || !u.heals.length) return;
  const heal = u.heals.shift();
  u.owed.remedies++;
  const before = u.hp;
  u.hp = Math.min(u.stats.maxHp, u.hp + heal * (u.stats.vital ? 1.2 : 1));
  ctx.fx(u.userId, "heal", Math.round(u.hp - before));
}

function fall(ctx, u, mob) {
  u.down = true;
  u.hp = 0;
  u.owed.died = mob.id;
  ctx.fx(u.userId, "fall", 0);
  retarget(ctx.e, ctx.rng);
}

/* ================= 4. WHAT A KILL PAYS ================= */

/* XP and gold split by share of the damage that killed it, so a hunter who
   landed a tenth of it takes a tenth. Drops cannot be halved: they go to whoever
   hurt it most, and the killing blow breaks a tie. */
function killFoe(ctx, f) {
  const e = ctx.e;
  const i = e.foes.indexOf(f);
  if (i < 0 || e.over) return;
  e.foes.splice(i, 1);

  const mob = getMonster(f.id);
  const z = getZone(e.zone);
  const n = foeNumbers(mob, f.elite, f.power);
  ctx.fx(f.uid, "kill", 0);

  const total = Object.keys(f.by).reduce((sum, k) => sum + f.by[k], 0);
  const gold = n.gold[0] + Math.floor(ctx.rng() * (n.gold[1] - n.gold[0] + 1));
  let best = null;
  let bestDmg = -1;

  e.hunters.forEach((u) => {
    const mine = f.by[u.userId] || 0;
    if (mine > bestDmg) {
      bestDmg = mine;
      best = u;
    }
    if (!(mine > 0) || !(total > 0)) return;
    const share = mine / total;
    u.owed.xp += n.xp * z.xp * share;
    u.owed.gold += gold * share;
    u.owed.kills++;
    // The region notices everyone who was there, so Threat rises as it would alone.
    u.owed.threat += n.threat * H.threatPerKill;
  });

  if (best && bestDmg > 0) best.owed.drops.push({ id: mob.id, elite: !!f.elite });

  if (!e.foes.length) e.over = "cleared";
}

/* ================= 5. READING ONE ================= */

/* What a watcher needs to draw the fight, and nothing else: no seed, no stat
   lines, no remedy counts. This is what the server hands the client. */
export function encounterView(e) {
  return {
    id: e.id, tier: e.tier, zone: e.zone, kind: e.kind, clock: Math.round(e.clock),
    over: e.over,
    foes: e.foes.map((f) => ({
      uid: f.uid, id: f.id, elite: f.elite,
      hp: Math.max(0, Math.ceil(f.hp)), max: f.max, target: f.target,
    })),
    hunters: e.hunters.map((u) => ({
      userId: u.userId, down: u.down,
      hp: Math.max(0, Math.ceil(u.hp)), max: u.stats.maxHp,
      dmg: Math.round(u.dmg),
    })),
  };
}

// Milliseconds until the next event, for a scheduler. 0 when one is due now.
export function nextEncounterDue(e) {
  if (!e || e.over) return Infinity;
  if (!standing(e).length || !e.foes.length) return 0;
  if (e.kind === "normal" && e.clock >= e.reinforceAt - EPS) return 0;
  if (e.kind === "sovereign" && e.clock >= e.enrageAt - EPS) return 0;
  if (standing(e).some((u) => u.swing <= EPS)) return 0;
  if (e.foes.some((f) => f.timer <= EPS || (f.bleed > 0 && f.bleedTimer <= EPS))) return 0;
  return Math.max(0, untilNext(e));
}

/* A hunter's loadout as the encounter needs it. Kept here so the server has one
   way to build one and the tests can build the same. */
export function hunterFrom(userId, state, statsOf, heals) {
  const stats = statsOf ? statsOf(state) : combatStats({
    level: 1, klass: state.player.klass, equipment: state.equipment,
  });
  return makeHunter(userId, stats, { hp: state.player.hp, heals: (heals || []).slice() });
}
