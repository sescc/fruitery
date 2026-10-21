# Spec Delta

## MODIFIED Requirements

### Requirement: Ticks are filed by the server clock
`POST /api/ticks` with an item id SHALL record a tick for the item's period. The period SHALL be
computed by the server from the item's schedule and reset time and the configured timezone, for
the server's current time, or, when the request carries the time the tick was made (`doneAt`), for
that time. Repeating it for the same period SHALL NOT create a second tick.
`DELETE /api/ticks/{itemId}` SHALL remove the current period's tick, or, when the request names a
period (`periodKey`), that period's tick.
- A `doneAt` more than 5 minutes after the server's time SHALL be refused with 422 and the code
  `tick-in-future`; one more than 48 hours before it SHALL be refused with 422 and the code
  `tick-too-old`. Nothing is stored in either case.
- A `periodKey` other than the item's current period or the one just before it SHALL be refused
  with 422 and the code `period-not-allowed`.
- A tick stored for a `doneAt` SHALL carry that time.
- Requests without `doneAt` or `periodKey` SHALL behave exactly as before.

#### Scenario: Tick a due item
- **WHEN** the owner ticks a daily item at 2026-10-12 09:00 Tokyo time
- **THEN** a tick for period 2026-10-12 is stored and returned

#### Scenario: Double tick
- **WHEN** the same item is ticked twice in the same period
- **THEN** exactly one tick exists for that period

#### Scenario: Item without schedule or unknown item
- **WHEN** a tick is requested for an unscheduled item, a deleted item, or an unknown id
- **THEN** the API answers 409 for unscheduled or deleted items (and for every-N-days items before their start date) and 404 for unknown ids, and nothing is stored

#### Scenario: Untick
- **WHEN** the owner unticks an item ticked in the current period
- **THEN** that tick is removed and earlier periods' ticks remain

#### Scenario: Tick made earlier is filed under its own day
- **WHEN** a daily item is ticked with a `doneAt` of 2026-10-11 23:30 (Tokyo) while the server's time is 2026-10-12 08:00 (Tokyo)
- **THEN** a tick for period 2026-10-11 is stored with that `doneAt`, and no tick exists for 2026-10-12

#### Scenario: Reset time applies to the reported time
- **WHEN** an item with a 04:00 reset time is ticked with a `doneAt` of 02:00 on 2026-10-12
- **THEN** the tick is stored for period 2026-10-11

#### Scenario: Reported time repeated
- **WHEN** the same tick is sent twice with the same `doneAt`
- **THEN** exactly one tick exists and the second answer returns the stored one

#### Scenario: Time too old
- **WHEN** a tick carries a `doneAt` 49 hours before the server's time
- **THEN** the API answers 422 with the code `tick-too-old` and nothing is stored

#### Scenario: Time in the future
- **WHEN** a tick carries a `doneAt` 6 minutes after the server's time
- **THEN** the API answers 422 with the code `tick-in-future` and nothing is stored, while a `doneAt` 4 minutes ahead is accepted

#### Scenario: Not tickable at the reported time
- **WHEN** a tick carries a `doneAt` before an every-N-days item's start date
- **THEN** the API answers 409 and nothing is stored

#### Scenario: Untick the previous period
- **WHEN** the owner unticks with `periodKey` set to yesterday's period of a daily item
- **THEN** yesterday's tick is removed and today's remains

#### Scenario: Period not allowed
- **WHEN** an untick names a period before the previous one, or a future period
- **THEN** the API answers 422 with the code `period-not-allowed` and nothing is removed

### Requirement: State snapshot
`GET /api/state` SHALL return:
- all workspaces, groups, items (including deletion markers) and settings;
- ticks whose period starts on or after a `since` date (default: 62 days before today, widened
  to cover the longest every-N-days schedule);
- the server's current time;
- the list of optional abilities this Worker has (`features`), which includes `tick-done-at` when
  ticks may carry the time they were made.

#### Scenario: Fresh deployment
- **WHEN** a client requests the state right after the database has been seeded with the example dataset
- **THEN** it receives 2 workspaces, 3 groups, 11 items, default settings (timezone UTC) and no ticks

#### Scenario: Since filter
- **WHEN** ticks exist on 2026-08-01 and 2026-10-11 and the client asks for `since=2026-10-01`
- **THEN** only the 2026-10-11 tick is returned

#### Scenario: Abilities listed
- **WHEN** a client requests the state
- **THEN** the answer lists `tick-done-at` among the features
