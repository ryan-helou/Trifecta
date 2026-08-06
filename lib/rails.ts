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

/** Block-level share of endurance time at Z4+. The real 80/20 claim.
 *  Measured today: 8-19% across every archetype. */
export const BLOCK_HARD_MAX = 0.25;

/** Per-week ceiling on Z4+ time share, outside the taper. NOT an 80/20 rule —
 *  a guard against one week becoming an intensity bomb. Measured worst: 48%
 *  (olympic/beginner/5, where base weeks carry no quality at all). */
export const WEEK_HARD_MAX = 0.55;

/** Week-over-week volume ratio between consecutive load weeks. The field
 *  heuristic is ~10%/week; the engine's real worst is 19.6% coming out of a
 *  deload, which is ordinary coaching. Measured today: 7.8%-19.6%. */
export const RAMP_MAX = 1.25;

export type RailKind = "block-intensity" | "week-intensity" | "ramp";

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
  let hard = 0;
  let total = 0;
  for (const week of plan.weeks) {
    if (week.isRaceWeek || week.phase === "taper") continue;
    const m = weekMinutes(plan, week);
    hard += m.hard;
    total += m.total;
  }
  return total > 0 ? hard / total : null;
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

  const a = checkRails(before);
  const b = checkRails(after);
  const worst = new Map<string, number>();
  for (const v of a.violations) {
    const key = `${v.kind}:${v.weekIndex ?? "-"}`;
    worst.set(key, Math.max(worst.get(key) ?? 0, v.value));
  }
  return b.violations.filter((v) => {
    const key = `${v.kind}:${v.weekIndex ?? "-"}`;
    const had = worst.get(key);
    return had == null || v.value > had + 1e-9;
  });
}
