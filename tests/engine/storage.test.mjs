/* The Quartermaster: placement orders, full pools, stacking, and that every
   transaction method rolls back cleanly, alone and nested.

     node tests/engine/storage.test.mjs */

import { run, check, section, same, shared, clone, put } from "./harness.mjs";

await run(async () => {
  const S = await shared("storage.js");
  const { createState } = await shared("state.js");
  const { CONFIG } = await shared("config.js");
  const { GameData } = await shared("registry.js");

  const fresh = () => createState({ now: Date.UTC(2026, 8, 16), seed: 3 });
  const mats = Object.keys(GameData.MATERIALS).filter((k) => !GameData.MATERIALS[k].heal);
  // Fills a pool to its cap with distinct materials that are not in `except`.
  const fill = (s, w, except = []) => {
    let i = 0;
    while (!S.isFull(s, w)) {
      const k = mats[i++];
      if (!except.includes(k) && !Object.hasOwn(s[w].items, k)) put(s, w, k, 1);
    }
  };

  section("Pools and orders");
  check("POOLS and names", S.POOLS.join(",") === "inv,bank,vault" && S.poolName("bank") === "Stockpile" && S.poolName("inv") === "Belongings");
  same("ORDER", S.ORDER, {
    loot: ["inv", "vault", "bank"], material: ["bank", "vault", "inv"], gear: ["inv", "bank", "vault"], tool: ["bank", "vault", "inv"],
    remedy: ["inv", "bank", "vault"], spend: ["bank", "vault", "inv"], eat: ["inv", "bank", "vault"], mail: ["inv", "bank", "vault"],
  });
  check("ORDER is frozen", Object.isFrozen(S.ORDER) && Object.isFrozen(S.ORDER.loot));
  check("orderFor: remedies, gear, tools and materials",
    S.orderFor("provision_t4") === S.ORDER.remedy && S.orderFor("slag_sword|rare|c1.2") === S.ORDER.gear &&
    S.orderFor("slag_pick") === S.ORDER.tool && S.orderFor("coal") === S.ORDER.material && S.orderFor("vault_chest") === S.ORDER.material &&
    S.orderFor("nope") === S.ORDER.material);

  {
    const s = fresh();
    check("slotCap: Belongings fixed, Stockpile and Vault from the save", S.slotCap(s, "inv") === 10 && S.slotCap(s, "bank") === 30 && S.slotCap(s, "vault") === 50);
    s.bank.slots = 45;
    check("slotCap follows a widened Stockpile", S.slotCap(s, "bank") === 45);
    check("placeFor: first pool in order with room", S.placeFor(s, "coal") === "bank" && S.placeFor(s, "provision_t1") === "inv" && S.placeFor(s, "slag_sword|common", S.ORDER.loot) === "inv");
    put(s, "vault", "coal", 3);
    check("placeFor: a stack already held grows where it is", S.placeFor(s, "coal") === "vault" && S.placeFor(s, "coal", S.ORDER.loot) === "vault");
    fill(s, "inv");
    check("placeFor skips a full pool", S.placeFor(s, "provision_t1") === "bank" && S.placeFor(s, "mud_dredge", S.ORDER.loot) === "vault");
    fill(s, "bank", ["coal"]);
    fill(s, "vault", ["coal"]);
    check("placeFor is null when everything is full and nothing stacks", S.placeFor(s, "provision_t9") === null && S.placeFor(s, "slag_sword|rare|c1.1") === null);
    check("placeFor still finds a held stack when everything is full", S.placeFor(s, "coal") === "vault");
    check("isFull and slotsUsed", S.isFull(s, "inv") && S.slotsUsed(s, "inv") === 10 && S.slotsUsed(s, "bank") === 45);
  }

  section("Reading");
  {
    const s = fresh();
    put(s, "inv", "coal", 2);
    put(s, "bank", "coal", 5);
    put(s, "vault", "coal", 1);
    put(s, "bank", "slag_delve", 9);
    check("qtyIn and haveQty", S.qtyIn(s, "bank", "coal") === 5 && S.haveQty(s, "coal") === 8 && S.haveQty(s, "resin") === 0);
    check("qtyIn ignores prototype keys", ["constructor", "toString", "__proto__", "hasOwnProperty"].every((k) => S.qtyIn(s, "bank", k) === 0 && S.haveQty(s, k) === 0));
    same("heldEverywhere", S.heldEverywhere(s), { coal: 8, slag_delve: 9 });
    s.bank.order = ["slag_delve", "ghost"];
    same("orderedKeys: the player's order, strays dropped, missing keys at the end", S.orderedKeys(s, "bank"), ["slag_delve", "coal"]);
    check("canPay", S.canPay(s, { coal: 8, slag_delve: 9 }) && !S.canPay(s, { coal: 9 }) && S.canPay(s, null) && S.canPay(s, undefined));
    check("stockCovers", S.stockCovers(s, { coal: 2, slag_delve: 2 }) === 4 && S.stockCovers(s, null) === Infinity && S.stockCovers(s, { resin: 1 }) === 0);
  }

  section("Transactions that go through");
  {
    const s = fresh();
    const res = S.transact(s, (tx) => {
      tx.add("bank", "coal", 5);
      tx.add("bank", "coal", 2);
      tx.stash("provision_t3", 4);
      tx.stash("slag_sword|rare|c9.1", 1);
      tx.gold(500, true);
      tx.gold(-120);
      return "done";
    });
    check("transact returns { ok: true, value }", res.ok === true && res.value === "done");
    check("add stacks in one slot and orders once", s.bank.items.coal === 7 && s.bank.order.filter((k) => k === "coal").length === 1);
    check("stash follows orderFor", s.inv.items.provision_t3 === 4 && s.inv.items["slag_sword|rare|c9.1"] === 1);
    check("gold: earned counts toward goldEarned, spending does not", s.player.gold === 380 && s.stats.goldEarned === 500);

    const r2 = S.transact(s, (tx) => {
      put(s, "vault", "coal", 3);
      return tx.spend("coal", 9);
    });
    check("spend takes from the Stockpile, then the Vault, then Belongings", r2.ok && s.bank.items.coal === undefined && s.vault.items.coal === 1 && !s.bank.order.includes("coal"));
    const r3 = S.transact(s, (tx) => tx.stash("coal", 2, ["inv", "bank"]));
    check("stash with an explicit order", r3.ok && r3.value === "inv" && s.inv.items.coal === 2);
    const r4 = S.transact(s, (tx) => tx.spend("coal", 2, ["inv"]));
    check("spend with an explicit order", r4.ok && s.inv.items.coal === undefined && s.vault.items.coal === 1);
    const r5 = S.transact(s, (tx) => tx.pay({ provision_t3: 1, "slag_sword|rare|c9.1": 1 }));
    check("pay spends every key of a cost and removes emptied stacks", r5.ok && s.inv.items.provision_t3 === 3 && !Object.hasOwn(s.inv.items, "slag_sword|rare|c9.1") && !s.inv.order.includes("slag_sword|rare|c9.1"));
  }

  section("Every tx method rolls back");
  {
    const base = fresh();
    put(base, "bank", "coal", 5);
    put(base, "vault", "coal", 2);
    put(base, "inv", "provision_t1", 3);
    base.player.gold = 100;
    base.agents.push({ id: "agent_1", name: "Silt", rarity: "rare" });

    const attempts = [
      ["add", (tx, s) => tx.add("bank", "resin", 4)],
      ["add to a stack", (tx, s) => tx.add("vault", "coal", 4)],
      ["stash", (tx, s) => tx.stash("slag_sword|epic|s1.0", 1)],
      ["remove part of a stack", (tx, s) => tx.remove("bank", "coal", 2)],
      ["remove a whole stack", (tx, s) => tx.remove("bank", "coal", 5)],
      ["spend across pools", (tx, s) => tx.spend("coal", 6)],
      ["pay", (tx, s) => tx.pay({ coal: 7, provision_t1: 3 })],
      ["gold", (tx, s) => tx.gold(-60)],
      ["earned gold", (tx, s) => tx.gold(40, true)],
      ["set a new prop", (tx, s) => tx.set(s.player, "extra", 1)],
      ["set an existing prop", (tx, s) => tx.set(s.player, "klass", "mage")],
      ["del", (tx, s) => tx.del(s.inv.items, "provision_t1")],
      ["push", (tx, s) => tx.push(s.agents, { id: "agent_2" })],
      ["splice", (tx, s) => tx.splice(s.agents, 0, 1, { id: "x" }, { id: "y" })],
    ];
    for (const [label, op] of attempts) {
      const s = clone(base);
      const before = clone(s);
      let applied = false;
      const res = S.transact(s, (tx) => {
        op(tx, s);
        applied = JSON.stringify(s) !== JSON.stringify(before);
        tx.fail("No.");
      });
      same(`${label}: applied, then refused, the save is exactly as before`, [applied, res, s], [true, { ok: false, error: "No." }, before]);
    }

    {
      const s = clone(base);
      const before = clone(s);
      const res = S.transact(s, (tx) => {
        attempts.forEach(([, op]) => { try { op(tx, s); } catch (e) { if (e.name !== "TxFail") throw e; } });
        tx.fail("No.");
      });
      same("all of them in one transaction, one after another: rolled back in reverse", [res.ok, s], [false, before]);
    }

    const s = clone(base);
    const before = clone(s);
    same("returning false rolls back with an error", [S.transact(s, (tx) => { tx.gold(5); tx.remove("bank", "coal", 1); return false; }).ok, s], [false, before]);
    let threw = null;
    try {
      S.transact(s, (tx) => { tx.stash("coal", 1); throw new Error("boom"); });
    } catch (e) {
      threw = e.message;
    }
    same("any other exception rolls back and is rethrown", [threw, s], ["boom", before]);
    let range = null;
    try {
      S.transact(s, (tx) => { tx.stash("coal", 1); tx.add("bank", "coal", 1.5); });
    } catch (e) {
      range = e.name;
    }
    same("a non-integer quantity is a programming error: thrown, rolled back", [range, s], ["RangeError", before]);
    for (const [label, fn] of [["zero", (tx) => tx.remove("bank", "coal", 0)], ["negative", (tx) => tx.spend("coal", -1)], ["NaN gold", (tx) => tx.gold(NaN)]]) {
      let name = null;
      try {
        S.transact(s, fn);
      } catch (e) {
        name = e.name;
      }
      check(`${label} throws a RangeError`, name === "RangeError");
    }
  }

  section("Refusal messages");
  {
    const s = fresh();
    fill(s, "inv");
    check('add: "<Pool> is full."', S.transact(s, (tx) => tx.add("inv", "provision_t9", 1)).error === "Belongings is full.");
    fill(s, "bank");
    fill(s, "vault");
    check('stash: "Nowhere to put <name>."', S.transact(s, (tx) => tx.stash("provision_t9", 1)).error === "Nowhere to put Godsbane Elixir.");
    check('remove: "Not enough <name>."', S.transact(s, (tx) => tx.remove("bank", "provision_t9", 1)).error === "Not enough Godsbane Elixir.");
    check('spend: "Not enough <name>."', S.transact(s, (tx) => tx.spend("provision_t9", 1)).error === "Not enough Godsbane Elixir.");
    check("pay fails on the first shortfall", S.transact(s, (tx) => tx.pay({ [mats[0]]: 1, provision_t9: 2 })).error === "Not enough Godsbane Elixir.");
    check('gold: "Not enough gold."', S.transact(s, (tx) => tx.gold(-1)).error === "Not enough gold.");
    const key = Object.keys(s.inv.items)[0];
    check("adding to a stack needs no free slot", S.transact(s, (tx) => tx.add("inv", key, 9)).ok && s.inv.items[key] === 10);
  }

  section("Nested transactions");
  {
    const s = fresh();
    s.player.gold = 50;
    const before = clone(s);
    const inner = [];
    const outer = S.transact(s, (tx) => {
      tx.stash("coal", 3);
      inner.push(S.transact(s, (t2) => { t2.stash("resin", 2); t2.gold(-60); }));
      inner.push(S.transact(s, (t2) => t2.stash("pulp", 4)));
      tx.gold(-10);
    });
    check("an inner refusal undoes only its own changes", outer.ok && !inner[0].ok && inner[0].error === "Not enough gold." && inner[1].ok &&
      s.bank.items.coal === 3 && !Object.hasOwn(s.bank.items, "resin") && s.bank.items.pulp === 4 && s.player.gold === 40);

    const s2 = clone(before);
    const r = S.transact(s2, (tx) => {
      tx.stash("coal", 3);
      S.transact(s2, (t2) => t2.stash("pulp", 4));
      tx.fail("Changed my mind.");
    });
    same("an outer refusal undoes what the inner ones did", [r.ok, s2], [false, before]);

    const s3 = clone(before);
    let threw = false;
    try {
      S.transact(s3, (tx) => {
        tx.stash("coal", 3);
        S.transact(s3, () => { throw new Error("deep"); });
      });
    } catch (e) {
      threw = e.message === "deep";
    }
    same("an exception deep inside unwinds everything", [threw, s3], [true, before]);

    const other = fresh();
    const r4 = S.transact(s3, (tx) => {
      tx.stash("coal", 1);
      S.transact(other, (t2) => t2.stash("resin", 1));
      tx.fail("No.");
    });
    check("a transaction on another save is its own", !r4.ok && other.bank.items.resin === 1 && !Object.hasOwn(s3.bank.items, "coal"));
    check("after the outermost ends, a new transaction starts clean", S.transact(s3, (tx) => tx.stash("coal", 1)).ok && s3.bank.items.coal === 1);
  }

  check("CONFIG storage untouched", CONFIG.storage.slots.inv === 10 && Object.isFrozen(CONFIG.storage));
});
