# Tasks

## 1. Pure logic (tested)
- [x] 1.1 `lib/shortcuts.js`: F5 / F6 / Alt+Left / Alt+Right (`nav`), `appCommandAction`; update the shortcut test. Verify: `shortcuts.test.js` cases incl. modifiers, key-up, F3 unchanged.
- [x] 1.2 `lib/address.js`: `normalizeAddress`, `createClickDecider`. Verify: unit tests for bare hosts, `localhost:3000`, paths, other schemes, spaces, long input, click timing.
- [x] 1.3 `lib/favicon.js`: `acceptIconUrl`, `sniffImage`, `pickIcoEntry`, `parseIconLinks`, `isOwnSite`, `iconFileName`; `lib/viewmodel.js:iconChoice`. Verify: unit tests.
- [x] 1.4 `lib/page-menu.js`: `pageMenuModel`, `pageEdgeProfile`; `lib/return-tracker.js`; `lib/viewmodel.js:nextDueForItem`. Verify: unit tests.
- [x] 1.5 PWA `view.js`: `iconOf` (`icon` and `iconUrl` on items and links) and `letterOf`. Verify: `view.test.js`.

## 2. Desktop main
- [x] 2.1 `main/icons.js` (capture, refresh, cache, size/time caps, ICO via temp file) and wiring in `views.js` (`page-favicon-updated`, own-site predicate, per-item revision). Verify: smoke (favicon served by the test server: PNG, ICO).
- [x] 2.2 `views.js`: navigate by shortcut per webContents, `navigateTo`, `currentUrl`, site `context-menu`, clipboard / Edge page actions. `ipc.js`: `copyAddress`, `navigateTo`, `openPageInEdge`, `getIcon`, `refreshIcon`, `iconRevs` in state, F3 accelerator label, return tracker arming. `main.js`: `app-command`, window blur / focus. `preload.cjs`: the new calls.

## 3. Desktop UI
- [x] 3.1 Daily bar: Done auto-advance, Next without prompt, List removed, delete the prompt code. Toasts beside the list with durations.
- [x] 3.2 List rows: icons, clickable tick circle; return toast `done-prompt`.
- [x] 3.3 Pane header: page title, click / double click, address field, Copy and Edge buttons, tooltips with keys. Editor: "Refresh icon" button and icon hint.

## 4. PWA
- [x] 4.1 `app.js` / `styles.css` / `index.html`: icon image with letter fallback; CSP meta with `img-src` only.
- [x] 4.2 `sw.js`: the `fruitery-icons` cache (cache-first, 30 days, sidecar timestamps, bounded, opaque allowed for icons only). Verify: a test that runs `sw.js` in a `node:vm` with fake `caches` and `fetch`; the build test still passes.

## 5. Verification and docs
- [x] 5.1 Smoke: every flow in the delta specs (shortcuts, title click and address field, header buttons, page menu entries, icon capture, Done / Next, tick circle, return toast); keep all existing checks green (update the ones for the old prompt and List). Run both smoke steps and a packaged smoke.
- [x] 5.2 Root `npm test`, `npm run build:web`, `openspec validate desktop-polish --strict`, the privacy grep (D53 / D107).
- [x] 5.3 Docs: `docs/desktop/{ARCHITECTURE,IMPLEMENTATION,STATUS}.md`, `docs/desktop/general/manual-checks.md`, the PWA icon rows in `docs/web/IMPLEMENTATION.md` (append only). Suggest CLAUDE.md rows in the report.
