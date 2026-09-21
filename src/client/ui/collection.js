/* ============================================================
   Respite · ui/collection.js · What You Have Seen
   ------------------------------------------------------------
   The Collection, in four views: the monsters, the gear, the
   components, and everything at once. It is built from one map --
   the save's roll counters -- so the same panel draws your own
   camp's collection on the Character page and a stranger's on
   their commander page, off whatever the realm publishes.

     m:<monster>   felled, and how many times
     i:<base>      an item that has been in these hands

   Neither number means much on its own (an item's counts moves
   between pools as well as arrivals), so only the monsters show a
   count. Everything else is lit or locked, which is the whole
   point of a collection.

   An entry never seen is a name and a lock: no art, no numbers,
   nothing to open. What is in the world is the registry's word,
   so a line shelved behind `released: false` is not in here
   either -- the registry has already pruned it.
   ============================================================ */

import { h, on, setText, setAttr } from "./dom.js";
import { iconEl, artEl, hasArt } from "./icons.js";
import { fmt, fmtWhole } from "./format.js";
import { monsterArt } from "./popups/foe.js";
import { GameData, foesOf, sovereignOf, tierLabel } from "../../shared/registry.js";

/* ================= 1. WHAT THERE IS TO COLLECT ================= */

// Every foe in the world, region by region, the Sovereign last.
const BESTIARY = GameData.REGIONS.map((region) => ({
  region,
  mobs: foesOf(region.tier).filter(Boolean).concat([sovereignOf(region.tier)]).filter(Boolean),
}));
export const BESTIARY_COUNT = BESTIARY.reduce((n, r) => n + r.mobs.length, 0);

const byTier = (a, b) => (a.tier || 0) - (b.tier || 0) || String(a.name).localeCompare(String(b.name));

/* A line shelved behind `released: false` stays in GEAR so a save that somehow holds one
   still loads, but nothing shelved belongs in a collection: it cannot be got. */
const shelved = (g) => GameData.WEAPON_LINE_IDS.includes(g.line) && !GameData.LIVE_LINES.includes(g.line);

/* Grouped by the ground it comes from, the way the bestiary above it already is.
   A collector asks what Graveshelf makes, not to see every helm in the game at
   once: nine tiers of helms in one row is a list, not a collection. Inside a
   region the paperdoll's own slot order holds, so a set reads as a set.

   Reagents and the Veil belong to no ground and get their own groups; remedies
   are brewed rather than found, so they sit at the end of the same run. */
const SLOT_RANK = new Map(GameData.EQUIP_SLOTS.map((slot, i) => [slot, i]));
const bySlot = (a, b) => (SLOT_RANK.has(a.slot) ? SLOT_RANK.get(a.slot) : 99) - (SLOT_RANK.has(b.slot) ? SLOT_RANK.get(b.slot) : 99)
  || String(a.name).localeCompare(String(b.name));

// Raw before refined, trade by trade, then everything the bench builds out of them.
const CAT_RANK = new Map(["Ore", "Bars", "Timber", "Planks", "Fibre", "Weave", "Hides", "Leather", "Finds", "Inlays", "Component"]
  .map((c, i) => [c, i]));
const byCategory = (a, b) => (CAT_RANK.has(a.category) ? CAT_RANK.get(a.category) : 99) - (CAT_RANK.has(b.category) ? CAT_RANK.get(b.category) : 99)
  || (a.tier || 0) - (b.tier || 0) || String(a.name).localeCompare(String(b.name));

const groundName = (tier) => {
  const region = GameData.REGIONS.find((r) => r.tier === tier);
  return region ? `${region.name} · ${tierLabel(tier)}` : `Tier ${tier}`;
};

// Split items across their regions, tier by tier, dropping any ground with nothing on it.
function byGround(items, sort) {
  const by = new Map();
  items.forEach((d) => {
    const tier = Number(d.tier) || 0;
    if (!by.has(tier)) by.set(tier, []);
    by.get(tier).push(d);
  });
  return [...by.keys()].sort((a, b) => a - b)
    .map((tier) => ({ name: groundName(tier), items: by.get(tier).sort(sort) }))
    .filter((g) => g.items.length);
}

/* Gear and the tools beside it. A pick is a thing you own and has nowhere else to sit. */
const GEAR_GROUPS = byGround(
  Object.values(GameData.GEAR).filter((g) => !shelved(g)).concat(Object.values(GameData.TOOLS)),
  bySlot);

// Components, by the ground they come off, with what belongs to no ground after.
const PART_GROUPS = (() => {
  const all = Object.values(GameData.MATERIALS);
  const loose = (name, items) => (items.length ? [{ name, items: items.sort(byTier) }] : []);
  const reagents = all.filter((m) => m.reagent);
  const veil = all.filter((m) => m.category === "Veil");
  const remedies = all.filter((m) => m.heal > 0);
  const set = new Set([...reagents, ...veil, ...remedies]);
  return byGround(all.filter((m) => !set.has(m)), byCategory)
    .concat(loose("Reagents", reagents), loose("The Veil", veil), loose("Remedies", remedies));
})();

const GEAR_COUNT = GEAR_GROUPS.reduce((n, g) => n + g.items.length, 0);
const PART_COUNT = PART_GROUPS.reduce((n, g) => n + g.items.length, 0);

/* ================= 2. READING A ROLL MAP ================= */

const countOf = (rolls, key) => {
  const v = rolls && typeof rolls === "object" ? rolls[key] : 0;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};

export const felled = (rolls, monsterId) => countOf(rolls, `m:${monsterId}`);

/* The realm publishes a stranger's collection in its own shape (migration 011):
   { felled: { "<monster>": 12 }, found: ["<base>"] }. This turns it back into the roll
   map the panel reads, so one panel draws both your camp and theirs. */
export function rollsFromCollection(collection) {
  const out = {};
  const c = collection && typeof collection === "object" ? collection : {};
  const f = c.felled && typeof c.felled === "object" ? c.felled : {};
  Object.keys(f).forEach((id) => {
    const n = Number(f[id]);
    if (Number.isFinite(n) && n > 0) out[`m:${id}`] = Math.floor(n);
  });
  (Array.isArray(c.found) ? c.found : []).forEach((base) => {
    if (typeof base === "string" && base) out[`i:${base}`] = 1;
  });
  return out;
}

// How much of the bestiary has been put down, for the Record's one-line version of it.
export function bestiaryFound(rolls) {
  return BESTIARY.reduce((n, r) => n + r.mobs.filter((m) => felled(rolls, m.id)).length, 0);
}
export const found = (rolls, base) => countOf(rolls, `i:${base}`) > 0;

/* ================= 3. TILES ================= */

function foeTile(mob, kills, falls) {
  const sov = mob.archetype === "sovereign";
  if (!kills) {
    return h("div.foe-tile.is-locked", { class: { "is-sovereign": sov } },
      h("span.foe-art", { "aria-hidden": "true" }, iconEl("lock")),
      h("span.foe-tile-main",
        h("span.foe-tile-name", mob.name),
        // Greying alone says nothing to a reader who cannot see it.
        h("span.sr-only", "Not defeated yet")),
      sov ? h("span.tag.tag-sovereign", "Sovereign") : null);
  }
  const kind = sov ? "Sovereign" : GameData.ARCHETYPES[mob.archetype].name;
  const words = [kind, `Defeated ${fmt(kills)}`];
  if (falls) words.push(`Defeated by ${fmt(falls)}`);
  return h("button.foe-tile", { type: "button", class: { "is-sovereign": sov }, dataset: { monster: mob.id } },
    h("span.foe-art", { html: monsterArt(mob) }),
    h("span.foe-tile-main", h("span.foe-tile-name", mob.name), h("span.foe-tile-sub", words.join(" · "))),
    sov ? h("span.tag.tag-sovereign", "Sovereign") : null);
}

function itemTile(def, have) {
  const sub = def.kind === "gear"
    ? [GameData.SLOT_LABELS[def.slot], def.tier ? tierLabel(def.tier) : null]
    : [def.kind === "tool" ? "Tool" : def.category || "Material", def.tier ? tierLabel(def.tier) : null];
  if (!have) {
    return h("div.foe-tile.coll-tile.is-locked",
      h("span.foe-art.coll-art", { "aria-hidden": "true" }, iconEl("lock")),
      h("span.foe-tile-main",
        h("span.foe-tile-name", def.name),
        h("span.sr-only", "Never held")));
  }
  return h("button.foe-tile.coll-tile", { type: "button", dataset: { item: def.id } },
    // The cut, not the fade: a collection tile is a framed box, and a fade in a
    // frame is a smudge. Anything unpainted keeps its glyph.
    h("span.foe-art.coll-art", { class: { "art-paint": hasArt(def) }, "aria-hidden": "true" },
      artEl(def, { variant: "cut" })),
    h("span.foe-tile-main",
      h("span.foe-tile-name", def.name),
      h("span.foe-tile-sub", sub.filter(Boolean).join(" · "))));
}

/* ================= 4. THE PANEL ================= */

const VIEWS = [
  { id: "foes", name: "Monsters", icon: "skull" },
  { id: "gear", name: "Gear", icon: "plate" },
  { id: "parts", name: "Components", icon: "ore" },
  { id: "all", name: "Everything", icon: "crate" },
];

/**
 * collectionPanel({ onFoe, onItem, falls })
 *   onFoe(id)  a felled monster's tile was pressed (omit and tiles do not open)
 *   onItem(id) a held item's tile was pressed
 *   falls(id)  how many times that monster put YOU down, if the caller knows
 * Returns { node, paint(rolls), destroy() }.
 */
export function collectionPanel({ onFoe = null, onItem = null, falls = null } = {}) {
  let view = VIEWS[0].id;
  let rolls = null;
  let sig = null;

  const chip = h("span.chip");
  const tabs = h("div.char-tabs.coll-tabs", { role: "tablist", "aria-label": "Collection" },
    VIEWS.map((v) => h("button.chip", {
      type: "button", role: "tab", "aria-selected": "false", tabindex: "-1", dataset: { view: v.id },
    }, iconEl(v.icon), v.name)));
  const groups = h("div.char-bestiary");
  const node = h("section.section",
    h("div.section-head",
      h("div",
        h("h2.section-title", "Collection"),
        h("p.section-sub", "Everything in the world, and what you have met of it. What you have opens; what you have not stays a name.")),
      h("div.card-actions", chip)),
    tabs,
    groups);

  function group(name, tiles) {
    return h("div.skills-group", h("div.eyebrow", name), h("div.grid-cards", tiles));
  }

  function draw() {
    const r = rolls || {};
    let seen = 0;
    let all = 0;
    const parts = [];

    if (view === "foes" || view === "all") {
      BESTIARY.forEach(({ region, mobs }) => {
        parts.push(group(`${region.name} · ${tierLabel(region.tier)}`, mobs.map((mob) => {
          const kills = felled(r, mob.id);
          all++;
          if (kills) seen++;
          return foeTile(mob, kills, falls ? falls(mob.id) : 0);
        })));
      });
    }
    if (view === "gear" || view === "all") {
      GEAR_GROUPS.forEach((g) => {
        parts.push(group(g.name, g.items.map((def) => {
          const have = found(r, def.id);
          all++;
          if (have) seen++;
          return itemTile(def, have);
        })));
      });
    }
    if (view === "parts" || view === "all") {
      PART_GROUPS.forEach((g) => {
        parts.push(group(g.name, g.items.map((def) => {
          const have = found(r, def.id);
          all++;
          if (have) seen++;
          return itemTile(def, have);
        })));
      });
    }

    groups.replaceChildren(...parts);
    const word = view === "foes" ? "defeated" : view === "all" ? "collected" : "held";
    setText(chip, `${fmtWhole(seen)} of ${fmtWhole(all)} ${word}`);
  }

  function paintPick() {
    tabs.querySelectorAll("[role=tab]").forEach((t) => {
      const on2 = t.dataset.view === view;
      setAttr(t, "aria-selected", on2 ? "true" : "false");
      setAttr(t, "tabindex", on2 ? "0" : "-1");
    });
  }

  const offs = [
    on(tabs, "click", "[role=tab]", (e, t) => {
      if (t.dataset.view === view) return;
      view = t.dataset.view;
      sig = null;
      paintPick();
      draw();
    }),
    on(groups, "click", ".foe-tile[data-monster]", (e, b) => { if (onFoe) onFoe(b.dataset.monster); }),
    on(groups, "click", ".foe-tile[data-item]", (e, b) => { if (onItem) onItem(b.dataset.item); }),
  ];

  paintPick();

  return {
    node,
    // Redrawn only when something was met for the first time, or a count moved.
    paint(next) {
      rolls = next && typeof next === "object" ? next : {};
      const keys = Object.keys(rolls).filter((k) => k.charCodeAt(1) === 58 && (k[0] === "m" || k[0] === "i"));
      const nextSig = `${view}|${keys.length}|${keys.map((k) => `${k}${k[0] === "m" ? rolls[k] : ""}`).sort().join(",")}`;
      if (nextSig === sig) return;
      sig = nextSig;
      draw();
    },
    destroy() { offs.forEach((off) => off()); },
  };
}

export { GEAR_COUNT, PART_COUNT };
