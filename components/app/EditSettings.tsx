"use client";

import { useState } from "react";
import { Discipline, Level, Profile, RaceType } from "@/lib/types";
import { generatePlan } from "@/lib/planEngine";
import { rebuildFromToday } from "@/lib/adapt";
import { prLabel, RUN_PR_OPTIONS, SWIM_PR_OPTIONS } from "@/lib/paces";
import { fmtClock } from "@/lib/format";
import { addDays, fmtFullDate, todayISO } from "@/lib/dates";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";

function parseTime(str: string): number | null {
  const s = str.trim();
  if (!s) return null;
  const parts = s.split(":").map((x) => Number(x));
  if (parts.some((x) => isNaN(x))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] * 60;
  return null;
}

const RACES: { key: RaceType; name: string }[] = [
  { key: "olympic", name: "Olympic" },
  { key: "half", name: "70.3" },
  { key: "full", name: "Ironman" },
  { key: "custom", name: "Custom" },
];
const LEVELS: Level[] = ["beginner", "intermediate", "advanced", "elite"];
const FOCI: { key: Discipline; label: string; icon: string }[] = [
  { key: "swim", label: "Swim", icon: "🏊" },
  { key: "bike", label: "Bike", icon: "🚴" },
  { key: "run", label: "Run", icon: "🏃" },
];
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function EditSettings({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const { plan, startPlan } = useApp();
  const { today } = useUI();

  const [raceType, setRaceType] = useState<RaceType>(profile.raceType);
  const [custom, setCustom] = useState(profile.custom ?? { swimM: 1500, bikeM: 40000, runM: 10000, name: "My Race" });
  const [raceDateISO, setRaceDateISO] = useState(profile.raceDateISO);
  const [level, setLevel] = useState<Level>(profile.level);
  const [workoutsPerWeek, setWPW] = useState(profile.workoutsPerWeek);
  const [restDay, setRestDay] = useState<number | undefined>(profile.restDayPreference);
  const [ftp, setFtp] = useState(profile.ftp);
  const [maxHR, setMaxHR] = useState(profile.maxHR);
  const [hoursCap, setHoursCap] = useState(profile.weeklyHoursCap);
  const [focus, setFocus] = useState<Discipline | undefined>(profile.focusDiscipline);

  // PR inputs (as strings) + the derived PR objects
  const [runDistKm, setRunDistKm] = useState(profile.runPR ? String(profile.runPR.distanceM / 1000) : "");
  const [runTime, setRunTime] = useState(profile.runPR ? fmtClock(profile.runPR.timeSec) : "");
  const [swimDistM, setSwimDistM] = useState(profile.swimPR ? String(profile.swimPR.distanceM) : "");
  const [swimTime, setSwimTime] = useState(profile.swimPR ? fmtClock(profile.swimPR.timeSec) : "");

  const runPR = (() => {
    const m = Math.round(parseFloat(runDistKm) * 1000);
    const sec = parseTime(runTime);
    return m > 0 && sec ? { distanceM: m, timeSec: sec, label: prLabel("run", m) } : undefined;
  })();
  const swimPR = (() => {
    const m = Math.round(parseFloat(swimDistM));
    const sec = parseTime(swimTime);
    return m > 0 && sec ? { distanceM: m, timeSec: sec, label: prLabel("swim", m) } : undefined;
  })();

  const wpwClamped = Math.max(1, Math.min(21, Math.round(workoutsPerWeek)));
  const dateOk = raceDateISO > todayISO();
  const canSave = dateOk && (raceType !== "custom" || (custom.swimM > 0 && custom.bikeM > 0 && custom.runM > 0));

  function save() {
    if (!canSave) return;
    const next: Profile = {
      ...profile,
      raceType,
      custom: raceType === "custom" ? custom : undefined,
      raceDateISO,
      level,
      workoutsPerWeek: wpwClamped,
      restDayPreference: restDay,
      runPR,
      swimPR,
      ftp,
      maxHR,
      weeklyHoursCap: hoursCap,
      focusDiscipline: focus,
    };
    const rebuilt = plan
      ? rebuildFromToday({ ...plan, profile: next }, today)
      : generatePlan(next);
    startPlan(next, { ...rebuilt, notice: "Plan updated to your new settings — completed sessions were kept." });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="animate-pop relative flex max-h-[94vh] flex-col rounded-t-3xl border-t border-line bg-background safe-b"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <div className="font-mono text-[0.6rem] font-bold uppercase tracking-[0.22em] text-muted">Edit settings</div>
            <div className="font-display text-lg font-bold">Your race &amp; training</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted transition hover:text-foreground">✕</button>
        </div>

        <div className="no-scrollbar flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* race */}
          <Field label="Race">
            <div className="grid grid-cols-4 gap-2">
              {RACES.map((r) => (
                <Pill key={r.key} on={raceType === r.key} onClick={() => setRaceType(r.key)}>{r.name}</Pill>
              ))}
            </div>
            {raceType === "custom" && (
              <div className="mt-3 space-y-2.5">
                <input className="input" value={custom.name} placeholder="Race name" onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
                <div className="grid grid-cols-3 gap-2">
                  <NumIn label="Swim m" value={custom.swimM} onChange={(n) => setCustom({ ...custom, swimM: n ?? 0 })} />
                  <NumIn label="Bike m" value={custom.bikeM} onChange={(n) => setCustom({ ...custom, bikeM: n ?? 0 })} />
                  <NumIn label="Run m" value={custom.runM} onChange={(n) => setCustom({ ...custom, runM: n ?? 0 })} />
                </div>
              </div>
            )}
          </Field>

          {/* date */}
          <Field label="Race day">
            <input className="input" type="date" min={addDays(todayISO(), 1)} value={raceDateISO} onChange={(e) => setRaceDateISO(e.target.value)} />
            {raceDateISO && (
              <p className={`mt-2 text-xs ${dateOk ? "text-muted" : "text-warning"}`}>
                {dateOk ? fmtFullDate(raceDateISO) : "Pick a date in the future."}
              </p>
            )}
          </Field>

          {/* level */}
          <Field label="Experience">
            <div className="grid grid-cols-2 gap-2">
              {LEVELS.map((l) => (
                <Pill key={l} on={level === l} onClick={() => setLevel(l)}><span className="capitalize">{l}</span></Pill>
              ))}
            </div>
          </Field>

          {/* workouts per week */}
          <Field label="Workouts / week">
            <div className="rounded-2xl border border-line bg-surface-2 p-4">
              <div className="flex items-center justify-between gap-4">
                <button onClick={() => setWPW(Math.max(1, wpwClamped - 1))} disabled={wpwClamped <= 1} aria-label="Fewer" className="grid h-11 w-11 place-items-center rounded-full border border-line text-2xl font-bold disabled:opacity-30">−</button>
                <div className="text-center">
                  <div className="font-display text-4xl font-bold tabular-nums">{wpwClamped}</div>
                  <div className="mt-0.5 font-mono text-[0.6rem] uppercase tracking-wide text-muted">{wpwClamped <= 7 ? "per week" : wpwClamped <= 14 ? "some doubles" : "up to 3 a day"}</div>
                </div>
                <button onClick={() => setWPW(Math.min(21, wpwClamped + 1))} disabled={wpwClamped >= 21} aria-label="More" className="grid h-11 w-11 place-items-center rounded-full border border-line text-2xl font-bold disabled:opacity-30">+</button>
              </div>
              <input type="range" min={1} max={21} value={wpwClamped} onChange={(e) => setWPW(Number(e.target.value))} className="mt-4 w-full" style={{ accentColor: "var(--color-accent)" }} aria-label="Workouts per week" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="mr-1 self-center font-mono text-[0.6rem] uppercase tracking-wide text-muted">Rest day</span>
              {WD.map((w, i) => (
                <button key={w} onClick={() => setRestDay(restDay === i ? undefined : i)} className={`chip ${restDay === i ? "border-accent bg-accent/10 text-foreground" : ""}`}>{w}</button>
              ))}
            </div>
          </Field>

          {/* PRs */}
          <Field label="Personal records">
            <div className="space-y-3">
              <div className="rounded-2xl border border-line bg-surface-2 p-3.5">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold"><span>🏃 Run PR</span></div>
                <div className="mb-2 flex flex-wrap gap-2">
                  {RUN_PR_OPTIONS.map((o) => (
                    <button key={o.label} onClick={() => setRunDistKm(String(o.distanceM / 1000))} className={`chip ${Math.round(parseFloat(runDistKm) * 1000) === o.distanceM ? "border-accent bg-accent/10" : ""}`}>{o.label}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5"><input className="input" inputMode="decimal" placeholder="Distance" value={runDistKm} onChange={(e) => setRunDistKm(e.target.value)} /><span className="text-xs text-muted">km</span></div>
                  <input className="input" placeholder="Time 22:30" value={runTime} onChange={(e) => setRunTime(e.target.value)} />
                </div>
              </div>
              <div className="rounded-2xl border border-line bg-surface-2 p-3.5">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold"><span>🏊 Swim PR</span></div>
                <div className="mb-2 flex flex-wrap gap-2">
                  {SWIM_PR_OPTIONS.map((o) => (
                    <button key={o.label} onClick={() => setSwimDistM(String(o.distanceM))} className={`chip ${Math.round(parseFloat(swimDistM)) === o.distanceM ? "border-accent bg-accent/10" : ""}`}>{o.label}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5"><input className="input" inputMode="numeric" placeholder="Distance" value={swimDistM} onChange={(e) => setSwimDistM(e.target.value)} /><span className="text-xs text-muted">m</span></div>
                  <input className="input" placeholder="Time 6:30" value={swimTime} onChange={(e) => setSwimTime(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumIn label="🚴 Bike FTP (W)" value={ftp} onChange={setFtp} />
                <NumIn label="❤️ Max HR (bpm)" value={maxHR} onChange={setMaxHR} />
              </div>
            </div>
          </Field>

          {/* extras */}
          <Field label="Extras">
            <div className="mb-3">
              <div className="mb-2 font-mono text-[0.6rem] uppercase tracking-wide text-muted">Limiter (bias the plan)</div>
              <div className="flex gap-2">
                {FOCI.map((f) => (
                  <button key={f.key} onClick={() => setFocus(focus === f.key ? undefined : f.key)} className={`flex-1 rounded-2xl border py-2.5 text-center transition ${focus === f.key ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface-2"}`}>
                    <div className="text-xl">{f.icon}</div>
                    <div className="mt-0.5 text-xs font-semibold">{f.label}</div>
                  </button>
                ))}
              </div>
            </div>
            <NumIn label="Cap weekly hours (optional)" value={hoursCap} onChange={setHoursCap} />
          </Field>
        </div>

        {/* footer */}
        <div className="border-t border-line px-5 py-4 safe-b">
          <p className="mb-2.5 text-center text-xs text-muted">Saving updates your plan from today. Completed sessions are kept.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-ghost px-5 py-3">Cancel</button>
            <button onClick={save} disabled={!canSave} className="btn btn-primary flex-1 py-3 text-base">Save &amp; rebuild plan</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[0.62rem] font-bold uppercase tracking-[0.2em] text-muted">{label}</div>
      {children}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full py-2.5 text-center font-display text-sm font-semibold transition ${
        on ? "accent-gradient text-[#1a0d06]" : "border border-line bg-surface-2 text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function NumIn({ label, value, onChange }: { label: string; value?: number; onChange: (n: number | undefined) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[0.58rem] font-bold uppercase tracking-wide text-muted">{label}</span>
      <input
        className="input"
        type="number"
        inputMode="numeric"
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      />
    </label>
  );
}
