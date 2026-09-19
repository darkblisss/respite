/* ============================================================
   Respite · popups/class.js · The Oath
   ------------------------------------------------------------
   The discipline picker. Offered at Hunt level 5 and not put away
   until a choice is made: Warrior, Rogue or Mage, each with its
   own bulk and swing and its own use for a full Veil. Set once.

   Once a discipline is held it opens as a plain look at the three
   (yours marked). Before Hunt level 5 it does not open at all:
   nothing about disciplines or the Veil shows until then.
   ============================================================ */

import { h } from "../dom.js";
import { iconEl } from "../icons.js";
import { openModal, confirm, toast } from "../overlay.js";
import { registerPopup } from "../widgets.js";
import { CONFIG } from "../../../shared/config.js";
import { GameData, getClass } from "../../../shared/registry.js";
import { canPickClass } from "../../../shared/stats.js";

// The picker on screen, so a second call (the event and a click) never stacks another.
let current = null;

// v4's five numbers: what the discipline does to a hunter of any level.
const numbers = (c) => [
  `Health ×${c.health}`,
  `Attack ×${c.attack}`,
  `Defence ×${c.defence}`,
  `${(c.speed / 1000).toFixed(1)}s swing`,
  `${Math.round(c.crit * 100)}% crit`,
];

function cardInner(c, mine) {
  return [
    h("span.hstack.gap-3",
      h("span.art.art-sm", { "aria-hidden": "true" }, iconEl(c.icon)),
      h("span.class-name", c.name),
      mine ? h("span.tag.tag-veil.ml-auto", "Yours") : null),
    h("span.class-blurb", c.blurb),
    h("span.chip-row", numbers(c).map((t) => h("span.chip", t))),
    h("span.class-veil", `${c.veilName}. ${c.veilNote}`),
  ];
}

registerPopup("class", (ctx) => {
  if (current && !current.closed) return current;
  const state = ctx.state;
  const choosing = canPickClass(state);
  const held = getClass(state.player.klass);
  if (!choosing && !held) return null;

  let busy = false;
  let offTick = () => {};
  let m = null;

  async function choose(c) {
    if (busy || !m || m.closed) return;
    busy = true;
    try {
      const sure = await confirm({
        title: `Take up the ${c.name}'s discipline?`,
        body: "Set once. It can't be changed.",
        confirmText: `Become a ${c.name}`,
        art: c.icon,
        artTone: "veil",
      });
      if (!sure || m.closed) return;
      const res = await ctx.dispatch("pickClass", { id: c.id });
      if (res && res.ok) {
        toast(`${c.name} chosen`, { kind: "good", icon: c.icon });
        m.close("action");
      }
    } finally {
      busy = false;
    }
  }

  const cards = GameData.CLASSES.map((c) => (choosing
    ? h("button.card.card-link.class-card", { type: "button", onClick: () => choose(c) }, cardInner(c, false))
    // A look, not a choice: no pointer, no press.
    : h("div.card.vstack.gap-3", { "data-tone": held.id === c.id ? "veil" : null }, cardInner(c, held.id === c.id))));

  m = openModal({
    title: choosing ? "Choose your discipline" : "Disciplines",
    sub: choosing
      ? `Set once, at Hunt level ${CONFIG.progression.classPickLevel}. It opens the Veil and decides your bulk, your speed, and what the Veil does when it fills.`
      : `You walk the ${held.name}'s path. Set once, it can't be changed.`,
    art: "sparkle",
    size: "xl",
    dismissible: !choosing,
    body: h("div.grid-cards.class-grid", cards),
    onClose: () => {
      offTick();
      if (current === m) current = null;
    },
  });
  current = m;

  // Chosen elsewhere (another tab, the server's answer): nothing is left to pick here.
  if (choosing) {
    offTick = ctx.onTick(() => {
      if (!m.closed && !canPickClass(ctx.state)) m.close("action");
    });
  }
  return m;
});
