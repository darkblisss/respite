/* ============================================================
   Respite · chronicle.js · The Camp Log
   ------------------------------------------------------------
   The rules announce what happened; this listener writes the lines
   worth keeping into state.log, dated when they happened (payload.at),
   the newest 60 kept. The server and the browser both attach it, so
   the log they build is the same. Toast-only news (a crafted piece
   below Legendary, a finished bounty, a Sovereign on its way, a find,
   a mastery step) is left to the browser: those return null here.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData, getCompanion, getClass, getMonster, getRegion, getZone, regionOfTier, skillName, findAction } from "./registry.js";
import { itemName } from "./items.js";
import { foeTitle } from "./combat.js";
import { fmt, fmtGold, fmtTime, titleCase } from "./format.js";

const LOG_MAX = 60;

const actionName = (p) => {
  const def = findAction(p.skillId, p.actionId);
  return titleCase(def ? def.name : String(p.actionId));
};

const zonePlace = (tier, zone) => `${getZone(zone).name} of ${(regionOfTier(tier) || getRegion(null)).name}`;

const LINES = {
  "skill:level": (p) => `${skillName(p.skillId)} reaches level ${p.level}.`,

  "task:ended": (p) => {
    const name = actionName(p);
    if (p.reason === "stock") return `${name} stopped after ${fmtTime(p.elapsedMs)}: no materials left.`;
    if (p.reason === "storage") return `${name} stopped after ${fmtTime(p.elapsedMs)}: Belongings, the Stockpile and the Vault are all full.`;
    if (p.reason === "limit") return `Batch finished: ${fmt(p.done)} × ${name} in ${fmtTime(p.elapsedMs)}.`;
    return `Twelve hours at ${name} and ${fmt(p.done)} done. The crews stand down.`;
  },

  // Only genuinely rare outcomes are worth a log line; the rest toast.
  "item:crafted": (p) => (p.rarity === "relic" || p.rarity === "legendary" ? `${itemName(p.key)} comes off the bench.` : null),

  "storage:full": (p) => `Nowhere to put ${itemName(p.key)}.`,

  "hunt:ended": (p) => (p.reason === "limit"
    ? `Hunt finished: ${fmt(p.kills)} kills in ${fmtTime(p.elapsedMs)}.`
    : `Twelve hours on the hunt and ${fmt(p.kills)} kills. You make for camp.`),

  "hunt:death": (p) => {
    const mob = getMonster(p.monsterId);
    return `${mob ? foeTitle(mob) : "Something"} put you down after ${fmtTime(p.elapsedMs)} on the hunt. Recovering for five minutes.`;
  },

  "hunt:felled": (p) => {
    const mob = getMonster(p.monsterId);
    const left = p.key ? ` It left ${itemName(p.key)}.` : " What it left had nowhere to go.";
    return `${mob ? mob.name : "A Sovereign"} fell after ${fmtTime(p.fightMs)}.${left}`;
  },

  "hunt:retreat": (p) => {
    const mob = p.monsterId ? getMonster(p.monsterId) : null;
    return `You broke away from ${mob ? mob.name : "a Sovereign's guard"} after ${fmtTime(p.fightMs)}.`;
  },

  // Read off the rules rather than written out, so the sentence cannot drift from hideMs again.
  "hunt:hide": (p) => `Threat peaked in the ${zonePlace(p.tier, p.zone)}. You went to ground for ${fmtTime(CONFIG.hunt.hideMs)}, and the region forgets you once you have sat it out.`,

  "hunt:passed": (p) => `Something vast moved through the ${zonePlace(p.tier, p.zone)} and did not find you.`,

  "loot:lost": () => "Belongings, the Vault and the Stockpile are full. Loot is being left where it fell.",

  "item:broke": (p) => `${itemName(p.key)} broke.`,
  "item:repaired": (p) => `Patched up ${itemName(p.key)}.`,

  "companion:bond": (p) => {
    const def = getCompanion(p.id);
    return def ? `${def.name} reaches Bond ${p.level}.` : null;
  },

  "companion:found": (p) => {
    const def = getCompanion(p.id);
    if (!def) return null;
    const N = GameData.RANK_NUMERALS;
    if (p.rankUp) return `A second ${def.name} has been trailing you. ${def.name} rises to Rank ${N[p.rank]}.`;
    return `A second ${def.name} has been trailing you. ${p.dupes} of ${p.need} toward Rank ${N[p.rank + 1]}.`;
  },

  "companion:bought": (p) => {
    const def = getCompanion(p.id);
    return def ? `${def.name} joins the camp.` : null;
  },

  "companion:active": (p) => {
    const def = p.id ? getCompanion(p.id) : null;
    return def ? `${def.name} walks with you now.` : null;
  },

  "bounty:paid": (p) => `Bounty paid: ${fmtGold(p.gold)}.`,

  "agent:hired": (p) => {
    const rar = GameData.AGENT_RARITIES.find((a) => a.key === p.rarity);
    return `${p.name} signs on (${rar ? rar.name : "Common"}).`;
  },
  "agent:deployed": (p) => `${p.name} sets out for ${itemName(p.itemKey)}.`,

  "requisitions:returned": (p) => {
    const lines = (p.lines || []).map((l) => (l.placed ? `${fmt(l.qty)} ${itemName(l.key)}` : `${itemName(l.key)} (no room)`));
    return lines.length ? `Requisitions returned: ${lines.join(", ")}.` : null;
  },

  "shop:bought": (p) => `Bought ${fmt(p.qty)} × ${itemName(p.key)}.`,
  "smuggler:bought": (p) => `Bought ${fmt(p.qty)} × ${itemName(p.key)}.`,

  "travel:unlocked": (p) => `Road to ${getRegion(p.regionId).name} open.`,
  "tool:equipped": (p) => `${itemName(p.key)} taken up.`,

  "class:picked": (p) => {
    const def = getClass(p.id);
    return def ? `You take up the ${def.name}'s discipline.` : null;
  },

  "chest:opened": (p) => `The Stockpile widened to ${p.slots} slots.`,
  "item:salvaged": (p) => `Broke down ${itemName(p.key)} for ${p.qty} ${itemName(p.mat)}.`,

  // The market runs on the server; its halves in the save leave a record too.
  "market:listed": (p) => `Listed ${fmt(p.qty)} × ${itemName(p.key)} at ${fmtGold(p.priceEach)} each.`,
  "market:bought": (p) => `Bought ${fmt(p.qty)} × ${itemName(p.key)} on the market for ${fmtGold(p.cost)}.`,
  "market:cancelled": (p) => `${fmt(p.qty)} × ${itemName(p.key)} came back from the market.`,
  "mail:claimed": (p) => {
    const parts = (p.items || []).map((i) => `${fmt(i.qty)} ${itemName(i.key)}`);
    if (p.gold > 0) parts.push(fmtGold(p.gold));
    return parts.length ? `The post brought ${parts.join(", ")}.` : null;
  },
  "mail:unknown": () => "A letter held something the camp no longer knows.",

  away: (p) => {
    const parts = (p.gains || []).map((g) => `${fmt(g.qty)} ${itemName(g.key)}`);
    if (p.gold > 0) parts.push(fmtGold(p.gold));
    return parts.length ? `Away ${fmtTime(p.ms)}: ${parts.slice(0, 4).join(", ")}.` : null;
  },
};

// The camp log line for an event, or null when it is not one for the log.
export function chronicleLine(type, payload) {
  const line = Object.hasOwn(LINES, type) ? LINES[type] : null;
  return line ? line(payload || {}) : null;
}

export function attachChronicle(emitter) {
  return emitter.on("*", (payload, type) => {
    const line = chronicleLine(type, payload);
    const state = payload && payload.state;
    if (!line || !state || !Array.isArray(state.log)) return;
    state.log.push({ t: payload.at == null ? state.clock : payload.at, m: line });
    if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
  });
}
