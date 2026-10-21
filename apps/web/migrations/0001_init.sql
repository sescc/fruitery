-- Fruitery D1 schema. Schema only: seeding is separate (scripts/gen-seed-sql.mjs, decision D55).
-- Booleans are 0/1, timestamps are epoch milliseconds, the schedule is a JSON string (or NULL).
-- No foreign keys: entities merge last-write-wins and may arrive in any order; tombstones are rows.

CREATE TABLE workspaces (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  icon            TEXT,
  ord             INTEGER NOT NULL,
  sleep_after_min INTEGER NOT NULL,
  open_in_edge    INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE groups (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  ord          INTEGER NOT NULL,
  collapsed    INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE items (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL,
  group_id                TEXT,
  ord                     INTEGER NOT NULL,
  name                    TEXT NOT NULL,
  icon                    TEXT,
  kind                    TEXT NOT NULL,
  url                     TEXT,
  app_path                TEXT,
  fallback_url            TEXT,
  devices                 TEXT NOT NULL,
  schedule                TEXT,
  reset_time              TEXT NOT NULL,
  notify                  INTEGER NOT NULL,
  badge                   INTEGER NOT NULL,
  edge_mode               TEXT NOT NULL,
  edge_profile            TEXT,
  isolate                 INTEGER NOT NULL,
  persist_session_cookies INTEGER NOT NULL,
  sleep_after_min         INTEGER,
  updated_at              INTEGER NOT NULL,
  deleted                 INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE completions (
  item_id    TEXT NOT NULL,
  period_key TEXT NOT NULL,
  done_at    INTEGER NOT NULL,
  PRIMARY KEY (item_id, period_key)
);

CREATE INDEX completions_period ON completions (period_key);

CREATE TABLE settings (
  id           TEXT PRIMARY KEY CHECK (id = 'settings'),
  timezone     TEXT NOT NULL,
  google_email TEXT,
  updated_at   INTEGER NOT NULL
);
