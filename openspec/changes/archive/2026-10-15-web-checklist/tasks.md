# Tasks

## 1. Package and test harness

- [x] 1.1 Create `apps/web/package.json` (`@fruitery/web`, `"type":"module"`, devDependency `wrangler` at its current stable version, scripts `dev: wrangler dev`, `deploy: wrangler deploy`). Run `npm install` from the root. Add `apps/web/dist/`, `apps/web/.dev.vars`, `apps/web/.local/` and `.wrangler/` to `.gitignore`, and add `apps/web/.dev.vars.example`. Verify `npx wrangler --version` works from `apps/web`.
- [x] 1.2 Implement `apps/web/test/d1-sqlite.js` (D1-shaped adapter over `node:sqlite`: `prepare().bind().first()/all()/run()`, `batch()`, and a helper that applies every `migrations/*.sql` in order). Verify with `apps/web/test/d1-sqlite.test.js`: migrations apply, batch is atomic (a failing statement rolls back the batch).

## 2. Schema and seeding

- [x] 2.1 Write `apps/web/migrations/0001_init.sql` per design. Implement `apps/web/src/rows.js` (`toRow`/`fromRow` per entity). Verify with `apps/web/test/rows.test.js`: every `SEED` entity round-trips unchanged through toRow → fromRow.
- [x] 2.2 Implement `scripts/gen-seed-sql.mjs` (input path argument; default `config/seed.local.json` if present, else the example `SEED`; writes the git-ignored `apps/web/.local/seed.sql`). Migrations stay schema only (no seed migration). Add the root scripts `gen:seed`, `seed:local` (`wrangler d1 execute fruitery --local --file apps/web/.local/seed.sql`, run from `apps/web`) and `seed:remote` (same with `--remote`, run once by the user). Verify with `apps/web/test/seed-sql.test.js`: the generator output for the example `SEED` is deterministic, and applied after `0001_init.sql` to the sqlite adapter the DB holds 2 workspaces, 3 groups, 11 items and the UTC default settings.

## 3. Auth

- [x] 3.1 Implement `apps/web/src/auth.js` per design (WebCrypto RS256, JWKS cache with injected fetch, iss/aud/exp/nbf/email checks, fail-closed, `DEV_NO_AUTH`). Verify with `apps/web/test/auth.test.js`: valid token accepted; missing token, wrong key, expired, not-yet-valid, wrong aud, wrong iss, wrong email, and missing env vars all rejected; unknown kid triggers exactly one refetch; aud as string and as array.

## 4. Store and API

- [x] 4.1 Implement `apps/web/src/store.js` (`getState`, `upsertEntities`, `tick`, `untick`, `history`) using core (`mergeLww`, `validateItem`, `periodKey`, `effectiveDay`, `addDays`). Verify with `apps/web/test/store.test.js` covering every `sync-api` scenario at store level, including the all-or-nothing 422.
- [x] 4.2 Implement `apps/web/src/api.js` (`handle`) and `apps/web/src/worker.js`. Verify with `apps/web/test/api.test.js`, calling `handle(new Request(...), env, deps)` with the sqlite DB:
  - every `sync-api` scenario at HTTP level (status codes, `Cache-Control: no-store`, 403 before any DB access, 400 bad JSON, 404 unknown route);
  - the tick at 2026-10-12 09:00 Tokyo time filed as `2026-10-12`.

## 5. PWA

- [x] 5.1 Implement `apps/web/public/view.js` (`buildView`). Verify with `apps/web/test/view.test.js` covering every `phone-checklist` scenario that is pure: mixed buckets and 1/3 progress, desktop-only hidden, rotating URL on 2026-11-03, missing Google email hint, app item using `fallbackUrl`, ungrouped items last.
- [x] 5.2 Implement `apps/web/public/index.html`, `app.js`, `styles.css` (mobile-first, light/dark via `prefers-color-scheme`), `sw.js`, `manifest.webmanifest`. Verify by building (task 6.1), running `npx wrangler dev` with `DEV_NO_AUTH=1` and a local D1 migrated, then loading `http://localhost:8787` in the in-app browser:
  - the list renders the seeded example data (after `seed:local`);
  - ticking updates progress, and persists across reload;
  - toggling offline shows the banner.

  Report screenshots or page text.

## 6. Build and CI

- [x] 6.1 Implement `scripts/build-web.mjs` (clean `apps/web/dist`; copy `public/`; copy `packages/core/*.js` except `*.test.js` and `fixtures.js` into `dist/core/`; generate `icons/icon-192.png` and `icons/icon-512.png`; write the SW version from a content hash). Add the root script `build:web`. Verify with `apps/web/test/build.test.js`: dist contains the expected files, the PNGs have valid signatures and sizes, and a second run is byte-identical.
- [x] 6.2 Write `apps/web/wrangler.toml` per design. Check the `[assets]` keys against the installed wrangler and use the correct current form. Write `.github/workflows/deploy.yml` and `migrate.yml` per design. Verify that `npx wrangler deploy --dry-run --outdir .wrangler/dry` succeeds from `apps/web` (no account needed), and that both YAML files parse (`node -e` with a minimal check, or by inspection if no parser is available).
- [x] 6.3 Run `npm test` from the root; all tests (core + web) pass. Paste the summary.

## 7. Reconcile

- [x] 7.1 Update `docs/web/IMPLEMENTATION.md` (built rows with backticked refs), `docs/web/ARCHITECTURE.md` (real refs in §7; any divergence), `docs/web/STATUS.md`, `docs/STATUS.md`, `docs/IMPLEMENTATION.md` (web root, api port, entry point), and the `CLAUDE.md` edge-case test cells for offline tick and Access expiry. Write `docs/web/reviews/review-web-checklist.md` (§8 checklist). Self-check that every backticked ref resolves. Drift check after the user stages the files.

## 8. First deploy tooling

- [x] 8.1 Implement `scripts/wrangler-config.mjs` (pure `renderConfig(templateText, {d1DatabaseId})` plus `main()`): read the committed `apps/web/wrangler.toml` and write the git-ignored `apps/web/.local/wrangler.toml` with `main`, assets `directory` and `migrations_dir` rewritten to resolve from `apps/web/.local/` and the `REPLACE_WITH_D1_ID` placeholder replaced by the id from env `D1_DATABASE_ID` (wins) or `config/cloudflare.local.json`; a missing or non-UUID id exits 1 naming both sources and never prints the id. Add `config/cloudflare.example.json` and mention it in `config/README.md`. Verify with `apps/web/test/wrangler-config.test.js`: path rewriting, id insertion, placeholder gone, env beats file, missing id, malformed id, `.gitignore` lists `apps/web/.local/`.
- [x] 8.2 Add the root scripts `wrangler:config`, `deploy:web`, `migrate:remote` and change `seed:remote` to use the generated config (`migrate:local` and `seed:local` stay on the committed one). Verify: with a dummy UUID in `D1_DATABASE_ID`, `npm run wrangler:config` then `wrangler deploy --dry-run --config .local/wrangler.toml --outdir .wrangler/dry` from `apps/web` succeeds (bindings DB and ASSETS, assets directory found); delete the generated file afterwards.
- [x] 8.3 CI: in `deploy.yml` and `migrate.yml` run `npm run wrangler:config` with `D1_DATABASE_ID` from the repository secret before wrangler, pass `--config .local/wrangler.toml` in the action's `command`, and pin `wranglerVersion` to the installed wrangler version. Update the `docs/web/` user-step list (secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`) and `docs/web/IMPLEMENTATION.md`. Verify with the workflow assertions in `apps/web/test/wrangler-config.test.js`.

## 9. Offline cold start

- [x] 9.1 Keep the last successfully loaded snapshot in `localStorage` (`fruitery:lastSnapshot`, `{savedAt, snapshot}`; storage failures ignored) and show it on a cold start without a connection (or when the state fetch fails for a non-403 reason): offline banner, all checkboxes disabled, greyed list and "as of <local date time>"; reload and replace it when the connection returns. A 403 removes the stored snapshot and shows only the denial message. Pure helpers `serializeSnapshot(snapshot, nowMs)` and `restoreSnapshot(text)` (null on malformed JSON or wrong shape) in `apps/web/public/view.js`. Verify with `apps/web/test/view.test.js` (round trip, every malformed shape) and by hand under `wrangler dev`: load, simulate a failing API and reload → stored list greyed with "as of"; a forced 403 clears it.
