/* ============================================================
   Respite · pages/armaments.js · The Satchel
   ------------------------------------------------------------
   What you carry and what you wear: Belongings (the slot grid
   the Stockpile page builds), the paperdoll and your Standing.
   Remedies live in Belongings, so the hunter has them to hand.

   The discipline and the Veil appear only once a discipline is
   chosen. Nothing here writes the save: worn pieces open the item
   popup, which sends the commands.

   `dollCard` and `standingCard` are exported: the Character page's
   first tab shows the same two beside each other, and one paperdoll
   in the repo beats two that drift apart.
   ============================================================ */

import { h, on, setText, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { fmtWhole, fmtStat } from "../ui/format.js";
import { openPopup } from "../ui/widgets.js";
import { storageCard } from "./stockpile.js";
import { itemDef, itemName } from "../../shared/items.js";
import { wearPct } from "../../shared/combat.js";
import { GameData } from "../../shared/registry.js";
import { statsOf, myClass, skillLevel } from "../../shared/stats.js";
import { currentRegion } from "../../shared/world.js";

const { DOLL_ORDER, SLOT_LABELS, SLOT_GLYPHS } = GameData;

// Armour down the left of the figure; hands and jewellery down the right, each in DOLL_ORDER.
const ARMOUR = new Set(["head", "chest", "hands", "feet"]);
const LEFT = DOLL_ORDER.filter((s) => ARMOUR.has(s));
const RIGHT = DOLL_ORDER.filter((s) => !ARMOUR.has(s));

const pct = (x) => `${+((Number(x) || 0) * 100).toFixed(1)}%`;
const wearClass = (p) => (p > 60 ? "is-fine" : p > 25 ? "is-worn" : "is-bad");

// The account name, or "Commander" until there is one.
function commanderName(ctx) {
  const name = ctx.state.meta.account || (ctx.account && ctx.account.username) || "";
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Commander";
}

/* ================= 1. THE PAPERDOLL ================= */

function dollSlot(state, slot) {
  const key = state.equipment[slot];
  const label = SLOT_LABELS[slot];
  const d = key ? itemDef(key) : null;
  if (!d) {
    return h("div.doll-slot.is-empty", { role: "img", "aria-label": `${label}: empty` },
      h("span.doll-slot-top", h("span.doll-slot-l", label)),
      h("span.doll-slot-art", iconEl(SLOT_GLYPHS[slot])),
      h("span.doll-slot-name", "Empty"));
  }
  const worn = wearPct(state, key) != null;
  const twoHands = slot === "weapon" && d.twoHanded;
  return h("button.doll-slot", {
    type: "button",
    class: twoHands && "is-span",
    "data-rarity": d.rarity || "common",
    // The spanning slot says what it covers to those who cannot see it span.
    dataset: { key, slot, label: twoHands ? "Weapon, both hands" : label, name: itemName(key) },
  },
    h("span.doll-slot-top", h("span.doll-slot-l", label), worn ? h("span.doll-wear") : null),
    h("span.doll-slot-art", iconEl(d.icon)),
    h("span.doll-slot-name", itemName(key)));
}

/* `link` puts a small quiet link in the card head ({ href, label }). The Satchel
   itself needs none; the Character tab uses it to point back here. */
export function dollCard(ctx, { link = null } = {}) {
  const linkNode = link ? h("a.btn.btn-sm.btn-quiet", { href: link.href }, link.label, iconEl("arrow-right")) : null;
  const chips = h("div.card-actions");
  const left = h("div.doll-col");
  const right = h("div.doll-col");
  const nameNode = h("div.doll-name");
  const subNode = h("div.doll-sub");
  const node = h("section.card",
    h("div.card-head", h("div", h("h2.card-title", "Worn")), chips),
    h("div.doll",
      left,
      h("div.doll-figure",
        h("div.portrait", h("img", { src: "assets/commander-default.webp", alt: "" })),
        nameNode,
        subNode),
      right));

  let sig = null;
  let classSig = null;

  on(node, "click", "button.doll-slot[data-key]", (e, b) => {
    openPopup("item", ctx, b.dataset.key, { from: "worn" });
  });

  return {
    node,
    update(nextCtx) {
      ctx = nextCtx;
      const state = ctx.state;
      const eq = state.equipment;

      const next = DOLL_ORDER.map((s) => eq[s] || "-").join(",");
      if (next !== sig) {
        sig = next;
        const weapon = eq.weapon ? itemDef(eq.weapon) : null;
        const twoHands = !!(weapon && weapon.twoHanded);
        // A two-handed weapon takes the offhand's place as well.
        const shown = (slots) => slots.filter((s) => !(s === "offhand" && twoHands));
        left.replaceChildren(...shown(LEFT).map((s) => dollSlot(state, s)));
        right.replaceChildren(...shown(RIGHT).map((s) => dollSlot(state, s)));
        toggleClass(left, "has-span", twoHands && LEFT.includes("weapon"));
        toggleClass(right, "has-span", twoHands && RIGHT.includes("weapon"));
      }

      // Wear moves with every kill, so it is painted in place.
      node.querySelectorAll("button.doll-slot[data-key]").forEach((b) => {
        const p = wearPct(state, b.dataset.key);
        const tag = b.querySelector(".doll-wear");
        if (tag && p != null) {
          setText(tag, `${p}%`);
          ["is-fine", "is-worn", "is-bad"].forEach((c) => toggleClass(tag, c, c === wearClass(p)));
        }
        setAttr(b, "aria-label", `${b.dataset.label}: ${b.dataset.name}${p != null ? `, ${p}% condition` : ""}`);
      });

      const k = myClass(state);
      const region = currentRegion(state);
      const nextClass = k ? k.id : "";
      if (nextClass !== classSig) {
        classSig = nextClass;
        chips.replaceChildren(...[k ? h("span.chip.chip-violet", k.name) : null, linkNode].filter(Boolean));
      }
      setText(nameNode, commanderName(ctx));
      setText(subNode, [k && k.name, region.name].filter(Boolean).join(" · "));
    },
  };
}

/* ================= 2. STANDING ================= */

function standingRows(state) {
  const s = statsOf(state);
  const k = myClass(state);
  return [
    k && ["Discipline", k.name, "good"],
    ["Health", fmtWhole(s.maxHp)],
    ["Attack", fmtStat(s.attack), "gold"],
    // A flat number, never the share it stops: the mitigation curve is the engine's business.
    ["Defence", fmtStat(s.defence)],
    ["Swing", `${(s.speed / 1000).toFixed(1)}s`],
    ["Crit chance", pct(s.crit)],
    ["Crit damage", pct(s.critDmg)],
    ["Penetration", pct(s.pen)],
    k && ["Veil", s.absorb ? `+${fmtStat(s.absorb)} a second` : `+${fmtStat(s.veilGain)} a blow`],
    ["Hunt", `Lv ${skillLevel(state, "warfare")}`, "good"],
  ].filter(Boolean);
}

export function standingCard() {
  const list = h("div.stats");
  const node = h("section.card",
    h("div.card-head", h("div",
      h("h2.card-title", "Standing"),
      h("p.card-sub", "Defence counts against the ground you are on."))),
    list);
  let sig = null;
  return {
    node,
    update(ctx) {
      const rows = standingRows(ctx.state);
      const next = JSON.stringify(rows);
      if (next === sig) return;
      sig = next;
      list.replaceChildren(...rows.map(([l, v, tone, small]) =>
        h("div.stat", h("span.l", l), h("span.v", { class: tone && `t-${tone}` }, v, small ? h("small", small) : null))));
    },
  };
}

/* ================= 3. THE PAGE ================= */

// The filter and sort Belongings shows, for the length of the session.
const VIEW = { pool: "inv", filter: "all", sort: "custom" };

export default {
  id: "armaments",
  title: () => "Satchel",
  group: "The Vanguard",

  mount(view, ctx) {
    const store = storageCard(ctx, { pools: ["inv"], view: VIEW, idBase: "arm" });
    const doll = dollCard(ctx);
    const standing = standingCard();

    view.appendChild(h("div.page",
      h("header.page-head", h("div",
        h("div.eyebrow.page-eyebrow", "The Vanguard"),
        h("h1.page-title", "Satchel"),
        h("p.page-sub", "What you carry into the hunt and what you wear there. Remedies live here, in Belongings."))),
      h("div.storage",
        store.node,
        h("aside.storage-side", { "aria-label": "Worn and standing" }, doll.node, standing.node))));

    const update = (next) => {
      store.update(next);
      doll.update(next);
      standing.update(next);
    };
    update(ctx);

    return {
      update,
      unmount() { store.destroy(); },
    };
  },
};
