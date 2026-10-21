# desktop-sessions Specification

## Purpose
Where the desktop app keeps its data and logins, how long logins last, how sites are isolated,
which browser identity each site sees, and how the app runs in the background.

## Requirements

### Requirement: Portable data
All app data, including logins, caches, the local cache of workspaces and items, and device
settings, SHALL be stored in a `data` folder next to the app's executable. Nothing SHALL be
written to the user's `%APPDATA%` or `%LOCALAPPDATA%` folders. Only one copy of the app SHALL run
at a time; starting it again SHALL show the existing window.

#### Scenario: Fresh run leaves no traces
- **WHEN** the app is started and quit for the first time
- **THEN** a `data` folder exists next to the executable and no new Fruitery or Electron folder exists in `%APPDATA%` or `%LOCALAPPDATA%`

#### Scenario: Second launch
- **WHEN** the app is running in the tray and the owner starts it again
- **THEN** the existing window is shown and no second copy runs

### Requirement: Long-lived logins
Logins SHALL survive restarts, crashes and an unclean shutdown. Cookies that sites set to expire
when the browser closes SHALL be kept for 30 days instead, keeping their security attributes,
unless the item's "extend short logins" option is off. That option only affects logins a site would
end when the app closes; a site's own long-lived logins are unaffected. All items SHALL share one login store unless an
item is set to "isolated", in which case it has its own.

#### Scenario: Killed from the tray
- **WHEN** the owner signs in to a site, waits a few seconds, and the app is ended from Task Manager while in the tray
- **THEN** after starting the app again the owner is still signed in

#### Scenario: Extend-short-logins off
- **WHEN** an item's "extend short logins" option is off and the app is restarted
- **THEN** that site's browser-session-only cookies are gone, while other sites stay signed in

#### Scenario: Isolated item
- **WHEN** an item is set to isolated and the owner signs in to the same site there with a second account
- **THEN** the non-isolated items keep the first account

### Requirement: Browser identity per site
Each item SHALL present a user agent chosen by its preset: the app default, Chrome, Firefox, or a
custom string. The identity SHALL apply to the item's page and the sign-in popups it opens, and
SHALL NOT change while the page is loaded. A changed preset SHALL take effect the next time the
item is loaded.

#### Scenario: Default preset
- **WHEN** an item uses the default preset
- **THEN** the site sees the app's built-in browser identity

#### Scenario: Preset changed while open
- **WHEN** the owner changes an open item's preset from default to Firefox
- **THEN** the open page keeps its identity, and the next reload uses the Firefox identity

### Requirement: Notifications, badges and permissions
A site's desktop notifications SHALL be allowed only when its item's notification option is on.
When its badge option is on, a count shown at the start of the page title, like "(3) …", SHALL
appear next to the item and be summed on its workspace in the rail. Other permission requests
SHALL be decided as follows:
- **Granted:** clipboard write, fullscreen, camera and microphone.
- **Denied:** location, MIDI, USB, serial and HID.

#### Scenario: Notifications off
- **WHEN** a site whose item has notifications off asks to show notifications
- **THEN** the request is denied and no notification appears

#### Scenario: Title badge
- **WHEN** a site with badges on changes its title to "(4) Inbox"
- **THEN** the item shows 4 and its workspace's rail icon shows the total of its items' counts

### Requirement: Background running
Closing the window SHALL hide the app to the tray, and it SHALL keep running. The tray menu SHALL
offer Show and Quit. When "start with Windows" is on in device settings, the packaged app SHALL
start hidden in the tray at sign-in.

#### Scenario: Close to tray
- **WHEN** the owner closes the window
- **THEN** the app keeps running in the tray and its sites stay loaded
