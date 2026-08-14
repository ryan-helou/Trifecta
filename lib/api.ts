import { Plan, Profile } from "./types";
import { API_BASE, IS_NATIVE } from "./runtime";
import { getTokenSync } from "./tokenStore";
import type {
  League,
  LeagueActivity,
  LeagueInvite,
  LeagueMember,
  LeagueSettings,
  LeagueStatePayload,
  Sport,
} from "./league/types";
import type { Badge, MonthChampion, WinRow } from "./league/achievements";
import type { SeasonChampion } from "./league/season";
import type { HallRecord } from "./league/records";

/** What GET /api/league/[id]/titles returns — the all-time views, already
 *  reduced server-side so the payload doesn't grow with league history. */
export interface TitlesPayload {
  seasons: SeasonChampion[];
  weekWins: WinRow[];
  months: MonthChampion[];
  records: HallRecord[];
  badges: Badge[];
}

// Client-side fetch wrappers for the API routes.
//
// Web PWA: relative URLs + same-origin httpOnly cookie.
// Native (bundled) app: absolute URL to the Railway API + Bearer token, no cookies.

async function jsonFetch(url: string, opts?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((opts?.headers as Record<string, string>) ?? {}),
  };
  if (IS_NATIVE) {
    const token = getTokenSync();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  // Hard timeout so a stalled WebView fetch can never hang the UI forever —
  // except keepalive sends (page is going away; aborting defeats the purpose).
  const controller = opts?.keepalive ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;
  try {
    const res = await fetch(API_BASE + url, {
      ...opts,
      headers,
      credentials: IS_NATIVE ? "omit" : "same-origin",
      ...(controller ? { signal: controller.signal } : {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    // Never throw — surface a readable error so the UI shows it instead of hanging.
    const msg = e instanceof Error ? (e.name === "AbortError" ? "request timed out" : e.message) : String(e);
    return { ok: false, status: 0, data: { error: `Can't reach the server (${msg}).` } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface MeResponse {
  authenticated: boolean;
  user?: { username: string };
  state?: { profile?: Profile; plan?: Plan };
  /** optimistic-concurrency version of `state` — echo as baseVersion on saves */
  version?: number;
}

/** Thrown when the request never completed — no server answer, of any kind. */
export class OfflineError extends Error {
  constructor() {
    super("offline");
    this.name = "OfflineError";
  }
}

export async function apiMe(): Promise<MeResponse> {
  const { status, data } = await jsonFetch("/api/auth/me");
  // "I couldn't reach the server" is NOT the same answer as "you're not signed in",
  // and this is the one call where confusing them costs the athlete their app.
  //
  // jsonFetch never throws by design (a hung WebView must not hang the UI), so a
  // dead network arrived here as `{ error: ... }` — `authenticated` undefined,
  // therefore falsy, therefore indistinguishable from a genuine logged-out reply.
  // Both callers in AppProvider are already written for the truth: boot falls back
  // to the cached plan inside `catch`, and `refresh` raises the offline banner
  // there. Neither catch could ever run, so launching with no signal put a signed-in
  // athlete on the WELCOME screen with their plan sitting unread in localStorage —
  // and finishing a run somewhere without coverage meant there was nothing to log
  // it into. Restore the signal those handlers are waiting for; `status === 0` is
  // the sentinel jsonFetch sets when the request never completed.
  if (status === 0) throw new OfflineError();
  return data as MeResponse;
}

export async function apiSignup(username: string, password: string) {
  return jsonFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function apiLogin(username: string, password: string) {
  return jsonFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function apiLogout() {
  return jsonFetch("/api/auth/logout", { method: "POST" });
}

export async function apiDeleteAccount() {
  return jsonFetch("/api/account", { method: "DELETE" });
}

export interface SaveStateResult {
  ok: boolean;
  status: number;
  /** new version after a successful CAS save */
  version?: number;
  /** the server's current copy, returned with a 409 so the caller can merge + retry */
  serverState?: { profile?: Profile; plan?: Plan };
  serverVersion?: number;
}

export async function apiSaveState(
  profile: Profile | null,
  plan: Plan | null,
  opts?: { baseVersion?: number; keepalive?: boolean },
): Promise<SaveStateResult> {
  // baseVersion rides in the body — proxy.ts CORS doesn't allow custom headers
  const body: Record<string, unknown> = { profile, plan };
  if (opts?.baseVersion != null) body.baseVersion = opts.baseVersion;
  const { ok, status, data } = await jsonFetch("/api/state", {
    method: "PUT",
    body: JSON.stringify(body),
    keepalive: opts?.keepalive,
  });
  const d = data as { version?: number; state?: { profile?: Profile; plan?: Plan } };
  return {
    ok,
    status,
    version: ok && typeof d.version === "number" ? d.version : undefined,
    serverState: status === 409 ? d.state : undefined,
    serverVersion: status === 409 && typeof d.version === "number" ? d.version : undefined,
  };
}

// ---- read-only API keys (lib/apiKeys.ts) ----
//
// Note there is no client helper that *uses* a key. These three manage keys from
// inside the signed-in app; the keys themselves are for OTHER apps, which talk to
// the API directly with `Authorization: Bearer tri_…`.

/** A key as the athlete sees it afterwards — everything except the key. */
export interface ApiKeyInfo {
  id: string;
  name: string;
  scope: "read";
  createdAtISO: string;
  lastUsedAtISO?: string;
  revokedAtISO?: string;
}

export async function apiListTokens(): Promise<{ ok: boolean; keys: ApiKeyInfo[] }> {
  const { ok, data } = await jsonFetch("/api/tokens");
  return { ok, keys: ok ? ((data as { keys?: ApiKeyInfo[] }).keys ?? []) : [] };
}

/** Mint a key. `key` is the plaintext and comes back exactly once — if the caller
 *  drops it, it is gone, and the only remedy is to revoke and mint again. */
export async function apiCreateToken(name: string): Promise<{ ok: boolean; key?: string; error?: string }> {
  const { ok, data } = await jsonFetch("/api/tokens", { method: "POST", body: JSON.stringify({ name }) });
  const d = data as { key?: string; error?: string };
  return ok ? { ok: true, key: d.key } : { ok: false, error: d.error || "Couldn't create the key." };
}

export async function apiRevokeToken(id: string): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await jsonFetch(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
  return ok ? { ok: true } : { ok: false, error: (data as { error?: string }).error || "Couldn't revoke the key." };
}

export async function apiCoach(context: string, question: string) {
  const { data } = await jsonFetch("/api/coach", {
    method: "POST",
    body: JSON.stringify({ context, question }),
  });
  return data as { enabled?: boolean; text?: string; provider?: string };
}

export interface ParsedInjury {
  area: string;
  disciplines: string[];
  severity: string;
  note?: string;
}

/** Ask the cheap AI to turn free-text injury notes into structured constraints. */
/** `consent` is the athlete's explicit, unbundled permission to send this health text
 *  to the AI provider. The server refuses the LLM step without it and falls back to the
 *  on-device red-flag triage, so passing it is a deliberate act, never a default. */
export async function apiIntake(text: string, consent: boolean) {
  const { data } = await jsonFetch("/api/intake", {
    method: "POST",
    body: JSON.stringify({ text, consent }),
  });
  return data as { available?: boolean; enabled?: boolean; injuries?: ParsedInjury[] };
}

/** Ask the cheap AI for a short "why this plan" note plus per-phase coaching notes. */
export async function apiPlanSummary(context: string) {
  const { data } = await jsonFetch("/api/plan-summary", {
    method: "POST",
    body: JSON.stringify({ context }),
  });
  return data as { enabled?: boolean; text?: string; phases?: Record<string, string> };
}

// ---- Strava device sync ----

export interface StravaStatus {
  connected: boolean;
  configured: boolean;
  athleteId?: number | null;
  lastSyncAtISO?: string | null;
}

export async function apiStravaStatus(): Promise<StravaStatus> {
  const { data } = await jsonFetch("/api/strava/status");
  return data as StravaStatus;
}

export async function apiStravaSync() {
  const { ok, status, data } = await jsonFetch("/api/strava/sync", { method: "POST" });
  return {
    ok,
    /** Surfaced so a caller can tell "you never connected Strava" (400) from "the
     *  network blipped" (0/5xx). The auto-sync poll stops for good on the former and
     *  retries on the latter — without it, every athlete who has never connected
     *  Strava is polled on a timer forever on behalf of a feature they don't use. */
    status,
    ...(data as {
      scanned?: number;
      matched?: number;
      error?: string;
      /** the plan the sync just wrote — applied directly so no reload is needed (#191) */
      state?: { profile?: Profile; plan?: Plan } | null;
    }),
  };
}

export async function apiStravaDisconnect() {
  return jsonFetch("/api/strava/status", { method: "DELETE" });
}

// ---- social ----

import type { FeedComment, SocialPayload } from "./social";

export async function apiSocial(today: string): Promise<SocialPayload | null> {
  const { ok, data } = await jsonFetch(`/api/social?today=${encodeURIComponent(today)}`);
  return ok ? (data as SocialPayload) : null;
}

export async function apiFollow(username: string, on: boolean) {
  const { ok, data } = await jsonFetch("/api/social/follow", {
    method: on ? "POST" : "DELETE",
    body: JSON.stringify({ username }),
  });
  return { ok, ...(data as { error?: string; following?: boolean }) };
}

export async function apiKudos(ownerUsername: string, workoutId: string, on: boolean) {
  const { ok, data } = await jsonFetch("/api/social/kudos", {
    method: "POST",
    body: JSON.stringify({ ownerUsername, workoutId, on }),
  });
  return { ok, ...(data as { error?: string; on?: boolean; kudos?: number }) };
}

export async function apiComment(ownerUsername: string, workoutId: string, text: string) {
  const { ok, data } = await jsonFetch("/api/social/comments", {
    method: "POST",
    body: JSON.stringify({ ownerUsername, workoutId, text }),
  });
  return { ok, ...(data as { error?: string; comment?: FeedComment }) };
}

export async function apiDeleteComment(id: string) {
  const { ok, data } = await jsonFetch("/api/social/comments", {
    method: "DELETE",
    body: JSON.stringify({ id }),
  });
  return { ok, ...(data as { error?: string }) };
}

/** Block, unblock, or report-and-block another athlete (#183 / guideline 1.2). */
export async function apiModerate(action: "block" | "unblock" | "report", username: string, opts?: { commentId?: string; reason?: string }) {
  const { ok, data } = await jsonFetch("/api/social/moderate", {
    method: "POST",
    body: JSON.stringify({ action, username, ...opts }),
  });
  return { ok, ...(data as { error?: string; blocked?: boolean; reported?: boolean }) };
}

export interface NotificationsPayload {
  notifications: { id: string; kind: "kudos" | "comment"; actorUsername: string; workoutId: string; text?: string; atISO: string; readAtISO?: string }[];
  unread: number;
  /** false while APNs is unprovisioned — the UI must not promise delivery it can't make */
  pushEnabled: boolean;
}

export async function apiNotifications(): Promise<NotificationsPayload | null> {
  const { ok, data } = await jsonFetch("/api/notifications");
  return ok ? (data as NotificationsPayload) : null;
}

export async function apiMarkNotificationsRead(throughISO: string) {
  const { ok } = await jsonFetch("/api/notifications", {
    method: "POST",
    body: JSON.stringify({ action: "read", throughISO }),
  });
  return ok;
}

// ---- leagues ----

export async function apiLeagues(): Promise<{ leagues: League[]; invites: LeagueInvite[] } | null> {
  const { ok, data } = await jsonFetch("/api/league");
  return ok ? (data as { leagues: League[]; invites: LeagueInvite[] }) : null;
}

export async function apiCreateLeague(name: string, today: string) {
  const { ok, data } = await jsonFetch("/api/league", {
    method: "POST",
    body: JSON.stringify({ name, today }),
  });
  return { ok, ...(data as { error?: string; league?: League }) };
}

export async function apiLeagueState(
  leagueId: string,
  today: string,
  season?: number,
): Promise<LeagueStatePayload | null> {
  const q = new URLSearchParams({ today });
  if (season) q.set("season", String(season));
  const { ok, data } = await jsonFetch(`/api/league/${encodeURIComponent(leagueId)}?${q}`);
  return ok ? (data as LeagueStatePayload) : null;
}

export async function apiLeagueTitles(leagueId: string, today: string): Promise<TitlesPayload | null> {
  const { ok, data } = await jsonFetch(
    `/api/league/${encodeURIComponent(leagueId)}/titles?today=${encodeURIComponent(today)}`,
  );
  return ok ? (data as TitlesPayload) : null;
}

export async function apiUpdateLeague(
  leagueId: string,
  patch: { name?: string; settings?: Partial<LeagueSettings>; rotateCode?: boolean },
) {
  const { ok, data } = await jsonFetch(`/api/league/${encodeURIComponent(leagueId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return { ok, ...(data as { error?: string; league?: League }) };
}

export async function apiDeleteLeague(leagueId: string) {
  const { ok, data } = await jsonFetch(`/api/league/${encodeURIComponent(leagueId)}`, { method: "DELETE" });
  return { ok, ...(data as { error?: string }) };
}

export async function apiJoinLeague(code: string) {
  const { ok, data } = await jsonFetch("/api/league/join", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  return { ok, ...(data as { error?: string; league?: League; already?: boolean }) };
}

export async function apiInviteToLeague(leagueId: string, username: string) {
  const { ok, data } = await jsonFetch(`/api/league/${encodeURIComponent(leagueId)}/members`, {
    method: "POST",
    body: JSON.stringify({ username }),
  });
  return { ok, ...(data as { error?: string; invited?: string }) };
}

export async function apiAnswerInvite(inviteId: string, accept: boolean) {
  const { ok, data } = await jsonFetch(`/api/league/invites/${encodeURIComponent(inviteId)}`, {
    method: "POST",
    body: JSON.stringify({ accept }),
  });
  return { ok, ...(data as { error?: string; joined?: boolean; league?: League }) };
}

export async function apiRemoveMember(leagueId: string, userId: string) {
  const { ok, data } = await jsonFetch(
    `/api/league/${encodeURIComponent(leagueId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
  return { ok, ...(data as { error?: string }) };
}

export async function apiSetMemberRole(leagueId: string, userId: string, role: "admin" | "member") {
  const { ok, data } = await jsonFetch(
    `/api/league/${encodeURIComponent(leagueId)}/members/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
  return { ok, ...(data as { error?: string; members?: LeagueMember[] }) };
}

export async function apiLogActivity(input: {
  sport: Sport;
  km: number;
  occurredOn: string;
  note?: string | null;
}) {
  const { ok, data } = await jsonFetch("/api/league/activities", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return { ok, ...(data as { error?: string; activity?: LeagueActivity }) };
}

export async function apiUpdateActivity(
  activityId: string,
  patch: { sport?: Sport; km?: number; occurredOn?: string; note?: string | null },
) {
  const { ok, data } = await jsonFetch(`/api/league/activities/${encodeURIComponent(activityId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return { ok, ...(data as { error?: string; activity?: LeagueActivity }) };
}

export async function apiDeleteActivity(activityId: string) {
  const { ok, data } = await jsonFetch(`/api/league/activities/${encodeURIComponent(activityId)}`, {
    method: "DELETE",
  });
  return { ok, ...(data as { error?: string }) };
}

/** Ship a batch of product events. Fire-and-forget by contract: callers never
 *  await it for correctness, and it must never throw (jsonFetch already doesn't). */
export async function apiTrack(
  events: { name: string; props?: Record<string, unknown>; atISO: string }[],
  opts?: { keepalive?: boolean },
): Promise<{ ok: boolean; status: number }> {
  const { ok, status } = await jsonFetch("/api/events", {
    method: "POST",
    body: JSON.stringify({ events }),
    keepalive: opts?.keepalive,
  });
  return { ok, status };
}
