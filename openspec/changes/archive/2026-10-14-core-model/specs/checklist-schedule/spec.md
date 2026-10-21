# Spec Delta

## Purpose

Defines when a scheduled check-in is due, done or not due. Defines how its period rolls over
under the cadence, reset time and timezone, and when it is next due, so every device agrees on
"what is left today".

## ADDED Requirements

### Requirement: Cadences define periods
An item with a schedule SHALL belong to exactly one current period at any instant.
- **daily:** each effective day.
- **weekly:** starts on the chosen ISO weekday (1 = Monday … 7 = Sunday).
- **monthly:** starts on the chosen day of the month. If that day is past the month's last day,
  it starts on the month's last day.
- **every N days:** starts on a fixed start date and every N days after it.

#### Scenario: Daily period
- **WHEN** a daily item is evaluated on 2026-10-12 at 15:00 (configured timezone)
- **THEN** its current period starts on 2026-10-12

#### Scenario: Weekly period
- **WHEN** a weekly item with weekday Monday is evaluated on Thursday 2026-10-15
- **THEN** its current period started on Monday 2026-10-12

#### Scenario: Monthly day clamped in a short month
- **WHEN** a monthly item with day 31 is evaluated on 2027-02-28
- **THEN** its current period started on 2027-02-28

#### Scenario: Monthly day not yet reached this month
- **WHEN** a monthly item with day 15 is evaluated on 2026-10-10
- **THEN** its current period started on 2026-09-15

#### Scenario: Every-N-days anchored on the start date
- **WHEN** an item repeating every 3 days from 2026-10-01 is evaluated on 2026-10-08
- **THEN** its current period started on 2026-10-07

#### Scenario: Every-N-days before its start date
- **WHEN** an item repeating every 3 days from 2026-10-20 is evaluated on 2026-10-12
- **THEN** it has no current period and is next due on 2026-10-20

### Requirement: Reset time and timezone decide the effective day
The effective day SHALL be the local date in the configured timezone after subtracting the item's
reset time (default 00:00). A period never moves backwards as time moves forwards.

#### Scenario: Before the reset time counts as the previous day
- **WHEN** a daily item with reset time 04:00 is evaluated at 02:00 on 2026-10-12
- **THEN** its current period is 2026-10-11

#### Scenario: Timezone governs the day boundary
- **WHEN** the instant 2026-10-11T17:30Z is evaluated in Asia/Tokyo
- **THEN** the effective day is 2026-10-12

#### Scenario: Invalid timezone is rejected
- **WHEN** evaluation is requested with an unknown timezone name
- **THEN** the evaluation fails with an invalid-timezone error instead of guessing

### Requirement: Done is deduced from ticks in the current period
An item SHALL be done exactly when a tick exists for the item in its current period. Ticking the
same period twice SHALL count once.

#### Scenario: Tick in the current period
- **WHEN** a daily item has a tick for 2026-10-12 and is evaluated on 2026-10-12
- **THEN** the item is done

#### Scenario: Yesterday's tick does not carry over
- **WHEN** a daily item has a tick only for 2026-10-11 and is evaluated on 2026-10-12
- **THEN** the item is due

### Requirement: Items are bucketed as due, done or not due
Every scheduled item SHALL be in exactly one bucket:
- **not due:** it has no current period (before its start date), or it is done and was ticked on
  an earlier effective day than today;
- **done:** it is done and was ticked today;
- **due:** otherwise.

Items without a schedule SHALL have no bucket.

#### Scenario: Weekly item on the day it was ticked
- **WHEN** a weekly (Monday) item was ticked on Monday 2026-10-12 and is evaluated that same day
- **THEN** it is in the done bucket

#### Scenario: Weekly item later in the week
- **WHEN** the same item is evaluated on Wednesday 2026-10-14
- **THEN** it is in the not-due bucket and is next due on 2026-10-19

#### Scenario: Unscheduled item
- **WHEN** an item without a schedule is bucketed
- **THEN** it has no bucket

### Requirement: Next due date
The system SHALL report when each scheduled item is next due:
- today's effective day if it is due;
- the start of the next period if it is done;
- its start date if its schedule has not started.

#### Scenario: Done monthly item
- **WHEN** a monthly (day 31) item is done for the period starting 2027-01-31 and is evaluated on 2027-02-10
- **THEN** it is next due on 2027-02-28

#### Scenario: Due item
- **WHEN** a daily item without a tick is evaluated on 2026-10-12
- **THEN** it is next due on 2026-10-12
