/* ============================================================
   Respite · popups/foe.js · The Bestiary
   ------------------------------------------------------------
   One foe laid bare: what it hits for once your Defence has had
   its say, what it pays and what it leaves behind. Opened from
   the arena, the quarry, and a zone popup (which passes `back`
   so there is a way to return to it).

   Also home to monsterArt(), which draws a foe from ui/monster-art.js
   for the arena, the quarry, the Collection and the entries.

   "Your record" is what the Character page's Collection is for:
   how often this one has gone down, and how often it has put you
   down. Both read from the save, so they hold outside a hunt.
   ============================================================ */

import { h } from "../dom.js";
import { iconEl, artEl } from "../icons.js";
import { MONSTER_ART, KIND_ART } from "../monster-art.js";
import { openModal } from "../overlay.js";
import { fmt, fmtGold, fmtStat, chancePct, plural } from "../format.js";
import { registerPopup, openPopup } from "../widgets.js";
import { GameData, getMonster, getZone, regionOfTier, tierLabel, veilBandOfTier } from "../../../shared/registry.js";
import { statsOf } from "../../../shared/stats.js";
import { foeNumbers } from "../../../shared/combat.js";
import { xpMult } from "../../../shared/progression.js";
import { companionBonus } from "../../../shared/companions.js";
import { itemDef, itemName } from "../../../shared/items.js";

/* ================= 1. THE DRAWINGS ================= */
/* One per foe, in ui/monster-art.js, 120 by 120 and painted by the m-*
   classes in pages.css. The rim follows the rank: .elite and .sovereign. */

// A foe's drawing as an SVG string, for openModal's art or h()'s html prop. Code-built, never player text.
export function monsterArt(mob, elite = false) {
  const rank = mob.archetype === "sovereign" ? " sovereign" : elite ? " elite" : "";
  const art = MONSTER_ART[mob.id] || KIND_ART[mob.icon] || KIND_ART.horror;
  return `<svg class="m-art${rank}" viewBox="0 0 120 120" aria-hidden="true" focusable="false">${art}</svg>`;
}

/* ================= 2. THE POPUP ================= */

const pctOf = (x) => `${Math.round(x * 100)}%`;

const stat = (label, value, tone) => h("div.stat", h("span.l", label), h("span.v", { class: tone && `t-${tone}` }, value));

// A line that is a fact, not an item: nothing to open.
const note = (label, value, glyph = "sparkle") =>
  h("div.ap-row", h("span.ap-link", iconEl(glyph), h("span", label)), h("span.ap-val", value));

/* How often this one has fallen, and how often you have. The Collection reads
   both for every foe in the world on a frame, so they stay this cheap. */
export const foeKills = (state, monsterId) => (state.rolls && state.rolls[`m:${monsterId}`]) || 0;
export const foeFalls = (state, monsterId) => (state.foeDeaths && state.foeDeaths[monsterId]) || 0;

// Zero reads as never, not as a nought.
const times = (n) => (n ? plural(n, "time") : "Never");

// Everything the numbers below lean on. When it moves (a level, a new piece, a buff running out) the body is drawn again.
function numbersSig(ctx, mob) {
  const state = ctx.state;
  return [statsOf(state).defence, xpMult(state, "warfare", ctx.now), companionBonus(state, "gold"),
    companionBonus(state, "drops"), companionBonus(state, "rare"),
    // A kill or a fall mid-fight moves the record, so it counts as a change too.
    foeKills(state, mob.id), foeFalls(state, mob.id)].join("|");
}

function foeBody(ctx, mob) {
  const state = ctx.state;
  const sov = mob.archetype === "sovereign";
  const n = foeNumbers(mob, false);
  const goldMult = 1 + companionBonus(state, "gold");
  const dropMult = 1 + companionBonus(state, "drops");
  const rare = companionBonus(state, "rare");

  const stats = h("div.stats",
    stat("Health", fmt(n.hp)),
    stat("Attack", fmtStat(n.attack)),
    stat("Defence", fmtStat(mob.defence)),
    stat("Swings every", `${(mob.speed / 1000).toFixed(1)}s`),
    stat("Base XP", fmtStat(n.xp * xpMult(state, "warfare", ctx.now))),
    stat("Gold", `${fmtGold(Math.round(n.gold[0] * goldMult))} to ${fmtGold(Math.round(n.gold[1] * goldMult))}`, "gold"));

  if (sov) {
    const S = GameData.SOVEREIGN;
    stats.appendChild(stat("Enrages", `+${pctOf(S.enrage)} attack every ${S.enrageMs / 1000}s`));
  } else {
    const e = foeNumbers(mob, true);
    stats.appendChild(stat("As an Elite", `${fmt(e.hp)} health · ${fmtStat(e.attack)} a blow · ×${GameData.ELITE.xp} XP`));
  }

  const rows = mob.drops.map(([key, qty, chance]) => {
    // "@reagent" is whichever of the five it happens to carry, rolled on the kill.
    if (key === "@reagent") return note(`Reagent ×${qty}`, chancePct(Math.min(1, chance * dropMult)));
    const d = itemDef(key);
    return h("div.ap-row",
      h("button.ap-link", { type: "button", dataset: { item: key } }, d ? artEl(d) : iconEl("unknown"), h("span", `${itemName(key)} ×${qty}`)),
      h("span.ap-val", chancePct(Math.min(1, chance * dropMult))));
  });
  const band = veilBandOfTier(mob.tier);
  if (sov) {
    rows.push(note(`${band.name} Essence ×${GameData.SOVEREIGN.essence}`, "Always"));
  } else {
    rows.push(note("Elites drop", `×${GameData.ELITE.drops}`));
    rows.push(note(`${band.name} Fragment ×${GameData.ELITE.fragments}`, "Elites, Inner and Core"));
  }
  if (rare) rows.push(note("Finer gear", chancePct(rare)));

  const list = h("div.ap-list", rows);
  list.addEventListener("click", (e) => {
    const link = e.target instanceof Element ? e.target.closest("button.ap-link[data-item]") : null;
    if (link) openPopup("item", ctx, link.dataset.item, { from: null });
  });

  const kills = foeKills(state, mob.id);
  const falls = foeFalls(state, mob.id);

  return [
    h("p.ap-desc", sov ? GameData.SOVEREIGN.note : GameData.ARCHETYPES[mob.archetype].note),
    stats,
    h("div.ap-block", h("div.eyebrow", "Drops"), list),
    h("div.ap-block", h("div.eyebrow", "Your record"),
      h("div.ap-list",
        note("You have felled it", times(kills), "swords"),
        note("It has felled you", times(falls), "skull"))),
  ];
}

registerPopup("foe", (ctx, monsterId, { back = null } = {}) => {
  const mob = getMonster(monsterId);
  if (!mob) return null;
  const sov = mob.archetype === "sovereign";
  const region = regionOfTier(mob.tier);
  const zone = back ? getZone(back.zoneId) : null;

  let offTick = () => {};
  const m = openModal({
    title: mob.name,
    sub: `${sov ? "Sovereign" : GameData.ARCHETYPES[mob.archetype].name} · ${region ? region.name : tierLabel(mob.tier)}`,
    art: monsterArt(mob),
    artTone: "ember",
    body: foeBody(ctx, mob),
    actions: zone ? [{
      label: `Back to the ${zone.name}`,
      wide: true,
      // Close first, so the zone popup hands focus back to whatever opened this chain.
      onClick: (handle) => {
        handle.close("action");
        openPopup("zone", ctx, back.tier, zone.id);
      },
    }] : [],
    onClose: () => offTick(),
  });

  let sig = numbersSig(ctx, mob);
  offTick = ctx.onTick(() => {
    if (m.closed) return;
    const next = numbersSig(ctx, mob);
    if (next === sig) return;
    sig = next;
    m.setBody(foeBody(ctx, mob));
  });
  return m;
});
