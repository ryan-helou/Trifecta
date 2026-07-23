---
name: update-notion
description: >-
  Syncs the Trifecta Dev Tasks Notion database with reality: marks a ticket Done
  when its work is actually shipped, and fills in a description, Difficulty,
  Importance, and Status for any ticket missing them. Reads tickets via the
  Notion MCP, verifies "done" against the codebase and git history (never trusts
  the title alone), and flags genuinely ambiguous tickets back to the user
  instead of guessing. Use when the user says "update the notion", "update
  notion", "sync notion", "update notion tasks", "tidy the tickets", or otherwise
  asks to reconcile the task board.
---

# Update the Notion task board

Reconcile the **Trifecta Dev Tasks** Notion database with the real state of the
Trifecta/Trifecta codebase. Jobs, in order: fetch the live schema, enumerate every
ticket, mark the truly-shipped ones Done, and backfill the empty fields
(description, Difficulty, Importance, Status) on any ticket missing them. The
point is a board that reflects reality, so the bias is toward verifying claims,
not rubber-stamping them.

Backfill every property that exists in the live schema, not just Difficulty: set
`Status` (default `Not started` unless verified Done / In progress), `Difficulty`,
and `Importance` (star scale; estimate from user signals - tickets the user calls
"important" and active UX bugs rank high, polish/nice-to-haves low). State the
Importance scale assumption (★★★★★ = highest) in the report so the user can flip
it.

## Database facts

- Database id: `bd92df5f-b4f6-4118-8ed0-a833fd999900`
  (https://app.notion.com/p/bd92df5fb4f641188ed0a833fd999900)
- Data source (collection) for create/update: `collection://84cb0acc-76ad-4628-9b51-edc197d70def`
- Schema: `Name` (title); `Status` (select, 4-stage lifecycle:
  `Not started` -> `In progress` -> `In staging` -> `Done`); `Difficulty`
  (select: `Easy` / `Medium` / `Hard` / `Expert`); `Importance` (select, a star
  scale - `★` lowest through `★★★★★` highest, colored gray -> blue -> yellow ->
  orange -> red); `Created` (created_time); `Created by` (select: `Ryan` /
  `Claude` / `Other`); `Ticket` (auto-increment unique id, no prefix, e.g. `1`,
  `2`). Auto-id gaps are just deleted rows - normal, not an error.
- **Status lifecycle (set it to match reality):** `Not started` = untouched;
  `In progress` = being worked, code not yet merged to `main`; `In staging` =
  merged to `main` but not yet confirmed live by the user; `Done` = shipped and
  verified live. Trifecta currently has no separate CI/CD or staging environment
  (no `.github/workflows`, no `vercel`/`netlify` config as of last research), so
  treat `In staging` as "on `main`, awaiting the user's confirmation it's live"
  and `Done` as "user-confirmed shipped." If a real staging/prod split gets added
  later, update this definition and this doc. This is the user's core
  check-when-I-start-work signal, so keep it accurate. (Status is a plain Select -
  the Notion API cannot edit status-TYPE option lists, which is why it is a
  Select.)
- The schema drifts (the user adds/edits properties between runs). ALWAYS fetch
  the live schema first with `notion-fetch` on the collection id and adapt to
  whatever properties exist now - do not trust this list blindly.

## Step 1 - Load the Notion MCP and enumerate tickets

Load the tools in one ToolSearch call:

```
select:mcp__claude_ai_Notion__notion-search,mcp__claude_ai_Notion__notion-fetch,mcp__claude_ai_Notion__notion-update-page,mcp__claude_ai_Notion__notion-create-pages,mcp__claude_ai_Notion__notion-update-data-source
```

Then list every ticket. `notion-query-data-sources` (SQL and view mode) needs a
Notion Business plan and may return a plan-gated 400 - do NOT rely on it. Instead
enumerate with `notion-search` scoped to the database, then `notion-fetch` each
page for its `Ticket` number, `Status`, `Difficulty`, and body content:

```
notion-search  query: "task"  page_url: bd92df5f-b4f6-4118-8ed0-a833fd999900  page_size: 25  max_highlight_length: 0
```

Search is semantic and may not return every row in one pass; run a second search
with a different broad query (e.g. "add fix plan onboarding sync") and union the
results by page id so nothing is missed. Ignore results from other databases -
the Trifecta Dev Tasks rows all live under the `bd92df5f-...` database / the
`84cb0acc-...` collection.

## Step 2 - Mark shipped tickets Done (verify, do not assume)

For each ticket NOT already `Done`, decide whether the work actually shipped. The
title or even an "In progress" status is not proof - confirm in the code and
history. Trifecta does **not** tag commits with ticket numbers, so match by feature,
not by id:

- `git log --oneline -n 40` on `main`, plus `git log --grep "<keyword from the
  ticket>" --oneline` - a merged commit that describes the ticket's feature is the
  strongest signal it landed.
- Grep the codebase for the feature the ticket describes (e.g. the component,
  the `lib/planEngine.ts` rule, the sync integration); confirm the described
  behavior exists, not just a stub.
- If in doubt whether it actually shipped, treat it as NOT done. A false "Done"
  hides unfinished work; a conservative "still open" is cheap to correct.

Only when confirmed on `main`, set the status:

```
notion-update-page  page_id: <id>  command: update_properties  properties: {"Status": "In staging"}
```

Use `In staging` when the code is on `main` but you cannot confirm it is live, and
`Done` only when the user has confirmed it shipped. If a ticket is clearly
mid-flight (a feature branch or partial code exists but it is not on `main`), set
`In progress` rather than `Done`.

## Step 3 - Backfill description + Difficulty on incomplete tickets

For every ticket whose body is blank (a `<blank-page>` in the fetch result) or
whose `Difficulty` is empty:

1. **Write a description** from the title, grounded in the codebase - name the
   files / modules likely involved (a quick grep beats a vague paragraph). Use the
   section shape already on the filled tickets: a `## Description`, a
   `## Difficulty: <level>` with a one-line rationale, and `## Open questions` for
   anything you cannot resolve from the title or code. Insert with:

   ```
   notion-update-page  page_id: <id>  command: insert_content  content: "<markdown>"
   ```

   `insert_content` appends, so it is safe on tickets that already carry the user's
   own note - it adds your section below theirs.

2. **Set Difficulty** with your best estimate, sized to the real work. Anchor to
   Trifecta's actual architecture (see [AGENTS.md](../../../AGENTS.md) and the
   8-realm knowledge base in [docs/knowledge/](../../../docs/knowledge/)):
   - `Easy` - self-contained copy / config / a small isolated component or single
     screen tweak.
   - `Medium` - a normal frontend or data change, one surface, low blast radius
     (a settings field, a chart, an onboarding step).
   - `Hard` - touches the plan engine (`lib/planEngine.ts`), training-load /
     readiness math, scheduling/periodization, or the service worker / PWA
     offline path; or has an unconfirmed root cause to chase.
   - `Expert` - cross-cutting and risky: injury/load-ramp logic tied to medical
     liability, wearable/device sync ingest (Strava/Garmin/Apple/Whoop/Oura),
     auth / data-model / GDPR-FTC health-data compliance, or anything spanning
     sync, engine, and UI at once.

   ```
   notion-update-page  page_id: <id>  command: update_properties  properties: {"Difficulty": "Hard"}
   ```

Do not overwrite a description or Difficulty that is already filled in unless the
user asks - this pass only backfills what is missing.

## Step 4 - Report

Summarize what changed: which tickets were marked Done / In staging (with the
evidence - the commit or code that proves it), which got a description /
Difficulty added, and list every ticket left with open questions so the user can
resolve them. End with the current board at a glance (ticket number, title,
Status, Difficulty).

## Hard rules

- **Verify "Done" against code or a commit on `main`, never the title.** A
  wrongly-closed ticket is the worst failure mode of this skill.
- **Code on `main` is necessary but NOT sufficient for Done.** A feature can be
  fully coded yet not live: the deployed build may lag `main`, or it may be gated
  by an env var / feature flag / config that is not set on the live app. If a
  ticket's "live" state depends on config or deploy, do not mark it `Done` from
  code alone - confirm it live, or leave it `In staging`. The user's word about
  what is live ALWAYS overrides the code.
- **Flag ambiguity, do not invent scope.** If a title is unclear, write the
  best-effort description but put the real decision in `## Open questions` and
  surface it to the user.
- **Backfill only.** Never clobber an existing description or Difficulty without
  an explicit ask.
- **Zero emojis, no em dashes** in any Notion content you write (house rule).
- This skill only edits the task board. It does not write code or deploy. To
  actually do a ticket, route to the normal build flow.

## Cross-refs

- Domain grounding for descriptions and Difficulty: [AGENTS.md](../../../AGENTS.md)
  and the 8-realm knowledge base ([docs/knowledge/README.md](../../../docs/knowledge/README.md)).
- Adapted from the ChessIQ `update-notion` skill; if Trifecta gains a real
  staging/prod deploy or a ticket-tagging commit convention, revisit Step 2 and
  the Status lifecycle above.
