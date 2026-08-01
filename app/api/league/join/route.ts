import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/league/guard";
import { normalizeInviteCode } from "@/lib/league/invite";
import { MAX_MEMBERS } from "@/lib/league/validate";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/league/join { code } — join by invite code.
//
// Rate limited hard: a six-character code is a convenience, not a secret, and
// without a limit this endpoint is an oracle for enumerating every league on the
// platform. Capped per account AND per IP so neither a single logged-in scripter
// nor a pool of throwaway accounts can sweep the space.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const { uid, store } = auth;

  const tooMany =
    !rateLimit(`league-join:user:${uid}`, 10, 60 * 60_000).ok ||
    !rateLimit(`league-join:ip:${clientIp(req)}`, 30, 60 * 60_000).ok;
  if (tooMany) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const code = normalizeInviteCode(body.code);
  if (!code) return NextResponse.json({ error: "That doesn't look like a join code." }, { status: 400 });

  const league = await store.getLeagueByInviteCode(code);
  if (!league) return NextResponse.json({ error: "No league with that code." }, { status: 404 });

  const existing = await store.getLeagueRole(league.id, uid);
  if (existing) return NextResponse.json({ league: { ...league, myRole: existing }, already: true });

  if (league.memberCount >= MAX_MEMBERS) {
    return NextResponse.json({ error: "That league is full." }, { status: 409 });
  }

  await store.addLeagueMember(league.id, uid, "member");
  const joined = await store.getLeague(league.id);
  return NextResponse.json({ league: joined ? { ...joined, myRole: "member" } : null });
}
