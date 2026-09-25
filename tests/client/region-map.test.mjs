/* ============================================================
   Respite · tests/client/region-map.test.mjs · The Surveyor
   ------------------------------------------------------------
   The Hunt page's maps, read as numbers: nine regions, each drawn
   the same way every time and unlike the other eight, four bands
   that take a press in the Outer to Core order, rings that stay on
   the page and never touch, and hunters stood where they belong.

     node tests/client/region-map.test.mjs
   ============================================================ */

import { regionMap, MAPPED_TIERS, MAP_W, MAP_H, labelSpot, campSpot, heartSpot, zoneOf, pinSlots, placePins } from "../../src/client/ui/region-map.js";
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
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 || passed === 0 ? 1 : 0);
