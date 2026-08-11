// ---------------------------------------------------------------------------
// Mechanical load — the axis the metabolic ledger cannot see.
//
// Everything in lib/load.ts is metabolic: sRPE, zones, heart rate, CTL/ATL/TSB.
// On that axis a 90-minute Z2 ride and a 90-minute Z2 run are near enough the
// same session, and swapping one for the other changes nothing. On the axis that
// actually breaks bones and tendons they are not remotely the same, and the
// ledger stays flat while run volume spikes. Doc 02 §4 #13 names this exact gap:
// "don't let a low metabolic load hide a spiking run mileage."
//
// It is reachable in one tap today. `swapDiscipline` rebuilds the session at the
// SAME duration, so an athlete running two hours a week who swaps a 90-minute
// ride onto a run adds 75% to their weekly run volume with a single press, and
// nothing anywhere notices.
//
// So mechanical load gets its own accounting and its own ramp. Doc 03 §4 F is
// the rule being implemented: never ramp the substitute sport faster than you'd
// ramp it fresh — offloading must not create a new spike.
//
// Note the deliberate asymmetry: this only ever constrains swaps INTO a
// higher-impact sport. Swapping a run onto the bike sheds impact and is never
// blocked. Protect fast, add slow (doc 03 §4 C).
//
// Pure — no clock, no I/O.
// ---------------------------------------------------------------------------

import type { Discipline, Plan, Week, Workout } from "./types";

/** Impact cost per minute, with running as the reference at 1.0.
 *
 *  Folk constants, and flagged as such per doc 02 §4 #15 — they encode the
 *  ordering that matters (run ≫ brick ≫ strength ≫ bike ≫ swim) rather than any
 *  measured tissue stress, and they are meant to be fitted to real data later.
 *  The brick weight is high relative to its run fraction on purpose: its run leg
 *  is run on already-fatigued legs, which is the point of the session and also
 *  the reason it costs more per minute than the same minutes run fresh. */
export const IMPACT_PER_MIN: Record<Discipline, number> = {
  run: 1,
  brick: 0.45,
  strength: 0.25,
  bike: 0.05,
  swim: 0,
  rest: 0,
};

/** The classic 10%-a-week rule. Unlike ACWR — which doc 02 §4 #5 tells us NOT to
 *  build on, being mathematically coupled and causally unsupported — this is a
 *  plain don't-spike-your-volume heuristic applied to one sport's own trend, and
 *  it is framed as exactly that. */
export const IMPACT_RAMP_MAX = 1.1;

/** Weeks of history the ramp is measured against. One week is too noisy (a
 *  single missed long run halves the baseline and then blocks a normal week). */
export const IMPACT_BASELINE_WEEKS = 2;

/**
 * How far past its design a single VOLUNTARY addition may take a week.
 *
 * Deliberately larger than `IMPACT_RAMP_MAX`, and the difference is the whole point. The
 * 10% rule bounds SUSTAINED weekly growth — it is about where your volume sits next month.
 * One easy session the athlete asked for is not sustained growth, and gating it at 10%
 * produced an allowance of 13–20 minutes of running (#211), which is below the length at
 * which a run is worth changing for, so every run was refused.
 *
 * This cannot become a spike by the back door, because the headroom is recomputed against
 * what the week now contains: take a 38-minute bonus run and the next request that week
 * sees the week already at its ceiling and says no. One extra session, or a couple of short
 * ones — which is exactly the behaviour asked for.
 */
export const IMPACT_BONUS_MAX = 1.25;

/** An athlete with no impact history at all still gets to run. Without a floor,
 *  a baseline of zero multiplied by any ramp is still zero, and swapping onto a
 *  run would be permanently refused for the beginner it's meant to serve. */
export const IMPACT_FLOOR_MIN = 25;

/** Impact-weighted minutes for one session — what it costs the tissue, not the
 *  engine. Uses the duration actually credited where one exists, so a logged
 *  hour counts as an hour even if the plan asked for forty minutes. */
export function sessionImpactMinutes(w: Workout): number {
  if (w.status === "skipped") return 0;
  const sec = w.actualDurationSec ?? w.estDurationSec ?? 0;
  return ((sec / 60) * (IMPACT_PER_MIN[w.discipline] ?? 0));
}

export function weekImpactMinutes(plan: Plan, week: Week): number {
  let total = 0;
  for (const id of week.workoutIds) {
    const w = plan.workouts[id];
    if (w) total += sessionImpactMinutes(w);
  }
  return total;
}

/** What a week ASKS FOR, as opposed to what has been done in it. Uses the prescribed
 *  duration only, so a week still in the future measures at its design rather than at
 *  zero. */
function prescribedImpactMinutes(plan: Plan, week: Week): number {
  let total = 0;
  for (const id of week.workoutIds) {
    const w = plan.workouts[id];
    // Athlete-added sessions are excluded, and this is the difference between a baseline
    // and a ratchet. They land in the same week they are measured against, so counting them
    // would let each addition raise the ceiling authorising the next one — measured, four
    // successive bonus runs came out 40, 40, 35, then 55 minutes, growing instead of
    // tightening. The baseline is what the PLAN asked for; extra work spends against it.
    if (w && !w.addedByAthlete) {
      total += ((w.estDurationSec ?? 0) / 60) * (IMPACT_PER_MIN[w.discipline] ?? 0);
    }
  }
  return total;
}

/**
 * The impact load the athlete is carrying — what "ramp" is measured against.
 *
 * Two things feed it, and the SECOND is what makes this usable:
 *
 *  1. The trailing weeks, averaged. What they have actually been doing.
 *  2. What THIS week's plan prescribes. The engine has already decided the athlete can
 *     handle that — its own ramp rails bound how fast it grows — so a week the plan asked
 *     for is by definition not a spike.
 *
 * Taking the max of the two fixes a failure the trailing-average-alone version had at both
 * ends, measured on real plans (#211):
 *
 *   • **Week one refused everything.** No trailing weeks → fall back to `IMPACT_FLOOR_MIN`
 *     (25), which the plan's own first week (≈154) already dwarfs → headroom exactly zero.
 *     14 of 14 run-and-bike day-combinations refused, at every level. The athlete most
 *     likely to be keen was the one guaranteed to be told no.
 *   • **The week after a deload refused everything.** The trailing mean is dragged down by
 *     the recovery week while this week's own volume jumps — so headroom hit zero exactly
 *     when the athlete was freshest.
 *
 * This is the same fix, and the same reasoning, as `seedLoad` in lib/load.ts: measure the
 * athlete against the plan they are actually on, not against an assumed history of zero.
 */
export function impactBaseline(plan: Plan, weekIndex: number): number {
  const prior = plan.weeks.filter((w) => w.index < weekIndex && w.index >= weekIndex - IMPACT_BASELINE_WEEKS);
  const trailingActual = prior.length
    ? prior.reduce((a, w) => a + weekImpactMinutes(plan, w), 0) / prior.length
    : 0;

  // The design seed, AVERAGED over this week and its neighbours rather than taken from this
  // week alone. Averaging is what stops a week blessing itself: a week that has been
  // stuffed — by swaps, by hand — would otherwise raise the very ceiling meant to catch it,
  // and the gate would never bite. Spread across the window, one inflated week moves the
  // baseline by a third of its excess and is still refused.
  // Recovery weeks are skipped, exactly as `loadWeekRamps` skips them in rails.ts and for
  // the same reason: a deload is SUPPOSED to drop and the rebuild out of it is supposed to
  // jump, so treating one as evidence of reduced capacity punishes the week after it. That
  // was measured — the week following a deload offered nothing at all, which is precisely
  // when an athlete feels freshest and most likely to want extra.
  const window = plan.weeks.filter(
    (w) => w.index <= weekIndex && w.index > weekIndex - 1 - IMPACT_BASELINE_WEEKS && !w.isRecovery,
  );
  const design = window.length
    ? window.reduce((a, w) => a + prescribedImpactMinutes(plan, w), 0) / window.length
    : 0;

  return Math.max(IMPACT_FLOOR_MIN, trailingActual, design);
}

/** How many more impact-minutes this week can take before it becomes a spike.
 *  Zero when the week is already at or over its ceiling.
 *
 *  `ceiling` selects which question is being asked. A SWAP is a replacement and must not
 *  ramp the receiving sport faster than you'd ramp it fresh, so it uses the 10% rule. A
 *  voluntary ADDITION is a different question and uses `IMPACT_BONUS_MAX` — see the note
 *  there for why reusing the ramp ceiling refused every run. */
export function impactHeadroomMinutes(
  plan: Plan,
  weekIndex: number,
  ceiling: number = IMPACT_RAMP_MAX,
): number {
  const week = plan.weeks.find((w) => w.index === weekIndex);
  if (!week) return 0;
  return Math.max(0, impactBaseline(plan, weekIndex) * ceiling - weekImpactMinutes(plan, week));
}

export interface SwapAllowance {
  /** the longest the swapped session may be, in seconds */
  maxSec: number;
  /** true when the athlete's requested duration had to be cut to fit */
  capped: boolean;
  /** null when nothing needed saying */
  reason: string | null;
}

/** How long a session may be if it's swapped onto `to`, given what the rest of
 *  that week already costs the tissue.
 *
 *  The answer is deliberately never "no". Ryan's ask was that everything be
 *  switchable, and refusing the swap outright would fail that — so the swap
 *  always happens and it's the DURATION that gets fitted to the week's headroom.
 *  That is also what a coach says: not "you can't run today", but "sure, but
 *  keep it to forty minutes." */
export function swapAllowance(plan: Plan, w: Workout, to: Discipline, requestedSec: number): SwapAllowance {
  const from = IMPACT_PER_MIN[w.discipline] ?? 0;
  const into = IMPACT_PER_MIN[to] ?? 0;
  // shedding impact, or holding it level, is never constrained
  if (into <= from) return { maxSec: requestedSec, capped: false, reason: null };

  // the week as it would look with this session removed — it's being replaced,
  // so its current impact must not be double-counted against the headroom
  const withoutThis: Plan = { ...plan, workouts: { ...plan.workouts } };
  withoutThis.workouts[w.id] = { ...w, discipline: "rest" };
  const headroom = impactHeadroomMinutes(withoutThis, w.weekIndex);

  const maxMin = headroom / into;
  const maxSec = Math.max(0, Math.floor((maxMin * 60) / 300) * 300); // whole 5-minute steps
  if (maxSec >= requestedSec) return { maxSec: requestedSec, capped: false, reason: null };

  return {
    maxSec,
    capped: true,
    reason:
      `Kept to ${Math.round(maxSec / 60)} min — you'd have gone from ` +
      `${Math.round(weekImpactMinutes(withoutThis, plan.weeks.find((x) => x.index === w.weekIndex)!))} to ` +
      `${Math.round(weekImpactMinutes(withoutThis, plan.weeks.find((x) => x.index === w.weekIndex)!) + (requestedSec / 60) * into)} ` +
      `impact-minutes this week. Same session, ramped like you'd ramp it fresh.`,
  };
}

export interface ImpactRamp {
  fromIndex: number;
  toIndex: number;
  ratio: number;
}

/** Week-over-week impact ramps, for auditing a whole plan. Weeks with no impact
 *  at all are skipped rather than treated as a divide-by-zero. */
export function impactRamps(plan: Plan): ImpactRamp[] {
  const out: ImpactRamp[] = [];
  const weeks = [...plan.weeks].sort((a, b) => a.index - b.index);
  for (let i = 1; i < weeks.length; i++) {
    const prev = weekImpactMinutes(plan, weeks[i - 1]);
    const cur = weekImpactMinutes(plan, weeks[i]);
    if (prev <= 0) continue;
    out.push({ fromIndex: weeks[i - 1].index, toIndex: weeks[i].index, ratio: cur / prev });
  }
  return out;
}
