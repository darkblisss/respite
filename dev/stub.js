/* ============================================================
   Respite · dev/stub.js · The Understudy
   ------------------------------------------------------------
   A stand-in for the real store and net, for building and
   screenshotting pages before the client core exists, and for
   tests that want a page on a known save. The ctx it makes has
   the exact shape CLIENT.md describes. Never loaded by index.html.
   ============================================================ */

import { CONFIG } from "../src/shared/config.js";
import { GameData } from "../src/shared/registry.js";
import { createState } from "../src/shared/state.js";
import { advance, applyCommand, makeEnv, SERVER_ONLY } from "../src/shared/engine.js";
import { createEmitter } from "../src/shared/events.js";
import { attachChronicle } from "../src/shared/chronicle.js";
import { maxHp } from "../src/shared/stats.js";
import { toast } from "../src/client/ui/overlay.js";
// For the in-memory realm (last section).
import { levelsOf, totalLevel } from "../src/shared/stats.js";
import { huntPresence } from "../src/shared/combat.js";
import { itemDef, itemName } from "../src/shared/items.js";
import { applyPurchase, applyReturn, marketFee, prepareListing, remintKey } from "../src/shared/market.js";
import { fmtWhole } from "../src/shared/format.js";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/* ================= 1. STORE ================= */

export function createStubStore({ state, mode = "guest", username = null, party = null } = {}) {
  const bus = createEmitter();
  attachChronicle(bus);
  const live = makeEnv({ emitter: bus, fx: true, party: partyIntervals(party) });
  const wall0 = Date.now();
  const clock0 = state.clock;

  const store = {
    mode,
    state,
    bus,
    party,
    online: mode === "guest" ? null : 12,
    status: { conn: mode === "guest" ? "guest" : "online", pending: 0, lastSyncAt: null, error: null },
    now: () => clock0 + (Date.now() - wall0),
    account: () => ({ mode, username: mode === "guest" ? null : username || "morwen", userId: mode === "guest" ? null : "00000000-0000-4000-8000-000000000001" }),
    frame() {
      advance(store.state, store.now(), live);
    },
    async dispatch(type, args = {}) {
      store.frame();
      // Signed in, the market's commands run against the in-memory realm; resetCamp still has no server.
      if (mode !== "guest" && REALM_COMMANDS.includes(type)) return realmOf(store).command(type, args, live);
      if (SERVER_ONLY.includes(type) || type === "resetCamp") {
        return mode === "guest" ? { ok: false, error: "Sign in to trade." } : { ok: false, error: "The stub has no server." };
      }
      return applyCommand(store.state, { type, args }, live);
    },
    async sync() {},
    async refreshParty() { return store.party; },
    destroy() {},
  };
  return store;
}

// Other members' hunts only, as the server builds them: your own never counts.
function partyIntervals(party, selfId = "00000000-0000-4000-8000-000000000001") {
  if (!party || !Array.isArray(party.members)) return null;
  const intervals = party.members
    .filter((m) => m.hunt && m.user_id !== selfId)
    .map((m) => ({
      tier: m.hunt.tier,
      zone: m.hunt.zone,
      start: Date.parse(m.hunt.started_at),
      end: m.hunt.ended_at ? Date.parse(m.hunt.ended_at) : Date.parse(m.hunt.ends_by),
    }));
  return { intervals };
}

/* ================= 2. CTX ================= */

// The page context of CLIENT.md, built on any store with the same shape.
export function createCtx(store, { route = { page: "character", arg: null }, net = stubNet(store) } = {}) {
  const tickers = new Set();
  const offs = new Set();
  const ctx = {
    store,
    net,
    route,
    get state() { return store.state; },
    get now() { return store.state.clock; },
    get account() { return store.account(); },
    get party() { return store.party; },
    go(hash) { location.hash = hash; },
    async dispatch(type, args = {}, { quiet = false } = {}) {
      const res = await store.dispatch(type, args);
      if (!res.ok && !quiet) toast(res.error || "That didn't work", { kind: "warn" });
      tickers.forEach((fn) => fn(ctx));
      return res;
    },
    onTick(fn) {
      tickers.add(fn);
      return () => tickers.delete(fn);
    },
    on(type, fn) {
      const off = store.bus.on(type, fn);
      offs.add(off);
      return () => { off(); offs.delete(off); };
    },
    // For the runner: one frame of the loop.
    _tick() {
      store.frame();
      tickers.forEach((fn) => fn(ctx));
    },
    _release() {
      offs.forEach((off) => off());
      offs.clear();
      tickers.clear();
    },
  };
  return ctx;
}

function stubNet(store) {
  const guest = () => store.mode === "guest";
  const refuse = async () => ({ data: null, error: guest() ? "Sign in first." : "The stub has no server." });
  return {
    enabled: false,
    session: async () => (guest() ? null : store.account()),
    signIn: async () => "The stub has no server.",
    signUp: async () => "The stub has no server.",
    signOut: async () => {},
    game: async () => ({ ok: false, error: "server_error" }),
    rpc: refuse,
    // The market, parties, chat and the hiscores answer from the in-memory realm (last section).
    market: {
      browse: async (args) => realmOf(store).browse(args),
      mine: async () => realmOf(store).mine(),
      sales: async () => realmOf(store).sales(),
    },
    party: {
      state: async () => (guest() ? { data: store.party, error: null } : realmOf(store).partyState()),
      create: async (name) => (guest() ? refuse() : realmOf(store).create(name)),
      invite: async (username) => (guest() ? refuse() : realmOf(store).invite(username)),
      cancelInvite: async (id) => (guest() ? refuse() : realmOf(store).cancelInvite(id)),
      respond: async (id, accept) => (guest() ? refuse() : realmOf(store).respond(id, accept)),
      leave: async () => (guest() ? refuse() : realmOf(store).leave()),
      kick: async (userId) => (guest() ? refuse() : realmOf(store).kick(userId)),
      say: async (body) => (guest() ? refuse() : realmOf(store).say(body)),
      subscribe: (partyId, onChange) => realmOf(store).subscribe(partyId, onChange),
    },
    hiscores: async (skill, limit) => realmOf(store).hiscores(skill, limit),
    groundHunters: async (tier) => (guest() ? { rows: [], error: "Sign in first.", missing: false } : groundHunters(store, tier)),
    onlineCount: async () => 12,
    heartbeat: async () => {},
  };
}

const SAMPLE_LISTINGS = [
  { id: 101, seller_id: "u2", seller_name: "thane", item_key: "bog_delve", item_base: "bog_delve", item_name: "Bog Ore", item_kind: "material", item_tier: 2, rarity: null, qty: 200, qty_left: 140, price_each: 3, created_at: new Date(Date.now() - 2 * HOUR).toISOString(), expires_at: new Date(Date.now() + 5 * 24 * HOUR).toISOString() },
  { id: 102, seller_id: "u3", seller_name: "ysolde", item_key: "bog_sword|rare|c41.7", item_base: "bog_sword", item_name: "Rare Bog Sword", item_kind: "gear", item_tier: 2, rarity: "rare", qty: 1, qty_left: 1, price_each: 420, created_at: new Date(Date.now() - 30 * MIN).toISOString(), expires_at: new Date(Date.now() + 6 * 24 * HOUR).toISOString() },
  { id: 103, seller_id: "u4", seller_name: "corvin", item_key: "provision_t3", item_base: "provision_t3", item_name: "Gravemoss Poultice", item_kind: "material", item_tier: 3, rarity: null, qty: 50, qty_left: 50, price_each: 12, created_at: new Date(Date.now() - 5 * MIN).toISOString(), expires_at: new Date(Date.now() + 7 * 24 * HOUR).toISOString() },
];

const SAMPLE_HISCORES = [
  { rank: 1, username: "ysolde", level: 412, xp: 1893221 },
  { rank: 2, username: "thane", level: 388, xp: 1520330 },
  { rank: 3, username: "morwen", level: 301, xp: 902114 },
  { rank: 4, username: "corvin", level: 244, xp: 610902 },
];

/* ================= 3. SCENARIOS ================= */
/* Saves on known footing. Items are put straight into pools: this is a stub,
   the rules would never let a page do that. */

const at = (level) => CONFIG.xpTable[level] + 1;

function put(state, w, key, qty) {
  const pool = state[w];
  pool.items[key] = (pool.items[key] || 0) + qty;
  if (!pool.order.includes(key)) pool.order.push(key);
}

function unlock(state, ...ids) {
  ids.forEach((id) => { if (!state.travel.unlocked.includes(id)) state.travel.unlocked.push(id); });
}

function levels(state, map) {
  Object.keys(map).forEach((id) => { state.skills[id] = at(map[id]); });
}

// Scenario time writes the camp log like the real thing.
function chronicled() {
  const emitter = createEmitter();
  attachChronicle(emitter);
  return makeEnv({ emitter });
}

function run(state, cmd, env) {
  const res = applyCommand(state, cmd, env);
  if (!res.ok) throw new Error(`scenario command ${cmd.type} refused: ${res.error}`);
  return res;
}

export const SCENARIOS = {
  // The first minute: a ruin, nothing held.
  fresh(now) {
    return createState({ now, seed: 7, account: null });
  },

  // Tier 2, a bit of everything going on.
  midgame(now) {
    const env = chronicled();
    const s = createState({ now: now - 40 * MIN, seed: 11, account: "morwen" });
    levels(s, { delving: 24, felling: 12, harvesting: 9, flaying: 15, dredging: 7, forgemaster: 21, woodwright: 11, tanner: 14, weaver: 6, artificer: 3, warfare: 31 });
    s.player.klass = "warrior";
    s.player.gold = 12345;
    unlock(s, "region_2", "region_3");
    s.region = "region_2";
    put(s, "bank", "bog_delve", 147);
    put(s, "bank", "coal", 30);
    put(s, "bank", "slag_delve", 400);
    put(s, "bank", "bog_bar", 12);
    put(s, "bank", "blood_fell", 88);
    put(s, "bank", "vault_chest", 1);
    put(s, "inv", "provision_t1", 12);
    put(s, "inv", "provision_t3", 5);
    put(s, "inv", "bog_sword|rare|c41.7", 1);
    put(s, "inv", "bristle_jacket|common", 1);
    put(s, "vault", "slag_bar", 60);
    put(s, "vault", "bog_dagger|relic|c42.3|sundering", 1);
    s.equipment.weapon = "bog_greatsword|uncommon|c45.2";
    s.equipment.head = "bog_helm|common";
    s.equipment.chest = "bog_chest|common";
    s.equipment.neck = "river_amulet|common";
    s.wear["bog_helm|common"] = 310;
    s.tools.delving = "bog_pick";
    s.companions.owned.hound = { bond: 42, rank: 2, dupes: 0 };
    s.companions.owned.rat = { bond: 5, rank: 1, dupes: 1 };
    s.companions.active = "hound";
    s.player.hp = maxHp(s);
    run(s, { type: "startSkill", args: { skillId: "delving", actionId: "delving_t2_raw", limit: 200 } }, env);
    run(s, { type: "startHunt", args: { tier: 2, zone: "inner", limit: null } }, env);
    advance(s, now, env);
    return s;
  },

  // At the bench with stock for a long run, and one recipe short.
  crafter(now) {
    const env = chronicled();
    const s = createState({ now: now - 5 * MIN, seed: 13, account: "morwen" });
    levels(s, { delving: 22, forgemaster: 21, warfare: 4 });
    s.player.gold = 820;
    unlock(s, "region_2", "region_3");
    s.region = "region_2";
    put(s, "bank", "bog_delve", 600);
    put(s, "bank", "coal", 240);
    put(s, "bank", "bog_bar", 40);
    put(s, "bank", "bog_blade", 3);
    run(s, { type: "startSkill", args: { skillId: "forgemaster", actionId: "craft_bog_bar", limit: null } }, env);
    advance(s, now, env);
    return s;
  },

  // Deep in: a Mage on tier 5 ground, hiding on, remedies held.
  hunter(now) {
    const env = chronicled();
    const s = createState({ now: now - 25 * MIN, seed: 17, account: "morwen" });
    levels(s, { warfare: 40, delving: 41, forgemaster: 40, weaver: 42 });
    s.player.klass = "mage";
    s.player.gold = 30400;
    unlock(s, "region_2", "region_3", "region_4", "region_5");
    s.region = "region_5";
    s.settings.hideSovereign = true;
    const t5 = Object.values(GameData.GEAR).filter((g) => g.tier === 5);
    const pick = (slot, prof) => t5.find((g) => g.slot === slot && (!prof || g.prof === prof));
    s.equipment.weapon = `${pick("weapon", "woodwright") ? pick("weapon", "woodwright").id : pick("weapon").id}|rare|c50.1`;
    ["head", "chest", "hands", "feet"].forEach((slot) => { const g = pick(slot, "weaver") || pick(slot); if (g) s.equipment[slot] = `${g.id}|common`; });
    put(s, "inv", "provision_t4", 30);
    put(s, "inv", "provision_t3", 18);
    s.companions.owned.stag = { bond: 300, rank: 1, dupes: 0 };
    s.companions.active = "stag";
    s.player.hp = maxHp(s);
    run(s, { type: "startHunt", args: { tier: 5, zone: "core", limit: null } }, env);
    advance(s, now, env);
    return s;
  },

  // Plenty of gold and ground open: shop, atlas, companions, requisitions.
  rich(now) {
    const env = chronicled();
    const s = createState({ now: now - 2 * HOUR, seed: 19, account: "morwen" });
    levels(s, { delving: 45, felling: 38, harvesting: 33, flaying: 30, dredging: 29, forgemaster: 40, woodwright: 31, tanner: 22, weaver: 20, artificer: 18, warfare: 44 });
    s.player.klass = "rogue";
    s.player.gold = 54321;
    unlock(s, "region_2", "region_3", "region_4", "region_5", "region_6");
    s.region = "region_4";
    run(s, { type: "hireAgent", args: {} }, env);
    run(s, { type: "hireAgent", args: {} }, env);
    const agent = s.agents[0];
    run(s, { type: "deployAgent", args: { agentId: agent.id, itemKey: "coal" } }, env);
    s.companions.owned.crow = { bond: 1200, rank: 3, dupes: 1 };
    s.companions.active = "crow";
    advance(s, now, env);
    return s;
  },

  // Midgame with this window's bounty finished and not yet claimed: Bounties, and the Atlas's warning on leaving.
  bountyReady(now) {
    const s = SCENARIOS.midgame(now);
    s.bounty.progress = s.bounty.amount;
    return s;
  },

  // Rich, with Belongings full of odds and ends: where a purchase lands when it can't go first choice.
  packed(now) {
    const s = SCENARIOS.rich(now);
    ["slag_delve", "bitter_fell", "stink_harvest", "mangy_flay", "mud_dredge", "bog_delve", "blood_fell", "grave_harvest", "bristle_flay", "river_dredge"]
      .forEach((key) => put(s, "inv", key, 5));
    return s;
  },

  // A Rogue put down in the Core of Gallowmoor a minute and a half ago: the Hunt page while recovering.
  // The fight is played once to learn when it ends, then again from further back so the fall lands then.
  recovering(now) {
    const make = (start) => {
      const s = createState({ now: start, seed: 23, account: "morwen" });
      levels(s, { warfare: 14, delving: 12, felling: 9 });
      s.player.klass = "rogue";
      s.player.gold = 640;
      unlock(s, "region_2");
      s.region = "region_2";
      s.player.hp = maxHp(s);
      return s;
    };
    const hunt = { type: "startHunt", args: { tier: 2, zone: "core", limit: null } };
    let fellAfter = null;
    const heard = createEmitter();
    heard.on("hunt:death", (p) => { if (fellAfter == null) fellAfter = p.at - now; });
    const probe = make(now);
    const probeEnv = makeEnv({ emitter: heard });
    run(probe, hunt, probeEnv);
    advance(probe, now + 12 * HOUR, probeEnv);
    const env = chronicled();
    const s = make(now - (fellAfter == null ? 0 : fellAfter) - 90 * 1000);
    run(s, hunt, env);
    advance(s, now, env);
    if (!(s.player.recoveryLeft > 0)) s.player.recoveryLeft = 3 * MIN;   // a stub: never hand back a standing hunter
    return s;
  },

  // Hunt level 5 and no discipline yet, out in the Outer of the Ashen Verge: the picker is due, no Veil anywhere.
  discipline(now) {
    const env = chronicled();
    const s = createState({ now: now - 8 * MIN, seed: 29, account: "morwen" });
    levels(s, { warfare: 5, felling: 6, delving: 4 });
    s.player.gold = 160;
    const sword = Object.values(GameData.GEAR).find((g) => g.tier === 1 && g.slot === "weapon");
    s.equipment.weapon = `${sword.id}|common`;
    put(s, "inv", "provision_t1", 6);
    s.player.hp = maxHp(s);
    run(s, { type: "startHunt", args: { tier: 1, zone: "outer", limit: 200 } }, env);
    advance(s, now, env);
    return s;
  },
};

// A party of three, two of them hunting, for the party page and the hunt bonus.
export function sampleParty(now) {
  const iso = (ms) => new Date(ms).toISOString();
  return {
    party: { id: "11111111-2222-4333-8444-555555555555", name: "The Lantern Watch", leader_id: "00000000-0000-4000-8000-000000000001" },
    members: [
      { user_id: "00000000-0000-4000-8000-000000000001", username: "morwen", joined_at: iso(now - 3 * 24 * HOUR), last_seen: iso(now), activity: { skill: "delving", action: "delving_t2_raw" }, total_level: 301, levels: { warfare: 31 }, hunt: { tier: 2, zone: "inner", started_at: iso(now - 40 * MIN), ends_by: iso(now + 11 * HOUR), ended_at: null } },
      { user_id: "00000000-0000-4000-8000-000000000002", username: "thane", joined_at: iso(now - 2 * 24 * HOUR), last_seen: iso(now - MIN), activity: {}, total_level: 388, levels: { warfare: 36 }, hunt: { tier: 2, zone: "inner", started_at: iso(now - HOUR), ends_by: iso(now + 11 * HOUR), ended_at: null } },
      { user_id: "00000000-0000-4000-8000-000000000003", username: "ysolde", joined_at: iso(now - 24 * HOUR), last_seen: iso(now - 50 * MIN), activity: { skill: "weaver", action: "craft_grave_robe" }, total_level: 412, levels: { warfare: 20 }, hunt: null },
    ],
    invites_in: [],
    invites_out: [{ id: 9, to_name: "corvin", created_at: iso(now - 10 * MIN) }],
    messages: [
      { id: 1, user_id: "00000000-0000-4000-8000-000000000002", username: "thane", body: "Inner of Gallowmoor, anyone? Threat is low.", created_at: iso(now - 12 * MIN) },
      { id: 2, user_id: "00000000-0000-4000-8000-000000000001", username: "morwen", body: "On my way. Bringing poultices.", created_at: iso(now - 11 * MIN) },
    ],
  };
}

export function buildScenario(name, now = Date.now()) {
  const make = SCENARIOS[name] || SCENARIOS.midgame;
  return make(now);
}

/* ================= THE REALM, IN MEMORY ================= */
/* The market, parties, party chat and the hiscores for the stub, kept
   per store so the realm pages can be driven end to end with no server:
   browse and filter, buy, list from the sell dialog, take back, found a
   party, invite, cancel, answer, kick, leave and chat. The refusals are
   the real ones (supabase/schema.sql, src/server/handler.js) and the
   save side runs the shared market rules, so the camp changes as it
   would. A party passed to the store (party=1) is where it starts;
   without one, an invite from The Grey Lantern is waiting. */

const REALM_COMMANDS = ["marketList", "marketBuy", "marketCancel"];
const DAY = 24 * HOUR;
const REALM_PLAYERS = ["ysolde", "thane", "veyra", "edda", "brannoch", "rook", "hollis", "wren", "corvin", "sable", "isolde", "ashlin", "tobin", "mara", "quill", "orrin", "fen", "hask"];
const IN_OTHER_PARTY = ["veyra", "edda"];   // The Grey Lantern
const GREY_LANTERN = "22222222-3333-4444-8555-666666666666";

function realmOf(store) {
  if (!store._realm) store._realm = makeRealm(store);
  return store._realm;
}

// A small, steady hash so every stub player keeps the same levels.
function realmHash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}

/* Who else is out, as ground_hunters() (migration 018) would answer: about a
   third of the realm on any ground, each on a steady zone, face and start.
   It needs nothing else from the realm, so it stands on its own. */
function groundHunters(store, tier) {
  const t = Number(tier);
  if (!Number.isInteger(t) || t < 1 || t > GameData.REGIONS.length) return { rows: [], error: "No such ground.", missing: false };
  const now = store.now();
  const me = store.account().username;
  const zones = GameData.ZONES.map((z) => z.id);
  const rows = REALM_PLAYERS.filter((name) => name !== me && realmHash(`${name}:${t}`) % 3 === 0).map((name) => {
    const n = realmHash(`${name}:ground:${t}`);
    return {
      username: name,
      skin: GameData.SKINS[n % GameData.SKINS.length].id,
      discipline: [null, "warrior", "rogue", "mage"][n % 4],
      zone: zones[n % zones.length],
      started_at: new Date(now - ((n % 400) + 3) * MIN).toISOString(),
    };
  });
  return { rows, error: null, missing: false };
}

function makeRealm(store) {
  const iso = (ms) => new Date(ms).toISOString();
  const t0 = store.now();
  const me = () => store.account();
  const refuse = (error) => ({ ok: false, error });
  const answer = (data) => ({ data, error: null });
  const fail = (error) => ({ data: null, error });
  const trim = (v) => String(v == null ? "" : v).replace(/^\s+|\s+$/g, "");
  let serial = 1000;

  /* ---------- the market ---------- */

  const row = (id, seller, key, qty, left, price, age, { status = "open", life = 7 * DAY, touched = null } = {}) => {
    const d = itemDef(key);
    const mine = seller === me().username;
    return {
      id, seller_id: mine ? me().userId : `u-${seller}`, seller_name: seller, item_key: key, item_base: key.split("|")[0],
      item_name: itemName(key), item_kind: d.kind, item_tier: d.tier == null ? null : d.tier, rarity: d.kind === "material" ? null : d.rarity,
      qty, qty_left: left, price_each: price, status,
      created_at: iso(t0 - age), expires_at: iso(t0 - age + life), updated_at: iso(touched == null ? t0 - age : t0 - touched),
    };
  };

  const listings = SAMPLE_LISTINGS.map((r) => ({ status: "open", updated_at: r.created_at, ...r })).concat([
    row(201, "edda", "bog_bar", 20, 12, 14, 3 * HOUR),
    row(202, "rook", "bog_pick", 1, 1, 96, DAY),
    row(203, "veyra", "river_amulet|legendary|c9.9", 1, 1, 2400, 2 * DAY),
    row(204, "wren", "grave_harvest", 150, 150, 3, 40 * MIN),
    row(205, "corvin", "slag_delve", 300, 200, 2, 5 * HOUR),
    row(206, "wren", "coal", 50, 50, 5, 6 * HOUR),
    row(207, "hollis", "bristle_jacket|common", 3, 2, 190, 9 * HOUR),
    row(208, "sable", "provision_t1", 40, 25, 4, 30 * HOUR),
    row(209, "brannoch", "cold_delve", 80, 80, 6, 50 * MIN),
    row(210, "thane", "bog_greatsword|epic|c7.1", 1, 1, 1250, 4 * DAY),
    row(301, me().username || "morwen", "bog_bar", 20, 8, 14, 2 * HOUR),
    row(302, me().username || "morwen", "coal", 50, 50, 5, 20 * MIN),
    row(303, me().username || "morwen", "slag_bar", 40, 0, 6, 30 * HOUR, { status: "sold", touched: 20 * HOUR }),
    row(304, me().username || "morwen", "blood_fell", 100, 30, 2, 8 * DAY, { status: "expired", touched: DAY }),
    row(305, me().username || "morwen", "grave_harvest", 60, 60, 3, 3 * DAY, { status: "cancelled", touched: 2 * DAY }),
  ]);

  const sale = (id, listing, sellerMine, qty, age) => {
    const l = listings.find((r) => r.id === listing) || {};
    const total = qty * (l.price_each || 1);
    return {
      id, listing_id: listing, seller_id: sellerMine ? me().userId : l.seller_id, buyer_id: sellerMine ? "u-thane" : me().userId,
      item_key: l.item_key, item_name: l.item_name, qty, price_each: l.price_each, fee: marketFee(total), created_at: iso(t0 - age),
    };
  };
  const sales = [
    sale(901, 301, true, 5, HOUR),
    sale(902, 301, true, 7, 90 * MIN),
    sale(903, 303, true, 40, 20 * HOUR),
    { id: 904, listing_id: 150, seller_id: "u-ysolde", buyer_id: me().userId, item_key: "bog_dagger|rare|c3.3", item_name: "Rare Bog Dagger", qty: 1, price_each: 380, fee: marketFee(380), created_at: iso(t0 - DAY - 2 * HOUR) },
    { id: 905, listing_id: 151, seller_id: "u-sable", buyer_id: me().userId, item_key: "provision_t1", item_name: "Bitter-Ash Salve", qty: 30, price_each: 4, fee: marketFee(120), created_at: iso(t0 - 2 * DAY) },
  ];

  const newest = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id;

  function browse({ q = "", kind = null, tier = null, sort = "price", limit = 50, offset = 0 } = {}) {
    const now = store.now();
    const needle = trim(q).toLowerCase();
    const rows = listings
      .filter((r) => r.status === "open" && Date.parse(r.expires_at) > now)
      .filter((r) => !needle || r.item_name.toLowerCase().includes(needle))
      .filter((r) => !kind || r.item_kind === kind)
      .filter((r) => tier == null || Number(r.item_tier) === Number(tier))
      .sort(sort === "newest" ? newest : (a, b) => a.price_each - b.price_each || a.id - b.id);
    const from = Math.max(0, Number(offset) || 0);
    return { rows: rows.slice(from, from + Math.max(1, Number(limit) || 50)).map((r) => ({ ...r })), error: null };
  }

  function command(type, args, env) {
    const a = args && typeof args === "object" ? args : {};
    const now = store.now();
    const id = me().userId;
    const E = CONFIG.economy;

    if (type === "marketList") {
      const open = listings.filter((r) => r.seller_id === id && r.status === "open").length;
      if (open >= E.marketMaxListings) return refuse(`You already have ${E.marketMaxListings} listings open.`);
      const prep = prepareListing(store.state, { key: a.key, from: a.from, qty: a.qty, price: a.price }, env);
      if (!prep || !prep.ok) return refuse(prep && prep.error);
      const d = prep.data;
      const listing = {
        id: ++serial, seller_id: id, seller_name: me().username, item_key: d.key, item_base: d.base, item_name: d.name,
        item_kind: d.kind, item_tier: d.tier, rarity: d.rarity, qty: d.qty, qty_left: d.qty, price_each: d.priceEach,
        status: "open", created_at: iso(now), expires_at: iso(now + E.marketListingDays * DAY), updated_at: iso(now),
      };
      listings.push(listing);
      return { ok: true, data: { listingId: listing.id } };
    }

    const listingId = Number.isSafeInteger(a.listingId) && a.listingId > 0 ? a.listingId : null;
    const gone = refuse("That listing is gone.");

    if (type === "marketBuy") {
      if (!listingId) return gone;
      if (!Number.isInteger(a.qty) || a.qty < 1) return refuse("Choose how many to buy.");
      const l = listings.find((r) => r.id === listingId);
      if (!l || l.status !== "open" || Date.parse(l.expires_at) <= now) return gone;
      if (l.seller_id === id) return refuse("You can't buy your own listing.");
      if (a.qty > l.qty_left) return refuse(`Only ${fmtWhole(l.qty_left)} left.`);
      const cost = l.price_each * a.qty;
      const key = remintKey(l.item_key, l.id);
      const bought = applyPurchase(store.state, { key, qty: a.qty, cost }, env);
      if (!bought || !bought.ok) return refuse(bought && bought.error);
      l.qty_left -= a.qty;
      if (!l.qty_left) l.status = "sold";
      l.updated_at = iso(now);
      sales.push({ id: ++serial, listing_id: l.id, seller_id: l.seller_id, buyer_id: id, item_key: l.item_key, item_name: l.item_name, qty: a.qty, price_each: l.price_each, fee: marketFee(cost), created_at: iso(now) });
      return { ok: true, data: { listingId: l.id, key, qty: a.qty, cost } };
    }

    if (type === "marketCancel") {
      if (!listingId) return gone;
      const l = listings.find((r) => r.id === listingId && r.seller_id === id);
      if (!l || l.status !== "open") return gone;
      // The server's sweep would have sent it home already.
      if (Date.parse(l.expires_at) <= now) {
        l.status = "expired";
        l.updated_at = iso(now);
        return gone;
      }
      const qty = l.qty_left;
      const back = applyReturn(store.state, { key: l.item_key, qty }, env);
      if (!back || !back.ok) return refuse(back && back.error);
      l.status = "cancelled";
      l.updated_at = iso(now);
      return { ok: true, data: { listingId: l.id, key: l.item_key, qty } };
    }
    return refuse("The stub has no server.");
  }

  /* ---------- the party ---------- */

  const blankParty = (invitesIn = []) => ({ party: null, members: [], invites_in: invitesIn, invites_out: [], messages: [] });
  let party = store.party
    ? JSON.parse(JSON.stringify(store.party))
    : blankParty([{ id: 41, party_id: GREY_LANTERN, party_name: "The Grey Lantern", from_name: "veyra", created_at: iso(t0 - 25 * MIN) }]);
  const subscribers = new Set();

  const meMember = (now) => ({ user_id: me().userId, username: me().username, joined_at: iso(now), last_seen: iso(now), activity: {}, total_level: 0, levels: {}, hunt: null });

  // What party_state() would say now: your own row carries your live presence, as the server's would after a sync.
  function snapshot() {
    const now = store.now();
    const s = JSON.parse(JSON.stringify(party));
    s.members.forEach((m) => {
      if (m.user_id !== me().userId) return;
      const p = huntPresence(store.state);
      const task = store.state.tasks.skilling;
      m.last_seen = iso(now);
      m.total_level = totalLevel(store.state);
      m.levels = levelsOf(store.state);
      m.hunt = p ? { tier: p.tier, zone: p.zone, started_at: iso(p.startedAt), ends_by: iso(p.endsBy), ended_at: null } : null;
      m.activity = task ? { skill: task.skillId, action: task.actionId } : {};
    });
    s.messages = s.messages.slice(-50);
    return s;
  }

  // The store keeps what the realm said; realtime pokes arrive a beat later, as they do.
  function publish() {
    store.party = snapshot();
    store.bus.emit("store:party", { party: store.party });
    subscribers.forEach((fn) => setTimeout(() => fn({ table: "party_state" }), 0));
  }

  const isLeader = () => !!party.party && party.party.leader_id === me().userId;

  const partyActions = {
    partyState() {
      return answer(snapshot());
    },
    create(name) {
      const n = trim(name);
      if (n.length < 1 || n.length > 24) return fail("Party names are 1 to 24 characters.");
      if (party.party) return fail("You are already in a party.");
      const now = store.now();
      party = { party: { id: `33333333-4444-4555-8666-${String(++serial).padStart(12, "0")}`, name: n, leader_id: me().userId }, members: [meMember(now)], invites_in: party.invites_in, invites_out: [], messages: [] };
      publish();
      return answer(party.party.id);
    },
    invite(username) {
      const name = trim(username).toLowerCase();
      if (!party.party) return fail("You are not in a party.");
      if (!isLeader()) return fail("Only the party leader can invite.");
      if (name !== me().username && !REALM_PLAYERS.includes(name)) return fail("No player by that name.");
      if (name === me().username) return fail("You cannot invite yourself.");
      if (party.members.some((m) => m.username === name) || IN_OTHER_PARTY.includes(name)) return fail("That player is already in a party.");
      if (party.invites_out.some((i) => i.to_name === name)) return fail("That player already has an invite.");
      if (party.members.length + party.invites_out.length >= CONFIG.party.maxSize) return fail("The party is full.");
      party.invites_out.push({ id: ++serial, to_name: name, created_at: iso(store.now()) });
      publish();
      return answer(serial);
    },
    cancelInvite(inviteId) {
      const inv = party.party ? party.invites_out.find((i) => i.id === Number(inviteId)) : null;
      if (!inv) return fail("Invite not found.");
      if (!isLeader()) return fail("Only the party leader can cancel invites.");
      party.invites_out = party.invites_out.filter((i) => i !== inv);
      publish();
      return answer(null);
    },
    respond(inviteId, accept) {
      if (accept == null) return fail("Choose to accept or decline.");
      const inv = party.invites_in.find((i) => i.id === Number(inviteId));
      if (!inv) return fail("Invite not found.");
      if (!accept) {
        party.invites_in = party.invites_in.filter((i) => i !== inv);
        publish();
        return answer(null);
      }
      if (party.party) return fail("You are already in a party.");
      const now = store.now();
      party = {
        party: { id: inv.party_id, name: inv.party_name, leader_id: "u-veyra" },
        members: [
          { user_id: "u-veyra", username: "veyra", joined_at: iso(now - 6 * DAY), last_seen: iso(now - 30000), activity: {}, total_level: 371, levels: {}, hunt: { tier: 2, zone: "middle", started_at: iso(now - 3 * HOUR), ends_by: iso(now + 9 * HOUR), ended_at: null } },
          { user_id: "u-edda", username: "edda", joined_at: iso(now - 4 * DAY), last_seen: iso(now - 2 * MIN), activity: { skill: "forgemaster", action: "craft_bog_bar" }, total_level: 355, levels: {}, hunt: null },
          meMember(now),
        ],
        invites_in: [],   // accepting one gives every other seat back
        invites_out: [],
        messages: [{ id: ++serial, user_id: "u-veyra", username: "veyra", body: "Welcome. We hunt the Middle of Gallowmoor most nights.", created_at: iso(now - 20 * MIN) }],
      };
      publish();
      return answer(null);
    },
    leave() {
      if (!party.party) return fail("You are not in a party.");
      party = blankParty(party.invites_in);
      publish();
      return answer(null);
    },
    kick(userId) {
      if (!party.party) return fail("You are not in a party.");
      if (!isLeader()) return fail("Only the party leader can kick.");
      if (userId === me().userId) return fail("You cannot kick yourself.");
      if (!party.members.some((m) => m.user_id === userId)) return fail("That player is not in your party.");
      party.members = party.members.filter((m) => m.user_id !== userId);
      publish();
      return answer(null);
    },
    say(body) {
      const text = trim(body);
      if (!text) return fail("Message is empty.");
      if (Array.from(text).length > 240) return fail("Messages are 240 characters at most.");
      if (!party.party) return fail("You are not in a party.");
      const now = store.now();
      const mine = party.messages.filter((m) => m.user_id === me().userId);
      if (mine.length && now - Date.parse(mine[mine.length - 1].created_at) < 1500) return fail("You are sending messages too quickly.");
      party.messages.push({ id: ++serial, user_id: me().userId, username: me().username, body: text, created_at: iso(now) });
      party.messages = party.messages.slice(-200);
      publish();
      return answer(serial);
    },
    subscribe(partyId, onChange) {
      if (typeof onChange !== "function") return () => {};
      subscribers.add(onChange);
      return () => subscribers.delete(onChange);
    },
  };

  /* ---------- the hiscores ---------- */

  // Everyone else's levels are made up but steady; yours come from the save.
  function profile(name) {
    if (name === me().username) {
      const levels = levelsOf(store.state);
      const skills = {};
      GameData.SKILLS.forEach((s) => { skills[s.id] = Math.floor(store.state.skills[s.id] || 0); });
      return { username: name, total: totalLevel(store.state), levels, skills };
    }
    const strength = 20 + (realmHash(name) % 60);
    const levels = {};
    const skills = {};
    GameData.SKILLS.forEach((s) => {
      const h = realmHash(`${name}:${s.id}`);
      const lvl = Math.max(1, Math.min(CONFIG.progression.maxLevel - 1, strength + (h % 30) - 15));
      levels[s.id] = lvl;
      skills[s.id] = CONFIG.xpTable[lvl] + (h % Math.max(1, CONFIG.xpTable[lvl + 1] - CONFIG.xpTable[lvl]));
    });
    return { username: name, total: Object.values(levels).reduce((n, v) => n + v, 0), levels, skills };
  }

  function hiscores(skill = "total", limit = 50) {
    const id = String(skill == null ? "total" : skill).trim().toLowerCase();
    if (id !== "total" && !GameData.SKILLS.some((s) => s.id === id)) return { rows: null, error: "Unknown skill." };
    const n = Math.max(1, Math.min(100, Number(limit) || 50));
    const names = REALM_PLAYERS.concat(me().username ? [me().username] : []);
    const people = names.map(profile);
    const board = id === "total"
      ? people.map((p) => ({ username: p.username, level: p.total, xp: Object.values(p.skills).reduce((s, v) => s + v, 0) }))
        .sort((a, b) => b.level - a.level || b.xp - a.xp || a.username.localeCompare(b.username))
      : people.map((p) => ({ username: p.username, level: p.levels[id], xp: p.skills[id] }))
        .filter((r) => r.xp > 0)
        .sort((a, b) => b.xp - a.xp || a.username.localeCompare(b.username));
    return { rows: board.slice(0, n).map((r, i) => ({ rank: i + 1, ...r })), error: null };
  }

  return {
    browse,
    mine: () => ({ rows: listings.filter((r) => r.seller_id === me().userId).sort(newest).slice(0, 50).map((r) => ({ ...r })), error: null }),
    sales: () => ({ rows: sales.filter((s) => s.seller_id === me().userId || s.buyer_id === me().userId).sort(newest).slice(0, 50).map((s) => ({ ...s })), error: null }),
    command,
    ...partyActions,
    hiscores,
  };
}
