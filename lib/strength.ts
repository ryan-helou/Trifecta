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

import type { Profile, StrengthEntry, StrengthSet, Unit, Workout } from "./types";
import { LB_PER_KG } from "./format";

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
export function setCount(entries: StrengthEntry[]): { sets: number; reps: number; recorded: number } {
  let sets = 0;
  let reps = 0;
  let recorded = 0;
  for (const e of entries) {
    for (const s of e.sets) {
      // `sets` counts every set on the card, including ones with no numbers yet — a
      // routine saying "three sets of bench" is three sets whether or not you have
      // decided the weight. `reps`/`recorded` count only what was actually entered,
      // so a blank plan never reads as a session of zero-rep work.
      sets++;
      if (s.reps != null && s.reps > 0) {
        recorded++;
        reps += s.reps;
      }
    }
  }
  return { sets, reps, recorded };
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
      // Only RECORDED sets are history. A set left blank is one the athlete didn't
      // fill in; handing it back as "what you did last time" would seed the next
      // session with the very hole it is meant to close.
      const done = e.sets.filter((s) => s.reps != null && s.reps > 0);
      if (!done.length) continue;
      const best = done.reduce((m, s) => Math.max(m, s.weightKg ?? 0), 0);
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, {
          name: e.name.trim(),
          lastDoneISO: w.date,
          lastSets: done,
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
/** The unit LIFTED WEIGHT is shown in.
 *
 *  The one place the fallback lives. Unset `strengthUnit` means "follow the distance
 *  setting", which is what every existing athlete already sees, so nothing moves
 *  under anyone who has not chosen. Everything that renders a weight comes through
 *  here rather than reading `unitPreference` — that shortcut is what tied the barbell
 *  to the road. */
export function strengthUnitOf(profile: Profile | null | undefined): Unit {
  return profile?.strengthUnit ?? profile?.unitPreference ?? "metric";
}

export function summarise(entries: StrengthEntry[], unit: Unit = "metric"): string {
  const { sets, reps, recorded } = setCount(entries);
  const kg = volumeLoad(entries);
  const parts = [`${sets} set${sets === 1 ? "" : "s"}`];
  // Took no unit at all and hard-coded "kg", so an imperial athlete read their own
  // routines in kilograms whatever they had set. Volume load is a total, not a plate
  // weight, so it rounds to whole units either way.
  if (kg > 0) {
    const v = Math.round(unit === "imperial" ? kg * LB_PER_KG : kg);
    parts.push(`${v.toLocaleString()} ${unit === "imperial" ? "lb" : "kg"}`);
  }
  // Nothing entered yet is its own state, not "0 reps". A freshly built routine reads
  // "4 sets · numbers on your first session" rather than announcing work never done.
  else if (recorded === 0) parts.push("numbers on your first session");
  else parts.push(`${reps} reps`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// "Compare to what you did last time, or congratulate you if you did better."
//
// A gym log that only records is a filing cabinet. The reason to open the app
// under the bar is to know whether today beats last week — so the comparison has
// to be on screen WHILE you lift, not in a report afterwards.
//
// WHAT COUNTS AS BETTER, and why it isn't just weight. Progression on a lift is
// load first, then reps at that load: 100 × 5 beats 95 × 5, and 100 × 6 beats
// 100 × 5, but 105 × 3 against 100 × 8 is not an improvement anyone should be
// congratulated for. So a set is "better" only when it is heavier than the best
// set of last session, or equal weight for more reps than were done at that
// weight. Everything else is silent — a congratulation that fires on a lighter
// day is worse than none, because it teaches the athlete to ignore the badge.
//
// Estimated 1RM stays out of it, for the reason `heaviestSet` already gives.
// ---------------------------------------------------------------------------

/** The best single set of a list, by weight then reps. */
export function topSet(sets: StrengthSet[]): StrengthSet | null {
  return sets.reduce<StrengthSet | null>((best, s) => {
    if (!best) return s;
    const w = s.weightKg ?? 0;
    const bw = best.weightKg ?? 0;
    if (w > bw) return s;
    if (w === bw && (s.reps || 0) > (best.reps || 0)) return s;
    return best;
  }, null);
}

// ---- progressive overload ----------------------------------------------------
//
// The plan prescribes the same circuit in week 1 and week 16, and `withKnownLoads`
// hands back whatever you lifted last time — so once an athlete benched 60 kg the
// app offered 60 kg forever. Strength was the one discipline with no progression at
// all, in an app whose whole argument is periodization.
//
// WHAT THIS IS NOT. It is not a hypertrophy ladder. Doc 01 §4 rule 4: in-season
// strength for a triathlete is a MAINTENANCE dose serving durability and power, and
// the endurance block is the thing being protected. So this is deliberately the
// slowest honest progression — the standard double-progression trigger, one
// increment, and only when the last session was completed cleanly.
//
// AND IT ONLY EVER SUGGESTS. The card still opens at last session's numbers; this
// is surfaced beside them for the athlete to take or ignore. `prescribedExercises`
// already states the principle — "the plan can't know what this athlete lifts, and
// inventing a number would be worse than an empty field" — and silently loading the
// bar heavier than someone left it is that mistake with a limp attached.

/** Upper-body jump: the smallest pair of plates most gyms actually have. */
export const STEP_UPPER_KG = 2.5;
/** Lower body carries more absolute load, so it moves in bigger steps. */
export const STEP_LOWER_KG = 5;

export type Progression =
  | { kind: "weight"; weightKg: number; fromKg: number; stepKg: number }
  | { kind: "reps"; reps: number; fromReps: number };

/**
 * Should this lift go up next time?
 *
 * The trigger is "you completed every set at the same weight with no drop-off in
 * reps" — the conventional double-progression rule, and the conservative reading of
 * it. A session whose reps fell away set to set was already at its limit; offering
 * more weight there is how a maintenance dose turns into an injury (doc 03 §4).
 *
 * Bodyweight work has no plate to add, so it progresses in reps instead. Returns
 * null when there's nothing earned — silence is the common and correct answer.
 */
export function suggestProgression(
  lastSets: StrengthSet[] | null | undefined,
  isLowerBody: boolean,
): Progression | null {
  if (!lastSets?.length) return null;
  const reps = lastSets.map((s) => s.reps || 0);
  if (reps.some((r) => r <= 0)) return null;
  // Every set held up: the last set matched the best set. One hard set followed by
  // two that faded is not a session that earned more load.
  if (Math.min(...reps) < Math.max(...reps)) return null;

  const weights = lastSets.map((s) => s.weightKg ?? 0);
  const loaded = weights.every((w) => w > 0);
  if (loaded) {
    // Straight sets only. Ascending or drop sets aren't a single working weight, so
    // "add 2.5 kg" has no unambiguous meaning — leave those alone.
    if (Math.min(...weights) !== Math.max(...weights)) return null;
    const from = weights[0];
    const step = isLowerBody ? STEP_LOWER_KG : STEP_UPPER_KG;
    return { kind: "weight", weightKg: Math.round((from + step) * 100) / 100, fromKg: from, stepKg: step };
  }
  // Unloaded, and it must be unloaded THROUGHOUT — a mix means the log is
  // half-filled, not that this is a bodyweight movement.
  if (weights.some((w) => w > 0)) return null;
  return { kind: "reps", reps: reps[0] + 1, fromReps: reps[0] };
}

export type BeatKind = "weight" | "reps";

/**
 * Did this set beat the athlete's LAST session on this lift? Returns null when
 * it didn't, and when there's no history to beat — "first time" is its own state
 * and is shown as such, never dressed up as a win.
 */
export function setBeatsLast(set: StrengthSet, lastSets: StrengthSet[] | null | undefined): BeatKind | null {
  if (!lastSets?.length) return null;
  const w = set.weightKg ?? 0;
  const prevTop = topSet(lastSets);
  const prevW = prevTop?.weightKg ?? 0;
  if (w > prevW) return "weight";
  if (w === prevW) {
    // most reps done at that weight last time
    const prevReps = lastSets.filter((s) => (s.weightKg ?? 0) === prevW).reduce((m, s) => Math.max(m, s.reps || 0), 0);
    if ((set.reps || 0) > prevReps) return "reps";
  }
  return null;
}

export interface LiftVerdict {
  name: string;
  /** null when this lift has never been logged before. */
  last: { sets: number; topWeightKg: number | null; topReps: number; volumeKg: number } | null;
  now: { sets: number; topWeightKg: number | null; topReps: number; volumeKg: number };
  beat: BeatKind | null;
}

const describe = (sets: StrengthSet[]) => {
  const t = topSet(sets);
  return {
    sets: sets.length,
    topWeightKg: t?.weightKg != null && t.weightKg > 0 ? t.weightKg : null,
    topReps: t?.reps ?? 0,
    volumeKg: volumeLoad([{ name: "x", sets }]),
  };
};

/** This session's lifts against the last time each was trained. */
export function compareLifts(entries: StrengthEntry[], history: ExerciseHistory[]): LiftVerdict[] {
  return entries.map((e) => {
    const prior = history.find((p) => p.name.trim().toLowerCase() === e.name.trim().toLowerCase());
    const best = topSet(e.sets);
    return {
      name: e.name.trim(),
      last: prior?.lastSets.length ? describe(prior.lastSets) : null,
      now: describe(e.sets),
      beat: best ? setBeatsLast(best, prior?.lastSets) : null,
    };
  });
}

/**
 * One sentence for the end of a session. Deliberately singular and specific —
 * "Back Squat 100 kg, 5 up on last time" lands; "you improved on 2 lifts" is a
 * report. Returns null when there is nothing true to celebrate, because the
 * alternative is congratulating someone for a session they know was worse.
 */
export function congratulate(verdicts: LiftVerdict[]): string | null {
  const wins = verdicts.filter((v) => v.beat && v.last);
  if (!wins.length) return null;
  // the biggest jump in load leads; ties fall back to the first
  const byGain = [...wins].sort(
    (a, b) => ((b.now.topWeightKg ?? 0) - (b.last!.topWeightKg ?? 0)) - ((a.now.topWeightKg ?? 0) - (a.last!.topWeightKg ?? 0)),
  );
  const w = byGain[0];
  const others = wins.length - 1;
  const tail = others > 0 ? ` (and ${others} more lift${others === 1 ? "" : "s"})` : "";
  if (w.beat === "reps") {
    return `${w.name}: ${w.now.topReps} reps at the same weight, up from ${w.last!.topReps}${tail}.`;
  }
  const gain = Math.round(((w.now.topWeightKg ?? 0) - (w.last!.topWeightKg ?? 0)) * 10) / 10;
  return `${w.name}: ${w.now.topWeightKg} kg, ${gain} up on last time${tail}.`;
}
