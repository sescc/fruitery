# Design

## Context
- `packages/core` is built: `periodKey`, `bucket`, `nextDue`, `expandUrl`, `validateItem`,
  `mergeLww`, `SEED`, and the others. Model: `docs/web/ARCHITECTURE.md`.
- **Conventions:** plain JS ES modules, JSDoc, `// @ts-check`, `node:test`.
- **Dependencies:** `wrangler` is the only one allowed here, as a devDependency of `apps/web`.
- No Cloudflare account is connected yet. Everything must be buildable and fully testable
  locally, and the deploy steps are user-gated.

## Goals / Non-Goals
**Goals:**
- the Worker API from `specs/sync-api`;
- Access JWT validation;
- the D1 schema (migrations are schema only) and the local/remote seeding scripts;
- the phone PWA from `specs/phone-checklist`;
- the build script;
- the CI workflows;
- local tests with a `node:sqlite` D1 stand-in.

**Non-Goals:**
- editing items, workspaces or settings in the PWA (the desktop app does that; the API supports it);
- push reminders (D34);
- an offline tick queue (D27);
- streak UI.

## Decisions

### Model delta
No new objects (§3).

**Placements and morphisms:**
- `DataLoc`s of the existing `Workspace`, `Group`, `Item`, `Settings` and `Completion` at
  L-db (authoritative). Row shapes mirror core 1:1.
- `authenticate : Request × Env → Identity?` (Partial).
- `route : Request → Response`.
- `upsert : Body × Rows → Rows ⊕ Error*`, which is `mergeLww` then `validateItem`.
- `tick : ItemId × Instant → Completion ⊕ {404,409}`. `now` comes from L-edgeW (Law 1).
- `buildView : Snapshot × Instant → View` (pure, PWA).

**§3 check:** the PWA view model is a deduction (`bucket` and `nextDue` over the snapshot), not a
stored object.

**Laws kept:**
- Law 1: tick uses the server clock.
- Law 4: clients reach D1 only via the API.
- Law 6: `validateItem` runs at both the client and L-edgeW, and `bucket` runs at the PWA and
  the desktop.

### Layout
```
apps/web/
  package.json            (@fruitery/web, devDependency wrangler)
  wrangler.toml
  .dev.vars.example       (DEV_NO_AUTH=1)
  src/worker.js           export default { fetch(request, env, ctx) } → handle(request, env, {now: Date.now(), fetch})
  src/api.js              handle(request, env, deps): routing, JSON, status codes, Cache-Control: no-store
  src/auth.js             authenticate(request, env, deps) → {email}|null
  src/store.js            getState, upsertEntities, tick, untick, history (all take a D1-like db)
  src/rows.js             toRow/fromRow per entity (booleans 0/1, schedule JSON, edge_mode/edge_profile)
  migrations/0001_init.sql   (schema only; no data migrations)
  .local/seed.sql            (generated, git-ignored)
  public/index.html, app.js, view.js, styles.css, sw.js, manifest.webmanifest
  test/d1-sqlite.js       D1-shaped adapter over node:sqlite (test only)
  test/*.test.js
scripts/build-web.mjs     → apps/web/dist (public + core copy + icons + SW version)
scripts/gen-seed-sql.mjs  → apps/web/.local/seed.sql from config/seed.local.json (if present) else SEED
.github/workflows/deploy.yml, migrate.yml
```
- The Worker imports core by relative path (`../../../packages/core/index.js`); wrangler's
  built-in esbuild bundles it.
- The PWA imports `./core/index.js`, which the build copies there. One source of truth, no bundler.

### wrangler.toml
- `name = "fruitery"`, `main = "src/worker.js"`, `compatibility_date = "2026-10-01"`.
- `keep_vars = true`.
- `[assets] directory = "./dist"`, `binding = "ASSETS"`, `run_worker_first = ["/api/*"]`.
- `[[d1_databases]] binding = "DB"`, `database_name = "fruitery"`, `database_id = "REPLACE_WITH_D1_ID"`,
  `migrations_dir = "migrations"`.
- `TEAM_DOMAIN`, `POLICY_AUD` and `OWNER_EMAIL` are **not** in the file. They are set as
  dashboard variables, which `keep_vars` preserves, so the owner email never enters the repo.
  Local dev reads `.dev.vars` (git-ignored).

### Deploy config (first-deploy tooling)
The real D1 `database_id` must not enter the repo (D53), so the committed `apps/web/wrangler.toml` keeps
`REPLACE_WITH_D1_ID` and every remote command uses a generated, git-ignored copy.
- **`scripts/wrangler-config.mjs`:** exports a pure `renderConfig(templateText, {d1DatabaseId})` and a `main()`.
  - It reads `apps/web/wrangler.toml` and writes `apps/web/.local/wrangler.toml` with `main`, the assets `directory`
    and `migrations_dir` rewritten to resolve from `apps/web/.local/` (`../src/worker.js`, `../dist`, `../migrations`)
    and the placeholder replaced by the id.
  - **Id source:** env `D1_DATABASE_ID` (wins), else `config/cloudflare.local.json` (`{"d1DatabaseId": "..."}`, git-ignored;
    the committed `config/cloudflare.example.json` shows the shape).
  - A missing or blank id, or one that is not a UUID, exits 1 with a message naming both sources. The id is never printed.
- **Root scripts:**
  - `wrangler:config` runs the generator.
  - `deploy:web` = build, generate the config, `wrangler deploy --config .local/wrangler.toml`.
  - `migrate:remote` = generate, `wrangler d1 migrations apply fruitery --remote --config .local/wrangler.toml`.
  - `seed:remote` = generate the seed and the config, then `wrangler d1 execute ... --remote --config .local/wrangler.toml`.
  - `migrate:local` and `seed:local` keep the committed config (local D1 ignores the id).
- **CI:** both workflows run `npm run wrangler:config` with `D1_DATABASE_ID` from the repository secret before wrangler,
  pass `--config .local/wrangler.toml` in the action's `command`, and pin `wranglerVersion` to the version in
  `apps/web/package.json` (a test keeps them equal). Secrets are now `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
  and `D1_DATABASE_ID`.

### Auth
- **Token source:** the header `Cf-Access-Jwt-Assertion` only.
- **Signature:** RS256, verified with `crypto.subtle`.
  - Keys come from `${TEAM_DOMAIN}/cdn-cgi/access/certs`, field `keys` (JWKs), cached in module
    memory for 10 minutes. The fetcher is injected via `deps.fetch`.
  - Unknown `kid` → refetch once.
- **Claim checks:**
  - `iss === TEAM_DOMAIN`;
  - `aud` (string or array) contains `POLICY_AUD`;
  - `exp > now` and `nbf ≤ now`, with 60 s leeway;
  - lower-cased `email === OWNER_EMAIL`.
- **Fails closed:** missing vars → null → 403. `env.DEV_NO_AUTH === "1"` → `{email:'dev@local'}`.
- **Tests:** generate an RSA key pair with `crypto.subtle` and stub `deps.fetch`.

### Schema (0001_init.sql)
- `workspaces(id TEXT PK, name, icon, ord INTEGER, sleep_after_min INTEGER, open_in_edge INTEGER, updated_at INTEGER, deleted INTEGER)`
- `groups(id PK, workspace_id, name, ord, collapsed, updated_at, deleted)`
- `items(id PK, workspace_id, group_id, ord, name, icon, kind, url, app_path, fallback_url, devices, schedule TEXT (JSON|NULL), reset_time, notify, badge, edge_mode, edge_profile, isolate, persist_session_cookies, sleep_after_min (NULL=inherit), updated_at, deleted)`
- `completions(item_id, period_key, done_at, PRIMARY KEY(item_id, period_key))`
- `settings(id TEXT PK CHECK(id='settings'), timezone, google_email, updated_at)`

**Seeding is not a migration** (D55). Migrations hold the schema only; a committed seed migration
would publish personal data.
- `scripts/gen-seed-sql.mjs` takes an input path (default: `config/seed.local.json` when present,
  else the example `SEED` from core) and writes deterministic `INSERT` statements to the
  git-ignored `apps/web/.local/seed.sql`.
- Root scripts: `seed:local` runs `wrangler d1 execute fruitery --local --file apps/web/.local/seed.sql`
  from `apps/web`; `seed:remote` is the same with `--remote` and is run once by the user.
- Tests: the generator output for the example `SEED` is deterministic, and applied after
  `0001_init.sql` to the sqlite adapter it yields 2 workspaces, 3 groups, 11 items and the UTC
  settings.

### API behaviour
- Bodies are JSON, and every response has `Cache-Control: no-store`.
- Errors are `{error: <code>, details?}`.

**`PUT /api/entities`:**
1. Shape-check every entity: `id` string, `updatedAt` finite number, and the type's required
   fields. Failure → 400.
2. Load the stored rows for the sent ids, then `mergeLww` per type.
3. Run `validateItem` on every merged item, using the groups from (stored ∪ merged groups).
4. Validate the settings timezone via `Intl` (core `localParts` throws on an invalid one).
5. Any error → 422 `{error:'invalid', details:[{id, errors}]}`, and nothing is written.
6. Otherwise write only the changed winners in one `db.batch` (`INSERT … ON CONFLICT(id) DO UPDATE`).
7. Respond with the winners.

**Ticks:**
- `POST /api/ticks` body `{itemId}`:
  - 404 for an unknown item;
  - 409 if the item is deleted, has no schedule, or `periodKey` is null;
  - otherwise `INSERT OR IGNORE`, then return the stored completion.
- `DELETE /api/ticks/{itemId}` removes the current period's tick and returns `{removed: n}`.

**`GET /api/state`:**
- **`since`:** defaults to `addDays(effectiveDay(now, tz), -max(62, maxN))`. Completions are
  filtered by `period_key >= since`.
- **Response:** `{workspaces, groups, items, settings, completions, serverNow}`. It includes
  tombstones, so clients merge deletions.

**Timestamps:** `updatedAt` is client-supplied, so the LWW clock is the client's. Skew between
the user's own devices is acceptable, per D-log.

### PWA
- **`view.js`** (pure, tested) exports `buildView(snapshot, nowMs)`, which returns
  `{workspaces:[{id,name,groups:[{id|null,name,progress:{done,total},items:[ItemView]}],notDue:[ItemView]}]}`.
  - `ItemView = {id, name, bucket, nextDue, href|null, hint|null}`.
  - **Filter:** scheduled, not deleted, devices `all` or `phone`.
  - **Ordering:** stored `order`; ungrouped items come last as group `null` ("Other").
  - **Link:** `href` comes from `expandUrl(url ?? fallbackUrl)`. App items use `fallbackUrl`.
    If a value is missing, `hint` is `'set-google-email'` and `href` is null.
- **`app.js`:**
  - Fetches `/api/state` (same origin) and renders with plain DOM APIs.
  - Ticks optimistically: update, call the API, revert on failure with a toast.
  - Re-renders every 60 s and refetches on `visibilitychange` → visible.
  - Offline when `!navigator.onLine` or the fetch fails: banner, checkboxes disabled.
  - **Detecting an expired Access session:** if a fetch fails while online, call
    `fetch('/api/state', {redirect:'manual'})`.
    - `response.type === 'opaqueredirect'` → `location.reload()`, guarded to once per 30 s via
      `sessionStorage`.
    - Otherwise → treat as offline.
- **`sw.js`:**
  - Precaches the app shell list under a cache name containing the build version (written by
    the build).
  - `/api/*` → no `respondWith` (network only).
  - Navigations → network first; fall back to the cached `index.html` only on a network error.
  - Never caches redirects, non-200 responses or cross-origin responses.
  - Deletes old caches on activate.
- **Manifest:** linked with `crossorigin="use-credentials"`. `display: standalone`,
  `start_url: "/"`, and PNG icons at 192 and 512 px. The build generates the icons with a tiny
  PNG encoder (`node:zlib` deflate + CRC32): a small fruit basket made of simple geometric shapes
  (a basket shape in a warm accent colour with one round fruit).
  - `name: "Fruitery"`, `short_name: "Fruitery"`; the page has `<title>Fruitery</title>`.
- **UI copy (D51; copy only, data-model names such as Workspace, Item and Completion are unchanged):**
  - the phone app header reads "Today's picks";
  - per-group progress stays "done/total";
  - a fully done day shows "Basket full 🧺".

### CI
- **`deploy.yml`:** on push to `main`, run job `test` (ubuntu-latest, Node 24, `npm ci`,
  `npm test`). Then job `deploy` (needs test): `npm ci`, `node scripts/build-web.mjs`, then
  `cloudflare/wrangler-action@v4` with `apiToken`, `accountId`, `workingDirectory: apps/web` and
  `command: deploy`.
- **`migrate.yml`:** `workflow_dispatch` only. Runs the same action with
  `command: d1 migrations apply fruitery --remote`.
- **Secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `D1_DATABASE_ID`. Both workflows generate the local wrangler config and pass `--config .local/wrangler.toml` (see "Deploy config").

### Root scripts
`"build:web": "node scripts/build-web.mjs"` and `"gen:seed": "node scripts/gen-seed-sql.mjs"`, `"seed:local"` and `"seed:remote"` (see Schema).
`npm test` stays `node --test`, so it picks up `apps/web/test/*.test.js`. The scripts are pure
Node: `node:fs`, `node:path`, `node:zlib`, `node:crypto`.

## Risks / Trade-offs
- **`run_worker_first` and the `[assets]` keys depend on the wrangler version.** The implementer
  must check them against the installed wrangler's docs or schema.
- **The node:sqlite D1 adapter only approximates D1** (no remote latency or limits). The real D1
  is exercised on the first deploy (spike c).
- **Opaque-redirect detection depends on Access answering with a 302.** If Access answers
  differently, the fallback is the offline banner, which is safe.
- **LWW trusts client clocks.** This is acceptable for one user's devices.

## Open Questions
None blocking. The real `database_id`, AUD and team domain are user-supplied at deploy time.
