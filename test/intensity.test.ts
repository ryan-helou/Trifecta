/**
 * Training-intensity distribution invariants.
 *
 * Doc 04 §4.1 #12 listed the distribution as an invariant and then admitted it was
 * "currently emergent, unchecked". It was, and what that hid was worse than skew: the
 * relationship with fitness was INVERTED. Measured across the engine's own archetypes, a
 * 70.3 intermediate carried 13.1% threshold time while an elite Ironman athlete carried
 * 6.2% — the fitter you were, the easier your plan. The cause was structural: quality
 * sessions were fixed-size while long and easy sessions absorbed every extra hour of
 * `targetHours`, so more volume could only ever mean more easy volume.
 *
 * None of it was visible to the existing tests, which assert session COUNTS ("≥50% of
 * sessions are easy") rather than TIME. This file asserts time.
 */
import { generatePlan } from "../lib/planEngine";
import { intensityTarget, qualityShare } from "../lib/intensity";
import { checkRails, BLOCK_HARD_MIN, BLOCK_HARD_MAX } from "../lib/rails";
import type { Cat, Level, Plan, Profile, Segment, Workout } from "../lib/types";
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
const profile = (o: Partial<Profile>): Profile =>
  ({ username: "test", raceType: "half", raceDateISO: weeksFrom(20),
     level: "intermediate", workoutsPerWeek: 6, createdAtISO: ANCHOR, ...o }) as Profile;

/** Time-in-zone, walking repeats and children as `measure()` does. Distance-prescribed
 *  work (swim sets) carries no duration, so those fall back to the session's estimate. */
function tiz(w: Workout): Record<number, number> {
  const out: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const walk = (segs: Segment[], mult: number) => {
    for (const s of segs) {
      const reps = s.repeat ?? 1;
      if (s.children?.length) { walk(s.children, mult * reps); continue; }
      const sec = s.durationSec ?? 0;
      if (s.kind === "rest") { out[1] += reps * mult * sec; continue; }
      out[(s.zone ?? 2) as number] += reps * mult * sec;
    }
  };
  walk(w.segments ?? [], 1);
  const tot = Object.values(out).reduce((a, b) => a + b, 0);
  if (tot <= 0) { out[w.primaryZone] = w.estDurationSec; return out; }
  const k = (w.estDurationSec || tot) / tot;
  for (const z of [1, 2, 3, 4, 5]) out[z] *= k;
  return out;
}

/** Block-level 3-zone split (easy < LT1, threshold LT1–LT2, hard > LT2), excluding taper
 *  and race week exactly as `blockHardShare` does. */
function blockTid(plan: Plan) {
  const z: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sec = 0;
  for (const wk of plan.weeks) {
    if (wk.isRaceWeek || wk.phase === "taper") continue;
    for (const id of wk.workoutIds) {
      const w = plan.workouts[id];
      if (!w || w.discipline === "rest" || w.discipline === "strength") continue;
      const t = tiz(w);
      for (const k of [1, 2, 3, 4, 5]) z[k] += t[k];
      sec += w.estDurationSec;
    }
  }
  return sec > 0 ? { easy: (z[1] + z[2]) / sec, threshold: (z[3] + z[4]) / sec, hard: z[5] / sec } : null;
}
const quality = (t: NonNullable<ReturnType<typeof blockTid>>) => t.threshold + t.hard;
const LEVELS: Level[] = ["beginner", "intermediate", "advanced", "elite"];

// ---- 1. THE regression: more athlete must mean more quality ----------------
// Measured before the fix, at a FIXED distance so only level varies: the curve ran
// backwards. This is the assertion the whole file exists for.
section("quality rises with the athlete, never falls");
for (const [name, over] of [
  ["full", { raceType: "full" as const, workoutsPerWeek: 10, raceDateISO: weeksFrom(30) }],
  ["70.3", { raceType: "half" as const, workoutsPerWeek: 8, raceDateISO: weeksFrom(20) }],
] as const) {
  const shares = LEVELS.map((level) => {
    const t = blockTid(generatePlan(profile({ ...over, level }), ANCHOR));
    return { level, q: t ? quality(t) : 0 };
  });
  for (let i = 1; i < shares.length; i++) {
    // a small dip is tolerable (a stronger athlete also carries more long-session volume,
    // which dilutes); a REVERSAL of the trend is not
    ok(
      shares[i].q >= shares[i - 1].q - 0.015,
      `${name}: ${shares[i].level} carries at least as much quality as ${shares[i - 1].level} ` +
        `(${(shares[i].q * 100).toFixed(1)}% vs ${(shares[i - 1].q * 100).toFixed(1)}%)`,
    );
  }
  ok(
    shares[3].q > shares[0].q,
    `${name}: elite ends up above beginner (${(shares[3].q * 100).toFixed(1)}% vs ${(shares[0].q * 100).toFixed(1)}%)`,
  );
}

// ---- 2. the block is neither a jog nor a race ------------------------------
// Two bounds, and the FLOOR is the one that matters — the engine's real failure was being
// too easy, and every guard it had pointed the other way.
section("block intensity sits inside a defensible band");
{
  const CASES: { name: string; p: Profile; cat: Cat }[] = [
    { name: "70.3/beginner/5", p: profile({ level: "beginner", workoutsPerWeek: 5, raceDateISO: weeksFrom(16) }), cat: "half" },
    { name: "70.3/intermediate/6", p: profile({}), cat: "half" },
    { name: "70.3/advanced/9", p: profile({ level: "advanced", workoutsPerWeek: 9, raceDateISO: weeksFrom(24) }), cat: "half" },
    { name: "full/advanced/10", p: profile({ raceType: "full", level: "advanced", workoutsPerWeek: 10, raceDateISO: weeksFrom(30) }), cat: "full" },
    { name: "full/elite/14", p: profile({ raceType: "full", level: "elite", workoutsPerWeek: 14, raceDateISO: weeksFrom(40) }), cat: "full" },
    { name: "olympic/intermediate/7", p: profile({ raceType: "olympic", workoutsPerWeek: 7, raceDateISO: weeksFrom(16) }), cat: "olympic" },
    { name: "fitness/intermediate/6", p: profile({ raceType: "fitness", raceDateISO: "" }), cat: "olympic" },
  ];
  for (const c of CASES) {
    const plan = generatePlan(c.p, ANCHOR);
    const tid = blockTid(plan);
    ok(tid != null, `${c.name}: block has endurance time`);
    if (!tid) continue;
    const pct = (v: number) => (v * 100).toFixed(1) + "%";
    // A whole BLOCK includes early base, which is deliberately aerobic, so it sits easier
    // than any single build week — but never at the 90%+ the old engine produced for its
    // strongest athletes.
    ok(tid.easy <= 0.92, `${c.name}: not a jog — easy time ${pct(tid.easy)} ≤ 92%`);
    ok(tid.easy >= 0.72, `${c.name}: still polarized — easy time ${pct(tid.easy)} ≥ 72%`);
    ok(quality(tid) >= 0.07, `${c.name}: carries real quality — ${pct(quality(tid))} ≥ 7%`);
    const r = checkRails(plan);
    ok(r.ok, `${c.name}: rails clean — ${r.violations.map((v) => v.detail).join("; ") || "ok"}`);
  }
}

// ---- 3. the rails bound BOTH directions ------------------------------------
section("the rails catch a block that has gone empty, not just one gone hot");
{
  ok(BLOCK_HARD_MIN > 0 && BLOCK_HARD_MIN < BLOCK_HARD_MAX, `the floor is below the ceiling (${BLOCK_HARD_MIN} < ${BLOCK_HARD_MAX})`);
  // strip every hard session out and the floor must fire — this is the shape the engine
  // actually drifted into, and nothing used to notice
  const plan = generatePlan(profile({ raceType: "full", level: "advanced", workoutsPerWeek: 10, raceDateISO: weeksFrom(30) }), ANCHOR);
  ok(checkRails(plan).ok, "the real plan is clean");
  const flattened: Plan = {
    ...plan,
    workouts: Object.fromEntries(
      Object.entries(plan.workouts).map(([id, w]) => [id, { ...w, primaryZone: Math.min(w.primaryZone, 2) as Workout["primaryZone"] }]),
    ),
  };
  const v = checkRails(flattened).violations;
  ok(v.some((x) => x.kind === "block-too-easy"), `an all-easy block is flagged (${v.map((x) => x.kind).join(",") || "nothing"})`);
}

// ---- 4. the intensity table is internally coherent -------------------------
section("intensityTarget is internally consistent");
{
  for (const cat of ["olympic", "half", "full"] as Cat[]) {
    for (const level of LEVELS) {
      for (const phase of ["base", "build", "peak", "taper"] as const) {
        const t = intensityTarget(cat, level, phase);
        const sum = t.easy + t.threshold + t.hard;
        ok(Math.abs(sum - 1) < 1e-9, `${cat}/${level}/${phase}: shares sum to 1 (${sum.toFixed(4)})`);
        ok(t.easy > 0.5 && t.easy < 1, `${cat}/${level}/${phase}: easy is still the majority (${t.easy.toFixed(2)})`);
      }
      ok(
        qualityShare(intensityTarget(cat, level, "base")) <= qualityShare(intensityTarget(cat, level, "build")),
        `${cat}/${level}: build carries at least as much quality as base`,
      );
      ok(
        qualityShare(intensityTarget(cat, level, "build", true)) < qualityShare(intensityTarget(cat, level, "build")),
        `${cat}/${level}: a recovery week is easier than the load week around it`,
      );
    }
    // the target itself must rise with level, or nothing downstream can
    for (let i = 1; i < LEVELS.length; i++) {
      ok(
        qualityShare(intensityTarget(cat, LEVELS[i], "build")) > qualityShare(intensityTarget(cat, LEVELS[i - 1], "build")),
        `${cat}: ${LEVELS[i]} is targeted harder than ${LEVELS[i - 1]}`,
      );
    }
  }
  ok(
    qualityShare(intensityTarget("half", "elite", "build", false, { masters: true })) <
      qualityShare(intensityTarget("half", "elite", "build")),
    "a masters athlete is prescribed less intensity than the same level under 50",
  );
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) { console.error(`\n❌ ${failures} intensity invariant(s) FAILED`); process.exit(1); }
console.log("\n✅ all intensity invariants passed");
