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

/** Drop every draft older than MAX_AGE_DAYS. Called on app open so abandoned
 *  sessions don't accumulate in storage forever. */
export function pruneLive(nowISO: string): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try {
        const s = JSON.parse(localStorage.getItem(k) || "{}") as LiveSession;
        if (!s.startedISO || daysBetween(s.startedISO, nowISO) > MAX_AGE_DAYS) stale.push(k);
      } catch {
        stale.push(k); // unparseable is stale by definition
      }
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    /* see header */
  }
}
