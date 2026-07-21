"use client";

import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { SwipeableWorkout } from "./SwipeableWorkout";
import { ProgressRing } from "./motion";
import { Icon } from "./icons";
import { PhaseBar, RaceCountdown, weekOfDate, workoutsOn } from "./widgets";
import { weekProgress } from "@/lib/adapt";
import { fmtFullDate as fullDate } from "@/lib/dates";

export function TodayTab() {
  const { plan, username, offline } = useApp();
  const { today, openCoach, goTab } = useUI();
  if (!plan) return null;

  const todays = workoutsOn(plan, today);
  const wk = weekOfDate(plan, today);
  const prog = weekProgress(plan, wk);
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-5 px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <div className="animate-fade-up flex items-center justify-between">
        <div>
          <div className="eyebrow text-[0.72rem]">{greeting}</div>
          <div className="font-display text-2xl font-semibold capitalize tracking-tight">{username}</div>
        </div>
        <button onClick={() => openCoach()} className="card-glass flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold">
          <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-accent" />
          Coach
        </button>
      </div>

      {offline && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          You&apos;re offline — showing your saved plan. Changes sync when you reconnect.
        </div>
      )}

      <div className="animate-fade-up" style={{ animationDelay: "60ms" }}>
        <RaceCountdown plan={plan} today={today} />
      </div>

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

      <div className="animate-fade-up" style={{ animationDelay: "120ms" }}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-[1.15rem] font-semibold">Today</h2>
          <span className="eyebrow text-[0.72rem]">{fullDate(today)}</span>
        </div>
        {todays.length === 0 ? (
          <div className="card flex flex-col items-center p-6 text-center">
            <div className="text-muted"><Icon name="rest" size={30} /></div>
            <div className="mt-2 font-display font-semibold">Rest day</div>
            <div className="mt-1 max-w-[15rem] text-sm text-muted">Recovery is where you get stronger. Sleep, hydrate, refuel.</div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {todays.map((w) => (
              <SwipeableWorkout key={w.id} workout={w} />
            ))}
          </div>
        )}
      </div>

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
    </div>
  );
}
