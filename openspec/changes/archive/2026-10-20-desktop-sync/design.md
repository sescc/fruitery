# Design

## Context
- **Web:** live. `GET /api/state`, `PUT /api/entities` (last-write-wins merge, 422 all-or-nothing),
  `POST`/`DELETE /api/ticks` (server clock), Access auth via the JWT header or `ctx.access`
  (`apps/web/src/auth.js:authorize`, code-only reasons).
- **Desktop:** `apps/desktop/main/store.js` keeps `cache.json` in the snapshot shape; it uses an
  interim local tick clock.
- **Core:** `mergeLww`, `validateItem`, `validateWorkspace`, `removalPlan`.
- **Conventions:** plain JS, JSDoc, `// @ts-check`, `node:test`, no new dependencies, nothing
  identifying in committed files (D53/D107).

## Goals / Non-Goals
**Goals:** service-token auth in the Worker; desktop key storage; two-way sync with an outbox;
server ticks; status and expiry; D89 program confirmation.

**Non-Goals:**
- real-time push (polling is enough);
- per-field merge (D79 caveat);
- syncing device settings (D39);
- automatic key renewal.

## Decisions

### Model delta (§2/§3)
- **New objects (desktop only, not synced):**
  - `SyncConfig{baseUrl, clientId, expiresOn}` in `device.json`; the client secret lives
    separately, encrypted.
  - `Outbox`, an array of pending entities in `cache.json`, each `{kind, entity, error?}`.
  - `SyncStatus` (deduced, in memory).
  - `approvedPrograms: 𝕊*` in `device.json`.
- **Morphisms:**
  - `planSync : Local × Remote × Outbox → {merged, outboxRemaining}` (pure);
  - `pushOutbox ⊸`, `pull ⊸`, `tickRemote ⊸`;
  - `statusOf : SyncState × Instant → SyncStatus` (deduced);
  - `needsConfirm : Item × approvedPrograms → 𝔹`.
- **§3:** the outbox holds ordinary entities, not a new kind. Status is deduced, not stored.
- **Laws:**
  - **Law 1:** ticks need `now` from L-edgeW, so they are disabled offline.
  - **Law 4:** desktop→D1 only via `t_api_desk`.
  - **Law 6:** `mergeLww` and `validateItem` run on the desktop and in the Worker.

### Worker: service tokens
- **JWT path.** A service-token JWT carries the client id in `common_name` and no `email`.
  - The client id must be in `SERVICE_TOKEN_IDS` (comma list, trimmed).
  - The identity becomes `{serviceToken: <id>}`.
  - Validation is otherwise identical: signature, issuer, audience, expiry.
- **`ctx.access` path.** Accept `getIdentity()` results that carry a service-token client id
  (`common_name`, or the field Cloudflare documents). The implementer verifies the field name
  against current Cloudflare docs and records it.
- **Order:** the owner-email check first, then the service-token check. A JWT with neither an
  allowed email nor an allowed token is refused with the most specific reason:
  - `service-token-not-allowed` when it is a service token not in the list;
  - `service-token-ids-missing` when no list is set;
  - otherwise the existing email reasons.
- **Tests:** the spec scenarios, plus "a service token never matches `OWNER_EMAIL`" and
  "an email identity never matches `SERVICE_TOKEN_IDS`".

### Desktop: secrets (`main/secrets.js`)
- **Storage:** `safeStorage.isEncryptionAvailable()` must be true, otherwise connect refuses
  with a clear message.
  - `saveSecret(secret)` → `data\sync-secret.bin` (encrypted bytes).
  - `loadSecret()` → string or null. Decryption failure (a copied folder or another user) → null,
    and the status becomes "not connected: enter access key".
- **Never** sent to the UI renderer and never logged. The UI only learns
  `{connected, clientIdTail: last 4 chars, expiresOn}`.
- **Requests:** `net.fetch(baseUrl + path, {headers: {'CF-Access-Client-Id', 'CF-Access-Client-Secret'}})`.
  - `baseUrl` must be `https://…`; `http://127.0.0.1` and `localhost` are allowed only in smoke/dev
    mode.
  - Redirects are not followed (`redirect: 'manual'`). A redirect means Access refused the key →
    "access key refused".

### Desktop: sync engine
- **`lib/sync-plan.js` (pure, tested):**
  - `mergeSnapshot(local, remote, outbox)`: per kind, `mergeLww(remote, outboxEntitiesOfKind)`.
    Local entities not in the outbox are replaced by the remote ones; outbox entities win only if
    newer. Completions come from the remote.
  - `enqueue(outbox, kind, entities)`: dedupes by id and keeps the newest.
  - `afterPush(outbox, sent, response)`: removes sent entries whose `updatedAt` ≤ the stored
    version's; on 422, marks the listed ids with errors.
  - `firstSyncTicks(localCompletions, items, now, tz)`: the current-period ticks to POST.
  - `statusOf(state, now)` → one of `synced`, `syncing`, `offline`, `not-connected`,
    `error:<reason>`, `expiring:<days>`, `expired`.
- **`main/sync.js`:**
  - **Scheduler:** start, window focus, 60 s interval, and a 1 s debounce after local edits.
  - **One flight at a time.** Push the outbox (batches of at most 100 entities), then pull
    `/api/state` and apply `mergeSnapshot`, writing atomically through the store.
  - **Network failure** → `offline`, keep the outbox. **403** → `error:<reason>` (from the body).
  - **First connect:** run `firstSyncTicks`, POST each, then pull. The pull's server history
    replaces the local completions.
- **Store changes:** every local edit (upsert, remove via `removalPlan`, reorder, moveItem,
  settings) also calls `enqueue` while connected or configured. Local-only mode (never connected)
  behaves exactly as today.

### Ticks
- **Connected:** `tick`/`untick` → `POST /api/ticks` / `DELETE /api/ticks/{id}`, then merge the
  returned completion. The UI disables ticking while the status is `offline`/`error`/`expired`,
  with a notice.
- **Not connected:** the interim local behaviour is unchanged.

### UI
- **Sync status chip** at the bottom of the rail: an icon plus a tooltip, and a click opens the
  Sync settings.
- **Sync settings** (a section in Settings): Worker address, client id, client secret (a password
  field, never prefilled), expiry date, "Test connection", "Disconnect". It also shows a short
  setup hint linking to `docs/desktop/general/sync-setup.md` (path text only).
- **Rejected outbox entries:** a "Needs attention" list with Fix (opens the editor) and Discard
  (drops the outbox entry, then re-pulls).
- **Program confirmation (D89):** `resolveOpen` → `app` → if the path is not in
  `approvedPrograms`, a native confirm dialog ("Start this program? <path>" with
  Start / Don't start).
  - Start → add the path to `approvedPrograms`.
  - Don't start → the fallback URL in a pane, if there is one.

### Verification harness
- **Smoke:**
  - Run a local API in the smoke process: `apps/web/src/api.js:handle` with the `node:sqlite`
    FakeD1 (`apps/web/test-support/d1-sqlite.js`) behind a tiny `node:http` server on 127.0.0.1.
  - Auth comes from a test hook that sets `DEV_NO_AUTH` for the local host only, or from a
    synthetic `ctx.access` service identity. Assert the headers are sent.
  - Covered: connect, pull, edit→push, an edit on the "server" (direct FakeD1 write) → pull shows
    it, an offline queue (server stopped) → reconnect pushes, a 422 entry marked, a tick through
    the API, ticks disabled offline, a copied secret file failing to decrypt (simulate via a
    corrupted file), and the program confirmation.
- **Manual (user):** create the tokens, set the secret, connect both PCs, edit on the phone and
  see it on the PC, and vice versa.

## Risks / Trade-offs
- **The service-token identity fields in `ctx.access` are unverified.** Mitigation: both paths are
  supported, the JWT `common_name` path is well documented, and the deny reason codes show the
  outcome on the real deployment.
- **Whole-entity last-write-wins.** Concurrent edits to one item lose one side (D79).
- **The 60 s polling cost** is negligible against the free limits (100k requests per day).
- **The key is stored on disk** (DPAPI-protected for the Windows user). Revoke a lost PC's token
  in Zero Trust.

## Open Questions
None blocking. The `ctx.access` service-identity field name is verified during apply.
