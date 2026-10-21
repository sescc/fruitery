// @ts-check
// The sync access key's secret, encrypted for the current Windows user with Electron's `safeStorage`
// (DPAPI) and kept as bytes in <data>\sync-secret.bin. It is read only here and in the HTTP seam; it is
// never logged and never sent to the UI. A data folder copied to another PC or user cannot decrypt it,
// which reads as "no secret": the app then asks for the key again.
// No Electron import: the folder and `safeStorage` are injected (main.js passes the real ones).

import fs from 'node:fs';
import path from 'node:path';

export const SECRET_FILE = 'sync-secret.bin';

/**
 * @typedef {object} SafeStorageLike
 * @property {() => boolean} isEncryptionAvailable
 * @property {(plain: string) => Buffer} encryptString
 * @property {(bytes: Buffer) => string} decryptString
 */

/**
 * @param {{dir: string, safeStorage: SafeStorageLike}} opts
 */
export function createSecrets({ dir, safeStorage }) {
  const file = path.join(dir, SECRET_FILE);

  /** @returns {boolean} */
  function available() {
    try {
      return safeStorage.isEncryptionAvailable() === true;
    } catch {
      return false;
    }
  }

  return {
    file,
    available,

    /**
     * Encrypt and store the secret (atomic write).
     * @param {string} secret
     * @returns {{ok: true} | {ok: false, error: 'invalid-secret' | 'encryption-unavailable' | 'write-failed'}}
     */
    saveSecret(secret) {
      if (typeof secret !== 'string' || secret === '') return { ok: false, error: 'invalid-secret' };
      if (!available()) return { ok: false, error: 'encryption-unavailable' };
      try {
        const bytes = safeStorage.encryptString(secret);
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, bytes);
        fs.renameSync(tmp, file);
        return { ok: true };
      } catch {
        return { ok: false, error: 'write-failed' };
      }
    },

    /**
     * @returns {string | null} the secret, or null when there is none, the file is unreadable, or it
     *   cannot be decrypted here (another PC or Windows user, a corrupted file)
     */
    loadSecret() {
      if (!available()) return null;
      try {
        const bytes = fs.readFileSync(file);
        if (bytes.length === 0) return null;
        const secret = safeStorage.decryptString(bytes);
        return typeof secret === 'string' && secret !== '' ? secret : null;
      } catch {
        return null;
      }
    },

    /** Remove the stored secret (no error when there is none). */
    deleteSecret() {
      for (const f of [file, `${file}.tmp`]) {
        try {
          fs.rmSync(f, { force: true });
        } catch {
          // a locked file is retried by the next call; there is nothing more to do here
        }
      }
    },
  };
}
