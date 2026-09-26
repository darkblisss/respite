/* ============================================================
   Respite · ui/hunt-ring.js · The Closing Ring
   ------------------------------------------------------------
   The fight on the Hunt page, drawn on one canvas: the region's
   own ground under it, you (or the party) in the middle, and each
   foe out on the ring at the distance its next swing is away.
   Nearer is sooner. A foe steps in as its blow comes round,
   strikes from the inner ring and falls back to the edge; the one
   everyone is striking is on the solid line, and in a party a
   line runs from each foe to whoever its next blow is for.

   It draws and nothing else. The page hands it a snapshot of the
   fight each time the store plays a frame (sync) and every blow it
   hears of (blow). Between snapshots it runs the swing timers on
   by itself, so the ring moves at the screen's rate rather than
   the store's ten frames a second. What it adds is presentation
   only: a slash, a knock back, eyes in the dark. None of it is
   ever read back into the fight.

   Two sizes. Wide (a card of 820px and up) is the board as it was
   mocked: 1130 by 500 units, scaled to the card, a plate beside
   every foe. Narrow is drawn in the card's own pixels, discs only;
   the page lists the foes under it instead of plates.
   ============================================================ */

import { CONFIG } from "../../shared/config.js";
import { GameData, getMonster } from "../../shared/registry.js";
import { MONSTER_ART, KIND_ART } from "./monster-art.js";
import { icon } from "./icons.js";
import { regionLand, heartSpot, MAP_W, MAP_H } from "./region-map.js";
import { portraitFor, DEFAULT_PORTRAIT } from "./widgets.js";
import { fmt } from "./format.js";

const H = CONFIG.hunt;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rad = (d) => (d * Math.PI) / 180;
const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const lerp = (a, b, t) => a + (b - a) * t;
// Presentation only: which way a spark flies. Nothing the fight rolls comes from here.
const rnd = Math.random;
const TAU = Math.PI * 2;

/* ================= 1. PICTURES ================= */
/* The canvas draws pictures, so the game's own drawings are turned into them once a
   session: a foe's SVG painted by the m- rules in pages.css, a commander's portrait,
   a discipline's glyph, a region's ground. */

function blobUrl(svg) {
  try {
    return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  } catch (e) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
}

function picture(src) {
  const im = new Image();
  im.decoding = "async";
  im.src = src;
  return im;
}

const ready = (im) => !!(im && im.complete && im.naturalWidth);

/* The m- rules, read off the page's own sheets (pages.css) so a foe on the ring is painted
   exactly as it is everywhere else. A sheet from another origin (the fonts) cannot be read
   and is passed over. Nothing found is not kept, so the next foe asks again. */
let artCss = "";
function monsterCss() {
  if (artCss) return artCss;
  const out = [];
  Array.from(document.styleSheets || []).forEach((sheet) => {
    let rules = null;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      return;
    }
    Array.from(rules || []).forEach((r) => {
      const sel = (r.selectorText || "").trim();
      if (/^\.m-(?!art\b)[a-z-]+$/.test(sel)) out.push(r.cssText);
    });
  });
  artCss = out.join("");
  return artCss;
}

// Where each foe's head sits in its 120 by 120 drawing: the square the disc shows.
const CROPS = {
  mob_t1_skirmisher: "8.1 22.3 101.9 101.9", mob_t1_stalker: "14.4 2.1 87.6 87.6", mob_t1_brute: "18 -0.9 88.4 88.4", mob_t1_sovereign: "9.6 -4.7 93.2 93.2",
  mob_t2_skirmisher: "11.3 33.6 89.4 89.4", mob_t2_stalker: "10.3 3.8 84.8 84.8", mob_t2_brute: "13.3 -3.5 90.4 90.4", mob_t2_sovereign: "9.9 -4.7 93.2 93.2",
  mob_t3_skirmisher: "8.4 3.2 85.2 85.2", mob_t3_stalker: "9.1 26.8 96.9 96.9", mob_t3_brute: "19 -3 90 90", mob_t3_sovereign: "13.2 -4.7 93.2 93.2",
  mob_t4_skirmisher: "11.8 17.8 94 94", mob_t4_stalker: "13 2.2 86.4 86.4", mob_t4_brute: "16.3 -1.4 88.8 88.8", mob_t4_sovereign: "12.8 -4.7 94 94",
  mob_t5_skirmisher: "15.7 38.2 88.1 88.1", mob_t5_stalker: "14.7 -4.6 91.2 91.2", mob_t5_brute: "17.5 4.3 84.4 84.4", mob_t5_sovereign: "13.3 -3.1 92.8 92.8",
  mob_t6_skirmisher: "13.7 -4.6 91.2 91.2", mob_t6_stalker: "12.8 16.3 94 94", mob_t6_brute: "18.9 7.9 81.6 81.6", mob_t6_sovereign: "13.5 -4.6 92 92",
  mob_t7_skirmisher: "13.2 0.8 93.6 93.6", mob_t7_stalker: "5.1 13.3 111.9 111.9", mob_t7_brute: "18.8 -4 90.8 90.8", mob_t7_sovereign: "14.8 6.5 90.8 90.8",
  mob_t8_skirmisher: "16.5 4.8 84 84", mob_t8_stalker: "14.2 -4.6 91.2 91.2", mob_t8_brute: "18.8 -3.5 90.4 90.4", mob_t8_sovereign: "14.3 -2 90.8 90.8",
  mob_t9_skirmisher: "17.8 8.7 86.4 86.4", mob_t9_stalker: "15.2 -4.6 91.2 91.2", mob_t9_brute: "12.9 16.1 87.6 87.6", mob_t9_sovereign: "11.9 13.2 95.6 95.6",
};

const FOE_PICS = new Map();
function foePic(mob, rank) {
  const key = `${mob.id}|${rank}`;
  let im = FOE_PICS.get(key);
  if (!im) {
    const css = monsterCss();
    const rim = rank === "sovereign" ? "#b88bdb" : rank === "elite" ? "#5d8fd6" : "#8a4632";
    const art = MONSTER_ART[mob.id] || KIND_ART[mob.icon] || KIND_ART.horror;
    const box = CROPS[mob.id] || "0 0 120 120";
    im = picture(blobUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="240" height="240"><style>svg{--m-rim:${rim};--m-line:2.2}${css}</style>${art}</svg>`));
    // Drawn before the sheets could be read: not kept, so the next look paints it properly.
    if (css) FOE_PICS.set(key, im);
  }
  return im;
}

const FACES = new Map();
function facePic(skin) {
  const src = portraitFor(skin || null);
  let im = FACES.get(src);
  if (!im) {
    im = picture(src);
    im.addEventListener("error", () => {
      if (im.getAttribute("src") !== DEFAULT_PORTRAIT) im.src = DEFAULT_PORTRAIT;
    });
    FACES.set(src, im);
  }
  return im;
}

const GLYPHS = new Map();
function glyphPic(name, color) {
  const key = `${name}|${color}`;
  let im = GLYPHS.get(key);
  if (!im) {
    im = picture(blobUrl(icon(name).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/currentColor/g, color)));
    GLYPHS.set(key, im);
  }
  return im;
}

const LANDS = new Map();
function landPic(tier) {
  let im = LANDS.get(tier);
  if (!im) {
    im = picture(blobUrl(regionLand(tier, "hr-")));
    LANDS.set(tier, im);
  }
  return im;
}

/* ================= 2. SIZES ================= */

const WIDE_W = 1130;
const WIDE_H = 500;
export const WIDE_MIN = 820;

/* Where everything stands, in the drawing's own units. Wide is the mocked board, scaled to
   the card whole. Narrow is the card's own pixels: the ring shrinks with it, and so does
   everything on it (`u`), down to a floor that keeps a name readable. */
function layoutFor(cssW, cssH, party) {
  if (cssW >= WIDE_MIN) {
    return { mode: "wide", W: WIDE_W, H: WIDE_H, k: cssW / WIDE_W, CX: 565, CY: 258, RMAX: 178, SX: 1.62, rin: party ? 106 : 84, u: 1, plates: true };
  }
  const W = Math.max(240, cssW);
  const Ht = Math.max(240, cssH);
  // The fight's head takes the top of the stage: the ring stands in what is left under it,
  // and everything on it is sized to the ring, so a foe halfway in never sits on your face.
  const top = 58;
  const room = Ht - top - 14;
  const RMAX = Math.min(room * 0.36, W * 0.3);
  const u = clamp(Math.min(W / 560, RMAX / 150), 0.55, 0.92);
  const SX = clamp((W / 2 - 44 * u) / (RMAX + 34 * u), 1, 1.62);
  return { mode: "narrow", W, H: Ht, k: 1, CX: W / 2, CY: top + room * 0.5, RMAX, SX, rin: RMAX * (party ? 0.62 : 0.5), u, plates: false };
}

// Where the opening foes stand, by how many: alone they come round behind you, in a party they press the front.
function openingSlots(n, party) {
  if (party) return n === 1 ? [-90] : n === 2 ? [-130, -50] : [-90, -158, -22];
  return n === 1 ? [-90] : n === 2 ? [-128, -52] : [-90, 150, 30];
}
const SLOTS = [-90, -130, -50, 150, 30, -170, -10];
const apart = (a, b) => {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
};

// The party, you in the middle of a three: the band stands where the mock had it.
function homesFor(n) {
  if (n <= 1) return [[0, 0]];
  if (n === 2) return [[-72, 10], [72, 10]];
  if (n === 3) return [[-126, 14], [0, 0], [126, 14]];
  return [[-165, 18], [-55, 0], [55, 0], [165, 18]];
}

const HP_FILL = [[0, "#9fd8bf"], [0.45, "#7cbfa4"], [1, "#3f6e5d"]];
const FOE_FILL = [[0, "#f0a27a"], [0.45, "#d8743f"], [1, "#7d3a2c"]];
const DISPLAY = "Spectral, Georgia, serif";
const UI = "Inter, system-ui, sans-serif";

/* ================= 3. THE RING ================= */

/* huntRing({ onFoe }) -> { node, canvas, sync(snap), blow(ev), clear(), mode, destroy() }

   A snapshot:
     key       the hunt (or the party's session): a new key starts the ring over
     party     boolean
     tier      the region, for the ground under it
     phase     "fight" | "search" | "quiet"
     enc       which encounter (a new one clears the ring)
     kind      "normal" | "sovereign"
     vast      a Sovereign waits at the end of this walk
     enrage    how many times the Sovereign has angered
     reinforceIn  ms until the zone's window brings another, or null
     queued    how many wait in the dark for a gap
     hunters   [{ id, me, name, skin, klass, hp, max, veil (0..1), volley, down, share }]
     foes      [{ uid, id, elite, hp, max, timer (ms), target (a hunter id) }]
   In roster order: the first foe is the one every hunter strikes. */
export function huntRing({ onFoe = () => {}, onMode = () => {} } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "hunt-ring";
  canvas.setAttribute("aria-hidden", "true");
  const g = canvas.getContext("2d");

  let L = layoutFor(WIDE_W, WIDE_H, false);
  let cssW = 0;
  let cssH = 0;
  let pxPer = 1;              // canvas pixels per unit
  let backKey = "";
  let landLayer = null;
  let ringLayer = null;

  // The fight as last told, and what the ring has made of it.
  let snap = null;
  let snapAt = 0;
  let key = null;
  let enc = null;
  let phase = "quiet";
  let party = false;
  const hunters = [];
  const byHunter = new Map();
  let foes = [];
  const byFoe = new Map();
  let eyes = [];
  let fx = [];
  let parts = [];
  let timers = [];
  let t = 0;                  // the ring's own clock, in seconds
  let ringAlpha = 0;
  let shake = 0;
  let redEdge = 0;
  let lastCast = null;        // the foe a Volley was loosed at, for the arcs off it

  let running = false;
  let raf = 0;
  let lastFrame = 0;
  let seen = true;            // on screen at all
  let dirty = true;

  const motion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const still = () => !!(motion && motion.matches);

  /* ---------- where things are ---------- */

  const hr = (u) => (u.me ? (party ? 44 : 50) : 28) * L.u;
  const foeR = (f, isT) => ((f.sov ? 50 : 36) + (isT ? 4 : 0)) * L.u;
  const standingFoes = () => foes.filter((f) => !f.dying && !f.leaving && !f.pending);
  // Everyone strikes the first foe still standing in the roster, as the engine does.
  const target = () => standingFoes().find((f) => f.join <= 0.35) || standingFoes()[0] || null;
  const me = () => hunters.find((u) => u.me) || null;

  function hunterAt(u) {
    return { x: L.CX + u.home[0] * L.u + u.off[0], y: L.CY + u.home[1] * L.u + u.off[1] };
  }
  function ringPos(b, r) {
    return { x: L.CX + Math.cos(rad(b)) * r * L.SX, y: L.CY + Math.sin(rad(b)) * r };
  }
  function foeAt(f) {
    let { x, y } = ringPos(f.bearing, f.r);
    if (f.join > 0 && f.from) {
      const k = ease(1 - f.join);
      x = lerp(f.from.x, x, k);
      y = lerp(f.from.y, y, k);
    }
    if (f.lunge > 0 && f.victim) {
      const v = hunterAt(f.victim);
      const k = Math.sin(Math.PI * clamp(1 - f.lunge, 0, 1)) * 0.6;
      x += (v.x - x) * k;
      y += (v.y - y) * k;
    }
    if (f.shake > 0) {
      x += (rnd() - 0.5) * f.shake;
      y += (rnd() - 0.5) * f.shake;
    }
    return { x, y };
  }
  // How far out along its bearing a foe can be pushed and still be seen whole.
  function rLimit(b) {
    const c = Math.cos(rad(b));
    const s = Math.sin(rad(b));
    let lim = 1e9;
    if (s < -0.01) lim = Math.min(lim, (L.CY - 46 * L.u) / -s);
    if (s > 0.01) lim = Math.min(lim, (L.H - 50 * L.u - L.CY) / s);
    if (Math.abs(c) > 0.01) lim = Math.min(lim, (L.CX - 60 * L.u) / (Math.abs(c) * L.SX));
    return Math.max(L.RMAX, lim);
  }
  // Where the dark is at a bearing: past the ring's edge, inside the frame.
  function darkAt(b, jitter = 0) {
    const p = ringPos(b + jitter, L.RMAX + 120 * L.u);
    return { x: clamp(p.x, 34, L.W - 34), y: clamp(p.y, 30, L.H - 30) };
  }
  // The place on the ring furthest from everyone already on it.
  function freeSlot() {
    const taken = standingFoes().map((f) => f.bearing);
    if (!taken.length) return -90;
    let best = SLOTS[0];
    let far = -1;
    SLOTS.forEach((b) => {
      const d = Math.min(...taken.map((x) => apart(b, x)));
      if (d > far + 0.5) {
        far = d;
        best = b;
      }
    });
    return best;
  }

  /* ---------- the clock's small helpers ---------- */

  const later = (dt, fn) => {
    const tm = { at: t + dt, fn };
    timers.push(tm);
    return tm;
  };
  const effect = (e) => {
    e.born = t;
    fx.push(e);
    return e;
  };
  function particle(x, y, vx, vy, life, color, size, drag = 0.9) {
    parts.push({ x, y, vx, vy, life, max: life, color, size, drag });
  }
  function burst(x, y, n, colors, speed, life, size = 2.4) {
    if (still()) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU;
      const v = speed * (0.35 + rnd() * 0.8) * L.u;
      particle(x, y, Math.cos(a) * v, Math.sin(a) * v * 0.8, life * (0.6 + rnd() * 0.6), colors[i % colors.length], size * (0.6 + rnd() * 0.9) * Math.max(0.75, L.u));
    }
  }
  function addEyes(p, fast) {
    const e = { x: p.x, y: p.y, born: t, fade: fast ? 0.35 : 2.6, phase: rnd() * 9, blink: 3 + rnd() * 4, size: (0.9 + rnd() * 0.3) * Math.max(0.8, L.u), gone: 0, kind: "wait", bearing: null };
    eyes.push(e);
    return e;
  }
  const liveEyes = (kind) => eyes.filter((e) => !e.gone && e.kind === kind);

  /* ================= 4. THE SNAPSHOT ================= */

  function reset() {
    hunters.length = 0;
    byHunter.clear();
    foes = [];
    byFoe.clear();
    eyes = [];
    fx = [];
    parts = [];
    timers = [];
    lastCast = null;
    ringAlpha = 0;
    enc = null;
    phase = "quiet";
    backKey = "";
  }

  function syncHunters(list) {
    const ids = list.map((u) => u.id).join("|");
    if (ids !== hunters.map((u) => u.id).join("|")) {
      const homes = homesFor(list.length);
      // You stand in the middle of a three; otherwise in the roster's order.
      const mine = list.find((u) => u.me);
      const rest = list.filter((u) => !u.me);
      const order = list.length === 3 && mine ? [rest[0], mine, rest[1]] : list;
      const next = order.map((src, i) => {
        const was = byHunter.get(src.id);
        return was ? Object.assign(was, { home: homes[i] }) : {
          id: src.id, home: homes[i], off: [0, 0], flash: 0, shake: 0, busy: 0, dash: null, lungeTo: null, lungeT: 0,
          hp: src.hp, veilShown: src.veil || 0,
        };
      });
      hunters.length = 0;
      byHunter.clear();
      next.forEach((u) => {
        hunters.push(u);
        byHunter.set(u.id, u);
      });
    }
    list.forEach((src) => {
      const u = byHunter.get(src.id);
      if (!u) return;
      // A party's blows are only known by what they took: a drop in health is a blow landed.
      if (party && phase === "fight" && Number.isFinite(u.hp) && src.hp < u.hp - 0.5) {
        const heavy = src.hp < u.hp - src.max * 0.12;
        later(rnd() * 0.5, () => claws(u, heavy));
      }
      u.me = !!src.me;
      u.name = src.name || "";
      u.skin = src.skin || null;
      u.klass = src.klass || null;
      u.hp = Math.max(0, src.hp);
      u.max = Math.max(1, src.max);
      u.veil = clamp(src.veil || 0, 0, 1);
      u.volley = src.volley || 0;
      u.down = !!src.down;
      u.share = Number.isFinite(src.share) ? src.share : null;
    });
  }

  function makeFoe(src, bearing, joining, from) {
    const mob = getMonster(src.id);
    const sov = mob.archetype === "sovereign";
    const speed = Math.max(400, mob.speed || 2400);
    const f = {
      uid: src.uid, id: src.id, mob, name: mob.name, elite: !!src.elite, sov, speed,
      hp: src.hp, max: src.max, timer: src.timer, at: snapAt, shown: src.timer, target: src.target || null,
      bearing, r: L.RMAX + 30 * L.u, push: 0, lunge: 0, flash: 0, gold: 0, squash: 0, shake: 0,
      join: joining ? 1 : 0, from: joining ? from : null, dying: 0, leaving: 0, pending: false, killed: false, left: false,
      victim: null, pic: foePic(mob, sov ? "sovereign" : src.elite ? "elite" : ""),
    };
    foes.push(f);
    byFoe.set(f.uid, f);
    return f;
  }

  function syncFoes(list, fresh) {
    const here = new Set(list.map((f) => f.uid));
    // Gone from the roster: felled, or broken away from. Which is settled once the blows are in.
    foes.forEach((f) => {
      if (!here.has(f.uid) && !f.dying && !f.leaving && !f.pending) f.pending = true;
    });
    const opening = fresh ? openingSlots(list.length, party) : null;
    list.forEach((src, i) => {
      if (!getMonster(src.id)) return;
      let f = byFoe.get(src.uid);
      if (!f) {
        if (opening) {
          f = makeFoe(src, opening[i] != null ? opening[i] : freeSlot(), false, null);
        } else {
          // Out of the dark, from wherever its eyes were.
          const b = freeSlot();
          const wait = liveEyes("pre")[0] || liveEyes("wait")[0] || null;
          const spot = wait ? { x: wait.x, y: wait.y } : darkAt(b);
          if (wait) wait.gone = t;
          else addEyes(spot, true).gone = t + 0.5;
          f = makeFoe(src, b, true, spot);
        }
      }
      // A party's blows, again only by what they took.
      if (party && !opening && Number.isFinite(f.hp) && src.hp < f.hp - 0.5) {
        const w = clamp((f.hp - src.hp) / Math.max(1, f.max) * 6, 0.4, 1.3);
        later(rnd() * 0.6, () => impact(f, w, false, "#ffffff"));
      }
      f.hp = src.hp;
      f.max = Math.max(1, src.max);
      f.timer = Math.max(0, src.timer);
      f.at = snapAt;
      f.target = src.target || null;
      f.elite = !!src.elite;
    });
  }

  // Eyes in the dark: those waiting for a gap, the next one's before its window runs out, and something vast.
  function syncEyes(s) {
    if (s.phase === "fight") {
      liveEyes("vast").forEach((e) => { e.gone = t; });
      const want = s.kind === "normal" ? Math.max(0, s.queued || 0) : 0;
      const wait = liveEyes("wait");
      for (let i = wait.length; i < want; i++) {
        const b = [-60, -120, 170, 10, 120, 60][(i + (Number(enc) || 0)) % 6];
        const e = addEyes(darkAt(b, (rnd() - 0.5) * 16), false);
        e.kind = "wait";
      }
      if (wait.length > want) wait.slice(want).forEach((e) => { e.gone = t; });
      const soon = s.kind === "normal" && Number.isFinite(s.reinforceIn) && s.reinforceIn < 2600 && standingFoes().length < H.maxFoes && !want;
      const pre = liveEyes("pre");
      if (soon && !pre.length) {
        const e = addEyes(darkAt(freeSlot()), false);
        e.kind = "pre";
        e.fade = 1.6;
      } else if (!soon && pre.length && !(Number.isFinite(s.reinforceIn) && s.reinforceIn < 2600)) {
        pre.forEach((e) => { e.gone = t; });
      }
    } else {
      liveEyes("wait").concat(liveEyes("pre")).forEach((e) => { e.gone = t; });
      const vast = liveEyes("vast");
      if (s.vast && !vast.length) {
        const e = addEyes(darkAt(-90), false);
        Object.assign(e, { kind: "vast", size: 1.9 * Math.max(0.8, L.u), fade: 3, blink: 5.5 });
      } else if (!s.vast && vast.length) {
        vast.forEach((e) => { e.gone = t; });
      }
    }
  }

  function sync(s) {
    if (!s) return;
    const now = performance.now();
    const wasParty = party;
    party = !!s.party;
    if (s.key !== key || party !== wasParty) {
      reset();
      key = s.key;
    }
    snap = s;
    snapAt = now;
    const fresh = s.phase === "fight" && (phase !== "fight" || s.enc !== enc);
    if (fresh) {
      /* A new encounter, perhaps straight after the last with no walk between. What was left
         of the last one falls as it would have, and is known by nothing: a party's encounter
         numbers its foes from one again, so an old uid must never be taken for a new foe. */
      foes.forEach((f) => { if (!f.dying && !f.leaving) f.pending = true; });
      byFoe.clear();
    }
    phase = s.phase;
    enc = s.enc;
    syncHunters(Array.isArray(s.hunters) ? s.hunters : []);
    syncFoes(s.phase === "fight" && Array.isArray(s.foes) ? s.foes : [], fresh);
    syncEyes(s);
    dirty = true;
    wake();
  }

  /* ================= 5. BLOWS ================= */
  /* What your own hunt says happened (hunt:fx), as it happened. A party's fight is not played
     here, so it sends none: its blows are read off what each snapshot took (above). */

  function blow(ev) {
    if (!ev || !snap || still()) {
      if (ev && ev.kind === "leave") markLeft(ev.who);
      if (ev && ev.kind === "kill") markKilled(ev.who);
      return;
    }
    const you = me();
    if (ev.who === "you") {
      if (!you) return;
      if (ev.kind === "hurt" || ev.kind === "block" || ev.kind === "ambushed") {
        claws(you, ev.kind === "ambushed");
        if (ev.kind === "ambushed") {
          const q = hunterAt(you);
          callout({ x: q.x, y: q.y - hr(you) - 20 * L.u }, "AMBUSHED");
        }
      } else if (ev.kind === "heal") {
        const q = hunterAt(you);
        burst(q.x, q.y, 16, ["#9fd8bf", "#e8fff4"], 80, 0.7);
      }
      return;
    }
    const f = byFoe.get(ev.who);
    if (!f) return;
    switch (ev.kind) {
      case "kill": markKilled(ev.who); break;
      case "leave": markLeft(ev.who); break;
      case "enrage":
        f.flash = 1.2;
        f.shake = 6;
        effect({ type: "rage", f, life: 1 });
        shake = Math.max(shake, 3);
        break;
      case "hit":
      case "crit":
        if (you) swingAt(you, f, ev.kind === "crit");
        break;
      case "strike": if (you) devastate(you, f); break;
      case "ambush": if (you) ambush(you, f); break;
      case "volley":
      case "empowered": {
        const big = ev.kind === "empowered";
        // The first of a cast is at its target; the rest in the same breath are the splash.
        if (lastCast && lastCast.at > t - 0.05 && lastCast.f !== f) {
          const from = lastCast.f;
          later(big ? 0.38 : 0.32, () => arc(from, f, big));
        } else if (you) {
          lastCast = { f, at: t };
          cast(you, f, big);
        }
        break;
      }
      case "thorns":
      case "bleed":
        f.flash = Math.max(f.flash, 0.6);
        break;
      default: break;
    }
  }

  function markKilled(uid) {
    const f = byFoe.get(uid);
    if (f) f.killed = true;
  }
  function markLeft(uid) {
    const f = byFoe.get(uid);
    if (f) f.left = true;
  }

  /* ================= 6. WHAT EACH BLOW LOOKS LIKE ================= */

  function callout(p, text) {
    effect({ type: "callout", x: clamp(p.x, 110 * L.u, L.W - 110 * L.u), y: Math.max(40 * L.u, p.y), text, life: 1.2 });
  }
  function claws(u, heavy) {
    const p = hunterAt(u);
    u.flash = 1;
    u.shake = heavy ? 9 : 6;
    effect({ type: "claws", who: u, heavy, life: 0.45 });
    burst(p.x, p.y, heavy ? 16 : 8, ["#eb9068", "#7d3a2c"], heavy ? 120 : 80, 0.5);
    if (u.me) redEdge = Math.max(redEdge, heavy ? 1 : 0.6);
  }
  function impact(f, weight, crit, color) {
    if (!byFoe.has(f.uid) && !f.dying) return;
    f.push += 22 * weight * L.u;
    f.flash = 1;
    if (crit) f.gold = 1;
    const p = foeAt(f);
    burst(p.x, p.y, Math.round(8 * weight) + (crit ? 10 : 0), [color, "#ffffff", "#eb9068"], 140 * weight, 0.45);
  }
  // A plain blow: a slash across the one struck, and it is knocked a step back. A Mage's is a bolt.
  function swingAt(u, f, crit) {
    if (u.klass === "mage") {
      bolt(u, f, 5, 0.2, () => impact(f, crit ? 1.1 : 0.7, crit, "#b9a4f2"));
      return;
    }
    u.lungeTo = f;
    u.lungeT = 0.16;
    effect({ type: "slash", f, life: 0.3, width: u.klass === "warrior" ? 7 : 4, color: crit ? "#f2cf7a" : "#f3ecff", angle: -0.8 + rnd() * 0.3, double: u.klass === "rogue" });
    impact(f, u.klass === "warrior" ? 1 : 0.75, crit, crit ? "#f2cf7a" : "#ffffff");
  }
  function bolt(u, f, size, travel, onHit, bend = 0) {
    effect({ type: "bolt", h: u, f, size: size * L.u, life: travel, bend, onHit, from: { ...hunterAt(u) } });
  }
  function boltAt(e, k) {
    const to = foeAt(e.f);
    const from = e.from;
    const nx = -(to.y - from.y);
    const ny = to.x - from.x;
    const nl = Math.hypot(nx, ny) || 1;
    const mx = (from.x + to.x) / 2 + (nx / nl) * 70 * L.u * e.bend;
    const my = (from.y + to.y) / 2 + (ny / nl) * 70 * L.u * e.bend;
    const q = ease(k);
    return { x: (1 - q) * (1 - q) * from.x + 2 * (1 - q) * q * mx + q * q * to.x, y: (1 - q) * (1 - q) * from.y + 2 * (1 - q) * q * my + q * q * to.y };
  }
  function streakAt(e, q) {
    const mx = (e.from.x + e.to.x) / 2 + (e.to.y - e.from.y) * 0.35 * (e.side || 0);
    const my = (e.from.y + e.to.y) / 2 - (e.to.x - e.from.x) * 0.35 * (e.side || 0);
    return { x: (1 - q) * (1 - q) * e.from.x + 2 * (1 - q) * q * mx + q * q * e.to.x, y: (1 - q) * (1 - q) * e.from.y + 2 * (1 - q) * q * my + q * q * e.to.y };
  }

  /* Devastating Strike: the Veil flares, you drive through the one you are striking and it is
     hammered into the ground where it stands. A flash, a tight ring, the floor cracks. The
     blow has already landed by the time it is heard of, so the wind-up is short. */
  function devastate(u, f) {
    u.busy = 0.5;
    effect({ type: "windup", h: u, life: 0.18 });
    later(0.16, () => { u.dash = { f, t: 0 }; });
    later(0.26, () => {
      const p = foeAt(f);
      f.flash = 1.4;
      f.squash = 1;
      f.shake = 10;
      effect({ type: "shock", x: p.x, y: p.y, life: 0.42 });
      effect({ type: "flashring", x: p.x, y: p.y, life: 0.2 });
      effect({ type: "cracks", x: p.x, y: p.y + 10 * L.u, life: 1.3, lines: crackLines(p.x, p.y + 10 * L.u) });
      burst(p.x, p.y, 22, ["#f3ecff", "#c9b8ff", "#eb9068", "#6d5a4a"], 170, 0.6, 2.6);
      shake = Math.max(shake, 6);
    });
    later(0.42, () => { u.dash = null; });
  }
  function crackLines(x, y) {
    const out = [];
    for (let i = 0; i < 6; i++) {
      let a = (i / 6) * TAU + rnd() * 0.5;
      let px = x;
      let py = y;
      const pts = [[px, py]];
      const len = (40 + rnd() * 45) * L.u;
      for (let d = 0; d < len; d += 8 * L.u) {
        a += (rnd() - 0.5) * 0.7;
        px += Math.cos(a) * 8 * L.u * L.SX * 0.7;
        py += Math.sin(a) * 8 * L.u * 0.6;
        pts.push([px, py]);
      }
      out.push(pts);
    }
    return out;
  }

  /* Ambush: gone into shadow, round the ring and out behind the one you are striking, two cuts
     cross it from behind, and back before it turns. */
  function ambush(u, f) {
    u.busy = 0.8;
    const start = hunterAt(u);
    const p0 = foeAt(f);
    const out = {
      x: clamp(p0.x + Math.cos(rad(f.bearing)) * 64 * L.u * L.SX * 0.7, 50 * L.u, L.W - 50 * L.u),
      y: clamp(p0.y + Math.sin(rad(f.bearing)) * 64 * L.u, 44 * L.u, L.H - 44 * L.u),
    };
    effect({ type: "vanish", h: u, life: 0.14 });
    burst(start.x, start.y, 18, ["#2b2236", "#4a3a60", "#15101c"], 90, 0.7, 4);
    effect({ type: "streak", from: start, to: out, life: 0.24, side: rnd() < 0.5 ? -1 : 1 });
    later(0.24, () => effect({ type: "ghost", h: u, x: out.x, y: out.y, life: 0.42 }));
    later(0.3, () => effect({ type: "xcut", f, life: 0.36, first: true }));
    later(0.36, () => {
      effect({ type: "xcut", f, life: 0.36, first: false });
      f.flash = 1.2;
      f.gold = 1;
      f.shake = 5;
      const p = foeAt(f);
      burst(p.x, p.y, 22, ["#f2cf7a", "#ffffff", "#b9a4f2"], 180, 0.55);
      shake = Math.max(shake, 3);
    });
    later(0.62, () => effect({ type: "streak", from: out, to: hunterAt(u), life: 0.18, side: 0 }));
    later(0.8, () => {
      u.busy = 0;
      const q = hunterAt(u);
      burst(q.x, q.y, 10, ["#4a3a60", "#b9a4f2"], 60, 0.4);
    });
  }

  /* A Volley cast (one of the three diamonds) and the empowered cast: an orb on a bending
     path, and where it lands arcs leap to every other foe. */
  function cast(u, f, big) {
    const n = Math.max(0, (GameData.TECHNIQUE.volley.casts || 3) - (u.volley || 0));
    effect({ type: "gather", h: u, life: 0.16, big });
    if (!big) effect({ type: "spend", h: u, i: clamp(n - 1, 0, 2), life: 0.5 });
    later(0.08, () => bolt(u, f, big ? 11 : 7.5, big ? 0.3 : 0.24, () => {
      const p = foeAt(f);
      f.push += (big ? 30 : 18) * L.u;
      f.flash = 1;
      effect({ type: "bloom", x: p.x, y: p.y, life: big ? 0.55 : 0.4, big });
      burst(p.x, p.y, big ? 26 : 14, ["#e8dcff", "#9d82e0", "#6c52c0"], big ? 200 : 140, 0.6);
      if (big) shake = Math.max(shake, 4);
    }, big ? -1 : [-1, 1, 0][(n + 2) % 3]));
  }
  function arc(from, to, big) {
    if (!from || !to) return;
    const p = foeAt(from);
    const q = foeAt(to);
    effect({ type: "arc", from: p, to: q, life: 0.26 });
    later(0.06, () => {
      to.push += (big ? 16 : 10) * L.u;
      to.flash = 0.8;
      burst(q.x, q.y, 8, ["#e8dcff", "#9d82e0"], 90, 0.4);
    });
  }

  function fall(f) {
    const p = foeAt(f);
    if (f.sov) {
      burst(p.x, p.y, 70, ["#f3ecff", "#d9c2f0", "#b88bdb", "#6c3f8f"], 260, 1.3, 3);
      effect({ type: "felled", x: p.x, y: p.y, life: 1.3 });
      shake = Math.max(shake, 9);
    } else {
      burst(p.x, p.y, 26, ["#eb9068", "#ffcf9a", "#7d3a2c"], 150, 0.9);
    }
  }

  /* ================= 7. THE CLOCK ================= */

  function step(dt) {
    t += dt;
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at <= t) {
        const tm = timers.splice(i, 1)[0];
        tm.fn();
      }
    }
    ringAlpha = clamp(ringAlpha + (phase === "fight" ? dt : -dt) * 2.2, 0, 1);
    const since = performance.now();

    // Settled now the blows are in: a foe gone from the roster fell, or went back into the dark.
    foes.forEach((f) => {
      if (!f.pending) return;
      f.pending = false;
      if (f.left) {
        f.leaving = 0.001;
        const e = addEyes(darkAt(f.bearing, (rnd() - 0.5) * 18), true);
        e.gone = t + 1.5;
      } else {
        f.dying = 0.001;
        fall(f);
      }
    });

    foes.forEach((f) => {
      f.shake = Math.max(0, f.shake - dt * 40);
      f.squash = Math.max(0, f.squash - dt * 3);
      f.flash = Math.max(0, f.flash - dt * 4);
      f.gold = Math.max(0, f.gold - dt * 2.5);
      if (f.leaving) {
        f.leaving += dt;
        f.r = Math.min(f.r + dt * 260 * L.u, rLimit(f.bearing) + 70 * L.u);
        f.lunge = 0;
        return;
      }
      if (f.dying) {
        f.dying += dt;
        f.r = Math.min(f.r + f.push * dt * 5, rLimit(f.bearing) + 40 * L.u);
        f.push *= Math.exp(-dt * 3.2);
        return;
      }
      if (f.join > 0) f.join = Math.max(0, f.join - dt * 1.3);
      // The timer runs on from the last snapshot; round past zero it has struck and starts again.
      let shown = f.timer - (since - f.at);
      if (shown < 0) shown = ((shown % f.speed) + f.speed) % f.speed;
      if (shown > f.shown + f.speed * 0.5 && !f.join) {
        // It struck: a lunge at whoever it was going for.
        f.lunge = 1;
        f.victim = (f.target && byHunter.get(f.target)) || me() || hunters[0] || null;
      }
      f.shown = shown;
      const want = Math.min(rLimit(f.bearing), L.rin + (L.RMAX - L.rin) * clamp(shown / f.speed, 0, 1) + f.push);
      f.r += (want - f.r) * (1 - Math.exp(-dt * 9));
      f.push *= Math.exp(-dt * 3.2);
      f.lunge = Math.max(0, f.lunge - dt / 0.22);
    });
    foes = foes.filter((f) => {
      const done = (f.dying && f.dying > 0.6) || (f.leaving && f.leaving > 0.7);
      if (done && byFoe.get(f.uid) === f) byFoe.delete(f.uid);
      return !done;
    });

    hunters.forEach((u) => {
      u.flash = Math.max(0, u.flash - dt * 4);
      u.shake = Math.max(0, u.shake - dt * 30);
      if (u.busy > 0) u.busy -= dt;
      u.veilShown += (u.veil - u.veilShown) * (1 - Math.exp(-dt * 8));
      let ox = 0;
      let oy = 0;
      if (u.shake > 0 && !still()) {
        ox += (rnd() - 0.5) * u.shake;
        oy += (rnd() - 0.5) * u.shake;
      }
      if (u.lungeT > 0 && u.lungeTo) {
        u.lungeT -= dt;
        const q = foeAt(u.lungeTo);
        const k = Math.sin(Math.PI * clamp(1 - u.lungeT / 0.16, 0, 1)) * 0.12;
        ox += (q.x - L.CX - u.home[0] * L.u) * k;
        oy += (q.y - L.CY - u.home[1] * L.u) * k;
      }
      if (u.dash) {
        u.dash.t += dt;
        const q = foeAt(u.dash.f);
        const k = u.dash.t < 0.1 ? ease(u.dash.t / 0.1) * 0.5 : 0.5 * (1 - ease((u.dash.t - 0.1) / 0.16));
        ox += (q.x - L.CX - u.home[0] * L.u) * k;
        oy += (q.y - L.CY - u.home[1] * L.u) * k;
      }
      u.off = [ox, oy];
    });

    // Bolts land and trail sparks, shadow streaks trail smoke, on the ring's own clock.
    fx.forEach((e) => {
      if (e.type !== "bolt" && e.type !== "streak") return;
      const k = clamp((t - e.born) / e.life, 0, 1);
      const p = e.type === "bolt" ? boltAt(e, k) : streakAt(e, ease(k));
      e.acc = (e.acc || 0) + dt * (e.type === "bolt" ? 110 : 55);
      for (; e.acc >= 1; e.acc--) {
        if (e.type === "bolt") particle(p.x, p.y, (rnd() - 0.5) * 50, (rnd() - 0.5) * 50, 0.35, rnd() < 0.5 ? "#9d82e0" : "#e8dcff", e.size * 0.4);
        else particle(p.x, p.y, (rnd() - 0.5) * 40, (rnd() - 0.5) * 40, 0.5, "#4a3a60", (4 + rnd() * 3) * L.u, 0.92);
      }
      if (e.type === "bolt" && k >= 1 && !e.done) {
        e.done = true;
        e.onHit();
      }
    });

    eyes = eyes.filter((e) => !(e.gone && t - e.gone > 0.6));
    fx = fx.filter((e) => t - e.born < e.life);
    parts.forEach((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
    });
    parts = parts.filter((p) => p.life > 0);
    shake = still() ? 0 : Math.max(0, shake - dt * 40);
    redEdge = Math.max(0, redEdge - dt * 2.2);
  }

  // Whether anything on the stage is still moving: a walk with nothing in the dark needs no frames.
  const busy = () => ringAlpha > 0 || phase === "fight" || eyes.length > 0 || fx.length > 0 || parts.length > 0 || timers.length > 0 || shake > 0 || redEdge > 0;

  /* ================= 8. DRAWING ================= */

  function layer() {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(L.W * pxPer));
    c.height = Math.max(1, Math.round(L.H * pxPer));
    const x = c.getContext("2d");
    x.setTransform(pxPer, 0, 0, pxPer, 0, 0);
    return [c, x];
  }

  // Where on its region's map this zone's fight stands: halfway across the zone's band, south-west of the heart.
  function fightSpot(tier, zoneIdx) {
    const hs = heartSpot(tier);
    const RING = [150, 116, 83, 51];
    const i = clamp(zoneIdx, 0, 3);
    const mid = i < 3 ? (RING[i] + RING[i + 1]) / 2 : 40;
    const a = rad(118);
    return { x: hs.x + mid * 1.5 * Math.cos(a), y: hs.y + mid * 0.95 * Math.sin(a) };
  }

  /* What does not move is drawn once into canvases of its own: the region's ground,
     darkened to its edges, and over it the ring and its three marks. */
  function buildBack() {
    const s = snap || {};
    const land = s.tier ? landPic(s.tier) : null;
    let [c, x] = layer();
    x.fillStyle = "#0b0910";
    x.fillRect(0, 0, L.W, L.H);
    if (ready(land)) {
      // The ground is drawn big enough to fill the stage whatever its shape, centred on the fight.
      const Z = Math.max(2.5 * L.u, L.W / MAP_W, L.H / MAP_H) * (L.mode === "wide" ? 1 : 1.25);
      const p = fightSpot(s.tier, s.zoneIdx || 0);
      const dw = MAP_W * Z;
      const dh = MAP_H * Z;
      const dx = clamp(L.CX - p.x * Z, L.W - dw, 0);
      const dy = clamp(L.CY - p.y * Z, L.H - dh, 0);
      x.drawImage(land, dx, dy, dw, dh);
    }
    // The ground is lit where you stand and lost to the dark at the frame.
    x.fillStyle = "rgba(8, 6, 11, .38)";
    x.fillRect(0, 0, L.W, L.H);
    const v = x.createRadialGradient(L.CX, L.CY + 10, L.RMAX * 0.8, L.CX, L.CY + 10, Math.max(L.W, L.H) * 0.62);
    v.addColorStop(0, "rgba(6, 4, 8, 0)");
    v.addColorStop(0.55, "rgba(6, 4, 8, .55)");
    v.addColorStop(1, "rgba(4, 3, 6, .96)");
    x.fillStyle = v;
    x.fillRect(0, 0, L.W, L.H);
    landLayer = c;

    [c, x] = layer();
    const glow = x.createRadialGradient(L.CX, L.CY, 10, L.CX, L.CY, L.RMAX * L.SX);
    glow.addColorStop(0, "rgba(235, 144, 104, .16)");
    glow.addColorStop(0.7, "rgba(40, 24, 30, .12)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    x.fillStyle = glow;
    x.beginPath();
    x.ellipse(L.CX, L.CY, (L.RMAX + 30 * L.u) * L.SX, L.RMAX + 30 * L.u, 0, 0, TAU);
    x.fill();
    x.strokeStyle = "rgba(232, 225, 213, .06)";
    x.lineWidth = 1;
    for (let a = 0; a < 360; a += 30) {
      x.beginPath();
      x.moveTo(L.CX + Math.cos(rad(a)) * L.rin * 0.7 * L.SX, L.CY + Math.sin(rad(a)) * L.rin * 0.7);
      x.lineTo(L.CX + Math.cos(rad(a)) * L.RMAX * L.SX, L.CY + Math.sin(rad(a)) * L.RMAX);
      x.stroke();
    }
    const mid = (L.RMAX + L.rin) / 2;
    [[L.RMAX, "rgba(216, 116, 63, .34)", []], [mid, "rgba(216, 116, 63, .26)", []], [L.rin, "rgba(235, 144, 104, .7)", [4, 5]]].forEach(([r, col, d]) => {
      x.setLineDash(d);
      x.strokeStyle = col;
      x.lineWidth = d.length ? 1.5 : 1;
      x.beginPath();
      x.ellipse(L.CX, L.CY, r * L.SX, r, 0, 0, TAU);
      x.stroke();
    });
    x.setLineDash([]);
    // The marks are named where there is room to: on a phone's ring they would sit under a foe.
    if (L.plates) {
      x.font = `700 9px ${UI}`;
      x.textAlign = "right";
      [[L.RMAX, "2S", "rgba(232, 225, 213, .4)"], [mid, "1S", "rgba(232, 225, 213, .4)"], [L.rin, "NOW", "#eb9068"]].forEach(([r, txt, col]) => {
        x.fillStyle = col;
        x.fillText(txt, L.CX - r * L.SX - 8, L.CY + 16);
      });
    }
    ringLayer = c;
  }

  const disc = (img, x, y, r) => {
    if (!ready(img)) return;
    g.save();
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.clip();
    g.drawImage(img, x - r, y - r, r * 2, r * 2);
    g.restore();
  };
  // A commander's face, cropped the way .portrait-bust crops it everywhere else.
  const face = (img, x, y, r) => {
    if (!ready(img)) return;
    const d = r * 2;
    const s = Math.max(d / img.naturalWidth, d / img.naturalHeight) * 1.6;
    const w = img.naturalWidth * s;
    g.save();
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.clip();
    g.drawImage(img, x - w / 2, y - r, w, img.naturalHeight * s);
    g.restore();
  };
  const rrect = (x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  function arcRing(x, y, r, frac, color, width, full) {
    g.lineCap = "round";
    g.strokeStyle = "rgba(0, 0, 0, .6)";
    g.lineWidth = width + 2;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.stroke();
    if (frac > 0.005) {
      if (full) {
        g.save();
        g.shadowColor = "rgba(185, 164, 242, .95)";
        g.shadowBlur = 14;
      }
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(frac, 0, 1));
      g.stroke();
      if (full) g.restore();
    }
  }
  function chipAt(x, y, text, fg, bg, line) {
    g.font = `700 9px ${UI}`;
    const w = g.measureText(text).width + 10;
    rrect(x, y - 8, w, 15, 4);
    g.fillStyle = bg;
    g.fill();
    g.strokeStyle = line;
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = fg;
    g.textAlign = "left";
    g.fillText(text, x + 5, y + 3);
    return w;
  }
  // A health bar the way the game draws one: a sunk track, the fill, its numbers on it.
  function hpBar(x, y, w, h, frac, fill, text) {
    rrect(x, y, w, h, Math.min(6, h / 2));
    g.fillStyle = "#16111b";
    g.fill();
    g.strokeStyle = "rgba(232, 225, 213, .1)";
    g.lineWidth = 1;
    g.stroke();
    if (frac > 0) {
      g.save();
      rrect(x, y, w, h, Math.min(6, h / 2));
      g.clip();
      const gr = g.createLinearGradient(0, y, 0, y + h);
      fill.forEach(([o, c]) => gr.addColorStop(o, c));
      g.fillStyle = gr;
      g.fillRect(x, y, w * clamp(frac, 0, 1), h);
      g.restore();
    }
    if (text) {
      g.font = `700 ${h >= 14 ? 10 : 9}px ${UI}`;
      g.textAlign = "center";
      g.fillStyle = "#fff";
      g.shadowColor = "rgba(0, 0, 0, .85)";
      g.shadowBlur = 3;
      g.fillText(text, x + w / 2, y + h / 2 + 3.5);
      g.shadowBlur = 0;
      g.textAlign = "left";
    }
  }

  function draw() {
    // Nothing is drawn until the canvas has been measured: the first frame would come out stretched.
    if (!cssW) return;
    const s = snap || {};
    const bk = `${s.tier}|${s.zoneIdx}|${party}|${L.mode}|${L.W}|${L.H}|${pxPer}|${s.tier ? ready(landPic(s.tier)) : 0}`;
    if (bk !== backKey || !landLayer) {
      buildBack();
      backKey = bk;
    }
    g.setTransform(pxPer, 0, 0, pxPer, 0, 0);
    g.clearRect(0, 0, L.W, L.H);
    const sk = shake > 0 ? shake * L.u : 0;
    g.save();
    g.translate((rnd() - 0.5) * sk, (rnd() - 0.5) * sk);
    // Pixel for pixel while still; a touch over the frame while it shakes, so no edge shows.
    if (sk) g.drawImage(landLayer, -6, -6, L.W + 12, L.H + 12);
    else g.drawImage(landLayer, 0, 0, L.W, L.H);
    drawEyes();
    if (ringAlpha > 0) {
      g.globalAlpha = ringAlpha;
      g.drawImage(ringLayer, 0, 0, L.W, L.H);
      drawFight();
      g.globalAlpha = 1;
    }
    g.restore();
    if (redEdge > 0) {
      const v = g.createRadialGradient(L.CX, L.CY, 170 * L.u, L.CX, L.CY, Math.max(L.W, L.H) * 0.57);
      v.addColorStop(0, "rgba(200, 40, 20, 0)");
      v.addColorStop(1, `rgba(200, 40, 20, ${0.42 * redEdge})`);
      g.fillStyle = v;
      g.fillRect(0, 0, L.W, L.H);
    }
  }

  function drawEyes() {
    g.save();
    g.globalCompositeOperation = "lighter";
    eyes.forEach((e) => {
      const inA = clamp((t - e.born) / e.fade, 0, 1);
      const outA = e.gone ? 1 - clamp((t - e.gone) / 0.5, 0, 1) : 1;
      const a = ease(inA) * outA;
      if (a <= 0) return;
      const cyc = (t + e.phase) % e.blink;
      const open = cyc < 0.16 ? Math.abs(cyc - 0.08) / 0.08 : 1;
      const vast = e.kind === "vast";
      // A Sovereign's are wider set, violet, long and slanted, and burn steadier.
      const glow = vast ? "#9b4dff" : "#ff5a1a";
      const core = vast ? "#ecd9ff" : "#ffa868";
      const gap = vast ? 9.5 : 4.6;
      [-gap, gap].forEach((dx, i) => {
        const ex = e.x + dx * e.size;
        const tilt = vast ? (i ? -0.22 : 0.22) : 0;
        const gw = vast ? 8 : 9;
        const gh = vast ? 4.2 : 9;
        const cw = vast ? 3.6 : 2.6;
        const ch = vast ? 1.3 : 1.9;
        g.globalAlpha = a * (vast ? 0.5 : 0.3);
        g.fillStyle = glow;
        g.beginPath();
        g.ellipse(ex, e.y, gw * e.size, gh * e.size * Math.max(0.25, open), tilt, 0, TAU);
        g.fill();
        g.globalAlpha = a;
        g.fillStyle = core;
        g.beginPath();
        g.ellipse(ex, e.y, cw * e.size, ch * e.size * Math.max(0.12, open), tilt, 0, TAU);
        g.fill();
      });
    });
    g.restore();
    g.globalAlpha = 1;
  }

  const fadeOf = (f) => (f.dying ? Math.max(0, 1 - f.dying / 0.6) : f.leaving ? Math.max(0, 1 - f.leaving / 0.7) : 1);
  // Whom a foe's next blow is for: its target in a party, you alone.
  const victimOf = (f) => (party ? (f.target && byHunter.get(f.target)) || null : me());

  function drawFight() {
    const A = ringAlpha;
    const tgt = target();
    // The lines in: solid to the one you are all striking, dotted to the rest.
    foes.forEach((f) => {
      const p = foeAt(f);
      const a = rad(f.bearing);
      g.setLineDash(f === tgt ? [] : [2, 5]);
      g.strokeStyle = f === tgt ? "rgba(235, 144, 104, .85)" : "rgba(216, 116, 63, .4)";
      g.lineWidth = f === tgt ? 2 : 1.6;
      g.globalAlpha = A * fadeOf(f) * (1 - f.join) * (party && f !== tgt ? 0.55 : 1);
      g.beginPath();
      g.moveTo(L.CX + Math.cos(a) * (L.RMAX + 34 * L.u) * L.SX, L.CY + Math.sin(a) * (L.RMAX + 34 * L.u));
      g.lineTo(p.x, p.y);
      g.stroke();
    });
    g.setLineDash([]);
    g.globalAlpha = A;
    // In a party, a line from each foe to whoever its next blow is for, burning brighter as the blow comes round.
    if (party) {
      foes.forEach((f) => {
        if (f.dying || f.leaving || f.join > 0.3) return;
        const v = victimOf(f);
        if (!v) return;
        const a = foeAt(f);
        const b = hunterAt(v);
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ux = (b.x - a.x) / d;
        const uy = (b.y - a.y) / d;
        const R = foeR(f, f === tgt);
        const Rv = hr(v) + 9 * L.u;
        const x0 = a.x + ux * (R + 5);
        const y0 = a.y + uy * (R + 5);
        const x1 = b.x - ux * Rv;
        const y1 = b.y - uy * Rv;
        const hot = clamp(1 - f.shown / 900, 0, 1);
        g.save();
        g.globalAlpha = A * (0.26 + 0.64 * hot) * (1 - f.join);
        g.strokeStyle = hot > 0 ? "#ff8a5c" : "#d8743f";
        g.lineWidth = (1.3 + 1.7 * hot) * Math.max(0.8, L.u);
        g.lineCap = "round";
        g.setLineDash(hot > 0 ? [] : [3, 6]);
        if (hot > 0) {
          g.shadowColor = "rgba(255, 120, 70, .8)";
          g.shadowBlur = 8 * hot;
        }
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
        // A small head where it lands.
        g.setLineDash([]);
        g.fillStyle = g.strokeStyle;
        const s = (5 + 3 * hot) * Math.max(0.8, L.u);
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x1 - ux * s * 1.6 - uy * s, y1 - uy * s * 1.6 + ux * s);
        g.lineTo(x1 - ux * s * 1.6 + uy * s, y1 - uy * s * 1.6 - ux * s);
        g.closePath();
        g.fill();
        g.restore();
      });
    }
    fx.filter((e) => e.type === "shock" || e.type === "cracks").forEach(drawFx);
    // Foes: the drawing in its disc, a rim, and the target ringed in ember. Health is on the plate.
    foes.slice().sort((a, b) => foeAt(a).y - foeAt(b).y).forEach((f) => {
      const p = foeAt(f);
      const k = fadeOf(f);
      const R = foeR(f, f === tgt) * (f.dying ? 0.6 + 0.4 * k : 1);
      const alpha = A * k * (1 - f.join * 0.95);
      g.globalAlpha = alpha;
      g.save();
      g.translate(p.x, p.y);
      g.scale(1 + f.squash * 0.1, 1 - f.squash * 0.16);
      g.translate(-p.x, -p.y);
      if (f.sov) {
        // It rules this ground: a bigger disc, a violet rim, the crown over it. Each time it angers it burns hotter.
        const rage = (snap && snap.enrage) || 0;
        g.save();
        g.shadowColor = rage ? "rgba(224, 96, 128, .85)" : "rgba(184, 139, 219, .7)";
        g.shadowBlur = 16 + rage * 7;
        g.fillStyle = "#1a1224";
        g.beginPath();
        g.arc(p.x, p.y, R, 0, TAU);
        g.fill();
        g.restore();
      } else {
        g.fillStyle = f.elite ? "#141a26" : "#1e1210";
        g.beginPath();
        g.arc(p.x, p.y, R, 0, TAU);
        g.fill();
      }
      disc(f.pic, p.x, p.y, R);
      if (f.flash > 0) {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = A * Math.min(1, f.flash) * 0.6 * k;
        g.fillStyle = f.gold > 0 ? "#f2cf7a" : f.sov && f.flash > 1 ? "#e0708a" : "#ffffff";
        g.beginPath();
        g.arc(p.x, p.y, R, 0, TAU);
        g.fill();
        g.restore();
      }
      g.globalAlpha = alpha;
      const ember = (r) => {
        g.save();
        g.shadowColor = "rgba(235, 144, 104, .6)";
        g.shadowBlur = 18;
        g.strokeStyle = "#eb9068";
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(p.x, p.y, r, 0, TAU);
        g.stroke();
        g.restore();
      };
      if (f.sov) {
        g.strokeStyle = "#b88bdb";
        g.lineWidth = 3;
        g.beginPath();
        g.arc(p.x, p.y, R + 1.5, 0, TAU);
        g.stroke();
        if (f === tgt) ember(R + 6);
        const cr = glyphPic("crown", "#e6d3f7");
        if (ready(cr)) {
          const cs = 26 * L.u;
          g.save();
          g.shadowColor = "rgba(184, 139, 219, .9)";
          g.shadowBlur = 10;
          g.drawImage(cr, p.x - cs / 2, p.y - R - cs - 4 * L.u, cs, cs);
          g.restore();
        }
      } else if (f === tgt) {
        ember(R + 1.5);
      } else {
        g.strokeStyle = f.elite ? "rgba(122, 162, 220, .75)" : "rgba(138, 70, 50, .9)";
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(p.x, p.y, R + 1, 0, TAU);
        g.stroke();
      }
      g.restore();
    });
    g.globalAlpha = A;
    // Hunters: the face, the Veil round it, and under it the glyph and name with a health bar.
    hunters.forEach((u) => {
      const p = hunterAt(u);
      const R = hr(u);
      const hidden = u.busy > 0 && u.klass === "rogue" && fx.some((e) => (e.type === "vanish" || e.type === "ghost" || e.type === "streak") && (e.h === u || e.type === "streak"));
      const down = u.down || u.hp <= 0;
      g.globalAlpha = A * (hidden ? 0.18 : down ? 0.45 : 1);
      const wind = fx.find((e) => e.type === "windup" && e.h === u);
      if ((u.veilShown >= 0.995 || wind) && !down) {
        g.save();
        g.shadowColor = "rgba(185, 164, 242, .9)";
        g.shadowBlur = wind ? 40 : 20;
        g.fillStyle = "rgba(157, 130, 224, .22)";
        g.beginPath();
        g.arc(p.x, p.y, R + 9 * L.u, 0, TAU);
        g.fill();
        g.restore();
      }
      g.fillStyle = "#1c1624";
      g.beginPath();
      g.arc(p.x, p.y, R, 0, TAU);
      g.fill();
      if (down) g.filter = "grayscale(1)";
      face(facePic(u.skin), p.x, p.y, R);
      g.filter = "none";
      if (u.flash > 0) {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = A * u.flash * 0.5;
        g.fillStyle = "#ff4a2a";
        g.beginPath();
        g.arc(p.x, p.y, R, 0, TAU);
        g.fill();
        g.restore();
        g.globalAlpha = A * (hidden ? 0.18 : 1);
      }
      if (u.klass) arcRing(p.x, p.y, R + 6 * L.u, u.veilShown, u.veilShown >= 0.995 ? "#dccfff" : "#9d82e0", (u.me ? 4 : 3) * Math.max(0.75, L.u), u.veilShown >= 0.995);
      g.globalAlpha = A;
      let y = p.y + R + 14 * L.u;
      if (u.klass === "mage") {
        drawCharges(p.x, y + 1, u);
        y += 17 * L.u;
      }
      nameLine(u, p.x, y);
      const bh = u.me ? Math.max(12, 15 * L.u) : 6;
      if (u.me) {
        const bw = (party ? 150 : 180) * Math.max(0.8, L.u);
        hpBar(p.x - bw / 2, y + 15 * Math.max(0.85, L.u), bw, bh, u.hp / u.max, HP_FILL, `${fmt(Math.ceil(u.hp))} / ${fmt(u.max)}`);
      } else {
        const bw = 68 * Math.max(0.8, L.u);
        hpBar(p.x - bw / 2, y + 11 * Math.max(0.85, L.u), bw, bh, u.hp / u.max, HP_FILL, null);
      }
    });
    // Plates: whose, how soon it strikes and at whom, what health it has left.
    if (L.plates) foes.forEach((f) => { if (!f.dying && !f.leaving && !f.pending && f.join < 0.5) plate(f, f === tgt); });
    fx.filter((e) => e.type !== "shock" && e.type !== "cracks").forEach(drawFx);
    g.save();
    g.globalCompositeOperation = "lighter";
    parts.forEach((p) => {
      g.globalAlpha = A * clamp(p.life / p.max, 0, 1);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.size, 0, TAU);
      g.fill();
    });
    g.restore();
    g.globalAlpha = A;
  }

  // Under a face: the discipline's glyph, the name, and in a party that hunter's share of the take.
  function nameLine(u, x, y) {
    const big = !!u.me;
    const size = Math.max(big ? 12 : 10.5, (big ? 15 : 12) * L.u);
    const font = `600 ${size}px ${DISPLAY}`;
    const gs = u.klass ? size : 0;
    const gap = u.klass ? 5 : 0;
    g.font = font;
    const name = u.name || "";
    const nw = g.measureText(name).width;
    let st = "";
    let sw = 0;
    if (party && Number.isFinite(u.share)) {
      st = `${Math.round(u.share)}%`;
      g.font = `700 ${Math.max(9, 10 * L.u)}px ${UI}`;
      sw = g.measureText(st).width + 6;
    }
    let cx = x - (gs + gap + nw + sw) / 2;
    const base = y + (big ? 8 : 6) * Math.max(0.85, L.u);
    g.save();
    g.shadowColor = "rgba(0, 0, 0, .9)";
    g.shadowBlur = big ? 6 : 5;
    if (u.klass) {
      const gl = glyphPic(u.klass, big ? "#c9b8ff" : "#aa9dc6");
      if (ready(gl)) g.drawImage(gl, cx, base - gs + (big ? 2 : 1.5), gs, gs);
      cx += gs + gap;
    }
    g.font = font;
    g.textAlign = "left";
    g.fillStyle = big ? "#e8e1d5" : "#cfc6d8";
    g.fillText(name, cx, base);
    if (st) {
      g.font = `700 ${Math.max(9, 10 * L.u)}px ${UI}`;
      g.fillStyle = "#d6c9ff";
      g.fillText(st, cx + nw + 6, base - (big ? 1 : 0));
    }
    g.restore();
  }

  // A Mage's opening casts, one diamond each, spent from the left.
  function drawCharges(x, y, u) {
    const casts = GameData.TECHNIQUE.volley.casts || 3;
    for (let i = 0; i < casts; i++) {
      const cx = x + (i - (casts - 1) / 2) * 15 * L.u;
      const on = i >= casts - u.volley;
      g.save();
      g.translate(cx, y);
      g.rotate(Math.PI / 4);
      const s = 4.2 * Math.max(0.8, L.u);
      if (on) {
        g.shadowColor = "rgba(185, 164, 242, .9)";
        g.shadowBlur = 8;
        g.fillStyle = "#b9a4f2";
        g.fillRect(-s, -s, s * 2, s * 2);
      } else {
        g.strokeStyle = "rgba(185, 164, 242, .45)";
        g.lineWidth = 1.4;
        g.strokeRect(-s, -s, s * 2, s * 2);
      }
      g.restore();
    }
  }

  const plateBox = new Map();   // uid -> [x, y, w, h], for a press on a plate
  function plate(f, isT) {
    const p = foeAt(f);
    const right = Math.cos(rad(f.bearing)) > -0.2;
    const R = foeR(f, isT);
    const chips = [];
    if (isT) chips.push(["TARGET", "#eb9068", "rgba(216, 116, 63, .12)", "rgba(216, 116, 63, .42)"]);
    if (f.sov) chips.push(["SOVEREIGN", "#dcbcf4", "rgba(184, 139, 219, .14)", "rgba(184, 139, 219, .5)"]);
    else if (f.elite) chips.push(["ELITE", "#7aa2dc", "rgba(122, 162, 220, .1)", "rgba(122, 162, 220, .45)"]);
    g.font = `600 14px ${DISPLAY}`;
    const nw = g.measureText(f.name).width;
    g.font = `700 9px ${UI}`;
    const cw = chips.reduce((n, c) => n + g.measureText(c[0]).width + 14, 0);
    const w = Math.max(184, Math.ceil(nw + cw + 22));
    const h = 58;
    const x = clamp(right ? p.x + R + 12 : p.x - R - 12 - w, 6, L.W - w - 6);
    const y = clamp(p.y - 34, 6, L.H - h - 6);
    plateBox.set(f.uid, [x, y, w, h]);
    g.globalAlpha = ringAlpha * clamp(1 - f.join * 2, 0, 1);
    rrect(x, y, w, h, 8);
    g.fillStyle = "rgba(11, 9, 16, .9)";
    g.fill();
    g.strokeStyle = f.sov ? "rgba(184, 139, 219, .3)" : "rgba(232, 225, 213, .08)";
    g.lineWidth = 1;
    g.stroke();
    g.font = `600 14px ${DISPLAY}`;
    g.fillStyle = "#e8e1d5";
    g.textAlign = "left";
    g.fillText(f.name, x + 9, y + 18);
    let cx = x + 15 + nw;
    chips.forEach((c) => { cx += chipAt(cx, y + 14, ...c) + 4; });
    // When it strikes, and in a party at whom. A Sovereign's anger is said beside it.
    const v = party ? victimOf(f) : null;
    const when = f.shown < 250 ? "now" : `in ${(Math.max(0, f.shown) / 1000).toFixed(1)}s`;
    const line = v ? `Strikes ${v.me ? "you" : v.name} ${when}` : `Strikes ${when}`;
    g.font = `500 11px ${UI}`;
    g.fillStyle = "#eb9068";
    g.fillText(line, x + 9, y + 33);
    const rage = (snap && snap.enrage) || 0;
    if (f.sov && rage) {
      const lw = g.measureText(line).width;
      g.font = `700 11px ${UI}`;
      g.fillStyle = "#e8839b";
      g.fillText(`· Enraged ×${rage}`, x + 15 + lw, y + 33);
    }
    hpBar(x + 9, y + 40, w - 18, 12, f.hp / f.max, FOE_FILL, `${fmt(Math.max(0, Math.ceil(f.hp)))} / ${fmt(f.max)}`);
    g.globalAlpha = ringAlpha;
  }

  function drawFx(e) {
    const k = clamp((t - e.born) / e.life, 0, 1);
    const U = L.u;
    g.save();
    switch (e.type) {
      case "slash": {
        const p = foeAt(e.f);
        (e.double ? [e.angle, e.angle + 1.3] : [e.angle]).forEach((a, i) => {
          const kk = clamp(k * 1.6 - i * 0.25, 0, 1);
          if (kk <= 0) return;
          const r = 48 * U;
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = ringAlpha * (1 - kk * 0.9);
          g.strokeStyle = e.color;
          g.lineWidth = e.width * U * (1 - kk * 0.5);
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.8);
          g.quadraticCurveTo(p.x + Math.cos(a + Math.PI / 2) * 14 * U, p.y + Math.sin(a + Math.PI / 2) * 14 * U,
            p.x + Math.cos(a + Math.PI) * r * Math.min(1, kk * 2.2), p.y + Math.sin(a + Math.PI) * r * 0.8 * Math.min(1, kk * 2.2));
          g.stroke();
        });
        break;
      }
      case "claws": {
        const p = hunterAt(e.who);
        const R = hr(e.who);
        const s = e.heavy ? 1.3 : 1;
        g.globalAlpha = ringAlpha * (1 - k);
        g.strokeStyle = "#ff6a3a";
        g.lineCap = "round";
        g.lineWidth = (e.heavy ? 4 : 3) * (e.who.me ? 1 : 0.7) * U;
        for (let i = -1; i <= 1; i++) {
          const off = i * 13 * s * (e.who.me ? 1 : 0.5) * U;
          const len = Math.min(1, k * 4);
          g.beginPath();
          g.moveTo(p.x + off - R * 0.6 * s, p.y - R * 0.7 * s);
          g.lineTo(p.x + off - R * 0.6 * s + R * 1.1 * s * len, p.y - R * 0.7 * s + R * 1.3 * s * len);
          g.stroke();
        }
        break;
      }
      case "windup": {
        const p = hunterAt(e.h);
        const R = hr(e.h);
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 0.5 + 0.5 * k;
        g.strokeStyle = "#d8c9ff";
        g.lineWidth = (3 + 5 * k) * U;
        g.beginPath();
        g.arc(p.x, p.y, R + 12 * U + R * 0.46 * (1 - k), 0, TAU);
        g.stroke();
        break;
      }
      case "shock": {
        // A tight ring where the blow landed, so it reads as one foe struck.
        const rr = (18 + 92 * ease(k)) * U;
        const ring = (m) => {
          g.beginPath();
          g.ellipse(e.x, e.y + 8 * U, rr * L.SX * m, rr * 0.62 * m, 0, 0, TAU);
        };
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = (1 - k) * 0.85;
        g.strokeStyle = "#e6dcff";
        g.lineWidth = (4 * (1 - k) + 1) * U;
        ring(0.7);
        g.stroke();
        g.globalAlpha = (1 - k) * 0.3;
        g.strokeStyle = "#9d82e0";
        g.lineWidth = 2.5 * U;
        ring(0.58);
        g.stroke();
        break;
      }
      case "flashring": {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 1 - k;
        const gr = g.createRadialGradient(e.x, e.y, 0, e.x, e.y, 64 * U);
        gr.addColorStop(0, "rgba(255, 255, 255, .95)");
        gr.addColorStop(0.35, "rgba(201, 184, 255, .55)");
        gr.addColorStop(1, "rgba(157, 130, 224, 0)");
        g.fillStyle = gr;
        g.beginPath();
        g.arc(e.x, e.y, 64 * U, 0, TAU);
        g.fill();
        break;
      }
      case "cracks": {
        g.globalAlpha = (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3) * ringAlpha;
        g.lineCap = "round";
        g.lineJoin = "round";
        e.lines.forEach((pts) => {
          const n = Math.max(2, Math.round(pts.length * Math.min(1, k * 5)));
          const path = () => {
            g.beginPath();
            pts.slice(0, n).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
          };
          g.globalCompositeOperation = "source-over";
          g.strokeStyle = "rgba(10, 6, 6, .9)";
          g.lineWidth = 3.2 * U;
          path();
          g.stroke();
          g.globalCompositeOperation = "lighter";
          g.strokeStyle = "rgba(255, 138, 61, .75)";
          g.lineWidth = 1.3 * U;
          path();
          g.stroke();
        });
        break;
      }
      case "vanish": {
        const p = hunterAt(e.h);
        g.globalAlpha = 1 - k;
        g.fillStyle = "#2b2236";
        g.beginPath();
        g.arc(p.x, p.y, hr(e.h) + 30 * U * k, 0, TAU);
        g.fill();
        break;
      }
      case "streak": {
        const head = ease(k);
        const tail = Math.max(0, head - 0.45);
        g.lineCap = "round";
        for (let i = 0; i < 10; i++) {
          const a = streakAt(e, tail + ((head - tail) * i) / 10);
          const b = streakAt(e, tail + ((head - tail) * (i + 1)) / 10);
          g.globalAlpha = (i / 10) * 0.9;
          g.strokeStyle = i > 6 ? "#b9a4f2" : "#3a2c50";
          g.lineWidth = (3 + i * 1.6) * U;
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
        break;
      }
      case "ghost": {
        const R = 30 * U;
        g.globalAlpha = k < 0.8 ? 0.9 : (1 - k) * 4.5;
        g.save();
        g.shadowColor = "rgba(185, 164, 242, .8)";
        g.shadowBlur = 20;
        g.fillStyle = "#1c1624";
        g.beginPath();
        g.arc(e.x, e.y, R, 0, TAU);
        g.fill();
        g.restore();
        face(facePic(e.h.skin), e.x, e.y, R);
        g.strokeStyle = "#d8c9ff";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(e.x, e.y, R + 1, 0, TAU);
        g.stroke();
        break;
      }
      case "xcut": {
        const p = foeAt(e.f);
        const r = 58 * U;
        const a = e.first ? -0.75 : 0.75;
        const len = Math.min(1, k * 4);
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 1 - k;
        g.lineCap = "round";
        [["#f2cf7a", 8], ["#ffffff", 3]].forEach(([c, w]) => {
          g.strokeStyle = c;
          g.lineWidth = w * U * (1 - k * 0.6);
          g.beginPath();
          g.moveTo(p.x - Math.cos(a) * r, p.y - Math.sin(a) * r);
          g.lineTo(p.x - Math.cos(a) * r + Math.cos(a) * 2 * r * len, p.y - Math.sin(a) * r + Math.sin(a) * 2 * r * len);
          g.stroke();
        });
        break;
      }
      case "gather": {
        const p = hunterAt(e.h);
        const R = hr(e.h);
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = k;
        g.strokeStyle = "#b9a4f2";
        g.lineWidth = (2 + 3 * k) * U;
        g.beginPath();
        g.arc(p.x, p.y, R * (e.big ? 1.35 : 1.1) * (1 - k) + R, 0, TAU);
        g.stroke();
        break;
      }
      case "spend": {
        // The diamond a cast has used flares as it goes.
        const p = hunterAt(e.h);
        const cx = p.x + (e.i - 1) * 15 * U;
        const cy = p.y + hr(e.h) + 15 * U;
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 1 - k;
        g.fillStyle = "#e8dcff";
        g.translate(cx, cy);
        g.rotate(Math.PI / 4);
        const s = (4.2 + 8 * ease(k)) * U;
        g.fillRect(-s, -s, s * 2, s * 2);
        break;
      }
      case "bolt": {
        const { x, y } = boltAt(e, k);
        g.globalCompositeOperation = "lighter";
        const gr = g.createRadialGradient(x, y, 0, x, y, e.size * 3.4);
        gr.addColorStop(0, "rgba(232, 220, 255, 1)");
        gr.addColorStop(0.35, "rgba(157, 130, 224, .8)");
        gr.addColorStop(1, "rgba(108, 82, 192, 0)");
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, e.size * 3.4, 0, TAU);
        g.fill();
        break;
      }
      case "bloom": {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 1 - k;
        g.strokeStyle = "#c9b8ff";
        g.lineWidth = ((e.big ? 9 : 6) * (1 - k) + 1) * U;
        g.beginPath();
        g.arc(e.x, e.y, (20 + (e.big ? 80 : 56) * ease(k)) * U, 0, TAU);
        g.stroke();
        break;
      }
      case "arc": {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = (1 - k) * (0.6 + rnd() * 0.4);
        g.strokeStyle = "#d8c9ff";
        g.lineWidth = 2.2 * U;
        g.lineJoin = "round";
        g.beginPath();
        g.moveTo(e.from.x, e.from.y);
        for (let i = 1; i < 9; i++) {
          const q = i / 9;
          g.lineTo(e.from.x + (e.to.x - e.from.x) * q + (rnd() - 0.5) * 26 * U, e.from.y + (e.to.y - e.from.y) * q + (rnd() - 0.5) * 26 * U);
        }
        g.lineTo(e.to.x, e.to.y);
        g.stroke();
        break;
      }
      case "rage": {
        // It angers: a ring of it goes out from the Sovereign, rose over violet.
        const p = foeAt(e.f);
        const R = foeR(e.f, false);
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = (1 - k) * 0.9;
        g.strokeStyle = "#e8839b";
        g.lineWidth = (4 * (1 - k) + 1) * U;
        g.beginPath();
        g.arc(p.x, p.y, R + (8 + 46 * ease(k)) * U, 0, TAU);
        g.stroke();
        g.globalAlpha = (1 - k) * 0.55;
        g.strokeStyle = "#b88bdb";
        g.lineWidth = 2 * U;
        g.beginPath();
        g.arc(p.x, p.y, R + (5 + 26 * ease(k)) * U, 0, TAU);
        g.stroke();
        break;
      }
      case "felled": {
        // A Sovereign falls: a violet bloom and rays going out along the ground.
        g.globalCompositeOperation = "lighter";
        const r = (40 + 170 * ease(k)) * U;
        const gr = g.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
        gr.addColorStop(0, `rgba(243, 236, 255, ${0.75 * (1 - k)})`);
        gr.addColorStop(0.4, `rgba(184, 139, 219, ${0.4 * (1 - k)})`);
        gr.addColorStop(1, "rgba(108, 63, 143, 0)");
        g.fillStyle = gr;
        g.beginPath();
        g.arc(e.x, e.y, r, 0, TAU);
        g.fill();
        g.globalAlpha = 1 - k;
        g.strokeStyle = "#e6d6ff";
        g.lineWidth = 2 * U;
        g.lineCap = "round";
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU + 0.2;
          const r0 = (44 + 70 * ease(k)) * U;
          const r1 = r0 + 36 * U * (1 - k);
          g.beginPath();
          g.moveTo(e.x + Math.cos(a) * r0 * 1.3, e.y + Math.sin(a) * r0 * 0.75);
          g.lineTo(e.x + Math.cos(a) * r1 * 1.3, e.y + Math.sin(a) * r1 * 0.75);
          g.stroke();
        }
        break;
      }
      case "callout": {
        const up = ease(Math.min(1, k * 3)) * 14 * U;
        g.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
        g.font = `700 ${Math.max(13, 18 * U)}px ${DISPLAY}`;
        g.textAlign = "center";
        g.lineWidth = 5;
        g.strokeStyle = "rgba(0, 0, 0, .85)";
        g.strokeText(e.text, e.x, e.y - up);
        g.fillStyle = "#eb9068";
        g.fillText(e.text, e.x, e.y - up);
        break;
      }
      default: break;
    }
    g.restore();
  }

  /* ================= 9. SIZE, TIME AND TOUCH ================= */

  function fit() {
    const box = canvas.getBoundingClientRect();
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    if (!w || !h) return;
    if (w === cssW && h === cssH && L.party === party) return;
    cssW = w;
    cssH = h;
    const was = L.mode;
    L = layoutFor(w, h, party);
    L.party = party;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    pxPer = (w * dpr) / L.W;
    canvas.width = Math.max(1, Math.round(L.W * pxPer));
    canvas.height = Math.max(1, Math.round(L.H * pxPer));
    backKey = "";
    dirty = true;
    if (was !== L.mode) onMode(L.mode);
    wake();
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (L.party !== party) fit();
    let left = dt;
    while (left > 0) {
      const d = Math.min(1 / 120, left);
      step(d);
      left -= d;
    }
    if (dirty || busy()) {
      draw();
      // The ground is a picture drawn once: until it has come in, look again next frame.
      dirty = !!(snap && snap.tier && !ready(landPic(snap.tier)));
    }
    // A quiet walk with nothing in the dark does not need the screen's every frame.
    if (busy() || dirty) raf = requestAnimationFrame(frame);
    else running = false;
  }

  function wake() {
    if (running || !seen || (typeof document !== "undefined" && document.hidden)) return;
    running = true;
    lastFrame = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function sleep() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const onVisible = () => {
    if (document.hidden) sleep();
    else {
      dirty = true;
      wake();
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => fit()) : null;
  if (ro) ro.observe(canvas);
  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
    seen = entries.some((e) => e.isIntersecting);
    if (seen) {
      dirty = true;
      wake();
    } else sleep();
  }) : null;
  if (io) io.observe(canvas);

  // A press on a foe (its disc, or its plate) opens it, as the old cards did.
  function foeUnder(ev) {
    const box = canvas.getBoundingClientRect();
    if (!box.width) return null;
    const x = ((ev.clientX - box.left) / box.width) * L.W;
    const y = ((ev.clientY - box.top) / box.height) * L.H;
    const tgt = target();
    let hit = null;
    standingFoes().forEach((f) => {
      const p = foeAt(f);
      if (Math.hypot(x - p.x, y - p.y) <= foeR(f, f === tgt) + 4) hit = f;
      const b = L.plates ? plateBox.get(f.uid) : null;
      if (b && x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3]) hit = f;
    });
    return ringAlpha > 0.5 ? hit : null;
  }
  const onClick = (ev) => {
    const f = foeUnder(ev);
    if (f) onFoe(f.id);
  };
  const onMove = (ev) => {
    canvas.style.cursor = foeUnder(ev) ? "pointer" : "";
  };
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("pointermove", onMove);

  // The fonts the plates are written in: drawn before they arrive, a name would come out in the fallback.
  if (document.fonts && typeof document.fonts.load === "function") {
    Promise.all([`600 15px ${DISPLAY}`, `700 18px ${DISPLAY}`, `500 11px ${UI}`, `700 9px ${UI}`].map((f) => document.fonts.load(f)))
      .catch(() => {})
      .finally(() => {
        dirty = true;
        wake();
      });
  }

  return {
    node: canvas,
    canvas,
    sync,
    blow,
    get mode() { return L.mode; },
    fit,
    // Everything off the ring at once, with no falls or partings: the page moved on.
    clear() {
      reset();
      key = null;
      snap = null;
      dirty = true;
      wake();
    },
    destroy() {
      sleep();
      document.removeEventListener("visibilitychange", onVisible);
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("pointermove", onMove);
    },
  };
}
