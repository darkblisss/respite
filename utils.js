/* ============================================================
   Respite · utils.js · The Toolbox
   ------------------------------------------------------------
   Small helpers that never read or write the save: DOM lookups,
   number and time formatting, seeded randomness, and the icon set.
   ============================================================ */

/* ================= 1. DOM ================= */

const el = (id) => document.getElementById(id);

// Only touches the DOM when the text actually changes.
function setText(node, text) {
  const value = String(text);
  if (node && node.textContent !== value) node.textContent = value;
}

/* ================= 2. NUMBERS & TIME ================= */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

function fmt(n) {
  n = Math.floor(n);
  if (Math.abs(n) < 10000) return n.toLocaleString();
  if (Math.abs(n) < 1e6) return (n / 1e3).toFixed(1) + "K";
  if (Math.abs(n) < 1e9) return (n / 1e6).toFixed(2) + "M";
  return (n / 1e9).toFixed(2) + "B";
}

function fmtTime(ms) {
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// Gold with its unit: "1,600g", "44,800g", "1.25M gold". Never "44.8Kg".
function fmtGold(n) {
  n = Math.floor(n);
  return Math.abs(n) < 1e6 ? `${n.toLocaleString()}g` : `${fmt(n)} gold`;
}

// How long ago something happened: "Just now", "2m ago", "4h ago", "3d ago".
function fmtAgo(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// 18 -> "+18%", -18 -> "−18%" (true minus sign).
function signedPct(n) {
  if (!n) return "0%";
  return `${n > 0 ? "+" : "−"}${Math.abs(n)}%`;
}

// 0.0125 -> "1.25%", 0.5 -> "50%".
const chancePct = (chance) => `${+(chance * 100).toFixed(2)}%`;

function serverClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

/* ================= 3. TEXT ================= */

const LOWER_WORDS = ["of", "the", "and"];
function titleCase(s) {
  return String(s).split(" ").map((w, i) => {
    if (i > 0 && LOWER_WORDS.includes(w.toLowerCase())) return w.toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

/* ================= 4. RANDOMNESS ================= */

// Deterministic 0-1 from any number. Same input, same output, for everyone.
function seedFrom(n) {
  const x = Math.sin(n) * 10000;
  return x - Math.floor(x);
}

// randInt(min, max), but seeded: the same seed always gives the same whole number.
function seededInt(seed, min, max) {
  return min + Math.floor(seedFrom(seed) * (max - min + 1));
}

function rollRarity() {
  let r = Math.random();
  for (const rar of RARITIES) { if (r < rar.chance) return rar.key; r -= rar.chance; }
  return "common";
}

// A rarity of Uncommon or better, weighted the same way rollRarity() is.
function rollFineRarity() {
  const fine = RARITIES.filter((rar) => rar.key !== "common");
  let r = Math.random() * fine.reduce((n, rar) => n + rar.chance, 0);
  for (const rar of fine) { if (r < rar.chance) return rar.key; r -= rar.chance; }
  return "uncommon";
}

function rollPrefix(baseId) {
  const g = GEAR[baseId];
  const pool = (g && (g.slot === "weapon" || g.slot === "offhand")) ? WEAPON_PREFIXES : ARMOUR_PREFIXES;
  return pool[Math.floor(Math.random() * pool.length)].id;
}

function rollAgentRarity() {
  let r = Math.random();
  for (const a of AGENT_RARITIES) { if (r < a.chance) return a.key; r -= a.chance; }
  return "common";
}

/* ================= 5. XP ================= */

function levelFromXp(xp) {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= XP_TABLE[lvl + 1]) lvl++;
  return lvl;
}

// Bond level from bond earned. Thresholds live in data.js (bondXpFor).
function bondLevelFrom(bond) {
  let lvl = 1;
  while (lvl < COMPANION_MAX_BOND && bond >= bondXpFor(lvl + 1)) lvl++;
  return lvl;
}

/* ================= 6. ICONS (hand-drawn SVG, no external assets) ================= */

const ICONS = {
  moon: '<path d="M17 3a9 9 0 1 0 4 12 7 7 0 0 1-4-12Z"/><path d="M15 6.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7Z"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',

  // gathering
  pick:   '<path d="M4 20 14 10"/><path d="M6 8c4-3 9-3 13 1-5-1-8 0-9 1-1 1-2 4-1 9-4-4-4-8-3-11Z"/>',
  axe:    '<path d="M5 19 13 11"/><path d="M12 4c3-1 6 0 7 3s0 6-3 7l-2-2 1-2-4-4 1-2Z"/>',
  sickle: '<path d="M5 19c8-1 13-6 14-14"/><path d="M19 5c-6 0-10 4-10 9l4 1c0-4 2-8 6-10Z"/>',
  knife:  '<path d="M4 20 10 14"/><path d="M10 14 18 4l2 2-8 10-2-2Z"/>',
  net:    '<path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9-9 9 9 0 0 1-9-9 9 9 0 0 1 9-9Z"/><path d="M3 12h18M12 3v18M6 6l12 12M18 6 6 18"/>',

  // materials
  ore:    '<path d="M12 3 5 8v8l7 5 7-5V8l-7-5Z"/><path d="M12 3v8l7-3M12 11 5 8M12 11v10"/>',
  log:    '<path d="M7 6h10a3 3 0 0 1 0 12H7a3 3 0 0 1 0-12Z"/><path d="M7 6a3 3 0 0 0 0 12"/><circle cx="7" cy="12" r="1.6"/>',
  fibre:  '<path d="M12 21c0-6-3-9-6-11 4 0 6 2 6 5"/><path d="M12 21c0-7 3-10 6-12-4 0-6 3-6 6"/><path d="M12 21V9"/>',
  hide:   '<path d="M6 4c3 1 9 1 12 0 1 4 1 8-1 11-2 3-3 5-5 5s-3-2-5-5C5 12 5 8 6 4Z"/>',
  gem:    '<path d="M12 3 4 9l8 12 8-12-8-6Z"/><path d="M4 9h16M12 3l-4 6 4 12 4-12-4-6Z"/>',
  ration: '<path d="M5 9h14l-1.2 10a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/>',
  crate:  '<rect x="3" y="6" width="18" height="14" rx="1"/><path d="M3 11h18M9 6v14M15 6v14"/>',

  // gear
  blade:      '<path d="m5 19 3-3M6 18l-2 2"/><path d="M9 15 18 3l3 3-12 9-3 3-1-1 3-2Z"/>',
  greatblade: '<path d="M12 21v-4M8 17h8"/><path d="M12 17 8 8l4-5 4 5-4 9Z"/>',
  stave:      '<path d="M7 21 17 6"/><path d="M17 6a3 3 0 1 0 0-.1Z"/><path d="M15.5 2.5 17 5l2.5-1L18 6.5"/>',
  ward:       '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/><path d="M12 8v7M9 11h6"/>',
  plate:      '<path d="M8 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6l-4-3-4 2-4-2Z"/><path d="M12 5v16"/>',
  greaves:    '<path d="M8 3h8l-1 9-1 9h-3l-1-9-1-9Z"/><path d="M7.5 12h9"/>',
  treads:     '<path d="M4 15V5h5v5c0 2 2 3 4 4l4 2v3H4v-4Z"/><path d="M4 17h13"/>',
  gauntlets:  '<path d="M7 21V9a2 2 0 0 1 4 0V4a1.5 1.5 0 0 1 3 0v5a2 2 0 0 1 3 1.7V17a4 4 0 0 1-4 4H7Z"/>',
  cowl:       '<path d="M12 3c5 0 8 4 8 9 0 4-3 9-8 9s-8-5-8-9c0-5 3-9 8-9Z"/><path d="M8 12c1.5-1 6.5-1 8 0"/>',
  shroud:     '<path d="M9 3 5 7v14h14V7l-4-4-3 3-3-3Z"/><path d="M12 6v15"/>',
  band:       '<circle cx="12" cy="14" r="6"/><path d="m9 6 3-3 3 3-3-3Z"/>',
  charm:      '<path d="M7 3h10l-5 6-5-6Z"/><path d="M12 9a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/>',
  book:       '<path d="M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4Z"/><path d="M6 18a2 2 0 0 1 2-2h10"/><path d="M10 8h5M10 11h3"/>',

  // monsters
  beast:   '<path d="M4 8 6 3l4 3h4l4-3 2 5v5c0 4-4 7-8 7s-8-3-8-7V8Z"/><path d="M9 12h.01M15 12h.01M10 16h4"/>',
  man:     '<path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/><path d="M4 21c0-5 4-8 8-8s8 3 8 8"/>',
  golemMob:'<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M9 10h.01M15 10h.01M9 15h6"/>',
  horror:  '<path d="M12 3c5 0 9 4 9 9s-4 9-9 9-9-4-9-9 4-9 9-9Z"/><path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/><path d="M12 11.5a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1Z"/>',
  drakeMob:'<path d="M3 10c4-4 8-4 10-1 2-3 6-3 8 1-2 1-3 3-4 6-2 4-6 5-10 2 2-1 3-3 3-5-3 0-5-1-7-3Z"/>',

  // companions
  rat:      '<path d="M3 15c0-4 4-7 9-7 3 0 5 1 6.5 3l2.5 1-1.5 2.5c-1 1.5-3 2.5-5.5 2.5H8"/><circle cx="16.5" cy="11.5" r=".6"/><path d="M14 8.5a2 2 0 1 1 3-1.5"/><path d="M8 17.5c-3 0-5 .5-5 2.5"/><path d="M9 17.5 8 20M13 17.5l1 2.5"/>',
  crow:     '<path d="M4 13c3-5 8-7 13-6l3 1-3 2c-1 3-4 6-9 6l-4 4 1-5-1-2Z"/><circle cx="16" cy="9" r=".6"/><path d="M9 12c2 0 4-1 5-2"/>',
  marshcat: '<path d="M6 21v-7c0-3 2-5 5-5h2c3 0 5 2 5 5v7"/><path d="M7 10 6 4l4 3M17 10l1-6-4 3"/><path d="M10 12.5h.01M14 12.5h.01M11 15h2"/><path d="M18 18c2 0 3-1 3-3"/>',
  hound:    '<path d="M4 20v-6l2-5 3-2h3l2-3 1 3 3 1 3 3-1 2h-4l-2 2v5"/><circle cx="15.5" cy="8.5" r=".6"/><path d="M8 14v6M12 16v4"/>',
  stag:     '<path d="M9 21v-6l-2-3h10l-2 3v6"/><path d="M10.5 12 9 8M13.5 12 15 8"/><path d="M9 8 6 6M9 8 8 4M9 8 5 9M15 8l3-2M15 8l1-4M15 8l4 1"/><path d="M11 15h.01M13 15h.01"/>',

  // ui
  atlas:  '<path d="M9 4 3 7v13l6-3 6 3 6-3V4l-6 3-6-3Z"/><path d="M9 4v13M15 7v13"/>',
  shop:   '<path d="M4 8h16l-1 12H5L4 8Z"/><path d="M4 8 6 4h12l2 4"/><path d="M9 12a3 3 0 0 0 6 0"/>',
  scroll: '<path d="M6 3h10a2 2 0 0 1 2 2v14a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  pack:   '<path d="M6 8h12l1 13H5L6 8Z"/><path d="M9 8V5a3 3 0 0 1 6 0v3"/><path d="M9 13h6"/>',
  person: '<path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>',
  paw:    '<circle cx="7" cy="9" r="2"/><circle cx="12" cy="6.5" r="2"/><circle cx="17" cy="9" r="2"/><path d="M12 11c3 0 5 2.5 5 5a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3c0-2.5 2-5 5-5Z"/>',
  swords: '<path d="m4 4 9 9M14 14l6 6M18 4l-9 9M10 14l-6 6"/>',
  info:   '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
  lock:   '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',

  // weather
  rain:   '<path d="M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 2A3.5 3.5 0 0 1 17 15H7Z"/><path d="M8 18v2M12 18v3M16 18v2"/>',
  sun:    '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"/>',
  fog:    '<path d="M3 8h14M6 12h15M3 16h13M7 20h11"/>',
  wind:   '<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 13h15a3 3 0 1 1-3 3"/><path d="M3 17h6"/>',
  frost:  '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="m9.5 4.5 2.5 2 2.5-2M9.5 19.5l2.5-2 2.5 2"/>',
  unknown:'<circle cx="12" cy="12" r="8"/><path d="M12 16h.01M9.5 9.5a2.5 2.5 0 1 1 3 3.5"/>',

  // reagents
  coalIco:   '<path d="M8 4 4 9l3 10h10l3-10-4-5H8Z"/><path d="M10 9h4l1 5h-6l1-5Z"/>',
  resinIco:  '<path d="M12 3c3 5 5 7.5 5 10a5 5 0 0 1-10 0c0-2.5 2-5 5-10Z"/><path d="M10.5 14a1.5 1.5 0 0 0 3 0"/>',
  pulpIco:   '<path d="M5 6h11l3 3v9H5V6Z"/><path d="M16 6v3h3M8 12h8M8 15h6"/>',
  tallowIco: '<path d="M7 10h10v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9Z"/><path d="M12 10V6M12 3c1.5 1.5 1.5 3 0 3s-1.5-1.5 0-3Z"/>',
  shardIco:  '<path d="m12 2 4 7-4 13-4-13 4-7Z"/><path d="M8 9h8"/>',
};

function icon(name, cls) {
  const body = ICONS[name] || ICONS.unknown;
  return `<svg class="ico ${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
