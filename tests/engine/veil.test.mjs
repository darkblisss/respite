/* The Veil, spent three ways: what a discipline may hold, what a weapon owes
   you for the hours, and what an Essence buys when it is hammered into gear.

     node tests/engine/veil.test.mjs */

import { run, check, section, same, shared, clone, put } from "./harness.mjs";

await run(async () => {
  const { CONFIG } = await shared("config.js");
  const { GameData, classWeapons, classHolds, weaponLine } = await shared("registry.js");
  const { createState, migrateSave } = await shared("state.js");
  const { applyCommand, advance } = await shared("engine.js");
  const St = await shared("stats.js");
  const M = await shared("mastery.js");
  const Pa = await shared("path.js");
  const W = await shared("world.js");
  const I = await shared("items.js");

  const T0 = Date.UTC(2026, 8, 16, 9, 0);
  const fresh = (seed = 5) => createState({ now: T0, seed });
  const atHunt = (s, level) => { s.skills.warfare = CONFIG.xpTable[level]; return s; };
  const cmd = (s, type, args) => applyCommand(s, { type, args });
  const refused = (what, s, type, args, why) => {
    const before = JSON.stringify(s);
    const res = cmd(s, type, args);
    check(`refuses ${what}`, !res.ok && (!why || res.error === why) && JSON.stringify(s) === before, res.error);
  };

  /* ================= WHAT A DISCIPLINE MAY HOLD ================= */

  section("A discipline narrows the hands, and nothing else");
  {
    same("undisciplined, every line that is out is open", classWeapons(null), GameData.LIVE_LINES);
    same("the Warrior's, of what is out", classWeapons("warrior"), ["sword", "shield"]);
    same("the Rogue's two", classWeapons("rogue"), ["dagger", "bow"]);
    same("the Mage's, of what is out", classWeapons("mage"), ["staff", "sword", "shield"]);
    check("a line that is not released is nobody's, whatever the tables intend",
      ["greatsword", "grimoire"].every((line) => !GameData.LIVE_LINES.includes(line) &&
        ["warrior", "rogue", "mage", null].every((k) => !classWeapons(k).includes(line))));
    check("but its gear is still known, so a save holding one loads",
      !!GameData.GEAR.titan_greatsword && !!GameData.GEAR.idol_grimoire);
    check("and no bench will make one, nor the parts only it wanted",
      !Object.values(GameData.CRAFT_ACTIONS).flat().some((a) => /greatsword|grimoire|gblade|ggrip|_book/.test(a.id)));
    check("armour is nobody's business but the wearer's",
      ["helm", "robe", "jacket", "ring", "amulet"].every((line) => ["warrior", "rogue", "mage", null].every((k) => classHolds(k, line))));
    check("every armed line that is out is somebody's", GameData.LIVE_LINES.every((line) =>
      ["warrior", "rogue", "mage"].some((k) => classHolds(k, line))));
  }

  section("The oath lays down what it cannot hold");
  {
    const s = atHunt(fresh(), 5);
    put(s, "inv", "bitter_bow|common", 1);
    check("undisciplined, a bow goes on", cmd(s, "equip", { key: "bitter_bow|common", from: "inv" }).ok && s.equipment.weapon === "bitter_bow|common");
    check("taking the Warrior lays it down rather than refusing", cmd(s, "pickClass", { id: "warrior" }).ok &&
      s.equipment.weapon === null && s.inv.items["bitter_bow|common"] === 1);
    refused("it back on afterwards", s, "equip", { key: "bitter_bow|common", from: "inv" },
      "A Warrior does not hold a bow. Yours are Sword and Shield.");

    // Nowhere to put it: the oath waits rather than destroying anything.
    const tight = atHunt(fresh(6), 5);
    put(tight, "inv", "bitter_bow|common", 1);
    cmd(tight, "equip", { key: "bitter_bow|common", from: "inv" });
    // Every slot in the camp taken, so there is nowhere for the greatsword to go.
    const mats = Object.keys(GameData.MATERIALS);
    ["inv", "bank", "vault"].forEach((w) => {
      for (let i = 0; tight[w].order.length < tight[w].slots && i < mats.length; i++) put(tight, w, mats[i], 1);
    });
    const was = clone(tight.equipment);
    const res = cmd(tight, "pickClass", { id: "warrior" });
    check("with nowhere to lay it down the oath waits, and nothing is lost",
      !res.ok && tight.player.klass === null && JSON.stringify(tight.equipment) === JSON.stringify(was), res.error);
  }

  /* ================= WEAPON MASTERY ================= */

  section("What a weapon owes you for the hours");
  {
    same("the track runs 0 to 100", [M.masteryLevel(0), M.masteryLevel(CONFIG.masteryTable[100]), M.masteryLevel(1e12)], [0, 100, 100]);
    check("a band widens with the level", CONFIG.masteryTable[2] - CONFIG.masteryTable[1] < CONFIG.masteryTable[100] - CONFIG.masteryTable[99]);
    check("maxing one line costs about what Warfare 70 does",
      CONFIG.masteryTable[100] > CONFIG.xpTable[65] && CONFIG.masteryTable[100] < CONFIG.xpTable[75],
      { mastery: CONFIG.masteryTable[100], warfare70: CONFIG.xpTable[70] });
    same("the grades, in order", CONFIG.mastery.grades.map((g) => M.gradeOf(g.at)), CONFIG.mastery.grades.map((g) => g.name));
    check("five milestones a line, all named", GameData.WEAPON_LINES.every((w) =>
      w.ranks.length === CONFIG.mastery.rankLevels.length && w.ranks.every((n) => typeof n === "string" && n.length > 2)));

    /* One kill teaches one line, and the off-hand is the one being learned when
       there is anything in it. A shield carried is a shield being learned; the
       sword behind it is only being held. */
    const key = (b) => `${b}|common`;
    same("with a shield up, the shield is what is learned",
      M.masteryLineFor({ weapon: key("slag_sword"), offhand: key("bitter_shield") }), "shield");
    same("bare-handed on the weapon, the weapon is",
      M.masteryLineFor({ weapon: key("slag_sword"), offhand: null }), "sword");
    same("a two-hander has only itself to learn",
      M.masteryLineFor({ weapon: key("bitter_bow"), offhand: null }), "bow");
    same("empty hands learn nothing", M.masteryLineFor({ weapon: null, offhand: null }), null);

    // Hunt 12 on the first region's ground: past its gate, not yet far enough past to learn less.
    const s = atHunt(fresh(11), 12);
    put(s, "inv", "slag_sword|common", 1);
    put(s, "inv", "bitter_shield|common", 1);
    cmd(s, "equip", { key: "slag_sword|common", from: "inv" });
    cmd(s, "equip", { key: "bitter_shield|common", from: "inv" });
    const before = St.statsOf(s);
    cmd(s, "startHunt", { tier: 1, zone: "outer" });
    advance(s, T0 + 60 * 60 * 1000);
    check("a hunt behind a shield banks shield and nothing else",
      s.mastery.shield > 0 && !s.mastery.sword, s.mastery);
    check("and nothing it was not carrying", !s.mastery.bow && !s.mastery.staff && !s.mastery.dagger);

    // The same hour, sword alone: the sword learns instead, at the same rate.
    const solo = atHunt(fresh(11), 12);
    put(solo, "inv", "slag_sword|common", 1);
    cmd(solo, "equip", { key: "slag_sword|common", from: "inv" });
    cmd(solo, "startHunt", { tier: 1, zone: "outer" });
    advance(solo, T0 + 60 * 60 * 1000);
    // The same rate: a kill's mastery is the same share of what it paid Warfare, whichever line learns it.
    const learnt = (x, line) => x.mastery[line] / (x.skills.warfare - CONFIG.xpTable[12]);
    check("put the shield down and the sword learns, at the very same rate",
      solo.mastery.sword > 0 && !solo.mastery.shield && Math.abs(learnt(solo, "sword") - learnt(s, "shield")) < 1e-9,
      { sword: learnt(solo, "sword"), shield: learnt(s, "shield") });

    /* Far above the ground, a blade learns nothing from it: Hunt 40 is twenty-five
       levels past the grace on the first region, and the slope runs out long before. */
    const high = atHunt(fresh(11), 40);
    put(high, "inv", "slag_sword|common", 1);
    cmd(high, "equip", { key: "slag_sword|common", from: "inv" });
    cmd(high, "startHunt", { tier: 1, zone: "outer" });
    advance(high, T0 + 60 * 60 * 1000);
    check("a hunter far above the ground kills there and learns nothing from it", high.stats.kills > 0 && !high.mastery.sword,
      { kills: high.stats.kills, mastery: high.mastery });

    /* The BONUS is a different rule from the earning: every worn piece pays out
       its own line, so a shield you are learning and a sword you are only
       carrying are both worth what they have learned. Set outright, because two
       thousand hours of it is not a thing a test sits through. */
    s.mastery.sword = CONFIG.masteryTable[100];
    s.mastery.shield = CONFIG.masteryTable[100];
    const after = St.statsOf(s);
    const want = 1 + CONFIG.mastery.max * CONFIG.mastery.perLevel;
    check("a maxed sword is worth its whole share of the Attack",
      Math.abs(after.attack / before.attack - want) < 0.005, [before.attack, after.attack, want]);
    check("and a maxed shield its share of the Defence",
      Math.abs(after.defence / before.defence - want) < 0.005, [before.defence, after.defence, want]);

    // A mastery is the piece, not the hunter.
    const bare = clone(s);
    bare.equipment.weapon = null;
    check("take the weapon off and its bonus goes with it", St.statsOf(bare).attack < after.attack);

    s.mastery.bow = CONFIG.masteryTable[100];
    check("a hundred in a line you are not holding is worth nothing here",
      Math.abs(St.statsOf(s).attack - after.attack) < 1e-9);

    const sheet = M.masterySheet(s);
    same("the sheet lists every line that is out, in the page's order",
      sheet.map((r) => r.line), GameData.LIVE_LINES);
    check("and never one that is not out yet", sheet.every((r) => r.def.released !== false));
    check("all of them are open to the undisciplined", sheet.every((r) => r.held));
    check("the one being learned is marked", sheet.filter((r) => r.learning).map((r) => r.line).join(",") === "shield");
    cmd(s, "pickClass", { id: "mage" });
    const mage = M.masterySheet(s);
    check("and a Mage's sheet shuts the lines it cannot hold",
      mage.filter((r) => r.held).map((r) => r.line).sort().join(",") === "shield,staff,sword");
    check("a shut line still keeps the hours already in it", mage.find((r) => r.line === "bow").level === 100);
  }

  /* ================= THE PATH ================= */

  section("A path is what you leave out");
  {
    check("ten nodes a discipline, none of them shared",
      Object.values(GameData.PATHS).every((p) => p.length === 10) &&
      new Set(GameData.PATH_NODE_IDS).size === GameData.PATH_NODE_IDS.length);
    check("every tree costs the same to fill, and more than Hunt 99 pays",
      Object.values(GameData.PATHS).every((p) => p.reduce((n, x) => n + x.ranks * x.cost, 0) === 38));

    const s = atHunt(fresh(3), 5);
    refused("a node without a discipline", s, "walkPath", { node: "wr_ironhide" }, "Take a discipline first.");
    cmd(s, "pickClass", { id: "warrior" });
    same("one point with the oath", [Pa.pointsEarned(s), Pa.pointsLeft(s)], [1, 1]);
    check("and it can be spent", cmd(s, "walkPath", { node: "wr_ironhide" }).ok && s.path.wr_ironhide === 1);
    refused("a second point there is none", s, "walkPath", { node: "wr_ironhide" });
    refused("another discipline's node", s, "walkPath", { node: "rg_quickhands" }, "That is not on your path.");

    atHunt(s, 99);
    same("Hunt 99 pays thirty-two", Pa.pointsEarned(s), 32);
    refused("a keystone before the band opens", s, "walkPath", { node: "wr_devastation" });

    const before = St.statsOf(s);
    let guard = 0;
    while (guard++ < 200) {
      const next = Pa.pathSheet(s).nodes.find((n) => n.can);
      if (!next) break;
      cmd(s, "walkPath", { node: next.node.id });
    }
    const sheet = Pa.pathSheet(s);
    check("every point lands and no more than were earned", sheet.spent === sheet.earned && sheet.left === 0, sheet.spent);
    check("but never the whole tree", sheet.spent < sheet.full, [sheet.spent, sheet.full]);
    const after = St.statsOf(s);
    check("a walked path is worth real numbers", after.attack > before.attack && after.maxHp > before.maxHp && after.defence > before.defence);
    check("and never a stat the tree does not touch", after.critDmg === before.critDmg);

    // The keystones, reached the other way about.
    const key = atHunt(fresh(4), 99);
    cmd(key, "pickClass", { id: "mage" });
    for (let i = 0; i < 4; i++) cmd(key, "walkPath", { node: "mg_kindling" });
    for (let i = 0; i < 4; i++) cmd(key, "walkPath", { node: "mg_warded" });
    for (let i = 0; i < 4; i++) cmd(key, "walkPath", { node: "mg_breath" });
    for (let i = 0; i < 4; i++) cmd(key, "walkPath", { node: "mg_focus" });
    check("sixteen down opens the keystones", cmd(key, "walkPath", { node: "mg_elemental" }).ok && key.path.mg_elemental === 1);
    check("and a full Veil is worth more for it", St.statsOf(key).tech > 1, St.statsOf(key).tech);
    refused("a keystone twice", key, "walkPath", { node: "mg_elemental" }, "That is as far as it goes.");

    key.player.gold = 0;
    refused("a reset with no gold", key, "resetPath", {});
    key.player.gold = 1e6;
    const spent = Pa.pointsSpent(key);
    check("a reset hands every point back, for gold", cmd(key, "resetPath", {}).ok &&
      Pa.pointsSpent(key) === 0 && key.player.gold === 1e6 - spent * CONFIG.path.respecGold);

    // A save claiming more than its levels paid for has the lot handed back.
    const cheat = clone(key);
    cheat.path = { mg_kindling: 4, mg_warded: 4, mg_breath: 4, mg_focus: 4, mg_pierce: 4, mg_deepwell: 4, mg_cadence: 4, mg_overchannel: 4, mg_elemental: 1, mg_arcanebulwark: 1 };
    same("a save that spent more than it earned keeps none of it", migrateSave(cheat, { now: cheat.clock, seed: 1 }).path, {});
    const crossed = clone(key);
    crossed.path = { rg_quickhands: 4, mg_kindling: 2 };
    same("and a save holding another discipline's nodes keeps only its own",
      migrateSave(crossed, { now: crossed.clock, seed: 1 }).path, { mg_kindling: 2 });
  }

  /* ================= ENCHANTING ================= */

  section("The Veil, worked into gear: the rite");
  {
    // The forge table: a stone is 3,000 against the threshold of the level reached, a charm is x1.5.
    const table = [[0, [100, 100, 100]], [4, [20, 40, 60]], [5, [10.71, 21.43, 32.14]], [8, [2, 4, 6]], [11, [0.33, 0.67, 1]], [14, [0.03, 0.07, 0.1]]];
    table.forEach(([level, want]) => {
      same(`+${level} -> +${level + 1}, by the stone`, [1, 2, 3].map((n) => Math.round(W.enchantChance(level, n) * 10000) / 100), want);
    });
    check("three stones on a bare piece is a certainty", W.enchantChance(0, 3) === 1);
    check("and nothing is ever hopeless", W.enchantChance(14, 1) > 0);
    check("a charm is half as much again, held at 100%",
      Math.abs(W.enchantChance(5, 3, true) - W.enchantChance(5, 3) * CONFIG.enchant.charmMult) < 1e-9 && W.enchantChance(0, 3, true) === 1);
    check("and past the top there are no odds at all", W.enchantChance(CONFIG.enchant.max, 3) === 0);

    check("only an amulet or a ring takes the Veil",
      I.canFortify("slag_ring") && I.canFortify("mud_amulet") && !I.canFortify("slag_sword") && !I.canFortify("bog_helm") && !I.canFortify("lesser_veil_essence"));
    check("a + on a sword reads as nothing, wherever the key came from",
      I.parseKey("slag_sword|rare|c1.2|+7").plus === 0 && I.itemName("slag_sword|rare|c1.2|+7") === "Slag Sword" &&
      I.makeKey("slag_sword", "rare", "c1", null, 7) === "slag_sword|rare|c1");
    same("the halos, from the level they start at", [8, 9, 11, 12, 14, 15].map((n) => (I.haloOf(n) ? I.haloOf(n).id : null)),
      [null, "veiled", "veiled", "sovereign", "sovereign", "hallowed"]);
    check("a commander wears the highest of what is worn",
      I.wornHalo({ ring: "slag_ring|rare|c1|+12", neck: "mud_amulet|rare|c2|+9", weapon: "slag_sword|rare|c3" }).id === "sovereign" &&
      I.wornHalo({ ring: "slag_ring|rare|c1|+8" }) === null);

    const s = fresh(9);
    const key = "slag_ring|rare|c1.2";
    put(s, "vault", key, 1);
    put(s, "vault", "slag_sword|rare|c1.3", 1);
    refused("an attempt with no Essence", s, "enchant", { key, from: "vault", stones: 1 });
    put(s, "bank", "lesser_veil_essence", 30000);
    refused("four stones", s, "enchant", { key, from: "vault", stones: 4 }, "One to 3 stones an attempt.");
    refused("a piece you do not have there", s, "enchant", { key, from: "inv", stones: 1 }, "You don't have that there.");
    refused("Essence worked into Essence", s, "enchant", { key: "lesser_veil_essence", from: "bank", stones: 1 });
    refused("the Veil worked into a sword", s, "enchant", { key: "slag_sword|rare|c1.3", from: "vault", stones: 3 }, "Only an amulet or a ring takes the Veil.");
    refused("a charm you do not hold", s, "enchant", { key, from: "vault", stones: 3, charm: true }, "You need a Lesser Veil Charm.");

    let cur = key;
    let stones = 0;
    let fails = 0;
    for (let i = 0; i < 10000 && I.itemDef(cur).plus < CONFIG.enchant.max; i++) {
      const res = cmd(s, "enchant", { key: cur, from: "vault", stones: 3 });
      if (!res.ok) break;
      stones += 3;
      if (res.data.won) cur = res.data.key;
      else fails++;
    }
    const bare = I.itemDef(key);
    const done = I.itemDef(cur);
    check("a piece can be carried to the cap, with enough Essence", done.plus === CONFIG.enchant.max, I.itemName(cur));
    check("and it cost stones, and most of them were wasted: thousands, for a ring", stones > 1000 && fails > 300, { stones, fails });
    check("every stat on the line rose together",
      Math.abs(done.defence / bare.defence - (1 + CONFIG.enchant.max * CONFIG.enchant.gainPerLevel)) < 0.01,
      [bare.defence, done.defence]);
    check("and it is worth more than a bare one", done.value > bare.value);
    refused("a sixteenth level", s, "enchant", { key: cur, from: "vault", stones: 3 }, `That is as much Veil as a piece will hold (+${CONFIG.enchant.max}).`);

    // A failure takes the stones and leaves the piece exactly as it was.
    const one = fresh(21);
    put(one, "vault", key, 1);
    put(one, "bank", "lesser_veil_essence", 60);
    let sawFail = false;
    let at = key;
    for (let i = 0; i < 60 && !sawFail; i++) {
      const res = cmd(one, "enchant", { key: at, from: "vault", stones: 1 });
      if (!res.ok) break;
      if (res.data.won) at = res.data.key;
      else {
        sawFail = true;
        check("a failure takes the stones and nothing else",
          one.vault.items[at] === 1 && I.itemDef(at).plus === res.data.level, { at, left: one.bank.items.lesser_veil_essence });
      }
    }
    check("a failure did happen, so that was a real test", sawFail);

    // The charm is spent either way, and the ride is on the same die.
    const ch = fresh(21);
    put(ch, "vault", key, 1);
    put(ch, "bank", "lesser_veil_essence", 60);
    put(ch, "bank", "lesser_veil_charm", 1);
    const r5 = cmd(ch, "enchant", { key, from: "vault", stones: 1, charm: true });
    check("a charmed attempt spends the charm whatever happens", r5.ok && !ch.bank.items.lesser_veil_charm && r5.data.charm === true, r5);
    check("and the Bonesetter sells charms at an Essence's worth",
      W.shopStock(ch).some((e) => e.key === "lesser_veil_charm" && e.price === 300) && cmd(ch, "buyRemedy", { key: "veiled_charm", qty: 1 }).error === "Not enough gold.");
    ch.player.gold = 1000;
    check("bought, a charm goes where materials go", cmd(ch, "buyRemedy", { key: "lesser_veil_charm", qty: 2 }).ok && ch.bank.items.lesser_veil_charm === 2 && ch.player.gold === 400);

    // The same attempt is the same attempt however it is staked.
    const a = fresh(77);
    const b = fresh(77);
    [a, b].forEach((x) => { put(x, "vault", key, 1); put(x, "bank", "lesser_veil_essence", 9); });
    const ra = cmd(a, "enchant", { key, from: "vault", stones: 1 });
    const rb = cmd(b, "enchant", { key, from: "vault", stones: 1 });
    same("two saves from one seed roll the same attempt", ra.data.won, rb.data.won);

    // Worn is worked where it is, and a Common is minted a uid for it.
    const worn = fresh(31);
    put(worn, "inv", "slag_ring|common", 1);
    cmd(worn, "equip", { key: "slag_ring|common", from: "inv" });
    put(worn, "bank", "lesser_veil_essence", 3);
    const res = cmd(worn, "enchant", { key: "slag_ring|common", from: "ring", stones: 3 });
    check("a worn piece is worked on your hand", res.ok && res.data.won && worn.equipment.ring === res.data.key, res);
    check("and a worked Common stops stacking", !I.stacks(worn.equipment.ring) && I.itemDef(worn.equipment.ring).plus === 1,
      worn.equipment.ring);
    check("the halo is announced the moment a piece reaches it", (() => {
      const h = fresh(2);
      const k = "slag_ring|rare|c7|+8";
      put(h, "vault", k, 1);
      put(h, "bank", "lesser_veil_essence", 3000);
      for (let i = 0; i < 1000; i++) {
        const r = cmd(h, "enchant", { key: k, from: "vault", stones: 3 });
        if (r.ok && r.data.won) return r.data.halo === "veiled" && r.data.level === 9;
      }
      return false;
    })());
  }

  section("The rite's dice survive the server");
  {
    /* Every server request loads the save through migrateSave. The normaliser used to keep only
       prefixed roll keys, so rolls.ench was dropped on every load and every attempt rolled
       attempt number 0: the same number each time. 37.5% of camps could never pass a 60%
       attempt, however many they made. Each attempt here goes through a load, as it does live. */
    const load = (x) => migrateSave(JSON.parse(JSON.stringify(x)), { now: x.clock + 1000, seed: 1 });
    const ring = "slag_ring|rare|c1.2|+4";
    const chance = W.enchantChance(4, 3);
    same("the attempt in question: +4 to +5, three stones", Math.round(chance * 100), 60);

    let passed = 0;
    let tried = 0;
    let worstRun = 0;
    let neverPassed = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let s = fresh(seed);
      put(s, "vault", ring, 1);
      put(s, "bank", "lesser_veil_essence", 3 * 30);
      let won = 0;
      let run = 0;
      for (let i = 0; i < 30; i++) {
        s = load(s);
        const res = cmd(s, "enchant", { key: ring, from: "vault", stones: 3 });
        if (!res.ok) break;
        tried++;
        if (res.data.won) {
          won++;
          run = 0;
          // Put it back to +4 so every attempt is the same 60%.
          s.vault.items = {};
          put(s, "vault", ring, 1);
        } else {
          run++;
          worstRun = Math.max(worstRun, run);
        }
      }
      passed += won;
      if (won === 0) neverPassed++;
    }
    const rate = passed / tried;
    check("across loads, a 60% attempt passes about 60% of the time", rate > 0.52 && rate < 0.68, { rate, tried });
    same("and no camp is shut out of it", neverPassed, 0);
    check("nor fails twenty in a row", worstRun < 20, worstRun);

    const s = fresh(9);
    s.rolls.ench = 41;
    same("the counter comes through a load", load(s).rolls.ench, 41);

    // A camp that lost it starts past every worked Common it minted, and never at 0 again.
    const lost = fresh(9);
    put(lost, "vault", "slag_ring|common|e0|+3", 1);
    put(lost, "vault", "slag_ring|common|e12|+1", 1);
    delete lost.rolls.ench;
    same("a camp that lost the counter picks up past its worked Commons", load(lost).rolls.ench, 13);
    const rareOnly = fresh(9);
    put(rareOnly, "vault", "slag_ring|rare|c1.2|+4", 1);
    same("and a camp with only a worked rare starts at 1, not the 0 it was stuck on", load(rareOnly).rolls.ench, 1);
    same("a camp that never worked anything is left as it was", load(fresh(9)).rolls.ench, undefined);
  }

  section("Carried across: convert");
  {
    const s = fresh(12);
    const from = "slag_ring|rare|c1.2|+12";
    const to = "cairn_ring|epic|c2.4";
    put(s, "vault", from, 1);
    put(s, "vault", to, 1);
    put(s, "vault", "mud_amulet|rare|c3", 1);
    put(s, "vault", "slag_sword|rare|c4", 1);
    const toll = W.convertToll(12, to);
    same("the toll: gold by the square, and Essence of the new piece's band", toll, { gold: 7200, stone: "veiled_essence", essence: 12 });
    check("carrying nothing costs nothing and is not a rite", W.convertToll(0, to) === null && W.convertToll(5, "slag_sword|rare|c4") === null);
    const plan = W.convertPlan(s, from, to);
    check("the plan says what moves and what it wants", plan.ok && plan.level === 12 && plan.afford === false && plan.halo.id === "sovereign", plan);
    check("a ring's level goes onto a ring, not an amulet", !W.convertPlan(s, from, "mud_amulet|rare|c3").ok);
    check("nor onto a sword", !W.convertPlan(s, from, "slag_sword|rare|c4").ok);
    check("nor onto a worked piece", !W.convertPlan(s, from, "slag_ring|rare|c9|+3").ok);
    check("nor from an unworked one", !W.convertPlan(s, to, from).ok);

    refused("a carrying with no gold", s, "convert", { from: { key: from, at: "vault" }, to: { key: to, at: "vault" } }, "The toll is 7,200g.");
    s.player.gold = 10000;
    refused("a carrying with no Essence of the new band", s, "convert", { from: { key: from, at: "vault" }, to: { key: to, at: "vault" } }, "The toll wants 12 Veiled Essences.");
    put(s, "bank", "veiled_essence", 20);
    refused("the wrong slot", s, "convert", { from: { key: from, at: "vault" }, to: { key: "mud_amulet|rare|c3", at: "vault" } });
    refused("a piece you do not have there", s, "convert", { from: { key: from, at: "inv" }, to: { key: to, at: "vault" } }, "You don't have that there.");

    const res = cmd(s, "convert", { from: { key: from, at: "vault" }, to: { key: to, at: "vault" } });
    check("the level crosses whole, for the toll", res.ok && res.data.level === 12 && s.player.gold === 2800 && s.bank.items.veiled_essence === 8, res);
    check("the new piece wears it", res.ok && I.itemDef(res.data.key).plus === 12 && res.data.key.startsWith("cairn_ring|epic|c2.4") && s.vault.items[res.data.key] === 1);
    check("and the old one is bare, not gone", res.ok && res.data.from === "slag_ring|rare|c1.2" && s.vault.items["slag_ring|rare|c1.2"] === 1 && !s.vault.items[from]);
    refused("carrying it again from a bare piece", s, "convert", { from: { key: "slag_ring|rare|c1.2", at: "vault" }, to: { key: res.data.key, at: "vault" } });

    // Worn pieces are worked where they are, on both ends.
    const w = fresh(13);
    put(w, "inv", "slag_ring|common", 1);
    cmd(w, "equip", { key: "slag_ring|common", from: "inv" });
    put(w, "bank", "lesser_veil_essence", 3);
    const up = cmd(w, "enchant", { key: "slag_ring|common", from: "ring", stones: 3 });
    put(w, "inv", "mire_ring|rare|c5", 1);
    w.player.gold = 100;
    put(w, "bank", "lesser_veil_essence", 5);
    const r2 = cmd(w, "convert", { from: { key: up.data.key, at: "ring" }, to: { key: "mire_ring|rare|c5", at: "inv" } });
    check("a worn ring hands its level to one in Belongings", r2.ok && w.equipment.ring === "slag_ring|common" && w.inv.items[r2.data.key] === 1 && I.itemDef(r2.data.key).plus === 1, r2);
    check("and a minted Common goes back to its pile", r2.ok && r2.data.from === "slag_ring|common");
  }

  section("Schema 13 takes the Veil off everything but jewellery");
  {
    const s = fresh(4);
    s.schema = 12;
    put(s, "vault", "slag_sword|rare|c1.2|+7", 1);
    put(s, "vault", "slag_sword|common|e4|+2", 1);
    put(s, "vault", "slag_sword|common", 2);
    put(s, "vault", "slag_ring|rare|c9|+9", 1);
    s.equipment.weapon = "bitter_bow|epic|c3|+5";
    s.equipment.ring = "mire_ring|epic|c8|+12";
    const m = migrateSave(clone(s), { now: s.clock, seed: 4 });
    same("a worked sword is a sword", m.vault.items["slag_sword|rare|c1.2"], 1);
    same("a minted Common goes back to its pile, and the piles merge", m.vault.items["slag_sword|common"], 3);
    same("a worked ring keeps its level", m.vault.items["slag_ring|rare|c9|+9"], 1);
    check("worn too, both ways", m.equipment.weapon === "bitter_bow|epic|c3" && m.equipment.ring === "mire_ring|epic|c8|+12");
    check("and nothing is handed back for it", !m.bank.items.lesser_veil_essence && m.schema === 13);
  }

});
