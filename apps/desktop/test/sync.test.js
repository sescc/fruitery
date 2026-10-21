// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SEED, mergeLww, periodKey, previousPeriodStart } from '../../../packages/core/index.js';
import { makeItem, utc } from '../../../packages/core/fixtures.js';
import { openStore } from '../main/store.js';
import { createSecrets } from '../main/secrets.js';
import { createSync } from '../main/sync.js';
import { createSyncSettings } from '../main/sync-settings.js';
import { enqueue } from '../lib/sync-plan.js';

const BASE = 'https://example.com';
const SEED_MAIL_NAME = SEED.items.find((i) => i.id === 'it-mail')?.name;
const T0 = utc('2026-10-20T12:00');
const TODAY = '2026-10-20';
const flush = () => new Promise((r) => setImmediate(r));
const settle = async () => {
  for (let i = 0; i < 25; i++) await flush();
};
const clone = (/** @type {any} */ v) => (v === undefined ? undefined : structuredClone(v));

function deferred() {
  /** @type {() => void} */
  let release = () => {};
  const promise = new Promise((r) => { release = () => r(undefined); });
  return { promise, release };
}

function fakeTimers() {
  let id = 0;
  /** @type {Map<number, () => void>} */
  const timeouts = new Map();
  /** @type {Map<number, () => void>} */
  const intervals = new Map();
  return {
    setTimeout: (/** @type {() => void} */ fn) => { timeouts.set(++id, fn); return id; },
    clearTimeout: (/** @type {number} */ h) => { timeouts.delete(h); },
    setInterval: (/** @type {() => void} */ fn) => { intervals.set(++id, fn); return id; },
    clearInterval: (/** @type {number} */ h) => { intervals.delete(h); },
    pendingTimeouts: () => timeouts.size,
    pendingIntervals: () => intervals.size,
    fireTimeouts() {
      const fns = [...timeouts.values()];
      timeouts.clear();
      for (const f of fns) f();
    },
    fireIntervals() {
      for (const f of [...intervals.values()]) f();
    },
  };
}

/**
 * A store in a temp folder, a fake Worker behind `requestApi`, fake timers, a settable clock.
 * @param {{configured?: boolean, secret?: string | null, firstDone?: boolean, expiresOn?: string | null}} [o]
 */
function setup(o = {}) {
  const { configured = true, firstDone = true } = o;
  const env = { t: T0, secret: o.secret === undefined ? 's3cret-value' : o.secret };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fruitery-sync-'));
  const store = openStore(dir, { seedText: null, now: () => env.t });
  // the server starts as a copy of the local data, as after a seed
  const snap = store.snapshot();
  const server = {
    state: /** @type {any} */ (clone({ workspaces: snap.workspaces, groups: snap.groups, items: snap.items, settings: snap.settings, completions: [] })),
    /** @type {((method: string, path: string, body: any) => Promise<void> | null) | null} */
    gate: null,
    /** @type {((method: string, path: string, body: any) => any) | null} */
    override: null,
    /** What the fake Worker lists in eatures (an old Worker lists none). @type {string[] | undefined} */
    features: /** @type {string[] | undefined} */ (['tick-done-at']),
  };
  /** @type {{method: string, path: string, body: any, key: any}[]} */
  const calls = [];
  let active = 0;
  let maxActive = 0;

  /** @param {string} method @param {string} p @param {any} body */
  function defaultAnswer(method, p, body) {
    const s = server.state;
    if (method === 'GET' && p === '/api/state') return { ok: true, json: { ...clone(s), serverNow: env.t, ...(server.features ? { features: [...server.features] } : {}) } };
    if (method === 'PUT' && p === '/api/entities') {
      const out = /** @type {any} */ ({ workspaces: [], groups: [], items: [], settings: null });
      for (const kind of /** @type {const} */ (['workspaces', 'groups', 'items'])) {
        const sent = body[kind] ?? [];
        const ids = new Set(sent.map((/** @type {any} */ e) => e.id));
        const merged = mergeLww(s[kind].filter((/** @type {any} */ e) => ids.has(e.id)), clone(sent));
        s[kind] = [...s[kind].filter((/** @type {any} */ e) => !ids.has(e.id)), ...merged];
        out[kind] = merged;
      }
      if (body.settings) {
        const [w] = mergeLww([s.settings], [clone(body.settings)]);
        s.settings = w;
        out.settings = w;
      }
      return { ok: true, json: out };
    }
    if (method === 'POST' && p === '/api/ticks') {
      const item = s.items.find((/** @type {any} */ i) => i.id === body.itemId && !i.deleted);
      if (!item) return { ok: false, kind: 'http', status: 404 };
      if (!item.schedule) return { ok: false, kind: 'http', status: 409 };
      let at = env.t;
      if (body.doneAt !== undefined && server.features) {
        if (body.doneAt > env.t + 5 * 60000) return { ok: false, kind: 'invalid', status: 422, json: { error: 'tick-in-future' } };
        if (body.doneAt < env.t - 48 * 3600000) return { ok: false, kind: 'invalid', status: 422, json: { error: 'tick-too-old' } };
        at = body.doneAt;
      }
      const pk = periodKey(item.schedule, at, s.settings.timezone, item.resetTime);
      if (pk === null) return { ok: false, kind: 'http', status: 409 };
      let c = s.completions.find((/** @type {any} */ x) => x.itemId === item.id && x.periodKey === pk);
      if (!c) s.completions.push((c = { itemId: item.id, periodKey: pk, doneAt: at }));
      return { ok: true, json: clone(c) };
    }
    if (method === 'DELETE' && p.startsWith('/api/ticks/')) {
      const [rawId, query = ''] = p.slice('/api/ticks/'.length).split('?');
      const id = decodeURIComponent(rawId);
      const item = s.items.find((/** @type {any} */ i) => i.id === id);
      let pk = item?.schedule ? periodKey(item.schedule, env.t, s.settings.timezone, item.resetTime) : null;
      const wanted = new URLSearchParams(query).get('periodKey');
      if (wanted && pk && server.features) {
        if (wanted !== pk && wanted !== previousPeriodStart(item.schedule, pk)) return { ok: false, kind: 'invalid', status: 422, json: { error: 'period-not-allowed' } };
        pk = wanted;
      }
      const before = s.completions.length;
      s.completions = s.completions.filter((/** @type {any} */ x) => !(x.itemId === id && x.periodKey === pk));
      return { ok: true, json: { removed: before - s.completions.length } };
    }
    return { ok: false, kind: 'http', status: 404 };
  }

  const requestApi = async (/** @type {any} */ key, /** @type {string} */ method, /** @type {string} */ p, /** @type {any} */ body) => {
    calls.push({ method, path: p, body: clone(body), key: { ...key } });
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      const wait = server.gate?.(method, p, body);
      if (wait) await wait;
      await flush();
      const custom = server.override?.(method, p, body);
      return custom ?? defaultAnswer(method, p, clone(body));
    } finally {
      active -= 1;
    }
  };

  const timers = fakeTimers();
  let changes = 0;
  const secrets = { loadSecret: () => env.secret };
  if (configured) {
    store.updateDevice({ sync: { baseUrl: BASE, clientId: 'client-id.access', expiresOn: o.expiresOn ?? null } });
    if (firstDone) store.setFirstSyncDoneFor(BASE);
  }
  const sync = createSync({ store, secrets, requestApi: /** @type {any} */ (requestApi), now: () => env.t, timers, onChange: () => { changes += 1; } });
  return {
    env, dir, store, server, calls, timers, sync,
    get maxActive() { return maxActive; },
    get changes() { return changes; },
    paths: () => calls.map((c) => `${c.method} ${c.path}`),
    count: (/** @type {string} */ m, /** @type {string} */ p) => calls.filter((c) => c.method === m && c.path === p).length,
  };
}

/** A valid item edit for the store (a new item in the first seed workspace). @param {string} name */
const newItem = (name) => ({ workspaceId: 'ws-productivity', name, url: 'https://a.example.com' });

// ---------------------------------------------------------------------------------------------
// local-only mode

test('local-only mode: no requests, no timers, no outbox growth, and the cache stays as it was', async () => {
  const t = setup({ configured: false });
  await t.sync.start();
  await t.sync.onFocus();
  assert.ok('ok' in t.store.upsert({ items: [newItem('Local only')] }));
  t.store.remove('item', 'it-gcal');
  t.store.reorder('item', null, 'it-mail', 0);
  assert.equal(t.calls.length, 0);
  assert.equal(t.timers.pendingTimeouts(), 0, 'no debounce for an edit');
  assert.deepEqual(t.store.outbox(), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(t.dir, 'cache.json'), 'utf8')).outbox, []);
  assert.equal(t.sync.liveStatus().status, 'not-connected');
});

test('configured but no readable secret (a copied data folder): not connected, no requests, ticking refused so no tick is lost', async () => {
  const t = setup({ secret: null });
  await t.sync.start();
  assert.equal(t.calls.length, 0);
  const live = t.sync.liveStatus();
  assert.equal(live.status, 'not-connected');
  assert.equal(live.ticksEnabled, false);
  assert.equal(t.sync.ticksEnabled(), false);
  t.store.snapshot().completions.push({ itemId: 'it-coding', periodKey: TODAY, doneAt: T0 });
  assert.deepEqual(await t.sync.tick('it-language'), { error: 'ticks-need-connection' });
  assert.deepEqual(await t.sync.untick('it-coding'), { error: 'ticks-need-connection' });
  assert.deepEqual(t.store.snapshot().completions, [{ itemId: 'it-coding', periodKey: TODAY, doneAt: T0 }], 'nothing changed locally');
  assert.equal(t.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------
// edits are queued

test('edits while configured queue the changed entities: upsert, settings, remove, reorder and moveItem; device settings are not synced', () => {
  const t = setup();
  const ids = /** @type {any} */ (t.store.upsert({ items: [newItem('Added')], workspaces: [{ id: 'ws-daily', name: 'Daily renamed' }], settings: { timezone: 'Asia/Tokyo' } })).ids;
  const kinds = () => t.store.outbox().map((o) => `${o.kind}:${o.entity.id ?? 'settings'}`).sort();
  assert.deepEqual(kinds(), [`items:${ids.items[0]}`, 'settings:settings', 'workspaces:ws-daily']);

  t.store.setOutbox([]);
  t.store.updateDevice({ listWidth: 300, edgeProfile: 'Profile 1' });
  t.store.setActiveWorkspace('ws-daily');
  assert.deepEqual(t.store.outbox(), [], 'device settings never go to the server');

  t.store.remove('group', 'g-study');
  assert.deepEqual(kinds(), ['groups:g-study', 'items:it-coding', 'items:it-language']);
  assert.equal(t.store.outbox().every((o) => o.entity.updatedAt === T0), true);

  t.store.setOutbox([]);
  t.store.reorder('item', null, 'it-mail', 3);
  assert.ok(t.store.outbox().length >= 2 && t.store.outbox().every((o) => o.kind === 'items'));
  assert.ok(t.store.outbox().some((o) => o.entity.id === 'it-mail'));

  t.store.setOutbox([]);
  t.store.moveItem('it-notes', 'ws-daily');
  assert.ok(t.store.outbox().some((o) => o.entity.id === 'it-notes' && o.entity.workspaceId === 'ws-daily'));

  t.store.setOutbox([]);
  t.store.remove('workspace', 'ws-daily');
  const removed = t.store.outbox();
  assert.ok(removed.some((o) => o.kind === 'workspaces' && o.entity.deleted));
  assert.ok(removed.some((o) => o.kind === 'groups' && o.entity.deleted));
  assert.ok(removed.some((o) => o.kind === 'items' && o.entity.deleted));
});

test('an invalid edit queues nothing', () => {
  const t = setup();
  const res = t.store.upsert({ items: [{ workspaceId: 'ws-productivity', name: '', url: 'nope' }] });
  assert.ok('errors' in res);
  assert.deepEqual(t.store.outbox(), []);
  assert.equal(t.timers.pendingTimeouts(), 0);
});

test('the debounce coalesces edits into one push 1 s after the last one', async () => {
  const t = setup();
  t.store.upsert({ items: [newItem('One')] });
  t.store.upsert({ items: [newItem('Two')] });
  t.store.upsert({ items: [newItem('Three')] });
  assert.equal(t.timers.pendingTimeouts(), 1, 'each edit restarts the same timer');
  assert.equal(t.calls.length, 0);
  t.timers.fireTimeouts();
  await settle();
  assert.deepEqual(t.paths(), ['PUT /api/entities', 'GET /api/state']);
  assert.equal(t.calls[0].body.items.length, 3);
  assert.deepEqual(t.store.outbox(), []);
});

// ---------------------------------------------------------------------------------------------
// the flight

test('one flight at a time: triggers during a flight give exactly one more run', async () => {
  const t = setup();
  const gate = deferred();
  let first = true;
  t.server.gate = (m, p) => {
    if (m === 'GET' && p === '/api/state' && first) {
      first = false;
      return gate.promise;
    }
    return null;
  };
  const a = t.sync.trigger();
  await flush();
  const b = t.sync.trigger();
  const c = t.sync.onFocus();
  void t.sync.trigger();
  assert.equal(t.count('GET', '/api/state'), 1, 'nothing starts while one flight is running');
  gate.release();
  await Promise.all([a, b, c]);
  assert.equal(t.count('GET', '/api/state'), 2, 'one run, plus exactly one more');
  assert.equal(t.maxActive, 1);
  assert.equal(t.sync.liveStatus().status, 'synced');
});

test('push before pull', async () => {
  const t = setup();
  t.store.upsert({ items: [newItem('Pushed first')] });
  await t.sync.trigger();
  assert.deepEqual(t.paths(), ['PUT /api/entities', 'GET /api/state']);
  assert.equal(t.server.state.items.some((/** @type {any} */ i) => i.name === 'Pushed first'), true);
  assert.deepEqual(t.store.outbox(), []);
});

test('batches of 100: 150 entities are two PUTs, then the pull', async () => {
  const t = setup();
  const items = Array.from({ length: 150 }, (_, i) => makeItem({ id: `bulk-${String(i).padStart(3, '0')}`, workspaceId: 'ws-daily', name: `Bulk ${i}`, schedule: null, updatedAt: T0 + 1 }));
  t.store.setOutbox(enqueue([], 'items', items));
  await t.sync.trigger();
  assert.deepEqual(t.paths(), ['PUT /api/entities', 'PUT /api/entities', 'GET /api/state']);
  assert.deepEqual(t.calls.slice(0, 2).map((c) => c.body.items.length), [100, 50]);
  assert.equal(t.store.snapshot().items.filter((i) => i.id.startsWith('bulk-')).length, 150);
  assert.deepEqual(t.store.outbox(), []);
});

test('workspaces and groups are sent before items, even in one big queue', async () => {
  const t = setup();
  const items = Array.from({ length: 100 }, (_, i) => makeItem({ id: `z-${i}`, workspaceId: 'ws-daily', schedule: null, updatedAt: T0 + 1 }));
  t.store.setOutbox(enqueue(enqueue([], 'items', items), 'groups', [{ id: 'g-late', workspaceId: 'ws-daily', name: 'Late', order: 9, collapsed: false, updatedAt: T0 + 1, deleted: false }]));
  await t.sync.trigger();
  assert.equal(t.calls[0].body.groups.length, 1, 'the group is in the first batch');
  assert.equal(t.calls[0].body.items.length, 99);
});

test('offline keeps the outbox, sets the status, and the next good flight sends it', async () => {
  const t = setup();
  t.store.upsert({ items: [newItem('Written offline')] });
  t.server.override = () => ({ ok: false, kind: 'offline' });
  await t.sync.trigger();
  assert.deepEqual(t.paths(), ['PUT /api/entities'], 'nothing else is tried once the connection is gone');
  assert.equal(t.sync.liveStatus().status, 'offline');
  assert.equal(t.sync.liveStatus().pending, 1);
  assert.equal(t.sync.liveStatus().ticksEnabled, true, 'offline: ticks are queued, not refused');
  assert.equal(t.store.outbox().length, 1);

  t.server.override = null;
  await t.sync.trigger();
  assert.equal(t.sync.liveStatus().status, 'synced');
  assert.equal(t.sync.liveStatus().pending, 0);
  assert.equal(t.sync.liveStatus().lastSyncAt, T0);
  assert.equal(t.server.state.items.some((/** @type {any} */ i) => i.name === 'Written offline'), true);
});

test('a 403 shows error:<reason>, stops the flight, and clears on the next success', async () => {
  const t = setup();
  t.store.upsert({ items: [newItem('Held')] });
  t.server.override = () => ({ ok: false, kind: 'denied', reason: 'service-token-not-allowed' });
  await t.sync.trigger();
  assert.deepEqual(t.paths(), ['PUT /api/entities']);
  assert.equal(t.sync.liveStatus().status, 'error:service-token-not-allowed');
  assert.equal(t.store.outbox().length, 1);

  t.server.override = () => ({ ok: false, kind: 'refused', reason: 'access-key-refused' });
  await t.sync.trigger();
  assert.equal(t.sync.liveStatus().status, 'error:access-key-refused');

  t.server.override = null;
  await t.sync.trigger();
  assert.equal(t.sync.liveStatus().status, 'synced');
});

test('a 422 marks the listed entry, still sends the others, and the pull still happens', async () => {
  const t = setup();
  const bad = makeItem({ id: 'bad', workspaceId: 'ws-daily', name: 'Bad one', schedule: null, updatedAt: T0 + 1 });
  const good = makeItem({ id: 'good', workspaceId: 'ws-daily', name: 'Good one', schedule: null, updatedAt: T0 + 1 });
  t.store.setOutbox(enqueue([], 'items', [bad, good]));
  t.server.override = (m, p, body) => {
    if (m === 'PUT' && body.items.some((/** @type {any} */ i) => i.id === 'bad')) {
      return { ok: false, kind: 'invalid', status: 422, json: { error: 'invalid', details: [{ id: 'bad', errors: [{ field: 'url', code: 'invalid-url' }] }] } };
    }
    return null;
  };
  await t.sync.trigger();
  assert.deepEqual(t.paths(), ['PUT /api/entities', 'PUT /api/entities', 'GET /api/state']);
  assert.deepEqual(t.calls[1].body.items.map((/** @type {any} */ i) => i.id), ['good']);
  const live = t.sync.liveStatus();
  assert.deepEqual(live.rejected, [{ kind: 'items', id: 'bad', name: 'Bad one', errors: [{ field: 'url', code: 'invalid-url' }] }]);
  assert.equal(live.pending, 1);
  assert.equal(live.status, 'synced', 'a rejected entry is not a sync error');
  assert.equal(t.store.snapshot().items.some((i) => i.id === 'bad'), true, 'the rejected entry stays in the local data');

  // fixing it (a newer edit) clears the mark and sends it again
  t.server.override = null;
  t.store.setOutbox(enqueue(t.store.outbox(), 'items', [{ ...bad, name: 'Fixed', updatedAt: T0 + 5 }]));
  await t.sync.trigger();
  assert.equal(t.sync.liveStatus().pending, 0);
  assert.equal(t.server.state.items.find((/** @type {any} */ i) => i.id === 'bad').name, 'Fixed');
});

test('discard drops a rejected entry and the pull brings back the server\'s version; a local-only entry disappears', async () => {
  const t = setup();
  t.store.upsert({ items: [{ id: 'it-mail', name: 'Mail broken locally' }] });
  const added = /** @type {any} */ (t.store.upsert({ items: [newItem('Never accepted')] })).ids.items[0];
  const rejectAll = (/** @type {string} */ m, /** @type {string} */ _p, /** @type {any} */ body) => m === 'PUT'
    ? { ok: false, kind: 'invalid', status: 422, json: { error: 'invalid', details: body.items.map((/** @type {any} */ i) => ({ id: i.id, errors: [{ field: 'name', code: 'required' }] })) } }
    : null;
  t.server.override = rejectAll;
  await t.sync.trigger();
  assert.equal(t.sync.liveStatus().rejected.length, 2);

  // only rejected entries can be discarded, and unknown ones are not found
  assert.deepEqual(t.sync.discard('items', 'nope'), { ok: false, error: 'not-found' });
  t.server.override = null;
  assert.deepEqual(t.sync.discard('items', 'it-mail'), { ok: true });
  await settle();
  assert.equal(t.store.snapshot().items.find((i) => i.id === 'it-mail')?.name, SEED_MAIL_NAME, 'the server\'s version is back');
  assert.equal(t.sync.liveStatus().rejected.length, 1);
  assert.deepEqual(t.sync.discard('items', added), { ok: true });
  await settle();
  assert.equal(t.store.snapshot().items.some((i) => i.id === added), false, 'a change the server never had is gone');
  assert.deepEqual(t.sync.liveStatus().rejected, []);
  assert.equal(t.sync.liveStatus().pending, 0);
});

test('a valid pending entry cannot be discarded through the rejected list', async () => {
  const t = setup();
  t.store.upsert({ items: [newItem('Waiting')] });
  const id = t.store.outbox()[0].entity.id;
  assert.deepEqual(t.sync.discard('items', id), { ok: false, error: 'not-found' });
  assert.equal(t.store.outbox().length, 1);
});

test('settings can be discarded without an id', async () => {
  const t = setup();
  t.store.upsert({ settings: { timezone: 'Asia/Tokyo' } });
  t.server.override = (m) => (m === 'PUT' ? { ok: false, kind: 'invalid', status: 422, json: { error: 'invalid', details: [{ id: 'settings', errors: [{ field: 'timezone', code: 'invalid-timezone' }] }] } } : null);
  await t.sync.trigger();
  assert.deepEqual(t.sync.liveStatus().rejected.map((r) => [r.kind, r.id, r.name]), [['settings', null, 'Settings']]);
  t.server.override = null;
  assert.deepEqual(t.sync.discard('settings', null), { ok: true });
  await settle();
  assert.equal(t.store.snapshot().settings.timezone, 'UTC');
});

test('a 400 with nothing to mark is error:http-400, is not retried in a loop, still pulls, and clears when a push works', async () => {
  const t = setup();
  t.store.upsert({ items: [newItem('Odd')] });
  t.server.override = (m) => (m === 'PUT' ? { ok: false, kind: 'http', status: 400 } : null);
  await t.sync.trigger();
  assert.deepEqual(t.paths(), ['PUT /api/entities', 'GET /api/state']);
  assert.equal(t.sync.liveStatus().status, 'error:http-400');
  assert.equal(t.sync.liveStatus().lastSyncAt, null);
  assert.equal(t.store.outbox().length, 1);

  // a 422 that names nothing we sent behaves the same way
  t.calls.length = 0;
  t.server.override = (m) => (m === 'PUT' ? { ok: false, kind: 'invalid', status: 422, json: { error: 'invalid', details: [{ id: 'unrelated', errors: [{ field: 'x', code: 'y' }] }] } } : null);
  await t.sync.trigger();
  assert.equal(t.count('PUT', '/api/entities'), 1);
  assert.equal(t.sync.liveStatus().status, 'error:http-422');

  t.server.override = null;
  await t.sync.trigger();
  assert.equal(t.sync.liveStatus().status, 'synced');
  assert.equal(t.sync.liveStatus().pending, 0);
});

test('an answer that confirms nothing does not loop either', async () => {
  const t = setup();
  t.store.upsert({ items: [newItem('Unconfirmed')] });
  t.server.override = (m) => (m === 'PUT' ? { ok: true, json: { workspaces: [], groups: [], items: [], settings: null } } : null);
  await t.sync.trigger();
  assert.equal(t.count('PUT', '/api/entities'), 1);
  assert.equal(t.sync.liveStatus().status, 'error:push-stalled');
});

test('an edit made while a push is in flight is kept and sent in the same flight', async () => {
  const t = setup();
  const created = /** @type {any} */ (t.store.upsert({ items: [newItem('Before')] }));
  const id = created.ids.items[0];
  const gate = deferred();
  let n = 0;
  t.server.gate = (m) => (m === 'PUT' && n++ === 0 ? gate.promise : null);
  const flight = t.sync.trigger();
  await flush();
  t.env.t += 50;
  t.store.upsert({ items: [{ id, name: 'After' }] });
  gate.release();
  await flight;
  assert.equal(t.count('PUT', '/api/entities'), 2);
  assert.equal(t.calls[1].body.items[0].name, 'After');
  assert.deepEqual(t.store.outbox(), []);
  assert.equal(t.server.state.items.find((/** @type {any} */ i) => i.id === id).name, 'After');
  assert.equal(t.store.snapshot().items.find((i) => i.id === id)?.name, 'After');
});

test('an edit made while the pull is in flight survives the merge', async () => {
  const t = setup();
  const gate = deferred();
  t.server.gate = (m) => (m === 'GET' ? gate.promise : null);
  const flight = t.sync.trigger();
  await flush();
  t.env.t += 50;
  t.store.upsert({ items: [{ id: 'it-gcal', name: 'Renamed during the pull' }] });
  gate.release();
  await flight;
  assert.equal(t.store.snapshot().items.find((i) => i.id === 'it-gcal')?.name, 'Renamed during the pull');
  assert.equal(t.store.outbox().length === 0 || t.store.outbox()[0].entity.id === 'it-gcal', true);
});

test('the pull brings in the other devices\' changes, tombstones and completions', async () => {
  const t = setup();
  t.server.state.items.find((/** @type {any} */ i) => i.id === 'it-mail').name = 'Renamed elsewhere';
  t.server.state.items.find((/** @type {any} */ i) => i.id === 'it-mail').updatedAt = T0 + 10;
  t.server.state.items.find((/** @type {any} */ i) => i.id === 'it-notes').deleted = true;
  t.server.state.items.find((/** @type {any} */ i) => i.id === 'it-notes').updatedAt = T0 + 10;
  t.server.state.completions.push({ itemId: 'it-language', periodKey: TODAY, doneAt: T0 });
  await t.sync.trigger();
  const snap = t.store.snapshot();
  assert.equal(snap.items.find((i) => i.id === 'it-mail')?.name, 'Renamed elsewhere');
  assert.equal(snap.items.find((i) => i.id === 'it-notes')?.deleted, true);
  assert.deepEqual(snap.completions, [{ itemId: 'it-language', periodKey: TODAY, doneAt: T0 }]);
  assert.ok(t.changes > 0, 'the UI is told');
});

test('a pull that changes nothing does not rewrite the cache', async () => {
  const t = setup();
  await t.sync.trigger();
  const before = fs.statSync(path.join(t.dir, 'cache.json')).mtimeMs;
  await new Promise((r) => setTimeout(r, 15));
  await t.sync.trigger();
  assert.equal(fs.statSync(path.join(t.dir, 'cache.json')).mtimeMs, before);
  assert.deepEqual(t.store.applyRemote(clone(t.server.state)), { ok: true, changed: false });
});

test('the UI is told when the status changes, and not when nothing changed', async () => {
  const t = setup();
  await t.sync.trigger();
  const settled = t.changes;
  t.sync.liveStatus();
  assert.equal(t.changes, settled, 'reading the status notifies nothing');
  t.server.override = () => ({ ok: false, kind: 'offline' });
  await t.sync.trigger();
  assert.ok(t.changes > settled);
});

// ---------------------------------------------------------------------------------------------
// first connect

/** A scheduled seed item and the setup of a PC that has local edits made before connecting. */
function firstConnectSetup() {
  const t = setup({ configured: false });
  t.env.t = T0 + 1000;
  t.store.upsert({ items: [{ id: 'it-language', name: 'Edited locally' }] }); // updatedAt T0+1000, not queued (local-only)
  assert.ok('ok' in t.store.tick('it-language'), 'a local tick in the current period');
  t.store.snapshot().completions.push({ itemId: 'it-coding', periodKey: '2026-10-01', doneAt: T0 - 86400000 * 19 }); // a past period
  t.store.snapshot().completions.push({ itemId: 'it-tasks', periodKey: TODAY, doneAt: T0 }); // an unscheduled item
  // the server has older data of the same item, and an item of its own
  const srv = t.server.state.items.find((/** @type {any} */ i) => i.id === 'it-language');
  srv.name = 'Older on the server';
  srv.updatedAt = T0 + 500;
  t.server.state.items.push(clone({ ...t.store.snapshot().items.find((i) => i.id === 'it-coding'), id: 'srv-only', name: 'Server only', updatedAt: T0 + 600 }));
  t.store.updateDevice({ sync: { baseUrl: BASE, clientId: 'client-id.access', expiresOn: null } });
  return t;
}

test('first connect: backs up the cache, pushes the newer local edit, posts the current-period ticks, pulls, then sets the marker', async () => {
  const t = firstConnectSetup();
  assert.equal(t.store.firstSyncDoneFor(), null);
  await t.sync.trigger();
  assert.deepEqual(t.paths(), ['GET /api/state', 'PUT /api/entities', 'POST /api/ticks', 'GET /api/state']);
  assert.deepEqual(t.calls[1].body.items.map((/** @type {any} */ i) => i.id), ['it-language'], 'only the edited, newer entity; seed rows (updatedAt 0) are not pushed');
  assert.deepEqual(t.calls[2].body, { itemId: 'it-language' }, 'only the current-period tick of a scheduled item');
  const backups = fs.readdirSync(t.dir).filter((f) => f.startsWith('cache.pre-sync-'));
  assert.equal(backups.length, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(t.dir, backups[0]), 'utf8'));
  assert.equal(saved.items.find((/** @type {any} */ i) => i.id === 'it-language').name, 'Edited locally', 'the backup holds the data from before the sync');
  assert.equal(t.server.state.items.find((/** @type {any} */ i) => i.id === 'it-language').name, 'Edited locally');
  assert.equal(t.store.snapshot().items.some((i) => i.id === 'srv-only'), true, 'the server\'s own item arrives');
  assert.deepEqual(t.store.snapshot().completions, [{ itemId: 'it-language', periodKey: TODAY, doneAt: T0 + 1000 }], 'the server history replaces the local completions');
  assert.equal(t.store.firstSyncDoneFor(), BASE);
  assert.equal(t.sync.liveStatus().status, 'synced');

  // the next flight is an ordinary one
  t.calls.length = 0;
  await t.sync.trigger();
  assert.deepEqual(t.paths(), ['GET /api/state']);
  assert.equal(fs.readdirSync(t.dir).filter((f) => f.startsWith('cache.pre-sync-')).length, 1);
});

test('first connect: a newer server entity is not overwritten by an older local edit', async () => {
  const t = firstConnectSetup();
  const srv = t.server.state.items.find((/** @type {any} */ i) => i.id === 'it-language');
  srv.updatedAt = T0 + 5000;
  srv.name = 'Newer on the server';
  await t.sync.trigger();
  assert.equal(t.calls.some((c) => c.method === 'PUT'), false);
  assert.equal(t.store.snapshot().items.find((i) => i.id === 'it-language')?.name, 'Newer on the server');
});

test('a failed first connect is retried next time and the marker is set only on success', async () => {
  const t = firstConnectSetup();
  t.server.override = (m, p) => (m === 'POST' && p === '/api/ticks' ? { ok: false, kind: 'offline' } : null);
  await t.sync.trigger();
  assert.equal(t.store.firstSyncDoneFor(), null);
  assert.equal(t.sync.liveStatus().status, 'offline');
  assert.equal(t.count('GET', '/api/state'), 1, 'no pull after the failure');

  t.server.override = null;
  await t.sync.trigger();
  assert.equal(t.store.firstSyncDoneFor(), BASE);
  assert.equal(t.sync.liveStatus().status, 'synced');
  assert.equal(t.server.state.completions.length, 1);
  assert.equal(fs.readdirSync(t.dir).filter((f) => f.startsWith('cache.pre-sync-')).length, 1, 'one backup, not one per attempt');
});

test('a first connect that cannot even read the server sets nothing', async () => {
  const t = firstConnectSetup();
  t.server.override = () => ({ ok: false, kind: 'denied', reason: 'email-mismatch' });
  await t.sync.trigger();
  assert.equal(t.store.firstSyncDoneFor(), null);
  assert.equal(t.sync.liveStatus().status, 'error:email-mismatch');
  assert.equal(fs.readdirSync(t.dir).some((f) => f.startsWith('cache.pre-sync-')), false, 'no backup before the server answered');
});

test('a ticked item the server does not know is skipped, not an error', async () => {
  const t = firstConnectSetup();
  t.server.state.items = t.server.state.items.filter((/** @type {any} */ i) => i.id !== 'it-language');
  // the local edit is pushed first, so the server learns the item before the tick
  await t.sync.trigger();
  assert.equal(t.sync.liveStatus().status, 'synced');
  assert.equal(t.server.state.completions.length, 1);
});

test('changing the address starts a first connect again', async () => {
  const t = setup();
  t.store.updateDevice({ sync: { baseUrl: 'https://other.example.com', clientId: 'client-id.access', expiresOn: null } });
  await t.sync.trigger();
  assert.equal(t.calls[0].path, '/api/state');
  assert.equal(t.calls[0].method, 'GET');
  assert.equal(t.store.firstSyncDoneFor(), 'https://other.example.com');
  assert.equal(t.calls[0].key.baseUrl, 'https://other.example.com');
});

// ---------------------------------------------------------------------------------------------
// settings screen + disconnect

test('disconnect resets the first-sync marker and the queue; the status carries no secret and no full client id', async () => {
  const t = setup({ configured: false });
  let key = 'user-a';
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (/** @type {string} */ p) => Buffer.from(`v10:${key}:${Buffer.from(p).toString('base64')}`),
    decryptString: (/** @type {Buffer} */ b) => {
      const m = /^v10:([^:]*):(.*)$/s.exec(b.toString());
      if (!m || m[1] !== key) throw new Error('decrypt');
      return Buffer.from(m[2], 'base64').toString();
    },
  };
  const secrets = createSecrets({ dir: t.dir, safeStorage });
  const requestApi = async (/** @type {any} */ k, /** @type {string} */ m, /** @type {string} */ p, /** @type {any} */ b) => {
    t.calls.push({ method: m, path: p, body: clone(b), key: { ...k } });
    return m === 'GET' ? { ok: true, json: { ...clone(t.server.state) } } : { ok: true, json: {} };
  };
  const engine = createSync({ store: t.store, secrets, requestApi: /** @type {any} */ (requestApi), now: () => t.env.t, timers: fakeTimers() });
  const settings = createSyncSettings({ store: t.store, secrets, requestApi: /** @type {any} */ (requestApi), allowLocal: false, engine });

  assert.equal(settings.status().status, 'not-connected');
  assert.deepEqual(settings.configure({ baseUrl: BASE, clientId: 'abc123.access', secret: 'plaintext-secret-value', expiresOn: '2027-01-01' }), { ok: true });
  await settle();
  assert.equal(t.store.firstSyncDoneFor(), BASE, 'saving the key starts the first sync');
  const st = settings.status();
  assert.equal(st.status, 'synced');
  assert.equal(st.connected, true);
  assert.equal(typeof st.lastSyncAt, 'number');
  assert.equal(st.pending, 0);
  assert.deepEqual(st.rejected, []);
  const shown = JSON.stringify(st);
  assert.equal(shown.includes('plaintext-secret-value') || shown.includes('abc123'), false);
  assert.equal(t.calls.every((c) => c.key.secret === 'plaintext-secret-value'), true, 'the secret goes only to requestApi');

  t.store.upsert({ items: [newItem('Queued')] });
  assert.equal(t.store.outbox().length, 1);
  settings.disconnect();
  assert.equal(t.store.firstSyncDoneFor(), null);
  assert.deepEqual(t.store.outbox(), []);
  assert.equal(settings.status().status, 'not-connected');
  assert.equal(settings.status().lastSyncAt, null);
  key = 'user-b';
});

test('the key expiring soon or expired shows in the status', async () => {
  const soon = setup({ expiresOn: '2026-10-30' });
  assert.equal(soon.sync.liveStatus().status, 'expiring:10');
  assert.equal(soon.sync.liveStatus().ticksEnabled, true);
  const gone = setup({ expiresOn: '2026-10-19' });
  assert.equal(gone.sync.liveStatus().status, 'expired');
  assert.equal(gone.sync.liveStatus().ticksEnabled, false);
});

// ---------------------------------------------------------------------------------------------
// scheduler

test('start runs one flight and schedules the 60 s interval; focus and the interval trigger more', async () => {
  const t = setup();
  await t.sync.start();
  assert.equal(t.timers.pendingIntervals(), 1);
  assert.equal(t.count('GET', '/api/state'), 1);
  await t.sync.onFocus();
  assert.equal(t.count('GET', '/api/state'), 2);
  t.timers.fireIntervals();
  await settle();
  assert.equal(t.count('GET', '/api/state'), 3);
  t.sync.stop();
  assert.equal(t.timers.pendingIntervals(), 0);
});

// ---------------------------------------------------------------------------------------------
// ticks

test('connected: tick goes through POST /api/ticks and the returned completion is stored; untick uses DELETE', async () => {
  const t = setup();
  const res = await t.sync.tick('it-language');
  assert.deepEqual(t.calls.map((c) => `${c.method} ${c.path}`), ['POST /api/ticks']);
  assert.deepEqual(t.calls[0].body, { itemId: 'it-language' });
  assert.ok('ok' in res && res.created);
  assert.deepEqual(t.store.snapshot().completions, [{ itemId: 'it-language', periodKey: TODAY, doneAt: T0 }]);
  assert.equal(t.timers.pendingTimeouts(), 1, 'a pull follows soon');

  const again = await t.sync.tick('it-language');
  assert.ok('ok' in again && !again.created);
  assert.equal(t.count('POST', '/api/ticks'), 1, 'already ticked: no second request');

  const un = await t.sync.untick('it-language');
  assert.equal(t.calls.at(-1)?.method, 'DELETE');
  assert.equal(t.calls.at(-1)?.path, '/api/ticks/it-language');
  assert.ok('ok' in un && un.removed === 1);
  assert.deepEqual(t.store.snapshot().completions, []);
});

test('connected: ticks keep the local error codes for unknown and unscheduled items, without a request', async () => {
  const t = setup();
  assert.deepEqual(await t.sync.tick('nope'), { error: 'not-found' });
  assert.deepEqual(await t.sync.tick('it-gcal'), { error: 'not-scheduled' });
  assert.deepEqual(await t.sync.untick('it-gcal'), { error: 'not-scheduled' });
  assert.equal(t.calls.length, 0);
});

test('offline: tick and untick are applied at once, queued, and no request is made; ticking stays enabled', async () => {
  const t = setup();
  t.server.override = () => ({ ok: false, kind: 'offline' });
  await t.sync.trigger();
  t.calls.length = 0;
  t.store.snapshot().completions.push({ itemId: 'it-coding', periodKey: TODAY, doneAt: T0 - 5 });
  const ticked = /** @type {any} */ (await t.sync.tick('it-language'));
  assert.deepEqual([ticked.ok, ticked.created, ticked.pending], [true, true, true]);
  const unticked = /** @type {any} */ (await t.sync.untick('it-coding'));
  assert.deepEqual([unticked.ok, unticked.removed, unticked.pending], [true, 1, true]);
  assert.equal(t.calls.length, 0, 'no request is made');
  assert.deepEqual(t.store.snapshot().completions, [{ itemId: 'it-language', periodKey: TODAY, doneAt: T0 }]);
  assert.deepEqual(t.store.tickOutbox().map((o) => `${o.op}:${o.itemId}`), ['tick:it-language', 'untick:it-coding']);
  assert.equal(t.sync.ticksEnabled(), true);
  assert.equal(t.sync.liveStatus().pending, 2, 'queued ticks count as waiting');
});

test('a sync error also queues ticks; an expired key or a missing secret still refuses them', async () => {
  const err = setup();
  err.server.override = () => ({ ok: false, kind: 'denied', reason: 'email-mismatch' });
  await err.sync.trigger();
  assert.equal(err.sync.liveStatus().status, 'error:email-mismatch');
  assert.equal(err.sync.liveStatus().ticksEnabled, true);
  assert.ok('ok' in (await err.sync.tick('it-language')));
  assert.equal(err.store.tickOutbox().length, 1);

  const exp = setup({ expiresOn: '2026-10-19' });
  assert.deepEqual(await exp.sync.tick('it-language'), { error: 'ticks-need-connection' });
  assert.deepEqual(await exp.sync.untick('it-language'), { error: 'ticks-need-connection' });
  assert.equal(exp.calls.length, 0);
  assert.deepEqual([exp.store.snapshot().completions, exp.store.tickOutbox()], [[], []]);
  assert.equal(exp.sync.ticksEnabled(), false);
});

test('a direct tick whose request fails on the connection is queued, and the status says offline', async () => {
  const t = setup();
  t.server.override = () => ({ ok: false, kind: 'offline' });
  const res = /** @type {any} */ (await t.sync.tick('it-language'));
  assert.deepEqual([res.ok, res.pending], [true, true]);
  assert.equal(t.sync.liveStatus().status, 'offline');
  assert.deepEqual(t.store.snapshot().completions.map((c) => c.itemId), ['it-language']);
  assert.equal(t.store.tickOutbox().length, 1);
  assert.equal(t.sync.ticksEnabled(), true);
  // an untick whose request fails queues too (the status is offline already, so no request is made)
  t.calls.length = 0;
  const un = /** @type {any} */ (await t.sync.untick('it-language'));
  assert.deepEqual([un.ok, un.removed], [true, 1]);
  assert.deepEqual(t.store.tickOutbox(), [], 'a waiting tick and its untick cancel out');
  assert.equal(t.calls.length, 0);
});

test('a connected tick whose request is refused with a 5xx is queued as well', async () => {
  const t = setup();
  t.server.override = (m, p) => (m === 'POST' && p === '/api/ticks' ? { ok: false, kind: 'http', status: 503 } : null);
  const res = /** @type {any} */ (await t.sync.tick('it-language'));
  assert.deepEqual([res.ok, res.pending], [true, true]);
  assert.equal(t.store.tickOutbox().length, 1);
});

test('queued ticks are sent in order after the push and before the pull, with doneAt and periodKey, and leave the queue', async () => {
  const t = setup();
  t.server.override = () => ({ ok: false, kind: 'offline' });
  await t.sync.trigger();
  t.env.t = T0 - 12 * 3600000; // yesterday evening, 2026-10-19T... wait: T0 is 2026-10-20T12:00Z
  await t.sync.tick('it-language');
  t.env.t = T0;
  t.store.snapshot().completions.push({ itemId: 'it-coding', periodKey: TODAY, doneAt: T0 - 5 });
  t.server.state.completions.push({ itemId: 'it-coding', periodKey: TODAY, doneAt: T0 - 5 });
  await t.sync.untick('it-coding');
  t.store.upsert({ items: [newItem('Pushed first')] });
  t.server.override = null;
  t.calls.length = 0;
  await t.sync.trigger();
  assert.deepEqual(t.paths(), ['PUT /api/entities', 'GET /api/state', 'POST /api/ticks', 'DELETE /api/ticks/it-coding?periodKey=2026-10-20', 'GET /api/state'], 'the first GET reads the Worker\'s abilities before anything is sent (nothing was read yet this session)');
  assert.deepEqual(t.calls[2].body, { itemId: 'it-language', doneAt: T0 - 12 * 3600000 });
  assert.deepEqual(t.store.tickOutbox(), []);
  assert.deepEqual(t.server.state.completions.map((c) => `${c.itemId}:${c.periodKey}`), ['it-language:2026-10-20']);
  assert.equal(t.sync.liveStatus().status, 'synced');
  assert.equal(t.sync.liveStatus().pending, 0);
});

test('a tick made late yesterday is stored for yesterday although it is sent today (the day boundary)', async () => {
  const t = setup();
  t.env.t = utc('2026-10-19T22:30');
  t.server.override = () => ({ ok: false, kind: 'offline' });
  await t.sync.trigger();
  await t.sync.tick('it-language');
  assert.equal(t.store.snapshot().completions[0].periodKey, '2026-10-19');
  t.env.t = utc('2026-10-20T08:00');
  t.server.override = null;
  await t.sync.trigger();
  assert.deepEqual(t.server.state.completions, [{ itemId: 'it-language', periodKey: '2026-10-19', doneAt: utc('2026-10-19T22:30') }]);
  assert.deepEqual(t.store.snapshot().completions, [{ itemId: 'it-language', periodKey: '2026-10-19', doneAt: utc('2026-10-19T22:30') }]);
});

test('a queued tick survives the pull while it waits, and an untick of yesterday uses periodKey', async () => {
  const t = setup();
  t.env.t = utc('2026-10-19T22:00');
  t.server.state.completions.push({ itemId: 'it-language', periodKey: '2026-10-19', doneAt: utc('2026-10-19T21:00') });
  await t.sync.trigger();
  assert.equal(t.store.snapshot().completions.length, 1);
  t.server.override = () => ({ ok: false, kind: 'offline' });
  await t.sync.trigger();
  await t.sync.untick('it-language'); // offline, still the 19th: a queued untick
  assert.deepEqual(t.store.snapshot().completions, []);
  // a pull while the queue waits does not bring the completion back
  t.server.override = (m, p) => (m === 'PUT' || (m === 'POST' && p.startsWith('/api/ticks')) || (m === 'DELETE') ? { ok: false, kind: 'offline' } : null);
  await t.sync.trigger();
  assert.deepEqual(t.store.snapshot().completions, [], 'the pending untick hides the server\'s completion');
  t.env.t = utc('2026-10-20T07:00'); // sent the next morning: yesterday's period is still allowed
  t.server.override = null;
  await t.sync.trigger();
  assert.deepEqual(t.server.state.completions, []);
  assert.deepEqual(t.store.tickOutbox(), []);
});

test('refused ticks are dropped with a notice: too old, from the future, period not allowed; the rest of the queue goes on', async () => {
  const t = setup();
  t.store.setTickOutbox([
    { op: 'tick', itemId: 'it-language', periodKey: '2026-10-17', doneAt: T0 - 50 * 3600000 },
    { op: 'tick', itemId: 'it-coding', periodKey: TODAY, doneAt: T0 + 10 * 60000 },
    { op: 'untick', itemId: 'it-rewards', periodKey: '2026-10-10' },
    { op: 'tick', itemId: 'it-word-game', periodKey: TODAY, doneAt: T0 - 1000 },
  ]);
  t.store.snapshot().completions.push({ itemId: 'it-language', periodKey: '2026-10-17', doneAt: T0 - 50 * 3600000 });
  await t.sync.trigger();
  assert.deepEqual(t.store.tickOutbox(), []);
  assert.deepEqual(t.sync.liveStatus().droppedTicks.map((n) => [n.itemId, n.reason]), [['it-language', 'tick-too-old'], ['it-coding', 'tick-in-future'], ['it-rewards', 'period-not-allowed']]);
  assert.equal(t.sync.liveStatus().droppedTicks[0].name, SEED.items.find((i) => i.id === 'it-language')?.name);
  assert.deepEqual(t.server.state.completions.map((c) => c.itemId), ['it-word-game'], 'the valid one went through');
  assert.equal(t.store.snapshot().completions.some((c) => c.itemId === 'it-language'), false, 'a refused tick leaves the local data');
  assert.equal(t.sync.liveStatus().status, 'synced', 'a refusal is not a sync error');
  // dismissing removes a notice
  const id = t.sync.liveStatus().droppedTicks[0].id;
  assert.equal(t.sync.dismissTickNotice(id), true);
  assert.equal(t.sync.dismissTickNotice(id), false);
  assert.equal(t.sync.liveStatus().droppedTicks.length, 2);
});

test('a tick for an item that is gone or not tickable (404, 409) is dropped silently', async () => {
  const t = setup();
  t.store.setTickOutbox([{ op: 'tick', itemId: 'gone', periodKey: TODAY, doneAt: T0 }, { op: 'tick', itemId: 'it-tasks', periodKey: TODAY, doneAt: T0 }]);
  await t.sync.trigger();
  assert.deepEqual(t.store.tickOutbox(), []);
  assert.deepEqual(t.sync.liveStatus().droppedTicks, []);
});

test('offline, denied and refused stop the tick queue and keep it; a 5xx stops it with http-<status> but still pulls', async () => {
  const t = setup();
  t.store.setTickOutbox([{ op: 'tick', itemId: 'it-language', periodKey: TODAY, doneAt: T0 }, { op: 'tick', itemId: 'it-coding', periodKey: TODAY, doneAt: T0 }]);
  t.server.override = (m, p) => (m === 'POST' ? { ok: false, kind: 'offline' } : null);
  await t.sync.trigger();
  assert.equal(t.sync.liveStatus().status, 'offline');
  assert.equal(t.store.tickOutbox().length, 2);
  assert.equal(t.count('POST', '/api/ticks'), 1, 'stopped at the first');
  assert.equal(t.count('GET', '/api/state'), 1, 'only the read of the abilities; no pull once the connection is gone');

  t.server.override = (m) => (m === 'POST' ? { ok: false, kind: 'denied', reason: 'service-token-not-allowed' } : null);
  await t.sync.trigger();
  assert.equal(t.sync.liveStatus().status, 'error:service-token-not-allowed');
  assert.equal(t.store.tickOutbox().length, 2);

  t.calls.length = 0;
  t.server.override = (m) => (m === 'POST' ? { ok: false, kind: 'http', status: 503 } : null);
  await t.sync.trigger();
  assert.equal(t.sync.liveStatus().status, 'error:http-503');
  assert.equal(t.store.tickOutbox().length, 2);
  assert.equal(t.count('POST', '/api/ticks'), 1);
  assert.equal(t.count('GET', '/api/state'), 1, 'a server error still pulls');

  t.server.override = null;
  await t.sync.trigger();
  assert.equal(t.sync.liveStatus().status, 'synced');
  assert.deepEqual(t.store.tickOutbox(), []);
});

test('the gate: a Worker without tick-done-at holds the queue (nothing sent, nothing dropped) and says so; an update releases it', async () => {
  const t = setup();
  t.server.features = undefined; // an old Worker
  t.server.override = () => ({ ok: false, kind: 'offline' });
  await t.sync.trigger();
  await t.sync.tick('it-language');
  t.server.override = null;
  t.calls.length = 0;
  await t.sync.trigger();
  assert.equal(t.count('POST', '/api/ticks'), 0, 'nothing is sent to an old Worker');
  assert.equal(t.count('GET', '/api/state'), 2, 'the state was read to learn the abilities, then pulled');
  assert.equal(t.store.tickOutbox().length, 1, 'and nothing is dropped');
  assert.equal(t.sync.liveStatus().ticksHeld, true);
  assert.deepEqual(t.store.snapshot().completions.map((c) => c.itemId), ['it-language'], 'the tick still shows locally');
  assert.equal(t.sync.liveStatus().status, 'synced', 'a held queue is a notice, not a sync error');

  // the next flight does not even read the state first: the abilities are known
  t.calls.length = 0;
  await t.sync.trigger();
  assert.equal(t.count('GET', '/api/state'), 1);
  assert.equal(t.count('POST', '/api/ticks'), 0);

  // the Worker is updated
  t.server.features = ['tick-done-at'];
  await t.sync.trigger(); // this pull learns the flag
  assert.equal(t.sync.liveStatus().ticksHeld, false, 'the notice goes away');
  await t.sync.trigger();
  assert.equal(t.count('POST', '/api/ticks'), 1);
  assert.deepEqual(t.store.tickOutbox(), []);
  assert.equal(t.server.state.completions.length, 1);
});

test('the gate does not touch direct online ticks', async () => {
  const t = setup();
  t.server.features = undefined;
  await t.sync.trigger();
  const res = /** @type {any} */ (await t.sync.tick('it-language'));
  assert.deepEqual([res.ok, res.created, res.pending], [true, true, undefined]);
  assert.equal(t.count('POST', '/api/ticks'), 1);
  assert.deepEqual(t.calls.find((c) => c.method === 'POST')?.body, { itemId: 'it-language' }, 'no doneAt online');
  assert.equal(t.store.tickOutbox().length, 0);
});

test('a held queue reading the state first fails cleanly offline', async () => {
  const t = setup();
  t.store.setTickOutbox([{ op: 'tick', itemId: 'it-language', periodKey: TODAY, doneAt: T0 }]);
  t.server.override = (m, p) => (m === 'GET' ? { ok: false, kind: 'offline' } : null);
  await t.sync.trigger();
  assert.equal(t.sync.liveStatus().status, 'offline');
  assert.equal(t.store.tickOutbox().length, 1);
});

test('queued ticks use the server clock as last seen: a PC 20 minutes ahead is not refused as "from the future"', async () => {
  const t = setup();
  // this PC says 12:20, the server 12:00
  t.env.t = T0 + 20 * 60000;
  t.server.state.items.length; // the fake server answers with its own clock below
  const serverNow = T0;
  const realOverride = (/** @type {string} */ m, /** @type {string} */ p) => (m === 'GET' && p === '/api/state' ? { ok: true, json: { ...clone(t.server.state), serverNow, features: ['tick-done-at'] } } : null);
  t.server.override = realOverride;
  await t.sync.trigger();
  assert.equal(t.store.serverClockOffset(), -20 * 60000);
  t.server.override = () => ({ ok: false, kind: 'offline' });
  await t.sync.trigger();
  await t.sync.tick('it-language');
  assert.equal(t.store.tickOutbox()[0].op === 'tick' && t.store.tickOutbox()[0].doneAt, T0);
  // the fake Worker judges by its own clock (T0): the report is exactly now, so it is accepted
  t.env.t = T0;
  t.server.override = null;
  await t.sync.trigger();
  assert.deepEqual(t.sync.liveStatus().droppedTicks, []);
  assert.equal(t.server.state.completions.length, 1);
});

test('disconnect empties the tick queue and the notices; the local completions stay', async () => {
  const t = setup({ configured: false });
  const engine = createSync({ store: t.store, secrets: { loadSecret: () => 's' }, requestApi: /** @type {any} */ (async () => ({ ok: true, json: {} })), now: () => t.env.t, timers: fakeTimers() });
  t.store.setTickOutbox([{ op: 'tick', itemId: 'it-language', periodKey: TODAY, doneAt: T0 }]);
  t.store.addTickNotice({ itemId: 'a', name: 'A', periodKey: TODAY, reason: 'tick-too-old', at: T0 });
  t.store.snapshot().completions.push({ itemId: 'it-language', periodKey: TODAY, doneAt: T0 });
  engine.disconnected();
  assert.deepEqual([t.store.tickOutbox(), t.store.tickNotices()], [[], []]);
  assert.equal(t.store.snapshot().completions.length, 1);
});

test('a tick made while a tick request is in flight is kept', async () => {
  const t = setup();
  t.store.setTickOutbox([{ op: 'tick', itemId: 'it-language', periodKey: TODAY, doneAt: T0 }]);
  const gate = deferred();
  t.server.gate = (m, p) => (m === 'POST' && p === '/api/ticks' ? gate.promise : null);
  const flight = t.sync.trigger();
  await flush();
  await flush();
  t.store.queueTick('it-coding'); // while the first request is out
  gate.release();
  await flight;
  assert.deepEqual(t.store.tickOutbox(), [], 'both were sent (the second by the loop or the next run)');
  assert.deepEqual(t.server.state.completions.map((c) => c.itemId).sort(), ['it-coding', 'it-language']);
});
test('a tick the server cannot find or start is reported with the local codes', async () => {
  const t = setup();
  t.server.override = () => ({ ok: false, kind: 'http', status: 404 });
  assert.deepEqual(await t.sync.tick('it-language'), { error: 'not-found' });
  t.server.override = () => ({ ok: false, kind: 'http', status: 409 });
  assert.deepEqual(await t.sync.tick('it-language'), { error: 'not-started' });
  assert.equal(t.sync.liveStatus().status, 'synced', 'these are not connection problems');
});

test('not configured: the interim local tick is unchanged and makes no request', async () => {
  const t = setup({ configured: false });
  const res = await t.sync.tick('it-language');
  assert.ok('ok' in res && res.created);
  assert.deepEqual(t.store.snapshot().completions, [{ itemId: 'it-language', periodKey: TODAY, doneAt: T0 }]);
  const un = await t.sync.untick('it-language');
  assert.ok('ok' in un && un.removed === 1);
  assert.equal(t.calls.length, 0);
  assert.equal(t.sync.ticksEnabled(), true);
});

// ---------------------------------------------------------------------------------------------
// cache.json

test('the outbox and the first-sync marker survive a restart; an old or damaged cache loads with an empty queue', () => {
  const t = setup();
  t.store.upsert({ items: [newItem('Kept')] });
  assert.equal(t.store.outbox().length, 1);
  const again = openStore(t.dir, { seedText: null });
  assert.equal(again.outbox().length, 1);
  assert.equal(again.firstSyncDoneFor(), BASE);

  const cacheFile = path.join(t.dir, 'cache.json');
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  delete cache.outbox;
  delete cache.firstSyncDoneFor;
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  const old = openStore(t.dir, { seedText: null });
  assert.deepEqual(old.outbox(), []);
  assert.equal(old.firstSyncDoneFor(), null);
  assert.equal(old.snapshot().items.length, cache.items.length);

  for (const junk of ['x', 7, { a: 1 }, [1, null, { kind: 'nope', entity: {} }, { kind: 'items', entity: 'str' }, { kind: 'items', entity: { name: 'no id' } }]]) {
    fs.writeFileSync(cacheFile, JSON.stringify({ ...cache, outbox: junk, firstSyncDoneFor: 5 }));
    const s = openStore(t.dir, { seedText: null });
    assert.deepEqual(s.outbox(), []);
    assert.equal(s.firstSyncDoneFor(), null);
  }
});

test('the outbox keeps well-formed entries and their errors, and drops malformed errors', () => {
  const t = setup();
  const cacheFile = path.join(t.dir, 'cache.json');
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const good = { kind: 'items', entity: { id: 'a', name: 'A', updatedAt: 5 }, error: [{ field: 'url', code: 'invalid-url' }, { field: 1 }] };
  fs.writeFileSync(cacheFile, JSON.stringify({ ...cache, outbox: [good, { kind: 'settings', entity: { timezone: 'UTC', updatedAt: 3 } }] }));
  const s = openStore(t.dir, { seedText: null });
  assert.deepEqual(s.outbox(), [{ kind: 'items', entity: good.entity, error: [{ field: 'url', code: 'invalid-url' }] }, { kind: 'settings', entity: { timezone: 'UTC', updatedAt: 3 } }]);
});
