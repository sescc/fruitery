# Desktop — status

## Headline
✅ Local shell (change `desktop-shell`), polish (change `desktop-polish`) and sync with the Worker (change `desktop-sync`, code complete) are built, and ticks made without a connection are queued and sent later (change `offline-ticks`, D147): 433 desktop tests and the automated smoke run (SMOKE OK 365 checks plus 28 in the restart step from source; packaged 295 + 28 (the real-Worker phase [W] skips itself there, D144)) green. Offline ticks need the Worker redeployed once (`npm run deploy:web`); until then queued ticks wait (nothing is lost). Sync is set up on the owner's first PC and connected to the deployed Worker (2026-10-20); a second PC needs its own token (see [general/sync-setup.md](general/sync-setup.md)). The section 11 manual checks ([general/manual-checks.md](general/manual-checks.md)) passed on 2026-10-20 except four (see "Deferred manual checks"). Several manual checks are still deferred (see "Deferred manual checks").

## Completeness
| Object / morphism | State | Notes |
|---|---|---|
| shell (rail, list, panes, splits) | ✅ built | `apps/desktop/ui/`, `apps/desktop/main/views.js`, `apps/desktop/lib/layout.js` |
| partitions + cookie persistence | ✅ built | `apps/desktop/main/sessions.js`, `apps/desktop/lib/cookie-transform.js`; abrupt-shutdown test D66 is manual |
| sleep/wake | ✅ built | `apps/desktop/lib/sleep.js`, `apps/desktop/main/views.js` |
| Edge/app launch | ✅ built | `apps/desktop/lib/resolve-open.js`, `apps/desktop/main/open.js`; the real Edge launch is a manual check |
| resizable item list (width per PC) | ✅ built | `apps/desktop/lib/list-width.js`, `apps/desktop/ui/app.js` (feedback fix 8.2) |
| popup routing (sign-ins stay in the app) | ✅ built | `apps/desktop/lib/popup-route.js`, `apps/desktop/main/views.js` (fixes 9.1 and 10.1) |
| editors and settings | ✅ built | `apps/desktop/ui/editor.js`, `apps/desktop/main/store.js` |
| tray, close-to-tray, autostart | ✅ built | `apps/desktop/main/tray.js`; manual check only |
| sync client + cache (change `desktop-sync`) | ✅ built; smoke-tested against the real Worker handler locally; connected to the deployed Worker by the owner 2026-10-20 | `apps/desktop/main/sync.js` (engine), `apps/desktop/lib/sync-plan.js` (merge, outbox, status), `apps/desktop/main/sync-http.js`, `apps/desktop/main/secrets.js`, `apps/desktop/main/store.js` (outbox); two-way sync with last-write-wins per entity, offline queue, ticks through the Worker; verified against the real Worker handler on an in-memory D1 (`apps/desktop/test/sync-integration.test.js`) and in smoke; the real deployment check passed 2026-10-20 |
| sync settings, status chip, Needs attention | ✅ built | `apps/desktop/ui/editor.js` (Settings, Sync), `apps/desktop/main/sync-settings.js`, `apps/desktop/lib/sync-label.js`, `apps/desktop/ui/rail.js`, `apps/desktop/ui/app.js`; the secret is encrypted with `safeStorage` and never reaches the UI |
| offline ticks (change `offline-ticks`, D147 to D153) | ✅ built; needs the Worker redeploy and a manual check | `apps/desktop/lib/sync-plan.js` (`enqueueTick`, `applyTickOps`, `afterTickSend`, `hasTickFeature`), `apps/desktop/main/store.js` (`queueTick`, `queueUntick`, notices, clock offset), `apps/desktop/main/sync.js` (routing, `sendTicks`, the capability gate), `apps/desktop/lib/sync-label.js`; a tick or untick made offline is applied at once, shown pending (dashed ring), sent later with the time it was made; the Worker files it under the right day; a tick older than 48 h is dropped with a notice; verified against the real Worker handler (`apps/desktop/test/sync-integration.test.js`) and in smoke phase [W]; the real offline check is the owner's |
| program confirmation (D89) | ✅ built | `apps/desktop/lib/program-approval.js`, `apps/desktop/main/ipc.js`; approvals are per PC |
| shortcuts F5 / F6 / Alt+arrows, mouse side buttons, hints (D118) | ✅ built | `apps/desktop/lib/shortcuts.js`, `apps/desktop/main/main.js`; the real side-button delivery is a manual check |
| pane title, address field, page actions and page menu (D120, D121) | ✅ built | `apps/desktop/lib/address.js`, `apps/desktop/lib/page-menu.js`, `apps/desktop/ui/panes.js`, `apps/desktop/main/views.js` |
| item icons (D116) | ✅ built | `apps/desktop/main/icons.js`, `apps/desktop/lib/favicon.js`; GIF / WebP / SVG icons are not decoded (letter stays) |
| Daily bar without prompt, tick circle, return toast (D117, D119) | ✅ built | `apps/desktop/ui/app.js`, `apps/desktop/ui/list.js`, `apps/desktop/lib/return-tracker.js` |
| Daily-bar streak (D156) | ✅ built | `apps/desktop/ui/panes.js` (`streakChip`, `SHOW_LONGEST` flag), core `streak`; "🔥 N · best M" for scheduled panes |
| Ctrl+Enter → www.<host>.com in the address field (D155) | ✅ built | `apps/desktop/lib/address.js` (`wrapDotCom`), `apps/desktop/ui/panes.js` |
| item `deepLink` editable (phone-only open-target, D157) | ✅ built | `apps/desktop/ui/editor.js`, `apps/desktop/main/store.js` (`ITEM_KEYS`, `itemDefaults`); the desktop stores/syncs it but never opens it |
| pinned-item strip (D159) | ✅ built | `apps/desktop/lib/pin-strip.js`, `apps/desktop/ui/pin.js`, `apps/desktop/main/store.js` (`pinnedItemId`/`pinnedCollapsed`), `apps/desktop/main/views.js` (never sleeps while pinned), `apps/desktop/ui/panes.js` (`__pin` rect), `apps/desktop/main/ipc.js` (`setPin`, menu); any item can be pinned (e.g. a time-tracking site) |
| configurable disk-cache cap + clear web cache (D160) | ✅ built | `apps/desktop/lib/disk-cache.js`, `apps/desktop/main/paths.js` (reads `diskCacheMB`), `apps/desktop/main/sessions.js` (`clearCache`), `apps/desktop/main/ipc.js` (`clearWebCache`), `apps/desktop/ui/editor.js` (Settings) |
| portable `dir` packaging | ✅ built | `apps/desktop/electron-builder.yml`, `scripts/install-desktop.mjs`; the install folder is about 320 MB |

## Deferred manual checks
Not yet done by the owner; listed so they are not forgotten (details in [general/manual-checks.md](general/manual-checks.md)):
1. Single sign-in as a new tab loads in the same pane (section 1b, after fix 10.1).
2. A site that refuses sign-in with the default identity: try the Chrome or Firefox preset (section 2).
3. The Task Manager End-task test and a restart with logins kept (D66, section 3).
4. Start with Windows from the packaged build (section 6).
5. The resizable list border and the 4-pane message by hand (section 8b).
6. F3 to edit the focused entry, from a site and from the lists (section 7).
7. Mouse side buttons and browser keys (one press = one step), the pane title click / double click, page actions and menu, icons, the tick circle, the return toast after an Edge open, and the Done / Next flow (section 10).
8. From the sync checks (section 11), not run by hand (the smoke covers them): the Daily bar, Disconnect, a copied data folder, and "Start this program?".

## Needs work
1. Done 2026-10-20: the owner finished the token setup on the first PC; the desktop is connected to the deployed Worker.
2. The section 11 manual checks of sync ([general/manual-checks.md](general/manual-checks.md)) pass (2026-10-20), except the Daily bar, Disconnect, copied data folder and "Start this program?", which were not run by hand (listed as deferred above).
3. The deferred manual checks above, plus the offline-tick checks in section 11 of the manual checks (Wi-Fi off, tick, Wi-Fi on; a tick queued more than 48 hours).
4. Redeploy the Worker once (`npm run deploy:web`): until it lists `tick-done-at`, queued ticks wait with the notice "Queued ticks wait for a Worker update" (nothing is lost).
5. Second PC: its own token, its Client ID added to `SERVICE_TOKEN_IDS`, then connect (sync-setup.md).
6. Before an access key expires: renew it (sync-setup.md, "Renewing a key before it expires"). The chip warns 14 days ahead when an expiry date is entered.
## Coherence
No FAILs. Reviews: `docs/desktop/reviews/review-desktop-shell.md`, `docs/desktop/reviews/review-desktop-sync.md`, `docs/desktop/reviews/review-offline-ticks.md`.

## Where to dig
- Model: ARCHITECTURE.md · Code map: IMPLEMENTATION.md · Setup: [general/sync-setup.md](general/sync-setup.md)
- In flight: none · Archived: `openspec/changes/archive/2026-10-21-offline-ticks/`, `openspec/changes/archive/2026-10-20-desktop-sync/` (the owner's token setup and the manual check, section 11, remain), `openspec/changes/archive/2026-10-16-desktop-shell/`, `openspec/changes/archive/2026-10-20-desktop-polish/` · Specs: `openspec/specs/desktop-workspaces/`, `openspec/specs/desktop-sessions/`, `openspec/specs/desktop-items/`, `openspec/specs/desktop-sync/`
