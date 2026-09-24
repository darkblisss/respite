/* ============================================================
   Respite · pages/player.js · A Commander, Looked At
   ------------------------------------------------------------
   #/player/<name>: any commander in the realm, as the realm sees
   them. Reached by clicking a name on a board or a party roster.

   One card: at the side their face, name, discipline, the ground
   they stand on, and their total and Hunt levels, then what their
   gear comes to; beside it the tabs:

     Standing   the Satchel's own paperdoll, worn by them, with
                what it comes to at the side
     Skills     every skill at a glance, and the total
     Collection what they have met of the world

   All of it is the profile card (ui/profile.js); this page only
   turns the realm's row into the card's model. Looking yourself up reads your own save for the
   skills and the collection, which the realm only has a copy of.

   Everything comes off player_profile() in one call (migration
   009). Item keys arrive raw and every name, stat and rarity is
   read off them here by the same registry the save uses, so the
   realm never has an opinion about what a piece is worth.

   A realm that has not run 009 has no such function; the page
   says so plainly rather than looking broken.
   ============================================================ */

import { h } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { openPopup } from "../ui/widgets.js";
import { rollsFromCollection } from "../ui/collection.js";
import { profileView, sheetFrom } from "../ui/profile.js";
import { CONFIG } from "../../shared/config.js";
import { SKILL_ORDER, getClass, getRegion } from "../../shared/registry.js";
import { combatStats, xpProgress } from "../../shared/stats.js";
import { wornHalos } from "../../shared/items.js";

const ASK_MS = 15 * 1000;

const display = (name) => {
  const s = String(name == null ? "" : name);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Someone";
};

const numbersOf = (obj, key) => {
  const v = obj && typeof obj === "object" ? obj[key] : null;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

/* The stat sheet their gear and level come to. Their path and their mastery are
   theirs and are not published, so this is what the gear and the discipline are
   worth on their own -- which is the honest thing to show a stranger anyway. */
function sheetOf(row) {
  const levels = row.levels && typeof row.levels === "object" ? row.levels : {};
  const warfare = numbersOf(levels, "warfare") || 1;
  return combatStats({ level: warfare, klass: row.discipline, equipment: row.equipment || {} });
}

/* ================= 1. THEIR ROW, AS THE CARD'S MODEL ================= */

function modelOf(row, ctx) {
  const eq = row.equipment && typeof row.equipment === "object" ? row.equipment : {};
  const klass = row.discipline ? getClass(row.discipline) : null;
  const levels = row.levels && typeof row.levels === "object" ? row.levels : {};
  // Your own page: the skills and the collection off your save, which is the real one.
  const own = !!(ctx.account && ctx.account.username && String(ctx.account.username).toLowerCase() === String(row.username || "").toLowerCase());
  const skills = {};
  SKILL_ORDER.forEach((id) => {
    if (own) {
      const p = xpProgress(ctx.state, id);
      skills[id] = { level: p.level, pct: p.pct, toNext: p.toNext, maxed: p.maxed };
    } else {
      skills[id] = { level: Math.max(1, Math.min(CONFIG.progression.maxLevel, Math.floor(numbersOf(levels, id)) || 1)), pct: null };
    }
  });
  return {
    name: display(row.username),
    eyebrow: "The Realm",
    skin: row.skin || null,
    klass,
    region: row.region ? getRegion(row.region) : null,
    halos: wornHalos(eq),
    extraTags: [],
    total: row.total_level || 0,
    hunt: skills.warfare.level,
    sheet: sheetFrom(sheetOf(row), klass),
    equipment: eq,
    skills,
    rolls: own ? ctx.state.rolls : rollsFromCollection(row.collection),
  };
}

export default {
  id: "player",
  group: "The Realm",
  title: (ctx) => display(ctx.route && ctx.route.arg),

  mount(view, ctx) {
    const who = (ctx.route && ctx.route.arg) || "";
    let alive = true;
    let row = null;

    // A piece on someone else's back opens the same sheet it would on yours, read only.
    const card = profileView({
      key: "other",
      onSlot: (key) => openPopup("item", ctx, key, { readOnly: true }),
      onEntry: (entry) => openPopup("entry", ctx, entry),
    });
    const body = h("div");
    card.node.hidden = true;
    view.appendChild(h("div.page", card.node, body));

    function state(icon, title, text, extra = null) {
      body.replaceChildren(h("section.card",
        h("div.empty", h("div.empty-art", iconEl(icon)), h("div.empty-title", title), h("p.empty-text", text), extra)));
    }

    function show() {
      card.node.hidden = false;
      body.replaceChildren();
      card.paint(modelOf(row, ctx), ctx);
    }

    async function load() {
      if (ctx.account.mode === "guest") {
        state("lock", "Sign in to look anyone up", "A commander's page is the realm's, and the realm only answers a name it knows.",
          h("div.btn-row", h("button.btn.btn-gold", { type: "button", onClick: () => openPopup("account", ctx, { mode: "create" }) }, "Create account")));
        return;
      }
      if (typeof ctx.net.playerProfile !== "function") {
        state("hourglass", "Not kept yet", "This realm does not keep commander pages, so there is nothing to show here.");
        return;
      }
      state("person", "Looking them up", `Asking the realm about ${display(who)}.`);
      let res;
      try {
        res = await Promise.race([
          ctx.net.playerProfile(who),
          new Promise((resolve) => setTimeout(() => resolve({ row: null, error: "The realm is slow to answer." }), ASK_MS)),
        ]);
      } catch (err) {
        res = { row: null, error: String(err && err.message) };
      }
      if (!alive) return;
      if (res.missing) {
        state("hourglass", "Not kept yet", "This realm does not keep commander pages, so there is nothing to show here.");
        return;
      }
      if (res.error) {
        state("alert", "The realm did not answer", res.error, h("button.btn.btn-sm", { type: "button", onClick: load }, "Try again"));
        return;
      }
      if (!res.row) {
        state("search", "No such commander", `Nobody in the realm answers to ${display(who)}.`,
          h("a.btn.btn-sm", { href: "#/hiscores" }, "Back to the Leaderboard"));
        return;
      }
      row = res.row;
      show();
    }

    load();
    return {
      unmount() {
        alive = false;
        card.destroy();
      },
    };
  },
};
