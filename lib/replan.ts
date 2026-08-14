// ---------------------------------------------------------------------------
// The plan responds to what you CHANGE, not only to what you finish.
//
// Ryan, 2026-08-10, after swapping a run for a bike and watching nothing move:
// "the plan updates only when you do the activity? i don't like this, it should
// change when we manually modify the workout too."
//
// He was right, and the reason is structural. `represcribe` reads the load
// LEDGER, and `sessionLoad` credits nothing until a session is done or swapped —
// so a change to a session you haven't done yet is invisible to it. Measured on
// a real plan: deviation 35.72% before a swap and 35.72% after. Identical. The
// responder wasn't ignoring the edit; it literally could not see it.
//
// This module supplies the missing signal: how far an upcoming week has drifted
// from the shape the ENGINE designed for it, purely because of edits. It is a
// different question from "how has your training gone", and it needs a different
// measurement, so it lives in its own file rather than being bolted onto the
// ledger.
//
// TWO AXES, BECAUSE ONE OF THEM MISSES THE CASE THAT PROMPTED THIS
//
// Measured across the edit types:
//
//   swap the hard session → bike      volume   0.0%   quality  −35.9%
//   skip the hard session             volume −11.0%   quality  −35.9%
//   halve an easy session             volume  −5.2%   quality    0.0%
//   lengthen an easy session +40%     volume  +4.3%   quality    0.0%
//
// A swap is volume-NEUTRAL and quality-destructive. Watching volume alone —
// the obvious implementation — would have scored Ryan's exact complaint as
// "nothing changed" all over again. Both axes, or this doesn't work.
//
// WHAT IT DOES, AND DELIBERATELY DOESN'T
//
//   harder than designed   → ease the OTHER sessions in the week. The safety
//                            direction, applied automatically.
//   lost quality           → rebuild the lost intensity into another session in
//                            the same week, volume-neutral. This is the coach
//                            move: "you rode instead of your intervals, so do
//                            them Thursday instead of your easy run."
//   lighter in volume only → NOTHING. You shortened a session because you were
//                            busy or tired; silently handing the time back
//                            somewhere else is the app arguing with you. Said
//                            out loud, not acted on.
//
// The asymmetry is doc 03 §4 C (protect fast, add slow) with Ryan's override
// applied: adding is allowed, but only where the athlete's own edit created the
// hole, never as a reflex to every change.
//
// Pure — no clock, no I/O.
// ---------------------------------------------------------------------------

import { isUnplanned, restoreSportContract, sportBalance, type Sport } from "./equilibrium";
import { railsRegressed } from "./rails";
import { scaleWorkout } from "./prescribe";
import { hardDayConflicts } from "./respond";
import { DISCIPLINE_META, ZONES } from "./zones";
import { swapDiscipline } from "./adapt";
import type { Discipline, Plan, Week, Workout, Zone } from "./types";

/** Volume drift that counts as a real change.
 *
 *  There is no noise to clear here — an untouched week measures exactly 0.00%,
 *  because the design is recovered from the baselines rather than re-derived. So
 *  this is purely "don't react to trivial edits", and it was measured against
 *  real ones: lengthening a session by 50% moves the week 5.4%, halving one
 *  moves it 5.2%. Set at 8% (the first guess) both of those scored as nothing,
 *  which is precisely the silence this exists to fix. */
export const EDIT_VOL_DEADBAND = 4;

/** Quality drift that counts. A swap costs ~36% of a week's hard minutes, a
 *  measured floor this sits well under while still ignoring rounding. */
export const EDIT_HARD_DEADBAND = 15;

/** How far a single session may be eased to absorb an athlete's own addition.
 *  Matches the spirit of MAX_CUT in prescribe — a session that shrinks past this
 *  has stopped being the session it was. */
const MAX_EASE = 0.75;

export interface WeekDrift {
  designedSec: number;
  currentSec: number;
  designedHardSec: number;
  currentHardSec: number;
  volPct: number;
  hardPct: number;
}

/**
 * What the engine asked this session to be, before the athlete touched it.
 *
 * Recovered from the baselines each edit already preserves, so it is exact
 * rather than inferred: `swappedFrom` for a sport swap, `prescribed` for a
 * resize or a re-pace. On an untouched plan every session reports itself, which
 * is why a fresh week measures 0.00% on both axes and the signal has no false
 * floor to calibrate around.
 */
export function designedOf(w: Workout): { sec: number; zone: Zone } {
  if (w.swappedFrom) return { sec: w.swappedFrom.estDurationSec, zone: w.swappedFrom.primaryZone };
  return {
    sec: w.prescribed?.estDurationSec ?? w.estDurationSec,
    zone: w.prescribed?.primaryZone ?? w.primaryZone,
  };
}

/** How far a week now sits from its own design, on both axes. */
export function weekDrift(plan: Plan, week: Week): WeekDrift {
  let designedSec = 0;
  let currentSec = 0;
  let designedHardSec = 0;
  let currentHardSec = 0;
  for (const id of week.workoutIds) {
    const w = plan.workouts[id];
    if (!w || w.discipline === "rest") continue;
    // A session the engine never wrote has no design, and `designedOf` would have
    // it speak for itself — putting an unplanned ride on the DESIGNED side while
    // its done-ness kept it off the current side. Extra work then measured as a
    // deficit: an unplanned 60 min ride made the app announce the week was "60 min
    // lighter than planned" (#215). It is not part of this comparison at all;
    // lib/absorb.ts is what answers for it.
    if (isUnplanned(w)) continue;
    const des = designedOf(w);
    designedSec += des.sec;
    if (des.zone >= 4) designedHardSec += des.sec;
    // A session that gave way to unplanned work is drift-NEUTRAL, whether it was
    // withdrawn or merely trimmed: the hour came off the calendar because the
    // athlete had already ridden it, so the week has not got lighter. Measuring it
    // as a loss would print "this week is now 110 min lighter than planned"
    // directly beneath "that ride covers your Long Endurance Ride" — the app
    // contradicting itself in two consecutive sentences (#215).
    if (w.absorbedBy) {
      currentSec += des.sec;
      if (des.zone >= 4) currentHardSec += des.sec;
      continue;
    }
    // A SKIP LEAVES THE COMPARISON ENTIRELY — both sides of it.
    //
    // It used to count on the designed side and not the current side, so a skipped hour
    // read as a permanent -60 min on the week. That number then NETTED against anything
    // the athlete did afterwards: measured on device, skipping a 60 min run on Tuesday
    // and then lengthening Friday's run by 28 min left the week measuring -2% — inside
    // the deadband — so the responder saw "on plan" and did nothing at all, while the
    // truth was a lost Z5 session and half an hour of extra easy volume.
    //
    // Drift is meant to answer "how far have the sessions still on the books moved from
    // what they were designed to be". A session that is gone is not one of them. Dropping
    // it from both sides makes a skip drift-NEUTRAL, which is also what the product
    // already promises: a skip is absorbed, not compensated for.
    if (w.status === "skipped") {
      designedSec -= des.sec;
      if (des.zone >= 4) designedHardSec -= des.sec;
      continue;
    }
    // Done work is history and can't be re-planned.
    if (w.status !== "planned") continue;
    currentSec += w.estDurationSec;
    if (w.primaryZone >= 4) currentHardSec += w.estDurationSec;
  }
  return {
    designedSec,
    currentSec,
    designedHardSec,
    currentHardSec,
    volPct: designedSec ? ((currentSec - designedSec) / designedSec) * 100 : 0,
    hardPct: designedHardSec ? ((currentHardSec - designedHardSec) / designedHardSec) * 100 : 0,
  };
}

export interface EditResponse {
  plan: Plan;
  changedIds: string[];
  headline: string;
}

/**
 * Sessions per sport this week, as designed vs as the plan now stands.
 *
 * The THIRD axis, and the one an athlete can most easily exploit. Volume and
 * quality both survive swapping every run for a ride — the week keeps its hours
 * and can keep its hard minutes — while the athlete quietly stops running.
 * Ryan, 2026-08-10: "someone could get away with just biking all the time and
 * never running."
 *
 * A SWAP counts as lost — that is the exploit this exists for. A SKIP does not.
 *
 * Skips used to count as a hole too, on the reasoning that skipping every run avoids
 * running just as effectively as swapping it away. True, but it made the plan do the one
 * thing Ryan has now asked it not to do three separate times: rewrite a session he did
 * not touch. The hole is not filled on the skip itself (`reassign` is false there) — it
 * just SITS in the week, and the next unrelated edit trips over it. Observed on device:
 * skip Tuesday's run, later lengthen Sunday's long run, and Friday's swim silently became
 * a run. The athlete changed a run and lost a swim.
 *
 * A skip is a decision, and the session is gone; it leaves the comparison exactly as it
 * leaves `weekDrift`. The avoid-your-weak-sport case is real but belongs to the weekly
 * adaptation, which can look at a fortnight and say so out loud — not to a silent
 * conversion triggered by an unrelated edit days later.
 */
export function sportDrift(plan: Plan, week: Week): Record<string, { designed: number; current: number }> {
  const balance = sportBalance(plan, week);
  const out: Record<string, { designed: number; current: number }> = {};
  for (const sport of Object.keys(balance) as Sport[]) {
    const b = balance[sport];
    if (b.contracted === 0 && b.current === 0) continue;
    out[sport] = { designed: b.contracted, current: b.current };
  }
  return out;
}

/**
 * Put a sport back that the athlete's edits removed — automatically, not as an
 * offer.
 *
 * An offer is a loophole: decline it every week and you have bought yourself a
 * bike-only block with the plan's blessing. So this acts, and the athlete can
 * undo it like any other adaptation.
 *
 * Volume-neutral: a session of the OVER-represented sport becomes the missing
 * one. It never adds a session, so the week's hours are untouched.
 *
 * Two guards, both non-negotiable:
 *   - a sport the athlete is injured out of is never restored. `avoid` is set by
 *     a severe injury, and forcing someone back onto a stress fracture to satisfy
 *     a sport count is the worst thing this file could do.
 *   - the conversion goes through `swapDiscipline`, so `swapAllowance` caps it
 *     against the week's mechanical impact headroom. Restoring runs is exactly
 *     the direction that can spike bone/tendon load, which is what that rail is
 *     for (#13).
 */
function restoreSport(
  plan: Plan,
  week: Week,
  todayISO: string,
  exceptId: string,
): { plan: Plan; id: string; from: Discipline; to: Discipline; wasSec: number; nowSec: number } | null {
  return restoreSportContract(plan, week, todayISO, exceptId, swapDiscipline);
}

/** Sessions in this week the responder may touch: still planned, not today's
 *  edit, not in the past, not race day, and carrying real structure. */
function candidates(plan: Plan, week: Week, todayISO: string, exceptId?: string): Workout[] {
  return week.workoutIds
    .map((id) => plan.workouts[id])
    .filter(
      (w): w is Workout =>
        !!w &&
        w.id !== exceptId &&
        w.id !== "w-race-day" &&
        w.status === "planned" &&
        w.discipline !== "rest" &&
        w.date >= todayISO &&
        !!w.segments?.length,
    )
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
}

/**
 * Respond to a manual edit of a session in an upcoming week.
 *
 * `exceptId` is the session the athlete just changed, and it is never touched —
 * they set it deliberately, and the responder's job is to adjust everything
 * around that choice. (Same rule `represcribe` follows; see its `exceptId`.)
 *
 * Returns null when the honest answer is "nothing", which is most of the time.
 */
export function respondToEdit(
  plan: Plan,
  todayISO: string,
  exceptId: string,
  /**
   * A SKIP is not an edit — it's a decision, and the responder must not undo it.
   *
   * Everything below was written for a TRADE: you turned a run into a ride, so
   * the week is a run short and one of your rides becomes a run to put the mix
   * back. Correct for a swap; wrong for a skip, where nothing was traded and the
   * session was removed on purpose.
   *
   * Measured before this flag existed — skipping a Tempo Run rewrote the
   * following Saturday's Aerobic Endurance Ride into a run, and announced it.
   * Ryan: "when I skip a session, it should not show up in the home page telling
   * me this is what you're gonna do tomorrow." Which is also the rule respond.ts
   * already states for the load ledger, quoting doc 02 §4 #11 — a life-miss is
   * not a reason to change the plan around it. It is a reason to say the week is
   * lighter, and stop there.
   */
  opts: { reassign?: boolean } = {},
): EditResponse | null {
  const reassign = opts.reassign !== false;
  const edited = plan.workouts[exceptId];
  if (!edited) return null;
  const week = plan.weeks.find((w) => w.index === edited.weekIndex);
  if (!week || week.isRaceWeek) return null;

  // 0) SPORT BALANCE FIRST, and automatically. This is the axis an athlete can
  //    exploit — volume and quality both survive turning every run into a ride —
  //    so it acts rather than asks, and it runs before the others because putting
  //    the sport back changes what the quality branch has to work with.
  let working = plan;
  const restoredSport = reassign ? restoreSport(plan, week, todayISO, exceptId) : null;
  let sportLine: string | null = null;
  const sportIds: string[] = [];
  if (restoredSport) {
    working = restoredSport.plan;
    sportIds.push(restoredSport.id);
    // Name the LENGTH when it changed. #219 was filed as a question — "Why did my 1h
    // bike turn into a 20 min run" — and a sentence that says only which sport it became
    // is exactly why it had to be asked. The mechanical cap can still legitimately trim
    // the replacement; when it does, the athlete is told, in the same breath.
    const wasMin = Math.round(restoredSport.wasSec / 60);
    const nowMin = Math.round(restoredSport.nowSec / 60);
    sportLine =
      `That leaves you a ${restoredSport.to} short this week, so your ${wasMin} min ` +
      `${restoredSport.from} becomes a ${restoredSport.to}` +
      (nowMin < wasMin
        ? ` — ${nowMin} min, because that is as much running as this week can take on safely.`
        : ".");
  }

  // MEASURED ON THE ATHLETE'S EDIT, NOT ON OUR OWN ANSWER TO IT.
  //
  // `restoreSport` has just run, and what it does is deliberately volume-RESTORING:
  // it converts a session back and may lengthen it to give the sport its time again.
  // Reading drift off the restored plan counts that correction as the athlete making
  // the week harder, and branch 1 then eases every session in the week to "absorb" it.
  // Measured: swapping a 75 min long ride to a swim restored a 35 min swim to a 45 min
  // ride, and the responder immediately announced "that adds 16 min to the week, so the
  // 6 sessions around it come down" — dropping the week's riding to 129 min, BELOW where
  // it stood before the fix. The responder was undoing its own work and charging the
  // athlete for it.
  //
  // Drift answers "what did the athlete's edit do to this week", so it is measured on
  // the plan as their edit left it. The restoration is the response, not another input.
  const drift = weekDrift(plan, week);

  // 1) The athlete made the week HARDER than designed — longer, or more
  //    intense. Ease the sessions around it so the week lands where it was
  //    meant to. This is the safety direction, so it acts rather than reports.
  if (drift.volPct > EDIT_VOL_DEADBAND || drift.hardPct > EDIT_HARD_DEADBAND) {
    const excessSec = Math.max(0, drift.currentSec - drift.designedSec);
    // The restored session is off-limits too: easing it is the same self-undoing as
    // measuring it, one step later.
    const pool = candidates(working, week, todayISO, exceptId).filter((w) => !sportIds.includes(w.id));
    const poolSec = pool.reduce((a, w) => a + w.estDurationSec, 0);
    if (!pool.length || poolSec <= 0) return null;
    // Shrink proportionally, so no single session carries the whole correction.
    const factor = Math.max(MAX_EASE, 1 - excessSec / poolSec);
    if (factor >= 0.999) return null;

    const next: Plan = { ...working, workouts: { ...working.workouts } };
    const changedIds: string[] = [...sportIds];
    for (const w of pool) {
      // scaleWorkout's factor is relative to the session's ORIGINAL prescription,
      // not to its current length — that's what stops repeated passes ratcheting
      // a session down. So the target has to be re-expressed against the baseline
      // rather than handed `factor` directly.
      const baselineSec = w.prescribed?.estDurationSec ?? w.estDurationSec;
      if (baselineSec <= 0) continue;
      const targetSec = w.estDurationSec * factor;
      const scaled = scaleWorkout(w, targetSec / baselineSec);
      if (scaled) {
        next.workouts[w.id] = scaled;
        changedIds.push(w.id);
      }
    }
    if (!changedIds.length) return null;
    if (railsRegressed(working, next).length) return null;
    return {
      plan: next,
      changedIds,
      headline:
        (sportLine ? sportLine + " " : "") +
        (drift.hardPct > EDIT_HARD_DEADBAND && drift.volPct <= EDIT_VOL_DEADBAND
          ? `That's a harder week than it was built to be, so the ${changedIds.length} session${changedIds.length === 1 ? "" : "s"} around it ease off to make room.`
          : `That adds ${Math.round(excessSec / 60)} min to the week, so the ${changedIds.length} session${changedIds.length === 1 ? "" : "s"} around it come down to absorb it.`),
    };
  }

  // 2) The week LOST quality — a swap is the classic case: volume untouched,
  //    the hard session gone. Rebuild that intensity into another session in the
  //    same week rather than letting the week quietly become all-aerobic.
  if (drift.hardPct < -EDIT_HARD_DEADBAND) {
    const lostSec = drift.designedHardSec - drift.currentHardSec;
    const restored = reassign ? restoreQuality(working, week, todayISO, exceptId, edited) : null;
    if (restored) {
      if (railsRegressed(working, restored.plan).length) return null;
      return {
        plan: restored.plan,
        changedIds: [...sportIds, restored.id],
        headline: sportLine
          ? `${sportLine} And that was ${Math.round(lostSec / 60)} min of your week's hard work, so ${restored.title} takes it on instead.`
          : `That was ${Math.round(lostSec / 60)} min of your week's hard work, so ${restored.title} takes it on instead.`,
      };
    }
    // Nowhere to put it. Say so rather than pretending the week is unchanged —
    // losing the only quality session is exactly what an athlete needs told.
    return {
      plan: working,
      changedIds: sportIds,
      headline: sportLine
        ? `${sportLine} The hard work it was carrying has nowhere left to go this week.`
        : `That drops ${Math.round(lostSec / 60)} min of hard work from this week, and there's no good day left to move it to.`,
    };
  }

  // 3) Lighter in volume only. The athlete chose that; handing the time back
  //    somewhere else would be the app arguing with them. Report, don't act.
  if (drift.volPct < -EDIT_VOL_DEADBAND) {
    const lighter = `This week is now ${Math.abs(Math.round((drift.designedSec - drift.currentSec) / 60))} min lighter than planned.`;
    return {
      plan: working,
      changedIds: sportIds,
      // "nothing else moves" is only true when nothing else moved. Saying it
      // beside a sport restoration that just changed a session is the app
      // contradicting itself in one sentence.
      headline: sportLine ? `${sportLine} ${lighter}` : `${lighter} That's fine — nothing else moves.`,
    };
  }

  // Nothing else moved, but the sport swap on its own is a real change worth
  // reporting — it is the whole point of the automatic restoration.
  if (restoredSport) return { plan: working, changedIds: sportIds, headline: sportLine! };

  return null;
}

/**
 * Rebuild lost intensity into another session in the same week.
 *
 * Volume-neutral by construction: the receiving session keeps its own duration
 * and only changes what it asks of you. That is the difference between "move the
 * quality" and "add a session", and it is why this can't smuggle load in.
 *
 * The receiver must not create back-to-back hard days — the engine spaces those
 * deliberately (`spaceHardDaysAcrossWeeks`), and undoing that silently would
 * trade one problem for a worse one.
 */
function restoreQuality(
  plan: Plan,
  week: Week,
  todayISO: string,
  exceptId: string,
  edited: Workout,
): { plan: Plan; id: string; title: string } | null {
  // What was lost: prefer the swapped-away session, else the pre-edit zone.
  const lost = edited.swappedFrom
    ? { zone: edited.swappedFrom.primaryZone, type: edited.swappedFrom.type }
    : edited.prescribed?.primaryZone && edited.prescribed.primaryZone >= 4
    ? { zone: edited.prescribed.primaryZone, type: edited.type }
    : null;
  if (!lost || lost.zone < 4) return null;

  // Prefer a receiver in the SAME sport as the work that was lost. Threshold
  // running and threshold swimming are not interchangeable stimuli, so relocating
  // a run's intervals onto a swim is a last resort, not a first choice.
  const pool = candidates(plan, week, todayISO, exceptId).sort((a, b) => {
    const want = edited.swappedFrom?.discipline ?? edited.discipline;
    return (a.discipline === want ? 0 : 1) - (b.discipline === want ? 0 : 1);
  });

  for (const w of pool) {
    // only an EASY session may be promoted; taking a Z3 tempo up to Z5 is a
    // different session, not a relocation
    if (w.primaryZone >= 3) continue;
    if (w.discipline === "strength" || w.discipline === "brick") continue;
    // the receiver has to be long enough to hold real intervals
    if (w.estDurationSec < 30 * 60) continue;

    // The title and purpose are REBUILT from the receiving session's own sport,
    // never copied from the session that was lost. Copying them produced a swim
    // titled "Run Threshold 5×1km" — the same header-contradicts-the-session bug
    // this codebase keeps having to fix. `type` is sport-agnostic, so it carries.
    const promoted: Workout = {
      ...w,
      type: lost.type,
      title: `${ZONES[lost.zone].name} ${DISCIPLINE_META[w.discipline].label}`,
      purpose: `Your ${ZONES[lost.zone].name.toLowerCase()} work lost its day this week, so it moves here — same length as this session was, at the intensity the week needs.`,
      primaryZone: lost.zone,
      // keep the receiver's own duration — this is a relocation, not an addition
      segments: w.segments.map((s) => (s.kind === "main" && (s.zone ?? 0) <= 2 ? { ...s, zone: lost.zone } : s)),
      note: `Carries this week's ${ZONES[lost.zone].name.toLowerCase()} work`,
      prescribed: w.prescribed ?? {
        estDurationSec: w.estDurationSec,
        estDistanceM: w.estDistanceM,
        segments: w.segments,
        primaryZone: w.primaryZone,
      },
    };
    const next: Plan = { ...plan, workouts: { ...plan.workouts, [w.id]: promoted } };
    // never manufacture back-to-back hard days
    const before = hardDayConflicts(plan, todayISO).length;
    if (hardDayConflicts(next, todayISO).length > before) continue;
    return { plan: next, id: w.id, title: w.title };
  }
  return null;
}
