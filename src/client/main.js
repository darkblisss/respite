/* ============================================================
   Respite · main.js · The Campfire
   ------------------------------------------------------------
   Lights the page: finds the realm (or plays as a guest), makes
   the store, the shell, the router and the town crier, and runs
   the loop that keeps them all moving about ten times a second.

   It owns everything a Node test cannot: the DOM, timers, page
   visibility, and switching camps when a player signs in or out.
   ============================================================ */

import { CLIENT, supabaseGlobal } from "./config.js";
import { createClock } from "./clock.js";
import { createNet } from "./net.js";
import { createStore, hasProgress } from "./store.js";
import { createRouter } from "./router.js";
import { createListeners, plainText } from "./listeners.js";
import { createShell } from "./ui/shell.js";
import { el, h } from "./ui/dom.js";
import { bindDrawer, closeModals, toast } from "./ui/overlay.js";
import { openPopup } from "./ui/widgets.js";

// Every popup module in CLIENT.md 6 (settings.js registers both settings and account).
const POPUPS = ["item", "action", "zone", "foe", "class", "sell", "settings", "sky"];

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/* ================= 1. THE APP ================= */

const app = {
  net: null,
  store: null,
  router: null,
  shell: null,
  listeners: null,
  drawer: null,
  ctx: null,
  ctxs: new Set(),

  go(hash) {
    if (location.hash === hash) app.router.render({ focus: false });
    else location.hash = hash;
  },

  async dispatch(type, args = {}, { quiet = false } = {}) {
    const store = app.store;
    if (!store) return { ok: false, error: "The camp is still waking." };
    let res;
    try {
      res = await store.dispatch(type, args);
    } catch (err) {
      console.error(`dispatch ${type}`, err);
      res = null;
    }
    if (!res || typeof res !== "object") res = { ok: false, error: "That went wrong." };
    if (!res.ok && !quiet) toast(plainText(res.error) || "That didn't work", { kind: "warn" });
    app.refresh();
    return res;
  },

  // Right after a dispatch: the page, the shell and every onTick see the new save at once.
  refresh() {
    safely("router", () => app.router.update());
    safely("shell", () => app.shell.update());
    tickAll();
  },

  openSettings() {
    openPopup("settings", app.ctx);
  },

  openAccount(mode = "signin") {
    openPopup("account", app.ctx, { mode });
  },

  openSky() {
    openPopup("sky", app.ctx);
  },
};

const failed = new Set();
function safely(what, fn) {
  try {
    fn();
  } catch (err) {
    // Once each: a frame that throws would otherwise say so ten times a second.
    if (!failed.has(what)) console.error(`${what} failed`, err);
    failed.add(what);
  }
}

/* ================= 2. CTX ================= */

// CLIENT.md 3. Subscriptions made through a ctx are released with it.
function makeCtx(route) {
  const offs = new Set();
  const tickers = new Set();
  const ctx = {
    get state() { return app.store ? app.store.state : null; },
    get now() {
      const store = app.store;
      if (!store) return Date.now();
      return store.state ? store.state.clock : store.now();
    },
    get store() { return app.store; },
    get net() { return app.net; },
    get account() { return app.store ? app.store.account() : { mode: "guest", username: null, userId: null }; },
    get party() { return app.store ? app.store.party : null; },
    route,
    go: (hash) => app.go(hash),
    dispatch: (type, args = {}, options = {}) => app.dispatch(type, args, options),
    on(type, fn) {
      const store = app.store;
      if (!store) return () => {};
      const off = store.bus.on(type, fn);
      const release = () => {
        off();
        offs.delete(release);
      };
      offs.add(release);
      return release;
    },
    onTick(fn) {
      tickers.add(fn);
      return () => tickers.delete(fn);
    },
  };
  Object.defineProperty(ctx, "_tick", {
    value() {
      for (const fn of tickers) {
        try {
          fn(ctx);
        } catch (err) {
          if (!failed.has(fn)) console.error("onTick failed", err);
          failed.add(fn);
        }
      }
    },
  });
  Object.defineProperty(ctx, "_release", {
    value() {
      [...offs].forEach((off) => off());
      tickers.clear();
      app.ctxs.delete(ctx);
    },
  });
  app.ctxs.add(ctx);
  return ctx;
}

function tickAll() {
  for (const ctx of app.ctxs) ctx._tick();
}

/* ================= 3. CAMPS ================= */

function showBoot() {
  el("view").replaceChildren(h("div.boot#boot",
    h("img.boot-mark", { src: "assets/respite-logo.webp", alt: "", width: "56", height: "56" }),
    h("span", "Waking the camp")));
}

function useStore(store) {
  const old = app.store;
  if (old) old.destroy();
  app.router.unmount();
  closeModals("route");
  app.store = store;
  app.listeners.bind(store);
  app.shell.reset();
  store.setVisible(document.visibilityState !== "hidden");
  store.watchParty(false);

  if (!store.state) showBoot();
  store.ready.then(() => {
    if (app.store === store) app.router.render({ focus: false });
  });

  if (store.mode === "account") {
    store.sync();
    // A session that is dead before the camp even loads: back to a guest, and say so.
    const off = store.bus.on("store:status", ({ status }) => {
      if (app.store !== store) {
        off();
        return;
      }
      if (store.state) {
        off();
        return;
      }
      if (status.error === "unauthorized") {
        off();
        app.net.signOut().then(() => {
          if (app.store === store) startGuest();
          toast("Your session ended. Sign in again", { kind: "info", icon: "lock" });
        });
      }
    });
  }
  app.refresh();
}

function startGuest() {
  useStore(createStore({ mode: "guest", clock: createClock() }));
}

function startAccount(session) {
  useStore(createStore({ mode: "account", net: app.net, session, clock: createClock() }));
}

function onAuth({ event, session, source }) {
  const store = app.store;
  if (event === "signed_out") {
    if (store && store.mode === "account") startGuest();
    return;
  }
  if (event !== "signed_in" || !session) return;
  if (store && store.mode === "account" && store.account().userId === session.userId) {
    // The same player again (a dead session renewed): carry on with the same camp and its queue.
    if (store.halted === "unauthorized") store.resume(session);
    return;
  }
  // A sign in here always switches. One from another tab only replaces another account, never a guest's camp.
  if (source === "local" || (store && store.mode === "account")) startAccount(session);
}

/* ================= 4. THE LOOP ================= */

let lastFrame = 0;

function frame() {
  lastFrame = now();
  const store = app.store;
  if (store) safely("store", () => store.frame());
  safely("router", () => app.router.update());
  safely("shell", () => app.shell.update());
  tickAll();
}

function startLoop() {
  // Painted frames when the tab is visible, about every 100ms.
  const onPaint = () => {
    requestAnimationFrame(onPaint);
    if (now() - lastFrame >= CLIENT.frameMs - 8) frame();
  };
  requestAnimationFrame(onPaint);
  // A hidden tab gets no paint callbacks; the interval keeps the store's timers and requests moving.
  setInterval(() => {
    if (now() - lastFrame >= CLIENT.frameMs * 2) frame();
  }, CLIENT.frameMs);

  document.addEventListener("visibilitychange", () => {
    const visible = document.visibilityState !== "hidden";
    if (app.store) app.store.setVisible(visible);
    if (visible) frame();
  });
  window.addEventListener("focus", () => {
    if (app.store) app.store.sync({ soft: true });
  });
  window.addEventListener("online", () => {
    if (app.store) app.store.sync();
  });
}

/* ================= 5. BOOT ================= */

async function loadPopups() {
  const results = await Promise.allSettled(POPUPS.map((file) => import(`./ui/popups/${file}.js`)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") return;
    const missing = r.reason instanceof TypeError && /dynamically imported|module script failed|fetch/i.test(String(r.reason.message));
    if (missing) console.warn(`popups/${POPUPS[i]}.js is not there yet`);
    else console.error(`popups/${POPUPS[i]}.js failed to load`, r.reason);
  });
}

async function boot() {
  app.net = createNet({
    supabase: CLIENT.supabaseConfigured ? supabaseGlobal() : null,
    url: CLIENT.supabaseUrl,
    key: CLIENT.supabaseKey,
    now: () => (app.store ? app.store.now() : Date.now()),
  });

  app.drawer = bindDrawer();
  app.ctx = makeCtx({ page: null, arg: null });
  Object.defineProperty(app.ctx, "route", { get: () => (app.router && app.router.current ? app.router.current.route : { page: null, arg: null }) });
  app.shell = createShell(app);
  app.router = createRouter({
    view: el("view"),
    getState: () => (app.store ? app.store.state : null),
    makeCtx,
    onRoute: ({ route, group, title, relabel }) => {
      app.shell.setCrumbs(group, title);
      if (relabel) return;
      if (app.store) app.store.watchParty(route.page === "party");
      if (app.drawer && app.drawer.isOpen()) app.drawer.close();
    },
  });
  app.listeners = createListeners({ ctx: app.ctx });

  if (CLIENT.debug) {
    window.__respite = {
      get store() { return app.store; },
      get net() { return app.net; },
      get ctx() { return app.ctx; },
      go: (hash) => app.go(hash),
      hasProgress,
    };
  }

  window.addEventListener("hashchange", () => app.router.render());
  app.net.onAuthChange(onAuth);

  await loadPopups();
  // A Discord redirect comes home with a ?code=: spend it before asking who is signed in.
  if (app.net.enabled && typeof app.net.finishOAuth === "function") await app.net.finishOAuth();
  const session = app.net.enabled ? await app.net.session() : null;
  if (session) startAccount(session);
  else startGuest();
  startLoop();

  // Every page module, once the first one is up: later visits open at once.
  setTimeout(() => app.router.preload(app.router.files()), 1500);
}

boot().catch((err) => {
  console.error("boot failed", err);
  toast("The camp would not wake. Reload to try again", { kind: "bad", ms: 0 });
});
