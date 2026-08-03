import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireMember } from "@/lib/league/guard";
import { generateInviteCode } from "@/lib/league/invite";
import { parseLeagueName } from "@/lib/league/validate";
import { mergeSettings } from "@/lib/league/types";
import { firstSeason, seasonByNumber, seasonFor } from "@/lib/league/season";
import { todayISO } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/league/[id]?today=YYYY-MM-DD&season=N
//
// One league's state: its members, and the activities for ONE season window —
// not every activity ever logged. The standalone app shipped the entire history
// to the client on the reasoning that five friends is a few kilobytes; that stops
// being true the moment anyone can start a league, so the window is explicit and
// the client knows exactly what it's holding. All-time views (titles, records)
// are computed server-side by ./titles instead of pulling the log down.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireMember(req, id);
  if (!g.ok) return g.res;
  const { store, league, uid } = g.ctx;

  const refDay = req.nextUrl.searchParams.get("today") || todayISO();
  const seasonStart = league.settings.seasonStart || league.createdAt.slice(0, 10);
  const current = seasonFor(refDay, seasonStart) ?? firstSeason(seasonStart);
  const asked = Number(req.nextUrl.searchParams.get("season"));
  const season =
    Number.isInteger(asked) && asked >= 1 && asked <= current.number ? seasonByNumber(asked, seasonStart) : current;

  const members = await store.listLeagueMembers(id);
  const activities = await store.listActivitiesForUsers(
    members.map((m) => m.userId),
    season.start,
    season.end,
  );

  return NextResponse.json({
    league,
    meId: uid,
    members,
    activities,
    season,
    seasonCount: current.number,
    window: { from: season.start, to: season.end },
  });
}

// PATCH /api/league/[id] { name?, settings?, rotateCode? } — admin only.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireAdmin(req, id);
  if (!g.ok) return g.res;
  const { store, league } = g.ctx;

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    settings?: unknown;
    rotateCode?: unknown;
  };

  const patch: { name?: string; settings?: ReturnType<typeof mergeSettings>; inviteCode?: string } = {};
  if (body.name !== undefined) {
    const name = parseLeagueName(body.name);
    if (!name) return NextResponse.json({ error: "That name won't work." }, { status: 400 });
    patch.name = name;
  }
  // Merged onto the CURRENT settings, so a partial edit can't silently reset the
  // rules the client didn't send.
  if (body.settings !== undefined) patch.settings = mergeSettings(body.settings, league.settings);
  if (body.rotateCode === true) patch.inviteCode = generateInviteCode();

  await store.updateLeague(id, patch);
  const updated = await store.getLeague(id);
  return NextResponse.json({ league: updated ? { ...updated, myRole: g.ctx.role } : null });
}

// DELETE /api/league/[id] — owner only. To leave a league you're not running,
// delete your own membership instead (DELETE ./members/[userId]).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireMember(req, id);
  if (!g.ok) return g.res;
  if (g.ctx.role !== "owner") {
    return NextResponse.json({ error: "Only the league owner can delete it." }, { status: 403 });
  }
  // Activities are user-scoped and survive — they're the athlete's own training
  // record, not the league's property, and they still score in any other league.
  await g.ctx.store.deleteLeague(id);
  return NextResponse.json({ ok: true });
}
