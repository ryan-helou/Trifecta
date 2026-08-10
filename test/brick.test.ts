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
import { gainMultiplier } from "../lib/predict";
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

// --- 7. #194/#193 — a deload doesn't quietly cancel your gym -------------
section("recovery weeks keep the gym frequency you asked for");
{
  const withGym = generatePlan(
    { username: "t", raceType: "half", raceDateISO: d(154), level: "intermediate", workoutsPerWeek: 8,
      createdAtISO: ANCHOR, perSport: { swim: 2, bike: 3, run: 3 },
      strength: { enabled: true, daysPerWeek: 3, split: "full" } } as unknown as Profile,
    ANCHOR,
  );
  const rec = withGym.weeks.filter((w) => w.isRecovery);
  ok(rec.length > 0, "the plan has recovery weeks to check");
  for (const wk of rec) {
    const gym = wk.workoutIds.map((id) => withGym.workouts[id]).filter((w) => w?.discipline === "strength");
    // #194 — asked for 3, deloads used to hand back 1
    ok(gym.length === 3, `recovery week ${wk.index + 1}: 3 gym sessions, not ${gym.length}`);
    // #193 — and they're the athlete's chosen split, not a Core & Mobility swap
    for (const g of gym) {
      ok(!/core & mobility/i.test(g.title), `recovery week ${wk.index + 1}: "${g.title}" is not a core/mobility substitute`);
    }
  }
  // the deload still deloads — ENDURANCE volume is what drops
  for (const wk of rec) {
    const prev = withGym.weeks.find((w) => w.index === wk.index - 1);
    if (!prev || prev.isRecovery) continue;
    const endur = (w: typeof wk) =>
      w.workoutIds.map((id) => withGym.workouts[id]).filter((x) => x && x.discipline !== "rest" && x.discipline !== "strength")
        .reduce((a, x) => a + x!.estDurationSec, 0);
    ok(endur(wk) < endur(prev), `recovery week ${wk.index + 1} still cuts endurance volume`);
  }
}

// --- 8. #195 — base has quality, and is still overwhelmingly easy ---------
section("base contains real quality without becoming spicy");
{
  for (const [rt, wpw] of ARCH) {
    for (const lvl of ["beginner", "intermediate", "advanced"] as const) {
      const p = generatePlan(
        { username: "t", raceType: rt, raceDateISO: d(154), level: lvl, workoutsPerWeek: wpw, createdAtISO: ANCHOR } as Profile,
        ANCHOR,
      );
      const baseWeeks = p.weeks.filter((w) => w.phase === "base");
      const sessions = baseWeeks.flatMap((w) => w.workoutIds.map((id) => p.workouts[id]))
        .filter((w): w is Workout => !!w && w.discipline !== "rest" && w.discipline !== "strength");
      if (!sessions.length) continue;

      // it exists at all — base used to be 100% Z2
      ok(sessions.some((w) => w.primaryZone >= 3), `${rt}/${lvl}: base contains some quality`);

      // ...and the 80/20 floor holds. Doc 01 §4 #2 treats dipping under ~75%
      // easy as a bug, and "too spicy too early" is the category's injury story.
      const total = sessions.reduce((a, w) => a + w.estDurationSec, 0) || 1;
      const easy = sessions.filter((w) => w.primaryZone <= 2).reduce((a, w) => a + w.estDurationSec, 0);
      const easyPct = (100 * easy) / total;
      ok(easyPct >= 80, `${rt}/${lvl}: base is ${easyPct.toFixed(1)}% easy (floor 80)`);

      // nothing above sweet spot belongs in base — threshold and VO2 are build work
      for (const w of sessions) {
        ok(w.primaryZone <= 4, `${rt}/${lvl}: no Z5 in base ("${w.title}")`);
      }
      // and the first two base weeks stay purely aerobic
      const first = baseWeeks.slice(0, 2).flatMap((w) => w.workoutIds.map((id) => p.workouts[id]))
        .filter((w): w is Workout => !!w && w.discipline !== "rest" && w.discipline !== "strength");
      for (const w of first) {
        ok(w.primaryZone <= 2, `${rt}/${lvl}: week 1-2 of base is aerobic ("${w.title}" Z${w.primaryZone})`);
      }
    }
  }
}

// --- 9. #196 — a longer runway predicts a bigger improvement -------------
section("improvement keeps accruing past 16 weeks, with diminishing returns");
{
  ok(Math.abs(gainMultiplier(16) - 1) < 0.001, "16 weeks is still exactly one build block (nothing already shipped moves)");
  ok(gainMultiplier(52) > gainMultiplier(16), "a year beats 16 weeks — the old model capped them equal");
  ok(gainMultiplier(104) > gainMultiplier(52), "two years beats one");
  // Diminishing means EQUAL windows add less as you go out. Comparing 16→32
  // against 32→64 fails for the wrong reason — the second window is twice as
  // long, so of course it adds more. Same-width windows is the real test.
  const w1 = gainMultiplier(32) - gainMultiplier(16);
  const w2 = gainMultiplier(48) - gainMultiplier(32);
  const w3 = gainMultiplier(64) - gainMultiplier(48);
  ok(w2 < w1 && w3 < w2, `each further 16 weeks adds less (${w1.toFixed(2)} → ${w2.toFixed(2)} → ${w3.toFixed(2)})`);
  ok(gainMultiplier(0) === 0, "no runway, no projected gain");
  // bounded — it can never promise the impossible
  for (const w of [200, 500, 5000]) ok(gainMultiplier(w) < 4.001, `${w} weeks stays under the ceiling`);
  ok(gainMultiplier(1) > 0 && gainMultiplier(1) < 0.2, "one week is worth something, but barely");
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} brick invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all brick invariants passed");
