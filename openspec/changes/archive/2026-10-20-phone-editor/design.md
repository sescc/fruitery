# Design

## Context
- **What exists:**
  - The PWA (`apps/web/public/app.js`, `view.js`) renders and ticks.
  - The API's `PUT /api/entities` takes partial snapshots and merges each entity with
    last-write-wins (`mergeLww`). The whole request is rejected with 422 if any item fails
    `validateItem`. Tombstones skip validation (D57).
  - Core has `validateItem`, `reorder`, `moveItem`, `userAgentOf` and the time helpers.
- **What's new:** desktop's `apps/desktop/main/store.js:remove` implements group/workspace
  deletion rules locally. They are the same rules the phone needs, so they move to core (§5,
  one source of truth).
- **Conventions:** plain JS, JSDoc, `// @ts-check`, no framework, `node:test`; nothing
  identifying in committed files.

## Goals / Non-Goals
**Goals:**
- phone editing of items, groups, workspaces and settings through the existing API;
- shared deletion rules in core.

**Non-Goals:**
- drag-and-drop on the phone;
- editing desktop-only fields (D89);
- offline edit queue (D27);
- per-field merge (D79 caveat).

## Decisions

### Model delta
- **New morphism** `removalPlan : Snapshot × Kind × Id × Instant → {changed: {workspaces, groups, items}} ⊕ {error:'last-workspace'|'not-found'}`.
  It is Total and deduced: no new object, only tombstones and `groupId:null` edits.
- **§3 check:** editing reuses `Item`/`Group`/`Workspace`/`Settings`. The phone form is a view
  over `Item`, not a new type.
- **Laws:**
  - **Law 6:** `removalPlan` is placed in the PWA and the desktop, both pure.
  - **Law 1:** the server re-validates every write (`validateItem` in `upsertEntities`).

### Core: `packages/core/removal.js`
- `removalPlan(snapshot, kind, id, nowMs)` where `kind ∈ {'item','group','workspace'}`. It
  ignores already-deleted entities when counting and returns only the changed entities, as new
  objects with `updatedAt = nowMs`:
  - **item:** the item with `deleted:true`;
  - **group:** the group with `deleted:true`, plus each live item with that `groupId`, now
    `groupId:null`;
  - **workspace:** refused with `last-workspace` if it is the only live workspace. Otherwise the
    workspace, its live groups and its live items, all with `deleted:true`.
- Unknown or already-deleted ids return `{error:'not-found'}`.
- Re-export it from `index.js`. Tests cover every spec scenario plus the not-found and
  input-not-mutated cases.
- **Desktop:** `apps/desktop/main/store.js:remove` delegates to `removalPlan`, keeping its
  current return contract. The existing store tests must stay green (that's what the refactor
  is checked against).

### PWA: `apps/web/public/editor-model.js` (pure, tested)
- `PHONE_FIELDS`: `name`, `url`, `fallbackUrl`, `workspaceId`, `groupId`, `schedule`,
  `resetTime`, `devices`, `notify`, `badge`.
- **`newItem(snapshot, {workspaceId, groupId}, nowMs, id)`:** defaults are
  - `kind:'web'`, `devices:'all'`, `resetTime:'00:00'`, `edge:{mode:'inherit', profile:null}`;
  - `isolate:false`, `persistSessionCookies:true`, `sleepAfterMin:null`, `icon:null`;
  - `userAgent:{preset:'default', custom:null}`;
  - `notify` and `badge` false;
  - `schedule:{type:'daily'}` if a group is given, else `null`;
  - `order` = last among its siblings.
- **`applyForm(item, form, nowMs)`:** copies only `PHONE_FIELDS` from the form onto a copy of
  `item`, so desktop-only fields are preserved (D89), and stamps `updatedAt`. Changing
  `workspaceId` goes through core `moveItem` (which clears `groupId` unless the form also set a
  group in the new workspace) and places the item last.
- **`formFromItem(item)`:** the inverse, for prefilling.
- **`moveWithin(snapshot, kind, id, delta, nowMs)`:** uses core `reorder` on the siblings and
  returns the changed entities. Siblings are items in the same (workspace, group), groups in the
  same workspace, or workspaces.
- **`newGroup` / `newWorkspace` / `rename`:** produce one stamped entity each. New workspaces
  get `sleepAfterMin:10` and `openInEdge:false`.
- **`newId(prefix, randomUUID)`:** returns `prefix + '-' + uuid`. The UUID function is injected
  for tests, and the app uses `crypto.randomUUID`.
- **`errorsByField(errors)`:** maps `{field, code}` lists (client or 422 `details[].errors`) to
  short messages per form field.

### PWA UI: `apps/web/public/editor.js` + `app.js` wiring
- **Header:** a ✏️ toggle.
  - Disabled, with the title "Editing needs a connection", when `!navigator.onLine` or when
    showing a stored copy.
  - Edit mode shows per-row ✎ (edit), ↑ ↓ and 🗑, per-group ✎ ↑ ↓ 🗑 and "+ item", plus
    "+ group", workspace controls (rename, ↑ ↓, delete, "+ workspace") and ⚙ (settings).
  - Ticking is disabled in edit mode.
- **Dialogs** use `<dialog>` as a bottom sheet:
  - **Item form:** name, URL, fallback URL, workspace and group selects, schedule (type → weekday
    / day / n + start date), reset time, devices, notifications, badge.
  - **Read-only "Desktop settings" section:** program path, open in Edge, sleep, browser
    identity, isolated, keep logins.
  - **Settings form:** timezone (`Intl.supportedValuesOf('timeZone')`) and Google email.
- **Save flow:**
  1. Build the entity with `editor-model`.
  2. Validate with `validateItem(item, {groups})`. Errors → inline, and stop.
  3. `PUT /api/entities` with the changed entities. 422 → inline errors from `details`.
     Success → merge the returned entities into the in-memory snapshot with `mergeLww`, update
     the stored copy (`serializeSnapshot`), and re-render.
  4. Network failure → a toast, and the form stays open.
- **Deletes:** `confirm()` with a count for workspaces ("Delete workspace X and its N items?"),
  then `removalPlan`, then PUT. The last workspace's 🗑 is hidden.
- **Settings save** sends `settings` with `updatedAt`.

### Testing
- **Core:** `packages/core/removal.test.js`.
- **Web:** `apps/web/test/editor-model.test.js`, covering:
  - every phone-checklist scenario that is pure;
  - field preservation (an isolated, Firefox-preset item renamed keeps both);
  - `moveWithin` boundaries (top item up → no change);
  - a new item validates;
  - the workspace move clearing the group;
  - `errorsByField` from client and 422 shapes.
- **Desktop:** the existing `store.test.js` stays green after the refactor, plus one test
  asserting `remove` returns what `removalPlan` decides.
- **Manual:** `wrangler dev` with `DEV_NO_AUTH` in the in-app browser at mobile size: add, edit,
  move, delete item, group and workspace, settings, offline-disabled toggle; screenshots or page
  text. Then the user redeploys and tests on the phone.

## Follow-ups (after the first phone test)
- **Group arrows:** a regression test and checks cover moving groups with ties, gaps, deleted siblings and
  other workspaces' groups in between (`moveWithin` for groups); the arrows are wired as for items.
- **Offline note:** a disabled control swallows taps and tooltips are invisible on phones, so the edit
  toggle uses `aria-disabled` and a tap shows the toast "Editing needs a connection". The same toast shows
  when edit mode closes because the connection dropped (an open form stays so typed text is not lost).
- **Ungrouped label (D99):** `Workspace.ungroupedLabel` (optional, at most 40 characters, non-blank if set).
  Core adds `validateWorkspace` (name non-blank too) and `ungroupedLabelOf` (label, else "Default"). The server
  validates merged non-deleted workspaces with `validateWorkspace` (422 `{id, errors}`). D1 gets migration
  0003 (`ALTER TABLE workspaces ADD COLUMN ungrouped_label TEXT`). The checklist and the editor use the label
  for the ungrouped section; the workspace rename sheet has a second field.
- **Links (D100):** `buildView` adds per-workspace `links` (live unscheduled items with devices all or
  phone, stored order, href and hint as for check-ins). The PWA renders them as a collapsible section at the
  top of the workspace, collapsed by default; the open state is kept per device in localStorage
  (`fruitery:linksOpen`).
- **Drag reorder (D101):** a ⋮⋮ handle; press and hold about 300 ms (pointer events, no library); items move
  within a group, between groups of the same workspace and into the ungrouped section; groups reorder;
  arrows stay. Edit mode only (so online only). The pure `dropPlan(snapshot, drag, target, nowMs)` in
  `editor-model.js` uses core `reorder` and returns only the changed entities, sent as one PUT; a drop that
  changes nothing sends nothing. `target.index` is the insertion position among the target's siblings with
  the dragged entity taken out. The list is not rebuilt while a drag is in progress.
- **Arrows:** the ↑ ↓ buttons are compact and low-contrast (still at least 32 px to tap).
## Risks / Trade-offs
- **Whole-entity last-write-wins.** A phone edit made while the desktop has the same item open
  and edits it later is overwritten (D79 caveat). This is accepted.
- **No undo.** Mitigated by delete confirmations, and tombstones could be restored manually via the API.
- **Desktop store refactor in the same change.** It is guarded by its existing test suite.

## Open Questions
None.
