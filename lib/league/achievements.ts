import type { LeagueActivity, LeagueMember, LeagueSettings, Sport } from "./types";
import { SPORT_UNIT } from "./types";
import {
  addDays,
  formatMonth,
  formatRange,
  monthEnd,
  monthStart,
  monthsBetween,
  todayISO,
  weekEnd,
  weekStart,
  type DayKey,
} from "./dates";
import { activityPoints, unscoredGymIds, standingsForRange, type Standing } from "./scoring";
import { seasonChampions } from "./season";

/**
 * Everything fun in a league — streaks, badges, weekly champions, rivalries,
 * movement — is derived from the same activity log at read time. No extra
 * storage: change a multiplier and the whole season's stats recompute.
 */

// ---------------------------------------------------------------------------
// Weekly buckets
// ---------------------------------------------------------------------------

/** userId → (Monday-of-week key → points that week). */
function weeklyPoints(
  activities: LeagueActivity[],
  settings: LeagueSettings,
): Map<string, Map<DayKey, number>> {
  const out = new Map<string, Map<DayKey, number>>();
  const unscored = unscoredGymIds(activities, settings);
  for (const a of activities) {
    const wk = weekStart(a.occurredOn);
    let weeks = out.get(a.userId);
    if (!weeks) out.set(a.userId, (weeks = new Map()));
    weeks.set(wk, (weeks.get(wk) ?? 0) + activityPoints(a, settings, unscored));
  }
  return out;
}

/** Inclusive list of Monday keys from the earliest activity to this week. */
function weekTimeline(activities: LeagueActivity[], refDay: DayKey): DayKey[] {
  if (activities.length === 0) return [weekStart(refDay)];
  let earliest = activities[0].occurredOn;
  for (const a of activities) if (a.occurredOn < earliest) earliest = a.occurredOn;
  const first = weekStart(earliest);
  const last = weekStart(refDay);
  const keys: DayKey[] = [];
  for (let k = first; k <= last; k = addDays(k, 7)) keys.push(k);
  return keys;
}

/** The first Monday that can crown anyone. A league with no kickoff set has no
 *  floor — every week counts. */
function seasonWeekFloor(settings: LeagueSettings): DayKey {
  return settings.seasonStart ? weekStart(settings.seasonStart) : "0000-01-01";
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

export interface Streak {
  current: number;
  best: number;
}

export function streakFor(
  userId: string,
  activities: LeagueActivity[],
  settings: LeagueSettings,
  refDay: DayKey = todayISO(),
): Streak {
  const goal = settings.weeklyGoal;
  const weeks = weeklyPoints(activities, settings).get(userId) ?? new Map<DayKey, number>();
  const timeline = weekTimeline(activities, refDay);
  const hit = (wk: DayKey) => goal > 0 && (weeks.get(wk) ?? 0) >= goal;

  // Best: longest run of consecutive hit weeks across the whole timeline.
  let best = 0;
  let run = 0;
  for (const wk of timeline) {
    if (hit(wk)) best = Math.max(best, ++run);
    else run = 0;
  }

  // Current: count back from this week. An in-progress week that isn't hit yet
  // doesn't break a streak built on earlier weeks — start counting one back.
  const thisWeek = weekStart(refDay);
  let cursor = hit(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  let current = 0;
  while (hit(cursor)) {
    current += 1;
    cursor = addDays(cursor, -7);
  }

  return { current, best };
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type BadgeTier = "bronze" | "silver" | "gold" | "platinum";

export interface Badge {
  id: string;
  /** Icon key — resolved to a line icon by the UI (see components/app/icons.tsx). */
  glyph: string;
  name: string;
  unit: string;
  what: string; // one-line description of what the badge is for
  value: number; // the athlete's current metric
  earned: boolean; // level >= 1
  tier: BadgeTier | null; // highest tier reached
  level: number; // 0 = locked … maxLevel
  maxLevel: number;
  maxed: boolean;
  progress: number; // 0..1 toward the NEXT tier (1 when maxed)
  detail: string; // "1,240 / 2,500 km" or, when maxed, "2,500 km"
}

type Grade = [BadgeTier, number];

/**
 * Build one tiered badge. Grades are ascending thresholds; the athlete's tier is
 * the highest grade they've cleared, and `progress` fills the bar toward the next
 * one — so even a locked badge shows how far off the first tier is.
 */
function tieredBadge(
  id: string,
  glyph: string,
  name: string,
  what: string,
  unit: string,
  value: number,
  grades: Grade[],
  fmt: (n: number) => string,
): Badge {
  let level = 0;
  for (const [, at] of grades) if (value + 1e-9 >= at) level += 1;
  const maxLevel = grades.length;
  const earned = level >= 1;
  const maxed = level >= maxLevel;
  const tier = earned ? grades[level - 1][0] : null;
  const nextAt = maxed ? null : grades[level][1];
  const prevAt = level > 0 ? grades[level - 1][1] : 0;
  const progress =
    nextAt == null ? 1 : Math.min(1, Math.max(0, (value - prevAt) / (nextAt - prevAt)));
  const detail = nextAt == null ? `${fmt(value)} ${unit}` : `${fmt(value)} / ${fmt(nextAt)} ${unit}`;
  return { id, glyph, name, unit, what, value, earned, tier, level, maxLevel, maxed, progress, detail };
}

export function badgesFor(
  userId: string,
  members: LeagueMember[],
  activities: LeagueActivity[],
  settings: LeagueSettings,
  refDay: DayKey = todayISO(),
): Badge[] {
  const mine = activities.filter((a) => a.userId === userId);
  const sportsEver = new Set<Sport>();
  const dayPoints = new Map<DayKey, number>();
  const weekSports = new Map<DayKey, Set<Sport>>();
  const unscored = unscoredGymIds(activities, settings);
  let sessions = 0;
  let kmTotal = 0;
  let totalPoints = 0;
  let longestRun = 0;
  let longestRide = 0;
  let longestSwim = 0;

  for (const a of mine) {
    sessions += 1;
    sportsEver.add(a.sport);
    if (SPORT_UNIT[a.sport] === "km") kmTotal += a.km;
    if (a.sport === "run") longestRun = Math.max(longestRun, a.km);
    else if (a.sport === "bike") longestRide = Math.max(longestRide, a.km);
    else if (a.sport === "swim") longestSwim = Math.max(longestSwim, a.km);
    const p = activityPoints(a, settings, unscored);
    totalPoints += p;
    dayPoints.set(a.occurredOn, (dayPoints.get(a.occurredOn) ?? 0) + p);
    const wk = weekStart(a.occurredOn);
    let s = weekSports.get(wk);
    if (!s) weekSports.set(wk, (s = new Set()));
    s.add(a.sport);
  }

  const maxDay = Math.max(0, ...dayPoints.values());
  const tripleWeeks = [...weekSports.values()].filter(
    (s) => s.has("swim") && s.has("bike") && s.has("run"),
  ).length;
  const distinctSports = sportsEver.size;
  const { best } = streakFor(userId, activities, settings, refDay);
  const wins = championshipsByMember(members, activities, settings, refDay).get(userId) ?? 0;
  const seasonTitles = seasonChampions(members, activities, settings, refDay).filter(
    (c) => c.status === "past" && c.champion?.member.userId === userId,
  ).length;

  const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
  const km = (n: number) => {
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };

  const catalog: Badge[] = [
    tieredBadge("champion", "trophy", "Champion", "Weekly wins", "wins", wins,
      [["bronze", 1], ["silver", 5], ["gold", 15], ["platinum", 40]], n0),
    tieredBadge("dynasty", "crown", "Dynasty", "Season titles", "titles", seasonTitles,
      [["bronze", 1], ["silver", 2], ["gold", 4], ["platinum", 8]], n0),
    tieredBadge("odometer", "compass", "Odometer", "Distance logged", "km", kmTotal,
      [["bronze", 100], ["silver", 500], ["gold", 1000], ["platinum", 2500]], km),
    tieredBadge("powerhouse", "bolt", "Powerhouse", "All-time points", "pts", totalPoints,
      [["bronze", 500], ["silver", 2500], ["gold", 10000], ["platinum", 25000]], n0),
    tieredBadge("iron-streak", "flame", "Iron Streak", "Weeks of quota in a row", "wks", best,
      [["bronze", 2], ["silver", 4], ["gold", 12], ["platinum", 26]], n0),
    tieredBadge("relentless", "shield", "Relentless", "Sessions logged", "sessions", sessions,
      [["bronze", 10], ["silver", 50], ["gold", 150], ["platinum", 365]], n0),
    tieredBadge("big-day", "star", "Big Day", "Points in a single day", "pts", maxDay,
      [["bronze", 50], ["silver", 100], ["gold", 200], ["platinum", 350]], n0),
    tieredBadge("triathlete", "rings", "Triathlete", "Swim + bike + run weeks", "wks", tripleWeeks,
      [["bronze", 1], ["silver", 5], ["gold", 15], ["platinum", 40]], n0),
    tieredBadge("marathoner", "flag", "Marathoner", "Longest single run", "km", longestRun,
      [["bronze", 10], ["silver", 21.1], ["gold", 42.2], ["platinum", 50]], km),
    tieredBadge("summiteer", "mountain", "Summiteer", "Longest single ride", "km", longestRide,
      [["bronze", 40], ["silver", 80], ["gold", 160], ["platinum", 200]], km),
    tieredBadge("deep-water", "wave", "Deep Water", "Longest single swim", "km", longestSwim,
      [["bronze", 1], ["silver", 2], ["gold", 3.8], ["platinum", 5]], km),
    tieredBadge("renaissance", "medal", "Renaissance", "Disciplines logged", "sports", distinctSports,
      [["bronze", 2], ["silver", 3], ["gold", 4]], n0),
  ];

  // Earned first (highest tier leads), then locked ordered by how close they are.
  catalog.sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1;
    if (a.earned) return b.level - a.level || b.progress - a.progress;
    return b.progress - a.progress;
  });
  return catalog;
}

// ---------------------------------------------------------------------------
// Weekly champion recap (the closed, previous week)
// ---------------------------------------------------------------------------

export interface WeekRecap {
  rangeLabel: string;
  champion: Standing;
  hit: Standing[];
  missed: Standing[];
}

export function lastWeekRecap(
  members: LeagueMember[],
  activities: LeagueActivity[],
  settings: LeagueSettings,
  refDay: DayKey = todayISO(),
): WeekRecap | null {
  const prevRef = addDays(weekStart(refDay), -1); // a day inside last week
  const range: [DayKey, DayKey] = [weekStart(prevRef), weekEnd(prevRef)];
  // Don't crown a "last week" champion for weeks that ended before the league
  // even started — the recap panel is a victory lap, not a warm-up write-up.
  if (range[0] < seasonWeekFloor(settings)) return null;
  const standings = standingsForRange(members, activities, settings, range);
  if (!standings.some((s) => s.points > 0)) return null;
  const goal = settings.weeklyGoal;
  return {
    rangeLabel: formatRange(range),
    champion: standings[0],
    hit: standings.filter((s) => s.points >= goal),
    missed: standings.filter((s) => s.points < goal),
  };
}

// ---------------------------------------------------------------------------
// Season championships (weekly wins, completed weeks only)
// ---------------------------------------------------------------------------

export function championshipsByMember(
  members: LeagueMember[],
  activities: LeagueActivity[],
  settings: LeagueSettings,
  refDay: DayKey = todayISO(),
): Map<string, number> {
  const wins = new Map<string, number>();
  const thisWeek = weekStart(refDay);
  const floor = seasonWeekFloor(settings);
  for (const wk of weekTimeline(activities, refDay)) {
    if (wk >= thisWeek) continue; // only completed weeks crown a champion
    if (wk < floor) continue; // pre-kickoff weeks don't count
    const range: [DayKey, DayKey] = [wk, weekEnd(wk)];
    const standings = standingsForRange(members, activities, settings, range);
    const top = standings[0];
    if (!top || top.points <= 0) continue;
    // Co-champions share a win on an exact tie.
    for (const s of standings) {
      if (Math.abs(s.points - top.points) < 1e-9) {
        wins.set(s.member.userId, (wins.get(s.member.userId) ?? 0) + 1);
      }
    }
  }
  return wins;
}

// ---------------------------------------------------------------------------
// Week-wins leaderboard (ranked by number of weekly championships)
// ---------------------------------------------------------------------------

export interface WinRow {
  member: LeagueMember;
  wins: number;
  rank: number;
}

export function weekWinsBoard(
  members: LeagueMember[],
  activities: LeagueActivity[],
  settings: LeagueSettings,
  refDay: DayKey = todayISO(),
): WinRow[] {
  const wins = championshipsByMember(members, activities, settings, refDay);
  const rows = members
    .map((member) => ({ member, wins: wins.get(member.userId) ?? 0, rank: 0 }))
    .sort((a, b) => b.wins - a.wins || a.member.username.localeCompare(b.member.username));

  let rank = 0;
  let seen = 0;
  let prev: number | null = null;
  for (const row of rows) {
    seen += 1;
    if (prev === null || row.wins !== prev) {
      rank = seen;
      prev = row.wins;
    }
    row.rank = rank;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Monthly champions (hall of fame)
// ---------------------------------------------------------------------------

export interface MonthChampion {
  monthKey: DayKey;
  label: string;
  champion: Standing;
  isCurrent: boolean;
}

export function monthlyChampions(
  members: LeagueMember[],
  activities: LeagueActivity[],
  settings: LeagueSettings,
  refDay: DayKey = todayISO(),
): MonthChampion[] {
  if (activities.length === 0) return [];
  let earliest = activities[0].occurredOn;
  for (const a of activities) if (a.occurredOn < earliest) earliest = a.occurredOn;

  const curMonth = monthStart(refDay);
  const out: MonthChampion[] = [];
  for (const mk of monthsBetween(earliest, refDay)) {
    const range: [DayKey, DayKey] = [monthStart(mk), monthEnd(mk)];
    const standings = standingsForRange(members, activities, settings, range);
    const top = standings[0];
    if (!top || top.points <= 0) continue;
    out.push({ monthKey: mk, label: formatMonth(mk), champion: top, isCurrent: mk === curMonth });
  }
  return out.reverse(); // newest month first
}

// ---------------------------------------------------------------------------
// Head-to-head (the rival right next to you this week)
// ---------------------------------------------------------------------------

export interface HeadToHead {
  me: Standing;
  rival: Standing;
  /** Positive = you lead by this much; negative = you trail. */
  diff: number;
  leading: boolean;
}

export function headToHead(weekStandings: Standing[], meId: string): HeadToHead | null {
  const i = weekStandings.findIndex((s) => s.member.userId === meId);
  if (i === -1 || weekStandings.length < 2) return null;
  const me = weekStandings[i];
  // The chaser below if you lead, otherwise the athlete just ahead of you.
  const rival = i === 0 ? weekStandings[1] : weekStandings[i - 1];
  const diff = me.points - rival.points;
  return { me, rival, diff, leading: i === 0 };
}

// ---------------------------------------------------------------------------
// Movement — rank now vs rank as of yesterday, within this week
// ---------------------------------------------------------------------------

export interface Movement {
  delta: number; // +ve = climbed, -ve = dropped
  passed: string[]; // usernames you moved ahead of since yesterday
}

export function movementByMember(
  members: LeagueMember[],
  activities: LeagueActivity[],
  settings: LeagueSettings,
  refDay: DayKey = todayISO(),
): Map<string, Movement> {
  const out = new Map<string, Movement>();
  const wkStart = weekStart(refDay);
  const yesterday = addDays(refDay, -1);

  const nowStandings = standingsForRange(members, activities, settings, [wkStart, refDay]);
  const nowRank = new Map(nowStandings.map((s) => [s.member.userId, s.rank]));

  // No "yesterday" inside this week yet (it's Monday) → nobody has moved.
  if (yesterday < wkStart) {
    for (const m of members) out.set(m.userId, { delta: 0, passed: [] });
    return out;
  }

  const yStandings = standingsForRange(members, activities, settings, [wkStart, yesterday]);
  const yRank = new Map(yStandings.map((s) => [s.member.userId, s.rank]));
  const nameOf = new Map(members.map((m) => [m.userId, m.username]));

  for (const m of members) {
    const rn = nowRank.get(m.userId) ?? 0;
    const ry = yRank.get(m.userId) ?? 0;
    const passed: string[] = [];
    for (const other of members) {
      if (other.userId === m.userId) continue;
      const on = nowRank.get(other.userId) ?? 0;
      const oy = yRank.get(other.userId) ?? 0;
      // Behind them yesterday, ahead of them now.
      if (ry > oy && rn < on) passed.push(nameOf.get(other.userId) ?? "");
    }
    out.set(m.userId, { delta: ry - rn, passed });
  }
  return out;
}
