import type { LeagueActivity, LeagueMember, LeagueSettings, Sport } from "./types";
import { SPORTS, SPORT_UNIT } from "./types";
import { inRange, type DayKey, type Period, periodRange } from "./dates";

/**
 * Points are derived from distance at read time rather than frozen when an
 * activity is logged. The multipliers are the rules of the competition, so when
 * an admin changes them the whole season re-scores — nobody keeps points that
 * were earned under a rule that no longer exists.
 *
 * Every function here takes `settings` as a parameter, which is what makes
 * multi-league nearly free: the same activity row scores one way in a
 * run-weighted league and another way in a balanced one, with no second copy
 * of the data and no branching in here.
 */
export function pointsFor(km: number, sport: Sport, settings: LeagueSettings): number {
  return km * (settings.multipliers[sport] ?? 0);
}

/**
 * Points for one activity. Pass the set from `unscoredGymIds` to have
 * over-the-cap gym workouts score zero; omit it when you genuinely want the
 * face value (e.g. the "Worth" preview on the log form, before it's saved).
 */
export function activityPoints(
  a: LeagueActivity,
  settings: LeagueSettings,
  unscored?: Set<string>,
): number {
  if (unscored?.has(a.id)) return 0;
  return pointsFor(a.km, a.sport, settings);
}

/**
 * The gym workouts that fall past the league's per-day cap, as a set of activity
 * ids. Earliest-logged wins, so the cap can never retroactively un-score a session
 * that already counted. Computed over whatever list is passed in — callers hand
 * over the full activity list and range filtering happens afterwards, so a week
 * view and an all-time view agree on which workouts scored.
 */
export function unscoredGymIds(activities: LeagueActivity[], settings: LeagueSettings): Set<string> {
  const cap = settings.maxScoringGymPerDay;
  const byUserDay = new Map<string, LeagueActivity[]>();
  for (const a of activities) {
    if (SPORT_UNIT[a.sport] !== "flat") continue;
    const key = `${a.userId}|${a.occurredOn}`;
    const list = byUserDay.get(key);
    if (list) list.push(a);
    else byUserDay.set(key, [a]);
  }

  const unscored = new Set<string>();
  for (const list of byUserDay.values()) {
    if (list.length <= cap) continue;
    // Stable order: oldest first, id as the tie-break so two logs written in the
    // same millisecond still resolve the same way on every render.
    const ordered = [...list].sort(
      (x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id),
    );
    for (const a of ordered.slice(cap)) unscored.add(a.id);
  }
  return unscored;
}

export interface Standing {
  member: LeagueMember;
  points: number;
  km: number;
  sessions: number;
  /** Points contributed by each sport, for the split bars. */
  bySport: Record<Sport, number>;
  kmBySport: Record<Sport, number>;
  rank: number;
  /** Fraction of the weekly goal reached — only meaningful for the week view. */
  goalProgress: number;
  /** Sessions that came in from Strava rather than being typed by hand. */
  stravaSessions: number;
  /** Gym workouts in this window that were past the daily cap and scored nothing. */
  unscoredSessions: number;
}

function emptySportMap(): Record<Sport, number> {
  return { swim: 0, bike: 0, run: 0, gym: 0 };
}

export function standingsFor(
  members: LeagueMember[],
  activities: LeagueActivity[],
  settings: LeagueSettings,
  period: Period,
  ref?: DayKey,
): Standing[] {
  return standingsForRange(members, activities, settings, periodRange(period, ref));
}

export function standingsForRange(
  members: LeagueMember[],
  activities: LeagueActivity[],
  settings: LeagueSettings,
  range: [DayKey, DayKey],
): Standing[] {
  const rows = new Map<string, Standing>();

  for (const member of members) {
    rows.set(member.userId, {
      member,
      points: 0,
      km: 0,
      sessions: 0,
      bySport: emptySportMap(),
      kmBySport: emptySportMap(),
      rank: 0,
      goalProgress: 0,
      stravaSessions: 0,
      unscoredSessions: 0,
    });
  }

  // Computed over the whole list, before the range filter, so a capped workout
  // stays capped no matter which window you're looking at.
  const unscored = unscoredGymIds(activities, settings);

  // The season floor. A league only counts sessions from its kickoff onward, so
  // warm-up days logged before it can't put someone top of a season that hasn't
  // started. Applied here rather than at each call site.
  const from = settings.seasonStart && settings.seasonStart > range[0] ? settings.seasonStart : range[0];

  for (const a of activities) {
    if (!inRange(a.occurredOn, [from, range[1]])) continue;
    const row = rows.get(a.userId);
    if (!row) continue; // an ex-member's activities stop scoring the moment they leave
    if (a.source === "strava") row.stravaSessions += 1;
    if (unscored.has(a.id)) {
      // Still a session that happened — it just contributes no points or volume.
      row.sessions += 1;
      row.unscoredSessions += 1;
      continue;
    }
    const pts = activityPoints(a, settings);
    row.points += pts;
    // `km` is the distance total, so gym workouts don't get summed into it — they
    // live in kmBySport.gym and surface with their own unit.
    if (SPORT_UNIT[a.sport] === "km") row.km += a.km;
    row.sessions += 1;
    row.bySport[a.sport] += pts;
    row.kmBySport[a.sport] += a.km;
  }

  const list = [...rows.values()].sort(
    (x, y) => y.points - x.points || x.member.username.localeCompare(y.member.username),
  );

  // Equal totals share a lane number; the next athlete drops by the tie count.
  let rank = 0;
  let seen = 0;
  let prev: number | null = null;
  for (const row of list) {
    seen += 1;
    if (prev === null || Math.abs(row.points - prev) > 1e-9) {
      rank = seen;
      prev = row.points;
    }
    row.rank = rank;
    row.goalProgress = settings.weeklyGoal > 0 ? row.points / settings.weeklyGoal : 0;
  }

  return list;
}

export function totalPoints(activities: LeagueActivity[], settings: LeagueSettings): number {
  const unscored = unscoredGymIds(activities, settings);
  return activities.reduce((sum, a) => sum + activityPoints(a, settings, unscored), 0);
}

/** Trim float noise, keep one decimal, and never render "12.0". */
export function fmtPoints(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function fmtKm(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

export const SPORT_ORDER = SPORTS;
