/* ============================================================
   Respite · net.js · The Courier
   ------------------------------------------------------------
   Everything that crosses to Supabase: accounts, the game
   function, the RPCs, the market's reads and party realtime.
   Only the small surface CLIENT.md lists is used, so the dev
   harness can stand in for Supabase exactly.

   Accounts keep v4's shape: a username is the local part of
   <username>@players.respite. Errors come back as short human
   sentences; nothing here throws at a caller.
   ============================================================ */

import { ENGINE_VERSION } from "../shared/version.js";

/* ================= 1. NAMES ================= */

export const EMAIL_DOMAIN = "players.respite";
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 6;

export const cleanUsername = (u) => String(u == null ? "" : u).trim().toLowerCase();
export const emailFor = (username) => `${cleanUsername(username)}@${EMAIL_DOMAIN}`;

export function usernameError(u) {
  const name = cleanUsername(u);
  if (!name) return "Choose a username.";
  if (!USERNAME_RE.test(name)) return "3 to 20 letters, numbers or underscores.";
  return null;
}

export function passwordError(p) {
  if (typeof p !== "string" || !p) return "Choose a password.";
  if (p.length < PASSWORD_MIN) return `At least ${PASSWORD_MIN} characters.`;
  return null;
}

function usernameOf(email) {
  if (typeof email !== "string") return null;
  const at = email.lastIndexOf("@");
  const local = at > 0 ? email.slice(0, at).toLowerCase() : "";
  return USERNAME_RE.test(local) ? local : null;
}

const UNREACHABLE = "The realm can't be reached. Check your connection.";
const CLOSED = "Accounts are closed here: the realm isn't set up.";

// Supabase's messages, in the camp's voice where we know them.
function authMessage(error, fallback) {
  const m = error && typeof error.message === "string" ? error.message : "";
  if (/invalid login credentials/i.test(m)) return "Wrong username or password.";
  if (/already registered|already exists|user_already_exists/i.test(m)) return "That name is taken.";
  if (/email not confirmed/i.test(m)) return "That account is still waiting on its email confirmation.";
  if (/rate limit|too many/i.test(m)) return "Too many tries. Wait a minute and try again.";
  if (/password/i.test(m) && /short|least|weak/i.test(m)) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (/fetch|network|load failed/i.test(m)) return UNREACHABLE;
  return m || fallback;
}

// RPCs raise short sentences ("Only the party leader can invite."); pass those through.
function rpcMessage(error) {
  const m = error && typeof error.message === "string" ? error.message.trim() : "";
  if (!m) return "Something went wrong.";
  if (/fetch|network|load failed/i.test(m)) return UNREACHABLE;
  return m;
}

// ilike treats % and _ as wildcards; a player's search means them literally.
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

/* ================= 2. THE COURIER ================= */

/**
 * createNet({ supabase, client, url, key, fetch, now, timeoutMs })
 *   supabase  the supabase-js global (createClient), or pass a ready `client`
 *   fetch     for the game function; injectable for tests and the harness
 *   now       () => ms, the server-aligned clock (listing expiry is judged against it)
 */
export function createNet({
  supabase = null,
  client: givenClient = null,
  url = "",
  key = "",
  fetch: fetchFn = typeof fetch === "function" ? fetch.bind(globalThis) : null,
  now = () => Date.now(),
  timeoutMs = 30 * 1000,
} = {}) {
  const base = String(url || "").replace(/\/+$/, "");
  let client = givenClient;
  if (!client && supabase && typeof supabase.createClient === "function" && base && key) {
    try {
      client = supabase.createClient(base, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
    } catch (err) {
      console.error("net: createClient failed", err);
      client = null;
    }
  }
  const enabled = !!client;
  let current = null;                 // the last session seen: { userId, username, token }
  const listeners = new Set();
  let channelSeq = 0;

  const toSession = (s) => (s && s.user && typeof s.user.id === "string"
    ? { userId: s.user.id, username: usernameOf(s.user.email), token: s.access_token || null }
    : null);

  function tell(event, session, source) {
    for (const fn of listeners) {
      try {
        fn({ event, session, source });
      } catch (err) {
        console.error("net: auth listener failed", err);
      }
    }
  }

  // Other tabs share the session: their sign in or out reaches this one too.
  if (client && client.auth && typeof client.auth.onAuthStateChange === "function") {
    try {
      client.auth.onAuthStateChange((event, session) => {
        const s = toSession(session);
        if (event === "SIGNED_OUT") current = null;
        else if (s) current = s;
        // Later, never inside the callback: supabase-js holds a lock there, and a listener that
        // reads the session again would wait on itself.
        if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(() => tell(event === "SIGNED_IN" ? "signed_in" : "signed_out", s, "auth"), 0);
      });
    } catch (err) {
      console.error("net: onAuthStateChange failed", err);
    }
  }

  async function session() {
    if (!client) return null;
    try {
      const { data, error } = await client.auth.getSession();
      const s = !error && data ? toSession(data.session) : null;
      current = s;
      return s;
    } catch (err) {
      return current;
    }
  }

  async function signIn(username, password) {
    if (!client) return CLOSED;
    const name = cleanUsername(username);
    if (!name || typeof password !== "string" || !password) return "Enter your username and password.";
    if (!USERNAME_RE.test(name)) return "Wrong username or password.";
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: emailFor(name), password });
      if (error) return authMessage(error, "Signing in failed.");
      const s = toSession(data && data.session);
      if (!s) return "Signing in failed. Try again.";
      current = s;
      tell("signed_in", s, "local");
      return null;
    } catch (err) {
      return UNREACHABLE;
    }
  }

  async function signUp(username, password) {
    const name = cleanUsername(username);
    const bad = usernameError(name) || passwordError(password);
    if (bad) return bad;
    if (!client) return CLOSED;
    try {
      const { data, error } = await client.auth.signUp({ email: emailFor(name), password });
      if (error) return authMessage(error, "The account could not be made.");
      const s = toSession(data && data.session);
      if (!s) return "The account was made but can't sign in until it is confirmed.";
      current = s;
      tell("signed_in", s, "local");
      return null;
    } catch (err) {
      return UNREACHABLE;
    }
  }

  async function signOut() {
    if (client) {
      try {
        await client.auth.signOut();
      } catch (err) {
        console.error("net: signOut failed", err);
      }
    }
    current = null;
    tell("signed_out", null, "local");
  }

  // supabase-js refreshes an expired token inside getSession; refreshSession forces it where it exists.
  async function refresh() {
    if (!client) return null;
    try {
      if (typeof client.auth.refreshSession === "function") {
        const { data } = await client.auth.refreshSession();
        if (data && data.session) current = toSession(data.session);
        return current;
      }
    } catch (err) {
      // Fall through to a plain read.
    }
    return session();
  }

  /* The game function. Always resolves to JSON in SERVER.md's shape; failures that never
     reached it come back as { ok: false, error: "network" }. */
  async function game(commands) {
    if (!client || !fetchFn) return { ok: false, error: "network", status: 0 };
    const s = await session();
    if (!s || !s.token) return { ok: false, error: "unauthorized", status: 401 };

    const body = JSON.stringify({ v: ENGINE_VERSION, commands: Array.isArray(commands) ? commands : [] });
    const abort = typeof AbortController === "function" ? new AbortController() : null;
    const timer = abort ? setTimeout(() => abort.abort(), timeoutMs) : 0;
    let res;
    try {
      res = await fetchFn(`${base}/functions/v1/game`, {
        method: "POST",
        headers: { Authorization: `Bearer ${s.token}`, apikey: key, "content-type": "application/json" },
        body,
        cache: "no-store",
        signal: abort ? abort.signal : undefined,
      });
    } catch (err) {
      return { ok: false, error: "network", status: 0 };
    } finally {
      if (timer) clearTimeout(timer);
    }

    let json = null;
    try {
      json = await res.json();
    } catch (err) {
      json = null;
    }
    const status = res.status;
    if (status === 200 && json && json.ok === true) return json;
    if (status === 401) return { ok: false, error: "unauthorized", status };
    if (status === 409 || (json && json.error === "outdated")) return { ok: false, error: "outdated", v: json ? json.v : null, status };
    if (status === 400 || status === 405 || status === 413) return { ok: false, error: "bad_request", status };
    if (!json) return { ok: false, error: status >= 500 || status === 0 ? "network" : "server_error", status };
    return { ok: false, error: typeof json.error === "string" ? json.error : "server_error", status };
  }

  async function rpc(name, args = {}) {
    if (!client) return { data: null, error: "Sign in first." };
    try {
      const { data, error } = await client.rpc(name, args || {});
      return { data: error ? null : data ?? null, error: error ? rpcMessage(error) : null };
    } catch (err) {
      return { data: null, error: UNREACHABLE };
    }
  }

  async function rows(build) {
    if (!client) return { rows: [], error: "Sign in first." };
    try {
      const { data, error } = await build();
      return { rows: Array.isArray(data) ? data : [], error: error ? rpcMessage(error) : null };
    } catch (err) {
      return { rows: [], error: UNREACHABLE };
    }
  }

  const market = {
    browse({ q = "", kind = null, tier = null, sort = "price", limit = 50, offset = 0 } = {}) {
      return rows(() => {
        const from = Math.max(0, Math.floor(Number(offset) || 0));
        const count = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
        let query = client.from("market_listings").select("*")
          .eq("status", "open")
          .gt("expires_at", new Date(now()).toISOString());
        const term = String(q || "").trim();
        if (term) query = query.ilike("item_name", `%${likeEscape(term)}%`);
        if (kind) query = query.eq("item_kind", kind);
        if (tier != null && tier !== "") query = query.eq("item_tier", Number(tier));
        query = sort === "newest" ? query.order("created_at", { ascending: false }) : query.order("price_each", { ascending: true });
        return query.range(from, from + count - 1);
      });
    },
    async mine() {
      const s = current || (await session());
      if (!s) return { rows: [], error: "Sign in first." };
      return rows(() => client.from("market_listings").select("*")
        .eq("seller_id", s.userId)
        .order("created_at", { ascending: false })
        .limit(50));
    },
    // The table's policy already limits it to sales you bought or sold.
    sales() {
      return rows(() => client.from("market_sales").select("*")
        .order("created_at", { ascending: false })
        .limit(50));
    },
  };

  const party = {
    state: () => rpc("party_state"),
    create: (name) => rpc("party_create", { p_name: name }),
    invite: (username) => rpc("party_invite", { p_username: cleanUsername(username) }),
    cancelInvite: (id) => rpc("party_cancel_invite", { p_invite_id: id }),
    respond: (id, accept) => rpc("party_respond", { p_invite_id: id, p_accept: !!accept }),
    leave: () => rpc("party_leave"),
    kick: (userId) => rpc("party_kick", { p_user_id: userId }),
    say: (body) => rpc("party_say", { p_body: body }),

    /* Pokes onChange when the party's chat, roster or invites change, and when an invite
       to you arrives (so a player with no party still hears one). Returns unsubscribe. */
    subscribe(partyId, onChange) {
      if (!client || typeof client.channel !== "function") return () => {};
      const me = current && current.userId;
      const poke = (payload) => {
        try {
          onChange(payload);
        } catch (err) {
          console.error("net: party listener failed", err);
        }
      };
      let channel;
      try {
        channel = client.channel(`party-${partyId || "none"}-${++channelSeq}`);
        let chain = channel;
        const listen = (table, filter) => {
          chain = chain.on("postgres_changes", { event: "*", schema: "public", table, filter }, poke) || chain;
        };
        if (partyId) ["party_messages", "party_members", "party_invites"].forEach((table) => listen(table, `party_id=eq.${partyId}`));
        if (me) listen("party_invites", `to_id=eq.${me}`);
        chain.subscribe(() => {});
      } catch (err) {
        console.error("net: realtime failed", err);
        return () => {};
      }
      return () => {
        try {
          client.removeChannel(channel);
        } catch (err) {
          // Already gone.
        }
      };
    },
  };

  async function hiscores(skill = "total", limit = 50) {
    const { data, error } = await rpc("hiscores", { p_skill: skill, p_limit: limit });
    return { rows: Array.isArray(data) ? data : [], error };
  }

  async function onlineCount() {
    const { data, error } = await rpc("online_count");
    const n = Number(data);
    return error || data == null || !Number.isFinite(n) ? null : n;
  }

  async function heartbeat(activity) {
    const { error } = await rpc("heartbeat", { p_activity: activity && typeof activity === "object" ? activity : null });
    return { error };
  }

  return {
    enabled,
    session,
    signIn,
    signUp,
    signOut,
    refresh,
    onAuthChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    game,
    rpc,
    market,
    party,
    hiscores,
    onlineCount,
    heartbeat,
    get client() { return client; },
  };
}
