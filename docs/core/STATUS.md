# Core — status

> Reconciles ARCHITECTURE.md (intent) vs IMPLEMENTATION.md (code). Updated whenever code
> changes what is done (§6.5).

## Headline
✅ Built — core tests green (`previousPeriodStart` from `offline-ticks` 1.1; `userAgent` from `desktop-shell` 1.1; `removalPlan` from `phone-editor` 1.1; `validateWorkspace` and `ungroupedLabelOf` from `phone-editor` 5.3; `streak`, `MAX_EVERY_N_DAYS` and `validateDeepLink` from the feature batch 2026-10-31).

## Completeness
| Object / morphism | State | Notes |
|---|---|---|
| model typedefs + validateItem + effectiveSleep + effectiveEdge + moveItem + userAgentOf | ✅ built | `packages/core/model.js` (item `deepLink` field, D157) |
| time helpers + periodKey / previousPeriodStart / bucket / nextDue / streak | ✅ built | `packages/core/time.js`, `packages/core/schedule.js` (`streak` {current, longest}, D156; `MAX_EVERY_N_DAYS` bound, D154) |
| expandUrl | ✅ built | `packages/core/url-tokens.js` |
| validateDeepLink / isUsableDeepLink | ✅ built | `packages/core/deep-link.js` (phone deep-link safety, D157) |
| removalPlan (shared deletion rules) | ✅ built | `packages/core/removal.js` |
| reorder / mergeLww | ✅ built | `packages/core/order.js`, `packages/core/sync.js` |
| seed | ✅ built | `packages/core/seed.js` (11 example items) |

## Needs work
1. ~~Archive `core-model`~~ — archived 2026-10-14 (temp-repo drift check 0 dead, D64). `userAgent` + `userAgentOf` added 2026-10-15 (`desktop-shell` 1.1).
2. Consumers (web, desktop) not yet built.

## Coherence
No FAILs. Review: `docs/core/reviews/review-core-model.md`.

## Where to dig
- Model: ARCHITECTURE.md · Code map: IMPLEMENTATION.md
- In flight: `openspec/changes/core-model/`
