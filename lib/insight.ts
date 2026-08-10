// ---------------------------------------------------------------------------
// One true thing to tell the athlete when today's work is done (#200).
//
// Ryan: "I don't like that when I open the app the first thing I see is what I
// did today. Congrats you did the bike today. There's no point of telling you
// what I did — you can tell me what's next. You can tell me a cool thing, you
// give me congratulations. Me telling you what I did is useless."
//
// So once the day is complete the hero becomes the NEXT session, and this
// supplies the one line under it. Ryan picked "next session + one insight".
//
// THREE RULES, because a line like this is very easy to make worthless:
//
//  1. EVERY CANDIDATE MUST BE TRUE AND CHECKED. Each one returns null unless the
//     data actually supports it. No "you're crushing it" filler — the fastest way
//     to teach someone to ignore a line is to print it when it means nothing.
//  2. IT MUST BE SOMETHING THEY DIDN'T ALREADY KNOW. "You did a bike today" is
//     the thing being replaced; restating the session, the streak count on its
//     own, or anything visible elsewhere on the screen doesn't earn the space.
//  3. DETERMINISTIC. Picked by date, not at random: the same day always shows
//     the same line, so the app doesn't appear to change its mind on a re-render,
//     and the component stays pure (`Math.random` in a component is a lint error
//     here for exactly that reason).
//
// Pure — no clock, no I/O. `todayISO` is always passed in.
// ---------------------------------------------------------------------------

import type { Plan } from "./types";
import { formStateFor } from "./load";
import { computeStreak, trainingStats } from "./stats";
import { projectRace } from "./predict";
import { isFitnessGoal } from "./planEngine";
import { daysBetween } from "./dates";
import { fmtClock, fmtDuration } from "./format";

export interface Insight {
  /** Stable key for the candidate, so tests can assert WHICH one fired. */
  key: string;
  text: string;
}

/** Whole hours banked, or null below a threshold worth mentioning. */
function bankedHours(plan: Plan, todayISO: string): number | null {
  const { bankedSec } = trainingStats(plan, todayISO);
  const hrs = Math.floor(bankedSec / 3600);
  return hrs >= 5 ? hrs : null;
}

type Candidate = (plan: Plan, todayISO: string) => Insight | null;

const CANDIDATES: Candidate[] = [
  // Where their form actually is. The one number the whole engine exists to
  // manage, and it isn't otherwise on this screen once the hero is next-session.
  (plan, todayISO) => {
    const form = formStateFor(plan, todayISO);
    if (!form) return null;
    return { key: "form", text: `Your form is ${form.word.toLowerCase()} — ${form.line.toLowerCase()}` };
  },

  // What the remaining training is worth. This is the most motivating number in
  // the product (doc 07 §4.5) and it lives nowhere on Today.
  (plan, todayISO) => {
    if (isFitnessGoal(plan.profile)) return null;
    const proj = projectRace(plan.profile, todayISO);
    if (!(proj.gainSec > 60) || !(proj.projectedSec > 0)) return null;
    return {
      key: "projection",
      text: `On track for ${fmtClock(proj.projectedSec)} — the training left is worth about ${fmtDuration(proj.gainSec)}.`,
    };
  },

  // Fitness actually rising, stated only when it measurably is.
  (plan, todayISO) => {
    const { pmc } = trainingStats(plan, todayISO);
    if (pmc.length < 28) return null;
    const now = pmc[pmc.length - 1].ctl;
    const then = pmc[pmc.length - 28].ctl;
    if (then <= 0 || now <= then * 1.05) return null;
    return { key: "fitness", text: `Your fitness is up ${Math.round(((now - then) / then) * 100)}% over the last four weeks.` };
  },

  // Time in the bank. Volume the athlete chose to do, which no other screen sums.
  (plan, todayISO) => {
    const hrs = bankedHours(plan, todayISO);
    if (hrs == null) return null;
    // "toward this race" is wrong for an athlete who never entered one — the
    // fitness-goal sweep in the tests caught this line promising a race that
    // doesn't exist. Say the true version of the same fact instead.
    return {
      key: "banked",
      text: isFitnessGoal(plan.profile)
        ? `That's ${hrs} hours of training in the bank.`
        : `That's ${hrs} hours banked toward this race.`,
    };
  },

  // The streak, but only once it's long enough to be an achievement rather than
  // a number. Two days is not a streak worth a headline.
  (plan, todayISO) => {
    const streak = computeStreak(plan, todayISO);
    if (streak.current < 4) return null;
    return { key: "streak", text: `${streak.current} days in a row now — consistency is the whole game.` };
  },

  // Race week / countdown, only once it's close enough to change how they think.
  (plan, todayISO) => {
    if (isFitnessGoal(plan.profile) || !plan.profile.raceDateISO) return null;
    const days = daysBetween(todayISO, plan.profile.raceDateISO);
    if (days < 0 || days > 21) return null;
    if (days === 0) return { key: "raceday", text: "Race day. Everything you needed is already done." };
    return { key: "countdown", text: `${days} day${days === 1 ? "" : "s"} to race — the work is banked, now protect it.` };
  },
];

/**
 * The one line to show under the next session. Returns null when nothing true
 * and interesting can be said, and the caller shows nothing rather than filler.
 *
 * Rotation is by date across whatever qualified TODAY, so a plan with several
 * things worth saying doesn't say the same one every day.
 */
export function insightFor(plan: Plan, todayISO: string): Insight | null {
  const live = CANDIDATES.map((c) => {
    try {
      return c(plan, todayISO);
    } catch {
      // A broken candidate must never take the screen down with it.
      return null;
    }
  }).filter((x): x is Insight => x != null);
  if (!live.length) return null;
  // Days since epoch — a stable per-day index with no clock read.
  const day = Math.floor(new Date(`${todayISO}T00:00:00Z`).getTime() / 86_400_000);
  return live[((day % live.length) + live.length) % live.length];
}
