# Whole-system categorical map (Dat/Trn/Loc/Trm)

> Fruitery — repo `ProductivityUnifier`.

> Top-level architecture doc (FRAMEWORK §4). Names the four atoms, lists the components
> (each links to its ARCHITECTURE.md), records placements where `runsAt` is a relation,
> and runs the §4.5 coherence checklist. Detail lives in the component docs.
> Source of record: none yet (greenfield). Intent comes from the grilling session of
> 2026-10-12 (see `CLAUDE.md` decision log).

## 1. Why
The system is one data model: workspaces of items, some of which carry a schedule.
That model has three placements: authoritative in D1, cached on two desktops, rendered on a phone.
Modeling it categorically settles three things:
- **One object.** A "productivity site" and a "daily check-in" are one `Item`, differing
  only by the partial morphism `schedule?` (§3).
- **Due/done is deduced.** It comes from `Completion` × `periodKey`, so it is never stored.
- **One source of truth.** All three locations run the same pure `periodKey`, so they agree
  on what is due.

## 2. The four atoms (at a glance)

**Dat**
| Object | Shape | Lives at |
|---|---|---|
| `Workspace` | `{id, name, icon?, order, sleepAfterMin, openInEdge, updatedAt}` | D1 (authoritative) · desktop cache · phone memory |
| `Group` | `{id, workspaceId, name, order, collapsed, updatedAt}` | same as Workspace |
| `Item` | `{id, workspaceId, groupId?, order, name, kind, url?, appPath?, fallbackUrl?, schedule?, devices, notify, badge, edge, isolate, persistSessionCookies, sleepAfterMin?, resetTime, userAgent?, updatedAt}` | same as Workspace |
| `Schedule` | `daily ⊕ weekly(weekday) ⊕ monthly(day) ⊕ everyNDays(n, startDate)` | embedded in `Item` |
| `Completion` | `{itemId, periodKey, doneAt}` (a history `Completion*`) | D1 (authoritative) · desktop/phone memory |
| `Settings` | `{timezone, googleEmail?}` | D1 · desktop cache |
| `DeviceSettings` | `{edgeProfile?, autostart, closeToTray, activeWorkspaceId, activeItemByWorkspace, layouts, focusedPaneByWorkspace, windowBounds?, listWidth, sync, approvedPrograms}` | desktop only (per PC, never synced) |
| `SyncConfig` | `{baseUrl?, clientId?, expiresOn?}` (the client secret is a separate encrypted file, never in this object) | desktop only (`DeviceSettings.sync`) |
| `Outbox` | `OutboxEntry*` = `{kind, entity, error?}`, at most one per (kind, id) | desktop only (beside the cache) |
| `ViewState` | `{itemId, url, scrollY, hiddenSince?, awake}` | desktop main-process RAM |

**Trn**
| Trn | t_from → t_to | Component |
|---|---|---|
| `periodKey` | `Schedule × Instant × Tz × ResetTime → PeriodKey?` | core |
| `bucket` | `Item × Completion* × Instant × Tz → {due, done, notDue}` | core |
| `nextDue` | `Item × Completion* × Instant × Tz → Date` | core |
| `expandUrl` | `𝕊 × Instant × Tz × Settings → 𝕊 × Token*` | core |
| `validateItem` | `Item → Error*` | core |
| `reorder` | `Entity* × id × ℕ → Entity*` | core |
| `effectiveSleep` | `Item × Workspace → ℕ` (0 = never) | core |
| `mergeLww` | `Entity* × Entity* → Entity*` | core |
| `tick` / `untick` | `Item × PeriodKey → Completion ⊸` | web (API), invoked by desktop and phone |
| CRUD / reorder API | `Command → Entity ⊸` | web |
| `openItem` | `Item → effect (pane │ Edge │ app)` ⊸ | desktop |
| `persistSessionCookies` | `Cookie → Cookie ⊸` | desktop |
| `sleepView` / `wakeView` | `ViewState → ViewState ⊸` | desktop |
| `deriveBadge` | `PageTitle → ℕ?` | desktop |
| `planSync` | `Local × Remote × Outbox → {merged, outboxRemaining}` (uses `mergeLww`) | desktop |
| `pushOutbox` / `pull` / `tickRemote` | `Outbox ⊸ Snapshot`; `ItemId ⊸ Completion?` | desktop (calls `t_api_desk`) |
| `statusOf` | `SyncState × Instant × Tz → SyncStatus` (deduced) | desktop |
| `needsConfirm` | `Path × 𝕊* → 𝔹` | desktop |

**Loc**
| Loc | What |
|---|---|
| `L-desk` | Electron app on each Windows PC (×2): main process, app-UI renderer, one WebContentsView per site, `<exeDir>\data` |
| `L-edgeW` | Cloudflare Worker (static assets + `/api`), behind Cloudflare Access |
| `L-db` | Cloudflare D1 |
| `L-phone` | Android Chrome running the installed PWA |
| `L-edge` | the user's Edge browser (external target) |
| `L-os` | Windows shell (app launch, autostart, tray) |

**Trm**
| Trm | carries | c_from → c_to |
|---|---|---|
| `t_api_desk` | `Command/Query ⇄ Entity*, Completion*` | L-desk → L-edgeW (reply paired); authenticated by the PC's own Access service token (headers), checked by Access and by the Worker's allow list |
| `t_api_phone` | same | L-phone → L-edgeW (reply paired) |
| `t_db` | SQL ⇄ rows | L-edgeW → L-db |
| `t_assets` | PWA files | L-edgeW → L-phone |
| `t_edge` | `URL × profile?` | L-desk → L-edge |
| `t_launch` | `appPath` | L-desk → L-os |

## 3. Components
| Component | Owned `Trn` | Built/active when | Doc |
|---|---|---|---|
| `core` | periodKey, bucket, nextDue, expandUrl, validateItem, reorder, effectiveSleep, mergeLww | always (imported by web + desktop + PWA) | [core/ARCHITECTURE.md](core/ARCHITECTURE.md) |
| `web` | Worker API (CRUD, reorder, tick, sync), Access JWT check, PWA UI | deployed to Cloudflare | [web/ARCHITECTURE.md](web/ARCHITECTURE.md) |
| `desktop` | shell UI, panes/splits, partitions, cookies, sleep, Edge/app launch, sync client | running on a PC | [desktop/ARCHITECTURE.md](desktop/ARCHITECTURE.md) |

§3 consolidation decisions:
- **Productivity item and check-in item are one `Item`.** A check-in is an `Item` with `schedule?`
  defined.
- **`Group` stays distinct from `Workspace`.** A workspace carries morphisms a group lacks:
  `sleepAfterMin`, a layout, and a rail icon.
- **The PWA checklist and the desktop list are one `bucket` deduction.** Two renderers share it;
  there is no second model.

## 4. Placement (where `runsAt` is a relation)
| `Trn`/`Dat` | Placements | Why it matters |
|---|---|---|
| `periodKey`, `bucket` | L-edgeW (validates `tick`), L-desk renderer, L-phone | All three must agree on "today". One pure module (`packages/core`) serves every placement. |
| `validateItem` | L-edgeW (authoritative), L-desk + L-phone (form UX) | "Never trust the client": the server re-validates. |
| `Item`, `Workspace`, `Group`, `Settings` | D1 (authoritative), desktop cache (copy), phone memory (copy) | The desktop cache is a stored copy. Its consistency mechanism is `mergeLww` on `updatedAt`. |
| `Completion` | D1 (authoritative), clients (copy) | Ticks need a connection (Q26), so clients never author an offline copy. |
| `mergeLww` | L-desk main (`planSync`), L-edgeW (upsert) | The same pure function decides "newer wins" on both sides, so the desktop's merge and the Worker's agree. |
| `Outbox`, `SyncConfig`, access key secret | L-desk only | Unconfirmed local edits (until the Worker confirms them) and this PC's key. The key's secret is never sent to the phone; to the Worker it goes only in the Access headers of requests. |

## 5. Coherence checklist (§4.5) — re-run for `desktop-sync` (evidence: `docs/desktop/reviews/review-desktop-sync.md`)
- [x] 1. **Placement honesty.**
  - Every client-side `bucket` reads `Completion*` delivered by `t_api_*`.
  - The desktop's cache of completions is a display copy replaced by every pull; a tick is authored only with the Worker's clock
    (`tickRemote`), and refused offline (the unconfigured, local-only PC is the one exception, by design).
- [x] 2. **Transmission well-typing.** Every Trm above has a typed `carries` and crosses a real boundary.
- [x] 3. **Placement totality.** Every Trn row names a component and its locations.
- [x] 4. **Dependency mediation.**
  - desktop → web and phone → web go only through `t_api_*`.
  - web → D1 goes only through the binding.
- [x] 5. **Composition soundness.** System views are deduced from the component docs.
- [x] 6. **`runsAt` is a relation.** `periodKey`, `bucket` and `validateItem` are placed more than once on purpose.

## 6. Modeling smells swept (§3)
- **No parallel objects.** The `Item` consolidation is in §3 above.
- **Deduced, not copied.** due, done, progress and next due are all deduced from
  `Completion*`; none is stored.
- **One source of truth.** The model lives in `packages/core`. The D1 schema mirrors its
  shape, and the server's `validateItem` is the same code that runs on the clients.
