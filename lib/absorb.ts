// ---------------------------------------------------------------------------
// Work you did that the plan never asked for still counts against the week.
//
// Ryan, 2026-08-11 (#215), and he called it the most important feature in the app:
// "i did a bike today that wasnt on the plan, the problem is the plan shouldve
// removed another bike from the week if the bike i did was an adequate
// equivalent, or if it was not adaquate enough at least shortened or modified
// the other ride."
//
// He was right, and the plan was not merely silent — it was saying the OPPOSITE.
// Measured on a real olympic block before this module existed: an athlete logs an
// unplanned 60-minute ride into a week holding a 60 min Sweet Spot and a 110 min
// Long Endurance Ride, and the app answers
//
//     "This week is now 60 min lighter than planned. That's fine — nothing else moves."
//
// Sixty minutes of riding read as a sixty-minute DEFICIT. The sign was inverted,
// because `weekDrift` recovers a week's design from the sessions in it and an
// unplanned session reports itself as its own design: it landed on the designed
// side of the ledger, and — being already done — was excluded from the current
// side. Extra work therefore looked exactly like missed work. That is fixed at
// the source in replan.ts (`designedOf` now refuses to speak for a session the
// engine never wrote), and this module supplies the answer that should have been
// there instead.
//
// WHY A SEPARATE PASS AND NOT ANOTHER DRIFT BRANCH
//
// Drift is a question about SHAPE — the week still holds the sessions it was
// designed with, but they've been edited. Absorption is a question about
// DUPLICATION: the athlete has already done a thing the week is still going to
// ask them for. Those want different answers. Easing every session in the week
// by a proportional slice — what the drift path would do — spreads a bike's cost
// across the swims and the long run, which is precisely the "makeup cramming"
// doc 04 §6 says a plan must not do. The right answer is local and it is
// same-sport: the ride you already did comes off the ride you have left.
//
// THE TWO OUTCOMES, WHICH ARE THE TWO RYAN ASKED FOR
//
//   adequate equivalent  → the matching session is ABSORBED. It leaves the week
//                          carrying `absorbedBy`, so it is never counted as a
//                          miss (that distinction is load-bearing — see below).
//   partial cover        → the matching session is SHORTENED by what was already
//                          done, through the same honest `scaleWorkout` every
//                          other resize goes through.
//
// QUALITY IS PROTECTED, ALWAYS
//
// An easy hour on the bike does not buy you out of your Sweet Spot intervals.
// Letting it would fix the volume by destroying the week's only quality — the
// same trade replan.ts already refuses when it restores a sport. So easy
// unplanned work may only absorb easy sessions; a hard session can only be
// absorbed by something that was itself hard.
//
// ABSORBED IS NOT SKIPPED
//
// The obvious implementation marks the covered session "skipped" and stops. That
// would be a real bug, not a cosmetic one: `assessAdaptation` counts skipped
// sessions as missed, and missing ≥40% of a fortnight triggers an ease. Absorb
// three rides across two weeks and the plan would conclude the athlete is falling
// behind and soften the block — because they trained MORE. `absorbedBy` is what
// keeps "you already did this" and "you didn't do this" apart everywhere it
// matters.
//
// Pure — no clock, no I/O. The caller supplies today.
// ---------------------------------------------------------------------------

import { MIN_SESSION_SEC, scaleWorkout } from "./prescribe";
import { railsRegressed } from "./rails";
import type { Discipline, Plan, Week, Workout } from "./types";

/** How much of a session must already be covered for it to come off the week
 *  entirely, rather than be trimmed.
 *
 *  0.7 is not a fresh guess — it is the lower bound `isEquivalent` in adapt.ts
 *  already uses to decide that what an athlete did counts as the session that was
 *  planned. Two different answers to "is this the same session?" living in one
 *  codebase is how they drift apart, so this reuses that one. */
export const ADEQUATE = 0.7;

/**
 * Intensity is a ONE-WAY door: work can stand in for a session at its own
 * intensity or below, never above.
 *
 * Measured on the first cut of this module, which only protected sessions above
 * Z2: an RPE-5 hour on the bike absorbed a `Sweet Spot 3×8`, and the week lost its
 * only quality ride to a steady spin. That is the exact trade replan.ts already
 * refuses when it restores a sport — fixing the volume by destroying the
 * stimulus — and 60 easy minutes are not 60 threshold minutes in any model this
 * app has. So the comparison is against the target's own zone rather than a fixed
 * line, which protects a Z3 tempo from a Z2 spin too.
 */
function canCover(didZone: number, targetZone: number): boolean {
  return didZone >= targetZone;
}

/** Seconds of real work this session represents. Prefers what was actually done
 *  over what was estimated — the whole point is to credit reality. */
export function creditedSec(w: Workout): number {
  return w.actualDurationSec ?? w.loggedDurationSec ?? w.estDurationSec ?? 0;
}

/**
 * Did the ENGINE design this session, or did it arrive some other way?
 *
 * Three routes produce work the plan never wrote, and they must all answer yes
 * or the week's arithmetic is wrong for one of them:
 *   - logged by hand with nothing planned that day (`logged-` ids, adapt.ts)
 *   - synced from a device and matched to nothing (`synced-` ids, activity.ts)
 *   - deliberately added by the athlete (#209, `addedByAthlete`)
 */
export function isUnplanned(w: Workout): boolean {
  return !!w.addedByAthlete || w.id.startsWith("logged-") || w.id.startsWith("synced-");
}

/** Would work in `did` count toward a session planned as `planned`?
 *  A brick is part ride and part run, so either satisfies part of it. */
function covers(did: Discipline, planned: Discipline): boolean {
  if (did === planned) return true;
  if (planned === "brick" && (did === "bike" || did === "run")) return true;
  return false;
}

export interface Absorption {
  plan: Plan;
  /** the session that gave way */
  id: string;
  kind: "absorbed" | "shortened";
  /** one sentence, athlete-facing — every change explains itself or it doesn't ship */
  headline: string;
}

/**
 * Fold a completed, unplanned session into the week it landed in.
 *
 * Returns null when the honest answer is "nothing" — no matching session left,
 * nothing but quality left to protect, or the week is race week. Silence is the
 * common case and it is correct; a plan that visibly reshuffles on every logged
 * activity reads as chaotic rather than responsive (doc 02 §4 #10).
 */
export function absorbUnplanned(plan: Plan, todayISO: string, doneId: string): Absorption | null {
  const did = plan.workouts[doneId];
  if (!did || did.status !== "done" || !isUnplanned(did)) return null;
  if (did.discipline === "rest") return null;

  const week: Week | undefined = plan.weeks.find((w) => w.index === did.weekIndex);
  // Race week is never rebalanced — the taper is the point, and trimming it
  // because someone rode on Tuesday would undo the thing the block was built for.
  if (!week || week.isRaceWeek) return null;

  const didSec = creditedSec(did);
  if (didSec <= 0) return null;

  // WAS TODAY ALREADY SPOKEN FOR IN THIS SPORT?
  //
  // Ryan: "if I already did a ten k run today and I had a ten k run planned for
  // Saturday, and I had nothing planned for today, then, and only then, should I
  // switch." The condition is the point. If the day held no run, an unplanned 10k
  // stands IN FOR Saturday's — you did that session, early. If the day already had
  // a run and you did it, the 10k is genuinely on top, and deleting Saturday would
  // be handing you a rest day for training more.
  //
  // Measured before this check: doing today's planned 40 min run AND an extra 55
  // min run removed Saturday's 75 min long run outright. Same input, two very
  // different weeks, and only one of them is what the athlete meant.
  //
  // So a day that already carried this sport caps the answer at SHORTEN. The work
  // still counts — it just reduces what's left instead of cancelling it.
  const dayAlreadyHadThisSport = Object.values(plan.workouts).some(
    (w) =>
      w.id !== doneId &&
      w.date === did.date &&
      !isUnplanned(w) &&
      covers(did.discipline, w.discipline),
  );

  // Everything still on the books this week that the work could stand in for.
  const pool = week.workoutIds
    .map((id) => plan.workouts[id])
    .filter(
      (w): w is Workout =>
        !!w &&
        w.id !== doneId &&
        w.id !== "w-race-day" &&
        w.status === "planned" &&
        w.date >= todayISO &&
        !!w.segments?.length &&
        covers(did.discipline, w.discipline) &&
        canCover(did.primaryZone, w.primaryZone),
    )
    // Nearest in intensity first, then nearest in length — that is what "an
    // adequate equivalent" means, and in that order. A hard unplanned ride facing
    // both an interval session and an easy long ride should take the intervals off
    // the week even when the long ride is closer in minutes; length alone would
    // spend a quality-for-quality match on an easy session and leave the athlete
    // doing their intervals twice. Ties go to the earlier session, so the week
    // resolves front to back.
    .sort((a, b) => {
      const za = Math.abs(a.primaryZone - did.primaryZone);
      const zb = Math.abs(b.primaryZone - did.primaryZone);
      if (za !== zb) return za - zb;
      const da = Math.abs(a.estDurationSec - didSec);
      const db = Math.abs(b.estDurationSec - didSec);
      return da === db ? a.date.localeCompare(b.date) : da - db;
    });

  for (const target of pool) {
    // Measure against the ORIGINAL prescription, not the current value. Otherwise a
    // session already trimmed by an earlier pass looks easier to cover than it is,
    // and two unplanned rides could between them absorb a session neither earned.
    const baseSec = target.prescribed?.estDurationSec ?? target.estDurationSec;
    if (baseSec <= 0) continue;

    // --- adequate equivalent → it comes off the week ------------------------
    // …unless the day already carried this sport, in which case this was extra
    // work rather than a stand-in, and the most it may do is shorten (see above).
    if (didSec / baseSec >= ADEQUATE && !dayAlreadyHadThisSport) {
      const absorbed: Workout = {
        ...target,
        status: "skipped",
        absorbedBy: doneId,
        note: `Covered by the ${did.discipline} you did on ${did.date}`,
      };
      const next: Plan = { ...plan, workouts: { ...plan.workouts, [target.id]: absorbed } };
      if (railsRegressed(plan, next).length) continue;
      return {
        plan: next,
        id: target.id,
        kind: "absorbed",
        headline:
          `That ${did.discipline} wasn't on the plan, and it covers ${target.title} — ` +
          `so that one comes off this week rather than asking you to do it twice.`,
      };
    }

    // --- partial cover → what's left of it -----------------------------------
    const remainingSec = baseSec - didSec;
    // Below the floor it stops being training. Absorbing it outright would be
    // over-crediting work the athlete hasn't done, so leave it alone and let the
    // next candidate (or nothing) answer.
    if (remainingSec < MIN_SESSION_SEC) continue;
    const scaled = scaleWorkout(target, remainingSec / baseSec);
    if (!scaled) continue;

    const trimmed: Workout = { ...scaled, absorbedBy: doneId };
    const next: Plan = { ...plan, workouts: { ...plan.workouts, [target.id]: trimmed } };
    if (railsRegressed(plan, next).length) continue;
    return {
      plan: next,
      id: target.id,
      kind: "shortened",
      headline:
        `That ${did.discipline} wasn't on the plan, so ${target.title} comes down to ` +
        `${Math.round(trimmed.estDurationSec / 60)} min — you've already done part of it.`,
    };
  }

  return null;
}
