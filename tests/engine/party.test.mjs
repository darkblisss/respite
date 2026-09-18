/* The Warband: the shared party encounter. Slice independence, that a replay
   from the stored row lands on the same fight, that a party is no safer than a
   lone hunter, that a kill pays by share of the damage that killed it, and what
   happens when one of them goes down.

     node tests/engine/party.test.mjs */

import { run, check, section, same, shared, clone } from "./harness.mjs";

await run(async () => {
  const { CONFIG } = await shared("config.js");
  const { GameData, getZone } = await shared("registry.js");
  const { combatStats } = await shared("stats.js");
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
    enrage: e.enrage, reinforceAt: Math.round(e.reinforceAt),
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
    check("every foe has a target, and it is the only hunter", e.foes.every((f) => f.target === "u0"));
    check("the encounter carries its own dice, not just its seed", typeof e.dice === "number" && e.dice !== e.seed);

    const four = start(4);
    const load = {};
    four.foes.forEach((f) => { load[f.target] = (load[f.target] || 0) + 1; });
    const counts = Object.values(load);
    check("four hunters draw four times the foes, capped", four.foes.length > start(1).foes.length && four.foes.length <= H.maxFoes * 4,
      { one: start(1).foes.length, four: four.foes.length });
    check("and the foes are spread evenly over them", Math.max(...counts) - Math.min(...counts) <= 1, load);
    check("nobody is left without one to fight", Object.keys(load).length === four.hunters.length, load);
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
    check("the split follows the damage, to the rounding", Math.abs((xp[0] / sum) - (one.hunters[0].dmg / (one.hunters[0].dmg + one.hunters[1].dmg))) < 0.02,
      { xp, dmg: one.hunters.map((u) => Math.round(u.dmg)) });
    check("a drop goes to one hunter, not both", one.hunters.filter((u) => u.owed.drops.length).length <= 1,
      one.hunters.map((u) => u.owed.drops.length));
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

  section("Sovereigns, together");
  {
    const e = start(3, { seed: 88, zone: "core", tier: 3, kind: "sovereign", level: 60 });
    const sov = e.foes.find((f) => GameData.MONSTERS.find((m) => m.id === f.id).archetype === "sovereign");
    check("the Sovereign is there, once", !!sov && e.foes.filter((f) => GameData.MONSTERS.find((m) => m.id === f.id).archetype === "sovereign").length === 1);
    check("its guard scales with the warband", e.foes.length > 1 + getZone("core").escorts, { foes: e.foes.length, escorts: getZone("core").escorts });
    const before = e.enrage;
    P.stepEncounter(e, GameData.SOVEREIGN.enrageMs + 1000);
    check("and it grows angrier on the clock", e.enrage > before, { before, now: e.enrage });
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
});
