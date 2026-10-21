// @ts-check
// Sessions (D15, D37, D71): one shared persistent partition, per-item isolation on request,
// session cookies made persistent AS THEY ARE SET, and permission handlers per item.
// Each partition is set up once, on first use. Nothing here runs at import time.

import { toPersistentDetails, isOptedOut, hostOfUrl } from '../lib/cookie-transform.js';
import { partitionFor, optOutFor } from '../lib/partition.js';

/** @typedef {import('../../../packages/core/model.js').Item} Item */

/** Permissions every site may use (D71): clipboard write, fullscreen, pointer lock, camera/microphone. */
export const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'media']);

/**
 * Decide a permission for an item. Notifications follow the item's `notify`; the allow-list above is
 * granted; everything else (geolocation, midi, hid, serial, usb, ...) is denied.
 * @param {string} permission
 * @param {Pick<Item, 'notify'> | null} item null when the requester cannot be mapped to an item
 * @returns {boolean}
 */
export function decidePermission(permission, item) {
  if (permission === 'notifications') return item !== null && item.notify === true;
  return ALLOWED_PERMISSIONS.has(permission);
}

/**
 * @param {object} deps
 * @param {{fromPartition: (name: string) => any}} deps.electronSession
 * @param {() => {items: Item[]}} deps.getSnapshot
 * @param {(wc: any) => string | null} deps.itemIdOfWebContents  item shown in (or that opened) a webContents
 * @param {(webContentsId: number) => string | null} [deps.popupUserAgent]  the UA a popup must send (D65), by webContents id
 * @param {() => number} [deps.now]
 */
export function createSessions({ electronSession, getSnapshot, itemIdOfWebContents, popupUserAgent = () => null, now = Date.now }) {
  /** @type {Map<string, any>} */
  const ready = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const flushTimers = new Map();

  /** @param {string} id @returns {Item | null} */
  const itemById = (id) => getSnapshot().items.find((i) => i.id === id && !i.deleted) ?? null;

  /**
   * @param {string} partition
   * @param {any} ses
   */
  function scheduleFlush(partition, ses) {
    if (flushTimers.has(partition)) return;
    flushTimers.set(
      partition,
      setTimeout(() => {
        flushTimers.delete(partition);
        Promise.resolve(ses.cookies.flushStore()).catch(() => {});
      }, 1000),
    );
  }

  /**
   * Item for a permission request: by webContents, else by the requesting origin among the
   * partition's items (permission checks may come without a webContents).
   * @param {string} partition
   * @param {any} wc
   * @param {string | undefined} origin
   * @returns {Item | null}
   */
  function itemFor(partition, wc, origin) {
    const id = wc ? itemIdOfWebContents(wc) : null;
    if (id) return itemById(id);
    const host = hostOfUrl(origin);
    if (!host) return null;
    const candidates = getSnapshot().items.filter((i) => !i.deleted && partitionFor(i) === partition);
    return (
      candidates.find((i) => [i.url, i.fallbackUrl].some((u) => hostOfUrl(u) === host)) ??
      candidates.find((i) => [i.url, i.fallbackUrl].some((u) => { const h = hostOfUrl(u); return h !== null && (host.endsWith(`.${h}`) || h.endsWith(`.${host}`)); })) ??
      null
    );
  }

  /** @param {string} partition @returns {any} */
  function setup(partition) {
    const existing = ready.get(partition);
    if (existing) return existing;
    const ses = electronSession.fromPartition(partition);
    ready.set(partition, ses);

    // D37: session cookies -> +30 days, as they are set (not on quit), then flush ~1 s later.
    ses.cookies.on('changed', (/** @type {any} */ _e, /** @type {any} */ cookie, /** @type {string} */ _cause, /** @type {boolean} */ removed) => {
      if (removed || !cookie || cookie.session !== true) return;
      const out = optOutFor(partition, getSnapshot().items);
      if (out.all || isOptedOut(cookie.domain, out.hosts)) return;
      const details = toPersistentDetails(cookie, now());
      if (!details) return;
      Promise.resolve(ses.cookies.set(details))
        .catch(() => {})
        .finally(() => scheduleFlush(partition, ses));
    });

    // A popup's first request is sent before `did-create-window` can set its UA, so popups get their
    // item's UA on the wire here. Views set their UA before loading and are not touched.
    ses.webRequest.onBeforeSendHeaders((/** @type {any} */ details, /** @type {(r: object) => void} */ callback) => {
      const ua = typeof details.webContentsId === 'number' ? popupUserAgent(details.webContentsId) : null;
      if (ua) callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': ua } });
      else callback({});
    });

    ses.setPermissionRequestHandler((/** @type {any} */ wc, /** @type {string} */ permission, /** @type {(g: boolean) => void} */ callback, /** @type {any} */ details) => {
      callback(decidePermission(permission, itemFor(partition, wc, details?.requestingUrl)));
    });
    ses.setPermissionCheckHandler((/** @type {any} */ wc, /** @type {string} */ permission, /** @type {string} */ origin) => {
      return decidePermission(permission, itemFor(partition, wc, origin));
    });
    return ses;
  }

  return {
    /** @param {Item} item @returns {{ses: any, partition: string}} */
    sessionFor(item) {
      const partition = partitionFor(item);
      return { ses: setup(partition), partition };
    },
    /** The session of the app UI window: no permissions at all. */
    uiSession() {
      const ses = electronSession.fromPartition('fruitery-ui');
      if (!ready.has('fruitery-ui')) {
        ready.set('fruitery-ui', ses);
        ses.setPermissionRequestHandler((/** @type {any} */ _wc, /** @type {string} */ _p, /** @type {(g: boolean) => void} */ cb) => cb(false));
        ses.setPermissionCheckHandler(() => false);
      }
      return ses;
    },
    /** Flush every cookie store now (before quit). */
    async flushAll() {
      for (const t of flushTimers.values()) clearTimeout(t);
      flushTimers.clear();
      await Promise.all([...ready.values()].map((s) => Promise.resolve(s.cookies.flushStore()).catch(() => {})));
    },
    partitions: () => [...ready.keys()],
  };
}
