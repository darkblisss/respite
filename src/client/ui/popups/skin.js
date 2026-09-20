/* ============================================================
   Respite · popups/skin.js · The Muster Roll
   ------------------------------------------------------------
   Asked once, when the camp is founded: which of the two you
   are. A skin is a face and nothing else -- no stat, no roll,
   no drop turns on it -- so there is nothing here to weigh up
   and nothing to regret. It decides the figure on the muster
   roll, and every other place the camp draws you.

   Not put away until a choice is made, the way the discipline
   picker is not. A camp that has never picked one (a new one, or
   one from before skins existed) is asked the next time the
   Character page opens.
   ============================================================ */

import { h } from "../dom.js";
import { openModal, toast } from "../overlay.js";
import { registerPopup, portraitImg } from "../widgets.js";
import { GameData } from "../../../shared/registry.js";

// The picker on screen, so a second call (a page mount and a click) never stacks another.
let current = null;

function cardInner(def) {
  return [
    h("span.portrait.portrait-bust.skin-pick-art", portraitImg(def.id)),
    h("span.class-name", def.name),
    h("span.class-blurb", def.note),
  ];
}

registerPopup("skin", (ctx) => {
  if (current && !current.closed) return current;
  if (ctx.state.player.skin) return null;

  let busy = false;
  let offTick = () => {};
  let m = null;

  async function choose(def) {
    if (busy || !m || m.closed) return;
    busy = true;
    try {
      const res = await ctx.dispatch("setSkin", { skin: def.id });
      if (res && res.ok) {
        toast(`${def.name} it is`, { kind: "good", icon: "person" });
        m.close("action");
      }
    } finally {
      busy = false;
    }
  }

  const cards = GameData.SKINS.map((def) => h("button.card.card-link.class-card.skin-card", {
    type: "button", onClick: () => choose(def),
  }, cardInner(def)));

  m = openModal({
    title: "Pick your skin",
    sub: "Two to start with. It is the figure the camp draws wherever you are shown, and it changes nothing you can fight with.",
    art: "person",
    size: "lg",
    dismissible: false,
    body: h("div.grid-cards.class-grid.skin-grid", cards),
    onClose: () => {
      offTick();
      if (current === m) current = null;
    },
  });
  current = m;

  // Chosen elsewhere (another tab, the server's answer): nothing is left to pick here.
  offTick = ctx.onTick(() => {
    if (!m.closed && ctx.state.player.skin) m.close("action");
  });
  return m;
});
