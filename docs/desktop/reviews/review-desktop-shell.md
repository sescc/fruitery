# Review — desktop-shell

- Date: 2026-10-15
- Change: `desktop-shell` (tasks 2.1 to 7.3; task 1 is the core and web `userAgent` delta, done separately)
- Component: desktop (`apps/desktop/`), plus `scripts/install-desktop.mjs`

## Test summary
`npm test` from the repo root:
```
ℹ tests 455
ℹ pass 455
ℹ fail 0
```
Breakdown: core 146 + web 148 + desktop 161 = 455. Desktop by file: badge 3, cookie-transform 13, icon 3,
install 6, ipc-args 7, layout 15, list-width 5, popup-route 13, open 14, resolve-open 10, seed-select 5, sessions 9, sleep 7, store 28, ua 6,
viewmodel 12. No test imports Electron; helpers and the smoke run live outside `test/` (`apps/desktop/main/`).

`openspec validate desktop-shell --strict`: valid.

## Automated end-to-end run (`npm run smoke -w apps/desktop`, then `npm run smoke:restart -w apps/desktop`)
The real app against a local HTTP server, with Edge, the default browser and native dialogs replaced by recording
stubs and its own data folder under `%TEMP%`. Result: `SMOKE OK`, 173 checks in step 1 and 26 in the restart step.
The same run from the packaged folder (installed into a temporary folder with `install:desktop`) also printed
`SMOKE OK` with 173 checks and created `<folder>\data`.
- **Paths and window:** all Electron paths inside the data folder; sandbox and context isolation on, no Node in the
  UI; the UI imports core as ES modules from `file://` under `default-src 'self'`; disk-cache switch 500 MB.
- **Views:** a workspace switch keeps the same webContents id, URL, page state and scroll position with no new
  load; Ctrl+1/Ctrl+2 work from inside a site, Ctrl+5 with two workspaces does nothing; sleep and wake with the
  item's own workspace default, the item override, URL and scroll restored; a visible view never sleeps; 4 panes,
  the fifth refused, the same item twice focuses; every native view sits exactly in its pane box.
- **Sessions:** custom UA on the very first request; a UA change keeps the open page and applies at the next
  reload; a popup of a non-default item carries its UA in its request and in `navigator.userAgent`, a default-preset
  popup gets no override and no debugger; session cookies become
  persistent (~30 days, httpOnly and host-only kept) as they are set; an isolated item's cookie stays in its own
  partition; an extend-short-logins-off item's cookie stays a session cookie; file: popups open nothing, new-tab links go to
  the (stubbed) default browser; notifications follow the item, geolocation denied.
- **IPC:** only the UI frame is served (a site view and a foreign frame are refused); bad arguments are rejected;
  an invalid or non-http(s) item is rejected and nothing is saved; Edge is spawned with the item or device profile,
  one URL argument, no shell, and the pane layout is unchanged; a missing Google email blocks the open; a missing
  program falls back to its address in a pane.
- **UI:** seed rendered (rail, groups with progress, items); workspace switch from the rail without a reload;
  2-pane split; Done / Undo; the D8 prompt on Next and List only (Yes, No, Cancel); switching and Ctrl+Tab never
  prompt; "Basket full 🧺"; the Not due section with its next date.
- **Editors:** an invalid item is rejected inline and nothing is saved; add, edit, move to another workspace,
  delete with confirmation; drag reorder; dropping an item on a pane edge splits; groups and workspaces added,
  renamed and deleted; settings saved; the views are off the window while a dialog or drag is open.
- **Restart:** selected workspace, last shown item, edits, tombstones, reorder, settings and ticks persisted.
- Screenshots of the UI states were reviewed (the capture shows the UI only, not the native site views).

## Checklist (FRAMEWORK §8)
Legend: [x] pass · [ ] fail · [~] not applicable

### Coherence
- [x] Placement honesty: pure logic is in `apps/desktop/lib/` and takes the clock and the directory as parameters
  (`apps/desktop/main/store.js:openStore`); Electron is imported only by `apps/desktop/main/main.js`, `paths.js`,
  `views.js` and `tray.js`.
- [x] Transmission well-typing: the IPC contract is in `docs/desktop/ARCHITECTURE.md` §8b and every handler validates
  its input (`apps/desktop/lib/ipc-args.js:idArg`).
- [x] Law 1 / security: site views have no preload, sandbox and context isolation
  (`apps/desktop/main/views.js:createViews`), asserted by the smoke run; only the UI window's own frame reaches `ipc`.
- [x] Placement totality: every Trn in `docs/desktop/ARCHITECTURE.md` §7 has a built ref in
  `docs/desktop/IMPLEMENTATION.md`, except `syncPull` / `syncPush` (planned for `desktop-sync`).
- [x] Dependency mediation: core is imported by the UI and main; there is no path from a site to main.
- [x] Composition soundness: rules 1 to 12 are enforced and tested (or marked manual) in
  `docs/desktop/IMPLEMENTATION.md`.

### Modeling smells
- [x] No parallel objects: the list view is deduced (`apps/desktop/lib/viewmodel.js:listModel`), done flags are never stored.
- [x] Deduced, not copied: buckets and next-due dates come from core.
- [x] Stored-deduced: none. Layouts and the active item are device state, not synced model (Q52).
- [x] Diagram ⇄ table: `docs/desktop/ARCHITECTURE.md` updated with the code, including the new rules 10 to 12.

### Process gates
- [x] Model updated together with the code (ARCHITECTURE, IMPLEMENTATION, STATUS, the roll-ups and `architecture-map.md`).
- [x] Boundaries have a single source: the snapshot shape is core's; the IPC contract is `ipc.js` plus `preload.cjs`.
- [x] Status updated (`docs/desktop/STATUS.md`, `docs/STATUS.md`).
- [x] Violated rules: none.
- [x] D53 (public-ready): no personal value in any new file (privacy grep for emails, home paths, machine and place
  names found nothing); `apps/desktop/data/`, `apps/desktop/release/` and `.cache/` are git-ignored (`git check-ignore`);
  the personal seed is read from the git-ignored `config/seed.local.json` (development) or `<exeDir>\seed.local.json`
  and never printed.
- [x] Portable (D36): after dev, smoke and packaged runs there is no new folder in `%APPDATA%` or `%LOCALAPPDATA%`
  (top-level names compared before and after), and neither `%LOCALAPPDATA%\electron` nor
  `%LOCALAPPDATA%\electron-builder` exists. Electron's download and electron-builder's tools are in `.cache/`.

## Feedback fixes after the first manual run (tasks 8 and 9)
- 8.1 no "null" list header; 8.2 draggable list border (width per PC).
- 9.1 popup routing: single sign-in opened as a new tab used to go to the default browser (D72 sent every new tab
  external). `apps/desktop/lib/popup-route.js:routePopup` keeps sign-ins in an app window (identity hosts, auth-looking URLs,
  same-site, about:blank) and sends other new tabs external; an app-window popup that closes after a sign-in reloads an
  opener that did not move. Unit tests per rule branch, plus smoke checks (OAuth-looking `window.open(_blank)` stays in the
  item's partition with its UA, plain links go external, `file:` denied, about:blank opens, the opener reloads).

## Follow-ups after the manual checks (task 10)
- 10.1 a sign-in arriving as a new tab loads in the opener's own pane (`same-pane`); sign-in popup windows stay app windows.
- 10.2 add buttons in a bottom bar, the workspace title with the full width; 10.3 the "Up to 4 panes per workspace" toast.
- 10.4 "Keep logins" is now "Extend short logins" with a help text; 10.5 the ungrouped header uses core `ungroupedLabelOf`
  and the workspace editor can rename it; 10.6 the docs name no specific site for the Firefox preset (D107: no third-party
  service names).
- Fixed a race found by the smoke run: dialogs waited for the native `close` event to put the site views back, and a busy
  window delivered it late (once in four runs); they now release the overlay themselves.

## Manual checks still to do (by the owner)
[general/manual-checks.md](../general/manual-checks.md): Google sign-in with the default identity, the Chrome/Firefox
presets for a site that refuses sign-in, the Task Manager End-task test (D66), the Edge profile, start with Windows, tray and
second launch, and an install over an existing install.

## Open
- The tray, close-to-tray, autostart, Google sign-in, End-task and the real Edge launch are not automated (see above).
- Cookie opt-out is host-suffix based: a cookie scoped to a parent domain of an opted-out host is still made
  persistent (documented risk in the design).
- Ticks use the local clock until `desktop-sync` (D41, D69); the Access login for the desktop is still an open
  question there (D75).
- electron-builder prints a "signing with signtool.exe" line and finishes with exit code 0; the exe is unsigned and
  keeps Electron's version metadata except the product name. Windows SmartScreen may warn on first run.
- The install folder is about 320 MB (Chromium dominates, D35).
- The drift check needs the files staged by the user; run it then and confirm 0 dead refs (my own check of every
  backticked `path:symbol` in the touched docs found 0 dead of 141, and every quoted test name resolves).

## Proposed decisions for the decision log (numbers to be assigned by whoever maintains it; Who: C)
- Popups of an item with a non-default preset get its UA through three layers (`web-contents-created` adoption, the
  DevTools emulation override, a session header rewrite), because `setUserAgent` in `did-create-window` does not reach a
  popup's first request or document. Default-preset popups are left untouched (D65, spike).
- Native site views are detached while an HTML dialog, an item drag or a divider drag is active (`setOverlay`); the D8
  prompt and the delete confirmation are native message boxes.
- `show(itemId, paneId?, {split})` performs the split in main, so open-resolution, the blocked and Edge rules and the
  layout edit are one tested path.
- Packaging stages the app and core into `.cache/stage` with the repo's relative layout; electron-builder reuses the
  Electron binary from `node_modules`; `.cache/package.json` sets `"type": "commonjs"` for the tools it downloads.
- Chromium's profile is `<data>\profile`; `cache.json` and `device.json` are in `<data>`; `paths.js` is the first import
  of the main process.
- The smoke run is the automated end-to-end verification (local server, stubbed Edge, browser and dialogs, its own data
  folder, restart step).

## Suggested CLAUDE.md edge-case Test cells

Edge cases whose "planned" Test cell can now name a test (plus new ones):
- Isolated item → `apps/desktop/test/sessions.test.js`: "an isolated item has its own partition, and its flag opts the whole partition out"; smoke "isolated item: the cookie is not in the shared partition".
- App killed from the tray → conversion at set time: `apps/desktop/test/sessions.test.js`: "a session cookie is re-set as a 30-day persistent one as it is set (shared partition)"; the End-task run itself is manual (D66).
- Fifth split pane / same item in two panes / closing the last split → `apps/desktop/test/layout.test.js`: "a fifth leaf is refused and the tree is unchanged", "an item already in another pane -> focus that pane, no second copy (split and setItem)", "closing a pane collapses into its sibling; the last leaf cannot be closed".
- Item from another workspace in a split; visible view never sleeps → `apps/desktop/test/sleep.test.js`: "an item of another workspace shown in a split uses its own workspace default once hidden", "a visible view (hiddenSince null) never sleeps".
- URL containing `&` in Edge → `apps/desktop/test/open.test.js`: "a url containing & is passed as one argument, never through a shell".
- Corrupt `cache.json` → `apps/desktop/test/store.test.js`: "a corrupt cache.json is moved aside and the app falls back to the seed".
- Cookie re-save → `apps/desktop/test/cookie-transform.test.js`: "host-only stays host-only: no domain is passed", "a __Host- cookie never gets a domain, even when hostOnly is not reported"; `apps/desktop/test/sessions.test.js`: "extend-short-logins off: cookies of that item's host stay session cookies; other hosts are converted".
- App exe missing → `apps/desktop/test/resolve-open.test.js`: "app: present program -> app; missing program -> its fallback url in a pane".
- Blank Edge profile → `apps/desktop/test/open.test.js`: "a blank profile means Edge's own default: no flag".
- Portable data → smoke "data folder contains cache.json and device.json" plus the before/after folder comparison above.
- New: missing Google email blocks the open → `apps/desktop/test/resolve-open.test.js`: "blocked: missing Google email, unknown token, no url, bad timezone"; Ctrl+5 with fewer workspaces → smoke "Ctrl+5 with only 2 workspaces changes nothing"; a file: or custom-scheme popup → smoke "a file: popup opens nothing"; a second install keeps `data\` → `apps/desktop/test/install.test.js`: "a second install over it keeps data/ intact (marker file) and replaces the program files".
- Still planned (needs `desktop-sync`): offline tick on the desktop, the Access session expiry on the desktop.

Verdict: PASS (pending the manual checks above)
