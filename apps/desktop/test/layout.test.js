// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaf, leaves, split, close, setItem, resize, rects, validate, nextPaneId, pruneItems, findItem } from '../lib/layout.js';

/** @param {any} r */
const treeOf = (r) => {
  assert.ok(r.tree, JSON.stringify(r));
  return r.tree;
};

test('split right and down build a row / col node and keep item ids', () => {
  const one = leaf('p1', 'a');
  const right = split(one, 'p1', 'row', 'p2', 'b');
  assert.deepEqual(treeOf(right), { type: 'split', dir: 'row', ratio: 0.5, a: leaf('p1', 'a'), b: leaf('p2', 'b') });
  const down = split(treeOf(right), 'p2', 'col', 'p3', null);
  const t = treeOf(down);
  assert.equal(leaves(t).length, 3);
  assert.deepEqual(leaves(t).map((l) => l.paneId), ['p1', 'p2', 'p3']);
  assert.equal(t.b.dir, 'col');
});

test('split with side before puts the new pane first (drop on the left / top edge)', () => {
  const t = treeOf(split(leaf('p1', 'a'), 'p1', 'row', 'p2', 'b', 'before'));
  assert.deepEqual(leaves(t).map((l) => l.paneId), ['p2', 'p1']);
});

test('the input tree is never mutated', () => {
  const one = Object.freeze(leaf('p1', 'a'));
  split(one, 'p1', 'row', 'p2', 'b');
  assert.deepEqual(one, leaf('p1', 'a'));
});

test('a fifth leaf is refused and the tree is unchanged', () => {
  let t = /** @type {any} */ (leaf('p1', 'a'));
  for (const n of [2, 3, 4]) t = treeOf(split(t, 'p1', 'row', `p${n}`, `i${n}`));
  assert.equal(leaves(t).length, 4);
  assert.deepEqual(split(t, 'p1', 'col', 'p5', 'i5'), { error: 'max-panes' });
});

test('splitting with an unknown pane or a reused pane id is an error', () => {
  const t = leaf('p1', 'a');
  assert.deepEqual(split(t, 'nope', 'row', 'p2', null), { error: 'unknown-pane' });
  assert.deepEqual(split(t, 'p1', 'row', 'p1', null), { error: 'duplicate-pane-id' });
});

test('an item already in another pane -> focus that pane, no second copy (split and setItem)', () => {
  const t = treeOf(split(leaf('p1', 'a'), 'p1', 'row', 'p2', 'b'));
  assert.deepEqual(split(t, 'p2', 'col', 'p3', 'a'), { focus: 'p1' });
  assert.deepEqual(setItem(t, 'p2', 'a'), { focus: 'p1' });
  // the same item into its own pane is a no-op, not a focus jump
  assert.deepEqual(treeOf(setItem(t, 'p1', 'a')), t);
});

test('setItem replaces the item of a pane and can empty it', () => {
  const t = treeOf(split(leaf('p1', 'a'), 'p1', 'row', 'p2', 'b'));
  const t2 = treeOf(setItem(t, 'p2', 'c'));
  assert.equal(findItem(t2, 'c')?.paneId, 'p2');
  assert.equal(findItem(t2, 'b'), null);
  assert.equal(leaves(treeOf(setItem(t2, 'p2', null)))[1].itemId, null);
  assert.deepEqual(setItem(t, 'zz', 'c'), { error: 'unknown-pane' });
});

test('closing a pane collapses into its sibling; the last leaf cannot be closed', () => {
  const t = treeOf(split(leaf('p1', 'a'), 'p1', 'row', 'p2', 'b'));
  assert.deepEqual(treeOf(close(t, 'p2')), leaf('p1', 'a'));
  assert.deepEqual(treeOf(close(t, 'p1')), leaf('p2', 'b'));
  assert.deepEqual(close(leaf('p1', 'a'), 'p1'), { error: 'last-pane' });
  assert.deepEqual(close(t, 'zz'), { error: 'unknown-pane' });
});

test('closing a nested pane keeps the rest of the tree', () => {
  let t = /** @type {any} */ (leaf('p1', 'a'));
  t = treeOf(split(t, 'p1', 'row', 'p2', 'b'));
  t = treeOf(split(t, 'p2', 'col', 'p3', 'c'));
  const c = treeOf(close(t, 'p3'));
  assert.deepEqual(leaves(c).map((l) => l.paneId), ['p1', 'p2']);
  assert.equal(c.dir, 'row');
});

test('resize clamps to 0.1..0.9 and rejects a bad path', () => {
  const t = treeOf(split(leaf('p1', 'a'), 'p1', 'row', 'p2', 'b'));
  assert.equal(treeOf(resize(t, [], 0.02)).ratio, 0.1);
  assert.equal(treeOf(resize(t, [], 5)).ratio, 0.9);
  assert.equal(treeOf(resize(t, [], 0.3)).ratio, 0.3);
  assert.equal(treeOf(resize(t, [], NaN)).ratio, 0.5);
  assert.deepEqual(resize(t, ['a'], 0.3), { error: 'bad-path' });
  assert.deepEqual(resize(leaf('p1'), [], 0.3), { error: 'bad-path' });
});

test('resize reaches a nested split by path', () => {
  let t = /** @type {any} */ (leaf('p1', 'a'));
  t = treeOf(split(t, 'p1', 'row', 'p2', 'b'));
  t = treeOf(split(t, 'p2', 'col', 'p3', 'c'));
  const r = treeOf(resize(t, ['b'], 0.25));
  assert.equal(r.b.ratio, 0.25);
  assert.equal(r.ratio, 0.5);
});

test('rects: pane sizes plus dividers add up to the box exactly (odd sizes, nesting)', () => {
  let t = /** @type {any} */ (leaf('p1', 'a'));
  t = treeOf(split(t, 'p1', 'row', 'p2', 'b'));
  t = treeOf(split(t, 'p2', 'col', 'p3', 'c'));
  t = treeOf(split(t, 'p1', 'col', 'p4', 'd'));
  t = treeOf(resize(t, [], 0.37));
  const box = { x: 10, y: 20, w: 1001, h: 777 };
  const { panes, dividers } = rects(t, box);
  assert.equal(panes.length, 4);
  assert.equal(dividers.length, 3);
  const area = panes.reduce((s, p) => s + p.w * p.h, 0) + dividers.reduce((s, d) => s + d.w * d.h, 0);
  assert.equal(area, box.w * box.h);
  for (const p of panes) {
    assert.ok(p.x >= box.x && p.y >= box.y && p.x + p.w <= box.x + box.w && p.y + p.h <= box.y + box.h);
    assert.ok(p.w >= 0 && p.h >= 0);
  }
  // no overlap between panes
  for (const a of panes) for (const b of panes) {
    if (a === b) continue;
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.equal(overlap, false);
  }
});

test('rects: a single pane fills the box, and a row split leaves a 4px divider', () => {
  const box = { x: 0, y: 0, w: 100, h: 50 };
  assert.deepEqual(rects(leaf('p1', 'a'), box).panes, [{ ...box, paneId: 'p1', itemId: 'a' }]);
  const t = treeOf(split(leaf('p1', 'a'), 'p1', 'row', 'p2', 'b'));
  const { panes, dividers } = rects(t, box);
  assert.equal(panes[0].w + panes[1].w, 96);
  assert.equal(dividers[0].w, 4);
  assert.equal(panes[1].x, panes[0].w + 4);
  assert.deepEqual(dividers[0].path, []);
  assert.deepEqual(dividers[0].parent, box);
});

test('validate accepts good trees and rejects malformed ones', () => {
  assert.deepEqual(validate(leaf('p1', null)), { ok: true });
  assert.deepEqual(validate(treeOf(split(leaf('p1', 'a'), 'p1', 'row', 'p2', 'b'))), { ok: true });
  const bad = [
    null,
    42,
    { type: 'leaf', paneId: '', itemId: null },
    { type: 'leaf', paneId: 'p1', itemId: 3 },
    { type: 'leaf', paneId: 'p1' },
    { type: 'blob' },
    { type: 'split', dir: 'diag', ratio: 0.5, a: leaf('p1'), b: leaf('p2') },
    { type: 'split', dir: 'row', ratio: 0.95, a: leaf('p1'), b: leaf('p2') },
    { type: 'split', dir: 'row', ratio: 0.5, a: leaf('p1'), b: null },
    { type: 'split', dir: 'row', ratio: 0.5, a: leaf('p1', 'x'), b: leaf('p1', 'y') },
    { type: 'split', dir: 'row', ratio: 0.5, a: leaf('p1', 'x'), b: leaf('p2', 'x') },
  ];
  for (const b of bad) assert.equal(validate(b).ok, false, JSON.stringify(b));
  // five leaves
  const five = /** @type {any} */ ({
    type: 'split', dir: 'row', ratio: 0.5,
    a: { type: 'split', dir: 'row', ratio: 0.5, a: leaf('p1'), b: leaf('p2') },
    b: { type: 'split', dir: 'row', ratio: 0.5, a: { type: 'split', dir: 'row', ratio: 0.5, a: leaf('p3'), b: leaf('p4') }, b: leaf('p5') },
  });
  assert.deepEqual(validate(five), { ok: false, error: 'max-panes' });
});

test('nextPaneId skips used ids; pruneItems empties panes of vanished items', () => {
  const t = treeOf(split(leaf('p1', 'a'), 'p1', 'row', 'p3', 'b'));
  assert.equal(nextPaneId(t), 'p2');
  const p = pruneItems(t, (id) => id === 'a');
  assert.equal(findItem(p, 'b'), null);
  assert.equal(findItem(p, 'a')?.paneId, 'p1');
});
