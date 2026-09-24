/* ============================================================
   Respite · dev/stamp-site.mjs · The Stamp
   ------------------------------------------------------------
   Builds the site GitHub Pages serves, with every script and
   sheet stamped with the commit it came from:

     node dev/stamp-site.mjs _site <version>

   GitHub Pages lets a browser keep any file for ten minutes.
   Deploy a change and a returning player gets the new page with
   last hour's scripts, which is how a camp ends up "Outdated"
   until the cache runs out. A stamped file has a new address
   every deploy (main.js?v=a1b2c3d4), so the browser has never
   seen it and has to fetch it; a file that has not changed keeps
   the old stamp only until the next deploy, which is fine.

   Everything tracked is copied as it is except:
     index.html  css/*.css and src/*.js links get ?v=<version>
     src/**.js   every relative import gets ?v=<version>, static
                 (import/export ... from "./x.js", import "./x.js")
                 and dynamic (import(`./pages/${f}.js`))
   Nothing else changes: no bundling, no minifying, the files a
   player's browser runs are the files in the repo.
   ============================================================ */

import fs from "node:fs";
import path from "node:path";

const [out = "_site", version = Date.now().toString(36)] = process.argv.slice(2);
const root = process.cwd();
const outDir = path.resolve(root, out);
const SKIP = new Set([".git", ".github", "node_modules", path.basename(outDir)]);
const v = `?v=${encodeURIComponent(version)}`;

function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(e.name) && from === root) continue;
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copy(a, b);
    else if (e.isFile()) fs.copyFileSync(a, b);
  }
}

// "./x.js" and "../y/z.js", in quotes after from/import, and inside import(`...`).
const STATIC = /(\b(?:from|import)\s*)(["'])(\.{1,2}\/[^"'`]+?\.m?js)\2/g;
const DYNAMIC = /(\bimport\(\s*`)(\.{1,2}\/[^`]+?\.m?js)(`\s*\))/g;

function stampJs(file) {
  const src = fs.readFileSync(file, "utf8");
  let n = 0;
  const outText = src
    .replace(STATIC, (m, lead, q, spec) => { n++; return `${lead}${q}${spec}${v}${q}`; })
    .replace(DYNAMIC, (m, lead, spec, tail) => { n++; return `${lead}${spec}${v}${tail}`; });
  if (n) fs.writeFileSync(file, outText);
  return n;
}

function walk(dir, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, fn);
    else if (/\.m?js$/.test(e.name)) fn(p);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
copy(root, outDir);

let imports = 0;
walk(path.join(outDir, "src"), (f) => { imports += stampJs(f); });

const indexFile = path.join(outDir, "index.html");
let html = fs.readFileSync(indexFile, "utf8");
let links = 0;
html = html.replace(/(\b(?:href|src)=")((?:css|src)\/[^"?]+\.(?:css|m?js))(")/g, (m, a, file, b) => { links++; return `${a}${file}${v}${b}`; });
fs.writeFileSync(indexFile, html);
// Served as they are: no Jekyll pass over the files.
fs.writeFileSync(path.join(outDir, ".nojekyll"), "");

console.log(`stamped ${version}: ${links} links in index.html, ${imports} imports in src`);
