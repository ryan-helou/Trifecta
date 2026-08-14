import { purgeExpiredStravaData } from "@/lib/stravaPrivacy";
import { todayISO } from "@/lib/dates";
import type { Plan } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { authenticateRead, getUserIdFromRequest, presentedApiKey } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Readable two ways: a signed-in session (web cookie / native Bearer session token),
// or a read-only `tri_…` API key (lib/apiKeys.ts) so another app can sync the plan
// without holding the password. Writes are session-only — see PUT.
//
// `?meta=1` answers "has anything changed?" in ~60 bytes instead of the ~110KB the
// full blob costs, so a polling consumer only pays for the download when there is
// something new. This is deliberately NOT `?since=<date>` returning changed
// workouts: a Plan is `weeks[]` holding ids into a `workouts` map, so a filtered
// copy is a Plan-shaped object whose weeks point at workouts that aren't there —
// and nothing records WHEN a workout changed anyway, only the date it falls on.
// Version-checking gets the saving without handing anyone a broken plan.
export async function GET(req: NextRequest) {
  const auth = await authenticateRead(req);
  if (!auth) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const store = getStore();
  const dv = await store.getDataV(auth.userId);
  const version = dv?.version ?? 0;
  if (req.nextUrl.searchParams.get("meta") === "1") {
    return NextResponse.json({ version, updatedAtISO: dv?.state?.updatedAtISO ?? null });
  }
  return NextResponse.json({ state: dv?.state ?? {}, version });
}

// The whole blob is stored per user and re-read by the social feed, so validate
// shape and bound size — one user can't post arbitrary/unbounded state.
const MAX_STATE_BYTES = 512 * 1024;
const isObjOrNull = (v: unknown) => v === null || (typeof v === "object" && !Array.isArray(v));

export async function PUT(req: NextRequest) {
  // THE LOAD-BEARING RULE: an API key is read-only, and this is where that is true.
  //
  // Checked BEFORE authenticating, and stated as its own refusal rather than left
  // to fall out of getUserIdFromRequest returning null. Both would reject a key
  // today — verifySessionToken can't validate a `tri_` string — but that is an
  // accident of the token format, not a decision. If the two credential types ever
  // converge (a signed key, a shared lookup), the implicit version would silently
  // start authorizing writes and nothing would fail. This line has to be deleted
  // for that to happen, and test/tokens.test.ts fails if it is.
  //
  // Fails closed when both are presented: a request waving a read-only credential
  // does not get to write because it also had a cookie.
  if (presentedApiKey(req)) {
    return NextResponse.json(
      { error: "API keys are read-only. Sign in to change your plan." },
      { status: 403 },
    );
  }
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const profile = body.profile ?? null;
  const plan = body.plan ?? null;
  if (!isObjOrNull(profile) || !isObjOrNull(plan)) {
    return NextResponse.json({ error: "Invalid state." }, { status: 400 });
  }
  if (Buffer.byteLength(JSON.stringify({ profile, plan }), "utf8") > MAX_STATE_BYTES) {
    return NextResponse.json({ error: "State is too large to save." }, { status: 413 });
  }
  const store = getStore();
  // Enforce the Strava cache window on the way in (API Policy §6.2: Strava Data may
  // not be retained beyond seven days). Doing it here rather than on a schedule
  // means the stored copy is never out of compliance, and it needs no cron: the app
  // saves on every meaningful change, so a plan that is being used is a plan that is
  // being swept. A dormant account writes nothing, but it also isn't accruing new
  // Strava data. Pure and cheap — returns the same object when nothing has expired.
  const swept = plan ? purgeExpiredStravaData(plan as Plan, todayISO()) : plan;
  const next = { profile, plan: swept, updatedAtISO: new Date().toISOString() };
  // baseVersion rides in the body (NOT a header — proxy.ts CORS only allows
  // Content-Type/Authorization). When present, write only if the client's copy
  // is current; on conflict return the server copy so the client can merge.
  const baseVersion = body.baseVersion;
  if (typeof baseVersion === "number" && Number.isInteger(baseVersion)) {
    const version = await store.setDataIf(uid, next, baseVersion);
    if (version === null) {
      const dv = await store.getDataV(uid);
      return NextResponse.json(
        { error: "conflict", state: dv?.state ?? {}, version: dv?.version ?? 0 },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, version });
  }
  // legacy blind write — old bundles (App Store review lag) send no baseVersion
  await store.setData(uid, next);
  return NextResponse.json({ ok: true });
}
