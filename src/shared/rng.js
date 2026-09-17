/* ============================================================
   Respite · rng.js · The Dice
   ------------------------------------------------------------
   All randomness in the rules comes from here, so the browser and
   the server reach the same results from the same save.

   Two kinds:
     rollAt(seed, a, b, salt)  order-free: the same inputs always roll
                               the same number, however time is sliced.
                               roll(seed, key, index, salt) is the same
                               with a string key ("a:delving_t3").
     makeRng(holder, key)      a sequential stream kept in the save,
                               for things that happen one after another.
   ============================================================ */

function mix(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// A whole number from any string, for seeding a new save from its owner.
export function hashString(text) {
  let h = 2166136261;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mix(h >>> 0);
}

// 0..1 from four whole numbers. Used for per-action rolls: (task, action, what).
export function rollAt(seed, a, b, salt) {
  let h = mix((seed ^ 0x9e3779b9) >>> 0);
  h = mix((h ^ Math.imul(a | 0, 0x85ebca6b)) >>> 0);
  h = mix((h ^ Math.imul(b | 0, 0xc2b2ae35)) >>> 0);
  h = mix((h ^ Math.imul(salt | 0, 0x27d4eb2f)) >>> 0);
  return h / 4294967296;
}

// What each per-action roll is for. Changing these changes every future roll.
// drop and companion are bases: a monster's j-th drop rolls drop + j, the
// i-th companion in the registry rolls companion + i.
export const SALT = Object.freeze({
  double: 1, reagent: 2, reagentExtra: 3, rarity: 4, prefix: 5,
  drop: 10,
  rare: 30, rareRarity: 31, rarePick: 32,
  sovereignPick: 40, sovereignPrefix: 41,
  companion: 100,
});

// Roll keys repeat constantly ("m:mob_t9_brute"), so their hashes are kept.
// A pure cache: it is cleared if something ever feeds it unbounded keys.
const KEY_HASHES = new Map();

export function hashKey(key) {
  let h = KEY_HASHES.get(key);
  if (h === undefined) {
    if (KEY_HASHES.size >= 10000) KEY_HASHES.clear();
    h = hashString(key);
    KEY_HASHES.set(key, h);
  }
  return h;
}

// A counter roll: the index-th time `key` happened, for one purpose (salt).
export function roll(seed, key, index, salt) {
  return rollAt(seed, hashKey(key), index, salt);
}

// One step of mulberry32 on a uint32 state. Returns [nextState, value].
export function stepRng(s) {
  const next = (s + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [next, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

// A stream that lives at holder[key] (a uint32), so it survives saving.
export function makeRng(holder, key) {
  return () => {
    const [next, value] = stepRng(holder[key] >>> 0);
    holder[key] = next;
    return value;
  };
}

// A stream that lives only in memory, for projections.
export function seededRng(seed) {
  const box = { s: seed >>> 0 };
  return makeRng(box, "s");
}

export const randIntWith = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));

// Deterministic 0-1 from any number: the same for everyone. Weather, bounties, the smuggler.
export function seedFrom(n) {
  const x = Math.sin(n) * 10000;
  return x - Math.floor(x);
}

export const seededInt = (seed, min, max) => min + Math.floor(seedFrom(seed) * (max - min + 1));
