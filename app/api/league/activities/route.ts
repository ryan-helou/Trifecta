import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/league/guard";
import { isSport, SPORT_UNIT } from "@/lib/league/types";
import { parseKm, parseNote } from "@/lib/league/validate";
import { isDayKey } from "@/lib/league/dates";
import { addDays, todayISO } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/league/activities { sport, km, occurredOn, note? }
//
// Hand-log a session. Note the path: activities are USER-scoped, not filed under
// a league, because one session scores in every league you're in. This is the
// escape hatch for what Strava can't see — a gym session, a pool swim off a
// watch — not a second way to complete a planned workout (that's the Log sheet
// on Today, which writes to the plan).
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const { uid, store } = auth;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (!isSport(body.sport)) return NextResponse.json({ error: "Pick a sport." }, { status: 400 });
  const sport = body.sport;

  // Gym is flat-scored: one log is one workout, whatever the client sends.
  const km = SPORT_UNIT[sport] === "flat" ? 1 : parseKm(body.km);
  if (km == null) return NextResponse.json({ error: "Enter a distance." }, { status: 400 });

  const occurredOn = typeof body.occurredOn === "string" ? body.occurredOn : "";
  if (!isDayKey(occurredOn)) return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });
  // A day of slack past "today" — the server's date can legitimately trail a
  // client that's a timezone ahead — but no logging next week's training now.
  if (occurredOn > addDays(todayISO(), 1)) {
    return NextResponse.json({ error: "You can't log a session in the future." }, { status: 400 });
  }

  const activity = await store.createActivity({
    userId: uid,
    sport,
    km,
    occurredOn,
    note: parseNote(body.note),
  });
  return NextResponse.json({ activity }, { status: 201 });
}
