/* ============================================================
   Respite · icons.js · The Glyphs
   ------------------------------------------------------------
   Hand-drawn 24 by 24 stroke icons, no external assets. Every
   v4 name is kept. icon() gives an SVG string for templates and
   h({ html }); iconEl() gives a ready element. Both carry the
   class "ico" (20px) plus whatever size class you pass.
   ============================================================ */

import { h, html } from "./dom.js";

// A bone laid on the diagonal, for the Bonesetter. The knobs meet the shaft exactly.
const BONE = '<path transform="rotate(-45 12 12)" d="M7.82 10.7H16.18A2.1 2.1 0 1 1 19.3 12 2.1 2.1 0 1 1 16.18 13.3H7.82A2.1 2.1 0 1 1 4.7 12 2.1 2.1 0 1 1 7.82 10.7Z"/>';
const CLOUD = '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4-1 5 5 0 0 1-.3 10H7Z"/>';

export const ICONS = {
  moon: '<path d="M17 3a9 9 0 1 0 4 12 7 7 0 0 1-4-12Z"/><path d="M15 6.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7Z"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',

  // ---- gathering ----
pick: '<path d="M4 12a9 9 0 0 1 16 0"/><path d="M12 9v12"/>',
  axe: '<path d="M5 19 13 11"/><path d="M12 4c3-1 6 0 7 3s0 6-3 7l-2-2 1-2-4-4 1-2Z"/>',
  sickle: '<path d="M5 19c8-1 13-6 14-14"/><path d="M19 5c-6 0-10 4-10 9l4 1c0-4 2-8 6-10Z"/>',
  knife: '<path d="M4 20 10 14"/><path d="M10 14 18 4l2 2-8 10-2-2Z"/>',
  net: '<path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9-9 9 9 0 0 1-9-9 9 9 0 0 1 9-9Z"/><path d="M3 12h18M12 3v18M6 6l12 12M18 6 6 18"/>',

  // ---- materials ----
  ore: '<path d="M12 3 5 8v8l7 5 7-5V8l-7-5Z"/><path d="M12 3v8l7-3M12 11 5 8M12 11v10"/>',
  log: '<path d="M7 6h10a3 3 0 0 1 0 12H7a3 3 0 0 1 0-12Z"/><path d="M7 6a3 3 0 0 0 0 12"/><circle cx="7" cy="12" r="1.6"/>',
  fibre: '<path d="M12 21c0-6-3-9-6-11 4 0 6 2 6 5"/><path d="M12 21c0-7 3-10 6-12-4 0-6 3-6 6"/><path d="M12 21V9"/>',
  hide: '<path d="M6 4c3 1 9 1 12 0 1 4 1 8-1 11-2 3-3 5-5 5s-3-2-5-5C5 12 5 8 6 4Z"/>',
  gem: '<path d="M12 3 4 9l8 12 8-12-8-6Z"/><path d="M4 9h16M12 3l-4 6 4 12 4-12-4-6Z"/>',
  ration: '<path d="M5 9h14l-1.2 10a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/>',
  crate: '<rect x="3" y="6" width="18" height="14" rx="1"/><path d="M3 11h18M9 6v14M15 6v14"/>',

  // ---- gear ----
  blade: '<path d="m5 19 3-3M6 18l-2 2"/><path d="M9 15 18 3l3 3-12 9-3 3-1-1 3-2Z"/>',
  greatblade: '<path d="M12 21v-4M8 17h8"/><path d="M12 17 8 8l4-5 4 5-4 9Z"/>',
  stave: '<path d="M7 21 17 6"/><path d="M17 6a3 3 0 1 0 0-.1Z"/><path d="M15.5 2.5 17 5l2.5-1L18 6.5"/>',
  ward: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/><path d="M12 8v7M9 11h6"/>',
  plate: '<path d="M8 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6l-4-3-4 2-4-2Z"/><path d="M12 5v16"/>',
  greaves: '<path d="M8 3h8l-1 9-1 9h-3l-1-9-1-9Z"/><path d="M7.5 12h9"/>',
  treads: '<path d="M4 15V5h5v5c0 2 2 3 4 4l4 2v3H4v-4Z"/><path d="M4 17h13"/>',
  gauntlets: '<path d="M7 21V9a2 2 0 0 1 4 0V4a1.5 1.5 0 0 1 3 0v5a2 2 0 0 1 3 1.7V17a4 4 0 0 1-4 4H7Z"/>',
  cowl: '<path d="M12 3c5 0 8 4 8 9 0 4-3 9-8 9s-8-5-8-9c0-5 3-9 8-9Z"/><path d="M8 12c1.5-1 6.5-1 8 0"/>',
  shroud: '<path d="M9 3 5 7v14h14V7l-4-4-3 3-3-3Z"/><path d="M12 6v15"/>',
  band: '<circle cx="12" cy="14" r="6"/><path d="m9 6 3-3 3 3-3-3Z"/>',
  charm: '<path d="M7 3h10l-5 6-5-6Z"/><path d="M12 9a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/>',
  book: '<path d="M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4Z"/><path d="M6 18a2 2 0 0 1 2-2h10"/><path d="M10 8h5M10 11h3"/>',

  // ---- monsters ----
  beast: '<path d="M4 8 6 3l4 3h4l4-3 2 5v5c0 4-4 7-8 7s-8-3-8-7V8Z"/><path d="M9 12h.01M15 12h.01M10 16h4"/>',
  man: '<path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/><path d="M4 21c0-5 4-8 8-8s8 3 8 8"/>',
  golemMob: '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M9 10h.01M15 10h.01M9 15h6"/>',
  horror: '<path d="M12 3c5 0 9 4 9 9s-4 9-9 9-9-4-9-9 4-9 9-9Z"/><path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/><path d="M12 11.5a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1Z"/>',
  drakeMob: '<path d="M3 10c4-4 8-4 10-1 2-3 6-3 8 1-2 1-3 3-4 6-2 4-6 5-10 2 2-1 3-3 3-5-3 0-5-1-7-3Z"/>',

  // ---- companions ----
  rat: '<path d="M3 15c0-4 4-7 9-7 3 0 5 1 6.5 3l2.5 1-1.5 2.5c-1 1.5-3 2.5-5.5 2.5H8"/><circle cx="16.5" cy="11.5" r=".6"/><path d="M14 8.5a2 2 0 1 1 3-1.5"/><path d="M8 17.5c-3 0-5 .5-5 2.5"/><path d="M9 17.5 8 20M13 17.5l1 2.5"/>',
  crow: '<path d="M4 13c3-5 8-7 13-6l3 1-3 2c-1 3-4 6-9 6l-4 4 1-5-1-2Z"/><circle cx="16" cy="9" r=".6"/><path d="M9 12c2 0 4-1 5-2"/>',
  marshcat: '<path d="M6 21v-7c0-3 2-5 5-5h2c3 0 5 2 5 5v7"/><path d="M7 10 6 4l4 3M17 10l1-6-4 3"/><path d="M10 12.5h.01M14 12.5h.01M11 15h2"/><path d="M18 18c2 0 3-1 3-3"/>',
  hound: '<path d="M4 20v-6l2-5 3-2h3l2-3 1 3 3 1 3 3-1 2h-4l-2 2v5"/><circle cx="15.5" cy="8.5" r=".6"/><path d="M8 14v6M12 16v4"/>',
  stag: '<path d="M9 21v-6l-2-3h10l-2 3v6"/><path d="M10.5 12 9 8M13.5 12 15 8"/><path d="M9 8 6 6M9 8 8 4M9 8 5 9M15 8l3-2M15 8l1-4M15 8l4 1"/><path d="M11 15h.01M13 15h.01"/>',

  // ---- ui (v4) ----
  atlas: '<path d="M9 4 3 7v13l6-3 6 3 6-3V4l-6 3-6-3Z"/><path d="M9 4v13M15 7v13"/>',
  shop: '<path d="M4 8h16l-1 12H5L4 8Z"/><path d="M4 8 6 4h12l2 4"/><path d="M9 12a3 3 0 0 0 6 0"/>',
  scroll: '<path d="M6 3h10a2 2 0 0 1 2 2v14a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  pack: '<path d="M6 8h12l1 13H5L6 8Z"/><path d="M9 8V5a3 3 0 0 1 6 0v3"/><path d="M9 13h6"/>',
  person: '<path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>',
  paw: '<circle cx="7" cy="9" r="2"/><circle cx="12" cy="6.5" r="2"/><circle cx="17" cy="9" r="2"/><path d="M12 11c3 0 5 2.5 5 5a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3c0-2.5 2-5 5-5Z"/>',
  swords: '<path d="m4 4 9 9M14 14l6 6M18 4l-9 9M10 14l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',

  // ---- hunt zones: rings closing in on the heart of a region ----
  zoneOuter: '<circle cx="12" cy="12" r="9" stroke-dasharray="2.5 2.5"/><circle cx="12" cy="12" r="1.2"/>',
  zoneMiddle: '<circle cx="12" cy="12" r="9" stroke-dasharray="2.5 2.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.2"/>',
  zoneInner: '<circle cx="12" cy="12" r="9" stroke-dasharray="2.5 2.5"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="1"/>',
  zoneCore: '<circle cx="12" cy="12" r="9" stroke-dasharray="2.5 2.5"/><circle cx="12" cy="12" r="6"/><path d="M12 8.2 15.3 12 12 15.8 8.7 12Z" fill="currentColor"/>',

  // ---- weather ----
  rain: '<path d="M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 2A3.5 3.5 0 0 1 17 15H7Z"/><path d="M8 18v2M12 18v3M16 18v2"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"/>',
  fog: '<path d="M3 8h14M6 12h15M3 16h13M7 20h11"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 13h15a3 3 0 1 1-3 3"/><path d="M3 17h6"/>',
  frost: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="m9.5 4.5 2.5 2 2.5-2M9.5 19.5l2.5-2 2.5 2"/>',
  unknown: '<circle cx="12" cy="12" r="8"/><path d="M12 16h.01M9.5 9.5a2.5 2.5 0 1 1 3 3.5"/>',

  // ---- reagents ----
  coalIco: '<path d="M8 4 4 9l3 10h10l3-10-4-5H8Z"/><path d="M10 9h4l1 5h-6l1-5Z"/>',
  resinIco: '<path d="M12 3c3 5 5 7.5 5 10a5 5 0 0 1-10 0c0-2.5 2-5 5-10Z"/><path d="M10.5 14a1.5 1.5 0 0 0 3 0"/>',
  pulpIco: '<path d="M5 6h11l3 3v9H5V6Z"/><path d="M16 6v3h3M8 12h8M8 15h6"/>',
  tallowIco: '<path d="M7 10h10v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9Z"/><path d="M12 10V6M12 3c1.5 1.5 1.5 3 0 3s-1.5-1.5 0-3Z"/>',
  shardIco: '<path d="m12 2 4 7-4 13-4-13 4-7Z"/><path d="M8 9h8"/>',

  // ---- the realm (v5) ----
  market: '<path d="M12 4.5v15M8.5 19.5h7M4 7.5h16"/><path d="M6 7.5 3 13.5M6 7.5l3 6M18 7.5l-3 6M18 7.5l3 6"/><path d="M3 13.5h6a3 3 0 0 1-6 0ZM15 13.5h6a3 3 0 0 1-6 0Z"/><circle cx="12" cy="3.6" r=".9"/>',
  party: '<circle cx="12" cy="7.5" r="2.8"/><path d="M7 19.5c0-3 2.2-5.5 5-5.5s5 2.5 5 5.5"/><circle cx="5.6" cy="9.6" r="2"/><path d="M2 18.5c0-2.4 1.5-4.2 3.6-4.2.9 0 1.6.3 2.2.8"/><circle cx="18.4" cy="9.6" r="2"/><path d="M22 18.5c0-2.4-1.5-4.2-3.6-4.2-.9 0-1.6.3-2.2.8"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5.5a2.5 2.5 0 0 0 2.6 3.9M16 6h2.5a2.5 2.5 0 0 1-2.6 3.9"/><path d="M12 13v3.5M8.5 20h7M9.5 20c0-2 1-3.5 2.5-3.5s2.5 1.5 2.5 3.5"/>',
  chat: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4.5 3.5V16H6a2 2 0 0 1-2-2V6Z"/><path d="M8 9h8M8 12h5"/>',
  send: '<path d="M20.5 3.5 3.5 10.2l6.8 2.9 2.9 6.9 7.3-16.5Z"/><path d="M10.3 13.1 20.5 3.5"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.8 7 8.2 6.2L20.2 7"/>',
  online: '<circle cx="12" cy="12" r="1.8"/><path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4"/><path d="M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 5.5a9.2 9.2 0 0 1 0 13"/>',
  sync: '<path d="M19.5 10A7.5 7.5 0 0 0 6.2 6.4L4.5 8"/><path d="M4.5 4v4h4"/><path d="M4.5 14a7.5 7.5 0 0 0 13.3 3.6l1.7-1.6"/><path d="M19.5 20v-4h-4"/>',
  cloud: CLOUD,
  offline: CLOUD + '<path d="M3.5 3.5l17 17"/>',
  logout: '<path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10"/><path d="M15 8l4 4-4 4M19 12H9.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  "chevron-down": '<path d="M6 9.5l6 6 6-6"/>',
  "chevron-right": '<path d="M9.5 6l6 6-6 6"/>',
  "chevron-left": '<path d="M14.5 6l-6 6 6 6"/>',
  "chevron-up": '<path d="M6 14.5l6-6 6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/>',
  filter: '<path d="M4 5h16l-6.2 7.6V19l-3.6 1.8v-8.2L4 5Z"/>',
  sort: '<path d="M8 19V5M4.5 8.5 8 5l3.5 3.5"/><path d="M16 5v14M12.5 15.5 16 19l3.5-3.5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  "eye-off": '<path d="M3.5 3.5l17 17"/><path d="M10.6 5.6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.3M6.6 6.7C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/>',
  shield: '<path d="M12 3 5 6v6c0 4.2 3 7.5 7 9 4-1.5 7-4.8 7-9V6l-7-3Z"/>',
  sparkle: '<path d="M11 3c.7 4.6 2.2 6.3 6.5 7-4.3.7-5.8 2.4-6.5 7-.7-4.6-2.2-6.3-6.5-7 4.3-.7 5.8-2.4 6.5-7Z"/><path d="M18.5 14.5c.3 1.7.9 2.3 2.5 2.5-1.6.2-2.2.8-2.5 2.5-.3-1.7-.9-2.3-2.5-2.5 1.6-.2 2.2-.8 2.5-2.5Z"/>',
  "map-pin": '<path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  "arrow-right": '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  "coin-stack": '<ellipse cx="12" cy="6.5" rx="7" ry="2.5"/><path d="M5 6.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"/><path d="M5 10.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"/><path d="M5 14.5v3c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-3"/>',
  skull: '<path d="M12 3.5c-4.4 0-7.5 3-7.5 7 0 2.4 1.1 4.2 2.8 5.2V19a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1v-3.3c1.7-1 2.8-2.8 2.8-5.2 0-4-3.1-7-7.5-7Z"/><circle cx="9" cy="11" r="1.7"/><circle cx="15" cy="11" r="1.7"/><path d="M12 13.8l-.9 1.7h1.8L12 13.8ZM10.5 20v-2M13.5 20v-2"/>',
  bonesetter: BONE,
  stockpile: '<rect x="3" y="11" width="9" height="9" rx="1"/><path d="M3 15.5h9M7.5 11v9"/><path d="M15 4.5h5c.9 2.6.9 13 0 15.5h-5c-.9-2.5-.9-12.9 0-15.5Z"/><path d="M14.4 9h6.2M14.4 15.5h6.2"/>',

  // ---- ui (v5 extras) ----
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8l1.7 2.4 2.8-.8.5 2.9 2.9.5-.8 2.8 2.4 1.7-2.4 1.7.8 2.8-2.9.5-.5 2.9-2.8-.8-1.7 2.4-1.7-2.4-2.8.8-.5-2.9-2.9-.5.8-2.8L2.8 12l2.4-1.7-.8-2.8 2.9-.5.5-2.9 2.8.8L12 2.8Z"/>',
  warn: '<path d="M10.3 4.2 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4.5M12 17h.01"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.2h.01"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.2 6.2a1.5 1.5 0 0 1-2.1 0l-8.7-7.9Z"/><circle cx="8" cy="8" r="1.5"/>',
  hammer: '<path d="M3.5 20.5 12.5 11.5"/><path d="M10 7.5l4-4 7 7-4 4-7-7Z"/><path d="M13 9.5l2 2"/>',
  flag: '<path d="M5 21V3.5"/><path d="M5 4.5h12l-2.5 4 2.5 4H5"/>',
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M7.5 3.5c0 4 4.5 5.5 4.5 8.5s-4.5 4.5-4.5 8.5M16.5 3.5c0 4-4.5 5.5-4.5 8.5s4.5 4.5 4.5 8.5"/>',
  "user-plus": '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c0-3.7 2.9-6.5 6.5-6.5 1.6 0 3 .5 4.1 1.4"/><path d="M18.5 14v6M15.5 17h6"/>',
  crown: '<path d="M4 17.5 3 7.5l5 4 4-6.5 4 6.5 5-4-1 10H4Z"/><path d="M4 20.5h16"/>',
  dots: '<circle cx="6" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18" cy="12" r="1.1"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  sky: '<circle cx="9" cy="8.5" r="3.3"/><path d="M9 2.5v1.2M3 8.5h1.2M4.8 4.3l.8.8M13.2 4.3l-.8.8"/><path d="M9 20a3.5 3.5 0 0 1-.3-7 4.8 4.8 0 0 1 9.1-.9A3.9 3.9 0 0 1 17.3 20H9Z"/>',
};

const cache = new Map();

const IMAGE_ICONS = {
};

export function icon(name, cls) {
  if (IMAGE_ICONS[name]) {
    return `<img class="ico${cls ? " " + cls : ""}" src="${IMAGE_ICONS[name]}" alt="" aria-hidden="true" />`;
  }
  const body = ICONS[name] || ICONS.unknown;
  // width and height go on as attributes as well as in CSS. An outermost <svg> with only a
  // viewBox has no intrinsic size: its width and height are auto, which is 100% of whatever
  // holds it, so the box exists only once the .ico rule has been applied. Safari lays the
  // icon out from the attributes on the first paint and does not always come back for the
  // CSS, which leaves the topbar blank until something forces a repaint. A presentation
  // attribute loses to every author rule, so .ico and every size class still win and no
  // icon changes size or colour.
  return `<svg class="ico${cls ? " " + cls : ""}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/* A material that has a painting shows it; everything else keeps its glyph.
   `def` is an item or an action, and only the drawn ones carry `art`, so this
   is safe to call on anything. `variant` picks the cut: "fade" where there is
   no frame (a gather pill), "cut" where the frame is already there (a
   Stockpile slot). The caller puts .art-paint on the plate when hasArt() is
   true, which is what moves the violet well out of the way. */
export const hasArt = (def) => !!(def && def.art);

export function artEl(def, { variant = "fade", cls } = {}) {
  if (!hasArt(def)) return iconEl(def && def.icon, cls);
  const src = def.art[variant] || def.art.fade;
  return h(`img.mat-art${cls ? `.${cls}` : ""}`, { src, alt: "", loading: "lazy", decoding: "async" });
}

// A fresh <svg> element each call, parsed once per name and class.
export function iconEl(name, cls) {
  const key = `${name}|${cls || ""}`;
  let proto = cache.get(key);
  if (!proto) {
    proto = html(icon(name, cls)).firstElementChild;
    cache.set(key, proto);
  }
  return proto.cloneNode(true);
}
