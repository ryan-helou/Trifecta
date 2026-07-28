// ---------------------------------------------------------------------------
// The why-line: one honest sentence explaining why THIS session is on YOUR plan
// today. Only possible because the engine is deterministic — every session
// traces to a rule we can point at (doc 04 §1), and doc 02 §4 #14 requires every
// number and adjustment to be explainable in a sentence.
//
// Derived, never stored: stamping strings into every generated Workout would
// bloat the plan blob and churn the golden tests on every copy edit (invariant
// #17). The only things we persist are the facts the mutation would otherwise
// destroy — easedCause/easedFrom on the session, Plan.adaptations for the week.
//
// Honesty rules: describe what the engine ACTUALLY did, never invent
// physiology, and read applied state (easedCause, adaptations, readiness.eased)
// rather than re-running a suggestion that may never have been applied.
// Pure — no clock, no I/O.
// ---------------------------------------------------------------------------

import { Plan, Profile, ReadinessEntry, Week, Workout } from "./types";
import { injuryMods, isFitnessGoal } from "./planEngine";
import { fmtDayMonth } from "./dates";

export type WhyKind =
  | "raceday"
  | "opener"
  | "readiness"
  | "adaptation"
  | "injury"
  | "equipment"
  | "swap"
  | "logged"
  | "recovery"
  | "taper"
  | "strength"
  | "phase";

export interface WhyLine {
  kind: WhyKind;
  text: string;
}

const SPORT_VERB: Record<string, string> = { swim: "swim", bike: "ride", run: "run" };

/** The dimensions that scored a 1 on a morning check-in, named the way a coach
 *  would say them back. Only what the athlete actually reported. */
function lowSignals(r: ReadinessEntry): string {
  const low: string[] = [];
  if (r.sleep === 1) low.push("poor sleep");
  if (r.legs === 1) low.push("heavy legs");
  if (r.energy === 1) low.push("low energy");
  return low.join(", ");
}

/** Base line for a normal session: what this phase is for, and what this kind of
 *  session does inside it. The (phase × type) matrix the engine actually used. */
function phaseLine(w: Workout, week: Week, racing: boolean): string {
  const phase = week.phase;
  const t = w.type;

  if (t === "long") {
    if (phase === "base") return "Base phase: the long one builds the aerobic base everything else is stacked on.";
    if (phase === "peak") return racing
      ? "Peak: the long session is your dress rehearsal — practise the effort and the fuelling you'll race on."
      : "Peak: your longest steady work of the block — this is where endurance is won.";
    return "Build phase: extending the long session is how race distance stops feeling long.";
  }
  if (t === "threshold") return "Build phase: threshold intervals raise the pace you can hold before you blow up.";
  if (t === "vo2") return "Sharpening: short, sharp intervals lift your ceiling — the top end that makes race pace feel easier.";
  if (t === "tempo") return "Sustained moderately-hard work — the bridge between easy miles and race effort.";
  if (t === "brick") return "Bricks teach your legs to run off the bike — the hardest transition in triathlon.";
  if (t === "technique") return "Form now is free speed later — technique sticks best before the fatigue-heavy weeks.";
  if (t === "recovery") return "Deliberately very easy: this flushes the legs so the next hard day actually lands.";
  if (t === "race_prep") return "Race-pace rehearsal — locking in the effort you'll hold on the day.";
  if (t === "endurance") {
    if (phase === "base") return "Base phase: steady Z2 is where the aerobic engine gets built — most of your week lives here on purpose.";
    return "Steady aerobic work — the unglamorous volume that holds the whole plan up.";
  }
  return "Part of this week's aerobic base.";
}

/** Modifiers appended to the base line — the personal reasons this session sits
 *  where it does. Each states a fact from the profile or the plan. */
function suffixes(w: Workout, plan: Plan, profile: Profile): string[] {
  const out: string[] = [];
  if (w.movedFrom && w.movedFrom !== w.date) out.push(`Moved from ${fmtDayMonth(w.movedFrom)}.`);
  if (profile.focusDiscipline && profile.focusDiscipline === w.discipline) {
    out.push(`Extra ${SPORT_VERB[w.discipline] ?? w.discipline} volume — you named it as your limiter.`);
  }
  if (plan.compressed) out.push("Compressed build — key sessions only, because race day is close.");
  return out;
}

/** Why this session, for this athlete, today. First match wins; the base reason
 *  then picks up any personal modifiers. */
export function whyForWorkout(w: Workout, plan: Plan): WhyLine {
  const profile = plan.profile;
  const week = plan.weeks.find((x) => x.index === w.weekIndex);
  const racing = !isFitnessGoal(profile);
  const done = (text: string, kind: WhyKind): WhyLine => {
    const extra = suffixes(w, plan, profile);
    return { kind, text: extra.length ? `${text} ${extra.join(" ")}` : text };
  };

  if (w.id === "w-race-day") {
    return { kind: "raceday", text: "Race day. Everything in this plan was pointed here — trust the work and race your effort." };
  }
  if (w.discipline === "rest") {
    return { kind: "recovery", text: "A full day off is a training session — adaptation happens while you rest, not while you work." };
  }
  if (w.type === "race_prep" && week?.isRaceWeek) {
    return done("Race week: short efforts keep you primed without spending anything you'll need on the day.", "opener");
  }

  // --- eased sessions: say which trigger softened it, and from what -----------
  const readiness = plan.readiness?.[w.date];
  const easedLegacy = w.note === "Eased off";
  const wasEased = w.easedCause != null || easedLegacy;
  if (wasEased) {
    const from = w.easedFrom ? ` from a ${w.easedFrom.type.replace("_", " ")} session` : "";
    const cause = w.easedCause ?? (readiness?.eased ? "readiness" : undefined);

    if (cause === "readiness" && readiness) {
      const signals = lowSignals(readiness);
      const detail = signals ? ` (${signals})` : "";
      return done(
        `Eased${from}: this morning's check-in came in at ${readiness.score}/100${detail} — a rough morning shouldn't turn into an injury.`,
        "readiness",
      );
    }
    const record = (plan.adaptations ?? []).find((a) => a.weekIndex === w.weekIndex);
    if (record && (plan.easedWeeks ?? []).includes(w.weekIndex)) {
      return done(
        record.cause === "missed"
          ? `This week is softened${from}: you missed ${record.missed} of ${record.scheduled} sessions recently, so we rebuild rhythm before load.`
          : record.cause === "form"
          ? `This week is softened${from}: your fatigue has run deeper than this block was designed to put you, so we let fitness surface before adding more.`
          : `This week is softened${from}: recent sessions have felt consistently harder than prescribed, so you absorb before you push.`,
        "adaptation",
      );
    }
    return done(`Eased${from} so you can string sessions together — consistency beats one heroic day.`, "adaptation");
  }

  // --- the athlete changed it ------------------------------------------------
  if (w.swappedFrom) {
    const was = SPORT_VERB[w.swappedFrom.discipline] ?? w.swappedFrom.discipline;
    return done(`You swapped this from a ${was} — the aerobic stimulus still counts, which is what this slot was for.`, "swap");
  }
  if (w.status === "swapped" && w.loggedDiscipline) {
    return done("Credited from what you actually did — the plan follows your training, not the other way round.", "logged");
  }

  // --- constraints the engine planned around ---------------------------------
  const injury = (profile.injuries ?? []).find((i) => i.disciplines.includes(w.discipline));
  if (injury && (w.discipline === "swim" || w.discipline === "bike" || w.discipline === "run")) {
    const mod = injuryMods(profile)[w.discipline];
    // only claim the injury shaped it when the cap is actually binding
    if (mod.avoid || (mod.capZone < 4 && w.primaryZone <= mod.capZone)) {
      return done(
        mod.avoid
          ? `Kept short and gentle while your ${injury.area} settles — most of that time moved to the sports it doesn't aggravate.`
          : `Held to easy aerobic while your ${injury.area} settles — consistency through a niggle beats intensity that sets you back.`,
        "injury",
      );
    }
  }
  if (w.discipline === "swim" && profile.equipment?.pool === false) {
    return done("No pool access, so this is dry-land swim strength — it keeps the swim-specific work ticking over.", "equipment");
  }
  if (w.discipline === "strength") {
    return done("Strength is injury insurance first and power second — it carries into all three sports.", "strength");
  }

  // --- phase context ---------------------------------------------------------
  if (week?.isRecovery) {
    return done("Recovery week: deliberately easy — you get fitter absorbing the last block, not adding to it.", "recovery");
  }
  if (week?.phase === "taper") {
    return done("Taper: short and sharp keeps you primed while the volume drop sheds the fatigue underneath.", "taper");
  }
  return done(week ? phaseLine(w, week, racing) : "Part of this week's aerobic base.", "phase");
}
