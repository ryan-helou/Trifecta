import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth-server";
import { getStore } from "@/lib/db";
import { stravaConfigured } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Is this user's Strava linked? (used by the Profile "Connections" card)
export async function GET(req: NextRequest) {
  const uid = getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ connected: false, configured: stravaConfigured() }, { status: 401 });
  const store = getStore();
  const conn = await store.getStravaByUser(uid);
  return NextResponse.json({
    connected: !!conn,
    configured: stravaConfigured(),
    athleteId: conn?.athleteId ?? null,
    lastSyncAtISO: conn?.lastSyncAtISO ?? null,
  });
}

// Disconnect (drops our stored tokens; the athlete can also revoke in Strava).
export async function DELETE(req: NextRequest) {
  const uid = getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  await getStore().deleteStrava(uid);
  return NextResponse.json({ ok: true });
}
