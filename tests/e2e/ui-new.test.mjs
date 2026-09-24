/* What these batches added, opened in a real browser: the skin a fresh camp
   picks and the face it puts on every page, the Discipline page's two tabs, a
   path spending a point, weapon mastery ranked by the realm, a commander anyone
   can look up, and the Fortify tab off an item.

     node tests/e2e/ui-new.test.mjs */

import { run, check, same, section, startStack, launch, openApp, signUp, waitForSync, dispatch, editSave, put, sql, advanceServer } from "./lib.mjs";

const live = (app, fn, arg) => app.page.evaluate(fn, arg);
const PAGE_CODE = /src\/client\/(pages|ui\/popups)\//;

await run(async () => {
  const stack = await startStack();
  const browser = await launch();
  const app = await openApp(browser, { url: stack.url });
  await app.page.waitForFunction(() => !!(window.__respite && window.__respite.store && window.__respite.ctx), null, { timeout: 20000 });

  const go = async (hash) => {
    await live(app, (h) => window.__respite.go(h), hash);
    await app.page.waitForTimeout(400);
  };
  const text = () => live(app, () => document.getElementById("view").textContent);
  const errs = () => app.errors.filter((e) => PAGE_CODE.test(String(e.stack || e.message || e)));

  section("a fresh camp picks a skin");
  {
    await go("#/character");
    const asked = await live(app, () => !!document.querySelector(".modal-title") && /Pick your skin/.test(document.querySelector(".modal-title").textContent));
    check("the skin picker opens on the Character page", asked);
    const names = await live(app, () => [...document.querySelectorAll(".modal .class-name")].map((n) => n.textContent));
    same("and offers both, by name", names, ["The Drifter", "The Outrider"]);
    check("and shows each one's face on its card",
      await live(app, () => [...document.querySelectorAll(".skin-card img")].map((i) => i.getAttribute("src")))
        .then((a) => a.length === 2 && a.every((x) => /skin-(drifter|outrider)\.webp$/.test(x))));
    check("and says nothing about a man or a woman",
      !/\b(man|woman|male|female|sex)\b/i.test(await live(app, () => document.querySelector(".modal").textContent)));
    await live(app, () => [...document.querySelectorAll(".modal .class-card")][0].click());
    await app.page.waitForTimeout(500);
    const skin = await live(app, () => window.__respite.store.state.player.skin);
    same("choosing one sets it on the save", skin, "drifter");
    const gone = await live(app, () => !document.querySelector(".modal-title"));
    check("and the picker closes", gone);
  }

  section("the same face, everywhere a commander is drawn");
  {
    const src = (sel) => live(app, (q) => {
      const img = document.querySelector(q);
      return img ? (img.getAttribute("src") || "") : null;
    }, sel);

    await go("#/character");
    const hero = await src(".char-portrait img");
    check("the Character hero wears the skin that was chosen", /skin-drifter\.webp$/.test(hero || ""), hero);

    await go("#/armaments");
    await app.page.waitForTimeout(400);
    const doll = await src(".doll-figure .portrait img");
    same("and so does the figure wearing the gear", doll, hero);

    await go("#/skill/warfare");
    await app.page.waitForTimeout(400);
    const arena = await src(".arena-portrait img");
    same("and so does the one in the arena", arena, hero);
  }

  section("the Discipline page");
  {
    await go("#/discipline");
    const body = await text();
    check("it mounts, and is not the router's fallback card", !/still being built|fell over/.test(body), body.slice(0, 120));
    await live(app, () => [...document.querySelectorAll("[role=tab]")].find((t) => /Mastery/.test(t.textContent)).click());
    await app.page.waitForTimeout(300);
    const rows = await live(app, () => [...document.querySelectorAll("[data-line]")].map((r) => r.dataset.line));
    same("a row for every line that is out, in the page's order", rows, ["sword", "shield", "dagger", "bow", "staff"]);
    check("and none for a line that is shelved", !rows.includes("greatsword") && !rows.includes("grimoire"), rows);
    const detail = await live(app, () => document.querySelector(".mastery-detail").textContent);
    check("and one of them is read out below", /Mastery 0/.test(detail) && /Untried/.test(detail), detail.slice(0, 160));
    await live(app, () => document.querySelector('[data-line="bow"]').click());
    await app.page.waitForTimeout(200);
    const bow = await live(app, () => document.querySelector(".mastery-detail").textContent);
    check("clicking a line swaps the panel", /Bow/.test(bow) && /Bowhand/.test(bow), bow.slice(0, 160));

    await live(app, () => [...document.querySelectorAll("[role=tab]")].find((t) => /Path/.test(t.textContent)).click());
    await app.page.waitForTimeout(300);
    const path = await live(app, () => document.querySelector(".page").textContent);
    check("Path says there is none without a discipline", /No path without a discipline/.test(path), path.slice(0, 200));
  }

  section("a Warrior's path, once there is one");
  {
    const player = await signUp(app.page, "uinew_a", "hunter-pass");
    await waitForSync(app.page);
    await editSave(stack, "uinew_a", (s) => {
      s.skills.warfare = 1e7;
      put(s, "vault", "slag_ring|rare|c1.2", 1);
      put(s, "vault", "slag_sword|common", 1);
      put(s, "bank", "lesser_veil_essence", 40);
    });
    await live(app, () => window.__respite.store.sync());
    await app.page.waitForTimeout(1200);
    await dispatch(app.page, "pickClass", { id: "warrior" });
    await app.page.waitForTimeout(400);

    await go("#/discipline");
    await live(app, () => [...document.querySelectorAll("[role=tab]")].find((t) => /Path/.test(t.textContent)).click());
    await app.page.waitForTimeout(400);
    const nodes = await live(app, () => [...document.querySelectorAll(".path-tree .path-face")].map((n) => n.dataset.node));
    same("ten faces on the road, all of them the Warrior's", nodes.length, 10);
    check("and none of them another discipline's", nodes.every((id) => id.startsWith("wr_")), nodes);
    const named = await live(app, () => {
      const cell = document.querySelector('.path-face[data-node="wr_ironhide"]').closest(".path-node");
      return {
        name: cell.querySelector(".path-name").textContent,
        rank: cell.querySelector(".path-rank"),
        segs: cell.querySelectorAll(".path-seg").length,
        art: !!cell.querySelector(".path-art .ico"),
      };
    });
    // Nothing is written under the name: the ring's segments are the ranks.
    check("a node says its name and reads its ranks off the ring, one segment apiece",
      named.name === "Ironhide" && named.segs === 4 && named.art && named.rank === null, named);
    const shut = await live(app, () => {
      const cell = document.querySelector(".path-node.is-shut");
      return cell ? { id: cell.querySelector(".path-face").dataset.node, locked: !cell.querySelector(".path-lock").hidden } : null;
    });
    check("a band still shut wears a lock", !!shut && shut.locked, shut);

    // Clicking stages and nothing more: the foot bar is the only thing that spends.
    const before = await live(app, () => window.__respite.store.state.path || {});
    await live(app, () => document.querySelector('.path-face[data-node="wr_ironhide"]').click());
    await app.page.waitForTimeout(300);
    const marked = await live(app, () => {
      const cell = document.querySelector('.path-face[data-node="wr_ironhide"]').closest(".path-node");
      return {
        staged: cell.classList.contains("is-staged"),
        saved: window.__respite.store.state.path || {},
        seal: document.querySelector(".path-foot .btn-primary").textContent,
      };
    });
    check("clicking a node stages a rank and spends nothing",
      marked.staged && (marked.saved.wr_ironhide || 0) === (before.wr_ironhide || 0), marked);
    check("and the foot offers to seal it", /Seal one point/.test(marked.seal), marked.seal);

    await live(app, () => document.querySelector(".path-foot .btn-primary").click());
    await app.page.waitForTimeout(500);
    const asked = await live(app, () => {
      const m = document.querySelector(".modal");
      return m ? m.textContent : "";
    });
    check("sealing asks before it spends", /Seal one point\?/.test(asked), asked.slice(0, 160));
    const held = await live(app, () => window.__respite.store.state.path || {});
    same("and nothing is spent while it is asking", held.wr_ironhide || 0, before.wr_ironhide || 0);
    await live(app, () => [...document.querySelectorAll(".modal button")].find((b) => /Spend the point/.test(b.textContent)).click());
    await app.page.waitForTimeout(900);
    const after = await live(app, () => window.__respite.store.state.path || {});
    check("answering it spends the point", (after.wr_ironhide || 0) > (before.wr_ironhide || 0), { before, after });
  }

  section("weapon mastery, ranked by the realm");
  {
    // A sword behind a shield is a shield being learned. Points set outright.
    await editSave(stack, "uinew_a", (s2) => {
      s2.player.skin = "outrider";
      s2.mastery = { sword: 40000, shield: 900 };
      s2.equipment.weapon = "slag_sword|common";
      s2.equipment.offhand = "bitter_shield|common";
    });
    await live(app, () => window.__respite.store.sync());
    await app.page.waitForTimeout(1500);

    await go("#/discipline");
    await live(app, () => [...document.querySelectorAll("[role=tab]")].find((t) => /Mastery/.test(t.textContent)).click());
    await app.page.waitForTimeout(1500);

    const marked = await live(app, () => [...document.querySelectorAll("[data-line].is-learning")].map((r) => r.dataset.line));
    same("the shield is what the hands are learning, not the sword", marked, ["shield"]);

    await live(app, () => document.querySelector('[data-line="sword"]').click());
    await app.page.waitForTimeout(600);
    const detail = await live(app, () => {
      const d = document.querySelector(".mastery-detail");
      const rank = d.querySelector(".tag-gold");
      return { text: d.textContent, rank: rank && !rank.hidden ? rank.textContent : null, saint: !!d.querySelector(".is-saint") };
    });
    check("the sword reads its level and grade", /Mastery \d/.test(detail.text) && /Swordhand/.test(detail.text), detail.text.slice(0, 140));
    check("the realm ranks it, and this camp is first on it", detail.saint && /Saint/i.test(detail.rank || ""), detail);
    check("and it says how a line is learned at all", /your off-hand first/.test(detail.text), detail.text.slice(0, 160));

    // The detail sits above the list, and the lines this discipline cannot hold sit under it.
    const order = await live(app, () => {
      const root = document.querySelector(".page");
      const detailEl = root.querySelector(".mastery-detail");
      const listEl = root.querySelector(".list [data-line]");
      return detailEl && listEl
        ? (detailEl.compareDocumentPosition(listEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        : null;
    });
    check("the panel you came for is above the list, not under it", order === true, order);
    const shutLines = await live(app, () => {
      const head = document.querySelector(".mastery-shut-head");
      return {
        headed: !!head && !head.hidden,
        text: document.querySelector(".page").textContent,
      };
    });
    check("a line you cannot carry is under its own quiet heading", shutLines.headed, shutLines.headed);
    check("and nowhere does it say a line is not yours to hold", !/Not yours to hold/.test(shutLines.text), shutLines.text.slice(0, 200));

    await go("#/hiscores");
    await app.page.waitForTimeout(600);
    await live(app, () => [...document.querySelectorAll("[role=tab]")].find((t) => /Mastery/.test(t.textContent)).click());
    await app.page.waitForTimeout(2000);
    const board = await live(app, () => {
      const t = document.querySelector("table");
      return t ? t.textContent.replace(/\s+/g, " ").trim() : (document.querySelector(".page") || {}).textContent;
    });
    check("the Mastery board lists this camp with a level off its points",
      /uinew_a/i.test(board) && !/not kept yet/i.test(board), board.slice(0, 200));
  }

  section("a commander anyone can look at");
  {
    await go("#/hiscores");
    await app.page.waitForTimeout(800);
    await live(app, () => [...document.querySelectorAll("[role=tab]")].find((t) => /Mastery/.test(t.textContent)).click());
    await app.page.waitForTimeout(2000);

    const faces = await live(app, () => [...document.querySelectorAll(".hs-face img")].map((i) => i.getAttribute("src")));
    check("a board row shows a face, not an initial in a circle", faces.length > 0 && faces.every((f) => /\.webp$/.test(f)), faces);
    check("and the camp's own row wears the skin on its save", faces.some((f) => /skin-outrider\.webp$/.test(f)), faces);
    const links = await live(app, () => [...document.querySelectorAll("a.hs-link")].map((a) => a.getAttribute("href")));
    check("and the name is a link to their page", links.some((l) => /^#\/player\/uinew_a$/i.test(l || "")), links);

    await go("#/player/uinew_a");
    await app.page.waitForTimeout(2500);
    const page = await live(app, () => document.querySelector(".page").textContent);
    check("the profile opens and names them", /Uinew_a/.test(page), page.slice(0, 120));
    check("the head says their discipline and their ground",
      /Warrior/.test(page) && /Verge|Gallowmoor|Warrens|Graveshelf|Fen|Umberdeep|Wyrmreach|Fade|Godsdown/.test(page), page.slice(0, 200));
    const bust = await live(app, () => {
      const i = document.querySelector(".prof-top .prof-portrait img");
      return i ? i.getAttribute("src") : null;
    });
    check("and wears their skin", /skin-outrider\.webp$/.test(bust || ""), bust);
    const worn = await live(app, () => [...document.querySelectorAll(".prof-standing .doll .doll-slot")].length);
    same("Standing wears the Satchel's own paperdoll, all eight slots", worn, 8);
    const beside = await live(app, () => {
      const card = document.querySelector(".prof");
      return !!(card && card.querySelector(".prof-main .doll") && card.querySelector(".prof-side .prof-stats"));
    });
    check("with the standing beside it, not under it", beside === true, beside);
    const figure = await live(app, () => {
      const i = document.querySelector(".prof-standing .doll-figure img");
      return i ? i.getAttribute("src") : null;
    });
    check("and the figure in the middle of it wears their skin too", /skin-outrider\.webp$/.test(figure || ""), figure);

    await live(app, () => [...document.querySelectorAll("[role=tab]")].find((t) => /Skills/.test(t.textContent)).click());
    await app.page.waitForTimeout(400);
    const skills = await live(app, () => [...document.querySelectorAll(".prof-skills .prof-skill")].length);
    check("and Skills lists every one of them", skills === 11, skills);

    await go("#/player/nobodyatall");
    await app.page.waitForTimeout(2000);
    const none = await live(app, () => document.querySelector(".page").textContent);
    check("a name nobody answers to says so plainly", /No such commander/.test(none), none.slice(0, 160));
  }

  section("the market, one row a shelf");
  {
    /* Three Slag Swords at three prices and two rarities, plus ore. The shelf shows the
       sword once at the cheapest of them, and opening it lists the pieces. */
    await editSave(stack, "uinew_a", (s2) => {
      put(s2, "bank", "slag_sword|common", 2);
      put(s2, "bank", "slag_sword|epic|c4.1", 1);
      put(s2, "bank", "slag_delve", 30);
    });
    await live(app, () => window.__respite.store.sync());
    await app.page.waitForTimeout(1200);
    await dispatch(app.page, "marketList", { key: "slag_sword|common", from: "bank", qty: 2, price: 140 });
    await dispatch(app.page, "marketList", { key: "slag_sword|epic|c4.1", from: "bank", qty: 1, price: 900 });
    await dispatch(app.page, "marketList", { key: "slag_delve", from: "bank", qty: 30, price: 6 });
    await app.page.waitForTimeout(600);

    await go("#/market");
    await app.page.waitForTimeout(2500);
    const rows = await live(app, () => [...document.querySelectorAll(".listing[data-base]")].map((n) => ({
      base: n.dataset.base,
      tag: n.tagName,
      name: n.querySelector(".listing-name").textContent,
      cheapest: n.querySelector(".listing-price").textContent,
      buttons: n.querySelectorAll("button").length,
    })));
    const sword = rows.find((r) => r.base === "slag_sword");
    check("gear is one row a base, not one a listing", rows.filter((r) => r.base === "slag_sword").length === 1, rows);
    check("named plainly, with no rarity in it", !!sword && sword.name === "Slag Sword", sword);
    check("priced at the cheapest on the shelf", !!sword && /140/.test(sword.cheapest), sword);
    check("the row is the button, so it carries none of its own", !!sword && sword.tag === "BUTTON" && sword.buttons === 0, sword);
    const pools = await live(app, () => [...document.querySelectorAll(".listing[data-key]")].map((n) => n.dataset.key));
    check("your own ore is not in the pool, because a pool is what you can buy", !pools.includes("slag_delve"), pools);
    const mine = await live(app, () => document.querySelector(".grid-2 .list").textContent);
    check("it is on your own card instead, with Remove", /Slag Ore/.test(mine) && /Remove/.test(mine), mine.slice(0, 200));

    await live(app, () => document.querySelector('.listing[data-base="slag_sword"]').click());
    await app.page.waitForTimeout(1800);
    const sheet = await live(app, () => {
      const m = document.querySelector(".modal");
      return m ? {
        title: m.querySelector(".modal-title").textContent,
        head: [...m.querySelectorAll(".book-head > *")].map((n) => n.textContent),
        lots: [...m.querySelectorAll(".book-row")].map((r) => r.textContent),
      } : null;
    });
    check("opening it lists every piece on it", !!sheet && sheet.lots.length === 2, sheet && sheet.lots);
    check("priced down one column and counted down another", !!sheet && sheet.head.join("|") === "Price|Piece|Quantity", sheet && sheet.head);
    check("each with its own rarity and price", !!sheet && /Epic/.test(sheet.lots.join(" ")) && /900/.test(sheet.lots.join(" ")), sheet && sheet.lots);
    check("and they are your own, so they say Remove", !!sheet && /Remove/.test(sheet.lots.join(" ")), sheet && sheet.lots);
    await live(app, () => [...document.querySelectorAll(".modal button")].find((b) => /Close/.test(b.textContent)).click());
    await app.page.waitForTimeout(400);

    // The rarity floor lifts the shelf price to the cheapest that passes it.
    await live(app, () => {
      const sel = [...document.querySelectorAll(".market-bar select")].find((x) => /rarity/i.test(x.getAttribute("aria-label") || ""));
      sel.value = "epic";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await app.page.waitForTimeout(2200);
    const floored = await live(app, () => [...document.querySelectorAll(".listing")].map((n) => ({
      base: n.dataset.base || null, key: n.dataset.key || null, price: n.querySelector(".listing-price").textContent,
    })));
    const epicSword = floored.find((r) => r.base === "slag_sword");
    check("a rarity floor lifts the price to the cheapest that passes it", !!epicSword && /900/.test(epicSword.price), floored);
    check("and closes the material pools, which have no rarity at all", floored.every((r) => !r.key), floored);
  }

  section("the Collection, in four views");
  {
    await editSave(stack, "uinew_a", (s2) => {
      s2.rolls["m:mob_t1_skirmisher"] = 2080;
      s2.player.gold = 5000;
    });
    await live(app, () => window.__respite.store.sync());
    await app.page.waitForTimeout(1200);
    /* Bought rather than put into the save by hand: the record is written where items
       actually enter a camp (Tx.add), so a buy is what proves it is written at all. */
    await dispatch(app.page, "buyRemedy", { key: "provision_t1", qty: 1 });
    await app.page.waitForTimeout(600);

    await go("#/character");
    await live(app, () => [...document.querySelectorAll("[role=tab]")].find((t) => /Collection/.test(t.textContent)).click());
    await app.page.waitForTimeout(600);
    const tabs = await live(app, () => [...document.querySelectorAll(".coll-tabs .coll-chip")].map((t) => t.dataset.tab));
    same("two tabs: what you own and what you have put down", tabs, ["items", "foes"]);

    // Monsters: the ground chips narrow it, and a felled one carries its count.
    await live(app, () => document.querySelector('[data-tab="foes"]').click());
    await app.page.waitForTimeout(500);
    const foes = await live(app, () => ({
      groups: document.querySelectorAll(".coll-groups .coll-chip").length,
      cells: document.querySelectorAll(".coll-grid .coll-cell").length,
      titles: [...document.querySelectorAll("button.coll-cell[data-monster]")].map((b) => b.title),
    }));
    check("a ground chip for every region", foes.groups === 9, foes.groups);
    check("and the first ground's foes are in the grid", foes.cells > 0, foes.cells);
    check("a monster you have put down says how many",
      foes.titles.some((t) => /Defeated 2,080/.test(t)), foes.titles.slice(0, 4));
    check("and never says it the old way",
      !foes.titles.some((t) => /\d felled\b/i.test(t) || /of yours/.test(t)), foes.titles.slice(0, 4));

    // Items: a kind row, and every piece of gear there is, held or not.
    await live(app, () => document.querySelector('[data-tab="items"]').click());
    await app.page.waitForTimeout(400);
    const kinds = await live(app, () => [...document.querySelectorAll(".coll-row:not(.coll-groups) .coll-chip")].map((t) => t.dataset.kind));
    check("a chip for every kind of item", kinds.includes("gear") && kinds.includes("parts") && kinds.includes("remedies"), kinds);

    const gear = await live(app, () => ({
      cells: document.querySelectorAll(".coll-grid .coll-cell").length,
      chip: document.querySelector(".section-head .chip").textContent,
    }));
    check("gear lists every piece of the ground it is on, held or not", gear.cells > 10, gear);
    check("and the count says how much of everything there is", /of [\d,]+ collected/.test(gear.chip), gear.chip);

    /* A remedy is bought, not found, so it has a kind of its own. What was bought
       is lit there, because buying is where the record is written. */
    await live(app, () => document.querySelector('[data-kind="remedies"]').click());
    await app.page.waitForTimeout(400);
    const held = await live(app, () => [...document.querySelectorAll("button.coll-cell[data-item]")].map((b) => b.dataset.item));
    check("what was bought is lit, because that is where a record is written",
      held.includes("provision_t1"), held.slice(0, 12));
  }

  section("a profile's Collection, as an album");
  {
    // Your own name: the profile reads your save, so what was just bought and felled is on it.
    await go("#/player/uinew_a");
    await app.page.waitForTimeout(2500);
    await live(app, () => [...document.querySelectorAll(".prof-tabs [role=tab]")].find((t) => /Collection/.test(t.textContent)).click());
    await app.page.waitForTimeout(600);
    const modes = await live(app, () => [...document.querySelectorAll(".alb-modes [data-mode]")].map((t) => t.dataset.mode));
    same("two views: what they own and what they have put down", modes, ["items", "foes"]);
    check("and the numbers give way to them at the side",
      await live(app, () => document.querySelector(".prof-sheet").hidden && !document.querySelector(".alb-filters").hidden));

    await live(app, () => document.querySelector('[data-mode="foes"]').click());
    await app.page.waitForTimeout(500);
    const foes = await live(app, () => ({
      rows: document.querySelectorAll(".alb-album .alb-row").length,
      cards: document.querySelectorAll(".alb-tiles .alb-foe").length,
      rat: (document.querySelector('button.alb-foe[data-monster="mob_t1_skirmisher"]') || { textContent: "" }).textContent,
    }));
    check("a row for every ground", foes.rows === 9, foes.rows);
    check("and the first ground's foes are open under it", foes.cards === 4, foes.cards);
    check("a monster put down says how many", /2,080 slain/.test(foes.rat), foes.rat);

    await live(app, () => document.querySelector('[data-mode="items"]').click());
    await app.page.waitForTimeout(400);
    const kinds = await live(app, () => [...document.querySelectorAll(".alb-kind")].map((t) => t.dataset.kind));
    same("a row for every kind of item", kinds, ["gear", "parts", "veil"]);
    const tiles = await live(app, () => document.querySelectorAll(".alb-tiles .alb-tile").length);
    check("equipment lists every piece of the ground it is on, tools too", tiles === 24, tiles);

    await live(app, () => document.querySelector('[data-kind="parts"]').click());
    await app.page.waitForTimeout(400);
    await live(app, () => document.querySelector('button.alb-tile[data-item="provision_t1"]').click());
    await app.page.waitForTimeout(500);
    const entry = await live(app, () => ({
      title: (document.querySelector(".modal-title") || { textContent: "" }).textContent,
      sub: (document.querySelector(".modal-sub") || { textContent: "" }).textContent,
      facts: [...document.querySelectorAll(".entry-facts dt")].map((d) => d.textContent),
    }));
    same("a lit entry opens its card, named", [entry.title, entry.sub], ["Bitter-Ash Salve", "Resource · Remedy"]);
    same("with its facts", entry.facts, ["Heals", "Ground", "Tier"]);
    await live(app, () => document.querySelector(".modal .modal-x").click());
    await app.page.waitForTimeout(400);
  }

  section("the party, and where it sits");
  {
    const nav = await live(app, () => {
      const row = [...document.querySelectorAll("#sidebar a, #sidebar button")].map((a) => ({
        label: a.textContent.trim(),
        group: a.closest("[id^=nav]") ? a.closest("[id^=nav]").id : null,
      }));
      return row.filter((r) => /^Party/.test(r.label));
    });
    check("Party sits under the Vanguard now", nav.length === 1 && /^navVanguard/.test(nav[0].group || ""), nav);
  }

  /* The page a signed-in hunter is most often on, in the state they are most
     often in. A guest never reaches commanderName's own branch (no username, so
     it answers "Commander" and returns early), which is exactly how a helper it
     needed went missing for a whole release without a test noticing. */
  section("the Hunt page, signed in and out on a hunt");
  {
    await dispatch(app.page, "startHunt", { tier: 1, zone: "outer" });
    await app.page.waitForTimeout(600);
    await go("#/skill/warfare");
    await app.page.waitForTimeout(600);
    const arena = await live(app, () => ({
      fell: document.querySelector(".empty-title") ? document.querySelector(".empty-title").textContent : null,
      name: document.querySelector(".arena-name") ? document.querySelector(".arena-name").textContent : null,
      foes: document.querySelectorAll(".arena-foes .foe-card").length,
    }));
    check("it mounts rather than falling over", arena.fell === null, arena);
    check("and the arena carries the commander's own name, capitalised", arena.name === "Uinew_a", arena);
    const pageErrs = errs().filter((e) => /hunt\.js/.test(String(e.stack || e.message || e)));
    check("and nothing in it threw", pageErrs.length === 0, pageErrs.map((e) => String(e.message || e)));
    await dispatch(app.page, "pullBack", {});
    await app.page.waitForTimeout(400);
  }

  section("the Hunt page while the party is out");
  {
    /* Two real camps, a real party, a real shared fight, and then the Hunt page opened on
       it. Nothing before this had ever drawn the warband, which is how `syncBand` came to
       read a `skins` that only existed inside `paintParty` and take the whole page down. */
    const B = await openApp(browser, { url: stack.url });
    await B.page.waitForFunction(() => !!(window.__respite && window.__respite.store && window.__respite.ctx), null, { timeout: 20000 });
    await signUp(B.page, "uinew_b", "hunter-pass-1");
    await B.page.waitForTimeout(2500);
    await B.page.keyboard.press("Escape");
    const bParty = (fn, arg) => B.page.evaluate(fn, arg);

    // A discipline, so the card has one to put the title in place of. The Veil opens at a level.
    await editSave(stack, "uinew_b", (s) => { s.skills.warfare = 1e7; });
    await bParty(() => window.__respite.store.sync());
    await B.page.waitForTimeout(1500);
    await dispatch(B.page, "pickClass", { id: "rogue" });
    await bParty(() => window.__respite.store.sync());
    await B.page.waitForTimeout(1500);

    await live(app, () => window.__respite.ctx.net.party.create("The Proving"));
    await live(app, () => window.__respite.ctx.net.party.invite("uinew_b"));
    const took = await bParty(async () => {
      const st = await window.__respite.ctx.net.party.state();
      const inv = st.data.invites_in[0];
      return (await window.__respite.ctx.net.party.respond(inv.id, true)).error;
    });
    check("the second camp accepts the invite", took === null || took === undefined, took);

    // Marked ready, so the host's press walks them on: the muster and the page in one go.
    await live(app, () => window.__respite.ctx.net.party.propose(1, "outer"));
    await bParty(() => window.__respite.ctx.net.party.ready(true));
    await dispatch(app.page, "partyHuntStart", { tier: 1, zone: "outer" });
    await app.page.waitForTimeout(800);
    await bParty(() => window.__respite.store.sync());
    await B.page.waitForTimeout(2500);

    await go("#/skill/warfare");
    await app.page.waitForTimeout(1200);
    const band = await live(app, () => ({
      fell: document.querySelector(".empty-title") ? document.querySelector(".empty-title").textContent : null,
      party: !!document.querySelector(".arena.is-party"),
      mates: [...document.querySelectorAll(".band-mate .band-name")].map((n) => n.textContent),
      title: (document.querySelector(".hunt-title") || {}).textContent,
      you: !!document.querySelector(".band-mate.is-me"),
    }));
    check("the Hunt page draws the party's fight instead of falling over",
      band.fell !== "This page fell over" && band.party, band);
    check("with the warband in it, this camp first", band.mates[0] === "You" && band.mates.length === 2, band);
    const huntErrs = errs().filter((e) => /hunt\.js/.test(String(e.stack || e.message || e)));
    check("and nothing in hunt.js threw", huntErrs.length === 0, huntErrs.map((e) => String(e.message || e)));

    // A share is the payout's own figure over the session, so a hunter who has fought has one.
    await advanceServer(stack, 90 * 1000);
    await bParty(() => window.__respite.store.sync());
    await live(app, () => window.__respite.store.sync());
    await app.page.waitForTimeout(1000);
    const kpiOf = (label) => live(app, (l) => {
      const k = [...document.querySelectorAll(".hunt-card .kpi")].find((n) => n.querySelector(".l").textContent === l);
      return k ? k.querySelector(".v").textContent : null;
    }, label);
    const share = await kpiOf("Your share");
    const view = await live(app, () => {
      const v = window.__respite.store.partyHunt;
      const me = window.__respite.ctx.account.userId;
      return v ? { mine: v.hunters.find((u) => u.userId === me), all: v.hunters.map((u) => [u.dmg, u.share]) } : null;
    });
    const dealt = view ? view.all.filter(([dmg]) => dmg > 0) : [];
    check("the party's shares come to the whole once anyone has fought (never 0% all round)",
      dealt.length > 0 && Math.abs(view.all.reduce((n, [, sh]) => n + sh, 0) - 100) <= 0.2, view);
    same("and the page shows this camp's own", share, view && view.mine ? `${Math.round(view.mine.share)}%` : null);

    /* A fall, as the page hears it: the death is settled in the answer that takes the camp off
       the roster. The arena stays on the party's fight, with this camp in it as Fallen. */
    await live(app, () => window.__respite.store.bus.emit("store:news", { type: "hunt:death", monsterId: "ash_stalker" }));
    await dispatch(app.page, "partyHuntLeave", {});
    await app.page.waitForTimeout(1500);
    const watched = await live(app, () => ({
      party: !!document.querySelector(".arena.is-party"),
      band: [...document.querySelectorAll(".band-mate")].map((n) => [n.querySelector(".band-name").textContent, n.querySelector(".hpbar span").textContent]),
      sub: (document.querySelector(".hunt-card .card-sub") || {}).textContent,
      go: [...document.querySelectorAll(".hunt-actions .btn")].filter((b) => !b.hidden).map((b) => b.textContent.trim()),
    }));
    check("a fallen camp still sees its party fighting, not an empty arena", watched.party && watched.band.length === 2, watched);
    same("and itself in the band, marked Fallen", watched.band[0], ["You", "Fallen"]);
    check("with the fall said plainly, and the way back offered", /You fell/.test(watched.sub || "") && watched.go.includes("Join your party"), watched);
    same("and the rest of the party's numbers, not its own zeroes", [await kpiOf("You"), (await kpiOf("Standing") || "").replace(/\d/g, "n")], ["Fallen", "n of n"]);

    await live(app, () => [...document.querySelectorAll(".hunt-actions .btn")].find((b) => /Join your party/.test(b.textContent)).click());
    await app.page.waitForTimeout(1500);
    const back = await live(app, () => ({
      mates: [...document.querySelectorAll(".band-mate .band-name")].map((n) => n.textContent),
      pull: [...document.querySelectorAll(".hunt-actions .btn")].filter((b) => !b.hidden).map((b) => b.textContent.trim()),
    }));
    check("Join your party puts the camp back on the fight", back.mates[0] === "You" && back.pull.includes("Break away"), back);

    /* A square in the room opens the other camp's card, and the card knows they are already
       standing in this party: nobody is invited into a party they are in. */
    await go("#/party");
    await app.page.waitForTimeout(1200);
    const openMate = () => live(app, async () => {
      const seat = [...document.querySelectorAll(".seat-name")].find((b) => /uinew_b/i.test(b.textContent));
      if (seat) seat.click();
      await new Promise((ok) => setTimeout(ok, 900));
      return {
        title: (document.querySelector(".modal-profile .modal-title") || {}).textContent,
        sub: (document.querySelector(".modal-profile .modal-sub") || {}).textContent,
        chips: [...document.querySelectorAll(".profile-tags > *")].map((n) => n.textContent.trim()),
        actions: [...document.querySelectorAll(".modal-profile .modal-foot .btn")].map((b) => b.textContent.trim()),
      };
    });
    const card = await openMate();
    check("a party mate's card offers no invite into the party they are in",
      !card.actions.some((l) => /Invite/.test(l)) && card.actions.includes("Close"), card);
    same("and says what they are at before what they are",
      [/Online|Last about|Not seen/.test(card.chips[0]), card.chips[1], card.chips[2]],
      [true, "Hunting the Outer", "Rogue"]);
    await app.page.keyboard.press("Escape");
    await app.page.waitForTimeout(400);

    /* A title stands in place of the discipline, on the card and in its subtitle both: one
       commander in the realm holds each line, and next to that "Rogue" is noise. */
    await sql(stack, `update public.profiles set mastery = '{"bow": 900}'::jsonb where username = 'uinew_b'`);
    await live(app, async () => {
      const t = await import("/src/client/titles.js");
      t.clearTitles();
      await t.refreshTitles(window.__respite.ctx, { force: true });
    });
    const crowned = await openMate();
    same("a saint's card wears the title where the discipline was",
      [crowned.chips[1], crowned.chips[2], crowned.chips.some((c) => /Rogue/i.test(c))],
      ["Hunting the Outer", "Sun Piercer", false]);
    check("and the subtitle says it instead of the discipline too",
      /Sun Piercer/i.test(crowned.sub || "") && !/Rogue/i.test(crowned.sub || ""), crowned.sub);
    await app.page.keyboard.press("Escape");
    await app.page.waitForTimeout(400);

    await dispatch(app.page, "partyHuntLeave", {});
    await app.page.waitForTimeout(600);
    await live(app, () => window.__respite.ctx.net.party.leave());
    await bParty(() => window.__respite.ctx.net.party.leave());
    await app.page.waitForTimeout(400);
    await B.page.close();
  }

  section("the anvil");
  {
    await go("#/stockpile");
    // A piece's own sheet no longer works the Veil: the anvil is the one place it happens.
    const opened = await app.page.evaluate(async () => {
      const mod = await import("/src/client/ui/widgets.js");
      mod.openPopup("item", window.__respite.ctx, "slag_ring|rare|c1.2", { from: "vault" });
      await new Promise((ok) => setTimeout(ok, 200));
      return [...document.querySelectorAll(".modal-foot .btn")].map((b) => b.textContent.trim());
    });
    check("a ring's sheet does not work the Veil, and does not break it down either",
      opened.length > 0 && !opened.some((l) => /Fortify|Break down/.test(l)), opened);
    check("and a move button is the place it moves to, nothing more",
      opened.some((l) => l === "Stockpile" || l === "Belongings"), opened);
    await app.page.keyboard.press("Escape");
    await app.page.waitForTimeout(300);

    await go("#/fortify");
    await app.page.waitForTimeout(800);
    const anvil = await live(app, () => ({
      title: (document.querySelector(".page-title") || {}).textContent,
      empty: !!document.querySelector(".rite-core.is-empty"),
      staked: document.querySelectorAll(".socket.is-filled").length,
      sockets: document.querySelectorAll("button.socket").length,
      racks: document.querySelectorAll(".forge-rack").length,
      go: (document.querySelector(".rite-under .btn") || {}).disabled,
      nav: !!document.querySelector('.nav-item[aria-current="page"][href="#/fortify"]'),
    }));
    check("the Fortify tab opens with an empty anvil", anvil.title === "Fortify" && anvil.empty && anvil.staked === 0, anvil);
    check("three essence sockets and a charm socket round it, two racks beside it",
      anvil.sockets === 4 && anvil.racks === 2 && anvil.nav, anvil);
    check("and nothing to press until something is on it", anvil.go === true, anvil);

    // A ring onto the anvil, an essence in a socket, one press at 100%.
    await live(app, () => document.querySelector('.forge-tile[data-key="slag_ring|rare|c1.2"]').click());
    await app.page.waitForTimeout(250);
    await live(app, () => document.querySelector('.forge-tile[data-key="lesser_veil_essence"]').click());
    await app.page.waitForTimeout(250);
    const armed = await live(app, () => ({
      odds: (document.querySelector(".odds-v") || {}).textContent,
      staked: document.querySelectorAll(".socket.is-filled").length,
      go: (document.querySelector(".rite-under .btn") || {}).disabled,
    }));
    check("a piece and an essence put on it read 100% on a bare ring",
      armed.odds === "100%" && armed.staked === 1 && armed.go === false, armed);
    await live(app, () => document.querySelector(".rite-under .btn").click());
    await app.page.waitForTimeout(2200);
    const took = await live(app, () => ({
      stamp: (document.querySelector(".stamp-t") || {}).textContent,
      vault: Object.keys(window.__respite.store.state.vault.items),
      essence: window.__respite.store.state.bank.items.lesser_veil_essence,
    }));
    check("one press at 100% takes: the stamp says so and the ring reads +1",
      took.stamp === "Fortified" && took.vault.some((k) => /^slag_ring\|rare\|c1\.2\|\+1$/.test(k)) && took.essence === 39, took);

    /* A stone goes in by a drag, so it comes out by one: onto another hole it
       trades places, anywhere else it leaves the anvil. */
    await app.page.waitForTimeout(2000);
    await app.page.click('button.slot[data-key="lesser_veil_essence"]');
    await app.page.waitForTimeout(400);
    const holes = () => live(app, () => [...document.querySelectorAll(".socket")]
      .map((n) => `${n.dataset.socket}:${n.classList.contains("is-filled") ? "full" : "empty"}`));
    const staked = await holes();
    check("a pressed essence fills the first hole, and it can be lifted",
      staked[1] === "2:full" && await live(app, () => document.querySelector('.socket[data-socket="2"]').getAttribute("draggable")) === "true", staked);

    await app.page.dragAndDrop('.socket[data-socket="2"]', '.socket[data-socket="3"]');
    await app.page.waitForTimeout(300);
    const moved = await holes();
    check("dragged onto another hole it trades places", moved[1] === "2:empty" && moved[2] === "3:full", moved);

    await app.page.dragAndDrop('.socket[data-socket="3"]', '.forge-rack');
    await app.page.waitForTimeout(300);
    const gone = await holes();
    check("dragged off the circle it leaves the anvil", gone.every((x) => /empty$/.test(x)), gone);
  }

  section("Requisitions, and the list the game draws");
  {
    /* The deploy dialog is the one screen that reads an agent and an item together,
       and it is behind a tier 2 region, so nothing opened it until now. That is how
       a helper deleted out of this page went unnoticed: the modal threw on open and
       no suite ever pressed the button. */
    await editSave(stack, "uinew_a", (s2) => {
      if (!s2.travel.unlocked.includes("region_2")) s2.travel.unlocked.push("region_2");
      s2.player.gold = 5000;
    });
    await live(app, () => window.__respite.store.sync());
    await app.page.waitForTimeout(1200);
    await dispatch(app.page, "hireAgent", {});
    await app.page.waitForTimeout(400);

    await go("#/requisitions");
    await app.page.waitForTimeout(600);
    const roster = await live(app, () => ({
      title: (document.querySelector(".page-title") || {}).textContent,
      cards: document.querySelectorAll(".agent-card").length,
      learn: !!document.querySelector(".agent-learn .bar"),
      deploy: !!document.querySelector(".agent-deploy .btn"),
      resign: [...document.querySelectorAll(".agent-card .btn")].some((b) => /Let them go/.test(b.textContent)),
    }));
    check("the Requisitions page opens with the hire on the books",
      roster.title === "Requisitions" && roster.cards === 1, roster);
    check("an agent carries its own learning, and a way to let it go",
      roster.learn && roster.deploy && roster.resign, roster);

    await live(app, () => document.querySelector(".agent-deploy .btn").click());
    await app.page.waitForTimeout(500);
    const dialog = await live(app, () => ({
      title: (document.querySelector(".modal-title") || {}).textContent,
      drops: document.querySelectorAll(".drop-btn").length,
      selects: document.querySelectorAll(".modal select").length,
      plan: (document.querySelector(".ap-plan") || {}).textContent,
      panel: document.querySelectorAll(".drop-panel").length,
    }));
    check("the deploy dialog opens rather than throwing",
      /Send an Agent out/.test(dialog.title || ""), dialog);
    check("both lists are the game's own, and no native select is left",
      dialog.drops === 2 && dialog.selects === 0 && dialog.panel === 0, dialog);
    check("and the plan reads a count of something, not NaN of undefined",
      /^\d[\d,]* × \S/.test((dialog.plan || "").trim()), dialog);

    // The list opens on the body so a scrolling modal cannot clip it, and picking closes it.
    await live(app, () => document.querySelectorAll(".drop-btn")[1].click());
    await app.page.waitForTimeout(250);
    const opened = await live(app, () => ({
      onBody: !!document.body.querySelector(":scope > .drop-panel"),
      opts: document.querySelectorAll(".drop-opt").length,
      groups: document.querySelectorAll(".drop-group").length,
      marked: document.querySelectorAll(".drop-opt.is-on").length,
      expanded: document.querySelectorAll('.drop-btn[aria-expanded="true"]').length,
    }));
    check("the list hangs off the body, grouped, with one option marked",
      opened.onBody && opened.opts > 1 && opened.groups >= 1 && opened.marked === 1 && opened.expanded === 1, opened);

    const before = await live(app, () => document.querySelectorAll(".drop-btn")[1].textContent.trim());
    await live(app, () => {
      const opts = [...document.querySelectorAll(".drop-opt")];
      (opts.find((o) => o.getAttribute("aria-selected") !== "true") || opts[0]).click();
    });
    await app.page.waitForTimeout(300);
    const picked = await live(app, () => ({
      face: document.querySelectorAll(".drop-btn")[1].textContent.trim(),
      panels: document.querySelectorAll(".drop-panel").length,
      plan: (document.querySelector(".ap-plan") || {}).textContent,
    }));
    check("picking shuts the list and writes the choice onto the field",
      picked.panels === 0 && picked.face !== before, { before, ...picked });
    check("and the plan follows what was picked", /^\d[\d,]* × \S/.test((picked.plan || "").trim()), picked);

    /* Escape belongs to the open list, not to the dialog under it: the first one
       shuts the list, the second shuts the dialog. */
    await live(app, () => document.querySelectorAll(".drop-btn")[0].click());
    await app.page.waitForTimeout(250);
    await app.page.keyboard.press("Escape");
    await app.page.waitForTimeout(250);
    const afterFirst = await live(app, () => ({
      panels: document.querySelectorAll(".drop-panel").length,
      modal: !!document.querySelector(".modal-title"),
    }));
    check("Escape shuts the list and leaves the dialog standing",
      afterFirst.panels === 0 && afterFirst.modal, afterFirst);
    await app.page.keyboard.press("Escape");
    await app.page.waitForTimeout(350);
    check("a second Escape shuts the dialog",
      !(await live(app, () => !!document.querySelector(".modal-title"))));
  }

  section("nothing went wrong");
  check("no page or popup errors in any of it", errs().length === 0, errs().slice(0, 4));

  await browser.close().catch(() => {});
  await stack.close().catch(() => {});
});
