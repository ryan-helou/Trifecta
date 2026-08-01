import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/league/guard";
import { generateInviteCode } from "@/lib/league/invite";
import { MAX_LEAGUES_OWNED, parseLeagueName } from "@/lib/league/validate";
import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/league/types";
import { todayISO } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/league → every league the signed-in user belongs to, plus any pending
// invitations. This is the payload the League tab boots from; the heavy per-league
// state is a separate call so opening the app doesn't pull five leaderboards.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const { uid, store } = auth;

  const [leagues, invites] = await Promise.all([
    store.listLeaguesForUser(uid),
    store.listInvitesForUser(uid),
  ]);
  return NextResponse.json({ leagues, invites });
}

// POST /api/league { name, settings? } → create a league and join it as owner.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const { uid, store } = auth;

  const body = (await req.json().catch(() => ({}))) as { name?: unknown; settings?: unknown; today?: unknown };
  const name = parseLeagueName(body.name);
  if (!name) return NextResponse.json({ error: "Give your league a name." }, { status: 400 });

  if ((await store.countLeaguesOwned(uid)) >= MAX_LEAGUES_OWNED) {
    return NextResponse.json(
      { error: `You can run up to ${MAX_LEAGUES_OWNED} leagues. Delete one to start another.` },
      { status: 400 },
    );
  }

  // A league starts scoring the day it's created unless the creator picks a date.
  // Without a floor, connecting Strava would backfill three weeks of sessions into
  // a league that didn't exist yet — and whoever synced first would "win" a season
  // nobody had started.
  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : todayISO();
  const settings = mergeSettings(body.settings, { ...DEFAULT_SETTINGS, seasonStart: today });

  // Codes are unique; on the vanishingly unlikely collision, just try again.
  let league = null;
  for (let attempt = 0; attempt < 5 && !league; attempt++) {
    try {
      league = await store.createLeague(name, uid, settings, generateInviteCode());
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
  if (!league) return NextResponse.json({ error: "Couldn't create the league. Try again." }, { status: 500 });

  return NextResponse.json({ league }, { status: 201 });
}
