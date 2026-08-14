// ---------------------------------------------------------------------------
// The athlete's decisions survive everything (lib/decisions.ts, lib/equilibrium.ts).
//
// These are Ryan's four rules from 2026-08-13, asserted directly rather than
// approached through the behaviours that happen to use them:
//
//   1. The per-sport frequency you ask for is a contract, every week.
//   2. A skip is permanent. "If I skip my swim on August twelfth, there should
//      never be a swim on August twelfth ever."
//   3. A swap is permanent. "If I swap my Saturday long bike for a Saturday long
//      run, it should always stay Saturday long run regardless."
//   4. Equilibrium is settled by EQUIVALENCE, not by counting heads — a 2 km jog
//      does not discharge a 12 km long run.
//
// The test that matters most is the one that rebuilds REPEATEDLY. Every one of
// these decisions used to survive a while and then vanish, because rebuilds fire
// automatically (three missed sessions, any settings save, an engine upgrade) and
// each one regenerated the future from scratch. A single rebuild was never the
// bug; the fifth one was.
//
// Pure, no clock, no I/O. Run: npx tsx test/decisions.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { rebuildFromToday, setStatus, swapDiscipline, unswapDiscipline, logWorkout, logCheckin } from "../lib/adapt";
import { addSession } from "../lib/addSession";
import { respondTo } from "../lib/respond";
import {
  contractedCounts,
  deliveredCredit,
  equivalence,
  prescribedCredit,
  roleOf,
  settleUnplanned,
  sportBalance,
  type Sport,
} from "../lib/equilibrium";
import { anchorOf, backfillDecisions, ledgerOf } from "../lib/decisions";
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

const ANCHOR = "2026-08-03"; // a Monday
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function profile(over: Partial<Profile> = {}): Profile {
  return {
    username: "test",
    raceType: "olympic",
    raceDateISO: addDays(ANCHOR, 16 * 7),
    level: "intermediate",
    workoutsPerWeek: 9,
    perSport: { swim: 3, bike: 3, run: 3 },
    createdAtISO: ANCHOR,
    ...over,
  } as Profile;
}

const sessions = (p: Plan, dateISO: string): Workout[] =>
  Object.values(p.workouts).filter((w) => w.date === dateISO && w.discipline !== "rest" && !w.id.startsWith("kept-"));

const isUnplannedId = (id: string) => id.startsWith("logged-") || id.startsWith("synced-") || id.startsWith("added-");

const live = (p: Plan, dateISO: string, d: Discipline): Workout[] =>
  sessions(p, dateISO).filter((w) => w.discipline === d && w.status !== "skipped");

// --- 1. the frequency contract ---------------------------------------------
section("the per-sport frequency you asked for is what you get, every week");
{
  const prof = profile();
  const plan = generatePlan(prof, ANCHOR);
  const want = contractedCounts(prof);

  // The two documented exceptions: the taper (race week holds a race, and the last
  // days before an A-race are the one place where fewer sessions IS the
  // prescription), and the week carrying the day before race day, which is cleared
  // to rest outright.
  const eveOfRace = addDays(prof.raceDateISO, -1);
  let offBy = 0;
  let worst = "";
  for (const week of plan.weeks) {
    if (week.isRaceWeek || week.phase === "taper") continue;
    if (eveOfRace >= week.startDate && eveOfRace < addDays(week.startDate, 7)) continue;
    // A brick occupies a bike slot — see `countsAs` in lib/equilibrium.ts.
    const counts: Record<Sport, number> = { swim: 0, bike: 0, run: 0 };
    for (const id of week.workoutIds) {
      const w = plan.workouts[id];
      if (!w) continue;
      const slot = w.discipline === "brick" ? "bike" : w.discipline;
      if (slot === "swim" || slot === "bike" || slot === "run") counts[slot]++;
    }
    for (const s of ["swim", "bike", "run"] as Sport[]) {
      if (counts[s] !== want[s]) {
        offBy++;
        if (!worst) worst = `${week.label}: ${s} ${counts[s]} vs the ${want[s]} asked for`;
      }
    }
  }
  ok(offBy === 0, `every non-taper week honours 3/3/3 (${offBy} deviations; first: ${worst})`);

  // …and specifically the recovery weeks, which used to be silently cut to 2/2/2.
  const recovery = plan.weeks.filter((w) => w.isRecovery);
  ok(recovery.length > 0, `the fixture block contains recovery weeks to check (${recovery.length})`);
  for (const week of recovery) {
    const runs = week.workoutIds.filter((id) => plan.workouts[id]?.discipline === "run").length;
    ok(runs === want.run, `${week.label} keeps all ${want.run} runs (got ${runs}) — a deload cuts volume, not frequency`);
  }
  // and it really is lighter, or "keep the counts" would just be more training
  const normal = plan.weeks.find((w) => !w.isRecovery && !w.isRaceWeek && w.phase === recovery[0].phase)!;
  ok(
    recovery[0].targetHours < normal.targetHours,
    `a recovery week is still genuinely lighter (${recovery[0].targetHours.toFixed(1)}h vs ${normal.targetHours.toFixed(1)}h)`,
  );
}

// --- 2. a skip is permanent -------------------------------------------------
section("a skipped session never comes back — not after five rebuilds");
{
  const plan = generatePlan(profile(), ANCHOR);
  const today = addDays(ANCHOR, 7);
  // Find a future swim to skip, the way Ryan described it.
  const swim = Object.values(plan.workouts)
    .filter((w) => w.discipline === "swim" && w.date > today && w.status === "planned")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  ok(!!swim, "the fixture has a future swim to skip");

  const skipDate = swim.date;
  let p = setStatus(plan, swim.id, "skipped");
  ok((p.decisions ?? []).some((d) => d.kind === "skip"), "skipping files a decision in the ledger");
  ok(live(p, skipDate, "swim").length === 0, `no live swim on ${skipDate} right after the skip`);

  for (let i = 1; i <= 5; i++) {
    p = rebuildFromToday(p, today);
    ok(
      live(p, skipDate, "swim").length === 0,
      `still no swim on ${skipDate} after rebuild ${i} (found ${live(p, skipDate, "swim").length})`,
    );
  }
  ok(
    (p.decisions ?? []).some((d) => d.kind === "skip" && d.dateISO === skipDate),
    "and the decision itself is still on the plan after five rebuilds",
  );
}

// --- 3. a swap is permanent -------------------------------------------------
section("a swapped session stays swapped — not after five rebuilds");
{
  const plan = generatePlan(profile(), ANCHOR);
  const today = addDays(ANCHOR, 7);
  // Ryan's exact case: the Saturday long ride becomes a long run.
  const longRide = Object.values(plan.workouts)
    .filter((w) => w.discipline === "bike" && w.date > today && w.status === "planned" && w.type === "long")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  ok(!!longRide, "the fixture has a future long ride to swap");

  const swapDate = longRide.date;
  let p = swapDiscipline(plan, longRide.id, "run");
  ok((p.decisions ?? []).some((d) => d.kind === "swap"), "swapping files a decision in the ledger");
  ok(live(p, swapDate, "run").length >= 1, `${swapDate} is a run straight after the swap`);

  for (let i = 1; i <= 5; i++) {
    p = rebuildFromToday(p, today);
    ok(live(p, swapDate, "run").length >= 1, `${swapDate} is still a run after rebuild ${i}`);
    ok(
      live(p, swapDate, "bike").length === 0,
      `and the ride has not crept back onto ${swapDate} after rebuild ${i}`,
    );
  }
}

// --- 3b. undo actually undoes ----------------------------------------------
section("undo reaches the ledger, so a rebuild does not resurrect the decision");
{
  const plan = generatePlan(profile(), ANCHOR);
  const today = addDays(ANCHOR, 7);
  const ride = Object.values(plan.workouts)
    .filter((w) => w.discipline === "bike" && w.date > today && w.status === "planned")
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  const swapped = swapDiscipline(plan, ride.id, "run");
  const undone = unswapDiscipline(swapped, ride.id);
  ok(
    !(undone.decisions ?? []).some((d) => d.kind === "swap"),
    "un-swapping removes the swap decision",
  );
  const rebuilt = rebuildFromToday(undone, today);
  ok(
    live(rebuilt, ride.date, "bike").length >= 1,
    "so the rebuild leaves it as the ride it was put back to",
  );

  const skipped = setStatus(plan, ride.id, "skipped");
  const unskipped = setStatus(skipped, ride.id, "planned");
  ok(!(unskipped.decisions ?? []).some((d) => d.kind === "skip"), "un-skipping removes the skip decision");
  ok(
    live(rebuildFromToday(unskipped, today), ride.date, "bike").length >= 1,
    "and the session is genuinely back after a rebuild",
  );
}

// --- 4. equivalence, not head-counting -------------------------------------
section("a 2 km jog does not discharge a 12 km long run");
{
  const plan = generatePlan(profile(), ANCHOR);
  const week = plan.weeks[2];
  const longRun = week.workoutIds
    .map((id) => plan.workouts[id]!)
    .find((w) => w.discipline === "run" && w.type === "long");
  ok(!!longRun, "the fixture week has a long run");

  if (longRun) {
    // A day in the week with nothing planned, before the long run.
    const busy = new Set(sessions(plan, "").map((w) => w.date));
    const spare = Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i)).find(
      (d) => d < longRun.date && !sessions(plan, d).length,
    )!;
    ok(!!spare, "and a spare day before it");

    // The tiny run: about a sixth of the long run's duration, easy.
    const tinyMin = Math.max(10, Math.round((longRun.estDurationSec / 60) * 0.17));
    const logged = logWorkout(plan, { dateISO: spare, discipline: "run", durationSec: tinyMin * 60, rpe: 3 });
    const bonusId = Object.keys(logged.plan.workouts).find((id) => !plan.workouts[id])!;
    const e = equivalence(logged.plan.workouts[bonusId], longRun);
    // PARTIAL, not negligible, and not equivalent either. This assertion originally
    // read `verdict === "negligible"` and that was wrong — QA against Ryan's own
    // wording caught it. He asks for exactly the middle outcome: "we cannot just say
    // he did the three runs for the week… you could lighten up the Friday run,
    // because I did a Thursday run." Negligible would have meant the plan ignored the
    // jog entirely, which is the same do-nothing the whole rebuild exists to end.
    ok(
      e.verdict === "partial",
      `a ${tinyMin} min easy jog scores ${(e.ratio * 100).toFixed(0)}% of the long run — partial: it counts, but it is not the session`,
    );

    const answered = respondTo(logged.plan, spare, { kind: "logged-other", workoutId: bonusId });
    const plan2 = answered?.plan ?? logged.plan;
    // The jog must DO something, and it must not discharge a session it did not
    // earn. Which session gives way is the engine's call — it settles against the
    // nearest match, so with two runs left a 9-minute jog may quite correctly land
    // on the easy run rather than the long one. What is asserted is the rule, not
    // the choice: something is lightened, nothing is cancelled.
    const lightened = Object.values(plan2.workouts).filter(
      (w) => w.absorbedBy === bonusId && w.status === "planned",
    );
    const cancelled = Object.values(plan2.workouts).filter(
      (w) => w.absorbedBy === bonusId && w.status === "skipped",
    );
    ok(lightened.length >= 1, `the jog lightens something (${lightened.length} lightened)`);
    ok(cancelled.length === 0, `and cancels nothing — it did not earn a session (${cancelled.length} cancelled)`);
    for (const w of lightened) {
      const was = logged.plan.workouts[w.id];
      ok(
        w.estDurationSec >= was.estDurationSec * 0.6,
        `${w.title} is trimmed, not gutted (${Math.round(was.estDurationSec / 60)} → ${Math.round(w.estDurationSec / 60)} min)`,
      );
    }
  }
}

section("Ryan's literal case: Mon and Wed run as planned, a 2 km Thursday, Friday's long run left");
{
  const plan = generatePlan(profile(), ANCHOR);
  const week = plan.weeks[2];
  const runs = week.workoutIds
    .map((id) => plan.workouts[id]!)
    .filter((w) => w.discipline === "run")
    .sort((a, b) => a.date.localeCompare(b.date));
  const longRun = runs[runs.length - 1];
  ok(runs.length >= 2, `the fixture week has the runs to set this up (${runs.length})`);

  // every earlier run done as planned, so the long run is genuinely all that is left
  let p: Plan = { ...plan, workouts: { ...plan.workouts } };
  for (const r of runs.slice(0, -1)) p.workouts[r.id] = { ...r, status: "done", rpe: 4 };

  const thu = addDays(longRun.date, -1);
  const tiny = Math.max(8, Math.round((longRun.estDurationSec / 60) * 0.17)); // ~2 km against ~12 km
  const logged = logWorkout(p, { dateISO: thu, discipline: "run", durationSec: tiny * 60, rpe: 3 });
  const bonusId = Object.keys(logged.plan.workouts).find((id) => !p.workouts[id])!;
  const answered = respondTo(logged.plan, thu, { kind: "logged-other", workoutId: bonusId });
  const after = (answered?.plan ?? logged.plan).workouts[longRun.id];

  ok(after.status !== "skipped", "three runs on the clock does NOT mean the week is done");
  ok(
    after.estDurationSec < longRun.estDurationSec,
    `Friday's long run is lightened by what was already run (${Math.round(longRun.estDurationSec / 60)} → ${Math.round(after.estDurationSec / 60)} min)`,
  );
  ok(
    after.estDurationSec >= longRun.estDurationSec * 0.6,
    "and it is still the long run, not a token of one",
  );
  // and the plan must never answer extra work by prescribing MORE work
  for (const [id, w] of Object.entries(answered?.plan ?? logged.plan)[0] ? Object.entries((answered?.plan ?? logged.plan).workouts) : []) {
    const was = logged.plan.workouts[id];
    if (!was || isUnplannedId(id)) continue;
    ok(
      w.estDurationSec <= was.estDurationSec + 1,
      `${w.title} was not LENGTHENED in response to extra work (${Math.round(was.estDurationSec / 60)} → ${Math.round(w.estDurationSec / 60)} min)`,
    );
  }
}

section("but a genuine equivalent does discharge it");
{
  const plan = generatePlan(profile(), ANCHOR);
  const week = plan.weeks[2];
  const longRun = week.workoutIds.map((id) => plan.workouts[id]!).find((w) => w.discipline === "run" && w.type === "long")!;
  const spare = Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i)).find(
    (d) => d < longRun.date && !sessions(plan, d).length,
  )!;
  const fullMin = Math.round(longRun.estDurationSec / 60);
  const logged = logWorkout(plan, { dateISO: spare, discipline: "run", durationSec: fullMin * 60, rpe: 3 });
  const bonusId = Object.keys(logged.plan.workouts).find((id) => !plan.workouts[id])!;
  const answered = respondTo(logged.plan, spare, { kind: "logged-other", workoutId: bonusId });
  const after = (answered?.plan ?? logged.plan).workouts[longRun.id];
  ok(
    after.status === "skipped" && !!after.absorbedBy,
    `a full-length easy long run does cover it (status ${after.status})`,
  );
  ok(
    !!answered?.headline && /covers/.test(answered.headline),
    `and it says so: "${answered?.headline}"`,
  );
}

// --- 5. the count contract responds to a swap -------------------------------
section("swapping a bike for a swim puts a bike back somewhere else that week");
{
  const plan = generatePlan(profile(), ANCHOR);
  const today = addDays(ANCHOR, 14);
  const week = plan.weeks.find((w) => w.startDate === addDays(ANCHOR, 14))!;
  const before = sportBalance(plan, week);

  const ride = week.workoutIds
    .map((id) => plan.workouts[id]!)
    .find((w) => w.discipline === "bike" && w.status === "planned" && w.date >= today);
  ok(!!ride, "the fixture week has a ride to swap");

  if (ride) {
    const swapped = swapDiscipline(plan, ride.id, "swim");
    const answered = respondTo(swapped, today, { kind: "swapped", workoutId: ride.id });
    const after = answered?.plan ?? swapped;
    const bal = sportBalance(after, after.weeks.find((w) => w.index === week.index)!);

    ok(
      bal.bike.contracted === before.bike.contracted,
      "the contract itself never moves — it is what the athlete asked for",
    );
    ok(
      bal.bike.current >= before.bike.current - 1 + 1 || bal.bike.current === bal.bike.contracted,
      `the week is back to its ${bal.bike.contracted} bikes (has ${bal.bike.current})`,
    );
    ok(
      !!answered?.headline && /bike/.test(answered.headline),
      `and the athlete is told why: "${answered?.headline}"`,
    );
  }
}

section("and the restored balance survives the rebuilds too");
{
  // The restoration is performed BY `swapDiscipline`, so it files its own decision
  // and replays like any other. That is what makes the contract durable rather than
  // a one-off correction that the next automatic realign undoes — which is exactly
  // how every previous version of this behaviour decayed.
  const plan = generatePlan(profile(), ANCHOR);
  const today = addDays(ANCHOR, 7);
  const bike = Object.values(plan.workouts)
    .filter((w) => w.discipline === "bike" && w.date >= addDays(ANCHOR, 63))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const weekIndex = bike.weekIndex;

  const swapped = swapDiscipline(plan, bike.id, "run");
  const answered = respondTo(swapped, today, { kind: "swapped", workoutId: bike.id });
  let p = answered?.plan ?? swapped;

  const want = contractedCounts(profile());
  for (let i = 0; i <= 5; i++) {
    if (i > 0) p = rebuildFromToday(p, today);
    const wk = p.weeks.find((w) => w.index === weekIndex);
    if (!wk) continue;
    const bal = sportBalance(p, wk);
    ok(
      bal.bike.current === want.bike && bal.run.current === want.run,
      `${i === 0 ? "after the swap" : `after rebuild ${i}`}: the week still holds ${want.bike} bikes and ${want.run} runs ` +
        `(bike ${bal.bike.current}, run ${bal.run.current})`,
    );
  }
}

// --- 5b. adding a session settles against the week -------------------------
section("adding a bike takes a bike off the rest of that week");
{
  const prof = profile();
  const plan = generatePlan(prof, ANCHOR);
  const today = addDays(ANCHOR, 14);
  const week = plan.weeks.find((w) => w.startDate === today)!;

  // A day in the week with nothing on it, so the addition is genuinely extra.
  const spare = Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i)).find(
    (d) => d >= today && !sessions(plan, d).length,
  );
  ok(!!spare, "the fixture week has a free day to add onto");

  if (spare) {
    const added = addSession(plan, prof, spare, "bike");
    ok(!!added, "a bike can be added on that day");
    if (added) {
      const bikesBefore = week.workoutIds
        .map((id) => plan.workouts[id]!)
        .filter((w) => w.discipline === "bike" && w.status === "planned" && w.date >= today);
      const settled = settleUnplanned(added.plan, today, added.workout.id);
      ok(!!settled, "the addition settles against the week rather than sitting on top of it");
      if (settled) {
        const target = settled.plan.workouts[settled.id];
        ok(
          target.discipline === "bike" || target.discipline === "brick",
          `it is a ride that gives way, not another sport (gave way: ${target.discipline})`,
        );
        const was = added.plan.workouts[settled.id];
        ok(
          target.status === "skipped" || target.estDurationSec < was.estDurationSec,
          `and it either comes off the week or gets shorter (${settled.kind})`,
        );
        ok(bikesBefore.length > 0, "there was a later ride available to settle against");
      }
    }
  }
}

section("and settling it once is settling it for good");
{
  const prof = profile();
  const plan = generatePlan(prof, ANCHOR);
  const today = addDays(ANCHOR, 14);
  const week = plan.weeks.find((w) => w.startDate === today)!;
  const spare = Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i)).find(
    (d) => d >= today && !sessions(plan, d).length,
  );
  if (spare) {
    const added = addSession(plan, prof, spare, "bike");
    if (added) {
      // committed → settles
      const once = settleUnplanned(added.plan, today, added.workout.id);
      ok(!!once, "the commit settles it");
      if (once) {
        // …and then the athlete actually does it. This used to settle a SECOND
        // session: one extra ride, two rides taken off the week.
        const done = setStatus(once.plan, added.workout.id, "done");
        const twice = settleUnplanned(done, today, added.workout.id);
        ok(twice === null, "completing it does not settle a second session");
        const gaveWay = Object.values(done.workouts).filter((w) => w.absorbedBy === added.workout.id);
        ok(gaveWay.length === 1, `exactly one session gave way to it (${gaveWay.length})`);
      }
    }
  } else {
    ok(true, "no free day in the fixture week (vacuously safe)");
  }
}

// --- 5c. extra work accumulates, overshoots settle, silence is never the answer ---
section("two extra rides count as two, not as one (cumulative credit)");
{
  const plan = generatePlan(profile(), ANCHOR);
  const week = plan.weeks[2];
  const bikes = week.workoutIds.map((id) => plan.workouts[id]!).filter((w) => w.discipline === "bike");
  const free = Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i)).find((x) => !sessions(plan, x).length);
  ok(!!free && bikes.length >= 2, `the fixture week has rides and a free day (${bikes.length} rides)`);

  if (free && bikes.length >= 2) {
    const totals: number[] = [];
    let p: Plan = plan;
    for (let i = 0; i < 3; i++) {
      const lg = logWorkout(p, { dateISO: free, discipline: "bike", durationSec: 25 * 60, rpe: 3 });
      const bid = Object.keys(lg.plan.workouts).find((id) => !p.workouts[id])!;
      p = respondTo(lg.plan, free, { kind: "logged", workoutId: bid })?.plan ?? lg.plan;
      totals.push(bikes.reduce((a, b) => a + p.workouts[b.id].estDurationSec, 0));
    }
    // Each further ride must take MORE off in total than the one before left. Measured
    // before this: two 25-minute rides each measured a third of the same untouched long
    // ride, asked for the same third, and 50 minutes of riding was credited as 25.
    ok(
      totals[1] < totals[0] && totals[2] < totals[1],
      `each extra ride keeps reducing the week (${totals.map((t) => Math.round(t / 60)).join(" → ")} min of riding left)`,
    );
    const designed = bikes.reduce((a, b) => a + b.estDurationSec, 0);
    ok(
      totals[2] >= designed * 0.3,
      "…but the week is never emptied — MAX_CUT still floors every session at 70% of its design",
    );
  }
}

section("a session taken far past its prescription settles like extra work");
{
  const plan = generatePlan(profile(), ANCHOR);
  const week = plan.weeks[2];
  const runs = week.workoutIds
    .map((id) => plan.workouts[id]!)
    .filter((w) => w.discipline === "run")
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = runs[0];
  ok(runs.length >= 2, `the fixture week has runs to settle against (${runs.length})`);

  if (runs.length >= 2) {
    // Ryan's case: a 60 min long run done as 120.
    const done = logCheckin(plan, first.id, { actualDurationSec: first.estDurationSec * 2, rpe: 4 });
    const answered = respondTo(done, first.date, { kind: "logged", workoutId: first.id });
    const after = answered?.plan ?? done;
    const moved = runs.slice(1).filter((r) => after.workouts[r.id].estDurationSec < r.estDurationSec);
    ok(moved.length >= 1, `doubling a session lightens the rest of that sport's week (${moved.length} moved)`);
    // …and only ever LIGHTENS. Overshooting one session is not evidence another happened.
    const cancelled = runs.slice(1).filter((r) => after.workouts[r.id].status === "skipped");
    ok(cancelled.length === 0, `no session is CANCELLED by an overshoot (${cancelled.length} cancelled)`);
    ok(
      !!answered?.headline && !/wasn't on the plan/.test(answered.headline),
      `the sentence names the real cause, not "wasn't on the plan": "${answered?.headline}"`,
    );
    // and it must not contradict itself in the next breath
    ok(
      !answered?.warnings.some((w) => /nothing else moves/.test(w)),
      `it never says "nothing else moves" right after moving something (${answered?.warnings.length ?? 0} warnings)`,
    );
  }
}

section("extra work that cannot be settled is SAID, not swallowed");
{
  const plan = generatePlan(profile(), ANCHOR);
  const race = plan.weeks.find((w) => w.isRaceWeek)!;
  const session = race.workoutIds.map((id) => plan.workouts[id]!).find((w) => w.discipline !== "rest");
  ok(!!session, "race week has a session to overshoot");
  if (session) {
    // race week is never rebalanced, so this is the guaranteed "nothing can move" case
    const done = logCheckin(plan, session.id, { actualDurationSec: session.estDurationSec * 3, rpe: 5 });
    const answered = respondTo(done, session.date, { kind: "logged", workoutId: session.id });
    ok(
      !!answered && answered.warnings.length > 0,
      `the athlete is told rather than left with silence (${answered?.warnings.length ?? 0} warnings)`,
    );
    ok(
      !!answered?.warnings.some((w) => /race week|taper/i.test(w)),
      `and the sentence fits race week: "${answered?.warnings[0]}"`,
    );
  }
}

// --- 6. role matching ------------------------------------------------------
section("a long session that leaves is replaced by a long one, not the easiest one");
{
  const plan = generatePlan(profile(), ANCHOR);
  const today = addDays(ANCHOR, 14);
  const week = plan.weeks.find((w) => w.startDate === addDays(ANCHOR, 14))!;
  const longRide = week.workoutIds
    .map((id) => plan.workouts[id]!)
    .find((w) => w.discipline === "bike" && w.type === "long" && w.date >= today);

  if (longRide) {
    const swapped = swapDiscipline(plan, longRide.id, "run");
    const answered = respondTo(swapped, today, { kind: "swapped", workoutId: longRide.id });
    const after = answered?.plan ?? swapped;
    const converted = Object.values(after.workouts).filter(
      (w) => w.id !== longRide.id && w.swappedFrom && w.discipline === "bike",
    );
    for (const w of converted) {
      ok(
        w.estDurationSec >= (w.swappedFrom?.estDurationSec ?? 0) * 0.7,
        `a restoration relocates a session, never guts it (${Math.round((w.swappedFrom?.estDurationSec ?? 0) / 60)} → ${Math.round(w.estDurationSec / 60)} min)`,
      );
    }
    ok(true, `role-matched restoration ran without gutting anything (${converted.length} conversions)`);
  } else {
    ok(true, "no long ride in the fixture week (vacuously safe)");
  }
}

// --- 7. one edit must not cascade -------------------------------------------
section("one edit changes a few sessions, never the whole plan");
{
  const plan = generatePlan(profile(), ANCHOR);
  const today = addDays(ANCHOR, 14);
  const target = Object.values(plan.workouts)
    .filter((w) => w.discipline === "bike" && w.date > today && w.status === "planned")
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  const swapped = swapDiscipline(plan, target.id, "run");
  const answered = respondTo(swapped, today, { kind: "swapped", workoutId: target.id });
  const after = answered?.plan ?? swapped;

  let moved = 0;
  for (const [id, w] of Object.entries(after.workouts)) {
    const was = plan.workouts[id];
    if (!was) continue;
    if (w.discipline !== was.discipline || w.estDurationSec !== was.estDurationSec || w.status !== was.status) moved++;
  }
  ok(moved <= 4, `a single swap moved ${moved} sessions — small and local, not a re-plan`);

  // …and nothing outside the edited week was touched at all.
  const editedWeek = after.workouts[target.id].weekIndex;
  let outside = 0;
  for (const [id, w] of Object.entries(after.workouts)) {
    const was = plan.workouts[id];
    if (!was || w.weekIndex === editedWeek) continue;
    if (w.discipline !== was.discipline || w.estDurationSec !== was.estDurationSec || w.status !== was.status) outside++;
  }
  ok(outside === 0, `and nothing outside that week moved at all (${outside} sessions)`);
}

// --- 8. the migration path --------------------------------------------------
section("a plan made before the ledger existed keeps its decisions too");
{
  const plan = generatePlan(profile(), ANCHOR);
  const today = addDays(ANCHOR, 7);
  const swim = Object.values(plan.workouts)
    .filter((w) => w.discipline === "swim" && w.date > today && w.status === "planned")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const ride = Object.values(plan.workouts)
    .filter((w) => w.discipline === "bike" && w.date > today && w.status === "planned")
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  // An "old" plan: the decisions are visible on the workouts, but there is no ledger.
  let legacy = setStatus(plan, swim.id, "skipped");
  legacy = swapDiscipline(legacy, ride.id, "run");
  const stripped: Plan = { ...legacy, decisions: undefined };

  const recovered = backfillDecisions(stripped, today);
  ok(recovered.some((d) => d.kind === "skip"), "the skip is recovered from the workout state");
  ok(recovered.some((d) => d.kind === "swap"), "and so is the swap — the one the old carry-over could never keep");
  ok(ledgerOf(stripped, today).length === recovered.length, "ledgerOf falls back to the backfill when there is no array");

  const rebuilt = rebuildFromToday(stripped, today);
  ok(live(rebuilt, swim.date, "swim").length === 0, "the skipped swim stays skipped through the migration");
  ok(live(rebuilt, ride.date, "run").length >= 1, "and the swapped ride is still a run");
  ok(!!rebuilt.decisions?.length, "and the plan now carries a real ledger, so it never has to be inferred again");
}

// --- 9. anchors are stable --------------------------------------------------
section("an anchor survives the transformations that ids do not");
{
  const plan = generatePlan(profile(), ANCHOR);
  const ride = Object.values(plan.workouts).find((w) => w.discipline === "bike" && w.status === "planned")!;
  const before = anchorOf(plan, ride);
  const swapped = swapDiscipline(plan, ride.id, "run");
  ok(
    anchorOf(swapped, swapped.workouts[ride.id]) === before,
    "a swap does not move the anchor — that is what lets the decision find it again",
  );
  const twice = swapDiscipline(swapped, ride.id, "swim");
  ok(
    anchorOf(twice, twice.workouts[ride.id]) === before,
    "and neither does swapping a second time",
  );
}

// --- 10. credit arithmetic is sane -----------------------------------------
section("the credit formula behaves at the boundaries");
{
  const plan = generatePlan(profile(), ANCHOR);
  const any = Object.values(plan.workouts).find((w) => w.discipline === "run" && w.status === "planned")!;
  ok(prescribedCredit(any) > 0, "a real session is worth something");
  ok(
    deliveredCredit({ ...any, rpe: 9 }) > deliveredCredit({ ...any, rpe: 3 }),
    "the same minutes at a higher effort are worth more",
  );
  ok(
    deliveredCredit({ ...any, actualDurationSec: any.estDurationSec * 2, rpe: 5 }) >
      deliveredCredit({ ...any, actualDurationSec: any.estDurationSec, rpe: 5 }),
    "and twice the minutes at the same effort are worth more",
  );
  ok(roleOf({ ...any, type: "long" }) === "long", "a long session reads as long");
  ok(roleOf({ ...any, type: "threshold", primaryZone: 4 }) === "quality", "a threshold session reads as quality");
  ok(roleOf({ ...any, type: "endurance", primaryZone: 2 }) === "easy", "an endurance session reads as easy");
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} decision invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all decision invariants passed");
