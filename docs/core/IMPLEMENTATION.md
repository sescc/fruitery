# Core — implementation map

> The functor ARCHITECTURE.md → code. Each object/morphism → the file:symbol that realises it.
> Keep in sync WITH the code (§6.3). Rows that claim to be built use backticked
> `path:symbol` refs so the drift check can resolve them.

## Objects (Dat) → code
| Object | Form / shape | Realised at | State |
|---|---|---|---|
| Workspace | JSDoc typedef (incl. `openInEdge` and the optional `ungroupedLabel`, D99) | `packages/core/model.js:Workspace` | built |
| Group | JSDoc typedef | `packages/core/model.js:Group` | built |
| Item | JSDoc typedef (a check-in is an Item with `schedule`) | `packages/core/model.js:Item` | built |
| Settings | JSDoc typedef | `packages/core/model.js:Settings` | built |
| Completion | JSDoc typedef `{itemId, periodKey, doneAt}` | `packages/core/schedule.js:Completion` | built |
| Schedule | tagged union `{type: 'daily'│'weekly'│'monthly'│'everyNDays', …}` | `packages/core/schedule.js:Schedule` | built |
| UserAgentPref | JSDoc typedef `{preset, custom}`; optional `Item.userAgent`; example items carry `{preset:'default', custom:null}` | `packages/core/model.js:UserAgentPref` | built |
| Seed dataset | example: 2 workspaces, 3 groups, 11 items, UTC settings (deep-frozen) | `packages/core/seed.js:SEED` | built |
| Token list | `['YYYY','MM','DD','googleEmail']` | `packages/core/url-tokens.js:TOKENS` | built |
| Settings sync id | fixed key `'settings'` for the id-less Settings entity | `packages/core/sync.js:SETTINGS_ID` | built |

## Morphisms (Trn / relations) → code
| Morphism | Signature | Realising code | State |
|---|---|---|---|
| localParts | `Instant × Tz → {date, minutes}` | `packages/core/time.js:localParts` | built |
| effectiveDay | `Instant × Tz × ResetTime → Date` | `packages/core/time.js:effectiveDay` | built |
| addDays | `Date × ℤ → Date` | `packages/core/time.js:addDays` | built |
| daysInMonth | `ℕ × ℕ → ℕ` | `packages/core/time.js:daysInMonth` | built |
| isoWeekday | `Date → 1..7` | `packages/core/time.js:isoWeekday` | built |
| isValidDate | `unknown → 𝔹` | `packages/core/time.js:isValidDate` | built |
| parseHHMM | `unknown → ℕ?` | `packages/core/time.js:parseHHMM` | built |
| parseDate | `Date → {y, m, d}` | `packages/core/time.js:parseDate` | built |
| formatDate | `ℕ × ℕ × ℕ → Date` | `packages/core/time.js:formatDate` | built |
| daysBetween | `Date × Date → ℤ` | `packages/core/time.js:daysBetween` | built |
| periodKey | `Schedule × Instant × Tz × ResetTime → PeriodKey?` | `packages/core/schedule.js:periodKey` | built |
| nextPeriodStart | `Schedule × PeriodKey → Date` | `packages/core/schedule.js:nextPeriodStart` | built |
| previousPeriodStart | `Schedule × PeriodKey → Date?` (the inverse of `nextPeriodStart`: daily −1 day, weekly −7, every-N-days −n and null before the start date, monthly the previous month's clamped day) | `packages/core/schedule.js:previousPeriodStart` | built |
| bucket | `Item × Completion* × Instant × Tz → Bucket?` | `packages/core/schedule.js:bucket` | built |
| nextDue | `Item × Completion* × Instant × Tz → Date?` | `packages/core/schedule.js:nextDue` | built |
| streak | `Item × Completion* × Instant × Tz → {current, longest}` (consecutive done periods; today-not-done does not zero `current`; D156) | `packages/core/schedule.js:streak` | built |
| validateSchedule | `Schedule → Error*` (`everyNDays.n` bounded by `MAX_EVERY_N_DAYS = 3660`, D154) | `packages/core/schedule.js:validateSchedule` | built |
| expandUrl | `𝕊 × Instant × Tz × Settings → {url, unknown, missing}` | `packages/core/url-tokens.js:expandUrl` | built |
| findTokens | `𝕊 → 𝕊*` | `packages/core/url-tokens.js:findTokens` | built |
| unknownTokens | `𝕊 → 𝕊*` | `packages/core/url-tokens.js:unknownTokens` | built |
| validateItem | `Item × Group* → Error*` (includes `deepLink` via `validateDeepLink`, D157) | `packages/core/model.js:validateItem` | built |
| validateDeepLink / isUsableDeepLink | `𝕊? → Error*` / `𝕊? → 𝔹` (Android intent / safe custom scheme; rejects unsafe schemes and intent fallbacks; D157) | `packages/core/deep-link.js` | built |
| effectiveSleep | `Item × Workspace → ℕ` | `packages/core/model.js:effectiveSleep` | built |
| effectiveEdge | `Item × Workspace × Profile? → {open, profile}` | `packages/core/model.js:effectiveEdge` | built |
| validateWorkspace | `Workspace → Error*` | `packages/core/model.js:validateWorkspace` | built |
| ungroupedLabelOf | `Workspace → 𝕊` ("Default" when unset) | `packages/core/model.js:ungroupedLabelOf` | built |
| userAgentOf | `Item → UserAgentPref` (absent → default) | `packages/core/model.js:userAgentOf` | built |
| moveItem | `Item × WorkspaceId × Instant → Item` | `packages/core/model.js:moveItem` | built |
| removalPlan | `Snapshot × Kind × Id × Instant → {changed} ⊕ {error}` | `packages/core/removal.js:removalPlan` | built |
| reorder | `Entity* × id × ℕ × Instant → Entity*` | `packages/core/order.js:reorder` | built |
| mergeLww | `Entity* × Entity* → Entity*` | `packages/core/sync.js:mergeLww` | built |
| (entry point) | re-exports the public API | `packages/core/index.js:localParts` | built |

## Composition rules → where enforced
| Rule (ARCHITECTURE §6) | Enforced at | Tested at |
|---|---|---|
| 1 isDone deduced | `packages/core/schedule.js:bucket` | `packages/core/schedule.test.js:Yesterday` |
| 2 tick idempotent per (item, period) | `packages/core/schedule.js:bucket` | `packages/core/schedule.test.js:Idempotent` |
| 3 periodKey monotone | `packages/core/schedule.js:periodKey` | `packages/core/schedule.test.js:sweep` |
| previousPeriodStart is the inverse of nextPeriodStart (the Worker allows an untick of the current or the previous period, the desktop files late ticks by it) | `packages/core/schedule.js:previousPeriodStart` | `packages/core/schedule.test.js`: "previousPeriodStart: daily, weekly, every-N-days (null before the start), monthly with clamping", "previousPeriodStart is the inverse of nextPeriodStart for every schedule type over 200 random periods" |
| 4 bucket semantics | `packages/core/schedule.js:bucket` | `packages/core/schedule.test.js:Unscheduled` |
| 5 token expansion | `packages/core/url-tokens.js:expandUrl` | `packages/core/url-tokens.test.js:rollover` |
| 6 group/workspace agreement | `packages/core/model.js:validateItem` | `packages/core/model.test.js:mismatch` |
| 6 move clears group | `packages/core/model.js:moveItem` | `packages/core/model.test.js:moveItem` |
| 7 mergeLww semilattice | `packages/core/sync.js:mergeLww` | `packages/core/sync.test.js:associative` |
| 8 validation | `packages/core/model.js:validateItem` | `packages/core/model.test.js:validateItem` |
| User-agent preset valid (enum; custom non-empty, at most 512; absent = default) | `packages/core/model.js:validateItem` | `packages/core/model.test.js`: "Missing preset: an item without userAgent has no error and is treated as default", "Custom without a string: an empty, blank or missing custom string is a userAgent.custom error", "Custom UA: up to 512 characters is accepted, 513 is out of range", "Preset enum: default, chrome, firefox and custom are accepted; anything else is an invalid-value" |
| Deletion rules (item / group / workspace, last workspace refused, tombstones stamped) shared by phone and desktop | `packages/core/removal.js:removalPlan` | `packages/core/removal.test.js`: "Group deletion keeps items: the group is marked deleted, its items become ungrouped with a new update time", "Workspace deletion cascades: the workspace, its groups and its items are all marked deleted", "Last workspace refused: nothing changes" |
| Workspace valid (non-blank name; ungrouped label non-blank, at most 40; absent = "Default") | `packages/core/model.js:validateWorkspace` | `packages/core/model.test.js`: "Workspace: a blank or missing name is required", "Workspace: the ungrouped label must be non-blank text of at most 40 characters when set", "ungroupedLabelOf: the trimmed label, else "Default"" |
| Edge resolution | `packages/core/model.js:effectiveEdge` | `packages/core/model.test.js:matrix` |
| dense ordering | `packages/core/order.js:reorder` | `packages/core/order.test.js:reorder` |
| seed integrity | `packages/core/seed.js:SEED` | `packages/core/seed.test.js:validateItem` |

## Notes / divergences
Interpretations where `design.md` was silent (all accepted in review; see CLAUDE.md D47):
- `validateItem` reports `group-not-found` only when a `groups` list is supplied; without one,
  no group checks run. It also checks `kind` and `edge.profile`, and treats blank
  `url`/`appPath`/`fallbackUrl` as absent.
- With duplicate completion rows for one (item, period), `bucket`/`nextDue` use the earliest
  `doneAt`, so the result does not depend on array order.
- `periodKey` and `nextPeriodStart` throw `RangeError('invalid-schedule')` on an invalid
  schedule; `effectiveDay` throws `invalid-reset-time`; an undefined timezone throws
  `invalid-timezone` (never the ambient zone).
- `moveItem` clears `groupId` and bumps `updatedAt` but leaves `order`; the caller places the
  item among its new siblings with `reorder`. Moving to the current workspace returns an
  unchanged copy.
- `reorder` sorts siblings by `order`, ties by `id`; an unknown id returns shallow copies.
- `mergeLww` keys an entity without a string `id` (Settings) as `'settings'`; the tie-break is the
  greater canonical JSON (keys sorted).
- `SEED` is a generic example (D54), deep-frozen. Personal data lives in the git-ignored `config/seed.local.json` (same shape); `packages/core/seed.test.js` validates it when present.
- Extra exports beyond design.md: `validateSchedule`, `findTokens`, `unknownTokens`,
  `parseDate`, `formatDate`, `daysBetween`, `SETTINGS_ID`, `nextPeriodStart`, `previousPeriodStart`.
