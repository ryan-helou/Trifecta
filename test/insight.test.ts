// ---------------------------------------------------------------------------
// The one line under "what's next" (lib/insight.ts) — ticket #200.
//
// Ryan: "There's no point of telling you what I did — you can tell me what's
// next. You can tell me a cool thing... Me telling you what I did is useless."
//
// The risk in a feature like this is not that it crashes, it's that it becomes
// noise: a line that fires on an empty plan, or says the same thing forever, or
// congratulates someone for a 1-day streak, gets ignored within a week and then
// occupies prime screen space permanently. So these are the properties:
//   - silence beats filler: nothing true to say ⇒ null, and the caller shows nothing
//   - never fires on a plan with no history
//   - deterministic within a day (a component may re-render many times)
//   - rotates across days, so a long plan doesn't repeat one line forever
//   - every claim is checked against the data it claims
//
// Pure, no clock, no I/O. Run: npx tsx test/insight.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { insightFor } from "../lib/insight";
import { computeStreak } from "../lib/stats";
import { logCheckin } from "../lib/adapt";
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

// The plan clamps its own start relative to the race date, so an invented
// "today" can land entirely outside it — which is how the first version of this
// file completed 0 sessions and still looked like it was testing something.
// Dates come from the plan's own startDateISO (the #49 clock-safety rule).
const ANCHOR = "2026-06-15";
const prof = (over: Partial<Profile> = {}): Profile =>
  ({
    username: "t",
    raceType: "half",
    raceDateISO: "2026-11-01",
    level: "intermediate",
    workoutsPerWeek: 8,
    ...over,
  }) as unknown as Profile;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Complete every session up to and including `throughISO`, so there's history. */
function trainThrough(plan: Plan, throughISO: string): Plan {
  let p = plan;
  for (const w of Object.values(plan.workouts)) {
    if (w.date > throughISO || w.discipline === "rest") continue;
    p = logCheckin(p, w.id, { rpe: 5, feel: "ok", actualDurationSec: w.estDurationSec });
  }
  return p;
}

// ---- 1. silence beats filler ----------------------------------------------

section("Nothing true to say means nothing is said");
{
  const fresh = generatePlan(prof(), ANCHOR);
  // Day one: no completed sessions, no ledger, no form, nothing banked.
  const day1 = insightFor(fresh, fresh.startDateISO);
  ok(
    day1 === null || !/form is/i.test(day1.text),
    `a brand-new plan must not claim a form state (got "${day1?.text ?? "null"}")`,
  );
  ok(
    day1 === null || day1.key !== "streak",
    "a brand-new plan must not claim a streak",
  );
  ok(day1 === null || day1.key !== "banked", "a brand-new plan must not claim banked hours");
  ok(day1 === null || day1.key !== "fitness", "a brand-new plan must not claim rising fitness");
}

// ---- 2. determinism --------------------------------------------------------

section("Stable within a day, moving across days");
{
  const built = generatePlan(prof(), ANCHOR);
  const p = trainThrough(built, addDays(built.startDateISO, 40));
  const at = addDays(built.startDateISO, 41);

  const a = insightFor(p, at);
  const b = insightFor(p, at);
  const c = insightFor(p, at);
  ok(
    a?.key === b?.key && b?.key === c?.key && a?.text === c?.text,
    "the same day always yields the same line — a component re-render can't change it",
  );

  // Across a run of days it must not be one single line forever.
  const keys = new Set<string>();
  for (let i = 0; i < 14; i++) {
    const got = insightFor(p, addDays(at, i));
    if (got) keys.add(got.key);
  }
  ok(keys.size > 1, `a fortnight shows more than one kind of insight (got ${[...keys].join(", ") || "none"})`);
}

// ---- 3. every claim is checked --------------------------------------------

section("Every claim matches the data behind it");
{
  const built = generatePlan(prof(), ANCHOR);
  const p = trainThrough(built, addDays(built.startDateISO, 40));
  const from = addDays(built.startDateISO, 41);

  // Sweep a long window and re-verify whatever fired, against the source data.
  let seen = 0;
  for (let i = 0; i < 60; i++) {
    const at = addDays(from, i);
    const got = insightFor(p, at);
    if (!got) continue;
    seen++;

    if (got.key === "streak") {
      const streak = computeStreak(p, at);
      ok(streak.current >= 4, `streak line only fires at 4+ days (claimed on ${streak.current})`);
      ok(got.text.startsWith(`${streak.current} days`), `streak line states the real streak (${got.text})`);
    }
    if (got.key === "banked") {
      const m = got.text.match(/That's (\d+) hours/);
      ok(!!m && Number(m![1]) >= 5, `banked line only fires at 5+ hours (${got.text})`);
    }
    if (got.key === "countdown") {
      const m = got.text.match(/^(\d+) days? to race/);
      ok(!!m && Number(m![1]) <= 21, `countdown only inside three weeks (${got.text})`);
    }
    if (got.key === "fitness") {
      ok(/up \d+% over the last four weeks/.test(got.text), `fitness line is specific (${got.text})`);
    }
    // No line may ever restate what the athlete just did — that IS the ticket.
    ok(
      !/you (did|completed|finished)/i.test(got.text),
      `an insight never reports the athlete's own input back at them (${got.text})`,
    );
    ok(got.text.trim().length > 0 && got.text.length < 160, `an insight is one readable line (${got.text.length} chars)`);
  }
  ok(seen > 0, `something fired across the sweep (got ${seen})`);
}

// ---- 4. fitness-goal athletes ---------------------------------------------

section("A fitness-goal athlete is never told about a race");
{
  const built = generatePlan(prof({ raceType: "fitness", raceDateISO: "" }), ANCHOR);
  const p = trainThrough(built, addDays(built.startDateISO, 40));
  for (let i = 0; i < 30; i++) {
    const got = insightFor(p, addDays(addDays(built.startDateISO, 41), i));
    if (!got) continue;
    ok(got.key !== "countdown" && got.key !== "raceday" && got.key !== "projection", `no race talk without a race (${got.key})`);
    ok(!/race/i.test(got.text), `and no race in the copy either (${got.text})`);
  }
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} insight invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all insight invariants passed");
