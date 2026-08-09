"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { CountUp, useMounted } from "./motion";
import { weekOfDate } from "./widgets";
import { computeStreak, trainingStats } from "@/lib/stats";
import { isFitnessGoal } from "@/lib/planEngine";
import { daysBetween } from "@/lib/dates";
import { FormBand, PmcPoint, formStateFor, projectedPmc } from "@/lib/load";
import { FORM_TINT } from "./FormSheet";
import { addDays, fmtDayMonth } from "@/lib/dates";
import { creditedDiscipline, creditedSeconds } from "@/lib/adapt";
import { fmtDuration } from "@/lib/format";
import { DISCIPLINE_META } from "@/lib/zones";
import { Discipline } from "@/lib/types";
import { DisciplineIcon, Icon, IconName } from "./icons";

export function ProgressTab() {
  const { plan } = useApp();
  const { today } = useUI();
  const mounted = useMounted();
  if (!plan) return null;

  const curWeek = weekOfDate(plan, today).index;
  const streak = computeStreak(plan, today);
  const stats = trainingStats(plan, today);
  const form = formStateFor(plan, today);
  const bankedHrs = stats.bankedSec / 3600;

  // The forward-looking form arc: actual load so far + the load the plan prescribes
  // ahead, folded into the PMC all the way to the end of the plan. Unlike stats.pmc
  // (history only), this shows where the plan TAKES you — fitness climbing through the
  // build, the taper's fatigue drop, and form crossing into fresh at the start line — so
  // the chart means something from day one instead of an empty box until week two.
  const lastWeek = plan.weeks[plan.weeks.length - 1];
  const arcEnd = lastWeek ? addDays(lastWeek.startDate, 6) : today;
  const formArc = projectedPmc(plan, today, arcEnd);
  let todayIdx = formArc.findIndex((p) => p.dateISO === today);
  if (todayIdx < 0) todayIdx = today > arcEnd ? formArc.length - 1 : 0;

  // discipline breakdown of completed time — credit swapped ("did something else")
  // sessions to what the athlete actually did, matching the banked-hours totals.
  const byDisc: Record<string, number> = {};
  for (const w of Object.values(plan.workouts)) {
    if (w.discipline === "rest") continue;
    if (w.status === "done" || w.status === "swapped") {
      const disc = creditedDiscipline(w);
      byDisc[disc] = (byDisc[disc] ?? 0) + creditedSeconds(w);
    }
  }
  const discOrder: Discipline[] = ["swim", "bike", "run", "brick", "strength"];
  const disciplines = discOrder.filter((d) => byDisc[d]);
  const maxDisc = Math.max(1, ...Object.values(byDisc));

  const maxTarget = Math.max(...plan.weeks.map((w) => w.targetHours), 1);

  // ── the two questions this tab exists to answer ────────────────────────────
  // Ryan asked for both: "am I getting fitter?" and "am I on track for race day?".
  // The chart could already show the first if you knew how to read a PMC; neither was
  // ever stated in words, which is what made the tab feel like decoration.

  // 1. FITNESS. Compare today's CTL against where this block started. CTL is a load
  //    trend, not measured fitness (doc 02 §4 #4), so the wording says "training load"
  //    and never claims a VO2max.
  const ctlNow = form?.ctl ?? 0;
  const ctlStart = formArc[0]?.ctl ?? 0;
  const ctlDelta = ctlStart > 0 ? ((ctlNow - ctlStart) / ctlStart) * 100 : null;
  const fitnessLine =
    ctlDelta == null || stats.bankedCount === 0
      ? "Not enough training logged yet to show a trend."
      : ctlDelta >= 5
      ? `Your training load is up ${Math.round(ctlDelta)}% since this block started.`
      : ctlDelta <= -5
      ? `Your training load is down ${Math.abs(Math.round(ctlDelta))}% since this block started.`
      : "Your training load is holding steady.";

  // 2. RACE DAY. Adherence is the honest headline — a prediction built on sessions you
  //    didn't do is a guess dressed as a number.
  const racing = !isFitnessGoal(plan.profile);
  const raceISO = plan.profile.raceDateISO;
  const daysToRace = racing && raceISO ? daysBetween(today, raceISO) : null;
  const due = Object.values(plan.workouts).filter(
    (w) => w.discipline !== "rest" && w.date <= today,
  ).length;
  const kept = Object.values(plan.workouts).filter(
    (w) => w.discipline !== "rest" && w.date <= today && (w.status === "done" || w.status === "swapped"),
  ).length;
  const adherence = due > 0 ? Math.round((kept / due) * 100) : null;
  const onTrack =
    adherence == null
      ? "Your plan hasn't asked anything of you yet."
      : adherence >= 85
      ? `You've done ${kept} of the ${due} sessions due so far. That's on track.`
      : adherence >= 60
      ? `You've done ${kept} of the ${due} sessions due so far — enough to keep building, with room to tighten up.`
      : `You've done ${kept} of the ${due} sessions due so far. The plan keeps adjusting, but consistency is what moves race day.`;

  return (
    <div className="space-y-5 px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <div className="animate-fade-up">
        <div className="eyebrow text-[0.72rem]">Progress</div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
          Week {curWeek + 1} <span className="text-muted">of {plan.totalWeeks}</span>
        </h1>
      </div>

      {/* ── the two answers, in words, before any chart ──────────────────────── */}
      <div className="card animate-fade-up space-y-3 p-4">
        <div>
          <div className="eyebrow text-[0.7rem]">Am I getting fitter?</div>
          <p className="mt-1 text-[0.95rem] leading-snug">{fitnessLine}</p>
        </div>
        <div className="border-t border-line pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <div className="eyebrow text-[0.7rem]">Am I on track for race day?</div>
            {daysToRace != null && daysToRace >= 0 && (
              <span className="eyebrow text-[0.66rem] text-accent">
                {daysToRace === 0 ? "Race day" : `${daysToRace} ${daysToRace === 1 ? "day" : "days"}`}
              </span>
            )}
          </div>
          <p className="mt-1 text-[0.95rem] leading-snug">{onTrack}</p>
        </div>
      </div>

      {/* the improvement tiles */}
      <div className="grid grid-cols-3 gap-2.5">
        <Stat label="Streak" value={streak.current} suffix={streak.current === 1 ? " day" : " days"} molten flame />
        <Stat label="Sessions" value={stats.bankedCount} accent="var(--z2)" />
        <Stat label="Hours" value={Math.round(bankedHrs * 10) / 10} accent="var(--z3)" format={(n) => (Math.round(n * 10) / 10).toString()} />
      </div>

      {/* fitness & form — the PMC compressed to one glance: today's word + the trend */}
      <div className="card animate-fade-up p-4" style={{ animationDelay: "60ms" }}>
        <div className="mb-1 flex items-baseline justify-between">
          <div className="eyebrow text-[0.72rem]">Fitness &amp; form</div>
          {form ? (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: FORM_TINT[form.band] }} />
              <span className="eyebrow text-[0.66rem]">{form.word}</span>
            </span>
          ) : (
            <div className="eyebrow text-[0.66rem]">your plan&apos;s projection</div>
          )}
        </div>
        <p className="mb-3 text-xs text-muted">
          The dark line is fitness; the faint one is fatigue. The gap between them is your form.{" "}
          {todayIdx < formArc.length - 1 && <span>Dashed is where the plan takes you.</span>}
        </p>
        {formArc.length > 1 ? (
          <>
            {/* #145 — the chart had no axes, no dates and no values, so it read as
                decoration. The scale now sits beside it and the span underneath it,
                and today's actual numbers are stated rather than left to be inferred
                from where two lines happen to sit. */}
            <div className="flex gap-2">
              <div
                className="eyebrow flex flex-col justify-between py-px text-right text-[0.6rem] tabular-nums text-faint"
                aria-hidden
                style={{ minWidth: "1.6rem" }}
              >
                <span>{Math.round(Math.max(1, ...formArc.map((p) => Math.max(p.ctl, p.atl))))}</span>
                <span>0</span>
              </div>
              <div className="min-w-0 flex-1">
                <PmcChart points={formArc} todayIndex={todayIdx} band={form?.band ?? "building"} mounted={mounted} />
                <div className="eyebrow mt-1 flex justify-between text-[0.6rem] text-faint">
                  <span>{fmtDayMonth(formArc[0].dateISO)}</span>
                  <span className="text-muted">today</span>
                  <span>{fmtDayMonth(formArc[formArc.length - 1].dateISO)}</span>
                </div>
              </div>
            </div>
            {form && (
              <div className="mt-2 space-y-0.5">
                <div className="flex flex-wrap gap-x-4 text-xs text-muted">
                  <span className="tabular-nums">Fitness <b className="text-foreground">{Math.round(form.ctl)}</b></span>
                  <span className="tabular-nums">Fatigue <b className="text-foreground">{Math.round(form.atl)}</b></span>
                  <span className="tabular-nums">
                    Form <b className="text-foreground">{form.tsb > 0 ? "+" : ""}{Math.round(form.tsb)}</b>
                  </span>
                </div>
                {/* These three now subtract, so nothing needs explaining. A caveat
                    line lived here while tsb was a lagged quantity stored beside
                    today's ctl/atl (fitness 192, fatigue 208, form +11); computePmc
                    makes it same-day, and the sentence went with it. If a disclaimer
                    ever has to come back, fix the model instead. */}
              </div>
            )}
            <div className="eyebrow mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.66rem]">
              <span className="flex items-center gap-1.5"><span aria-hidden className="h-[2px] w-3.5 rounded-full bg-accent" /> Fitness</span>
              <span className="flex items-center gap-1.5"><span aria-hidden className="h-px w-3.5" style={{ background: "var(--text-faint)" }} /> Fatigue</span>
              <span className="flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-[3px]" style={{ background: FORM_TINT[form?.band ?? "building"] }} /> Form</span>
              {todayIdx < formArc.length - 1 && (
                <span className="flex items-center gap-1.5"><span aria-hidden className="h-[2px] w-3.5" style={{ background: "repeating-linear-gradient(90deg, var(--accent) 0 3px, transparent 3px 6px)" }} /> Projected</span>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-line text-center text-sm text-muted">
            Your form story appears once your plan has weeks to chart.
          </div>
        )}
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
                {/* `justify-end` is load-bearing: the completed fill has to grow from the
                    BOTTOM of the target bar. In normal flow it sat at the top, so a
                    part-finished week rendered as a block floating above the baseline with
                    a gap under it — most visible on the current week, which read as a
                    rendering glitch rather than as progress. */}
                <div
                  className="flex w-full flex-col justify-end overflow-hidden rounded-[3px] bg-surface-3"
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
          {/* the current week is drawn in ink with a dot over it; unlabelled, that dot
              read as an artefact rather than as "you are here" */}
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[3px] bg-accent" /> This week</span>
        </div>
      </div>

      {/* records */}
      <div className="card animate-fade-up p-4" style={{ animationDelay: "120ms" }}>
        <div className="eyebrow mb-3 text-[0.72rem]">Your bests</div>
        <div className="divide-y divide-line">
          <Record icon="flame" label="Longest streak" value={`${streak.longest} ${streak.longest === 1 ? "day" : "days"}`} />
          <Record
            icon={stats.longestSession ? (stats.longestSession.workout.discipline as IconName) : "medal"}
            label="Longest session"
            value={stats.longestSession ? fmtDuration(stats.longestSession.sec) : "—"}
            sub={stats.longestSession?.workout.title}
          />
          <Record icon="calendar" label="Biggest week" value={stats.biggestWeekHrs ? `${(Math.round(stats.biggestWeekHrs * 10) / 10)}h` : "—"} />
          <Record icon="stopwatch" label="Total banked" value={`${Math.round(bankedHrs * 10) / 10}h · ${stats.bankedCount} sessions`} />
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
                <span className="flex w-5 justify-center" style={{ color: `var(${DISCIPLINE_META[d].colorVar})` }}><DisciplineIcon discipline={d} size={18} /></span>
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

/*
  The restrained PMC (doc 07 §4.6): one accent fitness (CTL) line, a faint
  fatigue (ATL) shadow, and form as the quiet tint between them — success where
  fitness leads, warning where fatigue does, split at every crossing. No axes,
  no gridlines: the shape plus today's word are the whole reading.
*/
const W = 100, H = 100, PAD = 5; // the chart's viewBox, stretched to the box by preserveAspectRatio="none"

function PmcChart({
  points,
  todayIndex,
  band,
  mounted,
}: {
  points: PmcPoint[];
  todayIndex: number;
  band: FormBand;
  mounted: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // the fitness line's drawn length in CSS pixels, once measured; null = draw it solid
  const [dash, setDash] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);

  const n = points.length;
  const ti = Math.max(0, Math.min(n - 1, todayIndex)); // today's index in the arc
  const hasPast = ti >= 1;
  const hasFuture = ti < n - 1;
  const max = Math.max(1, ...points.map((p) => Math.max(p.ctl, p.atl)));
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const pt = (px: number, v: number) => `${px.toFixed(1)},${y(v).toFixed(1)}`;

  // Split each line at today: the past is solid (what actually happened), the future is
  // dashed (where the plan takes you). Slice indices map straight back to the original i.
  const pastCtlLine = points.slice(0, ti + 1).map((p, i) => pt(x(i), p.ctl)).join(" ");
  const pastAtlLine = points.slice(0, ti + 1).map((p, i) => pt(x(i), p.atl)).join(" ");
  const futureCtlLine = points.slice(ti).map((p, k) => pt(x(ti + k), p.ctl)).join(" ");
  const futureAtlLine = points.slice(ti).map((p, k) => pt(x(ti + k), p.atl)).join(" ");

  // the between-fill, split wherever the lines cross so each stretch carries
  // its own meaning; the crossing is interpolated so neither tint bleeds past it
  const regions: { ahead: boolean; pts: string }[] = [];
  let upper = [pt(x(0), points[0].ctl)];
  let lower = [pt(x(0), points[0].atl)];
  let ahead = points[0].ctl >= points[0].atl;
  const close = () => {
    if (upper.length > 1) regions.push({ ahead, pts: upper.concat(lower.reverse()).join(" ") });
  };
  for (let i = 1; i < n; i++) {
    const d0 = points[i - 1].ctl - points[i - 1].atl;
    const d1 = points[i].ctl - points[i].atl;
    if ((d1 >= 0) !== ahead && d0 !== d1) {
      const t = d0 / (d0 - d1);
      const cx = x(i - 1) + (x(i) - x(i - 1)) * t;
      const cv = points[i - 1].ctl + (points[i].ctl - points[i - 1].ctl) * t;
      upper.push(pt(cx, cv));
      lower.push(pt(cx, cv));
      close();
      upper = [pt(cx, cv)];
      lower = [pt(cx, cv)];
      ahead = d1 >= 0;
    }
    upper.push(pt(x(i), points[i].ctl));
    lower.push(pt(x(i), points[i].atl));
  }
  close();

  /* The fitness line draws itself in — but the dash that does it has to be sized
     in the space it's actually measured in. `vector-effect: non-scaling-stroke`
     puts the stroke (dashes included) in screen pixels, while the points live in
     viewBox units that `preserveAspectRatio="none"` stretches by a different
     factor on each axis. So `pathLength={100}` + `strokeDasharray={100}` described
     a dash far shorter than the ~210-point daily path and WebKit simply repeated
     it — two visible gaps in the line. Measure the drawn length instead, and
     re-measure on resize (a rotation would otherwise reopen the gaps). When we
     can't measure — reduced motion, no ResizeObserver, a zero-size box — `dash`
     stays null and the line is solid from the start, fading in like the fatigue
     one. A solid line beats a clever one. */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // the reduced-motion kill-switch in globals.css silences keyframes only —
    // a transition has to opt out here
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // draw-in animates the ACTUAL (past) line only; the projection just fades in dashed
    const coords = pastCtlLine.split(" ").map((p) => p.split(",").map(Number));
    if (coords.length < 2) return; // nothing drawn yet (brand-new plan — all projection)
    const measure = () => {
      const box = svg.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const sx = box.width / W;
      const sy = box.height / H;
      let len = 0;
      for (let i = 1; i < coords.length; i++) {
        len += Math.hypot((coords[i][0] - coords[i - 1][0]) * sx, (coords[i][1] - coords[i - 1][1]) * sy);
      }
      if (len > 0) setDash(Math.ceil(len) + 1); // a pixel of slack so rounding can't reopen a gap
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [pastCtlLine]);

  // hold the undrawn state for one painted frame, then let the transition run
  useEffect(() => {
    if (dash == null || drawn) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setDrawn(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [dash, drawn]);

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox="0 0 100 100" preserveAspectRatio="none" className="h-28 w-full overflow-visible" aria-hidden>
        {regions.map((r, i) => (
          <polygon
            key={i}
            points={r.pts}
            fill={r.ahead ? "var(--success)" : "var(--warning)"}
            fillOpacity={r.ahead ? 0.12 : 0.1}
            style={{ opacity: mounted ? 1 : 0, transition: "opacity .7s ease .55s" }}
          />
        ))}
        {/* today divider — separates what happened from what's projected */}
        {hasPast && hasFuture && (
          <line
            x1={x(ti)}
            y1={PAD}
            x2={x(ti)}
            y2={H - PAD}
            stroke="var(--line)"
            strokeWidth="1"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
            style={{ opacity: mounted ? 1 : 0, transition: "opacity .5s ease .5s" }}
          />
        )}

        {/* fatigue — faint; past solid, future dashed */}
        {hasPast && (
          <polyline
            points={pastAtlLine}
            fill="none"
            stroke="var(--text-faint)"
            strokeWidth="1"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ opacity: mounted ? 1 : 0, transition: "opacity .7s ease .55s" }}
          />
        )}
        {hasFuture && (
          <polyline
            points={futureAtlLine}
            fill="none"
            stroke="var(--text-faint)"
            strokeWidth="1"
            strokeDasharray="2 3"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ opacity: mounted ? 0.7 : 0, transition: "opacity .7s ease .7s" }}
          />
        )}

        {/* fitness — accent; past solid (draws itself in), future dashed (projection) */}
        {hasFuture && (
          <polyline
            points={futureCtlLine}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeDasharray="3 3"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ opacity: mounted ? 0.85 : 0, transition: "opacity .6s ease .7s" }}
          />
        )}
        {hasPast && (
          <polyline
            points={pastCtlLine}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            strokeDasharray={dash ?? undefined}
            strokeDashoffset={dash != null && !drawn ? dash : 0}
            style={{
              opacity: mounted ? 1 : 0,
              transition: "opacity .45s ease, stroke-dashoffset 1.1s cubic-bezier(.4,.1,.2,1)",
            }}
          />
        )}
      </svg>
      {/* today — "you are here" on the fitness line, tinted by the state word above */}
      <span
        aria-hidden
        className="absolute h-1.5 w-1.5 rounded-full"
        style={{
          left: `${x(ti)}%`,
          top: `${y(points[ti].ctl)}%`,
          transform: "translate(-50%, -50%)",
          background: FORM_TINT[band],
          boxShadow: "0 0 0 2px var(--surface)",
          opacity: mounted ? 1 : 0,
          transition: "opacity .4s ease 1s",
        }}
      />
    </div>
  );
}

function Stat({ label, value, suffix, molten, accent, flame, format }: { label: string; value: number; suffix?: string; molten?: boolean; accent?: string; flame?: boolean; format?: (n: number) => string }) {
  return (
    <div className="card p-3 text-center">
      <div className="eyebrow text-[0.66rem]">{label}</div>
      <div
        className="mt-1 font-display text-[1.8rem] font-semibold leading-none tabular-nums"
        style={{ color: molten ? "var(--accent)" : accent }}
      >
        {flame && value > 0 && <span className="mr-1 inline-block align-middle text-accent"><Icon name="flame" size={18} /></span>}
        <CountUp value={value} format={format} />
        {suffix && <span className="text-[0.9rem] font-semibold text-muted">{suffix}</span>}
      </div>
    </div>
  );
}

function Record({ icon, label, value, sub }: { icon: IconName; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="flex w-6 justify-center text-accent"><Icon name={icon} size={18} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{label}</div>
        {sub && <div className="truncate text-xs text-muted">{sub}</div>}
      </div>
      <div className="font-display text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}
