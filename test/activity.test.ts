// ---------------------------------------------------------------------------
// Activity ingest (lib/activity.ts) — the path that turns a synced workout into
// a completed session.
//
// Ticket #123, reported by a real athlete: "the Trifecta app is adding the same
// training multiple times… today it added my run 4 times… so it looks like i did
// 20km". Four bonus sessions, four times the load.
//
// Two guards were supposed to prevent that and both had the same blind spot:
//   - the carrier check matches on activityId, so it only catches a REPEAT of the
//     exact same id
//   - duplicateActivity explicitly skipped same-source pairs
//     (`if (ac.source === x.source) return false`)
// so one feed re-delivering one activity under a changed id fell through both,
// and addBonusWorkout's `-2`/`-3`/`-4` collision loop dutifully made a new
// session each time.
//
// The fix has to close that without eating genuine same-day doubles — an AM and a
// PM run are two real sessions. Start time is what separates them: a re-delivery
// has the same start, a genuine double is hours away. Both directions are tested.
//
// Pure, no clock, no I/O. Run: npx tsx test/activity.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { applyActivityToPlan, dedupeSyncedSessions, duplicateActivity } from "../lib/activity";
import type { Activity } from "../lib/activity";
import type { Plan, Profile } from "../lib/types";

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
    username: "test", raceType: "olympic", raceDateISO: weeksFrom(16),
    level: "intermediate", workoutsPerWeek: 6, createdAtISO: ANCHOR, ...over,
  } as Profile;
}

/** A day with nothing scheduled, so every activity below takes the BONUS path —
 *  which is the path that was duplicating. */
function restDay(plan: Plan): string {
  const busy = new Set(Object.values(plan.workouts).filter((w) => w.discipline !== "rest").map((w) => w.date));
  for (let i = 1; i < 40; i++) {
    const d = new Date(ANCHOR + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    if (!busy.has(iso)) return iso;
  }
  throw new Error("no free day");
}

const plan0 = generatePlan(profile(), ANCHOR);
const DAY = restDay(plan0);

function act(over: Partial<Activity> = {}): Activity {
  return {
    source: "healthkit",
    id: "hk-1",
    discipline: "run",
    localDay: DAY,
    startISO: `${DAY}T07:00:00.000Z`,
    durationSec: 1800,
    distanceM: 5000,
    name: "Morning Run",
    ...over,
  } as Activity;
}

const runsOn = (p: Plan, day: string) =>
  Object.values(p.workouts).filter((w) => w.date === day && w.discipline === "run");

// --- 1. THE BUG: one feed, one run, a changed id ----------------------------
section("one activity re-delivered under a new id is not a second session");
{
  let p = plan0;
  // the same physical run, arriving four times, with the id shifting each read
  for (const id of ["hk-1", "hk-1-again", "run-2026", "abc123"]) {
    const res = applyActivityToPlan(p, act({ id }));
    if (res) p = res.plan;
  }
  const runs = runsOn(p, DAY);
  ok(runs.length === 1, `one run logged, not ${runs.length} (this is #123 — the athlete saw 4)`);
  const totalM = runs.reduce((a, w) => a + (w.actualDistanceM ?? 0), 0);
  ok(totalM === 5000, `distance stays 5 km, not ${(totalM / 1000).toFixed(1)} km`);
}
{
  // the same id twice is the case that already worked — keep it working
  let p = plan0;
  for (let i = 0; i < 3; i++) {
    const res = applyActivityToPlan(p, act());
    if (res) p = res.plan;
  }
  ok(runsOn(p, DAY).length === 1, "the identical-id repeat is still a no-op");
}

// --- 2. genuine same-day doubles must survive -------------------------------
section("a real AM/PM double is still two sessions");
{
  let p = plan0;
  const am = applyActivityToPlan(p, act({ id: "am", startISO: `${DAY}T07:00:00.000Z` }));
  if (am) p = am.plan;
  const pm = applyActivityToPlan(p, act({ id: "pm", startISO: `${DAY}T18:00:00.000Z` }));
  if (pm) p = pm.plan;
  ok(runsOn(p, DAY).length === 2, `two genuinely separate runs stay two (got ${runsOn(p, DAY).length})`);
}
{
  // different sports on one day are never confused for each other
  let p = plan0;
  for (const [id, discipline] of [["r", "run"], ["b", "bike"], ["s", "swim"]] as const) {
    const res = applyActivityToPlan(p, act({ id, discipline, startISO: `${DAY}T07:00:00.000Z` }));
    if (res) p = res.plan;
  }
  const onDay = Object.values(p.workouts).filter((w) => w.date === DAY && w.discipline !== "rest");
  ok(onDay.length === 3, `three different sports stay three sessions (got ${onDay.length})`);
}

// --- 3. cross-source dedup still works (the original purpose) ---------------
section("Strava and Apple Health reporting one run is still one session");
{
  let p = plan0;
  const a = applyActivityToPlan(p, act({ source: "strava", id: 99, startISO: `${DAY}T07:00:00.000Z` }));
  if (a) p = a.plan;
  const b = applyActivityToPlan(p, act({ source: "healthkit", id: "hk-x", startISO: `${DAY}T07:05:00.000Z` }));
  if (b) p = b.plan;
  ok(runsOn(p, DAY).length === 1, `one run across two feeds (got ${runsOn(p, DAY).length})`);
}
{
  // and the predicate itself reports the same-source case now
  let p = plan0;
  const res = applyActivityToPlan(p, act({ id: "first" }));
  if (res) p = res.plan;
  ok(
    duplicateActivity(p, { source: "healthkit", discipline: "run", localDay: DAY, startISO: `${DAY}T07:02:00.000Z`, durationSec: 1800 }),
    "a same-source re-delivery within minutes is reported as a duplicate",
  );
  ok(
    !duplicateActivity(p, { source: "healthkit", discipline: "run", localDay: DAY, startISO: `${DAY}T18:00:00.000Z`, durationSec: 1800 }),
    "a same-source run eleven hours later is NOT a duplicate",
  );
}

// --- 4. the load ledger is what makes this expensive now --------------------
section("duplicates would inflate the load the plan now prescribes from");
{
  let p = plan0;
  for (const id of ["a", "b", "c", "d"]) {
    const res = applyActivityToPlan(p, act({ id }));
    if (res) p = res.plan;
  }
  const secs = runsOn(p, DAY).reduce((a, w) => a + (w.actualDurationSec ?? 0), 0);
  ok(secs === 1800, `credited seconds stay 1800, not ${secs} — inflated load would drag TSB down and trigger an unearned ease`);
}

// --- 5. healing the athletes already carrying duplicates --------------------
section("dedupeSyncedSessions repairs a plan that is already wrong");
{
  // Rebuild exactly what the reporter is carrying. Built by hand, not through
  // applyActivityToPlan — the guard above now refuses to create this, which is the
  // point, so the damaged state has to be constructed directly.
  const dupIds = ["synced-x-run", "synced-x-run-2", "synced-x-run-3", "synced-x-run-4"];
  const damaged: Plan = { ...plan0, workouts: { ...plan0.workouts }, weeks: plan0.weeks.map((w) => ({ ...w, workoutIds: [...w.workoutIds] })) };
  for (const id of dupIds) {
    damaged.workouts[id] = {
      id, date: DAY, weekIndex: 0, dayIndex: 0, discipline: "run", type: "endurance",
      title: "Morning Run", purpose: "Synced from your connected device.", segments: [],
      estDurationSec: 1800, estDistanceM: 5000, primaryZone: 2, status: "done",
      actualDurationSec: 1800, actualDistanceM: 5000,
      actuals: { source: "healthkit", activityId: id, durationSec: 1800, distanceM: 5000, startedAtISO: `${DAY}T07:00:00.000Z` },
    } as unknown as Plan["workouts"][string];
  }
  const p = damaged;
  const before = runsOn(p, DAY).length;
  ok(before === 4, `set up a damaged plan with ${before} copies (the reporter saw 4)`);

  const healed = dedupeSyncedSessions(p);
  ok(healed.removed === before - 1, `removed ${healed.removed} phantoms, keeping one (of ${before})`);
  ok(runsOn(healed.plan, DAY).length === 1, "one run survives");
  const km = runsOn(healed.plan, DAY).reduce((a, w) => a + (w.actualDistanceM ?? 0), 0) / 1000;
  ok(km === 5, `back to ${km} km, not 20`);
  // and the removed ids are gone from the week index too, not just the map
  const referenced = healed.plan.weeks.flatMap((w) => w.workoutIds);
  ok(referenced.every((id) => !!healed.plan.workouts[id]), "no week references a workout that was removed");
}
{
  const clean = dedupeSyncedSessions(plan0);
  ok(clean.removed === 0 && clean.plan === plan0, "a healthy plan is returned untouched, same object");
}
{
  // it must NEVER touch planned or hand-logged sessions
  const planned = Object.values(plan0.workouts).filter((w) => w.discipline !== "rest").length;
  const healed = dedupeSyncedSessions(plan0);
  ok(
    Object.values(healed.plan.workouts).filter((w) => w.discipline !== "rest").length === planned,
    "no planned session is ever removed",
  );
}
{
  // a genuine AM/PM double must survive the repair
  let p = plan0;
  for (const [id, hh] of [["am", "07"], ["pm", "18"]] as const) {
    const res = applyActivityToPlan(p, act({ id, startISO: `${DAY}T${hh}:00:00.000Z` }));
    if (res) p = res.plan;
  }
  ok(dedupeSyncedSessions(p).removed === 0, "two real sessions hours apart are never merged by the repair");
}

// --- 5. degenerate ----------------------------------------------------------
section("never throws on degenerate input");
{
  let threw = false;
  try {
    ok(applyActivityToPlan(plan0, act({ discipline: undefined })) === null, "an activity with no discipline is ignored");
    applyActivityToPlan({ ...plan0, workouts: {} }, act());
    duplicateActivity({ ...plan0, workouts: {} }, { source: "strava", discipline: "run", localDay: DAY, durationSec: 100 });
    applyActivityToPlan(plan0, act({ startISO: undefined }));
  } catch {
    threw = true;
  }
  ok(!threw, "missing fields and empty plans never throw");
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} activity-ingest invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all activity-ingest invariants passed");
