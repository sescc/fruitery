// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED } from '../../../packages/core/index.js';
import { toRow, fromRow, completionToRow, completionFromRow, upsertSql, rowValues, TABLES } from '../src/rows.js';
import { FakeD1, createMigratedDb } from '../test-support/d1-sqlite.js';

test('every SEED entity round-trips unchanged through toRow -> fromRow', () => {
  for (const w of SEED.workspaces) assert.deepEqual(fromRow('workspace', toRow('workspace', w)), w);
  for (const g of SEED.groups) assert.deepEqual(fromRow('group', toRow('group', g)), g);
  for (const i of SEED.items) assert.deepEqual(fromRow('item', toRow('item', i)), i);
  assert.deepEqual(fromRow('settings', toRow('settings', SEED.settings)), SEED.settings);
});

test('rows use 0/1 booleans, JSON schedule and flattened edge', () => {
  const item = SEED.items.find((i) => i.id === 'it-every-3-days');
  assert.ok(item);
  const row = toRow('item', item);
  assert.equal(row.notify, 0);
  assert.equal(row.persist_session_cookies, 1);
  assert.equal(row.schedule, JSON.stringify({ type: 'everyNDays', n: 3, startDate: '2026-01-01' }));
  assert.equal(row.edge_mode, 'inherit');
  assert.equal(row.edge_profile, null);
  const plain = SEED.items.find((i) => i.id === 'it-tasks');
  assert.ok(plain);
  assert.equal(toRow('item', plain).schedule, null);
});

test('an item with every optional field set round-trips', () => {
  const item = {
    id: 'x', workspaceId: 'w', groupId: 'g', order: 3, name: 'N', icon: 'i', kind: /** @type {const} */ ('app'),
    url: null, appPath: 'C:\\x.exe', fallbackUrl: 'https://example.com/', devices: /** @type {const} */ ('phone'),
    schedule: /** @type {const} */ ({ type: 'weekly', weekday: 3 }), resetTime: '04:00', notify: true, badge: true,
    edge: { mode: /** @type {const} */ ('always'), profile: 'Profile 1' }, isolate: true, persistSessionCookies: false,
    sleepAfterMin: 0, userAgent: { preset: /** @type {const} */ ('custom'), custom: 'MyAgent/1.0 (test)' },
    deepLink: 'intent://open/#Intent;scheme=myapp;package=com.example.app;end', updatedAt: 99, deleted: true,
  };
  assert.deepEqual(fromRow('item', toRow('item', item)), item);
});

test('deepLink: stored as text and decoded back; NULL (or absent) decodes to null', () => {
  const base = JSON.parse(JSON.stringify(SEED.items[0]));
  assert.equal(toRow('item', { ...base, deepLink: 'myapp://open' }).deep_link, 'myapp://open');
  assert.equal(toRow('item', { ...base, deepLink: null }).deep_link, null);
  // a row whose deep_link column is NULL or missing decodes to null
  assert.equal(fromRow('item', { ...toRow('item', base), deep_link: null }).deepLink, null);
  const row = toRow('item', base);
  delete row.deep_link;
  assert.equal(fromRow('item', row).deepLink, null);
});

test('completions round-trip', () => {
  const c = { itemId: 'a', periodKey: '2026-10-12', doneAt: 123 };
  assert.deepEqual(completionFromRow(completionToRow(c)), c);
});

test('the upsert statement inserts, then overwrites by id, through the D1 adapter', async () => {
  const db = await createMigratedDb();
  const ws = { ...SEED.workspaces[0], name: 'A', updatedAt: 1 };
  const write = (/** @type {typeof ws} */ w) => db.prepare(upsertSql('workspace')).bind(...rowValues('workspace', toRow('workspace', w))).run();
  await write(ws);
  await write({ ...ws, name: 'B', updatedAt: 2 });
  const { results } = await db.prepare('SELECT * FROM workspaces').all();
  assert.equal(results.length, 1);
  assert.equal(fromRow('workspace', results[0]).name, 'B');
  assert.equal(TABLES.settings.columns[0], 'id');
});

test('userAgent: stored as JSON and decoded back; with or without the field', () => {
  const base = JSON.parse(JSON.stringify(SEED.items[0]));
  // with the field
  for (const userAgent of [{ preset: 'default', custom: null }, { preset: 'chrome', custom: null }, { preset: 'custom', custom: 'A/1 "quoted"' }]) {
    const row = toRow('item', { ...base, userAgent });
    assert.equal(row.user_agent, JSON.stringify(userAgent));
    assert.deepEqual(fromRow('item', row).userAgent, userAgent);
  }
  // without the field (undefined or null): NULL in the row, the default preset back
  for (const userAgent of [undefined, null]) {
    const row = toRow('item', { ...base, userAgent });
    assert.equal(row.user_agent, null);
    assert.deepEqual(fromRow('item', row).userAgent, { preset: 'default', custom: null });
  }
});

test('a row with NULL user_agent, a missing column value or unreadable JSON decodes to the default preset', () => {
  const row = toRow('item', SEED.items[0]);
  for (const user_agent of [null, undefined, '{not json', 'null', '5']) {
    assert.deepEqual(fromRow('item', { ...row, user_agent }).userAgent, { preset: 'default', custom: null }, String(user_agent));
  }
  // a readable but invalid value is kept as stored so validation can reject it
  assert.deepEqual(fromRow('item', { ...row, user_agent: '{"preset":"safari","custom":null}' }).userAgent, { preset: 'safari', custom: null });
});

test('the user_agent column exists after migrations 0001 + 0002 and existing rows read as NULL', async () => {
  const db = new FakeD1();
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../migrations/', import.meta.url);
  await db.exec(readFileSync(new URL('0001_init.sql', dir), 'utf8'));
  // a row written under the 0001 schema (no user_agent column yet)
  await db.exec("INSERT INTO items (id, workspace_id, group_id, ord, name, icon, kind, url, app_path, fallback_url, devices, schedule, reset_time, notify, badge, edge_mode, edge_profile, isolate, persist_session_cookies, sleep_after_min, updated_at, deleted) VALUES ('old', 'w', NULL, 0, 'Old', NULL, 'web', 'https://example.com/', NULL, NULL, 'all', NULL, '00:00', 0, 0, 'inherit', NULL, 0, 1, NULL, 1, 0)");
  await db.exec(readFileSync(new URL('0002_item_user_agent.sql', dir), 'utf8'));
  const row = await db.prepare('SELECT * FROM items WHERE id = ?').bind('old').first();
  assert.ok(row);
  assert.equal(row.user_agent, null);
  assert.deepEqual(fromRow('item', row).userAgent, { preset: 'default', custom: null });
});

test('ungroupedLabel: stored as text, NULL (or absent) decodes to null; the 0003 column exists on migrated databases', async () => {
  const base = JSON.parse(JSON.stringify(SEED.workspaces[0]));
  assert.equal(toRow('workspace', { ...base, ungroupedLabel: 'Misc' }).ungrouped_label, 'Misc');
  assert.equal(fromRow('workspace', toRow('workspace', { ...base, ungroupedLabel: 'Misc' })).ungroupedLabel, 'Misc');
  for (const ungroupedLabel of [undefined, null]) {
    const row = toRow('workspace', { ...base, ungroupedLabel });
    assert.equal(row.ungrouped_label, null);
    assert.equal(fromRow('workspace', row).ungroupedLabel, null);
  }
  assert.equal(fromRow('workspace', { ...toRow('workspace', base), ungrouped_label: undefined }).ungroupedLabel, null);
  const db = await createMigratedDb();
  const { results } = await db.prepare("SELECT name FROM pragma_table_info('workspaces')").all();
  assert.ok(results.some((r) => r.name === 'ungrouped_label'));
});

test('deep_link: an item row written before migration 0004 reads as NULL and decodes to null', async () => {
  const db = new FakeD1();
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of ['0001_init.sql', '0002_item_user_agent.sql', '0003_workspace_ungrouped_label.sql']) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  // a row written before deep_link existed
  await db.exec("INSERT INTO items (id, workspace_id, group_id, ord, name, icon, kind, url, app_path, fallback_url, devices, schedule, reset_time, notify, badge, edge_mode, edge_profile, isolate, persist_session_cookies, sleep_after_min, user_agent, updated_at, deleted) VALUES ('old', 'w', NULL, 0, 'Old', NULL, 'web', 'https://example.com/', NULL, NULL, 'all', NULL, '00:00', 0, 0, 'inherit', NULL, 0, 1, NULL, NULL, 1, 0)");
  await db.exec(readFileSync(new URL('0004_item_deep_link.sql', dir), 'utf8'));
  const row = await db.prepare('SELECT * FROM items WHERE id = ?').bind('old').first();
  assert.ok(row);
  assert.equal(row.deep_link, null);
  assert.equal(fromRow('item', row).deepLink, null);
  // the column exists on a fully migrated database
  const migrated = await createMigratedDb();
  const { results } = await migrated.prepare("SELECT name FROM pragma_table_info('items')").all();
  assert.ok(results.some((r) => r.name === 'deep_link'));
});