// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSecrets, SECRET_FILE } from '../main/secrets.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fruitery-secrets-'));

/**
 * A stand-in for Electron's safeStorage: "encryption" is a reversible scramble with a user key, and a
 * different key (another Windows user / PC) cannot decrypt.
 * @param {{available?: boolean, key?: string}} [o]
 */
function fakeSafeStorage(o = {}) {
  const key = o.key ?? 'user-a';
  return {
    isEncryptionAvailable: () => o.available !== false,
    encryptString: (/** @type {string} */ plain) => Buffer.from(`v10:${key}:${Buffer.from(plain, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (/** @type {Buffer} */ bytes) => {
      const m = /^v10:([^:]*):(.*)$/s.exec(bytes.toString('utf8'));
      if (!m || m[1] !== key) throw new Error('decrypt failed');
      return Buffer.from(m[2], 'base64').toString('utf8');
    },
  };
}

test('save then load round-trips; the file holds encrypted bytes, not the secret', () => {
  const dir = tmp();
  const s = createSecrets({ dir, safeStorage: fakeSafeStorage() });
  assert.deepEqual(s.saveSecret('top-secret-value'), { ok: true });
  assert.equal(s.loadSecret(), 'top-secret-value');
  const raw = fs.readFileSync(path.join(dir, SECRET_FILE));
  assert.equal(raw.includes(Buffer.from('top-secret-value')), false);
  assert.deepEqual(fs.readdirSync(dir), [SECRET_FILE], 'no temp file is left behind');
});

test('saving again replaces the stored secret', () => {
  const s = createSecrets({ dir: tmp(), safeStorage: fakeSafeStorage() });
  s.saveSecret('one');
  s.saveSecret('two');
  assert.equal(s.loadSecret(), 'two');
});

test('encryption unavailable: save is refused with a code and writes nothing; load gives null', () => {
  const dir = tmp();
  const s = createSecrets({ dir, safeStorage: fakeSafeStorage({ available: false }) });
  assert.deepEqual(s.saveSecret('x'), { ok: false, error: 'encryption-unavailable' });
  assert.equal(fs.existsSync(path.join(dir, SECRET_FILE)), false);
  assert.equal(s.loadSecret(), null);
});

test('an unusable secret is refused', () => {
  const s = createSecrets({ dir: tmp(), safeStorage: fakeSafeStorage() });
  for (const bad of ['', null, undefined, 5]) assert.deepEqual(s.saveSecret(/** @type {any} */ (bad)), { ok: false, error: 'invalid-secret' });
});

test('missing, empty, corrupted or foreign-user files read as no secret (a copied data folder asks again)', () => {
  const dir = tmp();
  const a = createSecrets({ dir, safeStorage: fakeSafeStorage({ key: 'user-a' }) });
  assert.equal(a.loadSecret(), null, 'missing');
  a.saveSecret('mine');
  const bytes = fs.readFileSync(path.join(dir, SECRET_FILE));
  const other = createSecrets({ dir, safeStorage: fakeSafeStorage({ key: 'user-b' }) });
  assert.equal(other.loadSecret(), null, 'another user cannot decrypt it');
  fs.writeFileSync(path.join(dir, SECRET_FILE), Buffer.from('garbage bytes'));
  assert.equal(a.loadSecret(), null, 'corrupted');
  fs.writeFileSync(path.join(dir, SECRET_FILE), Buffer.alloc(0));
  assert.equal(a.loadSecret(), null, 'empty');
  fs.writeFileSync(path.join(dir, SECRET_FILE), bytes);
  assert.equal(a.loadSecret(), 'mine', 'the original bytes still work');
});

test('a safeStorage that throws never escapes', () => {
  const throwing = { isEncryptionAvailable: () => { throw new Error('boom'); }, encryptString: () => { throw new Error('boom'); }, decryptString: () => { throw new Error('boom'); } };
  const s = createSecrets({ dir: tmp(), safeStorage: throwing });
  assert.deepEqual(s.saveSecret('x'), { ok: false, error: 'encryption-unavailable' });
  assert.equal(s.loadSecret(), null);
});

test('a failing write is reported as write-failed', () => {
  const dir = tmp();
  const file = path.join(dir, 'not-a-folder');
  fs.writeFileSync(file, 'x');
  const s = createSecrets({ dir: file, safeStorage: fakeSafeStorage() });
  assert.deepEqual(s.saveSecret('x'), { ok: false, error: 'write-failed' });
});

test('deleteSecret removes the file and is harmless when there is none', () => {
  const dir = tmp();
  const s = createSecrets({ dir, safeStorage: fakeSafeStorage() });
  s.deleteSecret();
  s.saveSecret('x');
  s.deleteSecret();
  assert.equal(fs.existsSync(path.join(dir, SECRET_FILE)), false);
  assert.equal(s.loadSecret(), null);
});
