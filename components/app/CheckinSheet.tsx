"use client";

import { useMemo, useState } from "react";
import { Feel, Plan, Workout, Zone } from "@/lib/types";
import { DISCIPLINE_META } from "@/lib/zones";
import { fmtClock, fmtDistance } from "@/lib/format";
import { celebrationFor, computeStreak } from "@/lib/stats";
import { Sheet } from "./Sheet";
import { haptic } from "@/lib/haptics";
import { useUI } from "./ui";

// h:mm:ss / mm:ss / bare minutes → seconds
function parseClock(str: string): number | null {
  const s = str.trim();
  if (!s) return null;
  const parts = s.split(":").map((x) => Number(x));
  if (parts.some((x) => isNaN(x))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] * 60; // bare minutes
  return null;
}

const EFFORTS: { label: string; rpe: number; zone: Zone }[] = [
  { label: "Easy", rpe: 2, zone: 1 },
  { label: "Steady", rpe: 4, zone: 2 },
  { label: "Moderate", rpe: 6, zone: 3 },
  { label: "Hard", rpe: 8, zone: 4 },
  { label: "Max", rpe: 10, zone: 5 },
];

const FEELS: { key: Feel; emoji: string; label: string }[] = [
  { key: "great", emoji: "🙂", label: "Great" },
  { key: "ok", emoji: "😐", label: "OK" },
  { key: "rough", emoji: "😣", label: "Rough" },
];

export function CheckinSheet({
  workout,
  plan,
  today,
  onClose,
}: {
  workout: Workout;
  plan: Plan;
  today: string;
  onClose: () => void;
}) {
  const { actions, unit } = useUI();
  const meta = DISCIPLINE_META[workout.discipline];
  const isSwim = workout.discipline === "swim";

  const [rpe, setRpe] = useState<number | undefined>(workout.rpe);
  const [feel, setFeel] = useState<Feel | undefined>(workout.feel);
  const [showActuals, setShowActuals] = useState(!!(workout.actualDurationSec || workout.actualDistanceM));
  const [timeStr, setTimeStr] = useState(workout.actualDurationSec ? fmtClock(workout.actualDurationSec) : "");
  const [distStr, setDistStr] = useState(
    workout.actualDistanceM ? String(isSwim ? workout.actualDistanceM : workout.actualDistanceM / 1000) : "",
  );

  // frozen at open — the session is already marked done, so streak/records reflect it
  const celebration = useMemo(() => celebrationFor(plan, workout.id, today), []); // eslint-disable-line react-hooks/exhaustive-deps
  const streak = useMemo(() => computeStreak(plan, today), []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const actualDurationSec = parseClock(timeStr) ?? undefined;
    const distNum = parseFloat(distStr);
    const actualDistanceM =
      distStr.trim() && !isNaN(distNum) ? Math.round(isSwim ? distNum : distNum * 1000) : undefined;
    actions.logCheckin(workout.id, {
      rpe,
      feel,
      actualDurationSec: showActuals ? actualDurationSec : undefined,
      actualDistanceM: showActuals ? actualDistanceM : undefined,
    });
    haptic("success");
    onClose();
  };

  const markNotDone = () => {
    haptic("light");
    actions.unskip(workout.id); // back to "planned"
    onClose();
  };

  return (
    <Sheet
      onClose={onClose}
      label="Session check-in"
      footer={
        <div className="border-t border-line px-5 py-4">
          <button onClick={save} className="btn btn-primary w-full py-3.5 text-base">
            Save check-in
          </button>
          <button onClick={markNotDone} className="mt-1.5 w-full py-2 text-center text-sm text-muted transition hover:text-danger">
            Mark not done
          </button>
        </div>
      }
    >
      <div className="px-5 pb-5 pt-1">
        {/* celebration or a simple well-done */}
        {celebration ? (
          <div className="animate-fade-up mb-5 overflow-hidden rounded-2xl border border-accent/40 p-4 text-center" style={{ background: "color-mix(in oklab, var(--accent) 12%, transparent)" }}>
            <div className="celebrate text-4xl">{celebration.emoji}</div>
            <div className="mt-1.5 font-display text-lg font-bold text-gradient">{celebration.title}</div>
            <div className="mt-0.5 text-sm text-muted">{celebration.sub}</div>
          </div>
        ) : (
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-4">
            <span className="text-2xl">💪</span>
            <div>
              <div className="font-display font-semibold">Nice work — logged.</div>
              <div className="text-xs text-muted">
                {streak.current > 1 ? `🔥 ${streak.current}-day streak going.` : "One session at a time."}
              </div>
            </div>
          </div>
        )}

        <div className="mb-1 flex items-center gap-2.5">
          <span className="text-lg">{meta.icon}</span>
          <span className="font-display font-semibold leading-tight">{workout.title}</span>
        </div>
        <p className="mb-5 text-xs text-muted">Takes a few seconds — it sharpens your fitness trend and coaching. All optional.</p>

        {/* effort */}
        <div className="mb-5">
          <div className="mb-2 eyebrow text-[0.7rem]">How hard was it?</div>
          <div className="grid grid-cols-5 gap-1.5">
            {EFFORTS.map((e) => {
              const on = rpe === e.rpe;
              return (
                <button
                  key={e.rpe}
                  onClick={() => { haptic("select"); setRpe(on ? undefined : e.rpe); }}
                  className={`rounded-xl border py-2.5 text-center transition ${on ? "ring-1" : "border-line bg-surface-2"}`}
                  style={on ? { borderColor: `var(--z${e.zone})`, background: `color-mix(in oklab, var(--z${e.zone}) 16%, transparent)`, boxShadow: `0 0 0 1px var(--z${e.zone})` } : undefined}
                >
                  <span className="block h-1.5 w-full rounded-full" style={{ background: `var(--z${e.zone})`, opacity: on ? 1 : 0.5 }} />
                  <span className="mt-1.5 block text-[0.68rem] font-semibold">{e.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* feel */}
        <div className="mb-5">
          <div className="mb-2 eyebrow text-[0.7rem]">How did it feel?</div>
          <div className="grid grid-cols-3 gap-2">
            {FEELS.map((f) => {
              const on = feel === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => { haptic("select"); setFeel(on ? undefined : f.key); }}
                  className={`flex flex-col items-center gap-1 rounded-2xl border py-3 transition ${on ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface-2"}`}
                >
                  <span className="text-2xl">{f.emoji}</span>
                  <span className="text-xs font-semibold">{f.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* optional actuals */}
        {!showActuals ? (
          <button onClick={() => setShowActuals(true)} className="text-sm font-semibold text-accent-soft">
            ＋ Add exact time / distance
          </button>
        ) : (
          <div className="animate-fade-up rounded-2xl border border-line bg-surface-2 p-3.5">
            <div className="mb-2 eyebrow text-[0.7rem]">What you actually did</div>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-[0.7rem] text-muted">Time</span>
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder={workout.estDurationSec ? fmtClock(workout.estDurationSec) : "mm:ss"}
                  value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[0.7rem] text-muted">Distance ({isSwim ? "m" : "km"})</span>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder={workout.estDistanceM ? fmtDistance(workout.estDistanceM, unit).replace(/[^\d.]/g, "") : "—"}
                  value={distStr}
                  onChange={(e) => setDistStr(e.target.value)}
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
