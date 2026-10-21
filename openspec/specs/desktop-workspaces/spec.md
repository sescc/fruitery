# desktop-workspaces Specification

## Purpose
What the desktop window shows and how the owner moves around it: the workspace rail, item list,
live panes that keep their state, split panes, sleeping of unused sites and keyboard shortcuts.

## Requirements

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
keyboard (visible focus, Enter acts as a click).

Page navigation keys SHALL act on the page that has focus (a page in a pane, or the focused pane when the key is
pressed in the app itself):
- **F5** SHALL reload the page;
- **F6** SHALL load the item's saved address in the same pane (the "home" page);
- **Alt+Left** and **Alt+Right** SHALL go back and forward in the pane's history, and so SHALL the mouse side buttons
  and the keyboard's browser Back and Forward keys. Each press SHALL move exactly one step, and nothing happens at the
  start or end of the history.

All of these SHALL work while a site has focus. The right-click menu of a list item SHALL show F3 beside "Edit…",
and the tooltip of each pane button that has a key SHALL name that key.

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

#### Scenario: F5 reloads the page in focus
- **WHEN** a site has keyboard focus and the owner presses F5
- **THEN** that page reloads and no other pane is affected

#### Scenario: F6 returns to the saved address
- **WHEN** the owner has followed links away from an item's saved address and presses F6
- **THEN** the pane shows the item's saved address again

#### Scenario: Back and forward with Alt and the mouse
- **WHEN** the owner presses Alt+Left, or the mouse's back button, on a page that has history
- **THEN** the pane goes back exactly one page, and Alt+Right or the forward button returns to the page left

#### Scenario: Back with no history
- **WHEN** the owner presses Alt+Left in a pane that has no earlier page
- **THEN** nothing happens

#### Scenario: Shortcut hints
- **WHEN** the owner hovers a pane's Back, Reload or Home button, or opens the right-click menu of a list item
- **THEN** the tooltip names the key (Alt+Left, F5, F6) and the menu shows F3 beside "Edit…"

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

### Requirement: Pane title bar
The header of a pane SHALL show the title of the page it displays (the item's name until the page has a title).
- **One click** on the title SHALL copy the page's current address to the clipboard and show a message with the copied
  address for about one second. A second click within a short time (about a quarter of a second) SHALL count as a
  double click and not copy.
- **A double click** SHALL replace the title with an editable address field showing the current address, selected.
  Enter SHALL load the typed address in the same pane, with the item's logins and browser identity. An address without a
  scheme SHALL get `https://` added. Only http and https addresses SHALL be accepted; anything else SHALL keep the field
  open with an error message. Escape, or leaving the field, SHALL return to the title without navigating.
- The item's saved address SHALL never change by this; F6 SHALL return to it.
- A page that updates its title while the field is open SHALL NOT disturb what the owner is typing.

#### Scenario: Copy the address
- **WHEN** the owner clicks once on the title of a pane showing `https://example.com/a`
- **THEN** that address is on the clipboard and the message "https://example.com/a" is shown for about a second

#### Scenario: Navigate by typing an address
- **WHEN** the owner double-clicks the title, types `example.com/b` and presses Enter
- **THEN** the same pane loads `https://example.com/b` and the item's saved address is unchanged

#### Scenario: Not a web address
- **WHEN** the owner types `javascript:alert(1)` or `file:///C:/x` in the address field and presses Enter
- **THEN** nothing is loaded and the field stays open with an error message

#### Scenario: Cancel
- **WHEN** the owner presses Escape in the address field
- **THEN** the title returns and the page is unchanged

#### Scenario: Title changes while typing
- **WHEN** the page changes its title while the owner is typing in the address field
- **THEN** the typed text and the cursor are kept
