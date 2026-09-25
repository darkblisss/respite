/* ============================================================
   Respite · ui/zone-map.js · Who Is Out
   ------------------------------------------------------------
   The Hunt page's Zones: the region's map (ui/region-map.js)
   with its hunters laid over it, and the four zones as rows
   beside it. A ring or a row opens the zone popup. The page
   hands it a plain model and it never reads a save, so the kit
   can draw it from made-up hunters.

     zoneMap({ onZone(tier, zoneId) }) -> { node, paint(model), destroy() }

     model = {
       tier      the region on the map
       active    the zone the hunt is on here, or null
       locked    a hunt is under way: every other zone is shut
       hunters   [{ id, kind, zone, name, skin, tip, href, down }]
                 kind is "me", "party" or "realm"; zone null is
                 at camp (you, when you are not out)
     }

   The drawing is built once a region. Pins and the counts are
   rebuilt only when who stands where changes, and laid out again
   when the map changes size: a pin is a fixed size and the map
   is not, so at a narrow width the spots spread further apart
   and a name that would sit on another one is left to its tip.
   ============================================================ */

import { h, html, on, setAttr, setText, toggleClass } from "./dom.js";
import { portraitImg } from "./widgets.js";
import { regionMap, placePins, labelSpot, campSpot, MAP_W, MAP_H, MAP_VIEWBOX } from "./region-map.js";
import { GameData } from "../../shared/registry.js";

const ZONES = GameData.ZONES;
const NARROW = 520;                                   // below this the pins shrink (.is-narrow in pages.css)
const PIN = { me: 30, party: 26, realm: 22, more: 22 };
const PIN_SMALL = { me: 24, party: 22, realm: 18, more: 18 };
const NAME_H = 14;
const RANK = { me: 0, party: 1, realm: 2, more: 3 };

/* What a ground is worth saying about: only where it differs from the plain
   one. A line reading "one at once, x1 XP" says the same as no line at all. */
export function zoneNotes(z) {
  return [
    z.foesText === "1" ? null : `${z.foesText} at once`,
    z.xp === 1 ? null : `×${z.xp} XP`,
    z.power === 1 ? null : `×${z.power} foes`,
  ].filter(Boolean);
}

const pct = (v, of) => `${((v / of) * 100).toFixed(3)}%`;

function place(node, x, y) {
  node.style.left = pct(x, MAP_W);
  node.style.top = pct(y, MAP_H);
}

export function zoneMap({ onZone = () => {} } = {}) {
  const layer = h("div.zone-map-layer");
  const art = h("div.zone-map-art", { role: "group" }, layer);
  const labels = ZONES.map((z) => h("span.zone-label", { "aria-hidden": "true" }, z.name));
  const campLabel = h("span.zone-camp", { "aria-hidden": "true" }, "Your camp");
  layer.append(...labels, campLabel);

  const rows = ZONES.map((z, i) => {
    const tag = h("span.tag.tag-ember", { hidden: true }, "Hunting");
    const who = h("span.zone-row-who");
    const node = h("button.zone-row", { type: "button", dataset: { zone: z.id } },
      h("span.zone-swatch", { class: `z${i}`, "aria-hidden": "true" }),
      h("span.zone-row-name", h("span", z.name), tag),
      who,
      h("span.zone-row-note", z.note),
      h("span.zone-row-facts", zoneNotes(z).join(" · ")));
    return { z, node, tag, who };
  });
  const node = h("div.zone-map-in", art, h("div.zone-rows", rows.map((r) => r.node)));

  let tier = null;
  let svg = null;
  let bands = [];
  let lines = [];
  let hunters = [];
  let pins = [];
  let stateSig = null;
  let huntersSig = null;
  let laidAt = 0;

  on(art, "click", ".zm-band", (e, band) => {
    if (tier != null && band.dataset.zone) onZone(tier, band.dataset.zone);
  });
  node.addEventListener("click", (e) => {
    const row = e.target instanceof Element ? e.target.closest(".zone-row") : null;
    if (row && tier != null && !row.disabled) onZone(tier, row.dataset.zone);
  });

  function setTier(t) {
    tier = t;
    const region = GameData.REGIONS.find((g) => g.tier === t);
    svg = html(`<svg viewBox="${MAP_VIEWBOX}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${regionMap(t, "zm-")}</svg>`).firstElementChild;
    const was = art.querySelector("svg");
    if (was) was.replaceWith(svg);
    else art.insertBefore(svg, layer);
    setAttr(art, "aria-label", region ? `${region.name}, and who is hunting where` : "Who is hunting where");
    setAttr(art, "data-tier", String(t));
    bands = [...svg.querySelectorAll(".zm-band")];
    lines = [...svg.querySelectorAll(".zm-line")];
    labels.forEach((l, i) => {
      const p = labelSpot(t, i);
      place(l, p.x, p.y);
    });
    const c = campSpot(t);
    place(campLabel, c.x, c.y);
    rows.forEach((r) => { r.node.dataset.tier = String(t); });
    stateSig = null;
    huntersSig = null;
  }

  function paintState(active, locked) {
    const sig = `${active}|${locked}`;
    if (sig === stateSig) return;
    stateSig = sig;
    rows.forEach((r, i) => {
      const on = r.z.id === active;
      const shut = !!locked && !on;
      toggleClass(r.node, "is-active", on);
      toggleClass(r.node, "is-locked", shut);
      setAttr(r.node, "disabled", shut);
      setAttr(r.node, "aria-disabled", shut);
      setAttr(r.tag, "hidden", !on);
      toggleClass(labels[i], "is-active", on);
    });
    bands.forEach((b) => {
      const on = b.dataset.zone === active;
      toggleClass(b, "is-active", on);
      toggleClass(b, "is-locked", !!locked && !on);
    });
    lines.forEach((l) => toggleClass(l, "is-active", l.dataset.zone === active));
  }

  // Who else is out on each ground, said once a row.
  function paintCounts() {
    rows.forEach((r) => {
      const here = hunters.filter((u) => u.zone === r.z.id);
      const others = here.filter((u) => u.kind !== "me");
      const mine = here.some((u) => u.kind === "me");
      const n = others.length;
      setText(r.who, n ? `${n} ${mine ? (n === 1 ? "other" : "others") : n === 1 ? "hunter" : "hunters"}` : "");
      toggleClass(r.who, "has-party", others.some((u) => u.kind === "party"));
    });
  }

  function pinNode(u) {
    const face = h("span.zone-pin-face.portrait-bust", u.kind === "more" ? null : portraitImg(u.skin || null));
    if (u.kind === "more") face.textContent = u.name;
    return h(u.href ? "a.zone-pin" : "span.zone-pin", {
      class: [`is-${u.kind}`, u.down && "is-down"],
      href: u.href || null,
      "data-tip": u.tip || null,
      "aria-label": u.tip || u.name,
      dataset: { zone: u.zone || "camp", who: u.kind === "more" ? null : u.id },
    }, face, u.kind === "more" || u.atCamp ? null : h("span.zone-pin-name", u.name));
  }

  /* Every pin a spot, then names wherever they fit: yours first, your
     party's next, then the realm's. A name that would land on another name,
     a pin or a zone's label is left to its tip. */
  function layout() {
    const w = art.clientWidth || MAP_W;
    const hgt = art.clientHeight || MAP_H;
    const sx = w / MAP_W;
    const sy = hgt / MAP_H;
    const narrow = w < NARROW;
    toggleClass(art, "is-narrow", narrow);
    const px = narrow ? PIN_SMALL : PIN;
    // On a phone the bands are barely a pin thick, so the faces crowd in a little rather than
    // leave most of a zone to a count.
    const gap = (narrow ? px.realm * 0.85 + 2 : px.realm + 8) / sx;
    laidAt = w;

    pins.forEach((p) => p.node.remove());
    pins = [];
    const out = hunters.filter((u) => u.zone);
    const { placed, more } = placePins(tier, out.map((u) => ({ id: u.id, zone: u.zone, kind: u.kind })), gap);
    placed.forEach((p) => {
      const u = out.find((x) => x.id === p.id);
      if (u) pins.push({ u, x: p.x, y: p.y });
    });
    more.forEach((m) => {
      const names = out.filter((u) => u.zone === m.zone && !placed.some((p) => p.id === u.id)).map((u) => u.name);
      const tip = names.length > 6 ? `${names.slice(0, 6).join(", ")} and ${names.length - 6} more` : names.join(", ");
      pins.push({ u: { id: `more-${m.zone}`, kind: "more", zone: m.zone, name: `+${m.count}`, tip }, x: m.x, y: m.y });
    });
    const home = hunters.find((u) => !u.zone && u.kind === "me");
    if (home) {
      const c = campSpot(tier);
      pins.push({ u: Object.assign({}, home, { atCamp: true }), x: c.x, y: c.y - 2 });
    }
    pins.forEach((p) => {
      p.node = pinNode(p.u);
      place(p.node, p.x, p.y);
      layer.append(p.node);
    });

    // The names, in order of who matters most on your own map.
    const taken = labels.concat(campLabel).map((l) => {
      const r = l.getBoundingClientRect();
      return r.width ? r : null;
    }).filter(Boolean);
    const box = art.getBoundingClientRect();
    const faces = pins.map((p) => {
      const d = px[p.u.kind] || px.realm;
      const cx = box.left + p.x * sx;
      const cy = box.top + p.y * sy;
      return { p, left: cx - d / 2, right: cx + d / 2, top: cy - d / 2, bottom: cy + d / 2, cx, cy };
    });
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    faces.slice().sort((a, b) => RANK[a.p.u.kind] - RANK[b.p.u.kind] || a.cy - b.cy).forEach((f) => {
      const name = f.p.node.querySelector(".zone-pin-name");
      if (!name) return;
      const nw = name.offsetWidth;
      const rect = { left: f.cx - nw / 2, right: f.cx + nw / 2, top: f.bottom + 1, bottom: f.bottom + 1 + NAME_H };
      const inside = rect.left >= box.left + 2 && rect.right <= box.right - 2 && rect.bottom <= box.bottom - 2;
      const clear = inside && !taken.some((t) => hit(rect, t)) && !faces.some((o) => o !== f && hit(rect, o));
      setAttr(name, "hidden", !clear);
      if (clear) taken.push(rect);
    });
  }

  const ro = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
      if (tier != null && Math.abs((art.clientWidth || 0) - laidAt) > 1) layout();
    })
    : null;
  if (ro) ro.observe(art);

  return {
    node,
    paint(model) {
      if (!model || !Number.isInteger(model.tier)) return;
      if (model.tier !== tier) setTier(model.tier);
      paintState(model.active || null, !!model.locked);
      const list = Array.isArray(model.hunters) ? model.hunters : [];
      const sig = list.map((u) => [u.id, u.kind, u.zone || "", u.name, u.skin || "", u.down ? 1 : 0, u.tip || ""].join(":")).join("|");
      if (sig === huntersSig) return;
      huntersSig = sig;
      hunters = list;
      paintCounts();
      layout();
    },
    destroy() {
      if (ro) ro.disconnect();
    },
  };
}
