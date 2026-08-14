/*
  An undo must outrank the sync.

  The bug, in Ryan's words (2026-08-14): "every time i undo completed and come back
  to the app it shows completed". Two mechanisms conspired, and neither knew the
  athlete had made a decision:

    1. POST /api/strava/sync re-reads the last 21 DAYS of activities on every pass,
       and the pass now runs every two minutes (1.0.62). Un-tick a session and the
       same ride matched the same session again, immediately.
    2. The client then adopted the server's whole plan wholesale. The undo was still
       sitting in the debounced save queue, so the server's copy still said "done" —
       and replaced the local copy that said otherwise. `newlyDone` then read that as
       a fresh completion and re-adapted the plan around it.

  So an undo could not survive its own timer, and no amount of tapping it helped.
  These lock down the fix from both ends: the plan REMEMBERS the detachment, the
  server refuses to re-offer a detached activity, and the client merges rather than
  replaces.
*/
import assert from "node:assert";
import { DETACHED_MAX, isDetached, setStatus } from "../lib/adapt";
import { mergeCompletions } from "../lib/planMerge";
import { weekSessionsOn } from "../components/app/widgets";
import { applyActivityToUser } from "../lib/strava";
import type { AppState, Store } from "../lib/db";
import type { Plan, Workout } from "../lib/types";

let pass = 0;
function ok(label: string, cond: boolean) {
  assert.ok(cond, `FAILED: ${label}`);
  pass++;
}
function section(name: string) {
  console.log(`\n  ${name}`);
}

function w(id: string, date: string, discipline: Workout["discipline"], estDurationSec: number, status: Workout["status"] = "planned"): Workout {
  return {
    id, date, weekIndex: 0, dayIndex: 0, discipline,
    type: "endurance", title: id, purpose: "", segments: [],
    estDurationSec, primaryZone: 2, status,
  };
}
/** A plan with a real week, so reindexing + Plan-tab rendering can be checked. */
function planOf(workouts: Record<string, Workout>): Plan {
  return {
    workouts,
    weeks: [{ index: 0, startDate: "2026-07-20", workoutIds: Object.keys(workouts) }],
  } as unknown as Plan;
}
function completed(id: string, date: string, disc: Workout["discipline"], activityId: number, name = "Tempoish Run"): Workout {
  return {
    ...w(id, date, disc, 1200, "done"),
    actuals: { source: "strava", activityId, name, durationSec: 1472, distanceM: 4002 },
    actualDurationSec: 1472,
    actualDistanceM: 4002,
  };
}

function fakeStore(initial: AppState) {
  let state = initial;
  let version = 1;
  const calls = { writes: 0 };
  const store = {
    getDataV: async () => ({ state, version }),
    setDataIf: async (_uid: string, data: AppState, expected: number) => {
      calls.writes++;
      if (expected !== version) return null;
      state = data;
      version++;
      return version;
    },
  } as unknown as Store;
  return { store, plan: () => state.plan as Plan, calls };
}

const TEMPOISH = { id: 19740268683, type: "Run", name: "Tempoish Run", start_date_local: "2026-07-21T10:45:00Z", moving_time: 1472, distance: 4002 };

async function main() {
  // ---- undo records the decision ------------------------------------------------
  section("undo detaches the activity");
  const done = planOf({ r1: completed("r1", "2026-07-21", "run", 19740268683) });
  const undone = setStatus(done, "r1", "planned");
  ok("the session is planned again", undone.workouts.r1.status === "planned");
  ok("THE FIX: the activity is recorded as detached", isDetached(undone, 19740268683));
  ok("the device actuals go with it", undone.workouts.r1.actuals === undefined);
  ok("…including the duration", undone.workouts.r1.actualDurationSec === undefined);
  ok("…and the distance", undone.workouts.r1.actualDistanceM === undefined);

  // Only an undo detaches. Completing, skipping and swapping must not.
  ok("marking done detaches nothing", !(setStatus(done, "r1", "done").detachedActivityIds ?? []).length);
  ok("skipping detaches nothing", !(setStatus(done, "r1", "skipped").detachedActivityIds ?? []).length);
  ok("a session with no activity detaches nothing",
    !(setStatus(planOf({ p: w("p", "2026-07-21", "run", 1200) }), "p", "planned").detachedActivityIds ?? []).length);

  // Undoing twice must not double-record, and the list is bounded.
  ok("detaching is idempotent", (setStatus(undone, "r1", "planned").detachedActivityIds ?? []).length === 1);
  const many = { ...undone, detachedActivityIds: Array.from({ length: DETACHED_MAX }, (_, i) => i) };
  const capped = setStatus({ ...many, workouts: { r2: completed("r2", "2026-07-21", "run", 999999) } } as Plan, "r2", "planned");
  ok("the list stays bounded", (capped.detachedActivityIds ?? []).length === DETACHED_MAX);
  ok("and keeps the newest", (capped.detachedActivityIds ?? []).includes(999999));

  // ---- the server stops re-offering it -------------------------------------------
  section("the sync refuses a detached activity");
  const s = fakeStore({ plan: undone });
  const before = s.calls.writes;
  const res = await applyActivityToUser(s.store, "u1", TEMPOISH);
  ok("THE BUG: the sync no longer re-completes it", s.plan().workouts.r1.status === "planned");
  ok("it says why", res.detached === true && res.matched === false);
  ok("and writes nothing at all", s.calls.writes === before);

  // The nastier half: with the actuals gone, the carrier check can't claim it, so
  // without the detach guard the activity would come back as a BONUS session —
  // strictly worse than the original bug.
  ok("no bonus session is invented for it", Object.keys(s.plan().workouts).length === 1);

  // A different activity on the same day is unaffected — this is a targeted refusal.
  const other = await applyActivityToUser(s.store, "u1", { ...TEMPOISH, id: 777, name: "A different run" });
  ok("an undetached activity still completes the session", s.plan().workouts.r1.status === "done");
  ok("and it is the one that did it", other.matched && s.plan().workouts.r1.actuals?.activityId === 777);

  // ---- the client merges instead of replacing -------------------------------------
  section("merge, don't replace");
  // Exactly Ryan's race: local undid it, the server hasn't heard yet.
  const local = setStatus(planOf({ r1: completed("r1", "2026-07-21", "run", 19740268683) }), "r1", "planned");
  const server = planOf({ r1: completed("r1", "2026-07-21", "run", 19740268683) });
  const merged = mergeCompletions(local, server)!;
  ok("THE BUG: the server cannot resurrect the undo", merged.workouts.r1.status === "planned");
  ok("nothing changed, so the same object comes back", merged === local);

  // …but a genuine completion the device hasn't seen is still adopted.
  const fresh = mergeCompletions(planOf({ r1: w("r1", "2026-07-21", "run", 1200) }), server)!;
  ok("a real new completion IS adopted", fresh.workouts.r1.status === "done");
  ok("with its actuals", fresh.workouts.r1.actuals?.activityId === 19740268683);

  // Local edits must survive a sync — the wholesale overwrite is what destroyed them.
  const edited = planOf({ r1: { ...w("r1", "2026-07-21", "run", 1200), estDurationSec: 3600, note: "made it longer" } });
  const keptEdit = mergeCompletions(edited, server)!;
  ok("a local edit survives the sync", keptEdit.workouts.r1.estDurationSec === 3600);
  ok("…and its note", keptEdit.workouts.r1.note === "made it longer");
  ok("while still taking the completion", keptEdit.workouts.r1.status === "done");

  // A session this device deleted must not be re-added by the next sync.
  const deleted = planOf({ other: w("other", "2026-07-21", "bike", 1200) });
  const notBack = mergeCompletions(deleted, server)!;
  ok("a deleted planned session is not resurrected", notBack.workouts.r1 === undefined);

  // ---- bonus sessions the sync created --------------------------------------------
  section("bonus sessions still arrive");
  const withBonus = planOf({
    r1: w("r1", "2026-07-21", "run", 1200),
    "synced-2026-07-21-bike": completed("synced-2026-07-21-bike", "2026-07-21", "bike", 555, "Z1 recovery"),
  });
  const gained = mergeCompletions(planOf({ r1: w("r1", "2026-07-21", "run", 1200) }), withBonus)!;
  ok("an unplanned Strava session is adopted", !!gained.workouts["synced-2026-07-21-bike"]);
  ok("and its week lists it, so the Plan tab renders it",
    gained.weeks.some((wk) => wk.workoutIds.includes("synced-2026-07-21-bike")));

  // …unless the athlete detached that activity.
  const refused = mergeCompletions({ ...planOf({ r1: w("r1", "2026-07-21", "run", 1200) }), detachedActivityIds: [555] } as Plan, withBonus)!;
  ok("a detached bonus is not adopted", refused.workouts["synced-2026-07-21-bike"] === undefined);

  // ---- the stale-title bug ----------------------------------------------------------
  section("renaming on Strava");
  // Ryan had two rides both still reading "MyWhoosh - Hudayriyat Outer Loop" long
  // after renaming them, because the update path refreshed actuals and not the title.
  const stale = fakeStore({
    plan: planOf({
      "synced-2026-07-21-bike": {
        ...completed("synced-2026-07-21-bike", "2026-07-21", "bike", 888, "MyWhoosh - Hudayriyat Outer Loop"),
        title: "MyWhoosh - Hudayriyat Outer Loop",
      },
    }),
  });
  await applyActivityToUser(stale.store, "u1", { id: 888, type: "Ride", name: "Z1 recovery", start_date_local: "2026-07-21T12:00:00Z", moving_time: 1587 });
  ok("a renamed activity renames its synced session", stale.plan().workouts["synced-2026-07-21-bike"].title === "Z1 recovery");

  // But a PLANNED session keeps its prescription as its title.
  const planned = fakeStore({
    plan: planOf({ r1: { ...completed("r1", "2026-07-21", "run", 999), title: "Easy Aerobic Run" } }),
  });
  await applyActivityToUser(planned.store, "u1", { id: 999, type: "Run", name: "Tempoish Run", start_date_local: "2026-07-21T10:00:00Z", moving_time: 1472 });
  ok("a planned session keeps its prescribed title", planned.plan().workouts.r1.title === "Easy Aerobic Run");


  // ---- the Plan tab renders a session on the day it is DATED ------------------------
  section("a session shows on its own day");
  // Ryan's screenshot: a run he finished on Friday, sitting under SATURDAY, marked
  // completed — "its saying I completed a run in the future". The heading came from
  // `week.startDate + day`; the sessions came from `w.dayIndex`. Two answers to one
  // question, and when they drifted the card moved and said nothing.
  const wkPlan = planOf({
    fri: { ...completed("fri", "2026-07-24", "run", 4242), dayIndex: 5 }, // dayIndex LIES: 24 Jul is a Friday (4)
    sat: w("sat", "2026-07-25", "bike", 3600),
  });
  wkPlan.weeks = [{ index: 0, startDate: "2026-07-20", workoutIds: ["fri", "sat"] }] as Plan["weeks"];
  const friday = weekSessionsOn(wkPlan, wkPlan.weeks[0], "2026-07-24").map((x) => x.id);
  const saturday = weekSessionsOn(wkPlan, wkPlan.weeks[0], "2026-07-25").map((x) => x.id);
  ok("THE BUG: a drifted dayIndex cannot move a session off its date", friday.join() === "fri");
  ok("and it does not appear on the next day", !saturday.includes("fri"));
  ok("the session actually dated there still shows", saturday.join() === "sat");
  ok("a day with nothing on it stays empty", weekSessionsOn(wkPlan, wkPlan.weeks[0], "2026-07-26").length === 0);

  console.log(`\n✅ sync/undo: ${pass} assertions passed\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
