import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth-server";
import { getStore } from "@/lib/db";
import { applyActivityToUser, fetchRecentActivities, validAccessToken } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual backfill — pull the last few weeks of activities and auto-complete any
// that match a planned session. A safety net for missed webhooks + a "Sync now"
// button the user can hit.
export async function POST(req: NextRequest) {
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const store = getStore();
  const conn = await store.getStravaByUser(uid);
  if (!conn) return NextResponse.json({ error: "Strava is not connected." }, { status: 400 });
  try {
    const token = await validAccessToken(store, conn);
    const after = Math.floor(Date.now() / 1000) - 21 * 86400; // last 3 weeks
    const acts = await fetchRecentActivities(token, after, 40);
    let matched = 0;
    for (const a of acts) {
      const r = await applyActivityToUser(store, uid, a);
      if (r.matched && !r.alreadyDone) matched++;
    }
    await store.touchStravaSync(uid);
    return NextResponse.json({ ok: true, scanned: acts.length, matched });
  } catch {
    return NextResponse.json({ error: "Sync failed. Try again." }, { status: 502 });
  }
}
