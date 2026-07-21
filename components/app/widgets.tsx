"use client";

import { Phase, Plan, Week, Workout } from "@/lib/types";
import { daysBetween, fromISO } from "@/lib/dates";
import { fmtClock, fmtDistance } from "@/lib/format";
import { raceDistances, estimateRaceSeconds, categoryOf } from "@/lib/planEngine";

export function weekOfDate(plan: Plan, iso: string): Week {
  const t = fromISO(iso).getTime();
  for (const w of plan.weeks) {
    const s = fromISO(w.startDate).getTime();
    if (t >= s && t < s + 7 * 86400000) return w;
  }
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

/** The Today hero — the finish you're forging toward: a molten day count, the
 *  projected finish, and the race's three legs in their discipline colors. */
export function RaceCountdown({ plan, today }: { plan: Plan; today: string }) {
  const dist = raceDistances(plan.profile);
  const days = Math.max(0, daysBetween(today, plan.raceDateISO));
  const est = estimateRaceSeconds(plan.paces, plan.profile.level, categoryOf(plan.profile), dist);
  const legs = [
    { label: "Swim", v: fmtDistance(dist.swim), c: "var(--swim)", align: "text-left" },
    { label: "Bike", v: fmtDistance(dist.bike), c: "var(--bike)", align: "text-center" },
    { label: "Run", v: fmtDistance(dist.run), c: "var(--run)", align: "text-right" },
  ];

  return (
    <div className="card-glass forge-card relative overflow-hidden p-[18px]">
      <div className="forge-edge" aria-hidden />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(255,106,44,.22), transparent)" }}
      />
      <div className="relative">
        <div className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.2em] text-muted">{dist.name} · Race day</div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="flex items-baseline gap-2.5">
            <span className="heat-molten font-display text-[3.4rem] font-bold leading-[0.8] tabular-nums">{days}</span>
            <span className="text-sm leading-[1.05] text-muted">
              days
              <br />
              to go
            </span>
          </div>
          <div className="text-right">
            <div className="font-mono text-[0.58rem] font-bold uppercase tracking-[0.12em] text-muted">Projected</div>
            <div className="mt-0.5 font-display text-[1.25rem] font-bold tabular-nums">{fmtClock(est)}</div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex border-t border-line-soft pt-3 font-mono text-[0.72rem] font-bold">
        {legs.map((l) => (
          <div key={l.label} className={`flex-1 ${l.align}`}>
            <span style={{ color: l.c }}>{l.label.toUpperCase()}</span> <span className="tabular-nums text-foreground/75">{l.v}</span>
          </div>
        ))}
      </div>
    </div>
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
            <div className={`text-center font-mono text-[9px] font-bold uppercase tracking-wide ${isCurrent ? "text-foreground" : "text-muted"}`}>
              {PHASE_LABEL[b.phase]}
            </div>
          </div>
        );
      })}
    </div>
  );
}
