// @ts-check
// The desktop sync engine against the real Worker handler (apps/web/src/api.js) and a node:sqlite D1
// stand-in with the real migrations. Only the network is replaced: `requestApi` builds a Request and
// calls `handle` directly, then sorts the answer with the same `classifyResponse` as production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SEED } from '../../../packages/core/index.js';
import { utc } from '../../../packages/core/fixtures.js';
import { generateSeedSql } from '../../../scripts/gen-seed-sql.mjs';
import { handle } from '../../web/src/api.js';
import { createMigratedDb } from '../../web/test-support/d1-sqlite.js';
import { classifyResponse } from '../lib/sync-config.js';
import { openStore } from '../main/store.js';
import { createSync } from '../main/sync.js';

console.log = () => {}; // the Worker logs auth denials; keep the output quiet

const BASE = 'http://localhost:8787'; // a local host, so DEV_NO_AUTH applies
const T0 = utc('2026-10-20T12:00');

async function setup() {
  const db = await createMigratedDb();
  await db.exec(generateSeedSql(SEED));
  const env = { t: T0, skew: 0, offline: false };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fruitery-syncint-'));
  const store = openStore(dir, { seedText: null, now: () => env.t + env.skew });
  /** @type {string[]} */
  const log = [];
  const requestApi = async (/** @type {any} */ _key, /** @type {string} */ method, /** @type {string} */ p, /** @type {any} */ body) => {
    log.push(`${method} ${p}`);
    if (env.offline) return { ok: false, kind: 'offline' };
    const init = /** @type {RequestInit} */ ({ method, headers: {} });
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      /** @type {Record<string, string>} */ (init.headers)['content-type'] = 'application/json';
    }
    const res = await handle(new Request(`${BASE}${p}`, init), { DB: db, DEV_NO_AUTH: '1' }, { now: env.t });
    const text = await res.text();
    return classifyResponse(res.status, text ? JSON.parse(text) : null);
  };
  store.updateDevice({ sync: { baseUrl: BASE, clientId: 'client-id.access', expiresOn: null } });
  store.setFirstSyncDoneFor(BASE);
  const timers = { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} };
  const sync = createSync({ store, secrets: { loadSecret: () => 'test-secret' }, requestApi: /** @type {any} */ (requestApi), now: () => env.t + env.skew, timers });
  const row = (/** @type {string} */ sql, /** @type {unknown[]} */ ...args) => db.prepare(sql).bind(...args).first();
  const rows = async (/** @type {string} */ sql, /** @type {unknown[]} */ ...args) => (await db.prepare(sql).bind(...args).all()).results;
  return { db, env, dir, store, sync, log, row, rows };
}

test('a desktop edit lands in D1 and is confirmed', async () => {
  const t = await setup();
  t.env.t += 1000;
  assert.ok('ok' in t.store.upsert({ items: [{ id: 'it-mail', name: 'Mail renamed on the PC' }] }));
  const created = /** @type {any} */ (t.store.upsert({ items: [{ workspaceId: 'ws-productivity', name: 'Brand new', url: 'https://new.example.com' }], settings: { timezone: 'Asia/Tokyo' } }));
  await t.sync.trigger();
  assert.deepEqual(t.log, ['PUT /api/entities', 'GET /api/state']);
  assert.equal((await t.row('SELECT name FROM items WHERE id = ?', 'it-mail'))?.name, 'Mail renamed on the PC');
  assert.equal((await t.row('SELECT name FROM items WHERE id = ?', created.ids.items[0]))?.name, 'Brand new');
  assert.equal((await t.row('SELECT timezone FROM settings WHERE id = ?', 'settings'))?.timezone, 'Asia/Tokyo');
  assert.deepEqual(t.store.outbox(), []);
  assert.equal(t.sync.liveStatus().status, 'synced');
});

test('a change written directly to D1 appears after a pull, including a deletion', async () => {
  const t = await setup();
  const later = T0 + 60_000;
  await t.db.prepare('UPDATE items SET name = ?, updated_at = ? WHERE id = ?').bind('Renamed on the phone', later, 'it-notes').run();
  await t.db.prepare('UPDATE items SET deleted = 1, updated_at = ? WHERE id = ?').bind(later, 'it-tasks').run();
  await t.sync.trigger();
  const snap = t.store.snapshot();
  assert.equal(snap.items.find((i) => i.id === 'it-notes')?.name, 'Renamed on the phone');
  assert.equal(snap.items.find((i) => i.id === 'it-tasks')?.deleted, true);
});

test('a tick makes the round trip: the server stores it with its own clock, and untick removes it', async () => {
  const t = await setup();
  const res = await t.sync.tick('it-language');
  assert.ok('ok' in res && res.created);
  const stored = await t.rows('SELECT item_id, period_key, done_at FROM completions');
  assert.deepEqual(stored.map((r) => ({ ...r })), [{ item_id: 'it-language', period_key: '2026-10-20', done_at: T0 }]);
  assert.deepEqual(t.store.snapshot().completions, [{ itemId: 'it-language', periodKey: '2026-10-20', doneAt: T0 }]);

  // another device's tick shows up after a pull
  await t.db.prepare('INSERT INTO completions (item_id, period_key, done_at) VALUES (?, ?, ?)').bind('it-coding', '2026-10-20', T0 + 5).run();
  await t.sync.trigger();
  assert.equal(t.store.snapshot().completions.length, 2);

  const un = await t.sync.untick('it-language');
  assert.ok('ok' in un && un.removed === 1);
  assert.deepEqual((await t.rows('SELECT item_id FROM completions')).map((r) => r.item_id), ['it-coding']);
  assert.equal(t.store.snapshot().completions.some((c) => c.itemId === 'it-language'), false);
});

test('the server\'s 422 marks the entry and the pull still happens; the other entries get through', async () => {
  const t = await setup();
  t.env.t += 1000;
  const goodId = /** @type {any} */ (t.store.upsert({ items: [{ workspaceId: 'ws-productivity', name: 'Fine', url: 'https://ok.example.com' }] })).ids.items[0];
  // an entry the local checks would refuse but a damaged queue could hold: a blank name
  const bad = { ...t.store.snapshot().items.find((i) => i.id === 'it-mail'), name: '   ', updatedAt: t.env.t };
  t.store.setOutbox([...t.store.outbox(), { kind: 'items', entity: bad }]);
  await t.sync.trigger();
  const live = t.sync.liveStatus();
  assert.equal(live.rejected.length, 1);
  assert.equal(live.rejected[0].id, 'it-mail');
  assert.ok(live.rejected[0].errors.some((e) => e.field === 'name'));
  assert.equal((await t.row('SELECT name FROM items WHERE id = ?', goodId))?.name, 'Fine', 'the valid entry was stored after the bad one was set aside');
  assert.equal((await t.row('SELECT name FROM items WHERE id = ?', 'it-mail'))?.name, SEED.items.find((i) => i.id === 'it-mail')?.name, 'the invalid one was not stored');
  assert.equal(t.log.at(-1), 'GET /api/state');
});

test('first connect against the real Worker: newer local edits win, older ones lose, seed rows stay quiet', async () => {
  const t = await setup();
  t.store.setFirstSyncDoneFor(null);
  // before connecting: a local edit newer than the server's row, and one older than a server edit
  await t.db.prepare('UPDATE items SET name = ?, updated_at = ? WHERE id = ?').bind('Server edit', T0 + 9000, 'it-notes').run();
  const snapItems = t.store.snapshot().items;
  const idx = (/** @type {string} */ id) => snapItems.findIndex((i) => i.id === id);
  snapItems[idx('it-mail')] = { ...snapItems[idx('it-mail')], name: 'Local edit, newer', updatedAt: T0 + 5000 };
  snapItems[idx('it-notes')] = { ...snapItems[idx('it-notes')], name: 'Local edit, older', updatedAt: T0 + 1000 };
  t.store.snapshot().completions.push({ itemId: 'it-language', periodKey: '2026-10-20', doneAt: T0 });

  await t.sync.trigger();
  assert.deepEqual(t.log, ['GET /api/state', 'PUT /api/entities', 'POST /api/ticks', 'GET /api/state']);
  assert.equal((await t.row('SELECT name FROM items WHERE id = ?', 'it-mail'))?.name, 'Local edit, newer');
  assert.equal((await t.row('SELECT name FROM items WHERE id = ?', 'it-notes'))?.name, 'Server edit');
  assert.equal(t.store.snapshot().items.find((i) => i.id === 'it-notes')?.name, 'Server edit');
  assert.equal((await t.rows('SELECT * FROM completions')).length, 1);
  assert.equal(t.store.firstSyncDoneFor(), BASE);
  assert.equal(fs.readdirSync(t.dir).filter((f) => f.startsWith('cache.pre-sync-')).length, 1);
});

// ---------------------------------------------------------------------------------------------
// ticks without a connection (offline-ticks)

test('a tick made offline yesterday evening and sent today is stored for yesterday, with its own time', async () => {
  const t = await setup();
  t.env.t = utc('2026-10-19T22:30');
  await t.sync.trigger(); // learns the Worker's abilities and clock
  t.env.offline = true;
  const res = /** @type {any} */ (await t.sync.tick('it-language'));
  assert.deepEqual([res.ok, res.pending], [true, true]);
  assert.equal(t.sync.liveStatus().status, 'offline');
  assert.deepEqual(await t.rows('SELECT * FROM completions'), [], 'nothing reached the server');
  t.env.t = utc('2026-10-20T08:00');
  t.env.offline = false;
  await t.sync.trigger();
  assert.deepEqual((await t.rows('SELECT item_id, period_key, done_at FROM completions')).map((r) => ({ ...r })), [{ item_id: 'it-language', period_key: '2026-10-19', done_at: utc('2026-10-19T22:30') }]);
  assert.deepEqual(t.store.snapshot().completions, [{ itemId: 'it-language', periodKey: '2026-10-19', doneAt: utc('2026-10-19T22:30') }]);
  assert.deepEqual(t.store.tickOutbox(), []);
  assert.equal(t.sync.liveStatus().status, 'synced');
});

test('an untick made offline for yesterday is sent as periodKey and removes yesterday\'s tick only', async () => {
  const t = await setup();
  await t.db.prepare('INSERT INTO completions (item_id, period_key, done_at) VALUES (?, ?, ?), (?, ?, ?)').bind('it-language', '2026-10-19', utc('2026-10-19T09:00'), 'it-language', '2026-10-18', utc('2026-10-18T09:00')).run();
  t.env.t = utc('2026-10-19T21:00');
  await t.sync.trigger();
  t.env.offline = true;
  const un = /** @type {any} */ (await t.sync.untick('it-language'));
  assert.deepEqual([un.ok, un.removed], [true, 1]);
  assert.equal(t.store.tickOutbox().length, 1);
  t.env.t = utc('2026-10-20T07:00');
  t.env.offline = false;
  await t.sync.trigger();
  assert.deepEqual((await t.rows('SELECT period_key FROM completions')).map((r) => r.period_key), ['2026-10-18']);
});

test('a tick that waited more than 48 hours is refused by the server, dropped, and reported as a notice', async () => {
  const t = await setup();
  t.env.t = utc('2026-10-15T12:00');
  await t.sync.trigger();
  t.env.offline = true;
  await t.sync.tick('it-language');
  t.env.t = utc('2026-10-18T12:00'); // 72 hours later
  t.env.offline = false;
  await t.sync.trigger();
  assert.deepEqual(await t.rows('SELECT * FROM completions'), []);
  assert.deepEqual(t.store.tickOutbox(), []);
  const dropped = t.sync.liveStatus().droppedTicks;
  assert.deepEqual(dropped.map((n) => [n.itemId, n.periodKey, n.reason]), [['it-language', '2026-10-15', 'tick-too-old']]);
  assert.equal(t.store.snapshot().completions.length, 0, 'and the pull does not bring it back');
  assert.equal(t.sync.liveStatus().status, 'synced');
});

test('a PC whose clock is 20 minutes ahead still gets its offline tick accepted (the server offset corrects the time)', async () => {
  const t = await setup();
  t.env.skew = 20 * 60000;
  t.env.t = utc('2026-10-20T10:00');
  await t.sync.trigger(); // the pull learns serverNow - localNow
  assert.equal(t.store.serverClockOffset(), -20 * 60000);
  t.env.offline = true;
  await t.sync.tick('it-language');
  assert.equal(/** @type {any} */ (t.store.tickOutbox()[0]).doneAt, utc('2026-10-20T10:00'), 'stamped with the server\'s clock');
  t.env.offline = false;
  await t.sync.trigger();
  assert.deepEqual(t.sync.liveStatus().droppedTicks, [], 'not "from the future"');
  assert.equal((await t.rows('SELECT * FROM completions')).length, 1);
});

test('a tick and an untick of the same period made offline cancel out: the server is never asked', async () => {
  const t = await setup();
  await t.sync.trigger();
  t.env.offline = true;
  await t.sync.tick('it-language');
  await t.sync.untick('it-language');
  assert.deepEqual(t.store.tickOutbox(), []);
  t.env.offline = false;
  t.log.length = 0;
  await t.sync.trigger();
  assert.equal(t.log.some((l) => l.startsWith('POST') || l.startsWith('DELETE')), false);
  assert.deepEqual(await t.rows('SELECT * FROM completions'), []);
});