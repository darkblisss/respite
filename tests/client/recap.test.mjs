/* ============================================================
   Respite · tests/client/recap.test.mjs · The Tally
   ------------------------------------------------------------
   The walk's word on the last encounter (ui/recap.js), fed hunt
   states the way the Hunt page's tick feeds them: exact when the
   walk before the fight was seen, silent when it was not, and
   never carried from one hunt into another.

     node tests/client/recap.test.mjs
   ============================================================ */

import { recapTracker } from "../../src/client/ui/recap.js";

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

// A hunt as the engine keeps it, with only the fields the tally reads.
const hunt = (o) => Object.assign({ phase: "search", kind: "normal", encounters: 0, done: 0, xp: 0, drops: {}, clock: 0 }, o);

section("an encounter seen from the walk before it");
{
  const track = recapTracker();
  check("the first walk has nothing to say", track(hunt({ encounters: 40, done: 300, xp: 9000, drops: { coal: 12 }, clock: 18000 }), 7) === null);
  check("nor does the fight", track(hunt({ phase: "fight", encounters: 41, done: 300, xp: 9000, drops: { coal: 12 }, clock: 100 }), 7) === null);
  track(hunt({ phase: "fight", encounters: 41, done: 302, xp: 9110, drops: { coal: 13 }, clock: 16000 }), 7);
  const r = track(hunt({ encounters: 41, done: 303, xp: 9152.4, drops: { coal: 13, tallow: 1 }, clock: 24300 }), 7);
  check("the walk after it says what it came to", !!r && r.n === 41 && r.slain === 3 && Math.round(r.xp) === 152 && r.ms === 24300, r);
  check("only what it left, not the run's whole takings", !!r && JSON.stringify(r.drops) === JSON.stringify({ coal: 1, tallow: 1 }), r && r.drops);
  const again = track(hunt({ encounters: 41, done: 303, xp: 9152.4, drops: { coal: 13, tallow: 1 }, clock: 24300 }), 7);
  check("and keeps saying it for the rest of the walk", again === r);
  check("which the fight after it takes off the screen", track(hunt({ phase: "fight", encounters: 42, done: 303, xp: 9152.4, drops: { coal: 13, tallow: 1 }, clock: 50 }), 7) === null);
  const next = track(hunt({ encounters: 42, done: 305, xp: 9250, drops: { coal: 13, tallow: 1 }, clock: 9000 }), 7);
  check("and the walk after that one tells of it instead", !!next && next.n === 42 && next.slain === 2 && Math.round(next.xp) === 98 && Object.keys(next.drops).length === 0, next);
}

section("an encounter whose start was not seen");
{
  const track = recapTracker();
  track(hunt({ phase: "fight", encounters: 12, done: 90, xp: 400, clock: 8000 }), 3);
  check("first seen mid-fight: no tally, rather than a short one", track(hunt({ encounters: 12, done: 92, xp: 440, clock: 12000 }), 3) === null);
  track(hunt({ encounters: 14, done: 99, xp: 520 }), 3);
  track(hunt({ phase: "fight", encounters: 17, done: 110, xp: 600 }), 3);
  check("caught up past several at once: still nothing", track(hunt({ encounters: 17, done: 112, xp: 640, clock: 7000 }), 3) === null);
}

section("a new hunt starts clean");
{
  const track = recapTracker();
  track(hunt({ encounters: 5, done: 20, xp: 100 }), 1);
  track(hunt({ phase: "fight", encounters: 6, done: 20, xp: 100 }), 1);
  check("the old hunt's tally is there", !!track(hunt({ encounters: 6, done: 22, xp: 130, clock: 5000 }), 1));
  check("and gone once another hunt is out", track(hunt({ encounters: 6, done: 22, xp: 130, clock: 5000 }), 2) === null);
  check("and gone at camp", track(null, null) === null && track(hunt({ encounters: 6, done: 22, xp: 130 }), 1) === null);
}

section("a Sovereign");
{
  const track = recapTracker();
  track(hunt({ encounters: 30, done: 200, xp: 5000, drops: { coal: 4 } }), 9);
  track(hunt({ phase: "fight", kind: "sovereign", encounters: 31, done: 200, xp: 5000, drops: { coal: 4 } }), 9);
  track.felled("veiled_essence");
  const r = track(hunt({ encounters: 31, done: 203, xp: 5900, drops: { coal: 9 }, clock: 95000 }), 9);
  check("felled: said so, and its Essence counted among what it left", !!r && r.kind === "sovereign" && r.felled && !r.broke && r.drops.veiled_essence === 1 && r.drops.coal === 5, r);

  const t2 = recapTracker();
  t2(hunt({ encounters: 3, done: 9, xp: 50 }), 4);
  t2(hunt({ phase: "fight", kind: "sovereign", encounters: 4, done: 9, xp: 50 }), 4);
  t2.broke();
  const b = t2(hunt({ encounters: 4, done: 10, xp: 90, clock: 40000 }), 4);
  check("broken away from: said so, with what fell before it", !!b && b.broke && !b.felled && b.slain === 1, b);
  t2.felled("veiled_essence");
  check("an event with no encounter under way changes nothing", t2(hunt({ encounters: 4, done: 10, xp: 90, clock: 40000 }), 4).felled === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
