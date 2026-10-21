# System implementation map

> Whole-system functor architecture-map.md → code, deduced from the component
> IMPLEMENTATION.md files. System-level rows only.

## Components → code root
| Component | Code root | Model | Code map |
|---|---|---|---|
| core | packages/core/ | [core/ARCHITECTURE.md](core/ARCHITECTURE.md) | [core/IMPLEMENTATION.md](core/IMPLEMENTATION.md) |
| web | `apps/web/` | [web/ARCHITECTURE.md](web/ARCHITECTURE.md) | [web/IMPLEMENTATION.md](web/IMPLEMENTATION.md) |
| desktop | `apps/desktop/` | [desktop/ARCHITECTURE.md](desktop/ARCHITECTURE.md) | [desktop/IMPLEMENTATION.md](desktop/IMPLEMENTATION.md) |

## Shared objects (one Dat, DataLocs in ≥2 components)
| Object | Authoritative at | Also read by | Realised at |
|---|---|---|---|
| Workspace, Group, Item, Settings | web (D1) | desktop (cache.json), PWA (memory) | shape: `packages/core/model.js:Workspace`, `packages/core/model.js:Group`, `packages/core/model.js:Item`, `packages/core/model.js:Settings`; desktop cache: `apps/desktop/main/store.js:openStore` |
| Completion | web (D1) | desktop (made through the API when connected; local ticks only for a PC with nothing configured), PWA (memory, never authoritative) | shape: `packages/core/schedule.js:Completion`; desktop: `apps/desktop/main/sync.js:createSync` (tick, untick), `apps/desktop/main/store.js:applyCompletion` |
| DeviceSettings (incl. `sync`, `approvedPrograms`), Layout, ViewState | desktop only (per PC, never synced) | — | `apps/desktop/main/store.js:deviceDefaults`, `apps/desktop/lib/layout.js:validate`, `apps/desktop/main/views.js:createViews` |
| Outbox, access key secret (SyncConfig, `sync-secret.bin`) | desktop only (unconfirmed local edits; the key of this PC) | — | `apps/desktop/lib/sync-plan.js:enqueue`, `apps/desktop/lib/sync-config.js:sanitizeSyncConfig`, `apps/desktop/main/secrets.js:createSecrets` |

## Inter-component transmissions / ports (Trm)
| Port | carries | c_from → c_to | Realising code |
|---|---|---|---|
| api | Command/Query ⇄ Snapshot | desktop, PWA → web | `apps/web/src/api.js:handle`; the PWA calls it behind an Access login, the desktop (`t_api_desk`) with its own service token through `apps/desktop/main/sync-http.js:createRequestApi`, accepted by `apps/web/src/auth.js:authorize` |
| core import | pure functions | web, desktop → core | in-process import (no Trm) |

## System entry points
| Entry | Trn triggered | Code |
|---|---|---|
| HTTPS `/api/*` | authenticate → route | `apps/web/src/worker.js:fetch` |
| desktop launch | portable paths → single instance → window, views, tray | `apps/desktop/main/paths.js:dataDir`, `apps/desktop/main/main.js:boot` |
| desktop install | build folder → target folder, keeping `data` | `scripts/install-desktop.mjs:install` |

## Divergences (system-level)
- The `api` port from desktop to web is built (`desktop-sync`). A desktop that is not configured still runs on its
  local `cache.json` and the local tick clock (local-only mode); a configured one syncs and ticks through the Worker.
  Not yet observed on the real deployment: the Worker's `ctx.access` service-identity field names (the JWT path is
  documented; see `docs/web/general/service-tokens.md`).
