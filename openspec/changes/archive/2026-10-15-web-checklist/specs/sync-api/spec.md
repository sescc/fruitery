# Spec Delta

## Purpose

The HTTP API through which the desktop app and the phone app read and change the shared
workspaces, items, settings and ticks, with the server as the single authoritative copy.

## ADDED Requirements

### Requirement: Only the owner may call the API
Every `/api` request SHALL carry a valid Cloudflare Access identity token issued by the
configured team, for the configured application audience, unexpired, and for the configured
owner email. Otherwise the API SHALL answer 403 without touching data. A development bypass SHALL
exist only when the deployment explicitly enables it.

#### Scenario: Valid owner token
- **WHEN** a request carries a correctly signed, unexpired token for the owner email and the configured audience
- **THEN** the request is processed

#### Scenario: Missing or forged token
- **WHEN** a request has no token, a token signed by an unknown key, an expired token, a wrong audience or another email
- **THEN** the API answers 403 and no data is read or written

### Requirement: State snapshot
`GET /api/state` SHALL return:
- all workspaces, groups, items (including deletion markers) and settings;
- ticks whose period starts on or after a `since` date (default: 62 days before today, widened
  to cover the longest every-N-days schedule);
- the server's current time.

#### Scenario: Fresh deployment
- **WHEN** a client requests the state right after the database has been seeded with the example dataset
- **THEN** it receives 2 workspaces, 3 groups, 11 items, default settings (timezone UTC) and no ticks

#### Scenario: Since filter
- **WHEN** ticks exist on 2026-08-01 and 2026-10-11 and the client asks for `since=2026-10-01`
- **THEN** only the 2026-10-11 tick is returned

### Requirement: Upsert with last-write-wins
`PUT /api/entities` SHALL accept any mix of workspaces, groups, items and settings. For each
entity it SHALL keep the version with the newer update time. It SHALL reject the whole request
with 422, listing each invalid item and its errors, when any resulting item is invalid. It SHALL
return the stored versions.

#### Scenario: Newer edit stored
- **WHEN** a client sends an item renamed with an update time newer than the stored one
- **THEN** the stored item takes the new name and the response contains it

#### Scenario: Older edit ignored
- **WHEN** a client sends an item with an update time older than the stored one
- **THEN** the stored item is unchanged and the response contains the stored version

#### Scenario: Invalid item rejected
- **WHEN** a client sends a web item without a URL
- **THEN** the API answers 422 with that item's id and a url error, and nothing in the request is stored

### Requirement: Ticks are filed by the server clock
`POST /api/ticks` with an item id SHALL record a tick for the item's current period. The
period SHALL be computed from the server's time, the item's schedule and reset time, and the
configured timezone. Repeating it in the same period SHALL NOT create a second tick.
`DELETE /api/ticks/{itemId}` SHALL remove the current period's tick.

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

### Requirement: History
`GET /api/history?itemId=` SHALL return all ticks of one item, newest first.

#### Scenario: History of an item
- **WHEN** an item has ticks on three days
- **THEN** the three ticks are returned newest first

#### Scenario: Missing item id
- **WHEN** history is requested without an item id
- **THEN** the API answers 400

### Requirement: Malformed requests
The API SHALL answer 400 for malformed JSON or wrongly-shaped bodies and 404 for unknown `/api`
routes. It SHALL never answer with a cached response.

#### Scenario: Bad JSON
- **WHEN** a client sends a body that is not JSON to `PUT /api/entities`
- **THEN** the API answers 400 and stores nothing

#### Scenario: Unknown route
- **WHEN** a client calls `GET /api/nope`
- **THEN** the API answers 404 with `Cache-Control: no-store`
