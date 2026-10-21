# Tasks

## 1. Setup

- [x] 1.1 Create root `package.json` (`private`, `"type":"module"`, `workspaces: ["packages/*","apps/*"]`, `engines.node ">=24"`, script `"test": "node --test"`), `packages/core/package.json` (`@fruitery/core`, `"type":"module"`, `exports` for `./index.js` and each module), and root `.gitignore` (`node_modules/`, `dist/`, `graphify-out/`, `apps/desktop/data/`, `.wrangler/`). Verify `npm test` runs and reports 0 failures (no tests yet).

## 2. Time and schedule

- [x] 2.1 Implement `packages/core/time.js` (`localParts`, `effectiveDay`, `addDays`, `daysInMonth`, `isoWeekday`, `isValidDate`, `parseHHMM`) using only `Intl`/`Date.UTC`. Verify with `packages/core/time.test.js`: Tokyo day boundary (2026-10-11T17:30Z → 2026-10-12), reset 04:00 at 02:00 → previous day, invalid timezone throws `RangeError('invalid-timezone')`, leap years, invalid dates rejected.
- [x] 2.2 Implement `packages/core/schedule.js` (`periodKey`, `nextPeriodStart`, `bucket`, `nextDue`) per design. Verify with `packages/core/schedule.test.js` covering every scenario in `specs/checklist-schedule/spec.md`, plus:
  - weekly boundaries for all 7 weekdays;
  - monthly clamping (day 29/30/31 across Feb, leap year, Apr);
  - the monthly sequence 01-31 → 02-28 → 03-31;
  - everyNDays with n=1 and n=7;
  - a monotonicity sweep: hourly instants over 400 days never decrease periodKey;
  - idempotent double tick;
  - an unscheduled item → null.

## 3. URL tokens

- [x] 3.1 Implement `packages/core/url-tokens.js` (`expandUrl`, `TOKENS` list). Verify with `packages/core/url-tokens.test.js`:
  - month rollover (2026-10-31T16:30Z in Tokyo → 202611);
  - `{DD}` zero-padding;
  - `{googleEmail}` URL-encoded;
  - a missing email reported in `missing`;
  - an unknown token reported in `unknown`;
  - a URL without tokens unchanged.

## 4. Model, defaults, ordering, merge

- [x] 4.1 Implement `packages/core/model.js`: typedefs, `validateItem`, `effectiveSleep`, `effectiveEdge`, `moveItem`. Verify with `packages/core/model.test.js`:
  - every rejection listed in `specs/item-model/spec.md`, with multiple errors reported together;
  - group from another workspace;
  - inherited/zero sleep;
  - the Edge mode × profile × device-default matrix;
  - `moveItem` keeps the id and clears `groupId`.
- [x] 4.2 Implement `packages/core/order.js` (`reorder`). Verify with `packages/core/order.test.js`: move to top, to end, out of range, unknown id, only changed entities get the new `updatedAt`, input arrays not mutated.
- [x] 4.3 Implement `packages/core/sync.js` (`mergeLww`). Verify with `packages/core/sync.test.js`: newer wins, stale tombstone loses, newer tombstone wins, tie broken deterministically, commutativity/associativity/idempotence over randomized snapshots (seeded PRNG, ≥200 cases), output sorted by id.

## 5. Seed and entry point

- [x] 5.1 Implement `packages/core/seed.js` (`SEED`) exactly as listed in design.md, and `packages/core/index.js` re-exporting all public functions. Verify with `packages/core/seed.test.js`:
  - every seed item passes `validateItem`;
  - 11 items;
  - order is dense per parent;
  - groups belong to Daily;
  - the monthly shop example URL expands for 2026-11-01 to `.../202611`.

## 6. Reconcile

- [x] 6.1 Run `npm test` from the repo root and confirm all tests pass. Paste the summary line into the review.
- [x] 6.2 Update `docs/core/IMPLEMENTATION.md`: rows become built, with backticked `packages/core/<file>.js:<symbol>` refs and test refs. Update `docs/core/ARCHITECTURE.md` (add `Workspace.openInEdge`, `effectiveEdge`, `moveItem`, the mergeLww canonical tie-break). Update `docs/core/STATUS.md`, `docs/STATUS.md` and `docs/IMPLEMENTATION.md`. Verify the docs list no planned core rows.
- [x] 6.3 Write `docs/core/reviews/review-core-model.md` (the §4.5 checklist run). The user stages the files, then run the drift check (`drift-check.ps1`) and confirm 0 dead.
