# Proposal

## Why
The phone and the second PC need one authoritative copy of the workspaces, items and ticks, and
the phone needs a checklist app. Q19/Q20 chose Cloudflare (Worker + D1 + Access) and a PWA
(docs/web/ARCHITECTURE.md). `core-model` is built, so the server and the PWA can reuse its
schedule, validation and merge logic unchanged.

## What Changes
- New package `apps/web` (Cloudflare Worker; `wrangler` is its only devDependency).
- **JSON API under `/api`** (contract in `specs/sync-api`):
  - state snapshot;
  - last-write-wins upsert of workspaces, groups, items and settings;
  - tick and untick, with the period decided by the server clock;
  - per-item history.
- **Authentication:** Cloudflare Access JWT validation using WebCrypto only. A local-dev bypass
  works only when explicitly enabled.
- **D1:** a schema-only migration (`0001_init.sql`). Seeding is separate (D55): `scripts/gen-seed-sql.mjs`
  generates a git-ignored `apps/web/.local/seed.sql` from `config/seed.local.json` (if present) or the
  example `SEED`, applied with the root scripts `seed:local` and `seed:remote`.
- **Installable PWA** (phone checklist; contract in `specs/phone-checklist`):
  - groups with progress, due/done/not-due buckets, ticking;
  - a link that opens each site;
  - an offline banner that disables ticking;
  - an app-shell service worker that never caches the API.
- **Build script:** copies the PWA and `packages/core` into `apps/web/dist` (static assets); no
  bundler. Also generates the PWA icons.
- **GitHub Actions:**
  - `deploy.yml`: on push to main, run the tests, then build and deploy.
  - `migrate.yml`: a manual `workflow_dispatch` that applies D1 migrations remotely.
- A D1-shaped adapter over `node:sqlite` for tests.

## Capabilities

### New Capabilities
- `sync-api`: the HTTP API every client uses (who may call it, snapshot, upsert/merge, ticks,
  history, error responses).
- `phone-checklist`: what the installed phone app shows and does (due list, ticking, opening
  sites, offline behaviour, installability).

### Modified Capabilities
None.

## Impact
- **New code:** `apps/web/**`, `scripts/build-web.mjs`, `scripts/gen-seed-sql.mjs` (output git-ignored),
  `.github/workflows/{deploy,migrate}.yml`.
- **Dependencies:** `wrangler` (devDependency of `apps/web`, project-local).
- **User steps needed before the first deploy** (not part of apply):
  - a Cloudflare account with Zero Trust (walkthrough given 2026-10-12);
  - create the D1 database and put its id in `wrangler.toml`;
  - enable Access on the Worker and add the AUD and team domain as vars;
  - add the GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- **Docs:** web component docs move from planned to built. The desktop component will consume
  `sync-api`.
