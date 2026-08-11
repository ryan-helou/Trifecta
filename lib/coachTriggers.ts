// ---------------------------------------------------------------------------
// The proactive coach — deciding WHEN to speak, and what to say (#42).
//
// Today the coach only answers when asked. A real one gets in touch: on Monday
// with the week ahead, when you're clearly cooked, after it has absorbed a bad
// week, and in the last days before a race. That is the difference between a
// tool you remember to open and something that shows up.
//
// TWO RULES SHAPE EVERY LINE OF THIS FILE
//
// 1. NO LLM IN THE HOT PATH. Ticket #42 is explicit, and it is also the business:
//    a deterministic engine costs ~$0 per athlete per week, which is the whole
//    cost moat (doc 01 §4 #14, competitor doc §7B.5). An LLM may one day NARRATE
//    a message this file has already decided; it may never decide one.
//
// 2. AT MOST ONE MESSAGE A DAY, and never the same one twice. Nothing gets an app
//    deleted faster than a chatty coach, and a proactive channel that cries wolf
//    is worse than no channel — the athlete stops reading exactly the message that
//    mattered. Every message carries a stable `key`; the caller keeps the keys it
//    has already delivered and this file never re-emits one.
//
// Pure — no clock, no I/O, no randomness. `todayISO` is passed in, which is what
// makes the whole thing testable and what keeps it out of #49's clock trap.
// ---------------------------------------------------------------------------

import { addDays, dayIndexOf, daysBetween } from "./dates";
import { assessAdaptation, missedSince, weekProgress } from "./adapt";
import { formStateFor } from "./load";
import { fmtDuration } from "./format";
import type { Plan, Week, Workout } from "./types";

export type CoachTriggerKind =
  | "weekly-briefing" // #43
  | "ease-today" // #44
  | "race-week" // #46
  | "milestone"; // #47

export interface CoachMessage {
  kind: CoachTriggerKind;
  /** Stable across re-evaluation of the same day/week, so "already sent" is a set
   *  membership test rather than fuzzy matching on the text. */
  key: string;
  title: string;
  body: string;
  /** where tapping it should land */
  action?: { tab: "today" | "plan" | "progress"; workoutId?: string };
  /** higher wins when several fire on the same day */
  priority: number;
}

/**
 * Priority order, and the reasoning behind it.
 *
 * Safety outranks everything: if the athlete is cooked, that is the only thing
 * worth saying today. Race week outranks routine because the window is tiny and
 * non-repeating. Celebration comes last — a milestone is lovely and it can wait a
 * day; a warning cannot.
 */
const PRIORITY: Record<CoachTriggerKind, number> = {
  "ease-today": 100,
  "race-week": 80,
  "weekly-briefing": 40,
  milestone: 20,
};

/** Monday. The engine builds weeks Monday-first (`mondayOf`), so the briefing
 *  lands on the day the week actually turns rather than on an arbitrary date. */
const BRIEFING_DAY = 0;

/** How close to race day the taper sequence takes over. Two weeks is the taper
 *  itself (doc 01 §4 #6); the messages start once it's genuinely imminent. */
const RACE_WEEK_DAYS = 10;

export interface CoachContext {
  plan: Plan;
  todayISO: string;
  /** keys already delivered — the dedup ledger the caller persists */
  sent: Set<string>;
}

function weekOf(plan: Plan, iso: string): Week | undefined {
  return plan.weeks.find((w) => iso >= w.startDate && iso < addDays(w.startDate, 7));
}

function sessionsIn(plan: Plan, wk: Week): Workout[] {
  return wk.workoutIds.map((id) => plan.workouts[id]).filter((w): w is Workout => !!w && w.discipline !== "rest");
}

/**
 * The one session worth naming, or nothing.
 *
 * "Hardest, then longest" was the obvious rule and it produced SIX CONSECUTIVE
 * WEEKS of "Saturday's Long Endurance Ride is the one that matters" — base weeks
 * carry no Z4+ work, so the long ride won every time. A briefing that says the
 * same sentence every Monday is one the athlete stops reading, which costs more
 * than it gains.
 *
 * So a session only earns a mention when it is genuinely the week's event: real
 * quality (Z4+), or a brick, which is the session triathletes actually plan their
 * week around. Otherwise the briefing talks about the week instead, and the
 * pointer stays quiet until it has something to say.
 */
function keySession(plan: Plan, wk: Week): Workout | undefined {
  const planned = sessionsIn(plan, wk).filter((w) => w.status === "planned");
  const notable = planned.filter((w) => w.primaryZone >= 4 || w.discipline === "brick");
  if (!notable.length) return undefined;
  return notable.sort((a, b) => b.primaryZone - a.primaryZone || b.estDurationSec - a.estDurationSec)[0];
}

const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ---------------------------------------------------------------------------
// The triggers
// ---------------------------------------------------------------------------

/** #43 — Monday: the week ahead, and the one session that matters. */
function weeklyBriefing(ctx: CoachContext): CoachMessage | null {
  const { plan, todayISO } = ctx;
  if (dayIndexOf(todayISO) !== BRIEFING_DAY) return null;
  const wk = weekOf(plan, todayISO);
  if (!wk || wk.isRaceWeek) return null; // race week has its own voice

  const all = sessionsIn(plan, wk);
  if (!all.length) return null;
  const hours = all.reduce((a, w) => a + w.estDurationSec, 0);
  const key = keySession(plan, wk);
  const eased = (plan.easedWeeks ?? []).includes(wk.index);

  const lead = eased
    ? `This week is deliberately lighter — ${all.length} sessions, ${fmtDuration(hours)}.`
    : wk.isRecovery
    ? `Recovery week: ${all.length} sessions, ${fmtDuration(hours)}. Let it be easy.`
    : `${all.length} sessions this week, ${fmtDuration(hours)}.`;

  // A recovery week has no session that "matters" — saying so beside "let it be
  // easy" contradicts the instruction in the same breath.
  const pointer = key && !wk.isRecovery
    ? ` ${WEEKDAY[key.dayIndex]}'s ${key.title} is the one that matters.`
    : "";

  return {
    kind: "weekly-briefing",
    key: `briefing:${wk.index}`,
    title: wk.isRecovery ? "Recovery week" : `Week ${wk.index + 1}`,
    body: lead + pointer,
    action: { tab: "plan" },
    priority: PRIORITY["weekly-briefing"],
  };
}

/** #44 — you're cooked, and the plan is about to ask a lot. The proactive half of
 *  the readiness loop: the check-in already eases the day when you tell it you
 *  feel rough, but it can only do that if you open the app. This reaches out. */
function easeToday(ctx: CoachContext): CoachMessage | null {
  const { plan, todayISO } = ctx;
  const suggestion = assessAdaptation(plan, todayISO);
  if (!suggestion || suggestion.kind !== "ease") return null;
  // Only worth saying if there's something hard in the next few days to ease.
  const soon = Object.values(plan.workouts).filter(
    (w) => w.status === "planned" && w.date >= todayISO && w.date <= addDays(todayISO, 3) && w.primaryZone >= 4,
  );
  if (!soon.length) return null;

  const why =
    suggestion.cause === "missed"
      ? `You've missed ${suggestion.missed} of ${suggestion.scheduled} sessions in the last fortnight.`
      : suggestion.cause === "strain"
      ? "Your last few sessions have all felt harder than they were meant to."
      : "Your fatigue has run deeper than this block was designed to put you.";

  return {
    kind: "ease-today",
    key: `ease:${suggestion.weekIndex}:${suggestion.cause}`,
    title: "Let's take something off",
    body: `${why} I can soften ${suggestion.weekLabel} so you absorb the work instead of digging further.`,
    action: { tab: "today" },
    priority: PRIORITY["ease-today"],
  };
}

// #45 (miss-absorbed) is deliberately GONE. It opened with "I've adjusted your plan"
// over "You've missed N of M sessions", which is the app telling an athlete it quietly
// rewrote their week and then leading with the count of what they failed to do. Ryan,
// 2026-08-11: "remove the ive adjusted your plan ... please delete this popup." The
// adaptation itself still happens and is still explained where the change is — on the
// week it changed — rather than as an unprompted card that reads like a scolding.

/**
 * #46 — race week. The messages an athlete actually needs here are reassurance,
 * not instruction: the taper feels wrong (heavy legs, phantom niggles, the urge
 * to cram) and every one of those is normal and expected.
 *
 * One message per distinct day-out value, so the sequence advances rather than
 * repeating, and it never runs on a plan with no race.
 */
function raceWeek(ctx: CoachContext): CoachMessage | null {
  const { plan, todayISO } = ctx;
  if (!plan.raceDateISO) return null;
  const out = daysBetween(todayISO, plan.raceDateISO);
  if (out < 0 || out > RACE_WEEK_DAYS) return null;

  const form = formStateFor(plan, todayISO);
  const fresh = form?.band === "fresh";

  // Each band gets its OWN words. The first draft used one sentence for
  // everything above 3 days out, which shipped the identical message seven days
  // running — the fastest way to teach someone to ignore the channel.
  const body =
    out === 0
      ? "Today's the day. Everything you needed to do is already done — go and enjoy it."
      : out === 1
      ? "Tomorrow. Eat normally, lay your kit out tonight, and expect to sleep badly — nearly everyone does, and it makes no difference to how you race."
      : out === 2
      ? `Two days. Legs can feel flat and heavy right now${fresh ? " even though your form says you're ready" : ""} — that's the taper working, not a warning sign.`
      : out === 3
      ? "Three days. Phantom niggles show up about now and almost all of them vanish by race morning. Keep moving, keep it short."
      : out <= 5
      ? `${out} days. Nothing you do from here adds fitness — but plenty could cost it. Short, sharp, and stop while it still feels easy.`
      : out <= 7
      ? `${out} days out. Volume drops sharply this week while the intensity stays. That's deliberate: it's how you arrive fresh rather than tired.`
      : `${out} days out. The hard work is banked${fresh ? " and your form is already coming up" : ""}. From here the job is arriving rested.`;

  return {
    kind: "race-week",
    key: `race:${out}`,
    title: out === 0 ? "Race day" : `${out} day${out === 1 ? "" : "s"} to go`,
    body,
    action: { tab: "today" },
    priority: PRIORITY["race-week"],
  };
}

/** #47 — the occasional earned touch. Deliberately rare and strictly factual:
 *  praise that isn't tied to something real stops meaning anything fast. */
function milestone(ctx: CoachContext): CoachMessage | null {
  const { plan, todayISO } = ctx;
  const wk = weekOf(plan, todayISO);
  if (!wk) return null;
  const prog = weekProgress(plan, wk);
  // A week fully completed — but only a week with enough in it to be an
  // achievement. Race week holds one session, and "every one of the 1 sessions,
  // done" was both bad grammar and a hollow thing to congratulate someone for.
  const MIN_FOR_PERFECT = 4;
  if (prog.total >= MIN_FOR_PERFECT && prog.done === prog.total && !wk.isRaceWeek) {
    return {
      kind: "milestone",
      key: `perfect:${wk.index}`,
      title: "Perfect week",
      body: `All ${prog.total} sessions, done — ${fmtDuration(prog.doneSec)} banked.`,
      action: { tab: "progress" },
      priority: PRIORITY.milestone,
    };
  }
  return null;
}

const TRIGGERS = [easeToday, raceWeek, weeklyBriefing, milestone];

/**
 * Everything the coach could say today, best first.
 *
 * Returns them all rather than picking, so the caller can decide how many to
 * deliver on which channel — but `nextCoachMessage` below is the one almost
 * everything should use, because the answer is virtually always "at most one".
 */
export function coachMessagesFor(ctx: CoachContext): CoachMessage[] {
  return TRIGGERS.map((t) => t(ctx))
    .filter((m): m is CoachMessage => !!m && !ctx.sent.has(m.key))
    .sort((a, b) => b.priority - a.priority);
}

/** The single message worth sending today, or null. */
export function nextCoachMessage(ctx: CoachContext): CoachMessage | null {
  return coachMessagesFor(ctx)[0] ?? null;
}

/** Has the athlete already been spoken to today? The caller stores one key per
 *  delivery; this keeps the "one a day" rule in one place rather than at every
 *  call site. */
export function spokenToday(sentKeys: Iterable<string>, todayISO: string): boolean {
  for (const k of sentKeys) if (k.endsWith(`@${todayISO}`)) return true;
  return false;
}

/** The ledger entry for a delivered message: its identity AND the day it went
 *  out, so both "never repeat this" and "one a day" are answerable from the same
 *  stored set. */
export function deliveryKey(m: CoachMessage, todayISO: string): string {
  return `${m.key}@${todayISO}`;
}

/** Recover the message identity from a stored delivery key. */
export function messageKeyOf(deliveryKey: string): string {
  const at = deliveryKey.lastIndexOf("@");
  return at === -1 ? deliveryKey : deliveryKey.slice(0, at);
}
