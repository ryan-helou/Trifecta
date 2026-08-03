import { NextRequest, NextResponse } from "next/server";
import { getStore, type Store } from "../db";
import { getUserIdFromRequest } from "../auth-server";
import type { League, LeagueRole } from "./types";
import { canEditRules } from "./types";

/**
 * Every league endpoint answers the same three questions before it does anything:
 * who is calling, does the league exist, and are they in it. Centralised here so a
 * new route can't accidentally ship without the membership check — the whole
 * privacy model of the feature is "only members can see a league's data."
 */

export interface LeagueContext {
  uid: string;
  store: Store;
  league: League;
  role: LeagueRole;
}

type Guarded = { ok: true; ctx: LeagueContext } | { ok: false; res: NextResponse };

export async function requireUser(req: NextRequest): Promise<{ ok: true; uid: string; store: Store } | { ok: false; res: NextResponse }> {
  const uid = await getUserIdFromRequest(req);
  if (!uid) return { ok: false, res: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  return { ok: true, uid, store: getStore() };
}

/** Signed in AND a member of this league. A non-member gets 404, not 403 — a
 *  league's existence is itself private, so probing ids shouldn't tell you which
 *  ones are real. */
export async function requireMember(req: NextRequest, leagueId: string): Promise<Guarded> {
  const auth = await requireUser(req);
  if (!auth.ok) return { ok: false, res: auth.res };
  const { uid, store } = auth;

  const league = await store.getLeague(leagueId);
  const role = league ? await store.getLeagueRole(leagueId, uid) : null;
  if (!league || !role) {
    return { ok: false, res: NextResponse.json({ error: "League not found." }, { status: 404 }) };
  }
  return { ok: true, ctx: { uid, store, league: { ...league, myRole: role }, role } };
}

/** Member, and allowed to change the league's rules (owner or admin). */
export async function requireAdmin(req: NextRequest, leagueId: string): Promise<Guarded> {
  const g = await requireMember(req, leagueId);
  if (!g.ok) return g;
  if (!canEditRules(g.ctx.role)) {
    return { ok: false, res: NextResponse.json({ error: "Only a league admin can do that." }, { status: 403 }) };
  }
  return g;
}
