// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CREDENTIAL, emptySyncConfig, validateBaseUrl, validateClientId, validateSecret, validateExpiresOn,
  sanitizeSyncConfig, clientIdTail, isComplete, planConfigure, classifyResponse, reasonOf,
} from '../lib/sync-config.js';

const code = (/** @type {any} */ r) => (r.ok ? 'ok' : r.code);

test('emptySyncConfig: all null, a fresh object each time', () => {
  assert.deepEqual(emptySyncConfig(), { baseUrl: null, clientId: null, expiresOn: null });
  assert.notEqual(emptySyncConfig(), emptySyncConfig());
});

test('validateBaseUrl: https addresses are accepted and normalised (no trailing slash, host lower-cased)', () => {
  for (const [input, want] of [
    ['https://example.com', 'https://example.com'],
    ['https://example.com/', 'https://example.com'],
    ['  https://Example.COM/  ', 'https://example.com'],
    ['https://fruitery.example.workers.dev', 'https://fruitery.example.workers.dev'],
    ['https://example.com:8443', 'https://example.com:8443'],
    ['HTTPS://example.com', 'https://example.com'],
  ]) {
    assert.deepEqual(validateBaseUrl(input), { ok: true, value: want }, input);
  }
});

test('validateBaseUrl: plain http is refused unless allowLocal and a local host', () => {
  assert.equal(code(validateBaseUrl('http://example.com')), 'not-https');
  assert.equal(code(validateBaseUrl('http://127.0.0.1:8787')), 'not-https');
  assert.equal(code(validateBaseUrl('http://127.0.0.1:8787', { allowLocal: false })), 'not-https');
  assert.equal(code(validateBaseUrl('http://example.com', { allowLocal: true })), 'not-https', 'allowLocal never opens other hosts');
  assert.equal(code(validateBaseUrl('http://127.0.0.1.example.com', { allowLocal: true })), 'not-https');
  assert.equal(code(validateBaseUrl('http://localhost.example.com', { allowLocal: true })), 'not-https');
  assert.equal(code(validateBaseUrl('http://localhost.', { allowLocal: true })), 'not-https');
});

test('validateBaseUrl: the local forms with and without a port, only when allowLocal', () => {
  for (const [input, want] of [
    ['http://127.0.0.1', 'http://127.0.0.1'],
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787'],
    ['http://localhost', 'http://localhost'],
    ['http://localhost:3000/', 'http://localhost:3000'],
    ['http://[::1]', 'http://[::1]'],
    ['http://[::1]:5173', 'http://[::1]:5173'],
  ]) {
    assert.deepEqual(validateBaseUrl(input, { allowLocal: true }), { ok: true, value: want }, input);
  }
});

test('validateBaseUrl: other schemes, credentials, paths, query and hash are refused with a code', () => {
  assert.equal(code(validateBaseUrl('ftp://example.com')), 'invalid-url');
  assert.equal(code(validateBaseUrl('file:///C:/x')), 'invalid-url');
  assert.equal(code(validateBaseUrl('javascript:alert(1)')), 'invalid-url');
  assert.equal(code(validateBaseUrl('example.com')), 'invalid-url');
  assert.equal(code(validateBaseUrl('https://')), 'invalid-url');
  assert.equal(code(validateBaseUrl('https://exa mple.com')), 'invalid-url');
  assert.equal(code(validateBaseUrl('https://user@example.com')), 'credentials');
  assert.equal(code(validateBaseUrl('https://user:pw@example.com')), 'credentials');
  assert.equal(code(validateBaseUrl('https://@example.com')), 'credentials');
  assert.equal(code(validateBaseUrl('https://example.com/api')), 'path');
  assert.equal(code(validateBaseUrl('https://example.com//')), 'path');
  assert.equal(code(validateBaseUrl('https://example.com?x=1')), 'query-or-hash');
  assert.equal(code(validateBaseUrl('https://example.com/?')), 'query-or-hash');
  assert.equal(code(validateBaseUrl('https://example.com/#top')), 'query-or-hash');
});

test('validateBaseUrl: blank is required; non-strings are invalid', () => {
  assert.equal(code(validateBaseUrl('')), 'required');
  assert.equal(code(validateBaseUrl('   ')), 'required');
  assert.equal(code(validateBaseUrl(null)), 'required');
  assert.equal(code(validateBaseUrl(undefined)), 'required');
  for (const v of [5, {}, ['https://example.com']]) assert.equal(code(validateBaseUrl(v)), 'invalid-url');
});

test('validateClientId / validateSecret: non-empty, no whitespace inside, at most 256 characters', () => {
  for (const fn of [validateClientId, validateSecret]) {
    assert.deepEqual(fn('abc123.access'), { ok: true, value: 'abc123.access' });
    assert.deepEqual(fn('  abc123.access\n'), { ok: true, value: 'abc123.access' }, 'pasted padding is trimmed');
    assert.equal(code(fn('')), 'required');
    assert.equal(code(fn('   ')), 'required');
    assert.equal(code(fn('abc def')), 'whitespace');
    assert.equal(code(fn('abc\tdef')), 'whitespace');
    assert.equal(fn('x'.repeat(MAX_CREDENTIAL)).ok, true, '256 is accepted');
    assert.equal(code(fn('x'.repeat(MAX_CREDENTIAL + 1))), 'too-long', '257 is refused');
    for (const v of [null, undefined, 5, {}]) assert.equal(code(fn(v)), 'invalid-value');
  }
  assert.equal(MAX_CREDENTIAL, 256);
});

test('validateExpiresOn: a real YYYY-MM-DD date, or blank', () => {
  assert.deepEqual(validateExpiresOn('2027-01-31'), { ok: true, value: '2027-01-31' });
  assert.deepEqual(validateExpiresOn('2028-02-29'), { ok: true, value: '2028-02-29' });
  assert.deepEqual(validateExpiresOn(''), { ok: true, value: '' });
  assert.deepEqual(validateExpiresOn(null), { ok: true, value: '' });
  assert.deepEqual(validateExpiresOn(undefined), { ok: true, value: '' });
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '26-01-01', 'tomorrow', '2026/01/01']) {
    assert.equal(code(validateExpiresOn(bad)), 'invalid-date', bad);
  }
  assert.equal(code(validateExpiresOn(20270101)), 'invalid-value');
});

test('sanitizeSyncConfig: junk, missing and partial input never throw and give a clean config', () => {
  for (const junk of [undefined, null, 5, 'x', [], [1], true]) assert.deepEqual(sanitizeSyncConfig(junk), emptySyncConfig(), String(junk));
  assert.deepEqual(sanitizeSyncConfig({}), emptySyncConfig());
  assert.deepEqual(sanitizeSyncConfig({ baseUrl: 7, clientId: {}, expiresOn: [] }), emptySyncConfig());
  assert.deepEqual(sanitizeSyncConfig({ baseUrl: 'https://example.com/', clientId: '  abc.access ', expiresOn: '2027-03-04' }), {
    baseUrl: 'https://example.com', clientId: 'abc.access', expiresOn: '2027-03-04',
  });
  assert.deepEqual(sanitizeSyncConfig({ baseUrl: 'https://example.com' }), { baseUrl: 'https://example.com', clientId: null, expiresOn: null }, 'partial');
  assert.deepEqual(sanitizeSyncConfig({ baseUrl: 'http://evil.example.com', clientId: 'a b', expiresOn: '2026-02-30' }), emptySyncConfig(), 'unusable parts become null');
  assert.deepEqual(sanitizeSyncConfig({ baseUrl: 'https://u:p@example.com/x?y' }), emptySyncConfig());
  assert.equal(sanitizeSyncConfig({ baseUrl: 'http://127.0.0.1:9' }).baseUrl, 'http://127.0.0.1:9', 'a local development address survives loading');
  assert.deepEqual(sanitizeSyncConfig({ baseUrl: 'https://example.com', secret: 'leak' }), { baseUrl: 'https://example.com', clientId: null, expiresOn: null }, 'unknown keys (a secret) are dropped');
});

test('clientIdTail: the last 4 characters, null for nothing', () => {
  assert.equal(clientIdTail('abc123.access'), 'cess');
  assert.equal(clientIdTail('xy'), 'xy');
  assert.equal(clientIdTail(null), null);
  assert.equal(clientIdTail(''), null);
});

test('isComplete: needs an address and a client id (the expiry is optional)', () => {
  assert.equal(isComplete(emptySyncConfig()), false);
  assert.equal(isComplete({ baseUrl: 'https://example.com', clientId: null, expiresOn: null }), false);
  assert.equal(isComplete({ baseUrl: null, clientId: 'a', expiresOn: null }), false);
  assert.equal(isComplete({ baseUrl: 'https://example.com', clientId: 'a', expiresOn: null }), true);
});

const none = emptySyncConfig();
const have = { baseUrl: 'https://example.com', clientId: 'abc123.access', expiresOn: '2027-01-01' };
const form = (/** @type {any} */ over = {}) => ({ baseUrl: 'https://example.com', clientId: 'abc123.access', secret: 's3cret', expiresOn: '2027-01-01', ...over });
const fields = (/** @type {any} */ r) => (r.ok ? [] : r.errors.map((/** @type {any} */ e) => `${e.field}:${e.code}`).sort());

test('planConfigure: a first connection needs all of it and returns a clean config and the secret', () => {
  const r = planConfigure(form({ baseUrl: 'https://example.com/' }), { allowLocal: false, current: none, hasSecret: false });
  assert.deepEqual(r, { ok: true, config: have, secret: 's3cret' });
  assert.deepEqual(fields(planConfigure({}, { allowLocal: false, current: none, hasSecret: false })), ['baseUrl:required', 'clientId:required', 'secret:required']);
  assert.deepEqual(fields(planConfigure(null, { allowLocal: false, current: none, hasSecret: false })), ['baseUrl:required', 'clientId:required', 'secret:required']);
});

test('planConfigure: a blank secret keeps the stored one, so only the expiry can change', () => {
  const r = planConfigure(form({ secret: '', clientId: '', expiresOn: '2028-05-06' }), { allowLocal: false, current: have, hasSecret: true });
  assert.deepEqual(r, { ok: true, config: { ...have, expiresOn: '2028-05-06' }, secret: null });
});

test('planConfigure: a blank secret with none stored is an error', () => {
  assert.deepEqual(fields(planConfigure(form({ secret: '' }), { allowLocal: false, current: have, hasSecret: false })), ['secret:required']);
});

test('planConfigure: a new address or a new client id needs the secret typed again', () => {
  assert.deepEqual(fields(planConfigure(form({ secret: '', baseUrl: 'https://other.example.com' }), { allowLocal: false, current: have, hasSecret: true })), ['secret:retype-required']);
  assert.deepEqual(fields(planConfigure(form({ secret: '', clientId: 'def456.access' }), { allowLocal: false, current: have, hasSecret: true })), ['secret:retype-required']);
  const ok = planConfigure(form({ baseUrl: 'https://other.example.com', clientId: 'def456.access', secret: 'new' }), { allowLocal: false, current: have, hasSecret: true });
  assert.deepEqual(ok, { ok: true, config: { baseUrl: 'https://other.example.com', clientId: 'def456.access', expiresOn: '2027-01-01' }, secret: 'new' });
});

test('planConfigure: field errors are reported together; a blank expiry clears it', () => {
  const r = planConfigure({ baseUrl: 'http://example.com', clientId: 'a b', secret: 'x'.repeat(257), expiresOn: '2026-02-30' }, { allowLocal: false, current: none, hasSecret: false });
  assert.deepEqual(fields(r), ['baseUrl:not-https', 'clientId:whitespace', 'expiresOn:invalid-date', 'secret:too-long']);
  assert.deepEqual(planConfigure(form({ expiresOn: '' }), { allowLocal: false, current: have, hasSecret: true }), { ok: true, config: { ...have, expiresOn: null }, secret: 's3cret' });
});

test('planConfigure: a local http address passes only when allowLocal', () => {
  assert.deepEqual(fields(planConfigure(form({ baseUrl: 'http://127.0.0.1:8787' }), { allowLocal: false, current: none, hasSecret: false })), ['baseUrl:not-https']);
  assert.equal(planConfigure(form({ baseUrl: 'http://127.0.0.1:8787' }), { allowLocal: true, current: none, hasSecret: false }).ok, true);
});

test('planConfigure: non-string values are errors, never exceptions', () => {
  const r = planConfigure({ baseUrl: 5, clientId: 6, secret: 7, expiresOn: 8 }, { allowLocal: false, current: none, hasSecret: false });
  assert.equal(r.ok, false);
});

test('classifyResponse: 2xx is ok with the body', () => {
  assert.deepEqual(classifyResponse(200, { a: 1 }), { ok: true, json: { a: 1 } });
  assert.deepEqual(classifyResponse(204, null), { ok: true, json: null });
  assert.equal(classifyResponse(299, null).ok, true);
});

test('classifyResponse: any 3xx or an opaque redirect (status 0) means Access refused the key', () => {
  for (const s of [300, 301, 302, 303, 307, 308, 399, 0]) {
    assert.deepEqual(classifyResponse(s, null), { ok: false, kind: 'refused', reason: 'access-key-refused' }, String(s));
  }
});

test('classifyResponse: a 401 (what Access answers a wrong service token with) means the key was refused', () => {
  assert.deepEqual(classifyResponse(401, null), { ok: false, kind: 'refused', reason: 'access-key-refused' });
  assert.deepEqual(classifyResponse(401, { error: 'unauthorized' }), { ok: false, kind: 'refused', reason: 'access-key-refused' });
  assert.equal(reasonOf(classifyResponse(401, null)), 'access-key-refused');
});

test('classifyResponse: 403 carries the server reason, or "forbidden"', () => {
  assert.deepEqual(classifyResponse(403, { error: 'forbidden', reason: 'service-token-not-allowed' }), { ok: false, kind: 'denied', reason: 'service-token-not-allowed' });
  for (const body of [null, {}, { reason: '' }, { reason: 5 }, 'text', []]) {
    assert.deepEqual(classifyResponse(403, body), { ok: false, kind: 'denied', reason: 'forbidden' }, JSON.stringify(body));
  }
});

test('classifyResponse: 422 is "invalid" with the body; everything else is "http" with the status', () => {
  const body = { error: 'validation', details: [] };
  assert.deepEqual(classifyResponse(422, body), { ok: false, kind: 'invalid', status: 422, json: body });
  for (const s of [400, 404, 405, 429, 500, 502, 503]) assert.deepEqual(classifyResponse(s, { x: 1 }), { ok: false, kind: 'http', status: s });
  assert.deepEqual(classifyResponse(199, null), { ok: false, kind: 'http', status: 199 });
});

test('reasonOf: one short code per failure', () => {
  assert.equal(reasonOf({ ok: false, kind: 'refused', reason: 'access-key-refused' }), 'access-key-refused');
  assert.equal(reasonOf({ ok: false, kind: 'denied', reason: 'email-mismatch' }), 'email-mismatch');
  assert.equal(reasonOf({ ok: false, kind: 'http', status: 502 }), 'http-502');
  assert.equal(reasonOf({ ok: false, kind: 'invalid', status: 422, json: null }), 'http-422');
  assert.equal(reasonOf({ ok: false, kind: 'offline' }), 'offline');
  assert.equal(reasonOf({ ok: false, kind: 'not-connected' }), 'not-connected');
});
