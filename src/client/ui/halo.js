/* ============================================================
   Respite · ui/halo.js · What a Worked Piece Wears
   ------------------------------------------------------------
   The halo, drawn once here for every place it shows: the ring
   round the piece on the anvil, the glow on a slot or a tile, the
   aura round the commander on the Worn card, and the ring round an
   avatar on the profile card. The look is all CSS (pages.css, THE
   HALOS); this builds the nodes and swaps the classes, reading the
   levels off CONFIG.enchant.halos so a fourth halo is a config line
   and a CSS block, not a hunt through the pages.

   Veiled (+9) breathes violet. Sovereign (+12) turns a gold crest
   with sparks in orbit. Hallowed (+15) scatters rune marks round the
   piece, each flickering on its own time, over a bone-white glow.
   ============================================================ */

import { h, setText, setAttr, toggleClass } from "./dom.js";
import { CONFIG } from "../../shared/config.js";
import { haloOf } from "../../shared/items.js";

const HALOS = CONFIG.enchant.halos;
const TIERS = HALOS.map((x) => x.at);

// The tag tone a halo is named in, by its id; anything new is bone.
const TAG_TONE = { veiled: "tag-violet", sovereign: "tag-gold", hallowed: "tag-bone" };

export const tierClass = (plus) => {
  const hl = haloOf(plus);
  return hl ? `tier-${hl.at}` : "";
};

export const haloTagClass = (halo) => (halo ? TAG_TONE[halo.id] || "tag-bone" : "");

// A small tag naming the halo, or null below the first.
export function haloTag(halo) {
  return halo ? h("span.tag", { class: haloTagClass(halo) }, halo.name) : null;
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

// The scatter round a Hallowed piece: one node, twelve marks.
export function runesNode() {
  return h("span.runes", { "aria-hidden": "true" }, RUNES.map(runeSvg));
}

/* ================= 3. THE HALO ROUND A PIECE ================= */

/* The big one, for the anvil. Every layer is built and the CSS shows the ones
   the tier uses: motes for Veiled, a crest and an orbit for Sovereign, runes for
   Hallowed. paintHalo swaps the class; nothing is rebuilt. */
export function haloNode() {
  const node = h("div.halo", { "aria-hidden": "true" },
    Array.from({ length: 6 }, () => h("span.mote")),
    h("span.crest"),
    h("span.orbit", Array.from({ length: 8 }, () => h("i"))),
    runesNode());
  return node;
}

export function paintHalo(node, plus) {
  const hl = haloOf(plus);
  TIERS.forEach((at) => toggleClass(node, `halo-${at}`, !!hl && hl.at === at));
  node.hidden = !hl;
}

// The small glow on an .art plate or a .doll-slot: mini-9, mini-12, mini-15.
export function paintMini(node, plus) {
  const hl = haloOf(plus);
  TIERS.forEach((at) => toggleClass(node, `mini-${at}`, !!hl && hl.at === at));
}

/* ================= 4. THE AURA ROUND A COMMANDER ================= */

/* Sits inside a .figure-wrap round the standing figure: a glow behind, a floor
   ring at the feet, sparks in orbit, motes rising, runes for Hallowed. Hidden
   until paintAura is given a halo. */
export function auraNode() {
  const node = h("div.aura", { "aria-hidden": "true", hidden: true },
    h("div.aura-glow"),
    h("div.aura-floor"),
    h("div.aura-orbit", h("span", Array.from({ length: 8 }, () => h("i")))),
    h("div.aura-motes", Array.from({ length: 8 }, () => h("i"))),
    h("div.aura-runes", runesNode()));
  return node;
}

// `halo` is { at, id, name } off wornHalo() / haloOf(), or null for none.
export function paintAura(node, halo) {
  setAttr(node, "data-tier", halo ? String(halo.at) : null);
  node.hidden = !halo;
}

/* The ring round an avatar (the profile card). Same idea, smaller: a dashed
   ring for Veiled, a gold crest for Sovereign, runes for Hallowed. */
export function avatarHaloNode() {
  return h("div.avatar-halo", { "aria-hidden": "true", hidden: true }, runesNode());
}

export const paintAvatarHalo = paintAura;
