/* ============================================================
   Respite · pages/companions.js · The Fireside
   ------------------------------------------------------------
   Each kind is bought once and one walks with you at a time.
   Bond grows by the minute while work or a hunt runs and opens
   extra traits; Rank rises as more of a kind you own turn up.
   Cards rebuild when something you can act on changes (owned, at
   your side, a Rank, a find, a Bond level); Bond bars creep in
   place. Buying asks about the gold first.
   ============================================================ */

import { h, qs, setText, setWidth, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { fmtGold, fmtWhole } from "../ui/format.js";
import { confirmSpend } from "../ui/widgets.js";
import { CONFIG } from "../../shared/config.js";
import { GameData } from "../../shared/registry.js";
import { companionInfo, activeCompanion } from "../../shared/companions.js";

const N = GameData.RANK_NUMERALS;
const MAX_RANK = CONFIG.companions.maxRank;

// A trait's share as it reads on the card: 0.1 -> "+10%", 0.025 -> "+2.5%".
const share = (v) => `+${+(v * 100).toFixed(1)}%`;

function rankLine(i) {
  const def = i.def;
  if (!i.owned) return `Once it is yours, more turn up ${def.sourceText}. Each one raises its Rank.`;
  if (i.rank >= MAX_RANK) return `Rank ${N[i.rank]}. Nothing more to find.`;
  return `${fmtWhole(i.dupes)} of ${fmtWhole(i.needDupes)} found toward Rank ${N[i.rank + 1]}. More turn up ${def.sourceText}.`;
}

export default {
  id: "companions",
  title: () => "Companions",
  group: "The Vanguard",

  mount(view, ctx) {
    const walking = h("span.chip", iconEl("paw"), h("span"));
    const grid = h("div.grid-cards");
    let sig = "";
    let bars = [];          // { id, pct, fill, bar } for owned companions

    view.appendChild(h("div.page",
      h("header.page-head",
        h("div",
          h("div.eyebrow.page-eyebrow", "The Vanguard"),
          h("h1.page-title", "Companions"),
          h("p.page-sub", "One walks with you at a time. Its Bond grows for every minute at your side while you work or hunt. Now and then another of a kind you own turns up, and each one raises its Rank.")),
        h("div.page-actions", walking)),
      grid));

    function card(i) {
      const def = i.def;
      let meter = null;
      if (i.owned) {
        const ref = { id: def.id, pct: h("b"), fill: h("i") };
        ref.bar = h("div.bar", { "aria-hidden": "true" }, ref.fill);
        bars.push(ref);
        meter = h("div.meter", h("div.meter-top", h("span", `Bond ${i.level}`), ref.pct), ref.bar);
      }
      const action = !i.owned
        ? h("button.btn.btn-gold.btn-soft", { type: "button", onClick: () => buy(def) }, iconEl("coin"), `Buy · ${fmtGold(def.cost)}`)
        : i.active
          ? h("button.btn.btn-quiet", { type: "button", onClick: () => walk(def, null) }, "Leave at camp")
          : h("button.btn.btn-primary.btn-soft", { type: "button", onClick: () => walk(def, def.id) }, "Walk with me");

      return h("article.card.comp-card", { class: { "is-active": i.active }, "data-comp": def.id },
        h("div.comp-top",
          h("div.art.art-lg", { "data-tone": i.owned ? "tan" : "neutral", "aria-hidden": "true" }, iconEl(def.icon)),
          h("div.grow",
            h("h2.comp-name", def.name),
            h("div.comp-sub", i.owned ? `Rank ${N[i.rank]} · Bond ${i.level}` : fmtGold(def.cost))),
          i.active ? h("span.tag.tag-tan", "At your side") : null),
        h("p.comp-blurb", def.blurb),
        h("div.well.comp-trait", h("span.t-name", def.trait.name), h("span.t-val", `${share(i.trait)} ${def.trait.text}`)),
        meter,
        h("p.small.muted", rankLine(i)),
        h("ul.comp-unlocks", { "aria-label": `${def.name}: what Bond and Rank open` }, i.unlocks.map((u) =>
          h("li", { class: { "is-open": u.open } },
            h("span.g", { "aria-hidden": "true" }, u.open ? iconEl("check") : null),
            h("span.req", u.bond ? `Bond ${u.bond}` : `Rank ${N[u.rank]}`),
            h("span", u.text, h("span.sr-only", u.open ? ", open" : ", not yet"))))),
        h("div.comp-actions", action));
    }

    function paint() {
      const state = ctx.state;
      const infos = GameData.COMPANIONS.map((def) => companionInfo(state, def.id));
      const next = infos.map((i) => [i.owned ? 1 : 0, i.active ? 1 : 0, i.rank, i.dupes, i.level].join(":")).join("|");
      if (next !== sig) {
        sig = next;
        bars = [];
        grid.replaceChildren(...infos.map(card));
      }

      const active = activeCompanion(state);
      setText(walking.lastChild, active ? `${active.name} walks with you` : "Nobody walks with you");
      toggleClass(walking, "chip-tan", !!active);

      bars.forEach((ref) => {
        const i = infos.find((x) => x.def.id === ref.id);
        const pct = i.maxed ? 100 : (i.bondInto / i.bondSpan) * 100;
        setText(ref.pct, i.maxed ? "Fully bonded" : `${Math.floor(pct)}%`);
        setWidth(ref.fill, pct);
        toggleClass(ref.bar, "bar-good", i.maxed);
      });
    }

    // A buy or a change of company rebuilds the cards; keep focus on the one acted on.
    function refocus(id) {
      paint();
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const btn = qs(`[data-comp="${id}"] .comp-actions .btn`, grid);
      if (btn) btn.focus({ preventScroll: true });
    }

    async function buy(def) {
      const ok = await confirmSpend(ctx, {
        title: `Buy the ${def.name}?`,
        body: activeCompanion(ctx.state)
          ? `${def.name} joins the camp. Take it along whenever you like.`
          : `${def.name} joins the camp and walks with you at once.`,
        gold: def.cost,
        confirmText: `Buy for ${fmtGold(def.cost)}`,
      });
      if (!ok) return;
      const res = await ctx.dispatch("buyCompanion", { id: def.id });
      if (res.ok) refocus(def.id);
    }

    async function walk(def, id) {
      const res = await ctx.dispatch("setCompanion", { id });
      if (res.ok) refocus(def.id);
    }

    paint();
    return { update: paint };
  },
};
