import { coachSafeTitle } from "./stravaPrivacy";
import { Discipline, Feel, Plan, StrengthEntry, Week, Workout, Zone } from "./types";
import { addDays, dayIndexOf, fromISO, mondayOf, weeksBetween } from "./dates";
import { BuildCtx, Draft } from "./workouts";
import * as W from "./workouts";
import { ENGINE_VERSION, generatePlan, isFitnessGoal } from "./planEngine";
import { ZONES } from "./zones";
import { fmtDuration } from "./format";
import { creditedDiscipline, creditedSeconds } from "./credit";
import { formDeviation, FORM_DEBT_EASE_PCT } from "./load";
import { swapAllowance } from "./mechanical";

// re-exported so existing importers keep working; the definitions live in credit.ts
export { creditedDiscipline, creditedSeconds };

// ---------------------------------------------------------------------------
// Plan adaptation. Pure functions returning a new Plan.
// Rules (from best-in-class apps): a single miss is absorbed, not crammed;
// "skip" (won't do) and "move" (will do later) are distinct; swaps replace a
// session; falling behind → rebuild the remainder from today.
// ---------------------------------------------------------------------------

function clonePlan(plan: Plan): Plan {
  return {
    ...plan,
    workouts: Object.fromEntries(Object.entries(plan.workouts).map(([k, v]) => [k, { ...v, segments: v.segments }])),
    weeks: plan.weeks.map((w) => ({ ...w, workoutIds: [...w.workoutIds] })),
  };
}

/** Recompute each week's workout membership + day/week indices from dates. */
export function reindexWeeks(plan: Plan): void {
  for (const wk of plan.weeks) wk.workoutIds = [];
  const weeksSorted = [...plan.weeks].sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  for (const w of Object.values(plan.workouts)) {
    // A workout belongs to the week whose Monday matches its own Monday. Comparing
    // by calendar Monday (not start + 7*86400000 ms) is exact across DST — a fixed
    // millisecond week overshoots the next Monday's local midnight by an hour after
    // spring-forward, mis-bucketing that Monday into the previous week.
    const wm = mondayOf(w.date);
    const wk = weeksSorted.find((week) => week.startDate === wm);
    if (wk) {
      w.weekIndex = wk.index;
      w.dayIndex = dayIndexOf(w.date);
      wk.workoutIds.push(w.id);
    }
  }
  for (const wk of plan.weeks) {
    wk.workoutIds.sort((a, b) => plan.workouts[a].dayIndex - plan.workouts[b].dayIndex);
  }
}

export function setStatus(plan: Plan, id: string, status: Workout["status"], note?: string): Plan {
  const p = clonePlan(plan);
  const w = p.workouts[id];
  if (!w) return p;
  p.workouts[id] = {
    ...w,
    status,
    note: note ?? (status === "planned" ? undefined : w.note),
    // Putting a session back overrides the absorption that took it away (#215).
    // Leaving the mark on would keep the card reading "Covered" while the session
    // is live again, and would keep it out of the miss count if it were then
    // genuinely skipped — a session that quietly never counts against you.
    absorbedBy: status === "planned" ? undefined : w.absorbedBy,
    // The snapshot only means anything while `absorbedBy` points at something, so
    // the two are cleared together — a stale one would let a later delete restore
    // a session to a shape it hasn't had since.
    absorbedFrom: status === "planned" ? undefined : w.absorbedFrom,
  };
  return p;
}

export function logInstead(
  plan: Plan,
  id: string,
  note: string,
  opts?: { discipline?: Discipline; durationSec?: number },
): Plan {
  const p = clonePlan(plan);
  const w = p.workouts[id];
  if (!w) return p;
  p.workouts[id] = {
    ...w,
    status: "swapped",
    note,
    // record what they actually did so Progress attributes it to the right sport
    loggedDiscipline: opts?.discipline ?? w.discipline,
    loggedDurationSec: opts?.durationSec ?? w.estDurationSec,
  };
  return p;
}

/** Discipline that a completed/logged workout should be credited to. */


/** Record a post-session check-in (effort / feel / actual time & distance) and mark it complete. */
export function logCheckin(
  plan: Plan,
  id: string,
  entry: {
    rpe?: number;
    feel?: Workout["feel"];
    actualDurationSec?: number;
    actualDistanceM?: number;
    strengthLog?: Workout["strengthLog"];
  },
): Plan {
  const p = clonePlan(plan);
  const w = p.workouts[id];
  if (!w) return p;
  p.workouts[id] = {
    ...w,
    // completing a swapped ("did something else") session keeps that status; otherwise it's done
    status: w.status === "swapped" ? "swapped" : "done",
    // A key present in `entry` (even with an undefined value) is an explicit set,
    // so clearing a field in the check-in sheet actually removes it; an absent key
    // leaves the stored value untouched. (`?? w.x` used to make cleared fields sticky.)
    rpe: "rpe" in entry ? entry.rpe : w.rpe,
    feel: "feel" in entry ? entry.feel : w.feel,
    actualDurationSec: "actualDurationSec" in entry ? entry.actualDurationSec : w.actualDurationSec,
    actualDistanceM: "actualDistanceM" in entry ? entry.actualDistanceM : w.actualDistanceM,
    // An emptied log clears the field rather than storing `[]`, so "did they log
    // anything?" stays a single truthiness check everywhere downstream (#199).
    strengthLog: "strengthLog" in entry ? (entry.strengthLog?.length ? entry.strengthLog : undefined) : w.strengthLog,
  };
  return p;
}

// ---- log a workout (manual "here's what I actually did") --------------------
// The athlete says what they did; we compare it to the planned session that day
// and either tick it off (equivalent), credit the actual (adjusted), swap the
// credit to the sport they actually did, or log a bonus session when nothing was
// planned. A first-person `coachPrefill` lets them tell the AI coach in one tap.

export interface LoggedWorkout {
  dateISO: string;
  discipline: Discipline; // swim | bike | run | strength
  durationSec: number;
  distanceM?: number;
  rpe?: number;
  feel?: Feel;
  note?: string;
  /** Sets/reps/weight for a gym session (#199) — an unplanned lift deserves the
   *  same record as a planned one, or the log only works when the plan predicted it. */
  strengthLog?: StrengthEntry[];
}

export type LogOutcome = "ticked" | "adjusted" | "swapped" | "bonus";

export interface LogResult {
  plan: Plan;
  outcome: LogOutcome;
  matchedId?: string;
  /** The session this log produced, planned or not. The caller routes this id
   *  through `respondTo` so an unplanned session can be absorbed into the week
   *  (#215) — without it, "Bonus session logged" was the end of the story and the
   *  ride you'd already done still sat on Wednesday. */
  loggedId?: string;
  headline: string;
  detail: string;
  /** a first-person note the athlete can send straight to the coach chat */
  coachPrefill: string;
}

/** Would a logged `discipline` count as doing this planned workout? (a brick is
 *  satisfied by either its ride or its run). */
function disciplineMatches(logged: Discipline, planned: Discipline): boolean {
  if (planned === logged) return true;
  if (planned === "brick" && (logged === "bike" || logged === "run")) return true;
  return false;
}

/** Is what the athlete did close enough to the planned session to just tick it off?
 *  Duration within −30%/+40%, and (when both are known) distance within ±~25%. */
function isEquivalent(logged: LoggedWorkout, planned: Workout): boolean {
  const pd = planned.estDurationSec || 0;
  if (pd > 0) {
    const r = logged.durationSec / pd;
    if (r < 0.7 || r > 1.4) return false;
  }
  if (logged.distanceM && planned.estDistanceM) {
    const dr = logged.distanceM / planned.estDistanceM;
    if (dr < 0.75 || dr > 1.3) return false;
  }
  return true;
}

function feelClause(l: LoggedWorkout): string {
  const bits: string[] = [];
  if (l.feel) bits.push(`felt ${l.feel}`);
  if (typeof l.rpe === "number") bits.push(`RPE ${l.rpe}/10`);
  return bits.length ? `, ${bits.join(", ")}` : "";
}

function distClause(l: LoggedWorkout): string {
  return l.distanceM ? ` · ${(l.distanceM / 1000).toFixed(l.discipline === "swim" ? 2 : 1)} km` : "";
}

/** The zone a logged session represents, read off the effort the athlete reported.
 *
 *  Undefined when they didn't say. That distinction matters to `bestMatch`: no RPE is
 *  absence of evidence, not evidence of easy, and treating a silent log as Z2 would
 *  make it "match" the easiest session on the day every time. Storage still needs a
 *  number, and defaults to Z2 at its own call site. */
function loggedZone(l: LoggedWorkout): Zone | undefined {
  if (typeof l.rpe !== "number") return undefined;
  return l.rpe >= 7 ? 4 : l.rpe >= 5 ? 3 : 2;
}

/**
 * Of the same-sport sessions planned that day, which one did they actually do?
 *
 * A day can hold two of a sport — the engine emits same-day doubles, and the ids carry
 * a `-seq` for exactly that. Taking the FIRST match (what this was) meant map order
 * decided: log the 60-minute intervals on a Tuesday holding an easy 30 min run and the
 * EASY run got ticked, credited with the interval session's numbers, while the quality
 * session stayed on the books still owed. The athlete then has to skip the work they
 * just did to clear it.
 *
 * Intensity leads, then duration — the same order and the same reason as the sort in
 * absorb.ts: ranking on length alone spends a hard session's credit on an easy one and
 * leaves the athlete doing their intervals twice. With no RPE to go on it falls back to
 * duration, which is the only honest signal left. Ties break on id so the answer never
 * depends on map order again.
 */
function bestMatch(logged: LoggedWorkout, candidates: Workout[]): Workout | undefined {
  if (candidates.length <= 1) return candidates[0];
  const zone = loggedZone(logged);
  return [...candidates].sort((a, b) => {
    if (zone != null) {
      const za = Math.abs(a.primaryZone - zone);
      const zb = Math.abs(b.primaryZone - zone);
      if (za !== zb) return za - zb;
    }
    const da = Math.abs((a.estDurationSec || 0) - logged.durationSec);
    const db = Math.abs((b.estDurationSec || 0) - logged.durationSec);
    return da === db ? a.id.localeCompare(b.id) : da - db;
  })[0];
}

/** Add a self-logged session as a completed workout (used when nothing was planned). */
function addLoggedWorkoutWithId(plan: Plan, input: LoggedWorkout): { plan: Plan; id: string } {
  const p = clonePlan(plan);
  const zone: Zone = loggedZone(input) ?? 2;
  const base = `logged-${input.dateISO}-${input.discipline}`;
  let id = base;
  let n = 1;
  while (p.workouts[id]) id = `${base}-${++n}`;
  p.workouts[id] = {
    id,
    date: input.dateISO,
    weekIndex: 0, // fixed by reindexWeeks
    dayIndex: dayIndexOf(input.dateISO),
    discipline: input.discipline,
    type: input.discipline === "strength" ? "strength" : "endurance",
    // Say what it WAS. "Logged strength" tells the athlete nothing they didn't
    // already know; "Push · strength" is the session they actually did, and it's what
    // makes the note worth asking for in the first place (#121).
    title: input.note ? `${input.note} · ${input.discipline}` : `Logged ${input.discipline}`,
    purpose: "A session you logged yourself.",
    segments: [
      { kind: "main", discipline: input.discipline, zone, durationSec: input.durationSec, description: "Logged session" },
    ],
    estDurationSec: input.durationSec,
    estDistanceM: input.distanceM,
    primaryZone: zone,
    status: "done",
    rpe: input.rpe,
    feel: input.feel,
    actualDurationSec: input.durationSec,
    actualDistanceM: input.distanceM,
    strengthLog: input.strengthLog?.length ? input.strengthLog : undefined,
    note: input.note,
  };
  reindexWeeks(p);
  return { plan: p, id };
}

/** The unplanned session an athlete logged, and the id it landed under — the id
 *  is what lets the responder absorb it into the week (#215). */
export function addLoggedWorkout(plan: Plan, input: LoggedWorkout): Plan {
  return addLoggedWorkoutWithId(plan, input).plan;
}

// ---- delete a session the athlete put there themselves ----------------------

/**
 * Is this session the athlete's to remove?
 *
 * Only work that exists BECAUSE they said so: a hand-logged session (`logged-`),
 * or one they asked the plan to add (#209, `addedByAthlete`). Everything the
 * engine designed is edited through skip / move / modify, which is a different
 * verb with different arithmetic — a prescribed session you delete would just be
 * silently missing from the week it was balancing.
 *
 * A device-synced session (`synced-`) is deliberately NOT deletable. It carries an
 * `activityId` the importer matches on, so removing it only lasts until the next
 * sync re-imports the same ride — a delete that undoes itself is worse than no
 * delete at all. That needs an ignore-list, which is its own piece of work.
 */
export function isAthleteLogged(w: Workout | undefined): boolean {
  return !!w && (!!w.addedByAthlete || w.id.startsWith("logged-"));
}

export interface Deletion {
  plan: Plan;
  /** the session that was removed, so the caller can name it */
  removed: Workout;
  /** sessions this one had taken off the week, now back on it */
  restored: Workout[];
  /** one sentence, athlete-facing — every change explains itself or it doesn't ship */
  headline: string;
}

/**
 * Remove a session the athlete logged, and give back whatever logging it took.
 *
 * The second half is the whole point. Logging an unplanned ride absorbs or
 * shortens a matching session later in the week (#215) — so a ride logged by
 * mistake doesn't merely sit in the log inflating fitness, it has already
 * deleted or trimmed real work. Removing the log without putting that back
 * would leave the week permanently lighter for a session that never happened,
 * which is the same bug as #215 with the sign flipped.
 *
 * Returns null when there is nothing honest to do, so no caller can report a
 * no-op as a change (the #108 dead-button lesson).
 */
export function deleteLoggedWorkout(plan: Plan, id: string): Deletion | null {
  const removed = plan.workouts[id];
  if (!isAthleteLogged(removed)) return null;

  const p = clonePlan(plan);
  delete p.workouts[id];

  const restored: Workout[] = [];
  for (const t of Object.values(p.workouts)) {
    if (t.absorbedBy !== id) continue;
    const snap = t.absorbedFrom;
    // Field by field, never a spread: the plan round-trips through JSON, which
    // drops undefined keys — a spread would silently keep the "Covered by…" note
    // on a session that is live again (see `snapshot` in absorb.ts).
    const back: Workout = snap
      ? {
          ...t,
          status: snap.status,
          note: snap.note,
          segments: snap.segments,
          estDurationSec: snap.estDurationSec,
          estDistanceM: snap.estDistanceM,
          primaryZone: snap.primaryZone,
          absorbedBy: undefined,
          absorbedFrom: undefined,
        }
      : // Absorbed by a build that predates the snapshot. Status is the half that
        // matters and the half we can recover exactly — a session marked "skipped"
        // by a log that no longer exists would otherwise never be trainable again.
        // A merely-shortened one keeps its length; guessing it back from
        // `prescribed` would undo any ease or re-pace that happened around it.
        { ...t, status: t.status === "skipped" ? "planned" : t.status, note: undefined, absorbedBy: undefined, absorbedFrom: undefined };
    p.workouts[t.id] = back;
    restored.push(back);
  }

  reindexWeeks(p);

  const what = removed!.discipline;
  return {
    plan: p,
    removed: removed!,
    restored,
    headline: restored.length
      ? `Removed that ${what} — and put ${restored.length === 1 ? `“${restored[0].title}”` : `${restored.length} sessions`} back on your week.`
      : `Removed that ${what} from your log.`,
  };
}

export function logWorkout(plan: Plan, input: LoggedWorkout): LogResult {
  const durTxt = fmtDuration(input.durationSec);
  const distTxt = distClause(input);
  const d = input.discipline;

  // planned, not-yet-done sessions on that day
  const sameDay = Object.values(plan.workouts).filter(
    (w) => w.date === input.dateISO && w.discipline !== "rest" && w.status === "planned",
  );
  // SAME SPORT ONLY.
  //
  // This used to fall back to the closest-duration session of ANY sport and swap
  // the credit into it, so logging a bike on a day that held a run silently turned
  // the run into a bike — and whether that happened at all depended on whether you
  // ticked the run first. Same two sessions, two different plans, decided by order.
  //
  // Ryan: "if I did a run today extra, I should have one less run for the week."
  // That rule doesn't care whether the extra work was instead of something or on
  // top of it, and it needs no question: the work counts as itself, and the WEEK
  // gives up a session of the same sport (see absorbUnplanned). A ride never
  // rewrites a run, in either direction.
  //
  // The explicit paths are untouched — "Swap sport" on a session, and "Did
  // something else", both of which say plainly what they are doing.
  const match = bestMatch(input, sameDay.filter((w) => disciplineMatches(d, w.discipline)));

  if (!match) {
    const added = addLoggedWorkoutWithId(plan, input);
    return {
      plan: added.plan,
      loggedId: added.id,
      outcome: "bonus",
      headline: "Logged ✓",
      // The week's answer arrives in its own message from the responder (a matching
      // session absorbed or shortened), so this says what was RECORDED and doesn't
      // claim the plan is unchanged. "Nothing was planned" was also just wrong when
      // something was planned and it simply wasn't this sport.
      detail: `Added your ${d} (${durTxt}${distTxt}) to the log.`,
      coachPrefill: `I did an unplanned ${d} today: ${durTxt}${distTxt}${feelClause(input)}. Nothing was on the plan — does that change the next few days?`,
    };
  }

  if (disciplineMatches(d, match.discipline)) {
    const done = logCheckin(plan, match.id, {
      rpe: input.rpe,
      feel: input.feel,
      actualDurationSec: input.durationSec,
      actualDistanceM: input.distanceM,
      ...(input.strengthLog ? { strengthLog: input.strengthLog } : {}),
    });
    if (isEquivalent(input, match)) {
      return {
        plan: done,
        outcome: "ticked",
        matchedId: match.id,
        headline: "Ticked off ✓",
        detail: `Matched your planned “${match.title}” — marked complete.`,
        coachPrefill: `I completed today's ${d} as planned: ${durTxt}${distTxt}${feelClause(input)}. Anything to note for tomorrow?`,
      };
    }
    return {
      plan: done,
      outcome: "adjusted",
      matchedId: match.id,
      headline: "Logged — credited what you did",
      detail: `Your ${d} (${durTxt}${distTxt}) differed from the planned ${fmtDuration(match.estDurationSec)} — credited the actual.`,
      coachPrefill: `Today's ${d} came out as ${durTxt}${distTxt}${feelClause(input)}, vs the planned ${fmtDuration(match.estDurationSec)}. Should I adjust the coming days?`,
    };
  }

  // did a different sport than planned → swap the credit to what they actually did
  //
  // CURRENTLY UNREACHABLE, and deliberately so. `match` is drawn only from sessions
  // `disciplineMatches` already accepted, so the check above always passes — a log of a
  // sport the day didn't hold becomes a bonus instead (the same-sport-only rule, #215:
  // "a ride never rewrites a run, in either direction"). Kept because "swapped" is still
  // a declared outcome and the explicit paths — "Swap sport" and "Did something else" —
  // may want to route through here; asserted as bonus in test/logmatch.test.ts so nobody
  // reads this as live behaviour. If it ever is live: the athlete's own note ADDS to the
  // explanation rather than replacing it, or the session would read "hilly trail loop"
  // with nothing saying a swap happened at all.
  const swapNote = `Did ${d} instead of ${match.discipline}`;
  let swapped = logInstead(plan, match.id, input.note ? `${swapNote} — ${input.note}` : swapNote, {
    discipline: d,
    durationSec: input.durationSec,
  });
  swapped = logCheckin(swapped, match.id, {
    rpe: input.rpe,
    feel: input.feel,
    actualDurationSec: input.durationSec,
    actualDistanceM: input.distanceM,
    ...(input.strengthLog ? { strengthLog: input.strengthLog } : {}),
  });
  return {
    plan: swapped,
    outcome: "swapped",
    matchedId: match.id,
    headline: "Swapped ✓",
    detail: `Did a ${d} in place of your planned ${match.discipline} — credited to ${d}.`,
    coachPrefill: `Instead of my planned ${match.discipline} today, I did a ${d}: ${durTxt}${distTxt}${feelClause(input)}. Is that okay, or should I make up the ${match.discipline}?`,
  };
}

/** Move a workout to a new date (kept inside the plan window). Returns null if invalid. */
export function moveWorkout(plan: Plan, id: string, newDateISO: string): Plan {
  const p = clonePlan(plan);
  const w = p.workouts[id];
  if (!w) return p;
  const start = fromISO(p.startDateISO).getTime();
  const end = fromISO(addDays(p.weeks[p.weeks.length - 1].startDate, 6)).getTime();
  const t = fromISO(newDateISO).getTime();
  if (t < start || t > end) return p; // out of range → ignore
  p.workouts[id] = { ...w, date: newDateISO, movedFrom: w.movedFrom ?? w.date, status: "moved" };
  reindexWeeks(p);
  // moved workouts should present as still-to-do
  p.workouts[id] = { ...p.workouts[id], status: "planned", movedFrom: w.movedFrom ?? w.date };
  return p;
}

function replacementDraft(ctx: BuildCtx, discipline: Discipline, minutes: number): Draft {
  const m = Math.max(20, Math.round(minutes));
  switch (discipline) {
    case "swim": {
      // Size the swim by DURATION, using the athlete's own pace.
      //
      // This used to be `m * 60 * 1.3` — metres from seconds at 1.3 m/s, which is
      // 1:17/100m. No age-grouper holds that for an endurance swim, so the
      // replacement came out far longer than the session it replaced: tapping
      // "swap → swim" on a 133 min long ride produced a 214 min, 11,000 m swim.
      // Longer than the ride, and about seven times an Ironman swim leg.
      //
      // The swim's total is warm-up + main + cool-down, and `swimEndurance` builds
      // ~600 m of that scaffolding around the main set, so the main set is the
      // requested time minus the scaffolding, converted at real CSS pace.
      const per100 = ctx.paces.swim.cssSecPer100 || 120;
      const scaffoldM = 600;
      const mainM = Math.round(((m * 60) / per100) * 100) - scaffoldM;
      return W.swimEndurance(ctx, Math.max(800, Math.round(mainM / 100) * 100));
    }
    case "bike":
      return W.bikeEndurance(ctx, m);
    case "run":
      return W.runEasy(ctx, m);
    case "strength":
      return W.strength(ctx, Math.min(40, m));
    default:
      return W.runEasy(ctx, m);
  }
}

/** Swap a session for an easy session of a different discipline (keeps the day & id, so it's undoable).
 *
 *  The swapped session is sized to what the week can absorb on the MECHANICAL
 *  axis, not just handed the outgoing session's duration. Rebuilding at the same
 *  length is how a single tap used to add 75% to an athlete's weekly run volume:
 *  a 90-minute ride becomes a 90-minute run, the metabolic ledger doesn't move
 *  because the two cost the same sRPE, and nothing notices (doc 02 §4 #13).
 *  The swap itself is never refused — everything stays switchable, and it's the
 *  duration that gets fitted (doc 03 §4 F: never ramp the substitute sport
 *  faster than you'd ramp it fresh). */
export function swapDiscipline(plan: Plan, id: string, discipline: Discipline): Plan {
  const p = clonePlan(plan);
  const w = p.workouts[id];
  if (!w) return p;
  const ctx: BuildCtx = { paces: p.paces, level: p.profile.level };
  const requestedSec = w.estDurationSec || 2400;
  const allowance = swapAllowance(p, w, discipline, requestedSec);
  const draft = replacementDraft(ctx, discipline, Math.max(20 * 60, allowance.maxSec) / 60);
  // preserve the pre-swap session (or the earliest one, if already swapped) so it can be restored
  const original = w.swappedFrom ?? {
    discipline: w.discipline,
    type: w.type,
    title: w.title,
    purpose: w.purpose,
    segments: w.segments,
    estDurationSec: w.estDurationSec,
    estDistanceM: w.estDistanceM,
    primaryZone: w.primaryZone,
    // COMPLETION EVIDENCE BELONGS TO THE SESSION THAT EARNED IT (#220).
    //
    // A swap changes what the session IS. Every record of how the OLD one went —
    // device actuals, the actual time and distance, the RPE and feel — describes a
    // session that no longer exists, and the spread below used to carry all of it
    // onto the new sport. Ryan opened a run reading "HOW IT WENT 47 min · 7 km" and
    // "Completed": every one of those numbers came from a RIDE he had done, and the
    // ledger was crediting them as RUN minutes, which also feeds the mechanical
    // impact model that decides how much running the week can take.
    //
    // Snapshotted rather than deleted, so `unswapDiscipline` can hand it back and an
    // undo never costs the athlete a completion.
    ...(w.status !== "planned" || w.actuals || w.actualDurationSec != null || w.rpe != null || w.strengthLog
      ? {
          completed: {
            status: w.status,
            ...(w.actuals ? { actuals: w.actuals } : {}),
            ...(w.actualDurationSec != null ? { actualDurationSec: w.actualDurationSec } : {}),
            ...(w.actualDistanceM != null ? { actualDistanceM: w.actualDistanceM } : {}),
            ...(w.rpe != null ? { rpe: w.rpe } : {}),
            ...(w.feel ? { feel: w.feel } : {}),
            ...(w.strengthLog ? { strengthLog: w.strengthLog } : {}),
          },
        }
      : {}),
  };
  p.workouts[id] = {
    ...w,
    discipline: draft.discipline,
    type: draft.type,
    title: draft.title,
    purpose: draft.purpose,
    segments: draft.segments,
    estDurationSec: draft.estDurationSec,
    estDistanceM: draft.estDistanceM,
    primaryZone: draft.primaryZone,
    status: "planned",
    // ...and the old session's completion goes with it. Listed explicitly because the
    // spread above copies every field: leaving these behind is what put a ride's 47
    // minutes and 7 km on a run, under a "Completed" tick (#220). They are safe in
    // `swappedFrom.completed` and come back on undo.
    actuals: undefined,
    actualDurationSec: undefined,
    actualDistanceM: undefined,
    rpe: undefined,
    feel: undefined,
    strengthLog: undefined,
    // The swap IS the new prescription for this slot, so the old one has to go.
    // `prescribed` is the baseline every later resize measures against, and it
    // still described the sport that just left: `scaleWorkout` derives distance
    // as `baseline.estDistanceM × ratio`, so a ride resized then swapped to a run
    // came back from the next ease as a 36 km "run" in 74 min — 29.5 km/h (#201,
    // where Ryan got 15 km in 35 min). Clearing it makes the swapped-in session
    // its own baseline, which is what it should have been from the first pass.
    prescribed: undefined,
    pacedAt: undefined,
    note: allowance.capped ? `Swapped from ${original.discipline} · kept short` : `Swapped from ${original.discipline}`,
    swappedFrom: original,
    impactCapped: allowance.capped ? allowance.reason ?? undefined : undefined,
  };
  return p; // same id / date / week — no reindex needed
}

/** Undo a swap, restoring the original session. */
export function unswapDiscipline(plan: Plan, id: string): Plan {
  const p = clonePlan(plan);
  const w = p.workouts[id];
  if (!w || !w.swappedFrom) return p;
  const o = w.swappedFrom;
  p.workouts[id] = {
    ...w,
    discipline: o.discipline,
    type: o.type,
    title: o.title,
    purpose: o.purpose,
    segments: o.segments,
    estDurationSec: o.estDurationSec,
    estDistanceM: o.estDistanceM,
    primaryZone: o.primaryZone,
    // Undo restores the session AND how it went. Without this, completing a ride,
    // swapping it to a run and changing your mind quietly erased the completion —
    // the swap took the evidence away and nothing gave it back (#220).
    status: o.completed?.status ?? "planned",
    actuals: o.completed?.actuals,
    actualDurationSec: o.completed?.actualDurationSec,
    actualDistanceM: o.completed?.actualDistanceM,
    rpe: o.completed?.rpe,
    feel: o.completed?.feel,
    strengthLog: o.completed?.strengthLog,
    // Same reasoning as the swap: the restored session is its own baseline, and
    // keeping a baseline minted for the sport being removed is how the two
    // disagree (#201).
    prescribed: undefined,
    pacedAt: undefined,
    note: undefined,
    swappedFrom: undefined,
  };
  return p;
}

/**
 * Rebuild the remaining plan from today (the "realign / rebuild" action for
 * when you've fallen behind). Past workouts + their statuses are preserved;
 * future weeks are regenerated to still land on race day.
 */
/**
 * How much of the arc this athlete has already climbed, in weeks.
 *
 * A rebuild regenerates the plan from today, and `generatePlan` only ever saw the runway
 * REMAINING — so it laid base first and handed someone ten weeks into their block a fresh
 * base week one. Realigning, saving a setting or receiving an engine upgrade would wipe
 * every quality session for a fortnight. Ryan, ten weeks in: "i dont see any high intensity
 * workouts now its the same plan just aerobic and endurance runs/bikes."
 *
 * Elapsed time alone would be the wrong credit: an athlete who missed most of the block has
 * not banked that base, and dropping them into build would be exactly the ramp doc 03 §4
 * tells us not to build. So elapsed weeks are discounted by what they actually did. Do it
 * all, keep your place; do nothing, start again; do half, move half.
 */
export function weeksBanked(plan: Plan, todayISO: string): number {
  // The block's true start is the EARLIEST session on record, not `weeks[0].startDate` —
  // a rebuild rewrites the week grid to begin today, so reading the grid would report zero
  // elapsed weeks and restart base all over again on the next rebuild. The kept- history
  // holds its original dates, so it remembers when the athlete actually began.
  const cutoff = fromISO(todayISO).getTime();
  let earliest = Infinity;
  let done = 0;
  let total = 0;
  for (const w of Object.values(plan.workouts)) {
    const t = fromISO(w.date).getTime();
    if (t < earliest) earliest = t;
    if (t >= cutoff) continue;
    if (w.discipline === "rest") continue;
    total++;
    if (w.status === "done" || w.status === "swapped") done++;
  }
  if (!Number.isFinite(earliest)) return 0;
  const elapsed = weeksBetween(mondayOf(new Date(earliest).toISOString().slice(0, 10)), mondayOf(todayISO));
  if (elapsed <= 0) return 0;
  // no history to judge (a plan rebuilt the same week it started) → credit the calendar
  const adherence = total > 0 ? done / total : 1;
  return Math.round(elapsed * Math.min(1, adherence));
}

/** Did the ATHLETE shorten this session? `prescribed` holds what the engine asked
 *  for, so a current length below it that no ease explains is their own edit. */
function isAthleteResized(w: Workout): boolean {
  const base = w.prescribed?.estDurationSec;
  return !!base && base > 0 && Math.abs(w.estDurationSec - base) > 60;
}

export function rebuildFromToday(plan: Plan, todayISO: string): Plan {
  const fresh = generatePlan(plan.profile, undefined, { weeksBanked: weeksBanked(plan, todayISO) });
  const cutoff = fromISO(todayISO).getTime();

  // keep old workouts strictly before today (with their statuses). Their ids
  // (w-<week>-<day>-<disc>) reuse the same week indices the fresh plan will emit,
  // so we namespace them with a "kept-" prefix — otherwise a fresh future session
  // with the same relative index/day/discipline overwrites a completed past one,
  // silently wiping training history (banked hours, streaks, PRs) on every rebuild.
  // Also preserve a session ALREADY COMPLETED today — otherwise editing settings /
  // rebuilding on the same day resets it to "planned", losing the completion (and
  // the streak) despite the "completed sessions were kept" promise. We record its
  // date+discipline so the fresh plan doesn't drop a duplicate on the same slot.
  const kept: Record<string, Workout> = {};
  const keptTodayDone = new Set<string>();
  for (const w of Object.values(plan.workouts)) {
    const t = fromISO(w.date).getTime();
    const isPast = t < cutoff;
    const isTodayDone = t === cutoff && (w.status === "done" || w.status === "swapped");
    if (isPast || isTodayDone) {
      const id = `kept-${w.id}`;
      kept[id] = { ...w, id };
      if (isTodayDone) keptTodayDone.add(`${w.date}·${w.discipline}`);
    }
  }
  // A SKIP ON A FUTURE DAY IS A DECISION, AND A REBUILD MUST NOT FORGET IT.
  //
  // Everything from today onward is regenerated, so a session the athlete had
  // already skipped came back as "planned" — and with the automatic realign firing
  // at 3 missed sessions, it came back over and over. Ryan: "It's not remembering
  // that I'm skipping sessions."
  //
  // Matched on date+discipline rather than id: a rebuild re-anchors the week
  // indices, so `w-3-1-bike` becomes `w-0-1-bike` and ids cannot be compared
  // across it (that re-anchoring is exactly why kept history is namespaced). A
  // multiset, not a Set — skipping one of Saturday's two rides must not silently
  // skip both.
  const futureSkips = new Map<string, number>();
  for (const w of Object.values(plan.workouts)) {
    if (w.status !== "skipped" || fromISO(w.date).getTime() < cutoff) continue;
    const k = `${w.date}·${w.discipline}`;
    futureSkips.set(k, (futureSkips.get(k) ?? 0) + 1);
  }

  // add fresh workouts from today onward, minus any today slot already completed
  for (const w of Object.values(fresh.workouts)) {
    const t = fromISO(w.date).getTime();
    if (t < cutoff) continue;
    if (t === cutoff && keptTodayDone.has(`${w.date}·${w.discipline}`)) continue;
    const k = `${w.date}·${w.discipline}`;
    const owed = futureSkips.get(k) ?? 0;
    if (owed > 0) {
      futureSkips.set(k, owed - 1);
      kept[w.id] = { ...w, status: "skipped" };
      continue;
    }
    kept[w.id] = w;
  }
  // ---- carry the athlete's other decisions about the future ----------------
  //
  // Everything from today onward is regenerated, so ANY decision an athlete made
  // about a future session was silently reverted. Measured (scripts audit,
  // 2026-08-12): of six decisions, only a skip survived — moved, swapped, added,
  // resized and eased were all lost, and rebuilds fire automatically at three
  // missed sessions.
  //
  // Two are fixed here because they have one honest answer:
  //
  //  • A SESSION YOU ADDED (#209) is not the engine's to delete. It never appears
  //    in `fresh` (the engine didn't write it), so it is carried verbatim.
  //  • AN EASED SESSION STAYS EASED. `easeUpcoming` softens the next days after a
  //    rough check-in or a session that cost far more than it should have. Letting
  //    a realign re-harden them is the one direction that is a safety regression,
  //    not just an annoyance — doc 02 §4 #11.
  //  • A SESSION YOU RESIZED keeps the length you chose, for the same reason a
  //    skip keeps its status: you said so.
  //
  // Moved and swapped are deliberately NOT carried — a rebuild re-lays the whole
  // calendar, so "this session belongs on Thursday instead" may have no equivalent
  // in the new week, and guessing one silently is worse than re-planning it.
  for (const w of Object.values(plan.workouts)) {
    if (fromISO(w.date).getTime() < cutoff) continue;
    if (w.addedByAthlete && !kept[w.id]) {
      kept[w.id] = w; // yours, not the engine's — see above
      continue;
    }
    if (!w.easedCause && !isAthleteResized(w)) continue;
    // Same matching rule as the skip carry: date+discipline, because a rebuild
    // re-anchors week indices and ids cannot be compared across it.
    const target = Object.values(kept).find(
      (f) => !f.id.startsWith("kept-") && f.date === w.date && f.discipline === w.discipline && f.status === "planned",
    );
    if (!target) continue;
    kept[target.id] = {
      ...target,
      estDurationSec: w.estDurationSec,
      ...(w.estDistanceM != null ? { estDistanceM: w.estDistanceM } : {}),
      segments: w.segments,
      ...(w.primaryZone != null ? { primaryZone: w.primaryZone } : {}),
      ...(w.easedCause ? { easedCause: w.easedCause } : {}),
      ...(w.prescribed ? { prescribed: w.prescribed } : {}),
    };
  }

  const merged: Plan = {
    ...fresh,
    workouts: kept,
    id: plan.id,
    // readiness + adaptation records are history — carry them across a rebuild
    // (weeks/easedWeeks regenerate, so the why-line gates on both)
    readiness: plan.readiness,
    adaptations: plan.adaptations,
    // Everything still "planned" before today is now absorbed history. Stamping the
    // date is what lets `missedSince` stop counting it — without this an automatic
    // realign would see the same misses forever and never converge.
    realignedAtISO: todayISO,
    // A rebuild IS the current engine's output — `generatePlan` just wrote it — so it
    // carries the current stamp. Without this the field was silently dropped, because
    // `fresh` has no `engineVersion` and the spread above wins.
    //
    // That one omission is why the migration never landed. Measured on production:
    // `plan_upgraded` had fired 15 times, `shouldUpgradePlan` returned true for 16 of
    // 19 plans, and exactly 2 plans carried the stamp. The upgrade ran, stamped the
    // plan, and then the very next automatic realign — which fires at 3 missed
    // sessions, and had fired 25 times — rebuilt the plan and dropped the stamp again.
    // Every launch re-upgraded, every realign un-upgraded, and athletes stayed on the
    // engine that built them forever. Ryan's own plan: engineVersion undefined, 63.6%
    // adherence, 8% Z4+ against a 10% floor.
    //
    // A refusal is carried too: an athlete who declined this version must not be asked
    // again just because their week got realigned.
    engineVersion: ENGINE_VERSION,
    ...(plan.upgradeDeclinedVersion != null ? { upgradeDeclinedVersion: plan.upgradeDeclinedVersion } : {}),
    notice: "Plan rebuilt around today — you're realigned to hit race day.",
  };
  reindexWeeks(merged);
  return merged;
}

/**
 * The sessions the athlete has genuinely fallen behind on: still `planned`, already
 * in the past, and not already absorbed by an earlier realign.
 *
 * Two floors matter, and both are load-bearing:
 *  • `createdAtISO` — a plan built on a Thursday back-dates to Monday, so the days
 *    before it existed were never the athlete's to miss. (A plan minutes old used to
 *    open with "You've missed 8 sessions.")
 *  • `realignedAtISO` — after a realign, the old misses survive as `kept-` history and
 *    stay `planned` forever. Counting them again is what made automatic realignment
 *    unsafe: it would re-trigger on every render and never settle.
 */
export function missedSince(plan: Plan, todayISO: string): Workout[] {
  const created = plan.profile.createdAtISO?.slice(0, 10);
  // whichever floor is later — the plan's birth, or the last time we realigned it
  const floor = [created, plan.realignedAtISO].filter(Boolean).sort().pop();
  return Object.values(plan.workouts).filter(
    (w) =>
      w.discipline !== "rest" &&
      w.status === "planned" &&
      w.date < todayISO &&
      (!floor || w.date >= floor),
  );
}

/** Never restructure a plan inside this many days of race day. */
export const UPGRADE_RACE_GUARD_DAYS = 21;

/**
 * Should this plan be rebuilt onto the current engine?
 *
 * Plans are STORED, not recomputed, so an athlete who onboarded before an engine change
 * trains off the old one forever. Waiting for them to happen to edit a setting is not a
 * migration strategy — it is how an improvement reaches new users only.
 *
 * Lives here, not in the component that calls it, because "is it safe to rewrite this
 * athlete's training right now?" is a domain question with real consequences, and one
 * embedded in a `useEffect` is one no test can reach.
 *
 * The guards are the whole reason this isn't a one-line version check:
 *  • Not in the taper or race week. Restructuring the last weeks before an A-race is the
 *    single case where a better plan is a worse outcome — they have arranged their life
 *    around those sessions and surprises cost the most there.
 *  • Not within three weeks of race day, whatever phase the calendar claims: a compressed
 *    plan can still read "build" a fortnight out, so the DATE decides, not the label.
 *  • Not for a race already run. `generatePlan` on a past race date returns a ZERO-week,
 *    zero-workout plan, so upgrading there would DELETE the athlete's plan rather than
 *    improve it. They lose nothing by waiting — the block is over.
 * All of these defer the upgrade rather than cancelling it.
 */
export function shouldUpgradePlan(plan: Plan, todayISO: string, engineVersion: number): boolean {
  if ((plan.engineVersion ?? 1) >= engineVersion) return false;
  // they already said no to this one — see `upgradeDeclinedVersion`
  if (plan.upgradeDeclinedVersion === engineVersion) return false;
  const wk = plan.weeks.find((w) => todayISO >= w.startDate && todayISO < addDays(w.startDate, 7));
  if (wk?.phase === "taper" || wk?.isRaceWeek) return false;
  if (plan.raceDateISO && plan.raceDateISO <= addDays(todayISO, UPGRADE_RACE_GUARD_DAYS)) return false;
  return true;
}

/** Which trigger eased a session — the why must distinguish "missed because life"
 *  from "felt too hard" from a low morning check-in (doc 02 §4 #11). */
export type EaseCause = "readiness" | "missed" | "strain" | "form" | "manual";

/** Ease the next N days: downgrade hard sessions to endurance, trim long ones. */
export function easeUpcoming(plan: Plan, fromISODate: string, days: number, cause: EaseCause = "manual"): Plan {
  const p = clonePlan(plan);
  const ctx: BuildCtx = { paces: p.paces, level: p.profile.level };
  const start = fromISO(fromISODate).getTime();
  const end = start + days * 86400000;
  for (const [id, w] of Object.entries(p.workouts)) {
    const t = fromISO(w.date).getTime();
    if (t < start || t > end) continue;
    if (w.status !== "planned") continue;
    const hard = ["threshold", "vo2", "tempo", "brick"].includes(w.type);
    if (hard) {
      // A BRICK IS EASED, NOT DISSOLVED.
      //
      // `replacementDraft` for a brick asked for a *bike*, so easing turned "Brick — Find
      // Your Run Legs" into an "Easy Aerobic Endurance Ride" and the run off the bike —
      // the single most race-specific thing in the week — simply vanished. Doc 01 §4 #8
      // makes bricks mandatory in build and peak; they are not an intensity garnish that
      // can be traded for recovery. Observed on device: one hard check-in removed the
      // week's brick entirely.
      //
      // Easing it means dropping the race-pace block and the duration, and KEEPING the
      // ride-then-run shape. Same protection, without deleting the stimulus.
      if (w.type === "brick") {
        const mins = Math.max(30, Math.round(((w.estDurationSec || 3600) / 60) * 0.8));
        const runOff = Math.max(10, Math.round(mins * 0.2));
        const draft = W.brick(ctx, mins - runOff, runOff, false);
        p.workouts[id] = {
          ...w,
          type: draft.type,
          title: draft.title,
          purpose: "Shorter and all-aerobic, so you still get the legs-off-the-bike practice while you recover.",
          segments: draft.segments,
          estDurationSec: draft.estDurationSec,
          estDistanceM: draft.estDistanceM,
          primaryZone: draft.primaryZone,
          note: "Eased off",
          easedCause: cause,
          easedFrom: w.easedFrom ?? { type: w.type, primaryZone: w.primaryZone },
        };
        continue;
      }
      const draft = replacementDraft(ctx, w.discipline, (w.estDurationSec || 2400) / 60 * 0.8);
      p.workouts[id] = {
        ...w,
        type: draft.type,
        title: `Easy ${draft.title}`,
        purpose: "Dialed back so you can recover and come back stronger.",
        segments: draft.segments,
        estDurationSec: draft.estDurationSec,
        estDistanceM: draft.estDistanceM,
        primaryZone: draft.primaryZone,
        note: "Eased off",
        // keep the trigger + what the session WAS — the overwrite would otherwise
        // destroy the only honest answer to "why is today easy?"
        easedCause: cause,
        easedFrom: w.easedFrom ?? { type: w.type, primaryZone: w.primaryZone },
      };
    }
  }
  return p;
}

// ---- closed-loop adaptation --------------------------------------------
// The plan reacts to how the last two weeks actually went. Two directions:
//   • ease  — missed a lot, or sessions felt consistently hard → soften the
//             upcoming week (the protective move; this is the whole injury-safe
//             promise). Applied on the athlete's tap.
//   • ahead — nailed nearly everything and it felt easy → a positive nudge. We
//             deliberately DON'T pile on more load (that's how people get hurt);
//             the deterministic plan already progresses. It's encouragement only.

const isDoneW = (w: Workout) => w.status === "done" || w.status === "swapped";
const zoneRpeMid = (z: Zone) => (ZONES[z].rpe[0] + ZONES[z].rpe[1]) / 2;
const FEEL_STRAIN = { rough: 2, ok: 0, great: -1.5 } as const;

/** Above this, a single session felt materially harder than it was prescribed to —
 *  enough to offer an ease on the spot rather than waiting for a two-week trend. */
export const STRAIN_OFFER_EASE = 1.5;

/** How hard a completed session felt vs. what its zone prescribed (RPE units). */
export function sessionStrain(w: Workout): number | null {
  const parts: number[] = [];
  if (typeof w.rpe === "number") parts.push(w.rpe - zoneRpeMid(w.primaryZone));
  if (w.feel) parts.push(FEEL_STRAIN[w.feel]);
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export interface AdaptationSuggestion {
  kind: "ease" | "ahead";
  weekIndex: number; // the upcoming week the suggestion is about
  weekLabel: string;
  reason: string;
  /** which trigger fired — "missed because life" and "felt too hard" want
   *  different coaching, so the why-line must not collapse them (doc 02 §4 #11) */
  cause: "missed" | "strain" | "form";
  missed: number;
  scheduled: number;
  avgStrain: number | null;
  signals: number; // completed sessions with feedback considered
}

/** Look at the trailing two weeks and decide whether the upcoming week should be
 *  eased (or celebrate that the athlete's ahead). Pure. Returns null when the
 *  plan is on track or there isn't enough signal yet. */
export function assessAdaptation(plan: Plan, todayISO: string): AdaptationSuggestion | null {
  // the week containing today, and the next one (what we'd adjust)
  const cur = plan.weeks.find((w) => todayISO >= w.startDate && todayISO < addDays(w.startDate, 7));
  if (!cur) return null;
  const next = plan.weeks.find((w) => w.index === cur.index + 1);
  if (!next || next.isRaceWeek) return null; // never touch race week

  // Look back two weeks, but never before the plan existed — otherwise a brand-new plan's
  // pre-start days (it begins on mondayOf(today)) read as a wall of missed sessions and
  // trip the ease trigger on day one. createdAtISO is stable across rebuilds.
  const created = plan.profile.createdAtISO?.slice(0, 10);
  const window = addDays(todayISO, -14);
  const from = created && created > window ? created : window;
  const past = Object.values(plan.workouts).filter(
    (w) => w.discipline !== "rest" && w.date >= from && w.date < todayISO,
  );
  const scheduled = past.length;
  // A session that gave way to work the athlete had ALREADY done is not a miss
  // (#215). It carries `status: "skipped"` because nothing more will happen to it,
  // but the athlete did the training — counting it here would let riding MORE than
  // the plan asked push the miss rate over the 40% ease trigger and soften the
  // block as a reward for training harder. See lib/absorb.ts.
  const missed = past.filter((w) => !w.absorbedBy && (w.status === "skipped" || w.status === "planned")).length;
  const strains = past.map(sessionStrain).filter((s): s is number => s != null);
  const avgStrain = strains.length ? strains.reduce((a, b) => a + b, 0) / strains.length : null;
  const missRate = scheduled ? missed / scheduled : 0;

  const easeable = next.phase === "base" || next.phase === "build" || next.phase === "peak";
  const alreadyEased = (plan.easedWeeks ?? []).includes(next.index);
  // Plain "Week N" for anything the athlete reads (#114). Derived, not the stored
  // week.label, so plans built before the change read correctly too.
  const nextLabel = next.isRaceWeek ? "race week" : `Week ${next.index + 1}`;

  // Cumulative fatigue debt: how far the athlete's real form has drifted BELOW what
  // this block was designed to cost them. Being "deep in it" is not a trigger — that's
  // what a build is — so this compares against the plan's own prescription rather than
  // against an absolute band. A compliant athlete measures exactly 0%.
  const deviation = formDeviation(plan, todayISO);
  const formDebt = deviation != null && deviation.deltaPct <= FORM_DEBT_EASE_PCT;

  // EASE: fell behind, the work is consistently overreaching, or fatigue has compounded
  // further than the design intended.
  if (
    easeable &&
    !alreadyEased &&
    (missRate >= 0.4 || (strains.length >= 3 && avgStrain != null && avgStrain >= 1.5) || formDebt)
  ) {
    const cause = missRate >= 0.4 ? "missed" : strains.length >= 3 && avgStrain != null && avgStrain >= 1.5 ? "strain" : "form";
    const reason =
      cause === "missed"
        ? `You've missed ${missed} of ${scheduled} sessions in the last two weeks.`
        : cause === "strain"
        ? `Your recent sessions have felt consistently hard.`
        : `Your fatigue has run deeper than this block was designed to put you.`;
    return { kind: "ease", weekIndex: next.index, weekLabel: nextLabel, reason, cause, missed, scheduled, avgStrain, signals: strains.length };
  }

  // AHEAD: nailing it and feeling comfortable — encouragement, no extra load.
  if (easeable && missRate <= 0.1 && strains.length >= 3 && avgStrain != null && avgStrain <= -1.0) {
    return {
      kind: "ahead",
      weekIndex: next.index,
      weekLabel: nextLabel,
      reason: "You've hit nearly everything and it's feeling comfortable.",
      cause: "strain",
      missed,
      scheduled,
      avgStrain,
      signals: strains.length,
    };
  }
  return null;
}

/** Apply an adaptation. Easing softens the target week and records it so we don't
 *  re-suggest; "ahead" changes nothing structural (by design) beyond marking it. */
export function applyAdaptation(plan: Plan, s: AdaptationSuggestion): Plan {
  if (s.kind !== "ease") return plan;
  const wk = plan.weeks.find((w) => w.index === s.weekIndex);
  if (!wk) return plan;
  // soften every hard session across that week (Mon–Sun)
  const eased = easeUpcoming(plan, wk.startDate, 6, s.cause);
  const targetWeek = eased.weeks.find((w) => w.index === s.weekIndex);
  if (targetWeek) targetWeek.targetHours = Math.round(targetWeek.targetHours * 0.9 * 2) / 2;
  eased.easedWeeks = [...(plan.easedWeeks ?? []), s.weekIndex];
  // keep the trigger + its numbers: after applying, the suggestion is gone and
  // this record is the only honest answer to "why was this week softened?"
  eased.adaptations = [
    ...(plan.adaptations ?? []).filter((a) => a.weekIndex !== s.weekIndex),
    { weekIndex: s.weekIndex, cause: s.cause, reason: s.reason, missed: s.missed, scheduled: s.scheduled },
  ];
  eased.notice = `We eased ${wk.label} so you absorb the training and stay healthy.`;
  return eased;
}

// ---- week / plan progress helpers (for the UI) ----

export function weekProgress(plan: Plan, wk: Week): { done: number; total: number; plannedSec: number; doneSec: number } {
  let done = 0;
  let plannedSec = 0;
  let doneSec = 0;
  const total = wk.workoutIds.filter((id) => plan.workouts[id]?.discipline !== "rest").length;
  for (const id of wk.workoutIds) {
    const w = plan.workouts[id];
    if (!w) continue;
    plannedSec += w.estDurationSec || 0;
    if (w.status === "done" || w.status === "swapped") {
      done++;
      doneSec += creditedSeconds(w);
    }
  }
  return { done, total, plannedSec, doneSec };
}

export interface ComplianceColor {
  status: Workout["status"];
  color: string;
  label: string;
}

export function complianceOf(w: Workout): ComplianceColor {
  // A session that gave way to unplanned work the athlete already did (#215) shares
  // its status with a skip and shares nothing else with one. Showing it in the
  // danger colour under the word "Skipped" would tell someone who trained MORE than
  // the plan asked that they failed — so it reads as covered, in the swapped
  // colour, which is what actually happened to it.
  if (w.absorbedBy) return { status: w.status, color: "var(--z3)", label: "Covered" };
  switch (w.status) {
    case "done":
      return { status: w.status, color: "var(--success)", label: "Completed" };
    case "swapped":
      return { status: w.status, color: "var(--z3)", label: "Swapped" };
    case "skipped":
      return { status: w.status, color: "var(--danger)", label: "Skipped" };
    case "moved":
      return { status: w.status, color: "var(--z2)", label: "Moved" };
    default:
      return { status: w.status, color: "var(--muted)", label: "Planned" };
  }
}

const DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function raceLabel(plan: Plan): string {
  const p = plan.profile;
  return p.raceType === "custom"
    ? p.custom?.name || "custom race"
    : p.raceType === "olympic"
    ? "Olympic-distance triathlon"
    : p.raceType === "half"
    ? "Ironman 70.3"
    : p.raceType === "fitness"
    ? "general fitness"
    : "full Ironman";
}

/** The goal line for AI context — a race + date, or "just getting fitter". */
function goalLine(plan: Plan): string {
  const p = plan.profile;
  return isFitnessGoal(p)
    ? `Goal: general fitness — no target race. Level: ${p.level}.`
    : `Race: ${raceLabel(plan)} on ${plan.raceDateISO}. Level: ${p.level}.`;
}

/** Build the context string the AI coach is given.
 *
 *  `includeHealth` defaults to FALSE and that is the whole point. This function used to
 *  put the athlete's injuries — area, severity, affected disciplines — into every coach
 *  request unconditionally. That is a second health-data → third-party path alongside
 *  /api/intake, and unlike that one it had no consent gate and no disclosure anywhere.
 *  Health context is now opt-in per athlete, on the same consent as the injury analyser
 *  (ticket #63); without it the coach still works, it just doesn't get told what hurts. */
export function summarizeForCoach(
  plan: Plan,
  todayISO: string,
  opts?: { includeHealth?: boolean },
): string {
  const p = plan.profile;
  // Calendar comparison, not fixed-ms: after spring-forward a 7*86400000ms window overshoots
  // the next local Monday midnight by an hour and mis-buckets that Monday (same DST hazard
  // reindexWeeks was fixed against). Match assessAdaptation's safe string form.
  const wk = plan.weeks.find((week) => todayISO >= week.startDate && todayISO < addDays(week.startDate, 7));
  const today = Object.values(plan.workouts).filter((w) => w.date === todayISO);
  const lines: string[] = [];
  lines.push(goalLine(plan));
  if (wk) lines.push(`Current week: ${wk.label} (${wk.phase} phase), target ${wk.targetHours}h. Focus: ${wk.focus}`);
  if (opts?.includeHealth && p.injuries?.length) {
    lines.push(
      `Working around: ${p.injuries.map((i) => `${i.area} (${i.severity}, ${i.disciplines.join("/")})`).join("; ")}.`,
    );
  }
  if (p.strength?.enabled) {
    const split =
      p.strength.split === "custom" ? `their own (${p.strength.customSplit?.trim() || "athlete-defined"})` : `${p.strength.split} split`;
    lines.push(`Strength: ${p.strength.daysPerWeek}×/week, ${split}.`);
  }
  if (today.length) {
    lines.push(
      `Today's sessions: ${today
        .map((w) => `${coachSafeTitle(w)} (${w.discipline}, ${fmtDuration(w.estDurationSec)})`)
        .join("; ")}`,
    );
  } else {
    lines.push("Today is a rest day.");
  }
  return lines.join("\n");
}

/** A compact description of the athlete + finished plan for the "why this plan" note. */
export function planSummaryContext(plan: Plan): string {
  const p = plan.profile;
  const lines: string[] = [];
  lines.push(goalLine(plan));
  lines.push(
    `Plan length: ${plan.totalWeeks} weeks${
      isFitnessGoal(p) ? " (rolling fitness block)" : plan.compressed ? " (compressed — race is soon)" : plan.delayedStart ? " (starts later — race is far out)" : ""
    }.`,
  );
  const byPhase: Record<string, number> = {};
  for (const w of plan.weeks) byPhase[w.phase] = (byPhase[w.phase] ?? 0) + 1;
  lines.push(
    `Phase weeks — base ${byPhase.base ?? 0}, build ${byPhase.build ?? 0}, peak ${byPhase.peak ?? 0}, taper ${byPhase.taper ?? 0}.`,
  );
  const peak = plan.weeks.reduce((m, w) => Math.max(m, w.targetHours), 0);
  lines.push(`Peak training week ~${peak}h.`);
  if (p.perSport) lines.push(`Weekly sessions: swim ${p.perSport.swim}, bike ${p.perSport.bike}, run ${p.perSport.run}.`);
  else lines.push(`About ${p.workoutsPerWeek} sessions a week.`);
  if (p.focusDiscipline) lines.push(`Prioritising their ${p.focusDiscipline}.`);
  if (p.strength?.enabled) {
    const split =
      p.strength.split === "custom" ? `their own (${p.strength.customSplit?.trim() || "athlete-defined"})` : `${p.strength.split} split`;
    lines.push(`Strength: ${p.strength.daysPerWeek}×/week, ${split}.`);
  }
  else lines.push("No strength training.");
  if (p.restDayPreference != null) lines.push(`Preferred rest day: ${DOW[p.restDayPreference]}.`);
  if (p.longSessionDay != null) lines.push(`Long-session day: ${DOW[p.longSessionDay]}.`);
  if (p.weeklyHoursCap) lines.push(`Weekly hours capped at ${p.weeklyHoursCap}.`);
  if (p.equipment) {
    const lack: string[] = [];
    if (p.equipment.pool === false) lack.push("no pool (swim is dry-land only)");
    if (p.equipment.gym === false) lack.push("no gym (strength is bodyweight at home)");
    if (p.equipment.trainer === false) lack.push("no indoor trainer");
    if (lack.length) lines.push(`Equipment limits: ${lack.join("; ")}.`);
  }
  if (p.injuries?.length) {
    lines.push(
      `Injuries to work around: ${p.injuries
        .map((i) => `${i.area} (${i.severity}, affects ${i.disciplines.join("/")})`)
        .join("; ")}.`,
    );
  }
  if (p.blackouts?.length) {
    lines.push(
      `Days off: ${p.blackouts.map((b) => `${b.startISO}→${b.endISO}${b.label ? ` (${b.label})` : ""}`).join("; ")}.`,
    );
  }
  if (p.intakeNotes) lines.push(`Athlete's own note: ${p.intakeNotes}`);
  return lines.join("\n");
}
