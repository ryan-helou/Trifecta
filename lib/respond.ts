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

import { absorbUnplanned } from "./absorb";
import { represcribe } from "./prescribe";
import { respondToEdit } from "./replan";
import type { Plan, Workout } from "./types";

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

/** A session that stresses bone and tendon hard.
 *
 *  This was a COPY of the engine's rule, under a comment promising it was "kept identical
 *  … so the two can't drift into disagreeing about what hard means". It drifted the moment
 *  the engine's rule changed — sweet-spot and tempo work became exempt from 48-hour spacing
 *  (they are prescribed precisely because they are repeatable day to day) and this copy
 *  went on flagging them, so the app warned about clashes the engine had deliberately
 *  allowed. A comment cannot keep two definitions in sync; an import can. */
export { isHardLoading as isHardImpact } from "./planEngine";
import { isHardLoading as isHardImpact } from "./planEngine";

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

  // Work the plan never asked for is answered FIRST, and answered locally: the
  // ride you already did comes off the ride you have left (#215). It runs ahead of
  // the ledger because it changes which sessions are still standing, and the
  // ledger's job is to resize what remains — in that order they compose, in the
  // other they argue about a session one of them has already withdrawn.
  const absorbed = absorbUnplanned(plan, todayISO, event.workoutId);
  const afterAbsorb = absorbed?.plan ?? plan;

  // Every event refreshes the prescription from the ledger. Skips included: a
  // skipped session is zero load, which leaves the athlete FRESHER than budget,
  // and the never-add rule then correctly declines to hand them extra work.
  // Doc 02 §4 #11 — a life-miss is not a reason to soften anything.
  // The session the athlete just acted on is excluded: they set it deliberately,
  // and the responder's job is to adjust the sessions AROUND that choice.
  const re = represcribe(afterAbsorb, todayISO, undefined, event.workoutId);

  // ...and separately, respond to the EDIT itself. The ledger above only sees
  // completed work, so a change to a session you haven't done yet is invisible
  // to it — measured: 35.72% deviation before a swap and 35.72% after. That gap
  // is what made swapping a run for a bike move nothing but the day, and it is
  // what respondToEdit closes (Ryan, 2026-08-10).
  //
  // Run on the plan the ledger already adjusted, so the two compose instead of
  // fighting: whichever has something to say, says it, and both can.
  const afterLedger = re?.plan ?? afterAbsorb;
  // A skip REPORTS; it never reassigns. See respondToEdit's `reassign` doc.
  const edit = respondToEdit(afterLedger, todayISO, event.workoutId, {
    reassign: event.kind !== "skipped",
  });

  // An edit response that changed NOTHING is a note, not an action — "that drops
  // your only hard session and there's nowhere to move it". It must not be
  // presented as though the plan did something, and it must not displace a real
  // ledger change: reporting "no good day left to move it" as the headline while
  // the plan separately lengthened an unrelated session reads as one incoherent
  // sentence about two different things. Notes become warnings; actions lead.
  if (edit && !edit.changedIds.length) warnings.push(edit.headline);
  const editActed = !!edit && edit.changedIds.length > 0;

  if (!absorbed && !re && !editActed) {
    if (!warnings.length) return null;
    return { plan, horizon: "none", headline: warnings[0], changedIds: [], warnings };
  }

  if (!re && !editActed) {
    return {
      plan: afterAbsorb,
      horizon: "sessions",
      headline: absorbed!.headline,
      changedIds: [absorbed!.id],
      warnings,
    };
  }

  if (!re && editActed) {
    return {
      plan: edit!.plan,
      horizon: "sessions",
      headline: absorbed ? `${absorbed.headline} ${edit!.headline}` : edit!.headline,
      changedIds: absorbed ? [absorbed.id, ...edit!.changedIds] : edit!.changedIds,
      warnings,
    };
  }

  const finalPlan = editActed ? edit!.plan : re!.plan;
  const changedIds = Object.keys(finalPlan.workouts).filter(
    (id) =>
      finalPlan.workouts[id].estDurationSec !== plan.workouts[id]?.estDurationSec ||
      finalPlan.workouts[id].primaryZone !== plan.workouts[id]?.primaryZone ||
      // A session that gave way to unplanned work changes STATUS without changing
      // its numbers, so a duration/zone diff alone reports it as untouched and the
      // UI never highlights the one session that actually moved (#215).
      finalPlan.workouts[id].status !== plan.workouts[id]?.status,
  );

  return {
    plan: finalPlan,
    horizon: "sessions",
    // Absorption leads: it is the most concrete answer to what the athlete just
    // did, and it is the one they are looking for after logging something the plan
    // didn't ask for. Otherwise the edit leads, being more immediate than the ledger.
    headline: absorbed ? absorbed.headline : editActed ? edit!.headline : re!.reason,
    changedIds,
    warnings,
  };
}
