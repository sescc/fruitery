# Tasks

## 1. Worker and core

- [x] 1.1 `packages/core/schedule.js`: `previousPeriodStart(schedule, periodKey)`, the inverse of `nextPeriodStart` (daily, weekly, monthly with clamping across February and year ends, every-N-days returning null before the start date). Verify with `schedule.test.js`, including that `previousPeriodStart(nextPeriodStart(p)) === p` for every schedule type and 200 random periods.
- [x] 1.2 `apps/web/src/store.js` `tick` and `api.js`: the optional `doneAt` and the `features: ['tick-done-at']` entry of `GET /api/state` (400 for a non-number; 422 `tick-in-future` above now + 5 min; 422 `tick-too-old` below now − 48 h; period and stored time from `doneAt`; 409 evaluated at `doneAt`; duplicate returns the stored one; no database access for a refused instant). Verify in `store.test.js` and `api.test.js`: both bounds exactly at and one millisecond past the limit, a period across midnight and across a reset time in Tokyo and UTC, a duplicate with another `doneAt`, 404 and 409 cases, that requests without `doneAt` behave as before, and that the state carries the feature list.
- [x] 1.3 `untick` and its route: the optional `?periodKey=` (400 for an invalid date; current or previous period only, else 422 `period-not-allowed`; returns `{removed}`). Verify in `store.test.js` and `api.test.js`: current, previous, older, future, a weekly and a monthly item, an unscheduled item, and unchanged behaviour without the parameter.

## 2. Desktop: pure logic and storage

- [x] 2.1 `lib/sync-plan.js`: the tick-op type, `enqueueTick`, `afterTickSend`, and `mergeSnapshot` applying pending ops over the server's completions. Verify in `sync-plan.test.js`: dedupe, tick then untick cancelling, untick then tick cancelling the untick, an untick with nothing to remove, a pending tick surviving a pull that lacks it, a pending untick hiding a server completion, a sent tick no longer pending, and that no input is mutated.
- [x] 2.2 `main/store.js`: `tickOutbox`, `tickNotices` (cap 20) and `serverClockOffset` in `cache.json`; local application of a queued tick or untick; `applyRemote` passing the ops to the merge; the offset updated per pull. Old, missing and junk values load as empty. Verify in `store.test.js`, including a restart with a queue and the cap of 500 ops.

## 3. Desktop: engine

- [x] 3.1 `main/sync.js`: route tick and untick (nothing configured: local; connected: direct; a direct request failing on the connection: queue; offline or `error:*`: queue; expired or no key: refuse), the flight step "send ticks" between push and pull with the outcomes in design.md, notices, the offset, disconnect clearing the queue, and `ticksEnabled` false only for expired or no key. Verify in `sync.test.js`: each route, the order push then ticks then pull, 422/404/409/offline/denied outcomes, a tick edit during a flight, the first connect unchanged, and the gate: a Worker without the flag holds the queue (no request, nothing dropped, one notice) and a later pull that carries it releases the queue, while direct online ticks are unaffected.
- [x] 3.2 `sync-integration.test.js` against the real handler: a tick made offline yesterday and sent today is stored for yesterday, an untick of yesterday, a tick refused as too old becomes a notice, and a PC clock 20 minutes ahead still works through the offset.

## 4. UI

- [x] 4.1 `lib/sync-label.js` and the UI: the offline tooltip, the waiting count including ticks, `tickNotice` only for expired or no key, the pending marker and tooltip on the tick circle, dropped ticks in "Needs attention" with Dismiss and the held-queue notice (new IPC with validated args, in `preload.cjs`), and Done working offline. Verify with `sync-label.test.js` and `ipc-args.test.js`.

## 5. Verification and docs

- [x] 5.1 Smoke `[W]`: replace the checks that expected ticking to be disabled offline with: stop the server, tick, the circle shows ticked and pending, Done moves on, restart the server, the tick is in D1 and no longer pending; plus the expired-key and corrupt-secret refusals and the Needs attention entry for a tick the server refuses. Run both smoke steps and the packaged smoke; adjust `[S]` and any other check that assumed the old refusal.
- [x] 5.2 Run root `npm test`, `openspec validate offline-ticks --strict` and the privacy grep (D53/D107). Reconcile the docs (desktop and web ARCHITECTURE/IMPLEMENTATION/STATUS and roll-ups, one IMPLEMENTATION row per new or changed morphism with its file:symbol), run the supercharge drift check, and write `docs/desktop/reviews/review-offline-ticks.md`. Suggest CLAUDE.md rows (D27 superseded for the desktop, D41 and D138 refined, the new decisions) in the report.
