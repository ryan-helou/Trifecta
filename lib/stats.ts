// ---------------------------------------------------------------------------
// Derived training stats for the improvement story: consistency streaks, a
// completed-training "fitness" curve, personal records, and the milestone that
// fires a celebration when a session is finished. All pure — read a Plan, no I/O.
// ---------------------------------------------------------------------------

import { Discipline, Plan, Workout } from "./types";
import { addDays } from "./dates";
import { creditedSeconds, creditedDiscipline } from "./adapt";
import { PmcPoint, pmc, sessionLoad } from "./load";
import { DISCIPLINE_META } from "./zones";
import { fmtDuration } from "./format";

const isDone = (w: Workout) => w.status === "done" || w.status === "swapped";

/** Training load of a single completed session (Foster session-RPE AU — see
 *  lib/load.ts for the intensity ladder). 0 if not done. */
export function workoutLoad(w: Workout, lthr: number | null = null): number {
  return sessionLoad(w, lthr).load;
}

type DayState = "kept" | "missed" | "pending";

/** A day counts as "kept" if it was a rest day, or every planned session was honoured
 *  (done/swapped/moved). It's "missed" if anything was skipped or left undone in the past.
 *  Today is "pending" while sessions remain open — it never breaks the streak yet. */
function dayState(byDate: Record<string, Workout[]>, iso: string, isToday: boolean): DayState {
  const ws = byDate[iso];
  if (!ws || ws.length === 0) return "kept"; // rest day — recovery still counts
  if (ws.some((w) => w.status === "skipped")) return "missed";
  if (ws.every((w) => w.status === "done" || w.status === "swapped" || w.status === "moved")) return "kept";
  // some sessions still "planned"
  if (isToday) return ws.some(isDone) ? "kept" : "pending";
  return "missed";
}

export interface StreakInfo {
  current: number;
  longest: number;
}

/** Current consecutive-day streak ending today (rest days kept), plus the longest run so far. */
export function computeStreak(plan: Plan, today: string): StreakInfo {
  const start = plan.startDateISO;
  const byDate: Record<string, Workout[]> = {};
  for (const w of Object.values(plan.workouts)) {
    if (w.discipline === "rest") continue;
    (byDate[w.date] ??= []).push(w);
  }

  // Did anything actually get DONE on this day? A rest day, or a day before the plan
  // had anything scheduled, returns "kept" above — recovery shouldn't break a streak.
  // But it must not CREATE one either: a brand-new athlete who has trained zero times
  // was being shown "Streak 1 day" directly above "Total banked 0h · 0 sessions"
  // (#144). A streak is a run of days you kept; if you have never trained, there is
  // no run to be on.
  const trained = (iso: string) => (byDate[iso] ?? []).some(isDone);

  // walk backwards from today
  let current = 0;
  let currentHasSession = false;
  let iso = today;
  while (iso >= start) {
    const st = dayState(byDate, iso, iso === today);
    if (st === "missed") break;
    if (st === "pending") { iso = addDays(iso, -1); continue; } // today not done yet — skip, don't break
    current++;
    if (trained(iso)) currentHasSession = true;
    iso = addDays(iso, -1);
  }
  if (!currentHasSession) current = 0; // rest days preserve a streak, they don't start one

  // longest run across the plan up to today
  let longest = 0;
  let run = 0;
  let runHasSession = false;
  let d = start;
  while (d <= today) {
    const st = dayState(byDate, d, d === today);
    if (st === "kept") {
      run++;
      if (trained(d)) runHasSession = true;
      if (runHasSession) longest = Math.max(longest, run);
    } else if (st === "missed") { run = 0; runHasSession = false; }
    d = addDays(d, 1);
  }
  return { current, longest: Math.max(longest, current) };
}

export interface TrainingStats {
  weekLoad: number[]; // completed training load per plan week
  fitness: number[]; // CTL sampled at each week's last banked day (legacy weekly curve)
  pmc: PmcPoint[]; // daily CTL/ATL/TSB through today — the real form story
  doneHrsByWeek: number[];
  bankedSec: number;
  bankedCount: number;
  longestSession: { workout: Workout; sec: number } | null;
  biggestWeekHrs: number;
}

/** Everything the Progress tab needs to tell an improvement story. */
export function trainingStats(plan: Plan, todayISO: string): TrainingStats {
  const lthr = plan.paces.hr.lthr;
  const weekLoad = plan.weeks.map((wk) =>
    wk.workoutIds.reduce((a, id) => a + workoutLoad(plan.workouts[id], lthr), 0),
  );

  // the daily PMC through today; the legacy weekly "fitness" curve is CTL
  // sampled at each week's last banked day, so FitnessChart keeps rendering
  // one point per week until the PMC card replaces it
  const series = pmc(plan, todayISO);
  const ctlByDate = new Map(series.map((p) => [p.dateISO, p.ctl]));
  const fitness = plan.weeks.map((wk) => {
    const end = addDays(wk.startDate, 6);
    return ctlByDate.get(end <= todayISO ? end : todayISO) ?? 0;
  });

  const doneHrsByWeek = plan.weeks.map((wk) =>
    wk.workoutIds.reduce((a, id) => {
      const w = plan.workouts[id];
      return a + (isDone(w) ? creditedSeconds(w) / 3600 : 0);
    }, 0),
  );

  const done = Object.values(plan.workouts).filter((w) => w.discipline !== "rest" && isDone(w));
  const bankedSec = done.reduce((a, w) => a + creditedSeconds(w), 0);
  const longestSession = done.reduce<{ workout: Workout; sec: number } | null>((best, w) => {
    const s = creditedSeconds(w);
    return s > (best?.sec ?? 0) ? { workout: w, sec: s } : best;
  }, null);

  return {
    weekLoad,
    fitness,
    pmc: series,
    doneHrsByWeek,
    bankedSec,
    bankedCount: done.length,
    longestSession,
    biggestWeekHrs: Math.max(0, ...doneHrsByWeek),
  };
}

export interface Celebration {
  /** icon name (see components/app/icons) */
  icon: string;
  title: string;
  sub: string;
}

const STREAK_MILESTONES = [3, 5, 7, 10, 14, 21, 30, 50, 75, 100];

/** The most salient thing worth celebrating about a just-completed session, if any. */
export function celebrationFor(plan: Plan, id: string, today: string): Celebration | null {
  const w = plan.workouts[id];
  if (!w || !isDone(w)) return null;

  const done = Object.values(plan.workouts).filter((x) => x.discipline !== "rest" && isDone(x));

  // first brick is a real triathlon rite of passage
  if (w.discipline === "brick" && done.filter((x) => x.discipline === "brick").length === 1) {
    return { icon: "brick", title: "First brick done!", sub: "You've unlocked your bike-to-run legs." };
  }

  // streak milestones
  const { current } = computeStreak(plan, today);
  if (STREAK_MILESTONES.includes(current)) {
    return { icon: "flame", title: `${current}-day streak!`, sub: "Consistency is the whole game — keep it rolling." };
  }

  // a new longest session in this sport (needs a bit of history so it's meaningful)
  const disc: Discipline = creditedDiscipline(w);
  const sameSport = done.filter((x) => creditedDiscipline(x) === disc);
  const maxOther = Math.max(0, ...sameSport.filter((x) => x.id !== w.id).map(creditedSeconds));
  if (sameSport.length >= 3 && creditedSeconds(w) > maxOther && creditedSeconds(w) >= 3600) {
    return {
      icon: "medal",
      title: `Longest ${DISCIPLINE_META[disc].label.toLowerCase()} yet`,
      sub: `${fmtDuration(creditedSeconds(w))} — a new personal best.`,
    };
  }

  return null;
}
