// @ts-check
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createSessions } from '../main/sessions.js';

const NOW = 1_700_000_000_000;

/** A fake Electron session module that records what the code does to each partition. */
function fakeElectron() {
  /** @type {Record<string, any>} */
  const parts = {};
  return {
    parts,
    electronSession: {
      fromPartition(/** @type {string} */ name) {
        parts[name] ??= (() => {
          /** @type {any} */ const ses = { name, set: [], flushes: 0, handlers: {}, headerHook: null, permission: null, check: null };
          ses.cookies = {
            on: (/** @type {string} */ ev, /** @type {Function} */ fn) => { ses.handlers[ev] = fn; },
            set: async (/** @type {any} */ d) => { ses.set.push(d); },
            flushStore: async () => { ses.flushes += 1; },
          };
          ses.webRequest = { onBeforeSendHeaders: (/** @type {Function} */ fn) => { ses.headerHook = fn; } };
          ses.setPermissionRequestHandler = (/** @type {Function} */ fn) => { ses.permission = fn; };
          ses.setPermissionCheckHandler = (/** @type {Function} */ fn) => { ses.check = fn; };
          return ses;
        })();
        return parts[name];
      },
    },
  };
}

/** @param {any} over */
const item = (over) => ({ id: 'i1', notify: false, isolate: false, persistSessionCookies: true, url: 'https://keep.example.com/', fallbackUrl: null, deleted: false, ...over });
/** @param {any} over */
const cookie = (over = {}) => ({ name: 'sid', value: 'v', domain: 'keep.example.com', hostOnly: true, path: '/', secure: true, httpOnly: true, session: true, sameSite: 'lax', ...over });

function setup(/** @type {any[]} */ items) {
  const f = fakeElectron();
  const s = createSessions({
    electronSession: f.electronSession,
    getSnapshot: () => ({ items }),
    itemIdOfWebContents: (wc) => wc?.itemId ?? null,
    popupUserAgent: (id) => (id === 77 ? 'PopupUA/1' : null),
    now: () => NOW,
  });
  return { ...f, s };
}

test('a session cookie is re-set as a 30-day persistent one as it is set (shared partition)', async () => {
  const { s, parts } = setup([item({})]);
  const { ses, partition } = s.sessionFor(item({}));
  assert.equal(partition, 'persist:fruitery');
  parts[partition].handlers.changed({}, cookie(), 'explicit', false);
  await new Promise((r) => setImmediate(r));
  assert.equal(ses.set.length, 1);
  assert.equal(ses.set[0].expirationDate, Math.floor(NOW / 1000) + 30 * 86400);
  assert.equal('domain' in ses.set[0], false, 'host-only stays host-only');
  assert.equal(ses.set[0].httpOnly, true);
  assert.equal(ses.set[0].sameSite, 'lax');
});

test('removed, already persistent and malformed cookie events do nothing (no re-set loop)', async () => {
  const { s } = setup([item({})]);
  const { ses } = s.sessionFor(item({}));
  ses.handlers.changed({}, cookie(), 'explicit', true);
  ses.handlers.changed({}, cookie({ session: false, expirationDate: NOW / 1000 + 10 }), 'explicit', false);
  ses.handlers.changed({}, cookie({ name: '' }), 'explicit', false);
  await new Promise((r) => setImmediate(r));
  assert.equal(ses.set.length, 0);
});

test('extend-short-logins off: cookies of that item\'s host stay session cookies; other hosts are converted', async () => {
  const items = [item({}), item({ id: 'i2', persistSessionCookies: false, url: 'https://www.private.example.org/x' })];
  const { s } = setup(items);
  const { ses } = s.sessionFor(items[0]);
  ses.handlers.changed({}, cookie({ domain: '.private.example.org', hostOnly: false }), 'explicit', false);
  ses.handlers.changed({}, cookie({ domain: 'login.private.example.org' }), 'explicit', false);
  ses.handlers.changed({}, cookie({ domain: 'keep.example.com' }), 'explicit', false);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ses.set.map((/** @type {any} */ d) => d.url), ['https://keep.example.com/']);
});

test('an isolated item has its own partition, and its flag opts the whole partition out', async () => {
  const iso = item({ id: 'iso', isolate: true, persistSessionCookies: false });
  const iso2 = item({ id: 'iso2', isolate: true });
  const { s, parts } = setup([iso, iso2]);
  const a = s.sessionFor(iso);
  const b = s.sessionFor(iso2);
  assert.deepEqual([a.partition, b.partition], ['persist:fruitery-iso', 'persist:fruitery-iso2']);
  a.ses.handlers.changed({}, cookie(), 'explicit', false);
  b.ses.handlers.changed({}, cookie(), 'explicit', false);
  await new Promise((r) => setImmediate(r));
  assert.equal(a.ses.set.length, 0);
  assert.equal(b.ses.set.length, 1);
  assert.deepEqual(Object.keys(parts).sort(), ['persist:fruitery-iso', 'persist:fruitery-iso2']);
});

test('the cookie store is flushed once, about a second after a burst of conversions', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { s } = setup([item({})]);
    const { ses } = s.sessionFor(item({}));
    for (let i = 0; i < 5; i++) ses.handlers.changed({}, cookie({ name: `c${i}` }), 'explicit', false);
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();
    assert.equal(ses.flushes, 0);
    mock.timers.tick(999);
    assert.equal(ses.flushes, 0);
    mock.timers.tick(2);
    await Promise.resolve();
    assert.equal(ses.flushes, 1);
  } finally {
    mock.timers.reset();
  }
});

test('each partition is set up once', () => {
  const { s, parts } = setup([item({})]);
  const a = s.sessionFor(item({}));
  const b = s.sessionFor(item({ id: 'other' }));
  assert.equal(a.ses, b.ses);
  assert.equal(Object.keys(parts).length, 1);
  assert.deepEqual(s.partitions(), ['persist:fruitery']);
});

test('permission handlers: notifications follow the item, others use the allow-list', () => {
  const items = [item({ id: 'on', notify: true }), item({ id: 'off', notify: false })];
  const { s } = setup(items);
  const { ses } = s.sessionFor(items[0]);
  /** @param {string} p @param {string} id */
  const ask = (p, id) => { /** @type {boolean | null} */ let r = null; ses.permission({ itemId: id }, p, (/** @type {boolean} */ g) => { r = g; }, {}); return r; };
  assert.equal(ask('notifications', 'on'), true);
  assert.equal(ask('notifications', 'off'), false);
  assert.equal(ask('geolocation', 'on'), false);
  assert.equal(ask('media', 'off'), true);
  assert.equal(ses.check({ itemId: 'on' }, 'notifications', 'https://x.example'), true);
  assert.equal(ses.check({ itemId: 'off' }, 'hid', 'https://x.example'), false);
  // no webContents: the requesting origin is matched to an item of the partition
  assert.equal(ses.check(null, 'notifications', 'https://unknown.example.com'), false);
  const withHost = [item({ id: 'h', notify: true, url: 'https://mail.example.net/inbox' })];
  const x = setup(withHost);
  assert.equal(x.s.sessionFor(withHost[0]).ses.check(null, 'notifications', 'https://mail.example.net'), true);
  assert.equal(x.s.sessionFor(withHost[0]).ses.check(null, 'notifications', 'https://evil.example.org'), false);
});

test('popups get their item\'s UA on the wire; other requests are untouched', () => {
  const { s } = setup([item({})]);
  const { ses } = s.sessionFor(item({}));
  /** @type {any} */ let out = null;
  ses.headerHook({ webContentsId: 77, requestHeaders: { 'User-Agent': 'Default', Accept: '*/*' } }, (/** @type {any} */ r) => { out = r; });
  assert.deepEqual(out, { requestHeaders: { 'User-Agent': 'PopupUA/1', Accept: '*/*' } });
  ses.headerHook({ webContentsId: 5, requestHeaders: { 'User-Agent': 'Default' } }, (/** @type {any} */ r) => { out = r; });
  assert.deepEqual(out, {});
  ses.headerHook({ requestHeaders: {} }, (/** @type {any} */ r) => { out = r; });
  assert.deepEqual(out, {});
});

test('flushAll flushes every partition now', async () => {
  const { s } = setup([item({}), item({ id: 'iso', isolate: true })]);
  const a = s.sessionFor(item({}));
  const b = s.sessionFor(item({ id: 'iso', isolate: true }));
  await s.flushAll();
  assert.equal(a.ses.flushes, 1);
  assert.equal(b.ses.flushes, 1);
});
