import type { Activity } from "./activity";
import { applyActivityToPlan } from "./activity";
import type { Discipline, Plan } from "./types";
import { IS_NATIVE } from "./runtime";
import { Health } from "@capgo/capacitor-health";

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

// STATICALLY imported on purpose — see the import at the top of this file.
//
// A lazy import() of a Capacitor plugin HANGS FOREVER inside the bundled WKWebView.
// That is the documented root cause of the old login hang (lib/tokenStore.ts) and of
// the notifications card never rendering (lib/notify.ts), and on 2026-07-30 it cost us
// an App Store rejection under guideline 2.1(a): "Sync with Apple Health button was
// unresponsive."
//
// The mechanism is worth spelling out, because the symptom pointed at the wrong place.
// Connections.tsx disabled the button while its `state` was "checking", and `state`
// only left "checking" when healthAvailable() resolved — which awaited the import
// below. The promise never settled, so the button was never enabled and a tap did
// nothing at all. It still LOOKED perfectly tappable (the colour is set inline, so
// there is no visual disabled state), which is exactly why every assertVisible-based
// test passed and a human reviewer found it in seconds.
//
// No runtime chunk, no hang. Do not make this dynamic again.
function plugin() {
  if (!IS_NATIVE) return null;
  return Health;
}

/** Race a native bridge call against the clock. Mirrors lib/tokenStore.ts.
 *
 *  Every call below goes through this, because a Capacitor bridge call can fail by
 *  NEVER CALLING BACK — not by rejecting — and a `catch` cannot see that. Measured
 *  2026-07-30 on an unsigned simulator build (CODE_SIGNING_ALLOWED=NO, so no HealthKit
 *  entitlement): requestAuthorization presented no sheet, logged nothing, and its
 *  completion never fired. The button sat on "Reading Apple Health…" forever.
 *
 *  That particular cause is a simulator artifact — a signed device build gets the real
 *  sheet — but "the UI is hostage to a native callback" is not something to ship on the
 *  strength of "it should be fine on device", especially in the exact feature Apple
 *  already rejected us over. Timing out and telling the truth is always better than a
 *  spinner that never ends. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    Promise.resolve(p).catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Is a native health store (HealthKit / Health Connect) available on this device? */
export async function healthAvailable(): Promise<boolean> {
  const h = plugin();
  if (!h) return false;
  return withTimeout(h.isAvailable().then((r) => r.available), 4000, false);
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
  const h = plugin();
  if (!h) return false;
  // 20s: a real athlete reading the HealthKit sheet has ample time, while a bridge that
  // will never answer releases the UI instead of holding it forever. The return value is
  // deliberately ignored by callers (see the doc comment above), so timing out here only
  // means "stop waiting", never "access denied".
  return withTimeout(h.requestAuthorization({ read: ["workouts"] }).then(() => true), 20000, false);
}

/** Read recent workouts (default: last 30 days) as source-agnostic Activities. */
export async function readHealthWorkouts(sinceISO?: string): Promise<Activity[]> {
  const h = plugin();
  if (!h) return [];
  const startDate = sinceISO ?? new Date(Date.now() - 30 * 864e5).toISOString();
  try {
    const { workouts } = await withTimeout(h.queryWorkouts({ startDate, limit: 100 }), 20000, {
      workouts: [] as Awaited<ReturnType<typeof h.queryWorkouts>>["workouts"],
    });
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
