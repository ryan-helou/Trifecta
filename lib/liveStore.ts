// ---------------------------------------------------------------------------
// Where an in-progress gym session lives between sets.
//
// THE CONSTRAINT THAT DECIDES THIS FILE: a gym session runs an hour, and the
// phone is locked in a pocket for most of it. If the app is evicted from memory
// between the bench press and the incline press — which is the normal fate of a
// backgrounded WebView — the session must come back exactly as it was. Anything
// less and the athlete stops trusting it after one lost workout, which is one
// more than the feature survives.
//
// WHY NOT ON THE PLAN. `AppProvider.persist` writes the entire plan blob to
// localStorage on every change and debounces a server save behind it. The plan
// is ~100 KB. Ticking a set is a per-tap interaction, and a 100 KB serialize +
// write per tap — for state that is worthless the moment the session ends — is
// the wrong trade. The finished session DOES go onto the plan; only the
// in-flight draft lives here.
//
// KEYED PER WORKOUT. One key per session id, so starting a gym day never
// silently destroys a session left open on another one. Stale drafts are pruned
// by age on read (see MAX_AGE_DAYS) — a session abandoned last Tuesday must not
// resurrect itself on top of this Tuesday's.
//
// Every operation is wrapped: private mode, a full disk, and a WebView with
// storage disabled all throw on access, and none of them are a reason to take
// the gym screen down. Losing the draft is bad; crashing mid-session is worse.
// ---------------------------------------------------------------------------

import type { LiveSession } from "./liveSession";

const PREFIX = "trifecta.live.";

/** A draft older than this is the ghost of an abandoned session, not a resume. */
export const MAX_AGE_DAYS = 2;

const keyFor = (workoutId: string) => `${PREFIX}${workoutId}`;

const daysBetween = (aISO: string, bISO: string): number => {
  const a = Date.parse(aISO);
  const b = Date.parse(bISO);
  if (isNaN(a) || isNaN(b)) return Infinity;
  return Math.abs(b - a) / 86400000;
};

/** The in-progress session for this workout, or null. `nowISO` is passed in
 *  rather than read from the clock so the staleness rule stays testable. */
export function loadLive(workoutId: string, nowISO: string): LiveSession | null {
  try {
    const raw = localStorage.getItem(keyFor(workoutId));
    if (!raw) return null;
    const s = JSON.parse(raw) as LiveSession;
    // Shape check: a draft written by an older build (or a half-written one)
    // must not crash the screen it's restored into.
    if (!s || typeof s !== "object" || !Array.isArray(s.exercises) || s.workoutId !== workoutId) {
      clearLive(workoutId);
      return null;
    }
    if (daysBetween(s.startedISO, nowISO) > MAX_AGE_DAYS) {
      clearLive(workoutId);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveLive(s: LiveSession): void {
  try {
    localStorage.setItem(keyFor(s.workoutId), JSON.stringify(s));
  } catch {
    /* private mode / quota — the session continues in memory */
  }
}

export function clearLive(workoutId: string): void {
  try {
    localStorage.removeItem(keyFor(workoutId));
  } catch {
    /* nothing to do — see header */
  }
}

/**
 * Every session still in progress, newest first.
 *
 * This is what makes "it survives closing the app" true in practice rather than
 * just on disk. The draft always persisted — localStorage in the WebView is the
 * same store that holds the athlete's cached plan — but nothing SURFACED it, so
 * reopening the app after a session left you staring at Today with no sign that
 * a workout was half done, and no way to find it but remembering which gym day
 * it was and navigating there. Today now shows it.
 */
export function listLive(nowISO: string): LiveSession[] {
  const out: LiveSession[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const s = loadLive(k.slice(PREFIX.length), nowISO);
      if (s) out.push(s);
    }
  } catch {
    /* see header */
  }
  return out.sort((a, b) => (b.startedISO || "").localeCompare(a.startedISO || ""));
}

// A `pruneLive` sweep used to live here, described as "called on app open". It never
// was, and it wasn't needed: `loadLive` clears a stale draft as it reads one, and
// `listLive` runs `loadLive` over every key each time Today renders — so expired
// drafts are swept by the same pass that looks for resumable ones. Keeping a second,
// uncalled sweep around would have been dead code carrying a comment that lied about
// when it ran.
