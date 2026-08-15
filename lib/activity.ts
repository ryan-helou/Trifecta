import type { Discipline, Plan, Workout, WorkoutActuals, Zone } from "./types";
import { setStatus, reindexWeeks } from "./adapt";
import { dayIndexOf } from "./dates";

// ---------------------------------------------------------------------------
// Source-agnostic activity layer.
//
// A completed workout normalized from ANY source (Strava, Apple Health, …) so the
// matcher + apply logic is shared. Apple Health reads happen on-device and match
// here client-side, so raw health data never has to leave the phone — only the
// resulting workout completion syncs (through the normal state save). The Strava
// server path has its own (equivalent) matcher in lib/strava.ts.
// ---------------------------------------------------------------------------

export interface Activity {
  source: WorkoutActuals["source"];
  id: number | string; // stable id for idempotency (Strava id, or HealthKit UUID)
  discipline: Discipline | null;
  localDay: string; // YYYY-MM-DD in the athlete's local time (for day-matching)
  startISO: string;
  durationSec: number;
  distanceM?: number;
  avgHr?: number;
  maxHr?: number;
  avgWatts?: number;
  name?: string;
}

export interface Match {
  workoutId: string;
  confidence: "high" | "medium";
}

/** The planned workout this activity most likely completes: same local day, matching
 *  discipline (a brick also accepts a run/bike), still un-done. Closest planned
 *  duration wins ties. Pure. */
export function matchActivity(plan: Plan, a: Activity): Match | null {
  if (!a.discipline || !plan.workouts) return null;
  const candidates = Object.values(plan.workouts).filter((w) => {
    if (w.date !== a.localDay || w.status !== "planned") return false;
    if (w.discipline === a.discipline) return true;
    if (w.discipline === "brick" && (a.discipline === "run" || a.discipline === "bike")) return true;
    return false;
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { workoutId: candidates[0].id, confidence: "high" };
  const actual = a.durationSec;
  candidates.sort((x, y) => Math.abs(x.estDurationSec - actual) - Math.abs(y.estDurationSec - actual));
  return { workoutId: candidates[0].id, confidence: "medium" };
}

/** Two reports of one activity start within this of each other. Wide enough to absorb
 *  the clock skew between a watch and a phone, far narrower than the gap between a
 *  genuine morning and evening session. */
export const SAME_ACTIVITY_WINDOW_MS = 15 * 60 * 1000;

/**
 * Has the athlete told us this activity completes nothing — WHATEVER feed it arrives on?
 *
 * `isDetached` answers that by id, which only covers the feed that reported it. Strava
 * and Apple Health describe one run under two different ids, so un-completing a
 * Strava-synced session left the Health copy free to walk back in and re-complete it:
 * the undo worked, and then quietly didn't. Ryan: "every time i undo completed and come
 * back to the app it shows completed."
 *
 * So the id is checked first, then the fingerprint recorded alongside it — same day,
 * same sport, started within the window `duplicateActivity` already uses for "these two
 * reports are one session". One definition of sameness, used twice.
 */
export function isDetachedActivity(
  plan: Plan,
  x: {
    id?: number | string;
    source: WorkoutActuals["source"];
    discipline: Discipline;
    localDay: string;
    startISO?: string;
    durationSec?: number;
  },
): boolean {
  if (x.id != null && (plan.detachedActivityIds ?? []).includes(x.id)) return true;
  const startX = x.startISO ? Date.parse(x.startISO) : NaN;
  return (plan.detachedActivities ?? []).some((d) => {
    if (d.id === x.id) return true;
    if (d.localDay !== x.localDay) return false;
    const discOk =
      d.discipline === x.discipline ||
      (d.discipline === "brick" && (x.discipline === "run" || x.discipline === "bike"));
    if (!discOk) return false;

    // Deliberately the SAME test `duplicateActivity` uses below, so "these two reports
    // are one physical session" has one definition rather than two that drift apart.
    const startD = d.startISO ? Date.parse(d.startISO) : NaN;
    const haveBothStarts = !Number.isNaN(startX) && !Number.isNaN(startD);
    if (d.source === x.source) return haveBothStarts && Math.abs(startX - startD) <= SAME_ACTIVITY_WINDOW_MS;
    if (haveBothStarts) return Math.abs(startX - startD) <= SAME_ACTIVITY_WINDOW_MS;
    const dd = d.durationSec ?? 0;
    const dx = x.durationSec ?? 0;
    return dd > 0 && dx > 0 && Math.abs(dd - dx) / Math.max(dd, dx) <= 0.2;
  });
}

/** True when a completed session already in the plan IS this same physical activity,
 *  whatever id it arrives under and whichever feed it came from.
 *
 *  Two ways one session shows up twice, and this catches both:
 *   - two feeds, one run. Strava and Apple Health report it with different ids, so the
 *     activityId carrier check can't see they're the same.
 *   - ONE feed, one run, a changed id. Re-delivery slips past the carrier check the
 *     same way. This case used to be waved through on the assumption that a same-source
 *     repeat is always a genuine double; #123 is the bill for that, an athlete's run
 *     banked four times as 20 km they never ran.
 *
 *  Either way the cost is a phantom bonus session and double-counted load, which now
 *  corrupts CTL/ATL/TSB *and* the prescription the plan derives from them.
 *
 *  Matches on same local day + discipline (brick-tolerant), then start time. Pure. */
export function duplicateActivity(
  plan: Plan,
  x: { source: WorkoutActuals["source"]; discipline: Discipline; localDay: string; startISO?: string; durationSec: number },
): boolean {
  const startX = x.startISO ? Date.parse(x.startISO) : NaN;
  return Object.values(plan.workouts).some((w) => {
    const ac = w.actuals;
    if (!ac) return false;
    if (w.date !== x.localDay) return false;
    const discOk =
      w.discipline === x.discipline || (w.discipline === "brick" && (x.discipline === "run" || x.discipline === "bike"));
    if (!discOk) return false;

    const startW = ac.startedAtISO ? Date.parse(ac.startedAtISO) : NaN;
    const haveBothStarts = !Number.isNaN(startX) && !Number.isNaN(startW);
    const sameSource = ac.source === x.source;

    // SAME source: this used to return false outright, on the reasoning that a repeat
    // from one feed is always a genuine double. It isn't — a feed can re-deliver one
    // activity under a changed id, which slips past the activityId carrier check too,
    // and #123 is what that costs: one run banked four times, 20 km the athlete never
    // ran. Start time is what separates the two cases. A re-delivery reports the same
    // start; an AM and a PM run are hours apart. So same-source dedup requires two real
    // start times close together, and never falls through to the duration heuristic
    // below — two 45-minute runs in one day are a hard week, not a bug.
    if (sameSource) return haveBothStarts && Math.abs(startX - startW) <= SAME_ACTIVITY_WINDOW_MS;

    // ACROSS sources (Strava + Apple Health reporting one run): unchanged. The duration
    // fallback is safe here because two feeds describing genuinely different sessions
    // with near-equal durations on one day is far rarer than one of them omitting a
    // start time.
    if (haveBothStarts) return Math.abs(startX - startW) <= SAME_ACTIVITY_WINDOW_MS;
    const dw = ac.durationSec ?? 0;
    return dw > 0 && Math.abs(dw - x.durationSec) / Math.max(dw, x.durationSec) <= 0.2;
  });
}

export function actualsFromActivity(a: Activity): WorkoutActuals {
  return {
    source: a.source,
    activityId: a.id,
    name: a.name,
    distanceM: a.distanceM != null ? Math.round(a.distanceM) : undefined,
    durationSec: a.durationSec,
    avgHr: a.avgHr != null ? Math.round(a.avgHr) : undefined,
    maxHr: a.maxHr != null ? Math.round(a.maxHr) : undefined,
    avgWatts: a.avgWatts != null ? Math.round(a.avgWatts) : undefined,
    startedAtISO: a.startISO,
  };
}

/** Create a new done-workout for an activity that didn't match any planned session
 *  (rest day, different discipline, etc.). Feeds CTL/ATL/TSB so load tracking stays
 *  complete even when the athlete trains off-plan. Pure — returns the mutated plan. */
function addBonusWorkout(plan: Plan, a: Activity): { plan: Plan; workoutId: string } {
  const disc = a.discipline!;
  const acts = actualsFromActivity(a);
  const zone: Zone = 2;
  const base = `synced-${a.localDay}-${disc}`;
  let id = base;
  let n = 1;
  const p = { ...plan, workouts: { ...plan.workouts }, weeks: plan.weeks.map((w) => ({ ...w, workoutIds: [...w.workoutIds] })) };
  while (p.workouts[id]) id = `${base}-${++n}`;
  const w: Workout = {
    id,
    date: a.localDay,
    weekIndex: 0,
    dayIndex: dayIndexOf(a.localDay),
    discipline: disc,
    type: disc === "strength" ? "strength" : "endurance",
    title: a.name || `${disc[0].toUpperCase()}${disc.slice(1)} (${a.source === "strava" ? "Strava" : "Watch"})`,
    purpose: "Synced from your connected device.",
    segments: [{ kind: "main", discipline: disc, zone, durationSec: a.durationSec, description: "Synced session" }],
    estDurationSec: a.durationSec,
    estDistanceM: a.distanceM,
    primaryZone: zone,
    status: "done",
    actualDurationSec: acts.durationSec,
    actualDistanceM: acts.distanceM,
    actuals: acts,
  };
  p.workouts[id] = w;
  reindexWeeks(p);
  return { plan: p, workoutId: id };
}

/** Pure: apply one activity to a plan — mark the matched session done + attach
 *  actuals (and the flat actual* fields the credit/stats/UI read). Unmatched
 *  activities (rest day, different sport, etc.) create a bonus session so training
 *  load is always complete. Returns the new plan + which workout, or null if it was
 *  already applied. Idempotent. Usable on the client (Apple Health) and the server
 *  (Strava). */
export function applyActivityToPlan(plan: Plan, a: Activity): { plan: Plan; workoutId: string } | null {
  if (!a.discipline) return null;

  // already applied anywhere in the plan → no-op
  const carrier = Object.values(plan.workouts).find((w) => w.actuals?.activityId === a.id);
  if (carrier) return null;

  // THE UNDO WINS, on this path too. The Strava sync has checked this since the undo
  // was made to stick; Apple Health never did, so the feed the athlete hadn't thought
  // about was quietly putting back the completion they had just removed.
  if (isDetachedActivity(plan, { id: a.id, source: a.source, discipline: a.discipline, localDay: a.localDay, startISO: a.startISO, durationSec: a.durationSec })) {
    return null;
  }

  const match = matchActivity(plan, a);
  const existing = match ? plan.workouts[match.workoutId] : undefined;
  if (!match || !existing) {
    // no planned session to complete → we'd create a bonus. First guard against the
    // same physical activity already landing again — another feed, or this one
    // re-delivering it under a new id (#123).
    if (duplicateActivity(plan, { source: a.source, discipline: a.discipline, localDay: a.localDay, startISO: a.startISO, durationSec: a.durationSec })) {
      return null;
    }
    return addBonusWorkout(plan, a);
  }

  const done = setStatus(plan, match.workoutId, "done");
  const acts = actualsFromActivity(a);
  const target = done.workouts[match.workoutId];
  return {
    workoutId: match.workoutId,
    plan: {
      ...done,
      workouts: {
        ...done.workouts,
        [match.workoutId]: {
          ...target,
          actuals: acts,
          actualDurationSec: acts.durationSec ?? target.actualDurationSec,
          actualDistanceM: acts.distanceM ?? target.actualDistanceM,
        },
      },
    },
  };
}

/** Heal a plan that already contains duplicate synced sessions.
 *
 *  The guard above stops new ones, but athletes hit by #123 are carrying the damage
 *  already — the one who reported it had four copies of a single run and a 20 km day
 *  they never ran. Their load ledger stays wrong until the phantoms are removed, and
 *  the plan now PRESCRIBES from that ledger, so this isn't cosmetic.
 *
 *  Deliberately timid, because deleting an athlete's training is not something to get
 *  wrong:
 *   - only ever removes sessions that carry `actuals` AND were created by the sync
 *     (the `synced-` bonus namespace). A planned session, or anything logged by hand,
 *     is never touched.
 *   - only removes one when another session on the same day, same discipline, started
 *     within the same window the ingest guard uses. Genuine doubles are hours apart.
 *   - keeps the non-bonus session when there is one, so a real planned session that
 *     got credited always survives and the phantom is what goes.
 *  Pure. Returns the same plan object when there is nothing to heal, so callers can
 *  cheaply tell whether anything changed. */
export function dedupeSyncedSessions(plan: Plan): { plan: Plan; removed: number } {
  const all = Object.values(plan.workouts);
  const isBonus = (w: Workout) => w.id.startsWith("synced-") && !!w.actuals;
  const startOf = (w: Workout) => (w.actuals?.startedAtISO ? Date.parse(w.actuals.startedAtISO) : NaN);

  const doomed = new Set<string>();
  // stable order so the survivor is deterministic across devices
  const candidates = all.filter(isBonus).sort((a, b) => a.id.localeCompare(b.id));

  for (const dup of candidates) {
    if (doomed.has(dup.id)) continue;
    const start = startOf(dup);
    if (Number.isNaN(start)) continue; // no start time → can't prove it's a duplicate
    const twin = all.find(
      (w) =>
        w.id !== dup.id &&
        !doomed.has(w.id) &&
        w.date === dup.date &&
        w.discipline === dup.discipline &&
        !Number.isNaN(startOf(w)) &&
        Math.abs(startOf(w) - start) <= SAME_ACTIVITY_WINDOW_MS &&
        // keep the survivor: a real session outranks a bonus; between two bonuses the
        // earlier id wins, which the sort above already fixed
        (!isBonus(w) || w.id.localeCompare(dup.id) < 0),
    );
    if (twin) doomed.add(dup.id);
  }

  if (!doomed.size) return { plan, removed: 0 };
  const next: Plan = {
    ...plan,
    workouts: { ...plan.workouts },
    weeks: plan.weeks.map((w) => ({ ...w, workoutIds: w.workoutIds.filter((id) => !doomed.has(id)) })),
  };
  for (const id of doomed) delete next.workouts[id];
  reindexWeeks(next);
  return { plan: next, removed: doomed.size };
}
