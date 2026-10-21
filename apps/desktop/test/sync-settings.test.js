// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../main/store.js';
import { createSecrets } from '../main/secrets.js';
import { createRequestApi } from '../main/sync-http.js';
import { createSyncSettings } from '../main/sync-settings.js';

const SECRET = 'plaintext-secret-value';

function setup(/** @type {{answer?: (url: string, init: any) => any, available?: boolean}} */ o = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fruitery-syncset-'));
  const store = openStore(dir, { seedText: null });
  let key = 'user-a';
  const safeStorage = {
    isEncryptionAvailable: () => o.available !== false,
    encryptString: (/** @type {string} */ p) => Buffer.from(`v10:${key}:${Buffer.from(p).toString('base64')}`),
    decryptString: (/** @type {Buffer} */ b) => {
      const m = /^v10:([^:]*):(.*)$/s.exec(b.toString());
      if (!m || m[1] !== key) throw new Error('decrypt');
      return Buffer.from(m[2], 'base64').toString();
    },
  };
  const secrets = createSecrets({ dir, safeStorage });
  /** @type {{url: string, init: any}[]} */
  const calls = [];
  const requestApi = createRequestApi({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return (o.answer ?? (() => ({ status: 200, type: 'basic', text: async () => '{}' })))(url, init);
    },
    allowLocal: false,
  });
  const sync = createSyncSettings({ store, secrets, requestApi, allowLocal: false });
  return { dir, store, secrets, sync, calls, switchUser: (/** @type {string} */ k) => { key = k; } };
}

const form = (/** @type {any} */ over = {}) => ({ baseUrl: 'https://example.com', clientId: 'abc123.access', secret: SECRET, expiresOn: '2027-01-01', ...over });

test('status before anything is configured', () => {
  const { sync } = setup();
  assert.deepEqual(sync.status(), { configured: false, connected: false, status: 'not-connected', baseUrl: null, clientIdTail: null, expiresOn: null });
});

test('configure saves the config and the encrypted secret; status shows only the tail, never the id or secret', () => {
  const { sync, store, secrets, dir } = setup();
  assert.deepEqual(sync.configure(form()), { ok: true });
  assert.deepEqual(store.device().sync, { baseUrl: 'https://example.com', clientId: 'abc123.access', expiresOn: '2027-01-01' });
  assert.equal(secrets.loadSecret(), SECRET);
  const st = sync.status();
  assert.deepEqual(st, { configured: true, connected: true, status: 'idle', baseUrl: 'https://example.com', clientIdTail: 'cess', expiresOn: '2027-01-01' });
  const shown = JSON.stringify(st);
  assert.equal(shown.includes(SECRET) || shown.includes('abc123'), false);
  assert.equal(fs.readFileSync(path.join(dir, 'device.json'), 'utf8').includes(SECRET), false, 'device.json holds no secret');
});

test('configure: validation errors by field, nothing stored', () => {
  const { sync, store, secrets } = setup();
  const r = sync.configure(form({ baseUrl: 'http://example.com', clientId: '', secret: '' }));
  assert.equal(r.ok, false);
  assert.deepEqual(/** @type {any} */ (r).errors.map((/** @type {any} */ e) => `${e.field}:${e.code}`).sort(), ['baseUrl:not-https', 'clientId:required', 'secret:required']);
  assert.deepEqual(store.device().sync, { baseUrl: null, clientId: null, expiresOn: null });
  assert.equal(secrets.loadSecret(), null);
});

test('configure: a blank secret keeps the stored one (change only the expiry)', () => {
  const { sync, store, secrets } = setup();
  sync.configure(form());
  assert.deepEqual(sync.configure(form({ secret: '', clientId: '', expiresOn: '2028-02-29' })), { ok: true });
  assert.equal(store.device().sync.expiresOn, '2028-02-29');
  assert.equal(store.device().sync.clientId, 'abc123.access');
  assert.equal(secrets.loadSecret(), SECRET);
});

test('configure: a new address needs the secret again and leaves everything unchanged when it does not get it', () => {
  const { sync, store } = setup();
  sync.configure(form());
  const r = sync.configure(form({ secret: '', baseUrl: 'https://other.example.com' }));
  assert.deepEqual(r, { ok: false, errors: [{ field: 'secret', code: 'retype-required' }] });
  assert.equal(store.device().sync.baseUrl, 'https://example.com');
});

test('configure: encryption unavailable is reported on the secret field and stores nothing', () => {
  const { sync, store } = setup({ available: false });
  assert.deepEqual(sync.configure(form()), { ok: false, errors: [{ field: 'secret', code: 'encryption-unavailable' }] });
  assert.equal(store.device().sync.baseUrl, null);
});

test('copied data folder: the config is there but the secret cannot be decrypted, so it is not connected', () => {
  const { sync, switchUser } = setup();
  sync.configure(form());
  switchUser('user-b');
  const st = sync.status();
  assert.equal(st.configured, true);
  assert.equal(st.connected, false);
  assert.equal(st.status, 'not-connected');
});

test('test: GET /api/state with the stored key; success, refusal, denial, offline and not connected', async () => {
  const { sync, calls } = setup();
  assert.deepEqual(await sync.test(), { ok: false, reason: 'not-connected' });
  assert.equal(calls.length, 0);
  sync.configure(form());
  assert.deepEqual(await sync.test(), { ok: true });
  assert.equal(calls[0].url, 'https://example.com/api/state');
  assert.equal(calls[0].init.headers['CF-Access-Client-Secret'], SECRET);

  const refused = setup({ answer: () => ({ status: 302, type: 'basic', text: async () => '' }) });
  refused.sync.configure(form());
  assert.deepEqual(await refused.sync.test(), { ok: false, reason: 'access-key-refused' });

  const denied = setup({ answer: () => ({ status: 403, type: 'basic', text: async () => '{"error":"forbidden","reason":"service-token-not-allowed"}' }) });
  denied.sync.configure(form());
  assert.deepEqual(await denied.sync.test(), { ok: false, reason: 'service-token-not-allowed' });

  const http = setup({ answer: () => ({ status: 502, type: 'basic', text: async () => 'bad gateway' }) });
  http.sync.configure(form());
  assert.deepEqual(await http.sync.test(), { ok: false, reason: 'http-502' });

  const off = setup({ answer: () => { throw new Error('offline'); } });
  off.sync.configure(form());
  assert.deepEqual(await off.sync.test(), { ok: false, reason: 'offline' });
});

test('test results never contain the secret', async () => {
  const denied = setup({ answer: () => ({ status: 403, type: 'basic', text: async () => '{"reason":"email-mismatch"}' }) });
  denied.sync.configure(form());
  assert.equal(JSON.stringify(await denied.sync.test()).includes(SECRET), false);
});

test('disconnect deletes the secret, clears the client id and expiry, keeps the address', () => {
  const { sync, store, secrets } = setup();
  sync.configure(form());
  assert.deepEqual(sync.disconnect(), { ok: true });
  assert.equal(secrets.loadSecret(), null);
  assert.deepEqual(store.device().sync, { baseUrl: 'https://example.com', clientId: null, expiresOn: null });
  assert.deepEqual(sync.status(), { configured: false, connected: false, status: 'not-connected', baseUrl: 'https://example.com', clientIdTail: null, expiresOn: null });
  assert.deepEqual(sync.disconnect(), { ok: true }, 'harmless when already disconnected');
});
