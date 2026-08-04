import type { Plan, Profile } from "./types";

// ---------------------------------------------------------------------------
// Session state repair.
//
// The app carries the athlete's Profile in TWO places: the top-level `profile`
// field of the saved state, and `plan.profile` — the copy the engine embeds in
// every plan it builds. They're written together on the happy path, so they
// normally agree.
//
// They can come apart. `persist()` writes whatever `profile` currently is, and a
// save that happens while it's momentarily null stores `profile: null` next to a
// perfectly good plan. From then on the athlete loads with plan-but-no-profile,
// and because ProfileTab needed the top-level copy it rendered NOTHING — a blank
// Profile tab, while Today/Plan/Progress (which read plan.profile) all worked
// fine. That asymmetry is exactly why it looked like "some people can't see their
// profile" rather than an outage.
//
// The embedded copy is the recovery source: a plan cannot exist without one.
// Resolving through it on load heals the session in place, and the next ordinary
// save writes the recovered profile back to the server, so the bad row fixes
// itself without anyone having to reset their plan.
// ---------------------------------------------------------------------------

/** The athlete's profile, preferring the top-level copy and falling back to the
 *  one embedded in their plan. Returns null only when neither exists (a genuinely
 *  new athlete). Pure. */
export function resolveProfile(profile: Profile | null | undefined, plan: Plan | null | undefined): Profile | null {
  return profile ?? plan?.profile ?? null;
}

/** The profile that should actually be written for this save. Never lets a null
 *  profile overwrite one the plan still carries — otherwise a single save at the
 *  wrong moment persists the blank-profile state we're repairing above. Pure. */
export function profileToPersist(profile: Profile | null | undefined, plan: Plan | null | undefined): Profile | null {
  return resolveProfile(profile, plan);
}
