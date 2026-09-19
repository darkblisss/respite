/* Performance: a Lv 80 Warrior in tier 9 Core with remedies, and a craft on
   the bench interleaving with the hunt at every completion, advanced twelve
   hours in one call, must finish under 1,500 ms in Node. And a hostile old
   save of 40,000 keys (the kind a v4 browser could write) migrates in under
   300 ms, first call, whatever shape it takes.

     node tests/engine/perf.test.mjs */

import { run, check, section, shared, put, gearSet, listening } from "./harness.mjs";

await run(async () => {
  const { CONFIG } = await shared("config.js");
  const { GameData } = await shared("registry.js");
  const { createState, migrateSave } = await shared("state.js");
  const { validKey } = await shared("items.js");

  section("A 40,000-key legacy save, migrated");
  {
    const NOW = Date.UTC(2026, 8, 17, 12, 0);
    const bases = Object.keys(GameData.GEAR);
    const rarities = ["uncommon", "rare", "epic", "legendary"];
    // Unique pieces under v4's numbered uids: all valid, all different, far more than any pool holds.
    const keys = [];
    for (let i = 0; keys.length < 40000; i++) {
      const k = `${bases[i % bases.length]}|${rarities[i % 4]}|${i + 1}`;
      if (validKey(k)) keys.push(k);
    }
    const pools = (keyed, where) => {
      const out = { inv: { slots: 10, items: {}, order: [] }, bank: { slots: 30, items: {}, order: [] }, vault: { slots: 50, items: {}, order: [] } };
      keyed.forEach((k, i) => {
        const w = where(i);
        out[w].items[k] = 1 + (i % 3);
        // Listed twice, as a careless or hostile writer might.
        out[w].order.push(k, k);
      });
      return out;
    };
    const wearOf = (keyed) => Object.fromEntries(keyed.map((k) => [k, 7]));
    const spread = (i) => ["inv", "bank", "vault"][i % 3];
    const v4 = (extra) => ({ schema: 8, meta: { lastSeen: NOW - 3600000 }, player: { gold: 9e9, hp: 10 }, log: [], ...extra });
    const shapes = [
      ["schema 8, every key in Belongings", v4({ ...pools(keys, () => "inv"), wear: wearOf(keys) }), true],
      ["schema 8, spread over the three pools", v4({ ...pools(keys, spread), wear: wearOf(keys) }), true],
      ["a v4 row dressed as schema 9", { ...v4({ ...pools(keys, spread), wear: wearOf(keys) }), schema: 9, clock: NOW + 86400000 }, true],
      ["schema 7: 20,000 keys and 20,000 spoils", { ...v4({ ...pools(keys.slice(0, 20000), spread) }), schema: 7, spoils: keys.slice(20000).map((k) => ({ key: k, qty: 2 })) }, true],
      ["the server's own schema 9 save, reloaded", { ...JSON.parse(JSON.stringify(createState({ now: NOW, seed: 4 }))), ...pools(keys, spread), wear: wearOf(keys) }, false],
    ];
    for (const [label, shape, legacy] of shapes) {
      const raw = JSON.parse(JSON.stringify(shape));
      const t0 = performance.now();
      const m = migrateSave(raw, { now: NOW, seed: 99, legacy });
      const ms = performance.now() - t0;
      const held = ["inv", "bank", "vault"].reduce((n, w) => n + Object.keys(m[w].items).length, 0);
      console.log(`     ${label}: ${Math.round(ms)}ms, ${held} stacks kept`);
      check(`${label}: under 300ms (${Math.round(ms)}ms), and only what ninety slots hold is kept`, ms < 300 && held <= 90);
    }
  }
  const { advance, applyCommand } = await shared("engine.js");
  const St = await shared("stats.js");

  const T0 = Date.UTC(2026, 8, 16, 6, 0);
  function save() {
    const s = createState({ now: T0, seed: 8080 });
    s.skills.warfare = CONFIG.xpTable[80];
    s.skills.forgemaster = CONFIG.xpTable[80];
    s.player.klass = "warrior";
    s.equipment = gearSet(GameData, 9, "warrior", "rare");
    s.travel.unlocked = GameData.REGIONS.map((r) => r.id);
    s.region = "region_9";
    // Packed: only the Satchel is reachable in a fight.
    put(s, "satchel", "provision_t9", 400);
    put(s, "satchel", "provision_t7", 400);
    // The quickest recipe there is: 3,600 completions, each one a cut in the hunt.
    put(s, "bank", "slag_delve", 8000);
    put(s, "vault", "coal", 4000);
    s.player.gold = 5000;
    s.player.hp = St.maxHp(s);
    return s;
  }

  section("Twelve hours of tier 9 Core and a bench, in one call");
  for (const [label, withChronicle] of [["a silent env", false], ["the chronicle listening", true]]) {
    const s = save();
    const env = withChronicle ? (await listening()).env : undefined;
    applyCommand(s, { type: "buyCompanion", args: { id: "hound" } }, env);
    check("the hunt starts", applyCommand(s, { type: "startHunt", args: { tier: 9, zone: "core", limit: null } }, env).ok);
    check("the craft starts", applyCommand(s, { type: "startSkill", args: { skillId: "forgemaster", actionId: "craft_slag_bar", limit: null } }, env).ok);
    const t0 = performance.now();
    advance(s, T0 + CONFIG.time.idleCapMs, env);
    const ms = performance.now() - t0;
    console.log(`     ${label}: ${Math.round(ms)}ms for ${s.stats.kills} kills, ${s.stats.actions} actions, ${s.stats.deaths} deaths, ${s.stats.bosses} Sovereigns`);
    check(`twelve hours in ${Math.round(ms)}ms (${label}), under 1,500ms`, ms < 1500);
    check("and it was a real twelve hours of work", s.stats.kills > 1000 && s.stats.actions === 3600);
  }
});
