import type { NewActivity, Store } from "../db";
import { activityLocalDay, disciplineOf, type StravaActivity } from "../strava";
import { SPORT_UNIT, sportFromDiscipline, type LeagueActivity } from "./types";

/**
 * The bridge from Trifecta's Strava ingest to league scoring.
 *
 * There is ONE Strava pipeline. The same fetched activity that completes a
 * planned workout also drops a row here, so a league never needs its own OAuth
 * connection, its own tokens, or its own slice of the rate limit — and the ride
 * that ticks off Tuesday's session is by construction the same ride that scores.
 *
 * Deliberately NOT folded into applyActivityToUser: that function bails early
 * for a user with no plan (`if (!plan) return`), and league members are not
 * required to follow a training plan. Someone can join a league, connect Strava,
 * and score without ever generating a plan — so scoring has to be independent of
 * whether the plan apply did anything.
 *
 * Idempotent through the strava_imports ledger: re-delivery of the same activity
 * (webhook retry, manual sync, connect backfill) inserts nothing the second time.
 */

/** What a Strava activity is worth, or null if it isn't a scored sport. Pure. */
export function scoredActivityFrom(userId: string, a: StravaActivity): NewActivity | null {
  const sport = sportFromDiscipline(disciplineOf(a) ?? "");
  if (!sport) return null; // walks, hikes, yoga — not a competition sport
  const day = activityLocalDay(a);
  if (!day) return null;

  // Distance sports score on kilometres; gym is flat, so its quantity is always
  // 1 workout regardless of whether Strava happened to attach a distance.
  const km = SPORT_UNIT[sport] === "flat" ? 1 : (a.distance ?? 0) / 1000;
  // A zero-distance ride/run is a session Strava couldn't measure (treadmill with
  // no sensor, forgotten GPS). It'd score nothing, so don't manufacture a row the
  // athlete would then have to delete — let them log it by hand with a real number.
  if (SPORT_UNIT[sport] === "km" && km <= 0) return null;

  return {
    userId,
    sport,
    km: Math.round(km * 1000) / 1000,
    occurredOn: day,
    note: a.name?.trim() ? a.name.trim().slice(0, 140) : null,
  };
}

/** Record a synced Strava activity for league scoring. Returns the new row, or
 *  null when it isn't scoreable or was already imported. Never throws — a
 *  scoring write must not be able to fail a Strava sync. */
export async function recordStravaActivity(
  store: Store,
  userId: string,
  a: StravaActivity,
): Promise<LeagueActivity | null> {
  try {
    const input = scoredActivityFrom(userId, a);
    if (!input) return null;
    return await store.importStravaActivity(input, a.id);
  } catch (e) {
    console.warn(`league: could not record strava activity ${a.id} for ${userId}`, e);
    return null;
  }
}

/** Mirror a Strava deletion into the league log, so points don't survive a
 *  session the athlete removed upstream. */
export async function removeStravaActivity(store: Store, userId: string, stravaId: number): Promise<void> {
  try {
    await store.deleteStravaActivity(userId, stravaId);
  } catch (e) {
    console.warn(`league: could not remove strava activity ${stravaId} for ${userId}`, e);
  }
}
