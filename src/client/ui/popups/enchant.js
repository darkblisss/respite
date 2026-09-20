/* ============================================================
   Respite · popups/enchant.js · The Veilsmith
   ------------------------------------------------------------
   Working the Veil into a piece of gear. The stone is Veil
   Essence of the piece's own band, and one to three of them go
   on the anvil at a time: more stones, better odds, and nothing
   else changes.

   The whole of the bargain is on the card before the press. A
   failure takes the stones and leaves the piece exactly as it
   was -- no level lost, nothing destroyed -- so the only thing
   at stake is Essence, and the player should be able to see
   precisely how much before they stake it.

   Every number comes off enchantPlan(); this only draws it.
   ============================================================ */

import { h, setText, setAttr, setWidth, toggleClass } from "../dom.js";
import { iconEl } from "../icons.js";
import { openModal, toast } from "../overlay.js";
import { registerPopup } from "../widgets.js";
import { fmt, fmtWhole } from "../format.js";
import { itemName } from "../../../shared/items.js";
import { enchantPlan } from "../../../shared/world.js";

const pct = (share) => `${Math.round(share * 100)}%`;

registerPopup("enchant", (ctx, key, { from } = {}) => {
  const first = enchantPlan(ctx.state, key);
  if (!first) {
    toast("Only gear takes the Veil", { kind: "warn" });
    return null;
  }

  let stones = 1;
  let busy = false;
  let m = null;

  const stand = h("p.modal-note");
  const stock = h("span.chip");
  const rows = h("div.pick-list");
  const outcome = h("p.field-hint.t-bad", { hidden: true, role: "status" });
  const bar = h("i");

  function rowFor(opt) {
    const chance = h("b");
    const note = h("span.lr-sub");
    const node = h("button.pick-row", {
      type: "button", dataset: { stones: String(opt.stones) }, "aria-pressed": "false",
    },
      h("span.lr-main",
        h("span.lr-title", `${opt.stones} ${opt.stones === 1 ? "stone" : "stones"}`),
        note),
      h("span.lr-end", chance));
    return { node, chance, note };
  }

  const refs = first.options.map((opt) => {
    const R = rowFor(opt);
    rows.appendChild(R.node);
    return R;
  });

  function paint() {
    const plan = enchantPlan(ctx.state, key);
    if (!plan) return;
    if (plan.maxed) {
      setText(stand, `This piece holds all the Veil it will take: +${plan.max}.`);
      setAttr(rows, "hidden", true);
      if (m && m.buttons && m.buttons[1]) m.buttons[1].disabled = true;
      return;
    }
    setText(stand, `At +${plan.level}, going to +${plan.level + 1}. Every level is worth ${pct(plan.gain)} more of everything the piece carries, and a failed attempt costs the stones and nothing else.`);
    setText(stock, `${fmt(plan.have)} ${itemName(plan.stone)} held`);
    toggleClass(stock, "chip-bad", plan.have < 1);

    plan.options.forEach((opt, i) => {
      const R = refs[i];
      if (!R) return;
      setText(R.chance, pct(opt.chance));
      setText(R.note, opt.afford
        ? opt.chance >= 1 ? "Certain" : `About ${(1 / opt.chance).toFixed(1)} attempts, ${(opt.stones / opt.chance).toFixed(1)} Essence`
        : "Not enough Essence");
      R.node.disabled = !opt.afford;
      setAttr(R.node, "aria-pressed", opt.stones === stones ? "true" : "false");
      toggleClass(R.node, "is-current", opt.stones === stones);
    });

    const picked = plan.options.find((o) => o.stones === stones);
    setWidth(bar, picked ? picked.chance * 100 : 0);
    const go = m && m.buttons ? m.buttons[1] : null;
    if (go) {
      go.disabled = busy || !picked || !picked.afford;
      setText(go.querySelector("span") || go, picked ? `Work it \u00b7 ${picked.stones} Essence` : "Work it");
    }
  }

  rows.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-stones]");
    if (!btn || btn.disabled) return;
    stones = Number(btn.dataset.stones) || 1;
    paint();
  });

  async function work() {
    if (busy) return false;
    busy = true;
    paint();
    try {
      const res = await ctx.dispatch("enchant", { key, from, stones });
      const data = res && res.data;
      if (!res || !res.ok) return false;
      if (data && data.won) {
        toast(`+${data.level}: ${itemName(data.key)}`, { kind: "gold", icon: "sparkle" });
        m.close("action");
        return false;
      }
      setText(outcome, "The Veil would not take. The stones are gone; the piece is untouched.");
      setAttr(outcome, "hidden", false);
      return false;
    } finally {
      busy = false;
      paint();
    }
  }

  m = openModal({
    title: `Work the Veil into the ${itemName(key)}`,
    sub: "Veil Essence of this piece's own band. One to three on the anvil.",
    art: "gem",
    size: "md",
    body: h("div.vstack.gap-3",
      stand,
      h("div.hstack.gap-2", stock),
      rows,
      h("div.bar.bar-gold", { "aria-hidden": "true" }, bar),
      h("p.small.muted", "Nothing is destroyed and no level is ever lost. Only the stones are at stake."),
      outcome),
    actions: [
      { label: "Close", kind: "quiet" },
      { label: "Work it", kind: "gold", onClick: work, keep: true },
    ],
  });
  paint();
  return m;
});
