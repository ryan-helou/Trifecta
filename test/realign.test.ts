/**
 * Realignment tests — the "falling behind" loop (Notion #108/#109).
 *
 * Two things must hold for automatic realignment to be safe to ship:
 *
 *  1. `rebuildFromToday` stamps `realignedAtISO`, so the app can tell "misses that
 *     predate the last realign" (already absorbed — they live on as `kept-` history)
 *     from "misses since then" (genuinely falling behind again).
 *
 *  2. `missedSince` counts only the latter. Without this the auto-realign would see
 *     the SAME kept- misses on every render, realign forever, and never converge —
 *     the reason this had to stay a manual button before.
 *
 * Run: `npm test`.
 */
import { ENGINE_VERSION, generatePlan } from "../lib/planEngine";
import { easeUpcoming, rebuildFromToday, missedSince, shouldUpgradePlan, weeksBanked, UPGRADE_RACE_GUARD_DAYS } from "../lib/adapt";
import type { Profile, Plan, Workout } from "../lib/types";
import { addDays, mondayOf, todayISO } from "../lib/dates";

let checks = 0;
let failures = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  ✗ " + msg);
  }
}
function section(name: string) {
  console.log("\n• " + name);
}

// A Monday in the FUTURE, never a pinned date — same rot that killed engine.test.ts and
// load.test.ts. Once the anchor is in the past `generatePlan` clamps day one to today, so
// dates counted from the anchor and dates the plan actually holds drift apart by however
// long ago it was; here that left the "completed history" window selecting nothing.
const ANCHOR = mondayOf(addDays(todayISO(), 7));
function daysFrom(n: number): string {
  const d = new Date(ANCHOR + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const base: Profile = {
  username: "test",
  raceType: "olympic",
  raceDateISO: daysFrom(16 * 7),
  level: "intermediate",
  workoutsPerWeek: 8,
  perSport: { swim: 2, bike: 3, run: 3 },
  strength: { enabled: false, daysPerWeek: 2, split: "full" },
  longSessionDay: 5,
  unitPreference: "metric",
  equipment: { pool: true, trainer: true, gym: true },
  blackouts: [],
  createdAtISO: ANCHOR + "T08:00:00.000Z",
};

const plan = generatePlan(base, ANCHOR);

// ---------------------------------------------------------------------------
section("rebuildFromToday stamps realignedAtISO");
{
  const at = daysFrom(10);
  const rebuilt = rebuildFromToday(plan, at);
  ok(rebuilt.realignedAtISO === at, `realignedAtISO === "${at}" — got ${JSON.stringify(rebuilt.realignedAtISO)}`);
  ok(plan.realignedAtISO === undefined, "the source plan is not mutated");
}

// ---------------------------------------------------------------------------
section("missedSince counts only real, actionable misses");
{
  const today = daysFrom(10);
  // everything before `today` is still "planned" — the athlete did nothing for 10 days
  const missed = missedSince(plan, today);
  ok(missed.length > 0, `a fortnight of untouched sessions counts as missed — got ${missed.length}`);
  ok(
    missed.every((w) => w.date < today),
    "never counts a session that is still in the future",
  );
  ok(
    missed.every((w) => w.discipline !== "rest"),
    "rest days are not misses",
  );
}

{
  // sessions that predate the plan itself are not the athlete's fault (a plan built
  // mid-week back-dates to Monday) — createdAtISO is the floor.
  const late: Profile = { ...base, createdAtISO: daysFrom(5) + "T08:00:00.000Z" };
  const p = generatePlan(late, ANCHOR);
  const missed = missedSince(p, daysFrom(10));
  ok(
    missed.every((w) => w.date >= daysFrom(5)),
    "sessions scheduled before the plan existed are never counted as missed",
  );
}

{
  const done: Plan = {
    ...plan,
    workouts: Object.fromEntries(
      Object.entries(plan.workouts).map(([id, w]) => [id, { ...w, status: "done" as const }]),
    ),
  };
  ok(missedSince(done, daysFrom(10)).length === 0, "a fully-completed plan has zero misses");
}

// ---------------------------------------------------------------------------
section("realigning CONVERGES — the same misses are never counted twice");
{
  const today = daysFrom(10);
  const before = missedSince(plan, today);
  ok(before.length >= 3, `precondition: enough misses to trigger a realign — got ${before.length}`);

  const rebuilt = rebuildFromToday(plan, today);
  const after = missedSince(rebuilt, today);

  // THE invariant that makes auto-realign safe: once absorbed, those misses are
  // history (`kept-` ids) and must not re-trigger. Without realignedAtISO scoping,
  // `after` still equals `before` and the app realigns on an endless loop.
  ok(
    after.length === 0,
    `immediately after a realign there is nothing left to realign — got ${after.length} (was ${before.length})`,
  );

  // and it stays converged on the following days, as long as the athlete keeps up
  const kept = {
    ...rebuilt,
    workouts: Object.fromEntries(
      Object.entries(rebuilt.workouts).map(([id, w]) => [
        id,
        w.date >= today && w.date < daysFrom(13) ? { ...w, status: "done" as const } : w,
      ]),
    ),
  };
  ok(missedSince(kept, daysFrom(13)).length === 0, "keeping up after a realign keeps the count at zero");
}

// ---------------------------------------------------------------------------
section("falling behind AGAIN after a realign re-triggers");
{
  const firstRealign = daysFrom(10);
  const rebuilt = rebuildFromToday(plan, firstRealign);
  // ...then the athlete goes quiet for another fortnight
  const later = daysFrom(24);
  const missed = missedSince(rebuilt, later);
  ok(missed.length >= 3, `new misses after the realign are counted — got ${missed.length}`);
  ok(
    missed.every((w) => w.date >= firstRealign),
    "only sessions scheduled at/after the last realign count",
  );
}

// ---------------------------------------------------------------------------
section("realign preserves completed history (invariant #18)");
{
  const today = daysFrom(10);
  const withDone: Plan = {
    ...plan,
    workouts: Object.fromEntries(
      Object.entries(plan.workouts).map(([id, w]) => [
        id,
        w.date < daysFrom(4) && w.discipline !== "rest" ? { ...w, status: "done" as const } : w,
      ]),
    ),
  };
  const doneBefore = Object.values(withDone.workouts).filter((w) => w.status === "done").length;
  const rebuilt = rebuildFromToday(withDone, today);
  const doneAfter = Object.values(rebuilt.workouts).filter((w) => w.status === "done").length;
  ok(doneBefore > 0, `precondition: some completed sessions — got ${doneBefore}`);
  ok(doneAfter === doneBefore, `every completed session survives the realign — ${doneBefore} → ${doneAfter}`);
}

// ---------------------------------------------------------------------------
section("easing reports what it actually changed");
{
  // The shell tells the athlete how many sessions it softened. That count has to be
  // real: easeUpcoming only touches HARD sessions, so an easy base week legitimately
  // changes nothing — and reporting "eased!" there is the same dead-button lie as #108.
  const countSoftened = (before: Plan, after: Plan) =>
    Object.values(after.workouts).filter((w) => w.easedCause && before.workouts[w.id]?.easedCause !== w.easedCause).length;

  const HARD = new Set(["threshold", "vo2", "tempo", "brick"]);
  // find a window that actually contains hard work (build/peak territory)
  const hardDay = Object.values(plan.workouts)
    .filter((w) => HARD.has(w.type))
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  ok(!!hardDay, "precondition: the plan contains hard sessions somewhere");

  if (hardDay) {
    const eased = easeUpcoming(plan, hardDay.date, 7);
    const n = countSoftened(plan, eased);
    ok(n > 0, `easing a window with hard work softens at least one session — got ${n}`);
    ok(
      Object.values(eased.workouts).every((w) => !w.easedCause || !HARD.has(w.type)),
      "nothing left marked eased is still a hard session type",
    );
    // idempotent: easing the same window twice softens nothing new the second time
    const again = easeUpcoming(eased, hardDay.date, 7);
    ok(countSoftened(eased, again) === 0, "re-easing the same window reports zero new changes");
  }

  // an all-easy window reports zero — the case that produced a silent no-op button
  const easyStart = plan.startDateISO;
  const noneEased = easeUpcoming(plan, easyStart, 7);
  const early = Object.values(plan.workouts).filter(
    (w) => w.date >= easyStart && w.date <= daysFrom(6) && HARD.has(w.type),
  );
  if (early.length === 0) {
    ok(countSoftened(plan, noneEased) === 0, "an all-easy week reports zero softened, not a false success");
  }
}

// ---------------------------------------------------------------------------
section("the engine upgrade knows when NOT to touch a plan");
{
  const V = ENGINE_VERSION;
  const stale = (over: Partial<Plan> = {}): Plan => ({ ...plan, engineVersion: 1, ...over });

  ok(generatePlan(base, ANCHOR).engineVersion === V, `a fresh plan is stamped v${V}`);
  ok(shouldUpgradePlan(stale(), daysFrom(10), V), "a stale plan mid-block upgrades");
  ok(shouldUpgradePlan({ ...plan, engineVersion: undefined }, daysFrom(10), V), "an UNSTAMPED plan upgrades — that is the commonest stale case");
  ok(!shouldUpgradePlan({ ...plan, engineVersion: V }, daysFrom(10), V), "a current plan is left alone (it converges)");
  ok(!shouldUpgradePlan({ ...plan, engineVersion: V + 1 }, daysFrom(10), V), "a NEWER plan is never downgraded");
  ok(!shouldUpgradePlan({ ...stale(), upgradeDeclinedVersion: V }, daysFrom(10), V), "a declined upgrade stays declined across a reload");
  ok(shouldUpgradePlan({ ...stale(), upgradeDeclinedVersion: V - 1 }, daysFrom(10), V), "declining v1 does not decline v2");

  // never mid-taper or in race week — the one case where a better plan is a worse outcome
  const half = generatePlan({ ...base, raceType: "half", raceDateISO: daysFrom(20 * 7) }, ANCHOR);
  const taperWk = half.weeks.find((w) => w.phase === "taper" && !w.isRaceWeek);
  ok(!!taperWk, "precondition: the 70.3 plan has a non-race taper week");
  if (taperWk) ok(!shouldUpgradePlan({ ...half, engineVersion: 1 }, taperWk.startDate, V), "never rebuilt during the taper");
  const raceWk = half.weeks.find((w) => w.isRaceWeek);
  if (raceWk) ok(!shouldUpgradePlan({ ...half, engineVersion: 1 }, raceWk.startDate, V), "…nor during race week");

  // …nor in the run-up, whatever phase the label claims
  const race = plan.raceDateISO;
  const before = (n: number) => { const d = new Date(race + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  ok(!shouldUpgradePlan(stale(), before(1), V), "not the day before the race");
  ok(!shouldUpgradePlan(stale(), before(UPGRADE_RACE_GUARD_DAYS - 1), V), `not ${UPGRADE_RACE_GUARD_DAYS - 1} days out`);
  ok(shouldUpgradePlan(stale(), before(UPGRADE_RACE_GUARD_DAYS + 1), V), `but yes ${UPGRADE_RACE_GUARD_DAYS + 1} days out`);

  // A race already RUN must not upgrade: regenerating on a past date collapses to a
  // zero-week plan, so the "upgrade" would delete their plan outright. Verified, not assumed.
  const after = (n: number) => { const d = new Date(race + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  ok(!shouldUpgradePlan(stale(), after(3), V), "a race three days ago does not trigger an upgrade");
  const past = generatePlan({ ...base, raceDateISO: daysFrom(-3) }, ANCHOR);
  ok(past.weeks.length === 0, `regenerating on a past race date really does collapse to nothing (${past.weeks.length} weeks) — which is what that guard prevents shipping`);

  // and the upgrade keeps history, exactly as a realign does
  const done: Plan = { ...stale(), workouts: Object.fromEntries(Object.entries(plan.workouts).map(([id, w]) =>
    [id, w.date < daysFrom(5) && w.discipline !== "rest" ? { ...w, status: "done" as const } : w])) };
  const n0 = Object.values(done.workouts).filter((w) => w.status === "done").length;
  ok(n0 > 0, `precondition: completed sessions exist (${n0})`);
  ok(Object.values(rebuildFromToday(done, daysFrom(10)).workouts).filter((w) => w.status === "done").length === n0,
     "an upgrade keeps every completed session");
}

// ---------------------------------------------------------------------------
// A rebuild must not throw the athlete back to the start of the arc.
//
// `generatePlan` only ever saw the runway REMAINING, so it laid base first: an athlete ten
// weeks into their block who realigned (or saved a setting, or got the engine upgrade) was
// handed a fresh base week one and lost every quality session for a fortnight. Ryan, ten
// weeks in and looking at his own phone: "i dont see any high intensity workouts now its
// the same plan just aerobic and endurance runs/bikes."
//
// Measured on emitted sessions, not on phase labels — a label can say "build" while the
// week prescribes nothing above Z2, which is precisely how this survived review.
{
  section("rebuild keeps the athlete's place in the arc");

  const WEEKS_IN = 10;
  const started = addDays(ANCHOR, -7 * WEEKS_IN);
  const p0 = generatePlan({ ...base, raceDateISO: addDays(ANCHOR, 7 * WEEKS_IN) }, started);
  // shift the plan back so "today" (ANCHOR) really is ten weeks into it
  const shifted: Plan = {
    ...p0,
    weeks: p0.weeks.map((w) => ({ ...w, startDate: addDays(w.startDate, -7 * WEEKS_IN) })),
    workouts: Object.fromEntries(Object.entries(p0.workouts).map(([id, w]) =>
      [id, { ...w, date: addDays(w.date, -7 * WEEKS_IN) }])),
  };

  // mark the past at a given adherence, then rebuild
  const rebuiltAt = (adherence: number) => {
    let n = 0;
    const marked: Plan = { ...shifted, workouts: Object.fromEntries(Object.entries(shifted.workouts).map(([id, w]): [string, Workout] =>
      [id, w.date < ANCHOR && w.discipline !== "rest"
        ? { ...w, status: (n++ % 100) < adherence * 100 ? ("done" as const) : ("skipped" as const) }
        : w])) };
    return rebuildFromToday(marked, ANCHOR);
  };
  const hardWeeks = (pl: Plan) => pl.weeks.map((w) =>
    w.workoutIds.map((i) => pl.workouts[i]).filter((x) => x && (x.primaryZone ?? 0) >= 3).length);

  const kept = rebuiltAt(1);
  const h = hardWeeks(kept);
  ok(h[0] > 0, `a compliant athlete's very next week still has quality (${h[0]} sessions at Z3+)`);
  ok(h.slice(0, 4).every((n) => n > 0) || h.slice(0, 4).filter((n) => n > 0).length >= 3,
     `and it doesn't dry up straight after (first four weeks: ${h.slice(0, 4).join(", ")})`);
  ok(kept.weeks[0].phase !== "base" || kept.weeks.filter((w) => w.phase === "base").length <= 2,
     `they are not dropped back into a full base block (${kept.weeks.filter((w) => w.phase === "base").length} base weeks left)`);

  // …but someone who did none of it HASN'T banked that base, and must not be
  // fast-forwarded into build on the strength of the calendar alone (doc 03 §4).
  const lapsed = rebuiltAt(0);
  ok(lapsed.weeks.filter((w) => w.phase === "base").length > kept.weeks.filter((w) => w.phase === "base").length,
     "an athlete who missed the whole block restarts more base than one who did it all");
  ok(lapsed.weeks[0].phase === "base", "and begins in base, not build");

  // the taper belongs to the block, not to whatever runway was left at rebuild time
  const fresh = generatePlan({ ...base, raceDateISO: addDays(ANCHOR, 7 * WEEKS_IN) }, started);
  ok(kept.weeks.filter((w) => w.phase === "taper").length === fresh.weeks.filter((w) => w.phase === "taper").length,
     `rebuilding mid-block doesn't shrink the taper (${kept.weeks.filter((w) => w.phase === "taper").length}w vs ${fresh.weeks.filter((w) => w.phase === "taper").length}w)`);

  // and it still lands on race day
  ok(kept.weeks[kept.weeks.length - 1].isRaceWeek, "the rebuilt plan still ends on race week");

  // THE PRODUCTION CASE: rebuilding is not a one-off. A rebuild rewrites the week grid to
  // start today, so a second rebuild that read `weeks[0].startDate` would see zero elapsed
  // weeks and send the athlete back to base after all — undoing this fix on the next
  // settings save. The elapsed span is read from the kept history instead, which keeps its
  // original dates, so it survives any number of rebuilds.
  ok(weeksBanked(kept, ANCHOR) >= WEEKS_IN - 1,
     `a plan that has ALREADY been rebuilt still remembers the block start (${weeksBanked(kept, ANCHOR)} of ${WEEKS_IN} weeks banked)`);
  const twice = rebuildFromToday(kept, ANCHOR);
  const h2 = hardWeeks(twice);
  ok(h2[0] > 0, `and rebuilding a second time keeps the quality (${h2[0]} at Z3+ in week 1)`);
  ok(twice.weeks.filter((w) => w.phase === "base").length === kept.weeks.filter((w) => w.phase === "base").length,
     "a second rebuild is a fixed point — the arc doesn't creep");
}

console.log(`\n${checks - failures}/${checks} realign invariants passed`);
if (failures > 0) {
  console.error(`\n❌ ${failures} realign invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all realign invariants passed");
