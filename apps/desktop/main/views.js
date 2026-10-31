// @ts-check
// ViewManager (D30, D31, D65): one live WebContentsView per item. A workspace switch or layout
// change only attaches / detaches views (nothing reloads); a view is unloaded only by its sleep
// timer and wakes at its last address and scroll position. Sites get no preload (Law 1).

import { WebContentsView } from 'electron';
import { userAgentOf } from '../../../packages/core/index.js';
import { userAgentFor } from '../lib/ua.js';
import { dueToSleep } from '../lib/sleep.js';
import { deriveBadge } from '../lib/badge.js';
import { shortcutFor } from '../lib/shortcuts.js';
import { isHttpUrl } from '../lib/resolve-open.js';
import { routePopup, shouldReloadOpener } from '../lib/popup-route.js';
import { normalizeAddress } from '../lib/address.js';
import { pageMenuModel } from '../lib/page-menu.js';
import { isOwnSite } from '../lib/favicon.js';

/** @typedef {import('../../../packages/core/model.js').Item} Item */
/** @typedef {{paneId: string, itemId: string | null, x: number, y: number, w: number, h: number}} PaneRect */
/**
 * @typedef {object} Entry
 * @property {string} itemId
 * @property {any} view                WebContentsView, null while asleep
 * @property {number | null} wcId
 * @property {boolean} awake
 * @property {boolean} attached
 * @property {string | null} url       last address (kept across sleep)
 * @property {number} scrollY          last scroll position (kept across sleep)
 * @property {number | null} hiddenSince
 * @property {string} title
 * @property {boolean} loading
 * @property {number | null} badge
 * @property {string | null} ua        the UA applied to the live view
 * @property {boolean} uaIsDefault     that UA is Electron's own (popups then need no override)
 * @property {number} loads            did-finish-load count (diagnostics)
 * @property {string[]} favicons      icon addresses the item's own site last offered (for "Refresh icon")
 * @property {{x: number, y: number, width: number, height: number} | null} bounds
 */

/** WebContents of popups map back to their opener's item. */
const POPUP_SIZE = { width: 520, height: 720 };

/**
 * @param {object} deps
 * @param {any} deps.win                    the BrowserWindow
 * @param {ReturnType<import('./sessions.js').createSessions>} deps.sessions
 * @param {() => {items: Item[], workspaces: any[]}} deps.getSnapshot
 * @param {(item: Item) => string | null} deps.paneUrlFor      the address a pane shows for an item, or null
 * @param {(url: string) => void} deps.openExternal              default browser, http(s) only
 * @param {() => void} deps.onChange
 * @param {(s: import('../lib/shortcuts.js').Shortcut) => void} deps.onShortcut
 * @param {(itemId: string) => void} deps.onFocusItem
 * @param {ReturnType<typeof import('./icons.js').createIcons>} deps.icons   per-PC icon cache (captured when an item's own site loads)
 * @param {{buildFromTemplate: (t: any[]) => {popup: (o?: object) => void}}} deps.Menu   Electron's Menu (a recording stub in smoke)
 * @param {{writeText: (text: string) => void}} deps.clipboard                (a recording stub in smoke)
 * @param {(itemId: string) => void} deps.openPageInEdge                      "Open page in Edge" for the item's current page
 * @param {() => (string | null)} [deps.pinnedItemId]                         the item pinned to the list-column strip; it never sleeps while pinned
 */
export function createViews({ win, sessions, getSnapshot, paneUrlFor, openExternal, onChange, onShortcut, onFocusItem, icons, Menu, clipboard, openPageInEdge, pinnedItemId = () => null }) {
  /** @type {Map<string, Entry>} */
  const entries = new Map();
  /** @type {Map<number, string>} webContents id -> item id (views and popups) */
  const wcToItem = new Map();
  /** @type {Map<number, string>} popup webContents id -> the UA its item presents */
  const popupUa = new Map();
  /** @type {{ua: string | null, itemId: string, ts: number}[]} popups allowed but not yet created */
  const pendingPopups = [];
  /** @type {string | null} Electron's own UA, read from the first fresh view */
  let electronUa = null;
  /** @type {PaneRect[]} */
  let rects = [];
  let overlay = false;

  /** @param {string} id @returns {Item | null} */
  const itemById = (id) => getSnapshot().items.find((i) => i.id === id && !i.deleted) ?? null;

  /** @param {string} itemId @returns {Entry} */
  function entryFor(itemId) {
    let e = entries.get(itemId);
    if (!e) {
      e = { itemId, view: null, wcId: null, awake: false, attached: false, url: null, scrollY: 0, hiddenSince: null, title: '', loading: false, badge: null, ua: null, uaIsDefault: true, loads: 0, favicons: [], bounds: null };
      entries.set(itemId, e);
    }
    return e;
  }

  /** @param {Entry} e */
  function detach(e) {
    if (e.view && e.attached && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(e.view);
      } catch {
        // already removed
      }
    }
    e.attached = false;
    e.bounds = null;
  }

  /**
   * Shortcuts pressed in a site. Page navigation (F5, F6, Alt+arrows) acts on that site's own item, not on
   * whichever pane the UI considers focused (the focus message to the UI is asynchronous).
   * @param {any} wc
   * @param {string} itemId
   */
  function wireShortcuts(wc, itemId) {
    wc.on('before-input-event', (/** @type {any} */ event, /** @type {any} */ input) => {
      const s = shortcutFor(input);
      if (!s) return;
      event.preventDefault();
      if (s.type === 'nav') {
        navigate(itemId, s.action);
        onChange();
        return;
      }
      onShortcut(s);
    });
  }

  /**
   * The address a page currently shows: the live view's if it is a web address, else the last one the
   * view had (kept across sleep), else null.
   * @param {string} itemId
   * @returns {string | null}
   */
  function currentUrl(itemId) {
    const e = entries.get(itemId);
    if (!e) return null;
    const live = e.view && !e.view.webContents.isDestroyed() ? e.view.webContents.getURL() : '';
    if (isHttpUrl(live)) return live;
    return isHttpUrl(e.url) ? e.url : null;
  }

  /**
   * Copy a page's current address to the clipboard.
   * @param {string} itemId
   * @returns {string | null} the address copied, or null when there is none
   */
  function copyAddress(itemId) {
    const url = currentUrl(itemId);
    if (!url) return null;
    clipboard.writeText(url);
    return url;
  }

  /**
   * The right-click menu of a page. Each entry acts on the item whose view raised the menu.
   * @param {string} itemId
   * @param {any} wc
   * @param {any} params Electron's context-menu params
   */
  function showPageMenu(itemId, wc, params) {
    const model = pageMenuModel({
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      pageUrl: currentUrl(itemId),
      linkUrl: typeof params?.linkURL === 'string' ? params.linkURL : null,
      selectionText: typeof params?.selectionText === 'string' ? params.selectionText : null,
    });
    /** @param {string} id */
    const run = (id) => {
      if (id === 'back' || id === 'forward' || id === 'reload') navigate(itemId, id);
      else if (id === 'copy-address') copyAddress(itemId);
      else if (id === 'open-edge') openPageInEdge(itemId);
      else if (id === 'copy-link') clipboard.writeText(String(params.linkURL));
      else if (id === 'copy-text') clipboard.writeText(String(params.selectionText));
      onChange();
    };
    const template = model.map((entry) =>
      'type' in entry
        ? { type: 'separator' }
        : { label: entry.label, enabled: entry.enabled, ...(entry.accelerator ? { accelerator: entry.accelerator, registerAccelerator: false } : {}), click: () => run(entry.id) },
    );
    Menu.buildFromTemplate(template).popup({ window: win });
  }

  /**
   * Load an address the owner typed in the same view (same partition and UA). The item's saved address is
   * never touched.
   * @param {string} itemId
   * @param {unknown} text
   * @returns {{ok: true, url: string} | {ok: false, error: string}}
   */
  function navigateTo(itemId, text) {
    const r = normalizeAddress(text);
    if (!r.ok) return r;
    const e = entries.get(itemId);
    if (!e || !e.awake || !e.view || !itemById(itemId)) return { ok: false, error: 'not-loaded' };
    e.view.webContents.loadURL(r.url).catch(() => {});
    return { ok: true, url: r.url };
  }

  /**
   * Windows a site opens, routed by `routePopup`: a sign-in arriving as a new tab (known identity
   * host, auth-looking URL, same-site URL) loads in the opener's own pane; `new-window` popups and
   * script-opened about:blank windows become small app windows in the item's partition and UA; other
   * new-tab links open in the default browser; everything else (file:, javascript:, custom schemes)
   * is denied.
   * @param {any} wc
   * @param {Item} item
   * @param {string} partition
   * @param {() => string | null} uaOf
   */
  function wirePopups(wc, item, partition, uaOf) {
    wc.setWindowOpenHandler((/** @type {any} */ details) => {
      const route = routePopup({ url: details.url, disposition: details.disposition, features: details.features, frameName: details.frameName, openerUrl: wc.getURL() });
      if (route === 'external') {
        openExternal(details.url);
        return { action: 'deny' };
      }
      if (route === 'deny') return { action: 'deny' };
      if (route === 'same-pane') {
        // a sign-in arriving as a new tab: in a normal browser that tab would be the app, so the
        // opener's own view goes there (the sign-in completes in the pane itself)
        wc.loadURL(details.url).catch(() => {});
        return { action: 'deny' };
      }
      // The popup's webContents is created next; `adoptPopup` (web-contents-created) gives it the
      // item's UA before its first navigation starts, which did-create-window is too late for.
      pendingPopups.push({ ua: uaOf(), itemId: item.id, ts: Date.now() });
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...POPUP_SIZE,
          autoHideMenuBar: true,
          webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
        },
      };
    });
    wc.on('did-create-window', (/** @type {any} */ child, /** @type {any} */ details) => {
      const cwc = child.webContents;
      const ua = uaOf();
      const cid = cwc.id;
      if (ua) {
        cwc.setUserAgent(ua);
        popupUa.set(cid, ua);
      }
      wcToItem.set(cid, item.id);
      child.setMenuBarVisibility(false);
      // After a sign-in popup closes the opener usually refreshes itself; if it did not (same
      // address as when the popup opened), reload it.
      const openerUrlBefore = wc.getURL();
      /** @type {string[]} */
      const visited = typeof details?.url === 'string' ? [details.url] : [];
      const note = (/** @type {any[]} */ ...a) => {
        const u = typeof a[0]?.url === 'string' ? a[0].url : typeof a[1] === 'string' ? a[1] : null;
        if (u) visited.push(u);
      };
      for (const ev of ['did-start-navigation', 'did-redirect-navigation', 'did-navigate']) cwc.on(ev, note);
      child.once('closed', () => {
        wcToItem.delete(cid);
        popupUa.delete(cid);
        if (!wc.isDestroyed() && shouldReloadOpener({ openerUrlBefore, openerUrlNow: wc.getURL(), visited })) wc.reload();
      });
      wirePopups(cwc, item, partition, uaOf);
    });
  }

  /**
   * Create the live view for an item and start loading its last (or home) address.
   * @param {Item} item
   * @param {Entry} e
   * @returns {boolean} false when the item has nothing to load
   */
  function wake(item, e) {
    const home = paneUrlFor(item);
    const target = e.url && isHttpUrl(e.url) ? e.url : home;
    if (!target) return false;
    const { ses, partition } = sessions.sessionFor(item);
    const view = new WebContentsView({
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
    });
    const wc = view.webContents;
    // D65: the UA is fixed before the first load and never changed on a live view.
    const pref = userAgentOf(item);
    electronUa ??= wc.getUserAgent(); // a fresh view still reports Electron's own UA
    const ua = userAgentFor(pref.preset, pref.custom, electronUa);
    if (ua !== electronUa) wc.setUserAgent(ua);
    e.view = view;
    e.wcId = wc.id;
    e.ua = ua;
    e.uaIsDefault = ua === electronUa;
    e.awake = true;
    e.attached = false;
    e.loading = true;
    e.badge = null;
    wcToItem.set(wc.id, item.id);

    wc.on('page-title-updated', (/** @type {any} */ _ev, /** @type {string} */ title) => {
      e.title = title;
      const cur = itemById(item.id);
      e.badge = cur && cur.badge ? deriveBadge(title) : null;
      onChange();
    });
    wc.on('did-start-loading', () => { e.loading = true; onChange(); });
    wc.on('did-stop-loading', () => { e.loading = false; onChange(); });
    const track = () => {
      const u = wc.getURL();
      if (isHttpUrl(u)) e.url = u;
      onChange();
    };
    wc.on('did-navigate', track);
    wc.on('did-navigate-in-page', track);
    wc.on('focus', () => onFocusItem(item.id));
    wc.on('render-process-gone', () => {
      detach(e);
      e.awake = false;
      e.view = null;
      wcToItem.delete(wc.id);
      onChange();
    });
    wireShortcuts(wc, item.id);
    wc.on('context-menu', (/** @type {any} */ _ev, /** @type {any} */ params) => showPageMenu(item.id, wc, params));
    // D116: the item's icon is captured only when its own site loads (no background fetching). A sign-in
    // provider's page, an SSO redirect or a different site typed into the address field never replaces it.
    wc.on('page-favicon-updated', (/** @type {any} */ _ev, /** @type {unknown} */ favicons) => {
      const cur = itemById(item.id);
      if (!cur || !Array.isArray(favicons)) return;
      if (!isOwnSite(wc.getURL(), paneUrlFor(cur))) return;
      e.favicons = favicons.filter((f) => typeof f === 'string').slice(0, 20);
      void icons.capture(item.id, e.favicons, ses);
    });
    // Only a non-default identity is carried into popups: a default-preset popup stays exactly as the
    // spike verified it (no UA override, no debugger, client hints intact).
    wirePopups(wc, item, partition, () => (e.uaIsDefault ? null : e.ua));

    const scrollY = e.scrollY;
    wc.once('did-finish-load', () => {
      e.loads += 1;
      if (scrollY > 0) {
        const restore = () => wc.executeJavaScript(`window.scrollTo(0, ${Number(scrollY) || 0})`).catch(() => {});
        restore();
        setTimeout(() => { if (!wc.isDestroyed()) restore(); }, 800);
      }
    });
    wc.loadURL(target).catch(() => {
      // ERR_ABORTED on redirects, offline, ...: the page shows its own error
    });
    return true;
  }

  /**
   * Show these panes. Views of items in the set are woken if needed, attached and bounded; every
   * other awake view is detached (kept alive) and starts counting as hidden.
   * @param {PaneRect[]} next
   */
  function applyRects(next) {
    rects = next;
    if (win.isDestroyed()) return;
    const now = Date.now();
    /** @type {Map<string, PaneRect>} */
    const wanted = new Map();
    for (const r of next) {
      if (!r.itemId || wanted.has(r.itemId)) continue;
      if (itemById(r.itemId)) wanted.set(r.itemId, r);
    }
    for (const e of entries.values()) {
      if (!e.awake || wanted.has(e.itemId)) continue;
      if (e.attached) detach(e);
      if (e.hiddenSince === null) e.hiddenSince = now;
    }
    if (overlay) {
      onChange();
      return;
    }
    for (const [itemId, r] of wanted) {
      const item = itemById(itemId);
      if (!item) continue;
      const e = entryFor(itemId);
      if (!e.awake && !wake(item, e)) continue;
      e.hiddenSince = null;
      if (!e.attached && e.view) {
        win.contentView.addChildView(e.view);
        e.attached = true;
      }
      const b = { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(0, Math.round(r.w)), height: Math.max(0, Math.round(r.h)) };
      if (!e.bounds || e.bounds.x !== b.x || e.bounds.y !== b.y || e.bounds.width !== b.width || e.bounds.height !== b.height || !e.attached) {
        e.view.setBounds(b);
        e.bounds = b;
      }
    }
    onChange();
  }

  /**
   * Dialogs and drags of the UI would sit BEHIND the native views: take the views off the window
   * while one is open, put them back afterwards. Detaching is not hiding: nothing reloads and the
   * sleep timers do not start.
   * @param {boolean} on
   */
  function setOverlay(on) {
    if (overlay === on) return;
    overlay = on;
    if (on) {
      for (const e of entries.values()) {
        if (e.attached) {
          detach(e);
          e.bounds = null;
        }
      }
    } else {
      applyRects(rects);
    }
  }

  /**
   * Unload a hidden view: remember its address and scroll position, close its webContents.
   * @param {string} itemId
   */
  async function sleep(itemId) {
    const e = entries.get(itemId);
    if (!e || !e.awake || !e.view) return;
    const wc = e.view.webContents;
    let y = e.scrollY;
    try {
      const got = await Promise.race([
        wc.executeJavaScript('window.scrollY'),
        new Promise((resolve) => setTimeout(() => resolve(null), 500)),
      ]);
      if (typeof got === 'number' && Number.isFinite(got)) y = got;
    } catch {
      // best effort
    }
    // re-check: it may have been shown while we waited
    if (!e.awake || e.hiddenSince === null || !e.view) return;
    const u = wc.getURL();
    if (isHttpUrl(u)) e.url = u;
    e.scrollY = y;
    detach(e);
    wcToItem.delete(wc.id);
    e.view = null;
    e.wcId = null;
    e.awake = false;
    e.loading = false;
    try {
      wc.close();
    } catch {
      // already gone
    }
    onChange();
  }

  /**
   * Run the sleep timer once.
   * @param {number} [now]
   * @returns {Promise<string[]>} item ids that were unloaded
   */
  async function sleepTick(now = Date.now()) {
    const snap = getSnapshot();
    const pinned = pinnedItemId();
    // the pinned strip item never sleeps while it is pinned, even when the strip is collapsed (hidden)
    const due = dueToSleep(entries.values(), snap.items, snap.workspaces, now).filter((id) => id !== pinned);
    for (const id of due) await sleep(id);
    return due;
  }

  /**
   * @param {string} itemId
   * @param {'back' | 'forward' | 'reload' | 'home'} action
   * @returns {boolean}
   */
  function navigate(itemId, action) {
    const e = entries.get(itemId);
    const item = itemById(itemId);
    if (!e || !e.awake || !e.view || !item) return false;
    const wc = e.view.webContents;
    if (action === 'back') {
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    } else if (action === 'forward') {
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    } else if (action === 'reload') {
      // a changed UA preset takes effect on the next load: recreate the view instead of reloading it
      const pref = userAgentOf(item);
      const wanted = userAgentFor(pref.preset, pref.custom, electronUa ?? wc.getUserAgent());
      if (e.ua !== null && wanted !== e.ua) {
        const was = e.attached;
        e.url = wc.getURL() || e.url;
        detach(e);
        wcToItem.delete(wc.id);
        e.view = null;
        e.awake = false;
        try { wc.close(); } catch { /* gone */ }
        if (was) applyRects(rects);
      } else {
        wc.reload();
      }
    } else if (action === 'home') {
      const home = paneUrlFor(item);
      if (home) wc.loadURL(home).catch(() => {});
    }
    return true;
  }

  /** @param {string} itemId */
  function destroyItem(itemId) {
    const e = entries.get(itemId);
    if (!e) return;
    detach(e);
    if (e.view) {
      wcToItem.delete(e.view.webContents.id);
      try { e.view.webContents.close(); } catch { /* gone */ }
    }
    entries.delete(itemId);
  }

  function closeAll() {
    for (const id of [...entries.keys()]) destroyItem(id);
  }

  return {
    applyRects,
    setOverlay,
    sleep,
    sleepTick,
    navigate,
    navigateTo,
    currentUrl,
    copyAddress,
    /** The icon addresses the item's own site last offered (empty when its site has not loaded). @param {string} itemId @returns {string[]} */
    faviconsOf: (itemId) => entries.get(itemId)?.favicons ?? [],
    destroyItem,
    closeAll,
    /** @param {number} id @returns {string | null} */
    popupUserAgent: (id) => popupUa.get(id) ?? null,
    /**
     * Called for every new webContents (app 'web-contents-created'): the next one created after an
     * allowed popup is that popup. It gets the item's UA before its first navigation.
     * @param {any} wc
     */
    adoptPopup(wc) {
      const fresh = Date.now() - 3000;
      while (pendingPopups.length > 0 && pendingPopups[0].ts < fresh) pendingPopups.shift();
      if (pendingPopups.length === 0 || wc.getType() !== 'window') return;
      const p = pendingPopups.shift();
      if (!p) return;
      wcToItem.set(wc.id, p.itemId);
      if (p.ua) {
        wc.setUserAgent(p.ua);
        popupUa.set(wc.id, p.ua);
        // setUserAgent alone does not reach the popup's first document (its navigation entry exists
        // already); the DevTools emulation override does, for the page's JS as well as the headers.
        try {
          wc.debugger.attach('1.3');
          void wc.debugger.sendCommand('Emulation.setUserAgentOverride', { userAgent: p.ua }).catch(() => {});
        } catch {
          // best effort: the request header is still set in sessions.js
        }
      }
    },
    /** @param {any} wc @returns {string | null} */
    itemIdOfWebContents: (wc) => (wc && typeof wc.id === 'number' ? wcToItem.get(wc.id) ?? null : null),
    /** @param {string} itemId */
    entry: (itemId) => entries.get(itemId) ?? null,
    isOverlay: () => overlay,
    rects: () => rects,
    /** Serializable state for the UI. */
    viewStates() {
      /** @type {Record<string, any>} */
      const out = {};
      for (const [id, e] of entries) {
        const wc = e.view && !e.view.webContents.isDestroyed() ? e.view.webContents : null;
        out[id] = {
          awake: e.awake,
          attached: e.attached,
          loading: e.loading,
          title: e.title,
          url: e.url,
          canGoBack: wc ? wc.navigationHistory.canGoBack() : false,
          canGoForward: wc ? wc.navigationHistory.canGoForward() : false,
        };
      }
      return out;
    },
    badges() {
      /** @type {Record<string, number>} */
      const out = {};
      for (const [id, e] of entries) if (e.badge !== null && itemById(id)?.badge) out[id] = e.badge;
      return out;
    },
  };
}
