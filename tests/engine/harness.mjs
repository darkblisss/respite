/* Shared pieces for the engine suites: the PASS/FAIL harness (the same shape
   as registry.test.mjs), deep comparison with a readable first difference,
   the v4 reference loaded in a vm context, and a listening env.

   Not a suite itself: run-all.mjs only runs *.test.mjs. */

import vm from "node:vm";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { matKey } from "../../src/shared/registry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, "../..");
export const refDir = path.resolve(process.env.RESPITE_REF || path.join(repo, "tests", "ref-v4"));

export const shared = (file) => import(pathToFileURL(path.join(repo, "src/shared", file)).href);

/* ================= HARNESS ================= */

let passed = 0;
let failed = 0;

export function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  const extra = !ok && detail !== undefined ? `\n     ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : "";
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra.length > 1200 ? extra.slice(0, 1200) + " ..." : extra}`);
  return !!ok;
}

export const section = (title) => console.log(`\n# ${title}`);

export async function run(main) {
  try {
    await main();
  } catch (e) {
    check("the suite ran to the end", false, e && e.stack);
  }
  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exitCode = failed ? 1 : 0;
}

// En and em dashes and the infinity sign, built from code points so no file holds them.
export const FORBIDDEN = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0x221e)}]`);

export const clone = (v) => JSON.parse(JSON.stringify(v));

/* ================= COMPARING ================= */

// The first place two JSON-like values differ, as "path: a vs b", or null.
export function firstDiff(a, b, where = "$", tolerance = 0) {
  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return null;
    if (tolerance && Number.isFinite(a) && Number.isFinite(b) && !(Number.isInteger(a) && Number.isInteger(b))) {
      const scale = Math.max(Math.abs(a), Math.abs(b), 1e-300);
      if (Math.abs(a - b) / scale <= tolerance) return null;
    }
    return `${where}: ${a} vs ${b}`;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return Object.is(a, b) ? null : `${where}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${where}: array vs object`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${where}.length: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${where}[${i}]`, tolerance);
      if (d) return d;
    }
    return null;
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.join("|") !== kb.join("|")) return `${where} keys: ${ka.join(",")} vs ${kb.join(",")}`;
  for (const k of ka) {
    const d = firstDiff(a[k], b[k], `${where}.${k}`, tolerance);
    if (d) return d;
  }
  return null;
}

export function same(name, a, b, tolerance = 0) {
  const d = firstDiff(clone(a === undefined ? null : a), clone(b === undefined ? null : b), "$", tolerance);
  return check(name, !d, d || undefined);
}

/* ================= THE v4 REFERENCE ================= */

/* Loads data.js, utils.js, cloud.js, combat.js and engine.js as classic
   scripts in their own context, with the page's globals stubbed and the
   clock under test control. */
export function loadV4() {
  const files = ["data.js", "utils.js", "cloud.js", "combat.js", "engine.js"];
  for (const f of files) {
    if (!existsSync(path.join(refDir, f))) throw new Error(`v4 ${f} not found in ${refDir}; set RESPITE_REF`);
  }
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(`
    var __now = 0;
    var __realNow = Date.now;
    Date.now = () => __now;
    var render = () => {}, toast = () => {}, scheduleSave = () => {}, maybeOfferClass = () => {};
    var setTimeout = () => 0, setInterval = () => 0, clearTimeout = () => {};
    var __seedRandom = (n) => { let a = n >>> 0; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  `, ctx);
  files.forEach((f) => vm.runInContext(readFileSync(path.join(refDir, f), "utf8"), ctx, { filename: f }));

  const v4 = (expr) => vm.runInContext(expr, ctx);
  v4.set = (name, value) => {
    ctx.__value = value;
    vm.runInContext(`${name} = __value`, ctx);
    delete ctx.__value;
  };
  v4.now = (ms) => v4.set("__now", ms);
  // Calls a v4 function by name with arguments from this side.
  v4.call = (fn, ...args) => {
    ctx.__args = args;
    const out = vm.runInContext(`${fn}(...__args)`, ctx);
    delete ctx.__args;
    return out;
  };
  v4.seedRandom = (n) => v4.call("__seedRandom", n);
  return v4;
}

/* ================= A LISTENING WORLD ================= */

// An env with the chronicle attached and every event recorded as [type, payload without state].
export async function listening({ party = null, fx = false } = {}) {
  const { createEmitter } = await shared("events.js");
  const { attachChronicle } = await shared("chronicle.js");
  const { makeEnv } = await shared("engine.js");
  const emitter = createEmitter();
  attachChronicle(emitter);
  const events = [];
  emitter.on("*", (payload, type) => {
    const { state, ...rest } = payload;
    events.push([type, rest, state]);
  });
  const env = makeEnv({ emitter, party, fx });
  return { emitter, env, events, of: (type) => events.filter((e) => e[0] === type).map((e) => e[1]) };
}

// A save with something in a pool, without going through the rules.
export function put(state, w, key, qty) {
  state[w].items[key] = (state[w].items[key] || 0) + qty;
  if (!state[w].order.includes(key)) state[w].order.push(key);
}

/* A tier's gear set, exactly as the v4 hunt test built it: build is warrior,
   rogue, mage or light. Relic pieces all carry "vital", as v4's did. */
/* Ids come from the registry's own key, never from the first word of the
   display name. A material is free to be renamed without its id moving, so
   deriving ids from names here quietly builds gear that does not exist: the set
   comes back half empty and the fight it feeds reads as a balance regression
   rather than a broken fixture. Tier 3 delve was already wrong this way before
   anything was renamed, because Gloam Ore has been keyed "cold" since it shipped. */
export function gearSet(GameData, tier, build, rarity = "common") {
  const slug = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
  const t = GameData.TIERS[tier - 1];
  const key = (type) => slug(matKey(t, type));
  const d = key("delve"), f = key("fell"), h = key("harvest"), fl = key("flay"), dr = key("dredge");
  const k = (id) => (rarity === "common" ? `${id}|common` : `${id}|${rarity}|9${rarity === "relic" ? "|vital" : ""}`);
  const heavy = { head: k(`${d}_helm`), chest: k(`${d}_chest`), feet: k(`${d}_hboots`), hands: k(`${d}_hgaunts`) };
  const medium = { head: k(`${fl}_hood`), chest: k(`${fl}_jacket`), feet: k(`${fl}_mboots`), hands: k(`${fl}_mgloves`) };
  const light = { head: k(`${h}_hood`), chest: k(`${h}_robe`), feet: k(`${h}_lboots`), hands: k(`${h}_lgloves`) };
  const jewel = { neck: k(`${dr}_amulet`), ring: k(`${d}_ring`) };
  const blank = { weapon: null, offhand: null, head: null, chest: null, hands: null, feet: null, neck: null, ring: null };
  if (build === "warrior") return { ...blank, weapon: k(`${d}_sword`), offhand: k(`${f}_shield`), ...heavy, ...jewel };
  if (build === "rogue") return { ...blank, weapon: k(`${d}_dagger`), offhand: k(`${dr}_grimoire`), ...medium, ...jewel };
  if (build === "mage") return { ...blank, weapon: k(`${dr}_staff`), ...light, ...jewel };
  if (build === "light") return { ...blank, ...light, ...jewel };
  return blank;
}
