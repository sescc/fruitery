// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removalPlan } from './removal.js';
import { SEED } from './seed.js';
import * as core from './index.js';

const NOW = 1_800_000_000_000;

/** @returns {any} a mutable deep copy of the example dataset */
function snap() {
  return structuredClone(SEED);
}

/** @param {any} plan */
function changedIds(plan) {
  const c = plan.changed;
  return { workspaces: c.workspaces.map((/** @type {any} */ e) => e.id).sort(), groups: c.groups.map((/** @type {any} */ e) => e.id).sort(), items: c.items.map((/** @type {any} */ e) => e.id).sort() };
}

test('removalPlan is exported from the package entry point', () => {
  assert.equal(core.removalPlan, removalPlan);
});

test('Item deletion marks only that item', () => {
  const s = snap();
  const plan = /** @type {any} */ (removalPlan(s, 'item', 'it-word-game', NOW));
  assert.deepEqual(changedIds(plan), { workspaces: [], groups: [], items: ['it-word-game'] });
  const item = plan.changed.items[0];
  assert.equal(item.deleted, true);
  assert.equal(item.updatedAt, NOW);
  assert.equal(item.name, 'Word game', 'every other field is kept');
  assert.deepEqual(item.edge, s.items.find((/** @type {any} */ i) => i.id === 'it-word-game').edge);
});

test('Group deletion keeps items: the group is marked deleted, its items become ungrouped with a new update time', () => {
  const s = snap();
  const inGames = s.items.filter((/** @type {any} */ i) => i.groupId === 'g-fun').map((/** @type {any} */ i) => i.id).sort();
  assert.ok(inGames.length >= 2);
  const plan = /** @type {any} */ (removalPlan(s, 'group', 'g-fun', NOW));
  assert.deepEqual(changedIds(plan), { workspaces: [], groups: ['g-fun'], items: inGames });
  assert.equal(plan.changed.groups[0].deleted, true);
  assert.equal(plan.changed.groups[0].updatedAt, NOW);
  for (const i of plan.changed.items) {
    assert.equal(i.groupId, null);
    assert.equal(i.deleted, false, 'items are kept, not deleted');
    assert.equal(i.updatedAt, NOW);
  }
});

test('Workspace deletion cascades: the workspace, its groups and its items are all marked deleted', () => {
  const s = snap();
  const items = s.items.filter((/** @type {any} */ i) => i.workspaceId === 'ws-daily').map((/** @type {any} */ i) => i.id).sort();
  const plan = /** @type {any} */ (removalPlan(s, 'workspace', 'ws-daily', NOW));
  assert.deepEqual(changedIds(plan), { workspaces: ['ws-daily'], groups: ['g-fun', 'g-perks', 'g-study'], items });
  for (const e of [...plan.changed.workspaces, ...plan.changed.groups, ...plan.changed.items]) {
    assert.equal(e.deleted, true);
    assert.equal(e.updatedAt, NOW);
  }
  // the other workspace's items are untouched
  assert.equal(plan.changed.items.some((/** @type {any} */ i) => i.workspaceId === 'ws-productivity'), false);
});

test('Last workspace refused: nothing changes', () => {
  const s = snap();
  s.workspaces.find((/** @type {any} */ w) => w.id === 'ws-daily').deleted = true;
  assert.deepEqual(removalPlan(s, 'workspace', 'ws-productivity', NOW), { error: 'last-workspace' });
  const one = snap();
  one.workspaces = one.workspaces.slice(0, 1);
  assert.deepEqual(removalPlan(one, 'workspace', one.workspaces[0].id, NOW), { error: 'last-workspace' });
});

test('Unknown ids, unknown kinds and already-deleted entities are not-found', () => {
  const s = snap();
  for (const kind of /** @type {const} */ (['item', 'group', 'workspace'])) {
    assert.deepEqual(removalPlan(s, kind, 'nope', NOW), { error: 'not-found' }, kind);
  }
  assert.deepEqual(removalPlan(s, /** @type {any} */ ('thing'), 'it-word-game', NOW), { error: 'not-found' });
  s.items.find((/** @type {any} */ i) => i.id === 'it-word-game').deleted = true;
  assert.deepEqual(removalPlan(s, 'item', 'it-word-game', NOW), { error: 'not-found' });
  s.groups.find((/** @type {any} */ g) => g.id === 'g-fun').deleted = true;
  assert.deepEqual(removalPlan(s, 'group', 'g-fun', NOW), { error: 'not-found' });
});

test('Already-deleted entities are ignored: not changed again, and not counted for the last-workspace rule', () => {
  const s = snap();
  s.items.find((/** @type {any} */ i) => i.id === 'it-word-game').deleted = true;
  s.groups.find((/** @type {any} */ g) => g.id === 'g-perks').deleted = true;
  const group = /** @type {any} */ (removalPlan(s, 'group', 'g-fun', NOW));
  assert.equal(group.changed.items.some((/** @type {any} */ i) => i.id === 'it-word-game'), false, 'a deleted item of the group is left alone');
  const ws = /** @type {any} */ (removalPlan(s, 'workspace', 'ws-daily', NOW));
  assert.equal(ws.changed.groups.some((/** @type {any} */ g) => g.id === 'g-perks'), false);
  assert.equal(ws.changed.items.some((/** @type {any} */ i) => i.id === 'it-word-game'), false);
});

test('Inputs are not mutated and results do not share objects with them', () => {
  const s = snap();
  const before = JSON.stringify(s);
  for (const [kind, id] of /** @type {const} */ ([['item', 'it-word-game'], ['group', 'g-fun'], ['workspace', 'ws-daily']])) {
    const plan = /** @type {any} */ (removalPlan(s, kind, id, NOW));
    assert.equal(JSON.stringify(s), before, kind);
    for (const e of [...plan.changed.workspaces, ...plan.changed.groups, ...plan.changed.items]) {
      const original = [...s.workspaces, ...s.groups, ...s.items].find((/** @type {any} */ o) => o.id === e.id);
      assert.notEqual(e, original);
      if (e.edge) assert.notEqual(e.edge, original.edge);
    }
  }
  // frozen input (the example SEED) works too
  assert.ok('changed' in removalPlan(SEED, 'item', 'it-word-game', NOW));
});

test('Every changed entity is stamped with the deletion time, and only changed entities are returned', () => {
  const s = snap();
  const plan = /** @type {any} */ (removalPlan(s, 'workspace', 'ws-productivity', NOW));
  const all = [...plan.changed.workspaces, ...plan.changed.groups, ...plan.changed.items];
  assert.ok(all.length > 0);
  assert.ok(all.every((/** @type {any} */ e) => e.updatedAt === NOW));
  assert.equal(plan.changed.groups.length, 0, 'the Productivity workspace has no groups');
  assert.equal(plan.changed.items.length, s.items.filter((/** @type {any} */ i) => i.workspaceId === 'ws-productivity').length);
});
