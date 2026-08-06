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

/** The impact load the athlete has recently been carrying — the trailing weeks
 *  before `weekIndex`, averaged. This is what "ramp" is measured against. */
export function impactBaseline(plan: Plan, weekIndex: number): number {
  const prior = plan.weeks
    .filter((w) => w.index < weekIndex && w.index >= weekIndex - IMPACT_BASELINE_WEEKS)
    .map((w) => weekImpactMinutes(plan, w));
  if (!prior.length) return IMPACT_FLOOR_MIN;
  const mean = prior.reduce((a, b) => a + b, 0) / prior.length;
  return Math.max(IMPACT_FLOOR_MIN, mean);
}

/** How many more impact-minutes this week can take before it becomes a spike.
 *  Zero when the week is already at or over its ceiling. */
export function impactHeadroomMinutes(plan: Plan, weekIndex: number): number {
  const week = plan.weeks.find((w) => w.index === weekIndex);
  if (!week) return 0;
  const ceiling = impactBaseline(plan, weekIndex) * IMPACT_RAMP_MAX;
  return Math.max(0, ceiling - weekImpactMinutes(plan, week));
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
