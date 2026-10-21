# Review — offline-ticks

> Ran after building. Checks the change against FRAMEWORK §4.5, the spec scenarios and the owner's rules. Not a prose review.

- Date: 2026-10-21
- Change: `offline-ticks` (1.x Worker and core, 2.x desktop pure logic and storage, 3.x engine and integration, 4.x UI, 5.x verification and docs)
- Components: desktop (`apps/desktop/`), web (`apps/web/src/`), core (`packages/core/schedule.js`)

## Test summary
`npm test` from the repo root: 776 tests, 776 pass, 0 fail (core 148 + web 195 + desktop 433). `openspec validate --all`: 9 of 9 valid.

Automated end-to-end run (`npm run smoke -w apps/desktop`, then `npm run smoke:restart -w apps/desktop`, then the packaged folder):
SMOKE OK 365 checks plus 28 in the restart step from source; packaged 295 + 28 (the real-Worker phase [W] runs from source only, D144).
Phase [W] (`apps/desktop/main/smoke-phases.js:phaseWorker`) stops the server, ticks, shows the circle ticked and pending, lets Done move on, restarts the
server and finds the tick in D1 for the right day; it also covers an unticking while offline, the dropped 72-hour-old tick with its notice and Dismiss, and the
refusals for an expired key and an unreadable key.
`apps/desktop/test/sync-integration.test.js` runs the real engine against the real Worker request handler (`apps/web/src/api.js:handle`) on an in-memory D1.

## Coherence laws
- [x] 1. **Placement honesty (Law 1 refined: the server decides the period, from a bounded client time).**
  - The Worker is still the only place that computes a period: `apps/web/src/store.js:tick` calls core `periodKey` with the **stored** timezone and the item's reset time,
    for the reported instant `doneAt`. That instant is first bounded by the Worker's own clock, `[now − 48 h, now + 5 min]` (`TICK_PAST_MS`, `TICK_FUTURE_MS`), with 422
    `tick-too-old` / `tick-in-future` and no database access for a refused instant. A client therefore cannot choose a period directly or invent a future tick.
  - The desktop keeps `now` honest: queued ticks carry the PC clock moved by the Worker's clock as last seen (`serverClockOffset`), so a PC whose clock is ahead is not refused.
  - A PC that never synced uses its own clock; the pull corrects the display if the timezone differs (accepted in design.md).
  - Tests: `apps/web/test/store.test.js`: "Tick with doneAt: the period is that instant's and the stored time is the reported one (yesterday, sent today)",
    "Tick with doneAt across midnight in the stored timezone: 23:30 Tokyo on the 11th is the 11th, 00:30 on the 12th is the 12th",
    "Tick with doneAt honours the reset time: 02:00 with a 04:00 reset belongs to the day before",
    "Tick with doneAt: the bounds are inclusive at 48 h back and 5 min ahead and refused one millisecond beyond (422, nothing stored)",
    "Tick with doneAt: a non-number is a 400 and the bounds come before the item lookup (no 404 for a refused time)";
    `apps/desktop/test/store.test.js`: "queueTick: the time is this PC's clock moved by the server offset, and so is the period (a PC 20 minutes ahead, just before midnight)";
    `apps/desktop/test/sync-integration.test.js`: "a tick made offline yesterday evening and sent today is stored for yesterday, with its own time",
    "a PC whose clock is 20 minutes ahead still gets its offline tick accepted (the server offset corrects the time)".
- [x] 2. **Transmission well-typing.** `t_api_desk` carries two typed additions: `POST /api/ticks {itemId, doneAt}` and `DELETE /api/ticks/{id}?periodKey=`; the answers are sorted by the
  existing `apps/desktop/lib/sync-config.js:classifyResponse` and mapped by `apps/desktop/lib/sync-plan.js:afterTickSend` to one of success, drop (with a reason), silent drop, stop.
  Error shapes are distinct codes (`tick-too-old`, `tick-in-future`, `period-not-allowed`), different from the PUT's `invalid`.
  Tests: `apps/desktop/test/sync-plan.test.js`: "afterTickSend: 422 tick-too-old, tick-in-future and period-not-allowed drop the op with the reason",
  "afterTickSend: 404 and 409 drop silently, a 400 drops with \"refused\"", "afterTickSend: offline, denied and refused stop the flight and keep every op; a 5xx stops with http-<status>";
  `apps/web/test/api.test.js`: "Tick with doneAt over HTTP: 422 tick-in-future / tick-too-old with the code as the error, nothing stored".
- [x] 3. **Placement totality.** Every new Trn in `docs/desktop/ARCHITECTURE.md` §7 (`enqueueTick`, `applyTickOps`, `sendTicks`, the changed `tickRemote`) and every new Worker/core morphism has a built
  `file:symbol` row. Emulated drift check (substring match against the working tree): 0 dead refs in the three `IMPLEMENTATION.md` files; every quoted test name in the new rows was matched against the test files.
- [x] 4. **Dependency mediation (desktop → D1 only through the API).** Queued ticks are flushed by the same port as before, `apps/desktop/main/sync-http.js:createRequestApi`
  (`apps/desktop/main/sync.js:createSync` (sendTicks)); no desktop module reaches D1. The Worker re-checks identity and the tick on every request.
  Tests: `apps/desktop/test/sync-integration.test.js`: "a tick and an untick of the same period made offline cancel out: the server is never asked", "a tick that waited more than 48 hours is refused by the server, dropped, and reported as a notice".
- [x] 5. **Composition soundness.** No new entity kind: a `TickOp` is the command form of a completion change (a `Completion` cannot say "remove this period's tick"); **pending is deduced** from the queue, never stored
  (`apps/desktop/lib/sync-plan.js:applyTickOps`); `TickNotice` and `serverClockOffset` are device state. Tests: `apps/desktop/test/sync-plan.test.js`: "mergeSnapshot: a pending tick survives a pull that lacks it, a pending untick hides the server's completion, a sent one does not linger",
  "applyTickOps: a waiting tick adds its completion unless one exists; a waiting untick removes it; inputs are untouched".
- [x] 6. **Law 6 (`runsAt` is a relation): the same core on both sides.** The desktop computes the local period with core `periodKey` (`apps/desktop/main/store.js:queueTick`), the Worker with the same function
  (`apps/web/src/store.js:tick`), so the circle and the stored result agree when the timezone does; the Worker's inverse for unticks is core `previousPeriodStart`. Tests: `packages/core/schedule.test.js`:
  "previousPeriodStart: daily, weekly, every-N-days (null before the start), monthly with clamping", "previousPeriodStart is the inverse of nextPeriodStart for every schedule type over 200 random periods".
  `mergeLww` and `validateItem` are untouched by this change and still run in both places.

## Owner rules and spec scenarios
- [x] **Old clients are unchanged.** A request without `doneAt` or `periodKey` behaves exactly as before; the phone is not touched (`apps/web/public/*`). Tests: `apps/web/test/store.test.js`: "Tick without doneAt is unchanged, and null/undefined count as absent",
  "Untick with periodKey: invalid dates are 400, unknown items 404, unscheduled items remove nothing; without it nothing changed"; `apps/web/test/api.test.js`: "Tick with a bad doneAt is 400; 404 and 409 still apply; a body without doneAt is unchanged".
- [x] **The capability gate (a new desktop with an old Worker).** The Worker lists `features: ['tick-done-at']` in `GET /api/state`; the desktop sends queued ticks only after seeing it, otherwise it holds the queue (nothing sent, nothing dropped) with the notice
  "Queued ticks wait for a Worker update (npm run deploy:web)"; direct online ticks never wait, so the deploy order does not matter. Without the gate an old Worker would file a queued tick under the day it is sent.
  Tests: `apps/desktop/test/sync.test.js`: "the gate: a Worker without tick-done-at holds the queue (nothing sent, nothing dropped) and says so; an update releases it", "the gate does not touch direct online ticks", "a held queue reading the state first fails cleanly offline";
  `apps/web/test/store.test.js`: "The state lists the Worker's features"; `apps/web/test/api.test.js`: "GET /api/state lists the features, including tick-done-at".
- [x] **Offline ticking works, and still refuses where nothing could send.** Offline and sync errors queue; an expired key or an unreadable key still refuses (`ticks-need-connection`) with a notice, because no key could ever send the tick. Tests: `apps/desktop/test/sync.test.js`:
  "offline: tick and untick are applied at once, queued, and no request is made; ticking stays enabled", "a sync error also queues ticks; an expired key or a missing secret still refuses them", "a direct tick whose request fails on the connection is queued, and the status says offline",
  "configured but no readable secret (a copied data folder): not connected, no requests, ticking refused so no tick is lost"; `apps/desktop/test/sync-label.test.js`: "the tick notice appears only when ticking is impossible: no key or an expired key".
- [x] **Local-only mode is unchanged.** A PC with nothing configured ticks locally and queues nothing. Tests: `apps/desktop/test/store.test.js`: "local-only mode is unchanged: tick and untick still work without any queue"; `apps/desktop/test/sync.test.js`: "not configured: the interim local tick is unchanged and makes no request".
- [x] **Refused ticks are visible, not lost silently.** A tick the Worker refuses leaves the queue, its local completion is removed and a notice lists it in Needs attention with Dismiss (chip badge counts it); 404 and 409 drop silently. Tests: `apps/desktop/test/sync.test.js`:
  "refused ticks are dropped with a notice: too old, from the future, period not allowed; the rest of the queue goes on", "a tick for an item that is gone or not tickable (404, 409) is dropped silently";
  `apps/desktop/test/sync-label.test.js`: "dropped ticks and a held queue need attention: badge, tone, tooltip and the chip target", "describeDroppedTick: each reason in words, unknown reasons still shown".
- [x] **Persistence and Disconnect.** The queue (500), the notices (20) and the offset survive a restart; an old or damaged cache loads empty; Disconnect empties the queue and the notices and keeps the local completions. Tests: `apps/desktop/test/store.test.js`: "the tick queue is capped at 500 ops; a tick beyond that is refused and changes nothing",
  "the tick queue, notices and offset survive a restart; an old or damaged cache loads empty"; `apps/desktop/test/sync.test.js`: "disconnect empties the tick queue and the notices; the local completions stay".
- [x] **The phone stays online-only** (D94 / the proposal's non-goal): no change under `apps/web/public/`.

## Known narrow race (accepted, D153)
An untick made **while that tick's own request is in flight** removes the completion locally and queues an `untick` op, but the tick has not yet reached the Worker; the next pull then brings the tick back from the Worker, and the queued untick is sent in the next
flight, which removes it. The tick therefore re-shows for one sync round and then disappears. It needs a tick and an untick of one item within one request round trip while offline-to-online is changing; accepted as known, no second copy of state is added to close it.

## Model delta actually shipped
What the built code differs from `openspec/changes/archive/2026-10-21-offline-ticks/design.md`, and which doc absorbed it:
- `tickRoute` and `ticksHeld` are small local functions in `apps/desktop/main/sync.js` (`queueing`, `ticksUsable`, `ticksHeld`), not exported pure functions in `lib/sync-plan.js`. → `docs/desktop/IMPLEMENTATION.md` notes.
- A `TickNotice` also carries an `id` assigned by the store (so Dismiss can name it); the design listed five fields.
- The design says the pending tooltip is "Picked — will be sent when online". The code says "Waiting to be sent when online. Click to undo it" on the list circle and "Picked today (waiting to be sent)" in the Daily bar (`apps/desktop/ui/list.js:renderList`, `apps/desktop/ui/panes.js:renderPanes`). The docs (`manual-checks.md`) use the code's wording.
- Any 422 and a 400 on a queued tick (not only the three named codes) drop the op with the reason "refused"; the design named only the three codes.
- `lib/sync-plan.js` declares the `TickOp` typedef twice (a duplicate comment block). Harmless; worth removing the next time the file is touched.
- Queued ticks count in `pending`, so the chip badge and the offline tooltip include them; `ticksEnabled` is false only for an expired key or a configured PC without a readable secret.

## Modeling smells swept (§3)
- [x] No parallel objects: the queue holds commands (`TickOp`), not a second copy of completions; `Completion` is unchanged.
- [x] Deduced, not copied: pending, the held state and the status are computed from the queue, the last pull and the clock; the offset is the only stored number and it is device state.
- [x] One source of truth: the period is decided in one place (core `periodKey`, on the Worker for the stored result); the bounds are two named constants in `apps/web/src/store.js`; the feature name is one constant on each side (`FEATURES`, `TICK_FEATURE`).
- [x] Diagram ⇄ table: `docs/desktop/ARCHITECTURE.md` §3 and §4 updated together (`tickQueued?`, `pending`, `dropped?`, `stamps`).

## Manual checks still to do (by the owner)
[general/manual-checks.md](../general/manual-checks.md) section 11 (extended): tick offline and see the dashed ring, reconnect and see it solid and on the phone for the day it was made, a tick queued more than 48 hours, the held-queue notice before the Worker is redeployed.
The Worker redeploy (`npm run deploy:web`) ships the Worker side of this change and of `phone-links-in-groups`.

## Open
- The redeploy of the Worker (owner). Until then each desktop holds its queued ticks; nothing is lost.
- The narrow race above.
- Ticks older than 48 hours are dropped by design (a constant in one place if the window should widen).

Verdict: PASS (pending the manual checks above)
