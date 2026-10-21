## MODIFIED Requirements

### Requirement: Daily bar and ticking
A pane showing a scheduled item SHALL show a bar with Done (or Undo) and Next.
- **Done** SHALL tick the item for its current period and then show the next due item of the same workspace, in list
  order, in the same pane. **Undo** SHALL untick it.
- **Next** SHALL show the next due item of the same workspace in list order, without ticking anything.
- Neither SHALL ask a question. Switching workspace or item SHALL never ask either.
- **When nothing else is due**, Done SHALL tick and show the message "Basket full 🧺" while the item stays shown, and Next
  SHALL show the message "No more due items" and change nothing.
- **When every due item of the workspace is done**, the list SHALL show "Basket full 🧺".

#### Scenario: Done moves on
- **WHEN** the owner presses Done on a due check-in while other check-ins of the workspace are due
- **THEN** the item is ticked and the next due item opens in the same pane, with no prompt

#### Scenario: Next on an unticked item
- **WHEN** the owner presses Next on an unticked check-in while another is due
- **THEN** the other item opens, the first stays unticked, and no prompt appears

#### Scenario: Last due item
- **WHEN** the owner presses Done on the last due item of the workspace
- **THEN** it is ticked, the message "Basket full 🧺" appears and the item stays shown

#### Scenario: Next with nothing left
- **WHEN** the owner presses Next and no other item of the workspace is due
- **THEN** the message "No more due items" appears and the pane is unchanged

#### Scenario: Switching never prompts
- **WHEN** the owner switches to another workspace while an unticked check-in is shown
- **THEN** no prompt appears and the item stays unticked

#### Scenario: Basket full
- **WHEN** the last due item of the Daily workspace is ticked
- **THEN** the Daily list shows "Basket full 🧺"

## ADDED Requirements

### Requirement: Ticking from the list
Every due or done scheduled item in the list SHALL show a tick circle that is always visible. Clicking the circle SHALL
tick a due item, or untick a done one, without opening the item or changing the selection.

When an item was opened in Microsoft Edge, or started as a program, and the owner then returns to Fruitery, a short
message "Done with <name>?" with a ✓ button SHALL appear for a few seconds and fade. The ✓ button SHALL tick the item.
The message SHALL NOT appear for an item that is already ticked, not due or not scheduled, nor when the app was never left
after the item was opened.

#### Scenario: Tick without opening
- **WHEN** the owner clicks the circle of a due item in the list
- **THEN** it becomes done, the group progress increases and no pane changes

#### Scenario: Untick from the circle
- **WHEN** the owner clicks the circle of an item done today
- **THEN** it is due again

#### Scenario: Return after Edge
- **WHEN** the owner opens a due check-in in Edge, works there, and brings Fruitery back to the front
- **THEN** the message "Done with <name>?" appears for a few seconds, and pressing ✓ ticks the item

#### Scenario: Already ticked or unscheduled
- **WHEN** the owner opens an item in Edge that is already ticked today, or that has no schedule, and returns to Fruitery
- **THEN** no message appears

#### Scenario: Never left
- **WHEN** an item opens in Edge but the Fruitery window never loses focus
- **THEN** no message appears

### Requirement: Page actions
For the page shown in a pane the owner SHALL be able to copy its current address and open that page in Microsoft Edge,
from two buttons in the pane header and from a right-click menu on the page. The Edge profile SHALL be chosen as for
opening an item in Edge (the item's profile, else this PC's default, else Edge's own). The right-click menu on a page
SHALL offer Back, Forward, Reload, Copy page address and Open page in Edge; Back and Forward SHALL be unavailable when
there is no history in that direction. Over a link it SHALL also offer "Copy link address", and with selected text it
SHALL offer "Copy". Only http and https addresses SHALL ever be opened.

#### Scenario: Open the current page in Edge
- **WHEN** the owner has navigated within a pane to `https://example.com/deep/page` and presses "Open this page in Edge"
- **THEN** Edge opens `https://example.com/deep/page` with the item's or this PC's profile, and the pane is unchanged

#### Scenario: Copy a link
- **WHEN** the owner right-clicks a link on a page and chooses "Copy link address"
- **THEN** the link's address is on the clipboard

#### Scenario: Right-click on plain page
- **WHEN** the owner right-clicks empty page space
- **THEN** the menu offers Back, Forward, Reload, Copy page address and Open page in Edge, and no link or text entries

#### Scenario: Page without history
- **WHEN** the owner right-clicks a page that was just opened
- **THEN** Back and Forward are unavailable

#### Scenario: Page that is not a web address
- **WHEN** a pane has no loaded page yet
- **THEN** the copy and Edge buttons do nothing and say there is no address yet

### Requirement: Item icons
The item list SHALL show an icon for each item. The icon SHALL be, in this order: the emoji or letter the owner typed
in the item's Icon field; otherwise the site's own icon saved on this PC; otherwise the first letter of the item's name.
- A site's icon SHALL be saved only when the item's own site loads in its pane (the icon of a page on another site, such
  as a sign-in provider, SHALL NOT replace it). The app SHALL NOT fetch icons in the background.
- The item editor SHALL have a "Refresh icon" button that fetches the icon once, for that item, when pressed. It SHALL
  tell the owner whether an icon was found.
- Icons are kept per PC and are never synced. A site's icon that is missing, too large (over 256 KB), too slow (over 5
  seconds) or unreadable SHALL leave the letter in place.

#### Scenario: Icon captured on load
- **WHEN** an item's site loads in a pane and offers an icon
- **THEN** the item shows that icon in the list, and still shows it after a restart

#### Scenario: Typed icon wins
- **WHEN** an item has the emoji "🍎" in its Icon field and its site has an icon
- **THEN** the list shows "🍎"

#### Scenario: Sign-in provider's icon ignored
- **WHEN** an item's pane is on an identity provider's page during sign-in
- **THEN** the item's icon is unchanged

#### Scenario: Refresh icon
- **WHEN** the owner edits an item whose site has an icon and presses "Refresh icon"
- **THEN** the icon is saved and the owner is told it was updated

#### Scenario: No icon available
- **WHEN** the site has no icon, or the icon is too large or unreadable
- **THEN** the item keeps its letter and "Refresh icon" says that no icon was found

#### Scenario: New item
- **WHEN** the owner is adding an item that is not saved yet
- **THEN** "Refresh icon" is unavailable
