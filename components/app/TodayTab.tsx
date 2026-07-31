"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { useToast } from "./Toast";
import { SwipeableWorkout } from "./SwipeableWorkout";
import { WorkoutCard } from "./WorkoutCard";
import { ReadinessSheet } from "./ReadinessSheet";
import { FormSheet, FormStrip } from "./FormSheet";
import { ProgressRing } from "./motion";
import { Icon } from "./icons";
import { FitnessHero, PhaseBar, RaceCountdown, upcomingAfter, weekOfDate, workoutsOn } from "./widgets";
import { isFitnessGoal } from "@/lib/planEngine";
import { profileGaps, gapSignature } from "@/lib/profileGaps";
import { Profile } from "@/lib/types";
import { weekProgress } from "@/lib/adapt";
import { readinessBand } from "@/lib/readiness";
import { calibrationDue } from "@/lib/calibrate";
import { computeStreak } from "@/lib/stats";
import { formStateFor } from "@/lib/load";
import { track } from "@/lib/analytics";
import { fmtFullDate as fullDate, addDays, dayIndexOf, fmtDayMonth, weekdayLong } from "@/lib/dates";

export function TodayTab() {
  const { plan, profile, username, offline } = useApp();
  const { today, openCoach, openWorkout, openLog, goTab, actions } = useUI();
  const toast = useToast();
  const [readyOpen, setReadyOpen] = useState(false);
  // Sheet state lives here, never in the strip: the strip sits inside an
  // `.animate-fade-up` wrapper, and a sheet mounted under a transformed ancestor
  // resolves its `position: fixed` against that wrapper instead of the viewport.
  const [formOpen, setFormOpen] = useState(false);

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
  const todayReadiness = plan.readiness?.[today];
  // today's one-word form state — null until enough history has banked
  const form = formStateFor(plan, today);

  // the next scheduled session after today — so the home screen always answers
  // "what's coming?", not just "what's today" (especially on rest days)
  const next = upcomingAfter(plan, today, 1)[0];
  const nextLabel = next
    ? next.date === addDays(today, 1)
      ? "Tomorrow"
      : `${weekdayLong(dayIndexOf(next.date))} · ${fmtDayMonth(next.date)}`
    : "";

  return (
    <div className="space-y-5 px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <div className="animate-fade-up flex items-center justify-between gap-3">
        {/* min-w-0 + truncate: without them a long username shoves Log/Coach off the
            row instead of ellipsing, since flex items refuse to shrink past content */}
        <div className="min-w-0">
          <div className="eyebrow text-[0.72rem]">{greeting}</div>
          <div className="truncate font-display text-2xl font-semibold capitalize tracking-tight">{username}</div>
          {streak.current >= 2 && (
            <div className="mt-1 flex items-center gap-1.5 text-[0.82rem] font-medium text-muted">
              <Icon name="flame" size={14} className="text-accent" />
              <span className="font-semibold tabular-nums text-foreground">{streak.current}-day</span> streak
            </div>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button onClick={() => openLog()} className="card-glass flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold">
            <span aria-hidden className="text-base leading-none text-accent">＋</span>
            Log
          </button>
          <button onClick={() => openCoach()} className="card-glass flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold">
            <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-accent" />
            Coach
          </button>
        </div>
      </div>

      {offline && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          You&apos;re offline — showing your saved plan. Changes sync when you reconnect.
        </div>
      )}

      <div className="animate-fade-up" style={{ animationDelay: "60ms" }}>
        {isFitnessGoal(plan.profile) ? <FitnessHero plan={plan} today={today} /> : <RaceCountdown plan={plan} today={today} />}
      </div>

      {/* form strip — the moat made visible; absorbs the readiness row once it exists */}
      {form && (
        <div className="animate-fade-up" style={{ animationDelay: "75ms" }}>
          <FormStrip form={form} readiness={todayReadiness} onOpen={() => { track("form_opened", { band: form.band }); setFormOpen(true); }} />
        </div>
      )}

      {profile && <ProfileNudge profile={profile} />}

      {plan.notice && <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-muted">{plan.notice}</div>}

      {plan.coachSummary && (
        <div className="animate-fade-up card-glass rounded-2xl p-4" style={{ animationDelay: "90ms" }}>
          <div className="mb-1.5 flex items-center gap-2">
            <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-accent" />
            <span className="eyebrow text-[0.72rem]">Why this plan</span>
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">{plan.coachSummary}</p>
          {plan.phaseNotes?.[wk.phase] && (
            <p className="mt-2.5 border-t border-line/60 pt-2.5 text-sm leading-relaxed text-muted">
              <span className="font-semibold capitalize text-accent">{wk.phase} block · </span>
              {plan.phaseNotes[wk.phase]}
            </p>
          )}
        </div>
      )}

      {/* daily readiness — the injury-safe morning check that regulates today */}
      {todays.length > 0 && !todayReadiness && (
        <button
          onClick={() => setReadyOpen(true)}
          className="animate-fade-up card block w-full p-4 text-left transition hover:brightness-110 active:scale-[0.995]"
          style={{ animationDelay: "105ms" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="eyebrow text-[0.72rem]">Morning check-in</div>
              <div className="mt-0.5 font-display text-[1.05rem] font-semibold">How are you feeling today?</div>
              <div className="mt-0.5 text-sm text-muted">Ten seconds — we&apos;ll tune today&apos;s session to your readiness.</div>
            </div>
            <span className="text-accent-soft text-lg">›</span>
          </div>
        </button>
      )}
      {todayReadiness && !form && (
        <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-muted">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{
                background:
                  readinessBand(todayReadiness.score) === "low"
                    ? "var(--warning)"
                    : readinessBand(todayReadiness.score) === "high"
                    ? "var(--success)"
                    : "var(--accent)",
              }}
            />
            Readiness today
          </span>
          <span className="font-semibold tabular-nums">
            {todayReadiness.score}/100{todayReadiness.eased ? " · eased" : ""}
          </span>
        </div>
      )}

      {/* Post-time nudge — a lightweight prompt when the day is winding down
          and today's session is still marked planned. Removes the "did I
          remember to check off?" cognitive load for the manual-log crowd. */}
      <EveningNudge todays={todays} today={today} />

      <div className="animate-fade-up" style={{ animationDelay: "120ms" }}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-[1.15rem] font-semibold">Today</h2>
          <span className="eyebrow text-[0.72rem]">{fullDate(today)}</span>
        </div>
        {todays.length === 0 ? (
          <div className="card flex flex-col items-center p-6 text-center">
            <div className="text-muted"><Icon name="rest" size={30} /></div>
            <div className="mt-2 font-display font-semibold">Rest day</div>
            <div className="mt-1 max-w-[15rem] text-sm text-muted">
              {form ? `${form.word} — today's rest is banking it.` : "Recovery is where you get stronger. Sleep, hydrate, refuel."}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {todays.map((w) => (
              <SwipeableWorkout key={w.id} workout={w} />
            ))}
          </div>
        )}
        <button
          onClick={() => openLog()}
          className="mt-2.5 w-full rounded-2xl border border-dashed border-line py-3 text-center text-sm font-semibold text-muted transition hover:border-accent/50 hover:text-foreground"
        >
          ＋ Log a workout you did
        </button>
      </div>

      {/* up next — the next session after today */}
      {next && (
        <div className="animate-fade-up" style={{ animationDelay: "150ms" }}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-[1.15rem] font-semibold">Up next</h2>
            <span className="eyebrow text-[0.72rem]">{nextLabel}</span>
          </div>
          <WorkoutCard workout={next} onOpen={() => openWorkout(next.id)} />
        </div>
      )}

      {/* week at a glance */}
      <button
        onClick={() => goTab("plan")}
        className="animate-fade-up card block w-full p-4 text-left transition hover:brightness-110 active:scale-[0.995] active:brightness-125"
        style={{ animationDelay: "180ms" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="eyebrow text-[0.72rem]">{wk.phase} phase</div>
            <div className="mt-0.5 font-display text-[1.12rem] font-semibold">{wk.label.replace(" · Recovery", "")}</div>
          </div>
          <ProgressRing value={pct / 100} size={48} stroke={5}>
            <span className="font-display text-[0.72rem] font-bold tabular-nums">{prog.done}/{prog.total}</span>
          </ProgressRing>
        </div>
        <PhaseBar plan={plan} current={wk.index} />
        <div className="mt-3 text-sm leading-snug text-muted">{wk.focus}</div>
      </button>

      {/* overlays — mounted at the screen's top level, outside every animated wrapper */}
      {readyOpen && <ReadinessSheet onClose={() => setReadyOpen(false)} />}
      {formOpen && form && <FormSheet form={form} onClose={() => setFormOpen(false)} />}
    </div>
  );
}

/** Prompts the athlete late in the day if today's session is still planned.
 *  Two paths: "Yes, done" (one-tap credit) or "Log details" (open the sheet).
 *  Dismissal is per-workout-per-day (sessionStorage), so it comes back tomorrow
 *  but doesn't nag if you closed it once already today. Only appears once the
 *  local hour is past the threshold so morning athletes aren't pestered. */
const EVENING_HOUR = 16; // 4pm — after this, planned-still-planned probably means "I did it, forgot to log"
const NUDGE_DISMISS_PREFIX = "trifecta:nudge:";
type NudgeWorkout = { id: string; title: string; discipline: string; status: string };

function EveningNudge({ todays, today }: { todays: NudgeWorkout[]; today: string }) {
  const { actions, openLog } = useUI();
  const toast = useToast();
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(NUDGE_DISMISS_PREFIX + today);
      if (raw) setDismissed(JSON.parse(raw));
    } catch {}
  }, [today]);

  const hour = new Date().getHours();
  if (hour < EVENING_HOUR) return null;

  const pending = todays.filter((w) => w.status === "planned" && !dismissed.includes(w.id));
  if (pending.length === 0) return null;
  const w = pending[0]; // one at a time — the first still-planned session

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try { window.sessionStorage.setItem(NUDGE_DISMISS_PREFIX + today, JSON.stringify(next)); } catch {}
  };

  const confirm = () => {
    actions.toggleDone(w.id);
    dismiss(w.id);
    toast({
      text: `Done · ${w.title}`,
      tone: "success",
      actionLabel: "Undo",
      onAction: () => actions.toggleDone(w.id),
    });
  };
  const logDetails = () => { dismiss(w.id); openLog(); };

  return (
    <div className="animate-fade-up card p-4" style={{ animationDelay: "110ms" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow text-[0.72rem]">Quick check</div>
          <div className="mt-0.5 font-display text-[1.05rem] font-semibold">Nailed today&apos;s {w.title.toLowerCase()}?</div>
          <div className="mt-0.5 text-sm text-muted">One tap to check it off. Adjust the details if it went differently.</div>
        </div>
        <button onClick={() => dismiss(w.id)} aria-label="Dismiss" className="text-muted transition hover:text-foreground">✕</button>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={confirm} className="btn btn-primary flex-1 py-2.5 text-sm">Yes, done</button>
        <button onClick={logDetails} className="btn btn-ghost flex-1 py-2.5 text-sm">Log details</button>
      </div>
    </div>
  );
}

const NUDGE_KEY = "amatri:profile-nudge-dismissed";

/** "Finish your profile" — surfaces the important answers a fully-skippable
 *  onboarding may have left blank (race date, PRs). Tapping opens Edit settings;
 *  dismissing sticks only while the gap set is unchanged. */
function ProfileNudge({ profile }: { profile: Profile }) {
  const { openSettings } = useUI();
  const gaps = profileGaps(profile);
  const sig = gapSignature(gaps);
  // undefined until we've read the stored dismissal — avoids a flash on reload
  const [dismissedSig, setDismissedSig] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    try {
      setDismissedSig(window.localStorage.getItem(NUDGE_KEY));
    } catch {
      setDismissedSig(null);
    }
  }, []);

  if (dismissedSig === undefined) return null;
  if (!gaps.length || dismissedSig === sig) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(NUDGE_KEY, sig);
    } catch {}
    setDismissedSig(sig);
  };

  return (
    <div className="animate-fade-up card p-4" style={{ animationDelay: "75ms" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow text-[0.72rem]">A few answers will sharpen your plan</div>
          <div className="mt-0.5 font-display text-[1.05rem] font-semibold">Finish your profile</div>
        </div>
        <button onClick={dismiss} aria-label="Dismiss" className="text-muted transition hover:text-foreground">✕</button>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {gaps.map((g) => (
          <li key={g.key} className="flex items-start gap-2 text-sm text-muted">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
            {g.label}
          </li>
        ))}
      </ul>
      <button onClick={openSettings} className="btn btn-primary mt-3 w-full py-2.5 text-sm">Answer now</button>
    </div>
  );
}
