import type { Activity } from "./activity";
import { applyActivityToPlan } from "./activity";
import type { Discipline, Plan } from "./types";
import { IS_NATIVE } from "./runtime";

// ---------------------------------------------------------------------------
// Apple Health (HealthKit) integration — the native feature that clears Apple
// Guideline 4.2 AND is our primary, gatekeeper-free data source (vs. a hostile
// Strava). ON-DEVICE ONLY: reads recent workouts, matches them to the plan
// client-side, and marks sessions done. Raw health data never leaves the phone.
// (Native permissions/read are verified on-device with `cap sync` + Xcode.)
// ---------------------------------------------------------------------------

function localDay(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Map a HealthKit workout type onto one of our disciplines; null = don't schedule
 *  it (walks, yoga, …) so it can't false-match a session. */
function disciplineOfWorkout(t: string): Discipline | null {
  const s = t.toLowerCase();
  if (s.includes("swim")) return "swim";
  if (s.includes("cycl") || s.includes("bik") || s.includes("handcycl")) return "bike";
  if (s.includes("run")) return "run";
  if (s.includes("strength") || s.includes("weightlift") || s.includes("functional") || s.includes("crosstraining"))
    return "strength";
  return null;
}

async function plugin() {
  if (!IS_NATIVE) return null;
  try {
    const { Health } = await import("@capgo/capacitor-health");
    return Health;
  } catch {
    return null;
  }
}

/** Is a native health store (HealthKit / Health Connect) available on this device? */
export async function healthAvailable(): Promise<boolean> {
  const h = await plugin();
  if (!h) return false;
  try {
    return (await h.isAvailable()).available;
  } catch {
    return false;
  }
}

/** Present the HealthKit permission sheet for workouts (a no-op after the first time).
 *
 *  Returns whether the ASK succeeded — deliberately NOT whether access was granted,
 *  because iOS never tells you that. HealthKit hides read authorization by design: if
 *  it revealed a denial, apps could infer the user has something to hide. Under the
 *  hood the plugin reports `readAuthorized` from `getRequestStatusForAuthorization`,
 *  which answers "do I still need to ask?" — `.unnecessary` (already asked, allowed OR
 *  denied) maps to authorized, `.shouldRequest` maps to denied.
 *
 *  We used to gate the whole sync on that value, which was wrong in both directions:
 *  it could report "access is off" to someone who had just tapped Allow (the status is
 *  read as the sheet settles), and report authorized for someone who had tapped Deny.
 *  The Apple-sanctioned pattern is the only honest one — ask, then read, and let the
 *  result speak. A denied read returns an empty set, indistinguishable from "no
 *  workouts", which is exactly what Apple intends. */
export async function requestHealthAuth(): Promise<boolean> {
  const h = await plugin();
  if (!h) return false;
  try {
    await h.requestAuthorization({ read: ["workouts"] });
    return true;
  } catch {
    return false;
  }
}

/** Read recent workouts (default: last 30 days) as source-agnostic Activities. */
export async function readHealthWorkouts(sinceISO?: string): Promise<Activity[]> {
  const h = await plugin();
  if (!h) return [];
  const startDate = sinceISO ?? new Date(Date.now() - 30 * 864e5).toISOString();
  try {
    const { workouts } = await h.queryWorkouts({ startDate, limit: 100 });
    return workouts.map((w) => ({
      source: "healthkit" as const,
      id: w.platformId ?? `${w.workoutType}-${w.startDate}`,
      discipline: disciplineOfWorkout(w.workoutType),
      localDay: localDay(w.startDate),
      startISO: w.startDate,
      durationSec: Math.round(w.duration),
      distanceM: w.totalDistance != null ? Math.round(w.totalDistance) : undefined,
      name: w.sourceName,
    }));
  } catch {
    return [];
  }
}

export interface HealthSyncResult {
  plan: Plan;
  applied: number;
}

/** Read Apple Health workouts and apply any that complete a planned session.
 *  Returns the updated plan (to persist via the normal state save) + how many
 *  sessions were credited. No-op off-device. */
export async function syncAppleHealth(plan: Plan, sinceISO?: string): Promise<HealthSyncResult> {
  const activities = await readHealthWorkouts(sinceISO);
  // oldest first so multiple same-day sessions credit in order
  activities.sort((a, b) => (a.startISO < b.startISO ? -1 : 1));
  let current = plan;
  let applied = 0;
  for (const act of activities) {
    const res = applyActivityToPlan(current, act);
    if (res) {
      current = res.plan;
      applied++;
    }
  }
  return { plan: current, applied };
}
