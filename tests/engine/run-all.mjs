/* Runs every tests/engine/*.test.mjs with this Node, one after another, and
   sums them up. If Deno is at hand (DENO=/path/to/deno, or the tools folder
   beside the repo), the Deno smoke runs too.

     node tests/engine/run-all.mjs */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const suites = readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort();

function tally(output) {
  const m = output.match(/(\d+) passed, (\d+) failed/g);
  if (!m) return null;
  const [, p, f] = m[m.length - 1].match(/(\d+) passed, (\d+) failed/);
  return { passed: Number(p), failed: Number(f) };
}

let passed = 0;
let failed = 0;
let broken = 0;
const rows = [];

function runOne(label, cmd, args, cwd) {
  const t0 = Date.now();
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${res.stdout || ""}${res.stderr || ""}`;
  const t = tally(out);
  const ms = Date.now() - t0;
  if (!t || res.status !== 0) {
    const fails = out.split("\n").filter((l) => l.startsWith("FAIL")).slice(0, 5);
    if (!t) broken++;
    if (t) {
      passed += t.passed;
      failed += t.failed;
    }
    rows.push(`FAIL ${label}: ${t ? `${t.passed} passed, ${t.failed} failed` : "did not report"} (exit ${res.status}, ${ms}ms)${fails.length ? "\n       " + fails.join("\n       ") : ""}`);
    if (!t) rows.push(out.split("\n").slice(-15).map((l) => `       ${l}`).join("\n"));
    return;
  }
  passed += t.passed;
  failed += t.failed;
  rows.push(`PASS ${label}: ${t.passed} passed (${ms}ms)`);
}

for (const f of suites) runOne(f, process.execPath, [path.join(here, f)], repo);

const denoBins = [process.env.DENO, path.resolve(repo, "node_modules/.bin/deno"), path.resolve(repo, "../tools/node_modules/.bin/deno")].filter(Boolean);
const deno = denoBins.find((p) => existsSync(p));
if (deno) runOne("deno-smoke.mjs (Deno)", deno, ["run", "--allow-read", path.join(here, "deno-smoke.mjs")], repo);
else rows.push("SKIP deno-smoke.mjs: no Deno found (set DENO=/path/to/deno)");

console.log(rows.join("\n"));
console.log(`\n${suites.length} suites: ${passed} passed, ${failed} failed${broken ? `, ${broken} did not report` : ""}`);
process.exitCode = failed || broken || rows.some((r) => r.startsWith("FAIL")) ? 1 : 0;
