/* ============================================================
   Respite · ui/search.js · Finding Your Way
   ------------------------------------------------------------
   The topbar's search: pages, skills, every piece in the world
   and every foe, and any commander by name. It sits where the
   breadcrumb used to, which only ever said what the page title
   already did.

   Pages and skills go to their page; an item opens its sheet
   read only; a foe opens the bestiary; a name goes to that
   commander's page. Everything is the registry's own word, so a
   line shelved behind `released: false` is not offered.

   Below 1280px the field folds into a button that opens it over
   the page. The phone drawer carries a second one, always open.
   "/" or Ctrl/Cmd+K reaches the topbar one from anywhere.
   ============================================================ */

import { h, on } from "./dom.js";
import { iconEl } from "./icons.js";
import { openPopup } from "./widgets.js";
import { GameData, SKILL_ORDER, getSkill } from "../../shared/registry.js";

const MAX = 8;

const PAGES = [
  ["Character", "#/character", "vanguardCharacter"],
  ["Inventory", "#/armaments", "vanguardInventory"],
  ["Discipline", "#/discipline", "vanguardDiscipline"],
  ["Party", "#/party", "vanguardParty"],
  ["Atlas", "#/atlas", "realmAtlas"],
  ["Market", "#/market", "realmMarket"],
  ["Leaderboard", "#/hiscores", "realmLeaderboard"],
  ["Stockpile", "#/stockpile", "campStockpile"],
  ["Bounties", "#/bounties", "campBounties"],
  ["Requisitions", "#/requisitions", "campRequisitions"],
  ["Shop", "#/shop", "campShop"],
  ["Fortify", "#/fortify", "campFortify"],
];

let INDEX = null;

// Built on first use: some four hundred rows, read once.
function index() {
  if (INDEX) return INDEX;
  const shelved = (g) => GameData.WEAPON_LINE_IDS.includes(g.line) && !GameData.LIVE_LINES.includes(g.line);
  const rows = [];
  PAGES.forEach(([name, href, icon]) => rows.push({ kind: "page", name, sub: "Page", icon, href }));
  SKILL_ORDER.forEach((id) => {
    const s = getSkill(id);
    rows.push({ kind: "page", name: s.name, sub: id === "warfare" ? "The Hunt" : "Skill", icon: s.icon, href: `#/skill/${id}` });
  });
  const labels = GameData.SLOT_LABELS || {};
  Object.values(GameData.GEAR).filter((g) => !shelved(g)).forEach((d) =>
    rows.push({ kind: "item", id: d.id, name: d.name, sub: labels[d.slot] || "Gear", icon: d.icon }));
  Object.values(GameData.TOOLS).forEach((d) => rows.push({ kind: "item", id: d.id, name: d.name, sub: "Tool", icon: d.icon }));
  Object.values(GameData.MATERIALS).forEach((d) =>
    rows.push({ kind: "item", id: d.id, name: d.name, sub: d.heal > 0 ? "Remedy" : d.category || "Material", icon: d.icon }));
  GameData.MONSTERS.forEach((m) =>
    rows.push({ kind: "foe", id: m.id, name: m.name, sub: m.archetype === "sovereign" ? "Sovereign" : "Foe", icon: m.archetype === "sovereign" ? "crown" : "skull" }));
  rows.forEach((r) => { r.key = r.name.toLowerCase(); });
  INDEX = rows;
  return rows;
}

// Starts with the query, then a word that does, then anywhere in it.
function find(q) {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const scored = [];
  for (const r of index()) {
    const at = r.key.indexOf(t);
    if (at < 0) continue;
    const score = at === 0 ? 0 : r.key[at - 1] === " " || r.key[at - 1] === "-" ? 1 : 2;
    scored.push([score + (r.kind === "page" ? 0 : r.kind === "item" ? 0.1 : 0.2), r]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  const out = scored.slice(0, MAX).map((x) => x[1]);
  // Anyone at all, by name: the realm answers on their page.
  if (/^[a-z0-9_]{2,24}$/i.test(t)) out.push({ kind: "who", name: t, sub: "Look up a commander", icon: "person", href: `#/player/${encodeURIComponent(t)}` });
  return out;
}

let seq = 0;

/**
 * searchBox(getCtx, { fold, onGo })
 *   fold  true for the topbar: below 1280px it is a button that opens the field
 *   onGo  called once a result has been taken (the drawer closes itself on it)
 * Returns { node, focus() }.
 */
export function searchBox(getCtx, { fold = false, onGo = null } = {}) {
  const id = `srch${++seq}`;
  const input = h("input.srch-input", {
    type: "search", autocomplete: "off", spellcheck: "false", placeholder: "Search the realm",
    role: "combobox", "aria-expanded": "false", "aria-controls": `${id}-list`, "aria-autocomplete": "list", "aria-label": "Search",
  });
  const list = h("ul.srch-list", { id: `${id}-list`, role: "listbox", hidden: true });
  const hint = h("kbd.srch-kbd", { "aria-hidden": "true" }, "/");
  const field = h("div.srch-field", iconEl("search", "srch-ico"), input, hint, list);
  const btn = fold ? h("button.tb-icon-btn.srch-btn", { type: "button", "aria-label": "Search" }, iconEl("search")) : null;
  const node = h("div.srch", { class: fold && "is-fold" }, btn, field);

  let rows = [];
  let at = -1;

  function paint() {
    list.replaceChildren(...rows.map((r, i) => h("li.srch-row", {
      role: "option", id: `${id}-o${i}`, "aria-selected": i === at ? "true" : "false", dataset: { i: String(i) },
    }, iconEl(r.icon || "sparkle", "srch-row-ico"), h("span.srch-row-name", r.name), h("span.srch-row-sub", r.sub))));
    const show = rows.length > 0;
    list.hidden = !show;
    input.setAttribute("aria-expanded", show ? "true" : "false");
    if (at >= 0) input.setAttribute("aria-activedescendant", `${id}-o${at}`);
    else input.removeAttribute("aria-activedescendant");
  }

  function close() {
    rows = [];
    at = -1;
    paint();
    node.classList.remove("is-open");
  }

  function go(r) {
    if (!r) return;
    const ctx = getCtx();
    input.value = "";
    close();
    input.blur();
    if (r.href) location.hash = r.href;
    else if (r.kind === "item") openPopup("item", ctx, r.id, { from: null, readOnly: true });
    else if (r.kind === "foe") openPopup("foe", ctx, r.id);
    if (onGo) onGo(r);
  }

  input.addEventListener("input", () => {
    rows = find(input.value);
    at = rows.length ? 0 : -1;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      at = (at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      paint();
      const li = list.children[at];
      if (li && li.scrollIntoView) li.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(rows[at]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      input.value = "";
      close();
      input.blur();
    }
  });
  // mousedown, not click: a click lands after the input's blur has already closed the list.
  on(list, "mousedown", "[data-i]", (e, li) => {
    e.preventDefault();
    go(rows[Number(li.dataset.i)]);
  });
  input.addEventListener("blur", () => setTimeout(() => {
    if (document.activeElement !== input) close();
  }, 120));

  if (btn) {
    btn.addEventListener("click", () => {
      node.classList.add("is-open");
      input.focus();
    });
  }

  return {
    node,
    focus() {
      node.classList.add("is-open");
      input.focus();
      input.select();
    },
  };
}
