import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { clearCookie, getUserIdFromRequest } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/account — permanently erase the signed-in user and all their data
// (Apple 5.1.1(v) in-app account deletion + GDPR right to erasure). The DB cascade
// removes their Strava connection, follows, kudos, and league activities along
// with the account.
export async function DELETE(req: NextRequest) {
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const store = getStore();
  // Leagues they own would otherwise cascade away with them, deleting a
  // competition out from under everyone else in it. Hand them over first.
  await store.handOffOwnedLeagues(uid);
  await store.deleteUser(uid);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearCookie()); // web: drop the session cookie
  return res;
}
