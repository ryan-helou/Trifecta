import { Profile } from "./types";
import { isFitnessGoal } from "./planEngine";

// ---------------------------------------------------------------------------
// Onboarding is fully skippable, so an athlete can reach the app with important
// answers still blank. These are the gaps worth nudging them to fill — derived
// purely from the profile, so each one clears itself the moment it's answered
// (no stored "pending" flags to keep in sync). Pure.
// ---------------------------------------------------------------------------

export interface ProfileGap {
  key: string;
  label: string;
}

export function profileGaps(p: Profile): ProfileGap[] {
  const gaps: ProfileGap[] = [];

  // Picked a race distance but never set a date → no countdown, no taper (the plan
  // is running as a rolling fitness block until they add it). Fitness-mode athletes
  // chose to have no race, so they're never nudged for a date.
  if (p.raceType !== "fitness" && isFitnessGoal(p)) {
    gaps.push({ key: "racedate", label: "Add your race date for a countdown and a proper taper" });
  }

  // No performance references at all → paces are estimated from level alone.
  if (!p.runPR && !p.swimPR && !p.bikePR && !p.ftp) {
    gaps.push({ key: "prs", label: "Add a recent time or your FTP to personalise your paces" });
  }

  return gaps;
}

/** A stable signature of the current gaps, so a dismissal sticks only while the gap
 *  set is unchanged — fix or add a gap and the nudge re-surfaces for the new state. */
export function gapSignature(gaps: ProfileGap[]): string {
  return gaps.map((g) => g.key).sort().join(",");
}
