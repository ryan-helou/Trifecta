---
name: verify-feature
description: >-
  The Trifecta verification protocol — run it after implementing ANY feature, fix,
  or substantial change, BEFORE claiming it done/verified or shipping. It does two
  things: (1) EXTENDS the test suite to cover the new work (a new engine invariant
  for logic/plan changes; a new/updated Maestro flow + screenshots for UI/native
  changes), then (2) RUNS the relevant gates — `npm test` (plan-engine invariants),
  `scripts/verify-ios.sh` (iOS simulator self-test via Maestro), a vision "eye test"
  on the captured screenshots, and `scripts/ship-ios.sh` (test-then-ship) for iOS
  releases. Enforces [[done-means-production-ready]]: never say "done"/"verified"/
  "100%" until the automated test that exercises the REAL code path is green, and be
  honest about what is and isn't covered. Use PROACTIVELY whenever you finish
  substantial work, and when the user says "test this", "verify it", "is it done".
---

# Trifecta verification protocol

The point of this skill is that **the machine tests itself so Ryan doesn't have to**
(his north star — [[bias-toward-automation]], [[prefer-do-over-instruct]]). A feature
is not "done" because it compiles or because you eyeballed it once — it is done when a
test that exercises the **actual code path a user hits** passes, and you can say
honestly what is covered. The self-test harness has already caught a login-blocking bug
that manual "verification" missed; trust the harness, not your say-so.

## When to use

- After implementing a feature, fix, refactor, or any substantial change — before you
  report it done, mark a Notion ticket, or ship.
- Before merging to `main` (tested work lands on main — [[always-commit-and-push]]).
- When the user asks "test this", "verify it", "is it working", "is it done".

Skip only for trivial, non-behavioural edits (copy tweaks, comments, docs). When unsure,
run it.

## Step 0 — Classify the change (match the tests to the work)

Decide what you touched, because it decides which gates apply AND what new test to add:

- **Plan engine / training logic / correctness** (`lib/planEngine.ts`, `lib/workouts.ts`,
  `lib/paces.ts`, `lib/zones.ts`, `lib/adapt.ts`, `lib/calibrate.ts`, readiness/load
  math) → **engine invariants** (Step 1).
- **UI / native shell / a user-facing flow / auth / onboarding** (`components/**`,
  `lib/tokenStore.ts`, `lib/api.ts`, Capacitor config, native plugins) → **simulator
  self-test + eye test** (Steps 2–3).
- **Both** → do both.
- **Backend/API only** (`app/api/**`) → exercise it with a real request (curl the live
  Railway API or a local run) and assert status + shape; if it changes plan/auth
  behaviour, also do the relevant gate above.

## Step 1 — Engine invariants (`npm test`)

Deterministic, no simulator. `test/engine.test.ts` asserts the properties a coach's eye
judges: determinism, non-degenerate output, frequency honored, **safe load ramp + deloads**,
**taper before the race**, phase order `base→build→peak→taper`, **polarized intensity**
(≥50% easy), and injury-aware load reduction.

1. Run `npm test`. It must be **green**.
2. **If you added or changed engine behaviour, ADD an invariant for it** — running only
   the old asserts does NOT test your new feature. Examples: new periodization rule →
   assert the resulting week structure; new equipment/injury handling → assert the load
   moves the right way; new pacing → assert the zones/targets stay in bounds.
3. **Calibrate thresholds to real output, with margin** — first print the engine's actual
   numbers (a throwaway `tsx` probe), then set bounds that pass comfortably. A test that
   false-fails on a correct plan is worse than no test.

## Step 2 — iOS simulator self-test (`scripts/verify-ios.sh`)

Drives the REAL app in the WKWebView on a booted simulator via Maestro, end-to-end,
headless, with a pass/fail exit code + screenshots (`artifacts/ios/`). This is the
replacement for "install it on my phone and click around."

1. Run `scripts/verify-ios.sh` (full: builds Path-B, installs, runs every real flow in
   `maestro/`). Use `SKIP_BUILD=1` to reuse the last build while iterating a flow. Test
   login: `simtest_qa` / `simpass123`.
2. **If you added/changed a screen or flow, ADD or update a Maestro flow** in `maestro/`
   (mirror `maestro/login.yaml`). A feature with no flow covering it is untested. Confirm
   it passes **≥3 fresh-install runs** before adding it to the gate — Maestro on iOS can
   be flaky; a flaky gate false-blocks good ships.
3. If a flow is flaky and you can't stabilize it now, prefix its filename with `_` so
   `verify-ios.sh` excludes it from the gate (like `_onboarding-wip.yaml`), and say so —
   never ship a flaky gate silently.

### Maestro-on-Capacitor gotchas (learned the hard way — apply them)

- Maestro sees the WKWebView through the **accessibility tree**: match visible **text /
  aria-label / input placeholder**, NOT DOM `id`/CSS.
- Text is a **full-string regex** — `"Sign in"` only matches an element whose whole text
  is "Sign in"; use `.*Sign in.*` to match inside a longer string. Watch for ambiguity
  (a substring regex can hit a subtitle instead of the button — use the exact string for
  unambiguous buttons).
- **Type into inputs by their placeholder** (`tapOn: "ironmike"`), then `inputText`.
- **Submit forms with `pressKey: Enter`** — the submit button can drop out of the a11y
  snapshot right after the keyboard dismisses.
- **Below-the-fold buttons** need `scrollUntilVisible` before `tapOn`.
- Guard every screen transition with `extendedWaitUntil` (cold launches + animations
  outrun the default wait). Inspect a stuck screen with `maestro hierarchy`.

## Step 3 — Visual "eye test" (the vision layer)

`verify-ios.sh` captures a screenshot per screen. **Read each screenshot** (they render
visually to you) and judge it like Ryan's eye would: layout, alignment, overlaps,
cut-off/truncated text, broken images, contrast/readability, off-brand styling, broken
empty/error states, "does this look shipped or broken." Flag anything off.

- This is real coverage — assertions confirm text exists; only looking confirms it looks
  right.
- Fully-headless auto-vision would need an `ANTHROPIC_API_KEY` (not currently set). Until
  then, **you are the vision layer on every ship** — actually open the screenshots, don't
  skip it.

## Step 4 — Ship gate (`scripts/ship-ios.sh`) for iOS releases

Only for shipping a build to TestFlight. Runs **gate 1** `npm test` → **gate 2**
`verify-ios.sh` → then `fastlane beta` (build 3+ auto-increments). A failing gate aborts
the upload — that is the safety, do not bypass it. Web-only changes deploy via a push to
`main` (Railway auto-deploys); no build needed.

## Hard rules

- **Never claim "done" / "verified" / "100%" until the gate that exercises the REAL code
  path is green.** A proxy check gives false confidence — e.g. calling `apiLogin()`
  directly "passed" while the actual UI login hung on the Keychain persist the proxy never
  ran. Drive the real function / real UI the user hits.
- **Extend the tests to cover the new work — don't just run the old ones.** New behaviour
  with no new assertion/flow is untested, no matter how many existing tests pass.
- **State coverage honestly.** Say what's tested and what isn't (e.g. "sim-verified, not
  device-verified"; "login flow covered, settings screen not yet"). Under-claim before
  over-claim.
- **A flaky test is worse than none** — stabilize it (≥3 green runs) or exclude it from
  the gate with a `_` prefix and say so.
- **Calibrate thresholds to real output** so correct behaviour never false-fails.
- After verifying + merging, update Notion via [[update-notion]] and the vault/session log.

## Cross-refs

- Domain grounding for engine invariants: [AGENTS.md](../../../AGENTS.md) + the 8-realm
  knowledge base ([docs/knowledge/README.md](../../../docs/knowledge/README.md)) —
  especially load management (03) and training-load/readiness (02) for what a *safe* plan
  looks like.
- Ship-loop automation plan + tier map: `brain/projects/Trifecta/human-in-the-loop-elimination-plan.md`.
- Artifacts of this protocol: `test/engine.test.ts`, `maestro/`, `scripts/verify-ios.sh`,
  `scripts/ship-ios.sh`.
