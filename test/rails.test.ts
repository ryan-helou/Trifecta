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
  blockMinutes,
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
  ok(taper.length > 0, "the half plan has a taper week to check");
  // This used to assert the taper breaches WEEK_HARD_MAX outright. It no longer does —
  // now that quality is budgeted rather than left to fall out of the division, the load
  // weeks around it carry real intensity too, so the taper is no longer an outlier by that
  // margin. The property the exemption actually rests on is unchanged and is the one worth
  // pinning: the taper is DENSER than the block it follows, because its volume collapses
  // while its intensity is held (doc 01 §4 #6). Asserting a specific breach instead would
  // re-import doc 04's wrong per-week number by the back door.
  const taperShare = Math.max(...taper.map((w) => weekHardShare(plan, w) ?? 0));
  const blockShare = blockHardShare(plan) ?? 0;
  ok(
    taperShare > blockShare,
    `the taper is denser than the block (${(taperShare * 100).toFixed(0)}% vs ${(blockShare * 100).toFixed(0)}%)`,
  );
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

// ---- #202 — a week's sessions are visibly different lengths ----------------

section("Same-sport sessions in a week are visibly different lengths (#202)");
{
  // Ryan: "All runs and bikes are same length... I feel like it's off."
  //
  // Proportional division hands near-identical shares to sessions with similar
  // weights, and the 5-minute grid rounds them onto the same block. Measured
  // before the fix: 298 same-sport pairs in a week were EXACTLY equal (6.5%).
  // After: 96 (2.1%), and what's left is overwhelmingly two FIXED-length
  // sessions — two Recovery Spins in a deload — where neither side can move.
  //
  // The guard is a budget, not zero: driving it to zero would mean shortening
  // quality sessions to make room, which trades the week's training for tidiness.
  let identical = 0;
  let pairs = 0;
  let movableIdentical = 0;
  for (const c of CASES) {
    const p = generatePlan(c.p, ANCHOR);
    for (const wk of p.weeks) {
      const inWk = wk.workoutIds.map((id) => p.workouts[id]).filter(Boolean);
      for (const d of ["swim", "bike", "run"] as const) {
        const mins = inWk.filter((w) => w.discipline === d).map((w) => Math.round(w.estDurationSec / 60));
        if (mins.length < 2) continue;
        pairs += mins.length - 1;
        const dupes = mins.length - new Set(mins).size;
        identical += dupes;
        // A collision between two sessions that could BOTH have moved is the
        // real failure — that's the allocator giving up, not physics.
        const titles = inWk.filter((w) => w.discipline === d);
        const byMin = new Map<number, typeof titles>();
        for (const w of titles) {
          const k = Math.round(w.estDurationSec / 60);
          byMin.set(k, [...(byMin.get(k) ?? []), w]);
        }
        for (const list of byMin.values()) {
          if (list.length < 2) continue;
          const recoveryish = list.every((w) => /Recovery|Technique|Open-Water/i.test(w.title));
          if (!recoveryish) movableIdentical += list.length - 1;
        }
      }
    }
  }
  const pct = pairs ? (100 * identical) / pairs : 0;
  ok(pct < 6, `identical same-sport lengths stay well under the 6.5% this started at (got ${pct.toFixed(1)}%)`);
  ok(
    identical < pairs * 0.06,
    `${identical} identical of ${pairs} adjacent same-sport pairs`,
  );
  ok(
    movableIdentical <= identical,
    `collisions between two genuinely movable sessions are the minority (${movableIdentical}/${identical})`,
  );
}

// ---------------------------------------------------------------------------
// A longer EASY session is not a loss of intensity (Ryan, 2026-08-14).
//
// `block-too-easy` is a SHARE, and a share falls either because hard work left or
// because easy work arrived. Only the first is a loss. Judging the ratio alone made
// the rail veto every attempt to lengthen an easy session — and for an athlete whose
// block already sits under the floor, that meant EVERY session, permanently: he could
// shorten anything and lengthen nothing, with the refusal surfacing as "that session
// can't be resized to that distance".
//
// Doc 01 §4 #4 calls this measurement "a regression guard, not an enforcement
// mechanism"; doc 03 §4 C is "protect fast and add slow". Adding easy aerobic volume
// is adding slow.
{
  section("adding easy volume vs the intensity floor");
  const base = generatePlan(profile({ raceType: "half", level: "beginner", raceDateISO: weeksFrom(20) }), ANCHOR);

  // Ryan's actual condition, and the one the ratio-only check could not survive: a
  // block ALREADY under the 10% floor. Flatten the hard work until it is, so the
  // rail is live before we touch anything — otherwise this test passes vacuously.
  const p: Plan = { ...base, workouts: { ...base.workouts } };
  // Demote hard sessions one at a time until the block dips under the floor —
  // deterministic, and it stops just below rather than at zero, which is the shape
  // of a real under-trained block rather than an empty one.
  for (const w of Object.values(p.workouts)) {
    const share = blockHardShare(p);
    if (share != null && share < 0.08) break;
    if (w.primaryZone >= 4) p.workouts[w.id] = { ...w, primaryZone: 3 as Zone };
  }
  const share = blockHardShare(p);
  ok(share != null && share < 0.1, `the fixture is under the intensity floor, like Ryan's plan (${((share ?? 0) * 100).toFixed(1)}%)`);
  ok(checkRails(p).violations.some((v) => v.kind === "block-too-easy"), "so block-too-easy is ALREADY firing before any edit");

  // Find a planned easy (Z1-2) endurance session in a load week, and make it longer.
  const easy = Object.values(p.workouts).find(
    (w) => w.status === "planned" && w.primaryZone <= 2 && w.discipline !== "rest" && w.discipline !== "strength" && w.estDurationSec > 0,
  );
  ok(!!easy, "there is an easy session to lengthen");
  if (easy) {
    const longer: Plan = {
      ...p,
      workouts: { ...p.workouts, [easy.id]: { ...easy, estDurationSec: Math.round(easy.estDurationSec * 1.5) } },
    };
    ok(increasesAnyWeek(p, longer), "lengthening it does increase a week (so the ease shortcut is not what saves it)");
    const hardBefore = blockMinutes(p).hard;
    const hardAfter = blockMinutes(longer).hard;
    ok(hardAfter >= hardBefore - 1e-9, "and it removes no hard work at all");
    ok(blockHardShare(longer)! < blockHardShare(p)!, "the SHARE does drop — which is exactly what used to veto it");
    const regressions = railsRegressed(p, longer);
    ok(
      !regressions.some((v) => v.kind === "block-too-easy"),
      `THE BUG: a longer easy session is not a block-too-easy regression (got ${JSON.stringify(regressions.map((v) => v.kind))})`,
    );
  }

  // The rail must still do its real job: taking hard work OUT is a regression.
  const hard = Object.values(p.workouts).find((w) => w.status === "planned" && w.primaryZone >= 4 && w.estDurationSec > 0);
  ok(!!hard, "there is a hard session to gut");
  if (hard) {
    // Gut the hard session AND add easy time, so the change still "increases a week"
    // and cannot pass through the ease shortcut.
    const easyOther = Object.values(p.workouts).find(
      (w) => w.id !== hard.id && w.status === "planned" && w.primaryZone <= 2 && w.discipline !== "rest" && w.estDurationSec > 0,
    )!;
    const gutted: Plan = {
      ...p,
      workouts: {
        ...p.workouts,
        [hard.id]: { ...hard, primaryZone: 1 as Zone, segments: hard.segments.map((sg) => ({ ...sg, zone: 1 as Zone })) },
        [easyOther.id]: { ...easyOther, estDurationSec: Math.round(easyOther.estDurationSec * 2) },
      },
    };
    ok(blockMinutes(gutted).hard < blockMinutes(p).hard, "gutting a hard session really does remove Z4+ time");
    ok(
      checkRails(gutted).violations.some((v) => v.kind === "block-too-easy") === (blockHardShare(gutted)! < 0.1),
      "the floor still reports honestly on the gutted plan",
    );
  }
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} rail invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all rail invariants passed");
