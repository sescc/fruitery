// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { SEED } from './seed.js';
import { validateItem } from './model.js';
import { expandUrl } from './url-tokens.js';
import { bucket } from './schedule.js';
import { tokyo } from './fixtures.js';
import * as core from './index.js';

test('Every seed item passes validateItem (with the seed groups as context)', () => {
  for (const item of SEED.items) {
    assert.deepEqual(validateItem(item, { groups: SEED.groups }), [], item.id);
  }
});

test('The example seed has 2 workspaces, 3 groups and 11 items (4 productivity + 7 daily)', () => {
  assert.equal(SEED.workspaces.length, 2);
  assert.equal(SEED.groups.length, 3);
  assert.equal(SEED.items.length, 11);
  assert.equal(SEED.items.filter((i) => i.workspaceId === 'ws-productivity').length, 4);
  assert.equal(SEED.items.filter((i) => i.workspaceId === 'ws-daily').length, 7);
});

test('Ids are unique across each collection and item ids are stable slugs', () => {
  for (const list of [SEED.workspaces, SEED.groups, SEED.items]) {
    assert.equal(new Set(list.map((e) => e.id)).size, list.length);
  }
  for (const item of SEED.items) assert.match(item.id, /^it-[a-z0-9-]+$/);
});

test('Order is dense (0..n-1) per parent', () => {
  /** @param {{order: number}[]} list @param {string} label */
  const assertDense = (list, label) => {
    assert.deepEqual(list.map((e) => e.order).sort((a, b) => a - b), list.map((_, i) => i), label);
  };
  assertDense(SEED.workspaces, 'workspaces');
  assertDense(SEED.groups, 'groups in Daily');
  /** @type {Map<string, typeof SEED.items>} */
  const parents = new Map();
  for (const item of SEED.items) {
    const key = `${item.workspaceId}/${item.groupId ?? ''}`;
    parents.set(key, [...(parents.get(key) ?? []), item]);
  }
  assert.equal(parents.size, 4);
  for (const [key, list] of parents) assertDense(list, key);
});

test('Groups belong to Daily, items reference existing workspaces and groups of their own workspace', () => {
  for (const g of SEED.groups) assert.equal(g.workspaceId, 'ws-daily');
  const wsIds = new Set(SEED.workspaces.map((w) => w.id));
  for (const item of SEED.items) {
    assert.ok(wsIds.has(item.workspaceId), item.id);
    if (item.groupId !== null) {
      assert.equal(SEED.groups.find((g) => g.id === item.groupId)?.workspaceId, item.workspaceId, item.id);
    }
  }
  assert.ok(SEED.items.filter((i) => i.workspaceId === 'ws-productivity').every((i) => i.groupId === null));
});

test('Workspace defaults: Productivity never sleeps, Daily sleeps after 10 minutes, neither opens in Edge', () => {
  const ws = Object.fromEntries(SEED.workspaces.map((w) => [w.id, w]));
  assert.equal(ws['ws-productivity'].sleepAfterMin, 0);
  assert.equal(ws['ws-daily'].sleepAfterMin, 10);
  assert.ok(SEED.workspaces.every((w) => w.openInEdge === false && w.name.length > 0 && w.deleted === false && w.updatedAt === 0));
  assert.deepEqual(SEED.groups.map((g) => g.name), ['Study', 'Perks', 'Fun']);
});

test('Productivity items have no schedule and notify/badge on; daily-workspace items are scheduled with both off', () => {
  for (const item of SEED.items) {
    if (item.workspaceId === 'ws-productivity') {
      assert.equal(item.schedule, null, item.id);
      assert.equal(item.notify && item.badge, true, item.id);
    } else {
      assert.notEqual(item.schedule, null, item.id);
      assert.equal(item.notify || item.badge, false, item.id);
    }
  }
});

test('The example covers every cadence: daily, weekly, monthly and every-N-days', () => {
  const byId = Object.fromEntries(SEED.items.map((i) => [i.id, i]));
  assert.deepEqual(byId['it-language'].schedule, { type: 'daily' });
  assert.deepEqual(byId['it-monthly-shop'].schedule, { type: 'monthly', day: 1 });
  assert.deepEqual(byId['it-weekly-bonus'].schedule, { type: 'weekly', weekday: 1 });
  assert.deepEqual(byId['it-every-3-days'].schedule, { type: 'everyNDays', n: 3, startDate: '2026-01-01' });
});

test('Item defaults and device visibility (only the every-3-days example is desktop-only)', () => {
  for (const item of SEED.items) {
    assert.equal(item.kind, 'web');
    assert.equal(item.resetTime, '00:00');
    assert.deepEqual(item.edge, { mode: 'inherit', profile: null });
    assert.equal(item.isolate, false);
    assert.equal(item.persistSessionCookies, true);
    assert.equal(item.sleepAfterMin, null);
    assert.equal(item.icon, null);
    assert.equal(item.updatedAt, 0);
    assert.equal(item.deleted, false);
    assert.equal(item.appPath, null);
    assert.equal(item.fallbackUrl, null);
    assert.equal(item.devices, item.id === 'it-every-3-days' ? 'desktop' : 'all', item.id);
  }
});

test('Settings default to UTC with no Google email', () => {
  assert.deepEqual(SEED.settings, { timezone: 'UTC', googleEmail: null, updatedAt: 0 });
});

test('The monthly shop example expands on 2026-11-01 in Asia/Tokyo to .../202611', () => {
  const shop = SEED.items.find((i) => i.id === 'it-monthly-shop');
  assert.ok(shop && shop.url);
  const { url, unknown, missing } = expandUrl(shop.url, tokyo('2026-11-01T09:00'), 'Asia/Tokyo', SEED.settings);
  assert.equal(url, 'https://example.com/shop/202611');
  assert.deepEqual([unknown, missing], [[], []]);
});

test('The Google Calendar seed item reports a missing Google email until configured', () => {
  const gcal = SEED.items.find((i) => i.id === 'it-gcal');
  assert.ok(gcal && gcal.url);
  assert.deepEqual(expandUrl(gcal.url, 0, 'UTC', SEED.settings).missing, ['googleEmail']);
  assert.equal(
    expandUrl(gcal.url, 0, 'UTC', { googleEmail: 'me@example.com' }).url,
    'https://calendar.google.com/calendar/r?authuser=me%40example.com',
  );
});

test('Scheduled seed items are all due on a fresh install; productivity items have no bucket', () => {
  const now = tokyo('2026-10-12T09:00');
  for (const item of SEED.items) {
    assert.equal(bucket(item, [], now, 'Asia/Tokyo'), item.schedule ? 'due' : null, item.id);
  }
});

test('The seed is frozen so shared consumers cannot corrupt it', () => {
  assert.ok(Object.isFrozen(SEED));
  assert.ok(Object.isFrozen(SEED.items));
  assert.ok(Object.isFrozen(SEED.items[0]));
  assert.ok(Object.isFrozen(SEED.items[0].edge));
});

test('config/seed.local.json (git-ignored, personal) parses and every item passes validateItem', (t) => {
  const path = new URL('../../config/seed.local.json', import.meta.url);
  if (!existsSync(path)) {
    t.skip('config/seed.local.json is absent');
    return;
  }
  const local = JSON.parse(readFileSync(path, 'utf8'));
  for (const key of ['workspaces', 'groups', 'items']) assert.ok(Array.isArray(local[key]), key);
  assert.equal(typeof local.settings.timezone, 'string');
  for (const item of local.items) {
    assert.deepEqual(validateItem(item, { groups: local.groups }), [], item.id);
  }
});

test('index.js exports the whole public API', () => {
  const expected = [
    'localParts', 'effectiveDay', 'addDays', 'daysInMonth', 'isoWeekday', 'isValidDate', 'parseHHMM',
    'periodKey', 'nextPeriodStart', 'bucket', 'nextDue',
    'expandUrl', 'TOKENS',
    'validateItem', 'effectiveSleep', 'effectiveEdge', 'moveItem',
    'reorder', 'mergeLww', 'SEED',
  ];
  for (const name of expected) assert.ok(name in core, name);
  for (const name of expected.filter((n) => n !== 'SEED' && n !== 'TOKENS')) {
    assert.equal(typeof (/** @type {Record<string, unknown>} */ (core))[name], 'function', name);
  }
});

test('Every example item carries the default user-agent preset', () => {
  for (const item of SEED.items) assert.deepEqual(item.userAgent, { preset: 'default', custom: null }, item.id);
});