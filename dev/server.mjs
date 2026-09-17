/* ============================================================
   Respite · dev/server.mjs · The Stage
   ------------------------------------------------------------
   The whole online game on one machine. The repo's static files,
   the real game handler on PGlite (tests/sql/stubs.sql standing
   in for Supabase, then supabase/schema.sql and the migrations),
   and the few endpoints dev/fake-supabase.js needs to play the
   parts of Auth, PostgREST and Realtime.

     node dev/server.mjs [--port N] [--quiet] [--allow-sql]

   Or in-process (the e2e tests):
     const stage = await startDevServer({ port: 0, allowSql: true });
     stage.url, stage.clock.offset, stage.errors, await stage.close()

   Everything lives in memory: a restart forgets every account,
   save and token. tests/e2e/README.md lists the endpoints and
   where the stage differs from a real Supabase project.
   ============================================================ */

import http from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createGameHandler, MAX_BODY } from "../src/server/handler.js";
import { pgliteAdapter } from "../src/server/db.js";
import { ENGINE_VERSION } from "../src/shared/version.js";

/* ================= 1. PATHS AND LIMITS ================= */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
// After node_modules and PGLITE_PATH, a tools folder beside the repo (how the build workspace kept it).
const DEFAULT_PGLITE = resolve(REPO, "..", "tools", "node_modules", "@electric-sql", "pglite");

const API_BODY = 1024 * 1024;               // dev endpoints; the game keeps the wrapper's own limit
const MAX_ROWS = 1000;                      // Supabase's default db max rows
// Supabase's session length. Only the numbers: the stage honours a token until sign out, and a
// ten-year expires_in would overflow any client timer built from it.
const SESSION_S = 3600;

// PostgREST reads these; the browser never gets the rest (hunt_presence goes through party_state).
export const QUERY_TABLES = Object.freeze([
  "market_listings", "market_sales", "profiles", "parties", "party_members",
  "party_invites", "party_messages", "mail", "saves",
]);
const OPS = Object.freeze({ eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" });
const LIST_OPS = new Set([...Object.keys(OPS), "ilike", "in"]);
const IDENT = /^[a-z_][a-z0-9_]*$/;

// The Deno wrapper's CORS, word for word.
const CORS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const API_CORS = Object.freeze({ ...CORS, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });

const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
});

/* ================= 2. THE DATABASE ================= */

async function loadPGlite() {
  try {
    return (await import("@electric-sql/pglite")).PGlite;
  } catch (e) {
    if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
    const dir = process.env.PGLITE_PATH || DEFAULT_PGLITE;
    return (await import(pathToFileURL(join(dir, "dist", "index.js")).href)).PGlite;
  }
}

// What tests/server/run.mjs loads, in the same order. The SQL text comes back so the RPC list
// includes functions a later migration adds.
async function bootDatabase() {
  const PGlite = await loadPGlite();
  const pg = new PGlite();
  await pg.exec(await readFile(join(REPO, "tests", "sql", "stubs.sql"), "utf8"));
  const texts = [await readFile(join(REPO, "supabase", "schema.sql"), "utf8")];
  await pg.exec(texts[0]);
  const migrations = join(REPO, "supabase", "migrations");
  const files = (await readdir(migrations).catch(() => [])).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    texts.push(await readFile(join(migrations, f), "utf8"));
    await pg.exec(texts[texts.length - 1]);
  }
  return { pg, schema: texts.join("\n") };
}

// Realtime streams the tables in the supabase_realtime publication, so pokes follow that list.
// A row trigger notifies on commit (Postgres folds repeats within one transaction), which means a
// rolled back RPC pokes nobody, the same as a real replication slot.
async function installRealtime(pg) {
  const published = (await pg.query(
    `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename`,
  )).rows.map((r) => r.tablename);
  // A PGlite build without publications still gets the party tables schema.sql asks for.
  const tables = published.length ? published : ["party_invites", "party_members", "party_messages"];
  await pg.exec(`
    create schema if not exists dev_realtime;
    revoke all on schema dev_realtime from public;
    create or replace function dev_realtime.poke()
    returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog
    as $$
    begin
      perform pg_notify('dev_realtime', tg_table_name);
      return null;
    end;
    $$;
  `);
  for (const t of tables) {
    if (!IDENT.test(t)) continue;
    await pg.exec(`
      drop trigger if exists zz_dev_realtime on public."${t}";
      create trigger zz_dev_realtime after insert or update or delete on public."${t}"
        for each row execute function dev_realtime.poke();
    `);
  }
  return tables;
}

// The RPC names are whatever schema.sql defines in public; their signatures come from the catalog.
async function loadFunctions(pg, schema) {
  const names = [...new Set([...schema.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_][a-z0-9_]*)\s*\(/gi)].map((m) => m[1].toLowerCase()))];
  const rows = (await pg.query(
    `select p.proname as name,
            p.proretset as retset,
            p.prorettype = 'void'::regtype as void,
            p.pronargdefaults as ndefaults,
            (select coalesce(json_agg(json_build_object('name', a.name, 'type', format_type(a.type, null)) order by a.ord), '[]'::json)
             from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]),
                         coalesce(p.proargnames, array_fill(''::text, array[p.pronargs])),
                         coalesce(p.proargmodes, array_fill('i'::"char", array[p.pronargs])))
                  with ordinality as a(type, name, mode, ord)
             where a.mode in ('i', 'b', 'v')) as args
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any($1::text[])
     order by p.proname, p.oid`,
    [names],
  )).rows;
  const fns = new Map();
  for (const r of rows) {
    if (!fns.has(r.name)) fns.set(r.name, []);
    fns.get(r.name).push({ name: r.name, retset: r.retset, void: r.void, ndefaults: Number(r.ndefaults), args: r.args });
  }
  return fns;
}

async function loadColumns(pg) {
  const rows = (await pg.query(
    `select c.relname as table_name, a.attname as column_name, format_type(a.atttypid, a.atttypmod) as type
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = any($1::text[]) and a.attnum > 0 and not a.attisdropped
     order by c.relname, a.attnum`,
    [QUERY_TABLES],
  )).rows;
  const tables = new Map();
  for (const r of rows) {
    if (!tables.has(r.table_name)) tables.set(r.table_name, new Map());
    tables.get(r.table_name).set(r.column_name, r.type);
  }
  return tables;
}

/* ================= 3. PLUMBING ================= */

// An error the API answers with, shaped like PostgREST's and GoTrue's.
class ApiError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

// PGlite hands back bigint for large int8, Date for timestamps and bytes for bytea.
function jsonSafe(_key, value) {
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (value instanceof Uint8Array) return `\\x${Buffer.from(value).toString("hex")}`;
  return value;
}

function send(res, status, headers, body) {
  res.writeHead(status, { "cache-control": "no-store", ...headers });
  res.end(body);
}

function sendJson(res, status, payload, headers = API_CORS) {
  send(res, status, { "content-type": "application/json; charset=utf-8", ...headers }, JSON.stringify(payload, jsonSafe));
}

function readText(req, limit) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(new ApiError(413, "Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

async function readJson(req) {
  const text = await readText(req, API_BODY);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "The body is not JSON.");
  }
}

function bearerOf(value) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(typeof value === "string" ? value : "");
  return m ? m[1] : null;
}

// Postgres errors carry a SQLSTATE; anything else is the stage's own bug.
const isPgError = (err) => !!err && typeof err.code === "string" && /^[0-9A-Z]{5}$/.test(err.code) && "severity" in err;

function pgErrorBody(err) {
  return { message: err.message, code: err.code, details: err.detail ?? null, hint: err.hint ?? null };
}

// Roughly how PostgREST maps SQLSTATEs to HTTP statuses.
function pgStatus(err, user) {
  const code = err.code || "";
  if (code === "42501") return user ? 403 : 401;
  if (code === "42883" || code === "42P01") return 404;
  if (code.startsWith("23")) return 409;
  if (code === "P0001" || code.startsWith("22") || code.startsWith("42")) return 400;
  return 500;
}

/* ================= 4. THE STAGE ================= */

/**
 * @param {{ port?: number, host?: string, allowSql?: boolean, quiet?: boolean }} [options]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void>, db: any, clock: { offset: number, now: () => number }, errors: string[] }>}
 */
export async function startDevServer({ port = 0, host = "127.0.0.1", allowSql = false, quiet = true } = {}) {
  const { pg, schema } = await bootDatabase();
  const realtimeTables = await installRealtime(pg);
  const functions = await loadFunctions(pg, schema);
  const columns = await loadColumns(pg);

  const clock = {
    offset: 0,
    now() {
      return Date.now() + clock.offset;
    },
  };
  const errors = [];
  const say = (...args) => {
    if (!quiet) console.log(...args);
  };
  const logError = (...args) => {
    const line = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "string" ? a : JSON.stringify(a, jsonSafe))).join(" ");
    errors.push(line);
    if (!quiet) console.error(line);
  };

  /* ---------- realtime ---------- */

  // One id for the whole stage; each table remembers the id of its latest change.
  const changes = { id: 0, tables: new Map() };
  await pg.listen("dev_realtime", (table) => {
    changes.id += 1;
    changes.tables.set(String(table), changes.id);
  });

  /* ---------- accounts ---------- */

  const users = new Map();    // lowercased email -> user
  const tokens = new Map();   // access token -> user

  const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
  const hashPassword = (salt, password) => createHash("sha256").update(`${salt}:${password}`).digest();

  function publicUser(user) {
    return {
      id: user.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      created_at: user.createdAt,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
    };
  }

  // JWT shaped, so client code that peeks at the payload finds sub and email; the signature is
  // random bytes and the token table is the only thing that honours it.
  function openSession(user) {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + SESSION_S;
    const payload = { sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat, exp, session_id: randomUUID() };
    const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.${randomBytes(32).toString("base64url")}`;
    tokens.set(token, user);
    const session = {
      access_token: token,
      token_type: "bearer",
      expires_in: SESSION_S,
      expires_at: exp,
      refresh_token: randomBytes(16).toString("hex"),
      user: publicUser(user),
    };
    return { session, user: session.user };
  }

  // GoTrue's wording, so the account popup shows what production would.
  async function signUp(body) {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = body.password;
    if (!email) throw new ApiError(400, "Anonymous sign-ins are disabled", "anonymous_provider_disabled");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Unable to validate email address: invalid format", "validation_failed");
    if (typeof password !== "string" || password === "") throw new ApiError(400, "Signup requires a valid password", "validation_failed");
    if (password.length < 6) throw new ApiError(422, "Password should be at least 6 characters.", "weak_password");
    if (users.has(email)) throw new ApiError(422, "User already registered", "user_already_exists");
    const salt = randomBytes(12).toString("hex");
    const user = { id: randomUUID(), email, salt, hash: hashPassword(salt, password), createdAt: new Date().toISOString() };
    users.set(email, user);
    await pg.query("insert into auth.users (id, email) values ($1::uuid, $2)", [user.id, email]);
    return openSession(user);
  }

  function signIn(body) {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const user = users.get(email);
    const ok = user && typeof body.password === "string" && timingSafeEqual(user.hash, hashPassword(user.salt, body.password));
    if (!ok) throw new ApiError(400, "Invalid login credentials", "invalid_credentials");
    return openSession(user);
  }

  // Unknown tokens are not a guest: PostgREST refuses a JWT it cannot verify.
  function callerOf(req) {
    const token = bearerOf(req.headers.authorization);
    if (!token) return null;
    const user = tokens.get(token);
    if (!user) throw new ApiError(401, "JWT could not be verified. Sign in again.", "PGRST301");
    return user;
  }

  // What PostgREST does before running a request: the role, and the claims auth.uid() reads
  // (stubs.sql reads request.jwt.claim.sub; current Supabase reads request.jwt.claims).
  async function actAs(tx, user) {
    const role = user ? "authenticated" : "anon";
    await tx.query(`set local role ${role}`);
    const claims = user ? { sub: user.id, email: user.email, role, aud: "authenticated" } : { role };
    await tx.query(
      `select set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claim.role', $2, true),
              set_config('request.jwt.claims', $3, true)`,
      [user ? user.id : "", role, JSON.stringify(claims)],
    );
  }

  /* ---------- the game function ---------- */

  const handle = createGameHandler({
    db: pgliteAdapter(pg),
    getUser: async (authorization) => {
      const user = tokens.get(bearerOf(authorization));
      return user ? { id: user.id, email: user.email } : null;
    },
    now: () => clock.now(),
    log: logError,
  });

  async function game(req, res) {
    // The wrapper refuses an oversized body before reading it.
    const length = Number(req.headers["content-length"] ?? 0);
    if (length > MAX_BODY * 4) return sendJson(res, 400, { ok: false, error: "bad_request" }, CORS);
    let bodyText = "";
    if (req.method === "POST") {
      try {
        bodyText = await readText(req, MAX_BODY * 4);
      } catch {
        return sendJson(res, 400, { ok: false, error: "bad_request" }, CORS);
      }
    }
    const out = await handle({ method: req.method, headers: req.headers, bodyText });
    return send(res, out.status, { ...out.headers, ...CORS }, out.body);
  }

  /* ---------- RPC ---------- */

  // PostgREST picks the overload whose argument names fit the body.
  function pickFunction(fn, args) {
    const keys = Object.keys(args);
    const candidates = functions.get(fn) || [];
    const fits = candidates.find((f) => {
      const names = f.args.map((a) => a.name);
      const required = names.slice(0, names.length - f.ndefaults);
      return keys.every((k) => names.includes(k)) && required.every((n) => keys.includes(n));
    });
    if (!fits) {
      const shown = keys.length ? `(${keys.join(", ")})` : " without parameters";
      throw new ApiError(404, `Could not find the function public.${fn}${shown} in the schema cache`, "PGRST202");
    }
    return fits;
  }

  // Arguments travel as one JSON object and are cast by jsonb_to_record, the way PostgREST
  // turns a JSON body into typed parameters.
  function rpcSql(f, args) {
    const given = f.args.filter((a) => Object.hasOwn(args, a.name));
    const call = `public.${quoteIdent(f.name)}(${given.map((a) => `${quoteIdent(a.name)} => _.${quoteIdent(a.name)}`).join(", ")})`;
    const from = given.length
      ? ` from jsonb_to_record($1::text::jsonb) as _(${given.map((a) => `${quoteIdent(a.name)} ${a.type}`).join(", ")})`
      : "";
    if (f.retset) {
      return given.length
        ? `select coalesce(json_agg(r), '[]'::json) as v${from}, lateral ${call} r`
        : `select coalesce(json_agg(r), '[]'::json) as v from ${call} r`;
    }
    if (f.void) return `select ${call} as v${from}`;
    return `select to_json(${call}) as v${from}`;
  }

  async function rpc(req, res) {
    const body = await readJson(req);
    const fn = typeof body.fn === "string" ? body.fn : "";
    const args = body.args === undefined || body.args === null ? {} : body.args;
    if (!isObject(args)) throw new ApiError(400, "RPC arguments must be an object.", "PGRST102");
    if (!functions.has(fn)) throw new ApiError(404, `Could not find the function public.${fn} in the schema cache`, "PGRST202");
    const user = callerOf(req);
    const f = pickFunction(fn, args);
    const sql = rpcSql(f, args);
    const params = sql.includes("$1") ? [JSON.stringify(args)] : [];
    try {
      const rows = await pg.transaction(async (tx) => {
        await actAs(tx, user);
        return (await tx.query(sql, params)).rows;
      });
      const data = f.void ? null : rows.length ? rows[0].v : null;
      return sendJson(res, 200, { data: data === undefined ? null : data, error: null, status: f.void ? 204 : 200 });
    } catch (err) {
      if (!isPgError(err)) throw err;
      return sendJson(res, 200, { data: null, error: pgErrorBody(err), status: pgStatus(err, user) });
    }
  }

  /* ---------- queries ---------- */

  function columnOf(table, cols, name) {
    if (typeof name !== "string" || !IDENT.test(name) || !cols.has(name)) {
      throw new ApiError(400, `column ${table}.${name} does not exist`, "42703");
    }
    return quoteIdent(name);
  }

  // Filter values arrive as JSON and are compared as PostgREST compares URL text: cast from text
  // to the column's type.
  const textOf = (v) => (v === null || v === undefined ? null : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));

  function querySql(spec) {
    const table = spec.table;
    if (typeof table !== "string" || !QUERY_TABLES.includes(table)) {
      throw new ApiError(404, `Could not find the table 'public.${table}' in the schema cache`, "PGRST205");
    }
    const cols = columns.get(table);

    const wanted = String(spec.select ?? "*").split(",").map((c) => c.trim()).filter(Boolean);
    if (!wanted.length) wanted.push("*");
    const list = wanted.map((c) => {
      if (c === "*") return "*";
      if (!IDENT.test(c)) throw new ApiError(400, `The stage reads plain columns only, not "${c}".`, "PGRST100");
      return columnOf(table, cols, c);
    });

    const params = [];
    const where = [];
    const filters = spec.filters ?? [];
    if (!Array.isArray(filters)) throw new ApiError(400, "Filters are a list of [op, column, value].", "PGRST100");
    for (const f of filters) {
      if (!Array.isArray(f) || f.length !== 3 || !LIST_OPS.has(f[0])) {
        throw new ApiError(400, `Unknown filter ${JSON.stringify(f)}. The stage knows ${[...LIST_OPS].join(", ")}.`, "PGRST100");
      }
      const [op, name, value] = f;
      const col = columnOf(table, cols, name);
      const type = cols.get(name);
      if (op === "in") {
        if (!Array.isArray(value)) throw new ApiError(400, `"in" on ${name} needs a list of values.`, "PGRST100");
        params.push(JSON.stringify(value));
        where.push(`${col} in (select (e.v)::${type} from jsonb_array_elements_text($${params.length}::text::jsonb) as e(v))`);
      } else if (op === "ilike") {
        // PostgREST lets * stand for %.
        params.push((textOf(value) ?? "").replace(/\*/g, "%"));
        where.push(`${col}::text ilike $${params.length}::text`);
      } else {
        params.push(textOf(value));
        where.push(`${col} ${OPS[op]} ($${params.length}::text)::${type}`);
      }
    }

    // [column, ascending] or a list of [column, ascending, nullsFirst].
    const rawOrder = spec.order ?? [];
    if (!Array.isArray(rawOrder)) throw new ApiError(400, "Order is [column, ascending].", "PGRST100");
    const orders = rawOrder.length && !Array.isArray(rawOrder[0]) ? [rawOrder] : rawOrder;
    const orderBy = orders.map((o) => {
      if (!Array.isArray(o)) throw new ApiError(400, "Order is [column, ascending].", "PGRST100");
      const [name, ascending = true, nullsFirst = null] = o;
      const nulls = nullsFirst === true ? " nulls first" : nullsFirst === false ? " nulls last" : "";
      return `${columnOf(table, cols, name)} ${ascending === false ? "desc" : "asc"}${nulls}`;
    });

    let limit = MAX_ROWS;
    let offset = 0;
    const whole = (n) => Number.isSafeInteger(n) && n >= 0;
    if (spec.range != null) {
      const [lo, hi] = Array.isArray(spec.range) ? spec.range : [];
      if (!whole(lo) || !Number.isSafeInteger(hi) || hi < lo - 1) throw new ApiError(416, "Requested range not satisfiable", "PGRST103");
      offset = lo;
      limit = Math.min(limit, hi - lo + 1);
    }
    if (spec.limit != null) {
      if (!whole(spec.limit)) throw new ApiError(400, "Limit must be a whole number.", "PGRST100");
      limit = Math.min(limit, spec.limit);
    }

    const sql = `select coalesce(json_agg(t), '[]'::json) as v from (
      select ${list.join(", ")} from public.${quoteIdent(table)}
      ${where.length ? `where ${where.join(" and ")}` : ""}
      ${orderBy.length ? `order by ${orderBy.join(", ")}` : ""}
      limit ${limit} offset ${offset}
    ) t`;
    return { sql, params };
  }

  async function query(req, res) {
    const spec = await readJson(req);
    if (!isObject(spec)) throw new ApiError(400, "A query is an object.", "PGRST100");
    const user = callerOf(req);
    const { sql, params } = querySql(spec);
    try {
      const rows = await pg.transaction(async (tx) => {
        await actAs(tx, user);
        return (await tx.query(sql, params)).rows;
      });
      return sendJson(res, 200, { data: rows[0].v, error: null, status: 200 });
    } catch (err) {
      if (!isPgError(err)) throw err;
      return sendJson(res, 200, { data: null, error: pgErrorBody(err), status: pgStatus(err, user) });
    }
  }

  /* ---------- test controls ---------- */

  async function setClock(req, res) {
    const body = await readJson(req);
    let next = clock.offset;
    if (body.advanceMs !== undefined) {
      if (!Number.isFinite(body.advanceMs) || body.advanceMs < 0) throw new ApiError(400, "advanceMs is a number of milliseconds, 0 or more.");
      next += body.advanceMs;
    } else if (body.offset !== undefined) {
      if (!Number.isFinite(body.offset)) throw new ApiError(400, "offset is a number of milliseconds.");
      next = body.offset;
    } else {
      throw new ApiError(400, "Send { advanceMs } or { offset }.");
    }
    // Saves never run backwards: a clock behind a save's own would freeze that camp.
    if (next < clock.offset) throw new ApiError(400, "The clock only moves forward.");
    clock.offset = Math.floor(next);
    return sendJson(res, 200, { offset: clock.offset, now: clock.now(), error: null });
  }

  async function sql(req, res) {
    if (!allowSql) throw new ApiError(403, "SQL is off. Start the stage with --allow-sql (or allowSql: true).");
    const body = await readJson(req);
    if (typeof body.text !== "string" || !body.text.trim()) throw new ApiError(400, "Send { text, params }.");
    try {
      let rows;
      if (Array.isArray(body.params)) {
        rows = (await pg.query(body.text, body.params)).rows;
      } else {
        const results = await pg.exec(body.text);
        rows = results.length ? results[results.length - 1].rows : [];
      }
      return sendJson(res, 200, { data: rows, error: null });
    } catch (err) {
      if (!isPgError(err)) throw err;
      return sendJson(res, 400, { data: null, error: pgErrorBody(err) });
    }
  }

  function health(res) {
    return sendJson(res, 200, {
      ok: true,
      engine: ENGINE_VERSION,
      now: clock.now(),
      offset: clock.offset,
      users: users.size,
      changeId: changes.id,
      realtime: realtimeTables,
      rpc: [...functions.keys()],
      allowSql,
      errors: errors.length,
    });
  }

  function changesSince(res, url) {
    const raw = url.searchParams.get("since");
    const since = raw === null || raw === "" ? changes.id : Number(raw);
    const tables = Number.isFinite(since) ? [...changes.tables].filter(([, id]) => id > since).map(([t]) => t).sort() : [];
    // `changes` lets several channels on one client keep their own place.
    return sendJson(res, 200, { id: changes.id, tables, changes: Object.fromEntries(changes.tables) });
  }

  /* ---------- static files ---------- */

  function rewriteIndex(html, origin) {
    const fake = '<script src="dev/fake-supabase.js"></script>';
    let out = html.replace(/<script\b[^>]*\bsrc=["']https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^"']*["'][^>]*>\s*<\/script>/gi, fake);
    // Nothing may still point at the real project.
    out = out.replace(/(window\.RESPITE_SUPABASE_URL\s*=\s*)(["'])[^"']*\2/g, `$1${JSON.stringify(origin)}`);
    const dev = `<script>window.RESPITE_SUPABASE_URL = ${JSON.stringify(origin)}; window.RESPITE_DEV = true;</script>\n`;
    const main = out.search(/<script\b[^>]*\bsrc=["'][^"']*src\/client\/main\.js["'][^>]*>/i);
    const head = out.includes(fake) ? "" : `${fake}\n`;
    if (main >= 0) return out.slice(0, main) + head + dev + out.slice(main);
    return out.replace(/<\/body>/i, `${head}${dev}</body>`);
  }

  async function serveStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" }, "Method not allowed");
    }
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return send(res, 400, { "content-type": "text/plain; charset=utf-8" }, "Bad path");
    }
    if (path === "/") path = "/index.html";
    const file = resolve(REPO, `.${path}`);
    const hidden = path.split("/").some((part) => part.startsWith(".") || part === "node_modules");
    if (hidden || !file.startsWith(REPO + sep)) return send(res, 404, { "content-type": "text/plain; charset=utf-8" }, "Not found");
    let info;
    try {
      info = await stat(file);
    } catch {
      info = null;
    }
    if (!info || !info.isFile()) return send(res, 404, { "content-type": "text/plain; charset=utf-8" }, "Not found");
    let body = await readFile(file);
    if (file === join(REPO, "index.html")) {
      // The origin the browser used (127.0.0.1 or localhost), so the page never goes cross-origin.
      const origin = req.headers.host ? `http://${req.headers.host}` : `http://${host}:${server.address().port}`;
      body = Buffer.from(rewriteIndex(body.toString("utf8"), origin));
    }
    const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "content-length": body.length, "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : body);
  }

  /* ---------- routing ---------- */

  const POSTS = {
    "/dev/auth/signup": async (req, res) => sendJson(res, 200, { ...(await signUp(await readJson(req))), error: null }),
    "/dev/auth/signin": async (req, res) => sendJson(res, 200, { ...signIn(await readJson(req)), error: null }),
    "/dev/auth/signout": async (req, res) => {
      tokens.delete(bearerOf(req.headers.authorization));
      return sendJson(res, 200, { error: null });
    },
    "/dev/rpc": rpc,
    "/dev/query": query,
    "/dev/clock": setClock,
    "/dev/sql": sql,
  };
  const GETS = {
    "/dev/health": (_req, res) => health(res),
    "/dev/changes": (_req, res, url) => changesSince(res, url),
  };

  // What the fake client calls. Their refusals answer HTTP 200 with the status in the body, so an
  // expected "User already registered" or a raised RPC message leaves Chromium's console clean.
  const BROWSER = new Set(["/dev/auth/signup", "/dev/auth/signin", "/dev/auth/signout", "/dev/rpc", "/dev/query", "/dev/changes"]);
  const GAME = "/functions/v1/game";

  async function route(req, res, url) {
    const path = url.pathname;
    const api = path === GAME || Object.hasOwn(POSTS, path) || Object.hasOwn(GETS, path);
    if (api && req.method === "OPTIONS") return send(res, 204, path === GAME ? CORS : API_CORS, "");
    if (path === GAME) return game(req, res);
    if (Object.hasOwn(POSTS, path)) {
      if (req.method !== "POST") throw new ApiError(405, "Use POST.");
      return POSTS[path](req, res, url);
    }
    if (Object.hasOwn(GETS, path)) {
      if (req.method !== "GET") throw new ApiError(405, "Use GET.");
      return GETS[path](req, res, url);
    }
    return serveStatic(req, res, url);
  }

  const server = http.createServer((req, res) => {
    const started = Date.now();
    const url = new URL(req.url, "http://stage");
    route(req, res, url)
      .catch((err) => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        if (err instanceof ApiError) {
          const soft = BROWSER.has(url.pathname) && err.status !== 405;
          sendJson(res, soft ? 200 : err.status, { data: null, error: { message: err.message, code: err.code, details: null, hint: null }, status: err.status });
          return;
        }
        logError(`stage: ${req.method} ${url.pathname} failed`, err);
        sendJson(res, 500, { data: null, error: { message: "The stage failed; see its log." }, status: 500 });
      })
      .finally(() => {
        // Polls and static files would drown the log.
        const noisy = url.pathname === "/dev/changes" || !(url.pathname === GAME || Object.hasOwn(POSTS, url.pathname) || Object.hasOwn(GETS, url.pathname));
        if (!noisy) say(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
      });
  });

  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => {
      server.off("error", fail);
      ok();
    });
  });

  const address = server.address();
  const stage = {
    url: `http://${host}:${address.port}`,
    port: address.port,
    db: pg,
    clock,
    errors,
    allowSql,
    async close() {
      await new Promise((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      });
      await pg.close();
    },
  };
  return stage;
}

/* ================= 5. FROM THE COMMAND LINE ================= */

function parseArgs(argv) {
  const opts = { port: 8787, quiet: false, allowSql: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quiet") opts.quiet = true;
    else if (a === "--allow-sql") opts.allowSql = true;
    else if (a === "--port") opts.port = Number(argv[++i]);
    else if (a.startsWith("--port=")) opts.port = Number(a.slice(7));
    else throw new Error(`Unknown option ${a}. Use --port N, --quiet, --allow-sql.`);
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) throw new Error("--port takes a port number.");
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const opts = parseArgs(process.argv.slice(2));
  const stage = await startDevServer(opts).catch((err) => {
    if (err && err.code === "EADDRINUSE") console.error(`Port ${opts.port} is taken. Pick another with --port N (0 finds a free one).`);
    else console.error(err);
    process.exit(1);
  });
  console.log(`Respite stage on ${stage.url} (engine ${ENGINE_VERSION}${opts.allowSql ? ", SQL allowed" : ""})`);
  const stop = async () => {
    await stage.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
