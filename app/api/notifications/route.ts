import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth-server";
import { pushConfigured } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What happened to you while you weren't looking (#33) — kudos and comments on
// your sessions, with an unread count for the Friends badge.
//
// This is what carries the feature while APNs is unprovisioned. `pushEnabled` is
// reported honestly so the client can say "you'll be notified" only when that is
// actually true, rather than promising delivery that can't happen.

/** GET → recent notifications + unread count. */
export async function GET(req: NextRequest) {
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const rows = await getStore().listNotifications(uid, 50);
  return NextResponse.json({
    notifications: rows,
    unread: rows.filter((n) => !n.readAtISO).length,
    pushEnabled: pushConfigured(),
  });
}

/** POST { action: "read" } → clear the badge.
 *  POST { action: "register", token, platform } → store this device's push token. */
export async function POST(req: NextRequest) {
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const store = getStore();

  if (body.action === "read") {
    // Marked read THROUGH a timestamp the client supplies (what it actually
    // displayed), not "now": a notification that arrives between the render and
    // the tap would otherwise be marked read without ever having been seen.
    const through = typeof body.throughISO === "string" ? body.throughISO : new Date().toISOString();
    await store.markNotificationsRead(uid, through);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "register") {
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const platform = typeof body.platform === "string" ? body.platform : "ios";
    if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });
    await store.upsertPushToken(uid, token, platform);
    return NextResponse.json({ ok: true, pushEnabled: pushConfigured() });
  }

  if (body.action === "unregister") {
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (token) await store.deletePushToken(token);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
