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
  return region ? region.name : `Tier ${tier}`;
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

/* ================= 3. WHAT THE TABS HOLD ================= */

/* Three rows narrow the grid: what kind of thing (items or monsters), what sort
   of item, and which ground it comes off. Every row carries its own count, so
   the shape of what is left to find is readable without opening anything. */

const MATS = Object.values(GameData.MATERIALS);
const isVeil = (m) => m.category === "Veil";
const isRemedy = (m) => m.heal > 0;
const isReagent = (m) => !!m.reagent && !isVeil(m) && !isRemedy(m);
const plainMat = (m) => !isVeil(m) && !isRemedy(m) && !isReagent(m);

const loose = (name, items, sort = byTier) => (items.length ? [{ name, items: items.slice().sort(sort) }] : []);

const KINDS = [
  { id: "gear", name: "Equipment", icon: "plate",
    groups: byGround(Object.values(GameData.GEAR).filter((g) => !shelved(g)), bySlot) },
  { id: "parts", name: "Resources", icon: "ore",
    groups: byGround(MATS.filter(plainMat), byCategory) },
  { id: "reagents", name: "Reagents", icon: "flask",
    groups: loose("Reagents", MATS.filter(isReagent)) },
  { id: "veil", name: "The Veil", icon: "sparkle",
    groups: loose("The Veil", MATS.filter(isVeil)) },
  { id: "remedies", name: "Remedies", icon: "potion",
    groups: loose("Remedies", MATS.filter(isRemedy)) },
  { id: "tools", name: "Tools", icon: "pick",
    groups: byGround(Object.values(GameData.TOOLS), bySlot) },
].filter((k) => k.groups.length);

KINDS.forEach((k) => { k.count = k.groups.reduce((n, g) => n + g.items.length, 0); });

const ITEM_COUNT = KINDS.reduce((n, k) => n + k.count, 0);
const GEAR_COUNT = (KINDS.find((k) => k.id === "gear") || { count: 0 }).count;
const PART_COUNT = (KINDS.find((k) => k.id === "parts") || { count: 0 }).count;

// The bestiary in the same shape, so one drawing routine serves both tabs.
const FOE_GROUPS = BESTIARY.map(({ region, mobs }) => ({ name: region.name, items: mobs }));

/* ================= 4. TILES ================= */

// A square of art with its name under it: dense enough to read a whole ground at once.
function tile(def, { have, kind, sub, sov }) {
  const name = h("span.coll-name", def.name);
  if (!have) {
    return h("div.coll-cell.is-locked", { title: def.name },
      h("span.coll-box", { "aria-hidden": "true" }, iconEl("lock")),
      name,
      h("span.sr-only", kind === "foe" ? "Not defeated yet" : "Never held"));
  }
  const art = kind === "foe"
    ? h("span.coll-box", { html: monsterArt(def) })
    : h("span.coll-box", { class: { "art-paint": hasArt(def) }, "aria-hidden": "true" }, artEl(def, { variant: "cut" }));
  return h("button.coll-cell", {
    type: "button",
    title: sub ? `${def.name} · ${sub}` : def.name,
    class: { "is-sovereign": !!sov },
    dataset: kind === "foe" ? { monster: def.id } : { item: def.id },
  }, art, name);
}

function foeCell(mob, kills, falls) {
  const sov = mob.archetype === "sovereign";
  const words = kills
    ? [sov ? "Sovereign" : GameData.ARCHETYPES[mob.archetype].name, `Defeated ${fmt(kills)}`]
      .concat(falls ? [`Defeated by ${fmt(falls)}`] : [])
    : [];
  return tile(mob, { have: kills > 0, kind: "foe", sub: words.join(" · "), sov });
}

function itemCell(def, have) {
  const sub = [
    def.kind === "gear" ? GameData.SLOT_LABELS[def.slot] : def.kind === "tool" ? "Tool" : def.category || "Material",
    def.tier ? tierLabel(def.tier) : null,
  ].filter(Boolean).join(" · ");
  return tile(def, { have, kind: "item", sub });
}

/* ================= 5. THE PANEL ================= */

const TABS = [
  { id: "items", name: "Items", icon: "crate" },
  { id: "foes", name: "Monsters", icon: "skull" },
];

/**
 * collectionPanel({ onFoe, onItem, falls })
 *   onFoe(id)  a felled monster's tile was pressed (omit and tiles do not open)
 *   onItem(id) a held item's tile was pressed
 *   falls(id)  how many times that monster put YOU down, if the caller knows
 * Returns { node, paint(rolls), destroy() }.
 */
export function collectionPanel({ onFoe = null, onItem = null, falls = null } = {}) {
  let tab = TABS[0].id;
  let kind = KINDS[0].id;
  let group = 0;            // index into the current kind's groups
  let rolls = null;
  let sig = null;

  const chip = h("span.chip");
  const tabs = h("div.char-tabs.coll-tabs", { role: "tablist", "aria-label": "Collection" });
  const kinds = h("div.coll-row", { role: "tablist", "aria-label": "Kind" });
  const groupRow = h("div.coll-row.coll-groups", { role: "tablist", "aria-label": "Ground" });
  const grid = h("div.coll-grid");
  const node = h("section.section",
    h("div.section-head",
      h("div", h("h2.section-title", "Collection")),
      h("div.card-actions", chip)),
    tabs, kinds, groupRow, grid);

  const groupsNow = () => (tab === "foes" ? FOE_GROUPS : (KINDS.find((k) => k.id === kind) || KINDS[0]).groups);
  const seenIn = (items) => (tab === "foes"
    ? items.filter((m) => felled(rolls || {}, m.id)).length
    : items.filter((d) => found(rolls || {}, d.id)).length);

  // A chip carrying a name and how much of it is in hand.
  const countChip = (label, on2, seen, all, data) => h("button.chip.coll-chip", {
    type: "button", role: "tab", "aria-selected": on2 ? "true" : "false", tabindex: on2 ? "0" : "-1",
    class: on2 && "is-on", dataset: data,
  }, label, h("span.coll-n", `${fmtWhole(seen)}/${fmtWhole(all)}`));

  function draw() {
    const r = rolls || {};
    const foeSeen = BESTIARY.reduce((n, g) => n + g.mobs.filter((m) => felled(r, m.id)).length, 0);
    const itemSeen = KINDS.reduce((n, k) => n + k.groups.reduce((m, g) => m + g.items.filter((d) => found(r, d.id)).length, 0), 0);

    tabs.replaceChildren(
      countChip("Items", tab === "items", itemSeen, ITEM_COUNT, { tab: "items" }),
      countChip("Monsters", tab === "foes", foeSeen, BESTIARY_COUNT, { tab: "foes" }));

    // The kind row belongs to the items tab; the bestiary has one kind of thing in it.
    kinds.hidden = tab !== "items";
    if (tab === "items") {
      kinds.replaceChildren(...KINDS.map((k) => countChip(
        k.name, k.id === kind,
        k.groups.reduce((n, g) => n + g.items.filter((d) => found(r, d.id)).length, 0),
        k.count, { kind: k.id })));
    }

    const gs = groupsNow();
    if (group >= gs.length) group = 0;
    groupRow.hidden = gs.length < 2;
    groupRow.replaceChildren(...gs.map((g, i) => countChip(g.name, i === group, seenIn(g.items), g.items.length, { group: String(i) })));

    const items = gs[group] ? gs[group].items : [];
    grid.replaceChildren(...items.map((def) => (tab === "foes"
      ? foeCell(def, felled(r, def.id), falls ? falls(def.id) : 0)
      : itemCell(def, found(r, def.id)))));

    setText(chip, `${fmtWhole(foeSeen + itemSeen)} of ${fmtWhole(BESTIARY_COUNT + ITEM_COUNT)} collected`);
  }

  const offs = [
    on(tabs, "click", "[data-tab]", (e, t) => {
      if (t.dataset.tab === tab) return;
      tab = t.dataset.tab;
      group = 0;
      draw();
    }),
    on(kinds, "click", "[data-kind]", (e, t) => {
      if (t.dataset.kind === kind) return;
      kind = t.dataset.kind;
      group = 0;
      draw();
    }),
    on(groupRow, "click", "[data-group]", (e, t) => {
      const i = Number(t.dataset.group);
      if (i === group) return;
      group = i;
      draw();
    }),
    on(grid, "click", ".coll-cell[data-monster]", (e, b) => { if (onFoe) onFoe(b.dataset.monster); }),
    on(grid, "click", ".coll-cell[data-item]", (e, b) => { if (onItem) onItem(b.dataset.item); }),
  ];

  return {
    node,
    // Redrawn only when something was met for the first time, or a count moved.
    paint(next) {
      rolls = next && typeof next === "object" ? next : {};
      const keys = Object.keys(rolls).filter((k) => k.charCodeAt(1) === 58 && (k[0] === "m" || k[0] === "i"));
      const nextSig = `${tab}|${kind}|${group}|${keys.length}|${keys.map((k) => `${k}${k[0] === "m" ? rolls[k] : ""}`).sort().join(",")}`;
      if (nextSig === sig) return;
      sig = nextSig;
      draw();
    },
    destroy() { offs.forEach((off) => off()); },
  };
}

export { GEAR_COUNT, PART_COUNT, ITEM_COUNT };
