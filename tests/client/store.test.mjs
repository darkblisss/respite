/* ============================================================
   Respite · tests/client/store.test.mjs · The Proving Ground
   ------------------------------------------------------------
   The browser's store against a fake game server built from the
   real rules: it clamps each command's moment the way the
   handler does, answers with the whole save, refuses what the
   rules refuse, posts news, and can be slow, offline, outdated,
   or short of time to catch up. The wall clock is ours to move.

     node tests/client/store.test.mjs
   ============================================================ */

import { createStore, partyIntervals, huntInterval, serverMs, hasProgress, CATCHING_UP, PRESENCE_MS } from "../../src/client/store.js";
import { createClock } from "../../src/client/clock.js";
import { createState } from "../../src/shared/state.js";
import { advance, applyCommand, awaySnapshot, makeEnv, summariseAway } from "../../src/shared/engine.js";
import { createEmitter, emit } from "../../src/shared/events.js";
import { attachChronicle } from "../../src/shared/chronicle.js";
import { applyMail, applyPurchase, fillPool, marketFee } from "../../src/shared/market.js";
import { shopStock } from "../../src/shared/world.js";
import { ENGINE_VERSION } from "../../src/shared/version.js";

/* ================= HARNESS ================= */

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  const extra = !ok && detail !== undefined ? `\n     ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : "";
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra.length > 1200 ? `${extra.slice(0, 1200)} ...` : extra}`);
  return !!ok;
}

const section = (title) => console.log(`\n# ${title}`);
const clone = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((resolve) => setImmediate(resolve));

const START = Date.UTC(2026, 8, 17, 9, 0, 0);
const USER = "00000000-0000-4000-8000-00000000000a";
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const LATE_MS = 10 * 1000;
const AWAY_MS = 10 * MIN;

const engineEvent = (type) => !type.startsWith("store:");

/* ================= THE FAKE SERVER ================= */

/* Requests take `latency` of our wall clock: they reach the server halfway and the
   answer lands at the end. pump() delivers whatever is due; the drive loop calls it. */
function createServer(wall, { skew = 0, latency = 200, seed = 4242, account = "morwen" } = {}) {
  const flights = [];
  const srv = {
    state: null,
    skew,
    latency,
    offline: false,
    reply: null,          // (commands) => body | null, to fake 401, 409 and friends
    budgetMs: null,       // how far one request may catch up before it stops (the handler's CPU budget)
    mail: [],
    listings: new Map(),
    partyState: null,
    partyView: null,      // sessionView(), which rides back on every answer while this camp is out
    calls: [],
    answers: [],
    concurrent: 0,
    maxConcurrent: 0,
    refreshes: 0,
    beats: [],
    subscriptions: [],
  };

  srv.game = (commands) => new Promise((resolve, reject) => {
    srv.calls.push(clone(commands));
    srv.concurrent++;
    srv.maxConcurrent = Math.max(srv.maxConcurrent, srv.concurrent);
    flights.push({ commands: clone(commands), arrive: wall.t + srv.latency / 2, due: wall.t + srv.latency, body: null, failed: false, resolve, reject });
    srv.pump();
  });

  srv.pump = () => {
    for (const f of flights.slice()) {
      if (!f.body && !f.failed && wall.t >= f.arrive) {
        if (srv.offline) f.failed = true;
        else f.body = clone((srv.reply && srv.reply(f.commands)) || srv.play(f.commands, f.arrive));
      }
      if ((f.body || f.failed) && wall.t >= f.due) {
        flights.splice(flights.indexOf(f), 1);
        srv.concurrent--;
        if (f.failed) f.reject(new TypeError("Failed to fetch"));
        else {
          srv.answers.push(f.body);
          f.resolve(f.body);
        }
      }
    }
  };

  srv.inFlight = () => flights.length;

  /* The handler's partyIntervals query, written out by hand: other members seen at least once,
     from started_at to least(coalesce(ended_at, ends_by), last_seen + 3 minutes), each timestamp
     as round(extract(epoch) * 1000). */
  const pgMs = (text) => {
    const [, whole, frac = "0"] = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?/.exec(text);
    return Date.parse(`${whole}Z`) + Math.round(Number(`0.${frac}`) * 1000);
  };
  srv.presence = () => {
    const members = srv.partyState && Array.isArray(srv.partyState.members) ? srv.partyState.members : [];
    return members
      .filter((m) => m.user_id !== USER && m.hunt && m.last_seen)
      .map((m) => ({
        tier: m.hunt.tier,
        zone: m.hunt.zone,
        start: pgMs(m.hunt.started_at),
        end: Math.min(pgMs(m.hunt.ended_at || m.hunt.ends_by), pgMs(m.last_seen) + 3 * 60 * 1000),
      }));
  };

  srv.fresh = (t) => createState({ now: t, seed, userId: USER, account });

  // The handler's request, in miniature.
  srv.play = (commands, arriveWall) => {
    const t = Math.floor(arriveWall + srv.skew);
    if (!srv.state) srv.state = srv.fresh(t);
    const emitter = createEmitter();
    attachChronicle(emitter);
    const news = [];
    emitter.on("*", (payload, type) => {
      if (type !== "mail:claimed" && type !== "away") return;
      const { state: _state, ...rest } = payload;
      news.push({ type, ...rest });
    });
    const env = makeEnv({ emitter, party: { intervals: srv.presence() } });
    const alone = commands.length === 1;

    if (srv.mail.length && !(alone && commands[0].type === "resetCamp")) applyMail(srv.state, srv.mail.splice(0), env);

    const clockBefore = srv.state.clock;
    let away = null;
    let behind = false;
    const advanceTo = (target) => {
      if (behind) return false;
      const first = !away;
      const before = first ? awaySnapshot(srv.state) : null;
      const goal = Math.floor(target);
      if (srv.budgetMs != null && goal - srv.state.clock > srv.budgetMs) {
        advance(srv.state, srv.state.clock + srv.budgetMs, env);
        behind = true;
      } else {
        advance(srv.state, goal, env);
      }
      if (first) away = { before, after: awaySnapshot(srv.state) };
      return !behind;
    };

    const results = [];
    for (const cmd of commands) {
      const at = Math.min(t, Math.max(cmd.at, srv.state.clock, t - LATE_MS));
      if (!advanceTo(at)) {
        results.push({ id: cmd.id, ok: false, error: CATCHING_UP });
        continue;
      }
      let res;
      if (cmd.type === "resetCamp" && !alone) {
        res = { ok: false, error: "Start over on its own." };
      } else if (cmd.type === "resetCamp") {
        const next = createState({ now: srv.state.clock, seed: seed + 1, userId: USER, account });
        next.log = [{ t: next.clock, m: "You start over from a ruin." }];
        srv.state = next;
        res = { ok: true };
      } else if (cmd.type === "marketBuy") {
        // Both legs of the fee, as the handler charges them: the ask, plus the market's cut.
        const l = srv.listings.get(cmd.args.listingId);
        if (!l || l.qtyLeft < 1) res = { ok: false, error: "That listing is gone." };
        else if (!(cmd.args.qty >= 1) || cmd.args.qty > l.qtyLeft) res = { ok: false, error: `Only ${l.qtyLeft} left.` };
        else {
          const goods = l.price * cmd.args.qty;
          const fee = marketFee(goods);
          const bought = applyPurchase(srv.state, { key: l.key, qty: cmd.args.qty, goods, fee }, env);
          if (bought.ok) {
            l.qtyLeft -= cmd.args.qty;
            res = { ok: true, data: { listingId: cmd.args.listingId, key: l.key, qty: cmd.args.qty, cost: goods + fee, fee } };
          } else res = bought;
        }
      } else if (cmd.type === "marketBuyPool") {
        // The pool: every listing of that key, filled cheapest first by the shared rule.
        const open = [...srv.listings.entries()]
          .filter(([, l]) => l.key === cmd.args.key && l.qtyLeft > 0)
          .map(([id, l]) => ({ id, priceEach: l.price, qtyLeft: l.qtyLeft, at: id }));
        const plan = fillPool(open, { qty: cmd.args.qty, maxEach: cmd.args.maxEach, gold: srv.state.player.gold });
        if (!plan.ok) res = plan;
        else {
          const { fills, units, goods, fee, total, short } = plan.data;
          const bought = applyPurchase(srv.state, { key: cmd.args.key, qty: units, goods, fee }, env);
          if (bought.ok) {
            fills.forEach((f) => { srv.listings.get(f.id).qtyLeft -= f.qty; });
            res = { ok: true, data: { key: cmd.args.key, qty: units, cost: total, fee, asked: cmd.args.qty, short } };
          } else res = bought;
        }
      } else {
        res = applyCommand(srv.state, { type: cmd.type, args: cmd.args }, env);
      }
      results.push(res.ok ? (res.data === undefined ? { id: cmd.id, ok: true } : { id: cmd.id, ok: true, data: res.data }) : { id: cmd.id, ok: false, error: res.error });
    }

    advanceTo(t);
    const awayMs = srv.state.clock - clockBefore;
    if (away && !behind && awayMs > AWAY_MS) emit(srv.state, env, "away", summariseAway(away.before, away.after, awayMs));
    const body = { ok: true, v: ENGINE_VERSION, now: t, state: srv.state, results, events: news };
    // The handler leaves `party` out entirely unless the caller is out on a party's fight.
    if (srv.partyView) body.party = srv.partyView;
    return body;
  };

  srv.net = {
    enabled: true,
    game: srv.game,
    refresh: async () => { srv.refreshes++; },
    heartbeat: async (activity) => { srv.beats.push(activity); },
    onlineCount: async () => 7,
    party: {
      state: async () => ({ data: srv.partyState, error: null }),
      subscribe: (partyId, onChange) => {
        srv.subscriptions.push(partyId);
        srv.poke = onChange;
        return () => {};
      },
    },
  };
  return srv;
}

/* ================= DRIVING ================= */

function world(options = {}) {
  const wall = { t: options.start || START };
  const srv = createServer(wall, options);
  const errors = [];
  const store = createStore({
    mode: "account",
    net: srv.net,
    session: { userId: USER, username: "morwen" },
    wall: () => wall.t,
    log: { error: (...args) => errors.push(args.map(String).join(" ")) },
  });
  const events = [];
  store.bus.on("*", (payload, type) => events.push({ type, payload }));
  return { wall, srv, store, events, errors };
}

// One loop iteration the way main.js runs it: time passes, answers land, a frame.
async function step(w, ms = 100) {
  w.wall.t += ms;
  w.srv.pump();
  await tick();
  w.store.frame();
  await tick();
}

async function run(w, ms, stepMs = 100) {
  const end = w.wall.t + ms;
  while (w.wall.t < end) await step(w, Math.min(stepMs, end - w.wall.t));
}

async function until(w, promise, limitMs = 5 * MIN) {
  let done = false;
  let value;
  promise.then((v) => { done = true; value = v; });
  const end = w.wall.t + limitMs;
  await tick();
  while (!done && w.wall.t < end) await step(w, 50);
  if (!done) throw new Error("timed out waiting on the store");
  return value;
}

async function boot(options) {
  const w = world(options);
  if (options && options.prepare) options.prepare(w);
  await until(w, w.store.sync());
  return w;
}

const count = (events, pred) => events.filter((e) => pred(e.type, e.payload)).length;

/* ================= THE SUITE ================= */

async function main() {
  section("The clock");
  {
    const wall = { t: 1000 };
    const clock = createClock({ wall: () => wall.t });
    check("before any reading, the wall clock is the clock", clock.now() === 1000 && !clock.synced);
    wall.t = 1200;
    clock.sample(6100, 1000, 1200);
    check("offset is the server's now against the middle of the trip", clock.offset === 5000 && clock.rtt === 200, clock.offset);
    check("now reads wall plus offset", clock.now() === 6200, clock.now());
    clock.sample(9000, 1200, 2000);
    check("a slower trip does not overrule a quicker one", clock.offset === 5000, clock.offset);
    wall.t = 3000;
    const a = clock.now();
    clock.sample(3000 + 2600, 2990, 3000);   // a quick trip that says the server is 2.4 s behind
    const b = clock.now();
    check("a reading that moves time back holds it instead", b === a && clock.offset < 5000, { a, b, offset: clock.offset });
    let back = false;
    let prev = b;
    for (let i = 0; i < 40; i++) {
      wall.t += 100;
      const n = clock.now();
      if (n < prev) back = true;
      prev = n;
    }
    check("time never runs backwards while the hold wears off", !back);
    check("and moves again once the wall clock catches up", prev > b, { prev, b });
    const before = clock.now();
    wall.t -= 60 * 1000;
    check("a wall clock set back by hand does not freeze the camp", clock.now() >= before && clock.now() - before < 1000);
    wall.t += 500;
    check("it carries on from where it was", clock.now() > before);
  }

  section("Guests never touch the network");
  {
    let touched = 0;
    const trap = new Proxy({}, { get: () => { touched++; return () => { touched++; }; } });
    const wall = { t: START };
    const store = createStore({ mode: "guest", net: trap, wall: () => wall.t });
    check("a guest store starts with a camp at once", !!store.state && store.state.clock === START);
    check("status says guest", store.status.conn === "guest" && store.mode === "guest");
    check("account is a guest's", store.account().mode === "guest" && store.account().userId === null);
    check("a guest camp starts with no progress", !hasProgress(store.state));
    const started = await store.dispatch("startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: null });
    check("predictable commands run locally", started.ok && !!store.state.tasks.skilling, started);
    check("progress counts a running task", hasProgress(store.state));
    wall.t += 30 * 1000;
    store.frame();
    check("frames advance the guest camp", store.state.clock === START + 30 * 1000);
    const trade = await store.dispatch("marketBuy", { listingId: 1, qty: 1 });
    check("trading asks a guest to sign in", !trade.ok && trade.error === "Sign in to trade.", trade);
    check("sync does nothing and says so", (await store.sync()) === false);
    check("refreshParty gives null", (await store.refreshParty()) === null);
    let replaced = 0;
    store.bus.on("store:replaced", () => replaced++);
    const reset = await store.dispatch("resetCamp");
    check("resetCamp starts a fresh local camp", reset.ok && !store.state.tasks.skilling && store.state.skills.delving === 0 && replaced === 1);
    check("the fresh camp says it started over", store.state.log.length === 1 && store.state.log[0].m === "You start over from a ruin.");
    const live = [];
    store.bus.on("*", (p, type) => { if (engineEvent(type)) live.push(type); });
    await store.dispatch("startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: null });
    const news = [];
    store.bus.on("store:news", (p) => news.push(p));
    const skillBefore = store.state.skills.delving;
    wall.t += 2 * HOUR;
    store.frame();
    check("a guest's long gap is caught up here, quietly", store.state.clock === wall.t && store.state.skills.delving > skillBefore && live.length === 0, { live: live.length });
    check("with a welcome back", news.length === 1 && news[0].type === "away" && news[0].ms === 2 * HOUR, news);
    check("and the camp log keeps the away line", store.state.log.some((l) => l.m.startsWith("Away 2h")));
    check("nothing touched the net", touched === 0, touched);
  }

  section("Optimistic commands and batching");
  {
    const w = await boot();
    const { store, srv, wall } = w;
    check("the first sync adopts the server's camp", !!store.state && store.state.meta.account === "morwen" && store.status.conn === "online");
    check("account() names the player", store.account().username === "morwen" && store.account().userId === USER);
    const calls = srv.calls.length;
    const res = await store.dispatch("startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: 50 });
    const at0 = store.state.clock;
    check("a predictable command resolves with the local result", res.ok === true, res);
    check("and shows in the save before any request", !!store.state.tasks.skilling && srv.calls.length === calls);
    check("pending counts it", store.status.pending === 1, store.status);
    await step(w, 300);
    await store.dispatch("setHide", { on: true });
    const at1 = store.state.clock;
    await step(w, 300);
    await store.dispatch("setHide", { on: false });
    await run(w, 900);
    check("nothing is sent inside the debounce", srv.calls.length === calls, srv.calls.length - calls);
    await run(w, 200);
    check("one request once the commands stop", srv.calls.length === calls + 1, srv.calls.length - calls);
    const batch = srv.calls[calls];
    check("it carries all three in order", batch.map((c) => c.type).join() === "startSkill,setHide,setHide", batch.map((c) => c.type));
    check("each at the moment it was predicted", batch[0].at === at0 && batch[1].at === at1, batch.map((c) => c.at));
    check("with distinct ids", new Set(batch.map((c) => c.id)).size === 3 && batch.every((c) => typeof c.id === "string" && c.id.length <= 40));
    await run(w, 500);
    check("the server took them", !!srv.state.tasks.skilling && srv.state.settings.hideSovereign === false && store.status.pending === 0);

    const before = srv.calls.length;
    for (let i = 0; i < 30; i++) await store.dispatch("setHide", { on: i % 2 === 0 });
    await tick();
    check("25 waiting go at once, without the debounce", srv.calls.length === before + 1 && srv.calls[before].length === 25, srv.calls.slice(before).map((c) => c.length));
    await run(w, 400);
    check("the rest wait for the debounce, never overlapping", srv.calls.length === before + 1, srv.calls.length - before);
    await run(w, 1200);
    check("then go in a second batch", srv.calls.length === before + 2 && srv.calls[before + 1].length === 5, srv.calls.slice(before).map((c) => c.length));
    await run(w, 500);
    check("one request at a time throughout", srv.maxConcurrent === 1, srv.maxConcurrent);
    check("the last word stands on both sides", srv.state.settings.hideSovereign === false && store.state.settings.hideSovereign === false);
    check("no store errors", w.errors.length === 0, w.errors);
  }

  section("Reconcile: unsent commands are played on top of the answer");
  {
    const w = await boot({ latency: 600 });
    const { store, srv, wall } = w;
    await store.dispatch("startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: null });
    await run(w, 1000);
    check("the command is on its way", srv.inFlight() === 1 && store.status.conn === "syncing", { flights: srv.inFlight(), conn: store.status.conn });
    await step(w, 100);
    const hunt = await store.dispatch("startHunt", { tier: 1, zone: "outer", limit: null });
    check("a second command while the first is out", hunt.ok, hunt);
    let replaced = 0;
    store.bus.on("store:replaced", () => replaced++);
    await run(w, 600);
    check("the answer was adopted", replaced === 1, replaced);
    check("the server has the first command, not yet the second", !!srv.state.tasks.skilling && !srv.state.tasks.combat);
    check("the save shows the server's bench task", store.state.tasks.skilling && store.state.tasks.skilling.id === srv.answers[srv.answers.length - 1].state.tasks.skilling.id);
    check("and the unsent hunt played on top of it", !!store.state.tasks.combat && store.state.tasks.combat.tier === 1);
    check("the hunt is still queued", store.status.pending === 1, store.status);
    await run(w, 2000);
    check("then it goes, and the server agrees", !!srv.state.tasks.combat && store.status.pending === 0);
    const s = JSON.stringify(store.state.tasks.combat.id);
    check("both sides gave the hunt the same id", s === JSON.stringify(srv.state.tasks.combat.id));
  }

  section("No toast is told twice");
  {
    const w = await boot({ latency: 300 });
    const { store, srv, wall } = w;
    const first = clone(srv.answers[0].state);
    const live = [];
    store.bus.on("*", (payload, type) => {
      if (engineEvent(type)) live.push(`${type}@${payload.at}:${payload.who || ""}:${payload.kind || ""}:${payload.amount == null ? "" : payload.amount}`);
    });
    const cmds = [];
    const record = async (type, args) => {
      const res = await store.dispatch(type, args);
      cmds.push({ type, args, at: store.state.clock });
      return res;
    };
    await record("startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: null });
    await record("startHunt", { tier: 1, zone: "outer", limit: null });
    let syncs = 0;
    for (let i = 0; i < 18; i++) {
      await run(w, 20 * 1000);
      store.sync();
      syncs++;
    }
    await run(w, 5000);
    const end = store.state.clock;
    check("the server answered every check-in", srv.answers.length >= syncs, { answers: srv.answers.length, syncs });

    // The same camp played on its own, frame by frame, with nobody replacing it.
    const ref = first;
    const refBus = createEmitter();
    attachChronicle(refBus);
    const refEvents = [];
    refBus.on("*", (payload, type) => refEvents.push(`${type}@${payload.at}:${payload.who || ""}:${payload.kind || ""}:${payload.amount == null ? "" : payload.amount}`));
    const refEnv = makeEnv({ emitter: refBus, fx: true, party: { intervals: [] } });
    let t = ref.clock;
    let c = 0;
    while (t < end) {
      t = Math.min(end, t + 100);
      while (c < cmds.length && cmds[c].at <= t) {
        advance(ref, cmds[c].at, refEnv);
        applyCommand(ref, cmds[c], refEnv);
        c++;
      }
      advance(ref, t, refEnv);
    }
    check("the live camp saw plenty happen", live.length > 100, live.length);
    const repeats = live.filter((e, i) => live.indexOf(e) !== i);
    const refRepeats = refEvents.filter((e, i) => refEvents.indexOf(e) !== i);
    check("every live event is told once (repeats only where the unbroken camp repeats too)", repeats.join("|") === refRepeats.join("|"), { repeats, refRepeats });
    const diff = live.findIndex((e, i) => e !== refEvents[i]);
    check("and exactly what an unbroken camp would have told", live.length === refEvents.length && diff < 0, { live: live.length, ref: refEvents.length, at: diff, a: live[diff], b: refEvents[diff] });
    check("the predicted save matches the unbroken one", JSON.stringify(store.state.skills) === JSON.stringify(ref.skills) && store.state.stats.kills === ref.stats.kills, { store: store.state.stats, ref: ref.stats });
    check("no store errors", w.errors.length === 0, w.errors);
  }

  section("A refusal from the server");
  {
    const w = await boot({ prepare: (x) => { x.srv.state = x.srv.fresh(START); x.srv.state.player.gold = 500; } });
    const { store, srv } = w;
    check("the client adopted 500 gold", store.state.player.gold === 500, store.state.player.gold);
    srv.state.player.gold = 0;   // spent elsewhere, and the client has not heard
    const remedy = shopStock(store.state)[0];
    const rejected = [];
    store.bus.on("store:rejected", (p) => rejected.push(p));
    const res = await store.dispatch("buyRemedy", { key: remedy.key, qty: 1 });
    check("predicted as bought", res.ok && store.state.player.gold === 500 - remedy.price, res);
    await run(w, 1500);
    check("the server's refusal arrives as store:rejected", rejected.length === 1 && rejected[0].type === "buyRemedy" && rejected[0].error === "Not enough gold.", rejected);
    check("and the save is the server's again", store.state.player.gold === 0 && !Object.keys(store.state.inv.items).length);
  }

  section("Commands only the server runs");
  {
    const w = await boot({ latency: 400, prepare: (x) => { x.srv.state = x.srv.fresh(START); x.srv.state.player.gold = 100; } });
    const { store, srv } = w;
    srv.listings.set(7, { key: "slag_delve", price: 3, qtyLeft: 50 });
    await store.dispatch("setHide", { on: true });
    const calls = srv.calls.length;
    let settled = null;
    const buying = store.dispatch("marketBuy", { listingId: 7, qty: 10 });
    buying.then((r) => { settled = r; });
    await tick();
    check("a trade flushes the queue at once", srv.calls.length === calls + 1, srv.calls.length - calls);
    check("with the queued command first", srv.calls[calls].map((c) => c.type).join() === "setHide,marketBuy", srv.calls[calls]);
    check("and nothing is predicted", store.state.player.gold === 100 && !store.state.bank.items.slag_delve);
    await step(w, 200);
    check("it waits for the server", settled === null);
    const res = await until(w, buying);
    check("then resolves with the server's result, the fee included", res.ok && res.data && res.data.cost === 32 && res.data.fee === 2 && res.data.key === "slag_delve", res);
    check("with the answer already adopted", store.state.player.gold === 68 && haveAnywhere(store.state, "slag_delve") === 10);
    const gone = await until(w, store.dispatch("marketBuy", { listingId: 99, qty: 1 }));
    check("a refusal comes back as the server said it", !gone.ok && gone.error === "That listing is gone.", gone);
    // A pool buy is a server command too, and the fill is the shared rule's.
    srv.listings.set(8, { key: "bitter_fell", price: 2, qtyLeft: 4 });
    srv.listings.set(9, { key: "bitter_fell", price: 5, qtyLeft: 10 });
    const pooled = await until(w, store.dispatch("marketBuyPool", { key: "bitter_fell", qty: 6, maxEach: 5 }));
    check("a pool buy walks the cheap band first and pays one fee on the basket",
      pooled.ok && pooled.data.qty === 6 && pooled.data.cost === 19 && pooled.data.fee === 1, pooled);
    check("and the answer is adopted", haveAnywhere(store.state, "bitter_fell") === 6 && store.state.player.gold === 49);
    const dear = await until(w, store.dispatch("marketBuyPool", { key: "bitter_fell", qty: 4, maxEach: 4 }));
    check("a ceiling under every band left refuses", !dear.ok && dear.error === "Nobody is selling that at your price.", dear);
    await store.dispatch("startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: null });
    const reset = await until(w, store.dispatch("resetCamp"));
    check("starting over waits too, and the fresh camp is adopted", reset.ok && store.state.player.gold === 0 && !store.state.tasks.skilling && store.state.log[0].m === "You start over from a ruin.");
    srv.offline = true;
    const lost = await until(w, store.dispatch("marketBuy", { listingId: 7, qty: 1 }));
    check("offline, a trade fails at once instead of waiting for the road", !lost.ok && /can't be reached/.test(lost.error), lost);
    srv.offline = false;
    await run(w, 5000);
    check("and is never sent again by itself", srv.calls.flat().filter((c) => c.type === "marketBuy").length === 3);
  }

  section("Offline: keep the queue, back off, try again");
  {
    const w = await boot({ latency: 200 });
    const { store, srv } = w;
    srv.offline = true;
    await store.dispatch("startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: null });
    await run(w, 1300);
    check("the failed request marks the store offline", store.status.conn === "offline", store.status);
    check("the command stays queued", store.status.pending === 1);
    check("and the camp keeps running here", !!store.state.tasks.skilling);
    const calls = srv.calls.length;
    await run(w, 1500);
    check("no retry inside the first backoff", srv.calls.length === calls, srv.calls.length - calls);
    await run(w, 1000);
    check("a retry after about two seconds", srv.calls.length === calls + 1, srv.calls.length - calls);
    await run(w, 3000);
    check("the next wait is longer", srv.calls.length === calls + 1, srv.calls.length - calls);
    srv.offline = false;
    await run(w, 1500);
    check("the road clears on the next try", store.status.conn === "online" && store.status.pending === 0, store.status);
    check("and the server has the command", !!srv.state.tasks.skilling);
    srv.offline = true;
    await until(w, store.sync());
    const failedAt = srv.calls.length;
    srv.offline = false;
    const retried = await until(w, store.sync());
    check("Retry goes at once, backoff or not", retried === true && srv.calls.length === failedAt + 1 && store.status.conn === "online");
  }

  section("Outdated and signed out");
  {
    const w = await boot();
    const { store, srv } = w;
    srv.reply = () => ({ ok: false, error: "outdated", v: ENGINE_VERSION + 1 });
    await store.dispatch("setHide", { on: true });
    await run(w, 1500);
    check("409 marks the store outdated", store.status.conn === "outdated" && store.halted === "outdated", store.status);
    const calls = srv.calls.length;
    await run(w, 6 * MIN, 1000);
    check("an outdated store stops asking", srv.calls.length === calls, srv.calls.length - calls);
    check("sync says no without a request", (await store.sync()) === false && srv.calls.length === calls);
    const local = await store.dispatch("setHide", { on: false });
    check("the camp still predicts locally", local.ok && store.state.settings.hideSovereign === false);
    const trade = await store.dispatch("marketBuy", { listingId: 1, qty: 1 });
    check("trades say reload", !trade.ok && /new version/.test(trade.error), trade);
  }
  {
    // An old page whose very first sync is turned away never gets a camp; it still says why.
    const w = world();
    const { store, srv } = w;
    srv.reply = () => ({ ok: false, error: "outdated", v: ENGINE_VERSION + 1 });
    await until(w, store.sync());
    check("outdated before the first save: no camp, the store halted", store.state === null && store.halted === "outdated" && store.status.conn === "outdated", store.status);
    const early = await Promise.all([store.dispatch("marketList", { key: "slag_delve", from: "bank", qty: 1, price: 1 }), store.dispatch("setHide", { on: true })]);
    check("and every dispatch says reload, not that the camp is waking", early.every((r) => !r.ok && /new version/.test(r.error)), early);
  }
  {
    const w = await boot();
    const { store, srv } = w;
    let once = true;
    srv.reply = () => (once ? ((once = false), { ok: false, error: "unauthorized" }) : null);
    await store.dispatch("setHide", { on: true });
    await run(w, 1500);
    check("a 401 refreshes the session once and tries again", srv.refreshes === 1 && store.status.conn === "online" && srv.state.settings.hideSovereign === true, { refreshes: srv.refreshes, status: store.status });
    srv.reply = () => ({ ok: false, error: "unauthorized" });
    await store.dispatch("setHide", { on: false });
    await run(w, 1500);
    check("a second 401 in a row stops the store", store.halted === "unauthorized" && store.status.error === "unauthorized" && srv.refreshes === 2, { halted: store.halted, refreshes: srv.refreshes });
    const calls = srv.calls.length;
    await run(w, 50 * 1000, 1000);
    check("and it does not ask again inside the minute", srv.calls.length === calls, srv.calls.length - calls);
    /* "unauthorized" is also what an Auth hiccup looked like, and supabase-js renews tokens
       without a sign in anyone hears, so a halted camp asks again once a minute rather than
       sitting under a banner it cannot clear. Once a minute, not a storm. */
    await run(w, 6 * MIN, 1000);
    const asked = srv.calls.length - calls;
    check("then asks again about once a minute, and no oftener", asked >= 5 && asked <= 14, asked);
    check("with the Signed out banner held steady meanwhile, not blinking", store.status.error === "unauthorized" && store.halted === "unauthorized", store.status);
    check("the command waits for a sign in", store.status.pending === 1);
    srv.reply = null;
    store.resume();
    await run(w, 1000);
    check("resume() after signing in carries on with the queue", store.status.conn === "online" && store.status.pending === 0 && srv.state.settings.hideSovereign === false, store.status);
  }
  {
    // The case that stranded a real camp: told it was signed out, and it was not.
    const w = await boot();
    const { store, srv } = w;
    srv.reply = () => ({ ok: false, error: "unauthorized" });
    await store.dispatch("setHide", { on: true });
    await run(w, 1500);
    check("halted as signed out", store.halted === "unauthorized", store.halted);
    srv.reply = null;
    await run(w, 61 * 1000, 1000);
    check("a camp wrongly told it is signed out picks up again on its own",
      store.halted === null && store.status.conn === "online" && store.status.pending === 0 && srv.state.settings.hideSovereign === true, store.status);
  }

  section("Server time and a clock that never runs back");
  {
    const w = await boot({ skew: 5000, latency: 400 });
    const { store, srv, wall } = w;
    check("the offset follows the server's clock", Math.abs(store.now() - (wall.t + 5000)) <= 200, store.now() - wall.t);
    const res = await store.dispatch("setHide", { on: true });
    check("commands are stamped with server time", res.ok && Math.abs(store.state.clock - (wall.t + 5000)) <= 200);
    let back = false;
    let prevClock = store.state.clock;
    let prevNow = store.now();
    const watch = () => {
      if (store.state.clock < prevClock || store.now() < prevNow) back = true;
      prevClock = store.state.clock;
      prevNow = store.now();
    };
    for (let i = 0; i < 30; i++) {
      await step(w, 100);
      watch();
    }
    srv.skew = 2000;   // the server's clock slips 3 s behind what we showed
    srv.latency = 100;
    const shownBefore = store.now();
    const p = store.sync();
    while (!(await Promise.race([p.then(() => true), tick().then(() => false)]))) {
      await step(w, 20);
      watch();
    }
    check("a behind server moves the offset back", store.clock.offset < 4000, store.clock.offset);
    check("but predicted time holds rather than stepping back", store.now() >= shownBefore && !back);
    for (let i = 0; i < 40; i++) {
      await step(w, 100);
      watch();
    }
    check("the save's clock never ran backwards", !back);
    check("and time moves on once the hold wears off", store.now() > shownBefore + 500, store.now() - shownBefore);
  }

  section("A six-hour sleep is the server's to play out");
  {
    const w = await boot({ latency: 300 });
    const { store, srv, wall } = w;
    await store.dispatch("startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: null });
    await run(w, 3000);
    check("the task reached the server", !!srv.state.tasks.skilling && store.status.pending === 0);
    const live = [];
    const news = [];
    store.bus.on("*", (p, type) => { if (engineEvent(type)) live.push(type); });
    store.bus.on("store:news", (p) => news.push(p));
    const clockBefore = store.state.clock;
    const xpBefore = store.state.skills.delving;
    const calls = srv.calls.length;
    wall.t += 6 * HOUR;
    srv.pump();
    store.frame();
    check("the first frame after waking does not grind the hours through here", store.state.clock === clockBefore && store.state.skills.delving === xpBefore);
    check("it asks the server instead", srv.calls.length === calls + 1 && srv.calls[calls].length === 0);
    check("and says it is catching up", store.status.catchingUp === true, store.status);
    const refused = await store.dispatch("setHide", { on: true });
    check("commands wait until the camp is caught up", !refused.ok && refused.error === CATCHING_UP, refused);
    for (let i = 0; i < 3; i++) {
      await step(w, 100);
      check(`frame ${i + 1} while waiting still holds`, store.state.clock === clockBefore || store.status.catchingUp === false);
    }
    await run(w, 1000);
    check("the server's caught-up camp is adopted", store.state.clock >= wall.t - 1000 && store.status.catchingUp === false, { lag: wall.t - store.state.clock, status: store.status });
    check("six hours of work came from the server", store.state.skills.delving - xpBefore > 1000, store.state.skills.delving - xpBefore);
    check("not one live event for the time away", live.length === 0, live.slice(0, 5));
    check("the welcome back arrives as news", news.length === 1 && news[0].type === "away" && news[0].ms >= 6 * HOUR, news.map((n) => n.type));
    check("no store errors", w.errors.length === 0, w.errors);
  }
  {
    const w = await boot({ latency: 200 });
    const { store, srv, wall } = w;
    srv.state.player.gold = 500;
    await until(w, store.sync());
    await store.dispatch("buyRemedy", { key: shopStock(store.state)[0].key, qty: 1 });
    srv.budgetMs = HOUR;       // a cold server that stops after an hour a request
    wall.t += 6 * HOUR;
    await run(w, 5000, 50);
    check("a server short of time answers in pieces until it is caught up", store.status.catchingUp === false && store.state.clock >= wall.t - 1000, store.status);
    check("it took several requests", srv.answers.filter((a) => a.state.clock < a.now).length >= 5, srv.answers.length);
    const remedies = Object.keys(srv.state.inv.items).reduce((n, k) => n + srv.state.inv.items[k], 0);
    check("the command the server had no time for was sent again and applied once", remedies === 1, srv.state.inv.items);
    check("no store errors", w.errors.length === 0, w.errors);
  }

  section("Odd answers, hidden tabs and a camp swapped mid-trade");
  {
    const w = await boot();
    const { store, srv } = w;
    const rejected = [];
    store.bus.on("store:rejected", (p) => rejected.push(p));
    let once = true;
    srv.reply = (commands) => (once && commands.length ? ((once = false), { ok: false, error: "bad_request" }) : null);
    await store.dispatch("setHide", { on: true });
    await run(w, 2000);
    check("a 400 drops the batch and says so", rejected.length === 1 && rejected[0].type === "setHide", rejected);
    check("then the truth is fetched, undoing the prediction", store.state.settings.hideSovereign === false && store.status.pending === 0 && store.status.conn === "online", store.status);
  }
  {
    const wall = { t: START };
    const store = createStore({ mode: "guest", wall: () => wall.t });
    await store.dispatch("startHunt", { tier: 1, zone: "outer", limit: null });
    const live = [];
    store.bus.on("*", (p, type) => { if (engineEvent(type)) live.push(type); });
    store.setVisible(false);
    const clock = store.state.clock;
    for (let i = 0; i < 20; i++) {
      wall.t += 1000;
      store.frame();
    }
    check("a hidden tab does not advance the camp", store.state.clock === clock);
    store.setVisible(true);
    store.frame();
    check("back in view, twenty seconds away are played quietly", store.state.clock === wall.t && live.length === 0, live.length);
    for (let i = 0; i < 100; i++) {
      wall.t += 100;
      store.frame();
    }
    check("and live again from there", live.length > 0 && store.state.clock === wall.t);
  }
  {
    const w = await boot({ latency: 1000 });
    const { store, srv } = w;
    srv.listings.set(3, { key: "slag_delve", price: 0, qtyLeft: 5 });
    const buying = store.dispatch("marketBuy", { listingId: 3, qty: 1 });
    await step(w, 100);
    store.destroy();
    let res = null;
    buying.then((r) => { res = r; });
    for (let i = 0; i < 15 && !res; i++) {
      w.wall.t += 100;
      srv.pump();
      await tick();
    }
    check("a trade in flight when the camp is swapped still resolves", res && typeof res.ok === "boolean", res);
    check("a destroyed store refuses new commands", (await store.dispatch("setHide", { on: true })).ok === false);
  }

  section("The party bonus: a member counts while seen in the last three minutes");
  {
    const iso = (ms) => new Date(ms).toISOString();
    check("server timestamps round microseconds half up, as the server does", serverMs("2026-09-17T06:36:12.123456+00:00") === Date.parse("2026-09-17T06:36:12.123Z")
      && serverMs("2026-09-17T06:36:12.123500+00:00") === Date.parse("2026-09-17T06:36:12.124Z")
      && serverMs("2026-09-17T06:36:12+00:00") === Date.parse("2026-09-17T06:36:12Z")
      && Number.isNaN(serverMs(null)));
    check("presence lasts three minutes", PRESENCE_MS === 3 * MIN);
    const running = { tier: 1, zone: "outer", started_at: iso(START - HOUR), ends_by: iso(START + 11 * HOUR), ended_at: null };
    const member = (id, hunt, lastSeen) => ({ user_id: id, username: id, last_seen: lastSeen, hunt });
    const party = {
      party: { id: "p9" },
      members: [
        member(USER, running, iso(START)),
        member("u2", running, iso(START + 30 * 1000)),
        member("u3", { ...running, ended_at: iso(START + 60 * 1000) }, iso(START + 2 * MIN)),
        member("u4", running, null),
        member("u5", running, "2026-09-17T09:00:00.000600+00:00"),
        member("u6", null, iso(START)),
      ],
    };
    const iv = partyIntervals(party, USER);
    check("yourself, a member never seen and a member not hunting lend nothing", iv.length === 3, iv);
    check("a running hunt counts until three minutes after its hunter was last seen", iv[0].start === START - HOUR && iv[0].end === START + 30 * 1000 + 3 * MIN, iv[0]);
    check("a hunt that ended sooner counts until ended_at", iv[1].end === START + MIN, iv[1]);
    check("last_seen microseconds round the way the server's do", iv[2].end === START + 1 + 3 * MIN, iv[2]);
    check("huntInterval is null with no hunt or no last_seen", huntInterval(party.members[5]) === null && huntInterval(party.members[3]) === null);
    const fake = createServer({ t: START });
    fake.partyState = party;
    check("the fake server's hand-written query agrees", JSON.stringify(fake.presence()) === JSON.stringify(iv), { server: fake.presence(), client: iv });
  }
  {
    const iso = (ms) => new Date(ms).toISOString();
    const partner = { tier: 1, zone: "outer", started_at: iso(START - HOUR), ends_by: iso(START + 11 * HOUR), ended_at: null };
    const w = world({ latency: 300 });
    const { store, srv, wall } = w;
    // Out on the same ground, last seen half a minute in: the bonus stops at 3m 30s, though the hunt runs on.
    srv.partyState = {
      party: { id: "p1", name: "The Lantern Watch", leader_id: USER },
      members: [
        { user_id: USER, username: "morwen", last_seen: iso(START), hunt: null },
        { user_id: "u2", username: "thane", last_seen: iso(START + 30 * 1000), hunt: partner },
      ],
      invites_in: [], invites_out: [], messages: [],
    };
    await until(w, store.sync());
    await until(w, store.refreshParty());
    const base = clone(store.state);
    await store.dispatch("startHunt", { tier: 1, zone: "outer", limit: null });
    const huntAt = store.state.clock;

    // At every answer the predicted Hunt XP must already be the server's: nothing jumps on adoption.
    const moved = [];
    let before = null;
    store.bus.on("store:replaced", () => {
      if (before && store.state.clock === before.clock) moved.push(Math.abs(store.state.skills.warfare - before.xp));
    });
    for (let i = 1; i <= 8 * 600; i++) {
      if (i % 150 === 0) store.sync();
      wall.t += 100;
      before = { clock: store.state.clock, xp: store.state.skills.warfare };
      srv.pump();
      await tick();
      store.frame();
      await tick();
    }
    const end = store.state.clock;
    const replay = (intervals) => {
      const s = clone(base);
      const env = makeEnv({ party: { intervals } });
      advance(s, huntAt, env);
      applyCommand(s, { type: "startHunt", args: { tier: 1, zone: "outer", limit: null } }, env);
      advance(s, end, env);
      return s.skills.warfare;
    };
    const lent = { tier: 1, zone: "outer", start: START - HOUR };
    const capped = replay([{ ...lent, end: START + 30 * 1000 + 3 * MIN }]);
    const uncapped = replay([{ ...lent, end: START + 11 * HOUR }]);
    const alone = replay([]);
    check("the hunt earned XP across several answers", store.state.skills.warfare > 0 && moved.length >= 15, { xp: store.state.skills.warfare, answers: moved.length });
    check("no answer moved the predicted Hunt XP", moved.every((d) => d < 1e-9), moved.filter((d) => d >= 1e-9));
    check("the prediction is the capped rule's", Math.abs(store.state.skills.warfare - capped) < 1e-9, { store: store.state.skills.warfare, capped, uncapped });
    check("and the cap mattered: less than a partner counted all the way", capped < uncapped - 1e-6 && capped > alone + 1e-6, { alone, capped, uncapped });
    check("no store errors", w.errors.length === 0, w.errors);
  }

  section("Starting over travels alone");
  {
    const w = await boot({ latency: 300 });
    const { store, srv } = w;
    const refused = srv.play([{ id: "x1", type: "setHide", args: { on: true }, at: w.wall.t }, { id: "x2", type: "resetCamp", args: {}, at: w.wall.t }], w.wall.t);
    check("the fake server refuses a reset in company, as the real one does", refused.results[1].error === "Start over on its own." && refused.results[0].ok, refused.results);
    await until(w, store.sync());
    await store.dispatch("startSkill", { skillId: "delving", actionId: "delving_t1_raw", limit: null });
    await store.dispatch("setHide", { on: false });
    const calls = srv.calls.length;
    const resetting = store.dispatch("resetCamp");
    await tick();
    check("what was queued goes first, without the reset", srv.calls.length === calls + 1 && srv.calls[calls].map((c) => c.type).join() === "startSkill,setHide", srv.calls.slice(calls));
    await step(w, 100);
    const late = await store.dispatch("setHide", { on: true });
    const res = await until(w, resetting);
    check("then resetCamp as the whole request", srv.calls[calls + 1].length === 1 && srv.calls[calls + 1][0].type === "resetCamp", srv.calls.slice(calls));
    check("and the server starts over", res.ok === true && !store.state.tasks.skilling && store.state.log[0].m === "You start over from a ruin.", res);
    await run(w, 2500);
    check("a command made while the reset was queued follows in a request of its own", late.ok && srv.calls.length === calls + 3 && srv.calls[calls + 2].map((c) => c.type).join() === "setHide", srv.calls.slice(calls));
    check("the fresh camp has it", srv.state.settings.hideSovereign === true && store.state.settings.hideSovereign === true);
    const many = [];
    for (let i = 0; i < 30; i++) many.push(store.dispatch("setHide", { on: i % 2 === 1 }));
    const second = store.dispatch("resetCamp");
    const before = srv.calls.length;
    await until(w, second);
    const sizes = srv.calls.slice(before - 1).map((c) => c.map((x) => x.type === "resetCamp" ? "R" : "c").join(""));
    check("behind thirty queued commands: 25, 5, then the reset alone", sizes.join("|") === `${"c".repeat(25)}|${"c".repeat(5)}|R`, sizes);
    check("one request at a time throughout", srv.maxConcurrent === 1, srv.maxConcurrent);
  }

  section("News, the party and the heartbeat");
  {
    const w = await boot();
    const { store, srv, wall } = w;
    const news = [];
    store.bus.on("store:news", (p) => news.push(p));
    srv.mail.push({ id: 1, kind: "gold", gold: 200, item_key: null, qty: 0, note: "Sold." });
    await until(w, store.sync());
    check("the post arrives as store:news", news.length === 1 && news[0].type === "mail:claimed" && news[0].gold === 200, news);
    check("once", (await until(w, store.sync())) && news.length === 1);
    check("and the gold is in the adopted save", store.state.player.gold === 200);

    await run(w, 500);
    check("a heartbeat went out with the activity", srv.beats.length >= 1 && srv.beats[0].hunt === null && "skill" in srv.beats[0], srv.beats);
    check("the online count was read", store.online === 7);
    const iso = (ms) => new Date(ms).toISOString();
    srv.partyState = {
      party: { id: "p1", name: "The Lantern Watch", leader_id: USER },
      members: [
        { user_id: USER, username: "morwen", last_seen: iso(START), hunt: { tier: 1, zone: "outer", started_at: iso(START), ends_by: iso(START + 12 * HOUR), ended_at: null } },
        { user_id: "u2", username: "thane", last_seen: iso(START + 11 * HOUR), hunt: { tier: 1, zone: "outer", started_at: iso(START - HOUR), ends_by: iso(START + 11 * HOUR), ended_at: null } },
        { user_id: "u3", username: "ysolde", last_seen: iso(START), hunt: { tier: 2, zone: "inner", started_at: iso(START - HOUR), ends_by: iso(START + 11 * HOUR), ended_at: iso(START) } },
        { user_id: "u4", username: "corvin", last_seen: iso(START), hunt: null },
      ],
      invites_in: [], invites_out: [], messages: [],
    };
    const got = await store.refreshParty();
    check("refreshParty returns and keeps the party", got && store.party && store.party.party.id === "p1");
    const iv = partyIntervals(store.party, USER);
    check("party intervals leave yourself out", iv.length === 2 && !iv.some((x) => x.start === START));
    check("an ended hunt ends at ended_at, a running one (still being seen) at ends_by", iv[0].end === START + 11 * HOUR && iv[1].end === START, iv);
    check("realtime follows the party", srv.subscriptions[srv.subscriptions.length - 1] === "p1", srv.subscriptions);
    const reads = [];
    const realState = srv.net.party.state;
    srv.net.party.state = async () => { reads.push(wall.t); return realState(); };
    srv.poke();
    srv.poke();
    await run(w, 400);
    check("a burst of realtime pokes is one read", reads.length === 1, reads.length);
    await run(w, 31 * 1000, 500);
    check("in a party, the party is read again every 30 seconds", reads.length === 2, reads.length);
  }

  section("The party's fight rides back with the answer");
  {
    const w = await boot();
    const { store, srv } = w;
    const seen = [];
    store.bus.on("store:partyHunt", (p) => seen.push(p.partyHunt));

    check("no answer has mentioned one, so there is none", store.partyHunt === null);
    check("and nothing was said about it", seen.length === 0);

    // sessionView() as partyHunt.js writes it: a fight of two in the Inner, this camp down to 40.
    const view = (over = null, hp = 40) => ({
      partyId: "p1", tier: 1, zone: "inner", phase: "fight", wait: 0, elapsed: 90000,
      encounters: 3, over,
      enc: {
        id: 3, tier: 1, zone: "inner", kind: "normal", clock: 12000, over: null,
        foes: [{ uid: 7, id: "bog_stalker", elite: false, hp: 22, max: 48, target: USER }],
        hunters: [{ userId: USER, down: false, hp, max: 112, dmg: 640 }, { userId: "u2", down: true, hp: 0, max: 98, dmg: 210 }],
      },
      hunters: [{ userId: USER, down: false, hp, max: 112, dmg: 640 }, { userId: "u2", down: true, hp: 0, max: 98, dmg: 210 }],
    });

    const hpBefore = store.state.player.hp;
    const goldBefore = store.state.player.gold;
    srv.partyView = view();
    await until(w, store.sync());
    check("an answer carrying one keeps it", !!store.partyHunt && store.partyHunt.partyId === "p1" && store.partyHunt.enc.foes.length === 1, store.partyHunt);
    check("and says so once", seen.length === 1 && seen[0] === store.partyHunt, seen.length);
    check("kept word for word, not reshaped", JSON.stringify(store.partyHunt) === JSON.stringify(view()), store.partyHunt);

    // The save is the server's; a fight the browser cannot predict must not write a byte of it.
    check("it never writes the save", store.state.player.hp === hpBefore && store.state.player.gold === goldBefore && store.state.tasks.combat === null,
      { hp: store.state.player.hp, hpBefore, combat: store.state.tasks.combat });
    check("the hunter's health in it is not the camp's", store.partyHunt.hunters[0].hp === 40 && store.state.player.hp !== 40);

    // Out with the party, the camp checks in often: the fight only moves when a member asks it to.
    const before = srv.calls.length;
    await run(w, 13 * 1000, 250);
    const outCalls = srv.calls.length - before;
    check("while out, the camp checks in every few seconds", outCalls >= 2 && outCalls <= 5, outCalls);

    srv.partyView = view("cleared");
    await until(w, store.sync());
    check("a session the server calls over is cleared", store.partyHunt === null, store.partyHunt);
    check("and the clearing was told", seen.length >= 2 && seen[seen.length - 1] === null);

    srv.partyView = view();
    await until(w, store.sync());
    check("it comes back when the server sends one again", !!store.partyHunt);
    srv.partyView = null;
    await until(w, store.sync());
    check("an answer that leaves it out clears it", store.partyHunt === null);

    const quiet = seen.length;
    const idle = srv.calls.length;
    await run(w, 13 * 1000, 250);
    check("nothing is said while there is nothing to say", seen.length === quiet, seen.length - quiet);
    check("and a camp not out goes back to the slow cadence", srv.calls.length === idle, srv.calls.length - idle);
  }

  section("Marked ready, a camp is never five minutes from its party");
  {
    /* The host's Start walks everyone marked ready on under their own next request, and the
       first walk is held for them only so long (CONFIG.party.musterMs). An idle camp checks
       in every five minutes, which is how a ready member used to miss encounter one. */
    const w = await boot();
    const { store, srv } = w;
    const room = (hostOut) => ({
      party: { id: "p1", name: "The Lantern Watch", leader_id: "u2" },
      members: [
        { user_id: USER, username: "morwen", ready: true, hunt: null },
        { user_id: "u2", username: "thane", ready: false, hunt: hostOut ? { tier: 1, zone: "outer" } : null },
      ],
      invites_in: [], invites_out: [], messages: [],
    });
    srv.partyState = room(false);
    await store.refreshParty();
    await until(w, store.sync());
    const before = srv.calls.length;
    await run(w, 13 * 1000, 250);
    const readyCalls = srv.calls.length - before;
    check("marked ready, the camp checks in every few seconds", readyCalls >= 2 && readyCalls <= 5, readyCalls);

    // The host has pressed Start: their hunt shows on the roster, and this camp goes now.
    const atStart = srv.calls.length;
    srv.partyState = room(true);
    await store.refreshParty();
    await run(w, 600, 100);
    check("the moment the host is out, a ready camp checks in at once", srv.calls.length > atStart, srv.calls.length - atStart);

    // The mark comes down once it has walked on; a camp not ready waits its turn again.
    srv.partyState = { ...room(false), members: room(false).members.map((m) => ({ ...m, ready: false })) };
    await store.refreshParty();
    await until(w, store.sync());
    const settled = srv.calls.length;
    await run(w, 13 * 1000, 250);
    check("and with the mark down it goes back to the slow cadence", srv.calls.length === settled, srv.calls.length - settled);
  }
}

function haveAnywhere(state, key) {
  return ["inv", "bank", "vault"].reduce((n, w) => n + (state[w].items[key] || 0), 0);
}

try {
  await main();
} catch (err) {
  check("the suite ran to the end", false, err && err.stack);
}
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exitCode = failed ? 1 : 0;
