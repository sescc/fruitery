# Design

## Context
- **Desktop:** `apps/desktop` (built by the archived `desktop-shell`): main process (`main/views.js` owns one
  `WebContentsView` per item, `main/ipc.js` is the only bridge, `lib/*` is pure), the app UI (`ui/*`, strict CSP, no
  inline script or style), and a smoke run (`main/smoke*.js`) that drives the real app.
- **Phone:** `apps/web/public` (`view.js` is the pure view model, `app.js` renders it, `sw.js` is the service worker).
- **Native site views paint above the app UI's DOM** (D84). Anything the owner must see while a site is shown has to sit
  outside the pane area. This matters for toasts.
- **Conventions:** plain JS, JSDoc, `// @ts-check`, `node:test`, no new dependencies, nothing identifying in committed text
  (D53, D107).

## Goals / Non-Goals
**Goals:** the behaviours in the delta specs; every decision (which key, which click, which icon, which next item) is a pure,
tested function; every flow is checked by the smoke run.

**Non-Goals:**
- fetching icons in the background, or syncing icons between PCs (D39);
- an icon for workspaces;
- changing the item model, the API or the database;
- per-site recipes for icons or for the address field.

## Decisions

### Model delta (§2/§3)
No new object in `core`. Desktop-only, not synced:
- **`DeviceIcon`**: `itemId → PNG (32 px)` on disk at `<data>\icons\<file>.png`, plus an in-memory revision per item
  that the UI watches. §3 check: an existing object (`Item`) plus a morphism (`iconOf : Item → PNG?`), not a new entity.
  Deduced from the page, never stored on the item. The file name is the id when it is `[A-Za-z0-9_-]{1,64}`, otherwise a
  hash of the id, so an id that arrives through sync can never choose a write path.
- **`ReturnTracker`** (in memory): the item that was last opened outside the pane, and whether the window lost focus since.
- **Pure morphisms** (new, all unit tested):
  - `shortcutFor : Input × Source → Shortcut?` gains `nav` shortcuts (F5, F6, Alt+arrows); `appCommandAction : 𝕊 → Back⊕Forward⊕∅`;
  - `normalizeAddress : 𝕊 → URL ⊕ Error` (bare host gets `https://`, only http(s), spaces and other schemes refused);
  - `createClickDecider` (a click state machine: single after 250 ms, double inside the window);
  - `nextDueForItem : Snapshot × ItemId × Instant → ItemId?` (the item's own workspace, list order, wrapping, never itself);
  - `iconChoice : Item × Icon? → emoji ⊕ image ⊕ letter`;
  - `acceptIconUrl`, `sniffImage`, `pickIcoEntry`, `parseIconLinks`, `isOwnSite` (the capture predicate), `iconFileName`;
  - `pageMenuModel : PageState → MenuEntry*` and `pageEdgeProfile : Item × Device → 𝕊?`;
  - `createReturnTracker` (opened / blur / focus) and `shouldOfferTick : Item × Bucket → 𝔹`;
  - phone: `iconOf : Item → {icon, iconUrl}` (origin plus `/favicon.ico`, http(s) hosts only) and `letterOf` in `view.js`.
- **Laws:** Law 1 (D84): toasts move beside the list. Law 3: site renderers still get no preload; every new IPC
  handler validates its arguments, the clipboard text is read by main from the view (the UI never sends text to copy), the
  address typed by the owner is re-checked in main.

### Shortcuts (D118)
- `before-input-event` on every site webContents (already wired) and on the UI webContents maps F5 → reload, F6 → home,
  Alt+Left → back, Alt+Right → forward. **Site keys act on that webContents' own item** (the view knows it), not on the UI's
  focused pane, because the focus command to the UI is asynchronous. Keys pressed in the app UI act on the focused
  pane's item. All go through `views.navigate`, so reload keeps the user-agent re-creation rule (D65).
- The mouse side buttons and the keyboard Back/Forward keys arrive as the window's `app-command` events
  (`browser-backward`, `browser-forward`) and act on the focused pane. They are **not** also mapped in `shortcutFor`, so one
  press cannot become two steps. Real delivery is a manual check; the smoke run emits the event.
- The F3 hint is the menu item's `accelerator: 'F3'` with `registerAccelerator: false` (display only). Pane button
  tooltips: `Back (Alt+Left)`, `Reload (F5)`, `Home page (F6)`.

### Pane title bar (D120)
- The click decision is a pure state machine over click timestamps kept in the UI state (not in the element), because the pane
  header is rebuilt on every state change and the DOM `dblclick` event would be lost. One click copies after a ~250 ms
  window; a second click inside the window cancels the copy and opens the address field.
- Address editing state (pane, text) lives in the UI state. While a pane's address field is open, the signature that
  decides whether the panes are rebuilt leaves out the volatile data (page title, loading flag, history), so a page that
  keeps changing its title does not destroy the field. A rebuild caused by a real layout change recreates the field with the
  typed text and focus.
- Enter calls `navigateTo(itemId, text)` in main, which normalises again and refuses anything but http(s); then
  `webContents.loadURL` in the same view (same partition and UA). The item's saved address is never written.

### Page actions (D121)
- `copyAddress(itemId)` and `openPageInEdge(itemId)` are IPC handlers; main takes the address from the live view
  (`getURL()` when http(s), else the last known address), never from the UI.
- The Edge profile is the item's own, else the device's: core `effectiveEdge` with the mode forced to "always".
  Edge is spawned without a shell exactly as before.
- The page context menu is built by a pure `pageMenuModel` and shown with the injected `Menu`; each entry acts on the
  webContents that raised the menu. "Copy link address" appears for an http(s) link, "Copy" for a selection.

### Icons (D116)
- **Desktop capture.** `page-favicon-updated` lists the page's icon URLs. Capture happens only when
  (a) the page is the item's own site (`isOwnSite`: same registrable-looking host as the item's home address, so a
  sign-in provider, an SSO redirect or the address field cannot overwrite the icon) and (b) the candidate is not the
  one already cached in memory for the item. Candidates are tried in order (at most 3). A download uses the item's
  session (`session.fetch`), a 5 s timeout and a 256 KB cap enforced while reading. A `data:` icon is decoded in place.
- **Decoding.** `nativeImage.createFromBuffer` decodes PNG and JPEG only. An ICO is read by `pickIcoEntry`: an embedded PNG
  entry is used directly; a bitmap entry goes through a temporary `.ico` and `createFromPath` (Windows decodes it). GIF, WebP
  and SVG are not decodable and are skipped, so the letter stays. The result is resized to 32 px, written as
  `icons\<file>.png`, and the item's revision number increases.
- **Refresh icon** (user-triggered, editor): the page's current candidate list if the item's view is loaded, otherwise the
  item's origin: fetch the page (cap 512 KB, 5 s), take its `<link rel~=icon>` entries plus `/favicon.ico`, try them as above.
  It reports found / not found. No background fetch and no right-click entry exist.
- **UI delivery.** The `state` broadcast carries only `iconRevs: {itemId: n}`. The UI asks `getIcon(itemId)` when a revision
  it has not seen appears, keeps the data URL in memory, and re-renders. The CSP stays strict (`img-src 'self' data:`
  already allows data URLs).
- **Precedence:** typed emoji or letter, then the site icon, then the first letter (same on the phone). The editor hint says
  "Leave blank to use the site's icon".
- **Phone.** `view.js` gives every item/link an `iconUrl` (origin + `/favicon.ico`; null unless http(s)) and its typed
  `icon`. The image is `loading=lazy`, `referrerpolicy=no-referrer`, and falls back to the letter on `error`. The page gets a
  CSP meta tag of only `img-src 'self' https: data:` (there was no CSP; no other directive is added, so nothing else changes).
- **Service worker.** Cross-origin icon requests (GET, destination `image`, path `/favicon.ico`, https) are answered
  cache-first from a separate cache `fruitery-icons`; a miss, or an entry older than 30 days, is fetched with the original
  request (so `no-referrer` is kept), stored (opaque responses are allowed **for these requests only**; D59's rule that
  nothing cross-origin is cached stays for everything else), and a stale entry is served if the refetch fails. The timestamp
  of each entry is stored in a sidecar entry because an opaque response has no readable headers. A failing `cache.put`
  (quota: opaque responses are counted generously) is ignored and the image still shows. The activation cleanup only removes
  `fruitery-shell-*` caches, so the icon cache survives updates. The cache is bounded (at most 200 entries; the oldest go).

### Daily bar (D119)
- `Done` computes the target with `nextDueForItem` **before** ticking (the item then drops out of "due" anyway), ticks, then
  shows the target in the same pane, or shows "Basket full 🧺" when there is none. `Next` computes the target and shows it
  or says "No more due items". The `confirm` IPC stays (deletions use it); the "Mark … done?" code path is deleted.
- `desktop-sync` (separate, unarchived) adds only a new capability, so no requirement is modified twice.

### Tick circle and return toast (D117)
- The list row's tick is a real button. Click ticks (or unticks a done item), stops propagation (no open, no selection).
  Rows in "Not due" have no circle (they cannot be ticked).
- Main arms the `ReturnTracker` whenever an item opens outside a pane (`show` and the right-click "Open in Edge", both
  inside main). A window `blur` after that, followed by a `focus`, sends a `done-prompt` command. The UI checks the item's
  state when the command arrives (offer only if scheduled and due) and shows the toast with a ✓ button for ~6 s. A tracker
  entry older than 2 hours is ignored.

### Toast placement
Because native views cover the DOM, the toast now sits at the bottom of the list column (left of the panes), above the
add-item bar, instead of the window's bottom centre. It fades (opacity transition), wraps long addresses, and takes an
optional duration (1 s for "copied", ~6 s for "Done with …?").

### Risks / trade-offs
- `app-command` may or may not be delivered for every mouse; if Chromium also handles a side button itself the pane could
  step twice. Manual check recorded; the fix would be to drop one route.
- ICO decoding relies on Windows (`createFromPath`); the smoke run serves a real ICO to prove it on this machine.
- Opaque icon responses cannot be validated (a 404 image is cached like a good one) and expire after 30 days.
- Icons fetched by the PWA tell each site that the phone's IP loaded its icon; that is the cost of showing the real icon
  and is why the request carries no referrer and no credentials.
