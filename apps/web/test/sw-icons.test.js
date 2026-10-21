// @ts-check
// The service worker is a classic script, so it cannot be imported: it is run in a node:vm context with a
// fake `self`, `caches`, `fetch` and clock, and driven through its own event listeners.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SW_SOURCE = readFileSync(join(import.meta.dirname, '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://app.example.com';
const DAY = 24 * 60 * 60 * 1000;

/** A response that behaves like an opaque cross-origin one (no readable status or headers). */
const opaque = (/** @type {string} */ tag) => ({ type: 'opaque', status: 0, ok: false, tag, clone() { return this; } });

/**
 * @param {object} [options]
 * @param {(request: any) => Promise<any>} [options.fetch]
 * @param {boolean} [options.putFails]
 */
function loadSw({ fetch: fetchImpl, putFails = false } = {}) {
  /** @type {Record<string, Function>} */
  const listeners = {};
  /** @type {Map<string, Map<string, any>>} */
  const stores = new Map();
  const clock = { t: Date.UTC(2026, 10, 1) };
  /** @type {any[]} */ const fetched = [];
  const keyOf = (/** @type {any} */ k) => (typeof k === 'string' ? new URL(k, ORIGIN).href : k.url);
  const makeCache = (/** @type {string} */ name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = /** @type {Map<string, any>} */ (stores.get(name));
    return {
      match: async (/** @type {any} */ k) => {
        const r = m.get(keyOf(k));
        return r && typeof r.clone === 'function' && r.type !== 'opaque' ? r.clone() : r;
      },
      put: async (/** @type {any} */ k, /** @type {any} */ r) => {
        if (putFails) throw new Error('QuotaExceededError');
        m.set(keyOf(k), r);
      },
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (/** @type {any} */ k) => m.delete(keyOf(k)),
    };
  };
  const caches = {
    open: async (/** @type {string} */ n) => makeCache(n),
    keys: async () => [...stores.keys()],
    delete: async (/** @type {string} */ n) => stores.delete(n),
    match: async () => undefined,
  };
  class FakeDate extends Date {
    static now() {
      return clock.t;
    }
  }
  const self = { location: { origin: ORIGIN }, addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { listeners[t] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const context = vm.createContext({
    self,
    caches,
    Response,
    Request,
    URL,
    Date: FakeDate,
    fetch: async (/** @type {any} */ r) => {
      fetched.push(r);
      return fetchImpl ? fetchImpl(r) : opaque('default');
    },
  });
  vm.runInContext(SW_SOURCE.replace("'__BUILD_VERSION__'", '"test"').replace('/*__SHELL_EXTRA__*/ []', '[]'), context);
  /** Dispatch a fetch event; resolves to the response, or undefined when the worker did not intercept it. */
  const dispatch = async (/** @type {any} */ request) => {
    /** @type {Promise<any> | undefined} */
    let answer;
    listeners.fetch({ request, respondWith: (/** @type {Promise<any>} */ p) => { answer = p; } });
    return answer === undefined ? undefined : { response: await answer };
  };
  return { dispatch, caches, stores, fetched, clock, listeners };
}

const iconRequest = (/** @type {Record<string, unknown>} */ over = {}) => ({ method: 'GET', url: 'https://site.example.net/favicon.ico', destination: 'image', mode: 'no-cors', referrerPolicy: 'no-referrer', ...over });

test('an icon request is fetched once with the ORIGINAL request, then answered from the icon cache', async () => {
  const sw = loadSw({ fetch: async () => opaque('first') });
  const req = iconRequest();
  const a = await sw.dispatch(req);
  assert.equal(a?.response.tag, 'first');
  assert.equal(sw.fetched.length, 1);
  assert.equal(sw.fetched[0], req, 'the same Request object: its no-referrer policy and no-cors mode are kept');
  sw.clock.t += 10 * DAY;
  const b = await sw.dispatch(iconRequest());
  assert.equal(b?.response.tag, 'first', 'served from the cache');
  assert.equal(sw.fetched.length, 1, 'no second network request within 30 days');
  assert.ok(sw.stores.has('fruitery-icons'));
  assert.deepEqual([...sw.stores.keys()], ['fruitery-icons'], 'nothing in the app-shell cache');
});

test('after 30 days the icon is fetched again and replaced', async () => {
  let n = 0;
  const sw = loadSw({ fetch: async () => opaque(`v${++n}`) });
  await sw.dispatch(iconRequest());
  sw.clock.t += 29 * DAY;
  assert.equal((await sw.dispatch(iconRequest()))?.response.tag, 'v1');
  sw.clock.t += 2 * DAY;
  assert.equal((await sw.dispatch(iconRequest()))?.response.tag, 'v2', 'refetched once it is older than 30 days');
  assert.equal(sw.fetched.length, 2);
  assert.equal((await sw.dispatch(iconRequest()))?.response.tag, 'v2');
  assert.equal(sw.fetched.length, 2, 'and the new copy is fresh again');
});

test('a stale icon is served when the site cannot be reached; with no copy at all the request fails like the network', async () => {
  let online = true;
  const sw = loadSw({ fetch: async () => { if (!online) throw new TypeError('offline'); return opaque('copy'); } });
  await sw.dispatch(iconRequest());
  sw.clock.t += 60 * DAY;
  online = false;
  assert.equal((await sw.dispatch(iconRequest()))?.response.tag, 'copy', 'stale beats nothing');
  const cold = await sw.dispatch(iconRequest({ url: 'https://other.example.org/favicon.ico' }));
  assert.equal(cold?.response.type, 'error');
});

test('a readable failure is not cached; a readable success and an opaque answer are', async () => {
  const sw = loadSw({ fetch: async (r) => (r.url.includes('bad') ? { type: 'basic', ok: false, status: 404, clone() { return this; } } : { type: 'basic', ok: true, status: 200, tag: 'ok', clone() { return this; } }) });
  await sw.dispatch(iconRequest({ url: 'https://bad.example.net/favicon.ico' }));
  await sw.dispatch(iconRequest({ url: 'https://bad.example.net/favicon.ico' }));
  assert.equal(sw.fetched.length, 2, 'a 404 is asked for again');
  await sw.dispatch(iconRequest({ url: 'https://good.example.net/favicon.ico' }));
  await sw.dispatch(iconRequest({ url: 'https://good.example.net/favicon.ico' }));
  assert.equal(sw.fetched.length, 3, 'a success is kept');
});

test('a failing cache write (quota) never stops the image from showing', async () => {
  const sw = loadSw({ putFails: true, fetch: async () => opaque('shown') });
  const r = await sw.dispatch(iconRequest());
  assert.equal(r?.response.tag, 'shown');
});

test('only a cross-origin https /favicon.ico image GET is an icon request; everything else is left alone', async () => {
  const sw = loadSw();
  const untouched = [
    iconRequest({ method: 'POST' }),
    iconRequest({ destination: '' }),
    iconRequest({ destination: 'script' }),
    iconRequest({ url: 'https://site.example.net/logo.png' }),
    iconRequest({ url: 'https://site.example.net/a/favicon.ico.png' }),
    iconRequest({ url: 'http://site.example.net/favicon.ico' }),
    iconRequest({ url: `${ORIGIN}/favicon.ico` }),
    iconRequest({ url: 'https://site.example.net/api/state', destination: '' }),
    { method: 'GET', url: 'https://login.example.com/cdn-cgi/access/login', destination: 'document', mode: 'navigate' },
  ];
  for (const r of untouched) assert.equal(await sw.dispatch(r), undefined, `${r.method} ${r.url} ${r.destination}`);
  assert.equal(sw.fetched.length, 0);
  assert.deepEqual([...sw.stores.keys()], [], 'nothing from another origin was cached');
});

test('the shell rules stay: /api/* and cross-origin non-icon requests are never intercepted', async () => {
  const sw = loadSw({ fetch: async (r) => ({ type: 'basic', ok: true, status: 200, redirected: false, url: typeof r === 'string' ? r : r.url, clone() { return this; } }) });
  assert.equal(await sw.dispatch({ method: 'GET', url: `${ORIGIN}/api/state`, destination: '', mode: 'cors' }), undefined);
  assert.equal(await sw.dispatch({ method: 'GET', url: 'https://cdn.example.net/lib.js', destination: 'script', mode: 'cors' }), undefined);
  assert.deepEqual([...sw.stores.keys()], []);
});

test('the oldest icons are dropped beyond 200 entries, with their timestamps; the icon cache survives an update of the shell cache', async () => {
  const sw = loadSw({ fetch: async (r) => opaque(r.url) });
  for (let i = 0; i < 205; i++) {
    sw.clock.t += 1000;
    await sw.dispatch(iconRequest({ url: `https://s${i}.example.net/favicon.ico` }));
  }
  const m = /** @type {Map<string, any>} */ (sw.stores.get('fruitery-icons'));
  const icons = [...m.keys()].filter((k) => !k.includes('/__icon-stamp/'));
  assert.equal(icons.length, 200);
  assert.equal(icons.includes('https://s0.example.net/favicon.ico'), false, 'the oldest is gone');
  assert.equal(icons.includes('https://s204.example.net/favicon.ico'), true);
  assert.equal([...m.keys()].filter((k) => k.includes('/__icon-stamp/')).length, 200, 'no orphan timestamps');
  // activation removes old shell caches only
  await sw.caches.open('fruitery-shell-old');
  await sw.caches.open('fruitery-shell-test');
  /** @type {Promise<void> | undefined} */
  let waited;
  sw.listeners.activate({ waitUntil: (/** @type {Promise<void>} */ p) => { waited = p; } });
  await waited;
  assert.deepEqual([...sw.stores.keys()].sort(), ['fruitery-icons', 'fruitery-shell-test']);
});
