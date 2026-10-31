// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeD1, applyMigrations, createMigratedDb } from '../test-support/d1-sqlite.js';

test('migrations apply and create the expected tables', async () => {
  const db = new FakeD1();
  const files = await applyMigrations(db);
  assert.deepEqual(files, ['0001_init.sql', '0002_item_user_agent.sql', '0003_workspace_ungrouped_label.sql', '0004_item_deep_link.sql']);
  const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  assert.deepEqual(
    results.map((r) => r.name),
    ['completions', 'groups', 'items', 'settings', 'workspaces'],
  );
});

test('migrations apply in filename order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fruitery-mig-'));
  try {
    writeFileSync(join(dir, '0002_b.sql'), 'INSERT INTO t VALUES (2);');
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1);');
    const db = new FakeD1();
    assert.deepEqual(await applyMigrations(db, dir), ['0001_a.sql', '0002_b.sql']);
    const { results } = await db.prepare('SELECT n FROM t ORDER BY rowid').all();
    assert.deepEqual(results, [{ n: 1 }, { n: 2 }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prepare/bind/first/all/run behave like D1', async () => {
  const db = await createMigratedDb();
  const run = await db
    .prepare('INSERT INTO completions (item_id, period_key, done_at) VALUES (?, ?, ?)')
    .bind('a', '2026-10-12', 5)
    .run();
  assert.equal(run.success, true);
  assert.equal(run.meta.changes, 1);
  assert.deepEqual(await db.prepare('SELECT * FROM completions WHERE item_id = ?').bind('a').first(), {
    item_id: 'a',
    period_key: '2026-10-12',
    done_at: 5,
  });
  assert.equal(await db.prepare('SELECT * FROM completions WHERE item_id = ?').bind('zzz').first(), null);
  const all = await db.prepare('SELECT * FROM completions').all();
  assert.equal(all.results.length, 1);
  assert.equal(Object.getPrototypeOf(all.results[0]), Object.prototype);
});

test('batch is atomic: a failing statement rolls back the whole batch', async () => {
  const db = await createMigratedDb();
  const insert = db.prepare('INSERT INTO completions (item_id, period_key, done_at) VALUES (?, ?, ?)');
  await assert.rejects(
    db.batch([insert.bind('a', 'p1', 1), insert.bind('b', 'p1', 2), insert.bind('a', 'p1', 3)]), // duplicate PK
  );
  const count = await db.prepare('SELECT COUNT(*) AS n FROM completions').first();
  assert.equal(count?.n, 0);
  // and a good batch commits
  await db.batch([insert.bind('a', 'p1', 1), insert.bind('b', 'p1', 2)]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM completions').first())?.n, 2);
});
