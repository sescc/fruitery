# Tasks

## 1. Core and web delta (userAgent)

- [x] 1.1 Add `userAgent` to `packages/core/model.js` (typedef, `validateItem` rules, `userAgentOf`) and to the example `SEED`. Verify with new `packages/core/model.test.js` cases for both `item-model` delta scenarios plus preset enum, the 512-char limit and `userAgentOf` defaulting; all core tests stay green.
- [x] 1.2 Add `apps/web/migrations/0002_item_user_agent.sql`, then map `user_agent` in `apps/web/src/rows.js`, `store.js` (shape) and `scripts/gen-seed-sql.mjs`. Verify with web tests: round-trip with and without the field, a row with NULL â†’ default, migrations 0001+0002 apply in the sqlite adapter.

## 2. Package, launcher, paths

- [x] 2.1 Create `apps/desktop/package.json` (`@fruitery/desktop`, devDeps `electron`, `electron-builder` at current stable), `launcher.mjs` (sets `electron_config_cache` and `ELECTRON_BUILDER_CACHE` to `<repo>/.cache/electron` before spawning Electron), and `.gitignore` entries (`apps/desktop/data/`, `apps/desktop/release/`, `.cache/`). Verify: `npm install` at the root succeeds; Electron's download lands under `.cache/electron`; `%LOCALAPPDATA%\electron` and `%LOCALAPPDATA%\electron-builder` are not created (report what you checked).
- [x] 2.2 Implement `main/paths.js` and the first statements of `main/main.js` (portable `userData`/`sessionData`, disk-cache switch, single-instance lock) plus a `--smoke` mode. In smoke mode the app creates the window, loads the UI, checks the paths/sandbox/contextIsolation invariants, prints `SMOKE OK` and quits. Verify `npm run smoke -w apps/desktop` prints `SMOKE OK`, and a before/after snapshot of `%APPDATA%` and `%LOCALAPPDATA%` shows no new folders.

## 3. Pure libraries (tested, no Electron import)

- [x] 3.1 `lib/layout.js`. Verify with `apps/desktop/test/layout.test.js`:
  - split right and down;
  - 5th leaf refused;
  - close collapses into the sibling;
  - the last leaf can't close;
  - an item already in another pane â†’ focus that pane;
  - resize clamps;
  - `rects` sum to the box minus dividers;
  - `validate` rejects malformed trees.
- [x] 3.2 `lib/sleep.js`. Verify with `sleep.test.js`:
  - sleeps after the item's own workspace minutes;
  - never when the effective value is 0;
  - never when visible;
  - an item from another workspace shown in a split uses its own workspace default;
  - the item override beats the workspace.
- [x] 3.3 `lib/cookie-transform.js` (port the rules from `docs/desktop/general/spike-electron.md`) with `toPersistentDetails` and `isOptedOut`. Verify with `cookie-transform.test.js`:
  - host-only stays host-only;
  - `__Host-` never gets a domain;
  - `__Secure-` and attributes are preserved;
  - an already-persistent cookie â†’ null;
  - a leading-dot domain;
  - the opt-out suffix matching (`www.` stripped, subdomains included, unrelated domains excluded).
- [x] 3.4 `lib/ua.js`, `lib/badge.js`, `lib/resolve-open.js`, `lib/edge-path.js` and `lib/seed-select.js`. Verify with tests:
  - all four UA presets, including Electron/app tokens stripped for chrome;
  - badge `(3) Inbox` â†’ 3, `Inbox` â†’ null, `(0)` â†’ 0, garbage â†’ null;
  - every `resolveOpen` branch (blocked missing email or unknown token, edge with item/device/none profile, app present, app missing â†’ pane fallback, pane);
  - edge candidates from env;
  - seed selection (valid local, invalid local â†’ example, absent â†’ example).

## 4. Main process

- [x] 4.1 `main/store.js`: atomic cache.json/device.json, corrupt-file fallback, first-run seed, tick/untick, upsert (validate and stamp), remove (tombstone), reorder, moveItem. Verify with `apps/desktop/test/store.test.js` using a temp dir (store logic takes a directory argument and `now`; no Electron import): every editing scenario in `desktop-items`, the corrupt file moved aside, ticks idempotent per period.
- [x] 4.2 `main/sessions.js` and `main/views.js`:
  - partitions and the cookie hook (debounced flush);
  - permission handlers;
  - the UA before first load;
  - popup handling per design;
  - views kept alive across switches;
  - sleep timer and wake with URL + scroll;
  - badges from `page-title-updated`;
  - shortcuts via `before-input-event`.

  Verify with the smoke mode extended to: create two views in two workspaces, switch and check the first view's `webContents` id and URL are unchanged (no reload), force-sleep one, wake it and check its URL. Print the results.
- [x] 4.3 `main/open.js`, `main/tray.js`, `main/ipc.js` and `preload.cjs` (the IPC contract in design.md). Verify by smoke-testing the IPC contract with a scripted sequence (select workspace, show item, split, tick, upsert with an invalid item â†’ errors). Check that no IPC handler accepts a non-http(s) URL for Edge/external opening.

## 5. UI

- [x] 5.1 `ui/index.html`, `styles.css`, `app.js`, `rail.js`, `list.js`, `panes.js`:
  - rail with badges and drag reorder;
  - list with groups, progress, Not due, "Basket full ðŸ§º" and drag reorder;
  - pane headers, splits with drop zones, dividers;
  - the Daily bar with the D8 prompt rule;
  - light/dark theme;
  - a strict CSP.

  Verify by launching the app (`npm start -w apps/desktop`), driving it, and reporting screenshots or page text for: the seed rendered, a workspace switch with no reload, a 2-pane split, ticking via Done, Next with the prompt, and Basket full when all are done.
- [x] 5.2 `ui/editor.js` and `dialogs.js`: item editor (all fields, schedule inputs, UA preset, inline validation), workspace/group add/rename/delete, settings and device settings dialogs, delete confirmation, context menu wiring. Verify by launching: add an item, see an invalid save rejected, edit, move to another workspace, delete, then restart and check that the changes persisted.

## 6. Packaging

- [x] 6.1 `electron-builder.yml` (`dir`, x64, `electronLanguages: [en-US]`, `productName`/`executableName` Fruitery, asar, core files included) and `scripts/install-desktop.mjs` (root script `install:desktop -- --to <dir>`; never touches `<dir>/data`; copies the local seed only if absent). Verify:
  - `npm run package -w apps/desktop` produces `apps/desktop/release/win-unpacked/Fruitery.exe`;
  - running it with `--smoke` from a temp install dir prints `SMOKE OK` and creates `<dir>/data`;
  - a second install over it keeps `<dir>/data` intact (test with a marker file);
  - report the folder size.

## 7. Verification and reconcile

- [x] 7.1 Run root `npm test` (report core / web / desktop counts), `openspec validate desktop-shell --strict`, and the privacy grep on new files.
- [x] 7.2 Write the manual checklist into `docs/desktop/general/manual-checks.md` for the user:
  - Google Calendar sign-in with the default UA;
  - the Chrome or Firefox preset for a site that refuses sign-in with the default UA;
  - sign in, then Task Manager End task from the tray state, then restart (logins kept; D66);
  - no `%APPDATA%`/`%LOCALAPPDATA%` folders;
  - Edge opens with the device profile;
  - autostart from the packaged build.
- [x] 7.3 Reconcile:
  - `docs/desktop/{ARCHITECTURE,IMPLEMENTATION,STATUS}.md` (built rows with backticked refs; the planned sync rows stay planned for `desktop-sync`);
  - `docs/core/*` for `userAgent`, and `docs/web/*` for migration 0002;
  - the roll-ups `docs/STATUS.md` and `docs/IMPLEMENTATION.md`;
  - the CLAUDE.md edge-case Test cells for the desktop rows.

  Then write `docs/desktop/reviews/review-desktop-shell.md` and self-check every backticked ref. Report suggested decision rows instead of editing the decision log, if another agent may be editing CLAUDE.md.

## 8. Feedback fixes

- [x] 8.1 Fix: the word "null" appeared under the workspace header (the list passed a `null` section header to `replaceChildren`, which renders it as text). An ungrouped section gets no header when the workspace has no groups; with named groups it comes last under the workspace's label for them (10.5; first "Other", now core's default "Default"); no list text is ever the literal "null" or "undefined". Verify with viewmodel tests for both cases and a smoke assertion over the list text of both workspaces.
- [x] 8.2 Feature: a draggable border between the item list and the pane area (not the workspace rail). Width stored per PC as `listWidth` in `device.json` (default 270 px, clamped 180 to 600 px, never leaving the pane area under 320 px, sanitised on load); dragging uses `setOverlay`, recomputes pane rects live and once on release; double-click resets to the default. Verify with `apps/desktop/test/list-width.test.js` and store tests, and the smoke run (drag, clamps, reset, rects, persistence across `smoke:restart`).
## 9. Popup routing fix

- [x] 9.1 Fix: single sign-in for the productivity apps opened in the default browser and never returned to the app, because every new-tab window went to `shell.openExternal`. A pure `apps/desktop/lib/popup-route.js:routePopup` now decides (deny non-http(s) except about:blank; app window for `new-window`, identity hosts, auth-looking URLs and same-site URLs; the default browser otherwise), the `desktop-items` requirement "Links and popups from sites" and design.md are updated, and an app-window popup that closed after a sign-in reloads an opener that did not move. Verify with `apps/desktop/test/popup-route.test.js` (one test per rule branch, lookalike host) and the smoke run (an OAuth-looking `window.open(_blank)` opens an app window in the item's partition with the item's UA, a plain `target=_blank` link to another site goes external, `file:` is denied, about:blank opens an app window, the opener reloads).
## 10. Manual-check follow-ups

- [x] 10.1 Same-pane sign-in (D98): a sign-in that a site opens as a new tab (foreground-tab / background-tab; known identity host, auth-looking URL, or same-site) now loads in the opener's own pane (`routePopup` answers `'same-pane'`, `views.js` loads the URL in the opener view); `new-window` popups and `about:blank` stay app windows, everything else is unchanged, and the opener reload applies to app-window popups only. Spec `desktop-items` and design.md updated. Verify with `popup-route.test.js` (one test per branch) and smoke (a new-tab OAuth URL loads in the opener's view: no window, nothing external, the item's UA; a popup with features is an app window; the opener reloads when it closes).
- [x] 10.2 "+ Item" / "+ Group" move to a bottom bar of the list panel; the workspace title gets the full panel width with an ellipsis. The list frame is built once so the scroll position survives re-renders. Smoke asserts, at the minimum list width, that the title has the full width and the buttons sit below it inside the panel.
- [x] 10.3 Opening a fifth split shows the toast "Up to 4 panes per workspace" (smoke asserts the visible toast).
- [x] 10.4 The item switch "Keep logins" is renamed "Extend short logins" with the help text "Only affects logins a site would end when the app closes; a site's own long-lived logins are unaffected." (UI, `desktop-sessions` spec, manual checks; the data field `persistSessionCookies` is unchanged.)
- [x] 10.5 The ungrouped section header uses core `ungroupedLabelOf(ws)` (no header when the workspace has no named group; otherwise the label, default "Default"); the workspace editor gets "Name for items without a group" (at most 40 characters, blank = default, validated with core `validateWorkspace`; the store normalises and validates it). Verify with viewmodel and store tests and a smoke flow (label shown, 41 characters rejected inline, blank back to Default).
- [x] 10.6 Docs: no specific site is claimed to need the Firefox preset; the manual check is generic ("if a site refuses sign-in, try the Chrome or Firefox preset"); no third-party service is named (D107); deferred manual checks are listed in `docs/desktop/STATUS.md` (D106).

Also: dialogs (`ui/dialogs.js`) now release the native-view overlay when our own code closes them instead of waiting for the dialog's `close` event, which a busy or occluded window can deliver late (it left the views off the window in one smoke run in four).
## 11. Shortcut

- [x] 11.1 F3 opens the editor of the entry that has focus: a keyboard-focused list row (item), group header or workspace rail icon when the key is pressed in the app UI, otherwise the item shown in the focused pane; with nothing selected it does nothing. It works while a site has focus (`before-input-event` → `shortcutFor`, which tells the UI whether the key went to the UI or to a site). List rows, group headers and rail icons are keyboard-focusable with a visible focus ring (Enter acts as a click, a re-render keeps the focus), and the pure `viewmodel.js:editTarget` resolves the target. Spec `desktop-workspaces` has the requirement and scenarios. Verify with `shortcutFor` and `editTarget` unit tests and smoke (F3 from a site opens the pane item's editor; on a focused group row, list row and rail entry it opens that entry's editor; with nothing selected nothing opens).