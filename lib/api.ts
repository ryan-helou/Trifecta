import { Plan, Profile } from "./types";
import { API_BASE, IS_NATIVE } from "./runtime";
import { getTokenSync } from "./tokenStore";

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

export async function apiMe(): Promise<MeResponse> {
  const { data } = await jsonFetch("/api/auth/me");
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
export async function apiIntake(text: string) {
  const { data } = await jsonFetch("/api/intake", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  return data as { enabled?: boolean; injuries?: ParsedInjury[] };
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
  const { ok, data } = await jsonFetch("/api/strava/sync", { method: "POST" });
  return { ok, ...(data as { scanned?: number; matched?: number; error?: string }) };
}

export async function apiStravaDisconnect() {
  return jsonFetch("/api/strava/status", { method: "DELETE" });
}

// ---- social ----

import type { SocialPayload } from "./social";

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
