// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userAgentFor, stripElectronTokens, FIREFOX_UA, FIREFOX_VERSION } from '../lib/ua.js';

const ELECTRON_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) fruitery/0.1.0 Chrome/140.0.7339.5 Electron/44.7.2 Safari/537.36';

test('default keeps Electron\'s UA unchanged', () => {
  assert.equal(userAgentFor('default', null, ELECTRON_UA), ELECTRON_UA);
  assert.equal(userAgentFor('default', 'ignored', ELECTRON_UA), ELECTRON_UA);
});

test('chrome strips the Electron and app-name tokens and nothing else', () => {
  const ua = userAgentFor('chrome', null, ELECTRON_UA);
  assert.equal(ua, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.5 Safari/537.36');
  assert.ok(!/Electron|fruitery/.test(ua));
});

test('chrome handles an app name that itself contains slashes or a scope', () => {
  const ua = stripElectronTokens(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) @fruitery/desktop/0.1.0 Chrome/140.0.0.0 Electron/44.0.0 Safari/537.36',
  );
  assert.ok(!/Electron|fruitery/.test(ua), ua);
  assert.ok(/Chrome\/140\.0\.0\.0 Safari\/537\.36$/.test(ua), ua);
});

test('chrome leaves an already clean Chrome UA alone', () => {
  const clean = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  assert.equal(stripElectronTokens(clean), clean);
});

test('firefox is a Firefox-on-Windows UA built from one version constant', () => {
  const ua = userAgentFor('firefox', null, ELECTRON_UA);
  assert.equal(ua, FIREFOX_UA);
  assert.ok(ua.includes('Windows NT 10.0') && ua.includes(`Firefox/${FIREFOX_VERSION}`) && ua.includes(`rv:${FIREFOX_VERSION}`));
  assert.ok(!/Electron|Chrome/.test(ua));
});

test('custom returns the string trimmed; a blank custom falls back to the default', () => {
  assert.equal(userAgentFor('custom', '  MyAgent/1.0  ', ELECTRON_UA), 'MyAgent/1.0');
  assert.equal(userAgentFor('custom', '   ', ELECTRON_UA), ELECTRON_UA);
  assert.equal(userAgentFor('custom', null, ELECTRON_UA), ELECTRON_UA);
});
