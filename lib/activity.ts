import type { Discipline, Plan, WorkoutActuals } from "./types";
import { setStatus } from "./adapt";

// ---------------------------------------------------------------------------
// Source-agnostic activity layer.
//
// A completed workout normalized from ANY source (Strava, Apple Health, …) so the
// matcher + apply logic is shared. Apple Health reads happen on-device and match
// here client-side, so raw health data never has to leave the phone — only the
// resulting workout completion syncs (through the normal state save). The Strava
// server path has its own (equivalent) matcher in lib/strava.ts.
// ---------------------------------------------------------------------------

export interface Activity {
  source: WorkoutActuals["source"];
  id: number | string; // stable id for idempotency (Strava id, or HealthKit UUID)
  discipline: Discipline | null;
  localDay: string; // YYYY-MM-DD in the athlete's local time (for day-matching)
  startISO: string;
  durationSec: number;
  distanceM?: number;
  avgHr?: number;
  avgWatts?: number;
  name?: string;
}

export interface Match {
  workoutId: string;
  confidence: "high" | "medium";
}

/** The planned workout this activity most likely completes: same local day, matching
 *  discipline (a brick also accepts a run/bike), still un-done. Closest planned
 *  duration wins ties. Pure. */
export function matchActivity(plan: Plan, a: Activity): Match | null {
  if (!a.discipline || !plan.workouts) return null;
  const candidates = Object.values(plan.workouts).filter((w) => {
    if (w.date !== a.localDay || w.status !== "planned") return false;
    if (w.discipline === a.discipline) return true;
    if (w.discipline === "brick" && (a.discipline === "run" || a.discipline === "bike")) return true;
    return false;
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { workoutId: candidates[0].id, confidence: "high" };
  const actual = a.durationSec;
  candidates.sort((x, y) => Math.abs(x.estDurationSec - actual) - Math.abs(y.estDurationSec - actual));
  return { workoutId: candidates[0].id, confidence: "medium" };
}

export function actualsFromActivity(a: Activity): WorkoutActuals {
  return {
    source: a.source,
    activityId: a.id,
    name: a.name,
    distanceM: a.distanceM != null ? Math.round(a.distanceM) : undefined,
    durationSec: a.durationSec,
    avgHr: a.avgHr != null ? Math.round(a.avgHr) : undefined,
    avgWatts: a.avgWatts != null ? Math.round(a.avgWatts) : undefined,
    startedAtISO: a.startISO,
  };
}

/** Pure: apply one activity to a plan — mark the matched session done + attach
 *  actuals (and the flat actual* fields the credit/stats/UI read). Returns the new
 *  plan + which workout, or null if nothing matched / it was already applied.
 *  Idempotent. Usable on the client (Apple Health) and the server (Strava). */
export function applyActivityToPlan(plan: Plan, a: Activity): { plan: Plan; workoutId: string } | null {
  const match = matchActivity(plan, a);
  if (!match) return null;
  const existing = plan.workouts[match.workoutId];
  if (!existing) return null;
  if (existing.actuals?.activityId === a.id && existing.status === "done") return null;

  const done = setStatus(plan, match.workoutId, "done");
  const acts = actualsFromActivity(a);
  const target = done.workouts[match.workoutId];
  return {
    workoutId: match.workoutId,
    plan: {
      ...done,
      workouts: {
        ...done.workouts,
        [match.workoutId]: {
          ...target,
          actuals: acts,
          actualDurationSec: acts.durationSec ?? target.actualDurationSec,
          actualDistanceM: acts.distanceM ?? target.actualDistanceM,
        },
      },
    },
  };
}
