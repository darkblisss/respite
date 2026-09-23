/* ============================================================
   Respite · tests/e2e/harness.test.mjs · The Dress Rehearsal
   ------------------------------------------------------------
   Proves the stage (dev/server.mjs) and the fake supabase-js
   (dev/fake-supabase.js) before any client code leans on them.
   Two players, each in their own browser context on
   dev/harness-check.html, go through the surface net.js uses:
   accounts, the game function, the market and the post, RLS,
   a party with chat and realtime, presence, hiscores, and the
   stage's clock.

     node tests/e2e/harness.test.mjs
   ============================================================ */

import { ENGINE_VERSION } from "../../src/shared/version.js";
import { CONFIG } from "../../src/shared/config.js";
import { startDevServer } from "../../dev/server.mjs";
import {
  run, check, same, section, sleep, waitFor, HOUR,
  startStack, launch, openApp, sql, editSave, put, advanceServer, userIdOf,
} from "./lib.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// window.harness.<method>(...args) in that player's page.
const call = (app, method, ...args) => app.page.evaluate(([m, a]) => window.harness[m](...a), [method, args]);
const cmd = (type, args = {}) => ({ id: `${type}_${Math.random().toString(36).slice(2, 8)}`, type, args, at: Date.now() });
const held = (state, key) => ["inv", "bank", "vault"].reduce((n, w) => n + (state[w].items[key] || 0), 0);

await run(async () => {
  const stack = await startStack();
  const browser = await launch();
  const apps = [];
  try {
    /* ---------------------------------------------------------- */
    section("the stage serves the repo");

    const index = await fetch(`${stack.url}/`);
    const html = await index.text();
    check("GET / is html and never cached", index.status === 200 && /text\/html/.test(index.headers.get("content-type")) && index.headers.get("cache-control") === "no-store");
    check("the supabase-js script tag becomes dev/fake-supabase.js", html.includes('<script src="dev/fake-supabase.js"></script>') && !/cdn\.jsdelivr\.net\/npm\/@supabase/.test(html));
    check("RESPITE_SUPABASE_URL is the stage's origin and the real project is gone", html.includes(`window.RESPITE_SUPABASE_URL = "${stack.url}"`) && !/supabase\.co/.test(html));
    const devAt = html.indexOf("window.RESPITE_DEV = true");
    check("RESPITE_DEV is set before main.js loads", devAt > 0 && devAt < html.indexOf("src/client/main.js"));
    same("/index.html is rewritten the same way", await (await fetch(`${stack.url}/index.html`)).text(), html);

    const types = {};
    for (const path of ["/src/shared/version.js", "/css/tokens.css", "/assets/respite-logo.webp", "/dev/harness-check.html", "/tests/e2e/lib.mjs"]) {
      const res = await fetch(`${stack.url}${path}`);
      types[path] = [res.status, res.headers.get("content-type"), res.headers.get("cache-control")];
    }
    same("static files carry their types and no caching", types, {
      "/src/shared/version.js": [200, "text/javascript; charset=utf-8", "no-store"],
      "/css/tokens.css": [200, "text/css; charset=utf-8", "no-store"],
      "/assets/respite-logo.webp": [200, "image/webp", "no-store"],
      "/dev/harness-check.html": [200, "text/html; charset=utf-8", "no-store"],
      "/tests/e2e/lib.mjs": [200, "text/javascript; charset=utf-8", "no-store"],
    });
    const outside = [];
    for (const path of ["/%2e%2e/%2e%2e/etc/passwd", "/.github/workflows/deploy-game.yml", "/nope.js"]) outside.push((await fetch(`${stack.url}${path}`)).status);
    same("nothing outside the repo, no dotfiles, 404 for the missing", outside, [404, 404, 404]);

    const health = await (await fetch(`${stack.url}/dev/health`)).json();
    check("health names the engine, the realtime tables and the RPCs", health.ok && health.engine === ENGINE_VERSION
      && ["party_invites", "party_members", "party_messages"].every((t) => health.realtime.includes(t))
      && ["heartbeat", "online_count", "hiscores", "party_state", "party_say"].every((f) => health.rpc.includes(f)), health);

    const pre = await fetch(`${stack.url}/functions/v1/game`, { method: "OPTIONS" });
    same("a preflight to the game function is 204 with the wrapper's CORS", [pre.status, pre.headers.get("access-control-allow-origin"), pre.headers.get("access-control-allow-headers")],
      [204, "*", "authorization, x-client-info, apikey, content-type"]);

    const shut = await startDevServer({ port: 0 });
    try {
      const res = await fetch(`${shut.url}/dev/sql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "select 1" }) });
      const body = await res.json();
      check("/dev/sql is refused unless the stage allows it", res.status === 403 && /allow-sql/.test(body.error.message), [res.status, body]);
    } finally {
      await shut.close();
    }

    /* ---------------------------------------------------------- */
    section("accounts through the fake client");

    const page = `${stack.url}/dev/harness-check.html`;
    const A = await openApp(browser, { url: page });
    const B = await openApp(browser, { url: page });
    apps.push(A, B);
    await A.page.waitForFunction(() => window.harness);
    await B.page.waitForFunction(() => window.harness);

    const a = await call(A, "signUp", "ashen", "embers1");
    check("a new player signs up with a session", a.error === null && UUID.test(a.userId) && typeof a.session.access_token === "string", a);
    same("the session is { access_token, user: { id, email } }", [a.session.user.id, a.session.user.email], [a.userId, "ashen@players.respite"]);
    await waitFor("INITIAL_SESSION and SIGNED_IN", () => A.page.evaluate(() => window.harness.events.length >= 2));
    same("onAuthStateChange saw INITIAL_SESSION (signed out) then SIGNED_IN", await A.page.evaluate(() => window.harness.events.map((e) => [e.event, !!e.userId])),
      [["INITIAL_SESSION", false], ["SIGNED_IN", true]]);

    same("a taken email is refused the way Supabase says it", (await call(B, "signUp", "ashen", "other12")).error, "User already registered");
    same("a short password is refused the way Supabase says it", (await call(B, "signUp", "bram", "123")).error, "Password should be at least 6 characters.");
    const b = await call(B, "signUp", "bram", "hollow1");
    check("the second player signs up", b.error === null && UUID.test(b.userId) && b.userId !== a.userId, b);

    const stored = await A.page.evaluate(() => [window.harness.storageKey, JSON.parse(localStorage.getItem(window.harness.storageKey))]);
    check("the session is kept in localStorage under sb-<ref>-auth-token", stored[0] === "sb-127-auth-token" && !!stored[1] && stored[1].access_token === a.session.access_token, stored[0]);
    await A.page.reload();
    await A.page.waitForFunction(() => window.harness && window.harness.events.length >= 1);
    same("after a reload getSession gives the same player and INITIAL_SESSION carries it",
      [(await call(A, "session")).session.user.id, await A.page.evaluate(() => window.harness.events[0])],
      [a.userId, { event: "INITIAL_SESSION", userId: a.userId, email: "ashen@players.respite" }]);

    const oldToken = b.session.access_token;
    await call(B, "signOut");
    same("signing out clears the session and says SIGNED_OUT", [(await call(B, "session")).session, await B.page.evaluate(() => window.harness.events.at(-1).event)], [null, "SIGNED_OUT"]);
    same("a wrong password is refused the way Supabase says it", (await call(B, "signIn", "bram", "hollow2")).error, "Invalid login credentials");
    const b2 = await call(B, "signIn", "bram", "hollow1");
    check("signing in again works, with a new token, and says SIGNED_IN", b2.error === null && b2.userId === b.userId && b2.session.access_token !== oldToken
      && (await B.page.evaluate(() => window.harness.events.at(-1).event)) === "SIGNED_IN", b2);

    // Two tabs of one browser share the stored session, as with supabase-js.
    const D = await openApp(browser, { url: page });
    apps.push(D);
    const tab2 = await D.context.newPage();
    tab2.on("console", (msg) => { if (msg.type() === "error") D.errors.push(`console (tab 2): ${msg.text()}`); });
    tab2.on("pageerror", (err) => D.errors.push(`pageerror (tab 2): ${err}`));
    await tab2.goto(page);
    await D.page.waitForFunction(() => window.harness);
    await tab2.waitForFunction(() => window.harness && window.harness.events.length === 1);
    const tabEvents = () => tab2.evaluate(() => window.harness.events.map((e) => e.event));
    const dusk = await call(D, "signUp", "dusk", "dusk123");
    await waitFor("tab 2 to hear the sign in", async () => (await tabEvents()).length === 2, { timeout: 5000 });
    same("a sign in in one tab reaches the other as SIGNED_IN", [await tabEvents(), await tab2.evaluate(() => window.harness.session().then((s) => s.session.user.id))], [["INITIAL_SESSION", "SIGNED_IN"], dusk.userId]);
    await D.page.evaluate(() => {
      const key = window.harness.storageKey;
      const s = JSON.parse(localStorage.getItem(key));
      s.expires_at = Math.floor(Date.now() / 1000) - 10;
      localStorage.setItem(key, JSON.stringify(s));
    });
    await sleep(300);
    const fresh = await call(D, "session");
    check("a stale expires_at is moved on and the token kept", fresh.session.expires_at > Date.now() / 1000 + 3000 && fresh.session.access_token === dusk.session.access_token, fresh.session.expires_at);
    await sleep(300);
    same("and the other tab hears nothing of it", await tabEvents(), ["INITIAL_SESSION", "SIGNED_IN"]);
    await call(D, "signOut");
    await waitFor("tab 2 to hear the sign out", async () => (await tabEvents()).length === 3, { timeout: 5000 });
    same("a sign out reaches the other tab as SIGNED_OUT", [(await tabEvents())[2], (await tab2.evaluate(() => window.harness.session())).session], ["SIGNED_OUT", null]);

    /* ---------------------------------------------------------- */
    section("the game function");

    const gameA = await call(A, "game", []);
    check("player A's first call makes a current-schema save for ashen", gameA.status === 200 && gameA.body.ok && gameA.body.state.schema === CONFIG.schema && gameA.body.state.meta.account === "ashen" && gameA.cors === "*", gameA.status);
    const gameB = await call(B, "game", []);
    check("player B's for bram", gameB.status === 200 && gameB.body.state.schema === CONFIG.schema && gameB.body.state.meta.account === "bram" && gameB.body.state.meta.userId === b.userId, gameB.status);

    const direct = async (token, body) => {
      const res = await fetch(`${stack.url}/functions/v1/game`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      return [res.status, await res.json()];
    };
    same("no token is unauthorized", await direct(null, { v: ENGINE_VERSION, commands: [] }), [401, { ok: false, error: "unauthorized" }]);
    same("a signed out token is unauthorized", await direct(oldToken, { v: ENGINE_VERSION, commands: [] }), [401, { ok: false, error: "unauthorized" }]);
    same("an old engine is outdated", await direct(b2.session.access_token, { v: ENGINE_VERSION - 1, commands: [] }), [409, { ok: false, error: "outdated", v: ENGINE_VERSION }]);

    /* ---------------------------------------------------------- */
    section("the market and the post");

    await editSave(stack, "ashen", (s) => put(s, "bank", "slag_delve", 100));
    await editSave(stack, "bram", (s) => { s.player.gold = 1000; });
    const listed = await call(A, "game", [cmd("marketList", { key: "slag_delve", from: "bank", qty: 30, price: 7 })]);
    const listing = listed.body.results[0];
    check("A lists 30 Slag Ore at 7 each from a seeded Stockpile", listing.ok && Number.isInteger(listing.data.listingId) && listed.body.state.bank.items.slag_delve === 70, listing);
    const listingId = listing.data.listingId;
    const dearer = await call(A, "game", [cmd("marketList", { key: "slag_delve", from: "bank", qty: 5, price: 9 })]);
    const dearId = dearer.body.results[0].data.listingId;

    /* The market is anonymous (migration 007): a player reads their own listings and nobody
       else's, so the table surface is exercised as the seller and the buyer sees nothing. */
    const COLS = "id, seller_name, item_key, item_name, item_kind, qty_left, price_each, status, expires_at";
    const open = await call(A, "query", "market_listings", COLS, [["eq", "status", "open"]]);
    const seen = open.data && open.data.find((r) => r.id === listingId);
    check("A finds their own with from(market_listings).select().eq(status, open)", open.error === null && !!seen, open);
    same("with the columns asked for, as PostgREST returns them", seen && { ...seen, expires_at: typeof seen.expires_at },
      { id: listingId, seller_name: "ashen", item_key: "slag_delve", item_name: "Slag Ore", item_kind: "material", qty_left: 30, price_each: 7, status: "open", expires_at: "string" });
    const spied = await call(B, "query", "market_listings", COLS, [["eq", "status", "open"]]);
    same("and a buyer reads no listing of anybody else's, ask how they like", [spied.error, spied.data], [null, []]);

    const ids = async (steps) => {
      const res = await call(A, "query", "market_listings", "id", steps);
      return res.error ? res.error.message : res.data.map((r) => r.id);
    };
    same("neq, gt, gte, lt and lte", [
      await ids([["neq", "status", "sold"], ["order", "id"]]),
      await ids([["gt", "price_each", 7]]),
      await ids([["gte", "price_each", 7], ["order", "id"]]),
      await ids([["lt", "price_each", 7]]),
      await ids([["lte", "price_each", 7]]),
    ], [[listingId, dearId], [dearId], [listingId, dearId], [], [listingId]]);
    same("ilike (with % and *), in, and a timestamp compare", [
      await ids([["ilike", "item_name", "%slag%"], ["order", "id"]]),
      await ids([["ilike", "item_name", "*ORE"], ["order", "id"]]),
      await ids([["in", "id", [dearId, 999999]]]),
      await ids([["in", "id", []]]),
      await ids([["gt", "expires_at", new Date().toISOString()], ["order", "id"]]),
    ], [[listingId, dearId], [listingId, dearId], [dearId], [], [listingId, dearId]]);
    same("order descending, range and limit", [
      await ids([["order", "price_each", { ascending: false }]]),
      await ids([["order", "price_each", { ascending: false }], ["range", 1, 1]]),
      await ids([["order", "price_each", { ascending: true }], ["limit", 1]]),
      await ids([["order", "id"], ["range", 0, 9], ["limit", 1]]),
    ], [[dearId, listingId], [listingId], [listingId], [listingId]]);
    same("errors come back as { data: null, error: { message } }", [
      await call(B, "query", "hunt_presence", "*").then((r) => [r.data, r.error && r.error.message]),
      await call(A, "query", "market_listings", "id, nope").then((r) => [r.data, r.error && r.error.message]),
      await call(A, "query", "market_listings", "id", [["in", "id", 5]]).then((r) => [r.data, r.error && r.error.message]),
    ], [
      [null, "Could not find the table 'public.hunt_presence' in the schema cache"],
      [null, "column market_listings.nope does not exist"],
      [null, "\"in\" on id needs a list of values."],
    ]);

    // A material is bought out of the pool, by name, quantity and ceiling: the two listings
    // above are one book, cheapest first, and B never learns whose they are.
    const pools = await call(B, "rpc", "market_pools", { p_q: "slag" });
    same("B sees one pool with both bands and no seller in it",
      (pools.data || []).map((r) => [r.item_key, Number(r.qty_left), Number(r.price_min), r.bands]),
      [["slag_delve", 35, 7, [{ each: 7, qty: 30 }, { each: 9, qty: 5 }]]]);
    check("and nothing in the answer names anybody", !/seller|user_id|ashen/i.test(JSON.stringify(pools.data)), pools.data);
    const bought = await call(B, "game", [cmd("marketBuyPool", { key: "slag_delve", qty: 10, maxEach: 7 })]);
    same("B buys 10 out of the pool with marketBuyPool", bought.body.results[0].data,
      { key: "slag_delve", qty: 10, cost: 74, fee: 4, asked: 10, short: false });
    same("and pays 70 for the ore plus 4 to the market", [bought.body.state.player.gold, held(bought.body.state, "slag_delve")], [926, 10]);
    same("20 are left on the listing", (await call(A, "query", "market_listings", "qty_left", [["eq", "id", listingId]])).data, [{ qty_left: 20 }]);
    same("a material listing cannot be bought by its id", (await call(B, "game", [cmd("marketBuy", { listingId, qty: 1 })])).body.results[0].error,
      "Buy materials from the pool.");
    const paid = await call(A, "game", []);
    const post = paid.body.events.filter((e) => e.type === "mail:claimed");
    same("A's next call claims the gold by post: 70 less the 4 gold fee", [post.length, post[0] && post[0].gold, paid.body.state.player.gold], [1, 66, 66]);
    check("and the letter says what sold, not who bought it", !/bram/i.test(JSON.stringify((await call(A, "query", "mail", "note")).data)),
      (await call(A, "query", "mail", "note")).data);

    /* ---------------------------------------------------------- */
    section("row level security");

    const aId = a.userId;
    const bId = b.userId;
    const mailA = await call(A, "query", "mail", "user_id, kind, gold, claimed_at");
    check("A reads their own letter, claimed", mailA.error === null && mailA.data.length === 1 && mailA.data[0].user_id === aId && mailA.data[0].gold === 66 && !!mailA.data[0].claimed_at, mailA);
    const mailB = await call(B, "query", "mail", "user_id", []);
    const mailBForA = await call(B, "query", "mail", "id", [["eq", "user_id", aId]]);
    same("B cannot read A's mail, even asking for it by id", [mailB.error, mailB.data.some((r) => r.user_id === aId), mailBForA.data], [null, false, []]);
    same("B reads only their own save", (await call(B, "query", "saves", "user_id, username")).data, [{ user_id: bId, username: "bram" }]);
    same("and not A's, even by id", (await call(B, "query", "saves", "data", [["eq", "user_id", aId]])).data, []);
    same("A reads only their own save", (await call(A, "query", "saves", "username")).data, [{ username: "ashen" }]);
    // Neither side reads the sales table at all any more: each reads their own side of it.
    same("market_sales is closed to both sides of the sale", [
      (await call(A, "query", "market_sales", "listing_id, qty, fee")).error.message,
      (await call(B, "query", "market_sales", "listing_id, qty, fee")).error.message,
    ], ["permission denied for table market_sales", "permission denied for table market_sales"]);
    same("and each reads their own side of it, with their own leg of the fee", [
      (await call(A, "rpc", "market_sales_mine", {})).data.map((r) => [r.side, r.qty, Number(r.fee)]),
      (await call(B, "rpc", "market_sales_mine", {})).data.map((r) => [r.side, r.qty, Number(r.fee)]),
    ], [[["sold", 10, 4]], [["bought", 10, 4]]]);
    check("with nothing in it that names the other party",
      !/seller|buyer_id|user_id|ashen|bram/i.test(JSON.stringify((await call(B, "rpc", "market_sales_mine", {})).data)),
      (await call(B, "rpc", "market_sales_mine", {})).data);
    const cancelled = await call(A, "game", [cmd("marketCancel", { listingId: dearId })]);
    check("A takes the dearer listing back", cancelled.body.results[0].ok === true, cancelled.body.results[0]);
    same("the seller still sees a cancelled listing; the buyer sees neither it nor the open one", [
      await call(A, "query", "market_listings", "id, status", [["eq", "id", dearId]]).then((r) => r.data),
      await call(B, "query", "market_listings", "id", [["in", "id", [dearId, listingId]]]).then((r) => r.data),
    ], [[{ id: dearId, status: "cancelled" }], []]);
    same("every player reads profiles", (await call(B, "query", "profiles", "username", [["order", "username"]])).data, [{ username: "ashen" }, { username: "bram" }]);

    const C = await openApp(browser, { url: page });
    apps.push(C);
    await C.page.waitForFunction(() => window.harness);
    same("signed out, RPCs and reads are refused as anon", [
      (await call(C, "rpc", "party_state")).error.message,
      (await call(C, "query", "profiles", "username")).error.message,
    ], ["permission denied for function party_state", "permission denied for table profiles"]);

    /* ---------------------------------------------------------- */
    section("a party, its chat and realtime");

    const created = await call(A, "rpc", "party_create", { p_name: "The Harness" });
    check("A creates a party", created.error === null && UUID.test(created.data), created);
    same("B cannot invite into a party they are not in", (await call(B, "rpc", "party_invite", { p_username: "ashen" })).error.message, "You are not in a party.");
    same("RPC errors carry the raised message", (await call(A, "rpc", "party_invite", { p_username: "nobody_here" })).error.message, "No player by that name.");
    const invite = await call(A, "rpc", "party_invite", { p_username: "bram" });
    check("A invites B and gets the invite id", invite.error === null && Number.isInteger(invite.data), invite);
    const before = (await call(B, "rpc", "party_state")).data;
    same("B sees the invite in party_state", [before.party, before.invites_in.map((i) => [i.id, i.party_name, i.from_name])], [null, [[invite.data, "The Harness", "ashen"]]]);

    // Sent, this would decline the invite.
    await call(B, "unawaited", "party_respond", { p_invite_id: invite.data, p_accept: false });
    await sleep(400);
    same("an RPC nobody awaits is never sent, as in postgrest-js", (await call(B, "rpc", "party_state")).data.invites_in.length, 1);

    await call(B, "subscribe", "party_messages");
    await call(B, "subscribe", "party_members");
    await call(B, "subscribe", "mail");
    await waitFor("three SUBSCRIBED statuses", () => B.page.evaluate(() => window.harness.statuses.filter((s) => s.status === "SUBSCRIBED").length === 3), { timeout: 5000 });
    check("channels report SUBSCRIBED", true);

    // Lags are timed in the browsers (the RPC's return in one page, the poke in the other), so a
    // busy test driver does not count against the one second poll.
    const pokeOf = (table) => B.page.evaluate((t) => window.harness.pokes.find((p) => p.table === t), table);
    const joined = await call(B, "rpc", "party_respond", { p_invite_id: invite.data, p_accept: true });
    same("B accepts", [joined.data, joined.error], [null, null]);
    await waitFor("a party_members poke", () => call(B, "pokeCount", "party_members"), { timeout: 5000 });
    const joinLag = (await pokeOf("party_members")).at - joined.doneAt;
    check("the join pokes party_members within 2 seconds", joinLag <= 2000, joinLag);

    const said = await call(A, "rpc", "party_say", { p_body: "The fire is lit." });
    check("A says something", said.error === null && Number.isInteger(said.data), said);
    await waitFor("a party_messages poke", () => call(B, "pokeCount", "party_messages"), { timeout: 5000 });
    const poke = await pokeOf("party_messages");
    check("B's party_messages channel fires within 2 seconds of the say", poke.at - said.doneAt <= 2000, poke.at - said.doneAt);
    same("with eventType * and the table", [poke.eventType, poke.table], ["*", "party_messages"]);
    const saidB = await call(B, "rpc", "party_say", { p_body: "Coming." });
    check("B says something", saidB.error === null, saidB);

    const state = (await call(A, "rpc", "party_state")).data;
    same("party_state shows the party, both members and both messages", {
      party: [state.party.name, state.party.leader_id],
      members: state.members.map((m) => m.username),
      messages: state.messages.map((m) => [m.username, m.body]),
      invites: [state.invites_in.length, state.invites_out.length],
    }, {
      party: ["The Harness", aId],
      members: ["ashen", "bram"],
      messages: [["ashen", "The fire is lit."], ["bram", "Coming."]],
      invites: [0, 0],
    });
    same("B's party_state matches", (await call(B, "rpc", "party_state")).data.members.map((m) => m.username), ["ashen", "bram"]);
    check("members can read party_messages directly under RLS", (await call(B, "query", "party_messages", "body", [["order", "id"]])).data.length === 2);
    same("C, outside the party, reads nothing of it", [
      (await call(C, "signUp", "cinder", "cinder1")).error,
      (await call(C, "query", "party_messages", "id")).data,
      (await call(C, "query", "parties", "id")).data,
    ], [null, [], []]);

    await sleep(1600);
    await call(A, "rpc", "party_say", { p_body: "One." });
    same("a second message inside 1.5 seconds is refused", (await call(A, "rpc", "party_say", { p_body: "Two." })).error.message, "You are sending messages too quickly.");

    await waitFor("the One. poke", async () => (await call(B, "pokeCount", "party_messages")) >= 2, { timeout: 5000 });
    same("removeChannel closes the channel", [await call(B, "unsubscribe", "watch-party_messages"), await B.page.evaluate(() => window.harness.statuses.at(-1).status)], ["ok", "CLOSED"]);
    const pokesBefore = await call(B, "pokeCount", "party_messages");
    await sleep(1600);
    await call(A, "rpc", "party_say", { p_body: "Anyone?" });
    await sql(stack, "insert into public.mail (user_id, kind, gold, note) values ($1::uuid, 'gold', 5, 'a stray coin')", [bId]);
    await sleep(2500);
    same("a removed channel hears nothing more", await call(B, "pokeCount", "party_messages"), pokesBefore);
    same("a table outside the supabase_realtime publication never pokes", await call(B, "pokeCount", "mail"), 0);

    // The stage out of reach for a moment (blocked in B's browser only).
    await call(B, "subscribe", "party_invites");
    const statusesOf = (name) => B.page.evaluate((n) => window.harness.statuses.filter((s) => s.channel === n).map((s) => s.status), name);
    await waitFor("the invites channel to join", async () => (await statusesOf("watch-party_invites")).includes("SUBSCRIBED"), { timeout: 5000 });
    await B.context.route("**/dev/changes*", (route) => route.abort("blockedbyclient"));
    await waitFor("CHANNEL_ERROR", async () => (await statusesOf("watch-party_invites")).includes("CHANNEL_ERROR"), { timeout: 5000 });
    // A cancelled invite: a real row change that holds no seat and shows nowhere.
    await sql(stack, `insert into public.party_invites (party_id, from_id, from_name, to_id, to_name, status)
                      values ($1::uuid, $2::uuid, 'ashen', gen_random_uuid(), 'nobody', 'cancelled')`, [created.data, aId]);
    await B.context.unroute("**/dev/changes*");
    await waitFor("the poke for a change made while the channel was down", async () => (await call(B, "pokeCount", "party_invites")) >= 1, { timeout: 5000 })
      .then(() => check("a channel that lost the stage says CHANNEL_ERROR, rejoins, and still hears what changed meanwhile", true))
      .catch(async () => check("a channel that lost the stage says CHANNEL_ERROR, rejoins, and still hears what changed meanwhile", false, await statusesOf("watch-party_invites")));
    same("its statuses in order", await statusesOf("watch-party_invites"), ["SUBSCRIBED", "CHANNEL_ERROR", "SUBSCRIBED"]);

    /* ---------------------------------------------------------- */
    section("presence and hiscores");

    same("heartbeat returns nothing and no error", await call(A, "rpc", "heartbeat", { p_activity: { skill: "delving", action: "delving_t1_raw", hunt: null } }).then((r) => [r.data, r.error]), [null, null]);
    same("the activity shows in party_state", (await call(B, "rpc", "party_state")).data.members.find((m) => m.username === "ashen").activity, { skill: "delving", action: "delving_t1_raw", hunt: null });
    const board = await call(B, "rpc", "hiscores", { p_skill: "total", p_limit: 10 });
    check("hiscores returns rows of rank, username, level and xp", board.error === null && Array.isArray(board.data) && board.data.length >= 2
      && board.data.every((r, i) => r.rank === i + 1 && typeof r.username === "string" && typeof r.level === "number" && typeof r.xp === "number")
      && ["ashen", "bram"].every((n) => board.data.some((r) => r.username === n)), board);
    check("hiscores with no arguments uses its defaults", (await call(B, "rpc", "hiscores")).data.length >= 2);
    const online = await call(B, "rpc", "online_count");
    check("online_count returns a number counting both players", online.error === null && typeof online.data === "number" && online.data >= 2, online);
    same("an argument the function does not take is a PostgREST lookup error", (await call(B, "rpc", "hiscores", { skill: "total" })).error.message,
      "Could not find the function public.hiscores(skill) in the schema cache");

    /* ---------------------------------------------------------- */
    section("the party sets out together");

    /* The host's press cannot reach into another camp's save, so it opens the ground and every
       member who marked ready walks on under their own next request. B marks ready, A presses,
       and B's next call to the game finds itself out with the party. */
    const ground = { tier: 1, zone: "outer" };
    same("a mark with no ground up is refused", (await call(B, "rpc", "party_ready", { p_ready: true })).error.message, "Nobody has put a ground up yet.");
    same("A puts the Outer up", (await call(A, "rpc", "party_propose", { p_tier: ground.tier, p_zone: ground.zone })).error, null);
    same("B marks ready", (await call(B, "rpc", "party_ready", { p_ready: true })).error, null);
    same("and the mark is in the room", (await call(A, "rpc", "party_state")).data.members.find((m) => m.username === "bram").ready, true);

    const out = await call(A, "game", [cmd("partyHuntStart", ground)]);
    check("A sets out", out.body.results[0].ok === true, out.body.results);
    check("A is on the ground alone for the moment", out.body.party && out.body.party.hunters.length === 1, out.body.party);
    same("and the first walk is held for the one still to come", out.body.party.muster, 1);
    same("and the host's own mark is spent", (await call(A, "rpc", "party_state")).data.members.find((m) => m.username === "ashen").ready, false);

    const fell = await call(B, "game", []);
    check("B's next call walks them on without being asked",
      !!fell.body.party && fell.body.party.hunters.length === 2, fell.body.party);
    const told = fell.body.events.find((e) => e.type === "party:fellin");
    same("and B is told, since nobody pressed anything", told && [told.tier, told.zone], [ground.tier, ground.zone]);
    same("B's mark comes down once it has been acted on",
      (await call(A, "rpc", "party_state")).data.members.find((m) => m.username === "bram").ready, false);

    // However late inside the hold B's request landed, encounter one is drawn for both.
    await advanceServer(stack, 5000);
    const first = (await call(A, "game", [])).body.party;
    check("encounter one is fought by both of them, nobody waiting on the next",
      !!first && first.encounters >= 1 && first.muster === 0 && !!first.enc && first.encounters === 1 && first.enc.hunters.length === 2,
      first && { encounters: first.encounters, muster: first.muster, fight: first.enc && first.enc.hunters.map((u) => u.userId) });

    // A mark that is down is not a standing instruction: breaking away stays broken.
    const broke = await call(B, "game", [cmd("partyHuntLeave")]);
    check("B breaks away", broke.body.results[0].ok === true, broke.body.results);
    const stayed = await call(B, "game", []);
    check("and is not walked back on by the mark they already spent", !stayed.body.party, stayed.body.party);

    /* ---------------------------------------------------------- */
    section("the stage clock");

    const started = await call(B, "game", [cmd("startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: null })]);
    check("B starts Delving", started.body.results[0].ok === true && started.body.state.tasks.skilling && started.body.state.tasks.skilling.actionId === "delving_t1_raw", started.body.results);
    const clock0 = started.body.state.clock;
    const ore0 = held(started.body.state, "slag_delve");
    await advanceServer(stack, HOUR);
    const later = await call(B, "game", []);
    const task = later.body.state.tasks.skilling;
    check("an hour on the stage clock later the save has caught up", later.body.state.clock >= clock0 + HOUR, [clock0, later.body.state.clock]);
    check("and the crew worked it: hundreds of actions, the ore in store", task && task.done >= 200 && held(later.body.state, "slag_delve") - ore0 >= task.done, { done: task && task.done, ore: held(later.body.state, "slag_delve") - ore0 });
    const away = later.body.events.find((e) => e.type === "away");
    check("and the server says welcome back", !!away && away.ms >= HOUR, later.body.events);
    const behind = await call(B, "game", [cmd("stopSkill")]);
    check("a browser an hour behind the stage still lands its commands", behind.body.results[0].ok === true && behind.body.state.tasks.skilling === null, behind.body.results);
    same("the profile the handler wrote is under the right id", await userIdOf(stack, "bram"), bId);

    /* ---------------------------------------------------------- */
    section("nothing went wrong");

    same("the stage logged no errors", stack.errors, []);
    same("no console or page errors in any browser", apps.flatMap((x) => x.errors), []);
    same("no request left the machine", apps.flatMap((x) => x.blocked), []);
  } finally {
    await browser.close().catch(() => {});
    await stack.close().catch(() => {});
  }
});
