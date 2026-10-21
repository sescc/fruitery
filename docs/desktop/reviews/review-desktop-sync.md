# Review — desktop-sync

> Ran after building. Checks the change against FRAMEWORK §4.5, the spec scenarios and the owner's rules. Not a prose review.

- Date: 2026-10-20
- Change: `desktop-sync` (tasks 1.1 Worker side, 2.1 to 2.2 key storage and settings, 3.x engine, 4.x status chip and
  program confirmation, 5.1 to 5.3 verification, setup guide and reconciliation)
- Components: desktop (`apps/desktop/`), with the Worker side in `apps/web/src/auth.js` (reviewed in `docs/web/IMPLEMENTATION.md` rule 11)

## Test summary
`npm test` from the repo root: 705 tests, 705 pass, 0 fail (core 146 + web 174 + desktop 385).
Desktop files of this change (tests): sync-config 23, sync-http 9, secrets 8, sync-settings 10, sync-plan 54, sync-label 10,
sync 39, sync-integration 5, program-approval 7; additions in store (33 in all), ipc-args (10 in all) and resolve-open (11 in all).
No test imports Electron. `apps/desktop/test/sync-integration.test.js` runs the real engine against the real Worker request
handler (`apps/web/src/api.js:handle`) on an in-memory D1, so the desktop and the server agree on the wire.

Automated end-to-end run (`npm run smoke -w apps/desktop`, then `npm run smoke:restart -w apps/desktop`, then the same from the
packaged folder): SMOKE OK 353 checks plus 28 in the restart step from source; packaged 295 + 28 (the real-Worker phase [W], 58 checks, skips itself there, D144)

The new smoke phase [S] checks, against a real local HTTP server: the encrypted secret file (round trip, encrypted bytes, a
corrupted file reads as no secret), the Access headers on the wire, a redirect read as "access key refused", a 403 reason,
that the secret and the full client id are in no IPC result and no state, and the Sync section of Settings (password field never
prefilled, Test connection, expiry-only change keeps the secret, a bad address marked inline, Disconnect with confirmation, the
views released afterwards). The program confirmation is checked in phase [I].

## Coherence laws
- [x] 1. **Placement honesty (ticks need `now` from the edge).**
  - `tickRemote` takes `now` from the Worker: `apps/desktop/main/sync.js:createSync` (tick, untick) sends `POST /api/ticks` /
    `DELETE /api/ticks/{id}`, and the returned completion is stored by `apps/desktop/main/store.js:applyCompletion`.
  - As built in desktop-sync: offline, error, expired or no stored key refused with `ticks-need-connection`. Refined later by `offline-ticks` (D147):
    offline and sync errors now queue the tick (see `docs/desktop/reviews/review-offline-ticks.md`); only an expired or unreadable key still refuses, with a notice
    (`apps/desktop/lib/sync-label.js:tickNotice`).
  - Tests: `apps/desktop/test/sync.test.js`: "connected: tick goes through POST /api/ticks and the returned completion is stored; untick uses DELETE",
    "a sync error also queues ticks; an expired key or a missing secret still refuses them",
    "a direct tick whose request fails on the connection is queued, and the status says offline", "configured but no readable secret (a copied data folder): not connected, no requests, ticking refused so no tick is lost";
    `apps/desktop/test/sync-integration.test.js`: "a tick makes the round trip: the server stores it with its own clock, and untick removes it";
    `apps/desktop/test/sync-label.test.js`: "the tick notice: none when ticking works, three wordings otherwise".
  - The only local tick left is the unconfigured PC's (local-only mode): "not configured: the interim local tick is unchanged and makes no request".
    This is a designed exception (rule 27 in `docs/desktop/ARCHITECTURE.md`), not a hole: with nothing configured there is no server to disagree with.
- [x] 2. **Transmission well-typing.** `t_api_desk` carries `Command/Query ⇄ Entity*, Completion*` from `L-desk` to `L-edgeW` and the reply is
  paired. The request is sorted into a typed `ApiResult` (`apps/desktop/lib/sync-config.js:classifyResponse`) and a failed request has one short
  code (`apps/desktop/lib/sync-config.js:reasonOf`). `t_ipc` gained five calls with validated arguments
  (`apps/desktop/lib/ipc-args.js:syncConfigureArg`, `apps/desktop/lib/ipc-args.js:syncDiscardArgs`).
  Tests: `apps/desktop/test/sync-config.test.js`: "classifyResponse: any 3xx or an opaque redirect (status 0) means Access refused the key",
  "classifyResponse: 403 carries the server reason, or \"forbidden\"", "classifyResponse: 422 is \"invalid\" with the body; everything else is \"http\" with the status";
  `apps/desktop/test/ipc-args.test.js`: "syncConfigureArg: the four values are short single-line strings; blank or absent become \"\"".
- [x] 3. **Placement totality.** Every Trn in `docs/desktop/ARCHITECTURE.md` §7 has a built `file:symbol` in
  `docs/desktop/IMPLEMENTATION.md`; the old "planned" row (`syncPull` / `syncPush`) is gone. Drift check: 0 dead of 242 refs in the three
  `IMPLEMENTATION.md` files (checked by substring against the working tree, because nothing is staged yet; run it again after you stage).
- [x] 4. **Dependency mediation (desktop → D1 only through the API).**
  - The only network seam to the Worker is `apps/desktop/main/sync-http.js:createRequestApi`; no desktop module opens D1 or imports `apps/web`.
    (The one other outbound fetch is the icon downloader, `apps/desktop/main/icon-fetch.js:fetchLimited`, which talks to the item's own site.)
  - The Worker re-checks identity and validity on every call (`apps/web/src/auth.js:authorize`, `apps/web/src/store.js:upsertEntities` with `validateItem`).
  - Tests: `apps/desktop/test/sync-integration.test.js`: "a desktop edit lands in D1 and is confirmed",
    "a change written directly to D1 appears after a pull, including a deletion"; `apps/desktop/test/sync-http.test.js`:
    "an incomplete key, a bad address or a path outside /api/ never reaches the network".
- [x] 5. **Composition soundness.** The desktop views of the shared objects are deduced from core and the snapshot shape; `SyncStatus` is deduced
  (`apps/desktop/lib/sync-plan.js:statusOf`), the queue holds ordinary entities (no new entity kind), and `DeviceSettings` gained two keys rather
  than a parallel object. Tests: `apps/desktop/test/sync-plan.test.js`: "statusOf: precedence is expired > error > offline > expiring > syncing",
  "mergeSnapshot: completions come from the remote only".
- [x] 6. **`runsAt` is a relation (merge and validation in both places).**
  - `mergeLww` runs in the desktop (`apps/desktop/lib/sync-plan.js:mergeSnapshot`) and in the Worker (the upsert); `validateItem` /
    `validateWorkspace` run in the desktop store before an edit is stored or queued, in the editors, and again in the Worker. Both come from `packages/core`.
  - Tests: `apps/desktop/test/sync-plan.test.js`: "mergeSnapshot: a newer remote entity beats an older outbox entry",
    "mergeSnapshot: a newer outbox entity beats the remote one", "mergeSnapshot: on equal timestamps the outcome follows the core tie-break, whatever the side";
    `apps/desktop/test/sync.test.js`: "an invalid edit queues nothing"; `apps/desktop/test/sync-integration.test.js`:
    "the server's 422 marks the entry and the pull still happens; the other entries get through" (an entry the desktop let through that the Worker refuses).

## Owner rules and spec scenarios
- [x] **The secret never reaches the renderer.**
  - Stored encrypted (`apps/desktop/main/secrets.js:createSecrets`), read in main per request (`apps/desktop/main/sync.js:createSync` (key)),
    sent only in the `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers (`apps/desktop/main/sync-http.js:createRequestApi`). No `console` call in
    the sync modules. The state the UI gets omits `device.sync` and carries only the last 4 characters of the client id.
  - Tests: `apps/desktop/test/sync-settings.test.js`: "configure saves the config and the encrypted secret; status shows only the tail, never the id or secret",
    "test results never contain the secret"; `apps/desktop/test/sync.test.js`: "disconnect resets the first-sync marker and the queue; the status carries no secret and no full client id";
    smoke phase [S]: "sync: the secret is in no IPC result and no state sent to the UI", "sync: the full client id is not in the state either (only the tail via syncStatus)".
  - Residual: the secret is typed into the Settings field in the renderer and crosses once, inward, in the `syncConfigure` call. That is unavoidable for
    entry and is not echoed back.
- [x] **A copied data folder asks for the key again.** `apps/desktop/main/secrets.js:createSecrets` (loadSecret) returns null on a foreign or corrupt file; the status is
  `not-connected`, no request is made and ticking says it needs the access key. Tests: `apps/desktop/test/secrets.test.js`: "missing, empty, corrupted or foreign-user files read as no secret (a copied data folder asks again)";
  `apps/desktop/test/sync-settings.test.js`: "copied data folder: the config is there but the secret cannot be decrypted, so it is not connected"; smoke:
  "sync: with a corrupted secret, syncStatus says configured but not connected".
- [x] **Local-only mode is unchanged.** With nothing configured: no requests, no timers, no outbox growth, the cache untouched, and the local tick as before.
  Tests: `apps/desktop/test/sync.test.js`: "local-only mode: no requests, no timers, no outbox growth, and the cache stays as it was",
  "not configured: the interim local tick is unchanged and makes no request"; `apps/desktop/test/store.test.js`: "sync: an old device.json without it loads fine; junk in the file is cleaned on load";
  the whole pre-existing smoke run (which runs unconfigured) still passes.
- [x] **Two-way sync and offline edits (spec scenarios).** Edit on the PC → pushed ("a desktop edit lands in D1 and is confirmed"); edit elsewhere → pulled
  ("a change written directly to D1 appears after a pull, including a deletion"); offline kept and sent later ("offline keeps the outbox, sets the status, and the next good flight sends it");
  rejected change marked, others still sent, Discard re-pulls ("a 422 marks the listed entry, still sends the others, and the pull still happens", "discard drops a rejected entry and the pull brings back the server's version; a local-only entry disappears").
- [x] **First connect keeps newer local edits** (owner decision 2026-10-20): backup, push the newer local entities, never untouched seed rows, send the current-period ticks, then the server's history.
  Tests: "first connect: backs up the cache, pushes the newer local edit, posts the current-period ticks, pulls, then sets the marker",
  "first connect: a newer server entity is not overwritten by an older local edit", "first connect against the real Worker: newer local edits win, older ones lose, seed rows stay quiet".
- [x] **Sync status and key expiry.** `statusOf` and the chip: expiring from 14 days ahead, expired after the date, the "syncing" gate. Tests: `apps/desktop/test/sync-plan.test.js`:
  "statusOf: expiry boundaries in whole calendar days"; `apps/desktop/test/sync-label.test.js`: "expiring: today, 1 day, many days, and the 14 day edge"; `apps/desktop/test/sync.test.js`: "the key expiring soon or expired shows in the status".
- [x] **The D89 program confirmation.** `apps/desktop/main/ipc.js:createApi` (show, confirmProgram) asks before the first launch of a program path on this PC; Start remembers the exact path, Don't start opens the
  fallback pane or nothing; a missing program and a split never ask; the list is per PC, never synced and not settable through `saveDevice`.
  Tests: `apps/desktop/test/program-approval.test.js`: "needsConfirm: unknown paths ask; approved paths do not, whatever the case or slashes", "afterAnswer: Start launches; Don’t start uses the fallback when there is one, else nothing";
  `apps/desktop/test/store.test.js`: "approvedPrograms: default [], sanitised, not lost by other patches, survives a restart, old file loads"; smoke [I]: "programs: the first launch asks \"Start this program?\" and shows the full path",
  "programs: Start launches it and remembers the path", "programs: a second launch does not ask", "programs: Don’t start opens the fallback address in a pane and launches nothing",
  "programs: Don’t start without a fallback opens nothing and says so", "programs: opening in a split shows the fallback in a pane and never asks or launches".

## Model delta actually shipped
What the built code differs from `openspec/changes/archive/2026-10-20-desktop-sync/design.md`, and which doc absorbed it:
- `main/sync-settings.js` (save / test / disconnect / status) is new; the design put them inside the IPC handlers. → `docs/desktop/IMPLEMENTATION.md`.
- The partition `persist:fruitery-api` (D52) is gone: the desktop uses `net.fetch` with service-token headers (D103), not a browser session.
  `docs/desktop/ARCHITECTURE.md` (the `partition` row and `t_api_desk`) said otherwise and was corrected.
- Electron's `net.fetch` with `redirect: 'manual'` rejects with "Redirect was cancelled" instead of returning a 3xx; the seam maps a redirect-mentioning rejection to "access key refused" (a heuristic). → IMPLEMENTATION notes.
- The expiry date is optional (the design assumed one). A new address or client id needs the secret typed again (`retype-required`), which the design did not say.
- The status object the UI gets also carries `lastSyncAt`, `pending`, `rejected`, `ticksEnabled`; the state `device` omits `sync`.
- Disconnect also resets the first-sync marker and empties the queue (the design said only "deletes the stored key").
- The smoke harness (design "Verification harness") was planned as a local API inside the smoke process. The wire-level check of the engine against the real Worker handler runs as a `node:test`
  (`apps/desktop/test/sync-integration.test.js`); the smoke phase [S] runs the settings and the HTTP seam against a plain local server.

## Modeling smells swept (§3)
- [x] No parallel objects: the queue holds ordinary entities; `SyncConfig` and `approvedPrograms` live in `DeviceSettings`; the secret has one place (the encrypted file).
- [x] Deduced, not copied: `SyncStatus` and the chip wording are computed on demand from the in-memory state, the clock and the queue; buckets are still deduced from core. Stored-deduced: none. The cache is a stored copy of the server's entities with a declared consistency mechanism (`mergeLww` through `planSync`).
- [x] One source of truth: the snapshot shape and `mergeLww` / `validateItem` are core's; the API contract is the Worker's (`docs/web/ARCHITECTURE.md`); the Sync form codes are one table (`apps/desktop/lib/sync-config.js:planConfigure`).
- [x] Diagram ⇄ table: `docs/desktop/ARCHITECTURE.md` §3 and §4 updated together (SyncConfig, secret?, queued?, status, approvedPrograms, needsConfirm).

## Doc / code mismatches found while reconciling
- `docs/desktop/ARCHITECTURE.md` named `persist:fruitery-api` twice; no code uses it. Fixed. CLAUDE.md D52 still lists that partition (see the proposals below).
- `docs/architecture-map.md` said the desktop "reads its cache only for the config, never for ticks"; the cache also holds a display copy of completions. Reworded.
- `docs/IMPLEMENTATION.md` said the `api` port from desktop to web was not built. Fixed.
- `CLAUDE.md` D111 reads "proposed 2026-10-15, awaiting approval" although it is built; its mention that the desktop's Access login is an open question (D75) is settled by D103. For the owner to update.
- A doc claim with no code behind it: none found in the sync rows (every quoted test name was checked against the test files and the smoke phases).

## Manual checks still to do (by the owner)
[general/manual-checks.md](../general/manual-checks.md) section 11 (new): connect two PCs, phone to PC and back, a tick, an offline edit, the expiry warning, Disconnect,
a copied data folder and the program confirmation. Setup first: [general/sync-setup.md](../general/sync-setup.md).

## Open
- Not yet observed on the real deployment: the `ctx.access` service-identity field names (the JWT path is documented); the deny reason codes on the first real connect will show it.
- The Worker secret `SERVICE_TOKEN_IDS` is not set; no PC can sync before the owner sets it.
- D131 (a layout race, unrelated to sync) was fixed after this review by D145: a focus change sends only pane ids (`apps/desktop/main/store.js:setFocusedPane`, `focusPane` in the IPC), main sets the focus itself when a site view gains focus; rule 32 in `docs/desktop/ARCHITECTURE.md`.
- Whole-entity last-write-wins (D79): a concurrent edit of one item on two devices loses one side.
- The `ctx.access` field names, the Cloudflare dashboard labels in the setup guide and the exact service-token duration options are partly unverified (marked in the guide).

Verdict: PASS (pending the smoke counts above and the manual checks)
