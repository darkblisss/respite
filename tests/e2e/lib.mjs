/* ============================================================
   Respite · tests/e2e/lib.mjs · The Prompter
   ------------------------------------------------------------
   What every browser test needs: the stage in-process on a free
   port, Chromium through the global Playwright, pages that keep
   their console errors and never leave the machine, the account
   and store moves tests make over and over, and the same PASS or
   FAIL reporting as tests/server/run.mjs.

     import { run, check, startStack, launch, openApp } from "./lib.mjs";
   ============================================================ */

import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { startDevServer } from "../../dev/server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..", "..");
export const SHOTS = process.env.RESPITE_SHOTS || join(REPO, "tests", "e2e", "shots");
const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH || null;

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* ================= 1. REPORTING ================= */

let passed = 0;
let failed = 0;

function show(value) {
  const text = JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return text && text.length > 1500 ? `${text.slice(0, 1500)} ...` : text;
}

export function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : ` :: ${typeof detail === "string" ? detail : show(detail)}`}`);
  }
  return !!ok;
}

export function same(name, actual, expected) {
  const ok = isDeepStrictEqual(actual, expected);
  // JSON hides undefined keys and number-like strings; say so when that is the only difference.
  const alike = !ok && show(actual) === show(expected);
  return check(name, ok, alike ? { actual, expected, note: "these print alike: a key holding undefined, or a type, differs" } : { actual, expected });
}

export const section = (title) => console.log(`\n# ${title}`);

export function finish() {
  console.log(`\n${passed} passed${failed ? `, ${failed} failed` : ""}`);
  process.exit(failed ? 1 : 0);
}

// Runs a suite, counts an escaped error as a failure, then reports and exits.
export async function run(main) {
  try {
    await main();
  } catch (e) {
    check("the suite ran to the end", false, (e && e.stack) || String(e));
  }
  finish();
}

/* ================= 2. THE STAGE ================= */

// dev/server.mjs in this process, on a free port, with /dev/sql open for seeding.
export async function startStack(options = {}) {
  return startDevServer({ port: 0, allowSql: true, quiet: true, ...options });
}

async function api(stack, path, body) {
  const res = await fetch(`${stack.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

// Superuser SQL through /dev/sql. Throws on a database error so a broken seed stops the test.
export async function sql(stack, text, params = []) {
  const out = await api(stack, "/dev/sql", { text, params });
  if (out.error) throw new Error(`sql failed: ${out.error.message} :: ${text}`);
  return out.data;
}

export async function userIdOf(stack, username) {
  const rows = await sql(stack, "select user_id::text as id from public.profiles where username = $1", [username]);
  if (!rows.length) throw new Error(`no profile for ${username} (has it called the game function yet?)`);
  return rows[0].id;
}

// Changes a stored save the way only the server could; the player sees it on their next sync.
// The write only lands on the rev it read, so a sync slipping in between is never overwritten.
export async function editSave(stack, username, fn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await sql(stack, "select user_id::text as id, rev::text as rev, data from public.saves where username = $1", [username]);
    if (!rows.length) throw new Error(`no save for ${username}`);
    const data = rows[0].data;
    fn(data);
    const done = await sql(
      stack,
      "update public.saves set data = $2::text::jsonb where user_id = $1::uuid and rev = $3::bigint returning user_id",
      [rows[0].id, JSON.stringify(data), rows[0].rev],
    );
    if (done.length) return data;
  }
  throw new Error(`the save for ${username} kept changing under the edit`);
}

export function put(state, pool, key, qty) {
  const p = state[pool];
  p.items[key] = (p.items[key] || 0) + qty;
  if (!p.order.includes(key)) p.order.push(key);
}

// Moves the game function's clock (never Postgres now()).
export async function advanceServer(stack, ms) {
  const out = await api(stack, "/dev/clock", { advanceMs: ms });
  if (out.error) throw new Error(`clock refused: ${out.error.message}`);
  return out;
}

export async function waitFor(what, fn, { timeout = 10000, interval = 100 } = {}) {
  const until = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > until) throw new Error(`timed out after ${timeout}ms waiting for ${what}`);
    await sleep(interval);
  }
}

/* ================= 3. THE BROWSER ================= */

export async function launch(options = {}) {
  // PLAYWRIGHT_PATH when set, then the repo's own node_modules (npm install).
  const require = createRequire(import.meta.url);
  const tries = [PLAYWRIGHT, "playwright"].filter(Boolean);
  let chromium = null;
  for (const name of tries) {
    try {
      ({ chromium } = require(name));
      break;
    } catch (e) {
      if (e.code !== "MODULE_NOT_FOUND") throw e;
    }
  }
  if (!chromium) throw new Error("Playwright is not installed: run npm install (or set PLAYWRIGHT_PATH)");
  return chromium.launch({ headless: true, ...options });
}

const isLocal = (url) => {
  try {
    const u = new URL(url);
    if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return true;
    return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
};

/**
 * A fresh context (its own storage, so its own player) on one page.
 * errors collects console errors and uncaught page errors as strings; requests that would leave
 * the machine (Google Fonts) are blocked and listed in blocked, and their console noise dropped.
 */
export async function openApp(browser, { viewport = { width: 1440, height: 900 }, url, waitUntil = "load" } = {}) {
  if (!url) throw new Error("openApp needs a url");
  const context = await browser.newContext({ viewport });
  const blocked = [];
  const errors = [];
  const failures = [];
  await context.route("**/*", (route) => {
    const target = route.request().url();
    if (isLocal(target)) return route.continue();
    blocked.push(target);
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/ERR_BLOCKED_BY_CLIENT/.test(text)) return;
    const where = msg.location() && msg.location().url;
    errors.push(`console: ${text}${where ? ` (${where})` : ""}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${(err && err.stack) || err}`));
  page.on("response", (res) => {
    if (res.status() >= 400 && isLocal(res.url())) failures.push(`${res.status()} ${res.url()}`);
  });
  await page.goto(url, { waitUntil });
  return {
    page,
    context,
    errors,
    blocked,
    failures,
    close: () => context.close(),
  };
}

// On the app, main.js sets window.__respite a moment after load; the check page has window.harness.
async function ready(page, timeout = 15000) {
  await page.waitForFunction(
    () => (window.RESPITE_DEV === true ? !!(window.__respite && window.__respite.net) : !!(window.harness || window.supabase)),
    null,
    { timeout },
  );
}

async function authMove(page, move, username, password) {
  await ready(page);
  return page.evaluate(
    async ([m, u, p]) => {
      const net = window.__respite && window.__respite.net;
      if (net) return net[m](u, p);
      if (window.harness) return (await window.harness[m](u, p)).error;
      const client = window.supabase.createClient(window.RESPITE_SUPABASE_URL || location.origin, window.RESPITE_SUPABASE_ANON_KEY || "respite-dev");
      const creds = { email: `${u}@players.respite`, password: p };
      const { error } = m === "signUp" ? await client.auth.signUp(creds) : await client.auth.signInWithPassword(creds);
      return error ? error.message : null;
    },
    [move, username, password],
  );
}

// Both return null or the error string, as net.signUp and net.signIn do.
export const signUp = (page, username, password) => authMove(page, "signUp", username, password);
export const signIn = (page, username, password) => authMove(page, "signIn", username, password);

export async function storeStatus(page) {
  return page.evaluate(() => {
    const s = window.__respite && window.__respite.store;
    return s ? { mode: s.mode, ...s.status } : null;
  });
}

// Synced: connected, nothing queued and nothing in flight.
export async function waitForSync(page, { timeout = 15000 } = {}) {
  try {
    await page.waitForFunction(
      () => {
        const s = window.__respite && window.__respite.store;
        return !!s && !!s.status && s.status.conn === "online" && !s.status.pending;
      },
      null,
      { timeout, polling: 100 },
    );
  } catch (e) {
    throw new Error(`store never synced within ${timeout}ms; status ${JSON.stringify(await storeStatus(page).catch(() => null))}`);
  }
}

export async function dispatch(page, type, args = {}) {
  return page.evaluate(([t, a]) => window.__respite.store.dispatch(t, a), [type, args]);
}

// How far the page scrolls sideways, in px; 0 means it fits.
export async function overflowX(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth, document.body ? document.body.scrollWidth - doc.clientWidth : 0);
  });
}

// The elements poking past the right edge, for a failure message.
export async function wideElements(page, max = 5) {
  return page.evaluate((limit) => {
    const width = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.right > width + 1 && r.width > 0) {
        out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : ""} right=${Math.round(r.right)}`);
        if (out.length >= limit) break;
      }
    }
    return out;
  }, max);
}

export async function shot(page, name) {
  await mkdir(SHOTS, { recursive: true });
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

export const repoHas = (rel) => existsSync(join(REPO, rel));
