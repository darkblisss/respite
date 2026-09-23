/* ============================================================
   Respite · pages/requisitions.js · The Roster
   ------------------------------------------------------------
   Agents sent out for supplies: three deployments a day, back
   when the world day turns. Hiring rolls a rarity, and better
   Agents come back heavier. Hidden, route and all, until a tier 2
   region is yours (UI-REQUIREMENTS 11). Deploying picks the Agent
   and what to bring back in a small dialog; hiring asks about the
   gold first. Lists rebuild when the roster or the runs change;
   the pips and countdowns repaint in place.
   ============================================================ */

import { h, setText, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { confirm, openModal } from "../ui/overlay.js";
import { fmtGold, fmtTime, fmtWhole } from "../ui/format.js";
import { confirmSpend } from "../ui/widgets.js";
import { dropdown } from "../ui/dropdown.js";
import { CONFIG } from "../../shared/config.js";
import { agentRarityDef, regionOfTier, tierLabel } from "../../shared/registry.js";
import { requisitionsOpen, requisitionsLeft, requisitionTargets, requisitionQty, agentLevel, agentHours } from "../../shared/world.js";
import { nextDayAt } from "../../shared/weather.js";
import { itemDef, itemName } from "../../shared/items.js";
import { ORDER, placeFor, haveQty } from "../../shared/storage.js";

const A = CONFIG.agents;
const INTO = { inv: "Belongings", bank: "the Stockpile", vault: "the Vault" };

/* What an Agent brings back now depends on what you ask for, because it is paid
   in hours of your own gathering: an hour of Titan Core is fifty of them and an
   hour of Slag Ore is three hundred. The rules own the sum (requisitionQty); this
   page had its own copy of the old one and they drifted the moment either moved. */
/* An agent's own progress. xpProgress() in stats.js reads a skill off the save;
   an agent carries its learning on itself, so the same sum is done here. */
function learning(xp) {
  const max = CONFIG.progression.maxLevel;
  const at = Math.max(0, Number(xp) || 0);
  let level = 1;
  for (let n = 2; n <= max; n++) {
    if (!(at >= CONFIG.xpTable[n])) break;
    level = n;
  }
  const base = CONFIG.xpTable[level];
  const next = CONFIG.xpTable[Math.min(level + 1, max)];
  const span = Math.max(1, next - base);
  return { level, into: Math.max(0, at - base), need: span, pct: level >= max ? 1 : Math.min(1, (at - base) / span) };
}

const hoursWord = (agent) => {
  const hrs = agentHours(agent);
  const whole = Math.floor(hrs);
  const mins = Math.round((hrs - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole}h`;
};

const pendingOf = (state) => state.requisitions.filter((r) => !r.resolved);

// The last thing asked for, remembered while the tab lives.
let lastTarget = null;

export default {
  id: "requisitions",
  title: () => "Requisitions",
  group: "The Camp",
  visible: (ctx) => requisitionsOpen(ctx.state),

  mount(view, ctx) {
    const page = h("div.page");
    view.appendChild(page);

    let shown = false;      // whether the page is built (it is only while open)
    let runSig = null;      // null forces the first build, even of an empty list
    let rosterSig = null;
    let modal = null;
    const R = {};

    function build() {
      R.pips = Array.from({ length: A.requisitionsPerDay }, () => h("i.req-pip"));
      R.slots = h("span.req-slots", { role: "img" }, R.pips);
      R.leftText = h("span.small.dim");
      R.runSub = h("p.card-sub");
      R.runs = h("div");
      R.rosterSub = h("p.section-sub");
      R.hire = h("button.btn.btn-gold", { type: "button", onClick: hire });
      R.roster = h("div");
      R.backs = [];

      page.replaceChildren(
        h("header.page-head",
          h("div",
            h("div.eyebrow.page-eyebrow", "The Camp"),
            h("h1.page-title", "Requisitions"),
            h("p.page-sub", "Send Agents out for supplies. They return at the daily reset, and better Agents come back heavier.")),
          h("div.page-actions", h("div.hstack.gap-3", R.slots, R.leftText))),
        h("section.card",
          h("div.card-head", h("div", h("h2.card-title", "Out on a run"), R.runSub)),
          R.runs),
        h("section.section",
          h("div.section-head", h("div", h("h2.section-title", "The roster"), R.rosterSub), R.hire),
          R.roster));
      runSig = null;
      rosterSig = null;
    }

    /* ---------- out on a run ---------- */

    function paintRuns(state, pending, back) {
      const sig = pending.map((r) => `${r.agentId}:${r.itemKey}:${r.qty}`).join("|");
      if (sig !== runSig) {
        runSig = sig;
        R.backs = [];
        if (!pending.length) {
          R.runs.replaceChildren(h("p.small.muted", "Nobody is out. Send someone before the day turns."));
        } else {
          R.runs.replaceChildren(h("div.list", pending.map((r) => {
            const t = h("span");
            R.backs.push(t);
            return h("div.list-row",
              h("span.avatar.avatar-sm", { "aria-hidden": "true" }, r.agentName.charAt(0)),
              h("div.lr-main",
                h("div.lr-title", r.agentName),
                h("div.lr-sub", `${fmtWhole(r.qty)} × ${itemName(r.itemKey)}, back at the daily reset`)),
              h("div.lr-end", h("span.chip", iconEl("clock"), t)));
          })));
        }
      }
      R.backs.forEach((t) => setText(t, `Back in ${back}`));
    }

    /* ---------- the roster ---------- */

    function agentCard(a, run, left) {
      const rd = agentRarityDef(a.rarity);
      const lvl = agentLevel(a);
      const prog = learning(a.xp);
      return h("article.card.agent-card", { class: { "is-out": !!run } },
        h("div.agent-top",
          h("span.avatar", { "data-tone": run ? null : "gold", "aria-hidden": "true" }, a.name.charAt(0)),
          h("div.grow",
            h("div.agent-name", a.name),
            h("div.chip-row.mt-1",
              h("span.tag", { "data-rarity": a.rarity }, rd.name),
              h("span.tag", `Lv ${fmtWhole(lvl)}`),
              run ? h("span.tag.tag-violet", "Out") : null))),
        /* What they have learned, and what it is worth. An agent is paid in your
           hours, so that is the figure: the units follow from what you ask for. */
        h("div.agent-learn",
          h("div.bar.bar-gold.bar-thin", h("i", { style: `width:${Math.round(prog.pct * 100)}%` })),
          h("span.small.muted", lvl >= CONFIG.progression.maxLevel
            ? "As far as they go"
            : `${fmtWhole(prog.into)} / ${fmtWhole(prog.need)} to Lv ${fmtWhole(lvl + 1)}`)),
        h("p.agent-yield", run
          ? `Bringing back ${fmtWhole(run.qty)} × ${itemName(run.itemKey)}.`
          : `Brings back ${hoursWord(a)} of your own gathering, whatever you ask for.`),
        h("div.agent-deploy", run
          ? h("span.small.muted", "Back at the daily reset")
          : h("button.btn.btn-primary.btn-soft.btn-sm.btn-block", {
            type: "button",
            disabled: left <= 0,
            "aria-label": left > 0 ? `Deploy ${a.name}` : null,
            onClick: () => openDeploy(a.id),
          }, left > 0 ? "Deploy" : "None left today")),
        run ? null : h("button.btn.btn-quiet.btn-sm.btn-block.mt-2", {
          type: "button", onClick: () => resign(a),
        }, "Let them go"));
    }

    /* The only way to try the roll again with a roster of three. Everything the
       agent learned goes with them, so it is asked for plainly. */
    async function resign(a) {
      const lvl = agentLevel(a);
      const ok = await confirm({
        title: `Let ${a.name} go?`,
        body: lvl > 1
          ? `They are ${agentRarityDef(a.rarity).name} and Level ${fmtWhole(lvl)}. Everything they have learned goes with them, and the seat opens for another hire.`
          : `The seat opens for another hire. Nothing comes back.`,
        confirmText: "Let them go",
        kind: "bad",
      });
      if (ok) await ctx.dispatch("resignAgent", { agentId: a.id });
    }

    function paintRoster(state, pending, left) {
      const full = state.agents.length >= A.rosterMax;
      const sig = `${state.agents.map((a) => `${a.id}:${a.rarity}:${a.xp || 0}`).join("|")}#${runSig}#${left > 0 ? 1 : 0}`;
      if (sig !== rosterSig) {
        rosterSig = sig;
        if (!state.agents.length) {
          R.roster.replaceChildren(h("section.card", h("div.empty.empty-sm",
            h("div.empty-art", iconEl("crate")),
            h("div.empty-title", "No Agents on the books"),
            h("p.empty-text", "Hire one to send out for supplies. Every hire rolls its own rarity."))));
        } else {
          R.roster.replaceChildren(h("div.grid-cards", state.agents.map((a) => agentCard(a, pending.find((r) => r.agentId === a.id), left))));
        }
      }
      setText(R.rosterSub, `${fmtWhole(state.agents.length)} of ${A.rosterMax} on the books. Every hire rolls its own rarity, and rarity is the ceiling they climb to, not what they bring on day one.`);
      setText(R.hire, full ? "The roster is full" : `Hire an Agent · ${fmtGold(A.hireCost)}`);
      R.hire.disabled = full;
    }

    /* ---------- acting ---------- */

    async function hire() {
      if (ctx.state.agents.length >= A.rosterMax) return;
      const ok = await confirmSpend(ctx, {
        title: "Hire an Agent?",
        body: "Every hire rolls its own rarity. All of them start bringing back an hour of your own gathering; the rarer ones climb higher than that, and faster. You learn who signed on once the gold is paid.",
        gold: A.hireCost,
        confirmText: `Hire for ${fmtGold(A.hireCost)}`,
      });
      if (ok) await ctx.dispatch("hireAgent");
    }

    // The dialog: which Agent, and what to bring back from everything requisitionTargets allows.
    function openDeploy(agentId) {
      const state = ctx.state;
      const pending = pendingOf(state);
      const free = state.agents.filter((a) => !pending.some((r) => r.agentId === a.id));
      const left = requisitionsLeft(state);
      if (!free.length || left <= 0 || modal) return;

      /* The game draws both lists rather than handing them to the operating system:
         a rarity and a haul are worth showing beside a name, and a native option
         cannot carry either. */
      const agentSel = dropdown({
        id: "reqAgent",
        label: "Agent",
        groups: [{ label: null, options: free.map((a) => ({
          value: a.id,
          label: `${a.name} · ${agentRarityDef(a.rarity).name}`,
          // Hours, not a count: what they bring back depends on what is asked for.
          note: hoursWord(a),
        })) }],
        value: free.some((a) => a.id === agentId) ? agentId : free[0].id,
        onChange: () => paintPlan(),
      });

      // Reagents first, then each tier's raw materials under the region they come from.
      const targets = requisitionTargets(state);
      const groups = new Map();
      targets.forEach((key) => {
        const d = itemDef(key);
        const label = d.reagent ? "Reagents" : `${tierLabel(d.tier)} · ${regionOfTier(d.tier).name}`;
        if (!groups.has(label)) groups.set(label, []);
        // What you already hold, where you hold any: a column of zeroes tells nobody anything.
        const held = haveQty(state, key);
        groups.get(label).push({ value: key, label: d.name, note: held > 0 ? `${fmtWhole(held)} held` : null });
      });
      // Remembered, or the first raw material of the deepest tier you can ask for.
      const raw = targets.filter((k) => !itemDef(k).reagent);
      const deepest = raw.reduce((best, k) => (!best || itemDef(k).tier > itemDef(best).tier ? k : best), null);
      const targetSel = dropdown({
        id: "reqTarget",
        label: "Bring back",
        groups: [...groups].map(([label, options]) => ({ label, options })),
        value: targets.includes(lastTarget) ? lastTarget : deepest || targets[0],
        onChange: () => paintPlan(),
      });

      const plan = h("p.ap-plan");
      const paintPlan = () => {
        const s = ctx.state;
        const agent = s.agents.find((a) => a.id === agentSel.value);
        const key = targetSel.value;
        if (!agent || !key) return;
        const w = placeFor(s, key, ORDER.material);
        plan.replaceChildren(
          h("span", h("b", `${fmtWhole(requisitionQty(agent, key))} × ${itemName(key)}`), ` back in ${fmtTime(nextDayAt(ctx.now) - ctx.now)}`),
          h("span", { class: { "t-warn": !w } }, w ? `Into ${INTO[w]} · ${fmtWhole(haveQty(s, key))} held` : "Nowhere to put it right now"));
      };
      paintPlan();

      modal = openModal({
        title: "Send an Agent out",
        sub: `${left} of ${A.requisitionsPerDay} deployments left today`,
        art: "crate",
        size: "sm",
        body: [
          h("div.field", h("label.field-label", { for: "reqAgent" }, "Agent"), agentSel.node),
          h("div.field", h("label.field-label", { for: "reqTarget" }, "Bring back"), targetSel.node),
          plan,
        ],
        actions: [
          { label: "Cancel", kind: "quiet" },
          {
            label: "Deploy",
            kind: "primary",
            onClick: async () => {
              const itemKey = targetSel.value;
              const res = await ctx.dispatch("deployAgent", { agentId: agentSel.value, itemKey });
              if (!res.ok) return false;
              lastTarget = itemKey;
              return true;
            },
          },
        ],
        initialFocus: targetSel.button,
        onClose: () => { agentSel.destroy(); targetSel.destroy(); modal = null; },
      });
    }

    /* ---------- the loop ---------- */

    function paint() {
      const state = ctx.state;
      const open = requisitionsOpen(state);
      if (open !== shown) {
        shown = open;
        if (open) build();
        else page.replaceChildren();
      }
      if (!open) return;

      const pending = pendingOf(state);
      const left = requisitionsLeft(state);
      const used = A.requisitionsPerDay - left;
      R.pips.forEach((pip, i) => toggleClass(pip, "is-used", i < used));
      setAttr(R.slots, "aria-label", `${used} of ${A.requisitionsPerDay} deployments used`);
      setText(R.leftText, `${left} of ${A.requisitionsPerDay} left today`);

      const back = fmtTime(nextDayAt(ctx.now) - ctx.now);
      setText(R.runSub, `Back when the day turns, in ${back}.`);
      paintRuns(state, pending, back);
      paintRoster(state, pending, left);
    }

    paint();
    return {
      update: paint,
      unmount() {
        if (modal) modal.close("route");
      },
    };
  },
};
