import { Discipline, Workout } from "./types";

// ---------------------------------------------------------------------------
// What a finished session actually counts for.
//
// Its own module rather than part of adapt.ts because both `load.ts` and
// `adapt.ts` need it, and adapt.ts now reads form deviation back out of load.ts.
// Leaving these there made that a genuine import cycle (adapt → load → adapt),
// which only survives on function hoisting and breaks the moment either module
// grows top-level work. Two consumers, no dependencies — so it belongs here.
//
// The rule in both cases: what the athlete really did outranks what we planned.
// ---------------------------------------------------------------------------

/** The sport a session counts toward — a swap credits what was actually done. */
export function creditedDiscipline(w: Workout): Discipline {
  return w.status === "swapped" ? w.loggedDiscipline ?? w.discipline : w.discipline;
}

/** Seconds a completed/logged workout should count for. */
export function creditedSeconds(w: Workout): number {
  if (w.actualDurationSec != null) return w.actualDurationSec; // athlete logged what they actually did
  if (w.status === "swapped") return w.loggedDurationSec ?? w.estDurationSec ?? 0;
  return w.estDurationSec ?? 0;
}
