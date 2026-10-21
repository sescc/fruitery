# Proposal

## Why
The desktop app keeps its own local copy, so edits and ticks on a PC never reach the phone or the
other PCs, and the other way round (D69). The Worker API is live and verified. This change
connects the desktop to it.
- **Access:** a per-PC Cloudflare service token (D103), because Google refuses to sign in inside
  embedded browsers.
- **Sync:** last-write-wins sync with an outbox for offline edits (D104).
- **Ticks:** routed through the server so its clock decides the period (D41).
- **Programs:** a per-PC confirmation before running a program path that came from sync (D89).

## What Changes
- **Worker (`apps/web/src/auth.js`):**
  - accepts a Cloudflare Access service-token identity when its client id is listed in a new
    secret `SERVICE_TOKEN_IDS` (comma-separated);
  - owner emails are unchanged;
  - adds reason codes `service-token-not-allowed` and `service-token-ids-missing`.
- **Desktop, "Sync" settings:**
  - Worker address, client id, client secret, key expiry date;
  - stored encrypted with Electron `safeStorage` (Windows DPAPI) in `data\`;
  - the secret never reaches the UI renderer;
  - "Test connection" and "Disconnect".
- **Desktop sync engine:**
  - pull on start, on window focus, every 60 s, and after local edits;
  - merge with core `mergeLww`;
  - local edits go to an outbox in `cache.json` and are pushed when online, otherwise kept until
    the connection returns;
  - a rejected entity is shown with its error and can be fixed or discarded;
  - the first sync merges the local copy, POSTs local ticks of the current period, then drops
    local tick history.
- **Ticks** on a connected desktop go through the API. They are disabled offline (banner).
  A desktop that isn't connected keeps today's local ticks.
- **Status indicator:** synced / syncing / offline / error (reason code) / key expires in N days
  (≤ 14) / key expired.
- **Program paths:** the first launch of a program path on this PC asks for confirmation;
  approvals are remembered per PC in `device.json`.

## Capabilities

### New Capabilities
- `desktop-sync`: connecting a PC with an access key, two-way sync, offline edits, ticks,
  status and errors, key expiry, and program-launch confirmation.

### Modified Capabilities
- `sync-api`: service-token access in addition to owner sign-in.

## Impact
- **Code:**
  - `apps/web/src/auth.js` and tests;
  - `apps/desktop/main/{sync.js, secrets.js}` (new), `lib/sync-plan.js` (new), `main/store.js`,
    `main/ipc.js`, `preload.cjs`, `ui/*`, smoke;
  - `apps/desktop/lib/resolve-open.js` (confirmation step).
- **No schema change and no new dependency.**
- **User steps (walkthrough in `docs/desktop/general/sync-setup.md`):**
  1. Create one service token per PC (1 year) in Zero Trust.
  2. Add a Service Auth policy with those tokens to the Fruitery Access application.
  3. `wrangler secret put SERVICE_TOKEN_IDS`.
  4. `npm run deploy:web`.
  5. Enter the key in Fruitery's Sync settings.
