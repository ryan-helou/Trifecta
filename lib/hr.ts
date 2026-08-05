import type { Plan, Workout } from "./types";

// ---------------------------------------------------------------------------
// Heart-rate anchors inferred from what the athlete has ACTUALLY done (#112).
//
// Today the HR zones are mostly guesswork: if `thresholdHr` is blank the engine
// estimates LTHR ≈ 0.9 × maxHR, and if maxHR is blank too the zones carry no bpm at
// all. Meanwhile Strava has been handing us real heart-rate data on every synced
// session and we were dropping it on the floor.
//
// What we can honestly derive from summary data (no HR streams):
//
//   • maxHR   — the highest per-session peak HR ever seen. A genuine observation, not
//               the 220-age fiction. It can only ever be a floor (you may not have hit
//               your true max), which is fine: it's used as a fallback anchor.
//   • LTHR    — approximated by the highest AVERAGE HR sustained over a long-enough
//               hard effort. This is the field-standard proxy (Friel's 30-min TT
//               average); using the best average from real training is the conservative
//               version of the same idea.
//
// Deliberately NOT done here:
//   • No %HRmax zone model. Doc 01 §4.1 is explicit — anchor to thresholds, never
//     %HRmax, and treat HR as a backstop rather than the primary target.
//   • No overriding a number the athlete typed in. Doc 01 §4.15: where physiology is
//     individual, expose the lever instead of guessing over the top of them.
// ---------------------------------------------------------------------------

/** A session has to be at least this long for its AVERAGE HR to say anything about
 *  threshold. Shorter than this and the average is dominated by warm-up and recovery
 *  between reps, which understates it badly. */
const MIN_EFFORT_SEC = 20 * 60;

/** How many qualifying sessions before we'll trust an inferred LTHR. One hot, poorly
 *  slept, cardiac-drifted session should not get to set four months of targets. */
const MIN_SAMPLES = 3;

/** Physiological sanity bounds — the same range the onboarding benchmark inputs use.
 *  A garbage strap reading 15 or 240 bpm must never reach the zone maths. */
const HR_MIN = 90;
const HR_MAX = 230;

/** An inferred LTHR below this share of observed max is almost certainly not a
 *  threshold effort — it's someone's easy ride. Trained athletes sit ~0.80–0.92. */
const LTHR_FLOOR_OF_MAX = 0.75;

export interface HrObservations {
  /** highest session peak HR ever recorded */
  maxHR: number | null;
  /** best sustained average HR over a qualifying effort — the LTHR proxy */
  lthr: number | null;
  /** how many sessions qualified for the LTHR estimate */
  samples: number;
  /** ISO date of the most recent contributing session, for "as of" copy */
  lastSeenISO: string | null;
}

const plausible = (n: number | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= HR_MIN && n <= HR_MAX;

/**
 * Read real heart-rate anchors out of a plan's completed sessions.
 *
 * Pure: takes the plan, returns numbers. No clock, no I/O — so it can be tested and
 * so it behaves identically on the server and in the app.
 */
export function observeHr(plan: Plan): HrObservations {
  let maxHR: number | null = null;
  let lthr: number | null = null;
  let samples = 0;
  let lastSeenISO: string | null = null;

  const done = (w: Workout) => w.status === "done" || w.status === "swapped";

  for (const w of Object.values(plan.workouts)) {
    if (!done(w) || !w.actuals) continue;
    const a = w.actuals;

    // peak HR: any session with a credible reading counts
    if (plausible(a.maxHr) && (maxHR === null || a.maxHr > maxHR)) maxHR = a.maxHr;

    // threshold proxy: long enough, and an average that isn't nonsense
    const dur = a.durationSec ?? w.estDurationSec ?? 0;
    if (dur >= MIN_EFFORT_SEC && plausible(a.avgHr)) {
      samples++;
      if (lthr === null || a.avgHr > lthr) {
        lthr = a.avgHr;
        lastSeenISO = w.date;
      }
    }
  }

  // Not enough evidence to claim a threshold — say so rather than shipping a number
  // built from one session.
  if (samples < MIN_SAMPLES) {
    lthr = null;
    lastSeenISO = null;
  }

  // An "LTHR" that sits way below observed max is an easy session masquerading as a
  // threshold effort. Better to have no estimate than a lazy one that drags every
  // zone down and makes hard days feel unreachably easy.
  if (lthr !== null && maxHR !== null && lthr < maxHR * LTHR_FLOOR_OF_MAX) lthr = null;

  // Can't be above your own observed peak.
  if (lthr !== null && maxHR !== null && lthr > maxHR) lthr = maxHR;

  return { maxHR, lthr, samples, lastSeenISO };
}
