# Epic — Trifecta on iOS: a testable, updatable native app

**Status:** planned · **Last researched:** 2026-07-23 · **Owner:** Ryan
**Companion doc:** [app-store-launch-plan.md](app-store-launch-plan.md) is the *strategy* (why HealthKit-first, why not Strava-commercial). **This doc is the *execution epic*** — milestones, tasks, acceptance criteria — sequenced around the actual near-term goal:

> **Goal: get a real build onto my (and friends') iPhones, and be able to update it fast.**

That goal is **not** "be commercially live on the App Store." It's the *test + iterate loop*. That distinction collapses the timeline: **you do not need App Review to test.** TestFlight does that, and most of your day-to-day updates never touch Apple at all.

---

## 0. The mental model — a two-speed update loop

The thing to internalise: once the shell exists, you update the app through **two channels**, and you'll live in the fast one.

| You changed… | Channel | Testers get it | Apple review |
|---|---|---|---|
| **Web code** — React/UI/copy/plan logic/CSS (99% of your changes) | **Capgo OTA** (`@capgo/capacitor-updater`) | **seconds–minutes, on next app open** | **none** — Apple explicitly permits interpreted JS/HTML/CSS updates (Guideline 3.3.2) |
| **Native** — add a plugin, Info.plist, app icon, Capacitor config | **New TestFlight build** | internal testers: **~1h** (build processing), then instant | none for internal; lightweight one-time Beta Review for external |
| **Public release** | **App Store submit** | everyone | full review, ~24–48h |

So the answer to "a way to test and update" is concretely: **TestFlight for the binary + Capgo for the web layer.** Almost every change you make ships OTA in minutes with zero Apple involvement. You only cut a new TestFlight build when you touch native.

**This is why the epic front-loads M0–M2** (device + TestFlight + OTA) and defers HealthKit, compliance, and monetization — those are for *public launch*, not for testing.

---

## 1. Where the repo is today (grounding, 2026-07-23)

- **Next.js 16.2.10**, **App Router**, deployed on Railway. Capacitor 8 (current) supports this combo; `output: 'export'` is the documented SPA path.
- **The UI is a single-page app**: only `app/page.tsx` + `app/layout.tsx`, **no dynamic routes**. → static export needs no `generateStaticParams` gymnastics; this is the easy case.
- **Server-only pieces stay on Railway**: `/api/auth/*`, `/api/state`, `/api/coach`, `/api/strava/*`, `/api/intake`, `/api/plan-summary`. In the native build these become **remote API calls**, not bundled code.
- **Auth is cookie-based but the token is already Bearer-ready**: `lib/auth-server.ts` mints an **HMAC-signed self-contained token** (`createSessionToken`) and can verify a raw token string (`verifySessionToken`). Today it's only read from the `ip_session` cookie (`getUserIdFromRequest`). Adding an `Authorization: Bearer` path is a *small* addition, not a rewrite.
- **Known P0 auth issues** (from `docs/knowledge/08` §3.6) that must be fixed before *public* users, and which pair naturally with the auth work in M1/M3: session-secret fallback chain (forge-any-session if unset), no session revocation, no login rate-limiting, blocking `scryptSync`, weak password policy.
- **Push today is local-only** (`lib/notify.ts`, Notification Triggers API — dormant on iOS). Real native push (APNs) is an M4+ item, not on the test-loop critical path.

---

## 2. Milestones

Estimates are **focused build-days**. Enrollment/review **latencies run in parallel** and are called out separately.

### M0 — Apple account + first run on a real iPhone · **~0.5 d** (+ enrollment latency, parallel)
The unblock-everything milestone. Two things in parallel:
- **Enroll in the Apple Developer Program — Individual, $99/yr.** Identity verification via the Apple Developer app (ID + selfie); realistic approval **~1–3 days**. *Start this first; it's the longest-latency, lowest-effort item and it gates TestFlight + HealthKit.*
- **Smoke-test the shell on device — no enrollment needed.** Add Capacitor, point it at the live Railway PWA (`server.url`) or your LAN dev server, and do a **free-Apple-ID Xcode direct install** to your own iPhone. This proves the native plumbing in **minutes**.
  - *This remote-URL build is a throwaway dev harness — Apple rejects `server.url` production builds under Guideline 4.2. Do not try to ship it; it exists only to see the app on glass today.*

**Acceptance:** Trifecta is running on Ryan's physical iPhone; Apple enrollment submitted.

### M1 — Capacitor shell + static split + TestFlight internal · **3–5 d** · *the core test loop*
The real, shippable architecture — and because the UI is one SPA, the static split is cheap.
- **Add Capacitor 8**, `npx cap add ios`; native `webDir: 'out'`.
- **Static-export the frontend**: `output: 'export'`, `images: { unoptimized: true }`; confirm nothing in `app/` relies on server-render (it doesn't — single client page). Server logic stays on Railway.
- **Auth: add Bearer-token mode.** On login, also return the signed token in the JSON body; on the server, accept `Authorization: Bearer <token>` in `getUserIdFromRequest` (cookie mode stays for the web PWA). Store the token in the **iOS Keychain** via a secure-storage plugin — **not** `@capacitor/preferences` (unencrypted).
- **Enable CORS** on the API for origin `capacitor://localhost` + the `Authorization` header. Set an absolute API base URL for the native build via env flag.
  - *Avoid the CapacitorHttp shortcut for auth — it has iOS bugs dropping the `Authorization` header. Use standard fetch + Bearer.*
- **First real TestFlight build** → add Ryan + friends as **internal testers** (up to 100, **no review**, live ~1h after upload).

**Acceptance:** Ryan + a friend install via TestFlight, log in, and use the app end-to-end against the live Railway API. Builds are bundled (not remote-URL).

### M2 — The fast update loop (OTA) · **~1 d** · *this is the "update it" goal*
- Integrate **Capgo** (`@capgo/capacitor-updater`) — **Solo ~$12/yr** (2k MAU), 14-day trial; self-host option exists if you'd rather.
- Wire a one-command deploy (`npx @capgo/cli bundle upload`) so a web change ships to all testers **on next app open, no rebuild, no TestFlight, no review**.
- Write the team rule into the repo README: **web change → OTA; native change → TestFlight build.**

**Acceptance:** push a visible copy/UI change and watch it land on a device **without** an Xcode rebuild or a new TestFlight upload.

> **End of M2 = your stated goal is met.** M0–M2 ≈ **4–6 build-days** gets friends testing on real iPhones with instant OTA updates. Everything below is for *public launch*, do it when you're ready to charge/scale.

### M3 — External beta + compliance baseline · **2–3 d** (+ ~14h first Beta Review)
- **Privacy Policy + Terms of Service** as public pages (repo has none; required for external testers, Health, GDPR/CCPA). *I can build these in-repo.*
- **In-app account deletion** — Apple Guideline **5.1.1(v)**, mandatory once you have accounts.
- **Fix the P0 auth issues** (fail-closed on missing `SESSION_SECRET`; `token_version` revocation; login rate-limiting; async `scrypt`; stronger password policy) — pairs with M1's auth work.
- **Accurate privacy nutrition labels** in App Store Connect.
- **External TestFlight**: up to **10,000 testers** via public link; first build per version needs **Beta App Review** (~14h median), later builds auto-clear in minutes.

**Acceptance:** a shareable public TestFlight link anyone can join; compliance pages live; P0 auth fixed.

### M4 — HealthKit (the native moat) · **3–4 d** · *deferred, not on the test path*
- **`@capgo/capacitor-health`** (actively maintained, Cap 8, reads swim/bike/run + HR + distance + route). Add the **HealthKit capability** + **both** Info.plist strings (`NSHealthShareUsageDescription` **and** `NSHealthUpdateUsageDescription` — App Store Connect rejects the upload if the update string is missing, even read-only).
- On-device workout read → **reuse the existing pure matcher** (`scripts/test-strava-match.ts`) client-side → sync "done + actuals" to the server. No webhook needed for the HealthKit path.
- This is what makes Guideline 4.2 a non-issue for the App Store submission and demotes Strava to one optional source (per the strategy doc).
  - *Testing note: the iOS Simulator has no real workout/HR data — HealthKit testing needs a **real iPhone**, ideally Apple-Watch- or Strava/Garmin-synced. Another reason the paid account + real-device TestFlight loop matters.*

**Acceptance:** on a real device, the app reads a real Health workout and marks the matching plan workout done.

### M5 — App Store submission (public launch) · *submit + ~24–48h review*
- Full App Review. Pre-clear the usual first-timer rejections: **4.2** (satisfied by HealthKit + native tabs + real offline screen), **5.1.1(v)** account deletion (M3), accurate **privacy labels** (M3).
- **Optional monetization** is a separate track: digital subscriptions on iOS **must** use Apple IAP (not Stripe); use **RevenueCat**; Apple's Small Business Program cuts the fee to 15%. A **free v1 is a legitimate launch** — add IAP once retention is proven.

**Acceptance:** Trifecta live on the App Store. Android is a fast-follow off the same Capacitor project (Health Connect instead of HealthKit), not a rebuild.

---

## 3. Timeline summary

| Phase | Milestones | Build-days | Latency (parallel) |
|---|---|---|---|
| **Test + update loop** *(your goal)* | M0 + M1 + M2 | **~4–6 d** | Apple enrollment ~1–3 d |
| Public-ready | + M3 + M4 | +5–7 d | first Beta Review ~14h |
| Live on store | + M5 | + submit | App Review ~24–48h |

- **To testable + updatable:** ~1 focused week (or ~2–3 calendar weeks part-time). Enrollment latency overlaps and is off the critical path if you start it today.
- **To public App Store:** ~3–4 focused weeks total.

---

## 4. Costs

| Item | Amount |
|---|---|
| Apple Developer Program | **$99/yr** |
| Capgo (OTA), Solo tier | **~$12/yr** (or self-host) |
| Railway (API + Postgres) | unchanged |
| RevenueCat | $0 until ~$2.5k/mo revenue (only if charging) |
| **New spend to reach the test loop** | **~$111/yr** |

---

## 5. Risks & decisions

- **Don't ship the remote-URL shell.** `server.url` is a dev harness only; it's an instant Guideline 4.2 rejection and breaks offline. M1 bundles the static export properly. (Fine to *test* internally on remote-URL in M0 — internal TestFlight doesn't hit 4.2 review — but it's not the architecture.)
- **Auth cross-origin is the one genuine refactor.** Cookies die at the `capacitor://localhost` origin; Bearer tokens in the Keychain are the fix. Low risk here because the token infra already exists — but it touches security code, so fold the P0 fixes in rather than doing them twice.
- **HealthKit needs a real device + real data** to test; the Simulator won't supply swim/bike/run + HR. Not a blocker for the test loop (M4 is deferred), but plan for it when you get there.
- **Build 90-day expiry:** TestFlight builds expire 90 days after upload — upload a fresh build at least quarterly to keep a beta alive (OTA updates don't reset this; a native rebuild does).
- **Scope creep → rewrite.** Resist. Reuse the React UI + the engine + the matcher. Only the shell, the data layer (HealthKit), auth mode, and compliance are new.

---

## 6. Recommended first move

**Start M0 now, in parallel:**
1. **You:** enroll in the Apple Developer Program (Individual, $99) — kicks off the 1–3 day identity check that gates everything.
2. **Me (I can start immediately, no account needed):** add the Capacitor shell + a `output: 'export'` build target + the Bearer-token auth mode + CORS, and stand up the remote-URL dev build so you can Xcode-install it to your iPhone the moment you want. That's M0's engineering + most of M1's foundation, and none of it needs the paid account to write.

Say the word and I'll begin the M0/M1 engineering.

**Sources (2026):** TestFlight/enrollment/review — Apple developer docs, runway.team/appreviewtimes, ptkd.com TestFlight guides · Capacitor 8 + Next static export — ionic.io/blog/announcing-capacitor-8, nextjs.org static-exports docs, capgo.app Next+Cap guide · OTA — capgo.app/pricing, Apple Guideline 3.3.2, Ionic Appflow sunset notice · HealthKit — github.com/Cap-go/capacitor-health, Apple HealthKit entitlement/Info.plist docs.
