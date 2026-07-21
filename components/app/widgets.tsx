"use client";

import { Phase, Plan, Week, Workout } from "@/lib/types";
import { daysBetween, fromISO, mondayOf } from "@/lib/dates";
import { fmtClock, fmtDistance } from "@/lib/format";
import { raceDistances, estimateRaceSeconds, categoryOf } from "@/lib/planEngine";
import { CountUp, useMounted } from "./motion";

export function weekOfDate(plan: Plan, iso: string): Week {
  // Match by calendar Monday, not start + 7*86400000 ms — a fixed millisecond week
  // overshoots the next Monday's local midnight by an hour across spring-forward,
  // which would return the previous week for that Monday.
  const wm = mondayOf(iso);
  const hit = plan.weeks.find((w) => w.startDate === wm);
  if (hit) return hit;
  const t = fromISO(iso).getTime();
  return t < fromISO(plan.weeks[0].startDate).getTime() ? plan.weeks[0] : plan.weeks[plan.weeks.length - 1];
}

export function workoutsOn(plan: Plan, iso: string): Workout[] {
  return Object.values(plan.workouts)
    .filter((w) => w.date === iso)
    .sort((a, b) => b.estDurationSec - a.estDurationSec);
}

const PHASE_COLOR: Record<Phase, string> = {
  base: "var(--z2)",
  build: "var(--z4)",
  peak: "var(--accent)",
  taper: "var(--z1)",
};
const PHASE_LABEL: Record<Phase, string> = { base: "Base", build: "Build", peak: "Peak", taper: "Taper" };

/** The Today hero — the countdown as a chronograph. A large dial numeral counts
 *  the days to race day; a hairline progress track (block start → race day) marks
 *  how far through training you are, like a minute scale filling toward the top. */
export function RaceCountdown({ plan, today }: { plan: Plan; today: string }) {
  const dist = raceDistances(plan.profile);
  const days = Math.max(0, daysBetween(today, plan.raceDateISO));
  const est = estimateRaceSeconds(plan.paces, plan.profile.level, categoryOf(plan.profile), dist);
  const totalDays = Math.max(1, daysBetween(plan.startDateISO, plan.raceDateISO));
  const elapsed = Math.max(0, Math.min(totalDays, daysBetween(plan.startDateISO, today)));
  const progress = elapsed / totalDays;
  const unit = plan.profile.unitPreference ?? "metric";
  const legs = [
    { label: "Swim", v: fmtDistance(dist.swim, unit), c: "var(--swim)", align: "text-left" },
    { label: "Bike", v: fmtDistance(dist.bike, unit), c: "var(--bike)", align: "text-center" },
    { label: "Run", v: fmtDistance(dist.run, unit), c: "var(--run)", align: "text-right" },
  ];

  return (
    <div className="card-glass relative overflow-hidden p-5">
      <div className="eyebrow text-[0.72rem]">{dist.name} · Race day</div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <CountUp value={days} className="font-display text-[3.6rem] font-semibold leading-[0.85] tabular-nums text-accent" />
          <span className="text-sm leading-[1.1] text-muted">
            days
            <br />
            to go
          </span>
        </div>
        <div className="text-right">
          <div className="eyebrow text-[0.66rem]">Projected</div>
          <div className="mt-0.5 font-display text-[1.4rem] font-semibold tabular-nums">{fmtClock(est)}</div>
        </div>
      </div>

      <ProgressTrack progress={progress} />

      <div className="mt-4 flex border-t border-line-soft pt-3.5">
        {legs.map((l) => (
          <div key={l.label} className={`flex-1 ${l.align}`}>
            <span className="eyebrow text-[0.72rem]" style={{ color: l.c }}>{l.label}</span>{" "}
            <span className="tabular-nums text-sm text-foreground/80">{l.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The signature: a chronograph minute-scale. The track runs from block start
 *  (left) to race day (right); the elapsed portion fills in champagne and a
 *  slim marker sits at today, sweeping into place on mount. */
function ProgressTrack({ progress }: { progress: number }) {
  const mounted = useMounted();
  const p = mounted ? Math.max(0, Math.min(1, progress)) : 0;
  const x0 = 10;
  const x1 = 310;
  const y = 26;
  const mx = x0 + (x1 - x0) * p;
  const ease = "cubic-bezier(.22,.8,.28,1)";
  return (
    <svg viewBox="0 0 320 40" width="100%" height="40" aria-hidden className="mt-5 block overflow-visible">
      {/* baseline */}
      <line x1={x0} y1={y} x2={x1} y2={y} stroke="var(--line)" strokeWidth="1" />
      {/* minute ticks */}
      {Array.from({ length: 25 }).map((_, i) => {
        const major = i % 6 === 0;
        const x = x0 + ((x1 - x0) / 24) * i;
        return (
          <line
            key={i}
            x1={x}
            y1={y}
            x2={x}
            y2={y - (major ? 7 : 4)}
            stroke="var(--text-faint)"
            strokeWidth={major ? 1.2 : 0.8}
            opacity={major ? 0.9 : 0.5}
          />
        );
      })}
      {/* elapsed fill — animated via stroke-dasharray (reliable across browsers) */}
      <line
        x1={x0}
        y1={y}
        x2={x1}
        y2={y}
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${p * 100} 100`}
        style={{ transition: `stroke-dasharray .9s ${ease}` }}
      />
      {/* today marker — a slim champagne indicator */}
      <g transform={`translate(${mx},${y})`} style={{ transition: `transform .9s ${ease}` }}>
        <line x1="0" y1="-9" x2="0" y2="5" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="0" cy="-9" r="2.2" fill="var(--accent)" />
      </g>
      {/* endpoints */}
      <circle cx={x0} cy={y} r="1.8" fill="var(--text-faint)" />
      <circle cx={x1} cy={y} r="2.2" fill="var(--accent)" />
    </svg>
  );
}

export function PhaseBar({ plan, current }: { plan: Plan; current: number }) {
  // consecutive phase bands
  const bands: { phase: Phase; count: number; startIdx: number }[] = [];
  plan.weeks.forEach((w, i) => {
    const last = bands[bands.length - 1];
    if (last && last.phase === w.phase) last.count++;
    else bands.push({ phase: w.phase, count: 1, startIdx: i });
  });
  return (
    <div className="flex gap-1.5">
      {bands.map((b, i) => {
        const isCurrent = current >= b.startIdx && current < b.startIdx + b.count;
        const isPast = current >= b.startIdx + b.count;
        return (
          <div key={i} className="flex flex-col gap-1.5" style={{ flex: b.count }}>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: `color-mix(in oklab, ${PHASE_COLOR[b.phase]} 22%, var(--surface-2))` }}>
              {isCurrent && (
                <div
                  className="h-full rounded-full"
                  style={{ width: `${((current - b.startIdx + 1) / b.count) * 100}%`, background: PHASE_COLOR[b.phase] }}
                />
              )}
              {isPast && <div className="h-full w-full rounded-full" style={{ background: PHASE_COLOR[b.phase], opacity: 0.6 }} />}
            </div>
            <div className={`eyebrow text-center text-[0.62rem] ${isCurrent ? "text-foreground" : ""}`}>
              {PHASE_LABEL[b.phase]}
            </div>
          </div>
        );
      })}
    </div>
  );
}
