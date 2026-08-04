/* Session repair: an athlete whose stored state lost its top-level profile must
   still get a profile back (from the plan's embedded copy), or the Profile tab
   renders blank while the rest of the app works. No network / DB. */
import { resolveProfile, profileToPersist } from "../lib/session";
import type { Plan, Profile } from "../lib/types";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (ok) pass++;
  else fail++;
}

const profile = { level: "intermediate", raceDateISO: "2026-10-04", unitPreference: "metric" } as unknown as Profile;
const other = { level: "beginner", raceDateISO: "2026-12-01", unitPreference: "imperial" } as unknown as Profile;
const plan = { profile, totalWeeks: 12, weeks: [], workouts: {} } as unknown as Plan;

console.log("\nsession: recovering a lost profile");

// the bug: state saved with a plan but profile:null → the Profile tab had nothing to render
eq("null profile falls back to the plan's embedded copy", resolveProfile(null, plan), profile);
eq("undefined profile falls back too", resolveProfile(undefined, plan), profile);

// the happy path must be untouched — the top-level copy always wins
eq("an explicit profile is preferred over the plan's", resolveProfile(other, plan), other);
eq("profile survives with no plan at all", resolveProfile(profile, null), profile);

// a genuinely new athlete has neither, and must stay null (they belong in onboarding)
eq("no profile and no plan stays null", resolveProfile(null, null), null);
eq("no profile and a plan without one stays null", resolveProfile(null, { totalWeeks: 8 } as unknown as Plan), null);

console.log("\nsession: a save must not blank out a good profile");

// the corruption vector: persisting while `profile` is momentarily null wrote
// profile:null next to a healthy plan, which is what stranded people in the first place
eq("saving with a null profile writes the plan's copy, not null", profileToPersist(null, plan), profile);
eq("saving a real profile is unchanged", profileToPersist(other, plan), other);
eq("nothing to recover still writes null", profileToPersist(null, null), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
