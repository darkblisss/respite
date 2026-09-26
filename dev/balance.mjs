/* ============================================================
   Respite · dev/balance.mjs · The Proving Ground
   ------------------------------------------------------------
   Plays the real hunt engine (src/shared/combat.js) for a grid of
   reference hunters and prints what each ground does to them: how
   long they last on a full Satchel, what they earn an hour, how fast
   they kill, and what a Sovereign does to them. Nothing here is a
   model of the fight; every number is the engine's own.

     node dev/balance.mjs                         the headline grid
     node dev/balance.mjs --tiers 1,5,9 --runs 3  a narrower, surer one
     node dev/balance.mjs --band                  start, middle and end of each band
     node dev/balance.mjs --sovereign             Sovereign fights only
     node dev/balance.mjs --party                 a warband of three
     node dev/balance.mjs --rarity rare           everyone in Rare gear

   A reference hunter is a discipline at a Hunt level, in a full set of
   Common gear of the region's tier (Warrior: sword, shield, heavy; Rogue:
   dagger or bow, medium; Mage: staff, light), an amulet and a ring, with
   no path, no mastery and five of the tier's remedies packed.
   ============================================================ */

import { CONFIG } from "../src/shared/config.js";
import { GameData, regionOfTier } from "../src/shared/registry.js";
import { combatStats } from "../src/shared/stats.js";
import { stepHunt, EPS } from "../src/shared/combat.js";
import { overLevel } from "../src/shared/progression.js";
import { seededRng } from "../src/shared/rng.js";
import { newSession, stepSession, makeHunter } from "../src/shared/partyHunt.js";

const H = CONFIG.hunt;
const HOUR = 3600000;

/* ---------- options ---------- */

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v == null || v.startsWith("--") ? true : v;
};
const list = (v, all) => (v === true || v == null ? all : String(v).split(",").map((x) => x.trim()).filter(Boolean));

const TIERS = list(opt("tiers"), ["1", "3", "5", "7", "9"]).map(Number);
const CLASSES = list(opt("classes"), ["warrior", "rogue", "mage"]);
const ZONES = list(opt("zones"), GameData.ZONES.map((z) => z.id));
const RUNS = Number(opt("runs", 2));
const HOURS = Number(opt("hours", 12));
const RARITY = String(opt("rarity", "common"));
const BAND = !!opt("band", false);
const ONLY_SOV = !!opt("sovereign", false);
const PARTY = !!opt("party", false);
const BOW = !!opt("bow", false);

/* ---------- reference hunters ---------- */

const gearOf = (line, tier) => Object.values(GameData.GEAR).find((g) => g.line === line && g.tier === tier);
const keyOf = (line, tier) => {
  const g = gearOf(line, tier);
  if (!g) throw new Error(`no ${line} at tier ${tier}`);
  return RARITY === "common" ? `${g.id}|common` : `${g.id}|${RARITY}|x1${RARITY === "relic" ? "|bulwark" : ""}`;
};

const KITS = {
  brute: { weapon: "sword", armour: ["helm", "chest", "hgaunts", "hboots"] },
  warrior: { weapon: "sword", offhand: "shield", armour: ["helm", "chest", "hgaunts", "hboots"] },
  rogue: { weapon: "dagger", armour: ["hood_medium", "jacket", "mgloves", "mboots"] },
  roguebow: { weapon: "bow", armour: ["hood_medium", "jacket", "mgloves", "mboots"] },
  mage: { weapon: "staff", armour: ["hood_light", "robe", "lgloves", "lboots"] },
};

function loadout(klass, tier) {
  const kit = KITS[klass === "rogue" && BOW ? "roguebow" : klass];
  const eq = { weapon: keyOf(kit.weapon, tier), neck: keyOf("amulet", tier), ring: keyOf("ring", tier) };
  if (kit.offhand) eq.offhand = keyOf(kit.offhand, tier);
  const slots = ["head", "chest", "hands", "feet"];
  kit.armour.forEach((line, i) => { eq[slots[i]] = keyOf(line, tier); });
  return eq;
}

function hunter(klass, level, tier) {
  return combatStats({ level, klass: klass === "brute" ? null : klass, equipment: loadout(klass, tier) });
}

const remedyOf = (tier) => CONFIG.economy.remedies.find((r) => r.tier === tier).heal;

// The levels a region is hunted at: the gate, the middle of the band, and the last level before the next gate.
function levelsFor(tier) {
  const r = regionOfTier(tier);
  const next = regionOfTier(tier + 1);
  const top = next ? next.level - 1 : CONFIG.progression.maxLevel;
  const mid = tier === 1 ? 5 : r.level + 5;
  return BAND ? [["gate", Math.max(tier === 1 ? 5 : 1, r.level)], ["mid", mid], ["top", top]] : [["mid", mid]];
}

/* ---------- one hunt, instrumented ---------- */

function blankHunt(tier, zone) {
  return {
    tier, zone, limit: null, done: 0, elapsed: 0, startedAt: 0,
    phase: "search", wait: H.searchMinMs, kind: "normal",
    clock: 0, reinforceAt: 0, joins: 0, foes: [], uid: 1,
    swing: 0, volley: 0, veil: 0, streak: 0,
    queued: 0, sovereignNext: false, encounters: 0,
    xp: 0, dmg: 0, marks: [[0, 0, 0]], nextMark: H.rateMarkMs, drops: {},
  };
}

/* Plays one hunt. `sovereign`: the first encounter is the ground's Sovereign and the
   run stops when it is over. Returns what happened, and the health it walked through. */
function playOnce(tier, zone, s, { seed, hours, xpMult = 1, sovereign = false, hp = null }) {
  const c = blankHunt(tier, zone);
  if (sovereign) c.sovereignNext = true;
  const heals = Array.from({ length: CONFIG.storage.slots.satchel }, () => remedyOf(tier));
  const t = { kills: 0, xp: 0, gold: 0, remedies: 0, felled: 0, retreats: 0, died: false, ms: 0,
    killer: null, taken: 0, lowest: 1, sovMs: 0, sovEnd: null, met: 0, encounters: 0 };
  const p = { hp: hp == null ? s.maxHp : hp };
  let inSov = false;
  const ctx = {
    c, s, p, rng: seededRng(seed), over: false,
    fx: (who, kind, amount) => {
      if (who === "you" && amount > 0 && kind !== "heal") t.taken += amount;
    },
    met: () => { inSov = true; t.met++; },
    retreated: (_m, ms) => { t.retreats++; t.sovMs = ms; t.sovEnd = "retreat"; inSov = false; if (sovereign) ctx.over = true; },
    remedy: () => {
      if (!heals.length) return 0;
      t.remedies++;
      return heals.shift();
    },
    gainXp: (x) => { t.xp += x * xpMult; c.xp += x; },
    gainGold: (g) => { t.gold += g; },
    killed: () => { t.kills++; },
    sovereignDown: () => { t.felled++; t.sovMs = c.clock; t.sovEnd = "felled"; inSov = false; },
    died: (mob) => { t.died = true; t.killer = mob.id; if (inSov) t.sovEnd = "died"; },
    ended: () => {},
  };
  const horizon = Math.min(CONFIG.time.idleCapMs, hours * HOUR);
  const chunk = 5000;
  while (!ctx.over && c.elapsed < horizon - EPS) {
    stepHunt(ctx, Math.min(chunk, horizon - c.elapsed));
    t.lowest = Math.min(t.lowest, p.hp / s.maxHp);
    // A Sovereign run stops once its fight is done, however it went.
    if (sovereign && t.sovEnd && t.sovEnd !== "died" && !inSov) break;
  }
  t.ms = c.elapsed;
  t.hpEnd = Math.max(0, p.hp) / s.maxHp;
  t.encounters = c.encounters;
  return t;
}

function summarise(rows, hours) {
  const n = rows.length;
  const ms = rows.reduce((a, r) => a + r.ms, 0);
  const hrs = Math.max(1, ms) / HOUR;
  const deaths = rows.filter((r) => r.died);
  return {
    xpHr: rows.reduce((a, r) => a + r.xp, 0) / hrs,
    killsHr: rows.reduce((a, r) => a + r.kills, 0) / hrs,
    goldHr: rows.reduce((a, r) => a + r.gold, 0) / hrs,
    killS: rows.reduce((a, r) => a + r.kills, 0) ? ms / rows.reduce((a, r) => a + r.kills, 0) / 1000 : null,
    deaths: deaths.length, runs: n,
    lastH: deaths.length ? deaths.reduce((a, r) => a + r.ms, 0) / deaths.length / HOUR : null,
    remediesHr: rows.reduce((a, r) => a + r.remedies, 0) / hrs,
    remedies: rows.reduce((a, r) => a + r.remedies, 0) / n,
    hpEnd: rows.reduce((a, r) => a + r.hpEnd, 0) / n,
    metHr: rows.reduce((a, r) => a + r.met, 0) / hrs,
    encHr: rows.reduce((a, r) => a + r.encounters, 0) / hrs,
    lowest: Math.min(...rows.map((r) => r.lowest)),
    hours,
  };
}

/* ---------- printing ---------- */

const pad = (s, n) => String(s).padStart(n);
const padR = (s, n) => String(s).padEnd(n);
const f0 = (x) => (x == null ? "-" : Math.round(x).toLocaleString("en-GB"));
const f1 = (x) => (x == null ? "-" : x.toFixed(1));
const f2 = (x) => (x == null ? "-" : x.toFixed(2));
const pct = (x) => `${Math.round(x * 100)}%`;

function lastText(sm) {
  if (!sm.deaths) return `${sm.hours}h+ (${pct(sm.hpEnd)} hp)`;
  const all = sm.deaths === sm.runs;
  return `${f1(sm.lastH)}h${all ? "" : ` ${sm.deaths}/${sm.runs}`}`;
}

/* ---------- the grids ---------- */

function soloGrid() {
  console.log(`\nSOLO · ${RARITY} gear · ${RUNS} runs of ${HOURS}h · five remedies of the tier`);
  console.log(padR("who", 22) + padR("zone", 8) + pad("lasts", 16) + pad("rem", 6) + pad("xp/hr", 10) + pad("kills/hr", 10) + pad("s/kill", 8) + pad("gold/hr", 10) + pad("low", 6) + pad("enc/hr", 8) + pad("sov/hr", 8));
  for (const tier of TIERS) {
    for (const [pos, level] of levelsFor(tier)) {
      for (const klass of CLASSES) {
        const s = hunter(klass, level, tier);
        const head = `T${tier} L${level} ${klass}${BAND ? ` ${pos}` : ""}`;
        const xpMult = overLevel(level, tier).xp;
        for (const zone of ZONES) {
          const rows = [];
          for (let r = 0; r < RUNS; r++) rows.push(playOnce(tier, zone, s, { seed: 11 + r * 7919 + tier * 101, hours: HOURS, xpMult }));
          const sm = summarise(rows, HOURS);
          console.log(padR(head, 22) + padR(zone, 8) + pad(lastText(sm), 16) + pad(f1(sm.remedies), 6) + pad(f0(sm.xpHr), 10) + pad(f0(sm.killsHr), 10) + pad(f1(sm.killS), 8) + pad(f0(sm.goldHr), 10) + pad(pct(sm.lowest), 6) + pad(f1(sm.encHr), 8) + pad(f2(sm.metHr), 8));
        }
        console.log(`${padR("", 22)}hp ${f0(s.maxHp)} · atk ${f0(s.attack)} · def ${f1(s.defence)} · block ${pct(s.block)} · dodge ${pct(s.dodge)} · speed ${s.speed}`);
      }
    }
  }
}

function sovGrid() {
  const runs = Math.max(RUNS, 6);
  console.log(`\nSOVEREIGNS · the Core's, from full health · ${runs} fights each`);
  console.log(padR("who", 22) + pad("felled", 8) + pad("broke", 8) + pad("fell", 6) + pad("fight", 9) + pad("rem", 6));
  for (const tier of TIERS) {
    for (const [pos, level] of levelsFor(tier)) {
      for (const klass of CLASSES) {
        const s = hunter(klass, level, tier);
        const out = { felled: 0, retreat: 0, died: 0, ms: 0, rem: 0 };
        for (let r = 0; r < runs; r++) {
          const t = playOnce(tier, "core", s, { seed: 5 + r * 104729 + tier, hours: 1, sovereign: true });
          out[t.sovEnd || "died"]++;
          out.ms += t.sovMs || 0;
          out.rem += t.remedies;
        }
        console.log(padR(`T${tier} L${level} ${klass}${BAND ? ` ${pos}` : ""}`, 22) + pad(out.felled, 8) + pad(out.retreat, 8) + pad(out.died, 6) + pad(`${f0(out.ms / runs / 1000)}s`, 9) + pad(f1(out.rem / runs), 6));
      }
    }
  }
}

/* A warband of three (a Warrior, a Rogue and a Mage at the same level), each with five
   remedies, on each ground: how long until the first falls, and how the shares land. */
function partyGrid() {
  console.log(`\nPARTY · Warrior, Rogue and Mage together · ${HOURS}h`);
  console.log(padR("tier/zone", 16) + pad("first down", 12) + pad("wiped", 8) + pad("enc", 6) + "  shares (w/r/m) · remedies drunk");
  for (const tier of TIERS) {
    const level = levelsFor(tier).find(([p]) => p === "mid")[1];
    for (const zone of ZONES) {
      const hunters = ["warrior", "rogue", "mage"].map((k) => makeHunter(k, hunter(k, level, tier), { heals: Array(5).fill(remedyOf(tier)) }));
      const s = newSession({ partyId: "p", tier, zone, seed: 99 + tier, hunters });
      let firstDown = null;
      const horizon = HOURS * HOUR;
      while (!s.over && s.elapsed < horizon) {
        stepSession(s, 10000);
        if (firstDown == null && s.hunters.some((u) => u.down)) firstDown = s.elapsed;
      }
      const dmg = s.hunters.map((u) => u.owed.xp);
      const total = dmg.reduce((a, b) => a + b, 0) || 1;
      console.log(padR(`T${tier} ${zone}`, 16) + pad(firstDown == null ? `${HOURS}h+` : `${f1(firstDown / HOUR)}h`, 12) + pad(s.over === "wiped" ? f1(s.elapsed / HOUR) + "h" : "-", 8) + pad(s.encounters, 6) +
        `  ${dmg.map((x) => pct(x / total)).join("/")} · ${s.hunters.map((u) => u.owed.remedies).join("/")}`);
    }
  }
}

if (PARTY) partyGrid();
else if (ONLY_SOV) sovGrid();
else {
  soloGrid();
  sovGrid();
}
