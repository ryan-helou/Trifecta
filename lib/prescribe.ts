// ---------------------------------------------------------------------------
// Closing the loop: the load ledger prescribes, instead of only recording.
//
// The ledger already knows what really happened — `sessionLoad` credits the
// duration the athlete actually did and resolves intensity down a real ladder
// (logged RPE → device HR → feel → planned zone). `formDeviation` already turns
// that into the one number worth acting on: how far the athlete's true TSB has
// drifted from the TSB the plan budgeted for. What was missing is that nothing
// downstream ever read it. The plan recorded everything and prescribed nothing.
//
// This module is the feedback path. Deviation → a scalar → the next few
// sessions resized. Four rules shape it, none of them optional:
//
//  1. NEVER ADD. The factor is capped at 1.0. Doc 02 §4 #9 and doc 03 §4 C are
//     explicit that good days must not pile on load — the cost function is
//     asymmetric, a missed adaptation is cheap and an injury is a churn event.
//     An athlete running fresher than budget doesn't earn extra work; they earn
//     their original plan back, which falls out of rule 2 for free.
//  2. SCALE FROM THE BASELINE, never from the current value. Each session
//     remembers its original prescription the first time it's touched, so
//     repeated adaptation converges instead of ratcheting a session to nothing.
//     This is what makes it safe to run after every single logged event.
//  3. DEADBAND. Inside ±5% of CTL the deviation is noise. Doc 02 §4 #10: one
//     bad night is not a reason to rewrite anything.
//  4. NEVER LIE ABOUT THE SESSION. Segment descriptions carry their own numbers
//     ("6 × 100m @ CSS", "81 min @ Endurance"), so a segment is only rescaled
//     when its text can be rewritten to match. Anything else is left alone.
//     A shorter session with a description claiming the old numbers is worse
//     than no adaptation at all.
//
// Everything here is pure — no clock, no I/O. The caller supplies today.
// ---------------------------------------------------------------------------

import { FORM_DEBT_EASE_PCT, formDeviation } from "./load";
import { railsRegressed } from "./rails";
import type { Plan, Segment, Workout } from "./types";

/** Deviation inside ±this (percent of CTL) is noise, not signal. */
export const DEADBAND_PCT = 5;

/** The deepest cut a single re-prescription may make. Below this we'd be
 *  deleting the session rather than easing it, and doc 02 §4 #8 is clear that
 *  consistency is the actual driver — gate intensity, don't delete work. */
export const MAX_CUT = 0.7;

/** Deviation (percent of CTL) at which the cut bottoms out at MAX_CUT. Anchored
 *  below FORM_DEBT_EASE_PCT, the existing "you are in debt" threshold, so the
 *  scalar and the weekly ease card agree about which direction is bad. */
export const FULL_CUT_PCT = FORM_DEBT_EASE_PCT * 2.5; // -30

/** How many upcoming sessions one re-prescription may touch. A single event
 *  earns a small horizon; larger structural change is the weekly adaptation's
 *  job, not this one's. */
export const HORIZON_SESSIONS = 3;

/** Never cut a session below this many seconds — under it, it isn't training. */
export const MIN_SESSION_SEC = 15 * 60;

/** Total prescribed seconds a segment represents, including its repeats and
 *  children. The header duration must always equal this over the whole session;
 *  a title that disagrees with the structure under it is its own bug class. */
export function segmentSeconds(s: Segment): number {
  const reps = s.repeat ?? 1;
  const own = s.durationSec ?? 0;
  const kids = (s.children ?? []).reduce((a, c) => a + segmentSeconds(c), 0);
  return reps * (own + kids);
}

export function workoutSeconds(w: Workout): number {
  return (w.segments ?? []).reduce((a, s) => a + segmentSeconds(s), 0);
}

/** Rewrite the leading count in a rep-set description: "6 × 100m @ CSS" → "4 × …".
 *  Returns null when the text doesn't lead with a count, so the caller can decline
 *  to touch a segment it cannot describe honestly. */
export function retitleRepeat(description: string, reps: number): string | null {
  const m = /^(\d+)\s*(×|x)\s/.exec(description);
  if (!m) return null;
  return `${reps} ${m[2]} ${description.slice(m[0].length)}`;
}

/** Rewrite the leading duration in a continuous description: "81 min @ Endurance"
 *  → "65 min @ Endurance". Same contract: null when it can't be done truthfully. */
export function retitleMinutes(description: string, sec: number): string | null {
  const m = /^(\d+)\s*min\b/.exec(description);
  if (!m) return null;
  return `${Math.max(1, Math.round(sec / 60))} min${description.slice(m[0].length)}`;
}

/** Scale one segment, or return it untouched when it can't be expressed honestly.
 *
 *  Two shapes are scalable, and they're the two the engine actually emits:
 *  a repeat block whose description leads with its count (drop whole reps — what
 *  a coach says: "do four instead of six"), and a continuous block whose
 *  description leads with its minutes. Warm-ups and cool-downs are deliberately
 *  left alone: they're small, fixed, and cutting them changes the session's
 *  safety rather than its dose. */
function scaleSegment(s: Segment, factor: number): Segment {
  if (s.kind === "warmup" || s.kind === "cooldown" || s.kind === "rest") return s;

  const reps = s.repeat ?? 1;
  if (reps > 1) {
    const next = Math.max(1, Math.round(reps * factor));
    if (next === reps) return s;
    const description = retitleRepeat(s.description, next);
    if (description == null) return s; // can't say it truthfully → don't do it
    return { ...s, repeat: next, description };
  }

  if (s.durationSec && !s.children?.length) {
    const nextSec = Math.max(60, Math.round((s.durationSec * factor) / 60) * 60);
    if (nextSec === s.durationSec) return s;
    const description = retitleMinutes(s.description, nextSec);
    if (description == null) return s;
    return { ...s, durationSec: nextSec, description };
  }

  return s;
}

/** The session as originally prescribed — captured once, then never overwritten,
 *  so every later rescale is computed from the design rather than from whatever
 *  the last rescale left behind. Without this, adaptation ratchets. */
function baselineOf(w: Workout): Workout {
  return w.prescribed ? ({ ...w, ...w.prescribed } as Workout) : w;
}

/** Rescale a session to `factor` of its ORIGINAL prescription. Returns null when
 *  nothing could be changed honestly, so callers can count real work done rather
 *  than reporting a no-op as a change (the #108 dead-button lesson). */
export function scaleWorkout(w: Workout, factor: number): Workout | null {
  if (w.discipline === "rest" || w.status !== "planned") return null;
  // "Never add load" is clamped HERE, not left to callers. Every path that can
  // lengthen a session has to be closed at the primitive, or the guarantee is
  // only as good as the least careful caller — and doc 03 §4 C prices that
  // mistake as an injury rather than a missed adaptation. Factors above 1 mean
  // "restore toward the original", which the baseline gives us for free.
  const f = Math.min(1, factor);
  const base = baselineOf(w);
  const prescribed = w.prescribed ?? {
    estDurationSec: base.estDurationSec,
    estDistanceM: base.estDistanceM,
    segments: base.segments,
  };

  // A session with no structure can't be resized honestly — race day is the real
  // instance: 2h on the header, no segments under it. Shrinking the header alone
  // would leave the number and the session disagreeing, which is rule 4 again.
  if (!base.segments?.length) return null;

  const segments = base.segments.map((s) => scaleSegment(s, f));
  // Header duration is DERIVED from the structure, never scaled beside it. This
  // is unconditional on purpose: the one branch that computed it independently
  // was the only way the two could ever disagree, and a header that contradicts
  // the steps beneath it is exactly the bug that had a session advertising its
  // warm-up as its main set.
  const estDurationSec = segments.reduce((a, s) => a + segmentSeconds(s), 0);
  if (estDurationSec < MIN_SESSION_SEC && base.estDurationSec >= MIN_SESSION_SEC) return null;
  if (estDurationSec === w.estDurationSec) return null;

  const ratio = base.estDurationSec > 0 ? estDurationSec / base.estDurationSec : 1;
  return {
    ...w,
    segments,
    estDurationSec,
    estDistanceM: base.estDistanceM != null ? Math.round(base.estDistanceM * ratio) : undefined,
    prescribed,
  };
}

/** Deviation from the plan's own budget → the factor to prescribe at.
 *
 *  Negative deviation means the athlete's real form sits below what this block
 *  was designed to cost them: the work is costing more than budgeted. Positive
 *  means they're ahead of budget, and the answer there is 1.0 — the original
 *  plan, never more than it. */
export function loadFactor(deltaPct: number): number {
  if (deltaPct >= -DEADBAND_PCT) return 1;
  if (deltaPct <= FULL_CUT_PCT) return MAX_CUT;
  const span = FULL_CUT_PCT + DEADBAND_PCT; // negative
  const t = (deltaPct + DEADBAND_PCT) / span; // 0 at the deadband edge → 1 at full cut
  return 1 - t * (1 - MAX_CUT);
}

export interface Represcription {
  plan: Plan;
  /** how many sessions actually moved — 0 means nothing was said, so say nothing */
  changed: number;
  factor: number;
  deltaPct: number;
  reason: string;
}

/** Re-prescribe the next few sessions from the load the athlete has actually
 *  produced. Returns null when there's nothing to say: not enough history, the
 *  deviation is inside the deadband, or no session could be changed honestly. */
export function represcribe(plan: Plan, todayISO: string, horizon = HORIZON_SESSIONS): Represcription | null {
  const dev = formDeviation(plan, todayISO);
  if (!dev) return null; // not enough ledger yet — debounce by construction

  const factor = loadFactor(dev.deltaPct);
  if (factor >= 1) return null;

  // the next `horizon` real sessions, in date order, never touching race day
  const upcoming = Object.values(plan.workouts)
    .filter((w) => w.date >= todayISO && w.status === "planned" && w.discipline !== "rest" && w.id !== "w-race-day")
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)))
    .slice(0, horizon);
  if (!upcoming.length) return null;

  const raceWeek = plan.weeks.find((w) => w.isRaceWeek)?.index;
  const next: Plan = { ...plan, workouts: { ...plan.workouts } };
  let changed = 0;
  for (const w of upcoming) {
    if (raceWeek != null && w.weekIndex >= raceWeek) continue; // never touch race week
    const scaled = scaleWorkout(w, factor);
    if (scaled) {
      next.workouts[w.id] = scaled;
      changed++;
    }
  }
  if (!changed) return null;

  // This only ever reduces, so the gate should pass — assert it rather than
  // assume it, because a future edit that makes this add load must not sail
  // straight past the rails.
  const regressions = railsRegressed(plan, next);
  if (regressions.length) return null;

  return {
    plan: next,
    changed,
    factor,
    deltaPct: dev.deltaPct,
    reason:
      `Your last couple of weeks have cost you about ${Math.abs(Math.round(dev.deltaPct))}% more than this block budgeted for, ` +
      `so the next ${changed} ${changed === 1 ? "session is" : "sessions are"} trimmed to ${Math.round(factor * 100)}% — ` +
      `same shape, less of it.`,
  };
}
