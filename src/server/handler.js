/* ============================================================
   Respite · handler.js · The Warden
   ------------------------------------------------------------
   The authoritative game server. One request is one transaction:
   lock the save, bring it up to date, deliver the post, play the
   player's commands at the moments they were made, then write the
   save, the profile and the hunt presence back. The rules are the
   same src/shared modules the browser predicts with.

   Runtime-agnostic: the Edge Function (Deno) and the tests (Node)
   hand in the database (db.js) and the user lookup.
   ============================================================ */

import { CONFIG } from "../shared/config.js";
import { GameData, getMonster, regionOfTier } from "../shared/registry.js";
import { createEmitter, emit } from "../shared/events.js";
import { clamp, fmtGold, fmtWhole } from "../shared/format.js";
import { ENGINE_VERSION } from "../shared/version.js";
import { createState, migrateSave } from "../shared/state.js";
import { advance, applyCommand, awaySnapshot, makeEnv, summariseAway } from "../shared/engine.js";
import { attachChronicle } from "../shared/chronicle.js";
import { itemDef, itemName, validKey } from "../shared/items.js";
import { ORDER, qtyIn, transact } from "../shared/storage.js";
import {
  bestRemedy, campPlan, dropLoot, huntPresence, remedyHeals,
} from "../shared/combat.js";
import { companionBonus, companionFinds } from "../shared/companions.js";
import { addXp, partyMult, xpMult } from "../shared/progression.js";
import { bountyProgress } from "../shared/world.js";
import { makeRng } from "../shared/rng.js";
import { maxHp, recovering, skillLevel, statsOf, totalLevel } from "../shared/stats.js";
import { applyMail, applyPurchase, applyReturn, fillPool, marketFee, prepareListing, remintKey } from "../shared/market.js";
import {
  clearOwed, makeHunter, newSession, nextSessionDue, owedFor, sessionView, stepSession,
} from "../shared/partyHunt.js";
import { addMastery } from "../shared/mastery.js";

/* ================= 1. LIMITS ================= */

export const MAX_BODY = 64 * 1024;          // characters; 25 honest commands fit many times over
const MAX_COMMANDS = 25;
const MAX_TOKEN = 40;                       // command id and type length
const LATE_MS = 10 * 1000;                  // a command may be stamped this far before the request
const AWAY_MS = 10 * 60 * 1000;             // a catch-up longer than this earns a welcome-back line
const SLICE_MS = 15 * 60 * 1000;            // catch-up runs in slices so it can stop in time
const CATCH_UP_BUDGET_MS = 1000;            // rules time per request, well inside a 2 s CPU limit
const EXPIRE_BATCH = 50;
const MAIL_BATCH = 100;
const LISTINGS_PER_HOUR = 60;               // listing and cancelling must not mint rows forever
const MAX_SAVE_BYTES = 2 * 1024 * 1024;     // a stored save past this is never parsed
const PG_INT_MAX = 2147483647;
const RETRY_CODES = new Set(["40001", "40P01", "23505"]);   // serialization, deadlock, a name race
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKILL_IDS = GameData.SKILLS.map((s) => s.id);
const HOUR_MS = 60 * 60 * 1000;

/* Party hunts (section 9 below). A party's fight belongs to the party, not to any save, so it is kept
   in its own row and paid out of on each member's own request. */
const PARTY_CAP_MS = CONFIG.time.idleCapMs;         // a party hunt runs no longer than a lone one
const PARTY_KEEP_MS = 7 * 24 * 60 * 60 * 1000;      // a closed session waits this long for stragglers
const PARTY_ROWS = 8;                               // sessions one request may settle out of
const PARTY_STEP_MS = 250;                          // rules time a member's own request lends the fight
const TICK_HEADER = "x-respite-tick";
const TICK_SECRET_MIN = 16;                         // shorter than this is not a secret, it is a typo
const TICK_ROWS = 25;                               // sessions one pass of the cron may play
const TICK_BUDGET_MS = 1000;                        // rules time a tick spends, well inside the CPU limit

// Results for commands a request had no time left to play. The client sends them again.
export const CATCHING_UP = "The camp is still catching up.";
export const START_OVER_ALONE = "Start over on its own.";
export const PARTY_OUT = "You're out with your party.";
// A moment, not an answer: fallIn leaves a ready mark up when a join hits this.
const CATCHING_UP_FIGHT = "Your party's fight is still catching up.";
const GONE = Object.freeze({ ok: false, error: "That listing is gone." });
const UNREADABLE = "Your old save could not be read.";
const refuse = (error) => ({ ok: false, error });

// News the browser could not have predicted, sent back with the save so it can say so.
const NEWS = new Set(["mail:claimed", "mail:unknown", "away", "party:spoils", "party:fellin"]);

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
});

/* ================= 2. PLUMBING ================= */

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const wallMs = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

function reply(status, payload, extraHeaders) {
  return { status, headers: { ...JSON_HEADERS, ...extraHeaders }, body: JSON.stringify(payload) };
}

// Fetch Headers or a plain object, any case.
function headerOf(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const want = name.toLowerCase();
  const key = Object.keys(headers).find((k) => k.toLowerCase() === want);
  return key === undefined ? null : headers[key];
}

// A new camp's dice come from the platform's random source, never from anything a player can
// see or time, so nobody picks a lucky camp by picking the moment it is made.
function freshSeed() {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
}

// jsonb goes in as `$n::text::jsonb` (see db.js) and arrives parsed from both drivers today;
// a string means a driver that doesn't.
function jsonOf(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/* ================= 3. THE REQUEST ================= */

// Only the envelope is judged here. What a command's args mean is for the rules.
function parseBody(bodyText) {
  const bad = { error: "bad_request" };
  if (typeof bodyText !== "string" || bodyText.length > MAX_BODY) return bad;
  let body;
  try {
    // "__proto__" has no honest use in a request, and a merge somewhere might trust it.
    body = JSON.parse(bodyText, (key, value) => {
      if (key === "__proto__") throw new SyntaxError("__proto__");
      return value;
    });
  } catch {
    return bad;
  }
  if (!isObject(body)) return bad;
  // An old client learns it is old before anything else, even if its commands look strange.
  if (body.v !== ENGINE_VERSION) return { error: "outdated" };
  if (!Array.isArray(body.commands) || body.commands.length > MAX_COMMANDS) return bad;

  const commands = [];
  for (const c of body.commands) {
    if (!isObject(c)) return bad;
    const { id, type, args, at } = c;
    if (typeof id !== "string" || id.length > MAX_TOKEN) return bad;
    if (typeof type !== "string" || type.length > MAX_TOKEN) return bad;
    if (args !== undefined && !isObject(args)) return bad;
    if (typeof at !== "number" || !Number.isFinite(at)) return bad;
    commands.push({ id, type, args: args || {}, at });
  }
  return { commands };
}

/**
 * @typedef {(text: string, params?: unknown[]) => Promise<any[]>} Query
 * @typedef {object} GameHandlerOptions
 * @property {{ transaction: (fn: (q: Query) => Promise<any>) => Promise<any> }} db  see db.js
 * @property {(authorization: string) => Promise<{ id: string, email?: string | null } | null>} getUser
 * @property {() => number} [now]  milliseconds
 * @property {((...args: any[]) => void) | { error: (...args: any[]) => void }} [log]
 * @property {number} [catchUpBudgetMs]  rules time a request may spend catching up
 * @property {string} [tickSecret]  the shared secret the cron posts to /tick with; unset turns the path off
 * @property {number} [tickBudgetMs]  rules time one tick may spend playing party hunts
 */

/** @param {GameHandlerOptions} options */
export function createGameHandler({
  db, getUser, now = () => Date.now(), log,
  catchUpBudgetMs = CATCH_UP_BUDGET_MS, tickSecret = "", tickBudgetMs = TICK_BUDGET_MS,
}) {
  const logError = typeof log === "function"
    ? log
    : log && typeof log.error === "function" ? log.error.bind(log) : (...args) => console.error(...args);
  const opts = { logError, budget: catchUpBudgetMs, tickSecret, tickBudget: tickBudgetMs };

  /**
   * @param {{ method: string, headers?: Headers | Record<string, string> | null, bodyText: string, url?: string }} request
   * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
   */
  async function handle({ method, headers, bodyText, url }) {
    try {
      if (String(method).toUpperCase() !== "POST") {
        return reply(405, { ok: false, error: "bad_request" }, { allow: "POST, OPTIONS" });
      }
      // The cron's own door, on its own path, with no player behind it (section 9b below).
      if (isTickPath(url)) return await runTick(db, headers, Math.floor(now()), opts);
      const parsed = parseBody(bodyText);
      if (parsed.error === "outdated") return reply(409, { ok: false, error: "outdated", v: ENGINE_VERSION });
      if (parsed.error) return reply(400, { ok: false, error: "bad_request" });

      const authorization = headerOf(headers, "authorization");
      const user = authorization ? await getUser(authorization) : null;
      if (!isObject(user) || typeof user.id !== "string" || !UUID_RE.test(user.id)) {
        return reply(401, { ok: false, error: "unauthorized" });
      }

      const body = await withRetry(() => db.transaction((q) => play(q, user, parsed.commands, Math.floor(now()), opts)));
      return { status: 200, headers: { ...JSON_HEADERS }, body };
    } catch (err) {
      logError("game: request failed", err);
      return reply(500, { ok: false, error: "server_error" });
    }
  }

  // Callable directly, or as handler.handle.
  handle.handle = handle;
  return handle;
}

// Nothing was written when a transaction fails, so one more try is safe.
async function withRetry(run) {
  try {
    return await run();
  } catch (err) {
    if (!RETRY_CODES.has(err && err.code)) throw err;
    return run();
  }
}

async function play(q, user, commands, t, opts) {
  const userId = user.id;

  // 1. The save, locked for the whole request. A first visit makes one.
  let row = await lockSave(q, userId);
  const account = await accountFor(q, user, row && row.username);
  if (!row) row = await createSave(q, userId, account, t);

  // 2. Up to date with the rules. A row the server never wrote (engine null) came from a v4
  // browser, which could put anything in it: it takes the v4 path and the legacy limits whatever
  // schema it claims. Data too big to be a camp, or not a camp at all, is not read.
  const raw = row.tooBig ? null : jsonOf(row.data);
  const state = migrateSave(raw, { now: t, seed: freshSeed(), userId, account, legacy: row.engine == null });
  if (!isObject(raw)) {
    state.log.push({ t: state.clock, m: UNREADABLE });
    opts.logError(`game: the save for ${userId} could not be read (${row.tooBig ? `${row.bytes} bytes` : "not an object"}); a fresh camp replaces it`);
  }

  const ctx = {
    q, t, userId, uid: userId.toLowerCase(), account, state, env: null, logError: opts.logError,
    budget: opts.budget, spent: 0, behind: false, away: null, reset: false, huntEndedAt: null,
    // The party's fight, if this player is in one: the rows they can be paid out of.
    party: { rows: [], live: null },
    // Starting over is a request of its own: nothing rides along to be played or claimed.
    alone: commands.length === 1,
  };

  const emitter = createEmitter();
  attachChronicle(emitter);
  const huntOver = (payload) => {
    if (payload && Number.isFinite(payload.at)) ctx.huntEndedAt = payload.at;
  };
  emitter.on("hunt:ended", huntOver);
  emitter.on("hunt:death", huntOver);
  // The news goes out without the save it happened in.
  const news = [];
  emitter.on("*", (payload, type) => {
    if (!NEWS.has(type) || !payload) return;
    const { state: _state, ...rest } = payload;
    news.push({ type, ...rest });
  });
  ctx.env = makeEnv({ emitter, party: { intervals: await partyIntervals(q, userId) }, fx: false });

  // 3. Housekeeping for everyone: a few expired listings go home.
  await expireListings(q, t);

  // 4. The post. A request that starts over leaves it waiting for the new camp.
  if (!(ctx.alone && commands[0].type === "resetCamp")) await claimMail(ctx);

  /* 4b. The party's fight, locked before any command runs. Taking it here fixes the lock order
     for every request (the save, the post, then party hunts, then anything a command touches),
     so two members of one party can never hold half of each other's work. */
  await lockPartyHunts(ctx);

  // 5. The commands, each at its own moment.
  const clockBefore = ctx.state.clock;
  const results = [];
  for (const cmd of commands) {
    const at = clamp(cmd.at, Math.max(ctx.state.clock, t - LATE_MS), t);
    if (!advanceTo(ctx, at)) {
      results.push({ id: cmd.id, ok: false, error: CATCHING_UP });
      continue;
    }
    const hunting = !!ctx.state.tasks.combat;
    const res = await runCommand(ctx, cmd);
    if (hunting && !ctx.state.tasks.combat) ctx.huntEndedAt = ctx.state.clock;
    results.push(resultOf(cmd.id, res));
  }

  // 6. Now.
  advanceTo(ctx, t);

  /* 6a. Marked ready while the party went out: fall in behind them. The save has to be at now
     first, or a camp that was away for an hour would walk onto the ground an hour behind the
     fight it is joining. */
  await fallIn(ctx);

  /* 6b. The party's share, after the catch-up and not before it: the save's clock is now, so the
     multipliers a share is paid with are the ones the player is actually under, and a bounty buff
     claimed hours ago has already run out rather than doubling half a day of somebody else's
     fighting. */
  await settlePartyHunts(ctx);

  // 7. Welcome back.
  const awayMs = ctx.state.clock - clockBefore;
  if (ctx.away && !ctx.reset && !ctx.behind && awayMs > AWAY_MS) {
    announce(ctx, "away", summariseAway(ctx.away.before, ctx.away.after, awayMs));
  }

  // 8 to 10. Write it all back.
  const stateJson = JSON.stringify(ctx.state);
  await writeSave(ctx, stateJson);
  await writeProfile(ctx);
  await writePresence(ctx);
  await writePartyHunts(ctx);

  // The fight as a watcher may see it: no seed, no dice, no stat lines (section 9 below).
  const live = ctx.party.live;
  const party = live ? `,"party":${JSON.stringify(sessionView(live.session))}` : "";
  return `{"ok":true,"v":${ENGINE_VERSION},"now":${t},"state":${stateJson},"results":${JSON.stringify(results)},"events":${JSON.stringify(news)}${party}}`;
}

/* ================= 4. SAVES AND ACCOUNTS ================= */

// The engine column says who wrote the row (null: a v4 browser). The database measures the data
// and withholds it past the limit, so an oversized row is never sent, let alone parsed.
async function lockSave(q, userId) {
  const rows = await q(
    `select s.engine, s.username, x.bytes,
            case when x.bytes > $2::int then null else s.data end as data
     from public.saves s
     cross join lateral (select octet_length(s.data::text) as bytes) x
     where s.user_id = $1::uuid
     for update of s`,
    [userId, MAX_SAVE_BYTES],
  );
  const r = rows[0];
  if (!r) return null;
  const bytes = Number(r.bytes) || 0;
  return { engine: r.engine, username: r.username, data: r.data, bytes, tooBig: bytes > MAX_SAVE_BYTES };
}

async function createSave(q, userId, account, t) {
  const fresh = createState({ now: t, seed: freshSeed(), userId, account });
  const rows = await q(
    `insert into public.saves (user_id, username, data, rev, engine, clock, updated_at)
     values ($1::uuid, $2, $3::text::jsonb, 0, $4::int, $5::bigint, now())
     on conflict (user_id) do nothing
     returning engine, username, data`,
    [userId, account, JSON.stringify(fresh), ENGINE_VERSION, fresh.clock],
  );
  // Another first request from the same player got there first: wait for it and use its row.
  if (!rows[0]) return lockSave(q, userId);
  return { ...rows[0], bytes: 0, tooBig: false };
}

/* The name a player is known by, best first: the one on their own save row (it came with their
   v4 account), their email's local part (v4 accounts are <username>@players.respite), then p_
   and hex of their id. An email that only looks like somebody's name never takes it from them:
   migration 003 gives every v4 save its profile before anyone signs up again. */
function nameCandidates(user, savedName) {
  const email = typeof user.email === "string" ? user.email : "";
  const at = email.lastIndexOf("@");
  const local = at > 0 ? email.slice(0, at).toLowerCase() : "";
  const hex = user.id.replace(/-/g, "").toLowerCase();
  const names = [];
  if (typeof savedName === "string" && USERNAME_RE.test(savedName)) names.push(savedName);
  if (USERNAME_RE.test(local) && local !== names[0]) names.push(local);
  names.push(`p_${hex.slice(0, 8)}`, `p_${hex.slice(0, 18)}`);
  return names;
}

// A name already on a profile never changes: parties and invites carry it.
async function accountFor(q, user, savedName) {
  const names = nameCandidates(user, savedName);
  const rows = await q(
    `select user_id::text as user_id, username
     from public.profiles
     where user_id = $1::uuid or username in (select jsonb_array_elements_text($2::text::jsonb))`,
    [user.id, JSON.stringify(names)],
  );
  const own = rows.find((r) => r.user_id === user.id.toLowerCase());
  if (own) return own.username;
  const taken = new Set(rows.map((r) => r.username));
  return names.find((n) => !taken.has(n)) || names[names.length - 1];
}

/* Party members' hunts, as the rules want them for the shared-ground bonus. A member counts only
   while they are around: a hunt can run twelve hours with nobody at the camp, so an interval ends
   three minutes after the member was last seen (a game request or a heartbeat), if not sooner.
   An alt that sets out and goes quiet stops lending its bonus. The browser applies the same rule
   to party_state's last_seen. */
async function partyIntervals(q, userId) {
  const rows = await q(
    `select h.tier,
            h.zone,
            (extract(epoch from h.started_at) * 1000)::float8 as start_ms,
            (extract(epoch from least(coalesce(h.ended_at, h.ends_by), p.last_seen + interval '3 minutes')) * 1000)::float8 as end_ms
     from public.party_members me
     join public.party_members m on m.party_id = me.party_id and m.user_id <> me.user_id
     join public.hunt_presence h on h.user_id = m.user_id
     join public.profiles p on p.user_id = m.user_id and p.last_seen is not null
     where me.user_id = $1::uuid`,
    [userId],
  );
  return rows.map((r) => ({
    tier: Number(r.tier),
    zone: r.zone,
    start: Math.round(Number(r.start_ms)),
    end: Math.round(Number(r.end_ms)),
  }));
}

/* ================= 5. TIME ================= */

// The rules give the same result however time is cut, so a long absence is played in slices
// and the request stops once it has spent its budget. The next request carries on from there.
// The first call is the catch-up; its before and after feed the welcome-back line.
function advanceTo(ctx, target) {
  if (ctx.behind) return false;
  const first = !ctx.away;
  const before = first ? awaySnapshot(ctx.state) : null;
  const goal = Math.floor(target);
  while (ctx.state.clock < goal) {
    const from = ctx.state.clock;
    const started = wallMs();
    advance(ctx.state, Math.min(goal, from + SLICE_MS), ctx.env);
    ctx.spent += wallMs() - started;
    if (ctx.state.clock <= from) throw new Error(`advance stalled at ${from}`);
    if (ctx.state.clock < goal && ctx.spent >= ctx.budget) {
      ctx.behind = true;
      break;
    }
  }
  if (first) ctx.away = { before, after: awaySnapshot(ctx.state) };
  return !ctx.behind;
}

/* ================= 6. COMMANDS ================= */

// The market, party hunts and starting over need the database; the rules answer everything else,
// unknown types included.
async function runCommand(ctx, cmd) {
  if (cmd.type === "resetCamp") return ctx.alone ? resetCamp(ctx) : { ok: false, error: START_OVER_ALONE };
  if (Object.hasOwn(MARKET, cmd.type)) return MARKET[cmd.type](ctx, cmd.args);
  if (Object.hasOwn(PARTY, cmd.type)) return PARTY[cmd.type](ctx, cmd.args);
  /* One hunter, one fight. The rules would happily start a second one, and then two engines would
     be moving the same health: the party's, on the server's clock, and the save's own. */
  if (cmd.type === "startHunt" && ctx.party.live) return refuse(PARTY_OUT);
  return guarded(ctx, `command ${cmd.type}`, () => applyCommand(ctx.state, { type: cmd.type, args: cmd.args }, ctx.env));
}

// Rules code touches only the save, so if it throws the save can be put back from a copy and
// the rest of the request goes on. A bug in one command must not lock a player out.
function guarded(ctx, what, fn) {
  const copy = JSON.stringify(ctx.state);
  try {
    return fn();
  } catch (err) {
    ctx.state = JSON.parse(copy);
    ctx.logError(`game: ${what} threw`, err);
    return { ok: false, error: "server_error" };
  }
}

function resultOf(id, res) {
  if (!isObject(res)) return { id, ok: false, error: "server_error" };
  if (res.ok !== true) return { id, ok: false, error: typeof res.error === "string" ? res.error : "Refused." };
  return res.data === undefined ? { id, ok: true } : { id, ok: true, data: res.data };
}

// Events the server raises itself go out the way the rules send theirs, dated and filed.
const announce = (ctx, type, payload) => emit(ctx.state, ctx.env, type, payload);

/* ================= 7. THE POST ================= */

async function expireListings(q, t) {
  const gone = await q(
    `with due as (
       select id
       from public.market_listings
       where status = 'open' and expires_at <= to_timestamp($1::float8 / 1000)
       order by expires_at, id
       limit ${EXPIRE_BATCH}
       for update skip locked
     )
     update public.market_listings l
     set status = 'expired', updated_at = now()
     from due
     where l.id = due.id
     returning l.seller_id::text as seller_id, l.item_key, l.item_name, l.qty_left`,
    [t],
  );
  const letters = gone
    .filter((r) => Number(r.qty_left) > 0)
    .map((r) => ({
      user_id: r.seller_id,
      item_key: r.item_key,
      qty: Number(r.qty_left),
      note: `Your listing of ${fmtWhole(r.qty_left)} ${r.item_name} expired.`,
    }));
  if (!letters.length) return;
  await q(
    `insert into public.mail (user_id, kind, item_key, qty, note)
     select r.user_id, 'item', r.item_key, r.qty, r.note
     from jsonb_to_recordset($1::text::jsonb) as r(user_id uuid, item_key text, qty int, note text)`,
    [JSON.stringify(letters)],
  );
}

async function claimMail(ctx) {
  const rows = await ctx.q(
    `select id, kind, gold, item_key, qty, note
     from public.mail
     where user_id = $1::uuid and claimed_at is null
     order by id
     limit ${MAIL_BATCH}
     for update`,
    [ctx.userId],
  );
  if (!rows.length) return;
  const letters = rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    gold: Number(r.gold),
    item_key: r.item_key,
    qty: Number(r.qty),
    note: r.note,
  }));
  const res = guarded(ctx, "applyMail", () => applyMail(ctx.state, letters, ctx.env));
  const sent = new Set(letters.map((l) => l.id));
  const claimed = isObject(res) && Array.isArray(res.claimed) ? res.claimed.filter((id) => sent.has(id)) : [];
  if (!claimed.length) return;
  await ctx.q(
    `update public.mail
     set claimed_at = now()
     where user_id = $1::uuid and id in (select (jsonb_array_elements_text($2::text::jsonb))::bigint)`,
    [ctx.userId, JSON.stringify(claimed)],
  );
}

/* ================= 8. THE MARKET ================= */
/* The rules own the save side (market.js); these own rows, locks and letters.
   Every refusal comes before the first write, so a refused command changes nothing.

   Two counters, because two kinds of goods:

   - Materials are fungible, so their listings are a pool. A buyer names an item, a
     quantity and the most they will pay each, and marketBuyPool fills it cheapest
     first, oldest first among equal prices, across as many sellers as it takes. They
     never see a listing, an id or a seller, and no listing id of a material's ever
     reaches a buyer, so there is nothing to aim at.
   - Gear and tools are not: every piece is its own row, bought by id as before.

   Nobody's name leaves here either way. market_sales keeps both sides (moderation and
   a later traders board need them) and the letter it posts says what sold, not who
   bought it. Migration 007 closes the same doors in the database. */

const listingIdOf = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);
const FILL_ROWS = 25;                       // listings one pool buy may walk; past that it fills what it can
const NOT_POOLED = "That is sold piece by piece.";
const POOLED = "Buy materials from the pool.";

async function marketList(ctx, args) {
  const max = CONFIG.economy.marketMaxListings;
  const [{ open, recent }] = await ctx.q(
    `select count(*) filter (where status = 'open')::int as open,
            count(*) filter (where created_at > to_timestamp($2::float8 / 1000))::int as recent
     from public.market_listings
     where seller_id = $1::uuid and (status = 'open' or created_at > to_timestamp($2::float8 / 1000))`,
    [ctx.userId, ctx.t - HOUR_MS],
  );
  if (Number(open) >= max) return { ok: false, error: `You already have ${max} listings open.` };
  if (Number(recent) >= LISTINGS_PER_HOUR) return { ok: false, error: `Slow down. The market takes ${LISTINGS_PER_HOUR} listings an hour.` };
  // The listing's quantity is a Postgres int.
  if (typeof args.qty === "number" && args.qty > PG_INT_MAX) return { ok: false, error: "That is too many to list at once." };

  // Takes the goods out of the save and logs the listing.
  const prep = prepareListing(ctx.state, { key: args.key, from: args.from, qty: args.qty, price: args.price }, ctx.env);
  if (!isObject(prep) || !prep.ok) return { ok: false, error: prep && prep.error };
  const d = prep.data;

  // Made and expiring on the game's clock, the one the hourly count above reads.
  const expires = ctx.t + CONFIG.economy.marketListingDays * CONFIG.time.dayMs;
  const [row] = await ctx.q(
    `insert into public.market_listings
       (seller_id, seller_name, item_key, item_base, item_name, item_kind, item_tier, rarity,
        qty, qty_left, price_each, created_at, expires_at)
     values ($1::uuid, $2, $3, $4, $5, $6, $7::int, $8, $9::int, $9::int, $10::bigint,
             to_timestamp($11::float8 / 1000), to_timestamp($12::float8 / 1000))
     returning id`,
    [ctx.userId, ctx.account, d.key, d.base, d.name, d.kind, d.tier ?? null, d.rarity ?? null, d.qty, d.priceEach, ctx.t, expires],
  );
  return { ok: true, data: { listingId: Number(row.id) } };
}

async function marketBuy(ctx, args) {
  const listingId = listingIdOf(args.listingId);
  if (!listingId) return GONE;
  const qty = args.qty;
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "Choose how many to buy." };

  const [l] = await ctx.q(
    `select seller_id::text as seller_id, item_key, item_name, item_kind, qty_left, price_each, status,
            expires_at <= to_timestamp($2::float8 / 1000) as expired
     from public.market_listings
     where id = $1::bigint
     for update`,
    [listingId, ctx.t],
  );
  if (!l || l.status !== "open" || l.expired) return GONE;
  if (l.seller_id === ctx.userId.toLowerCase()) return { ok: false, error: "You can't buy your own listing." };
  /* A material is bought from its pool, by name and by price, never by id: an id is the one
     thing that could pick a seller out of the pool, so it buys nothing here. */
  if (l.item_kind === "material") return { ok: false, error: POOLED };
  const left = Number(l.qty_left);
  if (qty > left) return { ok: false, error: `Only ${fmtWhole(left)} left.` };

  // The price is the listing's, never the buyer's.
  const priceEach = Number(l.price_each);
  const goods = priceEach * qty;
  if (!Number.isSafeInteger(goods)) return { ok: false, error: "Not enough gold." };
  // Both legs, off the same asking price: the buyer pays it on top, the seller has it taken out.
  const fee = marketFee(goods);
  const key = remintKey(l.item_key, listingId);

  const bought = applyPurchase(ctx.state, { key, qty, goods, fee }, ctx.env);
  if (!isObject(bought) || !bought.ok) return { ok: false, error: bought && bought.error };

  // Paid for: from here on nothing refuses. One statement moves the stock, logs the sale and
  // posts the seller's gold. The letter says what sold, never who bought it.
  const note = `Sold ${fmtWhole(qty)} ${l.item_name} for ${fmtGold(goods)}. The market kept ${fmtGold(fee)}.`;
  await ctx.q(
    `with sold as (
       update public.market_listings
       set qty_left = qty_left - $2::int,
           status = case when qty_left = $2::int then 'sold' else 'open' end,
           updated_at = now()
       where id = $1::bigint
       returning id, seller_id, item_key, item_name, price_each
     ), sale as (
       insert into public.market_sales (listing_id, seller_id, buyer_id, item_key, item_name, qty, price_each, fee, buyer_fee)
       select id, seller_id, $3::uuid, item_key, item_name, $2::int, price_each, $4::bigint, $4::bigint
       from sold
     )
     insert into public.mail (user_id, kind, gold, note)
     select seller_id, 'gold', $5::bigint, $6
     from sold`,
    [listingId, qty, ctx.userId, fee, goods - fee, note],
  );
  return { ok: true, data: { listingId, key, qty, cost: goods + fee, fee } };
}

/* A pool buy. The buyer names the item, how many and the most they will pay each, which is
   the dearest price the market showed them; anything above it is left alone, so a band
   drained by somebody else between the drawing and the press refuses instead of quietly
   charging more. Partial fills are ordinary and the result says how many were had.

   The race: the rows are locked in exactly the order they are filled (price, then age, then
   id), which is the order every other buyer takes them in too, so two buyers after one pool
   queue up rather than deadlock. The second one's select waits, then re-reads the rows the
   first one left behind (Postgres hands a locked row back at its new version), so it fills
   from what is actually there. Nothing is written until the buyer's gold and the room for
   the goods are both settled, and it is all one transaction with the save. */
async function marketBuyPool(ctx, args) {
  const key = args.key;
  const d = validKey(key) ? itemDef(key) : null;
  if (!d) return { ok: false, error: "No such item." };
  if (d.kind !== "material") return { ok: false, error: NOT_POOLED };
  const qty = args.qty;
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "Choose how many to buy." };
  if (qty > PG_INT_MAX) return { ok: false, error: "That is too many to buy at once." };
  const maxEach = args.maxEach;
  if (!Number.isInteger(maxEach) || maxEach < 1 || maxEach > CONFIG.economy.marketMaxPrice) {
    return { ok: false, error: "Name the most you will pay each." };
  }

  const rows = await ctx.q(
    `select id, qty_left, price_each::float8 as price_each,
            (extract(epoch from created_at) * 1000)::float8 as created_ms
     from public.market_listings
     where status = 'open'
       and item_kind = 'material'
       and item_key = $1
       and seller_id <> $2::uuid
       and qty_left > 0
       and price_each <= $3::bigint
       and expires_at > to_timestamp($4::float8 / 1000)
     order by price_each, created_at, id
     limit ${FILL_ROWS}
     for update`,
    [key, ctx.userId, maxEach, ctx.t],
  );

  const plan = fillPool(
    rows.map((r) => ({
      id: Number(r.id), qtyLeft: Number(r.qty_left), priceEach: Number(r.price_each), at: Number(r.created_ms),
    })),
    { qty, maxEach, gold: ctx.state.player.gold },
  );
  if (!isObject(plan) || !plan.ok) return { ok: false, error: plan && plan.error };
  const { fills, units, goods, fee, total, short } = plan.data;

  const bought = applyPurchase(ctx.state, { key, qty: units, goods, fee }, ctx.env);
  if (!isObject(bought) || !bought.ok) return { ok: false, error: bought && bought.error };

  // Paid for: from here on nothing refuses. Every seller's listing, sale and letter in one go.
  const name = itemName(key);
  const legs = fills.map((f) => {
    const leg = f.qty * f.priceEach;
    const cut = marketFee(leg);
    return {
      id: f.id, qty: f.qty, fee: cut, buyer_fee: f.buyerFee, gold: leg - cut,
      note: `Sold ${fmtWhole(f.qty)} ${name} for ${fmtGold(leg)}. The market kept ${fmtGold(cut)}.`,
    };
  });
  await ctx.q(
    `with f as (
       select * from jsonb_to_recordset($1::text::jsonb)
         as t(id bigint, qty int, fee bigint, buyer_fee bigint, gold bigint, note text)
     ), sold as (
       update public.market_listings l
       set qty_left = l.qty_left - f.qty,
           status = case when l.qty_left = f.qty then 'sold' else 'open' end,
           updated_at = now()
       from f
       where l.id = f.id
       returning l.id, l.seller_id, l.item_key, l.item_name, l.price_each,
                 f.qty as took, f.fee as fee, f.buyer_fee as buyer_fee, f.gold as gold, f.note as note
     ), sale as (
       insert into public.market_sales (listing_id, seller_id, buyer_id, item_key, item_name, qty, price_each, fee, buyer_fee)
       select id, seller_id, $2::uuid, item_key, item_name, took, price_each, fee, buyer_fee
       from sold
     )
     insert into public.mail (user_id, kind, gold, note)
     select seller_id, 'gold', gold, note
     from sold`,
    [JSON.stringify(legs), ctx.userId],
  );
  return { ok: true, data: { key, qty: units, cost: total, fee, asked: qty, short } };
}

async function marketCancel(ctx, args) {
  const listingId = listingIdOf(args.listingId);
  if (!listingId) return GONE;
  const [l] = await ctx.q(
    `select item_key, qty_left, status
     from public.market_listings
     where id = $1::bigint and seller_id = $2::uuid
     for update`,
    [listingId, ctx.userId],
  );
  if (!l || l.status !== "open") return GONE;

  // Brings the goods home and logs it, or refuses with the listing left open.
  const qty = Number(l.qty_left);
  const back = applyReturn(ctx.state, { key: l.item_key, qty }, ctx.env);
  if (!isObject(back) || !back.ok) return { ok: false, error: back && back.error };

  await ctx.q("update public.market_listings set status = 'cancelled', updated_at = now() where id = $1::bigint", [listingId]);
  return { ok: true, data: { listingId, key: l.item_key, qty } };
}

const MARKET = Object.freeze({ marketList, marketBuy, marketBuyPool, marketCancel });

/* ================= 9. PARTY HUNTS ================= */

/* A party's fight is nobody's save. Two members are at different clocks, hold dice that cannot be
   synchronised and cannot see each other's stat lines, so neither of them can replay the same
   encounter and agree on it: the fight is a thing of its own, owned and played by the server
   (src/shared/partyHunt.js), and each member is paid out of it on their own next request, the way
   the post is delivered.

   This section owns rows, locks and settlement. Every rule is in the engine. What matters here:

   - The row is never sent to a client. It carries the encounter's seed and the dice position, and
     a client holding those could play the fight forward and know every blow before it lands. Only
     sessionView() leaves this file (migration 006 says how the database keeps to the same rule).
   - A share is paid with the functions a lone kill is paid with, so a party kill is worth what a
     lone one is: addXp for the XP, tx.gold for the gold, the region's Threat counter, the drop
     rolls off the save's own counters, and a fall costs the recovery, the wound and the wear.
   - Settling is once: owedFor() is read, applied, and cleared inside the same transaction as the
     save it was applied to, so a request that fails pays nothing and a request that succeeds
     cannot pay twice. */

/* A session comes back out of jsonb as a tree, and a tree cannot hold one hunter twice: in memory
   the roster and the live encounter share the hunter objects, and after a round trip they are two
   sets of copies of which only the encounter's is the one the fight moves. Point the roster back
   at the encounter's, or a share settled from a stored row would be read off a hunter who stopped
   fighting the moment the row was written. The engine should look its hunters up by id; until it
   does, this is where that hole is plugged (docs/SERVER.md section 3). */
function rehydrate(s) {
  if (!isObject(s) || !Array.isArray(s.hunters)) return s;
  if (!isObject(s.enc) || !Array.isArray(s.enc.hunters)) return s;
  const live = new Map(s.enc.hunters.filter(isObject).map((u) => [u.userId, u]));
  s.hunters = s.hunters.map((u) => (isObject(u) && live.has(u.userId) ? live.get(u.userId) : u));
  return s;
}

const rowOf = (r) => ({
  id: Number(r.id),
  partyId: r.party_id,
  tier: Number(r.tier),
  zone: r.zone,
  members: (jsonOf(r.members) || []).map((id) => String(id).toLowerCase()),
  session: rehydrate(jsonOf(r.session)),
  clock: Number(r.clock),
  startedAt: Number(r.started_at),
  overAt: r.over_at == null ? null : Number(r.over_at),
  dirty: false,
});

// Every column the handler reads, with members as JSON text so both drivers hand it back the same.
const PARTY_COLUMNS = `id, party_id::text as party_id, tier, zone, session,
   clock::float8 as clock, started_at::float8 as started_at, over, over_at::float8 as over_at,
   (select coalesce(jsonb_agg(m::text), '[]'::jsonb) from unnest(members) m) as members`;

/* The sessions this player can still be paid out of: the one their party is on, and any closed one
   they never came back for. Found through `members` rather than through party_members, so leaving
   the party (or being kicked) mid-hunt does not strand a share where nothing can reach it. */
async function lockPartyHunts(ctx) {
  const rows = await ctx.q(
    `select ${PARTY_COLUMNS}
     from public.party_hunts
     where $1::uuid = any(members)
     order by id
     limit ${PARTY_ROWS}
     for update`,
    [ctx.userId],
  );
  for (const r of rows) {
    const row = rowOf(r);
    if (!isObject(row.session) || !Array.isArray(row.session.hunters)) {
      ctx.logError(`game: the party hunt row ${row.id} could not be read; it is left alone`);
      continue;
    }
    ctx.party.rows.push(row);
    // The blob says whether it is still running; the column only mirrors it for the tick's index.
    if (!row.session.over) ctx.party.live = row;
  }
}

/* Plays a session forward to `to`, in slices, stopping when it ends, when it has run as long as a
   lone hunt may, or when it has had its share of this request's time. The rules give the same
   fight however the time is cut (tests/engine/party.test.mjs), so stopping early only means the
   next pass carries on. */
function playParty(row, to, budgetMs) {
  const s = row.session;
  const end = Math.floor(to);
  const started = wallMs();
  while (!s.over && row.clock < end) {
    const capLeft = row.startedAt + PARTY_CAP_MS - row.clock;
    if (capLeft <= 0) {
      s.over = "cap";
      break;
    }
    const step = Math.min(SLICE_MS, end - row.clock, capLeft);
    const played = stepSession(s, step);
    row.clock += played;
    row.dirty = true;
    // Nothing moved, or it ended inside the slice: either way there is no more to play.
    if (played <= 0 || played < step) break;
    if (wallMs() - started >= budgetMs) break;
  }
  // A session with nobody left in it is finished, however it emptied.
  if (!s.over && !s.hunters.length) s.over = "empty";
  return row;
}

// Out of the fight and off the roster: they have been paid, or they walked away.
function dropHunter(row, uid) {
  const s = row.session;
  s.hunters = s.hunters.filter((u) => !isObject(u) || u.userId !== uid);
  if (isObject(s.enc) && Array.isArray(s.enc.hunters)) {
    s.enc.hunters = s.enc.hunters.filter((u) => !isObject(u) || u.userId !== uid);
  }
  row.members = row.members.filter((id) => id !== uid);
  if (!s.over && !s.hunters.length) s.over = "empty";
  row.dirty = true;
}

/* The hunter as the fight sees them: the stats and the remedies they set out with, with the rest
   they have had at camp counted exactly as a lone hunt setting out counts it. Nothing is written
   to the save here, because setting out can still be refused after this (a party that set out in
   the same instant), and a refused command must leave the camp as it found it. */
function muster(ctx, at) {
  const state = ctx.state;
  const plan = campPlan(state, at) || { hp: state.player.hp };
  return { plan, hunter: makeHunter(ctx.uid, statsOf(state), { hp: plan.hp, heals: remedyHeals(state) }) };
}

/* They are out. The camp's note goes with the walk it owed: the party keeps its own rhythm, and
   the fight they are joining is already in it. */
function setOut(ctx, plan) {
  ctx.state.player.hp = plan.hp;
  ctx.state.player.camp = null;
}

async function partyOf(q, userId) {
  const [m] = await q("select party_id::text as party_id from public.party_members where user_id = $1::uuid", [userId]);
  return m ? m.party_id : null;
}

// What both ways in to a fight refuse on: one hunter, one fight, and not while they are laid up.
function readyToSetOut(ctx) {
  if (ctx.state.tasks.combat) return "Pull back before you set out with your party.";
  if (recovering(ctx.state)) return "You're still recovering.";
  return null;
}

async function partyHuntStart(ctx, args) {
  const partyId = await partyOf(ctx.q, ctx.userId);
  if (!partyId) return refuse("You are not in a party.");
  if (ctx.party.live) return refuse("Your party is already out.");
  const no = readyToSetOut(ctx);
  if (no) return refuse(no);

  const tier = args.tier;
  const region = Number.isInteger(tier) ? regionOfTier(tier) : null;
  if (!region || !ctx.state.travel.unlocked.includes(region.id)) return refuse("That ground isn't open.");
  const zone = args.zone;
  if (typeof zone !== "string" || !GameData.ZONES.some((z) => z.id === zone)) return refuse("No such zone.");

  const at = ctx.state.clock;
  const { plan, hunter } = muster(ctx, at);
  const session = newSession({ partyId, tier, zone, seed: freshSeed(), hunters: [hunter] });
  const [ins] = await ctx.q(
    `insert into public.party_hunts (party_id, tier, zone, members, session, view, clock, started_at, next_due)
     values ($1::uuid, $2::int, $3, array[$4::uuid], $5::text::jsonb, $6::text::jsonb, $7::bigint, $7::bigint, $8::bigint)
     on conflict do nothing
     returning id`,
    [partyId, tier, zone, ctx.userId, JSON.stringify(session), JSON.stringify(sessionView(session)),
      Math.round(at), Math.round(at + nextSessionDue(session))],
  );
  // The partial unique index refused it: somebody else in the party set out in the same instant.
  if (!ins) return refuse("Your party is already out.");
  setOut(ctx, plan);
  /* The host is on the ground, so their own mark has been spent. Everyone else's stands until
     their next request walks them on (fallIn), which is what sets a ready party out together. */
  await ctx.q("update public.party_members set ready = false where user_id = $1::uuid", [ctx.userId]);

  const row = {
    id: Number(ins.id), partyId, tier, zone, members: [ctx.uid], session,
    clock: at, startedAt: at, overAt: null, dirty: false,
  };
  ctx.party.rows.push(row);
  ctx.party.live = row;
  return { ok: true, data: { tier, zone } };
}

async function partyHuntJoin(ctx) {
  const partyId = await partyOf(ctx.q, ctx.userId);
  if (!partyId) return refuse("You are not in a party.");
  if (ctx.party.live) return refuse(PARTY_OUT);
  const no = readyToSetOut(ctx);
  if (no) return refuse(no);

  const [r] = await ctx.q(
    `select ${PARTY_COLUMNS} from public.party_hunts where party_id = $1::uuid and not over for update`,
    [partyId],
  );
  if (!r) return refuse("Your party isn't out.");
  const row = rowOf(r);
  if (!isObject(row.session) || !Array.isArray(row.session.hunters)) return refuse("Your party isn't out.");
  // Held from here on however this ends, so the catch-up below is not played twice for nothing.
  ctx.party.rows.push(row);
  if (row.session.hunters.length >= CONFIG.party.maxSize) return refuse("The party is full.");

  /* The fight has to be at this moment before anyone is added to it, or a session nobody has
     watched for an hour would pay its newest member for the hour they were not there. */
  const at = ctx.state.clock;
  if (!playSafely(ctx, row, at) || row.clock < at) return refuse(CATCHING_UP_FIGHT);
  if (row.session.over) return refuse("Your party isn't out.");

  /* Whoever joins comes in on the walk, not into the middle of the encounter: the roster of foes
     was drawn for the party that walked into it, and dropping a hunter in mid fight would either
     hand them a free kill or hand the others a free pair of hands. */
  const { plan, hunter } = muster(ctx, at);
  setOut(ctx, plan);
  row.session.hunters.push(hunter);
  row.members.push(ctx.uid);
  row.dirty = true;
  ctx.party.live = row;
  return { ok: true, data: { tier: row.tier, zone: row.zone } };
}

/* Setting out is the whole party's, not the host's. The press cannot reach into four other saves
   to do it -- each of them has its own catch-up, its own health and its own lock, and one request
   holding five save rows is how two members of one party deadlock each other. So the host's press
   opens the ground and everybody who marked ready walks on under their own request, which is the
   next one their browser makes: a second or two, and every check is done in the camp it is about.

   The mark is the standing instruction. It is taken down the moment it is acted on, so breaking
   away is breaking away rather than a camp that keeps rejoining the fight it just left. */
async function fallIn(ctx) {
  if (ctx.party.live) return;              // already out with them
  if (readyToSetOut(ctx)) return;          // laid up, or on a hunt of their own
  const [m] = await ctx.q(
    `select p.id
     from public.party_members m
     join public.party_hunts p on p.party_id = m.party_id and not p.over
     where m.user_id = $1::uuid and m.ready
     limit 1`,
    [ctx.userId],
  );
  if (!m) return;
  const res = await partyHuntJoin(ctx);
  /* The mark comes down once it has been acted on, and stays up only while the answer is "not
     yet": a fight still catching up is a moment, a full party is not, and a mark nobody ever
     takes down locks a row on every request this camp makes for the rest of the session. */
  if (!res.ok && res.error === CATCHING_UP_FIGHT) return;
  await ctx.q("update public.party_members set ready = false where user_id = $1::uuid", [ctx.userId]);
  if (res.ok) announce(ctx, "party:fellin", { tier: res.data.tier, zone: res.data.zone });
}

async function partyHuntLeave(ctx) {
  const row = ctx.party.live;
  if (!row) return refuse("Your party isn't out.");
  // Played up to the moment they walked off, so they are paid for every blow they were there for.
  if (!playSafely(ctx, row, ctx.state.clock)) return { ok: false, error: "server_error" };
  const res = settleOne(ctx, row);
  if (!res.ok) return res;
  dropHunter(row, ctx.uid);
  return { ok: true, data: { tier: row.tier, zone: row.zone, kills: res.took ? res.took.kills : 0 } };
}

const PARTY = Object.freeze({ partyHuntStart, partyHuntJoin, partyHuntLeave });

/* Every session this player is owed something out of, brought up to now and paid out. A member
   with a tab open therefore moves their party's fight along on their own requests, and a party
   with anybody online never waits for the cron. */
async function settlePartyHunts(ctx) {
  for (const row of ctx.party.rows) {
    if (!row.members.includes(ctx.uid)) continue;
    if (!playSafely(ctx, row, ctx.state.clock)) continue;
    const res = settleOne(ctx, row);
    if (res.ok && res.took) announce(ctx, "party:spoils", res.took);
  }
}

/* A session that throws is left exactly as it was found and the request goes on: a camp must not
   become unplayable because of a fight in a row somewhere. The tick would choke on the same row,
   so it says which one in the log. */
function playSafely(ctx, row, to) {
  try {
    playParty(row, to, PARTY_STEP_MS);
    return true;
  } catch (err) {
    row.dirty = false;
    ctx.logError(`game: the party hunt ${row.id} could not be played`, err);
    return false;
  }
}

/* The save is put back if the rules throw halfway through paying, so a share arrives whole or not
   at all and what was not paid is still owed in the row. */
function settleOne(ctx, row) {
  const res = guarded(ctx, `a share of party hunt ${row.id}`, () => ({ ok: true, took: settleParty(ctx, row) }));
  return isObject(res) && res.ok === true ? res : { ok: false, error: "server_error" };
}

/* One member's share, out of the session and into their save. Everything here is what the lone
   hunt's hooks in combat.js do, in the same order and through the same functions, so a kill shared
   with the party is worth what a kill alone is. */
function settleParty(ctx, row) {
  const s = row.session;
  const owed = owedFor(s, ctx.uid);
  if (!owed) return null;
  const state = ctx.state;
  const env = ctx.env;
  const at = state.clock;
  const H = CONFIG.hunt;
  const hunter = s.hunters.find((u) => isObject(u) && u.userId === ctx.uid) || null;
  const drops = Array.isArray(owed.drops) ? owed.drops : [];
  const took = {
    tier: row.tier, zone: row.zone, kills: owed.kills, xp: 0, gold: 0,
    drops: 0, remedies: owed.remedies, died: owed.died || null,
  };
  // Carried through the same fight, so it pays the same as a lone kill's would.
  if (owed.mastery > 0) addMastery(state, owed.mastery);
  // A member syncing every few seconds is owed nothing most times: that is not news.
  const nothing = !(owed.kills || owed.xp > 0 || owed.gold > 0 || owed.remedies || owed.died || drops.length);

  /* Health follows the fight, and is set before the XP below: a level refills it, exactly as it
     does mid hunt alone. */
  if (hunter) state.player.hp = clamp(hunter.hp, 0, maxHp(state));

  // What was drunk in the fight comes off the Satchel now: the fight only ever held a list of heals.
  for (let i = 0; i < owed.remedies; i++) {
    const key = bestRemedy(state);
    const pool = key ? ORDER.eat.find((w) => qtyIn(state, w, key) > 0) : null;
    if (!pool) break;
    transact(state, (tx) => tx.remove(pool, key, 1));
  }

  if (owed.xp > 0) {
    // The same multipliers a lone kill carries, the party's own 5% a member included.
    took.xp = owed.xp * xpMult(state, "warfare", at) * partyMult(env, row.tier, row.zone, at);
    addXp(state, "warfare", took.xp, env, at);
  }
  if (owed.gold > 0) {
    took.gold = Math.round(owed.gold * (1 + companionBonus(state, "gold")));
    if (took.gold > 0) transact(state, (tx) => tx.gold(took.gold, true));
  }

  /* Wear, companion finds and the counters are per kill, as they are alone. The spoils of a kill
     cannot be halved, so the engine gives them to whoever hurt it most: those kills carry the foe
     that died, and are the ones that roll for drops and count toward a bounty. */
  const rng = makeRng(state.rng, "hunt");
  const kills = Math.max(owed.kills, drops.length);
  for (let i = 0; i < kills; i++) {
    const won = drops[i] && drops[i].id ? getMonster(drops[i].id) : null;
    const kKey = `k:${row.tier}`;
    const kN = state.rolls[kKey] || 0;
    state.stats.kills++;
    if (won) {
      bountyProgress(state, "slay", won, env, at);
      took.drops += dropLoot(state, won, !!drops[i].elite, kN, env, at);
    }
    companionFinds(state, "warfare", kKey, kN, env, at);
    state.rolls[kKey] = kN + 1;
  }

  if (owed.died) {
    const mob = getMonster(owed.died);
    state.stats.deaths++;
    if (mob) state.foeDeaths[mob.id] = (state.foeDeaths[mob.id] || 0) + 1;
    /* Exactly what a fall alone costs: one point of health, ten minutes of a lighter Attack,
       every worn piece the worse for it, and a camp note holding that 1 so nothing hands the
       bar back. The wound runs from now rather than from the fall, which the fight does not
       date: a hunter carried home answers for it when they come back to it. */
    state.debuff = { until: at + H.deathDebuffMs, mult: 1 - H.deathDebuff };
    state.player.recoveryLeft = 0;
    state.player.hp = 1;
    state.player.camp = { since: at, hp: 1, walkUntil: at };
    announce(ctx, "hunt:death", { monsterId: owed.died, elapsedMs: Math.round(s.elapsed), at });
  }

  clearOwed(s, ctx.uid);
  row.dirty = true;
  // A hunter who fell is out of the session until they rejoin, and a closed one owes nobody more.
  if (owed.died || s.over) dropHunter(row, ctx.uid);
  return nothing ? null : took;
}

// Where the party is, for the presence row: a party hunt lends its bonus like any other.
function partyPresence(ctx) {
  const row = ctx.party.live;
  if (!row || !row.members.includes(ctx.uid)) return null;
  return { tier: row.tier, zone: row.zone, startedAt: row.startedAt, endsBy: row.startedAt + PARTY_CAP_MS };
}

async function writePartyHunts(ctx) {
  for (const row of ctx.party.rows) {
    if (!row.dirty) continue;
    // Closed, and owing nobody: there is nothing left to come back for.
    if (row.session.over && !row.members.length) {
      await ctx.q("delete from public.party_hunts where id = $1::bigint", [row.id]);
      if (ctx.party.live === row) ctx.party.live = null;
      continue;
    }
    await writePartyRow(ctx.q, row);
  }
}

async function writePartyRow(q, row) {
  const s = row.session;
  const over = !!s.over;
  const due = over ? null : row.clock + nextSessionDue(s);
  await q(
    `update public.party_hunts
     set session = $2::text::jsonb,
         view = $3::text::jsonb,
         clock = $4::bigint,
         next_due = $5::bigint,
         over = $6,
         over_at = case when $6 then coalesce(over_at, $4::bigint) else null end,
         members = (select coalesce(array_agg(value::uuid), '{}'::uuid[]) from jsonb_array_elements_text($7::text::jsonb)),
         rev = rev + 1,
         updated_at = now()
     where id = $1::bigint`,
    [row.id, JSON.stringify(s), JSON.stringify(sessionView(s)), Math.round(row.clock),
      Number.isFinite(due) ? Math.ceil(due) : null, over, JSON.stringify(row.members)],
  );
  row.dirty = false;
}

/* ================= 9b. THE TICK ================= */

/* A party fight is JavaScript, so Postgres cannot play it: pg_cron wakes up, pg_net posts here,
   and this plays every live session forward and writes it back (migration 006 sets it up). It
   carries no user token, so the shared secret is the whole door, and it must bound its own work:
   a batch of rows a pass, a budget of rules time, and one transaction a row so a member's own
   request never waits behind the whole batch. */
async function runTick(db, headers, t, opts) {
  const secret = opts.tickSecret;
  if (typeof secret !== "string" || secret.length < TICK_SECRET_MIN) {
    opts.logError("game: a tick arrived but no tick secret is set; the path is off");
    return reply(401, { ok: false, error: "unauthorized" });
  }
  if (!secretMatches(headerOf(headers, TICK_HEADER), secret)) return reply(401, { ok: false, error: "unauthorized" });

  const started = wallMs();
  let ticked = 0;
  let closed = 0;
  let failed = 0;
  let swept = 0;
  let due = [];
  try {
    due = await withRetry(() => db.transaction((q) => pickDue(q, t)));
  } catch (err) {
    opts.logError("game: the party hunt tick could not read its work", err);
    return reply(500, { ok: false, error: "server_error" });
  }
  for (const id of due) {
    if (wallMs() - started >= opts.tickBudget) break;
    // One transaction a row, so a member's own request never waits behind the whole batch and one
    // session the rules choke on cannot stop the others being played.
    try {
      const row = await withRetry(() => db.transaction((q) => tickOne(q, id, t, opts)));
      if (!row) continue;
      ticked++;
      if (row.session.over) closed++;
    } catch (err) {
      failed++;
      opts.logError(`game: the party hunt ${id} could not be ticked`, err);
    }
  }
  try {
    swept = await withRetry(() => db.transaction((q) => sweepParty(q, t)));
  } catch (err) {
    opts.logError("game: closed party hunts could not be swept up", err);
  }
  return reply(200, { ok: true, due: due.length, ticked, closed, failed, swept });
}

/* The path the cron posts to. Kept apart from the game's own so nothing a player sends can reach
   it by accident, whatever they put in their body. */
function isTickPath(url) {
  if (typeof url !== "string" || !url) return false;
  const path = url.split("?")[0].split("#")[0];
  return /\/tick\/?$/.test(path);
}

// Compared whole, so a wrong answer never says how much of it was right.
function secretMatches(given, secret) {
  if (typeof given !== "string" || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

async function pickDue(q, t) {
  const rows = await q(
    `select id
     from public.party_hunts
     where not over and (next_due is null or next_due <= $1::bigint)
     order by next_due nulls first, id
     limit ${TICK_ROWS}`,
    [t],
  );
  return rows.map((r) => Number(r.id));
}

async function tickOne(q, id, t, opts) {
  const [r] = await q(
    `select ${PARTY_COLUMNS} from public.party_hunts where id = $1::bigint and not over for update`,
    [id],
  );
  if (!r) return null;
  const row = rowOf(r);
  if (!isObject(row.session) || !Array.isArray(row.session.hunters)) {
    opts.logError(`game: the party hunt row ${row.id} could not be read; it is left alone`);
    return null;
  }
  // A member's own request may have played it already while this pass was picking rows up.
  if (row.clock >= t) return null;
  playParty(row, t, opts.tickBudget);
  await writePartyRow(q, row);
  return row;
}

/* Closed sessions nobody came back for. A member who never returns must not keep their party's old
   fight on the books for ever, and their share goes with it. */
async function sweepParty(q, t) {
  const gone = await q(
    "delete from public.party_hunts where over and over_at is not null and over_at < $1::bigint returning id",
    [t - PARTY_KEEP_MS],
  );
  return gone.length;
}

/* ================= 10. STARTING OVER ================= */

/* A fresh camp under the same name. Open listings are cancelled and their goods lost; letters
   stay in the post for the new camp. The dice do not start over: starting over is free, so a
   camp that got new streams, counters or ids could be rerolled until it promised something
   (a relic agent, a lucky hunt). The new camp keeps the old one's rng, rolls and serial. */
async function resetCamp(ctx) {
  const old = ctx.state;
  const fresh = createState({ now: old.clock, seed: old.rng.seed, userId: ctx.userId, account: ctx.account });
  fresh.rng = { ...old.rng };
  fresh.rolls = { ...old.rolls };
  fresh.serial = old.serial;
  fresh.log = [{ t: fresh.clock, m: "You start over from a ruin." }];
  /* The only other statement that takes more than one listing lock, so it takes them in the
     same order a pool buy does (price, then age, then id). Two transactions that agree on the
     order of any two rows cannot hold half of each other's work. */
  await ctx.q(
    `with mine as (
       select id
       from public.market_listings
       where seller_id = $1::uuid and status = 'open'
       order by price_each, created_at, id
       for update
     )
     update public.market_listings l
     set status = 'cancelled', updated_at = now()
     from mine
     where l.id = mine.id`,
    [ctx.userId],
  );
  await ctx.q("delete from public.hunt_presence where user_id = $1::uuid", [ctx.userId]);
  // The party fights on without them: a camp that starts over leaves its share behind with the rest.
  ctx.party.rows.forEach((row) => dropHunter(row, ctx.uid));
  ctx.party.live = null;
  ctx.state = fresh;
  ctx.reset = true;
  return { ok: true };
}

/* ================= 11. WRITING BACK ================= */

async function writeSave(ctx, stateJson) {
  await ctx.q(
    `update public.saves
     set data = $2::text::jsonb, rev = rev + 1, engine = $3::int, clock = $4::bigint, username = $5, updated_at = now()
     where user_id = $1::uuid`,
    [ctx.userId, stateJson, ENGINE_VERSION, ctx.state.clock, ctx.account],
  );
}

// last_seen is on the game's clock, like the hunt presence it caps (partyIntervals). Heartbeats
// write the database's now(); in production the two agree to a few milliseconds.
async function writeProfile(ctx) {
  const levels = {};
  const skills = {};
  for (const id of SKILL_IDS) {
    levels[id] = skillLevel(ctx.state, id);
    skills[id] = Math.round((Number(ctx.state.skills[id]) || 0) * 100) / 100;
  }
  await ctx.q(
    `insert into public.profiles (user_id, username, total_level, levels, skills, last_seen, updated_at)
     values ($1::uuid, $2, $3::int, $4::text::jsonb, $5::text::jsonb, to_timestamp($6::float8 / 1000), now())
     on conflict (user_id) do update
     set username = excluded.username,
         total_level = excluded.total_level,
         levels = excluded.levels,
         skills = excluded.skills,
         last_seen = excluded.last_seen,
         updated_at = excluded.updated_at`,
    [ctx.userId, ctx.account, totalLevel(ctx.state), JSON.stringify(levels), JSON.stringify(skills), ctx.t],
  );
}

// While the hunt runs the row says where, since when and the latest it can last (the rules'
// twelve hours: started_at + 12 h, less any hunt time a v4 save carried in); once it stops,
// when it stopped. A party hunt writes the same row: it is a hunt on a ground like any other, and
// this is what lends the party's own 5% a member to everyone out on it.
async function writePresence(ctx) {
  const p = partyPresence(ctx) || huntPresence(ctx.state);
  if (!p) {
    await ctx.q(
      `update public.hunt_presence
       set ended_at = to_timestamp($2::float8 / 1000), updated_at = now()
       where user_id = $1::uuid and ended_at is null`,
      [ctx.userId, ctx.huntEndedAt ?? ctx.t],
    );
    return;
  }
  // Rewritten only when something changed, so a hunter's every request isn't a row update.
  await ctx.q(
    `insert into public.hunt_presence (user_id, tier, zone, started_at, ends_by, ended_at, updated_at)
     values ($1::uuid, $2::int, $3, to_timestamp($4::float8 / 1000), to_timestamp($5::float8 / 1000), null, now())
     on conflict (user_id) do update
     set tier = excluded.tier,
         zone = excluded.zone,
         started_at = excluded.started_at,
         ends_by = excluded.ends_by,
         ended_at = null,
         updated_at = excluded.updated_at
     where (hunt_presence.tier, hunt_presence.zone, hunt_presence.started_at, hunt_presence.ends_by, hunt_presence.ended_at)
           is distinct from (excluded.tier, excluded.zone, excluded.started_at, excluded.ends_by, excluded.ended_at)`,
    [ctx.userId, p.tier, p.zone, p.startedAt, p.endsBy],
  );
}
