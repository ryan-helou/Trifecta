import type { Plan, Workout } from "./types";
import { addDays } from "./dates";

// ---------------------------------------------------------------------------
// Strava data handling rules, in one place.
//
// Three obligations from the Strava API Policy, all of which bite on a plan that
// stores completed sessions:
//
//   §2.3  Strava Data may be displayed "only to that user". Never to another
//         athlete, "even if such data is publicly viewable on the Strava Platform."
//   §5.4  The restrictions "apply to data derived from Strava Data and to output
//         that incorporates or was generated using Strava Data." Aggregating or
//         counting it does not make it ours.
//   §5.3  No "operation of any AI Application" over Strava Data, explicitly
//         including "ingestion into a context window or working memory". Inference
//         counts, not just training.
//   §6.2  "You may not retain Strava Data in your cache for longer than seven (7)
//         days."
//
// Trifecta's capacity request was denied 2026-08-07; the League bridge was removed
// first (lib/league/ingest.ts), and these are the remaining paths by which Strava
// data reached somebody other than its owner, an LLM, or long-term storage.
//
// The line drawn on retention deserves stating plainly, because it is a judgement
// call. After seven days we drop everything Strava told us about the activity (its
// name, id, distance, duration, heart rate, power, start time) and keep only our
// own record that the athlete completed the session. Purging the completion itself
// would erase the athlete's training history, which no reading of the policy
// requires and which would make the product lie to them; keeping Strava's measured
// values would breach §6.2 outright. If Strava ever says the completion flag must
// go too, this is the function to change.
// ---------------------------------------------------------------------------

/** How long a Strava-sourced measurement may be retained (API Policy §6.2). */
export const STRAVA_RETENTION_DAYS = 7;

/** Did this session's numbers come from Strava? Pure. */
export function isStravaSourced(w: Workout): boolean {
  return w.actuals?.source === "strava";
}

/** A plan safe to render to somebody OTHER than its owner.
 *
 *  Strava-completed sessions are reverted to "planned" and stripped of their
 *  actuals, so nothing computed downstream — a streak, a session count, a latest
 *  workout title (which for a synced session is the Strava activity's own name) —
 *  can be derived from Strava Data. Sessions the athlete completed by hand or via
 *  Apple Health are untouched, because those are ours to show.
 *
 *  Returns the input unchanged (same reference) when there is nothing to strip.
 *  Pure. */
export function withoutStravaSourced(plan: Plan): Plan {
  if (!plan?.workouts) return plan;
  const ids = Object.keys(plan.workouts).filter((id) => isStravaSourced(plan.workouts[id]));
  if (!ids.length) return plan;
  const workouts = { ...plan.workouts };
  for (const id of ids) {
    const { actuals: _a, actualDurationSec: _d, actualDistanceM: _m, ...rest } = workouts[id];
    workouts[id] = { ...rest, status: "planned" } as Workout;
  }
  return { ...plan, workouts };
}

/** Drop Strava's measurements once they age past the §6.2 seven-day cache window,
 *  keeping our own record that the session was completed. See the note above on
 *  why the completion survives and the measurements do not.
 *
 *  Returns the input unchanged (same reference) when nothing has expired, so this
 *  is cheap to call on every save. Pure. */
export function purgeExpiredStravaData(plan: Plan, todayISO: string): Plan {
  if (!plan?.workouts) return plan;
  const cutoff = addDays(todayISO, -STRAVA_RETENTION_DAYS);
  const ids = Object.keys(plan.workouts).filter((id) => {
    const w = plan.workouts[id];
    if (!isStravaSourced(w)) return false;
    // date is the session's local day; older than the window means the Strava
    // payload has outlived what we're allowed to keep.
    return w.date < cutoff;
  });
  if (!ids.length) return plan;
  const workouts = { ...plan.workouts };
  for (const id of ids) {
    const w = workouts[id];
    const { actuals: _a, ...rest } = w;
    // actualDurationSec / actualDistanceM are Strava's measurements too, so they go
    // with the rest of the payload. `status` stays: that is our record, not theirs.
    const { actualDurationSec: _d, actualDistanceM: _m, ...kept } = rest as Workout & {
      actualDurationSec?: number;
      actualDistanceM?: number;
    };
    workouts[id] = kept as Workout;
  }
  return { ...plan, workouts };
}

/** A session title safe to put in an LLM prompt.
 *
 *  §5.3 bans "ingestion into a context window", and a synced session carries the
 *  Strava activity's own name (set by addBonusWorkout). Engine-generated titles are
 *  ours and pass through untouched. Pure. */
export function coachSafeTitle(w: Workout): string {
  if (!isStravaSourced(w)) return w.title;
  const d = w.discipline;
  return d ? `${d[0].toUpperCase()}${d.slice(1)} session` : "Session";
}
