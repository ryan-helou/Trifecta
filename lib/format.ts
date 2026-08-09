// Small pure formatters shared across the UI.

import { Segment, Unit, Workout } from "./types";

const M_PER_MILE = 1609.34;

export function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** The granularity every prescribed number is shown at (#187).
 *
 *  Ryan: "the difference between a 23 minute bike and a 25 minute bike is nothing,
 *  just make it round and make it easy". He is right, and it isn't only cosmetic —
 *  a 47-minute prescription reads as a computed output, which invites the athlete to
 *  hit it exactly. Nothing in the physiology distinguishes 47 from 45; the engine's
 *  own thresholds are far coarser than the precision it was printing.
 *
 *  Rounded at the point of DISPLAY, deliberately. The ledger keeps real seconds and
 *  real metres, so load, CTL/ATL/TSB and the rails all still compute on what actually
 *  happened — rounding the stored values would quietly corrupt the model that makes
 *  the plan adaptive. */
/** seconds → "1h 20m", "45 min", "8 min" */
export function fmtDuration(totalSec: number): string {
  // Whole minutes, and NOT snapped to a 5-minute step. Snapping was tried for #187
  // and backed out: it made a logged 67-minute session print as "1h 5m", identical
  // to the 65-minute session that had been prescribed. Rounding a MEASUREMENT until
  // it matches the plan is the same defect as showing the plan's distance as though
  // it had been covered — the thing the Today card was fixed for.
  //
  // "Don't tell me about a 47 minute run" is right, but the place to fix it is where
  // the 47 is INVENTED, not where it's displayed: the engine should prescribe 45.
  // Distance below is different — a prescribed 5.7 km and a measured 5.7 km both
  // read fine as 6 km, because the decimal was never carrying meaning.
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
export function fmtDistance(m: number, unit: Unit = "metric", pool = false): string {
  // Whole kilometres and whole miles (#187): "why 5.7". The decimal was the only
  // thing distinguishing one session from another, and nothing in the physiology
  // turns on it.
  //
  // EXCEPT in the pool. A swim is prescribed in metres and 1500 is not 1900 — but
  // converting those to "2 km" makes them the same number, which is worse than the
  // decimal ever was. Swims stay in metres, rounded to the nearest 100, which is
  // still round in the sense the ticket means: no decimals, no 1487.
  if (pool) return `${m >= 400 ? Math.round(m / 100) * 100 : Math.round(m / 25) * 25} m`;
  if (m >= 1000) {
    if (unit === "imperial") return `${Math.round(m / M_PER_MILE)} mi`;
    return `${Math.round(m / 1000)} km`;
  }
  return `${m >= 200 ? Math.round(m / 50) * 50 : Math.round(m)} m`;
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

/** A short "6 × 200m" / "5 × 3′" summary of a session's defining repeat set —
 *  the line under a workout's title.
 *
 *  Prefers a repeat from the MAIN set. It used to take the first repeating
 *  segment in the session, which in a swim is almost always the warm-up build:
 *  the sheet for a "CSS Threshold Set" (44 min, 2.1 km, main set 6 × 200m) read
 *  "Swim · Threshold · 4 × 50m" — advertising the part before the session
 *  starts as the session itself. Warm-up/cool-down repeats are still used when
 *  they're the only ones there are, so a session that's all drills isn't left
 *  with a blank subtitle. */
export function repsSummary(w: Workout): string | null {
  const repeats = (w.segments ?? []).filter((s) => (s.repeat ?? 1) > 1 && !!s.children?.length);
  if (!repeats.length) return null;
  const isMain = (s: Segment) => s.kind !== "warmup" && s.kind !== "cooldown";
  const rep = repeats.find(isMain) ?? repeats[0];
  // describe the effort, not the recovery between efforts
  const child = rep.children!.find((c) => c.kind !== "rest") ?? rep.children![0];
  // Minutes-rounding alone turns a 20s stride into "0′" — the old summary for
  // "Run Threshold 5×1km" literally read "4 × 0′". Anything under two minutes, or
  // that isn't a whole number of them, stays in seconds.
  const sec = child.durationSec ?? 0;
  const time = sec < 120 || sec % 60 !== 0 ? `${sec}s` : `${sec / 60}′`;
  const u = child.distanceM ? `${child.distanceM}m` : sec > 0 ? time : "";
  return u ? `${rep.repeat} × ${u}` : `${rep.repeat}×`;
}
