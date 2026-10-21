# Review — web-checklist

- Date: 2026-10-13
- Change: `web-checklist`
- Component: web (`apps/web/`), plus `scripts/build-web.mjs` and `scripts/gen-seed-sql.mjs`

## Test summary
`npm test` from the repo root (core and web tests together):
```
ℹ tests 254
ℹ suites 0
ℹ pass 254
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
Breakdown: core 133 + web 121 (adapter 4, rows 8, seed 6, auth 26, store 24, api 20, view 14, build 5, wrangler-config 14) = 254. The throwaway spike tests (11, the earlier "136" was core + spike) are no longer present: `spikes/` was removed from the working tree after the first review. The test helpers live in `apps/web/test-support/` so that node's default `**/test/**/*.js` glob does not run them as empty test files.

## Checklist (FRAMEWORK §8)
Legend: [x] pass · [ ] fail · [~] not applicable

### Coherence
- [x] Placement honesty: the Worker reads the clock only at the entry point (`apps/web/src/worker.js:fetch` passes `now: Date.now()`); `apps/web/src/api.js:handle`, `apps/web/src/store.js` and `apps/web/src/auth.js` take `now` and `fetch` as parameters, so every test is deterministic.
- [x] Transmission well-typing: `t_api_*` is JSON over HTTPS; every response is JSON with `Cache-Control: no-store`; errors are `{error, details?}`.
- [x] Placement totality: every Trn in `docs/web/ARCHITECTURE.md` §7 has a built ref in `docs/web/IMPLEMENTATION.md`.
- [x] Dependency mediation: clients reach D1 only through `/api` (Law 4); the PWA imports core as a build-time copy in `dist/core/`.
- [x] Composition soundness: rules 1–5 are enforced and tested or explicitly marked manual (`docs/web/IMPLEMENTATION.md`).
- [x] `runsAt` relation: core runs at the Worker (bundled by wrangler) and in the PWA (copied) from one source.

### Modeling smells
- [x] No parallel objects: the PWA view is deduced (`apps/web/public/view.js:buildView`), never stored.
- [x] Deduced, not copied: the snapshot carries completions, never a done flag; `bucket` and `nextDue` come from core.
- [x] Stored-deduced: none (`period_key` is data: the period a tick was filed in).
- [x] Diagram ⇄ table: `docs/web/ARCHITECTURE.md` §3/§4/§7 updated together with the code.

### Process gates
- [x] Model updated together with the code.
- [x] Boundaries have a single source: row shapes mirror `packages/core/model.js`; the API contract is `openspec/specs/sync-api/spec.md` (archived 2026-10-15).
- [x] Status updated (`docs/web/STATUS.md`, `docs/STATUS.md`).
- [x] Violated rules: none.
- [x] D53 (public-ready): migrations are schema only; the personal seed is generated into the git-ignored `apps/web/.local/seed.sql`; `wrangler.toml` holds `REPLACE_WITH_D1_ID` and no owner address; `apps/web/.dev.vars.example` holds placeholders only.

## Manual checks (2026-10-13, local `wrangler dev` with `DEV_NO_AUTH=1` on localhost, embedded browser)
- Migrated the local D1, seeded it with the local personal seed, built, and served: `/` and the shell files answered 200, /index.html answered 307, `/api/state` answered 200 with `no-store`, `/api/nope` answered 404.
- The list rendered grouped by workspace with per-group `done/total`; ticking one item moved its group to 1/n and the header to 1/20; the tick survived a reload (it is in D1).
- Simulated offline (`offline` event with `navigator.onLine` false): banner shown, every checkbox disabled, list kept; back online: banner gone and checkboxes enabled.
- A failing tick API (stubbed 500): the item reverted and the error toast appeared.
- `wrangler deploy --dry-run --outdir .wrangler/dry` succeeded without an account (bindings: `DB`, `ASSETS`).

## Open
- Verified on the real deployment 2026-10-15 (user): all three Access logins reach the checklist, installed on Android, service worker active in desktop Chrome, airplane-mode cold start shows the stored list greyed with "as of", ticks sync phone and PC both ways, migration 0002 applied remotely. (The embedded browser could not register a service worker, so this was the first real service-worker run; the install preconditions had been checked by hand against `wrangler dev`.)
- Not yet observed: the Access-session-expiry reload in real use.
- `cloudflare/wrangler-action@v4`, `actions/checkout@v7` and `actions/setup-node@v7` exist as tags but the workflows have not run (no secrets yet). The workflows now generate the local wrangler config from the `D1_DATABASE_ID` secret and pin `wranglerVersion` (first-deploy tooling, tasks 8.1–8.3).
- The drift check needs the files staged by the user; run it then and confirm 0 dead refs (task 7.1).

Verdict: PASS (pending the open items above)
