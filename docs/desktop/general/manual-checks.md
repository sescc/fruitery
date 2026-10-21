# Desktop — manual checks

> Checks the automated smoke run cannot do (real accounts, a real reboot-like kill, the tray, Windows
> start-up, Edge). Run them once per PC after `npm run package:desktop` and
> `npm run install:desktop -- --to <your folder>`. Record the result in the session log.
> The automated run (`npm run smoke -w apps/desktop`, then `npm run smoke:restart -w apps/desktop`)
> covers everything else; see `docs/desktop/reviews/review-desktop-shell.md`.

## Setup
1. Build and install: `npm run package:desktop`, then `npm run install:desktop -- --to <folder>`.
2. Before the first start, take a snapshot of the top-level folder names in `%APPDATA%` and
   `%LOCALAPPDATA%` (for check 4).
3. Start `Fruitery.exe` from the install folder. Put your Google address in Settings (gear icon).

## 1. Google Calendar sign-in with the default identity
- Item: Google Calendar, browser identity "App default".
- Open it, choose "Sign in", complete the account chooser (it opens as a small window), the password
  and any second step.
- **Expect:** the Calendar page in the pane is signed in; a reload keeps you signed in; no
  "this browser may not be secure" page.
- If Google blocks it, note the page text, then try the Chrome or Firefox preset (editor, "Browser
  identity"), reload the item and repeat. A preset change only applies at the next load.

## 1b. Single sign-in for the productivity apps (re-test after the popup routing fixes)
- For each productivity site that offers "Continue with Google / Microsoft / Apple" or a company SSO, click it.
- **Expect:** a sign-in that the site opens as a new tab loads in the same pane (in a normal browser that tab would be the
  app), you complete it there and the site is signed in; a sign-in that opens as a small popup window appears as a small
  Fruitery window, and the pane is reloaded when it closes. Nothing opens in Edge. Ordinary links to other sites (an
  article, a help page) still open in your default browser. If a sign-in still jumps to Edge, note the address bar URL; it is a candidate for the identity
  host list in `apps/desktop/lib/popup-route.js`.

## 2. A site that refuses sign-in: try another browser identity
- Only if a site refuses sign-in with the app default identity: in the item editor set "Browser identity" to Chrome or
  Firefox, reload the item and sign in again.
- **Expect:** sign-in completes and the page shows your account. A preset change only applies at the next load; do not
  switch presets in the middle of a session.

## 3. Logins survive an unclean shutdown (D66)
- Sign in to two or three sites (for example Google Calendar, a chat site, a to-do site) and wait
  about ten seconds.
- Close the window so the app sits in the tray, then end `Fruitery.exe` from Task Manager
  (Details tab, End task; end the whole process tree).
- Start the app again.
- **Expect:** every site is still signed in. Repeat once with a PC restart when you can.
- Extend-short-logins off: set one item's "Extend short logins" off, sign in, kill the app as above, restart.
  **Expect:** that site asks you to sign in again while the others do not.

## 4. Nothing is written to `%APPDATA%` or `%LOCALAPPDATA%`
- After steps 1 to 3, compare the top-level folder names with the snapshot from the setup.
- **Expect:** no new Fruitery, Electron or electron-builder folder. Everything is in `<folder>\data`.

## 5. Edge opens with this PC's profile
- Settings: put your Edge profile folder name (for example `Profile 2`; see `edge://version`, "Profile
  path") into "Edge profile on this PC".
- Set an item's "Open in Microsoft Edge" to "Always" with no profile, then select it.
- **Expect:** Edge opens the item's address in that profile and the Fruitery pane is unchanged. With the
  setting blank, Edge opens in its own default profile. An item with its own profile uses that one.

## 6. Start with Windows (packaged build only)
- Settings: tick "Start with Windows". Sign out of Windows and back in (or restart).
- **Expect:** Fruitery is running in the tray without showing a window; "Show Fruitery" in the tray menu
  brings it up with the sites still signed in. Untick the option and repeat: it does not start.
- The option is saved but not applied when running from the repository (`npm start`).

## 7. Tray, second launch and shortcuts
- Close the window: the app keeps running in the tray and sites stay loaded (an audio or video tab
  keeps playing). Tray menu: Show and Quit; Quit really exits.
- Start `Fruitery.exe` again while it runs: the existing window appears, no second copy runs.
- With a site focused: Ctrl+2 selects the second workspace, Ctrl+Tab shows the next item,
  Ctrl+Shift+Tab the previous one; Ctrl+9 with fewer workspaces does nothing.
- F3 opens the editor: with a site focused it edits the item shown in the focused pane; click or Tab to a list row, a group
  header or a workspace icon in the left panels and press F3 to edit that entry; with nothing selected nothing happens.
  Tab moves through the rows and icons with a visible focus ring; Enter shows an item or toggles a group.

## 8. Splits, sleeping and the Daily bar by hand
- Drag an item from the list onto the right edge of a pane: it splits; drag a divider to resize; the
  4th split works and a 5th is refused with a message; closing a pane lets the other fill the area.
- Let a Daily item sit hidden for its sleep time (default 10 minutes) with another workspace selected;
  select it again: it reloads at the same address and, where the site allows, the same scroll position.
- On a Daily check-in: "Done" ticks and opens the next due item, "Next" opens it without ticking, nothing asks (no prompt,
  no List button); when the last due item is ticked the list shows "Basket full" (see also section 10).

## 8b. Resizable list
- Drag the border between the item list and the pane area: the list follows the mouse, the site views come back on release
  (nothing reloads); it stops at 180 px and never leaves the pane area under about 320 px. Double-click the border: back to
  the default width. Restart the app: the width is kept. The workspace rail on the far left is not resizable.
- At the narrowest width the workspace title still shows in full width (cut with an ellipsis if long) and the "+ Item" /
  "+ Group" buttons sit in the bar at the bottom of the list.
- Open a fifth split: the message "Up to 4 panes per workspace" appears.
- Edit a workspace: "Name for items without a group" renames the section shown above its ungrouped items (only when the
  workspace has groups); blank goes back to "Default".

## 9. Install over an existing install
- Run `npm run install:desktop -- --to <folder>` again while Fruitery is closed.
- **Expect:** the program files are replaced, `<folder>\data` (logins, `cache.json`, `device.json`) and
  `<folder>\seed.local.json` are untouched, and the app starts with your previous state.

## 10. Shortcuts, page actions and icons (change `desktop-polish`)
- **Mouse side buttons and keyboard browser keys:** in a pane that has history, press the mouse's back (side) button, then the
  forward one; also the keyboard's Browser Back / Forward keys if it has them.
  **Expect:** exactly one page per press, in the focused pane, also while the page itself has focus. If one press moves two
  pages, note which device it was: Chromium and the window both handle it and one route has to go.
- **F5, F6, Alt+Left, Alt+Right** with a site focused and with the list focused: reload, the item's saved address, back, forward.
  Hover the pane's Back, Reload and Home buttons: the tooltips name their keys. Right-click a list item: "Edit…" shows F3.
- **Pane title:** it shows the page's title. One click copies the address (a short message with the address appears
  beside the item list for about a second). A double click makes it an address field: type a bare host such as
  `example.com/page` and press Enter, the pane loads it with your logins; Escape or clicking elsewhere puts the title back; the
  item's saved address is unchanged (F6 returns to it).
- **Page actions:** the copy and "Open this page in Edge" buttons in the pane header (the Edge profile is the item's, else
  this PC's); right-click on a page: Back, Forward, Reload, Copy page address, Open page in Edge; over a link "Copy link
  address", with selected text "Copy". Check that Back and Forward are greyed out with no history.
- **Four panes:** the header of a narrow pane keeps its Close button and drops the optional buttons.
- **Icons:** open a few of your sites; their icons appear in the list (after the page has loaded once) and stay after a
  restart. An item whose site shows no icon keeps its letter; typing an emoji in the item's Icon field wins over the site
  icon. In the item editor, "Refresh icon" fetches the icon once for an item you have not opened yet. Sites whose only
  icon is an SVG, GIF or WebP keep the letter (known limit).
- **Tick circle and return toast:** click the circle of a due item in the list: it ticks without opening the item. Set an item
  to open in Edge, click it, work in Edge, then bring Fruitery to the front: "Done with <name>?" with a ✓ appears for a few
  seconds and fades; ✓ ticks. It does not appear for an item that is already ticked or has no schedule.
- **Daily bar:** Done ticks and opens the next due item in the same pane; Next opens it without ticking; nothing asks; on the
  last due item Done says "Basket full" and stays, and Next says "No more due items".

## 11. Sync with the Worker and the phone (change `desktop-sync`)
Needs the Worker deployed with the service-token code, an Access service token per PC and the Worker secret
`SERVICE_TOKEN_IDS` (steps 1 to 3 of [sync-setup.md](sync-setup.md)). Use two PCs and the phone; with one PC, do the
first half.
- **Connect PC 1:** Settings, Sync: address, Client ID, Client secret, expiry date, then Test connection.
  **Expect:** "Connected". Close Settings: the chip at the bottom of the rail turns to "Synced <time>". A first connect writes
  `cache.pre-sync-<time>.json` in the data folder. The Settings dialog never shows the secret again ("Stored").
- **Wrong key:** retype one character of the secret, Test connection. **Expect:** "Not connected: the access key was
  refused"; the lists stay usable. Put the right one back.
- **Connect PC 2** the same way, with its own token. **Expect:** its lists match PC 1 after the first sync, and the
  chip shows "Synced".
- **Phone to PC:** rename an item on the phone. **Expect:** PC 1 and PC 2 show the new name within about a minute, or at once
  when you bring their window to the front.
- **PC to phone:** add an item on PC 1. **Expect:** it appears on the phone after a refresh (and on PC 2 within a minute).
- **Tick:** tick a check-in on PC 1. **Expect:** the phone shows it ticked after a refresh, PC 2 within a minute; untick it
  and both follow.
- **Offline edit:** turn the network off on PC 1 (or block the Worker address), rename an item, add another.
  **Expect:** the chip says "Offline" with a count of waiting changes; ticking stays possible (no notice).
  Turn the network on. **Expect:** within about a minute (or on window focus) the chip is "Synced", the edits are on the phone
  and PC 2.
- **Tick offline:** with Wi-Fi off, tick a due check-in (the circle) and press Done on another. **Expect:** the circles show
  ticked with a dashed "waiting" ring and the tooltip "Waiting to be sent when online. Click to undo it" (the Daily bar says "Picked today (waiting to be sent)"); Done moves on to the next due
  item; the chip counts the waiting ticks. Turn Wi-Fi on. **Expect:** within about a minute (or on window focus) the rings
  turn solid and the phone shows them ticked for the day they were made (check this across midnight if you can: a tick
  made at 23:50 and sent after midnight is still yesterday's). Untick one offline and reconnect: the phone shows it unticked.
- **A tick queued more than 48 hours:** hard to provoke by hand (leave the PC offline for two days, or set its clock back).
  **Expect:** after reconnecting the tick is gone from the circle and "Needs attention" lists "Tick dropped: <item>" with
  **Dismiss**; dismissing it closes the list.
- **Worker not updated:** if the Worker has not been redeployed since `offline-ticks`, queued ticks wait and "Needs attention"
  says "Queued ticks wait for a Worker update (npm run deploy:web)"; after `npm run deploy:web` the next sync sends them.
- **Rejected change:** hard to provoke by hand; if the chip shows a count, click it: "Needs attention" lists the entry
  and the reasons. Fix opens the editor; Discard drops the change and loads the server's version.
- **Expiry warning:** set the expiry date to 10 days ahead (Settings, Sync, Test connection). **Expect:** the chip's tooltip
  says "Access key expires in 10 days" and sync keeps working. Set it to yesterday: "Access key expired", ticking is refused with a notice,
  edits queue. Put the real date back.
- **Disconnect:** Settings, Sync, Disconnect, confirm. **Expect:** the chip says "Not connected"; the Client ID, secret and
  expiry are cleared, the address stays; the lists are still there and editable; a later connect is a first connect again
  (it writes another backup, keeps edits made while disconnected and then matches the server).
- **Copied data folder:** copy a connected PC's `data` folder to another PC (or Windows user) and start the app there.
  **Expect:** "Not connected: enter the access key"; no sync until it is entered; ticking says it needs the access key.
- **Start this program?:** on an item that starts a program (a program path set in the editor), click it for the first
  time on a PC. **Expect:** a box with the full path. Don't start: the item's fallback address opens in a pane (or nothing,
  with a short message). Click it again and choose Start: the program starts and the box does not come back for that path.
