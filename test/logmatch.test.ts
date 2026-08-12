// ---------------------------------------------------------------------------
// Logging a workout has to tick off the session you ACTUALLY did (lib/adapt.ts
// `logWorkout` → `bestMatch`).
//
// A day can hold two sessions of one sport — the engine emits same-day doubles and
// the workout ids carry a `-seq` for exactly that case. The match used to be
// `sameDay.find(...)`, i.e. whichever came first in the workout map. So a Tuesday
// holding an easy 30 min run and a 60 min interval session credited the EASY run
// with the intervals' numbers, and left the quality session on the books still
// owed — the athlete has to SKIP the work they just did to clear it. Nothing about
// that outcome was visible; it just depended on map order.
//
// The fixtures here are hand-built rather than generated, because the whole point
// is a shape (two same-sport sessions, one day) that a generated week only
// sometimes contains.
//
// Pure, no clock, no I/O. Run: npx tsx test/logmatch.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { logWorkout } from "../lib/adapt";
import type { Plan, Profile, Workout, Zone } from "../lib/types";

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
const profile = () =>
  ({
    username: "test", raceType: "olympic", raceDateISO: addDays(ANCHOR, 16 * 7),
    level: "intermediate", workoutsPerWeek: 6, createdAtISO: ANCHOR,
  }) as Profile;

/** A plan whose Tuesday holds exactly two runs: an easy short one and a hard long one.
 *  `order` decides which is written into the map first — the bug was that this mattered. */
function twoRunDay(order: "easy-first" | "hard-first"): { plan: Plan; day: string; easy: string; hard: string } {
  const base = generatePlan(profile(), ANCHOR);
  const day = addDays(base.weeks[2].startDate, 1);
  const mk = (id: string, min: number, zone: Zone, title: string): Workout => ({
    id,
    date: day,
    weekIndex: base.weeks[2].index,
    dayIndex: 1,
    discipline: "run",
    type: zone >= 4 ? "threshold" : "endurance",
    title,
    purpose: "fixture",
    segments: [{ kind: "main", discipline: "run", zone, durationSec: min * 60, description: title }],
    estDurationSec: min * 60,
    primaryZone: zone,
    status: "planned",
  });
  const easy = mk("w-2-1-run", 30, 2, "Easy Run");
  const hard = mk("w-2-1-run-2", 60, 4, "Threshold Intervals");

  // Everything else that day is cleared, so the only ambiguity is the one under test.
  const workouts = Object.fromEntries(
    Object.entries(base.workouts).filter(([, w]) => w.date !== day),
  );
  const pair = order === "easy-first" ? [easy, hard] : [hard, easy];
  for (const w of pair) workouts[w.id] = w;

  const plan: Plan = {
    ...base,
    workouts,
    weeks: base.weeks.map((wk) =>
      wk.index === base.weeks[2].index
        ? { ...wk, workoutIds: [...wk.workoutIds.filter((id) => !!workouts[id]), ...pair.map((w) => w.id)] }
        : wk,
    ),
  };
  return { plan, day, easy: easy.id, hard: hard.id };
}

// --- 1. the reported shape: hard work must not tick off the easy session ----
section("logging the hard session credits the hard session");
for (const order of ["easy-first", "hard-first"] as const) {
  const { plan, day, easy, hard } = twoRunDay(order);
  // 60 minutes at RPE 8 — that is the interval session, by any reading.
  const res = logWorkout(plan, { dateISO: day, discipline: "run", durationSec: 60 * 60, rpe: 8 });

  ok(res.matchedId === hard, `[${order}] the 60 min hard run ticks off Threshold Intervals (got ${res.matchedId})`);
  ok(res.plan.workouts[hard].status === "done", `[${order}] and that session is complete`);
  ok(
    res.plan.workouts[easy].status === "planned",
    `[${order}] while the easy run is left alone — it hasn't been done`,
  );
}

// --- 2. and the mirror: easy work takes the easy session --------------------
section("logging the easy session credits the easy session");
for (const order of ["easy-first", "hard-first"] as const) {
  const { plan, day, easy, hard } = twoRunDay(order);
  const res = logWorkout(plan, { dateISO: day, discipline: "run", durationSec: 30 * 60, rpe: 2 });

  ok(res.matchedId === easy, `[${order}] the 30 min easy run ticks off Easy Run (got ${res.matchedId})`);
  ok(res.plan.workouts[hard].status === "planned", `[${order}] the intervals stay on the books`);
}

// --- 3. map order must not decide anything ----------------------------------
section("the answer does not depend on the order sessions sit in the map");
{
  const a = twoRunDay("easy-first");
  const b = twoRunDay("hard-first");
  const logged = { dateISO: a.day, discipline: "run" as const, durationSec: 55 * 60, rpe: 7 };
  const ra = logWorkout(a.plan, logged);
  const rb = logWorkout(b.plan, logged);

  ok(ra.matchedId === rb.matchedId, `same log, same answer either way (${ra.matchedId} vs ${rb.matchedId})`);
  ok(ra.outcome === rb.outcome, `and the same outcome (${ra.outcome} vs ${rb.outcome})`);
}

// --- 4. with no effort reported, length is the only honest signal -----------
section("without an RPE it matches on duration rather than assuming easy");
{
  const { plan, day, hard } = twoRunDay("easy-first");
  // No rpe. A silent log must not be read as "easy" — that would hand every
  // untagged session to the easiest thing on the day.
  const res = logWorkout(plan, { dateISO: day, discipline: "run", durationSec: 58 * 60 });

  ok(res.matchedId === hard, `a 58 min run with no RPE matches the 60 min session (got ${res.matchedId})`);
}

// --- 5. the ordinary single-session day is untouched ------------------------
section("a day with one session of that sport behaves exactly as before");
{
  const base = generatePlan(profile(), ANCHOR);
  const week = base.weeks[2];
  const solo = week.workoutIds
    .map((id) => base.workouts[id]!)
    .find((w) => {
      if (w.discipline === "rest" || w.status !== "planned") return false;
      const sameDaySameSport = week.workoutIds
        .map((id) => base.workouts[id]!)
        .filter((x) => x.date === w.date && x.discipline === w.discipline);
      return sameDaySameSport.length === 1;
    })!;

  const res = logWorkout(base, {
    dateISO: solo.date,
    discipline: solo.discipline,
    durationSec: solo.estDurationSec,
  });
  ok(res.matchedId === solo.id, `${solo.title} is still the session that gets ticked`);
  ok(res.outcome === "ticked", "and doing it as prescribed still reads as ticked off");
}

// --- 6. what the athlete WROTE survives into the log ------------------------
section("a note written on an endurance log becomes what the session is called");
{
  const base = generatePlan(profile(), ANCHOR);
  const week = base.weeks[2];
  const run = week.workoutIds.map((id) => base.workouts[id]!).find((w) => w.discipline === "run" && w.status === "planned")!;

  // A ride on a day that held a RUN is a bonus, not a swap — same-sport-only is the
  // documented rule (#215: "a ride never rewrites a run, in either direction"). Worth
  // asserting, because it is the reason the swap branch below `bestMatch` is currently
  // unreachable, and someone will eventually read that branch as live behaviour.
  const res = logWorkout(base, {
    dateISO: run.date,
    discipline: "bike",
    durationSec: 45 * 60,
    note: "hilly trail loop",
  });

  ok(res.outcome === "bonus", `a ride on a run day is extra work, not a substitution (got ${res.outcome})`);
  ok(res.plan.workouts[run.id].status === "planned", "and the run it did not do is untouched");

  const logged = res.plan.workouts[res.loggedId!];
  ok(
    logged.title === "hilly trail loop · bike",
    `the log is called what the athlete called it (got "${logged.title}") — "Logged bike" tells them nothing`,
  );
  ok(logged.note === "hilly trail loop", "and the note is kept as written");
}

// --- 7. no note is still fine ----------------------------------------------
section("a log with nothing written falls back to naming the sport");
{
  const base = generatePlan(profile(), ANCHOR);
  const week = base.weeks[2];
  const run = week.workoutIds.map((id) => base.workouts[id]!).find((w) => w.discipline === "run" && w.status === "planned")!;
  const res = logWorkout(base, { dateISO: run.date, discipline: "bike", durationSec: 45 * 60 });
  const logged = res.plan.workouts[res.loggedId!];

  ok(logged.title === "Logged bike", `unchanged when nothing was written (got "${logged.title}")`);
  ok(logged.note === undefined, "and no empty note is stored");
}

console.log(`\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
