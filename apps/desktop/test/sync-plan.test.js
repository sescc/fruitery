// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGroup, makeItem, makeWorkspace, tokyo, utc } from '../../../packages/core/fixtures.js';
import { afterPush, afterTickSend, applyTickOps, enqueue, enqueueTick, firstSyncPlan, firstSyncTicks, hasTickFeature, mergeSnapshot, sendable, statusOf } from '../lib/sync-plan.js';

const settings = (/** @type {Record<string, unknown>} */ o = {}) => ({ timezone: 'UTC', googleEmail: null, updatedAt: 0, ...o });
const snap = (/** @type {Record<string, unknown>} */ o = {}) => ({ workspaces: [], groups: [], items: [], settings: settings(), completions: [], ...o });
/** @param {string} id @param {number} updatedAt @param {Record<string, unknown>} [o] */
const item = (id, updatedAt, o = {}) => makeItem({ id, updatedAt, name: `Item ${id}`, ...o });
/** @param {import('../lib/sync-plan.js').Kind} kind @param {any} entity @param {any} [error] */
const entry = (kind, entity, error) => (error ? { kind, entity, error } : { kind, entity });

// ---------------------------------------------------------------------------------------------
// mergeSnapshot

test('mergeSnapshot: a newer remote entity beats an older outbox entry', () => {
  const merged = mergeSnapshot(snap(), snap({ items: [item('a', 20, { name: 'Remote' })] }), [entry('items', item('a', 10, { name: 'Local' }))]);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].name, 'Remote');
});

test('mergeSnapshot: a newer outbox entity beats the remote one', () => {
  const merged = mergeSnapshot(snap(), snap({ items: [item('a', 10, { name: 'Remote' })] }), [entry('items', item('a', 20, { name: 'Local' }))]);
  assert.equal(merged.items[0].name, 'Local');
});

test('mergeSnapshot: on equal timestamps the outcome follows the core tie-break, whatever the side', () => {
  const x = item('a', 10, { name: 'Aaa' });
  const y = item('a', 10, { name: 'Zzz' });
  const one = mergeSnapshot(snap(), snap({ items: [x] }), [entry('items', y)]);
  const two = mergeSnapshot(snap(), snap({ items: [y] }), [entry('items', x)]);
  assert.equal(one.items[0].name, two.items[0].name);
});

test('mergeSnapshot: a tombstone from the remote deletes a local entity', () => {
  const local = snap({ items: [item('a', 10)] });
  const merged = mergeSnapshot(local, snap({ items: [item('a', 20, { deleted: true })] }), []);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].deleted, true);
});

test('mergeSnapshot: a tombstone in the outbox beats an older live remote entity', () => {
  const merged = mergeSnapshot(snap(), snap({ items: [item('a', 10)] }), [entry('items', item('a', 20, { deleted: true }))]);
  assert.equal(merged.items[0].deleted, true);
});

test('mergeSnapshot: a live remote entity beats an older tombstone in the outbox', () => {
  const merged = mergeSnapshot(snap(), snap({ items: [item('a', 20)] }), [entry('items', item('a', 10, { deleted: true }))]);
  assert.equal(merged.items[0].deleted, false);
});

test('mergeSnapshot: local entities that are neither remote nor in the outbox are dropped', () => {
  const local = snap({ workspaces: [makeWorkspace({ id: 'old', updatedAt: 5 })], groups: [makeGroup({ id: 'g-old', updatedAt: 5 })], items: [item('gone', 5)] });
  const merged = mergeSnapshot(local, snap({ items: [item('kept', 5)] }), []);
  assert.deepEqual(merged.items.map((i) => i.id), ['kept']);
  assert.deepEqual(merged.workspaces, []);
  assert.deepEqual(merged.groups, []);
});

test('mergeSnapshot: outbox-only entities are kept, after the remote ones', () => {
  const merged = mergeSnapshot(
    snap(),
    snap({ items: [item('r1', 5), item('r2', 5)], groups: [makeGroup({ id: 'g-r', updatedAt: 5 })] }),
    [entry('items', item('new', 9)), entry('groups', makeGroup({ id: 'g-new', updatedAt: 9 })), entry('workspaces', makeWorkspace({ id: 'ws-new', updatedAt: 9 }))],
  );
  assert.deepEqual(merged.items.map((i) => i.id), ['r1', 'r2', 'new']);
  assert.deepEqual(merged.groups.map((g) => g.id), ['g-r', 'g-new']);
  assert.deepEqual(merged.workspaces.map((w) => w.id), ['ws-new']);
});

test('mergeSnapshot: the remote order is kept even when ids sort differently', () => {
  const merged = mergeSnapshot(snap(), snap({ items: [item('z', 1), item('a', 1), item('m', 1)] }), [entry('items', item('a', 2))]);
  assert.deepEqual(merged.items.map((i) => i.id), ['z', 'a', 'm']);
});

test('mergeSnapshot: completions come from the remote only', () => {
  const local = snap({ completions: [{ itemId: 'a', periodKey: '2026-10-19', doneAt: 1 }] });
  const remote = snap({ completions: [{ itemId: 'b', periodKey: '2026-10-20', doneAt: 2 }] });
  const merged = mergeSnapshot(local, remote, []);
  assert.deepEqual(merged.completions, remote.completions);
  assert.notEqual(merged.completions, remote.completions, 'a copy, not the same array');
});

test('mergeSnapshot: settings are one entity, newest wins, and the local ones are replaced by the remote', () => {
  const remote = snap({ settings: settings({ timezone: 'Asia/Tokyo', updatedAt: 10 }) });
  const local = snap({ settings: settings({ timezone: 'Europe/Paris', updatedAt: 30 }) });
  assert.equal(mergeSnapshot(local, remote, []).settings.timezone, 'Asia/Tokyo');
  const newer = entry('settings', settings({ timezone: 'America/New_York', updatedAt: 20 }));
  assert.equal(mergeSnapshot(local, remote, [newer]).settings.timezone, 'America/New_York');
  const older = entry('settings', settings({ timezone: 'America/New_York', updatedAt: 5 }));
  assert.equal(mergeSnapshot(local, remote, [older]).settings.timezone, 'Asia/Tokyo');
});

test('mergeSnapshot: a remote without settings keeps the local ones', () => {
  const local = snap({ settings: settings({ timezone: 'Europe/Paris', updatedAt: 3 }) });
  const merged = mergeSnapshot(local, /** @type {any} */ ({ workspaces: [], groups: [], items: [], completions: [] }), []);
  assert.equal(merged.settings.timezone, 'Europe/Paris');
});

test('mergeSnapshot: an outbox entry that carries an error still takes part in the merge', () => {
  const merged = mergeSnapshot(snap(), snap({ items: [item('a', 1)] }), [entry('items', item('a', 9, { name: 'Edited' }), [{ field: 'url', code: 'invalid-url' }])]);
  assert.equal(merged.items[0].name, 'Edited');
});

test('mergeSnapshot: the inputs are not mutated', () => {
  const local = snap({ items: [item('gone', 1)] });
  const remote = snap({ items: [item('a', 10)], completions: [{ itemId: 'a', periodKey: '2026-10-20', doneAt: 1 }], settings: settings({ updatedAt: 1 }) });
  const outbox = [entry('items', item('a', 20, { name: 'Local' })), entry('settings', settings({ timezone: 'Asia/Tokyo', updatedAt: 9 }))];
  const frozen = structuredClone({ local, remote, outbox });
  mergeSnapshot(local, remote, outbox);
  assert.deepEqual({ local, remote, outbox }, frozen);
});

// ---------------------------------------------------------------------------------------------
// enqueue

test('enqueue: the same entity twice keeps the newest version, in the first position', () => {
  let box = enqueue([], 'items', [item('a', 10, { name: 'First' }), item('b', 10)]);
  box = enqueue(box, 'items', [item('a', 20, { name: 'Second' })]);
  box = enqueue(box, 'items', [item('a', 15, { name: 'Older' })]);
  assert.deepEqual(box.map((o) => o.entity.id), ['a', 'b']);
  assert.equal(box[0].entity.name, 'Second');
});

test('enqueue: a re-enqueue after an edit loses the old error', () => {
  const rejected = [entry('items', item('a', 10), [{ field: 'url', code: 'invalid-url' }])];
  const box = enqueue(rejected, 'items', [item('a', 11, { name: 'Fixed' })]);
  assert.equal(box.length, 1);
  assert.equal(box[0].error, undefined);
  assert.equal(box[0].entity.name, 'Fixed');
});

test('enqueue: an older or identical version leaves the entry, and its error, alone', () => {
  const rejected = [entry('items', item('a', 10), [{ field: 'url', code: 'invalid-url' }])];
  assert.deepEqual(enqueue(rejected, 'items', [item('a', 9)]), rejected);
  assert.deepEqual(enqueue(rejected, 'items', [item('a', 10)]), rejected);
});

test('enqueue: the same id in two kinds is two entries', () => {
  let box = enqueue([], 'items', [item('x', 1)]);
  box = enqueue(box, 'groups', [makeGroup({ id: 'x', updatedAt: 1 })]);
  box = enqueue(box, 'workspaces', [makeWorkspace({ id: 'x', updatedAt: 1 })]);
  assert.deepEqual(box.map((o) => o.kind), ['items', 'groups', 'workspaces']);
});

test('enqueue: settings are one entry whichever way they are passed, and the input outbox is untouched', () => {
  const start = [entry('settings', settings({ updatedAt: 1 }))];
  const frozen = structuredClone(start);
  let box = enqueue(start, 'settings', settings({ timezone: 'Asia/Tokyo', updatedAt: 2 }));
  box = enqueue(box, 'settings', [settings({ timezone: 'Europe/Paris', updatedAt: 3 })]);
  assert.equal(box.length, 1);
  assert.equal(box[0].entity.timezone, 'Europe/Paris');
  assert.deepEqual(start, frozen);
});

test('enqueue: the stored entity is a copy, so later edits of the caller do not change the outbox', () => {
  const it = item('a', 1);
  const box = enqueue([], 'items', [it]);
  it.name = 'changed afterwards';
  assert.equal(box[0].entity.name, 'Item a');
});

// ---------------------------------------------------------------------------------------------
// afterPush / sendable

test('afterPush: success removes the confirmed entries, whichever version the server stored', () => {
  const box = [entry('items', item('a', 10)), entry('items', item('b', 10)), entry('groups', makeGroup({ id: 'g', updatedAt: 10 })), entry('settings', settings({ updatedAt: 10 }))];
  const sent = sendable(box);
  const response = {
    workspaces: [],
    groups: [makeGroup({ id: 'g', updatedAt: 10 })],
    items: [item('a', 10), item('b', 50, { name: 'Newer on the server' })],
    settings: settings({ updatedAt: 10 }),
  };
  assert.deepEqual(afterPush(box, sent, response), []);
});

test('afterPush: an entry edited after it was sent stays', () => {
  const sentBox = [entry('items', item('a', 10)), entry('items', item('b', 10))];
  const sent = sendable(sentBox);
  const nowBox = enqueue(sentBox, 'items', [item('a', 12, { name: 'Edited while the push was running' })]);
  const left = afterPush(nowBox, sent, { items: [item('a', 10), item('b', 10)], groups: [], workspaces: [], settings: null });
  assert.deepEqual(left.map((o) => o.entity.id), ['a']);
  assert.equal(left[0].entity.updatedAt, 12);
});

test('afterPush: entries that were not part of the push stay, and an entry missing from the response stays', () => {
  const box = [entry('items', item('a', 10)), entry('items', item('b', 10)), entry('items', item('c', 10))];
  const left = afterPush(box, { items: [item('a', 10), item('b', 10)] }, { items: [item('a', 10)], groups: [], workspaces: [], settings: null });
  assert.deepEqual(left.map((o) => o.entity.id), ['b', 'c']);
});

test('afterPush: the same id in another kind is not confused', () => {
  const box = [entry('items', item('x', 10)), entry('groups', makeGroup({ id: 'x', updatedAt: 10 }))];
  const left = afterPush(box, sendable(box), { items: [item('x', 10)], groups: [], workspaces: [], settings: null });
  assert.deepEqual(left.map((o) => o.kind), ['groups']);
});

test('afterPush: a 422 marks exactly the listed ids, stores nothing and keeps every entry', () => {
  const box = [entry('items', item('a', 10)), entry('items', item('b', 10)), entry('items', item('c', 10)), entry('settings', settings({ timezone: 'Nope/Zone', updatedAt: 10 }))];
  const response = {
    error: 'invalid',
    details: [
      { id: 'b', errors: [{ field: 'url', code: 'invalid-url' }, { field: 'name', code: 'required' }] },
      { id: 'settings', errors: [{ field: 'timezone', code: 'invalid-timezone' }] },
    ],
  };
  const left = afterPush(box, sendable(box), response);
  assert.equal(left.length, 4);
  assert.deepEqual(left.map((o) => o.error), [undefined, [{ field: 'url', code: 'invalid-url' }, { field: 'name', code: 'required' }], undefined, [{ field: 'timezone', code: 'invalid-timezone' }]]);
});

test('afterPush: a 422 listing an id that was not sent marks nothing', () => {
  const box = [entry('items', item('a', 10)), entry('items', item('stored-elsewhere', 10))];
  const sent = { items: [item('a', 10)] };
  const left = afterPush(box, sent, { error: 'invalid', details: [{ id: 'stored-elsewhere', errors: [{ field: 'url', code: 'invalid-url' }] }] });
  assert.deepEqual(left.map((o) => o.error), [undefined, undefined]);
});

test('afterPush: a 422 without ids or with junk entries marks nothing and does not throw', () => {
  const box = [entry('items', item('a', 10))];
  const left = afterPush(box, sendable(box), { error: 'invalid', details: [null, { errors: [{ field: 'x', code: 'y' }] }, { id: 'a' }, { id: 'a', errors: [null, { field: 1 }] }] });
  assert.equal(left[0].error, undefined);
});

test('afterPush: does not mutate its inputs', () => {
  const box = [entry('items', item('a', 10)), entry('items', item('b', 10))];
  const frozen = structuredClone(box);
  afterPush(box, sendable(box), { error: 'invalid', details: [{ id: 'a', errors: [{ field: 'url', code: 'invalid-url' }] }] });
  afterPush(box, sendable(box), { items: [item('a', 10)] });
  assert.deepEqual(box, frozen);
});

test('sendable: groups the entries as the PUT body expects and leaves out empty kinds', () => {
  const box = [entry('items', item('a', 1)), entry('groups', makeGroup({ id: 'g', updatedAt: 1 })), entry('settings', settings({ updatedAt: 1 })), entry('items', item('b', 1))];
  const body = sendable(box);
  assert.deepEqual(Object.keys(body).sort(), ['groups', 'items', 'settings']);
  assert.deepEqual(body.items?.map((i) => i.id), ['a', 'b']);
  assert.equal(body.settings.updatedAt, 1);
  assert.deepEqual(sendable([]), {});
});

test('sendable: entries with an error are skipped', () => {
  const box = [entry('items', item('a', 1), [{ field: 'url', code: 'invalid-url' }]), entry('items', item('b', 1))];
  assert.deepEqual(sendable(box).items?.map((i) => i.id), ['b']);
  assert.deepEqual(sendable([entry('items', item('a', 1), [{ field: 'url', code: 'invalid-url' }])]), {});
});

test('sendable: at most 100 entities by default (101 gives 100) and a custom cap', () => {
  const box = Array.from({ length: 101 }, (_, i) => entry('items', item(`i${String(i).padStart(3, '0')}`, 1)));
  assert.equal(sendable(box).items?.length, 100);
  assert.equal(sendable(box).items?.at(-1)?.id, 'i099');
  assert.equal(sendable(box, 5).items?.length, 5);
});

test('sendable: workspaces, groups and items come first so a batch never needs a group sent later; settings last', () => {
  const box = [entry('settings', settings({ updatedAt: 1 })), entry('items', item('a', 1)), entry('groups', makeGroup({ id: 'g', updatedAt: 1 })), entry('workspaces', makeWorkspace({ id: 'w', updatedAt: 1 }))];
  assert.deepEqual(Object.keys(sendable(box)), ['workspaces', 'groups', 'items', 'settings']);
  const big = [...Array.from({ length: 100 }, (_, i) => entry('items', item(`i${i}`, 1))), entry('groups', makeGroup({ id: 'g', updatedAt: 1 }))];
  const body = sendable(big, 100);
  assert.equal(body.groups?.length, 1);
  assert.equal(body.items?.length, 99);
});

test('sendable: errored entries do not use up the cap', () => {
  const box = [entry('items', item('bad', 1), [{ field: 'url', code: 'invalid-url' }]), ...Array.from({ length: 100 }, (_, i) => entry('items', item(`ok${i}`, 1)))];
  assert.equal(sendable(box).items?.length, 100);
});

// ---------------------------------------------------------------------------------------------
// firstSyncPlan

test('firstSyncPlan: a newer local entity is pushed; a newer remote one is not; equal is not', () => {
  const local = snap({ items: [item('newer', 20), item('older', 10), item('equal', 15)] });
  const remote = snap({ items: [item('newer', 10), item('older', 20), item('equal', 15)] });
  const { outbox } = firstSyncPlan(local, remote);
  assert.deepEqual(outbox.map((o) => o.entity.id), ['newer']);
  assert.equal(outbox[0].kind, 'items');
});

test('firstSyncPlan: a local-only edited entity is pushed, in every kind', () => {
  const local = snap({ workspaces: [makeWorkspace({ id: 'w', updatedAt: 5 })], groups: [makeGroup({ id: 'g', updatedAt: 5 })], items: [item('i', 5)] });
  const { outbox } = firstSyncPlan(local, snap());
  assert.deepEqual(outbox.map((o) => `${o.kind}:${o.entity.id}`), ['workspaces:w', 'groups:g', 'items:i']);
});

test('firstSyncPlan: a local tombstone newer than the live remote entity is pushed', () => {
  const { outbox } = firstSyncPlan(snap({ items: [item('a', 20, { deleted: true })] }), snap({ items: [item('a', 10)] }));
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].entity.deleted, true);
});

test('firstSyncPlan: untouched seed rows (updatedAt 0 or missing) are never pushed', () => {
  const noStamp = /** @type {any} */ (item('nostamp', 0));
  delete noStamp.updatedAt;
  const local = snap({ items: [item('zero', 0), noStamp], workspaces: [makeWorkspace({ id: 'w', updatedAt: 0 })], groups: [makeGroup({ id: 'g', updatedAt: 0 })] });
  assert.deepEqual(firstSyncPlan(local, snap()).outbox, []);
});

test('firstSyncPlan: settings follow the same rule', () => {
  const edited = snap({ settings: settings({ timezone: 'Asia/Tokyo', updatedAt: 20 }) });
  assert.deepEqual(firstSyncPlan(edited, snap({ settings: settings({ updatedAt: 10 }) })).outbox.map((o) => o.kind), ['settings']);
  assert.deepEqual(firstSyncPlan(edited, snap({ settings: settings({ updatedAt: 20 }) })).outbox, []);
  assert.deepEqual(firstSyncPlan(edited, snap({ settings: settings({ updatedAt: 30 }) })).outbox, []);
  assert.deepEqual(firstSyncPlan(snap(), snap({ settings: settings({ updatedAt: 0 }) })).outbox, [], 'default settings are never pushed');
  assert.deepEqual(firstSyncPlan(edited, snap({ settings: undefined })).outbox.map((o) => o.kind), ['settings'], 'a remote with no settings counts as missing');
});

test('firstSyncPlan: does not mutate its inputs', () => {
  const local = snap({ items: [item('a', 20)] });
  const remote = snap({ items: [item('a', 10)] });
  const frozen = structuredClone({ local, remote });
  firstSyncPlan(local, remote);
  assert.deepEqual({ local, remote }, frozen);
});

// ---------------------------------------------------------------------------------------------
// firstSyncTicks

const NOW = utc('2026-10-20T12:00');
const TODAY = '2026-10-20';
const tick = (/** @type {string} */ itemId, /** @type {string} */ periodKey, doneAt = 1000) => ({ itemId, periodKey, doneAt });

test('firstSyncTicks: picks the tick of the current period and skips past periods', () => {
  const items = [item('a', 1), item('b', 1)];
  const out = firstSyncTicks([tick('a', TODAY), tick('b', '2026-10-19')], items, NOW, 'UTC');
  assert.deepEqual(out, [tick('a', TODAY)]);
});

test('firstSyncTicks: skips unscheduled, deleted and unknown items', () => {
  const items = [item('plain', 1, { schedule: null }), item('dead', 1, { deleted: true }), item('live', 1)];
  const ticks = [tick('plain', TODAY), tick('dead', TODAY), tick('ghost', TODAY), tick('live', TODAY)];
  assert.deepEqual(firstSyncTicks(ticks, items, NOW, 'UTC'), [tick('live', TODAY)]);
});

test('firstSyncTicks: an every-N-days item before its start date has no current period', () => {
  const items = [item('later', 1, { schedule: { type: 'everyNDays', n: 3, startDate: '2026-10-25' } })];
  assert.deepEqual(firstSyncTicks([tick('later', TODAY), tick('later', '2026-10-25')], items, NOW, 'UTC'), []);
});

test('firstSyncTicks: weekly and every-N-days periods match on the period start, not on the day', () => {
  const items = [
    item('weekly', 1, { schedule: { type: 'weekly', weekday: 1 } }), // Monday; 2026-10-20 is a Tuesday
    item('every3', 1, { schedule: { type: 'everyNDays', n: 3, startDate: '2026-10-01' } }), // periods start 10-01, 10-04 ... 10-19
  ];
  const ticks = [tick('weekly', '2026-10-19'), tick('every3', '2026-10-19')];
  assert.deepEqual(firstSyncTicks(ticks, items, NOW, 'UTC'), ticks);
  assert.deepEqual(firstSyncTicks([tick('weekly', '2026-10-12'), tick('every3', '2026-10-16')], items, NOW, 'UTC'), []);
});

test('firstSyncTicks: respects resetTime (02:00 with reset 04:00 is still the previous day)', () => {
  const items = [item('late', 1, { resetTime: '04:00' }), item('plain', 1)];
  const at = utc('2026-10-20T02:00');
  const ticks = [tick('late', '2026-10-19'), tick('late', '2026-10-20'), tick('plain', '2026-10-19'), tick('plain', '2026-10-20')];
  assert.deepEqual(firstSyncTicks(ticks, items, at, 'UTC'), [tick('late', '2026-10-19'), tick('plain', '2026-10-20')]);
});

test('firstSyncTicks: respects the timezone', () => {
  const items = [item('a', 1)];
  const at = tokyo('2026-10-21T05:00'); // 2026-10-20T20:00Z
  assert.deepEqual(firstSyncTicks([tick('a', '2026-10-20')], items, at, 'UTC'), [tick('a', '2026-10-20')]);
  assert.deepEqual(firstSyncTicks([tick('a', '2026-10-20')], items, at, 'Asia/Tokyo'), []);
  assert.deepEqual(firstSyncTicks([tick('a', '2026-10-21')], items, at, 'Asia/Tokyo'), [tick('a', '2026-10-21')]);
});

test('firstSyncTicks: one per item, the earliest doneAt, and the input ticks are not shared', () => {
  const items = [item('a', 1)];
  const ticks = [tick('a', TODAY, 500), tick('a', TODAY, 300), tick('a', TODAY, 900)];
  const out = firstSyncTicks(ticks, items, NOW, 'UTC');
  assert.deepEqual(out, [tick('a', TODAY, 300)]);
  assert.notEqual(out[0], ticks[1]);
});

test('firstSyncTicks: an item with an unusable schedule is skipped, a bad timezone throws', () => {
  const items = [item('broken', 1, { schedule: { type: 'weekly', weekday: 9 } }), item('ok', 1)];
  assert.deepEqual(firstSyncTicks([tick('broken', TODAY), tick('ok', TODAY)], items, NOW, 'UTC'), [tick('ok', TODAY)]);
  assert.throws(() => firstSyncTicks([tick('ok', TODAY)], items, NOW, 'Not/AZone'), RangeError);
});

// ---------------------------------------------------------------------------------------------
// statusOf

/** @param {Record<string, unknown>} [o] */
const st = (o = {}) => ({ configured: true, hasSecret: true, inFlight: false, offline: false, lastError: null, expiresOn: null, ...o });
const status = (/** @type {Record<string, unknown>} */ o, now = NOW, tz = 'UTC') => statusOf(/** @type {any} */ (st(o)), now, tz);

test('statusOf: every status', () => {
  assert.equal(status({ configured: false }), 'not-connected');
  assert.equal(status({ hasSecret: false }), 'not-connected');
  assert.equal(status({ expiresOn: '2026-10-19' }), 'expired');
  assert.equal(status({ lastError: 'access-key-refused' }), 'error:access-key-refused');
  assert.equal(status({ offline: true }), 'offline');
  assert.equal(status({ expiresOn: '2026-10-30' }), 'expiring:10');
  assert.equal(status({ inFlight: true }), 'syncing');
  assert.equal(status({}), 'synced');
});

test('statusOf: not connected beats everything, even an expired key and an error', () => {
  assert.equal(status({ configured: false, expiresOn: '2020-01-01', lastError: 'x', offline: true, inFlight: true }), 'not-connected');
  assert.equal(status({ hasSecret: false, expiresOn: '2020-01-01', lastError: 'x' }), 'not-connected');
});

test('statusOf: precedence is expired > error > offline > expiring > syncing', () => {
  const all = { expiresOn: '2026-10-25', inFlight: true, offline: true, lastError: 'boom' };
  assert.equal(status({ ...all, expiresOn: '2026-10-19' }), 'expired');
  assert.equal(status(all), 'error:boom');
  assert.equal(status({ ...all, lastError: null }), 'offline');
  assert.equal(status({ ...all, lastError: null, offline: false }), 'expiring:5');
  assert.equal(status({ ...all, lastError: null, offline: false, expiresOn: '2026-12-31' }), 'syncing');
});

test('statusOf: expiry boundaries in whole calendar days', () => {
  assert.equal(status({ expiresOn: '2026-10-20' }), 'expiring:0', 'expires today');
  assert.equal(status({ expiresOn: '2026-10-19' }), 'expired', 'the day after');
  assert.equal(status({ expiresOn: '2026-11-03' }), 'expiring:14');
  assert.equal(status({ expiresOn: '2026-11-04' }), 'synced', '15 days away');
  assert.equal(status({ expiresOn: '2026-11-04', inFlight: true }), 'syncing');
});

test('statusOf: the day is the local date in the given timezone', () => {
  const now = utc('2026-10-20T20:00'); // already 2026-10-21 in Tokyo
  assert.equal(statusOf(st({ expiresOn: '2026-10-20' }), now, 'UTC'), 'expiring:0');
  assert.equal(statusOf(st({ expiresOn: '2026-10-20' }), now, 'Asia/Tokyo'), 'expired');
  assert.equal(statusOf(st({ expiresOn: '2026-11-04' }), now, 'Asia/Tokyo'), 'expiring:14');
});

test('statusOf: no or unreadable expiry date means no expiry checks', () => {
  assert.equal(status({ expiresOn: null }), 'synced');
  assert.equal(status({ expiresOn: 'soon' }), 'synced');
  assert.equal(status({ expiresOn: '' , inFlight: true }), 'syncing');
});

test('statusOf: a bad timezone is only a problem when there is an expiry date to compare', () => {
  assert.equal(status({}, NOW, 'Not/AZone'), 'synced');
  assert.throws(() => status({ expiresOn: '2026-10-30' }, NOW, 'Not/AZone'), RangeError);
});

// ---------------------------------------------------------------------------------------------
// waiting ticks (offline-ticks)

const tickOp = (/** @type {string} */ itemId, /** @type {string} */ periodKey, doneAt = 1000) => /** @type {const} */ ({ op: 'tick', itemId, periodKey, doneAt });
const untickOp = (/** @type {string} */ itemId, /** @type {string} */ periodKey) => /** @type {const} */ ({ op: 'untick', itemId, periodKey });

test('enqueueTick: an op for a new item and period is appended; the input list is not mutated', () => {
  const start = [tickOp('a', '2026-10-20')];
  const frozen = structuredClone(start);
  const next = enqueueTick(start, untickOp('b', '2026-10-20'));
  assert.deepEqual(next, [tickOp('a', '2026-10-20'), untickOp('b', '2026-10-20')]);
  assert.deepEqual(start, frozen);
  assert.notEqual(next[0], start[0]);
});

test('enqueueTick: a second tick for the same item and period changes nothing (the first time wins)', () => {
  const next = enqueueTick([tickOp('a', '2026-10-20', 1000)], tickOp('a', '2026-10-20', 9999));
  assert.deepEqual(next, [tickOp('a', '2026-10-20', 1000)]);
});

test('enqueueTick: a tick and then an untick of the same period cancel out', () => {
  assert.deepEqual(enqueueTick([tickOp('a', '2026-10-20'), tickOp('b', '2026-10-20')], untickOp('a', '2026-10-20')), [tickOp('b', '2026-10-20')]);
});

test('enqueueTick: an untick and then a tick of the same period cancel out too (the server still has the completion)', () => {
  assert.deepEqual(enqueueTick([untickOp('a', '2026-10-20')], tickOp('a', '2026-10-20')), []);
});

test('enqueueTick: an untick twice is one; other periods of the same item are kept apart', () => {
  assert.deepEqual(enqueueTick([untickOp('a', '2026-10-20')], untickOp('a', '2026-10-20')), [untickOp('a', '2026-10-20')]);
  assert.deepEqual(enqueueTick([tickOp('a', '2026-10-19')], untickOp('a', '2026-10-20')), [tickOp('a', '2026-10-19'), untickOp('a', '2026-10-20')]);
});

test('applyTickOps: a waiting tick adds its completion unless one exists; a waiting untick removes it; inputs are untouched', () => {
  const server = [{ itemId: 'a', periodKey: '2026-10-20', doneAt: 5 }, { itemId: 'b', periodKey: '2026-10-20', doneAt: 6 }];
  const frozen = structuredClone(server);
  const out = applyTickOps(server, [tickOp('a', '2026-10-20', 99), tickOp('c', '2026-10-20', 77), untickOp('b', '2026-10-20')]);
  assert.deepEqual(out, [{ itemId: 'a', periodKey: '2026-10-20', doneAt: 5 }, { itemId: 'c', periodKey: '2026-10-20', doneAt: 77 }]);
  assert.deepEqual(server, frozen);
});

test('mergeSnapshot: a pending tick survives a pull that lacks it, a pending untick hides the server\'s completion, a sent one does not linger', () => {
  const remote = snap({ completions: [{ itemId: 'a', periodKey: '2026-10-20', doneAt: 5 }, { itemId: 'b', periodKey: '2026-10-20', doneAt: 6 }] });
  const merged = mergeSnapshot(snap(), remote, [], [tickOp('c', '2026-10-20', 7), untickOp('b', '2026-10-20')]);
  assert.deepEqual(merged.completions.map((c) => c.itemId).sort(), ['a', 'c']);
  const afterSend = mergeSnapshot(snap(), snap({ completions: [...remote.completions, { itemId: 'c', periodKey: '2026-10-20', doneAt: 7 }] }), [], []);
  assert.equal(afterSend.completions.length, 3, 'with an empty queue the server\'s history is the truth');
  assert.equal(mergeSnapshot(snap(), remote, []).completions.length, 2, 'the fourth argument is optional');
});

test('afterTickSend: success removes the op; the rest of the queue stays', () => {
  const ops = [tickOp('a', '2026-10-20'), tickOp('b', '2026-10-20')];
  const r = afterTickSend(ops, ops[0], { ok: true, json: {} });
  assert.deepEqual([r.ops, r.action, r.dropped, r.error], [[tickOp('b', '2026-10-20')], 'next', null, null]);
});

test('afterTickSend: 422 tick-too-old, tick-in-future and period-not-allowed drop the op with the reason', () => {
  for (const code of ['tick-too-old', 'tick-in-future', 'period-not-allowed']) {
    const ops = [tickOp('a', '2026-10-20')];
    const r = afterTickSend(ops, ops[0], { ok: false, kind: 'invalid', status: 422, json: { error: code } });
    assert.deepEqual([r.ops, r.action, r.dropped], [[], 'next', code]);
  }
  const odd = afterTickSend([untickOp('a', '2026-10-20')], untickOp('a', '2026-10-20'), { ok: false, kind: 'invalid', status: 422, json: null });
  assert.deepEqual([odd.ops, odd.dropped], [[], 'refused']);
});

test('afterTickSend: 404 and 409 drop silently, a 400 drops with "refused"', () => {
  for (const status of [404, 409]) {
    const ops = [tickOp('a', '2026-10-20')];
    const r = afterTickSend(ops, ops[0], { ok: false, kind: 'http', status });
    assert.deepEqual([r.ops, r.action, r.dropped, r.error], [[], 'next', null, null], String(status));
  }
  const bad = afterTickSend([tickOp('a', '2026-10-20')], tickOp('a', '2026-10-20'), { ok: false, kind: 'http', status: 400 });
  assert.deepEqual([bad.ops, bad.dropped], [[], 'refused']);
});

test('afterTickSend: offline, denied and refused stop the flight and keep every op; a 5xx stops with http-<status>', () => {
  const ops = [tickOp('a', '2026-10-20'), tickOp('b', '2026-10-20')];
  for (const result of /** @type {any[]} */ ([{ ok: false, kind: 'offline' }, { ok: false, kind: 'denied', reason: 'x' }, { ok: false, kind: 'refused', reason: 'access-key-refused' }])) {
    const r = afterTickSend(ops, ops[0], result);
    assert.deepEqual([r.ops, r.action, r.dropped, r.error], [ops, 'stop', null, null], result.kind);
  }
  const five = afterTickSend(ops, ops[0], { ok: false, kind: 'http', status: 503 });
  assert.deepEqual([five.ops, five.action, five.error], [ops, 'stop', 'http-503']);
});

test('afterTickSend: an op cancelled while its request ran is simply not there; an op of another kind for the same period stays', () => {
  const sent = tickOp('a', '2026-10-20');
  assert.deepEqual(afterTickSend([], sent, { ok: true, json: {} }).ops, []);
  const nowQueue = [untickOp('a', '2026-10-20')];
  assert.deepEqual(afterTickSend(nowQueue, sent, { ok: true, json: {} }).ops, nowQueue);
});

test('hasTickFeature: only a features list that names tick-done-at counts', () => {
  assert.equal(hasTickFeature(['tick-done-at']), true);
  assert.equal(hasTickFeature(['other', 'tick-done-at']), true);
  for (const v of [undefined, null, [], ['other'], 'tick-done-at', {}]) assert.equal(hasTickFeature(v), false, JSON.stringify(v));
});