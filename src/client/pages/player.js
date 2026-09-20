/* ============================================================
   Respite · pages/player.js · A Commander, Looked At
   ------------------------------------------------------------
   #/player/<name>: any commander in the realm, as the realm sees
   them. Reached by clicking a name on a board or a party roster.

   A fixed head that does not move between tabs -- their skin,
   their name, their discipline, the ground they stand on, and
   when they were last about -- and two panels under it:

     Standing   what they are wearing and what it makes of them
     Skills     every skill at a glance, and the total

   Everything comes off player_profile() in one call (migration
   009). Item keys arrive raw and every name, stat and rarity is
   read off them here by the same registry the save uses, so the
   realm never has an opinion about what a piece is worth.

   A realm that has not run 009 has no such function; the page
   says so plainly rather than looking broken.
   ============================================================ */

import { h, on, setText, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { fmt, fmtWhole, fmtAgo, fmtStat } from "../ui/format.js";
import { openPopup, portraitImg } from "../ui/widgets.js";
import { CONFIG } from "../../shared/config.js";
import { GameData, SKILL_ORDER, getSkill, getClass, getRegion, getZone, getSkin } from "../../shared/registry.js";
import { itemDef, itemName, rarityName } from "../../shared/items.js";
import { combatStats } from "../../shared/stats.js";

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

/* ================= 1. THE HEAD ================= */

function headView() {
  const bust = h("div.portrait.portrait-bust.pp-bust");
  const name = h("h1.page-title.pp-name");
  const tags = h("div.chip-row.pp-tags");
  const node = h("section.char-hero.pp-head", bust, h("div", h("div.eyebrow.page-eyebrow", "The Realm"), name, tags));
  let sig = null;

  return {
    node,
    paint(row) {
      const skin = row.skin ? getSkin(row.skin) : null;
      const klass = row.discipline ? getClass(row.discipline) : null;
      const region = row.region ? getRegion(row.region) : null;
      const hunting = row.hunting && typeof row.hunting === "object" ? row.hunting : null;
      const seen = row.last_seen ? Date.parse(row.last_seen) : 0;

      setText(name, display(row.username));

      const next = [row.skin || "-", klass ? klass.id : "-", region ? region.id : "-", hunting ? `${hunting.tier}:${hunting.zone}` : "-", seen].join("|");
      if (next === sig) return;
      sig = next;

      bust.replaceChildren(portraitImg(row.skin || null));
      tags.replaceChildren(...[
        skin ? h("span.tag", skin.name) : null,
        klass ? h("span.tag.tag-violet", klass.name) : h("span.tag", "Undisciplined"),
        h("span.chip", iconEl("atlas"), region ? region.name : "Somewhere"),
        /* Out on a hunt is worth saying in the present tense; otherwise how long
           since the realm last heard from them, which is what a stranger wants. */
        hunting
          ? h("span.chip.chip-ember", iconEl("swords"), `Hunting the ${getZone(hunting.zone).name}`)
          : seen
            ? h("span.chip", iconEl("clock"), `Last about ${fmtAgo(Date.now() - seen)}`)
            : null,
      ].filter(Boolean));
    },
  };
}

/* ================= 2. STANDING ================= */

function standingView(ctx) {
  const slots = h("div.slot-grid.pp-slots");
  const stats = h("div.stats.pp-stats");
  const node = h("div",
    h("section.card",
      h("div.card-head", h("div", h("h2.card-title", "Worn"), h("p.card-sub", "What they carry, and what it is."))),
      slots),
    h("section.card.mt-4",
      h("div.card-head", h("div", h("h2.card-title", "Standing"), h("p.card-sub", "What the gear and the discipline come to. A path and a weapon's hours are their own business and are not counted here."))),
      stats));

  // An item on someone else's back opens the same dialog it would on yours, read only.
  on(slots, "click", "button[data-key]", (e, b) => openPopup("item", ctx, b.dataset.key, { readOnly: true }));

  return {
    node,
    paint(row) {
      const eq = row.equipment && typeof row.equipment === "object" ? row.equipment : {};
      slots.replaceChildren(...GameData.EQUIP_SLOTS.map((slot) => {
        const key = typeof eq[slot] === "string" ? eq[slot] : null;
        const d = key ? itemDef(key) : null;
        const label = GameData.SLOT_LABELS[slot];
        if (!d) {
          return h("div.slot.is-empty", { "data-tip": `${label}: empty` },
            h("span.slot-art", iconEl(GameData.SLOT_GLYPHS[slot])),
            h("span.slot-name", label));
        }
        return h("button.slot", {
          type: "button", "data-rarity": d.rarity || "common", dataset: { key },
          "data-tip": `${itemName(key)} · ${rarityName(key)} ${label.toLowerCase()}`,
        },
          h("span.slot-art", iconEl(d.icon)),
          h("span.slot-name", itemName(key)));
      }));

      const s = sheetOf(row);
      const st = row.stats && typeof row.stats === "object" ? row.stats : {};
      stats.replaceChildren(...[
        ["Health", fmtStat(s.maxHp)],
        ["Attack", fmtStat(s.attack)],
        ["Defence", fmtStat(s.defence)],
        ["Swing", `${(s.speed / 1000).toFixed(1)}s`],
        ["Crit", `${Math.round(s.crit * 100)}%`],
        ["Kills", fmtWhole(numbersOf(st, "kills"))],
        ["Sovereigns felled", fmtWhole(numbersOf(st, "bosses"))],
        ["Falls", fmtWhole(numbersOf(st, "deaths"))],
      ].map(([k, v]) => h("div.stat", h("span.eyebrow", k), h("b", v))));
    },
  };
}

/* ================= 3. SKILLS ================= */

function skillsView() {
  const grid = h("div.skills-grid");
  const total = h("b");
  const node = h("section.card",
    h("div.card-head",
      h("div", h("h2.card-title", "Skills"), h("p.card-sub", "Every trade, bench and the Hunt.")),
      h("div.card-actions", h("span.chip.chip-gold", iconEl("trophy"), total))),
    grid);

  return {
    node,
    paint(row) {
      const levels = row.levels && typeof row.levels === "object" ? row.levels : {};
      setText(total, `Total ${fmtWhole(row.total_level || 0)}`);
      grid.replaceChildren(...SKILL_ORDER.map((id) => {
        const def = getSkill(id);
        const lvl = Math.max(1, Math.min(CONFIG.progression.maxLevel, Math.floor(numbersOf(levels, id)) || 1));
        return h("div.skill-card",
          h("div.skill-main",
            h("span.art.art-sm", { "aria-hidden": "true" }, iconEl(def.icon)),
            h("div", h("div.skill-name", def.name), h("div.skill-xp", `Level ${lvl}`))),
          h("span.skill-lv", fmtWhole(lvl)));
      }));
    },
  };
}

/* ================= 4. THE PAGE ================= */

const TABS = [
  { id: "standing", name: "Standing", icon: "plate", build: standingView },
  { id: "skills", name: "Skills", icon: "book", build: skillsView },
];

export default {
  id: "player",
  group: "The Realm",
  title: (ctx) => display(ctx.route && ctx.route.arg),

  mount(view, ctx) {
    const who = (ctx.route && ctx.route.arg) || "";
    let tab = TABS[0].id;
    let alive = true;
    let row = null;

    const head = headView();
    const body = h("div");
    const row2 = h("div.char-tabs", { role: "tablist", "aria-label": "Commander" },
      TABS.map((t) => h("button.chip", {
        type: "button", role: "tab", "aria-selected": "false", tabindex: "-1", dataset: { tab: t.id },
      }, iconEl(t.icon), t.name)));

    const panels = TABS.map((t) => {
      const part = t.build(ctx);
      part.wrap = h("div", { role: "tabpanel", hidden: true }, part.node);
      return part;
    });

    const page = h("div.page", head.node, row2, ...panels.map((p) => p.wrap), body);
    view.appendChild(page);
    setAttr(head.node, "hidden", true);
    setAttr(row2, "hidden", true);

    function paintPick() {
      row2.querySelectorAll("[role=tab]").forEach((t) => {
        const picked = t.dataset.tab === tab;
        setAttr(t, "aria-selected", picked ? "true" : "false");
        setAttr(t, "tabindex", picked ? "0" : "-1");
      });
      panels.forEach((p, i) => setAttr(p.wrap, "hidden", TABS[i].id !== tab));
    }

    const off = on(row2, "click", "[role=tab]", (e, t) => {
      if (t.dataset.tab === tab) return;
      tab = t.dataset.tab;
      paintPick();
    });

    function state(icon, title, text, extra = null) {
      body.replaceChildren(h("section.card",
        h("div.empty", h("div.empty-art", iconEl(icon)), h("div.empty-title", title), h("p.empty-text", text), extra)));
    }

    function show() {
      setAttr(head.node, "hidden", false);
      setAttr(row2, "hidden", false);
      body.replaceChildren();
      head.paint(row);
      panels.forEach((p) => p.paint(row));
      paintPick();
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
        off();
      },
    };
  },
};
