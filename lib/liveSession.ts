// ---------------------------------------------------------------------------
// A gym session you track WHILE you do it.
//
// Ryan: "I'm at the gym, and I open my phone, and I say, okay, today is push day.
// I go click on push day on my schedule, and I say start workout. And it has the
// list of all the sets and exercises I need to do for this day, and I could
// modify and edit it, and then I could submit when I say finish workout."
//
// Until now the only way to record a gym session was `StrengthLog` — type the
// whole thing in afterwards, from memory, in one sitting. That is precisely the
// job a gym app exists to remove.
//
// WHAT MAKES THIS DIFFERENT FROM `StrengthLog`, and why it's a separate module:
// the unit of interaction is a SET BEING COMPLETED, not a field being filled.
// The routine already says "4 × 8 at 60 kg"; standing under the bar, the athlete
// is confirming that happened, not describing it. So every set carries a `done`
// flag, the numbers arrive pre-filled from the routine, and the common case is
// one tap per set. Editing is still there for the set that didn't go to plan.
//
// ONLY COMPLETED SETS ARE LOGGED. `finishSession` drops everything still
// unticked — a set you didn't do must never enter your history, because that
// history is what `newPersonalBests` and the "what did I lift last time" prefill
// are computed from. Abandoning a session half-way is a normal thing to do; it
// should record the half you did, not the whole you intended.
//
// Pure — no clock, no I/O, no storage. Callers pass `nowISO`; persistence lives
// in lib/liveStore.ts, for the same reason the rest of lib/ keeps that seam.
// ---------------------------------------------------------------------------

import type { StrengthEntry, StrengthSlot } from "./types";

/** One set, mid-session. `done` is the whole point — see the header. */
export interface LiveSet {
  reps: number;
  weightKg?: number;
  done: boolean;
}

export interface LiveExercise {
  name: string;
  sets: LiveSet[];
}

export interface LiveSession {
  /** The gym session on the plan this belongs to. Also the storage key. */
  workoutId: string;
  startedISO: string;
  slot: StrengthSlot | null;
  /** What the athlete calls this day — "My Push Day", or the session title. */
  name: string;
  exercises: LiveExercise[];
}

/** Start from a routine (or from whatever is already logged, when resuming a
 *  session that was logged the old way). Nothing is ticked: the athlete has
 *  just walked in. */
export function startSession(opts: {
  workoutId: string;
  startedISO: string;
  slot: StrengthSlot | null;
  name: string;
  from?: StrengthEntry[];
}): LiveSession {
  return {
    workoutId: opts.workoutId,
    startedISO: opts.startedISO,
    slot: opts.slot,
    name: opts.name,
    exercises: (opts.from ?? []).map((e) => ({
      name: e.name,
      sets: e.sets.map((s) => ({ reps: s.reps, ...(s.weightKg != null ? { weightKg: s.weightKg } : {}), done: false })),
    })),
  };
}

// All of the below return a NEW session — the caller holds it in React state and
// writes it straight to storage, so mutating in place would persist nothing.

const mapExercise = (s: LiveSession, ei: number, f: (e: LiveExercise) => LiveExercise): LiveSession => ({
  ...s,
  exercises: s.exercises.map((e, i) => (i === ei ? f(e) : e)),
});

export function setDone(s: LiveSession, ei: number, si: number, done: boolean): LiveSession {
  return mapExercise(s, ei, (e) => ({ ...e, sets: e.sets.map((x, j) => (j === si ? { ...x, done } : x)) }));
}

export function patchSet(s: LiveSession, ei: number, si: number, patch: Partial<Omit<LiveSet, "done">>): LiveSession {
  return mapExercise(s, ei, (e) => ({ ...e, sets: e.sets.map((x, j) => (j === si ? { ...x, ...patch } : x)) }));
}

/** A new set copies the one above it, because a working set nearly always is the
 *  same as the last — the `StrengthLog` "+ Set" bargain, kept. It arrives
 *  UNTICKED: copying the numbers is a convenience, copying the fact that you did
 *  it would be a lie. */
export function addSet(s: LiveSession, ei: number): LiveSession {
  return mapExercise(s, ei, (e) => {
    const last = e.sets[e.sets.length - 1];
    return { ...e, sets: [...e.sets, last ? { ...last, done: false } : { reps: 0, done: false }] };
  });
}

export function removeSet(s: LiveSession, ei: number, si: number): LiveSession {
  return { ...s, exercises: s.exercises.map((e, i) => (i === ei ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e)) };
}

export function addExercise(s: LiveSession, name: string, sets?: LiveSet[]): LiveSession {
  const clean = name.trim();
  if (!clean) return s;
  if (s.exercises.some((e) => e.name.trim().toLowerCase() === clean.toLowerCase())) return s;
  return { ...s, exercises: [...s.exercises, { name: clean, sets: sets?.length ? sets : [{ reps: 0, done: false }] }] };
}

export function removeExercise(s: LiveSession, ei: number): LiveSession {
  return { ...s, exercises: s.exercises.filter((_, i) => i !== ei) };
}

/** How far through. `sets` counts every set on the card, done or not, so the
 *  denominator is the session the athlete signed up for. */
export function sessionProgress(s: LiveSession): { done: number; total: number; complete: boolean } {
  let done = 0;
  let total = 0;
  for (const e of s.exercises) {
    for (const x of e.sets) {
      total++;
      if (x.done) done++;
    }
  }
  return { done, total, complete: total > 0 && done === total };
}

/**
 * What actually gets written to the workout. Completed sets only, then exercises
 * left with nothing in them are dropped — an exercise you started and abandoned
 * shouldn't appear in your history as a zero.
 *
 * Reps of 0 are dropped even when ticked, matching `StrengthLog`'s `fromDraft`:
 * a set with no reps carries no information, and letting it through would put a
 * 0-rep entry into `exerciseHistory` where it becomes next session's prefill.
 */
export function finishSession(s: LiveSession): StrengthEntry[] {
  return s.exercises
    .map((e) => ({
      name: e.name.trim(),
      sets: e.sets
        .filter((x) => x.done && x.reps > 0)
        .map((x) => ({ reps: x.reps, ...(x.weightKg != null && x.weightKg > 0 ? { weightKg: x.weightKg } : {}) })),
    }))
    .filter((e) => e.name && e.sets.length > 0);
}

/** Everything on the card, ticked or not — what "save this as my routine" means
 *  at the end of a session in which you added two exercises and dropped one. */
export function sessionAsEntries(s: LiveSession): StrengthEntry[] {
  return s.exercises
    .map((e) => ({
      name: e.name.trim(),
      sets: e.sets
        .filter((x) => x.reps > 0)
        .map((x) => ({ reps: x.reps, ...(x.weightKg != null && x.weightKg > 0 ? { weightKg: x.weightKg } : {}) })),
    }))
    .filter((e) => e.name && e.sets.length > 0);
}
