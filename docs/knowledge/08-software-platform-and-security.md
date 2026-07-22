# 08 — Software Platform, Reliability & Health-Data Security

**Realm:** the machine underneath the product — the (forked) Next.js runtime, the
PWA/offline layer, Railway + Postgres, and the legal-grade handling of sensitive
health data. This is the doc that keeps AmaTri **reliable, scalable, and lawful**
as it grows from a few friends to a few hundred thousand athletes.

**Audience:** any engineer touching infra, auth, data storage, the service
worker, wearable ingestion, or anything that sends athlete data off-box (LLMs,
subprocessors). Read §4 before you ship a feature that collects or forwards
health data — the FTC and GDPR consequences are real and the precedents are
seven-figure.

> **The one-line law of this repo:** *This is not the Next.js you know.* We run
> **Next.js 16.2.10** (App Router, React 19, Turbopack). Several APIs were
> renamed or made async in 16. **Read `node_modules/next/dist/docs/` before you
> assume an API exists** — your training data is probably Next 13–15. §1 is the
> map.

---

## TL;DR — the facts a new engineer must hold

- **Runtime:** Next.js **16.2.10**, App Router only, React **19.2.4**, TypeScript,
  Tailwind v4. Turbopack is the default bundler. Deployed as a plain **Node
  server** (`next start -H 0.0.0.0`) on **Railway (Nixpacks)**, Postgres via `pg`.
- **The app is effectively a client SPA.** `app/page.tsx` is `"use client"` and
  renders everything; the server side is just **Route Handlers** under `app/api/*`
  reading/writing Postgres. We barely use React Server Components or streaming.
- **State model:** one row per user; the *entire* app state (`profile` + full
  `plan`) lives in a single **JSONB `data` blob**. Strava tokens, follows, and
  kudos live in their own tables. There are **no migrations** — tables are created
  lazily with `CREATE TABLE IF NOT EXISTS`.
- **Health-adjacent data we hold:** injuries (free-text + severity), heart rate
  (`avgHr`, `restingHr`, `maxHR`), readiness (sleep/legs/energy), RPE, and
  Strava-derived pace/HR/power. Under GDPR most of this is **Article 9
  special-category (health) data**.
- **We send health data to a third-party LLM.** `/api/intake` ships the athlete's
  free-text **injury description** to an LLM to structure it; `/api/coach` ships
  "athlete context." The README says *Claude Haiku*, but **the code
  (`lib/ai.ts`) actually calls Google Gemini** by default. That matters for
  privacy (§4).
- **Two laws you can't ignore:** the **FTC Health Breach Notification Rule**
  (2024 amendment — health apps are in scope; "breach" includes *disclosing*
  health data to third parties) and **GDPR Art. 9** (explicit consent for health
  data). HIPAA almost certainly does **not** apply (we're direct-to-consumer, no
  Business Associate Agreement).

---

## §1 — This is not the Next.js you know (the fork/version reality)

AmaTri runs **Next.js 16.2.10**. Most models and many engineers carry Next
13/14/15 mental models; several things in 16 are renamed, async, or new. The
authoritative source is the docs **shipped inside the package**:
`node_modules/next/dist/docs/` (an `01-app/` App-Router tree and an `02-pages/`
Pages-Router tree). Some of those docs even carry embedded "AI agent hint"
comments. **Read them before writing code.**

### 1.1 What is genuinely different vs mainstream/older Next.js

- **Middleware is now "Proxy."** As of Next 16, middleware is renamed to **Proxy**
  (`proxy.ts` in the project root, exporting `proxy` or a default). Same
  mechanism, new name and framing. The docs are explicit that Proxy is *not* a
  session/authorization boundary — it's for "optimistic checks," header rewrites,
  and redirects only. **AmaTri has no `proxy.ts`** (auth is enforced per-route via
  `getUserIdFromRequest`), which is fine — but it means there is **no central
  edge to hang security headers, global rate limiting, or a WAF-style filter on**.
- **Async request APIs.** `cookies()`, `headers()`, `params`, and `searchParams`
  are **async** in the App Router and must be `await`ed (e.g.
  `const { id } = await ctx.params`). Older synchronous usage is gone. AmaTri
  reads cookies off `NextRequest` (`req.cookies.get(...)`) inside Route Handlers,
  which sidesteps this — but any new Server Component that reaches for `cookies()`
  must await it.
- **Cache Components + PPR + `use cache`.** Next 16 ships an opt-in caching model
  (`cacheComponents: true` in `next.config.ts`) built on **Partial Prerendering**
  and a `use cache` directive (`cacheLife`, `cacheTag`, `updateTag`). When
  enabled, **GET Route Handlers follow the page prerender model** and any
  non-deterministic op (`Date.now()`, `Math.random()`, `crypto.randomUUID()`)
  must be guarded by `connection()` or cached. **AmaTri does not enable Cache
  Components**, and every data route sets `export const dynamic = "force-dynamic"`
  + `export const runtime = "nodejs"`, i.e. it deliberately opts out into simple,
  always-dynamic Node handlers. That's the right call for a
  per-user-authenticated API, but know that turning Cache Components on later is a
  breaking change you'd have to reason through per route.
- **Route Handlers replace `pages/api`.** Handlers live at
  `app/api/**/route.ts` and export functions named for the HTTP verb (`GET`,
  `POST`, `PUT`, `DELETE`…). They are **not cached by default** (a GET can opt in
  with `dynamic = "force-static"`). Unsupported methods auto-return `405`.
- **Turbopack is the default bundler** (not webpack). `next.config.ts` pins the
  workspace root explicitly:
  ```ts
  turbopack: { root },
  outputFileTracingRoot: root,
  ```
  This exists because **a stray lockfile in `$HOME` confuses Turbopack's root
  inference** — a real gotcha that produced wrong file-tracing/roots. Leave it.
- **React 19 canary is built into the App Router.** The App Router pins its own
  React (canary with the stable 19 changes); the Pages Router would use the
  `package.json` React. We're App-Router-only, on React 19.2.4.
- **Deploy story is "just a Node server."** The install/build docs confirm a
  Node.js deployment supports *all* Next features (unlike edge/serverless
  adapters, which have caveats). Railway runs `npm run build` then
  `next start -H 0.0.0.0`. There is a `prebuild` step (`scripts/stamp-sw.mjs`)
  that must run before `next build` — it stamps the service-worker cache id.

### 1.2 Gotchas a future engineer must know

- **Single Node process ⇒ per-instance memory is a lie at scale.** Our rate
  limiters (`__coachHits`, `__intakeHits`) and the pg `Pool` are stored on
  `globalThis`. That's correct for one instance and survives dev HMR, but the
  moment you run more than one Railway replica, **rate limits and AI-spend caps
  become per-instance** (a user gets N× the budget) and any future in-memory
  `use cache` won't be shared. Move counters to Postgres/Redis before scaling out.
- **We forgo most of the App Router's superpowers.** Because the UI is one big
  `"use client"` tree hydrated via `fetch('/api/...')`, we get none of RSC's
  server-side data-fetching, streaming, or `use cache` benefits, and the initial
  payload is a client bundle + a waterfall of API calls. That's a deliberate
  simplicity trade, not a bug — but don't cargo-cult "add `use cache`" onto a
  client component; it won't apply.
- **Don't reach for `middleware.ts`.** It's `proxy.ts` now. A `middleware.ts`
  may silently do nothing on 16.

---

## §2 — PWA architecture: install, update, offline, sync, push

AmaTri is an **installable PWA** (README: "no App Store required"). This is a
strategic moat (ship instantly, no 30% tax, no review gate) *and* a set of hard
constraints — especially on iOS.

### 2.1 Manifest & install
`app/manifest.ts` returns a `MetadataRoute.Manifest` served at
`/manifest.webmanifest`: `display: "standalone"`, portrait, categories
`["health","fitness","sports"]`, maskable + any icons. `app/layout.tsx` adds
`appleWebApp` metadata and Apple touch icons. Solid and standards-correct.

- **A11y nit:** the viewport sets `maximumScale: 1, userScalable: false`, which
  disables pinch-zoom — an accessibility problem (WCAG 1.4.4). Reconsider.

### 2.2 Service worker & update lifecycle (this part is done well)
We hand-write `public/sw.js` (no Workbox/next-pwa). Strategy:

- **Network-first, cache-fallback** for same-origin GETs; **never caches `/api/`**
  (correct — you don't want stale/authenticated JSON in the CDN-less SW cache).
- **Cache-busting on every deploy:** `scripts/stamp-sw.mjs` (a `prebuild` step)
  rewrites `const CACHE = "amatri-<gitSha|timestamp>"` so the worker's bytes
  change each deploy and the browser installs the new one; `activate` deletes old
  caches and `clients.claim()`s.
- **`components/ServiceWorker.tsx`** registers with `updateViaCache: "none"` (the
  worker script is never served from HTTP cache), re-checks for updates **on every
  `visibilitychange`** (the reliable mitigation for iOS freezing standalone PWAs
  for days), and reloads once on `controllerchange` — guarded so a first install
  doesn't spuriously reload and a `refreshing` flag prevents reload loops. This is
  the genuinely hard part of PWAs and it's handled thoughtfully.

### 2.3 The offline gap (the real weakness for a training app)
The premise — *"athletes train in dead zones"* — is **not currently met**:

- The SW caches the **app shell** but, by design, **never caches `/api/`**. On a
  cold load with no signal, the athlete gets the shell but **no plan data**.
- There is **no IndexedDB**, **no Background Sync** (`sw.js` has no `sync` /
  `periodicsync` handler), and **no offline write queue**. `lib/notify.ts` uses
  `localStorage` only for notification prefs; plan state is not persisted client-
  side for offline read.
- **Conflict resolution is last-write-wins with no guard.** `apiSaveState` PUTs
  the *entire* `{profile, plan}` blob to `/api/state`, which overwrites the row
  unconditionally (no version, etag, or `updatedAt` precondition). **Two devices
  or two tabs silently clobber each other.** For an offline-first training app you
  want: (a) hydrate the plan into IndexedDB, (b) queue mutations offline, (c)
  reconcile with a version token / per-workout merge on reconnect.

**Recommended target:** cache the plan JSON into IndexedDB on load; serve it
offline read-only; queue "mark done / skip / move / readiness" mutations in an
outbox and flush via Background Sync (where supported) or on next foreground;
add optimistic-concurrency (`updatedAtISO` precondition) to `/api/state` and
merge at the workout level rather than blob level.

### 2.4 Push notifications — and the iOS reality
- `sw.js` has a `push` handler **ready** (parses a JSON payload, shows a
  notification) but there is **no server-side VAPID sender** wired up. So server
  push is currently inert.
- Local reminders (`lib/notify.ts`) use the **Notification Triggers API**
  (`TimestampTrigger`) to fire even when the app is closed — but that's
  **Chromium/Android only**. It is feature-detected and stays **dormant on iOS
  Safari and Firefox** (deliberately — no foreground noise).
- **iOS web push facts:** supported only on **iOS/iPadOS 16.4+**, only for a PWA
  **installed to the Home Screen** (never from a Safari tab), and only after a
  **user gesture** triggers the permission prompt. A Web App Manifest is
  mandatory. Practically, **notifications reach only Android today** and, on iOS,
  only the subset of users who installed to Home Screen. Plan re-engagement around
  that, and wire a real VAPID sender when push becomes a priority.

---

## §3 — Reliability, scale & security posture (grounded in the code)

Honest assessment of what's **solid**, what's a **gap**, and what's a **risk**,
read straight from the repo. Files: `lib/db.ts`, `lib/auth-server.ts`,
`lib/strava.ts`, `lib/ai.ts`, `app/api/**`, `next.config.ts`, `railway.json`.

### 3.1 Postgres & connection management
- **Pool:** `new Pool({ connectionString, ssl, max: 5 })`, singleton on
  `globalThis`. One instance × 5 is fine. **No PgBouncer.** Railway's own guidance
  is that **production Postgres should sit behind PgBouncer (transaction mode)**,
  and that migrations/`CREATE INDEX CONCURRENTLY` should use the **unpooled**
  connection. If we ever run multiple replicas, `replicas × 5` can exhaust
  Railway Postgres `max_connections`; put PgBouncer in front first.
- **TLS:** `ssl: { rejectUnauthorized: false }` — encrypted but **certificate
  verification is disabled**, a theoretical MITM on the external `*.rlwy.net`
  proxy path. Internal `*.railway.internal` is a private network (safe). Prefer
  the internal host, or verify the CA. Health data over an unverified TLS chain is
  a weak look in an audit.
- **No migrations.** `PgStore.init()` runs `CREATE TABLE IF NOT EXISTS` on first
  query. There is **no `ALTER`, no versioning, no rollback**. The first time a
  column needs to change you're hand-editing production. Adopt a migration tool
  (node-pg-migrate / drizzle-kit / Prisma Migrate) run on deploy via the unpooled
  URL. **This is a scaling blocker.**

### 3.2 Data model & indexing
- **Everything-in-one-JSONB.** `users.data` holds `{ profile, plan }` — the whole
  periodized plan and every workout, including buried health fields (HR,
  readiness, injuries). Pros: atomic, dead simple. Cons that bite later:
  1. **Write amplification** — every "mark done" rewrites the entire plan JSON.
  2. **No cross-user querying** — you cannot compute time-series analytics,
     cohort stats, or "activities in the last 30 days" in SQL; it's all in JSON.
  3. **Strava activities aren't rows** — they're matched *into* the plan blob and
     otherwise discarded. There is no `activities` table to index or analyze.
  4. **Health metrics are unindexed** inside JSON.
- **Indexes:** only PKs, `UNIQUE(username_lower)`, `UNIQUE(athlete_id)`. Notably
  `listUsersLite` does `ORDER BY created_at DESC LIMIT` with **no index on
  `created_at`** (seq scan), and **the social feed loads up to 500 users' full
  `data` blobs into memory** and derives cards in JS (`lib/social.ts`). That's
  O(users) memory + CPU **per feed request** — fine for a friend group, a wall at
  a few thousand users.
- **Target for scale:** a real `activities` / `workouts` table keyed and indexed
  on `(user_id, date)` for time-series reads; keep the plan blob for the plan
  itself but denormalize completions/metrics into rows for analytics and feeds.

### 3.3 Backups / PITR
Railway supports **Point-in-Time Recovery** (WAL archiving via pgBackRest,
weekly full + daily incrementals, ~4-week window). Nothing in-repo indicates
it's enabled. **A health-data app must enable PITR and periodically test a
restore.** Snapshot-only, single-instance Postgres is a *development* database.

### 3.4 Webhook / device ingestion reliability (mostly good)
`app/api/strava/webhook/route.ts` + `lib/strava.ts`:
- **Idempotent:** `applyActivityToUser` no-ops if the same `activityId` already
  completed the workout — update/retry events are safe. ✔
- **Always 200s** so Strava won't disable the subscription; **missed events are
  covered by a manual "Sync" backfill** and a 14-day backfill on connect. ✔
- **Subscription verification** uses `hub.verify_token` against
  `STRAVA_WEBHOOK_VERIFY_TOKEN`. ✔
- **Gaps:** the handler does a **synchronous token-refresh + Strava fetch + DB
  write inside the request** (Strava wants a 200 within ~2s; usually fine, but a
  slow Strava call risks a timeout, and there's **no queue, no retry, no
  dead-letter**). There is **no async job runner anywhere** — all work is inline.
  At volume, move ingestion to a queue keyed by `activityId` (idempotency key)
  with retries + DLQ. Note also Strava **webhooks are unsigned** (no HMAC) — the
  POST endpoint is effectively open, but self-limiting (it only ever fetches a
  *real* activity for a *known* athlete via our stored token). Low risk; add a
  rate limit and consider egress-IP allow-listing if Strava publishes ranges.

### 3.5 Background jobs & observability
- **Background jobs:** none. Strava token refresh is **lazy** (on next use, if
  within 60s of expiry). No cron for proactive refresh, cleanup, reminders, or
  re-engagement.
- **Observability:** effectively none. No structured logging, no error tracking
  (Sentry/equiv), no metrics/tracing. The only health signal is Railway's `/`
  healthcheck (`railway.json`). Worse, **errors are largely swallowed** by empty
  `catch {}` blocks (great for resilience — the webhook never blocks the 200 — but
  it means failures are **invisible**). Add error tracking + structured logs
  (PII-scrubbed) + basic RED metrics (rate/errors/duration) before you have users
  you can't afford to disappoint silently.

### 3.6 AuthN / AuthZ (`lib/auth-server.ts`)
- **Solid parts:** password hashing is **scrypt** with a per-user salt and a
  **timing-safe compare**; the session is an **HMAC-SHA256-signed** token in an
  **httpOnly, SameSite=Lax, Secure-in-prod** cookie (60-day TTL); SQL is fully
  parameterized. Good bones.
- **🔴 P0 — session-secret fallback chain.**
  `secret() = SESSION_SECRET || DATABASE_URL || "amatri-dev-secret-change-me"`.
  - If `SESSION_SECRET` is unset in prod, the signing key becomes the
    **`DATABASE_URL`** — a value that's shared with other subsystems, more likely
    to leak (logs, error text, subprocessor dashboards), and whose rotation would
    silently invalidate every session.
  - If **neither** is set, the signing key is a **public, hard-coded string** —
    anyone can forge a valid session token for *any* `userId` ⇒ **full account
    takeover**. **Require `SESSION_SECRET` and fail closed if it's missing.**
- **🔴 No session revocation.** Stateless tokens can't be invalidated. Logout only
  clears the cookie; a **stolen token stays valid for 60 days**, and changing a
  password doesn't log other sessions out. Add a per-user `token_version` (stored
  int, embedded in the payload, bumped to revoke) or move to server-side sessions.
- **🔴 No auth rate limiting / lockout.** `/api/auth/login` and `/signup` have
  **zero** throttling ⇒ open to **credential stuffing / brute force**. (The crude
  in-memory limiters on `coach`/`intake` key on an *authenticated* uid and reset
  on restart — they don't help here.) Add IP + account throttling with backoff.
- **`scryptSync` blocks the event loop.** Password hashing is synchronous on the
  single Node thread (~50–100ms each). A burst of logins is a trivial **DoS** and
  tanks p99. Switch to async `crypto.scrypt`.
- **Weak password policy:** min length **6**, no breach check. Raise to ≥8–12 and
  check against HIBP (k-anonymity) or run zxcvbn.
- **CSRF:** we rely solely on `SameSite=Lax`. That blocks cross-site state-changing
  POST/PUT for the JSON API (largely OK), but add defense-in-depth (verify
  `Origin`/`Sec-Fetch-Site`, or CSRF tokens).

### 3.7 Application security (rest of the surface)
- **🔴 Strava tokens stored in plaintext.** `strava_connections` holds the access
  **and refresh** tokens as bearer credentials to *all* of an athlete's private
  activities (`activity:read_all`). A DB dump = every linked athlete's Strava
  exposed. **Encrypt at the app layer (AES-GCM with a KMS/env key)** or accept and
  document the risk.
- **No input-schema validation on `/api/state`.** The PUT stores arbitrary
  `profile`/`plan` JSON with no schema and no size cap, then downstream code
  trusts the shape (`as Plan`). A malicious client can stuff huge/nested JSON into
  its own row (storage abuse / self-DoS). Add zod/valibot validation + a byte cap.
  (Credit: `coach`/`intake`/`state` do string-cast and length-clamp their text
  inputs — keep that discipline and extend it to structure.)
- **No security headers.** `next.config.ts` has no `headers()` ⇒ **no CSP, HSTS,
  X-Frame-Options/`frame-ancestors`, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy**. The fork even ships a CSP guide in its docs. Add them
  (CSP first). Since there's no `proxy.ts`, set them via `next.config.ts`
  `headers()`.
- **Secrets:** env vars on Railway; `.env*` is gitignored; no secrets in the repo.
  ✔ Add a rotation policy and *require* `SESSION_SECRET`.
- **Supply chain:** tiny dep tree (`next`, `react`, `pg`, `openai`,
  `@anthropic-ai/sdk`). Turn on Dependabot + `npm audit` in CI. Note
  **`@anthropic-ai/sdk` is installed but unused** (see §3.8) — drop it or wire it.

### 3.8 The LLM path — what's actually happening (and the doc mismatch)
- **README/package advertise "Claude Haiku 4.5" via `@anthropic-ai/sdk`. Reality:
  `lib/ai.ts` uses the `openai` SDK pointed at Google Gemini's OpenAI-compatible
  endpoint (`gemini-3.5-flash-lite`) by default; the Anthropic SDK is never
  imported.** So the coach and intake actually call **Google**. Fix the docs to
  match reality, then make a deliberate provider choice — because the provider's
  data-use terms are a compliance question (§4.7), not a detail.
- **What leaves our server:** `/api/intake` sends the athlete's **free-text injury
  / medical description** (Article-9 health data) to the LLM to parse into
  structured constraints; `/api/coach` sends "athlete context" (up to 4000 chars:
  race, level, phase, today's session — which can include injuries/HR/readiness).
  **Special-category health data crosses to a third party.** That's allowed *only*
  with the right tier, a DPA, consent, and disclosure (§4.7).

### 3.9 What breaks at 1k → 100k → 1M users
- **~1k:** fine. One instance, `pg max: 5`, in-memory limiters all OK.
- **~100k:** the **social feed** (loading 500 full blobs per request) is already
  strained; **`scryptSync`** serializes logins on one CPU; a single instance
  can't hold the concurrency, but scaling out **breaks in-memory rate limits /
  AI-spend caps** and **multiplies pg connections**. You need, roughly in order:
  PgBouncer; an `activities`/completions table with indexes; rate-limit + AI-spend
  counters in Postgres/Redis; a background queue for Strava ingestion; a read path
  for the feed that doesn't load whole blobs; async `scrypt`.
- **~1M:** partitioned/time-series storage for activities, read replicas, pooled
  & possibly sharded connections, CDN for the static shell (already cacheable), a
  proper async ingestion pipeline with DLQ, **per-region data residency for EU
  users** (§4.1), and hard cost controls on the LLM.

---

## §4 — Health-data privacy & compliance (the legally serious part)

**What we hold that is health / health-adjacent:** injuries (free-text +
severity), heart rate (`avgHr`, `restingHr`, `maxHR`), readiness (sleep, legs,
energy), RPE, and Strava-derived pace/HR/power. If we add HRV/sleep from
wearables it's even more clearly health data. Treat all of it as sensitive.

### 4.1 GDPR — health data is "special category" (Article 9)
- Health/fitness data from trackers is **special-category data** under **Art. 9**
  and needs **two** legal tests satisfied at once: an **Art. 6** lawful basis
  **and** an **Art. 9(2)** condition. For a consumer app the realistic Art. 9
  condition is **explicit consent** — a clear, affirmative, *specific* act,
  **separate from and not bundled into** the ToS/privacy policy, referencing the
  health processing. A checkbox buried in signup is not enough.
- **Data-subject rights** (access, portability/export, erasure, rectification,
  objection). **AmaTri implements none** — there is no account-deletion endpoint,
  no data export, and logout doesn't delete anything. This is a gap to close
  before EU launch.
- **Subprocessor DPAs** required with everyone who touches the data: **Railway**
  (hosting/DB), **Strava** (source), and **the LLM provider**.
- **Data residency / transfers.** Railway Postgres is US-hosted by default; EU→US
  personal-data transfers need a valid mechanism (adequacy / SCCs) — or run an **EU
  region** for EU users. Decide before you market in the EU.
- **Breach notto the supervisory authority within 72 hours.**

### 4.2 UK GDPR / others
UK GDPR mirrors the above. If you localize, expect analogous regimes (e.g.
Canada PIPEDA — note our race catalog leans North American).

### 4.3 CCPA / CPRA (California)
Health data is **"sensitive personal information."** Obligations: notice at
collection; right to know/delete/correct; **honor opt-out of "sale"/"share"**
(don't sell, and treat ad-tech "sharing" as covered); honor **Global Privacy
Control** signals. Even if we're under the current revenue/volume thresholds,
**design for it now** (deletion + export are the same work GDPR needs).

### 4.4 HIPAA — almost certainly does NOT apply (but know the nuance)
A **direct-to-consumer** fitness app that users download themselves is **not a
Covered Entity**, and without a **Business Associate Agreement (BAA)** it is not a
Business Associate — so **HIPAA does not apply**, *even though we hold HR and
injury data*. The same heart-rate reading is PHI in a hospital's hands and *not*
PHI in a consumer app with no Covered-Entity relationship. **The nuance:** HIPAA
*would* attach if AmaTri contracts with a provider/health plan (corporate-wellness
prescribed by a clinic, remote patient monitoring, care coordination) and signs a
BAA. If a B2B2C health deal ever appears, revisit this — it changes everything.

### 4.5 FTC Health Breach Notification Rule (the US sleeper — this DOES apply)
This is the one people miss. The FTC's **2024 amendment** (final rule
Apr 26 2024, **effective July 29 2024**) explicitly pulls **health apps** not
covered by HIPAA **into scope** as "vendors of personal health records." Two
things make it dangerous for us:
1. **A "breach" is not only a hack.** It includes an **unauthorized
   *disclosure*** — e.g. sending health data to third parties (**ad SDKs,
   analytics, or an LLM**) without the user's authorization. That is exactly the
   theory the FTC used against **GoodRx ($1.5M)** and **BetterHelp ($7.8M)** for
   piping health data to Facebook/Google for ads, and against **Flo Health**.
2. **Notification duties:** on a breach of **≥500 records**, notify the **FTC and
   consumers without undue delay, no later than 60 days**, and notify the media.
- **Implications for AmaTri, concretely:**
  - **No ad-tech / analytics SDKs on any screen that sees health data.** No
    Meta/Google pixels, no session-replay that captures injuries/HR.
  - **Our LLM disclosure must be *authorized*** — i.e. consented and disclosed —
    or it is itself a reportable "breach." (See §4.7.)
  - **Have a breach-notification runbook** (who decides, 60-day clock, FTC + user
    + media templates) *before* you need it.

### 4.6 Apple / Google platform policy — advantage today, guardrail tomorrow
- AmaTri is a **PWA, not App-Store distributed**, so **Apple App Store / Google
  Play health-data review does not gate us today**. That's a genuine advantage
  (ship fast, no review) — but also means **no platform guardrail**, so §4.1–4.5
  discipline is entirely on us.
- **If we ever wrap it natively or touch HealthKit / Health Connect:** Apple
  **forbids using health/fitness data for advertising or use-based data mining**,
  **bars sharing HealthKit data with third parties** except to provide
  health/fitness services *with consent*, and **prohibits storing health data in
  iCloud**. Google Play has parallel sensitive-data / Health Connect rules.
  **Design to these now** so a future native app isn't rejected.

### 4.7 Wearable-provider terms + sending health data to an LLM
- **Strava's API Agreement forbids using API-derived data to train or operate AI.**
  This became explicit **Nov 11 2024** and was **broadened June 1 2026** to cover
  training, fine-tuning, RAG, **embedding generation**, **"ingestion into a
  context window or working memory,"** evaluation/benchmarking, and inference —
  essentially any AI use. Strava also restricts showing a user's data to **only
  that user**, and protects its look/feel. **Consequence:** keep **Strava-derived
  fields (pace/HR/power/activity names) out of any LLM prompt, context window,
  training set, or eval.** The coach context must be built from *our* plan/profile
  data, not from Strava-sourced actuals.
- **LLM provider data-use — pick the right tier + a DPA.**
  - **Google Gemini (our current default):** on the **free** API tier, prompts and
    responses **may be used to improve Google's products, including human review**.
    On the **paid** tier, data is **not** used for training and is covered by a
    DPA. **Sending injury/health free-text to the *free* Gemini tier is a GDPR
    (no Art. 9 basis, no DPA, likely non-EEA transfer) and FTC-HBNR problem.**
  - **Whatever provider we choose** (Gemini paid, OpenAI, or actually wiring the
    installed Anthropic SDK), we need: a **paid/enterprise tier with a signed
    DPA**, a **no-training / zero- or short-retention** data path, prompt-logging
    / human-review **disabled** where offered, and the subprocessor **listed in
    the privacy policy**.
  - **Data minimization at the source:** don't send raw injury free-text if a
    derived structured constraint would do. `/api/intake`'s whole job is to parse
    free-text, so there consent + paid tier + DPA are **mandatory**, not optional.

### 4.8 Encryption, retention, deletion, consent (baseline hygiene)
- **In transit:** HTTPS everywhere (Railway terminates TLS). Fix the DB TLS cert
  verification (§3.1).
- **At rest:** Railway Postgres volume encryption + **app-layer encryption of the
  Strava tokens** (§3.7). Consider field-level encryption for injury notes.
- **Retention & deletion:** define a retention schedule and build **hard-delete**
  (users row + `strava_connections` + `follows` + `kudos`, and **revoke the Strava
  grant** on disconnect/delete). None of this exists yet.
- **Consent:** a real, unbundled health-data consent step (§4.1), a versioned
  privacy policy, and a consent record per user.

### 4.9 ✅ Compliance checklist for a health-adjacent consumer app
Treat this as the gate before EU/US growth. (☐ = not done / unknown in-repo.)

**Legal basis & consent**
- ☐ Explicit, unbundled **health-data consent** step (GDPR Art. 9), recorded &
  versioned.
- ☐ Public **privacy policy** naming data collected, purposes, retention, and
  **every subprocessor** (Railway, Strava, LLM provider).
- ☐ Cookie/analytics consent where applicable; **no ad-tech on health screens**.

**Data-subject / consumer rights**
- ☐ **Account deletion** (hard delete across all tables + Strava revoke).
- ☐ **Data export / portability** (machine-readable).
- ☐ Rectification + objection paths; honor **GPC** for CCPA.

**Subprocessors & transfers**
- ☐ Signed **DPA with Railway**, **Strava** terms accepted & abided, **LLM DPA**.
- ☐ **LLM on a paid/no-training tier**; prompt logging/human-review off.
- ☐ **No Strava-derived data** in any LLM prompt/training/eval.
- ☐ **EU data residency** decided (EU region or SCCs) before EU marketing.

**Security controls**
- ☐ `SESSION_SECRET` **required**; forged-token fallback removed.
- ☐ **Auth rate limiting / lockout**; async `scrypt`; stronger password policy.
- ☐ **Session revocation** (token version) + logout-all on password change.
- ☐ **Strava tokens encrypted at rest**; DB TLS cert verification on.
- ☐ **Security headers** (CSP, HSTS, frame-ancestors, etc.).
- ☐ **Input schema validation** + size caps on `/api/state`.
- ☐ **PITR enabled** + a tested restore; encrypted backups.
- ☐ **Error tracking + PII-scrubbed structured logs**; breach-detection signal.

**Incident readiness**
- ☐ **Breach-notification runbook** (FTC HBNR 60-day clock; GDPR 72-hour clock).
- ☐ Owner assigned for privacy/security; DPO/EU rep if required at scale.

---

## §5 — Prioritized reliability / security / compliance backlog

**🔴 P0 — do before real users / any EU or paid launch (security & legal blockers)**
1. **Require `SESSION_SECRET`; delete the `DATABASE_URL` / hard-coded fallback**
   and fail closed if missing (`lib/auth-server.ts`). *Forged-token account
   takeover.*
2. **Rate-limit + lock out `/api/auth/login` & `/signup`** (IP + account,
   backoff). *Credential stuffing.*
3. **Switch to async `crypto.scrypt`.** *Event-loop DoS on every login.*
4. **Health-data consent + privacy policy + subprocessor list**, and **move the
   LLM to a paid/no-training tier with a DPA** (or disable AI until then).
   *GDPR Art. 9 + FTC HBNR — the LLM disclosure is otherwise a reportable breach.*
5. **Account deletion + data export** (GDPR/CCPA rights); revoke Strava on delete.

**🟠 P1 — near-term hardening**
6. **Encrypt Strava tokens at rest**; fix DB TLS (`rejectUnauthorized` / use
   internal host).
7. **Security headers** via `next.config.ts` `headers()` (CSP, HSTS,
   `frame-ancestors`, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
8. **Schema-validate `/api/state`** (zod/valibot) + byte cap on the blob.
9. **Adopt a migration framework**; stop relying on `CREATE TABLE IF NOT EXISTS`.
10. **Error tracking (Sentry) + structured, PII-scrubbed logs**; stop swallowing
    errors blindly. Add a `/health` (or `/api/health`) endpoint that checks DB.
11. **Session revocation** (per-user `token_version`) + logout-all on password
    change.
12. **Enable PITR** and run a restore drill.
13. **Fix the docs/reality mismatch:** README/package say Claude Haiku; code calls
    Gemini. Decide, wire, and document one provider (drop `@anthropic-ai/sdk` if
    unused).
14. **Keep Strava-derived data out of LLM prompts** (Strava API terms).

**🟡 P2 — scale & product-reliability**
15. **PgBouncer** (transaction mode) in front of Postgres; migrations on the
    unpooled URL.
16. **Real `activities` / completions table** indexed on `(user_id, date)`;
    denormalize metrics out of the JSONB blob for analytics & feeds.
17. **Rewrite the social feed** so it doesn't load 500 full `data` blobs per
    request; move rate-limit + AI-spend counters to Postgres/Redis (shared across
    replicas).
18. **Background queue for Strava ingestion** (idempotency key = `activityId`,
    retries, dead-letter); proactive token refresh cron.
19. **Offline-first PWA:** IndexedDB plan cache, mutation outbox + Background Sync,
    **optimistic concurrency on `/api/state`** (per-workout merge, kill
    last-write-wins).
20. **Wire real Web Push** (VAPID sender) with the iOS 16.4 install-to-home-screen
    constraints in mind; re-enable the dormant push path in `sw.js`.
21. **EU region / data residency** for EU users; per-region storage.
22. **A11y:** stop disabling pinch-zoom (`maximumScale`/`userScalable`).
23. **CI:** Dependabot + `npm audit`; typecheck + the engine test in the pipeline.

---

## §6 — Sources

**Next.js 16 (this fork)** — read `node_modules/next/dist/docs/` first; key files:
`01-app/01-getting-started/16-proxy.md` (Middleware → Proxy), `.../08-caching.md`
(Cache Components / PPR / `use cache`), `.../15-route-handlers.md`,
`.../17-deploying.md`, `index.md`.

**FTC Health Breach Notification Rule (2024)**
- [FTC — Health Breach Notification Rule (rule page)](https://www.ftc.gov/legal-library/browse/rules/health-breach-notification-rule)
- [FTC — Updated HBNR protects users of health apps and devices (Apr 2024)](https://www.ftc.gov/business-guidance/blog/2024/04/updated-ftc-health-breach-notification-rule-puts-new-provisions-place-protect-users-health-apps)
- [Federal Register — Health Breach Notification Rule final rule](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule)
- [FTC — GoodRx enforcement (health data to Facebook/Google)](https://www.ftc.gov/news-events/news/press-releases/2023/02/ftc-enforcement-action-bar-goodrx-sharing-consumers-sensitive-health-info-advertising)
- [Venable — Final changes to the HBNR (analysis)](https://www.venable.com/insights/publications/2024/07/final-changes-to-health-breach-notification)

**GDPR (health / special-category)**
- [GDPR Art. 9 special categories — lawful processing guide](https://secureprivacy.ai/blog/gdpr-article-9-special-categories-lawful-processing-and-compliance-guide-2026)
- [GDPR consent requirements for health data](https://www.themomentum.ai/blog/gdpr-consent-requirements-health-data)
- [GDPR for wearable technology](https://gdprlocal.com/gdpr-for-wearable-technology/)

**HIPAA & consumer fitness apps**
- [Do fitness apps need to be HIPAA compliant? (when it does/doesn't apply)](https://www.accountablehq.com/post/do-fitness-apps-need-to-be-hipaa-compliant-when-it-applies-and-when-it-doesn-t)
- [App users beware — most fitness/wellness apps aren't covered by HIPAA (HHS FAQs)](https://www.dickinson-wright.com/news-alerts/app-users-beware)

**Apple / platform health-data policy**
- [Apple — protecting access to users' health data](https://support.apple.com/guide/security/protecting-access-to-users-health-data-sec88be9900f/web)
- [App Store requirements for health apps](https://blog.dashsdk.com/app-store-requirements-for-health-apps/)

**PWA / iOS push**
- [PushEngage — setting up web push on iOS/iPadOS (16.4+, home-screen install)](https://www.pushengage.com/documentation/setting-up-web-push-notifications-for-ios-ipad/)
- [MobiLoud — PWA push notifications on iOS & Android](https://www.mobiloud.com/blog/pwa-push-notifications)

**Railway / Postgres production**
- [Railway — PostgreSQL connection pooling (PgBouncer)](https://docs.railway.com/databases/postgresql-pgbouncer)
- [Railway — Point-in-Time Recovery](https://docs.railway.com/volumes/point-in-time-recovery)

**Strava API terms (AI restriction)**
- [Strava — updates to the API Agreement](https://press.strava.com/articles/updates-to-stravas-api-agreement)
- [Strava — API Agreement (2026)](https://www.strava.com/legal/api)
- [TechRepublic — Strava tightens API access as AI scraping concerns grow](https://www.techrepublic.com/article/news-strava-api-scraping-crackdown/)

**LLM provider data-use terms**
- [Gemini API free vs paid tier data usage](https://docs.bswen.com/blog/2026-03-23-gemini-free-tier-data-privacy/)

**Cross-references (sibling knowledge docs)**
- `03-injury-and-load-management.md` — the injury model whose free-text we send to
  the LLM (§3.8, §4.7).
- `05-wearable-and-data-ecosystem.md` — Strava/wearable ingestion, whose terms
  (§4.7) and reliability (§3.4) this doc governs.
- `06-behavioral-science-and-retention.md` — notifications/re-engagement, bounded
  by the PWA/iOS-push limits in §2.4.
- `07-product-and-ux-design.md` — consent UX (§4.1/§4.9) and the a11y viewport nit
  (§2.1) live at the product surface.
