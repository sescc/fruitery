# Spec Delta

## ADDED Requirements

### Requirement: Editing items from the phone
In edit mode the owner SHALL be able to add, edit and delete items. The phone SHALL validate an
item with the same rules as the server before sending it, and SHALL show any error the server
returns next to the field it concerns. A saved change SHALL appear on the owner's other devices
at their next refresh. Deleting SHALL ask for confirmation first.

#### Scenario: Add a daily check-in
- **WHEN** the owner adds an item "Example quiz" with URL https://example.com/quiz, a daily schedule and group Study, then saves
- **THEN** the item appears in Study as due, and after a refresh it is listed on the PC too

#### Scenario: Invalid URL
- **WHEN** the owner saves an item with URL "example.com" (no scheme)
- **THEN** the form shows a URL error and nothing is sent

#### Scenario: Delete needs confirmation
- **WHEN** the owner taps delete on an item and cancels the confirmation
- **THEN** nothing changes

### Requirement: Organising from the phone
In edit mode the owner SHALL be able to:
- move items up or down within their group, or press and hold a drag handle to drag an item to a new place in its group, to another group of the same workspace, or to the ungrouped section;
- add, rename, delete and reorder groups (with arrows or by dragging) and workspaces (with arrows);
- name, per workspace, the section that holds items without a group (default "Default").

Deleting a group SHALL keep its items, which become ungrouped. Deleting a workspace SHALL delete
its groups and items after a confirmation naming how many items go with it. The last remaining
workspace SHALL NOT be deletable.

#### Scenario: Move up
- **WHEN** the owner taps "move up" on the second item of a group
- **THEN** it becomes the first item, on the phone and, after a refresh, on the PC

#### Scenario: Delete a group
- **WHEN** the owner deletes a group containing three items
- **THEN** the group disappears and its three items are listed as ungrouped

#### Scenario: Move a group
- **WHEN** the owner taps "move up" on the second group of a workspace
- **THEN** it becomes the first group, on the phone and, after a refresh, on the PC

#### Scenario: Drag an item to another group
- **WHEN** the owner presses and holds an item's drag handle and drops it between two items of another group of the same workspace
- **THEN** the item belongs to that group at that place, on the phone and, after a refresh, on the PC

#### Scenario: Drop without moving
- **WHEN** the owner drops a dragged item where it already is
- **THEN** nothing is saved

#### Scenario: Name the ungrouped section
- **WHEN** the owner renames a workspace and sets "Name for items without a group" to "Misc"
- **THEN** that workspace's ungrouped items are listed under "Misc" instead of "Default"

#### Scenario: Last workspace
- **WHEN** only one workspace remains
- **THEN** its delete action is unavailable

### Requirement: Settings from the phone
The owner SHALL be able to change the timezone (from the list of known timezones) and the Google
email from the phone.

#### Scenario: Change timezone
- **WHEN** the owner sets the timezone to Asia/Tokyo and saves
- **THEN** due and done states are recomputed for that timezone on every device

### Requirement: Desktop-only fields are preserved
Editing an item on the phone SHALL NOT change its program path, item kind, open-in-Edge
preference, sleep time, user-agent preset, isolation or keep-logins settings. These SHALL be
shown read-only where relevant.

#### Scenario: Edit a renamed desktop item
- **WHEN** the owner renames, on the phone, an item that has an isolated session and the Firefox preset
- **THEN** the item keeps its isolation and Firefox preset

### Requirement: Editing needs a connection
Edit mode SHALL be unavailable while offline or while the app shows a stored copy. After each
successful save, the stored offline copy SHALL be updated.

#### Scenario: Offline
- **WHEN** the phone is offline
- **THEN** the edit toggle is disabled, and tapping it shows a short message that editing needs a connection

#### Scenario: Connection lost while editing
- **WHEN** the connection drops while edit mode is on
- **THEN** edit mode closes and the same message is shown, and a form that is open keeps its text

### Requirement: Links section
Each workspace SHALL show its unscheduled items that are visible on the phone as a "Links" section at
the top of the workspace, in the stored order, collapsed by default. Each link SHALL open like a
check-in (placeholders filled, app items use their fallback address, a missing Google email shows
a hint). Whether a workspace's section is open SHALL be remembered on that device.

#### Scenario: Links collapsed by default
- **WHEN** a workspace has four unscheduled items visible on the phone
- **THEN** it shows "Links (4)" collapsed above its groups

#### Scenario: Open state remembered
- **WHEN** the owner opens a workspace's Links section and reloads the app
- **THEN** that section is still open, and the other workspaces' sections are not
