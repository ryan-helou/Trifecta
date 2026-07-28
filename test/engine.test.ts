/**
 * Trifecta plan-engine invariant tests — the "is the plan actually correct/safe" gate.
 *
 * Pure + deterministic (no simulator, no network). Run: `npm test`.
 *
 * These assert the safety + physiology properties a human coach eyeballs when they glance
 * at a plan and go "yeah, that's sane": plans are non-degenerate, honor the requested
 * frequency, ramp load safely (with deloads), taper before the race, progress through the
 * phases in order, and keep intensity polarized (mostly easy). Thresholds are calibrated
 * to the engine's real output with margin, so a correct plan never false-fails.
 */
import { generatePlan, MAX_WORKOUTS, MIN_WORKOUTS, clampWorkouts } from "../lib/planEngine";
import type { Profile, Plan, Injury } from "../lib/types";

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

const ANCHOR = "2026-08-03"; // a Monday
function weeksFrom(w: number): string {
  const d = new Date(ANCHOR + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + w * 7);
  return d.toISOString().slice(0, 10);
}
function profile(over: Partial<Profile>): Profile {
  return {
    username: "test",
    raceType: "olympic",
    raceDateISO: weeksFrom(16),
    level: "intermediate",
    workoutsPerWeek: 6,
    createdAtISO: ANCHOR,
    ...over,
  };
}
const totalSec = (p: Plan) => Object.values(p.workouts).reduce((s, w) => s + (w.estDurationSec || 0), 0);
const PHASE_ORDER: Record<string, number> = { base: 0, build: 1, peak: 2, taper: 3 };

const CASES: { name: string; p: Profile; race: boolean }[] = [
  { name: "fitness/intermediate/6", p: profile({ raceType: "fitness", raceDateISO: "" }), race: false },
  { name: "olympic/beginner/5", p: profile({ raceType: "olympic", level: "beginner", workoutsPerWeek: 5, raceDateISO: weeksFrom(14) }), race: true },
  { name: "half/intermediate/6", p: profile({ raceType: "half", workoutsPerWeek: 6, raceDateISO: weeksFrom(20) }), race: true },
  { name: "full/advanced/10", p: profile({ raceType: "full", level: "advanced", workoutsPerWeek: 10, raceDateISO: weeksFrom(24) }), race: true },
];

// ---- 1. determinism ----
section("deterministic: identical input → identical plan");
{
  const a = generatePlan(profile({}), ANCHOR);
  const b = generatePlan(profile({}), ANCHOR);
  ok(Object.keys(a.workouts).length === Object.keys(b.workouts).length, "same workout count");
  ok(totalSec(a) === totalSec(b), "same total duration");
  ok(JSON.stringify(a.weeks.map((w) => w.targetHours)) === JSON.stringify(b.weeks.map((w) => w.targetHours)), "same weekly hours");
}

// ---- 2. non-degenerate + frequency + polarized, every case ----
for (const c of CASES) {
  section("case: " + c.name);
  const plan = generatePlan(c.p, ANCHOR);
  const ws = Object.values(plan.workouts);
  ok(plan.weeks.length >= 1, "has ≥1 week");
  ok(ws.length >= 1, "has ≥1 workout");
  ok(ws.every((w) => w.estDurationSec > 0), "every workout has positive duration");
  ok(ws.every((w) => (w.estDistanceM ?? 0) >= 0), "no negative distances");
  ok(ws.every((w) => [1, 2, 3, 4, 5].includes(w.primaryZone)), "every workout has a valid zone (1–5)");

  // frequency: never over-schedule the requested count; and actually deliver it some weeks
  const counts = plan.weeks.map((w) => w.workoutIds.length);
  ok(counts.every((n) => n <= c.p.workoutsPerWeek), `never exceeds requested ${c.p.workoutsPerWeek}/wk`);
  ok(counts.every((n) => n <= MAX_WORKOUTS), "never exceeds MAX_WORKOUTS");
  ok(counts.some((n) => n === c.p.workoutsPerWeek), `hits the requested ${c.p.workoutsPerWeek}/wk on some week`);

  // polarized intensity: most real (non-rest/strength) sessions are easy (Z1–Z2)
  const endurance = ws.filter((w) => w.discipline !== "rest" && w.discipline !== "strength");
  if (endurance.length) {
    const easy = endurance.filter((w) => w.primaryZone <= 2).length;
    ok(easy / endurance.length >= 0.5, `≥50% easy (Z1–Z2); got ${((100 * easy) / endurance.length).toFixed(0)}%`);
  }
}

// ---- 3. safe load ramp + deloads (race plans, which periodize) ----
for (const c of CASES.filter((x) => x.race)) {
  section("safe ramp + deloads: " + c.name);
  const plan = generatePlan(c.p, ANCHOR);
  // walk only NON-recovery weeks so a deload-then-rebuild bounce isn't mistaken for a spike
  const build = plan.weeks.filter((w) => !w.isRecovery && !w.isRaceWeek).map((w) => w.targetHours);
  let maxJump = 1;
  for (let i = 1; i < build.length; i++) if (build[i - 1] > 0) maxJump = Math.max(maxJump, build[i] / build[i - 1]);
  ok(maxJump <= 1.35, `no >35% week-over-week volume spike between load weeks (max ${((maxJump - 1) * 100).toFixed(0)}%)`);
  ok(plan.weeks.some((w) => w.isRecovery), "includes recovery/deload weeks");
}

// ---- 4. taper + race week + phase order (race plans) ----
for (const c of CASES.filter((x) => x.race)) {
  section("taper + periodization: " + c.name);
  const plan = generatePlan(c.p, ANCHOR);
  const last = plan.weeks[plan.weeks.length - 1];
  const raceWeek = plan.weeks.find((w) => w.isRaceWeek);
  const peak = Math.max(...plan.weeks.map((w) => w.targetHours));
  ok(!!raceWeek, "has a race week");
  ok(last.isRaceWeek, "race week is the LAST week");
  ok(!!raceWeek && raceWeek.targetHours < peak, "race-week volume is below peak (taper)");
  ok(plan.weeks.some((w) => w.phase === "taper"), "has a taper phase");
  // phases only ever advance base → build → peak → taper (never regress)
  const idxs = plan.weeks.map((w) => PHASE_ORDER[w.phase]);
  ok(idxs.every((v, i) => i === 0 || v >= idxs[i - 1]), "phases progress in order, never regress");
}

// ---- 5. injuries reduce load on the affected sport ----
section("injuries: a run niggle reduces run volume vs the same athlete uninjured");
{
  const kneeInjury: Injury = { id: "inj1", area: "left knee", disciplines: ["run"], severity: "moderate" };
  const base = generatePlan(profile({ raceType: "half", raceDateISO: weeksFrom(20) }), ANCHOR);
  const hurt = generatePlan(profile({ raceType: "half", raceDateISO: weeksFrom(20), injuries: [kneeInjury] }), ANCHOR);
  const runSec = (p: Plan) => Object.values(p.workouts).filter((w) => w.discipline === "run").reduce((s, w) => s + w.estDurationSec, 0);
  ok(runSec(hurt) < runSec(base), `injured run volume (${Math.round(runSec(hurt) / 60)}m) < healthy (${Math.round(runSec(base) / 60)}m)`);
}

// ---- 6. clampWorkouts edge cases (regression: clampWorkouts(0) returned 6) ----
section("clampWorkouts edge cases");
{
  ok(clampWorkouts(0) === MIN_WORKOUTS, `clampWorkouts(0) clamps to ${MIN_WORKOUTS}, not 6`);
  ok(clampWorkouts(undefined) === 6, "clampWorkouts(undefined) defaults to 6");
  ok(clampWorkouts(-3) === MIN_WORKOUTS, "clampWorkouts(-3) clamps to MIN");
  ok(clampWorkouts(100) === MAX_WORKOUTS, "clampWorkouts(100) clamps to MAX");
  ok(clampWorkouts(6) === 6, "clampWorkouts(6) stays 6");
}

// ---- 7. a race sooner than the minimum span never back-dates the start ----
section("compressed plan: start is never back-dated into the past");
{
  const soon = generatePlan(profile({ raceType: "olympic", raceDateISO: weeksFrom(2) }), ANCHOR); // race ~2 wk out
  ok(soon.weeks[0].startDate >= weeksFrom(-1), `first week not back-dated (start ${soon.weeks[0].startDate}, anchor ${ANCHOR})`);
  ok(soon.weeks[soon.weeks.length - 1].isRaceWeek, "race still lands in the last week");
}

// ---- 9. weeklyHoursCap is a HARD ceiling on emitted work ----
// Regression: the cap only limited the notional target. Fixed sessions were built at
// their intrinsic durations and the minMin floor re-inflated the scalables, so a 3 h
// cap with 8 sessions emitted a 6 h week — double what the athlete asked for, while
// the AI coach prompt asserted the cap was being honoured.
section("weeklyHoursCap: no week ever exceeds an explicit cap");
{
  const sweep: { sessions: number; cap: number; over?: Partial<Profile> }[] = [
    { sessions: 6, cap: 6 },
    { sessions: 10, cap: 6 },
    { sessions: 12, cap: 6 },
    { sessions: 10, cap: 4 },
    { sessions: 8, cap: 3 },
    { sessions: 14, cap: 8, over: { raceType: "full", level: "advanced", raceDateISO: weeksFrom(24) } },
  ];
  for (const { sessions, cap, over } of sweep) {
    const p = generatePlan(profile({ workoutsPerWeek: sessions, weeklyHoursCap: cap, ...over }), ANCHOR);
    let worst = 0;
    for (const w of p.weeks) {
      if (w.isRaceWeek) continue; // the race itself is not "training hours"
      const hrs = w.workoutIds.reduce((a, id) => a + (p.workouts[id]?.estDurationSec ?? 0), 0) / 3600;
      worst = Math.max(worst, hrs);
    }
    ok(worst <= cap + 0.01, `${sessions} sessions @ ${cap}h cap → worst week ${worst.toFixed(2)}h`);
  }
  // and with no cap set, nothing changes (the enforcement must be opt-in)
  const uncapped = generatePlan(profile({ workoutsPerWeek: 10 }), ANCHOR);
  ok(Object.keys(uncapped.workouts).length > 0, "no cap set → plan still generates normally");
}

// ---- 10. a niggling sport never ABSORBS freed volume ----
// Regression: the "healthy" filter was `volMult >= 0.85`, but a niggle sets volMult to
// exactly 0.85 — so a complaining sport qualified as healthy and soaked up the sessions
// freed from worse-injured sports. A shin niggle DOUBLED that athlete's runs.
section("injuries: a niggling sport never absorbs volume freed from other sports");
{
  const runCount = (p: Plan) =>
    Object.values(p.workouts).filter((w) => w.discipline === "run").length;
  const healthy = generatePlan(profile({ raceType: "half", raceDateISO: weeksFrom(20), workoutsPerWeek: 9 }), ANCHOR);
  const multi = generatePlan(
    profile({
      raceType: "half",
      raceDateISO: weeksFrom(20),
      workoutsPerWeek: 9,
      injuries: [
        { id: "i1", area: "left shoulder", disciplines: ["swim"], severity: "severe" },
        { id: "i2", area: "left knee", disciplines: ["bike"], severity: "moderate" },
        { id: "i3", area: "right shin", disciplines: ["run"], severity: "niggle" },
      ],
    }),
    ANCHOR,
  );
  ok(
    runCount(multi) <= runCount(healthy),
    `niggling run volume (${runCount(multi)} sessions) never exceeds uninjured (${runCount(healthy)})`,
  );
}

// ---- 11. race week honours injuries + equipment ----
// Regression: buildRaceWeek consulted neither, so an athlete whose plan had avoided
// running all block was handed a Z4 threshold run six days out, and a pool-less
// athlete was given a swim.
section("race week respects injury caps and equipment");
{
  // ANCHOR is a Monday, so a race on weeksFrom(n) is ALSO a Monday — raceDayIndex 0,
  // which skips every opener and would make these assertions pass vacuously. Race on
  // the Sunday so the Tue/Wed/Thu openers genuinely exist.
  const sunday = (n: number) => {
    const d = new Date(weeksFrom(n) + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  };
  const openersOf = (p: Plan) => {
    const rw = p.weeks[p.weeks.length - 1];
    return rw.workoutIds.map((id) => p.workouts[id]).filter((w) => w.type === "race_prep");
  };

  const healthy = generatePlan(profile({ raceType: "olympic", raceDateISO: sunday(12) }), ANCHOR);
  ok(openersOf(healthy).length > 0, `healthy athlete still gets race-week openers (${openersOf(healthy).length})`);

  const hurt = generatePlan(
    profile({
      raceType: "olympic",
      raceDateISO: sunday(12),
      injuries: [{ id: "i1", area: "right achilles", disciplines: ["run"], severity: "severe" }],
      equipment: { pool: false, trainer: true, gym: true },
    }),
    ANCHOR,
  );
  const o = openersOf(hurt);
  ok(!o.some((w) => w.discipline === "run"), "no run opener for a severe run injury (avoid)");
  ok(!o.some((w) => w.discipline === "swim"), "no swim opener when the athlete has no pool");
  ok(o.every((w) => w.primaryZone <= 3), "race-week openers stay out of Z4+ when the sport is capped");
}

// ---- 12. the taper is monotonically easier ----
// The historical non-monotone full-IM taper (0.42 → 0.55 → 0.32) slipped past the ramp
// check by 2 points. Assert the property directly so it can never regress.
section("taper target hours never rise week over week");
{
  for (const c of CASES.filter((c) => c.race)) {
    const p = generatePlan(c.p, ANCHOR);
    const taper = p.weeks.filter((w) => w.phase === "taper");
    let monotone = true;
    for (let i = 1; i < taper.length; i++) if (taper[i].targetHours > taper[i - 1].targetHours) monotone = false;
    ok(monotone, `${c.name}: taper hours non-increasing (${taper.map((w) => w.targetHours).join(" → ")})`);
  }
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures > 0) {
  console.error(`\n❌ ${failures} engine invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all engine invariants passed");
