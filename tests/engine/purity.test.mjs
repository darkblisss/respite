/* Purity: the rules in src/shared run the same in a browser, in Node and in
   Deno, and never reach for the clock, dice or page on their own. Also the
   house rules that apply everywhere: no en or em dash and no infinity sign in
   the repo, header comments, relative .js imports, no module-level game state,
   and CONFIG and GameData still frozen after a long run.

     node tests/engine/purity.test.mjs */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { run, check, section, repo, shared, FORBIDDEN, put } from "./harness.mjs";

const TEXT = /\.(m?js|ts|json|md|html|css|sql|txt|ya?ml|toml)$/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

await run(async () => {
  const sharedDir = path.join(repo, "src/shared");
  const files = readdirSync(sharedDir).filter((f) => f.endsWith(".js")).sort();

  section("src/shared stays pure");
  const expected = ["chronicle.js", "combat.js", "companions.js", "config.js", "engine.js", "events.js", "format.js", "items.js", "lore.js", "market.js",
    "progression.js", "registry.js", "rng.js", "skills.js", "state.js", "stats.js", "storage.js", "version.js", "weather.js", "world.js"];
  check("every module the contract lists is here", expected.every((f) => files.includes(f)), expected.filter((f) => !files.includes(f)));
  const BANNED = /\bDate\.now\b|\bMath\.random\b|\bwindow\.|\bdocument\.|\bsetTimeout\b|\blocalStorage\b|\bconsole\./;
  for (const f of files) {
    const src = readFileSync(path.join(sharedDir, f), "utf8");
    const lines = src.split("\n");
    const hit = lines.findIndex((l) => BANNED.test(l));
    check(`${f}: no clock, dice, page, timers, storage or console`, hit < 0, hit >= 0 && `line ${hit + 1}: ${lines[hit].trim()}`);
    const dated = lines.findIndex((l) => /\bnew Date\b/.test(l));
    if (f !== "format.js") check(`${f}: no new Date`, dated < 0, dated >= 0 && `line ${dated + 1}`);
    const imports = [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
    check(`${f}: imports are ./ siblings with .js extensions`, imports.every((p) => /^\.\/[a-z]+\.js$/.test(p)), imports);
    check(`${f}: header comment in the house style`, new RegExp(`^/\\* =+\\n   Respite · ${f.replace(".", "\\.")} · [A-Z]`).test(src));
    const loose = lines.findIndex((l) => /^(let|var)\s/.test(l));
    check(`${f}: no module-level let or var (no module-level game state)`, loose < 0, loose >= 0 && `line ${loose + 1}: ${lines[loose]}`);
  }
  check("format.js is the one place that makes a Date", /\bnew Date\b/.test(readFileSync(path.join(sharedDir, "format.js"), "utf8")));

  section("House rules across the repo");
  const all = walk(repo).filter((p) => TEXT.test(p));
  const bad = all.filter((p) => FORBIDDEN.test(readFileSync(p, "utf8"))).map((p) => path.relative(repo, p));
  check(`no en dash, em dash or infinity sign in ${all.length} text files`, bad.length === 0, bad);
  const engineMd = path.resolve(repo, "../ENGINE.md");
  let mdOk = true;
  try {
    mdOk = !FORBIDDEN.test(readFileSync(engineMd, "utf8"));
  } catch (e) {
    mdOk = true;
  }
  check("ENGINE.md is clean too", mdOk);

  section("Frozen after a long run");
  const { CONFIG } = await shared("config.js");
  const { GameData } = await shared("registry.js");
  const { createState } = await shared("state.js");
  const { advance, applyCommand } = await shared("engine.js");
  const s = createState({ now: Date.UTC(2026, 8, 16), seed: 9 });
  s.skills.warfare = CONFIG.xpTable[50];
  s.player.gold = 1e6;
  s.travel.unlocked = GameData.REGIONS.map((r) => r.id);
  put(s, "bank", "slag_delve", 500);
  put(s, "bank", "coal", 500);
  applyCommand(s, { type: "buyCompanion", args: { id: "stag" } });
  applyCommand(s, { type: "startHunt", args: { tier: 3, zone: "core", limit: null } });
  applyCommand(s, { type: "startSkill", args: { skillId: "forgemaster", actionId: "craft_slag_bar", limit: null } });
  advance(s, s.clock + 6 * 3600000);
  const loose = [];
  for (const [label, root] of [["CONFIG", CONFIG], ["GameData", GameData]]) {
    const stack = [[root, label]];
    const seen = new Set();
    while (stack.length && loose.length < 3) {
      const [o, where] = stack.pop();
      if (o === null || (typeof o !== "object" && typeof o !== "function") || seen.has(o)) continue;
      seen.add(o);
      if (!Object.isFrozen(o)) loose.push(where);
      for (const k of Reflect.ownKeys(o)) {
        const desc = Object.getOwnPropertyDescriptor(o, k);
        if ("value" in desc) stack.push([desc.value, `${where}.${String(k)}`]);
      }
    }
  }
  check("CONFIG and GameData are frozen all the way down after six hours of play", loose.length === 0 && s.stats.kills > 0, loose);
  const { itemDef } = await shared("items.js");
  const { weatherAt } = await shared("weather.js");
  check("item defs and weather days handed out are frozen", Object.isFrozen(itemDef("slag_sword|rare|c1.1")) && Object.isFrozen(weatherAt(s.clock)) && Object.isFrozen(weatherAt(s.clock).mods));
});
