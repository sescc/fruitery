// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SEED } from '../../../packages/core/index.js';
import { generateSeedSql, main } from '../../../scripts/gen-seed-sql.mjs';
import { fromRow } from '../src/rows.js';
import { createMigratedDb } from '../test-support/d1-sqlite.js';

test('generator output for the example SEED is deterministic', () => {
  assert.equal(generateSeedSql(SEED), generateSeedSql(SEED));
  assert.equal(generateSeedSql(SEED), generateSeedSql(JSON.parse(JSON.stringify(SEED))));
});

test('applied after 0001_init.sql the example SEED yields 2 workspaces, 3 groups, 11 items and UTC settings', async () => {
  const db = await createMigratedDb();
  await db.exec(generateSeedSql(SEED));
  const count = async (/** @type {string} */ t) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first())?.n;
  assert.equal(await count('workspaces'), 2);
  assert.equal(await count('groups'), 3);
  assert.equal(await count('items'), 11);
  assert.equal(await count('completions'), 0);
  const settings = await db.prepare('SELECT * FROM settings').first();
  assert.ok(settings);
  assert.deepEqual(fromRow('settings', settings), { timezone: 'UTC', googleEmail: null, updatedAt: 0 });
  const { results } = await db.prepare('SELECT * FROM items ORDER BY id').all();
  const sorted = [...SEED.items].sort((a, b) => (a.id < b.id ? -1 : 1));
  assert.deepEqual(results.map((r) => fromRow('item', r)), sorted);
});

test('re-applying the seed is harmless and never overwrites edited rows', async () => {
  const db = await createMigratedDb();
  await db.exec(generateSeedSql(SEED));
  await db.prepare("UPDATE workspaces SET name = 'Renamed' WHERE id = 'ws-daily'").run();
  await db.exec(generateSeedSql(SEED));
  assert.equal((await db.prepare("SELECT name FROM workspaces WHERE id = 'ws-daily'").first())?.name, 'Renamed');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM items').first())?.n, 11);
});

test('quotes in names are escaped', async () => {
  const data = JSON.parse(JSON.stringify(SEED));
  data.workspaces[0].name = "Bob's; DROP TABLE items;--";
  const db = await createMigratedDb();
  await db.exec(generateSeedSql(data));
  assert.equal((await db.prepare('SELECT name FROM workspaces WHERE id = ?').bind(data.workspaces[0].id).first())?.name, data.workspaces[0].name);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM items').first())?.n, 11);
});

test('an invalid item stops the generator', () => {
  const data = JSON.parse(JSON.stringify(SEED));
  data.items[0].url = null;
  assert.throws(() => generateSeedSql(data), /invalid seed items/);
});

test('main() reads an explicit input path and writes to --out (independent of any local seed)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fruitery-seed-'));
  try {
    const input = join(dir, 'in.json');
    const out = join(dir, 'nested', 'out.sql');
    writeFileSync(input, JSON.stringify(SEED));
    const r = main([input, '--out', out]);
    assert.equal(r.count, '2 workspaces, 3 groups, 11 items');
    assert.equal(readFileSync(out, 'utf8'), generateSeedSql(SEED));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
