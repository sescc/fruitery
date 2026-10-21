# phone-checklist Specification

## Purpose
The installable checklist app used on the Android phone (and in any browser): it shows what is
left to do today, lets the owner tick items, and opens each site.

## Requirements

### Requirement: Today's checklist
The app SHALL list the items visible on the phone (devices "all" or "phone"), grouped by workspace and
then by group, in the stored order. Items with a check-in schedule are check-ins; items without one are
links (see "Links in their groups"). Each group SHALL show "done/total" progress over the due and done
check-ins it contains, and SHALL show no progress figure when it contains no check-ins. Due items SHALL
appear unticked, and items done today ticked. Not-due items SHALL be in a collapsed "Not due" section
showing their next due date.

#### Scenario: Mixed buckets
- **WHEN** a group has two due items, one item ticked today and one weekly item ticked on an earlier day this week
- **THEN** the group shows 1/3, the two due items unticked, the ticked one ticked, and the weekly item under "Not due" with its next date

#### Scenario: Desktop-only items hidden
- **WHEN** an item's device visibility is "desktop"
- **THEN** it does not appear in the phone app

#### Scenario: Links do not change the progress
- **WHEN** a group has two check-ins, one of them ticked, and three links
- **THEN** the group shows 1/2 and lists all five rows in the stored order

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

### Requirement: Site icons
Each item in the checklist, including links and items in "Not due", SHALL show an icon: the emoji or letter in the item's
Icon field if it has one, otherwise the site's own icon, and the first letter of the item's name when the site's icon
cannot be shown (no web address, no icon, or the load fails).
- The icon SHALL be requested directly from the item's site, without sending a referrer, and only for http(s) sites.
- Icons SHALL be loaded lazily and kept on the device for about 30 days, so they show without a connection. Nothing else
  from another site SHALL be kept, and the cache for icons SHALL be separate from the app's own files.
- A failing or unreachable icon SHALL never block or delay the checklist.

#### Scenario: Icon shown
- **WHEN** an item's site serves an icon
- **THEN** the item shows it beside its name

#### Scenario: Icon missing
- **WHEN** the site has no icon or does not answer
- **THEN** the item shows the first letter of its name

#### Scenario: Offline after a visit
- **WHEN** the phone is offline and the icon was loaded within the last 30 days
- **THEN** the icon still shows

#### Scenario: Typed icon
- **WHEN** an item has "🍎" in its Icon field
- **THEN** the checklist shows "🍎" and does not contact the site for an icon

#### Scenario: Item without a web address
- **WHEN** an item has no usable address (for example it needs a Google email that is not set)
- **THEN** it shows its first letter and nothing is requested

#### Scenario: A link shows its icon
- **WHEN** a link row's site serves an icon
- **THEN** the link row shows it beside its name, like a check-in

### Requirement: Links in their groups
An item visible on the phone that has no check-in schedule SHALL be shown as a link row inside its own
group, or inside the workspace's ungrouped section when it has no group (or its group has been deleted), in
the stored order among that group's rows. A link row SHALL show a link marker where a check-in has its tick
circle, SHALL open like a check-in (placeholders filled, app items use their fallback address, a missing
Google email shows a hint), and SHALL NOT count in any progress figure, appear in "Not due", or affect the
whole-day summary. A group that contains only links SHALL still be shown.

#### Scenario: Link in a group
- **WHEN** the owner adds an item without a schedule to the group Study, which also has two check-ins
- **THEN** it appears in Study as a link row with a link marker and no tick circle, and Study's progress still counts only the two check-ins

#### Scenario: Link without a group
- **WHEN** an item without a schedule has no group
- **THEN** it appears in the workspace's ungrouped section (named "Default" unless the workspace names it otherwise)

#### Scenario: Group with only links
- **WHEN** a group contains only links
- **THEN** the group is shown with its link rows and no progress figure, and the day summary does not change

#### Scenario: Link opens like a check-in
- **WHEN** the owner taps a link whose address contains a date placeholder, or an app-type link
- **THEN** the date placeholder is filled for the current date, or the app item's fallback address opens

#### Scenario: Missing Google email
- **WHEN** a link's address needs the Google email and none is set
- **THEN** the link row shows a hint to set the Google email in settings instead of an openable address

#### Scenario: Hidden links
- **WHEN** an unscheduled item is deleted, or its device visibility is "desktop"
- **THEN** it does not appear in the phone app

#### Scenario: Deleted group
- **WHEN** a link's group has been deleted
- **THEN** the link appears in the workspace's ungrouped section
