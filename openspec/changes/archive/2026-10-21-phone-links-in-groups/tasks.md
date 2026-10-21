# Tasks

## 1. View model

- [x] 1.1 In `apps/web/public/view.js`, make `buildView` return unscheduled phone-visible items as link rows (`bucket: 'link'`, `nextDue: null`) inside their group or the ungrouped section, in stored order; count only due and done rows in a group's progress; drop `WorkspaceView.links` and `LinkView`. Verify with `apps/web/test/view.test.js`: link in a group, ungrouped link, progress counts only check-ins, links-only group, deleted and desktop-only hidden, app item uses its fallback, missing Google email hint, link in a deleted group goes to the ungrouped section, day progress ignores links.

## 2. UI

- [x] 2.1 In `apps/web/public/app.js` and `styles.css`, render link rows with a link marker instead of the tick circle (same width, no second arrow after the name), hide the progress figure of a group without check-ins, and remove `linksNode`, the open-state helpers, the `fruitery:linksOpen` key and the `.links` styles. Verify that `apps/web/test/build.test.js` stays green (no precache change) and by hand at phone width under `wrangler dev` (an unscheduled item in a group).

## 3. Reconcile

- [x] 3.1 Run root `npm test` (report the total count), `npm run build:web` and `openspec validate phone-links-in-groups --strict`; privacy grep on the new files.
- [x] 3.2 (docs part done; the CLAUDE.md rows are the orchestrator's) Update `docs/web/*` (ARCHITECTURE, IMPLEMENTATION rows for `buildView` / `itemNode`, STATUS: redeploy needed) and the `CLAUDE.md` decision (supersedes D100) and edge-case rows; run the supercharge drift check and fix dead rows before archiving.
