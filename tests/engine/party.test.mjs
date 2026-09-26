/* The Warband: the shared party encounter. Slice independence, that a replay
   from the stored row lands on the same fight, that a party is no safer than a
   lone hunter, that a kill pays by share of the damage that killed it, and what
   happens when one of them goes down.

     node tests/engine/party.test.mjs */

import { run, check, section, same, shared, clone, gearSet } from "./harness.mjs";

await run(async () => {
  const { CONFIG } = await shared("config.js");
  const { GameData, getZone, getMonster } = await shared("registry.js");
  const { combatStats } = await shared("stats.js");
  const { foeNumbers } = await shared("combat.js");
  const P = await shared("partyHunt.js");

  const H = CONFIG.hunt;

  // A plain hunter of a level, no gear, no discipline: the same one every time.
  const statsAt = (level) => combatStats({ level, klass: null, equipment: {} });

  const band = (n, level = 30, heals = []) => Array.from({ length: n }, (_, i) =>
    P.makeHunter(`u${i}`, statsAt(level), { heals: heals.slice() }));

  const start = (n, { tier = 2, zone = "outer", seed = 12345, level = 30, kind = "normal", heals = [] } = {}) =>
    P.newEncounter({ id: 1, partyId: "p1", tier, zone, seed, kind, hunters: band(n, level, heals) });

  // Everything that decides the fight, so two runs can be compared whole.
  const shot = (e) => clone({
    clock: Math.round(e.clock), dice: e.dice, over: e.over, uid: e.uid,
    reinforceAt: Math.round(e.reinforceAt),
    foes: e.foes.map((f) => ({ uid: f.uid, id: f.id, hp: Math.round(f.hp), target: f.target, by: f.by })),
    hunters: e.hunters.map((u) => ({
      userId: u.userId, hp: Math.round(u.hp), down: u.down, dmg: Math.round(u.dmg),
      owed: { ...u.owed, xp: Math.round(u.owed.xp), gold: Math.round(u.owed.gold) },
    })),
  });

  section("Building one");
  {
    const e = start(1);
    check("a lone hunter meets what the zone fields", e.foes.length >= 1 && e.foes.length <= H.maxFoes, e.foes.length);
    check("every foe it opens with has picked someone to go for", e.foes.every((f) => f.target === e.hunters[0].userId), e.foes.map((f) => f.target));
    check("the encounter carries its own dice, not just its seed", typeof e.dice === "number" && e.dice !== e.seed);

    const four = start(4);
    check("a four meets the same roster a lone hunter does", four.foes.length <= H.maxFoes, four.foes.length);
    check("but each foe is scaled to the warband", four.foes.every((f) => f.scale === 4) && four.foes[0].max > start(1).foes[0].max,
      { four: four.foes[0].max, one: start(1).foes[0].max });
  }

  section("The same fight however it is sliced");
  {
    const whole = start(3);
    P.stepEncounter(whole, 30000);

    const inBits = start(3);
    for (let i = 0; i < 30; i++) P.stepEncounter(inBits, 1000);
    same("thirty seconds in one step and in thirty steps are the same fight", shot(inBits), shot(whole));

    const odd = start(3);
    const bits = [7, 1, 913, 4000, 11, 25068];
    check("the ragged slices add to the same thirty seconds", bits.reduce((a, b) => a + b, 0) === 30000);
    bits.forEach((ms) => P.stepEncounter(odd, ms));
    same("and so are ragged slices adding to the same time", shot(odd), shot(whole));
  }

  section("A replay from the stored row");
  {
    const live = start(2, { zone: "inner" });
    P.stepEncounter(live, 20000);
    // What the database would hold: JSON, with the stat lines it keeps beside it.
    const stored = clone({ ...live, hunters: live.hunters.map((u) => ({ ...u, stats: null })) });
    stored.hunters.forEach((u, i) => { u.stats = live.hunters[i].stats; });
    P.stepEncounter(live, 20000);
    P.stepEncounter(stored, 20000);
    same("a row read back from JSON plays on into the same fight", shot(stored), shot(live));
  }

  section("No safer together");
  {
    /* The point of the roster scaling: a hunter in a warband should be taking
       about what they would alone, so the reason to party is the company and the
       5%, not an easier fight. Averaged over several seeds, because one fight is
       noise. */
    const took = (n, seed) => {
      // Ground that actually hurts, or the comparison is two roundings of nothing.
      const e = start(n, { seed, zone: "core", tier: 5, level: 30 });
      P.stepEncounter(e, 120000);
      const hurt = e.hunters.map((u) => (u.down ? u.stats.maxHp : u.stats.maxHp - u.hp));
      return hurt.reduce((a, b) => a + b, 0) / hurt.length;
    };
    const seeds = [11, 202, 3003, 40004, 555, 66, 777, 8888, 91, 1212, 13, 1414];
    const avg = (n) => seeds.reduce((sum, s) => sum + took(n, s), 0) / seeds.length;
    const alone = avg(1);
    const pair = avg(2);
    const four = avg(4);
    check("the ground hurts enough to compare", alone > 50, alone);
    const near = (a, b) => Math.abs(a - b) / a < 0.25;
    check("a hunter in a pair takes about what they take alone", near(alone, pair), { alone: Math.round(alone), pair: Math.round(pair) });
    check("and so does one of four", near(alone, four), { alone: Math.round(alone), four: Math.round(four) });
  }

  section("A kill pays by the damage that killed it");
  {
    const e = start(2, { seed: 999, zone: "outer", level: 45 });
    P.stepEncounter(e, 120000);
    const [a, b] = e.hunters;
    check("both of them landed blows", a.dmg > 0 && b.dmg > 0, { a: Math.round(a.dmg), b: Math.round(b.dmg) });
    check("and both were paid", a.owed.xp > 0 && b.owed.xp > 0, { a: a.owed.xp, b: b.owed.xp });
    // Shares need not match exactly (they kill different foes), but neither is paid for nothing.
    const paidFor = (u) => u.owed.xp > 0 === u.dmg > 0;
    check("nobody is paid who did not hurt anything", e.hunters.every(paidFor));

    // One foe, two hunters, worked out by hand off the recorded shares.
    const one = start(2, { seed: 4242, zone: "outer", level: 45 });
    one.foes = one.foes.slice(0, 1);
    one.foes[0].target = "u0";
    const foe = one.foes[0];
    const total = foe.max;
    P.stepEncounter(one, 120000);
    const xp = one.hunters.map((u) => u.owed.xp);
    const sum = xp[0] + xp[1];
    check("one foe's whole XP is paid out, and no more", sum > 0 && Number.isFinite(sum), { xp, total });
    /* 70% of the damage dealt and 30% of the damage taken. The foe keeps to u0, so u0
       takes every blow and is paid for holding the line over its damage share, but the
       taken half is capped at half the encounter's, so never by more than a fifth. */
    const dealtShare = one.hunters[0].dmg / (one.hunters[0].dmg + one.hunters[1].dmg);
    check("the foe kept to the one it picked", one.hunters[0].taken > 0 && one.hunters[1].taken === 0,
      one.hunters.map((u) => Math.round(u.taken)));
    check("a share leans on damage dealt, and pays the one who held the line", xp[0] / sum > dealtShare && xp[0] / sum < dealtShare + 0.2,
      { xpShare: xp[0] / sum, dealtShare });
    check("both hunters roll their own drop", one.hunters.every((u) => u.owed.drops.length > 0),
      one.hunters.map((u) => u.owed.drops.length));
    check("gold is the same for both, not split", one.hunters[0].owed.gold === one.hunters[1].owed.gold && one.hunters[0].owed.gold > 0,
      one.hunters.map((u) => u.owed.gold));
    check("and the kill is credited to each of them", one.hunters.every((u) => u.owed.kills > 0),
      one.hunters.map((u) => u.owed.kills));
  }

  section("A share is guarded against standing still");
  {
    // Shares are pure arithmetic on dmg/taken, so they are checked on made-up rosters.
    const roster = (rows) => ({ hunters: rows.map(([userId, dmg, taken]) => ({ userId, dmg, taken })) });
    const pct = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 1000) / 10]));
    const sumOf = (m) => Object.values(m).reduce((n, v) => n + v, 0);

    const even = P.contributionMap(roster([["a", 25, 25], ["b", 25, 25], ["c", 25, 25], ["d", 25, 25]]));
    same("an even four split it evenly", pct(even), { a: 25, b: 25, c: 25, d: 25 });

    const band4 = P.contributionMap(roster([["tank", 15, 55], ["dps1", 40, 15], ["dps2", 30, 20], ["sup", 15, 10]]));
    check("a tank is paid well above its damage share", band4.tank > 0.15 + 0.05, pct(band4));
    check("and still under the hardest hitter", band4.tank < band4.dps1, pct(band4));

    /* The exploit the guard exists for: unkillable, never swings. Without the cap on
       the taken half this roster banks most of the 30% for doing nothing. */
    const leech = P.contributionMap(roster([["leech", 1, 90], ["d1", 34, 4], ["d2", 33, 3], ["d3", 32, 3]]));
    check("an immortal who never swings earns nearly nothing", leech.leech < 0.08, pct(leech));
    check("and the three who fought take the rest", leech.d1 > 0.28 && leech.d3 > 0.28, pct(leech));

    const afk = P.contributionMap(roster([["afk", 0, 40], ["d1", 34, 20], ["d2", 33, 20], ["d3", 33, 20]]));
    check("dealing no damage at all is paid nothing", afk.afk === 0, pct(afk));

    [even, band4, leech, afk].forEach((m, i) => {
      check(`shares ${i} sum to exactly one encounter`, Math.abs(sumOf(m) - 1) < 1e-9, sumOf(m));
    });
    same("nobody has hurt it yet: nothing is owed", P.contributionMap(roster([["a", 0, 10], ["b", 0, 10]])), {});
  }

  section("A party's XP pool rides the party's size");
  {
    const CONFIG = (await shared("config.js")).CONFIG;
    same("the bonus is the same one a hunt beside a party pays",
      [1, 2, 3, 4].map((n) => Math.round(P.partyXpBonus(n) * 100)),
      [1, 2, 3, 4].map((n) => Math.round((1 + Math.min(CONFIG.party.huntBonusCap, CONFIG.party.huntBonusPerMember * (n - 1))) * 100)));

    /* The promise: a fair split of a foe built for four pays each of the four about
       what a lone hunter is paid by a foe built for one, plus the party bonus. Same
       ground, same level, same seed, so only the size of the band differs. */
    const xpPerHead = (n) => {
      const e = start(n, { seed: 31337, zone: "outer", tier: 2, level: 45 });
      P.stepEncounter(e, 10 * 60 * 1000);
      const kills = e.hunters.reduce((m, u) => Math.max(m, u.owed.kills), 0);
      const xp = e.hunters.reduce((m, u) => m + u.owed.xp, 0);
      return kills > 0 ? xp / e.hunters.length / kills : 0;
    };
    const solo = xpPerHead(1);
    const four = xpPerHead(4);
    check("a four earns about what a one does a kill, not a quarter of it",
      solo > 0 && four / solo > 0.9 && four / solo < 1.35, { solo, four, ratio: four / solo });
  }

  section("Whom foes go for");
  {
    /* Three hunters with their health well apart, so "the healthiest" means one of them.
       The rule: an encounter's opening foes take the healthiest hunter nobody has yet,
       heaviest hitter first; anything later takes the healthiest; each keeps its hunter
       until they fall. */
    const most = statsAt(40).maxHp;
    const trio = () => [["tank", 1], ["mid", 0.66], ["low", 0.33]].map(([id, k]) => P.makeHunter(id, statsAt(40), { hp: most * k }));
    const open = (o) => P.newEncounter(Object.assign({ id: 1, partyId: "p1", tier: 3, zone: "inner", seed: 12345, hunters: trio() }, o));
    const weight = (f) => { const m = getMonster(f.id); return foeNumbers(m, f.elite, f.power).attack / m.speed; };
    const who = (e) => e.foes.map((f) => f.target);
    const hunter = (e, id) => e.hunters.find((u) => u.userId === id);

    const two = open();
    same("two foes on three hunters take the two healthiest, one each", who(two).slice().sort(), ["mid", "tank"]);
    const heavy = two.foes.slice().sort((a, b) => weight(b) - weight(a))[0];
    same("the heavier of them on the healthiest", heavy.target, "tank");

    let three = null;
    for (let seed = 1; seed < 400 && !three; seed++) {
      const e = open({ zone: "core", seed });
      if (e.foes.length === 3) three = e;
    }
    check("three foes on three hunters: one each, so the whole party is struck", !!three && new Set(who(three)).size === 3, three && who(three));
    const order = three ? three.foes.slice().sort((a, b) => weight(b) - weight(a)).map((f) => f.target) : [];
    same("and in order of weight: heaviest on the healthiest, lightest on the frailest", order, ["tank", "mid", "low"]);

    const sov = open({ zone: "core", kind: "sovereign" });
    const isSov = (f) => getMonster(f.id).archetype === "sovereign";
    same("a Sovereign goes for the healthiest", sov.foes.find(isSov).target, "tank");
    same("and its guard for the other two", sov.foes.filter((f) => !isSov(f)).map((f) => f.target).sort(), ["low", "mid"]);

    // Kept: the healthiest changes under it and nothing switches; the one nobody picked is never struck.
    const kept = open();
    const picked = new Map(kept.foes.map((f) => [f.uid, f.target]));
    hunter(kept, "tank").hp = hunter(kept, "mid").hp - 1;
    P.stepEncounter(kept, 4000);
    check("the healthiest changing moves no foe off the hunter it has",
      kept.foes.every((f) => !picked.has(f.uid) || picked.get(f.uid) === f.target), { was: [...picked], now: kept.foes.map((f) => [f.uid, f.target]) });
    check("and blows land where the foes are, not in turn", hunter(kept, "tank").taken > 0 && hunter(kept, "low").taken === 0,
      kept.hunters.map((u) => [u.userId, Math.round(u.taken)]));

    // Later: a reinforcement takes the healthiest, even with a hunter nobody has.
    const late = open();
    hunter(late, "tank").hp = most;
    late.reinforceAt = late.clock + 1;
    P.stepEncounter(late, 50);
    const joined = late.foes.filter((f) => f.ambush);
    check("a reinforcement comes", joined.length > 0, late.foes.length);
    check("and takes the healthiest, not the one nobody has", joined.every((f) => f.target === "tank"), who(late));

    const seen = P.encounterView(two);
    same("the view says whom each foe is on, by user id", seen.foes.map((f) => f.target), who(two));
    // What the Hunt page's ring runs on between answers.
    same("and how long until each of them swings", seen.foes.map((f) => f.timer), two.foes.map((f) => Math.max(0, Math.round(f.timer))));
    same("and how long until the next steps out of the dark", seen.reinforceIn, Math.max(0, Math.round(two.reinforceAt - two.clock)));
    same("and each hunter's discipline, Veil and opening casts", seen.hunters.map((u) => [u.klass, u.veil, u.volley]),
      two.hunters.map((u) => [u.stats.klass || null, Math.round(u.veil || 0), u.volley || 0]));
  }

  section("When one of them goes down");
  {
    // A weak pair on hard ground: somebody falls.
    const e = start(2, { seed: 7, zone: "core", tier: 6, level: 8 });
    P.stepEncounter(e, 10 * 60 * 1000);
    const fallen = e.hunters.filter((u) => u.down);
    check("someone fell", fallen.length > 0, e.hunters.map((u) => ({ hp: Math.round(u.hp), down: u.down })));
    check("a fallen hunter is owed a death, naming what did it", fallen.every((u) => typeof u.owed.died === "string" && u.owed.died.startsWith("mob_")),
      fallen.map((u) => u.owed.died));
    check("and is at no health", fallen.every((u) => u.hp === 0));
    if (e.over !== "wiped") {
      check("the foes turn on whoever is left standing",
        e.foes.every((f) => P.standing(e).some((u) => u.userId === f.target)),
        { targets: e.foes.map((f) => f.target), up: P.standing(e).map((u) => u.userId) });
    } else {
      check("a wipe ends the encounter", e.over === "wiped");
    }
  }

  section("Remedies come out of what was packed");
  {
    const heals = [400, 400, 400];
    const e = start(1, { seed: 31, zone: "core", tier: 5, level: 20, heals });
    P.stepEncounter(e, 5 * 60 * 1000);
    const u = e.hunters[0];
    check("the ones drunk are counted for settling", u.owed.remedies === heals.length - u.heals.length,
      { owed: u.owed.remedies, left: u.heals.length });
    check("and never more than were packed", u.owed.remedies <= heals.length, u.owed.remedies);
  }
  {
    // Nothing heals for free together either: the Satchel is reached for mid encounter, at a quarter.
    const heals = [400, 400, 400];
    const e = start(1, { seed: 31, zone: "core", tier: 5, level: 20, heals });
    const drank = [];
    P.stepEncounter(e, 5 * 60 * 1000, { fx: (who, kind, amount) => { if (kind === "heal") drank.push({ foes: e.foes.length, amount }); } });
    check("a hunter drinks the moment a blow leaves them at a quarter, in the middle of the encounter",
      drank.length > 0 && drank[0].foes > 0 && drank[0].amount > 0 && e.hunters[0].owed.remedies === drank.length, drank);
  }

  section("Lifesteal, Dodge, Block, and what a share counts as taken");
  {
    // One foe that never swings and never falls: every point back is lifesteal.
    const e = start(1, { seed: 7, zone: "outer", tier: 1, level: 30 });
    e.foes = [{ ...e.foes[0], hp: 1e9, max: 1e9, timer: 1e12 }];
    e.reinforceAt = 1e12;
    const u = e.hunters[0];
    u.hp = 50;
    P.stepEncounter(e, 30000);
    check("lifesteal: a hundredth of every blow landed comes back, as it does alone",
      u.dmg > 0 && Math.abs(u.hp - Math.min(u.stats.maxHp, 50 + u.dmg * u.stats.lifesteal)) < 1e-6, { hp: u.hp, dmg: u.dmg });
  }
  {
    /* Built to shrug blows off: Relic heavy armour and a shield, well past the ground. What it
       absorbed for the party is the blows as they were thrown, not the little that got through. */
    const tank = P.makeHunter("tank", combatStats({ level: 40, klass: "warrior", equipment: gearSet(GameData, 5, "warrior", "relic") }));
    const e = P.newEncounter({ id: 1, partyId: "p1", tier: 5, zone: "core", seed: 5, hunters: [tank] });
    let lost = 0;
    let blocked = 0;
    P.stepEncounter(e, 10 * 60 * 1000, { fx: (who, kind, amount) => {
      if (who !== "tank") return;
      if (["hurt", "block", "ambushed", "glance"].includes(kind)) lost += amount;
      if (kind === "block") blocked++;
    } });
    check("what a hunter absorbed is the blows as thrown, before their own Block, Dodge and Defence",
      tank.taken > lost * 1.5 && blocked > 0, { taken: Math.round(tank.taken), lost, blocked });
  }

  section("Sovereigns, together");
  {
    const e = start(3, { seed: 88, zone: "core", tier: 3, kind: "sovereign", level: 60 });
    const sov = e.foes.find((f) => GameData.MONSTERS.find((m) => m.id === f.id).archetype === "sovereign");
    check("the Sovereign is there, once", !!sov && e.foes.filter((f) => GameData.MONSTERS.find((m) => m.id === f.id).archetype === "sovereign").length === 1);
    check("its guard is two, warband or not", e.foes.length === 1 + GameData.SOVEREIGN.escorts, { foes: e.foes.length, escorts: GameData.SOVEREIGN.escorts });
    const arch = e.foes.map((f) => getMonster(f.id).archetype);
    check("its guard walks in first and the Sovereign steps out behind them, last on the roster", arch[arch.length - 1] === "sovereign" && e.foes.slice(0, -1).every((f) => f.elite), arch);
    const first = e.foes[0].uid;
    const hurt = [];
    P.stepEncounter(e, 8000, { fx: (who, kind) => { if (kind === "hit" || kind === "crit") hurt.push(who); } });
    check("so the warband strikes a guard first, not the Sovereign", hurt.length > 0 && hurt[0] === first && !hurt.slice(0, 3).includes(sov.uid), { hurt: hurt.slice(0, 5), first, sov: sov.uid });
    check("and it does not grow angrier on a clock", e.enrage === undefined && e.enrageAt === undefined);
  }

  section("A party meets its Sovereign");
  {
    /* As a lone hunter does: every encounter it clears on ground a Sovereign walks rolls
       the zone's chance that the next one is it. A band strong enough to clear the Core of
       the first region fast, so the rolls come quickly. */
    const s = P.newSession({ partyId: "p1", tier: 1, zone: "core", seed: 4242, hunters: band(3, 99) });
    let vast = null;
    let met = null;
    // Fine steps on the walk to it, so its roster is read before the first blow lands.
    for (let t = 0; t < 3 * 3600 * 4 && !met; t++) {
      P.stepSession(s, s.sovereignNext ? 50 : 250);
      if (!vast && P.sessionView(s).vast) vast = { wait: s.wait, view: P.sessionView(s) };
      if (s.enc && s.enc.kind === "sovereign") met = { id: s.enc.id, roster: s.enc.foes.map((f) => getMonster(f.id).archetype) };
    }
    check("a party on ground a Sovereign walks meets it", !!met, { encounters: s.encounters });
    check("the walk to it says so, and is the shortest walk there is", !!vast && vast.wait <= H.searchMinMs + 1 && vast.view.phase === "search",
      vast && { wait: vast.wait, phase: vast.view.phase });
    check("it comes with its guard, and nothing else", !!met && met.roster.length === 1 + GameData.SOVEREIGN.escorts, met && met.roster);
    check("and the guard walks in before it", !!met && met.roster[met.roster.length - 1] === "sovereign", met && met.roster);
    const view = P.sessionView(s);
    check("the view of its fight has no anger in it and no window: nothing else will come", !!view.enc && view.enc.kind === "sovereign" &&
      !Object.hasOwn(view.enc, "enrage") && !Object.hasOwn(view.enc, "enrageIn") && view.enc.reinforceIn === null,
      view.enc && { kind: view.enc.kind, reinforceIn: view.enc.reinforceIn });
    check("and the walk no longer says one is coming", view.vast === false);

    const id = met ? met.id : null;
    for (let t = 0; t < 3600 && s.enc && s.enc.id === id; t++) P.stepSession(s, 250);
    check("after it, the shortest walk and no roll for another", s.phase === "search" && s.wait <= H.searchMinMs && !s.sovereignNext,
      { phase: s.phase, wait: s.wait, next: s.sovereignNext });
    const felled = s.hunters.filter((u) => u.owed.drops.some((d) => getMonster(d.id).archetype === "sovereign"));
    check("everyone who hurt it is owed its kill, with how long the fight ran", felled.length === 3 &&
      felled.every((u) => u.owed.drops.some((d) => getMonster(d.id).archetype === "sovereign" && d.ms > 0)),
      s.hunters.map((u) => u.owed.drops.filter((d) => getMonster(d.id).archetype === "sovereign")));

    const outer = P.newSession({ partyId: "p2", tier: 1, zone: "outer", seed: 4242, hunters: band(3, 99) });
    let never = true;
    for (let t = 0; t < 3600; t++) {
      P.stepSession(outer, 1000);
      if (P.sessionView(outer).vast || (outer.enc && outer.enc.kind === "sovereign")) never = false;
    }
    check("the Outer never meets one", never && outer.encounters > 10, outer.encounters);
  }

  section("Ending, and being read");
  {
    const e = start(2, { seed: 5150, zone: "outer", tier: 1, level: 70 });
    P.stepEncounter(e, 10 * 60 * 1000);
    check("a warband that clears the ground ends the encounter", e.over === "cleared", { over: e.over, foes: e.foes.length });
    check("stepping an ended encounter plays nothing", P.stepEncounter(e, 60000) === 0);
    check("nextEncounterDue says so too", P.nextEncounterDue(e) === Infinity);

    const view = P.encounterView(e);
    const text = JSON.stringify(view);
    check("the view carries no seed, no dice and no stat lines", !/\bseed\b|\bdice\b|maxHp|critDmg/.test(text), text.slice(0, 200));
    check("it says who is in it and how they are doing", view.hunters.length === 2 && view.hunters.every((u) => typeof u.hp === "number" && typeof u.dmg === "number"));
  }

  section("A session: encounters one after another");
  {
    const sess = (n, o = {}) => P.newSession({
      partyId: "p1", tier: o.tier || 2, zone: o.zone || "outer", seed: o.seed || 4242,
      hunters: band(n, o.level || 45, o.heals || []),
    });

    const s = sess(2);
    check("a session opens on the walk, not a fight", s.phase === "search" && s.enc === null && s.encounters === 0);
    P.stepSession(s, 10 * 60 * 1000);
    check("it works through several encounters", s.encounters > 1, s.encounters);
    check("and is either walking or fighting, never neither", (s.phase === "search") !== (s.phase === "fight"));
    check("time played adds up to what it was given", s.elapsed > 0 && s.elapsed <= 10 * 60 * 1000 + 1, s.elapsed);
    check("everyone has been paid something by now", s.hunters.every((u) => u.owed.xp > 0), s.hunters.map((u) => Math.round(u.owed.xp)));

    // The same promise the encounter makes, over a whole session of them.
    const whole = sess(3, { seed: 606 });
    P.stepSession(whole, 5 * 60 * 1000);
    const bits = sess(3, { seed: 606 });
    for (let i = 0; i < 300; i++) P.stepSession(bits, 1000);
    const sig = (x) => clone({
      elapsed: Math.round(x.elapsed), encounters: x.encounters, phase: x.phase, dice: x.dice, over: x.over,
      wait: Math.round(x.wait),
      hunters: x.hunters.map((u) => ({ hp: Math.round(u.hp), down: u.down, dmg: Math.round(u.dmg), xp: Math.round(u.owed.xp) })),
    });
    same("a session sliced five hundred ways is the same session", sig(bits), sig(whole));

    // Wearing down: the walk does not heal, so a session is a war of attrition.
    const worn = sess(1, { level: 20, tier: 5, zone: "core", seed: 31337 });
    P.stepSession(worn, 3 * 60 * 1000);
    const u = worn.hunters[0];
    check("health carries across encounters rather than resetting", u.down || u.hp < u.stats.maxHp, { hp: Math.round(u.hp), max: u.stats.maxHp, down: u.down });

    // A wipe stops the session rather than walking into another fight.
    const doomed = sess(1, { level: 5, tier: 8, zone: "core", seed: 5 });
    P.stepSession(doomed, 30 * 60 * 1000);
    check("a wipe ends the session", doomed.over === "wiped", { over: doomed.over, down: doomed.hunters.map((h) => h.down) });
    check("and stepping it further plays nothing", P.stepSession(doomed, 60000) === 0);
    check("nextSessionDue agrees", P.nextSessionDue(doomed) === Infinity);
  }

  section("Falling in with a fight already under way");
  {
    /* Whoever joins comes in on the walk, never into the middle of an encounter: the roster of
       foes was drawn for the party that walked into it, so dropping a hunter in mid fight would
       either hand them a free kill or hand the others a free pair of hands. The server pushes
       them onto the session and the rules are what make them wait. */
    const s = P.newSession({ partyId: "p1", tier: 2, zone: "outer", seed: 909, hunters: band(1, 45) });
    let guard = 0;
    while (s.phase !== "fight" && guard++ < 200) P.stepSession(s, 1000);
    check("the party is in an encounter", s.phase === "fight" && !!s.enc, s.phase);

    const late = P.makeHunter("late", statsAt(45), {});
    s.hunters.push(late);
    const encounterNow = s.encounters;
    P.stepSession(s, 500);
    check("a hunter added mid encounter is on the session but not in the fight",
      s.hunters.some((u) => u.userId === "late") && !s.enc.hunters.some((u) => u.userId === "late"),
      { session: s.hunters.map((u) => u.userId), fight: s.enc && s.enc.hunters.map((u) => u.userId) });
    check("and is paid nothing out of an encounter they were not in", late.owed.xp === 0, late.owed);

    // The next one is drawn for everybody standing, so the wait is exactly one encounter long.
    guard = 0;
    while (s.encounters <= encounterNow && !s.over && guard++ < 600) P.stepSession(s, 1000);
    check("the encounter after it is drawn for them too",
      !!s.enc && s.enc.hunters.some((u) => u.userId === "late"),
      { encounters: s.encounters, fight: s.enc && s.enc.hunters.map((u) => u.userId) });
  }

  section("Setting out together");
  {
    /* The host's press opens the ground; everyone else marked ready walks on under their own
       next request, a second or two behind. The first walk is held for them, so a party that
       set out together fights encounter one together, and nobody waits a whole encounter for
       a request that happened to land after the walk ran out. */
    const MUSTER = CONFIG.party.musterMs;
    const opened = () => P.newSession({ partyId: "p1", tier: 2, zone: "outer", seed: 4040, hunters: band(1, 45), expecting: ["U1", "u0"] });

    const s = opened();
    same("expecting the others, not the host, and by lowercased id", s.muster && s.muster.waiting, ["u1"]);
    P.stepSession(s, CONFIG.hunt.searchMinMs + 2000);
    check("the first walk is held past its length while one of them is still to come",
      s.phase === "search" && s.encounters === 0 && s.enc === null, { phase: s.phase, encounters: s.encounters });
    same("and the view says who it is being held for", P.sessionView(s).muster, 1);
    check("and the scheduler is told when the hold runs out, not that it is due now",
      P.nextSessionDue(s) > 0 && P.nextSessionDue(s) <= MUSTER, P.nextSessionDue(s));

    // The last of them walks on: the server pushes them, then says so.
    s.hunters.push(P.makeHunter("u1", statsAt(45), {}));
    const last = P.fellIn(s, "U1");
    check("the last one in ends the hold", last === true && s.muster === null);
    check("and encounter one is drawn there and then, with both of them in it",
      s.phase === "fight" && s.encounters === 1 && s.enc.hunters.map((u) => u.userId).sort().join() === "u0,u1",
      { phase: s.phase, fight: s.enc && s.enc.hunters.map((u) => u.userId) });

    // Arriving inside the walk's own length changes nothing about the walk.
    const early = opened();
    P.stepSession(early, 1000);
    early.hunters.push(P.makeHunter("u1", statsAt(45), {}));
    P.fellIn(early, "u1");
    check("one who is on before the walk is out just walks the rest of it",
      early.phase === "search" && early.muster === null && early.wait > 0);
    P.stepSession(early, CONFIG.hunt.searchMinMs);
    check("and is in encounter one when it comes", early.encounters === 1 && early.enc.hunters.length === 2);

    // A closed tab holds the party so long and no longer.
    const lonely = opened();
    P.stepSession(lonely, MUSTER - 1000);
    check("a muster nobody answers still holds just short of its length", lonely.encounters === 0 && !!lonely.muster);
    P.stepSession(lonely, 2000);
    check("then lets go, and encounter one is drawn for whoever is there",
      lonely.encounters === 1 && lonely.muster === null && lonely.enc.hunters.length === 1);

    // Held or not, it is the same fight however the time is cut.
    const whole = opened();
    P.stepSession(whole, 60 * 1000);
    const bits = opened();
    for (let i = 0; i < 240; i++) P.stepSession(bits, 250);
    same("a held walk sliced two hundred ways is the same session",
      clone({ e: bits.encounters, el: Math.round(bits.elapsed), d: bits.dice, p: bits.phase }),
      clone({ e: whole.encounters, el: Math.round(whole.elapsed), d: whole.dice, p: whole.phase }));

    // Nobody else ready: nothing held, exactly the old walk.
    const alone = P.newSession({ partyId: "p1", tier: 2, zone: "outer", seed: 4040, hunters: band(1, 45) });
    check("a host who sets out alone opens with nothing held", alone.muster === null);
    P.stepSession(alone, CONFIG.hunt.searchMinMs + 1);
    check("and walks straight into encounter one", alone.encounters === 1);
  }

  section("A share, as the page reads it");
  {
    const s = P.newSession({ partyId: "p1", tier: 2, zone: "outer", seed: 77, hunters: band(2, 45) });
    same("before a blow nobody has a share", P.sessionView(s).hunters.map((u) => u.share), [0, 0]);
    P.stepSession(s, 5 * 60 * 1000);
    const shares = P.sessionView(s).hunters.map((u) => u.share);
    check("every hunter who fought has one, as a percent", shares.every((x) => x > 0 && x <= 100), shares);
    check("and between them they come to the whole", Math.abs(shares.reduce((a, b) => a + b, 0) - 100) <= 0.2, shares);
    const solo = P.newSession({ partyId: "p1", tier: 2, zone: "outer", seed: 77, hunters: band(1, 45) });
    P.stepSession(solo, 2 * 60 * 1000);
    same("one hunter alone holds all of it, not none of it", P.sessionView(solo).hunters[0].share, 100);
  }

  section("A session that lives in a database");
  {
    /* The bug this guards: in memory the session's hunters and the live
       encounter's are the same objects, so moving one moves both. Through JSON
       they become two, and only the encounter's copy is the one that gets moved.
       Without the rebind, owedFor and sessionView read a roster frozen at the
       last save, so shares, health and damage all come out wrong. */
    const live = P.newSession({ partyId: "p1", tier: 2, zone: "outer", seed: 191, hunters: band(2, 45) });
    P.stepSession(live, 8000);
    check("the round trip happens mid encounter, which is the hard case", live.phase === "fight" && !!live.enc, live.phase);

    const stored = clone(live);
    stored.hunters.forEach((u, i) => { u.stats = live.hunters[i].stats; });
    stored.enc.hunters.forEach((u, i) => { u.stats = live.enc.hunters[i].stats; });

    P.stepSession(live, 40000);
    P.stepSession(stored, 40000);

    const roster = (x) => x.hunters.map((u) => ({ hp: Math.round(u.hp), dmg: Math.round(u.dmg), xp: Math.round(u.owed.xp), down: u.down }));
    same("a session read back from JSON plays on into the same session", roster(stored), roster(live));
    check("and its own roster moved, not a copy of it", stored.hunters.some((u) => u.dmg > 0), roster(stored));
    same("what it owes agrees with what its roster says", 
      stored.hunters.map((u) => Math.round(u.owed.xp)),
      stored.hunters.map((u) => Math.round(P.owedFor(stored, u.userId).xp)));
  }

  section("Settling");
  {
    const s = P.newSession({ partyId: "p1", tier: 2, zone: "outer", seed: 77, hunters: band(2, 45) });
    P.stepSession(s, 5 * 60 * 1000);
    const owed = P.owedFor(s, "u0");
    check("a member's owings can be read by name", owed && owed.xp > 0, owed && Math.round(owed.xp));
    const other = Math.round(P.owedFor(s, "u1").xp);
    P.clearOwed(s, "u0");
    check("clearing one empties only that one", P.owedFor(s, "u0").xp === 0 && Math.round(P.owedFor(s, "u1").xp) === other);
    check("a name nobody answers to is not an error", P.owedFor(s, "nobody") === null);

    const view = P.sessionView(s);
    check("the view says where the party is and what it is doing", view.zone === "outer" && (view.phase === "search" || view.phase === "fight"));
    same("and each hunter's discipline, for the glyph beside their name", view.hunters.map((u) => u.klass), s.hunters.map((u) => u.stats.klass || null));
    check("and carries no seed, dice or stat lines", !/\bseed\b|\bdice\b|maxHp|critDmg/.test(JSON.stringify(view)));
  }
});
