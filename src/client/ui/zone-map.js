/* ============================================================
   Respite · ui/zone-map.js · Who Is Out
   ------------------------------------------------------------
   The Hunt page's Zones: the region's map (ui/region-map.js)
   with its hunters laid over it, and the four zones as rows
   beside it. A ring or a row opens the zone popup. The page
   hands it a plain model and it never reads a save, so the kit
   can draw it from made-up hunters.

     zoneMap({ onZone(tier, zoneId), onView(view) })
       -> { node, paint(model), destroy() }

     model = {
       tier      the region on the map
       active    the zone the hunt is on here, or null
       locked    a hunt is under way: every other zone is shut
       hunters   [{ id, kind, zone, name, skin, tip, href, down }]
                 kind is "me", "party" or "realm"; zone null is
                 at camp (you, when you are not out)
       counts    { outer, middle, inner, core }, optional: how
                 many besides you the realm says are on each. In
                 a crowd it counts more than it names.
       party     you have a party, so the map offers to show it
                 alone
       view      "everyone" or "party"
     }

   The ground is a picture (regionLand, as an <img>), drawn once
   a region for the session; only the rings over it are live
   SVG. Pins are kept by who they are and moved, not rebuilt,
   and a tip that changes (the "out 40m" in it) touches the tip
   alone. A pin is a fixed size and the map is not, so at a
   narrow width the spots spread further apart and a name that
   would sit on another one is left to its tip.

   A crowd: past CROWD others on the ground, faces stop saying
   anything. The map then draws yours and your party's only,
   everyone else as a speck of light in their zone, and each
   zone's name carries a count of who is there. The rows count
   the same either way. The Party view leaves the realm off the
   map altogether.
   ============================================================ */

import { h, html, on, setAttr, setText, toggleClass } from "./dom.js";
import { portraitImg } from "./widgets.js";
import { iconEl } from "./icons.js";
import { fmtWhole } from "./format.js";
import { regionLand, regionOverlay, placePins, crowdSpots, dotsPath, labelSpot, campSpot, MAP_W, MAP_H, MAP_VIEWBOX } from "./region-map.js";
import { GameData } from "../../shared/registry.js";

const ZONES = GameData.ZONES;
const NARROW = 520;                                   // below this the pins shrink (.is-narrow in pages.css)
const PIN = { me: 30, party: 26, realm: 22, more: 22 };
const PIN_SMALL = { me: 24, party: 22, realm: 18, more: 18 };
const NAME_H = 14;
const RANK = { me: 0, party: 1, realm: 2, more: 3 };
const CROWD = 24;                                     // more strangers than this and they become counts
const SPECKS = [96, 72, 45, 21];                      // the most specks a zone's band shows, Outer to Core
const VIEWS = [["everyone", "Everyone"], ["party", "Party"]];

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

// Each region's ground, as a picture: drawn the first time it is shown and kept for the session.
const LAND = new Map();

function landSrc(tier) {
  if (!LAND.has(tier)) {
    const svg = regionLand(tier, "zl-");
    let src;
    try {
      src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    } catch (e) {
      src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }
    LAND.set(tier, src);
  }
  return LAND.get(tier);
}

// A said count, or 0 when the realm said nothing usable.
const said = (counts, id) => {
  const n = counts ? Number(counts[id]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

// What a pin shows other than its place and its tip: when any of it changes, the pin is made again.
const pinKey = (u) => [u.kind, u.name, u.skin || "", u.down ? 1 : 0, u.href || "", u.atCamp ? 1 : 0].join(":");

export function zoneMap({ onZone = () => {}, onView = () => {} } = {}) {
  const land = h("img.zone-map-land", { alt: "", decoding: "async", draggable: "false" });
  const layer = h("div.zone-map-layer");
  const art = h("div.zone-map-art", { role: "group" }, land, layer);
  const tallies = ZONES.map(() => {
    const text = document.createTextNode("");
    return { text, node: h("span.zone-label-n", { hidden: true }, iconEl("person"), text) };
  });
  const labels = ZONES.map((z, i) => h("span.zone-label", { "aria-hidden": "true" }, h("span", z.name), tallies[i].node));
  const campLabel = h("span.zone-camp", { "aria-hidden": "true" }, "Your camp");
  layer.append(...labels, campLabel);

  const viewBtns = VIEWS.map(([id, label]) => h("button.seg-btn", { type: "button", "aria-pressed": false, dataset: { view: id } }, label));
  const viewSeg = h("div.seg.zone-view", { role: "group", "aria-label": "Who the map shows", hidden: true }, viewBtns);

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
  const node = h("div.zone-map-in", art, h("div.zone-rows", viewSeg, rows.map((r) => r.node)));

  let tier = null;
  let svg = null;
  let bands = [];
  let lines = [];
  let specks = null;
  let model = null;
  let view = "everyone";
  let hunters = [];
  let stateSig = null;
  let huntersSig = null;
  let laidAt = 0;
  const pins = new Map();       // hunter id -> { key, node, u }
  const widths = new Map();     // a name's width, by size, weight and text

  on(art, "click", ".zm-band", (e, band) => {
    if (tier != null && band.dataset.zone) onZone(tier, band.dataset.zone);
  });
  node.addEventListener("click", (e) => {
    const row = e.target instanceof Element ? e.target.closest(".zone-row") : null;
    if (row && tier != null && !row.disabled) onZone(tier, row.dataset.zone);
  });
  viewSeg.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest(".seg-btn") : null;
    if (!btn || !model || btn.dataset.view === view) return;
    onView(btn.dataset.view);
    paint(Object.assign({}, model, { view: btn.dataset.view }));
  });

  function setTier(t) {
    tier = t;
    const region = GameData.REGIONS.find((g) => g.tier === t);
    land.src = landSrc(t);
    const was = svg;
    svg = html(`<svg viewBox="${MAP_VIEWBOX}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${regionOverlay(t, "zm-")}</svg>`).firstElementChild;
    if (was) was.replaceWith(svg);
    else art.insertBefore(svg, layer);
    setAttr(art, "aria-label", region ? `${region.name}, and who is hunting where` : "Who is hunting where");
    setAttr(art, "data-tier", String(t));
    bands = [...svg.querySelectorAll(".zm-band")];
    lines = [...svg.querySelectorAll(".zm-line")];
    specks = { glow: svg.querySelector(".zm-crowd-glow"), dot: svg.querySelector(".zm-crowd-dot"), sig: "" };
    labels.forEach((l, i) => {
      const p = labelSpot(t, i);
      place(l, p.x, p.y);
    });
    const c = campSpot(t);
    place(campLabel, c.x, c.y);
    rows.forEach((r) => { r.node.dataset.tier = String(t); });
    pins.forEach((p) => p.node.remove());
    pins.clear();
    stateSig = null;
    huntersSig = null;
  }

  function paintState(active, locked) {
    const sig = `${active}|${locked}`;
    if (sig === stateSig) return;
    stateSig = sig;
    rows.forEach((r, i) => {
      const lit = r.z.id === active;
      const shut = !!locked && !lit;
      toggleClass(r.node, "is-active", lit);
      toggleClass(r.node, "is-locked", shut);
      setAttr(r.node, "disabled", shut);
      setAttr(r.node, "aria-disabled", shut);
      setAttr(r.tag, "hidden", !lit);
      toggleClass(labels[i], "is-active", lit);
    });
    bands.forEach((b) => {
      const lit = b.dataset.zone === active;
      toggleClass(b, "is-active", lit);
      toggleClass(b, "is-locked", !!locked && !lit);
    });
    lines.forEach((l) => toggleClass(l, "is-active", l.dataset.zone === active));
  }

  function paintView(m) {
    const offer = !!m.party;
    view = offer && m.view === "party" ? "party" : "everyone";
    setAttr(viewSeg, "hidden", !offer);
    viewBtns.forEach((b) => setAttr(b, "aria-pressed", String(b.dataset.view === view)));
  }

  /* Who is on each ground besides you: whichever is more, the faces the page
     named or the count the realm gave (a crowd is counted, not named). */
  function reckon() {
    const counts = model && model.counts;
    const others = ZONES.map((z) => Math.max(hunters.filter((u) => u.zone === z.id && u.kind !== "me").length, said(counts, z.id)));
    const party = ZONES.map((z) => hunters.filter((u) => u.zone === z.id && u.kind === "party").length);
    const mine = ZONES.map((z) => hunters.some((u) => u.zone === z.id && u.kind === "me"));
    const strangers = others.reduce((n, v, i) => n + Math.max(0, v - party[i]), 0);
    return { others, party, mine, crowd: view === "everyone" && strangers > CROWD };
  }

  // Who else is out on each ground, said once a row, the same in every view.
  function paintCounts(r) {
    rows.forEach((row, i) => {
      const n = r.others[i];
      setText(row.who, n ? `${fmtWhole(n)} ${r.mine[i] ? (n === 1 ? "other" : "others") : n === 1 ? "hunter" : "hunters"}` : "");
      toggleClass(row.who, "has-party", r.party[i] > 0);
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

  function tipOn(pin, u) {
    setAttr(pin.node, "data-tip", u.tip || null);
    setAttr(pin.node, "aria-label", u.tip || u.name);
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
    laidAt = w;

    const r = reckon();
    // The faces: everyone's, or in a crowd or the Party view, yours and your party's.
    const drawn = hunters.filter((u) => u.zone && (u.kind !== "realm" || (view === "everyone" && !r.crowd)));
    /* A few faces stand a full face apart. Many crowd in a little: on a phone the bands
       are barely a pin thick, and a zone had better show faces than a count. */
    const gap = (drawn.length <= 8 ? px.me + 4 : narrow ? px.realm * 0.85 + 2 : px.realm + 8) / sx;
    paintCounts(r);
    // In a crowd a zone's name carries its count, so it keeps more room round it.
    const labelHalf = r.crowd ? 46 : 30;
    tallies.forEach((t, i) => {
      const n = r.others[i] + (r.mine[i] ? 1 : 0);
      setAttr(t.node, "hidden", !r.crowd || !n);
      setText(t.text, fmtWhole(n));
    });
    // Everyone the faces leave out, as specks: each zone's strangers, up to what its band can show.
    const many = ZONES.map((z, i) => (r.crowd ? Math.min(SPECKS[i], Math.max(0, r.others[i] - r.party[i])) : 0));
    if (specks && many.join(",") !== specks.sig) {
      specks.sig = many.join(",");
      const spots = many.flatMap((n, i) => (n ? crowdSpots(tier, i, n) : []));
      setAttr(specks.glow, "d", dotsPath(spots, 4.2));
      setAttr(specks.dot, "d", dotsPath(spots, 1.7));
    }
    toggleClass(art, "is-crowd", r.crowd);

    const { placed, more } = placePins(tier, drawn.map((u) => ({ id: u.id, zone: u.zone, kind: u.kind })), gap, labelHalf);
    const want = [];
    placed.forEach((p) => {
      const u = drawn.find((x) => x.id === p.id);
      if (u) want.push({ u, x: p.x, y: p.y });
    });
    more.forEach((m) => {
      const names = drawn.filter((u) => u.zone === m.zone && !placed.some((p) => p.id === u.id)).map((u) => u.name);
      const tip = names.length > 6 ? `${names.slice(0, 6).join(", ")} and ${names.length - 6} more` : names.join(", ");
      want.push({ u: { id: `more-${m.zone}`, kind: "more", zone: m.zone, name: `+${m.count}`, tip }, x: m.x, y: m.y });
    });
    const home = hunters.find((u) => !u.zone && u.kind === "me");
    if (home) {
      const c = campSpot(tier);
      want.push({ u: Object.assign({}, home, { atCamp: true }), x: c.x, y: c.y - 2 });
    }

    // Kept pins move; new ones are made; the rest go.
    const keep = new Set();
    want.forEach((p) => {
      const key = pinKey(p.u);
      let pin = pins.get(p.u.id);
      if (pin && pin.key !== key) {
        pin.node.remove();
        pin = null;
      }
      if (!pin) {
        pin = { key, node: pinNode(p.u) };
        pins.set(p.u.id, pin);
        layer.append(pin.node);
      } else {
        tipOn(pin, p.u);
        setAttr(pin.node, "data-zone", p.u.zone || "camp");
      }
      pin.u = p.u;
      pin.x = p.x;
      pin.y = p.y;
      place(pin.node, p.x, p.y);
      keep.add(p.u.id);
    });
    pins.forEach((pin, id) => {
      if (keep.has(id)) return;
      pin.node.remove();
      pins.delete(id);
    });

    // The names: every one shown, every one measured in a single read, then hidden where it would collide.
    const list = [...pins.values()];
    const named = list.map((pin) => ({ pin, name: pin.node.querySelector(".zone-pin-name") })).filter((n) => n.name);
    named.forEach((n) => setAttr(n.name, "hidden", false));
    const taken = labels.concat(campLabel).map((l) => {
      const b = l.getBoundingClientRect();
      return b.width ? b : null;
    }).filter(Boolean);
    const box = art.getBoundingClientRect();
    named.forEach((n) => {
      const k = `${narrow ? 1 : 0}|${n.pin.u.kind}|${n.pin.u.name}`;
      if (!widths.has(k)) widths.set(k, n.name.offsetWidth);
      n.width = widths.get(k);
    });
    const faces = list.map((pin) => {
      const d = px[pin.u.kind] || px.realm;
      const cx = box.left + pin.x * sx;
      const cy = box.top + pin.y * sy;
      return { pin, left: cx - d / 2, right: cx + d / 2, top: cy - d / 2, bottom: cy + d / 2, cx, cy };
    });
    const faceOf = new Map(faces.map((f) => [f.pin, f]));
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const hide = [];
    named.slice().sort((a, b) => RANK[a.pin.u.kind] - RANK[b.pin.u.kind] || faceOf.get(a.pin).cy - faceOf.get(b.pin).cy).forEach((n) => {
      const f = faceOf.get(n.pin);
      const rect = { left: f.cx - n.width / 2, right: f.cx + n.width / 2, top: f.bottom + 1, bottom: f.bottom + 1 + NAME_H };
      const inside = rect.left >= box.left + 2 && rect.right <= box.right - 2 && rect.bottom <= box.bottom - 2;
      const clear = inside && !taken.some((t) => hit(rect, t)) && !faces.some((o) => o !== f && hit(rect, o));
      if (clear) taken.push(rect);
      else hide.push(n.name);
    });
    hide.forEach((name) => setAttr(name, "hidden", true));
  }

  function paint(m) {
    if (!m || !Number.isInteger(m.tier)) return;
    model = m;
    if (m.tier !== tier) setTier(m.tier);
    paintState(m.active || null, !!m.locked);
    paintView(m);
    const list = Array.isArray(m.hunters) ? m.hunters : [];
    const counts = ZONES.map((z) => said(m.counts, z.id)).join(",");
    const sig = `${view}#${counts}#${list.map((u) => [u.id, u.kind, u.zone || "", u.name, u.skin || "", u.down ? 1 : 0, u.href || ""].join(":")).join("|")}`;
    hunters = list;
    if (sig !== huntersSig) {
      huntersSig = sig;
      layout();
      return;
    }
    // The same people in the same places: only a tip can have moved on.
    list.forEach((u) => {
      const pin = pins.get(u.id);
      if (pin && pin.u.tip !== u.tip) {
        pin.u = Object.assign({}, pin.u, { tip: u.tip });
        tipOn(pin, pin.u);
      }
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
    paint,
    destroy() {
      if (ro) ro.disconnect();
    },
  };
}
