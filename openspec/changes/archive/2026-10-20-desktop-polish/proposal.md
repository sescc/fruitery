# Proposal

## Why
Daily use of the desktop app and the phone checklist showed small frictions that add up:
- items opened in Microsoft Edge or as a program could not be ticked without going back to the app and hovering;
- the Daily bar asked "Mark … done?" and had a List button nobody needed, so working through the check-ins took more
  clicks than it should;
- there was no quick way to reload, go home, go back or forward with the keyboard or the mouse side buttons, and no way
  to copy a page's address, edit it, or open the current page in Edge;
- every item looked the same (a letter), on the PC and on the phone.

This change is a bundle of small, mostly independent improvements (decisions D116 to D121 in the plan, recorded in
`CLAUDE.md` after the change is accepted). It supersedes the "Done?" prompt (D8).

## What Changes
- **Shortcuts with hints (desktop):** F5 reloads, F6 goes to the item's saved address, Alt+Left / Alt+Right and the mouse
  side buttons / keyboard browser keys go back and forward; the right-click "Edit…" entry shows its key (F3); the pane
  buttons' tooltips show their keys.
- **Desktop icons:** a site's own icon is captured when the site loads (no background fetching), cached per PC, and shown in
  the item list; the first letter is the fallback. The item editor has a "Refresh icon" button for a one-off fetch.
- **Phone icons:** each item shows its site's `/favicon.ico` (lazy-loaded, no referrer), cached by the service worker
  for about 30 days, with the first letter as the fallback.
- **Daily bar:** Done ticks and moves straight on to the next due item; Next moves on; no prompt; the List button is gone.
- **Ticking:** the tick circle in the list is always visible and clickable without opening the item. After an item was
  opened in Edge or as a program, a short "Done with <name>?" toast offers the tick when Fruitery is focused again.
- **Pane title bar:** shows the page title; one click copies the address, a double click turns it into an address field
  that navigates the same pane (the item's saved address never changes).
- **Page actions:** "Copy address" and "Open this page in Edge" header buttons, and a right-click menu on the page
  (Back, Forward, Reload, Copy page address, Open page in Edge, plus Copy link address / Copy for links and selections).
- Toasts are shown beside the item list, because native site views paint above the rest of the window.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `desktop-workspaces`: keyboard shortcuts (F5, F6, Alt+arrows, mouse side buttons, hints); the pane title bar.
- `desktop-items`: the Daily bar and ticking (no prompt, auto-advance, List removed, tick circle, return toast); page
  actions; icons.
- `phone-checklist`: site icons with a cache and a letter fallback.

## Impact
- **Changed code:**
  - `apps/desktop/{main,lib,ui}/**`, `apps/desktop/preload.cjs`, the smoke run;
  - `apps/web/public/{view.js,app.js,sw.js,index.html,styles.css}`.
- **New data (per PC, not synced):** `data\icons\<id>.png`.
- **No change** to the API, the item model, the database or core.
- **Not touched:** `desktop-sync` (its spec adds a new capability; this change modifies none of the same requirements).
- **Privacy:** the PWA asks each site directly for its icon (the site learns an IP address and nothing else; the request
  carries no referrer). The desktop never fetches in the background.
