"use client";

import { useState } from "react";
import { DateField } from "@/components/app/DateField";
import { Discipline, Feel, Plan, StrengthEntry, Zone } from "@/lib/types";
import type { LogResult } from "@/lib/adapt";
import { DisciplineIcon, Icon, IconName } from "./icons";
import { Sheet } from "./Sheet";
import { haptic } from "@/lib/haptics";
import { useUI } from "./ui";
import { StrengthLog } from "./StrengthLog";
import { slotLabel } from "@/lib/routines";
import { useApp } from "../AppProvider";
import { strengthUnitOf } from "@/lib/strength";
import { fmtFullDate, addDays } from "@/lib/dates";
import { parseClock } from "@/lib/format";

const M_PER_MILE = 1609.34;

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

/** A gym session with no stopwatch still has to weigh something in the load model.
 *  45 minutes is an ordinary session and the UI says so rather than assuming silently. */
const DEFAULT_STRENGTH_SEC = 45 * 60;

/** The split days and muscle groups a lifter would actually name. Split first, since
 *  that's how most people describe the day they just did. */
const TRAINED = ["Push", "Pull", "Legs", "Upper", "Lower", "Full body", "Chest", "Back", "Shoulders", "Arms", "Core"];

export function LogWorkoutSheet({ plan, today, onClose }: { plan: Plan; today: string; onClose: () => void }) {
  const { actions, openCoach, unit } = useUI();
  const { profile } = useApp();

  const [discipline, setDiscipline] = useState<Discipline>("run");
  const [dateISO, setDateISO] = useState(today);
  const [timeStr, setTimeStr] = useState("");
  const [distStr, setDistStr] = useState("");
  const [rpe, setRpe] = useState<number | undefined>(undefined);
  const [feel, setFeel] = useState<Feel | undefined>(undefined);
  const [result, setResult] = useState<Omit<LogResult, "plan"> | null>(null);

  // What was actually trained, for a gym session. Asking a lifter for distance is
  // asking the wrong question (#121) — "what muscles I hit or what day of the split"
  // is the thing they'd actually tell you, and it's the thing worth reading back later.
  const [trained, setTrained] = useState<string[]>([]);
  // ...and what it was, for everything else. The gym gets chips because "Push" is a
  // category with a fixed vocabulary; a ride is not — "hilly loop with Sam", "treadmill,
  // legs dead" is the thing worth writing down, and there was nowhere to write it.
  // It becomes the session's title, so the log reads back as what you did rather than
  // as "Logged run".
  const [note, setNote] = useState("");
  // ...and what was actually lifted (#199). Same editor as the planned-session
  // check-in, because an unplanned gym session deserves the same record.
  const [strengthLog, setStrengthLog] = useState<StrengthEntry[]>([]);
  // Which saved routine to start from. An unplanned gym session has no slot of
  // its own — the athlete says which day it was, and gets their own programme.
  const [fromRoutine, setFromRoutine] = useState<string | null>(null);
  const routines = profile?.routines ?? [];
  const picked = routines.find((r) => r.slot === fromRoutine) ?? null;

  const isStrength = discipline === "strength";
  const isSwim = discipline === "swim";
  const distUnit = isSwim ? "m" : unit === "imperial" ? "mi" : "km";
  const toMeters = (v: number) => (isSwim ? v : unit === "imperial" ? v * M_PER_MILE : v * 1000);

  const durationSec = parseClock(timeStr); // null when unparseable or zero
  // A gym session is real training whether or not anyone timed it, so strength can be
  // logged without a clock — the load model just needs SOME duration, and a stated
  // assumption is better than blocking the save behind a number nobody recorded.
  const savedSec = durationSec ?? (isStrength ? DEFAULT_STRENGTH_SEC : null);
  const canSave = savedSec != null;

  const minDate = plan.startDateISO < today ? plan.startDateISO : addDays(today, -30);

  const submit = () => {
    if (!canSave) return;
    const distNum = parseFloat(distStr);
    const distanceM = distStr.trim() && !isNaN(distNum) && distNum > 0 ? Math.round(toMeters(distNum)) : undefined;
    const res = actions.logWorkout({
      dateISO,
      discipline,
      durationSec: savedSec!,
      // distance is meaningless for a gym session, so it is never sent for one
      distanceM: isStrength ? undefined : distanceM,
      rpe,
      feel,
      // A gym session names itself with the split chips; everything else says it in
      // its own words. Same field either way, so both end up in the session title and
      // read back the same later.
      note: isStrength ? (trained.length ? trained.join(", ") : undefined) : note.trim() || undefined,
      strengthLog: isStrength && strengthLog.length ? strengthLog : undefined,
    });
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
          <DateField min={minDate} max={today} value={dateISO} placeholder="Today" onChange={(v) => setDateISO(v || today)} />
          <p className="mt-1.5 text-xs text-muted">{fmtFullDate(dateISO)}</p>
        </div>

        {/* What you trained — gym only. Chips rather than a text box: it's one tap,
            it reads back consistently, and it's the vocabulary a lifter already uses. */}
        {isStrength && (
          <div>
            <div className="mb-2 eyebrow text-[0.7rem]">What did you train? · optional</div>
            <div className="flex flex-wrap gap-1.5">
              {TRAINED.map((t) => {
                const on = trained.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => {
                      haptic("select");
                      setTrained((cur) => (on ? cur.filter((x) => x !== t) : [...cur, t]));
                    }}
                    aria-pressed={on}
                    className={`chip ${on ? "is-selected" : ""}`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* what was lifted — gym only */}
        {isStrength && (
          <div className="mb-4">
            {routines.length > 0 && (
              <div className="mb-2">
                <div className="mb-1.5 eyebrow text-[0.7rem]">Start from a routine</div>
                <div className="flex flex-wrap gap-1.5">
                  {routines.map((r) => (
                    <button
                      key={r.slot}
                      onClick={() => { haptic("select"); setFromRoutine(fromRoutine === r.slot ? null : r.slot); }}
                      className={`rounded-full border px-3 py-1.5 text-[0.72rem] font-semibold transition active:scale-95 ${
                        fromRoutine === r.slot ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface-2"
                      }`}
                    >
                      {slotLabel(r.slot)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Remounted per routine (`key`) so picking one actually reloads the
                editor — the draft is useState-initialised, and without this the
                chip would highlight while the sets underneath never changed. */}
            <StrengthLog
              key={fromRoutine ?? "blank"}
              initial={picked?.exercises}
              history={Object.values(plan.workouts)}
              slot={picked?.slot}
              unit={strengthUnitOf(profile)}
              onChange={setStrengthLog}
            />
          </div>
        )}

        {/* time + distance. Distance is dropped entirely for strength — there is no
            honest number to put in it, and asking for one is what made this sheet feel
            like it wasn't built for the gym (#121). */}
        <div className={isStrength ? "" : "grid grid-cols-2 gap-3"}>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow text-[0.7rem]">Time{isStrength ? " · optional" : ""}</span>
            {/* "45:00" was an instruction the keyboard couldn't follow — inputMode
                numeric has no colon key, so the placeholder demonstrated a format the
                athlete physically could not type (#151). parseClock already accepts
                bare digits (45 = 45 min, 4230 = 42:30); the placeholder now shows the
                form that actually works, and the hint covers the longer one. */}
            <input className="input" inputMode="numeric" placeholder="e.g. 45" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} />
            {!isStrength && !timeStr.trim() && (
              <span className="text-xs text-muted">Minutes — or 4230 for 42:30.</span>
            )}
            {isStrength && !durationSec && (
              <span className="text-xs text-muted">No time? We’ll count it as {Math.round(DEFAULT_STRENGTH_SEC / 60)} min.</span>
            )}
          </label>
          {!isStrength && (
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow text-[0.7rem]">Distance ({distUnit}) · optional</span>
              <input className="input" inputMode="decimal" placeholder="—" value={distStr} onChange={(e) => setDistStr(e.target.value)} />
            </label>
          )}
        </div>

        {/* what it was — everything except the gym, which says it with chips above */}
        {!isStrength && (
          <div>
            <div className="mb-2 eyebrow text-[0.7rem]">What was it? · optional</div>
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. hilly trail loop"
              maxLength={80}
            />
          </div>
        )}

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
