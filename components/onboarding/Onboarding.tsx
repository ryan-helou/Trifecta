"use client";

import { useMemo, useState } from "react";
import { useApp } from "../AppProvider";
import { LoadingAnimation } from "../LoadingAnimation";
import { DateRange, Discipline, Injury, Level, Profile, RaceType, StrengthSplit } from "@/lib/types";
import { generatePlan } from "@/lib/planEngine";
import { RaceCatalogPicker } from "@/components/RaceCatalogPicker";
import { CatalogRace } from "@/lib/raceCatalog";
import { planSummaryContext } from "@/lib/adapt";
import { apiIntake, apiPlanSummary, ParsedInjury } from "@/lib/api";
import { RUN_PR_OPTIONS, SWIM_PR_OPTIONS, BIKE_PR_OPTIONS, prLabel } from "@/lib/paces";
import { fmtClock } from "@/lib/format";
import { todayISO, addDays, fmtFullDate } from "@/lib/dates";

interface Draft {
  raceType?: RaceType;
  custom: { swimM: number; bikeM: number; runM: number; name: string };
  // set when a real event was picked from the catalog (see RaceStep)
  raceName?: string;
  raceLocation?: string;
  raceId?: string;
  raceDateISO?: string;
  level?: Level;
  perSport: { swim: number; bike: number; run: number };
  // when true, AmaTri picks the per-sport mix from level + race distance
  autoFrequency?: boolean;
  focusDiscipline?: Discipline;
  strength: { enabled: boolean; daysPerWeek: number; split: StrengthSplit; customSplit?: string };
  restDayPreference?: number;
  weeklyHoursCap?: number;
  equipment: { pool: boolean; trainer: boolean; gym: boolean };
  blackouts: DateRange[];
  runPR?: { distanceM: number; timeSec: number; label: string };
  swimPR?: { distanceM: number; timeSec: number; label: string };
  bikePR?: { distanceM: number; timeSec: number; label: string };
  ftp?: number;
  maxHR?: number;
  injuries: Injury[];
  intakeNotes?: string;
}

const STEPS = ["race", "custom", "date", "level", "frequency", "strength", "schedule", "prs", "injuries", "review"] as const;

// When the athlete lets us decide, derive a sensible weekly sport mix from their
// experience and race distance — more experience means more sessions, and longer
// races lean harder on the bike (and the run for a full).
function suggestFrequency(level?: Level, raceType?: RaceType): Draft["perSport"] {
  const byLevel: Record<Level, Draft["perSport"]> = {
    beginner: { swim: 2, bike: 2, run: 2 },
    intermediate: { swim: 2, bike: 3, run: 3 },
    advanced: { swim: 3, bike: 4, run: 3 },
    elite: { swim: 3, bike: 4, run: 4 },
  };
  const f = { ...byLevel[level ?? "beginner"] };
  if (raceType === "half" || raceType === "full") f.bike += 1;
  if (raceType === "full") f.run += 1;
  return f;
}

// The per-sport counts actually used: the athlete's own, or our suggestion in auto mode.
function resolvePerSport(d: Draft): Draft["perSport"] {
  return d.autoFrequency ? suggestFrequency(d.level, d.raceType) : d.perSport;
}

function parseTime(str: string): number | null {
  const s = str.trim();
  if (!s) return null;
  const parts = s.split(":").map((x) => Number(x));
  if (parts.some((x) => isNaN(x))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] * 60; // bare minutes
  return null;
}

function newInjuries(parsed: ParsedInjury[]): Injury[] {
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

export function Onboarding() {
  const { username, startPlan, applyPlan } = useApp();
  const [idx, setIdx] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    custom: { swimM: 1500, bikeM: 40000, runM: 10000, name: "My Race" },
    perSport: { swim: 2, bike: 2, run: 2 },
    strength: { enabled: false, daysPerWeek: 2, split: "full" },
    equipment: { pool: true, trainer: true, gym: true },
    blackouts: [],
    injuries: [],
  });

  const step = STEPS[idx];
  const isCustom = draft.raceType === "custom";
  const perSport = resolvePerSport(draft);

  const totalSessions =
    perSport.swim + perSport.bike + perSport.run + (draft.strength.enabled ? draft.strength.daysPerWeek : 0);

  const finalProfile: Profile | null = useMemo(() => {
    if (!username || !draft.raceType || !draft.raceDateISO || !draft.level) return null;
    const ps = resolvePerSport(draft);
    const strengthDays = draft.strength.enabled ? draft.strength.daysPerWeek : 0;
    const wpw = Math.max(1, Math.min(21, ps.swim + ps.bike + ps.run + strengthDays));
    return {
      username,
      raceType: draft.raceType,
      custom: draft.raceType === "custom" ? draft.custom : undefined,
      raceName: draft.raceType === "custom" ? undefined : draft.raceName,
      raceLocation: draft.raceType === "custom" ? undefined : draft.raceLocation,
      raceId: draft.raceType === "custom" ? undefined : draft.raceId,
      raceDateISO: draft.raceDateISO,
      level: draft.level,
      workoutsPerWeek: wpw,
      perSport: { ...ps },
      strength: draft.strength,
      restDayPreference: draft.restDayPreference,
      runPR: draft.runPR,
      swimPR: draft.swimPR,
      bikePR: draft.bikePR,
      ftp: draft.ftp,
      maxHR: draft.maxHR,
      weeklyHoursCap: draft.weeklyHoursCap,
      focusDiscipline: draft.focusDiscipline,
      equipment: draft.equipment,
      blackouts: draft.blackouts.filter((b) => b.startISO && b.endISO && b.startISO <= b.endISO),
      injuries: draft.injuries.length ? draft.injuries : undefined,
      intakeNotes: draft.intakeNotes?.trim() || undefined,
      createdAtISO: new Date().toISOString(),
    };
  }, [username, draft]);

  function skip(dir: 1 | -1, from: number): number {
    let n = from + dir;
    while (STEPS[n] === "custom" && !isCustom) n += dir;
    return Math.max(0, Math.min(STEPS.length - 1, n));
  }
  const next = () => setIdx((i) => skip(1, i));
  const back = () => setIdx((i) => skip(-1, i));

  const canNext = (() => {
    switch (step) {
      case "race":
        return !!draft.raceType;
      case "custom":
        return draft.custom.swimM > 0 && draft.custom.bikeM > 0 && draft.custom.runM > 0;
      case "date":
        return !!draft.raceDateISO && draft.raceDateISO > todayISO();
      case "level":
        return !!draft.level;
      case "frequency":
        return totalSessions >= 1;
      default:
        return true;
    }
  })();

  const visibleCount = STEPS.length - (isCustom ? 0 : 1);
  const visibleIdx = idx - (idx > 1 && !isCustom ? 1 : 0);

  if (generating && finalProfile) {
    return (
      <LoadingAnimation
        profile={finalProfile}
        onDone={() => {
          const plan = generatePlan(finalProfile);
          startPlan(finalProfile, plan);
          // fire-and-forget: attach cheap AI "why this plan" + per-phase notes if enabled
          apiPlanSummary(planSummaryContext(plan))
            .then((r) => {
              if (r.enabled && (r.text || (r.phases && Object.keys(r.phases).length))) {
                applyPlan({ ...plan, coachSummary: r.text || plan.coachSummary, phaseNotes: r.phases });
              }
            })
            .catch(() => {});
        }}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col safe-t">
      {/* progress bar */}
      <div className="px-6 pt-6">
        <div className="mx-auto flex max-w-md gap-1.5">
          {Array.from({ length: visibleCount }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition ${i <= visibleIdx ? "accent-gradient" : "bg-surface-2"}`}
            />
          ))}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 py-6">
        <div key={step} className="animate-fade-up flex flex-1 flex-col">
          {step === "race" && <RaceStep draft={draft} set={setDraft} />}
          {step === "custom" && <CustomStep draft={draft} set={setDraft} />}
          {step === "date" && <DateStep draft={draft} set={setDraft} />}
          {step === "level" && <LevelStep draft={draft} set={setDraft} />}
          {step === "frequency" && <FrequencyStep draft={draft} set={setDraft} total={totalSessions} />}
          {step === "strength" && <StrengthStep draft={draft} set={setDraft} />}
          {step === "schedule" && <ScheduleStep draft={draft} set={setDraft} />}
          {step === "prs" && <PRStep draft={draft} set={setDraft} parseTime={parseTime} />}
          {step === "injuries" && <InjuriesStep draft={draft} set={setDraft} />}
          {step === "review" && <ReviewStep draft={draft} total={totalSessions} />}
        </div>

        <div className="mt-6 flex items-center gap-3">
          {idx > 0 && (
            <button onClick={back} className="btn btn-ghost px-5 py-3">
              Back
            </button>
          )}
          {step === "review" ? (
            <button onClick={() => setGenerating(true)} disabled={!finalProfile} className="btn btn-primary flex-1 py-3.5 text-base">
              Build my plan
            </button>
          ) : (
            <button onClick={next} disabled={!canNext} className="btn btn-primary flex-1 py-3.5 text-base">
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- shared UI ----------------

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="font-display text-2xl font-bold leading-tight tracking-tight">{title}</h2>
      {sub && <p className="mt-1.5 text-sm text-muted">{sub}</p>}
    </div>
  );
}

function Card({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        active ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface-2 hover:bg-surface-3"
      }`}
    >
      {children}
    </button>
  );
}

function Stepper({
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
    <div className="flex items-center justify-between rounded-2xl border border-line bg-surface-2 px-4 py-3">
      <div className="flex items-center gap-2.5">
        {icon && <span className="text-xl">{icon}</span>}
        <span className="font-display font-semibold">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => set(value - 1)}
          disabled={value <= min}
          aria-label={`Fewer ${label}`}
          className="grid h-9 w-9 place-items-center rounded-full border border-line text-xl font-bold transition disabled:opacity-30"
        >
          −
        </button>
        <span className="w-6 text-center font-display text-xl font-bold tabular-nums">{value}</span>
        <button
          onClick={() => set(value + 1)}
          disabled={value >= max}
          aria-label={`More ${label}`}
          className="grid h-9 w-9 place-items-center rounded-full border border-line text-xl font-bold transition disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}

type StepProps = { draft: Draft; set: React.Dispatch<React.SetStateAction<Draft>> };

// ---------------- steps ----------------

function RaceStep({ draft, set }: StepProps) {
  const [mode, setMode] = useState<"distance" | "event">(draft.raceId ? "event" : "distance");
  const races: { key: RaceType; name: string; d: string }[] = [
    { key: "olympic", name: "Olympic", d: "1.5 km swim · 40 km bike · 10 km run" },
    { key: "half", name: "Ironman 70.3", d: "1.9 km swim · 90 km bike · 21.1 km run" },
    { key: "full", name: "Full Ironman", d: "3.8 km swim · 180 km bike · 42.2 km run" },
    { key: "custom", name: "Custom distance", d: "Set your own swim / bike / run" },
  ];

  // pick a bare distance → drop any real-event identity
  const pickDistance = (key: RaceType) =>
    set((d) => ({ ...d, raceType: key, raceId: undefined, raceName: undefined, raceLocation: undefined }));

  // pick a real event → set its category + pre-fill the date
  const pickEvent = (r: CatalogRace) =>
    set((d) => ({
      ...d,
      raceType: r.distance,
      raceDateISO: r.dateISO,
      raceId: r.id,
      raceName: r.name,
      raceLocation: r.location,
    }));

  return (
    <div>
      <Head title="What are you training for?" sub="Pick your race — this shapes the whole plan." />
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(["distance", "event"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full py-2.5 text-center font-display text-sm font-semibold transition ${
              mode === m ? "accent-gradient text-[#1a0d06]" : "border border-line bg-surface-2 text-muted"
            }`}
          >
            {m === "distance" ? "By distance" : "Real race"}
          </button>
        ))}
      </div>

      {mode === "distance" ? (
        <div className="flex flex-col gap-2.5">
          {races.map((r) => (
            <Card key={r.key} active={draft.raceType === r.key && !draft.raceId} onClick={() => pickDistance(r.key)}>
              <div className="font-display text-lg font-semibold">{r.name}</div>
              <div className="text-sm text-muted">{r.d}</div>
            </Card>
          ))}
        </div>
      ) : (
        <RaceCatalogPicker selectedId={draft.raceId} onPick={pickEvent} />
      )}
    </div>
  );
}

function NumField({ label, value, unit, onChange }: { label: string; value: number; unit: string; onChange: (n: number) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input className="input" type="number" inputMode="decimal" value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="text-sm text-muted">{unit}</span>
      </div>
    </label>
  );
}

function CustomStep({ draft, set }: StepProps) {
  const c = draft.custom;
  const upd = (patch: Partial<Draft["custom"]>) => set((d) => ({ ...d, custom: { ...d.custom, ...patch } }));
  return (
    <div>
      <Head title="Your custom race" sub="Enter the distances — we'll structure the training around them." />
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Race name</span>
          <input className="input" value={c.name} onChange={(e) => upd({ name: e.target.value })} />
        </label>
        <NumField label="Swim" unit="m" value={c.swimM} onChange={(n) => upd({ swimM: n })} />
        <NumField label="Bike" unit="m" value={c.bikeM} onChange={(n) => upd({ bikeM: n })} />
        <NumField label="Run" unit="m" value={c.runM} onChange={(n) => upd({ runM: n })} />
      </div>
    </div>
  );
}

function DateStep({ draft, set }: StepProps) {
  const min = addDays(todayISO(), 14);
  return (
    <div>
      <Head title="When's race day?" sub="Your plan counts back from here — with the right taper built in." />
      <input
        className="input text-lg"
        type="date"
        min={addDays(todayISO(), 1)}
        value={draft.raceDateISO ?? ""}
        onChange={(e) => set((d) => ({ ...d, raceDateISO: e.target.value }))}
      />
      {draft.raceName && (
        <p className="mt-3 text-sm text-muted">
          Pre-filled from <span className="font-semibold text-foreground">{draft.raceName}</span> — confirm it against the
          official race page, then adjust if needed.
        </p>
      )}
      {draft.raceDateISO && (
        <p className="mt-3 text-sm text-muted">
          Racing on <span className="font-semibold text-foreground">{fmtFullDate(draft.raceDateISO)}</span>.
        </p>
      )}
      {draft.raceDateISO && draft.raceDateISO < min && (
        <p className="mt-2 text-sm text-warning">That’s a tight timeline — we’ll compress the plan and keep you safe.</p>
      )}
    </div>
  );
}

function LevelStep({ draft, set }: StepProps) {
  const levels: { key: Level; name: string; d: string }[] = [
    { key: "beginner", name: "Beginner", d: "New to triathlon or building your first base." },
    { key: "intermediate", name: "Intermediate", d: "A season or two in; comfortable in all three sports." },
    { key: "advanced", name: "Advanced", d: "Consistent training, targeting a strong result." },
    { key: "elite", name: "Elite", d: "High training load, chasing the podium." },
  ];
  return (
    <div>
      <Head title="How experienced are you?" sub="This sets your volume, intensity, and how fast we ramp." />
      <div className="flex flex-col gap-2.5">
        {levels.map((l) => (
          <Card key={l.key} active={draft.level === l.key} onClick={() => set((d) => ({ ...d, level: l.key }))}>
            <div className="font-display text-lg font-semibold">{l.name}</div>
            <div className="text-sm text-muted">{l.d}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FrequencyStep({ draft, set, total }: StepProps & { total: number }) {
  const auto = !!draft.autoFrequency;
  const ps = resolvePerSport(draft);
  const setSport = (k: keyof Draft["perSport"], v: number) => set((d) => ({ ...d, perSport: { ...d.perSport, [k]: v } }));
  const foci: { key: Discipline; label: string; icon: string }[] = [
    { key: "swim", label: "Swim", icon: "🏊" },
    { key: "bike", label: "Bike", icon: "🚴" },
    { key: "run", label: "Run", icon: "🏃" },
  ];
  const autoSports: { key: keyof Draft["perSport"]; label: string; icon: string }[] = [
    { key: "swim", label: "Swim", icon: "🏊" },
    { key: "bike", label: "Bike", icon: "🚴" },
    { key: "run", label: "Run", icon: "🏃" },
  ];
  return (
    <div>
      <Head title="How often for each sport?" sub="Set your swim, bike, and run sessions a week — or let us pick the mix for you." />

      <div className="mb-4 grid grid-cols-2 gap-2">
        {([
          [true, "Let AmaTri decide"],
          [false, "I'll choose"],
        ] as const).map(([val, label]) => (
          <button
            key={label}
            onClick={() => set((d) => ({ ...d, autoFrequency: val }))}
            className={`rounded-full py-2.5 text-center font-display text-sm font-semibold transition ${
              auto === val ? "accent-gradient text-[#1a0d06]" : "border border-line bg-surface-2 text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {auto ? (
        <div className="rounded-2xl border border-line bg-surface-2 p-4 animate-fade-up">
          <p className="mb-3 text-sm text-muted">
            We&apos;ll set your weekly mix from your experience and race — here&apos;s what we&apos;d run. Switch to <span className="font-semibold text-foreground">I&apos;ll choose</span> to set it yourself.
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            {autoSports.map((s) => (
              <div key={s.key} className="rounded-2xl border border-line bg-surface-3 py-3 text-center">
                <div className="text-2xl">{s.icon}</div>
                <div className="mt-1 font-display text-xl font-bold tabular-nums">{ps[s.key]}</div>
                <div className="text-xs text-muted">{s.label}/wk</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <Stepper label="Swim" icon="🏊" value={ps.swim} onChange={(n) => setSport("swim", n)} />
          <Stepper label="Bike" icon="🚴" value={ps.bike} onChange={(n) => setSport("bike", n)} />
          <Stepper label="Run" icon="🏃" value={ps.run} onChange={(n) => setSport("run", n)} />
        </div>
      )}
      <p className="mt-3 text-center text-sm text-muted">
        {total} session{total === 1 ? "" : "s"} a week{total > 7 ? " — we'll stack some as doubles" : ""}
        {draft.strength.enabled ? " (incl. strength)" : ""}
      </p>
      <div className="mt-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Which sport is your weakness? (optional)</div>
        <div className="flex gap-2">
          {foci.map((f) => (
            <button
              key={f.key}
              onClick={() => set((d) => ({ ...d, focusDiscipline: d.focusDiscipline === f.key ? undefined : f.key }))}
              className={`flex-1 rounded-2xl border py-3 text-center transition ${
                draft.focusDiscipline === f.key ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface-2"
              }`}
            >
              <div className="text-2xl">{f.icon}</div>
              <div className="mt-1 text-sm font-semibold">{f.label}</div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">We’ll give your weakest sport a little more of the weekly time.</p>
      </div>
    </div>
  );
}

const SPLITS: { key: StrengthSplit; name: string; d: string }[] = [
  { key: "full", name: "Full body", d: "One session hits everything — simple and effective." },
  { key: "upper-lower", name: "Upper / Lower", d: "Alternate upper-body and leg days." },
  { key: "push-pull-legs", name: "Push / Pull / Legs", d: "Classic 3-way split for higher volume." },
  { key: "core", name: "Core & mobility", d: "Trunk stability and injury-proofing, low fatigue." },
  { key: "custom", name: "My own split", d: "Follow your own routine — write it down and we'll schedule it." },
];

function StrengthStep({ draft, set }: StepProps) {
  const s = draft.strength;
  const upd = (patch: Partial<Draft["strength"]>) => set((d) => ({ ...d, strength: { ...d.strength, ...patch } }));
  return (
    <div>
      <Head title="Add resistance training?" sub="Strength work keeps you durable and powerful — optional, but it pays off." />
      <div className="grid grid-cols-2 gap-2.5">
        <button
          onClick={() => upd({ enabled: true })}
          className={`rounded-2xl border py-4 font-display font-semibold transition ${
            s.enabled ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface-2"
          }`}
        >
          Yes, include it
        </button>
        <button
          onClick={() => upd({ enabled: false })}
          className={`rounded-2xl border py-4 font-display font-semibold transition ${
            !s.enabled ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface-2"
          }`}
        >
          Not right now
        </button>
      </div>

      {s.enabled && (
        <div className="mt-6 space-y-5 animate-fade-up">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Days a week</div>
            <Stepper label="Strength days" icon="🏋️" value={s.daysPerWeek} min={1} max={4} onChange={(n) => upd({ daysPerWeek: n })} />
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Which split?</div>
            <div className="flex flex-col gap-2.5">
              {SPLITS.map((sp) => (
                <Card key={sp.key} active={s.split === sp.key} onClick={() => upd({ split: sp.key })}>
                  <div className="font-display font-semibold">{sp.name}</div>
                  <div className="text-sm text-muted">{sp.d}</div>
                </Card>
              ))}
            </div>
            {s.split === "custom" && (
              <div className="mt-3 animate-fade-up">
                <textarea
                  className="input min-h-[90px] resize-none"
                  placeholder="Write your own split — e.g. Mon: Push · Wed: Pull · Fri: Legs. We'll reserve the time and keep it clear of your hardest sessions."
                  value={s.customSplit ?? ""}
                  onChange={(e) => upd({ customSplit: e.target.value })}
                />
                <p className="mt-2 text-xs text-muted">We schedule your session as its own block — you bring the exercises.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleStep({ draft, set }: StepProps) {
  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const eq = draft.equipment;
  const toggleEq = (k: keyof Draft["equipment"]) => set((d) => ({ ...d, equipment: { ...d.equipment, [k]: !d.equipment[k] } }));
  const addBlackout = () => {
    const start = addDays(todayISO(), 30);
    set((d) => ({ ...d, blackouts: [...d.blackouts, { startISO: start, endISO: addDays(start, 6), label: "Time off" }] }));
  };
  const updBlackout = (i: number, patch: Partial<DateRange>) =>
    set((d) => ({ ...d, blackouts: d.blackouts.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const rmBlackout = (i: number) => set((d) => ({ ...d, blackouts: d.blackouts.filter((_, j) => j !== i) }));

  const equip: { key: keyof Draft["equipment"]; label: string; icon: string }[] = [
    { key: "pool", label: "Pool", icon: "🏊" },
    { key: "trainer", label: "Indoor trainer", icon: "🚴" },
    { key: "gym", label: "Gym", icon: "🏋️" },
  ];

  return (
    <div>
      <Head title="Your schedule & life" sub="All optional — tell us how your week and calendar really look." />

      <div className="mb-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Preferred rest day</div>
        <div className="flex flex-wrap gap-2">
          {WD.map((w, i) => (
            <button
              key={w}
              onClick={() => set((d) => ({ ...d, restDayPreference: d.restDayPreference === i ? undefined : i }))}
              className={`chip ${draft.restDayPreference === i ? "border-accent bg-accent/10 text-foreground" : ""}`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">What can you access?</div>
        <div className="flex gap-2">
          {equip.map((e) => (
            <button
              key={e.key}
              onClick={() => toggleEq(e.key)}
              className={`flex-1 rounded-2xl border py-3 text-center transition ${
                eq[e.key] ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface-2"
              }`}
            >
              <div className="text-xl">{e.icon}</div>
              <div className="mt-1 text-xs font-semibold">{e.label}</div>
            </button>
          ))}
        </div>
      </div>

      <NumFieldOpt
        label="Cap my weekly hours at (optional)"
        unit="hrs"
        value={draft.weeklyHoursCap}
        onChange={(n) => set((d) => ({ ...d, weeklyHoursCap: n }))}
      />

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Time off (vacation, travel)</span>
          <button onClick={addBlackout} className="chip">+ Add</button>
        </div>
        {draft.blackouts.length === 0 && <p className="text-sm text-muted">No blocked-out dates — add any weeks you know you’ll miss.</p>}
        <div className="space-y-2.5">
          {draft.blackouts.map((b, i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface-2 p-3">
              <div className="mb-2 flex items-center gap-2">
                <input
                  className="input flex-1"
                  placeholder="Label (e.g. Holiday)"
                  value={b.label ?? ""}
                  onChange={(e) => updBlackout(i, { label: e.target.value })}
                />
                <button onClick={() => rmBlackout(i)} aria-label="Remove" className="text-muted transition hover:text-danger">
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className="input" type="date" value={b.startISO} onChange={(e) => updBlackout(i, { startISO: e.target.value })} />
                <input className="input" type="date" value={b.endISO} onChange={(e) => updBlackout(i, { endISO: e.target.value })} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PRStep({ draft, set, parseTime }: StepProps & { parseTime: (s: string) => number | null }) {
  const [runDistKm, setRunDistKm] = useState(draft.runPR ? String(draft.runPR.distanceM / 1000) : "");
  const [runTime, setRunTime] = useState(draft.runPR ? fmtClock(draft.runPR.timeSec) : "");
  const [swimDistM, setSwimDistM] = useState(draft.swimPR ? String(draft.swimPR.distanceM) : "");
  const [swimTime, setSwimTime] = useState(draft.swimPR ? fmtClock(draft.swimPR.timeSec) : "");
  const [bikeDistKm, setBikeDistKm] = useState(draft.bikePR ? String(draft.bikePR.distanceM / 1000) : "");
  const [bikeTime, setBikeTime] = useState(draft.bikePR ? fmtClock(draft.bikePR.timeSec) : "");

  function commitRun(distKmStr: string, timeStr: string) {
    const distM = Math.round(parseFloat(distKmStr) * 1000);
    const sec = parseTime(timeStr);
    set((d) => ({ ...d, runPR: distM > 0 && sec ? { distanceM: distM, timeSec: sec, label: prLabel("run", distM) } : undefined }));
  }
  function commitSwim(distMStr: string, timeStr: string) {
    const distM = Math.round(parseFloat(distMStr));
    const sec = parseTime(timeStr);
    set((d) => ({ ...d, swimPR: distM > 0 && sec ? { distanceM: distM, timeSec: sec, label: prLabel("swim", distM) } : undefined }));
  }
  function commitBike(distKmStr: string, timeStr: string) {
    const distM = Math.round(parseFloat(distKmStr) * 1000);
    const sec = parseTime(timeStr);
    set((d) => ({ ...d, bikePR: distM > 0 && sec ? { distanceM: distM, timeSec: sec, label: prLabel("bike", distM) } : undefined }));
  }

  const runMatchesM = Math.round(parseFloat(runDistKm) * 1000);
  const swimMatchesM = Math.round(parseFloat(swimDistM));
  const bikeMatchesM = Math.round(parseFloat(bikeDistKm) * 1000);

  return (
    <div>
      <Head title="Your personal bests" sub="Optional, but the sharper your pace targets. Tap a preset or type any distance. Skip any you don't know." />

      <div className="mb-5 rounded-2xl border border-line bg-surface-2 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">🏃 Run PR</div>
        <div className="flex flex-wrap gap-2">
          {RUN_PR_OPTIONS.map((o) => (
            <button
              key={o.label}
              onClick={() => { const km = String(o.distanceM / 1000); setRunDistKm(km); commitRun(km, runTime); }}
              className={`chip ${runMatchesM === o.distanceM ? "border-accent bg-accent/10" : ""}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="flex items-center gap-1.5">
            <input
              className="input"
              inputMode="decimal"
              placeholder="Distance"
              value={runDistKm}
              onChange={(e) => { setRunDistKm(e.target.value); commitRun(e.target.value, runTime); }}
            />
            <span className="text-xs text-muted">km</span>
          </div>
          <input
            className="input"
            placeholder="Time, e.g. 22:30"
            value={runTime}
            onChange={(e) => { setRunTime(e.target.value); commitRun(runDistKm, e.target.value); }}
          />
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-line bg-surface-2 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">🏊 Swim PR</div>
        <div className="flex flex-wrap gap-2">
          {SWIM_PR_OPTIONS.map((o) => (
            <button
              key={o.label}
              onClick={() => { const m = String(o.distanceM); setSwimDistM(m); commitSwim(m, swimTime); }}
              className={`chip ${swimMatchesM === o.distanceM ? "border-accent bg-accent/10" : ""}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="flex items-center gap-1.5">
            <input
              className="input"
              inputMode="numeric"
              placeholder="Distance"
              value={swimDistM}
              onChange={(e) => { setSwimDistM(e.target.value); commitSwim(e.target.value, swimTime); }}
            />
            <span className="text-xs text-muted">m</span>
          </div>
          <input
            className="input"
            placeholder="Time, e.g. 6:30"
            value={swimTime}
            onChange={(e) => { setSwimTime(e.target.value); commitSwim(swimDistM, e.target.value); }}
          />
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-line bg-surface-2 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">🚴 Bike PR</div>
        <div className="flex flex-wrap gap-2">
          {BIKE_PR_OPTIONS.map((o) => (
            <button
              key={o.label}
              onClick={() => { const km = String(o.distanceM / 1000); setBikeDistKm(km); commitBike(km, bikeTime); }}
              className={`chip ${bikeMatchesM === o.distanceM ? "border-accent bg-accent/10" : ""}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="flex items-center gap-1.5">
            <input
              className="input"
              inputMode="decimal"
              placeholder="Distance"
              value={bikeDistKm}
              onChange={(e) => { setBikeDistKm(e.target.value); commitBike(e.target.value, bikeTime); }}
            />
            <span className="text-xs text-muted">km</span>
          </div>
          <input
            className="input"
            placeholder="Time, e.g. 1:05:00"
            value={bikeTime}
            onChange={(e) => { setBikeTime(e.target.value); commitBike(bikeDistKm, e.target.value); }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumFieldOpt label="🚴 Bike FTP" unit="W" value={draft.ftp} onChange={(n) => set((d) => ({ ...d, ftp: n }))} />
        <NumFieldOpt label="❤️ Max HR" unit="bpm" value={draft.maxHR} onChange={(n) => set((d) => ({ ...d, maxHR: n }))} />
      </div>
      <p className="mt-2 text-xs text-muted">Your FTP still powers bike pacing — the PR is a benchmark we track your fitness against.</p>
    </div>
  );
}

function NumFieldOpt({ label, value, unit, onChange }: { label: string; value?: number; unit: string; onChange: (n: number | undefined) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          className="input"
          type="number"
          inputMode="numeric"
          value={value ?? ""}
          placeholder="—"
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
        />
        <span className="text-xs text-muted">{unit}</span>
      </div>
    </label>
  );
}

const SEV_LABEL: Record<Injury["severity"], string> = { niggle: "mild", moderate: "moderate", severe: "severe" };

function InjuriesStep({ draft, set }: StepProps) {
  const [text, setText] = useState(draft.intakeNotes ?? "");
  const [status, setStatus] = useState<"idle" | "loading" | "off" | "done">("idle");

  async function analyze() {
    const t = text.trim();
    set((d) => ({ ...d, intakeNotes: t || undefined }));
    if (!t) {
      set((d) => ({ ...d, injuries: [] }));
      setStatus("done");
      return;
    }
    setStatus("loading");
    const res = await apiIntake(t).catch(() => ({ enabled: false, injuries: [] as ParsedInjury[] }));
    if (res.enabled === false) {
      setStatus("off");
      return;
    }
    const parsed = newInjuries(res.injuries ?? []);
    set((d) => ({ ...d, injuries: parsed }));
    setStatus("done");
  }

  const removeInjury = (id: string) => set((d) => ({ ...d, injuries: d.injuries.filter((i) => i.id !== id) }));

  return (
    <div>
      <Head
        title="Any injuries or aches?"
        sub="Type it like you'd text a coach — knees, shoulders, a dodgy back, whatever. We'll build the plan around it."
      />
      <textarea
        className="input min-h-[110px] resize-none"
        placeholder="e.g. My left knee gets sore on long runs, and my right shoulder aches after hard swim sets."
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          set((d) => ({ ...d, intakeNotes: e.target.value.trim() || undefined }));
          if (status !== "idle") setStatus("idle");
        }}
      />
      <div className="mt-3 flex items-center gap-3">
        <button onClick={analyze} disabled={status === "loading"} className="btn btn-primary px-5 py-2.5 text-sm">
          {status === "loading" ? "Reading…" : draft.injuries.length ? "Re-analyze" : "Analyze with AI"}
        </button>
        {status === "off" && <span className="text-xs text-muted">AI is off — your notes are still saved and used.</span>}
        {status === "done" && !draft.injuries.length && text.trim() && (
          <span className="text-xs text-muted">Nothing to work around — noted.</span>
        )}
      </div>

      {draft.injuries.length > 0 && (
        <div className="mt-5 animate-fade-up">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">We’ll train around</div>
          <div className="flex flex-col gap-2">
            {draft.injuries.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-2xl border border-line bg-surface-2 px-4 py-3">
                <div>
                  <div className="font-display font-semibold capitalize">{i.area}</div>
                  <div className="text-xs text-muted">
                    {SEV_LABEL[i.severity]} · affects {i.disciplines.join(", ")}
                  </div>
                </div>
                <button onClick={() => removeInjury(i.id)} aria-label="Remove" className="text-muted transition hover:text-danger">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Affected sports get gentler intensity and less volume — severe issues get cross-trained around.
          </p>
        </div>
      )}

      <p className="mt-5 text-xs text-muted">
        Nothing bothering you? Just leave it blank and continue. AmaTri isn’t a medical service — see a professional for real pain.
      </p>
    </div>
  );
}

function ReviewStep({ draft, total }: { draft: Draft; total: number }) {
  const race =
    draft.raceName ??
    (draft.raceType === "custom"
      ? draft.custom.name
      : draft.raceType === "olympic"
      ? "Olympic"
      : draft.raceType === "half"
      ? "Ironman 70.3"
      : "Full Ironman");
  const ps = resolvePerSport(draft);
  const rows: [string, string][] = [
    ["Race", race],
    ["Date", draft.raceDateISO ? fmtFullDate(draft.raceDateISO) : "—"],
    ["Level", draft.level ?? "—"],
    [
      "Weekly sessions",
      `${total} · 🏊 ${ps.swim} · 🚴 ${ps.bike} · 🏃 ${ps.run}${draft.autoFrequency ? " · auto" : ""}`,
    ],
  ];
  if (draft.raceLocation) rows.push(["Location", draft.raceLocation]);
  if (draft.strength.enabled) {
    const splitLabel =
      draft.strength.split === "custom"
        ? draft.strength.customSplit?.trim() || "Custom"
        : draft.strength.split.replace("-", " / ");
    rows.push(["Strength", `${draft.strength.daysPerWeek}×/wk · ${splitLabel}`]);
  }
  if (draft.focusDiscipline) rows.push(["Focus", draft.focusDiscipline]);
  if (draft.runPR) rows.push(["Run PR", draft.runPR.label]);
  if (draft.swimPR) rows.push(["Swim PR", draft.swimPR.label]);
  if (draft.bikePR) rows.push(["Bike PR", draft.bikePR.label]);
  if (draft.ftp) rows.push(["FTP", `${draft.ftp} W`]);
  if (draft.injuries.length) rows.push(["Working around", draft.injuries.map((i) => i.area).join(", ")]);
  if (draft.blackouts.length) rows.push(["Time off", `${draft.blackouts.length} block${draft.blackouts.length === 1 ? "" : "s"}`]);

  return (
    <div>
      <Head title="Here's your plan setup" sub="We'll forge a full day-by-day plan from this — personalized to you." />
      <div className="rounded-2xl border border-line bg-surface-2 p-1">
        {rows.map(([k, v], i) => (
          <div key={k} className={`flex items-center justify-between gap-4 px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
            <span className="shrink-0 text-sm text-muted">{k}</span>
            <span className="text-right font-semibold capitalize">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
