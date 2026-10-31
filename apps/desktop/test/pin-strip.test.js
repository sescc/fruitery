// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinStripLayout, STRIP_BODY_PX, STRIP_HEADER_PX, MIN_LIST_PX, MIN_STRIP_BODY_PX } from '../lib/pin-strip.js';

test('no pin: the whole column is the list', () => {
  assert.deepEqual(pinStripLayout(600, { pinned: false, collapsed: false }), { listHeight: 600, headerHeight: 0, bodyHeight: 0 });
});

test('pinned and expanded: header + body reserved, list gets the rest', () => {
  const r = pinStripLayout(600, { pinned: true, collapsed: false });
  assert.equal(r.headerHeight, STRIP_HEADER_PX);
  assert.equal(r.bodyHeight, STRIP_BODY_PX);
  assert.equal(r.listHeight, 600 - STRIP_HEADER_PX - STRIP_BODY_PX);
  assert.equal(r.listHeight + r.headerHeight + r.bodyHeight, 600);
});

test('pinned and collapsed: only the header is reserved', () => {
  const r = pinStripLayout(600, { pinned: true, collapsed: true });
  assert.deepEqual(r, { listHeight: 600 - STRIP_HEADER_PX, headerHeight: STRIP_HEADER_PX, bodyHeight: 0 });
});

test('a short column keeps at least MIN_LIST_PX of list, shrinking the body', () => {
  // room for the body = col - header - MIN_LIST_PX
  const col = STRIP_HEADER_PX + MIN_LIST_PX + (MIN_STRIP_BODY_PX + 10);
  const r = pinStripLayout(col, { pinned: true, collapsed: false });
  assert.equal(r.bodyHeight, MIN_STRIP_BODY_PX + 10);
  assert.equal(r.listHeight, MIN_LIST_PX);
});

test('too short for a usable body: header only, no body', () => {
  const col = STRIP_HEADER_PX + MIN_LIST_PX + (MIN_STRIP_BODY_PX - 1);
  const r = pinStripLayout(col, { pinned: true, collapsed: false });
  assert.equal(r.bodyHeight, 0);
  assert.equal(r.headerHeight, STRIP_HEADER_PX);
  assert.equal(r.listHeight, col - STRIP_HEADER_PX);
});

test('a custom body height is honoured but clamped to the available room', () => {
  assert.equal(pinStripLayout(1000, { pinned: true, collapsed: false, bodyPx: 120 }).bodyHeight, 120);
  // a huge request is clamped so the list still keeps MIN_LIST_PX
  const r = pinStripLayout(600, { pinned: true, collapsed: false, bodyPx: 100000 });
  assert.equal(r.listHeight, MIN_LIST_PX);
  assert.equal(r.bodyHeight, 600 - STRIP_HEADER_PX - MIN_LIST_PX);
});

test('a zero or invalid column is handled', () => {
  assert.deepEqual(pinStripLayout(0, { pinned: true, collapsed: false }), { listHeight: 0, headerHeight: 0, bodyHeight: 0 });
  assert.deepEqual(pinStripLayout(/** @type {any} */ (NaN), { pinned: false, collapsed: false }), { listHeight: 0, headerHeight: 0, bodyHeight: 0 });
});
