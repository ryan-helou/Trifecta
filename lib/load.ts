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
import { creditedSeconds } from "./credit";
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
// How far below the plan's own prescribed form an athlete must drift before the next
// week is softened. Calibrated on simulated athletes: a compliant one measures exactly
// 0%, a persistent +1 RPE lands near −8 to −11%, +2 RPE near −13 to −19%. Set so real
// overreaching fires while ordinary build-phase depth does not.
//
// Was −12 while TSB was a lagged quantity. Making TSB same-day (see computePmc)
// compressed the whole deviation scale by a factor of ~0.72, so the line had to move
// with its units or the trigger would have quietly gone deaf — the constant is
// expressed in the fold's terms, and the fold changed. −8.5 was chosen by measurement,
// not by scaling: swept across 5 archetypes × 7 weeks × 9 effort levels, it reproduces
// 312 of 315 of the shipped ease/no-ease decisions, and all 3 differences are
// none → ease. Nothing became less protective.
export const FORM_DEBT_EASE_PCT = -8.5;
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
  // A rung that INFERRED effort from the logged sets/reps/weight was built here
  // for #199 and deliberately removed. Measured, it ranked a 5×5 at 100 kg
  // (8 sets, 4,180 kg) at RPE 3 and a bodyweight circuit (18 sets) at 6.5 — so a
  // heavy squat day scored 105 AU against the circuit's 228, and below the 193
  // the plain zone fallback already gives. Set density separates a circuit from a
  // strength session but ranks them backwards for systemic cost, and without a
  // 1RM there is no honest way to price relative intensity. A number that wrong
  // is worse than the default it replaced, so the gym log reaches the PMC the
  // same way every other session does: through the RPE the athlete gives it.
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

/**
 * Fold the daily ledger into the PMC. TSB is SAME-DAY CTL − ATL, so the three
 * numbers the athlete is shown actually subtract.
 *
 * This used to store yesterday's gap (the TrainingPeaks convention) next to
 * today's updated CTL and ATL, which made the Form card unable to reconcile:
 * a real athlete read "Fitness 192 · Fatigue 208 · Form +11". The lag has a
 * genuine rationale — form is what you wake up WITH, and today's session
 * shouldn't move it — but it was never surfaced, so it read as an arithmetic
 * bug (product decision, 2026-08-09, Ryan).
 *
 * Two things make the same-day reading safe here, and both were measured
 * rather than assumed:
 *
 *   1. `sessionLoad` credits nothing until a session is done/swapped, so a
 *      planned session contributes 0. Opening the app in the morning, today's
 *      work isn't in the ledger yet — which is precisely the "unaffected by
 *      what you do today" property the lag was protecting, already provided by
 *      the status gate. The lag was double-counting a guarantee we had.
 *   2. On race morning it reads BETTER: across the archetypes, a tapered
 *      half/intermediate goes building → fresh (+10 → +47) and half/advanced
 *      +19 → +61. Telling a fully-tapered athlete they're "building" on the
 *      start line was the lag's fault.
 *
 * 27% of athlete-days change band, near-symmetrically (59 down, 69 up) — a
 * different reading, not a drift in one direction.
 *
 * Cold start seeds {0,0} (underestimates already-trained athletes early; a
 * seed enables tests and a future import-history path).
 */
export function computePmc(days: DailyLoad[], seed?: { ctl: number; atl: number }): PmcPoint[] {
  let ctl = seed?.ctl ?? 0;
  let atl = seed?.atl ?? 0;
  const points: PmcPoint[] = [];
  for (const d of days) {
    ctl += (d.load - ctl) * K_CTL;
    atl += (d.load - atl) * K_ATL;
    points.push({ dateISO: d.dateISO, load: d.load, ctl, atl, tsb: ctl - atl });
  }
  return points;
}

/**
 * The athlete's assumed starting fitness, as an average daily load.
 *
 * Without this the PMC starts from CTL = ATL = 0, and because CTL's time constant is
 * 42 days it takes months to catch up — so ATL towers over CTL and TSB reads
 * catastrophically negative for the whole early plan. Measured on a fully-compliant
 * 70.3 athlete: form% of −247 in week 2, and still "Deep in it" at week 15. Every
 * athlete was told they were buried from their first week, and any planning decision
 * keyed on form would have eased everyone, forever.
 *
 * The engine already assumes the athlete can handle the week it prescribes them, so
 * seed with exactly that: week one's prescribed daily load. TSB then starts near zero
 * and measures what it should — how the athlete is tracking against *their own plan*
 * — rather than against a fictional couch-to-70.3 cold start.
 */
export function seedLoad(plan: Plan): number {
  const wk = plan.weeks[0];
  if (!wk) return 0;
  let total = 0;
  for (const id of wk.workoutIds) {
    const w = plan.workouts[id];
    if (!w || w.discipline === "rest") continue;
    // prescribed, not logged: zone RPE midpoint × the estimated duration
    total += zoneRpeMid(w.primaryZone) * (w.estDurationSec / 60);
  }
  return total / 7;
}

/** The full PMC series for a plan through today, seeded so day one isn't a cliff. */
export function pmc(plan: Plan, todayISO: string): PmcPoint[] {
  const seed = seedLoad(plan);
  return computePmc(dailyLoads(plan, todayISO), { ctl: seed, atl: seed });
}

/** A session's PRESCRIBED load — what the plan asks for, regardless of completion. Future
 *  sessions haven't happened, so sessionLoad() reads them as 0; folding that forward just
 *  decays the curve to nothing (a taper, ironically, looks fine — but a base/build phase
 *  reads as detraining). This values a planned session at its prescription instead. */
export function plannedLoad(w: Workout): number {
  if (w.discipline === "rest") return 0;
  return zoneRpeMid(w.primaryZone) * (w.estDurationSec / 60);
}

/** Daily ledger that blends ACTUAL past (completed sessions; misses count as 0) with
 *  PROJECTED future (each planned session at its prescribed load), split at todayISO —
 *  i.e. "where you are, and where the plan takes you if you follow it". */
export function projectedDailyLoads(plan: Plan, todayISO: string, throughISO: string): DailyLoad[] {
  const lthr = plan.paces.hr.lthr;
  const byDate: Record<string, number> = {};
  let start = plan.startDateISO;
  for (const w of Object.values(plan.workouts)) {
    if (w.date < start) start = w.date;
    if (w.date > throughISO) continue;
    const load = w.date <= todayISO ? sessionLoad(w, lthr).load : plannedLoad(w);
    if (load > 0) byDate[w.date] = (byDate[w.date] ?? 0) + load;
  }
  const days: DailyLoad[] = [];
  for (let iso = start; iso <= throughISO; iso = addDays(iso, 1)) {
    days.push({ dateISO: iso, load: byDate[iso] ?? 0 });
  }
  return days;
}

/** The PMC projected to `throughISO`: actual through today, then the prescribed plan. */
export function projectedPmc(plan: Plan, todayISO: string, throughISO: string): PmcPoint[] {
  const seed = seedLoad(plan);
  return computePmc(projectedDailyLoads(plan, todayISO, throughISO), { ctl: seed, atl: seed });
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
  // seeded, exactly as pmc() is — an unseeded fold here is what made the Form card
  // announce "Deep in it" to every athlete from their very first week
  const seed = seedLoad(plan);
  const today = computePmc(days, { ctl: seed, atl: seed })[days.length - 1];
  const band = formBand(today);
  return { band, ...FORM_COPY[band], ctl: today.ctl, atl: today.atl, tsb: today.tsb };
}

/**
 * How deep the athlete actually is, versus how deep this plan MEANT to put them.
 *
 * "Deep in it" on its own is not a problem — it's what a build phase is for, and a
 * compliant athlete lives there for weeks. Easing on the band alone would fight the
 * plan. The signal worth acting on is the *deviation*: the same dates, valued once at
 * the load the athlete actually produced and once at the load the plan prescribed. A
 * materially lower TSB than the design called for means the work is costing more than
 * budgeted — the cumulative version of "rising RPE for the same prescribed zone", which
 * is the cheapest early overreaching signal there is.
 *
 * Returns null until there's enough history to mean anything. `deltaPct` is expressed
 * against CTL so the sRPE unit scale cancels; negative = deeper than intended.
 */
export function formDeviation(
  plan: Plan,
  todayISO: string,
): { actualTsb: number; plannedTsb: number; deltaPct: number } | null {
  const actualDays = dailyLoads(plan, todayISO);
  if (actualDays.length < MIN_LEDGER_DAYS) return null;
  const lthr = plan.paces.hr.lthr;
  let loaded = 0;
  for (const w of Object.values(plan.workouts)) {
    if (w.date <= todayISO && sessionLoad(w, lthr).load > 0) loaded++;
  }
  if (loaded < MIN_LOADED_SESSIONS) return null;

  // the same ledger, valued at what the plan ASKED for rather than what happened
  const prescribed = new Map<string, number>();
  for (const d of actualDays) prescribed.set(d.dateISO, 0);
  for (const w of Object.values(plan.workouts)) {
    if (w.discipline === "rest" || w.date > todayISO) continue;
    if (!prescribed.has(w.date)) continue;
    prescribed.set(w.date, prescribed.get(w.date)! + zoneRpeMid(w.primaryZone) * (w.estDurationSec / 60));
  }
  const plannedDays: DailyLoad[] = actualDays.map((d) => ({ dateISO: d.dateISO, load: prescribed.get(d.dateISO) ?? 0 }));

  const seed = seedLoad(plan);
  const a = computePmc(actualDays, { ctl: seed, atl: seed });
  const p = computePmc(plannedDays, { ctl: seed, atl: seed });
  const last = a[a.length - 1];
  const lastP = p[p.length - 1];
  if (!last || !lastP) return null;
  return {
    actualTsb: last.tsb,
    plannedTsb: lastP.tsb,
    deltaPct: (100 * (last.tsb - lastP.tsb)) / Math.max(last.ctl, 1),
  };
}


