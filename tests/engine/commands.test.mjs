/* Commands: every command's success path and each of its refusals, that a
   refusal leaves the save exactly as it was, that junk of every type is
   turned away without a throw, and the save-side halves of the market.

     node tests/engine/commands.test.mjs */

import { run, check, section, same, shared, clone, put, listening, gearSet } from "./harness.mjs";

await run(async () => {
  const { CONFIG } = await shared("config.js");
  const { GameData } = await shared("registry.js");
  const { createState } = await shared("state.js");
  const E = await shared("engine.js");
  const St = await shared("stats.js");
  const S = await shared("storage.js");
  const W = await shared("world.js");
  const M = await shared("market.js");
  const I = await shared("items.js");

  const T0 = Date.UTC(2026, 8, 16, 9, 0);
  const fresh = (seed = 7) => createState({ now: T0, seed });
  const mats = Object.keys(GameData.MATERIALS).filter((k) => !GameData.MATERIALS[k].heal && k !== "vault_chest");
  // The Satchel takes remedies alone, so it is filled with kinds of those.
  const kinds = GameData.REMEDIES.map((r) => r.id);
  const fillAll = (s, pools = S.POOLS, keep = []) => {
    let i = 0;
    let r = 0;
    for (const w of pools) {
      while (!S.isFull(s, w)) {
        if (w === "satchel") {
          const k = kinds[r++];
          if (!k) break;
          put(s, w, k, 1);
          continue;
        }
        const k = mats[i++];
        if (!keep.includes(k) && !S.POOLS.some((p) => Object.hasOwn(s[p].items, k))) put(s, w, k, 1);
      }
    }
  };

  const w = await listening();
  const cmd = (s, type, args) => E.applyCommand(s, { type, args }, w.env);

  // A refusal: the error, and the save untouched.
  function refused(label, s, type, args, error) {
    const before = clone(s);
    const res = cmd(s, type, args);
    return same(`${type} refuses ${label}`, [res, s], [{ ok: false, error }, before]);
  }

  section("Dispatch");
  {
    const s = fresh();
    const before = clone(s);
    same("unknown command", [cmd(s, "nope", {}), cmd(s, "toString", {}), cmd(s, "__proto__", {}), E.applyCommand(s, null, w.env), E.applyCommand(s, { type: 5 }, w.env), s],
      [{ ok: false, error: "Unknown command." }, { ok: false, error: "Unknown command." }, { ok: false, error: "Unknown command." }, { ok: false, error: "Unknown command." }, { ok: false, error: "Unknown command." }, before]);
    same("server-only commands", E.SERVER_ONLY.map((t) => cmd(s, t, { key: "coal" })), E.SERVER_ONLY.map(() => ({ ok: false, error: "That needs the server." })));
    same("COMMANDS: the predictable ones and the server's", Object.keys(E.COMMANDS).filter((t) => E.COMMANDS[t].predict).sort(),
      ["startSkill", "stopSkill", "startHunt", "pullBack", "setHide", "pickClass", "setSex", "equip", "unequip", "unequipTool", "moveItem", "sellItem", "salvage", "useChest", "repair", "reorder", "buyRemedy", "buySmuggler", "travel", "claimBounty", "hireAgent", "deployAgent", "buyCompanion", "setCompanion"].sort());
    check("SERVER_ONLY is the market and the party's fight", E.SERVER_ONLY.join(",") === "marketList,marketBuy,marketBuyPool,marketCancel,partyHuntStart,partyHuntJoin,partyHuntLeave" && E.SERVER_ONLY.every((t) => E.COMMANDS[t] && !E.COMMANDS[t].predict));
    check("args that aren't an object count as none", cmd(s, "stopSkill", "junk").ok && cmd(s, "stopSkill", [1, 2]).ok && cmd(s, "setHide", null).error === "Hiding is on or off.");
  }

  section("Work and the hunt");
  {
    const s = fresh();
    check("startSkill", cmd(s, "startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: 5 }).ok && s.tasks.skilling.limit === 5 && s.tasks.skilling.id === 1 && s.tasks.skilling.startedAt === T0);
    refused("the hunt as a trade", s, "startSkill", { skillId: "warfare", actionId: "delving_t1_raw", limit: null }, "No such work.");
    refused("an action from another skill", s, "startSkill", { skillId: "felling", actionId: "delving_t1_raw", limit: null }, "No such work.");
    refused("a level too high", s, "startSkill", { skillId: "delving", actionId: "delving_t2_raw", limit: null }, "Needs Delving 10.");
    refused("with nothing to pay for it", s, "startSkill", { skillId: "forgemaster", actionId: "craft_slag_bar", limit: null }, "Not enough materials.");
    for (const limit of [0, -1, 100001, 1.5, "5", true, {}]) refused(`limit ${JSON.stringify(limit)}`, s, "startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit }, "A batch is 1 to 100,000, or no limit.");
    const full = fresh();
    fillAll(full, S.POOLS, ["slag_delve"]);
    refused("when nothing has anywhere to go", full, "startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: null }, "Nowhere to put anything.");
    check("stopSkill", cmd(s, "stopSkill", {}).ok && s.tasks.skilling === null && cmd(s, "stopSkill", {}).ok);
  }
  {
    const s = fresh();
    check("startHunt from a camp with no note sets out whole, after the shortest walk, with an id and no stream of its own", (() => { s.player.hp = 3; return cmd(s, "startHunt", { tier: 1, zone: "outer", limit: null }).ok; })() &&
      s.player.hp === St.maxHp(s) && s.tasks.combat.id === 1 && !("rng" in s.tasks.combat) && s.tasks.combat.wait === CONFIG.hunt.searchMinMs && s.serial === 2 && s.player.camp === null);
    refused("locked ground", s, "startHunt", { tier: 2, zone: "outer", limit: null }, "That ground isn't open.");
    for (const tier of [0, 10, "1", 1.5, null]) refused(`tier ${JSON.stringify(tier)}`, s, "startHunt", { tier, zone: "outer", limit: null }, "That ground isn't open.");
    refused("an unknown zone", s, "startHunt", { tier: 1, zone: "nope", limit: null }, "No such zone.");
    refused("limit 0", s, "startHunt", { tier: 1, zone: "outer", limit: 0 }, "A hunt is 1 to 100,000 kills, or no limit.");
    s.player.recoveryLeft = 5;
    refused("while recovering", s, "startHunt", { tier: 1, zone: "outer", limit: null }, "You're still recovering.");
    const walk = s.tasks.combat.wait;
    check("pullBack leaves the camp a note", cmd(s, "pullBack", {}).ok && s.tasks.combat === null && JSON.stringify(s.player.camp) === JSON.stringify({ since: T0, hp: St.maxHp(s), walkUntil: T0 + walk }));
    const noted = clone(s);
    same("pullBack with nothing out changes nothing", [cmd(s, "pullBack", {}), s], [{ ok: true }, noted]);
    w.events.length = 0;
    check("setHide", cmd(s, "setHide", { on: true }).ok && s.settings.hideSovereign === true && w.of("settings:hide")[0].on === true && cmd(s, "setHide", { on: false }).ok && !s.settings.hideSovereign);
    for (const on of [1, "true", null, undefined]) refused(`on ${JSON.stringify(on)}`, s, "setHide", { on }, "Hiding is on or off.");
  }
  {
    const s = fresh();
    refused("before Hunt 5", s, "pickClass", { id: "mage" }, "The Veil opens at Hunt 5.");
    s.skills.warfare = CONFIG.xpTable[5];
    refused("an unknown discipline", s, "pickClass", { id: "bard" }, "No such discipline.");
    w.events.length = 0;
    check("pickClass: health refills, v4's line", cmd(s, "pickClass", { id: "warrior" }).ok && s.player.klass === "warrior" && s.player.hp === St.maxHp(s) && s.log.some((l) => l.m === "You take up the Warrior's discipline."));
    refused("a second time", s, "pickClass", { id: "rogue" }, "Your discipline is already chosen.");
  }
  {
    const s = fresh();
    s.skills.warfare = CONFIG.xpTable[5];
    cmd(s, "startHunt", { tier: 1, zone: "outer", limit: null });
    s.player.hp = 4;
    cmd(s, "pullBack", {});
    check("pickClass back at camp: the refill holds for the next hunt too", s.player.camp.hp === 4 && cmd(s, "pickClass", { id: "mage" }).ok && s.player.camp.hp === St.maxHp(s) &&
      cmd(s, "startHunt", { tier: 1, zone: "outer", limit: null }).ok && s.player.hp === St.maxHp(s));
  }

  section("Items and equipment");
  {
    const s = fresh();
    put(s, "inv", "slag_sword|rare|c1.1", 1);
    put(s, "bank", "bitter_shield|common", 2);
    put(s, "vault", "bitter_bow|common", 1);
    check("equip a sword", cmd(s, "equip", { key: "slag_sword|rare|c1.1", from: "inv" }).ok && s.equipment.weapon === "slag_sword|rare|c1.1" && !s.inv.items["slag_sword|rare|c1.1"]);
    check("equip an offhand from a stack", cmd(s, "equip", { key: "bitter_shield|common", from: "bank" }).ok && s.equipment.offhand === "bitter_shield|common" && s.bank.items["bitter_shield|common"] === 1);
    check("a two-hander pushes both hands back where it came from", cmd(s, "equip", { key: "bitter_bow|common", from: "vault" }).ok &&
      s.equipment.weapon === "bitter_bow|common" && s.equipment.offhand === null && s.vault.items["slag_sword|rare|c1.1"] === 1 && s.bank.items["bitter_shield|common"] === 2);
    refused("an offhand under a two-hander", s, "equip", { key: "bitter_shield|common", from: "bank" }, "Hands are on the Bitter Bow.");
    refused("a material", (put(s, "bank", "coal", 3), s), "equip", { key: "coal", from: "bank" }, "That can't be worn.");
    refused("something not there", s, "equip", { key: "slag_helm|common", from: "inv" }, "You don't have that there.");
    refused("a junk key", s, "equip", { key: "slag_sword|mythic|1", from: "inv" }, "No such item.");
    refused("a junk pool", s, "equip", { key: "coal", from: "cellar" }, "No such store.");

    // Two swords in one stack: taking one out frees no slot for the bow coming off.
    const tight = fresh();
    put(tight, "inv", "slag_sword|common", 2);
    tight.equipment.weapon = "bitter_bow|common";
    fillAll(tight);
    refused("with no room to stow what you're wearing", tight, "equip", { key: "slag_sword|common", from: "inv" }, "No room to stow what you're wearing.");
    check("unless the new piece leaves its slot behind for it", (() => {
      const t2 = clone(tight);
      delete t2.inv.items["slag_sword|common"];
      t2.inv.order = t2.inv.order.filter((k) => k !== "slag_sword|common");
      put(t2, "inv", "slag_sword|rare|c1.2", 1);
      return cmd(t2, "equip", { key: "slag_sword|rare|c1.2", from: "inv" }).ok && t2.inv.items["bitter_bow|common"] === 1 && t2.equipment.weapon === "slag_sword|rare|c1.2";
    })());
    refused("to take off into full storage", tight, "unequip", { slot: "weapon" }, "Nowhere to put it.");

    check("unequip into Belongings", cmd(s, "unequip", { slot: "weapon" }).ok && s.equipment.weapon === null && s.inv.items["bitter_bow|common"] === 1);
    refused("an empty slot", s, "unequip", { slot: "weapon" }, "Nothing is worn there.");
    for (const slot of ["hat", null, 3, "__proto__"]) refused(`slot ${JSON.stringify(slot)}`, s, "unequip", { slot }, "No such slot.");

    put(s, "vault", "slag_pick", 2);
    w.events.length = 0;
    check("equip a tool into the rack", cmd(s, "equip", { key: "slag_pick", from: "vault" }).ok && s.tools.delving === "slag_pick" && s.vault.items.slag_pick === 1 && s.log.some((l) => l.m === "Slag Pickaxe taken up."));
    put(s, "inv", "cold_pick", 1);
    check("a better tool puts the old one away, onto its stack if one is held", cmd(s, "equip", { key: "cold_pick", from: "inv" }).ok && s.tools.delving === "cold_pick" && s.vault.items.slag_pick === 2 && !s.inv.items.cold_pick);
    check("unequipTool back to the Stockpile", cmd(s, "unequipTool", { skillId: "delving" }).ok && !s.tools.delving && s.bank.items.cold_pick === 1);
    refused("with no tool in hand", s, "unequipTool", { skillId: "delving" }, "No tool in hand for that.");
    refused("for junk", s, "unequipTool", { skillId: "__proto__" }, "No tool in hand for that.");
    const rack = fresh();
    rack.tools.felling = "bitter_axe";
    fillAll(rack);
    refused("with nowhere to put it", rack, "unequipTool", { skillId: "felling" }, "Nowhere to put it.");
    put(rack, "bank", "blood_axe", 1);
    refused("with nowhere to stow the old tool", (() => { rack.bank.items = { ...rack.bank.items }; return rack; })(), "equip", { key: "blood_axe", from: "bank" }, "Nowhere to stow the old tool.");
  }
  {
    const s = fresh();
    put(s, "bank", "coal", 10);
    w.events.length = 0;
    check("moveItem part of a stack", cmd(s, "moveItem", { key: "coal", from: "bank", to: "vault", qty: 4 }).ok && s.bank.items.coal === 6 && s.vault.items.coal === 4 && w.of("item:moved")[0].qty === 4);
    check("moveItem the whole stack", cmd(s, "moveItem", { key: "coal", from: "bank", to: "vault", qty: null }).ok && !s.bank.items.coal && s.vault.items.coal === 10);
    check("moveItem more than is there moves what is there", cmd(s, "moveItem", { key: "coal", from: "vault", to: "inv", qty: 99 }).ok && s.inv.items.coal === 10);
    refused("to the same pool", s, "moveItem", { key: "coal", from: "inv", to: "inv", qty: 1 }, "It's already there.");
    for (const qty of [0, -2, 1.5, "3", true]) refused(`qty ${JSON.stringify(qty)}`, s, "moveItem", { key: "coal", from: "inv", to: "bank", qty }, "Pick an amount to move.");
    refused("to a junk pool", s, "moveItem", { key: "coal", from: "inv", to: "attic", qty: 1 }, "No such store.");
    const full = fresh();
    put(full, "inv", "resin", 5);
    fillAll(full, ["vault"]);
    refused("into a full pool", full, "moveItem", { key: "resin", from: "inv", to: "vault", qty: 1 }, "Vault is full.");


    const gold = s.player.gold;
    w.events.length = 0;
    check("sellItem earns gold", cmd(s, "sellItem", { key: "coal", from: "inv", qty: 3 }).ok && s.player.gold === gold + 3 && s.stats.goldEarned === 3 && s.inv.items.coal === 7 && w.of("item:sold")[0].gold === 3);
    check("sellItem all", cmd(s, "sellItem", { key: "coal", from: "inv", qty: null }).ok && !s.inv.items.coal && s.player.gold === gold + 10);
    refused("what isn't there", s, "sellItem", { key: "coal", from: "inv", qty: null }, "You don't have that there.");
    put(s, "inv", "resin", 2);
    refused("qty 0", s, "sellItem", { key: "resin", from: "inv", qty: 0 }, "Pick an amount to sell.");

    put(s, "vault", "slag_helm|epic|s1.0", 1);
    check("salvage", cmd(s, "salvage", { key: "slag_helm|epic|s1.0", from: "vault" }).ok && s.bank.items.slag_bar === 8 && !s.vault.items["slag_helm|epic|s1.0"] && s.log.some((l) => l.m === "Broke down Epic Slag Helm for 8 Slag Bar."));
    refused("a material", s, "salvage", { key: "resin", from: "inv" }, "That can't be broken down.");
    const cramped = fresh();
    put(cramped, "inv", "slag_helm|common", 2);
    fillAll(cramped, S.POOLS, ["slag_bar"]);
    refused("with no room for what it breaks down into", cramped, "salvage", { key: "slag_helm|common", from: "inv" }, "No room for what it breaks down into.");

    put(s, "inv", "vault_chest", 2);
    check("useChest widens the Stockpile", cmd(s, "useChest", { key: "vault_chest", from: "inv" }).ok && s.bank.slots === 35 && s.inv.items.vault_chest === 1 && s.log.some((l) => l.m === "The Stockpile widened to 35 slots."));
    refused("on something else", s, "useChest", { key: "resin", from: "inv" }, "That isn't a chest.");
    s.bank.slots = 200;
    refused("past 200 slots", s, "useChest", { key: "vault_chest", from: "inv" }, "The Stockpile can't be widened any further.");


    const r = fresh();
    ["coal", "resin", "pulp", "tallow"].forEach((k) => put(r, "bank", k, 1));
    check("reorder before another key", cmd(r, "reorder", { pool: "bank", key: "tallow", before: "resin" }).ok && r.bank.order.join(",") === "coal,tallow,resin,pulp");
    check("reorder to the end", cmd(r, "reorder", { pool: "bank", key: "coal", before: null }).ok && r.bank.order.join(",") === "tallow,resin,pulp,coal");
    check("reorder onto itself changes nothing", cmd(r, "reorder", { pool: "bank", key: "coal", before: "coal" }).ok && r.bank.order.join(",") === "tallow,resin,pulp,coal");
    refused("a key not in the pool", r, "reorder", { pool: "bank", key: "slag_delve", before: null }, "That isn't there.");
    refused("before a key not in the pool", r, "reorder", { pool: "bank", key: "coal", before: "nope" }, "That isn't there.");
    refused("a junk pool", r, "reorder", { pool: "shelf", key: "coal", before: null }, "No such store.");
  }

  section("Packing the Satchel");
  {
    const s = fresh();
    put(s, "inv", "provision_t3", 6);
    put(s, "bank", "provision_t9", 40);
    put(s, "inv", "coal", 3);
    w.events.length = 0;
    check("moveItem packs remedies into the Satchel, where they stack to one slot",
      cmd(s, "moveItem", { key: "provision_t3", from: "inv", to: "satchel", qty: null }).ok &&
      s.satchel.items.provision_t3 === 6 && S.slotsUsed(s, "satchel") === 1 && !s.inv.items.provision_t3 &&
      S.slotsUsed(s, "inv") === 1 && w.of("item:moved")[0].to === "satchel");
    check("and from camp storage as well", cmd(s, "moveItem", { key: "provision_t9", from: "bank", to: "satchel", qty: 40 }).ok && s.satchel.items.provision_t9 === 40);
    check("what is packed is still the camp's", S.haveQty(s, "provision_t3") === 6 && S.heldEverywhere(s).provision_t9 === 40);
    refused("a material into the Satchel", s, "moveItem", { key: "coal", from: "inv", to: "satchel", qty: 1 }, "Satchel only takes remedies.");
    const geared = fresh();
    put(geared, "inv", "slag_sword|rare|c1.2", 1);
    put(geared, "bank", "slag_pick", 1);
    refused("a weapon into the Satchel", geared, "moveItem", { key: "slag_sword|rare|c1.2", from: "inv", to: "satchel", qty: 1 }, "Satchel only takes remedies.");
    refused("a tool into the Satchel", geared, "moveItem", { key: "slag_pick", from: "bank", to: "satchel", qty: 1 }, "Satchel only takes remedies.");

    check("unpacking part of the Satchel back into Belongings costs a slot a bottle",
      cmd(s, "moveItem", { key: "provision_t3", from: "satchel", to: "inv", qty: 3 }).ok &&
      s.satchel.items.provision_t3 === 3 && s.inv.items.provision_t3 === 3 && S.slotsUsed(s, "inv") === 4);
    refused("more than Belongings has room for", s, "moveItem", { key: "provision_t9", from: "satchel", to: "inv", qty: 40 }, "Belongings is full.");
    check("the refusal left the Satchel as it was", s.satchel.items.provision_t9 === 40 && s.inv.items.provision_t9 === undefined);
    check("unpacking into the Stockpile takes the lot in one slot",
      cmd(s, "moveItem", { key: "provision_t9", from: "satchel", to: "bank", qty: null }).ok &&
      s.bank.items.provision_t9 === 40 && S.slotsUsed(s, "bank") === 1 && !s.satchel.items.provision_t9 && !s.satchel.order.includes("provision_t9"));

    const packed = fresh();
    put(packed, "satchel", "provision_t4", 10);
    check("sellItem works out of the Satchel", cmd(packed, "sellItem", { key: "provision_t4", from: "satchel", qty: 4 }).ok && packed.satchel.items.provision_t4 === 6 && packed.player.gold === 72);
    check("reorder works on the Satchel", cmd(packed, "reorder", { pool: "satchel", key: "provision_t4", before: null }).ok);
  }

  section("The camp");
  {
    const s = fresh();
    s.player.gold = 1000;
    w.events.length = 0;
    check("buyRemedy lands in Belongings, a slot a bottle, and never in the Satchel",
      cmd(s, "buyRemedy", { key: "provision_t3", qty: 4 }).ok && s.inv.items.provision_t3 === 4 && S.slotsUsed(s, "inv") === 4 &&
      S.slotsUsed(s, "satchel") === 0 && s.player.gold === 940 && s.log.some((l) => l.m === "Bought 4 × Gravemoss Poultice."));
    check("even the dearest remedies are sold, as in v4", W.shopStock(s).length === 6 && cmd(s, "buyRemedy", { key: "provision_t7", qty: 1 }).ok);
    refused("something not sold", s, "buyRemedy", { key: "coal", qty: 1 }, "The Bonesetter doesn't sell that.");
    for (const qty of [0, 1001, 2.5, "1", null]) refused(`qty ${JSON.stringify(qty)}`, s, "buyRemedy", { key: "provision_t1", qty }, "Buy 1 to 1,000 at a time.");
    refused("without the gold", s, "buyRemedy", { key: "provision_t9", qty: 1 }, "Not enough gold.");
    // Six slots left in Belongings, so a lot of seven is refused whole: gold and shelf both untouched.
    refused("more bottles than Belongings can hold", s, "buyRemedy", { key: "provision_t1", qty: 7 }, "Nowhere to put it.");
    check("and what does fit still goes through", cmd(s, "buyRemedy", { key: "provision_t1", qty: 5 }).ok && S.slotsUsed(s, "inv") === 10);
    const full = fresh();
    full.player.gold = 1000;
    fillAll(full);
    refused("with nowhere to put it", full, "buyRemedy", { key: "provision_t1", qty: 1 }, "Nowhere to put it.");
    check("a full Satchel is no help: the Bonesetter never packs it", S.isFull(full, "satchel") && S.qtyIn(full, "inv", "provision_t1") === 0);

    const lot = W.smugglerStock(s)[1];
    s.player.gold = lot.price + 5;
    check("buySmuggler", cmd(s, "buySmuggler", { slot: 1 }).ok && S.haveQty(s, lot.key) === lot.qty && s.player.gold === 5 && W.smugglerStock(s)[1].bought && s.smugglerBought[`${Math.floor(T0 / CONFIG.time.windowMs)}_1`] === true);
    refused("a lot already dealt", s, "buySmuggler", { slot: 1 }, "That lot is already dealt.");
    refused("without the gold", s, "buySmuggler", { slot: 0 }, "The smuggler doesn't haggle.");
    for (const slot of [3, -1, "0", 0.5, null]) refused(`slot ${JSON.stringify(slot)}`, s, "buySmuggler", { slot }, "No such offer.");
    s.smugglerBought = { "1_0": true, "2_2": true, [`${Math.floor(T0 / CONFIG.time.windowMs)}_1`]: true };
    s.player.gold = 1e9;
    check("buying prunes other windows' tags", cmd(s, "buySmuggler", { slot: 2 }).ok && Object.keys(s.smugglerBought).length === 2);
  }
  {
    const s = fresh();
    refused("without the toll", s, "travel", { regionId: "region_2" }, "Need 50g.");
    s.player.gold = 60;
    w.events.length = 0;
    check("travel opens the road and moves", cmd(s, "travel", { regionId: "region_2" }).ok && s.region === "region_2" && s.travel.unlocked.includes("region_2") && s.player.gold === 10 &&
      w.events.map((e) => e[0]).join(",") === "travel:unlocked,travel:moved" && s.bounty.region === "region_2" && s.log.some((l) => l.m === "Road to Gallowmoor open."));
    check("travel back is free", cmd(s, "travel", { regionId: "region_1" }).ok && s.player.gold === 10 && s.region === "region_1");
    for (const regionId of ["region_10", "", null, 2]) refused(`region ${JSON.stringify(regionId)}`, s, "travel", { regionId }, "No such region.");
  }
  {
    const s = fresh();
    s.bounty.progress = s.bounty.amount - 1;
    refused("an unfinished bounty", s, "claimBounty", {}, "The bounty isn't finished.");
    s.bounty.progress = s.bounty.amount;
    const gold = s.bounty.gold;
    /* A gather posting is paid on DELIVERY: the board takes the goods with the
       payment, so gathering them and then selling them is not a bounty filled. */
    if (s.bounty.kind === "gather") {
      check("claimBounty refuses a gather posting with nothing in hand",
        !cmd(s, "claimBounty", {}).ok && !s.bounty.claimed && s.player.gold === 0);
      put(s, "bank", s.bounty.targetId, s.bounty.amount + 3);
    }
    const handed = s.bounty.kind === "gather" ? { key: s.bounty.targetId, amount: s.bounty.amount } : null;
    check("claimBounty pays, and doubles XP for an hour", cmd(s, "claimBounty", {}).ok && s.player.gold === gold && s.stats.goldEarned === gold && s.buff.until === T0 + 3600000 && s.buff.mult === 2 && s.bounty.claimed);
    if (handed) check("and the goods handed over are gone", S.qtyIn(s, "bank", handed.key) === 3);
    refused("a paid bounty", s, "claimBounty", {}, "That bounty is already paid.");
    s.bounty = null;
    refused("no bounty", s, "claimBounty", {}, "There's no bounty posted.");
  }
  {
    // A posting left behind waits on the board: no second claim by walking away and back.
    const s = fresh();
    s.player.gold = 100;
    s.bounty.progress = s.bounty.amount;
    if (s.bounty.kind === "gather") put(s, "bank", s.bounty.targetId, s.bounty.amount);
    const first = clone(s.bounty);
    check("claim in the Ashen Verge", cmd(s, "claimBounty", {}).ok && s.bounty.claimed);
    cmd(s, "travel", { regionId: "region_2" });
    check("Gallowmoor posts its own bounty, the Verge's waits on the board", s.bounty.region === "region_2" && !s.bounty.claimed && s.bountyBoard.region_1 && s.bountyBoard.region_1.claimed);
    s.bounty.progress = 3;
    cmd(s, "travel", { regionId: "region_1" });
    same("back in the Verge: the same paid posting, not a fresh one", [s.bounty.window, s.bounty.region, s.bounty.label, s.bounty.claimed, s.bounty.gold], [first.window, "region_1", first.label, true, first.gold]);
    refused("the Verge's bounty again", s, "claimBounty", {}, "That bounty is already paid.");
    cmd(s, "travel", { regionId: "region_2" });
    check("Gallowmoor's progress is kept too", s.bounty.region === "region_2" && s.bounty.progress === 3);
    const { migrateSave } = await shared("state.js");
    const again = migrateSave(JSON.parse(JSON.stringify(s)), { now: s.clock, seed: 1 });
    same("the board survives a save round trip", [again.bountyBoard, again.bounty], [s.bountyBoard, s.bounty]);
    E.advance(s, T0 + CONFIG.time.windowMs + 1, w.env);
    check("a new window clears the board and posts afresh", s.bounty.window === Math.floor((T0 + CONFIG.time.windowMs + 1) / CONFIG.time.windowMs) && s.bounty.progress === 0 && Object.keys(s.bountyBoard).length === 0);
  }
  {
    // The Smuggler's lot as the player saw it: a turned window refuses rather than selling something else.
    const s = fresh();
    s.player.gold = 1e9;
    const lot = W.smugglerStock(s)[1];
    refused("a lot that has changed", s, "buySmuggler", { slot: 1, key: lot.key === "coal" ? "resin" : "coal" }, "The Smuggler has moved on.");
    check("the lot the player saw", cmd(s, "buySmuggler", { slot: 1, key: lot.key }).ok && S.haveQty(s, lot.key) >= lot.qty);
  }
  {
    const s = fresh();
    s.player.gold = 5000;
    refused("before tier 2 ground (hire)", s, "hireAgent", {}, "Requisitions open once you reach tier 2 ground.");
    refused("before tier 2 ground (deploy)", s, "deployAgent", { agentId: "agent_1", itemKey: "coal" }, "Requisitions open once you reach tier 2 ground.");
    check("requisitionsOpen once a tier 2 region is yours", !W.requisitionsOpen(s) && (s.travel.unlocked.push("region_2"), W.requisitionsOpen(s)));
    const world = s.rng.world;
    check("hireAgent draws from the world stream", cmd(s, "hireAgent", {}).ok && s.agents.length === 1 && s.agents[0].id === "agent_1" && s.serial === 2 && s.rng.world !== world && s.player.gold === 4750);
    const twin = fresh();
    twin.player.gold = 5000;
    twin.travel.unlocked.push("region_2");
    cmd(twin, "hireAgent", {});
    same("the same save hires the same agent", twin.agents, s.agents);
    check("deployAgent", cmd(s, "deployAgent", { agentId: "agent_1", itemKey: "coal" }).ok && s.requisitions.length === 1 && s.requisitions[0].day === Math.floor(T0 / 86400000) && W.requisitionsLeft(s) === 2);
    refused("an agent already out", s, "deployAgent", { agentId: "agent_1", itemKey: "coal" }, `${s.agents[0].name} is already out.`);
    refused("an unknown agent", s, "deployAgent", { agentId: "agent_9", itemKey: "coal" }, "No such agent.");
    refused("something agents can't find", s, "deployAgent", { agentId: "agent_1", itemKey: "slag_sword|common" }, "Agents can't bring that in.");
    cmd(s, "hireAgent", {});
    cmd(s, "hireAgent", {});
    cmd(s, "hireAgent", {});
    cmd(s, "deployAgent", { agentId: s.agents[1].id, itemKey: "resin" });
    cmd(s, "deployAgent", { agentId: s.agents[2].id, itemKey: "pulp" });
    refused("a fourth deployment in a day", s, "deployAgent", { agentId: s.agents[3].id, itemKey: "coal" }, "Only 3 deployments a day.");
    E.advance(s, (Math.floor(T0 / 86400000) + 1) * 86400000 + 5, w.env);
    check("requisitions come back at the daily reset", s.requisitions.length === 0 && S.haveQty(s, "coal") > 0 && s.log.some((l) => /^Requisitions returned: /.test(l.m)));
    while (s.agents.length < 12) s.agents.push({ id: `agent_${100 + s.agents.length}`, name: "Silt", rarity: "common" });
    refused("a full roster", s, "hireAgent", {}, "The roster is full.");
    s.player.gold = 10;
    s.agents.pop();
    refused("without the gold", s, "hireAgent", {}, "Hiring costs 250g.");
  }
  {
    const s = fresh();
    refused("without the gold", s, "buyCompanion", { id: "rat" }, "Not enough gold.");
    s.player.gold = 500;
    check("buyCompanion brings the first one along", cmd(s, "buyCompanion", { id: "rat" }).ok && s.companions.active === "rat" && s.player.gold === 350 && s.log.some((l) => l.m === "Tunnel Rat joins the camp."));
    check("a second doesn't replace the one at your side", cmd(s, "buyCompanion", { id: "crow" }).ok && s.companions.active === "rat");
    refused("one already owned", s, "buyCompanion", { id: "rat" }, "Tunnel Rat is already yours.");
    for (const id of ["dragon", null, 3, "__proto__"]) refused(`id ${JSON.stringify(id)}`, s, "buyCompanion", { id }, "No such companion.");
    check("setCompanion", cmd(s, "setCompanion", { id: "crow" }).ok && s.companions.active === "crow" && s.log.some((l) => l.m === "Carrion Crow walks with you now."));
    check("setCompanion null leaves everyone at camp", cmd(s, "setCompanion", { id: null }).ok && s.companions.active === null);
    for (const id of ["stag", undefined, 1, "toString"]) refused(`id ${JSON.stringify(id)}`, s, "setCompanion", { id }, "That companion isn't yours.");
  }

  section("Junk of every type");
  {
    const JUNK = [undefined, null, 0, -1, 1.5, NaN, Infinity, "", "x".repeat(500), {}, [], true, "__proto__", "constructor", "inv", "coal", { toString: 1 }];
    const FIELDS = {
      startSkill: ["skillId", "actionId", "limit"], startHunt: ["tier", "zone", "limit"], setHide: ["on"], pickClass: ["id"], setSex: ["sex"],
      equip: ["key", "from"], unequip: ["slot"], unequipTool: ["skillId"], moveItem: ["key", "from", "to", "qty"],
      sellItem: ["key", "from", "qty"], salvage: ["key", "from"], useChest: ["key", "from"], repair: ["key"],
      reorder: ["pool", "key", "before"], buyRemedy: ["key", "qty"], buySmuggler: ["slot"], travel: ["regionId"],
      deployAgent: ["agentId", "itemKey"], buyCompanion: ["id"], setCompanion: ["id"],
      stopSkill: [], pullBack: [], claimBounty: [], hireAgent: [],
    };
    const GOOD = {
      startSkill: { skillId: "delving", actionId: "delving_t1_raw", limit: 5 }, startHunt: { tier: 1, zone: "outer", limit: 5 },
      setHide: { on: true }, pickClass: { id: "rogue" }, setSex: { sex: "female" }, equip: { key: "slag_sword|rare|c1.1", from: "inv" }, unequip: { slot: "head" },
      unequipTool: { skillId: "felling" }, moveItem: { key: "coal", from: "bank", to: "vault", qty: 1 }, sellItem: { key: "coal", from: "bank", qty: 1 },
      salvage: { key: "slag_helm|common", from: "inv" }, useChest: { key: "vault_chest", from: "vault" }, repair: { key: "slag_helm|epic|s1.0" },
      reorder: { pool: "bank", key: "coal", before: null }, buyRemedy: { key: "provision_t1", qty: 1 }, buySmuggler: { slot: 0 },
      travel: { regionId: "region_2" }, deployAgent: { agentId: "agent_1", itemKey: "coal" }, buyCompanion: { id: "crow" }, setCompanion: { id: "rat" },
    };
    const base = fresh(99);
    base.player.gold = 1e6;
    base.skills.warfare = CONFIG.xpTable[5];
    base.travel.unlocked.push("region_2");
    put(base, "inv", "slag_sword|rare|c1.1", 1);
    put(base, "inv", "slag_helm|common", 1);
    put(base, "bank", "coal", 50);
    put(base, "vault", "vault_chest", 1);
    base.equipment.head = "slag_helm|epic|s1.0";
    put(base, "bank", "slag_delve", 5);
    base.tools.felling = "bitter_axe";
    base.agents.push({ id: "agent_1", name: "Silt", rarity: "rare" });
    base.companions.owned.rat = { bond: 0, rank: 1, dupes: 0 };
    base.bounty.progress = base.bounty.amount;
    // Paid on delivery: the goods a gather posting wants have to be in hand to claim it.
    if (base.bounty.kind === "gather") put(base, "bank", base.bounty.targetId, base.bounty.amount);

    let cases = 0;
    let bad = null;
    for (const type of Object.keys(FIELDS)) {
      const good = GOOD[type] || {};
      check(`${type}: the good arguments go through`, E.applyCommand(clone(base), { type, args: clone(good) }, w.env).ok);
      for (const field of FIELDS[type]) {
        for (const junk of JUNK) {
          const s = clone(base);
          const before = clone(s);
          let res;
          try {
            res = E.applyCommand(s, { type, args: { ...clone(good), [field]: junk } }, w.env);
          } catch (e) {
            bad = `${type}.${field} = ${String(junk).slice(0, 20)} threw ${e.message}`;
            break;
          }
          cases++;
          const shapeOk = res && typeof res.ok === "boolean" && (res.ok || (typeof res.error === "string" && res.error.length > 0));
          if (!shapeOk || (!res.ok && JSON.stringify(s) !== JSON.stringify(before)) || s.clock !== before.clock) {
            bad = `${type}.${field} = ${JSON.stringify(junk)}: ${JSON.stringify(res)}`;
            break;
          }
        }
        if (bad) break;
      }
      if (bad) break;
    }
    check(`${cases} junk arguments: never a throw, a refusal always a sentence, and a refusal changes nothing`, !bad && cases > 300, bad);
    check("commands never move the clock", (() => { const s = clone(base); Object.keys(GOOD).forEach((t) => E.applyCommand(s, { type: t, args: clone(GOOD[t]) }, w.env)); return s.clock === base.clock; })());
  }

  section("The market's halves");
  {
    /* Rounded up, never under 1 gold of a sale worth anything: the house must not round in a
       player's favour, or a wash trade between two camps costs less than it moves. */
    check("marketFee: 5%, rounded up, at least 1 of any sale",
      M.marketFee(0) === 0 && M.marketFee(-5) === 0 && M.marketFee(1) === 1 && M.marketFee(19) === 1
      && M.marketFee(21) === 2 && M.marketFee(40) === 2 && M.marketFee(41) === 3 && M.marketFee(1000) === 50);
    check("marketFee never rounds a fee away", [1, 2, 7, 19, 21, 39, 41, 999, 1001, 123456].every((n) => M.marketFee(n) >= n * 0.05 && M.marketFee(n) >= 1));

    // Both legs of a trade: a round trip at the same price always loses gold.
    {
      const each = 12;
      const qty = 40;
      const goods = each * qty;
      const fee = M.marketFee(goods);
      check("a wash trade loses both fees", (goods + fee) - (goods - fee) === 2 * fee && fee === 24);
    }

    /* One purchase's fee shared over the listings it filled: the parts add up to the whole,
       every part is a whole number, and the odd gold goes to the largest remainder. */
    same("splitFee adds up", M.splitFee(10, [100, 100]), [5, 5]);
    same("splitFee hands the odd gold to the largest remainder", M.splitFee(3, [10, 10, 10]), [1, 1, 1]);
    same("splitFee with an awkward split", M.splitFee(7, [50, 30, 20]), [4, 2, 1]);
    same("splitFee ties go to the earlier (cheaper) leg", M.splitFee(1, [10, 10]), [1, 0]);
    same("splitFee of nothing", [M.splitFee(0, [1, 2]), M.splitFee(5, []), M.splitFee(5, [0, 0])], [[0, 0], [], [0, 0]]);
    check("splitFee never mints or loses gold", [1, 2, 3, 7, 13, 50, 97].every((fee) => {
      const parts = M.splitFee(fee, [7, 13, 1, 40, 5]);
      return parts.reduce((a, b) => a + b, 0) === fee && parts.every((n) => Number.isInteger(n) && n >= 0);
    }));

    /* The pool's fill: cheapest first, oldest first among equal prices, and never a unit
       above the ceiling the buyer was shown. */
    {
      const pool = [
        { id: 3, priceEach: 13, qtyLeft: 15, at: 10 },
        { id: 1, priceEach: 12, qtyLeft: 25, at: 30 },   // dearer age, cheaper price: still first
        { id: 2, priceEach: 12, qtyLeft: 15, at: 20 },   // same price, older: before id 1
      ];
      const walk = (args) => M.fillPool(pool, args);
      same("fillPool takes the cheapest band, oldest listing first", walk({ qty: 20, maxEach: 13 }).data.fills,
        [{ id: 2, qty: 15, priceEach: 12, buyerFee: 9 }, { id: 1, qty: 5, priceEach: 12, buyerFee: 3 }]);
      const across = walk({ qty: 50, maxEach: 13 }).data;
      same("and walks on into the next band", [across.fills.map((f) => [f.id, f.qty]), across.units, across.goods, across.fee, across.total, across.dearest],
        [[[2, 15], [1, 25], [3, 10]], 50, 610, 31, 641, 13]);
      const capped = walk({ qty: 50, maxEach: 12 }).data;
      same("a ceiling leaves the dearer band alone, and fills short", [capped.units, capped.short, capped.goods, capped.dearest], [40, true, 480, 12]);
      same("nothing at the price is a refusal", walk({ qty: 5, maxEach: 11 }), { ok: false, error: "Nobody is selling that at your price." });
      same("an empty pool is the same refusal", M.fillPool([], { qty: 1, maxEach: 99 }), { ok: false, error: "Nobody is selling that at your price." });
      same("junk quantities and ceilings", [walk({ qty: 0, maxEach: 12 }).error, walk({ qty: 1.5, maxEach: 12 }).error, walk({ qty: 1, maxEach: 0 }).error, walk({ qty: 1 }).error],
        ["Choose how many to buy.", "Choose how many to buy.", "Name the most you will pay each.", "Name the most you will pay each."]);
      same("a purse that cannot cover the fee refuses", walk({ qty: 20, maxEach: 13, gold: 251 }), { ok: false, error: "Not enough gold." });
      check("and one gold more is enough", walk({ qty: 20, maxEach: 13, gold: 252 }).ok === true);
      const legs = walk({ qty: 50, maxEach: 13 }).data;
      same("the buyer's fee is shared over the legs, to the gold", legs.fills.reduce((n, f) => n + f.buyerFee, 0), legs.fee);
      check("a pool with junk rows in it is simply not walked", M.fillPool([{ id: 1, priceEach: 0, qtyLeft: 5 }, { id: 2, priceEach: 5, qtyLeft: 0 }, null], { qty: 1, maxEach: 99 }).ok === false);
    }
    check("remintKey: unique pieces take the listing's uid, stacks don't change",
      M.remintKey("slag_sword|rare|c1.2", 55) === "slag_sword|rare|m55" && M.remintKey("slag_sword|relic|9|echoing", 7) === "slag_sword|relic|m7|echoing" &&
      M.remintKey("coal", 3) === "coal" && M.remintKey("slag_sword|common", 3) === "slag_sword|common" && I.validKey(M.remintKey("slag_sword|relic|9|echoing", 123456)));

    const s = fresh();
    put(s, "inv", "slag_sword|legendary|c3.4", 1);
    put(s, "bank", "coal", 20);
    w.events.length = 0;
    const listed = M.prepareListing(s, { key: "coal", from: "bank", qty: 15, price: 3 }, w.env);
    same("prepareListing takes the items out and describes them", [listed, s.bank.items.coal, w.of("market:listed").length],
      [{ ok: true, data: { key: "coal", base: "coal", name: "Coal", kind: "material", tier: 1, rarity: null, qty: 15, priceEach: 3 } }, 5, 1]);
    same("a unique piece", M.prepareListing(s, { key: "slag_sword|legendary|c3.4", from: "inv", qty: 1, price: 900 }, w.env).data,
      { key: "slag_sword|legendary|c3.4", base: "slag_sword", name: "Legendary Slag Sword", kind: "gear", tier: 1, rarity: "legendary", qty: 1, priceEach: 900 });
    const before = clone(s);
    const refusals = [
      [{ key: "coal", from: "bank", qty: 6, price: 3 }, "You can list 1 to 5."],
      [{ key: "coal", from: "bank", qty: 0, price: 3 }, "You can list 1 to 5."],
      [{ key: "coal", from: "bank", qty: 1, price: 0 }, "Set a price of at least 1 gold each."],
      [{ key: "coal", from: "bank", qty: 1, price: 1e9 + 1 }, "Set a price of at least 1 gold each."],
      [{ key: "coal", from: "bank", qty: 1, price: 2.5 }, "Set a price of at least 1 gold each."],
      [{ key: "coal", from: "vault", qty: 1, price: 3 }, "You don't have that there."],
      [{ key: "coal|rare|1", from: "bank", qty: 1, price: 3 }, "No such item."],
      [{ key: "coal", from: "pocket", qty: 1, price: 3 }, "No such store."],
    ];
    same("prepareListing refusals change nothing", [refusals.map(([args]) => M.prepareListing(s, args, w.env).error), s], [refusals.map(([, e]) => e), before]);

    {
      // Any sound piece lists: there is no condition left to hold one back.
      const piece = fresh();
      put(piece, "inv", "slag_sword|epic|s1.4", 1);
      check("a unique piece lists", M.prepareListing(piece, { key: "slag_sword|epic|s1.4", from: "inv", qty: 1, price: 500 }, w.env).ok && !S.haveQty(piece, "slag_sword|epic|s1.4"));
    }

    s.player.gold = 100;
    // The purse pays the goods and the fee: 60 plus 3 leaves 37, and the event says 63.
    w.events.length = 0;
    check("applyPurchase pays the goods and the fee, and takes the goods in",
      M.applyPurchase(s, { key: "slag_sword|rare|m12", qty: 1, goods: 60, fee: 3 }, w.env).ok
      && s.player.gold === 37 && s.inv.items["slag_sword|rare|m12"] === 1 && s.stats.goldEarned === 0);
    same("and the event names what left the purse", w.of("market:bought").map((e) => [e.cost, e.fee]), [[63, 3]]);
    const b2 = clone(s);
    same("applyPurchase without the gold changes nothing", [M.applyPurchase(s, { key: "coal", qty: 1, goods: 37, fee: 1 }, w.env).error, s], ["Not enough gold.", b2]);
    const full = fresh();
    full.player.gold = 100;
    fillAll(full);
    const b3 = clone(full);
    same("applyPurchase with nowhere to put it changes nothing", [M.applyPurchase(full, { key: "provision_t9", qty: 2, goods: 10, fee: 1 }, w.env).error, full], ["Nowhere to put it.", b3]);
    same("applyReturn with no room", [M.applyReturn(full, { key: "provision_t9", qty: 2 }, w.env).error, full], ["No room to take it back.", b3]);
    check("applyReturn brings a listing home", M.applyReturn(s, { key: "coal", qty: 15 }, w.env).ok && s.bank.items.coal === 20);

    const post = fresh();
    put(post, "vault", "coal", 1);
    fillAll(post, S.POOLS, ["coal"]);
    w.events.length = 0;
    const letters = [
      { id: 1, kind: "gold", gold: 500, item_key: null, qty: 0, note: "" },
      { id: 2, kind: "item", gold: 0, item_key: "coal", qty: 4, note: "" },
      { id: 3, kind: "item", gold: 0, item_key: "provision_t9", qty: 1, note: "" },
      { id: 4, kind: "gold", gold: 25, item_key: null, qty: 0, note: "" },
      { id: 5, kind: "item", gold: 0, item_key: "coal", qty: 1, note: "" },
      { id: 6, kind: "item", gold: 0, item_key: "nope", qty: 1, note: "" },
      { id: 7, kind: "gold", gold: -5 },
      null,
    ];
    const claim = M.applyMail(post, letters, w.env);
    same("applyMail: gold always, items until one has nowhere to go, a letter the camp can't read taken in empty", [claim, post.player.gold, post.stats.goldEarned, post.vault.items.coal],
      [{ claimed: [1, 2, 4, 6], gold: 525, items: [{ key: "coal", qty: 4 }] }, 525, 525, 5]);
    check("mail:claimed once, with v4-style log line", w.of("mail:claimed").length === 1 && post.log.some((l) => l.m === "The post brought 4 Coal, 525g."));
    same("applyMail with nothing to claim", [M.applyMail(fresh(), [], w.env), M.applyMail(fresh(), "junk", w.env)], [{ claimed: [], gold: 0, items: [] }, { claimed: [], gold: 0, items: [] }]);

    // A letter for an item since retired used to sit at the front of the post for good.
    const poisoned = fresh();
    w.events.length = 0;
    const poison = (id, item_key, qty = 1) => ({ id, kind: "item", gold: 0, item_key, qty, note: "" });
    const heap = [poison(1, "old_relic_axe|relic|9|grim"), poison(2, "coal", 0), poison(3, "slag_sword|rare|c1.1", 2), poison(4, "nope"),
      { id: 5, kind: "gold", gold: 40 }, poison(6, "coal", 12), poison(7, 42)];
    same("Letters holding nothing the camp can take are claimed empty, and the rest of the post comes in behind them",
      [M.applyMail(poisoned, heap, w.env), S.haveQty(poisoned, "coal"), poisoned.player.gold],
      [{ claimed: [1, 2, 3, 4, 5, 6, 7], gold: 40, items: [{ key: "coal", qty: 12 }] }, 12, 40]);
    same("with one log line for all of them", poisoned.log.filter((l) => /letter held/.test(l.m)).map((l) => l.m), ["A letter held something the camp no longer knows."]);
    check("mail:unknown counts them", w.of("mail:unknown").length === 1 && w.of("mail:unknown")[0].count === 5);
    const batch = Array.from({ length: 100 }, (_, i) => poison(i + 1, "retired_thing"));
    check("a whole batch of them no longer blocks the post", M.applyMail(fresh(), [...batch, poison(101, "coal", 3)], w.env).claimed.length === 101);
    const stuck = fresh();
    fillAll(stuck);
    const stuckBefore = clone(stuck);
    const queue = [poison(1, "provision_t9", 2), poison(2, "gone_forever"), { id: 3, kind: "gold", gold: 7 }, poison(4, "provision_t9", 1)];
    const stuckClaim = M.applyMail(stuck, queue, w.env);
    same("Only a real lack of room holds back later item letters: behind it, gold and empty letters still come in",
      [stuckClaim, stuck.player.gold, S.haveQty(stuck, "provision_t9")], [{ claimed: [2, 3], gold: 7, items: [] }, 7, 0]);
    check("and nothing else changed", JSON.stringify({ ...stuck, player: null, stats: null, log: null }) === JSON.stringify({ ...stuckBefore, player: null, stats: null, log: null }));
  }
});
