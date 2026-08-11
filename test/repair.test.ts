// ---------------------------------------------------------------------------
// Repairing plans already damaged by the swap-baseline bug (#201), and the swim
// resize that was refused outright (#203).
//
// Ryan: "modify all the plans that were subject to the bug where if u have a
// 35 mins bike 15k then u turn it into a run the distances dont change."
//
// The danger in a repair pass is not that it fails to fix — it's that it
// REWRITES SOMETHING HEALTHY. An athlete who deliberately set an odd distance
// must not have it silently "corrected". So the properties are symmetric:
//   - the reported case is caught and rebuilt to a plausible session
//   - no healthy session, in any archetype, is ever touched
//   - a healthy plan comes back as the SAME OBJECT (no needless re-render/save)
//   - the repair is idempotent
//
// Pure, no clock, no I/O. Run: npx tsx test/repair.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { impliedKmh, isImpossible, repairSwappedDistances } from "../lib/repair";
import { adjustChoices, adjustSession, metrePace, structuralSeconds } from "../lib/prescribe";
import type { Plan, Profile, Workout } from "../lib/types";

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

const prof = (over: Partial<Profile> = {}): Profile =>
  ({ username: "t", raceType: "olympic", raceDateISO: "2027-04-01", level: "intermediate", workoutsPerWeek: 8, ...over }) as unknown as Profile;
const basePlan = generatePlan(prof(), "2026-08-10");

// ---- 1. the reported case ---------------------------------------------------

section("The reported case: a 35 min run carrying a bike's 15 km");
{
  const run = Object.values(basePlan.workouts).find((w) => w.discipline === "run" && w.estDistanceM)!;
  const damaged: Workout = {
    ...run,
    estDurationSec: 35 * 60,
    estDistanceM: 15000,
    swappedFrom: { discipline: "bike" } as Workout["swappedFrom"],
    prescribed: { estDurationSec: 80 * 60, estDistanceM: 39400, segments: run.segments },
  };
  const broken: Plan = { ...basePlan, workouts: { ...basePlan.workouts, [run.id]: damaged } };

  ok(isImpossible(damaged), `15 km in 35 min (${impliedKmh(damaged)!.toFixed(1)} km/h) is flagged as impossible`);

  const res = repairSwappedDistances(broken);
  const fixed = res.plan.workouts[run.id];
  ok(res.repaired === 1, `exactly one session repaired (got ${res.repaired})`);
  ok(!isImpossible(fixed), `the repaired run is possible (${impliedKmh(fixed)!.toFixed(1)} km/h)`);
  ok(fixed.estDurationSec === 35 * 60, "duration is left alone — the athlete's 35 minutes is real");
  ok((fixed.estDistanceM ?? 0) < 15000, `distance came down from 15 km (to ${((fixed.estDistanceM ?? 0) / 1000).toFixed(1)} km)`);
  ok(fixed.prescribed === undefined, "and the stale baseline that caused it is gone, so an ease can't resurrect it");

  // Idempotent — running it again changes nothing further.
  const again = repairSwappedDistances(res.plan);
  ok(again.repaired === 0 && again.baselinesCleared === 0, "repair is idempotent");
  ok(again.plan === res.plan, "...and returns the same object when there's nothing to do");
}

// ---- 2. thresholds must be anchored, not guessed ---------------------------

section("The impossible-speed thresholds are anchored to real records");
{
  const at = (discipline: Workout["discipline"], km: number, min: number): Workout =>
    ({ discipline, estDistanceM: km * 1000, estDurationSec: min * 60 }) as Workout;

  // The first draft of this used a 26 km/h ceiling for running, which let the
  // ACTUAL reported case through: 15 km in 35 min is 25.7 km/h.
  ok(isImpossible(at("run", 15, 35)), "15 km in 35 min is impossible (25.7 km/h — beats the 5000 m record)");
  ok(isImpossible(at("run", 12, 30)), "12 km in 30 min is impossible (24 km/h)");
  ok(!isImpossible(at("run", 10, 40)), "10 km in 40 min is a fast but real athlete (15 km/h)");
  ok(!isImpossible(at("run", 21.1, 70)), "a 70-minute half marathon is elite but real");
  ok(!isImpossible(at("bike", 40, 60)), "40 km in an hour is a strong but real ride");
  ok(isImpossible(at("bike", 80, 60)), "80 km in an hour is corrupt");
  ok(!isImpossible(at("swim", 2, 40)), "2 km in 40 min is a real swim");
  ok(isImpossible(at("swim", 5, 30)), "5 km in 30 min is corrupt");
  ok(!isImpossible({ discipline: "strength" } as Workout), "a session with no distance is never flagged");
}

// ---- 3. it must not touch anything healthy ---------------------------------

section("No healthy session is ever rewritten");
{
  let flagged = 0;
  let total = 0;
  for (const raceType of ["sprint", "olympic", "half", "full"]) {
    for (const level of ["beginner", "intermediate", "advanced", "elite"]) {
      const p = generatePlan(prof({ raceType, level } as Partial<Profile>), "2026-08-10");
      for (const w of Object.values(p.workouts)) {
        if (!w.estDistanceM) continue;
        total++;
        if (isImpossible(w)) {
          flagged++;
          if (flagged <= 3) console.error(`      ${raceType}/${level} ${w.title} ${(w.estDistanceM / 1000).toFixed(1)}km/${Math.round(w.estDurationSec / 60)}min`);
        }
      }
      const res = repairSwappedDistances(p);
      ok(res.plan === p, `${raceType}/${level}: a healthy plan comes back untouched, same object`);
    }
  }
  ok(flagged === 0, `no false positives across every archetype (${flagged}/${total} flagged)`);
}

// ---- 4. #203 — swims can be resized ----------------------------------------

section("Swim sessions can be resized, like every other sport");
{
  for (const d of ["swim", "bike", "run"] as const) {
    const w = Object.values(basePlan.workouts).find((x) => x.discipline === d && x.status === "planned")!;
    const choices = adjustChoices(w);
    ok(choices.length > 0, `${d}: the sheet offers resize choices`);
    // Every offered choice must DO something, except the one that equals the
    // current length. Five dead buttons on a swim is what #203 was.
    const dead = choices.filter((sec) => {
      if (Math.abs(sec - w.estDurationSec) < 60) return false; // "same as now" is legitimately a no-op
      return adjustSession(basePlan, w.id, sec) == null;
    });
    ok(dead.length === 0, `${d}: no offered length is a dead button (${dead.length}/${choices.length} dead)`);
  }

  // And the resize must stay honest: a shortened swim is shorter, and still swims
  // at a possible speed.
  const swim = Object.values(basePlan.workouts).find((x) => x.discipline === "swim" && x.status === "planned")!;
  const shorter = adjustSession(basePlan, swim.id, Math.round(swim.estDurationSec * 0.6));
  ok(shorter != null, "a swim can be shortened at all");
  const got = shorter!.plan.workouts[swim.id];
  ok(got.estDurationSec < swim.estDurationSec, `the shortened swim is actually shorter (${Math.round(swim.estDurationSec / 60)} → ${Math.round(got.estDurationSec / 60)} min)`);
  ok(!isImpossible(got), "and it still implies a possible swim speed");
}

// ---- 5. the measurement primitive ------------------------------------------

section("Distance-based structures are priced against their own header");
{
  const swim = Object.values(basePlan.workouts).find((x) => x.discipline === "swim")!;
  const rate = metrePace(swim.segments, swim.estDurationSec);
  ok(rate > 0, `a swim has a positive seconds-per-metre rate (${rate.toFixed(3)})`);
  const total = structuralSeconds(swim.segments, rate);
  ok(
    Math.abs(total - swim.estDurationSec) < 60,
    `pricing the structure reproduces the header (${Math.round(total / 60)} vs ${Math.round(swim.estDurationSec / 60)} min)`,
  );

  const run = Object.values(basePlan.workouts).find((x) => x.discipline === "run" && x.segments.length > 1)!;
  ok(metrePace(run.segments, run.estDurationSec) >= 0, "a duration-based session yields a non-negative rate");
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} repair invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all repair invariants passed");
