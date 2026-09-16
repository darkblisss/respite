/* ============================================================
   Respite · cloud.js · The Backend
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

  ["meta", "player", "skills", "equipment", "tasks", "travel", "stats", "settings"].forEach((k) => {
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
  m.inv.slots = PACK_SLOTS;

  m.wear = Object.assign({}, loaded.wear || {});
  m.tools = Object.assign({}, loaded.tools || {});
  m.log = (loaded.log || []).slice(-60).map((e) => (typeof e === "string" ? { t: Date.now(), m: e } : e));
  delete m.yields;
  delete m.pets;

  const lastSeen = (loaded.meta && loaded.meta.lastSeen) || Date.now();
  migrateEconomy(m, loaded, lastSeen);
  migrateTasks(m, lastSeen);
  migrateHunt(m, loaded, lastSeen);
  migrateCompanions(m, loaded, lastSeen);
  settleBelongings(m, lastSeen);
  m.log = m.log.slice(-60);

  return m;
}

// Schema 8 struck new coin: prices and purses are a fifth of what they were.
function migrateEconomy(m, loaded, stamp) {
  if ((loaded.schema || 0) >= 8) return;
  m.player.gold = Math.floor((Number(m.player.gold) || 0) / 5);
  m.stats.goldEarned = Math.floor((Number(m.stats.goldEarned) || 0) / 5);
  m.bounty = null;
  m.log.push({ t: stamp, m: "The camp struck new coin. Purses and prices are a fifth of what they were." });
}

// Puts a stack straight into a save that is still being migrated.
function migrateStash(m, key, qty) {
  const pools = ["inv", "vault", "bank"];
  const where = pools.find((w) => m[w].items[key] != null) ||
    pools.find((w) => Object.keys(m[w].items).length < (w === "inv" ? PACK_SLOTS : m[w].slots));
  if (!where) return false;
  m[where].items[key] = (m[where].items[key] || 0) + qty;
  if (!m[where].order.includes(key)) m[where].order.push(key);
  return true;
}

/* Schema 8 reworked the hunt: zones, Threat by zone, loot straight into
   storage, and recovery counted in game time. */
function migrateHunt(m, loaded, lastSeen) {
  const p = loaded.player || {};
  if (typeof p.recoveryLeft !== "number") {
    m.player.recoveryLeft = clamp((Number(p.recoveryUntil) || 0) - lastSeen, 0, RECOVERY_MS);
  }
  delete m.player.recoveryUntil;
  m.settings = { hideSovereign: !!(m.settings && m.settings.hideSovereign) };

  if ((loaded.schema || 0) < 8) {
    m.threat = {};

    // Unclaimed spoils are carried in, or sold where they lie.
    let carried = 0;
    let sold = 0;
    (loaded.spoils || []).forEach((sp) => {
      const d = sp && itemDef(sp.key);
      const qty = Math.max(0, Math.floor(Number(sp && sp.qty) || 0));
      if (!d || !qty) return;
      if (migrateStash(m, sp.key, qty)) carried++;
      else sold += d.value * qty;
    });
    if (sold) m.player.gold += sold;
    if (carried || sold) {
      m.log.push({ t: lastSeen, m: `Spoils left on the field were carried in${sold ? `, and what didn't fit sold for ${fmtGold(sold)}` : ""}.` });
    }

    // A hunt already underway carries on from the Outer edge of the same ground,
    // with its kill count and limit. One that was already pulling back, had
    // reached its limit or had run twelve hours is over.
    const old = m.tasks.combat;
    const tier = typeof old?.queued === "number" && regionOfTier(old.queued) ? old.queued : old && old.tier;
    const done = Math.max(0, Math.floor(Number(old && old.done) || 0));
    const limit = old && old.limit != null && Number.isFinite(Number(old.limit)) ? Math.max(1, Math.floor(Number(old.limit))) : null;
    const elapsed = clamp(Number(old && old.elapsed) || 0, 0, IDLE_CAP_MS);
    const over = !old || old.queued === "stop" || (limit != null && done >= limit) || elapsed >= IDLE_CAP_MS;
    if (!over && regionOfTier(tier)) {
      const hunt = newHunt(tier, "outer", limit);
      hunt.done = tier === old.tier ? done : 0;
      hunt.elapsed = elapsed;
      hunt.nextMark = (Math.floor(elapsed / XP_MARK_MS) + 1) * XP_MARK_MS;
      hunt.marks = [[hunt.nextMark - XP_MARK_MS, 0]];
      m.tasks.combat = hunt;
    } else {
      m.tasks.combat = null;
    }
  }
  delete m.spoils;

  // Anything that isn't a hunt this version understands is dropped.
  const c = m.tasks.combat;
  if (c && (!regionOfTier(c.tier) || !ZONES.some((z) => z.id === c.zone) || !Array.isArray(c.foes) || !Array.isArray(c.marks))) {
    m.tasks.combat = null;
  }
  if (c && m.tasks.combat) {
    c.foes = c.foes.filter((f) => f && getMonster(f.id) && f.hp > 0);
    if (c.phase === "fight" && !c.foes.length) {
      c.phase = "search";
      c.wait = SEARCH_MIN_MS;
    }
  }

  // Health can't sit above what this version says your most is.
  const most = combatStats({ level: levelFromXp(Number(m.skills.warfare) || 0), klass: m.player.klass, equipment: m.equipment }).maxHp;
  const hp = Number(m.player.hp);
  m.player.hp = Number.isFinite(hp) ? clamp(hp, 0, most) : most;
}

// Tasks from older saves have no batch limit (they run until stopped) and
// no running clock, so the clock is rebuilt from when they started.
function migrateTasks(m, lastSeen) {
  ["skilling", "combat"].forEach((k) => {
    const t = m.tasks[k];
    if (!t || typeof t !== "object") {
      m.tasks[k] = null;
      return;
    }
    if (t.limit === undefined) t.limit = null;
    if (typeof t.elapsed !== "number") t.elapsed = clamp(lastSeen - (t.startedAt || lastSeen), 0, IDLE_CAP_MS);
  });
}

function migrateCompanions(m, loaded, stamp) {
  const src = loaded.companions || {};
  const owned = {};
  Object.keys(src.owned || {}).forEach((id) => {
    const c = src.owned[id];
    if (!c || !companionDef(id)) return;
    owned[id] = {
      bond: clamp(Number(c.bond) || 0, 0, bondXpFor(COMPANION_MAX_BOND)),
      rank: clamp(Math.floor(Number(c.rank) || 1), 1, COMPANION_MAX_RANK),
      dupes: Math.max(0, Math.floor(Number(c.dupes) || 0)),
    };
  });
  m.companions = { owned, active: owned[src.active] ? src.active : null };

  // The old kennel's golem, sprite and mule are retired. Owners get their gold back.
  const pets = loaded.pets || {};
  const refund = Object.keys(RETIRED_PETS).filter((id) => pets[id]).reduce((n, id) => n + RETIRED_PETS[id], 0);
  if (refund) {
    m.player.gold += refund;
    m.log.push({ t: stamp || Date.now(), m: `Your old animals have left the camp. ${fmtGold(refund)} was paid back for them.` });
  }
}

// Belongings hold ten slots now. Anything past that moves to Provisions,
// then the Vault. Whatever still has nowhere to go stays put.
function settleBelongings(m, stamp) {
  const keys = m.inv.order.filter((k) => m.inv.items[k] != null);
  Object.keys(m.inv.items).forEach((k) => { if (!keys.includes(k)) keys.push(k); });

  let moved = 0;
  keys.slice(PACK_SLOTS).forEach((k) => {
    const dest = ["bank", "vault"].find((w) => m[w].items[k] != null || Object.keys(m[w].items).length < m[w].slots);
    if (!dest) return;
    m[dest].items[k] = (m[dest].items[k] || 0) + m.inv.items[k];
    if (!m[dest].order.includes(k)) m[dest].order.push(k);
    delete m.inv.items[k];
    moved++;
  });
  m.inv.order = m.inv.order.filter((k) => m.inv.items[k] != null);

  if (moved) {
    m.log.push({ t: stamp || Date.now(), m: `Belongings now hold ${PACK_SLOTS} slots. ${moved} stack${moved === 1 ? " was" : "s were"} moved into camp storage.` });
  }
}

function applyLoadedRow(row, username, userId) {
  const last = (row.data && row.data.meta && row.data.meta.lastSeen) || Date.parse(row.updated_at) || Date.now();
  state = migrate(row.data);
  state.meta.account = username;
  state.meta.userId = userId;

  const gone = Date.now() - last;
  if (gone > 30000) {
    catchUp({ ms: Math.min(gone, IDLE_CAP_MS), overCap: gone > IDLE_CAP_MS, from: last });
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
   (capped at 12 hours), then leaves one quiet line in the camp log.
   The hunt engine works event by event inside each step, so every
   reinforcement, Sovereign and remedy lands when it would have. */

function heldEverywhere() {
  const out = {};
  ["inv", "bank", "vault"].forEach((w) => {
    const items = store(w).items;
    Object.keys(items).forEach((k) => { out[k] = (out[k] || 0) + items[k]; });
  });
  return out;
}

function catchUp(result) {
  // Five-second steps: the hunt engine lands every event at its own moment inside a step.
  const step = 5000;
  let left = result.ms;
  let guard = 0;
  const goldBefore = state.player.gold;
  const before = heldEverywhere();

  catchingUp = true;
  simClock = result.from != null ? result.from : Date.now() - result.ms;
  try {
    while (left > 0 && (state.tasks.skilling || state.tasks.combat) && guard++ < 100000) {
      const dt = Math.min(step, left);
      simClock += dt;
      tick(dt);
      left -= dt;
    }
    // Whatever time is left passes with nothing running.
    if (left > 0) state.player.recoveryLeft = Math.max(0, state.player.recoveryLeft - left);
  } finally {
    catchingUp = false;
    simClock = null;
    combatFx = [];
  }

  state.meta.playtimeMs += result.ms;
  const gains = [];

  const after = heldEverywhere();
  Object.keys(after).forEach((k) => {
    const d = after[k] - (before[k] || 0);
    if (d > 0) gains.push(`${fmt(d)} ${itemName(k)}`);
  });

  if (state.player.gold - goldBefore > 0) {
    gains.push(fmtGold(state.player.gold - goldBefore));
  }

  if (result.overCap && (state.tasks.skilling || state.tasks.combat)) {
    state.tasks.skilling = null;
    state.tasks.combat = null;
    say("Away more than twelve hours. The crews and the hunt stood down.");
  }

  if (gains.length && !result.quiet) {
    say(`Away ${fmtTime(result.ms)}: ${gains.slice(0, 4).join(", ")}.`);
  }
}
