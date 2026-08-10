// ---------------------------------------------------------------------------
// One entry point: an athlete does something → the plan answers.
//
// The size of the answer scales with the strength of the evidence, which is the
// whole reason this is a module and not an `if` in the UI:
//
//   one event      → the next 1-3 sessions          (here)
//   a week's shape → the coming week's targets      (assessAdaptation, offered)
//   a trend        → the remaining block            (rebuildFromToday / realign)
//
// That ladder is not a hedge against responsiveness — it IS what a coach does.
// Nobody rewrites a 16-week block because you rode twenty minutes long once;
// they change tomorrow. Doc 02 §4 #10 requires the debounce, and doc 02 §4 #11
// requires that "missed because life" and "felt too hard" get different answers,
// which is why the events below are distinct rather than collapsed into one.
//
// The important structural point: EVERY event refreshes the prescription from
// the ledger. It doesn't matter whether the athlete logged an hour instead of
// forty minutes, ran fifteen kilometres instead of ten, or found a Z2 ride far
// harder than it should have been — all three land in the ledger as load, and
// `represcribe` reads the ledger. There is no per-case special pleading, which
// is why new ways of recording work don't need new adaptation code.
//
// Pure — no clock, no I/O. The caller supplies today.
// ---------------------------------------------------------------------------

import { represcribe } from "./prescribe";
import { respondToEdit } from "./replan";
import type { Discipline, Plan, Workout } from "./types";

/** What the athlete just did. Distinct cases because the correct answers differ,
 *  not because the code paths do. */
export type AthleteEvent =
  /** completed, however it went — longer, shorter, further, harder, easier */
  | { kind: "logged"; workoutId: string }
  /** deliberately not doing it. A decision, not a failure to show up. */
  | { kind: "skipped"; workoutId: string }
  /** traded for another sport */
  | { kind: "swapped"; workoutId: string }
  /** same session, different day */
  | { kind: "moved"; workoutId: string }
  /** did something the plan never asked for */
  | { kind: "logged-other"; workoutId: string };

export type ResponseHorizon = "none" | "sessions";

export interface PlanResponse {
  plan: Plan;
  horizon: ResponseHorizon;
  /** one sentence, athlete-facing — every change explains itself or it doesn't ship */
  headline: string;
  changedIds: string[];
  /** things worth saying that aren't plan changes (e.g. two hard days now adjacent) */
  warnings: string[];
}

const LOADS_MSK = (d: Discipline) => d === "run" || d === "bike" || d === "brick";

/** A session that stresses bone and tendon hard — the engine's own definition,
 *  kept identical to the one the spacing invariant tests against so the two can't
 *  drift into disagreeing about what "hard" means. */
export function isHardImpact(w: Workout): boolean {
  return LOADS_MSK(w.discipline) && (w.primaryZone >= 4 || w.type === "brick");
}

const DAY_MS = 86400000;
const at = (iso: string) => Date.parse(iso + "T00:00:00Z");

/** Pairs of hard-impact sessions now sitting closer than 48h apart.
 *
 *  Moving a session is the one action that can manufacture this: the engine
 *  spaces hard days deliberately, and dragging a threshold run onto the day
 *  before a brick undoes that quietly. Reported rather than auto-corrected — the
 *  athlete moved it on purpose, and silently moving it back would be the app
 *  arguing with them. Say it; let them decide. */
export function hardDayConflicts(plan: Plan, fromISO?: string): { a: Workout; b: Workout }[] {
  const hard = Object.values(plan.workouts)
    .filter((w) => w.status === "planned" && isHardImpact(w) && (!fromISO || w.date >= fromISO))
    .sort((x, y) => x.date.localeCompare(y.date));
  const out: { a: Workout; b: Workout }[] = [];
  for (let i = 1; i < hard.length; i++) {
    const gap = at(hard[i].date) - at(hard[i - 1].date);
    if (gap < 2 * DAY_MS) out.push({ a: hard[i - 1], b: hard[i] });
  }
  return out;
}

/** The plan's answer to one thing the athlete did.
 *
 *  Returns null when the honest answer is "nothing" — which is most of the time,
 *  and deliberately so. A plan that visibly reshuffles on every tap reads as
 *  chaotic rather than responsive, and an app that announces a change it didn't
 *  make is the dead-button bug (#108) wearing a different hat. */
export function respondTo(plan: Plan, todayISO: string, event: AthleteEvent): PlanResponse | null {
  const warnings: string[] = [];

  // Moving a session can put two hard days back to back. Check before anything
  // else, because it's worth saying even when the ledger has nothing to add.
  if (event.kind === "moved") {
    for (const { a, b } of hardDayConflicts(plan, todayISO)) {
      if (a.id === event.workoutId || b.id === event.workoutId) {
        warnings.push(
          `That puts ${a.title} and ${b.title} within a day of each other — hard sessions want 48h between them.`,
        );
      }
    }
  }

  // Every event refreshes the prescription from the ledger. Skips included: a
  // skipped session is zero load, which leaves the athlete FRESHER than budget,
  // and the never-add rule then correctly declines to hand them extra work.
  // Doc 02 §4 #11 — a life-miss is not a reason to soften anything.
  // The session the athlete just acted on is excluded: they set it deliberately,
  // and the responder's job is to adjust the sessions AROUND that choice.
  const re = represcribe(plan, todayISO, undefined, event.workoutId);

  // ...and separately, respond to the EDIT itself. The ledger above only sees
  // completed work, so a change to a session you haven't done yet is invisible
  // to it — measured: 35.72% deviation before a swap and 35.72% after. That gap
  // is what made swapping a run for a bike move nothing but the day, and it is
  // what respondToEdit closes (Ryan, 2026-08-10).
  //
  // Run on the plan the ledger already adjusted, so the two compose instead of
  // fighting: whichever has something to say, says it, and both can.
  const afterLedger = re?.plan ?? plan;
  const edit = respondToEdit(afterLedger, todayISO, event.workoutId);

  // An edit response that changed NOTHING is a note, not an action — "that drops
  // your only hard session and there's nowhere to move it". It must not be
  // presented as though the plan did something, and it must not displace a real
  // ledger change: reporting "no good day left to move it" as the headline while
  // the plan separately lengthened an unrelated session reads as one incoherent
  // sentence about two different things. Notes become warnings; actions lead.
  if (edit && !edit.changedIds.length) warnings.push(edit.headline);
  const editActed = !!edit && edit.changedIds.length > 0;

  if (!re && !editActed) {
    if (!warnings.length) return null;
    return { plan, horizon: "none", headline: warnings[0], changedIds: [], warnings };
  }

  if (!re && editActed) {
    return {
      plan: edit!.plan,
      horizon: "sessions",
      headline: edit!.headline,
      changedIds: edit!.changedIds,
      warnings,
    };
  }

  const finalPlan = editActed ? edit!.plan : re!.plan;
  const changedIds = Object.keys(finalPlan.workouts).filter(
    (id) =>
      finalPlan.workouts[id].estDurationSec !== plan.workouts[id]?.estDurationSec ||
      finalPlan.workouts[id].primaryZone !== plan.workouts[id]?.primaryZone,
  );

  return {
    plan: finalPlan,
    horizon: "sessions",
    // The edit is the more immediate thing the athlete just did, so it leads when
    // both have something to say.
    headline: editActed ? edit!.headline : re!.reason,
    changedIds,
    warnings,
  };
}
