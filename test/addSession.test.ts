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
import { weekImpactMinutes, impactHeadroomMinutes } from "../lib/mechanical";
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
      const before = impactHeadroomMinutes(plan, wk.index);
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

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) { console.error(`\n❌ ${failures} add-session invariant(s) FAILED`); process.exit(1); }
console.log("\n✅ all add-session invariants passed");
