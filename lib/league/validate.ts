import type { Sport } from "./types";

export const MAX_KM = 1000;
export const MAX_NOTE = 140;
export const MAX_LEAGUE_NAME = 40;
/** A league is a group of people who know each other, not a public arena. The cap
 *  keeps the client-side scoring model honest (the whole member set is held in
 *  memory and re-scored on every render) and keeps a leaderboard readable. */
export const MAX_MEMBERS = 50;
/** Guard rail on how many leagues one person can run, so a script can't fill the
 *  table by hammering POST /api/league. */
export const MAX_LEAGUES_OWNED = 10;

/**
 * Distances past this get a "that's a big one — sure?" confirm before they save.
 * Set around the top of what's plausible in one session, not what's impossible:
 * the point is to catch a fat-fingered 1000 instead of 100, not to call anyone a
 * liar. Gym has no distance, so it has no threshold.
 */
export const BIG_SESSION_KM: Record<Sport, number> = {
  swim: 5,
  bike: 200,
  run: 42,
  gym: Infinity,
};

export function parseKm(value: unknown): number | null {
  const km = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(km) || km <= 0 || km > MAX_KM) return null;
  return Math.round(km * 1000) / 1000; // metre precision is plenty
}

export function parseNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const note = value.trim().slice(0, MAX_NOTE);
  return note || null;
}

export function parseLeagueName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").slice(0, MAX_LEAGUE_NAME);
  return name || null;
}
