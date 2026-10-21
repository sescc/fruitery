## MODIFIED Requirements

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

## ADDED Requirements

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
