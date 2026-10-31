// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED } from '../../../packages/core/index.js';
import { generateSeedSql } from '../../../scripts/gen-seed-sql.mjs';
import { FEATURES, StoreError, TICK_FUTURE_MS, TICK_PAST_MS, getState, history, tick, untick, upsertEntities } from '../src/store.js';
import { createMigratedDb } from '../test-support/d1-sqlite.js';

const NOW = Date.parse('2026-10-12T00:00:00Z'); // 2026-10-12 09:00 in Tokyo
const DAY = 86400000;

/** @returns {Promise<import('../test-support/d1-sqlite.js').FakeD1>} a database seeded with the example dataset */
async function seeded() {
  const db = await createMigratedDb();
  await db.exec(generateSeedSql(SEED));
  return db;
}

/** @param {any} db */
async function seededTokyo(db) {
  await upsertEntities(db, { settings: { timezone: 'Asia/Tokyo', googleEmail: null, updatedAt: 1 } });
  return db;
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} [over]
 */
function itemOf(id, over = {}) {
  const base = SEED.items.find((i) => i.id === id);
  assert.ok(base);
  return { ...JSON.parse(JSON.stringify(base)), ...over };
}

/** @param {any} db */
async function completionCount(db) {
  return (await db.prepare('SELECT COUNT(*) AS n FROM completions').first()).n;
}

/**
 * @param {Promise<unknown>} p
 * @param {number} status
 * @returns {Promise<StoreError>}
 */
async function rejectsWith(p, status) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof StoreError, `expected StoreError, got ${e}`);
    assert.equal(e.status, status);
    return e;
  }
  assert.fail('expected a rejection');
}

// ----- state -----

test('Fresh deployment: the seeded database yields 2 workspaces, 3 groups, 11 items, UTC settings and no ticks', async () => {
  const db = await seeded();
  const s = await getState(db, NOW);
  assert.equal(s.workspaces.length, 2);
  assert.equal(s.groups.length, 3);
  assert.equal(s.items.length, 11);
  assert.deepEqual(s.settings, { timezone: 'UTC', googleEmail: null, updatedAt: 0 });
  assert.deepEqual(s.completions, []);
  assert.equal(s.serverNow, NOW);
});

test('An unseeded database still answers with default settings', async () => {
  const db = await createMigratedDb();
  const s = await getState(db, NOW);
  assert.deepEqual(s.settings, { timezone: 'UTC', googleEmail: null, updatedAt: 0 });
  assert.equal(s.items.length, 0);
});

test('Since filter: only ticks from the since date on are returned', async () => {
  const db = await seeded();
  const ins = db.prepare('INSERT INTO completions (item_id, period_key, done_at) VALUES (?, ?, ?)');
  await db.batch([ins.bind('it-word-game', '2026-08-01', 1), ins.bind('it-word-game', '2026-10-11', 2)]);
  const s = await getState(db, NOW, { since: '2026-10-01' });
  assert.deepEqual(s.completions, [{ itemId: 'it-word-game', periodKey: '2026-10-11', doneAt: 2 }]);
  await rejectsWith(getState(db, NOW, { since: 'yesterday' }), 400);
});

test('Default since is 62 days back, widened to the longest every-N-days schedule', async () => {
  const db = await seeded();
  const ins = db.prepare('INSERT INTO completions (item_id, period_key, done_at) VALUES (?, ?, ?)');
  await db.batch([ins.bind('it-word-game', '2026-08-10', 1), ins.bind('it-word-game', '2026-08-12', 2), ins.bind('it-word-game', '2026-06-01', 3)]);
  // today 2026-10-12: 62 days back is 2026-08-11
  assert.deepEqual((await getState(db, NOW)).completions.map((c) => c.periodKey), ['2026-08-12']);
  await upsertEntities(db, { items: [itemOf('it-every-3-days', { schedule: { type: 'everyNDays', n: 130, startDate: '2026-01-01' }, updatedAt: 5 })] });
  // 130 days back is 2026-06-04: still excludes 06-01
  assert.deepEqual((await getState(db, NOW)).completions.map((c) => c.periodKey), ['2026-08-10', '2026-08-12']);
});

test('The since-window stays bounded: an out-of-range every-N-days.n cannot be stored, so the scan never grows without limit', async () => {
  const db = await seeded();
  // n beyond the core cap (MAX_EVERY_N_DAYS = 3660) is rejected, so no stored schedule can widen the window past ~10 years
  await rejectsWith(upsertEntities(db, { items: [itemOf('it-every-3-days', { schedule: { type: 'everyNDays', n: 3661, startDate: '2026-01-01' }, updatedAt: 5 })] }), 422);
  // the largest valid n (3660) is accepted and getState still returns a well-formed snapshot
  await upsertEntities(db, { items: [itemOf('it-every-3-days', { schedule: { type: 'everyNDays', n: 3660, startDate: '2026-01-01' }, updatedAt: 6 })] });
  const s = await getState(db, NOW);
  assert.equal(s.items.length, 11);
});

test('The default since uses the configured timezone to decide today', async () => {
  const db = await seededTokyo(await seeded());
  const ins = db.prepare('INSERT INTO completions (item_id, period_key, done_at) VALUES (?, ?, ?)');
  await ins.bind('it-word-game', '2026-08-11', 1).run();
  // 2026-10-11T20:00Z is already 2026-10-12 in Tokyo, so since = 2026-08-11 and the tick is kept
  assert.equal((await getState(db, Date.parse('2026-10-11T20:00:00Z'))).completions.length, 1);
  // a day later in Tokyo the window moves on
  assert.equal((await getState(db, Date.parse('2026-10-12T20:00:00Z'))).completions.length, 0);
});

// ----- upsert -----

test('Newer edit stored and returned', async () => {
  const db = await seeded();
  const edited = itemOf('it-tasks', { name: 'Tasks (renamed)', updatedAt: 100 });
  const res = await upsertEntities(db, { items: [edited] });
  assert.equal(res.items[0].name, 'Tasks (renamed)');
  const stored = (await getState(db, NOW)).items.find((i) => i.id === 'it-tasks');
  assert.equal(stored.name, 'Tasks (renamed)');
  assert.equal(stored.updatedAt, 100);
});

test('Older edit ignored: the stored version is unchanged and returned', async () => {
  const db = await seeded();
  await upsertEntities(db, { items: [itemOf('it-tasks', { name: 'Newest', updatedAt: 100 })] });
  const res = await upsertEntities(db, { items: [itemOf('it-tasks', { name: 'Stale', updatedAt: 50 })] });
  assert.equal(res.items[0].name, 'Newest');
  assert.equal((await getState(db, NOW)).items.find((i) => i.id === 'it-tasks').name, 'Newest');
});

test('Invalid item rejected with 422 listing the item and its error; nothing in the request is stored', async () => {
  const db = await seeded();
  const err = await rejectsWith(
    upsertEntities(db, {
      workspaces: [{ ...SEED.workspaces[0], name: 'Renamed', updatedAt: 100 }],
      items: [itemOf('it-tasks', { name: 'Fine', updatedAt: 100 }), itemOf('it-notes', { url: null, updatedAt: 100 })],
    }),
    422,
  );
  assert.equal(err.code, 'invalid');
  assert.deepEqual(err.details, [{ id: 'it-notes', errors: [{ field: 'url', code: 'required' }] }]);
  const s = await getState(db, NOW);
  assert.equal(s.workspaces.find((w) => w.id === 'ws-productivity').name, 'Productivity');
  assert.equal(s.items.find((i) => i.id === 'it-tasks').name, 'Tasks');
});

test('A new item in a new group is valid when the group arrives in the same request', async () => {
  const db = await seeded();
  const group = { id: 'g-new', workspaceId: 'ws-daily', name: 'New', order: 3, collapsed: false, updatedAt: 10, deleted: false };
  const item = itemOf('it-word-game', { id: 'it-new', groupId: 'g-new', name: 'Brand new', updatedAt: 10 });
  await upsertEntities(db, { groups: [group], items: [item] });
  assert.equal((await getState(db, NOW)).items.length, 12);
  // and a group in another workspace, or an unknown group, is rejected
  const wrongWs = await rejectsWith(upsertEntities(db, { items: [itemOf('it-word-game', { groupId: 'g-new', workspaceId: 'ws-productivity', updatedAt: 20 })] }), 422);
  assert.deepEqual(wrongWs.details?.[0].errors, [{ field: 'groupId', code: 'group-workspace-mismatch' }]);
  const unknown = await rejectsWith(upsertEntities(db, { items: [itemOf('it-word-game', { groupId: 'g-nope', updatedAt: 20 })] }), 422);
  assert.deepEqual(unknown.details?.[0].errors, [{ field: 'groupId', code: 'group-not-found' }]);
});

test('Deletion markers are stored and returned in the snapshot; a tombstone is always accepted', async () => {
  const db = await seeded();
  await upsertEntities(db, { items: [itemOf('it-notes', { deleted: true, url: null, updatedAt: 100 })] });
  const keep = (await getState(db, NOW)).items.find((i) => i.id === 'it-notes');
  assert.equal(keep.deleted, true);
});

test('Settings: newer wins, timezone is validated, an older edit is ignored', async () => {
  const db = await seeded();
  const ok = await upsertEntities(db, { settings: { timezone: 'Asia/Tokyo', googleEmail: 'user@example.com', updatedAt: 10 } });
  assert.deepEqual(ok.settings, { timezone: 'Asia/Tokyo', googleEmail: 'user@example.com', updatedAt: 10 });
  const old = await upsertEntities(db, { settings: { timezone: 'UTC', googleEmail: null, updatedAt: 5 } });
  assert.equal(old.settings?.timezone, 'Asia/Tokyo');
  const bad = await rejectsWith(upsertEntities(db, { settings: { timezone: 'Mars/Olympus', googleEmail: null, updatedAt: 20 } }), 422);
  assert.deepEqual(bad.details, [{ id: 'settings', errors: [{ field: 'timezone', code: 'invalid-timezone' }] }]);
  assert.equal((await getState(db, NOW)).settings.timezone, 'Asia/Tokyo');
});

test('Settings can be created on a database that has none', async () => {
  const db = await createMigratedDb();
  await upsertEntities(db, { settings: { timezone: 'Asia/Tokyo', googleEmail: null, updatedAt: 1 } });
  assert.equal((await getState(db, NOW)).settings.timezone, 'Asia/Tokyo');
});

test('Bad shapes are rejected with 400 and nothing is stored', async () => {
  const db = await seeded();
  for (const body of [null, [], 'x', 5, { items: 'nope' }, { items: [null] }, { items: [{ id: 'x' }] }, { workspaces: [{ ...SEED.workspaces[0], updatedAt: 'later' }] }, { settings: { timezone: 5, updatedAt: 1 } }]) {
    await rejectsWith(upsertEntities(db, body), 400);
  }
  const bad = await rejectsWith(upsertEntities(db, { items: [{ ...itemOf('it-notes'), updatedAt: Number.NaN }] }), 400);
  assert.equal(bad.details?.[0].id, 'it-notes');
  assert.equal((await getState(db, NOW)).items.length, 11);
});

test('A mixed request writes workspaces, groups, items and settings together; unknown fields are dropped', async () => {
  const db = await seeded();
  const res = await upsertEntities(db, {
    workspaces: [{ ...SEED.workspaces[1], name: 'Daily!', updatedAt: 9, extra: 'x' }],
    groups: [{ ...SEED.groups[0], name: 'Learn', updatedAt: 9 }],
    items: [itemOf('it-mail', { name: 'Mail', updatedAt: 9 })],
    settings: { timezone: 'Asia/Tokyo', googleEmail: null, updatedAt: 9 },
  });
  assert.equal(res.workspaces[0].name, 'Daily!');
  assert.equal('extra' in res.workspaces[0], false);
  assert.equal(res.groups[0].name, 'Learn');
  assert.equal(res.items[0].name, 'Mail');
  assert.equal(res.settings?.timezone, 'Asia/Tokyo');
});

test('More than one statement-parameter chunk of ids is handled', async () => {
  const db = await seeded();
  const items = Array.from({ length: 200 }, (_, i) => itemOf('it-word-game', { id: `bulk-${i}`, name: `B${i}`, updatedAt: 3 }));
  const res = await upsertEntities(db, { items });
  assert.equal(res.items.length, 200);
  assert.equal((await getState(db, NOW)).items.length, 211);
  // second identical call is a no-op that still returns the stored versions
  assert.equal((await upsertEntities(db, { items })).items.length, 200);
});

test('userAgent: stored and returned; an item without it comes back with the default; bad presets are 422', async () => {
  const db = await seeded();
  const custom = await upsertEntities(db, { items: [itemOf('it-notes', { userAgent: { preset: 'custom', custom: 'MyAgent/2.0' }, updatedAt: 50 })] });
  assert.deepEqual(custom.items[0].userAgent, { preset: 'custom', custom: 'MyAgent/2.0' });
  assert.deepEqual((await getState(db, NOW)).items.find((i) => i.id === 'it-notes').userAgent, { preset: 'custom', custom: 'MyAgent/2.0' });
  // a client that does not send the field at all (an older client)
  const { userAgent: _drop, ...without } = itemOf('it-notes', { updatedAt: 60 });
  const plain = await upsertEntities(db, { items: [without] });
  assert.deepEqual(plain.items[0].userAgent, { preset: 'default', custom: null });
  // invalid presets: 422 with the userAgent field errors, nothing stored
  const bad = await rejectsWith(upsertEntities(db, { items: [itemOf('it-notes', { userAgent: { preset: 'safari', custom: null }, updatedAt: 70 })] }), 422);
  assert.deepEqual(bad.details, [{ id: 'it-notes', errors: [{ field: 'userAgent.preset', code: 'invalid-value' }] }]);
  const empty = await rejectsWith(upsertEntities(db, { items: [itemOf('it-notes', { userAgent: { preset: 'custom', custom: '' }, updatedAt: 70 })] }), 422);
  assert.deepEqual(empty.details, [{ id: 'it-notes', errors: [{ field: 'userAgent.custom', code: 'required' }] }]);
  const long = await rejectsWith(upsertEntities(db, { items: [itemOf('it-notes', { userAgent: { preset: 'custom', custom: 'x'.repeat(513) }, updatedAt: 70 })] }), 422);
  assert.deepEqual(long.details, [{ id: 'it-notes', errors: [{ field: 'userAgent.custom', code: 'out-of-range' }] }]);
  // a non-object userAgent is a shape error
  await rejectsWith(upsertEntities(db, { items: [itemOf('it-notes', { userAgent: 'chrome', updatedAt: 70 })] }), 400);
  assert.equal((await getState(db, NOW)).items.find((i) => i.id === 'it-notes').userAgent.preset, 'default');
});

test('deepLink: a safe app link is stored and returned; an unsafe one is 422; a client without it stores NULL', async () => {
  const db = await seeded();
  const dl = 'intent://open/#Intent;scheme=myapp;package=com.example.app;end';
  const saved = await upsertEntities(db, { items: [itemOf('it-notes', { deepLink: dl, updatedAt: 50 })] });
  assert.equal(saved.items[0].deepLink, dl);
  assert.equal((await getState(db, NOW)).items.find((i) => i.id === 'it-notes').deepLink, dl);
  // an older client that does not send the field at all: stored as NULL, returned as null
  const { deepLink: _drop, ...without } = itemOf('it-notes', { updatedAt: 60 });
  assert.equal((await upsertEntities(db, { items: [without] })).items[0].deepLink, null);
  // an unsafe deep link: 422 with the deepLink field error, nothing stored
  const bad = await rejectsWith(upsertEntities(db, { items: [itemOf('it-notes', { deepLink: 'javascript:alert(1)', updatedAt: 70 })] }), 422);
  assert.deepEqual(bad.details, [{ id: 'it-notes', errors: [{ field: 'deepLink', code: 'invalid-deep-link' }] }]);
  // a non-string deepLink is a shape error (400)
  await rejectsWith(upsertEntities(db, { items: [itemOf('it-notes', { deepLink: 42, updatedAt: 70 })] }), 400);
  assert.equal((await getState(db, NOW)).items.find((i) => i.id === 'it-notes').deepLink, null);
});
test('workspace ungroupedLabel: stored and returned; blank, over-long and blank-name workspaces are 422; a tombstone is always accepted', async () => {
  const db = await seeded();
  const ws = { ...JSON.parse(JSON.stringify(SEED.workspaces[1])), updatedAt: 50 };
  const ok = await upsertEntities(db, { workspaces: [{ ...ws, ungroupedLabel: 'Misc' }] });
  assert.equal(ok.workspaces[0].ungroupedLabel, 'Misc');
  assert.equal((await getState(db, NOW)).workspaces.find((w) => w.id === ws.id).ungroupedLabel, 'Misc');
  // an old client that does not send the field: stored as NULL, returned as null
  const { ungroupedLabel: _drop, ...without } = { ...ws, updatedAt: 60 };
  assert.equal((await upsertEntities(db, { workspaces: [without] })).workspaces[0].ungroupedLabel, null);
  for (const [bad, expected] of /** @type {[any, any][]} */ ([
    [{ ungroupedLabel: '   ' }, [{ field: 'ungroupedLabel', code: 'required' }]],
    [{ ungroupedLabel: 'x'.repeat(41) }, [{ field: 'ungroupedLabel', code: 'out-of-range' }]],
    [{ name: '  ' }, [{ field: 'name', code: 'required' }]],
  ])) {
    const err = await rejectsWith(upsertEntities(db, { workspaces: [{ ...ws, updatedAt: 70, ...bad }] }), 422);
    assert.deepEqual(err.details, [{ id: ws.id, errors: expected }]);
  }
  await rejectsWith(upsertEntities(db, { workspaces: [{ ...ws, updatedAt: 70, ungroupedLabel: 5 }] }), 400);
  // nothing from the rejected requests was stored
  assert.equal((await getState(db, NOW)).workspaces.find((w) => w.id === ws.id).name, ws.name);
  // a tombstone with a broken label is still accepted
  await upsertEntities(db, { workspaces: [{ ...ws, updatedAt: 80, deleted: true, ungroupedLabel: '  ' }] });
  assert.equal((await getState(db, NOW)).workspaces.find((w) => w.id === ws.id).deleted, true);
});

// ----- ticks -----

test('Tick a due item at 2026-10-12 09:00 Tokyo files period 2026-10-12', async () => {
  const db = await seededTokyo(await seeded());
  const c = await tick(db, 'it-word-game', NOW);
  assert.deepEqual(c, { itemId: 'it-word-game', periodKey: '2026-10-12', doneAt: NOW });
  assert.deepEqual((await getState(db, NOW)).completions, [c]);
});

test('The server clock decides the period: 05:00 Tokyo is still 2026-10-12 although UTC says the 11th', async () => {
  const db = await seededTokyo(await seeded());
  const c = await tick(db, 'it-word-game', Date.parse('2026-10-11T20:00:00Z'));
  assert.equal(c.periodKey, '2026-10-12');
});

test('The reset time shifts the period', async () => {
  const db = await seeded();
  await upsertEntities(db, { items: [itemOf('it-word-game', { resetTime: '04:00', updatedAt: 5 })] });
  const c = await tick(db, 'it-word-game', Date.parse('2026-10-12T02:00:00Z'));
  assert.equal(c.periodKey, '2026-10-11');
});

test('Double tick leaves exactly one tick and returns the first', async () => {
  const db = await seeded();
  const first = await tick(db, 'it-word-game', NOW);
  const second = await tick(db, 'it-word-game', NOW + 3600000);
  assert.deepEqual(second, first);
  assert.equal(await completionCount(db), 1);
});

test('Weekly and monthly items tick into their own period', async () => {
  const db = await seeded();
  // 2026-10-12 is a Monday; weekly weekday 1 -> period 2026-10-12
  assert.equal((await tick(db, 'it-weekly-bonus', NOW)).periodKey, '2026-10-12');
  assert.equal((await tick(db, 'it-monthly-shop', NOW)).periodKey, '2026-10-01');
});

test('Unscheduled, deleted and not-yet-started items answer 409; unknown ids 404; nothing is stored', async () => {
  const db = await seeded();
  await rejectsWith(tick(db, 'it-tasks', NOW), 409);
  await upsertEntities(db, { items: [itemOf('it-word-game', { deleted: true, updatedAt: 9 })] });
  await rejectsWith(tick(db, 'it-word-game', NOW), 409);
  await upsertEntities(db, { items: [itemOf('it-every-3-days', { schedule: { type: 'everyNDays', n: 3, startDate: '2027-01-01' }, updatedAt: 9 })] });
  await rejectsWith(tick(db, 'it-every-3-days', NOW), 409);
  await rejectsWith(tick(db, 'no-such-item', NOW), 404);
  assert.equal(await completionCount(db), 0);
});

test('Untick removes only the current period; earlier periods remain', async () => {
  const db = await seeded();
  await tick(db, 'it-word-game', NOW - DAY);
  await tick(db, 'it-word-game', NOW);
  assert.deepEqual(await untick(db, 'it-word-game', NOW), { removed: 1 });
  assert.deepEqual((await history(db, 'it-word-game')).map((c) => c.periodKey), ['2026-10-11']);
  assert.deepEqual(await untick(db, 'it-word-game', NOW), { removed: 0 });
  await rejectsWith(untick(db, 'no-such-item', NOW), 404);
  assert.deepEqual(await untick(db, 'it-tasks', NOW), { removed: 0 });
});

test('History lists an item\'s ticks newest first', async () => {
  const db = await seeded();
  for (const d of [3, 1, 2]) await tick(db, 'it-word-game', NOW - d * DAY);
  await tick(db, 'it-weekly-bonus', NOW);
  const h = await history(db, 'it-word-game');
  assert.deepEqual(h.map((c) => c.periodKey), ['2026-10-11', '2026-10-10', '2026-10-09']);
  assert.deepEqual(await history(db, 'unknown'), []);
});

// ----- ticks with a reported time (offline-ticks) -----

test('Tick with doneAt: the period is that instant\'s and the stored time is the reported one (yesterday, sent today)', async () => {
  const db = await seeded();
  const yesterday = NOW - 10 * 3600000; // 2026-10-11 14:00 UTC
  const c = await tick(db, 'it-word-game', NOW, { doneAt: yesterday });
  assert.deepEqual(c, { itemId: 'it-word-game', periodKey: '2026-10-11', doneAt: yesterday });
  assert.deepEqual((await history(db, 'it-word-game')).map((x) => x.periodKey), ['2026-10-11'], 'nothing under today');
});

test('Tick with doneAt across midnight in the stored timezone: 23:30 Tokyo on the 11th is the 11th, 00:30 on the 12th is the 12th', async () => {
  const db = await seededTokyo(await seeded());
  const late = Date.parse('2026-10-11T23:30:00+09:00');
  const early = Date.parse('2026-10-12T00:30:00+09:00');
  assert.equal((await tick(db, 'it-word-game', NOW, { doneAt: late })).periodKey, '2026-10-11');
  assert.equal((await tick(db, 'it-word-game', NOW, { doneAt: early })).periodKey, '2026-10-12');
});

test('Tick with doneAt honours the reset time: 02:00 with a 04:00 reset belongs to the day before', async () => {
  const db = await seeded();
  await upsertEntities(db, { items: [itemOf('it-word-game', { resetTime: '04:00', updatedAt: 5 })] });
  const c = await tick(db, 'it-word-game', Date.parse('2026-10-12T08:00:00Z'), { doneAt: Date.parse('2026-10-12T02:00:00Z') });
  assert.equal(c.periodKey, '2026-10-11');
});

test('Tick with doneAt: the bounds are inclusive at 48 h back and 5 min ahead and refused one millisecond beyond (422, nothing stored)', async () => {
  const db = await seeded();
  assert.equal((await tick(db, 'it-word-game', NOW, { doneAt: NOW + TICK_FUTURE_MS })).doneAt, NOW + TICK_FUTURE_MS);
  await untick(db, 'it-word-game', NOW);
  const past = await tick(db, 'it-weekly-bonus', NOW, { doneAt: NOW - TICK_PAST_MS });
  assert.equal(past.doneAt, NOW - TICK_PAST_MS);
  const before = await completionCount(db);
  const future = await rejectsWith(tick(db, 'it-word-game', NOW, { doneAt: NOW + TICK_FUTURE_MS + 1 }), 422);
  assert.equal(future.code, 'tick-in-future');
  const old = await rejectsWith(tick(db, 'it-word-game', NOW, { doneAt: NOW - TICK_PAST_MS - 1 }), 422);
  assert.equal(old.code, 'tick-too-old');
  assert.equal(await completionCount(db), before);
});

test('Tick with doneAt: a non-number is a 400 and the bounds come before the item lookup (no 404 for a refused time)', async () => {
  const db = await seeded();
  for (const bad of ['yesterday', NaN, Infinity, {}, true]) {
    const e = await rejectsWith(tick(db, 'it-word-game', NOW, { doneAt: bad }), 400);
    assert.deepEqual(e.details, [{ errors: [{ field: 'doneAt', code: 'invalid-type' }] }]);
  }
  assert.equal((await rejectsWith(tick(db, 'no-such-item', NOW, { doneAt: NOW - 3 * DAY }), 422)).code, 'tick-too-old');
  await rejectsWith(tick(db, 'no-such-item', NOW, { doneAt: NOW - 3600000 }), 404);
  assert.equal(await completionCount(db), 0);
});

test('Tick with doneAt: duplicates return the stored tick, whatever the second doneAt was', async () => {
  const db = await seeded();
  const first = await tick(db, 'it-word-game', NOW, { doneAt: NOW - 3600000 });
  const again = await tick(db, 'it-word-game', NOW, { doneAt: NOW - 1800000 });
  assert.deepEqual(again, first);
  assert.equal(await completionCount(db), 1);
  assert.deepEqual(await tick(db, 'it-word-game', NOW, { doneAt: NOW - 3600000 }), first);
});

test('Tick with doneAt: the 409 rules are evaluated at that instant (every-N-days start date, deleted, unscheduled)', async () => {
  const db = await seeded();
  await upsertEntities(db, { items: [itemOf('it-every-3-days', { schedule: { type: 'everyNDays', n: 3, startDate: '2026-10-12' }, updatedAt: 9 })] });
  await rejectsWith(tick(db, 'it-every-3-days', NOW + 3600000, { doneAt: Date.parse('2026-10-11T23:00:00Z') }), 409);
  assert.equal((await tick(db, 'it-every-3-days', NOW + 3600000, { doneAt: NOW })).periodKey, '2026-10-12');
  await rejectsWith(tick(db, 'it-tasks', NOW, { doneAt: NOW - 1000 }), 409);
  await upsertEntities(db, { items: [itemOf('it-word-game', { deleted: true, updatedAt: 9 })] });
  await rejectsWith(tick(db, 'it-word-game', NOW, { doneAt: NOW - 1000 }), 409);
});

test('Tick without doneAt is unchanged, and null/undefined count as absent', async () => {
  const db = await seeded();
  const a = await tick(db, 'it-word-game', NOW, {});
  assert.equal(a.doneAt, NOW);
  await untick(db, 'it-word-game', NOW);
  assert.equal((await tick(db, 'it-word-game', NOW, { doneAt: null })).doneAt, NOW);
  await untick(db, 'it-word-game', NOW);
  assert.equal((await tick(db, 'it-word-game', NOW, { doneAt: undefined })).doneAt, NOW);
});

test('Untick with periodKey: the current or the previous period are allowed, older and future ones are 422', async () => {
  const db = await seeded();
  await tick(db, 'it-word-game', NOW - 2 * DAY);
  await tick(db, 'it-word-game', NOW - DAY);
  await tick(db, 'it-word-game', NOW);
  assert.deepEqual(await untick(db, 'it-word-game', NOW, { periodKey: '2026-10-11' }), { removed: 1 });
  assert.deepEqual((await history(db, 'it-word-game')).map((c) => c.periodKey), ['2026-10-12', '2026-10-10'], 'today and the day before yesterday remain');
  assert.equal((await rejectsWith(untick(db, 'it-word-game', NOW, { periodKey: '2026-10-10' }), 422)).code, 'period-not-allowed');
  assert.equal((await rejectsWith(untick(db, 'it-word-game', NOW, { periodKey: '2026-10-13' }), 422)).code, 'period-not-allowed');
  assert.deepEqual(await untick(db, 'it-word-game', NOW, { periodKey: '2026-10-12' }), { removed: 1 });
  assert.deepEqual((await history(db, 'it-word-game')).map((c) => c.periodKey), ['2026-10-10'], 'the refused ones removed nothing');
});

test('Untick with periodKey on weekly and monthly items uses their own previous period', async () => {
  const db = await seeded();
  await tick(db, 'it-weekly-bonus', NOW - 7 * DAY);
  await tick(db, 'it-weekly-bonus', NOW);
  assert.deepEqual(await untick(db, 'it-weekly-bonus', NOW, { periodKey: '2026-10-05' }), { removed: 1 });
  await rejectsWith(untick(db, 'it-weekly-bonus', NOW, { periodKey: '2026-10-11' }), 422); // a day, not a weekly period start
  await tick(db, 'it-monthly-shop', NOW);
  await rejectsWith(untick(db, 'it-monthly-shop', NOW, { periodKey: '2026-08-01' }), 422);
  assert.deepEqual(await untick(db, 'it-monthly-shop', NOW, { periodKey: '2026-09-01' }), { removed: 0 }, 'the previous month is allowed even with nothing to remove');
});

test('Untick with periodKey: invalid dates are 400, unknown items 404, unscheduled items remove nothing; without it nothing changed', async () => {
  const db = await seeded();
  for (const bad of ['yesterday', '2026-13-01', '2026-10-1', '']) await rejectsWith(untick(db, 'it-word-game', NOW, { periodKey: bad }), 400);
  await rejectsWith(untick(db, 'no-such-item', NOW, { periodKey: '2026-10-12' }), 404);
  assert.deepEqual(await untick(db, 'it-tasks', NOW, { periodKey: '2026-10-12' }), { removed: 0 });
  await tick(db, 'it-word-game', NOW);
  assert.deepEqual(await untick(db, 'it-word-game', NOW, {}), { removed: 1 });
  assert.deepEqual(await untick(db, 'it-word-game', NOW, { periodKey: null }), { removed: 0 });
});

test('The state lists the Worker\'s features', async () => {
  const db = await seeded();
  assert.deepEqual((await getState(db, NOW)).features, ['tick-done-at']);
  assert.deepEqual([...FEATURES], ['tick-done-at']);
});