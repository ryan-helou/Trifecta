import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { applyActivityToUser, fetchActivity, validAccessToken } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Strava validates a new subscription by GETting the callback with a challenge
// it expects echoed back, guarded by our verify token.
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return NextResponse.json({ "hub.challenge": challenge });
  }
  return NextResponse.json({ error: "invalid verify token" }, { status: 403 });
}

// Activity events. Strava wants a 200 within ~2s; the work here is one token
// check + one fetch + one DB write, which is well inside that. applyActivityToUser
// is idempotent, so update/retry events are safe. We always 200 so Strava doesn't
// disable the subscription; missed events are caught by the manual "Sync" backfill.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (body && body.object_type === "activity" && (body.aspect_type === "create" || body.aspect_type === "update")) {
    try {
      const athleteId = Number(body.owner_id);
      const activityId = Number(body.object_id);
      const store = getStore();
      const conn = await store.getStravaByAthlete(athleteId);
      if (conn) {
        const token = await validAccessToken(store, conn);
        const act = await fetchActivity(token, activityId);
        if (act) await applyActivityToUser(store, conn.userId, act);
      }
    } catch {
      /* never block the 200 — backfill covers gaps */
    }
  }
  return NextResponse.json({ ok: true });
}
