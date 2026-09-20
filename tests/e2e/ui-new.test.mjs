/* What these batches added, opened in a real browser: the skin a fresh camp
   picks and the face it puts on every page, the Discipline page's two tabs, a
   path spending a point, weapon mastery ranked by the realm, a commander anyone
   can look up, and the Veilsmith's dialog off an item.

     node tests/e2e/ui-new.test.mjs */

import { run, check, same, section, startStack, launch, openApp, signUp, waitForSync, dispatch, editSave, put } from "./lib.mjs";

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
      put(s, "vault", "slag_sword|rare|c1.2", 1);
      put(s, "bank", "lesser_veil_essence", 40);
    });
    await live(app, () => window.__respite.store.sync());
    await app.page.waitForTimeout(1200);
    await dispatch(app.page, "pickClass", { id: "warrior" });
    await app.page.waitForTimeout(400);

    await go("#/discipline");
    await live(app, () => [...document.querySelectorAll("[role=tab]")].find((t) => /Path/.test(t.textContent)).click());
    await app.page.waitForTimeout(400);
    const nodes = await live(app, () => [...document.querySelectorAll(".path-node")].map((n) => n.dataset.node));
    same("ten nodes, all of them the Warrior's", nodes.length, 10);
    check("and none of them another discipline's", nodes.every((id) => id.startsWith("wr_")), nodes);
    const before = await live(app, () => window.__respite.store.state.path || {});
    await live(app, () => document.querySelector('.path-node[data-node="wr_ironhide"] button[data-node]').click());
    await app.page.waitForTimeout(700);
    const after = await live(app, () => window.__respite.store.state.path || {});
    check("pressing one spends a point", (after.wr_ironhide || 0) > (before.wr_ironhide || 0), { before, after });
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
    check("and it says how a line is learned at all", /a kill teaches your off-hand/.test(detail.text), detail.text.slice(0, 160));

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
      const i = document.querySelector(".pp-bust img");
      return i ? i.getAttribute("src") : null;
    });
    check("and wears their skin", /skin-outrider\.webp$/.test(bust || ""), bust);
    const worn = await live(app, () => [...document.querySelectorAll(".pp-slots .slot")].length);
    same("Standing lays out all eight slots", worn, 8);

    await live(app, () => [...document.querySelectorAll("[role=tab]")].find((t) => /Skills/.test(t.textContent)).click());
    await app.page.waitForTimeout(400);
    const skills = await live(app, () => [...document.querySelectorAll(".skills-grid .skill-card")].length);
    check("and Skills lists every one of them", skills === 11, skills);

    await go("#/player/nobodyatall");
    await app.page.waitForTimeout(2000);
    const none = await live(app, () => document.querySelector(".page").textContent);
    check("a name nobody answers to says so plainly", /No such commander/.test(none), none.slice(0, 160));
  }

  section("the Veilsmith");
  {
    await go("#/stockpile");
    // The popup is opened by name through the page's own ctx, as the item card does.
    const opened = await app.page.evaluate(async () => {
      const mod = await import("/src/client/ui/widgets.js");
      mod.openPopup("item", window.__respite.ctx, "slag_sword|rare|c1.2", { from: "vault" });
      return !!document.querySelector(".modal-title");
    });
    check("the item dialog opens on a piece of gear", opened);
    const label = await live(app, () => {
      const b = [...document.querySelectorAll(".modal-foot .btn, .modal .btn")].find((x) => /Work the Veil/.test(x.textContent));
      return b ? b.textContent : null;
    });
    check("and offers to work the Veil into it", !!label && /\+0/.test(label), label);
    await live(app, () => [...document.querySelectorAll(".modal .btn")].find((x) => /Work the Veil/.test(x.textContent)).click());
    await app.page.waitForTimeout(500);
    const smith = await live(app, () => {
      const t = [...document.querySelectorAll(".modal-title")].map((n) => n.textContent).join("|");
      const rows = [...document.querySelectorAll("[data-stones]")].map((r) => r.textContent);
      return { t, rows };
    });
    check("the Veilsmith opens with its three stone counts", /Work the Veil/.test(smith.t) && smith.rows.length === 3, smith);
    check("and the odds read 80 / 95 / 100 on a bare piece",
      smith.rows.join(" ").includes("80%") && smith.rows.join(" ").includes("95%") && smith.rows.join(" ").includes("100%"), smith.rows);
  }

  section("nothing went wrong");
  check("no page or popup errors in any of it", errs().length === 0, errs().slice(0, 4));

  await browser.close().catch(() => {});
  await stack.close().catch(() => {});
});
