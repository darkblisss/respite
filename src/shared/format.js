/* ============================================================
   Respite · format.js · The Scribe
   ------------------------------------------------------------
   Numbers, times and words, the same in the browser, on the
   server and in the camp log. Nothing here reads the save.
   ============================================================ */

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Counts: 9,999 stays whole, then 10.0K, 1.25M, 3.10B.
/* Every number, written out. It used to shorten past ten thousand (12.3K, 4.51M),
   which reads as an approximation of a number the camp knows exactly: a kill
   count, a stack, a price. There is nothing here big enough to need the space,
   and "1,234,567" tells you things "1.23M" does not. */
export function fmt(n) {
  return fmtWhole(Math.floor(Number(n) || 0));
}

// A whole number with thousands marked the same way everywhere: 10000 -> "10,000".
export function fmtWhole(n) {
  const v = Math.trunc(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return v < 0 ? "-" + s : s;
}

// Gold is always the whole amount: "1,600g", "1,250,000g". Never "1.25M".
export const fmtGold = (n) => `${fmtWhole(Math.floor(Number(n) || 0))}g`;

export function fmtTime(ms) {
  const s = Math.round(Math.max(0, Number(ms) || 0) / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// Combat numbers: 0.026 -> "0.03", 3.28 -> "3.3", 403.4 -> "403".
export function fmtStat(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) < 1) return String(Math.round(v * 100) / 100);
  if (Math.abs(v) < 100) return String(Math.round(v * 10) / 10);
  return fmtWhole(Math.round(v));
}

// How long ago: "Just now", "2m ago", "4h ago", "3d ago".
export function fmtAgo(ms) {
  const m = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// 18 -> "+18%", -18 -> "−18%" (a true minus sign).
export function signedPct(n) {
  if (!n) return "0%";
  return `${n > 0 ? "+" : "−"}${Math.abs(n)}%`;
}

// 0.0125 -> "1.25%", 0.5 -> "50%".
export const chancePct = (chance) => `${+((Number(chance) || 0) * 100).toFixed(2)}%`;

// "22:03:52 UTC" for a millisecond timestamp.
export function fmtClock(ms) {
  const d = new Date(Number(ms) || 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

const LOWER_WORDS = ["of", "the", "and"];
export function titleCase(s) {
  return String(s).split(" ").map((w, i) => {
    if (i > 0 && LOWER_WORDS.includes(w.toLowerCase())) return w.toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

// plural(1, "stack") -> "1 stack", plural(3, "stack") -> "3 stacks".
export function plural(n, word, many) {
  return `${fmtWhole(n)} ${n === 1 ? word : many || word + "s"}`;
}
