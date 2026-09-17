/* Migration. v4 saves are made by the v4 engine itself in a vm context
   (fresh, mid-craft, mid-hunt, recovering, schema 7 with spoils, overfull
   Belongings, remedies in Provisions, relics with numeric uids, retired pets)
   and turned into schema 9. Where v4's migrate() already decided something,
   v5 must decide the same. Schema 9 saves round-trip, and hostile saves come
   out sound.

     node tests/engine/migrate.test.mjs */

import { run, check, section, same, shared, clone, put, loadV4, listening, firstDiff } from "./harness.mjs";

await run(async () => {
  const v4 = loadV4();
  const { CONFIG } = await shared("config.js");
  const { GameData } = await shared("registry.js");
  const { createState, migrateSave } = await shared("state.js");
  const E = await shared("engine.js");
  const St = await shared("stats.js");
  const S = await shared("storage.js");
  const I = await shared("items.js");
  const Cb = await shared("combat.js");
  const { getMonster } = await shared("registry.js");
  const { hashString } = await shared("rng.js");
  const H = CONFIG.hunt;

  const NOW = Date.UTC(2026, 8, 16, 12, 0);
  const LEFT = NOW - 3 * 3600000;       // when the v4 player last saved
  const SEED = 31337;
  const opts = { now: NOW, seed: SEED, userId: "u-1", account: "wren" };
  const IDLE = CONFIG.time.idleCapMs;

  // Runs v4 code at the moment the player left, and hands back the save as JSON.
  function v4Save(script) {
    v4.now(LEFT - 3600000);
    v4.seedRandom(12);
    v4("state = freshState(); refreshBounty();");
    if (script) v4(script);
    v4.now(LEFT);
    v4("state.meta.lastSeen = Date.now()");
    return JSON.parse(JSON.stringify(v4("state")));
  }
  // What v4's own migrate() made of it, at the same moment.
  function v4Migrate(raw) {
    v4.now(LEFT);
    return JSON.parse(JSON.stringify(v4.call("migrate", clone(raw))));
  }
  const heldOf = (s) => S.heldEverywhere(s);

  /* A v4 hunt in the shape v5 keeps one: no stored XP rate, a damage total for the
     run, a damage reading on every sample of the rolling window, and the next
     sample on the ten-second grid rather than five minutes out. `power` is the
     depth a foe stands at, which scales its health, so v4's foes are measured
     again against the zone they were in. */
  function asV5Hunt(c) {
    const { xpRate, ...rest } = c;
    const power = GameData.ZONES.find((z) => z.id === c.zone).power;
    return {
      ...rest,
      dmg: 0,
      marks: c.marks.map(([t, xp]) => [t, xp, 0]),
      nextMark: (Math.floor(c.elapsed / H.rateMarkMs) + 1) * H.rateMarkMs,
      foes: c.foes.map((f) => ({ ...f, power, max: Cb.foeNumbers(getMonster(f.id), f.elite, power).hp })),
    };
  }

  section("A fresh v4 save");
  {
    const raw = v4Save();
    const m = migrateSave(clone(raw), opts);
    check("schema 9, clock at lastSeen, lastSeen gone", m.schema === 9 && m.clock === LEFT && !("lastSeen" in m.meta));
    check("new streams from the seed, no counters, serial 1, no note from a last hunt", m.rng.seed === SEED && m.rng.world === hashString(`${SEED}:world`) && m.rng.hunt === hashString(`${SEED}:hunt`) &&
      JSON.stringify(m.rolls) === "{}" && m.serial === 1 && m.lootLostAt === null && m.player.camp === null);
    check("the account and user come from the server", m.meta.userId === "u-1" && m.meta.account === "wren");
    check("createdAt, playtime and v4's log kept", m.meta.createdAt === raw.meta.createdAt && m.meta.playtimeMs === raw.meta.playtimeMs && JSON.stringify(m.log) === JSON.stringify(raw.log));
    check("stats gain bosses", m.stats.bosses === 0 && Object.keys(m.stats).length === 7);
    same("the bounty v4 posted is kept", m.bounty, raw.bounty);
    check("migrateSave leaves its input alone", JSON.stringify(raw) === JSON.stringify(v4Save()));
  }

  section("Mid-craft, mid-hunt, recovering");
  {
    const raw = v4Save(`
      addTo("bank", "slag_delve", 60); addTo("bank", "coal", 60);
      startSkillTask("forgemaster", "craft_slag_bar", 25);
      for (let i = 0; i < 17; i++) tick(1000 + i * 37);
    `);
    check("v4 left a craft underway", raw.tasks.skilling && raw.tasks.skilling.done > 0 && raw.tasks.skilling.progress > 0);
    const m = migrateSave(clone(raw), opts);
    const t = m.tasks.skilling;
    same("the craft carries on with an id, whole-number progress and a fresh start stamp",
      t, { id: 1, skillId: "forgemaster", actionId: "craft_slag_bar", progress: Math.floor(raw.tasks.skilling.progress), done: raw.tasks.skilling.done, elapsed: Math.floor(raw.tasks.skilling.elapsed), limit: 25, startedAt: LEFT });
    same("the materials v4 left are what v5 has", heldOf(m), heldOf(v4Migrate(raw)));
    const w = await listening();
    E.advance(m, NOW, w.env);
    check("and it finishes its batch once time is played out", m.tasks.skilling === null && S.haveQty(m, "slag_bar") === 25 && m.log.some((l) => /^Batch finished: 25 × Slag Bar/.test(l.m)));
  }
  {
    const raw = v4Save(`
      state.skills.warfare = XP_TABLE[30];
      state.player.klass = "warrior";
      state.equipment.weapon = "cold_sword|relic|4|echoing";
      state.equipment.chest = "cold_chest|rare|7";
      state.travel.unlocked.push("region_2", "region_3");
      addTo("inv", "provision_t3", 20);
      startHunt(2, "inner", 400);
      for (let i = 0; i < 400; i++) tick(250);
    `);
    check("v4 left a hunt in the middle of a fight", raw.tasks.combat && raw.tasks.combat.phase === "fight" && raw.tasks.combat.foes.length > 0 && raw.tasks.combat.done > 0, raw.tasks.combat && raw.tasks.combat.phase);
    const m = migrateSave(clone(raw), opts);
    const c = m.tasks.combat;
    const { startedAt, id, ...rest } = c;
    const { startedAt: s4, ...rest4 } = raw.tasks.combat;
    same("the hunt carries on where it stood, in the shape this version keeps one", rest, asV5Hunt(rest4));
    const power = GameData.ZONES.find((z) => z.id === rest4.zone).power;
    check("its foes carry the depth they are standing in, which is what their health is measured against",
      power > 1 && c.foes.length > 0 && c.foes.every((f, i) => f.power === power && f.max === Cb.foeNumbers(getMonster(f.id), f.elite, power).hp && f.max > raw.tasks.combat.foes[i].max),
      c.foes.map((f) => [f.id, f.power, f.max]));
    check("with an id, and the save's one hunt stream from the seed for its dice", id === 1 && !("rng" in c) && m.rng.hunt === hashString(`${SEED}:hunt`) && startedAt === raw.tasks.combat.startedAt && m.serial === 2);
    check("relics with numeric uids stay as they are", m.equipment.weapon === "cold_sword|relic|4|echoing" && m.equipment.chest === "cold_chest|rare|7");
    const w = await listening();
    E.advance(m, NOW, w.env);
    check("and it plays on", m.stats.kills > raw.stats.kills && m.log.length > raw.log.length);
  }
  {
    const raw = v4Save(`
      state.equipment.weapon = "slag_sword|common";
      state.travel.unlocked.push("region_9");
      startHunt(9, "core", null);
      for (let i = 0; i < 10000 && state.tasks.combat; i++) tick(250);
      tick(1000);
    `);
    check("v4 left a hunter recovering", raw.player.recoveryLeft > 0 && raw.player.recoveryLeft < CONFIG.hunt.recoveryMs && raw.tasks.combat === null && raw.stats.deaths === 1);
    const m = migrateSave(clone(raw), opts);
    check("recovery carries over, counted in game time", m.player.recoveryLeft === raw.player.recoveryLeft && St.recovering(m));
    check("the wear from the death is kept", m.wear["slag_sword|common"] === raw.wear["slag_sword|common"]);
    const w = await listening();
    E.advance(m, LEFT + raw.player.recoveryLeft - 1, w.env);
    const still = St.recovering(m);
    E.advance(m, LEFT + raw.player.recoveryLeft, w.env);
    check("and ends to the millisecond", still && !St.recovering(m));
  }

  section("Schema 7 with spoils");
  {
    const raw = v4Save();
    raw.schema = 7;
    raw.player = { gold: 52000, hp: 30, recoveryUntil: LEFT + 120000, klass: "rogue" };
    raw.stats.goldEarned = 100000;
    delete raw.settings;
    raw.threat = { 1: 88 };
    raw.spoils = [{ key: "mangy_flay", qty: 4, t: 1 }, { key: "slag_sword|rare|3", qty: 1, t: 2 }, { key: "nope", qty: 3 }];
    raw.tasks.combat = { tier: 2, monsterId: "mob_t2_grunt", mobHp: 10, mobMax: 40, playerTimer: 100, mobTimer: 300, respawn: 0, done: 4, elapsed: 3600000, limit: 50, startedAt: LEFT - 3600000, queued: null, veil: 30 };
    raw.bounty = { window: 1, region: "region_1", kind: "slay", gold: 999 };
    const old = v4Migrate(raw);
    const m = migrateSave(clone(raw), opts);
    check("gold and gold earned are struck at a fifth, and the bounty is re-posted", m.player.gold === 10400 && m.stats.goldEarned === 20000 && old.player.gold === 10400 && m.bounty.window === Math.floor(LEFT / CONFIG.time.windowMs));
    check("unclaimed spoils are carried into storage, junk left behind", S.haveQty(m, "mangy_flay") === 4 && m.inv.items["slag_sword|rare|3"] === 1 && !("spoils" in m) && m.log.some((l) => l.m === "Spoils left on the field were carried in." && l.t === LEFT));
    check("recovery becomes game time, Threat resets, hiding starts off", m.player.recoveryLeft === 120000 && !("recoveryUntil" in m.player) && JSON.stringify(m.threat) === "{}" && m.settings.hideSovereign === false);
    const c = m.tasks.combat;
    check("a hunt underway carries on from the Outer of the same ground, count and limit kept, its window opening on the ten-second grid",
      c.tier === 2 && c.zone === "outer" && c.limit === 50 && c.done === 4 && c.elapsed === 3600000 && c.nextMark === 3610000 && JSON.stringify(c.marks) === "[[3600000,0,0]]" && c.dmg === 0 && c.id === 1,
      { nextMark: c.nextMark, marks: c.marks });
    const { id, rng, startedAt, ...rest } = c;
    const { startedAt: s4, ...rest4 } = old.tasks.combat;
    same("the same hunt v4's migrate made", rest, asV5Hunt(rest4));
    same("the same log lines v4's migrate wrote", m.log.map((l) => l.m), old.log.map((l) => l.m));
    check("migration notes are dated when you left", m.log.slice(-2).every((l) => l.t === LEFT));
  }
  {
    const make = (combat, extra) => {
      const raw = v4Save();
      raw.schema = 7;
      raw.player = Object.assign({ gold: 0, hp: 999, recoveryUntil: 0, klass: null }, extra || {});
      raw.tasks.combat = Object.assign({ tier: 2, monsterId: "mob_t2_grunt", mobHp: 10, mobMax: 40, respawn: 0, done: 48, elapsed: 3600000, limit: null, startedAt: LEFT - 3600000, queued: null, veil: 0 }, combat);
      return raw;
    };
    const cases = [make({ queued: "stop" }), make({ limit: 48 }), make({ elapsed: IDLE }), make({ queued: 3, done: 7 })];
    const ms = cases.map((raw) => migrateSave(clone(raw), opts));
    check("a hunt that was pulling back, at its limit or at twelve hours stays over", ms[0].tasks.combat === null && ms[1].tasks.combat === null && ms[2].tasks.combat === null);
    check("a hunt that was moving ground carries on where it was going", ms[3].tasks.combat && ms[3].tasks.combat.tier === 3 && ms[3].tasks.combat.done === 0);
    check("health is brought within the new most", ms[0].player.hp === St.maxHp(ms[0]) && v4Migrate(cases[0]).player.hp === ms[0].player.hp);
  }

  section("Belongings, Provisions and remedies");
  {
    const raw = v4Save(`
      const mats = Object.keys(MATERIALS).filter((k) => !MATERIALS[k].heal).slice(0, 18);
      mats.forEach((k) => { state.inv.items[k] = 2; state.inv.order.push(k); });
      state.inv.slots = 18;
      state.tasks.skilling = { skillId: "delving", actionId: "delving_t1_raw", progress: 0, done: 4, startedAt: Date.now() - 3 * 3600000, queued: null };
      state.pets = { golem: true, sprite: false, mule: true };
      state.player.gold = 100;
      delete state.companions;
      state.yields = [{ t: 1, m: "x" }];
    `);
    const old = v4Migrate(raw);
    const m = migrateSave(clone(raw), opts);
    check("Belongings over ten slots move into the Stockpile", Object.keys(m.inv.items).length === 10 && m.inv.order.length === 10 && Object.keys(m.bank.items).length === 8 && m.log.some((l) => /8 stacks were moved/.test(l.m)));
    same("the same pools v4 settled", [m.inv.items, m.bank.items, m.vault.items], [old.inv.items, old.bank.items, old.vault.items]);
    check("old pets are refunded in full, once", m.player.gold === 750 && old.player.gold === 750 && m.log.some((l) => /650g was paid back/.test(l.m)) && migrateSave(clone(m), opts).player.gold === 750);
    check("old saves lose the yields log and get empty companions", !("yields" in m) && !("pets" in m) && JSON.stringify(m.companions) === '{"owned":{},"active":null}');
    check("old tasks run open-ended with their clock rebuilt from when they started", m.tasks.skilling.limit === null && m.tasks.skilling.elapsed === 4 * 3600000 && old.tasks.skilling.elapsed === m.tasks.skilling.elapsed, m.tasks.skilling.elapsed);
  }
  {
    const raw = v4Save(`
      state.player.gold = 99999;
      buyShop("provision_t1", 50, 10);
      buyShop("provision_t6", 1400, 10);
      buyShop("provision_t3", 150, 10);
      addTo("vault", "provision_t9", 2);
      addTo("inv", "provision_t3", 4);
      for (let i = 0; i < 7; i++) addTo("inv", Object.keys(MATERIALS)[12 + i], 1);
    `);
    check("v4 bought its remedies into Provisions", raw.bank.items.provision_t1 === 10 && raw.bank.items.provision_t6 === 10);
    const m = migrateSave(clone(raw), opts);
    same("remedies move into Belongings while there is room, best heal first, merging a held stack",
      [m.inv.items.provision_t9, m.inv.items.provision_t6, m.inv.items.provision_t3, m.inv.items.provision_t1, m.bank.items.provision_t1, m.vault.items.provision_t9, Object.keys(m.inv.items).length],
      [2, 10, 14, undefined, 10, undefined, 10]);
    check("one line says so", m.log.filter((l) => l.m === "Remedies are kept in Belongings now. 3 stacks were moved.").length === 1);
    same("nothing is lost", heldOf(m), heldOf(v4Migrate(raw)));
  }

  section("Companions and Bond");
  {
    const raw = v4Save(`
      state.player.gold = 5000;
      buyCompanion("rat"); buyCompanion("stag");
      state.companions.owned.rat.bond = 123.456789;
      state.companions.owned.stag = { bond: 99999, rank: 9, dupes: -3 };
      state.companions.owned.ghost = { bond: 1, rank: 1, dupes: 0 };
      setCompanion("stag");
    `);
    const m = migrateSave(clone(raw), opts);
    same("owned companions clamped, unknown ones dropped, Bond on the millisecond grid",
      m.companions, { owned: { rat: { bond: Math.round(123.456789 * 60000) / 60000, rank: 1, dupes: 0 }, stag: { bond: 5700, rank: 5, dupes: 0 } }, active: "stag" });
  }

  section("Schema 9");
  {
    const w = await listening();
    const s = createState({ now: NOW, seed: 5 });
    s.skills.warfare = CONFIG.xpTable[20] + 0.123;
    s.player.gold = 4000;
    E.applyCommand(s, { type: "buyCompanion", args: { id: "hound" } }, w.env);
    E.applyCommand(s, { type: "setHide", args: { on: true } }, w.env);
    s.bank.items.slag_delve = 30;
    s.bank.order.push("slag_delve");
    E.applyCommand(s, { type: "startSkill", args: { skillId: "delving", actionId: "delving_t1_raw", limit: 90 } }, w.env);
    E.applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "middle", limit: 3000 } }, w.env);
    E.advance(s, NOW + 20 * 60000 + 1234, w.env);
    // Threat is region-wide and kept unrounded, so a live save holds a fraction under one tier key.
    s.threat["1"] = 40.7;
    const back = migrateSave(JSON.parse(JSON.stringify(s)), { now: NOW + 99999, seed: 1 });
    same("a live schema 9 save round-trips unchanged", back, s);
    check("including the hunt in flight", !!back.tasks.combat && back.tasks.combat.foes.length === s.tasks.combat.foes.length && back.clock === s.clock);
    const twin = clone(s);
    E.advance(back, NOW + 3 * 3600000, w.env);
    E.advance(twin, NOW + 3 * 3600000, (await listening()).env);
    same("and plays on exactly as the original would", back, twin);
  }
  {
    const s = createState({ now: NOW, seed: 5 });
    s.tasks.combat = { tier: 1, zone: "outer", foes: "lots", marks: [] };
    s.tasks.skilling = { skillId: "delving", actionId: "delving_t9", progress: 5, done: 0, elapsed: 0, limit: null, id: 3 };
    s.equipment.weapon = "slag_helm|common";
    s.equipment.head = "slag_helm|mythic|1";
    s.equipment.ring = "slag_ring|rare|bad uid!";
    s.inv.items = { coal: 5, nope: 3, "slag_sword|rare": 1, resin: -2, pulp: "7", tallow: 2.9 };
    s.inv.order = ["nope", "coal", "coal", 7];
    s.player.gold = -50;
    s.player.hp = 1e9;
    s.agents = [{ id: "agent_40", name: "Silt", rarity: "rare" }, { id: "agent_40", name: "Dup", rarity: "rare" }, { id: "x", name: "Bad", rarity: "rare" }];
    s.serial = 2;
    s.companions = { owned: { rat: { bond: 30.000004, rank: 2, dupes: 1 } }, active: "crow" };
    // Old per-zone keys, a bare tier key, and junk: one region ends up as hot as its hottest zone was.
    s.threat = { "1:outer": 150, "1:middle": 40, "0:outer": 5, "1:attic": 3, "1:inner:x": 4, 3: 12.5, 9: -8 };
    s.log = [{ t: 1, m: "ok" }, "old string", { t: "x", m: 5 }, null];
    const m = migrateSave(JSON.parse(JSON.stringify(s)), opts);
    check("a broken hunt is dropped", m.tasks.combat === null);
    check("a task the level doesn't allow is dropped", m.tasks.skilling === null);
    same("equipment that doesn't resolve for its slot is dropped", [m.equipment.weapon, m.equipment.head, m.equipment.ring], [null, null, null]);
    same("pools keep only real items in whole positive amounts, ordered once", [m.inv.items, m.inv.order], [{ coal: 5, tallow: 2 }, ["coal", "tallow"]]);
    check("gold can't be negative, health can't pass the most", m.player.gold === 0 && m.player.hp === St.maxHp(m));
    check("agents: duplicates and bad ids dropped; serial kept above every id", m.agents.length === 1 && m.serial === 41);
    same("companions: Bond snapped, the active one must be owned", m.companions, { owned: { rat: { bond: 30, rank: 2, dupes: 1 } }, active: null });
    same("threat: keyed by region, the hottest zone of an old save carried forward, within 0 to 100",
      m.threat, { 1: 100, 3: 12.5, 9: 0 });
    same("log: strings become entries, junk goes", m.log, [{ t: 1, m: "ok" }, { t: NOW, m: "old string" }]);
  }

  section("Garbage and hostile saves");
  {
    for (const junk of [null, undefined, 5, "save", [], true]) {
      const m = migrateSave(junk, opts);
      check(`${JSON.stringify(junk) || "undefined"} gives a fresh save`, m.schema === 9 && m.clock === NOW && m.rng.seed === SEED && m.log[0].m === "You take command of a ruin." && m.meta.userId === "u-1");
    }
    const hostile = JSON.parse(`{
      "schema": 9, "clock": "soon", "__proto__": { "polluted": true },
      "meta": { "createdAt": -5, "playtimeMs": 1e400, "account": { "x": 1 }, "userId": 42 },
      "player": { "gold": "1000000", "hp": null, "recoveryLeft": 9e99, "klass": "__proto__" },
      "skills": { "warfare": "99", "delving": 1e400, "__proto__": 5 },
      "inv": { "slots": 999, "items": { "__proto__": 5, "constructor": 3, "coal": 1e308 }, "order": "coal" },
      "bank": { "slots": -4, "items": [], "order": [] },
      "vault": null,
      "equipment": { "weapon": { "toString": "slag_sword|common" } },
      "tools": { "delving": "coal", "felling": "bitter_axe" },
      "tasks": { "skilling": [], "combat": { "tier": 1, "zone": "outer", "foes": [{ "id": "mob_t9_brute", "hp": 5, "max": 5 }], "marks": [[0, 0]], "phase": "fight", "kind": "normal", "id": 2, "rng": -1, "elapsed": 1e12 } },
      "region": "region_9", "travel": { "unlocked": ["region_9", "region_1", 7] },
      "rng": { "seed": -1, "world": 1.5 }, "rolls": { "a:x": 1e20, "__proto__": 1, "evil key": 3 }, "serial": "9",
      "bounty": { "window": 1, "region": "region_2", "kind": "gather", "targetId": "slag_sword|common", "label": "x", "amount": 5 },
      "buff": { "until": 1e20, "mult": 1e9 }, "smugglerBought": { "1_0": true, "junk": true },
      "requisitions": [{ "agentId": "a", "itemKey": "coal", "qty": 1e9, "day": 1 }], "log": "nope"
    }`);
    let m = null;
    let threw = null;
    try {
      m = migrateSave(hostile, opts);
    } catch (e) {
      threw = e.stack;
    }
    check("a hostile save migrates without a throw", !threw, threw);
    check("nothing reaches a prototype", ({}).polluted === undefined && Object.getPrototypeOf(m) === Object.prototype && Object.getPrototypeOf(m.inv.items) === Object.prototype);
    check("values come out typed and in range", m.clock === NOW && m.player.gold === 0 && m.player.recoveryLeft === CONFIG.hunt.recoveryMs && m.player.klass === null && m.skills.warfare === 0 && m.skills.delving === 0 &&
      m.meta.account === "wren" && m.meta.userId === "u-1" && m.meta.playtimeMs === 0 && m.meta.createdAt === 0 && m.inv.slots === 10 && m.bank.slots === 30 && m.vault.slots === 50 &&
      Object.keys(m.inv.items).join() === "coal" && m.inv.items.coal === 1e12 && m.equipment.weapon === null && m.tools.felling === "bitter_axe" && !m.tools.delving);
    check("a hunt with foes from another tier loses them and walks on, its own stream gone", m.tasks.combat && m.tasks.combat.foes.length === 0 && m.tasks.combat.phase === "search" && m.tasks.combat.elapsed === IDLE && !("rng" in m.tasks.combat) && m.rng.hunt === hashString(`${SEED}:hunt`));
    check("region must be unlocked; the first region always is", m.travel.unlocked.join() === "region_1,region_9" && m.region === "region_9");
    check("rng from the server's seed, rolls only real counters", m.rng.seed === SEED && JSON.stringify(m.rolls) === `{"a:x":${Number.MAX_SAFE_INTEGER}}`);
    check("bounty re-posted, buff checked, an errand for an agent not on the roster dropped", m.bounty && m.bounty.window === Math.floor(NOW / CONFIG.time.windowMs) && m.buff === null && m.requisitions.length === 0 && JSON.stringify(m.smugglerBought) === '{"1_0":true}');
    same("a migrated save migrates to itself", migrateSave(JSON.parse(JSON.stringify(m)), opts), m);
    const w = await listening();
    let playThrew = null;
    try {
      E.advance(m, NOW + 13 * 3600000, w.env);
      E.applyCommand(m, { type: "startHunt", args: { tier: 9, zone: "core", limit: null } }, w.env);
      E.advance(m, NOW + 14 * 3600000, w.env);
    } catch (e) {
      playThrew = e.stack;
    }
    check("and the result plays", !playThrew, playThrew);
  }

  /* ================= LEGACY ROWS AND THE SAVE'S INVARIANTS ================= */
  const W = await shared("world.js");
  const { foeOf, sovereignOf } = await shared("registry.js");
  const legacy = { ...opts, legacy: true };
  const ledgerLine = (m) => m.log.map((l) => l.m).filter((t) => /ledger didn't add up/.test(t));
  const pool = (items, slots) => ({ slots, items, order: Object.keys(items) });
  const deepFreeze = (v) => {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      Object.freeze(v);
      Object.values(v).forEach(deepFreeze);
    }
    return v;
  };

  section("Legacy rows: a v4 browser wrote them, so the v4 way, whatever they claim");
  {
    // A row a v4 browser could have written dressed as a v5 save: a clock days ahead, dice and counters of its choosing.
    const dressed = createState({ now: NOW, seed: 777 });
    dressed.clock = NOW + 5 * 86400000;
    dressed.rng = { seed: 1, world: 2, hunt: 3 };
    dressed.rolls = { "s:9": 0, "a:craft_slag_sword": 0 };
    dressed.player.gold = 9e9;
    const raw = JSON.parse(JSON.stringify(dressed));
    const trusted = migrateSave(clone(raw), opts);
    check("without legacy, a schema 9 row is taken as the server's own (its clock and dice kept)", trusted.clock === NOW + 5 * 86400000 && trusted.rng.hunt === 3 && trusted.player.gold === 9e9);
    const m = migrateSave(clone(raw), legacy);
    check("as legacy it goes the v4 way: the clock at now, the server's seed for every stream, counters from nothing",
      m.clock === NOW && m.rng.seed === SEED && m.rng.world === hashString(`${SEED}:world`) && m.rng.hunt === hashString(`${SEED}:hunt`) && JSON.stringify(m.rolls) === "{}", { clock: m.clock - NOW, rng: m.rng, rolls: m.rolls });
    check("gold held to 5,000,000, and one line in the log for it", m.player.gold === 5000000 && JSON.stringify(ledgerLine(m)) === JSON.stringify(["Your old camp's ledger didn't add up. 1 entry was set right."]));
    const ahead = v4Save();
    ahead.meta.lastSeen = NOW + 86400000;
    const pulled = migrateSave(clone(ahead), opts);
    check("a v4 save stamped by a clock running ahead is pulled back to now", pulled.clock === NOW && migrateSave(clone(ahead), legacy).clock === NOW);
    const honest = v4Save(`addTo("bank", "slag_delve", 40); state.player.gold = 4321;`);
    const plain = migrateSave(clone(honest), opts);
    same("an honest v4 save migrates the same as legacy, with no ledger line", migrateSave(clone(honest), legacy), plain);
    same("and a legacy save migrates to itself afterwards", migrateSave(JSON.parse(JSON.stringify(m)), opts), m);
  }

  section("A unique piece is held once; a pool holds its slots and no more");
  {
    const raw = v4Save();
    raw.equipment.weapon = "cold_sword|rare|4";
    raw.inv = pool({ "cold_sword|rare|4": 1, "cold_helm|epic|5": 3, coal: 2 }, 10);
    raw.bank = pool({ "cold_helm|epic|5": 1, "cold_chest|rare|6": 1, coal: 5 }, 30);
    raw.vault = pool({ "cold_chest|rare|6": 1, "cold_sword|rare|4": 1, coal: 7 }, 50);
    for (const [label, o] of [["legacy", legacy], ["not legacy", opts]]) {
      const m = migrateSave(clone(raw), o);
      same(`worn first, then Belongings, the Stockpile, the Vault; one of each, stacks wherever they are (${label})`,
        [m.equipment.weapon, m.inv.items, m.bank.items, m.vault.items, m.inv.order, m.bank.order, m.vault.order],
        ["cold_sword|rare|4", { "cold_helm|epic|5": 1, coal: 2 }, { "cold_chest|rare|6": 1, coal: 5 }, { coal: 7 }, ["cold_helm|epic|5", "coal"], ["cold_chest|rare|6", "coal"], ["coal"]]);
    }
    same("five entries set right, said once", ledgerLine(migrateSave(clone(raw), legacy)), ["Your old camp's ledger didn't add up. 5 entries were set right."]);
    check("never a ledger line when the save isn't legacy", ledgerLine(migrateSave(clone(raw), opts)).length === 0);

    const s9 = createState({ now: NOW, seed: 5 });
    const junk = Object.keys(GameData.MATERIALS).filter((k) => !GameData.MATERIALS[k].heal).slice(0, 40);
    junk.slice(0, 10).forEach((k) => put(s9, "inv", k, 1));
    put(s9, "inv", "slag_sword|epic|12", 1);
    put(s9, "bank", "slag_sword|epic|12", 1);
    junk.slice(10, 40).forEach((k) => put(s9, "bank", k, 2));
    put(s9, "bank", "slag_helm|rare|13", 1);
    s9.bank.order = ["slag_helm|rare|13", ...s9.bank.order.filter((k) => k !== "slag_helm|rare|13")];
    const m9 = migrateSave(JSON.parse(JSON.stringify(s9)), opts);
    check("a piece past a full pool's last slot doesn't shadow its copy in the next pool", !("slag_sword|epic|12" in m9.inv.items) && m9.bank.items["slag_sword|epic|12"] === 1 && Object.keys(m9.inv.items).length === 10);
    check("a pool keeps its first stacks in the player's order and lets the rest go",
      Object.keys(m9.bank.items).length === 30 && m9.bank.order[0] === "slag_helm|rare|13" && m9.bank.order[1] === "slag_sword|epic|12" && m9.bank.order.length === 30 && !(junk[39] in m9.bank.items) && !(junk[38] in m9.bank.items));
  }
  {
    // v4's own settling runs first: overflow moves into storage while there is room, and only what is left over is let go.
    const raw = v4Save();
    const mats = Object.keys(GameData.MATERIALS).filter((k) => !GameData.MATERIALS[k].heal && k !== "vault_chest");
    raw.inv = pool(Object.fromEntries(mats.slice(0, 18).map((k) => [k, 3])), 18);
    raw.bank = pool(Object.fromEntries(mats.slice(18, 48).map((k) => [k, 1])), 30);
    raw.vault = pool(Object.fromEntries(mats.slice(48, 96).map((k) => [k, 1])), 50);
    check("set up: 18 stacks in Belongings, the Stockpile full, two slots in the Vault", mats.length >= 96);
    const m = migrateSave(clone(raw), legacy);
    check("two stacks move to the Vault, the next six have no slot and go", m.log.some((l) => l.m === "Belongings now hold 10 slots. 2 stacks were moved into camp storage.") &&
      Object.keys(m.vault.items).length === 50 && m.vault.items[mats[10]] === 3 && m.vault.items[mats[11]] === 3 && Object.keys(m.inv.items).length === 10 && mats.slice(12, 18).every((k) => S.haveQty(m, k) === 0));
    same("and the ledger says six", ledgerLine(m), ["Your old camp's ledger didn't add up. 6 entries were set right."]);
  }

  section("Legacy limits: gold, stacks, and uids v4 never minted");
  {
    const raw = v4Save();
    raw.player.gold = 7000000;
    raw.bank = pool({ coal: 300000, resin: 250000, "slag_sword|epic|s1.0": 1, "slag_sword|epic|12": 1, "slag_helm|relic|c3.1|vital": 1 }, 30);
    raw.equipment.weapon = "slag_sword|rare|f1.2";
    const m = migrateSave(clone(raw), legacy);
    same("gold to 5,000,000, a stack to 250,000; pieces under uids v5 derives are let go, v4's numbers stay",
      [m.player.gold, m.bank.items, m.equipment.weapon], [5000000, { coal: 250000, resin: 250000, "slag_sword|epic|12": 1 }, null]);
    same("five entries: the gold, the stack, three pieces", ledgerLine(m), ["Your old camp's ledger didn't add up. 5 entries were set right."]);
    const trusted = migrateSave(clone(raw), opts);
    check("the server's own saves keep all of it", trusted.player.gold === 7000000 && trusted.bank.items.coal === 300000 && trusted.bank.items["slag_sword|epic|s1.0"] === 1 && trusted.equipment.weapon === "slag_sword|rare|f1.2");
  }

  section("Wear is kept only for what is still held");
  {
    const raw = v4Save();
    raw.equipment.weapon = "cold_sword|rare|4";
    raw.bank = pool({ "cold_chest|rare|6": 1, "slag_chest|common": 2 }, 30);
    raw.wear = { "cold_sword|rare|4": 30, "cold_chest|rare|6": 12, "slag_chest|common": 5, "cold_helm|epic|5": 99, "slag_helm|common": 7, coal: 3 };
    for (const [label, o] of [["legacy", legacy], ["not legacy", opts]]) {
      same(`worn and held pieces keep their wear; pieces gone from the camp don't (${label})`, migrateSave(clone(raw), o).wear, { "cold_sword|rare|4": 30, "cold_chest|rare|6": 12, "slag_chest|common": 5 });
    }
    check("and that alone is no ledger entry", ledgerLine(migrateSave(clone(raw), legacy)).length === 0);
  }

  section("Postings, errands, fights, tasks and buffs the rules would have made");
  {
    const s = createState({ now: NOW, seed: 9 });
    s.skills.warfare = CONFIG.xpTable[40];
    s.travel.unlocked = GameData.REGIONS.map((r) => r.id);
    s.region = "region_3";
    s.agents = [{ id: "agent_1", name: "Silt", rarity: "rare" }, { id: "agent_2", name: "Moss", rarity: "common" }, { id: "agent_3", name: "Ash", rarity: "epic" }, { id: "agent_4", name: "Rook", rarity: "common" }];
    const day = Math.floor(NOW / 86400000);
    const errand = (agentId, itemKey, qty) => ({ agentId, agentName: "x", itemKey, qty, day, resolved: false });
    s.requisitions = [errand("agent_1", "coal", 30), errand("agent_9", "coal", 12), errand("agent_1", "resin", 30), errand("agent_2", "coal", 100000),
      errand("agent_3", "titan_delve", 48), errand("agent_3", "resin", 48), errand("agent_4", "pulp", 12)];
    const posted = W.makeBounty({ region: "region_3" }, Math.floor(NOW / CONFIG.time.windowMs));
    s.bounty = { ...posted, gold: posted.gold * 1000, progress: 7, claimed: false };
    s.buff = { until: NOW + 30 * 86400000, mult: 10 };
    s.equipment.weapon = "bitter_bow|common";
    s.equipment.offhand = "bitter_shield|common";
    s.tasks.skilling = { id: 3, skillId: "delving", actionId: "delving_t1_raw", progress: CONFIG.time.idleCapMs, done: 0, elapsed: 0, limit: null, startedAt: NOW };
    const stalker = foeOf(1, "stalker");
    const foe = (uid, mob, over = {}) => ({ uid, id: mob.id, elite: false, hp: 10, max: Cb.foeNumbers(mob, false).hp, ambush: false, timer: 100, bleed: 0, bleedTimer: 0, ...over });
    s.tasks.combat = { ...Cb.newHunt(s, 1, "outer", null), phase: "fight", kind: "normal",
      foes: [foe(1, stalker, { hp: 1e9, max: 1e9 }), foe(2, sovereignOf(1)), foe(3, stalker), foe(4, stalker), foe(5, stalker)] };
    const raw = JSON.parse(JSON.stringify(s));
    const m = migrateSave(clone(raw), legacy);
    same("errands: an agent on the roster, out once, three a day, for what agents bring, in the amount they bring",
      m.requisitions.map((r) => [r.agentId, r.agentName, r.itemKey, r.qty]),
      [["agent_1", "Silt", "coal", W.requisitionQty(s.agents[0])], ["agent_2", "Moss", "coal", 12], ["agent_3", "Ash", "resin", 48]]);
    same("the posting is the board's: its pay back to what was posted, its progress kept", m.bounty, { ...posted, progress: 7 });
    same("a bounty's buff is double experience for an hour at most", m.buff, { until: NOW + 3600000, mult: 2 });
    check("two hands on a bow hold no shield", m.equipment.weapon === "bitter_bow|common" && m.equipment.offhand === null);
    check("progress toward one action is short of that action's time", m.tasks.skilling.progress === 12000);
    const c = m.tasks.combat;
    same("a fight holds three foes at most, each no more than whole, and no Sovereign outside its own fight",
      c.foes.map((f) => [f.uid, f.id, f.hp, f.max]), [[1, stalker.id, Cb.foeNumbers(stalker, false).hp, Cb.foeNumbers(stalker, false).hp], [3, stalker.id, 10, Cb.foeNumbers(stalker, false).hp], [4, stalker.id, 10, Cb.foeNumbers(stalker, false).hp]]);
    // Five errands (agent 9, agent 1 again, titan ore, agent 4 past three, agent 2's amount), the bounty, the buff, the shield, the progress, three foes.
    same("every one of them in the ledger", ledgerLine(m), ["Your old camp's ledger didn't add up. 12 entries were set right."]);
    const own = migrateSave(clone(raw), opts);
    const ruled = (x) => [x.requisitions, x.bounty, x.buff, x.equipment, x.tasks.skilling.progress, x.tasks.combat.foes];
    same("the server's own save gets the same rules, without the line", [ruled(own), ledgerLine(own)], [ruled(m), []]);
    same("and a sound save goes through untouched", migrateSave(JSON.parse(JSON.stringify(m)), opts), m);
  }

  section("The camp's note");
  {
    const s = createState({ now: NOW, seed: 12 });
    s.skills.warfare = CONFIG.xpTable[30];
    E.applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "outer", limit: null } });
    E.advance(s, NOW + 90000);
    s.player.hp = 11.5;
    E.applyCommand(s, { type: "pullBack", args: {} });
    const note = clone(s.player.camp);
    check("set up: a note", !!note && note.since === NOW + 90000 && note.hp === 11.5);
    same("a note round-trips", migrateSave(JSON.parse(JSON.stringify(s)), opts).player.camp, note);
    const bad = [null, 5, {}, { since: "x", hp: 1, walkUntil: 1 }, { since: NOW, hp: NaN, walkUntil: NOW }];
    check("a broken note is no note", bad.every((camp) => migrateSave({ ...JSON.parse(JSON.stringify(s)), player: { ...s.player, camp } }, opts).player.camp === null));
    same("a note from the future is dated now, and can't promise a walk longer than the longest wait the rules make, or health past the sky",
      migrateSave({ ...JSON.parse(JSON.stringify(s)), player: { ...s.player, camp: { since: NOW + 1e9, hp: 1e20, walkUntil: NOW + 1e12 } } }, opts).player.camp,
      { since: s.clock, hp: 1e9, walkUntil: s.clock + CONFIG.hunt.hideMs });
    const out = JSON.parse(JSON.stringify(s));
    out.tasks.combat = Cb.newHunt(out, 1, "outer", null);
    check("no note while a hunt is out", migrateSave(out, opts).player.camp === null);
    const v4 = v4Save();
    v4.player.camp = note;
    check("and none from a v4 save, which kept none", migrateSave(clone(v4), opts).player.camp === null && migrateSave(clone(v4), legacy).player.camp === null);
  }

  section("Migration never writes to what it is given");
  {
    const saves = [
      v4Save(),
      v4Save(`addTo("bank", "slag_delve", 60); addTo("bank", "coal", 60); startSkillTask("forgemaster", "craft_slag_bar", 25); for (let i = 0; i < 17; i++) tick(1000 + i * 37);`),
      v4Save(`state.skills.warfare = XP_TABLE[30]; state.travel.unlocked.push("region_2"); addTo("inv", "provision_t3", 20); startHunt(2, "inner", 400); for (let i = 0; i < 400; i++) tick(250);`),
      v4Save(`Object.keys(MATERIALS).filter((k) => !MATERIALS[k].heal).slice(0, 18).forEach((k) => { state.inv.items[k] = 2; state.inv.order.push(k); }); state.pets = { golem: true };`),
      v4Save(`state.player.gold = 99999; buyShop("provision_t6", 1400, 10); buyShop("provision_t3", 150, 10);`),
    ];
    const seven = v4Save();
    seven.schema = 7;
    seven.spoils = [{ key: "mangy_flay", qty: 4 }, { key: "slag_sword|rare|3", qty: 1 }];
    seven.tasks.combat = { tier: 2, monsterId: "mob_t2_grunt", done: 4, elapsed: 3600000, limit: 50, startedAt: LEFT - 3600000, queued: null };
    saves.push(seven);
    let wrote = null;
    let differs = null;
    for (const [i, raw] of saves.entries()) {
      for (const o of [opts, legacy]) {
        try {
          const frozen = migrateSave(deepFreeze(clone(raw)), o);
          const d = firstDiff(clone(frozen), clone(migrateSave(clone(raw), o)));
          if (d && !differs) differs = `save ${i}: ${d}`;
        } catch (e) {
          if (!wrote) wrote = `save ${i}${o.legacy ? " (legacy)" : ""}: ${e.message}`;
        }
      }
    }
    check("a frozen v4 save migrates without a write (any write to a frozen object throws here)", !wrote, wrote);
    check("to the same result", !differs, differs);
  }
});
