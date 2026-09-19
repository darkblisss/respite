/* ============================================================
   Respite · pages/atlas.js · The Map Room
   ------------------------------------------------------------
   Every region in one list, and the one you pick in a panel
   beside it: its ground, what lives there, what your crews could
   work, your Threat in its zones and the road there. A toll is
   paid once and always asked about first. Roads open in order:
   ground past one you have not opened is listed, never offered.
   Travelling withdraws the bounty posted where you stood, so the
   road says so before you take it.
   ============================================================ */

import { h, el, qsa, on, setText, setWidth, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { confirm } from "../ui/overlay.js";
import { fmt, fmtGold, fmtWhole } from "../ui/format.js";
import { confirmSpend, hasPopup, openPopup } from "../ui/widgets.js";
import { CONFIG } from "../../shared/config.js";
import { GameData, TRADE_ORDER, foesOf, gatherSkillDef, sovereignOf, stratumOf, matId, getRegion, getZone, regionOfTier, tierLabel } from "../../shared/registry.js";
import { skillLevel } from "../../shared/stats.js";
import { itemDef, isRemedy } from "../../shared/items.js";
import { heldEverywhere } from "../../shared/storage.js";
import { threatIn } from "../../shared/combat.js";
import { dayIndex, weatherAt } from "../../shared/weather.js";

const REGIONS = GameData.REGIONS;
const ZONES = GameData.ZONES;
const STACKED = "(max-width: 767px)";   // below this the detail sits under the list
const NBSP = "\u00a0";                  // keeps "Lv 30" on one line

const media = (q) => typeof matchMedia === "function" && matchMedia(q).matches;

/* ================= READING THE MAP ================= */

// here, open, toll (the next road out) or far (past a road not yet opened).
function standing(state, r) {
  if (state.region === r.id) return "here";
  if (state.travel.unlocked.includes(r.id)) return "open";
  const prev = regionOfTier(r.tier - 1);
  return prev && !state.travel.unlocked.includes(prev.id) ? "far" : "toll";
}

// A bounty left behind waits on the board until the window turns, so leaving costs
// nothing. Only a finished, unpaid one is worth a reminder before you go.
function bountyWarning(state) {
  const b = state.bounty;
  if (!b || b.claimed || b.progress < b.amount) return null;
  return `Your bounty for ${getRegion(b.region).name} is finished but not claimed. It will wait for you until the board turns over.`;
}

function remediesHeld(state) {
  const held = heldEverywhere(state);
  return Object.keys(held).reduce((n, k) => n + (isRemedy(k) ? held[k] : 0), 0);
}

// A skyline per region: the same tier always draws the same hills, deeper strata rougher.
function vista(tier) {
  const rough = 1 + GameData.STRATA.findIndex((s) => s.tiers.includes(tier)) * 0.45;
  const ridge = (layer, base, amp) => {
    let d = "";
    let prev = null;
    for (let i = 0; i <= 6; i++) {
      const x = i * 100;
      const y = +(base + amp * rough * Math.sin(tier * 2.3 + layer * 1.9 + i * (0.9 + layer * 0.4))).toFixed(1);
      d += prev ? ` C${prev[0] + 50} ${prev[1]} ${x - 50} ${y} ${x} ${y}` : `M0 ${y}`;
      prev = [x, y];
    }
    return `${d} V100 H0Z`;
  };
  return '<svg viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true">' +
    `<path class="v-far" d="${ridge(0, 44, 9)}"/>` +
    `<path class="v-mid" d="${ridge(1, 66, 6)}"/>` +
    `<path class="v-near" d="${ridge(2, 85, 3.5)}"/></svg>`;
}

/* ================= SMALL BUILDERS ================= */

const block = (label, ...children) => h("div.atlas-block", h("div.eyebrow", label), children);

function fact(label, value) {
  const v = h("div.v", value);
  return { node: h("div.atlas-fact", h("div.eyebrow", label), v), v };
}

function stat(label, value = "") {
  const v = h("span.v", value);
  return { node: h("div.stat", h("span.l", label), v), v };
}

/* ================= THE PAGE ================= */

export default {
  id: "atlas",
  title: () => "Atlas",
  group: "The Realm",

  mount(view, ctx) {
    let selected = ctx.state.region;
    let detailSig = "";
    let refs = {};

    const hereName = h("span");
    // Today's weather, repainted when the day turns; the week is one tap away in the Sky popup.
    const skyName = h("span");
    const skyBtn = h("button.chip.chip-gold", { type: "button", onClick: () => openPopup("sky", ctx), "aria-label": "Open the Sky: this week's weather" }, skyName);
    let skyDay = null;
    const openChip = h("span.chip");
    const list = h("div.pick-list", { role: "listbox", "aria-label": "Regions", "aria-controls": "atlasDetail" });
    const detail = h("section.card.card-flush.atlas-detail#atlasDetail", { "aria-label": "Region" });

    // Nine rows under their three strata, built once. Their state (here, open, a toll) repaints in place.
    const rows = new Map();
    GameData.STRATA.forEach((stratum) => {
      const group = h("div.atlas-group", { role: "group", "aria-label": stratum.name },
        h("div.eyebrow.atlas-stratum", { "aria-hidden": "true" }, stratum.name));
      REGIONS.filter((r) => stratum.tiers.includes(r.tier)).forEach((r) => {
        const sub = h("span.region-sub");
        const end = h("span");
        const row = h("button.pick-row", { type: "button", role: "option", "aria-selected": "false", tabindex: "-1", "data-region": r.id },
          h("span.region-tier", { "aria-hidden": "true" }, String(r.tier)),
          h("span.lr-main", h("span.region-name", r.name), sub),
          end);
        rows.set(r.id, { row, sub, end, sig: "" });
        group.appendChild(row);
      });
      list.appendChild(group);
    });

    view.appendChild(h("div.page",
      h("header.page-head",
        h("div",
          h("div.eyebrow.page-eyebrow", "The Realm"),
          h("h1.page-title", "Atlas"),
          h("p.page-sub", "Pay the toll once, and the road stays open. Where you stand decides what your crews work and what you fight.")),
        h("div.page-actions",
          skyBtn,
          h("span.chip.chip-violet", iconEl("map-pin"), hereName))),
      h("div.atlas",
        h("section.card.atlas-regions",
          h("div.card-head", h("div", h("h2.card-title", "Regions")), h("div.card-actions", openChip)),
          list),
        detail)));

    /* ---------- the list ---------- */

    function paintRows(state) {
      const gold = state.player.gold;
      REGIONS.forEach((r) => {
        const ref = rows.get(r.id);
        const st = standing(state, r);
        const short = (st === "toll" || st === "far") && gold < r.toll;
        const sig = `${st}|${short}`;
        if (ref.sig !== sig) {
          ref.sig = sig;
          const prev = regionOfTier(r.tier - 1);
          toggleClass(ref.row, "is-current", st === "here");
          toggleClass(ref.row, "is-locked", st === "toll" || st === "far");
          toggleClass(ref.row, "is-far", st === "far");
          setText(ref.sub, st === "far" ? `Beyond ${prev.name}` : `Gear around Lv${NBSP}${r.level}`);
          ref.end.replaceChildren(
            st === "here" ? h("span.tag.tag-violet", "Here")
              : st === "open" ? h("span.tag.tag-good", "Open")
                : h("span.region-toll", { class: { "is-short": short } }, iconEl("lock"), fmtGold(r.toll)));
          const said = st === "here" ? "you are here" : st === "open" ? "open" : st === "toll" ? `toll ${fmtGold(r.toll)}` : `beyond ${prev.name}`;
          setAttr(ref.row, "aria-label", `${r.name}, tier ${r.tier}: ${said}`);
        }
        const picked = r.id === selected;
        setAttr(ref.row, "aria-selected", String(picked));
        toggleClass(ref.row, "is-selected", picked);
        setAttr(ref.row, "tabindex", picked ? "0" : "-1");
      });
    }

    /* ---------- the detail ---------- */

    // What decides the panel's shape. Numbers inside it move in place.
    function shapeOf(state, r, st) {
      const c = state.tasks.combat;
      const hunted = (c && c.tier === r.tier) || ZONES.some((z) => threatIn(state, r.tier, z.id) > 0);
      const workable = TRADE_ORDER.map((id) => (skillLevel(state, id) >= r.level ? 1 : 0)).join("");
      return `${r.id}|${st}|${hunted ? 1 : 0}|${workable}|${hasPopup("foe") ? 1 : 0}`;
    }

    function buildDetail(state, r, st) {
      const R = { zones: null };
      const prev = regionOfTier(r.tier - 1);
      const canOpenFoe = hasPopup("foe");

      const hunt = fact("Your Hunt");
      const toll = fact("Toll");
      R.hunt = hunt.v;
      R.toll = toll.v;

      const foeChip = (mob, sovereign) => {
        const tip = sovereign ? "Sovereign" : GameData.ARCHETYPES[mob.archetype].name;
        const kids = [iconEl(sovereign ? "skull" : mob.icon), mob.name];
        const cls = sovereign ? ".chip.chip-ember" : ".chip";
        return canOpenFoe
          ? h(`button${cls}`, { type: "button", "data-foe": mob.id, "data-tip": tip, "data-tip-touch": "off", "aria-label": `${mob.name}, ${tip}: details` }, kids)
          : h(`span${cls}`, { "data-tip": tip }, kids);
      };

      // The tier's five raw materials; a trade below the tier's level can't work them yet.
      let workable = 0;
      const yields = TRADE_ORDER.map(gatherSkillDef).map((s) => {
        const lv = skillLevel(state, s.id);
        const ok = lv >= r.level;
        if (ok) workable++;
        return h("span.chip", {
          class: { "is-locked": !ok },
          "data-tip": ok ? `${s.name} Lv ${lv}` : `Needs ${s.name} Lv ${r.level}. You have Lv ${lv}.`,
        }, iconEl(ok ? s.matIcon : "lock"), itemDef(matId(r.tier, s.mat)).name);
      });
      const yieldNote = workable === yields.length ? "Your crews can work all five."
        : workable === 0 ? `Your crews need Lv${NBSP}${r.level} in a trade to work any of it.`
          : `Your crews can work ${workable} of five. The rest need Lv${NBSP}${r.level}.`;

      // Threat only once you have hunted this ground.
      const c = state.tasks.combat;
      const hunted = (c && c.tier === r.tier) || ZONES.some((z) => threatIn(state, r.tier, z.id) > 0);
      let threat = null;
      if (hunted) {
        R.zones = {};
        threat = h("div.kpis.atlas-threat", ZONES.map((z) => {
          const z3 = { v: h("span.v"), fill: h("i"), s: h("span.s.t-ember", { hidden: true }, "Hunting") };
          R.zones[z.id] = z3;
          return h("div.kpi", h("span.l", z.name), z3.v, h("div.bar.bar-ember.bar-thin", { "aria-hidden": "true" }, z3.fill), z3.s);
        }));
      }
      const huntNow = stat("The hunt");
      const remedies = stat("Remedies held");
      const bounty = st === "here" ? stat("Bounty") : null;
      R.huntNow = huntNow.v;
      R.remedies = remedies.v;
      R.bounty = bounty ? bounty.v : null;

      // The road: here, free, a toll, or not yet.
      let note;
      let button = null;
      if (st === "here") {
        note = "You are here.";
      } else if (st === "open") {
        note = "The road is open. Travel is free.";
        button = h("button.btn.btn-primary", { type: "button", onClick: () => travelTo(r.id) }, iconEl("map-pin"), "Travel here");
      } else if (st === "toll") {
        note = "Pay once. The road stays open.";
        button = h("button.btn.btn-gold", { type: "button", onClick: () => travelTo(r.id) }, iconEl("coin"), `Pay ${fmtGold(r.toll)} and travel`);
      } else {
        // Any road can be bought; this one skips ground you haven't walked, so say so plainly.
        note = `Beyond ${prev.name}, which you haven't opened. Pay once. The road stays open.`;
        button = h("button.btn.btn-gold", { type: "button", onClick: () => travelTo(r.id) }, iconEl("coin"), `Pay ${fmtGold(r.toll)} and travel`);
      }
      R.warn = h("span.small.t-warn", { hidden: true });

      detail.replaceChildren(
        h("div.atlas-vista", { html: vista(r.tier) },
          h("div.atlas-vista-tier", h("div.chip-row", h("span.tag.tag-gold", tierLabel(r.tier)), h("span.tag", stratumOf(r.tier).name)))),
        h("div.atlas-body",
          h("h2.atlas-title", r.name),
          h("p.atlas-note", r.note),
          h("div.atlas-facts", fact("Gear around", `Lv ${r.level}`).node, hunt.node, toll.node),
          block("Lives here", h("div.chip-row", foesOf(r.tier).map((m) => foeChip(m, false)), foeChip(sovereignOf(r.tier), true))),
          block("Yields", h("div.chip-row.atlas-yields", yields), h("p.small.muted.mt-2", yieldNote)),
          block("Your standing",
            threat,
            h("div.stats", { class: { "mt-3": !!threat } },
              hunted ? null : stat("Threat here", "None yet").node,
              huntNow.node,
              bounty ? bounty.node : null,
              remedies.node))),
        h("div.atlas-actions", h("div.vstack.gap-1", h("span.small.muted", note), R.warn), button));
      return R;
    }

    function paintDetail(state) {
      const r = getRegion(selected);
      const st = standing(state, r);
      const sig = shapeOf(state, r, st);
      if (sig !== detailSig) {
        detailSig = sig;
        refs = buildDetail(state, r, st);
      }

      const lv = skillLevel(state, "warfare");
      setText(refs.hunt, `Lv ${lv}`);
      toggleClass(refs.hunt, "t-good", lv >= r.level);
      toggleClass(refs.hunt, "t-bad", lv < r.level);

      const paid = st === "here" || st === "open";
      setText(refs.toll, paid ? (r.toll ? "Paid" : "Free") : fmtGold(r.toll));
      toggleClass(refs.toll, "t-good", paid);
      toggleClass(refs.toll, "t-gold", !paid && state.player.gold >= r.toll);
      toggleClass(refs.toll, "t-bad", !paid && state.player.gold < r.toll);

      const c = state.tasks.combat;
      if (refs.zones) {
        ZONES.forEach((z) => {
          const t = threatIn(state, r.tier, z.id);
          const zr = refs.zones[z.id];
          setText(zr.v, fmtWhole(t));
          setWidth(zr.fill, (t / CONFIG.hunt.threatCap) * 100);
          setAttr(zr.s, "hidden", !(c && c.tier === r.tier && c.zone === z.id));
        });
      }
      if (!c) setText(refs.huntNow, "Not hunting");
      else if (c.tier === r.tier) setText(refs.huntNow, `${getZone(c.zone).name} · ${fmt(c.done)} kills`);
      else setText(refs.huntNow, `In ${regionOfTier(c.tier).name}`);

      if (refs.bounty) {
        const b = state.bounty;
        const text = !b ? "Nothing posted" : b.claimed ? "Paid out" : b.progress >= b.amount ? "Finished, not claimed" : `${fmt(b.progress)} of ${fmt(b.amount)}`;
        setText(refs.bounty, text);
        toggleClass(refs.bounty, "t-good", !!b && b.claimed);
        toggleClass(refs.bounty, "t-gold", !!b && !b.claimed && b.progress >= b.amount);
      }
      setText(refs.remedies, fmtWhole(remediesHeld(state)));

      const warn = st === "open" || st === "toll" ? bountyWarning(state) : null;
      setText(refs.warn, warn || "");
      setAttr(refs.warn, "hidden", !warn);
    }

    function paint() {
      const state = ctx.state;
      setText(hereName, getRegion(state.region).name);
      const day = dayIndex(ctx.now);
      if (day !== skyDay) {
        skyDay = day;
        const w = weatherAt(ctx.now);
        skyBtn.replaceChildren(iconEl(w.icon), skyName);
        setText(skyName, `Sky · ${w.label}`);
      }
      setText(openChip, `${state.travel.unlocked.length} of ${REGIONS.length} open`);
      paintRows(state);
      paintDetail(state);
    }

    /* ---------- acting ---------- */

    function select(id, { focus = false, reveal = false } = {}) {
      if (!rows.has(id)) return;
      selected = id;
      paint();
      if (focus) rows.get(id).row.focus();
      // Stacked, the panel is below the list: bring it up to meet the tap.
      if (reveal && media(STACKED)) {
        detail.scrollIntoView({ block: "start", behavior: media("(prefers-reduced-motion: reduce)") ? "auto" : "smooth" });
      }
    }

    async function travelTo(id) {
      const r = getRegion(id);
      const state = ctx.state;
      const st = standing(state, r);
      if (st === "here") return;
      const warn = bountyWarning(state);
      if (st === "toll" || st === "far") {
        const ok = await confirmSpend(ctx, {
          title: `Travel to ${r.name}?`,
          body: warn ? `Pay once and the road stays open. ${warn}` : "Pay once and the road stays open.",
          gold: r.toll,
          confirmText: `Pay ${fmtGold(r.toll)} and travel`,
        });
        if (!ok) return;
      } else if (warn) {
        const ok = await confirm({ title: `Travel to ${r.name}?`, body: warn, confirmText: "Travel anyway" });
        if (!ok) return;
      }
      const res = await ctx.dispatch("travel", { regionId: r.id });
      if (!res.ok) return;
      selected = r.id;
      paint();
      // The button that was pressed is gone now; keep focus in the map.
      const row = rows.get(r.id).row;
      if (row.isConnected) row.focus({ preventScroll: true });
      setText(el("srLive"), `You travel to ${r.name}`);
    }

    const offs = [
      on(list, "click", ".pick-row", (e, row) => select(row.dataset.region, { reveal: true })),
      on(list, "keydown", ".pick-row", (e, row) => {
        const all = qsa(".pick-row", list);
        let i = all.indexOf(row);
        if (e.key === "ArrowDown") i = Math.min(all.length - 1, i + 1);
        else if (e.key === "ArrowUp") i = Math.max(0, i - 1);
        else if (e.key === "Home") i = 0;
        else if (e.key === "End") i = all.length - 1;
        else return;
        e.preventDefault();
        select(all[i].dataset.region, { focus: true });
      }),
      on(detail, "click", "[data-foe]", (e, chip) => openPopup("foe", ctx, chip.dataset.foe)),
    ];

    paint();

    return {
      update: paint,
      unmount() {
        offs.forEach((off) => off());
      },
    };
  },
};
