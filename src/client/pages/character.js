/* ============================================================
   Respite · pages/character.js · The Muster
   ------------------------------------------------------------
   #/character, the page the camp opens on: your own commander,
   drawn by the same card a commander's page draws for anyone
   (ui/profile.js), off your own save rather than the realm's
   copy of it, so everything on it is live.

     the side   your face, name, discipline and ground, the total
                and Hunt levels, then your numbers (or, on the
                Collection, its kinds)
     Standing   the worn figure; a piece opens its own sheet
     Skills     the Hunt, then each trade beside its artisan, with
                what is left to the next level
     Collection the album, ground by ground
     Record     what the camp has done since it was founded

   Only the tab on screen is painted on a frame.
   ============================================================ */

import { h, setText } from "../ui/dom.js";
import { fmt, fmtWhole, fmtGold, fmtTime } from "../ui/format.js";
import { bestiaryFound, BESTIARY_COUNT } from "../ui/collection.js";
import { hasPopup, openPopup } from "../ui/widgets.js";
import { profileView, sheetFrom } from "../ui/profile.js";
import { refreshTitles, saintTag } from "../titles.js";
import { wornHalos } from "../../shared/items.js";
import { SKILL_ORDER } from "../../shared/registry.js";
import { totalLevel, xpProgress, statsOf, myClass, skillLevel } from "../../shared/stats.js";
import { currentRegion } from "../../shared/world.js";

// Your account name, or "Commander" until there is one.
function commanderName(ctx) {
  const account = ctx.account;
  const name = (account && account.username) || ctx.state.meta.account;
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Commander";
}

/* ================= 1. YOUR COMMANDER, AS A MODEL ================= */
/* What the card is handed: your save, read once a frame. The saint's tag is
   built only when the name it hangs on changes, not every frame. */

function modelMaker() {
  let saintFor = null;
  let saint = null;
  return (ctx, state) => {
    const username = ctx.account && ctx.account.username;
    if (username !== saintFor) {
      saintFor = username;
      saint = saintTag(username);
    }
    const klass = myClass(state);
    const skills = {};
    SKILL_ORDER.forEach((id) => {
      const p = xpProgress(state, id);
      skills[id] = { level: p.level, pct: p.pct, toNext: p.toNext, maxed: p.maxed };
    });
    return {
      name: commanderName(ctx),
      eyebrow: "The Realm",
      skin: state.player.skin,
      klass,
      region: currentRegion(state),
      halos: wornHalos(state.equipment),
      extraTags: saint ? [saint] : [],
      total: totalLevel(state),
      hunt: skillLevel(state, "warfare"),
      sheet: sheetFrom(statsOf(state), klass),
      equipment: state.equipment,
      skills,
      rolls: state.rolls,
    };
  };
}

/* ================= 2. THE RECORD ================= */
/* What the camp has done since it was founded. Every figure is already in
   the save; nothing here is counted a second time. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* "17 Sep 2026" for the day a camp was founded. UTC, as every reset in the
   game is, and spelled out by hand so every browser writes it the same
   (the Sky popup says its days the same way). */
function fmtDay(ms) {
  const d = new Date(Number(ms) || 0);
  if (!Number.isFinite(d.getTime())) return "Unknown";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function bigRows(state) {
  const st = state.stats;
  return [
    ["Felled", fmt(st.kills)],
    ["Falls", fmtWhole(st.deaths)],
    ["Sovereigns", fmtWhole(st.bosses || 0)],
    ["Actions worked", fmt(st.actions)],
    ["Things made", fmt(st.crafted)],
    ["Total level", fmtWhole(totalLevel(state))],
  ];
}

function detailRows(state, now) {
  const st = state.stats;
  const meta = state.meta;
  const found = bestiaryFound(state.rolls);
  const region = currentRegion(state);
  return [
    ["Founded", fmtDay(meta.createdAt)],
    ["Standing for", fmtTime(Math.max(0, now - meta.createdAt))],
    ["Time in camp", fmtTime(meta.playtimeMs)],
    ["Gold earned", fmtGold(st.goldEarned), "gold"],
    ["Epics found", fmtWhole(st.epics)],
    ["Collection", `${fmtWhole(found)} of ${fmtWhole(BESTIARY_COUNT)}`],
    ["Ground held", `${region.name}, tier ${region.tier}`],
  ];
}

function recordView() {
  const grid = h("div.standing");
  const list = h("div.stats");
  const node = h("div.char-stack",
    h("section.card",
      h("div.card-head", h("div",
        h("h2.card-title", "The tally"),
        h("p.card-sub", "What this camp has done. Nothing but starting over clears it."))),
      grid),
    h("section.card",
      h("div.card-head", h("div",
        h("h2.card-title", "Since the founding"),
        h("p.card-sub", "Time in camp is every hour the camp has run, asleep or awake."))),
      list));

  let bigSig = null;
  let bigValues = [];
  let rowSig = null;
  let rowValues = [];

  return {
    node,
    update(next, state) {
      const big = bigRows(state);
      const nextBig = big.map((r) => r[0]).join("|");
      if (nextBig !== bigSig) {
        bigSig = nextBig;
        bigValues = big.map(() => h("div.v"));
        grid.replaceChildren(...big.map(([l], i) => h("div.standing-cell", bigValues[i], h("div.eyebrow.l", l))));
      }
      big.forEach((r, i) => setText(bigValues[i], r[1]));

      const rows = detailRows(state, next.now);
      const nextRows = rows.map((r) => r[0]).join("|");
      if (nextRows !== rowSig) {
        rowSig = nextRows;
        rowValues = rows.map(([, , tone]) => h("span.v", { class: tone && `t-${tone}` }));
        list.replaceChildren(...rows.map(([l], i) => h("div.stat", h("span.l", l), rowValues[i])));
      }
      rows.forEach((r, i) => setText(rowValues[i], r[1]));
    },
  };
}

/* ================= 3. THE PAGE ================= */

export default {
  id: "character",
  title: () => "Character",
  group: "The Vanguard",

  mount(view, ctx) {
    let live = ctx;
    const record = recordView();
    const card = profileView({
      key: "self",
      links: true,
      onSlot: (key) => openPopup("item", live, key, { from: "worn" }),
      onEntry: (entry) => openPopup("entry", live, entry),
      extraTabs: [{ id: "record", name: "Record", icon: "hourglass", node: record.node, update: (c) => record.update(c, c.state) }],
    });
    const model = modelMaker();

    view.appendChild(h("div.page", card.node));

    /* A camp with no skin has never been asked, so it is asked here: this is the
       page every camp opens on. One ask per mount -- the popup itself refuses to
       stack, and closes the moment the answer lands. */
    let asked = false;

    // The five saints. If this camp holds a line, the card wears it on the next update.
    refreshTitles(ctx);

    const handle = {
      update(next) {
        live = next || live;
        const state = live.state;
        card.paint(model(live, state), live);
        if (!asked && !state.player.skin && hasPopup("skin")) {
          asked = true;
          openPopup("skin", live);
        }
      },
      unmount() { card.destroy(); },
    };
    handle.update(ctx);
    return handle;
  },
};
