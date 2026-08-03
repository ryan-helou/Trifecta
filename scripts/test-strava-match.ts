/* Unit checks for the Strava activity → workout matcher + applier (no network / DB). */
import { activityLocalDay, actualsFromActivity, applyActivityToUser, disciplineOf, matchActivityToWorkout } from "../lib/strava";
import { applyActivityToPlan, type Activity } from "../lib/activity";
import type { AppState, Store } from "../lib/db";
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

// local-day derivation: start_date_local wins; else shift start_date by utc_offset
eq("local wins", activityLocalDay({ id: 1, start_date_local: "2026-07-21T19:00:00Z", start_date: "2026-07-22T02:00:00Z" }), "2026-07-21");
eq("utc − offset", activityLocalDay({ id: 1, start_date: "2026-07-22T02:30:00Z", utc_offset: -25200 }), "2026-07-21");
eq("utc + offset", activityLocalDay({ id: 1, start_date: "2026-07-21T22:00:00Z", utc_offset: 7200 }), "2026-07-22");
eq("utc no offset", activityLocalDay({ id: 1, start_date: "2026-07-22T02:30:00Z" }), "2026-07-22");
eq("no dates", activityLocalDay({ id: 1 }), null);
// a 7:30pm PDT run (2:30am UTC next day) still matches Tuesday's session
eq("evening PDT run", matchActivityToWorkout(day, { id: 105, type: "Run", start_date: "2026-07-22T02:30:00Z", utc_offset: -25200, moving_time: 2760 })?.workoutId, "r1");

// ---- applyActivityToUser: idempotency, update-in-place, CAS retry ----

/** In-memory CAS store — just the two methods the applier touches. `conflicts`
 *  makes the first N writes lose the version race (a concurrent writer bumped). */
function fakeStore(initial: AppState, conflicts = 0) {
  let state = initial;
  let version = 1;
  const calls = { writes: 0 };
  const store = {
    getDataV: async () => ({ state, version }),
    setDataIf: async (_uid: string, data: AppState, expected: number) => {
      calls.writes++;
      if (conflicts > 0) { conflicts--; version++; return null; }
      if (expected !== version) return null;
      state = data;
      version++;
      return version;
    },
  } as unknown as Store;
  return { store, plan: () => (state.plan as Plan), version: () => version, calls };
}

const applyPlan = (workouts: Record<string, Workout>) => ({ workouts, weeks: [] } as unknown as Plan);
const run500 = { id: 500, type: "Run", name: "Morning Run", start_date_local: "2026-07-21T06:30:00Z", moving_time: 2760, distance: 8000 };

(async () => {
  // two runs that day — activity 500 must only ever complete one of them
  const s = fakeStore({ plan: applyPlan({ rA: w("rA", "2026-07-21", "run", 2700), rB: w("rB", "2026-07-21", "run", 5400) }) });
  const first = await applyActivityToUser(s.store, "u1", run500);
  eq("apply matches", { matched: first.matched, workoutId: first.workoutId }, { matched: true, workoutId: "rA" });
  eq("apply completes", s.plan().workouts.rA.status, "done");
  eq("apply actuals", s.plan().workouts.rA.actuals?.activityId, 500);
  eq("apply duration", s.plan().workouts.rA.actualDurationSec, 2760);

  // same activity re-delivered → no-op: no write, no second completion
  const again = await applyActivityToUser(s.store, "u1", run500);
  eq("re-apply alreadyDone", { alreadyDone: again.alreadyDone, updated: again.updated }, { alreadyDone: true, updated: undefined });
  eq("re-apply no write", s.version(), 2);
  eq("re-apply rB untouched", s.plan().workouts.rB.status, "planned");

  // Strava "update" (crop + rename) → refresh the carrier's actuals in place
  const upd = await applyActivityToUser(s.store, "u1", { ...run500, name: "Renamed", moving_time: 2500, distance: 7500 });
  eq("update in place", { alreadyDone: upd.alreadyDone, updated: upd.updated, workoutId: upd.workoutId }, { alreadyDone: true, updated: true, workoutId: "rA" });
  eq("update name", s.plan().workouts.rA.actuals?.name, "Renamed");
  eq("update duration", s.plan().workouts.rA.actualDurationSec, 2500);
  eq("update distance", s.plan().workouts.rA.actualDistanceM, 7500);
  eq("update rB untouched", s.plan().workouts.rB.status, "planned");

  // carrier the athlete un-did stays theirs: refresh it, never complete a sibling
  const undone = fakeStore({
    plan: applyPlan({
      rC: { ...w("rC", "2026-07-21", "run", 2700, "skipped"), actuals: { source: "strava", activityId: 600, durationSec: 2400 }, actualDurationSec: 2400 },
      rD: w("rD", "2026-07-21", "run", 3600),
    }),
  });
  const redo = await applyActivityToUser(undone.store, "u1", { id: 600, type: "Run", start_date_local: "2026-07-21T07:00:00Z", moving_time: 2450 });
  eq("undone carrier owns it", redo.workoutId, "rC");
  eq("undone status kept", undone.plan().workouts.rC.status, "skipped");
  eq("undone sibling untouched", undone.plan().workouts.rD.status, "planned");

  // CAS conflict → re-read and re-apply, then succeed
  const raced = fakeStore({ plan: applyPlan({ rE: w("rE", "2026-07-21", "run", 2700) }) }, 1);
  const won = await applyActivityToUser(raced.store, "u1", run500);
  eq("cas retry matches", { matched: won.matched, workoutId: won.workoutId }, { matched: true, workoutId: "rE" });
  eq("cas retry wrote twice", raced.calls.writes, 2);
  eq("cas retry completes", raced.plan().workouts.rE.status, "done");

  // ---- bonus sessions: unmatched activities create new done workouts ----

  // rest day (no workouts) → bike creates a bonus session
  const rest = fakeStore({ plan: applyPlan({}) });
  const bike700 = { id: 700, type: "Ride", name: "Evening Ride", start_date_local: "2026-07-21T18:00:00Z", moving_time: 2100, distance: 15030 };
  const bonus1 = await applyActivityToUser(rest.store, "u1", bike700);
  eq("bonus matched", bonus1.matched, true);
  eq("bonus workoutId", bonus1.workoutId, "synced-2026-07-21-bike");
  const bw = rest.plan().workouts["synced-2026-07-21-bike"];
  eq("bonus status", bw.status, "done");
  eq("bonus discipline", bw.discipline, "bike");
  eq("bonus actuals id", bw.actuals?.activityId, 700);
  eq("bonus duration", bw.actualDurationSec, 2100);
  eq("bonus distance", bw.actualDistanceM, 15030);
  eq("bonus title from name", bw.title, "Evening Ride");

  // wrong sport: plan has swim, athlete does a run → bonus (not matched to the swim)
  const wrongSport = fakeStore({ plan: applyPlan({ sw: w("sw", "2026-07-21", "swim", 1800) }) });
  const run800 = { id: 800, type: "Run", start_date_local: "2026-07-21T06:00:00Z", moving_time: 1800 };
  const bonus2 = await applyActivityToUser(wrongSport.store, "u1", run800);
  eq("wrong-sport bonus", bonus2.matched, true);
  eq("wrong-sport bonus id", bonus2.workoutId, "synced-2026-07-21-run");
  eq("wrong-sport swim untouched", wrongSport.plan().workouts.sw.status, "planned");

  // re-delivering a bonus activity → idempotent (carrier check finds it)
  const bonus2again = await applyActivityToUser(wrongSport.store, "u1", run800);
  eq("bonus re-deliver alreadyDone", bonus2again.alreadyDone, true);

  // walk (null discipline) → still no match, no bonus
  const walk = fakeStore({ plan: applyPlan({}) });
  const walk900 = { id: 900, type: "Walk", start_date_local: "2026-07-21T07:00:00Z", moving_time: 3600 };
  const noBonus = await applyActivityToUser(walk.store, "u1", walk900);
  eq("walk no bonus", noBonus.matched, false);

  // two bonus sessions same day same discipline → unique ids
  const twoBonus = fakeStore({ plan: applyPlan({}) });
  await applyActivityToUser(twoBonus.store, "u1", { id: 950, type: "Run", start_date_local: "2026-07-21T06:00:00Z", moving_time: 1200 });
  await applyActivityToUser(twoBonus.store, "u1", { id: 951, type: "Run", start_date_local: "2026-07-21T18:00:00Z", moving_time: 1500 });
  eq("two bonus unique ids", !!twoBonus.plan().workouts["synced-2026-07-21-run"] && !!twoBonus.plan().workouts["synced-2026-07-21-run-2"], true);

  // ---- cross-source dedup: the same physical run via BOTH feeds counts ONCE ----

  // Apple Watch → Apple Health already logged an off-plan run as a bonus done session.
  const bothSrc = fakeStore({
    plan: applyPlan({
      hk: {
        ...w("hk", "2026-07-21", "run", 2760, "done"),
        actuals: { source: "healthkit", activityId: "HK-1", durationSec: 2760, startedAtISO: "2026-07-21T06:30:00Z" },
        actualDurationSec: 2760,
      },
    }),
  });
  // the SAME run also lands on Strava (different id, starts a minute later) → must dedup
  const stravaDup = { id: 1000, type: "Run", start_date_local: "2026-07-21T06:31:00Z", moving_time: 2740, distance: 8000 };
  const deduped = await applyActivityToUser(bothSrc.store, "u1", stravaDup);
  eq("strava dup of an Apple Health run does not apply", deduped.matched, false);
  eq("strava dup creates no second session", Object.keys(bothSrc.plan().workouts).length, 1);

  // reverse: plan carries a Strava run, Apple Health reports the same one → null (client path)
  const stravaPlan = applyPlan({
    st: {
      ...w("st", "2026-07-21", "run", 2760, "done"),
      actuals: { source: "strava", activityId: 2000, durationSec: 2760, startedAtISO: "2026-07-21T06:30:00Z" },
      actualDurationSec: 2760,
    },
  });
  const hkDup: Activity = { source: "healthkit", id: "HK-2", discipline: "run", localDay: "2026-07-21", startISO: "2026-07-21T06:32:00Z", durationSec: 2750 };
  eq("apple-health dup of a Strava run returns null", applyActivityToPlan(stravaPlan, hkDup), null);

  // NOT a dup: a genuinely separate run later the same day from the other feed still counts
  const laterHk: Activity = { source: "healthkit", id: "HK-3", discipline: "run", localDay: "2026-07-21", startISO: "2026-07-21T18:00:00Z", durationSec: 1800 };
  eq("distinct cross-source run still applies (creates a bonus)", applyActivityToPlan(stravaPlan, laterHk) !== null, true);

  console.log(`\nStrava matcher: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
