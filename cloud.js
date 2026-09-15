/* ============================================================
   Respite — cloud.js · The Backend
   ------------------------------------------------------------
   Supabase accounts and cloud saves, save migration, and the
   silent offline catch-up that runs when a save is loaded.
   Game state never touches localStorage.
   ============================================================ */

/* ================= 1. CLIENT ================= */

const sb = (window.supabase && window.RESPITE_SUPABASE_URL && window.RESPITE_SUPABASE_ANON_KEY && window.RESPITE_SUPABASE_ANON_KEY !== "PASTE_YOUR_ANON_KEY_HERE") ? window.supabase.createClient(window.RESPITE_SUPABASE_URL, window.RESPITE_SUPABASE_ANON_KEY) : null;

function emailFor(user) {
  return `${user}@players.respite`;
}

function validUsername(u) {
  return /^[a-z0-9_]{3,20}$/.test(u || "");
}

/* ================= 2. SAVING ================= */

let saveInFlight = false;
let saveQueued = false;
let saveTimer = null;

async function save() {
  state.meta.lastSeen = Date.now();
  if (!sb) return false;

  if (saveInFlight) {
    saveQueued = true;
    return true;
  }
  saveInFlight = true;

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return false;

    state.meta.userId = session.user.id;
    const { error } = await sb.from("saves").update({ data: state, updated_at: new Date().toISOString() }).eq("user_id", session.user.id);
    return !error;
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      saveQueued = false;
      save();
    }
  }
}

function scheduleSave() {
  if (!sb || !state.meta.userId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

/* ================= 3. ACCOUNTS ================= */

async function createAccount(user, pass) {
  user = (user || "").trim().toLowerCase();
  if (!validUsername(user)) return "Invalid username.";
  if ((pass || "").length < 4) return "Password too short.";
  if (!sb) return "Cloud not configured.";

  const { data, error } = await sb.auth.signUp({ email: emailFor(user), password: pass });
  if (error) return error.message;
  if (!data.session) return "Verify email.";

  const userId = data.session.user.id;
  const { error: insErr } = await sb.from("saves").insert({ user_id: userId, username: user, data: state });
  if (insErr) return insErr.message;

  state.meta.account = user;
  state.meta.userId = userId;
  await save();
  return null;
}

async function loginAccount(user, pass) {
  user = (user || "").trim().toLowerCase();
  if (!sb) return "Cloud not configured.";

  const { data, error } = await sb.auth.signInWithPassword({ email: emailFor(user), password: pass });
  if (error) return "Wrong credentials.";

  const userId = data.session.user.id;
  const { data: row, error: selErr } = await sb.from("saves").select("data, updated_at").eq("user_id", userId).single();
  if (selErr) return "Couldn't load save.";

  applyLoadedRow(row, user, userId);
  return null;
}

async function logoutAccount() {
  await save();
  if (sb) await sb.auth.signOut();
  state = freshState();
  refreshBounty();
  render();
}

async function resetCharacter() {
  const acct = state.meta.account;
  const userId = state.meta.userId;
  state = freshState();
  state.meta.account = acct;
  state.meta.userId = userId;
  await save();
  refreshBounty();
  render();
}

/* ================= 4. LOADING ================= */

function migrate(loaded) {
  const base = freshState();
  if (!loaded || typeof loaded !== "object") return base;

  // Copy onto a separate fresh state so `base` keeps every default for the
  // nested merges below (older saves may be missing fields).
  const m = Object.assign(freshState(), loaded);
  m.schema = SCHEMA;

  ["meta", "player", "skills", "equipment", "tasks", "travel", "pets", "stats"].forEach((k) => {
    m[k] = Object.assign(base[k], loaded[k] || {});
  });

  // All three storage pools keep their own slot counts, items and order.
  [["inv", PACK_SLOTS], ["bank", STORES_SLOTS], ["vault", BANK_SLOTS]].forEach(([w, slots]) => {
    const src = loaded[w] || {};
    m[w] = {
      slots: typeof src.slots === "number" ? src.slots : slots,
      items: Object.assign({}, src.items || {}),
      order: (src.order || []).slice(),
    };
  });

  m.wear = Object.assign({}, loaded.wear || {});
  m.tools = Object.assign({}, loaded.tools || {});
  m.yields = (loaded.yields || []).slice(-12);
  m.log = (loaded.log || []).slice(-60).map((e) => (typeof e === "string" ? { t: Date.now(), m: e } : e));

  return m;
}

function applyLoadedRow(row, username, userId) {
  const last = (row.data && row.data.meta && row.data.meta.lastSeen) || Date.parse(row.updated_at) || Date.now();
  state = migrate(row.data);
  state.meta.account = username;
  state.meta.userId = userId;

  const gone = Date.now() - last;
  if (gone > 30000) {
    catchUp({ ms: Math.min(gone, IDLE_CAP_MS), overCap: gone > IDLE_CAP_MS });
  }

  refreshBounty();
  render();
}

function bootLoad() {
  return null;
}

async function resumeCloudSession() {
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;

  const userId = session.user.id;
  const { data: row } = await sb.from("saves").select("data, username, updated_at").eq("user_id", userId).single();
  if (row) applyLoadedRow(row, row.username, userId);
}

/* ================= 5. OFFLINE CATCH-UP ================= */
/* Runs the tick loop in one-second steps for the time you were away
   (capped at 12 hours), then leaves one quiet line in the camp log. */

function heldEverywhere() {
  const out = {};
  ["inv", "bank", "vault"].forEach((w) => {
    const items = store(w).items;
    Object.keys(items).forEach((k) => { out[k] = (out[k] || 0) + items[k]; });
  });
  return out;
}

function catchUp(result) {
  const step = 1000;
  let left = result.ms;
  let guard = 0;
  const goldBefore = state.player.gold;
  const before = heldEverywhere();

  while (left > 0 && (state.tasks.skilling || state.tasks.combat) && guard++ < 100000) {
    tick(Math.min(step, left));
    left -= step;
  }

  state.meta.playtimeMs += result.ms;
  const gains = [];

  const after = heldEverywhere();
  Object.keys(after).forEach((k) => {
    const d = after[k] - (before[k] || 0);
    if (d > 0) gains.push(`${fmt(d)} ${itemName(k)}`);
  });

  if (state.player.gold - goldBefore > 0) {
    gains.push(`${fmt(state.player.gold - goldBefore)} gold`);
  }

  if (result.overCap && (state.tasks.skilling || state.tasks.combat)) {
    state.tasks.skilling = null;
    state.tasks.combat = null;
    say("12 hours passed.");
  }

  if (gains.length) {
    say(`Away ${fmtTime(result.ms)}: ${gains.slice(0, 4).join(", ")}.`);
  }
}
