/* ============================================================
   Respite · ui/callouts.js · The Tailor's Lines
   ------------------------------------------------------------
   Dashed lines from each worn slot to where the piece sits on
   the commander: the helm to the head, the amulet to the
   collarbone, the weapon to the main hand, the shield to the
   same hand, the ring and the gloves to the other. A two-hander
   fills the weapon and offhand slots as one and draws one line.

   Where a point falls is a fraction of the skin's image, so it
   holds at every size the paperdoll is drawn at. A skin that
   carries `anchors` in the registry uses them, as set by eye. A
   skin that does not is measured once from its own pixels (the
   head and neck from the face's colour, the chest and feet from
   the silhouette, the hands from skin the colour of the face),
   and a figure too odd to read gets a plain standing pose.

   Nothing here reads the save. The paperdoll calls update()
   after it repaints; resizing and a late image load redraw on
   their own.
   ============================================================ */

import { getSkin } from "../../shared/registry.js";

const NS = "http://www.w3.org/2000/svg";

/* Which point each slot's line reaches. handL is the hand on the screen's left
   and handR the one on the right: the weapon and the shield share the right
   hand, beside their column; the ring and the gloves take the left. */
const TARGET = {
  head: "head", neck: "neck", chest: "chest", feet: "feet",
  hands: "handL", ring: "handL", weapon: "handR", offhand: "handR",
};

// A standing figure nobody has measured and no pixel could place.
const FALLBACK = Object.freeze({
  head: [0.52, 0.08], neck: [0.53, 0.2], chest: [0.5, 0.29],
  handL: [0.4, 0.48], handR: [0.72, 0.49], feet: [0.35, 0.93],
});

// Image src -> the points measured from it. An image is only ever read once.
const measured = new Map();

/* The default portrait is the Drifter's art, so a commander with no skin
   chosen wears the Drifter's points. */
function anchorsFor(skin, img) {
  const def = getSkin(skin || "drifter");
  if (def && def.anchors) return def.anchors;
  const src = img.currentSrc || img.src;
  if (measured.has(src)) return measured.get(src);
  let got = null;
  try {
    got = measure(img);
  } catch {
    got = null;   // a canvas the browser will not read back: the plain pose does
  }
  const out = got || FALLBACK;
  measured.set(src, out);
  return out;
}

/* ================= READING A SKIN ================= */

/* Reads the figure small (120px wide is plenty for points this coarse) and
   returns { head, neck, chest, handL, handR, feet } as fractions, or null
   when there is no face to go by. */
function measure(img) {
  const W = 120;
  const H = Math.round((W * img.naturalHeight) / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const at = (x, y) => (y * W + x) * 4;
  const solid = (i) => px[i + 3] > 128;

  let top = -1;
  let bot = -1;
  for (let y = 0; y < H && top < 0; y++) for (let x = 0; x < W; x++) if (solid(at(x, y))) { top = y; break; }
  for (let y = H - 1; y >= 0 && bot < 0; y--) for (let x = 0; x < W; x++) if (solid(at(x, y))) { bot = y; break; }
  if (top < 0 || bot - top < 40) return null;
  const h = bot - top;
  const row = (f) => Math.min(H - 1, Math.round(top + f * h));

  // The face: warm, light pixels in the head band. Its colour is the skin's colour.
  const warm = (i) => {
    const r = px[i];
    const gg = px[i + 1];
    const b = px[i + 2];
    return solid(i) && r > gg && gg > b && r - b > 30 && r + gg + b > 330;
  };
  let fx = 0;
  let fy = 0;
  let n = 0;
  const tone = [0, 0, 0];
  for (let y = row(0.03); y <= row(0.12); y++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, y);
      if (!warm(i)) continue;
      fx += x; fy += y; n++;
      tone[0] += px[i]; tone[1] += px[i + 1]; tone[2] += px[i + 2];
    }
  }
  if (n < 12) return null;
  fx /= n; fy /= n;
  tone[0] /= n; tone[1] /= n; tone[2] /= n;
  const skinLike = (i) => solid(i) && Math.abs(px[i] - tone[0]) + Math.abs(px[i + 1] - tone[1]) + Math.abs(px[i + 2] - tone[2]) < 70;

  // Chest: the middle of the body a little under the shoulders.
  const chestY = row(0.29);
  const across = [];
  for (let x = 0; x < W; x++) if (solid(at(x, chestY))) across.push(x);
  const mid = across.length ? across[Math.floor(across.length / 2)] : W / 2;

  // Feet: the middle of the left boot, the two split at the widest empty gap.
  const bootX = [];
  const bootY = [];
  for (let y = row(0.88); y <= row(0.985); y++) for (let x = 0; x < W; x++) if (solid(at(x, y))) { bootX.push(x); bootY.push(y); }
  const cols = [...new Set(bootX)].sort((a, b) => a - b);
  let cut = mid;
  let widest = 1;
  for (let k = 1; k < cols.length; k++) if (cols[k] - cols[k - 1] > widest) { widest = cols[k] - cols[k - 1]; cut = cols[k - 1]; }
  const leftBoot = bootX.map((x, k) => [x, bootY[k]]).filter(([x]) => x <= cut);
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const feet = leftBoot.length ? [median(leftBoot.map((p) => p[0])), median(leftBoot.map((p) => p[1]))] : [mid * 0.8, row(0.93)];

  // Hands: skin-coloured pixels in the arm band, one side of the body each. The
  // lower part of what shows is the palm; a hand that shows no skin (a glove, a
  // pocket) is the outermost point of the silhouette at arm height.
  const hand = (left) => {
    const hx = [];
    const hy = [];
    for (let y = row(0.38); y <= row(0.6); y++) {
      for (let x = 0; x < W; x++) {
        if ((x < mid) !== left) continue;
        if (skinLike(at(x, y))) { hx.push(x); hy.push(y); }
      }
    }
    if (hx.length > 6) {
      const ys = [...hy].sort((a, b) => a - b);
      const x = hx.reduce((s, v) => s + v, 0) / hx.length;
      return [x, ys[Math.floor(ys.length * 0.65)]];
    }
    let best = null;
    for (let y = row(0.4); y <= row(0.55); y++) {
      for (let k = 0; k < W; k++) {
        const x = left ? k : W - 1 - k;
        if (!solid(at(x, y))) continue;
        if (!best || (left ? x < best[0] : x > best[0])) best = [x, y];
        break;
      }
    }
    return best ? [best[0] + (left ? 1 : -1) * W * 0.04, best[1]] : [left ? mid * 0.8 : mid * 1.4, row(0.48)];
  };

  const f = ([x, y]) => [x / W, y / H];
  return {
    head: f([fx, (top + fy) / 2 + 0.02 * h]),
    neck: f([fx, fy + 0.09 * h]),
    chest: f([mid, chestY]),
    handL: f(hand(true)),
    handR: f(hand(false)),
    feet: f(feet),
  };
}

/* ================= DRAWING ================= */

/* Lays an <svg> over a .doll (its left column, figure and right column) and
   returns { update(skin) }. Slots are read by data-slot, so an empty slot and
   a spanning two-hander draw like anything else. */
export function dollLines(doll) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "doll-lines");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  doll.appendChild(svg);

  let skin = null;
  let frame = 0;
  const soon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); };
  if (typeof ResizeObserver === "function") new ResizeObserver(soon).observe(doll);
  // An <img> load does not bubble; caught on the way down, it redraws once the art is in.
  doll.addEventListener("load", soon, true);

  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    Object.keys(attrs).forEach((k) => { if (attrs[k] != null) node.setAttribute(k, attrs[k]); });
    return node;
  };

  function draw() {
    const img = doll.querySelector(".doll-figure .portrait img");
    const box = doll.getBoundingClientRect();
    if (!img || !box.width || !img.complete || !img.naturalWidth) {
      svg.replaceChildren();
      return;
    }
    const an = anchorsFor(skin, img);

    // Where the art actually lands: object-fit contain, stood on the bottom (.portrait img).
    const ir = img.getBoundingClientRect();
    const ar = img.naturalWidth / img.naturalHeight;
    let x0 = ir.left;
    let y0 = ir.top;
    let w = ir.width;
    let hh = ir.height;
    if (w / hh > ar) { const cw = hh * ar; x0 += (w - cw) / 2; w = cw; } else { const ch = w / ar; y0 += hh - ch; hh = ch; }
    const point = (k) => [x0 - box.left + an[k][0] * w, y0 - box.top + an[k][1] * hh];
    const figMid = ir.left + ir.width / 2;

    const lines = [];
    const ends = new Map();
    doll.querySelectorAll(".doll-col > .doll-slot[data-slot]").forEach((slot) => {
      const target = TARGET[slot.dataset.slot];
      const r = slot.getBoundingClientRect();
      if (!target || !an[target] || !r.width) return;
      const fromLeft = r.left + r.width / 2 < figMid;
      const sx = (fromLeft ? r.right : r.left) - box.left;
      const sy = r.top + r.height / 2 - box.top;
      const [tx, ty] = point(target);
      const rarity = slot.getAttribute("data-rarity");
      const cls = rarity ? null : "is-empty";
      lines.push(el("path", { d: `M${sx.toFixed(1)} ${sy.toFixed(1)}L${tx.toFixed(1)} ${ty.toFixed(1)}`, "data-rarity": rarity, class: cls }));
      // Lines that meet share one dot; a worn piece's colour wins over an empty slot's.
      const id = target;
      if (!ends.has(id) || (rarity && !ends.get(id).rarity)) ends.set(id, { tx, ty, rarity, cls });
    });
    const dots = [];
    ends.forEach(({ tx, ty, rarity, cls }) => {
      dots.push(el("circle", { cx: tx.toFixed(1), cy: ty.toFixed(1), r: 4.5, class: cls ? "dot-ring is-empty" : "dot-ring", "data-rarity": rarity }));
      dots.push(el("circle", { cx: tx.toFixed(1), cy: ty.toFixed(1), r: 2, class: cls ? "dot is-empty" : "dot", "data-rarity": rarity }));
    });
    svg.setAttribute("viewBox", `0 0 ${box.width.toFixed(1)} ${box.height.toFixed(1)}`);
    svg.replaceChildren(...lines, ...dots);
  }

  return {
    // After the slots or the skin change. Cheap: one redraw on the next frame.
    update(nextSkin) {
      skin = nextSkin || null;
      soon();
    },
  };
}
