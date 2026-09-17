/* ============================================================
   Respite · popups/sky.js · The Almanac
   ------------------------------------------------------------
   The weather, the same for everyone, opened from the Atlas and
   from the weather card: today on top, then the week revealed
   last Sunday at 00:00 UTC. Weather shifts experience only, never
   speed; each day favours one trade and hinders another by the
   same amount, and weekends are Bountiful. Tomorrow is named only
   once its week is out.
   ============================================================ */

import { h, setText } from "../dom.js";
import { iconEl } from "../icons.js";
import { openModal } from "../overlay.js";
import { fmtTime, signedPct } from "../format.js";
import { registerPopup } from "../widgets.js";
import { CONFIG } from "../../../shared/config.js";
import { GameData, skillName } from "../../../shared/registry.js";
import { dayIndex, weekForecast, weekStartOf, weekdayOf, weatherForDay, tomorrowRevealed, nextDayAt } from "../../../shared/weather.js";

const DAY_MS = CONFIG.time.dayMs;
const WEEKDAYS = GameData.WEEKDAY_NAMES;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BOUNTIFUL = Math.round(CONFIG.weather.bountifulXp * 100);

// "16 Sep" for a world day, spelled out by hand so every browser writes it the same.
function dateLabel(day) {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const upText = (w) => `${signedPct(w.mods[w.favoured])} ${skillName(w.favoured)}`;
const downText = (w) => `${signedPct(w.mods[w.hindered])} ${skillName(w.hindered)}`;

// Today's weather in a word or two, for the chips that open this popup.
export function skyChipText(now) {
  return weatherForDay(dayIndex(now)).label;
}

let open = null;

function openSky(ctx) {
  // One almanac at a time: a second press brings the open one back into view.
  if (open) return open;

  const turns = h("span");
  const nextForecast = h("span");
  const todaySlot = h("div.well");
  const week = h("ol.forecast.forecast-list", { "aria-label": "This week" });
  let sig = "";

  function buildToday(state, now, today) {
    const w = weatherForDay(today);
    const task = state.tasks.skilling;
    const crews = task && (task.skillId === w.favoured || task.skillId === w.hindered) ? task.skillId : null;
    const next = tomorrowRevealed(now) ? weatherForDay(today + 1) : null;

    // replaceChildren would write a skipped part as the text "null": filter them out first.
    todaySlot.replaceChildren(...[
      h("div.hstack.gap-4",
        h("div.art.art-lg", { "data-tone": "gold", "aria-hidden": "true" }, iconEl(w.icon)),
        h("div.grow",
          h("div.eyebrow", `Today · ${WEEKDAYS[weekdayOf(today)]} ${dateLabel(today)}`),
          h("h3.title-md.mt-1", w.label))),
      h("div.chip-row.mt-3",
        h("span.chip.chip-good", `${upText(w)} XP`),
        h("span.chip.chip-bad", `${downText(w)} XP`),
        w.bountiful ? h("span.chip.chip-gold", iconEl("sparkle"), `Bountiful Weekend · +${BOUNTIFUL}% XP to every trade`) : null),
      crews
        ? h("p.small.dim.mt-3", `Your crews are at ${skillName(crews)}: ${signedPct(w.mods[crews])} XP for as long as today lasts.`)
        : null,
      h("p.small.muted.mt-3", next
        ? `Tomorrow: ${next.label} · ${upText(next)}, ${downText(next)}${next.bountiful ? " · Bountiful" : ""}`
        : "Tomorrow opens a new week. It is revealed at 00:00 UTC."),
    ].filter(Boolean));
  }

  function buildWeek(now) {
    week.replaceChildren(...weekForecast(now).map((f) => h("li.fc-day", {
      class: { "is-today": f.today, "is-past": f.past },
      "aria-current": f.today ? "date" : null,
    },
      h("div.fc-when", h("span.eyebrow", f.today ? "Today" : WEEKDAYS[f.weekday]), h("span.fc-date", dateLabel(f.day))),
      h("span.fc-ico", { "aria-hidden": "true" }, iconEl(f.w.icon)),
      h("div.fc-body",
        h("div.fc-name", f.w.label),
        h("div.fc-mods", h("span.up", upText(f.w)), h("span.down", downText(f.w)))),
      f.w.bountiful ? h("span.tag.tag-gold", "Bountiful") : h("span"))));
  }

  function paint() {
    const state = ctx.state;
    const now = ctx.now;
    const today = dayIndex(now);
    const task = state.tasks.skilling;
    const next = `${today}|${task ? task.skillId : "-"}`;
    if (next !== sig) {
      const dayChanged = !sig.startsWith(`${today}|`);
      sig = next;
      buildToday(state, now, today);
      if (dayChanged) {
        buildWeek(now);
        setText(nextForecast, `Next forecast Sun ${dateLabel(weekStartOf(today) + 7)}, 00:00 UTC`);
      }
    }
    setText(turns, `The day turns in ${fmtTime(nextDayAt(now) - now)}`);
  }

  paint();
  const off = ctx.onTick(paint);

  const m = openModal({
    title: "Sky",
    sub: "The same sky over every camp. Weather shifts experience only, never how fast your crews work.",
    art: "sky",
    artTone: "gold",
    size: "lg",
    body: [
      h("div.chip-row", h("span.chip", iconEl("clock"), turns), h("span.chip", iconEl("calendar"), nextForecast)),
      todaySlot,
      h("div.ap-block",
        h("div.eyebrow", "This week"),
        h("p.small.muted", `Each day favours one trade and hinders another by the same amount. Weekends are Bountiful: +${BOUNTIFUL}% XP to every trade.`),
        week),
    ],
    actions: [{ label: "Close", kind: "quiet", wide: true }],
    onClose: () => {
      off();
      open = null;
    },
  });
  open = m;
  return m;
}

registerPopup("sky", openSky);
