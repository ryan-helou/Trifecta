import { NextRequest, NextResponse } from "next/server";
import { claimsFromRequest, clearCookie } from "@/lib/auth-server";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";

/*
  Logout used to be client-side theatre: it cleared the cookie and the app forgot its
  token, but the token itself stayed valid for the rest of its 60 days. Anyone holding a
  copy — a shared computer's cookie jar, a captured Authorization header, a device
  backup — kept full access to the account long after the athlete believed they had
  signed out. (Ticket #71.)

  Now the session id inside the token is recorded as revoked, so every later request
  presenting it fails authentication server-side. Revocation is keyed on the sid, so
  signing out on the phone deliberately leaves a web session alone.
*/
export async function POST(req: NextRequest) {
  const claims = claimsFromRequest(req);
  if (claims) {
    // Best-effort: a store hiccup must not strand the athlete on a screen insisting
    // they're still signed in. The cookie still goes, and the token still expires.
    await getStore()
      .revokeSession(claims.userId, claims.sid, claims.exp)
      .catch(() => {});
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearCookie());
  return res;
}
