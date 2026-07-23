# Trifecta — App Store launch plan

**Status:** planning · **Last researched:** 2026-07-22 · **Owner:** Ryan

Goal: take Trifecta from a friends-scale **Next.js PWA on Railway** to a **commercial iOS
app on the Apple App Store** (Android/Google Play as a fast-follow). This doc is the
roadmap, not code — it exists so we sequence the work in the cheapest-risk order and
don't discover the blockers mid-build.

---

## 0. TL;DR / the three things that actually matter

1. **A PWA is not an App Store app.** Apple doesn't accept PWAs. You need a native binary.
   The realistic path that reuses your React code is **Capacitor** (native shell + WKWebView),
   but your app is **server-heavy** (API routes, cookie auth), and Capacitor bundles a
   *static* export — so this requires an **architecture split**, not a wrapper.
2. **Apple rejects bare webview wrappers (Guideline 4.2).** Reviewers literally put the
   device in **Airplane Mode**; a blank screen = instant rejection. You pass by adding real
   **native** capability — and the perfect one is **HealthKit**.
3. **Don't build a commercial app on Strava.** Its Nov-2024 API terms forbid showing a
   user's data to other users and forbid AI/ML on Strava data, and **Strava now owns Runna**
   (your closest competitor) *and* your data pipe. Make **Apple HealthKit the primary
   source**; demote Strava to one optional source. HealthKit is *also* what gets you past #2.

**These three point the same way: an iOS app whose spine is HealthKit, with the existing
Next.js backend demoted to a remote API and Strava as an optional extra.**

**Rough shape:** ~**$99/yr** (Apple) + your existing Railway cost; **8–14 focused build-days**
for a credible v1 (auth refactor + Capacitor shell + HealthKit + compliance), plus **~1–2 weeks
of App Review** latency. Charging money adds IAP/RevenueCat work.

---

## Phase 0 — Validate first (now, ~$0, do not skip)

You don't need native to learn whether the product is good. Before paying the native tax:

- **Self-upgrade Strava to 10 athletes** in the dashboard (strava.com/settings/api, no
  review) → fixes your own "reached limit" and lets ~9 friends on the live PWA today.
- Ship the PWA to friends (Add to Home Screen). Watch what they actually use.
- Define your **v1 bar**: what must be true (retention, "would you pay") before you invest
  in native. If the PWA doesn't retain friends, native won't fix that.

*You chose "plan the native path now," so the rest of this doc is the native plan — but
Phase 0 runs in parallel and costs nothing.*

---

## 1. Technical architecture — the real work

### 1.1 The core problem: you can't static-export Trifecta as-is
Capacitor bundles a static frontend (`output: 'export'` → `out/`). Today Trifecta depends on
**server-only** features that a static export can't run:

- API routes: `/api/auth/*`, `/api/state`, `/api/coach`, `/api/strava/*`, `/api/intake`,
  `/api/plan-summary`
- **Same-origin cookie sessions** (scrypt + HMAC cookie) — works because the web app and its
  API share an origin.

In a Capacitor app the frontend is served from `capacitor://localhost`, a **different origin**
from your Railway API. Same-origin cookie auth breaks across origins.

### 1.2 The refactor: split frontend (bundled) from API (remote)
```
┌─────────────────────────── iOS app (Capacitor) ───────────────────────────┐
│  Native shell (Swift)                                                       │
│   • Native UITabBar (Today / Plan / Progress / Profile)  ← helps pass 4.2  │
│   • HealthKit plugin (reads workouts on-device)          ← the native moat │
│   • Push (APNs), offline screen                                            │
│  ── WKWebView ──────────────────────────────────────────────────────────  │
│   • Your React UI, statically exported, bundled in the binary             │
│   • Calls the remote API over HTTPS with a Bearer token                   │
└────────────────────────────────────────────────────────────────────────────┘
                                   │ HTTPS + CORS
                                   ▼
                   Railway: Next.js API (existing routes) + Postgres
```
Concretely this means:
- **Auth: cookie → token.** Add a token-based mode (issue a signed token on login, send it
  as `Authorization: Bearer …`, verify server-side). Keep cookie mode for the web PWA.
- **API base URL becomes absolute** (`https://amatri-production…`) in the mobile build, via an
  env flag; **enable CORS** on the API for the Capacitor origin.
- **Frontend must render client-side** where it currently leans on server components/SSR for
  authed data. Most of Trifecta is already client-interactive; audit each route.

**Faster-but-riskier alternative — remote-URL Capacitor:** point the shell at the live web
app (`server.url`) instead of bundling. Avoids the split, but Apple treats it as a webview
wrapper → **high 4.2 rejection risk** unless you add strong native features (HealthKit + native
tabs + offline). Viable as a throwaway MVP to test HealthKit plumbing; **not** the shippable
architecture. Recommendation: bite off 1.2 properly.

### 1.3 HealthKit-first data layer (replaces Strava as the spine)
- Read workouts **on-device** via a maintained plugin — candidates:
  [`@capgo/capacitor-health`](https://www.npmjs.com/package/@capgo/capacitor-health) (actively
  maintained), [`mley/capacitor-health`](https://github.com/mley/capacitor-health),
  [`perfood/capacitor-healthkit`](https://github.com/perfood/capacitor-healthkit). All read
  workouts (swim/bike/run), heart rate, distance, duration.
- **Reuse your matcher.** The activity→workout matcher is a **pure, unit-tested TS function**
  (`scripts/test-strava-match.ts`) — run it **client-side** against HealthKit workouts, then
  sync the "done + actuals" result to the server. No webhook needed for the HealthKit path.
- **Model shift to be honest about:** Strava is server-push (webhook → server matches). HealthKit
  is on-device pull (query/observer in the app). The plan state still lives server-side; the
  app uploads normalized activities or match-results. Design a single `Activity` shape both
  sources normalize into so the engine/matcher is source-agnostic.
- **Strava stays** as an *optional* server-side source for people who prefer it / Android depth,
  but it's no longer required and no cross-user social features are built on it (terms).

### 1.4 Passing Apple Guideline 4.2 (the airplane-mode test)
- **Native UITabBar** controlling which web content loads (not a DOM hamburger).
- **HealthKit** integration = genuine device capability.
- **Native push** (APNs) for session reminders/streaks (ties into the retention doc).
- **Real offline state** — you already have a PWA service worker; ensure Airplane Mode shows
  a designed offline screen, never a blank WKWebView.

---

## 2. Compliance & legal (all new; all required for public launch)

| Item | Why | Effort |
|---|---|---|
| **Privacy Policy** page (public URL) | Required by Apple, Strava, HealthKit, GDPR/CCPA. Repo has **none**. | small |
| **Terms of Service** page | Standard for a paid/consumer app. Repo has **none**. | small |
| **In-app account deletion** | Apple **Guideline 5.1.1(v)** — mandatory when you have accounts. | small–med |
| **HealthKit usage strings** (`NSHealthShareUsageDescription`) | Info.plist; app crashes/rejects without it. | tiny |
| **Privacy "nutrition" labels** + App Privacy questionnaire | Required at submission; must match actual data use. | small |
| **HealthKit data rules** | Can't use Health data for advertising/data-mining or sell it; must have privacy policy. | policy |
| **GDPR/CCPA** (data export/delete, consent) | Health data = sensitive category. Already flagged in `docs/knowledge/08`. | med |
| **Fix the known P0 auth issue** | Flagged in the knowledge base; must be solid before a public launch. | med |

*I can build the Privacy/ToS pages and the account-deletion flow directly in the repo.*

---

## 3. Monetization (only if you charge)

- **Digital subscriptions on iOS must use Apple IAP** — you **cannot** use Stripe for in-app
  digital unlocks. Apple's cut is **30%**, but the **Small Business Program drops it to 15%**
  for <$1M/yr (you qualify).
- Use **[RevenueCat](https://www.revenuecat.com/)** (Capacitor plugin) as the cross-platform
  IAP/subscription layer — handles receipts, entitlements, iOS+Android, and is free under
  ~$2.5k/mo tracked revenue.
- **What to gate?** Keep onboarding + a basic plan free (activation), gate the premium engine
  features (adaptivity, AI coach, multi-race, advanced analytics). Decide with the Runna
  pricing analysis (`docs/research/runna-competitive-analysis.md`).
- Free launch (no IAP) is a legitimate v1 — ship free, add IAP once retention is proven.

---

## 4. Costs

| Cost | Amount |
|---|---|
| Apple Developer Program | **$99/yr** |
| Strava dev subscription | already covered (your Strava sub) |
| Railway (API + Postgres) | your current spend (unchanged) |
| RevenueCat | $0 until ~$2.5k/mo revenue |
| Anthropic/Gemini (AI coach) | usage-based, already tiny |
| **Your time** | the real cost — see timeline |

---

## 5. Timeline (rough, focused build-days)

| Phase | Work | Est. |
|---|---|---|
| **0. Validate** | Strava→10, friends on PWA, define v1 bar | ongoing, ~$0 |
| **1. Auth refactor** | token auth mode + CORS; keep cookie mode for web | 2–3 d |
| **2. Static frontend split** | `output: export` build target; audit SSR/server-component usage; absolute API base | 2–3 d |
| **3. Capacitor shell** | iOS project, native tab bar, offline screen, icons/splash | 1–2 d |
| **4. HealthKit** | plugin, permissions, on-device read, client-side matcher, sync results | 3–4 d |
| **5. Compliance** | Privacy/ToS pages, account deletion, Info.plist strings, privacy labels | 2–3 d |
| **6. (opt) Monetization** | RevenueCat + IAP + entitlement gating | 2–3 d |
| **7. Submit** | TestFlight → App Review | +**1–2 wk** latency |

→ **~10–17 build-days** to a submittable v1 (free), plus review latency. Android via the same
Capacitor project + Health Connect is a fast-follow, not a rebuild.

---

## 6. Risks / open decisions

- **Strava at commercial scale** — even demoted, if you keep it, going >10 athletes needs
  review and approval isn't guaranteed. HealthKit-first makes this non-blocking.
- **Apple 4.2 rejection** — mitigated by real native features (HealthKit, native tabs, push,
  offline). Don't ship a bare wrapper.
- **Auth refactor risk** — cross-origin token auth touches security-sensitive code; pair with
  fixing the known P0 auth issue.
- **HealthKit model shift** — on-device pull vs server push changes where matching runs; the
  pure matcher makes this tractable but it's real work.
- **Scope creep** — "App Store" tempts a rewrite. Resist: reuse the React UI + the engine +
  the matcher; only the shell, data layer, auth, and compliance are new.

---

## 7. Recommended next steps (pick one, I can start now)

1. **De-risk Strava in code** — add a source-agnostic `Activity` layer + HealthKit ingest so
   the engine/matcher stop being Strava-bound (foundational; useful even for the PWA).
2. **Auth token mode + CORS** — the gating refactor for any Capacitor build.
3. **Privacy Policy + ToS + account-deletion** — required regardless of path; quick wins that
   also help the current PWA.
4. **Spike the Capacitor shell** — stand up the iOS project pointing at the live app + a
   HealthKit read, to prove the native plumbing before the full split.

**Sources:** [Capacitor + Next.js guide](https://capgo.app/blog/building-a-native-mobile-app-with-nextjs-and-capacitor/) ·
[Apple 4.2 for WebView/Capacitor apps](https://code2native.com/blog/pass-app-store-guideline-42-review) ·
[Strava API restrictions (Nov 2024)](https://tryterra.co/blog/strava-discontinues-api) ·
[Strava Developer Program update (Jun 2026)](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428) ·
[Capacitor HealthKit plugins](https://www.npmjs.com/package/@capgo/capacitor-health)
