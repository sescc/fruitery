// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLww } from './sync.js';
import { mulberry32 } from './fixtures.js';

/**
 * @param {string} id
 * @param {string} name
 * @param {number} updatedAt
 * @param {boolean} [deleted]
 */
const ent = (id, name, updatedAt, deleted = false) => ({ id, name, updatedAt, deleted });

const T = (/** @type {string} */ hhmm) => Date.parse(`2026-10-12T${hhmm}:00Z`);

test('Newer edit wins: PC 1 renamed at 10:00, PC 2 at 10:05 -> PC 2 name on both merge orders', () => {
  const pc1 = [ent('i1', 'From PC1', T('10:00'))];
  const pc2 = [ent('i1', 'From PC2', T('10:05'))];
  assert.deepEqual(mergeLww(pc1, pc2), pc2);
  assert.deepEqual(mergeLww(pc2, pc1), pc2);
});

test('Stale deletion loses: deleted at 09:00 on one device, edited at 09:30 on another -> item exists with the 09:30 edit', () => {
  const tombstone = [ent('i1', 'Old', T('09:00'), true)];
  const edited = [ent('i1', 'Edited', T('09:30'))];
  for (const merged of [mergeLww(tombstone, edited), mergeLww(edited, tombstone)]) {
    assert.deepEqual(merged, edited);
    assert.equal(merged[0].deleted, false);
  }
});

test('A newer tombstone wins over an older edit', () => {
  const edited = [ent('i1', 'Edited', T('09:00'))];
  const tombstone = [ent('i1', 'Edited', T('09:30'), true)];
  assert.deepEqual(mergeLww(edited, tombstone), tombstone);
  assert.deepEqual(mergeLww(tombstone, edited), tombstone);
});

test('Tie on updatedAt is broken deterministically (greater canonical JSON), in either order', () => {
  const a = ent('i1', 'alpha', 1000);
  const b = ent('i1', 'bravo', 1000);
  assert.deepEqual(mergeLww([a], [b]), [b]);
  assert.deepEqual(mergeLww([b], [a]), [b]);
  // key order inside the object does not influence the tie-break
  const reordered = { updatedAt: 1000, deleted: false, name: 'alpha', id: 'i1' };
  assert.deepEqual(mergeLww([reordered], [b]), [b]);
  assert.deepEqual(mergeLww([b], [reordered]), [b]);
});

test('Entities present on one side only are kept; output is sorted by id', () => {
  const out = mergeLww([ent('c', 'C', 1), ent('a', 'A', 1)], [ent('d', 'D', 1), ent('b', 'B', 1)]);
  assert.deepEqual(out.map((e) => e.id), ['a', 'b', 'c', 'd']);
});

test('Settings (no id) merge under the fixed id "settings" by updatedAt', () => {
  const older = { timezone: 'Asia/Tokyo', googleEmail: null, updatedAt: 10 };
  const newer = { timezone: 'Asia/Tokyo', googleEmail: 'me@example.com', updatedAt: 20 };
  assert.deepEqual(mergeLww([older], [newer]), [newer]);
  assert.deepEqual(mergeLww([newer], [older]), [newer]);
});

test('Merging with an empty snapshot returns the same content, and inputs are not mutated', () => {
  const a = [ent('b', 'B', 2), ent('a', 'A', 1)];
  const copy = structuredClone(a);
  const out = mergeLww(a, []);
  assert.deepEqual(out, [ent('a', 'A', 1), ent('b', 'B', 2)]);
  assert.deepEqual(a, copy);
  assert.notEqual(out, a);
});

test('Duplicate ids inside one snapshot collapse to the winner', () => {
  const out = mergeLww([ent('a', 'old', 1), ent('a', 'new', 2)], []);
  assert.deepEqual(out, [ent('a', 'new', 2)]);
});

// ---- Requirement: order of merging is irrelevant (randomized, seeded) ---------------------------

test('Order of merging is irrelevant: commutative, associative and idempotent over 250 random snapshots', () => {
  const rand = mulberry32(20261012);
  const pick = (/** @type {number} */ n) => Math.floor(rand() * n);
  const names = ['alpha', 'bravo', 'charlie', 'delta'];
  const snapshot = () =>
    Array.from({ length: pick(8) }, () => ({
      id: `e${pick(6)}`, // small id pool -> frequent collisions
      name: names[pick(names.length)],
      order: pick(4),
      updatedAt: pick(4), // small range -> frequent ties
      deleted: rand() < 0.3,
    }));
  for (let i = 0; i < 250; i++) {
    const a = snapshot();
    const b = snapshot();
    const c = snapshot();
    const label = `case ${i}`;
    const ab = mergeLww(a, b);
    assert.deepEqual(ab, mergeLww(b, a), `${label}: commutative`);
    assert.deepEqual(mergeLww(ab, c), mergeLww(a, mergeLww(b, c)), `${label}: associative`);
    assert.deepEqual(mergeLww(a, a), mergeLww(a, []), `${label}: idempotent (a with itself)`);
    assert.deepEqual(mergeLww(ab, b), ab, `${label}: idempotent (re-merging)`);
    assert.deepEqual(mergeLww(ab, ab), ab, `${label}: idempotent (self-merge)`);
    // any permutation of three snapshots gives one result
    const abc = mergeLww(mergeLww(a, b), c);
    assert.deepEqual(mergeLww(mergeLww(c, a), b), abc, `${label}: permutation`);
    assert.deepEqual(mergeLww(mergeLww(b, c), a), abc, `${label}: permutation`);
    // sorted by id, no duplicate ids
    const outIds = abc.map((e) => e.id);
    assert.deepEqual(outIds, [...outIds].sort(), `${label}: sorted`);
    assert.equal(new Set(outIds).size, outIds.length, `${label}: unique ids`);
  }
});

test('Order of merging is irrelevant: three device snapshots merged in any order, any number of times', () => {
  const d1 = [ent('i1', 'one', 10), ent('i2', 'two', 30, true)];
  const d2 = [ent('i1', 'uno', 20), ent('i2', 'dos', 25)];
  const d3 = [ent('i3', 'tres', 5)];
  const expected = mergeLww(mergeLww(d1, d2), d3);
  const orders = [
    [d1, d2, d3],
    [d1, d3, d2],
    [d2, d1, d3],
    [d2, d3, d1],
    [d3, d1, d2],
    [d3, d2, d1],
  ];
  for (const [x, y, z] of orders) {
    assert.deepEqual(mergeLww(mergeLww(x, y), z), expected);
    assert.deepEqual(mergeLww(mergeLww(mergeLww(x, y), z), mergeLww(x, y)), expected);
  }
  assert.deepEqual(expected, [ent('i1', 'uno', 20), ent('i2', 'two', 30, true), ent('i3', 'tres', 5)]);
});
