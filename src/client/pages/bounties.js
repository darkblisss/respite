/* ============================================================
   Respite · pages/bounties.js · The Notice Board
   ------------------------------------------------------------
   One posting a world window (twelve hours) for the ground you
   stand on: put down so many foes there, or bring in so much of
   one of its materials. It pays gold and an hour of double
   experience to every skill. The posting's card is built once a
   posting and the buff's card comes and goes on its own, so a
   claim never rebuilds the button it was made with; progress, the
   clock and the time left repaint in place.
   ============================================================ */

import { h, setText, setWidth, setAttr } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { fmt, fmtGold, fmtTime, fmtClock } from "../ui/format.js";
import { GameData, getRegion, matId } from "../../shared/registry.js";
import { itemName } from "../../shared/items.js";
import { windowEndsIn } from "../../shared/weather.js";
import { bountyOwed } from "../../shared/world.js";

const HOUR = 60 * 60 * 1000;

// A gathering bounty names a raw material; this is the trade that brings it in.
function tradeFor(b) {
  const tier = getRegion(b.region).tier;
  return GameData.GATHER_SKILLS.find((s) => matId(tier, s.mat) === b.targetId) || null;
}

export default {
  id: "bounties",
  title: () => "Bounties",
  group: "The Camp",

  mount(view, ctx) {
    const clockText = h("span");
    const nextText = h("span");

    let postSig = null;
    let post = null;    // { node, R } for the posting, or the empty card
    let buff = null;    // { node, R } while the reward runs

    const page = h("div.page",
      h("header.page-head",
        h("div",
          h("div.eyebrow.page-eyebrow", "The Camp"),
          h("h1.page-title", "Bounties"),
          h("p.page-sub", "Posted on the world clock every twelve hours, against the ground you are standing on. Leave that ground and the posting is withdrawn.")),
        h("div.page-actions",
          h("span.clock", { "data-tip": "World clock. Bounties and the Smuggler run on this." }, iconEl("clock"), clockText),
          h("span.chip", iconEl("hourglass"), nextText))));
    view.appendChild(page);

    function postingCard(b) {
      const region = getRegion(b.region);
      let kind;
      let hint;
      if (b.kind === "slay") {
        kind = h("span.chip.chip-ember", iconEl("swords"), "Hunt");
        hint = `Kills on ${region.name} ground count, in any zone.`;
      } else {
        const trade = tradeFor(b);
        kind = h("span.chip.chip-violet", iconEl(trade ? trade.icon : "hammer"), trade ? trade.name : "Gathering");
        hint = `Paid on delivery: the ${itemName(b.targetId)} are handed over with the claim.`;
      }
      const R = { count: h("b"), fill: h("i"), claim: h("button.btn.btn-gold", { type: "button", onClick: () => ctx.dispatch("claimBounty") }) };
      R.bar = h("div.bar.bar-gold.bar-lg", { role: "progressbar", "aria-label": "Bounty progress", "aria-valuemin": "0", "aria-valuemax": "100" }, R.fill);
      return {
        R,
        node: h("section.card.bounty", { "data-tone": "gold" },
          h("div.art.art-lg", { "data-tone": "gold", "aria-hidden": "true" }, iconEl("scroll")),
          h("div", h("div.eyebrow", `Posted for ${region.name}`), h("h2.bounty-title", b.label)),
          h("div.bounty-progress",
            h("div.meter-top", h("span", "Progress"), R.count),
            R.bar,
            h("div.chip-row",
              kind,
              h("span.chip.chip-gold", iconEl("coin"), `Pays ${fmtGold(b.gold)}`),
              h("span.chip.chip-violet", iconEl("sparkle"), "An hour of double XP"))),
          h("div.bounty-foot", h("span.small.muted", hint), R.claim)),
      };
    }

    function emptyCard() {
      const R = { text: h("p.empty-text") };
      return {
        R,
        node: h("section.card", h("div.empty.empty-sm", h("div.empty-art", iconEl("scroll")), h("div.empty-title", "Nothing posted"), R.text)),
      };
    }

    function buffCard(mult) {
      const R = { left: h("span"), fill: h("i") };
      return {
        R,
        node: h("section.card", { "data-tone": "violet" },
          h("div.card-head",
            h("div",
              h("h2.card-title", iconEl("sparkle"), mult === 2 ? "Double experience" : `×${mult} experience`),
              h("p.card-sub", "The bounty's reward. Every skill earns it while it lasts, the hunt included.")),
            h("div.card-actions", h("span.chip.chip-violet", iconEl("clock"), R.left))),
          h("div.bar", { "aria-hidden": "true" }, R.fill)),
      };
    }

    function paint() {
      const state = ctx.state;
      const now = ctx.now;
      const b = state.bounty;
      const ends = windowEndsIn(now);

      setText(clockText, fmtClock(now));
      setText(nextText, `New posting in ${fmtTime(ends)}`);

      // A new window or new ground: a new card in the same place.
      const sig = b ? `${b.window}|${b.region}|${b.kind}|${b.label}` : "none";
      if (sig !== postSig) {
        postSig = sig;
        const next = b ? postingCard(b) : emptyCard();
        if (post) post.node.replaceWith(next.node);
        else page.appendChild(next.node);
        post = next;
      }

      if (b) {
        const done = Math.min(b.progress, b.amount);
        const pct = (done / b.amount) * 100;
        const finished = b.progress >= b.amount;
        setText(post.R.count, `${fmt(done)} of ${fmt(b.amount)}`);
        setWidth(post.R.fill, pct);
        setAttr(post.R.bar, "aria-valuenow", String(Math.round(pct)));
        /* A gather posting is paid on delivery, so the button asks for the goods
           back if they were spent between the gathering and the claim. */
        const short = bountyOwed(state);
        const label = b.claimed
          ? "Paid out"
          : !finished
            ? `${fmt(b.amount - b.progress)} more to go`
            : short > 0
              ? `${fmt(short)} short to hand over`
              : `Claim ${fmtGold(b.gold)}`;
        setText(post.R.claim, label);
        post.R.claim.disabled = b.claimed || !finished || short > 0;
      } else {
        setText(post.R.text, `A new posting goes up in ${fmtTime(ends)}.`);
      }

      const buffOn = !!state.buff && state.buff.until > now;
      if (buffOn && !buff) {
        buff = buffCard(state.buff.mult);
        page.appendChild(buff.node);
      } else if (!buffOn && buff) {
        buff.node.remove();
        buff = null;
      }
      if (buff) {
        const left = Math.max(0, state.buff.until - now);
        setText(buff.R.left, `${fmtTime(left)} left`);
        setWidth(buff.R.fill, (left / HOUR) * 100);
      }
    }

    paint();
    return { update: paint };
  },
};
