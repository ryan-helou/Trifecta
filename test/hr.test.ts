/**
 * HR-anchor inference tests (#112).
 *
 * These numbers set every heart-rate target in the plan, so a bad inference is not
 * cosmetic — it either makes easy days unreachably hard or makes hard days pointless.
 * The rules being defended:
 *   • a number the athlete typed always wins over anything we infer
 *   • one session is not evidence
 *   • an easy long ride is not a threshold effort
 *   • garbage strap readings never reach the zone maths
 *
 * Run: `npm test`.
 */
import { observeHr } from "../lib/hr";
import { derivePaces } from "../lib/paces";
import type { Plan, Profile, Workout, WorkoutActuals } from "../lib/types";

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

const profile: Profile = {
  username: "t",
  raceType: "olympic",
  raceDateISO: "2026-11-15",
  level: "intermediate",
  workoutsPerWeek: 6,
  strength: { enabled: false, daysPerWeek: 2, split: "full" },
  unitPreference: "metric",
  blackouts: [],
  createdAtISO: "2026-08-01T00:00:00.000Z",
};

let n = 0;
function session(over: { durationSec?: number; avgHr?: number; maxHr?: number; status?: Workout["status"] }): Workout {
  n++;
  const actuals: WorkoutActuals = {
    source: "strava",
    activityId: n,
    durationSec: over.durationSec ?? 3600,
    avgHr: over.avgHr,
    maxHr: over.maxHr,
  };
  return {
    id: `w-${n}`,
    date: `2026-08-${String((n % 27) + 1).padStart(2, "0")}`,
    weekIndex: 0,
    dayIndex: 0,
    discipline: "run",
    type: "endurance",
    title: "Run",
    purpose: "",
    segments: [],
    estDurationSec: over.durationSec ?? 3600,
    primaryZone: 2,
    status: over.status ?? "done",
    actuals,
  } as unknown as Workout;
}

const planOf = (ws: Workout[]): Plan =>
  ({ profile, workouts: Object.fromEntries(ws.map((w) => [w.id, w])) } as unknown as Plan);

// ---------------------------------------------------------------------------
section("max HR is the highest peak actually recorded");
{
  const p = planOf([session({ maxHr: 178 }), session({ maxHr: 191 }), session({ maxHr: 185 })]);
  ok(observeHr(p).maxHR === 191, `takes the highest peak — got ${observeHr(p).maxHR}`);

  const none = planOf([session({ avgHr: 150 })]);
  ok(observeHr(none).maxHR === null, "no peak readings → null, never a guess");
}

// ---------------------------------------------------------------------------
section("one session is not evidence");
{
  const one = planOf([session({ durationSec: 3600, avgHr: 168, maxHr: 190 })]);
  ok(observeHr(one).lthr === null, "a single hard session does not set LTHR");

  const three = planOf([
    session({ durationSec: 3600, avgHr: 168, maxHr: 190 }),
    session({ durationSec: 3600, avgHr: 160, maxHr: 188 }),
    session({ durationSec: 3600, avgHr: 155, maxHr: 185 }),
  ]);
  ok(observeHr(three).lthr === 168, `three qualifying sessions → best average, got ${observeHr(three).lthr}`);
  ok(observeHr(three).samples === 3, "sample count is reported honestly");
}

// ---------------------------------------------------------------------------
section("short sessions can't speak for threshold");
{
  // 10-minute averages are dominated by warm-up; including them would drag LTHR down.
  const shorts = planOf([
    session({ durationSec: 600, avgHr: 175, maxHr: 190 }),
    session({ durationSec: 600, avgHr: 172, maxHr: 189 }),
    session({ durationSec: 600, avgHr: 170, maxHr: 188 }),
  ]);
  ok(observeHr(shorts).lthr === null, "sub-20-minute efforts never qualify");
  ok(observeHr(shorts).maxHR === 190, "...but their PEAK still counts toward max HR");
}

// ---------------------------------------------------------------------------
section("an easy ride is not a threshold effort");
{
  // avg 120 against a peak of 190 is someone's recovery spin. Claiming that as LTHR
  // would drag every zone down and make hard sessions trivially easy.
  const easy = planOf([
    session({ durationSec: 5400, avgHr: 120, maxHr: 190 }),
    session({ durationSec: 5400, avgHr: 118, maxHr: 188 }),
    session({ durationSec: 5400, avgHr: 122, maxHr: 189 }),
  ]);
  ok(observeHr(easy).lthr === null, "an average far below observed max is rejected, not adopted");
}

// ---------------------------------------------------------------------------
section("garbage readings never reach the zone maths");
{
  const junk = planOf([
    session({ durationSec: 3600, avgHr: 4, maxHr: 12 }),
    session({ durationSec: 3600, avgHr: 900, maxHr: 950 }),
    session({ durationSec: 3600, avgHr: 165, maxHr: 188 }),
  ]);
  const o = junk;
  ok(observeHr(o).maxHR === 188, `implausible peaks filtered — got ${observeHr(o).maxHR}`);
  ok(observeHr(o).samples === 1, "implausible averages don't count as samples either");
}

// ---------------------------------------------------------------------------
section("only completed sessions count");
{
  const planned = planOf([
    session({ durationSec: 3600, avgHr: 170, maxHr: 195, status: "planned" }),
    session({ durationSec: 3600, avgHr: 168, maxHr: 190, status: "planned" }),
    session({ durationSec: 3600, avgHr: 166, maxHr: 189, status: "planned" }),
  ]);
  ok(observeHr(planned).maxHR === null && observeHr(planned).lthr === null, "sessions that were never done contribute nothing");
}

// ---------------------------------------------------------------------------
section("precedence: what the athlete typed always wins");
{
  const obs = { maxHR: 195, lthr: 170, samples: 5 };

  const typed = derivePaces({ ...profile, thresholdHr: 158, hrObserved: obs });
  ok(typed.hr.lthr === 158, `athlete's own 158 beats the observed 170 — got ${typed.hr.lthr}`);
  ok(typed.hr.lthrSource === "measured", `source stays "measured" — got ${typed.hr.lthrSource}`);

  const observed = derivePaces({ ...profile, hrObserved: obs });
  ok(observed.hr.lthr === 170, `nothing typed → uses the observed 170, got ${observed.hr.lthr}`);
  ok(observed.hr.lthrSource === "observed", `source is "observed" — got ${observed.hr.lthrSource}`);

  // the old behaviour, still the last resort
  const guessed = derivePaces({ ...profile, maxHR: 190 });
  ok(guessed.hr.lthr === 171, `no data at all → 0.9×maxHR, got ${guessed.hr.lthr}`);
  ok(guessed.hr.lthrSource === "estimated", "and it is labelled an estimate, not passed off as real");

  const nothing = derivePaces(profile);
  ok(nothing.hr.lthr === null && nothing.hr.lthrSource === null, "no inputs → no bpm, and no pretending");
}

// ---------------------------------------------------------------------------
section("observed anchors actually move the zones");
{
  const before = derivePaces({ ...profile, maxHR: 200 }); // guesses LTHR 180
  const after = derivePaces({ ...profile, maxHR: 200, hrObserved: { maxHR: 200, lthr: 168, samples: 4 } });
  ok(before.hr.zones[4].loBpm !== after.hr.zones[4].loBpm, "a real LTHR changes the Z4 band rather than being decorative");
  ok(
    after.hr.zones[4].loBpm !== undefined && after.hr.zones[4].loBpm < before.hr.zones[4].loBpm!,
    "a lower measured threshold lowers the band (the guess was optimistic)",
  );
}

console.log(`\n${checks - failures}/${checks} HR invariants passed`);
if (failures > 0) {
  console.error(`\n❌ ${failures} HR invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all HR invariants passed");
