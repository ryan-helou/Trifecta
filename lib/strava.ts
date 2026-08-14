import type { Store } from "./db";
import type { StravaConn } from "./db";
import type { Discipline, Plan, Workout, WorkoutActuals, Zone } from "./types";
import { isDetached, setStatus, reindexWeeks } from "./adapt";
import { duplicateActivity } from "./activity";
import { dayIndexOf } from "./dates";

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

// Strava rotates the refresh token on every refresh, so two concurrent refreshes
// (webhook racing a manual sync) are fatal: the loser persists an already-revoked
// pair and bricks the connection. Single-flight per user — concurrent callers
// share one in-flight POST. Entries clear on settle so a failure never poisons
// the map, and the rotated pair is persisted before anyone gets the new token.
const inflightRefresh = new Map<string, Promise<{ accessToken: string; refreshToken: string; expiresAt: number }>>();

/** Return a valid access token for the connection, refreshing + persisting if it
 *  is expired or about to (Strava access tokens live ~6h). */
export async function validAccessToken(store: Store, conn: StravaConn): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (conn.expiresAt - now > 60) return conn.accessToken;
  let refresh = inflightRefresh.get(conn.userId);
  if (!refresh) {
    refresh = refreshTokens(conn.refreshToken)
      .then(async (t) => {
        await store.updateStravaTokens(conn.userId, t);
        return t;
      })
      .finally(() => inflightRefresh.delete(conn.userId));
    inflightRefresh.set(conn.userId, refresh);
  }
  const t = await refresh;
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
  utc_offset?: number; // seconds east of UTC (e.g. -25200 for PDT)
  distance?: number; // meters
  moving_time?: number; // seconds
  elapsed_time?: number; // seconds
  average_heartrate?: number;
  max_heartrate?: number;
  has_heartrate?: boolean;
  average_watts?: number; // avg power (bike, if a power meter was present)
  device_watts?: boolean; // true when watts came from a real meter, not an estimate
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
    maxHr: a.has_heartrate && a.max_heartrate ? Math.round(a.max_heartrate) : undefined,
    // only trust real-meter power for calibration — Strava's estimated watts are noisy
    avgWatts: a.device_watts && a.average_watts ? Math.round(a.average_watts) : undefined,
    startedAtISO: a.start_date,
  };
}

export interface Match {
  workoutId: string;
  confidence: "high" | "medium";
}

/** Calendar day (yyyy-mm-dd) the athlete experienced the activity on. Prefer
 *  start_date_local; when only UTC is present, shift by utc_offset so a 7pm
 *  PDT ride doesn't land on tomorrow's plan. Pure — unit-testable. */
export function activityLocalDay(a: StravaActivity): string | null {
  const local = (a.start_date_local || "").slice(0, 10);
  if (local) return local;
  if (!a.start_date) return null;
  const startMs = Date.parse(a.start_date);
  if (Number.isNaN(startMs)) return null;
  const offsetMs = typeof a.utc_offset === "number" ? a.utc_offset * 1000 : 0;
  return new Date(startMs + offsetMs).toISOString().slice(0, 10);
}

/** Find the planned workout an activity most likely completes: same local day,
 *  matching discipline (bricks also accept a run/bike), still un-done. With
 *  several candidates, the closest by duration wins. Pure — unit-testable. */
export function matchActivityToWorkout(plan: Plan, a: StravaActivity): Match | null {
  const disc = disciplineOf(a);
  if (!disc) return null;
  const day = activityLocalDay(a);
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
  /** true when a Strava "update" event refreshed the stored actuals in place */
  updated?: boolean;
  /** the athlete un-completed this activity; it is not offered to the plan again */
  detached?: boolean;
}

/** Was this session created BY a sync (rather than prescribed by the engine)?
 *  Matches the id shape minted in addBonusWorkoutFromStrava. */
export function isSyncedId(id: string): boolean {
  return id.startsWith("synced-");
}

/** Create a bonus workout for an activity that didn't match any planned session. */
function addBonusWorkoutFromStrava(plan: Plan, a: StravaActivity): { plan: Plan; workoutId: string } | null {
  const disc = disciplineOf(a);
  if (!disc) return null;
  const day = activityLocalDay(a);
  if (!day) return null;
  const acts = actualsFromActivity(a);
  const zone: Zone = 2;
  const base = `synced-${day}-${disc}`;
  let id = base;
  let n = 1;
  const p: Plan = { ...plan, workouts: { ...plan.workouts }, weeks: plan.weeks.map((w) => ({ ...w, workoutIds: [...w.workoutIds] })) };
  while (p.workouts[id]) id = `${base}-${++n}`;
  const w: Workout = {
    id,
    date: day,
    weekIndex: 0,
    dayIndex: dayIndexOf(day),
    discipline: disc,
    type: disc === "strength" ? "strength" : "endurance",
    title: a.name || `${disc[0].toUpperCase()}${disc.slice(1)} (Strava)`,
    purpose: "Synced from Strava.",
    segments: [{ kind: "main", discipline: disc, zone, durationSec: a.moving_time ?? a.elapsed_time ?? 0, description: "Synced session" }],
    estDurationSec: a.moving_time ?? a.elapsed_time ?? 0,
    estDistanceM: a.distance != null ? Math.round(a.distance) : undefined,
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

/** Match one activity to the user's plan and, if it lands, mark that session done
 *  and attach the actuals — writing the mutated plan back to the store. Unmatched
 *  activities (rest day, different sport, etc.) create a bonus session so training
 *  load stays complete. Idempotent: one activity completes at most one session,
 *  ever; re-delivery of an activity a workout already carries refreshes that
 *  workout's actuals in place (crop/trim/rename on Strava) instead of matching
 *  again. Writes go through a CAS retry — webhook, manual sync and the connect
 *  backfill all race each other and the client's autosave over the same blob. */
export async function applyActivityToUser(store: Store, userId: string, a: StravaActivity): Promise<ApplyResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await store.getDataV(userId);
    if (!row) return { matched: false };
    const { state: data, version } = row;
    const plan = (data.plan ?? null) as Plan | null;
    if (!plan || !plan.workouts) return { matched: false };

    // THE ATHLETE'S UNDO OUTRANKS THE SYNC.
    //
    // First question asked, before matching or refreshing anything: did they tell us
    // this activity doesn't complete a session? The sync re-reads three weeks of
    // activities on every pass, so without this the same ride is re-offered to the
    // same session every two minutes and an undo cannot survive its own timer.
    // Checked here rather than inside the match so it also blocks the bonus-session
    // branch below — otherwise un-ticking a session would spawn a synced- copy of the
    // very activity that was just rejected, which is worse than the bug.
    if (isDetached(plan, a.id)) return { matched: false, detached: true };

    // One activity, one session: whatever its status now, a workout that already
    // carries this activity id owns it — update in place, never match a second.
    const carrier = Object.values(plan.workouts).find((w) => w.actuals?.activityId === a.id);
    if (carrier) {
      const acts = actualsFromActivity(a);
      const refreshed = {
        ...carrier,
        actuals: acts,
        actualDurationSec: acts.durationSec ?? carrier.actualDurationSec,
        actualDistanceM: acts.distanceM ?? carrier.actualDistanceM,
        // Rename on Strava, rename here — but ONLY for sessions Strava created.
        // A bonus session IS the activity, so its title going stale means the app
        // shows a name the athlete has since changed (Ryan had two rides both still
        // reading "MyWhoosh - Hudayriyat Outer Loop" long after renaming them "Z1
        // recovery" and "Another Z1 bike"). A PLANNED session is different: its title
        // is the prescription — "Easy Aerobic Run" — and must not be overwritten by
        // whatever the athlete happened to call the ride that completed it.
        ...(isSyncedId(carrier.id) && a.name && a.name !== carrier.title ? { title: a.name } : {}),
      };
      if (JSON.stringify(refreshed) === JSON.stringify(carrier)) {
        return { matched: true, workoutId: carrier.id, title: carrier.title, alreadyDone: true };
      }
      const withRefreshed = { ...plan, workouts: { ...plan.workouts, [carrier.id]: refreshed } };
      const next = await store.setDataIf(userId, { ...data, plan: withRefreshed, updatedAtISO: new Date().toISOString() }, version);
      if (next !== null) return { matched: true, workoutId: carrier.id, title: carrier.title, alreadyDone: true, updated: true };
      continue;
    }

    const match = matchActivityToWorkout(plan, a);
    let updatedPlan: Plan;
    let workoutId: string;
    let title: string;

    if (match) {
      const existing = plan.workouts[match.workoutId];
      if (!existing) return { matched: false };
      const done = setStatus(plan, match.workoutId, "done");
      const acts = actualsFromActivity(a);
      const target = done.workouts[match.workoutId];
      updatedPlan = {
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
      };
      workoutId = match.workoutId;
      title = existing.title;
    } else {
      // no planned session → we'd create a bonus. First guard against the same physical
      // activity already applied via Apple Health (different id, so the carrier check
      // above missed it) — otherwise the run counts twice in the load charts.
      const disc = disciplineOf(a);
      const day = activityLocalDay(a);
      if (
        disc &&
        day &&
        duplicateActivity(plan, { source: "strava", discipline: disc, localDay: day, startISO: a.start_date, durationSec: a.moving_time ?? a.elapsed_time ?? 0 })
      ) {
        return { matched: false };
      }
      const bonus = addBonusWorkoutFromStrava(plan, a);
      if (!bonus) return { matched: false };
      updatedPlan = bonus.plan;
      workoutId = bonus.workoutId;
      title = updatedPlan.workouts[workoutId].title;
    }

    const next = await store.setDataIf(userId, { ...data, plan: updatedPlan, updatedAtISO: new Date().toISOString() }, version);
    if (next !== null) return { matched: true, workoutId, title };
  }
  console.warn(`strava: gave up applying activity ${a.id} for ${userId} after 3 version conflicts`);
  return { matched: false };
}
