import { Plan, ReadinessEntry, ReadinessInput } from "./types";
import { easeUpcoming } from "./adapt";

// ---------------------------------------------------------------------------
// Daily readiness — the thing Runna never did. A ten-second morning check
// (sleep · legs · energy) that actually regulates *today's* session: a rough
// morning softens the day so a bad night doesn't turn into an injury. Pure.
// ---------------------------------------------------------------------------

// Below this, we soften today's hard work.
export const READY_LOW = 45;

/** 0–100, higher = fresher. Equal weight across the three dimensions (each 1–3). */
export function readinessScore(input: ReadinessInput): number {
  const raw = ((input.sleep + input.legs + input.energy - 3) / 6) * 100; // 3→0, 9→100
  return Math.round(Math.max(0, Math.min(100, raw)));
}

export type ReadinessBand = "low" | "ok" | "high";
export function readinessBand(score: number): ReadinessBand {
  if (score < READY_LOW) return "low";
  if (score >= 75) return "high";
  return "ok";
}

/** Record a morning check-in and, if readiness is low, ease the day's hard
 *  sessions. Returns a new Plan. */
export function logReadiness(plan: Plan, dateISO: string, input: ReadinessInput): Plan {
  const score = readinessScore(input);
  const entry: ReadinessEntry = { ...input, dateISO, score };
  let next: Plan = { ...plan, readiness: { ...(plan.readiness ?? {}), [dateISO]: entry } };

  if (score < READY_LOW) {
    next = easeUpcoming(next, dateISO, 0); // window of just today
    next.readiness = { ...next.readiness, [dateISO]: { ...entry, eased: true } };
  }
  return next;
}
