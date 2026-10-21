# Review — phone-editor

- Date: 2026-10-15
- Change: `phone-editor`
- Component: web (`apps/web/public/editor.js`, `apps/web/public/editor-model.js`, `apps/web/public/app.js`), core (`packages/core/removal.js`), desktop store (`apps/desktop/main/store.js`)

## Test summary
`npm test` from the repo root:
```
ℹ tests 454
ℹ suites 0
ℹ pass 454
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
Breakdown: core 146, web 148, desktop 160 (counts after the follow-ups; the desktop count also includes tests added by the desktop work in parallel) (new: one store test that `remove` applies exactly the plan's changes). `npm run smoke -w apps/desktop` prints `SMOKE OK` after the `remove` refactor.

## Checklist (FRAMEWORK §8)
Legend: [x] pass · [ ] fail · [~] not applicable

### Coherence
- [x] Placement honesty: `removalPlan` and `apps/web/public/editor-model.js` are pure (time and ids are parameters; `crypto.randomUUID` is injected by `app.js`); only `app.js` and `editor.js` touch the DOM and the network.
- [x] Transmission well-typing: the editor sends the existing `PUT /api/entities` shapes; no API change.
- [x] Placement totality: the new morphisms (`removalPlan`, editor model, editor UI) have rows in `docs/core/IMPLEMENTATION.md` and `docs/web/IMPLEMENTATION.md`.
- [x] Dependency mediation: the phone reaches D1 only through the API (Law 4); the server still validates every write (Law 1).
- [x] Composition soundness: deletion rules have one source (core); the desktop store delegates to it, and a test asserts `remove` equals the plan.
- [x] `runsAt` relation: `removalPlan` runs in the PWA and the desktop, both pure (Law 6).

### Modeling smells
- [x] No parallel objects: the phone form is a view over `Item`.
- [x] Deduced, not copied: deletion changes are deduced by `removalPlan`; nothing new is stored.
- [x] Stored-deduced: none.
- [x] Diagram ⇄ table: `docs/core/ARCHITECTURE.md` updated together with the code.

### Process gates
- [x] Model updated together with the code (core, web, desktop docs).
- [x] Boundaries have a single source: `Item` typedef; deletion rules in `packages/core/removal.js`.
- [x] Status updated (`docs/core/STATUS.md`, `docs/web/STATUS.md`).
- [x] Violated rules: none. Security: DOM built with element APIs and `textContent` only (no `innerHTML`); URLs are accepted only through core `validateItem` (http and https); `appPath` and item kind have no form field and are preserved by `applyForm` (D89).
- [x] D53 (public-ready): nothing identifying in the new files; the manual check ran against the example dataset in a temporary data folder.

## Manual check (2026-10-15, `wrangler dev` with `DEV_NO_AUTH` on localhost, in-app browser at 375 px, example data)
Each `phone-checklist` delta scenario, verified against `/api/state` (the same data the PC gets on refresh):
- **Add a daily check-in:** "+ item" in Study, name and URL, Save: the item is stored with group Study, a daily schedule, devices all, kind web, the default user agent and last order; the stored offline copy contains it.
- **Invalid URL:** `example.com` shows "Must start with http:// or https://" under the field and sends nothing (0 requests); a corrected value saves.
- **Delete needs confirmation:** cancelling sends nothing; accepting stores a tombstone.
- **Move up:** the second item of a group becomes first (server order confirmed); moving the top item up sends nothing.
- **Delete a group:** the confirmation names the 3 items; the group is a tombstone, the 3 items stay with no group and appear under "No group".
- **Workspaces:** add (defaults: sleep 10, not open in Edge, last order), blank name rejected, rename, move up, delete with "and its 4 items?" (workspace, groups and items all tombstoned on the server).
- **Last workspace:** with two left both have a delete button; with one left it has none.
- **Settings:** timezone list of 419 entries; an invalid email is rejected inline; Asia/Tokyo and a Google email are stored on the server and in the offline copy.
- **Desktop-only fields preserved:** a PC-side edit (isolated, no keep-logins, sleep 7, Firefox preset, Edge always with a profile) was renamed from the phone; every one of those fields was unchanged on the server, and the read-only section showed them.
- **Offline:** the offline event disables the toggle with "Editing needs a connection" and leaves edit mode; it re-enables when back online.
- **Failures:** a stubbed 422 shows the server's error under the field and keeps the form open; a network failure shows a toast, keeps the form and the typed text, and shows the offline banner.
Not exercised: the stored-copy case in a real offline cold start (covered by the 9.1 checks; the toggle is disabled whenever the on-screen snapshot is the stored copy), and a real phone.

## Follow-ups (tasks 5.1–5.6, after the first phone test)
Manual check 2026-10-15 under `wrangler dev` at 375 px with the example data in a temporary data folder:
- **5.1 group moves:** the ↑ ↓ arrows on groups moved them (also with equal or gapped `order` values), the server order and the checklist followed; a regression test covers ties, gaps, deleted siblings and other workspaces' groups. I could not reproduce a failure with the example data; if it recurs on the phone, note which group and workspace.
- **5.2 offline note:** tapping the disabled toggle shows "Editing needs a connection"; edit mode closing because the connection dropped shows the same toast and an open form keeps its text.
- **5.3 ungrouped label:** the workspace rename sheet has "Name for items without a group" (placeholder "Default"); 41 characters is rejected inline; "Misc" is stored and shown in the editor list, the item sheet's group select and the checklist.
- **5.4 links:** each workspace with unscheduled items shows "Links (n)" collapsed; opening it is remembered across reloads and per workspace; links without a Google email show the hint.
- **5.5 drag:** with synthetic pointer events: press and hold shows the insertion line; dropping within a group, into another group, into the ungrouped section and reordering a group were all stored on the server; a drop in place sent nothing; Escape cancelled; a quick tap did not start a drag. Real finger dragging is for the phone test.
- **5.6 arrows:** the ↑ ↓ buttons are compact and quiet (32 px targets).
Not exercised: a real touch drag with scrolling near the screen edge (auto-scroll is implemented but only the pointer logic was driven here), and a real phone.

## Open
- Redeploy: `npm run migrate:remote` (migration 0003), then `npm run deploy:web`, then a phone test by the user.
- Whole-entity last-write-wins (D79 caveat): the phone clock stamps its edits; a newer edit from another device is kept and the phone shows a toast.
- No undo (mitigated by confirmations; tombstones could be restored through the API).

Verdict: PASS (pending the redeploy and the phone test)
