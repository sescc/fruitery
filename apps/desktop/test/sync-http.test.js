// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestApi } from '../main/sync-http.js';

const KEY = { baseUrl: 'https://example.com', clientId: 'abc123.access', secret: 'sh-secret' };

/**
 * @param {(url: string, init: any) => any} answer
 * @returns {{fetch: (url: string, init: any) => Promise<any>, calls: {url: string, init: any}[]}}
 */
function fakeFetch(answer) {
  /** @type {{url: string, init: any}[]} */
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return answer(url, init);
    },
  };
}

const reply = (/** @type {number} */ status, /** @type {unknown} */ body, /** @type {string} */ [type] = ['basic']) => ({ status, type, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

test('sends the key only in the Access headers, never follows redirects, and returns the JSON', async () => {
  const f = fakeFetch(() => reply(200, { ok: 1 }));
  const requestApi = createRequestApi({ fetch: f.fetch, allowLocal: false });
  const r = await requestApi(KEY, 'GET', '/api/state');
  assert.deepEqual(r, { ok: true, json: { ok: 1 } });
  assert.equal(f.calls[0].url, 'https://example.com/api/state');
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[0].init.redirect, 'manual');
  assert.equal(f.calls[0].init.headers['CF-Access-Client-Id'], 'abc123.access');
  assert.equal(f.calls[0].init.headers['CF-Access-Client-Secret'], 'sh-secret');
  assert.equal(f.calls[0].init.body, undefined);
  assert.equal(JSON.stringify(r).includes('sh-secret'), false);
});

test('a body is sent as JSON', async () => {
  const f = fakeFetch(() => reply(200, { stored: true }));
  const requestApi = createRequestApi({ fetch: f.fetch, allowLocal: false });
  await requestApi(KEY, 'PUT', '/api/entities', { items: [] });
  assert.equal(f.calls[0].init.body, '{"items":[]}');
  assert.equal(f.calls[0].init.headers['Content-Type'], 'application/json');
});

test('3xx and an opaque redirect are "access key refused"', async () => {
  for (const res of [reply(302, ''), reply(307, ''), { status: 0, type: 'opaqueredirect', text: async () => '' }]) {
    const requestApi = createRequestApi({ fetch: fakeFetch(() => res).fetch, allowLocal: false });
    assert.deepEqual(await requestApi(KEY, 'GET', '/api/state'), { ok: false, kind: 'refused', reason: 'access-key-refused' });
  }
});

test('403 gives the server reason, 422 the body, other statuses the status', async () => {
  const run = async (/** @type {any} */ res) => createRequestApi({ fetch: fakeFetch(() => res).fetch, allowLocal: false })(KEY, 'GET', '/api/state');
  assert.deepEqual(await run(reply(403, { error: 'forbidden', reason: 'service-token-not-allowed' })), { ok: false, kind: 'denied', reason: 'service-token-not-allowed' });
  assert.deepEqual(await run(reply(403, 'not json')), { ok: false, kind: 'denied', reason: 'forbidden' });
  assert.deepEqual(await run(reply(422, { error: 'invalid' })), { ok: false, kind: 'invalid', status: 422, json: { error: 'invalid' } });
  assert.deepEqual(await run(reply(500, 'oops')), { ok: false, kind: 'http', status: 500 });
});

test('a 2xx that is not JSON did not come from the Worker', async () => {
  const requestApi = createRequestApi({ fetch: fakeFetch(() => reply(200, '<html>login</html>')).fetch, allowLocal: false });
  assert.deepEqual(await requestApi(KEY, 'GET', '/api/state'), { ok: false, kind: 'http', status: 200 });
});

test('a network error is "offline", and a slow server times out as "offline"', async () => {
  const down = createRequestApi({ fetch: async () => { throw new Error('ECONNREFUSED'); }, allowLocal: false });
  assert.deepEqual(await down(KEY, 'GET', '/api/state'), { ok: false, kind: 'offline' });
  const slow = createRequestApi({
    fetch: (_url, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))),
    allowLocal: false,
    timeoutMs: 20,
  });
  assert.deepEqual(await slow(KEY, 'GET', '/api/state'), { ok: false, kind: 'offline' });
});
test('Electron rejects a manual redirect with "Redirect was cancelled": that is "access key refused", not offline', async () => {
  const requestApi = createRequestApi({ fetch: async () => { throw new Error('Redirect was cancelled'); }, allowLocal: false });
  assert.deepEqual(await requestApi(KEY, 'GET', '/api/state'), { ok: false, kind: 'refused', reason: 'access-key-refused' });
});
test('an incomplete key, a bad address or a path outside /api/ never reaches the network', async () => {
  const f = fakeFetch(() => reply(200, {}));
  const requestApi = createRequestApi({ fetch: f.fetch, allowLocal: false });
  const notConnected = { ok: false, kind: 'not-connected' };
  assert.deepEqual(await requestApi({ ...KEY, secret: null }, 'GET', '/api/state'), notConnected);
  assert.deepEqual(await requestApi({ ...KEY, clientId: null }, 'GET', '/api/state'), notConnected);
  assert.deepEqual(await requestApi({ ...KEY, baseUrl: null }, 'GET', '/api/state'), notConnected);
  assert.deepEqual(await requestApi({ ...KEY, baseUrl: 'http://example.com' }, 'GET', '/api/state'), notConnected, 'the secret never goes out over plain http');
  assert.deepEqual(await requestApi({ ...KEY, baseUrl: 'http://127.0.0.1:1' }, 'GET', '/api/state'), notConnected, 'local http only when allowed');
  assert.deepEqual(await requestApi(KEY, 'GET', 'https://evil.example.com/api/state'), notConnected);
  assert.deepEqual(await requestApi(KEY, 'GET', '/other'), notConnected);
  assert.equal(f.calls.length, 0);
});

test('allowLocal lets the key go to a local development server', async () => {
  const f = fakeFetch(() => reply(200, { ok: 1 }));
  const requestApi = createRequestApi({ fetch: f.fetch, allowLocal: true });
  assert.equal((await requestApi({ ...KEY, baseUrl: 'http://127.0.0.1:8787' }, 'GET', '/api/state')).ok, true);
  assert.equal(f.calls[0].url, 'http://127.0.0.1:8787/api/state');
});
