# Spec Delta

## Purpose

The installable checklist app used on the Android phone (and in any browser): it shows what is
left to do today, lets the owner tick items, and opens each site.

## ADDED Requirements

### Requirement: Today's checklist
The app SHALL list the scheduled items visible on the phone (devices "all" or "phone"), grouped
by workspace and then by group, in the stored order. Each group SHALL show "done/total" progress
over its due and done items. Due items SHALL appear unticked, and items done today ticked. Not-due
items SHALL be in a collapsed "Not due" section showing their next due date.

#### Scenario: Mixed buckets
- **WHEN** a group has two due items, one item ticked today and one weekly item ticked on an earlier day this week
- **THEN** the group shows 1/3, the two due items unticked, the ticked one ticked, and the weekly item under "Not due" with its next date

#### Scenario: Desktop-only items hidden
- **WHEN** an item's device visibility is "desktop"
- **THEN** it does not appear in the phone app

### Requirement: Ticking from the phone
Tapping an item's checkbox SHALL tick or untick it through the API and update the list from the
server's answer. If the request fails, the item SHALL return to its previous state and an error
SHALL be shown.

#### Scenario: Tick succeeds
- **WHEN** the owner taps a due item's checkbox while online
- **THEN** the item shows as done and the group progress increases

#### Scenario: Tick fails
- **WHEN** the API answers with an error
- **THEN** the item reverts to unticked and an error message is shown

### Requirement: Offline behaviour
When the device is offline, or the API cannot be reached, the app SHALL show an offline banner
and disable ticking. It SHALL keep showing the last loaded list, including when it is opened with no connection after an earlier successful load, in which case it SHALL say when the list was loaded. It SHALL NOT show a stored list once the API has denied access.

#### Scenario: Goes offline
- **WHEN** the phone loses its connection
- **THEN** an offline banner appears and checkboxes are disabled until the connection returns and the list is reloaded

#### Scenario: Cold start offline
- **WHEN** the app is opened with no connection after a previous successful load
- **THEN** the last loaded list is shown with the offline banner, checkboxes disabled, and the time it was loaded
- **AND** when the connection returns the list is reloaded and replaces it

#### Scenario: Access denied
- **WHEN** the API denies access
- **THEN** no stored list is shown, any stored copy is removed, and only the denial message is displayed

### Requirement: Opening a site
Tapping an item's name SHALL open its URL, with placeholders filled, in a new browser tab, or in
the site's own Android app if the phone hands it over. App-type items SHALL open their fallback
URL. Items without any usable URL SHALL be shown as not openable.

#### Scenario: Rotating URL
- **WHEN** the owner taps "Monthly shop (example)" on 2026-11-03
- **THEN** the opened address ends in `/202611`

#### Scenario: Missing Google email
- **WHEN** an item's URL needs the Google email and none is set
- **THEN** the item shows a hint to set the Google email in settings instead of opening a broken address

### Requirement: Installable and always fresh
The app SHALL be installable to the Android home screen behind Cloudflare Access. It SHALL load
its shell from cache when available, but SHALL always fetch data live and never cache API answers
or login pages.

#### Scenario: Install
- **WHEN** the owner opens the app in Chrome on Android after signing in
- **THEN** Chrome offers to install it

#### Scenario: Expired login
- **WHEN** the Access session has expired and the app requests data
- **THEN** the app reloads into the Access login instead of showing stale data as current
