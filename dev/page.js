/* ============================================================
   Respite · dev/page.js · The Rehearsal
   ------------------------------------------------------------
   Mounts one page on a stub save inside the real shell markup:
     dev/page.html?page=character&scenario=midgame
     dev/page.html?page=skill&arg=forgemaster&scenario=crafter
     dev/page.html?page=market&mode=account&party=1
     dev/page.html?page=stockpile&popup=item&args=["bog_bar","bank"]
     dev/page.html?page=skill&arg=warfare&scenario=hunter&party=1&crowd=150
   The shell itself (topbar, nav) stays empty: it belongs to main.js.
   ============================================================ */

import { createStubStore, createCtx, buildScenario, sampleParty } from "./stub.js";
import { toast } from "../src/client/ui/overlay.js";
import { openPopup } from "../src/client/ui/widgets.js";

const q = new URLSearchParams(location.search);
const pageId = q.get("page") || "character";
const arg = q.get("arg");
const mode = q.get("mode") || "account";
const now = Date.now();

// Route id -> module, exactly as CLIENT.md's route table.
const PAGE_FILES = {
  character: "character", armaments: "armaments", stockpile: "stockpile", companions: "companions",
  bounties: "bounties", requisitions: "requisitions", shop: "shop", atlas: "atlas",
  market: "market", party: "party", hiscores: "hiscores",
};
const POPUP_FILES = ["item", "action", "zone", "foe", "class", "sell", "settings", "sky"];

async function boot() {
  const state = buildScenario(q.get("scenario") || "midgame", now);
  const party = q.get("party") ? sampleParty(now) : null;
  const store = createStubStore({ state, mode, party, crowd: Number(q.get("crowd")) || 0 });
  const route = { page: pageId, arg };
  const ctx = createCtx(store, { route });
  window.__respite = { store, ctx };

  await Promise.allSettled(POPUP_FILES.map((f) => import(`../src/client/ui/popups/${f}.js`)));

  const file = pageId === "skill" ? (arg === "warfare" ? "hunt" : "skill") : PAGE_FILES[pageId];
  if (!file) throw new Error(`No page called ${pageId}`);
  const mod = await import(`../src/client/pages/${file}.js`);
  const page = mod.default;
  const view = document.getElementById("view");
  view.replaceChildren();
  const mounted = page.mount(view, ctx) || {};
  const update = () => { ctx._tick(); if (mounted.update) mounted.update(ctx); };
  ctx.onTick(() => { if (mounted.update) mounted.update(ctx); });
  update();
  if (!q.get("still")) setInterval(() => ctx._tick(), 100);

  const popup = q.get("popup");
  if (popup) openPopup(popup, ctx, ...JSON.parse(q.get("args") || "[]"));
}

boot().catch((e) => {
  console.error(e);
  toast(`Runner: ${e.message}`, { kind: "bad", ms: 0 });
});
