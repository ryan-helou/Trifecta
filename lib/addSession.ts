// ---------------------------------------------------------------------------
// "I've got a spare hour — what should I do?"
//
// Ticket #209, in Ryan's words: "today i only have a run and i completed it, i feel like
// going on a bike but idk what to do according to the plan. can we create an add workout,
// and you select which type (or any type), and it adds it to the day fitting the most
// soundly with ur plan."
//
// The important half of that is "according to the plan". Logging an extra session already
// works (`logWorkout` → a bonus entry), but that is RETROSPECTIVE — it records what you
// did. This is prospective: the athlete has time and energy and wants the plan to tell
// them what to spend it on, which is exactly the question a coach exists to answer.
//
// The answer is almost always "something easy", and that is not a cop-out — it is the
// whole point. A bonus session is unplanned load landing on a week that was already
// budgeted, so doc 03 §4 C's asymmetry applies at its sharpest: a missed adaptation costs
// a little fitness, an added one costs an injury. So this module says yes to the session
// and argues about its INTENSITY and its LENGTH, never about whether it happens — the same
// stance `swapAllowance` takes, and for the same reason.
//
// Everything here is pure. The caller supplies today.
// ---------------------------------------------------------------------------

import { addDays } from "./dates";
import { injuryMods, isHardLoading } from "./planEngine";
import { impactHeadroomMinutes, IMPACT_BONUS_MAX, IMPACT_PER_MIN } from "./mechanical";
import type { Discipline, Plan, Profile, Workout } from "./types";
import { BuildCtx } from "./workouts";
import * as W from "./workouts";

/** The sports an athlete can ask for. "any" lets the plan choose. */
export type AddChoice = Discipline | "any";

/**
 * The answer to "what should I do?" — which is sometimes "not that, but here's what".
 *
 * A silent null was the first shape and it was wrong twice over: the athlete asked a
 * question and got nothing back, and the commonest refusal ("your legs have had a lot this
 * week") has an obvious better answer sitting next to it, because swimming costs the tissue
 * nothing and a bike costs a twentieth of what a run does. Refusing without offering the
 * alternative is the app being unhelpful in the exact moment someone wanted to train.
 */
export type AddOutcome =
  | ({ kind: "ok" } & SessionSuggestion)
  | { kind: "no"; reason: string; alternative?: SessionSuggestion };

export interface SessionSuggestion {
  discipline: Exclude<Discipline, "rest" | "brick">;
  minutes: number;
  title: string;
  /** one sentence, athlete-facing: why this sport, this hard, this long */
  reason: string;
  /** true when the day/week forced something gentler or shorter than usual */
  constrained: boolean;
}

/** The longest a bonus session should ever be. Beyond this it stops being "I felt like
 *  riding" and becomes a training session the week never budgeted for. */
export const MAX_BONUS_MIN = 90;
/** Below this it isn't worth the changing-room. */
export const MIN_BONUS_MIN = 20;

const SPORTS = ["swim", "bike", "run"] as const;
type Sport = (typeof SPORTS)[number];

/** Sessions already on that date that actually cost something. */
function onDate(plan: Plan, dateISO: string): Workout[] {
  return Object.values(plan.workouts).filter((w) => w.date === dateISO && w.discipline !== "rest");
}

/** Would adding here land a hard session next to another one? Reuses the engine's own
 *  definition so this can't drift from what the scheduler enforces. */
function nearHardWork(plan: Plan, dateISO: string): boolean {
  for (const d of [addDays(dateISO, -1), dateISO, addDays(dateISO, 1)]) {
    if (onDate(plan, d).some(isHardLoading)) return true;
  }
  return false;
}

/**
 * Which sport the plan would most like to see.
 *
 * Not "the one you've done least" in absolute terms — sports aren't comparable that way,
 * an hour of swimming is not an hour of running. It's the one furthest behind ITS OWN
 * share of the week, which is the only question with a well-defined answer.
 */
function sportMostBehind(plan: Plan, dateISO: string, mods: ReturnType<typeof injuryMods>): Sport | null {
  const week = plan.weeks.find((w) => dateISO >= w.startDate && dateISO < addDays(w.startDate, 7));
  if (!week) return null;
  let worst: Sport | null = null;
  let worstRatio = Infinity;
  for (const s of SPORTS) {
    if (mods[s].avoid) continue; // never push an athlete toward a sport we're protecting
    let planned = 0;
    let done = 0;
    for (const id of week.workoutIds) {
      const w = plan.workouts[id];
      if (!w) continue;
      // a brick trains bike and run both — credit it to both
      const trains = w.discipline === "brick" ? ["bike", "run"] : [w.discipline];
      if (!trains.includes(s)) continue;
      planned += w.estDurationSec;
      if (w.status === "done" || w.status === "swapped") done += w.estDurationSec;
    }
    if (planned <= 0) return s; // a sport with nothing scheduled this week is the clearest gap
    const ratio = done / planned;
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worst = s;
    }
  }
  return worst;
}

/**
 * What to do with a spare hour on `dateISO` — or null when the honest answer is "nothing".
 *
 * Returns a SUGGESTION rather than mutating, so the UI can show the athlete what they're
 * about to get and let them change the sport before committing.
 */
/**
 * The core decision for ONE sport. Never recurses — it can only ever answer about the sport
 * it was handed, and its refusals carry no `alternative`.
 *
 * Split out from `suggestSession` because the two responsibilities are genuinely different
 * and mixing them was a bug, not a style choice: the public entry point wants to answer a
 * refusal with "…but here's what would work", and finding that answer means asking about
 * the other sports — which, when it lived in one function, called itself until the stack
 * gave out.
 */
function evaluateSport(plan: Plan, profile: Profile, dateISO: string, choice: AddChoice): AddOutcome {
  // Never on race day, and never the day before — those are the two days in the whole plan
  // where an extra session can only cost the athlete something.
  if (plan.raceDateISO && dateISO === plan.raceDateISO) {
    return { kind: "no", reason: "It's race day. Nothing you add now will make you fitter — go and race." };
  }
  if (plan.raceDateISO && dateISO === addDays(plan.raceDateISO, -1)) {
    return { kind: "no", reason: "That's the day before your race. Resting is the session." };
  }
  const week = plan.weeks.find((w) => dateISO >= w.startDate && dateISO < addDays(w.startDate, 7));
  if (!week) return { kind: "no", reason: "That date isn't inside your plan." };

  const mods = injuryMods(profile);
  const noPool = profile.equipment?.pool === false;

  // ---- which sport ---------------------------------------------------------
  let sport: Sport | null;
  if (choice === "any") {
    sport = sportMostBehind(plan, dateISO, mods);
  } else if (choice === "swim" || choice === "bike" || choice === "run") {
    sport = choice;
  } else {
    sport = null; // strength/brick/rest aren't prescribed here
  }
  if (!sport) return { kind: "no", reason: "Pick swim, bike or run — strength and bricks aren't prescribed this way." };
  // They told us it hurts. Adding volume to it is the one thing not to do — but say what
  // they CAN do instead, rather than just refusing.
  if (mods[sport].avoid) {
    return { kind: "no", reason: `You've told us your ${sport} is hurting, so that's the one thing not to add to.` };
  }
  if (sport === "swim" && noPool) {
    return { kind: "no", reason: "You've said you haven't got a pool." };
  }

  const asked = choice !== "any";
  const behind = sportMostBehind(plan, dateISO, mods);

  // ---- how hard ------------------------------------------------------------
  // A bonus session is unbudgeted load. It is easy unless there is a positive reason
  // otherwise — and there almost never is.
  const cap = mods[sport].capZone;
  const crowded = nearHardWork(plan, dateISO);
  const already = onDate(plan, dateISO);

  // ---- how long ------------------------------------------------------------
  // Reuse the mechanical ramp model rather than inventing a second one: it already knows
  // what this week can absorb before the tissue load becomes a spike.
  const perMin = IMPACT_PER_MIN[sport] ?? 0;
  // The BONUS ceiling, not the swap ramp: a voluntary extra session is not sustained
  // weekly growth, and gating it at the 10% rule allowed 13-20 min of running, which is
  // below the length a run is worth changing for — so every run was refused (#211).
  const headroom = impactHeadroomMinutes(plan, week.index, IMPACT_BONUS_MAX);
  const roomMin = perMin > 0 ? headroom / perMin : MAX_BONUS_MIN;
  // a day that already carries two sessions gets a shorter third
  const dayCrowding = already.length >= 2 ? 0.6 : already.length === 1 ? 0.85 : 1;
  let minutes = Math.floor(Math.min(MAX_BONUS_MIN, roomMin) * dayCrowding);
  minutes = Math.round(minutes / 5) * 5;
  const constrained = minutes < MAX_BONUS_MIN;
  if (minutes < MIN_BONUS_MIN) {
    return {
      kind: "no",
      reason: `Your legs have already taken a lot this week — another ${sport} would make it a spike rather than a session.`,
    };
  }

  const title =
    sport === "swim" ? "Easy Technique Swim" : sport === "bike" ? "Easy Aerobic Ride" : "Easy Aerobic Run";

  // ---- say why -------------------------------------------------------------
  const why: string[] = [];
  if (!asked && behind === sport) why.push(`your ${sport} is the furthest behind this week`);
  if (crowded) why.push("there's hard work either side of today, so this stays genuinely easy");
  else if (cap <= 2) why.push("it stays aerobic while that niggle settles");
  if (minutes < MAX_BONUS_MIN && roomMin < MAX_BONUS_MIN) {
    why.push(`${minutes} min is what this week can take without turning into a spike`);
  } else if (already.length) {
    why.push(`kept to ${minutes} min since you've already trained today`);
  }
  const reason = why.length
    ? why.join(", ").replace(/^./, (c) => c.toUpperCase()) + "."
    : `An easy ${minutes}-minute ${sport} — extra aerobic time never hurts, and it won't cost you tomorrow.`;

  return { kind: "ok", discipline: sport, minutes, title, reason, constrained };
}

/**
 * What to do with a spare hour on `dateISO`.
 *
 * Answers for the sport asked for; when that sport can't take it, explains why and offers
 * the one that can. The sports differ enormously in what they cost the tissue — a minute of
 * running is twenty of cycling and infinitely more than swimming — so "no" almost always
 * has a better neighbour, and a bare refusal would be the app being unhelpful in the exact
 * moment someone wanted to train.
 */
export function suggestSession(
  plan: Plan,
  profile: Profile,
  dateISO: string,
  choice: AddChoice = "any",
): AddOutcome {
  const first = evaluateSport(plan, profile, dateISO, choice);
  if (first.kind === "ok") return first;

  // Ordered cheapest-on-the-tissue LAST, so the alternative offered is the closest thing to
  // real training this day can take rather than reflexively "go for a swim".
  const asked = choice === "any" ? null : choice;
  for (const s of ["run", "bike", "swim"] as const) {
    if (s === asked) continue;
    const alt = evaluateSport(plan, profile, dateISO, s);
    if (alt.kind === "ok") return { ...first, alternative: alt };
  }
  return first;
}

export interface AddedSession {
  plan: Plan;
  workout: Workout;
  /** one sentence, athlete-facing */
  summary: string;
}

/**
 * Commit a suggested session onto the plan.
 *
 * Emitted as a real planned workout — same shape as anything the engine produces — so
 * every downstream surface (the ledger, Progress, the ring, adaptation) counts it without
 * needing to know it was added by hand.
 */
export function addSession(
  plan: Plan,
  profile: Profile,
  dateISO: string,
  choice: AddChoice = "any",
): AddedSession | null {
  const out = suggestSession(plan, profile, dateISO, choice);
  if (out.kind !== "ok") return null;
  const s = out;

  const ctx: BuildCtx = { paces: plan.paces, level: profile.level };
  const draft =
    s.discipline === "swim"
      ? W.swimTechnique(ctx, s.minutes, injuryMods(profile).swim.capZone)
      : s.discipline === "bike"
      ? W.bikeEndurance(ctx, s.minutes)
      : W.runEasy(ctx, s.minutes);

  const week = plan.weeks.find((w) => dateISO >= w.startDate && dateISO < addDays(w.startDate, 7));
  if (!week) return null;

  const base = `added-${dateISO}-${s.discipline}`;
  let id = base;
  let n = 1;
  while (plan.workouts[id]) id = `${base}-${++n}`;

  const dayIndex = Math.max(
    0,
    Math.round((Date.parse(dateISO + "T00:00:00Z") - Date.parse(week.startDate + "T00:00:00Z")) / 86400000),
  );

  const workout: Workout = {
    id,
    date: dateISO,
    weekIndex: week.index,
    dayIndex,
    discipline: draft.discipline,
    type: draft.type,
    title: draft.title,
    // The athlete asked for this one, so say why the plan shaped it the way it did —
    // otherwise an "easy 40 min" reads as the app being stingy rather than deliberate.
    purpose: `${s.reason} ${draft.purpose}`,
    segments: draft.segments,
    estDurationSec: draft.estDurationSec,
    estDistanceM: draft.estDistanceM,
    primaryZone: draft.primaryZone,
    status: "planned",
    // Marks this as the athlete's own addition, so the ramp baseline ignores it — see
    // `prescribedImpactMinutes`. Without it, every bonus session raises the ceiling that
    // permits the next one.
    addedByAthlete: true,
    note: "Added by you",
  };

  const next: Plan = {
    ...plan,
    workouts: { ...plan.workouts, [id]: workout },
    weeks: plan.weeks.map((w) =>
      w.index === week.index ? { ...w, workoutIds: [...w.workoutIds, id] } : w,
    ),
  };

  return {
    plan: next,
    workout,
    summary: `Added a ${s.minutes}-minute ${s.discipline === "swim" ? "swim" : s.discipline === "bike" ? "ride" : "run"}. ${s.reason}`,
  };
}
