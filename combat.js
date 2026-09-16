/* ============================================================
   Respite · combat.js · The Battlefield
   ------------------------------------------------------------
   The hunt: derived stats, zones and Threat, and the encounter
   engine. The engine is event-driven. Every combatant keeps its
   own swing timer and time jumps from one event to the next, so
   an open tab, a sleeping phone and twelve hours offline all
   play out the same fight. The same engine runs projections for
   the zone popup without touching the save.
   ============================================================ */

/* ================= 1. STATS ================= */

// Worn gear, summed. `equipment` defaults to what you are wearing.
function equipStat(stat, equipment) {
  const eq = equipment || state.equipment;
  let total = 0;
  EQUIP_SLOTS.forEach((slot) => {
    const d = eq[slot] ? itemDef(eq[slot]) : null;
    if (d && typeof d[stat] === "number") total += d[stat];
  });
  return total;
}

// Relic prefixes are read straight off worn gear.
function hasPrefix(id, equipment) {
  const eq = equipment || state.equipment;
  return EQUIP_SLOTS.some((s) => eq[s] && parseKey(eq[s]).prefix === id);
}

const myClass = () => classDef(state.player.klass);
const canPickClass = () => !state.player.klass && skillLevel("warfare") >= CLASS_PICK_LEVEL;

/* Everything a fight needs to know about you, as one snapshot. Pass a
   loadout ({ level, klass, equipment }) to ask about anyone else. */
function combatStats(loadout) {
  const lo = loadout || { level: skillLevel("warfare"), klass: state.player.klass, equipment: state.equipment };
  const eq = lo.equipment || {};
  const k = classDef(lo.klass) || BRUTE_FORCE;
  const has = (id) => hasPrefix(id, eq);
  const health = (baseHealth(lo.level) * k.health + equipStat("health", eq)) * (has("vital") ? 1.05 : 1);

  return {
    level: lo.level, klass: k.id, className: k.name,
    maxHp: Math.max(1, Math.round(health)),
    attack: baseAttack(lo.level) * k.attack + equipStat("attack", eq),
    defence: (baseDefence(lo.level) * k.defence + equipStat("defence", eq)) * (has("bulwark") ? 1.15 : 1),
    speed: k.speed,
    crit: Math.min(0.75, k.crit + equipStat("crit", eq)),
    critDmg: k.critDmg,
    pen: Math.min(0.9, k.pen + (has("sundering") ? 0.15 : 0)),
    veilGain: k.id === "warrior" || k.id === "rogue" ? veilPerBlow(lo.level) + equipStat("veil", eq) : 0,
    absorb: k.id === "mage" ? TECHNIQUE.absorb + equipStat("veil", eq) / 10 : 0,
    echoing: has("echoing"), furious: has("furious"), executioner: has("executioner"), wounding: has("wounding"),
    stalwart: has("stalwart"), vital: has("vital"), thorned: has("thorned"), resilient: has("resilient"),
  };
}

const maxHp = () => combatStats().maxHp;

// The share of a blow that Defence stops, on ground of this tier.
function mitigation(defence, tier) {
  if (!(defence > 0)) return 0;
  return Math.min(MITIGATION_CAP, defence / (defence + defenceK(tier)));
}

// Stochastic rounding: 2.3 lands as 3 three times in ten, as 2 otherwise.
function landed(x, rng) {
  const f = Math.floor(x);
  return f + (rng() < x - f ? 1 : 0);
}

/* ================= 2. ZONES, THREAT & FOES ================= */

const threatKey = (tier, zone) => `${tier}:${zone}`;

function threatIn(tier, zone) {
  return (state.threat && state.threat[threatKey(tier, zone)]) || 0;
}

function setThreat(tier, zone, n) {
  state.threat[threatKey(tier, zone)] = clamp(Math.round(n), 0, THREAT_CAP);
}

// [[value, weight], ...] -> one value.
function pickWeighted(pairs, rng) {
  const total = pairs.reduce((n, p) => n + p[1], 0);
  let r = rng() * total;
  for (const [value, weight] of pairs) {
    if (r < weight) return value;
    r -= weight;
  }
  return pairs[pairs.length - 1][0];
}

function rollFoe(tier, zone, rng) {
  const arch = pickWeighted(ARCHETYPE_ORDER.map((a) => [a, zone.mix[a]]), rng);
  return { mob: foeOf(tier, arch), elite: rng() < zone.elite };
}

// A foe's numbers with the Elite modifier folded in.
function foeNumbers(mob, elite) {
  const e = elite ? ELITE : null;
  return {
    hp: Math.round(mob.hp * (e ? e.hp : 1)),
    attack: mob.attack * (e ? e.attack : 1),
    xp: mob.xp * (e ? e.xp : 1),
    threat: mob.threat + (e ? e.threat : 0),
    gold: mob.gold.map((g) => Math.round(g * (e ? e.gold : 1))),
    dropQty: e ? ELITE.drops : 1,
  };
}

// "The Ash Stalker", "The Ashen Warden", "What Feeds The Roots".
const foeTitle = (mob) => (/^(The|What) /.test(mob.name) ? mob.name : `The ${mob.name}`);

/* ================= 3. TAKING UP THE HUNT ================= */
/* A hunt runs `limit` kills, or with no limit (null) until you pull back,
   fall, or twelve hours pass. Health refills when a hunt sets out from
   camp, and carries over when you move ground mid-hunt. */

function newHunt(tier, zone, limit) {
  return {
    tier, zone, limit: limit == null ? null : limit,
    done: 0, elapsed: 0, startedAt: Date.now(),
    phase: "search",          // search | fight | hide
    wait: SEARCH_MIN_MS,      // ms left of the walk, or of hiding
    kind: "normal",           // normal | sovereign
    clock: 0, reinforceAt: 0, enrageAt: 0, enrage: 0,
    foes: [], uid: 1,
    swing: 0, volley: 0, veil: 0, streak: 0,
    peak: false, sovereignNext: false, encounters: 0,
    xp: 0, marks: [[0, 0]], nextMark: XP_MARK_MS, xpRate: null,
  };
}

function startHunt(tier, zone, limit) {
  if (recovering()) return refuse("You're still recovering.");
  const z = zoneDef(zone).id;
  const n = limit == null ? null : Math.max(1, Math.floor(limit));
  const c = state.tasks.combat;

  if (c && c.tier === tier && c.zone === z) {
    // Already out on this ground: the fight carries on, the count starts again.
    c.limit = n;
    c.done = 0;
    c.elapsed = 0;
    c.nextMark = XP_MARK_MS;
    c.marks = [[0, 0]];
    c.xp = 0;
    c.xpRate = null;
    c.startedAt = Date.now();
  } else {
    if (!c) state.player.hp = maxHp();
    state.tasks.combat = newHunt(tier, z, n);
  }
  render();
  return true;
}

// Pulling back is immediate. Whatever you were fighting is left behind.
function pullBack() {
  if (!state.tasks.combat) return false;
  state.tasks.combat = null;
  render();
  return true;
}

// The live hunt at a glance, for the topbar, the arena and the Character page.
function combatPlan() {
  const c = state.tasks.combat;
  if (!c) return null;
  const zone = zoneDef(c.zone);
  const target = c.phase === "fight" ? c.foes[0] || null : null;
  let pct = 0;
  if (target) pct = clamp((target.hp / target.max) * 100, 0, 100);
  return {
    c, zone, region: regionOfTier(c.tier), phase: c.phase, kind: c.kind,
    target, mob: target ? getMonster(target.id) : null, pct,
    done: c.done, limit: c.limit, xpRate: c.xpRate, threat: threatIn(c.tier, c.zone),
    timeLeft: Math.max(0, IDLE_CAP_MS - c.elapsed),
  };
}

/* ================= 4. THE ENCOUNTER ENGINE ================= */
/* Works on a context, never on the save directly:
     c        the hunt (state.tasks.combat, or a scratch copy)
     s        combatStats() snapshot
     p        { hp } for the hunter
     rng      () => 0..1
     hide     whether to go to ground when Threat peaks
   and hooks for everything with a consequence: fx, note, threat,
   setThreat, remedy, gainXp, gainGold, killed, sovereignDown, died,
   ended. Section 5 wires them to the save; section 6 to a tally. */

const EPS = 1e-6;

function stepHunt(ctx, dt) {
  let left = dt;
  let guard = 0;
  while (!ctx.over && guard++ < 200000) {
    fireDue(ctx);
    if (ctx.over || left <= EPS) break;
    // fireDue has cleared everything due, so the next event is always ahead.
    const step = Math.min(left, Math.max(EPS, untilNext(ctx)));
    advance(ctx, step);
    left -= step;
  }
}

// Time until the next thing happens.
function untilNext(ctx) {
  const c = ctx.c;
  let t = Math.min(c.nextMark - c.elapsed, IDLE_CAP_MS - c.elapsed);
  if (c.phase !== "fight") return Math.min(t, c.wait);
  t = Math.min(t, c.swing, c.kind === "normal" ? c.reinforceAt - c.clock : c.enrageAt - c.clock);
  c.foes.forEach((f) => {
    t = Math.min(t, f.timer);
    if (f.bleed > 0) t = Math.min(t, f.bleedTimer);
  });
  return t;
}

function advance(ctx, ms) {
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
  if (ctx.s.absorb && c.volley <= 0) c.veil = Math.min(VEIL_MAX, c.veil + (ctx.s.absorb * ms) / 1000);
}

// Everything due now, one at a time, in a fixed order.
function fireDue(ctx) {
  const c = ctx.c;
  for (let guard = 0; guard < 500 && !ctx.over; guard++) {
    if (c.elapsed >= c.nextMark - EPS) { markXp(c); continue; }
    if (c.elapsed >= IDLE_CAP_MS - EPS) { endHunt(ctx, "cap"); return; }

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

// XP/hr: every five minutes, what the last hour (or the hunt so far) earned.
function markXp(c) {
  c.marks.push([c.nextMark, c.xp]);
  while (c.marks.length > 60 * 60 * 1000 / XP_MARK_MS + 1) c.marks.shift();
  const [t0, x0] = c.marks[0];
  c.xpRate = ((c.xp - x0) * 3600000) / Math.max(1, c.nextMark - t0);
  c.nextMark += XP_MARK_MS;
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
  const zone = zoneDef(c.zone);

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
    c.enrageAt = SOVEREIGN.enrageMs;
    const sov = sovereignOf(c.tier);
    addFoe(ctx, sov, false, false);
    for (let i = 0; i < zone.escorts; i++) addFoe(ctx, rollFoe(c.tier, zone, ctx.rng).mob, true, false);
    ctx.note(null, `${sov.name} comes up out of the dark`);
    if (ctx.met) ctx.met(sov);
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
  if (ctx.s.klass === "rogue") c.veil = VEIL_MAX;
  if (ctx.s.klass === "mage") {
    c.veil = VEIL_MAX;
    c.volley = TECHNIQUE.volley.casts;
  }
}

function reinforce(ctx) {
  const c = ctx.c;
  const zone = zoneDef(c.zone);
  c.reinforceAt += zone.windowMs;
  if (c.foes.length >= MAX_FOES) return;
  const r = rollFoe(c.tier, zone, ctx.rng);
  addFoe(ctx, r.mob, r.elite, true);
}

function enrageStep(ctx) {
  const c = ctx.c;
  c.enrage++;
  c.enrageAt += SOVEREIGN.enrageMs;
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
  const target = c.foes[0];
  const mob = getMonster(target.id);

  let kind = "hit";
  let mult = 1;
  let crit = rng() < s.crit;
  let pen = s.pen;
  let technique = false;

  if (c.volley > 0) {
    kind = "volley";
    mult = TECHNIQUE.volley.mult;
    technique = true;
    c.volley--;
    c.veil = c.volley > 0 ? Math.max(0, c.veil - VEIL_MAX / TECHNIQUE.volley.casts) : 0;
  } else if (s.klass && c.veil >= VEIL_MAX - EPS) {
    technique = true;
    c.veil = 0;
    if (s.klass === "warrior") {
      kind = "strike";
      mult = TECHNIQUE.strike.mult;
      pen += TECHNIQUE.strike.pen;
    } else if (s.klass === "rogue") {
      kind = "ambush";
      crit = true;
      mult = TECHNIQUE.ambush.mult;
    } else {
      kind = "empowered";
      mult = TECHNIQUE.empowered.mult;
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

  if (!technique && s.veilGain) c.veil = Math.min(VEIL_MAX, c.veil + s.veilGain);
  c.swing = c.volley > 0 ? VOLLEY_GAP_MS : s.speed;

  target.hp -= dmg;
  ctx.fx(target.uid, technique ? kind : crit ? "crit" : "hit", dmg);

  // A Mage's empowered casts wash over everything else in the fight too.
  const splash = (kind === "volley" || kind === "empowered") ? c.foes.filter((f) => f !== target) : [];
  splash.forEach((f) => {
    const hit = playerBlow(s, getMonster(f.id), c.tier, mult * TECHNIQUE.splash, false, pen, rng);
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

  let raw = foeNumbers(mob, f.elite).attack * (f.ambush ? FOE_AMBUSH : 1);
  if (mob.archetype === "sovereign") raw *= 1 + c.enrage * SOVEREIGN.enrage;
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
  if (s.klass === "warrior") c.veil = Math.min(VEIL_MAX, c.veil + Math.round(s.veilGain / 2));
  if (dmg > 0) {
    c.streak = 0;
    if (s.thorned) {
      const thorns = Math.max(1, Math.round(dmg * 0.15));
      f.hp -= thorns;
      ctx.fx(f.uid, "thorns", thorns);
    }
  }

  if (p.hp > 0 && p.hp <= s.maxHp * REMEDY_AT) takeRemedy(ctx);
  if (p.hp <= 0) {
    die(ctx, mob);
    return;
  }
  // Thorns can finish the foe on the blow that would have sent you running: the kill counts first.
  if (f.hp <= 0) killFoe(ctx, f);
  if (!ctx.over && c.phase === "fight" && c.kind === "sovereign" && p.hp <= s.maxHp * RETREAT_AT) retreat(ctx);
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
  const n = foeNumbers(mob, f.elite);
  c.done++;
  ctx.fx(f.uid, "kill", 0);
  ctx.gainXp(n.xp * zoneDef(c.zone).xp);
  ctx.gainGold(n.gold[0] + Math.floor(ctx.rng() * (n.gold[1] - n.gold[0] + 1)));
  ctx.killed(mob, f.elite);

  if (mob.archetype === "sovereign") {
    ctx.sovereignDown(mob);
  } else if (c.kind === "normal") {
    const before = ctx.threat();
    const after = Math.min(THREAT_CAP, before + Math.round(n.threat * zoneDef(c.zone).threat));
    if (after !== before) ctx.setThreat(after);
    if (after >= THREAT_CAP) c.peak = true;
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
  const zone = zoneDef(c.zone);
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
    c.wait = SEARCH_MIN_MS;
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
      c.wait = SEARCH_MIN_MS;
      return;
    }
    ctx.setThreat(0);
    ctx.note(`Something vast moved through the ${zone.name} of ${regionOfTier(c.tier).name} and did not find you.`, null);
  }

  c.wait = Math.max(SEARCH_MIN_MS, zone.windowMs - took);
}

function goToGround(ctx) {
  const c = ctx.c;
  ctx.setThreat(0);
  c.phase = "hide";
  c.wait = HIDE_MS;
  ctx.note(`Threat peaked in the ${zoneDef(c.zone).name} of ${regionOfTier(c.tier).name}. You went to ground for five minutes.`, "Hiding for five minutes");
  if (ctx.hid) ctx.hid();
}

function leaveHiding(ctx) {
  ctx.c.phase = "search";
  ctx.c.wait = SEARCH_MIN_MS;
}

// Low enough in a Sovereign fight, you break away and the hunt goes on.
function retreat(ctx) {
  const c = ctx.c;
  const sov = c.foes.map((f) => getMonster(f.id)).find((m) => m.archetype === "sovereign");
  ctx.note(`You broke away from ${sov ? sov.name : "a Sovereign's guard"} after ${fmtTime(c.clock)}.`, "You broke away");
  c.foes.forEach((f) => ctx.fx(f.uid, "leave", 0));
  c.foes = [];
  if (ctx.retreated) ctx.retreated();
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

/* ================= 5. THE LIVE HUNT ================= */

// What just happened, for the arena. Never saved; the UI drains it.
//   who:  a foe's uid, or "you"
//   kind: hit, crit, strike, ambush, volley, empowered, bleed, thorns,
//         hurt, ambushed, block, glance, heal, kill, spawn, join, leave,
//         enrage, fall
let combatFx = [];

function fx(who, kind, amount) {
  if (catchingUp) return;
  combatFx.push({ t: Date.now(), who, kind, amount: amount || 0 });
  if (combatFx.length > 60) combatFx.shift();
}

function combatTick(dt) {
  const c = state.tasks.combat;
  if (!c) return;
  const ctx = liveHunt(c);
  if (state.player.hp > ctx.s.maxHp) state.player.hp = ctx.s.maxHp;
  stepHunt(ctx, dt);
}

function liveHunt(c) {
  // Stats change mid-tick when a level comes or a piece breaks. Health never sits above the new most.
  const refresh = () => {
    ctx.s = combatStats();
    if (state.player.hp > ctx.s.maxHp) state.player.hp = ctx.s.maxHp;
  };
  const ctx = {
    c, s: combatStats(), p: state.player, rng: Math.random, over: false,
    hide: !!(state.settings && state.settings.hideSovereign),
    fx,
    note: (line, toastLine) => {
      if (line) say(line);
      if (toastLine) toast(toastLine);
    },
    threat: () => threatIn(c.tier, c.zone),
    setThreat: (n) => setThreat(c.tier, c.zone, n),
    remedy: () => {
      const k = bestFood();
      if (!k) return 0;
      spend(k, 1);
      return itemDef(k).heal;
    },
    gainXp: (amount) => {
      const gain = amount * xpMult("warfare");
      c.xp += gain;
      if (addXp("warfare", gain)) refresh();
    },
    gainGold: (n) => {
      if (n > 0) addGold(Math.round(n * (1 + companionBonus("gold"))));
    },
    killed: (mob, elite) => {
      state.stats.kills++;
      bountyProgress("slay", mob);
      dropLoot(mob, elite);
      companionFind("warfare");
      if (applyWear()) refresh();
    },
    sovereignDown: (mob) => {
      state.stats.bosses = (state.stats.bosses || 0) + 1;
      state.stats.epics++;
      const pool = Object.values(GEAR).filter((g) => g.tier === mob.tier);
      const key = makeKey(pool[randInt(0, pool.length - 1)].id, "epic");
      const kept = stashLoot(key, 1);
      say(`${mob.name} fell after ${fmtTime(c.clock)}.${kept ? ` It left ${itemName(key)}.` : " What it left had nowhere to go."}`);
      toast(`Sovereign felled: ${itemName(key)}`);
    },
    died: (mob) => {
      const took = c.elapsed;
      state.tasks.combat = null;
      state.stats.deaths++;
      state.player.hp = maxHp();
      state.player.recoveryLeft = RECOVERY_MS;
      EQUIP_SLOTS.forEach((slot) => {
        const key = state.equipment[slot];
        if (key && itemDef(key).maxDur) damageItem(key, DEATH_WEAR);
      });
      fx("you", "fall", 0);
      say(`${foeTitle(mob)} put you down after ${fmtTime(took)} on the hunt. Recovering for five minutes.`);
      toast("You fell");
    },
    ended: (reason) => {
      state.tasks.combat = null;
      if (reason === "limit") {
        say(`Hunt finished: ${fmt(c.done)} kills in ${fmtTime(c.elapsed)}.`);
        toast("Hunt finished");
      } else {
        say(`Twelve hours on the hunt and ${fmt(c.done)} kills. You make for camp.`);
        toast("The hunt stood down");
      }
    },
  };
  return ctx;
}

/* ================= 6. PROJECTIONS ================= */
/* Plays a hunt forward on a scratch copy: how fast it kills, what it earns
   and how long you last. Seeded, so the same question gets the same answer. */

function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// opts: { stats, hp, threat, hide, remedies: [heal, ...], xpMult, horizonMs, seed, chunkMs }
function projectOnce(tier, zoneId, opts) {
  const o = opts || {};
  const s = o.stats || combatStats();
  const horizon = Math.min(IDLE_CAP_MS, o.horizonMs || IDLE_CAP_MS);
  const c = newHunt(tier, zoneId, null);
  const heals = (o.remedies || []).slice();
  let threat = o.threat || 0;
  const t = { kills: 0, xp: 0, gold: 0, remedies: 0, sovereigns: 0, met: 0, retreats: 0, hides: 0, died: false, ms: 0, killer: null };

  const ctx = {
    c, s, p: { hp: o.hp == null ? s.maxHp : o.hp }, rng: seededRng(o.seed || 1), over: false, hide: !!o.hide,
    fx: () => {},
    note: () => {},
    hid: () => { t.hides++; },
    met: () => { t.met++; },
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
function projectHunt(tier, zoneId, opts) {
  const o = opts || {};
  const results = [];
  for (let r = 0; r < (o.runs || 3); r++) {
    results.push(projectOnce(tier, zoneId, Object.assign({}, o, { seed: (o.seed || 7) + r * 7919 })));
  }
  return summariseRuns(results, o.horizonMs);
}

function summariseRuns(results, horizonMs) {
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
    horizonMs: Math.min(IDLE_CAP_MS, horizonMs || IDLE_CAP_MS),
  };
}

/* What the zone popup shows: three twelve-hour runs from full health with the
   remedies you hold. Played a run per timeout so the popup paints first, and
   remembered until anything that matters changes. */
let oddsCache = { sig: null, value: null };

function huntOddsLater(tier, zoneId, done) {
  const opts = {
    stats: combatStats(), remedies: remedyHeals(), hide: !!state.settings.hideSovereign,
    threat: threatIn(tier, zoneId), xpMult: xpMult("warfare"), runs: 3, horizonMs: IDLE_CAP_MS,
  };
  const sig = [tier, zoneId, JSON.stringify(opts.stats), opts.remedies.length, opts.remedies[0] || 0,
    opts.hide, Math.floor(opts.threat / 25), opts.xpMult.toFixed(2)].join("|");
  if (oddsCache.sig === sig) {
    setTimeout(() => done(oddsCache.value), 0);
    return;
  }

  const runs = [];
  const next = () => {
    runs.push(projectOnce(tier, zoneId, Object.assign({}, opts, { seed: 7 + runs.length * 7919 })));
    if (runs.length < opts.runs) {
      setTimeout(next, 0);
      return;
    }
    const value = summariseRuns(runs, opts.horizonMs);
    oddsCache = { sig, value };
    done(value);
  };
  setTimeout(next, 30);
}

/* ================= 7. REMEDIES & LOOT ================= */

function bestFood() {
  let pick = null;
  let best = 0;
  ["inv", "bank", "vault"].forEach((w) => {
    Object.keys(store(w).items).forEach((k) => {
      const d = itemDef(k);
      if (d && d.heal && d.heal > best) {
        best = d.heal;
        pick = k;
      }
    });
  });
  return pick;
}

// Every remedy you hold, as heal amounts, best first. Capped: enough for any projection.
function remedyHeals() {
  const out = [];
  ["inv", "bank", "vault"].forEach((w) => {
    Object.keys(store(w).items).forEach((k) => {
      const d = itemDef(k);
      if (d && d.heal) for (let i = 0; i < Math.min(store(w).items[k], 400); i++) out.push(d.heal);
    });
  });
  return out.sort((a, b) => b - a).slice(0, 400);
}

/* Loot goes straight into Armaments: Belongings, then the Vault, then
   Provisions. A stack already held somewhere grows where it is. */
const LOOT_ORDER = ["inv", "vault", "bank"];
let lootLostAt = -Infinity;

function stashLoot(key, qty) {
  const where = LOOT_ORDER.find((w) => qtyIn(w, key) > 0) || LOOT_ORDER.find((w) => !storeFull(w));
  if (where && addTo(where, key, qty)) return where;
  if (nowMs() - lootLostAt > 10 * 60 * 1000) {
    lootLostAt = nowMs();
    say("Belongings, the Vault and Provisions are full. Loot is being left where it fell.");
    toast("No room for loot");
  }
  return null;
}

function dropLoot(mob, elite) {
  const bonus = 1 + companionBonus("drops");
  const qtyMult = elite ? ELITE.drops : 1;
  mob.drops.forEach(([k, qty, chance]) => {
    if (Math.random() < chance * bonus) stashLoot(k, qty * qtyMult);
  });

  // Companions with a nose for it turn up a finer piece now and then.
  const rare = companionBonus("rare");
  if (rare && Math.random() < rare) {
    const pool = Object.values(GEAR).filter((g) => g.tier === mob.tier);
    const key = makeKey(pool[randInt(0, pool.length - 1)].id, rollFineRarity());
    if (stashLoot(key, 1)) toast(`Found: ${itemName(key)}`);
  }
}

/* ================= 8. DURABILITY ================= */

function wearPct(key) {
  const d = itemDef(key);
  if (!d || !d.maxDur) return null;
  return clamp(Math.round((1 - (state.wear[key] || 0) / d.maxDur) * 100), 0, 100);
}

// A kill's wear: the weapon and one armour piece. True when something broke.
function applyWear() {
  let broke = false;
  const w = state.equipment.weapon;
  if (w && itemDef(w).maxDur) broke = damageItem(w, 1) || broke;
  const armour = EQUIP_SLOTS.filter((s) => !["weapon", "ring", "neck"].includes(s)).map((s) => state.equipment[s]).filter((k) => k && itemDef(k).maxDur);
  if (armour.length) broke = damageItem(armour[randInt(0, armour.length - 1)], 1) || broke;
  return broke;
}

function damageItem(key, amount) {
  const d = itemDef(key);
  state.wear[key] = (state.wear[key] || 0) + amount;
  if (state.wear[key] < d.maxDur) return false;
  state.equipment[d.slot] = null;
  state.wear[key] = 0;
  say(`${itemName(key)} broke.`);
  toast(`${itemName(key)} broke`);
  return true;
}

function repairCost(key) {
  const d = itemDef(key), dmg = state.wear[key] || 0;
  if (!d.maxDur || dmg <= 0) return null;
  return { mat: d.repairMat, qty: Math.max(1, Math.ceil(dmg / 80)) };
}

function repairItem(key) {
  const cost = repairCost(key);
  if (!cost) return;
  if (haveQty(cost.mat) < cost.qty) {
    say(`Need ${cost.qty} ${itemName(cost.mat)}.`);
    toast(`Need ${cost.qty} ${itemName(cost.mat)}`);
    render();
    return;
  }
  spend(cost.mat, cost.qty);
  state.wear[key] = 0;
  say(`Patched up ${itemName(key)}.`);
  render();
}
