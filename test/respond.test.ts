// ---------------------------------------------------------------------------
// The event → response mapping (lib/respond.ts).
//
// The property under test is the ladder: one event moves the next few sessions
// and nothing more. A single logged workout must never restructure the block,
// and the plan must stay quiet when the honest answer is "nothing" — an app that
// announces a change it didn't make is the dead-button bug in a new hat (#108).
//
// Also tested: that every way of recording work reaches the plan through the
// SAME path. Longer, further and harder are not three features; they are three
// things the ledger already knows, and represcribe reads the ledger.
//
// Pure, no clock, no I/O. Run: npx tsx test/respond.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { logCheckin, moveWorkout, setStatus, swapDiscipline } from "../lib/adapt";
import { HORIZON_SESSIONS } from "../lib/prescribe";
import { hardDayConflicts, isHardImpact, respondTo, type AthleteEvent } from "../lib/respond";
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
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function profile(over: Partial<Profile> = {}): Profile {
  return {
    username: "test", raceType: "olympic", raceDateISO: weeksFrom(16),
    level: "intermediate", workoutsPerWeek: 6, createdAtISO: ANCHOR, ...over,
  } as Profile;
}

/** An athlete two weeks in for whom everything has cost more than prescribed. */
function strained(): { plan: Plan; today: string } {
  const today = addDays(ANCHOR, 16);
  let plan = generatePlan(profile(), ANCHOR);
  for (const w of Object.values(plan.workouts)) {
    if (w.discipline === "rest" || w.date >= today) continue;
    plan = logCheckin(plan, w.id, { rpe: 9, feel: "rough" });
  }
  return { plan, today };
}

// --- 1. quiet when there is nothing to say ----------------------------------
section("a fresh plan answers nothing, because nothing has happened yet");
{
  const plan = generatePlan(profile(), ANCHOR);
  const w = Object.values(plan.workouts).find((x) => x.discipline !== "rest")!;
  for (const kind of ["logged", "skipped", "swapped", "logged-other"] as const) {
    ok(respondTo(plan, ANCHOR, { kind, workoutId: w.id } as AthleteEvent) === null, `${kind} on a history-less plan says nothing`);
  }
}

// --- 2. one event moves the next few sessions, and no more ------------------
section("one event moves the next sessions and never restructures the block");
{
  const { plan, today } = strained();
  const w = Object.values(plan.workouts).find((x) => x.date < today && x.discipline !== "rest")!;
  const res = respondTo(plan, today, { kind: "logged", workoutId: w.id });
  ok(!!res, "a consistently overreaching athlete gets an answer");
  if (res) {
    ok(res.horizon === "sessions", "the horizon is sessions, not week or block");
    ok(res.changedIds.length > 0 && res.changedIds.length <= HORIZON_SESSIONS, `touched ${res.changedIds.length} sessions, at most ${HORIZON_SESSIONS}`);
    ok(res.headline.length > 0, "and it says what it did");

    // structure is untouched: same weeks, same session count, same dates
    ok(res.plan.weeks.length === plan.weeks.length, "week count is unchanged");
    ok(Object.keys(res.plan.workouts).length === Object.keys(plan.workouts).length, "no session is added or deleted");
    for (const [id, after] of Object.entries(res.plan.workouts)) {
      ok(after.date === plan.workouts[id].date, `${id} stays on its day`);
      ok(after.discipline === plan.workouts[id].discipline, `${id} keeps its sport`);
    }
    // nothing in the past moves
    for (const id of res.changedIds) ok(res.plan.workouts[id].date >= today, `${id} is in the future`);
  }
}

// --- 3. every way of recording work reaches the plan the same way -----------
section("longer, further and harder are one mechanism, not three");
{
  const base = generatePlan(profile(), ANCHOR);
  const today = addDays(ANCHOR, 16);
  const past = Object.values(base.workouts).filter((w) => w.discipline !== "rest" && w.date < today);

  // (a) harder than prescribed
  let harder = base;
  for (const w of past) harder = logCheckin(harder, w.id, { rpe: 9, feel: "rough" });
  // (b) longer than prescribed, at the prescribed effort
  let longer = base;
  for (const w of past) longer = logCheckin(longer, w.id, { rpe: 5, actualDurationSec: Math.round(w.estDurationSec * 2.2) });

  const a = respondTo(harder, today, { kind: "logged", workoutId: past[0].id });
  const b = respondTo(longer, today, { kind: "logged", workoutId: past[0].id });
  ok(!!a, "finding it harder than prescribed changes the plan");
  ok(!!b, "doing much more than prescribed changes the plan");
  ok(!!a && !!b && a.horizon === b.horizon, "and both arrive through the same horizon");
}

// --- 4. skipping does not earn extra work -----------------------------------
section("skipping leaves you fresher, and the plan does not pile it back on");
{
  const base = generatePlan(profile(), ANCHOR);
  const today = addDays(ANCHOR, 16);
  const skipped: Plan = { ...base, workouts: { ...base.workouts } };
  for (const w of Object.values(skipped.workouts)) {
    if (w.discipline !== "rest" && w.date < today) skipped.workouts[w.id] = { ...w, status: "skipped" };
  }
  const res = respondTo(skipped, today, { kind: "skipped", workoutId: Object.keys(skipped.workouts)[0] });
  if (res) {
    for (const id of res.changedIds) {
      ok(
        res.plan.workouts[id].estDurationSec <= base.workouts[id].estDurationSec,
        `${id} is never made longer after a skip (doc 02 §4 #9)`,
      );
    }
  } else {
    ok(true, "or, more simply, nothing is said at all");
  }
}

// --- 5. moving a session flags a hard-day clash -----------------------------
section("moving a hard session next to another one is called out");
{
  const plan = generatePlan(profile({ raceType: "half", raceDateISO: weeksFrom(20), longSessionDay: 6 }), ANCHOR);
  const today = ANCHOR;
  const hard = Object.values(plan.workouts)
    .filter((w) => w.status === "planned" && isHardImpact(w) && w.date > addDays(today, 7))
    .sort((a, b) => a.date.localeCompare(b.date));
  ok(hard.length >= 2, `the plan has hard sessions to collide (${hard.length})`);

  if (hard.length >= 2) {
    const [first, second] = hard;
    ok(hardDayConflicts(plan, today).every((c) => c.a.id !== first.id || c.b.id !== second.id), "they don't already clash");
    // drag the second one onto the day right after the first
    const moved = moveWorkout(plan, second.id, addDays(first.date, 1));
    const conflicts = hardDayConflicts(moved, today);
    ok(conflicts.length > 0, "moving it adjacent creates a detectable clash");
    const res = respondTo(moved, today, { kind: "moved", workoutId: second.id });
    ok(!!res && res.warnings.length > 0, "and respondTo warns about it");
    ok(!!res && /48h/.test(res.warnings[0]), "naming the 48h rule");
    ok(!!res && res.changedIds.length === 0, "while changing nothing on its own — the athlete moved it on purpose");
  }
}

// --- 6. the hard-impact definition matches the engine's ---------------------
section("hard-impact means what the engine's spacing invariant means");
{
  const mk = (o: Partial<Workout>) => ({ discipline: "run", primaryZone: 2, type: "endurance", ...o }) as Workout;
  ok(isHardImpact(mk({ discipline: "run", primaryZone: 4 })), "a Z4 run is hard impact");
  ok(isHardImpact(mk({ discipline: "brick", type: "brick" })), "a brick is hard impact at any zone");
  ok(isHardImpact(mk({ discipline: "bike", primaryZone: 5 })), "a Z5 ride is hard impact");
  ok(!isHardImpact(mk({ discipline: "swim", primaryZone: 5 })), "swimming never is — it doesn't load the skeleton");
  ok(!isHardImpact(mk({ discipline: "run", primaryZone: 2 })), "an easy run is not");
  ok(!isHardImpact(mk({ discipline: "strength", primaryZone: 4 })), "strength is not counted here");
}

// --- 7. degenerate -----------------------------------------------------------
section("never throws on degenerate input");
{
  const plan = generatePlan(profile(), ANCHOR);
  let threw = false;
  try {
    respondTo(plan, ANCHOR, { kind: "logged", workoutId: "nope" });
    respondTo({ ...plan, workouts: {} }, ANCHOR, { kind: "moved", workoutId: "nope" });
    hardDayConflicts({ ...plan, workouts: {} });
  } catch {
    threw = true;
  }
  ok(!threw, "unknown ids and empty plans never throw");
}

// ---------------------------------------------------------------------------
// A SKIP REPORTS. IT DOES NOT REASSIGN.
//
// Ryan: "when I skip a session, it should not show up in the home page telling
// me this is what you're gonna do tomorrow."
//
// Measured before the fix: skipping a Tempo Run ran `restoreSport`, which
// rewrote the FOLLOWING SATURDAY'S Aerobic Endurance Ride into a run — "That
// leaves you a run short this week, so one of your bike sessions becomes a run"
// — and toasted it. The responder was applying trade logic to a decision: a swap
// means the session moved sports, so restoring the mix is right; a skip means the
// session is gone, and putting it back on another day argues with the athlete.
// respond.ts already states this rule for the load ledger, quoting doc 02 §4 #11.
//
// Asserted by comparing the WHOLE plan before and after, not by reading the
// headline — the bug was a silent rewrite of a different day, and a headline
// check would have sailed straight past it.
{
  section("skipping a session never rewrites another one");

  const today = addDays(ANCHOR, 2);
  const plan = generatePlan(profile(), ANCHOR);
  const shape = (p: Plan) =>
    Object.values(p.workouts)
      .map((w) => `${w.id}|${w.discipline}|${w.title}|${w.primaryZone}|${w.estDurationSec}`)
      .sort()
      .join("\n");

  const upcoming = Object.values(plan.workouts).filter((w) => w.date >= today && w.discipline !== "rest");
  ok(upcoming.length > 10, `enough sessions to sweep (${upcoming.length})`);

  let mutated = 0;
  let announced = 0;
  for (const w of upcoming) {
    const before = setStatus(plan, w.id, "skipped");
    const res = respondTo(before, today, { kind: "skipped", workoutId: w.id });
    if (res && shape(res.plan) !== shape(before)) mutated++;
    if (res?.changedIds.length) announced++;
  }
  ok(mutated === 0, `no skip rewrites any other session (${mutated} of ${upcoming.length} did)`);
  ok(announced === 0, `and none reports a change, so nothing pops up claiming the plan moved (${announced})`);

  // The session the athlete skipped stays skipped — the responder mustn't quietly
  // re-plan it either.
  const one = upcoming.find((w) => (w.primaryZone ?? 0) >= 3) ?? upcoming[0];
  const skipped = setStatus(plan, one.id, "skipped");
  const after = respondTo(skipped, today, { kind: "skipped", workoutId: one.id });
  ok((after?.plan ?? skipped).workouts[one.id].status === "skipped", "the skipped session is still skipped afterwards");

  // …and the behaviour this deliberately KEEPS: a swap is a trade, so the week's
  // sport balance is restored WHERE THE WEEK CAN AFFORD IT.
  //
  // This assertion used to be a bare "something changed", and it passed for the wrong
  // reason. In this very fixture the week has no run headroom left, so the only way to
  // restore the mix was `swapDiscipline`'s 20-minute floor — a 100-minute ride came back
  // as a 20-minute run, and the sport count was "fixed" by deleting 80 minutes of
  // training. That is #219 ("Why did my 1h bike turn into a 20 min run"), and it was
  // sitting green in this suite because nothing checked what the rebalance COST.
  //
  // The honest property is not "always rebalances" — sometimes it can't, safely. It is:
  // the responder either relocates a session or leaves it alone, and never guts one.
  const run = upcoming.find((w) => w.discipline === "run");
  if (run) {
    const swapped = swapDiscipline(plan, run.id, "bike");
    const res = respondTo(swapped, today, { kind: "swapped", workoutId: run.id });
    const after = res?.plan ?? swapped;
    let gutted = 0;
    for (const [id, w] of Object.entries(after.workouts)) {
      const was = swapped.workouts[id];
      if (!was || id === run.id || was.discipline === "rest") continue;
      // a converted session must carry most of what it replaced
      if (w.discipline !== was.discipline && w.estDurationSec < was.estDurationSec * 0.7) {
        gutted++;
        console.error(
          `    (${was.title}: ${Math.round(was.estDurationSec / 60)}min ${was.discipline} -> ` +
            `${Math.round(w.estDurationSec / 60)}min ${w.discipline})`,
        );
      }
    }
    ok(gutted === 0, `a swap never guts a session to fix the sport count (${gutted} gutted) — #219`);
    ok(res == null || res.changedIds.length > 0 || res.headline.length > 0,
      "and when it can't rebalance it says so rather than moving in silence");
  } else {
    ok(false, "precondition: a run to swap");
  }
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} response invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all response invariants passed");
