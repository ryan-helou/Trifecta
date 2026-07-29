# The Wearable & Data Ecosystem — how Trifecta gets real athlete data

> **What this is.** Trifecta's plan engine ([lib/planEngine.ts](../../lib/planEngine.ts)) is
> only as good as the data it adapts to. To be genuinely *injury-aware* and
> *readiness-adaptive* — the whole thesis versus Runna
> ([docs/research/runna-competitive-analysis.md](../research/runna-competitive-analysis.md)) —
> we need reliable, broad ingest of what the athlete actually did (workouts, HR, power,
> pace) and how recovered they are (HRV, resting HR, sleep). This document is the standing
> reference for the entire wearable & data-integration surface: every platform's API and
> its gotchas, the file formats, the aggregators, the honest build-vs-buy math, and — the
> part that constrains everything — the fact that **Trifecta is a PWA and the best device
> data effectively requires a native app or a partner approval we don't have yet.**
>
> Sync breadth and reliability are an unglamorous but real moat. Runna's own edge is deep
> device integration (Apple Watch + Garmin + Strava). This is where we either match them or
> get out-competed on data quality.
>
> **Compiled:** 2026-07-22. **Method:** primary developer docs (Strava, Garmin, Apple,
> WHOOP, Oura, Polar, COROS, Suunto, Wahoo, TrainingPeaks, Zwift), 2024–2026 industry
> reporting on the Strava API changes and the Garmin program suspension, aggregator pricing
> pages and independent build-vs-buy analyses, plus a code read of our current Strava
> ingest. Fast-moving facts are dated and flagged. Sources are listed at the end and cited
> inline as `[n]`.

---

## 0. TL;DR — the 14 things that actually matter

1. **We are Strava-only today, and that is a single point of failure.** One OAuth
   connection to Strava covers most users because Garmin/COROS/Wahoo/Apple Watch all sync
   *into* Strava. But if a user doesn't push to Strava — or Strava tightens further — we
   get nothing. See §9 for the honest state of our code.
2. **Strava changed its API agreement on 11 Nov 2024 in two ways that matter to us:**
   (a) a third-party app may **only display a user's Strava data back to that same user**
   — never to another user; and (b) **no using Strava API data to train AI/ML models.**
   Strava says <0.1% of apps are affected and that coaching/analytics tools that show data
   only to the athlete are fine. We are fine *today* but this constrains our social feed
   and any future ML. `[1][2][3]` (§3)
3. **Apple HealthKit has no server API — at all.** It is on-device only. The *only* way to
   read Apple Watch HR/HRV/sleep/workouts is a **native iOS app** running on the user's
   phone that reads HealthKit and uploads it. A PWA fundamentally cannot. This is the
   single biggest structural constraint on Trifecta's data strategy. `[4][5]` (§1.3, §8)
4. **Garmin is the gatekeeper of the best multisport data, and the gate is shut.** The
   Garmin Connect Developer Program has been **on hold since ~2024/2025 — new applications
   are not being accepted** as of mid-2026. Existing partners keep working; new entrants
   (us) can't get direct Garmin access right now. This alone is a strong argument for an
   aggregator. `[6][7]` (§1.2)
5. **Aggregators (Terra, Junction/Vital, Spike, Rook, Sahha) exist precisely to solve #3
   and #4.** They hold the Garmin/Apple partnerships, ship the iOS SDK that reads
   HealthKit, and normalize 300–500+ sources behind one API. For a small team below
   ~10k–20k active users, buying is **3–5× cheaper** than building. `[8][9]` (§5, §6)
6. **We ingest summary data only, not streams.** We read Strava's activity summary
   (distance, moving time, avg HR, avg power) — never the per-second HR/power/pace/GPS
   *streams*. So we can't compute normalized power, TSS-from-power, HR decoupling, or true
   intensity distribution. Calibration runs off **avg HR vs zone** only. (§7, §9)
7. **We ingest zero recovery data.** No HRV, no resting-HR trend, no sleep. Our morning
   readiness check-in is a subjective 1–3 tap on sleep/legs/energy
   ([lib/types.ts](../../lib/types.ts) `ReadinessInput`). For a "readiness-adaptive" app
   this is the highest-leverage gap — and Oura/WHOOP/Garmin are where that data lives. (§7)
8. **`lib/fit.ts` is a FIT *encoder*, not a decoder.** It builds structured-workout `.FIT`
   files to *push to a watch* — it does **not** parse activity FIT files coming back. We do
   not currently ingest any file format. "Can parse FIT" is aspirational, not real. (§4, §9)
9. **FIT is the richest format; TCX and GPX are lossy fallbacks.** FIT is Garmin's binary
   format with developer fields, per-record power/HR/cadence/GPS, and lap/session
   structure. TCX (XML) drops developer fields and needs an extension for power; GPX is
   position+time+elevation with HR/cadence only via a namespace extension and no power. (§4)
10. **Recovery devices are consumer-subscription and API-friendly.** WHOOP (v2 API, v1
    removed Oct 2025) and Oura (v2, OAuth-only since Dec 2025) both expose HRV, resting HR,
    sleep, and readiness/recovery via clean OAuth2 + webhooks — no partnership gate. These
    are the *easiest* high-value integrations to add after Strava. `[10][11]` (§1.4, §1.5)
11. **Dedup is a problem we don't have yet but will the moment we add a second source.**
    The same ride arrives via Garmin *and* Strava. Our `WorkoutActuals.source` is a
    hard-coded `"strava"` literal with no dedup logic. Multi-source needs an
    identity/precedence model. (§7)
12. **Everyone's webhooks are "a nudge, not a payload" — except Garmin.** Strava, Polar,
    Oura, WHOOP webhooks tell you *something changed*; you then fetch. Garmin pushes the
    full payload. Build ingest as: receive → enqueue → fetch → normalize → dedup → apply,
    idempotently, with backfill as the safety net. (§10)
13. **Rate limits are per-app and modest.** Strava: 200 req/15 min, 2,000/day (100 / 1,000
    for reads). Oura: 5,000/5 min. Plan ingest to be webhook-driven and batched, not
    polling loops. `[12][13]` (§1, §10)
14. **Recommendation:** keep Strava as the default hub, add **Oura + WHOOP** direct (cheap,
    no gate, unlocks readiness), and adopt an **aggregator (Terra or Junction)** to reach
    Garmin + Apple Health without a native app or the frozen Garmin program — then
    reconsider a native wrapper only if HealthKit depth becomes a wedge. (§6, §11)

---

## 1. The platforms and their APIs

Triathletes are the most device-heavy athletes in endurance sport. A typical Trifecta user
owns a **Garmin or COROS multisport watch**, maybe a **bike power meter + head unit
(Garmin/Wahoo)**, and increasingly a **recovery device (Oura ring or WHOOP band)**. Each
has its own API with its own auth model, delivery model, limits, and approval friction.

### 1.1 Strava — the hub (what we use today)

- **What you get.** Activities as a *summary* object (type/sport_type, distance,
  moving/elapsed time, avg/max HR, avg/weighted power, elevation, start time local + UTC)
  and, separately, **activity streams** (per-point time series: `heartrate`, `watts`,
  `velocity_smooth`, `cadence`, `altitude`, `latlng`, `temp`, `grade_smooth`) plus laps and
  segments. Strava is a *hub*: Garmin, COROS, Wahoo, Suunto, Polar and Apple Watch (via
  companion apps) all sync into it, so one Strava connection transitively covers most
  devices. This is exactly why our v1 chose it.
- **Auth.** OAuth 2.0, authorization-code flow, per-athlete access token (~6 h lifetime) +
  refresh token. Scopes: `read`, `read_all`, `activity:read`, `activity:read_all` (private
  activities), `activity:write`. We request `read,activity:read_all`
  ([lib/strava.ts](../../lib/strava.ts)).
- **Push vs poll.** **Webhooks (push-nudge).** One subscription per application. Strava
  POSTs a tiny event `{object_type, aspect_type: create|update|delete, object_id,
  owner_id}` — no activity body — and expects a **200 within ~2 s**; you then fetch the
  activity. Subscription is validated by a GET challenge handshake.
- **Rate limits (as of Jun 2026).** 200 requests / 15 min and 2,000 / day overall; a
  separate read ("non-upload") limit of 100 / 15 min and 1,000 / day. Per-application, not
  per-user. `[12]`
- **Cost.** Creating an API app now requires a **paid Strava developer subscription
  (~$12/mo)** — the only monetary cost, and a change from the historically free program
  (our own finding, recorded in [STRAVA_SETUP.md](../../STRAVA_SETUP.md)).
- **Gotchas.** (1) The Nov-2024 agreement (§3) — **no cross-user display of Strava data**
  and **no AI/ML training on it**. (2) Estimated vs real power: Strava returns
  `average_watts` even when it's a GPS-derived estimate; only trust it when
  `device_watts === true` (we gate on this). (3) `sport_type` (newer, granular) vs `type`
  (legacy) — read both. (4) Manual/duplicate uploads and privacy zones can distort GPS and
  distance. (5) Being a hub means **latency and lossiness**: data is only as fresh and rich
  as whatever the device pushed to Strava, and some fields (e.g. running power, HRV) don't
  survive the hop.

### 1.2 Garmin — the gatekeeper (and the gate is currently shut)

Garmin dominates serious triathlon (Forerunner, Fenix, Enduro, Edge). Its data is the
richest in the game — but access is the hardest.

- **Two API surfaces.** The **Health API** (daily wellness: steps, resting HR, **HRV**,
  stress, Body Battery, **sleep staging**, respiration, SpO2, VO2max, body composition) and
  the **Activity API** (activity summaries + **activity details / FIT-level samples**:
  per-record HR, power, cadence, GPS, running dynamics, swim stroke data). A separate
  **Training API** lets you *push* structured workouts and plans to Garmin devices. `[14]`
- **Auth.** **OAuth 1.0a** with HMAC-SHA1-signed requests — noticeably more painful than
  modern OAuth2, a real implementation cost. `[14]`
- **Push vs poll.** **Push, and unusually the payload is the whole thing.** Garmin POSTs
  full data payloads to per-data-type callback URLs when a user's device syncs — "Garmin
  delivers data to you rather than waiting for you to fetch it." (There is a Ping/Pull
  variant, but the summary push is the norm.) `[14]`
- **Rate limits / cost.** No published per-request limit or monetary fee for approved
  partners — **the cost is the approval, not dollars.**
- **Approval friction — critical.** Full server-side access requires joining the **Garmin
  Connect Developer Program / Health API partner program**, a manual review (historically
  ~2 business days to admit, 1–4 weeks to integrate). **But as of mid-2026 the program is
  ON HOLD: Garmin has suspended new sign-ups, removed the access-request form, and given no
  reopening date.** Existing partners keep working; new entrants cannot get in. `[6][7]`
  This is the crux of "Garmin is the gatekeeper": we cannot integrate Garmin directly right
  now even if we wanted to. The practical route to Garmin data today is **through an
  aggregator that already holds a Garmin partnership** (§5) — or via Strava as a hub, at
  reduced fidelity.

### 1.3 Apple HealthKit — the one that breaks the PWA model

Apple Watch is, alongside Garmin, the device most Trifecta users own — and Runna leans on it
heavily. But Apple's architecture is categorically different.

- **What you get (on device).** Workouts (with route, HR, active energy), heart rate,
  **HRV (SDNN)**, resting HR, VO2max, respiratory rate, **sleep stages**, cycle/mobility
  metrics — a very rich set, arguably the broadest passive dataset a normal user carries.
- **Auth / delivery.** **There is no server-side API. None.** No REST endpoint, no OAuth
  redirect, no server token. HealthKit data lives on the device and can only be read by
  **native iOS/watchOS code with the HealthKit entitlement and the user's per-type
  permission**, which then uploads whatever it read to your backend. `[4][5]`
- **The PWA implication (this is the whole point).** Trifecta is a PWA. **A PWA cannot touch
  HealthKit.** Safari/WebKit exposes no HealthKit bridge. So Apple Watch data is reachable
  *only* by (a) shipping a native/hybrid iOS app (or a thin native "health sync" companion),
  or (b) using an aggregator whose **iOS SDK** you embed in such a native shell, or (c)
  letting the user route Apple Watch → Strava via a third-party workout app and taking the
  lossy hub copy. There is no fourth option. This single fact shapes §6 and §8.
- **Gotcha.** Even with a native app, HealthKit background delivery is throttled and
  best-effort; you design for eventual, not real-time, sync, and dedup Apple Watch +
  iPhone double-counts (a notorious step/distance duplication problem `[8]`).
- **The entitlement is a promise App Review audits — guideline 2.5.1.** Shipping the
  HealthKit entitlement obliges you to *clearly identify the HealthKit functionality in the
  app's user interface*. This is not a metadata or privacy-policy requirement; a reviewer
  opens the app and looks for it. **Trifecta 1.0 (8) was rejected on exactly this
  (2026-07-29).** The cause was structural, not cosmetic: the Apple Health card was a child
  of the Strava component, whose first statement was `if (!status) return null` — `status`
  being the response to an unrelated Strava API call — so the only HealthKit UI in the
  product could silently fail to exist. It was additionally gated on an async
  availability probe, filed under a heading that said "Device sync", and placed at the
  bottom of the fifth tab. **Rules that follow:**
  - HealthKit UI must be a **top-level section that names itself** ("Apple Health"), never
    nested inside, or conditioned on, an unrelated integration's state.
  - It must render **before** authorization is granted and **whether or not** the
    availability probe succeeded — if HealthKit is genuinely unavailable, *say so* rather
    than removing the section, or the entitlement has no visible counterpart.
  - State the scope on screen: read-only, what types, and that nothing leaves the device.
  - Put the exact path (tab → section heading → on-screen copy) in **App Review Notes**.
    Ours previously ended with "Apple Health access is optional and not needed to review
    core features" — an instruction not to go looking, in the app then cited for not being
    findable.
  - Gate it: [maestro/health.yaml](../../maestro/health.yaml) signs in as the demo account
    Apple uses and asserts the section is present on Profile. It fails RED on the old code.

### 1.4 WHOOP — recovery/strain, API-friendly

- **What you get.** **Recovery score (with HRV and resting HR)**, sleep (stages,
  performance, need vs got), day **strain**, and workouts with HR zones. Exactly the
  readiness signal our engine wants.
- **Auth.** OAuth 2.0, authorization-code flow, **rotating refresh tokens** (each refresh
  invalidates the last — store carefully). No partnership gate — self-serve developer app.
- **Push vs poll.** Webhooks fire on new/updated sleep, workout, recovery (nudge → fetch by
  UUID).
- **Version note.** **v2 API is current; v1 and its webhooks were removed on 1 Oct 2025** —
  build straight to v2 (UUID-keyed resources, not the old cycle IDs). `[10]`
- **Gotcha.** WHOOP is a paid-subscription band, so penetration is lower than Strava/Apple
  but skews exactly toward the committed endurance athlete we serve.

### 1.5 Oura — readiness/sleep, the cleanest integration

- **What you get.** **Daily Readiness**, sleep (stages, latency, efficiency), **HRV
  (rMSSD)**, resting HR, body temperature deviation, SpO2, plus activity and workout
  records. The gold standard for morning-readiness signal.
- **Auth.** OAuth 2.0 only — **Personal Access Tokens were deprecated Dec 2025**, so new
  integrations must do the full OAuth flow. Scopes map to data categories (`daily`,
  `heartrate`, `workout`, `session`, `spo2`, `personal`, `ring_configuration`). `[11]`
- **Push vs poll.** Webhook subscriptions per `data_type`; events fire ~30 s after the ring
  syncs to the Oura phone app (so freshness depends on the user opening the app). Recommended
  primary transport.
- **Rate limits.** Generous: **5,000 requests / 5 min**, enforced both per-token and
  per-application. `[13]`
- **Gotcha.** Data only exists after the user's ring syncs via the Oura app — you can't pull
  ahead of that.

### 1.6 Polar — AccessLink

- **What you get.** Training sessions (with samples), **HRV / Orthostatic**, **Nightly
  Recharge**, sleep, continuous HR, daily activity.
- **Auth.** OAuth 2.0, pull-based.
- **Push vs poll.** Webhooks notify on a **new exercise / synced workout**, but you must
  still open a "transaction" and fetch the data (nudge model). **Dynamic rate limits that
  scale with your registered user count**, with `RateLimit-*` response headers. `[15]`
- **Gotcha.** Transaction/commit model is fiddlier than a plain GET; smaller triathlon
  share than Garmin/COROS.

### 1.7 COROS — growing fast in tri/ultra

- **What you get.** Workout/activity + training data from COROS watches (APEX, PACE,
  VERTIX), and you can **push structured workouts and training plans** back to the COROS app
  / Training Hub.
- **Auth.** OAuth 2.0. Requires submitting a **partner API application** (approval gate,
  but far lighter than Garmin's, and — crucially — **open**). `[16]`
- **Gotcha.** Younger API surface; documentation thinner than Garmin/Strava. But COROS is
  the fastest-growing serious-triathlon brand, so this matters more each year.

### 1.8 Suunto — via Azure API portal

- **What you get.** Activity, performance and GPS data; activity files carry HR, **R-R (for
  HRV)**, power, altitude, temperature, GPS.
- **Auth.** OAuth 2.0 authorization-code flow, via Suunto's Azure-hosted developer portal.
- **Gotcha.** Small user share; only worth it once the top-3 are done.

### 1.9 Wahoo — Cloud API (bike computers + trainers)

- **What you get.** Profile, HR/power zones, and workout **upload/download** for ELEMNT head
  units, KICKR smart trainers, and TICKR HR straps.
- **Auth.** OAuth 2.0.
- **Gotcha.** Bike-centric; most Wahoo activities also land on Strava, so the marginal value
  over the hub is low unless you want native structured-workout push to ELEMNT.

### 1.10 TrainingPeaks & Zwift — the workout-*push* side

These aren't primarily data *sources* for us; they're where structured workouts *go*.
- **TrainingPeaks Partner API:** approved commercial developers only (partners include
  Garmin, Polar, Wahoo, Zwift). Push structured workouts, pull completed ones; accepts
  `.fit/.tcx/.pwx`. Relevant if we ever want to publish Trifecta plans into TP or ingest
  TP-tracked athletes. `[17]`
- **Zwift structured-training API (2024):** lets a service send structured workouts
  (Duration / Threshold-power / Target) into a Zwift account without bespoke per-partner
  work — the natural home for our indoor-trainer bike sessions. `[18]`

---

## 2. Platform comparison table

Data richness, auth, delivery, limits, approval friction, cost, and the one gotcha that
bites — for the platforms that matter to a triathlon app. (Ordered roughly by relevance to
Trifecta.)

| Platform | Data you can get | Auth | Push vs poll | Rate limits | Approval friction | Cost | The gotcha |
|---|---|---|---|---|---|---|---|
| **Strava** (hub) | Activity summary + streams (HR/power/pace/cadence/GPS/laps); most devices sync in | OAuth 2.0 | Webhook nudge (1 sub/app) → fetch; 200 in ~2 s | 200/15 min, 2 000/day (100/1 000 read) `[12]` | Low (self-serve) | ~$12/mo dev sub `[STRAVA_SETUP]` | No cross-user display; no AI/ML on the data (Nov 2024) `[1]` |
| **Garmin** | Richest: activity details + Health (HRV, sleep, Body Battery, RHR, SpO2, VO2max) | **OAuth 1.0a** (HMAC-SHA1) | **Push full payload** to per-type callbacks | None published for partners | **Program ON HOLD — closed to new apps (mid-2026)** `[6][7]` | Free (if admitted) | Can't get in right now; go via aggregator |
| **Apple HealthKit** | Workouts, HR, HRV, RHR, sleep, VO2max, respiration | On-device permission | Native SDK reads on device, you upload | Device-side, best-effort | N/A | Free | **No server API — needs a native iOS app; a PWA cannot access it** `[4][5]` |
| **Oura** | Readiness, sleep stages, HRV, RHR, temp, SpO2 | OAuth 2.0 (PAT deprecated Dec 2025) | Webhook (~30 s post-sync) → fetch | **5 000/5 min** `[13]` | Low (self-serve) | Free API | Data only after ring syncs to phone app |
| **WHOOP** | Recovery (HRV, RHR), sleep, strain, workouts | OAuth 2.0 (rotating refresh) | Webhook nudge → fetch (UUID) | Standard | Low (self-serve) | Free API | **v2 only — v1 removed Oct 2025** `[10]`; rotating refresh tokens |
| **Polar** (AccessLink) | Training w/ samples, HRV, Nightly Recharge, sleep | OAuth 2.0 | Webhook nudge → open transaction → fetch | **Dynamic**, scales w/ users `[15]` | Low–med | Free | Transaction/commit model; smaller tri share |
| **COROS** | Activity + training data; push workouts/plans back | OAuth 2.0 | Sync-based | Standard | **Med (partner app, but open)** `[16]` | Free | Younger, thinner docs; growing fast |
| **Suunto** | Activity/perf/GPS, HR, R-R (HRV), power | OAuth 2.0 | Sync-based | Standard | Low–med | Free | Small share |
| **Wahoo** | HR/power zones, workout up/down-load | OAuth 2.0 | Sync-based | Standard | Low | Free | Bike-only; usually redundant with Strava |
| **TrainingPeaks** | Structured-workout push, completed-workout pull | OAuth 2.0 | API | Standard | **Med (approved partners only)** `[17]` | Partner terms | It's a push target, not a rich source |
| **Aggregators** (Terra/Junction/Spike/Rook) | Normalized union of ~300–500+ of the above, incl. Garmin + Apple Health SDK | OAuth 2.0 (they hold the partnerships) | Webhooks, normalized | Abstracted | **Low (they did the approvals)** | **$99–$500+/mo, usage-based** `[8][9]` | You inherit their outages/normalization choices; still need a native shell for HealthKit |

---

## 3. The Strava API policy changes (Nov 2024) — what they mean for us

On **11 November 2024** Strava updated its API agreement. Two clauses matter to Trifecta
`[1][2][3]`:

1. **"Third-party apps may now only display a user's Strava activity data to that specific
   user."** You may not surface one athlete's Strava-derived data to *another* user.
2. **A prohibition on using Strava API data "in artificial intelligence models or similar
   applications"** — an explicit tightening of a pre-existing ban, aimed at the wave of AI
   fitness products.

Strava framed this as affecting **<0.1% of apps**, said it proactively notified those
affected, and stated that **coaching platforms and performance-analytics tools that display
data only to the individual athlete remain unaffected** — the "overwhelming majority of
existing use cases are still allowed." `[1][3]` The apps that got hit were public
feeds/heatmaps/leaderboards and model-training pipelines (e.g. tools like VeloViewer,
TrainerRoad-style leaderboards, and any resale/AI use). `[2]`

**Implications for Trifecta — read carefully:**

- **Our plan engine is safe.** [lib/planEngine.ts](../../lib/planEngine.ts) is a
  *deterministic* rules engine (§4 of [04-planning-engine-algorithm-design.md](04-planning-engine-algorithm-design.md)),
  not a trained model, and our calibration ([lib/calibrate.ts](../../lib/calibrate.ts))
  nudges pace targets from the athlete's *own* HR/RPE shown back to that *same* athlete.
  Neither is "AI/ML trained on Strava data," and neither shows one user's data to another.
- **Our social feed is the exposure.** Trifecta has a follows/kudos surface
  ([lib/social.ts](../../lib/social.ts), `follows`/`kudos` tables in
  [lib/db.ts](../../lib/db.ts)). Today it shows *planned-session completion* and kudos —
  fine. But the moment we render **Strava-derived actuals** (activity name, distance, HR,
  map) on a *follower's* feed, we would violate clause #1. **Rule going forward: never
  display Strava-sourced fields to anyone but their owner.** Anything shown cross-user must
  be Trifecta-native (the plan/session the athlete completed inside Trifecta), not the Strava
  payload.
- **If we ever add AI features on top of workout data** (auto-summaries, anomaly/injury
  detection, an LLM coach that reasons over history — see the cheap-AI hooks in
  [lib/api.ts](../../lib/api.ts): `apiCoach`, `apiIntake`, `apiPlanSummary`), they must run
  on **non-Strava-sourced** data, or on data ingested through a path whose terms permit it
  (a direct Garmin/Oura/WHOOP connection, or an aggregator). This is a concrete reason to
  diversify sources beyond Strava before leaning into AI.
- **Strategic read:** Strava is now a friendlier partner to a *complementary coaching app*
  than to a competitor, but it has demonstrated it will unilaterally change the rules ahead
  of monetization/IPO. **Do not build the whole data moat on Strava.** It's a great default
  hub and a poor sole foundation.

Cross-ref: [08-software-platform-and-security.md](08-software-platform-and-security.md) for
the compliance/ToS posture and token handling this implies.

---

## 4. File & data formats — FIT, TCX, GPX

When you're not on a live API, you're handling files (user upload, email export, or a
device that only writes files). Richness ranking: **FIT ≫ TCX > GPX.**

### FIT (Garmin's binary format) — the rich one

- **Structure.** Little-endian binary: a 12- or 14-byte header (with a header CRC and the
  `.FIT` signature), a body of **records** — each either a *definition message* (declares
  the field layout for a "local message type") or a *data message* (the values) — and a
  trailing **2-byte file CRC** (CRC-16 with the FIT nibble table). Our
  [lib/fit.ts](../../lib/fit.ts) implements exactly this on the *encode* side.
- **What it carries.** Global message types include `file_id`, `record` (the per-sample
  time series: `timestamp`, `position_lat/long` in semicircles, `altitude`, `heart_rate`,
  `cadence`, `power`, `speed`, `distance`, `temperature`), `lap`, `session`, `activity`,
  `event`, and `hrv`. This is the only common format that natively carries **power, running
  dynamics, and lap structure** together.
- **Developer fields.** Since the FIT SDK's developer-data extension (~2017), apps can add
  **self-describing custom fields** (`field_description` + `developer_data_id`) — e.g.
  Stryd running power, custom form metrics. A robust parser must read the definition, honor
  the declared base type/scale/offset, and *skip unknown fields gracefully* rather than
  choke.
- **Parsing robustly.** Use a maintained SDK/library (Garmin's FIT SDK, or `fit-file-parser`
  in JS) — do **not** hand-roll a decoder. Guard the CRC, tolerate truncated files, and
  handle the compressed-timestamp header variant.
- **Where we stand.** [lib/fit.ts](../../lib/fit.ts) is a **workout encoder** (file type 5)
  that emits structured sessions to push to a watch — targets left "open" with coaching
  detail in the step name so it's unit-safe across devices. **We have no FIT *decoder*.**
  Ingesting activity FIT files (the natural offline/backfill path, and the way to get
  streams without any API) is unbuilt.

### TCX (Training Center XML) — the lossy middle

- Garmin XML: `Activities > Activity > Lap > Track > Trackpoint`, where each Trackpoint has
  `Time`, `Position` (lat/lng), `AltitudeMeters`, `DistanceMeters`, `HeartRateBpm`,
  `Cadence`. **Power only via the `ns3:TPX/Watts` extension.** No developer fields.
- Bigger, slower to parse than FIT, and lossy (no rich device fields). Fine as an import
  fallback; not a primary path.

### GPX (GPS Exchange) — the lowest common denominator

- Generic XML: `<trk><trkseg><trkpt lat lon><ele><time>`. Position + elevation + time only.
- **HR and cadence exist only via the Garmin `TrackPointExtension` namespace; there is no
  native power.** Treat GPX as route + timing, not as a training-quality data source.

**Practical stance:** if we build file ingest, build a **FIT decoder first** (it's the only
format that gives us streams and power), accept TCX/GPX as best-effort fallbacks, and
normalize all three into our internal activity shape (§7).

---

## 5. The aggregators — what they abstract, and what they cost

Aggregators exist to make #3 and #4 above go away. You integrate **one** OAuth flow and
**one** normalized API/webhook; they maintain the ~300–500+ per-provider integrations, hold
the **Garmin and Apple partnerships**, ship the **iOS SDK** that reads HealthKit, and
normalize the data model behind it.

| Aggregator | What it abstracts | Pricing (2025–26) | Notes |
|---|---|---|---|
| **Terra** (tryterra.co) | 300–500+ providers incl. Garmin, Fitbit, Apple Health, Oura, WHOOP, Strava; one normalized API | ~**$399–$499/mo**, credit-based (~200 credits/user/mo, ~$0.005/credit) `[8][9]` | Most breadth; strong docs; developer-first |
| **Junction** (ex-**Vital**) | Wearables + **lab/diagnostic** data; normalized | **~$0.50/user/mo**, ~$300 min, volume discounts at 1 000+ `[8]` | Health/clinical lean; per-user pricing is easy to model |
| **Spike** | Wearables API + SDK, HealthKit/Health Connect | Usage-based | Seed-stage, dev-friendly |
| **Rook** | Wearables normalization + SDK | **$99/mo base** + add-ons (can reach $499+) `[8]` | Cheapest entry; LatAm roots |
| **Sahha** | Health data + scores | **$99–$189/mo** to 1 000 users, then $0.10/user `[8]` | Bundles derived scores |
| **Thryve / others** | EU-centric health-data hub | Custom | GDPR/EU posture |

**What you're really buying:** (1) the **Garmin partnership** you can't currently get
yourself (§1.2); (2) an **Apple Health SDK** you drop into a native shell so you don't build
HealthKit plumbing from scratch; (3) **normalization** — the genuinely hard part
(reconciling that "sleep score" and "readiness" mean different things across Oura/Garmin/
WHOOP, units, dedup); (4) **maintenance** — providers change their APIs constantly (WHOOP
v1→v2, Oura PAT deprecation, Strava agreement), and the aggregator eats that churn.

**What you're giving up:** margin at scale, some data-model control, and a dependency whose
outages and normalization choices become yours. You still need your **own native iOS shell**
to use any HealthKit SDK — the aggregator removes the *HealthKit code*, not the *native-app
requirement*.

---

## 6. Build vs buy — the honest recommendation for Trifecta

**The numbers `[8]`:**

- **Build in-house, year one: ~$63k–$138k** (dev $40–70k; infra $5–20k; compliance
  $13–33k; legal $5–15k). **Each provider is 2–4 weeks / ~$3.8k–$7.7k** of labor; six major
  platforms ≈ $23k–$46k in dev time alone. **Maintenance runs 20–40% of build cost per
  year, forever**, because the providers keep changing underneath you.
- **Buy (SaaS): ~$3.6k–$15k per 1,000 active users per year** — **3–5× cheaper** below the
  crossover, which lands around **10k–20k active users**.

**Applied to Trifecta's situation specifically:**

- We are a **small team, pre-scale, and a PWA**. Both facts point hard at **buy** for the
  hard providers (Garmin, Apple Health), because building them is either *impossible right
  now* (Garmin program frozen — §1.2) or *requires a native app we don't have* (HealthKit —
  §1.3). An aggregator is the only way to reach Garmin + Apple Health without waiting on
  Garmin or shipping native today.
- We already **built** the easy, high-value one (Strava) ourselves, cheaply and well. Good
  call — Strava is self-serve, is the hub, and covers most users at v1.
- The recovery devices (**Oura, WHOOP**) are *also* cheap to build directly (clean OAuth2 +
  webhooks, no gate) and unlock the readiness data our engine most needs. Building these two
  ourselves keeps that data on a **non-Strava** legal footing (relevant to §3's AI clause).

**Recommendation:**

> **Hybrid.** Keep and harden **Strava (built)** as the default hub. Build **Oura + WHOOP
> direct** next — cheap, ungated, and they unlock readiness (§7). Adopt an **aggregator
> (Terra or Junction) for Garmin + Apple Health**, because those are blocked to us
> otherwise. Revisit a fully in-house Garmin/Apple build only past ~10k–20k active users, or
> if HealthKit depth becomes a real product wedge worth a native app (§8).

This mirrors how Runna actually operates (deep Apple Watch + Garmin + Strava), and reaches
the same coverage without us waiting on the Garmin program or building native on day one.

---

## 7. Data model & normalization — the actually-hard part

Once data comes from more than one place, the engineering shifts from *fetching* to
*reconciling*. This is where sync quality is won or lost.

### Our internal shape today

Every synced activity becomes a `WorkoutActuals`
([lib/types.ts](../../lib/types.ts)) attached to a planned `Workout`:

```
WorkoutActuals { source: "strava"; activityId; name?; distanceM?; durationSec?;
                 avgHr?; avgWatts?; startedAtISO? }
```

Note `source` is a **hard-coded literal `"strava"`** — the type itself assumes one source.
The matcher ([lib/strava.ts](../../lib/strava.ts) `matchActivityToWorkout`) binds an
activity to a planned session by **local day + discipline + closest planned duration**, then
marks it `done`. It's pure and unit-tested — good — but it's a *heuristic*, not an identity.

### Normalization work we will need for multi-source

- **Dedup / precedence.** The same ride arrives via **Garmin *and* Strava** (Garmin → Strava
  is the common sync path). We need a rule: match candidate activities across sources by
  **(sport, start time ±N min, duration ±N%, distance ±N%)**, then pick a **precedence
  winner** (prefer the richest/most-direct source — Garmin > Strava-hub copy; real power
  meter > estimate; direct connection > aggregator). Store the raw from each but surface one
  canonical actual. **None of this exists today** because we have one source.
- **A `source` union.** Widen `WorkoutActuals.source` to
  `"strava" | "garmin" | "apple" | "oura" | "whoop" | "file"` and carry a per-source external
  id so dedup and idempotency work across providers.
- **Units & fields.** Normalize to SI internally (meters, seconds, watts, bpm) — we already
  store `distanceM`/`durationSec`. Watch power: **only trust real-meter power**
  (`device_watts`), never estimates, for calibration (we already gate this — keep it).
- **Timezones.** Match on the athlete's **local day** (we use `start_date_local`) — a session
  finished at 23:30 local must land on the right calendar day regardless of UTC. Keep
  local-day as the join key across every source.
- **Streams (the missing tier).** We ingest **summary only**. To do real analysis
  (normalized power, TSS-from-power, HR/pace decoupling, true zone distribution, interval
  detection) we need the **per-second streams** — Strava `/streams`, Garmin activity details,
  or a decoded FIT file (§4). This is the difference between "you did a 60-min ride" and "you
  held threshold for 3×10 with 6% decoupling."
- **Recovery data (the missing dimension).** We ingest **no HRV / resting-HR / sleep**.
  `ReadinessInput.restingHr` is an optional *manual* number; the morning check-in is a
  subjective 1–3 tap. Oura/WHOOP/Garmin all expose objective HRV + RHR + sleep. Feeding those
  into the readiness score is the single highest-leverage data upgrade for a
  "readiness-adaptive" product.

### Cross-sport load from heterogeneous data

Reconciled activities feed training load. **How** we turn HR/power/duration/RPE into a
single cross-sport load number — and how readiness modulates it — is owned by
[02-training-load-and-readiness.md](02-training-load-and-readiness.md); the injury/ramp-rate
guardrails that consume it live in
[03-injury-and-load-management.md](03-injury-and-load-management.md). The relevant point
*here* is that **load is only as good as the data tier feeding it**: today it runs off
planned estimates + avg HR (via [lib/calibrate.ts](../../lib/calibrate.ts)); with streams it
could run off power/normalized-power and true intensity; with recovery data the readiness
input becomes objective rather than self-reported.

---

## 8. The PWA constraint and Trifecta's honest options

Trifecta is a **PWA on Next.js** (great for reach, install-free, one codebase). But the best
device data — Apple Watch via HealthKit, and richest Garmin — sits behind a **native-app or
partner wall**. The honest option space:

**A. Strava-as-hub (where we are).** One server-side OAuth integration; most devices sync in
transitively. *Pros:* built, cheap, broad, no native app. *Cons:* single point of failure;
lossy hub copy (no HRV, running power often dropped); latency; bound by the Nov-2024 terms
(§3); zero recovery data.

**B. More server-side OAuth integrations (Oura, WHOOP, Polar, COROS, Suunto, Wahoo).** All
are plain OAuth2 + webhooks with **no native app required** — perfectly reachable from our
PWA + server. *This is the highest-ROI next step:* Oura + WHOOP give us readiness (HRV/RHR/
sleep) that Strava never will, on a clean legal footing. *Cons:* Garmin's OAuth 1.0a is
painful and **currently closed**; Apple is impossible this way.

**C. Aggregator (Terra/Junction).** One integration reaches Garmin + Apple Health + the rest,
inheriting their partnerships. *Pros:* unblocks Garmin (frozen program) and gives an Apple
Health SDK. *Cons:* cost at scale; still needs a native shell to *use* the HealthKit SDK; a
dependency.

**D. Native / hybrid wrapper app (Capacitor/React Native shell, or a thin "Trifecta Health
Sync" companion).** The *only* path to **HealthKit** (Apple Watch) and to Health Connect
(Android). *Pros:* unlocks the single most-owned device's full dataset; enables real
background sync and push-to-watch UX like Runna's. *Cons:* real native build + App Store
review + maintenance; a strategic step, not a quick one.

**Sequencing (see §11):** A is done → do **B (Oura/WHOOP)** now → add **C (aggregator)** for
Garmin/Apple breadth → consider **D** only when HealthKit depth is a proven wedge. Retention
of connected users is materially higher (device-connected athletes log more and churn less —
see [06-behavioral-science-and-retention.md](06-behavioral-science-and-retention.md)), so
the connect step is also an onboarding/retention lever, not just a data one
([07-product-and-ux-design.md](07-product-and-ux-design.md)).

---

## 9. Where Trifecta is today — honest assessment of our ingest

Grounded in [lib/strava.ts](../../lib/strava.ts), [lib/db.ts](../../lib/db.ts),
[lib/fit.ts](../../lib/fit.ts), [lib/api.ts](../../lib/api.ts),
[STRAVA_SETUP.md](../../STRAVA_SETUP.md), and the routes under `app/api/strava/*`.

**What works well:**

- **Clean Strava OAuth + token lifecycle.** `validAccessToken` refreshes with a 60 s skew
  and persists new tokens; connections live in their own `strava_connections` table keyed by
  `user_id` and indexed by `athlete_id`, so the webhook can find the owner and token refresh
  never clobbers the plan JSON (a real, thoughtful separation).
- **Webhook + backfill belt-and-braces.** The webhook (`app/api/strava/webhook/route.ts`)
  always returns 200 (so Strava never disables the subscription), does the minimal
  token-check → fetch → apply inside the ~2 s budget, and **manual "Sync now"** plus
  **connect-time backfill** (last 2–3 weeks) catch any missed events. This is a genuinely
  sound reliability pattern for v1.
- **Idempotent apply.** `applyActivityToUser` no-ops if the same `activityId` already
  completed the session — re-delivery/retry safe.
- **Pure, tested matcher.** `matchActivityToWorkout` (day + discipline + closest duration)
  and `disciplineOf` are pure and unit-tested (`scripts/test-strava-match.ts`).
- **Disciplined about power.** Only `device_watts === true` power feeds actuals/calibration —
  we don't let Strava's estimated watts poison the signal.

**What's fragile:**

- **Single source.** Strava is our only ingest. No Strava push (or a user who doesn't use
  Strava) = no data.
- **Heuristic matching, not identity.** Multi-session days rely on closest-duration; there's
  no activity-id-first binding to a specific planned slot, and a `medium`-confidence match
  can attach the wrong session.
- **Client-save race.** An open client holding a stale plan can overwrite a
  webhook-completed session (documented known limit in [STRAVA_SETUP.md](../../STRAVA_SETUP.md));
  reopening re-hydrates, but it's a real last-write-wins hazard.
- **No retry/DLQ.** A failed webhook fetch is simply dropped (caught, ignored) and left to
  the manual backfill — fine at friends-scale, thin at real scale.
- **Plaintext tokens.** `access_token`/`refresh_token` stored unencrypted (acknowledged;
  encrypt-at-rest is deferred — see
  [08-software-platform-and-security.md](08-software-platform-and-security.md)).

**What's missing (the gaps to the "readiness-adaptive" thesis):**

- **No streams** → no normalized power, TSS-from-power, decoupling, or true intensity
  distribution. Calibration is avg-HR-only.
- **No recovery data** (HRV / resting-HR trend / sleep) → readiness is a subjective tap, not
  an objective signal. This is the biggest single gap.
- **No FIT/TCX/GPX decoder** → no offline/file ingest path; `lib/fit.ts` only *encodes*
  workout files to push out. So the AGENTS/description claim that we "can parse FIT files" is
  **not yet true** — worth correcting.
- **No multi-source data model** → `WorkoutActuals.source` is a literal `"strava"`; no dedup,
  no precedence, no cross-source id.

---

## 10. Sync reliability engineering — the patterns that make it trustworthy

Whatever sources we add, the ingest pipeline should follow the same reliable shape. Most of
this generalizes our current Strava flow:

1. **Webhook = nudge, then fetch (idempotently).** Assume every provider except Garmin sends
   a tiny event, not the data. Ack fast (**200 within the provider's window — Strava's is
   ~2 s**), then do the fetch out of band. Garmin is the exception (full payload push) — take
   the payload directly.
2. **Enqueue, don't inline.** At scale, don't fetch inside the webhook handler; drop the
   event on a queue and process with a worker so a slow provider fetch can't blow the ack
   budget. (We currently inline — fine now, the first thing to change under load.)
3. **Idempotent, upsert-by-external-id.** Key every ingested activity on
   `(source, externalId)`; re-applying is a no-op (we do this per `activityId` — generalize
   it across sources).
4. **Dedup across sources** before applying (§7): same-workout detection by sport + start
   time + duration/distance, with a source-precedence winner, so a Garmin+Strava double
   doesn't count twice.
5. **Backfill as the safety net.** Keep the manual + connect-time backfill; add a periodic
   reconcile that re-pulls the last N days per connection to heal missed webhooks. Make
   backfill idempotent (it already is, via #3).
6. **Retry with backoff + a dead-letter path.** Failed fetches should retry (respecting rate
   limits and `Retry-After`/`RateLimit-*` headers), then dead-letter for inspection rather
   than silently vanish.
7. **Respect rate limits proactively.** Read the limit headers (Strava, Polar expose them),
   batch, and never poll where a webhook exists. Budget: Strava 200/15 min, Oura 5 000/5 min.
8. **Token hygiene.** Refresh with skew (we do), handle **rotating refresh tokens** (WHOOP),
   re-auth gracefully on revoke, and **encrypt tokens at rest** (deferred today).
9. **Freshness honesty in the UI.** Data is eventually-consistent (Oura only after the ring
   syncs; Apple background delivery is throttled). Show "last synced" and a manual sync — we
   already surface `lastSyncAtISO` and a "Sync now" button.

---

## 11. Recommended roadmap for Trifecta

A concrete, sequenced plan that respects the PWA constraint and the Nov-2024 Strava terms:

1. **Harden Strava (now).** Add a retry/dead-letter path for webhook fetches; add streams
   ingest (`/streams`) so we can compute real intensity/decoupling; encrypt tokens at rest;
   fix the client-save race (server authoritative on device-completed sessions). Ensure the
   social feed shows **no** Strava-sourced fields cross-user (§3).
2. **Add Oura + WHOOP direct (next).** Clean OAuth2 + webhooks, no gate, and they deliver the
   **HRV / resting-HR / sleep** that turns our readiness check-in from subjective to
   objective — the core of the injury-aware/readiness-adaptive wedge. Widen
   `WorkoutActuals.source` and add a `RecoveryData` type at the same time.
3. **Adopt an aggregator for Garmin + Apple Health (when breadth matters).** Terra or
   Junction — the only realistic route to Garmin (program frozen) and Apple Watch (no server
   API) without shipping native. Build the **dedup/precedence** layer (§7) here, since this
   is when the same activity starts arriving twice.
4. **Build a FIT decoder (opportunistic).** Cheap, provider-independent offline/backfill path
   that also gives streams; makes "import your history" and "email a .fit" work.
5. **Consider a native/hybrid wrapper (strategic, later).** Only if HealthKit depth or
   Runna-style push-to-watch / live coaching becomes a proven wedge worth the native build
   and App Store maintenance (§8).

The throughline: **diversify off Strava, prioritize the recovery data our thesis needs,
buy the gated providers, and keep ingest idempotent, deduped, and honest about freshness.**

---

## Sources

1. Strava Press — "Updates to Strava's API Agreement." https://press.strava.com/articles/updates-to-stravas-api-agreement
2. DC Rainmaker — "Strava's Big Changes Aim To Kill Off Apps" (Nov 2024). https://www.dcrainmaker.com/2024/11/stravas-changes-to-kill-off-apps.html
3. Strava Support — "API Agreement Update & How Data Appears on 3rd Party Apps." https://support.strava.com/hc/en-us/articles/31798729397773
4. The Momentum — "What You Can (and Can't) Do With Apple HealthKit Data." https://www.themomentum.ai/blog/what-you-can-and-cant-do-with-apple-healthkit-data
5. Open Wearables — "Apple HealthKit API: What Data You Can Access and How." https://openwearables.io/blog/apple-healthkit-api-what-data-you-can-access-and-how
6. The Momentum — "Garmin Developer Program Paused: Roadmap Impact." https://www.themomentum.ai/blog/garmin-developer-program-closed-roadmap
7. Garmin Forums — "Garmin Connect — Program On Hold." https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/436199/garmin-connect---program-on-hold
8. The Momentum — "The Real Cost of Wearables Integration in 2025: Build vs Buy Analysis." https://www.themomentum.ai/blog/the-real-cost-of-wearables-integration-in-2025-build-vs-buy-analysis
9. Terra — Pricing & Integrations. https://tryterra.co/pricing · https://tryterra.co/integrations
10. WHOOP for Developers — v1→v2 Migration Guide & Webhooks. https://developer.whoop.com/docs/developing/v1-v2-migration/ · https://developer.whoop.com/docs/developing/webhooks/
11. Oura — API v2 Documentation. https://cloud.ouraring.com/docs/ · https://api.ouraring.com/v2/docs
12. Strava Developers — Rate Limits. https://developers.strava.com/docs/rate-limits/
13. Open Wearables — "Oura Ring API: Sleep, HRV and Readiness Data." https://openwearables.io/blog/oura-api-accessing-ring-data-sleep-hrv-readiness
14. Open Wearables — "Garmin Connect API: Developer Guide for Activities and Health Metrics." https://openwearables.io/blog/garmin-connect-api-developer-guide-activities-health-metrics
15. Polar — Open AccessLink API (v4 / Dynamic) & webhooks. https://www.polar.com/polar-api-v4/ · https://www.polar.com/blog/introducing-polar-open-accesslink-api/
16. COROS — Training Hub API / Supported 3rd-Party Apps. https://support.coros.com/hc/en-us/articles/360040256531
17. TrainingPeaks — "An Update on TrainingPeaks Partner API" & Help Center. https://www.trainingpeaks.com/blog/an-update-on-trainingpeaks-partner-api/ · https://help.trainingpeaks.com/hc/en-us/articles/234441128
18. DC Rainmaker — "Zwift's New Structured Training API." https://www.dcrainmaker.com/2024/04/structured-training-interesting.html

*Also consulted: Suunto developer portal (apizone.suunto.com), Wahoo Cloud API
(developers.wahooligan.com/cloud), Open Wearables provider guides, and Trifecta source
(`lib/strava.ts`, `lib/fit.ts`, `lib/db.ts`, `lib/api.ts`, `lib/types.ts`, `lib/calibrate.ts`,
`app/api/strava/*`, `STRAVA_SETUP.md`).*

---

*Cross-references: [02-training-load-and-readiness.md](02-training-load-and-readiness.md)
(how reconciled data becomes cross-sport load & readiness) ·
[03-injury-and-load-management.md](03-injury-and-load-management.md) (the guardrails that
consume it) · [04-planning-engine-algorithm-design.md](04-planning-engine-algorithm-design.md)
(the deterministic engine that adapts to actuals) ·
[06-behavioral-science-and-retention.md](06-behavioral-science-and-retention.md) &
[07-product-and-ux-design.md](07-product-and-ux-design.md) (device-connect as an
onboarding/retention lever) ·
[08-software-platform-and-security.md](08-software-platform-and-security.md) (token
encryption, webhook infra, ToS posture).*
