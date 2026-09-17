/* ============================================================
   Respite · config.js · The Signal Fire
   ------------------------------------------------------------
   Where the realm is and how this page was opened. index.html
   sets window.RESPITE_SUPABASE_URL and _ANON_KEY before the
   module loads; the dev harness may set RESPITE_DEV. Read once,
   frozen. Safe to import where there is no window at all.
   ============================================================ */

const g = typeof window !== "undefined" ? window : globalThis;

function query() {
  try {
    return new URLSearchParams(g.location && typeof g.location.search === "string" ? g.location.search : "");
  } catch {
    return new URLSearchParams("");
  }
}

const text = (v) => (typeof v === "string" ? v.trim() : "");
const params = query();
const url = text(g.RESPITE_SUPABASE_URL).replace(/\/+$/, "");
const key = text(g.RESPITE_SUPABASE_ANON_KEY);

export const CLIENT = Object.freeze({
  supabaseUrl: url,
  supabaseKey: key,
  // A key left as the template's placeholder is no key at all.
  supabaseConfigured: !!(url && key && key !== "PASTE_YOUR_ANON_KEY_HERE"),
  // ?debug, or the dev server saying so: window.__respite for tests and the console.
  debug: params.has("debug") || g.RESPITE_DEV === true,
  frameMs: 100,
});

// The supabase-js global, when its script loaded. Blocked or offline: guests only.
export function supabaseGlobal() {
  const s = g.supabase;
  return s && typeof s.createClient === "function" ? s : null;
}
