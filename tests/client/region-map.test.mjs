/* ============================================================
   Respite · tests/client/region-map.test.mjs · The Surveyor
   ------------------------------------------------------------
   The Hunt page's maps, read as numbers: nine regions, each drawn
   the same way every time and unlike the other eight, the ground
   and the rings as two sheets, four bands that take a press in the
   Outer to Core order, rings that stay on the page and never touch,
   hunters stood where they belong, and a crowd scattered as specks.

     node tests/client/region-map.test.mjs
   ============================================================ */

import { regionMap, regionLand, regionOverlay, crowdSpots, dotsPath, MAPPED_TIERS, MAP_W, MAP_H, labelSpot, campSpot, heartSpot, zoneOf, pinSlots, placePins } from "../../src/client/ui/region-map.js";
import { GameData } from "../../src/shared/registry.js";

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  const extra = !ok && detail !== undefined ? `\n     ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : "";
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra}`);
  return !!ok;
}

const section = (title) => console.log(`\n# ${title}`);
const ZONE_IDS = GameData.ZONES.map((z) => z.id);
const TIERS = GameData.REGIONS.map((r) => r.tier);

section("nine maps, each its own");
{
  check("every region has a map", TIERS.every((t) => MAPPED_TIERS.includes(t)), { TIERS, MAPPED_TIERS });
  const drawn = TIERS.map((t) => regionMap(t, "t-"));
  check("the same region draws the same map every time", TIERS.every((t, i) => regionMap(t, "t-") === drawn[i]));
  check("and no two regions draw the same one", new Set(drawn).size === drawn.length);
  check("each names its own region in its title", TIERS.every((t, i) => drawn[i].includes(GameData.REGIONS[i].name)));
  const bad = drawn.findIndex((m) => /NaN|undefined|Infinity|null/.test(m));
  check("no number in any of them came out broken", bad < 0, bad >= 0 && `tier ${TIERS[bad]}`);
  const huge = drawn.map((m, i) => [TIERS[i], m.length]).filter(([, n]) => n > 200000);
  check("and none is heavier than a page wants to parse", huge.length === 0, huge);
  check("a region this build does not know gets a map rather than a hole", regionMap(99).length > 1000);
}

section("two sheets: the ground as a picture, the rings live over it");
for (const t of TIERS) {
  const land = regionLand(t, "l-");
  const over = regionOverlay(t, "o-");
  check(`${t}: the ground is a whole SVG document of its own, the map's size`,
    /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 640 400" width="640" height="400">/.test(land) && land.endsWith("</svg>"));
  check(`${t}: and nothing on it wears a page class or answers the pointer, since a picture can do neither`,
    !/class=|data-zone|<text/.test(land));
  check(`${t}: its filters and gradients are all its own`,
    [...land.matchAll(/url\(#([^)]+)\)/g)].every((m) => land.includes(`id="${m[1]}"`)));
  check(`${t}: the sheet over it carries every band, a crowd's specks still empty, and no filter to run again`,
    (over.match(/class="zm-band z\d"/g) || []).length === 4 && /<path class="zm-crowd-glow" d=""\/><path class="zm-crowd-dot" d=""\/>/.test(over) && !/filter=|url\(| id="/.test(over));
  check(`${t}: and the one-sheet map is the two together`, regionMap(t, "l-").includes(land.slice(land.indexOf("<defs>"), -6)) && regionMap(t, "o-").includes(over));
}

section("the rings");
for (const t of TIERS) {
  const map = regionMap(t, "t-");
  const bands = [...map.matchAll(/class="zm-band z(\d)" data-zone="([a-z]+)"/g)].map((m) => [Number(m[1]), m[2]]);
  if (!check(`${t}: four bands, Outer to Core`, JSON.stringify(bands) === JSON.stringify(ZONE_IDS.map((z, i) => [i, z])), bands)) continue;
  const outer = /class="zm-line z0" data-zone="outer" d="([^"]+)"/.exec(map);
  const nums = outer ? outer[1].match(/-?\d+(\.\d+)?/g).map(Number) : [];
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  check(`${t}: the Outer ring stays on the page`, xs.length > 20 && Math.min(...xs) > 8 && Math.max(...xs) < MAP_W - 8 && Math.min(...ys) > 8 && Math.max(...ys) < MAP_H - 8,
    { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] });
  const ids = [...map.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  check(`${t}: every id wears the prefix`, ids.length > 0 && ids.every((id) => id.startsWith(`t-${t}-`)), ids.filter((id) => !id.startsWith(`t-${t}-`)));
  const h = heartSpot(t);
  const c = campSpot(t);
  check(`${t}: the heart is in the Core and the camp outside every ring`, zoneOf(t, h.x, h.y) === "core" && zoneOf(t, c.x, c.y) === null, { heart: zoneOf(t, h.x, h.y), camp: zoneOf(t, c.x, c.y) });
  const labels = ZONE_IDS.map((z, i) => labelSpot(t, i));
  check(`${t}: each zone's name sits in its own zone, stacked up from the heart`,
    labels.every((p, i) => zoneOf(t, p.x, p.y) === ZONE_IDS[i]) && labels.every((p, i) => i === 0 || p.y > labels[i - 1].y),
    labels.map((p) => zoneOf(t, p.x, p.y)));
  // Walk out from the heart along a spread of bearings: the zones must come in order, each once.
  let crossed = null;
  for (let k = 0; k < 72 && !crossed; k++) {
    const a = (k / 72) * Math.PI * 2;
    const seen = [];
    for (let d = 0; d < 400; d += 0.5) {
      const z = zoneOf(t, h.x + Math.cos(a) * d, h.y + Math.sin(a) * d * 0.63);
      if (z !== seen[seen.length - 1]) seen.push(z);
    }
    const want = ["core", "inner", "middle", "outer", null];
    if (JSON.stringify(seen) !== JSON.stringify(want)) crossed = { bearing: k * 5, seen };
  }
  check(`${t}: rings never touch: every bearing crosses Core, Inner, Middle, Outer in turn`, !crossed, crossed);
}

section("where a hunter stands");
{
  const t = 5;
  const slots = ZONE_IDS.map((z, i) => pinSlots(t, i, 30));
  check("every zone has room for someone", slots.every((s) => s.length > 0), slots.map((s) => s.length));
  check("and more room the further out it is", slots.every((s, i) => i === 0 || s.length <= slots[i - 1].length), slots.map((s) => s.length));
  const stray = [];
  slots.forEach((s, i) => s.forEach((p) => { if (zoneOf(t, p.x, p.y) !== ZONE_IDS[i]) stray.push([ZONE_IDS[i], Math.round(p.x), Math.round(p.y)]); }));
  check("every spot lies inside its own zone", stray.length === 0, stray);
  const tight = [];
  slots.forEach((s, i) => s.forEach((p, k) => s.forEach((q, j) => { if (j > k && Math.hypot(p.x - q.x, p.y - q.y) < 29) tight.push([ZONE_IDS[i], k, j]); })));
  check("and no two spots in a zone crowd each other", tight.length === 0, tight);

  const hunters = [
    { id: "me", kind: "me", zone: "inner" },
    { id: "p:thane", kind: "party", zone: "inner" },
    { id: "r:corvin", kind: "realm", zone: "outer" },
    { id: "r:edda", kind: "realm", zone: "middle" },
  ];
  const first = placePins(t, hunters, 30);
  const again = placePins(t, hunters.slice().reverse(), 30);
  check("everyone gets a spot", first.placed.length === hunters.length && first.more.length === 0, first);
  check("in their own zone", first.placed.every((p) => zoneOf(t, p.x, p.y) === p.zone), first.placed);
  const me = first.placed.find((p) => p.id === "me");
  check("you take the first spot of your band, to the south", me.x === slots[2][0].x && me.y === slots[2][0].y && me.y > heartSpot(t).y);
  const mate = first.placed.find((p) => p.id === "p:thane");
  check("your party stands beside you", Math.hypot(mate.x - me.x, mate.y - me.y) < 45, Math.hypot(mate.x - me.x, mate.y - me.y));
  check("and nobody moves when the list comes in another order", JSON.stringify(first.placed.slice().sort((a, b) => a.id.localeCompare(b.id))) === JSON.stringify(again.placed.slice().sort((a, b) => a.id.localeCompare(b.id))));

  const crowd = Array.from({ length: slots[3].length + 4 }, (_, i) => ({ id: `r:${i}`, kind: "realm", zone: "core" }));
  const packed = placePins(t, crowd, 30);
  check("a band with more hunters than spots shows what fits and counts the rest",
    packed.placed.length === slots[3].length - 1 && packed.more.length === 1 && packed.more[0].count === crowd.length - packed.placed.length,
    { placed: packed.placed.length, more: packed.more });
  check("and a hunter on ground the map has no zone for is left off it", placePins(t, [{ id: "x", kind: "realm", zone: "nowhere" }]).placed.length === 0);

  // On a phone the bands are barely a face apart: a mate one band out stands clear of you.
  const narrowGap = (18 * 0.85 + 2) / (358 / MAP_W);
  const across = placePins(t, [{ id: "me", kind: "me", zone: "inner" }, { id: "p:ysolde", kind: "party", zone: "middle" }, { id: "p:thane", kind: "party", zone: "inner" }, ...Array.from({ length: 12 }, (_, i) => ({ id: `r:${i}`, kind: "realm", zone: ZONE_IDS[i % 4] }))], narrowGap);
  const tooClose = [];
  across.placed.forEach((p, k) => across.placed.forEach((q, j) => { if (j > k && Math.hypot(p.x - q.x, p.y - q.y) < narrowGap - 0.01) tooClose.push([p.id, q.id]); }));
  check("on a narrow map no two faces stand on each other, even a band apart", tooClose.length === 0, tooClose);
  const meNarrow = across.placed.find((p) => p.id === "me");
  check("and you still take the south of your own band", meNarrow.x === pinSlots(t, 2, narrowGap)[0].x && meNarrow.y === pinSlots(t, 2, narrowGap)[0].y);

  // In a crowd a zone's name carries a count, so it keeps more room: no spot lands on it.
  const wide = ZONE_IDS.map((z, i) => pinSlots(t, i, 30, 46));
  const nearLabel = [];
  wide.forEach((s, i) => {
    const l = labelSpot(t, i);
    s.forEach((p) => { if (Math.abs(p.x - l.x) < 46 && Math.abs(p.y - l.y) < 12) nearLabel.push([ZONE_IDS[i], Math.round(p.x), Math.round(p.y)]); });
  });
  check("a name given more room keeps every spot clear of it", nearLabel.length === 0, nearLabel);
  const roomy = placePins(t, hunters, 30, 46);
  check("and everyone still stands in their own zone", roomy.placed.length === hunters.length && roomy.placed.every((p) => zoneOf(t, p.x, p.y) === p.zone), roomy.placed);
}

section("a crowd as specks");
for (const t of TIERS) {
  const want = [96, 72, 45, 21];
  const spots = want.map((n, i) => crowdSpots(t, i, n));
  check(`${t}: every zone finds room for as many specks as it is asked for`, spots.every((s, i) => s.length === want[i]), spots.map((s) => s.length));
  const stray = [];
  spots.forEach((s, i) => s.forEach((p) => { if (zoneOf(t, p.x, p.y) !== ZONE_IDS[i]) stray.push([ZONE_IDS[i], Math.round(p.x), Math.round(p.y)]); }));
  check(`${t}: each speck lies in its own zone`, stray.length === 0, stray.slice(0, 5));
  const onName = [];
  spots.forEach((s, i) => {
    const l = labelSpot(t, i);
    s.forEach((p) => { if (Math.abs(p.x - l.x) < 44 && Math.abs(p.y - l.y) < 10) onName.push(ZONE_IDS[i]); });
  });
  check(`${t}: and none on a zone's name`, onName.length === 0, onName);
  const close = [];
  spots.forEach((s) => s.forEach((p, k) => s.forEach((q, j) => { if (j > k && Math.hypot(p.x - q.x, p.y - q.y) < 5.5) close.push([k, j]); })));
  check(`${t}: no two specks run together`, close.length === 0, close.slice(0, 5));
  const fewer = crowdSpots(t, 1, 30);
  check(`${t}: one more hunter adds one more speck and the rest stay put`, JSON.stringify(fewer) === JSON.stringify(spots[1].slice(0, 30)));
}
check("specks become one path of dots", /^(M[-\d.]+ [-\d.]+a[\d.]+ [\d.]+ 0 1 0 [\d.]+ 0a[\d.]+ [\d.]+ 0 1 0 -[\d.]+ 0){3}$/.test(dotsPath(crowdSpots(5, 0, 3), 1.7)), dotsPath(crowdSpots(5, 0, 3), 1.7));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 || passed === 0 ? 1 : 0);
