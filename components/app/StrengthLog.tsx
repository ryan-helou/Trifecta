"use client";

// ---------------------------------------------------------------------------
// The gym log editor (#199) — "the ability to log what u did so weight and reps
// and sets and all these things".
//
// DESIGNED FOR WHERE IT'S USED: standing in a gym, between sets, one hand, and
// often mid-session rather than politely at the end. Every decision here follows
// from that, and from doc 07 §4.8's "one screen, one thought":
//
//  - The fastest possible repeat. "+ Set" copies the set above it, because a
//    working set is nearly always the same as the last one. 5×5 is one tap for
//    the first set and four taps after it, not twenty field entries.
//  - History is the whole point. Picking an exercise you've done before fills in
//    what you did last time — "what did I squat last time" is the question a gym
//    log exists to answer, and answering it on entry means the common case is
//    confirm-not-type.
//  - Nothing is required. Bodyweight sets have reps and no load (doc: StrengthSet
//    .weightKg is optional); refusing to record those would make the log useless
//    to exactly the athletes who train at home.
//  - Weight is shown in the athlete's own unit and STORED in kg, so the number
//    in the plan doesn't change meaning when they switch units.
//
// Fields keep raw strings while being typed — parsing on every keystroke fights
// the person holding the phone ("6." would become "6"). Parse happens on commit.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import type { StrengthEntry, Unit, Workout } from "@/lib/types";
import { exerciseHistory, setCount, volumeLoad } from "@/lib/strength";
import { haptic } from "@/lib/haptics";

const LB_PER_KG = 2.20462;

/** One set as it exists WHILE BEING TYPED — strings, so a half-entered "6." survives. */
interface DraftSet {
  reps: string;
  weight: string;
}
interface DraftEntry {
  name: string;
  sets: DraftSet[];
}

const kgToDisplay = (kg: number | undefined, unit: Unit): string => {
  if (kg == null || kg <= 0) return "";
  const v = unit === "imperial" ? kg * LB_PER_KG : kg;
  return String(Math.round(v * 10) / 10);
};
const displayToKg = (s: string, unit: Unit): number | undefined => {
  const n = parseFloat(s);
  if (!s.trim() || isNaN(n) || n <= 0) return undefined;
  const kg = unit === "imperial" ? n / LB_PER_KG : n;
  return Math.round(kg * 100) / 100;
};

const toDraft = (entries: StrengthEntry[], unit: Unit): DraftEntry[] =>
  entries.map((e) => ({
    name: e.name,
    sets: e.sets.map((s) => ({ reps: s.reps ? String(s.reps) : "", weight: kgToDisplay(s.weightKg, unit) })),
  }));

/** Drop sets with no reps, then exercises left with nothing in them — a half-typed
 *  row the athlete abandoned shouldn't become a permanent zero in their history. */
const fromDraft = (draft: DraftEntry[], unit: Unit): StrengthEntry[] =>
  draft
    .map((e) => ({
      name: e.name.trim(),
      sets: e.sets
        .map((s) => ({ reps: parseInt(s.reps, 10) || 0, weightKg: displayToKg(s.weight, unit) }))
        .filter((s) => s.reps > 0),
    }))
    .filter((e) => e.name && e.sets.length > 0);

export function StrengthLog({
  initial,
  history,
  excludeId,
  unit,
  onChange,
}: {
  /** What's already logged for this session, if anything. */
  initial?: StrengthEntry[];
  /** Every workout, for "what did I lift last time". */
  history: Workout[];
  /** The session being edited — excluded from its own history so tonight's sets
   *  aren't offered back as last time's. Absent when logging something unplanned. */
  excludeId?: string;
  unit: Unit;
  onChange: (entries: StrengthEntry[]) => void;
}) {
  const [draft, setDraft] = useState<DraftEntry[]>(() => toDraft(initial ?? [], unit));
  const [adding, setAdding] = useState("");
  const wLabel = unit === "imperial" ? "lb" : "kg";

  // Everything they've ever logged, so a returning exercise arrives pre-filled.
  const past = useMemo(() => exerciseHistory(history.filter((w) => w.id !== excludeId)), [history, excludeId]);
  const alreadyIn = new Set(draft.map((e) => e.name.trim().toLowerCase()));
  const suggestions = past.filter((p) => !alreadyIn.has(p.name.toLowerCase())).slice(0, 6);

  // One place that writes state, so the parent can never see a stale draft.
  const commit = (next: DraftEntry[]) => {
    setDraft(next);
    onChange(fromDraft(next, unit));
  };

  const addExercise = (name: string, prefill?: DraftSet[]) => {
    const clean = name.trim();
    if (!clean) return;
    if (alreadyIn.has(clean.toLowerCase())) return;
    haptic("select");
    commit([...draft, { name: clean, sets: prefill?.length ? prefill : [{ reps: "", weight: "" }] }]);
    setAdding("");
  };

  // Adding a known exercise brings last session's sets with it — the athlete
  // confirms or edits rather than retyping what they already told us once.
  const addFromHistory = (p: (typeof past)[number]) =>
    addExercise(
      p.name,
      p.lastSets.map((s) => ({ reps: s.reps ? String(s.reps) : "", weight: kgToDisplay(s.weightKg, unit) })),
    );

  const patchSet = (ei: number, si: number, field: keyof DraftSet, value: string) => {
    const next = draft.map((e, i) =>
      i !== ei ? e : { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, [field]: value } : s)) },
    );
    commit(next);
  };

  /** The fast path: a new set inherits the one above it, because it usually is. */
  const addSet = (ei: number) => {
    haptic("select");
    const next = draft.map((e, i) => {
      if (i !== ei) return e;
      const last = e.sets[e.sets.length - 1];
      return { ...e, sets: [...e.sets, last ? { ...last } : { reps: "", weight: "" }] };
    });
    commit(next);
  };

  const removeSet = (ei: number, si: number) => {
    haptic("light");
    const next = draft
      .map((e, i) => (i !== ei ? e : { ...e, sets: e.sets.filter((_, j) => j !== si) }))
      .filter((e) => e.sets.length > 0);
    commit(next);
  };

  const removeExercise = (ei: number) => {
    haptic("light");
    commit(draft.filter((_, i) => i !== ei));
  };

  const saved = fromDraft(draft, unit);
  const { sets, reps } = setCount(saved);
  const kg = volumeLoad(saved);
  const totalLabel =
    sets === 0
      ? null
      : `${sets} set${sets === 1 ? "" : "s"} · ${kg > 0 ? `${Math.round(unit === "imperial" ? kg * LB_PER_KG : kg).toLocaleString()} ${wLabel}` : `${reps} reps`}`;

  return (
    <div className="animate-fade-up rounded-2xl border border-line bg-surface-2 p-3.5">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <div className="eyebrow text-[0.7rem]">What you lifted</div>
        {totalLabel && <div className="text-[0.7rem] tabular-nums text-muted">{totalLabel}</div>}
      </div>

      <div className="space-y-2.5">
        {draft.map((e, ei) => {
          const prior = past.find((p) => p.name.toLowerCase() === e.name.trim().toLowerCase());
          return (
            <div key={`${e.name}-${ei}`} className="rounded-xl border border-line bg-surface p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{e.name}</div>
                  {/* The comparison that makes a log worth keeping. */}
                  {prior?.bestWeightKg != null && (
                    <div className="text-[0.68rem] tabular-nums text-muted">
                      Best {kgToDisplay(prior.bestWeightKg, unit)} {wLabel}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => removeExercise(ei)}
                  aria-label={`Remove ${e.name}`}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm leading-none text-muted transition active:scale-90 hover:text-danger"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-1.5">
                {e.sets.map((s, si) => (
                  <div key={si} className="flex items-center gap-1.5">
                    <span className="w-4 shrink-0 text-[0.68rem] tabular-nums text-muted">{si + 1}</span>
                    <input
                      className="input min-w-0 flex-1 py-2 text-center tabular-nums"
                      inputMode="numeric"
                      aria-label={`${e.name} set ${si + 1} reps`}
                      placeholder="reps"
                      value={s.reps}
                      onChange={(ev) => patchSet(ei, si, "reps", ev.target.value)}
                    />
                    <span className="shrink-0 text-xs text-muted">×</span>
                    <input
                      className="input min-w-0 flex-1 py-2 text-center tabular-nums"
                      inputMode="decimal"
                      aria-label={`${e.name} set ${si + 1} weight in ${wLabel}`}
                      placeholder={wLabel}
                      value={s.weight}
                      onChange={(ev) => patchSet(ei, si, "weight", ev.target.value)}
                    />
                    <button
                      onClick={() => removeSet(ei, si)}
                      aria-label={`Remove set ${si + 1}`}
                      className="shrink-0 rounded-lg px-2 py-1 text-sm leading-none text-muted transition active:scale-90 hover:text-danger"
                    >
                      −
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={() => addSet(ei)}
                className="mt-1.5 w-full rounded-lg border border-dashed border-line py-1.5 text-[0.72rem] font-semibold text-muted transition active:scale-[0.98]"
              >
                ＋ Set
              </button>
            </div>
          );
        })}
      </div>

      {/* One tap to bring back a lift you already do, with last time's numbers. */}
      {suggestions.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1.5 text-[0.68rem] text-muted">Add again</div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((p) => (
              <button
                key={p.name}
                onClick={() => addFromHistory(p)}
                className="rounded-full border border-line bg-surface px-2.5 py-1.5 text-[0.72rem] font-semibold transition active:scale-95"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2.5 flex gap-1.5">
        <input
          className="input min-w-0 flex-1 py-2"
          placeholder="Add an exercise"
          aria-label="Add an exercise"
          value={adding}
          onChange={(ev) => setAdding(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              addExercise(adding);
            }
          }}
        />
        <button
          onClick={() => addExercise(adding)}
          disabled={!adding.trim()}
          className="btn btn-ghost shrink-0 px-3.5 py-2 text-sm disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}
