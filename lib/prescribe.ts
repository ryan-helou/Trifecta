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
import { recordDecision } from "./decisions";
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

/** The most a single AUTOMATIC re-prescription may ADD.
 *
 *  Deliberately far below MAX_STRETCH (1.5), which is what an athlete may ask for by
 *  hand: the plan is less free with load than the person is. Doc 03 §4 C used to forbid
 *  automatic increases outright; Ryan overrode that on 2026-08-09 (see the note in that
 *  section). The asymmetry survives in the numbers even though the rule is gone —
 *  trimming can take 30% off in one step, adding can put 12% back — because the reason
 *  for it never stopped being true: a missed adaptation costs a little training, a
 *  wrongly-added one costs an injury. */
export const MAX_ADD = 1.12;

/** Deviation (percent of CTL) at which the increase reaches MAX_ADD. Mirrors
 *  FULL_CUT_PCT, but wider — you have to be well clear of budget for a sustained
 *  stretch before the plan starts handing work back. */
export const FULL_ADD_PCT = 25;

/** How many upcoming sessions one re-prescription may touch. A single event
 *  earns a small horizon; larger structural change is the weekly adaptation's
 *  job, not this one's. */
export const HORIZON_SESSIONS = 3;

/** Never cut a session below this many seconds — under it, it isn't training. */
export const MIN_SESSION_SEC = 15 * 60;

/** The most an athlete may stretch one session beyond its prescription. Half again is
 *  a generous "I felt good and had the time"; beyond that it stops being the session
 *  the plan designed and the ramp rails would have to argue about it anyway. */
export const MAX_STRETCH = 1.5;

/**
 * How far the ATHLETE may stretch a session when they ask for it by hand.
 *
 * `MAX_STRETCH` is the ceiling on growth the SYSTEM initiates — "never add load" —
 * and it stays where it is. This is the other side of that asymmetry, which
 * `scaleWorkout` has always described in words and then not honoured: a person
 * deliberately typing a bigger number is not the plan piling work onto them.
 *
 * At 1.5 it was, in practice, a refusal that did not admit to being one. Ryan asked
 * to take a 4 km run to 12 km and got 4.6 km back, under a toast reading "is now
 * 4.6 km" — the app neither doing what he asked nor saying it had declined:
 * "i cant change my aug 15 4km run to 12 stop trying to stop me".
 *
 * Still bounded, because a typo should not silently produce a 120 km run — but
 * bounded far enough that a real training decision fits inside it, and when the
 * bound does bite the athlete is TOLD (see `adjustSession` / `resizeByDistance`),
 * never quietly given something smaller than they asked for. The rails still get
 * the final say on whether the week can carry it.
 */
export const ATHLETE_MAX_STRETCH = 4;

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

/** Metres a segment covers — the distance-side mirror of `segmentSeconds`. */
export function segmentMeters(s: Segment): number {
  const reps = s.repeat ?? 1;
  const own = s.distanceM ?? 0;
  const kids = (s.children ?? []).reduce((a, c) => a + segmentMeters(c), 0);
  return reps * (own + kids);
}

/**
 * Seconds-per-metre implied by a session's OWN header, used to price the parts
 * of it prescribed in metres rather than minutes.
 *
 * `segmentSeconds` counts only `durationSec`, which is right for a run or a ride
 * and reads a 44-minute swim as ~2 minutes: swim sets are prescribed in metres
 * and only the rests carry a clock. That is why every swim resize was refused
 * outright (#203) — `scaleWorkout` derived the new header from `segmentSeconds`,
 * landed under MIN_SESSION_SEC, and bailed.
 *
 * Rather than reach for the athlete's pace model (which this layer deliberately
 * does not have), solve for the rate that makes the session's own header true:
 *
 *     secPerM = (headerSeconds − durationParts) / distanceParts
 *
 * Zero for a pure-duration session, so applying it changes nothing there.
 */
export function metrePace(segments: Segment[], headerSec: number): number {
  const durSec = segments.reduce((a, s) => a + segmentSeconds(s), 0);
  const distM = segments.reduce((a, s) => a + segmentMeters(s), 0);
  if (distM <= 0) return 0;
  return Math.max(0, (headerSec - durSec) / distM);
}

/** Total seconds for a structure, with its metres priced at `secPerM`. */
export function structuralSeconds(segments: Segment[], secPerM: number): number {
  const durSec = segments.reduce((a, s) => a + segmentSeconds(s), 0);
  const distM = segments.reduce((a, s) => a + segmentMeters(s), 0);
  return durSec + distM * secPerM;
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
/** Rewrite the leading distance in a plain block: "500m easy, mixed strokes" →
 *  "400m easy, mixed strokes". The distance-side mirror of `retitleMinutes`, and the
 *  reason a pool swim can be resized at all — see `scaleSegment`. */
export function retitleMeters(description: string, metres: number): string | null {
  const m = /^(\d[\d,]*)\s*m\b/.exec(description);
  if (!m) return null;
  return `${metres}m${description.slice(m[0].length)}`;
}

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
function scaleSegment(s: Segment, factor: number, discipline?: Segment["discipline"]): Segment {
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

  // A PLAIN DISTANCE BLOCK — the branch that was missing, and it made whole sessions
  // unresizable.
  //
  // A recovery swim is built as 200m / 500m / 200m: no rep count, no minutes, just
  // metres. Neither branch above matches it, so every rung of the length ladder came
  // back "can't be expressed truthfully" and the athlete was told the session was
  // "already as close to that as it can get" — for every option, including obviously
  // reachable ones. Reported by Ryan as simply "why is it not letting me resize
  // sessions?".
  //
  // Rounded to whole pool lengths (or 100 m blocks on land) so the number stays
  // something a person can actually swim to, and retitled so the text and the metres
  // never disagree — the same contract the two branches above keep.
  if (s.distanceM && !s.children?.length) {
    const step = (discipline ?? s.discipline) === "swim" ? 25 : 100;
    const nextM = Math.max(step, Math.round((s.distanceM * factor) / step) * step);
    if (nextM === s.distanceM) return s;
    const description = retitleMeters(s.description, nextM);
    if (description == null) return s;
    return { ...s, distanceM: nextM, description };
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
export function scaleWorkout(w: Workout, factor: number, opts?: { allowLonger?: boolean }): Workout | null {
  if (w.discipline === "rest" || w.status !== "planned") return null;
  // "Never add load" is clamped HERE by DEFAULT, not left to callers. Every path that
  // can lengthen a session has to be closed at the primitive, or the guarantee is only
  // as good as the least careful caller — and doc 03 §4 C prices that mistake as an
  // injury rather than a missed adaptation. Factors above 1 mean "restore toward the
  // original", which the baseline gives us for free.
  //
  // `allowLonger` is the ONE exception, and it is only ever passed by an athlete
  // deliberately asking for a longer session (adjustSession). A person choosing to do
  // more is not the system piling load on them — that asymmetry is the whole point of
  // the rule — and the choice is still bounded and rails-gated where it is made.
  const f = opts?.allowLonger ? Math.min(ATHLETE_MAX_STRETCH, factor) : Math.min(1, factor);
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

  const segments = base.segments.map((s) => scaleSegment(s, f, w.discipline));
  // Header duration is DERIVED from the structure, never scaled beside it. This
  // is unconditional on purpose: the one branch that computed it independently
  // was the only way the two could ever disagree, and a header that contradicts
  // the steps beneath it is exactly the bug that had a session advertising its
  // warm-up as its main set.
  // `structuralSeconds`, not a bare `segmentSeconds` sum: the latter cannot see
  // metres, so every swim measured ~2 min and was refused (#203). The rate is
  // calibrated on the BASELINE's own header so before and after are compared in
  // one currency.
  const secPerM = metrePace(base.segments, base.estDurationSec);
  const estDurationSec = Math.round(structuralSeconds(segments, secPerM));
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
  // inside the deadband nothing happens in either direction — one easy day, or one
  // hard one, is noise (doc 02 §4 #10)
  if (Math.abs(deltaPct) <= DEADBAND_PCT) return 1;

  if (deltaPct < 0) {
    // DEBT: the work is costing more than budgeted → trim
    if (deltaPct <= FULL_CUT_PCT) return MAX_CUT;
    const span = FULL_CUT_PCT + DEADBAND_PCT; // negative
    const t = (deltaPct + DEADBAND_PCT) / span; // 0 at the deadband edge → 1 at full cut
    return 1 - t * (1 - MAX_CUT);
  }

  // CREDIT: consistently under what this block budgeted for → put some back.
  //
  // This branch is the doc 03 §4 C override (2026-08-09, Ryan's decision, recorded in
  // that doc). It used to return 1 unconditionally, because good days were never
  // allowed to add load. It now adds — gently, capped at MAX_ADD, and still gated by
  // railsRegressed at the call site so it can never breach the ramp.
  if (deltaPct >= FULL_ADD_PCT) return MAX_ADD;
  const t = (deltaPct - DEADBAND_PCT) / (FULL_ADD_PCT - DEADBAND_PCT); // 0 → 1
  return 1 + t * (MAX_ADD - 1);
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
 *  deviation is inside the deadband, or no session could be changed honestly.
 *
 *  `exceptId` protects a session the athlete has just set by hand. The plan
 *  should respond AROUND a deliberate choice, not TO it: without this, setting
 *  today's easy run to threshold pace made it Zone 4 and then — in the same
 *  action, from the credit branch — 10% longer, so asking for harder silently
 *  bought harder AND longer. The same shape bit the length control: shorten a
 *  session because you're short of time and the responder could hand some of it
 *  straight back. It is the rule `hardDayConflicts` already states in words —
 *  "the athlete did it on purpose, and silently undoing it would be the app
 *  arguing with them" — applied to volume instead of scheduling. */
export function represcribe(
  plan: Plan,
  todayISO: string,
  horizon = HORIZON_SESSIONS,
  exceptId?: string,
): Represcription | null {
  const dev = formDeviation(plan, todayISO);
  if (!dev) return null; // not enough ledger yet — debounce by construction

  const factor = loadFactor(dev.deltaPct);
  if (factor === 1) return null; // inside the deadband — nothing honest to say

  // Adding is allowed now (doc 03 §4 C override), but never while an injury is
  // active. Rules A and B of that doc are untouched by the override, and handing more
  // load to someone already carrying a niggle is exactly the case they exist for.
  const injured = (plan.profile.injuries ?? []).length > 0;
  if (factor > 1 && injured) return null;

  // the next `horizon` real sessions, in date order, never touching race day
  const upcoming = Object.values(plan.workouts)
    .filter(
      (w) =>
        w.date >= todayISO &&
        w.status === "planned" &&
        w.discipline !== "rest" &&
        w.id !== "w-race-day" &&
        w.id !== exceptId,
    )
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)))
    .slice(0, horizon);
  if (!upcoming.length) return null;

  const raceWeek = plan.weeks.find((w) => w.isRaceWeek)?.index;
  const next: Plan = { ...plan, workouts: { ...plan.workouts } };
  let changed = 0;
  for (const w of upcoming) {
    if (raceWeek != null && w.weekIndex >= raceWeek) continue; // never touch race week
    const scaled = scaleWorkout(w, factor, { allowLonger: factor > 1 });
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
      factor < 1
        ? `Your last couple of weeks have cost you about ${Math.abs(Math.round(dev.deltaPct))}% more than this block budgeted for, ` +
          `so the next ${changed} ${changed === 1 ? "session is" : "sessions are"} trimmed to ${Math.round(factor * 100)}% — ` +
          `same shape, less of it.`
        : `You've been running about ${Math.round(dev.deltaPct)}% lighter than this block budgeted for, ` +
          `so the next ${changed} ${changed === 1 ? "session gets" : "sessions get"} ${Math.round((factor - 1) * 100)}% put back — ` +
          `same shape, a little more of it.`,
  };
}

/** The durations offered when an athlete adjusts a session, derived from what the plan
 *  actually asked for rather than a fixed ladder. Real life is "I've only got forty
 *  minutes", so the options are TIMES, not percentages — nobody thinks in percentages
 *  about their own training. Sorted, de-duplicated, and always including the original
 *  so putting it back is one tap. */
export function adjustChoices(w: Workout): number[] {
  const base = (w.prescribed?.estDurationSec ?? w.estDurationSec) || 0;
  if (base <= 0) return [];
  const round5 = (sec: number) => Math.round(sec / 300) * 300;
  // Reaches 2× rather than stopping at MAX_STRETCH: the ladder is what the athlete
  // can express in one tap, and capping it at the SYSTEM's growth limit made "make
  // this session properly long" unreachable without typing.
  const out = [0.5, 0.7, 0.85, 1, 1.5, 2]
    .map((f) => round5(base * f))
    .filter((sec) => sec >= MIN_SESSION_SEC);
  return [...new Set(out)].sort((a, b) => a - b);
}

export interface Adjustment {
  plan: Plan;
  workout: Workout;
  /** one sentence, athlete-facing */
  summary: string;
}

/** Resize ONE session to a target duration, because the athlete said so.
 *
 *  This is the deliberate-choice counterpart to `represcribe`: same honest rescaling
 *  (segment text rewritten to match, header derived from the structure, computed from
 *  the stored baseline so it converges), but it may lengthen as well as shorten.
 *
 *  Still gated. `railsRegressed` gets the final say, so "I'll do an extra half hour"
 *  can't quietly blow the week's ramp or tip the block out of its intensity band — the
 *  athlete's choice is respected right up to the point where it would break the plan
 *  that makes the choice meaningful. Returns null when nothing would change, so the UI
 *  never offers a button that does nothing (#108). */
export function adjustSession(plan: Plan, workoutId: string, targetSec: number): Adjustment | null {
  const w = plan.workouts[workoutId];
  if (!w) return null;
  const base = (w.prescribed?.estDurationSec ?? w.estDurationSec) || 0;
  if (base <= 0 || targetSec <= 0) return null;

  const scaled = scaleWorkout(w, targetSec / base, { allowLonger: true });
  if (!scaled) return null;

  // The length the athlete chose is a decision, so it goes in the ledger and
  // survives every regeneration. `represcribe` and `easeUpcoming` deliberately do
  // NOT come through here — they call `scaleWorkout` directly — because the plan
  // softening a session is not the athlete asking for it, and replaying an ease
  // forever would be the plan refusing to let them get their training back.
  const withLedger = recordDecision(plan, w, { kind: "resize", sec: scaled.estDurationSec, distanceM: scaled.estDistanceM });
  const next: Plan = { ...withLedger, workouts: { ...plan.workouts, [workoutId]: scaled } };
  if (railsRegressed(plan, next).length) return null;

  const wasSec = w.estDurationSec;
  const nowSec = scaled.estDurationSec;
  const back = scaled.prescribed && nowSec === scaled.prescribed.estDurationSec;
  // NEVER HAND BACK SOMETHING SMALLER THAN WAS ASKED FOR WITHOUT SAYING SO.
  //
  // The clamp used to be invisible: ask for 12 km, receive 4.6 km, and read a toast
  // announcing 4.6 km as though that had been the request. Silently substituting a
  // different answer is worse than refusing, because there is nothing to argue with.
  //
  // Detected on the requested FACTOR, not on the resulting seconds. Only `main`
  // segments scale — the warm-up and cool-down keep their length — so the derived
  // total almost never lands exactly on the ask, and testing the result would have
  // announced a cap on ordinary requests that were honoured perfectly well.
  const shortOfAsk = targetSec / base > ATHLETE_MAX_STRETCH;
  const summary = back
    ? `${scaled.title} is back to its full ${Math.round(nowSec / 60)} min.`
    : shortOfAsk
    ? `${scaled.title} is now ${Math.round(nowSec / 60)} min — that's as far as one session can stretch in a single step. Ask again from here to go further.`
    : `${scaled.title} is now ${Math.round(nowSec / 60)} min — same shape, ${nowSec < wasSec ? "less" : "more"} of it.`;
  return { plan: next, workout: scaled, summary };
}
