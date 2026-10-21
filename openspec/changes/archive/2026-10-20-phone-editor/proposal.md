# Proposal

## Why
Today, adding or changing a checklist item means editing the git-ignored seed file and
re-seeding (D80). The desktop editor only saves locally until `desktop-sync` exists. The owner wants to edit
from the phone too (D79). The API already supports last-write-wins upserts and tombstones, so the
phone can edit through it with no server change.

## What Changes
- **Edit mode in the PWA** (a pencil toggle in the header). In edit mode:
  - add, edit and delete items in a mobile form: name, URL, fallback URL, workspace, group,
    schedule (type and its fields), reset time, devices, notifications and badge;
  - move items up and down within their group (buttons, not drag);
  - add, rename, delete and reorder groups and workspaces;
  - edit settings: timezone and Google email.
- **Fields managed only on the desktop** are shown read-only and always preserved on save (D89):
  program path / kind, open-in-Edge, sleep time, user-agent preset, isolation and keep-logins.
- **Validation:** with core `validateItem` before sending. A server 422 is shown inline. Deletes
  ask for confirmation and send tombstones.
- **Deletion rules** move into core as one shared function (`removalPlan`):
  - deleting a group leaves its items ungrouped;
  - deleting a workspace deletes its groups and items;
  - the last workspace can't be deleted.

  The desktop store switches to that function, so the phone and the desktop behave the same
  (one source of truth).
- **Editing needs a connection:** edit mode is unavailable offline or while showing a stored copy.
  After each confirmed save, the stored offline copy is updated (D81).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `phone-checklist`: adds editing requirements: items, organising, settings, preserved
  desktop-only fields, editing needs a connection.
- `item-model`: adds the shared deletion rules.

## Impact
- **Code:**
  - `apps/web/public/{app.js, editor.js (new), editor-model.js (new), styles.css}`;
  - `packages/core/removal.js` (new) and `index.js`;
  - `apps/desktop/main/store.js`, whose `remove` uses the core plan;
  - tests in all three.
- **No API, schema or dependency changes.** Redeploy with `npm run deploy:web`.
- **Docs:** web and core component docs. D23 widens ("phone gets the PWA" now includes editing).
