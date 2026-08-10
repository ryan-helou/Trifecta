// ---------------------------------------------------------------------------
// The gym log (lib/strength.ts + the check-in wiring) — ticket #199.
//
// The thing this file is really guarding is a decision that got made by
// MEASUREMENT and could easily be undone by good intentions: the log does NOT
// price its own effort. An inferred-RPE rung was built, measured, and deleted
// because it ranked a 5×5 at 100 kg BELOW a bodyweight circuit and below the
// plain zone fallback. So the first section here asserts the negative — logging
// what you lifted must never change the training load on its own — and the rest
// covers the arithmetic that IS honest: volume, history, and personal bests.
//
// Pure, no clock, no I/O. Run: npx tsx test/strength.test.ts
// ---------------------------------------------------------------------------

import { exerciseHistory, heaviestSet, newPersonalBests, setCount, summarise, volumeLoad } from "../lib/strength";
import { effectiveRpe, sessionLoad } from "../lib/load";
import { logCheckin, logWorkout } from "../lib/adapt";
import { fmtSets, fmtWeight } from "../lib/format";
import type { Plan, StrengthEntry, Workout } from "../lib/types";

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

// ---- fixtures --------------------------------------------------------------

const gym = (over: Partial<Workout> = {}): Workout =>
  ({
    id: "w1",
    date: "2026-08-10",
    weekIndex: 0,
    dayIndex: 0,
    discipline: "strength",
    type: "strength",
    title: "Full body",
    purpose: "",
    segments: [{ kind: "main", discipline: "strength", zone: 2, durationSec: 2100, description: "Gym" }],
    estDurationSec: 2100,
    primaryZone: 2,
    status: "done",
    ...over,
  }) as Workout;

const sets = (n: number, reps: number, kg?: number) =>
  Array.from({ length: n }, () => ({ reps, ...(kg != null ? { weightKg: kg } : {}) }));

/** A heavy day and a circuit — the exact pair that killed the inference. */
const HEAVY: StrengthEntry[] = [
  { name: "Back Squat", sets: sets(5, 5, 100) },
  { name: "Romanian Deadlift", sets: sets(3, 8, 80) },
];
const CIRCUIT: StrengthEntry[] = [
  { name: "Press-up", sets: sets(6, 15) },
  { name: "Air Squat", sets: sets(6, 20) },
  { name: "Burpee", sets: sets(6, 10) },
];

const planWith = (workouts: Workout[]): Plan =>
  ({
    startDateISO: "2026-08-03",
    weeks: [{ index: 0, startDate: "2026-08-03", phase: "base", targetHours: 6, workoutIds: workouts.map((w) => w.id) }],
    workouts: Object.fromEntries(workouts.map((w) => [w.id, w])),
    paces: {},
  }) as unknown as Plan;

// ---- 1. the log must not price itself --------------------------------------

section("Logging what you lifted does not change the load");
{
  const bare = gym();
  const heavy = gym({ strengthLog: HEAVY });
  const circuit = gym({ strengthLog: CIRCUIT });

  const lBare = sessionLoad(bare, null).load;
  const lHeavy = sessionLoad(heavy, null).load;
  const lCircuit = sessionLoad(circuit, null).load;

  ok(
    lBare === lHeavy && lBare === lCircuit,
    `load must be identical whether or not sets were logged (bare ${lBare}, heavy ${lHeavy}, circuit ${lCircuit})`,
  );
  // The specific inversion that got the inference deleted.
  ok(
    lHeavy >= lCircuit,
    `a heavy 5×5 must never be priced below a bodyweight circuit (heavy ${lHeavy} vs circuit ${lCircuit})`,
  );
  // `LoadSource` no longer even has a "lifted" member, so the compiler rejects
  // that comparison outright — a stronger guard than this assertion. What's left
  // to check at runtime is that a logged gym session still falls through to the
  // zone, exactly as an unlogged one does.
  ok(
    effectiveRpe(heavy, null).source === "zone",
    `a gym log must not become an intensity source — got "${effectiveRpe(heavy, null).source}"`,
  );

  // ...but the athlete's own RPE still rules, on a gym session like any other.
  const told = gym({ strengthLog: HEAVY, rpe: 9 });
  ok(effectiveRpe(told, null).source === "rpe" && effectiveRpe(told, null).rpe === 9, "a stated RPE still wins on a logged gym session");
  ok(sessionLoad(told, null).load > lHeavy, "and it is what makes a hard gym session score hard");
}

// ---- 2. volume arithmetic --------------------------------------------------

section("Volume, sets and reps");
{
  // 5×5×100 = 2,500; 3×8×80 = 1,920 → 4,420
  ok(volumeLoad(HEAVY) === 4420, `tonnage sums reps × weight (got ${volumeLoad(HEAVY)})`);
  ok(volumeLoad(CIRCUIT) === 0, `bodyweight work contributes no tonnage (got ${volumeLoad(CIRCUIT)})`);

  const h = setCount(HEAVY);
  ok(h.sets === 8 && h.reps === 49, `heavy day is 8 sets / 49 reps (got ${h.sets}/${h.reps})`);
  const c = setCount(CIRCUIT);
  ok(c.sets === 18 && c.reps === 270, `circuit is 18 sets / 270 reps (got ${c.sets}/${c.reps})`);

  // The summary must fall back to reps when there is no tonnage to show, or a
  // bodyweight session reads "18 sets · 0 kg", which looks like a bug.
  ok(summarise(HEAVY) === "8 sets · 4,420 kg", `heavy summary (got "${summarise(HEAVY)}")`);
  ok(summarise(CIRCUIT) === "18 sets · 270 reps", `bodyweight summary shows reps (got "${summarise(CIRCUIT)}")`);
  ok(summarise([{ name: "Squat", sets: sets(1, 5, 60) }]) === "1 set · 300 kg", "singular 'set' for one set");

  ok(heaviestSet(HEAVY, "back squat")?.weightKg === 100, "heaviest set is found case-insensitively");
  ok(heaviestSet(HEAVY, "Bench Press") === null, "an exercise that wasn't done has no heaviest set");
}

// ---- 3. history ------------------------------------------------------------

section("What did I lift last time");
{
  const older = gym({ id: "a", date: "2026-08-01", strengthLog: [{ name: "Back Squat", sets: sets(5, 5, 90) }] });
  const newer = gym({ id: "b", date: "2026-08-08", strengthLog: [{ name: "Back Squat", sets: sets(5, 5, 100) }] });
  const planned = gym({ id: "c", date: "2026-08-15", status: "planned", strengthLog: [{ name: "Back Squat", sets: sets(5, 5, 200) }] });

  const hist = exerciseHistory([older, newer, planned]);
  ok(hist.length === 1, `one exercise across sessions (got ${hist.length})`);
  ok(hist[0].lastDoneISO === "2026-08-08", `last done is the most recent DONE session (got ${hist[0].lastDoneISO})`);
  ok(hist[0].bestWeightKg === 100, `a session you haven't done yet can't set your best (got ${hist[0].bestWeightKg})`);
  ok(hist[0].lastSets.length === 5, "last time's sets come back for prefill");

  // Order matters: the prefill offers the most recent session, not the heaviest.
  const deload = gym({ id: "d", date: "2026-08-09", strengthLog: [{ name: "Back Squat", sets: sets(3, 5, 70) }] });
  const h2 = exerciseHistory([older, newer, deload]);
  ok(h2[0].lastSets.length === 3 && h2[0].bestWeightKg === 100, "a deload becomes 'last time' without erasing the best");
}

// ---- 4. personal bests -----------------------------------------------------

section("Personal bests");
{
  const first = gym({ id: "a", date: "2026-08-01", strengthLog: [{ name: "Back Squat", sets: sets(5, 5, 90) }] });
  const beats = gym({ id: "b", date: "2026-08-08", strengthLog: [{ name: "Back Squat", sets: sets(5, 5, 100) }] });
  const under = gym({ id: "c", date: "2026-08-09", strengthLog: [{ name: "Back Squat", sets: sets(5, 5, 95) }] });

  // The bug this guards: comparing a session against a history that INCLUDES it
  // means every session ties its own best and nothing is ever a PB.
  ok(newPersonalBests(first, [first]).length === 1, "the first time you log a lift, it is a record");
  ok(newPersonalBests(first, [first])[0].previousKg === null, "...with no previous weight to beat");

  const pb = newPersonalBests(beats, [first, beats]);
  ok(pb.length === 1 && pb[0].weightKg === 100 && pb[0].previousKg === 90, "beating 90 with 100 is a PB that knows what it beat");
  ok(newPersonalBests(under, [first, beats, under]).length === 0, "95 after 100 is not a personal best");

  // Bodyweight work has no weight, so it can't claim a weight PB.
  ok(newPersonalBests(gym({ strengthLog: CIRCUIT }), []).length === 0, "bodyweight sets never claim a weight PB");
}

// ---- 5. saving through the check-in ----------------------------------------

section("Saving a log through the check-in");
{
  const p = planWith([gym({ id: "w1", status: "planned" })]);

  const saved = logCheckin(p, "w1", { rpe: 7, strengthLog: HEAVY });
  ok(saved.workouts.w1.strengthLog?.length === 2, "the log is stored on the session");
  ok(saved.workouts.w1.status === "done", "and saving a check-in completes it");

  // An absent key must leave an existing log alone — otherwise editing the RPE
  // on a session you already logged would silently wipe the sets.
  const rpeOnly = logCheckin(saved, "w1", { rpe: 5 });
  ok(rpeOnly.workouts.w1.strengthLog?.length === 2, "editing the check-in doesn't wipe a log it wasn't asked about");
  ok(rpeOnly.workouts.w1.rpe === 5, "...while still applying the edit");

  // An emptied log clears the field rather than storing [], so "did they log
  // anything" stays one truthiness check everywhere downstream.
  const cleared = logCheckin(saved, "w1", { strengthLog: [] });
  ok(cleared.workouts.w1.strengthLog === undefined, "clearing the log removes the field rather than storing []");
}

section("Saving a log for an unplanned gym session");
{
  // Nothing planned that day → a bonus session, which must still keep the sets.
  const empty = planWith([]);
  const bonus = logWorkout(empty, { dateISO: "2026-08-10", discipline: "strength", durationSec: 2100, strengthLog: HEAVY });
  ok(bonus.outcome === "bonus", `an unplanned gym session is a bonus (got ${bonus.outcome})`);
  const created = Object.values(bonus.plan.workouts)[0];
  ok(created?.strengthLog?.length === 2, "the bonus session carries the log it was created with");

  // Planned that day → matched, and the log lands on the matched session.
  const p = planWith([gym({ id: "w1", status: "planned" })]);
  const matched = logWorkout(p, { dateISO: "2026-08-10", discipline: "strength", durationSec: 2100, strengthLog: HEAVY });
  ok(matched.matchedId === "w1", `it matches the planned gym session (got ${matched.matchedId})`);
  ok(matched.plan.workouts.w1.strengthLog?.length === 2, "and the log lands on it");
}

// ---- 6. how it reads back --------------------------------------------------

section("Reading it back");
{
  ok(fmtWeight(100) === "100 kg", `whole kg has no decimal (got "${fmtWeight(100)}")`);
  ok(fmtWeight(62.5) === "62.5 kg", `a half-plate survives (got "${fmtWeight(62.5)}")`);
  ok(fmtWeight(100, "imperial") === "220.5 lb", `kg converts to lb (got "${fmtWeight(100, "imperial")}")`);

  // Sets are spoken the way a lifter says them, and a change of load must start
  // a new group or a top set disappears into the sets below it.
  ok(fmtSets(sets(5, 5, 100)) === "5×5 @ 100 kg", `identical sets group (got "${fmtSets(sets(5, 5, 100))}")`);
  const ramp = [...sets(3, 8, 60), ...sets(1, 6, 70)];
  ok(fmtSets(ramp) === "3×8 @ 60 kg, 1×6 @ 70 kg", `a top set stays visible (got "${fmtSets(ramp)}")`);
  ok(fmtSets(sets(3, 15)) === "3×15", `bodyweight sets show no load (got "${fmtSets(sets(3, 15))}")`);
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} gym-log invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all gym-log invariants passed");
