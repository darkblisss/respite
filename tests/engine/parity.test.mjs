/* Parity with v4. The v4 scripts run in a vm context; the v5 modules are
   imported; the same questions go to both and the answers must match, value
   for value. Projections must match exactly (same seeds, same floats): that
   is the proof the encounter engine was ported faithfully.

     node tests/engine/parity.test.mjs */

import { run, check, section, same, loadV4, shared, clone, gearSet } from "./harness.mjs";

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

await run(async () => {
  section("Loading");
  const v4 = loadV4();
  check("v4 reference loaded", v4("typeof projectOnce") === "function" && v4("typeof migrate") === "function");
  const { CONFIG } = await shared("config.js");
  const { GameData } = await shared("registry.js");
  const I = await shared("items.js");
  const St = await shared("stats.js");
  const P = await shared("progression.js");
  const Wx = await shared("weather.js");
  const Wd = await shared("world.js");
  const Co = await shared("companions.js");
  const Cb = await shared("combat.js");
  const Sk = await shared("skills.js");
  const Sto = await shared("storage.js");
  const { createState } = await shared("state.js");
  const RNG = await shared("rng.js");

  const DAY = CONFIG.time.dayMs;
  const WINDOW = CONFIG.time.windowMs;
  const T0 = Date.UTC(2026, 8, 16, 9, 30);

  // Runs fn over inputs on both sides; reports the first input that differs.
  function sameOver(name, inputs, oldFn, newFn) {
    for (const input of inputs) {
      const a = attempt(() => oldFn(input));
      const b = attempt(() => newFn(input));
      const sa = JSON.stringify(a === undefined ? null : a);
      const sb = JSON.stringify(b === undefined ? null : b);
      if (sa !== sb) return check(name, false, `input ${JSON.stringify(input)}\n     v4: ${String(sa).slice(0, 400)}\n     v5: ${String(sb).slice(0, 400)}`);
    }
    return check(`${name} (${inputs.length} inputs)`, true);
  }
  function attempt(fn) {
    try {
      return fn();
    } catch (e) {
      return { threw: String(e && e.name) };
    }
  }

  // A v5 save and the same save as v4's global `state`.
  function both(mutate) {
    const s = createState({ now: T0, seed: 99 });
    if (mutate) mutate(s);
    v4.set("state", clone(s));
    return s;
  }

  /* ---------- items ---------- */
  section("Item keys");
  const gearIds = Object.keys(GameData.GEAR);
  const toolIds = Object.keys(GameData.TOOLS);
  const matIds = Object.keys(GameData.MATERIALS);
  const keys = [...matIds];
  gearIds.forEach((id) => {
    const g = GameData.GEAR[id];
    const family = g.slot === "weapon" || g.slot === "offhand" ? GameData.WEAPON_PREFIXES : GameData.ARMOUR_PREFIXES;
    keys.push(id, `${id}|common`, `${id}|uncommon|17`, `${id}|rare|c3.4`, `${id}|epic|s9.1`, `${id}|legendary|f2.9`);
    family.forEach((p) => keys.push(`${id}|relic|17|${p.id}`));
  });
  toolIds.forEach((id) => keys.push(id, `${id}|common`, `${id}|rare|5`, `${id}|relic|5|vital`));
  sameOver("itemDef for every key shape of every base", keys, (k) => v4.call("itemDef", k), (k) => I.itemDef(k));
  sameOver("itemName for every key shape of every base", keys, (k) => v4.call("itemName", k), (k) => I.itemName(k));
  sameOver("parseKey and stacks", keys, (k) => [v4.call("parseKey", k), v4.call("stacks", k)], (k) => [I.parseKey(k), I.stacks(k)]);
  sameOver("itemDef and itemName for unknown bases", ["nope", "nope|common", "", "slag|rare|1"],
    (k) => [v4.call("itemDef", k), v4.call("itemName", k)], (k) => [I.itemDef(k), I.itemName(k)]);
  check("itemDef results are frozen and cached", Object.isFrozen(I.itemDef("slag_sword|rare|1")) && I.itemDef("slag_sword|rare|1") === I.itemDef("slag_sword|rare|2"));

  section("Rolls from a number");
  const rolls = [...range(0, 999).map((i) => i / 1000), 0.8, 0.945, 0.985, 0.997, 0.9995, 0.99999, 0.7999999, 0.9449999];
  const withRandom = (r, fn) => {
    v4.set("Math.random", () => r);
    return v4(fn);
  };
  sameOver("rarityFromRoll = rollRarity", rolls, (r) => withRandom(r, "rollRarity()"), (r) => I.rarityFromRoll(r));
  sameOver("fineRarityFromRoll = rollFineRarity", rolls, (r) => withRandom(r, "rollFineRarity()"), (r) => I.fineRarityFromRoll(r));
  sameOver("agentRarityFromRoll = rollAgentRarity", rolls, (r) => withRandom(r, "rollAgentRarity()"), (r) => I.agentRarityFromRoll(r));
  const prefixInputs = rolls.filter((_, i) => i % 50 === 0).flatMap((r) => ["slag_sword", "bitter_shield", "slag_helm", "mud_amulet", "slag_pick", "nope"].map((b) => [b, r]));
  sameOver("prefixFromRoll = rollPrefix", prefixInputs, ([b, r]) => withRandom(r, `rollPrefix(${JSON.stringify(b)})`), ([b, r]) => I.prefixFromRoll(b, r));

  /* ---------- stats ---------- */
  section("Stats");
  sameOver("levelFromXp", [...range(0, 200).map((i) => i * 997), ...CONFIG.xpTable, ...CONFIG.xpTable.map((x) => x - 1), 1e12, -5, NaN],
    (x) => v4.call("levelFromXp", x), (x) => St.levelFromXp(x));
  sameOver("bondLevelFrom", [...range(0, 300).map((i) => i * 20.5), ...range(1, 20).map((l) => CONFIG.bondXpFor(l)), ...range(1, 20).map((l) => CONFIG.bondXpFor(l) - 0.001)],
    (b) => v4.call("bondLevelFrom", b), (b) => St.bondLevelFrom(b));

  const mixed = {
    weapon: "star_sword|relic|1|echoing", offhand: "umber_shield|relic|2|wounding", head: "star_helm|relic|3|thorned",
    chest: "star_chest|relic|4|stalwart", hands: "star_hgaunts|relic|5|resilient", feet: "star_hboots|relic|6|bulwark",
    neck: "blood_amulet|relic|7|furious", ring: "star_ring|relic|8|executioner",
  };
  const sundering = { ...gearSet(GameData, 4, "rogue", "rare"), weapon: "cairn_dagger|relic|3|sundering" };
  const kits = [{}, gearSet(GameData, 1, "warrior"), gearSet(GameData, 3, "rogue", "uncommon"), gearSet(GameData, 5, "mage", "rare"),
    gearSet(GameData, 7, "warrior", "epic"), gearSet(GameData, 9, "light", "relic"), gearSet(GameData, 9, "rogue", "relic"), mixed, sundering];
  const loadouts = [];
  [1, 4, 5, 12, 20, 33, 40, 60, 80, 99].forEach((level) => [null, "warrior", "rogue", "mage"].forEach((klass) => kits.forEach((equipment) => loadouts.push({ level, klass, equipment }))));
  sameOver("combatStats for a spread of loadouts", loadouts, (lo) => v4.call("combatStats", lo), (lo) => St.combatStats(lo));
  const mitInputs = [0, 0.5, 1, 3, 7, 20, 55, 150, 1e6, -1, NaN].flatMap((d) => range(1, 9).map((t) => [d, t]));
  sameOver("mitigation", mitInputs, ([d, t]) => v4.call("mitigation", d, t), ([d, t]) => St.mitigation(d, t));
  sameOver("equipStat and hasPrefix", kits.flatMap((eq) => ["attack", "defence", "health", "crit", "veil", "echoing", "vital", "bulwark"].map((x) => [eq, x])),
    ([eq, x]) => [v4.call("equipStat", x, eq), v4.call("hasPrefix", x, eq)], ([eq, x]) => [St.equipStat(eq, x), St.hasPrefix(eq, x)]);
  {
    const s = both((st) => { st.skills.warfare = CONFIG.xpTable[37] + 5; st.player.klass = "rogue"; st.equipment = gearSet(GameData, 4, "rogue"); });
    same("statsOf and maxHp read the save", [v4("combatStats()"), v4("maxHp()"), v4("canPickClass()")], [St.statsOf(s), St.maxHp(s), St.canPickClass(s)]);
    const s2 = both((st) => { st.skills.warfare = CONFIG.xpTable[5]; });
    same("canPickClass at Hunt 5 with no discipline", v4("canPickClass()"), St.canPickClass(s2));
    same("skillLevel and totalLevel", [v4("skillLevel('warfare')"), v4("totalLevel()")], [St.skillLevel(s2, "warfare"), St.totalLevel(s2)]);
  }

  /* ---------- speed, doubles, companions ---------- */
  section("Speed, doubles and companions");
  const gatherDefs = Object.values(GameData.GATHER_ACTIONS).flat();
  const craftDefs = Object.values(GameData.CRAFT_ACTIONS).flat();
  const sampleDefs = [...gatherDefs.filter((_, i) => i % 3 === 0), ...craftDefs.filter((_, i) => i % 11 === 0)];
  const setups = [
    { name: "bare hands", mutate: () => {} },
    { name: "tools", mutate: (st) => { st.tools = { delving: "star_pick", felling: "bitter_axe", harvesting: "godsbane_sickle", flaying: "cured_knife", dredging: "void_net" }; } },
    { name: "Tunnel Rat at Bond 20 Rank 3", mutate: (st) => { st.companions = { owned: { rat: { bond: CONFIG.bondXpFor(20), rank: 3, dupes: 0 } }, active: "rat" }; st.tools = { delving: "titan_pick" }; } },
    { name: "Carrion Crow at Bond 10", mutate: (st) => { st.companions = { owned: { crow: { bond: CONFIG.bondXpFor(10), rank: 2, dupes: 1 } }, active: "crow" }; } },
    { name: "Veil Stag at Bond 20 Rank 5", mutate: (st) => { st.companions = { owned: { stag: { bond: CONFIG.bondXpFor(20), rank: 5, dupes: 0 } }, active: "stag" }; st.tools = { dredging: "mud_net" }; } },
    { name: "owned but at camp", mutate: (st) => { st.companions = { owned: { marshcat: { bond: 5000, rank: 4, dupes: 2 } }, active: null }; } },
  ];
  const skillLevels = [1, 10, 25, 50, 90, 99];
  for (const setup of setups) {
    for (const lvl of skillLevels) {
      const s = both((st) => {
        setup.mutate(st);
        GameData.SKILLS.forEach((sk) => { st.skills[sk.id] = CONFIG.xpTable[lvl]; });
      });
      const ok = sampleDefs.every((def) => JSON.stringify([v4.call("actionTime", def), v4.call("speedMod", def.skillId), v4.call("doubleChance", def.skillId), v4.call("mastery", def.skillId), v4.call("toolFor", def.skillId)])
        === JSON.stringify([P.actionTime(s, def), P.speedMod(s, def.skillId), P.doubleChance(s, def.skillId), P.mastery(s, def.skillId), P.toolFor(s, def.skillId)]));
      if (!ok || lvl === 99) check(`actionTime, speedMod, doubleChance, mastery, toolFor: ${setup.name} at Lv ${lvl}`, ok);
    }
  }
  {
    const kinds = ["xp", "double", "reagent", "speed", "gold", "drops", "rare"];
    const skillIds = [...GameData.SKILLS.map((x) => x.id), undefined];
    const cases = [];
    GameData.COMPANIONS.forEach((def) => [0, 29.99, 30, CONFIG.bondXpFor(5), CONFIG.bondXpFor(10) - 1, CONFIG.bondXpFor(10), CONFIG.bondXpFor(20)].forEach((bond) => [1, 2, 3, 5].forEach((rank) => cases.push({ id: def.id, bond, rank }))));
    let bad = null;
    for (const c of cases) {
      const s = both((st) => { st.companions = { owned: { [c.id]: { bond: c.bond, rank: c.rank, dupes: 1 } }, active: c.id }; });
      const a = JSON.stringify([v4.call("companionInfo", c.id), kinds.map((k) => skillIds.map((sk) => v4.call("companionBonus", k, sk))), v4("activeCompanion()")]);
      const b = JSON.stringify([Co.companionInfo(s, c.id), kinds.map((k) => skillIds.map((sk) => Co.companionBonus(s, k, sk))), Co.activeCompanion(s)]);
      if (a !== b) { bad = c; break; }
    }
    check(`companionInfo and companionBonus for every companion, Bond and Rank (${cases.length} saves)`, !bad, bad && JSON.stringify(bad));
    const s = both((st) => { st.companions = { owned: { hound: { bond: 100, rank: 2, dupes: 0 } }, active: null }; });
    same("companionInfo for companions not owned or at camp", GameData.COMPANIONS.map((d) => v4.call("companionInfo", d.id)), GameData.COMPANIONS.map((d) => Co.companionInfo(s, d.id)));
  }

  /* ---------- weather ---------- */
  section("Weather");
  const day0 = Math.floor(T0 / DAY);
  sameOver("weatherForDay for 60 days", range(day0 - 30, day0 + 29), (d) => v4.call("weatherForDay", d), (d) => Wx.weatherForDay(d));
  const moments = range(0, 20).map((i) => T0 + i * 7 * 3600000 + 1234);
  sameOver("weekForecast, tomorrowRevealed and windowEndsIn at fixed times", moments,
    (ms) => { v4.now(ms); return [v4("weekForecast()"), v4("tomorrowRevealed()"), v4("windowEndsIn()"), v4("dayIndex()"), v4("currentWindow()")]; },
    (ms) => [Wx.weekForecast(ms), Wx.tomorrowRevealed(ms), Wx.windowEndsIn(ms), Wx.dayIndex(ms), Wx.windowIndex(ms)]);
  sameOver("weekdayOf, weekStartOf and isBountiful", range(-10, 30).map((i) => day0 + i),
    (d) => [v4.call("weekdayOf", d), v4.call("weekStartOf", d), v4.call("isBountiful", d)], (d) => [Wx.weekdayOf(d), Wx.weekStartOf(d), Wx.isBountiful(d)]);

  /* ---------- xp ---------- */
  section("XP multipliers");
  {
    const cases = [];
    range(0, 13).forEach((i) => [false, true].forEach((buff) => [null, "stag", "rat", "hound"].forEach((comp) => cases.push({ at: T0 + i * DAY + 5000, buff, comp }))));
    let bad = null;
    for (const c of cases) {
      v4.now(c.at);
      const s = both((st) => {
        st.clock = c.at;
        st.buff = c.buff ? { until: c.at + 1000, mult: 2 } : { until: c.at, mult: 2 };
        if (c.comp) st.companions = { owned: { [c.comp]: { bond: CONFIG.bondXpFor(20), rank: 3, dupes: 0 } }, active: c.comp };
      });
      const ids = GameData.SKILLS.map((x) => x.id);
      const a = JSON.stringify(ids.map((id) => [v4.call("xpMult", id), v4.call("xpEach", id, 7), v4.call("xpEach", id, 0.3)]));
      const b = JSON.stringify(ids.map((id) => [P.xpMult(s, id, c.at), P.xpEach(s, id, 7, c.at), P.xpEach(s, id, 0.3, c.at)]));
      if (a !== b) { bad = c; break; }
    }
    check(`xpMult and xpEach for every skill across 14 days, bountiful weekends, buffs and companions (${cases.length} moments)`, !bad, bad && JSON.stringify(bad));
  }

  /* ---------- camp ---------- */
  section("Bounties, the shop, requisitions");
  {
    const inputs = [];
    range(0, 19).forEach((i) => GameData.REGIONS.forEach((r) => inputs.push({ w: Math.floor(T0 / WINDOW) + i * 3 - 20, region: r.id })));
    sameOver("makeBounty for 20 windows in every region", inputs,
      ({ w, region }) => { v4.now(w * WINDOW + 777); both((st) => { st.region = region; }); return v4("makeBounty()"); },
      ({ w, region }) => { const s = createState({ now: w * WINDOW + 777, seed: 1 }); s.region = region; return Wd.makeBounty(s, w); });
    sameOver("smugglerStock for 20 windows", range(0, 19).map((i) => Math.floor(T0 / WINDOW) + i * 5 - 50),
      (w) => { v4.now(w * WINDOW + 1); return v4("smugglerStock()"); },
      (w) => Wd.smugglerStock(createState({ now: w * WINDOW + 1, seed: 1 })).map(({ bought, ...rest }) => rest));
    same("shopStock: every remedy at its price", v4("shopStock()"), Wd.shopStock(createState({ now: T0, seed: 1 })));
    sameOver("salvageValue for every gear and tool", [...gearIds.map((id) => `${id}|common`), ...gearIds.map((id) => `${id}|relic|4|vital`), ...toolIds, ...matIds.slice(0, 20)],
      (k) => v4.call("salvageValue", k), (k) => Wd.salvageValue(k));
    const wearInputs = gearIds.filter((_, i) => i % 7 === 0).flatMap((id) => [0, 1, 79, 80, 81, 500, 1000].map((w) => [`${id}|rare|3`, w]));
    sameOver("repairCost and wearPct", wearInputs,
      ([k, w]) => { both((st) => { st.wear = { [k]: w }; }); return [v4.call("repairCost", k), v4.call("wearPct", k)]; },
      ([k, w]) => { const s = createState({ now: T0, seed: 1 }); s.wear = { [k]: w }; return [Cb.repairCost(s, k), Cb.wearPct(s, k)]; });
    sameOver("requisitionTargets by gathering levels", [1, 9, 10, 35, 60, 80, 99].map((lvl) => lvl),
      (lvl) => { both((st) => { GameData.GATHER_SKILLS.forEach((g, i) => { st.skills[g.id] = CONFIG.xpTable[Math.max(1, lvl - i * 7)]; }); }); return v4("requisitionTargets()"); },
      (lvl) => { const s = createState({ now: T0, seed: 1 }); GameData.GATHER_SKILLS.forEach((g, i) => { s.skills[g.id] = CONFIG.xpTable[Math.max(1, lvl - i * 7)]; }); return Wd.requisitionTargets(s); });
  }

  /* ---------- storage and plans ---------- */
  section("Storage and plans");
  {
    const stock = (st) => {
      const add = (w, k, q) => { st[w].items[k] = q; st[w].order.push(k); };
      add("bank", "slag_delve", 7); add("bank", "coal", 10); add("vault", "coal", 3); add("inv", "slag_bar", 30);
      add("inv", "provision_t3", 4); add("bank", "provision_t6", 2); add("vault", "provision_t6", 9); add("vault", "provision_t1", 700);
      add("bank", "slag_blade", 2); add("vault", "bitter_handle", 1);
    };
    const s = both(stock);
    const costs = craftDefs.filter((d) => d.tier === 1).map((d) => d.cost);
    same("canPay and stockCovers for tier 1 recipes", costs.map((c) => [v4.call("canAfford", c), v4.call("stockCovers", { cost: c })]), costs.map((c) => [Sto.canPay(s, c), Sto.stockCovers(s, c)]));
    same("haveQty, qtyIn, slotsUsed, orderedKeys", ["inv", "bank", "vault"].map((w) => [v4.call("slotsUsed", w), v4.call("orderedKeys", w), v4.call("qtyIn", w, "coal"), v4.call("slotCap", w)]),
      ["inv", "bank", "vault"].map((w) => [Sto.slotsUsed(s, w), Sto.orderedKeys(s, w), Sto.qtyIn(s, w, "coal"), Sto.slotCap(s, w)]));
    same("remedyHeals and the best remedy", [v4("remedyHeals()"), v4("bestFood()")], [Cb.remedyHeals(s), Cb.bestRemedy(s)]);
    same("heldEverywhere", v4("heldEverywhere()"), Sto.heldEverywhere(s));
    const bar = GameData.CRAFT_ACTIONS.forgemaster.find((d) => d.id === "craft_slag_bar");
    same("actionMax", craftDefs.slice(0, 40).map((d) => v4.call("actionMax", d)), craftDefs.slice(0, 40).map((d) => Sk.actionMax(s, d)));
    const tasks = [
      { skillId: "forgemaster", actionId: bar.id, progress: 5000, done: 1, elapsed: 17000, limit: null },
      { skillId: "forgemaster", actionId: bar.id, progress: 0, done: 2, elapsed: 0, limit: 3 },
      { skillId: "delving", actionId: "delving_t1_raw", progress: 11999, done: 40, elapsed: 43000000, limit: null },
      { skillId: "delving", actionId: "delving_t1_raw", progress: 100, done: 0, elapsed: 0, limit: 5 },
    ];
    sameOver("skillPlan for running tasks", tasks,
      (t) => { both((st) => { stock(st); st.tasks.skilling = t; }); return v4("skillPlan()"); },
      (t) => { const x = createState({ now: T0, seed: 1 }); stock(x); x.tasks.skilling = t; return Sk.skillPlan(x); });
  }

  /* ---------- the hunt ---------- */
  section("The hunt");
  {
    const mobs = GameData.MONSTERS;
    sameOver("foeNumbers and foeTitle for every foe, plain and Elite", mobs.flatMap((m) => [[m.id, false], [m.id, true]]),
      ([id, e]) => [v4.call("foeNumbers", v4.call("getMonster", id), e), v4.call("foeTitle", v4.call("getMonster", id))],
      ([id, e]) => [Cb.foeNumbers(GameData.MONSTERS.find((m) => m.id === id), e), Cb.foeTitle(GameData.MONSTERS.find((m) => m.id === id))]);
    const pairs = [[["a", 1], ["b", 2], ["c", 0.5]], [[1, 0.75], [2, 0.25]], [["x", 0]]];
    sameOver("pickWeighted with a seeded stream", range(1, 30).flatMap((seed) => pairs.map((p) => [seed, p])),
      ([seed, p]) => v4(`(() => { const r = seededRng(${seed}); return [pickWeighted(${JSON.stringify(p)}, r), pickWeighted(${JSON.stringify(p)}, r)]; })()`),
      ([seed, p]) => { const { seededRng } = RNG; const r = seededRng(seed); return [Cb.pickWeighted(p, r), Cb.pickWeighted(p, r)]; });
    same("threatKey", v4.call("threatKey", 4, "core"), Cb.threatKey(4, "core"));

    const hunt = { ...v4.call("newHunt", 3, "inner", 25), startedAt: 0 };
    hunt.phase = "fight";
    hunt.foes = [{ uid: 1, id: "mob_t3_brute", elite: true, hp: 50, max: 200, ambush: false, timer: 10, bleed: 0, bleedTimer: 0 }];
    hunt.xpRate = 1234.5;
    hunt.elapsed = 5000;
    const s = both((st) => { st.tasks.combat = hunt; st.threat = { "3:inner": 42 }; });
    same("combatPlan", v4("combatPlan()"), Cb.combatPlan(s));
  }

  section("Projections: projectOnce and projectHunt equal v4 exactly");
  {
    const heals = (n, h) => Array.from({ length: n }, () => h);
    const cases = [
      { tier: 1, zone: "outer", hide: false, lo: { level: 5, klass: null, equipment: {} } },
      { tier: 2, zone: "middle", hide: true, lo: { level: 20, klass: "warrior", equipment: gearSet(GameData, 2, "warrior") }, remedies: heals(20, 25) },
      { tier: 3, zone: "inner", hide: false, lo: { level: 30, klass: "rogue", equipment: gearSet(GameData, 3, "rogue") }, threat: 80 },
      { tier: 5, zone: "inner", hide: true, lo: { level: 40, klass: "mage", equipment: gearSet(GameData, 5, "mage", "rare") }, remedies: heals(50, 180) },
      { tier: 6, zone: "core", hide: false, lo: { level: 50, klass: "warrior", equipment: gearSet(GameData, 6, "warrior", "epic") }, remedies: heals(30, 380) },
      { tier: 7, zone: "core", hide: true, lo: { level: 60, klass: "rogue", equipment: gearSet(GameData, 7, "rogue", "legendary") }, threat: 99 },
      { tier: 9, zone: "core", hide: false, lo: { level: 80, klass: "warrior", equipment: gearSet(GameData, 9, "warrior", "relic") }, remedies: heals(400, 1800) },
      { tier: 9, zone: "inner", hide: true, lo: { level: 99, klass: "mage", equipment: gearSet(GameData, 9, "mage", "relic") } },
      { tier: 8, zone: "middle", hide: false, lo: { level: 70, klass: "warrior", equipment: { ...mixed, weapon: "void_sword|relic|1|echoing" } }, remedies: heals(40, 800) },
      { tier: 5, zone: "outer", hide: false, lo: { level: 45, klass: "rogue", equipment: sundering }, xpMult: 1.5 },
      { tier: 2, zone: "core", hide: false, lo: { level: 12, klass: null, equipment: gearSet(GameData, 1, "warrior") }, hp: 10 },
      { tier: 4, zone: "middle", hide: true, lo: { level: 35, klass: "mage", equipment: gearSet(GameData, 3, "mage") }, horizonMs: 2 * 3600000, chunkMs: 5000 },
      { tier: 1, zone: "core", hide: true, lo: { level: 25, klass: "rogue", equipment: { ...gearSet(GameData, 2, "rogue"), weapon: "bog_dagger|relic|2|wounding", chest: "bristle_jacket|relic|2|thorned" } }, threat: 100, remedies: heals(10, 70) },
      { tier: 6, zone: "outer", hide: false, lo: { level: 55, klass: "warrior", equipment: { ...gearSet(GameData, 6, "warrior", "rare"), weapon: "star_greatsword|relic|4|furious", offhand: null, head: "star_helm|relic|4|resilient", feet: "star_hboots|relic|4|stalwart" } }, remedies: heals(15, 380) },
    ];
    let exact = 0;
    for (const [i, c] of cases.entries()) {
      const stats = St.combatStats(c.lo);
      const opts = { stats, hide: c.hide, remedies: c.remedies || [], threat: c.threat || 0, xpMult: c.xpMult, hp: c.hp, horizonMs: c.horizonMs, chunkMs: c.chunkMs, seed: 11 + i };
      const a = v4.call("projectOnce", c.tier, c.zone, clone(opts));
      const b = Cb.projectOnce(c.tier, c.zone, clone(opts));
      if (same(`projectOnce case ${i + 1}: Lv ${c.lo.level} ${c.lo.klass || "Brute Force"}, tier ${c.tier} ${c.zone}${c.hide ? ", hiding" : ""} (${b.kills} kills, ${b.died ? "died" : "lasted"})`, a, b)) exact++;
    }
    check("at least 12 projection cases match exactly", exact >= 12 && exact === cases.length, `${exact} of ${cases.length}`);
    for (const [i, c] of cases.slice(0, 6).entries()) {
      const opts = { stats: St.combatStats(c.lo), hide: c.hide, remedies: c.remedies || [], threat: c.threat || 0, runs: 3, horizonMs: 4 * 3600000 };
      same(`projectHunt case ${i + 1} (three runs, summed)`, v4.call("projectHunt", c.tier, c.zone, clone(opts)), Cb.projectHunt(c.tier, c.zone, clone(opts)));
    }
  }

  section("The zone popup's odds");
  {
    const s = both((st) => {
      st.skills.warfare = CONFIG.xpTable[33];
      st.player.klass = "warrior";
      st.equipment = gearSet(GameData, 3, "warrior");
      st.inv.items.provision_t3 = 12; st.inv.order.push("provision_t3");
      st.bank.items.provision_t1 = 30; st.bank.order.push("provision_t1");
      st.threat = { "3:middle": 60 };
      st.settings.hideSovereign = true;
      st.companions = { owned: { hound: { bond: 100, rank: 2, dupes: 0 } }, active: "hound" };
    });
    v4.now(s.clock);
    v4.set("setTimeout", (fn) => fn());
    let v4Odds = null;
    v4.call("huntOddsLater", 3, "middle", (odds) => { v4Odds = odds; });
    const opts = Cb.huntOddsOpts(s, 3, "middle");
    same("huntOddsOpts + projectHunt = huntOddsLater's answer", v4Odds, Cb.projectHunt(3, "middle", opts));
    check("oddsSignature = huntOddsLater's cache signature", v4("oddsCache.sig") === Cb.oddsSignature(opts, 3, "middle"), `${v4("oddsCache.sig").slice(0, 80)} vs ${Cb.oddsSignature(opts, 3, "middle").slice(0, 80)}`);
    v4.set("setTimeout", () => 0);
  }
});
