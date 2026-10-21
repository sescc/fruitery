# Spec Delta

## Purpose

What the desktop window shows and how the owner moves around it: the workspace rail, item list,
live panes that keep their state, split panes, sleeping of unused sites and keyboard shortcuts.

## ADDED Requirements

### Requirement: Rail, list and panes
The window SHALL show:
- a narrow rail of workspaces in their stored order;
- the selected workspace's items, grouped and ordered, with scheduled items showing their
  due / done / not-due state and group progress; items without a group have no header when the
  workspace has no named group, otherwise they come last under the workspace's name for them
  (default "Default");
- the workspace's title with the full width of the list panel (a long name is cut with an ellipsis),
  and the add-item and add-group buttons in a bar at the bottom of the panel;
- a pane area showing the selected item's site.

The last selected workspace and, per workspace, the last shown item SHALL be restored on the
next start.

#### Scenario: Switch workspace and back
- **WHEN** the owner scrolls halfway down a site in workspace A, switches to workspace B, then back to A
- **THEN** the site in A is shown at the same page and scroll position without reloading

#### Scenario: Restart restores selection
- **WHEN** the app restarts after the owner last used item X in workspace B
- **THEN** workspace B is selected and item X is shown

### Requirement: Keyboard shortcuts
Ctrl+1 … Ctrl+9 SHALL select the 1st … 9th workspace. Ctrl+Tab and Ctrl+Shift+Tab SHALL show the
next and previous item of the current workspace. F3 SHALL open the editor of the entry that has focus: the
list row, group header or workspace icon that has keyboard focus when the key is pressed in the app, otherwise the
item shown in the focused pane. List rows, group headers and workspace icons SHALL be reachable and operable with the
keyboard (visible focus, Enter acts as a click). All of these SHALL work while a site has focus.

#### Scenario: Ctrl+2 from inside a site
- **WHEN** a site has keyboard focus and the owner presses Ctrl+2
- **THEN** the second workspace is selected

#### Scenario: F3 from inside a site
- **WHEN** a site has keyboard focus and the owner presses F3
- **THEN** the editor of the item shown in the focused pane opens

#### Scenario: F3 on a focused group
- **WHEN** a group header in the list has keyboard focus and the owner presses F3
- **THEN** the group's editor opens

#### Scenario: F3 with nothing to edit
- **WHEN** no list row or icon has focus and the focused pane is empty, and the owner presses F3
- **THEN** nothing happens

#### Scenario: Shortcut beyond the last workspace
- **WHEN** only 3 workspaces exist and the owner presses Ctrl+5
- **THEN** nothing changes

### Requirement: Split panes
The owner SHALL be able to split a pane to the right or below, up to 4 panes per workspace, by
dragging an item onto a pane edge or with "Open in split". The owner SHALL be able to resize
panes with dividers and close a pane. An item SHALL appear in at most one pane of a layout. Any
item, including one from another workspace, may be shown in a split. Layouts SHALL be remembered
per workspace on this PC only.

#### Scenario: Open in split
- **WHEN** the owner chooses "Open in split → right" on an item while one pane is shown
- **THEN** two panes are shown side by side, the new one showing that item

#### Scenario: Fifth pane refused
- **WHEN** a workspace already shows 4 panes and the owner opens another split
- **THEN** no pane is added and the owner sees the message "Up to 4 panes per workspace"

#### Scenario: Same item twice
- **WHEN** the owner tries to show an item that is already in another pane of the same layout
- **THEN** focus moves to the existing pane instead of opening a second copy

#### Scenario: Closing the last split
- **WHEN** two panes are shown and the owner closes one
- **THEN** the other pane fills the area

### Requirement: Sleeping unused sites
A site that has not been shown for its sleep time SHALL be unloaded to save memory. A site with
sleep time 0 SHALL never be unloaded, and a site that is visible in any pane SHALL never be
unloaded. When an unloaded site is shown again, it SHALL reopen at its last address and, where
the site allows, its last scroll position.
- The sleep time is the item's own setting, otherwise its workspace's.
- Defaults: Productivity never, others 10 minutes.

#### Scenario: Daily site sleeps
- **WHEN** a Daily item (sleep 10 minutes) has been hidden for 11 minutes
- **THEN** it is unloaded, and showing it again loads its last address

#### Scenario: Productivity site never sleeps
- **WHEN** a Productivity item (sleep never) has been hidden for 3 hours
- **THEN** it is still loaded with its state intact

#### Scenario: Visible in another workspace's split
- **WHEN** a Daily item is shown in a split of the Productivity workspace for 30 minutes
- **THEN** it is not unloaded while it stays visible
