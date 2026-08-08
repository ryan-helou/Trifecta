import type { Store } from "../db";

/**
 * Strava does NOT feed league scoring. This file is what's left of the bridge that
 * used to, plus the cleanup that removes what it already wrote.
 *
 * Why it went: a league shows every member their rivals' distance and points. When
 * those numbers came from a Strava activity, that is one athlete's Strava data
 * displayed to another, which the API Policy prohibits outright:
 *
 *   §2.3  "Strava Data provided by a specific Strava user may be displayed or
 *          disclosed in your Developer Application only to that user. You may not
 *          display or disclose Strava Data related to other users, even if such
 *          data is publicly viewable on the Strava Platform."
 *
 * Aggregating does not launder it. §5.4 closes that door explicitly: the
 * restrictions "apply to data derived from Strava Data and to output that
 * incorporates or was generated using Strava Data" — so a points total or a
 * kilometre count computed from a Strava ride is itself Strava Data.
 *
 * This is settled, not a reading. Wandrer proposed the obvious compromise for the
 * same problem (cross-user maps, opt-in with periodic re-consent) and Strava
 * refused, leaving them to conclude they would have to limit competitions "to those
 * whose data comes from sources other than Strava". Apps rejected on this exact
 * clause include RunningCup (§2.3 quoted back at them verbatim) and Pi Runners — a
 * private, non-commercial, sixty-person club that was still auto-rejected purely
 * for having a leaderboard. Trifecta's capacity request was denied 2026-08-07.
 *
 * So leagues score only what Trifecta owns: manually logged sessions and Apple
 * Health workouts. Strava still completes the athlete's OWN planned sessions and is
 * still shown to them on their own screens — that part is permitted and untouched.
 * If a Strava-connected athlete wants league points, they log the session by hand
 * or connect Apple Health, whose data is ours to display.
 *
 * Do not reintroduce a Strava path here without re-reading the policy first.
 */

/** Purge a Strava-sourced row from the league log.
 *
 *  Nothing writes these any more, so this only ever removes legacy rows — but it
 *  stays wired to the activity-delete webhook and to deauthorisation because we are
 *  separately obliged to reflect an upstream deletion within 48 hours (§6.3) and to
 *  delete everything on revocation (§7.4). Cleaning a row that probably no longer
 *  exists is cheap; failing to clean one is a policy breach. Never throws. */
export async function removeStravaActivity(store: Store, userId: string, stravaId: number): Promise<void> {
  try {
    await store.deleteStravaActivity(userId, stravaId);
  } catch (e) {
    console.warn(`league: could not remove strava activity ${stravaId} for ${userId}`, e);
  }
}
