# Review — core-model

- Date: 2026-10-12
- Change: `core-model`
- Component: core (`packages/core/`)

## Test summary
`npm test` from the repo root:
```
ℹ tests 136
ℹ suites 0
ℹ pass 136
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

## Checklist (FRAMEWORK §8)
Legend: [x] pass · [ ] fail · [~] not applicable

### Coherence
- [x] Placement honesty: no ambient clock or state in core (`Date.now`, `process`, `node:` imports grep-confirmed absent from non-test files); `now`, `tz` and completions are always parameters.
- [~] Transmission well-typing: n/a, core has no Trm.
- [x] Placement totality: every Trn is mapped in `docs/core/IMPLEMENTATION.md`.
- [~] Dependency mediation: n/a, core is imported in-process.
- [~] Composition soundness: n/a, single component.
- [x] `runsAt` relation: core is intended for three placements (Worker, desktop, phone) and is pure, so they cannot disagree.

### Modeling smells
- [x] No parallel objects: `CheckIn` is consolidated into `Item.schedule?`.
- [x] Deduced, not copied: done, bucket and nextDue are deduced from completions.
- [x] Stored-deduced: none.
- [x] Diagram ⇔ table: verified after the 6.2 reconcile (`openInEdge`, `effectiveEdge`, `moveItem` added to both).

### Process gates
- [x] Model updated together with the code.
- [x] Boundaries have a single source: the `packages/core/model.js` typedefs.
- [x] Status updated (`docs/core/STATUS.md`, `docs/STATUS.md`).
- [x] Violated rules: none.

## Open
- The drift check (`drift-check.ps1`) needs the files staged by the user; run it then and confirm 0 dead refs (task 6.3).

Verdict: PASS
