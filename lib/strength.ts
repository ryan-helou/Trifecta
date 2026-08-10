// ---------------------------------------------------------------------------
// The gym log — what you actually lifted, and how it reaches the plan (#199).
//
// Ryan: "adding the ability to log what u did so weight and reps and sets and
// all these things", and when asked whether it should feed the training plan:
// feed it into the load model.
//
// WHAT WAS ALREADY TRUE, measured before building anything
//
// Strength was NOT missing from the load model. `sessionLoad` credits any
// completed session at rpe × minutes, and a 35 min gym session came out at
// 193 AU against 455 for a hard 65 min run — proportionate. What it lacked was
// any connection to what you DID: every gym session was priced off its zone, so
// a deload circuit and a heavy squat day scored identically.
//
// So this file does not invent a second currency. sRPE stays the unit the whole
// PMC is built on (doc 02 §1.5), and the log's job is to make the RPE that goes
// into it a real one instead of a guess.
//
// WHY NOT TONNAGE AS LOAD
//
// Volume-load (sets × reps × kg) is the obvious number and it is the wrong one
// to feed a PMC. It isn't commensurable with sRPE — 4,000 kg of squats and a
// two-hour ride have no exchange rate — and it scales with bodyweight and limb
// length rather than with systemic cost. Tonnage is excellent for tracking
// PROGRESSION, which is what it's used for here, and useless as a fatigue unit.
//
// Pure — no clock, no I/O.
// ---------------------------------------------------------------------------

import type { StrengthEntry, StrengthSet, Workout } from "./types";

/** Total kilograms moved: Σ reps × weight. Bodyweight sets contribute 0, which
 *  is honest — they're real work but this particular number can't see them. */
export function volumeLoad(entries: StrengthEntry[]): number {
  let kg = 0;
  for (const e of entries) {
    for (const s of e.sets) kg += (s.reps || 0) * (s.weightKg ?? 0);
  }
  return Math.round(kg);
}

/** Working sets and reps, which is the progression signal for bodyweight work
 *  where tonnage reads zero. */
export function setCount(entries: StrengthEntry[]): { sets: number; reps: number } {
  let sets = 0;
  let reps = 0;
  for (const e of entries) {
    for (const s of e.sets) {
      sets++;
      reps += s.reps || 0;
    }
  }
  return { sets, reps };
}

/** The heaviest single set of one exercise, for a personal best. Estimated 1RM is
 *  deliberately NOT computed: Epley and friends are unreliable above ~5 reps and
 *  a wrong PB is worse than no PB. */
export function heaviestSet(entries: StrengthEntry[], exercise: string): StrengthSet | null {
  const e = entries.find((x) => x.name.trim().toLowerCase() === exercise.trim().toLowerCase());
  if (!e) return null;
  return e.sets.reduce<StrengthSet | null>(
    (best, s) => ((s.weightKg ?? 0) > (best?.weightKg ?? -1) ? s : best),
    null,
  );
}

/**
 * Every exercise the athlete has ever logged, newest first, with its best set.
 * This is what makes the log worth keeping: "what did I squat last time" is the
 * question a gym log exists to answer.
 */
export interface ExerciseHistory {
  name: string;
  lastDoneISO: string;
  lastSets: StrengthSet[];
  bestWeightKg: number | null;
}

export function exerciseHistory(workouts: Workout[]): ExerciseHistory[] {
  const byName = new Map<string, ExerciseHistory>();
  const logged = workouts
    .filter((w) => w.strengthLog?.length && w.status === "done")
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const w of logged) {
    for (const e of w.strengthLog ?? []) {
      const key = e.name.trim().toLowerCase();
      if (!key) continue;
      const best = e.sets.reduce((m, s) => Math.max(m, s.weightKg ?? 0), 0);
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, {
          name: e.name.trim(),
          lastDoneISO: w.date,
          lastSets: e.sets,
          bestWeightKg: best > 0 ? best : null,
        });
      } else if (best > (existing.bestWeightKg ?? 0)) {
        existing.bestWeightKg = best;
      }
    }
  }
  return [...byName.values()].sort((a, b) => b.lastDoneISO.localeCompare(a.lastDoneISO));
}

/** Did this session beat the athlete's previous best on any lift? Compares
 *  against history EXCLUDING the session itself, so logging a set can't be its
 *  own personal best on the first entry. */
export function newPersonalBests(
  session: Workout,
  history: Workout[],
): Array<{ name: string; weightKg: number; previousKg: number | null }> {
  const prior = exerciseHistory(history.filter((w) => w.id !== session.id));
  const out: Array<{ name: string; weightKg: number; previousKg: number | null }> = [];
  for (const e of session.strengthLog ?? []) {
    const best = e.sets.reduce((m, s) => Math.max(m, s.weightKg ?? 0), 0);
    if (best <= 0) continue;
    const was = prior.find((p) => p.name.trim().toLowerCase() === e.name.trim().toLowerCase());
    if (!was || best > (was.bestWeightKg ?? 0)) {
      out.push({ name: e.name.trim(), weightKg: best, previousKg: was?.bestWeightKg ?? null });
    }
  }
  return out;
}

// AN INFERRED-RPE FUNCTION LIVED HERE AND WAS DELETED, which is worth recording
// so it isn't rebuilt. It scored effort from set density, and measured against
// real sessions it ranked a 5×5 at 100 kg (8 sets, 4,180 kg) at RPE 3 while a
// bodyweight circuit (18 sets) got 6.5 — a heavy squat day priced BELOW star
// jumps, and below the plain zone fallback. Density does separate a circuit from
// a strength session; it just ranks them backwards for systemic cost, and with
// no 1RM there is no honest way to compute relative intensity.
//
// So the gym log does not price itself. It reaches the PMC the way every other
// session does — through the RPE the athlete gives it — and what lives in this
// file is what the numbers CAN honestly support: volume, progression and PBs.

/** A one-line summary for the session card: "18 sets · 4,050 kg". */
export function summarise(entries: StrengthEntry[]): string {
  const { sets, reps } = setCount(entries);
  const kg = volumeLoad(entries);
  const parts = [`${sets} set${sets === 1 ? "" : "s"}`];
  if (kg > 0) parts.push(`${kg.toLocaleString()} kg`);
  else parts.push(`${reps} reps`);
  return parts.join(" · ");
}
