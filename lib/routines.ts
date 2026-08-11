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

import type { Profile, StrengthEntry, StrengthRoutine, StrengthSlot, StrengthSlotBase, Workout } from "./types";
import { customSlotFor, parseCustomSplit } from "./workouts";

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
  // A custom day the athlete named themselves ("Chest Day · Your Session") must
  // not be matched by the generic title hints below (#206).
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

export const SLOT_LABEL: Record<StrengthSlotBase, string> = {
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
const SLOT_TITLE: Record<StrengthSlotBase, string> = {
  full: "Full Body",
  upper: "Upper Body",
  lower: "Lower Body",
  push: "Push",
  pull: "Pull",
  legs: "Leg",
  home: "Home",
  custom: "Gym",
};

/** Turn `custom:chest-day` back into "Chest Day" for display (#206). */
function customName(slot: StrengthSlot): string | null {
  if (!slot.startsWith("custom:")) return null;
  const slug = slot.slice("custom:".length);
  if (!slug) return null;
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** The chip label for a gym day, including an athlete's own named day. */
export function slotLabel(slot: StrengthSlot): string {
  return customName(slot) ?? SLOT_LABEL[slot as StrengthSlotBase] ?? "Gym";
}

export function defaultRoutineName(slot: StrengthSlot): string {
  const own = customName(slot);
  if (own) return `My ${own}`;
  return `My ${SLOT_TITLE[slot as StrengthSlotBase]} Day`;
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

/**
 * The gym days this athlete's split actually contains — what a routine editor
 * may offer, and in the order the plan rotates through them.
 *
 * Derived from the same inputs `buildStrengthRoles` feeds to `strengthFor`
 * (planEngine.ts), so the days offered are exactly the days that will appear on
 * the calendar. Offering "Push" to an upper/lower athlete would let them build a
 * routine that never attaches to anything.
 */
export function slotsForProfile(profile: Profile | null | undefined): StrengthSlot[] {
  // No gym ⇒ every strength day is the bodyweight home circuit, one slot.
  if (profile?.equipment?.gym === false) return ["home"];
  const split = profile?.strength?.split ?? "full";
  switch (split) {
    case "custom": {
      const days = parseCustomSplit(profile?.strength?.customSplit);
      // One unparseable line is not a split — the engine falls back to a single
      // generic session, and so must we (see strengthFor).
      return days.length > 1 ? days.map(customSlotFor) : ["custom"];
    }
    case "upper-lower":
      return ["lower", "upper"]; // the rotation starts on lower — strengthFor, index 0
    case "push-pull-legs":
      return ["push", "pull", "legs"];
    default:
      return ["full"];
  }
}

// ---------------------------------------------------------------------------
// What a gym day OPENS WITH when the athlete hasn't built a routine for it.
//
// Ryan's ask was "it has the list of all the sets and exercises I need to do for
// this day". Measured on a fresh account, it didn't: without a saved routine the
// live session opened on "Nothing on the card yet", and every exercise had to be
// typed from scratch — on the exact screen that exists to stop you typing.
//
// The plan already knows. `gym()` in lib/workouts.ts writes the session as
// "3 rounds: push-up ×12 · overhead press ×10 · dips ×10 · …" — real exercises,
// real reps, real round count — and we were throwing all of it away. Parsing it
// back gives every athlete a full card on day one, before they've built anything.
//
// Names are canonicalised through the exercise catalog so a parsed "push-up"
// lands as the same "Push-Up" the athlete would have picked by hand — otherwise
// the plan's card and their own logging would build two separate PB histories
// for the same lift.
// ---------------------------------------------------------------------------

import { canonicalName } from "./exerciseCatalog";
import type { ExerciseHistory } from "./strength";

/** "3 rounds: push-up ×12 · single-arm row ×12/side" → exercises × sets. */
export function prescribedExercises(w: Workout): StrengthEntry[] {
  if (w.discipline !== "strength") return [];
  for (const seg of w.segments ?? []) {
    const d = seg.description ?? "";
    const m = /^(?:(\d+)\s*rounds?\s*:\s*)(.+)$/i.exec(d.trim());
    if (!m) continue;
    const rounds = Math.max(1, Math.min(6, parseInt(m[1], 10) || seg.repeat || 3));
    const items = m[2]
      .split("·")
      .map((x) => x.trim())
      .filter(Boolean);
    const out: StrengthEntry[] = [];
    for (const item of items) {
      // "single-arm row ×12/side" — the /side is a coaching note, not a rep count
      const hit = /^(.+?)\s*[×x]\s*(\d+)\s*(\/\s*side)?$/i.exec(item);
      if (!hit) continue;
      const raw = hit[1].trim();
      const reps = parseInt(hit[2], 10);
      if (!raw || !reps) continue;
      const perSide = !!hit[3];
      // Title-case only when the catalog doesn't know it. Small words stay lower
      // so "lat pulldown or pull-up" doesn't come back as "…Or Pull-Up".
      const name =
        canonicalName(raw) ??
        raw.replace(/\b[a-z]/g, (c, i) => (i > 0 && /^(or|and|the|to)$/.test(raw.slice(i, i + 3).trim()) ? c : c.toUpperCase()));
      out.push({
        name: perSide ? `${name} (each side)` : name,
        // No load: the plan can't know what this athlete lifts, and inventing a
        // number would be worse than an empty field they fill once and reuse.
        sets: Array.from({ length: rounds }, () => ({ reps })),
      });
    }
    if (out.length) return out;
  }
  return [];
}

/** Where a gym session's opening card comes from — shown to the athlete, so
 *  "this is your routine" and "this is what the plan suggested" never blur. */
export type CardSource = "routine" | "plan" | "empty";

export function cardForWorkout(
  profile: Profile | null | undefined,
  w: Workout,
  /** Everything logged before, so the plan's card arrives at YOUR working weights. */
  history?: ExerciseHistory[],
): { entries: StrengthEntry[]; source: CardSource } {
  const routine = routineForWorkout(profile, w);
  if (routine?.exercises.length) return { entries: routine.exercises, source: "routine" };
  const prescribed = prescribedExercises(w);
  if (prescribed.length) return { entries: withKnownLoads(prescribed, history), source: "plan" };
  return { entries: [], source: "empty" };
}

/**
 * The plan prescribes movements and reps; it cannot know what this athlete
 * lifts. So the FIRST Push day asks for five weights. From the second onward it
 * shouldn't have to — the log already knows, and re-typing 60 kg every week is
 * the most avoidable work in the app.
 *
 * The prescription keeps its structure (which exercises, how many sets, target
 * reps) and history supplies only the load, which is the one number the plan was
 * never in a position to supply. An athlete who wants their own rep scheme saves
 * a routine, and that wins outright.
 */
function withKnownLoads(entries: StrengthEntry[], history: ExerciseHistory[] | undefined): StrengthEntry[] {
  if (!history?.length) return entries;
  return entries.map((e) => {
    const prior = history.find((p) => p.name.trim().toLowerCase() === e.name.trim().toLowerCase());
    const kg = prior?.lastSets.reduce((m, x) => Math.max(m, x.weightKg ?? 0), 0) ?? 0;
    if (kg <= 0) return e;
    return { ...e, sets: e.sets.map((x) => ({ ...x, weightKg: kg })) };
  });
}
