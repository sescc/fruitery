// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampListWidth, sanitizeListWidth, DEFAULT_LIST_WIDTH } from '../lib/list-width.js';

test('clampListWidth: within 180..600 on a wide window, rounded', () => {
  assert.equal(clampListWidth(300.4, 1600, 56), 300);
  assert.equal(clampListWidth(10, 1600, 56), 180);
  assert.equal(clampListWidth(5000, 1600, 56), 600);
});

test('clampListWidth: the pane area keeps at least 320 px', () => {
  // 1000 - 56 - 320 = 624 -> capped at 600; 800 - 56 - 320 = 424
  assert.equal(clampListWidth(600, 1000, 56), 600);
  assert.equal(clampListWidth(600, 800, 56), 424);
  assert.equal(1000 - 56 - clampListWidth(900, 1000, 56) >= 320, true);
});

test('clampListWidth: a tiny window never goes below the 180 px minimum', () => {
  assert.equal(clampListWidth(400, 500, 56), 180);
  assert.equal(clampListWidth(400, 0, 56), 180);
});

test('clampListWidth: junk falls back to the default (then clamped)', () => {
  for (const bad of [NaN, Infinity, null, undefined, '300', {}]) assert.equal(clampListWidth(bad, 1600, 56), DEFAULT_LIST_WIDTH);
  assert.equal(clampListWidth(300, NaN, NaN), 300);
});

test('sanitizeListWidth: finite numbers are kept within 180..600, anything else is the fallback', () => {
  assert.equal(sanitizeListWidth(333.6), 334);
  assert.equal(sanitizeListWidth(1), 180);
  assert.equal(sanitizeListWidth(9999), 600);
  for (const bad of [NaN, -Infinity, null, undefined, '300', [], {}]) assert.equal(sanitizeListWidth(bad), 270);
  assert.equal(sanitizeListWidth('x', 250), 250);
});
