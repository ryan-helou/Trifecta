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
//
// Distinct failure codes (surfaced as ?strava=<code>) so the UI can toast a
// helpful message and Railway logs let us pinpoint which path fired without
// dumping tokens or PII:
//   deny    — user denied consent, or Strava returned ?error=<x>
//   state   — CSRF state cookie missing or mismatch (usually a stale link)
//   token   — code exchange with Strava failed (network / bad code / expired)
//   in-use  — this Strava athlete is already linked to a different Trifecta user
//             (one Strava = one Trifecta account; the athlete must disconnect
//             at strava.com/settings/apps or use a different Strava account)
//   error   — anything else (fallback)
export async function GET(req: NextRequest) {
  const home = new URL("/", baseUrl(req));
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.redirect(home);

  const err = req.nextUrl.searchParams.get("error");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("strava_oauth_state")?.value;

  const fail = (reason: "deny" | "state" | "token" | "in-use" | "error", note?: string) => {
    console.warn(`strava-connect: ${reason}${note ? " — " + note : ""} (uid=${uid})`);
    home.searchParams.set("strava", reason);
    const res = NextResponse.redirect(home);
    res.cookies.set("strava_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  };

  if (err) return fail("deny", err);
  if (!code || !state || !cookieState || state !== cookieState) return fail("state");

  let athleteId = 0;
  let tokenExchange;
  try {
    tokenExchange = await exchangeCode(code);
    athleteId = tokenExchange.athleteId;
  } catch (e) {
    return fail("token", (e as Error).message);
  }
  if (!athleteId) return fail("token", "no athleteId");

  const store = getStore();
  // Enforce one-Strava-per-Trifecta-user explicitly rather than blowing up on
  // the athlete_id UNIQUE constraint deep in upsert (that leaves the caller
  // with a generic "Try again" and no path forward).
  try {
    const existing = await store.getStravaByAthlete(athleteId);
    if (existing && existing.userId !== uid) return fail("in-use", `athlete ${athleteId} belongs to ${existing.userId}`);
  } catch { /* fall through — upsert's own guard is a safety net */ }

  try {
    await store.upsertStrava({
      userId: uid, athleteId,
      accessToken: tokenExchange.accessToken,
      refreshToken: tokenExchange.refreshToken,
      expiresAt: tokenExchange.expiresAt,
      scope: STRAVA_SCOPE,
    });
    // best-effort backfill (don't fail the connect if Strava is slow)
    try {
      const after = Math.floor(Date.now() / 1000) - 14 * 86400;
      const acts = await fetchRecentActivities(tokenExchange.accessToken, after, 30);
      for (const a of acts) await applyActivityToUser(store, uid, a);
      await store.touchStravaSync(uid);
    } catch { /* backfill is optional */ }

    home.searchParams.set("strava", "connected");
    const res = NextResponse.redirect(home);
    res.cookies.set("strava_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    const msg = (e as Error).message || "";
    // Postgres unique_violation on athlete_id = same race as the pre-check but
    // arrived at through a concurrent write; surface the same in-use code.
    if (/strava_connections_athlete_id_key|duplicate key/i.test(msg)) return fail("in-use", msg);
    return fail("error", msg);
  }
}
