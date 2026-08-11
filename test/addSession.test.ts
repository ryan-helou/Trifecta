/**
 * "Add a session" invariants — ticket #209.
 *
 * The feature adds UNBUDGETED load to a week that was already planned, which makes it the
 * sharpest case for doc 03 §4 C's asymmetry: a missed adaptation costs a little fitness, an
 * added one costs an injury. So the tests that matter are not "does it add a session" but
 * "what does it refuse to add, and when".
 *
 * Run: `npm test`.
 */
import { addSession, suggestSession, MAX_BONUS_MIN, MIN_BONUS_MIN } from "../lib/addSession";
import { generatePlan } from "../lib/planEngine";
import { checkRails } from "../lib/rails";
import { weekImpactMinutes, impactHeadroomMinutes, IMPACT_BONUS_MAX } from "../lib/mechanical";
import type { Injury, Plan, Profile, Workout } from "../lib/types";
import { addDays, mondayOf, todayISO } from "../lib/dates";

let checks = 0;
let failures = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) { failures++; console.error("  ✗ " + msg); }
}
const section = (n: string) => console.log("\n• " + n);

const ANCHOR = mondayOf(addDays(todayISO(), 7));
const weeksFrom = (w: number) => {
  const d = new Date(ANCHOR + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + w * 7);
  return d.toISOString().slice(0, 10);
};
const profile = (o: Partial<Profile> = {}): Profile =>
  ({ username: "test", raceType: "half", raceDateISO: weeksFrom(20), level: "intermediate",
     workoutsPerWeek: 8, createdAtISO: ANCHOR, ...o }) as Profile;

const plan = generatePlan(profile(), ANCHOR);
/** a date inside the plan with nothing scheduled, or failing that its first day */
const firstDay = plan.weeks[0].startDate;
const dayWith = (pl: Plan, pred: (ws: Workout[]) => boolean): string | null => {
  for (const wk of pl.weeks.slice(0, 6)) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(wk.startDate, d);
      const ws = Object.values(pl.workouts).filter((w) => w.date === date && w.discipline !== "rest");
      if (pred(ws)) return date;
    }
  }
  return null;
};

// ---- 1. it does the thing --------------------------------------------------
section("an athlete with a spare hour gets something to do");
{
  const empty = dayWith(plan, (ws) => ws.length === 0) ?? firstDay;
  const out = suggestSession(plan, profile(), empty);
  ok(out.kind === "ok", `a free day yields a suggestion (${empty}) — got ${out.kind === "no" ? out.reason : "ok"}`);
  const s = out.kind === "ok" ? out : null;
  if (s) {
    ok(s.minutes >= MIN_BONUS_MIN && s.minutes <= MAX_BONUS_MIN, `bounded length (${s.minutes} min)`);
    ok(!!s.reason && s.reason.length > 15, `it explains itself — "${s.reason}"`);
    ok(["swim", "bike", "run"].includes(s.discipline), `a real sport (${s.discipline})`);
  }
  const added = addSession(plan, profile(), empty);
  ok(!!added, "and it can be committed");
  if (added) {
    ok(added.plan.workouts[added.workout.id]?.status === "planned", "lands as a planned session");
    const wk = added.plan.weeks.find((w) => w.index === added.workout.weekIndex);
    ok(!!wk?.workoutIds.includes(added.workout.id), "and is attached to its week, so every surface counts it");
    ok(Object.keys(added.plan.workouts).length === Object.keys(plan.workouts).length + 1, "exactly one session added");
    ok(JSON.stringify(plan) !== JSON.stringify(added.plan), "the source plan is not mutated");
  }
}

// ---- 2. the athlete can choose the sport -----------------------------------
section("asking for a specific sport gets that sport");
{
  const empty = dayWith(plan, (ws) => ws.length === 0) ?? firstDay;
  for (const sport of ["swim", "bike", "run"] as const) {
    const r = suggestSession(plan, profile(), empty, sport);
    // Either it gives you that sport, or it explains why not AND offers something that
    // fits — a bare "no" is the one answer this feature must never give.
    ok(
      (r.kind === "ok" && r.discipline === sport) || (r.kind === "no" && !!r.reason),
      `asked for ${sport}: got ${r.kind === "ok" ? r.discipline : "refusal without a reason"}`,
    );
    if (r.kind === "no") {
      ok(r.reason.length > 20, `…and the refusal explains itself — "${r.reason}"`);
      ok(!!r.alternative, `…and offers an alternative (${r.alternative?.discipline ?? "none"})`);
    }
  }
  ok(suggestSession(plan, profile(), empty, "any").kind === "ok", '"any" always finds something that fits');
}

// ---- 3. THE SAFETY PROPERTIES ----------------------------------------------
// This is the half worth having. A bonus session is unbudgeted load.
section("what it refuses to add");
{
  const p = profile();

  // never on race day or the day before it — the two days where extra work can only cost
  ok(suggestSession(plan, p, plan.raceDateISO).kind === "no", "nothing on race day");
  ok(suggestSession(plan, p, addDays(plan.raceDateISO, -1)).kind === "no", "nothing the day before the race");

  // never into a sport the athlete told us hurts
  const hurt = profile({ injuries: [{ id: "i", area: "achilles", disciplines: ["run"], severity: "severe" }] as Injury[] });
  const hurtPlan = generatePlan(hurt, ANCHOR);
  const free = dayWith(hurtPlan, (ws) => ws.length === 0) ?? hurtPlan.weeks[0].startDate;
  const hurtRun = suggestSession(hurtPlan, hurt, free, "run");
  ok(hurtRun.kind === "no", "refuses to add a run to a severe run injury");
  if (hurtRun.kind === "no") ok(hurtRun.alternative?.discipline !== "run", "…and its alternative is not a run either");
  const anyHurt = suggestSession(hurtPlan, hurt, free, "any");
  ok(anyHurt.kind !== "ok" || anyHurt.discipline !== "run", '"any" never routes toward the injured sport');

  // never a pool session for someone without a pool
  const dry = profile({ equipment: { pool: false, trainer: true, gym: true } });
  const dryPlan = generatePlan(dry, ANCHOR);
  const dryFree = dayWith(dryPlan, (ws) => ws.length === 0) ?? dryPlan.weeks[0].startDate;
  ok(suggestSession(dryPlan, dry, dryFree, "swim").kind === "no", "no swim without a pool");

  // an added session is EASY — always. It is unbudgeted load landing on a planned week.
  for (const wk of plan.weeks.slice(0, 8)) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(wk.startDate, d);
      if (suggestSession(plan, p, date).kind !== "ok") continue;
      const a = addSession(plan, p, date);
      if (a) {
        ok(a.workout.primaryZone <= 2, `${date}: an added ${a.workout.discipline} is aerobic (Z${a.workout.primaryZone})`);
      }
    }
  }
}

// ---- 4. it never manufactures a training spike -----------------------------
// The length is fitted to the week's remaining tissue headroom, reusing the same
// mechanical model `swapAllowance` uses rather than inventing a second one.
section("length is bounded by what the week can actually absorb");
{
  const p = profile();
  let checkedDays = 0;
  for (const wk of plan.weeks.slice(0, 10)) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(wk.startDate, d);
      const before = impactHeadroomMinutes(plan, wk.index, IMPACT_BONUS_MAX);
      const a = addSession(plan, p, date);
      if (!a) continue;
      checkedDays++;
      const after = weekImpactMinutes(a.plan, a.plan.weeks.find((w) => w.index === wk.index)!);
      const wasBefore = weekImpactMinutes(plan, wk);
      ok(after - wasBefore <= before + 1e-6,
        `${date}: the added impact (${(after - wasBefore).toFixed(1)}) fits the headroom (${before.toFixed(1)})`);
    }
  }
  ok(checkedDays > 0, `the sweep actually added sessions (${checkedDays})`);
}

// ---- 5. the rails still hold after adding ----------------------------------
section("adding a session never breaks the plan's own rails");
{
  const p = profile();
  let pl: Plan = plan;
  let added = 0;
  // hammer it: add to every day of the first month, compounding
  for (const wk of pl.weeks.slice(0, 4)) {
    for (let d = 0; d < 7; d++) {
      const a = addSession(pl, p, addDays(wk.startDate, d));
      if (a) { pl = a.plan; added++; }
    }
  }
  ok(added > 0, `added ${added} sessions back to back`);
  const r = checkRails(pl);
  ok(r.ok, `rails still clean after ${added} additions — ${r.violations.map((v) => v.detail).join("; ") || "clean"}`);
  // and it converges: a week that has been filled stops accepting more
  const filled = pl.weeks[0];
  const again = addSession(pl, p, addDays(filled.startDate, 2));
  ok(again === null || (again.workout.estDurationSec / 60) <= MAX_BONUS_MIN,
     "a saturated week either refuses or stays inside the bonus ceiling");
}

// ---- 6. IT MUST ACTUALLY OFFER THINGS ---------------------------------------
// #211, and the reason it existed. Every test above asserts what the feature REFUSES, and
// each one passes happily when it refuses everything — the sweeps skip refused days by
// design. Measured on the shipped build: week one refused 14 of 14 run-and-bike
// day-combinations at every level, because `impactBaseline` had no trailing weeks to
// average and fell back to a floor the plan's own first week already dwarfed. 153 green
// invariants, and not one of them noticed the feature was inert.
//
// A test suite that only checks what something declines cannot tell you it declines
// everything. So: assert the feature WORKS, for the athletes most likely to want it.
section("a healthy athlete is actually offered something — including a run");
{
  for (const level of ["beginner", "intermediate", "advanced", "elite"] as const) {
    const p = profile({ level });
    const pl = generatePlan(p, ANCHOR);

    // week one is the case that was completely dead: no history to ramp from
    const wk1 = pl.weeks[0].startDate;
    let runOffers = 0;
    let anyOffers = 0;
    for (let d = 0; d < 7; d++) {
      const date = addDays(wk1, d);
      if (suggestSession(pl, p, date, "run").kind === "ok") runOffers++;
      if (suggestSession(pl, p, date, "any").kind === "ok") anyOffers++;
    }
    ok(anyOffers >= 5, `${level}: week one offers something on most days (${anyOffers}/7)`);
    ok(runOffers >= 3, `${level}: week one can offer a RUN, not just a swim (${runOffers}/7)`);

    // and the week AFTER a deload — freshest the athlete ever is, and it used to be dead
    const afterDeload = pl.weeks.find((w, i) => i > 0 && !w.isRecovery && pl.weeks[i - 1]?.isRecovery);
    if (afterDeload) {
      let n = 0;
      for (let d = 0; d < 7; d++) if (suggestSession(pl, p, addDays(afterDeload.startDate, d), "run").kind === "ok") n++;
      ok(n >= 2, `${level}: the week after a deload still offers a run (${n}/7)`);
    }
  }

  // the offers are worth taking, not token
  const p = profile();
  const pl = generatePlan(p, ANCHOR);
  const lens: number[] = [];
  for (let d = 0; d < 7; d++) {
    const r = suggestSession(pl, p, addDays(pl.weeks[0].startDate, d), "run");
    if (r.kind === "ok") lens.push(r.minutes);
  }
  ok(lens.length > 0 && Math.max(...lens) >= 30, `the best run offered is worth changing for (${Math.max(...lens, 0)} min)`);
}

// ---- 7. adding must not authorise more adding --------------------------------
// The baseline is seeded from what the week's plan ASKS FOR (#211's fix). Athlete-added
// sessions land in that same week, so if they counted toward the baseline each addition
// would raise the ceiling permitting the next one. Measured while building the fix: four
// successive bonus runs came out 40, 40, 35, then 55 minutes — growing, not tightening.
section("a bonus session spends headroom, it does not create it");
{
  const p = profile();
  let pl: Plan = generatePlan(p, ANCHOR);
  const wk0 = pl.weeks[0].startDate;
  const taken: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = suggestSession(pl, p, addDays(wk0, i % 7), "run");
    if (r.kind !== "ok") break;
    taken.push(r.minutes);
    const a = addSession(pl, p, addDays(wk0, i % 7), "run");
    if (!a) break;
    pl = a.plan;
  }
  ok(taken.length >= 1, `at least one bonus run is available (${taken.length})`);
  ok(taken.length <= 3, `the week stops handing them out (${taken.length} taken: ${taken.join(", ")} min)`);
  for (let i = 1; i < taken.length; i++) {
    ok(taken[i] <= taken[i - 1], `offer ${i + 1} is no longer than offer ${i} (${taken.join(" → ")})`);
  }
  // and the added sessions are marked, which is what keeps the baseline honest
  const added = Object.values(pl.workouts).filter((w) => w.addedByAthlete);
  ok(added.length === taken.length, `every addition is flagged addedByAthlete (${added.length}/${taken.length})`);
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) { console.error(`\n❌ ${failures} add-session invariant(s) FAILED`); process.exit(1); }
console.log("\n✅ all add-session invariants passed");
