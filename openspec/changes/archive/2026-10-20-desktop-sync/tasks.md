# Tasks

## 1. Worker: service tokens

- [x] 1.1 Check the current Cloudflare docs for the service-token JWT claims and the `ctx.access.getIdentity()` shape for service tokens, and record the findings (with source URLs) in `docs/web/general/service-tokens.md`. Then extend `apps/web/src/auth.js` (`SERVICE_TOKEN_IDS`, the identity `{serviceToken}`, the reason codes `service-token-not-allowed` and `service-token-ids-missing`). Verify with `auth.test.js` and `api.test.js` (the `sync-api` delta scenarios, plus the two cross-checks in design.md); all existing auth tests stay green.

## 2. Desktop: key storage and settings

- [x] 2.1 `main/secrets.js` (safeStorage save/load/delete, refuses when encryption is unavailable) and the `SyncConfig` in `device.json` (sanitised). Verify with tests on the pure parts (sanitising, HTTPS-only address validation with the dev-mode exception) and smoke (save ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ load round-trip; a corrupted file ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ not connected).
- [x] 2.2 The Sync settings UI plus the IPC (`syncConfigure`, `syncTest`, `syncDisconnect`, `syncStatus`). The secret never crosses to the renderer: smoke asserts that the state sent to the UI contains no secret.

## 3. Desktop: sync engine

- [x] 3.1 `lib/sync-plan.js` (`mergeSnapshot`, `enqueue`, `afterPush`, `firstSyncTicks`, `statusOf`). Verify with tests covering newer-remote, newer-outbox, a tombstone either way, dedupe, a 422 marking, current-period tick selection, and every status, including expiring at 14 and 15 days and expired.
- [x] 3.2 `main/sync.js`: the scheduler, push then pull, offline handling, the first-connect flow, store `enqueue` hooks. Local-only mode stays unchanged: existing store tests stay green.
- [x] 3.3 Ticks through the API when connected, disabled with a notice when offline, errored or expired.

## 4. UI and programs

- [x] 4.1 The rail status chip, the "Needs attention" list (Fix / Discard) and the tick-disabled notice.
- [x] 4.2 D89 program confirmation (`approvedPrograms` in `device.json`; the confirm dialog; a decline opens the fallback). Verify with `resolve-open` and `store` tests and a smoke check (stubbed dialog).

## 5. Verification and docs

- [x] 5.1 Extend the smoke run with the local API harness from design.md (connect, pull, push, server-side edit appears, offline queue then reconnect, 422, tick via API, ticks disabled offline, corrupted secret, program confirmation). Run both smoke steps and a packaged smoke.
- [x] 5.2 Write `docs/desktop/general/sync-setup.md`, the user walkthrough: create a service token per PC (1 year), add a Service Auth policy to the Fruitery Access application, `wrangler secret put SERVICE_TOKEN_IDS`, deploy, then enter the key in Fruitery. Check the current Cloudflare UI labels against the docs and mark anything unverified.
- [x] 5.3 Run root `npm test`, `openspec validate desktop-sync --strict` and the privacy grep (D53/D107). Reconcile the docs (desktop and web ARCHITECTURE/IMPLEMENTATION/STATUS, roll-ups; the planned sync rows become built) and write `docs/desktop/reviews/review-desktop-sync.md`. Suggest CLAUDE.md rows in the report.
