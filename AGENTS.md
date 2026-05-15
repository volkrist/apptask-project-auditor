# AppTask Auditor MVP

## Goal

Build an MVP service that:

1. opens an AppTask project board;
2. reads task cards through Playwright;
3. evaluates cards against explicit audit rules;
4. generates a summary report and a detailed report;
5. sends the summary to Discord.

## Constraints

- Use Node.js + TypeScript + Playwright Test.
- Start with Playwright, not API.
- Do not invent undocumented AppTask fields.
- Separate DOM parsing from business-rule evaluation.
- Separate report generation from Discord transport.
- Treat subjective rules as WARN, not FAIL, unless explicitly configured.
- Store auth state outside git.
- Prefer stable user-visible locators over brittle CSS/XPath.
- Add small tests for rule functions.
- Keep code modular and easy to replace with API later.

## Architecture (layers)

Work in short layers. Do not build everything at once.

1. **Config** — `src/config/audit-config.ts` is the single source of business thresholds (blacklists, required types, tags, report mode).
2. **Collect** — `adapters/apptask/*` reads the board into `RawTask`. No business rules here.
3. **Evaluate** — `rules/*` returns `RuleResult` per card. Pure functions; unit-tested on JSON fixtures.
4. **Format** — `reports/*` builds summary + detail (JSON + Markdown).
5. **Deliver** — `adapters/discord/*` implements `ReportPublisher` (webhook first).

`BoardProvider` and `ReportPublisher` are interfaces so Playwright and webhook can be swapped later without touching the rule engine.

## Repository layout

```
src/
    config/
      audit-config.ts
    adapters/
      apptask/
        auth.ts
        board.ts
        card.ts
        raw-task.ts
      discord/
        webhook.ts
        bot-adapter.ts
    rules/
      rule-types.ts
      hard-rules.ts
      soft-rules.ts
    reports/
      build-audit-result.ts
      json.ts
      markdown.ts
      discord-summary.ts
    app/
      run-audit.ts
    web/                    # optional in MVP
tests/
    rules/
    fixtures/
    e2e/
playwright/
  .auth/                  # gitignored
output/                   # gitignored — audit artifacts
```

## Confirmed AppTask UI (manual)

- Board example: `https://apptask.ru/c/7/board/445`
- Cards live inside **collapsible categories** — expand all before collecting
- Card opens in a **modal**; URL becomes `/board/{boardId}/{taskId}`
- `taskId` from URL or header `№ …`
- Fields in modal main area + right panel
- **Read-only:** never edit card fields in automation

## Implementation order

| Step | Deliverable |
|------|-------------|
| 0 | Repo + Playwright + `RawTask` types |
| 1 | **Navigation smoke test** (board → categories → one card → modal) |
| 2 | `card.ts` / `board.ts` parser (null-safe) + fixtures |
| 3 | `audit-config.ts` + rule engine (only after stable parser) |
| 4 | Reports + Discord webhook |
| 5 | `run-audit.ts` CLI; optional web form |

## Output expectations

- README with setup and env variables
- working local run command
- sample JSON report
- sample Discord summary payload
- clear TODO list for non-MVP items

## Reports

- **Summary (Discord)** — project name, cards checked, FAIL count, WARN count, top issues by rule (counts only), note that detail file is attached. Never dump every card into the channel.
- **Detail** — JSON and Markdown under `output/audit-{timestamp}/` with every card and all rule results.

## Debugging

On parser or navigation failure:

- retain Playwright trace and screenshot;
- log card id, URL, and last successful step;
- document “If it fails” in README (Trace Viewer).

Rule unit tests must not launch a browser.

## Auth

Record session once (do not commit):

```bash
npx playwright codegen https://YOUR-APPTASK-URL --save-storage=playwright/.auth/user.json
npx playwright codegen --load-storage=playwright/.auth/user.json https://YOUR-BOARD-URL
```

Add `playwright/.auth/` and `output/` to `.gitignore`.

## Important business rules

All thresholds live in `audit-config.ts`. Rule ids must stay stable for reports and tests.

### Hard rules (FAIL)

- title present and non-empty
- assignee present
- deadline present
- deadline not overdue
- deadline not in the past (unrealistic)
- description present
- priority present
- task type present and in allowed list
- links and attachments reachable (not broken / empty)

### Soft rules (WARN)

- title clarity (too short or vague)
- generic title (blacklist: e.g. «правки», «доработки», «баги», «сайт», «проверить»)
- description richness (minimum length / structure)
- goal or expected result in description
- required tags missing (when configured)
- stage / funnel mismatches column or status
- estimate or budget missing
- link to estimate / contract / request missing
- required artifact links missing (mockups, spec, repo, etc.)
- possible duplicate of another card on the same board

When a rule is ambiguous, default to **WARN** and document the assumption in code or config.

## Non-MVP (TODO)

- AppTask REST API adapter (`ApiBoardProvider`)
- Full Discord bot adapter (replace webhook)
- Run history and database
- Cron / scheduled audits
- Multi-project registry
- Web UI beyond a single form (board URL + webhook + Run)

## For AI agents

- Read `src/config/audit-config.ts` before changing rule logic.
- Do not add business checks inside `card.ts` or `board.ts`.
- Do not send per-card messages to Discord.
- Ask for a real board URL and field mapping if DOM does not match `RawTask`.
- Prefer small, reviewable diffs per layer.
