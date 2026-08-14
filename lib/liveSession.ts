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

/** One set, mid-session. `done` is the whole point — see the header.
 *
 *  `reps` stays REQUIRED here, with 0 meaning "not entered yet", because a live
 *  session is where numbers get typed — `finish` already refuses to record a set
 *  with none. A routine's optional reps (`StrengthSet.reps`) are coerced on the way
 *  in, which is the one place the two models meet. */
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
  /** When the rest between sets is up — an ABSOLUTE instant, not a countdown.
   *
   *  This is the whole correctness story for the rest timer. A phone on a bench
   *  locks, and a suspended WebView stops firing intervals; a timer that counted
   *  ticks would come back having lost exactly the time the athlete was resting,
   *  which is the one number it exists to report. Storing the END and deriving
   *  the remainder from the clock is right whether the screen was on, off, or the
   *  app was killed and reopened. Absent when they aren't resting. */
  restUntilISO?: string;
  /** How long the running rest was set to. Kept so +30s / −30s and the progress
   *  ring have a denominator that doesn't move as the clock runs down. */
  restSec?: number;
}

// ---- rest between sets ------------------------------------------------------
//
// The defaults are prescription, not decoration, and they follow doc 01 §4 rule 4:
// a triathlete is not training for hypertrophy. They want strength/power and
// durability, and that work is only strength/power work if the rest is long enough
// to repay the ATP-PC system — cut a heavy triple's recovery to the 90 seconds a
// bodybuilding app defaults to and you have converted it into a fatigue session,
// which is the exact stimulus doc 01 says triathletes should NOT be buying.
//
// So rest is read off the set itself: heavy and low-rep gets the long recovery,
// the middle gets the conventional minute and a half, and high-rep or bodyweight
// circuit work gets the short one. The athlete can always overrule it.

/** Heavy, low-rep: near-full phosphocreatine resynthesis before the next effort. */
export const REST_HEAVY_SEC = 180;
/** The ordinary working set. */
export const REST_WORKING_SEC = 90;
/** High-rep and bodyweight circuit work, where the point is density. */
export const REST_CIRCUIT_SEC = 60;

/** How long to rest after this set, before the athlete says otherwise. */
export function restSecondsFor(set: LiveSet): number {
  if (set.reps > 0 && set.reps <= 6) return REST_HEAVY_SEC;
  if (set.reps > 12) return REST_CIRCUIT_SEC;
  return REST_WORKING_SEC;
}

/** Start (or restart) the rest clock. */
export function startRest(s: LiveSession, nowISO: string, seconds: number): LiveSession {
  const sec = Math.max(0, Math.round(seconds));
  return { ...s, restUntilISO: new Date(new Date(nowISO).getTime() + sec * 1000).toISOString(), restSec: sec };
}

/** Stop resting — skipped, or superseded by the next set going down. */
export function clearRest(s: LiveSession): LiveSession {
  const { restUntilISO: _u, restSec: _s, ...rest } = s;
  return rest;
}

/** Add or remove time from a running rest. Never goes below zero, and never
 *  starts one that wasn't running — "+30s" on no timer is a no-op, not a timer. */
export function nudgeRest(s: LiveSession, nowISO: string, deltaSec: number): LiveSession {
  if (!s.restUntilISO) return s;
  const endMs = new Date(s.restUntilISO).getTime() + deltaSec * 1000;
  const nowMs = new Date(nowISO).getTime();
  return {
    ...s,
    restUntilISO: new Date(Math.max(nowMs, endMs)).toISOString(),
    restSec: Math.max(0, (s.restSec ?? 0) + deltaSec),
  };
}

/** Seconds left, or null when the athlete isn't resting. Clamped at zero — a rest
 *  that elapsed while the phone was locked reads "done", never a negative number. */
export function restRemainingSec(s: LiveSession, nowISO: string): number | null {
  if (!s.restUntilISO) return null;
  const ms = new Date(s.restUntilISO).getTime() - new Date(nowISO).getTime();
  return Math.max(0, Math.ceil(ms / 1000));
}

// ---- how long the session actually took --------------------------------------
//
// The tracker knows when it started, and until now threw that away: Finish logged
// the sets and nothing else, so a 70-minute session was credited as whatever the
// plan had guessed — 45 min. Strength reaches the load model through its DURATION
// (`creditedSec`, absorb.ts), so that guess was propagating into CTL.
//
// Wall-clock elapsed is the honest measure, but only while it's believable. The
// session is a draft in storage that survives the phone locking, which is the whole
// point — and also means it survives being forgotten. Someone who starts a session,
// gets pulled away, and finishes it after lunch would otherwise credit four hours of
// training. So it is bounded on both ends, and OUTSIDE those bounds we say we don't
// know (null) rather than reporting a number we don't believe — the caller then falls
// back to the plan's estimate, which is exactly today's behaviour.

/** Below this, the athlete was transcribing a session afterwards, not tracking one. */
export const MIN_TRACKED_SEC = 5 * 60;
/** Above this, the session was left open rather than trained for that long. */
export const MAX_TRACKED_SEC = 3 * 60 * 60;

/** How long the session took, or null when the clock isn't believable. */
export function trackedDurationSec(s: LiveSession, nowISO: string): number | null {
  const started = new Date(s.startedISO).getTime();
  const now = new Date(nowISO).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(now)) return null;
  const sec = Math.round((now - started) / 1000);
  if (sec < MIN_TRACKED_SEC || sec > MAX_TRACKED_SEC) return null;
  return sec;
}

/**
 * Tick a set off (or back on) and move the rest clock with it.
 *
 * Separate from `setDone`, which stays a clockless set toggle: this is the one
 * that knows a completed set is followed by rest. Un-ticking stops the clock,
 * because the rest was for a set that, it turns out, hasn't happened.
 */
export function completeSet(s: LiveSession, ei: number, si: number, done: boolean, nowISO: string): LiveSession {
  const next = setDone(s, ei, si, done);
  if (!done) return clearRest(next);
  // The tick was refused (a set with no reps — see `setDone`), so there is no
  // completed set for a rest to follow. Starting one anyway would put a clock on
  // screen for work the app has just declined to record.
  if (next === s) return s;
  const set = next.exercises[ei]?.sets[si];
  return startRest(next, nowISO, set ? restSecondsFor(set) : REST_WORKING_SEC);
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
      sets: e.sets.map((s) => ({ reps: s.reps ?? 0, ...(s.weightKg != null ? { weightKg: s.weightKg } : {}), done: false })),
    })),
  };
}

// All of the below return a NEW session — the caller holds it in React state and
// writes it straight to storage, so mutating in place would persist nothing.

const mapExercise = (s: LiveSession, ei: number, f: (e: LiveExercise) => LiveExercise): LiveSession => ({
  ...s,
  exercises: s.exercises.map((e, i) => (i === ei ? f(e) : e)),
});

/**
 * A SET WITH NO REPS CANNOT BE TICKED OFF.
 *
 * `finishSession` writes only sets that are both ticked and numbered, so a ticked
 * blank is a set the athlete watched themselves complete and that the app then threw
 * away. That used to be an edge case — routines always carried numbers. Now that a
 * routine can be built empty and filled in on the first session, it is the DEFAULT
 * first session: open Push day to a skeleton, tick five blank sets off as you go,
 * finish, and record nothing. The baseline the whole feature exists to capture would
 * be lost at exactly the moment it was being made.
 *
 * Refused here rather than only in the UI so no other caller can reintroduce it, and
 * so `sessionProgress` is honest by construction: the bar can only count sets that
 * will survive the save. Un-ticking is always allowed — that is how you correct one.
 */
export function setDone(s: LiveSession, ei: number, si: number, done: boolean): LiveSession {
  if (done && !((s.exercises[ei]?.sets[si]?.reps ?? 0) > 0)) return s;
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
