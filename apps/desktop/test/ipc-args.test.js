// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idArg, optionalIdArg, oneOf, boolArg, indexArg, textArg, objectArg, rectsArg, confirmArg, syncConfigureArg, syncDiscardArgs, focusPaneArgs } from '../lib/ipc-args.js';
import { decidePermission } from '../main/sessions.js';

const throwsInvalid = (/** @type {() => unknown} */ fn) => assert.throws(fn, { name: 'TypeError', message: 'invalid-argument' });

test('idArg: short strings only', () => {
  assert.equal(idArg('it-1'), 'it-1');
  for (const b of ['', 'a\nb', 'x'.repeat(201), 5, null, undefined, {}, ['a']]) throwsInvalid(() => idArg(b));
});

test('optionalIdArg: null and undefined are null; others are validated', () => {
  assert.equal(optionalIdArg(null), null);
  assert.equal(optionalIdArg(undefined), null);
  assert.equal(optionalIdArg('p1'), 'p1');
  throwsInvalid(() => optionalIdArg(3));
});

test('textArg: a short single-line string only', () => {
  assert.equal(textArg('example.com/a b'), 'example.com/a b');
  for (const b of ['x'.repeat(2101), 'a\nb', 'a\u0000b', 5, null, undefined, {}]) throwsInvalid(() => textArg(b));
  throwsInvalid(() => textArg('abcd', 3));
});

test('oneOf / boolArg / indexArg', () => {
  assert.equal(oneOf('back', ['back', 'forward']), 'back');
  throwsInvalid(() => oneOf('sideways', ['back', 'forward']));
  throwsInvalid(() => oneOf(1, ['back']));
  assert.equal(boolArg(false), false);
  throwsInvalid(() => boolArg('true'));
  assert.equal(indexArg(2.9), 2);
  for (const b of [-1, NaN, Infinity, '1', 1e9]) throwsInvalid(() => indexArg(b));
});

test('objectArg: plain objects of bounded size', () => {
  assert.deepEqual(objectArg({ a: 1 }), { a: 1 });
  for (const b of [null, [], 'x', 5, undefined]) throwsInvalid(() => objectArg(b));
  throwsInvalid(() => objectArg({ big: 'x'.repeat(500_000) }));
  const cyc = /** @type {any} */ ({});
  cyc.self = cyc;
  throwsInvalid(() => objectArg(cyc));
});

test('rectsArg: finite numbers, string ids, at most 8, negative sizes clamped', () => {
  assert.deepEqual(rectsArg([{ paneId: 'p1', itemId: 'a', x: 1, y: 2, w: 3, h: -4 }, { paneId: 'p2', itemId: null, x: 0, y: 0, w: 1, h: 1 }]), [
    { paneId: 'p1', itemId: 'a', x: 1, y: 2, w: 3, h: 0 },
    { paneId: 'p2', itemId: null, x: 0, y: 0, w: 1, h: 1 },
  ]);
  throwsInvalid(() => rectsArg('x'));
  throwsInvalid(() => rectsArg(new Array(9).fill({ paneId: 'p', itemId: null, x: 0, y: 0, w: 1, h: 1 })));
  throwsInvalid(() => rectsArg([{ paneId: 'p', itemId: null, x: NaN, y: 0, w: 1, h: 1 }]));
  throwsInvalid(() => rectsArg([{ paneId: 'p', itemId: null, x: '0', y: 0, w: 1, h: 1 }]));
  throwsInvalid(() => rectsArg([{ paneId: 5, itemId: null, x: 0, y: 0, w: 1, h: 1 }]));
  throwsInvalid(() => rectsArg([null]));
});

test('confirmArg: bounded texts, 1..3 buttons, cancelId defaults to the last button', () => {
  assert.deepEqual(confirmArg({ message: 'Mark X done?', buttons: ['Yes', 'No', 'Cancel'] }), { message: 'Mark X done?', detail: '', buttons: ['Yes', 'No', 'Cancel'], cancelId: 2 });
  assert.equal(confirmArg({ message: 'm' }).buttons.length, 2);
  assert.equal(confirmArg({ message: 'm', buttons: ['A', 'B'], cancelId: 0 }).cancelId, 0);
  throwsInvalid(() => confirmArg({ message: 'm', buttons: [] }));
  throwsInvalid(() => confirmArg({ message: 'm', buttons: ['1', '2', '3', '4'] }));
  throwsInvalid(() => confirmArg({ message: 'x'.repeat(301) }));
  throwsInvalid(() => confirmArg('text'));
});

test('permissions (D71): notifications follow the item; the allow-list is granted; the rest is denied', () => {
  assert.equal(decidePermission('notifications', { notify: true }), true);
  assert.equal(decidePermission('notifications', { notify: false }), false);
  assert.equal(decidePermission('notifications', null), false);
  for (const p of ['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'media']) assert.equal(decidePermission(p, { notify: false }), true, p);
  for (const p of ['geolocation', 'midi', 'midiSysex', 'hid', 'serial', 'usb', 'clipboard-read', 'openExternal', 'display-capture', 'idle-detection']) {
    assert.equal(decidePermission(p, { notify: true }), false, p);
  }
});

test('syncConfigureArg: the four values are short single-line strings; blank or absent become ""', () => {
  assert.deepEqual(syncConfigureArg({ baseUrl: 'https://example.com', clientId: 'a', secret: 's', expiresOn: '2027-01-01' }), { baseUrl: 'https://example.com', clientId: 'a', secret: 's', expiresOn: '2027-01-01' });
  assert.deepEqual(syncConfigureArg({}), { baseUrl: '', clientId: '', secret: '', expiresOn: '' });
  assert.deepEqual(syncConfigureArg({ baseUrl: null, secret: undefined }), { baseUrl: '', clientId: '', secret: '', expiresOn: '' });
  assert.equal(syncConfigureArg({ secret: 'x'.repeat(257) }).secret.length, 257, 'length rules belong to planConfigure, so the UI gets a field error');
  throwsInvalid(() => syncConfigureArg({ secret: 'x'.repeat(601) }));
  throwsInvalid(() => syncConfigureArg({ clientId: 'a\nb' }));
  throwsInvalid(() => syncConfigureArg({ baseUrl: 5 }));
  throwsInvalid(() => syncConfigureArg('text'));
  throwsInvalid(() => syncConfigureArg(null));
});

test('syncDiscardArgs: the kind is one of the four API kinds; settings take no id, the others need one', () => {
  assert.deepEqual(syncDiscardArgs('items', 'it-1'), { kind: 'items', id: 'it-1' });
  assert.deepEqual(syncDiscardArgs('groups', 'g-1'), { kind: 'groups', id: 'g-1' });
  assert.deepEqual(syncDiscardArgs('workspaces', 'ws-1'), { kind: 'workspaces', id: 'ws-1' });
  assert.deepEqual(syncDiscardArgs('settings', null), { kind: 'settings', id: null });
  assert.deepEqual(syncDiscardArgs('settings', 'ignored'), { kind: 'settings', id: null });
  throwsInvalid(() => syncDiscardArgs('items', null));
  throwsInvalid(() => syncDiscardArgs('items', ''));
  throwsInvalid(() => syncDiscardArgs('item', 'it-1'));
  throwsInvalid(() => syncDiscardArgs(undefined, 'it-1'));
});

test('focusPaneArgs: a workspace id and a pane id, both short ids; nothing else passes through', () => {
  assert.deepEqual(focusPaneArgs('ws-a', 'p2'), { workspaceId: 'ws-a', paneId: 'p2' });
  assert.deepEqual(focusPaneArgs('ws-a', 'p2', { type: 'leaf' }), { workspaceId: 'ws-a', paneId: 'p2' }, 'a tree passed along is ignored');
  throwsInvalid(() => focusPaneArgs('ws-a', ''));
  throwsInvalid(() => focusPaneArgs('', 'p1'));
  throwsInvalid(() => focusPaneArgs('ws-a', null));
  throwsInvalid(() => focusPaneArgs(undefined, 'p1'));
  throwsInvalid(() => focusPaneArgs('ws-a', { type: 'leaf' }));
  throwsInvalid(() => focusPaneArgs('ws-a', 'p1\n'));
});
