/* ============================================================
   Respite · ui/camp-art.js · The Camps
   ------------------------------------------------------------
   The drawn camp under each gathering page. campScene(skillId,
   stage, prefix) returns the inner markup of one scene for an
   <svg viewBox="0 0 1000 200">: defs, then every layer back to
   front. Nine stages per trade, one each at Lv 1, 10 ... 80;
   CAMP_STAGES holds their names.

   The camp is lit the way it would be: one fire first, then more
   lights as it grows, and the dark pulls back a little with every
   tier. Every lamp, window and fire is gathered in a first pass,
   then everything is drawn lit by all of them. Whatever moves
   carries a cs-* class; the keyframes live in pages.css.

   Pure string building. No DOM, so it runs in node too.
   ============================================================ */

export const CAMP_VIEWBOX = "0 0 1000 200";
const GY = 162; // the camp's ground line

/* ================= 1. NUMBERS AND COLOURS ================= */

const f = (v) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
};
const f2 = (v) => String(Math.round(v * 1000) / 1000);
const P = (arr) => "M" + arr.map(([x, y]) => `${f(x)} ${f(y)}`).join("L") + "Z";
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

function rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
function hexOf(c) {
  return "#" + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
}
function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  const k = clamp(t);
  return hexOf(A.map((v, i) => v + (B[i] - v) * k));
}

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

// Smooth 1D value noise in [-1, 1], knots every `step` units.
function noise1(r, step) {
  const knots = new Map();
  const at = (i) => {
    if (!knots.has(i)) knots.set(i, r() * 2 - 1);
    return knots.get(i);
  };
  return (x) => {
    const i = Math.floor(x / step);
    const t = x / step - i;
    const s = t * t * (3 - 2 * t);
    return at(i) * (1 - s) + at(i + 1) * s;
  };
}

/* ================= 2. PALETTE ================= */

const C = {
  ink: "#060509",
  sil: "#100c15",
  woodD: "#1d1613", woodL: "#6f4a31", woodR: "#f0aa66",
  stoneD: "#17141b", stoneL: "#5e4b43", stoneR: "#e0ad7e",
  clothD: "#1b1619", clothL: "#79593f", clothR: "#f2c084",
  fire0: "#fff5d2", fire1: "#ffd47c", fire2: "#f59a3c", fire3: "#d8663a", fire4: "#7d3a2c",
  lamp: "#ffcf78",
  moon: "#ebe3d6",
  rim: "#6d5a9c",
  violet: "#9d82e0", violetHi: "#c9b7ff",
  banner: "#4f1915", bannerL: "#9b3a29", gold: "#d9b566",
};

/* ================= 3. THE SCENE ================= */

const LAYERS = ["sky", "far", "mid", "back", "ground", "camp", "front", "fx", "top"];

class Scene {
  constructor(skill, stage, pfx) {
    this.skill = skill;
    this.stage = stage;
    this.p = pfx;
    this.defs = [];
    this.items = [];
    this.lights = [];
    this.n = 0;
    this.seq = 0;
  }
  has(n) { return this.stage >= n; }
  uid(k = "g") { return `${this.p}${k}${this.n++}`; }
  rnd(key) { return mulberry(hashStr(`${this.skill}:${key}`)); }
  add(layer, z, svg) { if (!this.dry) this.items.push({ l: LAYERS.indexOf(layer), z, i: this.seq++, svg }); }
  def(s) { if (!this.dry) this.defs.push(s); }

  stops(list) {
    return list.map(([o, c, a = 1]) => `<stop offset="${f2(o)}" stop-color="${c}"${a < 1 ? ` stop-opacity="${f2(a)}"` : ""}/>`).join("");
  }
  // Linear gradient. User space when coords are given in units (user: true).
  lin(list, { x1 = 0, y1 = 0, x2 = 0, y2 = 1, user = false } = {}) {
    const id = this.uid("l");
    const n = user ? f : f2;
    const u = user ? ' gradientUnits="userSpaceOnUse"' : "";
    this.def(`<linearGradient id="${id}" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"${u}>${this.stops(list)}</linearGradient>`);
    return `url(#${id})`;
  }
  // Radial gradient in user space: centre, radius, and a vertical squash.
  rad(list, cx, cy, r, sy = 1) {
    const id = this.uid("r");
    const tf = sy !== 1 ? ` gradientTransform="translate(${f(cx)} ${f(cy)}) scale(1 ${f2(sy)}) translate(${f(-cx)} ${f(-cy)})"` : "";
    this.def(`<radialGradient id="${id}" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" gradientUnits="userSpaceOnUse"${tf}>${this.stops(list)}</radialGradient>`);
    return `url(#${id})`;
  }
  // Radial gradient in the shape's own box.
  radBox(list, { cx = 0.5, cy = 0.5, r = 0.5, fx, fy } = {}) {
    const id = this.uid("r");
    const foc = fx != null ? ` fx="${f2(fx)}" fy="${f2(fy)}"` : "";
    this.def(`<radialGradient id="${id}" cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(r)}"${foc}>${this.stops(list)}</radialGradient>`);
    return `url(#${id})`;
  }

  light(x, y, r, k = 1) { if (!this.frozen) this.lights.push({ x, y, r, k }); }
  // How much warm light reaches a point, 0 to 1.
  lit(x, y = GY - 12) {
    let v = 0;
    for (const L of this.lights) {
      const dx = x - L.x;
      const dy = (y - L.y) * 1.3;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < L.r) v += L.k * Math.pow(1 - d / L.r, 1.45);
    }
    return clamp(v);
  }
  // Which way the main fire is from x: -1 left, 1 right.
  towardFire(x) { return x < this.fireX ? 1 : -1; }

  render() {
    this.items.sort((a, b) => a.l - b.l || a.z - b.z || a.i - b.i);
    return `<defs>${this.defs.join("")}</defs>` + this.items.map((it) => it.svg).join("");
  }
}

/* ================= 4. SKY ================= */

function sky(S, o) {
  const top = o.top || "#0b0913";
  const g = S.lin([[0, top], [0.35, "#120e1c"], [0.62, "#1c1529"], [0.85, "#2a2039"], [1, "#382b4c"]], { x1: 0, y1: 0, x2: 0, y2: 158, user: true });
  S.add("sky", 0, `<rect width="1000" height="200" fill="${g}"/>`);

  // The camp's own light reaches the underside of the sky as it grows.
  const warm = 0.03 + S.stage * 0.012;
  S.add("sky", 1, `<ellipse cx="${f(S.fireX + 60)}" cy="160" rx="420" ry="70" fill="${S.rad([[0, "#c2683a", warm], [1, "#c2683a", 0]], S.fireX + 60, 160, 420, 70 / 420)}"/>`);

  // stars
  const r = S.rnd("stars");
  let still = "";
  let tw = "";
  const n = o.stars ?? 54;
  for (let i = 0; i < n; i++) {
    const x = r() * 1000;
    const y = 4 + Math.pow(r(), 1.5) * 112;
    const rad = 0.35 + r() * 0.55;
    const a = (0.25 + r() * 0.6) * (1 - y / 150);
    const c = `<circle cx="${f(x)}" cy="${f(y)}" r="${f2(rad)}" fill="#ece5f5" fill-opacity="${f2(a)}"`;
    if (i % 6 === 0) tw += `${c} class="cs-star" style="--dl:${f(-r() * 6)}s;--t:${f(3 + r() * 4)}s"/>`;
    else still += c + "/>";
  }
  // a few bright ones with a faint cross
  for (let i = 0; i < 3; i++) {
    const x = 60 + r() * 880;
    const y = 10 + r() * 45;
    still += `<path d="M${f(x - 3)} ${f(y)}H${f(x + 3)}M${f(x)} ${f(y - 3)}V${f(y + 3)}" stroke="#ece5f5" stroke-opacity=".25" stroke-width=".4"/><circle cx="${f(x)}" cy="${f(y)}" r="1.1" fill="#f4efff" fill-opacity=".85"/>`;
  }
  S.add("sky", 2, `<g>${still}</g><g>${tw}</g>`);

  // the moon
  const [mx, my] = o.moon;
  const mr = o.moonR || 9;
  const mc = o.moonTint || C.moon;
  S.add("sky", 3,
    `<circle cx="${f(mx)}" cy="${f(my)}" r="${f(mr * 9)}" fill="${S.rad([[0, "#b9a4f2", 0.11], [0.35, "#b9a4f2", 0.04], [1, "#b9a4f2", 0]], mx, my, mr * 9)}"/>` +
    `<circle cx="${f(mx)}" cy="${f(my)}" r="${f(mr * 2.6)}" fill="${S.rad([[0, mc, 0.28], [1, mc, 0]], mx, my, mr * 2.6)}"/>` +
    `<circle cx="${f(mx)}" cy="${f(my)}" r="${f(mr)}" fill="${S.rad([[0, "#fffaf0"], [0.7, mc], [1, mix(mc, "#8c8296", 0.35)]], mx - mr * 0.35, my - mr * 0.4, mr * 1.4)}"/>` +
    `<circle cx="${f(mx + mr * 0.3)}" cy="${f(my + mr * 0.15)}" r="${f(mr * 0.28)}" fill="#9b92a0" fill-opacity=".28"/>` +
    `<circle cx="${f(mx - mr * 0.35)}" cy="${f(my + mr * 0.4)}" r="${f(mr * 0.18)}" fill="#9b92a0" fill-opacity=".25"/>` +
    `<circle cx="${f(mx - mr * 0.1)}" cy="${f(my - mr * 0.45)}" r="${f(mr * 0.14)}" fill="#9b92a0" fill-opacity=".2"/>`);

  // soft clouds: clusters of blurred-looking ellipses, the one over the moon lit from behind
  const cr = S.rnd("cloud");
  let clouds = "";
  const bands = o.clouds ?? 4;
  for (let i = 0; i < bands; i++) {
    const cx = i === 0 ? mx + (o.cloudDx ?? -18) : 60 + cr() * 880;
    const cy = i === 0 ? my + mr * 0.9 : 26 + cr() * 64;
    const w = i === 0 ? 170 : 110 + cr() * 180;
    const near = Math.max(0, 1 - Math.hypot(cx - mx, cy - my) / 140);
    const col = mix("#231b31", "#8a7aa8", near * 0.55);
    let puffs = "";
    const k = 6 + Math.floor(cr() * 4);
    for (let j = 0; j < k; j++) {
      const t = j / (k - 1);
      const px = cx - w / 2 + t * w + (cr() - 0.5) * 14;
      const py = cy - Math.sin(t * Math.PI) * (2 + cr() * 3) + (cr() - 0.5) * 2;
      const rx = w * (0.12 + cr() * 0.1);
      const ry = 3 + cr() * 3.5;
      puffs += `<ellipse cx="${f(px)}" cy="${f(py)}" rx="${f(rx)}" ry="${f(ry)}"/>`;
    }
    const fill = S.radBox([[0, col, 0.75], [0.6, col, 0.45], [1, col, 0]]);
    clouds += `<g class="cs-drift" style="--dl:${f(-cr() * 40)}s;--t:${f(80 + cr() * 60)}s;--dx:${f(12 + cr() * 20)}px" fill="${fill}">${puffs}</g>`;
    if (i === 0) clouds += `<g class="cs-drift" style="--dl:${f(-cr() * 40)}s;--t:95s;--dx:16px"><ellipse cx="${f(cx + 6)}" cy="${f(cy - 3.5)}" rx="${f(w * 0.36)}" ry="1.6" fill="${S.radBox([[0, "#c9b7ff", 0.35], [1, "#c9b7ff", 0]])}"/></g>`;
  }
  S.add("sky", 4, clouds);
}

/* ================= 5. TERRAIN ================= */

// A ridge line sampled across the width, closed below the frame.
function ridge(ys, x0, dx, bottom = 210) {
  let d = `M${f(x0)} ${bottom}`;
  ys.forEach((y, i) => { d += `L${f(x0 + i * dx)} ${f(y)}`; });
  d += `L${f(x0 + (ys.length - 1) * dx)} ${bottom}Z`;
  return d;
}

// Mountains: a field of peaks, each a cone, the skyline their minimum.
function peakYs(r, o) {
  return peaks(r, o).ys;
}
function peaks(r, { base, peaks: n, hMin, hMax, sMin, sMax, jag = 3, x0 = -20, x1 = 1020, dx = 4, keep = [] }) {
  const list = keep.slice();
  for (let i = 0; i < n; i++) list.push({ x: x0 + r() * (x1 - x0), h: hMin + r() * (hMax - hMin), s: sMin + r() * (sMax - sMin) });
  const nz = noise1(r, 9);
  const nz2 = noise1(r, 3);
  const ys = [];
  for (let x = x0; x <= x1; x += dx) {
    let y = base;
    for (const p of list) y = Math.min(y, base - p.h + Math.abs(x - p.x) * p.s);
    ys.push(y + nz(x) * jag + nz2(x) * jag * 0.35);
  }
  return { ys, list, x0, dx, base };
}

// The moonlit face of each peak that shows: a lighter wedge down one slope.
function facets(S, layer, z, pk, { moonX, col, op = 0.5 }) {
  const { ys, list, x0, dx, base } = pk;
  let d = "";
  for (const p of list) {
    const i = Math.round((p.x - x0) / dx);
    if (i < 1 || i >= ys.length - 1) continue;
    const top = base - p.h;
    if (Math.abs(ys[i] - top) > 4) continue; // hidden behind a nearer peak
    const dir = p.x < moonX ? 1 : -1;
    const span = Math.min(90, (p.h / p.s) * 0.75);
    const steps = Math.max(2, Math.round(span / dx));
    const pts = [[p.x, ys[i]]];
    for (let k = 1; k <= steps; k++) {
      const j = i + dir * k;
      if (j < 0 || j >= ys.length) break;
      pts.push([x0 + j * dx, ys[j] + 0.6]);
    }
    const last = pts[pts.length - 1];
    pts.push([p.x + dir * span * 0.42, top + p.h * 0.72], [p.x + dir * 1.5, top + p.h * 0.35]);
    d += P(pts);
  }
  if (!d) return;
  const g = S.lin([[0, col, op], [0.7, col, op * 0.25], [1, col, 0]], { x1: 0, y1: 0, x2: 0, y2: 1 });
  S.add(layer, z, `<path d="${d}" fill="${g}"/>`);
}

// Rolling hills from a few sines and a little noise.
function hillYs(r, { base, amp, waves = 3, x0 = -20, x1 = 1020, dx = 6, noise = 1.5 }) {
  const w = [];
  for (let i = 0; i < waves; i++) w.push({ a: amp * (0.4 + r() * 0.6) / (i + 1), k: (0.004 + r() * 0.006) * (i + 1), p: r() * 6.28 });
  const nz = noise1(r, 14);
  const ys = [];
  for (let x = x0; x <= x1; x += dx) {
    let y = base;
    for (const s of w) y += Math.sin(x * s.k + s.p) * s.a;
    ys.push(y + nz(x) * noise);
  }
  return ys;
}

function layerRidge(S, layer, z, ys, x0, dx, { fill, rim, rimOp = 0.5, rimW = 1 }) {
  const d = ridge(ys, x0, dx);
  S.add(layer, z, `<path d="${d}" fill="${fill}"${rim ? ` stroke="${rim}" stroke-opacity="${f2(rimOp)}" stroke-width="${f2(rimW)}"` : ""}/>`);
}

// Fog lying at height y: a thin even band and a drift of soft patches.
function fog(S, layer, z, y, h, op, col = "#8f7fb0", { patches = 5, seed = "fog" } = {}) {
  const g = S.lin([[0, col, 0], [0.55, col, op * 0.55], [1, col, 0]], { x1: 0, y1: y - h / 2, x2: 0, y2: y + h / 2, user: true });
  let s = `<rect x="-60" y="${f(y - h / 2)}" width="1120" height="${f(h)}" fill="${g}"/>`;
  const r = S.rnd(`${seed}${Math.round(y)}`);
  const fill = S.radBox([[0, col, op], [0.5, col, op * 0.5], [1, col, 0]]);
  for (let i = 0; i < patches; i++) {
    s += `<ellipse cx="${f(r() * 1000)}" cy="${f(y + (r() - 0.5) * h * 0.4)}" rx="${f(90 + r() * 170)}" ry="${f(h * (0.25 + r() * 0.2))}" fill="${fill}"/>`;
  }
  S.add(layer, z, `<g class="cs-fog" style="--dl:${f(-(y * 7) % 50)}s">${s}</g>`);
}

// Serrated pines along a base line, as one path. Distant, so a few notches each.
function pineRow(r, { x0, x1, base, hMin, hMax, gap = [6, 14], lean = 0 }) {
  let d = "";
  for (let x = x0; x < x1; x += gap[0] + r() * (gap[1] - gap[0])) {
    const h = hMin + r() * (hMax - hMin);
    const w = h * (0.2 + r() * 0.08);
    const tip = x + lean * h;
    const pts = [[x - w, base + 1]];
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      pts.push([x - w * (1 - t) * 0.55, base - h * t + 1], [x - w * (1 - t) * 0.95, base - h * t + 3]);
    }
    pts.push([tip, base - h]);
    for (let i = 3; i >= 1; i--) {
      const t = i / 4;
      pts.push([x + w * (1 - t) * 0.95, base - h * t + 3], [x + w * (1 - t) * 0.55, base - h * t + 1]);
    }
    pts.push([x + w, base + 1]);
    d += "M" + pts.map(([a, b]) => `${Math.round(a)} ${Math.round(b)}`).join("L") + "Z";
  }
  return d;
}

// A bare tree: recursive branches, drawn as stroked lines grouped by width.
function bareTree(r, x, y, h, { spread = 0.55, depth = 5, lean = 0, twist = 0.35, w0 } = {}) {
  const byW = new Map();
  const put = (w, seg) => {
    const k = Math.round(w * 4) / 4;
    byW.set(k, (byW.get(k) || "") + seg);
  };
  const grow = (x0, y0, ang, len, w, d) => {
    const bend = (r() - 0.5) * twist;
    const mx = x0 + Math.cos(ang + bend) * len * 0.5;
    const my = y0 + Math.sin(ang + bend) * len * 0.5;
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    put(w, `M${f(x0)} ${f(y0)}Q${f(mx)} ${f(my)} ${f(x1)} ${f(y1)}`);
    if (d <= 0 || len < 2.5) return;
    const kids = d > depth - 2 ? 2 : 2 + (r() < 0.35 ? 1 : 0);
    for (let i = 0; i < kids; i++) {
      const a = ang + (i - (kids - 1) / 2) * spread * (0.7 + r() * 0.6) + (r() - 0.5) * 0.3;
      grow(x1, y1, a, len * (0.62 + r() * 0.18), Math.max(0.4, w * 0.62), d - 1);
    }
  };
  grow(x, y, -Math.PI / 2 + lean, h * 0.42, w0 || Math.max(1.2, h * 0.06), depth);
  return byW;
}

function treeSvg(byW, col, op = 1) {
  let s = "";
  for (const [w, d] of byW) s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${f2(w)}" stroke-linecap="round"${op < 1 ? ` stroke-opacity="${f2(op)}"` : ""}/>`;
  return s;
}

/* ================= 6. GROUND ================= */

function ground(S, o = {}) {
  const top = o.top || "#211a28";
  const g = S.lin([[0, top], [0.2, "#17121c"], [0.6, "#0e0b12"], [1, "#070509"]], { x1: 0, y1: GY - 10, x2: 0, y2: 200, user: true });
  const nz = noise1(S.rnd("ground"), 40);
  const ys = [];
  for (let x = -20; x <= 1020; x += 10) ys.push(GY - 7 + nz(x) * 2.2);
  S.add("ground", 0, `<path d="${ridge(ys, -20, 10)}" fill="${g}"/>`);

  // worn streaks in the earth
  const r = S.rnd("streaks");
  let st = "";
  for (let i = 0; i < 22; i++) {
    const y = GY + 3 + Math.pow(r(), 1.2) * 30;
    const x = r() * 1000;
    const w = 10 + r() * 34;
    st += `M${f(x)} ${f(y)}q${f(w / 2)} ${f(-0.8)} ${f(w)} 0`;
  }
  S.add("ground", 0.5, `<path d="${st}" fill="none" stroke="#2a2030" stroke-opacity=".3" stroke-width=".7"/>`);

  // the warm pool the fires throw on the ground: a broad dim wash and a tight bright one
  const fx = S.fireX;
  const reach = 170 + S.stage * 14;
  S.add("ground", 1, `<ellipse cx="${f(fx)}" cy="${f(GY + 7)}" rx="${f(reach)}" ry="${f(26 + S.stage)}" fill="${S.rad([[0, "#d8743f", 0.34], [0.4, "#a8502c", 0.16], [1, "#7d3a2c", 0]], fx, GY + 7, reach, (26 + S.stage) / reach)}"/>` +
    `<ellipse cx="${f(fx)}" cy="${f(GY + 4)}" rx="70" ry="11" fill="${S.rad([[0, "#ffc070", 0.5], [0.5, "#f08a40", 0.2], [1, "#d8743f", 0]], fx, GY + 4, 70, 11 / 70)}"/>`);
}

// A path trodden from the fire out to the work, lighter where the light falls on it.
function trail(S, x0, x1, y0 = GY + 4, y1 = GY + 2) {
  const g = S.lin([[0, "#3a2a24", 0.0], [0.15, "#6b4632", 0.35], [0.6, "#3a2a2a", 0.18], [1, "#2a2230", 0]], { x1: x0, y1: 0, x2: x1, y2: 0, user: true });
  const d = `M${f(x0)} ${f(y0 + 3)}C${f(x0 + (x1 - x0) * 0.3)} ${f(y0 + 5)} ${f(x0 + (x1 - x0) * 0.7)} ${f(y1 + 3)} ${f(x1)} ${f(y1 + 1)}L${f(x1)} ${f(y1 - 1)}C${f(x0 + (x1 - x0) * 0.7)} ${f(y1 - 1)} ${f(x0 + (x1 - x0) * 0.3)} ${f(y0 - 1)} ${f(x0)} ${f(y0 - 2)}Z`;
  S.add("ground", 2, `<path d="${d}" fill="${g}"/>`);
}

// Pebbles and tufts scattered over the ground, lit near the fire.
function scatter(S, { n = 60, x0 = 0, x1 = 1000, y0 = GY - 2, y1 = 198, kind = "stone", seed = "sc" } = {}) {
  const r = S.rnd(seed);
  let s = "";
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * (x1 - x0);
    const y = y0 + Math.pow(r(), 0.9) * (y1 - y0);
    const k = (y - GY) / (200 - GY);
    const L = S.lit(x, y);
    if (kind === "stone") {
      const w = 0.5 + r() * 1.3 + k * 1.6;
      const h = w * (0.35 + r() * 0.25);
      s += `<path d="M${f(x - w)} ${f(y)}Q${f(x - w * 0.8)} ${f(y - h * 1.6)} ${f(x + w * 0.1)} ${f(y - h * 1.5)}Q${f(x + w)} ${f(y - h)} ${f(x + w)} ${f(y)}Z" fill="${mix("#0d0a10", "#3a2a26", L * 0.7)}"/>`;
      if (L > 0.12) s += `<path d="M${f(x - w * 0.7)} ${f(y - h * 1.1)}Q${f(x)} ${f(y - h * 1.9)} ${f(x + w * 0.6)} ${f(y - h * 1.1)}" fill="none" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.55)}" stroke-width=".45"/>`;
    } else {
      const h = 2 + r() * 3 + k * 4;
      let d = "";
      const blades = 3 + Math.floor(r() * 3);
      for (let b = 0; b < blades; b++) {
        const a = (b / (blades - 1) - 0.5) * 1.1 + (r() - 0.5) * 0.3;
        d += `M${f(x + (b - blades / 2) * 0.6)} ${f(y)}q${f(Math.sin(a) * h * 0.4)} ${f(-h * 0.6)} ${f(Math.sin(a) * h)} ${f(-h * Math.cos(a))}`;
      }
      s += `<path d="${d}" fill="none" stroke="${mix("#0d0b10", "#5a4030", L * 0.7)}" stroke-width=".7" stroke-linecap="round"/>`;
    }
  }
  S.add("ground", 3, s);
}

/* ================= 7. THE DARK AND THE GRAIN ================= */

function finish(S) {
  // haze lying low over the ground, behind the camp
  fog(S, "ground", 0.7, GY - 4, 22, 0.1 - S.stage * 0.004, "#8f7fb0", { patches: 4, seed: "lowfog" });

  // the dark beyond the light: strongest at the first fire, thinner every tier
  const dark = [0.66, 0.62, 0.58, 0.54, 0.5, 0.46, 0.42, 0.38, 0.34][S.stage - 1];
  const cx = S.fireX + 40;
  S.add("top", 0, `<rect width="1000" height="200" fill="${S.rad([[0, "#030205", 0], [0.42, "#030205", 0], [0.78, "#030205", dark * 0.5], [1, "#030205", dark]], cx, 150, 640, 0.5)}"/>`);
  // the top of the sky and the foot of the frame sink a little
  S.add("top", 1, `<rect width="1000" height="200" fill="${S.lin([[0, "#030205", 0.35], [0.22, "#030205", 0], [0.86, "#030205", 0], [1, "#030205", 0.45]], { x1: 0, y1: 0, x2: 0, y2: 200, user: true })}"/>`);

  // grain: a tile of faint specks, light and dark, that breaks up the banding
  const id = S.uid("grain");
  const r = mulberry(7);
  let lightD = "";
  let darkD = "";
  for (let i = 0; i < 150; i++) {
    const sq = `M${f(r() * 48)} ${f(r() * 48)}h.6v.6h-.6z`;
    if (r() < 0.5) lightD += sq;
    else darkD += sq;
  }
  S.def(`<pattern id="${id}" width="48" height="48" patternUnits="userSpaceOnUse"><path d="${lightD}" fill="#fff" fill-opacity=".055"/><path d="${darkD}" fill="#000" fill-opacity=".13"/></pattern>`);
  S.add("top", 2, `<rect width="1000" height="200" fill="url(#${id})"/>`);
}

/* The pieces every camp is built from: the fire, shelter, stores,
   the wall, the tower, lamps, banners, carts and the crew. */

/* ================= FIRE, SMOKE, SPARKS ================= */

const FLAME = [
  "M-9 0C-10.5-5-7.6-9.2-6.6-13C-5.9-10.6-4.3-9.7-3.5-11.3C-3.7-15.6-1.9-19.8.4-25.4C1.3-20.6 3.2-17.9 4-14.7C4.8-16.5 6-17.8 7.3-19.8C8.5-15 10.3-9.2 9 0Q0 2.4-9 0Z",
  "M-6.3 0C-7.3-4.2-4.9-7.5-4.1-10.7C-3.3-8.9-2.3-8.5-1.7-9.7C-1.9-13.3-.5-16.6 1-20.2C1.7-16.4 3.3-13.9 3.9-11.1C4.5-12.3 5.5-13.3 6.1-14.6C6.9-9.9 7.3-5 6.3 0Q0 1.8-6.3 0Z",
  "M-3.7 0C-4.3-3.4-2.7-6.3-1.9-8.5C-1.3-7.3-.7-7.1-.3-8.1C-.3-10.7.5-12.8 1.6-14.8C2.3-12 3.5-9.7 3.9-7.1C4.5-4.9 4.5-2.4 3.7 0Q0 1.2-3.7 0Z",
];

function smoke(S, x, y, { n = 4, size = 1, dx = 22, dy = -72, t = 10, op = 0.8, tone = "#8a8098", layer = "fx", z = 50 } = {}) {
  if (!S.smokeFill) S.smokeFill = {};
  if (!S.smokeFill[tone]) S.smokeFill[tone] = S.radBox([[0, tone, 0.24], [0.55, tone, 0.1], [1, tone, 0]]);
  const fill = S.smokeFill[tone];
  let s = "";
  for (let i = 0; i < n; i++) {
    const dl = -(t / n) * i;
    s += `<g transform="translate(${f(x)} ${f(y)})"><circle class="cs-smoke" r="${f(7 * size)}" fill="${fill}" style="--dl:${f(dl)}s;--t:${f(t)}s;--dx:${f(dx)}px;--dy:${f(dy)}px;--o:${f2(op)}"/></g>`;
  }
  S.add(layer, z, s);
}

function sparks(S, x, y, { n = 9, spread = 10, rise = 42, size = 1, z = 60 } = {}) {
  const r = S.rnd(`sp${Math.round(x)}`);
  let s = "";
  for (let i = 0; i < n; i++) {
    const dx = (r() - 0.35) * spread * 2.4;
    const dy = -rise * (0.6 + r() * 0.7);
    const t = 1.6 + r() * 1.8;
    s += `<circle class="cs-spark" cx="${f(x + (r() - 0.5) * 6 * size)}" cy="${f(y)}" r="${f2((0.45 + r() * 0.5) * size)}" fill="${r() < 0.5 ? "#ffd896" : "#ff9d52"}" style="--dl:${f(-r() * t)}s;--t:${f(t)}s;--dx:${f(dx)}px;--dy:${f(dy)}px"/>`;
  }
  S.add("fx", z, s);
}

// The camp fire. Registers its own light; call it before anything that reads S.lit().
function campfire(S, x, y, { size = 1, sparksN = 9, smokeN = 4, ring = true, bloom = 1 } = {}) {
  const s = size;
  S.fireX = x;
  S.fireY = y;

  // bloom in the air around it, over everything near
  S.add("fx", 10, `<circle class="cs-glow" cx="${f(x)}" cy="${f(y - 12 * s)}" r="${f(95 * s)}" fill="${S.rad([[0, "#ffb05c", 0.2 * bloom], [0.3, "#f0823c", 0.08 * bloom], [1, "#d8663a", 0]], x, y - 12 * s, 95 * s)}"/>`);

  // stones behind, the bed, logs, flames, stones in front
  const stones = (front) => {
    let out = "";
    const k = 10;
    for (let i = 0; i < k; i++) {
      const a = Math.PI * ((i + 0.5) / k);
      const sx = x - Math.cos(a) * 15.5 * s;
      const sy = y + (front ? 1.6 + Math.sin(a) * 2.8 : -0.8 - Math.sin(a) * 1.4) * s;
      const w = (2.4 + ((i * 7) % 4) * 0.45) * s;
      const hgt = w * (0.55 + ((i * 3) % 3) * 0.08);
      const body = front ? "#1a1216" : "#2a1a18";
      out += `<path d="M${f(sx - w)} ${f(sy + hgt * 0.5)}Q${f(sx - w * 1.05)} ${f(sy - hgt * 0.8)} ${f(sx - w * 0.1)} ${f(sy - hgt)}Q${f(sx + w)} ${f(sy - hgt * 0.9)} ${f(sx + w)} ${f(sy + hgt * 0.5)}Z" fill="${body}"/>` +
        `<path d="M${f(sx - w * 0.8)} ${f(sy - hgt * 0.35)}Q${f(sx - w * 0.2)} ${f(sy - hgt * 1.05)} ${f(sx + w * 0.7)} ${f(sy - hgt * 0.55)}" fill="none" stroke="${front ? "#e8904a" : "#ffb466"}" stroke-opacity="${front ? ".75" : ".9"}" stroke-width="${f2(0.7 * s)}" stroke-linecap="round"/>`;
    }
    return out;
  };
  if (ring) S.add("camp", y - 1, stones(false));

  const bed = `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(12 * s)}" ry="${f(3.2 * s)}" fill="${S.radBox([[0, "#ffd48a", 0.95], [0.45, "#e0662e", 0.8], [1, "#6b2a1e", 0]])}"/>`;
  const log = (x0, y0, x1, y1) => `<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}" stroke="#231914" stroke-width="${f2(3.2 * s)}" stroke-linecap="round"/>` +
    `<path d="M${f(x0)} ${f(y0 - 1.1 * s)}L${f(x1)} ${f(y1 - 1.1 * s)}" stroke="#e0823f" stroke-opacity=".75" stroke-width="${f2(0.8 * s)}" stroke-linecap="round"/>` +
    `<circle cx="${f(x1)}" cy="${f(y1)}" r="${f2(1.3 * s)}" fill="#ff9d52"/>`;
  const logs = log(x - 13 * s, y + 1.5 * s, x + 6 * s, y - 2 * s) + log(x + 13 * s, y + 1.8 * s, x - 5 * s, y - 2.2 * s);

  const grad = [
    S.lin([[0, "#b5452a"], [0.45, "#e8662f"], [0.85, "#f59a3c", 0.9], [1, "#f5b35a", 0.3]], { x1: 0, y1: 1, x2: 0, y2: 0 }),
    S.lin([[0, "#f07a33"], [0.6, "#ffb458"], [1, "#ffd27a", 0.55]], { x1: 0, y1: 1, x2: 0, y2: 0 }),
    S.lin([[0, "#ffd98f"], [0.7, "#fff1c4"], [1, "#fff8e0", 0.7]], { x1: 0, y1: 1, x2: 0, y2: 0 }),
  ];
  const flames = `<g transform="translate(${f(x)} ${f(y - 0.5 * s)}) scale(${f2(s)})">` +
    FLAME.map((d, i) => `<path class="cs-fl cs-fl${i + 1}" d="${d}" fill="${grad[i]}"/>`).join("") +
    `<ellipse class="cs-fl cs-fl3" cx=".2" cy="-2" rx="3" ry="2.2" fill="#fff6d8"/></g>`;

  S.add("camp", y, bed + logs + flames);
  if (ring) S.add("camp", y + 2, stones(true));

  sparks(S, x, y - 16 * s, { n: sparksN, size: s });
  if (smokeN) smoke(S, x + 2, y - 26 * s, { n: smokeN, size: 0.9 * s, t: 11, dx: 26, dy: -80, op: 0.7 });
}

// A small fire with no ring: a brazier's flame, a forge mouth, a cauldron's bed.
function smallFlame(S, x, y, s = 0.5, layer = "camp", z = y) {
  const g = [
    S.lin([[0, "#c24b2b"], [0.6, "#f07a33"], [1, "#ffb458", 0.4]], { x1: 0, y1: 1, x2: 0, y2: 0 }),
    S.lin([[0, "#ffc46a"], [1, "#fff1c4", 0.7]], { x1: 0, y1: 1, x2: 0, y2: 0 }),
  ];
  S.add(layer, z, `<g transform="translate(${f(x)} ${f(y)}) scale(${f2(s)})"><path class="cs-fl cs-fl2" d="${FLAME[0]}" fill="${g[0]}"/><path class="cs-fl cs-fl3" d="${FLAME[2]}" fill="${g[1]}"/></g>`);
}

/* ================= LIGHT FIXTURES ================= */

// A hanging lantern. Adds a small light to the scene.
function lantern(S, x, y, { z = 200, size = 1, hook = true, layer = "camp", k = 0.3, r = 70, lightOnly = false } = {}) {
  S.light(x, y, r, k);
  if (lightOnly) return;
  const s = size;
  const halo = S.rad([[0, "#ffc46a", 0.5], [0.25, "#ffb05c", 0.18], [1, "#ffb05c", 0]], x, y, 16 * s);
  S.add(layer, z,
    (hook ? `<path d="M${f(x)} ${f(y - 4.6 * s)}v${f(-2 * s)}" stroke="#1a1411" stroke-width="${f2(0.6 * s)}"/>` : "") +
    `<path d="M${f(x - 1.9 * s)} ${f(y - 3.4 * s)}H${f(x + 1.9 * s)}L${f(x + 2.3 * s)} ${f(y + 2.6 * s)}H${f(x - 2.3 * s)}Z" fill="#ffd98c"/>` +
    `<path d="M${f(x - 2.6 * s)} ${f(y - 3.4 * s)}H${f(x + 2.6 * s)}M${f(x - 2.8 * s)} ${f(y + 2.8 * s)}H${f(x + 2.8 * s)}M${f(x - 1.2 * s)} ${f(y - 4.8 * s)}H${f(x + 1.2 * s)}L${f(x)} ${f(y - 6 * s)}Z" stroke="#1a1411" stroke-width="${f2(0.9 * s)}" fill="#1a1411"/>` +
    `<path d="M${f(x)} ${f(y - 3.2 * s)}V${f(y + 2.6 * s)}" stroke="#7a4a28" stroke-width="${f2(0.5 * s)}"/>`);
  S.add("fx", 20, `<circle class="cs-lamp" cx="${f(x)}" cy="${f(y)}" r="${f(16 * s)}" fill="${halo}" style="--dl:${f(-((x * 13) % 30) / 10)}s"/>`);
}

// A rope slung between two points with lanterns along it.
function lanternString(S, x0, y0, x1, y1, { n = 3, sag = 10, z = 200, size = 0.9 } = {}) {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2 + sag * 2;
  S.add("camp", z - 1, `<path d="M${f(x0)} ${f(y0)}Q${f(mx)} ${f(my)} ${f(x1)} ${f(y1)}" fill="none" stroke="#221a16" stroke-width=".7"/>`);
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1;
    const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1;
    lantern(S, x, y + 7 * size, { z, size, k: 0.22, r: 55 });
    S.add("camp", z - 0.5, `<path d="M${f(x)} ${f(y)}V${f(y + 1.8 * size)}" stroke="#221a16" stroke-width=".5"/>`);
  }
}

// A lamp on a post.
function lampPost(S, x, y, { h = 26, z = y, size = 0.9 } = {}) {
  const L = S.lit(x, y - h / 2);
  S.add("camp", z,
    `<path d="M${f(x)} ${f(y)}V${f(y - h)}h${f(5 * size)}" fill="none" stroke="${mix(C.woodD, C.woodL, L * 0.8)}" stroke-width="${f2(1.6)}" stroke-linecap="round"/>`);
  lantern(S, x + 5 * size, y - h + 7.5 * size, { z: z + 0.1, size, k: 0.32, r: 70 });
  groundGlow(S, x + 5 * size, 22, 0.3, y + 1);
}

/* ================= BANNERS ================= */

// A pole with a swallowtail banner. The cloth sways.
function banner(S, x, y, { h = 44, w = 13, len = 26, z = y, col = C.banner, pole = true, sigil = true, layer = "camp" } = {}) {
  const top = y - h;
  const L = S.lit(x, y - h * 0.6);
  const cloth = S.lin([[0, mix(col, "#e0823f", L * 0.35)], [1, mix(col, "#000", 0.35)]], { x1: 0, y1: 0, x2: 1, y2: 0 });
  const cl = `M0 0H${f(w)}V${f(len)}L${f(w / 2)} ${f(len - 6)}L0 ${f(len)}Z`;
  const sig = sigil ? `<path d="M${f(w / 2)} ${f(len * 0.28)}c-1.8 2.4-2.6 4.1-1.2 6 .5-1.3 1.2-1.6 1.2-1.6s.7.3 1.2 1.6c1.4-1.9.6-3.6-1.2-6Z" fill="${C.gold}" fill-opacity=".85"/><path d="M1.2 1.6H${f(w - 1.2)}" stroke="${C.gold}" stroke-opacity=".6" stroke-width=".6"/>` : "";
  S.add(layer, z,
    (pole ? `<path d="M${f(x)} ${f(y)}V${f(top - 3)}" stroke="${mix(C.woodD, C.woodL, L * 0.7)}" stroke-width="1.5" stroke-linecap="round"/><circle cx="${f(x)}" cy="${f(top - 3.5)}" r="1.2" fill="${C.gold}" fill-opacity=".8"/>` : "") +
    `<path d="M${f(x)} ${f(top)}h${f(w + 1)}" stroke="#1a1411" stroke-width="1"/>` +
    `<g transform="translate(${f(x + 0.8)} ${f(top + 0.4)})"><g class="cs-banner" style="--dl:${f(-((x * 7) % 40) / 10)}s"><path d="${cl}" fill="${cloth}"/>${sig}</g></g>`);
}

/* ================= SHELTER ================= */

// A lean-to of poles and hide, open to the right, with a bedroll under it.
function leanTo(S, x, y, { z = y - 4, flip = false, sc = 1.22 } = {}) {
  const L = S.lit(x + 40, y - 16);
  const dark = "#0a080c";
  const hide = S.lin([[0, mix("#241a18", "#8a5a3c", L * 0.85)], [0.75, mix("#1a1414", "#4a3226", L * 0.6)], [1, "#120e12"]], { x1: 1, y1: 0, x2: 0, y2: 1 });
  const sx = flip ? -1 : 1;
  let s = `<g transform="translate(${f(x)} ${f(y)}) scale(${f2(sx * sc)} ${f2(sc)})">` +
    `<path d="M-2 0L50-37L54 0Z" fill="${dark}"/>` +
    // bedroll and a bundle, lit from the open side
    `<path d="M16 0C16-3.6 18-5.6 22-5.8H40C44-5.8 46.5-3.6 46.5 0Z" fill="${mix("#1e1515", "#6a4232", L * 0.8)}"/>` +
    `<path d="M20-5.2C21-3 21-1.6 20.4 0M27-5.8C28-3.4 28-1.6 27.4 0M34-5.8C35-3.4 35-1.6 34.4 0" stroke="#0e0a0a" stroke-opacity=".6" stroke-width=".6" fill="none"/>` +
    `<path d="M22-5.8H40C43-5.8 45-4.4 46-2.6" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.5)}" stroke-width=".6" fill="none"/>` +
    `<ellipse cx="44" cy="-2.6" rx="3.6" ry="2.6" fill="${mix("#221818", "#8a5a3c", L * 0.8)}"/>` +
    // back poles
    `<path d="M40-33L42.5 1" stroke="#15100d" stroke-width="2"/>` +
    // the roof: a slab of hide over branches
    `<path d="M-4 1.2L49.5-38.5L55-35.2L0 3Z" fill="${hide}"/>` +
    `<path d="M3-2.2L50.5-36.4M7-3.6L52.2-35.2M11-4.2L53.6-33.6" stroke="#0e0a0c" stroke-opacity=".55" stroke-width=".7"/>` +
    // lit underside edge facing the fire
    `<path d="M0 3L55-35.2" stroke="${C.woodR}" stroke-opacity="${f2(0.2 + L * 0.6)}" stroke-width="1.1"/>` +
    // moonlit top edge
    `<path d="M-4 1.2L49.5-38.5" stroke="${C.rim}" stroke-opacity=".55" stroke-width=".8"/>` +
    // twigs past the ridge
    `<path d="M49.5-38.5l3.5-5M51.5-37.6l5.2-3.2M47.8-37.5l-.6-5.4" stroke="#1d1512" stroke-width=".9" stroke-linecap="round"/>` +
    // the front pole, forked
    `<path d="M49 0.6L50.4-38.8M50.4-38.8l-2.6-4.2M50.4-38.8l2.8-3.6" stroke="${mix(C.woodD, C.woodL, L)}" stroke-width="2.2" stroke-linecap="round" fill="none"/>` +
    `<path d="M50.6 0.4L51.8-37" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.7)}" stroke-width=".7"/>` +
    `</g>`;
  S.add("camp", z, s);
  shadow(S, x + 10 * sc, x + 56 * sc, 38 * sc, y);
}

// A ridge tent seen three-quarters on: door to the viewer, side running back to the right.
function tent(S, x, y, { w = 70, h = 52, depth = 34, z = y - 2, door = true, glow = true, patch = true } = {}) {
  const ax = x + w / 2;
  const ay = y - h;
  const dx = depth;
  const dy = -depth * 0.2;
  const L = S.lit(x + w * 0.3, y - h * 0.4);
  const Lr = S.lit(x + w + dx * 0.5, y - h * 0.4);
  const front = S.lin([[0, mix("#241c1e", C.clothL, L * 0.95)], [0.55, mix("#1c1619", "#5d4636", L * 0.8)], [1, mix("#141014", "#3b2d27", L * 0.6)]], { x1: 0, y1: 0, x2: 1, y2: 0.3 });
  const side = S.lin([[0, mix("#16121a", "#3a2c28", Lr * 0.6)], [1, "#0f0c12"]], { x1: 0, y1: 0, x2: 1, y2: 0.2 });
  let s = "";
  // side (back) face
  s += `<path d="${P([[ax, ay], [ax + dx, ay + dy], [x + w + dx, y + dy], [x + w, y]])}" fill="${side}"/>`;
  s += `<path d="M${f(ax + dx * 0.33)} ${f(ay + dy * 0.33)}L${f(x + w + dx * 0.33)} ${f(y + dy * 0.33)}M${f(ax + dx * 0.66)} ${f(ay + dy * 0.66)}L${f(x + w + dx * 0.66)} ${f(y + dy * 0.66)}" stroke="#08060a" stroke-opacity=".5" stroke-width=".7"/>`;
  if (patch) s += `<path d="${P([[x + w + dx * 0.45 - 8, y + dy * 0.45 - 16], [x + w + dx * 0.45 + 1, y + dy * 0.45 - 17.8], [x + w + dx * 0.45 + 4, y + dy * 0.45 - 9], [x + w + dx * 0.45 - 5, y + dy * 0.45 - 7.4]])}" fill="#1f1820" stroke="#0a080c" stroke-width=".5" stroke-dasharray="1 1"/>`;
  // front face
  s += `<path d="${P([[x, y], [ax, ay], [x + w, y]])}" fill="${front}"/>`;
  // seams
  s += `<path d="M${f(ax)} ${f(ay)}L${f(x + w * 0.22)} ${f(y)}M${f(ax)} ${f(ay)}L${f(x + w * 0.78)} ${f(y)}" stroke="#0c090c" stroke-opacity=".35" stroke-width=".6"/>`;
  if (door) {
    const dw = w * 0.14;
    const dh = h * 0.6;
    const inner = glow ? S.radBox([[0, "#ffc875", 0.95], [0.45, "#d8743f", 0.75], [1, "#2a1410", 1]], { cx: 0.5, cy: 1, r: 0.9 }) : "#060407";
    s += `<path d="${P([[ax - dw, y], [ax, y - dh], [ax + dw, y]])}" fill="${inner}"/>`;
    // the flap, turned back
    s += `<path d="${P([[ax - dw, y], [ax, y - dh], [ax - dw - 9, y - 3.5]])}" fill="${mix("#2e2322", "#b08058", L * 0.8)}"/>`;
    s += `<path d="M${f(ax)} ${f(y - dh)}L${f(ax - dw - 9)} ${f(y - 3.5)}" stroke="#0e0a0c" stroke-opacity=".5" stroke-width=".6"/>`;
    if (glow) {
      groundGlow(S, ax - 4, 26, 0.3, y + 3);
      S.light(ax, y - 4, 34, 0.25);
      S.add("fx", 15, `<ellipse cx="${f(ax)}" cy="${f(y - 2)}" rx="16" ry="9" fill="${S.rad([[0, "#ffb05c", 0.3], [1, "#ffb05c", 0]], ax, y - 2, 16, 9 / 16)}"/>`);
    }
  }
  // rims: warm on the edge that faces the fire, cool along the ridge
  s += `<path d="M${f(x)} ${f(y)}L${f(ax)} ${f(ay)}" stroke="${C.clothR}" stroke-opacity="${f2(0.15 + L * 0.75)}" stroke-width="1.1"/>`;
  s += `<path d="M${f(ax)} ${f(ay)}L${f(ax + dx)} ${f(ay + dy)}" stroke="${C.rim}" stroke-opacity=".7" stroke-width=".9"/>`;
  // ridge pole ends and guy ropes
  s += `<path d="M${f(ax + 1)} ${f(ay + 0.5)}l-2.4-6M${f(ax + dx)} ${f(ay + dy)}l1.4-5" stroke="#1d1512" stroke-width="1.3" stroke-linecap="round"/>`;
  s += `<path d="M${f(ax - 1)} ${f(ay + 3)}L${f(x - 16)} ${f(y + 1)}M${f(ax + dx)} ${f(ay + dy + 2)}L${f(x + w + dx + 16)} ${f(y + dy + 1)}" stroke="#3a2c26" stroke-opacity=".7" stroke-width=".5"/>`;
  s += `<path d="M${f(x - 16)} ${f(y + 1)}v-2.4M${f(x + w + dx + 16)} ${f(y + dy + 1)}v-2.4" stroke="#2a201b" stroke-width="1"/>`;
  S.add("camp", z, s);
  shadow(S, x, x + w + dx, h, y);
}

/* ================= STORES ================= */

function crate(S, x, y, { w = 16, h = 13, d = 6, z = y } = {}) {
  const L = S.lit(x + w / 2, y - h / 2);
  const fc = mix("#1d1613", "#7a5236", L * 0.9);
  const tc = mix("#241b17", "#946443", L * 0.95);
  const sc = mix("#130f0e", "#4a3222", L * 0.6);
  const e = "#0c0908";
  S.add("camp", z,
    `<path d="${P([[x + w, y], [x + w + d, y - d * 0.55], [x + w + d, y - h - d * 0.55], [x + w, y - h]])}" fill="${sc}"/>` +
    `<path d="${P([[x, y - h], [x + d, y - h - d * 0.55], [x + w + d, y - h - d * 0.55], [x + w, y - h]])}" fill="${tc}"/>` +
    `<rect x="${f(x)}" y="${f(y - h)}" width="${f(w)}" height="${f(h)}" fill="${fc}"/>` +
    `<path d="M${f(x)} ${f(y - h / 2)}H${f(x + w)}M${f(x + 1.2)} ${f(y - 1.2)}L${f(x + w - 1.2)} ${f(y - h + 1.2)}" stroke="${e}" stroke-opacity=".75" stroke-width=".7"/>` +
    `<rect x="${f(x + 0.4)}" y="${f(y - h + 0.4)}" width="${f(w - 0.8)}" height="${f(h - 0.8)}" fill="none" stroke="${e}" stroke-opacity=".8" stroke-width=".8"/>` +
    `<path d="M${f(x)} ${f(y - h)}H${f(x + w)}" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.55)}" stroke-width=".6"/>`);
}

function barrel(S, x, y, { w = 11, h = 15, z = y } = {}) {
  const L = S.lit(x + w / 2, y - h / 2);
  const side = S.lin([[0, mix("#1a1411", "#8a5a38", L * 0.95)], [0.4, mix("#1a1411", "#6a4429", L * 0.7)], [1, "#0d0a09"]], { x1: 0, y1: 0, x2: 1, y2: 0 });
  const b = w * 0.1;
  S.add("camp", z,
    `<path d="M${f(x + b)} ${f(y)}C${f(x - b)} ${f(y - h * 0.35)} ${f(x - b)} ${f(y - h * 0.65)} ${f(x + b)} ${f(y - h)}H${f(x + w - b)}C${f(x + w + b)} ${f(y - h * 0.65)} ${f(x + w + b)} ${f(y - h * 0.35)} ${f(x + w - b)} ${f(y)}Z" fill="${side}"/>` +
    `<path d="M${f(x)} ${f(y - h * 0.26)}H${f(x + w)}M${f(x - 0.4)} ${f(y - h * 0.74)}H${f(x + w + 0.4)}" stroke="#0a0807" stroke-width="1.1"/>` +
    `<ellipse cx="${f(x + w / 2)}" cy="${f(y - h)}" rx="${f(w / 2 - b)}" ry="${f(1.3)}" fill="${mix("#1a1411", "#5a3a26", L)}"/>` +
    `<path d="M${f(x + w * 0.22)} ${f(y - h + 1.5)}V${f(y - 1.5)}" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.35)}" stroke-width=".9"/>`);
}

function sack(S, x, y, { w = 10, h = 9, z = y } = {}) {
  const L = S.lit(x + w / 2, y - h / 2);
  S.add("camp", z,
    `<path d="M${f(x)} ${f(y)}C${f(x - 1.5)} ${f(y - h * 0.6)} ${f(x + w * 0.2)} ${f(y - h)} ${f(x + w * 0.45)} ${f(y - h)}L${f(x + w * 0.4)} ${f(y - h - 2.2)}H${f(x + w * 0.62)}L${f(x + w * 0.58)} ${f(y - h)}C${f(x + w * 0.85)} ${f(y - h)} ${f(x + w + 1.5)} ${f(y - h * 0.6)} ${f(x + w)} ${f(y)}Z" fill="${mix("#1d1817", "#8a6a4a", L * 0.85)}"/>` +
    `<path d="M${f(x + w * 0.4)} ${f(y - h + 0.3)}H${f(x + w * 0.62)}" stroke="#0e0a09" stroke-width=".8"/>`);
}

// A heap of lumps (ore, coal, rubble) with glints.
function heap(S, x, y, { w = 40, h = 14, z = y, col = "#141117", lit = "#4a3a38", glint = null, seed = "heap", n = 22 } = {}) {
  const r = S.rnd(seed);
  const L = S.lit(x + w / 2, y - h / 2);
  let s = `<path d="M${f(x)} ${f(y)}C${f(x + w * 0.2)} ${f(y - h * 0.7)} ${f(x + w * 0.38)} ${f(y - h)} ${f(x + w * 0.52)} ${f(y - h)}C${f(x + w * 0.68)} ${f(y - h)} ${f(x + w * 0.82)} ${f(y - h * 0.6)} ${f(x + w)} ${f(y)}Z" fill="${mix(col, lit, L * 0.5)}"/>`;
  for (let i = 0; i < n; i++) {
    const t = r();
    const px = x + w * (0.08 + t * 0.84);
    const top = y - h * Math.sin(Math.PI * (0.08 + t * 0.84)) * 0.95;
    const py = top + r() * (y - top) * 0.9;
    const rr = 1 + r() * 2.2;
    s += `<path d="M${f(px - rr)} ${f(py)}L${f(px - rr * 0.4)} ${f(py - rr * 0.9)}L${f(px + rr * 0.7)} ${f(py - rr * 0.7)}L${f(px + rr)} ${f(py + 0.2)}Z" fill="${mix(col, lit, L * (0.4 + r() * 0.6))}"/>`;
    if (glint && r() < 0.35) s += `<circle cx="${f(px)}" cy="${f(py - rr * 0.5)}" r=".45" fill="${glint}" fill-opacity="${f2(0.5 + r() * 0.5)}"/>`;
  }
  S.add("camp", z, s);
}

/* ================= SHADOWS ================= */

// A soft shadow on the ground, thrown away from the fire.
function shadow(S, x0, x1, h, y = GY) {
  if (S.fireX == null) return;
  const cx = (x0 + x1) / 2;
  const L = S.lit(cx, y - 6);
  if (L < 0.05) return;
  const away = cx < S.fireX ? -1 : 1;
  const len = Math.min(90, h * (0.6 + Math.abs(cx - S.fireX) / 160));
  const a = away > 0 ? x0 + 4 : x1 - 4;
  const b = away > 0 ? x1 + len : x0 - len;
  const g = S.lin([[0, "#030205", 0.55 * L + 0.1], [1, "#030205", 0]], { x1: away > 0 ? a : a, y1: 0, x2: b, y2: 0, user: true });
  S.add("ground", 4, `<path d="M${f(a)} ${f(y + 0.5)}L${f(b)} ${f(y + 2.2)}L${f(b)} ${f(y + 3.6)}L${f(a)} ${f(y + 3)}Z" fill="${g}"/>`);
}

// A warm pool on the ground under a lamp, a torch or an open door.
function groundGlow(S, x, rx = 30, k = 0.35, y = GY + 4) {
  const ry = Math.max(3, rx * 0.16);
  S.add("ground", 1.6, `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${S.rad([[0, "#ffb866", k], [0.5, "#e08a44", k * 0.4], [1, "#d8743f", 0]], x, y, rx, ry / rx)}"/>`);
}

/* ================= THE WALL AND THE TOWER ================= */

// A palisade of sharpened stakes along the back of the camp, with a gate.
function palisade(S, x0, x1, y, { h = 34, gate = null, z = y - 30, decor = null, step = 6.2, style = "stakes" } = {}) {
  if (style === "wattle") return wattle(S, x0, x1, y, { h: h - 6, gate, z, decor });
  const r = S.rnd("pal");
  const nz = noise1(r, 30);
  const buckets = new Map();
  const rims = [];
  let x = x0;
  const gl = gate ? gate - 13 : null;
  const gr = gate ? gate + 13 : null;
  while (x < x1) {
    const w = step * (0.85 + r() * 0.3);
    if (gate && x + w > gl && x < gr) { x = gr; continue; }
    const top = y - h - nz(x) * 4 - r() * 3;
    const L = S.lit(x + w / 2, y - h * 0.6);
    const k = Math.round(L * 6);
    const d = `M${f(x)} ${f(y)}V${f(top + 4)}L${f(x + w / 2)} ${f(top - 2)}L${f(x + w - 0.6)} ${f(top + 4)}V${f(y)}Z`;
    buckets.set(k, (buckets.get(k) || "") + d);
    const toward = x + w / 2 < S.fireX ? 1 : -1;
    const ex = toward > 0 ? x + w - 0.8 : x + 0.4;
    if (L > 0.08) rims.push(`<path d="M${f(ex)} ${f(y - 2)}V${f(top + 4)}" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.55)}" stroke-width=".7"/>`);
    rims.push(`<path d="M${f(x + 0.4)} ${f(top + 4)}L${f(x + w / 2)} ${f(top - 2)}" stroke="${C.rim}" stroke-opacity=".45" stroke-width=".6"/>`);
    x += w;
  }
  let s = "";
  for (const [k, d] of buckets) s += `<path d="${d}" fill="${mix("#120e15", "#5a3a28", k / 6 * 0.75)}" stroke="#070508" stroke-width=".6"/>`;
  // two bands of rope binding the stakes
  s += `<path d="M${f(x0)} ${f(y - h * 0.3)}H${f(gate ? gl : x1)}${gate ? `M${f(gr)} ${f(y - h * 0.3)}H${f(x1)}` : ""}M${f(x0)} ${f(y - h * 0.72)}H${f(gate ? gl : x1)}${gate ? `M${f(gr)} ${f(y - h * 0.72)}H${f(x1)}` : ""}" stroke="#221914" stroke-width="1.3"/>`;
  s += rims.join("");
  if (gate) {
    const L = S.lit(gate, y - h);
    const post = mix(C.woodD, C.woodL, L * 0.9);
    s += `<path d="M${f(gl)} ${f(y)}V${f(y - h - 12)}M${f(gr)} ${f(y)}V${f(y - h - 12)}" stroke="${post}" stroke-width="3.4"/>` +
      `<path d="M${f(gl - 4)} ${f(y - h - 9)}H${f(gr + 4)}" stroke="${post}" stroke-width="3"/>` +
      `<path d="M${f(gl - 4)} ${f(y - h - 10.4)}H${f(gr + 4)}" stroke="${C.rim}" stroke-opacity=".5" stroke-width=".6"/>` +
      // torches on the gate posts
      ``;
    groundGlow(S, gate, 34, 0.22, y + 4);
    for (const tx of [gl, gr]) {
      smallFlame(S, tx, y - h - 13.5, 0.3, "back", z + 0.2);
      S.light(tx, y - h - 16, 60, 0.3);
      S.add("fx", 19, `<circle class="cs-lamp" cx="${f(tx)}" cy="${f(y - h - 17)}" r="14" fill="${S.rad([[0, "#ffb05c", 0.35], [1, "#ffb05c", 0]], tx, y - h - 17, 14)}"/>`);
    }
    s +=
      // the gate stands open: two leaves turned in
      `<path d="${P([[gl + 1.5, y], [gl + 1.5, y - h + 2], [gl + 7, y - h + 4], [gl + 7, y - 1]])}" fill="${mix("#120e15", "#4a3222", L * 0.6)}"/>` +
      `<path d="${P([[gr - 1.5, y], [gr - 1.5, y - h + 2], [gr - 7, y - h + 4], [gr - 7, y - 1]])}" fill="${mix("#0e0b11", "#3a281c", L * 0.5)}"/>`;
  }
  if (decor) s += decor;
  S.add("back", z, s);
}

// A woven wattle fence: stout posts and withies woven between them.
function wattle(S, x0, x1, y, { h = 26, gate = null, z = 40, decor = null } = {}) {
  const gl = gate ? gate - 13 : null;
  const gr = gate ? gate + 13 : null;
  const spans = gate ? [[x0, gl], [gr, x1]] : [[x0, x1]];
  let posts = "";
  let weave = "";
  let rims = "";
  const gap = 16;
  for (const [a, b] of spans) {
    for (let x = a; x <= b; x += gap) posts += `M${f(x)} ${f(y + 1)}V${f(y - h - 3)}`;
    for (let k = 0; k < 7; k++) {
      const yy = y - 3 - k * (h / 7);
      let d = `M${f(a)} ${f(yy)}`;
      for (let x = a; x < b; x += gap) d += `Q${f(x + gap / 2)} ${f(yy + (k % 2 ? 1.6 : -1.6))} ${f(Math.min(b, x + gap))} ${f(yy)}`;
      weave += d;
      const L = S.lit((a + b) / 2, yy);
      if (L > 0.1) rims += `<path d="${d}" fill="none" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.25)}" stroke-width=".5" transform="translate(0 -.7)"/>`;
    }
  }
  let s = `<path d="${weave}" fill="none" stroke="#1d1613" stroke-width="3.2"/><path d="${weave}" fill="none" stroke="#0b0807" stroke-opacity=".7" stroke-width=".6" transform="translate(0 1.3)"/>` + rims +
    `<path d="${posts}" stroke="#1a1310" stroke-width="2.6" stroke-linecap="round"/>`;
  s += `<path d="M${f(x0)} ${f(y - h - 1)}H${f(gate ? gl : x1)}${gate ? `M${f(gr)} ${f(y - h - 1)}H${f(x1)}` : ""}" stroke="${C.rim}" stroke-opacity=".35" stroke-width=".6"/>`;
  if (gate) {
    const L = S.lit(gate, y - h);
    const post = mix(C.woodD, C.woodL, L * 0.9);
    s += `<path d="M${f(gl)} ${f(y)}V${f(y - h - 14)}M${f(gr)} ${f(y)}V${f(y - h - 14)}" stroke="${post}" stroke-width="3.4"/><path d="M${f(gl - 4)} ${f(y - h - 11)}H${f(gr + 4)}" stroke="${post}" stroke-width="3"/>`;
    for (const tx of [gl, gr]) {
      smallFlame(S, tx, y - h - 15.5, 0.3, "back", z + 0.2);
      S.light(tx, y - h - 18, 60, 0.3);
      S.add("fx", 19, `<circle class="cs-lamp" cx="${f(tx)}" cy="${f(y - h - 19)}" r="14" fill="${S.rad([[0, "#ffb05c", 0.35], [1, "#ffb05c", 0]], tx, y - h - 19, 14)}"/>`);
    }
  }
  if (decor) s += decor;
  S.add("back", z, s);
}

// A timber watchtower on four legs, with a lit window.
function watchtower(S, x, y, { h = 96, z = y, flag = false, lamp = true } = {}) {
  const L = S.lit(x, y - 30);
  const wood = mix("#15100f", "#5a3c29", L * 0.8);
  const woodDk = mix("#0f0b0b", "#3a281c", L * 0.6);
  const ph = y - h; // platform line
  const lw = 17;
  const tw = 11;
  let s = "";
  // legs and braces
  s += `<path d="M${f(x - lw)} ${f(y)}L${f(x - tw)} ${f(ph)}M${f(x + lw)} ${f(y)}L${f(x + tw)} ${f(ph)}" stroke="${wood}" stroke-width="3" stroke-linecap="round"/>`;
  s += `<path d="M${f(x - lw + 1.5)} ${f(y - 6)}L${f(x + tw + 0.5)} ${f(ph + 34)}M${f(x + lw - 1.5)} ${f(y - 6)}L${f(x - tw - 0.5)} ${f(ph + 34)}M${f(x - lw + 3.5)} ${f(ph + 30)}L${f(x + tw)} ${f(ph + 3)}M${f(x + lw - 3.5)} ${f(ph + 30)}L${f(x - tw)} ${f(ph + 3)}M${f(x - lw + 2)} ${f(ph + 32)}H${f(x + lw - 2)}" stroke="${woodDk}" stroke-width="1.5"/>`;
  // ladder
  s += `<path d="M${f(x + 3)} ${f(y)}L${f(x + 4)} ${f(ph)}M${f(x + 8)} ${f(y)}L${f(x + 8.5)} ${f(ph)}" stroke="${woodDk}" stroke-width=".8"/>`;
  for (let yy = y - 5; yy > ph + 2; yy -= 5.5) s += `<path d="M${f(x + 3.3)} ${f(yy)}H${f(x + 8.2)}" stroke="${woodDk}" stroke-width=".7"/>`;
  // the hut on top
  const hx0 = x - 17;
  const hx1 = x + 17;
  const hy = ph - 18;
  s += `<path d="${P([[hx0 - 3, ph + 2], [hx1 + 3, ph + 2], [hx1 + 3, ph - 1], [hx0 - 3, ph - 1]])}" fill="${woodDk}"/>`;
  s += `<rect x="${f(hx0)}" y="${f(hy)}" width="${f(hx1 - hx0)}" height="${f(ph - hy - 1)}" fill="${S.lin([[0, mix("#1a1414", "#5e3f2a", L * 0.8)], [1, "#0f0b0d"]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`;
  for (let xx = hx0 + 4; xx < hx1; xx += 4) s += `<path d="M${f(xx)} ${f(hy + 1)}V${f(ph - 1)}" stroke="#0a0709" stroke-opacity=".6" stroke-width=".6"/>`;
  // window with a lamp in it
  if (lamp) {
    s += `<rect x="${f(x - 5)}" y="${f(hy + 4)}" width="10" height="7" fill="${S.radBox([[0, "#ffd48a"], [0.6, "#f09a48"], [1, "#9a4a26"]])}"/>` +
      `<path d="M${f(x)} ${f(hy + 4)}V${f(hy + 11)}" stroke="#1a1210" stroke-width=".9"/>`;
    S.add("fx", 21, `<circle class="cs-lamp" cx="${f(x)}" cy="${f(hy + 7.5)}" r="20" fill="${S.rad([[0, "#ffb866", 0.35], [1, "#ffb866", 0]], x, hy + 7.5, 20)}"/>`);
    S.light(x, hy + 8, 60, 0.3);
  }
  // roof
  const rp = hy - 16;
  s += `<path d="${P([[hx0 - 6, hy + 1], [x, rp], [hx1 + 6, hy + 1]])}" fill="${S.lin([[0, "#1b1519"], [1, "#0c090d"]], { x1: 0, y1: 0, x2: 1, y2: 1 })}"/>`;
  s += `<path d="M${f(hx0 - 6)} ${f(hy + 1)}L${f(x)} ${f(rp)}L${f(hx1 + 6)} ${f(hy + 1)}" fill="none" stroke="${C.rim}" stroke-opacity=".6" stroke-width=".8"/>`;
  s += `<path d="M${f(hx0 - 6)} ${f(hy + 1)}L${f(x)} ${f(rp)}" stroke="#2a2030" stroke-width="1.5" stroke-opacity=".6"/>`;
  S.add("back", z, s);
  if (flag) banner(S, x, rp, { h: 18, w: 9, len: 14, layer: "back", z: z + 0.1 });
}

/* ================= THE CREW ================= */

// One cloaked worker. Poses: swing (the pick), chop (the axe), flay, reap, pole, push, carry, saw, stand.
// Both boots point the way the worker faces: heel under the back of each leg, toe ahead of it.
const LEGS = "M-4.2 0L-3.1-9.4L2.8-9.4L4.2 0H2.3L.3-5.6-1.7 0ZM-4.6 0H-.8L-1.2-1.7H-4.3ZM1.9 0h3.9l-.4-1.7H2.2Z";
// The hips, drawn between the legs and the cloak (see figurePass).
const SEAT = "M-5.3-10.6C-5.3-12.9-2.9-13.7 0-13.7C2.6-13.7 4.2-12.7 4-10.3C3.8-8.8 2.8-8.3 0-8.3C-3.1-8.3-5.3-8.7-5.3-10.6Z";
const CLOAK = "M-3.6-21.4C-5.8-18-7.4-13.6-8-8.2L-5.8-9.2-4-7.8-1.8-9.4.4-8 2.6-9.4 4.6-8 5.8-8.8C5.2-13.4 4.6-17.6 3.4-21.4Z";
const HOOD = "M2.2-20.8C3.4-21.3 3.9-22.3 3.5-23.3C4.1-24.2 4.4-25.3 4.1-26.4C3.7-27.9 2.4-29 .6-29.3C-1.2-29.6-2.8-29.1-4-28.2C-5-27.5-6.2-27.3-7.4-27.6C-6.2-26.6-5.4-25.4-5.1-24C-4.9-22.8-4.5-21.7-3.7-21Z";

function tool(kind) {
  switch (kind) {
    case "pick":
      return { handle: "M4.5 0H19", head: "M17.2-6Q21.9-1 17.6 6.2L18.8 6.4Q23.6-1 18.5-6.4Z" };
    case "axe":
      return { handle: "M4.5 0H18", head: "M15.4-.8L16.2-5.6Q20.6-5 21.4-.6Q20.8 3.2 16.2 3.6L15.4-.2Z" };
    case "sickle":
      return { handle: "M4 0H9", head: "M8.6-1.2C11-5.8 17-6.6 19.8-2.8C16.6-4.4 12.4-3.8 9.8.4Z" };
    case "knife":
      return { handle: "M4.5 0H8", head: "M7.6-1.1L14.6-.6Q15.4 0 14.4.5L7.6 1Z" };
    case "hammer":
      return { handle: "M4.5 0H15", head: "M13.6-3.4H17.6V3.4H13.6Z" };
    default:
      return null;
  }
}

function figureParts(o) {
  const t = tool(o.tool);
  const arm = `<path d="M0 0L7.2 .4" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`;
  const tl = t ? `<path d="${t.handle}" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="${t.head}" fill="currentColor"/>` : "";
  return { arm, tl };
}

// Builds the figure in one colour. The rim light is a filter over it (rimFilter).
function figurePass(o, col) {
  const { arm, tl } = figureParts(o);
  const pose = o.pose;
  let body = "";
  const lean = { swing: 8, chop: 10, flay: 12, reap: 34, pole: 12, push: 26, carry: 4, saw: 14, stand: 0, sit: 0 }[pose] ?? 0;
  const armAnim = { swing: "cs-swing", chop: `cs-chop${o.chop}`, flay: `cs-flay${o.flay}`, reap: "cs-reap", pole: "cs-pole", saw: "cs-saw" }[pose];
  const bodyAnim = { swing: "cs-lean", chop: `cs-chopb${o.chop}`, flay: `cs-flayb${o.flay}`, reap: "cs-bob", pole: "cs-bob", push: "cs-bob", saw: "cs-bob" }[pose] || "";
  const sty = `style="--t:${f(o.t || 2.8)}s;--dl:${f(o.dl || 0)}s"`;
  if (pose === "sit") {
    body = `<path d="M-5 0L-4.2-4.6L4.6-4.6L6.8-.2L4.9 0L3.4-2.6L-2.4-2.6L-3 0Z"/>` +
      `<g transform="translate(-1 -3)"><path d="M-3.4-12.2C-5-9.6-6.2-6-6.4-1.6L4.6-1.6C4.4-5.6 3.6-9.8 2.8-12.4Z"/><path d="M-3.4-12.4C-4.4-14.6-3.8-18.4-.6-19.2C2-19.6 3.6-17.8 3.5-15.4C3.4-13.8 2.6-12.8 1.2-12.4ZM-3.1-17L-6.2-15-3.3-13.9Z"/>` +
      `<path d="M1.6-10.4L7.6-6.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></g>`;
    return `<g fill="${col}" color="${col}">${body}</g>`;
  }
  const armsAt = pose === "carry" ? "translate(.6 -19.8)" : "translate(.6 -19.6)";
  let armsInner = arm + tl;
  if (pose === "push") armsInner = `<path d="M0 0L8 3.6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`;
  if (pose === "carry") armsInner = `<path d="M0 0L3 5.2" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="-1" cy="-3.6" rx="6.4" ry="3.6" transform="rotate(-12)"/>`;
  if (pose === "pole") armsInner = `<path d="M0 0L6.6 3.2" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M-10-14L40 28" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`;
  if (pose === "saw") armsInner = `<path d="M0 0L7 3.4" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M6 3.6L26 7.2" stroke="currentColor" stroke-width=".9"/><path d="M5.6 2.2V5.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`;
  const armRot = { swing: 0, chop: 0, flay: 0, reap: 40, pole: 0, push: 0, carry: 0, saw: 0 }[pose] ?? 0;
  // The seat: bent over, the cloak swings up off the back of the legs, so the hips go with it
  // half way and fill the join. Upright it sits inside the cloak and shows nothing.
  const seat = lean >= 6 ? `<g transform="translate(0 -10) rotate(${f(lean * 0.5)}) translate(0 10)"><path d="${SEAT}"/></g>` : "";
  body = `<path d="${LEGS}"/>${seat}` +
    `<g transform="translate(0 -10) rotate(${lean}) translate(0 10)"><g class="${bodyAnim}" ${sty}>` +
    `<path d="${CLOAK}"/><path d="${HOOD}"/>` +
    `<g transform="${armsAt} rotate(${armRot})"><g class="${armAnim || ""}" ${sty}>${armsInner}</g></g>` +
    `</g></g>`;
  return `<g fill="${col}" color="${col}">${body}</g>`;
}

/* The rim light sits INSIDE the silhouette, on the edges that face a light.
   Two offset copies drawn behind the body used to do it, which put a lit
   outline beside the figure rather than on it: the worker looked shifted off
   its own body, most of all at the boots. A filter does it now: the figure's
   own shape, less that shape nudged away from the light, is the edge that
   light catches. The nudge is in the figure's own units, so a worker turned
   round (dir -1) is still lit from the fire's side. */
function rimFilter(S, toFire, dir, L) {
  const id = S.uid("k");
  const fx = toFire * dir; // the fire's side, in the figure's own x
  const warm = `rgb(255,${Math.round(150 + L * 40)},${Math.round(80 + L * 30)})`;
  S.def(`<filter id="${id}" x="-.2" y="-.2" width="1.4" height="1.4" color-interpolation-filters="sRGB">` +
    `<feOffset in="SourceAlpha" dx="${f2(-fx * 0.62)}" dy=".08" result="w0"/><feComposite in="SourceAlpha" in2="w0" operator="out" result="w1"/>` +
    `<feFlood flood-color="${warm}" flood-opacity="${f2(0.3 + L * 0.7)}"/><feComposite in2="w1" operator="in" result="w"/>` +
    `<feOffset in="SourceAlpha" dx="${f2(fx * 0.4)}" dy=".48" result="m0"/><feComposite in="SourceAlpha" in2="m0" operator="out" result="m1"/>` +
    `<feFlood flood-color="rgb(150,128,212)" flood-opacity=".6"/><feComposite in2="m1" operator="in" result="m"/>` +
    `<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="m"/><feMergeNode in="w"/></feMerge></filter>`);
  return `url(#${id})`;
}

// Draws a worker at (x, y) facing `dir` (1 right, -1 left), scaled by s, rim-lit by the fire and the moon.
function worker(S, x, y, { pose = "swing", tool: tk = "pick", dir = 1, s = 1.28, z = y + 0.5, t = 2.8, dl = 0, layer = "camp", chop = "", flay = "" } = {}) {
  const o = { pose, tool: tk, t, dl, chop, flay };
  const L = S.lit(x, y - 14);
  const toFire = S.fireX == null ? -1 : (S.fireX < x ? -1 : 1);
  S.add(layer, z,
    `<g transform="translate(${f(x)} ${f(y)}) scale(${f2(s * dir)} ${f2(s)})" filter="${rimFilter(S, toFire, dir, L)}">${figurePass(o, "#0a080d")}</g>`);
  shadow(S, x - 5 * s, x + 5 * s, 26 * s, y);
}

/* ================= CARTS ================= */

// A two-wheeled handcart with a load. dir 1 = handles to the left.
function cart(S, x, y, { w = 40, load = "ore", z = y, wheelR = 7, dir = 1, rails = false } = {}) {
  const L = S.lit(x + w / 2, y - 12);
  const wood = mix("#1a1412", "#7a5236", L * 0.9);
  const dark = mix("#100c0b", "#3a2a1e", L * 0.6);
  const bedY = y - wheelR - 3;
  let s = "";
  // the load
  const r = S.rnd(`cart${Math.round(x)}`);
  if (load === "ore" || load === "coal") {
    const base = load === "coal" ? "#0e0c10" : "#231c22";
    for (let i = 0; i < 14; i++) {
      const px = x + 3 + r() * (w - 6);
      const py = bedY - 9 - Math.sin(((px - x) / w) * Math.PI) * 5 + r() * 4;
      const rr = 2 + r() * 2;
      s += `<path d="M${f(px - rr)} ${f(py + rr * 0.6)}L${f(px - rr * 0.5)} ${f(py - rr * 0.6)}L${f(px + rr * 0.6)} ${f(py - rr * 0.8)}L${f(px + rr)} ${f(py + rr * 0.5)}Z" fill="${mix(base, "#6a4a3e", L * (0.3 + r() * 0.5))}"/>`;
      if (load === "ore" && r() < 0.4) s += `<circle cx="${f(px)}" cy="${f(py - rr * 0.3)}" r=".5" fill="#ffcf8a"/>`;
    }
  } else if (load === "logs") {
    for (let i = 0; i < 3; i++) {
      const ly = bedY - 5 - i * 4.6 + (i === 2 ? 0 : 0);
      const lx0 = x - 6 + i * 3;
      s += `<rect x="${f(lx0)}" y="${f(ly - 4.4)}" width="${f(w + 10 - i * 6)}" height="4.6" rx="2.3" fill="${mix("#1e1612", "#6a4630", L * (0.6 + i * 0.1))}"/><ellipse cx="${f(lx0 + 1)}" cy="${f(ly - 2.1)}" rx="1.6" ry="2.3" fill="${mix("#2a1e16", "#c08050", L)}"/>`;
    }
  } else if (load === "hides") {
    s += `<path d="M${f(x + 1)} ${f(bedY - 1)}C${f(x + 4)} ${f(bedY - 14)} ${f(x + w - 6)} ${f(bedY - 15)} ${f(x + w - 1)} ${f(bedY - 1)}Z" fill="${mix("#2a1a16", "#8a5a40", L * 0.8)}"/>` +
      `<path d="M${f(x + 6)} ${f(bedY - 6)}C${f(x + 14)} ${f(bedY - 10)} ${f(x + 24)} ${f(bedY - 9)} ${f(x + w - 6)} ${f(bedY - 5)}M${f(x + 9)} ${f(bedY - 10)}C${f(x + 17)} ${f(bedY - 13)} ${f(x + 26)} ${f(bedY - 12)} ${f(x + w - 10)} ${f(bedY - 9)}" stroke="#140c0a" stroke-opacity=".6" stroke-width=".7" fill="none"/>`;
  } else if (load === "hay") {
    s += `<path d="M${f(x - 2)} ${f(bedY)}C${f(x - 4)} ${f(bedY - 16)} ${f(x + 6)} ${f(bedY - 26)} ${f(x + w / 2)} ${f(bedY - 27)}C${f(x + w - 6)} ${f(bedY - 26)} ${f(x + w + 4)} ${f(bedY - 16)} ${f(x + w + 2)} ${f(bedY)}Z" fill="${S.lin([[0, mix("#2e2a1a", "#a08a52", L)], [1, mix("#1a1810", "#5a4a2a", L * 0.7)]], { x1: 0, y1: 0, x2: 0.4, y2: 1 })}"/>`;
    for (let i = 0; i < 16; i++) {
      const px = x + r() * w;
      const py = bedY - 4 - r() * 20;
      s += `<path d="M${f(px)} ${f(py)}l${f(r() * 4 - 2)} ${f(-2 - r() * 2)}" stroke="${mix("#3a321e", "#d0b070", L * 0.8)}" stroke-width=".5"/>`;
    }
  } else if (load === "sacks") {
    for (let i = 0; i < 4; i++) s += `<ellipse cx="${f(x + 6 + i * 9)}" cy="${f(bedY - 4)}" rx="5" ry="4" fill="${mix("#1d1817", "#8a6a4a", L * (0.6 + (i % 2) * 0.2))}"/>`;
    s += `<ellipse cx="${f(x + 15)}" cy="${f(bedY - 9)}" rx="5" ry="3.8" fill="${mix("#1d1817", "#9a7a56", L * 0.8)}"/>`;
  }
  // bed and sides
  s += `<path d="${P([[x, bedY - 8], [x + w, bedY - 8], [x + w - 2, bedY], [x + 2, bedY]])}" fill="${wood}"/>`;
  s += `<path d="M${f(x + 1)} ${f(bedY - 4)}H${f(x + w - 1)}" stroke="${dark}" stroke-width=".7"/>`;
  s += `<path d="M${f(x)} ${f(bedY - 8)}H${f(x + w)}" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.6)}" stroke-width=".7"/>`;
  // shafts
  const hx = dir > 0 ? x : x + w;
  s += `<path d="M${f(hx)} ${f(bedY - 3)}L${f(hx - dir * 22)} ${f(bedY + 3)}" stroke="${wood}" stroke-width="1.6" stroke-linecap="round"/>`;
  // wheels
  const wheel = (cx) => {
    let sp = "";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      sp += `M${f(cx - Math.cos(a) * wheelR)} ${f(y - wheelR - Math.sin(a) * wheelR)}L${f(cx + Math.cos(a) * wheelR)} ${f(y - wheelR + Math.sin(a) * wheelR)}`;
    }
    return `<circle cx="${f(cx)}" cy="${f(y - wheelR)}" r="${f(wheelR)}" fill="none" stroke="${dark}" stroke-width="1.8"/><path d="${sp}" stroke="${dark}" stroke-width=".7"/><circle cx="${f(cx)}" cy="${f(y - wheelR)}" r="1.2" fill="${wood}"/>` +
      `<path d="M${f(cx - wheelR * 0.7)} ${f(y - wheelR * 1.7)}A${f(wheelR)} ${f(wheelR)} 0 0 1 ${f(cx + wheelR * 0.7)} ${f(y - wheelR * 1.7)}" fill="none" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.5)}" stroke-width=".6"/>`;
  };
  if (rails) s += wheel(x + 8) + wheel(x + w - 8);
  else s += wheel(x + w / 2);
  if (!rails) s += `<path d="M${f(x + w - 3)} ${f(bedY)}L${f(x + w - 1)} ${f(y)}" stroke="${dark}" stroke-width="1.2"/>`;
  S.add("camp", z, s);
  shadow(S, x, x + w, 20, y);
}

/* The shared camp: where the pieces stand and how they grow. */

/* ================= THE SHARED CAMP ================= */

// Where the shared pieces stand. A trade can move any of them.
const HEART = {
  fire: 440,
  leanTo: 328,
  tent: 470,
  tower: 64,
};

// Depth order inside the back layer.
const ZB = { terrain: 0, cut: 12, wall: 40, hall: 60, tower: 62, landmark: 64 };

function heart(S, o = {}) {
  const H = { ...HEART, ...o };
  const fx = H.fire;
  const reach = 190 + S.stage * 9;
  S.light(fx, GY - 8, reach, 1);

  leanTo(S, H.leanTo, GY);
  campProps(S, H);
  campfire(S, fx, GY + 1, { size: S.has(4) ? 1.26 : S.has(2) ? 1.16 : 1.08, sparksN: S.has(4) ? 11 : 8 });

  if (S.has(2)) tent(S, H.tent, GY - 1, { w: 86, h: 64, depth: 34 });

  // stores: crates by the lean-to, barrels by the tent
  if (S.has(3)) {
    const sx = H.stores ?? H.leanTo - 40;
    crate(S, sx, GY + 3, { w: 19, h: 15, d: 7 });
    crate(S, sx + 4, GY - 12, { w: 14, h: 11, d: 6, z: GY + 3.1 });
    barrel(S, sx + 26, GY + 4, { w: 12, h: 16 });
    const bx = H.barrels ?? H.tent + 130;
    barrel(S, bx, GY + 2, { w: 12, h: 17 });
    barrel(S, bx + 13, GY + 3, { w: 11, h: 15 });
    sack(S, bx - 11, GY + 4, { w: 11, h: 9 });
  }

  // a log to sit on by the fire, and a pot on a tripod once there are two crews
  if (S.has(2)) {
    const L = S.lit(fx - 30, GY);
    const lx = fx - 50;
    const ly = GY + 9;
    S.add("camp", ly, `<path d="M${f(lx)} ${f(ly)}V${f(ly - 5.6)}H${f(lx + 26)}V${f(ly)}Z" fill="${mix("#140f0e", "#4a3022", L * 0.8)}"/>` +
      `<path d="M${f(lx + 2)} ${f(ly - 3.8)}h7M${f(lx + 12)} ${f(ly - 2)}h9M${f(lx + 5)} ${f(ly - 1)}h5" stroke="#0a0707" stroke-opacity=".6" stroke-width=".5"/>` +
      `<path d="M${f(lx)} ${f(ly - 5.6)}H${f(lx + 26)}" stroke="${C.woodR}" stroke-opacity="${f2(0.2 + L * 0.6)}" stroke-width=".8"/>` +
      `<ellipse cx="${f(lx + 26)}" cy="${f(ly - 2.8)}" rx="1.5" ry="2.8" fill="${mix("#3a2418", "#e09a5c", L)}"/><ellipse cx="${f(lx + 26)}" cy="${f(ly - 2.8)}" rx=".6" ry="1.3" fill="none" stroke="#5a3422" stroke-width=".35"/>`);
  }
  if (S.has(5)) {
    const L = S.lit(fx, GY - 20);
    S.add("camp", GY + 1.5, `<path d="M${f(fx - 13)} ${f(GY + 3)}L${f(fx)} ${f(GY - 30)}L${f(fx + 13)} ${f(GY + 3)}M${f(fx)} ${f(GY - 30)}L${f(fx + 2)} ${f(GY + 1)}" stroke="${mix("#1c1512", "#8a5a38", L)}" stroke-width="1.3" fill="none"/><path d="M${f(fx)} ${f(GY - 30)}V${f(GY - 21)}" stroke="#1a1411" stroke-width=".6"/><path d="M${f(fx - 6)} ${f(GY - 21)}H${f(fx + 6)}L${f(fx + 5)} ${f(GY - 15)}Q${f(fx)} ${f(GY - 12.5)} ${f(fx - 5)} ${f(GY - 15)}Z" fill="#141013"/><path d="M${f(fx - 6)} ${f(GY - 21)}H${f(fx + 6)}" stroke="#ffb05c" stroke-opacity=".6" stroke-width=".7"/>`);
  }

  // lanterns strung from the lean-to to the tent
  if (S.has(8)) {
    lanternString(S, H.leanTo + 62, GY - 47, H.tent + 38, GY - 62, { n: 3, sag: 7, z: GY - 3 });
  }
}

// A pack by the fire and the trade's spare tool leaned on the lean-to's pole.
function campProps(S, H) {
  const px = H.leanTo + 70;
  const L = S.lit(px, GY - 6);
  const tl = mix("#1c1512", "#7a5236", L);
  const steel = mix("#2a2630", "#9a8a9a", L * 0.8);
  const tx = H.leanTo + 64;
  const tools = {
    delving: `<path d="M${f(tx)} ${f(GY + 1)}L${f(tx + 9)} ${f(GY - 30)}" stroke="${tl}" stroke-width="1.5" stroke-linecap="round"/><path d="M${f(tx + 2)} ${f(GY - 31)}Q${f(tx + 9)} ${f(GY - 34)} ${f(tx + 16)} ${f(GY - 29)}" stroke="${steel}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    felling: `<path d="M${f(tx)} ${f(GY + 1)}L${f(tx + 8)} ${f(GY - 28)}" stroke="${tl}" stroke-width="1.5" stroke-linecap="round"/><path d="M${f(tx + 5)} ${f(GY - 25)}L${f(tx + 12)} ${f(GY - 30)}L${f(tx + 13)} ${f(GY - 24)}Z" fill="${steel}"/>`,
    flaying: `<path d="M${f(tx + 2)} ${f(GY + 1)}L${f(tx + 5)} ${f(GY - 14)}" stroke="${tl}" stroke-width="1.8" stroke-linecap="round"/><path d="M${f(tx - 2)} ${f(GY - 14)}Q${f(tx + 5)} ${f(GY - 18)} ${f(tx + 12)} ${f(GY - 13)}" stroke="${steel}" stroke-width="1.4" fill="none"/>`,
    harvesting: `<path d="M${f(tx)} ${f(GY + 1)}L${f(tx + 7)} ${f(GY - 32)}" stroke="${tl}" stroke-width="1.4" stroke-linecap="round"/><path d="M${f(tx + 7)} ${f(GY - 32)}C${f(tx + 18)} ${f(GY - 34)} ${f(tx + 22)} ${f(GY - 24)} ${f(tx + 18)} ${f(GY - 16)}" stroke="${steel}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
    dredging: `<path d="M${f(tx)} ${f(GY + 1)}L${f(tx + 6)} ${f(GY - 34)}" stroke="${tl}" stroke-width="1.3" stroke-linecap="round"/><path d="M${f(tx + 6)} ${f(GY - 34)}q7 2 6 9q-4 3-8-2" stroke="#3a3440" stroke-width=".7" fill="none"/>`,
  };
  S.add("camp", GY - 3, tools[S.skill] || "");
  // the pack, a rolled blanket strapped on top
  S.add("camp", GY + 6, `<path d="M${f(px + 2)} ${f(GY + 6)}C${f(px)} ${f(GY - 2)} ${f(px + 3)} ${f(GY - 8)} ${f(px + 8)} ${f(GY - 8)}C${f(px + 13)} ${f(GY - 8)} ${f(px + 15)} ${f(GY - 2)} ${f(px + 14)} ${f(GY + 6)}Z" fill="${mix("#1a1414", "#6a4a36", L * 0.85)}"/>` +
    `<rect x="${f(px + 1)}" y="${f(GY - 12)}" width="14" height="5" rx="2.5" fill="${mix("#221a1c", "#8a5a44", L * 0.85)}"/>` +
    `<path d="M${f(px + 5)} ${f(GY - 12)}v13M${f(px + 11)} ${f(GY - 12)}v13" stroke="#0e0a0a" stroke-opacity=".7" stroke-width=".7"/>` +
    `<path d="M${f(px + 2)} ${f(GY - 12)}H${f(px + 14)}" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.5)}" stroke-width=".6"/>`);
}

// The second crew, their cart, the wall, the tower, the banners.
function outer(S, o) {
  if (S.has(6) && o.wall) palisade(S, o.wall[0], o.wall[1], o.wallY ?? GY - 6, { h: o.wallH ?? 32, gate: o.gate, decor: o.wallDecor, z: ZB.wall, style: o.wallStyle });
  if (S.has(7)) watchtower(S, o.tower ?? HEART.tower, GY - 4, { h: 96, flag: S.has(8), z: ZB.tower });
  if (S.has(8) && o.banners) for (const b of o.banners) banner(S, b[0], b[1] ?? GY, { h: b[2] ?? 46, z: b[3] ?? GY - 5 });
  if (S.has(8) && o.lamps) for (const x of o.lamps) lampPost(S, x, GY + 3, { h: 30 });
}

// Dark rocks and tufts along the bottom edge of the frame.
function foreRocks(S, seed, { tone = "#070509", tufts = true } = {}) {
  const r = S.rnd(seed);
  let d = "";
  let x = -10;
  while (x < 1010) {
    const w = 18 + r() * 40;
    const h = 3 + r() * 9;
    if (r() < 0.55) d += `M${f(x)} 201C${f(x + w * 0.1)} ${f(200 - h)} ${f(x + w * 0.35)} ${f(200 - h * 1.1)} ${f(x + w * 0.5)} ${f(200 - h)}C${f(x + w * 0.7)} ${f(200 - h * 0.9)} ${f(x + w * 0.9)} ${f(200 - h * 0.5)} ${f(x + w)} 201Z`;
    x += w * (0.6 + r() * 0.8);
  }
  let t = "";
  if (tufts) {
    for (let i = 0; i < 26; i++) {
      const tx = r() * 1000;
      const th = 4 + r() * 8;
      t += `M${f(tx)} 200q${f(-1 - r() * 2)} ${f(-th * 0.6)} ${f(-2 - r() * 3)} ${f(-th)}M${f(tx + 1)} 200q${f(r() * 2)} ${f(-th * 0.7)} ${f(1 + r() * 3)} ${f(-th * 1.1)}`;
    }
  }
  S.add("front", 0, `<path d="${d}" fill="${tone}"/><path d="${t}" fill="none" stroke="${tone}" stroke-width="1.1" stroke-linecap="round"/>`);
}

// Skyline y at x along a sampled edge.
function edgeAt(pts, x) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (x >= pts[i][0] && x <= pts[i + 1][0]) {
      const t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0] || 1);
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
    }
  }
  return pts[pts.length - 1][1];
}

/* ================= DELVING ================= */
/* Delving: the seams. */

const delving = (() => {
  /* A crag of dark rock over the camp. A seam first, then the adit,
     rails and the cart, a headframe over the shaft, the deep hall. */

  function hillEdge(S) {
    // The crag's skyline and its left face, from the foot of the face to the frame's edge.
    const r = S.rnd("crag");
    const nz = noise1(r, 16);
    const nz2 = noise1(r, 5);
    const key = [[602, GY], [606, 148], [614, 136], [622, 128], [640, 120], [668, 108], [704, 96], [744, 86], [790, 76], [834, 66], [866, 60], [898, 64], [936, 74], [974, 84], [1030, 94]];
    const pts = [];
    for (let i = 0; i < key.length - 1; i++) {
      const [x0, y0] = key[i];
      const [x1, y1] = key[i + 1];
      const n = Math.max(1, Math.round((x1 - x0) / 4));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t + (i > 2 ? nz(x) * 3.4 + nz2(x) * 1.3 : 0);
        pts.push([x, y]);
      }
    }
    pts.push(key[key.length - 1]);
    return pts;
  }

  function crag(S) {
    const edge = hillEdge(S);
    const Lface = S.lit(612, GY - 20);
    const d = `M${f(edge[0][0])} ${f(edge[0][1] + 2)}` + edge.map(([x, y]) => `L${f(x)} ${f(y)}`).join("") + `L1030 210L${f(edge[0][0])} 210Z`;
    const fill = S.lin([[0, "#2c2338"], [0.3, "#1c1624"], [1, "#0e0b12"]], { x1: 0, y1: 60, x2: 0, y2: GY, user: true });
    S.add("back", ZB.terrain, `<path d="${d}" fill="${fill}"/>`);
    // warm light from the camp on the near face
    S.add("back", ZB.terrain + 0.1, `<path d="${d}" fill="${S.lin([[0, "#7a4630", 0.1 + Lface * 0.45], [0.18, "#5a3226", Lface * 0.18], [0.4, "#3a2022", 0]], { x1: 600, y1: 0, x2: 1000, y2: 0, user: true })}"/>`);

    // bedding planes across the face, clipped to the rock: a moonlit lip over a line of shadow
    const r = S.rnd("ledges");
    const clip = S.uid("clip");
    S.def(`<clipPath id="${clip}"><path d="${d}"/></clipPath>`);
    let lips = "";
    let shades = "";
    let joints = "";
    for (let k = 0; k < 14; k++) {
      const y0 = 66 + k * 7.4 + r() * 3;
      let x = 604;
      while (x < 1010) {
        const len = 14 + r() * 46;
        const y = y0 - (x - 600) * 0.1 + Math.sin(x * 0.05 + k) * 1.2;
        const y1 = y0 - (x + len - 600) * 0.1 + Math.sin((x + len) * 0.05 + k) * 1.2;
        if (r() < 0.78) {
          lips += `M${f(x)} ${f(y)}L${f(x + len)} ${f(y1)}`;
          shades += `M${f(x)} ${f(y + 1.3)}L${f(x + len)} ${f(y1 + 1.3)}`;
          if (r() < 0.5) joints += `M${f(x + len * r())} ${f(y + 1.5)}l${f((r() - 0.5) * 1.5)} ${f(4 + r() * 3.5)}`;
        }
        x += len + 2 + r() * 10;
      }
    }
    let hatch = "";
    for (let i = 0; i < 220; i++) {
      const x = 604 + r() * 410;
      const top = edgeAt(edge, x);
      const y = top + 4 + r() * (GY - top - 6);
      hatch += `M${f(x)} ${f(y)}l${f(1.8)} ${f(-2.8)}`;
    }
    S.add("back", ZB.terrain + 1, `<g clip-path="url(#${clip})"><path d="${shades}" stroke="#07060a" stroke-opacity=".55" stroke-width="1.5"/><path d="${hatch}" stroke="#07060a" stroke-opacity=".35" stroke-width=".5"/><path d="${joints}" stroke="#07060a" stroke-opacity=".6" stroke-width=".7"/><path d="${lips}" stroke="#7a68a6" stroke-opacity=".2" stroke-width=".7"/></g>`);

    // the summit's moonlit face
    let face = [[866, edgeAt(edge, 866)]];
    for (let x = 862; x >= 780; x -= 4) face.push([x, edgeAt(edge, x) + 0.6]);
    face.push([812, 118], [860, 84]);
    S.add("back", ZB.terrain + 0.5, `<path d="${P(face)}" fill="${S.lin([[0, "#6a5890", 0.28], [1, "#6a5890", 0]], { x1: 0, y1: 0, x2: 0.2, y2: 1 })}"/>`);
    S.add("back", ZB.terrain + 2, `<path d="M${edge.slice(3).map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}" fill="none" stroke="#7a68a6" stroke-opacity=".5" stroke-width=".9"/>`);

    // scree fanning out at the foot of the face
    let scree = "";
    for (let i = 0; i < 40; i++) {
      const t = Math.pow(r(), 0.7);
      const x = 606 + r() * 120;
      const y = GY - 2 - (1 - t) * 10 + r() * 3;
      const w = 1 + r() * 2.4;
      const L = S.lit(x, y);
      scree += `<path d="M${f(x - w)} ${f(y)}L${f(x - w * 0.3)} ${f(y - w * 0.9)}L${f(x + w * 0.8)} ${f(y - w * 0.6)}L${f(x + w)} ${f(y)}Z" fill="${mix("#141117", "#4a3530", L * 0.7)}"/>`;
    }
    S.add("back", ZB.terrain + 3, scree);
    return edge;
  }

  function delving(S) {
    const s = S.stage;
    S.fireX = HEART.fire;

    sky(S, { moon: [760, 36], moonR: 8.5 });

    // far peaks, then the lower crags, fog between
    const farPk = peaks(S.rnd("far"), { base: 136, peaks: 11, hMin: 26, hMax: 76, sMin: 0.55, sMax: 1.15, jag: 2.6 });
    layerRidge(S, "far", 0, farPk.ys, -20, 4, { fill: S.lin([[0, "#2a2138"], [1, "#1c1627"]], { x1: 0, y1: 60, x2: 0, y2: 140, user: true }), rim: "#6a5a90", rimOp: 0.55, rimW: 0.8 });
    facets(S, "far", 0.5, farPk, { moonX: 760, col: "#8a78b4", op: 0.3 });
    fog(S, "far", 1, 128, 34, 0.2);
    const midPk = peaks(S.rnd("mid"), { base: 156, peaks: 8, hMin: 10, hMax: 34, sMin: 0.7, sMax: 1.4, jag: 2 });
    layerRidge(S, "mid", 0, midPk.ys, -20, 4, { fill: "#17121e", rim: "#40345a", rimOp: 0.55, rimW: 0.8 });
    facets(S, "mid", 0.5, midPk, { moonX: 760, col: "#5a4a7c", op: 0.22 });
    fog(S, "mid", 1, 150, 20, 0.16);

    crag(S);

    // the seam at the foot of the face: a darker vein with a few glints near the work
    const gr = S.rnd("glint");
    let gl = `<path d="M606 150C616 147 624 143 634 140L636 143C626 146 618 150 608 153Z" fill="#0b090e" fill-opacity=".8"/>`;
    for (let i = 0; i < 7; i++) {
      const gx = 608 + gr() * 26;
      const gy = 151 - (gx - 606) * 0.35 + (gr() - 0.5) * 2;
      gl += `<circle cx="${f(gx)}" cy="${f(gy)}" r="${f2(0.45 + gr() * 0.4)}" fill="${gr() < 0.4 ? C.violetHi : "#ffd48a"}" class="cs-star" style="--dl:${f(-gr() * 4)}s;--t:${f(1.5 + gr() * 2.5)}s"/>`;
    }
    if (s < 4) S.add("back", ZB.cut, gl);
    else {
      let g2 = `<path d="M684 150C692 144 700 140 712 136L713 140C702 144 694 149 688 154Z" fill="#0b090e" fill-opacity=".8"/>`;
      for (let i = 0; i < 7; i++) {
        const gx = 686 + gr() * 24;
        const gy = 151 - (gx - 684) * 0.55 + (gr() - 0.5) * 2;
        g2 += `<circle cx="${f(gx)}" cy="${f(gy)}" r="${f2(0.45 + gr() * 0.4)}" fill="${gr() < 0.4 ? C.violetHi : "#ffd48a"}" class="cs-star" style="--dl:${f(-gr() * 4)}s;--t:${f(1.5 + gr() * 2.5)}s"/>`;
      }
      S.add("back", ZB.cut + 3, g2);
    }

    ground(S);
    trail(S, HEART.fire + 24, 640, GY + 5, GY + 2);
    scatter(S, { n: 55, seed: "stones" });

    // rubble at the foot of the face
    heap(S, 566, GY + 3, { w: 44, h: 11, seed: "spoil", col: "#141117", lit: "#4e3a34", z: GY - 1 });

    heart(S, { barrels: 258 });

    // the adit, the rails and the lamp
    if (s >= 4) {
      const ax = 736;
      const top = 116;
      const L = S.lit(ax, GY - 20);
      S.add("back", ZB.cut, `<path d="M${f(ax - 32)} ${f(GY)}L${f(ax - 27)} ${f(top - 5)}Q${f(ax)} ${f(top - 17)} ${f(ax + 29)} ${f(top - 7)}L${f(ax + 34)} ${f(GY)}Z" fill="#0c0a10"/>`);
      const post = mix("#1c1512", "#6a4630", Math.max(L, 0.4) * 0.9);
      S.add("back", ZB.cut + 1,
        `<path d="M${f(ax - 17)} ${f(GY)}V${f(top + 6)}Q${f(ax)} ${f(top - 3)} ${f(ax + 17)} ${f(top + 6)}V${f(GY)}Z" fill="#020103"/>` +
        `<path d="M${f(ax - 12)} ${f(GY)}V${f(top + 16)}Q${f(ax)} ${f(top + 9)} ${f(ax + 12)} ${f(top + 16)}V${f(GY)}Z" fill="${S.radBox([[0, "#7a4226", 0.6], [0.6, "#2a140e", 0.3], [1, "#020103", 0]], { cx: 0.5, cy: 0.95, r: 0.7 })}"/>` +
        `<path d="M${f(ax - 19)} ${f(GY)}V${f(top + 2)}M${f(ax + 19)} ${f(GY)}V${f(top + 2)}" stroke="${post}" stroke-width="4"/>` +
        `<path d="M${f(ax - 24)} ${f(top + 3)}H${f(ax + 24)}" stroke="${post}" stroke-width="4.5"/>` +
        `<path d="M${f(ax - 24)} ${f(top + 0.8)}H${f(ax + 24)}" stroke="${C.rim}" stroke-opacity=".5" stroke-width=".7"/>` +
        `<path d="M${f(ax - 17)} ${f(top + 12)}L${f(ax - 10)} ${f(top + 5)}M${f(ax + 17)} ${f(top + 12)}L${f(ax + 10)} ${f(top + 5)}" stroke="${post}" stroke-width="2"/>` +
        `<path d="M${f(ax - 21)} ${f(GY)}V${f(top + 3)}" stroke="${C.woodR}" stroke-opacity="${f2(0.2 + L * 0.5)}" stroke-width=".8"/>`);
      lantern(S, ax - 24, top + 10, { z: ZB.cut + 2, size: 1, k: 0.35, r: 80, layer: "back" });
      // rails out of the dark and down to the camp
      const rx0 = ax + 4;
      const rx1 = s >= 5 ? 540 : 616;
      let sleepers = "";
      for (let x = rx1; x < rx0; x += 7) sleepers += `M${f(x)} ${f(GY + 3.2)}l3 -2.8`;
      S.add("ground", 5, `<path d="${sleepers}" stroke="#1d1512" stroke-width="2"/><path d="M${f(rx1)} ${f(GY + 2.4)}H${f(rx0)}M${f(rx1 + 2)} ${f(GY + 0.2)}H${f(rx0)}" stroke="#3a3238" stroke-width=".8"/><path d="M${f(rx1)} ${f(GY + 1.9)}H${f(rx0 - 60)}" stroke="#e0a064" stroke-opacity=".35" stroke-width=".5"/>`);
      heap(S, 782, GY + 1, { w: 58, h: 17, seed: "tip", col: "#131016", lit: "#403036", z: GY - 3, n: 26 });
    }

    // the lamp at the face (T2 on), the coal heap (T3 on)
    if (s >= 2) lampPost(S, s >= 4 ? 694 : 596, GY + 2, { h: 30 });
    if (s >= 3) heap(S, 520, GY + 6, { w: 30, h: 10, seed: "coal", col: "#0b0a0d", lit: "#2a2226", glint: "#bfb6d6", z: GY + 5, n: 18 });

    // the worker at the seam
    worker(S, s >= 4 ? 672 : 624, GY + 1, { pose: "swing", tool: "pick", dir: 1, t: 2.6 });

    // the second crew brings an ore cart down the rails
    if (s >= 5) {
      cart(S, 580, GY + 1, { w: 34, load: "ore", rails: true, wheelR: 4.5, dir: -1 });
      worker(S, 626, GY + 1, { pose: "push", dir: -1, t: 1.6 });
    }

    if (s >= 8) headframe(S, 842, 70, { h: 50 });
    if (s >= 9) deepHall(S, 124, GY - 6);

    outer(S, {
      wall: [0, 556],
      gate: 408,
      tower: HEART.tower,
      banners: [[322, GY - 4, 52, GY - 34], [712, GY - 2, 44, GY]],
      lamps: [548, 640],
    });

    foreRocks(S, "fr-delving");
    finish(S);
  }

  function headframe(S, x, y, { h = 92 } = {}) {
    const L = S.lit(x, y - 20);
    const wood = mix("#15100f", "#4a3226", 0.3 + L * 0.6);
    const dk = mix("#0e0a0a", "#2a1e18", 0.3 + L * 0.5);
    const top = y - h;
    let s = "";
    // winding house on the ridge
    s += `<path d="${P([[x - 34, y + 6], [x - 34, y - 10], [x - 20, y - 18], [x - 6, y - 10], [x - 6, y + 6]])}" fill="${S.lin([[0, "#1f1a22"], [1, "#0f0b0d"]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`;
    s += `<path d="M${f(x - 34)} ${f(y - 10)}L${f(x - 20)} ${f(y - 18)}L${f(x - 6)} ${f(y - 10)}" fill="none" stroke="${C.rim}" stroke-opacity=".65" stroke-width=".8"/>`;
    s += `<rect x="${f(x - 24)}" y="${f(y - 7)}" width="6" height="5" fill="#f0a050"/>`;
    S.light(x - 21, y - 5, 40, 0.25);
    S.add("fx", 23, `<circle class="cs-lamp" cx="${f(x - 21)}" cy="${f(y - 4.5)}" r="12" fill="${S.rad([[0, "#ffb866", 0.35], [1, "#ffb866", 0]], x - 21, y - 4.5, 12)}"/>`);
    // legs
    const legs = `M${f(x - 4)} ${f(y + 4)}L${f(x + 12)} ${f(top)}M${f(x + 28)} ${f(y + 4)}L${f(x + 14)} ${f(top)}M${f(x + 42)} ${f(y + 6)}L${f(x + 15)} ${f(top + 4)}`;
    s += `<path d="${legs}" stroke="${wood}" stroke-width="2.4" stroke-linecap="round"/>`;
    s += `<path d="${legs}" stroke="${C.rim}" stroke-opacity=".45" stroke-width=".6" transform="translate(-.9 -.3)"/>`;
    const b1 = y - h * 0.3;
    const b2 = y - h * 0.6;
    s += `<path d="M${f(x)} ${f(b1)}H${f(x + 25)}M${f(x + 5)} ${f(b2)}H${f(x + 21)}M${f(x)} ${f(b1)}L${f(x + 21)} ${f(b2)}M${f(x + 25)} ${f(b1)}L${f(x + 5)} ${f(b2)}M${f(x + 36)} ${f(y - 4)}L${f(x + 25)} ${f(b1)}" stroke="${dk}" stroke-width="1.1"/>`;
    // the wheel, turning
    const wx = x + 13;
    const wy = top - 2;
    let spokes = "";
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      spokes += `M0 0L${f(Math.cos(a) * 9)} ${f(Math.sin(a) * 9)}`;
    }
    s += `<g transform="translate(${f(wx)} ${f(wy)})"><g class="cs-spin" style="--t:14s"><circle r="9" fill="none" stroke="${wood}" stroke-width="1.8"/><path d="${spokes}" stroke="${dk}" stroke-width=".9"/></g><circle r="1.6" fill="${wood}"/></g>`;
    s += `<path d="M${f(wx - 7)} ${f(wy - 5.6)}A9 9 0 0 1 ${f(wx + 5)} ${f(wy - 7.6)}" fill="none" stroke="${C.rim}" stroke-opacity=".7" stroke-width=".8"/>`;
    s += `<path d="M${f(wx - 9)} ${f(wy)}L${f(x - 12)} ${f(y - 12)}M${f(wx + 9)} ${f(wy)}L${f(wx + 9)} ${f(y + 4)}" stroke="#2a221e" stroke-width=".6"/>`;
    S.add("back", ZB.landmark, s);
    lantern(S, x + 28, y - 8, { z: ZB.landmark + 0.5, layer: "back", size: 0.9, k: 0.25, r: 50 });
  }

  function deepHall(S, x, y) {
    // A stone hall with a steep roof, buttresses and tall lit windows.
    const w = 196;
    const wallTop = y - 44;
    const ridgeY = y - 92;
    const L = S.lit(x + w, y - 30);
    const stone = S.lin([[0, "#15121a"], [0.7, mix("#17131c", "#4a3530", L * 0.6)], [1, mix("#1a1519", "#6a4a3a", L * 0.8)]], { x1: 0, y1: 0, x2: 1, y2: 0 });
    let s = "";
    // roof
    s += `<path d="${P([[x - 8, wallTop + 2], [x + 22, ridgeY], [x + w - 22, ridgeY], [x + w + 8, wallTop + 2]])}" fill="${S.lin([[0, "#1a1520"], [1, "#0e0b12"]], { x1: 0, y1: 0, x2: 0, y2: 1 })}"/>`;
    // slate courses
    let sl = "";
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      const yy = ridgeY + (wallTop + 2 - ridgeY) * t;
      const xl = x + 22 - 30 * t;
      const xr = x + w - 22 + 30 * t;
      sl += `M${f(xl)} ${f(yy)}H${f(xr)}`;
    }
    s += `<path d="${sl}" stroke="#07060a" stroke-opacity=".7" stroke-width=".7"/>`;
    s += `<path d="M${f(x - 8)} ${f(wallTop + 2)}L${f(x + 22)} ${f(ridgeY)}H${f(x + w - 22)}L${f(x + w + 8)} ${f(wallTop + 2)}" fill="none" stroke="${C.rim}" stroke-opacity=".6" stroke-width=".9"/>`;
    // walls
    s += `<rect x="${f(x)}" y="${f(wallTop)}" width="${f(w)}" height="${f(y - wallTop)}" fill="${stone}"/>`;
    // block courses
    let bl = "";
    for (let yy = wallTop + 6; yy < y; yy += 6) bl += `M${f(x)} ${f(yy)}H${f(x + w)}`;
    for (let yy = wallTop; yy < y; yy += 6) for (let xx = x + ((yy / 6) % 2) * 7; xx < x + w; xx += 14) bl += `M${f(xx)} ${f(yy)}v6`;
    s += `<path d="${bl}" stroke="#08070b" stroke-opacity=".45" stroke-width=".5"/>`;
    // buttresses
    for (const bx of [x + 2, x + 48, x + 96, x + 146, x + w - 8]) {
      s += `<path d="${P([[bx, y], [bx, wallTop + 4], [bx + 6, wallTop + 8], [bx + 10, y]])}" fill="${mix("#141117", "#4a3530", S.lit(bx, y - 20) * 0.6)}"/>`;
    }
    // tall arched windows
    for (const wx of [x + 26, x + 72, x + 120, x + 168]) {
      const L2 = 1;
      s += `<path d="M${f(wx - 6)} ${f(y - 8)}V${f(wallTop + 15)}Q${f(wx - 5.4)} ${f(wallTop + 8)} ${f(wx)} ${f(wallTop + 4)}Q${f(wx + 5.4)} ${f(wallTop + 8)} ${f(wx + 6)} ${f(wallTop + 15)}V${f(y - 8)}Z" fill="${S.radBox([[0, "#ffe0a0"], [0.5, "#f2a050"], [1, "#8a3a20"]], { cx: 0.5, cy: 0.8, r: 0.8 })}"/>` +
        `<path d="M${f(wx)} ${f(wallTop + 8)}V${f(y - 8)}M${f(wx - 6)} ${f(y - 20)}H${f(wx + 6)}" stroke="#1a100c" stroke-width=".9"/>`;
      S.add("fx", 22, `<ellipse class="cs-lamp" cx="${f(wx)}" cy="${f(y - 20)}" rx="16" ry="20" fill="${S.rad([[0, "#ffb866", 0.28], [1, "#ffb866", 0]], wx, y - 20, 18, 1.2)}" style="--dl:${f(-wx % 3)}s"/>`);
      S.light(wx, y - 16, 55, 0.35 * L2);
    }
    // chimney with smoke
    const cx = x + w - 40;
    s += `<rect x="${f(cx)}" y="${f(ridgeY - 16)}" width="10" height="${f(wallTop - ridgeY + 8)}" fill="#120f15"/><rect x="${f(cx - 1.5)}" y="${f(ridgeY - 18)}" width="13" height="3" fill="#18141c"/>`;
    s += `<path d="M${f(cx)} ${f(ridgeY - 16)}V${f(ridgeY + 10)}" stroke="${C.rim}" stroke-opacity=".4" stroke-width=".6"/>`;
    smoke(S, cx + 5, ridgeY - 20, { n: 5, size: 1.1, t: 13, dx: 30, dy: -60, layer: "back", z: ZB.hall - 1 });
    S.add("back", ZB.hall, s);
    groundGlow(S, x + 98, 46, 0.4, y + 9);
    // door
    S.add("back", ZB.hall + 0.1, `<path d="M${f(x + 92)} ${f(y)}V${f(y - 18)}Q${f(x + 98)} ${f(y - 25)} ${f(x + 104)} ${f(y - 18)}V${f(y)}Z" fill="${S.radBox([[0, "#ffd48a"], [1, "#b0582a"]], { cx: 0.5, cy: 1, r: 1 })}"/>`);
  }

  return delving;
})();

/* ================= FELLING ================= */
/* Felling: the timber. A clearing cut into a wall of old pines. Each
   tier another tree comes down, so the clearing widens as the camp grows. */

const felling = (() => {
  const MOON_X = 214;

  // A big pine: a trunk and drooping tiers of boughs with ragged undersides.
  function pineShape(r, x, base, h, w = h * 0.3) {
    const tiers = Math.max(5, Math.round(h / 8));
    let d = `M${f(x - h * 0.02)} ${f(base)}L${f(x - h * 0.012)} ${f(base - h * 0.3)}H${f(x + h * 0.012)}L${f(x + h * 0.02)} ${f(base)}Z`;
    const rims = [];
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const ty = base - h * 0.14 - t * h * 0.8;
      const tw = w * Math.pow(1 - t, 0.85) * (0.82 + r() * 0.3) + 2;
      const droop = 3 + (1 - t) * 7;
      const apex = ty - 5 - (1 - t) * 2;
      const lx = x - tw;
      const rx = x + tw;
      const ly = ty + droop;
      const ry = ty + droop + (r() - 0.5) * 2;
      let under = "";
      const n = 4 + Math.floor(tw / 8);
      for (let k = 1; k < n; k++) {
        const u = k / n;
        const ux = lx + (rx - lx) * u;
        const sag = Math.sin(u * Math.PI) * droop * 0.55;
        under += `L${f(ux)} ${f(ly + (ry - ly) * u - sag + (k % 2 ? 2.2 : -0.6) + (r() - 0.5) * 1.2)}`;
      }
      d += `M${f(x)} ${f(apex)}Q${f(x - tw * 0.45)} ${f(ty - 1)} ${f(lx)} ${f(ly)}${under}L${f(rx)} ${f(ry)}Q${f(x + tw * 0.45)} ${f(ty - 1)} ${f(x)} ${f(apex)}Z`;
      // moonlight only along the outer bough tips, where the tier's edge is the tree's edge
      rims.push(x < MOON_X
        ? `M${f(rx)} ${f(ry)}L${f(rx + (x + tw * 0.45 - rx) * 0.55)} ${f(ry + (ty - 1 - ry) * 0.55)}`
        : `M${f(lx)} ${f(ly)}L${f(lx + (x - tw * 0.45 - lx) * 0.55)} ${f(ly + (ty - 1 - ly) * 0.55)}`);
    }
    d += `M${f(x - 1.5)} ${f(base - h * 0.96)}L${f(x)} ${f(base - h - 4)}L${f(x + 1.5)} ${f(base - h * 0.96)}Z`;
    return { d, rim: rims.join("") };
  }

  // `shake` gives the tree a class that rocks it about the foot of its trunk (the tree being cut).
  function pine(S, layer, z, r, x, base, h, { col = "#0c0e0f", rimCol = "#5a6a7a", rimOp = 0.35, w, shake = null } = {}) {
    const { d, rim } = pineShape(r, x, base, h, w);
    const tree = `<path d="${d}" fill="${col}"/><path d="${rim}" fill="none" stroke="${rimCol}" stroke-opacity="${f2(rimOp)}" stroke-width=".7"/>`;
    S.add(layer, z, shake
      ? `<g transform="translate(${f(x)} ${f(base)})"><g class="${shake.cls}" style="--t:${f(shake.t)}s;--dl:${f(shake.dl || 0)}s"><g transform="translate(${f(-x)} ${f(-base)})">${tree}</g></g></g>`
      : tree);
  }

  /* How the axe goes in: notch work. A cut down from over the shoulder, a
     flat cut under it, then a breath; the arm is foreshortened as it comes
     round, so the swing reads as coming round the body rather than down like
     the pick. The tree shivers and throws chips at each bite, all on the
     worker's --t. Its classes carry no letter (the kit draws other swings
     with a letter each). */
  const FELL = { swing: "C" };
  const CHOPS = { C: 3.6 };
  const chopTag = (k) => (k === "C" ? "" : k);

  // Chips thrown back out of the notch at each bite, in step with the worker's swing.
  function chipBurst(S, x, y, cls, t) {
    const r = S.rnd("chipburst");
    let s = "";
    for (let i = 0; i < 8; i++) {
      const dx = -(4 + r() * 9);
      const dy = 3 + r() * 5;
      const h = -(2 + r() * 5);
      const L = S.lit(x, y);
      s += `<g transform="translate(${f(x - 0.6 + r() * 1.2)} ${f(y - 1.4 + r() * 2.8)})"><g class="${cls}" style="--t:${f(t)}s;--dl:0s;--dx:${f(dx)}px;--dy:${f(dy)}px;--h:${f(h)}px">` +
        `<path transform="rotate(${Math.round(r() * 360)})" d="M-1-.4L1.1-.6L.7.6Z" fill="${mix("#a07850", "#f6dcae", 0.35 + L * (0.4 + r() * 0.25))}"/></g></g>`;
    }
    S.add("camp", GY + 3, s);
  }

  // A stump with rings on its cut face and roots gripping the ground.
  function stump(S, x, y, { w = 13, h = 9, axe = false, z = y } = {}) {
    const L = S.lit(x, y - h);
    const bark = mix("#141010", "#4a3022", L * 0.8);
    const face = mix("#3a281c", "#e0a468", L);
    let s = `<path d="M${f(x - w / 2 - 3)} ${f(y + 0.5)}Q${f(x - w / 2)} ${f(y - 2)} ${f(x - w / 2)} ${f(y - h)}H${f(x + w / 2)}Q${f(x + w / 2)} ${f(y - 2)} ${f(x + w / 2 + 3.5)} ${f(y + 0.5)}Z" fill="${bark}"/>` +
      `<path d="M${f(x - w / 2 + 1.5)} ${f(y - h + 2)}V${f(y - 1)}M${f(x - 1)} ${f(y - h + 3)}V${f(y - 2)}M${f(x + w / 2 - 2)} ${f(y - h + 2)}V${f(y - 1.5)}" stroke="#0a0707" stroke-opacity=".6" stroke-width=".6"/>` +
      `<ellipse cx="${f(x)}" cy="${f(y - h)}" rx="${f(w / 2)}" ry="${f(w * 0.16)}" fill="${face}"/>` +
      `<ellipse cx="${f(x)}" cy="${f(y - h)}" rx="${f(w * 0.3)}" ry="${f(w * 0.09)}" fill="none" stroke="${mix("#2a1c14", "#a06a40", L)}" stroke-width=".4"/>` +
      `<ellipse cx="${f(x)}" cy="${f(y - h)}" rx="${f(w * 0.12)}" ry="${f(w * 0.04)}" fill="none" stroke="${mix("#2a1c14", "#a06a40", L)}" stroke-width=".4"/>`;
    if (axe) s += `<path d="M${f(x + 1)} ${f(y - h - 0.5)}L${f(x + 8)} ${f(y - h - 13)}" stroke="#3a2c24" stroke-width="1.2" stroke-linecap="round"/><path d="M${f(x - 2)} ${f(y - h - 2.5)}L${f(x + 3.2)} ${f(y - h - 1)}L${f(x + 2.4)} ${f(y - h + 1.6)}L${f(x - 2.4)} ${f(y - h + 0.8)}Z" fill="#6b6474"/>`;
    S.add("camp", z, s);
    shadow(S, x - w / 2, x + w / 2, h + 4, y);
  }

  // A felled trunk lying on the ground, the cut end toward the camp.
  function logLying(S, x, y, len, { r = 4.2, z = y } = {}) {
    const L = S.lit(x, y - r);
    S.add("camp", z,
      `<rect x="${f(x)}" y="${f(y - r * 2)}" width="${f(len)}" height="${f(r * 2)}" rx="${f(r)}" fill="${S.lin([[0, mix("#1e1612", "#6a4630", L * 0.9)], [1, "#0e0a09"]], { x1: 0, y1: 0, x2: 0, y2: 1 })}"/>` +
      `<path d="M${f(x + 4)} ${f(y - r * 1.3)}h${f(len * 0.3)}M${f(x + len * 0.45)} ${f(y - r * 0.8)}h${f(len * 0.35)}" stroke="#0a0707" stroke-opacity=".6" stroke-width=".5"/>` +
      `<ellipse cx="${f(x + 0.8)}" cy="${f(y - r)}" rx="${f(r * 0.45)}" ry="${f(r)}" fill="${mix("#3a281c", "#f0b070", L)}"/>` +
      `<ellipse cx="${f(x + 0.8)}" cy="${f(y - r)}" rx="${f(r * 0.2)}" ry="${f(r * 0.5)}" fill="none" stroke="${mix("#2a1c14", "#a06a40", L)}" stroke-width=".35"/>` +
      `<path d="M${f(x + r)} ${f(y - r * 2)}H${f(x + len - r)}" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.5)}" stroke-width=".6"/>`);
    shadow(S, x, x + len, r * 2, y);
  }

  // Logs stacked end-on, rows of fewer and fewer.
  function logPile(S, x, y, rows, { r = 5, z = y } = {}) {
    let s = "";
    rows.forEach((count, row) => {
      for (let i = 0; i < count; i++) {
        const cx = x + row * r + i * r * 2.05;
        const cy = y - r - row * r * 1.72;
        const L = S.lit(cx, cy);
        s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${mix("#140e0c", "#3a2618", L)}"/>` +
          `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r - 1)}" fill="${mix("#3a281c", "#e8a86a", L)}"/>` +
          `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.5)}" fill="none" stroke="${mix("#2a1c14", "#a86e44", L)}" stroke-width=".4"/>` +
          `<circle cx="${f(cx + 0.3)}" cy="${f(cy + 0.2)}" r=".6" fill="${mix("#2a1c14", "#8a5634", L)}"/>`;
      }
    });
    S.add("camp", z, s);
    shadow(S, x - r, x + rows[0] * r * 2, rows.length * r * 1.7, y);
  }

  // A trunk on two trestles, a bow saw resting in the cut.
  function trestles(S, x, y, len, { z = y } = {}) {
    const L = S.lit(x + len / 2, y - 16);
    const leg = mix("#15100e", "#5a3c29", L * 0.85);
    let s = "";
    for (const tx of [x + 12, x + len - 14]) s += `<path d="M${f(tx - 7)} ${f(y)}L${f(tx + 5)} ${f(y - 19)}M${f(tx + 7)} ${f(y)}L${f(tx - 5)} ${f(y - 19)}" stroke="${leg}" stroke-width="2" stroke-linecap="round"/>`;
    const r = 5.4;
    s += `<rect x="${f(x)}" y="${f(y - 17 - r * 2)}" width="${f(len)}" height="${f(r * 2)}" rx="${f(r)}" fill="${S.lin([[0, mix("#241a14", "#7a5236", L * 0.9)], [1, "#0f0b0a"]], { x1: 0, y1: 0, x2: 0, y2: 1 })}"/>` +
      `<path d="M${f(x + 5)} ${f(y - 17 - r * 1.4)}h${f(len * 0.4)}M${f(x + len * 0.5)} ${f(y - 17 - r * 0.7)}h${f(len * 0.4)}" stroke="#0a0707" stroke-opacity=".6" stroke-width=".5"/>` +
      `<ellipse cx="${f(x + len - 0.8)}" cy="${f(y - 17 - r)}" rx="${f(r * 0.45)}" ry="${f(r)}" fill="${mix("#3a281c", "#f0b070", L)}"/>` +
      `<path d="M${f(x + 1)} ${f(y - 17 - r * 2)}H${f(x + len - 1)}" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.55)}" stroke-width=".6"/>`;
    // bow saw standing in a half-made cut
    const sx = x + len * 0.62;
    s += `<path d="M${f(sx)} ${f(y - 17 - r * 2 + 2)}V${f(y - 17 - r * 2 - 11)}" stroke="#8a8494" stroke-width=".5"/><path d="M${f(sx)} ${f(y - 17 - r * 2 - 11)}Q${f(sx + 8)} ${f(y - 17 - r * 2 - 14)} ${f(sx + 10)} ${f(y - 17 - r * 2 - 4)}" fill="none" stroke="${leg}" stroke-width="1.2"/>`;
    // sawdust
    s += `<ellipse cx="${f(sx)}" cy="${f(y + 0.5)}" rx="7" ry="1.3" fill="${mix("#2a2018", "#b08058", L)}" fill-opacity=".7"/>`;
    S.add("camp", z, s);
    shadow(S, x, x + len, 22, y);
  }

  // A derrick: a mast with a boom swung out over the pile, a trunk hanging from its tip.
  function crane(S, x, y, { h = 100, z = y, dir = 1 } = {}) {
    const L = S.lit(x, y - 30);
    const pole = mix("#15100e", "#5a3c29", L * 0.85);
    const top = y - h;
    const bx = x + 52 * dir;
    const by = y - 84;
    let s = `<path d="M${f(x)} ${f(y)}V${f(top)}" stroke="${pole}" stroke-width="3" stroke-linecap="round"/>` +
      `<path d="M${f(x - 1.4)} ${f(y)}V${f(top)}" stroke="${C.rim}" stroke-opacity=".35" stroke-width=".6"/>` +
      // stays to the ground
      `<path d="M${f(x)} ${f(top + 1)}L${f(x - 46 * dir)} ${f(y + 1)}M${f(x)} ${f(top + 1)}L${f(x - 20 * dir)} ${f(y + 2)}" stroke="#2a221e" stroke-width=".6"/>` +
      `<path d="M${f(x - 46 * dir)} ${f(y + 1)}v-3M${f(x - 20 * dir)} ${f(y + 2)}v-3" stroke="#2a201b" stroke-width="1.3"/>` +
      // boom and its topping lift
      `<path d="M${f(x + dir)} ${f(y - 12)}L${f(bx)} ${f(by)}" stroke="${pole}" stroke-width="2.4" stroke-linecap="round"/>` +
      `<path d="M${f(x)} ${f(top + 2)}L${f(bx)} ${f(by)}" stroke="#2a221e" stroke-width=".7"/>` +
      // windlass at the foot of the mast
      `<circle cx="${f(x - 7 * dir)}" cy="${f(y - 9)}" r="3.4" fill="none" stroke="${pole}" stroke-width="1.3"/><path d="M${f(x - 7 * dir)} ${f(y - 9)}l4 -4M${f(x - 7 * dir)} ${f(y - 9)}l-4 4" stroke="${pole}" stroke-width=".9"/>` +
      `<path d="M${f(x - 7 * dir)} ${f(y - 12.4)}L${f(bx)} ${f(by + 1)}" stroke="#2a221e" stroke-width=".5"/>` +
      `<circle cx="${f(bx)}" cy="${f(by)}" r="1.8" fill="${pole}"/>`;
    // the trunk hangs from the boom tip and turns a little
    const drop = 38;
    s += `<g transform="translate(${f(bx)} ${f(by + 1)})"><g class="cs-hang" style="--t:6s"><path d="M0 0V${f(drop)}M0 ${f(drop)}L-12 ${f(drop + 8)}M0 ${f(drop)}L12 ${f(drop + 8)}" stroke="#2a221e" stroke-width=".7"/>` +
      `<rect x="-26" y="${f(drop + 7)}" width="52" height="9" rx="4.5" fill="${S.lin([[0, mix("#241a14", "#7a5236", L * 0.8)], [1, "#0f0b0a"]], { x1: 0, y1: 0, x2: 0, y2: 1 })}"/>` +
      `<ellipse cx="-25.4" cy="${f(drop + 11.5)}" rx="2" ry="4.5" fill="${mix("#3a281c", "#e8a86a", L)}"/>` +
      `<path d="M-20 ${f(drop + 7.4)}H22" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.4)}" stroke-width=".5"/></g></g>`;
    S.add("camp", z, s);
    shadow(S, x - 4, x + 4, h * 0.5, y);
  }

  // A longhouse: low stave walls, a sweeping roof, crossed gable boards carved at the ends.
  function longhouse(S, x, y, { w = 206, z = ZB.hall } = {}) {
    const L = S.lit(x + w, y - 20);
    const eave = y - 26;
    const ridgeY = y - 78;
    let s = "";
    // walls
    s += `<rect x="${f(x + 8)}" y="${f(eave)}" width="${f(w - 16)}" height="${f(y - eave)}" fill="${S.lin([[0, "#130f10"], [0.7, mix("#15100f", "#4a3022", L * 0.5)], [1, mix("#1a1411", "#6a4630", L * 0.8)]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`;
    let staves = "";
    for (let xx = x + 12; xx < x + w - 8; xx += 5) staves += `M${f(xx)} ${f(eave + 1)}V${f(y)}`;
    s += `<path d="${staves}" stroke="#080606" stroke-opacity=".55" stroke-width=".6"/>`;
    // roof, sagging a little along the ridge
    const roof = `M${f(x - 6)} ${f(eave + 4)}L${f(x + 30)} ${f(ridgeY + 2)}Q${f(x + w / 2)} ${f(ridgeY + 7)} ${f(x + w - 30)} ${f(ridgeY + 2)}L${f(x + w + 6)} ${f(eave + 4)}Q${f(x + w / 2)} ${f(eave + 8)} ${f(x - 6)} ${f(eave + 4)}Z`;
    s += `<path d="${roof}" fill="${S.lin([[0, "#1d1716"], [1, "#0d0a0c"]], { x1: 0, y1: 0, x2: 0, y2: 1 })}"/>`;
    // shingle rows
    let sh = "";
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const yl = ridgeY + 2 + (eave + 4 - ridgeY - 2) * t;
      const xl = x + 30 - 36 * t;
      const xr = x + w - 30 + 36 * t;
      const mid = ridgeY + 7 + (eave + 8 - ridgeY - 7) * t;
      sh += `M${f(xl)} ${f(yl)}Q${f(x + w / 2)} ${f(mid)} ${f(xr)} ${f(yl)}`;
    }
    s += `<path d="${sh}" fill="none" stroke="#070506" stroke-opacity=".7" stroke-width=".7"/>`;
    s += `<path d="M${f(x - 6)} ${f(eave + 4)}L${f(x + 30)} ${f(ridgeY + 2)}Q${f(x + w / 2)} ${f(ridgeY + 7)} ${f(x + w - 30)} ${f(ridgeY + 2)}L${f(x + w + 6)} ${f(eave + 4)}" fill="none" stroke="${C.rim}" stroke-opacity=".6" stroke-width=".9"/>`;
    // crossed gable boards with carved heads
    const gable = (gx, dir) => `<path d="M${f(gx - dir * 8)} ${f(ridgeY + 12)}L${f(gx + dir * 10)} ${f(ridgeY - 12)}M${f(gx + dir * 8)} ${f(ridgeY + 12)}L${f(gx - dir * 6)} ${f(ridgeY - 8)}" stroke="#1a1310" stroke-width="2.6" stroke-linecap="round"/>` +
      `<path d="M${f(gx + dir * 10)} ${f(ridgeY - 12)}q${f(dir * 5)} -3 ${f(dir * 3)} -8q${f(-dir * 2)} 2 ${f(-dir * 4)} 1" fill="none" stroke="#1a1310" stroke-width="2"/>` +
      `<path d="M${f(gx - dir * 6)} ${f(ridgeY - 8)}q${f(-dir * 5)} -2 ${f(-dir * 4)} -7" fill="none" stroke="#1a1310" stroke-width="1.8"/>`;
    s += gable(x + 30, -1) + gable(x + w - 30, 1);
    // door, windows, smoke hole
    const dx = x + w / 2;
    s += `<path d="M${f(dx - 9)} ${f(y)}V${f(y - 20)}H${f(dx + 9)}V${f(y)}Z" fill="${S.radBox([[0, "#ffd48a"], [0.6, "#e08040"], [1, "#6a2a18"]], { cx: 0.5, cy: 1, r: 1 })}"/>` +
      `<path d="M${f(dx - 11)} ${f(y)}V${f(y - 22)}H${f(dx + 11)}V${f(y)}" fill="none" stroke="#1a1310" stroke-width="2.2"/>`;
    for (const wx of [x + 34, x + 64, x + w - 64, x + w - 34]) {
      s += `<rect x="${f(wx - 5)}" y="${f(y - 18)}" width="10" height="5" fill="#f2a050"/><path d="M${f(wx)} ${f(y - 18)}V${f(y - 13)}" stroke="#1a100c" stroke-width=".8"/>`;
      S.light(wx, y - 14, 40, 0.25);
    }
    S.light(dx, y - 8, 70, 0.45);
    groundGlow(S, dx, 44, 0.4, y + 9);
    S.add("fx", 22, `<ellipse class="cs-lamp" cx="${f(dx)}" cy="${f(y - 8)}" rx="26" ry="18" fill="${S.rad([[0, "#ffb866", 0.3], [1, "#ffb866", 0]], dx, y - 8, 26, 0.7)}"/>`);
    s += `<path d="M${f(x + w / 2 - 8)} ${f(ridgeY + 5)}h16l-2 -5h-12Z" fill="#0e0b0d"/>`;
    S.add("back", z, s);
    smoke(S, x + w / 2, ridgeY - 2, { n: 5, size: 1.2, t: 13, dx: 34, dy: -56, layer: "back", z: z - 1 });
  }

  function felling(S) {
    const s = S.stage;
    S.fireX = HEART.fire;

    sky(S, { moon: [MOON_X, 40], moonR: 9, cloudDx: 30 });

    // far ridges crowned with pines, mist between
    const r = S.rnd("far");
    const hills = hillYs(r, { base: 126, amp: 10, waves: 3 });
    layerRidge(S, "far", 0, hills, -20, 6, { fill: "#241d2e", rim: "#5a4d74", rimOp: 0.4, rimW: 0.7 });
    let farPines = "";
    for (let i = 0; i < hills.length; i += 1) {
      const x = -20 + i * 6 + r() * 4;
      if (r() < 0.2) continue;
      const h = 8 + r() * 12;
      farPines += `M${f(x - h * 0.2)} ${f(hills[i] + 2)}L${f(x)} ${f(hills[i] - h)}L${f(x + h * 0.2)} ${f(hills[i] + 2)}Z`;
    }
    S.add("far", 0.5, `<path d="${farPines}" fill="#241d2e"/>`);
    fog(S, "far", 1, 126, 30, 0.22);
    const r2 = S.rnd("mid");
    const mid = hillYs(r2, { base: 146, amp: 6, waves: 2 });
    layerRidge(S, "mid", 0, mid, -20, 6, { fill: "#151219", rim: "#3a3050", rimOp: 0.4, rimW: 0.7 });
    S.add("mid", 0.5, `<path d="${pineRow(r2, { x0: -20, x1: 1020, base: 146, hMin: 14, hMax: 30, gap: [5, 11] })}" fill="#151219"/>`);
    fog(S, "mid", 1, 146, 18, 0.14);

    // the forest wall behind the work, and a few pines far left
    const rf = S.rnd("wall");
    for (let x = 820; x < 1030; x += 22 + rf() * 16) pine(S, "back", ZB.terrain + (x % 3), rf, x, GY - 6, 80 + rf() * 40, { col: "#101216", rimCol: "#8a9ab6", rimOp: 0.34 });
    const rl = S.rnd("left");
    for (const x of [-4, 30, 58]) pine(S, "back", ZB.terrain, rl, x + rl() * 6, GY - 8, 70 + rl() * 30, { col: "#0e0e12", rimCol: "#6a7a96", rimOp: 0.3 });

    // one old tree that fought back, reaching over the clearing
    const rg = S.rnd("gnarl");
    const gn = bareTree(rg, 962, GY - 4, 160, { spread: 1.0, depth: 5, lean: -0.36, twist: 1.0, w0: 7 });
    S.add("back", ZB.terrain + 5, `<g transform="translate(.8 -.6)">${treeSvg(gn, "#7a8aaa", 0.35)}</g>` + treeSvg(gn, "#0a090c"));

    ground(S, { top: "#18141c" });
    trail(S, HEART.fire + 24, 700, GY + 5, GY + 2);
    scatter(S, { n: 50, seed: "stones" });
    scatter(S, { n: 40, seed: "tufts", kind: "tuft", x0: 560, x1: 1000 });

    // wood chips round the work
    const rc = S.rnd("chips");
    let chips = "";
    for (let i = 0; i < 26; i++) {
      const cx = 610 + rc() * 220;
      const cy = GY + 1 + rc() * 7;
      chips += `<path d="M${f(cx)} ${f(cy)}l${f(1.5 + rc())} ${f(-0.6)}l.4 .9Z" fill="${mix("#3a2a1e", "#c09060", S.lit(cx, cy) * 0.8)}"/>`;
    }
    S.add("ground", 5, chips);

    heart(S, { barrels: 258 });

    // the clearing: a tree comes down each tier or two. The next one standing is being cut.
    const TREES = [[664, 86], [714, 96], [764, 90], [812, 104]];
    const felled = s >= 8 ? 3 : s >= 6 ? 2 : s >= 3 ? 1 : 0;
    const rt = S.rnd("clearing");
    const chop = CHOPS[FELL.swing] ? FELL.swing : null;
    TREES.forEach(([tx, th], i) => {
      if (i < felled) {
        stump(S, tx, GY + 2, { w: 12 + i, h: 7 + (i % 2) * 2, axe: i === 0 && s >= 3 });
      } else {
        const shake = chop && i === felled ? { cls: `cs-shiver${chopTag(chop)}`, t: CHOPS[chop] } : null;
        pine(S, "camp", GY - 6 - i, rt, tx, GY + 1, th, { col: "#0a0b0d", rimCol: "#7a8aa6", rimOp: 0.32, shake });
        if (i === felled) {
          // the notch the axe has cut, lit from the camp
          const L = S.lit(tx, GY - 8);
          S.add("camp", GY - 5, `<path d="M${f(tx - 2.2)} ${f(GY - 3)}L${f(tx + 0.4)} ${f(GY - 6)}L${f(tx - 2.2)} ${f(GY - 8.6)}Z" fill="${mix("#6a4a30", "#f0b878", L)}"/>`);
        }
      }
    });
    const target = TREES[Math.min(felled, 3)];
    if (chop) {
      // stands a pace further back than the pick's swing: the axe comes round, not down
      worker(S, target[0] - 25, GY + 1, { pose: "chop", chop: chopTag(chop), tool: "axe", dir: 1, t: CHOPS[chop] });
      chipBurst(S, target[0] - 1.6, GY - 6, `cs-chip${chopTag(chop)}`, CHOPS[chop]);
    }

    // felled trunks and the pile at camp
    logLying(S, 592, GY + 5, 52, { r: 4.4, z: GY + 5 });
    if (s >= 3) logPile(S, 540, GY + 4, s >= 6 ? [4, 3, 2, 1] : [3, 2, 1], { r: 4.6 });
    if (s >= 4) trestles(S, 612, GY + 2, 70);

    // the second crew hauls a trunk in on a drag
    if (s >= 5) {
      const L = S.lit(250, GY);
      const lx = 150;
      S.add("camp", GY + 6,
        `<rect x="${f(lx)}" y="${f(GY - 6)}" width="88" height="9" rx="4.5" transform="rotate(-3 ${f(lx)} ${f(GY)})" fill="${S.lin([[0, mix("#241a14", "#6a4630", L * 0.9)], [1, "#0f0b0a"]], { x1: 0, y1: 0, x2: 0, y2: 1 })}"/>` +
        `<ellipse cx="${f(lx + 1)}" cy="${f(GY - 1.5)}" rx="2" ry="4.5" fill="${mix("#3a281c", "#e8a86a", L)}"/>` +
        `<circle cx="${f(lx + 18)}" cy="${f(GY - 5)}" r="11" fill="none" stroke="${mix("#120e0c", "#4a3222", L)}" stroke-width="2.2"/>` +
        `<path d="M${f(lx + 18)} ${f(GY - 16)}V${f(GY + 6)}M${f(lx + 7)} ${f(GY - 5)}H${f(lx + 29)}M${f(lx + 10)} ${f(GY - 13)}L${f(lx + 26)} ${f(GY + 3)}M${f(lx + 26)} ${f(GY - 13)}L${f(lx + 10)} ${f(GY + 3)}" stroke="${mix("#120e0c", "#4a3222", L)}" stroke-width=".8"/>` +
        `<path d="M${f(lx + 18)} ${f(GY - 5)}L${f(lx - 14)} ${f(GY - 16)}" stroke="#2a221e" stroke-width=".7"/>`);
      worker(S, lx - 18, GY + 6, { pose: "push", dir: -1, t: 1.7, z: GY + 6.5 });
    }

    if (s >= 8) crane(S, 716, GY + 2, { dir: -1 });
    if (s >= 9) longhouse(S, 118, GY - 6);

    outer(S, {
      wall: [0, 590],
      gate: 408,
      tower: HEART.tower,
      banners: [[322, GY - 4, 52, GY - 34], [604, GY - 2, 46, GY]],
      lamps: [770],
    });

    foreRocks(S, "fr-felling");
    finish(S);
  }

  return felling;
})();

/* ================= FLAYING ================= */
/* Flaying: the hides. A bleak moor under a low moon, crows turning
   over it, the ribs of something vast on the far hill. Frames and
   vats first, then racks, lamps of tallow, and the tannery hall. */

const flaying = (() => {
  const MOON = [792, 60];

  // Crows turning slow circles about a point; each flaps.
  function crows(S, cx, cy, n = 4) {
    const r = S.rnd("crows");
    let s = "";
    for (let i = 0; i < n; i++) {
      const rx = 26 + r() * 50;
      const ry = 8 + r() * 14;
      const t = 16 + r() * 14;
      const sz = 0.8 + r() * 0.5;
      const bird = `<g transform="scale(${f2(sz)})"><path class="cs-flap" d="M-4.6 -1.2Q-2.4-2.8 0 0Q2.4-2.8 4.6-1.2Q2.6-1.6 0 1Q-2.6-1.6-4.6-1.2Z" fill="#07060a" style="--t:${f(0.45 + r() * 0.3)}s"/></g>`;
      const d0 = -r() * t;
      s += `<g transform="translate(${f(cx)} ${f(cy)})"><g class="cs-orbx" style="--t:${f(t)}s;--dl:${f(d0)}s;--rx:${f(rx)}px"><g class="cs-orby" style="--t:${f(t)}s;--dl:${f(d0 - t / 2)}s;--ry:${f(ry)}px">${bird}</g></g></g>`;
    }
    S.add("sky", 6, s);
  }

  // A pelt: a body with four leg tabs and a neck, laced into whatever holds it.
  function peltPath(cx, cy, w, h) {
    const hw = w / 2;
    const hh = h / 2;
    return `M${f(cx - hw * 0.55)} ${f(cy - hh * 0.8)}Q${f(cx)} ${f(cy - hh * 1.05)} ${f(cx + hw * 0.55)} ${f(cy - hh * 0.8)}` +
      `L${f(cx + hw)} ${f(cy - hh)}L${f(cx + hw * 0.82)} ${f(cy - hh * 0.45)}Q${f(cx + hw * 0.9)} ${f(cy)} ${f(cx + hw * 0.8)} ${f(cy + hh * 0.45)}` +
      `L${f(cx + hw)} ${f(cy + hh)}L${f(cx + hw * 0.45)} ${f(cy + hh * 0.82)}Q${f(cx)} ${f(cy + hh * 1.1)} ${f(cx - hw * 0.45)} ${f(cy + hh * 0.82)}` +
      `L${f(cx - hw)} ${f(cy + hh)}L${f(cx - hw * 0.8)} ${f(cy + hh * 0.45)}Q${f(cx - hw * 0.9)} ${f(cy)} ${f(cx - hw * 0.82)} ${f(cy - hh * 0.45)}L${f(cx - hw)} ${f(cy - hh)}Z`;
  }

  // A stretching frame: two posts, two rails, a pelt laced in.
  function frame(S, x, y, { w = 40, h = 38, z = y, tone = 0, give = null } = {}) {
    const L = S.lit(x + w / 2, y - h / 2);
    const post = mix("#15100e", "#5a3c29", L * 0.85);
    const cx = x + w / 2;
    const cy = y - 8 - h / 2;
    const hideCol = S.lin([[0, mix(tone ? "#3a2418" : "#2e1c16", "#b87850", L * 0.95)], [0.6, mix("#24160f", "#7a4a30", L * 0.7)], [1, "#140c0a"]], { x1: 0, y1: 0, x2: 1, y2: 1 });
    const pw = w - 12;
    const ph = h - 10;
    let s = `<path d="M${f(x)} ${f(y)}V${f(y - h - 12)}M${f(x + w)} ${f(y)}V${f(y - h - 12)}" stroke="${post}" stroke-width="2.4" stroke-linecap="round"/>` +
      `<path d="M${f(x - 3)} ${f(y - h - 8)}H${f(x + w + 3)}M${f(x - 1)} ${f(y - 6)}H${f(x + w + 1)}" stroke="${post}" stroke-width="1.8" stroke-linecap="round"/>` +
      `<path d="${peltPath(cx, cy, pw, ph)}" fill="${hideCol}"/>`;
    // a pelt that gives under a pull, anchored at its far edge
    if (give) {
      const pelt = `<path d="${peltPath(cx, cy, pw, ph)}" fill="${hideCol}"/>`;
      s = s.replace(pelt, `<g transform="translate(${f(cx + pw / 2)} ${f(cy)})"><g class="${give.cls}" style="--t:${f(give.t)}s;--dl:0s"><g transform="translate(${f(-cx - pw / 2)} ${f(-cy)})">${pelt}</g></g></g>`);
    }
    // lacing from the tabs to the frame
    const tabs = [[cx - pw / 2, cy - ph / 2], [cx + pw / 2, cy - ph / 2], [cx - pw / 2, cy + ph / 2], [cx + pw / 2, cy + ph / 2]];
    let lace = "";
    tabs.forEach(([tx, ty], i) => {
      const fx = i % 2 ? x + w : x;
      const fy = i < 2 ? y - h - 8 : y - 6;
      lace += `M${f(tx)} ${f(ty)}L${f(fx)} ${f(fy)}M${f(tx)} ${f(ty)}L${f(i % 2 ? x + w : x)} ${f(ty)}`;
    });
    s += `<path d="${lace}" stroke="#2a201b" stroke-width=".5"/>`;
    s += `<path d="M${f(cx - pw * 0.25)} ${f(cy - ph * 0.2)}q${f(pw * 0.2)} ${f(ph * 0.15)} ${f(pw * 0.45)} ${f(ph * 0.05)}M${f(cx - pw * 0.15)} ${f(cy + ph * 0.18)}q${f(pw * 0.15)} ${f(-ph * 0.06)} ${f(pw * 0.32)} ${f(ph * 0.08)}" stroke="#0e0806" stroke-opacity=".45" stroke-width=".6" fill="none"/>`;
    s += `<path d="M${f(x - 1)} ${f(y)}V${f(y - h - 12)}" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.45)}" stroke-width=".6"/>`;
    S.add("camp", z, s);
    shadow(S, x, x + w, h, y);
  }

  /* How the hide is worked: two long strokes down the pelt, top to bottom,
     bits falling from the knife, then three short cuts at its edge and a hard
     pull the pelt gives to. The arm is solved so the knife stays on the hide;
     the shavings and the pelt run on the worker's --t. Its classes carry no
     letter (the kit draws other ways with a letter each). */
  const FLAY = { work: "AB" };
  const FLAYS = { AB: 7.6 };
  const flayTag = (k) => (k === "AB" ? "" : k);

  // Bits of flesh and fat off the knife, falling at each stroke, in step with the worker.
  function shavingsAt(S, x, y, cls, t) {
    const r = S.rnd("shavings");
    let s = "";
    for (let i = 0; i < 6; i++) {
      const dx = -2 + r() * 4;
      const dy = 7 + r() * 8;
      s += `<g transform="translate(${f(x - 1 + r() * 2)} ${f(y - 2 + r() * 4)})"><g class="${cls}" style="--t:${f(t)}s;--dl:0s;--dx:${f(dx)}px;--dy:${f(dy)}px">` +
        `<path transform="rotate(${Math.round(r() * 360)})" d="M-.7-.3L.8-.4L.4.5Z" fill="${mix("#8a5a48", "#e8c0a0", 0.3 + r() * 0.3)}"/></g></g>`;
    }
    S.add("camp", GY + 3, s);
  }

  // The worker at the frame, and what the work throws off.
  function flayWork(S, work) {
    const tag = flayTag(work);
    const pulls = work === "AB";
    frame(S, 646, GY + 1, { w: 40, h: 38, give: pulls ? { cls: `cs-pelt${tag}`, t: FLAYS[work] } : null });
    worker(S, 636, GY + 1, { pose: "flay", flay: tag, tool: "knife", dir: 1, t: FLAYS[work] });
    shavingsAt(S, 657, GY - 22, `cs-shave${tag}`, FLAYS[work]);
  }

  // A black cauldron on stones over its own fire, steam rising.
  function vat(S, x, y, { w = 30, h = 18, z = y, steam = true } = {}) {
    S.light(x, y - 6, 60, 0.4);
    const L = S.lit(x, y - h);
    let s = `<path d="M${f(x - w / 2 - 4)} ${f(y)}q2-5 6-5h${f(w - 4)}q4 0 6 5Z" fill="#1a1214"/>` +
      `<path d="M${f(x - w / 2 - 2)} ${f(y - 4)}q1-2 4-2M${f(x + w / 2 - 2)} ${f(y - 6)}q3 0 4 2" stroke="#e8904a" stroke-opacity=".7" stroke-width=".7" fill="none"/>`;
    S.add("camp", z - 0.2, s);
    smallFlame(S, x - 5, y - 3, 0.42, "camp", z - 0.1);
    smallFlame(S, x + 6, y - 3, 0.36, "camp", z - 0.1);
    S.add("camp", z,
      `<path d="M${f(x - w / 2)} ${f(y - h)}H${f(x + w / 2)}Q${f(x + w / 2 + 1)} ${f(y - 4)} ${f(x)} ${f(y - 3.5)}Q${f(x - w / 2 - 1)} ${f(y - 4)} ${f(x - w / 2)} ${f(y - h)}Z" fill="${S.lin([[0, "#1c181e"], [1, "#0a080b"]], { x1: 0, y1: 0, x2: 0, y2: 1 })}"/>` +
      `<ellipse cx="${f(x)}" cy="${f(y - h)}" rx="${f(w / 2 + 1.5)}" ry="2.2" fill="#0c090b" stroke="${mix("#2a2226", "#c08a5a", L)}" stroke-width=".8"/>` +
      `<ellipse cx="${f(x)}" cy="${f(y - h + 0.3)}" rx="${f(w / 2 - 1)}" ry="1.4" fill="${mix("#3a2a1e", "#d8b070", 0.6)}" fill-opacity=".85"/>` +
      `<path d="M${f(x - w / 2 + 2)} ${f(y - h + 3)}Q${f(x - w / 2 + 1)} ${f(y - 8)} ${f(x - 4)} ${f(y - 5)}" stroke="#ffb05c" stroke-opacity=".45" stroke-width=".8" fill="none"/>`);
    if (steam) smoke(S, x, y - h - 2, { n: 4, size: 0.9, t: 7, dx: 16, dy: -50, op: 0.9, tone: "#b8aec4" });
  }

  // The ribs of something vast, half sunk in a far hill.
  function ribcage(S, x, y, sc = 1) {
    let d = "";
    const ribs = 8;
    for (let i = 0; i < ribs; i++) {
      const t = i / (ribs - 1);
      const rx = x + i * 13 * sc;
      const hgt = (26 + Math.sin(t * Math.PI) * 18) * sc;
      const lean = (t - 0.5) * 6 * sc;
      d += `M${f(rx - 3 * sc)} ${f(y)}Q${f(rx - 9 * sc + lean)} ${f(y - hgt * 0.7)} ${f(rx + lean)} ${f(y - hgt)}Q${f(rx + 7 * sc + lean)} ${f(y - hgt * 0.8)} ${f(rx + 6 * sc)} ${f(y - hgt * 0.35)}`;
    }
    const spine = `M${f(x - 10 * sc)} ${f(y - 30 * sc)}Q${f(x + 45 * sc)} ${f(y - 50 * sc)} ${f(x + 104 * sc)} ${f(y - 28 * sc)}`;
    S.add("far", 2, `<path d="${d}${spine}" fill="none" stroke="#2c2436" stroke-width="${f2(2.4 * sc)}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#8a7aa8" stroke-opacity=".14" stroke-width="${f2(0.6 * sc)}" transform="translate(${f2(0.8 * sc)} ${f2(-0.6 * sc)})"/>`);
  }

  // A gibbet on the ridge, cage and all.
  function gibbet(S, x, y) {
    S.add("mid", 2, `<path d="M${f(x)} ${f(y)}V${f(y - 34)}H${f(x + 14)}M${f(x)} ${f(y - 28)}L${f(x + 6)} ${f(y - 34)}" fill="none" stroke="#120e16" stroke-width="1.8"/><path d="M${f(x + 13)} ${f(y - 34)}v5" stroke="#120e16" stroke-width=".6"/>` +
      `<g transform="translate(${f(x + 13)} ${f(y - 29)})"><g class="cs-hang" style="--t:7s"><path d="M-3 0H3L3.6 9Q0 11.5-3.6 9Z" fill="none" stroke="#120e16" stroke-width=".9"/><path d="M0 0V10.6M-3.3 4.5H3.3" stroke="#120e16" stroke-width=".6"/></g></g>`);
  }

  // Antlers set on a post, with a skull.
  function antlers(x, y, s = 1, col = "#2a2230") {
    const one = (dir) => `M${f(x)} ${f(y)}q${f(dir * 5 * s)} ${f(-4 * s)} ${f(dir * 7 * s)} ${f(-12 * s)}M${f(x + dir * 3.4 * s)} ${f(y - 3.4 * s)}l${f(dir * 4 * s)} ${f(-1 * s)}M${f(x + dir * 5.6 * s)} ${f(y - 7.4 * s)}l${f(dir * 3.6 * s)} ${f(-0.4 * s)}M${f(x + dir * 6.6 * s)} ${f(y - 10.6 * s)}l${f(dir * 1.6 * s)} ${f(-2.6 * s)}`;
    return `<path d="${one(-1)}${one(1)}" fill="none" stroke="${col}" stroke-width="${f2(1.1 * s)}" stroke-linecap="round"/>` +
      `<path d="M${f(x - 2.4 * s)} ${f(y - 1 * s)}Q${f(x)} ${f(y - 4 * s)} ${f(x + 2.4 * s)} ${f(y - 1 * s)}L${f(x + 1.2 * s)} ${f(y + 4 * s)}H${f(x - 1.2 * s)}Z" fill="#8a8090"/>` +
      `<path d="M${f(x - 1.3 * s)} ${f(y + 0.2 * s)}h.9M${f(x + 0.4 * s)} ${f(y + 0.2 * s)}h.9" stroke="#0a080c" stroke-width="${f2(0.9 * s)}"/>`;
  }

  // Hides hung over a long pole rack to dry.
  function dryingRack(S, x, y, w, { z = y, n = 5 } = {}) {
    const L = S.lit(x + w / 2, y - 26);
    const post = mix("#15100e", "#5a3c29", L * 0.85);
    let s = `<path d="M${f(x)} ${f(y)}V${f(y - 34)}M${f(x + w)} ${f(y)}V${f(y - 34)}M${f(x - 2)} ${f(y - 32)}H${f(x + w + 2)}" stroke="${post}" stroke-width="2" stroke-linecap="round"/>`;
    for (let i = 0; i < n; i++) {
      const hx = x + 6 + i * ((w - 12) / (n - 1));
      const hl = 18 + (i % 3) * 3;
      const Li = S.lit(hx, y - 22);
      s += `<path d="M${f(hx - 5)} ${f(y - 32)}Q${f(hx - 6.5)} ${f(y - 32 + hl * 0.6)} ${f(hx - 4)} ${f(y - 32 + hl)}L${f(hx - 1.5)} ${f(y - 32 + hl - 3)}L${f(hx + 1)} ${f(y - 32 + hl + 1)}L${f(hx + 4.5)} ${f(y - 32 + hl - 1)}Q${f(hx + 6.5)} ${f(y - 32 + hl * 0.5)} ${f(hx + 5)} ${f(y - 32)}Z" fill="${mix(i % 2 ? "#2a1a14" : "#241612", i % 2 ? "#a86a44" : "#8a5236", Li * 0.9)}"/>`;
    }
    S.add("camp", z, s);
    shadow(S, x, x + w, 30, y);
  }

  // A tall timber-framed hall with a tall chimney: the tannery.
  function tannery(S, x, y, { w = 176, z = ZB.hall } = {}) {
    const L = S.lit(x + w, y - 30);
    const wallTop = y - 56;
    const ridgeY = y - 104;
    let s = "";
    // jettied upper storey over a lower one
    s += `<rect x="${f(x + 6)}" y="${f(y - 30)}" width="${f(w - 12)}" height="30" fill="${S.lin([[0, "#15110f"], [0.75, mix("#17120f", "#5a3a26", L * 0.5)], [1, mix("#1a1411", "#7a5034", L * 0.8)]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`;
    s += `<rect x="${f(x)}" y="${f(wallTop)}" width="${f(w)}" height="27" fill="${S.lin([[0, "#1a1512"], [0.75, mix("#1c1612", "#6a4630", L * 0.5)], [1, mix("#211913", "#8a5a3a", L * 0.8)]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`;
    // half-timbering
    let tim = `M${f(x)} ${f(wallTop)}H${f(x + w)}M${f(x)} ${f(wallTop + 27)}H${f(x + w)}M${f(x + 6)} ${f(y)}H${f(x + w - 6)}`;
    for (let xx = x; xx <= x + w; xx += 22) tim += `M${f(xx)} ${f(wallTop)}V${f(wallTop + 27)}`;
    for (let xx = x; xx < x + w - 10; xx += 44) tim += `M${f(xx)} ${f(wallTop + 27)}L${f(xx + 22)} ${f(wallTop)}M${f(xx + 22)} ${f(wallTop + 27)}L${f(xx + 44)} ${f(wallTop)}`;
    for (let xx = x + 6; xx <= x + w - 6; xx += 27) tim += `M${f(xx)} ${f(y - 30)}V${f(y)}`;
    s += `<path d="${tim}" stroke="#0b0807" stroke-width="1.6"/>`;
    // roof
    s += `<path d="${P([[x - 8, wallTop + 1], [x + 34, ridgeY], [x + w - 34, ridgeY], [x + w + 8, wallTop + 1]])}" fill="${S.lin([[0, "#1d1719"], [1, "#0c0a0d"]], { x1: 0, y1: 0, x2: 0, y2: 1 })}"/>`;
    let sl = "";
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      const yy = ridgeY + (wallTop + 1 - ridgeY) * t;
      sl += `M${f(x + 34 - 42 * t)} ${f(yy)}H${f(x + w - 34 + 42 * t)}`;
    }
    s += `<path d="${sl}" stroke="#070506" stroke-opacity=".7" stroke-width=".7"/>`;
    s += `<path d="M${f(x - 8)} ${f(wallTop + 1)}L${f(x + 34)} ${f(ridgeY)}H${f(x + w - 34)}L${f(x + w + 8)} ${f(wallTop + 1)}" fill="none" stroke="${C.rim}" stroke-opacity=".6" stroke-width=".9"/>`;
    // dormer with a lit window
    s += `<path d="${P([[x + 70, ridgeY + 30], [x + 70, ridgeY + 16], [x + 82, ridgeY + 8], [x + 94, ridgeY + 16], [x + 94, ridgeY + 30]])}" fill="#141013"/><rect x="${f(x + 77)}" y="${f(ridgeY + 17)}" width="10" height="9" fill="#f2a050"/>`;
    // windows below and above
    for (const wx of [x + 22, x + 66, x + 110, x + 154]) {
      s += `<rect x="${f(wx - 6)}" y="${f(wallTop + 7)}" width="12" height="12" fill="#e89048"/><path d="M${f(wx)} ${f(wallTop + 7)}V${f(wallTop + 19)}M${f(wx - 6)} ${f(wallTop + 13)}H${f(wx + 6)}" stroke="#1a100c" stroke-width=".9"/>`;
      S.light(wx, wallTop + 14, 45, 0.25);
    }
    // door with antlers over it
    const dx = x + w / 2;
    s += `<path d="M${f(dx - 10)} ${f(y)}V${f(y - 22)}H${f(dx + 10)}V${f(y)}Z" fill="${S.radBox([[0, "#ffd48a"], [0.6, "#e08040"], [1, "#6a2a18"]], { cx: 0.5, cy: 1, r: 1 })}"/>`;
    s += antlers(dx, y - 30, 1.6, "#2a2230");
    S.light(dx, y - 8, 70, 0.45);
    groundGlow(S, dx, 44, 0.4, y + 9);
    S.add("fx", 22, `<ellipse class="cs-lamp" cx="${f(dx)}" cy="${f(y - 8)}" rx="26" ry="18" fill="${S.rad([[0, "#ffb866", 0.3], [1, "#ffb866", 0]], dx, y - 8, 26, 0.7)}"/>`);
    // the tall chimney of the rendering room
    const cx = x + w - 30;
    s += `<path d="M${f(cx)} ${f(ridgeY + 14)}V${f(ridgeY - 30)}H${f(cx + 13)}V${f(ridgeY + 14)}Z" fill="#131015"/><path d="M${f(cx - 2)} ${f(ridgeY - 30)}h17v-4h-17Z" fill="#1a161c"/>` +
      `<path d="M${f(cx)} ${f(ridgeY - 30)}V${f(ridgeY + 14)}" stroke="${C.rim}" stroke-opacity=".4" stroke-width=".6"/>`;
    S.add("back", z, s);
    smoke(S, cx + 6.5, ridgeY - 36, { n: 6, size: 1.35, t: 14, dx: 40, dy: -54, layer: "back", z: z - 1, op: 0.95, tone: "#7a7088" });
  }

  function flaying(S) {
    const s = S.stage;
    S.fireX = HEART.fire;

    sky(S, { moon: MOON, moonR: 13, moonTint: "#efd9cf", cloudDx: -40, clouds: 3 });
    crows(S, MOON[0] - 10, MOON[1] + 4, 5);

    // the moor: long low hills, the far one with the old bones on it
    const r = S.rnd("far");
    const far = hillYs(r, { base: 132, amp: 9, waves: 3 });
    layerRidge(S, "far", 0, far, -20, 6, { fill: "#261e2e", rim: "#6a5a80", rimOp: 0.45, rimW: 0.7 });
    ribcage(S, 196, 134, 0.85);
    fog(S, "far", 1, 130, 26, 0.2);
    const r2 = S.rnd("mid");
    const mid = hillYs(r2, { base: 148, amp: 7, waves: 3 });
    layerRidge(S, "mid", 0, mid, -20, 6, { fill: "#17121c", rim: "#40345a", rimOp: 0.5, rimW: 0.7 });
    // dead trees on the heath
    const rt = S.rnd("dead");
    let dead = "";
    for (const [tx, th] of [[70, 44], [128, 30], [880, 52], [948, 36], [990, 60]]) {
      const i = Math.round((tx + 20) / 6);
      dead += treeSvg(bareTree(rt, tx, (mid[i] || 148) + 2, th, { spread: 0.8, depth: 5, lean: (rt() - 0.5) * 0.4, twist: 0.6 }), "#110d15");
    }
    S.add("mid", 1, dead);
    fog(S, "mid", 1.5, 148, 18, 0.15);

    ground(S, { top: "#201822" });
    trail(S, HEART.fire + 24, 660, GY + 5, GY + 2);
    scatter(S, { n: 40, seed: "stones" });
    scatter(S, { n: 70, seed: "heath", kind: "tuft" });
    // bones in the grass
    const rb = S.rnd("bones");
    let bones = "";
    for (let i = 0; i < 7; i++) {
      const bx = 580 + rb() * 400;
      const by = GY + 3 + rb() * 10;
      const len = 4 + rb() * 5;
      bones += `<path d="M${f(bx)} ${f(by)}l${f(len)} ${f(-0.8)}" stroke="#5a5260" stroke-opacity=".35" stroke-width="1" stroke-linecap="round"/>`;
    }
    S.add("ground", 5, bones);

    heart(S, { barrels: 258 });

    // the work: one frame at first, three once it is a proper yard
    flayWork(S, FLAY.work);
    if (s >= 4) {
      frame(S, 704, GY - 1, { w: 38, h: 36, tone: 1, z: GY - 1 });
      frame(S, 760, GY - 2, { w: 42, h: 40, z: GY - 2 });
      vat(S, 846, GY + 2, { w: 34, h: 20 });
    }
    if (s >= 3) {
      // a pot of tallow over coals, and hides folded in a pile
      vat(S, 604, GY + 4, { w: 18, h: 11, z: GY + 4 });
      const L = S.lit(610, GY);
      let pile = "";
      for (let i = 0; i < 4; i++) pile += `<path d="M${f(560 - i * 0.5)} ${f(GY + 8 - i * 3.2)}q12 -2.2 24 0v3.2q-12 1.4-24 0Z" fill="${mix(i % 2 ? "#2a1a14" : "#221410", "#a06a44", L * (0.7 + i * 0.07))}"/>`;
      S.add("camp", GY + 8, pile);
    }

    // the second crew brings hides in on a cart
    if (s >= 5) {
      cart(S, 180, GY + 5, { w: 40, load: "hides", dir: 1, wheelR: 8 });
      worker(S, 154, GY + 5, { pose: "push", dir: 1, t: 1.7, z: GY + 5.5 });
    }

    if (s >= 8) dryingRack(S, 890, GY - 2, 70, { n: 5 });
    if (s >= 9) tannery(S, 128, GY - 6);

    // antlers along the wall
    let decor = "";
    if (s >= 6) for (const ax of [40, 150, 260, 520]) decor += antlers(ax, GY - 44, 1.2, "#3a3040");
    outer(S, {
      wall: [0, 560],
      gate: 408,
      tower: HEART.tower,
      wallDecor: decor,
      banners: [[322, GY - 4, 52, GY - 34], [700, GY - 1, 46, GY - 1.5]],
      lamps: [620, 822],
    });

    foreRocks(S, "fr-flaying");
    finish(S);
  }

  return flaying;
})();

/* ================= HARVESTING ================= */
/* Harvesting: the growth. Fields under a low harvest moon, and at the
   edge of them a wall of stalks that grows too well, heads bowed, a
   few pods faintly lit. Stooks, racks, a scarecrow, the mill, the barn. */

const harvesting = (() => {
  const MOON = [166, 62];

  // One clump of tall stalks with heavy drooping heads. Sways as one.
  function clump(r, x, y, h, n) {
    let stalks = "";
    let heads = "";
    for (let i = 0; i < n; i++) {
      const sx = x + (r() - 0.5) * 10;
      const hh = h * (0.7 + r() * 0.4);
      const bend = (r() - 0.3) * 8;
      const tx = sx + bend;
      const ty = y - hh;
      stalks += `M${f(sx)} ${f(y)}Q${f(sx + bend * 0.2)} ${f(y - hh * 0.6)} ${f(tx)} ${f(ty)}`;
      // the head droops over to one side
      const dir = bend >= 0 ? 1 : -1;
      heads += `M${f(tx)} ${f(ty)}q${f(dir * 3)} ${f(-2)} ${f(dir * 5.5)} ${f(2.5)}q${f(dir * 1.5)} ${f(3.5)} ${f(dir * 0.5)} ${f(7)}q${f(-dir * 1.6)} ${f(-3)} ${f(-dir * 2.6)} ${f(-5.5)}q${f(-dir * 1.6)} ${f(-1.6)} ${f(-dir * 3.4)} ${f(-4)}Z`;
    }
    return { stalks, heads };
  }

  // The wall of growth from x0 to x1, in two depths, swaying. Some pods glow.
  function growth(S, x0, x1, { h = 52, base = GY + 2, z = GY - 2, glow = true } = {}) {
    const r = S.rnd(`growth${x0}`);
    const far = [];
    const near = [];
    for (let x = x0; x < x1; x += 7 + r() * 6) far.push(clump(r, x, base - 3, h * 0.9, 3));
    for (let x = x0 + 4; x < x1; x += 9 + r() * 8) near.push(clump(r, x, base, h, 3));
    const draw = (list, col, headCol, rimOp, zz, cls) => {
      let s = "";
      list.forEach((c, i) => {
        s += `<g class="cs-sway" style="--dl:${f(-(i * 0.37) % 4)}s;--t:${f(4 + (i % 5) * 0.4)}s;transform-origin:0 ${f(base)}px">` +
          `<path d="${c.stalks}" fill="none" stroke="${col}" stroke-width="1.1" stroke-linecap="round"/><path d="${c.heads}" fill="${headCol}" stroke="#c9b27a" stroke-opacity="${f2(rimOp)}" stroke-width=".4"/></g>`;
      });
      S.add("camp", zz, s);
    };
    draw(far, "#141217", "#17141a", 0.12, z - 1);
    draw(near, "#0e0c10", "#110f13", 0.2, z);
    if (glow) {
      let pods = "";
      for (let i = 0; i < 16; i++) {
        const px = x0 + 10 + r() * (x1 - x0 - 20);
        const py = base - 12 - r() * h * 0.7;
        const rr = 1 + r() * 1.2;
        pods += `<circle class="cs-lamp" cx="${f(px)}" cy="${f(py)}" r="${f(rr * 4)}" fill="${S.rad([[0, "#d8e07a", 0.28], [1, "#d8e07a", 0]], px, py, rr * 4)}" style="--dl:${f(-r() * 3)}s"/><circle cx="${f(px)}" cy="${f(py)}" r="${f2(rr * 0.6)}" fill="#e8ec9a" fill-opacity=".8"/>`;
      }
      S.add("camp", z + 0.1, pods);
    }
  }

  // Motes that drift up out of the growth and fade.
  function motes(S, x0, x1, n = 14) {
    const r = S.rnd("motes");
    let s = "";
    for (let i = 0; i < n; i++) {
      const x = x0 + r() * (x1 - x0);
      const y = GY - 10 - r() * 40;
      const t = 6 + r() * 6;
      s += `<circle class="cs-spark" cx="${f(x)}" cy="${f(y)}" r="${f2(0.5 + r() * 0.5)}" fill="#e0e890" style="--dl:${f(-r() * t)}s;--t:${f(t)}s;--dx:${f((r() - 0.5) * 30)}px;--dy:${f(-20 - r() * 30)}px"/>`;
    }
    S.add("fx", 30, s);
  }

  // A bound sheaf lying down, or a stook of them standing.
  function sheafLying(S, x, y, { z = y, dir = 1 } = {}) {
    const L = S.lit(x, y - 3);
    const col = mix("#2a2616", "#b89a5a", L * 0.9);
    S.add("camp", z, `<path d="M${f(x)} ${f(y)}l${f(dir * 22)} -3.4l${f(dir * 2)} 2.6l${f(-dir * 22)} 3.4Z" fill="${col}"/><path d="M${f(x + dir * 20)} ${f(y - 3.2)}l${f(dir * 5)} -3M${f(x + dir * 21)} ${f(y - 2)}l${f(dir * 6)} -1M${f(x + dir * 21)} ${f(y - 1)}l${f(dir * 5)} 2" stroke="${col}" stroke-width=".8"/><path d="M${f(x + dir * 9)} ${f(y - 1.6)}l${f(dir * 0.6)} 3.2" stroke="#1a1410" stroke-width="1"/>`);
  }

  function stook(S, x, y, { h = 22, z = y } = {}) {
    const L = S.lit(x, y - h / 2);
    const col = S.lin([[0, mix("#2e2a18", "#c8a860", L * 0.95)], [1, mix("#141208", "#5a4a26", L * 0.6)]], { x1: 0, y1: 0, x2: 1, y2: 1 });
    let blades = "";
    for (let i = 0; i < 9; i++) {
      const bx = x - 8 + i * 2;
      blades += `M${f(bx)} ${f(y)}L${f(x + (bx - x) * 0.18)} ${f(y - h)}`;
    }
    S.add("camp", z, `<path d="M${f(x - 9)} ${f(y)}L${f(x - 1)} ${f(y - h)}L${f(x + 1)} ${f(y - h - 3)}L${f(x + 2)} ${f(y - h)}L${f(x + 9)} ${f(y)}Z" fill="${col}"/>` +
      `<path d="${blades}" stroke="#0e0c08" stroke-opacity=".4" stroke-width=".45"/>` +
      `<path d="M${f(x - 4.4)} ${f(y - h * 0.55)}H${f(x + 4.6)}" stroke="#1a140e" stroke-width="1"/>` +
      `<path d="M${f(x - 1)} ${f(y - h)}l-2.6 -3.6M${f(x + 0.6)} ${f(y - h - 1)}l.4 -4M${f(x + 1.6)} ${f(y - h)}l3 -3" stroke="${mix("#2e2a18", "#c8a860", L)}" stroke-width=".6"/>`);
    shadow(S, x - 9, x + 9, h, y);
  }

  // Bundles hung upside down from a pole rack to dry.
  function bundleRack(S, x, y, w, { z = y, n = 6 } = {}) {
    const L = S.lit(x + w / 2, y - 24);
    const post = mix("#15100e", "#5a3c29", L * 0.85);
    let s = `<path d="M${f(x)} ${f(y)}L${f(x + 6)} ${f(y - 34)}L${f(x + 12)} ${f(y)}M${f(x + w - 12)} ${f(y)}L${f(x + w - 6)} ${f(y - 34)}L${f(x + w)} ${f(y)}" stroke="${post}" stroke-width="1.8" fill="none" stroke-linecap="round"/>` +
      `<path d="M${f(x + 2)} ${f(y - 32)}H${f(x + w - 2)}" stroke="${post}" stroke-width="1.8"/>`;
    for (let i = 0; i < n; i++) {
      const bx = x + 12 + i * ((w - 24) / (n - 1));
      const Li = S.lit(bx, y - 24);
      const col = mix(i % 2 ? "#26241a" : "#2c2a1c", "#b0985a", Li * 0.85);
      s += `<path d="M${f(bx)} ${f(y - 32)}v3" stroke="#2a221e" stroke-width=".5"/><path d="M${f(bx - 1.6)} ${f(y - 29)}H${f(bx + 1.6)}L${f(bx + 4)} ${f(y - 16)}L${f(bx + 1)} ${f(y - 18)}L${f(bx)} ${f(y - 14)}L${f(bx - 1)} ${f(y - 18)}L${f(bx - 4)} ${f(y - 16)}Z" fill="${col}"/>`;
    }
    S.add("camp", z, s);
    shadow(S, x, x + w, 30, y);
  }

  // A scarecrow in the rows, a lamp on its arm.
  function scarecrow(S, x, y, { z = y } = {}) {
    const s = `<path d="M${f(x)} ${f(y)}V${f(y - 46)}M${f(x - 15)} ${f(y - 34)}L${f(x + 15)} ${f(y - 36)}" stroke="#141014" stroke-width="1.8"/>` +
      `<path d="M${f(x - 12)} ${f(y - 35)}L${f(x + 12)} ${f(y - 36.5)}L${f(x + 8)} ${f(y - 16)}L${f(x + 4)} ${f(y - 19)}L${f(x + 1)} ${f(y - 13)}L${f(x - 3)} ${f(y - 19)}L${f(x - 7)} ${f(y - 15)}Z" fill="#141014"/>` +
      `<path d="M${f(x - 5)} ${f(y - 41)}Q${f(x)} ${f(y - 47)} ${f(x + 5)} ${f(y - 41)}Q${f(x + 5)} ${f(y - 36)} ${f(x)} ${f(y - 35.5)}Q${f(x - 5)} ${f(y - 36)} ${f(x - 5)} ${f(y - 41)}Z" fill="#1a1618"/>` +
      `<path d="M${f(x - 9)} ${f(y - 43)}H${f(x + 9)}L${f(x + 4)} ${f(y - 46)}L${f(x + 1)} ${f(y - 53)}L${f(x - 4)} ${f(y - 46)}Z" fill="#100c10"/>` +
      `<path d="M${f(x - 2.4)} ${f(y - 40)}h1.4M${f(x + 1)} ${f(y - 40)}h1.4" stroke="#e8c070" stroke-opacity=".6" stroke-width=".8"/>` +
      `<path d="M${f(x - 12)} ${f(y - 43.5)}H${f(x + 9)}" stroke="${C.rim}" stroke-opacity=".5" stroke-width=".6"/>`;
    S.add("camp", z, s);
  }

  // A tower mill standing out in the far field: a tapered tower, a cap, four sails turning.
  function windmill(S, x, y, { z = ZB.landmark } = {}) {
    const topY = y - 74;
    const L = S.lit(x, y - 40);
    let s = `<path d="${P([[x - 15, y], [x + 15, y], [x + 9.5, topY], [x - 9.5, topY]])}" fill="${S.lin([[0, "#2a2330"], [0.45, "#1b161f"], [1, "#100d13"]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`;
    let courses = "";
    for (let yy = topY + 6; yy < y; yy += 5) {
      const t = (yy - topY) / (y - topY);
      const hw = 9.5 + 5.5 * t;
      courses += `M${f(x - hw)} ${f(yy)}H${f(x + hw)}`;
    }
    s += `<path d="${courses}" stroke="#08070a" stroke-opacity=".45" stroke-width=".5"/>`;
    s += `<path d="M${f(x - 15)} ${f(y)}L${f(x - 9.5)} ${f(topY)}" stroke="#8a7aa8" stroke-opacity=".45" stroke-width=".7"/>`;
    s += `<rect x="${f(x - 3)}" y="${f(topY + 18)}" width="6" height="8" rx="3" fill="#f2a050"/><rect x="${f(x - 2.5)}" y="${f(topY + 40)}" width="5" height="7" fill="#e08a44" fill-opacity=".85"/>`;
    S.add("fx", 23, `<circle class="cs-lamp" cx="${f(x)}" cy="${f(topY + 22)}" r="13" fill="${S.rad([[0, "#ffb866", 0.35], [1, "#ffb866", 0]], x, topY + 22, 13)}"/>`);
    // the cap
    s += `<path d="M${f(x - 13)} ${f(topY + 1)}Q${f(x - 12)} ${f(topY - 13)} ${f(x)} ${f(topY - 15)}Q${f(x + 12)} ${f(topY - 13)} ${f(x + 13)} ${f(topY + 1)}Z" fill="#17131b"/>` +
      `<path d="M${f(x - 13)} ${f(topY + 1)}Q${f(x - 12)} ${f(topY - 13)} ${f(x)} ${f(topY - 15)}" fill="none" stroke="#8a7aa8" stroke-opacity=".55" stroke-width=".7"/>`;
    // four sails, a lattice of spars with cloth on it
    const hub = [x, topY - 5];
    let frame = "";
    let cloth = "";
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.35;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const px = -uy;
      const py = ux;
      const r0 = 7;
      const r1 = 52;
      const w = 10;
      const q = [[ux * r0, uy * r0], [ux * r1, uy * r1], [ux * r1 + px * w, uy * r1 + py * w], [ux * r0 + px * w * 0.6, uy * r0 + py * w * 0.6]];
      frame += `M0 0L${f(ux * r1)} ${f(uy * r1)}M${q.map(([a1, b1]) => `${f(a1)} ${f(b1)}`).join("L")}Z`;
      for (let k = 1; k < 7; k++) {
        const t = r0 + (r1 - r0) * (k / 7);
        const ww = w * (0.6 + 0.4 * (k / 7));
        frame += `M${f(ux * t)} ${f(uy * t)}l${f(px * ww)} ${f(py * ww)}`;
      }
      cloth += `M${q.map(([a1, b1]) => `${f(a1)} ${f(b1)}`).join("L")}Z`;
    }
    s += `<g transform="translate(${f(hub[0])} ${f(hub[1])})"><g class="cs-sail" style="--t:30s"><path d="${cloth}" fill="#3a3346" fill-opacity=".55"/><path d="${frame}" fill="none" stroke="#221c28" stroke-width="1"/></g><circle r="2.6" fill="#221c28"/></g>`;
    S.add("back", z, s);
    S.light(x, topY + 22, 36, 0.2);
  }

  // A tithe barn: a huge steep roof on low buttressed walls, doors open to the light.
  function titheBarn(S, x, y, { w = 200, z = ZB.hall } = {}) {
    const L = S.lit(x + w, y - 20);
    const wallTop = y - 26;
    const ridgeY = y - 86;
    let s = "";
    s += `<rect x="${f(x + 6)}" y="${f(wallTop)}" width="${f(w - 12)}" height="${f(y - wallTop)}" fill="${S.lin([[0, "#16121a"], [0.7, mix("#17131a", "#4a3a30", L * 0.5)], [1, mix("#1a1517", "#6a5040", L * 0.8)]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`;
    let bl = "";
    for (let yy = wallTop + 5; yy < y; yy += 5) bl += `M${f(x + 6)} ${f(yy)}H${f(x + w - 6)}`;
    s += `<path d="${bl}" stroke="#08070a" stroke-opacity=".4" stroke-width=".5"/>`;
    for (const bx of [x + 6, x + 52, x + w - 56, x + w - 12]) s += `<path d="${P([[bx, y], [bx, wallTop + 2], [bx + 5, wallTop + 6], [bx + 8, y]])}" fill="#141117"/>`;
    // the roof, thatched, falling almost to the ground at the ends
    const roof = [[x - 10, wallTop + 4], [x + 60, ridgeY], [x + w - 60, ridgeY], [x + w + 10, wallTop + 4]];
    s += `<path d="${P(roof)}" fill="${S.lin([[0, "#2e2622"], [0.5, "#1e1819"], [1, "#100c0e"]], { x1: 0, y1: 0, x2: 0, y2: 1 })}"/>`;
    s += `<path d="${P([roof[0], roof[1], [roof[1][0] + 30, roof[1][1]], [roof[0][0] + 50, roof[0][1]]])}" fill="${S.lin([[0, "#8a7aa8", 0.14], [1, "#8a7aa8", 0]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`;
    const r = S.rnd("thatch");
    let th = "";
    for (let i = 0; i < 160; i++) {
      const t = r();
      const u = r();
      const yy = ridgeY + (wallTop + 4 - ridgeY) * t;
      const xl = x + 60 - 70 * t;
      const xr = x + w - 60 + 70 * t;
      const xx = xl + (xr - xl) * u;
      th += `M${f(xx)} ${f(yy)}l${f((u - 0.5) * 3)} 4`;
    }
    s += `<path d="${th}" stroke="#070506" stroke-opacity=".55" stroke-width=".5"/><path d="${th}" stroke="#6a5a50" stroke-opacity=".12" stroke-width=".5" transform="translate(.6 -.5)"/>`;
    s += `<path d="M${f(roof[0][0])} ${f(roof[0][1])}L${f(roof[1][0])} ${f(roof[1][1])}H${f(roof[2][0])}L${f(roof[3][0])} ${f(roof[3][1])}" fill="none" stroke="${C.rim}" stroke-opacity=".55" stroke-width=".9"/>`;
    // an owl hole in the gable
    s += `<circle cx="${f(x + w / 2)}" cy="${f(ridgeY + 20)}" r="3" fill="#050406"/>`;
    // wide doors open on a lit threshing floor
    const dx = x + w / 2;
    s += `<path d="M${f(dx - 17)} ${f(y)}V${f(y - 34)}H${f(dx + 17)}V${f(y)}Z" fill="${S.radBox([[0, "#ffd48a"], [0.6, "#e08a44"], [1, "#6a2a18"]], { cx: 0.5, cy: 1, r: 1 })}"/>` +
      `<path d="${P([[dx - 17, y], [dx - 17, y - 34], [dx - 28, y - 32], [dx - 28, y + 1]])}" fill="#1a1416"/><path d="${P([[dx + 17, y], [dx + 17, y - 34], [dx + 28, y - 32], [dx + 28, y + 1]])}" fill="#141013"/>` +
      `<path d="M${f(dx - 20)} ${f(y - 36)}Q${f(dx)} ${f(y - 44)} ${f(dx + 20)} ${f(y - 36)}" fill="none" stroke="#141013" stroke-width="3"/>`;
    S.light(dx, y - 10, 90, 0.5);
    groundGlow(S, dx, 60, 0.45, y + 9);
    S.add("fx", 22, `<ellipse class="cs-lamp" cx="${f(dx)}" cy="${f(y - 12)}" rx="34" ry="22" fill="${S.rad([[0, "#ffb866", 0.3], [1, "#ffb866", 0]], dx, y - 12, 34, 0.65)}"/>`);
    S.add("back", z, s);
  }

  function harvesting(S) {
    const s = S.stage;
    S.fireX = HEART.fire;

    sky(S, { moon: MOON, moonR: 15, moonTint: "#f2dcae", cloudDx: 34, clouds: 3 });

    // rolling country: far hills with hedgerow trees, then field bands
    const r = S.rnd("far");
    const far = hillYs(r, { base: 128, amp: 12, waves: 3 });
    layerRidge(S, "far", 0, far, -20, 6, { fill: "#2a2130", rim: "#7a6a86", rimOp: 0.4, rimW: 0.7 });
    let clumps = "";
    for (let x = -10; x < 1010; x += 18 + r() * 40) {
      const i = Math.round((x + 20) / 6);
      const y = far[i] || 128;
      const w = 5 + r() * 9;
      clumps += `M${f(x - w)} ${f(y + 2)}Q${f(x - w)} ${f(y - w * 0.9)} ${f(x)} ${f(y - w)}Q${f(x + w)} ${f(y - w * 0.9)} ${f(x + w)} ${f(y + 2)}Z`;
    }
    S.add("far", 0.5, `<path d="${clumps}" fill="#221b28"/>`);
    fog(S, "far", 1, 128, 26, 0.2, "#a08a9a");
    const r2 = S.rnd("mid");
    const mid = hillYs(r2, { base: 144, amp: 5, waves: 2 });
    layerRidge(S, "mid", 0, mid, -20, 6, { fill: "#1d1720", rim: "#50445e", rimOp: 0.45, rimW: 0.7 });
    // field bands with furrows
    let bands = "";
    for (let k = 0; k < 4; k++) {
      const y0 = 146 + k * 3.4;
      bands += `<path d="M-20 ${f(y0)}Q500 ${f(y0 - 2 + k)} 1020 ${f(y0 + 1)}V${f(y0 + 3.4)}Q500 ${f(y0 + 1.4 + k)} -20 ${f(y0 + 3.4)}Z" fill="${k % 2 ? "#1a1519" : "#211a1d"}"/>`;
    }
    S.add("mid", 1, bands);
    // a lone tree on the rise
    const rl = S.rnd("lone");
    S.add("mid", 2, treeSvg(bareTree(rl, 64, 144, 46, { spread: 0.9, depth: 5, twist: 0.5 }), "#141016"));
    fog(S, "mid", 3, 148, 16, 0.14, "#a08a9a");

    ground(S, { top: "#221b22" });
    trail(S, HEART.fire + 24, 640, GY + 5, GY + 2);
    scatter(S, { n: 30, seed: "stones" });
    scatter(S, { n: 90, seed: "stubble", kind: "tuft" });

    heart(S, { barrels: 258 });

    // the growth: it starts at the camp's edge, and is cut back a little as the work grows
    const edge = s >= 4 ? 772 : 662;
    growth(S, edge, 1020, { h: 54 });
    motes(S, edge, 1000, 16);
    // cut stalks and sheaves where the reaping is
    sheafLying(S, edge - 44, GY + 6, { dir: 1 });
    sheafLying(S, edge - 30, GY + 9, { dir: -1 });
    worker(S, edge - 14, GY + 2, { pose: "reap", tool: "sickle", dir: 1, t: 2.3 });

    if (s >= 3) {
      stook(S, 604, GY + 3, { h: 28 });
      stook(S, 628, GY + 1, { h: 26, z: GY + 1 });
      if (s >= 4) stook(S, 652, GY + 4, { h: 29, z: GY + 4 });
    }
    if (s >= 4) {
      bundleRack(S, 676, GY - 1, 68, { n: 6, z: GY - 1 });
      scarecrow(S, 880, GY + 2, { z: GY + 3 });
    }

    // the second crew brings in a wain piled with sheaves
    if (s >= 5) {
      cart(S, 176, GY + 5, { w: 44, load: "hay", dir: 1, wheelR: 8 });
      worker(S, 150, GY + 5, { pose: "push", dir: 1, t: 1.7, z: GY + 5.5 });
    }

    if (s >= 8) windmill(S, 908, GY - 12);
    if (s >= 9) titheBarn(S, 120, GY - 6);

    outer(S, {
      wall: [0, 570],
      gate: 408,
      wallStyle: "wattle",
      tower: HEART.tower,
      banners: [[322, GY - 4, 52, GY - 34], [690, GY, 46, GY]],
      lamps: [594, 760],
    });

    foreRocks(S, "fr-harvest", { tone: "#080609" });
    finish(S);
  }

  return harvesting;
})();

/* ================= DREDGING ================= */
/* Dredging: the waters. The camp on the shore of a black lake, the moon
   laid across it. A pole and a sieve first, then the jetty, the punt,
   the crane, lamps doubled in the water, and a hall on stilts. */

const dredging = (() => {
  const MOON = [846, 34];
  const SHORE = 150; // the far shore's waterline
  const EDGE = 598;  // where the near bank meets the water

  // The water: the lake from the near bank to the far shore, and a strip along the foot of the frame.
  function water(S) {
    const g = S.lin([[0, "#26243c"], [0.1, "#15172a"], [0.5, "#0c0e1a"], [1, "#07080f"]], { x1: 0, y1: SHORE, x2: 0, y2: 200, user: true });
    // the bank curves from the camp down to the foot of the frame
    const bank = `M${EDGE - 40} 210L${EDGE - 30} 190Q${EDGE - 12} ${GY + 6} ${EDGE + 10} ${GY + 1}Q${EDGE + 30} ${GY - 4} ${EDGE + 60} ${SHORE + 4}L1030 ${SHORE}V210Z`;
    S.add("ground", 6, `<path d="${bank}" fill="${g}"/>`);
    // the far shore's light on the water
    S.add("ground", 6.1, `<rect x="${EDGE}" y="${SHORE}" width="${1000 - EDGE}" height="6" fill="${S.lin([[0, "#6a5a8a", 0.25], [1, "#6a5a8a", 0]], { x1: 0, y1: 0, x2: 0, y2: 1 })}"/>`);
    // ripples
    const r = S.rnd("ripples");
    let rip = "";
    for (let i = 0; i < 70; i++) {
      const y = SHORE + 3 + Math.pow(r(), 1.3) * 48;
      const x = EDGE + 30 + r() * (1000 - EDGE - 30);
      if (x < EDGE + 60 && y < GY) continue;
      const w = 4 + r() * 22 * (0.5 + (y - SHORE) / 50);
      rip += `M${f(x)} ${f(y)}h${f(w)}`;
    }
    S.add("ground", 6.2, `<g class="cs-fog" style="--dl:-12s"><path d="${rip}" stroke="#9a9ad0" stroke-opacity=".22" stroke-width=".6"/></g>`);
    // the moon laid across the water in a broken column
    const [mx] = MOON;
    let col = "";
    for (let i = 0; i < 26; i++) {
      const y = SHORE + 2 + i * 1.9 + r() * 0.8;
      const w = (4 + r() * 11) * (0.6 + i / 26);
      const a = 0.75 * (1 - i / 30);
      col += `<path class="cs-shimmer" d="M${f(mx - w / 2 + (r() - 0.5) * 6)} ${f(y)}h${f(w)}" stroke="#e8e2f4" stroke-opacity="${f2(a)}" stroke-width="${f2(0.7 + r() * 0.5)}" style="--dl:${f(-r() * 3)}s;--t:${f(1.6 + r() * 2)}s"/>`;
    }
    S.add("ground", 6.3, col);
  }

  // A warm light's reflection: a trembling streak straight down on the water.
  function reflectLight(S, x, yTop, len, { w = 3, op = 0.55, col = "#ffb866" } = {}) {
    const g = S.lin([[0, col, op], [1, col, 0]], { x1: 0, y1: 0, x2: 0, y2: 1 });
    let s = "";
    for (let i = 0; i < 6; i++) {
      const y = yTop + i * (len / 6);
      const ww = w * (1.4 - i * 0.12) * (i % 2 ? 0.7 : 1.1);
      s += `<rect class="cs-shimmer" x="${f(x - ww / 2)}" y="${f(y)}" width="${f(ww)}" height="${f(len / 6 * 0.7)}" fill="${g}" style="--dl:${f(-i * 0.4)}s;--t:${f(1.4 + (i % 3) * 0.5)}s"/>`;
    }
    S.add("ground", 7, s);
  }

  // A shape mirrored in the water about line y0, fading with depth.
  function reflect(S, svg, y0, { op = 0.35, fade = 30 } = {}) {
    const id = S.uid("rf");
    S.def(`<linearGradient id="${id}g" x1="0" y1="${f(y0)}" x2="0" y2="${f(y0 + fade)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="${f2(op)}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="${id}"><rect x="0" y="${f(y0)}" width="1000" height="${f(fade + 2)}" fill="url(#${id}g)"/></mask>`);
    S.add("ground", 6.6, `<g mask="url(#${id})"><g transform="translate(0 ${f(y0 * 2)}) scale(1 -1)">${svg}</g></g>`);
  }

  // Reeds and bulrushes in clumps along the water.
  function reeds(S, x0, x1, y, { n = 10, h = 20, z = y, seed = "reeds", layer = "camp" } = {}) {
    const r = S.rnd(seed);
    let stems = "";
    let heads = "";
    for (let i = 0; i < n; i++) {
      const x = x0 + r() * (x1 - x0);
      const k = 3 + Math.floor(r() * 4);
      for (let j = 0; j < k; j++) {
        const sx = x + (r() - 0.5) * 6;
        const hh = h * (0.6 + r() * 0.6);
        const bend = (r() - 0.5) * 6;
        stems += `M${f(sx)} ${f(y)}q${f(bend * 0.3)} ${f(-hh * 0.5)} ${f(bend)} ${f(-hh)}`;
        if (r() < 0.4) heads += `<rect x="${f(sx + bend - 1)}" y="${f(y - hh + 1)}" width="2" height="5" rx="1" fill="#16121a"/>`;
      }
    }
    S.add(layer, z, `<g class="cs-sway" style="--t:5s;transform-origin:0 ${f(y)}px"><path d="${stems}" fill="none" stroke="#120f16" stroke-width=".8" stroke-linecap="round"/>${heads}</g>`);
  }

  // Sieve trays on a trestle, a few shards in them glowing violet.
  function sieves(S, x, y, { z = y } = {}) {
    const L = S.lit(x + 16, y - 10);
    const wood = mix("#15100e", "#6a4630", L * 0.85);
    let s = `<path d="M${f(x + 2)} ${f(y)}L${f(x + 6)} ${f(y - 12)}M${f(x + 10)} ${f(y)}L${f(x + 6)} ${f(y - 12)}M${f(x + 26)} ${f(y)}L${f(x + 30)} ${f(y - 12)}M${f(x + 34)} ${f(y)}L${f(x + 30)} ${f(y - 12)}" stroke="${wood}" stroke-width="1.4"/>` +
      `<path d="${P([[x - 2, y - 12], [x + 38, y - 12], [x + 36, y - 16], [x, y - 16]])}" fill="${mix("#1a1412", "#6a4630", L * 0.8)}"/>` +
      `<path d="M${f(x)} ${f(y - 16)}H${f(x + 36)}" stroke="${C.woodR}" stroke-opacity="${f2(L * 0.5)}" stroke-width=".6"/>`;
    const r = S.rnd(`sv${x}`);
    let glow = "";
    for (let i = 0; i < 5; i++) {
      const gx = x + 4 + r() * 28;
      const gy = y - 16.6;
      glow += `<path d="M${f(gx)} ${f(gy)}l.9 -2.6l.9 2.6Z" fill="${C.violetHi}"/><circle class="cs-lamp" cx="${f(gx + 0.9)}" cy="${f(gy - 1)}" r="5" fill="${S.rad([[0, "#b9a4f2", 0.45], [1, "#b9a4f2", 0]], gx + 0.9, gy - 1, 5)}" style="--dl:${f(-r() * 3)}s"/>`;
    }
    S.add("camp", z, s + glow);
    shadow(S, x, x + 36, 14, y);
  }

  // The jetty: planks on piles out over the water.
  function jetty(S, x0, x1, y, { z = GY - 1 } = {}) {
    const L = S.lit(x0 + 30, y);
    let s = "";
    let piles = "";
    for (let x = x0 + 10; x <= x1; x += 26) piles += `M${f(x)} ${f(y - 2)}V${f(y + 22)}`;
    s += `<path d="${piles}" stroke="#141012" stroke-width="3"/>`;
    s += `<path d="M${f(x0)} ${f(y)}H${f(x1 + 4)}" stroke="${mix("#1d1613", "#6a4630", L * 0.8)}" stroke-width="3.6"/>`;
    let planks = "";
    for (let x = x0; x < x1; x += 4.2) planks += `M${f(x)} ${f(y - 1.6)}v3.2`;
    s += `<path d="${planks}" stroke="#0a0708" stroke-opacity=".6" stroke-width=".5"/>`;
    s += `<path d="M${f(x0)} ${f(y - 1.8)}H${f(x1 + 4)}" stroke="${C.woodR}" stroke-opacity="${f2(0.1 + L * 0.5)}" stroke-width=".6"/>`;
    S.add("camp", z, s);
    reflect(S, `<path d="${piles}" stroke="#141012" stroke-width="3"/><path d="M${f(x0)} ${f(y)}H${f(x1 + 4)}" stroke="#2a201c" stroke-width="3.6"/>`, y + 22, { op: 0.4, fade: 20 });
  }

  // An A-frame at the jetty's end with a net hung to drip.
  function netFrame(S, x, y, { z = GY - 2 } = {}) {
    const L = S.lit(x, y - 20);
    const wood = mix("#15100e", "#5a3c29", L * 0.8);
    let s = `<path d="M${f(x - 12)} ${f(y)}L${f(x)} ${f(y - 40)}L${f(x + 12)} ${f(y)}" stroke="${wood}" stroke-width="2" fill="none"/>` +
      `<path d="M${f(x)} ${f(y - 40)}L${f(x + 26)} ${f(y - 34)}" stroke="${wood}" stroke-width="1.8"/>`;
    // the net, a bag of mesh hanging from the arm
    let mesh = "";
    for (let i = 0; i <= 5; i++) mesh += `M${f(x + 18 + i * 2.4)} ${f(y - 35)}Q${f(x + 20 + i * 1.6)} ${f(y - 22)} ${f(x + 23 + i * 0.3)} ${f(y - 12)}`;
    for (let j = 1; j <= 5; j++) mesh += `M${f(x + 18 + j * 0.6)} ${f(y - 35 + j * 4.6)}Q${f(x + 25)} ${f(y - 33 + j * 4.6)} ${f(x + 30 - j * 1.2)} ${f(y - 35 + j * 4.6)}`;
    s += `<path d="${mesh}" fill="none" stroke="#2a2430" stroke-width=".5"/>`;
    S.add("camp", z, s);
  }

  // Nets hung out to dry on a line of poles.
  function netPoles(S, x, y, { n = 4, gap = 40, z = GY - 8 } = {}) {
    let s = "";
    for (let i = 0; i < n; i++) {
      const px = x + i * gap;
      const L = S.lit(px, y - 20);
      s += `<path d="M${f(px)} ${f(y)}V${f(y - 36)}" stroke="${mix("#15100e", "#5a3c29", L * 0.8)}" stroke-width="1.8"/>`;
      if (i < n - 1) {
        let mesh = `M${f(px)} ${f(y - 34)}Q${f(px + gap / 2)} ${f(y - 26)} ${f(px + gap)} ${f(y - 34)}`;
        for (let k = 1; k < 8; k++) {
          const t = k / 8;
          const mx = px + gap * t;
          const top = y - 34 + Math.sin(t * Math.PI) * 8;
          mesh += `M${f(mx)} ${f(top)}L${f(mx + (t - 0.5) * 3)} ${f(top + 16 - Math.abs(t - 0.5) * 8)}`;
        }
        for (let k = 1; k < 4; k++) mesh += `M${f(px + 3)} ${f(y - 34 + k * 5)}Q${f(px + gap / 2)} ${f(y - 26 + k * 4)} ${f(px + gap - 3)} ${f(y - 34 + k * 5)}`;
        s += `<path d="${mesh}" fill="none" stroke="#2a2432" stroke-width=".55"/>`;
      }
    }
    S.add("camp", z, s);
  }

  // A small boat, moored or poled.
  function boat(S, x, y, { w = 44, z = y, pole = false } = {}) {
    const L = S.lit(x + w / 2, y - 4);
    const hull = `M${f(x)} ${f(y - 6)}Q${f(x + 4)} ${f(y + 1)} ${f(x + 12)} ${f(y + 1)}H${f(x + w - 10)}Q${f(x + w - 3)} ${f(y + 1)} ${f(x + w + 2)} ${f(y - 7)}L${f(x + w - 2)} ${f(y - 5)}H${f(x + 3)}Z`;
    const s = `<g class="cs-bob" style="--t:3.4s"><path d="${hull}" fill="${S.lin([[0, mix("#1f1714", "#6a4630", L * 0.8)], [1, "#0c0909"]], { x1: 0, y1: 0, x2: 0, y2: 1 })}"/>` +
      `<path d="M${f(x + 3)} ${f(y - 5)}H${f(x + w - 2)}" stroke="${C.woodR}" stroke-opacity="${f2(0.1 + L * 0.5)}" stroke-width=".6"/></g>`;
    S.add("camp", z, s);
    reflect(S, `<path d="${hull}" fill="#221a18"/>`, y + 1.5, { op: 0.35, fade: 12 });
  }

  // A dredging crane on the jetty: a mast, a jib, a bucket on a chain.
  function dredgeCrane(S, x, y, { z = GY - 3 } = {}) {
    const L = S.lit(x, y - 30);
    const wood = mix("#15100e", "#5a3c29", L * 0.85);
    const top = y - 84;
    const jx = x + 58;
    const jy = y - 66;
    let s = `<path d="M${f(x - 10)} ${f(y)}L${f(x)} ${f(top)}L${f(x + 10)} ${f(y)}M${f(x - 6)} ${f(y - 24)}H${f(x + 6)}M${f(x - 3)} ${f(y - 52)}H${f(x + 3)}" stroke="${wood}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
      `<path d="M${f(x)} ${f(y - 16)}L${f(jx)} ${f(jy)}" stroke="${wood}" stroke-width="2"/>` +
      `<path d="M${f(x)} ${f(top + 1)}L${f(jx)} ${f(jy)}M${f(x)} ${f(top + 1)}L${f(x - 40)} ${f(y + 1)}" stroke="#2a221e" stroke-width=".6"/>` +
      `<circle cx="${f(x - 6)}" cy="${f(y - 8)}" r="3.4" fill="none" stroke="${wood}" stroke-width="1.2"/>`;
    s += `<g transform="translate(${f(jx)} ${f(jy)})"><g class="cs-hang" style="--t:4.6s"><path d="M0 0V26" stroke="#2a221e" stroke-width=".6"/><path d="M-5 26H5L4 33H-4Z" fill="#141013"/><path d="M-5 26H5" stroke="${C.violetHi}" stroke-opacity=".5" stroke-width=".6"/></g></g>`;
    S.add("camp", z, s);
  }

  // A hall on stilts over the water, its windows doubled below it.
  function stiltHall(S, x, y, { w = 176, z = ZB.hall } = {}) {
    const floor = y - 16;
    const wallTop = floor - 34;
    const ridgeY = floor - 78;
    const L = 0.2;
    let piles = "";
    for (let xx = x + 6; xx <= x + w - 6; xx += 20) piles += `M${f(xx)} ${f(floor)}V${f(y + 20)}`;
    let s = `<path d="${piles}" stroke="#110e12" stroke-width="3.6"/>` +
      `<path d="M${f(x + 6)} ${f(floor + 8)}L${f(x + 46)} ${f(floor)}M${f(x + 46)} ${f(floor + 8)}L${f(x + 86)} ${f(floor)}M${f(x + 86)} ${f(floor + 8)}L${f(x + 126)} ${f(floor)}M${f(x + 126)} ${f(floor + 8)}L${f(x + 166)} ${f(floor)}" stroke="#0e0b0f" stroke-width="1.2"/>` +
      `<path d="M${f(x - 6)} ${f(floor)}H${f(x + w + 6)}" stroke="#1d1613" stroke-width="3.4"/>` +
      `<path d="M${f(x - 6)} ${f(floor - 1.6)}H${f(x + w + 6)}" stroke="${C.rim}" stroke-opacity=".35" stroke-width=".6"/>`;
    s += `<rect x="${f(x)}" y="${f(wallTop)}" width="${f(w)}" height="${f(floor - wallTop - 1)}" fill="${S.lin([[0, "#15111a"], [1, "#0e0b12"]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`;
    let boards = "";
    for (let xx = x + 4; xx < x + w; xx += 4) boards += `M${f(xx)} ${f(wallTop + 1)}V${f(floor - 1)}`;
    s += `<path d="${boards}" stroke="#07060a" stroke-opacity=".5" stroke-width=".5"/>`;
    const roof = [[x - 10, wallTop + 3], [x + w / 2, ridgeY], [x + w + 10, wallTop + 3]];
    s += `<path d="${P(roof)}" fill="${S.lin([[0, "#1d1820"], [1, "#0c0a0e"]], { x1: 0, y1: 0, x2: 0, y2: 1 })}"/>`;
    let sh = "";
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      const yy = ridgeY + (wallTop + 3 - ridgeY) * t;
      const hw = (w / 2 + 10) * t;
      sh += `M${f(x + w / 2 - hw)} ${f(yy)}H${f(x + w / 2 + hw)}`;
    }
    s += `<path d="${sh}" stroke="#070506" stroke-opacity=".6" stroke-width=".6"/>`;
    s += `<path d="M${f(roof[0][0])} ${f(roof[0][1])}L${f(roof[1][0])} ${f(roof[1][1])}L${f(roof[2][0])} ${f(roof[2][1])}" fill="none" stroke="${C.rim}" stroke-opacity=".6" stroke-width=".9"/>`;
    let refl = `<path d="${piles}" stroke="#110e12" stroke-width="3.6"/><rect x="${f(x)}" y="${f(wallTop)}" width="${f(w)}" height="${f(floor - wallTop)}" fill="#141019"/><path d="${P(roof)}" fill="#141019"/>`;
    for (const wx of [x + 22, x + 54, x + w - 54, x + w - 22]) {
      s += `<rect x="${f(wx - 6)}" y="${f(wallTop + 9)}" width="12" height="14" fill="#f0a050"/><path d="M${f(wx)} ${f(wallTop + 9)}V${f(wallTop + 23)}M${f(wx - 6)} ${f(wallTop + 16)}H${f(wx + 6)}" stroke="#1a100c" stroke-width=".9"/>`;
      refl += `<rect x="${f(wx - 6)}" y="${f(wallTop + 9)}" width="12" height="14" fill="#f0a050"/>`;
      S.light(wx, wallTop + 16, 45, 0.25);
      reflectLight(S, wx, y + 20, 26, { w: 7, op: 0.28 });
    }
    const dx = x + w / 2;
    s += `<path d="M${f(dx - 9)} ${f(floor - 1)}V${f(floor - 24)}H${f(dx + 9)}V${f(floor - 1)}Z" fill="${S.radBox([[0, "#ffd48a"], [0.6, "#e08040"], [1, "#6a2a18"]], { cx: 0.5, cy: 1, r: 1 })}"/>`;
    s += `<path d="M${f(x + w * 0.72)} ${f(ridgeY + 22)}V${f(ridgeY + 4)}h8v18" fill="#131015"/>`;
    S.light(dx, floor - 10, 70, 0.4);
    S.add("fx", 22, `<ellipse class="cs-lamp" cx="${f(dx)}" cy="${f(floor - 10)}" rx="30" ry="20" fill="${S.rad([[0, "#ffb866", 0.28], [1, "#ffb866", 0]], dx, floor - 10, 30, 0.66)}"/>`);
    S.add("back", z, s);
    smoke(S, x + w * 0.72 + 4, ridgeY + 2, { n: 5, size: 1.1, t: 13, dx: -30, dy: -56, layer: "back", z: z - 1 });
    reflect(S, refl, y + 20, { op: 0.3, fade: 30 });
  }

  function dredging(S) {
    const s = S.stage;
    S.fireX = HEART.fire;

    sky(S, { moon: MOON, moonR: 8.5, moonTint: "#e4e2f2", cloudDx: -30 });

    // the far shore: low hills, dead trees standing in the shallows, mist on the water
    const r = S.rnd("far");
    const far = hillYs(r, { base: 138, amp: 9, waves: 3 });
    layerRidge(S, "far", 0, far, -20, 6, { fill: "#221c30", rim: "#5a4e7a", rimOp: 0.45, rimW: 0.7 });
    fog(S, "far", 1, 134, 26, 0.2, "#8f8ab8");
    const r2 = S.rnd("mid");
    const mid = hillYs(r2, { base: 150, amp: 4, waves: 2 });
    layerRidge(S, "mid", 0, mid, -20, 6, { fill: "#16131d", rim: "#3e3858", rimOp: 0.5, rimW: 0.7 });
    let dead = "";
    for (const [tx, th] of [[690, 38], [760, 26], [930, 44], [980, 30]]) dead += treeSvg(bareTree(r2, tx, SHORE + 2, th, { spread: 0.7, depth: 4, twist: 0.5 }), "#141019");
    S.add("mid", 1, dead);

    ground(S, { top: "#1e1826" });
    water(S);
    fog(S, "fx", 5, SHORE + 8, 16, 0.14, "#9a96c4", { patches: 6, seed: "watermist" });
    trail(S, HEART.fire + 24, EDGE - 10, GY + 5, GY + 3);
    scatter(S, { n: 36, seed: "stones", x1: EDGE - 20 });
    reeds(S, EDGE - 20, EDGE + 40, GY + 6, { n: 6, h: 22, seed: "bank" });
    reeds(S, 880, 1000, SHORE + 3, { n: 6, h: 12, seed: "far", layer: "ground", z: 6.5 });

    heart(S, { barrels: 258 });

    // the work: a pole from the bank first, from the jetty once there is one
    if (s >= 4) {
      jetty(S, EDGE - 6, 760, GY - 2);
      netFrame(S, s >= 8 ? 618 : 746, GY - 4);
      if (s < 9) boat(S, 668, GY + 12, { w: 40 });
      worker(S, 708, GY - 3, { pose: "pole", dir: 1, t: 3.4 });
    } else {
      worker(S, EDGE - 6, GY + 1, { pose: "pole", dir: 1, t: 3.4 });
    }
    // a bucket and a coil of rope on the bank
    const Lb = S.lit(EDGE - 30, GY);
    S.add("camp", GY + 4, `<path d="M${f(EDGE - 34)} ${f(GY + 4)}l1-8h8l1 8Z" fill="${mix("#1a1412", "#6a4630", Lb * 0.8)}"/><path d="M${f(EDGE - 33)} ${f(GY - 4)}q4-4 8 0" fill="none" stroke="#2a221e" stroke-width=".6"/><ellipse cx="${f(EDGE - 48)}" cy="${f(GY + 5)}" rx="6" ry="2" fill="none" stroke="${mix("#2a221e", "#a07a54", Lb)}" stroke-width="1.2"/>`);

    if (s >= 3) sieves(S, 522, GY + 5, { z: GY + 5 });

    // the second crew poles a punt out on the water
    if (s >= 5) {
      const px = s >= 9 ? 640 : 860;
      const py = s >= 9 ? GY + 16 : SHORE + 26;
      boat(S, px - 20, py, { w: 50, z: py });
      worker(S, px, py - 4, { pose: "pole", dir: 1, s: s >= 9 ? 1.05 : 0.95, t: 3.8, dl: -1.2, z: py + 0.1 });
    }

    if (s >= 8) {
      dredgeCrane(S, 752, GY - 3);
      lantern(S, EDGE + 20, GY - 20, { z: GY - 1, k: 0.3, r: 70 });
      S.add("camp", GY - 1.1, `<path d="M${f(EDGE + 20)} ${f(GY - 2)}V${f(GY - 27)}" stroke="#1d1613" stroke-width="1.4"/>`);
      reflectLight(S, EDGE + 20, GY + 20, 22, { w: 4, op: 0.4 });
      lantern(S, 760, GY - 16, { z: GY - 1, k: 0.3, r: 70 });
      S.add("camp", GY - 1.1, `<path d="M760 ${f(GY - 2)}V${f(GY - 23)}" stroke="#1d1613" stroke-width="1.4"/>`);
      reflectLight(S, 760, GY + 22, 22, { w: 4, op: 0.4 });
    }
    if (s >= 7) netPoles(S, 148, GY - 2);
    if (s >= 9) stiltHall(S, 800, SHORE + 18);

    outer(S, {
      wall: [0, 560],
      gate: 408,
      tower: HEART.tower,
      banners: [[322, GY - 4, 52, GY - 34], [EDGE - 10, GY + 1, 46, GY]],
    });

    // along the foot of the frame, the bank gives way to water
    foreRocks(S, "fr-dredge", { tufts: true });
    finish(S);
  }

  return dredging;
})();

/* ================= THE ENTRY ================= */

const TRADES = { delving, felling, flaying, harvesting, dredging };

export const CAMP_STAGES = {
  delving: [
    "A lean-to by the spoil heap",
    "A tent for the crew",
    "Crates, barrels and a coal heap",
    "A shored adit and rails",
    "A second crew and an ore cart",
    "A palisade of pit props",
    "A watchtower on the ridge",
    "A headframe and lamps",
    "The deep hall",
  ],
  felling: [
    "A lean-to among the stumps",
    "A tent in the clearing",
    "Crates, barrels and a log stack",
    "A sawpit and trestles",
    "A second crew and a timber drag",
    "A palisade of split logs",
    "A watchtower above the pines",
    "A timber crane and lanterns",
    "The timber hall",
  ],
  flaying: [
    "A lean-to and a skinning post",
    "A tent against the wind",
    "Crates, barrels and a tallow pot",
    "Stretching frames and a rendering vat",
    "A second crew and a hide cart",
    "A palisade hung with antlers",
    "A watchtower over the moor",
    "Drying racks and tallow lamps",
    "The tannery hall",
  ],
  harvesting: [
    "A lean-to at the field's edge",
    "A tent in the stubble",
    "Crates, barrels and stooks",
    "Drying racks and a scarecrow",
    "A second crew and a hay wain",
    "A wattle palisade",
    "A watchtower over the rows",
    "A windmill and lanterns",
    "The tithe barn",
  ],
  dredging: [
    "A lean-to at the water's edge",
    "A tent on dry ground",
    "Crates, barrels and sieve trays",
    "A jetty and a net frame",
    "A second crew and a punt",
    "A palisade to the waterline",
    "A watchtower over the lake",
    "A dredging crane and lanterns",
    "The stilt hall",
  ],
};

// The scene's markup for one trade at one stage (1 to 9). `prefix` keeps ids
// unique when several scenes share a page.
export function campScene(skillId, stage, prefix = "cs") {
  const draw = TRADES[skillId];
  if (!draw) return "";
  const st = Math.max(1, Math.min(9, stage | 0));
  // First pass only gathers the lights, so everything is lit by all of them.
  const dry = new Scene(skillId, st, prefix);
  dry.dry = true;
  draw(dry);
  const S = new Scene(skillId, st, prefix);
  S.lights = dry.lights;
  S.frozen = true;
  draw(S);
  return expose(S.render(), EXPOSURE);
}

// One exposure knob for the whole palette: a gamma lift on every colour,
// which opens up the darks and midtones and leaves the lights alone.
const EXPOSURE = 1.22;
const curve = new Map();
function expose(svg, gamma) {
  if (gamma === 1) return svg;
  // A colour, never the id in url(#...).
  return svg.replace(/#([0-9a-f]{6})\b/gi, (m, h, at, all) => {
    if (all[at - 1] === "(") return m;
    const key = h.toLowerCase();
    let out = curve.get(key);
    if (!out) {
      const n = parseInt(key, 16);
      out = "#" + [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(255 * Math.pow(c / 255, 1 / gamma)).toString(16).padStart(2, "0")).join("");
      curve.set(key, out);
    }
    return out;
  });
}
