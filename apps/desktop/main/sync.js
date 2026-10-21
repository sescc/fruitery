// @ts-check
// The sync engine (desktop-sync): when to talk to the Worker and what to do with the answers.
// Triggers: start, window focus, every 60 s, and a 1 s debounce after a local edit. One flight at a
// time; a trigger during a flight asks for exactly one more run. A flight pushes the outbox (batches
// of at most 100), then pulls the state and merges it (`lib/sync-plan.js`). The first connect to an
// address keeps newer local edits. Ticks go through the API so the server's clock decides the period.
// No Electron import: the store, the secret, the HTTP seam, the clock and the timers are injected.
// The secret is read per flight and only handed to `requestApi`; it is never kept, logged or returned.

import { periodKey } from '../../../packages/core/index.js';
import { isComplete, reasonOf } from '../lib/sync-config.js';
import { MAX_BATCH, afterPush, afterTickSend, enqueue, firstSyncPlan, firstSyncTicks, hasTickFeature, mergeSnapshot, sendable, statusOf } from '../lib/sync-plan.js';

/** @typedef {import('../lib/sync-config.js').ApiResult} ApiResult */
/** @typedef {import('../lib/sync-plan.js').OutboxEntry} OutboxEntry */
/**
 * @typedef {object} LiveStatus
 * @property {string} status       'not-connected' | 'expired' | 'error:<reason>' | 'offline' | 'expiring:<days>' | 'syncing' | 'synced'
 * @property {number | null} lastSyncAt   epoch ms of the last fully successful flight
 * @property {number} pending      entities and ticks waiting to be sent (rejected entities included)
 * @property {{kind: string, id: string | null, name: string, errors: {field: string, code: string}[]}[]} rejected
 * @property {{id: string, itemId: string, name: string, periodKey: string, reason: string, at: number}[]} droppedTicks  waiting ticks the server refused, until dismissed
 * @property {boolean} ticksHeld   ticks are waiting but the Worker does not yet understand reported times (nothing is sent)
 * @property {boolean} ticksEnabled
 */

export const SYNC_INTERVAL_MS = 60_000;
export const SYNC_DEBOUNCE_MS = 1_000;

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('./store.js').openStore>} deps.store
 * @param {{loadSecret: () => string | null}} deps.secrets
 * @param {(key: {baseUrl: string | null, clientId: string | null, secret: string | null}, method: string, path: string, body?: unknown) => Promise<ApiResult>} deps.requestApi
 * @param {() => number} [deps.now]
 * @param {{setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function}} [deps.timers] injectable for tests
 * @param {() => void} [deps.onChange] the status or the data changed (main.js broadcasts the state)
 * @param {number} [deps.intervalMs]
 * @param {number} [deps.debounceMs]
 */
export function createSync({ store, secrets, requestApi, now = Date.now, timers = globalThis, onChange = () => {}, intervalMs = SYNC_INTERVAL_MS, debounceMs = SYNC_DEBOUNCE_MS }) {
  let inFlight = false;
  let runAgain = false;
  let offline = false;
  /** @type {string | null} */
  let lastError = null;
  /** @type {number | null} */
  let lastSyncAt = null;
  /** @type {Promise<void> | null} */
  let current = null;
  /** @type {any} */
  let interval = null;
  /** @type {any} */
  let debounce = null;
  /** The address a pre-sync backup was already written for in this session. @type {string | null} */
  let backedUpFor = null;
  /** Is a secret stored and readable? Looked up lazily, forgotten when the key changes or a flight starts. @type {boolean | undefined} */
  let secretPresent;
  let lastSignature = '';
  /** Does the Worker, as of the latest `GET /api/state` of this session, file ticks under the time they report? null = not seen yet. @type {boolean | null} */
  let workerTakesDoneAt = null;

  const cfg = () => store.device().sync;
  const tz = () => store.snapshot().settings.timezone;

  /** @returns {boolean} */
  function hasSecret() {
    secretPresent ??= secrets.loadSecret() !== null;
    return secretPresent;
  }

  /** @returns {string} the status chip value */
  function currentStatus() {
    const c = cfg();
    const configured = isComplete(c);
    const state = { configured, hasSecret: configured && hasSecret(), inFlight, offline, lastError, expiresOn: c.expiresOn };
    try {
      return statusOf(state, now(), tz());
    } catch {
      return statusOf(state, now(), 'UTC'); // an unusable stored timezone must not break the chip
    }
  }

  /** Local-only mode: nothing is configured. A configured PC without its secret is not local-only (a local tick would be lost). */
  const localMode = () => !isComplete(cfg());
  /**
   * Can ticks be made now? Offline and in an error they can (they are queued); never when no key could send them:
   * an expired key, or a configured PC without a readable secret.
   * @param {string} s the status
   */
  const ticksUsable = (s) => (s === 'not-connected' ? localMode() : s !== 'expired');
  /** Is a tick or untick queued instead of sent now? (offline, or the sync is in an error) @param {string} s the status */
  const queueing = (s) => s === 'offline' || s.startsWith('error:');
  /** Ticks wait but the Worker is known not to understand reported times: the queue is held. */
  const ticksHeld = () => store.tickOutbox().length > 0 && workerTakesDoneAt === false;

  /** @returns {LiveStatus} */
  function liveStatus() {
    const outbox = store.outbox();
    const status = currentStatus();
    return {
      status,
      lastSyncAt,
      pending: outbox.length + store.tickOutbox().length,
      droppedTicks: store.tickNotices().map((n) => ({ ...n })),
      ticksHeld: ticksHeld(),
      rejected: outbox
        .filter((o) => o.error && o.error.length > 0)
        .map((o) => ({ kind: o.kind, id: typeof o.entity.id === 'string' ? o.entity.id : null, name: typeof o.entity.name === 'string' ? o.entity.name : o.kind === 'settings' ? 'Settings' : String(o.entity.id ?? ''), errors: /** @type {any} */ (o.error) })),
      ticksEnabled: ticksUsable(status),
    };
  }

  /** Tell the UI when the status changed (or always, with `force`: the data changed). @param {boolean} [force] */
  function notify(force = false) {
    const signature = JSON.stringify(liveStatus());
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    onChange();
  }

  /** @returns {{baseUrl: string, clientId: string, secret: string} | null} null when this PC is not connected */
  function key() {
    const c = cfg();
    if (!isComplete(c)) return null;
    secretPresent = undefined;
    const secret = secrets.loadSecret();
    secretPresent = secret !== null;
    return secret === null ? null : { baseUrl: /** @type {string} */ (c.baseUrl), clientId: /** @type {string} */ (c.clientId), secret };
  }

  /**
   * Record why a request failed. Returns nothing; the caller stops the flight.
   * @param {ApiResult} res
   */
  function failed(res) {
    if (res.ok) return;
    if (res.kind === 'offline') {
      offline = true;
      lastError = null;
    } else {
      offline = false;
      lastError = reasonOf(res);
    }
  }

  /**
   * Push the outbox until nothing is sendable. Edits made while a request is in flight are kept: the
   * outbox is re-read after every answer.
   * @param {{baseUrl: string, clientId: string, secret: string}} k
   * @returns {Promise<{stop: boolean, error: string | null}>} `stop`: the connection failed (state recorded); `error`: a rejection nothing was marked for
   */
  async function pushAll(k) {
    for (;;) {
      const body = sendable(store.outbox(), MAX_BATCH);
      if (Object.keys(body).length === 0) return { stop: false, error: null };
      const signature = JSON.stringify(body);
      const res = await requestApi(k, 'PUT', '/api/entities', body);
      if (res.ok) {
        store.setOutbox(afterPush(store.outbox(), body, res.json));
      } else if (res.kind === 'invalid') {
        store.setOutbox(afterPush(store.outbox(), body, res.json));
      } else if (res.kind === 'http') {
        return { stop: false, error: `http-${res.status}` }; // e.g. a 400: nothing to mark, so do not retry in a loop
      } else {
        failed(res);
        return { stop: true, error: null };
      }
      notify();
      // nothing left to send that was not just sent: a rejection that marked nothing must not loop
      if (JSON.stringify(sendable(store.outbox(), MAX_BATCH)) === signature) return { stop: false, error: res.ok ? 'push-stalled' : 'http-422' };
    }
  }

  /**
   * First connect to an address: look at the server, back up the cache, queue the newer local
   * edits. (Owner decision 2026-10-20: keep newer local edits.)
   * @param {{baseUrl: string, clientId: string, secret: string}} k
   * @returns {Promise<{stop: boolean, tz: string}>}
   */
  async function firstConnect(k) {
    const res = await requestApi(k, 'GET', '/api/state');
    if (!res.ok) {
      failed(res);
      return { stop: true, tz: tz() };
    }
    const remote = res.json;
    workerTakesDoneAt = hasTickFeature(remote?.features);
    if (backedUpFor !== k.baseUrl) {
      store.backupCache();
      backedUpFor = k.baseUrl;
    }
    let outbox = store.outbox();
    for (const o of firstSyncPlan(store.snapshot(), remote).outbox) outbox = enqueue(outbox, o.kind, [o.entity]);
    store.setOutbox(outbox);
    const zone = mergeSnapshot(store.snapshot(), remote, outbox).settings?.timezone;
    return { stop: false, tz: typeof zone === 'string' ? zone : tz() };
  }

  /**
   * Send the ticks made locally in the current periods (the server then supplies the history).
   * @param {{baseUrl: string, clientId: string, secret: string}} k
   * @param {string} zone
   * @returns {Promise<boolean>} false when the connection failed (state recorded)
   */
  async function firstTicks(k, zone) {
    const snap = store.snapshot();
    let ticks;
    try {
      ticks = firstSyncTicks(snap.completions, snap.items, now(), zone);
    } catch {
      return true; // an unusable timezone: nothing to send; the pull brings the server's history
    }
    for (const c of ticks) {
      const res = await requestApi(k, 'POST', '/api/ticks', { itemId: c.itemId });
      if (res.ok) continue;
      if (res.kind === 'http' && (res.status === 404 || res.status === 409)) continue; // unknown or not tickable on the server: skip
      failed(res);
      return false;
    }
    return true;
  }

  /**
   * Send the ticks and unticks that waited for a connection, in order, to a Worker that files them under the
   * time they report. Without that ability (an old Worker) the queue is held: nothing is sent, nothing dropped.
   * @param {{baseUrl: string, clientId: string, secret: string}} k
   * @returns {Promise<{stop: boolean, error: string | null}>}
   */
  async function sendTicks(k) {
    if (store.tickOutbox().length === 0) return { stop: false, error: null };
    if (workerTakesDoneAt === null) {
      // this session has not read the Worker's state yet: look, so the abilities are known before anything is sent
      const res = await requestApi(k, 'GET', '/api/state');
      if (!res.ok) {
        failed(res);
        return { stop: true, error: null };
      }
      workerTakesDoneAt = hasTickFeature(res.json?.features);
      store.applyRemote(res.json);
    }
    if (!workerTakesDoneAt) return { stop: false, error: null };
    for (;;) {
      const op = store.tickOutbox()[0];
      if (!op) return { stop: false, error: null };
      const res = op.op === 'tick'
        ? await requestApi(k, 'POST', '/api/ticks', { itemId: op.itemId, doneAt: op.doneAt })
        : await requestApi(k, 'DELETE', `/api/ticks/${encodeURIComponent(op.itemId)}?periodKey=${encodeURIComponent(op.periodKey)}`);
      const r = afterTickSend(store.tickOutbox(), op, res);
      store.setTickOutbox(r.ops);
      if (r.dropped) {
        // the server refused this tick for good: tell the owner, and take a tick that never counted out of the local data
        const item = store.snapshot().items.find((i) => i.id === op.itemId);
        store.addTickNotice({ itemId: op.itemId, name: item ? item.name : op.itemId, periodKey: op.periodKey, reason: r.dropped, at: now() });
        if (op.op === 'tick') store.dropCompletion(op.itemId, op.periodKey);
      }
      if (r.action === 'stop') {
        if (r.error) return { stop: false, error: r.error };
        failed(res);
        return { stop: true, error: null };
      }
      notify(true);
    }
  }

  /** One round: [first connect], push, send waiting ticks, [first ticks], pull. */
  async function oneFlight() {
    const k = key();
    if (!k) return;
    const first = store.firstSyncDoneFor() !== k.baseUrl;
    let zone = tz();
    if (first) {
      const fc = await firstConnect(k);
      if (fc.stop) return;
      zone = fc.tz;
    }
    const pushed = await pushAll(k);
    if (pushed.stop) return;
    const sent = await sendTicks(k);
    if (sent.stop) return;
    if (first && pushed.error === null && sent.error === null && !(await firstTicks(k, zone))) return;

    const res = await requestApi(k, 'GET', '/api/state');
    if (!res.ok) {
      failed(res);
      return;
    }
    workerTakesDoneAt = hasTickFeature(res.json?.features);
    const applied = store.applyRemote(res.json);
    if ('error' in applied) {
      offline = false;
      lastError = 'bad-response';
      return;
    }
    offline = false;
    lastError = pushed.error ?? sent.error;
    if (lastError === null) {
      lastSyncAt = now();
      if (first) store.setFirstSyncDoneFor(k.baseUrl);
    }
    if (applied.changed) notify(true);
  }

  /** @returns {Promise<void>} */
  async function loop() {
    try {
      do {
        runAgain = false;
        try {
          await oneFlight();
        } catch {
          offline = false;
          lastError = 'internal-error';
        }
        notify();
      } while (runAgain);
    } finally {
      inFlight = false;
      current = null;
      notify();
    }
  }

  /**
   * Sync now. During a flight this only asks for one more run afterwards.
   * @returns {Promise<void>} resolves when the flight (and the one more run, if asked) is over
   */
  function trigger() {
    if (inFlight && current) {
      runAgain = true;
      return current;
    }
    if (!isComplete(cfg())) {
      notify();
      return Promise.resolve(); // local-only mode: no requests
    }
    inFlight = true;
    current = loop();
    notify();
    return current;
  }

  /** Sync shortly (1 s debounce): a local edit was made. */
  function poke() {
    if (!isComplete(cfg())) return;
    if (debounce !== null) timers.clearTimeout(debounce);
    debounce = timers.setTimeout(() => {
      debounce = null;
      void trigger();
    }, debounceMs);
    debounce?.unref?.();
  }

  store.setEditListener(poke);

  // ------------------------------------------------------------------ ticks

  /** @returns {{error: 'ticks-need-connection'}} */
  function needConnection() {
    poke(); // look for the connection again soon
    return { error: 'ticks-need-connection' };
  }

  /**
   * A direct tick request failed. A wrong item or an item that cannot be ticked keeps the local codes; a failed
   * connection (or a server error) updates the status and the tick is queued like any offline tick.
   * @param {ApiResult} res a failed tick request
   * @param {() => any} queue queue the tick locally
   */
  function tickFailure(res, queue) {
    if (res.ok) return { error: 'internal' };
    if (res.kind === 'http' && res.status === 404) return { error: 'not-found' };
    if (res.kind === 'http' && res.status === 409) return { error: 'not-started' };
    if (res.kind === 'offline' || res.kind === 'refused' || res.kind === 'denied' || res.kind === 'not-connected') failed(res);
    notify();
    return queue();
  }

  /**
   * Check the item the way the local tick does, so the same codes come back.
   * @param {string} itemId
   * @returns {{error: 'not-found' | 'not-scheduled'} | {item: import('../../../packages/core/model.js').Item, pk: string | null}}
   */
  function tickTarget(itemId) {
    const item = store.snapshot().items.find((i) => i.id === itemId && !i.deleted);
    if (!item) return { error: 'not-found' };
    if (!item.schedule) return { error: 'not-scheduled' };
    let pk = null;
    try {
      pk = periodKey(item.schedule, now(), tz(), item.resetTime);
    } catch {
      pk = null;
    }
    return { item, pk };
  }

  /** Queue a tick without a connection and tell the UI. @param {string} itemId */
  function queueTick(itemId) {
    const res = store.queueTick(itemId);
    if ('error' in res && res.error === 'ticks-need-connection') return needConnection();
    notify(true);
    return res;
  }

  /** Queue an untick without a connection and tell the UI. @param {string} itemId */
  function queueUntick(itemId) {
    const res = store.queueUntick(itemId);
    notify(true);
    return res;
  }

  /**
   * Tick an item.
   * - Nothing configured: the local tick (unchanged).
   * - Connected: POST /api/ticks, so the server's clock decides the period.
   * - Offline or in a sync error, or the request fails on the connection: the tick is applied locally and queued;
   *   it is sent later with the time it was made.
   * - Expired key, or no readable key: refused with `ticks-need-connection` (nothing could ever send it).
   * @param {string} itemId
   */
  async function tick(itemId) {
    const status = currentStatus();
    if (localMode()) return store.tick(itemId);
    if (!ticksUsable(status)) return needConnection();
    if (queueing(status)) return queueTick(itemId);
    const target = tickTarget(itemId);
    if ('error' in target) return target;
    if (target.pk === null) return { error: /** @type {const} */ ('not-started') };
    const k = key();
    if (!k) return needConnection();
    const { pk } = target;
    const existing = store.snapshot().completions.find((c) => c.itemId === itemId && c.periodKey === pk);
    if (existing) return { ok: /** @type {const} */ (true), completion: existing, created: false };
    const res = await requestApi(k, 'POST', '/api/ticks', { itemId });
    if (!res.ok) return tickFailure(res, () => queueTick(itemId));
    if (!store.applyCompletion(res.json)) return queueTick(itemId);
    poke();
    notify(true);
    return { ok: /** @type {const} */ (true), completion: res.json, created: true };
  }

  /**
   * Untick an item (the current period). Same routes as `tick`.
   * @param {string} itemId
   */
  async function untick(itemId) {
    const status = currentStatus();
    if (localMode()) return store.untick(itemId);
    if (!ticksUsable(status)) return needConnection();
    if (queueing(status)) return queueUntick(itemId);
    const target = tickTarget(itemId);
    if ('error' in target) return target;
    const k = key();
    if (!k) return needConnection();
    const res = await requestApi(k, 'DELETE', `/api/ticks/${encodeURIComponent(itemId)}`);
    if (!res.ok) return tickFailure(res, () => queueUntick(itemId));
    if (target.pk !== null) store.dropCompletion(itemId, target.pk);
    poke();
    notify(true);
    return { ok: /** @type {const} */ (true), removed: Number(res.json?.removed ?? 0) };
  }
  // ------------------------------------------------------------------ lifecycle

  return {
    /** Start the scheduler: one flight now, then every 60 s. @returns {Promise<void>} the first flight */
    start() {
      if (interval === null) {
        interval = timers.setInterval(() => { void trigger(); }, intervalMs);
        interval?.unref?.();
      }
      return trigger();
    },
    /** Stop the scheduler (a flight in progress finishes). */
    stop() {
      if (interval !== null) timers.clearInterval(interval);
      if (debounce !== null) timers.clearTimeout(debounce);
      interval = null;
      debounce = null;
    },
    /** The window gained focus. */
    onFocus() {
      return trigger();
    },
    trigger,
    poke,
    /** The live status (never the secret or the client id). @returns {LiveStatus} */
    liveStatus,
    /** Is a secret stored and readable on this PC? (cached; refreshed when the key changes or a flight starts) */
    hasSecret,
    ticksEnabled: () => ticksUsable(currentStatus()),
    tick,
    untick,
    /**
     * Drop a rejected change from the queue and pull, so the server's version replaces the local one
     * (a change the server never had disappears). Only rejected entries can be discarded.
     * @param {string} kind 'workspaces' | 'groups' | 'items' | 'settings'
     * @param {string | null} id null for settings
     * @returns {{ok: true} | {ok: false, error: 'not-found'}}
     */
    discard(kind, id) {
      const before = store.outbox();
      const next = before.filter((o) => !(o.kind === kind && (kind === 'settings' || o.entity.id === id) && o.error && o.error.length > 0));
      if (next.length === before.length) return { ok: false, error: 'not-found' };
      store.setOutbox(next);
      notify(true);
      void trigger();
      return { ok: true };
    },
    /** Dismiss a notice about a waiting tick the server refused. @param {string} id @returns {boolean} */
    dismissTickNotice(id) {
      const done = store.dismissTickNotice(id);
      if (done) notify(true);
      return done;
    },
    /** The connection settings were saved: forget old errors and sync now. */
    configChanged() {
      workerTakesDoneAt = null;
      secretPresent = undefined;
      offline = false;
      lastError = null;
      notify(true);
      return trigger();
    },
    /** The key was deleted: forget the first-sync marker and the queue (the edits stay in the local data and are found again by the next first connect). */
    disconnected() {
      secretPresent = undefined;
      offline = false;
      lastError = null;
      lastSyncAt = null;
      backedUpFor = null;
      workerTakesDoneAt = null;
      store.setFirstSyncDoneFor(null);
      store.setOutbox([]);
      store.setTickOutbox([]);
      store.clearTickNotices();
      notify(true);
    },
  };
}
