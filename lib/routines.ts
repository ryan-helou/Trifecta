// ---------------------------------------------------------------------------
// Gym routines — "build your workout so you don't have to log every time".
//
// Ryan asked for routines he AUTHORS, not just a prefill of what the plan
// prescribes: build "My Push Day" once — your exercises, your sets — and have
// every Push day open as that.
//
// THE KEY IS THE SLOT, NOT THE WORKOUT. A routine attaches to a gym DAY in the
// athlete's split (push / pull / legs / upper / lower / full / home / custom),
// never to a dated session. Plans get rebuilt constantly — `rebuild plan around
// today` replaces every workout object in the plan — so a routine pinned to a
// workout id would evaporate the first time the plan re-periodised. Slots
// survive that, and "every Push day" is what the athlete meant anyway.
//
// Routines live on the PROFILE for the same reason (lib/types.ts).
//
// ONE ROUTINE PER SLOT. Saving again replaces it. Multiple named routines per
// slot would need a picker on every gym session, which is a worse trade than
// "your Push day is your Push day" — and nothing stops a second routine landing
// on a different slot.
//
// Pure — no clock, no I/O. Callers pass `nowISO` when they want a timestamp.
// ---------------------------------------------------------------------------

import type { Profile, StrengthEntry, StrengthRoutine, StrengthSlot, Workout } from "./types";

/** Title → slot, for plans generated before `strengthSlot` was written onto the
 *  session. Ordered longest-distinguishing-word first so "Upper-Body & Core"
 *  can't be caught by a bare "core" test. */
const TITLE_HINTS: [RegExp, StrengthSlot][] = [
  [/home/i, "home"],
  [/push/i, "push"],
  [/pull/i, "pull"],
  [/\bleg/i, "legs"],
  [/lower/i, "lower"],
  [/upper/i, "upper"],
  [/full[- ]body/i, "full"],
  [/your strength/i, "custom"],
];

/**
 * Which gym day this session is. Reads the slot the builder stamped on it, and
 * falls back to the title for plans built before that existed — an athlete
 * mid-plan shouldn't have to rebuild to get routines.
 */
export function slotOf(w: Workout): StrengthSlot | null {
  if (w.discipline !== "strength") return null;
  if (w.strengthSlot) return w.strengthSlot;
  for (const [re, slot] of TITLE_HINTS) if (re.test(w.title)) return slot;
  return "full";
}

/** The athlete's routine for this session, if they've built one. */
export function routineForWorkout(profile: Profile | null | undefined, w: Workout): StrengthRoutine | null {
  const slot = slotOf(w);
  if (!slot || !profile?.routines?.length) return null;
  return profile.routines.find((r) => r.slot === slot) ?? null;
}

/** Strip a set list down to the shape worth REUSING. Reps and load carry over —
 *  they're the athlete's programme, and starting from last week's numbers is the
 *  entire point — but an empty set (a row they abandoned) never does. */
function cleanEntries(entries: StrengthEntry[]): StrengthEntry[] {
  return entries
    .map((e) => ({
      name: e.name.trim(),
      sets: e.sets.filter((s) => (s.reps || 0) > 0).map((s) => ({ reps: s.reps, ...(s.weightKg != null ? { weightKg: s.weightKg } : {}) })),
    }))
    .filter((e) => e.name && e.sets.length > 0);
}

/** Build a routine from what was just logged. Returns null when there's nothing
 *  worth saving, so the caller can keep the button honest. */
export function routineFromEntries(
  slot: StrengthSlot,
  name: string,
  entries: StrengthEntry[],
  nowISO?: string,
): StrengthRoutine | null {
  const exercises = cleanEntries(entries);
  if (!exercises.length) return null;
  return {
    // Deterministic: the slot IS the identity, so re-saving overwrites cleanly
    // and no clock or randomness is needed to mint an id (both are banned in the
    // pure layer, and both would break plan-diff equality).
    id: `routine-${slot}`,
    name: name.trim() || defaultRoutineName(slot),
    slot,
    exercises,
    ...(nowISO ? { updatedISO: nowISO } : {}),
  };
}

export const SLOT_LABEL: Record<StrengthSlot, string> = {
  full: "Full body",
  upper: "Upper body",
  lower: "Lower body",
  push: "Push",
  pull: "Pull",
  legs: "Legs",
  home: "Home",
  custom: "Your session",
};

/** SLOT_LABEL is sentence case because it reads as a chip ("Full body"), which
 *  makes "My Full body Day" when dropped into a title. Names get their own map. */
const SLOT_TITLE: Record<StrengthSlot, string> = {
  full: "Full Body",
  upper: "Upper Body",
  lower: "Lower Body",
  push: "Push",
  pull: "Pull",
  legs: "Leg",
  home: "Home",
  custom: "Gym",
};

export function defaultRoutineName(slot: StrengthSlot): string {
  return `My ${SLOT_TITLE[slot]} Day`;
}

/** Save or replace the routine for its slot. Returns a NEW array — the profile
 *  is persisted by identity comparison upstream, so mutating in place would
 *  save nothing. */
export function upsertRoutine(routines: StrengthRoutine[] | undefined, routine: StrengthRoutine): StrengthRoutine[] {
  const rest = (routines ?? []).filter((r) => r.slot !== routine.slot);
  return [...rest, routine].sort((a, b) => a.slot.localeCompare(b.slot));
}

export function deleteRoutine(routines: StrengthRoutine[] | undefined, slot: StrengthSlot): StrengthRoutine[] {
  return (routines ?? []).filter((r) => r.slot !== slot);
}
