# Design

## Context
- **Built:** core (`bucket`, `nextDue`, `expandUrl`, `validateItem`, `reorder`, `moveItem`,
  `effectiveSleep`, `effectiveEdge`, `mergeLww`, `SEED`) and web (the API and the PWA; the API
  is not used here).
- **Model:** `docs/desktop/ARCHITECTURE.md`. **Spike results and the cookie-transform rules:**
  `docs/desktop/general/spike-electron.md`.
- **Conventions:**
  - plain JS ES modules, JSDoc + `// @ts-check`;
  - devDependencies only `electron` and `electron-builder`;
  - pure logic tested with `node:test`;
  - nothing identifying in committed files (D53).
- **Local-only** for this change. Sync is `desktop-sync`.

## Goals / Non-Goals
**Goals:** the shell and the behaviour in the three desktop specs, the `userAgent` core/web delta,
and portable packaging.

**Non-Goals:**
- sync with the Worker, the Access login and server-clock ticks (`desktop-sync`);
- taskbar overlay badges;
- auto-update;
- any OS other than Windows;
- per-site recipes.

## Decisions

### Model delta (§2/§3)
**Objects:**
- `Layout` (split tree): `Leaf{type:'leaf', paneId, itemId|null}` ⊕
  `Split{type:'split', dir:'row'|'col', ratio:0.1..0.9, a, b}`, with at most 4 leaves.
- `ViewState{itemId, url, scrollY, hiddenSince|null, awake}`, in main-process RAM only.
- `DeviceSettings{edgeProfile|null, autostart, closeToTray:true, activeWorkspaceId, activeItemByWorkspace,
  layouts:{[workspaceId]: Layout}, focusedPaneByWorkspace, windowBounds}`, in `device.json`.
- The cache is `Snapshot{workspaces, groups, items, settings, completions}`, the same shape as
  `GET /api/state`, so `desktop-sync` merges it with `mergeLww`.

**Morphism:** `Item.userAgent : Item → {preset:'default'|'chrome'|'firefox'|'custom', custom:𝕊|null}`
(Total, defaulting to default).

**§3 check:** no new item kinds. The UA is a new morphism on `Item`, not a new object. The
layout is device state, not part of the synced model (Q52).

**Laws:**
- **Law 1:** sites get no preload, so they cannot reach the main process. The UI reaches it only
  through the preload bridge.
- **Law 6:** `bucket` and `validateItem` are also placed in the desktop UI renderer, and
  `validateItem` in main.

### Package layout
```
apps/desktop/
  package.json            @fruitery/desktop; devDeps electron, electron-builder; scripts: start, smoke, package
  launcher.mjs            sets electron_config_cache (+ ELECTRON_BUILDER_CACHE) to <repo>/.cache/electron, then spawns Electron on main/main.js (D48)
  electron-builder.yml    target dir, win x64, electronLanguages [en-US], asar, files: main/**, ui/**, preload.cjs, ../../packages/core/*.js (non-test)
  preload.cjs             contextBridge → window.fruitery (the IPC contract below)
  main/main.js            entry; first statements: portable paths, disk-cache-size 500 MB, single-instance lock
  main/paths.js           dataDir(): packaged → <dirname(execPath)>/data; dev → apps/desktop/data (git-ignored)
  main/store.js           load/save cache.json + device.json (atomic: write tmp then rename); first-run seed selection
  main/views.js           ViewManager: create/attach/detach/sleep/wake WebContentsViews; popups; badges; UA
  main/sessions.js        partition per item; cookie hook; permission handlers; disk cache
  main/open.js            Edge and native-app effects (uses pure resolveOpen)
  main/tray.js            tray, close-to-tray, login item
  main/ipc.js             ipcMain handlers → store/views; broadcasts state
  lib/ (pure, tested)     layout.js, sleep.js, cookie-transform.js, ua.js, resolve-open.js, badge.js, seed-select.js, edge-path.js
  ui/                     index.html (CSP: default-src 'self'), styles.css, app.js, rail.js, list.js, panes.js, editor.js, dialogs.js
  test/*.test.js          pure lib tests (no Electron import)
scripts/install-desktop.mjs  copy the built folder to a target dir, never touching <target>/data
```
- **Core in the UI:** the UI renderer imports core directly (`../../../packages/core/index.js`;
  file:// ES modules). The package build copies core into the asar under the same relative path.
- **Ignored:** `apps/desktop/data/`, `apps/desktop/release/` and `.cache/`.

### Window and IPC contract
- **One `BrowserWindow`** with the UI renderer (`ui/index.html`). Its `webPreferences` are
  `preload`, `contextIsolation` and `sandbox`. It has no `nodeIntegration` and no `webviewTag`.
- **The UI owns layout math.** It renders the rail, the list, and for each pane a header (title,
  Daily bar, close and split buttons) plus an empty content box. It sends the content boxes' rects
  to main.
- **Main positions views.** It places each item's `WebContentsView` in those rects, via
  `win.contentView.addChildView`/`removeChildView` and `setBounds`.
- **`window.fruitery` (preload):**
  - **State:** `getState() → {snapshot, device, viewStates, badges, now}` and
    `onState(cb)`, which main pushes after every change.
  - **Views:** `show(itemId, paneId?)`, `setLayout(workspaceId, layout, focusedPaneId)`,
    `setPaneRects(rects:[{paneId,itemId,x,y,w,h}])`, `selectWorkspace(id)`,
    `navigate(itemId, 'back'|'forward'|'reload'|'home')`.
  - **Ticks and edits:** `tick(itemId)`, `untick(itemId)`, `upsert(partial snapshot)` (main
    stamps `updatedAt=Date.now()`, validates, saves and broadcasts; it answers `{ok}` or
    `{errors}`), `reorder(kind, parentId, id, toIndex)`, `moveItem(itemId, toWorkspaceId)`,
    `remove(kind, id)` (tombstone), `saveSettings(patch)`, `saveDevice(patch)`.
  - **Effects:** `openInEdge(itemId)`, `contextMenu(itemId)` (a native menu: Edit, Open in split
    right/down, Open in Edge, Move to…, Delete).
- **Shortcuts:** handled in main with `before-input-event` on every webContents (UI and sites),
  so they work while a site has focus. Ctrl+1..9 (workspace) and Ctrl+Tab/Ctrl+Shift+Tab
  (item) are forwarded to the UI.

### Views, sleep and switching (`main/views.js`, `lib/sleep.js`, `lib/layout.js`)
- **One live view per item** (`Map itemId → {view, state}`).
- **Workspace switch or layout change:** views not in the new rect set are removed from the
  window but kept alive, with `hiddenSince=now`. Views in the set are added and bounded. Nothing
  reloads.
- **Sleep timer:** every 30 s, `lib/sleep.js:dueToSleep(views, items, workspaces, now)` returns
  the item ids to unload: hidden, `effectiveSleep > 0` (the item's own workspace), and
  `now − hiddenSince ≥ minutes`. For each one, main reads `scrollY` via `executeJavaScript`
  (best effort, 500 ms timeout), stores `url`, and closes the webContents.
- **Wake:** create the view, load the stored `url` (else `expandUrl(item.url)`), and after
  `did-finish-load` restore the scroll position (best effort).
- **`lib/layout.js` (pure):**
  - `split(tree, paneId, dir, newPaneId, itemId)` (refuses a 5th leaf → `{error:'max-panes'}`);
  - `close(tree, paneId)` (the sibling takes the parent's place; the last leaf can't close);
  - `setItem(tree, paneId, itemId)` (if the item is in another leaf → `{focus: thatPaneId}`);
  - `resize(tree, path, ratio)` (clamped 0.1..0.9);
  - `rects(tree, box)`, where dividers take 4 px;
  - `leaves(tree)`;
  - `validate(tree)`.

### Sessions (`main/sessions.js`, `lib/cookie-transform.js`, `lib/ua.js`)
- **Partitions:** `persist:fruitery` (shared), or `persist:fruitery-<itemId>` when `isolate`.
  Each partition is set up once on first use.
- **Cookie hook** (ported from the spike; rules in `docs/desktop/general/spike-electron.md`):
  - On `cookies 'changed'` with `removed=false`, compute
    `toPersistentDetails(cookie, now, 30d)`, then `cookies.set`.
  - Debounce `flushStore()` by 1 s.
  - **Opt-out:** in the shared partition, skip cookies whose domain matches the URL host of an
    item with `persistSessionCookies=false`. Matching uses suffix rules on the item's hostname
    with `www.` stripped. In an isolated partition, the item's own flag applies.
  - Write the matching logic as a pure function in `lib/cookie-transform.js`
    (`isOptedOut(cookieDomain, optOutHosts)`).
- **UA:** `lib/ua.js:userAgentFor(preset, custom, electronDefaultUA)`.
  - `default` → Electron's UA unchanged (D65: it passed Google sign-in).
  - `chrome` → the default UA with the `Electron/x` and app-name tokens removed.
  - `firefox` → a current Firefox-on-Windows UA; keep its version in one constant.
  - `custom` → the string.
  - **Applied** with `webContents.setUserAgent` before the first `loadURL`, and copied to the
    item's popups. It is never changed on a live view; a preset change applies on the next wake
    or reload (Reload recreates the view if the preset changed).
- **Permissions:**
  - `setPermissionRequestHandler` and `setPermissionCheckHandler` per partition, mapping a
    webContents back to its item.
  - `notifications` → the item's `notify`.
  - Allow `clipboard-sanitized-write`, `fullscreen`, `pointerLock` and `media`.
  - Deny everything else (geolocation, midi, hid, serial, usb, …).
- **Popups:** `setWindowOpenHandler` asks the pure `lib/popup-route.js:routePopup({url, disposition,
  features, frameName, openerUrl})`, which answers `'same-pane' | 'app-window' | 'external' | 'deny'`.
  - Not http(s) and not `about:blank` → deny. `about:blank` (a script-opened sign-in window that
    navigates next) → app window.
  - `disposition === 'new-window'` → app window.
  - A new tab that is a sign-in (a known identity host from a small exported suffix-matched list, some
    only for sign-in paths; or a path/query that looks like an auth flow: `oauth`, `oauth2`,
    `authorize`, `auth`, `sso`, `signin`, `sign-in`, `login`, `saml` segments, `client_id`+`redirect_uri`,
    `response_type`, `SAMLRequest`; or same-site as the opener by an approximate registrable domain):
    as `foreground-tab` / `background-tab` → `same-pane` (the handler loads the URL in the opener's own
    view and denies the new window, because in a normal browser that tab would be the app); any other
    disposition → app window.
  - Any other new tab → `shell.openExternal(url)` and deny.
  - An app window is a child `BrowserWindow` with the same partition, sandbox and no preload; its UA is
    applied as in D65 (see the UA section) and its own popups route through the same function.
  - When an app-window popup closes, the opener view is reloaded if it is still on the address it had
    when the popup opened and the popup visited a sign-in URL (`shouldReloadOpener`). A same-pane sign-in
    has no window, so nothing is reloaded.  - `will-navigate` is not restricted for sites, which are browsers. The UI renderer denies all
    navigation and `window.open`.
- **Disk cache:** `app.commandLine.appendSwitch('disk-cache-size', String(500*1024*1024))`
  before ready.

### Opening (`lib/resolve-open.js`, `main/open.js`, `lib/edge-path.js`)
`resolveOpen(item, workspace, settings, device, now, appExists:boolean)` returns one of:
- `{kind:'blocked', reason:'missing-google-email'|'unknown-token'|'no-url'}`;
- `{kind:'edge', url, profile|null}`, via `effectiveEdge`;
- `{kind:'app', path}`;
- `{kind:'pane', url}`, which is also the fallback for an app whose program is missing.

`url` comes from `expandUrl` with `settings.timezone`.

**Edge:** `lib/edge-path.js:edgeCandidates(env)` returns the
`%ProgramFiles(x86)%` and `%ProgramFiles%` `Microsoft\Edge\Application\msedge.exe` paths.
- `main/open.js` spawns the first one that exists with
  `spawn(exe, [...(profile ? ['--profile-directory=' + profile] : []), url], {detached:true, stdio:'ignore', shell:false})`.
- **Never through a shell,** so a URL containing `&` can't inject a command.
- If no exe is found, it falls back to `shell.openExternal('microsoft-edge:' + url)`.

**App:** `shell.openPath(path)`.

### Store (`main/store.js`, `lib/seed-select.js`)
- **Files:**
  - `cache.json` holds the snapshot;
  - `device.json` holds the device settings.
  - Writes are atomic: write `*.tmp`, then `fs.renameSync`.
- **Corrupt file:** move it aside to `*.corrupt-<ts>.json`, then fall back to the seed. Never
  crash.
- **First run (`lib/seed-select.js:selectSeed(localJsonText|null, SEED)`):**
  - Use `config/seed.local.json` from the repo root in dev, or `<exeDir>/seed.local.json` when
    packaged (the install script copies it if present).
  - If it is valid (every item passes `validateItem`), use it; otherwise use `SEED`.
  - Completions start empty.
- **Ticks:** `periodKey(schedule, Date.now(), settings.timezone, resetTime)` and an idempotent
  upsert into `completions`. This is a local, interim clock; `desktop-sync` moves ticks to the
  server (D41).
- **Edits:**
  - `upsert` merges the patch onto the stored entities by id and stamps `updatedAt`.
  - Every item touched is checked with `validateItem` (groups included). On errors, nothing is
    saved and `{errors}` is returned.
  - `remove` sets `deleted:true` (tombstone), and the UI filters deleted entities.
  - `reorder` calls core `reorder` on the siblings.
  - `moveItem` calls core `moveItem`, then places the item last among the target's ungrouped
    items.

### UI (`ui/*`, plain DOM)
- **Rail:**
  - workspace icons (the initial letter if there's no icon) plus a badge total;
  - drag to reorder;
  - right-click: rename or delete;
  - a "+" button.
- **List:**
  - groups (collapsible, with "done/total" progress), then items; the "Not due" `<details>`
    section; "Basket full 🧺" when no due items remain;
  - per-item badge count; drag to reorder within or between groups;
  - right-click opens the native menu;
  - the workspace title on top with the full panel width (ellipsis when long), the scrolling list in the
    middle and the "+ Item" / "+ Group" buttons in a bottom bar of the panel;
  - ungrouped items have no header when the workspace has no named group; otherwise they come last under
    the workspace's label for them (default "Default"; core `ungroupedLabelOf`);
  - the border to the pane area is draggable (width per PC, `listWidth`).
  - A fifth split shows the toast "Up to 4 panes per workspace".
- **Panes:** a header with the item name and loading state, Back, Reload, Split right, Split
  down and Close.
- **Daily bar:** for scheduled items, `Done/Undo · Next · List`. The prompt rule is D8: Next and
  Back on an unticked item ask "Mark <name> done?" (Yes / No / Cancel).
- **Dialogs (HTML `<dialog>`):**
  - **Item editor:** every field, schedule-type-dependent inputs, the UA preset, the "Extend short
    logins" switch (`persistSessionCookies`, with a help text), and inline errors from `validateItem`.
  - **Workspace editor:** name, icon, sleep time, Edge default, and "Name for items without a group"
    (at most 40 characters; blank = the default label).
  - **Settings:** timezone (a select from `Intl.supportedValuesOf('timeZone')`), Google email,
    Edge profile, start with Windows.
  - **Delete confirmation.**
- **Theme:** light and dark via `prefers-color-scheme`.
- **Drop zones:** dragging an item onto a pane shows left, right, top and bottom drop zones that
  map to `split`.

### Tray and autostart (`main/tray.js`)
- Tray icon (generated) with the menu Show and Quit.
- Closing the window hides it; only Quit exits.
- When `device.autostart` is on and the app is packaged:
  `app.setLoginItemSettings({openAtLogin:true, path:process.execPath, args:['--hidden']})`.
  When it is off, `openAtLogin:false`.
- Started with `--hidden`, the window is not shown.
- In dev the toggle is saved but not applied, with a note in the settings dialog.

### Packaging
- `npm run package -w apps/desktop` runs electron-builder (`dir`) through `launcher.mjs`, with
  the cache env set.
- Output: `apps/desktop/release/win-unpacked/Fruitery.exe`; `productName` and `executableName`
  are `Fruitery`.
- `scripts/install-desktop.mjs --to <dir>` (root script `install:desktop`):
  - copies `win-unpacked/*` into `<dir>`, skipping `<dir>/data`;
  - copies `config/seed.local.json` to `<dir>/seed.local.json` only if the target has none;
  - prints the path.
- The user runs it with their own target folder. Nothing personal is committed.

### Core and web delta (`userAgent`)
- **`packages/core/model.js`:**
  - add `userAgent?: {preset, custom}` to the `Item` typedef;
  - `validateItem` adds `userAgent.preset` invalid-value, and `userAgent.custom` required (when
    custom) or out-of-range (> 512 chars);
  - export `userAgentOf(item)`, which returns `{preset:'default', custom:null}` when the field is
    absent.
- **`packages/core/seed.js`:** example items get `userAgent:{preset:'default', custom:null}`.
- **Web:**
  - `apps/web/migrations/0002_item_user_agent.sql`: `ALTER TABLE items ADD COLUMN user_agent TEXT`
    (NULL = default);
  - `rows.js`: JSON-encode and decode it;
  - `store.js` shape: `userAgent` is an optional object;
  - `gen-seed-sql.mjs` includes it.
- **Tests:** core (the new spec scenarios) and web (round-trip, missing column → default).

## Risks / Trade-offs
- **Google's embedded-sign-in heuristics may change.** Mitigations: the per-item UA preset, popups,
  and "open in Edge".
- **`executeJavaScript` scroll capture fails on some sites.** It's best effort; the URL is
  always kept.
- **No automated end-to-end UI tests.** Pure logic is unit-tested. The shell is verified by an
  Electron smoke run plus the manual checklist below, the agent's in-app checks, and the user's
  sign-in and End-task tests.
- **The interim local tick clock.** It becomes the server clock in `desktop-sync`.
- **The cookie opt-out in the shared partition is host-suffix based.** Sites that share cookies
  across unrelated domains may still persist. Documented.

## Open Questions
None blocking.
