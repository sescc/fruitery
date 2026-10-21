// @ts-check
// The Sync settings operations behind the IPC handlers: save the connection, test it, disconnect, report
// its status. The secret is only ever passed to `secrets` and `requestApi`; nothing here returns it or
// puts it in a result. No Electron import (the pieces are injected), so it is unit tested.
// The sync engine (next wave) extends `status()` with the live state (synced / offline / ...).

import { clientIdTail, emptySyncConfig, isComplete, planConfigure, reasonOf } from '../lib/sync-config.js';

/**
 * @typedef {object} SyncStatus
 * @property {boolean} configured   an address and a client id are set
 * @property {boolean} connected    configured, and this PC holds the decrypted secret
 * @property {string} status  'not-connected' | 'idle' without the engine; with it the live value of `statusOf` (synced, syncing, offline, expiring:<days>, expired, error:<reason>)
 * @property {string | null} baseUrl
 * @property {string | null} clientIdTail
 * @property {string | null} expiresOn
 * @property {number | null} [lastSyncAt]   (engine) epoch ms of the last successful sync
 * @property {number} [pending]             (engine) changes waiting to be sent
 * @property {{kind: string, id: string | null, name: string, errors: {field: string, code: string}[]}[]} [rejected]  (engine) changes the server refused
 * @property {{id: string, itemId: string, name: string, periodKey: string, reason: string, at: number}[]} [droppedTicks]  (engine) waiting ticks the server refused, until dismissed
 * @property {boolean} [ticksHeld]          (engine) ticks wait for a Worker update
 * @property {boolean} [ticksEnabled]       (engine) ticking is possible
 */

/**
 * @param {object} deps
 * @param {{device: () => {sync: import('../lib/sync-config.js').SyncConfig}, updateDevice: (patch: any) => any}} deps.store
 * @param {ReturnType<typeof import('./secrets.js').createSecrets>} deps.secrets
 * @param {ReturnType<typeof import('./sync-http.js').createRequestApi>} deps.requestApi
 * @param {boolean} deps.allowLocal
 * @param {{liveStatus: () => import('./sync.js').LiveStatus, hasSecret: () => boolean, configChanged: () => unknown, disconnected: () => void}} [deps.engine] the sync engine (absent: no live state)
 */
export function createSyncSettings({ store, secrets, requestApi, allowLocal, engine }) {
  /** @returns {SyncStatus} */
  function status() {
    const cfg = store.device().sync;
    const configured = isComplete(cfg);
    const connected = configured && (engine ? engine.hasSecret() : secrets.loadSecret() !== null);
    /** @type {SyncStatus} */
    const out = {
      configured,
      connected,
      status: connected ? 'idle' : 'not-connected',
      baseUrl: cfg.baseUrl,
      clientIdTail: clientIdTail(cfg.clientId),
      expiresOn: cfg.expiresOn,
    };
    if (engine) {
      const live = engine.liveStatus();
      return { ...out, status: live.status, lastSyncAt: live.lastSyncAt, pending: live.pending, rejected: live.rejected, droppedTicks: live.droppedTicks, ticksHeld: live.ticksHeld, ticksEnabled: live.ticksEnabled };
    }
    return out;
  }

  /**
   * @param {unknown} input  `{baseUrl, clientId, secret, expiresOn}`
   * @returns {{ok: true} | {ok: false, errors: {field: string, code: string}[]}}
   */
  function configure(input) {
    const plan = planConfigure(input, { allowLocal, current: store.device().sync, hasSecret: secrets.loadSecret() !== null });
    if (!plan.ok) return plan;
    if (plan.secret !== null) {
      const saved = secrets.saveSecret(plan.secret);
      if (!saved.ok) return { ok: false, errors: [{ field: 'secret', code: saved.error }] };
    }
    store.updateDevice({ sync: plan.config });
    void engine?.configChanged(); // forget old errors and sync now
    return { ok: true };
  }

  /** @returns {Promise<{ok: true} | {ok: false, reason: string}>} */
  async function test() {
    const cfg = store.device().sync;
    const secret = isComplete(cfg) ? secrets.loadSecret() : null;
    if (secret === null) return { ok: false, reason: 'not-connected' };
    const res = await requestApi({ baseUrl: cfg.baseUrl, clientId: cfg.clientId, secret }, 'GET', '/api/state');
    return res.ok ? { ok: true } : { ok: false, reason: reasonOf(res) };
  }

  /** Delete the secret; forget the client id and expiry; keep the address. */
  function disconnect() {
    secrets.deleteSecret();
    const cfg = store.device().sync;
    store.updateDevice({ sync: { ...emptySyncConfig(), baseUrl: cfg.baseUrl } });
    engine?.disconnected(); // the first-sync marker and the queue are reset
    return { ok: true };
  }

  return { status, configure, test, disconnect };
}
