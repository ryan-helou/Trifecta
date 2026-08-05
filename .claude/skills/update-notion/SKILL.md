---
name: update-notion
description: >-
  Keeps the Trifecta Dev Tasks Notion board in sync with reality. Two modes: (A)
  QUICK per-task - the moment a task/feature/fix ships (merged to main), mark its
  ticket Done, and if no ticket exists, auto-create one already Done with fields
  filled; (B) FULL sweep - reconcile the whole board (verify shipped tickets,
  backfill missing description/Difficulty/Importance/Status, create tickets for
  untracked shipped work). Verifies "done" against code + git history on main
  (never the title alone). Use QUICK mode PROACTIVELY whenever work ships (standing
  rule), and FULL mode when the user says "update notion", "sync notion", "tidy the
  tickets", or asks to reconcile the board.
---

# Update the Notion task board

Keep the **Trifecta Dev Tasks** board matching the real state of the
`~/Developer/Trifecta` codebase. There are **two modes** - pick by context:

- **Mode A - QUICK (per-task).** The default when *a specific task just shipped*.
  Mark that one ticket Done (auto-create it if missing), and stop. Run this
  **proactively, without being asked**, every time work lands - it is a standing
  rule (see [always-update-notion-when-done] in memory). Cheap and fast.
- **Mode B - FULL sweep.** The whole-board reconcile. Run when the user asks
  ("update notion", "sync notion", "tidy the tickets") or on a periodic pass.

Both modes share the same **Done bar, verification discipline, and house rules**
below. The bias is always toward verifying against code, not rubber-stamping.

## Done bar and Status lifecycle (READ FIRST)

Trifecta **auto-deploys on push to `main`** (~2-4 min build), so **merged to `main`
= Done**. Set Status to match reality:

- **`Not started`** - untouched.
- **`In progress`** - being worked; code on a feature branch, NOT yet merged to `main`.
- **`In staging`** - *optional/transient*: merged to `main` but the deploy is still
  building, OR the feature is genuinely gated by config/env not yet set on prod
  (e.g. the Strava vars case). Use sparingly; most work goes straight to Done.
- **`Done`** - on `main` (therefore deployed). This is the normal end state.

**The one exception to "main = Done":** if a feature is fully on `main` but provably
NOT live because it needs an env var / feature flag / external config that is not
set, mark `In staging` and note why. Otherwise, on `main` = `Done`. (Status is a
plain Select; the Notion API cannot edit status-TYPE option lists, hence Select.)

## Database facts

- Database id: `bd92df5f-b4f6-4118-8ed0-a833fd999900`
- Data source (collection) for create/update: `collection://84cb0acc-76ad-4628-9b51-edc197d70def`
- Schema: `Name` (title); `Status` (select: `Not started` / `In progress` /
  `In staging` / `Done`); `Difficulty` (select: `Easy` / `Medium` / `Hard` /
  `Expert`); `Importance` (select, star scale `★` lowest .. `★★★★★` highest);
  `Created` (created_time); `Created by` (select: `Ryan` / `Claude` / `Other`);
  `Ticket` (auto-increment - do NOT set it, Notion assigns it). Auto-id gaps are
  deleted rows, normal.
- **Schema drifts** (the user edits properties between runs). ALWAYS `notion-fetch`
  the collection id first and adapt to whatever properties exist now.

Load the Notion tools with a KEYWORD ToolSearch, not a `select:` by name:

```
ToolSearch: notion page database update properties
```

**Do not hardcode the server prefix.** It used to say
`select:mcp__claude_ai_Notion__notion-*`, which silently matched nothing once the
connector was reattached under a different id (`mcp__<uuid>__notion-*`, 2026-08-05) —
the skill then looked like Notion was simply unavailable. Search by keyword and use
whatever prefix comes back.

**Prefer SQL over reading the board.** `notion-query-data-sources` runs SQLite against
`collection://84cb0acc-…`, which is the only way to see the WHOLE board — the web UI
virtualizes rows, so scraping it silently truncates at ~24 and hides tickets:

```sql
SELECT "Ticket", "Status", "Name" FROM "collection://84cb0acc-76ad-4628-9b51-edc197d70def"
WHERE "Status" IS NULL OR "Status" != 'Done' ORDER BY "Ticket" DESC
```

Set fields with `notion-update-page` / `command: update_properties`. A brand-new ticket
has `Status: null` (not "Not started"), so filter for both.

**If no Notion tool exists at all**, fall back to driving the board in the browser — see
the `notion-edit-via-browser` memory, which documents the exact click sequence and the
ways it silently reports success while writing nothing.

---

## Mode A - QUICK per-task (default when a task just shipped)

1. **Fetch the live schema** (`notion-fetch` the collection id) - always, schema drifts.
2. **Find the matching ticket.** `notion-search` scoped to the database with keywords
   from the shipped feature (`page_url: bd92df5f-...`, `page_size: 25`,
   `max_highlight_length: 0`). Match by feature, not id (commits are not
   ticket-tagged). Fetch the candidate to confirm it is the right one.
3. **Verify it actually shipped** - confirm the feature's commit is on `main`
   (`git log main --oneline --grep "<keyword>"`) and the behavior exists in code
   (not a stub). Never mark Done on the title alone.
4. **Mark it Done** (or `In staging` per the exception above):
   ```
   notion-update-page  page_id: <id>  command: update_properties  properties: {"Status": "Done"}
   ```
5. **If NO ticket exists for the shipped work, auto-create one already Done**
   (the user wants the board to be a complete record - see "Auto-create" below).
6. **One-line report**: which ticket was closed/created + the commit that proves it.

Keep it tight - Mode A is a couple of tool calls, not a full sweep.

## Mode B - FULL sweep (periodic / on request)

1. **Fetch schema** (as above).
2. **Enumerate every ticket.** `notion-search` is semantic and caps at 25/call, so
   run 2-3 broad queries (e.g. "task", "bug fix engine sync onboarding", "coach
   moat injury upload retention") and union by page id. `notion-query-data-sources`
   needs a Business plan and 400s - do not rely on it. If enumeration is
   necessarily incomplete, say so in the report (never imply full coverage you did
   not achieve).
3. **Mark shipped tickets Done** - for each non-Done ticket, verify against `main`
   (git log + grep the described behavior). On `main` = Done; feature branch /
   partial = `In progress`; config-gated-not-live = `In staging`. If in doubt,
   leave it open - a false Done is the worst failure.
4. **Auto-create tickets for untracked shipped work** - if you find work on `main`
   with no ticket, create it already Done (see below).
5. **Backfill missing fields** on incomplete tickets (blank body or empty
   `Difficulty`/`Importance`/`Status`). Backfill ONLY what is missing - never
   clobber the user's existing content.
6. **Report** - what changed with evidence, anything left with open questions, and
   the board at a glance.

## Auto-create a ticket (untracked shipped work)

When shipped work has no ticket, create one **already Done**, fields filled,
`Created by` = `Claude`:

```
notion-create-pages  parent: {data_source_id: "84cb0acc-76ad-4628-9b51-edc197d70def"}
  pages: [{
    properties: {
      "Name": "<Area> · <concise task title>",
      "Status": "Done",
      "Difficulty": "<Easy|Medium|Hard|Expert>",
      "Importance": "<★..★★★★★>",
      "Created by": "Claude"
    },
    content: "## Description\n<what shipped, files/modules touched>\n\n## Shipped\n<commit(s) on main + date>"
  }]
```

Do NOT set `Ticket` (auto-assigned). Ground the description in the actual code/commit.

## Difficulty + Importance rubric

- **Difficulty** (size to real work, anchored to Trifecta's architecture - see
  [AGENTS.md](../../../AGENTS.md) + [docs/knowledge/](../../../docs/knowledge/)):
  - `Easy` - self-contained copy/config, a small isolated component or screen tweak.
  - `Medium` - a normal frontend/data change, one surface, low blast radius.
  - `Hard` - touches the plan engine (`lib/planEngine.ts`), load/readiness math,
    scheduling/periodization, or the service worker / PWA offline path; or an
    unconfirmed root cause.
  - `Expert` - cross-cutting/risky: injury/load-ramp logic (medical liability),
    wearable sync ingest (Strava/Garmin/Apple/Whoop/Oura), auth / data-model /
    GDPR-FTC compliance, or anything spanning sync + engine + UI at once.
- **Importance** (★★★★★ = highest): user-called-"important" + active UX bugs rank
  high; polish / nice-to-haves low. State the scale in any report so the user can flip it.

## Hard rules

- **Verify "Done" against a commit on `main`, never the title.** A wrongly-closed
  ticket is the worst failure of this skill.
- **`main` = Done** (Trifecta auto-deploys). The only exception: provably-not-live
  because of unset config/env/flag -> `In staging` + note. Feature branch / partial
  -> `In progress`.
- **Auto-create Done tickets for untracked shipped work** (`Created by` = `Claude`,
  fields filled) so the board is a full record. Ground each in real code/commits.
- **Backfill only.** Never overwrite an existing description / Difficulty /
  Importance the user set, unless they ask.
- **Flag genuine ambiguity** in a `## Open questions` section rather than inventing scope.
- **Zero emojis, no em dashes** in any Notion content you write (house rule).
- **This skill only edits the board** - it does not write code or deploy. To do a
  ticket's actual work, route to the normal build flow.

## Cross-refs

- Standing rule: mark tickets Done proactively as work ships
  ([always-update-notion-when-done] in memory).
- Domain grounding: [AGENTS.md](../../../AGENTS.md) + the 8-realm knowledge base
  ([docs/knowledge/README.md](../../../docs/knowledge/README.md)).
- If Trifecta ever gains a separate staging/prod split or ticket-tagged commits,
  revisit the Done bar + Mode B verification.
