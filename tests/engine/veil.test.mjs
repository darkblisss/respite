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
      !!GameData.GEAR.titan_greatsword && !!GameData.GEAR.void_grimoire);
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

    const s = atHunt(fresh(11), 40);
    put(s, "inv", "slag_sword|common", 1);
    put(s, "inv", "bitter_shield|common", 1);
    cmd(s, "equip", { key: "slag_sword|common", from: "inv" });
    cmd(s, "equip", { key: "bitter_shield|common", from: "inv" });
    const before = St.statsOf(s);
    cmd(s, "startHunt", { tier: 1, zone: "core" });
    advance(s, T0 + 60 * 60 * 1000);
    check("a hunt behind a shield banks shield and nothing else",
      s.mastery.shield > 0 && !s.mastery.sword, s.mastery);
    check("and nothing it was not carrying", !s.mastery.bow && !s.mastery.staff && !s.mastery.dagger);

    // The same hour, sword alone: the sword learns instead, at the same rate.
    const solo = atHunt(fresh(11), 40);
    put(solo, "inv", "slag_sword|common", 1);
    cmd(solo, "equip", { key: "slag_sword|common", from: "inv" });
    cmd(solo, "startHunt", { tier: 1, zone: "core" });
    advance(solo, T0 + 60 * 60 * 1000);
    check("put the shield down and the sword learns, at the very same rate",
      solo.mastery.sword > 0 && !solo.mastery.shield &&
      Math.abs(solo.mastery.sword / solo.stats.kills - s.mastery.shield / s.stats.kills) < 1e-9,
      { sword: solo.mastery.sword, shield: s.mastery.shield });

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

  section("The Veil, worked into gear");
  {
    const table = [[0, [80, 95, 100]], [1, [75, 90, 100]], [2, [70, 85, 100]], [3, [65, 80, 95]], [7, [45, 60, 75]], [14, [10, 25, 40]]];
    table.forEach(([level, want]) => {
      same(`+${level} -> +${level + 1}, by the stone`, [1, 2, 3].map((n) => Math.round(W.enchantChance(level, n) * 100)), want);
    });
    check("three stones on a bare piece is a certainty", W.enchantChance(0, 3) === 1);
    check("and nothing is ever hopeless", W.enchantChance(14, 1) > 0);

    const s = fresh(9);
    const key = "slag_sword|rare|c1.2";
    put(s, "vault", key, 1);
    refused("an attempt with no Essence", s, "enchant", { key, from: "vault", stones: 1 });
    put(s, "bank", "lesser_veil_essence", 400);
    refused("four stones", s, "enchant", { key, from: "vault", stones: 4 }, "One to 3 stones an attempt.");
    refused("a piece you do not have there", s, "enchant", { key, from: "inv", stones: 1 }, "You don't have that there.");
    refused("Essence worked into Essence", s, "enchant", { key: "lesser_veil_essence", from: "bank", stones: 1 });

    let cur = key;
    let stones = 0;
    let fails = 0;
    for (let i = 0; i < 500 && I.itemDef(cur).plus < CONFIG.enchant.max; i++) {
      const n = I.itemDef(cur).plus >= 12 ? 3 : 1;
      const res = cmd(s, "enchant", { key: cur, from: "vault", stones: n });
      if (!res.ok) break;
      stones += n;
      if (res.data.won) cur = res.data.key;
      else fails++;
    }
    const bare = I.itemDef(key);
    const done = I.itemDef(cur);
    check("a piece can be carried to the cap", done.plus === CONFIG.enchant.max, I.itemName(cur));
    check("and it cost stones, and some of them were wasted", stones > CONFIG.enchant.max && fails > 0, { stones, fails });
    check("about forty-five Essence, give or take", stones > 25 && stones < 80, stones);
    check("every stat on the line rose together",
      Math.abs(done.attack / bare.attack - (1 + CONFIG.enchant.max * CONFIG.enchant.gainPerLevel)) < 0.01,
      [bare.attack, done.attack]);
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

    // The same attempt is the same attempt however it is staked.
    const a = fresh(77);
    const b = fresh(77);
    [a, b].forEach((x) => { put(x, "vault", key, 1); put(x, "bank", "lesser_veil_essence", 9); });
    const ra = cmd(a, "enchant", { key, from: "vault", stones: 1 });
    const rb = cmd(b, "enchant", { key, from: "vault", stones: 1 });
    same("two saves from one seed roll the same attempt", ra.data.won, rb.data.won);

    // Worn is worked where it is, and a Common is minted a uid for it.
    const worn = fresh(31);
    put(worn, "inv", "slag_sword|common", 1);
    cmd(worn, "equip", { key: "slag_sword|common", from: "inv" });
    put(worn, "bank", "lesser_veil_essence", 3);
    const res = cmd(worn, "enchant", { key: "slag_sword|common", from: "weapon", stones: 3 });
    check("a worn piece is worked on your back", res.ok && res.data.won && worn.equipment.weapon === res.data.key, res);
    check("and an enchanted Common stops stacking", !I.stacks(worn.equipment.weapon) && I.itemDef(worn.equipment.weapon).plus === 1,
      worn.equipment.weapon);
    same("a save reads it back exactly", migrateSave(clone(worn), { now: worn.clock, seed: 1 }).equipment.weapon, worn.equipment.weapon);
  }
});
