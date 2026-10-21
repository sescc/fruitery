// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPersistentDetails, isOptedOut, hostOfUrl, COOKIE_TTL_SECONDS } from '../lib/cookie-transform.js';

const NOW = 1_700_000_000_000;
const EXP = Math.floor(NOW / 1000) + COOKIE_TTL_SECONDS;
/** @param {any} over */
const cookie = (over = {}) => ({ name: 'sid', value: 'v', domain: '.example.com', hostOnly: false, path: '/', secure: true, httpOnly: true, session: true, sameSite: 'lax', ...over });

test('a session cookie becomes a 30-day persistent one and keeps its attributes', () => {
  const d = toPersistentDetails(cookie(), NOW);
  assert.deepEqual(d, {
    url: 'https://example.com/',
    name: 'sid',
    value: 'v',
    domain: '.example.com',
    path: '/',
    secure: true,
    httpOnly: true,
    expirationDate: EXP,
    sameSite: 'lax',
  });
});

test('host-only stays host-only: no domain is passed', () => {
  const d = toPersistentDetails(cookie({ domain: 'www.example.com', hostOnly: true }), NOW);
  assert.ok(d);
  assert.equal('domain' in d, false);
  assert.equal(d.url, 'https://www.example.com/');
});

test('a __Host- cookie never gets a domain, even when hostOnly is not reported', () => {
  const d = toPersistentDetails(cookie({ name: '__Host-token', hostOnly: false, domain: 'example.com' }), NOW);
  assert.ok(d);
  assert.equal('domain' in d, false);
});

test('__Secure- cookies and secure / httpOnly / sameSite / path are preserved', () => {
  const d = toPersistentDetails(cookie({ name: '__Secure-id', path: '/app', secure: true, httpOnly: false, sameSite: 'no_restriction' }), NOW);
  assert.ok(d);
  assert.equal(d.name, '__Secure-id');
  assert.equal(d.path, '/app');
  assert.equal(d.secure, true);
  assert.equal(d.httpOnly, false);
  assert.equal(d.sameSite, 'no_restriction');
  assert.equal(d.url, 'https://example.com/app');
});

test('an insecure cookie uses an http url; a relative or missing path becomes /', () => {
  assert.equal(toPersistentDetails(cookie({ secure: false }), NOW)?.url, 'http://example.com/');
  assert.equal(toPersistentDetails(cookie({ path: 'rel' }), NOW)?.path, '/');
  assert.equal(toPersistentDetails(cookie({ path: undefined }), NOW)?.path, '/');
});

test('sameSite is left out when the cookie has none', () => {
  const d = toPersistentDetails(cookie({ sameSite: undefined }), NOW);
  assert.ok(d);
  assert.equal('sameSite' in d, false);
});

test('an already persistent cookie -> null (this also stops the re-set loop)', () => {
  assert.equal(toPersistentDetails(cookie({ session: false, expirationDate: EXP }), NOW), null);
  assert.equal(toPersistentDetails(cookie({ expirationDate: 123 }), NOW), null);
  assert.equal(toPersistentDetails(cookie({ session: false }), NOW), null);
});

test('malformed cookies -> null', () => {
  assert.equal(toPersistentDetails(cookie({ name: '' }), NOW), null);
  assert.equal(toPersistentDetails(cookie({ name: 5 }), NOW), null);
  assert.equal(toPersistentDetails(cookie({ domain: '' }), NOW), null);
  assert.equal(toPersistentDetails(cookie({ domain: undefined }), NOW), null);
  assert.equal(toPersistentDetails(/** @type {any} */ (null), NOW), null);
});

test('a leading-dot domain is stripped for the url and passed through as the domain', () => {
  const d = toPersistentDetails(cookie({ domain: '.sub.example.com' }), NOW);
  assert.equal(d?.url, 'https://sub.example.com/');
  assert.equal(d?.domain, '.sub.example.com');
});

test('a custom ttl is honoured', () => {
  assert.equal(toPersistentDetails(cookie(), NOW, 60)?.expirationDate, Math.floor(NOW / 1000) + 60);
});

test('isOptedOut: www stripped on both sides, subdomains included', () => {
  assert.equal(isOptedOut('.example.com', ['www.example.com']), true);
  assert.equal(isOptedOut('example.com', ['example.com']), true);
  assert.equal(isOptedOut('www.example.com', ['example.com']), true);
  assert.equal(isOptedOut('login.example.com', ['www.example.com']), true);
  assert.equal(isOptedOut('.LOGIN.Example.COM', ['EXAMPLE.com']), true);
});

test('isOptedOut: unrelated and look-alike domains are not covered', () => {
  assert.equal(isOptedOut('other.com', ['example.com']), false);
  assert.equal(isOptedOut('notexample.com', ['example.com']), false);
  assert.equal(isOptedOut('example.com.evil.net', ['example.com']), false);
  assert.equal(isOptedOut('com', ['example.com']), false);
  assert.equal(isOptedOut('.example.com', []), false);
  assert.equal(isOptedOut('', ['example.com']), false);
  assert.equal(isOptedOut('example.com', ['', /** @type {any} */ (null)]), false);
});

test('hostOfUrl: lower-case host without www; null for junk', () => {
  assert.equal(hostOfUrl('https://WWW.Example.com/path?x=1'), 'example.com');
  assert.equal(hostOfUrl('https://calendar.google.com/calendar'), 'calendar.google.com');
  assert.equal(hostOfUrl('not a url'), null);
  assert.equal(hostOfUrl(null), null);
});
