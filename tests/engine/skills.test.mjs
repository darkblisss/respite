/* The Crews: batch counts, limits, stock and storage stops, the twelve-hour
   cap, XP across a weather day boundary inside one long advance, doubles,
   reagents and crafted rarities rolled on counters, and the events.

     node tests/engine/skills.test.mjs */

import { run, check, section, same, shared, clone, put, listening } from "./harness.mjs";

await run(async () => {
  const { CONFIG } = await shared("config.js");
  const { GameData, findAction } = await shared("registry.js");
  const { createState } = await shared("state.js");
  const { advance, applyCommand } = await shared("engine.js");
  const Sk = await shared("skills.js");
  const S = await shared("storage.js");
  const P = await shared("progression.js");
  const I = await shared("items.js");
  const W = await shared("weather.js");
  const { roll, SALT } = await shared("rng.js");

  const DAY = CONFIG.time.dayMs;
  const CAP = CONFIG.time.idleCapMs;
  const T0 = Date.UTC(2026, 8, 16, 9, 0);
  const fresh = (seed = 5, now = T0) => createState({ now, seed });
  const start = (s, env, skillId, actionId, limit = null) => applyCommand(s, { type: "startSkill", args: { skillId, actionId, limit } }, env);
  const lastLog = (s) => s.log[s.log.length - 1].m;
  const mats = Object.keys(GameData.MATERIALS).filter((k) => !GameData.MATERIALS[k].heal);
  const fillAll = (s, keep = []) => {
    let i = 0;
    for (const w of S.POOLS) {
      while (!S.isFull(s, w)) {
        const k = mats[i++];
        if (!keep.includes(k)) put(s, w, k, 1);
      }
    }
  };

  section("Batches");
  {
    const { env, of } = await listening();
    const s = fresh();
    put(s, "bank", "slag_delve", 100);
    put(s, "bank", "coal", 100);
    check("start: craft exactly 3 Slag Bars", start(s, env, "forgemaster", "craft_slag_bar", 3).ok);
    const plan = Sk.skillPlan(s);
    check("the plan targets 3, capped by the limit", plan.target === 3 && plan.capped === "limit" && plan.timeLeft === 36000);
    advance(s, T0 + 12000, env);
    advance(s, T0 + 24000, env);
    advance(s, T0 + 35999, env);
    const mid = { done: s.tasks.skilling.done, bars: S.haveQty(s, "slag_bar"), progress: s.tasks.skilling.progress };
    advance(s, T0 + 36000, env);
    same("two done after 35,999ms, the third lands on 36,000ms", [mid, s.tasks.skilling, S.haveQty(s, "slag_bar"), S.haveQty(s, "slag_delve"), S.haveQty(s, "coal")],
      [{ done: 2, bars: 2, progress: 11999 }, null, 3, 94, 97]);
    check("the batch end leaves v4's log line", lastLog(s) === "Batch finished: 3 × Slag Bar in 36s.", lastLog(s));
    same("task:ended carries the reason, count and time", of("task:ended"), [{ skillId: "forgemaster", actionId: "craft_slag_bar", reason: "limit", done: 3, elapsedMs: 36000, at: T0 + 36000 }]);
    check("the log line is dated when the batch finished", s.log[s.log.length - 1].t === T0 + 36000);
    check("roll counters count the actions", s.rolls["a:craft_slag_bar"] === 3 && s.stats.actions === 3);
  }
  {
    const { env } = await listening();
    const s = fresh();
    check("start: open-ended Slag Ore", start(s, env, "delving", "delving_t1_raw").ok);
    const plan = Sk.skillPlan(s);
    check("no limit: the plan covers twelve hours (3,600 actions)", plan.target === 3600 && plan.capped === "time");
    advance(s, T0 + 100 * 12000, env);
    check("still running after 100 actions", !!s.tasks.skilling && s.tasks.skilling.done === 100 && s.tasks.skilling.limit === null && s.tasks.skilling.progress === 0);
    s.tasks.skilling.elapsed = CAP - 5000;
    advance(s, T0 + 100 * 12000 + 6000, env);
    check("no limit stops at the twelve-hour cap", s.tasks.skilling === null && /^Twelve hours at Slag Ore and 100 done\. The crews stand down\.$/.test(lastLog(s)), lastLog(s));
  }
  {
    const { env, of } = await listening();
    const s = fresh();
    put(s, "bank", "slag_delve", 7);
    put(s, "bank", "coal", 10);
    const def = findAction("forgemaster", "craft_slag_bar");
    check("actionMax respects stock (7 ore covers 3 bars)", Sk.actionMax(s, def) === 3);
    start(s, env, "forgemaster", "craft_slag_bar");
    const plan = Sk.skillPlan(s);
    check("the plan is capped by stock", plan.target === 3 && plan.capped === "stock");
    advance(s, T0 + 10 * 12000, env);
    same("stops when materials run out, at the action that couldn't be paid", [s.tasks.skilling, S.haveQty(s, "slag_bar"), lastLog(s), of("task:ended")[0].elapsedMs, of("task:ended")[0].at],
      [null, 3, "Slag Bar stopped after 48s: no materials left.", 48000, T0 + 48000]);
  }
  {
    const { env } = await listening();
    const s = fresh();
    fillAll(s, ["slag_delve"]);
    const before = clone(s);
    const res = start(s, env, "delving", "delving_t1_raw");
    same("with every pool full and nothing stacking, the work won't start", [res, s], [{ ok: false, error: "Nowhere to put anything." }, before]);
  }
  {
    const { env } = await listening();
    const s = fresh();
    start(s, env, "delving", "delving_t1_raw");
    advance(s, T0 + 6000, env);
    start(s, env, "delving", "delving_t1_raw", 10);
    same("starting the same work again keeps the action underway", [s.tasks.skilling.progress, s.tasks.skilling.limit, s.tasks.skilling.done], [6000, 10, 0]);
    advance(s, T0 + 12000, env);
    check("and it completes when the kept progress says so", s.tasks.skilling.done === 1);
    start(s, env, "delving", "delving_t1_reag");
    check("other work replaces it and starts from nothing", s.tasks.skilling.actionId === "delving_t1_reag" && s.tasks.skilling.progress === 0);
    check("stopSkill is idempotent", applyCommand(s, { type: "stopSkill", args: {} }, env).ok && s.tasks.skilling === null && applyCommand(s, { type: "stopSkill" }, env).ok);
  }

  /* The Wealth board's basis: value counted as it is created, never again, and
     never for anything that came from somewhere else. See stats.selfMade. */
  section("What a player makes");
  {
    const { env } = await listening();
    const s = fresh();
    const ore = I.itemDef("slag_delve").value;
    check("a fresh camp has made nothing", s.stats.selfMade === 0);
    start(s, env, "delving", "delving_t1_raw", 5);
    advance(s, T0 + 5 * 12000, env);
    const dug = S.haveQty(s, "slag_delve");
    check("gathering counts every unit it pulled up, doubles and all",
      s.stats.selfMade === Math.round(dug * ore) && dug >= 5, { made: s.stats.selfMade, dug, ore });

    // A bench counts what it added, not the whole bar: the ore was counted when it was dug.
    const before = s.stats.selfMade;
    put(s, "bank", "slag_delve", 100);
    put(s, "bank", "coal", 100);
    const made = S.haveQty(s, "slag_bar");
    start(s, env, "forgemaster", "craft_slag_bar", 1);
    advance(s, T0 + 5 * 12000 + 12000, env);
    const def = findAction("forgemaster", "craft_slag_bar");
    const added = I.itemDef("slag_bar").value * def.out.slag_bar
      - Object.keys(def.cost).reduce((n, k) => n + I.itemDef(k).value * def.cost[k], 0);
    check("a craft counts the value it added over the materials it ate",
      S.haveQty(s, "slag_bar") > made && s.stats.selfMade === before + Math.round(Math.max(0, added)),
      { before, now: s.stats.selfMade, added });

    // Everything that arrives some other way is worth nothing to the board.
    const held = s.stats.selfMade;
    put(s, "bank", "slag_bar", 500);
    s.player.gold += 100000;
    applyCommand(s, { type: "buyRemedy", args: { key: "provision_t1", qty: 1 } }, env);
    check("bought, granted and looted goods never count", s.stats.selfMade === held, { held, now: s.stats.selfMade });

    // It is a record of work done, so parting with the work does not undo it.
    applyCommand(s, { type: "sellItem", args: { pool: "bank", key: "slag_bar", qty: 100 } }, env);
    check("selling what you made does not take it back off you", s.stats.selfMade === held, { held, now: s.stats.selfMade });
  }

  section("Storage stops");
  {
    // Crafted gear needs a free slot unless it rolls common and stacks. Pick a
    // counter where the next two crafts both roll finer than common.
    const s = fresh(21);
    const key = "a:craft_slag_sword";
    let n = 0;
    while (!(I.rarityFromRoll(roll(s.rng.seed, key, n, SALT.rarity)) !== "common" && I.rarityFromRoll(roll(s.rng.seed, key, n + 1, SALT.rarity)) !== "common")) n++;
    s.rolls[key] = n;
    s.skills.forgemaster = CONFIG.xpTable[1];
    fillAll(s, ["slag_blade", "bitter_handle"]);
    // Two slots back: one for the materials, one free for the first sword.
    const drop = S.orderedKeys(s, "inv").slice(0, 2);
    drop.forEach((k) => { delete s.inv.items[k]; });
    s.inv.order = s.inv.order.filter((k) => !drop.includes(k));
    delete s.bank.items[s.bank.order[0]];
    s.bank.order.shift();
    put(s, "inv", "slag_blade", 5);
    put(s, "bank", "bitter_handle", 5);
    const { env, of } = await listening();
    const time = findAction("forgemaster", "craft_slag_sword").time;
    check("start with one free slot", start(s, env, "forgemaster", "craft_slag_sword").ok);
    advance(s, T0 + 3 * time, env);
    const ended = of("task:ended")[0];
    const swords = Object.keys(s.inv.items).filter((k) => k.startsWith("slag_sword|"));
    same("the second unique piece has nowhere to go: the task ends with storage, unpaid", [ended && ended.reason, ended && ended.done, ended && ended.elapsedMs, swords.length, S.haveQty(s, "slag_blade"), S.haveQty(s, "bitter_handle")],
      ["storage", 1, 2 * time, 1, 4, 4]);
    check("with v4's line, the Stockpile named", lastLog(s) === `Slag Sword stopped after ${Math.round(2 * time / 60000)}m 0s: Belongings, the Stockpile and the Vault are all full.`, lastLog(s));
    same("the first sword carries its counter uid", swords, [`slag_sword|${I.rarityFromRoll(roll(s.rng.seed, key, n, SALT.rarity))}|c${I.craftIndex("craft_slag_sword")}.${n}${I.rarityFromRoll(roll(s.rng.seed, key, n, SALT.rarity)) === "relic" ? "|" + I.prefixFromRoll("slag_sword", roll(s.rng.seed, key, n, SALT.prefix)) : ""}`]);
    check("the counter only moved for the action that happened", s.rolls[key] === n + 1);
  }
  {
    // A reagent with nowhere to go is left behind; the work goes on.
    const s = fresh(8);
    s.skills.delving = CONFIG.xpTable[20];
    put(s, "bank", "rime_delve", 1);
    fillAll(s, ["coal", "rime_delve"]);
    const key = "a:delving_t3";
    const def = findAction("delving", "delving_t3");
    let n = 0;
    while (!(roll(s.rng.seed, key, n, SALT.reagent) < def.reagentChance && roll(s.rng.seed, key, n + 1, SALT.reagent) >= def.reagentChance)) n++;
    s.rolls[key] = n;
    const { env, of } = await listening();
    start(s, env, "delving", "delving_t3", 2);
    advance(s, T0 + 2 * def.time, env);
    same("storage:full for the reagent, then the batch finishes", [of("storage:full"), of("task:ended").map((e) => e.reason), S.haveQty(s, "coal"), s.log.some((l) => l.m === "Nowhere to put Coal.")],
      [[{ key: "coal", at: T0 + def.time }], ["limit"], 0, true]);
  }

  section("Rolls on counters");
  {
    const s = fresh(1234);
    s.skills.delving = CONFIG.xpTable[90];
    s.skills.forgemaster = CONFIG.xpTable[90];
    s.player.gold = 9999;
    const { env } = await listening();
    applyCommand(s, { type: "buyCompanion", args: { id: "rat" } }, env);
    s.companions.owned.rat.bond = CONFIG.bondXpFor(20);
    const def = findAction("delving", "delving_t9");
    start(s, env, "delving", "delving_t9", 600);
    const chance = P.doubleChance(s, "delving");
    const reagentBonus = (await shared("companions.js")).companionBonus(s, "reagent", "delving");
    const time = P.actionTime(s, def);
    const twin = clone(s);
    advance(s, T0 + 600 * time, env);
    let ore = 0;
    let coal = 0;
    for (let i = 0; i < 600; i++) {
      ore += roll(s.rng.seed, "a:delving_t9", i, SALT.double) < chance ? 2 : 1;
      if (roll(s.rng.seed, "a:delving_t9", i, SALT.reagent) < def.reagentChance * (1 + reagentBonus)) coal++;
    }
    same("600 actions: doubles and reagents are exactly the counter rolls", [S.haveQty(s, "titan_delve"), S.haveQty(s, "coal"), s.rolls["a:delving_t9"]], [ore, coal, 600]);
    check("doubles land near their chance", Math.abs((ore - 600) / 600 - chance) < 0.05, `${(ore - 600) / 600} vs ${chance}`);
    const { env: env2 } = await listening();
    for (let i = 0; i < 40; i++) advance(twin, T0 + ((i + 1) / 40) * 600 * time, env2);
    same("the same save sliced into 40 steps makes exactly the same", twin, s);
  }
  {
    const s = fresh(77);
    const def = findAction("artificer", "craft_slag_ring");
    Object.keys(def.cost).forEach((k) => put(s, "vault", k, 5000));
    s.bank.slots = 200;
    const { env, of } = await listening();
    check("start: 150 Slag Rings", start(s, env, "artificer", "craft_slag_ring", 150).ok);
    advance(s, T0 + 150 * def.time, env);
    const idx = I.craftIndex(def.id);
    const expected = [];
    let epics = 0;
    for (let n = 0; n < 150; n++) {
      const rarity = I.rarityFromRoll(roll(s.rng.seed, `a:${def.id}`, n, SALT.rarity));
      const prefix = rarity === "relic" ? I.prefixFromRoll(def.craftGear, roll(s.rng.seed, `a:${def.id}`, n, SALT.prefix)) : null;
      expected.push(I.makeKey(def.craftGear, rarity, `c${idx}.${n}`, prefix));
      if (["epic", "legendary", "relic"].includes(rarity)) epics++;
    }
    const crafted = of("item:crafted");
    same("150 crafted rings: rarity, uid and prefix from the counter", crafted.map((e) => e.key), expected);
    check("every crafted key is valid, and common ones stack", crafted.every((e) => I.validKey(e.key)) && S.haveQty(s, `${def.craftGear}|common`) === expected.filter((k) => k.endsWith("|common")).length);
    check("uids are unique and derived", new Set(expected.filter((k) => !k.endsWith("|common"))).size === expected.filter((k) => !k.endsWith("|common")).length && crafted.filter((e) => e.rarity !== "common").every((e) => I.parseKey(e.key).uid.startsWith(`c${idx}.`)));
    same("stats.crafted and stats.epics", [s.stats.crafted, s.stats.epics], [150, epics]);
    check("craftIndex is the place in all benches' lists", Object.values(GameData.CRAFT_ACTIONS).flat()[idx].id === def.id && I.craftIndex("nope") === -1);
    check("rare outcomes only reach the log when Legendary or better", s.log.filter((l) => /comes off the bench/.test(l.m)).length === crafted.filter((e) => e.rarity === "legendary" || e.rarity === "relic").length);
  }
  {
    /* Tools are rolled like gear. A Common one is its bare base and stacks with
       the tools already held; anything finer is its own piece, racked whole. */
    const s = fresh(91);
    const def = findAction("woodwright", "craft_gnarl_axe");
    const base = Object.keys(def.out)[0];
    check("a tool recipe rolls its rarity and still says what it makes", def.rollsRarity === true && base === "gnarl_axe" && !def.craftGear);
    Object.keys(def.cost).forEach((k) => put(s, "vault", k, 5000));
    s.skills.woodwright = CONFIG.xpTable[99];
    s.bank.slots = 200;
    const { env, of } = await listening();
    // As many as the twelve-hour cap lets one task make.
    const N = Math.min(120, Math.floor(CAP / def.time));
    check(`start: ${N} Gnarl Axes`, start(s, env, "woodwright", "craft_gnarl_axe", N).ok);
    advance(s, T0 + N * def.time, env);
    const idx = I.craftIndex(def.id);
    const expected = [];
    for (let n = 0; n < N; n++) {
      const rarity = I.rarityFromRoll(roll(s.rng.seed, `a:${def.id}`, n, SALT.rarity));
      const prefix = rarity === "relic" ? I.prefixFromRoll(base, roll(s.rng.seed, `a:${def.id}`, n, SALT.prefix)) : null;
      expected.push(rarity === "common" ? base : I.makeKey(base, rarity, `c${idx}.${n}`, prefix));
    }
    const crafted = of("item:crafted");
    same(`${N} crafted axes: rarity, uid and prefix from the counter`, crafted.map((e) => e.key), expected);
    check("every crafted tool key is valid, and Common ones stack as the bare base",
      crafted.every((e) => I.validKey(e.key)) && S.haveQty(s, base) === expected.filter((k) => k === base).length);
    const fine = expected.find((k) => k !== base && !k.includes("|relic|"));
    check("at least one axe came out finer than Common", !!fine);
    const d = I.itemDef(fine);
    check("a finer tool is quicker and worth more", d.speed > GameData.TOOLS[base].speed && d.value >= GameData.TOOLS[base].value);
    const from = S.POOLS.find((w) => (s[w].items[fine] || 0) > 0);
    check("equip the finer axe", applyCommand(s, { type: "equip", args: { key: fine, from } }, env).ok);
    check("the rack holds it whole, and it left the pool", s.tools.felling === fine && !S.POOLS.some((w) => s[w].items[fine]));
    check("toolFor reads its rarity", Math.abs(P.toolFor(s, "felling").speed - d.speed) < 1e-12);
    const chop = findAction("felling", GameData.GATHER_ACTIONS.felling[0].id);
    const plainTime = Math.max(1000, Math.round(chop.time * (1 - GameData.TOOLS[base].speed)));
    check("and the crews work quicker for it", P.actionTime(s, chop) <= plainTime);
    const { migrateSave } = await shared("state.js");
    const again = migrateSave(clone(s), { now: s.clock, seed: s.rng.seed });
    check("a save keeps the racked piece, and holds it once", again.tools.felling === fine && !S.POOLS.some((w) => again[w].items[fine]));
    check("unequipTool puts the whole piece back", applyCommand(s, { type: "unequipTool", args: { skillId: "felling" } }, env).ok && !s.tools.felling && s.bank.items[fine] === 1);
    check("equip a Common axe racks the bare base", applyCommand(s, { type: "equip", args: { key: base, from: S.POOLS.find((w) => s[w].items[base]) } }, env).ok && s.tools.felling === base);
  }

  section("XP across a weather day boundary");
  {
    // A day where Delving's weather changes at midnight.
    let day = Math.floor(T0 / DAY);
    const pct = (d) => W.weatherForDay(d).mods.delving || 0;
    while (pct(day) === pct(day + 1)) day++;
    const midnight = (day + 1) * DAY;
    const startAt = midnight - 10 * 12000 - 5000;
    const s = fresh(3, startAt);
    s.skills.delving = CONFIG.xpTable[10];
    const { env } = await listening();
    start(s, env, "delving", "delving_t1_raw", 20);
    const xp0 = s.skills.delving;
    let expected = 0;
    for (let i = 1; i <= 20; i++) expected += P.xpEach(s, "delving", findAction("delving", "delving_t1_raw").xp, startAt + i * 12000);
    advance(s, startAt + 3 * 3600000, env);
    const before = P.xpMult(s, "delving", midnight - 1);
    const after = P.xpMult(s, "delving", midnight);
    check(`the weather changes Delving XP at midnight (${before} to ${after})`, before !== after);
    same("one long advance pays each action at its own day's weather", s.skills.delving - xp0, expected);
    check("ten actions before midnight, ten after", s.tasks.skilling === null && s.log.some((l) => l.m.startsWith("Batch finished: 20")));
  }

  section("Bounties, Bond and finds");
  {
    const s = fresh(9);
    s.bounty = { window: W.windowIndex(s.clock), region: "region_1", kind: "gather", targetId: "slag_delve", label: "Bring in 5 Slag Ore", amount: 5, progress: 0, claimed: false, gold: 8 };
    s.skills.delving = CONFIG.xpTable[99];
    const { env, of } = await listening();
    start(s, env, "delving", "delving_t1_raw", 12);
    advance(s, T0 + 12 * P.actionTime(s, findAction("delving", "delving_t1_raw")), env);
    same("gathering counts toward a gather bounty (the recipe's yield, not the doubles), completion announced once", [s.bounty.progress, of("bounty:complete").length], [12, 1]);
  }
  {
    const s = fresh(10);
    s.player.gold = 2000;
    const { env, of } = await listening();
    applyCommand(s, { type: "buyCompanion", args: { id: "rat" } }, env);
    advance(s, T0 + 60000, env);
    const idle = s.companions.owned.rat.bond;
    start(s, env, "delving", "delving_t1_raw");
    for (let i = 1; i <= 300; i++) advance(s, T0 + 60000 + i * 1000, env);
    same("Bond grows only while working: five minutes is exactly 5 Bond", [idle, s.companions.owned.rat.bond], [0, 5]);
    advance(s, T0 + 60000 + 30 * 60000, env);
    same("Bond 2 lands at 30 minutes of work, dated to the millisecond", of("companion:bond"), [{ id: "rat", level: 2, unlocks: [], at: T0 + 60000 + 30 * 60000 }]);
    check("with v4's line", s.log.some((l) => l.m === "Tunnel Rat reaches Bond 2." && l.t === T0 + 60000 + 30 * 60000));
  }
  {
    const s = fresh(11);
    s.player.gold = 2000;
    const { env, of } = await listening();
    applyCommand(s, { type: "buyCompanion", args: { id: "rat" } }, env);
    const key = "a:delving_t1_raw";
    const i = GameData.COMPANIONS.findIndex((c) => c.id === "rat");
    let n = 0;
    while (!(roll(s.rng.seed, key, n, SALT.companion + i) < GameData.COMPANIONS[i].findChance)) n++;
    s.rolls[key] = n;
    start(s, env, "delving", "delving_t1_raw", 1);
    advance(s, T0 + 12000, env);
    same("a find on the action's counter: a duplicate and a Rank", [of("companion:found"), s.companions.owned.rat], [[{ id: "rat", rank: 2, dupes: 0, need: 1, rankUp: true, at: T0 + 12000 }], { bond: 12000 / 60000, rank: 2, dupes: 0 }]);
    check("with v4's line", s.log.some((l) => l.m === "A second Tunnel Rat has been trailing you. Tunnel Rat rises to Rank II."));
  }
  {
    const s = fresh(12);
    s.skills.delving = CONFIG.xpTable[10] - 3;
    const { env, of } = await listening();
    start(s, env, "delving", "delving_t1_raw", 5);
    advance(s, T0 + 60000, env);
    same("skill:level and skill:mastery at Lv 10", [of("skill:level").map((e) => e.level), of("skill:mastery").map((e) => e.label)], [[10], ["Steady Hands"]]);
    check("the level reaches the log, the mastery toast does not", s.log.some((l) => l.m === "Delving reaches level 10.") && !s.log.some((l) => /Steady/.test(l.m)));
  }

  section("Timing");
  {
    const s = fresh(13);
    const { env } = await listening();
    check("nextSkillDue is Infinity when idle", Sk.nextSkillDue(s) === Infinity);
    start(s, env, "delving", "delving_t1_raw", 3);
    advance(s, T0 + 5000, env);
    check("nextSkillDue counts to the next completion", Sk.nextSkillDue(s) === 7000);
    check("resolveSkilling returns dt while the task runs", Sk.resolveSkilling(s, 1000, env, s.clock) === 1000);
    const t = clone(s.tasks.skilling);
    check("and the offset at which it ended", Sk.resolveSkilling(s, 60000, env, s.clock) === 12000 * 3 - t.progress && s.tasks.skilling === null);
    const s2 = fresh(14);
    start(s2, env, "delving", "delving_t1_raw");
    s2.tasks.skilling.progress = 30000;
    check("an overdue action (the crews got quicker) is due now", Sk.nextSkillDue(s2) === 0);
    advance(s2, T0 + 1, env);
    check("and lands at once, both of them", s2.tasks.skilling.done === 2 && s2.tasks.skilling.progress === 6001);
    const s3 = fresh(15);
    start(s3, env, "delving", "delving_t1_raw");
    s3.tasks.skilling.elapsed = CAP - 4000;
    check("nextSkillDue stops at the cap", Sk.nextSkillDue(s3) === 4000);
    const s4 = fresh(16);
    start(s4, env, "delving", "delving_t1_raw");
    advance(s4, T0 + 13 * 3600000, env);
    same("a thirteen-hour advance: exactly twelve hours of work", [s4.tasks.skilling, S.haveQty(s4, "slag_delve") >= 3600, s4.stats.actions, s4.meta.playtimeMs], [null, true, 3600, CAP]);
  }
});
