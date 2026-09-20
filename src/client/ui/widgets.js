/* ============================================================
   Respite · widgets.js · The Workbench
   ------------------------------------------------------------
   Small pieces more than one page needs: the quantity picker,
   the popup registry (so a page can open another page's popup
   without importing it), and the gold-spend confirmation.
   ============================================================ */

import { h, on, setAttr, toggleClass } from "./dom.js";
import { iconEl } from "./icons.js";
import { confirm, toast } from "./overlay.js";
import { fmtWhole } from "./format.js";

/* ================= 0. THE COMMANDER'S FACE ================= */

/* Wherever a commander is drawn -- the Character hero, the paperdoll, the arena,
   your square in a party band -- it is the same face, and it follows the likeness
   on the save. By convention that is assets/commander-<sex>.webp; a save with no
   likeness yet, or a likeness whose art is missing, falls back to the default
   bust rather than showing a broken frame.

   The crop is CSS (.portrait, .portrait-bust in components.css) and never
   redeclared per page, so one rule decides framing everywhere. */

export const DEFAULT_PORTRAIT = "assets/commander-default.webp";
export const portraitFor = (sex) => (sex ? `assets/commander-${sex}.webp` : DEFAULT_PORTRAIT);

export function portraitImg(sex, extra = {}) {
  const img = h("img", Object.assign({ src: portraitFor(sex), alt: "" }, extra));
  img.addEventListener("error", () => {
    if (img.getAttribute("src") === DEFAULT_PORTRAIT) return;
    img.setAttribute("src", DEFAULT_PORTRAIT);
  });
  return img;
}

// Swaps the face inside `box` when the likeness changes, and not otherwise.
export function paintPortrait(box, sex, was) {
  if (sex === was) return was;
  box.replaceChildren(portraitImg(sex));
  return sex;
}

/* ================= 1. QUANTITY PICKER ================= */
/* UI-KIT.md 7.11. Unlimited is an empty box with a "No limit" placeholder and a
   pressed "No limit" chip, never a symbol. */

export function qtyPicker({ value = 1, max = 9999, unlimited = false, allowUnlimited = true, presets = [1, 10, 100], showMin = false, onChange = null } = {}) {
  const pick = { n: value, unlimited: allowUnlimited && unlimited };
  const input = h("input.qty-input", {
    type: "text", inputmode: "numeric", autocomplete: "off", "aria-label": "How many",
    // Only an unlimited-capable box promises no limit.
    placeholder: allowUnlimited ? "No limit" : "",
  });
  const dec = h("button.qty-btn", { type: "button", "aria-label": "One fewer" }, iconEl("minus"));
  const inc = h("button.qty-btn", { type: "button", "aria-label": "One more" }, iconEl("plus"));
  const chips = presets.map((n) => h("button.chip", { type: "button", "data-q": String(n) }, fmtWhole(n)));
  // Min and Max are the two ends of the box: enough on their own where the numbered presets only added noise.
  const minChip = showMin ? h("button.chip", { type: "button", "data-q": "min" }, "Min") : null;
  const maxChip = h("button.chip", { type: "button", "data-q": "max" }, "Max");
  const noLimit = allowUnlimited ? h("button.chip.chip-wide", { type: "button", "data-q": "none" }, "No limit") : null;
  /* With no numbered presets, Min and Max are the two ends of the stepper itself:
     one row of Min - value + Max, which is the whole decision in one line. Only a
     picker that still offers preset counts keeps a second row for them. */
  const inline = showMin && !chips.length && !noLimit;
  const node = inline
    ? h("div.qty.qty-inline", h("div.qty-stepper", minChip, dec, input, inc, maxChip))
    : h("div.qty", h("div.qty-stepper", dec, input, inc), h("div.qty-presets", minChip, chips, maxChip, noLimit));

  // notify is false for redraws from outside, so a caller's onChange never loops back into refresh().
  const show = (notify = true) => {
    pick.n = Math.max(1, Math.min(max, Math.floor(pick.n) || 1));
    input.value = pick.unlimited ? "" : String(pick.n);
    toggleClass(node, "is-unlimited", pick.unlimited);
    if (noLimit) setAttr(noLimit, "aria-pressed", String(pick.unlimited));
    chips.forEach((c) => setAttr(c, "aria-pressed", String(!pick.unlimited && Number(c.dataset.q) === pick.n)));
    if (minChip) setAttr(minChip, "aria-pressed", String(!pick.unlimited && pick.n === 1));
    setAttr(maxChip, "aria-pressed", String(!pick.unlimited && pick.n === max));
    dec.disabled = !pick.unlimited && pick.n <= 1;
    inc.disabled = !pick.unlimited && pick.n >= max;
    if (notify && onChange) onChange(pick);
  };

  dec.addEventListener("click", () => { pick.n = (pick.unlimited ? max : pick.n) - 1; pick.unlimited = false; show(); });
  inc.addEventListener("click", () => { if (!pick.unlimited) pick.n += 1; show(); });
  on(node, "click", ".chip[data-q]", (e, b) => {
    const q = b.dataset.q;
    if (q === "none") pick.unlimited = true;
    else if (q === "max") { pick.unlimited = false; pick.n = max; }
    else if (q === "min") { pick.unlimited = false; pick.n = 1; }
    else { pick.unlimited = false; pick.n = Number(q); }
    show();
  });
  input.addEventListener("input", () => {
    const digits = input.value.replace(/[^0-9]/g, "");
    if (digits !== input.value) input.value = digits;
    if (!digits) return;
    pick.unlimited = false;
    pick.n = Number(digits);
    if (pick.n > max) show(); else if (onChange) onChange(pick);
  });
  input.addEventListener("blur", () => show());
  show(false);
  return {
    node,
    pick,
    input,
    // The most possible can change underneath (stock used up); keep the box honest, but never while typing.
    refresh(nextMax) {
      if (nextMax != null) max = Math.max(1, Math.floor(nextMax));
      if (document.activeElement !== input) show(false);
    },
    // What to send as a command's limit: null for No limit.
    limit: () => (pick.unlimited ? null : pick.n),
  };
}

/* ================= 2. POPUP REGISTRY ================= */
/* Popups belong to the page that knows them best (the item popup to storage,
   the zone popup to the hunt, the sell dialog to the market). Anything can open
   one by name: openPopup("item", ctx, key, { from }). */

const POPUPS = new Map();

export function registerPopup(name, open) {
  POPUPS.set(name, open);
}

export const hasPopup = (name) => POPUPS.has(name);

export function openPopup(name, ctx, ...args) {
  const open = POPUPS.get(name);
  if (!open) {
    toast("That isn't ready yet", { kind: "warn" });
    return null;
  }
  return open(ctx, ...args);
}

/* ================= 3. SPENDING GOLD ================= */
/* Every gold spend asks first (UI-REQUIREMENTS 9). Resolves true to go ahead. */

export function confirmSpend(ctx, { title, body = null, gold, confirmText = null, art = null }) {
  return confirm({
    title,
    body,
    art,
    confirmText: confirmText || "Pay",
    cost: { gold: Math.max(0, Math.floor(gold)), have: Math.floor(ctx.state.player.gold) },
  });
}
