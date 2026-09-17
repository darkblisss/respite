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
import { GameData } from "../shared/registry.js";
import { createEmitter, emit } from "../shared/events.js";
import { clamp, fmtGold, fmtWhole } from "../shared/format.js";
import { ENGINE_VERSION } from "../shared/version.js";
import { createState, migrateSave } from "../shared/state.js";
import { advance, applyCommand, awaySnapshot, makeEnv, summariseAway } from "../shared/engine.js";
import { attachChronicle } from "../shared/chronicle.js";
import { huntPresence } from "../shared/combat.js";
import { skillLevel, totalLevel } from "../shared/stats.js";
import { applyMail, applyPurchase, applyReturn, marketFee, prepareListing, remintKey } from "../shared/market.js";

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

// Results for commands a request had no time left to play. The client sends them again.
export const CATCHING_UP = "The camp is still catching up.";
export const START_OVER_ALONE = "Start over on its own.";
const GONE = Object.freeze({ ok: false, error: "That listing is gone." });
const UNREADABLE = "Your old save could not be read.";

// News the browser could not have predicted, sent back with the save so it can say so.
const NEWS = new Set(["mail:claimed", "mail:unknown", "away"]);

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
 */

/** @param {GameHandlerOptions} options */
export function createGameHandler({ db, getUser, now = () => Date.now(), log, catchUpBudgetMs = CATCH_UP_BUDGET_MS }) {
  const logError = typeof log === "function"
    ? log
    : log && typeof log.error === "function" ? log.error.bind(log) : (...args) => console.error(...args);
  const opts = { logError, budget: catchUpBudgetMs };

  /**
   * @param {{ method: string, headers?: Headers | Record<string, string> | null, bodyText: string }} request
   * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
   */
  async function handle({ method, headers, bodyText }) {
    try {
      if (String(method).toUpperCase() !== "POST") {
        return reply(405, { ok: false, error: "bad_request" }, { allow: "POST, OPTIONS" });
      }
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
    q, t, userId, account, state, env: null, logError: opts.logError,
    budget: opts.budget, spent: 0, behind: false, away: null, reset: false, huntEndedAt: null,
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

  return `{"ok":true,"v":${ENGINE_VERSION},"now":${t},"state":${stateJson},"results":${JSON.stringify(results)},"events":${JSON.stringify(news)}}`;
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

// The market and starting over need the database; the rules answer everything else, unknown
// types included.
async function runCommand(ctx, cmd) {
  if (cmd.type === "resetCamp") return ctx.alone ? resetCamp(ctx) : { ok: false, error: START_OVER_ALONE };
  if (Object.hasOwn(MARKET, cmd.type)) return MARKET[cmd.type](ctx, cmd.args);
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
   Every refusal comes before the first write, so a refused command changes nothing. */

const listingIdOf = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);

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
    `select seller_id::text as seller_id, item_key, item_name, qty_left, price_each, status,
            expires_at <= to_timestamp($2::float8 / 1000) as expired
     from public.market_listings
     where id = $1::bigint
     for update`,
    [listingId, ctx.t],
  );
  if (!l || l.status !== "open" || l.expired) return GONE;
  if (l.seller_id === ctx.userId.toLowerCase()) return { ok: false, error: "You can't buy your own listing." };
  const left = Number(l.qty_left);
  if (qty > left) return { ok: false, error: `Only ${fmtWhole(left)} left.` };

  // The price is the listing's, never the buyer's.
  const priceEach = Number(l.price_each);
  const cost = priceEach * qty;
  if (!Number.isSafeInteger(cost)) return { ok: false, error: "Not enough gold." };
  const fee = marketFee(cost);
  const key = remintKey(l.item_key, listingId);

  const bought = applyPurchase(ctx.state, { key, qty, cost }, ctx.env);
  if (!isObject(bought) || !bought.ok) return { ok: false, error: bought && bought.error };

  // Paid for: from here on nothing refuses. One statement moves the stock, logs the sale and
  // posts the seller's gold.
  const note = `${ctx.account} bought ${fmtWhole(qty)} ${l.item_name} for ${fmtGold(cost)}. The market kept ${fmtGold(fee)}.`;
  await ctx.q(
    `with sold as (
       update public.market_listings
       set qty_left = qty_left - $2::int,
           status = case when qty_left = $2::int then 'sold' else 'open' end,
           updated_at = now()
       where id = $1::bigint
       returning id, seller_id, item_key, item_name, price_each
     ), sale as (
       insert into public.market_sales (listing_id, seller_id, buyer_id, item_key, item_name, qty, price_each, fee)
       select id, seller_id, $3::uuid, item_key, item_name, $2::int, price_each, $4::bigint
       from sold
     )
     insert into public.mail (user_id, kind, gold, note)
     select seller_id, 'gold', $5::bigint, $6
     from sold`,
    [listingId, qty, ctx.userId, fee, cost - fee, note],
  );
  return { ok: true, data: { listingId, key, qty, cost } };
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

const MARKET = Object.freeze({ marketList, marketBuy, marketCancel });

/* ================= 9. STARTING OVER ================= */

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
  await ctx.q("update public.market_listings set status = 'cancelled', updated_at = now() where seller_id = $1::uuid and status = 'open'", [ctx.userId]);
  await ctx.q("delete from public.hunt_presence where user_id = $1::uuid", [ctx.userId]);
  ctx.state = fresh;
  ctx.reset = true;
  return { ok: true };
}

/* ================= 10. WRITING BACK ================= */

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
// when it stopped.
async function writePresence(ctx) {
  const p = huntPresence(ctx.state);
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
