import { purgeExpiredStravaData } from "@/lib/stravaPrivacy";
import { todayISO } from "@/lib/dates";
import type { Plan } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const store = getStore();
  const dv = await store.getDataV(uid);
  return NextResponse.json({ state: dv?.state ?? {}, version: dv?.version ?? 0 });
}

// The whole blob is stored per user and re-read by the social feed, so validate
// shape and bound size — one user can't post arbitrary/unbounded state.
const MAX_STATE_BYTES = 512 * 1024;
const isObjOrNull = (v: unknown) => v === null || (typeof v === "object" && !Array.isArray(v));

export async function PUT(req: NextRequest) {
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
