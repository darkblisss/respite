/* ============================================================
   Respite · pages/player.js · A Commander, Looked At
   ------------------------------------------------------------
   #/player/<name>: any commander in the realm, as the realm sees
   them. Reached by clicking a name on a board or a party roster.

   A fixed banner that does not move between tabs -- their face,
   their name, their discipline, the ground they stand on, when
   they were last about, and their total level -- and the panels
   under it:

     Standing   the Satchel's own paperdoll, worn by them, with
                what it comes to beside it
     Skills     every skill at a glance, and the total
     Collection what they have met of the world, in the same
                panel the Character page draws

   Everything comes off player_profile() in one call (migration
   009). Item keys arrive raw and every name, stat and rarity is
   read off them here by the same registry the save uses, so the
   realm never has an opinion about what a piece is worth.

   A realm that has not run 009 has no such function; the page
   says so plainly rather than looking broken.
   ============================================================ */

import { h, on, setText, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { fmtWhole, fmtAgo, fmtStat } from "../ui/format.js";
import { openPopup, portraitImg, paintPortrait } from "../ui/widgets.js";
import { paintDoll } from "./armaments.js";
import { auraNode, paintAura, haloTag, avatarHaloNode, paintAvatarHalo } from "../ui/halo.js";
import { collectionPanel, rollsFromCollection } from "../ui/collection.js";
import { CONFIG } from "../../shared/config.js";
import { SKILL_ORDER, getSkill, getClass, getRegion, getZone, getSkin } from "../../shared/registry.js";
import { combatStats } from "../../shared/stats.js";
import { wornHalo } from "../../shared/items.js";

const ASK_MS = 15 * 1000;
const pct = (x) => `${+((Number(x) || 0) * 100).toFixed(1)}%`;

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
  const bust = h("div.portrait.portrait-bust.char-portrait");
  const avatarHalo = avatarHaloNode();
  const name = h("h1.char-name");
  const tags = h("div.chip-row.char-tags");
  const total = h("span.char-total-v");
  const node = h("section.char-hero.pp-head",
    h("div.char-portrait-wrap", avatarHalo, bust),
    h("div", h("div.eyebrow.page-eyebrow", "The Realm"), name, tags),
    h("div.char-total", total, h("span.eyebrow", "Total level")));
  let sig = null;

  return {
    node,
    paint(row) {
      setText(total, fmtWhole(row.total_level || 0));
      const skin = row.skin ? getSkin(row.skin) : null;
      const klass = row.discipline ? getClass(row.discipline) : null;
      const region = row.region ? getRegion(row.region) : null;
      const hunting = row.hunting && typeof row.hunting === "object" ? row.hunting : null;
      const seen = row.last_seen ? Date.parse(row.last_seen) : 0;

      setText(name, display(row.username));

      const halo = wornHalo(row.equipment && typeof row.equipment === "object" ? row.equipment : {});
      const next = [row.skin || "-", klass ? klass.id : "-", region ? region.id : "-", hunting ? `${hunting.tier}:${hunting.zone}` : "-", seen, halo ? halo.id : "-"].join("|");
      if (next === sig) return;
      sig = next;

      bust.replaceChildren(portraitImg(row.skin || null));
      paintAvatarHalo(avatarHalo, halo);
      tags.replaceChildren(...[
        skin ? h("span.tag", skin.name) : null,
        klass ? h("span.tag.tag-violet", klass.name) : h("span.tag", "Undisciplined"),
        haloTag(halo),
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
  const left = h("div.doll-col");
  const right = h("div.doll-col");
  const bust = h("div.portrait", portraitImg(null));
  const aura = auraNode();
  const dollName = h("div.doll-name");
  const dollSub = h("div.doll-sub");
  const dollTags = h("div.chip-row.doll-tags", { hidden: true });
  const chips = h("div.card-actions");
  const stats = h("div.stats");
  let skinSig = null;
  let haloSig = null;

  const doll = h("section.card",
    h("div.card-head", h("div", h("h2.card-title", "Worn")), chips),
    h("div.doll", left, h("div.doll-figure", h("div.figure-wrap", aura, bust), dollName, dollSub, dollTags), right));

  const standing = h("section.card",
    h("div.card-head", h("div",
      h("h2.card-title", "Standing"),
      h("p.card-sub", "What the gear and the discipline come to. A path and a weapon's hours are their own and are not counted here."))),
    stats);

  const node = h("div.char-face", doll, standing);

  // A piece on someone else's back opens the same sheet it would on yours, read only.
  on(doll, "click", "button.doll-slot[data-key]", (e, b) => openPopup("item", ctx, b.dataset.key, { readOnly: true }));

  return {
    node,
    paint(row) {
      const eq = row.equipment && typeof row.equipment === "object" ? row.equipment : {};
      const klass = row.discipline ? getClass(row.discipline) : null;
      const region = row.region ? getRegion(row.region) : null;

      paintDoll(left, right, eq);
      doll.querySelectorAll("button.doll-slot[data-key]").forEach((b) => {
        setAttr(b, "aria-label", `${b.dataset.label}: ${b.dataset.name}`);
      });
      skinSig = paintPortrait(bust, row.skin || null, skinSig);
      const halo = wornHalo(eq);
      if ((halo ? halo.id : "") !== haloSig) {
        haloSig = halo ? halo.id : "";
        paintAura(aura, halo);
        dollTags.replaceChildren(haloTag(halo));
        dollTags.hidden = !halo;
      }
      setText(dollName, display(row.username));
      setText(dollSub, [klass && klass.name, region && region.name].filter(Boolean).join(" \u00b7 "));
      chips.replaceChildren(klass ? h("span.chip.chip-violet", klass.name) : h("span.chip", "Undisciplined"));

      const st = row.stats && typeof row.stats === "object" ? row.stats : {};
      const c = sheetOf(row);
      stats.replaceChildren(...[
        klass && ["Discipline", klass.name, "good"],
        ["Health", fmtStat(c.maxHp)],
        ["Attack", fmtStat(c.attack), "gold"],
        ["Defence", fmtStat(c.defence)],
        ["Attack speed", `${(c.speed / 1000).toFixed(1)}s`],
        ["Crit Chance", pct(c.crit)],
        ["Crit Damage", pct(c.critDmg)],
        ["Penetration", pct(c.pen)],
        ["Hunt", `Lv ${Math.max(1, numbersOf(row.levels, "warfare") || 1)}`, "good"],
        ["Kills", fmtWhole(numbersOf(st, "kills"))],
        ["Sovereigns felled", fmtWhole(numbersOf(st, "bosses"))],
        ["Falls", fmtWhole(numbersOf(st, "deaths"))],
      ].filter(Boolean).map(([l, v, tone]) =>
        h("div.stat", h("span.l", l), h("span.v", { class: tone && `t-${tone}` }, v))));
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

/* ================= 4. COLLECTION ================= */

/* Their bestiary and their ledger of things, drawn by the same panel the Character
   page uses. The realm publishes no record of who put THEM down, so no "Defeated by"
   line appears here -- which is right: that is your camp's business, not a stranger's. */
function collectionView(ctx) {
  const panel = collectionPanel({
    onFoe: (id) => openPopup("foe", ctx, id),
    onItem: (id) => openPopup("item", ctx, id, { from: null, readOnly: true }),
  });
  return {
    node: panel.node,
    paint(row) { panel.paint(rollsFromCollection(row.collection)); },
  };
}

/* ================= 5. THE PAGE ================= */

const TABS = [
  { id: "standing", name: "Standing", icon: "plate", build: standingView },
  { id: "skills", name: "Skills", icon: "book", build: skillsView },
  { id: "collection", name: "Collection", icon: "skull", build: collectionView },
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
