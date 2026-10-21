// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageMenuModel, pageEdgeProfile } from '../lib/page-menu.js';
import { createReturnTracker } from '../lib/return-tracker.js';

const ids = (/** @type {any[]} */ m) => m.map((e) => (e.type === 'separator' ? '-' : e.id));

test('page menu: plain page offers Back, Forward, Reload, Copy page address, Open page in Edge', () => {
  const m = pageMenuModel({ canGoBack: true, canGoForward: false, pageUrl: 'https://example.com/a' });
  assert.deepEqual(ids(m), ['back', 'forward', 'reload', '-', 'copy-address', 'open-edge']);
  const by = (/** @type {string} */ id) => /** @type {any} */ (m.find((e) => 'id' in e && e.id === id));
  assert.equal(by('back').enabled, true);
  assert.equal(by('forward').enabled, false);
  assert.equal(by('reload').enabled, true);
  assert.equal(by('back').accelerator, 'Alt+Left');
  assert.equal(by('reload').accelerator, 'F5');
});

test('page menu: no history means Back and Forward are unavailable', () => {
  const m = /** @type {any[]} */ (pageMenuModel({ pageUrl: 'https://example.com/' }));
  assert.equal(m.find((e) => e.id === 'back').enabled, false);
  assert.equal(m.find((e) => e.id === 'forward').enabled, false);
});

test('page menu: a link adds Copy link address, a selection adds Copy, both come first', () => {
  const link = pageMenuModel({ pageUrl: 'https://example.com/', linkUrl: 'https://example.com/x' });
  assert.deepEqual(ids(link).slice(0, 2), ['copy-link', '-']);
  const sel = pageMenuModel({ pageUrl: 'https://example.com/', selectionText: 'hello' });
  assert.deepEqual(ids(sel).slice(0, 2), ['copy-text', '-']);
  const both = pageMenuModel({ pageUrl: 'https://example.com/', linkUrl: 'https://example.com/x', selectionText: 'hello' });
  assert.deepEqual(ids(both).slice(0, 3), ['copy-text', 'copy-link', '-']);
});

test('page menu: a non-web link or a blank selection adds nothing; no web address disables the two address entries', () => {
  const m = pageMenuModel({ pageUrl: 'https://example.com/', linkUrl: 'javascript:alert(1)', selectionText: '   ' });
  assert.deepEqual(ids(m), ['back', 'forward', 'reload', '-', 'copy-address', 'open-edge']);
  const none = /** @type {any[]} */ (pageMenuModel({ pageUrl: 'about:blank' }));
  assert.equal(none.find((e) => e.id === 'copy-address').enabled, false);
  assert.equal(none.find((e) => e.id === 'open-edge').enabled, false);
  assert.equal(/** @type {any[]} */ (pageMenuModel({})).find((e) => e.id === 'open-edge').enabled, false);
});

test('pageEdgeProfile: the item profile, else the device profile, else null', () => {
  const item = (/** @type {string | null} */ p, mode = 'never') => /** @type {any} */ ({ edge: { mode, profile: p } });
  assert.equal(pageEdgeProfile(item('Profile 9'), { edgeProfile: 'Profile 2' }), 'Profile 9');
  assert.equal(pageEdgeProfile(item(null), { edgeProfile: 'Profile 2' }), 'Profile 2');
  assert.equal(pageEdgeProfile(item(null), { edgeProfile: null }), null);
  assert.equal(pageEdgeProfile(item(''), { edgeProfile: null }), null, 'a blank profile is Edge\'s own default');
  assert.equal(pageEdgeProfile(item('P', 'inherit'), { edgeProfile: null }), 'P', 'the item\'s Edge mode does not matter for an explicit "open this page in Edge"');
});

test('return tracker: asks only after the window lost focus following an open', () => {
  let t = 0;
  const r = createReturnTracker({ now: () => t });
  assert.equal(r.focus(), null, 'nothing opened');
  r.opened('a1');
  assert.equal(r.focus(), null, 'never left the app');
  assert.deepEqual(r.pending()?.itemId, 'a1');
  r.blur();
  assert.equal(r.focus(), 'a1');
  assert.equal(r.focus(), null, 'asked once');
  assert.equal(r.pending(), null);
});

test('return tracker: the latest open wins and starts over; an old entry is forgotten; clear drops it', () => {
  let t = 0;
  const r = createReturnTracker({ now: () => t, maxAgeMs: 1000 });
  r.opened('a1');
  r.blur();
  r.opened('a2'); // opened again before coming back: the blur belongs to the old open
  assert.equal(r.focus(), null);
  r.blur();
  t = 1500;
  assert.equal(r.focus(), null, 'too old');
  assert.equal(r.pending(), null);
  r.opened('a3');
  r.blur();
  r.clear();
  assert.equal(r.focus(), null);
});
