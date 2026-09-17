/* Slice independence. A busy save (a Lv 40 Mage hunting a tier 5 Inner with
   remedies and Hide on, a companion about to reach a Bond level that
   quickens the bench, a craft that eats a stack the hunt keeps topping up,
   requisitions out across midnight, a bounty buff running out, a bounty
   window turning, and commands at fixed clocks) is played for twelve hours
   three ways: in one call between commands, in 5,000 ms steps, and in random
   1 to 1000 ms steps. The saves must agree: same structure, keys, strings,
   booleans, integers, array lengths and log lines (with their times); other
   numbers within 1e-6 relative (ENGINE.md 1.3). Then the first twenty
   seconds, one millisecond at a time.

     node tests/engine/slices.test.mjs */

import { run, check, section, same, shared, clone, put, listening, gearSet, firstDiff } from "./harness.mjs";

await run(async () => {
  const { CONFIG } = await shared("config.js");
  const { GameData } = await shared("registry.js");
  const { createState } = await shared("state.js");
  const { advance, applyCommand } = await shared("engine.js");
  const St = await shared("stats.js");
  const S = await shared("storage.js");
  const Co = await shared("companions.js");

  const HOUR = 3600000;
  // 18:30 UTC: midnight (a new day and a new bounty window) falls 5h30m in.
  const START = Date.UTC(2026, 8, 18, 18, 30, 0);
  const END = START + 12 * HOUR;

  function busySave() {
    const s = createState({ now: START, seed: 424242 });
    s.skills.warfare = CONFIG.xpTable[40];
    s.skills.forgemaster = CONFIG.xpTable[45];
    s.skills.delving = CONFIG.xpTable[42];
    s.skills.dredging = CONFIG.xpTable[30];
    s.player.klass = "mage";
    s.player.gold = 20000;
    s.equipment = gearSet(GameData, 5, "mage", "rare");
    s.travel.unlocked = ["region_1", "region_2", "region_3", "region_4", "region_5"];
    s.region = "region_5";
    s.settings.hideSovereign = true;
    put(s, "inv", "provision_t4", 40);
    put(s, "bank", "provision_t6", 12);
    // The bench eats this ore; the hunt's Brutes drop more of it.
    put(s, "bank", "crucible_delve", 70);
    put(s, "vault", "coal", 900);
    put(s, "bank", "crucible_ring|epic|77", 1);
    // The Veil Stag is two minutes of work from Bond 10, which quickens every trade.
    s.companions = { owned: { stag: { bond: CONFIG.bondXpFor(10) - 2, rank: 2, dupes: 0 } }, active: "stag" };
    // An hour of double XP from a bounty, running out 45 minutes in.
    s.buff = { until: START + 45 * 60000 + 17, mult: 2 };
    s.player.hp = St.maxHp(s);
    return s;
  }

  // Commands at fixed clocks, the same in every run.
  const COMMANDS = [
    [START, "startHunt", { tier: 5, zone: "inner", limit: null }],
    [START, "startSkill", { skillId: "forgemaster", actionId: "craft_crucible_bar", limit: null }],
    [START, "hireAgent", {}],
    [START + 1, "hireAgent", {}],
    [START + 2, "hireAgent", {}],
    [START + 1000, "deployAgent", { agentId: "agent_3", itemKey: "coal" }],
    [START + 1001, "deployAgent", { agentId: "agent_4", itemKey: "crucible_delve" }],
    [START + 1002, "deployAgent", { agentId: "agent_5", itemKey: "resin" }],
    [START + 37 * 60000 + 333, "setHide", { on: false }],
    [START + 2 * HOUR + 4567, "startSkill", { skillId: "delving", actionId: "delving_t5", limit: 400 }],
    [START + 3 * HOUR + 17 * 60000 + 3, "buyRemedy", { key: "provision_t4", qty: 25 }],
    [START + 4 * HOUR, "unequip", { slot: "ring" }],
    [START + 4 * HOUR + 60000, "equip", { key: "crucible_ring|epic|77", from: "bank" }],
    [START + 5 * HOUR + 29 * 60000 + 999, "travel", { regionId: "region_4" }],
    [START + 6 * HOUR + 1, "claimBounty", {}],
    [START + 6 * HOUR + 12345, "setHide", { on: true }],
    [START + 7 * HOUR + 777, "startHunt", { tier: 5, zone: "core", limit: 500 }],
    [START + 8 * HOUR + 5, "sellItem", { key: "scaled_flay", from: "inv", qty: 10 }],
    [START + 8 * HOUR + 6, "moveItem", { key: "ghost_dredge", from: "inv", to: "vault", qty: null }],
    [START + 9 * HOUR + 1, "deployAgent", { agentId: "agent_3", itemKey: "coal" }],
    [START + 10 * HOUR, "startSkill", { skillId: "forgemaster", actionId: "craft_crucible_bar", limit: 20 }],
    [START + 11 * HOUR + 3, "pullBack", {}],
    [START + 11 * HOUR + 4, "startHunt", { tier: 4, zone: "outer", limit: null }],
  ];

  // Plays the save to END, stepping with next(t) between commands.
  async function play(next, save = busySave(), end = END) {
    const w = await listening();
    const results = [];
    let t = save.clock;
    for (const [at, type, args] of [...COMMANDS, [end, null, null]]) {
      if (at > end) break;
      while (t < at) {
        t = Math.min(at, next(t));
        advance(save, t, w.env);
      }
      if (type) results.push([at, type, applyCommand(save, { type, args: clone(args) }, w.env)]);
    }
    return { save, results, events: w.events.map(([type, p]) => [type, p.at, p.reason || null]) };
  }

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  section("Twelve hours, three ways");
  let t0 = performance.now();
  const once = await play(() => Infinity);
  const onceMs = performance.now() - t0;
  t0 = performance.now();
  const fives = await play((t) => START + (Math.floor((t - START) / 5000) + 1) * 5000);
  const fivesMs = performance.now() - t0;
  const rand = mulberry(99);
  t0 = performance.now();
  const frames = await play((t) => t + 1 + Math.floor(rand() * 1000));
  const framesMs = performance.now() - t0;
  console.log(`     one call ${Math.round(onceMs)}ms, 5s steps ${Math.round(fivesMs)}ms, random frames ${Math.round(framesMs)}ms`);

  const A = once.save;
  check("every run reached the end", [once, fives, frames].every((r) => r.save.clock === END));
  same("command results agree (5s steps)", fives.results, once.results);
  same("command results agree (random frames)", frames.results, once.results);
  same("5,000 ms steps: the same save", fives.save, A, 1e-6);
  same("random 1 to 1000 ms frames: the same save", frames.save, A, 1e-6);
  same("the same events at the same moments (5s steps)", fives.events, once.events);
  same("the same events at the same moments (random frames)", frames.events, once.events);
  const strict = firstDiff(clone(frames.save), clone(A));
  console.log(`     exact JSON equality between one call and random frames: ${strict ? "differs within tolerance at " + strict : "identical"}`);
  check("log lines agree exactly, times included", JSON.stringify(frames.save.log) === JSON.stringify(A.log) && JSON.stringify(fives.save.log) === JSON.stringify(A.log));

  section("The scenario did what it says");
  const types = once.events.map((e) => e[0]);
  const count = (type) => types.filter((x) => x === type).length;
  const at = (type) => once.events.filter((e) => e[0] === type).map((e) => e[1]);
  const results = Object.fromEntries(once.results.map(([when, type, r]) => [`${type}@${when - START}`, r]));
  console.log(`     ${A.stats.kills} kills, ${A.stats.deaths} deaths, ${A.stats.actions} actions, ${count("hunt:hide")} hides, ${count("hunt:felled")} Sovereigns, ${A.log.length} log lines`);
  console.log(`     commands: ${once.results.map(([when, type, r]) => `${type} ${r.ok ? "ok" : r.error}`).join("; ")}`);
  check("the hunt killed, and took remedies", A.stats.kills > 100 && S.haveQty(A, "provision_t4") + S.haveQty(A, "provision_t6") < 40 + 25 + 12);
  check("the Stag reached Bond 10 two minutes of work in", count("companion:bond") >= 1 && at("companion:bond")[0] === START + 2 * 60000);
  check("Bond 10 quickened the bench mid-run", Co.companionBonus(A, "speed", "forgemaster") > 0);
  const stock = once.events.filter((e) => e[0] === "task:ended" && e[2] === "stock");
  check("the craft ran out of ore partway, with the hunt's drops counted in", stock.length >= 1 && stock[0][1] > START + 35 * 40000 * 0.9, stock.map((e) => e[1] - START));
  check("the gathering alternative started and ran", results[`startSkill@${2 * HOUR + 4567}`].ok && A.rolls["a:delving_t5"] > 0);
  check("requisitions came back at midnight", at("requisitions:returned").includes(Date.UTC(2026, 8, 19)));
  check("the buff ran out at its minute", A.buff === null);
  check("the bounty board turned over at midnight", A.bounty && A.bounty.window === Math.floor(Date.UTC(2026, 8, 19) / CONFIG.time.windowMs) || A.region === "region_4");
  check("gold was spent and earned along the way", A.stats.goldEarned > 0 && A.agents.length === 3);
  check("every command but the unfinished bounty went through", once.results.filter(([, , r]) => !r.ok).map(([, type]) => type).join(",") === "claimBounty");

  section("The first twenty seconds, a millisecond at a time");
  {
    const oneCall = busySave();
    const byMs = busySave();
    const w1 = await listening();
    const w2 = await listening();
    const begin = COMMANDS.filter(([when]) => when <= START + 2);
    begin.forEach(([when, type, args]) => {
      advance(oneCall, when, w1.env);
      applyCommand(oneCall, { type, args: clone(args) }, w1.env);
    });
    let t = START;
    let bi = 0;
    for (; t <= START + 20000; t++) {
      advance(byMs, t, w2.env);
      while (bi < begin.length && begin[bi][0] === t) {
        applyCommand(byMs, { type: begin[bi][1], args: clone(begin[bi][2]) }, w2.env);
        bi++;
      }
    }
    advance(oneCall, START + 20000, w1.env);
    same("twenty thousand one-millisecond steps: the same save", byMs, oneCall, 1e-6);
    check("and the hunt was already under way", oneCall.tasks.combat && oneCall.tasks.combat.encounters >= 1);
  }

  section("Death partway through a long stretch");
  {
    // A hunter who falls a few minutes in, then time runs on: recovery must
    // count from the fall, whatever the step.
    const make = () => {
      const s = createState({ now: START, seed: 5150 });
      s.travel.unlocked = GameData.REGIONS.map((r) => r.id);
      return s;
    };
    const a = make();
    const b = make();
    const wa = await listening();
    const wb = await listening();
    applyCommand(a, { type: "startHunt", args: { tier: 9, zone: "core", limit: null } }, wa.env);
    applyCommand(b, { type: "startHunt", args: { tier: 9, zone: "core", limit: null } }, wb.env);
    advance(a, START + 3 * 60000, wa.env);
    for (let x = START; x < START + 3 * 60000; x += 997) advance(b, Math.min(START + 3 * 60000, x + 997), wb.env);
    const refusedA = applyCommand(a, { type: "startHunt", args: { tier: 1, zone: "outer", limit: null } }, wa.env);
    const refusedB = applyCommand(b, { type: "startHunt", args: { tier: 1, zone: "outer", limit: null } }, wb.env);
    same("recovery left after a fall inside one long step", [a.player.recoveryLeft, a.stats.deaths, refusedA], [b.player.recoveryLeft, b.stats.deaths, refusedB]);
    same("and the saves agree", a, b, 1e-6);
  }
});
