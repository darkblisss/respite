/* ============================================================
   Respite · functions/game/index.ts · The Gate
   ------------------------------------------------------------
   The Supabase Edge Function in front of src/server/handler.js.
   It answers CORS, asks Supabase Auth who holds the bearer token,
   and lends the handler one Postgres connection per isolate.
   Supabase provides SUPABASE_URL, SUPABASE_ANON_KEY and
   SUPABASE_DB_URL to every function.
   ============================================================ */

import postgres from "npm:postgres@3.4.5";
import { createGameHandler, MAX_BODY } from "../../../src/server/handler.js";
import { postgresJsAdapter } from "../../../src/server/db.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// One connection per isolate: requests queue on it, and the pooler never sees prepared statements.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL") ?? "", { prepare: false, max: 1, idle_timeout: 20 });

// The gateway's JWT check is off (config.toml), so this is the only door: Auth must know the token.
async function getUser(authorization: string): Promise<{ id: string; email: string | null } | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: SUPABASE_ANON_KEY },
  });
  if (res.status !== 200) {
    await res.body?.cancel();
    /* Only Auth saying no is a signed-out player. Auth being slow, busy or down (a 429, a
       5xx) throws instead, which the handler answers as a server error: the browser backs off
       and tries again rather than halting the camp under a Signed out banner it cannot clear. */
    if (res.status === 401 || res.status === 403) return null;
    throw new Error(`auth answered ${res.status}`);
  }
  const user = await res.json();
  if (!user || typeof user.id !== "string") return null;
  return { id: user.id, email: typeof user.email === "string" ? user.email : null };
}

/* The party hunt tick (POST .../game/tick) carries no user token: pg_cron and pg_net call it, and
   this secret is the only thing in front of it. Set it with
   `npx supabase secrets set RESPITE_TICK_SECRET=...` and put the same value in private.settings
   (supabase/migrations/006_party_hunts.sql says how). Unset, the tick path refuses everything. */
const handle = createGameHandler({
  db: postgresJsAdapter(sql),
  getUser,
  log: (...args: unknown[]) => console.error(...args),
  tickSecret: Deno.env.get("RESPITE_TICK_SECRET") ?? "",
});

function respond(status: number, headers: Record<string, string>, body: string | null): Response {
  return new Response(body, { status, headers: { ...headers, ...CORS } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return respond(200, {}, "ok");

  // Refuse an oversized body before reading it.
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY * 4) {
    return respond(400, { "content-type": "application/json; charset=utf-8" }, JSON.stringify({ ok: false, error: "bad_request" }));
  }

  let bodyText = "";
  try {
    bodyText = req.method === "POST" ? await req.text() : "";
  } catch {
    return respond(400, { "content-type": "application/json; charset=utf-8" }, JSON.stringify({ ok: false, error: "bad_request" }));
  }

  // The URL goes in so the handler can tell the game's door from the tick's.
  const res = await handle({ method: req.method, headers: req.headers, bodyText, url: req.url });
  return respond(res.status, res.headers, res.body);
});
