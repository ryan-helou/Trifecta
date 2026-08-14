"use client";

// ---------------------------------------------------------------------------
// "Create workouts" — build your own gym day from scratch.
//
// Ryan: "there should also be a section called create workouts where you create
// your own workout for each day. So push pull legs or whatever."
//
// Until now a routine could only be BORN by logging a session and ticking "save
// as my routine". That meant you had to do the workout before you could plan it,
// and once saved there was no way to change it — ProfileTab's own help text
// admitted as much: "Edit one by changing the sets on a gym session and saving
// it again." This is the missing half.
//
// THE SLOT PICKER IS THE IMPORTANT CONTROL. A routine attaches to a DAY IN THE
// SPLIT, never to a dated session (see lib/routines.ts). Choosing "Push" is what
// makes every future Push day open ready to go. So the picker offers exactly the
// days this athlete's split contains — `slotsForProfile` derives them from the
// same inputs the plan builder uses, because offering Push to an upper/lower
// athlete would let them build a routine that never attaches to anything.
//
// The exercise/set editing is `StrengthLog` itself rather than a second editor
// that drifts from it: same "+ Set copies the one above", same history prefill,
// same kg storage. Only the heading changes, because here the session hasn't
// happened yet.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Sheet } from "./Sheet";
import { StrengthLog } from "./StrengthLog";
import type { Profile, StrengthEntry, StrengthRoutine, StrengthSlot, Unit, Workout } from "@/lib/types";
import { defaultRoutineName, routineFromEntries, slotLabel, slotsForProfile } from "@/lib/routines";
import { strengthUnitOf, summarise } from "@/lib/strength";
import { haptic } from "@/lib/haptics";

export function RoutineEditor({
  profile,
  existing,
  initialSlot,
  history,
  unit,
  nowISO,
  onSave,
  onDelete,
  onClose,
}: {
  profile: Profile;
  /** The routine being edited, or null when creating one. */
  existing: StrengthRoutine | null;
  /** Which gym day a NEW routine is for, when the caller already knows (the
   *  athlete tapped "＋ Legs"). Ignored when editing — the slot is the identity. */
  initialSlot?: StrengthSlot | null;
  history: Workout[];
  unit: Unit;
  nowISO: string;
  onSave: (r: StrengthRoutine) => void;
  onDelete?: (slot: StrengthSlot) => void;
  onClose: () => void;
}) {
  const slots = slotsForProfile(profile);
  // Editing keeps its slot (it IS the identity). Creating defaults to the first
  // day of the split that has no routine yet — the one they most likely came here for.
  const taken = new Set((profile.routines ?? []).map((r) => r.slot));
  const [slot, setSlot] = useState<StrengthSlot>(
    existing?.slot ?? initialSlot ?? slots.find((s) => !taken.has(s)) ?? slots[0] ?? "full",
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [entries, setEntries] = useState<StrengthEntry[]>(existing?.exercises ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const replacing = !existing && taken.has(slot);
  const built = routineFromEntries(slot, name || defaultRoutineName(slot), entries, nowISO);

  return (
    <Sheet
      onClose={onClose}
      label={existing ? `Edit ${existing.name}` : "Create a routine"}
      header={
        <div className="border-b border-line px-5 py-3.5">
          <div className="eyebrow text-[0.7rem]">{existing ? "Edit routine" : "New routine"}</div>
          <div className="font-display text-lg font-semibold">
            {existing ? existing.name : "Build a gym day"}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5 px-5 py-4">
        {/* Which day of the split. Locked when editing: the slot is the routine's
            identity, so changing it here would silently orphan the old one. */}
        <div>
          <div className="mb-2 eyebrow text-[0.72rem]">Which gym day</div>
          {existing ? (
            <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm">
              {slotLabel(existing.slot)}
              <span className="ml-2 text-xs text-muted">Can&apos;t be changed — delete and rebuild to move it</span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {slots.map((s) => (
                  <button
                    key={s}
                    onClick={() => { haptic("select"); setSlot(s); }}
                    aria-pressed={slot === s}
                    className={`rounded-xl border px-3.5 py-2 text-sm font-semibold transition active:scale-95 ${
                      slot === s ? "border-accent bg-accent text-on-accent" : "border-line bg-surface-2 text-muted"
                    }`}
                  >
                    {slotLabel(s)}
                    {taken.has(s) && <span className="ml-1.5 text-[0.65rem] opacity-70">built</span>}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                {replacing
                  ? `You already have a routine for ${slotLabel(slot)} — saving replaces it.`
                  : `Every ${slotLabel(slot)} on your plan will open as this.`}
              </p>
            </>
          )}
        </div>

        <div>
          <div className="mb-2 eyebrow text-[0.72rem]">Call it</div>
          <input
            className="input w-full py-2.5"
            aria-label="Routine name"
            placeholder={defaultRoutineName(slot)}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <StrengthLog
          key={slot}
          initial={entries}
          history={history}
          slot={slot}
          unit={strengthUnitOf(profile)}
          heading="The session"
          onChange={setEntries}
        />

        {/* Said out loud, because the empty reps/kg boxes look like something you
            forgot. Ryan: "when they build it for their first time, they're not gonna
            know" — so the fields are an invitation, not a requirement, and the first
            session is what fills them. */}
        <p className="-mt-2 text-xs leading-relaxed text-muted">
          Leave reps and weight blank if you don&apos;t know them yet — the first time you do
          this session, what you enter becomes the baseline it opens with after that.
        </p>

        {built && (
          <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm">
            <span className="font-semibold">{built.name}</span>
            <span className="text-muted"> · {summarise(built.exercises, strengthUnitOf(profile))}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-line py-3 text-sm font-semibold text-muted">
            Cancel
          </button>
          <button
            onClick={() => { if (built) { haptic("success"); onSave(built); } }}
            disabled={!built}
            className="flex-[2] rounded-2xl bg-foreground py-3 text-sm font-semibold text-background transition active:scale-[0.99] disabled:opacity-40"
          >
            {existing ? "Save changes" : "Create routine"}
          </button>
        </div>
        {!built && (
          <p className="-mt-2 text-center text-xs text-muted">Add an exercise to save this day.</p>
        )}

        {existing && onDelete && (
          confirmDelete ? (
            <div className="rounded-2xl border border-danger/40 bg-surface-2 p-4">
              <div className="text-sm font-semibold">Delete {existing.name}?</div>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Your {slotLabel(existing.slot)} sessions will go back to the plan&apos;s default. Sessions you&apos;ve
                already logged keep their history.
              </p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-xl border border-line py-2.5 text-sm font-semibold">
                  Keep it
                </button>
                <button
                  onClick={() => { haptic("light"); onDelete(existing.slot); }}
                  className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-semibold text-on-accent"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full py-1 text-center text-sm font-semibold text-muted transition hover:text-danger"
            >
              Delete this routine
            </button>
          )
        )}
      </div>
    </Sheet>
  );
}
