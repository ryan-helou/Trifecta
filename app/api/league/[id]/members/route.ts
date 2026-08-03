import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireMember } from "@/lib/league/guard";
import { MAX_MEMBERS } from "@/lib/league/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/league/[id]/members — the roster, for the manage-members sheet.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireMember(req, id);
  if (!g.ok) return g.res;
  return NextResponse.json({ members: await g.ctx.store.listLeagueMembers(id) });
}

// POST /api/league/[id]/members { username } — invite someone already on Trifecta.
// This does NOT add them: it creates a pending invitation they have to accept,
// because joining a league means exposing your training volume to its members and
// that has to be their call, not the inviter's.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireMember(req, id);
  if (!g.ok) return g.res;
  const { store, uid, league } = g.ctx;

  const body = (await req.json().catch(() => ({}))) as { username?: unknown };
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!username) return NextResponse.json({ error: "Who do you want to invite?" }, { status: 400 });

  const target = await store.getUserByUsername(username);
  // Same response whether or not the account exists — otherwise this endpoint
  // becomes a way to test which usernames are registered.
  const vague = NextResponse.json({ ok: true, invited: username });
  if (!target || target.id === uid) return vague;

  if (await store.getLeagueRole(id, target.id)) {
    return NextResponse.json({ error: `${target.username} is already in this league.` }, { status: 409 });
  }
  if (league.memberCount >= MAX_MEMBERS) {
    return NextResponse.json({ error: `A league tops out at ${MAX_MEMBERS} members.` }, { status: 409 });
  }

  await store.createLeagueInvite(id, target.id, uid);
  return vague;
}
