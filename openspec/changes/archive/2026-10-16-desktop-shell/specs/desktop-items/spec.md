# Spec Delta

## Purpose

How the desktop app opens items (in a pane, in Edge, or as a native app), how the owner works
through the daily check-ins, and how workspaces, groups, items and settings are edited.

## ADDED Requirements

### Requirement: Opening an item
Selecting an item SHALL show its URL, with placeholders filled, in the focused pane, unless
"open in Edge" applies or the item is a native app:
- **"Open in Edge"** (the item's mode, or the workspace default when the mode is inherit) SHALL
  open the URL in Microsoft Edge with the item's profile, otherwise the device's default profile,
  otherwise Edge's own default.
- **A native app item** SHALL start its program. If the program is missing, its fallback URL
  opens in a pane.
- **A URL with a missing placeholder** (e.g. no Google email set) SHALL not open. The owner is
  told what to set.

#### Scenario: Edge with device profile
- **WHEN** an item set to "always open in Edge" with no profile is selected on a PC whose device Edge profile is "Profile 2"
- **THEN** Edge opens the item's URL in "Profile 2", and Fruitery's pane is unchanged

#### Scenario: Missing program
- **WHEN** a native app item's program path does not exist and it has a fallback URL
- **THEN** the fallback URL opens in the focused pane

#### Scenario: Missing Google email
- **WHEN** an item's URL needs the Google email and none is set
- **THEN** nothing opens and the owner is prompted to set it in settings

### Requirement: Links and popups from sites
A site's sign-in or other popup windows (opened with window features, or as a blank window the page
fills in itself) SHALL open as small app windows sharing the item's logins and identity. A site
SHALL be able to open a sign-in as a new tab: when a new tab is a sign-in (its address is on a known
identity provider, looks like an authentication flow such as an OAuth, SAML, SSO or login path or
OAuth query parameters, or is on the same site as the page that opened it), it SHALL load in the
pane that opened it, as the new tab would become the app in a normal browser. Any other new-tab link
SHALL open in the system's default browser. Only http and https addresses (and a blank window) SHALL
ever be opened; everything else is refused. After a sign-in popup window closes, the page that opened
it SHALL be reloaded if it did not move on by itself.

#### Scenario: Google account chooser popup
- **WHEN** a site opens the Google account chooser as a popup window
- **THEN** it opens in an app window, and after sign-in the site in the pane is signed in

#### Scenario: Single sign-in opened as a new tab
- **WHEN** a site opens an identity provider's sign-in address as a new tab
- **THEN** it loads in the pane that opened it with the item's logins and identity, and nothing opens in the default browser

#### Scenario: Ordinary link to another site
- **WHEN** a site opens a link to an unrelated site in a new tab
- **THEN** it opens in the default browser

#### Scenario: Lookalike host
- **WHEN** a site opens `accounts.google.com.example.net` in a new tab
- **THEN** it is not treated as a sign-in and opens in the default browser

#### Scenario: Non-web link
- **WHEN** a site tries to open a `file:` or custom-scheme link in a new window
- **THEN** nothing is opened
### Requirement: Daily bar and ticking
A pane showing a scheduled item SHALL show a bar with Done (or Undo), Next and Back to list.
- **Done** SHALL tick the item for its current period. **Undo** SHALL untick it.
- **Next** SHALL show the next due item of the same workspace in list order.
- **Back to list** SHALL return focus to the list.
- **Next or Back on an unticked item** SHALL first ask "Mark <name> done?", answered Yes, No or
  Cancel. Switching workspace or item SHALL never ask.
- **When every due item of the workspace is done**, the list SHALL show "Basket full 🧺".

#### Scenario: Next on an unticked item
- **WHEN** the owner presses Next on an unticked check-in and answers Yes
- **THEN** the item is ticked and the next due item opens

#### Scenario: Switching never prompts
- **WHEN** the owner switches to another workspace while an unticked check-in is shown
- **THEN** no prompt appears and the item stays unticked

#### Scenario: Basket full
- **WHEN** the last due item of the Daily workspace is ticked
- **THEN** the Daily list shows "Basket full 🧺"

### Requirement: Editing
The owner SHALL be able to:
- add, rename, reorder (drag and drop) and delete workspaces, groups and items;
- name the section of a workspace's items without a group (at most 40 characters; blank = the default
  "Default");
- move an item to another workspace (it keeps its history and leaves its group);
- edit every item field in a form that shows validation errors before saving;
- edit the settings (timezone, Google email) and the device settings (default Edge profile,
  start with Windows).

Deleting SHALL ask for confirmation. Changes SHALL be saved locally immediately and survive a
restart.

#### Scenario: Invalid edit
- **WHEN** the owner saves a web item with an empty URL
- **THEN** the form shows the URL error and nothing is saved

#### Scenario: Reorder by drag
- **WHEN** the owner drags the third item of a group to the top
- **THEN** it is first in the list, and stays first after a restart

#### Scenario: First run
- **WHEN** the app starts for the first time with a personal seed file present
- **THEN** the workspaces, groups and items come from the personal seed; without one, the example set is used
