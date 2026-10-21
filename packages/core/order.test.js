// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reorder } from './order.js';

/** @param {number} n */
const make = (n) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, order: i, updatedAt: 100, name: `n${i}` }));
/** @param {{id: string}[]} list */
const ids = (list) => list.map((e) => e.id);

test('Move to the top: the third of four items moved to position 0', () => {
  const out = reorder(make(4), 'e2', 0, 5000);
  assert.deepEqual(ids(out), ['e2', 'e0', 'e1', 'e3']);
  assert.deepEqual(out.map((e) => e.order), [0, 1, 2, 3]);
});

test('Move to the end', () => {
  const out = reorder(make(4), 'e0', 3, 5000);
  assert.deepEqual(ids(out), ['e1', 'e2', 'e3', 'e0']);
  assert.deepEqual(out.map((e) => e.order), [0, 1, 2, 3]);
});

test('Move to the middle shifts only the siblings in between', () => {
  const out = reorder(make(5), 'e0', 2, 5000);
  assert.deepEqual(ids(out), ['e1', 'e2', 'e0', 'e3', 'e4']);
  assert.deepEqual(out.map((e) => e.updatedAt), [5000, 5000, 5000, 100, 100]);
});

test('Target position out of range: 99 in a list of four makes it the last item', () => {
  const out = reorder(make(4), 'e1', 99, 5000);
  assert.deepEqual(ids(out), ['e0', 'e2', 'e3', 'e1']);
  assert.deepEqual(out.map((e) => e.order), [0, 1, 2, 3]);
});

test('A negative or NaN target position clamps to the top', () => {
  assert.deepEqual(ids(reorder(make(4), 'e3', -7, 5000)), ['e3', 'e0', 'e1', 'e2']);
  assert.deepEqual(ids(reorder(make(4), 'e3', NaN, 5000)), ['e3', 'e0', 'e1', 'e2']);
  assert.deepEqual(ids(reorder(make(4), 'e0', Infinity, 5000)), ['e1', 'e2', 'e3', 'e0']);
});

test('Unknown id returns unchanged shallow copies', () => {
  const input = make(3);
  const out = reorder(input, 'nope', 0, 5000);
  assert.deepEqual(out, input);
  assert.notEqual(out, input);
  out.forEach((e, i) => assert.notEqual(e, input[i]));
});

test('Only entities whose order changed get the new updatedAt', () => {
  const out = reorder(make(5), 'e3', 4, 5000); // e3 and e4 swap
  const byId = Object.fromEntries(out.map((e) => [e.id, e]));
  assert.equal(byId.e0.updatedAt, 100);
  assert.equal(byId.e1.updatedAt, 100);
  assert.equal(byId.e2.updatedAt, 100);
  assert.equal(byId.e3.updatedAt, 5000);
  assert.equal(byId.e4.updatedAt, 5000);
});

test('Moving an item to its current position changes nothing', () => {
  const out = reorder(make(4), 'e2', 2, 5000);
  assert.deepEqual(out, make(4));
});

test('Gaps and ties in the input order are re-densified; only moved orders are bumped', () => {
  const sparse = [
    { id: 'a', order: 0, updatedAt: 1 },
    { id: 'b', order: 5, updatedAt: 1 },
    { id: 'c', order: 5, updatedAt: 1 },
    { id: 'd', order: 9, updatedAt: 1 },
  ];
  const out = reorder(sparse, 'd', 0, 77);
  assert.deepEqual(out.map((e) => [e.id, e.order, e.updatedAt]), [
    ['d', 0, 77],
    ['a', 1, 77],
    ['b', 2, 77],
    ['c', 3, 77],
  ]);
});

test('Other fields are preserved and a single sibling stays put', () => {
  const out = reorder(make(1), 'e0', 5, 5000);
  assert.deepEqual(out, make(1));
});

test('Input arrays and entities are not mutated', () => {
  const input = make(4);
  const copy = structuredClone(input);
  const out = reorder(input, 'e3', 0, 5000);
  assert.deepEqual(input, copy);
  out.forEach((e) => assert.ok(!input.includes(e)));
});

test('An empty list is returned empty', () => {
  assert.deepEqual(reorder([], 'x', 0, 1), []);
});
