// ---------------------------------------------------------------------------
// Internal training load + the daily Performance Management Chart (doc 02).
//
// One unit everywhere: Foster session-RPE (AU) = effort (RPE 0-10) × minutes.
// Each session's effort resolves down a ladder — a logged actual always
// outranks a plan estimate — and every completed session yields SOME load
// (the planned-zone rung guarantees it; nothing here requires a device).
// Daily loads (zero-filled — empty days are what make fitness decay) feed two
// EWMAs: CTL (τ=42d, "fitness") and ATL (τ=7d, "fatigue"); TSB ("form") is
// yesterday's CTL − ATL — the freshness you carry INTO the day.
//
// CTL is smoothed load, not measured fitness — present it as a trend/proxy.
// The PMC is descriptive: nothing in this module drives plan changes (those
// stay in adapt.ts, debounced). All constants are named, exported tunables.
// Pure — no I/O, no clock: "today" is always a parameter, per the
// calibratePaces/assessAdaptation/computeStreak convention.
// ---------------------------------------------------------------------------

import { Feel, Plan, Workout, Zone } from "./types";
import { addDays } from "./dates";
import { creditedSeconds } from "./adapt";
import { ZONES } from "./zones";

// EWMA horizons (days) — the field-standard 42/7 convention, not a law.
export const TAU_CTL = 42, TAU_ATL = 7;
// Exact-EWMA alpha form (1 − e^(−1/τ)); test-pinned so the fold can't drift.
export const K_CTL = 1 - Math.exp(-1 / TAU_CTL);
export const K_ATL = 1 - Math.exp(-1 / TAU_ATL);

// How a finished session felt, in RPE points off the prescribed zone (shared
// with calibrate.ts FEEL_DELTA — keep in lockstep).
export const FEEL_RPE_DELTA: Record<Feel, number> = { rough: 2, ok: 0, great: -1.5 };
// ~3.5% of LTHR ≈ one RPE point (calibrate.ts strainDelta) — the named tunable
// for refining the HR rung beyond band midpoints when real data justifies it.
export const LTHR_PCT_PER_RPE = 3.5;

// Form bands on form% = 100·TSB/max(CTL,1) — TSB relative to CTL, so the
// sRPE-vs-TSS unit scale cancels. freshMax/detrainedMin bound a future
// "detraining" state (sustained > +25); not rendered yet.
export const FORM_BANDS = { freshMin: 5, freshMax: 25, buildingMin: -30, detrainedMin: 25 };

// History gate before a form verdict exists — a one-session PMC is noise.
export const MIN_LEDGER_DAYS = 5;
export const MIN_LOADED_SESSIONS = 2;

export type LoadSource = "rpe" | "hr" | "feel" | "zone";
export interface SessionLoad { load: number; rpe: number; minutes: number; source: LoadSource }
export interface DailyLoad { dateISO: string; load: number }
export interface PmcPoint { dateISO: string; load: number; ctl: number; atl: number; tsb: number }

export type FormBand = "fresh" | "building" | "deep";
export interface FormState { band: FormBand; word: string; line: string; ctl: number; atl: number; tsb: number }

// The one-word state + its supporting line (voice: coach, not dashboard —
// negative form during a build is investment, never failure).
export const FORM_COPY: Record<FormBand, { word: string; line: string }> = {
  fresh: { word: "Fresh", line: "Recovery has caught up. A great day to go hard." },
  building: { word: "Building", line: "Fatigue is part of the plan — fitness is banking underneath." },
  deep: { word: "Deep in it", line: "You've absorbed a big block. Easy days earn it back." },
};

const zoneRpeMid = (z: Zone) => (ZONES[z].rpe[0] + ZONES[z].rpe[1]) / 2;
const clampRpe = (v: number) => Math.max(1, Math.min(10, v));

/** RPE read off average HR: the Friel %LTHR band the session landed in → that
 *  zone's RPE midpoint. Below the Z1 floor reads as minimal effort. */
function hrRpe(avgHr: number, lthr: number): number {
  const pct = (avgHr / lthr) * 100;
  for (const z of [5, 4, 3, 2, 1] as Zone[]) {
    if (pct >= ZONES[z].lthrPct[0]) return clampRpe(zoneRpeMid(z));
  }
  return 1;
}

/** The intensity ladder: logged RPE → device HR → feel → planned zone.
 *  Logged RPE sits above the device deliberately — an interval session's
 *  AVERAGE HR under-reads its true strain, and sRPE is the canonical unit. */
export function effectiveRpe(w: Workout, lthr: number | null): { rpe: number; source: LoadSource } {
  if (typeof w.rpe === "number") return { rpe: w.rpe, source: "rpe" };
  if (lthr && w.actuals?.avgHr) return { rpe: hrRpe(w.actuals.avgHr, lthr), source: "hr" };
  if (w.feel) return { rpe: clampRpe(zoneRpeMid(w.primaryZone) + FEEL_RPE_DELTA[w.feel]), source: "feel" };
  return { rpe: zoneRpeMid(w.primaryZone), source: "zone" };
}

/** One session's internal load. 0 unless completed (done/swapped) and not rest;
 *  duration comes from creditedSeconds (actual → logged → estimate). */
export function sessionLoad(w: Workout, lthr: number | null): SessionLoad {
  if ((w.status !== "done" && w.status !== "swapped") || w.discipline === "rest") {
    return { load: 0, rpe: 0, minutes: 0, source: "zone" };
  }
  const minutes = creditedSeconds(w) / 60;
  const { rpe, source } = effectiveRpe(w, lthr);
  return { load: rpe * minutes, rpe, minutes, source };
}

/** The daily load ledger through `throughISO`, zero-filled (empty days are what
 *  make the EWMAs decay). Grouped from workouts BY DATE — never via
 *  weeks[].workoutIds: after rebuildFromToday the kept- history belongs to no
 *  week, and weeks-based grouping would silently drop it. */
export function dailyLoads(plan: Plan, throughISO: string): DailyLoad[] {
  const lthr = plan.paces.hr.lthr;
  const byDate: Record<string, number> = {};
  let start = plan.startDateISO; // kept- workouts can predate a rebuilt plan's start
  for (const w of Object.values(plan.workouts)) {
    if (w.date < start) start = w.date;
    if (w.date > throughISO) continue;
    const s = sessionLoad(w, lthr);
    if (s.load > 0) byDate[w.date] = (byDate[w.date] ?? 0) + s.load;
  }
  const days: DailyLoad[] = [];
  for (let iso = start; iso <= throughISO; iso = addDays(iso, 1)) {
    days.push({ dateISO: iso, load: byDate[iso] ?? 0 });
  }
  return days;
}

/** Fold the daily ledger into the PMC. TSB is YESTERDAY's CTL − ATL — the form
 *  you wake up with, unaffected by what you do today. Cold start seeds {0,0}
 *  (underestimates already-trained athletes early; a seed enables tests and a
 *  future import-history path). */
export function computePmc(days: DailyLoad[], seed?: { ctl: number; atl: number }): PmcPoint[] {
  let ctl = seed?.ctl ?? 0;
  let atl = seed?.atl ?? 0;
  const points: PmcPoint[] = [];
  for (const d of days) {
    const tsb = ctl - atl;
    ctl += (d.load - ctl) * K_CTL;
    atl += (d.load - atl) * K_ATL;
    points.push({ dateISO: d.dateISO, load: d.load, ctl, atl, tsb });
  }
  return points;
}

/** The full PMC series for a plan through today. */
export function pmc(plan: Plan, todayISO: string): PmcPoint[] {
  return computePmc(dailyLoads(plan, todayISO));
}

/** Band a day's form. CTL-relative so the thresholds survive the sRPE unit scale. */
export function formBand(p: PmcPoint): FormBand {
  const pct = (100 * p.tsb) / Math.max(p.ctl, 1);
  if (pct >= FORM_BANDS.freshMin) return "fresh";
  if (pct <= FORM_BANDS.buildingMin) return "deep";
  return "building";
}

/** Today's one-word form state, or null until there's enough history to mean
 *  anything (≥ MIN_LEDGER_DAYS ledger days AND ≥ MIN_LOADED_SESSIONS completed
 *  sessions carrying load). */
export function formStateFor(plan: Plan, todayISO: string): FormState | null {
  const days = dailyLoads(plan, todayISO);
  if (days.length < MIN_LEDGER_DAYS) return null;
  const lthr = plan.paces.hr.lthr;
  let loaded = 0;
  for (const w of Object.values(plan.workouts)) {
    if (w.date <= todayISO && sessionLoad(w, lthr).load > 0) loaded++;
  }
  if (loaded < MIN_LOADED_SESSIONS) return null;
  const today = computePmc(days)[days.length - 1];
  const band = formBand(today);
  return { band, ...FORM_COPY[band], ctl: today.ctl, atl: today.atl, tsb: today.tsb };
}

/** ΔCTL over the trailing 7 days (~3-8/wk is a sane ramp; a don't-spike
 *  heuristic, deliberately NOT an ACWR ratio). */
export function rampRate(points: PmcPoint[]): number {
  if (points.length === 0) return 0;
  const last = points[points.length - 1];
  const back = points[Math.max(0, points.length - 1 - 7)];
  return last.ctl - back.ctl;
}
