# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Links section
**Reason**: Supersedes D100. The owner decided on 2026-10-21 that unscheduled items belong inside their own group, as on the desktop, not in a separate section at the top of the workspace.
**Migration**: Unscheduled items now appear as link rows in their groups (see "Links in their groups"). The remembered open state of the old section, stored on the device, is no longer read and is simply ignored.
