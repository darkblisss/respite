/* ============================================================
   Respite · popups/entry.js · One Entry in the Collection
   ------------------------------------------------------------
   What opens when a seen square in a profile's Collection is pressed:
   the thing's face, what it is, when it was first met (once the
   save keeps that), a line on it, and three plain facts. Built
   from the registry alone, so a stranger's collection opens the
   same card as your own.

   An entry never met does not open at all: the album keeps
   those dark, and there is nothing here to say about them.

   The full sheets are one press further: the item popup for a
   piece, the bestiary for a foe.
   ============================================================ */

import { h } from "../dom.js";
import { iconEl, artEl, hasArt } from "../icons.js";
import { openModal } from "../overlay.js";
import { fmtWhole } from "../format.js";
import { registerPopup, openPopup } from "../widgets.js";
import { GameData, getSkill, regionOfTier } from "../../../shared/registry.js";
import { monsterArt } from "./foe.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "17 Sep 2026", in UTC as every day in the game is.
function fmtDay(ms) {
  const d = new Date(Number(ms) || 0);
  if (!Number.isFinite(d.getTime()) || !ms) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const skillName = (id) => (id && getSkill(id) ? getSkill(id).name : null);
const groundOf = (tier) => {
  const r = regionOfTier(Number(tier) || 0);
  return r ? r.name : null;
};

// Which trade gathers or which bench makes each kind of resource.
const BY_CATEGORY = {
  Ore: ["Gathered by", "delving", "Raw ore, dug from the ground."],
  Bars: ["Made by", "forgemaster", "Ore smelted down into a bar."],
  Timber: ["Gathered by", "felling", "Rough timber, felled whole."],
  Planks: ["Made by", "woodwright", "Timber planed into planks."],
  Fibre: ["Gathered by", "harvesting", "Raw fibre, cut in the field."],
  Weave: ["Made by", "weaver", "Fibre woven into cloth."],
  Hides: ["Gathered by", "flaying", "A raw hide, flayed from the kill."],
  Leather: ["Made by", "tanner", "Hide cured into leather."],
  Finds: ["Gathered by", "dredging", "Something dredged up from the silt."],
  Inlays: ["Made by", "artificer", "A find cut and set as an inlay."],
};
const REAGENT_SKILL = { coal: "delving", resin: "felling", pulp: "harvesting", tallow: "flaying", veil_shard: "dredging" };

const lastWord = (name) => String(name || "").trim().split(/\s+/).pop().toLowerCase();

/* What the card says about an item: its eyebrow, a line, and three facts. */
function aboutItem(def) {
  const ground = groundOf(def.tier);
  if (def.kind === "gear") {
    const slot = GameData.SLOT_LABELS[def.slot] || "Gear";
    return {
      eyebrow: `Equipment · ${slot}`,
      line: `${def.twoHanded ? "A two-handed" : "A"} ${lastWord(def.name)}, worn in the ${slot.toLowerCase()} slot.`,
      facts: [["Made by", skillName(def.prof)], ["Ground", ground], ["Tier", def.tier]],
    };
  }
  if (def.kind === "tool") {
    return {
      eyebrow: "Equipment · Tool",
      line: `A ${lastWord(def.name)} for ${skillName(def.forSkill) || "the crews"}. The better the tool, the quicker the work.`,
      facts: [["Used for", skillName(def.forSkill)], ["Ground", ground], ["Tier", def.tier]],
    };
  }
  if (def.heal > 0) {
    return {
      eyebrow: "Resource · Remedy",
      line: `Brewed, not found. Restores ${fmtWhole(def.heal)} health between encounters.`,
      facts: [["Heals", fmtWhole(def.heal)], ["Ground", ground], ["Tier", def.tier]],
    };
  }
  if (def.category === "Veil") {
    return {
      eyebrow: "The Veil",
      line: `A ${String(def.band || "").toLowerCase() || "piece"} piece of the Veil.`,
      facts: [["Band", def.band ? def.band.charAt(0).toUpperCase() + def.band.slice(1) : null], ["Tier", def.tier]],
    };
  }
  if (def.reagent) {
    return {
      eyebrow: "Resource · Reagent",
      line: "A reagent. A bench asks for one for every tier of what it makes.",
      facts: [["Gathered by", skillName(REAGENT_SKILL[def.id])], ["Ground", "Any"]],
    };
  }
  const cat = BY_CATEGORY[def.category];
  return {
    eyebrow: `Resource · ${def.category || "Material"}`,
    line: cat ? cat[2] : "A resource for the benches.",
    facts: [[cat ? cat[0] : "Source", cat ? skillName(cat[1]) : null], ["Ground", ground], ["Tier", def.tier]],
  };
}

function aboutFoe(mob, count) {
  const sov = mob.archetype === "sovereign";
  const arch = GameData.ARCHETYPES[mob.archetype];
  const ground = groundOf(mob.tier);
  return {
    eyebrow: `Monster · ${sov ? "Sovereign" : arch ? arch.name : "Foe"}`,
    line: sov ? `The Sovereign of ${ground || "its ground"}.` : (arch && arch.note) || "",
    facts: [["Slain", fmtWhole(count || 0)], ["Health", fmtWhole(mob.hp || 0)], ["Ground", ground]],
  };
}

/**
 * openPopup("entry", ctx, { kind: "item"|"foe", id, def, count, at, readOnly })
 *   at  when it was first met (ms), if the save keeps it; the line is left out otherwise
 */
registerPopup("entry", (ctx, { kind = "item", id, def, count = 0, at = null } = {}) => {
  if (!def) return null;
  const foe = kind === "foe";
  const about = foe ? aboutFoe(def, count) : aboutItem(def);
  const day = fmtDay(at);
  const art = foe
    ? h("span.entry-art.is-foe", { class: def.archetype === "sovereign" && "is-sovereign", html: monsterArt(def) })
    : h("span.entry-art", { class: { "art-paint": hasArt(def) } }, hasArt(def) ? artEl(def, { variant: "cut" }) : iconEl(def.icon || "unknown"));

  const facts = about.facts.filter(([, v]) => v != null && v !== "");
  const body = h("div.entry",
    h("div.entry-face", art),
    h("div.entry-main",
      day ? h("p.entry-day", h("span.entry-day-l", foe ? "First slain" : "Date discovered"), h("span", day)) : null,
      about.line ? h("p.entry-line", about.line) : null,
      h("dl.entry-facts", facts.map(([l, v]) => h("div", h("dt", l), h("dd", String(v)))))));

  return openModal({
    title: def.name,
    sub: about.eyebrow,
    body,
    size: "md",
    className: "entry-modal",
    actions: [
      { label: foe ? "Open in the bestiary" : "Open the full sheet", kind: "quiet",
        onClick: () => { openPopup(foe ? "foe" : "item", ctx, id, foe ? {} : { from: null, readOnly: true }); } },
    ],
  });
});
