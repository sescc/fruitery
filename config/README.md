# config

Personal data lives in git-ignored `*.local.json` files here; the repo ships generic examples.

- `seed.local.json` (same shape as `SEED` in `packages/core/seed.js`): your own workspaces and items. Seeding tools prefer it when present. The desktop app reads it from here on its first run in development, and `npm run install:desktop` copies it next to the installed `Fruitery.exe` (only when the target has none); once `data\cache.json` exists the seed is no longer used.
- `cloudflare.local.json` (same shape as `cloudflare.example.json`): your D1 database id, `{"d1DatabaseId": "<uuid>"}`. `scripts/wrangler-config.mjs` reads it, or the env var `D1_DATABASE_ID` (which wins), and writes the git-ignored `apps/web/.local/wrangler.toml` used by `deploy:web`, `migrate:remote` and `seed:remote`. In CI the id comes from the `D1_DATABASE_ID` secret.
