# Electron spike — results

> Distilled from the throwaway spike `spikes/electron/`, which was run and then deleted
> (D49, done 2026-10-14). The code is not kept; the findings and the cookie-transform rules are,
> so that `desktop-shell` can port them.

## Purpose
De-risk two decisions before the real desktop app is built:
- **(a) Google sign-in (D38):** does Google Calendar sign-in work in an Electron
  `WebContentsView`, and with which User-Agent?
- **(b) Session cookies survive an unclean shutdown (D37):** does `persistSessionCookies`
  (desktop ARCHITECTURE §6, rule 4) keep the user signed in after Windows restarts while the app
  sits in the tray?

## What was built
- A small Electron app (one window, a toolbar row, one content view) with:
  - a **User-Agent switcher** with three options: Electron default, "clean Chrome" (Electron and
    app tokens stripped) and Firefox on Windows. The choice is saved and the effective UA string
    is shown;
  - a **session-cookie persistence transform** behind a toggle (default ON), with 11 unit tests
    (rules below);
  - a **cookie report** (per domain: session vs persistent counts and cookie names; values never
    shown);
  - a **tray icon**: closing the window hides it to the tray; Show / Quit from the tray menu;
  - sign-in popups (`window.open`) opened as child windows in the same persistent partition;
  - **portable data**: everything (Electron profile, settings, download cache) inside the spike
    folder, nothing in `%APPDATA%` / `%LOCALAPPDATA%`;
  - the **cache environment variable (D48)**: launches go through a launcher script that sets
    `electron_config_cache` to a project-local `.cache` before requiring Electron (Electron
    downloads its binary lazily and reads only that variable; `.npmrc` is ignored).

## Test A: Google sign-in per UA
Result table (copied verbatim from the spike):

| UA option | Reaches the password page? | Passes 2FA / consent? | Lands in Calendar signed in? | Still signed in after Reload? | Notes |
|---|---|---|---|---|---|
| 1. Electron default | Yes | Yes | Yes | Yes | expected: blocked ("may not be secure") <- did not happen |
| 2. Clean Chrome (Electron + app tokens stripped) | No/Yes |  |  | | blocked ("may not be secure"), but it works if the account chooser opens in a new window. Signing out here, being redirected to the non-popup "Choose an account" page and choosing the account again was blocked again |
| 3. Firefox on Windows (rv:150) | No/Yes | Yes | Yes | Yes | originally blocked ("may not be secure"); after a non-popup sign-in elsewhere, Google Calendar worked. Conversely, coming from the "Clean Chrome" UA first, this UA was blocked again just like Clean Chrome |

## Test B: session cookies survive a restart
Result table (copied verbatim from the spike):

| Site | Signed in before reboot | Still signed in after reboot (persistence ON) | Still signed in (persistence OFF control) |
|---|---|---|---|
| Google Calendar | Y | Y | |
| A to-do site | Y | Y | |
| A chat site | Y | Y | |
| A rewards site | N (using best UA - default; but Yes again following the successful Firefox UA login), Y (using Firefox UA) | Y | |

Notes recorded during the run:
- The toggle only acts on cookies as they are set; switching it ON also converts the session
  cookies that already exist.
- A flush of the cookie store (`flushStore()`) is called about 1 s after a conversion.
- The Firefox UA option still sends Chromium client-hint headers, so Google may still see a
  mismatch.
- The PC could not be rebooted, so the row "after reboot" is a quit-and-restart of the app (see
  conclusions and D66). The persistence-OFF control run was not done.

## Conclusions
- Google Calendar sign-in worked with Electron's default UA (unexpected; Google's check is heuristic).
- Clean-Chrome and Firefox UAs were blocked unless the account chooser opened as a popup; Firefox then worked after a non-popup sign-in elsewhere.
- One rewards site refused the default UA in the spike and worked with the Firefox UA; the per-item preset (D65) exists for such sites. It is a per-site finding, not a rule.
- Switching UA mid-session re-triggered Google's block → a site's UA must be fixed for the life of its session (D65).
- Quit-and-restart kept all logins with persistence ON; an abrupt shutdown (reboot) was not tested → covered by D66 in the real app.
- Electron footprint: ~110 MB download zip + ~280 MB unpacked runtime + the browsing profile's caches.

## Cookie-transform rules (to port into `apps/desktop`)
Pure function `toPersistentDetails(cookie, nowMs, ttlSeconds = 30 days)`: an Electron `Cookie`
(from the `cookies` `'changed'` event) → the details object for `cookies.set()`, or `null` when
nothing needs to change. It is applied **as cookies are set** (D37), not on quit.
- **Already persistent → no-op (`null`).** A cookie with a numeric `expirationDate`, or
  `session === false`, is left alone. This is also what stops the re-set from looping, since the
  `set` triggers another `'changed'` event.
- A malformed cookie (no string `name`, or no `domain`) → `null`.
- **Session cookie → persistent:** `expirationDate = floor(nowMs / 1000) + ttl` (30 days).
- **Attributes preserved:** `name`, `value`, `path` (default `/`), `secure`, `httpOnly`, and
  `sameSite` when present.
- **`url` for `cookies.set()`** is built from the cookie: scheme `https` if `secure` else `http`,
  host = the domain without its leading dot, plus the cookie's path (`/` if missing or relative).
- **Host-only stays host-only:** when `hostOnly === true`, no `domain` is passed, so the
  re-set cookie does not become a domain cookie.
- **`__Host-` never gets a domain:** a name starting with `__Host-` is also set without `domain`.
- Otherwise the original `domain` is passed through.
- Per-item and per-domain opt-out (`persistSessionCookies = false`) is handled by the caller, not
  by the transform: opted-out domains are simply not passed to it.
- After a conversion, flush the cookie store (about 1 s later) so an abrupt shutdown
  loses nothing.
