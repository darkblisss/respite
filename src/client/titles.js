/* ============================================================
   Respite · titles.js · The Five Saints
   ------------------------------------------------------------
   One commander stands first on each weapon line, and that is
   worth a name: the Sword Saint, the Aegis, the Shadow, the Sun
   Piercer, the Supreme Magus. Purely a name. Nothing in the rules
   reads it, nothing is granted by it, and it moves the moment
   somebody else takes the line.

   The realm answers the whole set in one call (mastery_saints),
   so this asks once, keeps it for a few minutes, and hands any
   page a title for a name. Every page that draws commanders wants
   the same five rows; none of them should ask on its own.
   ============================================================ */

import { h } from "./ui/dom.js";
import { GameData } from "../shared/registry.js";

const FRESH_MS = 5 * 60 * 1000;   // a title changes hands rarely; a stale one costs nothing
const TITLE_OF = new Map(GameData.WEAPON_LINES.filter((w) => w.title).map((w) => [w.line, w.title]));

let held = new Map();     // lowercased username -> title
let askedAt = 0;
let asking = null;

const key = (name) => String(name == null ? "" : name).trim().toLowerCase();

/* The title a commander wears, or null. Holding two lines is possible and rare;
   the first in the registry's own order wins, so the answer never flickers. */
export function titleFor(username) {
  return held.get(key(username)) || null;
}

export const titleOfLine = (line) => TITLE_OF.get(line) || null;

/* Ask the realm, at most once every few minutes. Safe to call from any page's
   mount: a second caller rides the first one's request. A realm that has not run
   migration 017 answers `missing` and every name simply has no title. */
export function refreshTitles(ctx, { force = false } = {}) {
  const net = ctx && ctx.net;
  if (!net || typeof net.masterySaints !== "function") return Promise.resolve(false);
  if (ctx.account && ctx.account.mode === "guest") return Promise.resolve(false);
  const now = Date.now();
  if (!force && askedAt && now - askedAt < FRESH_MS) return Promise.resolve(false);
  if (asking) return asking;

  askedAt = now;
  asking = Promise.resolve()
    .then(() => net.masterySaints())
    .then((res) => {
      asking = null;
      if (!res || res.error || res.missing) return false;
      const next = new Map();
      res.rows.forEach((r) => {
        const title = r && typeof r.line === "string" ? TITLE_OF.get(r.line) : null;
        const who = key(r && r.username);
        if (title && who && !next.has(who)) next.set(who, title);
      });
      const changed = next.size !== held.size || [...next].some(([k, v]) => held.get(k) !== v);
      held = next;
      return changed;
    })
    .catch(() => {
      asking = null;
      return false;
    });
  return asking;
}

/* The mark itself, so all four screens wear it the same. Not another status
   pill: a title is an honorific, so it reads as gold small caps behind a
   lozenge with no box round it. Returns null for everybody else, which is
   almost everybody. */
export function saintTag(username) {
  const title = titleFor(username);
  return title ? h("span.saint", { title: `First on the realm's ${title.toLowerCase()} line` }, title) : null;
}

// For tests and for a camp that signs out: forget who held what.
export function clearTitles() {
  held = new Map();
  askedAt = 0;
}
