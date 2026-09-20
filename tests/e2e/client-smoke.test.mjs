/* ============================================================
   Respite · tests/e2e/client-smoke.test.mjs · The First Night
   ------------------------------------------------------------
   The real app through index.html on the stage: main.js, the
   store, net and the shell, end to end against the real handler.

     guest boot, an account made through net.signUp, sync, a
     command that survives a reload, a market trade between two
     players, a party through net.party with a realtime poke,
     and a phone width without sideways scroll.

   Pages are other people's work in progress: nothing here looks
   inside #view past "something mounted", and errors raised from
   src/client/pages or src/client/ui/popups are listed as NOTE
   lines instead of failing the run. Everything else must be clean.

     node tests/e2e/client-smoke.test.mjs
   ============================================================ */

import {
  run, check, same, section, sleep, waitFor, MINUTE,
  startStack, launch, openApp, signUp, waitForSync, dispatch, storeStatus,
  sql, editSave, put, advanceServer, overflowX, wideElements, shot, repoHas,
} from "./lib.mjs";

// Page and popup code by path, or by the router's own words about a page it could not run.
import { CONFIG } from "../../src/shared/config.js";

const ENGINE_SCHEMA = CONFIG.schema;

const PAGE_CODE = /src\/client\/(pages|ui\/popups)\/|router: pages\//;
const held = (state, key) => ["inv", "bank", "vault"].reduce((n, w) => n + ((state && state[w].items[key]) || 0), 0);

// Reads from the page's live store (main.js may swap the store when the account changes).
const live = (app, fn, arg) => app.page.evaluate(fn, arg);
const storeState = (app) => live(app, () => window.__respite.store.state);

async function booted(app, { timeout = 20000 } = {}) {
  try {
    await app.page.waitForFunction(() => {
      const r = window.__respite;
      return !!(r && r.store && r.net && r.ctx && typeof r.go === "function");
    }, null, { timeout });
  } catch (e) {
    throw new Error(`window.__respite never appeared (RESPITE_DEV is set by the stage); page errors: ${JSON.stringify(app.errors)}`);
  }
}

async function accountMode(app, username, timeout = 15000) {
  await app.page.waitForFunction((name) => {
    const s = window.__respite && window.__respite.store;
    return !!s && s.mode === "account" && s.account().username === name;
  }, username, { timeout });
}

async function serverSave(stack, username) {
  const rows = await sql(stack, "select data, rev::int as rev from public.saves where username = $1", [username]);
  return rows[0] || null;
}

const bannerText = (app) => live(app, () => (document.getElementById("bannerDock") || { textContent: "" }).textContent);

await run(async () => {
  section("the client is here");
  if (!check("src/client/main.js exists", repoHas("src/client/main.js"))) return;

  const stack = await startStack();
  const browser = await launch();
  const apps = [];
  const open = async (options) => {
    const app = await openApp(browser, { url: `${stack.url}/`, ...options });
    apps.push(app);
    return app;
  };

  try {
    /* ---------------------------------------------------------- */
    section("a guest boots");

    const G = await open();
    await booted(G);
    same("the store starts as a guest", await live(G, () => [window.__respite.store.mode, window.__respite.store.status.conn]), ["guest", "guest"]);
    check("net is enabled: the fake supabase-js is configured", await live(G, () => window.__respite.net.enabled === true));
    await G.page.waitForFunction(() => !document.getElementById("boot") && document.getElementById("view").children.length > 0, null, { timeout: 10000 })
      .then(() => check("the router mounted something over the boot screen", true))
      .catch(() => check("the router mounted something over the boot screen", false, "still #boot after 10s"));
    await waitFor("the guest banner", async () => /guest/i.test(await bannerText(G)), { timeout: 5000 })
      .then(() => check("the guest banner is up", true))
      .catch(async () => check("the guest banner is up", false, await bannerText(G)));
    same("the connection chip says guest", await live(G, () => document.getElementById("tbConn").dataset.state), "guest");
    same("a guest cannot trade", await dispatch(G.page, "marketList", { key: "slag_delve", from: "bank", qty: 1, price: 1 }), { ok: false, error: "Sign in to trade." });
    await sleep(1500);
    await shot(G.page, "smoke-guest-desktop");

    /* ---------------------------------------------------------- */
    section("an account");

    const A = await open();
    await booted(A);
    same("net.signUp makes the account", await signUp(A.page, "smoke_a", "embers1"), null);
    await accountMode(A, "smoke_a").then(() => check("the store switches to account mode as smoke_a", true))
      .catch(async () => check("the store switches to account mode as smoke_a", false, await storeStatus(A.page)));
    await waitForSync(A.page);
    check("and syncs: online, nothing pending, a current-schema save from the server", await live(A, (schema) => {
      const s = window.__respite.store;
      return s.status.conn === "online" && s.status.pending === 0 && s.state.schema === schema && s.state.meta.account === "smoke_a" && s.status.lastSyncAt > 0;
    }, ENGINE_SCHEMA));
    const firstSave = await serverSave(stack, "smoke_a");
    check("the server holds smoke_a's save", !!firstSave && firstSave.rev >= 1, firstSave && firstSave.rev);
    same("net.session() names the player", await live(A, async () => {
      const s = await window.__respite.net.session();
      return s && [s.username, typeof s.userId, typeof s.token];
    }), ["smoke_a", "string", "string"]);
    await waitFor("the guest banner to go", async () => !/guest/i.test(await bannerText(A)), { timeout: 5000 })
      .then(() => check("the guest banner is gone", true))
      .catch(async () => check("the guest banner is gone", false, await bannerText(A)));
    check("the connection chip left guest", (await live(A, () => document.getElementById("tbConn").dataset.state)) !== "guest");

    /* ---------------------------------------------------------- */
    section("a command survives a reload");

    const started = await dispatch(A.page, "startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: null });
    same("startSkill is predicted at once", [started.ok, (await storeState(A)).tasks.skilling && (await storeState(A)).tasks.skilling.actionId], [true, "delving_t1_raw"]);
    await waitForSync(A.page);
    await waitFor("the server save to hold the task", async () => {
      const row = await serverSave(stack, "smoke_a");
      return row && row.data.tasks.skilling && row.data.tasks.skilling.actionId === "delving_t1_raw";
    }, { timeout: 8000 }).then(() => check("the batch reached the server", true)).catch((e) => check("the batch reached the server", false, e.message));

    // A change only the server could make: if the reloaded page shows it, the state came from the server.
    await editSave(stack, "smoke_a", (s) => { s.player.gold = 4321; });
    await A.page.reload();
    await booted(A);
    await accountMode(A, "smoke_a").catch(() => {});
    await waitForSync(A.page);
    const reloaded = await storeState(A);
    same("after a reload the session holds and the server's save comes back with the task", [
      await live(A, () => window.__respite.store.mode),
      reloaded.tasks.skilling && reloaded.tasks.skilling.actionId,
      reloaded.player.gold,
    ], ["account", "delving_t1_raw", 4321]);

    await advanceServer(stack, 20 * MINUTE);
    await live(A, () => window.__respite.store.sync());
    await waitFor("the store to adopt twenty minutes of server time", async () => {
      const s = await storeState(A);
      return s && s.tasks.skilling && s.tasks.skilling.done >= 50;
    }, { timeout: 10000 }).then(() => check("twenty minutes on the server clock reach the page after a sync", true))
      .catch(async () => check("twenty minutes on the server clock reach the page after a sync", false, { status: await storeStatus(A.page), done: ((await storeState(A)).tasks.skilling || {}).done }));

    /* ---------------------------------------------------------- */
    section("two players trade");

    await waitForSync(A.page);
    await editSave(stack, "smoke_a", (s) => put(s, "bank", "slag_delve", 50));
    await live(A, () => window.__respite.store.sync());
    await waitFor("A to see the seeded ore", async () => held(await storeState(A), "slag_delve") >= 50, { timeout: 8000 });
    const oreA = held(await storeState(A), "slag_delve");
    const listed = await dispatch(A.page, "marketList", { key: "slag_delve", from: "bank", qty: 20, price: 5 });
    check("A lists 20 Slag Ore at 5 through dispatch", listed.ok === true && Number.isInteger(listed.data && listed.data.listingId), listed);
    const listingId = listed.data && listed.data.listingId;
    same("the ore leaves A's camp", held(await storeState(A), "slag_delve"), oreA - 20);

    const B = await open();
    await booted(B);
    same("B signs up", await signUp(B.page, "smoke_b", "hollow1"), null);
    await accountMode(B, "smoke_b");
    await waitForSync(B.page);
    await editSave(stack, "smoke_b", (s) => { s.player.gold = 500; });
    await live(B, () => window.__respite.store.sync());
    await waitFor("B's gold", async () => (await storeState(B)).player.gold === 500, { timeout: 8000 });

    // Ore is a pool: browse answers for gear and tools, pools for materials, and neither
    // carries a name. B never learns that it was A who listed it.
    const browse = await live(B, () => window.__respite.net.market.browse({ q: "slag" }));
    same("net.market.browse returns no material listing at all", [browse.error, browse.rows], [null, []]);
    const pools = await live(B, () => window.__respite.net.market.pools({ q: "slag" }));
    check("B finds the ore as a pool through net.market.pools",
      pools.error === null && pools.rows.length === 1 && pools.rows[0].item_key === "slag_delve"
      && Number(pools.rows[0].qty_left) === 20 && Number(pools.rows[0].price_min) === 5, pools);
    check("and nothing in the answer names the seller", !/seller|user_id|smoke_a/i.test(JSON.stringify(pools.rows)), pools.rows);
    const bought = await dispatch(B.page, "marketBuyPool", { key: "slag_delve", qty: 8, maxEach: 5 });
    same("B buys 8 out of the pool through dispatch", [bought.ok, bought.data],
      [true, { key: "slag_delve", qty: 8, cost: 42, fee: 2, asked: 8, short: false }]);
    const stateB = await storeState(B);
    same("B paid 40 for the ore and 2 to the market", [stateB.player.gold, held(stateB, "slag_delve")], [458, 8]);

    await live(A, () => {
      window.__news = [];
      window.__respite.store.bus.on("store:news", (e) => window.__news.push(e));
    });
    const goldBefore = (await storeState(A)).player.gold;
    await live(A, () => window.__respite.store.sync());
    await waitFor("A's post", async () => (await storeState(A)).player.gold === goldBefore + 38, { timeout: 8000 })
      .then(() => check("A is paid by post on the next sync: 40 less a 2 gold fee", true))
      .catch(async () => check("A is paid by post on the next sync: 40 less a 2 gold fee", false, [(await storeState(A)).player.gold, goldBefore]));
    same("and the store tells it as news", await live(A, () => window.__news.filter((e) => e.type === "mail:claimed").map((e) => e.gold)), [38]);
    const mine = await live(A, () => window.__respite.net.market.mine());
    same("net.market.mine shows the listing with 12 left", mine.rows.filter((r) => r.id === listingId).map((r) => [r.qty_left, r.status]), [[12, "open"]]);
    same("net.market.sales shows each side its own half of the trade", [
      (await live(A, () => window.__respite.net.market.sales())).rows.map((r) => [r.side, r.qty, Number(r.fee)]),
      (await live(B, () => window.__respite.net.market.sales())).rows.map((r) => [r.side, r.qty, Number(r.fee)]),
    ], [[["sold", 8, 2]], [["bought", 8, 2]]]);
    check("and neither half names the other party",
      !/seller|buyer|user_id|smoke_a|smoke_b/i.test(JSON.stringify((await live(B, () => window.__respite.net.market.sales())).rows)),
      (await live(B, () => window.__respite.net.market.sales())).rows);

    /* ---------------------------------------------------------- */
    section("a party through net.party");

    const created = await live(A, () => window.__respite.net.party.create("Smoke Watch"));
    check("A creates a party", created.error === null && typeof created.data === "string", created);
    const invite = await live(A, () => window.__respite.net.party.invite("smoke_b"));
    check("A invites smoke_b", invite.error === null && Number.isInteger(invite.data), invite);
    same("a refusal comes back as the RPC's sentence", (await live(B, () => window.__respite.net.party.invite("smoke_a"))).error, "You are not in a party.");
    await waitFor("B's store to hear the invite", async () => {
      const p = await live(B, () => window.__respite.store.refreshParty());
      return p && p.invites_in && p.invites_in.length === 1;
    }, { timeout: 8000 });
    same("B's store.party carries the invite", await live(B, () => window.__respite.store.party.invites_in.map((i) => [i.party_name, i.from_name])), [["Smoke Watch", "smoke_a"]]);
    const accepted = await live(B, (id) => window.__respite.net.party.respond(id, true), invite.data);
    same("B accepts", accepted.error, null);
    await live(B, () => window.__respite.store.refreshParty());
    await live(A, () => window.__respite.store.refreshParty());
    same("both stores see both members", [
      await live(A, () => window.__respite.store.party.members.map((m) => m.username)),
      await live(B, () => window.__respite.store.party.members.map((m) => m.username)),
      await live(B, () => window.__respite.ctx.party === window.__respite.store.party),
    ], [["smoke_a", "smoke_b"], ["smoke_a", "smoke_b"], true]);

    await sleep(1500);   // the store subscribes after it learns the party; give the channel a poll to join
    const saidAt = Date.now();
    const said = await live(A, () => window.__respite.net.party.say("Smoke rises."));
    check("A says something", said.error === null, said);
    await waitFor("B's store to show the message without being asked", async () => {
      const bodies = await live(B, () => ((window.__respite.store.party || {}).messages || []).map((m) => m.body));
      return bodies.includes("Smoke rises.");
    }, { timeout: 8000 })
      .then(() => check("a realtime poke brings the message to B's store", true, Date.now() - saidAt))
      .catch(() => check("a realtime poke brings the message to B's store", false, "not within 8s"));
    console.log(`     (poke to store: ${Date.now() - saidAt}ms)`);

    /* ---------------------------------------------------------- */
    section("a phone");

    const P = await open({ viewport: { width: 390, height: 844 } });
    await booted(P);
    await P.page.waitForFunction(() => !document.getElementById("boot"), null, { timeout: 10000 }).catch(() => {});
    await sleep(800);
    const guestWide = await overflowX(P.page);
    check("a guest at 390x844 has no horizontal overflow", guestWide === 0, { px: guestWide, culprits: await wideElements(P.page) });
    await shot(P.page, "smoke-guest-phone");

    await B.page.setViewportSize({ width: 390, height: 844 });
    await sleep(800);
    const accountWide = await overflowX(B.page);
    check("an account in a party at 390x844 has no horizontal overflow", accountWide === 0, { px: accountWide, culprits: await wideElements(B.page) });
    await shot(B.page, "smoke-account-phone");
    await shot(A.page, "smoke-account-desktop");

    /* ---------------------------------------------------------- */
    section("signing out");

    await live(B, () => window.__respite.net.signOut());
    await B.page.waitForFunction(() => window.__respite.store && window.__respite.store.mode === "guest", null, { timeout: 10000 })
      .then(() => check("net.signOut puts a guest camp in the store", true))
      .catch(async () => check("net.signOut puts a guest camp in the store", false, await storeStatus(B.page)));
    same("the session is gone and the chip says guest", [
      await live(B, () => window.__respite.net.session()),
      await live(B, () => document.getElementById("tbConn").dataset.state),
    ], [null, "guest"]);
    await waitFor("the guest banner", async () => /guest/i.test(await bannerText(B)), { timeout: 5000 })
      .then(() => check("the guest banner is back", true))
      .catch(async () => check("the guest banner is back", false, await bannerText(B)));

    /* ---------------------------------------------------------- */
    section("an old page meets a newer server");

    // Kept out of `apps`: this page's 409s are the point, so its errors are checked here instead.
    const O = await openApp(browser, { url: `${stack.url}/` });
    try {
      await booted(O);
      same("O signs up on the current engine", await signUp(O.page, "smoke_o", "embers1"), null);
      await accountMode(O, "smoke_o");
      await waitForSync(O.page);
      const engine = (await (await fetch(`${stack.url}/dev/health`)).json()).engine;
      check("the stage reports its engine", Number.isInteger(engine) && engine >= 2, engine);

      // The browser holds an older copy of the rules: its first sync must be turned away.
      const OLD = "**/src/shared/version.js";
      await O.page.route(OLD, (route) => route.fulfill({
        status: 200,
        contentType: "text/javascript; charset=utf-8",
        headers: { "cache-control": "no-store" },
        body: `export const ENGINE_VERSION = ${engine - 1};\n`,
      }));
      await O.page.reload();
      await booted(O);
      await O.page.waitForFunction(() => window.__respite.store.status.conn === "outdated", null, { timeout: 15000 })
        .then(() => check("an older page's sync comes back outdated", true))
        .catch(async () => check("an older page's sync comes back outdated", false, await storeStatus(O.page)));
      await waitFor("the outdated banner", async () => /A new version of the camp is out/.test(await bannerText(O)), { timeout: 5000 })
        .then(() => check("the outdated banner is up", true))
        .catch(async () => check("the outdated banner is up", false, await bannerText(O)));
      same("with Reload, and the chip says Outdated", await live(O, () => [
        [...document.querySelectorAll("#bannerDock .btn")].map((b) => b.textContent.trim()).includes("Reload"),
        document.getElementById("tbConnText").textContent,
      ]), [true, "Outdated"]);
      same("a trade is refused without asking the server", await dispatch(O.page, "marketList", { key: "slag_delve", from: "bank", qty: 1, price: 1 }),
        { ok: false, error: "A new version of the camp is out. Reload to carry on." });
      let asked = 0;
      const count = (req) => { if (req.url().includes("/functions/v1/game")) asked++; };
      O.page.on("request", count);
      await live(O, () => window.__respite.store.sync());
      await sleep(2500);
      O.page.off("request", count);
      same("an outdated store stops asking", asked, 0);
      await shot(O.page, "smoke-outdated");

      // The new rules are out: Reload picks them up and the camp carries on.
      await O.page.unroute(OLD);
      await Promise.all([O.page.waitForEvent("load"), O.page.click("#bannerDock .btn-primary")]);
      await booted(O);
      await accountMode(O, "smoke_o");
      await waitForSync(O.page)
        .then(() => check("after Reload the page syncs on the current engine", true))
        .catch(async () => check("after Reload the page syncs on the current engine", false, await storeStatus(O.page)));
      await waitFor("the outdated banner to go", async () => !/new version/.test(await bannerText(O)), { timeout: 5000 })
        .then(() => check("and the outdated banner is gone", true))
        .catch(async () => check("and the outdated banner is gone", false, await bannerText(O)));
      const unexpected = O.errors.filter((e) => !/409/.test(e) && !PAGE_CODE.test(e));
      same("the only errors on that page were the 409s", unexpected, []);
      same("and the only failed requests", [...new Set(O.failures.filter((f) => !/^409 /.test(f) && !PAGE_CODE.test(f)))], []);
    } finally {
      await O.close().catch(() => {});
    }

    /* ---------------------------------------------------------- */
    section("nothing went wrong");

    same("the stage logged no errors", stack.errors, []);
    const all = apps.flatMap((x) => x.errors);
    const pageErrors = all.filter((e) => PAGE_CODE.test(e));
    const coreErrors = all.filter((e) => !PAGE_CODE.test(e));
    same("no console or page errors from the core, the shell or the harness", coreErrors, []);
    for (const e of [...new Set(pageErrors)]) console.log(`NOTE page or popup still settling: ${e.split("\n")[0]}`);
    const missing = apps.flatMap((x) => x.failures).filter((f) => !PAGE_CODE.test(f));
    same("no local request failed outside pages and popups", [...new Set(missing)], []);
  } finally {
    await browser.close().catch(() => {});
    await stack.close().catch(() => {});
  }
});
