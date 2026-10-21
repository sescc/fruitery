// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveBadge } from '../lib/badge.js';

test('a leading (n) is the count', () => {
  assert.equal(deriveBadge('(3) Inbox'), 3);
  assert.equal(deriveBadge('(4) Inbox - Mail'), 4);
  assert.equal(deriveBadge('  (12)Chat'), 12);
  assert.equal(deriveBadge('(0)'), 0);
});

test('no leading count -> null', () => {
  assert.equal(deriveBadge('Inbox'), null);
  assert.equal(deriveBadge('Inbox (3)'), null);
  assert.equal(deriveBadge(''), null);
});

test('garbage -> null', () => {
  assert.equal(deriveBadge('(x) Inbox'), null);
  assert.equal(deriveBadge('(-1) Inbox'), null);
  assert.equal(deriveBadge('(3+) Inbox'), null);
  assert.equal(deriveBadge('(1234567890123) x'), null);
  assert.equal(deriveBadge(undefined), null);
  assert.equal(deriveBadge(null), null);
  assert.equal(deriveBadge(42), null);
});
