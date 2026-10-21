// @ts-check
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SEED } from '../../../packages/core/index.js';
import { generateSeedSql } from '../../../scripts/gen-seed-sql.mjs';
import { handle } from '../src/api.js';
import { clearJwksCache } from '../src/auth.js';
import worker from '../src/worker.js';
import { createMigratedDb } from '../test-support/d1-sqlite.js';

const NOW = Date.parse('2026-10-12T00:00:00Z'); // 09:00 on 2026-10-12 in Tokyo
const BASE = 'http://localhost:8787'; // a local host, so DEV_NO_AUTH applies

beforeEach(() => clearJwksCache());

// denials log one line each (tested through deps.log); keep the default console quiet in this file
console.log = () => {};

async function seeded() {
  const db = await createMigratedDb();
  await db.exec(generateSeedSql(SEED));
  return db;
}

/**
 * @param {any} db
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body] object (JSON-encoded) or string (sent raw)
 * @param {{env?: Record<string, unknown>, headers?: Record<string, string>, now?: number}} [opts]
 */
async function call(db, method, path, body, opts = {}) {
  const init = /** @type {RequestInit} */ ({ method, headers: { ...opts.headers } });
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    /** @type {Record<string, string>} */ (init.headers)['content-type'] = 'application/json';
  }
  const res = await handle(new Request(`${BASE}${path}`, init), { DB: db, DEV_NO_AUTH: '1', ...opts.env }, { now: opts.now ?? NOW });
  const text = await res.text();
  return { res, status: res.status, json: text ? JSON.parse(text) : null };
}

/** @param {string} id @param {Record<string, unknown>} [over] */
function itemOf(id, over = {}) {
  return { ...JSON.parse(JSON.stringify(SEED.items.find((i) => i.id === id))), ...over };
}

// ----- auth and generic behaviour -----

/** A database that fails the test on any access. */
const FORBIDDEN_DB = new Proxy({}, { get: () => assert.fail('the database must not be touched') });

test('403 before any DB access: no token, forged token, unconfigured deployment', async () => {
  const cfg = { TEAM_DOMAIN: 'https://team.example.cloudflareaccess.com', POLICY_AUD: 'aud', OWNER_EMAIL: 'owner@example.com' };
  for (const [method, path] of [['GET', '/api/state'], ['PUT', '/api/entities'], ['POST', '/api/ticks'], ['DELETE', '/api/ticks/x'], ['GET', '/api/history?itemId=x'], ['GET', '/api/nope']]) {
    for (const env of [{ DEV_NO_AUTH: undefined }, { DEV_NO_AUTH: undefined, ...cfg }]) {
      const { status, res, json } = await call(FORBIDDEN_DB, method, path, undefined, { env, headers: { 'Cf-Access-Jwt-Assertion': 'a.b.c' } });
      assert.equal(status, 403, `${method} ${path}`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Object.keys(json).sort(), ['error', 'reason']);
      assert.equal(json.error, 'forbidden');
      assert.match(json.reason, /^(jwt-config-missing|jwt-malformed)$/);
    }
  }
});

test('DEV_NO_AUTH on a deployed (non-local) host is ignored: 403 before any DB access', async () => {
  const res = await handle(new Request('https://fruitery.example.workers.dev/api/state'), { DB: FORBIDDEN_DB, DEV_NO_AUTH: '1' }, { now: NOW });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
test('a denial answers 403 {error, reason}, logs one line with only the reason and the path, and never leaks personal values', async () => {
  const email = 'owner@example.com';
  const secrets = [email, 'super-secret-aud', 'team.secret-team.example.com', 'tok-en.secret.value'];
  const lines = /** @type {unknown[][]} */ ([]);
  const log = (/** @type {unknown[]} */ ...args) => lines.push(args);
  const env = { DB: FORBIDDEN_DB, OWNER_EMAIL: email, TEAM_DOMAIN: 'https://team.secret-team.example.com', POLICY_AUD: 'super-secret-aud' };
  const owner = { getIdentity: async () => ({ email: 'intruder@example.com' }) };
  const cases = /** @type {[Record<string, string>, any, string, string][]} */ ([
    [{}, undefined, 'no-credentials', 'none'],
    [{ 'Cf-Access-Jwt-Assertion': 'tok-en.secret.value' }, undefined, 'jwt-malformed', 'jwt'],
    [{}, owner, 'email-mismatch', 'ctx.access'],
  ]);
  for (const [headers, access, reason, path] of cases) {
    const res = await handle(new Request('https://fruitery.example.workers.dev/api/state', { headers }), env, { now: NOW, access, log });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { error: 'forbidden', reason });
    assert.deepEqual(lines[lines.length - 1], ['auth denied', reason, { path }]);
  }
  assert.equal(lines.length, 3, 'exactly one log line per denial');
  const everything = JSON.stringify(lines);
  for (const s of secrets) assert.equal(everything.includes(s), false, `log leaks ${s}`);
  // and nothing is logged for an allowed request
  const ok = await handle(new Request(`${BASE}/api/state`), { DB: await seeded(), DEV_NO_AUTH: '1' }, { now: NOW, log });
  assert.equal(ok.status, 200);
  assert.equal(lines.length, 3);
});
test('Valid owner token: the request is processed', async () => {
  const pair = /** @type {CryptoKeyPair} */ (
    await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'])
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  const b64 = (/** @type {unknown} */ v) => Buffer.from(v instanceof Uint8Array ? v : JSON.stringify(v)).toString('base64url');
  const team = 'https://team.example.cloudflareaccess.com';
  const input = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({ iss: team, aud: ['aud'], email: 'owner@example.com', exp: NOW / 1000 + 600 })}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input)));
  const db = await seeded();
  /** @type {any} */
  const fakeFetch = async () => new Response(JSON.stringify({ keys: [jwk] }));
  const res = await handle(
    new Request(`${BASE}/api/state`, { headers: { 'Cf-Access-Jwt-Assertion': `${input}.${b64(sig)}` } }),
    { DB: db, TEAM_DOMAIN: team, POLICY_AUD: 'aud', OWNER_EMAIL: 'owner@example.com' },
    { now: NOW, fetch: fakeFetch },
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).items.length, 11);
});

test('ctx.access through worker.fetch: the owner is served, another email, an error or no identity is 403 before any DB access', async () => {
  const db = await seeded();
  const cfg = { OWNER_EMAIL: 'owner@example.com' };
  const url = 'https://fruitery.example.workers.dev/api/state';
  const ok = await worker.fetch(new Request(url), { DB: db, ...cfg }, { access: { getIdentity: async () => ({ email: 'Owner@example.com' }) } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).items.length, 11);
  const bad = [
    { getIdentity: async () => ({ email: 'someone@example.com' }) },
    { getIdentity: async () => { throw new Error('boom'); } },
  ];
  for (const access of bad) {
    const res = await worker.fetch(new Request(url), { DB: FORBIDDEN_DB, ...cfg }, { access });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  // ctx.access present but OWNER_EMAIL unset, no ctx.access at all, and ctx undefined
  const owner = { getIdentity: async () => ({ email: 'owner@example.com' }) };
  assert.equal((await worker.fetch(new Request(url), { DB: FORBIDDEN_DB }, { access: owner })).status, 403);
  assert.equal((await worker.fetch(new Request(url), { DB: FORBIDDEN_DB, ...cfg }, {})).status, 403);
  assert.equal((await worker.fetch(new Request(url), { DB: FORBIDDEN_DB, ...cfg }, undefined)).status, 403);
});

test('a forged JWT header with a valid ctx.access is 403 (the header wins)', async () => {
  const owner = { getIdentity: async () => ({ email: 'owner@example.com' }) };
  const env = { DB: FORBIDDEN_DB, OWNER_EMAIL: 'owner@example.com', TEAM_DOMAIN: 'https://team.example.cloudflareaccess.com', POLICY_AUD: 'aud' };
  const res = await handle(
    new Request('https://fruitery.example.workers.dev/api/state', { headers: { 'Cf-Access-Jwt-Assertion': 'a.b.c' } }),
    env,
    { now: NOW, access: owner },
  );
  assert.equal(res.status, 403);
});
test('every JSON response carries Cache-Control: no-store', async () => {
  const db = await seeded();
  for (const [method, path, body] of /** @type {[string, string, unknown][]} */ ([
    ['GET', '/api/state', undefined], ['PUT', '/api/entities', {}], ['POST', '/api/ticks', { itemId: 'it-word-game' }],
    ['DELETE', '/api/ticks/it-word-game', undefined], ['GET', '/api/history?itemId=it-word-game', undefined],
    ['GET', '/api/state?since=bad', undefined], ['PUT', '/api/entities', 'not json'], ['GET', '/api/nope', undefined],
  ])) {
    const { res } = await call(db, method, path, body);
    assert.equal(res.headers.get('cache-control'), 'no-store', `${method} ${path}`);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  }
});

// ----- state -----

test('Fresh deployment: GET /api/state returns the seeded example', async () => {
  const db = await seeded();
  const { status, json } = await call(db, 'GET', '/api/state');
  assert.equal(status, 200);
  assert.equal(json.workspaces.length, 2);
  assert.equal(json.groups.length, 3);
  assert.equal(json.items.length, 11);
  assert.deepEqual(json.settings, { timezone: 'UTC', googleEmail: null, updatedAt: 0 });
  assert.deepEqual(json.completions, []);
  assert.equal(json.serverNow, NOW);
});

test('Since filter over HTTP; a malformed since is 400', async () => {
  const db = await seeded();
  await db.prepare('INSERT INTO completions VALUES (?, ?, ?), (?, ?, ?)').bind('it-word-game', '2026-08-01', 1, 'it-word-game', '2026-10-11', 2).run();
  const { json } = await call(db, 'GET', '/api/state?since=2026-10-01');
  assert.deepEqual(json.completions.map((/** @type {any} */ c) => c.periodKey), ['2026-10-11']);
  assert.equal((await call(db, 'GET', '/api/state?since=soon')).status, 400);
});

// ----- entities -----

test('Newer edit stored, older edit ignored', async () => {
  const db = await seeded();
  const newer = await call(db, 'PUT', '/api/entities', { items: [itemOf('it-notes', { name: 'Renamed', updatedAt: 100 })] });
  assert.equal(newer.status, 200);
  assert.equal(newer.json.items[0].name, 'Renamed');
  const older = await call(db, 'PUT', '/api/entities', { items: [itemOf('it-notes', { name: 'Stale', updatedAt: 50 })] });
  assert.equal(older.status, 200);
  assert.equal(older.json.items[0].name, 'Renamed');
  const state = await call(db, 'GET', '/api/state');
  assert.equal(state.json.items.find((/** @type {any} */ i) => i.id === 'it-notes').name, 'Renamed');
});

test('Invalid item: 422 with the item id and a url error, nothing stored', async () => {
  const db = await seeded();
  const { status, json } = await call(db, 'PUT', '/api/entities', {
    items: [itemOf('it-tasks', { name: 'Ok', updatedAt: 9 }), itemOf('it-notes', { url: null, updatedAt: 9 })],
  });
  assert.equal(status, 422);
  assert.equal(json.error, 'invalid');
  assert.deepEqual(json.details, [{ id: 'it-notes', errors: [{ field: 'url', code: 'required' }] }]);
  const state = await call(db, 'GET', '/api/state');
  assert.equal(state.json.items.find((/** @type {any} */ i) => i.id === 'it-tasks').name, 'Tasks');
});

test('Bad JSON and wrongly shaped bodies are 400 and store nothing', async () => {
  const db = await seeded();
  assert.equal((await call(db, 'PUT', '/api/entities', '{nope')).status, 400);
  assert.equal((await call(db, 'PUT', '/api/entities', '')).status, 400);
  assert.equal((await call(db, 'PUT', '/api/entities', [])).status, 400);
  assert.equal((await call(db, 'PUT', '/api/entities', { items: [{ id: 'x' }] })).status, 400);
  assert.equal((await call(db, 'POST', '/api/ticks', 'not json')).status, 400);
  assert.equal((await call(db, 'POST', '/api/ticks', {})).status, 400);
  assert.equal((await call(db, 'POST', '/api/ticks', { itemId: 5 })).status, 400);
  assert.equal((await call(db, 'GET', '/api/state')).json.items.length, 11);
});

// ----- ticks -----

test('Tick a daily item at 2026-10-12 09:00 Tokyo time: filed as 2026-10-12', async () => {
  const db = await seeded();
  await call(db, 'PUT', '/api/entities', { settings: { timezone: 'Asia/Tokyo', googleEmail: null, updatedAt: 1 } });
  const { status, json } = await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game' });
  assert.equal(status, 200);
  assert.deepEqual(json, { itemId: 'it-word-game', periodKey: '2026-10-12', doneAt: NOW });
  const state = await call(db, 'GET', '/api/state');
  assert.deepEqual(state.json.completions, [json]);
});

test('Double tick: exactly one tick exists', async () => {
  const db = await seeded();
  await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game' });
  const second = await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game' }, { now: NOW + 1000 });
  assert.equal(second.status, 200);
  assert.equal(second.json.doneAt, NOW);
  assert.equal((await call(db, 'GET', '/api/state')).json.completions.length, 1);
});

test('Unscheduled or deleted item: 409; unknown id: 404; nothing stored', async () => {
  const db = await seeded();
  assert.equal((await call(db, 'POST', '/api/ticks', { itemId: 'it-tasks' })).status, 409);
  await call(db, 'PUT', '/api/entities', { items: [itemOf('it-word-game', { deleted: true, updatedAt: 9 })] });
  assert.equal((await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game' })).status, 409);
  const unknown = await call(db, 'POST', '/api/ticks', { itemId: 'nope' });
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.json, { error: 'not-found' });
  assert.deepEqual((await call(db, 'GET', '/api/state')).json.completions, []);
});

test('Untick removes the current period only', async () => {
  const db = await seeded();
  await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game' }, { now: NOW - 86400000 });
  await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game' });
  const un = await call(db, 'DELETE', '/api/ticks/it-word-game');
  assert.equal(un.status, 200);
  assert.deepEqual(un.json, { removed: 1 });
  const h = await call(db, 'GET', '/api/history?itemId=it-word-game');
  assert.deepEqual(h.json.map((/** @type {any} */ c) => c.periodKey), ['2026-10-11']);
  assert.equal((await call(db, 'DELETE', '/api/ticks/nope')).status, 404);
});

// ----- ticks with a reported time / period (offline-ticks) -----

test('Tick with doneAt over HTTP: filed under that day, yesterday\'s tick sent today', async () => {
  const db = await seeded();
  const doneAt = NOW - 9 * 3600000; // 2026-10-11 15:00 UTC
  const { status, json } = await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game', doneAt });
  assert.equal(status, 200);
  assert.deepEqual(json, { itemId: 'it-word-game', periodKey: '2026-10-11', doneAt });
  assert.deepEqual((await call(db, 'GET', '/api/state')).json.completions, [json]);
  const again = await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game', doneAt });
  assert.deepEqual(again.json, json, 'a retry returns the stored tick');
});

test('Tick with doneAt over HTTP: 422 tick-in-future / tick-too-old with the code as the error, nothing stored', async () => {
  const db = await seeded();
  const future = await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game', doneAt: NOW + 6 * 60000 });
  assert.equal(future.status, 422);
  assert.deepEqual(future.json, { error: 'tick-in-future' });
  assert.equal((await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game', doneAt: NOW + 4 * 60000 })).status, 200);
  const old = await call(db, 'POST', '/api/ticks', { itemId: 'it-weekly-bonus', doneAt: NOW - 49 * 3600000 });
  assert.equal(old.status, 422);
  assert.deepEqual(old.json, { error: 'tick-too-old' });
  assert.equal((await call(db, 'GET', '/api/state')).json.completions.length, 1);
});

test('Tick with a bad doneAt is 400; 404 and 409 still apply; a body without doneAt is unchanged', async () => {
  const db = await seeded();
  const bad = await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game', doneAt: 'yesterday' });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json.details, [{ errors: [{ field: 'doneAt', code: 'invalid-type' }] }]);
  assert.equal((await call(db, 'POST', '/api/ticks', { itemId: 'nope', doneAt: NOW - 1000 })).status, 404);
  assert.equal((await call(db, 'POST', '/api/ticks', { itemId: 'it-tasks', doneAt: NOW - 1000 })).status, 409);
  const plain = await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game' });
  assert.equal(plain.json.doneAt, NOW);
});

test('Untick with ?periodKey= over HTTP: yesterday is allowed, the day before is 422 period-not-allowed, a bad date is 400', async () => {
  const db = await seeded();
  for (const d of [2, 1, 0]) await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game' }, { now: NOW - d * 86400000 });
  const ok = await call(db, 'DELETE', '/api/ticks/it-word-game?periodKey=2026-10-11');
  assert.deepEqual([ok.status, ok.json], [200, { removed: 1 }]);
  const no = await call(db, 'DELETE', '/api/ticks/it-word-game?periodKey=2026-10-10');
  assert.equal(no.status, 422);
  assert.deepEqual(no.json, { error: 'period-not-allowed' });
  assert.equal((await call(db, 'DELETE', '/api/ticks/it-word-game?periodKey=soon')).status, 400);
  assert.deepEqual((await call(db, 'GET', '/api/history?itemId=it-word-game')).json.map((/** @type {any} */ c) => c.periodKey), ['2026-10-12', '2026-10-10']);
  const cur = await call(db, 'DELETE', '/api/ticks/it-word-game');
  assert.deepEqual(cur.json, { removed: 1 }, 'without the parameter: the current period as before');
});

test('GET /api/state lists the features, including tick-done-at', async () => {
  const db = await seeded();
  assert.deepEqual((await call(db, 'GET', '/api/state')).json.features, ['tick-done-at']);
});
// ----- history -----

test('History is newest first; a missing item id is 400', async () => {
  const db = await seeded();
  for (const d of [2, 0, 1]) await call(db, 'POST', '/api/ticks', { itemId: 'it-word-game' }, { now: NOW - d * 86400000 });
  const h = await call(db, 'GET', '/api/history?itemId=it-word-game');
  assert.equal(h.status, 200);
  assert.deepEqual(h.json.map((/** @type {any} */ c) => c.periodKey), ['2026-10-12', '2026-10-11', '2026-10-10']);
  assert.equal((await call(db, 'GET', '/api/history')).status, 400);
  assert.equal((await call(db, 'GET', '/api/history?itemId=')).status, 400);
});

// ----- routing -----

test('Unknown route: 404 with no-store; wrong method: 405', async () => {
  const db = await seeded();
  const r = await call(db, 'GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.res.headers.get('cache-control'), 'no-store');
  assert.equal((await call(db, 'GET', '/api/ticks')).status, 405);
  assert.equal((await call(db, 'POST', '/api/state')).status, 405);
  assert.equal((await call(db, 'GET', '/api/state/')).status, 200, 'trailing slash tolerated');
});

test('A database failure is a 500 without leaking details', async () => {
  const broken = { prepare: () => { throw new Error('secret-detail'); } };
  const orig = console.error;
  console.error = () => {};
  try {
    const { status, json } = await call(broken, 'GET', '/api/state');
    assert.equal(status, 500);
    assert.deepEqual(json, { error: 'internal' });
  } finally {
    console.error = orig;
  }
});

// ----- worker entry -----

test('worker.fetch sends /api to the API and everything else to the assets binding', async () => {
  const db = await seeded();
  const assets = { fetch: async () => new Response('<html>shell</html>') };
  const env = { DB: db, DEV_NO_AUTH: '1', ASSETS: assets };
  const api = await worker.fetch(new Request(`${BASE}/api/state`), env, {});
  assert.equal(api.status, 200);
  const page = await worker.fetch(new Request(`${BASE}/`), env, {});
  assert.equal(await page.text(), '<html>shell</html>');
});

// ----- service-token access (change desktop-sync) -----

const TOKEN_ID = 'a1b2c3d4e5f6.access';

/** A signed service-token JWT (client id in common_name, no email) plus a fetch serving its key. @param {string} id */
async function serviceRequest(id) {
  const pair = /** @type {CryptoKeyPair} */ (
    await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'])
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  const b64 = (/** @type {unknown} */ v) => Buffer.from(v instanceof Uint8Array ? v : JSON.stringify(v)).toString('base64url');
  const input = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({ type: 'app', iss: 'https://team.example.cloudflareaccess.com', aud: ['aud'], common_name: id, sub: '', exp: NOW / 1000 + 600 })}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input)));
  /** @type {any} */
  const fetch = async () => new Response(JSON.stringify({ keys: [jwk] }));
  return { request: new Request('https://fruitery.example.workers.dev/api/state', { headers: { 'Cf-Access-Jwt-Assertion': `${input}.${b64(sig)}` } }), fetch };
}

const SERVICE_CFG = { TEAM_DOMAIN: 'https://team.example.cloudflareaccess.com', POLICY_AUD: 'aud', OWNER_EMAIL: 'owner@example.com' };

test('Service token: a listed token is processed like the owner (JWT header and ctx.access), writes included', async () => {
  const db = await seeded();
  const jwt = await serviceRequest(TOKEN_ID);
  const viaJwt = await handle(jwt.request, { DB: db, ...SERVICE_CFG, SERVICE_TOKEN_IDS: ` x.access , ${TOKEN_ID} ` }, { now: NOW, fetch: jwt.fetch });
  assert.equal(viaJwt.status, 200);
  assert.equal((await viaJwt.json()).items.length, 11);

  const url = 'https://fruitery.example.workers.dev/api/entities';
  const env = { DB: db, OWNER_EMAIL: 'owner@example.com', SERVICE_TOKEN_IDS: TOKEN_ID };
  const access = { getIdentity: async () => ({ service_token_id: TOKEN_ID }) };
  const put = await worker.fetch(new Request(url, { method: 'PUT', body: JSON.stringify({}) }), env, { access });
  assert.equal(put.status, 200);
  const viaCommonName = await worker.fetch(new Request('https://fruitery.example.workers.dev/api/state'), env, { access: { getIdentity: async () => ({ common_name: TOKEN_ID }) } });
  assert.equal(viaCommonName.status, 200);
});

test('Service token: an unlisted token is 403 service-token-not-allowed before any DB access, logging only the code and the path', async () => {
  const lines = /** @type {unknown[][]} */ ([]);
  const log = (/** @type {unknown[]} */ ...args) => lines.push(args);
  const secretId = 'topsecretid.access';
  const jwt = await serviceRequest(secretId);
  const res = await handle(jwt.request, { DB: FORBIDDEN_DB, ...SERVICE_CFG, SERVICE_TOKEN_IDS: TOKEN_ID }, { now: NOW, fetch: jwt.fetch, log });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { error: 'forbidden', reason: 'service-token-not-allowed' });
  const viaAccess = await handle(
    new Request('https://fruitery.example.workers.dev/api/state'),
    { DB: FORBIDDEN_DB, OWNER_EMAIL: 'owner@example.com', SERVICE_TOKEN_IDS: TOKEN_ID },
    { now: NOW, log, access: { getIdentity: async () => ({ service_token_id: secretId }) } },
  );
  assert.equal(viaAccess.status, 403);
  assert.deepEqual(lines, [
    ['auth denied', 'service-token-not-allowed', { path: 'jwt' }],
    ['auth denied', 'service-token-not-allowed', { path: 'ctx.access' }],
  ]);
  for (const s of [secretId, TOKEN_ID]) assert.equal(JSON.stringify(lines).includes(s), false, 'the log never carries a client id');
});

test('Service token: with no list configured the answer is 403 service-token-ids-missing before any DB access', async () => {
  const jwt = await serviceRequest(TOKEN_ID);
  for (const SERVICE_TOKEN_IDS of [undefined, '', ' , ']) {
    const res = await handle(jwt.request.clone(), { DB: FORBIDDEN_DB, ...SERVICE_CFG, SERVICE_TOKEN_IDS }, { now: NOW, fetch: jwt.fetch });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'forbidden', reason: 'service-token-ids-missing' });
  }
  const res = await worker.fetch(
    new Request('https://fruitery.example.workers.dev/api/state'),
    { DB: FORBIDDEN_DB, OWNER_EMAIL: 'owner@example.com' },
    { access: { getIdentity: async () => ({ service_token_id: TOKEN_ID }) } },
  );
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'forbidden', reason: 'service-token-ids-missing' });
});