# Proposal

## Why
The desktop app is Fruitery's main surface: one window with the user's workspaces, live sites
that keep their state, split panes, long-lived logins and the daily check-in flow (D5–D9,
D15–D17, D19, D30, D31, D36, D37, D65). Core is built and the spike settled the Electron risks
(`docs/desktop/general/spike-electron.md`). This change builds the shell as a **local-only** app:
workspaces, items and ticks live in a local cache. Syncing with the Worker is the follow-up
change `desktop-sync`, so the shell can be built and used before the first deploy.

## What Changes
- New package `apps/desktop` (Electron; devDependencies `electron` and `electron-builder` only).
- **Launcher and storage:**
  - a launcher keeps Electron's download cache inside the repo (D48);
  - portable data in `<exeDir>\data`, nothing in `%APPDATA%`/`%LOCALAPPDATA%` (D36);
  - single instance, tray, close-to-tray and start with Windows (D16).
- **Window (layout A, D9):**
  - workspace rail + item list + pane area;
  - Ctrl+1..9 and Ctrl+Tab;
  - workspace switches never reload a site (D30);
  - split panes up to 4 per workspace, with per-PC layouts (D31);
  - sleep/wake after `sleepAfterMin` hidden (D30).
- **Sessions:**
  - the shared persistent partition, with per-item isolation (D15);
  - session cookies made persistent as they are set (D37), per-item opt-out;
  - per-item user-agent preset (D65);
  - notification permission per item;
  - badges from page titles (D19, D42).
- **Opening items:** in a pane, in Edge with the device or item profile (D17), or as a native app
  falling back to its URL (D12).
- **Daily bar** on scheduled items: Done / Next / Back to list, with the "Done?" prompt only on
  Next and Back (D8).
- **Editor:** add, edit, delete, reorder and move workspaces, groups and items, plus
  settings (timezone, Google email) and device settings (Edge profile, autostart). Validation
  uses core.
- **Local cache:** `cache.json`, in the same shape as the API snapshot. The first run seeds from
  `config/seed.local.json` if present, else from the example `SEED`.
- **Packaging:** the electron-builder `dir` target (unpacked portable folder) and an install
  script that keeps `data\`.
- **Core and web delta:** a new `Item.userAgent` preset (validated in core, a D1 column through
  migration `0002`, mapped in the web rows).

## Capabilities

### New Capabilities
- `desktop-workspaces`: the window, the workspace rail and item list, switching without reloads,
  split panes, sleep and wake, keyboard shortcuts.
- `desktop-sessions`: where data is stored, long-lived logins, isolation, user-agent presets,
  notification and badge behaviour, tray and autostart.
- `desktop-items`: opening items (pane, Edge, native app), the Daily bar and ticking, and editing
  workspaces, groups, items and settings.

### Modified Capabilities
- `item-model`: adds the per-item user-agent preset and its validation.

## Impact
- **New code:** `apps/desktop/**`, `scripts/install-desktop.mjs`.
- **Changed code:**
  - `packages/core/model.js` (`userAgent`);
  - `apps/web/src/rows.js` and `apps/web/src/store.js` (column and shape);
  - `apps/web/migrations/0002_item_user_agent.sql`.
- **Dependencies:** `electron`, `electron-builder` (devDependencies of `apps/desktop`).
- **After apply, the user runs:**
  - the manual checks: Google sign-in with the default UA, the Task Manager End-task test (D66),
    and the `%APPDATA%` check;
  - `npm run migrate:remote` once, if the Worker is already deployed.
- **Later:** `desktop-sync` (Access login from the desktop, pull/push with `mergeLww`, ticks via
  the API with the server clock).
