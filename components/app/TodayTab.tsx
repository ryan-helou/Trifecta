"use client";

import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { WorkoutCard } from "./WorkoutCard";
import { PhaseBar, RaceCountdown, weekOfDate, workoutsOn } from "./widgets";
import { weekProgress } from "@/lib/adapt";
import { fmtFullDate as fullDate } from "@/lib/dates";

export function TodayTab() {
  const { plan, username, offline } = useApp();
  const { today, openWorkout, openCoach, goTab } = useUI();
  if (!plan) return null;

  const todays = workoutsOn(plan, today);
  const wk = weekOfDate(plan, today);
  const prog = weekProgress(plan, wk);
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-5 px-4 py-4">
      <div className="animate-fade-up flex items-center justify-between">
        <div>
          <div className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.24em] text-muted">{greeting}</div>
          <div className="font-display text-2xl font-bold capitalize tracking-tight">{username}</div>
        </div>
        <button onClick={() => openCoach()} className="card-glass flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold">
          <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-accent" style={{ boxShadow: "0 0 8px var(--accent)" }} />
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

      <div className="animate-fade-up" style={{ animationDelay: "120ms" }}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-[1.06rem] font-bold">Today</h2>
          <span className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-muted">{fullDate(today)}</span>
        </div>
        {todays.length === 0 ? (
          <div className="card flex flex-col items-center p-6 text-center">
            <div className="text-3xl">🌙</div>
            <div className="mt-2 font-display font-semibold">Rest day</div>
            <div className="mt-1 max-w-[15rem] text-sm text-muted">Recovery is where you get stronger. Sleep, hydrate, refuel.</div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {todays.map((w) => (
              <WorkoutCard key={w.id} workout={w} onOpen={() => openWorkout(w.id)} />
            ))}
          </div>
        )}
      </div>

      {/* week at a glance */}
      <button
        onClick={() => goTab("plan")}
        className="animate-fade-up card block w-full p-4 text-left transition hover:brightness-110"
        style={{ animationDelay: "180ms" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.2em] text-accent-soft">{wk.phase} phase</div>
            <div className="mt-0.5 font-display text-[1.05rem] font-bold">{wk.label.replace(" · Recovery", "")}</div>
          </div>
          <ProgressRing pct={pct} label={`${prog.done}/${prog.total}`} />
        </div>
        <PhaseBar plan={plan} current={wk.index} />
        <div className="mt-3 text-sm leading-snug text-muted">{wk.focus}</div>
      </button>
    </div>
  );
}

function ProgressRing({ pct, label }: { pct: number; label: string }) {
  return (
    <div
      className="relative grid h-12 w-12 flex-shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(var(--accent) ${pct}%, var(--surface-3) 0)` }}
    >
      <div className="absolute inset-[3px] rounded-full bg-surface" />
      <span className="relative font-display text-[0.72rem] font-bold tabular-nums">{label}</span>
    </div>
  );
}
