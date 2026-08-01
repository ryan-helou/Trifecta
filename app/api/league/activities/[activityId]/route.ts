import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/league/guard";
import { isSport, SPORT_UNIT } from "@/lib/league/types";
import { parseKm, parseNote } from "@/lib/league/validate";
import { isDayKey } from "@/lib/league/dates";
import { addDays, todayISO } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your own activity, or a 404. An activity is the athlete's training record —
 *  league admins set the rules, they don't edit other people's logs. */
async function own(req: NextRequest, activityId: string) {
  const auth = await requireUser(req);
  if (!auth.ok) return { ok: false as const, res: auth.res };
  const activity = await auth.store.getActivity(activityId);
  if (!activity || activity.userId !== auth.uid) {
    return { ok: false as const, res: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { ok: true as const, store: auth.store, activity };
}

// PATCH /api/league/activities/[activityId] — fix a hand-logged session.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params;
  const g = await own(req, activityId);
  if (!g.ok) return g.res;

  // Strava-sourced rows are a mirror of what's upstream: editing one here would
  // be silently undone by the next sync, so send people to Strava instead.
  if (g.activity.source === "strava") {
    return NextResponse.json({ error: "Edit this one on Strava — it syncs from there." }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: { sport?: typeof g.activity.sport; km?: number; occurredOn?: string; note?: string | null } = {};

  if (body.sport !== undefined) {
    if (!isSport(body.sport)) return NextResponse.json({ error: "Pick a sport." }, { status: 400 });
    patch.sport = body.sport;
  }
  const sport = patch.sport ?? g.activity.sport;
  if (SPORT_UNIT[sport] === "flat") {
    patch.km = 1; // switching to gym re-flattens the quantity
  } else if (body.km !== undefined) {
    const km = parseKm(body.km);
    if (km == null) return NextResponse.json({ error: "Enter a distance." }, { status: 400 });
    patch.km = km;
  } else if (SPORT_UNIT[g.activity.sport] === "flat") {
    // gym → a distance sport, but no distance sent: there's nothing to score
    return NextResponse.json({ error: "Enter a distance." }, { status: 400 });
  }

  if (body.occurredOn !== undefined) {
    const day = typeof body.occurredOn === "string" ? body.occurredOn : "";
    if (!isDayKey(day)) return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });
    if (day > addDays(todayISO(), 1)) {
      return NextResponse.json({ error: "You can't log a session in the future." }, { status: 400 });
    }
    patch.occurredOn = day;
  }
  if (body.note !== undefined) patch.note = parseNote(body.note);

  const activity = await g.store.updateActivity(activityId, patch);
  return NextResponse.json({ activity });
}

// DELETE /api/league/activities/[activityId]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params;
  const g = await own(req, activityId);
  if (!g.ok) return g.res;
  await g.store.deleteActivity(activityId);
  return NextResponse.json({ ok: true });
}
