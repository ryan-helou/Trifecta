/**
 * Why-line invariant tests — "the only coach that shows its work" gate.
 *
 * Pure + deterministic. Run: `npm test`.
 *
 * The why-line is a promise about honesty: it may only state what the engine
 * actually did. These assert the decision ladder picks the right reason, that a
 * reason is only claimed when the underlying fact holds (an injury line only when
 * the cap is binding; a readiness line only when an ease was actually applied),
 * and that plans persisted before this feature existed still render a sane line
 * instead of crashing.
 */
import { generatePlan } from "../lib/planEngine";
import { easeUpcoming, applyAdaptation, rebuildFromToday, type AdaptationSuggestion } from "../lib/adapt";
import { logReadiness } from "../lib/readiness";
import { whyForWorkout } from "../lib/why";
import type { Plan, Profile, Workout } from "../lib/types";

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
function profile(over: Partial<Profile> = {}): Profile {
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
const plan = (over: Partial<Profile> = {}) => generatePlan(profile(over), ANCHOR);
const sessions = (p: Plan) => Object.values(p.workouts).filter((w) => w.discipline !== "rest");
const firstOf = (p: Plan, pred: (w: Workout) => boolean) => sessions(p).find(pred);

// --- every session gets exactly one non-empty sentence ----------------------
section("every session yields one honest sentence");
{
  for (const prof of [{}, { raceType: "fitness" as const, raceDateISO: "" }, { level: "beginner" as const }]) {
    const p = plan(prof);
    let bad = 0;
    for (const w of Object.values(p.workouts)) {
      const why = whyForWorkout(w, p);
      if (!why.text || why.text.length < 12 || !/[.!]$/.test(why.text.trim())) bad++;
    }
    ok(bad === 0, `every workout has a complete sentence (${JSON.stringify(prof)}): ${bad} bad`);
  }
  const p = plan();
  const race = p.workouts["w-race-day"];
  if (race) ok(whyForWorkout(race, p).kind === "raceday", "race day is recognised as race day");
  const rest = Object.values(p.workouts).find((w) => w.discipline === "rest");
  if (rest) ok(whyForWorkout(rest, p).kind === "recovery", "a rest day explains itself as recovery");
}

// --- eased sessions name their trigger, and only their trigger --------------
section("an ease names which trigger fired");
{
  // readiness: a rough morning check-in eases today only
  const p = plan();
  const day = sessions(p).find((w) => w.date > ANCHOR && (w.type === "threshold" || w.type === "vo2" || w.type === "tempo"));
  ok(!!day, "found a hard session to ease");
  if (day) {
    const eased = logReadiness(p, day.date, { sleep: 1, legs: 1, energy: 2 });
    const after = eased.workouts[day.id];
    const why = whyForWorkout(after, eased);
    ok(why.kind === "readiness", `readiness ease is attributed to readiness (got ${why.kind})`);
    ok(/check-in/.test(why.text), "readiness line cites the check-in");
    ok(/poor sleep/.test(why.text) && /heavy legs/.test(why.text), "readiness line names the dimensions actually scored low");
    ok(!/low energy/.test(why.text), "readiness line does NOT name a dimension that scored fine");
    ok(after.easedFrom?.type === day.type, "the eased session remembers what it was");
  }

  // weekly adaptation: the applied suggestion's cause survives into the line
  const p2 = plan();
  const wk = p2.weeks.find((w) => w.index === 2 && !w.isRaceWeek);
  ok(!!wk, "found a week to adapt");
  if (wk) {
    const missedSug: AdaptationSuggestion = {
      kind: "ease", weekIndex: wk.index, weekLabel: wk.label,
      reason: "You've missed 6 of 12 sessions in the last two weeks.",
      cause: "missed", missed: 6, scheduled: 12, avgStrain: null, signals: 0,
    };
    const adapted = applyAdaptation(p2, missedSug);
    ok((adapted.adaptations ?? []).some((a) => a.weekIndex === wk.index && a.cause === "missed"), "the applied adaptation is recorded");
    const easedW = wk.workoutIds.map((id) => adapted.workouts[id]).find((w) => w?.easedCause === "missed");
    if (easedW) {
      const why = whyForWorkout(easedW, adapted);
      ok(why.kind === "adaptation", `weekly ease is attributed to adaptation (got ${why.kind})`);
      ok(/missed 6 of 12/.test(why.text), "the missed-cause line quotes the real numbers");
      ok(!/harder than prescribed/.test(why.text), "a missed-cause ease is NOT described as feeling too hard");
    }

    // the strain cause must read differently — doc 02 §4 #11
    const strainSug: AdaptationSuggestion = { ...missedSug, cause: "strain", reason: "Recent sessions have felt consistently hard." };
    const adapted2 = applyAdaptation(plan(), strainSug);
    const strainW = wk.workoutIds.map((id) => adapted2.workouts[id]).find((w) => w?.easedCause === "strain");
    if (strainW) {
      const why = whyForWorkout(strainW, adapted2);
      ok(/harder than prescribed/.test(why.text), "the strain-cause line describes strain, not missed sessions");
      ok(!/missed/.test(why.text), "a strain-cause ease never claims you missed sessions");
    }
  }
}

// --- adaptation records survive a rebuild ----------------------------------
section("recorded reasons survive rebuildFromToday");
{
  const p = plan();
  const wk = p.weeks.find((w) => w.index === 2)!;
  const adapted = applyAdaptation(p, {
    kind: "ease", weekIndex: wk.index, weekLabel: wk.label, reason: "r", cause: "missed",
    missed: 5, scheduled: 10, avgStrain: null, signals: 0,
  });
  const rebuilt = rebuildFromToday(adapted, weeksFrom(3));
  ok((rebuilt.adaptations ?? []).length === (adapted.adaptations ?? []).length, "adaptations carry across a rebuild (like readiness)");
}

// --- constraints are only claimed when they actually bind -------------------
section("a constraint is only cited when it really shaped the session");
{
  // an injury that caps run intensity
  const injured = plan({ injuries: [{ id: "i1", area: "left knee", disciplines: ["run"], severity: "moderate" }] });
  const run = firstOf(injured, (w) => w.discipline === "run" && w.primaryZone <= 2);
  if (run) {
    const why = whyForWorkout(run, injured);
    ok(why.kind === "injury", `a capped run cites the injury (got ${why.kind})`);
    ok(/left knee/.test(why.text), "the injury line names the actual area");
  }
  // a healthy athlete is never told about an injury
  const healthy = plan();
  ok(sessions(healthy).every((w) => whyForWorkout(w, healthy).kind !== "injury"), "no injury line without an injury");
  // swims with no pool are explained as dry-land
  const noPool = plan({ equipment: { pool: false, trainer: true, gym: true } });
  const swim = firstOf(noPool, (w) => w.discipline === "swim");
  if (swim) ok(whyForWorkout(swim, noPool).kind === "equipment", "a pool-less swim explains the dry-land substitution");
  // and with a pool, it is not
  const pool = plan();
  const swim2 = firstOf(pool, (w) => w.discipline === "swim");
  if (swim2) ok(whyForWorkout(swim2, pool).kind !== "equipment", "no dry-land claim when the athlete has a pool");
}

// --- legacy plans (persisted before these fields existed) -------------------
section("legacy plans still render");
{
  const p = plan();
  const target = sessions(p).find((w) => w.date > ANCHOR && w.type === "threshold");
  if (target) {
    // an ease from an older build: the "Eased off" note sentinel, no easedCause/easedFrom
    const legacy = easeUpcoming(p, target.date, 0);
    const w = legacy.workouts[target.id];
    const stripped: Workout = { ...w, easedCause: undefined, easedFrom: undefined };
    const legacyPlan: Plan = { ...legacy, workouts: { ...legacy.workouts, [target.id]: stripped }, adaptations: undefined };
    const why = whyForWorkout(stripped, legacyPlan);
    ok(!!why.text && why.text.length > 12, "a legacy eased session still gets a sentence");
    ok(why.kind === "adaptation" || why.kind === "readiness", `legacy ease still reads as an ease (got ${why.kind})`);
  }
  // a plan with no readiness/adaptations/easedWeeks at all
  const bare: Plan = { ...plan(), readiness: undefined, easedWeeks: undefined, adaptations: undefined };
  let threw = false;
  try {
    for (const w of Object.values(bare.workouts)) whyForWorkout(w, bare);
  } catch {
    threw = true;
  }
  ok(!threw, "a plan missing every optional field never throws");
}

// --- personal modifiers -----------------------------------------------------
section("personal modifiers are appended honestly");
{
  const focused = plan({ focusDiscipline: "bike" });
  const bike = firstOf(focused, (w) => w.discipline === "bike");
  if (bike) ok(/limiter/.test(whyForWorkout(bike, focused).text), "a focus discipline is called out as the named limiter");
  const unfocused = plan();
  const bike2 = firstOf(unfocused, (w) => w.discipline === "bike");
  if (bike2) ok(!/limiter/.test(whyForWorkout(bike2, unfocused).text), "no limiter claim without a focus discipline");
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} why-line invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all why-line invariants passed");
