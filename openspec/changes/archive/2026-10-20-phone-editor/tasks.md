# Tasks

## 1. Shared deletion rules

- [x] 1.1 Implement `packages/core/removal.js` (`removalPlan`) and re-export it. Verify with `packages/core/removal.test.js`: every `item-model` delta scenario, not-found, already-deleted, inputs not mutated, every changed entity stamped.
- [x] 1.2 Make `apps/desktop/main/store.js:remove` delegate to `removalPlan` (same return contract). Verify that all existing `apps/desktop/test/store.test.js` tests stay green, plus one new test that `remove` applies exactly the plan's changes.

## 2. Editor model (pure)

- [x] 2.1 Implement `apps/web/public/editor-model.js` per design (`PHONE_FIELDS`, `newItem`, `applyForm`, `formFromItem`, `moveWithin`, `newGroup`, `newWorkspace`, `rename`, `newId`, `errorsByField`). Verify with `apps/web/test/editor-model.test.js` covering the scenarios and boundaries listed in design.md "Testing". Make sure the test loader resolves `./core/` imports the same way `view.js` tests do.

## 3. Editor UI

- [x] 3.1 Implement `apps/web/public/editor.js` and wire it into `app.js` + `styles.css` (edit toggle, row/group/workspace controls, item and settings sheets, read-only desktop section, save/delete flows, offline-disabled toggle, stored-copy update after saves). Make sure `scripts/build-web.mjs` ships the new files (and the build test expects them). Verify by hand under `wrangler dev` (DEV_NO_AUTH) at mobile size in the in-app browser, covering each `phone-checklist` delta scenario; report page text or screenshots. Restore `.dev.vars` afterwards.

## 4. Reconcile

- [x] 4.1 Run root `npm test` (report the core / web / desktop counts), `npm run build:web`, `openspec validate phone-editor --strict`, and the privacy grep on new files.
- [x] 4.2 Update docs:
  - `docs/core/*` (`removalPlan`);
  - `docs/web/*` (editor rows, STATUS: redeploy needed);
  - `docs/desktop/IMPLEMENTATION.md` (`remove` delegates to core).

  Write `docs/web/reviews/review-phone-editor.md`, then self-check refs. Report suggested CLAUDE.md rows instead of editing the file.

## 5. Follow-ups

- [x] 5.1 Groups could not be moved with the ↑ ↓ arrows: make group moves robust and cover them. Verify with `apps/web/test/editor-model.test.js` (moving groups with ties, gaps, deleted siblings and other workspaces' groups in between) and by hand.
- [x] 5.2 Make the offline state visible: tapping the disabled edit toggle, and edit mode closing because the connection dropped, show the toast "Editing needs a connection" (the toggle uses `aria-disabled`, not `disabled`).
- [x] 5.3 Per-workspace name for ungrouped items (D99): core `Workspace.ungroupedLabel`, `validateWorkspace`, `ungroupedLabelOf`; D1 migration `0003_workspace_ungrouped_label.sql`, `rows.js`, `store.js` (shape plus `validateWorkspace` on merged workspaces, 422); the checklist and the editor use the label; the workspace rename sheet has the second field. Verify with core, rows, store and view tests, and by hand.
- [x] 5.4 Links section (D100): `buildView` adds per-workspace `links`; the checklist shows them as a collapsible section at the top of each workspace, collapsed by default, open state remembered per device. Verify with `apps/web/test/view.test.js` and by hand.
- [x] 5.5 Drag reorder (D101): ⋮⋮ press-and-hold handles for items and groups with pointer events; pure `dropPlan` in `editor-model.js`. Verify with `apps/web/test/editor-model.test.js` (within a group, across groups, to ungrouped, group reorder, no-op and invalid drops) and by hand with synthetic pointer events.
- [x] 5.6 Compact, low-contrast ↑ ↓ arrows (at least 32 px tap target). Verify by hand at mobile size.
