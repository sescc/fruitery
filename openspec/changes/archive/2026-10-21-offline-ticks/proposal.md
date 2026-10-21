# Proposal

## Why
A connected desktop refuses to tick while it is offline or in a sync error (D27, D138): the circles
and Done are disabled with a notice. The owner decided on 2026-10-21 that this is too strict for
the desktop: a check-in done on a train, or while the Worker is unreachable, should still count.
- **Why it was refused:** the server's clock decides which period a tick belongs to (D41, Law 1), and
  a PC that cannot reach the server cannot ask it.
- **Why it can be allowed:** the server can still decide the period if the PC reports *when* the tick
  was made. The server keeps its authority by bounding that report to a short window around its own
  clock and by computing the period itself, from its stored timezone and the item's schedule.
- **Scope:** the desktop only. The phone stays online-only (D27 stands there), and the phone view is
  untouched by this change.

## What Changes
- **Worker (`apps/web/src/api.js`, `store.js`, and one pure helper in `packages/core`):**
  - `POST /api/ticks` accepts an optional `doneAt` (epoch ms). The period is computed from `doneAt`,
    and the stored tick carries it. `doneAt` more than 5 minutes ahead of the server is refused
    (`tick-in-future`), more than 48 hours behind is refused (`tick-too-old`), both with 422.
  - `DELETE /api/ticks/{itemId}` accepts an optional `?periodKey=`, allowed only for the current
    period or the one before it (else 422 `period-not-allowed`).
  - `GET /api/state` adds `features: ['tick-done-at']` so a client can tell whether the Worker understands `doneAt`.
  - Without these fields nothing changes, so the phone and older desktops keep working.
- **Desktop:**
  - While offline or in a sync error, a tick or untick is applied to the local data at once, shown as
    pending, and queued in a tick outbox in `cache.json`.
  - The sync flight becomes: push entities, then send the queued ticks in order, then pull. The pull
    keeps still-pending local ticks.
  - A tick the server refuses as too old, too new or not allowed is dropped and reported in the
    "Needs attention" list, where it can be dismissed. A 404 or 409 drops it silently.
  - Ticking is still refused when it can never be sent: the access key has expired, or this PC has no
    readable key (a copied data folder).
  - The desktop reports times with the server's clock (the offset learned at the last pull), so a PC
    whose clock is wrong does not lose its ticks to the 5-minute rule.
  - While connected, ticks stay direct: no `doneAt`, the server's own clock.
  - Queued ticks are sent only to a Worker that reports `tick-done-at`; otherwise they are held, with one
    notice ("Queued ticks wait for a Worker update (npm run deploy:web)"), never filed under the wrong day.
- **Texts:** the offline chip reads "Offline — edits and ticks are kept and sent later"; the list
  notice appears only when ticking is impossible (no key, expired key).
- **Decisions:** D27 is superseded for the desktop, D41 and D138 are refined.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `sync-api`: tick and untick may carry the time or the period they belong to, within bounds.
- `desktop-sync`: ticking works offline and in a sync error; queued ticks are sent later.

## Impact
- **Code:**
  - `packages/core/schedule.js` (`previousPeriodStart`) and tests;
  - `apps/web/src/store.js`, `api.js` and tests;
  - `apps/desktop/lib/sync-plan.js`, `lib/sync-label.js`, `main/sync.js`, `main/store.js`,
    `main/ipc.js`, `lib/ipc-args.js`, `preload.cjs`, `ui/*`, smoke.
- **No D1 schema change, no new dependency, no new route.**
- **User steps:** none required. Deploy the Worker (`npm run deploy:web`) to release held ticks; the order of
  deploying and updating the desktop does not matter.
