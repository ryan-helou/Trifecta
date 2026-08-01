import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/league/guard";
import { badgesFor, monthlyChampions, weekWinsBoard } from "@/lib/league/achievements";
import { seasonChampions } from "@/lib/league/season";
import { hallOfFame } from "@/lib/league/records";
import { todayISO } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/league/[id]/titles?today=YYYY-MM-DD
//
// The all-time views — season champions, weekly-win tallies, monthly champions,
// the hall of fame, and the caller's own badge progress. These genuinely need the
// full history, so the reduction happens HERE rather than by shipping years of
// activity rows to a phone: the response is a fixed handful of summaries whose
// size doesn't grow with how long the league has been running.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireMember(req, id);
  if (!g.ok) return g.res;
  const { store, league, uid } = g.ctx;

  const refDay = req.nextUrl.searchParams.get("today") || todayISO();
  const members = await store.listLeagueMembers(id);
  const activities = await store.listActivitiesForUsers(
    members.map((m) => m.userId),
    "0000-01-01",
    "9999-12-31",
  );
  const settings = league.settings;

  return NextResponse.json({
    seasons: seasonChampions(members, activities, settings, refDay),
    weekWins: weekWinsBoard(members, activities, settings, refDay),
    months: monthlyChampions(members, activities, settings, refDay),
    records: hallOfFame(activities, settings),
    badges: badgesFor(uid, members, activities, settings, refDay),
  });
}
