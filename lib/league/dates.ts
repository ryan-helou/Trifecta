/**
 * Day-range helpers for league scoring. Every date here is a local calendar day
 * string (`YYYY-MM-DD`), never a timestamp — athletes care about "did I ride
 * today", not about UTC instants, and date-only strings make the week/month
 * buckets exact instead of off-by-one near midnight.
 *
 * The primitives (addDays, mondayOf, fromISO, toISO) come from the app's own
 * lib/dates so there's one implementation of "what is next Tuesday" in the
 * codebase; only the range/period logic the league needs lives here.
 */

import { addDays, fromISO, mondayOf, toISO, todayISO } from "../dates";

export type DayKey = string; // YYYY-MM-DD

export { addDays, todayISO };

export function isDayKey(v: unknown): v is DayKey {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

/**
 * The current day for someone whose day rolls over at `resetHour` (local).
 * Shifting "now" back by that many hours means, e.g. with resetHour 3, anything
 * before 3 AM still reads as the previous day — so a 2 AM session counts toward
 * the day (and week) that's ending. Capped at 3 by the caller: later than that
 * and a morning run for the same day starts feeling like it's cheating.
 */
export function todayWithReset(resetHour: number): DayKey {
  return toISO(new Date(Date.now() - resetHour * 3_600_000));
}

/** Monday is day one — the way training weeks are actually counted. */
export const weekStart = mondayOf;

export function weekEnd(key: DayKey): DayKey {
  return addDays(weekStart(key), 6);
}

export function monthStart(key: DayKey): DayKey {
  return `${key.slice(0, 7)}-01`;
}

export function monthEnd(key: DayKey): DayKey {
  const d = fromISO(key);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export type Period = "today" | "week" | "month" | "all";

export const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All time" },
];

/** Inclusive `[from, to]` day range for a period, relative to `ref`. */
export function periodRange(period: Period, ref: DayKey = todayISO()): [DayKey, DayKey] {
  switch (period) {
    case "today":
      return [ref, ref];
    case "week":
      return [weekStart(ref), weekEnd(ref)];
    case "month":
      return [monthStart(ref), monthEnd(ref)];
    case "all":
      return ["0000-01-01", "9999-12-31"];
  }
}

export function inRange(day: DayKey, [from, to]: [DayKey, DayKey]): boolean {
  return day >= from && day <= to;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon 3 Aug" — the compact day label used on records and the feed. */
export function formatDay(key: DayKey): string {
  const d = fromISO(key);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatDayRelative(key: DayKey, ref: DayKey = todayISO()): string {
  if (key === ref) return "Today";
  if (key === addDays(ref, -1)) return "Yesterday";
  return formatDay(key);
}

export function formatRange([from, to]: [DayKey, DayKey]): string {
  const a = fromISO(from);
  const b = fromISO(to);
  return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

export function formatMonth(key: DayKey): string {
  const d = fromISO(key);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

export function shortMonth(monthIndex: number): string {
  return MONTHS[monthIndex];
}

/** Inclusive list of month-start keys from `fromKey`'s month to `toKey`'s month. */
export function monthsBetween(fromKey: DayKey, toKey: DayKey): DayKey[] {
  const keys: DayKey[] = [];
  let cur = monthStart(fromKey);
  const last = monthStart(toKey);
  while (cur <= last) {
    keys.push(cur);
    const d = fromISO(cur);
    cur = toISO(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }
  return keys;
}

/** Compact "just now / 5m / 3h / 2d / 1w" from an ISO timestamp. */
export function timeAgo(iso: string, nowMs = Date.now()): string {
  const s = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}
