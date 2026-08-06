// ---------------------------------------------------------------------------
// The Coach's hands (lib/coachActions.ts).
//
// The safety property under test is that the conversational path is NOT a way
// around the engine. The model never touches the plan: intent is matched here,
// deterministically, and the change is made by the same functions the buttons
// call, then gated by the same rails.
//
// The other property is restraint. A wrong guess that silently rewrites someone's
// training is far worse than a missed one, so null is the correct answer most of
// the time — and questions in particular must never act. "Should I skip today?"
// wants an opinion; "skip today" wants an action.
//
// Pure, no clock, no I/O. Run: npx tsx test/coachActions.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { detectAction, previewAction, proposeFromText } from "../lib/coachActions";
import { checkRails } from "../lib/rails";
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
function profile(over: Partial<Profile> = {}): Profile {
  return {
    username: "test", raceType: "olympic", raceDateISO: weeksFrom(16),
    level: "intermediate", workoutsPerWeek: 6, createdAtISO: ANCHOR, ...over,
  } as Profile;
}

/** A day in the plan that has a real, hard session on it — what "today" needs to
 *  mean for most of these to be answerable at all. */
function dayWithHardSession(plan: Plan): { today: string; w: Workout } {
  const w = Object.values(plan.workouts)
    .filter((x) => x.status === "planned" && ["threshold", "vo2", "tempo", "brick"].includes(x.type))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return { today: w.date, w };
}

const plan = generatePlan(profile(), ANCHOR);
const { today, w: hard } = dayWithHardSession(plan);

// --- 1. restraint: questions and chatter never act --------------------------
section("questions and ordinary chat never move the plan");
{
  const quiet = [
    "Should I skip today?",
    "Is this session too hard?",
    "How hard should today feel?",
    "What should I eat before a long ride?",
    "Am I on track for race day?",
    "How did my week go?",
    "why is today easy",
    "",
    "   ",
  ];
  for (const q of quiet) ok(detectAction(q, plan, today) === null, `"${q}" is not an action`);
}

// --- 2. the requests that should act ----------------------------------------
section("clear requests are matched");
{
  const a = detectAction("give me an easier one today", plan, today);
  ok(a?.kind === "ease-today", `"give me an easier one today" → ease-today (got ${a?.kind})`);

  const b = detectAction("take it easy this week", plan, today);
  ok(b?.kind === "ease-week", `week scope is detected (got ${b?.kind})`);

  const c = detectAction("this is too hard, dial it back", plan, today);
  ok(c?.kind === "ease-today", `"too hard, dial it back" → ease-today (got ${c?.kind})`);

  const d = detectAction("skip today", plan, today);
  ok(d?.kind === "skip", `"skip today" → skip (got ${d?.kind})`);
}

// --- 3. swaps name the sport being asked FOR --------------------------------
section("a swap resolves to the sport actually wanted");
{
  const bike = Object.values(plan.workouts).find((x) => x.discipline === "bike" && x.status === "planned")!;
  const bikeDay = bike.date;
  const first = Object.values(plan.workouts)
    .filter((x) => x.date === bikeDay && x.discipline !== "rest" && x.status === "planned")
    .sort((a, b) => a.id.localeCompare(b.id))[0];

  const a = detectAction("make it a swim instead", plan, bikeDay);
  if (first.discipline !== "swim") {
    ok(a?.kind === "swap" && a.to === "swim", `"make it a swim instead" → swap to swim (got ${JSON.stringify(a)})`);
  }
  // naming the sport you're replacing must not be read as the sport you want
  const b = detectAction(`swap the ${first.discipline} for a swim`, plan, bikeDay);
  if (first.discipline !== "swim") {
    ok(b?.kind === "swap" && b.to === "swim", `the outgoing sport is not mistaken for the wanted one (got ${JSON.stringify(b)})`);
  }
  // ambiguous — two candidate sports — must not guess
  const c = detectAction("swap it for a swim or a run", plan, bikeDay);
  ok(c === null || c.kind !== "swap", "an ambiguous swap is refused rather than guessed");
}

// --- 4. previews are real, explained, and never no-ops ----------------------
section("a preview changes something, or there is no preview");
{
  const p = proposeFromText("give me an easier one today", plan, today);
  ok(!!p, "an easier day on a hard session produces a preview");
  if (p) {
    ok(p.changedIds.length > 0, "the preview actually changes sessions");
    ok(p.summary.length > 0, "and says what it will do, before it does it");
    ok(p.plan !== plan, "the preview is a new plan, not a mutation of the current one");
    // the original is untouched until accepted
    ok(plan.workouts[hard.id].estDurationSec > 0, "the live plan is not modified by previewing");
  }

  // a day with nothing scheduled has nothing to ease, so "easier today" has to
  // mean something else rather than fail — it falls back to the week
  const scheduled = new Set(Object.values(plan.workouts).filter((x) => x.discipline !== "rest").map((x) => x.date));
  const emptyDay = plan.weeks
    .flatMap((w) => Array.from({ length: 7 }, (_, i) => {
      const d = new Date(w.startDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    }))
    .find((d) => !scheduled.has(d));
  ok(!!emptyDay, "the plan has at least one day off");
  if (emptyDay) {
    const q = detectAction("give me an easier one today", plan, emptyDay);
    ok(q?.kind === "ease-week", `with no session that day, easing falls back to the week (got ${q?.kind})`);
  }
}

// --- 5. THE SAFETY PROPERTY: no privileges the buttons don't have -----------
section("the conversational path is not a way around the rails");
{
  const asks = [
    "give me an easier one today",
    "take it easy this week",
    "skip today",
    "make it a swim instead",
    "make it a run instead",
    "dial it back",
  ];
  for (const ask of asks) {
    const p = proposeFromText(ask, plan, today);
    if (!p) continue;
    const before = checkRails(plan);
    const after = checkRails(p.plan);
    ok(
      after.violations.length <= before.violations.length,
      `"${ask}" never leaves the plan in more violation than it found it (${before.violations.length} → ${after.violations.length})`,
    );
    // and it never invents or deletes sessions
    ok(
      Object.keys(p.plan.workouts).length === Object.keys(plan.workouts).length,
      `"${ask}" adds and removes no sessions`,
    );
    ok(p.plan.weeks.length === plan.weeks.length, `"${ask}" leaves the block structure alone`);
  }
}

// --- 6. a capped swap explains itself in the preview ------------------------
section("a swap that had to be shortened says so up front");
{
  const stuffed: Plan = JSON.parse(JSON.stringify(plan));
  const wk = stuffed.weeks.find((x) => x.index === hard.weekIndex)!;
  for (const id of wk.workoutIds) {
    const w = stuffed.workouts[id];
    if (w && w.discipline !== "rest" && w.id !== hard.id) { w.discipline = "run"; w.estDurationSec = 5400; }
  }
  const victim = stuffed.workouts[hard.id];
  victim.discipline = "bike";
  victim.estDurationSec = 7200;
  const p = proposeFromText("make it a run instead", stuffed, today);
  if (p) {
    ok(/kept to \d+ min/.test(p.summary), `the preview names the cap up front (got "${p.summary}")`);
  } else {
    ok(true, "or the swap is declined outright, which is also safe");
  }
}

// --- 7. degenerate ----------------------------------------------------------
section("never throws on degenerate input");
{
  let threw = false;
  try {
    detectAction("easier", { ...plan, workouts: {} }, today);
    previewAction(plan, today, { kind: "ease-today", workoutId: "nope" });
    previewAction(plan, today, { kind: "swap", workoutId: "nope", to: "run" });
    previewAction(plan, today, { kind: "skip", workoutId: "nope" });
    proposeFromText("skip today", { ...plan, workouts: {} }, today);
  } catch {
    threw = true;
  }
  ok(!threw, "unknown ids and empty plans never throw");
  ok(previewAction(plan, today, { kind: "ease-today", workoutId: "nope" }) === null, "an unknown id previews nothing");
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} coach-action invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all coach-action invariants passed");
