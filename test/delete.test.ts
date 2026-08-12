// ---------------------------------------------------------------------------
// A session the athlete logged themselves can be removed — and removing it gives
// back whatever logging it took (lib/adapt.ts `deleteLoggedWorkout`).
//
// Why this is more than a delete key. Logging an unplanned ride ABSORBS or
// SHORTENS a matching session later in the week (#215, lib/absorb.ts). So a ride
// logged by mistake — wrong sport, wrong day, or the same one entered twice —
// has already deleted or trimmed real training. Before this existed there was no
// way back: the log sat in the plan inflating fitness, and the week stayed
// permanently lighter for a session that never happened. That is #215 with the
// sign flipped, and invariants 4–6 below are the ones that stop it.
//
// Pure, no clock, no I/O. Run: npx tsx test/delete.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { deleteLoggedWorkout, isAthleteLogged, logWorkout } from "../lib/adapt";
import { respondTo } from "../lib/respond";
import type { Discipline, Plan, Profile, Workout } from "../lib/types";

let checks = 0;
let failures = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}
function section(name: string) {
  console.log(`\n• ${name}`);
}

const ANCHOR = "2026-08-03";
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function profile(over: Partial<Profile> = {}): Profile {
  return {
    username: "test", raceType: "olympic", raceDateISO: addDays(ANCHOR, 16 * 7),
    level: "intermediate", workoutsPerWeek: 6, createdAtISO: ANCHOR, ...over,
  } as Profile;
}

/** A mid-block week, and a day inside it with nothing planned and a ride still to come.
 *  Same fixture as absorb.test.ts, deliberately — these two files test the two
 *  directions of one mechanism and must be looking at the same week. */
function bed(): { plan: Plan; today: string; weekIndex: number } {
  const plan = generatePlan(profile(), ANCHOR);
  const week = plan.weeks[2];
  const busy = new Set(
    week.workoutIds.map((id) => plan.workouts[id]!).filter((w) => w.discipline !== "rest").map((w) => w.date),
  );
  const today = Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i)).find(
    (d) =>
      !busy.has(d) &&
      week.workoutIds.some((id) => {
        const w = plan.workouts[id]!;
        return w.discipline === "bike" && w.status === "planned" && w.date > d;
      }),
  )!;
  return { plan, today, weekIndex: week.index };
}

/** Log an unplanned session and let the plan answer, exactly as the app does. */
function didUnplanned(plan: Plan, today: string, discipline: Discipline, minutes: number, rpe: number) {
  const res = logWorkout(plan, { dateISO: today, discipline, durationSec: minutes * 60, rpe });
  const bonusId = Object.keys(res.plan.workouts).find((id) => !plan.workouts[id])!;
  const answer = respondTo(res.plan, today, { kind: "logged-other", workoutId: bonusId });
  return { plan: answer?.plan ?? res.plan, bonusId };
}

const inWeek = (p: Plan, i: number): Workout[] =>
  p.weeks.find((w) => w.index === i)!.workoutIds.map((id) => p.workouts[id]!).filter(Boolean);

/** The plan as it comes back from storage. Every field the restore reads has to
 *  survive this — JSON drops undefined keys, which is how a snapshot restore
 *  quietly stops clearing the "Covered by…" note. */
const persisted = (p: Plan): Plan => JSON.parse(JSON.stringify(p));

// --- 1. whose session is it? -----------------------------------------------
section("only work the athlete put there themselves can be deleted");
{
  const { plan, today, weekIndex } = bed();
  const { plan: after, bonusId } = didUnplanned(plan, today, "bike", 45, 3);
  const prescribed = inWeek(plan, weekIndex).find((w) => w.discipline !== "rest")!;

  ok(isAthleteLogged(after.workouts[bonusId]), "a hand-logged session is the athlete's");
  ok(!isAthleteLogged(prescribed), `an engine-designed session (${prescribed.title}) is not`);
  ok(deleteLoggedWorkout(after, prescribed.id) === null, "so deleting a prescribed session refuses");
  ok(deleteLoggedWorkout(after, "nope-does-not-exist") === null, "and an unknown id refuses rather than throwing");

  // A device session would be re-imported by the very next sync, so a delete
  // would undo itself. Refusing is the honest answer until an ignore-list exists.
  const synced: Workout = { ...after.workouts[bonusId], id: "synced-2026-08-19-bike" };
  const withSynced: Plan = { ...after, workouts: { ...after.workouts, [synced.id]: synced } };
  ok(!isAthleteLogged(synced), "a device-synced session is not the athlete's to delete");
  ok(deleteLoggedWorkout(withSynced, synced.id) === null, "so that refuses too");
}

// --- 2. the session actually leaves the plan --------------------------------
section("deleting removes it from the plan and from its week");
{
  const { plan, today } = bed();
  const { plan: after, bonusId } = didUnplanned(plan, today, "bike", 45, 3);
  const res = deleteLoggedWorkout(after, bonusId)!;

  ok(!!res, "a logged session deletes");
  ok(!res.plan.workouts[bonusId], "it is gone from the workout map");
  ok(
    res.plan.weeks.every((w) => !w.workoutIds.includes(bonusId)),
    "and out of its week's membership — a dangling id would crash every list that maps over it",
  );
  ok(res.removed.discipline === "bike", "the caller is told what was removed, so it can name it");
  ok(after.workouts[bonusId] !== undefined, "and the input plan is untouched (pure)");
}

// --- 3. an athlete-ADDED session is theirs too (#209) ------------------------
section("a session the athlete asked the plan to add can also be removed");
{
  const { plan, today } = bed();
  const { plan: after, bonusId } = didUnplanned(plan, today, "bike", 45, 3);
  const added: Workout = { ...after.workouts[bonusId], id: "w-2-3-run-x", addedByAthlete: true, absorbedBy: undefined };
  const withAdded: Plan = { ...after, workouts: { ...after.workouts, [added.id]: added } };

  ok(isAthleteLogged(added), "an addedByAthlete session is the athlete's");
  ok(!!deleteLoggedWorkout(withAdded, added.id), "and it deletes");
  // Skipping it instead would count as a MISS in assessAdaptation — changing your
  // mind about a bonus session must never read as falling behind.
  ok(
    deleteLoggedWorkout(withAdded, added.id)!.plan.workouts[added.id] === undefined,
    "leaving nothing behind to be counted as missed",
  );
}

// --- 4. an ABSORBED session comes back --------------------------------------
section("a session the log took off the week is put back");
{
  const { plan, today, weekIndex } = bed();
  const longRide = inWeek(plan, weekIndex).find((w) => w.discipline === "bike" && w.primaryZone <= 2)!;
  const mins = Math.round((longRide.estDurationSec / 60) * 0.95); // adequate equivalent
  const { plan: after, bonusId } = didUnplanned(plan, today, "bike", mins, 3);

  ok(after.workouts[longRide.id].status === "skipped", `${longRide.title} was absorbed by the log`);

  const res = deleteLoggedWorkout(persisted(after), bonusId)!;
  const back = res.plan.workouts[longRide.id];

  ok(back.status === "planned", "deleting the log puts it back on the week");
  ok(!back.absorbedBy, "with nothing still claiming to cover it");
  ok(
    !back.note,
    `and without the "Covered by…" note left over (was "${back.note ?? ""}") — the JSON round-trip is the trap here`,
  );
  ok(res.restored.some((w) => w.id === longRide.id), "the caller is told what came back, so it can say so");
  ok(/back on your week/.test(res.headline), `and the change explains itself: "${res.headline}"`);
}

// --- 5. a SHORTENED session gets its length back ----------------------------
section("a session the log trimmed is restored to the length it had");
{
  const { plan, today, weekIndex } = bed();
  const longRide = inWeek(plan, weekIndex).find((w) => w.discipline === "bike" && w.primaryZone <= 2)!;
  const mins = Math.round((longRide.estDurationSec / 60) * 0.4); // partial cover → trim
  const { plan: after, bonusId } = didUnplanned(plan, today, "bike", mins, 3);
  const trimmed = after.workouts[longRide.id];

  ok(trimmed.status === "planned" && trimmed.estDurationSec < longRide.estDurationSec, "the log shortened it");

  const res = deleteLoggedWorkout(persisted(after), bonusId)!;
  const back = res.plan.workouts[longRide.id];

  ok(
    back.estDurationSec === longRide.estDurationSec,
    `it goes back to what it was (${Math.round(longRide.estDurationSec / 60)} min), not to some new number ` +
      `(got ${Math.round(back.estDurationSec / 60)})`,
  );
  ok(back.segments.length === longRide.segments.length, "with the structure it had, not a rescaled version of it");
  ok(back.estDistanceM === longRide.estDistanceM, "and the distance that went with it");
  ok(!back.absorbedBy && !back.absorbedFrom, "and no absorption bookkeeping left behind");
}

// --- 6. it only gives back what THIS log took -------------------------------
section("another log's absorption is left alone");
{
  const { plan, today, weekIndex } = bed();
  const rides = inWeek(plan, weekIndex).filter((w) => w.discipline === "bike" && w.status === "planned" && w.date > today);
  const swims = inWeek(plan, weekIndex).filter((w) => w.discipline === "swim" && w.status === "planned" && w.date > today);
  if (rides.length && swims.length) {
    const first = didUnplanned(plan, today, "bike", Math.round((rides[0].estDurationSec / 60) * 0.95), 3);
    const second = didUnplanned(first.plan, today, "swim", Math.round((swims[0].estDurationSec / 60) * 0.95), 3);
    const takenByRide = Object.values(second.plan.workouts).filter((w) => w.absorbedBy === first.bonusId).map((w) => w.id);
    const takenBySwim = Object.values(second.plan.workouts).filter((w) => w.absorbedBy === second.bonusId).map((w) => w.id);
    ok(takenByRide.length > 0 && takenBySwim.length > 0, "the fixture has two logs that each took something");

    const res = deleteLoggedWorkout(second.plan, first.bonusId)!;
    ok(
      takenByRide.every((id) => !res.plan.workouts[id].absorbedBy),
      "deleting the ride gives back what the ride took",
    );
    ok(
      takenBySwim.every((id) => res.plan.workouts[id].absorbedBy === second.bonusId),
      "and leaves what the swim took exactly where it is",
    );
  } else {
    ok(true, "fixture week has no ride+swim pair to cross-check — skipped");
  }
}

// --- 7. the round trip is a fixed point -------------------------------------
section("log then delete returns the week to where it started");
{
  const { plan, today, weekIndex } = bed();
  const longRide = inWeek(plan, weekIndex).find((w) => w.discipline === "bike" && w.primaryZone <= 2)!;
  const { plan: after, bonusId } = didUnplanned(plan, today, "bike", Math.round((longRide.estDurationSec / 60) * 0.95), 3);
  const res = deleteLoggedWorkout(persisted(after), bonusId)!;

  const shape = (p: Plan) =>
    inWeek(p, weekIndex)
      .map((w) => `${w.id}:${w.status}:${w.estDurationSec}`)
      .sort()
      .join("|");

  ok(
    shape(res.plan) === shape(plan),
    "every session in the week is back to its original status and length — a mistaken log leaves no trace",
  );
}

console.log(`\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
