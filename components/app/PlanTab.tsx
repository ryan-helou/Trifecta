"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { SwipeableWorkout } from "./SwipeableWorkout";
import { PhaseBar, weekOfDate } from "./widgets";
import { weekProgress } from "@/lib/adapt";
import { addDays, weekdayShort, fmtDayMonth } from "@/lib/dates";
import { fmtDuration } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { Plan, Week } from "@/lib/types";
import { Icon } from "./icons";

export function PlanTab() {
  const { plan } = useApp();
  const { today } = useUI();
  const cur = plan ? weekOfDate(plan, today).index : 0;
  const [sel, setSel] = useState(cur);
  const pillRow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pillRow.current?.querySelector<HTMLElement>(`[data-w="${sel}"]`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [sel]);

  if (!plan) return null;
  const week = plan.weeks[sel];
  const prog = weekProgress(plan, week);

  return (
    <div className="px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <div className="animate-fade-up">
        <div className="eyebrow text-[0.72rem]">Training plan · {plan.totalWeeks} weeks</div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
          The road to <span className="italic text-accent">race day</span>
        </h1>
      </div>

      {/* week pills */}
      <div ref={pillRow} data-no-tabswipe className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {plan.weeks.map((w) => {
          const on = w.index === sel;
          const isCur = w.index === cur;
          return (
            <button
              key={w.index}
              data-w={w.index}
              onClick={() => { haptic("select"); setSel(w.index); }}
              className={`flex-shrink-0 rounded-full px-3.5 py-2 text-[0.82rem] font-semibold transition active:brightness-110 ${
                on ? "bg-accent text-white" : "border border-line bg-surface-2 text-muted"
              } ${isCur && !on ? "ring-1 ring-accent/45" : ""}`}
            >
              {w.isRaceWeek ? (<span className="inline-flex items-center gap-1"><Icon name="flag" size={14} />Race</span>) : w.label.replace(" · Recovery", "*")}
            </button>
          );
        })}
      </div>

      {/* week header */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => { haptic("select"); setSel((s) => Math.max(0, s - 1)); }}
            disabled={sel === 0}
            className="grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-surface-2 text-lg text-muted transition hover:text-foreground active:brightness-125 disabled:opacity-30"
          >
            ‹
          </button>
          <div>
            <div className="font-display text-[1.15rem] font-semibold">{week.label}</div>
            <div className="eyebrow mt-1 text-[0.7rem]">
              {week.phase} phase · {fmtDuration(week.targetHours * 3600)} target
            </div>
          </div>
          <button
            onClick={() => { haptic("select"); setSel((s) => Math.min(plan.weeks.length - 1, s + 1)); }}
            disabled={sel === plan.weeks.length - 1}
            className="grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-surface-2 text-lg text-muted transition hover:text-foreground active:brightness-125 disabled:opacity-30"
          >
            ›
          </button>
        </div>
        <span
          className="rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold tabular-nums text-accent"
          style={{ borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)" }}
        >
          {prog.done}/{prog.total}
        </span>
      </div>

      <div className="mt-3.5">
        <DayStrip week={week} today={today} plan={plan} />
      </div>

      <p className="mt-3.5 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm leading-snug text-muted">
        <span className="text-accent">◆</span> {week.focus}
      </p>

      {/* agenda */}
      <div className="mt-5 space-y-5">
        {Array.from({ length: 7 }).map((_, day) => {
          const iso = addDays(week.startDate, day);
          const items = week.workoutIds.map((id) => plan.workouts[id]).filter((w) => w && w.dayIndex === day);
          const isToday = iso === today;
          return (
            <div key={day}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`eyebrow text-[0.72rem] ${isToday ? "!text-foreground" : ""}`}>{weekdayShort(day)}</span>
                <span className="eyebrow text-[0.72rem]">{fmtDayMonth(iso)}</span>
                {isToday && (
                  <span
                    className="eyebrow rounded-full border px-1.5 py-0.5 text-[0.62rem] text-accent"
                    style={{ borderColor: "color-mix(in oklab, var(--accent) 40%, transparent)" }}
                  >
                    Today
                  </span>
                )}
              </div>
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line px-3.5 py-2.5 text-sm text-muted">Rest — recover and refuel.</div>
              ) : (
                <div className="space-y-2">
                  {items.map((w) => (
                    <SwipeableWorkout key={w.id} workout={w} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayStrip({ week, today, plan }: { week: Week; today: string; plan: Plan }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: 7 }).map((_, day) => {
        const iso = addDays(week.startDate, day);
        const items = week.workoutIds.map((id) => plan.workouts[id]).filter((w) => w.dayIndex === day);
        const isToday = iso === today;
        return (
          <div
            key={day}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-[14px] border py-2 ${
              isToday ? "border-accent/60 bg-accent/10" : "border-line bg-surface-2"
            }`}
          >
            <span className="eyebrow text-[0.6rem]">{weekdayShort(day)[0]}</span>
            <span className="font-display text-[0.98rem] font-semibold tabular-nums">{Number(iso.slice(8, 10))}</span>
            <span className="mt-0.5 flex h-1.5 items-center gap-[3px]">
              {items.length === 0 ? (
                <span className="h-1.5 w-1.5 rounded-full bg-line" />
              ) : (
                items.slice(0, 3).map((w) => (
                  <span
                    key={w.id}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: `var(--z${w.primaryZone})`, opacity: w.status === "skipped" ? 0.3 : 1 }}
                  />
                ))
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
