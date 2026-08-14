// ---------------------------------------------------------------------------
// Safety rails — the bounds a plan must stay inside, checkable at RUNTIME.
//
// These exist because the plan is about to stop being a static artifact. Once
// it re-prescribes itself from what the athlete actually did, every adaptation
// is a chance to drift: shave the easy volume off enough weeks and a polarized
// plan quietly becomes a threshold grinder; let each week answer only to the
// week before it and the ramp compounds. Nothing in the codebase noticed either
// (doc 04 §4.1 #10 "not currently enforced", #12 "currently emergent,
// unchecked"). So the rails ship BEFORE the responsiveness.
//
// WHAT THE RAILS ARE NOT
// Doc 04 §4.1 #12 states the intensity rule as "across a normal week, Z4-Z5
// time sits ~15-25%". Measured against the real engine, that rail is wrong and
// would fail correct plans: base weeks run 0% Z4+ and taper weeks run up to 56%.
// Both are deliberate. Doc 01 §4 #3 says shape quality BY PHASE, not by a single
// dogma — base is aerobic, short course earns more threshold/VO2 — and §4 #6 says
// the taper HOLDS intensity while cutting volume, which mechanically drives the
// share up. Measured block-level share is 8-19%, i.e. properly polarized.
//
// So the rails are set where the physiology actually binds:
//   - the 80/20 claim is a BLOCK-level claim, so it is checked at block level
//   - per-week intensity gets a loose ceiling, as an intensity-bomb guard only
//   - the taper is exempt from that ceiling, by doc 01 §4 #6
//   - the ramp is bounded between consecutive LOAD weeks (deload bounces exempt)
//
// Thresholds sit above today's measured worst case with margin, so a correct
// plan never false-fails. They are ceilings on ADAPTATION drift, not an attempt
// to re-periodize the engine. Pure — no clock, no I/O.
// ---------------------------------------------------------------------------

import type { Plan, Week, Workout } from "./types";

// WHAT THESE MEASURE, because it is easy to misread. `weekMinutes` buckets a session by its
// `primaryZone`, so a 115-minute threshold ride counts as 115 hard minutes though only ~60
// are at threshold. A deliberately coarse proxy — cheap, no segment walk, and drift shows up
// in it just as clearly — but it runs roughly 2x the true time-in-zone, so these numbers are
// NOT comparable to the 80/20 literature. They are drift rails, not physiology.

/** Block-level ceiling on the Z4+ share.
 *
 *  Was 0.25, set when the engine emitted 8-19% because quality sessions were fixed-size and
 *  every extra hour landed on easy work. Now that quality scales with the athlete the real
 *  range is 18-31%, the top being Olympic distance, which is legitimately the sharpest thing
 *  we program. Set just above that: enough that a correct plan never false-fails, tight
 *  enough that drift still has somewhere to hit. 0.40 was the first attempt and it was too
 *  loose — 25 hand edits walked a block from 22% to 37% with nothing refusing any of them.
 *  This rail catches ADAPTATION drift; it is not a second periodisation engine. */
export const BLOCK_HARD_MAX = 0.35;

/** Block-level FLOOR on the Z4+ share.
 *
 *  New, and the reason it is new: every rail here guarded one direction, and the engine's
 *  actual defect ran the other way. Plans drifted to 90%+ easy — the fitter the athlete, the
 *  easier the plan — and nothing noticed, because "too easy" had no bound. Easing is
 *  deliberately unlimited (doc 03 §4 C, protect fast), so a long enough run of eased weeks
 *  can hollow a block out entirely. Set well below the measured minimum so ordinary easing
 *  never trips it, but high enough to catch a block that has stopped containing training. */
export const BLOCK_HARD_MIN = 0.1;

/** Per-week ceiling on Z4+ time share, outside the taper. NOT an 80/20 rule — a guard
 *  against one week becoming an intensity bomb.
 *
 *  Raised 0.55 -> 0.70. The old figure was measured when base weeks carried no quality at
 *  all; short-course build weeks now legitimately reach 56-58% on the coarse proxy above
 *  (a whole threshold session counts as hard minutes, not just its work intervals), and
 *  Olympic distance is the sharpest thing we program by design — doc 01 §4 #3 asks for
 *  more threshold/VO2 at short course. Still well below a week that is genuinely a bomb. */
export const WEEK_HARD_MAX = 0.7;

/** Week-over-week volume ratio between consecutive load weeks. The field
 *  heuristic is ~10%/week; the engine's real worst is 19.6% coming out of a
 *  deload, which is ordinary coaching. Measured today: 7.8%-19.6%. */
export const RAMP_MAX = 1.25;

export type RailKind = "block-intensity" | "block-too-easy" | "week-intensity" | "ramp";

export interface RailViolation {
  kind: RailKind;
  /** week index the violation is attributed to; absent for block-level */
  weekIndex?: number;
  value: number;
  limit: number;
  detail: string;
}

export interface RailReport {
  ok: boolean;
  violations: RailViolation[];
  blockHardShare: number | null;
}

/** Sessions that count toward intensity distribution: real endurance work.
 *  Rest is not training; strength is not aerobic intensity and would skew the
 *  denominator against the sports the distribution is about. */
function countsForIntensity(w: Workout | undefined): w is Workout {
  return !!w && w.discipline !== "rest" && w.discipline !== "strength";
}

function weekMinutes(plan: Plan, week: Week): { hard: number; total: number } {
  let hard = 0;
  let total = 0;
  for (const id of week.workoutIds) {
    const w = plan.workouts[id];
    if (!countsForIntensity(w)) continue;
    const min = (w.estDurationSec ?? 0) / 60;
    total += min;
    if (w.primaryZone >= 4) hard += min;
  }
  return { hard, total };
}

/** Share of a week's endurance time spent at Z4+. null when the week has no
 *  endurance work at all (an all-strength or all-rest week divides by zero). */
export function weekHardShare(plan: Plan, week: Week): number | null {
  const { hard, total } = weekMinutes(plan, week);
  return total > 0 ? hard / total : null;
}

/** Share of endurance time at Z4+ across the whole training block — every week
 *  except the taper and race week, which are deliberately intensity-dense while
 *  volume collapses (doc 01 §4 #6) and would misrepresent the block. */
export function blockHardShare(plan: Plan): number | null {
  const { hard, total } = blockMinutes(plan);
  return total > 0 ? hard / total : null;
}

/** The block's Z4+ time in ABSOLUTE terms, and the total it is a share of.
 *
 *  `blockHardShare` is a ratio, and a ratio moves for two completely different
 *  reasons: hard work was removed, or easy work was added. Only the first is a
 *  loss. This exposes the numerator so the regression check can tell them apart —
 *  see `railsRegressed`. */
export function blockMinutes(plan: Plan): { hard: number; total: number } {
  let hard = 0;
  let total = 0;
  for (const week of plan.weeks) {
    if (week.isRaceWeek || week.phase === "taper") continue;
    const m = weekMinutes(plan, week);
    hard += m.hard;
    total += m.total;
  }
  return { hard, total };
}

/** Total prescribed endurance+strength hours in a week — the volume the ramp is
 *  measured on. Unlike `targetHours` this is what was actually prescribed, so it
 *  stays honest after the plan has been adapted. */
export function weekHours(plan: Plan, week: Week): number {
  let sec = 0;
  for (const id of week.workoutIds) {
    const w = plan.workouts[id];
    if (!w || w.discipline === "rest") continue;
    sec += w.estDurationSec ?? 0;
  }
  return sec / 3600;
}

export interface Ramp {
  fromIndex: number;
  toIndex: number;
  ratio: number;
}

/** Volume ratios between CONSECUTIVE LOAD weeks. Recovery and race weeks are
 *  skipped rather than compared: a deload is supposed to drop hard and the
 *  rebuild out of it is supposed to jump, so including them would flag correct
 *  periodization as a spike. */
export function loadWeekRamps(plan: Plan): Ramp[] {
  const load = plan.weeks
    .filter((w) => !w.isRecovery && !w.isRaceWeek)
    .map((w) => ({ index: w.index, hours: weekHours(plan, w) }));
  const out: Ramp[] = [];
  for (let i = 1; i < load.length; i++) {
    const prev = load[i - 1];
    const cur = load[i];
    if (prev.hours <= 0) continue;
    out.push({ fromIndex: prev.index, toIndex: cur.index, ratio: cur.hours / prev.hours });
  }
  return out;
}

/** Check a plan against every rail. Cheap enough to run on a CANDIDATE plan
 *  before applying an adaptation — which is the point of it existing. */
export function checkRails(plan: Plan): RailReport {
  const violations: RailViolation[] = [];

  const block = blockHardShare(plan);
  if (block != null && block > BLOCK_HARD_MAX) {
    violations.push({
      kind: "block-intensity",
      value: block,
      limit: BLOCK_HARD_MAX,
      detail: `block is ${(block * 100).toFixed(0)}% Z4+ time (limit ${(BLOCK_HARD_MAX * 100).toFixed(0)}%) — the plan has stopped being polarized`,
    });
  }

  // The other direction. A block can be wrong by being empty, and until now nothing said so.
  if (block != null && block < BLOCK_HARD_MIN) {
    violations.push({
      kind: "block-too-easy",
      value: block,
      limit: BLOCK_HARD_MIN,
      detail: `block is only ${(block * 100).toFixed(0)}% Z4+ time (floor ${(BLOCK_HARD_MIN * 100).toFixed(0)}%) — this has stopped being a training block`,
    });
  }

  for (const week of plan.weeks) {
    // the taper is INTENDED to be intensity-dense while volume falls away
    if (week.phase === "taper" || week.isRaceWeek) continue;
    const share = weekHardShare(plan, week);
    if (share != null && share > WEEK_HARD_MAX) {
      violations.push({
        kind: "week-intensity",
        weekIndex: week.index,
        value: share,
        limit: WEEK_HARD_MAX,
        detail: `week ${week.index + 1} is ${(share * 100).toFixed(0)}% Z4+ time (limit ${(WEEK_HARD_MAX * 100).toFixed(0)}%)`,
      });
    }
  }

  for (const r of loadWeekRamps(plan)) {
    if (r.ratio > RAMP_MAX) {
      violations.push({
        kind: "ramp",
        weekIndex: r.toIndex,
        value: r.ratio,
        limit: RAMP_MAX,
        detail: `week ${r.toIndex + 1} jumps ${((r.ratio - 1) * 100).toFixed(0)}% over week ${r.fromIndex + 1} (limit ${((RAMP_MAX - 1) * 100).toFixed(0)}%)`,
      });
    }
  }

  return { ok: violations.length === 0, violations, blockHardShare: block };
}

/** Did any week get longer, or gain hard minutes? Weeks are matched by index —
 *  a week present in `after` but not `before` counts as an increase, since a
 *  newly added week is new load by definition. */
export function increasesAnyWeek(before: Plan, after: Plan): boolean {
  const prior = new Map(before.weeks.map((w) => [w.index, w]));
  for (const week of after.weeks) {
    const was = prior.get(week.index);
    if (!was) return true;
    if (weekHours(after, week) > weekHours(before, was) + 1e-9) return true;
    if (weekMinutes(after, week).hard > weekMinutes(before, was).hard + 1e-9) return true;
  }
  return false;
}

/** Did an adaptation make things WORSE?
 *
 *  The right question for a candidate plan is not "is it clean" — a plan can
 *  legitimately sit near a bound already, and an athlete who has been ill for
 *  three weeks may have a plan that is out of band through no fault of the
 *  adaptation about to be applied. Rejecting on absolute cleanliness would
 *  freeze exactly the athlete who most needs the plan to move. So compare:
 *  block off a change only when it introduces a new kind of violation, or
 *  pushes an existing one further out. */
export function railsRegressed(before: Plan, after: Plan): RailViolation[] {
  // A change that only ever REDUCES load cannot make the athlete less safe, and
  // must never be gated — doc 03 §4 C, protect fast and add slow. This clause is
  // load-bearing, not a shortcut: without it, easing is self-blocking. Soften
  // week N and leave N+1 alone and the ramp N→N+1 mechanically grows, so the
  // ramp rail fires and refuses the ease, leaving the athlete to ride out the
  // hard week. (The downstream jump it spots is real — the fix is for the
  // adaptation to ease FORWARD rather than for the gate to withhold relief.)
  if (!increasesAnyWeek(before, after)) return [];

  // ADDING EASY VOLUME IS NOT LOSING INTENSITY.
  //
  // `block-too-easy` is a share, and a share falls for two unrelated reasons: hard
  // work was taken out, or easy work was put in. Only the first is a loss — the
  // second leaves every hard second exactly where it was. Comparing the ratio alone
  // could not tell them apart, so an athlete asking for a longer easy run was told
  // no, and the refusal surfaced as "that session can't be resized to that distance".
  //
  // Ryan hit this on every session at once: his block sits at ~8% Z4+, already under
  // the 10% floor, so ANY added aerobic minute made the ratio fractionally worse and
  // was vetoed. He could shorten a session but never lengthen one — the Modify row
  // had become one-way, with no way to discover why.
  //
  // Two docs say this rail should not be doing that. Doc 01 §4 #4: the intensity
  // measurement is "the measurement as a regression guard, not an enforcement
  // mechanism" — it exists to catch the ENGINE drifting, not to overrule the athlete.
  // And doc 03 §4 C, quoted twenty lines above as the reason easing is never gated,
  // is "protect fast and add slow": adding easy aerobic volume IS adding slow, which
  // makes this the one rail that was blocking the very behaviour its own principle
  // endorses.
  //
  // So the floor is judged on ABSOLUTE Z4+ time. Take hard work away and it still
  // fires; add easy volume around untouched hard work and it does not.
  const hardBefore = blockMinutes(before).hard;
  const hardAfter = blockMinutes(after).hard;
  const lostHardTime = hardAfter < hardBefore - 1e-9;

  const a = checkRails(before);
  const b = checkRails(after);
  // `block-too-easy` is a FLOOR, so "worse" means SMALLER — every other rail is a ceiling.
  // Comparing them all one way would treat a block getting emptier as an improvement.
  const isFloor = (k: RailKind) => k === "block-too-easy";
  const worst = new Map<string, number>();
  for (const v of a.violations) {
    const key = `${v.kind}:${v.weekIndex ?? "-"}`;
    const had = worst.get(key);
    worst.set(key, had == null ? v.value : isFloor(v.kind) ? Math.min(had, v.value) : Math.max(had, v.value));
  }
  return b.violations.filter((v) => {
    // The floor only regressed if hard work actually left the block.
    if (isFloor(v.kind) && !lostHardTime) return false;
    const key = `${v.kind}:${v.weekIndex ?? "-"}`;
    const had = worst.get(key);
    if (had == null) return true;
    return isFloor(v.kind) ? v.value < had - 1e-9 : v.value > had + 1e-9;
  });
}
