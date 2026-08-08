import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { applyActivityToUser, fetchActivity, validAccessToken } from "@/lib/strava";
import { removeStravaActivity } from "@/lib/league/ingest";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same "amatri" fallback the subscribe route uses (lib is deliberately kept as
// "amatri" internally), so an unset env var doesn't desync the two sides.
const VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || "amatri";

// Strava validates a new subscription by GETting the callback with a challenge
// it expects echoed back, guarded by our verify token.
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    return NextResponse.json({ "hub.challenge": challenge });
  }
  return NextResponse.json({ error: "invalid verify token" }, { status: 403 });
}

// Event router. Strava wants a 200 within ~2s; the work here is small enough to
// stay well inside that. We always 200 so Strava doesn't disable the subscription;
// missed activity events are caught by the manual "Sync" backfill.
//
// Three shapes matter:
//   activity create/update → fetch + apply to plan (idempotent)
//   athlete  update  updates.authorized="false" → deauthorization (Strava API
//     terms require handling this — drop the stored tokens so we stop calling on
//     behalf of an athlete who revoked us)
export async function POST(req: NextRequest) {
  const ipOk = rateLimit(`strava-wh:ip:${clientIp(req)}`, 120, 60_000).ok;
  const body = await req.json().catch(() => null);
  if (!ipOk || !body) return NextResponse.json({ ok: true });

  const athleteId = Number(body.owner_id);
  if (!Number.isFinite(athleteId)) return NextResponse.json({ ok: true });
  if (!rateLimit(`strava-wh:ath:${athleteId}`, 30, 60_000).ok) return NextResponse.json({ ok: true });

  try {
    const store = getStore();

    // Deauthorization. Strava sends the athlete's own event when they revoke us
    // from strava.com/settings/apps. "authorized" arrives as the string "false".
    if (
      body.object_type === "athlete" &&
      body.aspect_type === "update" &&
      body.updates && String(body.updates.authorized) === "false"
    ) {
      const conn = await store.getStravaByAthlete(athleteId);
      if (conn) await store.deleteStrava(conn.userId);
    } else if (
      body.object_type === "activity" &&
      (body.aspect_type === "create" || body.aspect_type === "update")
    ) {
      const activityId = Number(body.object_id);
      const conn = await store.getStravaByAthlete(athleteId);
      if (conn) {
        const token = await validAccessToken(store, conn);
        const act = await fetchActivity(token, activityId);
        if (act) {
          await applyActivityToUser(store, conn.userId, act);
        }
      }
    } else if (body.object_type === "activity" && body.aspect_type === "delete") {
      // Deleting on Strava should take the points with it. Only the league log is
      // touched — an already-completed workout keeps its actuals.
      const conn = await store.getStravaByAthlete(athleteId);
      if (conn) await removeStravaActivity(store, conn.userId, Number(body.object_id));
    }
  } catch {
    /* never block the 200 — backfill covers gaps, deauth retries on next event */
  }
  return NextResponse.json({ ok: true });
}
