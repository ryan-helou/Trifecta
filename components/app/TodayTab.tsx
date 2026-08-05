"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { useToast } from "./Toast";
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
import { DISCIPLINE_META } from "@/lib/zones";
import { fmtDuration, fmtDistance } from "@/lib/format";
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
        {hero ? <TodayHero workout={hero} /> : <RestCard word={form?.word} />}
      </div>

      {/* any extra sessions today, compact and clearly secondary */}
      {rest.length > 0 && (
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
      {next && (
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
// The hero: today's session, at a size that makes it impossible to miss what the
// app wants you to do. Shape, duration, zone, and the two actions that matter.
// ---------------------------------------------------------------------------

function TodayHero({ workout }: { workout: Workout }) {
  const { unit, openWorkout, openCheckin, actions } = useUI();
  const toast = useToast();
  const meta = DISCIPLINE_META[workout.discipline];
  const done = workout.status === "done" || workout.status === "swapped";
  const skipped = workout.status === "skipped";
  const dc = `var(${meta.colorVar})`;

  const complete = () => {
    actions.toggleDone(workout.id);
    openCheckin(workout.id);
  };

  return (
    <div className="card relative overflow-hidden p-5">
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: dc }} />

      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow text-[0.72rem]">Today</div>
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
            <h1 className={`font-display text-[1.5rem] font-semibold leading-tight tracking-tight ${done ? "line-through opacity-60" : ""}`}>
              {workout.title}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span className="tabular-nums">{workout.estDurationSec > 0 ? fmtDuration(workout.estDurationSec) : "—"}</span>
              {workout.estDistanceM ? (
                <>
                  <span aria-hidden className="h-1 w-1 rounded-full bg-muted opacity-50" />
                  <span className="tabular-nums">{fmtDistance(workout.estDistanceM, unit)}</span>
                </>
              ) : null}
              <span aria-hidden className="h-1 w-1 rounded-full bg-muted opacity-50" />
              <span>Zone {workout.primaryZone}</span>
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

  // 3. The plan wants to adapt (missed a lot / consistently hard). No `easedWeeks`
  //    check here — `assessAdaptation` already owns that gate, and re-applying it
  //    would also swallow the "ahead" case, which isn't about easing at all.
  const suggestion = assessAdaptation(plan, today);
  if (suggestion) {
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
    return (
      <Card onDismiss={onDismiss} eyebrow="Quick check" title={`Nailed today's ${w.title.toLowerCase()}?`} body="One tap to check it off.">
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

  if (prompt.kind === "adapt") {
    const s = prompt.suggestion;
    if (s.kind === "ahead") {
      return (
        <Card onDismiss={onDismiss} eyebrow="Ahead of plan" title="You're ahead of the plan" body={`${s.reason} We're holding the progression steady — consistency now pays off on race day.`} />
      );
    }
    return (
      <Card onDismiss={onDismiss} eyebrow="Time to ease off?" title={`Soften ${s.weekLabel}?`} body={`${s.reason} We can soften it so you absorb the work and stay healthy.`}>
        <div className="mt-3">
          <button onClick={() => { actions.adapt(s); onDismiss(); }} className="btn btn-primary w-full py-2.5 text-sm">
            Ease {s.weekLabel}
          </button>
        </div>
      </Card>
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
