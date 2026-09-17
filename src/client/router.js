/* ============================================================
   Respite · router.js · The Signpost
   ------------------------------------------------------------
   Hash routes to page modules. A page is loaded the first time
   it is asked for and kept; the page on screen gets update(ctx)
   every frame and its ctx subscriptions are released when it
   goes. A module that is missing or falls over leaves a card in
   its place, never a blank or a broken camp.
   ============================================================ */

import { h } from "./ui/dom.js";
import { iconEl } from "./ui/icons.js";
import { closeModals } from "./ui/overlay.js";
import { getSkill } from "../shared/registry.js";
import { requisitionsOpen } from "../shared/world.js";

/* ================= 1. ROUTES ================= */

export const DEFAULT_HASH = "#/character";

// Route page id -> [module file, breadcrumb group, title].
const PAGES = Object.freeze({
  character: ["character", "The Vanguard", "Character"],
  armaments: ["armaments", "The Vanguard", "Armaments"],
  companions: ["companions", "The Vanguard", "Companions"],
  stockpile: ["stockpile", "The Camp", "Stockpile"],
  bounties: ["bounties", "The Camp", "Bounties"],
  requisitions: ["requisitions", "The Camp", "Requisitions"],
  shop: ["shop", "The Camp", "Shop"],
  atlas: ["atlas", "The Realm", "Atlas"],
  market: ["market", "The Realm", "Market"],
  party: ["party", "The Realm", "Party"],
  hiscores: ["hiscores", "The Realm", "Hiscores"],
});

const KIND_GROUP = { gather: "Trades", craft: "Artisans", war: "The Field" };

// "#/skill/delving" -> { page: "skill", arg: "delving" }; anything unknown -> null.
export function parseHash(hash) {
  const parts = String(hash || "").replace(/^#\/?/, "").split("/");
  const page = parts[0];
  if (page === "skill") {
    const skill = getSkill(parts[1]);
    return skill ? { page: "skill", arg: skill.id } : null;
  }
  return Object.hasOwn(PAGES, page) ? { page, arg: null } : null;
}

export const hashOf = (route) => `#/${route.page}${route.arg ? `/${route.arg}` : ""}`;

// The Hunt shares #/skill/ with the benches but has a module of its own.
export function moduleOf(route) {
  if (route.page === "skill") return route.arg === "warfare" ? "hunt" : "skill";
  return PAGES[route.page][0];
}

function defaults(route) {
  if (route.page === "skill") {
    const skill = getSkill(route.arg);
    return { group: KIND_GROUP[skill.kind] || "Trades", title: skill.name };
  }
  const [, group, title] = PAGES[route.page];
  return { group, title };
}

// "Failed to fetch dynamically imported module" (Chrome), "Importing a module script failed" (Safari),
// "error loading dynamically imported module" (Firefox): the file is not there (yet).
const isMissing = (err) => err instanceof TypeError && /dynamically imported|module script failed|fetch/i.test(String(err.message));

/* ================= 2. THE ROUTER ================= */

/**
 * createRouter({ view, getState, makeCtx, onRoute, loadPage })
 *   view      #view
 *   getState  () => the predicted save or null (null: the camp is still waking)
 *   makeCtx   (route) => ctx with _tick() and _release()
 *   onRoute   ({ route, group, title, page }) after each mount
 *   loadPage  (file) => import(), injectable
 */
export function createRouter({ view, getState, makeCtx, onRoute = () => {}, loadPage = (file) => import(`./pages/${file}.js`) }) {
  const modules = new Map();    // file -> Promise<{ page, error }>
  const settled = new Map();    // file -> { page, error } once known
  let current = null;           // { route, file, page, handle, ctx, erred, titleAt }
  let token = 0;

  function load(file) {
    if (!modules.has(file)) {
      const p = Promise.resolve()
        .then(() => loadPage(file))
        .then((mod) => {
          const page = mod && mod.default && typeof mod.default.mount === "function" ? mod.default : null;
          return { page, error: page ? null : new Error(`pages/${file}.js has no default export with mount()`) };
        }, (error) => ({ page: null, error }))
        .then((result) => {
          settled.set(file, result);
          if (result.error) {
            if (isMissing(result.error)) console.warn(`router: pages/${file}.js is not there yet`);
            else console.error(`router: pages/${file}.js failed to load`, result.error);
          }
          return result;
        });
      modules.set(file, p);
    }
    return modules.get(file);
  }

  function safeVisible(page, ctx) {
    if (!page || typeof page.visible !== "function") return true;
    try {
      return page.visible(ctx) !== false;
    } catch (err) {
      console.error("router: visible() failed", err);
      return true;
    }
  }

  // Closed features are not routes either: a stale link or a reset camp lands on Character.
  function allowed(route, page, ctx) {
    const state = getState();
    if (route.page === "requisitions" && state && !requisitionsOpen(state)) return false;
    return safeVisible(page, ctx);
  }

  function redirect() {
    if (location.hash === DEFAULT_HASH) return false;
    location.replace(DEFAULT_HASH);
    return true;
  }

  function release() {
    if (!current) return;
    const { handle, ctx, file } = current;
    current = null;
    if (handle && typeof handle.unmount === "function") {
      try {
        handle.unmount();
      } catch (err) {
        console.error(`router: pages/${file}.js unmount failed`, err);
      }
    }
    if (ctx && ctx._release) ctx._release();
  }

  function card(route, { title, group }, missing) {
    const home = route.page === "character" ? null : h("a.btn.btn-sm", { href: DEFAULT_HASH }, "Back to Character");
    return h("div.page",
      h("header.page-head",
        h("div",
          h("div.eyebrow.page-eyebrow", group),
          h("h1.page-title", title))),
      h("section.card",
        h("div.empty",
          h("div.empty-art", iconEl(missing ? "hammer" : "alert")),
          h("div.empty-title", missing ? "This page is still being built" : "This page fell over"),
          h("p.empty-text", missing
            ? "The camp carries on without it. Try another page for now."
            : "Something in it broke. The rest of the camp is fine."),
          home)));
  }

  function labels(route, page, ctx) {
    const base = defaults(route);
    const read = (v, fallback) => {
      try {
        const out = typeof v === "function" ? v(ctx) : v;
        return typeof out === "string" && out ? out : fallback;
      } catch (err) {
        return fallback;
      }
    };
    return { group: read(page && page.group, base.group), title: read(page && page.title, base.title) };
  }

  async function render({ focus = true } = {}) {
    if (!getState()) return;
    const route = parseHash(location.hash);
    if (!route) {
      if (redirect()) return;
    }
    const target = route || { page: "character", arg: null };
    const file = moduleOf(target);
    const my = ++token;
    // Dialogs belong to the page they were opened on.
    closeModals("route");
    const result = await load(file);
    if (my !== token || !getState()) return;

    release();
    let ctx = makeCtx(target);
    if (result.page && !allowed(target, result.page, ctx)) {
      ctx._release();
      if (redirect()) return;
      ctx = makeCtx(target);
    }

    view.replaceChildren();
    let handle = null;
    let page = result.page;
    if (page) {
      try {
        handle = page.mount(view, ctx) || {};
      } catch (err) {
        console.error(`router: pages/${file}.js mount failed`, err);
        ctx._release();
        page = null;
      }
    }
    const names = labels(target, page, ctx);
    if (!page) {
      view.replaceChildren(card(target, names, !result.page && isMissing(result.error)));
      handle = {};
    }
    current = { route: target, file, page, handle, ctx, erred: false, titleAt: 0 };
    lastLabels = `${names.group}|${names.title}`;
    document.title = `${names.title} · Respite`;
    onRoute({ route: target, group: names.group, title: names.title, page });
    if (focus) {
      view.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  let lastLabels = "";

  function update() {
    if (!current) return;
    const { page, handle, ctx, route, file } = current;
    if (page && handle && typeof handle.update === "function") {
      try {
        handle.update(ctx);
      } catch (err) {
        // Once per mount: a page that throws every frame would bury the console.
        if (!current.erred) console.error(`router: pages/${file}.js update failed`, err);
        current.erred = true;
      }
    }
    // Titles that follow the save, and features that close under a page, checked about once a second.
    const t = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (current && t - current.titleAt > 1000) {
      current.titleAt = t;
      if (page && !allowed(route, page, ctx)) {
        redirect();
        return;
      }
      const names = labels(route, page, ctx);
      const sig = `${names.group}|${names.title}`;
      if (sig !== lastLabels) {
        lastLabels = sig;
        document.title = `${names.title} · Respite`;
        onRoute({ route, group: names.group, title: names.title, page, relabel: true });
      }
    }
  }

  // The store changed under the page (signing in or out): tear down and wait for a camp.
  function unmount() {
    token++;
    release();
    closeModals("route");
  }

  return {
    render,
    update,
    unmount,
    tick() {
      if (current && current.ctx && current.ctx._tick) current.ctx._tick();
    },
    get current() { return current; },
    // For the nav: a loaded page may hide itself with visible(ctx) === false.
    hides(route, ctx) {
      const known = settled.get(moduleOf(route));
      return !!(known && known.page && !safeVisible(known.page, ctx));
    },
    preload(files) {
      files.forEach((f) => load(f));
    },
    files: () => [...new Set([...Object.values(PAGES).map((p) => p[0]), "skill", "hunt"])],
  };
}
