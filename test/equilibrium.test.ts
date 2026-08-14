// ---------------------------------------------------------------------------
// Unplanned work is settled against the week it lands in (lib/equilibrium.ts).
//
// The property under test is the one Ryan asked for in the ticket: a session the
// plan never asked for must come OFF the session it stands in for — outright when
// it's an adequate equivalent, partially when it isn't — and it must never buy the
// athlete out of work they haven't actually done.
//
// The regression that motivated most of this file is the sign, not the feature. An
// unplanned 60-minute ride used to make the app announce the week was "60 min
// LIGHTER than planned", because `weekDrift` recovered a week's design from the
// sessions in it and an unplanned session reported itself as its own design. Extra
// work measured as a deficit. Invariant 1 below is that number.
//
// Pure, no clock, no I/O. Run: npx tsx test/equilibrium.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { assessAdaptation, logCheckin, logWorkout } from "../lib/adapt";
import { settleUnplanned, FULL_COVER, isUnplanned, deliveredCredit, prescribedCredit } from "../lib/equilibrium";
import { weekDrift } from "../lib/replan";
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

/** A mid-block week, and a day inside it with nothing planned and a ride still to come. */
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

/** Log an unplanned session and let the plan answer, the way the app does. */
function didUnplanned(
  plan: Plan,
  today: string,
  discipline: Discipline,
  minutes: number,
  rpe: number,
): { plan: Plan; bonusId: string; headline: string | null; before: Plan } {
  const res = logWorkout(plan, { dateISO: today, discipline, durationSec: minutes * 60, rpe });
  const bonusId = Object.keys(res.plan.workouts).find((id) => !plan.workouts[id])!;
  const answer = respondTo(res.plan, today, { kind: "logged-other", workoutId: bonusId });
  return { plan: answer?.plan ?? res.plan, bonusId, headline: answer?.headline ?? null, before: res.plan };
}

const inWeek = (p: Plan, i: number): Workout[] =>
  p.weeks.find((w) => w.index === i)!.workoutIds.map((id) => p.workouts[id]!).filter(Boolean);

// --- 1. the sign. Extra work is never a deficit ----------------------------
section("extra work does not read as a deficit (the #215 regression)");
{
  const { plan, today, weekIndex } = bed();
  const before = weekDrift(plan, plan.weeks[weekIndex]);
  const res = logWorkout(plan, { dateISO: today, discipline: "bike", durationSec: 60 * 60, rpe: 3 });
  const bonusId = Object.keys(res.plan.workouts).find((id) => !plan.workouts[id])!;
  const after = weekDrift(res.plan, res.plan.weeks[weekIndex]);

  ok(isUnplanned(res.plan.workouts[bonusId]), "a logged session with nothing planned is recognised as unplanned");
  ok(
    after.volPct >= before.volPct,
    `an unplanned hour must not make the week measure LIGHTER (was ${before.volPct.toFixed(1)}%, now ${after.volPct.toFixed(1)}%)`,
  );
  ok(
    Math.abs(after.volPct) < 0.001,
    `an unplanned session is outside the design, so drift stays 0 (got ${after.volPct.toFixed(2)}%)`,
  );
  ok(
    after.designedSec === before.designedSec,
    "and it is never counted as something the engine designed",
  );
}

// --- 2. adequate equivalent → the session comes off the week ----------------
section("an adequate equivalent takes the session off the week");
{
  const { plan, today, weekIndex } = bed();
  const longRide = inWeek(plan, weekIndex).find((w) => w.discipline === "bike" && w.primaryZone <= 2)!;
  const mins = Math.round((longRide.estDurationSec / 60) * 0.95);
  const { plan: after, headline } = didUnplanned(plan, today, "bike", mins, 3);
  const now = after.workouts[longRide.id];

  ok(!!now.absorbedBy, `${longRide.title} records what covered it`);
  ok(now.status === "skipped", "and it leaves the week rather than sitting there asking to be done twice");
  ok(!!headline && /covers/.test(headline), `the change explains itself: "${headline}"`);
  // The bar is a CREDIT ratio, not a duration ratio — duration × intensity — so
  // this asserts the number the code actually consults rather than a proxy for it.
  ok(
    FULL_COVER <= deliveredCredit(after.workouts[Object.keys(after.workouts).find((id) => isUnplanned(after.workouts[id]))!]) / prescribedCredit(longRide),
    "the full-cover bar is what let it through, not a coincidence of rounding",
  );
}

// --- 3. partial cover → the session is shortened, not removed ---------------
section("a partial cover shortens the session instead");
{
  const { plan, today, weekIndex } = bed();
  const longRide = inWeek(plan, weekIndex).find((w) => w.discipline === "bike" && w.primaryZone <= 2)!;
  const mins = Math.round((longRide.estDurationSec / 60) * 0.4); // well under ADEQUATE
  const { plan: after, headline } = didUnplanned(plan, today, "bike", mins, 3);
  const now = after.workouts[longRide.id];

  ok(now.status === "planned", `${longRide.title} is still on the week`);
  ok(
    now.estDurationSec < longRide.estDurationSec,
    `but shorter (${Math.round(longRide.estDurationSec / 60)} → ${Math.round(now.estDurationSec / 60)} min)`,
  );
  ok(!!now.absorbedBy, "and it records why it shrank");
  ok(!!headline && /already done part of it/.test(headline), `explained: "${headline}"`);
}

// --- 4. easy work never buys out quality -----------------------------------
section("easy work never buys out quality");
{
  const { plan, today, weekIndex } = bed();
  const quality = inWeek(plan, weekIndex).find((w) => w.discipline === "bike" && w.primaryZone >= 4);
  ok(!!quality, "the fixture week has a hard ride to protect");
  if (quality) {
    // an easy hour, long enough to clear the adequacy bar against the quality session
    const mins = Math.round((quality.estDurationSec / 60) * 1.2);
    const { plan: after } = didUnplanned(plan, today, "bike", mins, 3);
    const now = after.workouts[quality.id];
    ok(
      now.status === "planned" && !now.absorbedBy,
      `an easy ${mins}min ride must not absorb ${quality.title} (z${quality.primaryZone})`,
    );
    ok(
      now.primaryZone === quality.primaryZone,
      "and the week keeps the intensity it was built with",
    );
  }
}

// --- 5. quality CAN be covered by quality ----------------------------------
section("quality for quality is allowed");
{
  const { plan, today, weekIndex } = bed();
  const quality = inWeek(plan, weekIndex).find((w) => w.discipline === "bike" && w.primaryZone >= 4)!;
  const mins = Math.round(quality.estDurationSec / 60);
  const { plan: after } = didUnplanned(plan, today, "bike", mins, 9); // rpe 9 → hard
  ok(
    !!after.workouts[quality.id].absorbedBy,
    `a hard unplanned ride of the same length does cover ${quality.title}`,
  );
}

// --- 6. it stays in its own sport ------------------------------------------
section("absorption stays in the sport that was actually done");
{
  const { plan, today, weekIndex } = bed();
  const { plan: after } = didUnplanned(plan, today, "swim", 35, 3);
  const touched = inWeek(after, weekIndex).filter((w) => w.absorbedBy);
  ok(touched.length <= 1, "at most one session gives way to a single unplanned one");
  for (const w of touched) {
    ok(w.discipline === "swim", `an unplanned swim only ever touches a swim (touched ${w.discipline})`);
  }
}

// --- 7. race week is never rebalanced --------------------------------------
section("race week is left alone");
{
  const plan = generatePlan(profile(), ANCHOR);
  const race = plan.weeks.find((w) => w.isRaceWeek)!;
  const day = race.startDate;
  const res = logWorkout(plan, { dateISO: day, discipline: "bike", durationSec: 90 * 60, rpe: 3 });
  const bonusId = Object.keys(res.plan.workouts).find((id) => !plan.workouts[id]);
  if (bonusId) {
    const out = settleUnplanned(res.plan, day, bonusId);
    ok(out === null, "nothing in race week is absorbed — the taper is the point");
  } else {
    ok(true, "nothing was planned to absorb in race week (vacuously safe)");
  }
}

// --- 8. absorbed is NOT missed (the ease trigger) ---------------------------
section("absorbing must never read as falling behind");
{
  // Two weeks of an athlete who trains a lot, off-plan. Five sessions absorbed is
  // past the 40% miss rate that triggers an ease — so if absorption counted as
  // missing, training MORE would soften the block. That is the whole point of
  // `absorbedBy` being a field rather than a comment.
  const plan = generatePlan(profile(), ANCHOR);
  const today = addDays(plan.weeks[2].startDate, 3);
  const window = Object.values(plan.workouts).filter(
    (w) => w.discipline !== "rest" && w.date >= addDays(today, -14) && w.date < today,
  );
  ok(window.length >= 8, `the fixture window holds enough sessions to be meaningful (${window.length})`);

  const mark = (absorbed: boolean): Plan => {
    let p: Plan = { ...plan, workouts: { ...plan.workouts } };
    window.forEach((w, i) => {
      p.workouts[w.id] =
        i < 5
          ? { ...w, status: "skipped", ...(absorbed ? { absorbedBy: "logged-x" } : {}) }
          : { ...w, status: "done", rpe: 5, feel: "ok" };
    });
    return p;
  };

  const naive = assessAdaptation(mark(false), today);
  const guarded = assessAdaptation(mark(true), today);
  ok(
    !!naive && naive.cause === "missed",
    "five plainly-skipped sessions DO trigger an ease (so the fixture is exercising the trigger)",
  );
  ok(
    !guarded || guarded.cause !== "missed",
    "but five ABSORBED sessions do not — the athlete did that work, they didn't miss it",
  );
}

// --- 9. it never invents load, and never touches the past -------------------
section("absorption only ever removes work");
{
  const { plan, today, weekIndex } = bed();
  for (const [mins, rpe] of [[30, 3], [60, 3], [100, 3], [60, 9]] as const) {
    const { plan: after, before } = didUnplanned(plan, today, "bike", mins, rpe);
    for (const w of inWeek(after, weekIndex)) {
      const was = before.workouts[w.id];
      if (!was || isUnplanned(w)) continue;
      ok(
        w.estDurationSec <= was.estDurationSec,
        `${mins}min/rpe${rpe}: ${w.title} is never lengthened by absorption`,
      );
      ok(
        w.primaryZone <= was.primaryZone,
        `${mins}min/rpe${rpe}: ${w.title} is never made harder by absorption`,
      );
      if (was.date < today) {
        ok(w.status === was.status, `${mins}min/rpe${rpe}: the past is never rewritten (${w.title})`);
      }
    }
  }
}

// --- 10. idempotent — running it again changes nothing more -----------------
section("running it twice does not compound");
{
  const { plan, today, weekIndex } = bed();
  const { plan: once, bonusId } = didUnplanned(plan, today, "bike", 60, 3);
  const twice = settleUnplanned(once, today, bonusId);
  if (twice) {
    // A second pass may only ever find a DIFFERENT session; it must not shave the
    // same one again, which is how repeated syncs would ratchet a week to nothing.
    const target = Object.values(once.workouts).find((w) => w.absorbedBy === bonusId)!;
    ok(
      twice.id !== target.id,
      `a second pass never trims ${target.title} again (that is the ratchet this guards)`,
    );
  } else {
    ok(true, "a second pass finds nothing more to do");
  }
}

// ---------------------------------------------------------------------------
// THE WIRING, not just the function.
//
// Ryan: "if i do a bike and a run today, and i only had a run, will it affect the
// plan". Measured: it did NOT — and the absorption logic was innocent. `logWorkout`
// called `applyPlan` directly instead of routing through `respondTo`, and the
// absorption lives inside the responder. So the whole feature was correct and
// unreachable from the one button most likely to reach it: "Log a workout".
//
// This asserts the PATH, which is the part that broke. A unit test of
// `absorbUnplanned` passed the entire time the feature did nothing.
// ---------------------------------------------------------------------------
{
  section("logging an unplanned session reaches the absorber");

  // Ryan's exact case: a session IS planned today (not a bike), and a ride is
  // still standing later in the week. `bed()` deliberately picks an empty day, so
  // this needs its own.
  const plan = generatePlan(profile(), ANCHOR);
  const week = plan.weeks[2];
  const inThisWeek = week.workoutIds.map((id) => plan.workouts[id]!).filter((w) => w.discipline !== "rest");
  const planned = inThisWeek.find(
    (w) =>
      w.discipline !== "bike" &&
      inThisWeek.some((x) => x.discipline === "bike" && x.status === "planned" && x.date > w.date),
  );
  ok(!!planned, `a non-bike session with a ride still to come (${planned?.discipline} on ${planned?.date})`);
  const today = planned!.date;
  const ticked = logCheckin(plan, planned!.id, { rpe: 5, feel: "ok", actualDurationSec: planned!.estDurationSec });

  const res = logWorkout(ticked, { dateISO: today, discipline: "bike", durationSec: 3600, rpe: 5, feel: "ok" });
  ok(res.outcome === "bonus", `a sport with nothing planned logs as a bonus (${res.outcome})`);
  ok(!!res.loggedId, "and reports the id it created — without this the responder has nothing to absorb");
  ok(res.plan.workouts[res.loggedId!] !== undefined, "which resolves to a real session");
  ok(isUnplanned(res.plan.workouts[res.loggedId!]), "…and that session reads as unplanned");

  // The composed path, exactly as AppShell runs it.
  const responded = respondTo(res.plan, today, { kind: "logged", workoutId: res.loggedId! });
  const after = responded?.plan ?? res.plan;

  const ridesBefore = Object.values(res.plan.workouts).filter(
    (w) => w.discipline === "bike" && w.weekIndex === planned!.weekIndex && w.status === "planned",
  );
  const ridesAfter = Object.values(after.workouts).filter(
    (w) => w.discipline === "bike" && w.weekIndex === planned!.weekIndex && w.status === "planned" && !w.absorbedBy,
  );
  ok(ridesBefore.length > 0, `the week still had ${ridesBefore.length} ride(s) standing`);
  ok(ridesAfter.length < ridesBefore.length,
     `and the bike you already did comes off one of them (${ridesBefore.length} → ${ridesAfter.length})`);

  // Absorbed is NOT missed — the whole reason `absorbedBy` exists. Measured as a
  // DELTA rather than an absolute: this fixture jumps to week 2 without training
  // weeks 0–1, so the window is full of genuine misses. What must hold is that
  // absorbing a session doesn't add one.
  const absorbed = Object.values(after.workouts).find((w) => w.absorbedBy);
  ok(!!absorbed, "the covered session carries absorbedBy");
  const missedBefore = assessAdaptation(res.plan, today)?.missed ?? 0;
  const missedAfter = assessAdaptation(after, today)?.missed ?? 0;
  ok(missedAfter <= missedBefore,
     `absorbing never adds to the miss count (${missedBefore} → ${missedAfter}) — training MORE must never read as falling behind`);
}

// ---------------------------------------------------------------------------
// INSTEAD-OF vs AS-WELL-AS. Ryan drew the line himself:
//
//   "If I have a long run left on the week and I do a 2k run today, that doesn't
//    swap it. It might shorten it if you want, but doesn't swap it. But if I
//    already did a 10k run today and I had a 10k run planned for Saturday, and I
//    had nothing planned for today, then, and only then, should I switch."
//
// The deciding fact is whether the DAY already carried that sport. If it didn't,
// the unplanned session stood in for the planned one and the planned one comes
// off. If it did, the work was extra and may only shorten what's left — deleting
// a session because someone trained MORE hands them a rest day as a punishment.
// ---------------------------------------------------------------------------
{
  section("extra work shortens; a stand-in replaces");

  const plan = generatePlan(profile(), ANCHOR);
  const week = plan.weeks[2];
  const inThisWeek = week.workoutIds.map((id) => plan.workouts[id]!).filter((w) => w.discipline !== "rest");
  const plannedRun = inThisWeek.find(
    (w) => w.discipline === "run" && inThisWeek.some((x) => x.discipline === "run" && x.status === "planned" && x.date > w.date),
  );
  ok(!!plannedRun, "a run today with another run later in the week");
  const today = plannedRun!.date;
  const later = inThisWeek.find((x) => x.discipline === "run" && x.date > today)!;
  const laterBaseSec = later.estDurationSec;

  /** Log an unplanned run of `min` minutes, optionally having done today's planned one. */
  const extraRun = (min: number, didTodays: boolean) => {
    let p: Plan = plan;
    if (didTodays) {
      p = logCheckin(p, plannedRun!.id, { rpe: 5, feel: "ok", actualDurationSec: plannedRun!.estDurationSec });
    } else {
      const workouts = { ...p.workouts };
      delete workouts[plannedRun!.id];
      p = { ...p, workouts, weeks: p.weeks.map((k) => ({ ...k, workoutIds: k.workoutIds.filter((i) => i !== plannedRun!.id) })) };
    }
    const res = logWorkout(p, { dateISO: today, discipline: "run", durationSec: min * 60, rpe: 5, feel: "ok" });
    const after = respondTo(res.plan, today, { kind: "logged", workoutId: res.loggedId! })?.plan ?? res.plan;
    return after.workouts[later.id];
  };

  // Stand-in: nothing of that sport on the day, and it covers the target.
  const standIn = extraRun(Math.round((laterBaseSec / 60) * 0.8), false);
  ok(standIn.status === "skipped" && !!standIn.absorbedBy,
     "with nothing planned that day, a comparable run REPLACES the one later in the week");

  // As-well-as: the day already had its run, so the same session may only shorten.
  const asWell = extraRun(Math.round((laterBaseSec / 60) * 0.8), true);
  ok(asWell.status === "planned",
     "but having already done that day's run, the same extra run does NOT remove it");
  ok(asWell.estDurationSec < laterBaseSec,
     `it shortens it instead (${Math.round(laterBaseSec / 60)}m → ${Math.round(asWell.estDurationSec / 60)}m)`);

  // A token jog never eats a long run.
  const jog = extraRun(12, true);
  ok(jog.status === "planned", "a 12 minute jog never removes the long run");
  ok(jog.estDurationSec > asWell.estDurationSec,
     "and takes less off it than a real session does — the cut is proportional to what you did");

  // The rule is about the SPORT, not the day being empty: a swim planned and done
  // leaves a run day free, so an unplanned run still stands in.
  const swimDay = inThisWeek.find(
    (w) => w.discipline === "swim" && !inThisWeek.some((x) => x.discipline === "run" && x.date === w.date),
  );
  if (swimDay) {
    const runLater = inThisWeek.find((x) => x.discipline === "run" && x.status === "planned" && x.date > swimDay.date);
    if (runLater) {
      const p = logCheckin(plan, swimDay.id, { rpe: 5, feel: "ok", actualDurationSec: swimDay.estDurationSec });
      const res = logWorkout(p, {
        dateISO: swimDay.date,
        discipline: "run",
        durationSec: Math.round(runLater.estDurationSec * 0.85),
        rpe: 5,
        feel: "ok",
      });
      const after = respondTo(res.plan, swimDay.date, { kind: "logged", workoutId: res.loggedId! })?.plan ?? res.plan;
      ok(after.workouts[runLater.id].status === "skipped",
         "a day whose planned session was a SWIM is still free for a run to stand in");
    }
  }
}

// --- 11. an unplanned session is never silently ignored ---------------------
//
// `canCover` is a one-way door so easy work can't buy an athlete out of intervals. It
// was gating the SHORTEN path too, and in a build week almost everything left is Z3+ —
// so an unplanned ride routinely matched nothing and the plan did nothing at all.
// Observed on device: an unplanned 1h15 bike left a Bike Threshold 4x10 untouched, which
// is #215's original complaint by another route. Volume counts even when intensity
// can't stand in.
section("an unplanned session always registers somewhere in its sport");
{
  const { plan, today, weekIndex } = bed();
  const week = plan.weeks.find((w) => w.index === weekIndex)!;
  // a week whose remaining bikes are ALL quality — the case that used to no-op
  let hard: Plan = { ...plan, workouts: { ...plan.workouts } };
  let bikes = 0;
  for (const id of week.workoutIds) {
    const w = hard.workouts[id];
    if (!w || w.discipline !== "bike" || w.status !== "planned") continue;
    hard.workouts[id] = { ...w, primaryZone: 4 };
    bikes++;
  }
  ok(bikes > 0, `the fixture week has bikes to test against (${bikes})`);

  const before = hard;
  const { plan: after } = didUnplanned(hard, today, "bike", 60, 3); // EASY unplanned ride
  const touched = Object.values(after.workouts).filter(
    (w) => w.absorbedBy && before.workouts[w.id],
  );
  ok(touched.length > 0, "an easy unplanned ride still reduces the week's bike volume");
  for (const w of touched) {
    const was = before.workouts[w.id]!;
    ok(w.status === "planned", `${w.title} is trimmed, not removed — easy work can't cancel a hard session`);
    ok(w.primaryZone === was.primaryZone, `${w.title} keeps its intensity (z${was.primaryZone})`);
    ok(w.estDurationSec < was.estDurationSec, `${w.title} is shorter than it was`);
  }
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} absorb invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all absorb invariants passed");
