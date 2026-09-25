/* ============================================================
   Respite · ui/region-map.js · The Lay of the Land
   ------------------------------------------------------------
   One drawn map a region, for the Hunt page's Zones: the ground
   itself, then its four zones as contour rings from the Outer
   edge to the Core, the camp on the rim and the Sovereign's lair
   at the heart. regionMap(tier, prefix) returns the inner markup
   of an <svg viewBox="0 0 640 400">; ui/zone-map.js lays the
   hunters over it.

   Each map is drawn from its region's name and note: ash and
   burnt stumps at the camp's edge, peat pools and gibbets, snow
   over tunnel mouths, pine and cairns on a shelf, water that
   does not reflect, old growth round fallen star iron, warm
   cracked stone over something breathing, ruins in a thin mist,
   roots the width of streets.

   The rings are the only part that answers the pointer: each is
   a band (path.zm-band, data-zone) with the next one cut out of
   it, so a press lands on exactly one zone. Everything else is
   drawn under or over them with pointer-events off.

   Seeded per tier, so the same region always draws the same
   map. Pure string building. No DOM, so it runs in node too.
   ============================================================ */

import { GameData } from "../../shared/registry.js";

export const MAP_W = 640;
export const MAP_H = 400;
export const MAP_VIEWBOX = `0 0 ${MAP_W} ${MAP_H}`;

const ZONES = GameData.ZONES;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const RING = [150, 116, 83, 51];   // Outer to Core, in ring units
const RX = 1.5;                     // a ring unit across
const RY = 0.95;                    // and down: the land is seen from a slant
const LAIR = 17;                    // the heart, in ring units

/* ================= 1. NUMBERS ================= */

const f = (v) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
};
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================= 2. PATHS ================= */

const pt = ([x, y]) => `${f(x)} ${f(y)}`;
const poly = (pts, close = false) => pts.map((p, i) => `${i ? "L" : "M"}${pt(p)}`).join("") + (close ? "Z" : "");
const circ = (x, y, r) => `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;
const ell = (x, y, rx, ry) => `M${f(x - rx)} ${f(y)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0`;

// Catmull-Rom through the points, as cubic Beziers: a line that bends rather than kinks.
function smooth(pts, closed = false) {
  const n = pts.length;
  if (n < 3) return poly(pts, closed);
  const at = (i) => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
  let d = `M${pt(pts[0])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return closed ? `${d}Z` : d;
}

// A lumpy closed shape round a point: pools, drifts, stains, slabs.
function blob(r, x, y, rx, ry, { n = 9, jitter = 0.28, rot = 0 } = {}) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU;
    const m = 1 + (r() * 2 - 1) * jitter;
    const px = Math.cos(a) * rx * m;
    const py = Math.sin(a) * ry * m;
    pts.push([x + px * c - py * s, y + px * s + py * c]);
  }
  return smooth(pts, true);
}

// A crack that wanders: a polyline that turns a little at every step, now and then forking.
function crack(r, x, y, a, len, { step = 6, turn = 0.55, fork = 0.18, depth = 0 } = {}) {
  const pts = [[x, y]];
  let d = "";
  let px = x;
  let py = y;
  let left = len;
  while (left > 0) {
    a += (r() * 2 - 1) * turn;
    const s = Math.min(left, step * (0.6 + r() * 0.8));
    px += Math.cos(a) * s;
    py += Math.sin(a) * s;
    pts.push([px, py]);
    left -= s;
    if (depth < 2 && r() < fork && left > step * 2) {
      d += crack(r, px, py, a + (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.5), left * (0.35 + r() * 0.3), { step, turn, fork: fork * 0.5, depth: depth + 1 });
    }
  }
  return poly(pts) + d;
}

/* Cracked ground: a jittered grid of sites and each one's cell, cut by the
   bisector with every neighbour (a Voronoi diagram, near enough), then drawn
   a little inside itself so the seams between show. */
function cells(r, { size = 26, squash = 1, jitter = 0.85, inset = 1.2, box = [-24, -24, MAP_W + 24, MAP_H + 24] } = {}) {
  const sy = size * squash;
  const cols = Math.ceil((box[2] - box[0]) / size);
  const rows = Math.ceil((box[3] - box[1]) / sy);
  const site = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      site.push([box[0] + (i + 0.5 + (r() - 0.5) * jitter) * size, box[1] + (j + 0.5 + (r() - 0.5) * jitter) * sy]);
    }
  }
  const at = (i, j) => (i >= 0 && j >= 0 && i < cols && j < rows ? site[j * cols + i] : null);
  const out = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = at(i, j);
      const w = size * 2;
      let shape = [[p[0] - w, p[1] - w], [p[0] + w, p[1] - w], [p[0] + w, p[1] + w], [p[0] - w, p[1] + w]];
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const q = (di || dj) ? at(i + di, j + dj) : null;
          if (q) shape = clipHalf(shape, p, q);
        }
      }
      if (shape.length < 3) continue;
      const c = shape.reduce((m, v) => [m[0] + v[0] / shape.length, m[1] + v[1] / shape.length], [0, 0]);
      const rad = shape.reduce((m, v) => m + Math.hypot(v[0] - c[0], v[1] - c[1]), 0) / shape.length;
      const k = Math.max(0, 1 - inset / Math.max(1, rad));
      out.push({ c, pts: shape.map((v) => [c[0] + (v[0] - c[0]) * k, c[1] + (v[1] - c[1]) * k]) });
    }
  }
  return out;
}

// Keeps the part of a polygon nearer p than q.
function clipHalf(pts, p, q) {
  const mx = (p[0] + q[0]) / 2;
  const my = (p[1] + q[1]) / 2;
  const nx = q[0] - p[0];
  const ny = q[1] - p[1];
  const side = (v) => (v[0] - mx) * nx + (v[1] - my) * ny;
  const res = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    const sa = side(a);
    const sb = side(b);
    if (sa <= 0) res.push(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      res.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return res;
}

/* ================= 3. THE LAY OF EACH MAP ================= */
/* Where the heart sits, which way the camp lies (degrees, 0 east, 90 south)
   and the seed the contours wobble on. Camps alternate sides so no two
   neighbouring regions come in from the same edge. */

const LAYOUT = {
  1: { cx: 338, cy: 208, camp: 150, seed: 1.3 },
  2: { cx: 318, cy: 204, camp: 32, seed: 4.1 },
  3: { cx: 334, cy: 210, camp: 158, seed: 2.6 },
  4: { cx: 316, cy: 206, camp: 26, seed: 5.3 },
  5: { cx: 336, cy: 208, camp: 146, seed: 0.7 },
  6: { cx: 322, cy: 204, camp: 34, seed: 3.4 },
  7: { cx: 334, cy: 210, camp: 154, seed: 6.1 },
  8: { cx: 320, cy: 206, camp: 28, seed: 2.2 },
  9: { cx: 328, cy: 206, camp: 148, seed: 4.8 },
};

const layoutOf = (tier) => LAYOUT[tier] || LAYOUT[1];

// A ring's reach at angle a, in ring units. The rings share their broad shape, as contours
// do, and only differ in the small wobble, so no two of them ever touch.
function ringUnits(L, i, a) {
  const s = L.seed;
  const shared = 1 + 0.065 * Math.sin(2 * a + s) + 0.045 * Math.sin(3 * a + s * 1.7) + 0.02 * Math.sin(4 * a + s * 2.9);
  const own = 0.028 * Math.sin(5 * a + s * 0.9 + i * 1.9) + 0.016 * Math.sin(8 * a + s * 2.3 + i * 0.7);
  return RING[i] * (shared + own);
}

const onMap = (L, u, a) => [L.cx + u * RX * Math.cos(a), L.cy + u * RY * Math.sin(a)];

// Halfway across a zone's band at angle a, in ring units. The Core's band runs out from the lair.
function bandMid(L, i, a) {
  const inner = i < ZONES.length - 1 ? ringUnits(L, i + 1, a) : LAIR * 1.3;
  return (ringUnits(L, i, a) + inner) / 2;
}

function ringPath(L, i, steps = 48) {
  const pts = [];
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * TAU;
    pts.push(onMap(L, ringUnits(L, i, a), a));
  }
  return smooth(pts, true);
}

// How deep a point lies: 1 on the Outer ring, 0 at the heart, over 1 outside.
function depthAt(L, x, y) {
  const dx = (x - L.cx) / RX;
  const dy = (y - L.cy) / RY;
  const a = Math.atan2(dy, dx);
  return Math.hypot(dx, dy) / ringUnits(L, 0, a);
}

// Which zone a point is in (0 Outer to 3 Core), or -1 outside them all.
function zoneAt(L, x, y) {
  const dx = (x - L.cx) / RX;
  const dy = (y - L.cy) / RY;
  const a = Math.atan2(dy, dx);
  const u = Math.hypot(dx, dy);
  let z = -1;
  for (let i = 0; i < RING.length; i++) if (u <= ringUnits(L, i, a)) z = i;
  return z;
}

function campAt(L) {
  const a = L.camp * DEG;
  const [x, y] = onMap(L, ringUnits(L, 0, a) * 1.17, a);
  return [clamp(x, 40, MAP_W - 40), clamp(y, 40, MAP_H - 30)];
}

/* ================= 4. GEOMETRY FOR THE PAGE ================= */
/* Positions are in the drawing's own units (0 to 640 across, 0 to 400 down);
   the page turns them into percentages of the box the drawing fills. */

// Where a zone's name sits: the top of its band.
export function labelSpot(tier, zoneIndex) {
  const L = layoutOf(tier);
  const a = -90 * DEG;
  const [x, y] = onMap(L, bandMid(L, zoneIndex, a), a);
  return { x, y };
}

export function campSpot(tier) {
  const [x, y] = campAt(layoutOf(tier));
  return { x, y };
}

// Which zone a point on the map falls in, or null outside them all.
export function zoneOf(tier, x, y) {
  const z = zoneAt(layoutOf(tier), x, y);
  return z < 0 ? null : ZONES[z].id;
}

export function heartSpot(tier) {
  const L = layoutOf(tier);
  return { x: L.cx, y: L.cy };
}

/* Places a hunter can stand in a zone, `gap` units apart along the middle of
   its band, clear of the zone's name and of the camp road. Ordered round the
   band from the south, so the first few are the ones a glance finds first. */
export function pinSlots(tier, zoneIndex, gap = 30, labelHalf = 30) {
  const L = layoutOf(tier);
  const N = 540;
  const pts = [];
  for (let k = 0; k <= N; k++) {
    const a = 90 * DEG + (k / N) * TAU;
    pts.push({ a, p: onMap(L, bandMid(L, zoneIndex, a), a) });
  }
  const top = labelSpot(tier, zoneIndex);
  const road = zoneIndex === 0 ? onMap(L, bandMid(L, 0, L.camp * DEG), L.camp * DEG) : null;
  const clear = ([x, y]) => {
    if (Math.abs(x - top.x) < labelHalf + gap * 0.45 && Math.abs(y - top.y) < gap * 0.75) return false;
    if (road && Math.hypot(x - road[0], y - road[1]) < gap * 0.8) return false;
    return true;
  };
  // Measured as the crow flies, not along the band: round the tight ends of a small ring the
  // two are not the same, and it is the straight distance that keeps two faces apart.
  const out = [];
  let last = null;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k].p;
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < gap) continue;
    if (!clear(p)) continue;
    if (out.length && Math.hypot(p[0] - out[0].x, p[1] - out[0].y) < gap) break;
    last = p;
    out.push({ x: p[0], y: p[1], a: pts[k].a });
  }
  return out;
}

/* Every hunter a spot. `hunters` is [{ id, zone, kind }] with kind "me",
   "party" or "realm". You stand in the south of your band, your party beside
   you, and everyone else on a spot their name picks, so a hunter keeps their
   place between one look and the next. A band with more hunters than spots
   gives its last spot to a count of the rest. */
export function placePins(tier, hunters, gap = 30) {
  const placed = [];
  const more = [];
  ZONES.forEach((z, zi) => {
    const here = hunters.filter((u) => u && u.zone === z.id);
    if (!here.length) return;
    const slots = pinSlots(tier, zi, gap);
    if (!slots.length) return;
    const taken = new Array(slots.length).fill(false);
    const room = here.length > slots.length ? slots.length - 1 : slots.length;
    const order = here.slice().sort((a, b) => rank(a) - rank(b) || String(a.id).localeCompare(String(b.id)));
    let kept = 0;
    order.forEach((u) => {
      if (kept >= room) return;
      let at = -1;
      if (u.kind === "me") at = 0;
      else if (u.kind === "party") at = nearestFree(taken, 0);
      else at = probe(taken, hashStr(`${tier}:${u.id}`) % slots.length);
      if (at < 0) return;
      taken[at] = true;
      kept++;
      placed.push({ id: u.id, zone: z.id, x: slots[at].x, y: slots[at].y });
    });
    if (kept < here.length) {
      const at = probe(taken, slots.length - 1);
      if (at >= 0) more.push({ zone: z.id, count: here.length - kept, x: slots[at].x, y: slots[at].y });
    }
  });
  return { placed, more };
}

const rank = (u) => (u.kind === "me" ? 0 : u.kind === "party" ? 1 : 2);

function nearestFree(taken, from) {
  for (let d = 0; d < taken.length; d++) {
    for (const i of [from + d, from - d]) {
      const k = ((i % taken.length) + taken.length) % taken.length;
      if (!taken[k]) return k;
    }
  }
  return -1;
}

function probe(taken, from) {
  for (let d = 0; d < taken.length; d++) {
    const k = (from + d) % taken.length;
    if (!taken[k]) return k;
  }
  return -1;
}

/* ================= 5. THE SKETCH ================= */
/* A page of layers. Terrain goes down first, then the vignette, then the
   bands that answer the pointer, then the contour lines, the lair, the road
   and the camp, then the frame. */

class Sketch {
  constructor(tier, prefix) {
    this.tier = tier;
    this.p = prefix;
    this.L = layoutOf(tier);
    this.r = mulberry(hashStr(`region-map:${tier}`));
    this.defs = [];
    this.under = [];
    this.over = [];
    const [kx, ky] = campAt(this.L);
    this.camp = [kx, ky];
    // Room kept clear of big features: the title, the compass, the camp and the heart.
    this.keepOut = [
      { rect: [10, 10, 236, 62] },
      { c: [MAP_W - 36, 40], r: 30 },
      { c: [kx, ky], r: 24 },
      { c: [this.L.cx, this.L.cy], r: 34, sy: 0.7 },
    ];
    // And a little room round each zone's name, so it reads off bare ground.
    ZONES.forEach((z, i) => {
      const p = labelSpot(tier, i);
      this.keepOut.push({ rect: [p.x - 30, p.y - 8, p.x + 30, p.y + 8] });
    });
  }

  id(name) {
    return `${this.p}${name}`;
  }

  url(name) {
    return `url(#${this.id(name)})`;
  }

  depth(x, y) {
    return depthAt(this.L, x, y);
  }

  zone(x, y) {
    return zoneAt(this.L, x, y);
  }

  clearOf(x, y, pad = 0) {
    return this.keepOut.every((k) => {
      if (k.rect) return !(x > k.rect[0] - pad && x < k.rect[2] + pad && y > k.rect[1] - pad && y < k.rect[3] + pad);
      const sy = k.sy || 1;
      return Math.hypot(x - k.c[0], (y - k.c[1]) / sy) > k.r + pad;
    });
  }

  /* Dart throwing: up to n points at least `gap` apart, inside the frame and
     clear of the kept room, each passing `keep` if given. */
  scatter(n, { gap = 10, pad = 0, keep = null, box = [14, 14, MAP_W - 14, MAP_H - 14], avoid = [] } = {}) {
    const r = this.r;
    const out = [];
    const tries = n * 40;
    for (let t = 0; t < tries && out.length < n; t++) {
      const x = lerp(box[0], box[2], r());
      const y = lerp(box[1], box[3], r());
      if (!this.clearOf(x, y, pad)) continue;
      if (keep && !keep(x, y)) continue;
      if (out.some((q) => Math.hypot(q[0] - x, q[1] - y) < gap)) continue;
      if (avoid.some((q) => Math.hypot(q[0] - x, q[1] - y) < (q[2] || gap))) continue;
      out.push([x, y]);
    }
    return out;
  }

  add(markup) {
    this.under.push(markup);
  }

  top(markup) {
    this.over.push(markup);
  }

  def(markup) {
    this.defs.push(markup);
  }

  /* The ground: a base colour, broad patches of a second one, and grain.
     Both textures are noise, drawn once by the browser; nothing moves. */
  ground({ base, patch, patchAlpha = 0.7, grain, grainAlpha = 0.5, freq = "0.011 0.016", grainFreq = 0.85 }) {
    const [pr, pg, pb] = rgb01(patch);
    const [gr, gg, gb] = rgb01(grain);
    const seed = 3 + this.tier * 7;
    this.def(`<filter id="${this.id("patch")}" x="0" y="0" width="${MAP_W}" height="${MAP_H}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}"/><feColorMatrix type="matrix" values="0 0 0 0 ${pr} 0 0 0 0 ${pg} 0 0 0 0 ${pb} 2.6 0 0 0 -1.25"/></filter>`);
    this.def(`<filter id="${this.id("grain")}" x="0" y="0" width="${MAP_W}" height="${MAP_H}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${grainFreq}" numOctaves="1" seed="${seed + 1}"/><feColorMatrix type="matrix" values="0 0 0 0 ${gr} 0 0 0 0 ${gg} 0 0 0 0 ${gb} 3.2 0 0 0 -1.9"/></filter>`);
    this.def(`<radialGradient id="${this.id("vig")}" cx="50%" cy="52%" r="68%"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".62"/></radialGradient>`);
    this.add(`<rect width="${MAP_W}" height="${MAP_H}" fill="${base}"/>`);
    this.add(`<rect width="${MAP_W}" height="${MAP_H}" filter="${this.url("patch")}" opacity="${patchAlpha}"/>`);
    this.add(`<rect width="${MAP_W}" height="${MAP_H}" filter="${this.url("grain")}" opacity="${grainAlpha}"/>`);
  }

  blurs() {
    [1.2, 2.5, 5, 9].forEach((s, i) => {
      this.def(`<filter id="${this.id(`b${i}`)}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${s}"/></filter>`);
    });
  }

  // A glow at the heart in the region's own colour: the ground gets worse toward it.
  heartGlow(color, alpha = 0.5, reach = 1.3) {
    const L = this.L;
    this.def(`<radialGradient id="${this.id("heart")}"><stop offset="0" stop-color="${color}" stop-opacity="${alpha}"/><stop offset=".45" stop-color="${color}" stop-opacity="${alpha * 0.35}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`);
    this.add(`<ellipse cx="${f(L.cx)}" cy="${f(L.cy)}" rx="${f(RING[2] * RX * reach)}" ry="${f(RING[2] * RY * reach)}" fill="${this.url("heart")}"/>`);
  }

  vignette() {
    this.add(`<rect width="${MAP_W}" height="${MAP_H}" fill="${this.url("vig")}"/>`);
  }

  rings() {
    const L = this.L;
    const paths = ZONES.map((z, i) => ringPath(L, i));
    const bands = ZONES.map((z, i) => {
      const d = i < ZONES.length - 1 ? `${paths[i]}${paths[i + 1]}` : paths[i];
      return `<path class="zm-band z${i}" data-zone="${z.id}" fill-rule="evenodd" d="${d}"/>`;
    }).join("");
    const lines = ZONES.map((z, i) =>
      `<path class="zm-halo z${i}" d="${paths[i]}"/><path class="zm-line z${i}" data-zone="${z.id}" d="${paths[i]}"/>`).join("");
    return `<g class="zm-bands">${bands}</g><g class="zm-lines" pointer-events="none">${lines}</g>`;
  }

  // The way in from the camp: a trodden line to the Outer band.
  road() {
    const L = this.L;
    const a = L.camp * DEG;
    const [x0, y0] = this.camp;
    const [x2, y2] = onMap(L, bandMid(L, 0, a) * 0.98, a);
    const bend = (L.camp > 90 ? -1 : 1) * 18;
    const mx = (x0 + x2) / 2 + bend * Math.sin(a);
    const my = (y0 + y2) / 2 - bend * Math.cos(a);
    return `<path class="zm-road" d="M${f(x0)} ${f(y0)}Q${f(mx)} ${f(my)} ${f(x2)} ${f(y2)}"/>`;
  }

  campMark() {
    const [x, y] = this.camp;
    // A tent and its fire, small: the one gold thing on the map.
    return `<g class="zm-camp" transform="translate(${f(x)} ${f(y)})"><circle r="11" class="zm-camp-halo"/><path class="zm-camp-tent" d="M-6.5 4L0 -6.5L6.5 4Z"/><path class="zm-camp-door" d="M-1.6 4L0 0.6L1.6 4Z"/></g>`;
  }

  frame() {
    const ticks = [];
    for (let x = 40; x < MAP_W; x += 40) ticks.push(`M${x} 9V13M${x} ${MAP_H - 9}V${MAP_H - 13}`);
    for (let y = 40; y < MAP_H; y += 40) ticks.push(`M9 ${y}H13M${MAP_W - 9} ${y}H${MAP_W - 13}`);
    const corner = (x, y) => `M${x} ${y - 4}L${x + 4} ${y}L${x} ${y + 4}L${x - 4} ${y}Z`;
    return `<g class="zm-frame" pointer-events="none"><rect x="5.5" y="5.5" width="${MAP_W - 11}" height="${MAP_H - 11}" rx="9"/><rect class="zm-frame-in" x="9.5" y="9.5" width="${MAP_W - 19}" height="${MAP_H - 19}" rx="6"/><path class="zm-tick" d="${ticks.join("")}"/><path class="zm-corner" d="${corner(9.5, 9.5)}${corner(MAP_W - 9.5, 9.5)}${corner(9.5, MAP_H - 9.5)}${corner(MAP_W - 9.5, MAP_H - 9.5)}"/></g>`;
  }

  compass() {
    const x = MAP_W - 36;
    const y = 40;
    const star = (s, w) => `M0 ${-s}L${w} ${-w}L${s} 0L${w} ${w}L0 ${s}L${-w} ${w}L${-s} 0L${-w} ${-w}Z`;
    return `<g class="zm-compass" transform="translate(${x} ${y})" pointer-events="none"><circle r="15"/><path class="zm-compass-lo" d="${star(12, 2.6)}"/><path class="zm-compass-hi" d="M0 -12L2.6 -2.6L0 0L-2.6 -2.6Z"/><text y="-19" text-anchor="middle">N</text></g>`;
  }

  title() {
    const region = GameData.REGIONS.find((g) => g.tier === this.tier);
    if (!region) return "";
    return `<g class="zm-cart" pointer-events="none"><text class="zm-cart-lv" x="22" y="31">LV ${region.level}</text><text class="zm-cart-name" x="22" y="51">${esc(region.name)}</text></g>`;
  }

  // The Sovereign's mark over the lair: a small crown.
  crown(y = -21) {
    const L = this.L;
    return `<path class="zm-crown" d="M${f(L.cx - 6)} ${f(L.cy + y + 3)}L${f(L.cx - 6.5)} ${f(L.cy + y - 3)}L${f(L.cx - 3)} ${f(L.cy + y)}L${f(L.cx)} ${f(L.cy + y - 5)}L${f(L.cx + 3)} ${f(L.cy + y)}L${f(L.cx + 6.5)} ${f(L.cy + y - 3)}L${f(L.cx + 6)} ${f(L.cy + y + 3)}Z"/>`;
  }

  markup(heart) {
    return [
      `<defs>${this.defs.join("")}</defs>`,
      `<g class="zm-land" pointer-events="none">${this.under.join("")}</g>`,
      this.rings(),
      `<g class="zm-heart" pointer-events="none">${heart}${this.crown()}</g>`,
      `<g pointer-events="none">${this.over.join("")}${this.road()}${this.campMark()}</g>`,
      this.frame(),
      this.compass(),
      this.title(),
    ].join("");
  }
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function rgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => Math.round(v * 1000) / 1000);
}

const path = (d, attrs) => (d ? `<path d="${d}" ${attrs}/>` : "");

/* ================= 6. THE NINE ================= */

/* ---------- 1. The Ashen Verge: dead ground at the camp's edge ---------- */
function ashenVerge(S) {
  const r = S.r;
  S.ground({ base: "#211f1d", patch: "#3a3632", patchAlpha: 0.75, grain: "#9a9186", grainAlpha: 0.3 });
  S.blurs();
  S.heartGlow("#d8743f", 0.3);

  // Scorch: where it burned hottest the ground is black, not grey.
  let scorch = "";
  S.scatter(16, { gap: 60, pad: -20 }).forEach(([x, y]) => {
    scorch += blob(r, x, y, 20 + r() * 26, 10 + r() * 12, { jitter: 0.4, rot: r() * TAU });
  });
  S.add(path(scorch, `fill="#0c0b0a" opacity=".45" filter="${S.url("b2")}"`));

  // Ash blown across it, all one way.
  let drift = "";
  S.scatter(26, { gap: 38, pad: -30 }).forEach(([x, y]) => {
    drift += blob(r, x, y, 24 + r() * 34, 4 + r() * 5, { rot: -0.3 + (r() - 0.5) * 0.2, jitter: 0.35 });
  });
  S.add(path(drift, `fill="#b8afa3" opacity=".12" filter="${S.url("b1")}"`));

  // Cracked earth.
  let cracks = "";
  S.scatter(30, { gap: 32 }).forEach(([x, y]) => {
    cracks += crack(r, x, y, r() * TAU, 22 + r() * 40, { step: 5, fork: 0.3 });
  });
  S.add(path(cracks, `fill="none" stroke="#0a0908" stroke-width="1.2" stroke-linecap="round" opacity=".85"`));
  S.add(path(cracks, `fill="none" stroke="#5a524a" stroke-width=".5" stroke-linecap="round" opacity=".35" transform="translate(.9 .9)"`));

  // Burnt stumps and snags, with the fire still in some of them.
  let shade = "";
  let wood = "";
  let lit = "";
  let embers = "";
  S.scatter(40, { gap: 24, pad: 6 }).forEach(([x, y], i) => {
    const s = 0.95 + r() * 0.6;
    shade += ell(x + 3 * s, y, 7 * s, 1.8 * s);
    if (i % 2 === 0) {
      // A snag: a trunk and what is left of its branches.
      const hgt = 16 * s + r() * 7;
      wood += poly([[x - 2 * s, y], [x - 0.8 * s, y - hgt], [x + 0.2 * s, y - hgt - 2.4 * s], [x + 1 * s, y - hgt + 1], [x + 2 * s, y]], true);
      const bh = y - hgt * (0.45 + r() * 0.2);
      wood += poly([[x - 0.3, bh], [x - 6.5 * s, bh - 5.5 * s], [x - 7 * s, bh - 4.6 * s], [x - 0.3, bh + 1.6]], true);
      const bh2 = y - hgt * (0.65 + r() * 0.15);
      wood += poly([[x + 0.3, bh2], [x + 5.5 * s, bh2 - 6.5 * s], [x + 6 * s, bh2 - 5.7 * s], [x + 0.4, bh2 + 1.4]], true);
      lit += poly([[x + 0.8 * s, y - 1], [x + 1.2 * s, y - hgt * 0.7], [x + 1.9 * s, y - 1]], true);
    } else {
      wood += poly([[x - 3.4 * s, y], [x - 2.8 * s, y - 6 * s], [x - 1.6 * s, y - 7.6 * s], [x - 0.6 * s, y - 5.6 * s], [x + 0.5 * s, y - 8 * s], [x + 1.6 * s, y - 6 * s], [x + 2.6 * s, y - 7 * s], [x + 3.3 * s, y]], true);
      lit += poly([[x + 1.4 * s, y - 0.5], [x + 2.2 * s, y - 6 * s], [x + 3.2 * s, y - 0.5]], true);
    }
    if (r() < 0.6) embers += circ(x + (r() - 0.5) * 7, y - 1 - r() * 4, 0.9 + r() * 0.9);
  });
  S.add(path(shade, `fill="#000" opacity=".45"`));
  S.add(path(wood, `fill="#0b0a09" stroke="#050404" stroke-width=".5"`));
  S.add(path(lit, `fill="#8a4426" opacity=".6"`));

  // Embers on the wind, thicker toward the heart.
  S.scatter(56, { gap: 11, keep: (x, y) => S.depth(x, y) < 0.95 || r() < 0.3 }).forEach(([x, y]) => {
    embers += circ(x, y, 0.6 + r() * 1.1);
  });
  S.add(path(embers, `fill="#ff7a35" opacity=".6" filter="${S.url("b1")}"`));
  S.add(path(embers, `fill="#ffb27a" opacity=".9"`));

  // Smoke off the worst of it.
  let smoke = "";
  S.scatter(8, { gap: 70 }).forEach(([x, y]) => {
    for (let k = 0; k < 4; k++) smoke += circ(x + k * 5 + Math.sin(k) * 3, y - k * 8, 4 + k * 3);
  });
  S.top(path(smoke, `fill="#cfc6ba" opacity=".05" filter="${S.url("b2")}"`));

  // Picked-over bones.
  let bones = "";
  S.scatter(12, { gap: 44 }).forEach(([x, y]) => {
    const a = r() * Math.PI;
    const dx = Math.cos(a) * 4.5;
    const dy = Math.sin(a) * 1.8;
    bones += `M${f(x - dx)} ${f(y - dy)}L${f(x + dx)} ${f(y + dy)}` + circ(x - dx, y - dy, 1) + circ(x + dx, y + dy, 1);
  });
  S.add(path(bones, `fill="#c9bea9" stroke="#c9bea9" stroke-width="1.1" opacity=".4"`));

  // What is left of the stockade by the camp.
  const [kx, ky] = S.camp;
  let stakes = "";
  for (let k = 0; k < 8; k++) {
    const x = kx - 30 + k * 7.5 + (r() - 0.5) * 2;
    const y = ky - 18 + Math.sin(k * 0.9) * 2;
    const hgt = 6 + r() * 6;
    stakes += poly([[x - 1.2, y], [x - 1, y - hgt], [x, y - hgt - 2.4], [x + 1, y - hgt], [x + 1.2, y]], true);
  }
  S.add(path(stakes, `fill="#0f0d0c" stroke="#3a2a20" stroke-width=".5"`));

  // The Ashen Warden's ground: a ring of scorched stones round a pit of cinders.
  const { cx, cy } = S.L;
  let stones = "";
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU + r() * 0.2;
    stones += blob(r, cx + Math.cos(a) * 22, cy + Math.sin(a) * 12.5, 3.4 + r() * 1.5, 2.2 + r(), { n: 6, jitter: 0.25 });
  }
  return [
    `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="20" ry="11.5" fill="#050404"/>`,
    `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="16" ry="8.5" fill="#d8743f" opacity=".4" filter="${S.url("b2")}"/>`,
    `<ellipse cx="${f(cx)}" cy="${f(cy + 1)}" rx="7" ry="3.5" fill="#ffb070" opacity=".6" filter="${S.url("b1")}"/>`,
    path(stones, `fill="#34302c" stroke="#0b0908" stroke-width=".8"`),
  ].join("");
}

/* ---------- 2. Gallowmoor: peat and gibbets ---------- */
function gallowmoor(S) {
  const r = S.r;
  S.ground({ base: "#1a1b12", patch: "#2e2f1c", patchAlpha: 0.8, grain: "#7a7b52", grainAlpha: 0.3, freq: "0.013 0.02" });
  S.blurs();
  S.heartGlow("#9a4a28", 0.36);

  // Iron in the bog: rust bleeding through the peat.
  let rust = "";
  S.scatter(13, { gap: 58 }).forEach(([x, y]) => {
    rust += blob(r, x, y, 16 + r() * 24, 9 + r() * 12, { jitter: 0.4, rot: r() * TAU });
  });
  S.add(path(rust, `fill="#8a3a18" opacity=".26" filter="${S.url("b2")}"`));

  // Heather in low, dull patches.
  let heather = "";
  S.scatter(170, { gap: 8 }).forEach(([x, y]) => {
    heather += circ(x, y, 0.9 + r() * 1.3);
  });
  S.add(path(heather, `fill="#4a3043" opacity=".55"`));

  // Peat pools: black water with a dull lip and the faintest shine.
  let pools = "";
  let shine = "";
  S.scatter(22, { gap: 44, pad: 10 }).forEach(([x, y]) => {
    const rx = 9 + r() * 16;
    const ry = rx * (0.4 + r() * 0.15);
    const rot = (r() - 0.5) * 0.5;
    pools += blob(r, x, y, rx, ry, { jitter: 0.22, rot });
    shine += `M${f(x - rx * 0.5)} ${f(y - ry * 0.35)}Q${f(x)} ${f(y - ry * 0.7)} ${f(x + rx * 0.35)} ${f(y - ry * 0.45)}`;
  });
  S.add(path(pools, `fill="none" stroke="#45452a" stroke-width="3" opacity=".6"`));
  S.add(path(pools, `fill="#060706"`));
  S.add(path(shine, `fill="none" stroke="#d6dec6" stroke-width=".8" stroke-linecap="round" opacity=".16"`));

  // Moor grass in tufts.
  let tufts = "";
  S.scatter(150, { gap: 10 }).forEach(([x, y]) => {
    const n = 3 + Math.floor(r() * 3);
    const hgt = 3.5 + r() * 4;
    for (let k = 0; k < n; k++) {
      const dx = (k - (n - 1) / 2) * 1.6 + (r() - 0.5);
      tufts += `M${f(x + dx * 0.3)} ${f(y)}q${f(dx * 0.4)} ${f(-hgt * 0.6)} ${f(dx)} ${f(-hgt - r() * 2)}`;
    }
  });
  S.add(path(tufts, `fill="none" stroke="#6a6a40" stroke-width=".8" stroke-linecap="round" opacity=".75"`));

  // Gibbets, standing where the road would have been.
  let posts = "";
  let edge = "";
  let rope = "";
  let cages = "";
  let shade = "";
  S.scatter(10, { gap: 64, pad: 18 }).forEach(([x, y]) => {
    const s = 1.1 + r() * 0.4;
    const side = r() < 0.5 ? -1 : 1;
    const top = y - 24 * s;
    shade += ell(x + 5 * s, y + 0.5, 9 * s, 2 * s);
    posts += poly([[x - 1.3 * s, y], [x - 1 * s, top], [x + 1 * s, top], [x + 1.3 * s, y]], true);
    posts += poly([[x - side * 1.5 * s, top], [x + side * 11 * s, top], [x + side * 11 * s, top + 1.8 * s], [x - side * 1.5 * s, top + 1.8 * s]], true);
    edge += `M${f(x + 0.9 * s)} ${f(top + 2 * s)}L${f(x + 1.2 * s)} ${f(y - 0.5)}`;
    rope += `M${f(x + side * 0.6)} ${f(top + 8 * s)}L${f(x + side * 6.5 * s)} ${f(top + 1.4 * s)}`;
    const hx = x + side * 9 * s;
    rope += `M${f(hx)} ${f(top + 1.6 * s)}L${f(hx)} ${f(top + 6 * s)}`;
    cages += `M${f(hx - 2.4 * s)} ${f(top + 6 * s)}h${f(4.8 * s)}v${f(7.5 * s)}h${f(-4.8 * s)}Z` + `M${f(hx)} ${f(top + 6 * s)}v${f(7.5 * s)}`;
  });
  S.add(path(shade, `fill="#000" opacity=".45"`));
  S.add(path(posts, `fill="#2c2115" stroke="#0e0a06" stroke-width=".7"`));
  S.add(path(edge, `fill="none" stroke="#7a6040" stroke-width=".7" opacity=".7"`));
  S.add(path(rope, `fill="none" stroke="#3a2c1c" stroke-width="1.2"`));
  S.add(path(cages, `fill="none" stroke="#7a6446" stroke-width=".9"`));

  // The moor's breath, low over it.
  let mist = "";
  S.scatter(8, { gap: 80, pad: -40 }).forEach(([x, y]) => {
    mist += ell(x, y, 60 + r() * 50, 7 + r() * 5);
  });
  S.top(path(mist, `fill="#dfe3cf" opacity=".09" filter="${S.url("b3")}"`));

  // The Drowned Bailiff's pool, with the tallest gibbet of all standing in it.
  const { cx, cy } = S.L;
  return [
    `<ellipse cx="${f(cx)}" cy="${f(cy + 3)}" rx="23" ry="11.5" fill="#030403" stroke="#45452a" stroke-width="2"/>`,
    `<path d="M${f(cx - 15)} ${f(cy - 1)}Q${f(cx - 2)} ${f(cy - 6)} ${f(cx + 10)} ${f(cy - 2)}" fill="none" stroke="#d6dec6" stroke-width=".8" opacity=".18"/>`,
    `<path d="M${f(cx - 1.5)} ${f(cy + 5)}L${f(cx - 1.2)} ${f(cy - 21)}L${f(cx + 12)} ${f(cy - 21)}L${f(cx + 12)} ${f(cy - 19)}L${f(cx + 1.2)} ${f(cy - 19)}L${f(cx + 1.5)} ${f(cy + 5)}Z" fill="#2c2115" stroke="#0e0a06" stroke-width=".7"/>`,
    `<path d="M${f(cx + 10)} ${f(cy - 19)}V${f(cy - 13)}M${f(cx + 7.4)} ${f(cy - 13)}h5.2v8.5h-5.2ZM${f(cx + 10)} ${f(cy - 13)}v8.5" fill="none" stroke="#7a6446" stroke-width="1"/>`,
  ].join("");
}

/* ---------- 3. The Cold Warrens: snow over the tunnels ---------- */
function coldWarrens(S) {
  const r = S.r;
  S.ground({ base: "#1d2935", patch: "#3a5064", patchAlpha: 0.85, grain: "#d6e6f0", grainAlpha: 0.24, freq: "0.012 0.018" });
  S.blurs();
  S.heartGlow("#7fc3ec", 0.32);

  // Snow over everything, lying deepest out on the moor.
  let deep = "";
  S.scatter(34, { gap: 36, pad: -40 }).forEach(([x, y]) => {
    const big = S.depth(x, y) > 0.8 ? 1 : 0.7;
    deep += blob(r, x, y, (30 + r() * 34) * big, (12 + r() * 10) * big, { jitter: 0.35, rot: (r() - 0.5) * 0.4 });
  });
  S.add(path(deep, `fill="#e4eef4" opacity=".22" filter="${S.url("b3")}"`));
  let drifts = "";
  let crisp = "";
  S.scatter(40, { gap: 26, pad: -20 }).forEach(([x, y]) => {
    const d = blob(r, x, y, 12 + r() * 20, 4 + r() * 5, { jitter: 0.35, rot: (r() - 0.5) * 0.3 });
    drifts += d;
    if (r() < 0.5) crisp += d;
  });
  S.add(path(drifts, `fill="#eef5f9" opacity=".2" filter="${S.url("b0")}"`));
  S.add(path(crisp, `fill="none" stroke="#f4f9fc" stroke-width=".8" opacity=".3"`));

  // Ice where water was: pale sheets with the cracks showing.
  let ice = "";
  let iceCracks = "";
  S.scatter(9, { gap: 70, pad: 10 }).forEach(([x, y]) => {
    const rx = 14 + r() * 16;
    ice += blob(r, x, y, rx, rx * 0.45, { jitter: 0.2, n: 7 });
    for (let k = 0; k < 3; k++) iceCracks += crack(r, x + (r() - 0.5) * rx, y + (r() - 0.5) * rx * 0.3, r() * TAU, rx * 0.7, { step: 4, turn: 0.4, fork: 0.25 });
  });
  S.add(path(ice, `fill="#9fd0ea" opacity=".16" stroke="#cfeaf8" stroke-width=".8" stroke-opacity=".4"`));
  S.add(path(iceCracks, `fill="none" stroke="#e2f3fb" stroke-width=".55" opacity=".45"`));

  // Rocks breaking the snow, each with its own cap.
  let rocks = "";
  let caps = "";
  S.scatter(34, { gap: 24, pad: 4 }).forEach(([x, y]) => {
    const s = 0.8 + r() * 0.9;
    rocks += poly([[x - 5 * s, y], [x - 3.5 * s, y - 4 * s], [x - 0.5 * s, y - 5.5 * s], [x + 3 * s, y - 3.8 * s], [x + 5 * s, y]], true);
    caps += poly([[x - 3.8 * s, y - 3.5 * s], [x - 0.5 * s, y - 5.6 * s], [x + 3.2 * s, y - 3.7 * s], [x + 1 * s, y - 2.8 * s], [x - 1.5 * s, y - 3.2 * s]], true);
  });
  S.add(path(rocks, `fill="#223140" stroke="#0a0f14" stroke-width=".7"`));
  S.add(path(caps, `fill="#eef5f9" opacity=".9"`));

  // The warrens: holes in the snow, a bank thrown up behind each, icicles along the lip.
  let banks = "";
  let holes = "";
  let lips = "";
  let icicles = "";
  let breath = "";
  S.scatter(10, { gap: 58, pad: 14, keep: (x, y) => S.depth(x, y) < 1.08 }).forEach(([x, y]) => {
    const s = 0.9 + r() * 0.4 + (1 - clamp(S.depth(x, y))) * 0.5;
    const w = 7 * s;
    const hgt = 6.5 * s;
    banks += `M${f(x - w * 1.7)} ${f(y + 1)}C${f(x - w * 1.6)} ${f(y - hgt * 2)} ${f(x + w * 1.6)} ${f(y - hgt * 2)} ${f(x + w * 1.7)} ${f(y + 1)}C${f(x + w)} ${f(y + hgt * 0.5)} ${f(x - w)} ${f(y + hgt * 0.5)} ${f(x - w * 1.7)} ${f(y + 1)}Z`;
    holes += `M${f(x - w)} ${f(y)}C${f(x - w)} ${f(y - hgt * 1.5)} ${f(x + w)} ${f(y - hgt * 1.5)} ${f(x + w)} ${f(y)}C${f(x + w * 0.6)} ${f(y + hgt * 0.3)} ${f(x - w * 0.6)} ${f(y + hgt * 0.3)} ${f(x - w)} ${f(y)}Z`;
    lips += `M${f(x - w * 1.05)} ${f(y - hgt * 0.2)}C${f(x - w * 1.05)} ${f(y - hgt * 1.6)} ${f(x + w * 1.05)} ${f(y - hgt * 1.6)} ${f(x + w * 1.05)} ${f(y - hgt * 0.2)}`;
    for (let k = -2; k <= 2; k++) {
      const ix = x + k * w * 0.34;
      const iy = y - hgt * 1.1 + Math.abs(k) * Math.abs(k) * hgt * 0.1;
      icicles += poly([[ix - 0.9, iy], [ix, iy + 2.4 + r() * 2.6 * s], [ix + 0.9, iy]], true);
    }
    breath += ell(x, y - hgt * 0.45, w * 0.6, hgt * 0.4);
  });
  S.add(path(banks, `fill="#dbe8f0" opacity=".55" filter="${S.url("b0")}"`));
  S.add(path(holes, `fill="#02050a"`));
  S.add(path(lips, `fill="none" stroke="#f2f8fb" stroke-width="1.5" stroke-linecap="round" opacity=".85"`));
  S.add(path(breath, `fill="#7fc3ec" opacity=".22" filter="${S.url("b1")}"`));
  S.add(path(icicles, `fill="#e6f4fb"`));

  // Frost that grew where nothing moved.
  let frost = "";
  S.scatter(40, { gap: 18 }).forEach(([x, y]) => {
    const s = 1.6 + r() * 2.4;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI + 0.3;
      const dx = Math.cos(a) * s;
      const dy = Math.sin(a) * s;
      frost += `M${f(x - dx)} ${f(y - dy)}L${f(x + dx)} ${f(y + dy)}`;
    }
  });
  S.add(path(frost, `fill="none" stroke="#d6eefa" stroke-width=".6" stroke-linecap="round" opacity=".55"`));

  // Rime creeping in from the edges, as on a pane left out overnight.
  S.def(`<radialGradient id="${S.id("rime")}" cx="50%" cy="50%" r="72%"><stop offset=".62" stop-color="#e8f3f9" stop-opacity="0"/><stop offset="1" stop-color="#e8f3f9" stop-opacity=".2"/></radialGradient>`);
  S.top(`<rect width="${MAP_W}" height="${MAP_H}" fill="${S.url("rime")}"/>`);

  // Still falling.
  let fall = "";
  S.scatter(150, { gap: 8, pad: -40 }).forEach(([x, y]) => {
    fall += circ(x, y, 0.45 + r() * 0.85);
  });
  S.top(path(fall, `fill="#f6fbfd" opacity=".5"`));

  // The Cold Matriarch's warren: the widest mouth of them all.
  const { cx, cy } = S.L;
  let fangs = "";
  for (let k = -3; k <= 3; k++) {
    const ix = cx + k * 3.8;
    const iy = cy - 14 + k * k * 0.55;
    fangs += poly([[ix - 1.2, iy], [ix, iy + 3.5 + (3 - Math.abs(k)) * 1.1], [ix + 1.2, iy]], true);
  }
  return [
    `<path d="M${f(cx - 30)} ${f(cy + 8)}C${f(cx - 28)} ${f(cy - 30)} ${f(cx + 28)} ${f(cy - 30)} ${f(cx + 30)} ${f(cy + 8)}C${f(cx + 18)} ${f(cy + 14)} ${f(cx - 18)} ${f(cy + 14)} ${f(cx - 30)} ${f(cy + 8)}Z" fill="#dbe8f0" opacity=".6" filter="${S.url("b0")}"/>`,
    `<path d="M${f(cx - 17)} ${f(cy + 7)}C${f(cx - 17)} ${f(cy - 17)} ${f(cx + 17)} ${f(cy - 17)} ${f(cx + 17)} ${f(cy + 7)}C${f(cx + 10)} ${f(cy + 10)} ${f(cx - 10)} ${f(cy + 10)} ${f(cx - 17)} ${f(cy + 7)}Z" fill="#01040a"/>`,
    `<path d="M${f(cx - 18)} ${f(cy + 4)}C${f(cx - 18)} ${f(cy - 19)} ${f(cx + 18)} ${f(cy - 19)} ${f(cx + 18)} ${f(cy + 4)}" fill="none" stroke="#f2f8fb" stroke-width="2" stroke-linecap="round"/>`,
    `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="9" ry="6" fill="#7fc3ec" opacity=".35" filter="${S.url("b2")}"/>`,
    path(fangs, `fill="#e6f4fb"`),
  ].join("");
}

/* ---------- 4. Graveshelf: pine and cairns above the treeline ---------- */
function graveshelf(S) {
  const r = S.r;
  const L = S.L;
  S.ground({ base: "#171c19", patch: "#2b332d", patchAlpha: 0.8, grain: "#9aa49a", grainAlpha: 0.24, freq: "0.01 0.015" });
  S.blurs();
  S.heartGlow("#c4ccb8", 0.18);

  // Bare rock on the high ground, split into slabs.
  let slabs = "";
  cells(r, { size: 22, squash: 0.7, inset: 1.4 }).forEach(({ c, pts }) => {
    const d = S.depth(c[0], c[1]);
    if (d > 0.82 || r() < 0.35) return;
    slabs += poly(pts, true);
  });
  S.add(path(slabs, `fill="#252c27" stroke="#0e110f" stroke-width=".8" opacity=".85"`));

  // The shelf: breaks in the ground stepping up toward the heart, hatched on their downhill side.
  let edge = "";
  let hatch = "";
  const cliff = (u, from, to) => {
    const pts = [];
    for (let a = from; a <= to; a += 0.05) {
      const w = u * (1 + 0.03 * Math.sin(a * 9 + u));
      const [x, y] = onMap(L, w, a);
      pts.push([x, y]);
      const [ox, oy] = onMap(L, w + 5 + (Math.sin(a * 23 + u) + 1) * 3 + r() * 3, a);
      hatch += `M${f(x)} ${f(y)}L${f(ox)} ${f(oy)}`;
    }
    edge += smooth(pts);
  };
  cliff(134, 3.5, 5.9);
  cliff(128, 0.3, 2.4);
  cliff(97, 4.1, 6.9);
  cliff(96, 1.2, 3.1);
  S.add(path(hatch, `fill="none" stroke="#050706" stroke-width="1" opacity=".75"`));
  S.add(path(edge, `fill="none" stroke="#5c665e" stroke-width="1.1" opacity=".55"`));

  // Scree under the breaks.
  let scree = "";
  S.scatter(110, { gap: 8 }).forEach(([x, y]) => {
    scree += circ(x, y, 0.5 + r() * 1.2);
  });
  S.add(path(scree, `fill="#6a736b" opacity=".45"`));

  // Pines in stands below the treeline: none on the shelf itself.
  let dark = "";
  let lit = "";
  let trunks = "";
  let shade = "";
  const stands = S.scatter(14, { gap: 70, pad: -30, keep: (x, y) => S.depth(x, y) > 0.72 });
  stands.forEach(([sx, sy]) => {
    const n = 10 + Math.floor(r() * 10);
    for (let k = 0; k < n; k++) {
      const x = sx + (r() - 0.5) * 80;
      const y = sy + (r() - 0.5) * 44;
      if (!S.clearOf(x, y, 4) || S.depth(x, y) < 0.7 || x < 8 || x > MAP_W - 8 || y < 24 || y > MAP_H - 6) continue;
      const s = 0.9 + r() * 0.6;
      shade += ell(x + 3 * s, y + 0.3, 5 * s, 1.4 * s);
      trunks += `M${f(x)} ${f(y)}v${f(-3 * s)}`;
      [[6, 0, 8], [4.6, 4.2, 12.5], [3.1, 8, 16]].forEach(([w, b, t]) => {
        dark += poly([[x - w * s, y - (2 + b) * s], [x, y - t * s], [x + w * s, y - (2 + b) * s]], true);
        lit += poly([[x, y - (2 + b) * s], [x, y - t * s], [x + w * s, y - (2 + b) * s]], true);
      });
    }
  });
  S.add(path(shade, `fill="#000" opacity=".4"`));
  S.add(path(trunks, `fill="none" stroke="#0f0c0a" stroke-width="1.3"`));
  S.add(path(dark, `fill="#0d1812" stroke="#07100b" stroke-width=".4"`));
  S.add(path(lit, `fill="#2a4232" opacity=".9"`));

  // Cairns on the shelf. Some of the stones are pale, which is how you know they are new.
  let stone = "";
  let fresh = "";
  let cshade = "";
  S.scatter(20, { gap: 36, pad: 8, keep: (x, y) => S.depth(x, y) < 0.95 }).forEach(([x, y], i) => {
    const s = 1.1 + r() * 0.5;
    cshade += ell(x + 2 * s, y + 0.4, 5.5 * s, 1.4 * s);
    const tiers = [[0, 3.4, 1.5], [3.1, 2.7, 1.3], [5.5, 2, 1.1], [7.4, 1.3, 0.9]];
    tiers.forEach(([up, w, hh], k) => {
      const d = ell(x + (r() - 0.5) * 0.8, y - up * s - hh * s * 0.6, w * s, hh * s);
      if (i % 3 === 0 && k >= tiers.length - 2) fresh += d;
      else stone += d;
    });
  });
  S.add(path(cshade, `fill="#000" opacity=".45"`));
  S.add(path(stone, `fill="#6e706a" stroke="#161816" stroke-width=".7"`));
  S.add(path(fresh, `fill="#d8d6c8" stroke="#161816" stroke-width=".7"`));

  // Old snow on the high ground.
  let snow = "";
  S.scatter(14, { gap: 36, keep: (x, y) => S.depth(x, y) < 0.8 }).forEach(([x, y]) => {
    snow += blob(r, x, y, 10 + r() * 14, 4 + r() * 4, { jitter: 0.35 });
  });
  S.add(path(snow, `fill="#e6ebe2" opacity=".1" filter="${S.url("b1")}"`));

  // The Barrow King's mound, a door of stone in its face and a ring of standing stones.
  const { cx, cy } = L;
  let ring = "";
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU + 0.2;
    const x = cx + Math.cos(a) * 27;
    const y = cy + Math.sin(a) * 15 + 3;
    ring += poly([[x - 1.8, y + 1], [x - 1.4, y - 6], [x + 1.4, y - 6.6], [x + 1.8, y + 1]], true);
  }
  return [
    `<ellipse cx="${f(cx)}" cy="${f(cy + 5)}" rx="22" ry="5" fill="#000" opacity=".5"/>`,
    `<path d="M${f(cx - 20)} ${f(cy + 5)}C${f(cx - 18)} ${f(cy - 15)} ${f(cx + 18)} ${f(cy - 15)} ${f(cx + 20)} ${f(cy + 5)}Z" fill="#26322a" stroke="#0a0c0b" stroke-width=".9"/>`,
    `<path d="M${f(cx - 16)} ${f(cy + 1)}C${f(cx - 12)} ${f(cy - 10)} ${f(cx + 4)} ${f(cy - 12)} ${f(cx + 13)} ${f(cy - 6)}" fill="none" stroke="#4d6152" stroke-width="1.4" opacity=".8"/>`,
    `<path d="M${f(cx - 4.5)} ${f(cy + 5)}V${f(cy - 3)}H${f(cx + 4.5)}V${f(cy + 5)}Z" fill="#020302"/>`,
    `<path d="M${f(cx - 7)} ${f(cy - 3.6)}H${f(cx + 7)}" stroke="#9a9c90" stroke-width="1.8"/>`,
    path(ring, `fill="#74766e" stroke="#141614" stroke-width=".7"`),
  ].join("");
}

/* ---------- 5. The Sallow Fen: water that does not reflect ---------- */
function sallowFen(S) {
  const r = S.r;
  S.ground({ base: "#1d2013", patch: "#30351f", patchAlpha: 0.85, grain: "#9a9658", grainAlpha: 0.24, freq: "0.012 0.017" });
  S.blurs();
  S.heartGlow("#c8c070", 0.22);

  // Standing water, most of the ground. Flat and dull: nothing in it shines back.
  let water = "";
  S.scatter(18, { gap: 52, pad: -30 }).forEach(([x, y]) => {
    const rx = 30 + r() * 44;
    water += blob(r, x, y, rx, rx * (0.35 + r() * 0.2), { jitter: 0.32, n: 11, rot: (r() - 0.5) * 0.4 });
  });
  S.add(path(water, `fill="none" stroke="#3f4426" stroke-width="4" opacity=".75"`));
  S.add(path(water, `fill="#0a0c07"`));
  S.add(path(water, `fill="#b4ad62" opacity=".06"`));

  // Something moving under it, with somewhere to be.
  let rings = "";
  let wakes = "";
  S.scatter(10, { gap: 46, keep: (x, y) => S.zone(x, y) >= 0 }).forEach(([x, y]) => {
    const s = 3 + r() * 3;
    for (let k = 1; k <= 3; k++) rings += ell(x, y, s * k * 1.2, s * k * 0.45);
    if (r() < 0.7) {
      const a = r() * TAU;
      const back = [x - Math.cos(a) * 18, y - Math.sin(a) * 7];
      wakes += `M${f(back[0] + Math.sin(a) * 7)} ${f(back[1] - Math.cos(a) * 3)}L${f(x)} ${f(y)}L${f(back[0] - Math.sin(a) * 7)} ${f(back[1] + Math.cos(a) * 3)}`;
    }
  });
  S.add(path(rings, `fill="none" stroke="#d6cc84" stroke-width=".7" opacity=".28"`));
  S.add(path(wakes, `fill="none" stroke="#d6cc84" stroke-width=".7" opacity=".22"`));

  // Lily pads, dark and notched.
  let pads = "";
  S.scatter(46, { gap: 11 }).forEach(([x, y]) => {
    const rr = 1.8 + r() * 2;
    const a = r() * TAU;
    pads += `M${f(x)} ${f(y)}L${f(x + Math.cos(a) * rr * 1.4)} ${f(y + Math.sin(a) * rr * 0.6)}A${f(rr * 1.4)} ${f(rr * 0.6)} 0 1 1 ${f(x + Math.cos(a + 0.5) * rr * 1.4)} ${f(y + Math.sin(a + 0.5) * rr * 0.6)}Z`;
  });
  S.add(path(pads, `fill="#2e3d24" opacity=".95"`));

  // Reeds and bulrushes along the margins.
  let reeds = "";
  let heads = "";
  S.scatter(110, { gap: 11 }).forEach(([x, y]) => {
    const n = 3 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const dx = (k - (n - 1) / 2) * 1.5;
      const hgt = 6 + r() * 8;
      const lean = (r() - 0.5) * 3;
      reeds += `M${f(x + dx)} ${f(y)}q${f(lean * 0.3)} ${f(-hgt * 0.5)} ${f(lean)} ${f(-hgt)}`;
      if (r() < 0.35) heads += ell(x + dx + lean * 0.8, y - hgt * 0.8, 0.9, 2.2);
    }
  });
  S.add(path(reeds, `fill="none" stroke="#6e7038" stroke-width=".8" stroke-linecap="round" opacity=".85"`));
  S.add(path(heads, `fill="#4a3219"`));

  // Sallows, dead where they stand, weeping into the water.
  let trunks = "";
  let fronds = "";
  S.scatter(13, { gap: 56, pad: 12 }).forEach(([x, y]) => {
    const s = 1.1 + r() * 0.5;
    const tx = x + (r() - 0.5) * 6 * s;
    const ty = y - 17 * s;
    trunks += `M${f(x - 1.8 * s)} ${f(y)}Q${f(x + 3 * s)} ${f(y - 8 * s)} ${f(tx)} ${f(ty)}L${f(tx + 1.4 * s)} ${f(ty + 0.6)}Q${f(x + 4.6 * s)} ${f(y - 8 * s)} ${f(x + 1.8 * s)} ${f(y)}Z`;
    for (let k = 0; k < 8; k++) {
      const dir = k < 4 ? -1 : 1;
      const bx = tx + dir * (2 + (k % 4) * 2.3) * s;
      fronds += `M${f(tx)} ${f(ty)}Q${f(bx)} ${f(ty - 4 * s)} ${f(bx + dir * 2 * s)} ${f(ty + (6 + r() * 8) * s)}`;
    }
  });
  S.add(path(fronds, `fill="none" stroke="#5a5c30" stroke-width=".8" opacity=".9"`));
  S.add(path(trunks, `fill="#2a281c" stroke="#0e0d08" stroke-width=".5"`));

  // A low, sickly haze.
  let haze = "";
  S.scatter(7, { gap: 100, pad: -60 }).forEach(([x, y]) => {
    haze += ell(x, y, 70 + r() * 40, 12 + r() * 6);
  });
  S.top(path(haze, `fill="#d4cc7a" opacity=".06" filter="${S.url("b3")}"`));

  // Mother Sallow's pool: still, black, and circled from beneath.
  const { cx, cy } = S.L;
  let ripple = "";
  for (let k = 1; k <= 3; k++) ripple += ell(cx, cy + 1, 8 * k, 3.4 * k);
  let hang = "";
  for (let k = 0; k < 10; k++) {
    const bx = cx - 18 + k * 4;
    hang += `M${f(cx - 5)} ${f(cy - 20)}Q${f(bx)} ${f(cy - 24)} ${f(bx + (k < 5 ? -2 : 2))} ${f(cy - 9 + (k % 3) * 2)}`;
  }
  return [
    `<ellipse cx="${f(cx)}" cy="${f(cy + 1)}" rx="26" ry="11" fill="#040503" stroke="#3f4426" stroke-width="2"/>`,
    path(ripple, `fill="none" stroke="#e0d68c" stroke-width=".8" opacity=".38"`),
    `<path d="M${f(cx - 9)} ${f(cy - 4)}Q${f(cx - 7)} ${f(cy - 15)} ${f(cx - 5)} ${f(cy - 20)}L${f(cx - 3.4)} ${f(cy - 19.6)}Q${f(cx - 5)} ${f(cy - 13)} ${f(cx - 6.4)} ${f(cy - 4)}Z" fill="#2a281c"/>`,
    path(hang, `fill="none" stroke="#6a6c38" stroke-width=".9"`),
  ].join("");
}

/* ---------- 6. Umberdeep: old growth round fallen star iron ---------- */
function umberdeep(S) {
  const r = S.r;
  S.ground({ base: "#12100c", patch: "#221c13", grain: "#6a5a40", grainAlpha: 0.2, freq: "0.014 0.02" });
  S.blurs();

  // Where the star iron came down: craters the forest has grown back round.
  const craters = S.scatter(6, { gap: 96, pad: 18, keep: (x, y) => S.depth(x, y) > 0.3 && S.depth(x, y) < 1.15 });
  const inCrater = (x, y, pad = 0) => craters.some(([qx, qy], i) => Math.hypot(x - qx, (y - qy) / 0.62) < (i % 2 ? 15 : 19) + pad);
  S.def(`<radialGradient id="${S.id("star")}"><stop offset="0" stop-color="#cfe0ff" stop-opacity=".85"/><stop offset=".35" stop-color="#8fb4ff" stop-opacity=".3"/><stop offset="1" stop-color="#8fb4ff" stop-opacity="0"/></radialGradient>`);

  // Roots in the gaps between the crowns.
  let roots = "";
  S.scatter(34, { gap: 30, pad: -30 }).forEach(([x, y]) => {
    roots += crack(r, x, y, r() * TAU, 26 + r() * 30, { step: 7, turn: 0.4, fork: 0.25 });
  });
  S.add(path(roots, `fill="none" stroke="#33281a" stroke-width="1.7" stroke-linecap="round" opacity=".85"`));

  // The canopy, crown against crown: shadow, leaf, and the little light the top gets.
  const tones = ["#1a1d14", "#1f2218", "#252216", "#191610", "#21271a"];
  const shadow = [];
  const leaf = tones.map(() => []);
  const light = [];
  S.scatter(330, { gap: 11, pad: -12, box: [4, 4, MAP_W - 4, MAP_H - 4], keep: (x, y) => !inCrater(x, y, 6) }).forEach(([x, y]) => {
    const rr = 6 + r() * 7 * (S.depth(x, y) < 0.35 ? 0.6 : 1);
    shadow.push(circ(x + rr * 0.3, y + rr * 0.35, rr));
    leaf[Math.floor(r() * tones.length)].push(circ(x, y, rr));
    light.push(circ(x - rr * 0.32, y - rr * 0.36, rr * 0.45));
  });
  S.add(path(shadow.join(""), `fill="#050403" opacity=".6"`));
  leaf.forEach((list, i) => S.add(path(list.join(""), `fill="${tones[i]}"`)));
  S.add(path(light.join(""), `fill="#3a3e27" opacity=".35"`));

  // The craters themselves, and the iron still glowing in them.
  let rims = "";
  let pits = "";
  let iron = "";
  let scorch = "";
  craters.forEach(([x, y], i) => {
    const rr = i % 2 ? 11 : 14;
    rims += ell(x, y, rr + 3, (rr + 3) * 0.6);
    pits += ell(x, y + 0.5, rr, rr * 0.58);
    iron += blob(r, x, y, 3.4, 2.3, { n: 6, jitter: 0.35 });
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + r() * 0.4;
      scorch += `M${f(x + Math.cos(a) * (rr + 3))} ${f(y + Math.sin(a) * (rr + 3) * 0.6)}l${f(Math.cos(a) * (5 + r() * 7))} ${f(Math.sin(a) * (3 + r() * 4))}`;
    }
  });
  S.add(path(scorch, `fill="none" stroke="#0b0907" stroke-width="1.2" opacity=".8"`));
  S.add(path(rims, `fill="#2e261b" stroke="#0a0806" stroke-width="1"`));
  S.add(path(pits, `fill="#0b0907"`));
  craters.forEach(([x, y]) => S.add(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="17" ry="10.5" fill="${S.url("star")}"/>`));
  S.add(path(iron, `fill="#bcd0f0" stroke="#f2f7ff" stroke-width=".6"`));

  // Lantern bloom, where a little light gets down to the floor.
  let bloom = "";
  S.scatter(28, { gap: 22, pad: 6 }).forEach(([x, y]) => {
    bloom += circ(x, y, 0.8 + r() * 0.6);
  });
  S.top(path(bloom, `fill="#f0c86a" opacity=".6" filter="${S.url("b0")}"`));
  S.top(path(bloom, `fill="#ffe2a0" opacity=".85"`));

  // One still falling, high over the trees.
  S.def(`<linearGradient id="${S.id("streak")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe0ff" stop-opacity="0"/><stop offset="1" stop-color="#e6efff" stop-opacity=".9"/></linearGradient>`);
  S.top(`<path d="M462 20L540 70" stroke="${S.url("streak")}" stroke-width="1.4" stroke-linecap="round"/><circle cx="540" cy="70" r="2.2" fill="#f2f6ff" filter="${S.url("b0")}"/>`);

  // The Umber Colossus's ground: the first and widest crater, and the heart of iron in it.
  const { cx, cy } = S.L;
  let ring = "";
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    ring += circ(cx + Math.cos(a) * 29, cy + Math.sin(a) * 17, 5 + (k % 3));
  }
  return [
    path(ring, `fill="#1f2318" stroke="#050403" stroke-width=".8"`),
    `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="22" ry="13" fill="#2e261b" stroke="#0a0806" stroke-width="1"/>`,
    `<ellipse cx="${f(cx)}" cy="${f(cy + 0.6)}" rx="18" ry="10.5" fill="#07060a"/>`,
    `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="27" ry="17" fill="${S.url("star")}"/>`,
    `<path d="M${f(cx - 6)} ${f(cy + 1)}L${f(cx - 3)} ${f(cy - 4)}L${f(cx + 3)} ${f(cy - 4.5)}L${f(cx + 6.5)} ${f(cy)}L${f(cx + 2)} ${f(cy + 3.5)}L${f(cx - 3)} ${f(cy + 3.2)}Z" fill="#c8daf6" stroke="#f6f9ff" stroke-width=".7"/>`,
  ].join("");
}

/* ---------- 7. Wyrmreach: warm stone over something breathing ---------- */
function wyrmreach(S) {
  const r = S.r;
  const L = S.L;
  S.ground({ base: "#0e0806", patch: "#2e1c15", grain: "#8a5a40", grainAlpha: 0.2, freq: "0.012 0.018" });
  S.blurs();

  // Warm stone in slabs, split along seams; near the heart the seams run hot.
  const tones = ["#2a1a12", "#321f15", "#3a2418", "#281710", "#2f1c13"];
  const slabs = tones.map(() => []);
  let hotSeams = "";
  cells(r, { size: 30, squash: 0.7, inset: 1.5 }).forEach(({ c, pts }) => {
    const d = S.depth(c[0], c[1]);
    slabs[Math.floor(r() * tones.length)].push(poly(pts, true));
    if (d < 0.58 && r() < 0.4) hotSeams += poly(pts, true);
  });
  slabs.forEach((list, i) => S.add(path(list.join(""), `fill="${tones[i]}"`)));
  S.add(`<rect width="${MAP_W}" height="${MAP_H}" filter="${S.url("grain")}" opacity=".35"/>`);
  S.heartGlow("#ff6a2a", 0.4, 1.45);
  S.add(path(hotSeams, `fill="none" stroke="#ff5a1a" stroke-width="3" opacity=".28" filter="${S.url("b1")}"`));
  S.add(path(hotSeams, `fill="none" stroke="#ff8a3d" stroke-width=".8" opacity=".65"`));

  // The ground answering further out: single cracks with the heat showing.
  let hot = "";
  S.scatter(22, { gap: 40, keep: (x, y) => S.depth(x, y) > 0.55 }).forEach(([x, y]) => {
    const toward = Math.atan2(L.cy - y, L.cx - x);
    hot += crack(r, x, y, toward + (r() - 0.5) * 1.6, 18 + r() * 30, { step: 5, turn: 0.5, fork: 0.28 });
  });
  S.add(path(hot, `fill="none" stroke="#ff5a1a" stroke-width="3.2" stroke-linecap="round" opacity=".3" filter="${S.url("b1")}"`));
  S.add(path(hot, `fill="none" stroke="#1a0804" stroke-width="1.6" stroke-linecap="round"`));
  S.add(path(hot, `fill="none" stroke="#ff8a3d" stroke-width=".7" stroke-linecap="round" opacity=".9"`));

  // Soot where the breath came up.
  let soot = "";
  S.scatter(12, { gap: 60 }).forEach(([x, y]) => {
    soot += blob(r, x, y, 12 + r() * 14, 6 + r() * 6, { jitter: 0.4 });
  });
  S.add(path(soot, `fill="#050303" opacity=".4" filter="${S.url("b1")}"`));

  // Vents, and their steam.
  let vents = "";
  let steam = "";
  S.scatter(12, { gap: 48, pad: 8 }).forEach(([x, y]) => {
    vents += ell(x, y, 3.4, 1.6);
    for (let k = 1; k <= 4; k++) steam += circ(x + Math.sin(k * 1.3 + x) * 2.5, y - k * 5.5, 1.8 + k * 1.4);
  });
  S.add(path(vents, `fill="#070403" stroke="#7a3a1c" stroke-width=".9"`));
  S.add(path(steam, `fill="#f0dccb" opacity=".12" filter="${S.url("b1")}"`));

  // Crooked trees, bent away from the heat.
  let trees = "";
  let rims = "";
  S.scatter(16, { gap: 40, pad: 8, keep: (x, y) => S.depth(x, y) > 0.5 }).forEach(([x, y]) => {
    const s = 1.2 + r() * 0.5;
    const lean = (x < L.cx ? -1 : 1) * (3 + r() * 3) * s;
    const tx = x + lean;
    const ty = y - 15 * s;
    trees += `M${f(x - 1.5 * s)} ${f(y)}C${f(x + 3 * s)} ${f(y - 5 * s)} ${f(x - 3 * s)} ${f(y - 10 * s)} ${f(tx)} ${f(ty)}L${f(tx + 1.1)} ${f(ty + 0.8)}C${f(x - 1.6 * s)} ${f(y - 10 * s)} ${f(x + 4.6 * s)} ${f(y - 5 * s)} ${f(x + 1.5 * s)} ${f(y)}Z`;
    rims += `M${f(x + 1.5 * s)} ${f(y)}C${f(x + 4.6 * s)} ${f(y - 5 * s)} ${f(x - 1.6 * s)} ${f(y - 10 * s)} ${f(tx + 1.1)} ${f(ty + 0.8)}`;
    for (let k = 0; k < 3; k++) {
      const by = y - (7 + k * 2.8) * s;
      const bx = lerp(x, tx, (7 + k * 2.8) / 15);
      const dir = k % 2 ? 1 : -1;
      trees += `M${f(bx)} ${f(by)}q${f(dir * 3 * s)} ${f(-1 * s)} ${f(dir * 4.4 * s)} ${f(-4.4 * s)}l${f(-dir * 0.6)} .2q${f(-dir * 1.6 * s)} ${f(2.6 * s)} ${f(-dir * 3.8 * s)} ${f(4.4 * s)}Z`;
    }
  });
  S.add(path(trees, `fill="#070302" stroke="#070302" stroke-width=".6"`));
  S.add(path(rims, `fill="none" stroke="#c0501e" stroke-width=".8" opacity=".75"`));

  // What is left of a wyrm, a long time dead, lying across the Outer ground.
  let spine = "";
  let ribs = "";
  const bone = [];
  for (let k = 0; k <= 22; k++) {
    const a = (12 + k * 2.9) * DEG;
    bone.push(onMap(L, 139 + Math.sin(k * 0.5) * 4, a));
  }
  bone.forEach(([x, y], k) => {
    const nx = bone[Math.min(k + 1, bone.length - 1)];
    const px = bone[Math.max(k - 1, 0)];
    const a = Math.atan2(nx[1] - px[1], nx[0] - px[0]);
    spine += ell(x, y, 2.6, 1.8);
    if (k > 3 && k < 17) {
      const len = 13 - Math.abs(k - 10) * 1.1;
      const ox = -Math.sin(a);
      const oy = Math.cos(a);
      ribs += `M${f(x)} ${f(y)}q${f(ox * len * 0.5 + Math.cos(a) * 3)} ${f(oy * len * 0.5 + Math.sin(a) * 3)} ${f(ox * len)} ${f(oy * len * 0.7)}`;
      ribs += `M${f(x)} ${f(y)}q${f(-ox * len * 0.5 + Math.cos(a) * 3)} ${f(-oy * len * 0.5 + Math.sin(a) * 3)} ${f(-ox * len)} ${f(-oy * len * 0.7)}`;
    }
  });
  const [hx, hy] = bone[bone.length - 1];
  const [qx, qy] = bone[bone.length - 3];
  const ha = Math.atan2(hy - qy, hx - qx);
  const hc = Math.cos(ha);
  const hs = Math.sin(ha);
  const skullPts = [[0, -3.6], [10, -2.6], [18, -0.8], [18.5, 0.8], [10, 2.6], [0, 3.6], [-3, 0]].map(([u, v]) => [hx + u * hc - v * hs, hy + u * hs + v * hc]);
  S.add(path(ribs, `fill="none" stroke="#d9cbb0" stroke-width="1.2" stroke-linecap="round" opacity=".55"`));
  S.add(path(spine + poly(skullPts, true), `fill="#e2d4b8" opacity=".62"`));
  S.add(`<circle cx="${f(hx + 6 * hc - 1.2 * hs)}" cy="${f(hy + 6 * hs + 1.2 * hc)}" r="1.2" fill="#140906"/>`);

  // The Wyrm Beneath: a fissure in the heart of it, breathing light.
  const { cx, cy } = L;
  let rays = "";
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU + 0.3;
    rays += crack(r, cx + Math.cos(a) * 13, cy + Math.sin(a) * 7.5, a, 14 + r() * 8, { step: 4, turn: 0.35, fork: 0 });
  }
  return [
    path(rays, `fill="none" stroke="#ff7a30" stroke-width="1.3" opacity=".9"`),
    `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="19" ry="10.5" fill="#1a0804" stroke="#6a2a12" stroke-width="1.3"/>`,
    `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="15" ry="7.5" fill="#ff5a1a" opacity=".6" filter="${S.url("b2")}"/>`,
    `<path d="M${f(cx - 13)} ${f(cy + 1)}Q${f(cx - 4)} ${f(cy - 5)} ${f(cx + 2)} ${f(cy)}T${f(cx + 14)} ${f(cy - 1)}" fill="none" stroke="#ffc88a" stroke-width="1.7" stroke-linecap="round"/>`,
  ].join("");
}

/* ---------- 8. The Fade: ruins in a thin mist ---------- */
function theFade(S) {
  const r = S.r;
  const L = S.L;
  S.ground({ base: "#17151e", patch: "#2a2636", patchAlpha: 0.8, grain: "#b0a8d0", grainAlpha: 0.14, freq: "0.009 0.014" });
  S.blurs();
  S.heartGlow("#d6ceff", 0.28, 1.5);

  // Flagstones where floors were, most of them gone.
  const floors = S.scatter(6, { gap: 100, pad: -10, keep: (x, y) => S.depth(x, y) < 1.15 });
  let flags = "";
  cells(r, { size: 15, squash: 0.62, inset: 1.2 }).forEach(({ c, pts }) => {
    if (!floors.some(([fx, fy]) => Math.hypot(c[0] - fx, (c[1] - fy) * 1.6) < 44 + r() * 14)) return;
    if (r() < 0.3) return;
    flags += poly(pts, true);
  });
  S.add(path(flags, `fill="#24212e" stroke="#0e0c13" stroke-width=".8"`));
  S.add(path(flags, `fill="none" stroke="#403a54" stroke-width=".5" opacity=".6" transform="translate(-.5 -.5)"`));

  // Walls, down to their footings.
  let walls = "";
  S.scatter(7, { gap: 90, pad: 10 }).forEach(([x, y]) => {
    const w = 18 + r() * 22;
    const hh = 10 + r() * 12;
    const runs = [[[x - w, y], [x + w, y]], [[x + w, y], [x + w, y - hh]], [[x + w, y - hh], [x - w, y - hh]], [[x - w, y - hh], [x - w, y]]];
    runs.forEach(([a, b]) => {
      if (r() < 0.35) return;
      const t0 = r() * 0.3;
      const t1 = 0.7 + r() * 0.3;
      walls += `M${f(lerp(a[0], b[0], t0))} ${f(lerp(a[1], b[1], t0))}L${f(lerp(a[0], b[0], t1))} ${f(lerp(a[1], b[1], t1))}`;
    });
  });
  S.add(path(walls, `fill="none" stroke="#0c0a10" stroke-width="3.4" stroke-linecap="square"`));
  S.add(path(walls, `fill="none" stroke="#4a4460" stroke-width="1.6" stroke-linecap="square"`));

  // Columns, broken where they stand or lying where they fell; a colonnade round the Middle.
  let stand = "";
  let standLit = "";
  let fallen = "";
  let shade = "";
  const column = (x, y, s, hgt) => {
    shade += ell(x + 5 * s, y + 0.4, 7 * s, 1.6 * s);
    stand += poly([[x - 2.6 * s, y], [x - 2.6 * s, y - hgt], [x - 1 * s, y - hgt - 2 * s], [x + 0.6 * s, y - hgt + 0.5], [x + 2.6 * s, y - hgt - 1.2 * s], [x + 2.6 * s, y]], true);
    stand += `M${f(x - 3.6 * s)} ${f(y)}h${f(7.2 * s)}v${f(-1.8 * s)}h${f(-7.2 * s)}Z`;
    standLit += `M${f(x - 2.6 * s)} ${f(y - 1.8 * s)}v${f(-hgt + 1.8 * s)}h${f(1.3 * s)}v${f(hgt - 1.8 * s)}Z`;
  };
  const drop = (x, y, s, a) => {
    const len = (12 + r() * 10) * s;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const w = 2.5 * s;
    fallen += poly([[x - c * len / 2 - sn * w, y - sn * len / 2 + c * w], [x + c * len / 2 - sn * w, y + sn * len / 2 + c * w], [x + c * len / 2 + sn * w, y + sn * len / 2 - c * w], [x - c * len / 2 + sn * w, y - sn * len / 2 - c * w]], true);
    for (let k = 1; k < 3; k++) {
      const t = -0.5 + k / 3;
      fallen += `M${f(x + c * len * t - sn * w)} ${f(y + sn * len * t + c * w)}L${f(x + c * len * t + sn * w)} ${f(y + sn * len * t - c * w)}`;
    }
  };
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * TAU + 0.1;
    if (Math.abs(Math.sin(a) + 1) < 0.25) continue;
    const [x, y] = onMap(L, 99, a);
    const roll = r();
    if (roll < 0.55) column(x, y, 0.95, 9 + r() * 12);
    else if (roll < 0.85) drop(x + 4, y + 2, 0.9, a + Math.PI / 2 + (r() - 0.5));
  }
  S.scatter(18, { gap: 36, pad: 8, keep: (x, y) => S.depth(x, y) > 0.75 }).forEach(([x, y]) => {
    const s = 0.9 + r() * 0.5;
    if (r() < 0.5) column(x, y, s, (10 + r() * 12) * s);
    else drop(x, y, s, (r() - 0.5) * 1.2);
  });
  S.add(path(shade, `fill="#000" opacity=".35"`));
  S.add(path(fallen, `fill="#35304a" stroke="#110f16" stroke-width=".7"`));
  S.add(path(stand, `fill="#35304a" stroke="#110f16" stroke-width=".7"`));
  S.add(path(standLit, `fill="#7c73a0" opacity=".6"`));

  // Footsteps from the camp to the heart, and the same steps again, arriving a moment late.
  const [kx, ky] = S.camp;
  const steps = (lag) => {
    let d = "";
    const n = 38;
    for (let k = 2; k < n - 3; k++) {
      const t = k / n;
      const at = (u) => [lerp(kx, L.cx, u) + Math.sin(u * 6 + lag) * 16, lerp(ky, L.cy, u) + Math.cos(u * 5 + lag) * 7];
      const [x, y] = at(t);
      const [nx, ny] = at(t + 0.01);
      const a = Math.atan2(ny - y, nx - x);
      const side = k % 2 ? 1 : -1;
      d += ell(x - Math.sin(a) * side * 2.3, y + Math.cos(a) * side * 2.3, 1.4, 0.85);
    }
    return d;
  };
  S.add(path(steps(0), `fill="#e2dafa" opacity=".42"`));
  S.add(path(steps(0), `fill="#e2dafa" opacity=".16" transform="translate(-5 2.5)"`));

  // Wisps of the Veil, caught in the air.
  let wisps = "";
  S.scatter(44, { gap: 15 }).forEach(([x, y]) => {
    wisps += circ(x, y, 0.5 + r() * 0.9);
  });
  S.top(path(wisps, `fill="#b9a4f2" opacity=".55" filter="${S.url("b0")}"`));

  // The mist itself, thickest where the light is thinnest.
  let mist = "";
  S.scatter(24, { gap: 50, pad: -80 }).forEach(([x, y]) => {
    mist += ell(x, y, 40 + r() * 60, 10 + r() * 12);
  });
  S.top(path(mist, `fill="#ddd6f6" opacity=".07" filter="${S.url("b3")}"`));

  // The Thin Man's door: two posts and a lintel, and nothing but pale light between them.
  const { cx, cy } = L;
  return [
    `<ellipse cx="${f(cx)}" cy="${f(cy + 4)}" rx="24" ry="7.5" fill="#ece6ff" opacity=".16" filter="${S.url("b1")}"/>`,
    `<path d="M${f(cx - 7)} ${f(cy + 4)}V${f(cy - 16)}H${f(cx + 7)}V${f(cy + 4)}Z" fill="#f2eeff" opacity=".6" filter="${S.url("b1")}"/>`,
    `<path d="M${f(cx - 10.5)} ${f(cy + 5)}V${f(cy - 17)}H${f(cx - 7)}V${f(cy + 5)}ZM${f(cx + 7)} ${f(cy + 5)}V${f(cy - 17)}H${f(cx + 10.5)}V${f(cy + 5)}ZM${f(cx - 12.5)} ${f(cy - 17)}H${f(cx + 12.5)}V${f(cy - 20.5)}H${f(cx - 12.5)}Z" fill="#35304a" stroke="#7c73a0" stroke-width=".7"/>`,
    `<path d="M${f(cx - 0.6)} ${f(cy + 3)}V${f(cy - 12)}" stroke="#14121a" stroke-width="1.5" stroke-linecap="round" opacity=".7"/>`,
  ].join("");
}

/* ---------- 9. Godsdown: roots the width of streets ---------- */
function godsdown(S) {
  const r = S.r;
  const L = S.L;
  S.ground({ base: "#170b0c", patch: "#2e1416", patchAlpha: 0.8, grain: "#9a4a4a", grainAlpha: 0.16, freq: "0.012 0.018" });
  S.blurs();
  S.heartGlow("#c0282e", 0.4, 1.4);

  // Veins in the ground, running the way the roots run.
  let veins = "";
  S.scatter(44, { gap: 24, pad: -20 }).forEach(([x, y]) => {
    const toward = Math.atan2(L.cy - y, L.cx - x);
    veins += crack(r, x, y, toward + (r() - 0.5) * 1.2, 18 + r() * 30, { step: 6, turn: 0.45, fork: 0.3 });
  });
  S.add(path(veins, `fill="none" stroke="#d0282e" stroke-width="2.4" opacity=".2" filter="${S.url("b1")}"`));
  S.add(path(veins, `fill="none" stroke="#8a171c" stroke-width=".85" opacity=".9"`));

  // The roots: in from off the edge of the world, bending as they come, down into the maw.
  const roots = [];
  const n = 10;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + 0.2 + (r() - 0.5) * 0.35;
    const bend = (r() < 0.5 ? -1 : 1) * (0.35 + r() * 0.4);
    const far = [L.cx + Math.cos(a) * 430, L.cy + Math.sin(a) * 290];
    const near = [L.cx + Math.cos(a + bend * 0.3) * 26, L.cy + Math.sin(a + bend * 0.3) * 15];
    const p1 = [L.cx + Math.cos(a + bend) * 250, L.cy + Math.sin(a + bend) * 160];
    const p2 = [L.cx + Math.cos(a - bend * 0.8) * 110, L.cy + Math.sin(a - bend * 0.8) * 70];
    roots.push({ far, p1, p2, near, w: 12 + r() * 14, knots: [0.2 + r() * 0.2, 0.5 + r() * 0.2] });
  }
  const along = (q, t) => {
    const u = 1 - t;
    const b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return [b[0] * q.far[0] + b[1] * q.p1[0] + b[2] * q.p2[0] + b[3] * q.near[0], b[0] * q.far[1] + b[1] * q.p1[1] + b[2] * q.p2[1] + b[3] * q.near[1]];
  };
  let flesh = "";
  let under = "";
  let bark = "";
  let lit = "";
  roots.forEach((q, qi) => {
    const left = [];
    const right = [];
    const lines = [[], []];
    const N = 30;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const [x, y] = along(q, t);
      const [nx, ny] = along(q, Math.min(1, t + 0.01));
      const a = Math.atan2(ny - y, nx - x);
      const knot = q.knots.reduce((m, kt) => m + Math.exp(-((t - kt) ** 2) / 0.002) * 0.28, 0);
      const w = q.w * (1 - t * 0.8) * (1 + knot + Math.sin(t * 19 + qi) * 0.05);
      const ox = -Math.sin(a);
      const oy = Math.cos(a);
      left.push([x + ox * w, y + oy * w * 0.8]);
      right.push([x - ox * w, y - oy * w * 0.8]);
      lines.forEach((ln, i) => {
        const o = (i ? 0.38 : -0.3) * w + Math.sin(t * 40 + i * 2 + qi) * 1.2;
        ln.push([x + ox * o, y + oy * o * 0.8]);
      });
    }
    const body = smooth(left.concat(right.slice().reverse()), true);
    under += body;
    flesh += body;
    lines.forEach((ln) => { bark += smooth(ln); });
    lit += smooth(left);
  });
  S.add(path(under, `fill="#000" opacity=".5" transform="translate(4 5)" filter="${S.url("b1")}"`));
  S.add(path(flesh, `fill="#2b1612" stroke="#0a0404" stroke-width="1.3"`));
  S.add(path(bark, `fill="none" stroke="#120706" stroke-width="1" stroke-dasharray="9 4 3 5" opacity=".85"`));
  S.add(path(lit, `fill="none" stroke="#6a3a2a" stroke-width="1.2" opacity=".55"`));

  // Rootlets off the big ones.
  let small = "";
  roots.forEach((q) => {
    for (let k = 0; k < 3; k++) {
      const [x, y] = along(q, 0.2 + k * 0.2 + r() * 0.08);
      small += crack(r, x, y, r() * TAU, 16 + r() * 20, { step: 5, turn: 0.4, fork: 0.25 });
    }
  });
  S.add(path(small, `fill="none" stroke="#2b1612" stroke-width="2.2" stroke-linecap="round"`));

  // Pools of whatever the roots bleed.
  let pools = "";
  let gloss = "";
  S.scatter(10, { gap: 56, pad: 8 }).forEach(([x, y]) => {
    const rx = 6 + r() * 8;
    pools += blob(r, x, y, rx, rx * 0.45, { jitter: 0.3 });
    gloss += `M${f(x - rx * 0.4)} ${f(y - rx * 0.12)}q${f(rx * 0.3)} ${f(-rx * 0.18)} ${f(rx * 0.6)} 0`;
  });
  S.add(path(pools, `fill="#4a0c11" stroke="#120606" stroke-width=".7"`));
  S.add(path(gloss, `fill="none" stroke="#f08080" stroke-width=".7" opacity=".4"`));

  // Bone, near the maw, from whatever was fed to it.
  let bones = "";
  S.scatter(16, { gap: 16, keep: (x, y) => S.depth(x, y) < 0.62 }).forEach(([x, y]) => {
    const a = r() * Math.PI;
    const dx = Math.cos(a) * 3.8;
    const dy = Math.sin(a) * 1.5;
    bones += `M${f(x - dx)} ${f(y - dy)}L${f(x + dx)} ${f(y + dy)}`;
  });
  S.add(path(bones, `fill="none" stroke="#d6c6ae" stroke-width="1.2" stroke-linecap="round" opacity=".5"`));

  // What Feeds The Roots: the maw, and the root tips curling down into it.
  const { cx, cy } = L;
  let teeth = "";
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    const x = cx + Math.cos(a) * 18;
    const y = cy + Math.sin(a) * 10;
    const ix = cx + Math.cos(a + 0.18) * 9.5;
    const iy = cy + Math.sin(a + 0.18) * 5.2;
    teeth += `M${f(x - Math.sin(a) * 2.2)} ${f(y + Math.cos(a) * 1.3)}Q${f(ix)} ${f(iy)} ${f(ix + Math.cos(a + 1.2) * 2)} ${f(iy + Math.sin(a + 1.2) * 1.2)}Q${f(ix + 1)} ${f(iy)} ${f(x + Math.sin(a) * 2.2)} ${f(y - Math.cos(a) * 1.3)}Z`;
  }
  return [
    `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="24" ry="13.5" fill="#d0282e" opacity=".5" filter="${S.url("b2")}"/>`,
    `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="19" ry="10.5" fill="#040102" stroke="#6a171c" stroke-width="1.5"/>`,
    `<ellipse cx="${f(cx)}" cy="${f(cy + 1)}" rx="8" ry="4" fill="#9a161c" opacity=".6" filter="${S.url("b1")}"/>`,
    path(teeth, `fill="#3d2019" stroke="#0a0404" stroke-width=".6"`),
  ].join("");
}

const ART = { 1: ashenVerge, 2: gallowmoor, 3: coldWarrens, 4: graveshelf, 5: sallowFen, 6: umberdeep, 7: wyrmreach, 8: theFade, 9: godsdown };

/* ================= 7. THE MAP ================= */

/* The inner markup of one region's map, for an <svg viewBox="0 0 640 400">.
   `prefix` keeps the gradient and filter ids apart when two maps share a page. */
export function regionMap(tier, prefix = "rm-") {
  const t = ART[tier] ? tier : 1;
  const S = new Sketch(t, `${prefix}${t}-`);
  const heart = ART[t](S);
  S.vignette();
  return S.markup(heart);
}

// Which regions have a map of their own: all nine.
export const MAPPED_TIERS = Object.keys(ART).map(Number);
