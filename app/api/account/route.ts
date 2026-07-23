import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { clearCookie, getUserIdFromRequest } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/account — permanently erase the signed-in user and all their data
// (Apple 5.1.1(v) in-app account deletion + GDPR right to erasure). The DB cascade
// removes their Strava connection, follows, and kudos along with the account.
export async function DELETE(req: NextRequest) {
  const uid = getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const store = getStore();
  await store.deleteUser(uid);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearCookie()); // web: drop the session cookie
  return res;
}
