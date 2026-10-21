// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutFor, appCommandAction } from '../lib/shortcuts.js';

const key = (/** @type {any} */ o) => shortcutFor({ type: 'keyDown', ...o });

test('F5 reloads, F6 goes home, Alt+Left / Alt+Right go back / forward', () => {
  assert.deepEqual(key({ key: 'F5' }), { type: 'nav', action: 'reload' });
  assert.deepEqual(key({ key: 'F6' }), { type: 'nav', action: 'home' });
  assert.deepEqual(key({ key: 'ArrowLeft', alt: true }), { type: 'nav', action: 'back' });
  assert.deepEqual(key({ key: 'ArrowRight', alt: true }), { type: 'nav', action: 'forward' });
});

test('navigation keys need exactly their modifiers: Ctrl/Shift/Meta+F5, plain arrows, Alt+Up and Ctrl+Alt+Left are not ours', () => {
  for (const mod of [{ control: true }, { shift: true }, { meta: true }, { alt: true }]) {
    assert.equal(key({ key: 'F5', ...mod }), null, `F5 ${JSON.stringify(mod)}`);
    assert.equal(key({ key: 'F6', ...mod }), null, `F6 ${JSON.stringify(mod)}`);
  }
  assert.equal(key({ key: 'ArrowLeft' }), null);
  assert.equal(key({ key: 'ArrowRight', control: true }), null);
  assert.equal(key({ key: 'ArrowLeft', alt: true, control: true }), null);
  assert.equal(key({ key: 'ArrowLeft', alt: true, shift: true }), null);
  assert.equal(key({ key: 'ArrowLeft', alt: true, meta: true }), null);
  assert.equal(key({ key: 'ArrowUp', alt: true }), null);
  assert.equal(key({ key: 'F7' }), null);
});

test('only a key press counts: key-up and other event types are ignored; no input at all is ignored', () => {
  assert.equal(shortcutFor({ type: 'keyUp', key: 'F5' }), null);
  assert.equal(shortcutFor({ type: 'char', key: 'F5' }), null);
  assert.equal(shortcutFor(/** @type {any} */ (null)), null);
  assert.equal(shortcutFor(/** @type {any} */ (undefined)), null);
});

test('the browser Back / Forward keys are NOT key shortcuts (they arrive as app-command, so one press is one step)', () => {
  assert.equal(key({ key: 'BrowserBack' }), null);
  assert.equal(key({ key: 'BrowserForward' }), null);
});

test('F3 and the Ctrl shortcuts are unchanged by the navigation keys', () => {
  assert.deepEqual(key({ key: 'F3' }), { type: 'edit', source: 'site' });
  assert.deepEqual(key({ key: '2', control: true }), { type: 'workspace', index: 1 });
  assert.deepEqual(key({ key: 'Tab', control: true, shift: true }), { type: 'item', delta: -1 });
  assert.equal(key({ key: '2', control: true, alt: true }), null);
});

test('appCommandAction: browser-backward / browser-forward only', () => {
  assert.equal(appCommandAction('browser-backward'), 'back');
  assert.equal(appCommandAction('browser-forward'), 'forward');
  for (const other of ['browser-refresh', 'browser-home', 'close', '', undefined, null, 42]) assert.equal(appCommandAction(other), null, String(other));
});
