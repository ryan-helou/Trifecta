import type { Store } from "./db";
import type { StravaConn } from "./db";
import type { Discipline, Plan, WorkoutActuals } from "./types";
import { setStatus } from "./adapt";

// ---------------------------------------------------------------------------
// Strava integration — OAuth, token refresh, activity fetch, and the matcher
// that turns a synced activity into an auto-completed planned workout.
//
// Strava is the hub most devices sync into (Garmin, COROS, Wahoo, Apple Watch),
// so one connection covers most users. Requires a Strava API app (client id +
// secret) — see STRAVA_SETUP.md. All network calls are plain fetch; nothing here
// touches React, so the webhook + sync routes can share it.
// ---------------------------------------------------------------------------

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const API_BASE = "https://www.strava.com/api/v3";

// read + private activities, so we catch sessions the athlete keeps private
export const STRAVA_SCOPE = "read,activity:read_all";

export function stravaConfigured(): boolean {
  return !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
}

function clientId(): string {
  return process.env.STRAVA_CLIENT_ID || "";
}
function clientSecret(): string {
  return process.env.STRAVA_CLIENT_SECRET || "";
}

// ---- OAuth ----

export function authorizeUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

export interface TokenExchange {
  athleteId: number;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix seconds
  scope?: string;
}

export async function exchangeCode(code: string): Promise<TokenExchange> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${res.status}`);
  const j = await res.json();
  return {
    athleteId: Number(j.athlete?.id),
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Number(j.expires_at),
    scope: undefined,
  };
}

async function refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status}`);
  const j = await res.json();
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Number(j.expires_at) };
}

/** Return a valid access token for the connection, refreshing + persisting if it
 *  is expired or about to (Strava access tokens live ~6h). */
export async function validAccessToken(store: Store, conn: StravaConn): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (conn.expiresAt - now > 60) return conn.accessToken;
  const t = await refreshTokens(conn.refreshToken);
  await store.updateStravaTokens(conn.userId, t);
  return t.accessToken;
}

// ---- activities ----

export interface StravaActivity {
  id: number;
  name?: string;
  type?: string; // legacy category, e.g. "Run"
  sport_type?: string; // newer, more granular, e.g. "TrailRun"
  start_date?: string; // UTC ISO
  start_date_local?: string; // athlete-local ISO
  distance?: number; // meters
  moving_time?: number; // seconds
  elapsed_time?: number; // seconds
  average_heartrate?: number;
  has_heartrate?: boolean;
}

export async function fetchActivity(accessToken: string, id: number): Promise<StravaActivity | null> {
  const res = await fetch(`${API_BASE}/activities/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Strava fetch activity ${id} failed: ${res.status}`);
  return (await res.json()) as StravaActivity;
}

export async function fetchRecentActivities(accessToken: string, afterEpoch?: number, perPage = 30): Promise<StravaActivity[]> {
  const p = new URLSearchParams({ per_page: String(Math.min(perPage, 100)) });
  if (afterEpoch) p.set("after", String(afterEpoch));
  const res = await fetch(`${API_BASE}/athlete/activities?${p.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava list activities failed: ${res.status}`);
  return (await res.json()) as StravaActivity[];
}

// ---- matching ----

/** Map a Strava activity onto one of our disciplines. Returns null for things we
 *  don't schedule (walks, hikes, yoga…) so they can't false-match a session. */
export function disciplineOf(a: StravaActivity): Discipline | null {
  const t = (a.sport_type || a.type || "").toLowerCase();
  if (t.includes("swim")) return "swim";
  if (t.includes("ride") || t.includes("bike") || t === "velomobile") return "bike";
  if (t.includes("run")) return "run"; // Run, TrailRun, VirtualRun
  if (t.includes("weight") || t === "workout" || t.includes("crossfit") || t.includes("strength")) return "strength";
  return null;
}

export function actualsFromActivity(a: StravaActivity): WorkoutActuals {
  return {
    source: "strava",
    activityId: a.id,
    name: a.name,
    distanceM: a.distance != null ? Math.round(a.distance) : undefined,
    durationSec: a.moving_time ?? a.elapsed_time,
    avgHr: a.has_heartrate && a.average_heartrate ? Math.round(a.average_heartrate) : undefined,
    startedAtISO: a.start_date,
  };
}

export interface Match {
  workoutId: string;
  confidence: "high" | "medium";
}

/** Find the planned workout an activity most likely completes: same local day,
 *  matching discipline (bricks also accept a run/bike), still un-done. With
 *  several candidates, the closest by duration wins. Pure — unit-testable. */
export function matchActivityToWorkout(plan: Plan, a: StravaActivity): Match | null {
  const disc = disciplineOf(a);
  if (!disc) return null;
  const day = (a.start_date_local || a.start_date || "").slice(0, 10);
  if (!day) return null;

  const candidates = Object.values(plan.workouts).filter((w) => {
    if (w.date !== day || w.status !== "planned") return false;
    if (w.discipline === disc) return true;
    // a swim/bike/run can close out that leg of a brick
    if (w.discipline === "brick" && (disc === "run" || disc === "bike")) return true;
    return false;
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { workoutId: candidates[0].id, confidence: "high" };

  // multiple on the same day → pick the closest planned duration to actual
  const actual = a.moving_time ?? a.elapsed_time ?? 0;
  candidates.sort((x, y) => Math.abs(x.estDurationSec - actual) - Math.abs(y.estDurationSec - actual));
  return { workoutId: candidates[0].id, confidence: "medium" };
}

// ---- apply (shared by webhook + manual sync) ----

export interface ApplyResult {
  matched: boolean;
  workoutId?: string;
  title?: string;
  alreadyDone?: boolean;
}

/** Match one activity to the user's plan and, if it lands, mark that session done
 *  and attach the actuals — writing the mutated plan back to the store. Idempotent:
 *  re-applying the same activity is a no-op. */
export async function applyActivityToUser(store: Store, userId: string, a: StravaActivity): Promise<ApplyResult> {
  const data = await store.getData(userId);
  const plan = (data.plan ?? null) as Plan | null;
  if (!plan || !plan.workouts) return { matched: false };

  const match = matchActivityToWorkout(plan, a);
  if (!match) return { matched: false };

  const existing = plan.workouts[match.workoutId];
  if (!existing) return { matched: false };
  // already completed by this exact activity → nothing to do
  if (existing.actuals?.activityId === a.id && existing.status === "done") {
    return { matched: true, workoutId: match.workoutId, title: existing.title, alreadyDone: true };
  }

  const done = setStatus(plan, match.workoutId, "done");
  const acts = actualsFromActivity(a);
  const target = done.workouts[match.workoutId];
  const withActuals = {
    ...done,
    workouts: {
      ...done.workouts,
      [match.workoutId]: {
        ...target,
        actuals: acts,
        // Also populate the flat fields the credit/stats/UI read (creditedSeconds,
        // Progress, WorkoutDetail) — otherwise a device-synced session counts only
        // its planned estimate and the real duration/distance from Strava are lost.
        actualDurationSec: acts.durationSec ?? target.actualDurationSec,
        actualDistanceM: acts.distanceM ?? target.actualDistanceM,
      },
    },
  };
  await store.setData(userId, { ...data, plan: withActuals, updatedAtISO: new Date().toISOString() });
  return { matched: true, workoutId: match.workoutId, title: existing.title };
}
