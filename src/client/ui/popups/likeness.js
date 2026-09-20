/* ============================================================
   Respite · popups/likeness.js · The Muster Roll
   ------------------------------------------------------------
   Asked once, when the camp is founded: who is it you are. Man
   or Woman, and nothing else -- no stat, no roll, no drop turns
   on it, so there is nothing here to weigh up and nothing to
   regret. It decides the face on the muster roll and how the
   camp speaks of you.

   Not put away until a choice is made, the way the discipline
   picker is not. A save that has never carried a likeness (an
   older camp, a guest who skipped it) is asked the next time the
   Character page opens.
   ============================================================ */

import { h } from "../dom.js";
import { iconEl } from "../icons.js";
import { openModal, toast } from "../overlay.js";
import { registerPopup } from "../widgets.js";
import { GameData } from "../../../shared/registry.js";

// The picker on screen, so a second call (a page mount and a click) never stacks another.
let current = null;

export const DEFAULT_PORTRAIT = "assets/commander-default.webp";

/* Art for a likeness, by convention: assets/commander-<id>.webp, falling back to
   the default bust the moment one is missing. Dropping the two files in is all it
   takes to give the roll real faces. */
export const portraitFor = (sex) => (sex ? `assets/commander-${sex}.webp` : DEFAULT_PORTRAIT);

// One <img> that quietly falls back rather than showing a broken frame.
export function portraitImg(sex, extra = {}) {
  const img = h("img", Object.assign({ src: portraitFor(sex), alt: "" }, extra));
  img.addEventListener("error", () => {
    if (img.getAttribute("src") === DEFAULT_PORTRAIT) return;
    img.setAttribute("src", DEFAULT_PORTRAIT);
  });
  return img;
}

function cardInner(def) {
  return [
    h("span.hstack.gap-3",
      h("span.art.art-sm", { "aria-hidden": "true" }, iconEl("person")),
      h("span.class-name", def.name)),
    h("span.class-blurb", "Nothing a fight reads turns on this. It is the face on the roll and the word the camp uses for you."),
  ];
}

registerPopup("likeness", (ctx) => {
  if (current && !current.closed) return current;
  if (ctx.state.player.sex) return null;

  let busy = false;
  let offTick = () => {};
  let m = null;

  async function choose(def) {
    if (busy || !m || m.closed) return;
    busy = true;
    try {
      const res = await ctx.dispatch("setSex", { sex: def.id });
      if (res && res.ok) {
        toast(`The roll reads: ${def.name}`, { kind: "good", icon: "person" });
        m.close("action");
      }
    } finally {
      busy = false;
    }
  }

  const cards = GameData.SEXES.map((def) => h("button.card.card-link.class-card", {
    type: "button", onClick: () => choose(def),
  }, cardInner(def)));

  m = openModal({
    title: "Who are you?",
    sub: "Set once, when the camp is founded. It changes nothing you can fight with.",
    art: "person",
    size: "lg",
    dismissible: false,
    body: h("div.grid-cards.class-grid", cards),
    onClose: () => {
      offTick();
      if (current === m) current = null;
    },
  });
  current = m;

  // Chosen elsewhere (another tab, the server's answer): nothing is left to pick here.
  offTick = ctx.onTick(() => {
    if (!m.closed && ctx.state.player.sex) m.close("action");
  });
  return m;
});
