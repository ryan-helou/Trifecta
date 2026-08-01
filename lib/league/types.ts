// ---------------------------------------------------------------------------
// League — a points competition between Trifecta athletes. Ported from the
// standalone AmaComp app, re-parameterized so any user can run their own league
// with their own rules instead of there being one implicit global competition.
//
// The load-bearing decision: an *activity* belongs to a user, not to a league.
// "Ryan ran 10 km on Aug 3" is a fact about Ryan — one row, however many leagues
// he's in. Each *league* owns its own multipliers, so the same run scores
// differently in a run-weighted league than in a balanced one.
// ---------------------------------------------------------------------------

export const SPORTS = ["swim", "bike", "run", "gym"] as const;
export type Sport = (typeof SPORTS)[number];

export function isSport(v: unknown): v is Sport {
  return typeof v === "string" && (SPORTS as readonly string[]).includes(v);
}

/**
 * Swim/bike/run are scored by distance. Gym is flat — one logged workout is
 * worth a fixed number of points, no distance or duration. The stored quantity
 * for a gym log is always 1 (a workout count), so scoring stays generic:
 * points = quantity × multiplier.
 */
export type Unit = "km" | "flat";

export const SPORT_UNIT: Record<Sport, Unit> = {
  swim: "km",
  bike: "km",
  run: "km",
  gym: "flat",
};

export const UNIT_LABEL: Record<Unit, string> = { km: "km", flat: "workout" };
export const UNIT_ABBR: Record<Unit, string> = { km: "km", flat: "ea" };

export const SPORT_LABEL: Record<Sport, string> = {
  swim: "Swim",
  bike: "Bike",
  run: "Run",
  gym: "Gym",
};

/** Compact rate label — "25/km" for distance, "30/ea" for a flat per-workout value. */
export function rateLabel(multiplier: number, unit: Unit): string {
  return `${multiplier}/${UNIT_ABBR[unit]}`;
}

/** Trifecta's disciplines mapped onto the four scored sports. `brick` and `rest`
 *  return null — a brick arrives from Strava as two separate activities (a ride
 *  and a run) which each score on their own, and rest isn't a session. */
export function sportFromDiscipline(d: string): Sport | null {
  if (d === "swim" || d === "bike" || d === "run") return d;
  if (d === "strength") return "gym";
  return null;
}

// ---- membership ----

export type LeagueRole = "owner" | "admin" | "member";

export interface LeagueMember {
  userId: string;
  username: string;
  role: LeagueRole;
  joinedAt: string;
}

export function canEditRules(role: LeagueRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

// ---- the league itself ----

export interface LeagueSettings {
  /** Points per km for distance sports; points per workout for gym. */
  multipliers: Record<Sport, number>;
  /** Points every member is expected to hit each week. */
  weeklyGoal: number;
  /** The league only counts sessions on/after this local day (`YYYY-MM-DD`). */
  seasonStart: string;
  /** What the weekly loser owes — shown wherever the stakes come up. Optional:
   *  plenty of leagues just want a leaderboard, with nothing riding on it. */
  forfeit: string;
  /**
   * Gym is the one flat-scored discipline, so N logs = N × the gym multiplier
   * with nothing to bound it. Past this many gym workouts in a day the extras
   * still get logged — they're a real record of the session — they just stop
   * scoring. A house rule, so it lives per-league rather than as a constant.
   */
  maxScoringGymPerDay: number;
}

export const DEFAULT_SETTINGS: LeagueSettings = {
  multipliers: { swim: 25, bike: 1, run: 5, gym: 30 },
  weeklyGoal: 100,
  seasonStart: "",
  forfeit: "",
  maxScoringGymPerDay: 2,
};

export interface League {
  id: string;
  name: string;
  ownerId: string;
  /** Shareable join code. Rotatable — see rotateInviteCode. */
  inviteCode: string;
  settings: LeagueSettings;
  createdAt: string;
  memberCount: number;
  /** The signed-in user's role in this league, when the payload is user-scoped. */
  myRole?: LeagueRole;
}

/** Server-side validation of a settings payload. The client can send anything;
 *  this is what decides what a league's rules may actually be. */
export function mergeSettings(raw: unknown, base: LeagueSettings = DEFAULT_SETTINGS): LeagueSettings {
  const value = (raw ?? {}) as Partial<LeagueSettings>;
  const m = (value.multipliers ?? {}) as Partial<Record<Sport, number>>;
  const num = (v: unknown, fallback: number, max = 10_000) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : fallback;
  const isDay = (v: unknown): v is string =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  return {
    multipliers: {
      swim: num(m.swim, base.multipliers.swim),
      bike: num(m.bike, base.multipliers.bike),
      run: num(m.run, base.multipliers.run),
      gym: num(m.gym, base.multipliers.gym),
    },
    weeklyGoal: num(value.weeklyGoal, base.weeklyGoal, 1_000_000),
    seasonStart: isDay(value.seasonStart) ? value.seasonStart : base.seasonStart,
    forfeit:
      typeof value.forfeit === "string" ? value.forfeit.trim().slice(0, 120) : base.forfeit,
    // 1–20: zero would mean gym never scores (use a 0 multiplier for that instead),
    // and past 20 the cap isn't doing anything.
    maxScoringGymPerDay: Math.round(num(value.maxScoringGymPerDay, base.maxScoringGymPerDay, 20)) || base.maxScoringGymPerDay,
  };
}

// ---- activities ----

/** Where an activity came from — hand-logged in the app, or pulled in from Strava
 *  by the same ingest that completes planned workouts. */
export type ActivitySource = "manual" | "strava";

export interface LeagueActivity {
  id: string;
  userId: string;
  sport: Sport;
  /** Kilometres for distance sports; always 1 for a flat gym workout. See SPORT_UNIT. */
  km: number;
  /** Local calendar date, `YYYY-MM-DD`. Deliberately date-only: no timezone maths. */
  occurredOn: string;
  note: string | null;
  source: ActivitySource;
  /** Set for Strava-sourced rows, so an activity can only ever be imported once. */
  stravaId: number | null;
  createdAt: string;
}

// ---- invites ----

export type InviteStatus = "pending" | "accepted" | "declined";

export interface LeagueInvite {
  id: string;
  leagueId: string;
  leagueName: string;
  invitedUserId: string;
  invitedBy: string;
  invitedByUsername: string;
  status: InviteStatus;
  createdAt: string;
}

// ---- the wire payload ----

/** One league's state for the client. Scoped to a single league and windowed to a
 *  season — the standalone app shipped every athlete and every activity ever on
 *  the reasoning that five friends is a few kilobytes, which stops being true the
 *  moment anyone can start a league. All-time views come from the titles endpoint,
 *  already reduced to summaries, rather than by pulling the whole log down. */
export interface LeagueStatePayload {
  league: League;
  /** The caller's own user id. Sent explicitly so the client can pick its row out
   *  of the standings without a second round trip to resolve who it is. */
  meId: string;
  members: LeagueMember[];
  activities: LeagueActivity[];
  season: SeasonWindow;
  /** How many seasons exist so far, so the client can offer a season picker. */
  seasonCount: number;
  /** The window `activities` covers, so the client knows not to render older
   *  seasons from a payload that never contained them. */
  window: { from: string; to: string };
}

/** Mirrors SeasonInfo from ./season — declared here so the wire payload's shape
 *  doesn't drag the scoring module into the client bundle. */
export interface SeasonWindow {
  number: number;
  label: string;
  monthsLabel: string;
  start: string;
  end: string;
}
