/* ============================================================
   Respite · ui/collection.js · What You Have Seen
   ------------------------------------------------------------
   The Collection: the ledger of things and the bestiary. It is
   built from one map -- the save's roll counters -- so the same
   panel draws your own camp's collection and a stranger's on
   their commander page, off whatever the realm publishes.

     m:<monster>   felled, and how many times
     i:<base>      an item that has been in these hands

   Items come in three kinds: Equipment (the gear and the tools
   a ground makes), Resources (what a ground yields, with the
   reagents and each tier's remedy filed under their ground) and
   the Veil. Each kind is an album: one row per ground, a square
   per piece, lit once met. Picking a row opens that ground below.

   An entry never seen stays dark: no art, no name, nothing to
   open. A seen one opens its own card (popups/entry.js). What is
   in the world is the registry's word, so a line shelved behind
   `released: false` is not in here either.
   ============================================================ */

import { h, on, setText, setAttr, setWidth } from "./dom.js";
import { iconEl, artEl, hasArt } from "./icons.js";
import { fmtWhole } from "./format.js";
import { monsterArt } from "./popups/foe.js";
import { GameData, foesOf, sovereignOf } from "../../shared/registry.js";

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

/* ================= 3. THE THREE KINDS ================= */
/* A ground's tools sit after its gear, and its remedy after what it yields;
   the reagents belong to no ground, so they are filed under the first one,
   where every camp starts. Only the Veil stands alone. */

const MATS = Object.values(GameData.MATERIALS);
const isVeil = (m) => m.category === "Veil";
const isRemedy = (m) => m.heal > 0;
const isReagent = (m) => !!m.reagent && !isVeil(m) && !isRemedy(m);
const plainMat = (m) => !isVeil(m) && !isRemedy(m) && !isReagent(m);

const GEAR = Object.values(GameData.GEAR).filter((g) => !shelved(g));
const TOOLS = Object.values(GameData.TOOLS);
const PLAIN = MATS.filter(plainMat);
const REAGENTS = MATS.filter(isReagent).sort(byTier);
const REMEDIES = MATS.filter(isRemedy).sort(byTier);
const VEIL = MATS.filter(isVeil).sort(byTier);

// One row per ground that has anything on it, each ground's lists laid end to end.
function perGround(...lists) {
  const tiers = new Set(lists.flatMap((l) => l.items.map((d) => Number(d.tier) || 0)));
  return [...tiers].sort((a, b) => a - b).map((tier) => ({
    name: groundName(tier),
    items: lists.flatMap((l) => l.items.filter((d) => (Number(d.tier) || 0) === tier).sort(l.sort)),
  })).filter((g) => g.items.length);
}

const EQUIPMENT = perGround({ items: GEAR, sort: bySlot }, { items: TOOLS, sort: bySlot });
const RESOURCES = perGround({ items: PLAIN, sort: byCategory }, { items: REMEDIES, sort: byTier });
if (RESOURCES.length) RESOURCES[0].items.splice(RESOURCES[0].items.length - REMEDIES.filter((m) => (Number(m.tier) || 0) === 1).length, 0, ...REAGENTS);

const KINDS = [
  { id: "gear", name: "Equipment", sub: "Equipment and tools by ground.", groups: EQUIPMENT },
  { id: "parts", name: "Resources", sub: "Resources, reagents and remedies by ground.", groups: RESOURCES },
  { id: "veil", name: "The Veil", sub: "The Veil belongs to no one ground.", groups: VEIL.length ? [{ name: "The Veil", items: VEIL }] : [] },
].filter((k) => k.groups.length);

KINDS.forEach((k) => { k.count = k.groups.reduce((n, g) => n + g.items.length, 0); });

const ITEM_COUNT = KINDS.reduce((n, k) => n + k.count, 0);
const GEAR_COUNT = GEAR.length;
const PART_COUNT = PLAIN.length;

// The bestiary in the same shape, so one drawing routine serves both.
const FOE_GROUPS = BESTIARY.map(({ region, mobs }) => ({ name: region.name, items: mobs }));

/* ================= 4. THE PANEL ================= */

const MODES = [
  { id: "items", name: "Items" },
  { id: "foes", name: "Monsters" },
];

// A foe's square in the album: its glyph, the Sovereign's crown.
const foeGlyph = (mob) => (mob.archetype === "sovereign" ? "crown" : mob.icon || "skull");

/**
 * collectionPanel({ onEntry })
 *   onEntry({ kind: "item"|"foe", id, def, count }) a seen entry was pressed
 * Returns { node, filters, paint(rolls), destroy() }. `filters` is the kind list
 * (Items or Monsters, then Equipment, Resources, the Veil); the page puts it
 * wherever it keeps its side column.
 */
export function collectionPanel({ onEntry = null } = {}) {
  let mode = MODES[0].id;
  let kind = KINDS[0].id;
  let group = 0;
  let rolls = {};
  let sig = null;

  const total = h("span.coll-total");
  const totalBar = h("i");
  const sub = h("p.coll-sub");
  const album = h("div.coll-album", { role: "list" });
  const openHead = h("div.coll-open-head");
  const grid = h("div.coll-tiles");
  const node = h("section.coll",
    h("div.coll-head",
      h("h2.coll-title", "Collection"),
      h("div.coll-sum", total, h("div.bar.bar-gold.bar-thin", totalBar))),
    sub, album, h("div.coll-open", openHead, grid));

  const modeRow = h("div.seg.seg-full.coll-modes", { role: "tablist", "aria-label": "Collection" });
  const kindList = h("div.coll-kinds", { role: "tablist", "aria-label": "Kind" });
  const foeNote = h("div.coll-foe-note");
  const filters = h("div.coll-filters", modeRow, kindList, foeNote);

  const isSeen = (d) => (mode === "foes" ? felled(rolls, d.id) > 0 : found(rolls, d.id));
  const groupsNow = () => (mode === "foes" ? FOE_GROUPS : (KINDS.find((k) => k.id === kind) || KINDS[0]).groups);
  const seenOf = (items, m = mode) => items.filter((d) => (m === "foes" ? felled(rolls, d.id) > 0 : found(rolls, d.id))).length;

  function drawFilters(itemSeen, foeSeen) {
    modeRow.replaceChildren(...MODES.map((m) => h("button.seg-btn", {
      type: "button", role: "tab", "aria-selected": m.id === mode ? "true" : "false", dataset: { mode: m.id },
    }, m.name, h("span.count", m.id === "foes" ? `${fmtWhole(foeSeen)}/${fmtWhole(BESTIARY_COUNT)}` : `${fmtWhole(itemSeen)}/${fmtWhole(ITEM_COUNT)}`))));
    kindList.hidden = mode !== "items";
    foeNote.hidden = mode !== "foes";
    if (mode === "items") {
      kindList.replaceChildren(...KINDS.map((k) => {
        const seen = k.groups.reduce((n, g) => n + seenOf(g.items, "items"), 0);
        const fill = h("i");
        setWidth(fill, k.count ? (seen / k.count) * 100 : 0);
        return h("button.coll-kind", {
          type: "button", role: "tab", "aria-selected": k.id === kind ? "true" : "false", dataset: { kind: k.id },
        },
          h("span.coll-kind-top", h("span.coll-kind-name", k.name), h("span.coll-kind-n", `${fmtWhole(seen)}/${fmtWhole(k.count)}`)),
          h("span.bar.bar-thin", { class: seen === k.count && "bar-gold" }, fill));
      }));
    } else {
      const fill = h("i");
      setWidth(fill, BESTIARY_COUNT ? (foeSeen / BESTIARY_COUNT) * 100 : 0);
      foeNote.replaceChildren(
        h("div.coll-kind-top", h("span.coll-kind-name", `${fmtWhole(foeSeen)} of ${fmtWhole(BESTIARY_COUNT)} foes seen`)),
        h("p.coll-foe-copy", "Sovereigns show in gold. Pick a ground to see who you have put down there."),
        h("span.bar.bar-thin", fill));
    }
  }

  function drawAlbum(gs) {
    const foes = mode === "foes";
    album.hidden = gs.length < 2;
    album.classList.toggle("is-foes", foes);
    album.replaceChildren(...gs.map((g, i) => {
      const seen = seenOf(g.items);
      return h("button.coll-row", {
        type: "button", role: "listitem", "aria-pressed": i === group ? "true" : "false", dataset: { group: String(i) },
        "aria-label": `${g.name}: ${fmtWhole(seen)} of ${fmtWhole(g.items.length)}`,
      },
        h("span.coll-row-name", { class: !seen && "is-none" }, g.name),
        h("span.coll-sqs", { "aria-hidden": "true", style: { "--n": String(g.items.length) } },
          g.items.map((d) => h("span.coll-sq", { class: isSeen(d) && "is-seen", "data-sov": foes && d.archetype === "sovereign" ? "" : null },
            foes ? iconEl(foeGlyph(d)) : null))),
        h("span.coll-row-n", `${fmtWhole(seen)}/${fmtWhole(g.items.length)}`));
    }));
  }

  function drawOpen(gs) {
    const g = gs[group];
    const items = g ? g.items : [];
    const seen = seenOf(items);
    openHead.replaceChildren(h("h3.coll-open-title", g ? g.name : ""),
      h("span.coll-open-n", `${fmtWhole(seen)} of ${fmtWhole(items.length)} ${mode === "foes" ? "seen" : "found"}`));
    grid.classList.toggle("is-foes", mode === "foes");
    grid.replaceChildren(...items.map((d) => (mode === "foes" ? foeCard(d) : itemTile(d))));
  }

  function itemTile(def) {
    if (!found(rolls, def.id)) {
      return h("div.coll-tile.is-locked", { title: "Not found yet" }, h("span.coll-tile-art", { "aria-hidden": "true" }, iconEl(def.icon || "unknown")));
    }
    const art = hasArt(def) ? artEl(def, { variant: "cut" }) : iconEl(def.icon || "unknown");
    return h("button.coll-tile", { type: "button", title: def.name, "aria-label": def.name, dataset: { item: def.id } },
      h("span.coll-tile-art", { class: { "art-paint": hasArt(def) }, "aria-hidden": "true" }, art));
  }

  function foeCard(mob) {
    const kills = felled(rolls, mob.id);
    const sov = mob.archetype === "sovereign";
    if (!kills) {
      return h("div.coll-foe.is-locked", { class: sov && "is-sovereign" },
        h("span.coll-foe-art", { "aria-hidden": "true" }, iconEl(foeGlyph(mob))),
        h("span.coll-foe-name", "Unseen"));
    }
    return h("button.coll-foe", { type: "button", class: sov && "is-sovereign", dataset: { monster: mob.id } },
      h("span.coll-foe-art", { "aria-hidden": "true", html: monsterArt(mob) }),
      h("span.coll-foe-name", mob.name),
      h("span.coll-foe-n", `${fmtWhole(kills)} slain`));
  }

  function draw() {
    const foeSeen = BESTIARY.reduce((n, g) => n + g.mobs.filter((m) => felled(rolls, m.id)).length, 0);
    const itemSeen = KINDS.reduce((n, k) => n + k.groups.reduce((m, g) => m + g.items.filter((d) => found(rolls, d.id)).length, 0), 0);
    const all = BESTIARY_COUNT + ITEM_COUNT;
    const got = foeSeen + itemSeen;
    total.replaceChildren(h("b", fmtWhole(got)), ` of ${fmtWhole(all)} · ${all ? Math.round((got / all) * 100) : 0}%`);
    setWidth(totalBar, all ? (got / all) * 100 : 0);

    drawFilters(itemSeen, foeSeen);
    const gs = groupsNow();
    if (group >= gs.length) group = 0;
    const k = KINDS.find((x) => x.id === kind) || KINDS[0];
    setText(sub, mode === "foes"
      ? "Foes by ground. Pick a ground to open it below; press anything you have met to read about it."
      : `${k.sub}${gs.length > 1 ? " Pick a ground to open it below;" : ""} press anything you have found to read about it.`);
    drawAlbum(gs);
    drawOpen(gs);
  }

  const openEntry = (kindOf, id) => {
    if (!onEntry) return;
    if (kindOf === "foe") {
      const mob = BESTIARY.flatMap((g) => g.mobs).find((m) => m.id === id);
      if (mob) onEntry({ kind: "foe", id, def: mob, count: felled(rolls, id) });
      return;
    }
    const def = KINDS.flatMap((x) => x.groups.flatMap((g) => g.items)).find((d) => d.id === id);
    if (def) onEntry({ kind: "item", id, def, count: countOf(rolls, `i:${id}`) });
  };

  const offs = [
    on(modeRow, "click", "[data-mode]", (e, t) => {
      if (t.dataset.mode === mode) return;
      mode = t.dataset.mode;
      group = 0;
      draw();
    }),
    on(kindList, "click", "[data-kind]", (e, t) => {
      if (t.dataset.kind === kind) return;
      kind = t.dataset.kind;
      group = 0;
      draw();
    }),
    on(album, "click", "[data-group]", (e, t) => {
      const i = Number(t.dataset.group);
      if (i === group) return;
      group = i;
      draw();
    }),
    on(grid, "click", "[data-item]", (e, b) => openEntry("item", b.dataset.item)),
    on(grid, "click", "[data-monster]", (e, b) => openEntry("foe", b.dataset.monster)),
  ];

  return {
    node,
    filters,
    // Redrawn only when something was met for the first time, or a count moved.
    paint(next) {
      rolls = next && typeof next === "object" ? next : {};
      const keys = Object.keys(rolls).filter((k) => k.charCodeAt(1) === 58 && (k[0] === "m" || k[0] === "i"));
      const nextSig = `${mode}|${kind}|${group}|${keys.length}|${keys.map((k) => `${k}${k[0] === "m" ? rolls[k] : ""}`).sort().join(",")}`;
      if (nextSig === sig) return;
      sig = nextSig;
      draw();
    },
    destroy() { offs.forEach((off) => off()); },
  };
}

export { GEAR_COUNT, PART_COUNT, ITEM_COUNT, KINDS };
