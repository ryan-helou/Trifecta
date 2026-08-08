import { coachSafeTitle } from "./stravaPrivacy";
import { Discipline, Feel, Plan, Week, Workout, Zone } from "./types";
import { addDays, dayIndexOf, fromISO, mondayOf } from "./dates";
import { BuildCtx, Draft } from "./workouts";
import * as W from "./workouts";
import { generatePlan, isFitnessGoal } from "./planEngine";
import { ZONES } from "./zones";
import { fmtDuration } from "./format";
import { creditedDiscipline, creditedSeconds } from "./credit";
import { formDeviation, FORM_DEBT_EASE_PCT } from "./load";
import { swapAllowance } from "./mechanical";

// re-exported so existing importers keep working; the definitions live in credit.ts
export { creditedDiscipline, creditedSeconds };

// ---------------------------------------------------------------------------
// Plan adaptation. Pure functions returning a new Plan.
// Rules (from best-in-class apps): a single miss is absorbed, not crammed;
// "skip" (won't do) and "move" (will do later) are distinct; swaps replace a
// session; falling behind → rebuild the remainder from today.
// ---------------------------------------------------------------------------

function clonePlan(plan: Plan): Plan {
  return {
    ...plan,
    workouts: Object.fromEntries(Object.entries(plan.workouts).map(([k, v]) => [k, { ...v, segments: v.segments }])),
    weeks: plan.weeks.map((w) => ({ ...w, workoutIds: [...w.workoutIds] })),
  };
}

/** Recompute each week's workout membership + day/week indices from dates. */
export function reindexWeeks(plan: Plan): void {
  for (const wk of plan.weeks) wk.workoutIds = [];
  const weeksSorted = [...plan.weeks].sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  for (const w of Object.values(plan.workouts)) {
    // A workout belongs to the week whose Monday matches its own Monday. Comparing
    // by calendar Monday (not start + 7*86400000 ms) is exact across DST — a fixed
    // millisecond week overshoots the next Monday's local midnight by an hour after
    // spring-forward, mis-bucketing that Monday into the previous week.
    const wm = mondayOf(w.date);
    const wk = weeksSorted.find((week) => week.startDate === wm);
    if (wk) {
      w.weekIndex = wk.index;
      w.dayIndex = dayIndexOf(w.date);
      wk.workoutIds.push(w.id);
    }
  }
  for (const wk of plan.weeks) {
    wk.workoutIds.sort((a, b) => plan.workouts[a].dayIndex - plan.workouts[b].dayIndex);
  }
}

export function setStatus(plan: Plan, id: string, status: Workout["status"], note?: string): Plan {
  const p = clonePlan(plan);
  const w = p.workouts[id];
  if (!w) return p;
  p.workouts[id] = { ...w, status, note: note ?? (status === "planned" ? undefined : w.note) };
  return p;
}

export function logInstead(
  plan: Plan,
  id: string,
  note: string,
  opts?: { discipline?: Discipline; durationSec?: number },
): Plan {
  const p = clonePlan(plan);
  const w = p.workouts[id];
  if (!w) return p;
  p.workouts[id] = {
    ...w,
    status: "swapped",
    note,
    // record what they actually did so Progress attributes it to the right sport
    loggedDiscipline: opts?.discipline ?? w.discipline,
    loggedDurationSec: opts?.durationSec ?? w.estDurationSec,
  };
  return p;
}

/** Discipline that a completed/logged workout should be credited to. */


/** Record a post-session check-in (effort / feel / actual time & distance) and mark it complete. */
export function logCheckin(
  plan: Plan,
  id: string,
  entry: { rpe?: number; feel?: Workout["feel"]; actualDurationSec?: number; actualDistanceM?: number },
): Plan {
  const p = clonePlan(plan);
  const w = p.workouts[id];
  if (!w) return p;
  p.workouts[id] = {
    ...w,
    // completing a swapped ("did something else") session keeps that status; otherwise it's done
    status: w.status === "swapped" ? "swapped" : "done",
    // A key present in `entry` (even with an undefined value) is an explicit set,
    // so clearing a field in the check-in sheet actually removes it; an absent key
    // leaves the stored value untouched. (`?? w.x` used to make cleared fields sticky.)
    rpe: "rpe" in entry ? entry.rpe : w.rpe,
    feel: "feel" in entry ? entry.feel : w.feel,
    actualDurationSec: "actualDurationSec" in entry ? entry.actualDurationSec : w.actualDurationSec,
    actualDistanceM: "actualDistanceM" in entry ? entry.actualDistanceM : w.actualDistanceM,
  };
  return p;
}

// ---- log a workout (manual "here's what I actually did") --------------------
// The athlete says what they did; we compare it to the planned session that day
// and either tick it off (equivalent), credit the actual (adjusted), swap the
// credit to the sport they actually did, or log a bonus session when nothing was
// planned. A first-person `coachPrefill` lets them tell the AI coach in one tap.

export interface LoggedWorkout {
  dateISO: string;
  discipline: Discipline; // swim | bike | run | strength
  durationSec: number;
  distanceM?: number;
  rpe?: number;
  feel?: Feel;
  note?: string;
}

export type LogOutcome = "ticked" | "adjusted" | "swapped" | "bonus";

export interface LogResult {
  plan: Plan;
  outcome: LogOutcome;
  matchedId?: string;
  headline: string;
  detail: string;
  /** a first-person note the athlete can send straight to the coach chat */
  coachPrefill: string;
}

/** Would a logged `discipline` count as doing this planned workout? (a brick is
 *  satisfied by either its ride or its run). */
function disciplineMatches(logged: Discipline, planned: Discipline): boolean {
  if (planned === logged) return true;
  if (planned === "brick" && (logged === "bike" || logged === "run")) return true;
  return false;
}

/** Is what the athlete did close enough to the planned session to just tick it off?
 *  Duration within −30%/+40%, and (when both are known) distance within ±~25%. */
function isEquivalent(logged: LoggedWorkout, planned: Workout): boolean {
  const pd = planned.estDurationSec || 0;
  if (pd > 0) {
    const r = logged.durationSec / pd;
    if (r < 0.7 || r > 1.4) return false;
  }
  if (logged.distanceM && planned.estDistanceM) {
    const dr = logged.distanceM / planned.estDistanceM;
    if (dr < 0.75 || dr > 1.3) return false;
  }
  return true;
}

function feelClause(l: LoggedWorkout): string {
  const bits: string[] = [];
  if (l.feel) bits.push(`felt ${l.feel}`);
  if (typeof l.rpe === "number") bits.push(`RPE ${l.rpe}/10`);
  return bits.length ? `, ${bits.join(", ")}` : "";
}

function distClause(l: LoggedWorkout): string {
  return l.distanceM ? ` · ${(l.distanceM / 1000).toFixed(l.discipline === "swim" ? 2 : 1)} km` : "";
}

/** Add a self-logged session as a completed workout (used when nothing was planned). */
function addLoggedWorkout(plan: Plan, input: LoggedWorkout): Plan {
  const p = clonePlan(plan);
  const zone: Zone = typeof input.rpe === "number" ? (input.rpe >= 7 ? 4 : input.rpe >= 5 ? 3 : 2) : 2;
  const base = `logged-${input.dateISO}-${input.discipline}`;
  let id = base;
  let n = 1;
  while (p.workouts[id]) id = `${base}-${++n}`;
  p.workouts[id] = {
    id,
    date: input.dateISO,
    weekIndex: 0, // fixed by reindexWeeks
    dayIndex: dayIndexOf(input.dateISO),
    discipline: input.discipline,
    type: input.discipline === "strength" ? "strength" : "endurance",
    // Say what it WAS. "Logged strength" tells the athlete nothing they didn't
    // already know; "Push · strength" is the session they actually did, and it's what
    // makes the note worth asking for in the first place (#121).
    title: input.note ? `${input.note} · ${input.discipline}` : `Logged ${input.discipline}`,
    purpose: "A session you logged yourself.",
    segments: [
      { kind: "main", discipline: input.discipline, zone, durationSec: input.durationSec, description: "Logged session" },
    ],
    estDurationSec: input.durationSec,
    estDistanceM: input.distanceM,
    primaryZone: zone,
    status: "done",
    rpe: input.rpe,
    feel: input.feel,
    actualDurationSec: input.durationSec,
    actualDistanceM: input.distanceM,
    note: input.note,
  };
  reindexWeeks(p);
  return p;
}

export function logWorkout(plan: Plan, input: LoggedWorkout): LogResult {
  const durTxt = fmtDuration(input.durationSec);
  const distTxt = distClause(input);
  const d = input.discipline;

  // planned, not-yet-done sessions on that day
  const sameDay = Object.values(plan.workouts).filter(
    (w) => w.date === input.dateISO && w.discipline !== "rest" && w.status === "planned",
  );
  // prefer a discipline match; otherwise the closest-duration session (to swap into)
  const match =
    sameDay.find((w) => disciplineMatches(d, w.discipline)) ??
    [...sameDay].sort(
      (a, b) => Math.abs((a.estDurationSec || 0) - input.durationSec) - Math.abs((b.estDurationSec || 0) - input.durationSec),
    )[0];

  if (!match) {
    return {
      plan: addLoggedWorkout(plan, input),
      outcome: "bonus",
      headline: "Bonus session logged",
      detail: `Nothing was planned — added your ${d} (${durTxt}${distTxt}) to the log.`,
      coachPrefill: `I did an unplanned ${d} today: ${durTxt}${distTxt}${feelClause(input)}. Nothing was on the plan — does that change the next few days?`,
    };
  }

  if (disciplineMatches(d, match.discipline)) {
    const done = logCheckin(plan, match.id, {
      rpe: input.rpe,
      feel: input.feel,
      actualDurationSec: input.durationSec,
      actualDistanceM: input.distanceM,
    });
    if (isEquivalent(input, match)) {
      return {
        plan: done,
        outcome: "ticked",
        matchedId: match.id,
        headline: "Ticked off ✓",
        detail: `Matched your planned “${match.title}” — marked complete.`,
        coachPrefill: `I completed today's ${d} as planned: ${durTxt}${distTxt}${feelClause(input)}. Anything to note for tomorrow?`,
      };
    }
    return {
      plan: done,
      outcome: "adjusted",
      matchedId: match.id,
      headline: "Logged — credited what you did",
      detail: `Your ${d} (${durTxt}${distTxt}) differed from the planned ${fmtDuration(match.estDurationSec)} — credited the actual.`,
      coachPrefill: `Today's ${d} came out as ${durTxt}${distTxt}${feelClause(input)}, vs the planned ${fmtDuration(match.estDurationSec)}. Should I adjust the coming days?`,
    };
  }

  // did a different sport than planned → swap the credit to what they actually did
  let swapped = logInstead(plan, match.id, input.note ?? `Did ${d} instead of ${match.discipline}`, {
    discipline: d,
    durationSec: input.durationSec,
  });
  swapped = logCheckin(swapped, match.id, {
    rpe: input.rpe,
    feel: input.feel,
    actualDurationSec: input.durationSec,
    actualDistanceM: input.distanceM,
  });
  return {
    plan: swapped,
    outcome: "swapped",
    matchedId: match.id,
    headline: "Swapped ✓",
    detail: `Did a ${d} in place of your planned ${match.discipline} — credited to ${d}.`,
    coachPrefill: `Instead of my planned ${match.discipline} today, I did a ${d}: ${durTxt}${distTxt}${feelClause(input)}. Is that okay, or should I make up the ${match.discipline}?`,
  };
}

/** Move a workout to a new date (kept inside the plan window). Returns null if invalid. */
export function moveWorkout(plan: Plan, id: string, newDateISO: string): Plan {
  const p = clonePlan(plan);
  const w = p.workouts[id];
  if (!w) return p;
  const start = fromISO(p.startDateISO).getTime();
  const end = fromISO(addDays(p.weeks[p.weeks.length - 1].startDate, 6)).getTime();
  const t = fromISO(newDateISO).getTime();
  if (t < start || t > end) return p; // out of range → ignore
  p.workouts[id] = { ...w, date: newDateISO, movedFrom: w.movedFrom ?? w.date, status: "moved" };
  reindexWeeks(p);
  // moved workouts should present as still-to-do
  p.workouts[id] = { ...p.workouts[id], status: "planned", movedFrom: w.movedFrom ?? w.date };
  return p;
}

function replacementDraft(ctx: BuildCtx, discipline: Discipline, minutes: number): Draft {
  const m = Math.max(20, Math.round(minutes));
  switch (discipline) {
    case "swim":
      return W.swimEndurance(ctx, Math.max(800, Math.round((m * 60 * 1.3) / 100) * 100));
    case "bike":
      return W.bikeEndurance(ctx, m);
    case "run":
      return W.runEasy(ctx, m);
    case "strength":
      return W.strength(ctx, Math.min(40, m));
    default:
      return W.runEasy(ctx, m);
  }
}

/** Swap a session for an easy session of a different discipline (keeps the day & id, so it's undoable).
 *
 *  The swapped session is sized to what the week can absorb on the MECHANICAL
 *  axis, not just handed the outgoing session's duration. Rebuilding at the same
 *  length is how a single tap used to add 75% to an athlete's weekly run volume:
 *  a 90-minute ride becomes a 90-minute run, the metabolic ledger doesn't move
 *  because the two cost the same sRPE, and nothing notices (doc 02 §4 #13).
 *  The swap itself is never refused — everything stays switchable, and it's the
 *  duration that gets fitted (doc 03 §4 F: never ramp the substitute sport
 *  faster than you'd ramp it fresh). */
export function swapDiscipline(plan: Plan, id: string, discipline: Discipline): Plan {
  const p = clonePlan(plan);
  const w = p.workouts[id];
  if (!w) return p;
  const ctx: BuildCtx = { paces: p.paces, level: p.profile.level };
  const requestedSec = w.estDurationSec || 2400;
  const allowance = swapAllowance(p, w, discipline, requestedSec);
  const draft = replacementDraft(ctx, discipline, Math.max(20 * 60, allowance.maxSec) / 60);
  // preserve the pre-swap session (or the earliest one, if already swapped) so it can be restored
  const original = w.swappedFrom ?? {
    discipline: w.discipline,
    type: w.type,
    title: w.title,
    purpose: w.purpose,
    segments: w.segments,
    estDurationSec: w.estDurationSec,
    estDistanceM: w.estDistanceM,
    primaryZone: w.primaryZone,
  };
  p.workouts[id] = {
    ...w,
    discipline: draft.discipline,
    type: draft.type,
    title: draft.title,
    purpose: draft.purpose,
    segments: draft.segments,
    estDurationSec: draft.estDurationSec,
    estDistanceM: draft.estDistanceM,
    primaryZone: draft.primaryZone,
    status: "planned",
    note: allowance.capped ? `Swapped from ${original.discipline} · kept short` : `Swapped from ${original.discipline}`,
    swappedFrom: original,
    impactCapped: allowance.capped ? allowance.reason ?? undefined : undefined,
  };
  return p; // same id / date / week — no reindex needed
}

/** Undo a swap, restoring the original session. */
export function unswapDiscipline(plan: Plan, id: string): Plan {
  const p = clonePlan(plan);
  const w = p.workouts[id];
  if (!w || !w.swappedFrom) return p;
  const o = w.swappedFrom;
  p.workouts[id] = {
    ...w,
    discipline: o.discipline,
    type: o.type,
    title: o.title,
    purpose: o.purpose,
    segments: o.segments,
    estDurationSec: o.estDurationSec,
    estDistanceM: o.estDistanceM,
    primaryZone: o.primaryZone,
    status: "planned",
    note: undefined,
    swappedFrom: undefined,
  };
  return p;
}

/**
 * Rebuild the remaining plan from today (the "realign / rebuild" action for
 * when you've fallen behind). Past workouts + their statuses are preserved;
 * future weeks are regenerated to still land on race day.
 */
export function rebuildFromToday(plan: Plan, todayISO: string): Plan {
  const fresh = generatePlan(plan.profile);
  const cutoff = fromISO(todayISO).getTime();

  // keep old workouts strictly before today (with their statuses). Their ids
  // (w-<week>-<day>-<disc>) reuse the same week indices the fresh plan will emit,
  // so we namespace them with a "kept-" prefix — otherwise a fresh future session
  // with the same relative index/day/discipline overwrites a completed past one,
  // silently wiping training history (banked hours, streaks, PRs) on every rebuild.
  // Also preserve a session ALREADY COMPLETED today — otherwise editing settings /
  // rebuilding on the same day resets it to "planned", losing the completion (and
  // the streak) despite the "completed sessions were kept" promise. We record its
  // date+discipline so the fresh plan doesn't drop a duplicate on the same slot.
  const kept: Record<string, Workout> = {};
  const keptTodayDone = new Set<string>();
  for (const w of Object.values(plan.workouts)) {
    const t = fromISO(w.date).getTime();
    const isPast = t < cutoff;
    const isTodayDone = t === cutoff && (w.status === "done" || w.status === "swapped");
    if (isPast || isTodayDone) {
      const id = `kept-${w.id}`;
      kept[id] = { ...w, id };
      if (isTodayDone) keptTodayDone.add(`${w.date}·${w.discipline}`);
    }
  }
  // add fresh workouts from today onward, minus any today slot already completed
  for (const w of Object.values(fresh.workouts)) {
    const t = fromISO(w.date).getTime();
    if (t < cutoff) continue;
    if (t === cutoff && keptTodayDone.has(`${w.date}·${w.discipline}`)) continue;
    kept[w.id] = w;
  }
  const merged: Plan = {
    ...fresh,
    workouts: kept,
    id: plan.id,
    // readiness + adaptation records are history — carry them across a rebuild
    // (weeks/easedWeeks regenerate, so the why-line gates on both)
    readiness: plan.readiness,
    adaptations: plan.adaptations,
    // Everything still "planned" before today is now absorbed history. Stamping the
    // date is what lets `missedSince` stop counting it — without this an automatic
    // realign would see the same misses forever and never converge.
    realignedAtISO: todayISO,
    notice: "Plan rebuilt around today — you're realigned to hit race day.",
  };
  reindexWeeks(merged);
  return merged;
}

/**
 * The sessions the athlete has genuinely fallen behind on: still `planned`, already
 * in the past, and not already absorbed by an earlier realign.
 *
 * Two floors matter, and both are load-bearing:
 *  • `createdAtISO` — a plan built on a Thursday back-dates to Monday, so the days
 *    before it existed were never the athlete's to miss. (A plan minutes old used to
 *    open with "You've missed 8 sessions.")
 *  • `realignedAtISO` — after a realign, the old misses survive as `kept-` history and
 *    stay `planned` forever. Counting them again is what made automatic realignment
 *    unsafe: it would re-trigger on every render and never settle.
 */
export function missedSince(plan: Plan, todayISO: string): Workout[] {
  const created = plan.profile.createdAtISO?.slice(0, 10);
  // whichever floor is later — the plan's birth, or the last time we realigned it
  const floor = [created, plan.realignedAtISO].filter(Boolean).sort().pop();
  return Object.values(plan.workouts).filter(
    (w) =>
      w.discipline !== "rest" &&
      w.status === "planned" &&
      w.date < todayISO &&
      (!floor || w.date >= floor),
  );
}

/** Which trigger eased a session — the why must distinguish "missed because life"
 *  from "felt too hard" from a low morning check-in (doc 02 §4 #11). */
export type EaseCause = "readiness" | "missed" | "strain" | "form" | "manual";

/** Ease the next N days: downgrade hard sessions to endurance, trim long ones. */
export function easeUpcoming(plan: Plan, fromISODate: string, days: number, cause: EaseCause = "manual"): Plan {
  const p = clonePlan(plan);
  const ctx: BuildCtx = { paces: p.paces, level: p.profile.level };
  const start = fromISO(fromISODate).getTime();
  const end = start + days * 86400000;
  for (const [id, w] of Object.entries(p.workouts)) {
    const t = fromISO(w.date).getTime();
    if (t < start || t > end) continue;
    if (w.status !== "planned") continue;
    const hard = ["threshold", "vo2", "tempo", "brick"].includes(w.type);
    if (hard) {
      const draft = replacementDraft(ctx, w.discipline === "brick" ? "bike" : w.discipline, (w.estDurationSec || 2400) / 60 * 0.8);
      p.workouts[id] = {
        ...w,
        type: draft.type,
        title: `Easy ${draft.title}`,
        purpose: "Dialed back so you can recover and come back stronger.",
        segments: draft.segments,
        estDurationSec: draft.estDurationSec,
        estDistanceM: draft.estDistanceM,
        primaryZone: draft.primaryZone,
        note: "Eased off",
        // keep the trigger + what the session WAS — the overwrite would otherwise
        // destroy the only honest answer to "why is today easy?"
        easedCause: cause,
        easedFrom: w.easedFrom ?? { type: w.type, primaryZone: w.primaryZone },
      };
    }
  }
  return p;
}

// ---- closed-loop adaptation --------------------------------------------
// The plan reacts to how the last two weeks actually went. Two directions:
//   • ease  — missed a lot, or sessions felt consistently hard → soften the
//             upcoming week (the protective move; this is the whole injury-safe
//             promise). Applied on the athlete's tap.
//   • ahead — nailed nearly everything and it felt easy → a positive nudge. We
//             deliberately DON'T pile on more load (that's how people get hurt);
//             the deterministic plan already progresses. It's encouragement only.

const isDoneW = (w: Workout) => w.status === "done" || w.status === "swapped";
const zoneRpeMid = (z: Zone) => (ZONES[z].rpe[0] + ZONES[z].rpe[1]) / 2;
const FEEL_STRAIN = { rough: 2, ok: 0, great: -1.5 } as const;

/** Above this, a single session felt materially harder than it was prescribed to —
 *  enough to offer an ease on the spot rather than waiting for a two-week trend. */
export const STRAIN_OFFER_EASE = 1.5;

/** How hard a completed session felt vs. what its zone prescribed (RPE units). */
export function sessionStrain(w: Workout): number | null {
  const parts: number[] = [];
  if (typeof w.rpe === "number") parts.push(w.rpe - zoneRpeMid(w.primaryZone));
  if (w.feel) parts.push(FEEL_STRAIN[w.feel]);
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export interface AdaptationSuggestion {
  kind: "ease" | "ahead";
  weekIndex: number; // the upcoming week the suggestion is about
  weekLabel: string;
  reason: string;
  /** which trigger fired — "missed because life" and "felt too hard" want
   *  different coaching, so the why-line must not collapse them (doc 02 §4 #11) */
  cause: "missed" | "strain" | "form";
  missed: number;
  scheduled: number;
  avgStrain: number | null;
  signals: number; // completed sessions with feedback considered
}

/** Look at the trailing two weeks and decide whether the upcoming week should be
 *  eased (or celebrate that the athlete's ahead). Pure. Returns null when the
 *  plan is on track or there isn't enough signal yet. */
export function assessAdaptation(plan: Plan, todayISO: string): AdaptationSuggestion | null {
  // the week containing today, and the next one (what we'd adjust)
  const cur = plan.weeks.find((w) => todayISO >= w.startDate && todayISO < addDays(w.startDate, 7));
  if (!cur) return null;
  const next = plan.weeks.find((w) => w.index === cur.index + 1);
  if (!next || next.isRaceWeek) return null; // never touch race week

  // Look back two weeks, but never before the plan existed — otherwise a brand-new plan's
  // pre-start days (it begins on mondayOf(today)) read as a wall of missed sessions and
  // trip the ease trigger on day one. createdAtISO is stable across rebuilds.
  const created = plan.profile.createdAtISO?.slice(0, 10);
  const window = addDays(todayISO, -14);
  const from = created && created > window ? created : window;
  const past = Object.values(plan.workouts).filter(
    (w) => w.discipline !== "rest" && w.date >= from && w.date < todayISO,
  );
  const scheduled = past.length;
  const missed = past.filter((w) => w.status === "skipped" || w.status === "planned").length;
  const strains = past.map(sessionStrain).filter((s): s is number => s != null);
  const avgStrain = strains.length ? strains.reduce((a, b) => a + b, 0) / strains.length : null;
  const missRate = scheduled ? missed / scheduled : 0;

  const easeable = next.phase === "base" || next.phase === "build" || next.phase === "peak";
  const alreadyEased = (plan.easedWeeks ?? []).includes(next.index);
  // Plain "Week N" for anything the athlete reads (#114). Derived, not the stored
  // week.label, so plans built before the change read correctly too.
  const nextLabel = next.isRaceWeek ? "race week" : `Week ${next.index + 1}`;

  // Cumulative fatigue debt: how far the athlete's real form has drifted BELOW what
  // this block was designed to cost them. Being "deep in it" is not a trigger — that's
  // what a build is — so this compares against the plan's own prescription rather than
  // against an absolute band. A compliant athlete measures exactly 0%.
  const deviation = formDeviation(plan, todayISO);
  const formDebt = deviation != null && deviation.deltaPct <= FORM_DEBT_EASE_PCT;

  // EASE: fell behind, the work is consistently overreaching, or fatigue has compounded
  // further than the design intended.
  if (
    easeable &&
    !alreadyEased &&
    (missRate >= 0.4 || (strains.length >= 3 && avgStrain != null && avgStrain >= 1.5) || formDebt)
  ) {
    const cause = missRate >= 0.4 ? "missed" : strains.length >= 3 && avgStrain != null && avgStrain >= 1.5 ? "strain" : "form";
    const reason =
      cause === "missed"
        ? `You've missed ${missed} of ${scheduled} sessions in the last two weeks.`
        : cause === "strain"
        ? `Your recent sessions have felt consistently hard.`
        : `Your fatigue has run deeper than this block was designed to put you.`;
    return { kind: "ease", weekIndex: next.index, weekLabel: nextLabel, reason, cause, missed, scheduled, avgStrain, signals: strains.length };
  }

  // AHEAD: nailing it and feeling comfortable — encouragement, no extra load.
  if (easeable && missRate <= 0.1 && strains.length >= 3 && avgStrain != null && avgStrain <= -1.0) {
    return {
      kind: "ahead",
      weekIndex: next.index,
      weekLabel: nextLabel,
      reason: "You've hit nearly everything and it's feeling comfortable.",
      cause: "strain",
      missed,
      scheduled,
      avgStrain,
      signals: strains.length,
    };
  }
  return null;
}

/** Apply an adaptation. Easing softens the target week and records it so we don't
 *  re-suggest; "ahead" changes nothing structural (by design) beyond marking it. */
export function applyAdaptation(plan: Plan, s: AdaptationSuggestion): Plan {
  if (s.kind !== "ease") return plan;
  const wk = plan.weeks.find((w) => w.index === s.weekIndex);
  if (!wk) return plan;
  // soften every hard session across that week (Mon–Sun)
  const eased = easeUpcoming(plan, wk.startDate, 6, s.cause);
  const targetWeek = eased.weeks.find((w) => w.index === s.weekIndex);
  if (targetWeek) targetWeek.targetHours = Math.round(targetWeek.targetHours * 0.9 * 2) / 2;
  eased.easedWeeks = [...(plan.easedWeeks ?? []), s.weekIndex];
  // keep the trigger + its numbers: after applying, the suggestion is gone and
  // this record is the only honest answer to "why was this week softened?"
  eased.adaptations = [
    ...(plan.adaptations ?? []).filter((a) => a.weekIndex !== s.weekIndex),
    { weekIndex: s.weekIndex, cause: s.cause, reason: s.reason, missed: s.missed, scheduled: s.scheduled },
  ];
  eased.notice = `We eased ${wk.label} so you absorb the training and stay healthy.`;
  return eased;
}

// ---- week / plan progress helpers (for the UI) ----

export function weekProgress(plan: Plan, wk: Week): { done: number; total: number; plannedSec: number; doneSec: number } {
  let done = 0;
  let plannedSec = 0;
  let doneSec = 0;
  const total = wk.workoutIds.filter((id) => plan.workouts[id]?.discipline !== "rest").length;
  for (const id of wk.workoutIds) {
    const w = plan.workouts[id];
    if (!w) continue;
    plannedSec += w.estDurationSec || 0;
    if (w.status === "done" || w.status === "swapped") {
      done++;
      doneSec += creditedSeconds(w);
    }
  }
  return { done, total, plannedSec, doneSec };
}

export interface ComplianceColor {
  status: Workout["status"];
  color: string;
  label: string;
}

export function complianceOf(w: Workout): ComplianceColor {
  switch (w.status) {
    case "done":
      return { status: w.status, color: "var(--success)", label: "Completed" };
    case "swapped":
      return { status: w.status, color: "var(--z3)", label: "Swapped" };
    case "skipped":
      return { status: w.status, color: "var(--danger)", label: "Skipped" };
    case "moved":
      return { status: w.status, color: "var(--z2)", label: "Moved" };
    default:
      return { status: w.status, color: "var(--muted)", label: "Planned" };
  }
}

const DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function raceLabel(plan: Plan): string {
  const p = plan.profile;
  return p.raceType === "custom"
    ? p.custom?.name || "custom race"
    : p.raceType === "olympic"
    ? "Olympic-distance triathlon"
    : p.raceType === "half"
    ? "Ironman 70.3"
    : p.raceType === "fitness"
    ? "general fitness"
    : "full Ironman";
}

/** The goal line for AI context — a race + date, or "just getting fitter". */
function goalLine(plan: Plan): string {
  const p = plan.profile;
  return isFitnessGoal(p)
    ? `Goal: general fitness — no target race. Level: ${p.level}.`
    : `Race: ${raceLabel(plan)} on ${plan.raceDateISO}. Level: ${p.level}.`;
}

/** Build the context string the AI coach is given.
 *
 *  `includeHealth` defaults to FALSE and that is the whole point. This function used to
 *  put the athlete's injuries — area, severity, affected disciplines — into every coach
 *  request unconditionally. That is a second health-data → third-party path alongside
 *  /api/intake, and unlike that one it had no consent gate and no disclosure anywhere.
 *  Health context is now opt-in per athlete, on the same consent as the injury analyser
 *  (ticket #63); without it the coach still works, it just doesn't get told what hurts. */
export function summarizeForCoach(
  plan: Plan,
  todayISO: string,
  opts?: { includeHealth?: boolean },
): string {
  const p = plan.profile;
  // Calendar comparison, not fixed-ms: after spring-forward a 7*86400000ms window overshoots
  // the next local Monday midnight by an hour and mis-buckets that Monday (same DST hazard
  // reindexWeeks was fixed against). Match assessAdaptation's safe string form.
  const wk = plan.weeks.find((week) => todayISO >= week.startDate && todayISO < addDays(week.startDate, 7));
  const today = Object.values(plan.workouts).filter((w) => w.date === todayISO);
  const lines: string[] = [];
  lines.push(goalLine(plan));
  if (wk) lines.push(`Current week: ${wk.label} (${wk.phase} phase), target ${wk.targetHours}h. Focus: ${wk.focus}`);
  if (opts?.includeHealth && p.injuries?.length) {
    lines.push(
      `Working around: ${p.injuries.map((i) => `${i.area} (${i.severity}, ${i.disciplines.join("/")})`).join("; ")}.`,
    );
  }
  if (p.strength?.enabled) {
    const split =
      p.strength.split === "custom" ? `their own (${p.strength.customSplit?.trim() || "athlete-defined"})` : `${p.strength.split} split`;
    lines.push(`Strength: ${p.strength.daysPerWeek}×/week, ${split}.`);
  }
  if (today.length) {
    lines.push(
      `Today's sessions: ${today
        .map((w) => `${coachSafeTitle(w)} (${w.discipline}, ${fmtDuration(w.estDurationSec)})`)
        .join("; ")}`,
    );
  } else {
    lines.push("Today is a rest day.");
  }
  return lines.join("\n");
}

/** A compact description of the athlete + finished plan for the "why this plan" note. */
export function planSummaryContext(plan: Plan): string {
  const p = plan.profile;
  const lines: string[] = [];
  lines.push(goalLine(plan));
  lines.push(
    `Plan length: ${plan.totalWeeks} weeks${
      isFitnessGoal(p) ? " (rolling fitness block)" : plan.compressed ? " (compressed — race is soon)" : plan.delayedStart ? " (starts later — race is far out)" : ""
    }.`,
  );
  const byPhase: Record<string, number> = {};
  for (const w of plan.weeks) byPhase[w.phase] = (byPhase[w.phase] ?? 0) + 1;
  lines.push(
    `Phase weeks — base ${byPhase.base ?? 0}, build ${byPhase.build ?? 0}, peak ${byPhase.peak ?? 0}, taper ${byPhase.taper ?? 0}.`,
  );
  const peak = plan.weeks.reduce((m, w) => Math.max(m, w.targetHours), 0);
  lines.push(`Peak training week ~${peak}h.`);
  if (p.perSport) lines.push(`Weekly sessions: swim ${p.perSport.swim}, bike ${p.perSport.bike}, run ${p.perSport.run}.`);
  else lines.push(`About ${p.workoutsPerWeek} sessions a week.`);
  if (p.focusDiscipline) lines.push(`Prioritising their ${p.focusDiscipline}.`);
  if (p.strength?.enabled) {
    const split =
      p.strength.split === "custom" ? `their own (${p.strength.customSplit?.trim() || "athlete-defined"})` : `${p.strength.split} split`;
    lines.push(`Strength: ${p.strength.daysPerWeek}×/week, ${split}.`);
  }
  else lines.push("No strength training.");
  if (p.restDayPreference != null) lines.push(`Preferred rest day: ${DOW[p.restDayPreference]}.`);
  if (p.longSessionDay != null) lines.push(`Long-session day: ${DOW[p.longSessionDay]}.`);
  if (p.weeklyHoursCap) lines.push(`Weekly hours capped at ${p.weeklyHoursCap}.`);
  if (p.equipment) {
    const lack: string[] = [];
    if (p.equipment.pool === false) lack.push("no pool (swim is dry-land only)");
    if (p.equipment.gym === false) lack.push("no gym (strength is bodyweight at home)");
    if (p.equipment.trainer === false) lack.push("no indoor trainer");
    if (lack.length) lines.push(`Equipment limits: ${lack.join("; ")}.`);
  }
  if (p.injuries?.length) {
    lines.push(
      `Injuries to work around: ${p.injuries
        .map((i) => `${i.area} (${i.severity}, affects ${i.disciplines.join("/")})`)
        .join("; ")}.`,
    );
  }
  if (p.blackouts?.length) {
    lines.push(
      `Days off: ${p.blackouts.map((b) => `${b.startISO}→${b.endISO}${b.label ? ` (${b.label})` : ""}`).join("; ")}.`,
    );
  }
  if (p.intakeNotes) lines.push(`Athlete's own note: ${p.intakeNotes}`);
  return lines.join("\n");
}
