// ---------------------------------------------------------------------------
// The safety rails (lib/rails.ts) — doc 04 §4.1 #10 (bounded ramp) and #12
// (intensity distribution), which the doc itself records as unenforced.
//
// Two jobs here, and the second is the one that matters:
//   1. today's engine stays inside the rails (a regression net)
//   2. the rails actually BITE — each one is proven to fire on a plan that
//      breaks it, so "all green" can't mean "the check does nothing"
//
// A rail that has never been seen to fail is not a rail. Every threshold below
// is exercised from both sides.
//
// Pure, no clock, no I/O. Run: npx tsx test/rails.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import {
  BLOCK_HARD_MAX,
  RAMP_MAX,
  WEEK_HARD_MAX,
  blockHardShare,
  checkRails,
  increasesAnyWeek,
  loadWeekRamps,
  railsRegressed,
  weekHardShare,
  weekHours,
} from "../lib/rails";
import type { Plan, Profile, Zone } from "../lib/types";

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

const ANCHOR = "2026-08-03"; // a Monday
function weeksFrom(w: number): string {
  const d = new Date(ANCHOR + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + w * 7);
  return d.toISOString().slice(0, 10);
}
function profile(over: Partial<Profile> = {}): Profile {
  return {
    username: "test",
    raceType: "olympic",
    raceDateISO: weeksFrom(16),
    level: "intermediate",
    workoutsPerWeek: 6,
    createdAtISO: ANCHOR,
    ...over,
  } as Profile;
}

const CASES: { name: string; p: Profile }[] = [
  // short runway + low frequency: the shape where quality is most concentrated,
  // because base weeks carry none of it and there are few sessions to spread it over
  { name: "olympic/beginner/4 @10wk", p: profile({ level: "beginner", workoutsPerWeek: 4, raceDateISO: weeksFrom(10) }) },
  { name: "olympic/beginner/5", p: profile({ raceType: "olympic", level: "beginner", workoutsPerWeek: 5, raceDateISO: weeksFrom(14) }) },
  { name: "olympic/intermediate/6", p: profile() },
  { name: "half/intermediate/6", p: profile({ raceType: "half", raceDateISO: weeksFrom(20) }) },
  { name: "full/advanced/10", p: profile({ raceType: "full", level: "advanced", workoutsPerWeek: 10, raceDateISO: weeksFrom(24) }) },
  { name: "fitness/intermediate/6", p: profile({ raceType: "fitness", raceDateISO: "" }) },
];

const clone = (p: Plan): Plan => JSON.parse(JSON.stringify(p));

// --- 1. today's engine is inside every rail ---------------------------------
section("every archetype the engine builds sits inside the rails");
for (const c of CASES) {
  const plan = generatePlan(c.p, ANCHOR);
  const report = checkRails(plan);
  ok(report.ok, `${c.name}: ${report.violations.map((v) => v.detail).join("; ") || "clean"}`);
}

// --- 2. the block-level claim is the polarization claim ----------------------
section("the block is polarized, and that is measured at block level");
for (const c of CASES) {
  const plan = generatePlan(c.p, ANCHOR);
  const share = blockHardShare(plan);
  ok(share != null, `${c.name}: block share is computable`);
  if (share != null) ok(share <= BLOCK_HARD_MAX, `${c.name}: block Z4+ ${(share * 100).toFixed(1)}% ≤ ${BLOCK_HARD_MAX * 100}%`);
}
{
  // Base weeks sit FAR below a per-week 15–25% rail (as doc 04 §4.1 #12 words
  // it), so that rail would fail them. Prove the shape is real, so the reason the
  // rail is block-level is recorded rather than asserted.
  //
  // This used to assert base was 0% Z4+ everywhere. That stopped being true with
  // #195 — base now carries one sweet-spot ride a week for non-beginners, which
  // is zoned Z4. The POINT of the assertion is unchanged and is what's tested
  // now: base is nowhere near a 15% per-week floor, so applying one would break
  // correct plans.
  const plan = generatePlan(profile(), ANCHOR);
  const base = plan.weeks.filter((w) => w.phase === "base" && !w.isRecovery);
  const shares = base.map((w) => (weekHardShare(plan, w) ?? 0) * 100);
  ok(base.length > 0, "there are base weeks to measure");
  // The claim that justifies a BLOCK-level rail is that base weeks vary hugely
  // and several carry NO Z4+ at all — a per-week 15–25% floor would fail those
  // outright. That is still true with #195's quality: some base weeks are 0%,
  // others carry a sweet-spot ride.
  const zero = shares.filter((pct) => pct === 0).length;
  ok(zero > 0, `some base weeks carry no Z4+ at all (${zero}/${base.length}) — a per-week floor would fail them`);
  ok(
    Math.max(...shares) - Math.min(...shares) > 5,
    `base weeks vary widely (${Math.min(...shares).toFixed(1)}%–${Math.max(...shares).toFixed(1)}%), which is why the rail is block-level`,
  );
  // Deliberately NO ceiling assertion here. rails.ts already documents that doc
  // 04's per-week number is wrong against the real engine, so inventing one in a
  // test would re-import the mistake the rail exists to avoid. BLOCK_HARD_MAX is
  // the guard, and it is asserted above for every archetype.
}
{
  // The taper is intensity-dense ON PURPOSE (doc 01 §4 #6: hold intensity, cut
  // volume), so it must be exempt from the per-week ceiling or correct plans fail.
  const plan = generatePlan(profile({ raceType: "half", raceDateISO: weeksFrom(20) }), ANCHOR);
  const taper = plan.weeks.filter((w) => w.phase === "taper" && !w.isRaceWeek);
  const dense = taper.some((w) => (weekHardShare(plan, w) ?? 0) > WEEK_HARD_MAX);
  ok(taper.length > 0, "the half plan has a taper week to check");
  ok(dense, "a taper week does exceed the per-week ceiling — which is why the taper is exempt");
  ok(checkRails(plan).ok, "and the plan is still clean, because the exemption holds");
}

// --- 3. the ramp rail --------------------------------------------------------
section("ramp is bounded between consecutive load weeks");
for (const c of CASES) {
  const plan = generatePlan(c.p, ANCHOR);
  const worst = loadWeekRamps(plan).reduce((m, r) => Math.max(m, r.ratio), 1);
  ok(worst <= RAMP_MAX, `${c.name}: worst load-week jump ${((worst - 1) * 100).toFixed(1)}% ≤ ${((RAMP_MAX - 1) * 100).toFixed(0)}%`);
}
{
  // Deload bounces must NOT be read as spikes — coming out of a recovery week is
  // supposed to jump. If recovery weeks were included this would fire constantly.
  const plan = generatePlan(profile(), ANCHOR);
  const recovery = plan.weeks.filter((w) => w.isRecovery);
  ok(recovery.length > 0, "the plan has recovery weeks");
  const touchesRecovery = loadWeekRamps(plan).some(
    (r) => recovery.some((w) => w.index === r.fromIndex || w.index === r.toIndex),
  );
  ok(!touchesRecovery, "no ramp is measured against a recovery week");
}

// --- 4. the rails BITE ------------------------------------------------------
// Each rail is shown failing on a deliberately broken plan. Without this, all
// green would be indistinguishable from a check that does nothing.
section("each rail fires on a plan that breaks it");
{
  // ramp: inflate one load week's sessions well past the bound
  const plan = generatePlan(profile(), ANCHOR);
  const broken = clone(plan);
  const target = broken.weeks.find((w) => !w.isRecovery && !w.isRaceWeek && w.index > 2);
  ok(!!target, "found a load week to inflate");
  if (target) {
    for (const id of target.workoutIds) {
      const w = broken.workouts[id];
      if (w && w.discipline !== "rest") w.estDurationSec = Math.round((w.estDurationSec ?? 0) * 2);
    }
    const rep = checkRails(broken);
    ok(rep.violations.some((v) => v.kind === "ramp"), `doubling week ${target.index + 1} trips the ramp rail`);
  }
}
{
  // week intensity: make one non-taper week all-Z5
  const plan = generatePlan(profile(), ANCHOR);
  const broken = clone(plan);
  const target = broken.weeks.find((w) => w.phase !== "taper" && !w.isRaceWeek && (weekHardShare(broken, w) ?? 0) < WEEK_HARD_MAX);
  ok(!!target, "found a week that is currently within the intensity ceiling");
  if (target) {
    for (const id of target.workoutIds) {
      const w = broken.workouts[id];
      if (w && w.discipline !== "rest" && w.discipline !== "strength") w.primaryZone = 5 as Zone;
    }
    const rep = checkRails(broken);
    ok(rep.violations.some((v) => v.kind === "week-intensity" && v.weekIndex === target.index), `an all-Z5 week ${target.index + 1} trips the intensity ceiling`);
  }
}
{
  // block intensity: turn every endurance session in the block hard
  const plan = generatePlan(profile(), ANCHOR);
  const broken = clone(plan);
  for (const w of Object.values(broken.workouts)) {
    if (w.discipline !== "rest" && w.discipline !== "strength") w.primaryZone = 4 as Zone;
  }
  const rep = checkRails(broken);
  ok(rep.violations.some((v) => v.kind === "block-intensity"), "an all-hard block trips the block rail");
  ok((blockHardShare(broken) ?? 0) > BLOCK_HARD_MAX, "and the measured block share really is over the limit");
}

// --- 5. railsRegressed: the gate adaptation will actually use ----------------
section("railsRegressed blocks new harm, not pre-existing harm");
{
  const plan = generatePlan(profile(), ANCHOR);
  ok(railsRegressed(plan, clone(plan)).length === 0, "an identical plan regresses nothing");

  // easing a week (less volume, less intensity) must never be blocked
  const eased = clone(plan);
  const wk = eased.weeks.find((w) => !w.isRecovery && !w.isRaceWeek && w.index > 2)!;
  for (const id of wk.workoutIds) {
    const w = eased.workouts[id];
    if (w && w.discipline !== "rest") {
      w.estDurationSec = Math.round((w.estDurationSec ?? 0) * 0.7);
      if (w.primaryZone >= 4) w.primaryZone = 2 as Zone;
    }
  }
  ok(railsRegressed(plan, eased).length === 0, "softening a week is never blocked");

  // a plan already out of band is not frozen: an unrelated ease still passes
  const sick = clone(plan);
  for (const w of Object.values(sick.workouts)) {
    if (w.discipline !== "rest" && w.discipline !== "strength") w.primaryZone = 4 as Zone;
  }
  ok(!checkRails(sick).ok, "the already-broken plan is genuinely in violation");
  const sickEased = clone(sick);
  const wk2 = sickEased.weeks.find((w) => !w.isRecovery && !w.isRaceWeek && w.index > 2)!;
  for (const id of wk2.workoutIds) {
    const w = sickEased.workouts[id];
    if (w && w.discipline !== "rest") w.estDurationSec = Math.round((w.estDurationSec ?? 0) * 0.8);
  }
  ok(railsRegressed(sick, sickEased).length === 0, "an athlete whose plan is already out of band is not frozen out of easing it");

  // but making it worse IS caught
  const worse = clone(plan);
  const wk3 = worse.weeks.find((w) => !w.isRecovery && !w.isRaceWeek && w.index > 2)!;
  for (const id of wk3.workoutIds) {
    const w = worse.workouts[id];
    if (w && w.discipline !== "rest") w.estDurationSec = Math.round((w.estDurationSec ?? 0) * 3);
  }
  ok(railsRegressed(plan, worse).length > 0, "tripling a week's volume is caught as a regression");

  // The strictly-reducing shortcut must not become a loophole: a change that
  // eases one week while loading another is NOT a reduction, and still gates.
  const mixed = clone(plan);
  const loadWeeks = mixed.weeks.filter((w) => !w.isRecovery && !w.isRaceWeek && w.index > 2);
  for (const id of loadWeeks[0].workoutIds) {
    const w = mixed.workouts[id];
    if (w && w.discipline !== "rest") w.estDurationSec = Math.round((w.estDurationSec ?? 0) * 0.5);
  }
  for (const id of loadWeeks[1].workoutIds) {
    const w = mixed.workouts[id];
    if (w && w.discipline !== "rest") w.estDurationSec = Math.round((w.estDurationSec ?? 0) * 3);
  }
  ok(increasesAnyWeek(plan, mixed), "a mixed ease-here/load-there change is not a reduction");
  ok(railsRegressed(plan, mixed).length > 0, "and it is still gated");

  // Trading volume for intensity is an increase in hard minutes, not a reduction.
  const spicier = clone(plan);
  const wk4 = spicier.weeks.find((w) => !w.isRecovery && !w.isRaceWeek && w.index > 2)!;
  for (const id of wk4.workoutIds) {
    const w = spicier.workouts[id];
    if (w && w.discipline !== "rest" && w.discipline !== "strength") {
      w.estDurationSec = Math.round((w.estDurationSec ?? 0) * 0.9);
      w.primaryZone = 5 as Zone;
    }
  }
  ok(increasesAnyWeek(plan, spicier), "shortening sessions while making them all Z5 still counts as an increase");
}

// --- 6. degenerate input never throws ---------------------------------------
section("the rails never throw on a degenerate plan");
{
  const plan = generatePlan(profile(), ANCHOR);
  const empty = clone(plan);
  empty.weeks = [];
  empty.workouts = {};
  let threw = false;
  try {
    const r = checkRails(empty);
    ok(r.ok && r.blockHardShare === null, "an empty plan is vacuously clean");
    ok(loadWeekRamps(empty).length === 0, "an empty plan has no ramps");
  } catch {
    threw = true;
  }
  ok(!threw, "an empty plan never throws");

  const restOnly = clone(plan);
  for (const w of Object.values(restOnly.workouts)) w.discipline = "rest";
  let threw2 = false;
  try {
    checkRails(restOnly);
    ok(weekHours(restOnly, restOnly.weeks[0]) === 0, "an all-rest week is zero hours");
    ok(weekHardShare(restOnly, restOnly.weeks[0]) === null, "an all-rest week has no intensity share");
  } catch {
    threw2 = true;
  }
  ok(!threw2, "an all-rest plan never throws");
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} rail invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all rail invariants passed");
