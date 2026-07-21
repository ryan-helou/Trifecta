import { Plan, Profile } from "./types";

// Client-side fetch wrappers for the API routes.

async function jsonFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export interface MeResponse {
  authenticated: boolean;
  user?: { username: string };
  state?: { profile?: Profile; plan?: Plan };
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

export async function apiSaveState(profile: Profile | null, plan: Plan | null) {
  return jsonFetch("/api/state", {
    method: "PUT",
    body: JSON.stringify({ profile, plan }),
  });
}

export async function apiCoach(context: string, question: string) {
  const { data } = await jsonFetch("/api/coach", {
    method: "POST",
    body: JSON.stringify({ context, question }),
  });
  return data as { enabled?: boolean; text?: string };
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

/** Ask the cheap AI for a short "why this plan" note. */
export async function apiPlanSummary(context: string) {
  const { data } = await jsonFetch("/api/plan-summary", {
    method: "POST",
    body: JSON.stringify({ context }),
  });
  return data as { enabled?: boolean; text?: string };
}
