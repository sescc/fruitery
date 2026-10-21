# Proposal

## Why
Three places must give the same answer to "what is due today": the Worker, the desktop app and
the phone PWA. They must also share one shape for workspaces, items and ticks. Nothing exists yet.
The web and desktop components both depend on this pure model, so it comes first
(docs/core/ARCHITECTURE.md).

## What Changes
- New package `packages/core` (plain JS ES modules, JSDoc, `// @ts-check`, zero dependencies) containing:
  - **Data model:** typedefs for `Workspace`, `Group`, `Item`, `Schedule`, `Completion` and `Settings`,
    plus `validateItem` and `effectiveSleep`.
  - **Schedule semantics:** `periodKey`, `bucket` (due / done / notDue) and `nextDue`. Cadences are
    daily, weekly, monthly (clamped) and everyNDays (fixed start date); per-item reset time and a
    configurable timezone are supported.
  - **URL tokens:** `expandUrl` fills `{YYYY}`, `{MM}`, `{DD}` and `{googleEmail}` and reports unknown tokens.
  - **Ordering and sync:** dense `reorder` and last-write-wins `mergeLww`.
  - **Seed dataset:** 2 workspaces, 3 groups, 11 items (a generic example; personal data lives in git-ignored `config/seed.local.json`).
- Root `package.json` (workspaces, `"type": "module"`, `test` script running `node --test`).
- Tests for every edge case in the CLAUDE.md edge-case table that belongs to core.

## Capabilities

### New Capabilities
- `checklist-schedule`: when a scheduled item is due, done or not due, how periods roll over
  (cadence, reset time, timezone) and when it is next due.
- `item-model`: what an item may contain, which items are rejected, how URL tokens expand, how
  ordering and sleep defaults resolve, and how concurrent edits from two devices merge.

### Modified Capabilities
None (greenfield).

## Impact
- New code: `packages/core/**`, root `package.json`.
- No dependencies are added; this uses Node ≥ 24 built-ins only.
- Consumers (later changes): `apps/web` (Worker + PWA) and `apps/desktop`.
- Docs: `docs/core/IMPLEMENTATION.md` rows move from planned to built.
