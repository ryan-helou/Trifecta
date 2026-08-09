// ---------------------------------------------------------------------------
// The feedback path (lib/prescribe.ts): the load ledger prescribing, not just
// recording.
//
// Two properties carry the whole design and are tested hardest:
//
//   CONVERGENCE — re-prescribing is going to run after every logged event, so
//   running it twice must not cut twice. Scaling is computed from each session's
//   stored original, never from its current value. Without this the plan
//   ratchets toward zero for exactly the athlete who logs diligently.
//
//   HONESTY — segment descriptions carry their own numbers ("6 × 100m @ CSS",
//   "81 min @ Endurance"). A session whose text still claims the old numbers is
//   worse than no adaptation, so a segment is only rescaled when its text can be
//   rewritten to match, and the header duration is always DERIVED from the
//   structure rather than scaled alongside it.
//
// Plus the asymmetry the physiology docs insist on: this may ease, and may
// restore toward the original, but may never prescribe more than the design.
//
// Pure, no clock, no I/O. Run: npx tsx test/prescribe.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { railsRegressed } from "../lib/rails";
import { logCheckin } from "../lib/adapt";
import { FORM_DEBT_EASE_PCT } from "../lib/load";
import {
  DEADBAND_PCT,
  MAX_STRETCH,
  MAX_ADD,
  FULL_ADD_PCT,
  adjustChoices,
  adjustSession,
  FULL_CUT_PCT,
  HORIZON_SESSIONS,
  MAX_CUT,
  MIN_SESSION_SEC,
  loadFactor,
  represcribe,
  retitleMinutes,
  retitleRepeat,
  scaleWorkout,
  segmentSeconds,
  workoutSeconds,
} from "../lib/prescribe";
import type { Plan, Profile, Segment, Workout } from "../lib/types";

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
    username: "test",
    raceType: "olympic",
    raceDateISO: weeksFrom(16),
    level: "intermediate",
    workoutsPerWeek: 6,
    createdAtISO: ANCHOR,
    ...over,
  } as Profile;
}
const clone = (p: Plan): Plan => JSON.parse(JSON.stringify(p));
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** An athlete two weeks in who has been finding everything much harder than
 *  prescribed — the state that should produce a real cut. */
function strainedPlan(): { plan: Plan; today: string } {
  const today = addDays(ANCHOR, 16);
  let plan = generatePlan(profile(), ANCHOR);
  for (const w of Object.values(plan.workouts)) {
    if (w.discipline === "rest" || w.date >= today) continue;
    // completed, but at a much higher cost than the zone budgeted for
    plan = logCheckin(plan, w.id, { rpe: 9, feel: "rough" });
  }
  return { plan, today };
}

// --- 1. the scalar ----------------------------------------------------------
section("loadFactor: eases on debt, never adds on credit");
{
  ok(loadFactor(0) === 1, "on budget → no change");
  // Doc 03 §4 C was OVERRIDDEN on 2026-08-09 (Ryan's decision, recorded in that doc):
  // the plan now adapts automatically in both directions. This assertion used to read
  // "way ahead of budget → still 1.0, never more" and is inverted on purpose.
  ok(loadFactor(50) > 1, `way ahead of budget → load is added back (got ${loadFactor(50)})`);
  ok(loadFactor(50) === MAX_ADD, "and it is capped at MAX_ADD");
  ok(loadFactor(FULL_ADD_PCT) === MAX_ADD, "the cap is reached at FULL_ADD_PCT");
  ok(loadFactor(DEADBAND_PCT) === 1, "just inside the deadband on the credit side → nothing");
  ok(loadFactor(DEADBAND_PCT + 0.1) > 1, "just outside it → a small increase");
  // the asymmetry survives in the NUMBERS even though the rule is gone
  ok(MAX_ADD - 1 < 1 - MAX_CUT, `adding stays gentler than trimming (${MAX_ADD} vs ${MAX_CUT})`);
  ok(MAX_ADD < MAX_STRETCH, "and the plan is less free with load than the athlete is by hand");
  // monotone upward too
  let up = 1;
  for (let d = 0; d <= 40; d += 1) {
    const f = loadFactor(d);
    ok(f >= up - 1e-9, `credit side is monotone at +${d}% (${f.toFixed(3)} ≥ ${up.toFixed(3)})`);
    up = f;
  }
  ok(loadFactor(-DEADBAND_PCT + 0.1) === 1, "inside the deadband → nothing happens");
  ok(loadFactor(FULL_CUT_PCT) === MAX_CUT, "at the full-cut anchor → the deepest cut");
  ok(loadFactor(FULL_CUT_PCT * 3) === MAX_CUT, "beyond it → still bottoms out, never deeper");
  const mid = loadFactor(FORM_DEBT_EASE_PCT);
  ok(mid < 1 && mid > MAX_CUT, `the existing debt threshold lands mid-scale (got ${mid.toFixed(3)})`);
  // monotone: more debt is never a smaller cut
  let prev = 1;
  for (let d = 0; d >= -40; d -= 1) {
    const f = loadFactor(d);
    ok(f <= prev + 1e-9, `factor is monotone at ${d}% (${f.toFixed(3)} ≤ ${prev.toFixed(3)})`);
    prev = f;
  }
}

// --- 2. honesty: never emit a description that lies -------------------------
section("descriptions are rewritten to match, or the segment is left alone");
{
  ok(retitleRepeat("6 × 100m @ CSS (15s rest)", 4) === "4 × 100m @ CSS (15s rest)", "rep counts are rewritten");
  ok(retitleRepeat("easy spin", 4) === null, "a description with no count is refused");
  ok(retitleMinutes("81 min @ Endurance (Z2) — steady endurance", 3900) === "65 min @ Endurance (Z2) — steady endurance", "minutes are rewritten");
  ok(retitleMinutes("steady endurance", 3900) === null, "a description with no minutes is refused");

  // a segment whose text can't be rewritten must come back byte-identical
  const opaque: Workout = {
    id: "x", date: ANCHOR, weekIndex: 0, dayIndex: 0, discipline: "run", type: "endurance",
    title: "t", purpose: "p", status: "planned", primaryZone: 2, estDurationSec: 3600,
    segments: [{ kind: "main", durationSec: 3600, description: "just run", zone: 2 }],
  } as Workout;
  const scaled = scaleWorkout(opaque, 0.7);
  ok(scaled === null || scaled.segments[0].description === "just run", "an unrewritable segment is never silently reworded");
  ok(scaled === null || scaled.segments[0].durationSec === 3600, "and it is never silently shortened either");
}

// --- 3. the header always equals the structure ------------------------------
section("estDurationSec is derived from the segments, never scaled beside them");
{
  const plan = generatePlan(profile(), ANCHOR);
  let checkedAny = false;
  for (const w of Object.values(plan.workouts)) {
    if (w.discipline === "rest" || !w.segments?.length) continue;
    const scaled = scaleWorkout(w, 0.75);
    if (!scaled) continue;
    checkedAny = true;
    ok(
      scaled.estDurationSec === workoutSeconds(scaled),
      `"${w.title}": header ${scaled.estDurationSec}s must equal the sum of its segments ${workoutSeconds(scaled)}s`,
    );
    ok(scaled.estDurationSec <= w.estDurationSec, `"${w.title}": scaling down never lengthens the session`);
  }
  ok(checkedAny, "at least one real session was scalable");
}

// --- 4. CONVERGENCE — the property that makes this safe to run every time ----
section("re-prescribing twice does not cut twice");
{
  const plan = generatePlan(profile(), ANCHOR);
  const w = Object.values(plan.workouts).find((x) => x.discipline !== "rest" && x.segments?.length && scaleWorkout(x, 0.7))!;
  ok(!!w, "found a scalable session");

  const once = scaleWorkout(w, 0.7)!;
  const twice = scaleWorkout(once, 0.7);
  ok(
    twice === null || twice.estDurationSec === once.estDurationSec,
    `scaling to 70% twice equals scaling once (${once.estDurationSec}s then ${twice?.estDurationSec}s)`,
  );

  // and it RESTORES: back to factor 1.0 returns the original prescription
  const restored = scaleWorkout(once, 1);
  ok(!!restored, "a session eased earlier can be restored");
  if (restored) {
    ok(restored.estDurationSec === w.estDurationSec, `restoring returns the original ${w.estDurationSec}s (got ${restored.estDurationSec}s)`);
    ok(restored.estDurationSec === workoutSeconds(restored), "and the restored header still matches its structure");
  }

  // ten passes at the same factor land exactly where one pass did
  let acc = w;
  for (let i = 0; i < 10; i++) acc = scaleWorkout(acc, 0.8) ?? acc;
  const single = scaleWorkout(w, 0.8)!;
  ok(acc.estDurationSec === single.estDurationSec, `ten passes == one pass (${acc.estDurationSec}s vs ${single.estDurationSec}s)`);
}

// --- 5. never prescribes more than the design -------------------------------
section("scaling can ease and restore, but never exceeds the original");
{
  const plan = generatePlan(profile(), ANCHOR);
  for (const w of Object.values(plan.workouts)) {
    if (w.discipline === "rest" || !w.segments?.length) continue;
    const up = scaleWorkout(w, 1.5);
    ok(up === null || up.estDurationSec <= w.estDurationSec, `"${w.title}": a factor above 1 never lengthens the session`);
  }
}

// --- 6. represcribe end to end ----------------------------------------------
section("represcribe: quiet when it should be, and bounded when it acts");
{
  const fresh = generatePlan(profile(), ANCHOR);
  ok(represcribe(fresh, ANCHOR) === null, "a brand-new plan with no history says nothing");

  const { plan, today } = strainedPlan();
  const res = represcribe(plan, today);
  ok(!!res, `a consistently overreaching athlete gets a re-prescription (deviation drove it)`);
  if (res) {
    ok(res.deltaPct < -DEADBAND_PCT, `and only because the deviation cleared the deadband (${res.deltaPct.toFixed(1)}%)`);
    ok(res.factor < 1 && res.factor >= MAX_CUT, `factor ${res.factor.toFixed(2)} is inside [${MAX_CUT}, 1)`);
    ok(res.changed > 0 && res.changed <= HORIZON_SESSIONS, `touched ${res.changed} sessions, at most ${HORIZON_SESSIONS}`);

    // nothing in the past, nothing already done, nothing in race week
    const raceWeek = res.plan.weeks.find((w) => w.isRaceWeek)?.index;
    for (const [id, after] of Object.entries(res.plan.workouts)) {
      const before = plan.workouts[id];
      if (before.estDurationSec === after.estDurationSec) continue;
      ok(after.date >= today, `only future sessions move (${after.date} ≥ ${today})`);
      ok(before.status === "planned", "only untouched sessions move");
      ok(raceWeek == null || after.weekIndex < raceWeek, "race week is never touched");
      ok(after.estDurationSec === workoutSeconds(after), "every changed session's header matches its structure");
    }

    // running it again on its own output must not compound
    const again = represcribe(res.plan, today);
    if (again) {
      for (const [id, w2] of Object.entries(again.plan.workouts)) {
        const w1 = res.plan.workouts[id];
        ok(w2.estDurationSec === w1.estDurationSec, `second pass changes nothing further for ${id}`);
      }
    }
  }
}

// --- 6b. the athlete adjusting a session by hand -----------------------------
// The deliberate-choice counterpart to represcribe. It MAY lengthen, which the
// automatic path may never do — a person choosing to train more is not the system
// piling load on them — but it is still bounded and still rails-gated.
section("adjustSession: the athlete's own change, honest and still bounded");
{
  const plan = generatePlan(profile(), ANCHOR);
  const w = Object.values(plan.workouts).find((x) => x.discipline !== "rest" && x.segments?.length && scaleWorkout(x, 0.7))!;
  ok(!!w, "found an adjustable session");

  const choices = adjustChoices(w);
  ok(choices.length > 1, `offers real options (${choices.map((c) => Math.round(c / 60) + "m").join(", ")})`);
  ok(choices.includes(Math.round((w.estDurationSec / 300)) * 300) || choices.some((c) => Math.abs(c - w.estDurationSec) <= 300), "the original duration is among them, so putting it back is one tap");
  ok(choices.every((c) => c >= MIN_SESSION_SEC), "never offers something too short to be training");
  ok(choices.every((c) => c <= w.estDurationSec * MAX_STRETCH + 300), `never offers more than ${MAX_STRETCH}× the prescription`);
  ok(choices.every((c, i) => i === 0 || c > choices[i - 1]), "options are sorted and de-duplicated");

  // shorter
  const shorter = adjustSession(plan, w.id, Math.round(w.estDurationSec * 0.6));
  ok(!!shorter, "an athlete can shorten a session");
  if (shorter) {
    ok(shorter.workout.estDurationSec < w.estDurationSec, "and it really is shorter");
    ok(shorter.workout.estDurationSec === workoutSeconds(shorter.workout), "header still equals the structure");
    ok(shorter.summary.length > 0, "and it says what it did");
  }

  // longer — allowed HERE, and only here
  const longer = adjustSession(plan, w.id, Math.round(w.estDurationSec * 1.3));
  if (longer) {
    ok(longer.workout.estDurationSec > w.estDurationSec, "an athlete can also lengthen a session");
    ok(longer.workout.estDurationSec === workoutSeconds(longer.workout), "and the header still equals the structure");
  }

  // the automatic path is UNCHANGED — it still may never add
  const auto = scaleWorkout(w, 1.3);
  ok(auto === null || auto.estDurationSec <= w.estDurationSec, "scaleWorkout without allowLonger still never lengthens");

  // bounded: asking for triple is clamped, never honoured
  const absurd = adjustSession(plan, w.id, w.estDurationSec * 3);
  ok(
    absurd === null || absurd.workout.estDurationSec <= Math.ceil(w.estDurationSec * MAX_STRETCH) + 1,
    `asking for 3× is capped at ${MAX_STRETCH}× (got ${absurd ? absurd.workout.estDurationSec : "null"})`,
  );

  // convergence still holds for the manual path
  if (shorter) {
    const again = adjustSession(shorter.plan, w.id, Math.round(w.estDurationSec * 0.6));
    ok(!again || again.workout.estDurationSec === shorter.workout.estDurationSec, "adjusting twice to the same target changes nothing further");
    const restored = adjustSession(shorter.plan, w.id, w.estDurationSec);
    ok(!!restored && restored.workout.estDurationSec === w.estDurationSec, "and the original is always reachable again");
  }

  ok(adjustSession(plan, "nope", 1800) === null, "an unknown id adjusts nothing");
  ok(adjustSession(plan, w.id, 0) === null, "a zero target is refused");
}

// --- 6c. automatic increases (doc 03 §4 C override) --------------------------
section("an athlete under budget gets load back — bounded, and never while injured");
{
  // consistently UNDER the plan: sessions logged much easier than prescribed
  const today = addDays(ANCHOR, 16);
  let light = generatePlan(profile(), ANCHOR);
  for (const w of Object.values(light.workouts)) {
    if (w.discipline === "rest" || w.date >= today) continue;
    light = logCheckin(light, w.id, { rpe: 2, feel: "great" });
  }
  const res = represcribe(light, today);
  if (res) {
    ok(res.factor > 1, `load is added back (factor ${res.factor.toFixed(3)})`);
    ok(res.factor <= MAX_ADD + 1e-9, `never beyond MAX_ADD (${MAX_ADD})`);
    ok(/put back/.test(res.reason), `and it says so plainly (got "${res.reason}")`);
    for (const [id, after] of Object.entries(res.plan.workouts)) {
      const before = light.workouts[id];
      if (before.estDurationSec === after.estDurationSec) continue;
      ok(after.estDurationSec >= before.estDurationSec, `${id} got longer, not shorter`);
      ok(after.estDurationSec === workoutSeconds(after), `${id} header still matches its structure`);
    }
    // the rails still bound it — this is doc 04, untouched by the override
    ok(railsRegressed(light, res.plan).length === 0, "an automatic increase never breaches the rails");
  }

  // …but never while an injury is active. Doc 03 rules A and B are NOT overridden.
  const hurt = { ...light, profile: { ...light.profile, injuries: [{ id: "i1", area: "shin", disciplines: ["run"], severity: "niggle" }] } } as Plan;
  const hurtRes = represcribe(hurt, today);
  ok(hurtRes === null || hurtRes.factor <= 1, "an injured athlete is never handed more load automatically");
}

// --- 7. degenerate input -----------------------------------------------------
section("never throws on degenerate input");
{
  const plan = generatePlan(profile(), ANCHOR);
  const empty = clone(plan);
  empty.workouts = {};
  let threw = false;
  try {
    represcribe(empty, ANCHOR);
    const seg: Segment = { kind: "main", description: "x" };
    ok(segmentSeconds(seg) === 0, "a segment with no duration is zero seconds");
    ok(scaleWorkout({ ...plan.weeks[0], discipline: "rest" } as unknown as Workout, 0.8) === null, "a rest day is never scaled");
  } catch {
    threw = true;
  }
  ok(!threw, "degenerate plans never throw");
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} prescribe invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all prescribe invariants passed");
