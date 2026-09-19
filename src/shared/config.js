/* ============================================================
   Respite · config.js · The Ledger
   ------------------------------------------------------------
   Every loose number and formula the rules run on, deep-frozen.
   Named tables (tiers, gear, foes, companions) live in registry.js.
   Nothing in this file reads or writes the save.
   ============================================================ */

/* Freezes obj and everything reachable from it, in place, and returns it.
   Array buffer views are skipped: they can't be frozen. */
export function deepFreeze(obj) {
  const stack = [obj];
  const seen = new Set();
  while (stack.length) {
    const o = stack.pop();
    if (o === null || (typeof o !== "object" && typeof o !== "function")) continue;
    if (seen.has(o) || ArrayBuffer.isView(o)) continue;
    seen.add(o);
    Object.freeze(o);
    for (const key of Reflect.ownKeys(o)) {
      const desc = Object.getOwnPropertyDescriptor(o, key);
      if (desc && "value" in desc) stack.push(desc.value);
    }
  }
  return obj;
}

/* ================= 1. TIME ================= */

const DAY_MS = 24 * 60 * 60 * 1000;

const time = {
  idleCapMs: 12 * 60 * 60 * 1000,
  windowMs: 12 * 60 * 60 * 1000,      // bounty + smuggler refresh, on world clock
  dayMs: DAY_MS,                      // weather window
  weekMs: 7 * DAY_MS,
};

/* ================= 2. STORAGE ================= */

// Keyed by pool id. The ids never change: saves use them.
const storage = {
  slots: {
    inv: 10,     // Belongings
    bank: 30,    // Stockpile
    vault: 50,   // the Vault, reachable from either page
    /* The Satchel: the only remedies a fight can reach. Five slots, and a
       remedy does NOT stack here -- one bottle to a slot. Five is the whole
       hunt's healing, so what you pack is the plan. */
    satchel: 5,
  },
  bankMax: 200,  // the Stockpile widens no further than this
  // What each storage pool is called on screen.
  names: { inv: "Belongings", bank: "Stockpile", vault: "Vault", satchel: "Satchel" },
};

/* ================= 3. PROGRESSION ================= */

const progression = {
  maxLevel: 99,
  classPickLevel: 5,   // Hunt level a discipline is chosen at
};

/* ================= 4. THE HUNT ================= */
/* An encounter walks in with its foes; if it is still going when the zone's
   window runs out, a reinforcement joins (never more than maxFoes at once).
   The maths lives in combat.js. */

const hunt = {
  playerSwingMs: 2400,          // Brute Force, and a Stalker

  /* A death no longer bars the gate. You come round at 1 health with your Attack
     down this much for this long: back to the hunt at once if you dare it, only
     slower. Everything else -- Defence, health, crit -- is untouched. */
  deathDebuff: 0.15,
  deathDebuffMs: 10 * 60 * 1000,

  deathWear: 25,                // durability every worn piece loses on a death

  /* Health comes back only when nothing is swinging at you: between encounters
     and at camp, this share of your most a second. Nothing else heals for free. */
  regenPerSec: 0.01,

  /* Clear an encounter early and the next one is owed you within this, however
     long the zone's reinforcement clock still had to run. Killing fast is never
     punished with an empty screen. */
  reinforceGapCapMs: 10 * 1000,

  veilMax: 100,
  maxFoes: 3,
  searchMinMs: 3000,            // the shortest walk between encounters
  rateMarkMs: 10 * 1000,        // a sample for the XP/hr and DPS window, this often
  rateWindowMs: 60 * 60 * 1000, // how much of the run those rates look back over
  rateMinSpanMs: 1000,          // below this the window is too short to read a rate off
  foeAmbush: 1.5,               // a reinforcement's first blow lands this much harder
  volleyGapMs: 450,             // between a Mage's opening casts
  remedyAt: 0.25,               // between encounters, a remedy is taken at or below this share of health
  retreatAt: 0.25,              // you break away from a Sovereign at or below this

  /* Defence is a number, and what it stops depends on the ground:
     mitigation = Defence / (Defence + K), with K growing each tier, capped at 80%.
     The same rule covers blows in both directions. */
  defK: 7,
  defGrowth: 1.85,
  mitigationCap: 0.8,

  // A tier-1 Stalker, and how each tier grows on it.
  foeHp: 400,
  foeAttack: 0.26,
  foeHpGrowth: 1.8,
  foeAttackGrowth: 1.75,
  foeXp: [1, 4, 8, 14, 21, 30, 41, 54, 68],
  foeGold: [0.5, 1.5],          // a Stalker's gold, as a share of its tier's material value

  /* Gear stat lines (GEAR_LINES) are a tier-1 Common piece. Tiers multiply
     them by gearGrowth, rarity multiplies again, and every stat rounds to a
     whole number. Crit is a flat chance that only rarity changes. Weapons
     from tier 5 also add Veil per blow (weaponVeil). A full tier-9 Relic set
     with every level earned stays under 5,000 health. */
  gearGrowth: { attack: 1.85, defence: 1.85, health: 2 },
  weaponVeil: [0, 0, 0, 0, 1, 2, 3, 4, 5],

  // Veil a Warrior or Rogue builds per blow, as [Hunt level, Veil] points.
  veilCurve: [[5, 10], [20, 12], [40, 16], [60, 20], [80, 25]],
};

/* ================= 5. ECONOMY ================= */

const economy = {
  // What it costs to open each region, by tier.
  tolls: [0, 50, 100, 200, 350, 600, 1000, 1600, 2500],

  // Tier -> chance the reagent drops alongside the resource. T1/T2 have
  // dedicated nodes instead, so they sit at 0 here.
  reagentChances: [0, 0, 0, 0.0125, 0.025, 0.0375, 0.05, 0.0625, 0.075, 0.10],

  // Remedies: taken automatically on the hunt. `value` is what they sell for,
  // `price` what the Bonesetter charges. Names live in registry.js.
  remedies: [
    { tier: 1, heal: 250,   value: 2,   price: 5 },
    { tier: 2, heal: 420,   value: 4,   price: 9 },
    { tier: 3, heal: 700,   value: 6,   price: 15 },
    { tier: 4, heal: 1800,  value: 18,  price: 45 },
    { tier: 5, heal: 2600,  value: 32,  price: 80 },
    { tier: 6, heal: 3800,  value: 56,  price: 140 },
    { tier: 7, heal: 8000,  value: 168, price: 420, smuggler: true },
    { tier: 8, heal: 12000, value: 284, price: 710, smuggler: true },
    { tier: 9, heal: 18000, value: 480, price: 1200, smuggler: true },
  ],

  /* The player market, run by the server. The fee is taken off BOTH legs of a trade:
     the buyer pays the asking price plus it, the seller receives the asking price
     less it, each rounded up and never under 1 gold. A wash trade therefore costs
     about a tenth of whatever it pretends to move, which is the point. */
  marketFee: 0.05,
  marketMaxListings: 20,
  marketListingDays: 7,
  marketMaxPrice: 1000000000,
};

/* ================= 6. COMPANIONS ================= */

const companions = {
  maxBond: 20,
  maxRank: 5,
  rankDupes: [0, 0, 1, 2, 3, 4],   // duplicates spent to reach each rank
  bondMs: 60 * 1000,               // one point of Bond for each minute of shared work
};

/* ================= 7. REQUISITION AGENTS ================= */

const agents = {
  hireCost: 250,
  rosterMax: 12,
  requisitionsPerDay: 3,   // deployments, resolved at the daily reset
};

/* ================= 8. WEATHER ================= */
/* Weather touches XP only, never speed. Each day draws one weather and an
   effect between effectMin and effectMax percent. */

const weather = {
  effectMin: 5,    // %
  effectMax: 20,   // %
  // Bountiful Weekend: Saturday and Sunday (UTC), +20% XP to every trade.
  // Separate from the weather and never changes its severity.
  bountifulXp: 0.20,
  bountifulWeekdays: [6, 0],
};

/* ================= 9. THE BENCH ================= */

const bench = {
  valueMarkup: 1.25,        // gear and tools are worth a quarter more than what went into them
  durBase: 400,             // a crafted piece's durability: durBase + tier * durPerTier
  durPerTier: 220,
  toolSpeedPerTier: 0.02,   // a tool's speed bonus: tier * toolSpeedPerTier
};

/* ================= 10. PARTIES ================= */

/* Partying is for the company, not the numbers: the bonus is small on purpose,
   and the draw is a shared fight rather than a multiplier worth chasing. */
const party = {
  maxSize: 4,
  huntBonusPerMember: 0.05,
  huntBonusCap: 0.15,           // the three others you can have, at 5% each
};

/* ================= 11. FORMULAS ================= */

// XP needed to reach each level. Index 0 is padding.
const xpTable = (() => {
  const t = [0];
  for (let L = 1; L <= progression.maxLevel; L++) {
    t[L] = Math.floor(65 * (L - 1) + 5 * Math.pow(L - 1, 2.5) + 2.5 * Math.pow(1.165, L - 1) - 2.5);
  }
  return t;
})();

// The economy's yardstick: a tier-1 raw material or reagent sells for 1 gold,
// and each tier is worth about twice the last.
const valBase = (t) => Math.pow(2.05, t - 1);

const defenceK = (tier) => hunt.defK * Math.pow(hunt.defGrowth, tier - 1);

// A stat line's value at a tier and rarity multiplier, to two decimals.
// Never rounds a real stat away to 0.
function gearStat(base, growth, tier, mult) {
  if (!base) return 0;
  return Math.max(0.01, Math.round(base * Math.pow(growth, tier - 1) * (mult || 1) * 100) / 100);
}

// Two decimals, for every number a fight or a sheet shows.
const round2 = (n) => Math.round(n * 100) / 100;

// Hunt level -> base stats, before a discipline and gear.
const baseHealth = (level) => 250 + 30 * (level - 1) + 1.3 * (level - 1) * (level - 1);
const baseAttack = (level) => 10 * Math.pow(1.85, (level - 1) / 10);
const baseDefence = (level) => (hunt.defK / 9) * (Math.pow(1.85, (level - 1) / 10) - 1);

// Veil a Warrior or Rogue builds per blow, by Hunt level. Weapons from tier 5 add more.
function veilPerBlow(level) {
  const curve = hunt.veilCurve;
  if (level <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [l1, v1] = curve[i];
    const [l0, v0] = curve[i - 1];
    if (level <= l1) return Math.round(v0 + ((v1 - v0) * (level - l0)) / (l1 - l0));
  }
  return curve[curve.length - 1][1];
}

// Bond needed to reach a bond level: 0 at 1, 30 at 2, 90 at 3 ... 5,700 at 20.
const bondXpFor = (level) => 15 * (level - 1) * level;

// How long a component, and a piece of gear or a tool, takes at the bench.
const compTime = (t) => (45 + 75 * t) * 1000;
const gearTime = (t) => (90 + 150 * t) * 1000;

export const CONFIG = deepFreeze({
  schema: 9,
  time,
  storage,
  progression,
  hunt,
  economy,
  companions,
  agents,
  weather,
  bench,
  party,
  xpTable,
  valBase,
  defenceK,
  gearStat,
  round2,
  baseHealth,
  baseAttack,
  baseDefence,
  veilPerBlow,
  bondXpFor,
  compTime,
  gearTime,
});
