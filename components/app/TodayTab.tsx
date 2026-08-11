"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { useToast } from "./Toast";
import { CoachNudge } from "./CoachNudge";
import { SwipeableWorkout } from "./SwipeableWorkout";
import { WorkoutCard } from "./WorkoutCard";
import { ReadinessSheet } from "./ReadinessSheet";
import { FormSheet, FORM_TINT } from "./FormSheet";
import { IntervalBar } from "./IntervalBar";
import { ProgressRing } from "./motion";
import { Icon, DisciplineIcon } from "./icons";
import { RaceCountdown, FitnessHero, upcomingAfter, weekOfDate, workoutsOn } from "./widgets";
import { isFitnessGoal } from "@/lib/planEngine";
import { profileGaps, gapSignature } from "@/lib/profileGaps";
import { Profile, Workout } from "@/lib/types";
import { assessAdaptation, weekProgress, type AdaptationSuggestion } from "@/lib/adapt";
import { calibrationDue } from "@/lib/calibrate";
import { computeStreak } from "@/lib/stats";
import { formStateFor } from "@/lib/load";
import { insightFor } from "@/lib/insight";
import { DISCIPLINE_META } from "@/lib/zones";
import { fmtDuration, fmtDistance } from "@/lib/format";
import { creditedSeconds } from "@/lib/credit";
import { track } from "@/lib/analytics";
import { daysBetween, addDays, dayIndexOf, fmtDayMonth, weekdayLong } from "@/lib/dates";

// ---------------------------------------------------------------------------
// The home screen answers exactly ONE question: what am I doing today?
//
// It used to answer about ten at once. Every card was individually defensible —
// countdown, form strip, readiness, coach summary, profile nudge, plan notice,
// evening nudge, up-next, week ring — and they all rendered at the same time, at
// the same visual weight, above the actual session. Opening the app meant triage.
//
// The rules now:
//   1. Today's session is the hero and it is FIRST. Nothing outranks it.
//   2. At most ONE prompt on screen, chosen by priority (`pickPrompt`). The rest
//      wait their turn — a prompt worth showing tomorrow is not worth stacking today.
//   3. Everything contextual (race countdown, week progress, form) collapses into
//      one glance strip at the bottom, tappable through to the screen that owns it.
// ---------------------------------------------------------------------------

export function TodayTab() {
  const { plan, profile, username } = useApp();
  const { today, openCoach, openWorkout, openLog, goTab, actions } = useUI();
  const toast = useToast();
  const [readyOpen, setReadyOpen] = useState(false);
  // Sheet state lives here, never in a child: a sheet mounted under an
  // `.animate-fade-up` wrapper resolves `position: fixed` against that wrapper
  // instead of the viewport.
  const [formOpen, setFormOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);

  // auto-recalibrate paces at most weekly, once per app session, from how recent
  // sessions actually went. Only surfaces a toast when something moved.
  const didAutoCal = useRef(false);
  useEffect(() => {
    if (didAutoCal.current || !plan) return;
    if (!calibrationDue(plan, today)) return;
    didAutoCal.current = true;
    const res = actions.recalibrate();
    if (res && res.changed) toast({ text: res.notes[0] ?? "We tuned your paces from recent sessions.", tone: "success" });
  }, [plan, today, actions, toast]);

  if (!plan) return null;

  const todays = workoutsOn(plan, today);
  const wk = weekOfDate(plan, today);
  const prog = weekProgress(plan, wk);
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const streak = computeStreak(plan, today);
  const form = formStateFor(plan, today);
  const fitness = isFitnessGoal(plan.profile);

  const hero = todays[0];
  const rest = todays.slice(1);
  const doneToday = todays.filter((w) => w.status === "done" || w.status === "swapped");
  const next = upcomingAfter(plan, today, 1)[0];

  // #200 — Ryan: "when I open the app the first thing I see is what I did today.
  // Congrats you did the bike today... you can tell me what's next."
  //
  // Once there's nothing left to do today, leading with a session the athlete
  // just finished is reporting their own input back at them. The hero becomes
  // the NEXT session instead, today's work collapses to one confirmation line,
  // and one true insight rides underneath (his choice: next + one insight).
  //
  // A skipped session does NOT count as settled — that day still has an open
  // decision, and quietly moving on would hide it.
  const nothingLeftToday =
    todays.length > 0 && todays.every((w) => w.status === "done" || w.status === "swapped");
  const lookAhead = nothingLeftToday && !!next;
  const insight = lookAhead ? insightFor(plan, today) : null;

  const prompt = pickPrompt({
    plan,
    profile,
    today,
    todays,
    doneToday,
    hour,
    dismissed,
  });
  const dismiss = (key: string) => setDismissed((d) => [...d, key]);

  return (
    <div className="space-y-4 px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      {/* The proactive coach speaks here, above everything, or not at all (#42).
          It sits first because a message you have to scroll to isn't proactive. */}
      <CoachNudge />

      {/* --- who + coach ------------------------------------------------- */}
      <div className="flex items-center justify-between gap-3">
        {/* min-w-0 + truncate: without them a long username shoves Coach off the row */}
        <div className="min-w-0">
          <div className="eyebrow text-[0.72rem]">{greeting}</div>
          <div className="truncate font-display text-2xl font-semibold capitalize tracking-tight">{username}</div>
        </div>
        <button onClick={() => openCoach()} className="card-glass flex h-10 flex-shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold">
          <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-accent" />
          Coach
        </button>
      </div>

      {/* --- THE ONE THING ------------------------------------------------ */}
      <div className="animate-fade-up">
        {lookAhead ? (
          <NextUpHero
            workout={next}
            today={today}
            doneCount={doneToday.length}
            insight={insight?.text ?? null}
            onOpen={() => openWorkout(next.id)}
          />
        ) : hero ? (
          <TodayHero workout={hero} />
        ) : (
          <RestCard word={form?.word} />
        )}
      </div>

      {/* any extra sessions today, compact and clearly secondary */}
      {rest.length > 0 && !lookAhead && (
        <div className="animate-fade-up space-y-2" style={{ animationDelay: "40ms" }}>
          <div className="eyebrow text-[0.7rem]">Also today</div>
          {rest.map((w) => (
            <SwipeableWorkout key={w.id} workout={w} />
          ))}
        </div>
      )}

      {/* "Tell your coach it was too hard and he rebuilds the plan" (#110) deliberately
          does NOT live here as a second widget — the check-in sheet already asks exactly
          that when you finish a session, and it now acts on the answer immediately (see
          CheckinSheet). Adding a third place to say how it felt would be more crowding,
          not less. */}

      {/* --- at most one prompt ------------------------------------------- */}
      {prompt && (
        <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
          <PromptCard
            prompt={prompt}
            onOpenReadiness={() => setReadyOpen(true)}
            onDismiss={() => dismiss(prompt.key)}
          />
        </div>
      )}

      {/* --- up next ------------------------------------------------------- */}
      {/* Hidden when the hero IS the next session, or the same card renders twice. */}
      {next && !lookAhead && (
        <div className="animate-fade-up" style={{ animationDelay: "120ms" }}>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-display text-[1.05rem] font-semibold">Up next</h2>
            <span className="eyebrow text-[0.7rem]">
              {next.date === addDays(today, 1) ? "Tomorrow" : `${weekdayLong(dayIndexOf(next.date))} · ${fmtDayMonth(next.date)}`}
            </span>
          </div>
          <WorkoutCard workout={next} onOpen={() => openWorkout(next.id)} />
        </div>
      )}

      <button
        onClick={() => openLog()}
        className="w-full rounded-2xl border border-dashed border-line py-3 text-center text-sm font-semibold text-muted transition hover:border-accent/50 hover:text-foreground"
      >
        ＋ Log a workout you did
      </button>

      {/* --- the glance strip --------------------------------------------- */}
      {/* Everything that used to be its own shouting card, compressed to one row of
          facts with a tap-through to the screen that actually owns each of them. */}
      <div className="animate-fade-up space-y-2 border-t border-line pt-4" style={{ animationDelay: "160ms" }}>
        <button
          onClick={() => goTab("plan")}
          className="card flex w-full items-center gap-3 p-3.5 text-left transition hover:brightness-110 active:scale-[0.995]"
        >
          <ProgressRing value={pct / 100} size={38} stroke={4}>
            <span className="font-display text-[0.62rem] font-bold tabular-nums">{prog.done}/{prog.total}</span>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            {/* Derived from the index, not the stored `wk.label` — plans generated before
                #114 still carry "Build 1" in their saved weeks, and PlanTab has always
                derived it this way, which is exactly why the same week read "Week 9"
                there and "Build 1" here. */}
            <div className="truncate font-display text-[0.98rem] font-semibold">
              {wk.isRaceWeek ? "Race week" : `Week ${wk.index + 1}`}
            </div>
            <div className="truncate text-xs text-muted">
              {/* No "Build phase" here — #114. The phase still shapes the training, but
                  as a label it's coaching jargon the athlete didn't ask for, and the
                  same week already reads "Week 9" on the Plan tab. */}
              <span>{prog.done}/{prog.total} done</span>
              {!fitness && plan.raceDateISO && ` · ${Math.max(0, daysBetween(today, plan.raceDateISO))} days to race`}
              {streak.current >= 2 && ` · ${streak.current}-day streak`}
            </div>
          </div>
          <span className="text-accent-soft text-lg">›</span>
        </button>

        {/* form/fitness detail is a tap away, not a permanent resident */}
        {form && (
          <button
            onClick={() => { track("form_opened", { band: form.band }); setFormOpen(true); }}
            className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-left text-sm transition hover:brightness-110 active:scale-[0.995]"
          >
            <span className="flex items-center gap-2 text-muted">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: FORM_TINT[form.band] }} />
              Form · <span className="font-semibold text-foreground">{form.word}</span>
            </span>
            <span className="text-accent-soft">›</span>
          </button>
        )}

        {/* A PERMANENT way in to the check-in (#198).
            The prompt card above only appears before 4pm, only when there are
            sessions today, and only until you've answered once — so on a rest
            day, or in the evening, or after a first answer, there was no way to
            say "actually I feel rough". That was fine while Profile carried
            "Not feeling 100% — ease this week", and stopped being fine the
            moment that button was deleted in favour of this path. Removing an
            escape hatch without providing the replacement is how a fix becomes
            a regression. */}
        <button
          onClick={() => setReadyOpen(true)}
          className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-left text-sm transition hover:brightness-110 active:scale-[0.995]"
        >
          <span className="text-muted">
            {plan.readiness?.[today] ? "Update how you're feeling" : "How are you feeling today?"}
          </span>
          <span className="text-accent-soft">›</span>
        </button>

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-1 py-2 text-sm text-muted transition hover:text-foreground">
            <span>Race &amp; plan details</span>
            <span aria-hidden className="transition group-open:rotate-90">›</span>
          </summary>
          <div className="mt-2 space-y-3">
            {fitness ? <FitnessHero plan={plan} today={today} /> : <RaceCountdown plan={plan} today={today} />}
            {plan.coachSummary && (
              <div className="card-glass rounded-2xl p-4">
                <div className="eyebrow mb-1.5 text-[0.72rem]">Why this plan</div>
                <p className="text-sm leading-relaxed text-foreground/90">{plan.coachSummary}</p>
                {plan.phaseNotes?.[wk.phase] && (
                  <p className="mt-2.5 border-t border-line/60 pt-2.5 text-sm leading-relaxed text-muted">
                    <span className="font-semibold capitalize text-accent">{wk.phase} block · </span>
                    {plan.phaseNotes[wk.phase]}
                  </p>
                )}
              </div>
            )}
          </div>
        </details>
      </div>

      {/* overlays — mounted at the screen's top level, outside every animated wrapper */}
      {readyOpen && <ReadinessSheet onClose={() => setReadyOpen(false)} />}
      {formOpen && form && <FormSheet form={form} onClose={() => setFormOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The look-ahead hero (#200): what's NEXT, once today is settled.
//
// Same visual weight as TodayHero — it is still the one thing on the screen —
// but it points forward. Today's finished work is one tick line, not a card:
// the athlete told US that, so restating it at hero size is the complaint.
// Underneath, one true insight (lib/insight.ts) so the space says something the
// athlete didn't already know instead of congratulating them for data entry.
// ---------------------------------------------------------------------------

function NextUpHero({
  workout,
  today,
  doneCount,
  insight,
  onOpen,
}: {
  workout: Workout;
  today: string;
  doneCount: number;
  insight: string | null;
  onOpen: () => void;
}) {
  const { unit } = useUI();
  const meta = DISCIPLINE_META[workout.discipline];
  const dc = `var(${meta.colorVar})`;
  const tomorrow = workout.date === addDays(today, 1);

  return (
    <div className="card relative overflow-hidden p-5">
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: dc }} />

      {/* Today, acknowledged and then got out of the way. */}
      {doneCount > 0 && (
        <div className="mb-3 flex items-center gap-1.5 text-[0.78rem] text-success">
          <Icon name="check" size={14} />
          <span>
            {doneCount === 1 ? "Today's session is done" : `All ${doneCount} of today's sessions are done`}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow text-[0.72rem]">
          {tomorrow ? "Tomorrow" : `${weekdayLong(dayIndexOf(workout.date))} · ${fmtDayMonth(workout.date)}`}
        </div>
      </div>

      <button onClick={onOpen} className="mt-1.5 block w-full text-left">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[13px]"
            style={{ background: `color-mix(in oklab, ${dc} 16%, transparent)`, color: dc }}
          >
            <DisciplineIcon discipline={workout.discipline} size={26} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[1.35rem] font-semibold leading-tight">{workout.title}</div>
            <div className="mt-0.5 text-sm text-muted">
              {fmtDuration(workout.estDurationSec)}
              {workout.estDistanceM ? ` · ${fmtDistance(workout.estDistanceM, unit, workout.discipline === "swim")}` : ""}
            </div>
          </div>
        </div>

        {workout.segments?.length > 0 && (
          <div className="mt-3.5">
            <IntervalBar segments={workout.segments} height={30} />
          </div>
        )}

        {workout.purpose && <p className="mt-3 text-sm leading-relaxed text-muted">{workout.purpose}</p>}
      </button>

      {/* One true thing they didn't already know. Absent rather than filler. */}
      {insight && (
        <p className="mt-4 border-t border-line/60 pt-3 text-sm leading-relaxed text-foreground/90">{insight}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The hero: today's session, at a size that makes it impossible to miss what the
// app wants you to do. Shape, duration, zone, and the two actions that matter.
// ---------------------------------------------------------------------------

function TodayHero({ workout }: { workout: Workout }) {
  const { unit, openWorkout, openCheckin, actions } = useUI();
  const toast = useToast();
  const meta = DISCIPLINE_META[workout.discipline];
  const done = workout.status === "done" || workout.status === "swapped";
  const skipped = workout.status === "skipped";
  // what the athlete actually covered, or nothing — never the prescription
  const actualDistance = workout.actualDistanceM ?? workout.actuals?.distanceM ?? null;
  const dc = `var(${meta.colorVar})`;

  const complete = () => {
    actions.toggleDone(workout.id);
    openCheckin(workout.id);
  };

  return (
    <div className="card relative overflow-hidden p-5">
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: dc }} />

      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow text-[0.72rem]">{done ? "Done today" : "Today"}</div>
        {workout.easedCause && (
          <span
            className="rounded-full px-2 py-[1px] text-[0.66rem] font-semibold"
            style={{ background: "color-mix(in oklab, var(--warning) 18%, transparent)", color: "var(--warning)" }}
          >
            Eased
          </span>
        )}
      </div>

      <button onClick={() => openWorkout(workout.id)} className="mt-1.5 block w-full text-left">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[13px]"
            style={{
              background: `color-mix(in oklab, ${dc} 14%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${dc} 26%, transparent)`,
              color: dc,
            }}
          >
            {/* DisciplineIcon, not meta.icon — that field is an emoji, and Ryan wants
                line-icons, not emoji, in the UI. */}
            <DisciplineIcon discipline={workout.discipline} size={24} />
          </span>
          <div className="min-w-0 flex-1">
            {/* Once it's done, this card's job flips: it stops being the instruction
                and becomes the record. It used to keep showing the PRESCRIPTION with a
                line through it — so after an hour's ride the screen still read "1h 10m"
                because that's what was asked for, not what happened, and struck through
                as if the session had been cancelled rather than earned (#120). Finished
                sessions now report the credited actuals. */}
            <h1 className={`font-display text-[1.5rem] font-semibold leading-tight tracking-tight ${skipped ? "line-through opacity-60" : ""}`}>
              {workout.title}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              {done ? (
                <>
                  <span className="tabular-nums">{fmtDuration(creditedSeconds(workout))}</span>
                  {/* Distance is shown ONLY when we actually have one. Falling back to
                      estDistanceM here stated the PLANNED distance as if it had been
                      covered: log a gym session against a planned swim and the card read
                      "45 min · 1.7 km", crediting the athlete with a swim they never
                      swam. On a finished session the plan's numbers are not evidence —
                      that was the whole point of #120, and the duration was fixed while
                      this was left falling through. */}
                  {actualDistance != null ? (
                    <>
                      <span aria-hidden className="h-1 w-1 rounded-full bg-muted opacity-50" />
                      <span className="tabular-nums">{fmtDistance(actualDistance, unit, workout.discipline === "swim")}</span>
                    </>
                  ) : null}
                  {workout.rpe != null && (
                    <>
                      <span aria-hidden className="h-1 w-1 rounded-full bg-muted opacity-50" />
                      <span className="tabular-nums">RPE {workout.rpe}</span>
                    </>
                  )}
                </>
              ) : (
                <>
                  <span className="tabular-nums">{workout.estDurationSec > 0 ? fmtDuration(workout.estDurationSec) : "—"}</span>
                  {workout.estDistanceM ? (
                    <>
                      <span aria-hidden className="h-1 w-1 rounded-full bg-muted opacity-50" />
                      <span className="tabular-nums">{fmtDistance(workout.estDistanceM, unit, workout.discipline === "swim")}</span>
                    </>
                  ) : null}
                  <span aria-hidden className="h-1 w-1 rounded-full bg-muted opacity-50" />
                  <span>Zone {workout.primaryZone}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {workout.segments?.length > 0 && (
          <div className="mt-3.5">
            <IntervalBar segments={workout.segments} height={30} />
          </div>
        )}

        {workout.purpose && <p className="mt-3 text-sm leading-relaxed text-muted">{workout.purpose}</p>}
      </button>

      <div className="mt-4 flex gap-2">
        {done ? (
          <div className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-success/40 bg-success/10 py-3 text-sm font-semibold text-success">
            <Icon name="check" size={16} />
            Done today
          </div>
        ) : skipped ? (
          <button onClick={() => actions.unskip(workout.id)} className="btn btn-ghost flex-1 py-3 text-sm">
            Skipped — put it back
          </button>
        ) : (
          <>
            <button onClick={complete} className="btn btn-primary flex-1 py-3.5 text-base">
              I did it
            </button>
            <button
              onClick={() => {
                actions.skip(workout.id);
                toast({
                  text: `Skipped · ${workout.title}`,
                  tone: "warning",
                  actionLabel: "Undo",
                  onAction: () => actions.unskip(workout.id),
                });
              }}
              className="btn btn-ghost px-4 py-3.5 text-sm"
            >
              Skip
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function RestCard({ word }: { word?: string }) {
  return (
    <div className="card flex flex-col items-center p-7 text-center">
      <div className="text-muted"><Icon name="rest" size={32} /></div>
      <div className="mt-2.5 font-display text-[1.35rem] font-semibold">Rest day</div>
      <div className="mt-1.5 max-w-[17rem] text-sm text-muted">
        {word ? `${word} — today's rest is banking it.` : "Nothing scheduled. Recovery is where you get stronger — sleep, hydrate, refuel."}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One prompt, chosen by priority. Everything that used to render simultaneously
// now queues here — the screen shows the most useful one and nothing else.
// ---------------------------------------------------------------------------

type Prompt =
  | { key: string; kind: "readiness" }
  | { key: string; kind: "nudge"; workout: Workout }
  | { key: string; kind: "adapt"; suggestion: AdaptationSuggestion }
  | { key: string; kind: "gaps"; gaps: { key: string; label: string }[] }
  | { key: string; kind: "notice"; text: string };

const EVENING_HOUR = 16; // after this, "still planned" probably means "did it, forgot to log"

function pickPrompt(ctx: {
  plan: NonNullable<ReturnType<typeof useApp>["plan"]>;
  profile: Profile | null;
  today: string;
  todays: Workout[];
  doneToday: Workout[];
  hour: number;
  dismissed: string[];
}): Prompt | null {
  const { plan, profile, today, todays, doneToday, hour, dismissed } = ctx;
  const live = (p: Prompt): Prompt | null => (dismissed.includes(p.key) ? null : p);

  // 1. The morning check-in — it's the only one that changes TODAY, and it expires.
  if (todays.length > 0 && !plan.readiness?.[today] && hour < EVENING_HOUR) {
    const p = live({ key: "readiness:" + today, kind: "readiness" });
    if (p) return p;
  }

  // 2. Evening: a session still sitting at "planned" late in the day.
  if (hour >= EVENING_HOUR) {
    const pending = todays.find((w) => w.status === "planned");
    if (pending) {
      const p = live({ key: "nudge:" + pending.id, kind: "nudge", workout: pending });
      if (p) return p;
    }
  }

  // 3. Only the "ahead" case reaches the screen now. Easing used to ask permission
  //    here — "you've missed a lot, soften next week?" — which is the plan asking the
  //    athlete to do the plan's job, and it contradicted the promise that the plan
  //    adapts itself (#120). Easing is the PROTECTIVE direction, and doc 03 §4 C says
  //    protect fast; assessAdaptation already debounces it over a 2-week window, so
  //    there is nothing left for a confirmation step to add. AppShell applies it
  //    automatically now, with an Undo. "Ahead" stays a card because it is not a
  //    change at all — it adds no load (doc 02 §4 #9), it's just a good word.
  const suggestion = assessAdaptation(plan, today);
  if (suggestion && suggestion.kind === "ahead") {
    const p = live({ key: `adapt:${suggestion.weekIndex}:${suggestion.cause}`, kind: "adapt", suggestion });
    if (p) return p;
  }

  // 4. Something the plan just did on its own (realign, ease) — worth one read.
  if (plan.notice) {
    const p = live({ key: "notice:" + plan.notice, kind: "notice", text: plan.notice });
    if (p) return p;
  }

  // 5. Coldest of all: profile gaps. Never competes with anything above it.
  if (profile && doneToday.length === 0) {
    const gaps = profileGaps(profile);
    if (gaps.length) {
      const p = live({ key: "gaps:" + gapSignature(gaps), kind: "gaps", gaps });
      if (p) return p;
    }
  }

  return null;
}

function PromptCard({
  prompt,
  onOpenReadiness,
  onDismiss,
}: {
  prompt: Prompt;
  onOpenReadiness: () => void;
  onDismiss: () => void;
}) {
  const { actions, openLog, openSettings } = useUI();
  const toast = useToast();

  if (prompt.kind === "readiness") {
    return (
      <button onClick={onOpenReadiness} className="card block w-full p-4 text-left transition hover:brightness-110 active:scale-[0.995]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="eyebrow text-[0.72rem]">Morning check-in</div>
            <div className="mt-0.5 font-display text-[1.05rem] font-semibold">How are you feeling today?</div>
            <div className="mt-0.5 text-sm text-muted">Ten seconds — we&apos;ll tune today&apos;s session to your readiness.</div>
          </div>
          <span className="text-accent-soft text-lg">›</span>
        </div>
      </button>
    );
  }

  if (prompt.kind === "nudge") {
    const w = prompt.workout;
    // Session titles carry acronyms — CSS, VO2, FTP. Lowercasing them to fit the
    // sentence turned "CSS Threshold Set" into "css threshold set" on this card, and
    // "Run VO2 6×3" into "run vo2 6×3". Title case mid-sentence reads better than a
    // mangled acronym.
    return (
      <Card onDismiss={onDismiss} eyebrow="Quick check" title={`Nailed today's ${w.title}?`} body="One tap to check it off.">
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => {
              actions.toggleDone(w.id);
              onDismiss();
              toast({ text: `Done · ${w.title}`, tone: "success", actionLabel: "Undo", onAction: () => actions.toggleDone(w.id) });
            }}
            className="btn btn-primary flex-1 py-2.5 text-sm"
          >
            Yes, done
          </button>
          <button onClick={() => { onDismiss(); openLog(); }} className="btn btn-ghost flex-1 py-2.5 text-sm">
            Log details
          </button>
        </div>
      </Card>
    );
  }

  // Only "ahead" reaches this card — pickPrompt filters on it, because easing now
  // applies itself in AppShell (#120). No button here on purpose: being ahead is not
  // a change to accept, and deliberately adds no load (doc 02 §4 #9).
  if (prompt.kind === "adapt") {
    const s = prompt.suggestion;
    return (
      <Card onDismiss={onDismiss} eyebrow="Ahead of plan" title="You're ahead of the plan" body={`${s.reason} We're holding the progression steady — consistency now pays off on race day.`} />
    );
  }

  if (prompt.kind === "notice") {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5">
        <span className="text-sm text-muted">{prompt.text}</span>
        <button onClick={onDismiss} aria-label="Dismiss" className="flex-shrink-0 text-muted transition hover:text-foreground">✕</button>
      </div>
    );
  }

  return (
    <Card onDismiss={onDismiss} eyebrow="A few answers will sharpen your plan" title="Finish your profile">
      <ul className="mt-2.5 space-y-1.5">
        {prompt.gaps.map((g) => (
          <li key={g.key} className="flex items-start gap-2 text-sm text-muted">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
            {g.label}
          </li>
        ))}
      </ul>
      <button onClick={openSettings} className="btn btn-primary mt-3 w-full py-2.5 text-sm">Answer now</button>
    </Card>
  );
}

function Card({
  eyebrow,
  title,
  body,
  onDismiss,
  children,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  onDismiss: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow text-[0.72rem]">{eyebrow}</div>
          <div className="mt-0.5 font-display text-[1.05rem] font-semibold">{title}</div>
          {body && <div className="mt-0.5 text-sm text-muted">{body}</div>}
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="flex-shrink-0 text-muted transition hover:text-foreground">✕</button>
      </div>
      {children}
    </div>
  );
}
