"use client";

import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { CountUp, useMounted } from "./motion";
import { weekOfDate } from "./widgets";
import { computeStreak, trainingStats } from "@/lib/stats";
import { fmtDuration } from "@/lib/format";
import { DISCIPLINE_META } from "@/lib/zones";
import { Discipline } from "@/lib/types";

export function ProgressTab() {
  const { plan } = useApp();
  const { today } = useUI();
  const mounted = useMounted();
  if (!plan) return null;

  const curWeek = weekOfDate(plan, today).index;
  const streak = computeStreak(plan, today);
  const stats = trainingStats(plan);
  const bankedHrs = stats.bankedSec / 3600;

  // discipline breakdown of completed time
  const byDisc: Record<string, number> = {};
  for (const w of Object.values(plan.workouts)) {
    if (w.discipline === "rest") continue;
    if (w.status === "done" || w.status === "swapped") byDisc[w.discipline] = (byDisc[w.discipline] ?? 0) + (w.actualDurationSec ?? w.estDurationSec ?? 0);
  }
  const discOrder: Discipline[] = ["swim", "bike", "run", "brick", "strength"];
  const disciplines = discOrder.filter((d) => byDisc[d]);
  const maxDisc = Math.max(1, ...Object.values(byDisc));

  const maxTarget = Math.max(...plan.weeks.map((w) => w.targetHours), 1);

  return (
    <div className="space-y-5 px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <div className="animate-fade-up">
        <div className="eyebrow text-[0.72rem]">Progress</div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
          Week {curWeek + 1} <span className="text-muted">of {plan.totalWeeks}</span>
        </h1>
      </div>

      {/* the improvement tiles */}
      <div className="grid grid-cols-3 gap-2.5">
        <Stat label="Streak" value={streak.current} suffix={streak.current === 1 ? " day" : " days"} molten flame />
        <Stat label="Sessions" value={stats.bankedCount} accent="var(--z2)" />
        <Stat label="Hours" value={Math.round(bankedHrs * 10) / 10} accent="var(--z3)" />
      </div>

      {/* fitness trend — the "are you getting fitter?" story */}
      <div className="card animate-fade-up p-4" style={{ animationDelay: "60ms" }}>
        <div className="mb-1 flex items-baseline justify-between">
          <div className="eyebrow text-[0.72rem]">Fitness</div>
          <div className="eyebrow text-[0.66rem]">from what you&apos;ve completed</div>
        </div>
        <p className="mb-3 text-xs text-muted">Rises as you bank training, eases when you rest. This is the line that matters.</p>
        <FitnessChart values={stats.fitness} current={curWeek} mounted={mounted} />
      </div>

      {/* weekly volume trend */}
      <div className="card animate-fade-up p-4" style={{ animationDelay: "90ms" }}>
        <div className="mb-3.5 flex items-baseline justify-between">
          <div className="eyebrow text-[0.72rem]">Weekly volume</div>
          <div className="eyebrow text-[0.66rem]">hours</div>
        </div>
        <div className="flex h-28 items-end gap-[3px]">
          {plan.weeks.map((w, i) => {
            const th = (w.targetHours / maxTarget) * 100;
            const dh = (stats.doneHrsByWeek[i] / maxTarget) * 100;
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
                    style={{ height: `${Math.min(100, (dh / Math.max(th, 1)) * 100)}%`, background: isCur ? "var(--accent)" : "var(--z2)" }}
                  />
                </div>
                {isCur && <div className="absolute -top-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-accent" />}
              </div>
            );
          })}
        </div>
        <div className="eyebrow mt-3 flex items-center gap-4 text-[0.66rem]">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[3px] bg-surface-3" /> Target</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[3px]" style={{ background: "var(--z2)" }} /> Completed</span>
        </div>
      </div>

      {/* records */}
      <div className="card animate-fade-up p-4" style={{ animationDelay: "120ms" }}>
        <div className="eyebrow mb-3 text-[0.72rem]">Your bests</div>
        <div className="divide-y divide-line">
          <Record icon="🔥" label="Longest streak" value={`${streak.longest} ${streak.longest === 1 ? "day" : "days"}`} />
          <Record
            icon={stats.longestSession ? DISCIPLINE_META[stats.longestSession.workout.discipline].icon : "🏅"}
            label="Longest session"
            value={stats.longestSession ? fmtDuration(stats.longestSession.sec) : "—"}
            sub={stats.longestSession?.workout.title}
          />
          <Record icon="📅" label="Biggest week" value={stats.biggestWeekHrs ? `${(Math.round(stats.biggestWeekHrs * 10) / 10)}h` : "—"} />
          <Record icon="⏱️" label="Total banked" value={`${Math.round(bankedHrs * 10) / 10}h · ${stats.bankedCount} sessions`} />
        </div>
      </div>

      {/* discipline breakdown */}
      <div className="card animate-fade-up p-4" style={{ animationDelay: "150ms" }}>
        <div className="eyebrow mb-3.5 text-[0.72rem]">Time by sport</div>
        {disciplines.length === 0 ? (
          <div className="text-sm text-muted">Complete a session to see your breakdown here.</div>
        ) : (
          <div className="space-y-3">
            {disciplines.map((d) => (
              <div key={d} className="flex items-center gap-3">
                <span className="w-5 text-center text-base">{DISCIPLINE_META[d].icon}</span>
                <span className="eyebrow w-11 text-[0.68rem]" style={{ color: `var(${DISCIPLINE_META[d].colorVar})` }}>
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
                <span className="w-14 text-right text-[0.78rem] tabular-nums text-muted">{fmtDuration(byDisc[d])}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="px-1 text-center text-sm leading-relaxed text-muted">
        {streak.current >= 3
          ? `${streak.current} days in a row. This is how race-day fitness gets built.`
          : "Consistency over weeks beats perfection over days. Keep showing up."}
      </p>
    </div>
  );
}

function FitnessChart({ values, current, mounted }: { values: number[]; current: number; mounted: boolean }) {
  const pts = values.slice(0, Math.max(1, current + 1));
  const n = pts.length;
  const max = Math.max(1, ...pts);
  const W = 100, H = 100, PAD = 5;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);

  if (n < 2) {
    return (
      <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-line text-center text-sm text-muted">
        Your fitness curve starts filling as the weeks bank. Log a session to begin it.
      </div>
    );
  }

  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${x(0).toFixed(1)},${H} ${line} ${x(n - 1).toFixed(1)},${H}`;

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-28 w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="fit-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#fit-fill)" style={{ opacity: mounted ? 1 : 0, transition: "opacity .8s ease" }} />
      <polyline
        points={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ opacity: mounted ? 1 : 0, transition: "opacity .8s ease" }}
      />
    </svg>
  );
}

function Stat({ label, value, suffix, molten, accent, flame }: { label: string; value: number; suffix?: string; molten?: boolean; accent?: string; flame?: boolean }) {
  return (
    <div className="card p-3 text-center">
      <div className="eyebrow text-[0.66rem]">{label}</div>
      <div
        className="mt-1 font-display text-[1.8rem] font-semibold leading-none tabular-nums"
        style={{ color: molten ? "var(--accent)" : accent }}
      >
        {flame && value > 0 && <span className="mr-0.5 text-[1.1rem]">🔥</span>}
        <CountUp value={value} />
        {suffix && <span className="text-[0.9rem] font-semibold text-muted">{suffix}</span>}
      </div>
    </div>
  );
}

function Record({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="w-6 text-center text-lg">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{label}</div>
        {sub && <div className="truncate text-xs text-muted">{sub}</div>}
      </div>
      <div className="font-display text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}
