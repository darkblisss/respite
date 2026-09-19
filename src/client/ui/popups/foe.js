/* ============================================================
   Respite · popups/foe.js · The Bestiary
   ------------------------------------------------------------
   One foe laid bare: what it hits for once your Defence has had
   its say, what it pays and what it leaves behind. Opened from
   the arena, the quarry, and a zone popup (which passes `back`
   so there is a way to return to it).

   Also home to the monster drawings (v4's MONSTER_ART), which
   the arena and the quarry on the Hunt page draw too.

   "Your record" is what the Character page's Collection is for:
   how often this one has gone down, and how often it has put you
   down. Both read from the save, so they hold outside a hunt.
   ============================================================ */

import { h } from "../dom.js";
import { iconEl } from "../icons.js";
import { openModal } from "../overlay.js";
import { fmt, fmtGold, fmtStat, chancePct, plural } from "../format.js";
import { registerPopup, openPopup } from "../widgets.js";
import { GameData, getMonster, getZone, regionOfTier, tierLabel } from "../../../shared/registry.js";
import { foeNumbers } from "../../../shared/combat.js";
import { statsOf, mitigation } from "../../../shared/stats.js";
import { xpMult } from "../../../shared/progression.js";
import { companionBonus } from "../../../shared/companions.js";
import { itemDef, itemName } from "../../../shared/items.js";

/* ================= 1. THE DRAWINGS ================= */
/* 120 by 120, stroked by the m-* classes in pages.css. Keyed by a
   monster's `icon`. Elites and Sovereigns get their own stroke. */

const MONSTER_ART = {
  beast:
    '<path class="m-body" d="M26 78 C30 58 48 46 70 46 C90 46 104 58 108 76 C110 86 106 96 100 100 V108 H92 L90 96 C78 100 58 100 48 96 L44 108 H36 V94 C30 92 26 86 26 78Z"/>' +
    '<path class="m-body" d="M48 50 L50 36 L57 48 M62 46 L66 32 L71 46 M76 46 L82 34 L85 48 M90 52 L99 42 L99 57"/>' +
    '<path class="m-body" d="M32 70 C22 63 12 66 8 74 C6 80 10 84 16 86 L30 90 C35 84 35 76 32 70Z"/>' +
    '<path class="m-body" d="M24 66 L19 51 L32 64Z"/>' +
    '<path class="m-edge" d="M106 80 C116 76 118 64 112 56"/><path class="m-bone" d="M10 81 L12 86 L14 81 M16 83 L18 88 L20 83"/>' +
    '<circle class="m-eye" cx="17" cy="74" r="2.4"/>',
  man:
    '<path class="m-body" d="M60 18 C44 18 36 32 36 46 C36 54 38 58 42 62 C30 72 24 88 22 110 H98 C96 88 90 72 78 62 C82 58 84 54 84 46 C84 32 76 18 60 18Z"/>' +
    '<path class="m-void" d="M48 44 C48 36 53 31 60 31 C67 31 72 36 72 44 C72 53 66 59 60 59 C54 59 48 53 48 44Z"/>' +
    '<circle class="m-eye" cx="55" cy="45" r="1.9"/><circle class="m-eye" cx="65" cy="45" r="1.9"/>' +
    '<path class="m-edge" d="M40 82 Q60 88 80 82"/>' +
    '<path class="m-steel" d="M30 92 L8 58 L12 55 L34 88Z"/><path class="m-edge" d="M26 90 L38 82"/>',
  golemMob:
    '<path class="m-body" d="M22 58 L8 70 L10 98 L22 96Z M98 58 L112 70 L110 98 L98 96Z"/>' +
    '<path class="m-body" d="M30 40 H90 L98 60 V84 L90 92 V110 H72 V94 H48 V110 H30 V92 L22 84 V60Z"/>' +
    '<path class="m-body" d="M46 16 H74 V38 H46Z"/><path class="m-eye" d="M50 25 H70 V30 H50Z"/>' +
    '<path class="m-crack" d="M40 50 L52 62 L48 76 M78 48 L70 64 L74 74 M58 96 V104"/>',
  horror:
    '<path class="m-body" d="M60 14 C90 14 106 38 104 62 C102 80 92 90 96 108 C84 104 80 96 72 100 C68 112 54 112 50 100 C42 96 38 104 26 108 C30 90 18 80 16 62 C14 38 30 14 60 14Z"/>' +
    '<ellipse class="m-void" cx="58" cy="54" rx="20" ry="14"/><circle class="m-eye" cx="54" cy="54" r="7"/><ellipse class="m-void" cx="54" cy="54" rx="2" ry="5"/>' +
    '<circle class="m-eye" cx="36" cy="34" r="2"/><circle class="m-eye" cx="82" cy="31" r="2"/><circle class="m-eye" cx="88" cy="70" r="1.6"/>' +
    '<path class="m-edge" d="M38 80 Q58 92 78 80"/><path class="m-bone" d="M46 84 V89 M54 86 V92 M62 86 V92 M70 84 V89"/>',
  drakeMob:
    '<path class="m-body" d="M84 54 L97 45 L93 58 M95 65 L109 58 L103 71 M103 79 L117 74 L109 87"/>' +
    '<path class="m-body" d="M116 118 C110 86 100 66 84 54 C74 46 62 42 50 44 L26 50 C16 52 12 58 16 62 L36 64 L22 72 C18 76 22 80 28 78 L52 72 C64 74 72 82 78 94 C84 106 86 114 86 118Z"/>' +
    '<path class="m-body" d="M68 46 L88 24 L78 48Z M58 44 L66 20 L64 46Z"/>' +
    '<circle class="m-eye" cx="44" cy="52" r="2.7"/><path class="m-bone" d="M24 62 L26 66 L28 62 M30 63 L32 67"/>',
};

// A foe's drawing as an SVG string, for openModal's art or h()'s html prop. Code-built, never player text.
export function monsterArt(mob, elite = false) {
  const rank = mob.archetype === "sovereign" ? " sovereign" : elite ? " elite" : "";
  return `<svg class="m-art${rank}" viewBox="0 0 120 120" aria-hidden="true" focusable="false">${MONSTER_ART[mob.icon] || MONSTER_ART.horror}</svg>`;
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
  const you = statsOf(state);
  // What reaches you in a minute of its swings, after your Defence on its own ground.
  const perMinute = (n.attack * (1 - mitigation(you.defence, mob.tier)) * 60000) / mob.speed;
  const goldMult = 1 + companionBonus(state, "gold");
  const dropMult = 1 + companionBonus(state, "drops");
  const rare = companionBonus(state, "rare");

  const stats = h("div.stats",
    stat("Health", fmt(n.hp)),
    stat("Attack", `${fmtStat(n.attack)} a blow`),
    stat("Against you", `About ${fmtStat(perMinute)} a minute`),
    // Its Defence as a number. What that works out to is "Against you", above.
    stat("Defence", fmtStat(mob.defence)),
    stat("Swings every", `${(mob.speed / 1000).toFixed(1)}s`),
    stat("Experience", `${fmtStat(n.xp * xpMult(state, "warfare", ctx.now))} a kill, more deeper in`),
    sov ? null : stat("Threat", `${n.threat} a kill, more deeper in`),
    stat("Gold", `${fmtGold(Math.round(n.gold[0] * goldMult))} to ${fmtGold(Math.round(n.gold[1] * goldMult))}`, "gold"));

  if (sov) {
    const S = GameData.SOVEREIGN;
    stats.appendChild(stat("Enrages", `+${pctOf(S.enrage)} attack every ${S.enrageMs / 1000}s`));
  } else {
    const e = foeNumbers(mob, true);
    stats.appendChild(stat("As an Elite", `${fmt(e.hp)} health · ${fmtStat(e.attack)} a blow · ×${GameData.ELITE.xp} XP`));
  }

  const rows = mob.drops.map(([key, qty, chance]) => {
    const d = itemDef(key);
    return h("div.ap-row",
      h("button.ap-link", { type: "button", dataset: { item: key } }, iconEl(d ? d.icon : "unknown"), h("span", `${itemName(key)} ×${qty}`)),
      h("span.ap-val", chancePct(Math.min(1, chance * dropMult))));
  });
  rows.push(sov ? note("Epic gear", "Always") : note("Elites drop", `×${GameData.ELITE.drops}`));
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
