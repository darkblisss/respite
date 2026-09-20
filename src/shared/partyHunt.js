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
   A party fights the same roster a lone hunter does -- never more
   than CONFIG.hunt.maxFoes at once -- but each foe is scaled to the
   warband: its health and its attack both rise with the number
   standing. Nobody holds a foe of their own; every swing it takes is
   aimed at whoever is standing, in turn, so the pressure lands across
   the party rather than four separate fights running side by side.
   One bigger thing, shared, instead of four small ones.

   WHAT A KILL PAYS
   An encounter's XP pool rides the same scale its foes do, so a fair
   split of a foe built for four pays each of the four what a foe built
   for one pays a lone hunter. Partying is then worth a small bonus on
   top, and nothing more.

   A share of that pool is 70% of the damage you dealt and 30% of the
   damage you took, so holding the line counts for something without
   paying better than swinging -- and the taken half is capped against
   your damage share, so nobody farms a share by becoming unkillable and
   never striking. Shares are normalised, so the pool is paid out once.

   Gold is equal -- everyone who was there did the encounter. Drops are
   rolled for each hunter separately, so nobody races for a last hit.
   And the kill itself is credited to everyone who actually hurt it: one
   shared encounter, not four independent corpses.
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
    // What they have absorbed. Thirty percent of a share is this.
    taken: 0,
    owed: { xp: 0, gold: 0, mastery: 0, kills: 0, slain: [], drops: [], died: null, remedies: 0 },
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
    // Two at its back, warband or not: they are scaled, not multiplied.
    for (let i = 0; i < GameData.SOVEREIGN.escorts; i++) spawn(e, rng, rollFoe(tier, z, rng).mob, true);
  } else {
    // Exactly what the zone fields for one hunter.
    const want = Math.min(maxFoes(), pickWeighted(z.sizes, rng));
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
  return e;
}

// The encounter's own stream, picked up wherever it was left. See `dice` above.
function diceAt(e) {
  return makeRng(e, "dice");
}

export const standing = (e) => e.hunters.filter((u) => !u.down);

// The same ceiling a lone hunter faces. A party gets bigger foes, not more of them.
const maxFoes = () => H.maxFoes;

// How much of a foe a party is worth: its health and its attack both ride this.
const partyScale = (e) => Math.max(1, standing(e).length);

/* One foe, sized for the party that is facing it: health and attack both times the
   number standing. A four fights a thing with four times the health hitting four
   times as hard, spread across four of them -- which is the same fight each of them
   would have alone, made into one shared one. `scale` is kept on the foe so a hunter
   going down mid-fight cannot resize what is already on the floor. */
function spawn(e, rng, mob, elite, ambush = false) {
  const z = getZone(e.zone);
  const power = z.power || 1;
  const scale = partyScale(e);
  const n = foeNumbers(mob, elite, power);
  const hp = Math.round(n.hp * scale);
  const f = {
    uid: e.uid++, id: mob.id, elite: !!elite, power, scale, hp, max: hp, ambush: !!ambush,
    timer: ambush ? 300 + rng() * 400 : mob.speed * (0.45 + rng() * 0.35),
    bleed: 0, bleedTimer: 0,
    // Who has hurt it, and by how much: the share a kill pays out by.
    by: {},
  };
  e.foes.push(f);
  return f;
}

/* Nobody owns a foe. Each blow it throws goes to whoever is standing, taken in turn
   from a marker that walks the party, so a foe scaled for four spreads those four
   blows' worth across the four of them instead of pounding one. The marker lives on
   the encounter, not the foe, so the spread holds across the whole roster. */
function nextTarget(e) {
  const up = standing(e);
  if (!up.length) return null;
  e.turn = ((e.turn || 0) + 1) % up.length;
  return up[e.turn];
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

// One roster, shared: everyone swings at the same thing, the first still standing.
function pickFoe(e, _u) {
  return e.foes[0] || null;
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

  /* What the path has made of a full Veil. 1 for anyone who has not walked that
     far, so a hunter with no tree swings exactly as they always did. */
  if (technique && s.tech > 1) mult *= s.tech;

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

  const u = nextTarget(e);
  if (!u || u.down) return;
  const s = u.stats;

  /* Scaled to the warband, as its health is. It swings no more often than it would
     alone, so a four takes four hunters' worth of damage spread over four of them:
     about what each of them would have taken fighting it on their own. */
  let raw = foeNumbers(mob, f.elite, f.power).attack * (f.scale || 1) * (f.ambush ? H.foeAmbush : 1);
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
  u.taken += dmg;
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
}

/* ================= 4. WHAT A KILL PAYS ================= */

/* A share of an encounter is 70% of the damage you dealt and 30% of the damage you
   took, both measured across the whole encounter, so a hunter holding the line is
   paid for it without being paid better than one swinging. XP follows that share.
   Gold does not: everyone who hurt it gets the same, because they all did the same
   encounter. Drops are an entry each, rolled separately in each hunter's own save,
   so there is no last-hit to race for. And the kill is credited to everyone who
   actually hurt it -- one shared encounter, not four corpses. */
function killFoe(ctx, f) {
  const e = ctx.e;
  const i = e.foes.indexOf(f);
  if (i < 0 || e.over) return;
  e.foes.splice(i, 1);

  const mob = getMonster(f.id);
  const z = getZone(e.zone);
  const n = foeNumbers(mob, f.elite, f.power);
  ctx.fx(f.uid, "kill", 0);

  const gold = n.gold[0] + Math.floor(ctx.rng() * (n.gold[1] - n.gold[0] + 1));
  /* The pool, not one hunter's worth. This foe was built for the warband: its health
     and its attack both rode f.scale, so its XP does too. A fair split of a foe made
     for four therefore pays each of the four what a foe made for one pays a lone
     hunter -- which is the whole point of one bigger thing instead of four small
     ones. The party bonus rides on top, and is small on purpose. */
  const xp = n.xp * z.xp * (f.scale || 1) * partyXpBonus(f.scale || 1);
  const hurtIt = e.hunters.filter((u) => (f.by[u.userId] || 0) > 0);

  // Worked out once for the whole roster: the shares are normalised against each other.
  const shares = contributionMap(e);
  e.hunters.forEach((u) => {
    const share = shares[u.userId] || 0;
    if (share > 0) u.owed.xp += xp * share;
  });

  hurtIt.forEach((u) => {
    u.owed.gold += gold;
    /* A weapon's mastery is the hours it was carried, not the share it earned: a
       kill your party made with you in it is a kill you carried that weapon through,
       so it pays the same points a lone kill of the same foe pays. Unsplit, and
       unscaled -- the foe's size is the party's problem, not the weapon's. */
    u.owed.mastery += n.xp * z.xp;
    u.owed.kills++;
    u.owed.slain.push({ id: mob.id, elite: !!f.elite });
    u.owed.drops.push({ id: mob.id, elite: !!f.elite });
  });

  if (!e.foes.length) e.over = "cleared";
}

/* How much a party of this size multiplies an encounter's XP pool by, over and above
   the scale its foes were built at. Small on purpose: see CONFIG.party. */
export function partyXpBonus(scale) {
  const P = CONFIG.party;
  const others = Math.max(0, (Number.isFinite(scale) ? scale : 1) - 1);
  return 1 + Math.min(P.huntBonusCap, P.huntBonusPerMember * others);
}

/* Every hunter's share of the encounter so far, by user id, summing to 1.

   The raw share is 70% of the damage you dealt and 30% of the damage you took. Left
   there, a hunter who made themselves unkillable and never swung would bank the
   whole 30% for standing still, so the taken half is guarded: what is counted for
   you is capped at takenPerDealt times your damage share, and at takenCap of the
   encounter outright. Absorbing is paid for beside swinging, never instead of it.

   Anyone who actually hurt it is then floored at contribFloor, and the lot is
   normalised, so a cap or a floor moves XP between hunters rather than minting or
   burning any: the encounter pays out exactly its pool, whatever shape the party is.

   With nothing taken by anyone the whole of it rides on damage dealt. */
export function contributionMap(e) {
  const P = CONFIG.party;
  const totalDmg = e.hunters.reduce((n, x) => n + x.dmg, 0);
  const totalTaken = e.hunters.reduce((n, x) => n + x.taken, 0);
  const out = {};
  if (!(totalDmg > 0)) return out;

  let sum = 0;
  e.hunters.forEach((u) => {
    const dealt = u.dmg / totalDmg;
    let share = dealt;
    if (totalTaken > 0) {
      const taken = Math.min(u.taken / totalTaken, P.takenCap, P.takenPerDealt * dealt);
      share = P.contribDealt * dealt + P.contribTaken * taken;
    }
    if (u.dmg > 0) share = Math.max(share, P.contribFloor);
    out[u.userId] = Math.max(0, share);
    sum += out[u.userId];
  });
  if (!(sum > 0)) return {};
  Object.keys(out).forEach((id) => { out[id] /= sum; });
  return out;
}

// One hunter's share. Reading the whole roster at once is contributionMap.
export function contributionOf(e, u) {
  const share = contributionMap(e)[u.userId];
  return share === undefined ? 0 : share;
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
      hp: Math.max(0, Math.ceil(f.hp)), max: f.max,
    })),
    hunters: (() => {
      const shares = contributionMap(e);
      return e.hunters.map((u) => ({
        userId: u.userId, down: u.down,
        hp: Math.max(0, Math.ceil(u.hp)), max: u.stats.maxHp,
        dmg: Math.round(u.dmg), taken: Math.round(u.taken),
        share: Math.round((shares[u.userId] || 0) * 100),
      }));
    })(),
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

/* ================= 6. THE SESSION ================= */
/* A party hunt is encounters one after another with a walk between, the same
   rhythm a lone hunter keeps. The session owns that rhythm so the server has one
   blob to persist and one function to tick: every rule stays here, where it can
   be tested without a database.

   The session's own dice mint each encounter's seed, so the whole session
   replays from its stored row exactly as one encounter does. */

export function newSession({ partyId, tier, zone, seed, hunters }) {
  return {
    partyId, tier, zone,
    seed: seed >>> 0,
    dice: (seed >>> 0) + 7,
    phase: "search",          // search | fight
    wait: H.searchMinMs,      // ms left of the walk
    elapsed: 0,
    encounters: 0,
    enc: null,
    // The warband, kept across encounters: health and remedies carry over, as they do alone.
    hunters: hunters.slice(),
    over: null,               // null while it runs: "wiped", "empty"
  };
}

/* Health and remedies carry from one encounter to the next, so a warband is worn
   down over a session rather than healed by the walk. A hunter who fell is out
   of the session until their save has settled the death and they rejoin. */
function nextEncounter(s) {
  const rng = makeRng(s, "dice");
  const up = s.hunters.filter((u) => !u.down);
  if (!up.length) {
    s.over = "wiped";
    return;
  }
  s.encounters++;
  s.enc = newEncounter({
    id: s.encounters,
    partyId: s.partyId,
    tier: s.tier,
    zone: s.zone,
    seed: Math.floor(rng() * 4294967296),
    hunters: up,
  });
  s.phase = "fight";
}

/* In memory the session's hunters and the live encounter's are the same objects,
   so moving one moves both. Through JSON they become two, and only the
   encounter's copy is the one stepEncounter writes to, which leaves owedFor,
   sessionView and the next encounter reading a roster frozen at the last save.
   The session owns the hunters, so it points the encounter back at its own
   before every step. Cheap, and it makes a session read off a database row
   behave exactly like one that never left memory. */
function bind(s) {
  if (!s.enc || !Array.isArray(s.enc.hunters)) return;
  s.enc.hunters = s.enc.hunters.map((u) => s.hunters.find((x) => x.userId === u.userId) || u);
}

/* Moves the whole session forward. `hooks.fx` is passed through to the encounter.
   Returns the milliseconds played, which is less than dt once the session is over. */
export function stepSession(s, dt, hooks = {}) {
  bind(s);
  let left = dt;
  let played = 0;
  let guard = 0;
  while (!s.over && left > EPS && guard++ < 10000) {
    if (s.phase === "search") {
      const step = Math.min(left, Math.max(EPS, s.wait));
      s.wait -= step;
      s.elapsed += step;
      left -= step;
      played += step;
      if (s.wait <= EPS) nextEncounter(s);
      continue;
    }
    const ran = stepEncounter(s.enc, left, hooks);
    s.elapsed += ran;
    left -= ran;
    played += ran;
    if (!s.enc.over) break;
    // Cleared inside the window, the rest of it is the walk to the next one.
    const z = getZone(s.zone);
    if (s.enc.over === "wiped") {
      s.over = "wiped";
      break;
    }
    s.phase = "search";
    s.wait = Math.max(H.searchMinMs, z.windowMs - s.enc.clock);
    s.enc = null;
    if (!s.hunters.some((u) => !u.down)) s.over = "wiped";
  }
  return played;
}

// Milliseconds until the session's next event, for the scheduler that ticks it.
export function nextSessionDue(s) {
  if (!s || s.over) return Infinity;
  if (s.phase === "search") return Math.max(0, s.wait);
  return nextEncounterDue(s.enc);
}

/* What every hunter is owed, and nothing else. The server takes a member's share
   when that member's own request next comes in, and zeroes it. */
export function owedFor(s, userId) {
  const u = s.hunters.find((x) => x.userId === String(userId));
  return u ? u.owed : null;
}

export function clearOwed(s, userId) {
  const u = s.hunters.find((x) => x.userId === String(userId));
  if (!u) return;
  u.owed = { xp: 0, gold: 0, mastery: 0, kills: 0, slain: [], drops: [], died: null, remedies: 0 };
}

// What a watcher sees of the whole session.
export function sessionView(s) {
  return {
    partyId: s.partyId, tier: s.tier, zone: s.zone,
    phase: s.phase, wait: Math.max(0, Math.round(s.wait)),
    elapsed: Math.round(s.elapsed), encounters: s.encounters, over: s.over,
    enc: s.enc ? encounterView(s.enc) : null,
    hunters: s.hunters.map((u) => ({
      userId: u.userId, down: u.down,
      hp: Math.max(0, Math.ceil(u.hp)), max: u.stats.maxHp,
      dmg: Math.round(u.dmg),
    })),
  };
}
