# Design

## Context
- **Worker:** `POST /api/ticks {itemId}` files a tick under the period of the server's `now`;
  `DELETE /api/ticks/{itemId}` removes the current period's tick (`apps/web/src/store.js:tick`,
  `untick`, routed in `api.js`). One completion per (item, period), first one wins.
- **Desktop:** `main/sync.js` ticks through the API when connected and refuses
  (`ticks-need-connection`) when offline, in error, expired or without a readable key (D138). The
  flight is push entities, then pull; `lib/sync-plan.js:mergeSnapshot` replaces the completions with
  the server's.
- **Core:** `periodKey(schedule, instant, tz, resetTime)` is the single definition of a period and
  runs on both sides (Law 6). It has `nextPeriodStart` but no inverse.
- **Decisions in play:** D27 (no offline ticking), D41 (the server clock decides the period), D138
  (refusal rules), D94 (the phone has no offline writes: unchanged).
- **Conventions:** plain JS, JSDoc, `// @ts-check`, `node:test`, no new dependency, nothing
  identifying in committed files (D53/D107).

## Goals / Non-Goals
**Goals:** a desktop tick or untick made without a connection is kept, shown, and filed under the
right period when it is sent; the server stays the authority on periods.

**Non-Goals:**
- the phone: it stays online-only, and `apps/web/public/*` is not touched;
- ticks older than 48 hours: they are refused, not backfilled;
- ticking an item that is not due (the existing rules about due items are unchanged);
- queuing ticks when the key has expired or is unreadable (they could never be sent);
- merging ticks per field: a completion is a fact, one per (item, period).

## Decisions

### Model delta (§2/§3)
- **New desktop-only objects (not synced), all in `cache.json`:**
  - `TickOp`, the command form of a completion change:
    `{op:'tick', itemId, doneAt, periodKey}` or `{op:'untick', itemId, periodKey}`;
  - `TickOutbox = TickOp*`, at most one op per (itemId, periodKey);
  - `TickNotice{itemId, name, periodKey, reason, at}`, a dropped tick waiting to be dismissed
    (capped at 20, oldest first out);
  - `serverClockOffset : ℤ` (ms), `serverNow − localNow` seen at the last successful pull.
- **§3 consolidation check:**
  - *Is `TickOp` a new object?* It is the only way to say "this period's completion should be
    removed", which a `Completion` cannot express, so it is a command and not a flag.
  - *Is "pending" stored?* No. A local completion is pending **iff** a `tick` op for its
    (itemId, periodKey) exists. It is deduced rather than stored, so there is no second copy to
    drift. The same holds for a pending removal.
  - `TickNotice` and `serverClockOffset` are device state, not entities.
- **Worker morphisms:**
  - `tickAt : Item × Instant(doneAt)? × Instant(now) × Tz → Completion + Refused`.
    Partial: refused for an instant outside `[now − 48 h, now + 5 min]`, or when the item has no
    period at that instant.
  - `untickPeriod : Item × PeriodKey? × Instant(now) → ℕ` (rows removed). Partial: refused for a
    period that is neither current nor previous.
- **Core morphism:** `previousPeriodStart : Schedule × PeriodKey → PeriodKey + ∅`, the inverse of
  `nextPeriodStart` (daily −1 day, weekly −7, every-N −n and ∅ before the start date, monthly the
  previous month's clamped day). Pure, total on valid periods.
- **Desktop morphisms (pure, in `lib/sync-plan.js`):**
  - `enqueueTick : TickOutbox × TickOp → TickOutbox` (dedupe and cancel, below);
  - `afterTickSend : TickOutbox × TickOp × Answer → TickOutbox × Notice?` (drop or keep);
  - `applyTickOps : Completion* × TickOutbox → Completion*`, used inside `mergeSnapshot`;
  - `ticksHeld : TickOutbox × Features? → 𝔹` (deduced from the queue and the last pull; never stored);
  - `tickRoute : Status × Configured × HasKey → direct + queue + refuse` (deduced from the status).
- **Effects (ports):** `sendTicks ⊸` joins the sync flight; the HTTP seam, secrets and store ports
  are unchanged.
- **Laws:**
  - **Law 1 (the server clock decides the period), refined:** the server decides the period from a
    *reported* instant that it first bounds with its own clock (−48 h, +5 min) and then maps with its
    stored timezone, so a PC cannot file a tick in an arbitrary period or invent a future one.
  - **Law 4 (desktop→D1 only through the API port):** kept; the queue is flushed by the same port.
  - **Law 6 (same core on both sides):** the desktop computes the local `periodKey` with the same
    `periodKey` the Worker uses, so the local view and the stored result agree when the timezone does.

### Worker: `POST /api/ticks` with `doneAt`
- **Body:** `{itemId, doneAt?}`. `doneAt` must be a finite number; anything else is 400
  `bad-request` with `[{field:'doneAt', code:'invalid-type'}]`.
- **Order of checks:** body shape (400), bounds (422), unknown item (404), not tickable at `doneAt` (409).
  - `doneAt > now + 5 min` → 422 `{error:'tick-in-future'}`.
  - `doneAt < now − 48 h` → 422 `{error:'tick-too-old'}`.
  - The bounds use the server's `now` only; no database access happens for a refused instant.
- **Period:** `periodKey(schedule, doneAt, storedTz, resetTime)`. The timezone is the server's stored
  one, never the client's. The completion is stored with `done_at = doneAt`.
- **409 evaluated at `doneAt`:** unscheduled and deleted items, and an every-N-days item whose period
  does not exist yet at `doneAt`.
- **Idempotent:** `INSERT OR IGNORE` on (item, period), so a duplicate returns the existing completion
  (with its own `doneAt`). A retry after a lost answer is therefore harmless.
- **Without `doneAt`:** exactly today's behaviour (`doneAt = now`).
- **Error shape:** `{error: <code>}` with status 422, like other `StoreError`s. The codes are
  distinct from the PUT's `invalid`, so a client can tell them apart by `error`.

### Worker: the capability flag
- `GET /api/state` adds `features: ['tick-done-at']`, the list of optional abilities this Worker has. A client that
  needs one checks the list; an old Worker has no `features` at all.
- It is a plain array of strings so that later abilities can be added without another contract change.

### Worker: `DELETE /api/ticks/{itemId}?periodKey=`
- `periodKey` must be a valid date (400 `bad-request` otherwise).
- Allowed values: the item's current period (by the server clock) or `previousPeriodStart` of it.
  Anything else → 422 `{error:'period-not-allowed'}`.
- It removes the completion of exactly that period and returns `{removed}`. Without the parameter:
  today's behaviour.
- Why the previous period too: an offline tick or untick made late in a period is typically sent
  after midnight (or after the reset time). Older than that is the 48 h rule's territory.

### Desktop: routing a tick
`tickRoute` is deduced from the status the chip already shows (`lib/sync-plan.js:statusOf`):

| Status / situation | Tick, untick |
|---|---|
| nothing configured | local tick as today (unchanged) |
| synced, syncing, expiring:n | direct POST / DELETE, no `doneAt` (the server's clock) |
| a direct request fails as offline, denied, refused or 5xx | queued (below), the status is updated |
| offline, `error:*` | queued at once |
| expired | refused `ticks-need-connection`: no key can send |
| configured, no readable key | refused `ticks-need-connection`: no key can send |

`ticksEnabled` (sent to the UI) is therefore false only for the last two rows.

### Desktop: queuing a tick
- **Local application:** the completion is added (tick) or removed (untick) in the local snapshot at
  once, so the circle, Done and the next-due logic work. The time is `localNow + serverClockOffset`
  (0 if never synced), and the period is the local `periodKey` of that instant with the synced timezone.
- **Dedupe per (itemId, periodKey):**
  - tick over a pending tick: no change (the first `doneAt` wins, as on the server);
  - untick over a pending tick: both disappear (the net effect is nothing);
  - tick over a pending untick: the untick disappears and no tick is queued (the server still has the
    completion);
  - untick when no completion exists locally: nothing happens.
- **Cap:** 500 ops; beyond that a tick is refused with `ticks-need-connection` (never reached in
  practice: at most items × 2 periods fit in the 48 h window).
- **Persistence:** `cache.json` gains `tickOutbox`, `tickNotices` and `serverClockOffset`. Missing or
  malformed values load as `[]` / `[]` / `0`, so old caches load unchanged.
- **Disconnect** empties the tick outbox and the notices, like the entity outbox (D137). The local
  completions stay; the next first connect sends the current period's ticks (D132) but not older ones.

### Desktop: the flight
Order: **push entities → send ticks → pull.** Entities first, so an item created offline exists on
the server before its tick arrives.
- **Gate:** queued ticks are sent only when the latest `GET /api/state` carried `tick-done-at`. If the session
  has not pulled yet when the flight reaches this step, it reads the state first (and merges it, which is safe).
  Without the flag the queue is **held**: nothing is sent and nothing is dropped, and one notice says
  "Queued ticks wait for a Worker update (npm run deploy:web)". The next flight whose pull carries the flag
  releases the queue. Direct online ticks never wait for the flag.
- Each op is sent in order, one request at a time:
  - tick → `POST /api/ticks {itemId, doneAt}`; untick → `DELETE /api/ticks/{itemId}?periodKey=…`.
- **Outcomes per op:**
  - success → remove the op;
  - 422 `tick-too-old`, `tick-in-future`, `period-not-allowed` → drop the op, record a `TickNotice`,
    and remove the local completion (a tick) or leave the server's (an untick) to be fixed by the pull;
  - 404 or 409 → drop the op silently (the item is gone, unscheduled, or not started at that time);
  - offline, denied, refused → stop the flight and record the status, as for entities; the rest of the
    queue stays;
  - any other HTTP error → stop sending ticks with `lastError = http-<status>`, still pull.
- **Pull:** `mergeSnapshot` takes the server's completions, then applies the pending ops on top: a
  pending tick adds its completion if the server lacks one, a pending untick removes it. A tick that
  just went through is no longer pending and arrives with the server's history.
- **Server clock offset:** every successful pull stores `serverNow − localNow`. A PC whose clock is
  minutes ahead would otherwise lose every offline tick to the +5 min rule.
- **First connect (D132):** unchanged. The current-period ticks are sent without `doneAt`; the queue
  is flushed right after the entity push, before them.

### Desktop: what the owner sees
- **Circle and Done:** a pending tick shows as ticked with a small "pending" marker and the tooltip
  "Picked — will be sent when online". Done advances to the next due item as usual.
- **Chip:** offline tooltip "Offline — edits and ticks are kept and sent later". The waiting count
  includes queued ticks. Expired or no key: the existing texts.
- **List notice:** "Ticking needs the access key" / "Ticking needs a new access key" only; no notice
  for plain offline.
- **Held queue:** while the gate is closed, "Needs attention" shows "Queued ticks wait for a Worker update (npm run deploy:web)" (no buttons; it goes away by itself), and the chip badge counts it.
- **Dropped ticks:** listed in "Needs attention" as "Tick dropped: <item>, <date>: too old to send
  (over 48 hours)" (or not allowed, or from the future), with **Dismiss** only (there is nothing to
  fix). The chip badge counts them. The choice of this list over a toast is deliberate: the app may
  run hidden in the tray, where a toast is never seen.

### Compatibility
- Old clients (the phone, an old desktop) send no `doneAt` or `periodKey`: unchanged.
- A new desktop with an **old Worker**: the queue is held (see the gate above), so a queued tick is never filed
  under the day it is sent. Online ticks work as before. The deploy order no longer matters.

### Verification harness
- **Worker:** `store.test.js` and `api.test.js` with the `node:sqlite` FakeD1, fixed `now`.
- **Desktop:** pure tests for the queue and merge; `sync.test.js` with the fake `requestApi`;
  `sync-integration.test.js` against the real handler: an offline tick *yesterday* sent *today* is
  stored for yesterday.
- **Smoke `[W]`:** stop the server, tick, see the circle ticked and pending, restart, find it in D1.
  The old checks that expected ticks to be disabled offline change accordingly. The held and the released gate are tested with a fake Worker that lacks, then has, the flag.

## Risks / Trade-offs
- **A tick filed by a PC's report can be wrong by the PC's clock.** Mitigated by the offset learned at
  the last pull, the 5-minute and 48-hour bounds, and by the server computing the period itself. A PC
  that has never synced uses its own clock.
- **Timezone mismatch.** The local period uses the synced timezone; if the owner changed the timezone
  on another device between the last pull and the tick, the local circle may show another day than
  the server will file. The pull corrects the display. Accepted.
- **Ticks older than 48 hours are lost** (with a notice). Chosen to keep the window small; widening is
  a constant.
- **Whole-day ambiguity near the reset time** is resolved by the server using the reported instant, the
  stored timezone and the item's reset time, exactly as for a live tick.
- **The queue holds facts about the past on one PC.** Deleting `cache.json` loses them; the backup rules
  (D132) are unchanged.

## Open Questions
1. **The 48 h and 5 min constants** are as decided; both are named constants in one place.
2. **Where dropped ticks are shown** (proposed: Needs attention with Dismiss). A toast is the
   alternative.
3. **Clock offset** (not in the original decision): proposed as part of this change because the 5-minute
   rule would otherwise make a skewed PC lose ticks silently.
