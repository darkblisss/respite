/* ============================================================
   Respite · popups/item.js · The Appraiser
   ------------------------------------------------------------
   One popup for every item, wherever it turns up:

     openPopup("item", ctx, key, { from, readOnly })

   from  "inv" | "bank" | "vault"  held there: equip or take up,
         | "satchel"               move, sell, open, break down,
                                   repair, list on the market
         "worn"                    on the paperdoll or in the tool
                                   rack: unequip or stow, repair
         null                      not held (a market row, a recipe):
                                   the facts and no actions
   readOnly shows the facts only, wherever the item is.

   The Satchel is offered only to remedies, because that is all the
   engine lets in (storage.js canHold), and Belongings give a remedy
   a slot a bottle, so the room a move needs is asked of roomFor
   rather than counted here.

   It keeps itself true while open (amounts, wear, what it would
   replace) and closes when the item leaves the place it was
   opened from. Every change is a command.
   ============================================================ */

import { h, setText } from "../dom.js";
import { iconEl } from "../icons.js";
import { openModal, confirm, toast } from "../overlay.js";
import { fmtWhole, fmtGold, fmtStat } from "../format.js";
import { qtyPicker, registerPopup, openPopup } from "../widgets.js";
import { CONFIG } from "../../../shared/config.js";
import { GameData, itemSources, prefixDef, rarityDef, skillName, tierLabel } from "../../../shared/registry.js";
import { itemDef, itemName, stacks } from "../../../shared/items.js";
import { ORDER, POOLS, canHold, isPool, poolName, qtyIn, haveQty, roomFor, slotCap, slotsUsed, placeFor } from "../../../shared/storage.js";
import { displacedBy, salvageValue } from "../../../shared/world.js";
import { wearPct, repairCost } from "../../../shared/combat.js";
import { statsOf, combatStats, skillLevel } from "../../../shared/stats.js";
import { itemLore } from "../../../shared/lore.js";

/* ================= 1. WORDS AND RULES ================= */

const RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, relic: 5 };
const TRADEABLE = ["material", "gear", "tool"];   // as market.js prepareListing allows
const ASK_OVER_GOLD = 500;                          // a sale worth more than this asks first

const SLOT_NOUN = {
  weapon: "weapon", offhand: "offhand", head: "headgear", chest: "body armour",
  hands: "gloves", feet: "boots", neck: "amulet", ring: "ring",
};

const SLOT_LABEL = (slot) => GameData.SLOT_LABELS[slot].toLowerCase();

const POOL_ICON = { inv: "pack", bank: "stockpile", vault: "lock", satchel: "ration" };

// How a pool reads inside a sentence: "Belongings", "the Stockpile".
const phrase = (w) => (w === "inv" ? poolName(w) : `the ${poolName(w)}`);

const sign = (n) => (n > 0 ? "+" : "−");
const fineOrBetter = (d) => d.kind !== "material" && (RANK[d.rarity] || 0) >= RANK.rare;

function kindLabel(d) {
  if (d.kind === "gear") return `${rarityDef(d.rarity).name} ${SLOT_NOUN[d.slot] || "gear"}`;
  if (d.kind === "tool") return d.rarity && d.rarity !== "common" ? `${rarityDef(d.rarity).name} tool` : "Tool";
  if (d.heal) return "Remedy";
  if (d.chest) return "Supplies";
  return d.category || "Material";
}

// The equipment slot (or tool skill) this key is worn in, or null.
function wornSlot(state, key, d) {
  if (d.kind === "tool") return Object.hasOwn(state.tools, d.forSkill) && state.tools[d.forSkill] === d.base ? d.forSkill : null;
  return GameData.EQUIP_SLOTS.find((s) => state.equipment[s] === key) || null;
}

function stillThere(state, key, d, from) {
  if (isPool(from)) return qtyIn(state, from, key) > 0;
  if (from === "worn") return !!wornSlot(state, key, d);
  return true;
}

const rackedTool = (state, skillId) =>
  (Object.hasOwn(state.tools, skillId) && state.tools[skillId] ? state.tools[skillId] : null);

/* Where each piece that equipping `key` pushes out would land. world.js takes
   the new piece out of `from` first, then stows each old one by
   [from, Belongings, Stockpile, Vault], a stack already held growing where it
   is. null: nowhere, and equip would refuse. */
function stowPlan(state, key, from, olds) {
  const order = [from, "inv", "bank", "vault"].filter((w, i, all) => all.indexOf(w) === i);
  const freed = qtyIn(state, from, key) <= 1;
  const added = { inv: 0, bank: 0, vault: 0 };
  const placed = new Set();
  const holds = (w, k) => placed.has(`${w}|${k}`) || qtyIn(state, w, k) - (w === from && k === key ? 1 : 0) > 0;
  const room = (w) => slotsUsed(state, w) - (w === from && freed ? 1 : 0) + added[w] < slotCap(state, w);
  return olds.map((old) => {
    const dest = order.find((w) => holds(w, old)) || order.find(room) || null;
    if (dest && !holds(dest, old)) {
      added[dest] += 1;
      placed.add(`${dest}|${old}`);
    }
    return dest;
  });
}

// world.js salvage takes the piece out first, then stashes what it gives by ORDER.material.
function salvageRoom(state, key, from, mat) {
  if (ORDER.material.some((w) => qtyIn(state, w, mat) > 0)) return true;
  const freed = qtyIn(state, from, key) <= 1;
  return ORDER.material.some((w) => slotsUsed(state, w) - (w === from && freed ? 1 : 0) < slotCap(state, w));
}

// "the Slag Sword to Belongings", or both pieces, sharing a place when they can.
function movesLine(names, dests) {
  if (names.length === 1 || dests[0] === dests[1]) {
    const who = names.map((n) => `the ${n}`).join(" and ");
    return `${who} to ${phrase(dests[0])}`;
  }
  return names.map((n, i) => `the ${n} to ${phrase(dests[i])}`).join(" and ");
}

/* ================= 2. WHAT IT IS ================= */

function sourcesNode(d) {
  const S = itemSources(d.base);
  const uniq = (xs) => [...new Set(xs.filter(Boolean))];
  const rows = [];
  const gathered = uniq(S.gatheredBy.map((a) => a && skillName(a.skillId)));
  if (gathered.length) rows.push(["Gathered by", gathered.join(", ")]);
  const made = uniq(S.madeBy.map((a) => a && skillName(a.skillId)));
  if (made.length) rows.push(["Made by", made.join(", ")]);
  const users = GameData.PROFESSIONS.filter((p) => S.usedIn.some((a) => a && a.skillId === p.id)).map((p) => p.name);
  if (users.length) rows.push(["Used by", users.join(", ")]);
  const drops = uniq(S.droppedBy.map((m) => m && m.name));
  if (drops.length) rows.push(["Dropped by", drops.join(", ")]);
  if (d.heal) rows.push(["Sold by", "The Bonesetter"]);
  if (d.kind === "gear" && d.repairMat) rows.push(["Repaired with", itemName(d.repairMat)]);
  if (!rows.length) return null;
  return h("dl.ip-sources", rows.map(([t, v]) => [h("dt", t), h("dd", v)]));
}

function deltaOf(n, show) {
  if (!(Math.abs(n) >= 0.05)) return null;
  return { cls: n > 0 ? "up" : "down", text: `${sign(n)}${show(Math.abs(n))}` };
}

const critText = (x) => `${+x.toFixed(1)}%`;

// What equipping the piece would do to the hunter, from combatStats, so relic effects count.
function gearCompare(state, key, d) {
  const w = state.equipment.weapon;
  const wd = w ? itemDef(w) : null;
  if (d.slot === "offhand" && wd && wd.twoHanded) return { blocked: w, displaced: [] };
  const displaced = displacedBy(state, key);
  if (!displaced.length) return { blocked: null, displaced };
  const next = { ...state.equipment, [d.slot]: key };
  if (d.slot === "weapon" && d.twoHanded) next.offhand = null;
  const after = combatStats({ level: skillLevel(state, "warfare"), klass: state.player.klass, equipment: next });
  return { blocked: null, displaced, before: statsOf(state), after };
}

function statRows(state, key, d, from, qty) {
  const rows = [];
  const add = (l, v, more) => rows.push({ l, v, ...more });

  if (d.kind === "gear") {
    const cmp = from === "worn" ? null : gearCompare(state, key, d);
    const diff = (stat) => (cmp && cmp.after ? cmp.after[stat] - cmp.before[stat] : 0);
    [["attack", "Attack", "attack"], ["defence", "Defence", "defence"], ["health", "Health", "maxHp"]].forEach(([own, label, stat]) => {
      const delta = deltaOf(diff(stat), fmtStat);
      if (d[own] || delta) add(label, d[own] ? `+${fmtStat(d[own])}` : "0", { delta });
    });
    const crit = deltaOf(diff("crit") * 100, critText);
    if (d.crit || crit) add("Crit chance", d.crit ? `+${critText(d.crit * 100)}` : "0", { delta: crit });
    if (state.player.klass) {
      const was = cmp && cmp.after ? cmp.displaced.reduce((n, k) => n + ((itemDef(k) || {}).veil || 0), 0) : d.veil;
      const veil = cmp && cmp.after ? deltaOf(d.veil - was, fmtStat) : null;
      if (d.veil || veil) add("Veil a blow", d.veil ? `+${fmtStat(d.veil)}` : "0", { delta: veil });
    }
    if (d.slot === "weapon") add("Grip", d.twoHanded ? "Two-handed" : "One-handed");
    if (d.maxDur) {
      const p = wearPct(state, key);
      if (from === "worn" || (p != null && p < 100)) {
        const left = Math.max(0, d.maxDur - (Object.hasOwn(state.wear, key) ? state.wear[key] : 0));
        add("Condition", `${p}%`, { tone: p > 60 ? "good" : p > 25 ? "gold" : "bad", small: `${fmtWhole(left)} of ${fmtWhole(d.maxDur)}` });
      } else {
        add("Durability", fmtWhole(d.maxDur));
      }
    }
  }

  if (d.kind === "tool") {
    const own = Math.round(d.speed * 100);
    const racked = from === "worn" ? null : rackedTool(state, d.forSkill);
    const rd = racked ? itemDef(racked) : null;
    add(`${skillName(d.forSkill)} speed`, `+${own}%`, { delta: rd ? deltaOf(own - Math.round(rd.speed * 100), (x) => `${x}%`) : null });
  }

  const many = isPool(from) && qty > 1;
  add("Value", many ? `${fmtGold(d.value)} each · ${fmtGold(d.value * qty)}` : fmtGold(d.value), { tone: "gold" });

  const total = haveQty(state, key);
  if (isPool(from)) {
    if (total > qty) add("Held in all", fmtWhole(total));
  } else if (total > 0) {
    add(from === "worn" ? "Also held" : "Held", fmtWhole(total));
  }
  return rows;
}

const statNode = (r) => h("div.stat",
  h("span.l", r.l),
  h("span.v", { class: r.tone && `t-${r.tone}` },
    r.v,
    r.small ? h("small", r.small) : null,
    r.delta ? h("span.delta", { class: r.delta.cls }, r.delta.text) : null));

// The quiet line about what it does: a remedy's heal, a chest's slots.
function noteParts(state, d, from) {
  if (d.heal) {
    const at = Math.round(CONFIG.hunt.remedyAt * 100);
    const packed = qtyIn(state, "satchel", d.base);
    // Where it is decides whether the hunt can reach it, so the line says so plainly.
    const where = from === "satchel"
      ? ` The hunt drinks this one at ${at}% health, the strongest in the Satchel first.`
      : packed > 0
        ? ` Only the Satchel is reached in a fight, and ${fmtWhole(packed)} is already packed.`
        : " Pack it in the Satchel or the hunt goes without it.";
    return ["heart", ["Heals ", h("b", fmtWhole(d.heal)), ".", where]];
  }
  if (d.chest) {
    const max = CONFIG.storage.bankMax;
    const slots = state.bank.slots;
    if (slots >= max) return ["crate", [`The Stockpile is as wide as it goes: ${fmtWhole(max)} slots.`]];
    return ["crate", [`Opens the Stockpile from ${fmtWhole(slots)} slots to ${fmtWhole(Math.min(max, slots + d.chest))}. It goes no wider than ${fmtWhole(max)}.`]];
  }
  return null;
}

// Against what you wear (or hold in the rack), and where that would go.
function compareParts(state, key, d, from, acting) {
  if (from === "worn") return null;

  if (d.kind === "gear") {
    const icon = d.slot === "weapon" || d.slot === "offhand" ? "swords" : "shield";
    const cmp = gearCompare(state, key, d);
    if (cmp.blocked) return [icon, ["Your ", h("b", itemName(cmp.blocked)), " takes both hands."]];
    if (!cmp.displaced.length) return [icon, [`Nothing is worn in your ${SLOT_LABEL(d.slot)} slot.`]];
    const names = cmp.displaced.map(itemName);
    const parts = ["Against your worn ", h("b", names[0]), names[1] ? [" and ", h("b", names[1])] : null, "."];
    if (acting && state.equipment[d.slot] !== key) {
      const dests = stowPlan(state, key, from, cmp.displaced);
      parts.push(dests.every(Boolean)
        ? ` Equipping it moves ${movesLine(names, dests)}.`
        : " There is no room to stow what you wear.");
    }
    return [icon, parts];
  }

  if (d.kind === "tool") {
    const racked = rackedTool(state, d.forSkill);
    if (!racked) return [d.icon, [`No ${skillName(d.forSkill)} tool in hand.`]];
    const name = itemName(racked);
    const parts = ["Against the ", h("b", name), " in hand."];
    if (acting && racked !== d.base) {
      const [dest] = stowPlan(state, key, from, [racked]);
      parts.push(dest ? ` Taking it up moves the ${name} to ${phrase(dest)}.` : " There is no room to put the old one away.");
    }
    return [d.icon, parts];
  }
  return null;
}

/* ================= 3. THE POPUP ================= */

function openItem(ctx, key, opts, extra) {
  // Pages pass (key, { from, readOnly }); the dev runner's URL args read (key, from, { readOnly }).
  let from = null;
  let readOnly = false;
  if (opts && typeof opts === "object") {
    from = opts.from == null ? null : opts.from;
    readOnly = !!opts.readOnly;
  } else {
    from = opts == null ? null : opts;
    readOnly = !!(extra && extra.readOnly);
  }

  const d = itemDef(key);
  if (!d) {
    toast("No such item", { kind: "warn" });
    return null;
  }
  if (from !== "worn" && !isPool(from)) from = null;
  // Opened on a place it has already left: the facts are still worth showing.
  if (!stillThere(ctx.state, key, d, from)) from = null;
  const acting = !readOnly && from !== null;

  const lore = itemLore(d);
  const desc = lore ? h("p.ip-desc", lore) : null;
  const effect = d.prefix && prefixDef(d.prefix)
    ? h("div.ip-effect", h("b", `${prefixDef(d.prefix).name}. `), `${d.effect}.`)
    : null;
  const note = h("div.well.ip-compare");
  const stats = h("div.stats");
  const compare = h("div.well.ip-compare");
  const sources = sourcesNode(d);
  const pickerHolder = h("div");
  const amount = h("div.ap-block", h("div.eyebrow", "Amount"), pickerHolder);

  const gearArt = d.kind === "gear" || d.kind === "tool";
  let off = null;
  const m = openModal({
    title: itemName(key),
    art: d.icon,
    artRarity: d.heal ? null : gearArt ? d.rarity || "common" : "common",
    artTone: d.heal ? "good" : "violet",
    size: "md",
    body: [],
    onClose: () => { if (off) off(); },
  });

  const P = { sub: null, noteSig: null, statsSig: null, compareSig: null, actSig: null, picker: null, presets: null, max: 0 };

  const qtyHere = (state) => (isPool(from) ? qtyIn(state, from, key) : 0);
  const amountNow = (state) => (P.picker ? Math.max(1, Math.min(Math.floor(P.picker.pick.n) || 1, qtyHere(state))) : 1);

  /* ---- actions ---- */

  /* A command, then a fresh look: the popup stays while the item is still
     there. The look waits a turn so the dialog has handed its buttons back. */
  const send = (type, args) => ctx.dispatch(type, args).then(() => {
    setTimeout(refresh, 0);
    return false;
  });

  async function sell() {
    const state = ctx.state;
    const n = amountNow(state);
    const gold = d.value * n;
    if (fineOrBetter(d) || gold > ASK_OVER_GOLD) {
      const ok = await confirm({
        title: `Sell ${n > 1 ? `${fmtWhole(n)} × ` : ""}${itemName(key)}?`,
        body: fineOrBetter(d)
          ? `The merchant pays ${fmtGold(gold)}. Once sold, it does not come back.`
          : `The merchant pays ${fmtGold(gold)} for the lot.`,
        confirmText: `Sell for ${fmtGold(gold)}`,
      });
      if (!ok || m.closed) return false;
    }
    return send("sellItem", { key, from, qty: n });
  }

  async function breakDown() {
    const sv = salvageValue(key);
    if (!sv) return false;
    if (fineOrBetter(d)) {
      const ok = await confirm({
        title: `Break down the ${itemName(key)}?`,
        body: `It comes apart into ${fmtWhole(sv.qty)} ${itemName(sv.mat)}. The piece is gone for good.`,
        confirmText: "Break it down",
      });
      if (!ok || m.closed) return false;
    }
    return send("salvage", { key, from });
  }

  function repairAction(state) {
    const cost = d.kind === "gear" ? repairCost(state, key) : null;
    if (!cost) return null;
    const have = haveQty(state, cost.mat);
    const what = `${fmtWhole(cost.qty)} ${itemName(cost.mat)}`;
    return {
      id: "repair",
      label: have >= cost.qty ? `Repair · ${what}` : `Repair needs ${what}`,
      icon: "shield",
      disabled: have < cost.qty,
      onClick: () => send("repair", { key }),
    };
  }

  function actionList(state) {
    if (!acting) return [];
    const list = [];

    if (from === "worn") {
      if (d.kind === "tool") {
        const dest = placeFor(state, d.base, ["bank", "inv", "vault"]);
        list.push({
          id: "stow", kind: "primary", wide: true, icon: POOL_ICON[dest || "bank"],
          label: dest ? `Stow in ${poolName(dest)}` : "Nowhere to stow it",
          disabled: !dest,
          onClick: () => send("unequipTool", { skillId: d.forSkill }),
        });
      } else {
        const slot = wornSlot(state, key, d);
        const dest = placeFor(state, key, ["inv", "bank", "vault"]);
        list.push({
          id: "unequip", kind: "primary", wide: true, icon: "pack",
          label: dest ? "Unequip" : "Nowhere to put it",
          disabled: !dest || !slot,
          onClick: () => send("unequip", { slot: wornSlot(ctx.state, key, d) }),
        });
        list.push(repairAction(state));
      }
      return list.filter(Boolean);
    }

    const qty = qtyHere(state);
    const many = !!P.picker;
    const n = amountNow(state);

    if (d.kind === "gear" && d.slot) {
      const cmp = gearCompare(state, key, d);
      const already = state.equipment[d.slot] === key;
      const room = cmp.displaced.length ? stowPlan(state, key, from, cmp.displaced).every(Boolean) : true;
      list.push({
        id: "equip", kind: "primary", wide: true,
        icon: d.slot === "weapon" || d.slot === "offhand" ? "swords" : "plate",
        label: already ? "Already worn" : `Equip · ${GameData.SLOT_LABELS[d.slot]}`,
        disabled: already || !!cmp.blocked || !room,
        onClick: () => send("equip", { key, from }),
      });
    }

    if (d.kind === "tool") {
      const racked = rackedTool(state, d.forSkill);
      const room = racked ? stowPlan(state, key, from, [racked]).every(Boolean) : true;
      list.push({
        id: "takeup", kind: "primary", wide: true, icon: d.icon,
        label: racked === d.base ? "Already in hand" : `Take up · ${skillName(d.forSkill)}`,
        disabled: racked === d.base || !room,
        onClick: () => send("equip", { key, from }),
      });
    }

    if (d.chest && state.bank.slots < CONFIG.storage.bankMax) {
      const more = Math.min(CONFIG.storage.bankMax, state.bank.slots + d.chest) - state.bank.slots;
      list.push({
        id: "open", kind: "primary", wide: true, icon: "crate",
        label: `Open · +${fmtWhole(more)} Stockpile slots`,
        onClick: () => send("useChest", { key, from }),
      });
    }

    /* One move a pool that would take it. The Satchel is left out for
       anything but a remedy, and the room asked for is the amount on the
       picker, because Belongings spend a slot a bottle. */
    POOLS.filter((w) => w !== from && canHold(w, key)).forEach((w) => {
      const room = roomFor(state, w, key, n);
      // "Pack 4 in Satchel" beside "Move 4 to Stockpile": the same shape, on one line.
      const verb = w === "satchel" ? "Pack" : "Move";
      const prep = w === "satchel" ? "in" : "to";
      list.push({
        id: `move-${w}`, icon: POOL_ICON[w],
        label: !room ? `${poolName(w)} is full`
          : many ? `${verb} ${fmtWhole(n)} ${prep} ${poolName(w)}` : `${verb} ${prep} ${poolName(w)}`,
        disabled: !room,
        onClick: () => send("moveItem", { key, from, to: w, qty: amountNow(ctx.state) }),
      });
    });

    list.push({
      id: "sell", kind: "gold", soft: true, icon: "coin",
      label: many ? `Sell ${fmtWhole(n)} · ${fmtGold(d.value * n)}` : `Sell · ${fmtGold(d.value)}`,
      onClick: sell,
    });

    const tradeable = TRADEABLE.includes(d.kind) && !(!stacks(key) && Object.values(state.equipment).includes(key));
    if (ctx.account && ctx.account.mode === "account" && tradeable) {
      list.push({
        id: "list", kind: "primary", soft: true, icon: "market",
        label: "List on the market",
        // The sell dialog opens on top; this one stays for when it closes.
        onClick: () => {
          openPopup("sell", ctx, key, from);
          return false;
        },
      });
    }

    list.push(repairAction(state));

    const sv = salvageValue(key);
    if (sv) {
      const room = salvageRoom(state, key, from, sv.mat);
      list.push({
        id: "salvage", kind: "quiet", wide: true, icon: "hammer",
        label: room ? `Break down · ${fmtWhole(sv.qty)} ${itemName(sv.mat)}` : "No room for what it breaks into",
        disabled: !room,
        onClick: breakDown,
      });
    }

    return list.filter(Boolean);
  }

  // Grid footers pair half-width buttons; an odd one out spans the row.
  function pairUp(list) {
    let run = [];
    const flush = () => {
      if (run.length % 2) run[run.length - 1].wide = true;
      run = [];
    };
    list.forEach((a) => (a.wide ? flush() : run.push(a)));
    flush();
    // Two or fewer sit in a row, where the main action goes last.
    return list.length <= 2 ? list.slice().reverse() : list;
  }

  function paintActions(state) {
    // A command still running owns the buttons until it answers.
    if (m.el.querySelector(".modal-foot .is-loading")) return;
    const list = pairUp(actionList(state));
    const sig = list.map((a) => `${a.id}:${a.kind || ""}:${a.soft ? 1 : 0}:${a.wide ? 1 : 0}:${a.icon || ""}`).join(",");
    if (sig !== P.actSig) {
      P.actSig = sig;
      m.setActions(list);
      return;
    }
    list.forEach((a, i) => {
      const btn = m.buttons[i];
      if (!btn) return;
      setText(btn.lastChild, a.label);
      if (btn.disabled !== !!a.disabled) btn.disabled = !!a.disabled;
    });
  }

  /* ---- the amount ---- */

  function syncAmount(state) {
    const qty = qtyHere(state);
    if (!acting || from === "worn" || qty <= 1) {
      if (P.picker) {
        P.picker = null;
        P.presets = null;
        pickerHolder.replaceChildren();
      }
      return false;
    }
    const presets = [1, 10, 100].filter((x) => x < qty).join(",");
    const typing = P.picker && document.activeElement === P.picker.input;
    if (!P.picker || (presets !== P.presets && !typing)) {
      // It starts at the whole stack (moving everything is the usual ask) and keeps a smaller choice.
      const value = !P.picker || P.picker.pick.n >= P.max ? qty : Math.min(P.picker.pick.n, qty);
      P.picker = qtyPicker({
        value, max: qty, allowUnlimited: false, presets: presets ? presets.split(",").map(Number) : [],
        onChange: () => paintActions(ctx.state),
      });
      P.presets = presets;
      pickerHolder.replaceChildren(P.picker.node);
    } else if (qty !== P.max) {
      // The whole stack stays the whole stack as it grows or shrinks.
      if (!typing && P.picker.pick.n >= P.max) P.picker.pick.n = qty;
      P.picker.refresh(qty);
    }
    P.max = qty;
    return true;
  }

  /* ---- painting ---- */

  function syncBody(list) {
    const body = m.body;
    Array.from(body.children).forEach((c) => { if (!list.includes(c)) c.remove(); });
    list.forEach((n, i) => {
      const at = body.children[i];
      if (at !== n) body.insertBefore(n, at || null);
    });
  }

  const partsSig = (parts) => (parts ? JSON.stringify([parts[0], flatText(parts[1])]) : "");
  function flatText(parts) {
    return [].concat(parts).flat(3).filter((p) => p != null).map((p) => (typeof p === "string" ? p : `<${p.textContent}>`)).join("");
  }
  const fillWell = (node, parts) => node.replaceChildren(iconEl(parts[0]), h("span", parts[1]));

  function paint(state) {
    const qty = qtyHere(state);

    const where = isPool(from)
      ? (qty > 1 ? `${poolName(from)} ×${fmtWhole(qty)}` : `In ${phrase(from)}`)
      : from === "worn" ? (d.kind === "tool" ? "In hand" : "Worn") : null;
    const sub = [kindLabel(d), d.tier && !d.reagent ? tierLabel(d.tier) : null, where].filter(Boolean).join(" · ");
    if (sub !== P.sub) {
      P.sub = sub;
      m.setTitle(itemName(key), sub);
    }

    const noteP = noteParts(state, d, from);
    const noteSig = partsSig(noteP);
    if (noteSig !== P.noteSig) {
      P.noteSig = noteSig;
      if (noteP) fillWell(note, noteP);
    }

    const rows = statRows(state, key, d, from, qty);
    const statsSig = JSON.stringify(rows);
    if (statsSig !== P.statsSig) {
      P.statsSig = statsSig;
      stats.replaceChildren(...rows.map(statNode));
    }

    const cmpP = compareParts(state, key, d, from, acting);
    const cmpSig = partsSig(cmpP);
    if (cmpSig !== P.compareSig) {
      P.compareSig = cmpSig;
      if (cmpP) fillWell(compare, cmpP);
    }

    const picking = syncAmount(state);
    syncBody([desc, effect, noteP && note, stats, cmpP && compare, sources, picking && amount].filter(Boolean));
    paintActions(state);
  }

  function refresh() {
    if (m.closed) return;
    const state = ctx.state;
    if (!stillThere(state, key, d, from)) {
      m.close("gone");
      return;
    }
    paint(state);
  }

  paint(ctx.state);
  off = ctx.onTick(refresh);
  return m;
}

registerPopup("item", openItem);
