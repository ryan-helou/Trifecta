// ---------------------------------------------------------------------------
// Mechanical load (lib/mechanical.ts) — the axis the metabolic ledger can't see.
//
// The defect this exists to close is reachable in one tap: swapDiscipline used
// to rebuild the session at the SAME duration, so swapping a 90-minute ride onto
// a run handed the athlete a 90-minute run. sRPE doesn't move — the two sessions
// cost the same metabolically — so the load model stayed flat while weekly run
// volume spiked (doc 02 §4 #13).
//
// The asymmetry is the point and is tested from both sides: swapping INTO a
// higher-impact sport is fitted to the week's headroom; swapping OUT of one
// sheds impact and is never constrained (doc 03 §4 C, protect fast and add slow).
//
// And the swap is never REFUSED. Everything stays switchable; only the duration
// is fitted. A guard that says "no" would fail the thing it's guarding.
//
// Pure, no clock, no I/O. Run: npx tsx test/mechanical.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { swapDiscipline } from "../lib/adapt";
import {
  IMPACT_FLOOR_MIN,
  IMPACT_PER_MIN,
  IMPACT_RAMP_MAX,
  impactBaseline,
  impactHeadroomMinutes,
  sessionImpactMinutes,
  swapAllowance,
  weekImpactMinutes,
} from "../lib/mechanical";
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

const ANCHOR = "2026-08-03";
function weeksFrom(w: number): string {
  const d = new Date(ANCHOR + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + w * 7);
  return d.toISOString().slice(0, 10);
}
function profile(over: Partial<Profile> = {}): Profile {
  return {
    username: "test", raceType: "olympic", raceDateISO: weeksFrom(16),
    level: "intermediate", workoutsPerWeek: 6, createdAtISO: ANCHOR, ...over,
  } as Profile;
}
const clone = (p: Plan): Plan => JSON.parse(JSON.stringify(p));

// --- 1. the ordering the weights encode -------------------------------------
section("impact weights rank the sports the way tissue does");
{
  ok(IMPACT_PER_MIN.run === 1, "running is the reference");
  ok(IMPACT_PER_MIN.run > IMPACT_PER_MIN.brick, "run > brick per minute");
  ok(IMPACT_PER_MIN.brick > IMPACT_PER_MIN.strength, "brick > strength");
  ok(IMPACT_PER_MIN.strength > IMPACT_PER_MIN.bike, "strength > bike");
  ok(IMPACT_PER_MIN.bike > IMPACT_PER_MIN.swim, "bike > swim");
  ok(IMPACT_PER_MIN.swim === 0 && IMPACT_PER_MIN.rest === 0, "swimming and rest cost the tissue nothing");
}
{
  // a skipped session costs nothing; a logged longer one costs what was logged
  const base = { id: "x", weekIndex: 0, discipline: "run", estDurationSec: 3600, status: "planned" } as Workout;
  ok(sessionImpactMinutes(base) === 60, "a planned 60-min run is 60 impact-minutes");
  ok(sessionImpactMinutes({ ...base, status: "skipped" }) === 0, "a skipped session costs nothing");
  ok(sessionImpactMinutes({ ...base, actualDurationSec: 5400 }) === 90, "a logged 90 minutes counts as 90, not the planned 60");
  ok(sessionImpactMinutes({ ...base, discipline: "swim" }) === 0, "an hour of swimming is zero impact");
}

// --- 2. THE DEFECT: a same-duration swap used to spike run volume ------------
section("swapping a long ride onto a run no longer hands over the full duration");
{
  const plan = generatePlan(profile(), ANCHOR);
  // the longest bike in a mid-plan week — the worst case for this defect
  const bike = Object.values(plan.workouts)
    .filter((w) => w.discipline === "bike" && w.weekIndex >= 3 && w.status === "planned")
    .sort((a, b) => b.estDurationSec - a.estDurationSec)[0];
  ok(!!bike, "found a long ride to swap");

  if (bike) {
    const week = plan.weeks.find((w) => w.index === bike.weekIndex)!;
    const before = weekImpactMinutes(plan, week);
    const after = swapDiscipline(plan, bike.id, "run");
    const swapped = after.workouts[bike.id];

    ok(swapped.discipline === "run", "the swap still happens — nothing is refused");
    ok(swapped.estDurationSec > 0, "and it produces a real session");

    const afterWeek = after.weeks.find((w) => w.index === bike.weekIndex)!;
    const impactAfter = weekImpactMinutes(after, afterWeek);
    const ceiling = impactBaseline(plan, bike.weekIndex) * IMPACT_RAMP_MAX;

    ok(
      impactAfter <= Math.max(ceiling, before) + 25,
      `the week's impact ${impactAfter.toFixed(0)} stays near its ceiling ${ceiling.toFixed(0)} (was ${before.toFixed(0)})`,
    );
    ok(
      swapped.estDurationSec <= bike.estDurationSec,
      `the run (${Math.round(swapped.estDurationSec / 60)}min) is not longer than the ride it replaced (${Math.round(bike.estDurationSec / 60)}min)`,
    );
  }
}

// --- 3. the asymmetry --------------------------------------------------------
section("shedding impact is never constrained");
{
  const plan = generatePlan(profile(), ANCHOR);
  const run = Object.values(plan.workouts).find((w) => w.discipline === "run" && w.status === "planned" && w.weekIndex >= 3)!;
  ok(!!run, "found a run to swap away");
  if (run) {
    for (const to of ["bike", "swim"] as const) {
      const a = swapAllowance(plan, run, to, run.estDurationSec);
      ok(!a.capped, `run → ${to} is never capped`);
      ok(a.maxSec === run.estDurationSec, `run → ${to} keeps the full duration`);
      ok(a.reason === null, `run → ${to} has nothing to explain`);
    }
    // and swapping a swim onto a bike is a rise, but a trivial one
    const swim = Object.values(plan.workouts).find((w) => w.discipline === "swim" && w.status === "planned" && w.weekIndex >= 3);
    if (swim) {
      const a = swapAllowance(plan, swim, "bike", swim.estDurationSec);
      ok(!a.capped, "swim → bike is a rise in impact but nowhere near a spike, so it passes");
    }
  }
}

// --- 4. the beginner is not locked out --------------------------------------
section("an athlete with no impact history can still swap onto a run");
{
  const plan = generatePlan(profile(), ANCHOR);
  const bare = clone(plan);
  // strip every scrap of impact history: an all-swim athlete
  for (const w of Object.values(bare.workouts)) if (w.discipline !== "rest") w.discipline = "swim";
  const target = Object.values(bare.workouts).find((w) => w.status === "planned" && w.weekIndex >= 3)!;
  ok(impactBaseline(bare, target.weekIndex) === IMPACT_FLOOR_MIN, "a zero-impact history floors at IMPACT_FLOOR_MIN, not zero");
  const a = swapAllowance(bare, target, "run", 3600);
  ok(a.maxSec > 0, `a beginner still gets a real run (${Math.round(a.maxSec / 60)} min), not a refusal`);
  const after = swapDiscipline(bare, target.id, "run");
  ok(after.workouts[target.id].discipline === "run", "and the swap goes through");
  ok(after.workouts[target.id].estDurationSec >= 20 * 60, "never shorter than a genuine session");
}

// --- 5. headroom behaves --------------------------------------------------
section("headroom is bounded and never negative");
{
  const plan = generatePlan(profile(), ANCHOR);
  for (const w of plan.weeks) {
    const h = impactHeadroomMinutes(plan, w.index);
    ok(h >= 0, `week ${w.index + 1} headroom is never negative (${h.toFixed(1)})`);
  }
  ok(impactHeadroomMinutes(plan, 9999) === 0, "an unknown week has no headroom");

  // a week already stuffed with running has no room for more
  const stuffed = clone(plan);
  const wk = stuffed.weeks.find((w) => w.index >= 3)!;
  for (const id of wk.workoutIds) {
    const w = stuffed.workouts[id];
    if (w && w.discipline !== "rest") { w.discipline = "run"; w.estDurationSec = 7200; }
  }
  ok(impactHeadroomMinutes(stuffed, wk.index) === 0, "a week already over its ceiling has zero headroom");
  const someWorkout = stuffed.workouts[wk.workoutIds.find((id) => stuffed.workouts[id]?.discipline === "run")!];
  const a = swapAllowance(stuffed, { ...someWorkout, discipline: "bike" }, "run", 3600);
  ok(a.capped, "and a further swap onto a run is capped");
  ok(!!a.reason, "with a sentence explaining it");
}

// --- 6. the capped swap explains itself -------------------------------------
section("a capped swap records why");
{
  const plan = generatePlan(profile(), ANCHOR);
  const stuffed = clone(plan);
  const wk = stuffed.weeks.find((w) => w.index >= 3)!;
  const ids = wk.workoutIds.filter((id) => stuffed.workouts[id]?.discipline !== "rest");
  for (const id of ids.slice(1)) {
    const w = stuffed.workouts[id];
    if (w) { w.discipline = "run"; w.estDurationSec = 5400; }
  }
  const victim = stuffed.workouts[ids[0]];
  if (victim) {
    victim.discipline = "bike";
    victim.estDurationSec = 7200;
    const after = swapDiscipline(stuffed, victim.id, "run");
    const sw = after.workouts[victim.id];
    ok(!!sw.impactCapped, "the capped swap carries its explanation on the session");
    ok((sw.note ?? "").includes("kept short"), "and the note says it was kept short");
    ok(sw.estDurationSec < 7200, "and it really is shorter than requested");
  }
}

// --- 7. degenerate ----------------------------------------------------------
section("never throws on degenerate input");
{
  const plan = generatePlan(profile(), ANCHOR);
  const empty = clone(plan);
  empty.weeks = [];
  let threw = false;
  try {
    impactBaseline(empty, 0);
    impactHeadroomMinutes(empty, 0);
    ok(weekImpactMinutes(plan, { ...plan.weeks[0], workoutIds: [] }) === 0, "a week with no sessions is zero impact");
  } catch {
    threw = true;
  }
  ok(!threw, "an empty plan never throws");
  ok(swapDiscipline(plan, "does-not-exist", "run") !== null, "swapping a missing id is a no-op, not a crash");
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} mechanical-load invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all mechanical-load invariants passed");
