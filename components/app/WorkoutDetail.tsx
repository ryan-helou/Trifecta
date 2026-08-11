"use client";

import { useState } from "react";
import { Discipline, Plan, Segment, Unit, Workout, Zone } from "@/lib/types";
import { DISCIPLINE_META, ZONES } from "@/lib/zones";
import { DisciplineIcon, Icon, IconName } from "./icons";
import { targetView } from "@/lib/targets";
import { fmtDistance, fmtDuration, fmtSets, repsSummary } from "@/lib/format";
import { newPersonalBests, summarise } from "@/lib/strength";
import { addDays, dayIndexOf, fmtDayMonth, todayISO, weekdayShort } from "@/lib/dates";
import { IntervalBar } from "./IntervalBar";
import { Sheet } from "./Sheet";
import { buildWorkoutFit, fitFilename } from "@/lib/fit";
import { whyAddsContext, whyForWorkout } from "@/lib/why";
import { adjustChoices } from "@/lib/prescribe";
import {
  canSetDistance,
  distanceChoices,
  targetChoices,
  targetKindFor,
  targetLabel,
  targetUnavailableReason,
} from "@/lib/modify";
import { haptic } from "@/lib/haptics";
import { useUI, type UIActions } from "./ui";
import { useToast } from "./Toast";
import { renderShareCard, shareCard, shareCardFilename } from "@/lib/shareCard";
import { useApp } from "../AppProvider";
import { LiveStrengthSession } from "./LiveStrengthSession";
import { RoutineEditor } from "./RoutineEditor";
import { defaultRoutineName, deleteRoutine, routineForWorkout, routineFromEntries, slotLabel, slotOf, upsertRoutine } from "@/lib/routines";
import { startSession, sessionProgress, type LiveSession } from "@/lib/liveSession";
import { loadLive, saveLive } from "@/lib/liveStore";

function RepeatGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3l4 4-4 4" /><path d="M21 7H8a4 4 0 00-4 4" /><path d="M7 21l-4-4 4-4" /><path d="M3 17h13a4 4 0 004-4" />
    </svg>
  );
}

/** One step of a session — a zone dot, what to do, and the target pace/zone. */
function Step({ seg, paces, unit }: { seg: Segment; paces: Plan["paces"]; unit: Unit }) {
  const disc = (seg.discipline ?? "run") as Discipline;
  const isRest = seg.kind === "rest";
  const z = seg.zone;
  const showTarget = z && !isRest && disc !== "strength" && disc !== "rest";
  const tv = showTarget ? targetView(disc, z as Zone, paces, unit, seg.ftpPct) : null;
  return (
    <div className="flex items-start gap-2.5 border-b border-line-soft py-2 last:border-b-0">
      <span
        aria-hidden
        className="mt-[5px] h-2 w-2 flex-shrink-0 rounded-[2px]"
        style={{ background: z ? `var(--z${z})` : "var(--rest)", opacity: isRest ? 0.55 : 1 }}
      />
      <div className={`min-w-0 flex-1 text-sm leading-snug ${isRest ? "text-muted" : ""}`}>
        {seg.description}
        {seg.cue && <div className="mt-0.5 text-xs italic text-muted">{seg.cue}</div>}
      </div>
      {(tv || z) && (
        <div className="flex-shrink-0 whitespace-nowrap pt-px text-right text-xs tabular-nums text-muted">
          {tv && <span className="font-medium text-accent">{tv.primary}</span>}
          {z && <span className="ml-1.5">Z{z}</span>}
        </div>
      )}
    </div>
  );
}

/** A repeating set — a "×N" badge over an indented list of its steps. */
function RepBlock({ seg, paces, unit }: { seg: Segment; paces: Plan["paces"]; unit: Unit }) {
  const reps = seg.repeat ?? 1;
  return (
    <div className="py-1">
      <div className="mb-1 inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-[3px] text-[11px] font-semibold text-on-accent">
        <RepeatGlyph /> {reps} ×
      </div>
      <div className="border-l-2 border-line pl-3.5">
        {(seg.children ?? []).map((c, i) => (
          <Step key={i} seg={c} paces={paces} unit={unit} />
        ))}
      </div>
    </div>
  );
}

/** One labelled row of chips. Every control in Modify has the same shape, so the
 *  sheet reads as a list of properties of the session rather than five unrelated
 *  tools that happen to be stacked. */
function ModifyRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="eyebrow mb-1.5 text-[0.68rem]">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-[0.7rem] leading-snug text-faint">{hint}</p>}
    </div>
  );
}

/**
 * MODIFY WORKOUT — the single place to change anything about a session (#185).
 *
 * Length, distance, intensity, sport and day were previously four separate
 * buttons plus two undiscoverable swipe gestures (#174). They are properties of
 * the same session, so they live in one sheet; the swipes stay as shortcuts for
 * people who already know them.
 *
 * INTENSITY IS NOT COSMETIC. Picking a pace re-prescribes the session at the zone
 * that pace actually is, and the rest of the week absorbs it — so the row states
 * the zone next to the pace, and the hint says plainly that the plan will move.
 * Where no honest target exists (a ride from an athlete with no FTP) the row is
 * replaced by the reason, never silently dropped (#130).
 */
function ModifyPanel({
  plan,
  workout,
  unit,
  actions,
  onDone,
  onClose,
}: {
  plan: Plan;
  workout: Workout;
  unit: Unit;
  actions: UIActions;
  onDone: () => void;
  onClose: () => void;
}) {
  const lengths = adjustChoices(workout);
  const distances = canSetDistance(workout) ? distanceChoices(workout) : [];
  const kind = targetKindFor(workout, plan.paces);
  const paceWhy = targetUnavailableReason(workout, plan.paces);
  const paces = kind ? targetChoices(plan.paces, kind) : [];
  const sports: Discipline[] = ["swim", "bike", "run", "strength"];
  const today = todayISO();
  const days = Array.from({ length: 10 }).map((_, i) => addDays(today, i));
  const baseSec = workout.prescribed?.estDurationSec ?? workout.estDurationSec;
  const baseM = workout.prescribed?.estDistanceM ?? workout.estDistanceM ?? 0;

  return (
    <div className="mb-4 rounded-2xl border border-line bg-surface-2 p-3.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold">Modify workout</span>
        <button onClick={onClose} className="text-xs text-muted">Done</button>
      </div>

      {lengths.length > 0 && (
        <ModifyRow label="Length" hint="Keeps its shape — whole intervals in or out, never a quiet rewrite.">
          {lengths.map((sec) => {
            const isNow = Math.abs(sec - workout.estDurationSec) < 60;
            const isPlanned = Math.abs(sec - baseSec) < 60;
            return (
              <button
                key={sec}
                onClick={() => { haptic("select"); actions.adjust(workout.id, sec); }}
                aria-pressed={isNow}
                className={`chip ${isNow ? "is-selected" : ""}`}
              >
                {fmtDuration(sec)}{isPlanned && !isNow ? " · planned" : ""}
              </button>
            );
          })}
        </ModifyRow>
      )}

      {distances.length > 0 && (
        <ModifyRow label="Distance" hint="Time moves with it, so the header never disagrees with the steps.">
          {distances.map((m) => {
            const isNow = Math.abs(m - (workout.estDistanceM ?? 0)) < 50;
            const isPlanned = Math.abs(m - baseM) < 50;
            return (
              <button
                key={m}
                onClick={() => { haptic("select"); actions.setDistance(workout.id, m); }}
                aria-pressed={isNow}
                className={`chip ${isNow ? "is-selected" : ""}`}
              >
                {fmtDistance(m, unit, workout.discipline === "swim")}{isPlanned && !isNow ? " · planned" : ""}
              </button>
            );
          })}
        </ModifyRow>
      )}

      {kind ? (
        <ModifyRow
          label="Pace"
          hint="Changing this changes what the session IS — the zone moves with it, and the rest of the week adjusts to absorb it."
        >
          {paces.map(({ zone, value }) => (
            <button
              key={zone}
              onClick={() => { haptic("select"); actions.repace(workout.id, value); }}
              aria-pressed={zone === workout.primaryZone}
              className={`chip ${zone === workout.primaryZone ? "is-selected" : ""}`}
            >
              {targetLabel(kind, value)}
              <span className="ml-1 text-[0.68rem] text-muted">Z{zone}</span>
            </button>
          ))}
        </ModifyRow>
      ) : paceWhy ? (
        <ModifyRow label="Pace">
          <p className="text-[0.72rem] leading-snug text-muted">{paceWhy}</p>
        </ModifyRow>
      ) : null}

      {/* The hint has to say EASY. `replacementDraft` always builds an easy session
          of the new sport, so swapping a threshold run for a bike silently drops a
          Zone 5 session to Zone 2 — you lose the quality, not just the sport. The
          old panel was headed "Swap for an easy…" and said so; the one-sheet rewrite
          (#185) dropped that wording and left only the capping note, which is the
          less important half. Reported by Ryan noticing a swap changed nothing but
          the day. */}
      <ModifyRow
        label="Sport"
        hint={
          workout.primaryZone >= 4
            ? "Swapping gives you an EASY session of that sport — this is a hard session, so its quality is lost, not moved. Capped too, so a swap can't hide a jump in running load."
            : "Swapping gives you an easy session of that sport, capped so it can't hide a jump in running load."
        }
      >
        {sports.map((d) => (
          <button
            key={d}
            disabled={d === workout.discipline}
            onClick={() => { haptic("select"); actions.swap(workout.id, d); onDone(); }}
            className={`chip inline-flex items-center gap-1.5 disabled:opacity-30 ${d === workout.discipline ? "is-selected" : ""}`}
          >
            <span style={{ color: `var(${DISCIPLINE_META[d].colorVar})` }}><DisciplineIcon discipline={d} size={16} /></span>
            {DISCIPLINE_META[d].label}
          </button>
        ))}
      </ModifyRow>

      <ModifyRow label="Day">
        <div className="no-scrollbar -mx-0.5 flex w-full gap-1.5 overflow-x-auto px-0.5">
          {days.map((iso) => (
            <button
              key={iso}
              onClick={() => { haptic("select"); actions.move(workout.id, iso); onDone(); }}
              aria-pressed={iso === workout.date}
              className={`chip shrink-0 ${iso === workout.date ? "is-selected" : ""}`}
            >
              {weekdayShort(dayIndexOf(iso))} {fmtDayMonth(iso)}
            </button>
          ))}
        </div>
      </ModifyRow>

      <div className="border-t border-line pt-3">
        <button
          onClick={() => {
            if (workout.status === "skipped") { haptic("light"); actions.unskip(workout.id); }
            else { haptic("warning"); actions.skip(workout.id); onDone(); }
          }}
          className="btn btn-ghost w-full py-2.5 text-sm"
          style={{ color: workout.status === "skipped" ? undefined : "var(--danger)" }}
        >
          {workout.status === "skipped" ? "Un-skip this session" : "Skip this session"}
        </button>
      </div>
    </div>
  );
}

function sectionOf(k: Segment["kind"]): "warmup" | "main" | "cooldown" {
  return k === "warmup" ? "warmup" : k === "cooldown" ? "cooldown" : "main";
}
const SECTION_LABEL = { warmup: "Warm-up", main: "Main set", cooldown: "Cool-down" };

const FEEL_META: Record<NonNullable<Workout["feel"]>, { icon: IconName; label: string }> = {
  great: { icon: "smile", label: "Felt great" },
  ok: { icon: "neutral", label: "Felt OK" },
  rough: { icon: "frown", label: "Felt rough" },
};

/** The written-out interval breakdown, hidden by default. Beginners see the
 *  Shape bar and the Why-it-matters copy; only the athletes who want to know
 *  exactly what to hit tap in. Reduces the wall-of-numbers on first render. */
function SessionStructure({ sections, paces, unit }: { sections: { label: string; segs: Segment[] }[]; paces: Plan["paces"]; unit: Unit }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-left transition hover:brightness-110"
      >
        <span className="text-sm font-semibold">Session structure</span>
        <span className="text-xs text-muted">{open ? "Hide" : "Show"} <span className="ml-0.5 text-accent-soft">{open ? "▴" : "▾"}</span></span>
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          {sections.map((sec, i) => (
            <div key={i}>
              <div className="mb-1 flex items-center gap-2.5">
                <span className="eyebrow text-[0.7rem]">{sec.label}</span>
                <span aria-hidden className="h-px flex-1 bg-line" />
              </div>
              <div>
                {sec.segs.map((s, j) =>
                  s.children && s.children.length ? (
                    <RepBlock key={j} seg={s} paces={paces} unit={unit} />
                  ) : (
                    <Step key={j} seg={s} paces={paces} unit={unit} />
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkoutDetail({ workout, plan }: { workout: Workout; plan: Plan }) {
  const { openWorkout, openCheckin, openCoach, actions, unit } = useUI();
  const { profile, updateProfile } = useApp();
  const toast = useToast();

  // ---- the gym session, live (#212) --------------------------------------
  // A gym day can be TRACKED rather than remembered: start it, tick sets off as
  // you do them, finish. The draft lives in localStorage (lib/liveStore) so it
  // survives the phone locking between sets — see that file for why it isn't on
  // the plan. `live` mirrors it so the button can say "Resume · 6/16".
  const isGym = workout.discipline === "strength";
  // Restored once, on mount. The sheet is only ever mounted by a tap (so we are
  // past hydration) and AppShell keys it by workout id, so a lazy initializer is
  // both SSR-safe and correct across switching sessions — and it avoids setting
  // state from an effect, which would render the sheet once with a stale "Start"
  // button before flipping it to "Resume".
  const [live, setLive] = useState<LiveSession | null>(() =>
    typeof window === "undefined" || workout.discipline !== "strength" ? null : loadLive(workout.id, todayISO()),
  );
  const [liveOpen, setLiveOpen] = useState(false);
  const [editRoutine, setEditRoutine] = useState(false);
  const slot = isGym ? slotOf(workout) : null;
  const routine = isGym ? routineForWorkout(profile, workout) : null;
  const [mode, setMode] = useState<null | "log" | "modify">(null);
  const [note, setNote] = useState("");
  const meta = DISCIPLINE_META[workout.discipline];
  const reps = repsSummary(workout);
  const isRace = workout.id === "w-race-day";
  const done = workout.status === "done";
  // Which lifts in this session beat everything before it. Computed against the
  // whole plan minus this session, so the first time you log a lift it reads
  // "New" rather than claiming a personal best over nothing (#199).
  const pbs = workout.strengthLog?.length ? newPersonalBests(workout, Object.values(plan.workouts)) : [];
  const swapped = !!workout.swappedFrom;
  // Watch export makes sense for real endurance sessions. (This used to also gate a
  // "start guided session" in-app player; that's gone — #111.)
  const canExport =
    !isRace && workout.discipline !== "rest" && workout.discipline !== "strength" && workout.segments.length > 0;

  // Rendering the card takes a beat (fonts + canvas + PNG encode), and the Web Share
  // sheet must be opened from the same user gesture, so the button reports its own
  // state rather than looking dead while it works.
  const [sharing, setSharing] = useState(false);
  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const blob = await renderShareCard({ workout, plan, unit });
      if (!blob) throw new Error("no canvas");
      const result = await shareCard(
        blob,
        shareCardFilename(workout),
        `${workout.title} — trained with Trifecta`,
      );
      if (result === "shared") haptic("success");
      else if (result === "downloaded") {
        haptic("success");
        toast({ text: "Card saved to your downloads." });
      } else if (result === "failed") {
        haptic("warning");
        toast({ text: "Couldn't make that card. Try again?", tone: "warning" });
      }
    } catch {
      haptic("warning");
      toast({ text: "Couldn't make that card. Try again?", tone: "warning" });
    } finally {
      setSharing(false);
    }
  };

  const exportFit = () => {
    try {
      const bytes = buildWorkoutFit(workout, plan.paces);
      const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fitFilename(workout);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      haptic("success");
    } catch {
      haptic("warning");
    }
  };

  // group segments into sections
  const sections: { label: string; segs: Segment[] }[] = [];
  let cur = "";
  for (const s of workout.segments) {
    const sec = sectionOf(s.kind);
    if (sec !== cur) {
      sections.push({ label: SECTION_LABEL[sec], segs: [] });
      cur = sec;
    }
    sections[sections.length - 1].segs.push(s);
  }

  const why = whyForWorkout(workout, plan);
  const close = () => openWorkout(null);

  return (
    <>
    <Sheet onClose={close} label={workout.title}>
      <div className="px-5 pb-8 pt-1">
          {/* header */}
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: `color-mix(in oklab, var(${meta.colorVar}) 18%, transparent)`, color: `var(${meta.colorVar})` }}>
              <DisciplineIcon discipline={workout.discipline} size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className={`font-display text-xl font-semibold leading-tight ${isRace ? "text-accent" : ""}`}>{workout.title}</h2>
              <div className="text-sm capitalize text-muted">{meta.label} · {workout.type.replace("_", " ")}{reps ? ` · ${reps}` : ""}</div>
            </div>
            {/* Every other sheet has one; this was the only way out being a swipe,
                which is exactly the affordance problem (#173). */}
            <button
              onClick={close}
              aria-label="Close"
              className="-mr-1 shrink-0 self-start p-1 text-muted transition hover:text-foreground"
            >
              ✕
            </button>
          </div>

          {/* totals */}
          <div className="mb-4 flex gap-2">
            <Stat label="Duration" value={workout.estDurationSec > 0 ? fmtDuration(workout.estDurationSec) : "—"} />
            {workout.estDistanceM ? <Stat label="Distance" value={fmtDistance(workout.estDistanceM, unit, workout.discipline === "swim")} /> : null}
            <Stat label="Intensity" value={ZONES[workout.primaryZone].name} accent />
          </div>

          {/* shape — a small at-a-glance silhouette of the session */}
          {!isRace && (
            <div className="mb-4">
              <div className="eyebrow mb-1.5 text-[0.66rem]">Shape</div>
              <IntervalBar segments={workout.segments} height={14} />
            </div>
          )}

          {/* purpose */}
          <div className="mb-4 rounded-2xl border border-accent/25 bg-accent/5 p-3.5">
            <div className="eyebrow mb-1 text-[0.72rem] text-accent">Why it matters</div>
            <p className="text-sm leading-relaxed">{workout.purpose}</p>
            {/* purpose is what the session does; this is why it's on YOUR plan today.
                Only when it actually differs — see whyAddsContext. The generic phase
                fallback paraphrases purpose, which on device read as the card saying
                the same thing twice in a row. */}
            {whyAddsContext(why) && (
              <p className="mt-1.5 border-t border-accent/15 pt-1.5 text-xs leading-relaxed text-muted">{why.text}</p>
            )}
            {/* A re-paced session keeps its planned NAME while its intensity moves,
                so "Long Endurance Run" can sit above "Threshold" and read like the
                app contradicting itself. It doesn't — the athlete set it — and this
                is the sentence that says so. Rendered from `pacedAt` rather than
                written into `purpose`, so repeated edits can't stack up copies of
                it and reverting the session can't leave the note behind. */}
            {workout.pacedAt && (
              <p className="mt-1.5 border-t border-accent/15 pt-1.5 text-xs leading-relaxed text-muted">
                You set this at {targetLabel(workout.pacedAt.kind, workout.pacedAt.value)} — that&apos;s{" "}
                {ZONES[workout.pacedAt.zone].name.toLowerCase()} (Z{workout.pacedAt.zone}), not the{" "}
                {workout.prescribed ? "pace it was written for" : "planned pace"}.
              </p>
            )}
          </div>

          {workout.note && (
            <div className="mb-4 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-muted">Note: {workout.note}</div>
          )}

          {/* how it went — the logged check-in */}
          {done && (workout.rpe != null || workout.feel || workout.actualDurationSec != null || workout.actualDistanceM != null || workout.strengthLog?.length) && (
            <div className="mb-4 rounded-2xl border p-3.5" style={{ borderColor: "color-mix(in oklab, var(--success) 35%, transparent)", background: "color-mix(in oklab, var(--success) 7%, transparent)" }}>
              <div className="eyebrow mb-2 text-[0.72rem]" style={{ color: "var(--success)" }}>How it went</div>
              <div className="flex flex-wrap items-center gap-2">
                {workout.feel && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-sm">
                    <Icon name={FEEL_META[workout.feel].icon} size={16} className="text-muted" />{FEEL_META[workout.feel].label}
                  </span>
                )}
                {workout.rpe != null && <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-sm tabular-nums">RPE {workout.rpe}</span>}
                {workout.actualDurationSec != null && <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-sm tabular-nums">{fmtDuration(workout.actualDurationSec)}</span>}
                {workout.actualDistanceM != null && <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-sm tabular-nums">{fmtDistance(workout.actualDistanceM, unit, workout.discipline === "swim")}</span>}
                {!!workout.strengthLog?.length && (
                  <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-sm tabular-nums">{summarise(workout.strengthLog)}</span>
                )}
              </div>

              {/* What was actually lifted, read back (#199). A log you can enter and
                  never see again is a write-only field, and the reason to keep one
                  is looking up what you did last time. */}
              {!!workout.strengthLog?.length && (
                <div className="mt-2.5 space-y-1 border-t border-line/60 pt-2.5">
                  {workout.strengthLog.map((e) => {
                    const pb = pbs.find((p) => p.name.toLowerCase() === e.name.trim().toLowerCase());
                    return (
                      <div key={e.name} className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">
                          {e.name}
                          {pb && (
                            <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide" style={{ color: "var(--accent)", background: "color-mix(in oklab, var(--accent) 15%, transparent)" }}>
                              {pb.previousKg != null ? "PB" : "New"}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted">{fmtSets(e.sets, unit)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Session structure — still collapsed by default. Part of the original
              reasoning was "the guided player renders it live anyway", which stopped
              being true when that player was removed (#111); the rest still holds and
              is why this stays shut: Duration + Intensity + the Shape bar upstairs
              already give the size and feel of the session, and the full interval
              breakdown is a power-user detail that intimidates a beginner. One tap
              away, and now the only place to read it. */}
          {sections.length > 0 && (
            <SessionStructure sections={sections} paces={plan.paces} unit={unit} />
          )}

          {/* action panels */}
          {mode === "modify" && (
            <ModifyPanel
              plan={plan}
              workout={workout}
              unit={unit}
              actions={actions}
              onDone={close}
              onClose={() => setMode(null)}
            />
          )}
          {mode === "log" && (
            <div className="mb-4 rounded-2xl border border-line bg-surface-2 p-3">
              <div className="mb-2 text-sm font-semibold">What did you do instead?</div>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 45 min easy trail run" />
              <div className="mt-2 flex gap-2">
                <button className="btn btn-primary flex-1 py-2.5" onClick={() => { if (note.trim()) { actions.logInstead(workout.id, note.trim()); close(); } }}>Save</button>
                <button className="btn btn-ghost px-4 py-2.5" onClick={() => setMode(null)}>Cancel</button>
              </div>
            </div>
          )}

          {/* actions */}
          {!isRace ? (
            <div className="space-y-2">
              {/* A gym session gets tracked, not remembered (#212). This is the
                  primary action for one — "Mark complete" is still there below,
                  for the day you did it and just want it ticked. */}
              {isGym && !done && (
                <>
                  <button
                    onClick={() => {
                      haptic("success");
                      if (!live) {
                        const s = startSession({
                          workoutId: workout.id,
                          startedISO: new Date().toISOString(),
                          slot,
                          name: routine?.name ?? workout.title,
                          from: workout.strengthLog ?? routine?.exercises ?? [],
                        });
                        saveLive(s);
                        setLive(s);
                      }
                      setLiveOpen(true);
                    }}
                    className="btn btn-primary w-full py-3.5 text-base"
                  >
                    {live
                      ? `Resume workout · ${sessionProgress(live).done}/${sessionProgress(live).total} sets`
                      : "Start workout"}
                  </button>
                  {/* Starting with an empty card is a fine way to train, but it's
                      also the moment the athlete most wants to build the day once. */}
                  {!routine && !live && (
                    <button onClick={() => setEditRoutine(true)} className="btn btn-ghost w-full py-2.5 text-sm">
                      ＋ Build a routine for {slot ? slotLabel(slot) : "this day"}
                    </button>
                  )}
                  {routine && !live && (
                    <button onClick={() => setEditRoutine(true)} className="btn btn-ghost w-full py-2.5 text-sm">
                      Edit {routine.name}
                    </button>
                  )}
                </>
              )}
              <button
                onClick={() => {
                  if (done) { haptic("light"); actions.toggleDone(workout.id); }
                  else { haptic("success"); actions.toggleDone(workout.id); close(); openCheckin(workout.id); }
                }}
                className={`btn w-full py-3.5 text-base ${done || (isGym && !done) ? "btn-ghost" : "btn-primary"}`}
              >
                {done ? "✓ Completed — undo" : "Mark complete"}
              </button>
              {done && (
                <button onClick={() => { close(); openCheckin(workout.id); }} className="btn btn-ghost w-full py-2.5 text-sm">
                  {workout.rpe != null || workout.feel || workout.actualDurationSec != null ? "Edit check-in" : "＋ Add a check-in"}
                </button>
              )}
              {/* ONE entry point (#185). Length, distance, pace, sport, day and skip
                  were five buttons and two undiscoverable swipes (#174); they are all
                  properties of this session, so they live behind one door. */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setMode(mode === "modify" ? null : "modify")} className="btn btn-ghost py-2.5 text-sm">
                  {mode === "modify" ? "Close" : "Modify workout"}
                </button>
                <button onClick={() => setMode(mode === "log" ? null : "log")} className="btn btn-ghost py-2.5 text-sm">Did something else</button>
              </div>
              {/* Only once it's actually done — a card for a session you haven't
                  trained yet is a claim, not a result. */}
              {done && (
                <button onClick={share} disabled={sharing} className="btn btn-ghost w-full py-2.5 text-sm">
                  <Icon name="share" size={16} /> {sharing ? "Making your card…" : "Share this session"}
                </button>
              )}
              {canExport && (
                <button onClick={exportFit} className="btn btn-ghost w-full py-2.5 text-sm">
                  <Icon name="install" size={16} /> Export to watch (.FIT)
                </button>
              )}
              <button onClick={() => openCoach(`About my session "${workout.title}": `)} className="btn btn-ghost w-full py-2.5 text-sm">
                <Icon name="chat" size={16} /> Ask the coach about this
              </button>
            </div>
          ) : (
            <button
              onClick={() => { haptic(done ? "light" : "success"); actions.toggleDone(workout.id); }}
              className={`btn w-full py-3.5 text-base ${done ? "btn-ghost" : "btn-primary"}`}
            >
              {done ? (<><Icon name="trophy" size={18} /> You did it! (undo)</>) : (<>I finished the race <Icon name="flag" size={18} /></>)}
            </button>
          )}
        </div>
    </Sheet>

    {/* The gym session as it happens (#212). Closing it does NOT end it — the
        draft stays in storage and the button above becomes "Resume". */}
    {liveOpen && live && (
      <LiveStrengthSession
        session={live}
        history={Object.values(plan.workouts)}
        unit={unit}
        routineName={routine?.name ?? null}
        onChange={setLive}
        onClose={() => setLiveOpen(false)}
        onFinish={(entries) => {
          setLive(null);
          setLiveOpen(false);
          actions.logCheckin(workout.id, { strengthLog: entries });
          close();
          toast({ text: `${workout.title} logged — nice work.`, tone: "success" });
        }}
        onDiscard={() => { setLive(null); setLiveOpen(false); }}
        onSaveRoutine={
          slot && profile
            ? (entries) => {
                const next = routineFromEntries(slot, routine?.name ?? defaultRoutineName(slot), entries, todayISO());
                if (!next) return;
                updateProfile({ ...profile, routines: upsertRoutine(profile.routines, next) });
                toast({ text: `Saved as ${next.name}.`, tone: "success" });
              }
            : undefined
        }
      />
    )}

    {editRoutine && profile && (
      <RoutineEditor
        profile={profile}
        existing={routine}
        // Opened from THIS gym day, so it opens on this gym day. Without it the
        // picker defaulted to the first unbuilt slot — tapping "Build a routine
        // for Legs" landed you on Push.
        initialSlot={slot}
        history={Object.values(plan.workouts)}
        unit={unit}
        nowISO={todayISO()}
        onClose={() => setEditRoutine(false)}
        onSave={(r) => {
          updateProfile({ ...profile, routines: upsertRoutine(profile.routines, r) });
          setEditRoutine(false);
          toast({ text: `${r.name} saved — every ${slotLabel(r.slot)} opens as this.`, tone: "success" });
        }}
        onDelete={(sl) => {
          updateProfile({ ...profile, routines: deleteRoutine(profile.routines, sl) });
          setEditRoutine(false);
          toast({ text: "Routine deleted.", tone: "success" });
        }}
      />
    )}
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2">
      <div className="eyebrow text-[0.66rem]">{label}</div>
      <div className={`font-display text-base font-semibold tnum ${accent ? "text-accent" : ""}`}>{value}</div>
    </div>
  );
}
