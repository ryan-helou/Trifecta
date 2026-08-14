import type { Plan, Workout } from "./types";
import { isDetached, reindexWeeks } from "./adapt";
import { isSyncedId } from "./strava";

// ---------------------------------------------------------------------------
// Folding the server's copy of the plan into ours.
//
// Two callers, one rule. The 409-conflict retry and the boot restore have always
// merged; the Strava auto-sync did NOT — it replaced the local plan with whatever
// the server returned, wholesale. That was survivable while syncing was a button
// you pressed. It stopped being survivable when it started running every two
// minutes (1.0.62), because now any local edit made between debounced saves is
// destroyed by the next tick, and the athlete has no way to tell.
//
// The bug Ryan hit: un-tick a completed session, and within two minutes the sync
// hands back the server's copy — which still says done, because the save is still
// in the debounce queue — and the undo is gone. Then `newlyDone` sees a completion
// that isn't new, and the plan re-adapts around it. Every two minutes.
//
// So: the SERVER is authoritative about what the athlete DID (it talks to Strava);
// the DEVICE is authoritative about everything else, including the decision that a
// given activity did not complete anything.
// ---------------------------------------------------------------------------

/** Only ever adopted from the server. Anything outside this set is the device's. */
function withServerCompletion(local: Workout, server: Workout): Workout {
  return {
    ...local,
    status: server.status,
    actuals: server.actuals ?? local.actuals,
    actualDurationSec: server.actualDurationSec ?? local.actualDurationSec,
    actualDistanceM: server.actualDistanceM ?? local.actualDistanceM,
  };
}

/**
 * Fold the server's completions into `local`, returning `local` itself (same
 * reference) when there is nothing to take — callers use that to skip a re-render
 * and, in the sync's case, to skip a save.
 *
 * Adopts exactly three things:
 *   • a planned session the server marked done (+ the actuals that came with it)
 *   • a bonus session the sync created for an unplanned activity
 *   • a rename/refresh of the actuals on a synced session we already hold
 *
 * Never adopts anything whose activity the athlete has detached.
 */
export function mergeCompletions(local: Plan | null, server: Plan | null | undefined): Plan | null {
  if (!local || !server) return local;
  let changed = false;
  const workouts = { ...local.workouts };
  let added = false;

  for (const [id, sw] of Object.entries(server.workouts ?? {})) {
    // THE UNDO WINS. The server has not necessarily heard about it yet — the save
    // may still be in the debounce queue — so this is checked against the LOCAL
    // plan, which is the only copy that knows.
    if (isDetached(local, sw.actuals?.activityId)) continue;

    const lw = workouts[id];

    if (!lw) {
      // A session that exists only on the server. Adopted only when the sync made
      // it: any other id missing locally is one this device removed on purpose,
      // and re-adding it would undo a deletion.
      if (isSyncedId(id) && sw.status === "done") {
        workouts[id] = sw;
        changed = true;
        added = true;
      }
      continue;
    }

    if (lw.status === "planned" && sw.status === "done") {
      workouts[id] = withServerCompletion(lw, sw);
      changed = true;
      continue;
    }

    // Already done on both sides: let a rename or a corrected distance through, but
    // only for sessions the sync owns, and only when something actually differs.
    if (isSyncedId(id) && sw.status === "done" && lw.status === "done") {
      const refreshed = withServerCompletion(lw, sw);
      const retitled = sw.title && sw.title !== lw.title ? { ...refreshed, title: sw.title } : refreshed;
      if (JSON.stringify(retitled) !== JSON.stringify(lw)) {
        workouts[id] = retitled;
        changed = true;
      }
    }
  }

  // union the date-keyed readiness log + eased weeks; local wins a same-key clash
  const readiness = { ...(server.readiness ?? {}), ...(local.readiness ?? {}) };
  if (Object.keys(readiness).length !== Object.keys(local.readiness ?? {}).length) changed = true;
  const easedWeeks = [...new Set([...(local.easedWeeks ?? []), ...(server.easedWeeks ?? [])])].sort((a, b) => a - b);
  if (easedWeeks.length !== (local.easedWeeks ?? []).length) changed = true;

  if (!changed) return local;

  const merged: Plan = { ...local, workouts };
  if (Object.keys(readiness).length) merged.readiness = readiness;
  if (easedWeeks.length) merged.easedWeeks = easedWeeks;
  // A new session isn't rendered until its week lists it — the Plan tab reads
  // week.workoutIds, not the workouts map — so an added bonus needs the reindex.
  if (added) {
    merged.weeks = merged.weeks.map((w) => ({ ...w, workoutIds: [...w.workoutIds] }));
    reindexWeeks(merged);
  }
  return merged;
}
