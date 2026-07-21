"use client";

import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { CountUp, useMounted } from "./motion";
import { weekOfDate } from "./widgets";
import { daysBetween } from "@/lib/dates";
import { fmtDuration } from "@/lib/format";
import { DISCIPLINE_META } from "@/lib/zones";
import { Discipline } from "@/lib/types";

export function ProgressTab() {
  const { plan } = useApp();
  const { today } = useUI();
  const mounted = useMounted();
  if (!plan) return null;

  const all = Object.values(plan.workouts).filter((w) => w.discipline !== "rest");
  const done = all.filter((w) => w.status === "done" || w.status === "swapped");
  const skipped = all.filter((w) => w.status === "skipped");
  const totalDays = Math.max(1, daysBetween(plan.startDateISO, plan.raceDateISO));
  const elapsed = Math.max(0, Math.min(totalDays, daysBetween(plan.startDateISO, today)));
  const pct = Math.round((elapsed / totalDays) * 100);
  const curWeek = weekOfDate(plan, today).index;

  // discipline breakdown of completed time
  const byDisc: Record<string, number> = {};
  for (const w of done) byDisc[w.discipline] = (byDisc[w.discipline] ?? 0) + (w.estDurationSec || 0);
  const discOrder: Discipline[] = ["swim", "bike", "run", "brick", "strength"];
  const disciplines = discOrder.filter((d) => byDisc[d]);
  const maxDisc = Math.max(1, ...Object.values(byDisc));

  const maxTarget = Math.max(...plan.weeks.map((w) => w.targetHours), 1);
  const doneHrsByWeek = plan.weeks.map((w) =>
    w.workoutIds.reduce((a, id) => {
      const x = plan.workouts[id];
      return a + (x.status === "done" || x.status === "swapped" ? (x.estDurationSec || 0) / 3600 : 0);
    }, 0),
  );

  return (
    <div className="space-y-5 px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <div className="animate-fade-up">
        <div className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.24em] text-muted">Progress</div>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">
          Week {curWeek + 1} <span className="text-muted">of {plan.totalWeeks}</span>
        </h1>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <Stat label="Through" value={pct} suffix="%" molten />
        <Stat label="Banked" value={done.length} accent={`var(--z2)`} />
        <Stat label="Skipped" value={skipped.length} accent={skipped.length ? "var(--run)" : undefined} />
      </div>

      {/* weekly volume trend */}
      <div className="card animate-fade-up p-4" style={{ animationDelay: "60ms" }}>
        <div className="mb-3.5 flex items-baseline justify-between">
          <div className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.2em] text-muted">Weekly volume</div>
          <div className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-muted">hours</div>
        </div>
        <div className="flex h-28 items-end gap-[3px]">
          {plan.weeks.map((w, i) => {
            const th = (w.targetHours / maxTarget) * 100;
            const dh = (doneHrsByWeek[i] / maxTarget) * 100;
            const isCur = i === curWeek;
            return (
              <div key={i} className="relative flex flex-1 items-end self-stretch" title={`${w.label}: ${w.targetHours}h target`}>
                <div
                  className="w-full overflow-hidden rounded-[3px] bg-surface-3"
                  style={{
                    height: mounted ? `${th}%` : "0%",
                    transition: "height .6s cubic-bezier(.22,.8,.28,1)",
                    transitionDelay: `${Math.min(i, 20) * 16}ms`,
                  }}
                >
                  <div
                    className="w-full rounded-[3px]"
                    style={{
                      height: `${Math.min(100, (dh / Math.max(th, 1)) * 100)}%`,
                      background: isCur ? "var(--accent)" : "var(--z2)",
                    }}
                  />
                </div>
                {isCur && <div className="absolute -top-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-accent" style={{ boxShadow: "0 0 6px var(--accent)" }} />}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-4 font-mono text-[0.6rem] font-bold uppercase tracking-wide text-muted">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[3px] bg-surface-3" /> Target</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[3px]" style={{ background: "var(--z2)" }} /> Completed</span>
        </div>
      </div>

      {/* discipline breakdown */}
      <div className="card animate-fade-up p-4" style={{ animationDelay: "120ms" }}>
        <div className="mb-3.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.2em] text-muted">Time by sport</div>
        {disciplines.length === 0 ? (
          <div className="text-sm text-muted">Complete a session to see your breakdown here.</div>
        ) : (
          <div className="space-y-3">
            {disciplines.map((d) => (
              <div key={d} className="flex items-center gap-3">
                <span className="w-5 text-center text-base">{DISCIPLINE_META[d].icon}</span>
                <span className="w-11 font-mono text-[0.62rem] font-bold uppercase tracking-wide" style={{ color: `var(${DISCIPLINE_META[d].colorVar})` }}>
                  {DISCIPLINE_META[d].label}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: mounted ? `${(byDisc[d] / maxDisc) * 100}%` : "0%",
                      transition: "width .7s cubic-bezier(.22,.8,.28,1)",
                      background: `var(${DISCIPLINE_META[d].colorVar})`,
                    }}
                  />
                </div>
                <span className="w-14 text-right font-mono text-[0.72rem] tabular-nums text-muted">{fmtDuration(byDisc[d])}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="px-1 text-center text-sm leading-relaxed text-muted">
        Consistency over weeks beats perfection over days. Keep showing up.
      </p>
    </div>
  );
}

function Stat({ label, value, suffix, molten, accent }: { label: string; value: number; suffix?: string; molten?: boolean; accent?: string }) {
  return (
    <div className="card p-3 text-center">
      <div className="font-mono text-[0.58rem] font-bold uppercase tracking-[0.14em] text-muted">{label}</div>
      <div
        className={`mt-1 font-display text-[1.7rem] font-bold leading-none tabular-nums ${molten ? "heat-molten" : ""}`}
        style={!molten && accent ? { color: accent } : undefined}
      >
        <CountUp value={value} />{suffix}
      </div>
    </div>
  );
}
