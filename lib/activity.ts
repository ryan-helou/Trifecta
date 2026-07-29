import type { Discipline, Plan, Workout, WorkoutActuals, Zone } from "./types";
import { setStatus, reindexWeeks } from "./adapt";
import { dayIndexOf } from "./dates";

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

/** Create a new done-workout for an activity that didn't match any planned session
 *  (rest day, different discipline, etc.). Feeds CTL/ATL/TSB so load tracking stays
 *  complete even when the athlete trains off-plan. Pure — returns the mutated plan. */
function addBonusWorkout(plan: Plan, a: Activity): { plan: Plan; workoutId: string } {
  const disc = a.discipline!;
  const acts = actualsFromActivity(a);
  const zone: Zone = 2;
  const base = `synced-${a.localDay}-${disc}`;
  let id = base;
  let n = 1;
  const p = { ...plan, workouts: { ...plan.workouts }, weeks: plan.weeks.map((w) => ({ ...w, workoutIds: [...w.workoutIds] })) };
  while (p.workouts[id]) id = `${base}-${++n}`;
  const w: Workout = {
    id,
    date: a.localDay,
    weekIndex: 0,
    dayIndex: dayIndexOf(a.localDay),
    discipline: disc,
    type: disc === "strength" ? "strength" : "endurance",
    title: a.name || `${disc[0].toUpperCase()}${disc.slice(1)} (${a.source === "strava" ? "Strava" : "Watch"})`,
    purpose: "Synced from your connected device.",
    segments: [{ kind: "main", discipline: disc, zone, durationSec: a.durationSec, description: "Synced session" }],
    estDurationSec: a.durationSec,
    estDistanceM: a.distanceM,
    primaryZone: zone,
    status: "done",
    actualDurationSec: acts.durationSec,
    actualDistanceM: acts.distanceM,
    actuals: acts,
  };
  p.workouts[id] = w;
  reindexWeeks(p);
  return { plan: p, workoutId: id };
}

/** Pure: apply one activity to a plan — mark the matched session done + attach
 *  actuals (and the flat actual* fields the credit/stats/UI read). Unmatched
 *  activities (rest day, different sport, etc.) create a bonus session so training
 *  load is always complete. Returns the new plan + which workout, or null if it was
 *  already applied. Idempotent. Usable on the client (Apple Health) and the server
 *  (Strava). */
export function applyActivityToPlan(plan: Plan, a: Activity): { plan: Plan; workoutId: string } | null {
  if (!a.discipline) return null;

  // already applied anywhere in the plan → no-op
  const carrier = Object.values(plan.workouts).find((w) => w.actuals?.activityId === a.id);
  if (carrier) return null;

  const match = matchActivity(plan, a);
  if (!match) return addBonusWorkout(plan, a);
  const existing = plan.workouts[match.workoutId];
  if (!existing) return addBonusWorkout(plan, a);

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
