/* The three rooms this batch added, opened in a real browser: the Discipline
   page's two tabs, the Veilsmith's dialog off an item, and the likeness picker
   a fresh camp is asked for.

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

  section("a fresh camp is asked who it is");
  {
    await go("#/character");
    const asked = await live(app, () => !!document.querySelector(".modal-title") && /Who are you/.test(document.querySelector(".modal-title").textContent));
    check("the likeness picker opens on the Character page", asked);
    const names = await live(app, () => [...document.querySelectorAll(".modal .class-name")].map((n) => n.textContent));
    same("and offers both", names, ["Man", "Woman"]);
    await live(app, () => [...document.querySelectorAll(".modal .class-card")][1].click());
    await app.page.waitForTimeout(500);
    const sex = await live(app, () => window.__respite.store.state.player.sex);
    same("choosing one sets it on the save", sex, "female");
    const gone = await live(app, () => !document.querySelector(".modal-title"));
    check("and the picker closes", gone);
  }

  section("the Discipline page");
  {
    await go("#/discipline");
    const body = await text();
    check("it mounts, and is not the router's fallback card", !/still being built|fell over/.test(body), body.slice(0, 120));
    await live(app, () => [...document.querySelectorAll("[role=tab]")].find((t) => /Mastery/.test(t.textContent)).click());
    await app.page.waitForTimeout(300);
    const rows = await live(app, () => [...document.querySelectorAll("[data-line]")].map((r) => r.dataset.line));
    same("seven weapon rows, in the page's order", rows, ["sword", "shield", "dagger", "bow", "staff", "greatsword", "grimoire"]);
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
