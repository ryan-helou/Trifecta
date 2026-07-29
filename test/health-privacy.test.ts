/*
  Health-data → third-party invariants (ticket #63).

  The exposure: /api/intake posted the athlete's free-text description of injuries and
  pain to Gemini. Free tiers may use submitted content to improve the models, and this
  is GDPR Article 9 special-category data, in scope for the FTC Health Breach
  Notification Rule. Consent was a sentence next to a button, bundled with having
  accepted the terms, and impossible to withdraw.

  Worse, /api/intake was not the only path: summarizeForCoach() put the athlete's
  injuries — area, severity, affected disciplines — into EVERY coach request, with no
  gate and no disclosure anywhere.

  These tests pin the two rules that now hold:
    1. the operator must attest the endpoint is a no-training tier (env), AND
    2. this athlete must have granted explicit, unbundled, revocable consent.
  Either missing ⇒ nothing about their body leaves the device.
*/
import assert from "node:assert";
import { summarizeForCoach } from "../lib/adapt";
import { healthTextAllowed } from "../lib/ai";
import type { Plan, Profile } from "../lib/types";

let pass = 0;
function ok(label: string, cond: boolean) {
  assert.ok(cond, `FAILED: ${label}`);
  pass++;
}

// ---- gate 1: the operator's no-training attestation -------------------------
const savedKey = process.env.GEMINI_API_KEY;
const savedFlag = process.env.AI_HEALTH_NO_TRAINING;

process.env.GEMINI_API_KEY = "test-key";
delete process.env.AI_HEALTH_NO_TRAINING;
ok("a configured key alone does NOT unlock health text", healthTextAllowed() === false);

process.env.AI_HEALTH_NO_TRAINING = "1";
ok("attesting a no-training tier unlocks it", healthTextAllowed() === true);

delete process.env.GEMINI_API_KEY;
ok("the attestation alone is not enough without a provider", healthTextAllowed() === false);

process.env.GEMINI_API_KEY = "test-key";
process.env.AI_HEALTH_NO_TRAINING = "true"; // only the exact "1" counts — no truthiness
ok("a fuzzy flag value does not unlock it", healthTextAllowed() === false);

if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
else process.env.GEMINI_API_KEY = savedKey;
if (savedFlag === undefined) delete process.env.AI_HEALTH_NO_TRAINING;
else process.env.AI_HEALTH_NO_TRAINING = savedFlag;

// ---- gate 2: the coach context must not leak the body by default ------------
const profile = {
  raceType: "olympic",
  raceDateISO: "2026-09-01",
  level: "intermediate",
  injuries: [{ id: "i1", area: "left achilles", disciplines: ["run"], severity: "moderate" }],
} as unknown as Profile;

const plan = {
  profile,
  weeks: [],
  workouts: {},
} as unknown as Plan;

const withoutConsent = summarizeForCoach(plan, "2026-07-29");
ok("THE LEAK: no injuries in the coach context by default", !withoutConsent.includes("achilles"));
ok("...and no severity either", !withoutConsent.toLowerCase().includes("moderate"));
ok("the coach still gets a usable context", withoutConsent.length > 0);

const withConsent = summarizeForCoach(plan, "2026-07-29", { includeHealth: true });
ok("with consent the coach is told what hurts", withConsent.includes("achilles"));

// Explicit false must behave exactly like absent — no truthy-object mistakes.
const explicitFalse = summarizeForCoach(plan, "2026-07-29", { includeHealth: false });
ok("includeHealth:false is as silent as omitting it", !explicitFalse.includes("achilles"));

console.log(`\n✓ health privacy: ${pass}/${pass} checks passed\n`);
