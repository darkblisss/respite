// SQL tests for supabase/schema.sql, run on PGlite (Postgres compiled to WASM).
//
// From the repo root, after npm install (paths resolve from this file, so any working directory
// works):
//   npm run test:sql        or        node tests/sql/run.mjs
//
// PGlite is '@electric-sql/pglite' from node_modules. Without an install, PGLITE_PATH names the
// package folder; failing that, a tools/node_modules folder beside the repo is tried. NODE_PATH
// is no help here: Node ignores it for ES module imports.
//
// Setup loads tests/sql/stubs.sql (what Supabase provides), then schema.sql twice to prove it
// is idempotent. Each check prints PASS or FAIL; the process exits 1 if any check fails.
// PGlite has a single connection, so these tests cover the rules, not lock contention.

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const DEFAULT_PGLITE = resolve(REPO, '..', 'tools', 'node_modules', '@electric-sql', 'pglite');

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
}

function same(name, actual, expected) {
  check(name, isDeepStrictEqual(actual, expected), { actual, expected });
}

// The call must throw, with a message matching pattern.
async function refuses(name, thunk, pattern) {
  try {
    await thunk();
  } catch (e) {
    check(name, pattern.test(e.message), `wrong error: ${e.message}`);
    return;
  }
  check(name, false, 'expected an error, but the call succeeded');
}

async function section(title, fn) {
  console.log(`\n# ${title}`);
  try {
    await fn();
  } catch (e) {
    check(`${title}: finished without an unexpected error`, false, e.stack || e.message);
  } finally {
    await server().catch(() => {});
  }
}

/* ================= 2. SESSIONS ================= */

let db;

const ANON = Symbol('anon');
const SIGNED_OUT = ''; // the authenticated role with no JWT subject
const DENIED = /permission denied/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Back to the superuser, as the game function would connect.
async function server() {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
}

// Act as a browser: the anon role, or authenticated with a JWT subject.
async function become(who) {
  if (who === ANON) {
    await db.exec('set role anon');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  } else {
    await db.exec('set role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who]);
  }
}

// Runs one statement as who, then always returns to the superuser.
async function as(who, sql, params = []) {
  await become(who);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await server();
  }
}

async function asValue(who, sql, params = []) {
  const rows = await as(who, sql, params);
  return rows.length ? Object.values(rows[0])[0] : undefined;
}

// Superuser queries.
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const q1 = async (sql, params = []) => (await q(sql, params))[0];
const qv = async (sql, params = []) => {
  const row = await q1(sql, params);
  return row === undefined ? undefined : Object.values(row)[0];
};

const rpc = {
  create: (who, name) => asValue(who, 'select public.party_create($1) as v', [name]),
  invite: (who, username) => asValue(who, 'select public.party_invite($1) as v', [username]),
  cancel: (who, id) => asValue(who, 'select public.party_cancel_invite($1) as v', [id]),
  respond: (who, id, accept) => asValue(who, 'select public.party_respond($1, $2) as v', [id, accept]),
  leave: (who) => asValue(who, 'select public.party_leave() as v'),
  kick: (who, userId) => asValue(who, 'select public.party_kick($1) as v', [userId]),
  say: (who, body) => asValue(who, 'select public.party_say($1) as v', [body]),
  state: (who) => asValue(who, 'select public.party_state() as v'),
  slots: (who, n) => asValue(who, 'select public.party_set_slots($1) as v', [n]),
  propose: (who, tier, zone) => asValue(who, 'select public.party_propose($1, $2) as v', [tier, zone]),
  ready: (who, on) => asValue(who, 'select public.party_ready($1) as v', [on]),
};

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const inviteStatus = (id) => qv('select status from public.party_invites where id = $1', [id]);
const partyOf = (userId) => qv('select party_id from public.party_members where user_id = $1', [userId]);
const memberCount = (partyId) => qv('select count(*)::int from public.party_members where party_id = $1', [partyId]);
const messageCount = (partyId) => qv('select count(*)::int from public.party_messages where party_id = $1', [partyId]);

/* ================= 3. SEEDING (as the game function would) ================= */

const U = {};

async function makeUser(username, { profile = true, total_level = 0, levels = {}, skills = {} } = {}) {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${username}@players.respite`]);
  await db.query(
    `insert into public.saves (user_id, username, data, updated_at, rev, engine, clock)
     values ($1, $2, $3::jsonb, now(), 1, 1, 0)`,
    [id, username, JSON.stringify({ schema: 9, player: { gold: 10 } })],
  );
  if (profile) {
    await db.query(
      `insert into public.profiles (user_id, username, total_level, levels, skills)
       values ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [id, username, total_level, JSON.stringify(levels), JSON.stringify(skills)],
    );
  }
  return id;
}

async function resetParties() {
  await server();
  await db.exec(`
    delete from public.party_messages;
    delete from public.party_invites;
    delete from public.party_members;
    delete from public.parties;
    delete from public.hunt_presence;
  `);
}

// Party with the leader plus members who joined through real invites.
async function partyWith(leader, name, ...members) {
  const partyId = await rpc.create(U[leader], name);
  for (const m of members) {
    await rpc.respond(U[m], await rpc.invite(U[leader], m), true);
  }
  return partyId;
}

/* ================= 4. EXPECTATIONS ================= */

const TABLES = [
  'saves', 'profiles', 'hunt_presence', 'market_listings', 'market_sales',
  'mail', 'parties', 'party_members', 'party_invites', 'party_messages',
];

const POLICIES = {
  saves: ['saves_select_own'],
  profiles: ['profiles_select_all'],
  hunt_presence: [],
  market_listings: ['market_listings_select_open_or_own'],
  market_sales: ['market_sales_select_party_to_sale'],
  mail: ['mail_select_own'],
  parties: ['parties_select_member'],
  party_members: ['party_members_select_same_party'],
  party_invites: ['party_invites_select_sender_or_recipient'],
  party_messages: ['party_messages_select_member'],
};

const RPCS = [
  ['heartbeat', 'public.heartbeat(jsonb)', 'select public.heartbeat(null)'],
  ['online_count', 'public.online_count()', 'select public.online_count()'],
  ['hiscores', 'public.hiscores(text, int)', `select * from public.hiscores('total', 10)`],
  ['party_create', 'public.party_create(text)', `select public.party_create('Wardens')`],
  ['party_invite', 'public.party_invite(text)', `select public.party_invite('ash')`],
  ['party_cancel_invite', 'public.party_cancel_invite(bigint)', 'select public.party_cancel_invite(1)'],
  ['party_respond', 'public.party_respond(bigint, boolean)', 'select public.party_respond(1, true)'],
  ['party_leave', 'public.party_leave()', 'select public.party_leave()'],
  ['party_kick', 'public.party_kick(uuid)', `select public.party_kick('00000000-0000-0000-0000-000000000000')`],
  ['party_say', 'public.party_say(text)', `select public.party_say('hello')`],
  ['party_state', 'public.party_state()', 'select public.party_state()'],
];

async function checkPolicies(label) {
  const rows = await q(`
    select tablename, policyname, cmd, roles::text[] as roles, permissive
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname
  `);
  for (const t of TABLES) {
    const got = rows
      .filter((r) => r.tablename === t)
      .map((r) => `${r.policyname}:${r.cmd}:${r.roles.join(',')}:${r.permissive}`);
    const want = POLICIES[t].map((p) => `${p}:SELECT:authenticated:PERMISSIVE`);
    same(`${label}: ${t} has exactly its listed policies`, got, want);
  }
}

/* ================= 5. SUITES ================= */

async function schemaShape() {
  const rls = await q(`
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  `);
  for (const t of TABLES) {
    const row = rls.find((r) => r.relname === t);
    check(`RLS is enabled on ${t}`, row && row.relrowsecurity === true && row.relforcerowsecurity === false, row);
  }

  await checkPolicies('policies');
  same(
    'old saves policies were dropped without knowing their names',
    await qv(`select count(*)::int from pg_policies where tablename = 'saves' and policyname <> 'saves_select_own'`),
    0,
  );

  same(
    'saves gained rev, engine and clock',
    await q(`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'saves' and column_name in ('rev', 'engine', 'clock')
      order by column_name
    `),
    [
      { column_name: 'clock', data_type: 'bigint', is_nullable: 'YES', column_default: null },
      { column_name: 'engine', data_type: 'integer', is_nullable: 'YES', column_default: null },
      { column_name: 'rev', data_type: 'bigint', is_nullable: 'NO', column_default: '0' },
    ],
  );

  const privs = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];
  for (const t of TABLES) {
    const got = await q1(
      `select ${privs.map((p) => `has_table_privilege('anon', $1, '${p}') as anon_${p}, has_table_privilege('authenticated', $1, '${p}') as auth_${p}`).join(', ')}`,
      [`public.${t}`],
    );
    const anon = privs.filter((p) => got[`anon_${p}`]);
    const auth = privs.filter((p) => got[`auth_${p}`]);
    same(`grants on ${t}: anon none, authenticated ${t === 'hunt_presence' ? 'none' : 'select only'}`,
      { anon, auth }, { anon: [], auth: t === 'hunt_presence' ? [] : ['select'] });
  }

  same(
    'identity sequences are not granted to anon or authenticated',
    await q(`
      select c.relname
      from pg_class c
      where c.relkind = 'S' and c.relnamespace = 'public'::regnamespace
        and (has_sequence_privilege('anon', c.oid, 'usage') or has_sequence_privilege('authenticated', c.oid, 'usage')
             or has_sequence_privilege('authenticated', c.oid, 'update'))
    `),
    [],
  );

  for (const [name, sig] of RPCS) {
    const row = await q1(
      `select p.prosecdef,
              coalesce(p.proconfig, '{}') as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              (p.proacl is null or exists (
                 select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
              )) as public_exec
       from pg_proc p
       where p.oid = $1::regprocedure`,
      [sig],
    );
    same(`${name}: security definer, search_path public, execute for authenticated only`,
      row, { prosecdef: true, config: ['search_path=public'], anon: false, auth: true, public_exec: false });
  }

  same(
    'private.my_party_id: security definer, execute for authenticated only',
    await q1(`
      select p.prosecdef,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as auth
      from pg_proc p where p.oid = 'private.my_party_id()'::regprocedure
    `),
    { prosecdef: true, anon: false, auth: true },
  );

  same(
    'realtime publishes party_invites, party_members and party_messages',
    (await q(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename`)).map((r) => r.tablename),
    ['party_invites', 'party_members', 'party_messages'],
  );
}

async function executePermissions() {
  for (const [name, , sql] of RPCS) {
    await refuses(`anon cannot execute ${name}`, () => as(ANON, sql), /permission denied for function/);
  }
  await refuses('anon cannot execute private.my_party_id', () => as(ANON, 'select private.my_party_id()'), DENIED);
  for (const [name, , sql] of RPCS) {
    await refuses(`${name} refuses a session with no user`, () => as(SIGNED_OUT, sql), /Not signed in/);
  }
}

async function rowLevelSecurity() {
  await resetParties();
  const P1 = randomUUID();
  const P2 = randomUUID();
  await db.query(`insert into public.parties (id, name, leader_id) values ($1, 'Wardens', $2), ($3, 'Hollow Men', $4)`,
    [P1, U.ash, P2, U.hollow]);
  await db.query(
    `insert into public.party_members (party_id, user_id, username)
     values ($1, $2, 'ash'), ($1, $3, 'bram'), ($4, $5, 'hollow')`,
    [P1, U.ash, U.bram, P2, U.hollow],
  );
  await db.query(
    `insert into public.party_messages (party_id, user_id, username, body, created_at)
     values ($1, $2, 'ash', 'to the wardens', now() - interval '2 minutes'),
            ($1, $3, 'bram', 'aye', now() - interval '1 minute'),
            ($4, $5, 'hollow', 'alone', now())`,
    [P1, U.ash, U.bram, P2, U.hollow],
  );
  const inviteOpen = await qv(
    `insert into public.party_invites (party_id, from_id, from_name, to_id, to_name)
     values ($1, $2, 'ash', $3, 'cinder') returning id`,
    [P1, U.ash, U.cinder],
  );
  const inviteDeclined = await qv(
    `insert into public.party_invites (party_id, from_id, from_name, to_id, to_name, status)
     values ($1, $2, 'hollow', $3, 'dusk', 'declined') returning id`,
    [P2, U.hollow, U.dusk],
  );

  const listing = (seller, name, status, qtyLeft) => qv(
    `insert into public.market_listings
       (seller_id, seller_name, item_key, item_base, item_name, item_kind, item_tier, qty, qty_left, price_each, status, expires_at)
     values ($1, $2, 'slag_ore', 'slag_ore', 'Slag Ore', 'material', 1, 5, $4, 12, $3, now() + interval '2 days')
     returning id`,
    [seller, name, status, qtyLeft],
  );
  const ashOpen = await listing(U.ash, 'ash', 'open', 5);
  const ashCancelled = await listing(U.ash, 'ash', 'cancelled', 5);
  const bramOpen = await listing(U.bram, 'bram', 'open', 5);
  const bramSold = await listing(U.bram, 'bram', 'sold', 0);

  const sale = (listingId, seller, buyer) => qv(
    `insert into public.market_sales (listing_id, seller_id, buyer_id, item_key, item_name, qty, price_each, fee)
     values ($1, $2, $3, 'slag_ore', 'Slag Ore', 1, 12, 1) returning id`,
    [listingId, seller, buyer],
  );
  const saleAshToBram = await sale(ashOpen, U.ash, U.bram);
  const saleBramToCinder = await sale(bramSold, U.bram, U.cinder);

  await db.query(
    `insert into public.mail (user_id, kind, gold, item_key, qty, note, claimed_at)
     values ($1, 'gold', 11, null, 0, 'Sold 1 Slag Ore', null),
            ($1, 'item', 0, 'slag_ore', 2, 'Listing cancelled', now()),
            ($2, 'item', 0, 'slag_ore', 1, 'Bought 1 Slag Ore', null)`,
    [U.ash, U.bram],
  );
  await db.query(
    `insert into public.hunt_presence (user_id, tier, zone, started_at, ends_by)
     values ($1, 2, 'outer', now(), now() + interval '1 hour')`,
    [U.ash],
  );

  const ids = (rows) => rows.map((r) => Object.values(r)[0]);

  // Reads.
  same('saves: a player reads only their own row', ids(await as(U.ash, 'select user_id from public.saves')), [U.ash]);
  same('saves: another player row stays hidden', await as(U.ash, 'select user_id from public.saves where user_id = $1', [U.bram]), []);
  same('profiles: every profile is readable by a signed in player',
    await asValue(U.ash, 'select count(*)::int from public.profiles'), await qv('select count(*)::int from public.profiles'));
  await refuses('hunt_presence: no direct reads', () => as(U.ash, 'select * from public.hunt_presence'), DENIED);

  same('market_listings: open listings plus all of your own',
    ids(await as(U.ash, 'select id from public.market_listings order by id')), [ashOpen, ashCancelled, bramOpen]);
  same('market_listings: other players see only open listings',
    ids(await as(U.cinder, 'select id from public.market_listings order by id')), [ashOpen, bramOpen]);
  same('market_listings: the seller still sees a sold listing',
    ids(await as(U.bram, 'select id from public.market_listings order by id')), [ashOpen, bramOpen, bramSold]);

  same('market_sales: the seller reads the sale', ids(await as(U.ash, 'select id from public.market_sales order by id')), [saleAshToBram]);
  same('market_sales: buyer of one and seller of another reads both',
    ids(await as(U.bram, 'select id from public.market_sales order by id')), [saleAshToBram, saleBramToCinder]);
  same('market_sales: the buyer reads the sale', ids(await as(U.cinder, 'select id from public.market_sales order by id')), [saleBramToCinder]);
  same('market_sales: strangers read nothing', await as(U.dusk, 'select id from public.market_sales'), []);

  same('mail: own mail only, claimed included', await asValue(U.ash, 'select count(*)::int from public.mail'), 2);
  same('mail: another player sees only theirs', ids(await as(U.bram, 'select user_id from public.mail')), [U.bram]);
  same('mail: none for a player with no mail', await as(U.cinder, 'select id from public.mail'), []);

  same('parties: a member reads their party', ids(await as(U.bram, 'select id from public.parties')), [P1]);
  same('parties: another party reads only its own', ids(await as(U.hollow, 'select id from public.parties')), [P2]);
  same('parties: outsiders read none, invitees included', await as(U.cinder, 'select id from public.parties'), []);
  same('parties: a session with no user reads none', await as(SIGNED_OUT, 'select id from public.parties'), []);

  same('party_members: members read their own roster',
    ids(await as(U.bram, 'select username from public.party_members order by username')), ['ash', 'bram']);
  same('party_members: another party roster stays hidden',
    ids(await as(U.hollow, 'select username from public.party_members order by username')), ['hollow']);
  same('party_members: outsiders read none', await as(U.cinder, 'select user_id from public.party_members'), []);

  same('party_messages: members read their party chat',
    ids(await as(U.bram, 'select body from public.party_messages order by created_at')), ['to the wardens', 'aye']);
  same('party_messages: another party chat stays hidden',
    ids(await as(U.hollow, 'select body from public.party_messages order by created_at')), ['alone']);
  same('party_messages: outsiders read none', await as(U.cinder, 'select id from public.party_messages'), []);

  same('party_invites: the sender reads the invite', ids(await as(U.ash, 'select id from public.party_invites')), [inviteOpen]);
  same('party_invites: the recipient reads the invite', ids(await as(U.cinder, 'select id from public.party_invites')), [inviteOpen]);
  same('party_invites: other members of the party do not', await as(U.bram, 'select id from public.party_invites'), []);
  same('party_invites: a recipient still reads a declined invite', ids(await as(U.dusk, 'select id from public.party_invites')), [inviteDeclined]);
  same('party_invites: strangers read none', await as(U.iris, 'select id from public.party_invites'), []);

  for (const t of ['saves', 'profiles', 'market_listings', 'mail', 'parties', 'party_messages']) {
    await refuses(`anon cannot read ${t}`, () => as(ANON, `select * from public.${t}`), DENIED);
  }

  // Writes: players never write tables directly.
  const ghost = randomUUID();
  const writes = [
    ['saves insert', U.ash, `insert into public.saves (user_id, username, data) values ($1, 'ghost', '{}')`, [ghost]],
    ['saves update', U.ash, `update public.saves set data = '{"player": {"gold": 999999}}' where user_id = $1`, [U.ash]],
    ['saves delete', U.ash, 'delete from public.saves where user_id = $1', [U.ash]],
    ['saves truncate', U.ash, 'truncate public.saves', []],
    ['profiles insert', U.ash, `insert into public.profiles (user_id, username) values ($1, 'ghost')`, [ghost]],
    ['profiles update', U.ash, 'update public.profiles set total_level = 9999 where user_id = $1', [U.ash]],
    ['profiles delete', U.ash, 'delete from public.profiles where user_id = $1', [U.ash]],
    ['hunt_presence insert', U.bram, `insert into public.hunt_presence (user_id, tier, zone, started_at, ends_by) values ($1, 9, 'inner', now(), now())`, [U.bram]],
    ['hunt_presence update', U.ash, 'update public.hunt_presence set tier = 9 where user_id = $1', [U.ash]],
    ['market_listings insert', U.ash,
      `insert into public.market_listings (seller_id, seller_name, item_key, item_base, item_name, item_kind, qty, qty_left, price_each, expires_at)
       values ($1, 'ash', 'k', 'k', 'K', 'material', 1, 1, 1, now())`, [U.ash]],
    ['market_listings update', U.ash, 'update public.market_listings set price_each = 1 where seller_id = $1', [U.ash]],
    ['market_listings delete', U.ash, 'delete from public.market_listings where seller_id = $1', [U.ash]],
    ['market_sales insert', U.ash, 'insert into public.market_sales (seller_id, buyer_id, qty) values ($1, $1, 1)', [U.ash]],
    ['mail insert', U.ash, `insert into public.mail (user_id, kind, gold) values ($1, 'gold', 1000000)`, [U.ash]],
    ['mail update', U.ash, 'update public.mail set claimed_at = null where user_id = $1', [U.ash]],
    ['mail delete', U.ash, 'delete from public.mail where user_id = $1', [U.ash]],
    ['parties insert', U.cinder, `insert into public.parties (name, leader_id) values ('Mine', $1)`, [U.cinder]],
    ['parties update', U.bram, 'update public.parties set leader_id = $1', [U.bram]],
    ['parties delete', U.ash, 'delete from public.parties', []],
    ['party_members insert', U.cinder, `insert into public.party_members (party_id, user_id, username) values ($1, $2, 'cinder')`, [P1, U.cinder]],
    ['party_members update', U.bram, `update public.party_members set joined_at = now() - interval '1 year' where user_id = $1`, [U.bram]],
    ['party_members delete', U.ash, 'delete from public.party_members where user_id = $1', [U.bram]],
    ['party_invites insert', U.bram, `insert into public.party_invites (party_id, from_id, to_id) values ($1, $2, $3)`, [P1, U.bram, U.dusk]],
    ['party_invites update', U.cinder, `update public.party_invites set status = 'accepted' where to_id = $1`, [U.cinder]],
    ['party_messages insert', U.ash, `insert into public.party_messages (party_id, user_id, username, body) values ($1, $2, 'ash', 'sneaky')`, [P1, U.ash]],
    ['party_messages delete', U.ash, 'delete from public.party_messages', []],
    ['anon saves insert', ANON, `insert into public.saves (user_id, username, data) values ($1, 'ghost', '{}')`, [ghost]],
    ['anon profiles update', ANON, 'update public.profiles set total_level = 1', []],
  ];
  for (const [label, who, sql, params] of writes) {
    await refuses(`${label} is refused`, () => as(who, sql, params), DENIED);
  }

  same(
    'the refused writes changed nothing',
    await q1(
      `select (select data from public.saves where user_id = $1) as save,
              (select count(*)::int from public.saves where user_id = $2) as ghosts,
              (select total_level from public.profiles where user_id = $1) as total_level,
              (select tier from public.hunt_presence where user_id = $1) as tier,
              (select price_each::int from public.market_listings where id = $3) as price,
              (select count(*)::int from public.mail) as mail,
              (select leader_id from public.parties where id = $4) as leader,
              (select count(*)::int from public.party_members) as members,
              (select count(*)::int from public.party_messages) as messages,
              (select status from public.party_invites where id = $5) as invite`,
      [U.ash, ghost, ashOpen, P1, inviteOpen],
    ),
    { save: { schema: 9, player: { gold: 10 } }, ghosts: 0, total_level: 0, tier: 2, price: 12, mail: 3, leader: U.ash, members: 3, messages: 3, invite: 'pending' },
  );

  await db.exec('delete from public.mail; delete from public.market_sales; delete from public.market_listings;');
}

// The game function writes these tables directly as postgres. The checks beyond the contract
// columns must turn nonsense away rather than store it.
async function serverConstraints() {
  await server();
  const listing = (kind, qty, qtyLeft, price) => q(
    `insert into public.market_listings (seller_id, seller_name, item_key, item_base, item_name, item_kind, qty, qty_left, price_each, expires_at)
     values ($1, 'ash', 'slag_ore', 'slag_ore', 'Slag Ore', $2, $3, $4, $5, now() + interval '1 day')`,
    [U.ash, kind, qty, qtyLeft, price],
  );
  const mail = (kind, gold, itemKey, qty) => q(
    'insert into public.mail (user_id, kind, gold, item_key, qty) values ($1, $2, $3, $4, $5)',
    [U.ash, kind, gold, itemKey, qty],
  );

  await refuses('market_listings rejects an unknown item_kind', () => listing('relic', 1, 1, 10), /market_listings_item_kind_check/);
  await refuses('market_listings rejects qty_left above qty', () => listing('gear', 1, 2, 10), /market_listings_qty_left_within_qty/);
  await refuses('market_listings rejects a price of 0', () => listing('tool', 1, 1, 0), /market_listings_price_each_check/);
  await refuses('mail rejects an unknown kind', () => mail('coins', 5, null, 0), /mail_kind_check/);
  await refuses('mail rejects negative gold', () => mail('gold', -5, null, 0), /mail_gold_check/);
  await refuses('mail rejects an item letter without an item_key', () => mail('item', 0, null, 1), /mail_item_has_key/);
  await refuses('mail rejects an item letter with no quantity', () => mail('item', 0, 'slag_ore', 0), /mail_item_has_key/);

  await listing('material', 3, 0, 1);
  await mail('gold', 0, null, 0);
  await mail('item', 0, 'slag_ore', 2);
  same('valid listings and letters are stored',
    await q1('select (select count(*)::int from public.market_listings) as listings, (select count(*)::int from public.mail) as mail'),
    { listings: 1, mail: 2 });
  await db.exec('delete from public.mail; delete from public.market_listings;');
}

async function presence() {
  await server();
  await db.exec(`update public.profiles set last_seen = null, activity = '{}'`);

  await as(U.ash, 'select public.heartbeat()');
  let row = await q1(`select last_seen > now() - interval '1 minute' as fresh, activity from public.profiles where user_id = $1`, [U.ash]);
  same('heartbeat sets last_seen and leaves activity alone', row, { fresh: true, activity: {} });

  await as(U.ash, 'select public.heartbeat($1::jsonb)', [JSON.stringify({ doing: 'delving', tier: 2 })]);
  same('heartbeat stores activity when given', await qv('select activity from public.profiles where user_id = $1', [U.ash]), { doing: 'delving', tier: 2 });

  await db.query(`update public.profiles set last_seen = now() - interval '1 hour' where user_id = $1`, [U.ash]);
  await as(U.ash, 'select public.heartbeat(null)');
  row = await q1(`select last_seen > now() - interval '1 minute' as fresh, activity from public.profiles where user_id = $1`, [U.ash]);
  same('heartbeat(null) refreshes last_seen and keeps activity', row, { fresh: true, activity: { doing: 'delving', tier: 2 } });

  await as(U.ash, `select public.heartbeat('null'::jsonb)`);
  same('heartbeat with a JSON null keeps activity', await qv('select activity from public.profiles where user_id = $1', [U.ash]), { doing: 'delving', tier: 2 });

  await refuses('heartbeat refuses an activity that is not an object',
    () => as(U.ash, `select public.heartbeat('["delving"]'::jsonb)`), /Activity must be an object/);
  await refuses('heartbeat refuses an oversized activity',
    () => as(U.ash, 'select public.heartbeat($1::jsonb)', [JSON.stringify({ note: 'x'.repeat(3000) })]), /Activity is too large/);

  let quiet = true;
  try {
    await as(U.nobody, `select public.heartbeat('{"doing": "nothing"}'::jsonb)`);
  } catch (e) {
    quiet = e.message;
  }
  same('heartbeat without a profile is not an error', quiet, true);
  same('heartbeat without a profile creates nothing', await qv('select count(*)::int from public.profiles where user_id = $1', [U.nobody]), 0);

  await db.exec('update public.profiles set last_seen = null');
  await db.query('update public.profiles set last_seen = now() where user_id = $1', [U.ash]);
  await db.query(`update public.profiles set last_seen = now() - interval '150 seconds' where user_id = $1`, [U.bram]);
  await db.query(`update public.profiles set last_seen = now() - interval '190 seconds' where user_id = $1`, [U.cinder]);
  await db.query(`update public.profiles set last_seen = now() - interval '1 day' where user_id = $1`, [U.dusk]);
  const online = await asValue(U.ember, 'select public.online_count()');
  same('online_count counts profiles seen in the last 3 minutes', online, 2);
  same('online_count returns an int', typeof online, 'number');

  await as(U.cinder, 'select public.heartbeat()');
  same('a heartbeat brings a player back online', await asValue(U.ember, 'select public.online_count()'), 3);
}

async function hiscores() {
  await server();
  await makeUser('top_a', { total_level: 300, skills: { delving: 1000, warfare: 50.5 }, levels: { delving: 40, warfare: 5 } });
  await makeUser('top_b', { total_level: 300, skills: { delving: 2000, warfare: 10 }, levels: { delving: 51, warfare: 3 } });
  await makeUser('top_c', { total_level: 250, skills: { delving: 5000, felling: 1 }, levels: { delving: 77, felling: 1 } });
  // Bad values must not break a board for everyone else.
  await makeUser('top_d', { total_level: 250, skills: { delving: 'lots', felling: 0 }, levels: { delving: 'high' } });
  await db.exec(`
    insert into public.profiles (user_id, username, total_level)
    select gen_random_uuid(), 'filler_' || lpad(g::text, 3, '0'), 1
    from generate_series(1, 120) g
  `);

  const board = async (sql) => (await as(U.ash, sql)).map((r) => [r.rank, r.username, r.level, Number(r.xp)]);

  let b = await board('select * from public.hiscores()');
  same('hiscores() returns 50 rows by default', b.length, 50);
  same('hiscores total: ranks run 1 to 50', b.map((r) => r[0]), range(1, 50));
  same('hiscores total: total_level desc, then summed xp desc',
    b.slice(0, 5),
    [[1, 'top_b', 300, 2010], [2, 'top_a', 300, 1050.5], [3, 'top_c', 250, 5001], [4, 'top_d', 250, 0], [5, 'filler_001', 1, 0]]);

  same('hiscores total: limit 3', (await board(`select * from public.hiscores('total', 3)`)).map((r) => r[1]), ['top_b', 'top_a', 'top_c']);

  b = await board(`select * from public.hiscores('delving', 10)`);
  same('hiscores skill: xp desc, level from the levels jsonb, only players with xp',
    b, [[1, 'top_c', 77, 5000], [2, 'top_b', 51, 2000], [3, 'top_a', 40, 1000]]);
  same('hiscores skill: fractional xp orders correctly',
    await board(`select * from public.hiscores('warfare')`), [[1, 'top_a', 5, 50.5], [2, 'top_b', 3, 10]]);
  same('hiscores skill: zero xp is left off the board',
    await board(`select * from public.hiscores('felling')`), [[1, 'top_c', 1, 1]]);
  same('hiscores skill: the id is trimmed and lowercased',
    (await board(`select * from public.hiscores(' Delving ')`)).map((r) => r[1]), ['top_c', 'top_b', 'top_a']);
  same('hiscores skill: an unknown skill is an empty board', await board(`select * from public.hiscores('fishing')`), []);
  await refuses('hiscores refuses a malformed skill id',
    () => as(U.ash, `select * from public.hiscores('delving; drop table saves')`), /Unknown skill/);

  same('hiscores clamps a limit of 0 to 1', (await board(`select * from public.hiscores('total', 0)`)).length, 1);
  same('hiscores clamps a negative limit to 1', (await board(`select * from public.hiscores('total', -5)`)).length, 1);
  same('hiscores clamps a limit of 1000 to 100', (await board(`select * from public.hiscores('total', 1000)`)).length, 100);
  same('hiscores clamps a skill board limit too', (await board(`select * from public.hiscores('delving', 0)`)).map((r) => r[1]), ['top_c']);
  same('hiscores(null, null) uses the defaults', (await board('select * from public.hiscores(null, null)')).length, 50);
}

async function partyCreate() {
  await resetParties();
  await refuses('party_create refuses a player with no profile', () => rpc.create(U.nobody, 'Wardens'), /No profile found/);
  await refuses('party_create refuses an empty name', () => rpc.create(U.ash, ''), /1 to 24 characters/);
  await refuses('party_create refuses a blank name', () => rpc.create(U.ash, ' \t\n '), /1 to 24 characters/);
  await refuses('party_create refuses a null name', () => rpc.create(U.ash, null), /1 to 24 characters/);
  await refuses('party_create refuses 25 characters', () => rpc.create(U.ash, 'x'.repeat(25)), /1 to 24 characters/);

  const P1 = await rpc.create(U.ash, '  The Grey Company\n');
  check('party_create returns the party uuid', UUID_RE.test(P1), P1);
  same('party_create trims the name and makes the caller leader',
    await q1('select name, leader_id from public.parties where id = $1', [P1]), { name: 'The Grey Company', leader_id: U.ash });
  same('party_create adds the caller as the only member',
    await q('select user_id, username from public.party_members where party_id = $1', [P1]), [{ user_id: U.ash, username: 'ash' }]);
  await refuses('party_create refuses a player already in a party', () => rpc.create(U.ash, 'Second Company'), /already in a party/);

  const P2 = await rpc.create(U.bram, 'y'.repeat(24));
  same('party_create accepts 24 characters', await qv('select char_length(name) from public.parties where id = $1', [P2]), 24);
  same('refused creates left no parties behind', await qv('select count(*)::int from public.parties'), 2);
}

async function partyInvite() {
  await resetParties();
  const P1 = await rpc.create(U.ash, 'Wardens');
  await rpc.create(U.hollow, 'Hollow Men');

  await refuses('party_invite refuses a player with no party', () => rpc.invite(U.cinder, 'dusk'), /You are not in a party/);

  const toBram = await rpc.invite(U.ash, '  BRAM ');
  check('party_invite returns the invite id', Number.isInteger(toBram) && toBram > 0, toBram);
  same('party_invite matches names case insensitively and records both sides',
    await q1('select party_id, from_id, from_name, to_id, to_name, status from public.party_invites where id = $1', [toBram]),
    { party_id: P1, from_id: U.ash, from_name: 'ash', to_id: U.bram, to_name: 'bram', status: 'pending' });

  await refuses('party_invite refuses an unknown player', () => rpc.invite(U.ash, 'no_such_player'), /No player by that name/);
  await refuses('party_invite refuses a player with no profile', () => rpc.invite(U.ash, 'nobody'), /No player by that name/);
  await refuses('party_invite refuses a blank name', () => rpc.invite(U.ash, '   '), /No player by that name/);
  await refuses('party_invite refuses inviting yourself', () => rpc.invite(U.ash, 'Ash'), /You cannot invite yourself/);
  await refuses('party_invite refuses a player already in a party', () => rpc.invite(U.ash, 'hollow'), /already in a party/);
  await refuses('party_invite refuses a duplicate pending invite', () => rpc.invite(U.ash, 'bram'), /already has an invite/);

  await rpc.respond(U.bram, toBram, true);
  await refuses('party_invite refuses a member who is not the leader', () => rpc.invite(U.bram, 'cinder'), /Only the party leader can invite/);

  await rpc.invite(U.ash, 'cinder');
  const toDusk = await rpc.invite(U.ash, 'dusk');
  await refuses('party_invite caps members plus pending invites at 4', () => rpc.invite(U.ash, 'ember'), /The party is full/);
  same('the refused invite was not stored',
    await qv(`select count(*)::int from public.party_invites where party_id = $1 and status = 'pending'`, [P1]), 2);

  await rpc.respond(U.dusk, toDusk, false);
  const toEmber = await rpc.invite(U.ash, 'ember');
  check('a declined invite frees its seat', Number.isInteger(toEmber), toEmber);
  await refuses('the cap holds again once the seat is retaken', () => rpc.invite(U.ash, 'fen'), /The party is full/);

  const hollowToCinder = await rpc.invite(U.hollow, 'cinder');
  check('another party may invite a player who already holds an invite', Number.isInteger(hollowToCinder), hollowToCinder);

  await refuses('the pending invite index blocks duplicates even from the server',
    () => q(`insert into public.party_invites (party_id, from_id, to_id) values ($1, $2, $3)`, [P1, U.ash, U.cinder]),
    /party_invites_one_pending_idx/);
}

async function partyRespond() {
  await resetParties();
  const P1 = await rpc.create(U.ash, 'Wardens');
  await rpc.create(U.hollow, 'Hollow Men');
  const toBram = await rpc.invite(U.ash, 'bram');
  const toCinder = await rpc.invite(U.ash, 'cinder');
  const hollowToCinder = await rpc.invite(U.hollow, 'cinder');
  const hollowToGale = await rpc.invite(U.hollow, 'gale');

  await refuses('party_respond refuses an invite addressed to someone else', () => rpc.respond(U.ember, toBram, true), /Invite not found/);
  await refuses('party_respond refuses a missing invite', () => rpc.respond(U.bram, 987654321, true), /Invite not found/);
  await refuses('party_respond refuses a null answer', () => rpc.respond(U.bram, toBram, null), /accept or decline/);

  await rpc.respond(U.bram, toBram, false);
  same('decline marks the invite declined', await inviteStatus(toBram), 'declined');
  same('decline does not join the party', await partyOf(U.bram), undefined);
  await refuses('party_respond refuses an invite that is no longer pending', () => rpc.respond(U.bram, toBram, true), /no longer open/);

  await rpc.respond(U.cinder, toCinder, true);
  same('accept adds the member under their profile name',
    await q1('select party_id, username from public.party_members where user_id = $1', [U.cinder]), { party_id: P1, username: 'cinder' });
  same('accept marks the invite accepted', await inviteStatus(toCinder), 'accepted');
  same('accept cancels the other pending invites to that player', await inviteStatus(hollowToCinder), 'cancelled');

  const P3 = await rpc.create(U.gale, 'Gale Company');
  await refuses('party_respond refuses to accept while already in a party', () => rpc.respond(U.gale, hollowToGale, true), /already in a party/);
  same('that refusal leaves the invite pending', await inviteStatus(hollowToGale), 'pending');
  same('that refusal leaves the player in their own party', await partyOf(U.gale), P3);
  await rpc.respond(U.gale, hollowToGale, false);
  same('a player in a party can still decline', await inviteStatus(hollowToGale), 'declined');

  // Invites hold seats, so only the server can overfill a party; the accept check must still hold.
  const toDusk = await rpc.invite(U.ash, 'dusk');
  await db.query(`insert into public.party_members (party_id, user_id, username) values ($1, $2, 'fen'), ($1, $3, 'iris')`, [P1, U.fen, U.iris]);
  await refuses('party_respond refuses to accept into a full party', () => rpc.respond(U.dusk, toDusk, true), /The party is full/);
  same('the full party refusal leaves the invite pending', await inviteStatus(toDusk), 'pending');
  same('the full party still has 4 members', await memberCount(P1), 4);

  await db.query('delete from public.party_members where user_id = $1', [U.fen]);
  await rpc.respond(U.dusk, toDusk, true);
  same('accept succeeds once a seat opens', await partyOf(U.dusk), P1);
}

// Two accepts for different parties can both pass party_respond's membership check before either
// commits; the loser's insert then meets the winner's row in the unique index. PGlite has one
// connection, so a trigger plays the winner, slipping the player into another party just before
// the loser's insert lands.
async function partyRespondRace() {
  await resetParties();
  await rpc.create(U.ash, 'Wardens');
  const other = await rpc.create(U.hollow, 'Hollow Men');
  const toBram = await rpc.invite(U.ash, 'bram');
  await db.exec(`
    create schema if not exists test_race;
    create or replace function test_race.winner() returns trigger language plpgsql as $$
    begin
      if pg_trigger_depth() = 1 then
        insert into public.party_members (party_id, user_id, username) values ('${other}', new.user_id, new.username);
      end if;
      return new;
    end $$;
    create trigger test_race_winner before insert on public.party_members
      for each row execute function test_race.winner();
  `);
  try {
    await refuses('an accept that loses the race says so, not which index refused it',
      () => rpc.respond(U.bram, toBram, true), /^You are already in a party\.$/);
  } finally {
    await db.exec('drop trigger if exists test_race_winner on public.party_members; drop schema if exists test_race cascade;');
  }
  same('the losing accept changes nothing: invite pending, player in no party', [await inviteStatus(toBram), await partyOf(U.bram)], ['pending', undefined]);
  await rpc.respond(U.bram, toBram, true);
  same('with no race the same accept goes through', await partyOf(U.bram), (await q1(`select party_id from public.party_invites where id = $1`, [toBram])).party_id);
}

async function partyCancel() {
  await resetParties();
  await partyWith('ash', 'Wardens', 'bram');
  const toCinder = await rpc.invite(U.ash, 'cinder');

  await refuses('party_cancel_invite refuses a member who is not the leader', () => rpc.cancel(U.bram, toCinder), /Only the party leader can cancel invites/);
  await refuses('party_cancel_invite refuses players outside the party', () => rpc.cancel(U.dusk, toCinder), /Invite not found/);
  await refuses('party_cancel_invite refuses the invitee, who declines instead', () => rpc.cancel(U.cinder, toCinder), /Invite not found/);
  await refuses('party_cancel_invite refuses a missing invite', () => rpc.cancel(U.ash, 987654321), /Invite not found/);
  same('refused cancels leave the invite pending', await inviteStatus(toCinder), 'pending');

  await rpc.cancel(U.ash, toCinder);
  same('party_cancel_invite marks the invite cancelled', await inviteStatus(toCinder), 'cancelled');
  await refuses('party_cancel_invite refuses an invite that is no longer pending', () => rpc.cancel(U.ash, toCinder), /no longer open/);
  await refuses('a cancelled invite cannot be accepted', () => rpc.respond(U.cinder, toCinder, true), /no longer open/);

  const again = await rpc.invite(U.ash, 'cinder');
  check('the player can be invited again after a cancel', Number.isInteger(again) && again !== toCinder, again);
}

async function partyLeave() {
  await resetParties();
  await refuses('party_leave refuses a player with no party', () => rpc.leave(U.dusk), /You are not in a party/);

  const P1 = await partyWith('ash', 'Wardens', 'bram', 'cinder');
  const toDusk = await rpc.invite(U.ash, 'dusk');
  // bram joined first, but cinder is made the oldest remaining member: the handover follows joined_at.
  await db.query(
    `update public.party_members
     set joined_at = now() - case user_id when $1::uuid then interval '3 hours' when $2::uuid then interval '2 hours' else interval '1 hour' end
     where party_id = $3`,
    [U.ash, U.cinder, P1],
  );

  await rpc.leave(U.ash);
  same('the leader leaving removes them', await partyOf(U.ash), undefined);
  same('leadership passes to the oldest remaining member', await qv('select leader_id from public.parties where id = $1', [P1]), U.cinder);
  await rpc.cancel(U.cinder, toDusk);
  same('the new leader can cancel an invite the old leader sent', await inviteStatus(toDusk), 'cancelled');

  await rpc.leave(U.bram);
  same('a member leaving keeps the leader', await qv('select leader_id from public.parties where id = $1', [P1]), U.cinder);
  same('only the leader remains', await q('select user_id from public.party_members where party_id = $1', [P1]), [{ user_id: U.cinder }]);

  await rpc.invite(U.cinder, 'ember');
  await rpc.say(U.cinder, 'last watch');
  await rpc.leave(U.cinder);
  same('the last member leaving deletes the party', await qv('select count(*)::int from public.parties where id = $1', [P1]), 0);
  same('its members, invites and messages go with it',
    await q1(
      `select (select count(*)::int from public.party_members where party_id = $1) as members,
              (select count(*)::int from public.party_invites where party_id = $1) as invites,
              (select count(*)::int from public.party_messages where party_id = $1) as messages`,
      [P1],
    ),
    { members: 0, invites: 0, messages: 0 });
  await refuses('party_leave refuses a second leave', () => rpc.leave(U.cinder), /You are not in a party/);

  const fresh = await rpc.create(U.ash, 'Wardens Again');
  check('a player who left can start a new party', UUID_RE.test(fresh), fresh);
}

async function partyKick() {
  await resetParties();
  const P1 = await partyWith('ash', 'Wardens', 'bram', 'cinder');
  await rpc.create(U.hollow, 'Hollow Men');

  await refuses('party_kick refuses a member who is not the leader', () => rpc.kick(U.bram, U.cinder), /Only the party leader can kick/);
  await refuses('party_kick refuses kicking yourself', () => rpc.kick(U.ash, U.ash), /You cannot kick yourself/);
  await refuses('party_kick refuses a player outside the party', () => rpc.kick(U.ash, U.dusk), /not in your party/);
  await refuses('party_kick refuses another party leader', () => rpc.kick(U.hollow, U.bram), /not in your party/);
  await refuses('party_kick refuses a caller with no party', () => rpc.kick(U.dusk, U.bram), /You are not in a party/);
  await refuses('party_kick refuses a null target', () => rpc.kick(U.ash, null), /not in your party/);
  same('refused kicks removed nobody', await memberCount(P1), 3);

  await rpc.kick(U.ash, U.cinder);
  same('party_kick removes the member',
    (await q('select username from public.party_members where party_id = $1 order by username', [P1])).map((r) => r.username), ['ash', 'bram']);
  same('party_kick leaves the leader in charge', await qv('select leader_id from public.parties where id = $1', [P1]), U.ash);
}

async function partySay() {
  await resetParties();
  await refuses('party_say refuses a player with no party', () => rpc.say(U.dusk, 'hello'), /You are not in a party/);

  const P1 = await partyWith('ash', 'Wardens', 'bram');
  const P2 = await rpc.create(U.hollow, 'Hollow Men');

  await refuses('party_say refuses an empty message', () => rpc.say(U.ash, ''), /Message is empty/);
  await refuses('party_say refuses whitespace only', () => rpc.say(U.ash, ' \n\t  '), /Message is empty/);
  await refuses('party_say refuses null', () => rpc.say(U.ash, null), /Message is empty/);
  await refuses('party_say refuses 241 characters', () => rpc.say(U.ash, 'x'.repeat(241)), /240 characters/);
  same('refused messages stored nothing', await messageCount(P1), 0);

  const first = await rpc.say(U.ash, '  the gate holds  \n');
  same('party_say trims and stores the message',
    await q1('select party_id, user_id, username, body from public.party_messages where id = $1', [first]),
    { party_id: P1, user_id: U.ash, username: 'ash', body: 'the gate holds' });

  await refuses('party_say refuses a second message inside 1.5 seconds', () => rpc.say(U.ash, 'again'), /too quickly/);
  const bramLine = await rpc.say(U.bram, 'aye');
  check('the rate limit is per player', Number.isInteger(bramLine), bramLine);

  const backdate = (userId) => db.query(`update public.party_messages set created_at = created_at - interval '2 seconds' where user_id = $1`, [userId]);
  await backdate(U.ash);
  const longest = await rpc.say(U.ash, `  ${'y'.repeat(240)}  `);
  same('after the cooldown, 240 characters (once trimmed) are allowed',
    await qv('select char_length(body) from public.party_messages where id = $1', [longest]), 240);

  await rpc.say(U.hollow, 'elsewhere');

  await db.query(
    `insert into public.party_messages (party_id, user_id, username, body, created_at)
     select $1, $2, 'bram', 'old ' || g, now() - interval '1 hour' + g * interval '1 second'
     from generate_series(1, 205) g`,
    [P1, U.bram],
  );
  await backdate(U.ash);
  same('before the prune the party holds 208 messages', await messageCount(P1), 208);

  const newest = await rpc.say(U.ash, 'prune');
  same('party_say keeps only the newest 200 messages', await messageCount(P1), 200);
  same('the oldest messages are the ones removed',
    await qv(`select min(substring(body from 5)::int) from public.party_messages where party_id = $1 and body like 'old %'`, [P1]), 10);
  same('the newest messages survive the prune',
    await qv('select count(*)::int from public.party_messages where id in ($1, $2, $3, $4)', [first, bramLine, longest, newest]), 4);
  same('the prune leaves other parties alone', await messageCount(P2), 1);
}

async function partyState() {
  await resetParties();
  const nothing = { party: null, members: [], invites_in: [], invites_out: [], messages: [] };
  same('party_state for a player with nothing', await rpc.state(U.jet), nothing);

  const P1 = await partyWith('ash', 'Wardens', 'bram');
  const toCinder = await rpc.invite(U.ash, 'cinder');
  await db.query(
    `update public.party_members
     set joined_at = now() - case when user_id = $1::uuid then interval '2 hours' else interval '1 hour' end
     where party_id = $2`,
    [U.ash, P1],
  );
  await db.query(
    `insert into public.hunt_presence (user_id, tier, zone, started_at, ends_by)
     values ($1, 3, 'outer', now() - interval '10 minutes', now() + interval '2 hours')`,
    [U.ash],
  );
  await db.query(`update public.profiles set total_level = 42, levels = '{"delving": 12}' where user_id = $1`, [U.ash]);
  await as(U.bram, 'select public.heartbeat($1::jsonb)', [JSON.stringify({ doing: 'felling' })]);
  await db.query(
    `insert into public.party_messages (party_id, user_id, username, body, created_at)
     select $1,
            case when g % 2 = 0 then $2::uuid else $3::uuid end,
            case when g % 2 = 0 then 'ash' else 'bram' end,
            'msg ' || g,
            now() - interval '1 hour' + g * interval '1 second'
     from generate_series(1, 60) g`,
    [P1, U.ash, U.bram],
  );

  let st = await rpc.state(U.ash);
  same('party_state member: top level keys', Object.keys(st).sort(), ['invites_in', 'invites_out', 'members', 'messages', 'party']);
  same('party_state member: party', st.party, { id: P1, name: 'Wardens', leader_id: U.ash, slots: 4, proposed: null });
  same('party_state member: members, oldest first', st.members.map((m) => m.user_id), [U.ash, U.bram]);
  same('party_state member: member keys', st.members.map((m) => Object.keys(m).sort()),
    Array(2).fill(['activity', 'hunt', 'joined_at', 'last_seen', 'levels', 'ready', 'skin', 'total_level', 'user_id', 'username']));
  same('party_state member: profile fields',
    [st.members[0].username, st.members[0].total_level, st.members[0].levels, st.members[1].activity, st.members[1].last_seen !== null],
    ['ash', 42, { delving: 12 }, { doing: 'felling' }, true]);
  same('party_state member: hunt shape',
    { keys: Object.keys(st.members[0].hunt).sort(), tier: st.members[0].hunt.tier, zone: st.members[0].hunt.zone, ended_at: st.members[0].hunt.ended_at },
    { keys: ['ended_at', 'ends_by', 'started_at', 'tier', 'zone'], tier: 3, zone: 'outer', ended_at: null });
  same('party_state member: no hunt is null', st.members[1].hunt, null);
  check('party_state member: timestamps are ISO strings',
    [st.members[0].joined_at, st.members[0].hunt.started_at, st.members[0].hunt.ends_by, st.messages[0]?.created_at]
      .every((t) => typeof t === 'string' && !Number.isNaN(Date.parse(t))), st.members[0]);
  same('party_state member: invites_out', st.invites_out.map((i) => ({ keys: Object.keys(i).sort(), id: i.id, to_name: i.to_name })),
    [{ keys: ['created_at', 'id', 'to_name'], id: toCinder, to_name: 'cinder' }]);
  same('party_state member: invites_in is empty', st.invites_in, []);
  same('party_state member: the newest 50 messages, oldest first', st.messages.map((m) => m.body), range(11, 60).map((g) => `msg ${g}`));
  same('party_state member: message shape', [Object.keys(st.messages[49]).sort(), st.messages[49].user_id, st.messages[49].username],
    [['body', 'created_at', 'id', 'user_id', 'username'], U.ash, 'ash']);

  st = await rpc.state(U.bram);
  same('party_state: every member sees the party pending invites', st.invites_out.map((i) => i.to_name), ['cinder']);

  st = await rpc.state(U.cinder);
  same('party_state invitee: no party, members, outgoing invites or messages',
    { party: st.party, members: st.members, invites_out: st.invites_out, messages: st.messages },
    { party: null, members: [], invites_out: [], messages: [] });
  same('party_state invitee: invites_in',
    st.invites_in.map((i) => ({ keys: Object.keys(i).sort(), id: i.id, party_id: i.party_id, party_name: i.party_name, from_name: i.from_name })),
    [{ keys: ['created_at', 'from_name', 'id', 'party_id', 'party_name'], id: toCinder, party_id: P1, party_name: 'Wardens', from_name: 'ash' }]);

  await rpc.kick(U.ash, U.bram);
  same('party_state after a kick shows nothing of the old party', await rpc.state(U.bram), nothing);
  same('a kicked player can no longer read the party chat', await as(U.bram, 'select id from public.party_messages'), []);
}

/* The room: squares the leader opens and closes, a ground anyone can put up,
   and a ready mark each that a new ground clears. */
async function partyRoom() {
  await resetParties();
  const P1 = await partyWith('ash', 'Wardens', 'bram');
  const slotsOf = () => qv('select slots from public.parties where id = $1', [P1]);
  const readyOf = (u) => qv('select ready from public.party_members where user_id = $1', [u]);
  const upOf = () => q1('select proposed_tier, proposed_zone from public.parties where id = $1', [P1]);

  same('a new party opens every square', await slotsOf(), 4);
  await refuses('party_set_slots refuses a member who is not the leader', () => rpc.slots(U.bram, 3), /Only the party leader/);
  await refuses('party_set_slots refuses closing a square somebody sits in', () => rpc.slots(U.ash, 1), /sitting in that square/);
  await refuses('party_set_slots refuses more than the room holds', () => rpc.slots(U.ash, 5), /holds four/);
  await refuses('party_set_slots refuses a caller with no party', () => rpc.slots(U.dusk, 3), /You are not in a party/);
  same('refused presses left the room as it was', await slotsOf(), 4);

  same('party_set_slots closes a square', await rpc.slots(U.ash, 3), 3);
  same('and the room keeps it', await slotsOf(), 3);
  same('party_set_slots opens one again', await rpc.slots(U.ash, 4), 4);

  await refuses('party_ready refuses a mark with no ground up', () => rpc.ready(U.bram, true), /put a ground up/);
  await refuses('party_propose refuses a ground nobody has', () => rpc.propose(U.ash, 3, 'nowhere'), /No such ground/);
  await refuses('party_propose refuses a region nobody has', () => rpc.propose(U.ash, 99, 'outer'), /No such region/);
  await refuses('party_propose refuses a caller with no party', () => rpc.propose(U.dusk, 3, 'outer'), /You are not in a party/);
  same('refused proposals put nothing up', await upOf(), { proposed_tier: null, proposed_zone: null });

  same('party_propose puts a ground up', await rpc.propose(U.bram, 3, 'Inner'), { tier: 3, zone: 'inner', moved: true });
  same('and any member may be the one to do it', await upOf(), { proposed_tier: 3, proposed_zone: 'inner' });

  same('party_ready marks you', await rpc.ready(U.bram, true), true);
  same('the mark is kept', await readyOf(U.bram), true);
  same('and it is yours alone', await readyOf(U.ash), false);
  same('party_ready stands you down again', await rpc.ready(U.bram, false), false);

  await rpc.ready(U.ash, true);
  await rpc.ready(U.bram, true);

  /* Agreeing with the ground already up is not changing it. Clearing the marks
     for a repeat press turned a second voice for the same plan into a reason to
     start the whole room over. */
  same('putting up the ground already up says so', await rpc.propose(U.ash, 3, 'inner'), { tier: 3, zone: 'inner', moved: false });
  same('and it leaves every mark where it was', [await readyOf(U.ash), await readyOf(U.bram)], [true, true]);
  same('the same ground in different letters is still the same ground',
    await rpc.propose(U.bram, 3, 'INNER'), { tier: 3, zone: 'inner', moved: false });
  same('so those marks stand too', [await readyOf(U.ash), await readyOf(U.bram)], [true, true]);

  same('a different ground is a change', await rpc.propose(U.ash, 3, 'core'), { tier: 3, zone: 'core', moved: true });
  same('a new ground stands the whole room down', [await readyOf(U.ash), await readyOf(U.bram)], [false, false]);
  same('and the new ground is what is up', await upOf(), { proposed_tier: 3, proposed_zone: 'core' });
}

async function rerun(schemaSql) {
  await server();
  const counts = () => q1(`select ${TABLES.map((t) => `(select count(*)::int from public.${t}) as ${t}`).join(', ')}`);
  const before = await counts();
  try {
    await db.exec(schemaSql);
    check('schema.sql runs again over live data', true);
  } catch (e) {
    check('schema.sql runs again over live data', false, e.message);
    return;
  }
  same('re-running keeps every row', await counts(), before);
  await checkPolicies('after a re-run');
  same('RLS still applies after a re-run', (await as(U.ash, 'select user_id from public.saves')).map((r) => r.user_id), [U.ash]);

  await db.exec('drop publication supabase_realtime');
  try {
    await db.exec(schemaSql);
    check('schema.sql runs where the realtime publication is missing', true);
  } catch (e) {
    check('schema.sql runs where the realtime publication is missing', false, e.message);
  }
  await db.exec('create publication supabase_realtime');
  await db.exec(schemaSql);
  same('a later run publishes the party tables once the publication exists',
    (await q(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename`)).map((r) => r.tablename),
    ['party_invites', 'party_members', 'party_messages']);
}

/* ================= 6. MAIN ================= */

async function main() {
  const PGlite = await loadPGlite();
  const stubsSql = await readFile(join(HERE, 'stubs.sql'), 'utf8');
  const schemaSql = await readFile(join(REPO, 'supabase', 'schema.sql'), 'utf8');

  db = new PGlite();
  await db.waitReady;

  console.log('# setup');
  for (const [label, sql] of [['stubs.sql loads', stubsSql], ['schema.sql runs', schemaSql], ['schema.sql runs a second time', schemaSql]]) {
    try {
      await db.exec(sql);
      check(label, true);
    } catch (e) {
      check(label, false, e.message);
      return;
    }
  }

  for (const name of ['ash', 'bram', 'cinder', 'dusk', 'ember', 'fen', 'gale', 'hollow', 'iris', 'jet']) {
    U[name] = await makeUser(name);
  }
  U.nobody = await makeUser('nobody', { profile: false });

  await section('schema shape', schemaShape);
  await section('execute permissions', executePermissions);
  await section('row level security', rowLevelSecurity);
  await section('server write constraints', serverConstraints);
  await section('heartbeat and online_count', presence);
  await section('hiscores', hiscores);
  await section('party_create', partyCreate);
  await section('party_invite', partyInvite);
  await section('party_respond', partyRespond);
  await section('party_respond racing another accept', partyRespondRace);
  await section('party_cancel_invite', partyCancel);
  await section('party_leave', partyLeave);
  await section('party_kick', partyKick);
  await section('party_say', partySay);
  await section('party_state', partyState);
  await section('the party room', partyRoom);
  await section('re-running the schema', () => rerun(schemaSql));
}

try {
  await main();
} catch (e) {
  check('suite ran to the end', false, e.stack || e.message);
} finally {
  await db?.close().catch(() => {});
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 || passed === 0 ? 1 : 0);
