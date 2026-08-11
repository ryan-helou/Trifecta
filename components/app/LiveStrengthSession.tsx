"use client";

// ---------------------------------------------------------------------------
// "Start workout" — the gym session as it happens.
//
// Ryan: "it has the list of all the sets and exercises I need to do for this
// day, and I could modify and edit it, and then I could submit when I say
// finish workout."
//
// DESIGNED FOR A PHONE ON A BENCH, not a desk. Everything follows from that:
//
//  • ONE TAP PER SET. The routine already said 4 × 8 at 60 kg. Standing there,
//    the athlete is confirming, not describing — so the whole set row is the
//    tick target (a 44pt-plus hit area, not a 20pt checkbox), the numbers come
//    pre-filled, and editing is a deliberate second gesture on the number
//    itself. Doc 07 §4.8 "glance first, detail on tap", applied to input.
//  • THE NEXT SET IS ALWAYS OBVIOUS. Completed sets recede; the first unticked
//    set of the first unfinished exercise is the one thing highlighted. Coming
//    back to the screen after ninety seconds of rest, the question is always
//    "where was I", and it should never need answering twice.
//  • IT SURVIVES THE LOCK SCREEN. Every mutation writes through to
//    lib/liveStore. See that file's header for why this isn't on the plan.
//  • LEAVING IS NOT LOSING. Closing the sheet keeps the session open — the draft
//    is still in storage and the card says "In progress". Only Finish (commit)
//    or Discard (explicit, confirmed) ends it.
//
// Progress is shown as sets, not exercises or percent: sets are the unit the
// athlete counts in, and "9 / 16" answers "how much longer" without arithmetic.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from "react";
import { Sheet } from "./Sheet";
import type { StrengthEntry, Unit, Workout } from "@/lib/types";
import {
  type LiveSession,
  addExercise,
  addSet,
  finishSession,
  patchSet,
  removeExercise,
  removeSet,
  sessionAsEntries,
  sessionProgress,
  setDone,
} from "@/lib/liveSession";
import { saveLive, clearLive } from "@/lib/liveStore";
import { compareLifts, congratulate, exerciseHistory, setBeatsLast, setCount, topSet, volumeLoad } from "@/lib/strength";
import { searchExercises } from "@/lib/exerciseCatalog";
import { haptic } from "@/lib/haptics";

const LB_PER_KG = 2.20462;
const kgToDisplay = (kg: number | undefined, unit: Unit): string => {
  if (kg == null || kg <= 0) return "";
  return String(Math.round((unit === "imperial" ? kg * LB_PER_KG : kg) * 10) / 10);
};
const displayToKg = (s: string, unit: Unit): number | undefined => {
  const n = parseFloat(s);
  if (!s.trim() || isNaN(n) || n <= 0) return undefined;
  return Math.round((unit === "imperial" ? n / LB_PER_KG : n) * 100) / 100;
};

export function LiveStrengthSession({
  session,
  history,
  unit,
  onChange,
  onFinish,
  onDiscard,
  onSaveRoutine,
  routineName,
  onClose,
}: {
  session: LiveSession;
  /** Every workout, for "what did I lift last time" on a newly added exercise. */
  history: Workout[];
  unit: Unit;
  /** Called on every mutation so the parent's copy stays in step with storage. */
  onChange: (s: LiveSession) => void;
  onFinish: (entries: StrengthEntry[]) => void;
  onDiscard: () => void;
  /** Absent for an unplanned gym session, which has no slot to attach to. */
  onSaveRoutine?: (entries: StrengthEntry[]) => void;
  routineName?: string | null;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** Which set is open for editing. Null = everything is a tick target. */
  const [editing, setEditing] = useState<{ ei: number; si: number } | null>(null);
  const wLabel = unit === "imperial" ? "lb" : "kg";

  // One writer: mutate → persist → tell the parent. Nothing else touches storage,
  // so the draft on disk can't drift from the draft on screen.
  const apply = useCallback(
    (next: LiveSession) => {
      saveLive(next);
      onChange(next);
    },
    [onChange],
  );

  const { done, total, complete } = sessionProgress(session);

  // The next set to do — the one thing on screen that gets emphasis. Not memoized:
  // it's a walk over a handful of sets, and an early return inside useMemo is the
  // one shape the React Compiler refuses to optimize (it bails on the whole
  // component, which costs far more than this loop).
  let nextUp: { ei: number; si: number } | null = null;
  for (let ei = 0; ei < session.exercises.length && !nextUp; ei++) {
    const si = session.exercises[ei].sets.findIndex((x) => !x.done);
    if (si >= 0) nextUp = { ei, si };
  }

  const past = useMemo(() => exerciseHistory(history.filter((w) => w.id !== session.workoutId)), [history, session.workoutId]);
  const alreadyIn = new Set(session.exercises.map((e) => e.name.trim().toLowerCase()));
  const typed = searchExercises(adding, session.slot ?? undefined).filter((n) => !alreadyIn.has(n.toLowerCase()));
  const suggestions = past.filter((p) => !alreadyIn.has(p.name.toLowerCase())).slice(0, 6);

  const add = (name: string) => {
    const clean = name.trim();
    if (!clean || alreadyIn.has(clean.toLowerCase())) return;
    haptic("select");
    // A lift they already do arrives with last session's numbers, same bargain
    // as StrengthLog's "Add again" — confirm, don't retype.
    const prior = past.find((p) => p.name.toLowerCase() === clean.toLowerCase());
    apply(
      addExercise(
        session,
        clean,
        prior?.lastSets.length
          ? prior.lastSets.map((s) => ({ reps: s.reps, ...(s.weightKg != null ? { weightKg: s.weightKg } : {}) , done: false }))
          : undefined,
      ),
    );
    setAdding("");
  };

  const toggle = (ei: number, si: number) => {
    const was = session.exercises[ei].sets[si].done;
    haptic(was ? "light" : "success");
    apply(setDone(session, ei, si, !was));
  };

  const logged = finishSession(session);
  const { sets: loggedSets } = setCount(logged);
  const kg = volumeLoad(logged);
  // How today is going against last time, live. `congratulate` returns null when
  // there is nothing true to celebrate — a badge that fires on a lighter day
  // teaches the athlete to ignore the badge.
  const praise = congratulate(compareLifts(logged, past));

  return (
    <Sheet
      onClose={onClose}
      label={`${session.name} — in progress`}
      header={
        <div className="border-b border-line px-5 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="eyebrow text-[0.7rem]">In progress</div>
              <div className="truncate font-display text-lg font-semibold">{session.name}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-display text-lg font-semibold tabular-nums">
                {done}<span className="text-muted">/{total}</span>
              </div>
              <div className="text-[0.68rem] text-muted">sets</div>
            </div>
          </div>
          {/* Proportional, no axis — doc 07 §4.8 #4. */}
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
            />
          </div>
        </div>
      }
      footer={
        /* Pinned, because it was measured at y=1238 in an 812px viewport: ending
           your session meant scrolling past every exercise to find the button.
           Discard is deliberately the smaller, quieter half — it's the
           destructive one, and it already asks before doing anything. */
        <div className="flex gap-2 border-t border-line px-5 py-3">
          <button
            onClick={() => setConfirmDiscard(true)}
            className="rounded-2xl border border-line px-4 py-3 text-sm font-semibold text-muted transition active:scale-[0.99]"
          >
            Discard
          </button>
          <button
            onClick={() => { haptic("success"); clearLive(session.workoutId); onFinish(logged); }}
            disabled={loggedSets === 0}
            className="flex-1 rounded-2xl bg-foreground py-3 text-sm font-semibold text-background transition active:scale-[0.99] disabled:opacity-40"
          >
            {loggedSets === 0 ? "Tick a set to finish" : complete ? "Finish workout" : `Finish · ${loggedSets} set${loggedSets === 1 ? "" : "s"}`}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        {session.exercises.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
            Nothing on the card yet. Add your first exercise below — it&apos;ll be here next time too if you
            save it as your routine.
          </p>
        )}

        {session.exercises.map((e, ei) => {
          const prior = past.find((p) => p.name.toLowerCase() === e.name.trim().toLowerCase());
          const eDone = e.sets.length > 0 && e.sets.every((s) => s.done);
          return (
            <div
              key={`${e.name}-${ei}`}
              className={`rounded-2xl border bg-surface-2 p-3.5 transition ${eDone ? "border-line/60 opacity-60" : "border-line"}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {eDone && <span className="text-success">✓ </span>}
                    {e.name}
                  </div>
                  {/* The comparison, on screen while you lift. "First time" is
                      its own state — never dressed up as a win. */}
                  <div className="text-[0.68rem] tabular-nums text-muted">
                    {prior?.lastSets.length ? (
                      <>
                        Last time {prior.lastSets.length} × {topSet(prior.lastSets)?.reps ?? 0}
                        {topSet(prior.lastSets)?.weightKg
                          ? ` @ ${kgToDisplay(topSet(prior.lastSets)!.weightKg, unit)} ${wLabel}`
                          : ""}
                        {prior.bestWeightKg != null && ` · best ${kgToDisplay(prior.bestWeightKg, unit)} ${wLabel}`}
                      </>
                    ) : (
                      "First time — this becomes the mark to beat"
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { haptic("light"); apply(removeExercise(session, ei)); }}
                  aria-label={`Remove ${e.name}`}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm leading-none text-muted transition active:scale-90 hover:text-danger"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-1.5">
                {e.sets.map((s, si) => {
                  const isNext = nextUp?.ei === ei && nextUp?.si === si;
                  const isEditing = editing?.ei === ei && editing?.si === si;
                  const beat = setBeatsLast(s, prior?.lastSets);

                  if (isEditing) {
                    // Detail on demand: the numbers become fields only when asked.
                    return (
                      <div key={si} className="flex items-center gap-1.5 rounded-xl border border-accent/50 bg-surface p-1.5">
                        <span className="w-4 shrink-0 pl-1 text-[0.68rem] tabular-nums text-muted">{si + 1}</span>
                        <input
                          autoFocus
                          className="input min-w-0 flex-1 py-2 text-center tabular-nums"
                          inputMode="numeric"
                          aria-label={`${e.name} set ${si + 1} reps`}
                          placeholder="reps"
                          defaultValue={s.reps > 0 ? String(s.reps) : ""}
                          onChange={(ev) => apply(patchSet(session, ei, si, { reps: parseInt(ev.target.value, 10) || 0 }))}
                        />
                        <span className="shrink-0 text-xs text-muted">×</span>
                        <input
                          className="input min-w-0 flex-1 py-2 text-center tabular-nums"
                          inputMode="decimal"
                          aria-label={`${e.name} set ${si + 1} weight in ${wLabel}`}
                          placeholder={wLabel}
                          defaultValue={kgToDisplay(s.weightKg, unit)}
                          onChange={(ev) => apply(patchSet(session, ei, si, { weightKg: displayToKg(ev.target.value, unit) }))}
                        />
                        <button
                          onClick={() => setEditing(null)}
                          className="shrink-0 rounded-lg px-2.5 py-2 text-xs font-semibold text-accent-soft transition active:scale-90"
                        >
                          Done
                        </button>
                        <button
                          onClick={() => { setEditing(null); apply(removeSet(session, ei, si)); }}
                          aria-label={`Remove set ${si + 1}`}
                          className="shrink-0 rounded-lg px-2 py-2 text-sm leading-none text-muted transition active:scale-90 hover:text-danger"
                        >
                          −
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div key={si} className="flex items-stretch gap-1.5">
                      {/* The tick target IS the row. */}
                      <button
                        onClick={() => toggle(ei, si)}
                        aria-pressed={s.done}
                        aria-label={`Set ${si + 1}, ${s.reps} reps${s.weightKg ? ` at ${kgToDisplay(s.weightKg, unit)} ${wLabel}` : ""}${s.done ? ", done" : ""}`}
                        className={`flex flex-1 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99] ${
                          s.done
                            ? "border-success/40 bg-success/10"
                            : isNext
                              ? "border-accent bg-surface"
                              : "border-line bg-surface"
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[0.7rem] leading-none ${
                            s.done ? "border-success bg-success text-on-accent" : "border-line text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <span className={`text-sm tabular-nums ${s.done ? "text-muted line-through" : "font-semibold"}`}>
                          {s.reps > 0 ? s.reps : "—"} reps
                          {s.weightKg != null && s.weightKg > 0 && (
                            <span className="font-normal text-muted"> × {kgToDisplay(s.weightKg, unit)} {wLabel}</span>
                          )}
                        </span>
                        {/* Congratulation at the moment it's earned, not in a
                            report afterwards. Only shown once the set is ticked —
                            typing a number you haven't lifted isn't a PB. */}
                        {s.done && beat && (
                          <span className="ml-auto rounded-full bg-success/20 px-2 py-0.5 text-[0.62rem] font-semibold text-success">
                            {beat === "weight" ? "↑ Heavier" : "↑ More reps"}
                          </span>
                        )}
                        {isNext && !s.done && <span className="ml-auto text-[0.68rem] font-semibold text-accent-soft">Next</span>}
                      </button>
                      <button
                        onClick={() => setEditing({ ei, si })}
                        aria-label={`Edit set ${si + 1} of ${e.name}`}
                        className="shrink-0 rounded-xl border border-line px-3 text-xs font-semibold text-muted transition active:scale-95"
                      >
                        Edit
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => { haptic("select"); apply(addSet(session, ei)); }}
                className="mt-1.5 w-full rounded-lg border border-dashed border-line py-2 text-[0.72rem] font-semibold text-muted transition active:scale-[0.98]"
              >
                ＋ Set
              </button>
            </div>
          );
        })}

        {/* Add something that isn't on the card — the session you actually did
            beats the session you planned. */}
        <div>
          {/* One tap to bring back a lift you already do, with last session's
              numbers — the same bargain StrengthLog strikes. Typing a name you've
              typed twenty times is the most avoidable work on this screen. */}
          {suggestions.length > 0 && (
            <div className="mb-2.5">
              <div className="mb-1.5 text-[0.68rem] text-muted">Add again</div>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => add(p.name)}
                    className="rounded-full border border-line bg-surface-2 px-2.5 py-1.5 text-[0.72rem] font-semibold transition active:scale-95"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-1.5">
            <input
              className="input min-w-0 flex-1 py-2.5"
              placeholder="Add an exercise"
              aria-label="Add an exercise"
              value={adding}
              onChange={(ev) => setAdding(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") { ev.preventDefault(); add(typed[0] ?? adding); }
              }}
            />
            <button onClick={() => add(adding)} disabled={!adding.trim()} className="btn btn-ghost shrink-0 px-3.5 py-2.5 text-sm disabled:opacity-40">
              Add
            </button>
          </div>
          {typed.length > 0 && (
            <div className="mt-1.5 overflow-hidden rounded-xl border border-line bg-surface">
              {typed.slice(0, 5).map((name, i) => (
                <button
                  key={name}
                  onClick={() => add(name)}
                  className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition active:bg-surface-2 ${i ? "border-t border-line" : ""}`}
                >
                  <span>{name}</span>
                  <span className="text-xs text-accent-soft">Add</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* What Finish will actually record. Stated plainly, because only ticked
            sets count and the athlete should never discover that at commit time. */}
        <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm">
          {loggedSets === 0 ? (
            <span className="text-muted">Nothing ticked off yet — tap a set when you finish it.</span>
          ) : (
            <div>
              <span className="tabular-nums">
                <span className="font-semibold">{loggedSets} set{loggedSets === 1 ? "" : "s"}</span>
                {kg > 0 && <span className="text-muted"> · {Math.round(unit === "imperial" ? kg * LB_PER_KG : kg).toLocaleString()} {wLabel} moved</span>}
                {!complete && <span className="text-muted"> · {total - done} left</span>}
              </span>
              {praise && (
                <div className="mt-1.5 flex items-start gap-1.5 text-[0.78rem] font-semibold leading-snug text-success">
                  <span aria-hidden>↑</span>
                  <span>{praise}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {onSaveRoutine && sessionAsEntries(session).length > 0 && (
          <button
            onClick={() => { haptic("success"); onSaveRoutine(sessionAsEntries(session)); }}
            className="w-full rounded-xl border border-dashed border-accent/45 py-2.5 text-[0.75rem] font-semibold text-accent-soft transition active:scale-[0.98]"
          >
            {routineName ? `Update ${routineName} to match this` : "Save this as my routine for this day"}
          </button>
        )}

        {/* Destructive and unrecoverable, so it asks — the one confirmation on
            this screen, and it names what is being thrown away. */}
        {confirmDiscard && (
          <div className="rounded-2xl border border-danger/40 bg-surface-2 p-4">
            <div className="text-sm font-semibold">Throw away this session?</div>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {loggedSets > 0
                ? `${loggedSets} set${loggedSets === 1 ? "" : "s"} you've ticked off will be lost. This can't be undone.`
                : "Nothing has been ticked off, so nothing will be lost."}
            </p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setConfirmDiscard(false)} className="flex-1 rounded-xl border border-line py-2.5 text-sm font-semibold">
                Keep it
              </button>
              <button
                onClick={() => { haptic("light"); clearLive(session.workoutId); onDiscard(); }}
                className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-semibold text-on-accent"
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
