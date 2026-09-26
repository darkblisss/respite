/* The hunt, played through the v5 API: the v4 verify-hunt.js scenarios
   (stats, timers, reinforcements, disciplines, Sovereigns, hiding,
   retreats, death, limits, the cap, XP marks, loot, time away) plus what v5
   adds: counter rolls for loot and finds, wear on the hunt stream, remedies
   out of the Satchel and nowhere else, party XP, and the events and log lines.

     node tests/engine/hunt.test.mjs */

import { run, check, section, same, shared, clone, put, listening, gearSet } from "./harness.mjs";

await run(async () => {
  const { CONFIG } = await shared("config.js");
  const { GameData, foeOf, sovereignOf, getMonster } = await shared("registry.js");
  const { createState } = await shared("state.js");
  const { advance, applyCommand } = await shared("engine.js");
  const St = await shared("stats.js");
  const Cb = await shared("combat.js");
  const S = await shared("storage.js");
  const I = await shared("items.js");
  const { roll, SALT } = await shared("rng.js");

  const H = CONFIG.hunt;
  const CAP = CONFIG.time.idleCapMs;
  const T0 = Date.UTC(2026, 8, 16, 9, 0);
  const X = CONFIG.xpTable;

  function hunter(seed, { level = 1, klass = null, equipment = null } = {}) {
    const s = createState({ now: T0, seed });
    s.skills.warfare = X[level];
    s.player.klass = klass;
    if (equipment) s.equipment = equipment;
    s.travel.unlocked = GameData.REGIONS.map((r) => r.id);
    s.player.hp = St.maxHp(s);
    return s;
  }
  const hunt = (s, tier, zone, limit = null) => (s.tasks.combat = Cb.newHunt(s, tier, zone, limit));
  const step = (s, env, ms) => advance(s, s.clock + ms, env);
  function stepWhile(s, env, ms, cond, max) {
    for (let i = 0; i < max && cond(); i++) step(s, env, ms);
  }
  const logHas = (s, re) => s.log.some((l) => re.test(l.m));
  const logFind = (s, re) => (s.log.find((l) => re.test(l.m)) || {}).m;
  const heldAll = (s, key) => S.haveQty(s, key);

  // Records every hunt:fx with the hunt as it stood at that moment.
  async function arena(opts = {}) {
    const w = await listening({ fx: true, ...opts });
    const fx = [];
    w.emitter.on("hunt:fx", (p) => {
      const c = p.state.tasks.combat;
      fx.push({ who: p.who, kind: p.kind, amount: p.amount, at: p.at, t: c ? c.elapsed : null, clock: c ? c.clock : null, veil: c ? Math.round(c.veil) : null, enc: c ? c.encounters : null, first: c && c.foes[0] ? c.foes[0].uid : null, c, foes: c ? c.foes.map((f) => ({ ...f })) : [] });
    });
    return { ...w, fx };
  }

  /* ================= STATS AND DATA ================= */
  section("Starting stats and gear");
  {
    const naked = St.combatStats({ level: 1, klass: null, equipment: {} });
    check("Level 1: Attack 1, Defence 0, Health 25, no Veil, 2.4s swing",
      naked.maxHp === 25 && naked.attack === 1 && naked.defence === 0 && naked.veilGain + naked.absorb === 0 && naked.speed === 2400, naked);
    const d = (k) => I.itemDef(k);
    check("Tier 1 Common: weapon +1 Attack, offhand 1, neck +1 Attack, ring +1 Defence",
      d("slag_sword|common").attack === 1 && d("bitter_shield|common").defence === 1 && d("mud_grimoire|common").attack === 1 && d("mud_amulet|common").attack === 1 && d("slag_ring|common").defence === 1);
    check("Tier 1 Common armour: head +1, chest +2, hands +1, feet +1 Health",
      d("slag_helm|common").health === 1 && d("slag_chest|common").health === 2 && d("slag_hgaunts|common").health === 1 && d("slag_hboots|common").health === 1);
    const rar = [d("starfall_sword|common").attack, d("starfall_sword|rare|1").attack, d("starfall_sword|legendary|2").attack];
    check("Rarity raises gear stats", rar[0] < rar[1] && rar[1] < rar[2], rar);
    const maxes = ["warrior", "rogue", "mage", null].map((k) => St.combatStats({ level: 99, klass: k, equipment: gearSet(GameData, 9, "light", "relic") }).maxHp);
    check("Nobody passes 5,000 health, even at Hunt 99 in a Relic tier-9 set", maxes.every((h) => h <= 5000) && Math.max(...maxes) > 3500, maxes);
    const veil = [5, 20, 40, 60, 80, 99].map((L) => CONFIG.veilPerBlow(L));
    check("Rogue Veil a blow: Lv5 10, Lv20 12, Lv40 16, Lv60 20, Lv80+ 25", veil.join(",") === "10,12,16,20,25,25", veil);
    check("Tier-9 Relic weapons carry a Rogue to 33 a blow at Lv80", St.combatStats({ level: 80, klass: "rogue", equipment: gearSet(GameData, 9, "rogue", "relic") }).veilGain === 33);
    const mit = [St.mitigation(0, 1), St.mitigation(5, 1), St.mitigation(10, 1), St.mitigation(1e9, 1), St.mitigation(10, 5)];
    check("Defence mitigates by ratio, grows with Defence, caps at 80%, and weakens on harder ground",
      mit[0] === 0 && mit[1] > 0 && mit[2] > mit[1] && mit[3] === 0.8 && mit[4] < mit[2], mit);
  }

  section("Zones, foes and economy");
  {
    const zones = GameData.ZONES.map((z) => [z.id, z.windowMs, z.power, z.sizes.map((x) => x[0]).join("/")]);
    same("Four zones: Outer 60s, Middle 50s, Inner 40s, Core 30s, and power climbing to 1.4 at the Core",
      zones, [["outer", 60000, 1, "1/2"], ["middle", 50000, 1.15, "1/2"], ["inner", 40000, 1.27, "2/3"], ["core", 30000, 1.4, "3"]]);
    const t1stalker = foeOf(1, "stalker");
    const scaled = GameData.ZONES.map((z) => Cb.foeNumbers(t1stalker, false, z.power));
    check("Power scales a foe's health and damage with depth, and leaves its XP, gold and Threat alone",
      scaled.every((n, i) => n.hp === Math.round(t1stalker.hp * GameData.ZONES[i].power) && Math.abs(n.attack - t1stalker.attack * GameData.ZONES[i].power) < 1e-12) &&
      new Set(scaled.map((n) => `${n.xp}|${n.threat}|${n.gold.join()}`)).size === 1, scaled.map((n) => [n.hp, n.xp, n.threat]));
    const t1 = ["skirmisher", "stalker", "brute"].map((a) => foeOf(1, a));
    check("Ashen Verge: Carrion Rat, Ash Stalker, Ash Brute", t1.map((m) => m.name).join(",") === "Carrion Rat,Ash Stalker,Ash Brute");
    check("Skirmisher 2.0s, Stalker 2.4s, Brute 3.0s", t1.map((m) => m.speed).join(",") === "2000,2400,3000");
    check("Threat a kill: 1, 2, 3, and 3, 4, 5 as Elites", t1.map((m) => m.threat).join(",") === "1,2,3" && t1.map((m) => Cb.foeNumbers(m, true).threat).join(",") === "3,4,5");
    check("Every region has three foes and a Sovereign", GameData.REGIONS.every((r) => ["skirmisher", "stalker", "brute"].every((a) => foeOf(r.tier, a)) && sovereignOf(r.tier)));
    check("foeTitle", Cb.foeTitle(t1[1]) === "The Ash Stalker" && Cb.foeTitle(sovereignOf(1)) === "The Ashen Warden" && Cb.foeTitle(sovereignOf(9)) === "What Feeds The Roots");
  }

  /* ================= THE ENGINE ================= */
  section("Timers, targeting, stagger");
  {
    const s = hunter(11);
    const a = await arena();
    const c = hunt(s, 1, "core");
    stepWhile(s, a.env, 100, () => c.encounters < 1, 100);
    const size = c.foes.length;
    const openTimers = c.foes.map((f) => Math.round(f.timer));
    for (let i = 0; i < 200; i++) step(s, a.env, 100);
    const swings = a.fx.filter((e) => e.who !== "you" && (e.kind === "hit" || e.kind === "crit"));
    const gaps = swings.slice(1).map((e, i) => Math.round(e.t - swings[i].t));
    check("Core encounters walk in with three foes", size === 3, size);
    check("Foes open on staggered timers", new Set(openTimers).size === openTimers.length, openTimers);
    check("Your swings land every 2.4s on your own timer", gaps.length >= 7 && gaps.every((g) => g === 2400), gaps);
    check("You always strike the first foe still standing", swings.every((e) => e.first === e.who));
    // A foe that just swung has its timer freshly wound back up to its speed.
    const foeGaps = {};
    a.fx.filter((e) => e.who === "you" && ["glance", "hurt", "ambushed", "block"].includes(e.kind)).forEach((e) => {
      const f = e.foes.find((x) => Math.abs(x.timer - getMonster(x.id).speed) < 1e-3);
      if (f) (foeGaps[f.uid] = foeGaps[f.uid] || []).push({ t: e.t, speed: getMonster(f.id).speed });
    });
    const perFoe = Object.values(foeGaps).map((list) => ({ speed: list[0].speed, gaps: list.slice(1).map((x, i) => Math.round(x.t - list[i].t)) }));
    check("Each foe swings on its own timer, at its own speed", perFoe.length >= 3 && perFoe.every((f) => f.gaps.length && f.gaps.every((g) => g === f.speed)), perFoe);
    check("nextHuntDue: the fight's next event", Cb.nextHuntDue(s) >= 0 && Cb.nextHuntDue(s) <= 3000 && Cb.nextHuntDue(hunter(1)) === Infinity);
  }

  section("Encounter windows and reinforcements");
  {
    const s = hunter(5, { level: 60, equipment: gearSet(GameData, 3, "warrior") });
    const a = await arena();
    const c = hunt(s, 1, "outer");
    check("a new hunt's next event is the walk in", Cb.nextHuntDue(s) === 3000);
    stepWhile(s, a.env, 50, () => c.phase !== "fight", 100);
    stepWhile(s, a.env, 50, () => c.phase === "fight", 5000);
    const early = { clock: Math.round(c.clock), wait: Math.round(c.wait), phase: c.phase };
    check("Cleared early, the rest of the window is the walk to the next encounter", early.phase === "search" && Math.abs(early.wait - Math.max(3000, 60000 - early.clock)) <= 50, early);
  }
  {
    // Tough enough to outlast the fight, too weak to end it, and remedies to spare.
    // The first hunt stream whose opening encounter leaves room for a reinforcement.
    let s;
    let a;
    let c;
    for (let seed = 9; seed < 60; seed++) {
      // Tier 9 light armour: thousands of health and no Defence, so a tier 9 blow always lands.
      s = hunter(seed, { equipment: gearSet(GameData, 9, "light", "relic") });
      s.equipment.neck = null;
      s.equipment.ring = null;
      put(s, "satchel", "provision_t9", 500);
      a = await arena();
      c = hunt(s, 9, "inner");
      stepWhile(s, a.env, 50, () => c.phase !== "fight", 100);
      if (c.foes.length < 3) break;
    }
    let maxSeen = 0;
    for (let i = 0; i < 3000 && c.phase === "fight" && s.tasks.combat; i++) {
      step(s, a.env, 100);
      maxSeen = Math.max(maxSeen, c.foes.length);
    }
    const joins = a.fx.filter((e) => e.kind === "join").map((e) => ({ at: Math.round(e.clock), count: e.foes.length, timer: Math.round(e.foes[e.foes.length - 1].timer) }));
    const win = GameData.ZONES.find((z) => z.id === "inner").windowMs;
    check("Past the window a reinforcement joins, at 40s, 80s ... in the Inner", joins.length >= 1 && joins.every((j) => j.at % win < 100 || j.at % win > win - 100), joins);
    check("A reinforcement has the initiative: it swings within a second", joins.every((j) => j.timer <= 700), joins);
    check("Never more than three foes at once", maxSeen === 3, maxSeen);
    check("A reinforcement's first blow is an ambush", a.fx.some((e) => e.kind === "ambushed"));
  }

  section("Disciplines");
  {
    const s = hunter(3, { level: 5, klass: "warrior" });
    const a = await arena();
    hunt(s, 1, "core");
    for (let i = 0; i < 600; i++) step(s, a.env, 100);
    const log = a.fx.filter((e) => e.who !== "you" || ["glance", "hurt", "ambushed"].includes(e.kind));
    const strike = log.find((e) => e.kind === "strike");
    const before = log.filter((e) => strike && e.t <= strike.t);
    const steps = [...new Set(before.map((e, i) => (i ? [e.veil - before[i - 1].veil, e.veil] : [e.veil, e.veil])).filter(([dv, v]) => dv > 0 && v < 100).map(([dv]) => dv))].sort((x, y) => x - y);
    check("Warrior: Veil +10 a blow and +5 a blow aimed at it at Hunt 5, Devastating Strike when full",
      St.statsOf(s).veilGain === 10 && !!strike && steps.length > 0 && steps.every((x) => x % 5 === 0) && steps.includes(5) && steps.includes(10), { steps, strike: !!strike });
  }
  {
    const s = hunter(4, { level: 30, klass: "rogue", equipment: gearSet(GameData, 3, "rogue") });
    const a = await arena();
    hunt(s, 1, "outer");
    for (let i = 0; i < 2400; i++) step(s, a.env, 100);
    const firsts = {};
    a.fx.filter((e) => e.who !== "you" && ["hit", "crit", "ambush"].includes(e.kind)).forEach((e) => { if (!firsts[e.enc]) firsts[e.enc] = e.kind; });
    check("Rogue: every walked-into encounter opens on an Ambush", Object.values(firsts).length >= 2 && Object.values(firsts).every((k) => k === "ambush"), firsts);
    const hurt = a.fx.filter((e) => e.who === "you");
    const fromHits = hurt.some((e, i) => i && e.veil > hurt[i - 1].veil && !a.fx.some((x) => x.who !== "you" && x.t > hurt[i - 1].t && x.t <= e.t));
    check("Rogue: Veil builds from its own blows, never from being hit", !fromHits);
  }
  {
    const s = hunter(5, { level: 5, klass: "mage" });
    const a = await arena();
    hunt(s, 1, "core");
    for (let i = 0; i < 1300; i++) step(s, a.env, 100);
    const enc1 = a.fx.filter((e) => e.enc === 1 && e.who !== "you" && ["hit", "crit", "volley", "empowered"].includes(e.kind));
    const moments = [...new Set(enc1.filter((e) => e.kind === "volley").map((e) => e.t))].sort((x, y) => x - y);
    const gaps = moments.slice(0, 3).map((t, i, arr) => (i ? Math.round(t - arr[i - 1]) : 0));
    const after = enc1.filter((e) => e.kind !== "volley");
    check("Mage: three empowered casts open the encounter, 450ms apart, then the Veil is empty",
      gaps.length === 3 && gaps[1] === 450 && gaps[2] === 450 && after.length > 0 && after[0].veil < 10, { gaps, veil: after[0] && after[0].veil });
    const emp = a.fx.filter((e) => e.kind === "empowered");
    check("Mage: the Veil refills at 2 a second and a full Veil gives one empowered cast",
      St.statsOf(s).absorb === 2 && (emp.length === 0 || emp[0].clock >= 50000), emp[0] && emp[0].clock);
  }

  section("Threat, Sovereigns and hiding");
  {
    const s = hunter(21, { level: 99, klass: "warrior", equipment: gearSet(GameData, 9, "warrior", "relic") });
    // Threat is region-wide: keyed by tier alone, whatever zone you stand in.
    s.threat["1"] = 99;
    const a = await arena();
    const c = hunt(s, 1, "core");
    stepWhile(s, a.env, 100, () => c.kind !== "sovereign" && !!s.tasks.combat, 20000);
    const party = c.foes.map((f) => getMonster(f.id).archetype);
    check("Threat at 100 in the Core brings its Sovereign with two Elite escorts",
      party.filter((x) => x === "sovereign").length === 1 && party.length === 3 && c.foes.filter((f) => getMonster(f.id).archetype !== "sovereign").every((f) => f.elite), party);
    check("hunt:sovereign announced, a toast and no log line", a.of("hunt:sovereign").length === 1 && a.of("hunt:sovereign")[0].monsterId === "mob_t1_sovereign" && !logHas(s, /comes up out of the dark/));
    const uidBefore = c.uid;
    const hold = c.foes.find((f) => getMonster(f.id).archetype === "sovereign");
    hold.hp = hold.max = 1e9;
    for (let i = 0; i < 700; i++) {
      step(s, a.env, 100);
      s.player.hp = St.maxHp(s);
    }
    check("Sovereign fights take no reinforcements and grow angrier every 30s", c.enrage === 2 && c.uid === uidBefore, { enrage: c.enrage });
    hold.hp = 1;
    stepWhile(s, a.env, 100, () => c.kind === "sovereign", 2000);
    const felled = a.of("hunt:felled")[0];
    const epic = S.POOLS.flatMap((w) => Object.keys(s[w].items)).find((k) => I.parseKey(k).rarity === "epic");
    check("Felling a Sovereign pays an Epic piece, counts it, clears Threat and logs how long it took",
      Cb.threatIn(s, 1, "core") === 0 && s.stats.bosses === 1 && !!epic && logHas(s, /^The Ashen Warden fell after \d+m \d+s\. It left Epic /), { threat: Cb.threatIn(s, 1, "core"), bosses: s.stats.bosses, epic });
    check("The piece's uid comes from the Sovereign counter", !!felled && felled.key === epic && I.parseKey(epic).uid === "s1.0" && s.rolls["s:1"] === 1 && I.validKey(epic), felled);
    check("Its drops are certain", heldAll(s, "mangy_flay") >= 3 && heldAll(s, "slag_delve") >= 3 && heldAll(s, "mud_dredge") >= 2);
  }
  {
    const s = hunter(22, { level: 99, equipment: gearSet(GameData, 9, "warrior", "relic") });
    s.settings.hideSovereign = true;
    s.threat["1"] = 99;
    const a = await arena();
    const c = hunt(s, 1, "middle");
    stepWhile(s, a.env, 100, () => c.phase !== "hide", 20000);
    /* The line itself is only matched as far as the ground it names: chronicle.js and
       listeners.js both still promise five minutes, which is no longer what the hide
       is. Pinning either wording here would cement one of them, so the length is
       asserted off the hunt instead, where it is true. */
    check("Hide ticked: Threat peaks and you go to ground for an hour, and it goes on the log",
      c.phase === "hide" && Math.round(c.wait) > H.hideMs - 5000 && H.hideMs === 3600000 && logHas(s, /^Threat peaked in the Middle of The Ashen Verge\. You went to ground/), { wait: Math.round(c.wait) });
    check("Going to ground clears nothing yet: the region is as hot as it was until the hour is sat out",
      Cb.threatIn(s, 1, "middle") >= H.threatCap - 1e-6, Cb.threatIn(s, 1, "middle"));
    check("hunt:hide carries the ground", a.of("hunt:hide").length === 1 && a.of("hunt:hide")[0].tier === 1 && a.of("hunt:hide")[0].zone === "middle");
    const kills = c.done;
    // Just short of the hour: still hidden, still hot, still not hunting.
    for (let i = 0; i < 35990; i++) step(s, a.env, 100);
    const still = c.phase === "hide" && c.done === kills && Cb.threatIn(s, 1, "middle") >= H.threatCap - 1e-6;
    let atLeaving = null;
    for (let i = 0; i < 200 && atLeaving === null; i++) {
      step(s, a.env, 100);
      if (c.phase !== "hide") atLeaving = Cb.threatIn(s, 1, "middle");
    }
    for (let i = 0; i < 600; i++) step(s, a.env, 100);
    check("No hunting while hidden, and the hunt picks itself back up after", still && atLeaving !== null && c.done > kills, { still, phase: c.phase, kills: c.done - kills });
    check("Sitting the hour out is the other thing that clears Threat", atLeaving === 0, atLeaving);
  }
  {
    // Outer, and the Sovereign doesn't come: find a hunt stream where the roll fails.
    let passed = null;
    for (let seed = 1; seed < 40 && !passed; seed++) {
      const s = hunter(seed, { level: 99, equipment: gearSet(GameData, 9, "warrior", "relic") });
      s.threat["1"] = 99;
      const a = await arena();
      const c = hunt(s, 1, "outer");
      stepWhile(s, a.env, 100, () => !a.of("hunt:passed").length && !c.sovereignNext && c.kind !== "sovereign", 3000);
      if (a.of("hunt:passed").length) passed = { threat: Cb.threatIn(s, 1, "outer"), next: c.sovereignNext, line: logFind(s, /did not find you/), event: a.of("hunt:passed")[0] };
    }
    check("Outer: when the Sovereign doesn't come, the region stays at its peak and the log says so",
      !!passed && passed.threat >= H.threatCap - 1e-6 && !passed.next && passed.line === "Something vast moved through the Outer of The Ashen Verge and did not find you." && passed.event.zone === "outer", passed);
  }
  {
    const s = hunter(31);
    const a = await arena();
    const c = hunt(s, 2, "outer");
    c.sovereignNext = true;
    stepWhile(s, a.env, 100, () => c.kind !== "sovereign", 1000);
    stepWhile(s, a.env, 100, () => !!s.tasks.combat && c.kind === "sovereign", 20000);
    const share = s.player.hp / St.maxHp(s);
    check("Brought low by a Sovereign, you break away and the hunt goes on",
      !!s.tasks.combat && c.phase === "search" && share <= 0.25 && share > 0 && logHas(s, /^You broke away from The Drowned Bailiff after \d+/), { share, phase: c.phase });
    check("hunt:retreat carries the Sovereign and the fight's length", a.of("hunt:retreat").length === 1 && a.of("hunt:retreat")[0].monsterId === "mob_t2_sovereign" && Number.isInteger(a.of("hunt:retreat")[0].fightMs));
  }
  {
    const s = hunter(40, { level: 30, equipment: gearSet(GameData, 3, "warrior") });
    s.threat["1"] = 100;
    const a = await arena();
    const c = hunt(s, 1, "core");
    c.sovereignNext = true;
    c.wait = 3000;
    s.settings.hideSovereign = true;
    step(s, a.env, 3500);
    check("Hide ticked after the Sovereign set out still sends you to ground, with the region still hot",
      c.phase === "hide" && !c.foes.some((f) => getMonster(f.id).archetype === "sovereign") && Cb.threatIn(s, 1, "core") === 100 && logHas(s, /went to ground/), { phase: c.phase, threat: Cb.threatIn(s, 1, "core") });
  }
  {
    const s = hunter(41);
    s.equipment.chest = "slag_chest|relic|5|thorned";
    const c = hunt(s, 9, "outer");
    c.phase = "fight";
    c.kind = "sovereign";
    c.enrageAt = 30000;
    c.swing = 5000;
    const sov = sovereignOf(9);
    c.foes = [{ uid: 1, id: sov.id, elite: false, hp: 1, max: sov.hp, ambush: false, timer: 0, bleed: 0, bleedTimer: 0 }];
    c.uid = 2;
    s.player.hp = St.maxHp(s) * 0.26;
    const a = await arena();
    step(s, a.env, 1);
    check("A thorns kill counts before a retreat on the same blow", s.stats.bosses === 1 && s.stats.kills === 1 && !logHas(s, /broke away/), { bosses: s.stats.bosses, kills: s.stats.kills });
  }
  {
    const s = hunter(42);
    s.threat["9"] = 100;
    const a = await arena();
    const c = hunt(s, 9, "core");
    c.sovereignNext = true;
    stepWhile(s, a.env, 250, () => !!s.tasks.combat, 1000);
    const fell = a.of("hunt:death")[0] || {};
    check("Falling in a Sovereign's fight is no shortcut: the region keeps its Threat", s.stats.deaths === 1 && Cb.threatIn(s, 9, "core") === 100, Cb.threatIn(s, 9, "core"));
    // The wound runs from the moment you are back up, so the five minutes down and the ten minutes weak don't overlap.
    check("A death is counted against the foe that dealt it and leaves a wound on every combat number",
      s.foeDeaths[fell.monsterId] === 1 && Object.keys(s.foeDeaths).length === 1 && !!s.debuff && s.debuff.mult === 1 - H.deathDebuff &&
      s.debuff.until === fell.at + H.recoveryMs + H.deathDebuffMs && St.deathPenalty(s) === 1 - H.deathDebuff, { fell, foeDeaths: s.foeDeaths, debuff: s.debuff });
    const whole = St.combatStats({ level: 1, klass: null, equipment: {} });
    const hurt = St.statsOf(s);
    check("and the wound is off the stat sheet too, until it runs out",
      hurt.maxHp === Math.round(whole.maxHp * (1 - H.deathDebuff)) && hurt.attack < whole.attack && hurt.wounded === 1 - H.deathDebuff &&
      St.deathPenalty(s, s.debuff.until) === 1 && St.statsOf(s, s.debuff.until).maxHp === whole.maxHp, { hurt: hurt.maxHp, whole: whole.maxHp });
  }
  {
    const s = hunter(43);
    s.equipment.chest = "starfall_chest|common";
    s.player.hp = St.maxHp(s);
    const full = s.player.hp;
    s.equipment.chest = null;
    const a = await arena();
    step(s, a.env, 60);
    check("Taking armour off pulls health down to the new most", full > St.maxHp(s) && s.player.hp === St.maxHp(s));
  }

  /* ================= ENDINGS ================= */
  section("Death, limits, the cap, pulling back");
  {
    const s = hunter(41);
    s.equipment.weapon = "slag_sword|common";
    const a = await arena();
    check("startHunt from camp", applyCommand(s, { type: "startHunt", args: { tier: 9, zone: "core", limit: null } }, a.env).ok);
    stepWhile(s, a.env, 250, () => !!s.tasks.combat, 10000);
    const death = a.of("hunt:death")[0];
    check("Death: the foe's name and how long the hunt lasted go on the log",
      /^The .+ put you down after \d+(s|m \d+s) on the hunt\. Recovering for five minutes\.$/.test(s.log[s.log.length - 1].m), s.log[s.log.length - 1].m);
    check("Death: recovery starts when you fell, counted to the end of that stretch",
      !!death && s.player.recoveryLeft === H.recoveryMs - (s.clock - death.at), { left: s.player.recoveryLeft, since: death && s.clock - death.at });
    const refused = applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "outer", limit: null } }, a.env);
    check("Death: you come round on one point of health, and the gate is open",
      s.stats.deaths === 1 && s.player.hp === 1 && refused.ok);
    const r0 = s.player.recoveryLeft;
    step(s, a.env, 120000);
    const partway = s.player.recoveryLeft;
    step(s, a.env, 180000);
    check("Recovery counts down in game time", partway === r0 - 120000 && s.player.recoveryLeft === 0 && !St.recovering(s), [partway, s.player.recoveryLeft]);
    check("hunt:death payload", Number.isInteger(death.elapsedMs) && /^mob_t9_/.test(death.monsterId));
  }
  {
    const s = hunter(42, { level: 40, equipment: gearSet(GameData, 3, "warrior") });
    const a = await arena();
    applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "outer", limit: 3 } }, a.env);
    stepWhile(s, a.env, 250, () => !!s.tasks.combat, 20000);
    const ended = a.of("hunt:ended")[0];
    check("A 3-kill hunt stops at three and says how long it took", s.stats.kills === 3 && logHas(s, /^Hunt finished: 3 kills in /) && ended.reason === "limit" && ended.kills === 3);
  }
  {
    const s = hunter(43, { level: 40, equipment: gearSet(GameData, 3, "warrior") });
    const a = await arena();
    applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "outer", limit: null } }, a.env);
    s.tasks.combat.elapsed = CAP - 500;
    step(s, a.env, 1000);
    check("Twelve hours on the hunt ends it, with a log line", s.tasks.combat === null && logHas(s, /^Twelve hours on the hunt and \d+ kills\. You make for camp\.$/) && a.of("hunt:ended")[0].reason === "cap");
  }
  {
    const s = hunter(44);
    const a = await arena();
    applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "outer", limit: null } }, a.env);
    step(s, a.env, 20000);
    check("Pull back is immediate", applyCommand(s, { type: "pullBack", args: {} }, a.env).ok && s.tasks.combat === null);
    applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "outer", limit: null } }, a.env);
    const c = s.tasks.combat;
    step(s, a.env, 30000);
    const id = c.id;
    applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "outer", limit: 50 } }, a.env);
    check("The same ground again keeps the fight and restarts the count", s.tasks.combat === c && c.id === id && c.elapsed === 0 && c.done === 0 && c.limit === 50 && c.startedAt === s.clock);
  }

  section("Back at camp: the walk and the rest are still owed");
  const start = (s, zone = "outer", limit = null, env) => applyCommand(s, { type: "startHunt", args: { tier: 1, zone, limit } }, env).ok;
  const back = (s, env) => applyCommand(s, { type: "pullBack", args: {} }, env).ok;
  // Out of an encounter with most of the walk to the next one ahead, at half health. No discipline, no Veil.
  const walking = async (seed) => {
    const s = hunter(seed, { level: 40, equipment: gearSet(GameData, 3, "warrior") });
    const a = await arena();
    start(s, "outer", null, a.env);
    stepWhile(s, a.env, 100, () => !(s.tasks.combat.encounters >= 1 && s.tasks.combat.phase === "search" && s.tasks.combat.wait > 20000), 20000);
    s.player.hp = Math.floor(St.maxHp(s) / 2);
    return { s, a };
  };
  // Milliseconds until the hunt next walks into a fight.
  const untilFight = (s) => {
    const from = s.clock;
    for (let i = 0; i < 1000 && s.tasks.combat && s.tasks.combat.phase !== "fight"; i++) advance(s, s.clock + Math.max(1, Math.floor(Cb.nextHuntDue(s))));
    return s.clock - from;
  };
  {
    const { s, a } = await walking(81);
    const twin = clone(s);
    const wait = s.tasks.combat.wait;
    const half = s.player.hp;
    check("set up: out of an encounter, a long walk ahead, half health", wait > 20000 && half === Math.floor(St.maxHp(s) / 2), { wait, half });
    back(s, a.env);
    same("Pulling back leaves the camp a note: when, the health you came back with, when the walk would have ended",
      s.player.camp, { since: s.clock, hp: half, walkUntil: s.clock + wait });
    start(s, "outer", null, a.env);
    check("Setting straight out again: the same walk still ahead, the same health, the note used up",
      Math.abs(s.tasks.combat.wait - wait) < 1e-3 && s.player.hp === half && s.player.camp === null, { wait: s.tasks.combat.wait, hp: s.player.hp });
    same("and the next fight comes when it would have without pulling back", untilFight(s), untilFight(twin));
  }
  {
    const { s, a } = await walking(82);
    const most = St.maxHp(s);
    s.player.hp = Math.floor(most * 0.2);
    const wait = s.tasks.combat.wait;
    back(s, a.env);
    step(s, a.env, 30000);
    const plan = Cb.campPlan(s);
    // Times are absolute milliseconds, so a walk read back off the note is exact to a thousandth of one.
    same("Resting at camp: a fifth of your most a minute, and the walk runs down while you rest",
      plan, { hp: Math.floor(most * 0.2) + most * 30000 / H.recoveryMs, maxHp: most, walkMs: Math.max(H.searchMinMs, wait - 30000) }, 1e-6);
    start(s, "outer", null, a.env);
    check("and that is what the hunt sets out with", s.player.hp === plan.hp && s.tasks.combat.wait === plan.walkMs, { hp: s.player.hp, wait: s.tasks.combat.wait });
    back(s, a.env);
    step(s, a.env, H.recoveryMs);
    same("Five minutes at camp and you are whole, after the shortest walk", Cb.campPlan(s), { hp: most, maxHp: most, walkMs: H.searchMinMs });
    check("campPlan is for camp: null while a hunt is out", (start(s, "outer", null, a.env), Cb.campPlan(s) === null && s.player.hp === most));
  }
  {
    const s = hunter(83, { level: 40, equipment: gearSet(GameData, 3, "warrior") });
    const a = await arena();
    start(s, "outer", null, a.env);
    stepWhile(s, a.env, 50, () => !(s.tasks.combat.phase === "fight" && s.tasks.combat.clock > 500), 2000);
    const c = s.tasks.combat;
    const left = 60000 - c.clock;
    back(s, a.env);
    check("A fight broken off owes the rest of the zone's window", c.phase === "fight" && Math.abs(s.player.camp.walkUntil - (s.clock + left)) < 1e-6, { clock: c.clock, note: s.player.camp });
    start(s, "outer", null, a.env);
    check("and the hunt set out again walks it", Math.abs(s.tasks.combat.wait - left) < 1e-3 && s.tasks.combat.phase === "search");
    stepWhile(s, a.env, 50, () => s.tasks.combat.phase !== "fight", 4000);
    s.tasks.combat.clock = 59000;
    back(s, a.env);
    check("A fight past its window still owes the shortest walk", s.player.camp.walkUntil === s.clock + H.searchMinMs);
  }
  {
    const s = hunter(84, { level: 60, equipment: gearSet(GameData, 5, "warrior") });
    const a = await arena();
    start(s, "outer", 1, a.env);
    stepWhile(s, a.env, 250, () => !!s.tasks.combat, 4000);
    const ended = a.of("hunt:ended")[0];
    const kill = a.fx.filter((e) => e.kind === "kill").pop();
    const note = s.player.camp;
    check("A hunt that reaches its limit leaves the same note, dated when it ended",
      !!ended && ended.reason === "limit" && !!note && note.since === ended.at && note.hp === s.player.hp && note.walkUntil === ended.at + Math.max(H.searchMinMs, 60000 - kill.clock), { note, ended, killClock: kill && kill.clock });
    const clock = s.clock;
    start(s, "outer", 1, a.env);
    check("so a one-kill hunt set out again still walks the window (the old way was three seconds and full health)",
      s.tasks.combat.wait === Math.max(H.searchMinMs, note.walkUntil - clock) && s.tasks.combat.wait > H.searchMinMs &&
      s.player.hp === Math.min(St.maxHp(s), note.hp + St.maxHp(s) * (clock - note.since) / H.recoveryMs), { wait: s.tasks.combat.wait, hp: s.player.hp });
  }
  {
    const { s, a } = await walking(85);
    const c = s.tasks.combat;
    const wait = c.wait;
    c.elapsed = CAP - 1000;
    c.nextMark = (Math.floor(c.elapsed / H.rateMarkMs) + 1) * H.rateMarkMs;
    step(s, a.env, 2000);
    const ended = a.of("hunt:ended")[0];
    check("Twelve hours up: the note is taken when the cap came, with the walk left then",
      !!ended && ended.reason === "cap" && s.player.camp.since === ended.at && Math.abs(s.player.camp.walkUntil - (ended.at + wait - 1000)) < 1e-3, { note: s.player.camp, ended, wait });
  }
  {
    const { s, a } = await walking(86);
    const half = s.player.hp;
    const wait = s.tasks.combat.wait;
    start(s, "middle", null, a.env);
    check("Moving ground keeps your health and the walk left, and leaves no note", s.tasks.combat.zone === "middle" && s.player.hp === half && s.tasks.combat.wait === wait && s.player.camp === null);
    stepWhile(s, a.env, 50, () => !(s.tasks.combat.phase === "fight" && s.tasks.combat.clock > 500), 3000);
    const left = GameData.ZONES.find((z) => z.id === "middle").windowMs - s.tasks.combat.clock;
    start(s, "inner", null, a.env);
    check("Moving ground mid-fight owes the window left on the old ground", Math.abs(s.tasks.combat.wait - Math.max(H.searchMinMs, left)) < 1e-6, { wait: s.tasks.combat.wait, left });
  }
  {
    const { s, a } = await walking(87);
    back(s, a.env);
    const note = clone(s.player.camp);
    const before = clone(s);
    same("Pulling back with no hunt out changes nothing, the note included", [back(s, a.env), s], [true, before]);
    applyCommand(s, { type: "startHunt", args: { tier: 9, zone: "core", limit: null } }, a.env);
    check("set up: a hunt set out from the note", s.player.hp === note.hp && s.player.camp === null);
    stepWhile(s, a.env, 250, () => !!s.tasks.combat, 20000);
    check("A fall leaves no note", s.stats.deaths === 1 && s.player.camp === null && s.player.hp === St.maxHp(s));
    step(s, a.env, H.recoveryMs);
    start(s, "outer", null, a.env);
    check("so after the recovery you set out whole, after the shortest walk", s.player.hp === St.maxHp(s) && s.tasks.combat.wait === H.searchMinMs);
  }
  {
    // The reported trick: pull back and set out again the moment an encounter ends. It must win nothing.
    const make = () => hunter(88, { level: 30, equipment: gearSet(GameData, 2, "warrior") });
    const plain = make();
    const cycled = make();
    start(plain);
    start(cycled);
    let cycles = 0;
    for (let t = 0; t < 3600000; t += 500) {
      advance(plain, T0 + t + 500);
      advance(cycled, T0 + t + 500);
      const c = cycled.tasks.combat;
      if (c && c.phase === "search" && c.wait > H.searchMinMs && c.encounters > 0) {
        back(cycled);
        start(cycled);
        cycles++;
      }
    }
    const outcome = (s) => ({ kills: s.stats.kills, gold: s.player.gold, xp: s.skills.warfare, hp: s.player.hp, deaths: s.stats.deaths, stream: s.rng.hunt, held: S.heldEverywhere(s) });
    check("set up: an hour of it, pulling back after every encounter", cycles > 40 && plain.stats.kills > 40, { cycles, kills: plain.stats.kills });
    same("Pulling back after every encounter and setting straight out: the same hour, kill for kill and coin for coin", outcome(cycled), outcome(plain));
  }

  section("One hunt stream");
  {
    const s = hunter(91, { level: 40, equipment: gearSet(GameData, 3, "warrior") });
    const a = await arena();
    const { hashString } = await shared("rng.js");
    check("A new save's hunt stream comes from its seed", s.rng.hunt === hashString("91:hunt"));
    start(s, "outer", null, a.env);
    check("Setting out draws nothing and seeds nothing; the hunt keeps no stream of its own", s.rng.hunt === hashString("91:hunt") && !("rng" in s.tasks.combat));
    step(s, a.env, 120000);
    const drawn = s.rng.hunt;
    back(s, a.env);
    start(s, "middle", null, a.env);
    check("Pulling back and setting out again carry the stream on where it stood", drawn !== hashString("91:hunt") && s.rng.hunt === drawn);
    applyCommand(s, { type: "startHunt", args: { tier: 9, zone: "core", limit: null } }, a.env);
    let atFall = null;
    a.emitter.on("hunt:death", (p) => { atFall = p.state.rng.hunt; });
    stepWhile(s, a.env, 250, () => !!s.tasks.combat, 20000);
    step(s, a.env, H.recoveryMs);
    start(s, "outer", null, a.env);
    check("and a fall does not reset it", s.stats.deaths === 1 && atFall !== null && s.rng.hunt === atFall);
  }
  {
    // Free commands between hunts used to pick the next fight's dice. They don't any more.
    const make = () => {
      const s = hunter(92, { level: 40, equipment: gearSet(GameData, 3, "warrior") });
      s.player.gold = 5000;
      return s;
    };
    const plain = make();
    const fished = make();
    const wp = await arena();
    const wf = await arena();
    for (let i = 0; i < 3; i++) {
      applyCommand(fished, { type: "startSkill", args: { skillId: "delving", actionId: "delving_t1_raw", limit: null } }, wf.env);
      applyCommand(fished, { type: "stopSkill", args: {} }, wf.env);
    }
    applyCommand(fished, { type: "hireAgent", args: {} }, wf.env);
    applyCommand(fished, { type: "hireAgent", args: {} }, wf.env);
    check("set up: startSkill and hireAgent moved the serial and the world stream", fished.serial === plain.serial + 5 && fished.rng.world !== plain.rng.world && fished.agents.length === 2);
    start(plain, "inner", null, wp.env);
    start(fished, "inner", null, wf.env);
    advance(plain, T0 + 20 * 60000, wp.env);
    advance(fished, T0 + 20 * 60000, wf.env);
    const blows = (w) => w.fx.map((e) => [e.who, e.kind, e.amount, e.at]);
    check("set up: twenty minutes of fighting", plain.stats.kills > 10 && blows(wp).length > 100, plain.stats.kills);
    same("startSkill and hireAgent before setting out no longer change the fight: blow for blow the same", blows(wf), blows(wp));
    same("and the same kills, health and stream", [fished.stats.kills, fished.skills.warfare, fished.player.hp, fished.rng.hunt], [plain.stats.kills, plain.skills.warfare, plain.player.hp, plain.rng.hunt]);
  }
  {
    const s = hunter(61, { level: 60, klass: "mage", equipment: gearSet(GameData, 7, "mage") });
    const a = await arena();
    applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "core", limit: 2 } }, a.env);
    stepWhile(s, a.env, 100, () => !!s.tasks.combat, 2000);
    check("A splash that kills past the limit still stops the hunt at the limit, once", s.stats.kills === 2 && s.log.filter((l) => /^Hunt finished/.test(l.m)).length === 1, s.stats.kills);
  }
  {
    const s = hunter(62, { level: 20 });
    const a = await arena();
    const c = hunt(s, 1, "outer");
    const e0 = c.elapsed;
    check("huntStep returns dt while the hunt runs", Cb.huntStep(s, 5000, a.env, s.clock) === 5000 && Math.abs(c.elapsed - e0 - 5000) < 1e-6);
    c.elapsed = CAP - 1234;
    check("and the whole-millisecond offset it ended at", Cb.huntStep(s, 5000, a.env, s.clock) === 1234 && s.tasks.combat === null);
  }

  section("XP an hour and damage a second");
  {
    const s = hunter(52, { level: 30, equipment: gearSet(GameData, 3, "warrior") });
    const a = await arena();
    applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "middle", limit: null } }, a.env);
    const c = s.tasks.combat;
    const rates = () => Cb.huntRates(c);
    step(s, a.env, H.rateMinSpanMs - 100);
    check("The rates say nothing while the window is under a second wide", rates().xpRate === null && rates().dps === null, rates());
    step(s, a.env, 200);
    check("and read from a second on, rather than waiting out a mark", rates().xpRate !== null && rates().dps !== null && c.elapsed < H.rateMarkMs, { elapsed: c.elapsed, rates: rates() });
  }
  {
    const s = hunter(51, { level: 30, equipment: gearSet(GameData, 3, "warrior") });
    const a = await arena();
    applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "middle", limit: null } }, a.env);
    const c = s.tasks.combat;
    const rates = () => Cb.huntRates(c);
    const samples = [];
    for (let m = 1; m <= 70; m++) {
      for (let i = 0; i < 60; i++) step(s, a.env, 1000);
      samples.push({ m, rate: rates().xpRate, dps: rates().dps, xp: c.xp, dmg: c.dmg, marks: c.marks.length, from: c.marks[0][0] });
    }
    // Nothing has dropped out of the window yet, so the figures cover the whole run.
    check("XP/hr at five minutes is that stretch scaled to the hour",
      samples[4].from === 0 && samples[4].marks === 31 && Math.abs(samples[4].rate - samples[4].xp * 12) < 1e-6, samples[4]);
    check("XP/hr and DPS are worked out live, so they move between one mark and the next",
      samples[20].rate !== samples[21].rate && samples[20].dps !== samples[21].dps, [samples[20], samples[21]]);
    {
      // Read either side of a single ten-second mark: the figures move, the samples don't.
      const before = { marks: c.marks.length, rate: rates().xpRate, dps: rates().dps };
      step(s, a.env, H.rateMarkMs / 2);
      const after = { marks: c.marks.length, rate: rates().xpRate, dps: rates().dps };
      check("A sample is taken every ten seconds; the figures do not wait for it",
        after.marks === before.marks && after.rate !== before.rate && after.dps !== before.dps, { before, after });
    }
    check("After an hour the window looks back an hour and no further",
      c.marks.length === H.rateWindowMs / H.rateMarkMs + 1 && c.elapsed - c.marks[0][0] <= H.rateWindowMs + H.rateMarkMs, { marks: c.marks.length, span: c.elapsed - c.marks[0][0] });
    const [t0, x0, d0] = c.marks[0];
    same("and both figures are that window's XP and damage, scaled to the hour and the second",
      [rates().xpRate, rates().dps], [((c.xp - x0) * 3600000) / (c.elapsed - t0), ((c.dmg - d0) * 1000) / (c.elapsed - t0)]);
    check("Damage dealt is counted as it lands, and every mark carries its reading",
      c.dmg > 0 && c.marks.every((mk) => mk.length === 3) && d0 > 0 && c.dmg > d0, { dmg: c.dmg, d0 });
    check("The hunt keeps no stored rate of its own any more", !("xpRate" in c) && !("dps" in c));
  }

  /* ================= LOOT ================= */
  section("Loot, wear and remedies");
  {
    const s = hunter(71, { level: 99, klass: "warrior", equipment: gearSet(GameData, 9, "warrior", "relic") });
    const junk = ["coal", "resin", "pulp", "tallow", "veil_shard", "bitter_fell", "stink_harvest", "blood_fell", "mire_delve", "noose_harvest"];
    junk.forEach((k) => put(s, "inv", k, 1));
    put(s, "bank", "mud_dredge", 1);
    const a = await arena();
    applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "outer", limit: null } }, a.env);
    for (let i = 0; i < 60; i++) step(s, a.env, 10000);
    check("Loot goes straight into storage: Belongings full, so the Vault", s.inv.order.join(",") === junk.join(",") && s.vault.items.mangy_flay > 0 && !s.bank.items.mangy_flay);
    check("A stack held in the Stockpile grows where it is", s.bank.items.mud_dredge > 1 && !s.vault.items.mud_dredge);
    const n = s.stats.kills;
    check("Kill counters count every kill", s.rolls["k:1"] === n && Object.keys(s.rolls).filter((k) => k.startsWith("m:")).reduce((x, k) => x + s.rolls[k], 0) === n);
    check("and health never sits above the new most", s.player.hp <= St.maxHp(s));
  }
  {
    const s = hunter(72, { level: 99, equipment: gearSet(GameData, 9, "warrior", "relic") });
    const mats = Object.keys(GameData.MATERIALS).filter((k) => !GameData.MATERIALS[k].heal && !/^(mangy_flay|mud_dredge|slag_delve)$/.test(k));
    let i = 0;
    S.POOLS.forEach((w) => { while (!S.isFull(s, w)) put(s, w, mats[i++], 1); });
    const a = await arena();
    applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "outer", limit: null } }, a.env);
    for (let k = 0; k < 25; k++) step(s, a.env, 60000);
    const lost = a.of("loot:lost");
    check("Nowhere to put loot: the log hears it at most once every ten minutes", lost.length >= 2 && lost.length <= 3 && lost.every((e, j) => !j || e.at - lost[j - 1].at > 600000) && s.log.filter((l) => /Loot is being left where it fell/.test(l.m)).length === lost.length, lost.map((e) => e.at - T0));
    check("with v4's line, the Stockpile named", logHas(s, /^Belongings, the Vault and the Stockpile are full\. Loot is being left where it fell\.$/));
  }
  {
    const s = hunter(73, { level: 99, equipment: gearSet(GameData, 9, "warrior", "relic") });
    s.player.gold = 1000;
    const a = await arena();
    applyCommand(s, { type: "buyCompanion", args: { id: "hound" } }, a.env);
    s.companions.owned.hound.bond = CONFIG.bondXpFor(20);
    let n = 0;
    while (!(roll(s.rng.seed, "k:1", n, SALT.rare) < 0.01)) n++;
    s.rolls["k:1"] = n;
    const rarity = I.fineRarityFromRoll(roll(s.rng.seed, "k:1", n, SALT.rareRarity));
    const pool = Object.values(GameData.GEAR).filter((g) => g.tier === 1);
    const base = pool[Math.floor(roll(s.rng.seed, "k:1", n, SALT.rarePick) * pool.length)].id;
    const prefix = rarity === "relic" ? I.prefixFromRoll(base, roll(s.rng.seed, "k:1", n, SALT.prefix)) : null;
    applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "outer", limit: 1 } }, a.env);
    stepWhile(s, a.env, 1000, () => !!s.tasks.combat, 200);
    const found = a.of("loot:found")[0];
    check("A rare find rolls on the kill counter: rarity, piece, uid", !!found && found.key === I.makeKey(base, rarity, `f1.${n}`, prefix) && S.haveQty(s, found.key) === 1 && I.validKey(found.key), { found, expected: I.makeKey(base, rarity, `f1.${n}`, prefix) });
    check("loot:found is a toast, not a log line", !logHas(s, /Found/));
  }
  {
    const s = hunter(74, { level: 20 });
    put(s, "satchel", "provision_t1", 5);
    put(s, "satchel", "provision_t3", 7);
    put(s, "satchel", "provision_t4", 1);
    const a = await arena();
    const heals = [];
    a.emitter.on("hunt:fx", (p) => {
      if (p.kind === "heal") heals.push(["provision_t4", "provision_t3", "provision_t1"].map((k) => S.qtyIn(p.state, "satchel", k)));
    });
    applyCommand(s, { type: "startHunt", args: { tier: 6, zone: "core", limit: null } }, a.env);
    stepWhile(s, a.env, 1000, () => !!s.tasks.combat, 3000);
    same("Remedies: the best heal in the Satchel first, down to the weakest", heals.slice(0, 13),
      [[0, 7, 5], [0, 6, 5], [0, 5, 5], [0, 4, 5], [0, 3, 5], [0, 2, 5], [0, 1, 5], [0, 0, 5], [0, 0, 4], [0, 0, 3], [0, 0, 2], [0, 0, 1], [0, 0, 0]]);
    check("bestRemedy is null with nothing packed", Cb.bestRemedy(hunter(1)) === null);
  }
  {
    // The same hunter, the same bottles, every one of them out of reach.
    const s = hunter(74, { level: 20 });
    put(s, "inv", "provision_t1", 5);
    put(s, "bank", "provision_t3", 7);
    put(s, "vault", "provision_t4", 1);
    const a = await arena();
    check("bestRemedy and remedyHeals see nothing outside the Satchel",
      Cb.bestRemedy(s) === null && Cb.remedyHeals(s).length === 0 && Cb.huntOddsOpts(s, 6, "core").remedies.length === 0);
    applyCommand(s, { type: "startHunt", args: { tier: 6, zone: "core", limit: null } }, a.env);
    stepWhile(s, a.env, 1000, () => !!s.tasks.combat, 3000);
    check("A remedy in Belongings is never drunk: no heal, and the bottles are all still there",
      !a.fx.some((e) => e.kind === "heal") && S.qtyIn(s, "inv", "provision_t1") === 5 &&
      S.qtyIn(s, "bank", "provision_t3") === 7 && S.qtyIn(s, "vault", "provision_t4") === 1);
    check("and the hunter fell for want of them", s.stats.deaths === 1 && a.of("hunt:death").length === 1);
  }
  {
    // Packed, the same fight is survived: the Satchel is what makes the difference.
    const s = hunter(74, { level: 20 });
    put(s, "satchel", "provision_t3", 7);
    const a = await arena();
    check("remedyHeals reads the Satchel, best first", JSON.stringify(Cb.remedyHeals(s)) === JSON.stringify(Array(7).fill(70)) && Cb.bestRemedy(s) === "provision_t3");
    applyCommand(s, { type: "startHunt", args: { tier: 6, zone: "core", limit: null } }, a.env);
    stepWhile(s, a.env, 1000, () => !!s.tasks.combat, 3000);
    check("A remedy in the Satchel is drunk, and spent out of the Satchel",
      a.fx.some((e) => e.kind === "heal") && S.qtyIn(s, "satchel", "provision_t3") < 7 && S.haveQty(s, "provision_t3") === S.qtyIn(s, "satchel", "provision_t3"));
  }

  section("Party XP");
  {
    const make = () => {
      const s = hunter(75, { level: 40, equipment: gearSet(GameData, 3, "warrior") });
      hunt(s, 1, "middle", 1);
      return s;
    };
    const alone = make();
    const beside = make();
    const other = make();
    const w1 = await listening();
    const w2 = await listening({ party: { intervals: [{ tier: 1, zone: "middle", start: T0 - 1000, end: null }, { tier: 1, zone: "middle", start: T0, end: T0 + 3600000 }, { tier: 1, zone: "inner", start: T0, end: null }, { tier: 2, zone: "middle", start: T0, end: null }] } });
    const w3 = await listening({ party: { intervals: [1, 2, 3, 4].map(() => ({ tier: 1, zone: "middle", start: T0, end: null })) } });
    stepWhile(alone, w1.env, 1000, () => !!alone.tasks.combat, 600);
    stepWhile(beside, w2.env, 1000, () => !!beside.tasks.combat, 600);
    stepWhile(other, w3.env, 1000, () => !!other.tasks.combat, 600);
    const gain = (s) => s.skills.warfare - X[40];
    // 5% a member now, and no more than the two others you can have: the draw is the company, not the multiplier.
    check("Two members on the same ground at the same time: +10% Hunt XP", Math.abs(gain(beside) / gain(alone) - 1.1) < 1e-9, gain(beside) / gain(alone));
    check("capped at +10%", Math.abs(gain(other) / gain(alone) - 1.1) < 1e-9, gain(other) / gain(alone));
  }

  section("Time away plays out the same");
  {
    const start = () => {
      const s = hunter(76, { level: 25, klass: "rogue", equipment: gearSet(GameData, 3, "rogue") });
      put(s, "satchel", "provision_t3", 30);
      s.player.gold = 0;
      return s;
    };
    const outcome = (s) => ({
      kills: s.stats.kills, xp: s.skills.warfare, gold: s.player.gold, hp: s.player.hp, remedies: S.haveQty(s, "provision_t3"),
      deaths: s.stats.deaths, bosses: s.stats.bosses, threat: Cb.threatIn(s, 2, "core"), task: !!s.tasks.combat,
      recovering: s.player.recoveryLeft, chest: s.equipment.chest, level: St.skillLevel(s, "warfare"), log: s.log,
    });
    const a = start();
    const b = start();
    const wa = await arena();
    const wb = await arena();
    applyCommand(a, { type: "startHunt", args: { tier: 2, zone: "core", limit: null } }, wa.env);
    applyCommand(b, { type: "startHunt", args: { tier: 2, zone: "core", limit: null } }, wb.env);
    const t0 = performance.now();
    advance(a, T0 + 8 * 3600000, wa.env);
    const took = performance.now() - t0;
    for (let i = 1; i <= 8 * 3600 * 4; i++) advance(b, T0 + i * 250, wb.env);
    const joins = [wa.fx.filter((e) => e.kind === "join").length, wb.fx.filter((e) => e.kind === "join").length];
    same("Eight hours in one advance plays out as eight hours in quarter-second steps, breaks and levels included", outcome(a), outcome(b), 1e-9);
    check("the chest broke along the way, and reinforcements joined alike", outcome(a).chest === null && joins[0] === joins[1] && joins[0] > 0, joins);
    check(`Eight hours of Core in one call is quick (${Math.round(took)}ms)`, took < 2000);
    const stamps = a.log.map((l) => l.t);
    check("Log lines written along the way carry the time they happened", Math.max(...stamps) - Math.min(...stamps) > 3600000);
  }
});
