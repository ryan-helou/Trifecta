// ---------------------------------------------------------------------------
// One-time repair of plans already damaged by the swap-baseline bug (#201).
//
// Ryan: "modify all the plans that were subject to the bug where if u have a
// 35 mins bike 15k then u turn it into a run the distances dont change."
//
// WHAT WENT WRONG. Every session carries a `prescribed` baseline that later
// resizes measure against. `swapDiscipline` used to leave that baseline
// describing the sport that had just been REPLACED, and `scaleWorkout` derives
// distance as `baseline.estDistanceM × ratio`. So a ride that was resized and
// then swapped to a run came back from the next ease carrying the BIKE's
// distance against the RUN's duration — 15 km in 35 min, a 2:20/km pace.
//
// The bug itself is fixed at the source. This is for the athletes who are
// already carrying the damage: their stored plan keeps the impossible session
// until something rewrites it, and the plan prescribes from that ledger.
//
// TWO REPAIRS, both conservative:
//
//  1. A session whose implied speed is not humanly possible for its sport has
//     its distance recomputed from its own segments at the athlete's paces —
//     the same `measure` the builder uses, so the answer is what the session
//     would have been built as. Sessions inside the plausible band are never
//     touched, so an athlete who deliberately set an odd distance keeps it.
//  2. Any swapped session still holding a baseline is cleared, so the next ease
//     cannot resurrect the old sport's size. This is the fix applied to history.
//
// Pure — no clock, no I/O. Mirrors `dedupeSyncedSessions` (#123), which repairs
// on restore for the same reason.
// ---------------------------------------------------------------------------

import type { Discipline, Plan, Workout } from "./types";
import { measure } from "./workouts";

/** km/h a human can actually sustain for a training session, generously bounded.
 *  Wide on purpose: this decides what counts as CORRUPTION, not what counts as
 *  a good session, and a false positive rewrites something the athlete chose. */
const SANE_KMH: Partial<Record<Discipline, [number, number]>> = {
  // Anchored to world records, not to guesses. The marathon record is ~21 km/h
  // and 5000 m is ~23 km/h, so a 35-minute TRAINING run above 22 km/h is not a
  // fast athlete, it is corrupt data. The first draft of this used 26 and let
  // the actual reported case through: 15 km in 35 min is 25.7 km/h, a 2:20/km
  // pace, and it tested as "possible".
  run: [4, 22],
  // Pro time-trial pace is ~55 km/h; a sustained session above 60 is corrupt.
  bike: [8, 60],
  // The 50 m freestyle record is ~2.4 m/s (8.6 km/h) and cannot be held for a
  // set, so a whole session above 7.5 km/h is corrupt.
  swim: [0.8, 7.5],
};

export function impliedKmh(w: Workout): number | null {
  if (!w.estDistanceM || !w.estDurationSec) return null;
  return w.estDistanceM / 1000 / (w.estDurationSec / 3600);
}

/** Is this session advertising a speed no one can produce? */
export function isImpossible(w: Workout): boolean {
  const lim = SANE_KMH[w.discipline];
  if (!lim) return false;
  const kmh = impliedKmh(w);
  if (kmh == null) return false;
  return kmh < lim[0] || kmh > lim[1];
}

export interface RepairResult {
  plan: Plan;
  /** Sessions whose distance was rebuilt. */
  repaired: number;
  /** Swapped sessions whose stale baseline was cleared. */
  baselinesCleared: number;
}

export function repairSwappedDistances(plan: Plan): RepairResult {
  const ctx = { paces: plan.paces, level: plan.profile.level };
  let repaired = 0;
  let baselinesCleared = 0;
  const workouts: Record<string, Workout> = {};

  for (const [id, w] of Object.entries(plan.workouts)) {
    let next = w;

    // 1) rebuild an impossible distance from the session's own structure
    if (isImpossible(next) && next.segments?.length) {
      const { distanceM } = measure(ctx, next.segments);
      const rebuilt = Math.round(distanceM);
      if (rebuilt > 0 && rebuilt !== next.estDistanceM) {
        next = { ...next, estDistanceM: rebuilt };
        repaired++;
      }
    }

    // 2) a swapped session must not keep a baseline minted for the sport that left
    if (next.swappedFrom && next.prescribed) {
      const { prescribed: _drop, ...rest } = next;
      next = rest as Workout;
      baselinesCleared++;
    }

    workouts[id] = next;
  }

  if (!repaired && !baselinesCleared) return { plan, repaired: 0, baselinesCleared: 0 };
  return { plan: { ...plan, workouts }, repaired, baselinesCleared };
}
