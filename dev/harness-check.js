/* ============================================================
   Respite · dev/harness-check.js · The Walkthrough
   ------------------------------------------------------------
   The fake supabase-js surface called straight from a browser,
   with no store and no pages in the way. harness.test.mjs opens
   dev/harness-check.html on the stage and drives window.harness;
   open it by hand and every call is listed on the page.

   Values handed back are plain JSON, so page.evaluate can carry
   them to Node unchanged.
   ============================================================ */

import { ENGINE_VERSION } from "../src/shared/version.js";

const URL_BASE = window.RESPITE_SUPABASE_URL || location.origin;
const KEY = "respite-dev";
const client = window.supabase.createClient(URL_BASE, KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const calls = document.getElementById("calls");
const who = document.getElementById("who");

function note(text) {
  const li = document.createElement("li");
  li.textContent = text;
  calls.append(li);
}

const short = (v) => {
  const s = JSON.stringify(v);
  return s && s.length > 160 ? `${s.slice(0, 160)}...` : s;
};

const events = [];
const pokes = [];
const statuses = [];
const channels = new Map();

client.auth.onAuthStateChange((event, session) => {
  events.push({ event, userId: session ? session.user.id : null, email: session ? session.user.email : null });
  who.textContent = session ? `Signed in as ${session.user.email}` : "Signed out";
  note(`auth ${event}`);
});

const emailOf = (username) => `${username}@players.respite`;

window.harness = {
  engine: ENGINE_VERSION,
  storageKey: `sb-${new URL(URL_BASE).hostname.split(".")[0]}-auth-token`,
  events,
  pokes,
  statuses,

  async signUp(username, password) {
    const { data, error } = await client.auth.signUp({ email: emailOf(username), password });
    note(`signUp ${username}: ${error ? error.message : "ok"}`);
    return { error: error ? error.message : null, userId: data.user ? data.user.id : null, session: data.session };
  },

  async signIn(username, password) {
    const { data, error } = await client.auth.signInWithPassword({ email: emailOf(username), password });
    note(`signIn ${username}: ${error ? error.message : "ok"}`);
    return { error: error ? error.message : null, userId: data.user ? data.user.id : null, session: data.session };
  },

  async signOut() {
    const { error } = await client.auth.signOut();
    note("signOut");
    return { error };
  },

  async session() {
    const { data, error } = await client.auth.getSession();
    return { session: data.session, error };
  },

  // The call net.js makes, word for word from CLIENT.md.
  async game(commands = [], { token, v = ENGINE_VERSION, method = "POST" } = {}) {
    const { data } = await client.auth.getSession();
    const access = token !== undefined ? token : data.session && data.session.access_token;
    const headers = { apikey: KEY, "content-type": "application/json" };
    if (access) headers.Authorization = `Bearer ${access}`;
    const res = await fetch(`${URL_BASE}/functions/v1/game`, { method, headers, body: method === "POST" ? JSON.stringify({ v, commands }) : undefined });
    const body = await res.json().catch(() => null);
    note(`game ${commands.map((c) => c.type).join(", ") || "sync"}: ${res.status}`);
    return { status: res.status, body, cors: res.headers.get("access-control-allow-origin") };
  },

  // doneAt lets a test time a realtime poke in the browsers, free of the test driver's lag.
  async rpc(fn, args) {
    const res = await client.rpc(fn, args);
    note(`rpc ${fn} ${short(args)}: ${res.error ? res.error.message : short(res.data)}`);
    return { ...res, doneAt: Date.now() };
  },

  // steps: [["eq", "status", "open"], ["order", "price_each", { ascending: false }], ["range", 0, 9]]
  async query(table, columns, steps = []) {
    let q = client.from(table).select(columns);
    for (const [method, ...args] of steps) q = q[method](...args);
    const res = await q;
    note(`from ${table} ${short(steps)}: ${res.error ? res.error.message : `${res.data.length} rows`}`);
    return res;
  },

  // Lazy like postgrest-js: a builder nobody awaits sends nothing.
  async unawaited(fn, args) {
    client.rpc(fn, args);
    client.from("profiles").select("*");
    return true;
  },

  subscribe(table, name = `watch-${table}`) {
    const ch = client
      .channel(name)
      .on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        pokes.push({ channel: name, table: payload.table, eventType: payload.eventType, at: Date.now() });
        note(`poke ${payload.table}`);
      })
      .subscribe((status) => {
        statuses.push({ channel: name, status, at: Date.now() });
      });
    channels.set(name, ch);
    return name;
  },

  async unsubscribe(name) {
    const ch = channels.get(name);
    channels.delete(name);
    return ch ? client.removeChannel(ch) : "ok";
  },

  pokeCount(table) {
    return pokes.filter((p) => p.table === table).length;
  },
};

note(`ready, engine ${ENGINE_VERSION}`);
