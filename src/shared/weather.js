/* ============================================================
   Respite · weather.js · The Sky
   ------------------------------------------------------------
   Deterministic from the UTC day number, so the sky is the same
   for everyone. Weather touches XP only. Weeks start on Sunday:
   that is when the next seven days are revealed. Every function
   takes a millisecond timestamp (or a day number); the save's
   clock is what the rules pass in.
   ============================================================ */

import { CONFIG } from "./config.js";
import { GameData } from "./registry.js";
import { seedFrom, seededInt } from "./rng.js";

const T = CONFIG.time;

export const dayIndex = (ms) => Math.floor(ms / T.dayMs);

// 0 = Sunday ... 6 = Saturday. Day 0 of the epoch (1 Jan 1970) was a Thursday.
export const weekdayOf = (dayNum) => (((dayNum + 4) % 7) + 7) % 7;

// Day number of the Sunday that opens the week containing dayNum.
export const weekStartOf = (dayNum) => dayNum - weekdayOf(dayNum);

export const isBountiful = (dayNum) => CONFIG.weather.bountifulWeekdays.includes(weekdayOf(dayNum));

// The same day is asked for thousands of times in a long run. Pure, so kept.
const DAYS = new Map();

export function weatherForDay(dayNum) {
  let w = DAYS.get(dayNum);
  if (w) return w;
  const types = GameData.WEATHER_TYPES;
  const type = types[Math.floor(seedFrom(dayNum * 12.9898 + 78.233) * types.length)];
  // randInt(5, 20), seeded by the day so every player sees the same sky.
  const effect = seededInt(dayNum * 39.3468 + 11.1351, CONFIG.weather.effectMin, CONFIG.weather.effectMax);
  const sevs = GameData.WEATHER_SEVERITIES;
  const severity = sevs.find((s) => effect >= s.min && effect <= s.max) || sevs[0];

  w = Object.freeze({
    day: dayNum, id: type.id, name: type.name, icon: type.icon,
    effect, severity: severity.name, label: `${severity.name} ${type.name}`,
    favoured: type.favoured, hindered: type.hindered,
    mods: Object.freeze({ [type.favoured]: effect, [type.hindered]: -effect }),   // whole percent XP
    bountiful: isBountiful(dayNum),
  });
  if (DAYS.size >= 1000) DAYS.clear();
  DAYS.set(dayNum, w);
  return w;
}

export function weatherAt(ms) {
  return weatherForDay(dayIndex(ms));
}

// The week revealed last Sunday at 00:00 UTC, Sunday through Saturday.
export function weekForecast(ms) {
  const today = dayIndex(ms);
  const start = weekStartOf(today);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const day = start + i;
    out.push({ day, weekday: i, today: day === today, past: day < today, w: weatherForDay(day) });
  }
  return out;
}

// Saturday's tomorrow belongs to next week, which isn't revealed yet.
export function tomorrowRevealed(ms) {
  const today = dayIndex(ms);
  return weekStartOf(today + 1) === weekStartOf(today);
}

// Bounties and the smuggler turn over on twelve-hour windows of the world clock.
export const windowIndex = (ms) => Math.floor(ms / T.windowMs);
export const windowEndsIn = (ms) => T.windowMs - (ms % T.windowMs);
export const nextDayAt = (ms) => (dayIndex(ms) + 1) * T.dayMs;
