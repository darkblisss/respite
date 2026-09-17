/* ============================================================
   Respite · store.js · The Quartermaster
   ------------------------------------------------------------
   Keeps the camp the page shows. The server owns every save;
   the browser predicts it with the same rules so nothing waits
   on the network:

   - A command the rules can predict applies here at once, is
     queued with the moment it was made, and goes to the server
     in a batch (a second after the last one, 25 at most, one
     request at a time).
   - Trades and starting over only the server can do: they flush
     the queue and wait for its word.
   - Every answer is adopted whole. Commands still unsent are
     played again on top of it, quietly (the camp log hears them,
     toasts do not), up to the moment the page had reached, so
     no stretch of time is ever told twice.
   - A long sleep is the server's to play out: the store holds
     and asks, rather than grinding hours through in the tab.

   Guests have no server: a camp in memory, gone with the tab.
   No DOM here. main.js owns the page, the loop and visibility;
   the tests run this file in Node against a fake server.
   ============================================================ */

import { advance, applyCommand, awaySnapshot, COMMANDS, makeEnv, SERVER_ONLY, summariseAway } from "../shared/engine.js";
import { createEmitter, emit } from "../shared/events.js";
import { attachChronicle } from "../shared/chronicle.js";
import { createState } from "../shared/state.js";
import { POOLS } from "../shared/storage.js";
import { createClock } from "./clock.js";

/* ================= 1. RULES OF THE ROAD ================= */

export const TIMING = Object.freeze({
  debounceMs: 1000,           // a batch goes this long after the last command
  maxHoldMs: 4000,            // and no command waits longer (the server moves one older than 10 s)
  batchMax: 25,
  cadenceMs: 5 * 60 * 1000,   // an idle, visible camp checks in this often
  heartbeatMs: 60 * 1000,
  onlineMs: 60 * 1000,
  partyMs: 30 * 1000,
  partyPokeMs: 250,           // realtime pokes come in bursts; one read answers them all
  backoffMinMs: 2000,
  backoffMaxMs: 60 * 1000,
  liveMaxMs: 15 * 1000,       // a frame longer than this is a catch-up, and catch-ups are quiet
  holdMs: 5 * 60 * 1000,      // a gap longer than this waits for the server
  awayMs: 10 * 60 * 1000,     // guests get a welcome back after this long
});

export const CATCHING_UP = "The camp is still catching up.";

const ERR = Object.freeze({
  guestTrade: "Sign in to trade.",
  waking: "The camp is still waking.",
  unknown: "Unknown command.",
  broke: "That went wrong.",
  unreachable: "The realm can't be reached. Try again soon.",
  outdated: "A new version of the camp is out. Reload to carry on.",
  signedOut: "Sign in again first.",
  refused: "The server turned that away.",
  lost: "The server lost that. Try again.",
  closed: "The camp is closed.",
});

// Market actions and starting over need the database; nothing predicts them.
const SERVER_TYPES = new Set([...SERVER_ONLY, "resetCamp"]);

const isServerType = (type) => SERVER_TYPES.has(type) || (Object.hasOwn(COMMANDS, type) && !COMMANDS[type].predict);

function randomSeed() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

// Args travel as JSON, so they are made JSON here: what runs locally is what the server gets.
function plainArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  try {
    const copy = JSON.parse(JSON.stringify(args));
    return copy && typeof copy === "object" && !Array.isArray(copy) ? copy : {};
  } catch {
    return {};
  }
}

/* ================= 2. SMALL QUERIES ================= */

// A party member lends the bonus only while around: three minutes past their last game request or heartbeat.
export const PRESENCE_MS = 3 * 60 * 1000;

/* A Postgres timestamp as the server reads it: epoch milliseconds, microseconds rounded half up.
   Date.parse drops everything past the millisecond, so the fourth digit decides. */
export function serverMs(value) {
  if (typeof value !== "string" || !value) return NaN;
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(value);
  if (!m || !m[2]) return Date.parse(value);
  const ms = Date.parse(`${m[1]}.${(m[2] + "00").slice(0, 3)}${m[3]}`);
  return Number.isFinite(ms) && m[2].length > 3 && m[2][3] >= "5" ? ms + 1 : ms;
}

/* One member's hunt as the shared-ground bonus counts it, or null when it cannot count. The
   server's rule: from started_at to the earliest of ended_at ?? ends_by and last_seen + 3 minutes;
   a member never seen lends nothing. */
export function huntInterval(member) {
  const hunt = member && member.hunt;
  if (!hunt || typeof hunt !== "object") return null;
  const start = serverMs(hunt.started_at);
  const ended = serverMs(hunt.ended_at ?? hunt.ends_by);
  const seen = serverMs(member.last_seen);
  if (!Number.isFinite(start) || !Number.isFinite(ended) || !Number.isFinite(seen)) return null;
  return { tier: Number(hunt.tier), zone: String(hunt.zone), start, end: Math.min(ended, seen + PRESENCE_MS) };
}

// Other members' hunts, as env.party.intervals wants them; yourself left out (the server does the same).
export function partyIntervals(partyState, selfId) {
  const members = partyState && Array.isArray(partyState.members) ? partyState.members : [];
  const self = typeof selfId === "string" ? selfId.toLowerCase() : null;
  const out = [];
  for (const m of members) {
    if (!m || (self && String(m.user_id).toLowerCase() === self)) continue;
    const interval = huntInterval(m);
    if (interval) out.push(interval);
  }
  return out;
}

// Whether a guest camp holds anything worth a second thought before it is left behind.
export function hasProgress(state) {
  if (!state || typeof state !== "object") return false;
  if (state.player && state.player.gold > 0) return true;
  if (state.skills && Object.values(state.skills).some((xp) => xp > 0)) return true;
  if (state.tasks && (state.tasks.skilling || state.tasks.combat)) return true;
  if (POOLS.some((w) => state[w] && Object.keys(state[w].items || {}).length > 0)) return true;
  if (state.companions && Object.keys(state.companions.owned || {}).length > 0) return true;
  return !!(state.travel && state.travel.unlocked && state.travel.unlocked.length > 1);
}

// What the heartbeat tells the party: the bench and the hunt ground, nothing more.
export function activityOf(state) {
  const s = state && state.tasks ? state.tasks.skilling : null;
  const c = state && state.tasks ? state.tasks.combat : null;
  return {
    skill: s ? s.skillId : null,
    action: s ? s.actionId : null,
    hunt: c ? { tier: c.tier, zone: c.zone } : null,
  };
}

/* ================= 3. THE STORE ================= */

/**
 * createStore({ mode, net, session, clock, wall, seed, state, timing, log })
 *   mode     "guest" | "account"
 *   net      the net API (account mode only; a guest store never touches it)
 *   session  { userId, username } for account mode
 *   clock    createClock(); one is made on `wall` if not given
 *   wall     () => ms, the browser's own clock (injected by tests)
 *   seed     a guest camp's seed (random when null); state: a guest save to start from
 */
export function createStore({
  mode = "guest",
  net = null,
  session = null,
  clock = null,
  wall = () => Date.now(),
  seed = null,
  state: initialState = null,
  timing = null,
  log = console,
} = {}) {
  const T = timing ? Object.freeze({ ...TIMING, ...timing }) : TIMING;
  const kind = mode === "account" && net ? "account" : "guest";
  const time = clock || createClock({ wall });

  const bus = createEmitter();
  attachChronicle(bus);
  // Both envs share one party record, updated in place when the party changes.
  const party = { intervals: [] };
  const live = makeEnv({ emitter: bus, fx: true, party });
  const quietBus = createEmitter();
  attachChronicle(quietBus);
  const quiet = makeEnv({ emitter: quietBus, party });

  let state = null;
  if (kind === "guest") {
    state = initialState || createState({ now: time.now(), seed: seed == null ? randomSeed() : seed });
  }

  const status = { conn: kind === "guest" ? "guest" : "connecting", pending: 0, lastSyncAt: null, error: null, catchingUp: false };
  let partyState = null;
  let online = null;
  let visible = true;
  let destroyed = false;
  let lastError = "";

  // The road to the server.
  const idPrefix = `c${randomSeed().toString(36).slice(0, 4)}.`;
  let idSeq = 0;
  let queue = [];               // { id, type, args, at, queuedAt, serverOnly, resolve }
  let inflight = null;
  let syncWanted = false;
  let lastQueuedAt = 0;
  let retryAt = 0;
  let backoff = 0;
  let authTries = 0;
  let halted = null;            // null | "outdated" | "unauthorized"
  let sendSeq = 0;
  let syncWaiters = [];         // { seq, resolve }
  let idleWaiters = [];
  let nextCadenceAt = Infinity;
  let nextBeatAt = 0;
  let nextOnlineAt = 0;
  let nextPartyAt = 0;
  let partyPokeAt = 0;
  let partyWatch = false;
  let partyFlight = null;
  let partyAgain = false;
  let unsubscribe = null;
  let subscribedTo;             // undefined until the first subscription
  let lastSuccessAt = 0;

  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  if (state) readyResolve(true);

  /* ---------- status and errors ---------- */

  function setStatus(patch) {
    let changed = false;
    for (const k of Object.keys(patch)) {
      if (status[k] !== patch[k]) {
        status[k] = patch[k];
        changed = true;
      }
    }
    if (changed && !destroyed) bus.emit("store:status", { status });
  }

  const pendingCount = () => queue.length + (inflight ? inflight.length : 0);

  // A rules bug must not take the page down or fill the console ten times a second.
  function report(where, err) {
    const text = `${where}: ${err && err.message ? err.message : err}`;
    if (text === lastError) return;
    lastError = text;
    if (log && typeof log.error === "function") log.error(`store ${where}`, err);
  }

  /* ---------- time ---------- */

  function tryAdvance(target, env) {
    try {
      advance(state, target, env);
      return true;
    } catch (err) {
      report("advance", err);
      return false;
    }
  }

  // A stretch too long to tell live: played quietly. Guests hear how long they were gone.
  function catchUp(target, gap) {
    const away = kind === "guest" && gap > T.awayMs;
    const before = away ? awaySnapshot(state) : null;
    if (!tryAdvance(target, quiet)) return false;
    if (away) {
      const summary = summariseAway(before, awaySnapshot(state), gap);
      emit(state, quiet, "away", summary);
      bus.emit("store:news", { type: "away", ...summary, at: state.clock });
    }
    return true;
  }

  function holdForServer() {
    if (status.catchingUp && (inflight || syncWanted)) return;
    setStatus({ catchingUp: true });
    syncWanted = true;
    kick();
  }

  // Brings the save up to now. false while a long gap waits on the server.
  function settle() {
    if (!state) return false;
    const target = time.now();
    const gap = target - state.clock;
    if (kind === "account" && gap > T.holdMs && !halted && status.conn !== "offline") {
      holdForServer();
      return false;
    }
    if (status.catchingUp) setStatus({ catchingUp: false });
    if (!(gap > 0)) return true;
    return gap > T.liveMaxMs ? catchUp(target, gap) : tryAdvance(target, live);
  }

  function frame() {
    if (destroyed) return;
    if (kind === "account") pulse(wall());
    // A hidden tab sleeps; it catches up (or asks the server to) when it is looked at again.
    if (!state || !visible) return;
    settle();
  }

  /* ---------- commands ---------- */

  function run(type, args, env) {
    try {
      const res = applyCommand(state, { type, args }, env);
      if (!res || typeof res !== "object") return { ok: false, error: ERR.broke };
      return res;
    } catch (err) {
      report(`command ${type}`, err);
      return { ok: false, error: ERR.broke };
    }
  }

  const nextId = () => `${idPrefix}${(++idSeq).toString(36)}`;

  function dispatch(type, args = {}) {
    if (destroyed) return Promise.resolve({ ok: false, error: ERR.closed });
    if (typeof type !== "string") return Promise.resolve({ ok: false, error: ERR.unknown });
    const a = plainArgs(args);

    if (kind === "guest") {
      if (type === "resetCamp") {
        resetGuest();
        return Promise.resolve({ ok: true });
      }
      if (isServerType(type)) return Promise.resolve({ ok: false, error: ERR.guestTrade });
      if (!Object.hasOwn(COMMANDS, type)) return Promise.resolve({ ok: false, error: ERR.unknown });
      settle();
      return Promise.resolve(run(type, a, live));
    }

    // A store turned away before its first save says why, not that it is still waking.
    if (!state) return Promise.resolve({ ok: false, error: halted === "outdated" ? ERR.outdated : halted === "unauthorized" ? ERR.signedOut : ERR.waking });
    if (isServerType(type)) return serverDispatch(type, a);
    if (!Object.hasOwn(COMMANDS, type)) return Promise.resolve({ ok: false, error: ERR.unknown });
    if (!settle()) return Promise.resolve({ ok: false, error: CATCHING_UP });

    const res = run(type, a, live);
    // A refusal here is final: sending it would only let the server surprise the player.
    if (res.ok) enqueue({ type, args: a, at: state.clock });
    return Promise.resolve(res);
  }

  function enqueue(cmd) {
    const w = wall();
    queue.push({ id: nextId(), type: cmd.type, args: cmd.args, at: Math.floor(cmd.at), queuedAt: w, serverOnly: false, resolve: null });
    lastQueuedAt = w;
    setStatus({ pending: pendingCount() });
    kick();
  }

  function serverDispatch(type, args) {
    if (halted === "outdated") return Promise.resolve({ ok: false, error: ERR.outdated });
    if (halted === "unauthorized") return Promise.resolve({ ok: false, error: ERR.signedOut });
    settle();
    return new Promise((resolve) => {
      const w = wall();
      queue.push({ id: nextId(), type, args, at: Math.floor(Math.max(state.clock, time.now())), queuedAt: w, serverOnly: true, resolve });
      lastQueuedAt = w;
      setStatus({ pending: pendingCount() });
      kick();
    });
  }

  function resetGuest() {
    const fresh = createState({ now: time.now(), seed: randomSeed() });
    fresh.log = [{ t: fresh.clock, m: "You start over from a ruin." }];
    state = fresh;
    bus.emit("store:replaced", {});
  }

  /* ---------- the request loop ---------- */

  function due(w) {
    if (syncWanted) return true;
    if (!queue.length) return false;
    if (queue.length >= T.batchMax) return true;
    return w >= lastQueuedAt + T.debounceMs || w >= queue[0].queuedAt + T.maxHoldMs;
  }

  // Starts a request if one is due. Never two at once.
  function kick() {
    if (destroyed || kind !== "account" || inflight || halted) return;
    const w = wall();
    const urgent = queue.some((c) => c.serverOnly);
    if (!urgent && retryAt && w < retryAt) return;
    if (!urgent && !due(w)) return;
    send();
  }

  /* The next request's commands. The server only starts over when resetCamp is the whole request
     ("Start over on its own."), so it goes alone, after everything queued before it. */
  function nextBatch() {
    if (queue.length && queue[0].type === "resetCamp") return queue.splice(0, 1);
    const reset = queue.findIndex((c) => c.type === "resetCamp");
    return queue.splice(0, Math.min(T.batchMax, reset < 0 ? queue.length : reset));
  }

  async function send() {
    const batch = nextBatch();
    const seq = ++sendSeq;
    syncWanted = false;
    inflight = batch;
    // Retries while offline stay "offline" until one gets through: a banner that blinks with every attempt helps nobody.
    const conn = status.conn === "offline" ? "offline" : state ? "syncing" : "connecting";
    setStatus({ conn, pending: pendingCount() });

    const sentAt = wall();
    let res;
    try {
      res = await net.game(batch.map((c) => ({ id: c.id, type: c.type, args: c.args, at: c.at })));
    } catch (err) {
      res = { ok: false, error: "network" };
    }
    const receivedAt = wall();
    if (destroyed) {
      // The camp was swapped out mid-request; a waiting trade still hears how it went.
      const said = new Map(res && res.ok === true && Array.isArray(res.results) ? res.results.map((r) => [r && r.id, r]) : []);
      for (const c of batch) {
        const r = said.get(c.id);
        if (c.serverOnly && c.resolve) c.resolve(r ? { ok: r.ok === true, error: r.ok === true ? undefined : r.error, data: r.data } : { ok: false, error: ERR.closed });
      }
      return;
    }

    // Still "in flight" while the answer is handled: a session refresh must not let a second request slip past.
    let retryNow = false;
    try {
      retryNow = await handle(batch, res, sentAt, receivedAt, seq);
    } catch (err) {
      report("sync", err);
    }
    inflight = null;
    if (destroyed) return;
    if (!retryNow) settleWaiters(seq, !!(res && res.ok === true));
    setStatus({ pending: pendingCount() });
    kick();
    if (!inflight) {
      const waiting = idleWaiters;
      idleWaiters = [];
      waiting.forEach((fn) => fn());
    }
  }

  function settleWaiters(seq, ok) {
    const keep = [];
    for (const w of syncWaiters) {
      if (w.seq <= seq || halted) w.resolve(ok);
      else keep.push(w);
    }
    syncWaiters = keep;
  }

  function failServerOnly(batch, error) {
    for (const c of batch) if (c.serverOnly && c.resolve) c.resolve({ ok: false, error });
  }

  // Predictable commands go back to the front of the queue; they keep their moments.
  function putBack(batch) {
    const back = batch.filter((c) => !c.serverOnly);
    if (back.length) queue = back.concat(queue);
  }

  // Returns true when the same work is being tried again at once (a refreshed session).
  async function handle(batch, res, sentAt, receivedAt, seq) {
    if (res && res.ok === true && res.state && typeof res.state === "object") {
      backoff = 0;
      retryAt = 0;
      authTries = 0;
      time.sample(Number(res.now), sentAt, receivedAt);
      const behind = reconcile(batch, res);
      lastSuccessAt = wall();
      nextCadenceAt = lastSuccessAt + T.cadenceMs;
      setStatus({ conn: "online", error: null, lastSyncAt: Number(res.now), catchingUp: behind });
      // The server stopped partway through a long absence: straight back for the rest.
      if (behind) syncWanted = true;
      return false;
    }

    const error = res && typeof res.error === "string" ? res.error : "network";

    if (error === "unauthorized" && authTries === 0) {
      authTries = 1;
      queue = batch.concat(queue);
      if (!batch.length) syncWanted = true;
      for (const w of syncWaiters) if (w.seq <= seq) w.seq = seq + 1;
      try {
        if (net.refresh) await net.refresh();
      } catch (err) {
        report("refresh", err);
      }
      return true;
    }

    if (error === "unauthorized") {
      halted = "unauthorized";
      putBack(batch);
      failServerOnly(batch, ERR.signedOut);
      failServerOnly(queue, ERR.signedOut);
      queue = queue.filter((c) => !c.serverOnly);
      setStatus({ conn: "offline", error: "unauthorized", catchingUp: false });
      return false;
    }

    if (error === "outdated") {
      halted = "outdated";
      putBack(batch);
      failServerOnly(batch, ERR.outdated);
      failServerOnly(queue, ERR.outdated);
      queue = queue.filter((c) => !c.serverOnly);
      setStatus({ conn: "outdated", error: "outdated", catchingUp: false });
      return false;
    }

    if (error === "bad_request" && batch.length) {
      // Not retryable. Drop it and fetch the truth, which undoes whatever was predicted.
      for (const c of batch) if (!c.serverOnly) bus.emit("store:rejected", { type: c.type, error: ERR.refused });
      failServerOnly(batch, ERR.refused);
      syncWanted = true;
      setStatus({ conn: state ? "online" : "connecting", error: "bad_request" });
      return false;
    }

    // Offline, a gateway in the way, or the server fell over: keep the queue, back off, try again.
    putBack(batch);
    failServerOnly(batch, ERR.unreachable);
    backoff = backoff ? Math.min(T.backoffMaxMs, backoff * 2) : T.backoffMinMs;
    retryAt = wall() + backoff;
    syncWanted = true;
    setStatus({ conn: "offline", error, catchingUp: false });
    return false;
  }

  /* Adopts the server's save. Returns true when the server is still behind its own now. */
  function reconcile(batch, res) {
    const results = new Map();
    if (Array.isArray(res.results)) {
      for (const r of res.results) if (r && typeof r.id === "string") results.set(r.id, r);
    }

    const again = [];
    const rejected = [];
    const settled = [];
    for (const cmd of batch) {
      const r = results.get(cmd.id);
      if (r && r.ok !== true && r.error === CATCHING_UP) {
        again.push(cmd);
        continue;
      }
      if (cmd.serverOnly) {
        settled.push([cmd, r ? { ok: r.ok === true, error: r.ok === true ? undefined : r.error, data: r.data } : { ok: false, error: ERR.lost }]);
        continue;
      }
      if (r && r.ok !== true) rejected.push({ type: cmd.type, error: typeof r.error === "string" ? r.error : ERR.refused });
    }
    if (again.length) queue = again.concat(queue);

    const next = res.state;
    const serverNow = Number(res.now);
    const behind = Number.isFinite(serverNow) && next.clock < serverNow;
    const shown = state ? state.clock : null;

    if (!behind) {
      // What the player did since this request left, played again on the server's word.
      for (const cmd of queue) {
        if (cmd.serverOnly) continue;
        try {
          advance(next, cmd.at, quiet);
          applyCommand(next, { type: cmd.type, args: cmd.args }, quiet);
        } catch (err) {
          report(`replay ${cmd.type}`, err);
        }
      }
      // Up to the moment the page had reached: that stretch was already told live.
      if (shown != null && shown > next.clock) {
        try {
          advance(next, shown, quiet);
        } catch (err) {
          report("replay", err);
        }
      }
    }

    const first = !state;
    state = next;
    if (first) readyResolve(true);

    bus.emit("store:replaced", {});
    for (const r of rejected) bus.emit("store:rejected", r);
    if (Array.isArray(res.events)) {
      for (const e of res.events) if (e && typeof e.type === "string") bus.emit("store:news", { ...e });
    }
    for (const [cmd, result] of settled) cmd.resolve(result);
    return behind;
  }

  function sync({ soft = false } = {}) {
    if (kind !== "account" || destroyed || halted) return Promise.resolve(false);
    // Focus and visibility often arrive together: one check-in answers both.
    if (soft && !queue.length && (inflight || (lastSuccessAt && wall() - lastSuccessAt < 10 * 1000))) return Promise.resolve(true);
    syncWanted = true;
    retryAt = 0;
    const p = new Promise((resolve) => syncWaiters.push({ seq: sendSeq + 1, resolve }));
    kick();
    return p;
  }

  function whenIdle() {
    if (!inflight) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  // After signing in again as the same player: pick up where the queue left off.
  function resume(nextSession = null) {
    if (kind !== "account" || destroyed) return;
    if (nextSession) session = nextSession;
    halted = null;
    authTries = 0;
    retryAt = 0;
    setStatus({ conn: state ? "syncing" : "connecting", error: null });
    syncWanted = true;
    kick();
  }

  /* ---------- the realm around the camp ---------- */

  function pulse(w) {
    if (halted) return;
    kick();
    if (!state || !visible) return;
    if (w >= nextCadenceAt && !inflight && !syncWanted) {
      syncWanted = true;
      kick();
    }
    if (w >= nextBeatAt) {
      nextBeatAt = w + T.heartbeatMs;
      heartbeat();
    }
    if (w >= nextOnlineAt) {
      nextOnlineAt = w + T.onlineMs;
      refreshOnline();
    }
    const watching = partyWatch || !!(partyState && partyState.party);
    if ((watching && w >= nextPartyAt) || (partyPokeAt && w >= partyPokeAt) || subscribedTo === undefined) {
      nextPartyAt = w + T.partyMs;
      partyPokeAt = 0;
      if (subscribedTo === undefined) subscribedTo = null;
      refreshParty();
    }
  }

  function heartbeat() {
    if (typeof net.heartbeat !== "function") return;
    Promise.resolve()
      .then(() => net.heartbeat(activityOf(state)))
      .catch((err) => report("heartbeat", err));
  }

  async function refreshOnline() {
    if (typeof net.onlineCount !== "function") return;
    try {
      const n = await net.onlineCount();
      if (destroyed || typeof n !== "number" || !Number.isFinite(n)) return;
      if (n !== online) {
        online = n;
        bus.emit("store:online", { online });
      }
    } catch (err) {
      report("online", err);
    }
  }

  function refreshParty() {
    if (kind !== "account" || destroyed || !net.party || typeof net.party.state !== "function") return Promise.resolve(null);
    if (partyFlight) {
      partyAgain = true;
      return partyFlight;
    }
    partyFlight = (async () => {
      let result = partyState;
      do {
        partyAgain = false;
        try {
          const { data, error } = (await net.party.state()) || {};
          if (destroyed) return null;
          if (!error && data && typeof data === "object") {
            setParty(data);
            result = data;
          }
        } catch (err) {
          report("party", err);
        }
      } while (partyAgain && !destroyed);
      return result;
    })().finally(() => { partyFlight = null; });
    return partyFlight;
  }

  function setParty(data) {
    partyState = data;
    party.intervals = partyIntervals(data, session && session.userId);
    const id = data.party && data.party.id ? data.party.id : null;
    if (id !== subscribedTo || !unsubscribe) {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      subscribedTo = id;
      try {
        const off = typeof net.party.subscribe === "function"
          ? net.party.subscribe(id, () => { partyPokeAt = wall() + T.partyPokeMs; })
          : null;
        unsubscribe = typeof off === "function" ? off : () => {};
      } catch (err) {
        report("realtime", err);
        unsubscribe = () => {};
      }
    }
    bus.emit("store:party", { party: data });
  }

  function setVisible(next) {
    const v = !!next;
    if (v === visible) return;
    visible = v;
    if (kind !== "account") return;
    if (!v) {
      // Anything waiting goes now: a hidden tab's timers slow to a crawl.
      if (queue.length) {
        syncWanted = true;
        kick();
      }
    } else {
      nextBeatAt = 0;
      nextOnlineAt = 0;
      sync({ soft: true });
    }
  }

  function watchParty(on) {
    const was = partyWatch;
    partyWatch = !!on;
    if (partyWatch && !was) nextPartyAt = 0;
  }

  function destroy() {
    if (destroyed) return;
    failServerOnly(queue, ERR.closed);
    destroyed = true;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    syncWaiters.forEach((w) => w.resolve(false));
    syncWaiters = [];
    idleWaiters.forEach((fn) => fn());
    idleWaiters = [];
  }

  return {
    get mode() { return kind; },
    get state() { return state; },
    now: () => time.now(),
    bus,
    get status() { return status; },
    get party() { return partyState; },
    get online() { return online; },
    ready,
    clock: time,
    dispatch,
    frame,
    sync,
    refreshParty,
    account() {
      if (kind === "guest") return { mode: "guest", username: null, userId: null };
      return {
        mode: "account",
        username: (state && state.meta && state.meta.account) || (session && session.username) || null,
        userId: session ? session.userId : null,
      };
    },
    setVisible,
    watchParty,
    whenIdle,
    resume,
    destroy,
    get halted() { return halted; },
  };
}
