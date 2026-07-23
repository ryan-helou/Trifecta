<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Domain knowledge base — read the relevant realm doc BEFORE designing in it

AmaTri's edge depends on deep expertise in eight realms. Each has a canonical,
code-grounded reference in [docs/knowledge/](docs/knowledge/) (index:
[docs/knowledge/README.md](docs/knowledge/README.md)). **Before you design or change
anything in one of these realms, read that doc's §4 (Principles & decision rules) first**
— it exists so we don't relearn the science/engineering (or repeat known mistakes) every
time. When you change code a doc cites, update the doc; keep its "Last researched" date honest.

- **Physiology / periodization / zones / taper / intensity** → [01](docs/knowledge/01-exercise-physiology-and-periodization.md)
- **Training load, CTL/ATL/TSB, readiness, race prediction, adaptivity math** → [02](docs/knowledge/02-training-load-and-readiness.md)
- **Injury logic, load ramps, deloads, pain/red-flags, medical liability** → [03](docs/knowledge/03-injury-and-load-management.md)
- **The plan engine (`lib/planEngine.ts`), scheduling, rules-vs-LLM, engine tests** → [04](docs/knowledge/04-planning-engine-algorithm-design.md)
- **Wearables/device integrations, Strava/Garmin/Apple/Whoop/Oura, data ingest & sync** → [05](docs/knowledge/05-wearable-and-data-ecosystem.md)
- **Onboarding activation, notifications, streaks, retention, the North-Star metric** → [06](docs/knowledge/06-behavioral-science-and-retention.md)
- **Any screen, chart, flow, the design system, accessibility** → [07](docs/knowledge/07-product-and-ux-design.md)
- **Infra, data model, auth, service worker, GDPR/FTC health-data compliance, AppSec** → [08](docs/knowledge/08-software-platform-and-security.md)

# Competitive reference — read before designing product/plan features

Before building any user-facing feature, plan-engine behaviour, onboarding flow, or
pricing/positioning decision, consult [docs/research/runna-competitive-analysis.md](docs/research/runna-competitive-analysis.md).
Runna is the closest analog to AmaTri (adaptive coaching app, running niche; acquired by
Strava in 2025). That doc captures how they work, why they won, what users complain about,
and — most importantly — the **copy / avoid / exploit** playbook for AmaTri, mapped to our
actual engine ([lib/planEngine.ts](lib/planEngine.ts)). Our moat: multisport-native +
injury-aware/readiness-adaptive planning + a ~$0/plan deterministic engine.
