"use client";

import { useState } from "react";
import { DateRange, Discipline, Injury, Level, Profile, RaceType, StrengthPref, StrengthSplit } from "@/lib/types";
import { generatePlan } from "@/lib/planEngine";
import { rebuildFromToday } from "@/lib/adapt";
import { apiIntake, ParsedInjury } from "@/lib/api";
import { prLabel, RUN_PR_OPTIONS, SWIM_PR_OPTIONS, BIKE_PR_OPTIONS } from "@/lib/paces";
import { fmtClock } from "@/lib/format";
import { addDays, fmtFullDate, todayISO } from "@/lib/dates";
import { RaceCatalogPicker } from "@/components/RaceCatalogPicker";
import { Sheet } from "./Sheet";
import { haptic } from "@/lib/haptics";
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
const SPLITS: { key: StrengthSplit; name: string }[] = [
  { key: "full", name: "Full body" },
  { key: "upper-lower", name: "Upper / Lower" },
  { key: "push-pull-legs", name: "Push / Pull / Legs" },
  { key: "core", name: "Core & mobility" },
  { key: "custom", name: "My own split" },
];
const SEV_LABEL: Record<Injury["severity"], string> = { niggle: "mild", moderate: "moderate", severe: "severe" };
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toInjuries(parsed: ParsedInjury[]): Injury[] {
  return parsed
    .filter((p) => p.area && Array.isArray(p.disciplines))
    .map((p, i) => ({
      id: `inj-${Date.now()}-${i}-${Math.round(Math.random() * 1e6)}`,
      area: p.area.slice(0, 60),
      disciplines: p.disciplines.filter((d): d is Discipline => d === "swim" || d === "bike" || d === "run"),
      severity: (["niggle", "moderate", "severe"].includes(p.severity) ? p.severity : "moderate") as Injury["severity"],
      note: p.note,
    }))
    .filter((i) => i.disciplines.length > 0);
}

export function EditSettings({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const { plan, startPlan } = useApp();
  const { today } = useUI();

  const [raceType, setRaceType] = useState<RaceType>(profile.raceType);
  const [custom, setCustom] = useState(profile.custom ?? { swimM: 1500, bikeM: 40000, runM: 10000, name: "My Race" });
  const [raceDateISO, setRaceDateISO] = useState(profile.raceDateISO);
  // real-event identity (set when picked from the catalog)
  const [raceId, setRaceId] = useState<string | undefined>(profile.raceId);
  const [raceName, setRaceName] = useState<string | undefined>(profile.raceName);
  const [raceLocation, setRaceLocation] = useState<string | undefined>(profile.raceLocation);
  const [showCatalog, setShowCatalog] = useState(false);
  const [level, setLevel] = useState<Level>(profile.level);
  const [perSport, setPerSport] = useState(profile.perSport ?? { swim: 2, bike: 2, run: 2 });
  const [strength, setStrength] = useState<StrengthPref>(profile.strength ?? { enabled: false, daysPerWeek: 2, split: "full" });
  const [restDay, setRestDay] = useState<number | undefined>(profile.restDayPreference);
  const [ftp, setFtp] = useState(profile.ftp);
  const [maxHR, setMaxHR] = useState(profile.maxHR);
  const [hoursCap, setHoursCap] = useState(profile.weeklyHoursCap);
  const [focus, setFocus] = useState<Discipline | undefined>(profile.focusDiscipline);
  const [injuries, setInjuries] = useState<Injury[]>(profile.injuries ?? []);
  const [blackouts, setBlackouts] = useState<DateRange[]>(profile.blackouts ?? []);
  const [injuryText, setInjuryText] = useState(profile.intakeNotes ?? "");
  const [injuryStatus, setInjuryStatus] = useState<"idle" | "loading" | "off" | "done">("idle");

  // PR inputs (as strings) + the derived PR objects
  const [runDistKm, setRunDistKm] = useState(profile.runPR ? String(profile.runPR.distanceM / 1000) : "");
  const [runTime, setRunTime] = useState(profile.runPR ? fmtClock(profile.runPR.timeSec) : "");
  const [swimDistM, setSwimDistM] = useState(profile.swimPR ? String(profile.swimPR.distanceM) : "");
  const [swimTime, setSwimTime] = useState(profile.swimPR ? fmtClock(profile.swimPR.timeSec) : "");
  const [bikeDistKm, setBikeDistKm] = useState(profile.bikePR ? String(profile.bikePR.distanceM / 1000) : "");
  const [bikeTime, setBikeTime] = useState(profile.bikePR ? fmtClock(profile.bikePR.timeSec) : "");

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
  const bikePR = (() => {
    const m = Math.round(parseFloat(bikeDistKm) * 1000);
    const sec = parseTime(bikeTime);
    return m > 0 && sec ? { distanceM: m, timeSec: sec, label: prLabel("bike", m) } : undefined;
  })();

  const total = perSport.swim + perSport.bike + perSport.run + (strength.enabled ? strength.daysPerWeek : 0);
  const wpwClamped = Math.max(1, Math.min(21, total));
  const dateOk = raceDateISO > todayISO();
  const canSave = dateOk && total >= 1 && (raceType !== "custom" || (custom.swimM > 0 && custom.bikeM > 0 && custom.runM > 0));

  const setSport = (k: keyof typeof perSport, v: number) => setPerSport((p) => ({ ...p, [k]: Math.max(0, Math.min(10, v)) }));
  const addBlackout = () => {
    const start = addDays(todayISO(), 30);
    setBlackouts((b) => [...b, { startISO: start, endISO: addDays(start, 6), label: "Time off" }]);
  };
  const updBlackout = (i: number, patch: Partial<DateRange>) => setBlackouts((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function analyzeInjuries() {
    const t = injuryText.trim();
    if (!t) {
      setInjuries([]);
      setInjuryStatus("done");
      return;
    }
    setInjuryStatus("loading");
    const res = await apiIntake(t).catch(() => ({ enabled: false, injuries: [] as ParsedInjury[] }));
    if (res.enabled === false) {
      setInjuryStatus("off");
      return;
    }
    setInjuries(toInjuries(res.injuries ?? []));
    setInjuryStatus("done");
  }

  function save() {
    if (!canSave) return;
    haptic("success");
    const next: Profile = {
      ...profile,
      raceType,
      custom: raceType === "custom" ? custom : undefined,
      raceName: raceType === "custom" ? undefined : raceName,
      raceLocation: raceType === "custom" ? undefined : raceLocation,
      raceId: raceType === "custom" ? undefined : raceId,
      raceDateISO,
      level,
      workoutsPerWeek: wpwClamped,
      perSport,
      strength,
      restDayPreference: restDay,
      runPR,
      swimPR,
      bikePR,
      ftp,
      maxHR,
      weeklyHoursCap: hoursCap,
      focusDiscipline: focus,
      injuries: injuries.length ? injuries : undefined,
      blackouts: blackouts.filter((b) => b.startISO && b.endISO && b.startISO <= b.endISO),
      intakeNotes: injuryText.trim() || undefined,
    };
    const rebuilt = plan
      ? rebuildFromToday({ ...plan, profile: next }, today)
      : generatePlan(next);
    startPlan(next, { ...rebuilt, notice: "Plan updated to your new settings — completed sessions were kept." });
    onClose();
  }

  return (
    <Sheet
      onClose={onClose}
      label="Edit settings"
      panelClassName="h-[92vh]"
      header={
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <div className="eyebrow text-[0.7rem]">Edit settings</div>
            <div className="font-display text-lg font-semibold">Your race &amp; training</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted transition hover:text-foreground">✕</button>
        </div>
      }
      footer={
        <div className="border-t border-line px-5 py-4">
          <p className="mb-2.5 text-center text-xs text-muted">Saving updates your plan from today. Completed sessions are kept.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-ghost px-5 py-3">Cancel</button>
            <button onClick={save} disabled={!canSave} className="btn btn-primary flex-1 py-3 text-base">Save &amp; rebuild plan</button>
          </div>
        </div>
      }
    >
      <div className="space-y-6 px-5 py-5">
          {/* race */}
          <Field label="Race">
            <div className="grid grid-cols-4 gap-2">
              {RACES.map((r) => (
                <Pill
                  key={r.key}
                  on={raceType === r.key && !raceId}
                  onClick={() => {
                    setRaceType(r.key);
                    setRaceId(undefined);
                    setRaceName(undefined);
                    setRaceLocation(undefined);
                  }}
                >
                  {r.name}
                </Pill>
              ))}
            </div>

            {/* real-event picker (hybrid: bare distance above, real races here) */}
            {raceName ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-accent bg-accent/10 px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-display text-sm font-semibold">{raceName}</div>
                  {raceLocation && <div className="truncate text-xs text-muted">{raceLocation}</div>}
                </div>
                <button
                  onClick={() => {
                    setRaceId(undefined);
                    setRaceName(undefined);
                    setRaceLocation(undefined);
                  }}
                  aria-label="Clear race"
                  className="shrink-0 text-muted transition hover:text-danger"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button onClick={() => setShowCatalog((s) => !s)} className="chip mt-3">
                {showCatalog ? "Hide races" : "🔎 Choose a real race"}
              </button>
            )}
            {showCatalog && !raceName && (
              <div className="mt-3">
                <RaceCatalogPicker
                  selectedId={raceId}
                  onPick={(r) => {
                    setRaceType(r.distance);
                    setRaceDateISO(r.dateISO);
                    setRaceId(r.id);
                    setRaceName(r.name);
                    setRaceLocation(r.location);
                    setShowCatalog(false);
                  }}
                />
              </div>
            )}

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

          {/* per-sport frequency */}
          <Field label={`Sessions per week · ${total}`}>
            <div className="space-y-2">
              <StepRow label="Swim" icon="🏊" value={perSport.swim} onChange={(n) => setSport("swim", n)} />
              <StepRow label="Bike" icon="🚴" value={perSport.bike} onChange={(n) => setSport("bike", n)} />
              <StepRow label="Run" icon="🏃" value={perSport.run} onChange={(n) => setSport("run", n)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="eyebrow mr-1 self-center text-[0.66rem]">Rest day</span>
              {WD.map((w, i) => (
                <button key={w} onClick={() => setRestDay(restDay === i ? undefined : i)} className={`chip ${restDay === i ? "border-accent bg-accent/10 text-foreground" : ""}`}>{w}</button>
              ))}
            </div>
          </Field>

          {/* strength */}
          <Field label="Strength training">
            <div className="grid grid-cols-2 gap-2">
              <Pill on={strength.enabled} onClick={() => setStrength((s) => ({ ...s, enabled: true }))}>On</Pill>
              <Pill on={!strength.enabled} onClick={() => setStrength((s) => ({ ...s, enabled: false }))}>Off</Pill>
            </div>
            {strength.enabled && (
              <div className="mt-3 space-y-3">
                <StepRow label="Days / week" icon="🏋️" value={strength.daysPerWeek} min={1} max={4} onChange={(n) => setStrength((s) => ({ ...s, daysPerWeek: n }))} />
                <div className="grid grid-cols-2 gap-2">
                  {SPLITS.map((sp) => (
                    <Pill key={sp.key} on={strength.split === sp.key} onClick={() => setStrength((s) => ({ ...s, split: sp.key }))}>{sp.name}</Pill>
                  ))}
                </div>
                {strength.split === "custom" && (
                  <textarea
                    className="input min-h-[80px] resize-none"
                    placeholder="Write your own split — e.g. Mon: Push · Wed: Pull · Fri: Legs."
                    value={strength.customSplit ?? ""}
                    onChange={(e) => setStrength((s) => ({ ...s, customSplit: e.target.value }))}
                  />
                )}
              </div>
            )}
          </Field>

          {/* injuries */}
          <Field label="Injuries & aches">
            <textarea
              className="input min-h-[90px] resize-none"
              placeholder="Describe anything to work around — e.g. left knee on long runs."
              value={injuryText}
              onChange={(e) => { setInjuryText(e.target.value); if (injuryStatus !== "idle") setInjuryStatus("idle"); }}
            />
            <div className="mt-2 flex items-center gap-3">
              <button onClick={analyzeInjuries} disabled={injuryStatus === "loading"} className="btn btn-primary px-4 py-2 text-sm">
                {injuryStatus === "loading" ? "Reading…" : injuries.length ? "Re-analyze" : "Analyze with AI"}
              </button>
              {injuryStatus === "off" && <span className="text-xs text-muted">AI off — notes still saved.</span>}
            </div>
            {injuries.length > 0 && (
              <div className="mt-3 space-y-2">
                {injuries.map((i) => (
                  <div key={i.id} className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2">
                    <div>
                      <div className="text-sm font-semibold capitalize">{i.area}</div>
                      <div className="text-[0.7rem] text-muted">{SEV_LABEL[i.severity]} · {i.disciplines.join(", ")}</div>
                    </div>
                    <button onClick={() => setInjuries((xs) => xs.filter((x) => x.id !== i.id))} aria-label="Remove" className="text-muted transition hover:text-danger">✕</button>
                  </div>
                ))}
              </div>
            )}
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
              <div className="rounded-2xl border border-line bg-surface-2 p-3.5">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold"><span>🚴 Bike PR</span></div>
                <div className="mb-2 flex flex-wrap gap-2">
                  {BIKE_PR_OPTIONS.map((o) => (
                    <button key={o.label} onClick={() => setBikeDistKm(String(o.distanceM / 1000))} className={`chip ${Math.round(parseFloat(bikeDistKm) * 1000) === o.distanceM ? "border-accent bg-accent/10" : ""}`}>{o.label}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5"><input className="input" inputMode="decimal" placeholder="Distance" value={bikeDistKm} onChange={(e) => setBikeDistKm(e.target.value)} /><span className="text-xs text-muted">km</span></div>
                  <input className="input" placeholder="Time 1:05:00" value={bikeTime} onChange={(e) => setBikeTime(e.target.value)} />
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
              <div className="eyebrow mb-2 text-[0.66rem]">Limiter (bias the plan)</div>
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

          {/* time off */}
          <Field label="Time off">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-muted">Vacation, travel — weeks you&apos;ll miss.</span>
              <button onClick={addBlackout} className="chip">+ Add</button>
            </div>
            <div className="space-y-2.5">
              {blackouts.map((b, i) => (
                <div key={i} className="rounded-xl border border-line bg-surface-2 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <input className="input flex-1" placeholder="Label" value={b.label ?? ""} onChange={(e) => updBlackout(i, { label: e.target.value })} />
                    <button onClick={() => setBlackouts((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove" className="text-muted transition hover:text-danger">✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" type="date" value={b.startISO} onChange={(e) => updBlackout(i, { startISO: e.target.value })} />
                    <input className="input" type="date" value={b.endISO} onChange={(e) => updBlackout(i, { endISO: e.target.value })} />
                  </div>
                </div>
              ))}
            </div>
          </Field>
      </div>
    </Sheet>
  );
}

function StepRow({
  label,
  icon,
  value,
  min = 0,
  max = 10,
  onChange,
}: {
  label: string;
  icon?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
}) {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, Math.round(v))));
  return (
    <div className="flex items-center justify-between rounded-2xl border border-line bg-surface-2 px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        {icon && <span className="text-lg">{icon}</span>}
        <span className="font-display text-sm font-semibold">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => set(value - 1)} disabled={value <= min} aria-label={`Fewer ${label}`} className="grid h-8 w-8 place-items-center rounded-full border border-line text-lg font-bold disabled:opacity-30">−</button>
        <span className="w-5 text-center font-display text-lg font-bold tabular-nums">{value}</span>
        <button onClick={() => set(value + 1)} disabled={value >= max} aria-label={`More ${label}`} className="grid h-8 w-8 place-items-center rounded-full border border-line text-lg font-bold disabled:opacity-30">+</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-2 text-[0.72rem]">{label}</div>
      {children}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full py-2.5 text-center text-sm font-semibold transition ${
        on ? "bg-accent text-[#17130a]" : "border border-line bg-surface-2 text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function NumIn({ label, value, onChange }: { label: string; value?: number; onChange: (n: number | undefined) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="eyebrow text-[0.64rem]">{label}</span>
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
