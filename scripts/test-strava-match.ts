/* Unit checks for the Strava activity → workout matcher (no network / DB). */
import { actualsFromActivity, disciplineOf, matchActivityToWorkout } from "../lib/strava";
import type { Plan, Workout } from "../lib/types";

function w(id: string, date: string, discipline: Workout["discipline"], estDurationSec: number, status: Workout["status"] = "planned"): Workout {
  return {
    id, date, weekIndex: 0, dayIndex: 0, discipline,
    type: "endurance" as Workout["type"], title: id, purpose: "", segments: [],
    estDurationSec, primaryZone: 2 as Workout["primaryZone"], status,
  };
}
const plan = (workouts: Record<string, Workout>) => ({ workouts } as unknown as Plan);

let pass = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

// discipline mapping
eq("run", disciplineOf({ id: 1, type: "Run" }), "run");
eq("trailrun", disciplineOf({ id: 1, sport_type: "TrailRun" }), "run");
eq("ride", disciplineOf({ id: 1, type: "Ride" }), "bike");
eq("virtualride", disciplineOf({ id: 1, sport_type: "VirtualRide" }), "bike");
eq("swim", disciplineOf({ id: 1, type: "Swim" }), "swim");
eq("weights", disciplineOf({ id: 1, type: "WeightTraining" }), "strength");
eq("walk→null", disciplineOf({ id: 1, type: "Walk" }), null);
eq("yoga→null", disciplineOf({ id: 1, type: "Yoga" }), null);

const day = plan({ r1: w("r1", "2026-07-21", "run", 2700), b1: w("b1", "2026-07-21", "bike", 5400), s2: w("s2", "2026-07-22", "swim", 1800) });
eq("match run", matchActivityToWorkout(day, { id: 100, type: "Run", start_date_local: "2026-07-21T06:30:00Z", moving_time: 2760 })?.workoutId, "r1");
eq("match ride", matchActivityToWorkout(day, { id: 101, type: "Ride", start_date_local: "2026-07-21T09:00:00Z", moving_time: 5000 })?.workoutId, "b1");
eq("no swim that day", matchActivityToWorkout(day, { id: 102, type: "Swim", start_date_local: "2026-07-21T07:00:00Z" }), null);
eq("swim next day", matchActivityToWorkout(day, { id: 103, type: "Swim", start_date_local: "2026-07-22T07:00:00Z" })?.workoutId, "s2");
eq("walk no match", matchActivityToWorkout(day, { id: 104, type: "Walk", start_date_local: "2026-07-21T07:00:00Z" }), null);

// two same-discipline sessions same day → closest planned duration wins
const two = plan({ short: w("short", "2026-07-21", "run", 1800), long: w("long", "2026-07-21", "run", 5400) });
eq("closest→short", matchActivityToWorkout(two, { id: 200, type: "Run", start_date_local: "2026-07-21T06:00:00Z", moving_time: 1900 })?.workoutId, "short");
eq("closest→long", matchActivityToWorkout(two, { id: 201, type: "Run", start_date_local: "2026-07-21T06:00:00Z", moving_time: 5000 })?.workoutId, "long");

// already done → not matched again
eq("done skipped", matchActivityToWorkout(plan({ r: w("r", "2026-07-21", "run", 2700, "done") }), { id: 300, type: "Run", start_date_local: "2026-07-21T06:00:00Z" }), null);

// a run can close a brick's run leg
eq("brick accepts run", matchActivityToWorkout(plan({ brick: w("brick", "2026-07-21", "brick", 3600) }), { id: 400, type: "Run", start_date_local: "2026-07-21T06:00:00Z" })?.workoutId, "brick");

// actuals rounding
const a = actualsFromActivity({ id: 9, name: "AM Run", type: "Run", distance: 7230.4, moving_time: 2712, has_heartrate: true, average_heartrate: 151.6, start_date: "2026-07-21T06:00:00Z" });
eq("actuals distance", a.distanceM, 7230);
eq("actuals hr", a.avgHr, 152);
eq("actuals activityId", a.activityId, 9);

console.log(`\nStrava matcher: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
