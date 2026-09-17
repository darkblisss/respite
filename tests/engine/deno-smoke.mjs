/* Deno smoke: the shared rules import and play in Deno 2 exactly as they do
   in Node, with no Node APIs anywhere in the way. From the tools folder:

     npx deno run --allow-read tests/engine/deno-smoke.mjs */

import { createState } from "../../src/shared/state.js";
import { advance, applyCommand, makeEnv, awaySnapshot, summariseAway } from "../../src/shared/engine.js";
import { createEmitter } from "../../src/shared/events.js";
import { attachChronicle } from "../../src/shared/chronicle.js";
import { ENGINE_VERSION } from "../../src/shared/version.js";

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? `\n     ${JSON.stringify(detail)}` : ""}`);
}

const runtime = typeof Deno !== "undefined" ? `Deno ${Deno.version.deno}` : "not Deno";
const now = Date.UTC(2026, 8, 16, 9, 0);
const emitter = createEmitter();
attachChronicle(emitter);
const seen = {};
emitter.on("*", (_payload, type) => { seen[type] = (seen[type] || 0) + 1; });
const env = makeEnv({ emitter });

const state = createState({ now, seed: 2026 });
const started = [
  applyCommand(state, { type: "startSkill", args: { skillId: "delving", actionId: "delving_t1_raw", limit: null } }, env),
  applyCommand(state, { type: "startHunt", args: { tier: 1, zone: "outer", limit: null } }, env),
];
const before = awaySnapshot(state);
advance(state, now + 3600000, env);
const away = summariseAway(before, awaySnapshot(state), 3600000);

check(`running in ${runtime}, engine version ${ENGINE_VERSION}`, typeof Deno !== "undefined" && ENGINE_VERSION >= 1);
check("startSkill and startHunt went through", started.every((r) => r.ok), started);
check("an hour played out", state.clock === now + 3600000 && state.stats.actions === 300 && state.stats.kills > 0, state.stats);
check("the chronicle kept the log", state.log.length >= 1 && state.log[0].m === "You take command of a ruin.");
console.log(`     ${state.stats.actions} actions, ${state.stats.kills} kills, ${state.player.gold}g, hunt ${state.tasks.combat ? `${state.tasks.combat.done} kills in` : "over"}, events ${JSON.stringify(seen)}`);
console.log(`     away: ${JSON.stringify(away.gains)}, ${away.gold}g`);
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (typeof Deno !== "undefined") Deno.exit(failed ? 1 : 0);
