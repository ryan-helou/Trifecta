import type { LeagueActivity, LeagueSettings, Sport } from "./types";
import { SPORT_UNIT } from "./types";
import { activityPoints, unscoredGymIds } from "./scoring";
import { addDays, formatDay, formatRange, weekEnd, weekStart, type DayKey } from "./dates";

/**
 * The Hall of Fame — all-time records, derived live from the activity log (no
 * storage). Each record is the single best mark anyone in the league has ever
 * posted; beating one puts your name up. Points respect the gym-per-day cap so a
 * record can't be farmed, exactly like the board.
 */

/** Enough to reconstruct the story of the record — the record sheet uses this
 *  to filter the full activity list back down to the sessions that built it. */
export type RecordContext =
  | { kind: "day"; day: DayKey }
  | { kind: "week"; weekStart: DayKey }
  | { kind: "activity"; activityId: string }
  | { kind: "streak"; endDay: DayKey; length: number };

export interface HallRecord {
  key: string;
  label: string;
  /** A line icon for the abstract records… */
  glyph?: string;
  /** …or a discipline, for the distance records. */
  sport?: Sport;
  /** User id who holds it, or null if nobody's posted a mark yet. */
  holderId: string | null;
  value: number;
  unit: "pts" | "km" | "days" | "sessions" | "time";
  /** When it was set — a day, or a week range. */
  detail: string;
  /** How to re-derive the sessions behind this mark. Absent while unclaimed. */
  context?: RecordContext;
}

interface Peak {
  holderId: string | null;
  value: number;
  detail: string;
  context?: RecordContext;
}
const emptyPeak = (): Peak => ({ holderId: null, value: 0, detail: "" });

export function hallOfFame(activities: LeagueActivity[], settings: LeagueSettings): HallRecord[] {
  const unscored = unscoredGymIds(activities, settings);
  const pts = (a: LeagueActivity) => activityPoints(a, settings, unscored);

  let bigSession = emptyPeak(); // most points from one logged session
  let longestRun = emptyPeak();
  let longestRide = emptyPeak();
  let longestSwim = emptyPeak();

  const dayPts = new Map<string, number>(); // `userId|day` → points
  const weekPts = new Map<string, number>(); // `userId|weekStart` → points
  const dayKm = new Map<string, number>(); // `userId|day` → distance km
  const weekSessions = new Map<string, number>(); // `userId|weekStart` → session count
  const activeDays = new Map<string, Set<string>>(); // userId → set of active days

  for (const a of activities) {
    const p = pts(a);
    if (p > bigSession.value) {
      bigSession = {
        holderId: a.userId,
        value: p,
        detail: formatDay(a.occurredOn),
        context: { kind: "activity", activityId: a.id },
      };
    }
    const claim = (): Peak => ({
      holderId: a.userId,
      value: a.km,
      detail: formatDay(a.occurredOn),
      context: { kind: "activity", activityId: a.id },
    });
    if (a.sport === "run" && a.km > longestRun.value) longestRun = claim();
    else if (a.sport === "bike" && a.km > longestRide.value) longestRide = claim();
    else if (a.sport === "swim" && a.km > longestSwim.value) longestSwim = claim();

    const dk = `${a.userId}|${a.occurredOn}`;
    dayPts.set(dk, (dayPts.get(dk) ?? 0) + p);
    const wk = weekStart(a.occurredOn);
    const wkk = `${a.userId}|${wk}`;
    weekPts.set(wkk, (weekPts.get(wkk) ?? 0) + p);
    // Distance only — a flat gym "1 km" shouldn't count toward a km record.
    if (SPORT_UNIT[a.sport] === "km") dayKm.set(dk, (dayKm.get(dk) ?? 0) + a.km);
    weekSessions.set(wkk, (weekSessions.get(wkk) ?? 0) + 1);
    let days = activeDays.get(a.userId);
    if (!days) activeDays.set(a.userId, (days = new Set()));
    days.add(a.occurredOn);
  }

  const peakOfDays = (m: Map<string, number>): Peak => {
    let peak = emptyPeak();
    for (const [k, v] of m) {
      if (v > peak.value) {
        const [holderId, day] = k.split("|");
        peak = { holderId, value: v, detail: formatDay(day), context: { kind: "day", day } };
      }
    }
    return peak;
  };
  const peakOfWeeks = (m: Map<string, number>): Peak => {
    let peak = emptyPeak();
    for (const [k, v] of m) {
      if (v > peak.value) {
        const [holderId, wk] = k.split("|");
        peak = {
          holderId,
          value: v,
          detail: formatRange([wk, weekEnd(wk)]),
          context: { kind: "week", weekStart: wk },
        };
      }
    }
    return peak;
  };

  const bestDay = peakOfDays(dayPts);
  const bestWeek = peakOfWeeks(weekPts);
  const bestKmDay = peakOfDays(dayKm);
  const busiestWeek = peakOfWeeks(weekSessions);

  // Longest run of consecutive days with at least one session.
  let longestStreak = emptyPeak();
  for (const [holderId, daysSet] of activeDays) {
    const days = [...daysSet].sort();
    let run = 0;
    let best = 0;
    let bestEnd = "";
    for (let i = 0; i < days.length; i++) {
      run = i > 0 && days[i] === addDays(days[i - 1], 1) ? run + 1 : 1;
      if (run > best) {
        best = run;
        bestEnd = days[i];
      }
    }
    if (best > longestStreak.value) {
      longestStreak = {
        holderId,
        value: best,
        detail: `to ${formatDay(bestEnd)}`,
        context: { kind: "streak", endDay: bestEnd, length: best },
      };
    }
  }

  // ---- fastest to the weekly goal ---------------------------------------
  //
  // The one record measured in TIME rather than volume: from the start of the
  // week to the moment your points crossed `weeklyGoal`. It resets every week, so
  // it's the one mark a new member can take in their first seven days.
  //
  // HOW THE CLOCK RUNS, and its honest limitation. `occurredOn` is date-only by
  // design ("no timezone maths", types.ts), so a day is the finest resolution
  // real training gives us — and a record shown in days alone would be a
  // three-way tie every week. The clock therefore runs on `createdAt`, when the
  // session was LOGGED. Ryan chose this knowing the trade: it partly measures
  // logging habits, and someone who banks three sessions and enters them in one
  // sitting posts a fast time. That is the price of hours-and-minutes on
  // date-only data, and it is stated in the record's own subtitle rather than
  // left for someone to discover.
  //
  // A week is only timed when the crossing activity was logged AFTER the week
  // began. Backdating an earlier entry into this week would otherwise cross the
  // line at elapsed zero and hold the record permanently.
  let fastestGoal = emptyPeak();
  const goal = settings.weeklyGoal;
  if (goal > 0) {
    // userId|weekStart → the week's activities, oldest LOGGED first
    const byUserWeek = new Map<string, LeagueActivity[]>();
    for (const a of activities) {
      const k = `${a.userId}|${weekStart(a.occurredOn)}`;
      let list = byUserWeek.get(k);
      if (!list) byUserWeek.set(k, (list = []));
      list.push(a);
    }
    for (const [k, list] of byUserWeek) {
      const [holderId, wk] = k.split("|");
      const opened = Date.parse(`${wk}T00:00:00Z`);
      if (!Number.isFinite(opened)) continue;
      const ordered = [...list].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      let running = 0;
      for (const a of ordered) {
        running += pts(a);
        if (running < goal) continue;
        const at = Date.parse(a.createdAt);
        if (!Number.isFinite(at) || at < opened) break; // can't be timed honestly — see above
        const elapsed = Math.floor((at - opened) / 1000);
        if (fastestGoal.holderId === null || elapsed < fastestGoal.value) {
          fastestGoal = {
            holderId,
            value: elapsed,
            detail: formatRange([wk, weekEnd(wk)]),
            context: { kind: "week", weekStart: wk },
          };
        }
        break; // the crossing activity is the one that counts
      }
    }
  }

  return [
    { key: "week", label: "Biggest week", glyph: "trophy", unit: "pts", ...bestWeek },
    { key: "day", label: "Most points in a day", glyph: "bolt", unit: "pts", ...bestDay },
    { key: "session", label: "Biggest single session", glyph: "star", unit: "pts", ...bigSession },
    { key: "kmday", label: "Most km in a day", glyph: "target", unit: "km", ...bestKmDay },
    { key: "busiest", label: "Busiest week", glyph: "rings", unit: "sessions", ...busiestWeek },
    { key: "streak", label: "Longest streak", glyph: "flame", unit: "days", ...longestStreak },
    { key: "goalrush", label: `Fastest to ${goal} pts`, glyph: "bolt", unit: "time", ...fastestGoal },
    { key: "run", label: "Longest run", sport: "run", unit: "km", ...longestRun },
    { key: "ride", label: "Longest ride", sport: "bike", unit: "km", ...longestRide },
    { key: "swim", label: "Longest swim", sport: "swim", unit: "km", ...longestSwim },
  ];
}
