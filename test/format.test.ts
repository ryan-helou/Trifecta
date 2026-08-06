// ---------------------------------------------------------------------------
// Invariants for the short session summary shown under a workout's title.
//
// Found on device: the sheet for "CSS Threshold Set" (44 min, 2.1 km) read
// "Swim · Threshold · 4 × 50m". The 4 × 50m was the WARM-UP build set; the main
// set was 6 × 200m. The summary took the first repeating segment it found, and
// in a swim the warm-up almost always repeats first — so the line that's meant
// to tell you what the session IS was advertising the part before it starts.
//
// Pure, no clock, no I/O. Run: npx tsx test/format.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { repsSummary } from "../lib/format";
import type { Profile, Segment, Workout } from "../lib/types";

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
  };
}
const plan = (over: Partial<Profile> = {}) => generatePlan(profile(over), ANCHOR);

/** The repeating sets a session actually contains, split by section. */
function repeatsIn(w: Workout, where: "warmup" | "cooldown" | "main"): Segment[] {
  return w.segments.filter((s) => {
    const sec = s.kind === "warmup" ? "warmup" : s.kind === "cooldown" ? "cooldown" : "main";
    return sec === where && (s.repeat ?? 1) > 1 && !!s.children?.length;
  });
}

// --- the main set wins ------------------------------------------------------
section("the summary describes the main set, never the warm-up");
{
  const p = plan();
  let checked = 0;
  let mainSetSessions = 0;
  for (const w of Object.values(p.workouts)) {
    const s = repsSummary(w);
    if (!s) continue;
    checked++;
    const main = repeatsIn(w, "main");
    const warm = repeatsIn(w, "warmup");
    if (!main.length) continue;
    mainSetSessions++;
    // whatever the summary says, its rep count must come from a MAIN-set repeat
    const n = Number(s.split(" ")[0]);
    ok(
      main.some((m) => m.repeat === n),
      `"${w.title}": summary "${s}" must count a main-set repeat (main: ${main.map((m) => m.repeat).join("/")}, warm-up: ${warm.map((m) => m.repeat).join("/") || "none"})`,
    );
  }
  ok(checked > 0, `at least one session in a generated plan has a rep summary (got ${checked})`);
  ok(mainSetSessions > 0, `at least one has a main set to describe (got ${mainSetSessions})`);
}

// --- it still falls back rather than going blank -----------------------------
section("a session with only a warm-up repeat still summarises");
{
  const warmOnly = {
    segments: [
      { kind: "warmup", repeat: 4, children: [{ kind: "work", distanceM: 50 }] },
      { kind: "work", durationSec: 600 },
    ],
  } as unknown as Workout;
  ok(repsSummary(warmOnly) === "4 × 50m", `falls back to the only repeat there is (got ${repsSummary(warmOnly)})`);

  const none = { segments: [{ kind: "work", durationSec: 1800 }] } as unknown as Workout;
  ok(repsSummary(none) === null, "a session with no repeats has no summary");

  const empty = { segments: [] } as unknown as Workout;
  ok(repsSummary(empty) === null, "an empty session never throws");
}

// --- units ------------------------------------------------------------------
section("distance and time repeats read the way a coach says them");
{
  const dist = {
    segments: [{ kind: "work", repeat: 6, children: [{ kind: "work", distanceM: 200 }, { kind: "rest", durationSec: 20 }] }],
  } as unknown as Workout;
  ok(repsSummary(dist) === "6 × 200m", `distance repeats use metres (got ${repsSummary(dist)})`);

  const time = {
    segments: [{ kind: "work", repeat: 5, children: [{ kind: "work", durationSec: 180 }, { kind: "rest", durationSec: 60 }] }],
  } as unknown as Workout;
  ok(repsSummary(time) === "5 × 3′", `time repeats use minutes (got ${repsSummary(time)})`);

  // Sub-minute repeats must not round to zero. The old rule surfaced this on a real
  // plan: "Run Threshold 5x1km" summarised as "4 x 0'" — the warm-up strides are 20s,
  // and minutes-rounding turned them into nothing at all.
  const short = {
    segments: [{ kind: "work", repeat: 4, children: [{ kind: "work", durationSec: 20 }, { kind: "rest", durationSec: 40 }] }],
  } as unknown as Workout;
  ok(repsSummary(short) === "4 × 20s", `sub-minute repeats stay in seconds (got ${repsSummary(short)})`);

  const ninety = {
    segments: [{ kind: "work", repeat: 3, children: [{ kind: "work", durationSec: 90 }] }],
  } as unknown as Workout;
  ok(repsSummary(ninety) === "3 × 90s", `awkward durations don't round away (got ${repsSummary(ninety)})`);

  // whatever the shape, a summary never claims a zero-sized repeat
  const p2 = plan();
  for (const w of Object.values(p2.workouts)) {
    const s = repsSummary(w);
    if (s) ok(!/[× ]0[′s]/.test(s), `"${w.title}": summary "${s}" must never describe a zero-length rep`);
  }

  // rest children must never be what gets described
  const restFirst = {
    segments: [{ kind: "work", repeat: 3, children: [{ kind: "rest", durationSec: 30 }, { kind: "work", distanceM: 400 }] }],
  } as unknown as Workout;
  ok(repsSummary(restFirst) === "3 × 400m", `the work child is described, not the rest (got ${repsSummary(restFirst)})`);
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} session-summary invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all session-summary invariants passed");
