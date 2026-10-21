# Design

## Context
- **What exists:** `apps/web/public/view.js:buildView` is a pure deduction from the snapshot. It lists only
  scheduled items in `groups` (with progress) and `notDue`, and collects the unscheduled items of a workspace
  in a separate `links` list. `app.js:linksNode` renders that list as a collapsible section whose open state
  is kept per device in `localStorage` (`fruitery:linksOpen`). The desktop shows unscheduled items inside
  their group.
- **Conventions:** plain JS, JSDoc, `// @ts-check`, no framework, `node:test`; nothing identifying in
  committed files.

## Goals / Non-Goals
**Goals:**
- the phone shows an unscheduled item where the owner put it (in its group);
- links stay out of every count.

**Non-Goals:**
- changing edit mode (it already lists every item by group);
- any change to the API, the data model or the desktop;
- migrating the old stored open-state value (it is ignored).

## Decisions

### Model delta
- **No new object.** A link row is an `ItemView` whose `bucket` is `'link'`: the existing view of an item,
  plus one more discriminator value. This is an existing object plus a morphism change (§3 consolidation
  check: nothing new in the data model).
- **`buildView` changes** (`Snapshot × Instant → View`, total and deduced):
  - the item filter no longer requires a schedule: every live item visible on the phone is a row;
  - an item with a schedule gets its bucket as today (`due`, `done`, `notDue`; `notDue` still goes to the
    workspace's `notDue` list);
  - an item without a schedule gets `bucket: 'link'` and `nextDue: null`, is never put through the schedule
    functions, and goes into its group by the same rule as check-ins (live group of the same workspace, else
    the ungrouped section);
  - rows keep the stored order (`order`, then id) among their group's rows, links and check-ins mixed;
  - a group's `progress` counts only rows whose bucket is `due` or `done`; a links-only group has
    `{done: 0, total: 0}` and is still listed;
  - `WorkspaceView.links` and `LinkView` are removed; a workspace is listed when it has any group or `notDue`
    entry.
- **`dayProgress` is unchanged:** it sums group progress, which already excludes links, so "Basket full" and
  "Nothing to pick today" ignore them.
- **Address and hint:** the same `linkOf` as for check-ins (expanded placeholders, app items use their
  fallback address, missing Google email gives the hint `set-google-email`).
- **Laws:** one source of truth for the address expansion (Law 6, `linkOf` stays the only path); the view
  stays pure and deduced (no stored state); edit mode and the server are untouched (Law 1 unchanged).

### PWA: `app.js` and `styles.css`
- `itemNode` renders a link row (`li.item.link`): a link marker (an arrow, the width of the tick column so
  names line up) instead of the checkbox, then the icon and the name as for check-ins. The marker is
  decorative (`aria-hidden`). The arrow that normally follows an openable name is dropped on link rows so the
  row does not show two.
- The group heading shows the progress figure only when the group has at least one check-in.
- `linksNode`, the open-state read/write helpers and the `fruitery:linksOpen` key are removed; so are the
  `.links` styles. A value left in storage by an earlier version is harmless.
- No new files; the service-worker precache list is unchanged (D95's build test stays green).

## Risks / Trade-offs
- **A group of only links** has no tick circles and no progress; it is still a visible group, which is what
  the owner built.
- **Ungrouped links become a "Default" section** in workspaces that had only links (for example the example
  productivity workspace), instead of a collapsed "Links (N)" row. The section is always open; the owner
  chose structure over compactness.
- **Interpretation:** the owner decision did not say how a links-only group's heading looks; the progress
  figure is hidden rather than showing "0/0".

## Open Questions
None.
