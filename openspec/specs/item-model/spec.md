# item-model Specification

## Purpose
Defines what a workspace item may contain and which items are rejected. Also defines how URL
placeholders expand, how ordering and sleep/Edge defaults resolve, and how edits made on two
devices merge.

## Requirements

### Requirement: Item validation
The system SHALL reject an item, listing every offending field, when any of these hold:
- it has an empty name;
- a web item lacks an http(s) URL;
- an app item lacks an application path;
- the fallback URL is not http(s);
- the reset time is not a valid HH:MM;
- a schedule field is out of range: weekday 1–7, month day 1–31, N ≥ 1, start date a real
  calendar date;
- the sleep minutes are negative or not whole;
- the device visibility is not one of all, desktop or phone;
- the Edge mode is not one of inherit, never or always;
- a URL uses an unknown placeholder;
- its group belongs to a different workspace.

#### Scenario: Valid web check-in
- **WHEN** a web item with name "Daily rewards", URL https://rewards.example.com and a daily schedule is validated
- **THEN** no errors are reported

#### Scenario: Several problems reported at once
- **WHEN** a web item has an empty name, URL "ftp://x" and reset time "25:00"
- **THEN** errors are reported for name, url and resetTime

#### Scenario: Group from another workspace
- **WHEN** an item in workspace Daily references a group that belongs to workspace Productivity
- **THEN** a group error is reported

### Requirement: URL placeholders
The system SHALL fill URL placeholders when an item is opened:
- `{YYYY}`, `{MM}` and `{DD}` come from the current local date in the configured timezone;
- `{googleEmail}` comes from settings.

A placeholder that cannot be filled SHALL be left in place and reported, so the user can be told
what to fix.

#### Scenario: Monthly rotating URL
- **WHEN** "https://example.com/shop/{YYYY}{MM}" is opened on 2026-11-01 in Asia/Tokyo
- **THEN** the URL becomes "https://example.com/shop/202611"

#### Scenario: Google account email from settings
- **WHEN** "https://calendar.google.com/calendar/r?authuser={googleEmail}" is opened with Google email "me@example.com"
- **THEN** the URL selects that account (the email is URL-encoded)

#### Scenario: Google email not configured
- **WHEN** the same URL is opened with no Google email in settings
- **THEN** the placeholder is left unchanged and reported as missing

### Requirement: Ordering
Workspaces, groups and items SHALL keep a gap-free order (0, 1, 2, …) among their siblings. Moving
one SHALL shift its siblings and mark every entity whose position changed as updated.

#### Scenario: Move to the top
- **WHEN** the third of four items is moved to position 0
- **THEN** the orders become moved=0 and the others 1, 2, 3 in their previous relative order

#### Scenario: Target position out of range
- **WHEN** an item is moved to position 99 in a list of four
- **THEN** it becomes the last item

### Requirement: Moving an item to another workspace
Moving an item to another workspace SHALL keep its identity and tick history and SHALL clear its
group.

#### Scenario: Move keeps history
- **WHEN** an item with ticks is moved from Productivity to Daily
- **THEN** it keeps its id, its ticks still apply, and it has no group

### Requirement: Sleep and Edge defaults resolve per item
- **Sleep:** an item's sleep time SHALL be its own setting when present, otherwise its workspace's
  setting, where 0 means never.
- **Edge:** "open in Edge" SHALL follow the item's mode. `inherit` uses the workspace default.
  The Edge profile is the item's profile when set, otherwise the device's default profile,
  otherwise none.

#### Scenario: Inherited sleep
- **WHEN** an item without its own sleep setting is in a workspace with a 10-minute sleep
- **THEN** its effective sleep is 10 minutes

#### Scenario: Never sleep in Productivity
- **WHEN** an item without its own sleep setting is in a workspace with sleep 0
- **THEN** it never sleeps

#### Scenario: Edge profile fallback
- **WHEN** an item with Edge mode "always" and no profile is opened on a device with default profile "Profile 1"
- **THEN** it opens in Edge with profile "Profile 1"

### Requirement: Merging edits from two devices
When the same workspace, group, item or setting is edited on two devices, the system SHALL keep
the most recently updated version. Merging SHALL give the same result in any order and when
repeated. A deletion SHALL win only if it is the most recent edit.

#### Scenario: Newer edit wins
- **WHEN** PC 1 renamed an item at 10:00 and PC 2 renamed it at 10:05
- **THEN** the merged item has PC 2's name on both devices

#### Scenario: Order of merging is irrelevant
- **WHEN** three device snapshots are merged in any order, any number of times
- **THEN** the result is identical

#### Scenario: Stale deletion loses
- **WHEN** an item was deleted at 09:00 on one device and edited at 09:30 on another
- **THEN** the merged item exists with the 09:30 edit

### Requirement: User agent preset
Every item SHALL have a user-agent preset: default, chrome, firefox, or custom with a non-empty
string of at most 512 characters. An item without a preset SHALL be treated as default. The
system SHALL reject an unknown preset, or a custom preset with an empty or over-long string.

#### Scenario: Missing preset
- **WHEN** an item without a user-agent preset is validated
- **THEN** no error is reported and it is treated as default

#### Scenario: Custom without a string
- **WHEN** an item has the custom preset and an empty custom string
- **THEN** a userAgent error is reported

### Requirement: Deletion rules
Deleting SHALL be recorded as deletion markers so other devices learn of it:
- deleting an item marks only that item;
- deleting a group marks the group, and its items stay but become ungrouped;
- deleting a workspace marks the workspace, its groups and its items;
- deleting the last remaining workspace SHALL be refused.

Every changed entity SHALL get the time of the deletion as its update time.

#### Scenario: Group deletion keeps items
- **WHEN** a group with two items is deleted
- **THEN** the group is marked deleted, and both items remain with no group and a new update time

#### Scenario: Workspace deletion cascades
- **WHEN** a workspace with one group and three items is deleted while another workspace exists
- **THEN** the workspace, the group and the three items are all marked deleted

#### Scenario: Last workspace refused
- **WHEN** deletion of the only remaining workspace is requested
- **THEN** it is refused and nothing changes

### Requirement: Workspace validation and the ungrouped label
A workspace SHALL have a non-blank name. It MAY have a name for its ungrouped section: if set, it SHALL
be non-blank text of at most 40 characters; an absent one means "Default". The system SHALL reject a
workspace that breaks these rules, listing the field.

#### Scenario: Blank name
- **WHEN** a workspace with a blank name is validated
- **THEN** a name error is reported

#### Scenario: Label rules
- **WHEN** a workspace has an ungrouped label of 41 characters, or only spaces
- **THEN** an ungroupedLabel error is reported (out of range, or required)

#### Scenario: Default label
- **WHEN** a workspace has no ungrouped label
- **THEN** its ungrouped section is called "Default"
