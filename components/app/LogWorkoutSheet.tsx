"use client";

import { useState } from "react";
import { Discipline, Feel, Plan, Zone } from "@/lib/types";
import type { LogResult } from "@/lib/adapt";
import { DisciplineIcon, Icon, IconName } from "./icons";
import { Sheet } from "./Sheet";
import { haptic } from "@/lib/haptics";
import { useUI } from "./ui";
import { fmtFullDate, addDays } from "@/lib/dates";

const M_PER_MILE = 1609.34;

// h:mm:ss / mm:ss / bare minutes / colon-less digits (mmss) → seconds
function parseClock(str: string): number | null {
  const s = str.trim();
  if (!s) return null;
  if (s.includes(":")) {
    const parts = s.split(":").map((x) => Number(x));
    if (parts.some((x) => isNaN(x) || x < 0)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0] * 60;
    return null;
  }
  if (!/^\d+$/.test(s)) return null;
  if (s.length <= 2) return Number(s) * 60; // 1–2 digits = minutes
  const sec = Number(s.slice(-2));
  const min = Number(s.slice(0, -2));
  if (sec >= 60) return null;
  return min * 60 + sec;
}

const DISCIPLINES: { key: Discipline; label: string }[] = [
  { key: "swim", label: "Swim" },
  { key: "bike", label: "Bike" },
  { key: "run", label: "Run" },
  { key: "strength", label: "Strength" },
];

const EFFORTS: { label: string; rpe: number; zone: Zone }[] = [
  { label: "Easy", rpe: 2, zone: 1 },
  { label: "Steady", rpe: 4, zone: 2 },
  { label: "Moderate", rpe: 6, zone: 3 },
  { label: "Hard", rpe: 8, zone: 4 },
  { label: "Max", rpe: 10, zone: 5 },
];

const FEELS: { key: Feel; icon: IconName; label: string }[] = [
  { key: "great", icon: "smile", label: "Great" },
  { key: "ok", icon: "neutral", label: "OK" },
  { key: "rough", icon: "frown", label: "Rough" },
];

const OUTCOME_ICON: Record<LogResult["outcome"], IconName> = {
  ticked: "check",
  adjusted: "check",
  swapped: "check",
  bonus: "flame",
};

export function LogWorkoutSheet({ plan, today, onClose }: { plan: Plan; today: string; onClose: () => void }) {
  const { actions, openCoach, unit } = useUI();

  const [discipline, setDiscipline] = useState<Discipline>("run");
  const [dateISO, setDateISO] = useState(today);
  const [timeStr, setTimeStr] = useState("");
  const [distStr, setDistStr] = useState("");
  const [rpe, setRpe] = useState<number | undefined>(undefined);
  const [feel, setFeel] = useState<Feel | undefined>(undefined);
  const [result, setResult] = useState<Omit<LogResult, "plan"> | null>(null);

  const isSwim = discipline === "swim";
  const distUnit = isSwim ? "m" : unit === "imperial" ? "mi" : "km";
  const toMeters = (v: number) => (isSwim ? v : unit === "imperial" ? v * M_PER_MILE : v * 1000);

  const durationSec = parseClock(timeStr);
  const canSave = !!durationSec && durationSec > 0;

  const minDate = plan.startDateISO < today ? plan.startDateISO : addDays(today, -30);

  const submit = () => {
    if (!canSave) return;
    const distNum = parseFloat(distStr);
    const distanceM = distStr.trim() && !isNaN(distNum) && distNum > 0 ? Math.round(toMeters(distNum)) : undefined;
    const res = actions.logWorkout({ dateISO, discipline, durationSec: durationSec!, distanceM, rpe, feel });
    haptic("success");
    setResult(res);
  };

  const tellCoach = () => {
    if (result) openCoach(result.coachPrefill);
    onClose();
  };

  // ---- result view ----
  if (result) {
    return (
      <Sheet
        onClose={onClose}
        label="Workout logged"
        footer={
          <div className="border-t border-line px-5 py-4">
            {result.outcome === "ticked" ? (
              <>
                <button onClick={onClose} className="btn btn-primary w-full py-3.5 text-base">Done</button>
                <button onClick={tellCoach} className="mt-1.5 w-full py-2 text-center text-sm text-muted transition hover:text-foreground">
                  Tell your coach anyway
                </button>
              </>
            ) : (
              <>
                <button onClick={tellCoach} className="btn btn-primary w-full py-3.5 text-base">Tell your coach</button>
                <button onClick={onClose} className="mt-1.5 w-full py-2 text-center text-sm text-muted transition hover:text-foreground">
                  Done
                </button>
              </>
            )}
          </div>
        }
      >
        <div className="px-5 pb-6 pt-3 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/40 text-accent" style={{ background: "color-mix(in oklab, var(--accent) 12%, transparent)" }}>
            <Icon name={OUTCOME_ICON[result.outcome]} size={30} />
          </div>
          <div className="mt-3 font-display text-xl font-semibold">{result.headline}</div>
          <p className="mx-auto mt-1.5 max-w-[19rem] text-sm text-muted">{result.detail}</p>
        </div>
      </Sheet>
    );
  }

  // ---- form view ----
  return (
    <Sheet
      onClose={onClose}
      label="Log a workout"
      header={
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <div className="eyebrow text-[0.7rem]">Log a workout</div>
            <div className="font-display text-lg font-semibold">What did you do?</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted transition hover:text-foreground">✕</button>
        </div>
      }
      footer={
        <div className="border-t border-line px-5 py-4">
          <button onClick={submit} disabled={!canSave} className="btn btn-primary w-full py-3.5 text-base">
            Log it{canSave ? "" : " — add a time"}
          </button>
          <p className="mt-2 text-center text-xs text-muted">We&apos;ll match it to your plan and tick it off — or tell your coach if it differs.</p>
        </div>
      }
    >
      <div className="space-y-5 px-5 py-5">
        {/* discipline */}
        <div>
          <div className="mb-2 eyebrow text-[0.7rem]">Sport</div>
          <div className="grid grid-cols-4 gap-2">
            {DISCIPLINES.map((d) => {
              const on = discipline === d.key;
              return (
                <button
                  key={d.key}
                  onClick={() => { haptic("select"); setDiscipline(d.key); }}
                  className={`flex flex-col items-center gap-1 rounded-2xl border py-3 transition active:scale-[0.96] ${on ? "ring-1" : "border-line bg-surface-2"}`}
                  style={on ? { borderColor: `var(--${d.key})`, background: `color-mix(in oklab, var(--${d.key}) 12%, transparent)`, boxShadow: `0 0 0 1px var(--${d.key})` } : undefined}
                >
                  <span style={{ color: `var(--${d.key})` }}><DisciplineIcon discipline={d.key} size={22} /></span>
                  <span className="text-[0.7rem] font-semibold">{d.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* when */}
        <div>
          <div className="mb-2 eyebrow text-[0.7rem]">When</div>
          <div className="mb-2 flex gap-2">
            <button onClick={() => setDateISO(today)} className={`chip ${dateISO === today ? "is-selected" : ""}`}>Today</button>
            <button onClick={() => setDateISO(addDays(today, -1))} className={`chip ${dateISO === addDays(today, -1) ? "is-selected" : ""}`}>Yesterday</button>
          </div>
          <input className="input" type="date" min={minDate} max={today} value={dateISO} onChange={(e) => setDateISO(e.target.value || today)} />
          <p className="mt-1.5 text-xs text-muted">{fmtFullDate(dateISO)}</p>
        </div>

        {/* time + distance */}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow text-[0.7rem]">Time</span>
            <input className="input" inputMode="numeric" placeholder="e.g. 45:00" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow text-[0.7rem]">Distance ({distUnit}) · optional</span>
            <input className="input" inputMode="decimal" placeholder="—" value={distStr} onChange={(e) => setDistStr(e.target.value)} />
          </label>
        </div>

        {/* effort */}
        <div>
          <div className="mb-2 eyebrow text-[0.7rem]">How hard was it? · optional</div>
          <div className="grid grid-cols-5 gap-1.5">
            {EFFORTS.map((e) => {
              const on = rpe === e.rpe;
              return (
                <button
                  key={e.rpe}
                  onClick={() => { haptic("select"); setRpe(on ? undefined : e.rpe); }}
                  className={`rounded-xl border py-2.5 text-center transition active:scale-[0.94] ${on ? "ring-1" : "border-line bg-surface-2"}`}
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
        <div>
          <div className="mb-2 eyebrow text-[0.7rem]">How did it feel? · optional</div>
          <div className="grid grid-cols-3 gap-2">
            {FEELS.map((f) => {
              const on = feel === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => { haptic("select"); setFeel(on ? undefined : f.key); }}
                  className={`flex flex-col items-center gap-1 rounded-2xl border py-3 transition active:scale-[0.96] ${on ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface-2"}`}
                >
                  <span className={on ? "text-accent" : "text-muted"}><Icon name={f.icon} size={24} /></span>
                  <span className="text-xs font-semibold">{f.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
