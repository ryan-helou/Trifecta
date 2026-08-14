"use client";

import { Phase, Plan, Week, Workout } from "@/lib/types";
import { daysBetween, fromISO, mondayOf, fmtShortDate } from "@/lib/dates";
import { fmtClock, fmtDistance } from "@/lib/format";
import { raceDistances, estimateRaceSeconds, categoryOf, raceCategoryName } from "@/lib/planEngine";
import { terrainOf } from "@/lib/terrain";
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

/** The sessions from THIS week that fall on `iso`.
 *
 *  Date is the single source of truth. The Plan tab builds its day heading from
 *  `week.startDate + day` but used to pick the sessions by `w.dayIndex` — a second,
 *  independently-maintained answer to "which day is this?". When the two drifted, a
 *  session rendered under a heading it did not belong to, and the card gave no hint:
 *  Ryan saw a run he finished on Friday sitting under Saturday, still marked
 *  completed, which reads as the app claiming he completed a run in the future. */
export function weekSessionsOn(plan: Plan, week: Week, iso: string): Workout[] {
  return week.workoutIds
    .map((id) => plan.workouts[id])
    .filter((w): w is Workout => !!w && w.date === iso);
}

/** The next real sessions after `iso` (soonest first) — powers Today's "Up next"
 *  peek so the home screen answers "what's coming?", not just "what's today". */
export function upcomingAfter(plan: Plan, iso: string, n = 1): Workout[] {
  return Object.values(plan.workouts)
    // `status === "planned"`, not just "not skipped". A session you've already ticked
    // off is not "up next" — Today was showing tomorrow's ride under the Up next
    // heading with a COMPLETED badge on it, which answers the opposite of the question
    // the card exists to answer.
    .filter((w) => w.date > iso && w.discipline !== "rest" && w.status === "planned")
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.estDurationSec - a.estDurationSec))
    .slice(0, n);
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
  const est = estimateRaceSeconds(plan.paces, plan.profile.level, categoryOf(plan.profile), dist, terrainOf(plan.profile));
  const totalDays = Math.max(1, daysBetween(plan.startDateISO, plan.raceDateISO));
  const elapsed = Math.max(0, Math.min(totalDays, daysBetween(plan.startDateISO, today)));
  const progress = elapsed / totalDays;
  const unit = plan.profile.unitPreference ?? "metric";
  const legs = [
    { label: "Swim", v: fmtDistance(dist.swim, unit, true), c: "var(--swim)", align: "text-left" },
    { label: "Bike", v: fmtDistance(dist.bike, unit), c: "var(--bike)", align: "text-center" },
    { label: "Run", v: fmtDistance(dist.run, unit), c: "var(--run)", align: "text-right" },
  ];

  return (
    <div className="card-glass relative overflow-hidden p-5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow text-[0.72rem]">{raceCategoryName(plan.profile)} · Race day</div>
        <div className="eyebrow text-[0.72rem] text-muted">{fmtShortDate(plan.raceDateISO)}</div>
      </div>

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

/** The Today hero for fitness mode (no race): there's no countdown, so it anchors
 *  on where you are in the rolling block — the week number, current phase, this
 *  week's target hours, and the sessions-per-sport mix. */
export function FitnessHero({ plan, today }: { plan: Plan; today: string }) {
  const wk = weekOfDate(plan, today);
  const counts: Record<"swim" | "bike" | "run", number> = { swim: 0, bike: 0, run: 0 };
  for (const id of wk.workoutIds) {
    const w = plan.workouts[id];
    if (!w) continue;
    const d = w.discipline === "brick" ? "bike" : w.discipline; // credit the brick's ride to bike
    if (d === "swim" || d === "bike" || d === "run") counts[d]++;
  }
  const legs = [
    { label: "Swim", v: `${counts.swim}×`, c: "var(--swim)", align: "text-left" },
    { label: "Bike", v: `${counts.bike}×`, c: "var(--bike)", align: "text-center" },
    { label: "Run", v: `${counts.run}×`, c: "var(--run)", align: "text-right" },
  ];
  return (
    <div className="card-glass relative overflow-hidden p-5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow text-[0.72rem]">Fitness mode · Building</div>
        <div className="eyebrow text-[0.72rem] text-muted">{PHASE_LABEL[wk.phase]} block</div>
      </div>
      <div className="mt-1 truncate font-display text-[0.98rem] font-semibold leading-tight">All-round triathlon fitness</div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <CountUp value={wk.index + 1} className="font-display text-[3.6rem] font-semibold leading-[0.85] tabular-nums text-accent" />
          <span className="text-sm leading-[1.1] text-muted">
            week of
            <br />
            training
          </span>
        </div>
        <div className="text-right">
          <div className="eyebrow text-[0.66rem]">This week</div>
          <div className="mt-0.5 font-display text-[1.4rem] font-semibold tabular-nums">{wk.targetHours}h</div>
        </div>
      </div>

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
