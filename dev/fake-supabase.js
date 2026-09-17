/* ============================================================
   Respite · dev/fake-supabase.js · The Mummer
   ------------------------------------------------------------
   Plays supabase-js for dev/server.mjs, in the costume CLIENT.md
   section 5 describes and nothing more:

     supabase.createClient(url, key, options)
     client.auth.getSession / signUp / signInWithPassword /
       signOut / onAuthStateChange
     client.rpc(fn, args)
     client.from(table).select(cols).eq().neq().gt().gte().lt()
       .lte().ilike().in().order().range().limit()
     client.channel(name).on("postgres_changes", ..., cb)
       .subscribe(statusCb), client.removeChannel(channel)

   A classic script, loaded where index.html loads the real one
   (the stage rewrites the tag). Anything outside that surface is
   left undefined on purpose, so a client that strays from the
   contract fails here instead of in production.

   Like the real thing, rpc() and select() are lazy: nothing is
   sent until the builder is awaited. Request errors come back as
   { data: null, error: { message } }, never thrown.
   ============================================================ */

(function () {
  "use strict";

  const POLL_MS = 1000;

  function hostRef(base) {
    try {
      return new URL(base).hostname.split(".")[0] || "local";
    } catch (e) {
      return "local";
    }
  }

  // The shape postgrest-js gives a failed fetch.
  function networkError(err) {
    const name = (err && err.name) || "Error";
    const message = (err && err.message) || String(err);
    return { message: `${name}: ${message}`, details: String((err && err.stack) || ""), hint: "", code: "" };
  }

  function createClient(supabaseUrl, supabaseKey, options) {
    const base = String(supabaseUrl || "").replace(/\/+$/, "");
    const apikey = String(supabaseKey || "");
    const authOptions = (options && options.auth) || {};
    const persist = authOptions.persistSession !== false;
    // supabase-js names its storage after the first label of the project host.
    const storageKey = authOptions.storageKey || `sb-${hostRef(base)}-auth-token`;

    /* ================= 1. TRANSPORT ================= */

    async function call(path, { method = "POST", body, token } = {}) {
      const headers = { apikey };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (token) headers.Authorization = `Bearer ${token}`;
      let res;
      try {
        res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
      } catch (err) {
        return { status: 0, statusText: "", json: null, failure: networkError(err) };
      }
      let json = null;
      try {
        json = await res.json();
      } catch (err) {
        return { status: res.status, statusText: res.statusText, json: null, failure: { message: `Unexpected response (${res.status})`, details: "", hint: "", code: "" } };
      }
      return { status: res.status, statusText: res.statusText, json, failure: null };
    }

    /* ================= 2. AUTH ================= */

    let memorySession = null;
    const listeners = new Map();
    let nextListener = 1;

    function readSession() {
      let session = memorySession;
      if (persist) {
        try {
          const raw = window.localStorage.getItem(storageKey);
          session = raw ? JSON.parse(raw) : null;
        } catch (e) {
          session = null;
        }
      }
      if (!session || typeof session.access_token !== "string" || !session.user) return null;
      // autoRefreshToken keeps a real session fresh. The stage never expires a token, so only the
      // dates move and the token stays the same.
      const nowS = Math.floor(Date.now() / 1000);
      if (typeof session.expires_at === "number" && session.expires_at - 60 <= nowS) {
        session.expires_at = nowS + (session.expires_in || 3600);
        writeSession(session);
      }
      return session;
    }

    function writeSession(session) {
      memorySession = session;
      if (!persist) return;
      try {
        if (session) window.localStorage.setItem(storageKey, JSON.stringify(session));
        else window.localStorage.removeItem(storageKey);
      } catch (e) {
        // Private windows may refuse storage; the session then lasts as long as the page.
      }
    }

    const token = () => {
      const s = readSession();
      return s ? s.access_token : null;
    };

    // supabase-js waits for every subscriber before signIn resolves; a throwing one is logged.
    async function notify(event, session) {
      const calls = [...listeners.values()].map((fn) => {
        try {
          return Promise.resolve(fn(event, session));
        } catch (err) {
          return Promise.reject(err);
        }
      });
      const settled = await Promise.allSettled(calls);
      settled.forEach((r) => {
        if (r.status === "rejected") console.error(r.reason);
      });
    }

    function authError(r) {
      if (r.failure) return { name: "AuthRetryableFetchError", message: r.failure.message, status: 0, code: null };
      const e = (r.json && r.json.error) || {};
      return { name: "AuthApiError", message: e.message || "Authentication failed", status: (r.json && r.json.status) || r.status, code: e.code || null };
    }

    async function openWith(path, credentials) {
      const body = { email: credentials && credentials.email, password: credentials && credentials.password };
      const r = await call(path, { body });
      if (r.failure || !r.json || r.json.error || !r.json.session) {
        return { data: { user: null, session: null }, error: authError(r) };
      }
      writeSession(r.json.session);
      await notify("SIGNED_IN", r.json.session);
      return { data: { user: r.json.user, session: r.json.session }, error: null };
    }

    const auth = {
      async getSession() {
        return { data: { session: readSession() }, error: null };
      },
      signUp(credentials) {
        return openWith("/dev/auth/signup", credentials);
      },
      signInWithPassword(credentials) {
        return openWith("/dev/auth/signin", credentials);
      },
      async signOut() {
        const t = token();
        // Signed out locally whatever the server says, as supabase-js does.
        if (t) await call("/dev/auth/signout", { body: {}, token: t });
        writeSession(null);
        await notify("SIGNED_OUT", null);
        return { error: null };
      },
      onAuthStateChange(callback) {
        const id = `sub${nextListener++}`;
        listeners.set(id, callback);
        // Like supabase-js: the current session arrives on its own turn, as INITIAL_SESSION.
        setTimeout(() => {
          if (!listeners.has(id)) return;
          Promise.resolve()
            .then(() => callback("INITIAL_SESSION", readSession()))
            .catch((err) => console.error(err));
        }, 0);
        return {
          data: {
            subscription: {
              id,
              callback,
              unsubscribe() {
                listeners.delete(id);
              },
            },
          },
        };
      },
    };

    // Another tab signed in or out: supabase-js tells this tab too. A write that only moved
    // expires_at (same token) is not news.
    if (persist) {
      const parse = (raw) => {
        try {
          const s = raw ? JSON.parse(raw) : null;
          return s && typeof s.access_token === "string" ? s : null;
        } catch (err) {
          return null;
        }
      };
      window.addEventListener("storage", (e) => {
        if (e.key !== storageKey) return;
        const before = parse(e.oldValue);
        const after = parse(e.newValue);
        if (!after) {
          if (before) notify("SIGNED_OUT", null);
          return;
        }
        if (before && before.access_token === after.access_token) return;
        notify("SIGNED_IN", readSession());
      });
    }

    /* ================= 3. POSTGREST ================= */

    function answer(r) {
      if (r.failure) return { data: null, error: r.failure, count: null, status: r.status, statusText: r.statusText };
      const json = r.json || {};
      const status = json.status || r.status;
      if (json.error) return { data: null, error: json.error, count: null, status, statusText: "" };
      return { data: json.data === undefined ? null : json.data, error: null, count: null, status, statusText: "OK" };
    }

    // A thenable that sends its request each time it is awaited, as PostgrestBuilder does.
    function lazy(run) {
      return {
        then(onFulfilled, onRejected) {
          return run().then(onFulfilled, onRejected);
        },
      };
    }

    function rpc(fn, args) {
      return lazy(async () => answer(await call("/dev/rpc", { body: { fn, args: args === undefined ? {} : args }, token: token() })));
    }

    function filterBuilder(table, columns) {
      const spec = { table, select: columns === undefined || columns === null ? "*" : String(columns), filters: [], order: [] };
      let offset = null;
      let limit = null;
      const builder = {
        then(onFulfilled, onRejected) {
          const body = { table: spec.table, select: spec.select, filters: spec.filters.slice() };
          if (spec.order.length) body.order = spec.order.length === 1 ? spec.order[0] : spec.order.slice();
          // .range() sets offset and limit, .limit() only the limit: the later call wins, as in postgrest-js.
          if (offset !== null) body.range = [offset, offset + (limit === null ? 1000 : limit) - 1];
          else if (limit !== null) body.limit = limit;
          return call("/dev/query", { body, token: token() }).then(answer).then(onFulfilled, onRejected);
        },
        order(column, opts) {
          const o = opts || {};
          spec.order.push([column, o.ascending !== false, typeof o.nullsFirst === "boolean" ? o.nullsFirst : null]);
          return builder;
        },
        range(from, to) {
          offset = from;
          limit = to - from + 1;
          return builder;
        },
        limit(count) {
          limit = count;
          return builder;
        },
      };
      ["eq", "neq", "gt", "gte", "lt", "lte", "ilike", "in"].forEach((op) => {
        builder[op] = (column, value) => {
          spec.filters.push([op, column, value]);
          return builder;
        };
      });
      return builder;
    }

    function from(table) {
      return {
        select(columns) {
          return filterBuilder(table, columns);
        },
      };
    }

    /* ================= 4. REALTIME ================= */
    /* One poll a second of /dev/changes for every subscribed channel on this
       client. The stage only knows which tables changed, so every binding on a
       changed table fires with eventType "*" and empty rows; filters and RLS
       are not applied. A poke means "go and look", which is all the client
       contract asks of it. */

    const channels = new Set();
    let timer = null;
    let polling = false;

    async function fetchChanges(since) {
      const r = await call(`/dev/changes${since === null ? "" : `?since=${since}`}`, { method: "GET" });
      const json = r.json;
      return !r.failure && json && typeof json.id === "number" ? json : null;
    }

    function status(ch, value, err) {
      if (!ch.statusCallback) return;
      try {
        ch.statusCallback(value, err);
      } catch (e) {
        console.error(e);
      }
    }

    function fire(ch, table) {
      const payload = { schema: "public", table, commit_timestamp: new Date().toISOString(), eventType: "*", new: {}, old: {}, errors: null };
      ch.bindings.forEach((b) => {
        const f = b.filter || {};
        const schemaOk = !f.schema || f.schema === "*" || f.schema === "public";
        const tableOk = !f.table || f.table === "*" || f.table === table;
        if (!schemaOk || !tableOk) return;
        try {
          b.callback(payload);
        } catch (e) {
          console.error(e);
        }
      });
    }

    async function poll() {
      timer = null;
      if (!channels.size || polling) return;
      polling = true;
      try {
        const joined = [...channels].filter((ch) => ch.since !== null);
        const since = joined.length ? Math.min(...joined.map((ch) => ch.since)) : null;
        const json = await fetchChanges(since);
        channels.forEach((ch) => {
          if (!json) {
            if (ch.state !== "errored") {
              ch.state = "errored";
              status(ch, "CHANNEL_ERROR", new Error("Realtime poll failed"));
            }
            return;
          }
          if (ch.since === null || ch.state === "errored") {
            // Joining (or rejoining): changes from before this moment are not this channel's.
            // A rejoin keeps its old place, so what changed while the stage was away still pokes.
            const rejoin = ch.state === "errored";
            ch.since = rejoin ? (ch.since ?? json.id) : json.id;
            ch.state = "joined";
            status(ch, "SUBSCRIBED");
            if (!rejoin) return;
          }
          const changed = Object.keys(json.changes || {}).filter((t) => json.changes[t] > ch.since);
          ch.since = json.id;
          changed.forEach((t) => fire(ch, t));
        });
      } finally {
        polling = false;
        if (channels.size && !timer) timer = setTimeout(poll, POLL_MS);
      }
    }

    function channel(name) {
      const ch = {
        topic: `realtime:${name}`,
        state: "closed",
        since: null,
        bindings: [],
        statusCallback: null,
        on(type, filter, callback) {
          if (type === "postgres_changes" && typeof callback === "function") ch.bindings.push({ filter, callback });
          else console.warn(`fake-supabase: channel.on("${type}") is not part of the client contract; only postgres_changes is played`);
          return ch;
        },
        subscribe(callback) {
          ch.statusCallback = typeof callback === "function" ? callback : null;
          if (channels.has(ch)) return ch;
          ch.state = "joining";
          channels.add(ch);
          // Join straight away rather than on the next tick of the shared poll.
          if (timer) clearTimeout(timer);
          timer = null;
          if (!polling) poll();
          return ch;
        },
      };
      return ch;
    }

    async function removeChannel(ch) {
      if (!ch || !channels.has(ch)) return "ok";
      channels.delete(ch);
      ch.state = "closed";
      status(ch, "CLOSED");
      if (!channels.size && timer) {
        clearTimeout(timer);
        timer = null;
      }
      return "ok";
    }

    return { auth, rpc, from, channel, removeChannel };
  }

  window.supabase = { createClient };
})();
