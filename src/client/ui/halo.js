/* ============================================================
   Respite · ui/halo.js · What a Worked Piece Wears
   ------------------------------------------------------------
   Two pieces take the Veil and each shows it its own way. The
   amulet is the GLOW: violet from +9, gold from +12, a slow
   rainbow at +15, round the piece and round the commander wearing
   it. The ring is the RING: a dashed violet ring from +9, a gold
   line ring of ticks with sparks in orbit from +12, and at +15 no
   ring at all but rune marks cut into the air, each flickering on
   its own time. Worn together they stack: the amulet's glow behind,
   the ring's ring at the feet.

   The look is all CSS (pages.css, THE HALOS); this builds the nodes
   and swaps the classes, reading the levels off CONFIG.enchant.halos
   so a fourth halo is a config line and a CSS block. Every painter
   takes the piece's slot, because the same +12 means a different
   thing on an amulet and on a ring.
   ============================================================ */

import { h, setText, setAttr, toggleClass } from "./dom.js";
import { iconEl } from "./icons.js";
import { CONFIG } from "../../shared/config.js";
import { GameData } from "../../shared/registry.js";
import { haloOf, itemDef } from "../../shared/items.js";

const HALOS = CONFIG.enchant.halos;
const TIERS = HALOS.map((x) => x.at);

// The tag tone a halo is named in, by its id; anything new is bone.
const TAG_TONE = { veiled: "tag-violet", sovereign: "tag-gold", hallowed: "tag-bone" };

// "glow" for the amulet, "ring" for the ring: which effect a slot's halo is.
export const kindOfSlot = (slot) => (slot === "ring" ? "ring" : "glow");

// A slot name as given, or the slot of an item key.
function slotOf(slotOrKey) {
  if (!slotOrKey) return null;
  if (GameData.EQUIP_SLOTS.includes(slotOrKey)) return slotOrKey;
  const d = itemDef(slotOrKey);
  return d ? d.slot : null;
}

export const tierClass = (plus) => {
  const hl = haloOf(plus);
  return hl ? `tier-${hl.at}` : "";
};

export const haloTagClass = (halo) => (halo ? TAG_TONE[halo.id] || "tag-bone" : "");

/* A small tag naming the halo, or null below the first. With a slot it carries
   the piece's glyph too, so "Veiled" on an amulet reads apart from "Veiled" on
   a ring when the two sit side by side. */
export function haloTag(halo, slot = null) {
  if (!halo) return null;
  return h("span.tag", { class: haloTagClass(halo) }, slot ? iconEl(GameData.SLOT_GLYPHS[slot]) : null, halo.name);
}

// The amulet's tag then the ring's, for whatever a commander wears: [] when bare.
export function haloTags(halos) {
  return CONFIG.enchant.slots.map((slot) => haloTag(halos && halos[slot], slot)).filter(Boolean);
}

/* ================= 1. THE PLATE ================= */

// "+7": the level a piece stands at, coloured by the halo it wears.
export function plusPlate(plus, cls = null) {
  const node = h("span.plus", { class: cls });
  paintPlate(node, plus);
  return node;
}

export function paintPlate(node, plus) {
  setText(node, `+${plus}`);
  TIERS.forEach((at) => toggleClass(node, `tier-${at}`, !!haloOf(plus) && haloOf(plus).at === at));
  toggleClass(node, "is-zero", plus < 1);
}

/* ================= 2. RUNES ================= */

/* Twelve marks, drawn as strokes so they read as cut rather than typed. Which
   mark sits where is fixed by nth-child in the CSS, so the scatter looks the
   same on every visit, but each flickers on its own delay. */
const RUNES = [
  "M6 3v18M6 6l9 5M6 12l9 5",
  "M8 3v18M8 7l8 5-8 5",
  "M12 3v18M12 10l-7-6M12 10l7-6",
  "M15 3l-9 6 9 6-9 6",
  "M12 4v17M5 9l7-5 7 5",
  "M14 3l-7 9 7 9",
  "M5 5l14 14M19 5 5 19",
  "M5 3v18M19 3v18M5 3l14 18M19 3 5 21",
  "M12 3l7 9-7 9-7-9z",
  "M7 3v18M17 3v18M7 9l10 6",
  "M12 3v18M8 12h8",
  "M6 21 12 3l6 18M8 15h8",
];

function runeSvg(d) {
  return h("svg.rune", { viewBox: "0 0 24 24", "aria-hidden": "true" }, h("path", { d }));
}

// The scatter round a Hallowed ring: one node, twelve marks.
export function runesNode() {
  return h("span.runes", { "aria-hidden": "true" }, RUNES.map(runeSvg));
}

/* ================= 3. THE HALO ROUND A PIECE ================= */

/* The big one, for the anvil. Every layer is built and the CSS shows the ones
   the kind and tier use: glow and motes for an amulet, crest, orbit and runes
   for a ring. paintHalo swaps the classes; nothing is rebuilt. */
export function haloNode() {
  return h("div.halo", { "aria-hidden": "true", hidden: true },
    h("span.glow"),
    Array.from({ length: 6 }, () => h("span.mote")),
    h("span.crest"),
    h("span.orbit", Array.from({ length: 8 }, () => h("i"))),
    runesNode());
}

// `slot` (or a key) says which effect it is; a plus below +9 hides it.
export function paintHalo(node, plus, slotOrKey = null) {
  const hl = haloOf(plus);
  TIERS.forEach((at) => toggleClass(node, `halo-${at}`, !!hl && hl.at === at));
  setAttr(node, "data-kind", hl ? kindOfSlot(slotOf(slotOrKey)) : null);
  node.hidden = !hl;
}

/* The small version on an .art plate, a .doll-slot or a storage .slot:
   glow-9/12/15 on an amulet, ring-9/12/15 on a ring. */
export function paintMini(node, plus, slotOrKey) {
  const hl = haloOf(plus);
  const kind = kindOfSlot(slotOf(slotOrKey));
  TIERS.forEach((at) => {
    toggleClass(node, `glow-${at}`, kind === "glow" && !!hl && hl.at === at);
    toggleClass(node, `ring-${at}`, kind === "ring" && !!hl && hl.at === at);
  });
}

/* ================= 4. THE AURA ROUND A COMMANDER ================= */

/* Sits inside a .figure-wrap round the standing figure. The amulet's glow is
   the light behind them and the motes rising; the ring's ring is the floor
   ring at their feet, the sparks in orbit, or the runes standing round them.
   Hidden until paintAura is given a halo on either. */
export function auraNode() {
  return h("div.aura", { "aria-hidden": "true", hidden: true },
    h("div.aura-glow"),
    h("div.aura-floor"),
    h("div.aura-orbit", h("span", Array.from({ length: 8 }, () => h("i")))),
    h("div.aura-motes", Array.from({ length: 8 }, () => h("i"))),
    h("div.aura-runes", runesNode()));
}

// `halos` is { neck, ring } off wornHalos(), each a halo or null.
export function paintAura(node, halos) {
  const glow = halos && halos.neck;
  const ring = halos && halos.ring;
  setAttr(node, "data-glow", glow ? String(glow.at) : null);
  setAttr(node, "data-ring", ring ? String(ring.at) : null);
  node.hidden = !glow && !ring;
}

/* The ring round an avatar (the Character hero, a commander's page, the profile
   card). The amulet lights the frame; the ring draws round it. */
export function avatarHaloNode() {
  return h("div.avatar-halo", { "aria-hidden": "true", hidden: true }, runesNode());
}

export const paintAvatarHalo = paintAura;
