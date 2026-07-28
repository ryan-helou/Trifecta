// Small pure formatters shared across the UI.

import { Unit } from "./types";

const M_PER_MILE = 1609.34;

export function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** seconds → "1h 20m", "45 min", "8 min" */
export function fmtDuration(totalSec: number): string {
  // Round to whole minutes first, then split — otherwise a value like 7170s
  // rounds the minutes to 60 and prints "1h 60m" instead of "2h".
  const totalMin = Math.round(totalSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m} min`;
}

/** seconds → "1:20:05" or "45:00" (clock) */
export function fmtClock(totalSec: number): string {
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}

/**
 * fmtClock's inverse: "h:mm:ss" / "mm:ss" / bare minutes / colon-less digits → seconds.
 * Returns null when unparseable — or when the total is zero, so a typed "0" reads
 * as "no time" rather than a zero-second session.
 */
export function parseClock(str: string): number | null {
  const s = str.trim();
  if (!s) return null;
  let total: number;
  if (s.includes(":")) {
    const parts = s.split(":").map((x) => Number(x));
    if (parts.some((x) => isNaN(x) || x < 0)) return null;
    if (parts.length === 3) total = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) total = parts[0] * 60 + parts[1];
    else if (parts.length === 1) total = parts[0] * 60;
    else return null;
  } else {
    // No colon (a phone's numeric keypad has none): 1–2 digits are minutes, 3+ digits
    // are m…mss with the last two as seconds — so "4230" is 42:30, not 4230 minutes.
    if (!/^\d+$/.test(s)) return null;
    if (s.length <= 2) {
      total = Number(s) * 60;
    } else {
      const sec = Number(s.slice(-2));
      if (sec >= 60) return null;
      total = Number(s.slice(0, -2)) * 60 + sec;
    }
  }
  return total > 0 ? total : null;
}

/** meters → "5.0 km" / "400 m" (metric) or "3.1 mi" / "400 m" (imperial). Sub-km stays in metres in both. */
export function fmtDistance(m: number, unit: Unit = "metric"): string {
  if (m >= 1000) {
    if (unit === "imperial") {
      const mi = m / M_PER_MILE;
      return `${mi % 1 === 0 ? mi.toFixed(0) : mi.toFixed(1)} mi`;
    }
    const km = m / 1000;
    return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)} km`;
  }
  return `${Math.round(m)} m`;
}

/** sec/km → "4:37/km" (metric) or "7:26/mi" (imperial) */
export function fmtPace(secPerKm: number, unit: Unit = "metric"): string {
  const per = unit === "imperial" ? secPerKm * (M_PER_MILE / 1000) : secPerKm;
  let m = Math.floor(per / 60);
  let s = Math.round(per % 60);
  if (s === 60) { m += 1; s = 0; } // carry when seconds round up, so we never print "4:60"
  return `${m}:${pad(s)}/${unit === "imperial" ? "mi" : "km"}`;
}

/** sec/100m → "1:31/100m" (unit-agnostic; swim stays metric) */
export function fmtPace100(secPer100: number): string {
  let m = Math.floor(secPer100 / 60);
  let s = Math.round(secPer100 % 60);
  if (s === 60) { m += 1; s = 0; } // carry when seconds round up, so we never print "1:60"
  return `${m}:${pad(s)}/100m`;
}

/** a range like "4:30–4:45/km" from two sec/km values */
export function fmtPaceRange(lo: number, hi: number, unit: Unit = "metric"): string {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const suffix = unit === "imperial" ? "/mi" : "/km";
  const fa = fmtPace(a, unit).replace(suffix, "");
  const fb = fmtPace(b, unit);
  return `${fa}–${fb}`;
}

export function fmtPace100Range(lo: number, hi: number): string {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const fa = fmtPace100(a).replace("/100m", "");
  const fb = fmtPace100(b);
  return `${fa}–${fb}`;
}
