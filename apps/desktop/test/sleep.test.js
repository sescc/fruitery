// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueToSleep } from '../lib/sleep.js';

const MIN = 60_000;
/** @param {string} id @param {number} sleepAfterMin */
const ws = (id, sleepAfterMin) => /** @type {any} */ ({ id, sleepAfterMin, deleted: false });
/** @param {string} id @param {string} workspaceId @param {number | null} [sleepAfterMin] */
const item = (id, workspaceId, sleepAfterMin = null) => /** @type {any} */ ({ id, workspaceId, sleepAfterMin, deleted: false });
/** @param {string} itemId @param {number | null} hiddenSince */
const view = (itemId, hiddenSince) => ({ itemId, awake: true, hiddenSince });

const workspaces = [ws('daily', 10), ws('prod', 0)];
const items = [item('d1', 'daily'), item('p1', 'prod'), item('d2', 'daily', 30), item('p2', 'prod', 5)];
const now = 1_000_000_000_000;

test('a hidden item sleeps once its own workspace minutes have passed', () => {
  assert.deepEqual(dueToSleep([view('d1', now - 11 * MIN)], items, workspaces, now), ['d1']);
  assert.deepEqual(dueToSleep([view('d1', now - 10 * MIN)], items, workspaces, now), ['d1']);
  assert.deepEqual(dueToSleep([view('d1', now - 9 * MIN)], items, workspaces, now), []);
});

test('an effective value of 0 never sleeps', () => {
  assert.deepEqual(dueToSleep([view('p1', now - 3 * 60 * MIN)], items, workspaces, now), []);
});

test('a visible view (hiddenSince null) never sleeps', () => {
  assert.deepEqual(dueToSleep([view('d1', null)], items, workspaces, now), []);
});

test('an item of another workspace shown in a split uses its own workspace default once hidden', () => {
  // d1 belongs to Daily (10 min). It was shown in the Productivity workspace; hidden for 11 min -> sleeps.
  assert.deepEqual(dueToSleep([view('d1', now - 11 * MIN)], items, workspaces, now), ['d1']);
  // while it stays visible (hiddenSince null) it does not, however long
  assert.deepEqual(dueToSleep([view('d1', null)], items, workspaces, now + 3 * 60 * MIN), []);
});

test('the item override beats the workspace in both directions', () => {
  // d2: 30 min override on a 10 min workspace
  assert.deepEqual(dueToSleep([view('d2', now - 20 * MIN)], items, workspaces, now), []);
  assert.deepEqual(dueToSleep([view('d2', now - 31 * MIN)], items, workspaces, now), ['d2']);
  // p2: 5 min override on a never-sleeping workspace
  assert.deepEqual(dueToSleep([view('p2', now - 6 * MIN)], items, workspaces, now), ['p2']);
  // an explicit 0 override on a sleeping workspace means never
  const zero = [item('d3', 'daily', 0)];
  assert.deepEqual(dueToSleep([view('d3', now - 999 * MIN)], zero, workspaces, now), []);
});

test('views that are asleep, or whose item or workspace is gone, are skipped', () => {
  const asleep = { itemId: 'd1', awake: false, hiddenSince: now - 99 * MIN };
  assert.deepEqual(dueToSleep([asleep, view('ghost', now - 99 * MIN)], items, workspaces, now), []);
  const orphan = [item('o1', 'nowhere')];
  assert.deepEqual(dueToSleep([view('o1', now - 99 * MIN)], orphan, workspaces, now), []);
});

test('several due views are all returned, in view order', () => {
  const out = dueToSleep([view('d1', now - 11 * MIN), view('p1', now - 99 * MIN), view('d2', now - 31 * MIN)], items, workspaces, now);
  assert.deepEqual(out, ['d1', 'd2']);
});
