// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeepLink, isUsableDeepLink, MAX_DEEP_LINK } from './deep-link.js';

const ok = (/** @type {unknown} */ v) => assert.deepEqual(validateDeepLink(v), [], String(v));
const bad = (/** @type {unknown} */ v) => assert.deepEqual(validateDeepLink(v), [{ field: 'deepLink', code: 'invalid-deep-link' }], String(v));

test('absent, null and undefined are valid (no deep link)', () => {
  ok(null);
  ok(undefined);
});

test('a well-formed Android intent URI is accepted', () => {
  ok('intent://open/thing#Intent;scheme=myapp;package=com.example.app;end');
  ok('intent://example.com/path#Intent;scheme=https;package=com.example.app;end');
});

test('a safe intent fallback URL is accepted, an unsafe one is refused', () => {
  ok('intent://x/#Intent;scheme=https;S.browser_fallback_url=https%3A%2F%2Fexample.com;end');
  bad('intent://x/#Intent;scheme=https;S.browser_fallback_url=javascript%3Aalert(1);end');
  bad('intent://x/#Intent;scheme=https;S.browser_fallback_url=data%3Atext%2Fhtml%2Chi;end');
  bad('intent://x/#Intent;scheme=https;S.browser_fallback_url=file%3A%2F%2F%2Fetc%2Fpasswd;end');
});

test('a custom scheme is accepted', () => {
  ok('myapp://open/thing');
  ok('tel:+123456789');
  ok('example-app://open?team=abc');
  ok('exampleapp:track:abc');
});

test('unsafe schemes are refused as the deep link itself', () => {
  bad('javascript:alert(1)');
  bad('JavaScript:alert(1)');
  bad('data:text/html,hi');
  bad('file:///C:/Windows/win.ini');
  bad('blob:https://example.com/x');
  bad('vbscript:x');
});

test('blank, schemeless, too long, whitespace and control-character values are refused', () => {
  bad('');
  bad('   ');
  bad('no-scheme-here');
  bad('myapp://has a space');
  bad('myapp://x\u0000y');
  bad(42);
  bad({});
  bad('x'.repeat(MAX_DEEP_LINK + 1));
  ok('myapp://' + 'a'.repeat(MAX_DEEP_LINK - 'myapp://'.length)); // exactly the cap is fine
});

test('isUsableDeepLink is true only for a present, valid deep link', () => {
  assert.equal(isUsableDeepLink('intent://x/#Intent;scheme=https;end'), true);
  assert.equal(isUsableDeepLink('myapp://x'), true);
  assert.equal(isUsableDeepLink(null), false);
  assert.equal(isUsableDeepLink(''), false);
  assert.equal(isUsableDeepLink('javascript:alert(1)'), false);
});
