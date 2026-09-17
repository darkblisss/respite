/* ============================================================
   Respite · listeners.js · The Town Crier
   ------------------------------------------------------------
   Turns what happens in the camp into toasts. Only the store's
   live bus is heard: replays and long catch-ups run on a quiet
   one, so nothing here is ever told for time already told.

   Two guards on top of that. Bursts are thinned (twenty crafted
   pieces in one frame make two toasts, not twenty). And news that
   names one thing (a level, a find, a road opening) is told once
   per session, even if the server's answer moves it a little.
   ============================================================ */

import { toast } from "./ui/overlay.js";
import { hasPopup, openPopup } from "./ui/widgets.js";
import { fmt, fmtGold, fmtTime } from "./ui/format.js";
import { GameData, getCompanion, getMonster, getRegion, rarityDef, skillName } from "../shared/registry.js";
import { itemDef, itemName, parseKey } from "../shared/items.js";

const BURST_MS = 4000;       // a kind of news gets this many toasts...
const BURST_MAX = 2;         // ...in this window
const ONCE_KEEP = 400;       // one-off news remembered, newest kept

// Toasts and chips carry no full stop; the rules' refusals do.
export const plainText = (text) => String(text == null ? "" : text).trim().replace(/\.$/, "");

const rarityRank = (key) => GameData.RARITIES.findIndex((r) => r.key === key);
const companionName = (id) => {
  const def = getCompanion(id);
  return def ? def.name : "A companion";
};

/* type -> (payload) => [text, toastOptions, guard] | array of those | null
   guard: { once: signature } told once a session; { every: ms, key } at most that often. */
const TABLE = {
  "skill:mastery": (p) => [`${skillName(p.skillId)} ${p.level}: ${p.label}`, { kind: "good", icon: "sparkle" }, { once: `mastery:${p.skillId}:${p.level}` }],

  "skill:level": (p) => (p.level % 10 === 0
    ? [`${skillName(p.skillId)} reaches level ${p.level}`, { kind: "good" }, { once: `level:${p.skillId}:${p.level}` }]
    : null),

  "task:ended": (p) => {
    const says = {
      stock: ["Out of materials", "warn"],
      storage: ["Nowhere to put anything", "bad"],
      limit: ["Batch finished", "good"],
      cap: ["The crews stood down", "info"],
    }[p.reason];
    return says ? [says[0], { kind: says[1] }, { once: `task:${p.skillId}:${p.actionId}:${p.at}` }] : null;
  },

  "item:crafted": (p) => {
    const rank = rarityRank(p.rarity);
    if (rank < 1) return null;
    const def = itemDef(p.key);
    // A relic wears its prefix in its name; the rest read "Rare: Bog Sword".
    const name = def ? (def.prefix ? itemName(p.key) : def.name) : itemName(p.key);
    return [`${rarityDef(p.rarity).name}: ${name}`, { kind: rank >= 3 ? "gold" : "info" }, { once: parseKey(p.key).uid ? `crafted:${p.key}` : null }];
  },

  "storage:full": (p) => [`Nowhere to put ${itemName(p.key)}`, { kind: "warn" }, { every: 60 * 1000, key: "storage:full" }],

  "bounty:complete": (p, ctx) => [
    "Bounty complete",
    { kind: "gold", icon: "scroll", action: { label: "View", onClick: () => ctx.go("#/bounties") } },
    { once: `bounty:${p.state && p.state.bounty ? p.state.bounty.window : p.at}` },
  ],

  "bounty:paid": () => ["Double experience for one hour", { kind: "gold", icon: "sparkle" }],

  "agent:hired": (p) => [`Agent hired: ${p.name}`, { kind: "info", icon: "crate" }],

  "requisitions:returned": (p) => ["Requisitions returned", { kind: "good", icon: "crate" }, { once: `requisitions:${p.at}` }],

  "travel:unlocked": (p) => {
    const region = getRegion(p.regionId);
    return [`${region ? region.name : "A new road"} unlocked`, { kind: "gold", icon: "atlas" }, { once: `travel:${p.regionId}` }];
  },

  "companion:bought": (p) => [`${companionName(p.id)} joins you`, { kind: "good", icon: "paw" }],

  "companion:bond": (p) => (Array.isArray(p.unlocks) ? p.unlocks : []).map((text, i) => (
    [`${companionName(p.id)}: ${plainText(text)}`, { kind: "good", icon: "paw" }, { once: `bond:${p.id}:${p.level}:${i}` }]
  )),

  "companion:found": (p) => (p.rankUp
    ? [`${companionName(p.id)}: Rank ${GameData.RANK_NUMERALS[p.rank] || p.rank}`, { kind: "good", icon: "paw" }, { once: `rank:${p.id}:${p.rank}` }]
    : [`${companionName(p.id)} found`, { kind: "good", icon: "paw" }, { once: `found:${p.id}:${p.rank}:${p.dupes}` }]),

  "hunt:ended": (p) => {
    if (p.reason === "limit") return ["Hunt finished", { kind: "good", icon: "swords" }];
    if (p.reason === "cap") return ["The hunt stood down", { kind: "info", icon: "swords" }];
    return null;
  },

  "hunt:death": (p) => ["You fell", { kind: "bad", icon: "skull" }, { once: `death:${p.at}` }],

  "hunt:sovereign": (p) => {
    const mob = getMonster(p.monsterId);
    return [`${mob ? mob.name : "Something vast"} comes up out of the dark`, { kind: "bad", icon: "skull" }];
  },

  "hunt:felled": (p) => [p.key ? `Sovereign felled: ${itemName(p.key)}` : "Sovereign felled", { kind: "gold", icon: "crown" }, { once: p.key ? `felled:${p.key}` : null }],

  "hunt:retreat": () => ["You broke away", { kind: "warn" }],

  "hunt:hide": () => ["Hiding for five minutes", { kind: "info", icon: "eye-off" }],

  "loot:lost": () => ["No room for loot", { kind: "warn" }, { every: 60 * 1000, key: "loot:lost" }],

  "loot:found": (p) => [`Found: ${itemName(p.key)}`, { kind: "gold" }, { once: `loot:${p.key}` }],

  "item:broke": (p) => [`${itemName(p.key)} broke`, { kind: "bad" }],

  "store:rejected": (p) => [plainText(p.error) || "The server turned that away", { kind: "warn" }],

  "store:news": (p) => {
    if (p.type === "mail:claimed") {
      const items = Array.isArray(p.items) ? p.items : [];
      const parts = items.slice(0, 2).map((i) => `${fmt(i.qty)} ${itemName(i.key)}`);
      if (items.length > 2) parts.push(`${items.length - 2} more`);
      if (p.gold > 0) parts.push(fmtGold(p.gold));
      return parts.length ? [`The post: ${parts.join(", ")}`, { kind: "gold", icon: "mail" }] : null;
    }
    // Engine 2: a letter holding something the rules no longer know is claimed empty.
    if (p.type === "mail:unknown") return ["A letter held something the camp no longer knows", { kind: "warn", icon: "mail" }];
    if (p.type === "away") return [`Welcome back: away ${fmtTime(p.ms)}`, { kind: "info", icon: "hourglass" }];
    return null;
  },
};

/**
 * createListeners({ ctx, now }) -> { bind(store), unbind() }
 *   ctx  the shell's ctx: toasts need go(), the class picker needs a ctx
 *   now  () => ms, for the throttles (performance.now in the browser)
 */
export function createListeners({ ctx, now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) } = {}) {
  const bursts = new Map();    // type -> recent toast times
  const spaced = new Map();    // key -> last time
  const once = new Set();
  let off = null;
  let classOpenedFor = null;

  function remember(signature) {
    once.add(signature);
    if (once.size > ONCE_KEEP) once.delete(once.values().next().value);
  }

  function show(type, [text, options, guard]) {
    const t = now();
    if (guard && guard.once) {
      if (once.has(guard.once)) return;
      remember(guard.once);
    }
    if (guard && guard.every) {
      const key = guard.key || type;
      const last = spaced.get(key);
      if (last != null && t - last < guard.every) return;
      spaced.set(key, t);
    }
    const recent = (bursts.get(type) || []).filter((x) => t - x < BURST_MS);
    if (recent.length >= BURST_MAX) {
      bursts.set(type, recent);
      return;
    }
    recent.push(t);
    bursts.set(type, recent);
    toast(text, options);
  }

  function hear(payload, type) {
    if (type === "class:available") {
      // One picker per store, and only if the hunt module has registered it.
      if (classOpenedFor !== off && hasPopup("class")) {
        classOpenedFor = off;
        openPopup("class", ctx);
      }
      return;
    }
    const make = Object.hasOwn(TABLE, type) ? TABLE[type] : null;
    if (!make) return;
    let out;
    try {
      out = make(payload || {}, ctx);
    } catch (err) {
      console.error(`listeners: ${type}`, err);
      return;
    }
    if (!Array.isArray(out) || !out.length) return;
    const list = Array.isArray(out[0]) ? out : [out];
    for (const entry of list) show(type, entry);
  }

  return {
    bind(store) {
      if (off) off();
      off = store && store.bus ? store.bus.on("*", hear) : null;
    },
    unbind() {
      if (off) off();
      off = null;
    },
  };
}
