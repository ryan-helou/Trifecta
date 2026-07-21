import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth-server";
import { getStore } from "@/lib/db";
import { STRAVA_SCOPE, applyActivityToUser, exchangeCode, fetchRecentActivities } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseUrl(req: NextRequest): string {
  return process.env.APP_URL || req.nextUrl.origin;
}

// Strava redirects here with ?code&state (or ?error). Exchange the code, store
// the connection, and backfill the last two weeks so recent sessions light up
// immediately. Then bounce home with a ?strava= status the UI can toast.
export async function GET(req: NextRequest) {
  const home = new URL("/", baseUrl(req));
  const uid = getUserIdFromRequest(req);
  if (!uid) return NextResponse.redirect(home);

  const err = req.nextUrl.searchParams.get("error");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("strava_oauth_state")?.value;

  const fail = () => {
    home.searchParams.set("strava", "error");
    const res = NextResponse.redirect(home);
    res.cookies.set("strava_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  };

  if (err || !code || !state || !cookieState || state !== cookieState) return fail();

  try {
    const t = await exchangeCode(code);
    if (!t.athleteId) return fail();
    const store = getStore();
    await store.upsertStrava({
      userId: uid,
      athleteId: t.athleteId,
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: t.expiresAt,
      scope: STRAVA_SCOPE,
    });
    // best-effort backfill (don't fail the connect if Strava is slow)
    try {
      const after = Math.floor(Date.now() / 1000) - 14 * 86400;
      const acts = await fetchRecentActivities(t.accessToken, after, 30);
      for (const a of acts) await applyActivityToUser(store, uid, a);
      await store.touchStravaSync(uid);
    } catch {
      /* backfill is optional */
    }
    home.searchParams.set("strava", "connected");
    const res = NextResponse.redirect(home);
    res.cookies.set("strava_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch {
    return fail();
  }
}
