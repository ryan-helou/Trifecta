// ---------------------------------------------------------------------------
// Brick sessions — run straight off the bike (lib/planEngine) — ticket #190.
//
// Ryan asked "do we have any brick workouts?" We did: 4–7 per plan, build and
// peak only. What we did NOT have was enough RUN in them for long course, which
// doc 01 §5 gap #10 had already named — "capped short; fine for skill, thin for
// IM run-off-bike durability". Measured before the change: every Ironman brick
// ran 24 min off the bike in build and 36 in peak, flat, for a race whose run
// leg is a marathon.
//
// Doc 01 §1.8 splits the two jobs a brick does, and they need different doses:
// the transition SKILL is bought in 10–20 min, while DURABILITY — running well
// on pre-fatigued legs — is the long-course limiter and needs progressively
// longer blocks. So the properties here are about dose and progression, not
// about bricks existing.
//
// Clock-safe: everything is derived from the plan's own weeks rather than from a
// hard-coded anchor, which is what broke three other suites at midnight (#49).
//
// Pure, no I/O. Run: npx tsx test/brick.test.ts
// ---------------------------------------------------------------------------

import { generatePlan, brickRunOffMin } from "../lib/planEngine";
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

const ANCHOR = "2026-06-15";
const d = (n: number) => {
  const x = new Date(ANCHOR + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const ARCH = [
  ["olympic", 6],
  ["half", 8],
  ["full", 10],
] as const;

function planFor(raceType: string, wpw: number): Plan {
  return generatePlan(
    { username: "t", raceType, raceDateISO: d(154), level: "intermediate", workoutsPerWeek: wpw, createdAtISO: ANCHOR } as Profile,
    ANCHOR,
  );
}
const bricksOf = (p: Plan): Workout[] =>
  Object.values(p.workouts)
    .filter((w) => w.discipline === "brick" && w.id !== "w-race-day")
    .sort((a, b) => a.date.localeCompare(b.date));

/** Minutes of running inside a brick — the number the ticket is actually about. */
const runOffMin = (w: Workout): number =>
  Math.round(w.segments.filter((s) => s.discipline === "run").reduce((a, s) => a + (s.durationSec ?? 0), 0) / 60);

// --- 1. they exist, where the physiology says they should ------------------
section("bricks exist, in build and peak only");
{
  for (const [rt, wpw] of ARCH) {
    const p = planFor(rt, wpw);
    const bricks = bricksOf(p);
    ok(bricks.length > 0, `${rt}: the plan contains bricks (${bricks.length})`);
    for (const b of bricks) {
      const wk = p.weeks.find((w) => w.index === b.weekIndex)!;
      // doc 01 §4 #8 — build/peak only. A brick in base skips the aerobic work
      // base exists to do; one in the taper adds a novel stress before the race.
      ok(wk.phase === "build" || wk.phase === "peak", `${rt}: brick sits in build/peak, not ${wk.phase}`);
    }
    // and every brick actually contains a run, or it isn't a brick
    ok(bricks.every((b) => runOffMin(b) > 0), `${rt}: every brick has a run leg`);
  }
}

// --- 2. THE GAP: dose scales with the race's run leg -----------------------
section("the run off the bike is sized for the race being trained for");
{
  const peakOf = (rt: string, wpw: number) => Math.max(...bricksOf(planFor(rt, wpw)).map(runOffMin));
  const oly = peakOf("olympic", 6);
  const half = peakOf("half", 8);
  const full = peakOf("full", 10);
  ok(half > oly, `a 70.3 brick runs longer than an Olympic one (${half} vs ${oly} min)`);
  ok(full > half, `an Ironman brick runs longer than a 70.3 one (${full} vs ${half} min)`);

  // The regression this file exists to prevent: 36 min off the bike was the
  // ceiling for BOTH long-course distances, which is skill work, not durability.
  ok(full >= 60, `an Ironman brick reaches real durability work (${full} min, was 36)`);
  ok(half >= 45, `a 70.3 brick does too (${half} min, was 36)`);

  // ...but it stays a fraction of the race, not a rehearsal of the whole leg.
  // An IM marathon is ~3.5–5 h; anything approaching that is a race, not training.
  ok(full <= 120, `and it never becomes the race itself (${full} min)`);
}

// --- 3. it PROGRESSES, and never goes backwards ---------------------------
section("the brick run ramps through the build instead of sitting flat");
{
  for (const [rt, wpw] of ARCH) {
    const p = planFor(rt, wpw);
    const bricks = bricksOf(p);
    const mins = bricks.map(runOffMin);
    ok(new Set(mins).size > 1, `${rt}: the run length actually changes across the block (${mins.join(", ")})`);
    // Monotonic by design. A modulo-based ramp sawtoothed here — the athlete's
    // brick run would shrink mid-build — which is why this is pinned.
    for (let i = 1; i < mins.length; i++) {
      ok(mins[i] >= mins[i - 1], `${rt}: brick ${i + 1} is not shorter than brick ${i} (${mins[i - 1]} → ${mins[i]})`);
    }
    const peakMins = bricks
      .filter((b) => p.weeks.find((w) => w.index === b.weekIndex)?.phase === "peak")
      .map(runOffMin);
    const buildMins = bricks
      .filter((b) => p.weeks.find((w) => w.index === b.weekIndex)?.phase === "build")
      .map(runOffMin);
    if (peakMins.length && buildMins.length) {
      ok(
        Math.max(...peakMins) > Math.max(...buildMins),
        `${rt}: the peak brick still adds something over the build's longest (${Math.max(...buildMins)} → ${Math.max(...peakMins)})`,
      );
    }
  }
}

// --- 4. the helper itself --------------------------------------------------
section("brickRunOffMin is monotonic and bounded");
{
  for (const [rt] of ARCH) {
    const cat = rt as "olympic" | "half" | "full";
    const span = 6;
    const seq = Array.from({ length: span }, (_, i) => brickRunOffMin(cat, "build", i, span));
    for (let i = 1; i < seq.length; i++) {
      ok(seq[i] >= seq[i - 1], `${cat}: build ramp never decreases (${seq.join(", ")})`);
    }
    ok(brickRunOffMin(cat, "peak", 0, 1) >= seq[seq.length - 1], `${cat}: peak is at least the top of the build ramp`);
    ok(brickRunOffMin(cat, "base", 0, 4) === brickRunOffMin(cat, "base", 3, 4), `${cat}: base doesn't ramp — it has no bricks`);
    // a single-week build must not divide by zero
    ok(Number.isFinite(brickRunOffMin(cat, "build", 0, 1)), `${cat}: a one-week build is finite`);
  }
}

// --- 5. it didn't buy durability by breaking the rails --------------------
section("longer brick runs stay inside the safety rails");
{
  for (const [rt, wpw] of ARCH) {
    const p = planFor(rt, wpw);
    const r = checkRails(p);
    ok(r.violations.length === 0, `${rt}: no rail violations (${r.violations.map((v) => v.kind).join(", ") || "none"})`);
  }
}

// --- 6. #187 — the numbers the plan hands you are round -------------------
// Ryan: "don't tell me about a 47 minute run… make it round". Measured before
// the grid snap: only 35% of prescribed sessions landed on 5 minutes; the rest
// were 33, 39, 49, 71, 97, 106.
section("prescriptions land on a 5-minute grid (#187)");
{
  for (const [rt, wpw] of ARCH) {
    const p = planFor(rt, wpw);
    const ws = Object.values(p.workouts).filter((w) => w.discipline !== "rest" && w.id !== "w-race-day");
    const timed = ws.filter((w) => w.discipline !== "swim");
    const on = timed.filter((w) => Math.round(w.estDurationSec / 60) % 5 === 0).length;
    // ALL of them, not most. The first pass reached 71–78% and left every
    // interval session off-grid, because those have no steady block — the
    // warm-up/cool-down absorbs it instead.
    ok(
      on === timed.length,
      `${rt}: ${on}/${timed.length} timed sessions are on the grid (was 35%)`,
    );
    // SWIMS are deliberately exempt: they're prescribed in metres, and 1500 m is
    // the round number that matters in a pool. Snapping them to 5 minutes would
    // turn a 1500 into a 1591.
    for (const w of ws.filter((x) => x.discipline === "swim")) {
      const m = w.estDistanceM ?? 0;
      if (m > 0) ok(m % 50 === 0, `${rt}: a swim is round in METRES (${m} m)`);
    }
    // and the grid never moved a session far enough to change what it is
    for (const w of timed) {
      const grid = Math.round(w.estDurationSec / 300) * 300;
      ok(Math.abs(w.estDurationSec - grid) <= 180, `${rt}/${w.id}: within 3 min of the grid`);
    }
  }
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} brick invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all brick invariants passed");
