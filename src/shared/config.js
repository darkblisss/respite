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
   window runs out, a reinforcement joins (never more than maxFoes at once, and
   never more than the zone's `joins` in all). The maths lives in combat.js. */

const hunt = {
  playerSwingMs: 2400,          // Brute Force, and a Stalker

  /* A death no longer bars the gate. You come round at 1 health with your Attack
     down this much for this long: back to the hunt at once if you dare it, only
     slower. Everything else -- Defence, health, crit -- is untouched. */
  deathDebuff: 0.15,
  deathDebuffMs: 10 * 60 * 1000,

  /* Nothing heals for free. Not the walk, not the camp, not a new level: a level's
     worth of new health is added to what you have, and that is all. What comes back
     comes back two ways. Every blow you land gives back a share of itself
     (lifesteal, a hundredth for everyone: BASE_COMBAT in registry.js), and a remedy
     out of the Satchel, drunk between encounters, or by hand at camp. */

  /* Block and Dodge, off gear alone. A blocked blow lands at blockCut of itself; a
     dodged one not at all. Capped, so no pile of pieces makes a hunter untouchable. */
  blockCut: 0.5,
  blockCap: 0.6,
  dodgeCap: 0.4,
  lifestealCap: 0.1,

  /* Hunting beneath yourself. A kill pays its whole XP until you are overGrace levels
     past the gate of the region above the one you are in; after that every level
     takes overStep off, down to overFloor. Weapon mastery follows the same slope all
     the way down to nothing: a blade learns nothing from things that cannot hurt it.
     The last region has no ground above it, so it never falls off. */
  overGrace: 5,
  overStep: 0.06,
  overFloor: 0.1,

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
  foeAttack: 0.42,
  foeHpGrowth: 1.85,
  foeAttackGrowth: 1.85,
  foeXp: [1, 4, 8, 14, 21, 30, 41, 54, 68],
  foeGold: [0.5, 1.5],          // a Stalker's gold, as a share of its tier's material value

  /* Gear stat lines (GEAR_LINES) are a tier-1 Common piece. Tiers multiply
     them by gearGrowth, rarity multiplies again, and every stat rounds to a
     whole number. The chances (crit, block, dodge) and Veil Power are shares
     that only rarity moves. Weapons from tier 5 also add Veil per blow
     (weaponVeil), and a fifth of it a second to a Mage.

     ONE GROWTH RATE. Everything that makes a fight grows by the same 1.85 a
     tier: a foe's health and attack, the Defence K it is measured against, a
     piece's Attack, Defence and health, and a hunter's own base stats every ten
     Hunt levels (a tier's worth). So a hunter in the middle of a region's band,
     in that region's gear, meets the Outer of tier 9 exactly as they met the
     Outer of tier 1: the numbers are bigger and the fight is the same. What
     moves the fight is depth, gear rarity, the path, mastery and the Veil a
     weapon carries, never the tier itself. dev/balance.mjs plays the grid. */
  gearGrowth: { attack: 1.85, defence: 1.85, health: 1.85 },
  weaponVeil: [0, 0, 0, 0, 1, 1, 2, 2, 3],

  /* Veil a Warrior or Rogue builds per blow, as [Hunt level, Veil] points. Flat:
     the Veil grows with the weapon and the path, not the level, so a discipline's
     technique comes round as often at tier 9 as at tier 1 and the three stay level
     with each other all the way up (a Mage's two a second is flat too). */
  veilCurve: [[5, 10]],
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
    { tier: 2, heal: 460,   value: 4,   price: 9 },
    { tier: 3, heal: 860,   value: 6,   price: 15 },
    { tier: 4, heal: 1600,  value: 18,  price: 45 },
    { tier: 5, heal: 2900,  value: 32,  price: 80 },
    { tier: 6, heal: 5400,  value: 56,  price: 140 },
    { tier: 7, heal: 10000, value: 168, price: 420, smuggler: true },
    { tier: 8, heal: 18500, value: 284, price: 710, smuggler: true },
    { tier: 9, heal: 34000, value: 480, price: 1200, smuggler: true },
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

/* An Agent is paid in hours of your own gathering. At level 1 every one of them,
   common or relic, comes back with an hour of whatever you sent them for, read
   off that material's own gather rate: an hour of Slag Ore is 300, an hour of
   Titan Core is 50. What rarity buys is the ceiling they climb to and how fast
   they climb it, not a multiplier on day one.

   They learn from the work, which is why the roster is three: an agent you keep
   is one you have taught, and a fourth would only ever sit idle behind three
   deployments a day. Resigning one frees the seat and loses everything it knew. */
const agents = {
  hireCost: 250,
  rosterMax: 3,
  requisitionsPerDay: 3,   // deployments, resolved at the daily reset
  baseHours: 1,            // what a level 1 agent brings back, in hours of your gathering
  xpPerHour: 1400,         // what an hour out teaches one, against tier 1 work
  xpTierStep: 0.35,        // and how much more each tier up teaches
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
  toolSpeedPerTier: 0.02,   // a tool's speed bonus: tier * toolSpeedPerTier
};

/* ================= 10. PARTIES ================= */

/* Partying is for the company, not the numbers: the bonus is small on purpose,
   and the draw is a shared fight rather than a multiplier worth chasing. Three to
   a party: the room, the hunt and the ground bonus all stop there. */
const party = {
  maxSize: 3,
  huntBonusPerMember: 0.05,
  huntBonusCap: 0.10,           // the two others you can have, at 5% each

  /* What a share of an encounter is worth. Damage dealt is most of it, but holding
     the line is worth counting too, or the only way to be paid is to swing: the
     taken half counts the blows thrown at you as they were thrown, before your own
     Dodge, Block and Defence. Gold is not split by this: everyone who was there
     gets the same. */
  contribDealt: 0.70,
  contribTaken: 0.30,

  /* The guard on the taken half, so nobody farms a share by becoming unkillable and
     never striking. Two ceilings and a floor, and the lot is normalised afterwards so
     the encounter still pays out exactly once however the shares fall:

       takenPerDealt  the counted taken share is at most this many times your damage
                      share. Stand in the way and never swing and it is worth nothing;
                      a real tank swinging for a sixth of the party can still be paid
                      for half the blows it ate.
       takenCap       and never more than this much of the encounter's damage taken,
                      whatever the damage share says. One body is one body.
       contribFloor   anyone who actually hurt it is never paid nothing.  */
  takenPerDealt: 3,
  takenCap: 0.5,
  contribFloor: 0.05,

  /* Setting out together. Everyone marked ready when the host presses Start walks onto
     the ground under their own next request, a second or two behind the host, so the
     first walk is held until the last of them is on, and encounter one is drawn for
     all of them at once. A camp that never comes (a closed tab) holds it this long and
     no longer, then comes in on the next walk like anyone late. */
  musterMs: 20 * 1000,

  /* An encounter's XP pool rides the same scale its foes do, so a fair four-way split
     of a foe built for four pays each of them what one built for one would have. The
     party bonus above is then laid on top: partying is worth a little, never a lot. */
};

/* ================= 9b. FORTIFYING ================= */

/* Working the Veil into a piece of gear: the Fortify tab under The Camp. Only an
   amulet or a ring takes the Veil (slots); armour and weapons never do. The stone
   is Veil Essence of the piece's own band -- Lesser for tiers 1 to 3, Veiled for
   4 to 6, Sovereign for 7 to 9 -- which is the only thing in the camp Essence has
   ever been for.

   One to three stones an attempt, and the odds run off the old forge table: a
   stone is worth stoneWorth points, every level has a threshold, and the chance
   is what the stones staked come to against the threshold of the level being
   reached, held at 100%. Three stones on a bare piece is a certainty; three
   stones going for +12 is one attempt in a hundred. A charm of the piece's band
   in the fourth socket multiplies the chance by charmMult and is spent either
   way. The table, three stones, no charm:

       to  +1   +2   +3   +4   +5    +6    +7   +8   +9   +10   +11  +12   +13   +14   +15
          100  100  100  100   60  32.1   18   10    6  3.46     2    1   0.5  0.25   0.1 %

   A failure takes the stones and the charm and nothing else: the piece is
   unharmed and the level is where it was. Nothing is ever destroyed, and no
   level is ever lost -- the odds are brutal because carrying a level forward is
   cheap: convert (below) moves a whole level onto a new piece of the same slot.

   Each level multiplies every stat the piece carries by gainPerLevel again, so
   +15 is a little over half as much piece again. At halo.at a worked piece wears
   a halo, and so does the commander wearing it: Veiled at +9, Sovereign at +12,
   Hallowed at +15. */

const enchant = {
  max: 15,
  maxStones: 3,
  slots: ["neck", "ring"],   // the only gear the Veil goes into
  stoneWorth: 3000,          // what one Essence is worth against a threshold
  // The threshold of reaching +1 ... +15. chance = min(1, stones * stoneWorth / threshold[level]).
  thresholds: [1500, 3000, 4500, 7500, 15000, 28000, 50000, 90000, 150000, 260000, 450000, 900000, 1800000, 3600000, 9000000],
  charmMult: 1.5,            // a charm of the band in the fourth socket
  charmValue: 1,             // a charm is priced at this many Essence of its band
  gainPerLevel: 0.035,       // +3.5% of the whole stat line a level: +52.5% at +15
  valuePerLevel: 0.15,       // what a worked piece is worth over a bare one, a level
  halos: [                   // what a worked piece wears, from this level up
    { at: 9, id: "veiled", name: "Veiled" },
    { at: 12, id: "sovereign", name: "Sovereign" },
    { at: 15, id: "hallowed", name: "Hallowed" },
  ],
  /* Convert: a worked piece hands its whole level to an unworked piece of the
     same slot, any tier, for gold and Essence of the new piece's band. Nothing is
     rolled and the old piece goes back to +0: the toll is the only cost. */
  convert: {
    goldPerLevelSq: 50,      // 50g x level squared: +9 is 4,050g, +12 is 7,200g, +15 is 11,250g
    essencePerLevel: 1,      // one Essence of the new piece's band a level carried
  },
};

/* ================= 10a. THE PATH ================= */

/* A discipline's own tree, walked one point at a time. Ten nodes, in three
   bands: four open from the moment the oath is taken, four more once six points
   are down, and two keystones that cost three apiece and want sixteen. The
   nodes themselves live in registry.js (PATHS); this is only the shape.

   Points come with Hunt levels, one every pathPer from the level the oath is
   taken at, so a full tree is never quite affordable: thirty-eight points fill
   one and Hunt 99 pays thirty-two. What you leave out is the choice.

   The oath cannot be unsworn, but the path can: a reset hands every point back
   for respecGold apiece, which is a gold sink rather than a punishment. */

const path = {
  pathPer: 3,             // a point every three Hunt levels, from classPickLevel
  minorRanks: 4,          // how far a lesser node goes
  keystoneCost: 3,        // what the two at the end cost, at one rank each
  bandGates: [0, 6, 16],  // points already spent before a band opens
  respecGold: 250,        // a point, to take them all back
};

/* ================= 10b. WEAPON MASTERY ================= */

/* What a weapon owes you for the hours. Every kill credits the line in your hands
   (and the line in your off-hand, if there is one) with the same points the kill
   paid Warfare before any multiplier, so mastery is earned by hunting and by
   nothing else -- not bought, not crafted, not traded.

   The track runs 0 to 100. A band widens with the square of the level, so the
   first ten come in an evening and the last ten are the work of weeks: reaching
   100 on one line costs about what Warfare 70 costs, which is a commitment to one
   weapon rather than a box ticked.

   The pay-off is flat and readable: perLevel on the line's own stat, so a maxed
   Bow is +15% Bow damage and a maxed Shield is +15% Defence while it is held. It
   applies only while that piece is worn, which is the whole point of a mastery. */

const mastery = {
  max: 100,
  /* A small share of the points the kill paid Warfare. Warfare's own curve is
     what carries you between tiers, so tying mastery to it keeps a weapon's
     hours meaningful at every depth.

     The share is what sets the pace, and the pace is the point: at the Core of
     tier 9 with gear to match, a hunter takes about 1,400 mastery an hour, so
     the whole 332,350 is roughly 2,160 hours of hunting -- three months at a
     full day each, six at half a day, a year at a few hours an evening. A line
     at 100 is meant to be a thing somebody did, not a box they ticked. */
  perKill: 0.027,
  perLevel: 0.0015,           // +0.15% of the line's stat a level: +15% at 100
  // Where the five named milestones sit on the track. Names are per line, in registry.js.
  rankLevels: [10, 30, 50, 75, 100],
  /* The grade a level reads as, on the sheet and in the hiscores. Highest one
     reached wins. The band above them all is not a grade at all: it is Saint, and
     it belongs to whoever stands first in the realm on that line. */
  grades: [
    { at: 0, name: "Untried" },
    { at: 1, name: "Novice" },
    { at: 20, name: "Journeyman" },
    { at: 40, name: "Expert" },
    { at: 60, name: "Master" },
    { at: 80, name: "Grandmaster" },
  ],
  saint: "Saint",
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
const baseHealth = (level) => 250 * Math.pow(1.85, (level - 1) / 10);
const baseAttack = (level) => 10 * Math.pow(1.85, (level - 1) / 10);
const baseDefence = (level) => (hunt.defK / 9) * Math.pow(1.85, (level - 1) / 10);

// Veil a Warrior or Rogue builds per blow, by Hunt level (flat: see veilCurve). Weapons from tier 5 add more.
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

/* Mastery needed to reach a level on a weapon's track, 0 at 0. The band between
   two levels is 40 + L squared, so the whole 100 comes to about 332,000 -- near
   enough what Warfare 70 costs, earned a kill at a time. */
const masteryTable = (() => {
  const t = [0];
  for (let L = 1; L <= mastery.max; L++) t[L] = t[L - 1] + 40 + (L - 1) * (L - 1);
  return t;
})();

export const CONFIG = deepFreeze({
  schema: 13,
  time,
  storage,
  progression,
  hunt,
  economy,
  companions,
  agents,
  weather,
  bench,
  enchant,
  party,
  path,
  mastery,
  xpTable,
  masteryTable,
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
