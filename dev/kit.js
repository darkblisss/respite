/* ============================================================
   Respite · kit.js · The Pattern Book
   ------------------------------------------------------------
   The living style guide. Everything is drawn with the real
   stylesheets and the real helpers in src/client/ui, so what
   you see here is what page code gets.

     dev/kit.html                      the component gallery
     dev/kit.html?page=hunt            one page, inside the real shell
       &bench=idle|working|crafting    the crews chip
       &hunt=idle|hunting|recovering|hiding
       &conn=online|syncing|offline|guest
       &modal=action|item|stack|sell|settings|account|class|buy|short|reset
       &drawer=open                    open the phone drawer
       &shot=1                         no kit switcher, motion frozen

   Mock data only. Nothing here reads a save or talks to a server.
   ============================================================ */

import { h, el, qs, qsa, setText, setWidth, setAttr, clear, on, toggleClass, html } from "../src/client/ui/dom.js";
import { ICONS, icon, iconEl } from "../src/client/ui/icons.js";
import { openModal, confirm, toast, tooltip, tipBody, bindDrawer, closeModals } from "../src/client/ui/overlay.js";
import { fmt, fmtWhole, fmtGold, fmtTime, fmtAgo, signedPct, chancePct, fmtClock, plural } from "../src/client/ui/format.js";

const params = new URLSearchParams(location.search);
const SHOT = params.has("shot");
if (SHOT) document.documentElement.dataset.shot = "1";

/* ================= 1. MOCK WORLD ================= */

const ME = { name: "Morwen", klass: "Warrior", region: "Gallowmoor", tier: 2, total: 187, gold: 1234, hp: 87, maxHp: 112 };

const SKILLS = [
  { id: "felling", name: "Felling", icon: "axe", kind: "gather", lv: 12, xp: 2733, next: 3287, base: 2410 },
  { id: "delving", name: "Delving", icon: "pick", kind: "gather", lv: 24, xp: 58210, next: 66904, base: 51300, working: true },
  { id: "harvesting", name: "Harvesting", icon: "sickle", kind: "gather", lv: 9, xp: 1940, next: 2280, base: 1680 },
  { id: "flaying", name: "Flaying", icon: "knife", kind: "gather", lv: 15, xp: 5102, next: 6010, base: 4420 },
  { id: "dredging", name: "Dredging", icon: "net", kind: "gather", lv: 7, xp: 1180, next: 1440, base: 1030 },
  { id: "forgemaster", name: "Forgemaster", icon: "plate", kind: "craft", lv: 21, xp: 41880, next: 47020, base: 37100 },
  { id: "woodwright", name: "Woodwright", icon: "ward", kind: "craft", lv: 11, xp: 2240, next: 2732, base: 2010 },
  { id: "tanner", name: "Tanner", icon: "treads", kind: "craft", lv: 14, xp: 4390, next: 5102, base: 3914 },
  { id: "weaver", name: "Weaver", icon: "cowl", kind: "craft", lv: 6, xp: 812, next: 1030, base: 700 },
  { id: "artificer", name: "Artificer", icon: "charm", kind: "craft", lv: 3, xp: 214, next: 330, base: 160 },
  { id: "warfare", name: "Hunt", icon: "swords", kind: "war", lv: 31, xp: 120450, next: 131600, base: 109800, hunting: true },
];

const skill = (id) => SKILLS.find((s) => s.id === id);

const BENCH = {
  idle: { state: "idle", icon: "hammer", name: "Idle", short: "Idle", meta: "No crews at work", pct: 0, href: "#/character" },
  working: { state: "working", icon: "pick", name: "Bog Ore", short: "Bog Ore", meta: "42 of 200 · 1h 12m left", pct: 36, href: "#/skill/delving" },
  crafting: { state: "working", icon: "ore", name: "Bog Bar", short: "Bog Bar", meta: "Forging · 18 of 60 · 9m left", pct: 62, href: "#/skill/forgemaster" },
};

const HUNT = {
  idle: { state: "idle", icon: "swords", name: "Idle", short: "Idle", meta: "Nobody is hunting", pct: 0 },
  hunting: { state: "hunting", icon: "zoneInner", name: "Inner · Gallowmoor", short: "Inner", meta: "38 kills · 4,210 XP/hr · Threat 64", pct: 48 },
  recovering: { state: "recovering", icon: "heart", name: "Recovering", short: "3m 12s", meta: "Back in 3m 12s", pct: 64 },
  hiding: { state: "hiding", icon: "eye-off", name: "Hiding", short: "Hiding", meta: "4m 10s left · The Drowned Bailiff searches", pct: 17 },
};

const CONN = { online: "212 online", syncing: "Syncing", offline: "Offline", guest: "Guest" };

const LOG = [
  { t: 40 * 1000, m: "Your crews brought up 12 Bog Ore." },
  { t: 3 * 60 * 1000, m: "You put down a Fen Stalker. It dropped 1 Bristle Pelt." },
  { t: 9 * 60 * 1000, m: "Thane joined the hunt in the Inner of Gallowmoor.", tone: "violet" },
  { t: 26 * 60 * 1000, m: "Bog Bar ×20 sold on the market for 266g.", tone: "gold" },
  { t: 2 * 60 * 60 * 1000, m: "Delving reached level 24.", tone: "good" },
  { t: 5 * 60 * 60 * 1000, m: "You fell in the Core of Gallowmoor. Your gear took the worst of it.", tone: "ember" },
];

/* ================= 2. SMALL BUILDERS (the markup page code copies) ================= */

const ic = (name, cls) => iconEl(name, cls);

function art(name, { tone = "violet", rarity = null, size = null, cls = null } = {}) {
  return h("div.art", {
    class: [size && `art-${size}`, cls],
    "data-tone": rarity ? null : tone,
    "data-rarity": rarity,
    "aria-hidden": "true",
  }, ic(name));
}

const chip = (text, tone, iconName) => h("span.chip", { class: tone && `chip-${tone}` }, iconName ? ic(iconName) : null, text);
const tag = (text, tone) => h("span.tag", { class: tone && `tag-${tone}` }, text);

function bar(pct, cls) {
  return h("div.bar", { class: cls, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(pct)) },
    h("i", { style: { width: `${pct}%` } }));
}

const stat = (l, v, tone, extra) => h("div.stat", h("span.l", l), h("span.v", { class: tone && `t-${tone}` }, v, extra || null));

const delta = (n, suffix = "") => h("span.delta", { class: n > 0 ? "up" : n < 0 ? "down" : "same" }, `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}${suffix}`);

function need(iconName, name, have, count) {
  return h("span.need", { class: have < count && "is-short" },
    ic(iconName), name, h("span.have", fmt(have), h("small", `/${fmt(count)}`)));
}

function infoBtn(label, content, placement = "left") {
  const b = h("button.info-btn", { type: "button", "aria-label": label }, ic("info"));
  tooltip(b, content, { placement });
  return b;
}

function itemPill({ name, iconName, sub, stats = [], state = "idle", pct = 0, tone = null, tip = null, onOpen = null }) {
  return h("article.item-pill", {
    class: { "is-working": state === "working", "is-locked": state === "locked", "is-short": state === "short" },
    "data-tone": tone,
  },
    art(iconName, { tone: tone || "violet" }),
    h("div.pill-main",
      h("button.pill-hit", { type: "button", onClick: onOpen }, name),
      h("div.pill-sub", sub)),
    h("div.pill-stats", stats),
    h("div.pill-end",
      tip ? infoBtn(`${name}: what it gives`, tip) : null,
      ic("chevron-right", "pill-go")),
    h("span.pill-bar", { "aria-hidden": "true" }, h("i", { style: { width: `${pct}%` } })));
}

function slot(it) {
  if (!it) return h("div.slot.is-empty", { "aria-hidden": "true" });
  const wearCls = it.wear == null ? null : it.wear > 60 ? "is-fine" : it.wear > 25 ? "is-worn" : "is-bad";
  return h("button.slot", {
    type: "button",
    "data-rarity": it.rarity || "common",
    class: it.selected && "is-selected",
    "aria-label": `${it.name}${it.qty > 1 ? `, ${fmtWhole(it.qty)}` : ""}`,
  },
    it.wear != null
      ? h("span.slot-wear", { class: wearCls }, `${it.wear}%`)
      : h("span.slot-qty", fmt(it.qty)),
    h("span.slot-art", ic(it.icon)),
    h("span.slot-name", it.name));
}

function pageHead({ eyebrow, title, sub, actions, tone }) {
  return h("header.page-head",
    h("div",
      eyebrow ? h("div.eyebrow.page-eyebrow", { "data-tone": tone }, eyebrow) : null,
      h("h1.page-title", title),
      sub ? h("p.page-sub", sub) : null),
    actions ? h("div.page-actions", actions) : null);
}

function sectionHead(title, sub, end) {
  return h("div.section-head",
    h("div", h("h2.section-title", title), sub ? h("p.section-sub", sub) : null),
    end || null);
}

function cardHead(title, { sub, eyebrow, actions, iconName } = {}) {
  return h("div.card-head",
    h("div",
      eyebrow ? h("div.eyebrow", eyebrow) : null,
      h("h2.card-title", iconName ? ic(iconName) : null, title),
      sub ? h("p.card-sub", sub) : null),
    actions ? h("div.card-actions", actions) : null);
}

function empty({ iconName, title, text, action, small }) {
  return h("div.empty", { class: small && "empty-sm" },
    h("div.empty-art", ic(iconName)),
    h("div.empty-title", title),
    text ? h("p.empty-text", text) : null,
    action || null);
}

function logList(lines) {
  return h("ol.log", lines.map((l) => h("li.log-line", { "data-tone": l.tone },
    h("time", fmtAgo(l.t)), h("span.log-msg", l.m))));
}

function avatar(name, { dot, size, tone } = {}) {
  return h("span.avatar", { class: size && `avatar-${size}`, "data-tone": tone, "aria-hidden": "true" },
    name.charAt(0),
    dot ? h("span.dot", { class: `dot-${dot}` }) : null);
}

/* A working quantity picker: -, a box, +, presets and "No limit". UI-KIT.md 7.11 quotes this function. */
function qtyPicker({ value = 1, max = 9999, unlimited = false, allowUnlimited = true, presets = [1, 10, 100], onChange = null } = {}) {
  const pick = { n: value, unlimited };
  const input = h("input.qty-input", { type: "text", inputmode: "numeric", autocomplete: "off", "aria-label": "How many", placeholder: "No limit" });
  const dec = h("button.qty-btn", { type: "button", "aria-label": "One fewer" }, iconEl("minus"));
  const inc = h("button.qty-btn", { type: "button", "aria-label": "One more" }, iconEl("plus"));
  const chips = presets.map((n) => h("button.chip", { type: "button", "data-q": String(n) }, fmtWhole(n)));
  const maxChip = h("button.chip", { type: "button", "data-q": "max" }, "Max");
  const noLimit = allowUnlimited ? h("button.chip.chip-wide", { type: "button", "data-q": "none" }, "No limit") : null;
  const node = h("div.qty", h("div.qty-stepper", dec, input, inc), h("div.qty-presets", chips, maxChip, noLimit));

  // notify is false for redraws from outside, so a caller's onChange never loops back into refresh().
  const show = (notify = true) => {
    pick.n = Math.max(1, Math.min(max, Math.floor(pick.n) || 1));
    input.value = pick.unlimited ? "" : String(pick.n);
    toggleClass(node, "is-unlimited", pick.unlimited);
    if (noLimit) setAttr(noLimit, "aria-pressed", String(pick.unlimited));
    chips.forEach((c) => setAttr(c, "aria-pressed", String(!pick.unlimited && Number(c.dataset.q) === pick.n)));
    setAttr(maxChip, "aria-pressed", String(!pick.unlimited && pick.n === max));
    dec.disabled = !pick.unlimited && pick.n <= 1;
    inc.disabled = !pick.unlimited && pick.n >= max;
    if (notify && onChange) onChange(pick);
  };

  dec.addEventListener("click", () => { pick.n = (pick.unlimited ? max : pick.n) - 1; pick.unlimited = false; show(); });
  inc.addEventListener("click", () => { if (!pick.unlimited) pick.n += 1; show(); });
  on(node, "click", ".qty-presets .chip", (e, b) => {
    const q = b.dataset.q;
    if (q === "none") pick.unlimited = true;
    else if (q === "max") { pick.unlimited = false; pick.n = max; }
    else { pick.unlimited = false; pick.n = Number(q); }
    show();
  });
  input.addEventListener("input", () => {
    const digits = input.value.replace(/[^0-9]/g, "");
    if (digits !== input.value) input.value = digits;
    if (!digits) return;
    pick.unlimited = false;
    pick.n = Number(digits);
    if (pick.n > max) show(); else if (onChange) onChange(pick);
  });
  input.addEventListener("blur", () => show());
  show(false);
  return {
    node,
    pick,
    // The most possible can change underneath (stock used up); keep the box honest, but never while typing.
    refresh(nextMax) {
      if (nextMax != null) max = Math.max(1, Math.floor(nextMax));
      if (document.activeElement !== input) show(false);
    },
  };
}

/* ================= 3. ART: THE CAMP, THE FOES, THE VISTA ================= */

function campFigure(x, y, skillId) {
  const hand = `${x + 5} ${y - 22}`;
  const tools = {
    delving: `<path class="c-tool" d="M${hand} L${x + 15} ${y - 39}"/><path class="c-tool" d="M${x + 8} ${y - 41} Q${x + 15} ${y - 41} ${x + 21} ${y - 34}"/>`,
    felling: `<path class="c-tool" d="M${hand} L${x + 15} ${y - 39}"/><path class="c-toolhead" d="M${x + 12} ${y - 42} l8 2 -2 8Z"/>`,
  };
  return `<g class="c-fig"><circle cx="${x}" cy="${y - 34}" r="4.5"/>` +
    `<path d="M${x - 6} ${y - 28} H${x + 6} L${x + 8} ${y - 12} H${x + 4} L${x + 3} ${y} H${x + 0.5} L${x} ${y - 9} L${x - 0.5} ${y} H${x - 3} L${x - 4} ${y - 12} H${x - 8}Z"/></g>` +
    (tools[skillId] || "");
}

function campScene(stage) {
  const has = (n) => stage >= n;
  const out = [];
  out.push(
    '<defs>' +
      '<linearGradient id="campSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e1629"/><stop offset="1" stop-color="#0d0a12"/></linearGradient>' +
      '<radialGradient id="campGlow"><stop offset="0" stop-color="#c1613a" stop-opacity=".5"/><stop offset="1" stop-color="#c1613a" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="campFog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d6fd1" stop-opacity="0"/><stop offset="1" stop-color="#8d6fd1" stop-opacity=".08"/></linearGradient>' +
    '</defs>',
    '<rect width="1000" height="220" fill="url(#campSky)"/>',
    '<path class="c-star" d="M120 58h1.5M236 76h1.5M388 52h1.5M548 66h1.5M702 50h1.5M942 82h1.5M60 90h1.5M640 88h1.5"/>',
    '<circle class="c-moon-glow" cx="860" cy="74" r="22"/><circle class="c-moon" cx="860" cy="74" r="9"/>',
    '<path class="c-hill-far" d="M0 142 C110 112 210 128 320 118 C430 108 520 134 640 122 C760 110 880 126 1000 112 V220 H0Z"/>',
    '<path class="c-tree" d="M168 122 V100 M168 108 L158 98 M168 104 L177 94 M724 116 V92 M724 102 L713 91 M724 98 L734 88 M724 108 L733 101 M930 112 V94 M930 102 L921 94"/>',
    '<path class="c-hill-near" d="M0 170 C140 156 260 168 400 160 C540 152 660 166 800 158 C880 154 950 158 1000 156 V220 H0Z"/>',
    '<rect class="c-ground" y="186" width="1000" height="34"/>',
    '<path class="c-dark" d="M612 186 L630 172 L642 177 L656 166 L674 180 L684 186Z"/><path class="c-rim" d="M630 172 L642 177 L656 166"/>'
  );
  if (has(2)) out.push('<path class="c-sil" d="M455 186 L500 124 L545 186Z"/><path class="c-rim" d="M500 124 L545 186"/><path class="c-door" d="M491 186 L500 150 L509 186Z"/><path class="c-wood thin" d="M500 124 V112"/>');
  out.push('<path class="c-sil" d="M270 186 L322 128 L350 186Z"/><path class="c-wood thin" d="M262 186 L326 122"/><path class="c-rim" d="M322 128 L350 186"/>');
  if (has(3)) {
    out.push('<rect class="c-sil" x="352" y="168" width="20" height="18"/><rect class="c-sil" x="370" y="174" width="14" height="12"/>' +
      '<path class="c-rim" d="M352 168 L372 186 M372 168 L352 186"/><rect class="c-sil" x="560" y="170" width="14" height="16" rx="3"/><path class="c-rim" d="M560 175 H574 M560 181 H574"/>');
  }
  out.push('<ellipse cx="413" cy="182" rx="84" ry="30" fill="url(#campGlow)"/><path class="c-wood" d="M398 188 L428 180 M400 180 L428 188"/>' +
    '<g class="camp-fire"><path class="c-ember" d="M413 184 C402 174 414 166 410 152 C424 162 426 174 413 184Z"/><path class="c-flame" d="M413 184 C407 178 413 173 412 165 C419 171 420 178 413 184Z"/></g>');
  out.push(campFigure(700, 186, "delving"));
  out.push('<rect y="140" width="1000" height="80" fill="url(#campFog)"/>');
  return `<svg viewBox="0 34 1000 186" preserveAspectRatio="xMidYMax slice" role="img" aria-label="The Delving camp">${out.join("")}</svg>`;
}

const MONSTER_ART = {
  beast:
    '<path class="m-body" d="M26 78 C30 58 48 46 70 46 C90 46 104 58 108 76 C110 86 106 96 100 100 V108 H92 L90 96 C78 100 58 100 48 96 L44 108 H36 V94 C30 92 26 86 26 78Z"/>' +
    '<path class="m-body" d="M48 50 L50 36 L57 48 M62 46 L66 32 L71 46 M76 46 L82 34 L85 48 M90 52 L99 42 L99 57"/>' +
    '<path class="m-body" d="M32 70 C22 63 12 66 8 74 C6 80 10 84 16 86 L30 90 C35 84 35 76 32 70Z"/>' +
    '<path class="m-body" d="M24 66 L19 51 L32 64Z"/><path class="m-edge" d="M106 80 C116 76 118 64 112 56"/><path class="m-bone" d="M10 81 L12 86 L14 81 M16 83 L18 88 L20 83"/><circle class="m-eye" cx="17" cy="74" r="2.4"/>',
  man:
    '<path class="m-body" d="M60 18 C44 18 36 32 36 46 C36 54 38 58 42 62 C30 72 24 88 22 110 H98 C96 88 90 72 78 62 C82 58 84 54 84 46 C84 32 76 18 60 18Z"/>' +
    '<path class="m-void" d="M48 44 C48 36 53 31 60 31 C67 31 72 36 72 44 C72 53 66 59 60 59 C54 59 48 53 48 44Z"/>' +
    '<circle class="m-eye" cx="55" cy="45" r="1.9"/><circle class="m-eye" cx="65" cy="45" r="1.9"/><path class="m-edge" d="M40 82 Q60 88 80 82"/>' +
    '<path class="m-steel" d="M30 92 L8 58 L12 55 L34 88Z"/><path class="m-edge" d="M26 90 L38 82"/>',
  horror:
    '<path class="m-body" d="M60 14 C90 14 106 38 104 62 C102 80 92 90 96 108 C84 104 80 96 72 100 C68 112 54 112 50 100 C42 96 38 104 26 108 C30 90 18 80 16 62 C14 38 30 14 60 14Z"/>' +
    '<ellipse class="m-void" cx="58" cy="54" rx="20" ry="14"/><circle class="m-eye" cx="54" cy="54" r="7"/><ellipse class="m-void" cx="54" cy="54" rx="2" ry="5"/>' +
    '<circle class="m-eye" cx="36" cy="34" r="2"/><circle class="m-eye" cx="82" cy="31" r="2"/><circle class="m-eye" cx="88" cy="70" r="1.6"/>' +
    '<path class="m-edge" d="M38 80 Q58 92 78 80"/><path class="m-bone" d="M46 84 V89 M54 86 V92 M62 86 V92 M70 84 V89"/>',
};

const monsterArt = (kind, rank) => html(`<svg class="m-art ${rank || ""}" viewBox="0 0 120 120" aria-hidden="true">${MONSTER_ART[kind] || MONSTER_ART.horror}</svg>`);

const VISTA = '<svg viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true">' +
  '<path class="v-far" d="M0 58 C80 38 160 54 240 44 C320 34 400 58 480 40 C540 30 580 38 600 36 V100 H0Z"/>' +
  '<path class="v-mid" d="M0 74 C100 60 180 72 280 63 C380 54 460 74 600 58 V100 H0Z"/>' +
  '<path class="v-near" d="M0 88 C120 79 240 90 360 83 C460 78 540 86 600 81 V100 H0Z"/></svg>';

/* ================= 4. TOOLTIP CONTENT ================= */

const masteryTip = () => tipBody({
  title: "Delving Mastery",
  list: [
    "Every ten levels adds to the chance an action yields double.",
    "Mastery belongs to the trade, not the tool: it stays when you swap picks.",
  ],
  track: [
    { at: "Lv 10", label: "Seam sense", value: "+1%", done: true },
    { at: "Lv 20", label: "Steady hands", value: "+2%", done: true },
    { at: "Lv 30", label: "Deep veins", value: "+3%", next: true },
    { at: "Lv 40", label: "Lamplight eyes", value: "+4%" },
    { at: "Lv 50", label: "The long dark", value: "+5%" },
  ],
  foot: "Now +2% double yield. Deep veins at Lv 30.",
  footTone: "good",
});

const nodeTip = (name) => () => tipBody({
  title: name,
  sub: "Delving · Tier 2 · Gallowmoor",
  rows: [["Time", "16.0s each"], ["Experience", "3 XP each"], ["Yield", `1 × ${name}`], ["Double yield", "2%", "good"], ["Held", "147"]],
});

const craftTip = (name, lines) => () => tipBody({
  title: name,
  sub: "Rarity is rolled when it is made",
  table: {
    head: ["Rarity", ...lines],
    rows: [
      { rarity: "common", cells: ["Common", "+11", "2.0%", "620"] },
      { rarity: "uncommon", cells: ["Uncommon", "+12", "2.2%", "620"] },
      { rarity: "rare", cells: ["Rare", "+13", "2.4%", "620"] },
      { rarity: "epic", cells: ["Epic", "+14", "2.6%", "620"] },
      { rarity: "legendary", cells: ["Legendary", "+17", "3.0%", "620"] },
      { rarity: "relic", cells: ["Relic", "+17", "3.0%", "620"] },
    ],
  },
  foot: "Relics also carry a prefix, like Sundering or Echoing.",
});

/* ================= 5. THE SHELL: TOPBAR, SIDEBAR, WEATHER ================= */

let shellDoc = null;

async function loadShell() {
  if (shellDoc) return shellDoc;
  const res = await fetch("index.html");
  shellDoc = new DOMParser().parseFromString(await res.text(), "text/html");
  return shellDoc;
}

function fillAct(act, s, kind) {
  if (!act || !s) return;
  act.dataset.state = s.state;
  const link = qs(".act-link", act);
  if (link && s.href) link.setAttribute("href", s.href);
  if (link && kind === "hunt") link.setAttribute("href", "#/skill/warfare");
  const box = qs(".act-ico", act);
  clear(box);
  box.appendChild(ic(s.icon));
  setText(qs(".act-name", act), s.name);
  setText(qs(".act-short", act), s.short || s.name);
  setText(qs(".act-meta", act), s.meta);
  const fill = qs(".act-bar > i", act);
  if (fill) setWidth(fill, s.pct);
  const stop = qs(".act-stop", act);
  if (stop && kind === "hunt") stop.setAttribute("aria-label", s.state === "hiding" ? "Pull back from hiding" : "Pull back from the hunt");
}

function fillTopbar(root, { bench = "working", hunt = "hunting", conn = "online", crumbs = ["Trades", "Delving"] } = {}) {
  fillAct(qs('.act[data-kind="bench"]', root), BENCH[bench] || BENCH.working, "bench");
  fillAct(qs('.act[data-kind="hunt"]', root), HUNT[hunt] || HUNT.hunting, "hunt");

  setText(qs(".tb-gold span:not(.sr-only)", root), fmtWhole(ME.gold));
  const hp = qs(".tb-hp", root);
  if (hp) {
    const low = hunt === "recovering";
    const now = low ? 18 : ME.hp;
    setWidth(qs(".tb-hpbar > i", hp), (now / ME.maxHp) * 100);
    setText(qs(".tb-hptext", hp), `${now}/${ME.maxHp}`);
    setAttr(hp, "aria-valuemax", ME.maxHp);
    setAttr(hp, "aria-valuenow", now);
    setAttr(hp, "data-low", low);
  }

  const c = qs(".conn", root);
  if (c) {
    c.dataset.state = conn;
    setText(qs(".conn-dot + span", c), CONN[conn] || conn);
  }

  const crumbBox = qs(".tb-crumbs", root);
  if (crumbBox) {
    clear(crumbBox);
    crumbs.forEach((part, i) => {
      if (i) crumbBox.appendChild(ic("chevron-right"));
      crumbBox.appendChild(i === crumbs.length - 1 ? h("span", { "aria-current": "page" }, part) : h("span", part));
    });
  }
}

const NAV = [
  { id: "Vanguard", items: [
    { label: "Character", icon: "person", route: "#/character" },
    { label: "Armaments", icon: "plate", route: "#/armaments", meta: "7/10" },
    { label: "Companions", icon: "paw", route: "#/companions" },
  ] },
  { id: "Camp", items: [
    { label: "Stockpile", icon: "stockpile", route: "#/stockpile", meta: "24/30" },
    { label: "Bounties", icon: "scroll", route: "#/bounties", badge: "1", badgeTone: "gold", badgeLabel: "A bounty is ready to claim" },
    { label: "Requisitions", icon: "crate", route: "#/requisitions", meta: "2/3" },
    { label: "Shop", icon: "shop", route: "#/shop" },
    { label: "Sky", icon: "sky", route: "#/sky" },
  ] },
  { id: "Trades", items: SKILLS.filter((s) => s.kind === "gather").map((s) => ({ label: s.name, icon: s.icon, route: `#/skill/${s.id}`, meta: `Lv ${s.lv}`, dot: s.working ? "violet" : null })) },
  { id: "Artisans", items: SKILLS.filter((s) => s.kind === "craft").map((s) => ({ label: s.name, icon: s.icon, route: `#/skill/${s.id}`, meta: `Lv ${s.lv}` })) },
  { id: "Field", items: [{ label: "Hunt", icon: "swords", route: "#/skill/warfare", meta: "Lv 31", dot: "ember" }] },
  { id: "Realm", items: [
    { label: "Atlas", icon: "atlas", route: "#/atlas" },
    { label: "Market", icon: "market", route: "#/market" },
    { label: "Party", icon: "party", route: "#/party", badge: "2", badgeLabel: "2 unread" },
    { label: "Hiscores", icon: "trophy", route: "#/hiscores" },
  ] },
];

function navItem(item, current) {
  const active = item.route === current;
  return h("li", h("a.nav-item", { href: item.route, class: active && "is-active", "aria-current": active ? "page" : null },
    ic(item.icon, "nav-ico"),
    h("span.nav-label", item.label),
    item.dot ? h("span.nav-dot", { "data-tone": item.dot === "ember" ? "ember" : null, role: "img", "aria-label": item.dot === "ember" ? "Hunting" : "Working" }) : null,
    item.meta ? h("span.nav-meta", item.meta) : null,
    item.badge ? h("span.badge", { class: item.badgeTone && `badge-${item.badgeTone}`, "aria-label": item.badgeLabel }, item.badge) : null));
}

function fillNav(root, current) {
  NAV.forEach((g) => {
    const list = qs(`#nav${g.id}List`, root) || qs(`[data-nav-list="${g.id}"]`, root);
    if (!list) return;
    list.replaceChildren(...g.items.map((it) => navItem(it, current)));
  });
}

function weatherCard() {
  return [
    h("div.weather-top", ic("moon"), h("span.weather-name", "Faint Gloom")),
    h("div.weather-mods", h("span.up", `${signedPct(9)} Flaying`), h("span.down", `${signedPct(-9)} Harvesting`)),
    h("div.weather-next", "Tomorrow: Extreme Aridity"),
  ];
}

/* ================= 6. PAGES ================= */

const PAGES = {};

PAGES.character = () => h("div.page",
  h("section.char-hero",
    h("div.portrait.char-portrait", h("img", { src: "assets/commander-default.webp", alt: "" })),
    h("div",
      h("div.eyebrow.page-eyebrow", "In Gallowmoor"),
      h("h1.char-name", ME.name),
      h("div.chip-row.char-tags", tag("Warrior", "violet"), chip("Tunnel Rat", null, "paw"), chip("Bounty 12 of 17", "gold", "scroll"))),
    h("div.char-total", h("span.char-total-v", fmtWhole(ME.total)), h("span.eyebrow", "Total level"))),

  h("div.grid-cards.max-2",
    h("article.card.act-card", { "data-tone": "violet" },
      h("div.act-card-top",
        art("pick"),
        h("div.grow", h("div.eyebrow", "The crews · Delving"), h("h2.card-title", "Bog Ore")),
        h("button.btn.btn-sm.btn-quiet", { type: "button" }, "Stop")),
      bar(36),
      h("div.act-card-meta", h("span", "42 of 200 actions"), h("b", "1h 12m left"))),
    h("article.card.act-card", { "data-tone": "ember" },
      h("div.act-card-top",
        art("zoneInner", { tone: "ember" }),
        h("div.grow", h("div.eyebrow", "The hunt · Gallowmoor"), h("h2.card-title", "The Inner")),
        h("button.btn.btn-sm.btn-quiet", { type: "button" }, "Pull back")),
      bar(48, "bar-ember"),
      h("div.act-card-meta", h("span", "38 kills · 4,210 XP/hr"), h("b", "10h 48m left")))),

  h("section.card",
    cardHead("Standing", { actions: h("a.btn.btn-sm.btn-quiet", { href: "#/armaments" }, "Armaments", ic("arrow-right")) }),
    h("div.standing",
      [["112", "Health"], ["14.2", "Attack"], ["9.8", "Defence"], ["1,482", "Kills"], ["3", "Deaths"], ["18,440g", "Gold earned", "gold"]]
        .map(([v, l, tone]) => h("div.standing-cell", h("div.v", { class: tone && `t-${tone}` }, v), h("div.eyebrow.l", l))))),

  h("section.section",
    sectionHead("Skills", "Eleven ways to spend a life. Pick one to open it."),
    h("div.grid-cards.skills-grid", SKILLS.map((s) => {
      const pct = ((s.xp - s.base) / (s.next - s.base)) * 100;
      return h("a.skill-card", { href: `#/skill/${s.id}`, class: (s.working || s.hunting) && "is-working", "data-tone": s.kind === "war" ? "ember" : null },
        art(s.icon, { tone: s.kind === "war" ? "ember" : "violet", size: "sm" }),
        h("div.skill-main",
          h("div.skill-name", s.name, s.working ? h("span.dot.dot-working", { role: "img", "aria-label": "Working" }) : null,
            s.hunting ? h("span.dot.dot-hunting", { role: "img", "aria-label": "Hunting" }) : null),
          h("div.skill-xp", `${fmt(s.xp)} / ${fmt(s.next)} XP`)),
        h("div.skill-lv", h("small", "Lv"), s.lv),
        bar(pct, s.kind === "war" ? "bar-ember" : null));
    }))));

PAGES.gather = () => {
  const s = skill("delving");
  return h("div.page",
    h("section.hero",
      art("pick", { size: "xl" }),
      h("div.hero-main",
        h("div.eyebrow.hero-eyebrow", "Trades · Gallowmoor"),
        h("h1.hero-title", "Delving")),
      h("div.hero-level", h("div.hero-lv", h("small", "Lv"), s.lv), h("div.hero-lv-sub", `${fmtWhole(s.xp)} / ${fmtWhole(s.next)} XP`)),
      h("div.chip-row.hero-tags",
        (() => {
          const b = h("button.tip-chip", { type: "button" }, ic("info"), "Mastery · +2% double yield");
          tooltip(b, masteryTip, { placement: "bottom" });
          return b;
        })(),
        chip(`${signedPct(16)} XP · Extreme Aridity`, "good"),
        chip(`${signedPct(8)} XP · Tunnel Rat`, "good")),
      h("div.hero-xp",
        bar(((s.xp - s.base) / (s.next - s.base)) * 100),
        h("div.hero-xp-meta", h("span", "Ore and coal, hauled up by lamplight."), h("span", h("b", fmtWhole(s.next - s.xp)), " to Lv 25")))),

    h("section.section",
      sectionHead("The seams of Gallowmoor", "Pick one to set the crews to it.", chip("Bog Pick · +12% speed", null, "pick")),
      h("div.pills",
        itemPill({
          name: "Bog Ore", iconName: "ore", state: "working", pct: 36, tip: nodeTip("Bog Ore"),
          sub: [h("span", "Working"), h("span", h("b", "42"), " of 200"), h("span", "1h 12m left")],
          stats: [chip("16s", null, "clock"), chip("3 XP", "violet"), chip("147 held")],
        }),
        itemPill({
          name: "Coal", iconName: "coalIco", tip: nodeTip("Coal"),
          sub: "The reagent every bar asks for",
          stats: [chip("16s", null, "clock"), chip("3 XP", "violet"), chip("30 held")],
        }),
        itemPill({
          name: "Cairn Steel", iconName: "ore", state: "locked",
          sub: [ic("lock"), "Needs Delving Lv 30"],
          stats: [chip("32s", null, "clock"), chip("10 XP", "violet")],
        }))),

    h("section.card.card-flush",
      cardHead("The camp", { sub: "It grows each time Delving reaches a new tier.", actions: chip("Tier 3 of 9") }),
      h("div.camp-scene", { html: campScene(3) }),
      h("div.camp-foot", h("b", "Crates and barrels"), h("span", "Next at Lv 30: a proper work site"))));
};

PAGES.bench = () => {
  const s = skill("forgemaster");
  const tier = (label, { active, next } = {}) => h("button.tier", { type: "button", class: { "is-active": active, "is-next": next }, "aria-pressed": active ? "true" : "false" },
    next ? ic("lock") : null, label);
  return h("div.page",
    h("section.hero",
      art("plate", { size: "xl" }),
      h("div.hero-main", h("div.eyebrow.hero-eyebrow", "Artisans · At camp"), h("h1.hero-title", "Forgemaster")),
      h("div.hero-level", h("div.hero-lv", h("small", "Lv"), s.lv), h("div.hero-lv-sub", `${fmtWhole(s.xp)} / ${fmtWhole(s.next)} XP`)),
      h("div.chip-row.hero-tags", chip(`${signedPct(8)} XP · Tunnel Rat`, "good"), chip("Heavy plate and weapons", null, "plate")),
      h("div.hero-xp",
        bar(((s.xp - s.base) / (s.next - s.base)) * 100),
        h("div.hero-xp-meta", h("span", "Slow, unglamorous, and holds a line."), h("span", h("b", fmtWhole(s.next - s.xp)), " to Lv 22")))),

    h("section.section",
      h("div.bench-bar",
        h("div.seg", { role: "tablist", "aria-label": "Bench" },
          h("button.seg-btn", { type: "button", role: "tab", "aria-selected": "false" }, "Components", h("span.count", "4")),
          h("button.seg-btn", { type: "button", role: "tab", "aria-selected": "true" }, "Wares", h("span.count", "7"))),
        h("div.tier-row", { role: "group", "aria-label": "Tier" },
          tier("Lv 1"), tier("Lv 10", { active: true }), tier("Lv 20"), tier("Lv 30", { next: true }))),

      h("div.bench-group",
        h("div.bench-label", h("span.eyebrow", "Weapons"), h("span.count", "2")),
        h("div.pills",
          itemPill({
            name: "Bog Sword", iconName: "blade", state: "working", pct: 58, tip: craftTip("Bog Sword", ["Attack", "Crit", "Durab."]),
            sub: [h("span", "Forging"), h("span", h("b", "3"), " of 5"), h("span", "2m 40s left")],
            stats: [need("blade", "Bog Blade", 4, 1), need("log", "Blood Ash Handle", 2, 1), chip("48s", null, "clock")],
          }),
          itemPill({
            name: "Bog Greatsword", iconName: "greatblade", state: "short", tip: craftTip("Bog Greatsword", ["Attack", "Crit", "Durab."]),
            sub: "Missing Bog Great Blade",
            stats: [need("greatblade", "Bog Great Blade", 0, 1), need("log", "Blood Ash Great Grip", 1, 1), need("hide", "Bristle Binding", 3, 1)],
          }))),

      h("div.bench-group",
        h("div.bench-label", h("span.eyebrow", "Armour"), h("span.count", "2")),
        h("div.pills",
          itemPill({
            name: "Bog Helm", iconName: "cowl", tip: craftTip("Bog Helm", ["Defence", "Health", "Durab."]),
            sub: "Rarity is rolled when it is made",
            stats: [need("ore", "Bog Bar", 26, 20), need("coalIco", "Coal", 30, 2), chip("40s", null, "clock")],
          }),
          itemPill({
            name: "Bog Chestplate", iconName: "plate", tip: craftTip("Bog Chestplate", ["Defence", "Health", "Durab."]),
            sub: "Rarity is rolled when it is made",
            stats: [need("ore", "Bog Bar", 26, 20), need("coalIco", "Coal", 30, 2), chip("40s", null, "clock")],
          })))));
};

const STOCK = [
  { name: "Bog Ore", icon: "ore", qty: 147 },
  { name: "Coal", icon: "coalIco", qty: 30 },
  { name: "Bog Bar", icon: "ore", qty: 12, selected: true },
  { name: "Blood Ash", icon: "log", qty: 88 },
  { name: "Resin", icon: "resinIco", qty: 41 },
  { name: "Blood Ash Plank", icon: "log", qty: 16 },
  { name: "Grave Moss", icon: "fibre", qty: 64 },
  { name: "Pressed Pulp", icon: "pulpIco", qty: 22 },
  { name: "Bristle Pelt", icon: "hide", qty: 19 },
  { name: "Tallow", icon: "tallowIco", qty: 9 },
  { name: "River Amber", icon: "gem", qty: 35 },
  { name: "Veil Shard", icon: "shardIco", qty: 6 },
  { name: "Slag Ore", icon: "ore", qty: 1204 },
  { name: "Mud Pebble", icon: "gem", qty: 12500 },
  { name: "Bog Blade", icon: "blade", qty: 2 },
  { name: "Blood Ash Handle", icon: "log", qty: 1 },
  { name: "Banded Chest", icon: "crate", qty: 1 },
  { name: "Bog Pick", icon: "pick", wear: 72 },
  { name: "Blood Ash Axe", icon: "axe", wear: 31 },
  { name: "Sundering Bog Sword", icon: "blade", rarity: "rare", wear: 100 },
  { name: "Bog Helm", icon: "cowl", rarity: "uncommon", wear: 64 },
  { name: "Bog Chestplate", icon: "plate", rarity: "epic", wear: 18 },
  { name: "Amber Amulet", icon: "charm", rarity: "legendary", wear: 90 },
  { name: "Relic Bog Ring", icon: "band", rarity: "relic", wear: 55 },
];

function storageCard({ tabs, items, cap, total, filters = true }) {
  const grid = h("div.slot-grid", items.map(slot), Array.from({ length: Math.max(0, total - items.length) }, () => slot(null)));
  on(grid, "click", ".slot:not(.is-empty)", () => PAGES_MODALS.item());
  return h("section.card.storage-main",
    h("div.toolbar",
      h("div.seg", { role: "tablist", "aria-label": "Pool" }, tabs.map(([label, count, active]) =>
        h("button.seg-btn", { type: "button", role: "tab", "aria-selected": active ? "true" : "false" }, label, h("span.count", count)))),
      filters ? h("div.filters", { role: "group", "aria-label": "Show" },
        h("button.chip", { type: "button", "aria-pressed": "true" }, "All"),
        h("button.chip", { type: "button", "aria-pressed": "false", "aria-label": "Gear", "data-tip": "Gear" }, ic("blade")),
        h("button.chip", { type: "button", "aria-pressed": "false", "aria-label": "Materials", "data-tip": "Materials" }, ic("ore")),
        h("button.chip", { type: "button", "aria-pressed": "false", "aria-label": "Remedies", "data-tip": "Remedies" }, ic("ration")),
        h("button.chip", { type: "button", "aria-pressed": "false", "aria-label": "Tools", "data-tip": "Tools" }, ic("pick"))) : null,
      h("div.toolbar-end",
        h("label.sr-only", { for: "sortSel" }, "Sort"),
        h("select.select.select-sm#sortSel", h("option", "Custom order"), h("option", "Rarity"), h("option", "Name"), h("option", "Most held")))),
    h("div.capacity", { class: items.length >= total && "is-full" }, h("span", "Capacity"), h("b", `${items.length} / ${total}`), bar((items.length / total) * 100, "bar-thin")),
    grid);
}

PAGES.storage = () => h("div.page",
  pageHead({ eyebrow: "The Camp", title: "Stockpile", sub: "Materials, reagents and the odd find. The Vault is shared with Belongings." }),
  h("div.storage",
    storageCard({ tabs: [["Stockpile", "24/30", true], ["Vault", "8/50"]], items: STOCK, total: 30 }),
    h("aside.storage-side",
      h("section.card",
        cardHead("Tools in hand", { sub: "One for each trade. Stow one to swap it." }),
        h("div.list",
          [["Delving", "Bog Pick", "pick", "+12% speed", 72], ["Felling", "Blood Ash Axe", "axe", "+12% speed", 31], ["Harvesting", "Bare hands", "sickle", null, null], ["Flaying", "Slag Knife", "knife", "+6% speed", 88], ["Dredging", "Bare hands", "net", null, null]]
            .map(([skillName, tool, iconName, speed, wear]) => h("div.list-row",
              art(iconName, { size: "sm", tone: tool === "Bare hands" ? "neutral" : "violet" }),
              h("div.lr-main", h("div.lr-title", tool), h("div.lr-sub", skillName)),
              h("div.lr-end", speed ? chip(speed, "good") : h("span.muted.tiny", "No tool"), wear != null ? h("span.tiny.num", { class: wear > 60 ? "t-good" : wear > 25 ? "t-gold" : "t-bad" }, `${wear}%`) : null))))),
      h("section.card",
        cardHead("Camp standing"),
        h("div.stats",
          stat("Total level", "187", "good"), stat("Gold on hand", fmtGold(ME.gold), "gold"), stat("Stockpile", "24 / 30"),
          stat("Vault", "8 / 50"), stat("Actions worked", "14,208"), stat("Sovereigns felled", "2"))))));

const BELONGINGS = [
  { name: "Bitter-Ash Salve", icon: "ration", qty: 12 },
  { name: "Gravemoss Poultice", icon: "ration", qty: 4 },
  { name: "Sundering Bog Sword", icon: "blade", rarity: "rare", wear: 100 },
  { name: "Blood Ash Shield", icon: "ward", rarity: "uncommon", wear: 77 },
  { name: "Mangy Pelt", icon: "hide", qty: 3 },
  { name: "Bog Boots", icon: "treads", wear: 40 },
  { name: "Veil Shard", icon: "shardIco", qty: 2 },
];

function dollSlot(label, it, glyph) {
  if (!it) {
    return h("div.doll-slot.is-empty", { role: "img", "aria-label": `${label}: empty` },
      h("span.doll-slot-top", h("span.doll-slot-l", label)), h("span.doll-slot-art", ic(glyph)), h("span.doll-slot-name", "Empty"));
  }
  const wearCls = it.wear > 60 ? "is-fine" : it.wear > 25 ? "is-worn" : "is-bad";
  return h("button.doll-slot", { type: "button", "data-rarity": it.rarity || "common", "aria-label": `${label}: ${it.name}, ${it.wear}% condition` },
    h("span.doll-slot-top", h("span.doll-slot-l", label), h("span.doll-wear", { class: wearCls }, `${it.wear}%`)),
    h("span.doll-slot-art", ic(it.icon)),
    h("span.doll-slot-name", it.name));
}

PAGES.armaments = () => h("div.page",
  pageHead({ eyebrow: "The Vanguard", title: "Armaments", sub: "What you carry into the hunt and what you wear there. Remedies live here, in Belongings." }),
  h("div.storage",
    storageCard({ tabs: [["Belongings", "7/10", true], ["Vault", "8/50"]], items: BELONGINGS, total: 10 }),
    h("aside.storage-side",
      h("section.card",
        cardHead("Worn", { actions: chip("Warrior", "violet") }),
        h("div.doll",
          h("div.doll-col",
            dollSlot("Head", { name: "Bog Helm", icon: "cowl", rarity: "uncommon", wear: 84 }),
            dollSlot("Chest", { name: "Bog Chestplate", icon: "plate", rarity: "rare", wear: 62 }),
            dollSlot("Hands", { name: "Bristle Gauntlets", icon: "gauntlets", wear: 23 }),
            dollSlot("Feet", null, "treads")),
          h("div.doll-figure",
            h("div.portrait", h("img", { src: "assets/commander-default.webp", alt: "" })),
            h("div.doll-name", ME.name),
            h("div.doll-sub", "Warrior · Gallowmoor")),
          h("div.doll-col",
            dollSlot("Weapon", { name: "Slag Sword", icon: "blade", wear: 91 }),
            dollSlot("Offhand", { name: "Blood Ash Shield", icon: "ward", rarity: "epic", wear: 70 }),
            dollSlot("Neck", { name: "Amber Amulet", icon: "charm", rarity: "legendary", wear: 96 }),
            dollSlot("Ring", null, "band")))),
      h("section.card",
        cardHead("Standing"),
        h("div.stats",
          stat("Discipline", "Warrior", "good"), stat("Health", "112"), stat("Attack", "14.2", "gold"),
          stat("Defence", "9.8", null, h("small", "stops 31% here")), stat("Swing", "2.6s"), stat("Crit chance", "7%"),
          stat("Crit damage", "150%"), stat("Penetration", "10%"), stat("Veil", "+11 a blow"), stat("Hunt", "Lv 31", "good"))))));

function foeCard({ name, kind, hp, max, rank, target, float }) {
  return h("div.foe-card", { class: { "is-target": target, "is-elite": rank === "elite", "is-sovereign": rank === "sovereign" } },
    h("div.fx-layer", float ? h("span.float", { class: [float.kind, "lane0", SHOT && "is-frozen"] }, float.text) : null),
    h("button.foe-art", { type: "button", "aria-label": `${name}: details`, onClick: () => PAGES_MODALS.foe() }, monsterArt(kind, rank)),
    h("div.foe-body",
      h("div.foe-name", h("span", name), rank === "elite" ? tag("Elite", "elite") : null, rank === "sovereign" ? tag("Sovereign", "sovereign") : null),
      h("div.hpbar.hpbar-foe", h("i", { style: { width: `${(hp / max) * 100}%` } }), h("span", `${fmt(hp)} / ${fmt(max)}`))));
}

function zoneCard({ name, iconName, sub, threat, active }) {
  return h("button.zone-card", { type: "button", class: { "is-active": active, "is-peaked": threat >= 100 } },
    art(iconName, { tone: "ember" }),
    h("span.zone-main", h("span.zone-name", name), h("span.zone-sub", sub)),
    active ? tag("Hunting", "ember") : threat >= 100 ? tag("Peaked", "sovereign") : h("span"),
    h("span.meter",
      h("span.meter-top", h("span", "Threat"), h("b", `${threat} / 100`)),
      bar(threat, "bar-ember bar-thin")));
}

PAGES.hunt = () => {
  const s = skill("warfare");
  const floatYou = h("span.float.hurt.lane1", { class: SHOT && "is-frozen" }, "6");
  return h("div.page",
    h("section.hero", { "data-tone": "ember" },
      art("swords", { size: "xl", tone: "ember" }),
      h("div.hero-main", h("div.eyebrow.hero-eyebrow", "The Field · Gallowmoor"), h("h1.hero-title", "Hunt")),
      h("div.hero-level", h("div.hero-lv", h("small", "Lv"), s.lv), h("div.hero-lv-sub", `${fmtWhole(s.xp)} / ${fmtWhole(s.next)} XP`)),
      h("div.chip-row.hero-tags", chip("+20% Hunt XP · 2 of your party here", "violet", "party"), chip(`${signedPct(8)} XP · Veil Hound`, "good")),
      h("div.hero-xp",
        bar(((s.xp - s.base) / (s.next - s.base)) * 100, "bar-ember"),
        h("div.hero-xp-meta", h("span", "You take the vanguard."), h("span", h("b", fmtWhole(s.next - s.xp)), " to Lv 32")))),

    h("section.card.hunt-card",
      cardHead("The Inner of Gallowmoor", { sub: "Two or three at once · ×1.7 XP a kill", actions: chip("Thane hunts here too", "violet", "party") }),
      h("div.arena",
        h("div.arena-you",
          h("div.fx-layer", floatYou),
          h("div.portrait.arena-portrait", h("img", { src: "assets/commander-default.webp", alt: "" })),
          h("div.arena-name", ME.name),
          h("div.hpbar", h("i", { style: { width: `${(ME.hp / ME.maxHp) * 100}%` } }), h("span", `${ME.hp} / ${ME.maxHp}`)),
          h("div.veilbar", h("i", { style: { width: "64%" } })),
          h("div.veil-note", "Bulwark · 64 of 100")),
        h("div.arena-mid",
          h("div.arena-vs", { "aria-hidden": "true" }, "VS"),
          h("div.arena-status", "Fighting"),
          h("div.arena-timer", "Reinforcements in 31s")),
        h("div.arena-foes",
          foeCard({ name: "Fen Stalker", kind: "horror", hp: 22, max: 48, target: true, float: { kind: "crit", text: "14!" } }),
          foeCard({ name: "Bog Crawler", kind: "beast", hp: 30, max: 30, rank: "elite" }),
          foeCard({ name: "Bog Brute", kind: "man", hp: 64, max: 78 }))),
      h("div.hunt-foot",
        h("div.kpis",
          h("div.kpi", h("span.l", "Kills"), h("span.v", "38")),
          h("div.kpi", h("span.l", "XP/hr"), h("span.v", "4,210")),
          h("div.kpi", h("span.l", "Threat"), h("span.v", "64 / 100"), bar(64, "bar-ember bar-thin")),
          h("div.kpi", h("span.l", "Time left"), h("span.v", "10h 48m"))),
        h("div.hunt-actions",
          h("label.switch", h("input", { type: "checkbox", checked: true }), "Hide when Threat peaks"),
          h("div.btn-row",
            h("button.btn.btn-quiet", { type: "button" }, "Pull back"),
            h("button.btn.btn-ember", { type: "button", onClick: () => PAGES_MODALS.huntZone() }, "Change hunt"))))),

    h("section.section",
      sectionHead("Zones", "Deeper zones field more foes, call reinforcements sooner and pay more XP. At 100 Threat the Sovereign may come for you."),
      h("div.grid-cards.max-2",
        zoneCard({ name: "Outer", iconName: "zoneOuter", sub: "1 or 2 at once · ×1 XP", threat: 12 }),
        zoneCard({ name: "Middle", iconName: "zoneMiddle", sub: "1 or 2 at once · ×1.3 XP", threat: 30 }),
        zoneCard({ name: "Inner", iconName: "zoneInner", sub: "2 or 3 at once · ×1.7 XP", threat: 64, active: true }),
        zoneCard({ name: "Core", iconName: "zoneCore", sub: "3 at once · ×2.2 XP", threat: 100 }))),

    h("section.section",
      sectionHead("Quarry", "What lives in Gallowmoor. Pick one to see what it hits for and what it drops."),
      h("div.grid-cards",
        [["Bog Crawler", "beast", "Skirmisher · 30 health · swings every 2.0s"], ["Fen Stalker", "horror", "Stalker · 48 health · swings every 2.4s"], ["Bog Brute", "man", "Brute · 78 health · swings every 3.0s"]]
          .map(([name, kind, sub]) => h("button.foe-tile", { type: "button", onClick: () => PAGES_MODALS.foe() },
            h("span.foe-art", monsterArt(kind)),
            h("span.foe-tile-main", h("span.foe-tile-name", name), h("span.foe-tile-sub", sub)))),
        h("button.foe-tile.is-sovereign", { type: "button" },
          h("span.foe-art", monsterArt("man", "sovereign")),
          h("span.foe-tile-main", h("span.foe-tile-name", "The Drowned Bailiff"), h("span.foe-tile-sub", "Sovereign · comes when Threat peaks · enrages every 30s")),
          tag("Sovereign", "sovereign")))));
};

const REGIONS = [
  { tier: 1, name: "The Ashen Verge", sub: "Gear around Lv 1", state: "open" },
  { tier: 2, name: "Gallowmoor", sub: "Gear around Lv 10", state: "here" },
  { tier: 3, name: "The Cold Warrens", sub: "Gear around Lv 20", toll: 100, selected: true },
  { tier: 4, name: "Graveshelf", sub: "Gear around Lv 30", toll: 200 },
  { tier: 5, name: "The Sallow Fen", sub: "Gear around Lv 40", toll: 350 },
  { tier: 6, name: "Umberdeep", sub: "Gear around Lv 50", toll: 600 },
  { tier: 7, name: "Wyrmreach", sub: "Gear around Lv 60", toll: 1000 },
  { tier: 8, name: "The Fade", sub: "Gear around Lv 70", toll: 1600 },
  { tier: 9, name: "Godsdown", sub: "Gear around Lv 80", toll: 2500 },
];

PAGES.atlas = () => h("div.page",
  pageHead({ eyebrow: "The Realm", title: "Atlas", sub: "Pay the toll once, and the road stays open. Where you stand decides what your crews work and what you fight." }),
  h("div.atlas",
    h("section.card.atlas-regions",
      cardHead("Regions", { actions: chip("2 of 9 open") }),
      h("div.pick-list", { role: "listbox", "aria-label": "Regions" }, REGIONS.map((r) => {
        const locked = !r.state;
        const end = r.state === "here" ? tag("Here", "violet")
          : r.state === "open" ? tag("Open", "good")
          : h("span.region-toll", { class: r.toll > ME.gold && "is-short" }, ic("lock"), fmtGold(r.toll));
        return h("button.pick-row", {
          type: "button",
          role: "option",
          class: { "is-current": r.state === "here", "is-locked": locked, "is-selected": r.selected },
          "aria-selected": r.selected ? "true" : "false",
        },
          h("span.region-tier", r.tier),
          h("span.lr-main", h("span.region-name", r.name), h("span.region-sub", r.sub)),
          end);
      }))),
    h("section.card.card-flush.atlas-detail",
      h("div.atlas-vista", { html: VISTA }, h("div.atlas-vista-tier", tag("Tier 3", "gold"))),
      h("div.atlas-body",
        h("h2.atlas-title", "The Cold Warrens"),
        h("p.atlas-note", "Tunnels under the moor. Cold enough that the bodies down there never went off."),
        h("div.atlas-facts",
          h("div.atlas-fact", h("div.eyebrow", "Gear around"), h("div.v", "Lv 20")),
          h("div.atlas-fact", h("div.eyebrow", "Your Hunt"), h("div.v.t-good", "Lv 31")),
          h("div.atlas-fact", h("div.eyebrow", "Toll"), h("div.v.t-gold", "100g"))),
        h("div.atlas-block",
          h("div.eyebrow", "Lives here"),
          h("div.chip-row", chip("Warren Goblin", null, "man"), chip("Rime Stalker", null, "beast"), chip("Warren Butcher", null, "man"), chip("The Cold Matriarch", "ember", "skull"))),
        h("div.atlas-block",
          h("div.eyebrow", "Yields"),
          h("div.chip-row", chip("Cold Ore", null, "ore"), chip("Iron Bark", null, "log"), chip("Pale Rush", null, "fibre"), chip("Dire Pelt", null, "hide"), chip("Cave Agate", null, "gem"))),
        h("div.atlas-block",
          h("div.eyebrow", "Your standing"),
          h("div.stats", stat("Threat here", "None yet"), stat("Remedies held", "16"), stat("Suits your gear", "Yes", "good")))),
      h("div.atlas-actions",
        h("span.small.muted", "Pay once. The road stays open."),
        h("button.btn.btn-gold", { type: "button", onClick: () => PAGES_MODALS.buy() }, ic("coin"), "Pay 100g and travel")))));

const REMEDIES = [
  { name: "Bitter-Ash Salve", heal: 25, price: 5, held: 12 },
  { name: "Gravemoss Poultice", heal: 70, price: 15, held: 4 },
  { name: "Corpse-Marrow Draught", heal: 180, price: 45, held: 0 },
  { name: "Star-Steel Tonic", heal: 380, price: 140, held: 0, qty: 10 },
];

function qtySmall(value) {
  return h("div.qty-stepper.qty-sm",
    h("button.qty-btn", { type: "button", "aria-label": "One fewer" }, ic("minus")),
    h("input.qty-input", { type: "text", inputmode: "numeric", value: String(value), "aria-label": "How many" }),
    h("button.qty-btn", { type: "button", "aria-label": "One more" }, ic("plus")));
}

PAGES.shop = () => h("div.page",
  pageHead({ eyebrow: "The Camp", title: "Shop", sub: "Remedies from the Bonesetter, and whatever the Smuggler has this visit.",
    actions: h("span.clock", { "data-tip": "World clock. Bounties and the Smuggler run on this." }, ic("clock"), "22:03:52 UTC") }),
  h("section.card",
    cardHead("The Bonesetter", { iconName: "bonesetter", sub: "Always open. On the hunt a remedy is taken whenever your health falls to 45% or less, the strongest first." }),
    h("div.list", REMEDIES.map((r) => {
      const qty = r.qty || 1;
      return h("div.list-row.shop-row.stack-sm",
        art("ration", { tone: "good" }),
        h("div.lr-main", h("div.lr-title", r.name), h("div.lr-sub", `Restores ${r.heal} HP · ${r.held ? `${r.held} in Belongings` : "None held"}`)),
        h("div.lr-end",
          h("span.price", { class: r.price * qty > ME.gold && "is-short" }, fmtGold(r.price), h("small", "each")),
          qtySmall(qty),
          h("button.btn.btn-gold.btn-soft.btn-sm", { type: "button", onClick: () => PAGES_MODALS.buy(r, qty) }, "Buy")));
    }))),
  h("section.card",
    cardHead("The Smuggler", { iconName: "hourglass", sub: "Turns up twice a day on the world clock with whatever fell off the back of something. One deal a visit.",
      actions: chip("Moves on in 1h 56m", "gold", "clock") }),
    h("div.list",
      [["13× Wyrm Plank", "log", "Tier 7 · 8,112g the lot", 8112], ["14× Cold Bar", "ore", "Tier 3 · 504g the lot", 504], ["6× Barrow Shaft", "stave", "Tier 4 · 1,238g the lot", 1238, true]]
        .map(([name, iconName, sub, price, dealt]) => h("div.list-row.shop-row.stack-sm", { class: dealt && "is-dealt" },
          art(iconName, { tone: "gold" }),
          h("div.lr-main", h("div.lr-title", name), h("div.lr-sub", sub)),
          h("div.lr-end",
            dealt ? tag("Dealt", "good") : h("span.price", { class: price > ME.gold && "is-short" }, fmtGold(price)),
            dealt ? null : h("button.btn.btn-gold.btn-soft.btn-sm", { type: "button", onClick: () => PAGES_MODALS.short() }, "Buy")))))));

PAGES.bounties = () => h("div.page",
  pageHead({ eyebrow: "The Camp", title: "Bounties", sub: "Posted on the world clock every twelve hours, against the ground you are standing on.",
    actions: [h("span.clock", ic("clock"), "22:03:52 UTC"), chip("New posting in 1h 56m", null, "hourglass")] }),
  h("section.card.bounty", { "data-tone": "gold" },
    art("scroll", { tone: "gold", size: "lg" }),
    h("div",
      h("div.eyebrow", "Posted for Gallowmoor"),
      h("h2.bounty-title", "Put down 17 of whatever holds Gallowmoor")),
    h("div.bounty-progress",
      h("div.meter-top", h("span", "Progress"), h("b", "12 of 17")),
      bar((12 / 17) * 100, "bar-gold bar-lg"),
      h("div.chip-row", chip("Pays 27g", "gold", "coin"), chip("An hour of double XP", "violet", "sparkle"))),
    h("div.bounty-foot",
      h("span.small.muted", "Kills anywhere in Gallowmoor count."),
      h("button.btn.btn-gold", { type: "button", disabled: true }, "5 more to go"))),
  h("section.card",
    cardHead("Earlier postings"),
    h("div.list",
      h("div.list-row", art("check", { tone: "good", size: "sm" }), h("div.lr-main", h("div.lr-title", "Bring up 40 Bog Ore"), h("div.lr-sub", "Gallowmoor · 12h ago")), h("div.lr-end", tag("Paid out", "good"))),
      h("div.list-row", art("close", { tone: "neutral", size: "sm" }), h("div.lr-main", h("div.lr-title", "Put down 12 of whatever holds The Ashen Verge"), h("div.lr-sub", "The Ashen Verge · 1d ago")), h("div.lr-end", tag("Expired"))))));

function agentCard({ name, rarity, out, yieldText }) {
  return h("article.card.agent-card", { class: out && "is-out" },
    h("div.agent-top",
      avatar(name, { tone: out ? null : "gold" }),
      h("div.grow", h("div.agent-name", name), h("div.chip-row.mt-1", h("span.tag", { "data-rarity": rarity.toLowerCase() }, rarity), out ? tag("Out", "violet") : null))),
    h("p.agent-yield", yieldText),
    out
      ? h("div.agent-deploy", h("span.small.muted", "Back at the daily reset"))
      : h("div.agent-deploy",
        h("select.select.select-sm", { "aria-label": `Send ${name} for` }, h("option", "Bog Ore"), h("option", "Blood Ash"), h("option", "Grave Moss"), h("option", "Bristle Pelt")),
        h("button.btn.btn-primary.btn-soft.btn-sm", { type: "button" }, "Deploy")));
}

PAGES.requisitions = () => h("div.page",
  pageHead({ eyebrow: "The Camp", title: "Requisitions", sub: "Send Agents out for supplies. They return at the daily reset, and better Agents come back heavier.",
    actions: h("div.hstack.gap-3", h("span.req-slots", { role: "img", "aria-label": "1 of 3 deployments used" }, h("i.req-pip.is-used"), h("i.req-pip"), h("i.req-pip")), h("span.small.dim", "2 of 3 left today")) }),
  h("section.card",
    cardHead("Out on a run"),
    h("div.list",
      h("div.list-row",
        avatar("Ashlin Crowe", { size: "sm" }),
        h("div.lr-main", h("div.lr-title", "Ashlin Crowe"), h("div.lr-sub", "14 × Bog Ore, back at the daily reset")),
        h("div.lr-end", chip("Back in 6h 12m", null, "clock"))))),
  h("section.section",
    sectionHead("The roster", "Hiring is a gamble: every hire rolls its own rarity.", h("button.btn.btn-gold", { type: "button", onClick: () => PAGES_MODALS.buy({ name: "An Agent", price: 250 }, 1) }, "Hire an Agent · 250g")),
    h("div.grid-cards",
      agentCard({ name: "Ashlin Crowe", rarity: "Rare", out: true, yieldText: "Returns about 30 of whatever you ask for." }),
      agentCard({ name: "Tobin Marsh", rarity: "Common", yieldText: "Returns about 12 of whatever you ask for." }),
      agentCard({ name: "Edda Fell", rarity: "Epic", yieldText: "Returns about 48 of whatever you ask for." }))));

function compCard({ name, iconName, price, owned, active, rank, bond, trait, traitVal, blurb, unlocks, bondPct }) {
  return h("article.card.comp-card", { class: active && "is-active" },
    h("div.comp-top",
      art(iconName, { size: "lg", tone: owned ? "violet" : "neutral" }),
      h("div.grow", h("div.comp-name", name), h("div.comp-sub", owned ? `Rank ${rank} · Bond ${bond}` : fmtGold(price))),
      active ? tag("At your side", "violet") : null),
    h("p.comp-blurb", blurb),
    h("div.well.comp-trait", h("span.t-name", trait), h("span.t-val", traitVal)),
    owned ? h("div.meter", h("div.meter-top", h("span", `Bond ${bond}`), h("b", `${bondPct}%`)), bar(bondPct)) : null,
    h("ul.comp-unlocks", unlocks.map(([req, text, open]) => h("li", { class: open && "is-open" },
      h("span.g", open ? ic("check") : null), h("span.req", req), h("span", text)))),
    h("div.comp-actions",
      active ? h("button.btn.btn-quiet", { type: "button" }, "Leave at camp")
        : owned ? h("button.btn.btn-primary.btn-soft", { type: "button" }, "Take along")
        : h("button.btn.btn-gold.btn-soft", { type: "button", onClick: () => PAGES_MODALS.buy({ name, price }, 1) }, ic("coin"), `Buy · ${fmtGold(price)}`)));
}

PAGES.companions = () => h("div.page",
  pageHead({ eyebrow: "The Vanguard", title: "Companions", sub: "One walks with you at a time. Its Bond grows for every minute at your side while you work or hunt.",
    actions: chip("Tunnel Rat walks with you", "violet", "paw") }),
  h("div.grid-cards",
    compCard({ name: "Tunnel Rat", iconName: "rat", owned: true, active: true, rank: "II", bond: 7, bondPct: 46, trait: "Seam Sense", traitVal: "+10% Delving XP",
      blurb: "Thin, clever and always the first to smell a fresh seam.",
      unlocks: [["Bond 5", "+2% Delving double yield", true], ["Bond 10", "+25% Coal found alongside ore"], ["Bond 20", "Delving actions 5% quicker"], ["Rank III", "+3% Delving double yield"]] }),
    compCard({ name: "Carrion Crow", iconName: "crow", owned: true, rank: "I", bond: 3, bondPct: 72, trait: "Far Sight", traitVal: "+4% gathering XP",
      blurb: "It watches every crew from the ridgeline and screams when something moves.",
      unlocks: [["Bond 5", "+1% double yield on all gathering"], ["Bond 10", "+15% reagents found while gathering"], ["Bond 20", "Gathering actions 3% quicker"], ["Rank III", "+2% double yield on all gathering"]] }),
    compCard({ name: "Marshcat", iconName: "marshcat", price: 300, trait: "Reedstalker", traitVal: "+8% Harvesting XP",
      blurb: "Wet-furred and silent. It walks the rushes ahead of the sickles.",
      unlocks: [["Bond 5", "+2% Harvesting double yield"], ["Bond 10", "+25% Pressed Pulp found alongside fibre"], ["Bond 20", "Harvesting actions 5% quicker"], ["Rank III", "+3% Harvesting double yield"]] }),
    compCard({ name: "Veil Hound", iconName: "hound", price: 400, trait: "Bloodhound", traitVal: "+8% Hunt XP",
      blurb: "Lean, grey and patient. It can follow a blood trail through a week of rain.",
      unlocks: [["Bond 5", "+10% gold from kills"], ["Bond 10", "Kills drop materials 10% more often"], ["Bond 20", "+1% rare find chance on kills"], ["Rank III", "+1% rare find chance on kills"]] }),
    compCard({ name: "Veil Stag", iconName: "stag", price: 1000, trait: "Pathfinder", traitVal: "+3% XP to every skill",
      blurb: "It appears at the treeline at dusk and the crews work quieter for it.",
      unlocks: [["Bond 5", "+1% double yield on all gathering"], ["Bond 10", "Trade actions 2% quicker"], ["Bond 20", "+1% rare find chance on kills"], ["Rank III", "+5% gold from kills"]] })));

const WEEK = [
  { when: "Sun", date: "13 Sep", name: "Extreme Miasma", icon: "fog", up: "+17% Dredging", down: "−17% Felling", bountiful: true, past: true },
  { when: "Mon", date: "14 Sep", name: "Faint Gloom", icon: "moon", up: "+5% Flaying", down: "−5% Harvesting", past: true },
  { when: "Tue", date: "15 Sep", name: "Faint Miasma", icon: "fog", up: "+7% Dredging", down: "−7% Felling", past: true },
  { when: "Today", date: "16 Sep", name: "Faint Gloom", icon: "moon", up: "+9% Flaying", down: "−9% Harvesting", today: true },
  { when: "Thu", date: "17 Sep", name: "Extreme Aridity", icon: "sun", up: "+16% Delving", down: "−16% Dredging" },
  { when: "Fri", date: "18 Sep", name: "Extreme Frost", icon: "frost", up: "+20% Harvesting", down: "−20% Delving" },
  { when: "Sat", date: "19 Sep", name: "Oppressive Gloom", icon: "moon", up: "+12% Flaying", down: "−12% Harvesting", bountiful: true },
];

PAGES.sky = () => h("div.page",
  pageHead({ eyebrow: "The Camp", title: "Sky", sub: "The week ahead is revealed every Sunday at 00:00 UTC. Weather shifts experience only, never how fast your crews work.",
    actions: chip("Next forecast Sun 20 Sep, 00:00 UTC", null, "calendar") }),
  h("section.card",
    cardHead("This week", { sub: "Each day favours one trade and hinders another by the same amount. Weekends are Bountiful: +20% XP to every trade." }),
    h("ol.forecast", WEEK.map((d) => h("li.fc-day", { class: { "is-today": d.today, "is-past": d.past }, "aria-current": d.today ? "date" : null },
      h("div.fc-when", h("span.eyebrow", d.when), h("span.fc-date", d.date)),
      h("span.fc-ico", ic(d.icon)),
      h("div.fc-body", h("div.fc-name", d.name), h("div.fc-mods", h("span.up", d.up), h("span.down", d.down))),
      d.bountiful ? tag("Bountiful", "gold") : h("span"))))));

const LISTINGS = [
  { item: "Bog Bar", icon: "ore", sub: "Bars · Tier 2", qty: 12, price: 14, seller: "Thane" },
  { item: "Sundering Bog Sword", icon: "blade", rarity: "rare", sub: "Rare weapon · Tier 2", qty: 1, price: 420, seller: "Edda" },
  { item: "Grave Moss", icon: "fibre", sub: "Fibre · Tier 2", qty: 150, price: 3, seller: "Wren" },
  { item: "Bog Pick", icon: "pick", sub: "Tool · Delving +12%", qty: 1, price: 96, seller: "Rook" },
  { item: "Amber Amulet", icon: "charm", rarity: "legendary", sub: "Legendary neck · Tier 2", qty: 1, price: 2400, seller: "Veyra" },
  { item: "Coal", icon: "coalIco", sub: "Reagent", qty: 50, price: 5, seller: "Morwen", mine: true },
];

PAGES.market = () => h("div.page",
  pageHead({ eyebrow: "The Realm", title: "Market", sub: "Buy from other commanders. Every sale pays a 5% fee to the market.",
    actions: h("button.btn.btn-primary", { type: "button", onClick: () => PAGES_MODALS.sell() }, ic("tag"), "Sell an item") }),
  h("section.card.card-flush",
    h("div.card-head", { style: { flexWrap: "wrap" } },
      h("div", h("h2.card-title", "Listings"), h("p.card-sub", "214 open, cheapest first")),
      h("div.market-bar.grow",
        h("div.input-wrap.market-search", ic("search"), h("input.input.input-sm", { type: "search", placeholder: "Search items", "aria-label": "Search listings" })),
        h("div.seg", { role: "tablist", "aria-label": "Kind" },
          h("button.seg-btn", { type: "button", role: "tab", "aria-selected": "true" }, "All"),
          h("button.seg-btn", { type: "button", role: "tab", "aria-selected": "false" }, "Materials"),
          h("button.seg-btn", { type: "button", role: "tab", "aria-selected": "false" }, "Gear"),
          h("button.seg-btn", { type: "button", role: "tab", "aria-selected": "false" }, "Tools")),
        h("select.select.select-sm", { "aria-label": "Tier", style: { width: "auto" } }, h("option", "All tiers"), h("option", "Tier 1"), h("option", "Tier 2")),
        h("select.select.select-sm", { "aria-label": "Sort", style: { width: "auto" } }, h("option", "Price, low to high"), h("option", "Price, high to low"), h("option", "Newest")))),
    h("div.listings", { role: "table", "aria-label": "Listings" },
      // Two columns, and the row is the button: what it is, and what it costs.
      h("div.listing-head", { role: "row" }, h("span", "Item"), h("span.num", "Price")),
      LISTINGS.map((l) => h("button.listing", {
        type: "button", role: "row", class: l.mine && "is-mine",
        onClick: () => PAGES_MODALS.buy({ name: l.item, price: l.price }, 1),
      },
        h("div.listing-item",
          art(l.icon, { rarity: l.rarity || "common", size: "sm" }),
          h("div.lr-main", h("div.lr-title", { class: l.rarity && `rar-${l.rarity}` }, l.item), h("div.lr-sub", l.sub))),
        h("div.listing-price", fmtGold(l.price), h("small", `${fmtWhole(l.qty)} to be had`)))))),
  h("div.grid-2",
    h("section.card",
      cardHead("My listings", { sub: "Unsold items come back by mail after 48 hours." }),
      h("div.list",
        h("div.list-row", art("ore", { size: "sm", rarity: "common" }),
          h("div.lr-main", h("div.lr-title", "Bog Bar · 14g each"), h("div.lr-sub", "12 of 20 sold · 266g so far"), h("div.mt-2", bar(60, "bar-gold bar-thin"))),
          h("div.lr-end", h("button.btn.btn-quiet.btn-sm", { type: "button" }, "Cancel"))),
        h("div.list-row", art("coalIco", { size: "sm", rarity: "common" }),
          h("div.lr-main", h("div.lr-title", "Coal · 5g each"), h("div.lr-sub", "0 of 50 sold · listed 2h ago"), h("div.mt-2", bar(0, "bar-gold bar-thin"))),
          h("div.lr-end", h("button.btn.btn-quiet.btn-sm", { type: "button" }, "Cancel"))))),
    h("section.card",
      cardHead("Recent sales"),
      h("div.list",
        h("div.list-row", art("coin", { size: "sm", tone: "gold" }), h("div.lr-main", h("div.lr-title", "Sold 5 Bog Bar to Thane"), h("div.lr-sub", "2h ago")), h("div.lr-end", h("span.price", "+67g"))),
        h("div.list-row", art("blade", { size: "sm", rarity: "rare" }), h("div.lr-main", h("div.lr-title", "Bought Sundering Bog Sword"), h("div.lr-sub", "From Edda · 1d ago")), h("div.lr-end", h("span.price.is-short", "−420g"))),
        h("div.list-row", art("coin", { size: "sm", tone: "gold" }), h("div.lr-main", h("div.lr-title", "Sold 7 Bog Bar to Wren"), h("div.lr-sub", "1d ago")), h("div.lr-end", h("span.price", "+93g")))))));

/* A square in the party room: whoever is sitting in it, an open one, or one the
   host has closed. The face is a plate here because the kit ships no portraits. */
function seat({ name, lv, host, ready, me, doing, offline }) {
  return h("div.seat.seat-taken", { class: { "is-me": me, "is-ready": ready, "is-offline": offline } },
    h("div.seat-face", { "aria-hidden": "true" }, avatar(name, { size: "lg" })),
    host ? null : h("button.seat-x", { type: "button", "aria-label": `Remove ${name}` }, ic("close")),
    h("span.seat-lv", String(lv)),
    h("div.seat-foot",
      h("button.seat-name", { type: "button" }, host ? ic("crown") : null, name),
      h("span.seat-doing", doing)),
    ready ? h("span.seat-ready", ic("check"), "Ready") : null);
}

const openSeat = () => h("button.seat.seat-open", { type: "button", "aria-label": "Close this square" }, h("span.seat-wait", "Waiting"));
const shutSeat = () => h("button.seat.seat-shut-box", { type: "button", "aria-label": "Open this square" }, h("span.seat-shut", { "aria-hidden": "true" }, ic("close")));

PAGES.party = () => h("div.page",
  pageHead({ eyebrow: "The Realm · Party of 3", title: "The Ashen Oath",
    sub: "Hunt the same ground at the same time: +10% Hunt XP for each of you there, up to +30%.",
    actions: [
      h("form.hstack.gap-2", { onSubmit: (e) => { e.preventDefault(); toast("Invite sent to Corvin", { kind: "good" }); } },
        h("div.input-wrap", ic("user-plus"), h("input.input.input-sm", { placeholder: "Username", "aria-label": "Invite by username", maxlength: "24" })),
        h("button.btn.btn-primary.btn-sm", { type: "submit" }, "Invite")),
      h("button.btn.btn-quiet.btn-sm", { type: "button" }, ic("logout"), "Leave"),
    ] }),
  h("section.card", { "data-tone": "ember" },
    cardHead("The room", { sub: "The Inner of Gallowmoor, when everyone is ready", actions: chip("2 out · 4m 12s", "ember", "swords") }),
    h("div.room-grid",
      seat({ name: "Morwen", lv: 29, me: true, host: true, ready: true, doing: "the Inner of Gallowmoor" }),
      seat({ name: "Thane", lv: 24, ready: true, doing: "At camp" }),
      openSeat(),
      shutSeat()),
    h("div.room-bar",
      h("div.hstack.gap-2",
        h("select.select.grow", { "aria-label": "Ground" }, h("option", "Inner")),
        h("button.btn.btn-sm", { type: "button" }, "Propose")),
      h("div.room-press",
        h("button.btn.btn-good.grow", { type: "button" }, "Stand down"),
        h("button.btn.btn-ember.grow", { type: "button" }, ic("swords"), "Start")))),
  h("div.grid-2",
    h("section.card.card-flush.chat",
      cardHead("Party chat", { actions: chip("3 online", "good", "online") }),
      h("ol.chat-log", { "aria-live": "polite" },
        h("li.msg-note", "Thane joined the party · 2d ago"),
        h("li.msg", avatar("Thane", { size: "sm" }), h("div", h("div.msg-meta", h("b", "Thane"), h("time", "14m")), h("p.msg-text", "Inner is thick with Stalkers tonight. Bring poultices."))),
        h("li.msg", avatar("Edda", { size: "sm", tone: "gold" }), h("div", h("div.msg-meta", h("b", "Edda"), h("time", "9m")), h("p.msg-text", "Forging bars for helms. Anyone short on Coal?"))),
        h("li.msg.is-own", h("div", h("div.msg-meta", h("time", "6m")), h("p.msg-text", "I have 30 spare. Mailing them over after this run."))),
        h("li.msg", avatar("Thane", { size: "sm" }), h("div", h("div.msg-meta", h("b", "Thane"), h("time", "Just now")), h("p.msg-text", "The Bailiff is close. Threat 64 and climbing.")))),
      h("form.composer", { onSubmit: (e) => e.preventDefault() },
        h("div.input-wrap", h("input.input", { placeholder: "Say something to the party", maxlength: "240", "aria-label": "Message", value: "Hiding at 100, not dying twice" })),
        h("span.composer-count", "31/240"),
        h("button.btn.btn-primary.btn-icon", { type: "submit", "aria-label": "Send" }, ic("send")))),
    h("section.card",
      cardHead("Invites", { sub: "The party holds four. Pending invites count toward that." }),
      h("div.list",
        h("div.list-row", avatar("Corvin", { size: "sm" }), h("div.lr-main", h("div.lr-title", "Corvin"), h("div.lr-sub", "Invited 5m ago")), h("div.lr-end", h("button.btn.btn-quiet.btn-sm", { type: "button" }, "Cancel")))),
      h("div.divider"),
      h("div.eyebrow", "Not in a party"),
      h("div.list.mt-2",
        h("div.list-row.stack-sm", avatar("Veyra", { size: "sm", tone: "ember" }), h("div.lr-main", h("div.lr-title", "Veyra invites you"), h("div.lr-sub", "To The Grey Lantern · 3 of 4")),
          h("div.lr-end", h("button.btn.btn-quiet.btn-sm", { type: "button" }, "Decline"), h("button.btn.btn-primary.btn-soft.btn-sm", { type: "button" }, "Accept")))))));

const BOARD = [
  ["Isolde", 412, "9.8M"], ["Brannoch", 398, "8.4M"], ["Veyra", 371, "6.9M"], ["Edda", 355, "6.1M"],
  ["Rook", 344, "5.5M"], ["Hollis", 330, "5.0M"], ["Morwen", 318, "4.6M", true], ["Wren", 305, "4.1M"],
  ["Sable", 297, "3.9M"], ["Thane", 290, "3.6M"],
];

PAGES.hiscores = () => h("div.page",
  pageHead({ eyebrow: "The Realm", title: "Hiscores", sub: "The top fifty in the realm, by total level or by any one skill." }),
  h("div.hs-skills", { role: "tablist", "aria-label": "Board" },
    h("button.chip", { type: "button", role: "tab", "aria-selected": "true" }, "Total"),
    SKILLS.map((s) => h("button.chip", { type: "button", role: "tab", "aria-selected": "false" }, ic(s.icon), s.name))),
  h("section.card",
    cardHead("Total level", { sub: "Updated as commanders play", actions: chip("You are #7", "violet") }),
    h("div.table-wrap",
      h("table.table",
        h("thead", h("tr", h("th", "Rank"), h("th", "Commander"), h("th.num", "Level"), h("th.num.hs-hide-sm", "XP"))),
        h("tbody", BOARD.map(([name, lv, xp, me], i) => h("tr", { class: me && "is-me", "aria-current": me ? "true" : null },
          h("td", h("span.hs-rank", { class: i < 3 && `is-${i + 1}` }, i + 1)),
          h("td.strong", h("span.hs-name", avatar(name, { size: "sm", tone: me ? null : "gold" }), h("span.truncate", name), me ? tag("You", "violet") : null)),
          h("td.num", fmtWhole(lv)),
          h("td.num.hs-hide-sm", xp))))))));

PAGES.states = () => h("div.page",
  pageHead({ eyebrow: "Kit", title: "States", sub: "Guests, empty pages, loading and the camp log." }),
  h("div.banner", { role: "status" },
    h("span.banner-ico", ic("cloud")),
    h("div.banner-text", h("b", "You are playing as a guest"), "Nothing is kept once this tab closes. Sign in to save your camp and join the Market, parties and the Hiscores."),
    h("div.banner-actions", h("button.btn.btn-gold.btn-sm", { type: "button", onClick: () => PAGES_MODALS.settings() }, "Sign in"))),
  h("div.banner", { "data-tone": "ember", role: "status" },
    h("span.banner-ico", ic("offline")),
    h("div.banner-text", h("b", "Offline"), "Your camp keeps running here. It syncs the moment the road clears."),
    h("div.banner-actions", h("button.btn.btn-sm", { type: "button" }, ic("sync"), "Try again"))),
  h("div.grid-2",
    h("section.card", empty({ iconName: "search", title: "No listings match", text: "Nobody is selling Wyrm Plank right now. Try another tier, or list your own.", action: h("button.btn.btn-sm", { type: "button" }, "Clear filters") })),
    h("section.card", empty({ iconName: "party", title: "You march alone", text: "Found a party to hunt together. Up to four, and every one of you on the same ground adds 10% Hunt XP.",
      action: h("div.btn-row", h("div.input-wrap", h("input.input.input-sm", { placeholder: "Party name", "aria-label": "Party name" })), h("button.btn.btn-primary.btn-sm", { type: "button" }, "Found a party")) })),
    h("section.card", empty({ iconName: "lock", title: "Sign in to trade", text: "The Market is for commanders with a name. Guests can look but not buy.", action: h("button.btn.btn-gold.btn-sm", { type: "button" }, "Sign in") })),
    h("section.card", empty({ iconName: "stockpile", title: "The Stockpile is bare", text: "Set a crew to work and it fills up on its own.", small: true }))),
  h("div.grid-2",
    h("section.card",
      cardHead("Loading", { actions: h("span.spinner", { role: "status", "aria-label": "Loading" }) }),
      h("div.vstack.gap-3",
        [0, 1, 2].map(() => h("div.hstack.gap-3", h("span.skel.skel-art"), h("div.grow", h("span.skel.skel-line", { style: { width: "55%" } }), h("span.skel.skel-line", { style: { width: "35%" } })))))),
    h("section.card",
      cardHead("Fetching the board"),
      h("div.loading", h("span.spinner"), "Asking the realm"),
      h("span.skel.skel-block"))),
  h("section.card",
    cardHead("Camp log", { actions: h("button.btn.btn-quiet.btn-sm", { type: "button" }, "Show all") }),
    logList(LOG)));

/* ================= 7. POPUPS ================= */

const PAGES_MODALS = {};

PAGES_MODALS.action = () => {
  let plan;
  let needOre;
  let needCoal;
  const update = (pick) => {
    if (!plan) return;
    const n = pick.unlimited ? null : pick.n;
    const count = n || 1;
    setText(needOre, n && n > 1 ? `${fmtWhole(2 * n)} for ${fmtWhole(n)} · 147 held` : "2 each · 147 held");
    toggleClass(needOre, "is-short", 2 * count > 147);
    setText(needCoal, n && n > 1 ? `${fmtWhole(2 * n)} for ${fmtWhole(n)} · 30 held` : "2 each · 30 held");
    toggleClass(needCoal, "is-short", 2 * count > 30);
    plan.replaceChildren(
      n ? h("span", h("b", `${fmtWhole(n)} × Bog Bar`), ` · ${fmtTime(n * 20000)} · ${fmtWhole(n * 8)} XP`) : h("span", h("b", "No limit"), " · stock covers 15"),
      n && n > 15 ? h("span.t-warn", "Stock covers 15.") : null);
  };
  needOre = h("span.ap-val");
  needCoal = h("span.ap-val");
  plan = h("p.ap-plan");
  const picker = qtyPicker({ value: 100, max: 999, onChange: update }).node;
  const m = openModal({
    title: "Bog Bar",
    sub: "Forgemaster · Tier 2 · At camp",
    art: "ore",
    size: "md",
    body: [
      h("p.ap-desc", "Dark iron from the moor, beaten flat. It still smells of peat."),
      h("div.chip-row", chip(`${signedPct(16)} XP · Extreme Aridity`, "good"), chip(`${signedPct(8)} XP · Tunnel Rat`, "good")),
      h("div.stats", stat("Time", "20.0s each"), stat("Experience", "8 XP each"), stat("Makes", "1 × Bog Bar"), stat("Held", "12")),
      h("div.ap-block", h("div.eyebrow", "Needs"),
        h("div.ap-list",
          h("div.ap-row", h("button.ap-link", { type: "button" }, ic("ore"), h("span", "Bog Ore")), needOre),
          h("div.ap-row", h("button.ap-link", { type: "button" }, ic("coalIco"), h("span", "Coal")), needCoal))),
      h("div.ap-run",
        h("div.ap-run-top", h("span", "Underway · 18 of 60"), h("b", "9m left")),
        bar(62)),
      h("div.ap-block", h("div.eyebrow", "How many"), picker),
      plan,
    ],
    actions: [
      { label: "Stop", kind: "quiet", onClick: () => { toast("The forge goes quiet", { kind: "info", icon: "plate" }); } },
      { label: "Forge", kind: "primary", onClick: () => { toast("Forging Bog Bar", { kind: "good", icon: "plate" }); } },
    ],
  });
  update({ n: 100, unlimited: false });
  return m;
};

PAGES_MODALS.item = () => openModal({
  title: "Sundering Bog Sword",
  sub: "Rare weapon · Tier 2 · Belongings ×2",
  art: "blade",
  artRarity: "rare",
  size: "md",
  body: [
    h("p.ip-desc", "Bog iron that remembers being something else. It bites through mail as if the mail were not there."),
    h("div.ip-effect", h("b", "Sundering. "), "Ignores some of a foe's Defence."),
    h("div.stats",
      stat("Attack", "+14", null, delta(3)),
      stat("Crit chance", "+2.4%", null, delta(0.4, "%")),
      stat("Veil a blow", "+6", null, delta(-1)),
      stat("Grip", "One-handed"),
      stat("Durability", "840"),
      stat("Value", "186g each", "gold")),
    h("div.well.ip-compare", ic("swords"), h("span", "Against your worn ", h("b", "Slag Sword"), ". Equipping it moves the Slag Sword to Belongings.")),
    h("dl.ip-sources", h("dt", "Made by"), h("dd", "Forgemaster"), h("dt", "Dropped by"), h("dd", "Bog Brute, The Drowned Bailiff"), h("dt", "Repaired with"), h("dd", "Bog Ore")),
    h("div.ap-block", h("div.eyebrow", "Amount"), qtyPicker({ value: 1, max: 2, allowUnlimited: false, presets: [1] }).node),
  ],
  actions: [
    { label: "Equip · Weapon", kind: "primary", wide: true, icon: "swords" },
    { label: "Move to Stockpile", icon: "stockpile" },
    { label: "Move to Vault", icon: "lock" },
    { label: "Sell · 186g", kind: "gold", soft: true, icon: "coin", onClick: () => confirm({ title: "Sell Sundering Bog Sword?", body: "The merchant pays 186g. Rare pieces are gone once sold.", confirmText: "Sell for 186g" }).then((ok) => (ok ? undefined : false)) },
    { label: "List on market", kind: "primary", soft: true, icon: "market", onClick: () => { PAGES_MODALS.sell(); return false; } },
    { label: "Break down · 6 Bog Bar", kind: "quiet", wide: true, icon: "hammer" },
  ],
});

PAGES_MODALS.stack = () => openModal({
  title: "Bog Bar",
  sub: "Bars · Tier 2 · Stockpile ×147",
  art: "ore",
  artRarity: "common",
  body: [
    h("p.ip-desc", "Dark iron from the moor, beaten flat. It still smells of peat."),
    h("div.stats", stat("Value", "14g each · 2,058g"), stat("Held in all", "159")),
    h("dl.ip-sources", h("dt", "Made by"), h("dd", "Forgemaster"), h("dt", "Used by"), h("dd", "Forgemaster, Woodwright, Artificer")),
    h("div.ap-block", h("div.eyebrow", "Amount"), qtyPicker({ value: 147, max: 147, allowUnlimited: false, presets: [1, 10, 100] }).node),
  ],
  actions: [
    { label: "Move 147 to Belongings", icon: "pack" },
    { label: "Move 147 to Vault", icon: "lock" },
    { label: "Sell 147 · 2,058g", kind: "gold", soft: true, icon: "coin" },
    { label: "List on market", kind: "primary", soft: true, icon: "market", onClick: () => { PAGES_MODALS.sell(); return false; } },
  ],
});

PAGES_MODALS.sell = () => {
  const priceInput = h("input.input#sellPrice", { type: "text", inputmode: "numeric", value: "14" });
  let rows;
  const qty = { n: 20 };
  const recalc = () => {
    const price = Math.max(1, Number(priceInput.value.replace(/[^0-9]/g, "")) || 1);
    const total = price * qty.n;
    const fee = Math.ceil(total * 0.05);
    rows.replaceChildren(
      h("div.cost-row", h("span.l", `Listing ${fmtWhole(qty.n)} × ${fmtGold(price)}`), h("span.v", fmtGold(total))),
      h("div.cost-row", h("span.l", "Market fee (5%)"), h("span.v", `−${fmtGold(fee)}`)),
      h("div.cost-row.is-total", h("span.l", "You receive when it all sells"), h("span.v", ic("coin"), fmtGold(total - fee))));
  };
  rows = h("div.fee");
  priceInput.addEventListener("input", recalc);
  const m = openModal({
    title: "List Bog Bar",
    sub: "From the Stockpile · 147 held",
    art: "market",
    artTone: "gold",
    body: [
      h("div.field", h("span.field-label", "How many"), qtyPicker({ value: 20, max: 147, allowUnlimited: false, presets: [1, 10, 100], onChange: (p) => { qty.n = p.n; if (rows) recalc(); } }).node),
      h("div.field",
        h("label.field-label", { for: "sellPrice" }, "Price each"),
        h("div.input-wrap", ic("coin"), priceInput, h("span.affix", "g")),
        h("span.field-hint", "Lowest listed now: 13g. Sells at the merchant for 14g.")),
      rows,
      h("p.modal-note", "Unsold items come back by mail after 48 hours."),
    ],
    actions: [
      { label: "Cancel", kind: "quiet" },
      { label: "List for sale", kind: "primary", icon: "tag", onClick: () => new Promise((r) => setTimeout(() => { toast("Listed 20 Bog Bar at 14g each", { kind: "gold", icon: "market" }); r(); }, 700)) },
    ],
  });
  recalc();
  return m;
};

function settingsBody(signedIn) {
  return [
    h("section.set-section",
      h("div.set-head", h("h3.set-title", "Account"), h("span.small", { class: signedIn ? "t-good" : "muted" }, signedIn ? "Saved 12s ago" : "Not signed in")),
      signedIn
        ? h("div.well.account",
          avatar("Morwen"),
          h("div.grow", h("span.strong", "Morwen"), h("span.small.muted", "Your camp saves to the cloud as you play.")),
          h("button.btn.btn-quiet.btn-sm", { type: "button" }, ic("logout"), "Sign out"))
        : [
          h("div.banner",
            h("span.banner-ico", ic("cloud")),
            h("div.banner-text", h("b", "Playing as a guest"), "Nothing is kept. Sign in or create an account to save your camp.")),
          h("form.vstack.gap-3", { onSubmit: (e) => e.preventDefault() },
            h("div.set-fields",
              h("div.field", h("label.field-label", { for: "acctUser" }, "Username"), h("input.input#acctUser", { autocomplete: "username", spellcheck: "false" })),
              h("div.field", h("label.field-label", { for: "acctPass" }, "Password"), h("input.input#acctPass", { type: "password", autocomplete: "current-password" }))),
            h("div.set-actions",
              h("button.btn.btn-primary", { type: "submit" }, "Sign in"),
              h("button.btn", { type: "button" }, "Create account"))),
        ]),
    h("section.set-section",
      h("div.set-head", h("h3.set-title", "Connection")),
      h("div.stats", stat("Status", "212 commanders online", "good"), stat("Last sync", "12s ago"), stat("Engine", "v5.0.3"))),
    h("section.set-section",
      h("div.danger-zone.vstack.gap-2",
        h("h3.set-title", "Start over"),
        h("p.set-copy", "Wipes this character back to a ruin. Skills, gear, gold and companions are all lost, for good."),
        h("div", h("button.btn.btn-danger.btn-soft", { type: "button", onClick: () => PAGES_MODALS.reset() }, "Start over")))),
  ];
}

PAGES_MODALS.settings = () => openModal({ title: "Settings", sub: "Account, connection and starting over", art: "gear", artTone: "violet", body: settingsBody(false) });
PAGES_MODALS.account = () => openModal({ title: "Settings", sub: "Account, connection and starting over", art: "gear", body: settingsBody(true) });

PAGES_MODALS.class = () => openModal({
  title: "Choose your discipline",
  sub: "Set once, at Hunt level 5. It opens the Veil and decides your bulk, your speed, and what the Veil does when it fills.",
  art: "sparkle",
  size: "xl",
  dismissible: false,
  body: h("div.grid-cards.class-grid",
    [["Warrior", "plate", "Heavy and patient. Takes the blow so the crews do not have to.", ["Health ×1.3", "Defence ×1.25", "2.6s swing"], "Bulwark. A full Veil blunts every blow for a while."],
      ["Rogue", "blade", "Quick and unkind. Finds the gap in anything given time.", ["Attack ×1.15", "Crit 12%", "1.8s swing"], "Ambush. A full Veil opens with a strike that cannot miss."],
      ["Mage", "stave", "Fragile, far away and very certain.", ["Attack ×1.35", "Health ×0.85", "3.0s swing"], "Volley. A full Veil looses a rain of casts."]]
      .map(([name, iconName, blurb, stats, veil]) => h("button.card.card-link.class-card", { type: "button", onClick: () => { closeModals(); toast(`${name} chosen`, { kind: "good", icon: iconName }); } },
        h("div.hstack.gap-3", art(iconName, { size: "sm" }), h("span.class-name", name)),
        h("span.class-blurb", blurb),
        h("span.chip-row", stats.map((s) => chip(s))),
        h("span.class-veil", veil)))),
});

PAGES_MODALS.buy = (item = { name: "Star-Steel Tonic", price: 140 }, qty = 5) => confirm({
  title: `Buy ${qty > 1 ? `${qty} × ` : ""}${item.name}?`,
  body: qty > 1 ? `They go straight into Belongings, ready for the hunt.` : `${item.name} is yours once the gold changes hands.`,
  confirmText: `Buy for ${fmtGold(item.price * qty)}`,
  cost: { gold: item.price * qty, have: ME.gold },
}).then((ok) => { if (ok) toast(`Bought ${item.name}`, { kind: "gold", icon: "coin" }); });

PAGES_MODALS.short = () => confirm({
  title: "Buy 13× Wyrm Plank?",
  body: "The Smuggler does not haggle and does not wait.",
  confirmText: "Buy for 8,112g",
  cost: { gold: 8112, have: ME.gold },
});

PAGES_MODALS.reset = () => confirm({
  title: "Start over?",
  body: "Every skill, item, companion and coin is gone for good. There is no getting it back.",
  confirmText: "Wipe my camp",
  danger: true,
  typeToConfirm: "RESET",
}).then((ok) => { if (ok) toast("The camp is a ruin again", { kind: "bad", icon: "skull" }); });

PAGES_MODALS.foe = () => openModal({
  title: "Fen Stalker",
  sub: "Stalker · Gallowmoor",
  art: `<svg class="m-art" viewBox="0 0 120 120" aria-hidden="true">${MONSTER_ART.horror}</svg>`,
  artTone: "ember",
  body: [
    h("p.ap-desc", "It keeps to the reeds until you are between it and the water."),
    h("div.stats",
      stat("Health", "48"), stat("Attack", "4.1 a blow"), stat("Against you", "About 52 a minute"),
      stat("Defence", "Stops 9% of a blow"), stat("Swings every", "2.4s"), stat("Experience", "3.6 a kill, more deeper in"),
      stat("Threat", "2 a kill, more deeper in"), stat("Gold", "2g to 5g", "gold"), stat("As an Elite", "96 health · 6.2 a blow · ×2 XP")),
    h("div.ap-block", h("div.eyebrow", "Drops"),
      h("div.ap-list",
        h("div.ap-row", h("button.ap-link", { type: "button" }, ic("hide"), h("span", "Bristle Pelt ×1")), h("span.ap-val", "35%")),
        h("div.ap-row", h("button.ap-link", { type: "button" }, ic("gem"), h("span", "River Amber ×1")), h("span.ap-val", "15%")),
        h("div.ap-row", h("span.ap-link", ic("sparkle"), h("span", "Elites drop")), h("span.ap-val", "×2")))),
  ],
  actions: [{ label: "Back to the Inner", wide: true, onClick: () => { PAGES_MODALS.huntZone(); } }],
});

PAGES_MODALS.huntZone = () => openModal({
  title: "Inner · Gallowmoor",
  sub: "Hunt · Tier 2",
  art: "zoneInner",
  artTone: "ember",
  body: [
    h("p.ap-desc", "Closer to the heart of the moor. More of them, and they come sooner."),
    h("div.stats", stat("Foes at once", "2 or 3, never more than 3"), stat("Reinforcements", "One every 40s a fight runs on"), stat("Elites", "14%"), stat("XP a kill", "×1.7"), stat("You last", "Past twelve hours", "good")),
    h("div.ap-run", { "data-tone": "ember" }, h("div.ap-run-top", h("span", "Underway · 38 kills"), h("b", "4,210 XP/hr")), bar(48, "bar-ember")),
    h("div.ap-block", h("div.eyebrow", "How many kills"), qtyPicker({ value: 1, max: 900, unlimited: true }).node),
    h("p.ap-plan", h("span", h("b", "No limit"), " · until you pull back, fall or twelve hours pass")),
  ],
  actions: [{ label: "Pull back", kind: "quiet" }, { label: "Hunt", kind: "ember", icon: "swords" }],
});

/* ================= 8. PAGE MODE: A PAGE INSIDE THE REAL SHELL ================= */

const ROUTES = [
  [/^#\/character$/, "character", ["The Vanguard", "Character"]],
  [/^#\/armaments$/, "armaments", ["The Vanguard", "Armaments"]],
  [/^#\/companions$/, "companions", ["The Vanguard", "Companions"]],
  [/^#\/stockpile$/, "storage", ["The Camp", "Stockpile"]],
  [/^#\/bounties$/, "bounties", ["The Camp", "Bounties"]],
  [/^#\/requisitions$/, "requisitions", ["The Camp", "Requisitions"]],
  [/^#\/shop$/, "shop", ["The Camp", "Shop"]],
  [/^#\/sky$/, "sky", ["The Camp", "Sky"]],
  [/^#\/skill\/warfare$/, "hunt", ["The Field", "Hunt"]],
  [/^#\/skill\/(forgemaster|woodwright|tanner|weaver|artificer)$/, "bench", ["Artisans", "Forgemaster"]],
  [/^#\/skill\/[a-z]+$/, "gather", ["Trades", "Delving"]],
  [/^#\/atlas$/, "atlas", ["The Realm", "Atlas"]],
  [/^#\/market$/, "market", ["The Realm", "Market"]],
  [/^#\/party$/, "party", ["The Realm", "Party"]],
  [/^#\/hiscores$/, "hiscores", ["The Realm", "Hiscores"]],
  [/^#\/states$/, "states", ["Kit", "States"]],
];

const PAGE_ROUTE = {
  character: "#/character", armaments: "#/armaments", companions: "#/companions", storage: "#/stockpile",
  bounties: "#/bounties", requisitions: "#/requisitions", shop: "#/shop", sky: "#/sky", hunt: "#/skill/warfare",
  bench: "#/skill/forgemaster", gather: "#/skill/delving", atlas: "#/atlas", market: "#/market", party: "#/party",
  hiscores: "#/hiscores", states: "#/states",
};

async function bootPage() {
  const doc = await loadShell();
  const keep = ["app", "modalRoot", "tipLayer", "toasts", "srLive"].map((id) => document.adoptNode(doc.getElementById(id)));
  document.body.replaceChildren(document.adoptNode(doc.querySelector(".skip-link")), ...keep);
  document.title = "Respite UI Kit · page";

  const opts = {
    bench: params.get("bench") || "working",
    hunt: params.get("hunt") || "hunting",
    conn: params.get("conn") || "online",
  };

  const drawer = bindDrawer();
  const weather = el("weather");
  weather.replaceChildren(...weatherCard());
  weather.hidden = false;

  const render = () => {
    const hash = location.hash || PAGE_ROUTE[params.get("page")] || "#/character";
    const hit = ROUTES.find(([re]) => re.test(hash)) || ROUTES[0];
    const [, page, crumbs] = hit;
    fillTopbar(el("topbar"), { ...opts, crumbs });
    fillNav(document, PAGE_ROUTE[page]);
    closeModals();
    const view = el("view");
    view.replaceChildren(PAGES[page]());

    const dock = el("logDock");
    if (page === "character") {
      dock.replaceChildren(h("section.card", cardHead("Camp log", { actions: h("button.btn.btn-quiet.btn-sm", { type: "button" }, "Show all") }), logList(LOG.slice(0, 4))));
      dock.hidden = false;
    } else {
      dock.hidden = true;
    }

    qsa(".chat-log", view).forEach((log) => { log.scrollTop = log.scrollHeight; });

    const banners = el("bannerDock");
    banners.replaceChildren(opts.conn === "guest"
      ? h("div.banner", h("span.banner-ico", ic("cloud")), h("div.banner-text", h("b", "You are playing as a guest"), "Nothing is kept once this tab closes."), h("div.banner-actions", h("button.btn.btn-gold.btn-sm", { type: "button", onClick: () => PAGES_MODALS.settings() }, "Sign in")))
      : opts.conn === "offline"
        ? h("div.banner", { "data-tone": "ember" }, h("span.banner-ico", ic("offline")), h("div.banner-text", h("b", "Offline"), "Your camp keeps running here and syncs when the road clears."))
        : "");
  };

  // The kit page sets <base href="../">, which would send "#/..." links to index.html. Keep them here.
  on(document, "click", 'a[href^="#/"]', (e, a) => {
    e.preventDefault();
    location.hash = a.getAttribute("href");
  });

  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  render();

  el("tbSettings").addEventListener("click", () => (opts.conn === "guest" ? PAGES_MODALS.settings() : PAGES_MODALS.account()));
  el("tbConn").addEventListener("click", () => (opts.conn === "guest" ? PAGES_MODALS.settings() : PAGES_MODALS.account()));
  el("tbBenchStop").addEventListener("click", () => toast("The crews down tools", { icon: "hammer" }));
  el("tbHuntStop").addEventListener("click", () => toast("You pulled back", { kind: "warn", icon: "swords" }));

  if (!SHOT) liveBars();

  const modal = params.get("modal");
  if (modal && PAGES_MODALS[modal]) setTimeout(() => PAGES_MODALS[modal](), 60);
  if (params.get("drawer") === "open" && drawer) setTimeout(() => drawer.open(), 60);
  if (!SHOT) pageSwitcher();
}

// Moves the bars a few times a second, the way the game will, to prove it stays cheap.
function liveBars() {
  let t = 0;
  setInterval(() => {
    t += 1;
    const pct = (base) => (base + t * 0.5) % 100;
    const benchBar = el("tbBenchBar");
    const huntBar = el("tbHuntBar");
    if (benchBar && benchBar.parentElement.offsetParent) {
      benchBar.classList.toggle("nojump", pct(36) < 1);
      setWidth(benchBar, pct(36));
    }
    if (huntBar) setWidth(huntBar, pct(48));
    qsa(".item-pill.is-working .pill-bar > i").forEach((i) => setWidth(i, pct(36)));
  }, 250);

  // A blow now and then in the arena.
  setInterval(() => {
    const target = qs(".foe-card.is-target .fx-layer");
    if (!target || document.hidden) return;
    const kinds = [["hit", "9"], ["crit", "17!"], ["hit", "11"], ["glance", "Glance"]];
    const [kind, text] = kinds[Math.floor(Math.random() * kinds.length)];
    const f = h("span.float", { class: [kind, `lane${Math.floor(Math.random() * 3)}`] }, text);
    target.appendChild(f);
    const art = qs(".foe-card.is-target .foe-art");
    if (art) { art.classList.remove("struck"); void art.offsetWidth; art.classList.add("struck"); }
    setTimeout(() => f.remove(), 1000);
  }, 1400);
}

function pageSwitcher() {
  const sel = h("select.select.select-sm", { "aria-label": "Kit page" },
    h("option", { value: "" }, "Gallery"),
    Object.keys(PAGE_ROUTE).map((p) => h("option", { value: p, selected: params.get("page") === p }, `Page: ${p}`)));
  sel.addEventListener("change", () => {
    location.href = sel.value ? `dev/kit.html?page=${sel.value}` : "dev/kit.html";
  });
  document.body.appendChild(h("div.kit-switch", sel));
}

/* ================= 9. GALLERY ================= */

const V4_NAMES = new Set(["moon", "coin", "pick", "axe", "sickle", "knife", "net", "ore", "log", "fibre", "hide", "gem", "ration", "crate", "blade", "greatblade", "stave", "ward", "plate", "greaves", "treads", "gauntlets", "cowl", "shroud", "band", "charm", "book", "beast", "man", "golemMob", "horror", "drakeMob", "rat", "crow", "marshcat", "hound", "stag", "atlas", "shop", "scroll", "pack", "person", "paw", "swords", "info", "lock", "menu", "zoneOuter", "zoneMiddle", "zoneInner", "zoneCore", "rain", "sun", "fog", "wind", "frost", "unknown", "coalIco", "resinIco", "pulpIco", "tallowIco", "shardIco"]);

function section(id, title, intro, ...blocks) {
  return h("section.kit-section", { id: `k-${id}`, "data-kit-section": id },
    h("header", h("h2", title), intro ? h("p", { html: intro }) : null),
    blocks);
}

const block = (label, ...content) => h("div.kit-block", label ? h("div.eyebrow.kit-label", label) : null, content);
const stage = (...content) => h("div.kit-stage", content);
const row = (...content) => h("div.kit-row", content);

function swatch(name, value, note) {
  return h("div.kit-swatch", h("i", { style: { background: `var(${name})` } }), h("div", h("b", name), h("span", note || value)));
}

function galleryTokens() {
  return section("tokens", "Tokens",
    "Every value lives in <code>css/tokens.css</code>. Surfaces step up from the page; text steps down in three readable levels; accents each have one job.",
    block("Surfaces and lines", h("div.kit-swatches",
      swatch("--bg", "", "#0b0910 · the page"), swatch("--surface-1", "", "#141019 · cards"), swatch("--surface-2", "", "#1c1723 · raised"),
      swatch("--surface-3", "", "#241d2d · floating"), swatch("--surface-sunk", "", "#0f0c14 · wells"), swatch("--line", "", "bone at 10%"))),
    block("Text", h("div.kit-swatches",
      swatch("--bone", "", "#e8e1d5 · 12.5:1"), swatch("--bone-dim", "", "#b5adbb · 7.5:1"), swatch("--bone-faint", "", "#948c9f · 5.0:1"), swatch("--bone-ghost", "", "decoration only"))),
    block("Accents", h("div.kit-swatches",
      swatch("--violet", "", "the bench, focus"), swatch("--ember", "", "the hunt, danger"), swatch("--gold", "", "money, the spend"),
      swatch("--good", "", "health, gains"), swatch("--warn", "", "take care"), swatch("--violet-soft", "", "tinted fills"))),
    block("Rarity", h("div.kit-swatches",
      ["common", "uncommon", "rare", "epic", "legendary", "relic"].map((r) => swatch(`--r-${r}`, "", r)))),
    block("Type", stage(h("div.kit-type",
      h("div", h("code", "36 display"), h("span.display", { style: { fontSize: "36px" } }, "The Ashen Warden")),
      h("div", h("code", "28 display"), h("span.title-lg", "Gallowmoor")),
      h("div", h("code", "22 display"), h("span.title-md", "The Bonesetter")),
      h("div", h("code", "18 display"), h("span.title-sm", "Bitter-Ash Salve")),
      h("div", h("code", "16 lead"), h("span.lead", "Peat and gibbets. The iron in the bog came from something.")),
      h("div", h("code", "14 body"), h("span", "Your crews bring up 12 Bog Ore an hour at this rate.")),
      h("div", h("code", "13 small"), h("span.small.dim", "Restores 70 HP · 4 in Belongings")),
      h("div", h("code", "12 meta"), h("span.tiny.muted", "42 of 200 · 1h 12m left")),
      h("div", h("code", "11 eyebrow"), h("span.eyebrow", "The Field · Gallowmoor"))))),
    h("div.kit-cols",
      block("Space (4px steps)", stage(h("div.kit-space", [1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) =>
        h("div", h("code", `--sp-${n}`), h("i", { style: { width: `var(--sp-${n})` } })))))),
      block("Radii", stage(h("div.kit-radii", ["xs", "sm", "md", "lg", "xl", "pill"].map((r) =>
        h("div", { style: { borderRadius: `var(--r-${r})` } }, `--r-${r}`))))),
      block("Depth", stage(h("div.kit-shadows",
        h("div", { style: { boxShadow: "var(--shadow-card)", borderRadius: "14px" } }, "card"),
        h("div", { style: { boxShadow: "var(--shadow-pop)", borderRadius: "14px", background: "var(--surface-3)" } }, "pop"),
        h("div", { style: { boxShadow: "var(--shadow-modal)", borderRadius: "14px", background: "var(--surface-3)" } }, "modal"))))));
}

function galleryIcons() {
  const names = Object.keys(ICONS);
  return section("icons", "Icons",
    `${names.length} hand-drawn 24px stroke icons. <code>icon(name, cls)</code> gives a string, <code>iconEl(name, cls)</code> an element. Violet ones are new in v5.`,
    h("div.kit-icons", names.map((n) => h("div.kit-icon", { class: !V4_NAMES.has(n) && "is-new" }, ic(n), n))));
}

function galleryButtons() {
  const kinds = [["", "Default"], ["btn-primary", "Forge"], ["btn-gold", "Buy · 250g"], ["btn-ember", "Hunt"], ["btn-danger", "Wipe my camp"], ["btn-quiet", "Cancel"]];
  return section("buttons", "Buttons",
    "One solid button per surface, for the thing the surface is for: violet for the bench, gold for a spend, ember for the hunt. Repeated actions in lists use <code>.btn-soft</code>.",
    block("Kinds", stage(row(kinds.map(([cls, label]) => h("button.btn", { type: "button", class: cls }, label))))),
    block("Soft", stage(row(
      h("button.btn.btn-primary.btn-soft", { type: "button" }, "Take along"),
      h("button.btn.btn-gold.btn-soft", { type: "button" }, ic("coin"), "Buy"),
      h("button.btn.btn-ember.btn-soft", { type: "button" }, "Change hunt"),
      h("button.btn.btn-danger.btn-soft", { type: "button" }, "Start over")))),
    block("Sizes, icons, states", stage(
      row(
        h("button.btn.btn-sm", { type: "button" }, "Small"),
        h("button.btn", { type: "button" }, "Default"),
        h("button.btn.btn-lg.btn-primary", { type: "button" }, "Large"),
        h("button.btn", { type: "button" }, ic("stockpile"), "Move to Stockpile"),
        h("button.btn.btn-icon", { type: "button", "aria-label": "Settings" }, ic("gear")),
        h("button.btn.btn-icon.btn-quiet", { type: "button", "aria-label": "Close" }, ic("close")),
        h("button.btn.btn-icon.btn-sm.btn-primary", { type: "button", "aria-label": "Send" }, ic("send"))),
      h("div.mt-4", row(
        h("button.btn.btn-gold", { type: "button", disabled: true }, "5 more to go"),
        h("button.btn.btn-primary.is-loading", { type: "button" }, h("span", "Listing")),
        h("button.btn.btn-gold.is-loading", { type: "button" }, h("span", "Buying")),
        h("span.link", { tabindex: "0" }, "A link in copy"))),
      h("div.mt-4", h("button.btn.btn-block.btn-primary", { type: "button" }, "Block: Equip · Weapon")))));
}

function galleryForms() {
  return section("forms", "Forms and controls",
    "Inputs are 16px on phones so nothing zooms. Every control is at least 44px tall on touch.",
    h("div.kit-cols",
      block("Fields", stage(h("div.vstack.gap-4",
        h("div.field", h("label.field-label", { for: "kUser" }, "Username"), h("input.input#kUser", { placeholder: "morwen", autocomplete: "off" }), h("span.field-hint", "3 to 24 letters, numbers or underscores.")),
        h("div.field", h("label.field-label", { for: "kBad" }, "Price each"), h("div.input-wrap", ic("coin"), h("input.input.is-invalid#kBad", { value: "0" }), h("span.affix", "g")), h("span.field-hint.t-bad", "At least 1g.")),
        h("div.field", h("label.field-label", { for: "kSearch" }, "Search"), h("div.input-wrap", ic("search"), h("input.input#kSearch", { type: "search", placeholder: "Search items" }))),
        h("div.field", h("label.field-label", { for: "kSel" }, "Sort"), h("select.select#kSel", h("option", "Price, low to high"), h("option", "Newest"))),
        h("div.field", h("label.field-label", { for: "kDis" }, "Disabled"), h("input.input#kDis", { value: "Morwen", disabled: true })),
        h("div.field", h("label.field-label", { for: "kMsg" }, "Note"), h("textarea.textarea#kMsg", { placeholder: "240 characters at most" }))))),
      block("Choices", stage(h("div.vstack.gap-4",
        h("div.vstack",
          h("label.check", h("input", { type: "checkbox", checked: true }), "Show locked recipes"),
          h("label.check", h("input", { type: "checkbox" }), "Only what I can afford"),
          h("label.switch", h("input", { type: "checkbox", checked: true }), "Hide when Threat peaks"),
          h("label.switch", h("input", { type: "checkbox" }), "Sound")),
        h("div.divider"),
        h("div.eyebrow", "Tabs"),
        h("div.tabs", { role: "tablist" },
          h("button.tab", { type: "button", role: "tab", "aria-selected": "true" }, "Belongings", h("span.count", "7/10")),
          h("button.tab", { type: "button", role: "tab", "aria-selected": "false" }, "Vault", h("span.count", "8/50"))),
        h("div.eyebrow", "Segmented"),
        h("div.seg", { role: "tablist" },
          h("button.seg-btn", { type: "button", role: "tab", "aria-selected": "true" }, "Components", h("span.count", "4")),
          h("button.seg-btn", { type: "button", role: "tab", "aria-selected": "false" }, "Wares", h("span.count", "7"))),
        h("div.eyebrow", "Tiers: the ones you have, plus the next"),
        h("div.tier-row",
          h("button.tier", { type: "button" }, "Lv 1"),
          h("button.tier.is-active", { type: "button", "aria-pressed": "true" }, "Lv 10"),
          h("button.tier", { type: "button" }, "Lv 20"),
          h("button.tier.is-next", { type: "button" }, ic("lock"), "Lv 30")))))),
    block("Quantity picker", h("div.kit-cols",
      stage(h("div.eyebrow.kit-label", "A number"), qtyPicker({ value: 100, max: 999 }).node),
      stage(h("div.eyebrow.kit-label", "No limit"), qtyPicker({ value: 12, max: 999, unlimited: true }).node),
      stage(h("div.eyebrow.kit-label", "In a row (shop)"), row(qtySmall(10), h("button.btn.btn-gold.btn-soft.btn-sm", { type: "button" }, "Buy"))))));
}

function galleryChips() {
  return section("chips", "Chips, tags, badges",
    "Chips carry a short fact. Tags label a thing. Badges only appear when something needs you.",
    block("Chips", stage(row(
      h("span.chip.chip-sm", "Small"), h("span.chip.chip-lg", ic("coin"), "Large · 1,234g"),
      chip("12s", null, "clock"), chip("+9% XP · Faint Gloom", "good"), chip("−9% XP · Faint Gloom", "bad"), chip("Pays 27g", "gold", "coin"),
      chip("+20% Hunt XP · 2 here", "violet", "party"), chip("Threat 64", "ember", "swords"), chip("Stock runs out", "warn", "warn"), chip("Tier 3 of 9")))),
    block("Buttons as chips, and the tooltip chip", stage(row(
      h("button.chip", { type: "button", "aria-pressed": "true" }, "All"),
      h("button.chip", { type: "button", "aria-pressed": "false" }, ic("blade"), "Gear"),
      h("button.chip", { type: "button", "aria-pressed": "false" }, "Materials"),
      h("button.chip", { type: "button", disabled: true }, "Tools"),
      (() => { const b = h("button.tip-chip", { type: "button" }, ic("info"), "Mastery · +2% double yield"); tooltip(b, masteryTip, { placement: "bottom" }); return b; })()))),
    block("What a recipe takes", stage(row(need("ore", "Bog Ore", 147, 2), need("coalIco", "Coal", 30, 2), need("ore", "Bog Bar", 0, 12)))),
    h("div.kit-cols",
      block("Tags", stage(row(tag("Warrior", "violet"), tag("Elite", "elite"), tag("Sovereign", "sovereign"), tag("Here", "violet"), tag("Open", "good"),
        tag("Tier 3", "gold"), tag("Hunting", "ember"), tag("Expired"), h("span.tag", { "data-rarity": "legendary" }, "Legendary")))),
      block("Badges and dots", stage(row(
        h("span.badge", "2"), h("span.badge.badge-gold", "1"), h("span.badge.badge-ember", "!"), h("span.badge.badge-good", "12"),
        h("span.dot.dot-online"), h("span.dot.dot-working"), h("span.dot.dot-hunting"), h("span.dot.dot-away"), h("span.dot.dot-offline")))),
      block("Deltas and prices", stage(row(delta(3), delta(-2), delta(0), h("span.price", "140g", h("small", "each")), h("span.price.is-short", "8,112g"))))));
}

function galleryBars() {
  return section("bars", "Bars, meters, numbers",
    "Fills are set with <code>setWidth(fill, pct)</code>: a short linear transition, repainted only when the number moves. Add <code>.nojump</code> when a bar wraps back to zero.",
    h("div.kit-cols",
      block("Bars", stage(h("div.vstack.gap-4",
        bar(62), bar(48, "bar-ember"), bar(71, "bar-gold"), bar(88, "bar-good"), bar(40, "bar-neutral"),
        bar(36, "bar-thin"), bar(64, "bar-ember bar-lg"), bar(60, "bar-striped")))),
      block("Health and meters", stage(h("div.vstack.gap-4",
        h("div.hpbar", h("i", { style: { width: "78%" } }), h("span", "87 / 112")),
        h("div.hpbar.hpbar-foe", h("i", { style: { width: "46%" } }), h("span", "22 / 48")),
        h("div.hpbar.hpbar-foe.hpbar-sm", h("i", { style: { width: "82%" } }), h("span", "64 / 78")),
        h("div.veilbar", h("i", { style: { width: "64%" } })),
        h("div.meter", h("div.meter-top", h("span", "Threat"), h("b", "64 / 100")), bar(64, "bar-ember bar-thin")))))),
    block("Key numbers", h("div.kpis",
      h("div.kpi", h("span.l", "Kills"), h("span.v", "38")),
      h("div.kpi", h("span.l", "XP/hr"), h("span.v", "4,210")),
      h("div.kpi", h("span.l", "Threat"), h("span.v", "64 / 100"), bar(64, "bar-ember bar-thin")),
      h("div.kpi", h("span.l", "Time left"), h("span.v", "10h 48m")))),
    h("div.kit-cols",
      block("Stat rows", h("div.card", h("div.stats", stat("Attack", "+14", null, delta(3)), stat("Defence", "9.8", null, h("small", "stops 31% here")), stat("Gold on hand", "1,234g", "gold"), stat("Hunt", "Lv 31", "good")))),
      block("Standing grid", h("div.card", h("div.standing",
        [["112", "Health"], ["14.2", "Attack"], ["9.8", "Defence"], ["1,482", "Kills"], ["3", "Deaths"], ["18,440g", "Gold earned", "gold"]]
          .map(([v, l, tone]) => h("div.standing-cell", h("div.v", { class: tone && `t-${tone}` }, v), h("div.eyebrow.l", l))))))));
}

function galleryCards() {
  return section("cards", "Cards, sections, lists",
    "Cards sit on the page, never inside each other. Inside a card, group with a <code>.well</code>, a <code>.list</code> or a divider.",
    h("div.kit-cols",
      block("Card anatomy", h("section.card", { "data-tone": "violet" },
        cardHead("The Bonesetter", { eyebrow: "The Camp", sub: "Always open. Remedies go straight into Belongings.", actions: h("button.btn.btn-sm.btn-quiet", { type: "button" }, "Refresh") }),
        h("p.copy", "On the hunt a remedy is taken whenever your health falls to 45% or less, the strongest first."),
        h("div.well.mt-4", h("div.stats", stat("Remedies held", "16"), stat("Strongest", "Gravemoss Poultice"))),
        h("div.card-foot", h("button.btn.btn-quiet", { type: "button" }, "Later"), h("button.btn.btn-gold", { type: "button" }, "Buy · 75g")))),
      block("List rows", h("section.card",
        cardHead("Out on a run"),
        h("div.list",
          h("div.list-row.stack-sm", art("ration", { tone: "good" }), h("div.lr-main", h("div.lr-title", "Bitter-Ash Salve"), h("div.lr-sub", "Restores 25 HP · 12 in Belongings")), h("div.lr-end", h("span.price", "5g", h("small", "each")), h("button.btn.btn-gold.btn-soft.btn-sm", { type: "button" }, "Buy"))),
          h("div.list-row", avatar("Ashlin Crowe", { size: "sm" }), h("div.lr-main", h("div.lr-title", "Ashlin Crowe"), h("div.lr-sub", "14 × Bog Ore, back at the daily reset")), h("div.lr-end", chip("6h 12m", null, "clock"))),
          h("div.list-row", art("coin", { tone: "gold", size: "sm" }), h("div.lr-main", h("div.lr-title", "Sold 5 Bog Bar to Thane"), h("div.lr-sub", "2h ago")), h("div.lr-end", h("span.price", "+67g"))))))),
    block("Section head and card grid (three across at most)", h("div.section",
      sectionHead("The roster", "Hiring is a gamble: every hire rolls its own rarity.", h("button.btn.btn-gold", { type: "button" }, "Hire an Agent · 250g")),
      h("div.grid-cards",
        agentCard({ name: "Tobin Marsh", rarity: "Common", yieldText: "Returns about 12 of whatever you ask for." }),
        agentCard({ name: "Edda Fell", rarity: "Epic", yieldText: "Returns about 48 of whatever you ask for." }),
        agentCard({ name: "Ashlin Crowe", rarity: "Rare", out: true, yieldText: "Returns about 30 of whatever you ask for." }),
        agentCard({ name: "Wren Hollow", rarity: "Uncommon", yieldText: "Returns about 19 of whatever you ask for." })))),
    block("Page head", stage(pageHead({ eyebrow: "The Camp", title: "Requisitions", sub: "Send Agents out for supplies. They return at the daily reset.", actions: h("button.btn.btn-primary", { type: "button" }, "Deploy") }))),
    block("Pick list", h("section.card", { style: { maxWidth: "380px" } }, h("div.pick-list", REGIONS.slice(0, 4).map((r) =>
      h("button.pick-row", { type: "button", class: { "is-current": r.state === "here", "is-locked": !r.state, "is-selected": r.selected }, "aria-selected": r.selected ? "true" : "false" },
        h("span.region-tier", r.tier), h("span.lr-main", h("span.region-name", r.name), h("span.region-sub", r.sub)),
        r.state === "here" ? tag("Here", "violet") : r.state === "open" ? tag("Open", "good") : h("span.region-toll", ic("lock"), fmtGold(r.toll))))))));
}

function galleryPills() {
  return section("pills", "Item pills",
    "One full-width pill per node or recipe. The name is the button and covers the pill; the (i) opens stats before you commit. On phones the stats wrap under the name.",
    h("div.pills",
      itemPill({ name: "Bog Ore", iconName: "ore", state: "working", pct: 36, tip: nodeTip("Bog Ore"),
        sub: [h("span", "Working"), h("span", h("b", "42"), " of 200"), h("span", "1h 12m left")],
        stats: [chip("16s", null, "clock"), chip("3 XP", "violet"), chip("147 held")] }),
      itemPill({ name: "Coal", iconName: "coalIco", tip: nodeTip("Coal"), sub: "The reagent every bar asks for", stats: [chip("16s", null, "clock"), chip("3 XP", "violet"), chip("30 held")] }),
      itemPill({ name: "Cairn Steel", iconName: "ore", state: "locked", sub: [ic("lock"), "Needs Delving Lv 30"], stats: [chip("32s", null, "clock"), chip("10 XP", "violet")] }),
      itemPill({ name: "Bog Sword", iconName: "blade", tip: craftTip("Bog Sword", ["Attack", "Crit", "Durab."]), sub: "Rarity is rolled when it is made",
        stats: [need("blade", "Bog Blade", 4, 1), need("log", "Blood Ash Handle", 2, 1), chip("48s", null, "clock")] }),
      itemPill({ name: "Bog Greatsword", iconName: "greatblade", state: "short", tip: craftTip("Bog Greatsword", ["Attack", "Crit", "Durab."]), sub: "Missing Bog Great Blade",
        stats: [need("greatblade", "Bog Great Blade", 0, 1), need("hide", "Bristle Binding", 3, 1)] }),
      itemPill({ name: "Outer · The Ashen Verge", iconName: "zoneOuter", tone: "ember", state: "working", pct: 70, sub: "Hunting · 12 kills", stats: [chip("×1 XP"), chip("Threat 12", "ember")] })));
}

function gallerySlots() {
  return section("slots", "Storage slots",
    "Five across (four on narrow phones). Rarity shows on the edge and the icon; the corner shows the stack, or wear for gear and tools.",
    h("section.card", h("div.vstack.gap-3",
      h("div.capacity", h("span", "Capacity"), h("b", "12 / 15"), bar(80, "bar-thin")),
      h("div.slot-grid",
        [STOCK[0], STOCK[2], STOCK[13], STOCK[17], STOCK[18], STOCK[19], STOCK[20], STOCK[21], STOCK[22], STOCK[23], BELONGINGS[0], STOCK[11]].map(slot),
        h("div.slot.is-dragover", { "aria-hidden": "true" }), slot(null), slot(null)))));
}

function galleryOverlays() {
  const tipCorner = (style, placement, label) => h("button.btn.btn-sm", { type: "button", style, "data-tip": `${label}: the tooltip flips and stays inside the screen, max 320px wide.`, "data-tip-placement": placement }, label);
  const richAnchor = h("button.btn.btn-sm", { type: "button", style: { left: "50%", top: "50%", transform: "translate(-50%, -50%)" } }, ic("info"), "Rich tooltip");
  tooltip(richAnchor, craftTip("Bog Sword", ["Attack", "Crit", "Durab."]), { placement: "top" });

  return section("overlays", "Dialogs, sheets, toasts, tooltips",
    "<code>openModal</code> is a centred dialog here and a bottom sheet on phones. <code>confirm</code> guards every gold spend. <code>toast</code> stacks four at most. Tooltips open on hover or focus, and on tap for touch.",
    block("Try them", stage(row(
      h("button.btn.btn-primary", { type: "button", id: "demoAction", onClick: () => PAGES_MODALS.action() }, "Action popup"),
      h("button.btn", { type: "button", id: "demoItem", onClick: () => PAGES_MODALS.item() }, "Item popup"),
      h("button.btn", { type: "button", onClick: () => PAGES_MODALS.stack() }, "Item popup, a stack"),
      h("button.btn.btn-gold", { type: "button", id: "demoBuy", onClick: () => PAGES_MODALS.buy() }, "Confirm a spend"),
      h("button.btn.btn-gold.btn-soft", { type: "button", id: "demoShort", onClick: () => PAGES_MODALS.short() }, "Confirm, can't afford"),
      h("button.btn.btn-danger.btn-soft", { type: "button", id: "demoReset", onClick: () => PAGES_MODALS.reset() }, "Type RESET"),
      h("button.btn", { type: "button", onClick: () => PAGES_MODALS.sell() }, "Sell dialog"),
      h("button.btn", { type: "button", onClick: () => PAGES_MODALS.settings() }, "Settings"),
      h("button.btn", { type: "button", onClick: () => PAGES_MODALS.class() }, "Discipline picker")),
    h("div.mt-4", row(
      h("button.btn.btn-sm", { type: "button", id: "demoToasts", onClick: () => {
        toast("Your crews brought up 12 Bog Ore", { kind: "info", icon: "ore" });
        setTimeout(() => toast("Delving reached level 25", { kind: "good", icon: "sparkle" }), 150);
        setTimeout(() => toast("The Stockpile is nearly full", { kind: "warn" }), 300);
        setTimeout(() => toast("You fell in the Core of Gallowmoor", { kind: "bad", icon: "skull" }), 450);
        setTimeout(() => toast("Bounty paid: 27g", { kind: "gold", action: { label: "View", onClick: () => {} } }), 600);
      } }, "Five toasts"),
      h("button.btn.btn-sm", { type: "button", onClick: () => toast("Stays until you click it", { ms: 0 }) }, "A toast that stays"),
      h("span.small.muted", { tabindex: "0", "data-tip": "Plain text tips need only data-tip." }, "Hover or focus me"))))),
    block("Tooltips near the edges", h("div.kit-stage.kit-corners",
      tipCorner({ left: "0", top: "0" }, "top", "Top left"),
      tipCorner({ right: "0", top: "0" }, "right", "Top right"),
      tipCorner({ left: "0", bottom: "0" }, "left", "Bottom left"),
      tipCorner({ right: "0", bottom: "0" }, "bottom", "Bottom right"),
      richAnchor)),
    block("Phone sheets, live: the real pages at 390px with the item popup and a gold confirm open",
      h("div.kit-row", { style: { alignItems: "flex-start" } },
        h("iframe.kit-phone", { src: "dev/kit.html?page=storage&modal=item&shot=1", title: "Phone sheet preview", loading: "lazy", width: "390", height: "760" }),
        h("iframe.kit-phone", { src: "dev/kit.html?page=shop&modal=buy&shot=1", title: "Phone confirm preview", loading: "lazy", width: "390", height: "760" }))),
    h("div.kit-cols.kit-static",
      block("A dialog, as it looks", h("div.modal.modal-sm", { role: "presentation" },
        h("div.modal-head", art("coin", { tone: "gold", size: "lg" }), h("div.modal-titles", h("div.modal-title", "Buy 5 × Star-Steel Tonic?"), h("p.modal-sub", "They go straight into Belongings."))),
        h("div.modal-body",
          h("div.cost",
            h("div.cost-row.is-price", h("span.l", "Costs"), h("span.v", ic("coin"), "700g")),
            h("div.cost-row", h("span.l", "Your gold"), h("span.v", "1,234g")),
            h("div.cost-row.is-left", h("span.l", "Left after"), h("span.v", "534g")))),
        h("div.modal-foot", h("button.btn.btn-quiet", { type: "button" }, "Cancel"), h("button.btn.btn-gold", { type: "button" }, "Buy for 700g")))),
      block("Toasts, as they look", h("div.kit-toasts",
        ["info", "good", "warn", "bad", "gold"].map((kind, i) => h("div.toast", { "data-kind": kind },
          h("span.toast-ico", ic({ info: "ore", good: "sparkle", warn: "warn", bad: "skull", gold: "coin" }[kind])),
          h("div.toast-text", ["Your crews brought up 12 Bog Ore", "Delving reached level 25", "The Stockpile is nearly full", "You fell in the Core of Gallowmoor", "Bounty paid: 27g"][i]),
          kind === "gold" ? h("button.toast-action", { type: "button" }, "View") : h("span"),
          h("span.toast-timer"))))),
      block("A rich tooltip, as it looks", h("div.tip.is-rich.is-open", masteryTip())),
      block("Crafted stats, as they look", h("div.tip.is-rich.is-open", craftTip("Bog Sword", ["Attack", "Crit", "Durab."])()))));
}

async function galleryShell() {
  const doc = await loadShell();
  const proto = doc.getElementById("topbar");
  const frame = (label, opts) => {
    const tb = proto.cloneNode(true);
    tb.removeAttribute("id");
    qsa("[id]", tb).forEach((n) => n.removeAttribute("id"));
    fillTopbar(tb, opts);
    return block(label, h("div.kit-frame", document.importNode(tb, true)));
  };

  const side = h("div.kit-side", h("nav.nav", { "aria-label": "Sample navigation" }, NAV.map((g) =>
    h("section.nav-group", h("h3.nav-head", g.id === "Vanguard" ? "The Vanguard" : g.id === "Camp" ? "The Camp" : g.id === "Field" ? "The Field" : g.id === "Realm" ? "The Realm" : g.id),
      h("ul.nav-list", { "data-nav-list": g.id }, g.items.map((it) => navItem(it, "#/skill/delving")))))),
  h("div.side-foot", h("div.weather", weatherCard())));

  return section("shell", "The shell",
    "The real topbar from <code>index.html</code>, filled for each state. It follows the viewport: full on desktop, compact with a health line on phones.",
    frame("Crews idle, hunt idle, guest", { bench: "idle", hunt: "idle", conn: "guest", crumbs: ["The Vanguard", "Character"] }),
    frame("Crafting, hunting, online", { bench: "crafting", hunt: "hunting", conn: "online", crumbs: ["Artisans", "Forgemaster"] }),
    frame("Working, recovering, syncing", { bench: "working", hunt: "recovering", conn: "syncing", crumbs: ["Trades", "Delving"] }),
    frame("Working, hiding, offline", { bench: "working", hunt: "hiding", conn: "offline", crumbs: ["The Field", "Hunt"] }),
    block("Connection indicator", stage(row(
      ["online", "syncing", "offline", "guest"].map((s) => h("button.conn", { type: "button", "data-state": s }, h("span.conn-dot"), h("span", CONN[s])))))),
    block("Sidebar: groups, the current page, levels and counts, a working dot, badges, the weather", side));
}

function galleryFeedback() {
  return section("feedback", "Empty, loading, banners, the log",
    "Say what is missing and what to do about it. Skeletons keep the shape of what is coming.",
    h("div.banner", { role: "status" },
      h("span.banner-ico", ic("cloud")),
      h("div.banner-text", h("b", "You are playing as a guest"), "Nothing is kept once this tab closes."),
      h("div.banner-actions", h("button.btn.btn-gold.btn-sm", { type: "button" }, "Sign in"))),
    h("div.kit-cols.mt-4",
      h("section.card", empty({ iconName: "search", title: "No listings match", text: "Nobody is selling Wyrm Plank right now.", action: h("button.btn.btn-sm", { type: "button" }, "Clear filters") })),
      h("section.card", empty({ iconName: "stockpile", title: "The Stockpile is bare", text: "Set a crew to work and it fills up on its own.", small: true })),
      h("section.card",
        cardHead("Loading", { actions: h("span.spinner", { role: "status", "aria-label": "Loading" }) }),
        h("div.vstack.gap-3", [0, 1].map(() => h("div.hstack.gap-3", h("span.skel.skel-art"), h("div.grow", h("span.skel.skel-line", { style: { width: "60%" } }), h("span.skel.skel-line", { style: { width: "35%" } }))))),
        h("div.loading", h("span.spinner.spinner-sm"), "Asking the realm"))),
    block("The crews and the hunt, idle", h("div.grid-cards.max-2",
      h("article.card.act-card.is-idle",
        h("div.act-card-top", art("hammer", { tone: "neutral" }), h("div.grow", h("div.eyebrow", "The crews"), h("h2.card-title", "No crews at work"))),
        h("p.act-card-idle", "Your people are standing around. Set them to a seam, a stand of timber or the bench."),
        h("div", h("a.btn.btn-sm", { href: "#/skill/delving" }, "Open Delving", ic("arrow-right")))),
      h("article.card.act-card.is-idle", { "data-tone": "ember" },
        h("div.act-card-top", art("heart", { tone: "ember" }), h("div.grow", h("div.eyebrow", "The hunt"), h("h2.card-title", "Recovering"))),
        bar(64, "bar-striped"),
        h("div.act-card-meta", h("span", "You fell in the Core of Gallowmoor"), h("b", "Back in 3m 12s"))))),
    block("The arena, quiet and recovering", h("section.card.hunt-card",
      h("div.arena",
        h("div.arena-you.is-down",
          h("div.fx-layer"),
          h("div.portrait.arena-portrait", h("img", { src: "assets/commander-default.webp", alt: "" })),
          h("div.arena-name", ME.name),
          h("div.hpbar", h("i", { style: { width: "16%" } }), h("span", "18 / 112")),
          h("div.veilbar.is-locked", h("i", { style: { width: "0%" } })),
          h("div.veil-note", "The Veil opens at Hunt 5")),
        h("div.arena-mid", h("div.arena-vs", { "aria-hidden": "true" }, "VS"), h("div.arena-status", "Recovering"), h("div.arena-timer", "Back in 3m 12s")),
        h("div.arena-foes", h("div.foe-empty", h("span.foe-empty-title", "The Inner lies quiet"), h("span.foe-empty-sub", "You are in no state to hunt.")))),
      h("div.hunt-foot",
        h("p.hunt-hint", "Choose a zone below to take up the hunt."),
        h("div.hunt-actions", h("button.btn.btn-ember", { type: "button", disabled: true }, "Recovering"))))),
    block("Camp log", h("section.card", logList(LOG))));
}

function galleryData() {
  return section("data", "Tables, people, chat",
    "Hiscores, party members and chat.",
    h("section.card.card-flush",
      h("div.table-wrap", { style: { margin: 0, padding: "12px 0 4px" } },
        h("table.table",
          h("thead", h("tr", h("th", "Rank"), h("th", "Commander"), h("th.num", "Level"), h("th.num", "XP"))),
          h("tbody", BOARD.slice(0, 4).concat([BOARD[6]]).map(([name, lv, xp, me], i) => h("tr", { class: me && "is-me" },
            h("td", h("span.hs-rank", { class: i < 3 && `is-${i + 1}` }, me ? 7 : i + 1)),
            h("td.strong", h("span.hs-name", avatar(name, { size: "sm" }), name, me ? tag("You", "violet") : null)),
            h("td.num", lv), h("td.num", xp))))))),
    h("div.grid-cards.max-2.mt-4",
      member({ name: "Thane", lv: 164, dot: "online", doing: "Hunting the Inner of Gallowmoor · 1h 04m", doingTone: "ember", doingIcon: "swords", bonus: chip("Counts toward your bonus", "good", "check") }),
      member({ name: "Ashlin", lv: 92, dot: "offline", doing: "Last seen 2h ago", doingIcon: "clock", bonus: chip("Offline") })),
    h("section.card.card-flush.chat.mt-4",
      h("ol.chat-log", { style: { height: "auto", borderTop: 0 } },
        h("li.msg", avatar("Thane", { size: "sm" }), h("div", h("div.msg-meta", h("b", "Thane"), h("time", "14m")), h("p.msg-text", "Inner is thick with Stalkers tonight. Bring poultices."))),
        h("li.msg.is-own", h("div", h("div.msg-meta", h("time", "6m")), h("p.msg-text", "I have 30 spare Coal. Mailing them over after this run.")))),
      h("form.composer", { onSubmit: (e) => e.preventDefault() },
        h("div.input-wrap", h("input.input", { placeholder: "Say something to the party", maxlength: "240", "aria-label": "Message" })),
        h("span.composer-count", "0/240"),
        h("button.btn.btn-primary.btn-icon", { type: "submit", "aria-label": "Send" }, ic("send")))));
}

function galleryPages() {
  const list = [
    ["character", "person", "Character"], ["gather", "pick", "Gathering: Delving"], ["bench", "plate", "Artisan: Forgemaster"],
    ["storage", "stockpile", "Stockpile"], ["armaments", "plate", "Armaments"], ["hunt", "swords", "Hunt"], ["atlas", "atlas", "Atlas"],
    ["shop", "shop", "Shop"], ["bounties", "scroll", "Bounties"], ["requisitions", "crate", "Requisitions"], ["companions", "paw", "Companions"],
    ["sky", "sky", "Sky"], ["market", "market", "Market"], ["party", "party", "Party"], ["hiscores", "trophy", "Hiscores"], ["states", "cloud", "States"],
  ];
  return section("pages", "Pages in the shell",
    "Each opens inside the real <code>index.html</code> shell. Add <code>&amp;modal=action</code>, <code>item</code>, <code>stack</code>, <code>sell</code>, <code>settings</code>, <code>account</code>, <code>class</code>, <code>buy</code>, <code>short</code> or <code>reset</code> to open a popup, and <code>&amp;hunt=recovering</code> or <code>&amp;conn=guest</code> to change the topbar.",
    h("div.kit-pages", list.map(([page, iconName, label]) => h("a.kit-page-link", { href: `dev/kit.html?page=${page}` },
      art(iconName, { size: "sm" }), h("span", label, h("small", `?page=${page}`))))));
}

async function bootGallery() {
  const root = el("kit");
  root.classList.add("kit");

  // Sample links point at game routes; in the gallery they go nowhere.
  on(document, "click", 'a[href^="#/"]', (e) => e.preventDefault());
  const shell = await galleryShell();
  const sections = [galleryTokens(), galleryIcons(), galleryButtons(), galleryForms(), galleryChips(), galleryBars(), galleryCards(),
    galleryPills(), gallerySlots(), galleryOverlays(), shell, galleryFeedback(), galleryData(), galleryPages()];

  root.append(
    h("header.kit-top", h("img", { src: "assets/respite-logo.webp", alt: "" }), h("div", h("h1", "Respite UI Kit"), h("p", "v5 · every component, every state, drawn with the real CSS and helpers."))),
    h("nav.kit-toc", { "aria-label": "Kit sections" }, sections.map((s) => h("a.chip", { href: `dev/kit.html#${s.id}`, onClick: (e) => { e.preventDefault(); s.scrollIntoView(); } }, qs("h2", s).textContent))),
    ...sections);

  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
  }
}

/* ================= 10. BOOT ================= */

window.kit = { PAGES, PAGES_MODALS, openModal, confirm, toast, closeModals };

(params.get("page") ? bootPage() : bootGallery()).then(() => {
  document.documentElement.dataset.kitReady = "1";
}).catch((err) => {
  console.error(err);
  document.body.appendChild(h("pre", { style: { color: "#eb9068", padding: "16px" } }, String(err && err.stack || err)));
});
