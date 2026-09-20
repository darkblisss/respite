// Server tests for src/server/handler.js: the real rules against PGlite (Postgres compiled to WASM).
//
// From the repo root, after npm install (paths resolve from this file, so any working directory
// works):
//   npm run test:server        or        node tests/server/run.mjs
//
// PGlite is '@electric-sql/pglite' from node_modules. Without an install, PGLITE_PATH names the
// package folder; failing that, a tools/node_modules folder beside the repo is tried.
//
// Setup loads tests/sql/stubs.sql (what Supabase provides), supabase/schema.sql and every
// supabase/migrations/*.sql twice (they must be idempotent). The handler gets the PGlite
// adapter, a fake getUser that maps bearer tokens to users, and a clock the tests move by hand.
// Each check prints PASS or FAIL; the process exits 1 if any check fails.
//
// SERVER_TEST_DRIVER=postgres runs the same suite with the handler's SQL going through
// postgres.js, the Edge Function's driver, over PGlite's wire protocol server, so the
// production driver's quirks are tested too. postgres comes with npm install;
// @electric-sql/pglite-socket does not, so add it without saving it, or name a node_modules
// folder holding both with PG_WIRE_MODULES:
//   npm install --no-save @electric-sql/pglite-socket
//   SERVER_TEST_DRIVER=postgres node tests/server/run.mjs

import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { createGameHandler, CATCHING_UP, MAX_BODY, PARTY_OUT, START_OVER_ALONE } from '../../src/server/handler.js';
import { pgliteAdapter, postgresJsAdapter } from '../../src/server/db.js';
import { CONFIG } from '../../src/shared/config.js';
import { GameData } from '../../src/shared/registry.js';
import { ENGINE_VERSION } from '../../src/shared/version.js';
import { createState } from '../../src/shared/state.js';
import { hashString } from '../../src/shared/rng.js';
import { COMMANDS } from '../../src/shared/engine.js';
import { haveQty } from '../../src/shared/storage.js';
import { levelFromXp, totalLevel } from '../../src/shared/stats.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const DEFAULT_PGLITE = resolve(REPO, '..', 'tools', 'node_modules', '@electric-sql', 'pglite');

// A package from node_modules, else from PG_WIRE_MODULES (a node_modules folder).
async function importFrom(name, entry) {
  try {
    return await import(name);
  } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND' || !process.env.PG_WIRE_MODULES) throw e;
    return import(pathToFileURL(join(process.env.PG_WIRE_MODULES, name, entry)).href);
  }
}

async function loadPGlite() {
  try {
    return (await import('@electric-sql/pglite')).PGlite;
  } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    const dir = process.env.PGLITE_PATH || DEFAULT_PGLITE;
    return (await import(pathToFileURL(join(dir, 'dist', 'index.js')).href)).PGlite;
  }
}

/* ================= 1. REPORTING ================= */

let passed = 0;
let failed = 0;

function show(value) {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : show(detail)}`}`);
  }
  return ok;
}

function same(name, actual, expected) {
  return check(name, isDeepStrictEqual(actual, expected), { actual, expected });
}

async function section(title, fn) {
  console.log(`\n# ${title}`);
  try {
    await fn();
  } catch (e) {
    check(`${title}: finished without an unexpected error`, false, e.stack || e.message);
  }
}

/* ================= 2. THE WORLD ================= */

const PGlite = await loadPGlite();
const db = new PGlite();
await db.exec(await readFile(join(REPO, 'tests', 'sql', 'stubs.sql'), 'utf8'));
await db.exec(await readFile(join(REPO, 'supabase', 'schema.sql'), 'utf8'));
const MIGRATIONS = join(REPO, 'supabase', 'migrations');
const migrationFiles = (await readdir(MIGRATIONS).catch(() => [])).filter((f) => f.endsWith('.sql')).sort();
for (let round = 0; round < 2; round++) {
  for (const f of migrationFiles) await db.exec(await readFile(join(MIGRATIONS, f), 'utf8'));
}

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const q1 = async (sql, params = []) => (await q(sql, params))[0];

// A Monday morning, UTC. Moves only forward.
let NOW = Date.UTC(2026, 8, 14, 9, 0, 0);
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;
const MAX_SAVE_TEST_BYTES = 2 * 1024 * 1024 + 1000;   // just past the server's 2 MB limit

const TOKENS = new Map();
function newUser(name, email = `${name}@players.respite`) {
  const user = { id: randomUUID(), name, email, token: `tok_${name}_${TOKENS.size}` };
  TOKENS.set(`Bearer ${user.token}`, { id: user.id, email });
  return user;
}
const getUser = async (authorization) => TOKENS.get(authorization) || null;

const logged = [];
const log = (...args) => logged.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' '));

// The tests' own queries always go straight to PGlite; only the handler's go over the wire.
let adapter = pgliteAdapter(db);
let closeWire = async () => {};
if (process.env.SERVER_TEST_DRIVER === 'postgres') {
  const { PGLiteSocketServer } = await importFrom('@electric-sql/pglite-socket', join('dist', 'index.js'));
  const postgres = (await importFrom('postgres', join('src', 'index.js'))).default;
  const server = new PGLiteSocketServer({ db, port: 0 });
  await server.start();
  const sql = postgres({ host: '127.0.0.1', port: server.port, username: 'postgres', database: 'postgres', prepare: false, max: 1, idle_timeout: 20, onnotice: () => {} });
  adapter = postgresJsAdapter(sql);
  closeWire = async () => {
    await sql.end({ timeout: 1 });
    await server.stop();
  };
  console.log(`# driver: postgres.js over PGlite's wire protocol, port ${server.port}`);
}
const handler = createGameHandler({ db: adapter, getUser, now: () => NOW, log });

let serial = 1;
const cmd = (type, args = {}, at = NOW) => ({ id: `c${serial++}`, type, args, at });

async function send(user, commands = [], { v = ENGINE_VERSION, via = handler } = {}) {
  const headers = user ? { Authorization: `Bearer ${user.token}` } : {};
  const res = await via({ method: 'POST', headers, bodyText: JSON.stringify({ v, commands }) });
  return { status: res.status, headers: res.headers, body: JSON.parse(res.body) };
}

// A request that has to succeed.
async function play(user, ...commands) {
  const res = await send(user, commands);
  if (res.status !== 200) throw new Error(`request for ${user.name} failed: ${res.status} ${show(res.body)}`);
  return res.body;
}

async function saved(user) {
  return q1('select data, rev::int as rev, engine, clock::float8 as clock, username from public.saves where user_id = $1', [user.id]);
}

// Changes a stored save between requests, the way only the server could.
async function editSave(user, fn) {
  const row = await saved(user);
  fn(row.data);
  await db.query('update public.saves set data = $2::jsonb where user_id = $1', [user.id, JSON.stringify(row.data)]);
}

function put(state, pool, key, qty) {
  const p = state[pool];
  p.items[key] = (p.items[key] || 0) + qty;
  if (!p.order.includes(key)) p.order.push(key);
}

function take(state, pool, key) {
  delete state[pool].items[key];
  state[pool].order = state[pool].order.filter((k) => k !== key);
}

// Every slot of every pool holds a stack of something other than `avoid`.
const FILLER = Object.keys(GameData.MATERIALS).filter((k) => !GameData.MATERIALS[k].heal && k !== 'vault_chest');
function fillStorage(state, avoid = []) {
  const keys = FILLER.filter((k) => !avoid.includes(k) && !['inv', 'bank', 'vault'].some((w) => state[w].items[k] != null));
  let i = 0;
  for (const w of ['inv', 'bank', 'vault']) {
    const cap = w === 'inv' ? CONFIG.storage.slots.inv : state[w].slots;
    while (Object.keys(state[w].items).length < cap) put(state, w, keys[i++], 1);
  }
}

const listing = (id) => q1(
  `select seller_id::text as seller_id, seller_name, item_key, item_base, item_name, item_kind, item_tier, rarity,
          qty, qty_left, price_each::float8 as price_each, status,
          (extract(epoch from expires_at) * 1000)::float8 as expires_ms
   from public.market_listings where id = $1`,
  [id],
);
const mailOf = (user) => q(
  `select id::int as id, kind, gold::float8 as gold, item_key, qty, note, claimed_at is not null as claimed
   from public.mail where user_id = $1 order by id`,
  [user.id],
);
const presenceOf = (user) => q1(
  `select tier, zone,
          (extract(epoch from started_at) * 1000)::float8 as started,
          (extract(epoch from ends_by) * 1000)::float8 as ends_by,
          (extract(epoch from ended_at) * 1000)::float8 as ended,
          updated_at
   from public.hunt_presence where user_id = $1`,
  [user.id],
);

// A row as a v4 browser left it: engine null, whatever data it wrote, and the account behind it.
async function v4Row(user, username, data) {
  await db.query('insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing', [user.id, user.email]);
  await db.query(
    'insert into public.saves (user_id, username, data, updated_at) values ($1, $2, $3::jsonb, now())',
    [user.id, username, data === null ? null : JSON.stringify(data)],
  );
}

// A save as a fresh camp would have it, with the same seed for every player who gets one.
async function seedSave(user, seed, edit) {
  const state = createState({ now: NOW, seed, userId: user.id, account: user.name });
  if (edit) edit(state);
  await db.query(
    `insert into public.saves (user_id, username, data, rev, engine, clock, updated_at)
     values ($1, $2, $3::jsonb, 0, $4, $5, now())`,
    [user.id, user.name, JSON.stringify(state), ENGINE_VERSION, NOW],
  );
}

/* ================= 3. SUITES ================= */

await section('the schema', async () => {
  same('migrations ran (twice)', migrationFiles, ['002_server.sql', '003_profiles_from_saves.sql', '004_leaderboard_boards.sql', '005_wealth_board.sql', '006_party_hunts.sql', '007_market_pools.sql']);
  same('the expiry sweep has its partial index on open listings',(await q1(`select indexdef from pg_indexes where indexname = 'market_listings_open_expiry_idx'`)).indexdef,
    'CREATE INDEX market_listings_open_expiry_idx ON public.market_listings USING btree (expires_at, id) WHERE (status = \'open\'::text)');
  same('the hourly listing count has its index', (await q1(`select indexdef from pg_indexes where indexname = 'market_listings_seller_created_idx'`)).indexdef,
    'CREATE INDEX market_listings_seller_created_idx ON public.market_listings USING btree (seller_id, created_at)');
});

await section('the envelope', async () => {
  const gate = newUser('gate');
  const auth = { authorization: `Bearer ${gate.token}` };
  const raw = async (init) => {
    const res = await handler({ method: 'POST', headers: auth, ...init });
    return [res.status, JSON.parse(res.body)];
  };
  const body = (value) => JSON.stringify(value);
  const good = (commands) => body({ v: ENGINE_VERSION, commands });
  const BAD = [400, { ok: false, error: 'bad_request' }];

  same('GET is refused', await raw({ method: 'GET', bodyText: '' }), [405, { ok: false, error: 'bad_request' }]);
  same('no authorization header is unauthorized', await raw({ headers: {}, bodyText: good([]) }), [401, { ok: false, error: 'unauthorized' }]);
  same('an unknown token is unauthorized', await raw({ headers: { authorization: 'Bearer nope' }, bodyText: good([]) }), [401, { ok: false, error: 'unauthorized' }]);
  same('an older engine version is outdated', await raw({ bodyText: body({ v: ENGINE_VERSION - 1, commands: [] }) }), [409, { ok: false, error: 'outdated', v: ENGINE_VERSION }]);
  same('a missing version is outdated', await raw({ bodyText: body({ commands: [] }) }), [409, { ok: false, error: 'outdated', v: ENGINE_VERSION }]);
  same('outdated wins over strange commands', await raw({ bodyText: body({ v: 'x', commands: 'nope' }) }), [409, { ok: false, error: 'outdated', v: ENGINE_VERSION }]);
  same('a body that is not JSON', await raw({ bodyText: '{"v":1,' }), BAD);
  same('a JSON array body', await raw({ bodyText: '[]' }), BAD);
  same('commands missing', await raw({ bodyText: body({ v: ENGINE_VERSION }) }), BAD);
  same('commands not an array', await raw({ bodyText: body({ v: ENGINE_VERSION, commands: {} }) }), BAD);
  const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, type: 'stopSkill', args: {}, at: NOW }));
  same('26 commands are too many', await raw({ bodyText: good(many(26)) }), BAD);
  same('a command that is not an object', await raw({ bodyText: good(['stopSkill']) }), BAD);
  same('an id longer than 40', await raw({ bodyText: good([{ id: 'x'.repeat(41), type: 'stopSkill', at: NOW }]) }), BAD);
  same('an id that is not a string', await raw({ bodyText: good([{ id: 7, type: 'stopSkill', at: NOW }]) }), BAD);
  same('a type longer than 40', await raw({ bodyText: good([{ id: 'a', type: 'y'.repeat(41), at: NOW }]) }), BAD);
  same('args as an array', await raw({ bodyText: good([{ id: 'a', type: 'stopSkill', args: [], at: NOW }]) }), BAD);
  same('args as null', await raw({ bodyText: good([{ id: 'a', type: 'stopSkill', args: null, at: NOW }]) }), BAD);
  same('at as a string', await raw({ bodyText: good([{ id: 'a', type: 'stopSkill', at: String(NOW) }]) }), BAD);
  same('at missing', await raw({ bodyText: good([{ id: 'a', type: 'stopSkill' }]) }), BAD);
  same('a __proto__ key anywhere', await raw({ bodyText: `{"v":${ENGINE_VERSION},"commands":[{"id":"a","type":"stopSkill","at":${NOW},"args":{"__proto__":{"x":1}}}]}` }), BAD);
  same('a body over the size limit', await raw({ bodyText: good([{ id: 'a', type: 'stopSkill', at: NOW, args: { pad: 'z'.repeat(MAX_BODY) } }]) }), BAD);
  same('no save was made for any refused request', (await q1('select count(*)::int as n from public.saves where user_id = $1', [gate.id])).n, 0);

  const res = await raw({ bodyText: good(many(25)) });
  same('25 commands are accepted', [res[0], res[1].results.length], [200, 25]);
  check('the Allow header comes with a 405', (await handler({ method: 'PUT', headers: auth, bodyText: '' })).headers.allow === 'POST, OPTIONS');
  check('responses are JSON and never cached', res[0] === 200 && (await handler({ method: 'POST', headers: auth, bodyText: good([]) })).headers['cache-control'] === 'no-store');

  const before = logged.length;
  const broken = createGameHandler({ db: adapter, getUser: async () => { throw new Error('auth is down: secret detail'); }, now: () => NOW, log });
  const crashed = await broken({ method: 'POST', headers: auth, bodyText: good([]) });
  same('a thrown error is a bare server_error', [crashed.status, JSON.parse(crashed.body)], [500, { ok: false, error: 'server_error' }]);
  check('and it is logged', logged.length === before + 1 && /auth is down/.test(logged[logged.length - 1]));
  logged.length = before;
});

await section('a new player', async () => {
  NOW += 1000;
  const ash = newUser('ash');
  const res = await send(ash, []);
  same('the first request answers 200', res.status, 200);
  same('the response is exactly ok, v, now, state, results and events', Object.keys(res.body).sort(), ['events', 'now', 'ok', 'results', 'state', 'v']);
  same('a first visit has no news', res.body.events, []);
  same('ok, v, now and results', [res.body.ok, res.body.v, res.body.now, res.body.results], [true, ENGINE_VERSION, NOW, []]);
  const s = res.body.state;
  same('a current-schema save at the request clock', [s.schema, s.clock], [CONFIG.schema, NOW]);
  same('the save knows its owner', [s.meta.account, s.meta.userId], ['ash', ash.id]);
  check('its dice are not worked out from who and when', s.rng.seed !== hashString(`${ash.id}:${NOW}`) && s.rng.seed !== (hashString(`${ash.id}:${NOW}`) >>> 0), s.rng);

  const row = await saved(ash);
  same('saves row: rev 1, engine, clock and username', [row.rev, row.engine, row.clock, row.username], [1, ENGINE_VERSION, NOW, 'ash']);
  check('the response state equals the saved data', isDeepStrictEqual(row.data, s));
  same('the saved data carries the current schema', row.data.schema, CONFIG.schema);

  const p = await q1('select username, total_level, levels, skills, last_seen from public.profiles where user_id = $1', [ash.id]);
  const ones = Object.fromEntries(GameData.SKILLS.map((k) => [k.id, 1]));
  const zeros = Object.fromEntries(GameData.SKILLS.map((k) => [k.id, 0]));
  same('a profile row with the name, levels and xp', [p.username, p.total_level, p.levels, p.skills], ['ash', GameData.SKILLS.length, ones, zeros]);
  check('last_seen is set', p.last_seen instanceof Date);

  NOW += 1000;
  const again = await play(ash);
  const row2 = await saved(ash);
  same('the next request bumps rev to 2', row2.rev, 2);
  check('and the response state still equals the saved data', isDeepStrictEqual(row2.data, again.state));
});

await section('account names', async () => {
  NOW += 1000;
  const odd = newUser('odd', 'Some.One+tag@example.com');
  const oddCamp = (await play(odd)).state;
  same('an email that is not a username gives p_ and 8 hex of the id', oddCamp.meta.account, `p_${odd.id.replace(/-/g, '').slice(0, 8)}`);
  const noEmail = newUser('phone', null);
  const phoneCamp = (await play(noEmail)).state;
  same('no email at all gives the same', phoneCamp.meta.account, `p_${noEmail.id.replace(/-/g, '').slice(0, 8)}`);
  const mixedCamp = (await play(newUser('mixed', 'MixedCase@players.respite'))).state;
  same('a mixed case local part is lowered', mixedCamp.meta.account, 'mixedcase');
  // Made in the same millisecond: a fixed seed, or one from the clock alone, would repeat here.
  same('camps made in the same moment get different dice', new Set([oddCamp, phoneCamp, mixedCamp].map((c) => c.rng.seed)).size, 3);

  const first = newUser('twin');
  await play(first);
  const second = newUser('twin2', 'twin@example.com');
  same('a name another player holds falls back to p_', (await play(second)).state.meta.account, `p_${second.id.replace(/-/g, '').slice(0, 8)}`);

  const keeper = newUser('keeper', 'renamed@players.respite');
  await db.query(`insert into public.profiles (user_id, username) values ($1, 'keeper')`, [keeper.id]);
  const kept = await play(keeper);
  same('a name already on the profile is kept', [kept.state.meta.account, (await saved(keeper)).username], ['keeper', 'keeper']);

  // v4 players who have not come back since the cutover, and someone after their names.
  const v4Camp = { schema: 8, meta: { lastSeen: NOW - DAY }, player: { gold: 10 } };
  const sleeper = newUser('sleeper');
  const contested = newUser('contested');
  const mallory = newUser('mallory');
  await v4Row(sleeper, 'sleeper', v4Camp);
  await v4Row(contested, 'contested', v4Camp);
  await v4Row(mallory, 'contested', v4Camp);   // a v4 browser could rewrite its own row's username
  const m003 = await readFile(join(MIGRATIONS, '003_profiles_from_saves.sql'), 'utf8');
  await db.exec(m003);
  await db.exec(m003);
  const owners = await q(`select username, user_id::text as user_id from public.profiles where username in ('sleeper', 'contested', 'mallory') order by username`);
  same('migration 003 gives each v4 save its name, once however often it runs', owners, [
    { username: 'contested', user_id: contested.id },
    { username: 'sleeper', user_id: sleeper.id },
  ]);
  same('a name two rows claim goes to the account whose email carries it', owners.find((o) => o.username === 'contested')?.user_id, contested.id);

  const squatter = newUser('squatter', 'sleeper@elsewhere.example');
  same('signing up as someone else\'s name@anywhere takes nothing', (await play(squatter)).state.meta.account, `p_${squatter.id.replace(/-/g, '').slice(0, 8)}`);
  same('the v4 player still comes back under their own name', (await play(sleeper)).state.meta.account, 'sleeper');
  same('the rewritten row gets its owner\'s own name, not the one it claimed', (await play(mallory)).state.meta.account, 'mallory');

  const renamed = newUser('renamed_v4', 'newmail@players.respite');
  await v4Row(renamed, 'oldname', v4Camp);
  same('with no profile yet, the name on the player\'s own save row comes first', (await play(renamed)).state.meta.account, 'oldname');
});

await section('a v4 save migrates on its first request', async () => {
  NOW += 1000;
  const old = newUser('oldhand');
  const lastSeen = NOW - 2 * HOUR;
  const skills = Object.fromEntries(GameData.SKILLS.map((s) => [s.id, 0]));
  skills.delving = 1200;
  const v4 = {
    schema: 8,
    meta: { createdAt: lastSeen - DAY, lastSeen, playtimeMs: HOUR, account: 'oldhand', userId: null },
    player: { gold: 500, hp: 25, recoveryLeft: 0, klass: null },
    skills,
    inv: { slots: 10, items: {}, order: [] },
    bank: { slots: 30, items: { slag_delve: 40, provision_t1: 6 }, order: ['slag_delve', 'provision_t1'] },
    vault: { slots: 50, items: {}, order: [] },
    uid: 3,
    equipment: { weapon: null, offhand: null, head: null, chest: null, hands: null, feet: null, neck: null, ring: null },
    tools: {},
    wear: {},
    tasks: {
      skilling: { skillId: 'delving', actionId: 'delving_t1_raw', progress: 4000, done: 12, elapsed: 150000, limit: null, startedAt: lastSeen - 150000, queued: null },
      combat: null,
    },
    region: 'region_1',
    travel: { unlocked: ['region_1'] },
    companions: { owned: {}, active: null },
    threat: {},
    settings: { hideSovereign: false },
    agents: [],
    requisitions: [],
    reqDay: 0,
    bounty: null,
    buff: null,
    smugglerBought: {},
    stats: { kills: 0, actions: 12, deaths: 0, crafted: 0, epics: 0, goldEarned: 900 },
    log: [{ t: lastSeen - MINUTE, m: 'An old line from v4.' }],
  };
  await db.query(`insert into public.saves (user_id, username, data, updated_at) values ($1, 'oldhand', $2::jsonb, now())`, [old.id, JSON.stringify(v4)]);

  const res = await play(old);
  const s = res.state;
  same('current schema, caught up to now', [s.schema, s.clock], [CONFIG.schema, NOW]);
  same('gold is kept', s.player.gold, 500);
  check('meta.lastSeen is gone', !('lastSeen' in s.meta));
  // 4,000 ms of progress plus two hours at 12 s an action: 600 more, 4,000 ms over.
  same('the crew worked the two hours away', [haveQty(s, 'slag_delve'), s.skills.delving, s.tasks.skilling && s.tasks.skilling.done], [640, 1800, 612]);
  same('remedies moved into the Satchel', [s.satchel.items.provision_t1, s.bank.items.provision_t1, s.inv.items.provision_t1], [6, undefined, undefined]);
  check('the old log line survives', s.log.some((l) => l.m === 'An old line from v4.'));
  check('a welcome-back line is dated now', s.log.some((l) => l.t === NOW && /Away/i.test(l.m)), s.log.slice(-3));
  const row = await saved(old);
  same('the row is rev 1 with engine and clock', [row.rev, row.engine, row.clock], [1, ENGINE_VERSION, NOW]);
  check('and holds what the response returned', isDeepStrictEqual(row.data, s));
  const p = await q1('select username, levels, skills from public.profiles where user_id = $1', [old.id]);
  same('the profile takes the v4 name and xp', [p.username, p.skills.delving, p.levels.delving], ['oldhand', 1800, levelFromXp(1800)]);
});

await section('rows the server never wrote are not trusted', async () => {
  NOW += 1000;
  // A v4 browser could write anything to its row, including a save dressed as the server's.
  const forger = newUser('forger');
  const skills = Object.fromEntries(GameData.SKILLS.map((s) => [s.id, 0]));
  await v4Row(forger, 'forger', {
    schema: 9, clock: NOW + 5 * DAY, meta: { createdAt: NOW - DAY }, skills,
    player: { gold: 99999999, hp: 25, recoveryLeft: 0, klass: null },
    inv: { slots: 10, items: {}, order: [] },
    bank: { slots: 30, items: { slag_delve: 9999999 }, order: ['slag_delve'] },
    vault: { slots: 50, items: {}, order: [] },
    rng: { seed: 1, world: 2, hunt: 3 }, rolls: { 'a:delving_t1_raw': 5000 }, serial: 99, log: [],
  });
  const forged = (await play(forger)).state;
  same('a row dressed as schema 9 still takes the v4 path: its clock is pulled back to now', forged.clock, NOW);
  same('and held to the legacy limits: gold to 5,000,000, a stack to 250,000', [forged.player.gold, forged.bank.items.slag_delve], [5000000, 250000]);
  same('its dice, counters and serial are the server\'s, not the row\'s', [forged.rng.seed === 1, forged.rolls, forged.serial], [false, {}, 1]);
  check('and those dice are not worked out from who and when either', forged.rng.seed !== hashString(`${forger.id}:${NOW}`), forged.rng);
  check('the camp is told its ledger was set right', forged.log.some((l) => /ledger didn't add up/.test(l.m)), forged.log);
  same('once saved it is the server\'s row', (await saved(forger)).engine, ENGINE_VERSION);
  NOW += 1000;
  const again = (await play(forger)).state;
  same('and on the next request it keeps its (clamped) gold and clock', [again.player.gold, again.clock], [5000000, NOW]);

  const hoarder = newUser('hoarder');
  await v4Row(hoarder, 'hoarder', { schema: 8, meta: { lastSeen: NOW - HOUR }, player: { gold: 50 }, pad: 'x'.repeat(MAX_SAVE_TEST_BYTES) });
  const loggedBefore = logged.length;
  const big = (await play(hoarder)).state;
  same('a row over 2 MB is not read: a fresh camp takes its place', [big.player.gold, big.clock, haveQty(big, 'slag_delve')], [0, NOW, 0]);
  check('and the camp log says why', big.log.some((l) => l.m === 'Your old save could not be read.'), big.log);
  check('the owner\'s log says whose and how big', logged.length === loggedBefore + 1 && logged[loggedBefore].includes(hoarder.id) && /bytes/.test(logged[loggedBefore]), logged.slice(loggedBefore));
  logged.length = loggedBefore;
  check('and the replacement is small again', (await q1('select octet_length(data::text) as n from public.saves where user_id = $1', [hoarder.id])).n < 100000);

  const blank = newUser('blank');
  await v4Row(blank, 'blank', null);
  const empty = (await play(blank)).state;
  check('a row with no save in it gets a fresh camp and the same line', empty.log.some((l) => l.m === 'Your old save could not be read.') && empty.player.gold === 0, empty.log);
  check('logged too', logged.length === loggedBefore + 1 && logged[loggedBefore].includes(blank.id), logged.slice(loggedBefore));
  logged.length = loggedBefore;
});

await section('a skilling task runs between requests', async () => {
  NOW += 1000;
  const miner = newUser('miner');
  const start = await play(miner, cmd('startSkill', { skillId: 'delving', actionId: 'delving_t1_raw', limit: null }));
  same('startSkill succeeds', start.results.map((r) => r.ok), [true]);
  check('the task is running', !!start.state.tasks.skilling && start.state.tasks.skilling.actionId === 'delving_t1_raw');

  NOW += 30 * MINUTE + 5000;
  const later = await play(miner);
  const t = later.state.tasks.skilling;
  same('150 actions in 30 minutes and 5 seconds', [t && t.done, t && t.progress], [150, 5000]);
  same('150 Slag Ore in the Stockpile and 150 Delving XP', [later.state.bank.items.slag_delve, later.state.skills.delving], [150, 150]);
  const p = await q1('select total_level, levels, skills from public.profiles where user_id = $1', [miner.id]);
  same('the profile follows', [p.skills.delving, p.levels.delving, p.total_level], [150, levelFromXp(150), totalLevel(later.state)]);
});

await section('command times are clamped', async () => {
  NOW += 1000;
  const skill = (at) => cmd('startSkill', { skillId: 'delving', actionId: 'delving_t1_raw', limit: null }, at);

  const future = newUser('future');
  const f = await play(future, skill(NOW + HOUR));
  same('a command from the future runs now', f.state.tasks.skilling.startedAt, NOW);

  const past = newUser('past');
  await play(past);
  NOW += HOUR;
  const p = await play(past, skill(NOW - HOUR));
  same('a command from far back runs 10 s before the request', [p.state.tasks.skilling.startedAt, p.state.tasks.skilling.progress], [NOW - 10000, 10000]);

  const early = newUser('early');
  await play(early);
  const synced = NOW;
  NOW += 4000;
  const e = await play(early, skill(synced - 2000));
  same('a command before the save clock runs at the save clock', [e.state.tasks.skilling.startedAt, e.state.tasks.skilling.progress], [synced, 4000]);

  const order = newUser('order');
  await play(order);
  NOW += 5000;
  const o = await play(order, skill(NOW - 1000), cmd('stopSkill', {}, NOW - 3000));
  same('time never runs backwards inside a request', [o.results.map((r) => r.ok), o.state.tasks.skilling, o.state.clock], [[true, true], null, NOW]);
});

await section('commands and their results', async () => {
  NOW += 1000;
  const cook = newUser('cook');
  await play(cook);
  NOW += 1000;
  const r = await play(
    cook,
    cmd('flyToTheMoon'),
    cmd('constructor'),
    cmd('startSkill', { skillId: 'delving', actionId: 'nowhere', limit: null }),
    cmd('startSkill', { skillId: 'delving', actionId: 'delving_t1_raw', limit: 5 }),
    cmd('marketBuy', { listingId: 'seven', qty: 1 }),
  );
  same('results keep the order and ids of the commands', r.results.map((x) => x.id), [0, 1, 2, 3, 4].map((i) => `c${serial - 5 + i}`));
  same('an unknown command is refused by name', [r.results[0], r.results[1]].map((x) => [x.ok, x.error]), [[false, 'Unknown command.'], [false, 'Unknown command.']]);
  check('a refused rules command carries the rules message', r.results[2].ok === false && typeof r.results[2].error === 'string' && r.results[2].error.length > 0, r.results[2]);
  same('and a later command still runs', [r.results[3].ok, r.state.tasks.skilling && r.state.tasks.skilling.limit], [true, 5]);
  same('a junk listing id is simply gone', [r.results[4].ok, r.results[4].error], [false, 'That listing is gone.']);
  same('a resetCamp is not a rules command', COMMANDS.resetCamp, undefined);

  if (Object.isFrozen(COMMANDS)) {
    console.log('SKIP a command that throws is undone (COMMANDS is frozen, so no throwing command can be planted)');
  } else {
    COMMANDS.boomForTests = { run(state) { state.player.gold += 999; throw new Error('boom for tests'); }, predict: false };
    const before = logged.length;
    NOW += 1000;
    const b = await play(cook, cmd('boomForTests'), cmd('stopSkill'));
    delete COMMANDS.boomForTests;
    same('a command that throws is a server_error result', [b.results[0].ok, b.results[0].error], [false, 'server_error']);
    same('its changes are undone and the rest still run', [b.state.player.gold, b.results[1].ok, b.state.tasks.skilling], [0, true, null]);
    check('and the throw is logged', logged.length === before + 1 && /boom for tests/.test(logged[before]));
    logged.length = before;
  }
});

await section('the market: list, buy out of the pool, get paid', async () => {
  NOW += MINUTE;
  const seller = newUser('seller');
  const buyer = newUser('buyer');
  await play(seller);
  await play(buyer);
  await editSave(seller, (s) => put(s, 'bank', 'slag_delve', 100));
  await editSave(buyer, (s) => { s.player.gold = 1000; });

  NOW += 1000;
  const listed = await play(seller, cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 30, price: 7 }));
  const res = listed.results[0];
  check('listing succeeds with a listing id', res.ok === true && Number.isInteger(res.data && res.data.listingId), res);
  const id = res.data.listingId;
  same('the listed ore leaves the Stockpile', listed.state.bank.items.slag_delve, 70);
  const row = await listing(id);
  same('the listing row', row, {
    seller_id: seller.id, seller_name: 'seller', item_key: 'slag_delve', item_base: 'slag_delve', item_name: 'Slag Ore',
    item_kind: 'material', item_tier: 1, rarity: null, qty: 30, qty_left: 30, price_each: 7, status: 'open',
    expires_ms: NOW + CONFIG.economy.marketListingDays * DAY,
  });

  // A material is bought out of its pool, by name, quantity and ceiling. Its id buys nothing,
  // which is what keeps a buyer from picking one seller out of the pool.
  NOW += 1000;
  same('a material listing cannot be bought by its id', (await play(buyer, cmd('marketBuy', { listingId: id, qty: 1 }))).results[0].error, 'Buy materials from the pool.');

  NOW += 1000;
  // 10 at 7 is 70 for the goods; the fee is 5% rounded up, 4, and the buyer pays it on top.
  const b1 = await play(buyer, cmd('marketBuyPool', { key: 'slag_delve', qty: 10, maxEach: 7 }));
  same('buying 10 out of the pool says what was had and what it cost', b1.results[0].data,
    { key: 'slag_delve', qty: 10, cost: 74, fee: 4, asked: 10, short: false });
  same('the buyer paid the ask plus the fee and holds 10', [b1.state.player.gold, haveQty(b1.state, 'slag_delve')], [926, 10]);
  same('10 are gone from the listing', [(await listing(id)).qty_left, (await listing(id)).status], [20, 'open']);

  NOW += 1000;
  // More than the pool holds is a short fill, not a refusal: they get what was there.
  const rest = await play(buyer, cmd('marketBuyPool', { key: 'slag_delve', qty: 25, maxEach: 7 }));
  same('asking for more than the pool holds fills short and says so', rest.results[0].data,
    { key: 'slag_delve', qty: 20, cost: 147, fee: 7, asked: 25, short: true });
  same('and they paid for the 20 there were', [rest.state.player.gold, haveQty(rest.state, 'slag_delve')], [779, 30]);
  same('the listing is sold out', [(await listing(id)).qty_left, (await listing(id)).status], [0, 'sold']);
  same('an empty pool has nothing to sell', (await play(buyer, cmd('marketBuyPool', { key: 'slag_delve', qty: 1, maxEach: 7 }))).results[0].error,
    'Nobody is selling that at your price.');

  const sales = await q(`select seller_id::text as s, buyer_id::text as b, item_key, item_name, qty,
                                price_each::int as p, fee::int as fee, buyer_fee::int as buyer_fee
                         from public.market_sales where listing_id = $1 order by id`, [id]);
  same('two sale rows, each carrying both legs of the fee', sales, [
    { s: seller.id, b: buyer.id, item_key: 'slag_delve', item_name: 'Slag Ore', qty: 10, p: 7, fee: 4, buyer_fee: 4 },
    { s: seller.id, b: buyer.id, item_key: 'slag_delve', item_name: 'Slag Ore', qty: 20, p: 7, fee: 7, buyer_fee: 7 },
  ]);
  const letters = await mailOf(seller);
  same('the seller has two gold letters, the ask less the fee', letters.map((l) => [l.kind, l.gold, l.claimed]), [['gold', 66, false], ['gold', 133, false]]);
  check('a letter says what sold and what the market kept, and never who bought it',
    /Slag Ore/.test(letters[0].note) && /\b10\b/.test(letters[0].note) && !/buyer/i.test(letters[0].note), letters[0].note);

  NOW += 1000;
  const paid = await play(seller);
  same('the seller is paid on the next request, as earned gold', [paid.state.player.gold, paid.state.stats.goldEarned], [199, 199]);
  same('both letters are claimed', (await mailOf(seller)).map((l) => l.claimed), [true, true]);
  const post = paid.events.filter((e) => e.type === 'mail:claimed');
  same('the response carries the post as news, without the save', [post.length, post[0] && post[0].gold, post[0] && 'state' in post[0]], [1, 199, false]);

  NOW += 1000;
  const own = await play(seller, cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 5, price: 9 }));
  const ownId = own.results[0].data.listingId;
  NOW += 1000;
  const self = await play(seller, cmd('marketBuyPool', { key: 'slag_delve', qty: 1, maxEach: 9 }));
  same('a seller cannot buy out of their own pool', [self.results[0].ok, self.results[0].error], [false, 'Nobody is selling that at your price.']);

  NOW += 1000;
  const cheap = await play(seller, cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 1, price: 1 }));
  const cheapId = cheap.results[0].data.listingId;
  NOW += 1000;
  // 1 at 1 then 5 at 9: the cheap band first, and the fee is charged once on the basket.
  const across = await play(buyer, cmd('marketBuyPool', { key: 'slag_delve', qty: 6, maxEach: 9 }));
  same('a buy empties the cheap band first and walks on into the dear one', across.results[0].data,
    { key: 'slag_delve', qty: 6, cost: 49, fee: 3, asked: 6, short: false });
  same('and it paid 46 for the goods and 3 for the market', [across.state.player.gold, haveQty(across.state, 'slag_delve')], [730, 36]);
  same('both listings are sold out', [(await listing(cheapId)).status, (await listing(ownId)).status], ['sold', 'sold']);
  same("the seller's leg is charged per listing, the buyer's once and shared over them",
    (await q('select fee::int as fee, buyer_fee::int as buyer_fee from public.market_sales where listing_id = any($1::bigint[]) order by listing_id', [[cheapId, ownId]]))
      .map((r) => [r.fee, r.buyer_fee]),
    [[3, 3], [1, 0]]);
  NOW += 1000;
  const paid2 = await play(seller);
  same('a letter worth nothing is still claimed; 42 gold arrives', [paid2.state.player.gold, (await mailOf(seller)).map((l) => [l.gold, l.claimed])],
    [241, [[66, true], [133, true], [42, true], [0, true]]]);

  // Gear is not fungible, so it stays one row a piece, bought by id, and anonymous all the same.
  NOW += 1000;
  await editSave(seller, (s) => put(s, 'inv', 'slag_sword|legendary|c3.4', 1));
  const sword = await play(seller, cmd('marketList', { key: 'slag_sword|legendary|c3.4', from: 'inv', qty: 1, price: 500 }));
  const swordId = sword.results[0].data.listingId;
  NOW += 1000;
  const pooled = await play(buyer, cmd('marketBuyPool', { key: 'slag_sword|legendary|c3.4', qty: 1, maxEach: 500 }));
  same('gear is not sold out of a pool', [pooled.results[0].ok, pooled.results[0].error], [false, 'That is sold piece by piece.']);
  NOW += 1000;
  const gear = await play(buyer, cmd('marketBuy', { listingId: swordId, qty: 1 }));
  same('a piece is bought by id, at the ask plus the fee, under a new market uid', gear.results[0].data,
    { listingId: swordId, key: `slag_sword|legendary|m${swordId}`, qty: 1, cost: 525, fee: 25 });
  same('the buyer paid 525', gear.state.player.gold, 205);
  const swordSale = await q1('select fee::int as fee, buyer_fee::int as buyer_fee from public.market_sales where listing_id = $1', [swordId]);
  same('a gear sale carries both legs too', [swordSale.fee, swordSale.buyer_fee], [25, 25]);
  same('and the seller is posted the ask less the fee', (await mailOf(seller)).filter((l) => !l.claimed).map((l) => [l.gold, /buyer/i.test(l.note)]), [[475, false]]);
});

await section('the market: the fill order, the ceiling and a race', async () => {
  NOW += MINUTE;
  // Three sellers, one material, four listings: two at 5 (one older), one at 6, one at 20.
  const dear = newUser('dear');
  const early = newUser('early');
  const late = newUser('late');
  const taker = newUser('taker');
  for (const u of [dear, early, late, taker]) await play(u);
  for (const u of [dear, early, late]) await editSave(u, (s) => put(s, 'bank', 'bitter_fell', 100));
  await editSave(taker, (s) => { s.player.gold = 5000; });

  NOW += 1000;
  const a = (await play(early, cmd('marketList', { key: 'bitter_fell', from: 'bank', qty: 10, price: 5 }))).results[0].data.listingId;
  NOW += 1000;
  const b = (await play(late, cmd('marketList', { key: 'bitter_fell', from: 'bank', qty: 10, price: 5 }))).results[0].data.listingId;
  NOW += 1000;
  const c = (await play(late, cmd('marketList', { key: 'bitter_fell', from: 'bank', qty: 10, price: 6 }))).results[0].data.listingId;
  NOW += 1000;
  const d = (await play(dear, cmd('marketList', { key: 'bitter_fell', from: 'bank', qty: 10, price: 20 }))).results[0].data.listingId;

  NOW += 1000;
  // 12 at a ceiling of 6: the older 5 first, then the newer 5, and the 6 only for what is left.
  const first = await play(taker, cmd('marketBuyPool', { key: 'bitter_fell', qty: 12, maxEach: 6 }));
  same('cheapest first, and among equal prices the oldest listing first',
    (await q('select id, qty_left from public.market_listings where id = any($1::bigint[]) order by id', [[a, b, c, d]])).map((r) => Number(r.qty_left)),
    [0, 8, 10, 10]);
  same('and it cost the bands it walked, plus one fee on the basket', first.results[0].data,
    { key: 'bitter_fell', qty: 12, cost: 63, fee: 3, asked: 12, short: false });

  NOW += 1000;
  // The ceiling: 20 are asked for at 6, and the 20 gold listing is never touched.
  const capped = await play(taker, cmd('marketBuyPool', { key: 'bitter_fell', qty: 20, maxEach: 6 }));
  same('a ceiling fills short rather than reaching into a dearer band', capped.results[0].data,
    { key: 'bitter_fell', qty: 18, cost: 105, fee: 5, asked: 20, short: true });
  same('the dear listing is untouched', Number((await listing(d)).qty_left), 10);
  same('nothing above the ceiling is for sale', (await play(taker, cmd('marketBuyPool', { key: 'bitter_fell', qty: 1, maxEach: 6 }))).results[0].error,
    'Nobody is selling that at your price.');

  /* Two buyers after one pool. PGlite is one connection, so requests cannot truly overlap here
     and the lock order is what makes an overlap safe (docs/SERVER.md 2). What is tested is the
     half a test can reach, and the half that actually bites: both buyers hold the same view of
     the bands, one of them empties a band, and the other's command is answered from the rows
     the fill locks rather than from anything the browser saw. */
  NOW += 1000;
  const rival = newUser('rival');
  await play(rival);
  await editSave(rival, (s) => { s.player.gold = 5000; });
  await editSave(dear, (s) => put(s, 'bank', 'godsbane_harvest', 20));
  await editSave(early, (s) => put(s, 'bank', 'godsbane_harvest', 20));
  NOW += 1000;
  const cheapPool = (await play(dear, cmd('marketList', { key: 'godsbane_harvest', from: 'bank', qty: 20, price: 10 }))).results[0].data.listingId;
  const dearPool = (await play(early, cmd('marketList', { key: 'godsbane_harvest', from: 'bank', qty: 20, price: 30 }))).results[0].data.listingId;

  NOW += 1000;
  // Both see 20 at 10 and 20 at 30. The first takes 15 of the cheap band.
  const one = await play(taker, cmd('marketBuyPool', { key: 'godsbane_harvest', qty: 15, maxEach: 10 }));
  same('the first buyer has the 15 they asked for', one.results[0].data, { key: 'godsbane_harvest', qty: 15, cost: 158, fee: 8, asked: 15, short: false });
  NOW += 1000;
  // The second asks for the same 15 at the same ceiling: 5 are left, and the dear band is not
  // reached for the rest. They are never sold what the first buyer took.
  const two = await play(rival, cmd('marketBuyPool', { key: 'godsbane_harvest', qty: 15, maxEach: 10 }));
  same('the second is sold only what was left, at the price they were promised', two.results[0].data,
    { key: 'godsbane_harvest', qty: 5, cost: 53, fee: 3, asked: 15, short: true });
  same('the cheap pool is empty and the dear one untouched',
    [Number((await listing(cheapPool)).qty_left), (await listing(cheapPool)).status, Number((await listing(dearPool)).qty_left)], [0, 'sold', 20]);
  const moved = await q('select qty, price_each::int as p, fee::int as fee, buyer_fee::int as buyer_fee from public.market_sales where listing_id = $1 order by id', [cheapPool]);
  same('the sale rows add up to the 20 that existed, and no more', moved.reduce((n, r) => n + Number(r.qty), 0), 20);
  const spent = [one, two].reduce((n, r) => n + r.results[0].data.cost, 0);
  const owed = moved.reduce((n, r) => n + Number(r.qty) * r.p + Number(r.buyer_fee), 0);
  same('what the two buyers paid is what the rows say they paid', spent, owed);
  same('and what they hold is what the rows say moved',
    [haveQty(one.state, 'godsbane_harvest'), haveQty(two.state, 'godsbane_harvest')], [15, 5]);
  const gold = moved.reduce((n, r) => n + Number(r.qty) * r.p - Number(r.fee), 0);
  NOW += 1000;
  same('the seller is posted the asks less their own leg', (await play(dear)).state.player.gold, gold);

  // Two buys in one request: the second is played after the first, so it reads the first's work.
  NOW += 1000;
  await editSave(late, (s) => put(s, 'bank', 'godsbane_weave', 6));
  const twice = (await play(late, cmd('marketList', { key: 'godsbane_weave', from: 'bank', qty: 6, price: 2 }))).results[0].data.listingId;
  NOW += 1000;
  const pair = await play(taker,
    cmd('marketBuyPool', { key: 'godsbane_weave', qty: 4, maxEach: 2 }),
    cmd('marketBuyPool', { key: 'godsbane_weave', qty: 4, maxEach: 2 }));
  same('the second buy in one request sees what the first one took', pair.results.map((r) => r.data.qty), [4, 2]);
  same('and the listing is drained exactly once', [Number((await listing(twice)).qty_left), (await listing(twice)).status], [0, 'sold']);
});

await section('the market: nobody learns a name', async () => {
  NOW += MINUTE;
  const hidden = newUser('hidden');
  const nosy = newUser('nosy');
  await play(hidden);
  await play(nosy);
  await editSave(hidden, (s) => put(s, 'bank', 'slag_delve', 40));
  await editSave(nosy, (s) => { s.player.gold = 500; });
  NOW += 1000;
  const mine = (await play(hidden, cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 20, price: 4 }))).results[0].data.listingId;
  NOW += 1000;
  await play(nosy, cmd('marketBuyPool', { key: 'slag_delve', qty: 5, maxEach: 4 }));

  // Everything a client can reach, as that client. The tables answer about your own rows only,
  // and the three functions the market page uses carry no id and no name of anybody else.
  const asPlayer = async (userId, sql, params = []) => {
    try {
      await db.exec('set role authenticated');
      await db.query('select set_config(\'request.jwt.claim.sub\', $1, false)', [userId]);
      return { rows: (await db.query(sql, params)).rows, error: null };
    } catch (e) {
      return { rows: null, error: e.message };
    } finally {
      await db.exec('reset role');
      await db.query('select set_config(\'request.jwt.claim.sub\', \'\', false)');
    }
  };

  const seen = await asPlayer(nosy.id, 'select id, seller_id, seller_name from public.market_listings');
  same('a buyer reads no listing but their own (they have none)', [seen.error, seen.rows], [null, []]);
  const ownRows = await asPlayer(hidden.id, 'select id::int as id from public.market_listings order by id');
  same('a seller still reads their own listings', ownRows.rows.map((r) => r.id), [mine]);
  const sales = await asPlayer(hidden.id, 'select id from public.market_sales');
  check('market_sales cannot be read at all', /permission denied/.test(sales.error || ''), sales.error || sales.rows);

  const pools = await asPlayer(nosy.id, 'select * from public.market_pools($1, null, 50, 8)', ['Slag']);
  const pooled = pools.rows && pools.rows[0];
  check('market_pools answers with the pool and no seller', !!pooled && Number(pooled.qty_left) === 15 && Number(pooled.price_min) === 4
    && !/seller|user_id/i.test(Object.keys(pooled).join(',')), pooled);
  same('and the bands are the prices, not the people', pooled && pooled.bands, [{ each: 4, qty: 15 }]);
  const ownPool = await asPlayer(hidden.id, 'select * from public.market_pools($1, null, 50, 8)', ['Slag']);
  same('a seller does not see their own stock in the pool they could buy from', ownPool.rows, []);

  await editSave(hidden, (s) => put(s, 'inv', 'slag_sword|epic|c9.1', 1));
  NOW += 1000;
  const piece = (await play(hidden, cmd('marketList', { key: 'slag_sword|epic|c9.1', from: 'inv', qty: 1, price: 300 }))).results[0].data.listingId;
  const browsed = await asPlayer(nosy.id, 'select * from public.market_browse($1, null, null, $2, 50, 0)', ['', 'price']);
  const gearRow = browsed.rows && browsed.rows.find((r) => Number(r.id) === piece);
  check('market_browse hands a stranger the piece with no name on it and mine false',
    !!gearRow && gearRow.mine === false && !/seller|user_id/i.test(Object.keys(gearRow).join(',')), gearRow || browsed);
  const ownBrowse = await asPlayer(hidden.id, 'select mine from public.market_browse($1, null, null, $2, 50, 0)', ['', 'price']);
  same('and tells a seller which of them is theirs', ownBrowse.rows.map((r) => r.mine), [true]);
  const noMaterials = await asPlayer(nosy.id, 'select count(*)::int as n from public.market_browse($1, $2, null, $3, 50, 0)', ['', 'material', 'price']);
  same('browsing never returns a material listing', noMaterials.rows[0].n, 0);

  const ledger = await asPlayer(nosy.id, 'select side, item_name, qty, fee::int as fee from public.market_sales_mine(50)');
  same('a buyer reads their own side of the trade, and nothing of the seller', ledger.rows, [{ side: 'bought', item_name: 'Slag Ore', qty: 5, fee: 1 }]);
  const sellerLedger = await asPlayer(hidden.id, 'select side, qty, fee::int as fee from public.market_sales_mine(50)');
  same('and the seller reads theirs', sellerLedger.rows, [{ side: 'sold', qty: 5, fee: 1 }]);
  const outsider = newUser('outsider');
  await play(outsider);
  const stranger = await asPlayer(outsider.id, 'select count(*)::int as n from public.market_sales_mine(50)');
  same('a third party reads no sale at all', stranger.rows[0].n, 0);
  const strangerPool = await asPlayer(outsider.id, 'select qty_left from public.market_pools($1, null, 50, 8)', ['Slag']);
  check('though the pool itself is open to them', strangerPool.rows.length === 1, strangerPool);
});

await section('the market: refusals', async () => {
  NOW += MINUTE;
  const stall = newUser('stall');
  const poor = newUser('poor');
  const full = newUser('full');
  await play(stall);
  await play(poor);
  await play(full);
  await editSave(stall, (s) => { put(s, 'bank', 'slag_delve', 50); put(s, 'bank', 'bitter_fell', 12); put(s, 'bank', 'bitter_stave', 20); });
  await editSave(poor, (s) => { s.player.gold = 5; });
  await editSave(full, (s) => { s.player.gold = 1000; fillStorage(s, ['slag_delve', 'bitter_stave']); });

  NOW += 1000;
  const l = await play(stall, cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 20, price: 9 }));
  const id = l.results[0].data.listingId;
  // A pool nobody else in this suite has stock in, so the cheapest band is known: 9 gold.
  const only = (await play(stall, cmd('marketList', { key: 'bitter_stave', from: 'bank', qty: 20, price: 9 }))).results[0].data.listingId;
  const salesBefore = (await q1('select count(*)::int as n from public.market_sales')).n;

  NOW += 1000;
  // 9 plus the market's leg is 10, and there are 5 gold in the purse.
  const p = await play(poor, cmd('marketBuyPool', { key: 'bitter_stave', qty: 1, maxEach: 9 }));
  check('not enough gold is refused', p.results[0].ok === false && /gold/i.test(p.results[0].error), p.results[0]);
  same('and nothing moved', [p.state.player.gold, haveQty(p.state, 'bitter_stave'), (await listing(only)).qty_left], [5, 0, 20]);

  NOW += 1000;
  const f = await play(full, cmd('marketBuyPool', { key: 'bitter_stave', qty: 1, maxEach: 9 }));
  check('no room is refused', f.results[0].ok === false && typeof f.results[0].error === 'string', f.results[0]);
  same('and nothing moved', [f.state.player.gold, haveQty(f.state, 'bitter_stave'), (await listing(only)).qty_left], [1000, 0, 20]);
  same('no sales were written', (await q1('select count(*)::int as n from public.market_sales')).n, salesBefore);

  NOW += 1000;
  const junk = await play(poor,
    cmd('marketBuy', { listingId: id, qty: 0 }),
    cmd('marketBuy', { listingId: id, qty: 1.5 }),
    cmd('marketBuy', { listingId: String(id), qty: 1 }),
    cmd('marketBuy', { listingId: 987654321, qty: 1 }),
    cmd('marketCancel', { listingId: id }));
  same('junk quantities and ids, and cancelling someone else\'s listing', junk.results.map((r) => r.error),
    ['Choose how many to buy.', 'Choose how many to buy.', 'That listing is gone.', 'That listing is gone.', 'That listing is gone.']);

  NOW += 1000;
  const poolJunk = await play(poor,
    cmd('marketBuyPool', { key: 'bitter_stave', qty: 0, maxEach: 9 }),
    cmd('marketBuyPool', { key: 'bitter_stave', qty: 1.5, maxEach: 9 }),
    cmd('marketBuyPool', { key: 'bitter_stave', qty: 1 }),
    cmd('marketBuyPool', { key: 'bitter_stave', qty: 1, maxEach: 0 }),
    cmd('marketBuyPool', { key: 'bitter_stave', qty: 1, maxEach: 1e9 + 1 }),
    cmd('marketBuyPool', { key: 'no_such_thing', qty: 1, maxEach: 9 }),
    cmd('marketBuyPool', { key: 'bitter_stave|rare|1', qty: 1, maxEach: 9 }),
    cmd('marketBuyPool', { qty: 1, maxEach: 9 }));
  same('junk quantities, ceilings and keys', poolJunk.results.map((r) => r.error), [
    'Choose how many to buy.', 'Choose how many to buy.',
    'Name the most you will pay each.', 'Name the most you will pay each.', 'Name the most you will pay each.',
    'No such item.', 'No such item.', 'No such item.',
  ]);
  same('and none of it moved a thing', [poolJunk.state.player.gold, (await listing(only)).qty_left], [5, 20]);

  NOW += 1000;
  const refused = await play(stall,
    cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 999, price: 5 }),
    cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 1, price: 0 }),
    cmd('marketList', { key: 'godsbane_frond|legendary|x1', from: 'bank', qty: 1, price: 5 }));
  check('listings the rules refuse are refused', refused.results.every((r) => r.ok === false && typeof r.error === 'string'), refused.results);
  same('and take nothing', refused.state.bank.items.slag_delve, 30);

  NOW += 1000;
  const c = await play(stall, cmd('marketCancel', { listingId: id }));
  same('cancelling returns the goods', [c.results[0].ok, c.results[0].data, c.state.bank.items.slag_delve], [true, { listingId: id, key: 'slag_delve', qty: 20 }, 50]);
  same('the listing is cancelled', (await listing(id)).status, 'cancelled');
  same('a second cancel finds it gone', (await play(stall, cmd('marketCancel', { listingId: id }))).results[0].error, 'That listing is gone.');

  NOW += 1000;
  const whole = await play(stall, cmd('marketList', { key: 'bitter_fell', from: 'bank', qty: 12, price: 4 }));
  const wholeId = whole.results[0].data.listingId;
  same('listing a whole stack frees its slot', whole.state.bank.items.bitter_fell, undefined);
  await editSave(stall, (s) => fillStorage(s, ['bitter_fell']));
  NOW += 1000;
  const blocked = await play(stall, cmd('marketCancel', { listingId: wholeId }));
  same('cancelling with no room is refused', [blocked.results[0].ok, blocked.results[0].error], [false, 'No room to take it back.']);
  same('and the listing stays open', [(await listing(wholeId)).status, (await listing(wholeId)).qty_left, blocked.state.bank.items.bitter_fell], ['open', 12, undefined]);
  await editSave(stall, (s) => take(s, 'bank', s.bank.order[s.bank.order.length - 1]));
  NOW += 1000;
  const freed = await play(stall, cmd('marketCancel', { listingId: wholeId }));
  same('with a slot free it comes back', [freed.results[0].ok, freed.state.bank.items.bitter_fell, (await listing(wholeId)).status], [true, 12, 'cancelled']);

  NOW += 1000;
  const lots = newUser('lots');
  await play(lots);
  await editSave(lots, (s) => put(s, 'bank', 'slag_delve', 30));
  NOW += 1000;
  const max = CONFIG.economy.marketMaxListings;
  const spree = await play(lots, ...Array.from({ length: max + 1 }, () => cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 1, price: 2 })));
  same(`${max} listings open, the next refused`, spree.results.map((r) => r.ok), [...Array(max).fill(true), false]);
  same('with a message', spree.results[max].error, `You already have ${max} listings open.`);
  same('and only the listed ore left the Stockpile', spree.state.bank.items.slag_delve, 30 - max);

  // Listing and taking back never holds more than the open limit, but every listing is a row.
  NOW += 1000;
  const churn = newUser('churn');
  await play(churn);
  await editSave(churn, (s) => put(s, 'bank', 'slag_delve', 30));
  const twenty = () => Array.from({ length: 20 }, () => cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 1, price: 2 }));
  let made = 0;
  for (let round = 0; round < 3; round++) {
    NOW += 1000;
    const listedNow = await play(churn, ...twenty());
    const ids = listedNow.results.filter((r) => r.ok).map((r) => r.data.listingId);
    made += ids.length;
    NOW += 1000;
    await play(churn, ...ids.map((listingId) => cmd('marketCancel', { listingId })));
  }
  same('60 listings made and taken back inside an hour', made, 60);
  NOW += 1000;
  const slowed = await play(churn, cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 1, price: 2 }));
  same('the 61st in the hour is refused though none are open', [slowed.results[0].ok, slowed.results[0].error, slowed.state.bank.items.slag_delve],
    [false, 'Slow down. The market takes 60 listings an hour.', 30]);
  NOW += HOUR;
  same('an hour on, the market takes listings again', (await play(churn, cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 1, price: 2 }))).results[0].ok, true);
});

await section('the post', async () => {
  NOW += MINUTE;
  const box = newUser('box');
  await play(box);
  await editSave(box, (s) => fillStorage(s, ['slag_delve']));
  const letter = (kind, gold, key, qty, note) => db.query(
    'insert into public.mail (user_id, kind, gold, item_key, qty, note) values ($1, $2, $3, $4, $5, $6)',
    [box.id, kind, gold, key, qty, note],
  );
  await letter('gold', 50, null, 0, 'first');
  await letter('item', 0, 'slag_delve', 3, 'second');
  await letter('gold', 25, null, 0, 'third');

  NOW += 1000;
  const r = await play(box);
  const letters = await mailOf(box);
  same('a gold letter is claimed', [letters[0].claimed, r.state.player.gold >= 50], [true, true]);
  same('an item letter with no room stays unclaimed', [letters[1].claimed, haveQty(r.state, 'slag_delve')], [false, 0]);
  check('what was claimed matches the gold received', r.state.player.gold === (letters[0].claimed ? 50 : 0) + (letters[2].claimed ? 25 : 0), { gold: r.state.player.gold, letters });

  await editSave(box, (s) => take(s, 'inv', s.inv.order[0]));
  NOW += 1000;
  const r2 = await play(box);
  same('with room the rest arrives', [(await mailOf(box)).map((l) => l.claimed), haveQty(r2.state, 'slag_delve'), r2.state.player.gold], [[true, true, true], 3, 75]);

  await letter('item', 0, 'no_such_thing', 2, 'from an older world');
  NOW += 1000;
  const r3 = await play(box);
  same('a letter holding something the camp no longer knows is claimed empty', [(await mailOf(box)).at(-1).claimed, haveQty(r3.state, 'no_such_thing')], [true, 0]);
  same('and the browser hears of it as news', r3.events.filter((e) => e.type === 'mail:unknown').map((e) => [e.count, 'state' in e]), [[1, false]]);
});

await section('party hunts share ground', async () => {
  NOW += MINUTE;
  const T0 = NOW;
  const names = ['wolf_a', 'wolf_b', 'lone', 'pack_d', 'pack_e', 'farm', 'alt'];
  const [a, b, solo, d, e, farm, alt] = names.map((n) => newUser(n));
  const everyone = [a, b, solo, d, e, farm, alt];
  // Everyone gets the same seed and the same camp, so only the party can make a difference.
  // Packed, not carried: only the Satchel is reachable in a fight.
  const hardy = (s) => { s.skills.warfare = 2000; put(s, 'satchel', 'provision_t1', 60); };
  for (const u of everyone) await seedSave(u, 4242, hardy);
  for (const u of everyone) await play(u);

  const party = async (leader, member) => {
    const pid = randomUUID();
    await db.query(`insert into public.parties (id, name, leader_id) values ($1, $2, $3)`, [pid, `${leader.name} pack`, leader.id]);
    await db.query(`insert into public.party_members (party_id, user_id, username) values ($1, $2, $3), ($1, $4, $5)`, [pid, leader.id, leader.name, member.id, member.name]);
  };
  await party(a, b);
  await party(d, e);
  await party(farm, alt);

  const outer = cmd('startHunt', { tier: 1, zone: 'outer', limit: null });
  for (const u of [a, b, solo, d, farm, alt]) {
    const r = await play(u, { ...outer, id: `h_${u.name}` });
    check(`${u.name} sets out on Outer ground`, r.results[0].ok === true, r.results[0]);
  }
  const mid = await play(e, cmd('startHunt', { tier: 1, zone: 'middle', limit: null }));
  check('pack_e sets out on Middle ground', mid.results[0].ok === true, mid.results[0]);

  // An hour on. Everyone but the alt kept a tab open (heartbeats keep last_seen fresh); the alt
  // set out and has not been seen since.
  NOW = T0 + HOUR;
  await db.query('update public.profiles set last_seen = to_timestamp($1::float8 / 1000) where user_id = any($2::uuid[])',
    [NOW, [a, b, solo, d, e, farm].map((u) => u.id)]);
  const xp = {};
  const states = {};
  for (const u of [a, b, solo, d, e, farm]) {
    const r = await play(u);
    states[u.name] = r.state;
    xp[u.name] = r.state.skills.warfare - 2000;
  }
  check('the hunts ran the hour', states.lone.tasks.combat && states.lone.stats.kills > 0, { kills: states.lone.stats.kills, task: !!states.lone.tasks.combat });
  check('two members on the same ground both out-earn the solo hunter', xp.wolf_a > xp.lone && xp.wolf_b > xp.lone, xp);
  // The bonus is 5% a member now. The margin lands on it exactly, so an exact
  // comparison sits a float's width under it: allow that width.
  check('by a margin like the 5% bonus', xp.wolf_a >= xp.lone * 1.05 - 1e-6, xp);
  same('a member on other ground gives nothing: pack_d earns exactly what the solo hunter did', xp.pack_d, xp.lone);
  same('and hunts exactly the same hour', { ...states.pack_d, meta: null, log: null }, { ...states.lone, meta: null, log: null });
  check('an alt that set out and went quiet lends its bonus only for the three minutes after it was seen',
    xp.farm >= xp.lone && xp.farm - xp.lone < (xp.wolf_a - xp.lone) / 4, xp);
});

await section('a party hunt, together', async () => {
  NOW += MINUTE;
  const T0 = NOW;
  const TICK_SECRET = 'tick_secret_long_enough_to_be_one';
  const ticker = createGameHandler({ db: adapter, getUser, now: () => NOW, log, tickSecret: TICK_SECRET });
  // The cron's door: no user token, a path of its own, and the secret in a header.
  const tick = async (secret = TICK_SECRET, via = ticker) => {
    const res = await via({
      method: 'POST',
      headers: secret == null ? {} : { 'x-respite-tick': secret },
      bodyText: '{"tick":true}',
      url: 'https://x.supabase.co/functions/v1/game/tick',
    });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const inParty = async (name, ...users) => {
    const pid = randomUUID();
    await db.query('insert into public.parties (id, name, leader_id) values ($1, $2, $3)', [pid, name, users[0].id]);
    for (const u of users) {
      await db.query('insert into public.party_members (party_id, user_id, username) values ($1, $2, $3)', [pid, u.id, u.name]);
    }
    return pid;
  };
  const huntRow = (pid) => q1(
    `select id::int as id, tier, zone, over, clock::float8 as clock, started_at::float8 as started_at,
            next_due::float8 as next_due, over_at::float8 as over_at, view, session,
            (select coalesce(jsonb_agg(m::text), '[]'::jsonb) from unnest(members) m) as members
     from public.party_hunts where party_id = $1 order by id`,
    [pid],
  );

  const sword = 'slag_sword|common';
  const everywhere = GameData.REGIONS.map((r) => r.id);
  // A sword to wear out, remedies packed, and every ground open so the hard ones can be tried.
  const kit = (xp) => (s) => {
    s.skills.warfare = xp;
    put(s, 'satchel', 'provision_t1', 80);
    s.equipment.weapon = sword;
    s.travel.unlocked = everywhere;
  };
  const [ann, bex, cade, lone] = ['band_a', 'band_b', 'band_c', 'band_solo'].map((n) => newUser(n));
  await seedSave(ann, 909, kit(200000));
  await seedSave(bex, 909, kit(6000));
  await seedSave(cade, 909, kit(6000));
  await seedSave(lone, 909, kit(6000));
  for (const u of [ann, bex, cade, lone]) await play(u);
  const pid = await inParty('the band', ann, bex, cade);

  const out = await play(ann, cmd('partyHuntStart', { tier: 1, zone: 'outer' }));
  same('a member sets the party out', out.results[0], { id: `c${serial - 1}`, ok: true, data: { tier: 1, zone: 'outer' } });
  const started = await huntRow(pid);
  check('the party has a session of its own, live and stamped', !!started && started.over === false && started.clock === T0 && started.started_at === T0,
    started && { over: started.over, clock: started.clock, started: started.started_at });
  same('with the member who set out on its roster', started.members, [ann.id]);

  same('another member joins it', (await play(bex, cmd('partyHuntJoin'))).results[0].ok, true);
  same('and a third', (await play(cade, cmd('partyHuntJoin'))).results[0].ok, true);
  same('a second start is refused', (await play(ann, cmd('partyHuntStart', { tier: 1, zone: 'outer' }))).results[0].error, 'Your party is already out.');
  same('so is joining the one you are already in', (await play(bex, cmd('partyHuntJoin'))).results[0].error, PARTY_OUT);
  same('setting out alone while out with the party is refused', (await play(ann, cmd('startHunt', { tier: 1, zone: 'outer', limit: null }))).results[0].error, PARTY_OUT);
  same('and nothing came of any of it', (await huntRow(pid)).session.hunters.length, 3);

  same('a player in no party cannot set one out', (await play(lone, cmd('partyHuntStart', { tier: 1, zone: 'outer' }))).results[0].error, 'You are not in a party.');
  same('nor join one', (await play(lone, cmd('partyHuntJoin'))).results[0].error, 'You are not in a party.');
  same('nor leave one', (await play(lone, cmd('partyHuntLeave'))).results[0].error, 'Your party isn\'t out.');

  // A party of their own, so the refusals can be tried without disturbing the band.
  const [gil, hob] = ['band_g', 'band_h'].map((n) => newUser(n));
  await seedSave(gil, 77, kit(6000));
  await seedSave(hob, 77, (s) => { s.skills.warfare = 6000; });
  await play(gil);
  await play(hob);
  await inParty('the pair', gil, hob);
  same('ground the party cannot walk is refused', (await play(hob, cmd('partyHuntStart', { tier: 5, zone: 'outer' }))).results[0].error, 'That ground isn\'t open.');
  same('a tier that is not one is refused', (await play(gil, cmd('partyHuntStart', { tier: 99, zone: 'outer' }))).results[0].error, 'That ground isn\'t open.');
  same('a zone that is not one is refused', (await play(gil, cmd('partyHuntStart', { tier: 1, zone: 'nowhere' }))).results[0].error, 'No such zone.');
  await play(gil, cmd('startHunt', { tier: 1, zone: 'outer', limit: null }));
  same('a hunter already out alone is told to come back first', (await play(gil, cmd('partyHuntStart', { tier: 1, zone: 'outer' }))).results[0].error, 'Pull back before you set out with your party.');
  same('and their own hunt is untouched', !!(await saved(gil)).data.tasks.combat, true);

  same('the tick refuses a wrong secret', (await tick('nope')).status, 401);
  same('and one that brings no secret at all', (await tick(null)).status, 401);
  const quiet = logged.length;
  const unset = createGameHandler({ db: adapter, getUser, now: () => NOW, log });
  same('a function with no secret set refuses every tick', (await tick(TICK_SECRET, unset)).status, 401);
  check('and says why in the log', logged.length === quiet + 1 && /no tick secret/.test(logged[logged.length - 1]), logged.slice(quiet));
  logged.length = quiet;

  NOW = T0 + 20 * MINUTE;
  const ticked = await tick();
  same('the tick plays every live session', [ticked.status, ticked.body.ok, ticked.body.ticked > 0], [200, true, true]);
  const fought = await huntRow(pid);
  check('the session is up to date and has been through encounters',
    fought.clock === NOW && fought.session.encounters > 0 && fought.session.elapsed > 0,
    { clock: fought.clock, now: NOW, encounters: fought.session.encounters });
  /* Everyone who landed a blow is owed XP, by share of the damage. Kills are not shared:
     one corpse is one kill, to whoever hurt it most, or a four would write four kills and
     the Monsters killed board would be lying. */
  check('and everyone in it is owed XP for what they hurt', fought.session.hunters.every((u) => u.owed.xp > 0),
    fought.session.hunters.map((u) => ({ xp: Math.round(u.owed.xp), kills: u.owed.kills })));
  const corpses = fought.session.hunters.reduce((n, u) => n + u.owed.kills, 0);
  check('and a corpse is counted once, not once a hunter', corpses > 0 && corpses === fought.session.hunters.reduce((n, u) => n + u.owed.slain.length, 0),
    fought.session.hunters.map((u) => ({ kills: u.owed.kills, slain: u.owed.slain.length })));

  /* Written and read back inside one encounter, which is the case that catches a session coming
     out of jsonb as two copies of every hunter: the roster and the live encounter share them in
     memory, and a tick that never crosses an encounter boundary only moves the fight's copy. A
     share settled off the other one would pay for the blows landed before the row was written.
     Deep ground, because the encounters there last long enough to be caught twice. */
  const [rud, sam] = ['band_r', 'band_s'].map((n) => newUser(n));
  await seedSave(rud, 1234, kit(6000));
  await seedSave(sam, 1234, kit(6000));
  await play(rud);
  await play(sam);
  await inParty('the deep pair', rud, sam);
  await play(rud, cmd('partyHuntStart', { tier: 5, zone: 'core' }));
  await play(sam, cmd('partyHuntJoin'));
  const deep = await q1('select party_id from public.party_hunts where $1::uuid = any(members)', [rud.id]);
  let mid = null;
  for (let i = 0; i < 40 && !mid; i++) {
    const was = await huntRow(deep.party_id);
    NOW += 1000;
    await tick();
    const now = await huntRow(deep.party_id);
    if (was.session.enc && now.session.enc && was.session.enc.id === now.session.enc.id) mid = now;
  }
  check('a tick can land twice inside one encounter', !!mid, 'the fight was never caught twice');
  check('and the session comes back with one copy of each hunter, not two', !!mid && mid.session.enc.hunters.every((u) => {
    const one = mid.session.hunters.find((x) => x.userId === u.userId);
    return one && Math.round(one.dmg) === Math.round(u.dmg) && Math.round(one.owed.xp) === Math.round(u.owed.xp);
  }), mid && {
    roster: mid.session.hunters.map((u) => Math.round(u.dmg)),
    fight: mid.session.enc.hunters.map((u) => Math.round(u.dmg)),
  });

  const band = await huntRow(pid);
  const dmg = Object.fromEntries(band.view.hunters.map((u) => [u.userId, u.dmg]));

  // Everyone kept a tab open, so the party's own bonus is live for all of them alike.
  await db.query('update public.profiles set last_seen = to_timestamp($1::float8 / 1000) where user_id = any($2::uuid[])',
    [NOW, [ann, bex, cade].map((u) => u.id)]);
  const paid = { [ann.id]: await play(ann), [bex.id]: await play(bex) };
  const xp = { [ann.id]: paid[ann.id].state.skills.warfare - 200000, [bex.id]: paid[bex.id].state.skills.warfare - 6000 };
  check('each member is paid on their own request', xp[ann.id] > 0 && xp[bex.id] > 0, xp);
  check('gold, kills and loot came with it', paid[ann.id].state.player.gold > 0 && paid[ann.id].state.stats.kills > 0, {
    gold: paid[ann.id].state.player.gold, kills: paid[ann.id].state.stats.kills,
  });
  const share = (id) => xp[id] / (xp[ann.id] + xp[bex.id]);
  const dealt = (id) => dmg[id] / (dmg[ann.id] + dmg[bex.id]);
  check('the stronger hunter did more and was paid more', dmg[ann.id] > dmg[bex.id] && xp[ann.id] > xp[bex.id], { dmg, xp });
  check('and the shares follow the damage', Math.abs(share(ann.id) - dealt(ann.id)) < 0.2, { xp: share(ann.id), dmg: dealt(ann.id) });
  check('the browser hears what the share was, without the save', paid[ann.id].events.some((e) => e.type === 'party:spoils' && e.kills > 0 && !('state' in e)),
    paid[ann.id].events.map((e) => e.type));

  const again = await play(ann);
  same('settling again in the same moment pays nothing twice', [again.state.skills.warfare, again.state.stats.kills],
    [paid[ann.id].state.skills.warfare, paid[ann.id].state.stats.kills]);
  check('and says nothing about a share that was not there', !again.events.some((e) => e.type === 'party:spoils'),
    again.events.map((e) => e.type));
  /* Settling empties the settler's owings and nobody else's. Measured on XP rather than
     kills: kills go to whoever hurt a foe most, so a weaker member can honestly be owed
     XP and no kills at all. */
  const roster = (await huntRow(pid)).session.hunters;
  const owing = (id) => {
    const u = roster.find((x) => x.userId === id);
    return u ? u.owed.xp > 0 : null;
  };
  same('settling empties the settler\'s owings', [owing(ann.id), owing(bex.id)], [false, false]);
  check('and leaves the member who has not been back still owed', roster.some((u) => u.owed.xp > 0),
    roster.map((u) => ({ id: u.userId.slice(0, 8), xp: Math.round(u.owed.xp), kills: u.owed.kills })));

  const pres = await presenceOf(ann);
  same('a party hunt writes the presence row like any other hunt', [pres.tier, pres.zone, pres.started, pres.ended],
    [1, 'outer', T0, null]);
  same('and says how long it can last', pres.ends_by, T0 + CONFIG.time.idleCapMs);

  const reply = paid[ann.id];
  check('the reply carries the fight as a watcher may see it', !!reply.party && reply.party.zone === 'outer' && reply.party.hunters.length === 3, reply.party);
  check('and no seed, no dice and no stat lines with it', !/"seed"|"dice"|maxHp|critDmg/.test(JSON.stringify(reply.party)),
    JSON.stringify(reply.party).slice(0, 200));

  let denied = '';
  let watched = null;
  try {
    await db.exec('set role authenticated');
    await db.query('select set_config(\'request.jwt.claim.sub\', $1, false)', [ann.id]);
    try {
      await db.query('select session from public.party_hunts');
    } catch (e) {
      denied = e.message;
    }
    watched = (await db.query('select public.party_hunt_view() as v')).rows[0].v;
  } finally {
    await db.exec('reset role');
    await db.query('select set_config(\'request.jwt.claim.sub\', \'\', false)');
  }
  check('a client cannot read the session row at all', /permission denied/.test(denied), denied || 'it was read');
  check('and the RPC hands it the watcher view and nothing else',
    !!watched && watched.zone === 'outer' && !/"seed"|"dice"|maxHp|critDmg/.test(JSON.stringify(watched)), watched);

  NOW += MINUTE;
  const left = await play(bex, cmd('partyHuntLeave'));
  same('a member can walk away, and is paid on the way out', left.results[0].ok, true);
  check('with what they earned since they last settled', left.state.skills.warfare > paid[bex.id].state.skills.warfare,
    { before: paid[bex.id].state.skills.warfare, after: left.state.skills.warfare });
  const short = await huntRow(pid);
  check('and they are off the roster and out of the fight', !short.members.includes(bex.id) && short.session.hunters.length === 2, short.members);
  check('their presence row is closed', typeof (await presenceOf(bex)).ended === 'number', await presenceOf(bex));
  same('leaving twice is refused', (await play(bex, cmd('partyHuntLeave'))).results[0].error, 'Your party isn\'t out.');
  NOW += 1000;
  same('and they can set out with them again', (await play(bex, cmd('partyHuntJoin'))).results[0].ok, true);

  NOW += 1000;
  same('starting over leaves the party fighting without them', (await play(bex, cmd('resetCamp'))).results[0].ok, true);
  const without = await huntRow(pid);
  check('and the share they had not taken goes with the old camp', !without.members.includes(bex.id) && without.session.hunters.length === 2, without.members);

  // A fall, settled as a fall: the recovery, the wound, the wear and the bestiary.
  NOW += MINUTE;
  const [dread, doom] = ['band_d', 'band_e'].map((n) => newUser(n));
  const green = (s) => { s.equipment.weapon = sword; s.travel.unlocked = everywhere; };
  await seedSave(dread, 5, green);
  await seedSave(doom, 5, green);
  await play(dread);
  await play(doom);
  const pid2 = await inParty('the doomed', dread, doom);
  await play(dread, cmd('partyHuntStart', { tier: 8, zone: 'core' }));
  await play(doom, cmd('partyHuntJoin'));
  NOW += 30 * MINUTE;
  for (let i = 0; i < 5 && !(await huntRow(pid2)).over; i++) await tick();
  const wiped = await huntRow(pid2);
  same('a warband that cannot hold the ground is wiped out', [wiped.over, wiped.session.over], [true, 'wiped']);

  const fell = await play(dread);
  const H = CONFIG.hunt;
  same('a fall in a party is a real death', [fell.state.stats.deaths, fell.state.player.recoveryLeft], [1, H.recoveryMs]);
  same('with the wound that follows one', fell.state.debuff, { until: NOW + H.recoveryMs + H.deathDebuffMs, mult: 1 - H.deathDebuff });
  check('the gear is the worse for it', fell.state.wear[sword] >= H.deathWear, fell.state.wear);
  check('the bestiary remembers what did it', Object.values(fell.state.foeDeaths).reduce((a, b) => a + b, 0) === 1, fell.state.foeDeaths);
  check('and the camp log says so', fell.state.log.some((l) => /put you down/.test(l.m)), fell.state.log.slice(-3));
  check('the fallen are out of the session until they rejoin', !(await huntRow(pid2)).members.includes(dread.id), (await huntRow(pid2)).members);
  await play(doom);
  same('and a session that owes nobody anything is gone', await huntRow(pid2), undefined);

  /* The member who never comes back. cade joined and was never heard from again: the others go on
     being paid, and the cap closes the session without them. */
  await db.query('update public.party_hunts set started_at = started_at - $2::bigint where party_id = $1', [pid, CONFIG.time.idleCapMs]);
  NOW += MINUTE;
  await tick();
  const capped = await huntRow(pid);
  same('a party hunt runs no longer than a lone one', [capped.over, capped.session.over, capped.next_due], [true, 'cap', null]);
  const last = await play(ann);
  check('the last share still comes out of a closed session', last.state.skills.warfare > again.state.skills.warfare,
    { before: again.state.skills.warfare, after: last.state.skills.warfare });
  same('no party hunt is left to watch', last.party, undefined);
  const waiting = await huntRow(pid);
  check('and the row waits for the one who never came back', !!waiting && waiting.members.includes(cade.id) && !waiting.members.includes(ann.id), waiting && waiting.members);

  NOW += 8 * DAY;
  const swept = await tick();
  same('a closed session nobody came back for is swept up', [swept.body.swept > 0, await huntRow(pid)], [true, undefined]);
  same('and the sweep pays what it never delivered to nobody', (await saved(cade)).data.skills.warfare, 6000);
});

await section('hunt presence', async () => {
  NOW += MINUTE;
  const scout = newUser('scout');
  await play(scout);
  const T0 = NOW;
  await play(scout, cmd('startHunt', { tier: 1, zone: 'outer', limit: null }));
  let row = await presenceOf(scout);
  same('a hunt writes where and since when', [row.tier, row.zone, row.started, row.ends_by, row.ended], [1, 'outer', T0, T0 + CONFIG.time.idleCapMs, null]);

  const stamp = row.updated_at.getTime();
  NOW += MINUTE;
  await play(scout);
  row = await presenceOf(scout);
  same('an unchanged hunt leaves the row alone', row.updated_at.getTime(), stamp);

  NOW += MINUTE;
  const stopAt = NOW - 3000;
  const back = await play(scout, cmd('pullBack', {}, stopAt));
  same('pulling back ends the hunt', [back.results[0].ok, back.state.tasks.combat], [true, null]);
  row = await presenceOf(scout);
  same('the row records when it ended', [row.started, row.ended], [T0, stopAt]);

  NOW += MINUTE;
  await play(scout);
  same('a later request leaves the end alone', (await presenceOf(scout)).ended, stopAt);

  NOW += MINUTE;
  await play(scout, cmd('startHunt', { tier: 1, zone: 'middle', limit: 10 }));
  row = await presenceOf(scout);
  same('a new hunt replaces the row', [row.zone, row.started, row.ended], ['middle', NOW, null]);
});

await section('starting over', async () => {
  NOW += MINUTE;
  const ruin = newUser('ruin');
  const buyer = newUser('ruinbuyer');
  await play(ruin);
  await play(buyer);
  await editSave(ruin, (s) => {
    s.player.gold = 300;
    put(s, 'bank', 'slag_delve', 40);
    s.skills.delving = 5000;
    s.rolls = { 'a:delving_t1_raw': 42, 'k:1': 7 };
    s.serial = 50;
  });
  NOW += 1000;
  const before = await play(ruin, cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 10, price: 3 }), cmd('startHunt', { tier: 1, zone: 'outer', limit: null }));
  const listingId = before.results[0].data.listingId;
  await db.query(`insert into public.mail (user_id, kind, gold, note) values ($1, 'gold', 5, 'claimed by the refused request')`, [ruin.id]);

  // Starting over rides with nothing. In the same moment, so the dice below can be compared.
  const mixed = await play(ruin, cmd('setHide', { on: true }), cmd('resetCamp'));
  same('resetCamp beside another command is refused, and the other command still runs', [mixed.results[0].ok, mixed.results[1]],
    [true, { id: `c${serial - 1}`, ok: false, error: START_OVER_ALONE }]);
  same('nothing was reset, and the post came in as usual', [mixed.state.player.gold, mixed.state.skills.delving, (await mailOf(ruin)).map((l) => l.claimed)], [305, 5000, [true]]);

  await db.query(`insert into public.mail (user_id, kind, gold, note) values ($1, 'gold', 40, 'for the new camp')`, [ruin.id]);
  check('set up: a listing, a hunt, a letter', !!(await presenceOf(ruin)) && (await listing(listingId)).status === 'open');
  const revBefore = (await saved(ruin)).rev;

  const r = await play(ruin, cmd('resetCamp'));
  const s = r.state;
  same('resetCamp on its own succeeds', r.results[0], { id: `c${serial - 1}`, ok: true });
  same('a fresh camp at the request clock', [s.schema, s.clock, s.player.gold, s.skills.delving, haveQty(s, 'slag_delve'), s.tasks.combat, s.tasks.skilling], [CONFIG.schema, NOW, 0, 0, 0, null, null]);
  same('the log starts over', s.log, [{ t: NOW, m: 'You start over from a ruin.' }]);
  same('the same owner', [s.meta.account, s.meta.userId], ['ruin', ruin.id]);
  same('the dice do not start over: seed, every stream, the counters and the serial carry on', [s.rng, s.rolls, s.serial],
    [mixed.state.rng, { 'a:delving_t1_raw': 42, 'k:1': 7 }, mixed.state.serial]);
  check('(and they were worth carrying)', mixed.state.serial >= 50 && Object.keys(mixed.state.rng).length >= 3, [mixed.state.serial, mixed.state.rng]);
  same('open listings are cancelled, their goods lost', (await listing(listingId)).status, 'cancelled');
  same('the hunt presence is gone', await presenceOf(ruin), undefined);
  same('the letter waits in the post', (await mailOf(ruin)).map((l) => l.claimed), [true, false]);
  const row = await saved(ruin);
  same('the save is written with rev + 1', [row.rev, isDeepStrictEqual(row.data, s)], [revBefore + 1, true]);
  same('the profile starts over too', (await q1('select total_level from public.profiles where user_id = $1', [ruin.id])).total_level, GameData.SKILLS.length);

  NOW += 1000;
  same('the letter arrives in the new camp', (await play(ruin)).state.player.gold, 40);
  same('the cancelled listing cannot be bought', (await play(buyer, cmd('marketBuy', { listingId, qty: 1 }))).results[0].error, 'That listing is gone.');
});

await section('a long absence is caught up in slices', async () => {
  NOW += MINUTE;
  const T0 = NOW;
  const quick = newUser('quick');
  const slow = newUser('slow');
  const busy = (s) => { s.skills.warfare = 2000; put(s, 'satchel', 'provision_t1', 40); };
  await seedSave(quick, 777, busy);
  await seedSave(slow, 777, busy);
  const setOut = () => [cmd('startSkill', { skillId: 'felling', actionId: 'felling_t1_raw', limit: null }), cmd('startHunt', { tier: 1, zone: 'outer', limit: null })];
  await play(quick, ...setOut());
  await play(slow, ...setOut());

  const tight = createGameHandler({ db: adapter, getUser, now: () => NOW, log, catchUpBudgetMs: 0 });
  NOW = T0 + 2 * HOUR;
  const whole = await play(quick);
  same('with time to spare the catch-up finishes in one request', whole.state.clock, NOW);

  const first = await send(slow, [cmd('setHide', { on: true })], { via: tight });
  same('out of budget the request stops early', [first.status, first.body.state.clock < NOW, first.body.results[0].error], [200, true, CATCHING_UP]);
  check('having played one slice', first.body.state.clock > T0 && first.body.state.tasks.combat !== undefined);
  same('and saved it', (await saved(slow)).clock, first.body.state.clock);

  let rounds = 1;
  let last = first.body;
  while (last.state.clock < NOW && rounds < 30) {
    last = (await send(slow, [], { via: tight })).body;
    rounds++;
  }
  same('later requests finish the job', last.state.clock, NOW);
  check('in several requests', rounds > 2, rounds);
  const strip = (s) => ({ ...s, log: null, meta: { ...s.meta, account: null, userId: null } });
  check('ending exactly where one long request ends', isDeepStrictEqual(strip(last.state), strip(whole.state)), 'states differ');
});

await section('listings expire and go home by post', async () => {
  NOW += MINUTE;
  const hawker = newUser('hawker');
  const passer = newUser('passerby');
  await play(hawker);
  await play(passer);
  await editSave(hawker, (s) => put(s, 'bank', 'slag_delve', 20));
  NOW += 1000;
  const first = await play(hawker, cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 5, price: 3 }));
  const soonId = first.results[0].data.listingId;
  const listedAt = NOW;
  NOW += 2 * DAY;
  const second = await play(hawker, cmd('marketList', { key: 'slag_delve', from: 'bank', qty: 4, price: 3 }));
  const laterId = second.results[0].data.listingId;
  same('two listings open, 9 ore away', [second.state.bank.items.slag_delve, (await listing(soonId)).status, (await listing(laterId)).status], [11, 'open', 'open']);

  NOW = listedAt + CONFIG.economy.marketListingDays * DAY + 1000;
  // Other players' requests do the housekeeping, 50 at a time.
  for (let i = 0; i < 5 && (await listing(soonId)).status === 'open'; i++) await play(passer);
  same('the due listing expires on someone else\'s request', [(await listing(soonId)).status, (await listing(laterId)).status], ['expired', 'open']);
  const letters = await mailOf(hawker);
  same('its goods are posted home', letters.map((l) => [l.kind, l.item_key, l.qty, l.note, l.claimed]), [['item', 'slag_delve', 5, 'Your listing of 5 Slag Ore expired.', false]]);
  same('a buyer finds it gone', (await play(passer, cmd('marketBuy', { listingId: soonId, qty: 1 }))).results[0].error, 'That listing is gone.');

  NOW += 1000;
  const home = await play(hawker);
  same('the seller gets them back on the next request', [home.state.bank.items.slag_delve, (await mailOf(hawker)).map((l) => l.claimed)], [16, [true]]);

  const stale = (await q1(`select count(*)::int as n from public.market_listings where status = 'open' and expires_at <= to_timestamp($1::float8 / 1000)`, [NOW])).n;
  for (let i = 0; i < 5 && stale > 0; i++) await play(passer);
  same('every due listing is eventually expired', (await q1(`select count(*)::int as n from public.market_listings where status = 'open' and expires_at <= to_timestamp($1::float8 / 1000)`, [NOW])).n, 0);
  same('and every expired listing with goods left sent a letter', (await q1(`
    select count(*)::int as n from public.market_listings l
    where l.status = 'expired' and not exists (
      select 1 from public.mail m where m.user_id = l.seller_id and m.kind = 'item' and m.item_key = l.item_key and m.qty = l.qty_left)`)).n, 0);
});

await section('nothing unexpected was logged', async () => {
  same('no server errors', logged, []);
});

console.log(`\n${passed} passed${failed ? `, ${failed} failed` : ''}`);
await closeWire();
await db.close();
process.exit(failed ? 1 : 0);
