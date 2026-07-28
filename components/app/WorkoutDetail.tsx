"use client";

import { useState } from "react";
import { Discipline, Plan, Segment, Unit, Workout, Zone } from "@/lib/types";
import { DISCIPLINE_META, ZONES } from "@/lib/zones";
import { DisciplineIcon, Icon, IconName } from "./icons";
import { targetView } from "@/lib/targets";
import { fmtDistance, fmtDuration } from "@/lib/format";
import { addDays, dayIndexOf, fmtDayMonth, todayISO, weekdayShort } from "@/lib/dates";
import { IntervalBar } from "./IntervalBar";
import { Sheet } from "./Sheet";
import { WorkoutPlayer } from "./WorkoutPlayer";
import { buildWorkoutFit, fitFilename } from "@/lib/fit";
import { whyForWorkout } from "@/lib/why";
import { haptic } from "@/lib/haptics";
import { useUI } from "./ui";

/** A short "8 × 100" / "6 × 3′" summary of a session's main repeat set. */
function repsSummary(w: Workout): string | null {
  const rep = w.segments.find((s) => (s.repeat ?? 1) > 1 && s.children && s.children.length);
  if (!rep || !rep.repeat) return null;
  const child = rep.children!.find((c) => c.kind !== "rest") ?? rep.children![0];
  const u = child.distanceM ? `${child.distanceM}m` : child.durationSec ? `${Math.round(child.durationSec / 60)}′` : "";
  return u ? `${rep.repeat} × ${u}` : `${rep.repeat}×`;
}

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
      <div className="mb-1 inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-[3px] text-[11px] font-semibold text-white">
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

function sectionOf(k: Segment["kind"]): "warmup" | "main" | "cooldown" {
  return k === "warmup" ? "warmup" : k === "cooldown" ? "cooldown" : "main";
}
const SECTION_LABEL = { warmup: "Warm-up", main: "Main set", cooldown: "Cool-down" };

const FEEL_META: Record<NonNullable<Workout["feel"]>, { icon: IconName; label: string }> = {
  great: { icon: "smile", label: "Felt great" },
  ok: { icon: "neutral", label: "Felt OK" },
  rough: { icon: "frown", label: "Felt rough" },
};

export function WorkoutDetail({ workout, plan }: { workout: Workout; plan: Plan }) {
  const { openWorkout, openCheckin, openCoach, actions, unit } = useUI();
  const [mode, setMode] = useState<null | "move" | "swap" | "log">(null);
  const [note, setNote] = useState("");
  const [playing, setPlaying] = useState(false);
  const meta = DISCIPLINE_META[workout.discipline];
  const reps = repsSummary(workout);
  const isRace = workout.id === "w-race-day";
  const done = workout.status === "done";
  const swapped = !!workout.swappedFrom;
  // guided play + watch export make sense for real endurance sessions
  const canGuide = !isRace && workout.discipline !== "rest" && workout.segments.length > 0;
  const canExport = canGuide && workout.discipline !== "strength";

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

  const close = () => openWorkout(null);

  return (
    <>
    {playing && <WorkoutPlayer workout={workout} plan={plan} onClose={() => setPlaying(false)} />}
    <Sheet onClose={close} label={workout.title}>
      <div className="px-5 pb-8 pt-1">
          {/* header */}
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: `color-mix(in oklab, var(${meta.colorVar}) 18%, transparent)`, color: `var(${meta.colorVar})` }}>
              <DisciplineIcon discipline={workout.discipline} size={24} />
            </div>
            <div>
              <h2 className={`font-display text-xl font-semibold leading-tight ${isRace ? "text-accent" : ""}`}>{workout.title}</h2>
              <div className="text-sm capitalize text-muted">{meta.label} · {workout.type.replace("_", " ")}{reps ? ` · ${reps}` : ""}</div>
            </div>
          </div>

          {/* totals */}
          <div className="mb-4 flex gap-2">
            <Stat label="Duration" value={workout.estDurationSec > 0 ? fmtDuration(workout.estDurationSec) : "—"} />
            {workout.estDistanceM ? <Stat label="Distance" value={fmtDistance(workout.estDistanceM, unit)} /> : null}
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
            {/* purpose is what the session does; this is why it's on YOUR plan today */}
            <p className="mt-1.5 border-t border-accent/15 pt-1.5 text-xs leading-relaxed text-muted">
              {whyForWorkout(workout, plan).text}
            </p>
          </div>

          {workout.note && (
            <div className="mb-4 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-muted">Note: {workout.note}</div>
          )}

          {/* how it went — the logged check-in */}
          {done && (workout.rpe != null || workout.feel || workout.actualDurationSec != null || workout.actualDistanceM != null) && (
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
                {workout.actualDistanceM != null && <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-sm tabular-nums">{fmtDistance(workout.actualDistanceM, unit)}</span>}
              </div>
            </div>
          )}

          {/* structure — written out, reps grouped (warm-up / main set / cool-down) */}
          <div className="mb-5 space-y-4">
            {sections.map((sec, i) => (
              <div key={i}>
                <div className="mb-1 flex items-center gap-2.5">
                  <span className="eyebrow text-[0.7rem]">{sec.label}</span>
                  <span aria-hidden className="h-px flex-1 bg-line" />
                </div>
                <div>
                  {sec.segs.map((s, j) =>
                    s.children && s.children.length ? (
                      <RepBlock key={j} seg={s} paces={plan.paces} unit={unit} />
                    ) : (
                      <Step key={j} seg={s} paces={plan.paces} unit={unit} />
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* action panels */}
          {mode === "move" && (
            <MovePanel
              onPick={(iso) => { actions.move(workout.id, iso); close(); }}
              onCancel={() => setMode(null)}
            />
          )}
          {mode === "swap" && (
            <SwapPanel current={workout.discipline} onPick={(d) => { actions.swap(workout.id, d); close(); }} onCancel={() => setMode(null)} />
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
              {canGuide && !done && (
                <button
                  onClick={() => { haptic("medium"); setPlaying(true); }}
                  className="btn accent-gradient w-full py-3.5 text-base font-semibold text-white"
                >
                  ▶ Start guided session
                </button>
              )}
              <button
                onClick={() => {
                  if (done) { haptic("light"); actions.toggleDone(workout.id); }
                  else { haptic("success"); actions.toggleDone(workout.id); close(); openCheckin(workout.id); }
                }}
                className={`btn w-full py-3.5 text-base ${done ? "btn-ghost" : "btn-primary"}`}
              >
                {done ? "✓ Completed — undo" : "Mark complete"}
              </button>
              {done && (
                <button onClick={() => { close(); openCheckin(workout.id); }} className="btn btn-ghost w-full py-2.5 text-sm">
                  {workout.rpe != null || workout.feel || workout.actualDurationSec != null ? "Edit check-in" : "＋ Add a check-in"}
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setMode(mode === "move" ? null : "move")} className="btn btn-ghost py-2.5 text-sm">Move day</button>
                <button onClick={() => setMode(mode === "swap" ? null : "swap")} className="btn btn-ghost py-2.5 text-sm">Swap sport</button>
                <button onClick={() => setMode(mode === "log" ? null : "log")} className="btn btn-ghost py-2.5 text-sm">Did something else</button>
                <button
                  onClick={() => {
                    if (workout.status === "skipped") { haptic("light"); actions.unskip(workout.id); }
                    else { haptic("warning"); actions.skip(workout.id); }
                  }}
                  className="btn btn-ghost py-2.5 text-sm"
                  style={{ color: workout.status === "skipped" ? undefined : "var(--danger)" }}
                >
                  {workout.status === "skipped" ? "Un-skip" : "Skip workout"}
                </button>
              </div>
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

function MovePanel({ onPick, onCancel }: { onPick: (iso: string) => void; onCancel: () => void }) {
  const today = todayISO();
  const days = Array.from({ length: 10 }).map((_, i) => addDays(today, i));
  return (
    <div className="mb-4 rounded-2xl border border-line bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Move to which day?</span>
        <button onClick={onCancel} className="text-xs text-muted">Cancel</button>
      </div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {days.map((iso) => (
          <button key={iso} onClick={() => onPick(iso)} className="flex flex-col items-center rounded-xl border border-line bg-surface px-3 py-2 text-center hover:bg-surface-3">
            <span className="text-xs text-muted">{weekdayShort(dayIndexOf(iso))}</span>
            <span className="tnum text-sm font-semibold">{fmtDayMonth(iso)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SwapPanel({ current, onPick, onCancel }: { current: Discipline; onPick: (d: Discipline) => void; onCancel: () => void }) {
  const opts: Discipline[] = ["swim", "bike", "run", "strength"];
  return (
    <div className="mb-4 rounded-2xl border border-line bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Swap for an easy…</span>
        <button onClick={onCancel} className="text-xs text-muted">Cancel</button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {opts.map((d) => (
          <button
            key={d}
            disabled={d === current}
            onClick={() => onPick(d)}
            className="flex flex-col items-center rounded-xl border border-line bg-surface py-2.5 disabled:opacity-30 hover:bg-surface-3"
          >
            <span style={{ color: `var(${DISCIPLINE_META[d].colorVar})` }}><DisciplineIcon discipline={d} size={22} /></span>
            <span className="mt-1 text-xs">{DISCIPLINE_META[d].label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
