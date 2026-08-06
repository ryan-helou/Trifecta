// ---------------------------------------------------------------------------
// Giving the Coach hands.
//
// Until now the Coach could only talk: it read a summary of the plan and replied
// with text. "Hey, give me an easier one today, switch it up" produced advice
// about an easier session rather than an easier session.
//
// THE LLM DOES NOT TOUCH THE PLAN. Intent is matched here, deterministically,
// and the change itself is made by the same engine functions the buttons use.
// That's deliberate on three counts: the plan engine is the product's moat
// precisely because it's deterministic and costs ~$0 per plan; a model emitting
// plan JSON would route around every safety rail in lib/rails.ts and
// lib/mechanical.ts; and an athlete has to be able to trust that the same
// sentence does the same thing twice.
//
// So this is a small, conservative intent matcher — not natural-language
// understanding, and it doesn't pretend to be. It fires only on clear phrasing,
// it always produces a PREVIEW the athlete confirms rather than acting on its
// own, and when it isn't sure it returns null and the Coach simply answers in
// words like before. A wrong guess that silently rewrites training is far worse
// than a missed one.
//
// Pure — no clock, no I/O, no network. The caller supplies today.
// ---------------------------------------------------------------------------

import { easeUpcoming, setStatus, swapDiscipline } from "./adapt";
import { railsRegressed } from "./rails";
import type { Discipline, Plan, Workout } from "./types";

export type CoachAction =
  | { kind: "ease-today"; workoutId: string }
  | { kind: "ease-week" }
  | { kind: "swap"; workoutId: string; to: Discipline }
  | { kind: "skip"; workoutId: string };

export interface ActionPreview {
  action: CoachAction;
  plan: Plan;
  /** what will happen, in one sentence, before it happens */
  summary: string;
  changedIds: string[];
}

const SPORT_WORDS: { re: RegExp; d: Discipline }[] = [
  { re: /\b(run|jog|running)\b/i, d: "run" },
  { re: /\b(bike|ride|cycle|cycling|riding)\b/i, d: "bike" },
  { re: /\b(swim|swimming|pool)\b/i, d: "swim" },
  { re: /\b(strength|gym|lift|weights)\b/i, d: "strength" },
];

// Phrasings that clearly ask for less. Kept narrow on purpose: "hard" alone is
// not here, because "how hard should this feel?" is a question, not a request.
const EASIER = /\b(easier|easy day|lighter|less intense|take it easy|go easy|dial (it )?back|too hard|too much|tone it down|scale (it )?back)\b/i;
const WEEK_SCOPE = /\b(this week|the week|all week|rest of the week|next few days)\b/i;
const SKIP = /\b(skip|miss|drop|bin|cancel) (it|today|this|this one|the session|today's)\b/i;
const SWAP = /\b(swap|switch|change|make it|turn it into|instead of|rather than|do a)\b/i;

/** Today's first real session — the thing "today" refers to in conversation. */
function todaySession(plan: Plan, todayISO: string): Workout | null {
  const on = Object.values(plan.workouts)
    .filter((w) => w.date === todayISO && w.discipline !== "rest" && w.status === "planned")
    .sort((a, b) => a.id.localeCompare(b.id));
  return on[0] ?? null;
}

/** Match an actionable request in what the athlete typed, or null when there
 *  isn't one clearly enough to act on. Null is the common, correct answer. */
export function detectAction(text: string, plan: Plan, todayISO: string): CoachAction | null {
  const t = text.trim();
  if (!t) return null;
  const today = todaySession(plan, todayISO);

  // A question about a change is not a request for one. "should I skip today?"
  // wants an opinion; "skip today" wants an action. Anything ending in a
  // question mark falls through to the talking Coach.
  if (/\?\s*$/.test(t)) return null;

  if (SKIP.test(t) && today) return { kind: "skip", workoutId: today.id };

  if (EASIER.test(t)) {
    if (WEEK_SCOPE.test(t)) return { kind: "ease-week" };
    if (today) return { kind: "ease-today", workoutId: today.id };
    return { kind: "ease-week" };
  }

  if (SWAP.test(t) && today) {
    // the sport being asked FOR, ignoring a mention of the one being replaced
    const wanted = SPORT_WORDS.filter((s) => s.re.test(t)).map((s) => s.d).filter((d) => d !== today.discipline);
    if (wanted.length === 1) return { kind: "swap", workoutId: today.id, to: wanted[0] };
  }

  return null;
}

const changedBetween = (before: Plan, after: Plan): string[] =>
  Object.keys(after.workouts).filter((id) => {
    const a = before.workouts[id];
    const b = after.workouts[id];
    if (!a) return true;
    return (
      a.estDurationSec !== b.estDurationSec ||
      a.primaryZone !== b.primaryZone ||
      a.discipline !== b.discipline ||
      a.status !== b.status ||
      a.title !== b.title
    );
  });

/** Turn an action into a concrete plan the athlete can look at before accepting.
 *
 *  Returns null when the action would change nothing — an easy week has nothing
 *  to soften, and offering an "Apply" button that does nothing is the dead-button
 *  bug (#108) all over again. */
export function previewAction(plan: Plan, todayISO: string, action: CoachAction): ActionPreview | null {
  let next: Plan;
  let summary: string;

  switch (action.kind) {
    case "ease-today": {
      const w = plan.workouts[action.workoutId];
      if (!w) return null;
      next = easeUpcoming(plan, todayISO, 0, "manual");
      summary = `Swap ${w.title} for something easier today.`;
      break;
    }
    case "ease-week": {
      next = easeUpcoming(plan, todayISO, 7, "manual");
      summary = "Dial back the hard sessions for the next 7 days.";
      break;
    }
    case "swap": {
      const w = plan.workouts[action.workoutId];
      if (!w) return null;
      next = swapDiscipline(plan, action.workoutId, action.to);
      const after = next.workouts[action.workoutId];
      summary = after?.impactCapped
        ? `Swap today's ${w.discipline} for a ${action.to} — kept to ${Math.round((after.estDurationSec ?? 0) / 60)} min so the extra load ramps safely.`
        : `Swap today's ${w.discipline} for a ${action.to}.`;
      break;
    }
    case "skip": {
      const w = plan.workouts[action.workoutId];
      if (!w) return null;
      next = setStatus(plan, action.workoutId, "skipped");
      summary = `Mark ${w.title} as skipped.`;
      break;
    }
  }

  const changedIds = changedBetween(plan, next);
  if (!changedIds.length) return null;

  // The Coach gets no privileges the buttons don't have. Anything that would
  // push the plan further out of its safety bounds is refused here, so a
  // conversational path can never become the way around the rails.
  if (railsRegressed(plan, next).length) return null;

  return { action, plan: next, summary, changedIds };
}

/** Convenience: text in, reviewable change out, or null to just talk. */
export function proposeFromText(text: string, plan: Plan, todayISO: string): ActionPreview | null {
  const action = detectAction(text, plan, todayISO);
  return action ? previewAction(plan, todayISO, action) : null;
}
