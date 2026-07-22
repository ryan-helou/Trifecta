<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Competitive reference — read before designing product/plan features

Before building any user-facing feature, plan-engine behaviour, onboarding flow, or
pricing/positioning decision, consult [docs/research/runna-competitive-analysis.md](docs/research/runna-competitive-analysis.md).
Runna is the closest analog to AmaTri (adaptive coaching app, running niche; acquired by
Strava in 2025). That doc captures how they work, why they won, what users complain about,
and — most importantly — the **copy / avoid / exploit** playbook for AmaTri, mapped to our
actual engine ([lib/planEngine.ts](lib/planEngine.ts)). Our moat: multisport-native +
injury-aware/readiness-adaptive planning + a ~$0/plan deterministic engine.
