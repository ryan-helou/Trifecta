import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/league/guard";
import { MAX_MEMBERS } from "@/lib/league/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/league/invites/[inviteId] { accept: boolean } — answer an invitation.
// Accepting is what actually adds you to the league, and it's the point where you
// agree to share your training volume with its members.
export async function POST(req: NextRequest, { params }: { params: Promise<{ inviteId: string }> }) {
  const { inviteId } = await params;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const { uid, store } = auth;

  const invite = await store.getLeagueInvite(inviteId);
  // Only the person invited can answer it — and a stranger shouldn't learn that
  // the invite exists at all.
  if (!invite || invite.invitedUserId !== uid) {
    return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  }
  if (invite.status !== "pending") {
    return NextResponse.json({ error: "That invitation was already answered." }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { accept?: unknown };
  if (body.accept !== true) {
    await store.respondToInvite(inviteId, "declined");
    return NextResponse.json({ ok: true, joined: false });
  }

  const league = await store.getLeague(invite.leagueId);
  if (!league) return NextResponse.json({ error: "That league is gone." }, { status: 404 });
  if (league.memberCount >= MAX_MEMBERS) {
    return NextResponse.json({ error: "That league is full." }, { status: 409 });
  }

  await store.addLeagueMember(invite.leagueId, uid, "member");
  await store.respondToInvite(inviteId, "accepted");
  return NextResponse.json({ ok: true, joined: true, league: { ...league, myRole: "member" } });
}
