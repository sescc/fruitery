# Proposal

## Why
The phone checklist collects every unscheduled item of a workspace into a separate "Links" section at the
top of the workspace (D100). The owner added an unscheduled item to a group and was confused that the phone
showed it outside that group, while the desktop shows it inside the group. The phone should show the
structure the owner built.

## What Changes
- **Links move into their groups.** On the phone, an item without a check-in schedule (visible on the phone,
  not deleted) is shown as a **link row** inside its own group, or inside the workspace's ungrouped section
  (named by the workspace's ungrouped label, default "Default"), in the stored order among that group's rows.
- **A link row is visibly a link.** It has a link marker where a check-in has its tick circle, and it opens
  like a check-in (placeholders filled, app items open their fallback address, a missing Google email shows
  the hint).
- **Links do not count.** A link row has no tick circle, is not counted in the group's "done/total" progress,
  never appears in "Not due", and is ignored by the day summary ("Basket full").
- **A group with only links is shown**, without a progress figure.
- **The separate Links section is removed**, with its per-device open state. A value stored by an earlier
  version is simply ignored.
- Edit mode is unchanged: it already places items by group.

**Supersedes D100.**

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `phone-checklist`: "Today's checklist" gains link rows in their groups, a new requirement describes them,
  "Site icons" no longer mentions a Links section, and the "Links section" requirement is removed.

## Impact
- **Code:**
  - `apps/web/public/{view.js, app.js, styles.css}`;
  - tests in `apps/web/test/view.test.js`.
- No API, schema, dependency or new-file changes. The service-worker precache list is unchanged (the
  content-hashed shell cache name changes by itself with the shipped files). Redeploy with `npm run deploy:web`.
- **Docs (orchestrator):** web component docs; a decision row superseding D100 and the "Links" edge-case rows.
