"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { SwipeableWorkout } from "./SwipeableWorkout";
import { weekOfDate, weekSessionsOn } from "./widgets";
import { weekProgress } from "@/lib/adapt";
import { addDays, weekdayShort, fmtDayMonth } from "@/lib/dates";
import { haptic } from "@/lib/haptics";
import { isFitnessGoal } from "@/lib/planEngine";
import { Plan, Week } from "@/lib/types";
import { ZONES } from "@/lib/zones";
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

  if (!plan || !plan.weeks.length) return null;
  // Clamp the selected index: `sel` is seeded once and isn't re-clamped when the plan
  // changes, so after a rebuild/compress to fewer weeks a stale `sel` would index past
  // the array and white-screen the tab (week undefined → weekProgress/DayStrip throw).
  const week = plan.weeks[Math.min(sel, plan.weeks.length - 1)];
  const prog = weekProgress(plan, week);

  return (
    <div className="px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <div className="animate-fade-up">
        <div className="eyebrow text-[0.72rem]">Training plan · {plan.totalWeeks} weeks</div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
          {isFitnessGoal(plan.profile) ? (
            <>Your <span className="italic text-accent">fitness</span> block</>
          ) : (
            <>The road to <span className="italic text-accent">race day</span></>
          )}
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
                on ? "bg-accent text-on-accent" : "border border-line bg-surface-2 text-muted"
              } ${isCur && !on ? "ring-1 ring-accent/45" : ""}`}
            >
              {w.isRaceWeek ? (
                <span className="inline-flex items-center gap-1"><Icon name="flag" size={14} />Race</span>
              ) : w.isRecovery ? (
                <span className="inline-flex items-center gap-1" title="Recovery week">
                  Week {w.index + 1}
                  <Icon name="rest" size={13} />
                </span>
              ) : (
                `Week ${w.index + 1}`
              )}
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
            <div className="font-display text-[1.15rem] font-semibold">
              {week.isRaceWeek ? "Race week" : `Week ${week.index + 1}`}
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
        <div className="flex items-center gap-2">
          {sel !== cur && (
            <button
              onClick={() => { haptic("select"); setSel(cur); }}
              className="chip whitespace-nowrap border-accent/40 text-foreground"
            >
              This week
            </button>
          )}
          {/* "1/6" on its own is a riddle — it was a bare fraction in a pill with no
              label, and VoiceOver read it as "one slash six". One word fixes both. */}
          <span
            className="rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold text-accent"
            style={{ borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)" }}
            aria-label={`${prog.done} of ${prog.total} sessions done`}
          >
            <span className="tabular-nums">
              {prog.done}/{prog.total}
            </span>{" "}
            done
          </span>
        </div>
      </div>

      <div className="mt-3.5">
        <DayStrip week={week} today={today} plan={plan} />
      </div>

      {/* The focus strings are written in the coach's imperative — "Add race-specific
          intensity", "Build the aerobic engine", "Taper — cut volume". Behind a bare ◆
          in a bordered card that reads as a to-do list item aimed at the athlete, as if
          they're the one meant to go add the intensity. It's a description of what the
          week is for. Naming it costs no vertical space and removes the ambiguity. */}
      <p className="mt-3.5 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm leading-snug text-muted">
        <span className="eyebrow mr-1.5 text-[0.68rem] text-accent">Focus</span>
        {week.focus}
      </p>

      {/* agenda */}
      <div className="mt-5 space-y-5">
        {Array.from({ length: 7 }).map((_, day) => {
          const iso = addDays(week.startDate, day);
          const items = weekSessionsOn(plan, week, iso);
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
        const items = weekSessionsOn(plan, week, iso);
        const isToday = iso === today;
        // The dots are zone colours (--z1..--z5) and nothing on screen says so, which
        // left the strip decorative to sighted users and completely silent to VoiceOver
        // — it read "M 3" and stopped, so an assistive-tech user got a week overview
        // with the week's content removed. Spelling it out here explains the colours on
        // long-press and gives the cell a real accessible name, at zero pixels.
        const summary = items.length
          ? items
              .map((w) => `${w.title} (${ZONES[w.primaryZone].name}${w.status === "skipped" ? ", skipped" : ""})`)
              .join(", ")
          : "Rest day";
        return (
          <div
            key={day}
            title={summary}
            aria-label={`${fmtDayMonth(iso)}${isToday ? ", today" : ""} — ${summary}`}
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
