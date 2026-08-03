import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/league/guard";
import { canEditRules, type LeagueRole } from "@/lib/league/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/league/[id]/members/[userId] — leave the league (yourself), or
// remove someone (admin). The owner can't be removed and can't walk away from a
// league they still run: they hand it over or delete it, so a league is never
// left ownerless.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  const g = await requireMember(req, id);
  if (!g.ok) return g.res;
  const { store, uid, role, league } = g.ctx;

  const isSelf = userId === uid;
  if (!isSelf && !canEditRules(role)) {
    return NextResponse.json({ error: "Only a league admin can remove members." }, { status: 403 });
  }
  if (userId === league.ownerId) {
    return NextResponse.json(
      { error: isSelf ? "Hand the league over or delete it first." : "You can't remove the owner." },
      { status: 403 },
    );
  }
  // An admin outranks members but not other admins — otherwise two admins can
  // remove each other and it's a race.
  if (!isSelf && role === "admin") {
    const targetRole = await store.getLeagueRole(id, userId);
    if (targetRole && canEditRules(targetRole)) {
      return NextResponse.json({ error: "Only the owner can remove another admin." }, { status: 403 });
    }
  }

  await store.removeLeagueMember(id, userId);
  // Their activities stay — they're the athlete's own log, and they simply stop
  // being counted here (standingsForRange only scores current members).
  return NextResponse.json({ ok: true });
}

// PATCH /api/league/[id]/members/[userId] { role } — owner only. Promote a member
// to admin (so they can edit the rules) or demote them back.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  const g = await requireMember(req, id);
  if (!g.ok) return g.res;
  const { store, role, league } = g.ctx;

  if (role !== "owner") {
    return NextResponse.json({ error: "Only the league owner can change roles." }, { status: 403 });
  }
  if (userId === league.ownerId) {
    return NextResponse.json({ error: "The owner's role is fixed." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { role?: unknown };
  const next = body.role as LeagueRole;
  if (next !== "admin" && next !== "member") {
    return NextResponse.json({ error: "Role must be admin or member." }, { status: 400 });
  }
  if (!(await store.getLeagueRole(id, userId))) {
    return NextResponse.json({ error: "They're not in this league." }, { status: 404 });
  }

  await store.setLeagueRole(id, userId, next);
  return NextResponse.json({ ok: true, members: await store.listLeagueMembers(id) });
}
