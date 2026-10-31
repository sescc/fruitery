// @ts-check
// The IPC contract (design.md "Window and IPC contract"). Every handler validates its inputs; only
// the UI window's own frame may call (sites have no preload and cannot reach this at all).
// No Electron import: `ipcMain`, `dialog` and `Menu` are injected by main.js.

import { resolveOpen } from '../lib/resolve-open.js';
import * as Layout from '../lib/layout.js';
import { idArg, optionalIdArg, oneOf, boolArg, indexArg, objectArg, rectsArg, confirmArg, textArg, syncConfigureArg, syncDiscardArgs, focusPaneArgs } from '../lib/ipc-args.js';
import { pageEdgeProfile } from '../lib/page-menu.js';
import { createReturnTracker } from '../lib/return-tracker.js';
import { needsConfirm, approveProgram, afterAnswer } from '../lib/program-approval.js';

/** @typedef {import('../../../packages/core/model.js').Item} Item */

/**
 * @param {object} ctx
 * @param {any} ctx.win
 * @param {ReturnType<typeof import('./store.js').openStore>} ctx.store
 * @param {ReturnType<typeof import('./views.js').createViews>} ctx.views
 * @param {ReturnType<typeof import('./open.js').createOpener>} ctx.opener
 * @param {ReturnType<typeof import('./icons.js').createIcons>} ctx.icons
 * @param {{sessionFor: (item: Item) => {ses: any}, clearCache: () => Promise<{cleared: number}>}} ctx.sessions
 * @param {(autostart: boolean) => {applied: boolean}} ctx.applyAutostart
 * @param {any} ctx.dialog
 * @param {any} ctx.Menu
 * @param {(p: string) => boolean} ctx.existsSync
 * @param {ReturnType<typeof import('./sync-settings.js').createSyncSettings>} ctx.sync  Sync settings (the secret never leaves it)
 * @param {ReturnType<typeof import('./sync.js').createSync>} ctx.engine  the sync engine (ticks go through it)
 * @param {{packaged: boolean, version: string}} ctx.meta
 * @param {string} ctx.uiUrlPrefix   frames of the UI start with this URL
 */
export function createApi(ctx) {
  const { win, store, views, opener, dialog, Menu, icons } = ctx;
  /** D117: the item last opened in Edge or as a program, to ask "Done with ...?" when the window comes back. */
  const returns = createReturnTracker();

  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** Push the current state to the UI (coalesced to at most one per ~50 ms). */
  function broadcast() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!win.isDestroyed()) win.webContents.send('fruitery:state', buildState());
    }, 50);
  }

  /** The device settings the UI may see: the sync connection is reachable only through `syncStatus`. */
  function uiDevice() {
    const { sync: _sync, ...device } = store.device();
    return device;
  }

  function buildState() {
    return {
      snapshot: store.snapshot(),
      device: uiDevice(),
      viewStates: views.viewStates(),
      badges: views.badges(),
      iconRevs: icons.revisions(store.snapshot().items.filter((i) => !i.deleted).map((i) => i.id)),
      ticksEnabled: ctx.engine.ticksEnabled(),
      pendingTickItems: [...new Set(store.tickOutbox().map((o) => o.itemId))],
      sync: ctx.sync.status(),
      now: Date.now(),
      meta: ctx.meta,
    };
  }

  /** @param {object} cmd */
  function sendCommand(cmd) {
    if (!win.isDestroyed()) win.webContents.send('fruitery:command', cmd);
  }

  /** @param {string} id @returns {Item | null} */
  const liveItem = (id) => store.snapshot().items.find((i) => i.id === id && !i.deleted) ?? null;
  /** @param {string} id */
  const liveWorkspace = (id) => store.snapshot().workspaces.find((w) => w.id === id && !w.deleted) ?? null;

  /**
   * @param {Item} item
   * @param {boolean} [forcePane]
   * @returns {import('../lib/resolve-open.js').OpenAction}
   */
  function resolve(item, forcePane = false) {
    const ws = liveWorkspace(item.workspaceId);
    if (!ws) return { kind: 'blocked', reason: 'no-url' };
    const snap = store.snapshot();
    const exists = item.kind === 'app' && !forcePane && typeof item.appPath === 'string' && ctx.existsSync(item.appPath);
    const effective = forcePane ? { ...item, edge: { mode: /** @type {const} */ ('never'), profile: null } } : item;
    return resolveOpen(effective, ws, snap.settings, store.device(), Date.now(), exists);
  }

  /** The address a pane shows for an item (ignoring Edge preferences), or null. @param {Item} item */
  function paneUrlFor(item) {
    const r = resolve(item, true);
    return r.kind === 'pane' ? r.url : null;
  }

  /**
   * Ask (native box, above the site views) whether this program may start on this PC.
   * Declining is the default and the answer for anything but "Start".
   * @param {string} programPath
   * @returns {Promise<boolean>}
   */
  async function confirmProgram(programPath) {
    const res = await dialog.showMessageBox(win, {
      type: 'question',
      message: 'Start this program?',
      detail: programPath,
      buttons: ['Start', 'Don’t start'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    return res.response === 0;
  }

  // ------------------------------------------------------------------ handlers

  const handlers = {
    getState: async () => buildState(),

    /**
     * Open an item. Edge / native-app items run their effect; pane items are placed in the layout
     * of the active workspace: in `paneId` (default: the focused pane), or as a new split pane
     * when `opts.split` is given (that always shows the item in a pane, even an Edge item).
     * @param {unknown} itemId
     * @param {unknown} [paneId]
     * @param {unknown} [opts]
     */
    async show(itemId, paneId, opts) {
      const id = idArg(itemId);
      const wantPane = optionalIdArg(paneId);
      /** @type {{dir: 'row' | 'col', side: 'before' | 'after'} | null} */
      let split = null;
      if (opts !== undefined && opts !== null) {
        const o = objectArg(opts);
        if (o.split !== undefined && o.split !== null) {
          const s = objectArg(o.split);
          split = { dir: oneOf(s.dir, /** @type {const} */ (['row', 'col'])), side: s.side === undefined ? 'after' : oneOf(s.side, /** @type {const} */ (['before', 'after'])) };
        }
      }
      const item = liveItem(id);
      if (!item) return { ok: false, error: 'not-found' };
      let r = resolve(item, split !== null);
      // D89: a program that was never approved on this PC starts only after the owner says so
      if (r.kind === 'app' && needsConfirm(r.path, store.device().approvedPrograms)) {
        const started = await confirmProgram(r.path);
        const next = afterAnswer(started, resolve(item, true).kind === 'pane');
        if (next === 'none') return { ok: false, kind: 'app', declined: true };
        if (next === 'fallback') r = resolve(item, true);
        else store.updateDevice({ approvedPrograms: approveProgram(store.device().approvedPrograms, r.path) });
      }
      if (r.kind === 'blocked') return { ok: false, blocked: r.reason, tokens: r.tokens ?? [] };
      if (r.kind === 'edge') {
        const res = await opener.openInEdge(r.url, r.profile);
        if (res.ok) returns.opened(item.id);
        return { ok: res.ok, kind: 'edge' };
      }
      if (r.kind === 'app') {
        const res = await opener.openProgram(r.path);
        if (res.ok) returns.opened(item.id);
        return { ok: res.ok, kind: 'app' };
      }
      const wsId = store.device().activeWorkspaceId;
      if (!wsId) return { ok: false, error: 'no-workspace' };
      const dev = store.device();
      let tree = dev.layouts[wsId] ?? Layout.leaf('p1', null);
      const focused = dev.focusedPaneByWorkspace[wsId] ?? Layout.leaves(tree)[0].paneId;
      const target = wantPane && Layout.findPane(tree, wantPane) ? wantPane : focused;
      /** @type {string} */
      let focusPane = target;
      if (split) {
        const res = Layout.split(tree, target, split.dir, Layout.nextPaneId(tree), id, split.side);
        if ('error' in res) return { ok: false, error: res.error };
        if ('focus' in res) focusPane = res.focus;
        else {
          tree = res.tree;
          focusPane = res.paneId;
        }
      } else {
        const res = Layout.setItem(tree, target, id);
        if ('error' in res) return { ok: false, error: res.error };
        if ('focus' in res) focusPane = res.focus;
        else tree = res.tree;
      }
      store.setLayout(wsId, tree, focusPane);
      store.setActiveItem(wsId, id);
      broadcast();
      return { ok: true, kind: 'pane', paneId: focusPane };
    },

    /** @param {unknown} workspaceId @param {unknown} layout @param {unknown} focusedPaneId */
    async setLayout(workspaceId, layout, focusedPaneId) {
      const res = store.setLayout(idArg(workspaceId), objectArg(layout), optionalIdArg(focusedPaneId));
      broadcast();
      return res;
    },

    /**
     * Focus another pane. Only ids travel: main checks the pane against its own layout (D131).
     * @param {unknown} workspaceId @param {unknown} paneId
     */
    async focusPane(workspaceId, paneId) {
      const a = focusPaneArgs(workspaceId, paneId);
      const res = store.setFocusedPane(a.workspaceId, a.paneId);
      broadcast();
      return res;
    },

    /** @param {unknown} rects */
    async setPaneRects(rects) {
      views.applyRects(rectsArg(rects));
      return { ok: true };
    },

    /** @param {unknown} id */
    async selectWorkspace(id) {
      const res = store.setActiveWorkspace(idArg(id));
      broadcast();
      return res;
    },

    /** @param {unknown} itemId @param {unknown} action */
    async navigate(itemId, action) {
      const ok = views.navigate(idArg(itemId), oneOf(action, /** @type {const} */ (['back', 'forward', 'reload', 'home'])));
      broadcast();
      return { ok };
    },

    /** @param {unknown} on */
    async setOverlay(on) {
      views.setOverlay(boolArg(on));
      return { ok: true };
    },

    /** @param {unknown} itemId */
    async tick(itemId) {
      const res = await ctx.engine.tick(idArg(itemId));
      broadcast();
      return res;
    },

    /** @param {unknown} itemId */
    async untick(itemId) {
      const res = await ctx.engine.untick(idArg(itemId));
      broadcast();
      return res;
    },

    /** @param {unknown} patch */
    async upsert(patch) {
      const res = store.upsert(objectArg(patch));
      broadcast();
      return res;
    },

    /** @param {unknown} kind @param {unknown} parentId @param {unknown} id @param {unknown} toIndex */
    async reorder(kind, parentId, id, toIndex) {
      const res = store.reorder(oneOf(kind, /** @type {const} */ (['workspace', 'group', 'item'])), optionalIdArg(parentId), idArg(id), indexArg(toIndex));
      broadcast();
      return res;
    },

    /** @param {unknown} itemId @param {unknown} toWorkspaceId */
    async moveItem(itemId, toWorkspaceId) {
      const res = store.moveItem(idArg(itemId), idArg(toWorkspaceId));
      broadcast();
      return res;
    },

    /** @param {unknown} kind @param {unknown} id */
    async remove(kind, id) {
      const k = oneOf(kind, /** @type {const} */ (['workspace', 'group', 'item']));
      const target = idArg(id);
      const doomed = k === 'item' ? [target] : k === 'workspace' ? store.snapshot().items.filter((i) => i.workspaceId === target).map((i) => i.id) : [];
      const res = store.remove(k, target);
      if ('ok' in res) {
        for (const d of doomed) {
          views.destroyItem(d);
          icons.remove(d);
        }
      }
      broadcast();
      return res;
    },

    /** @param {unknown} patch */
    async saveSettings(patch) {
      const p = objectArg(patch);
      const res = store.upsert({ settings: { timezone: p.timezone, googleEmail: p.googleEmail } });
      broadcast();
      return res;
    },

    /** Only the owner-editable device keys come from the UI. @param {unknown} patch */
    async saveDevice(patch) {
      const p = objectArg(patch);
      const allowed = /** @type {Record<string, unknown>} */ ({});
      if ('edgeProfile' in p) allowed.edgeProfile = p.edgeProfile;
      if ('autostart' in p) allowed.autostart = boolArg(p.autostart);
      if ('listWidth' in p) allowed.listWidth = indexArg(p.listWidth);
      if ('diskCacheMB' in p) allowed.diskCacheMB = indexArg(p.diskCacheMB);
      const dev = store.updateDevice(/** @type {any} */ (allowed));
      const auto = ctx.applyAutostart(dev.autostart);
      broadcast();
      return { ok: true, autostartApplied: auto.applied };
    },

    /**
     * Pin an item to the strip at the bottom of the list column, unpin it, or collapse/expand the
     * strip. `itemId` must be a live item id (or null to unpin); an unknown id is refused.
     * @param {unknown} input `{itemId?: string|null, collapsed?: boolean}`
     */
    async setPin(input) {
      const p = objectArg(input);
      /** @type {Record<string, unknown>} */
      const patch = {};
      if ('itemId' in p) {
        const id = optionalIdArg(p.itemId);
        if (id !== null && !liveItem(id)) return { ok: false, error: 'not-found' };
        patch.pinnedItemId = id;
      }
      if ('collapsed' in p) patch.pinnedCollapsed = boolArg(p.collapsed);
      store.updateDevice(/** @type {any} */ (patch));
      broadcast();
      return { ok: true };
    },

    /** Clear Chromium's web cache for every site session, keeping cookies and site storage (logins stay). */
    async clearWebCache() {
      const r = await ctx.sessions.clearCache();
      return { ok: true, cleared: r.cleared };
    },

    /** Live sync status for the Sync settings. Only these fields ever reach the UI (never the secret). */
    async syncStatus() {
      return ctx.sync.status();
    },

    /**
     * Save the connection. Blank client id / secret keep the stored ones.
     * @param {unknown} input
     * @returns {Promise<{ok: true} | {ok: false, errors: {field: string, code: string}[]}>}
     */
    async syncConfigure(input) {
      const res = ctx.sync.configure(syncConfigureArg(input));
      broadcast();
      return res;
    },

    /** "Test connection": GET /api/state with the stored key. */
    async syncTest() {
      return ctx.sync.test();
    },

    /**
     * "Discard" in the Needs attention list: drop a rejected change and pull the server's version.
     * @param {unknown} kind @param {unknown} id
     */
    async syncDiscard(kind, id) {
      const a = syncDiscardArgs(kind, id);
      const res = ctx.engine.discard(a.kind, a.id);
      broadcast();
      return res;
    },

    /**
     * Dismiss the notice about a waiting tick the server refused.
     * @param {unknown} id
     */
    async syncDismissTickNotice(id) {
      const res = { ok: ctx.engine.dismissTickNotice(idArg(id)) };
      broadcast();
      return res;
    },

    /** Delete the stored secret and forget the key (the address stays). */
    async syncDisconnect() {
      const res = ctx.sync.disconnect();
      broadcast();
      return res;
    },

    /** @param {unknown} itemId */
    async openInEdge(itemId) {
      const item = liveItem(idArg(itemId));
      if (!item) return { ok: false, error: 'not-found' };
      const forced = /** @type {Item} */ ({ ...item, edge: { mode: 'always', profile: item.edge.profile } });
      const ws = liveWorkspace(item.workspaceId);
      if (!ws) return { ok: false, error: 'not-found' };
      const r = resolveOpen(forced, ws, store.snapshot().settings, store.device(), Date.now(), false);
      if (r.kind === 'blocked') return { ok: false, blocked: r.reason, tokens: r.tokens ?? [] };
      if (r.kind !== 'edge') return { ok: false, error: 'not-web' };
      const res = await opener.openInEdge(r.url, r.profile);
      if (res.ok) returns.opened(item.id);
      return { ok: res.ok };
    },

    /**
     * Copy the page's current address (read from the view, never sent by the UI) to the clipboard.
     * @param {unknown} itemId
     */
    async copyAddress(itemId) {
      const url = views.copyAddress(idArg(itemId));
      return url ? { ok: true, url } : { ok: false, error: 'no-address' };
    },

    /**
     * Load an address the owner typed in the pane's own view; the item's saved address is unchanged.
     * @param {unknown} itemId @param {unknown} text
     */
    async navigateTo(itemId, text) {
      const res = views.navigateTo(idArg(itemId), textArg(text));
      broadcast();
      return res;
    },

    /**
     * Open the page a pane currently shows in Edge (the item's profile, else this PC's).
     * @param {unknown} itemId
     */
    async openPageInEdge(itemId) {
      const id = idArg(itemId);
      const item = liveItem(id);
      const url = views.currentUrl(id);
      if (!item) return { ok: false, error: 'not-found' };
      if (!url) return { ok: false, error: 'no-address' };
      const res = await opener.openInEdge(url, pageEdgeProfile(item, store.device()));
      return { ok: res.ok };
    },

    /** The cached site icon as a data URL, or null. @param {unknown} itemId */
    async getIcon(itemId) {
      return icons.dataUrl(idArg(itemId));
    },

    /**
     * "Refresh icon": a one-off fetch for one item, started by the owner.
     * @param {unknown} itemId
     */
    async refreshIcon(itemId) {
      const id = idArg(itemId);
      const item = liveItem(id);
      if (!item) return { ok: false, error: 'not-found' };
      const ses = ctx.sessions.sessionFor(item).ses;
      const found = await icons.refresh(id, { pageIcons: views.faviconsOf(id), homeUrl: paneUrlFor(item), ses });
      broadcast();
      return { ok: true, found };
    },

    /** A native context menu. Edit / split / delete are commands for the UI; the rest act here. */
    async contextMenu(kind, id) {
      const k = oneOf(kind, /** @type {const} */ (['item', 'workspace', 'group']));
      const target = idArg(id);
      /** @type {any[]} */
      let template = [];
      if (k === 'item') {
        const item = liveItem(target);
        if (!item) return { ok: false };
        const others = store.snapshot().workspaces.filter((w) => !w.deleted && w.id !== item.workspaceId).sort((a, b) => a.order - b.order);
        template = [
          // F3 is shown beside the entry (display only: the key itself is handled by the window and by sites)
          { label: 'Edit…', accelerator: 'F3', registerAccelerator: false, click: () => sendCommand({ type: 'edit-item', itemId: target }) },
          { label: 'Open in split right', click: () => sendCommand({ type: 'split', itemId: target, dir: 'row' }) },
          { label: 'Open in split below', click: () => sendCommand({ type: 'split', itemId: target, dir: 'col' }) },
          { label: 'Open in Edge', click: () => { void handlers.openInEdge(target).then((r) => { if (!r.ok) sendCommand({ type: 'open-failed', itemId: target, blocked: /** @type {any} */ (r).blocked ?? null }); }); } },
          { label: 'Move to', submenu: others.length === 0 ? [{ label: 'No other workspace', enabled: false }] : others.map((w) => ({ label: w.name, click: () => { void handlers.moveItem(target, w.id); } })) },
          store.device().pinnedItemId === target
            ? { label: 'Unpin from strip', click: () => { void handlers.setPin({ itemId: null }); } }
            : { label: 'Pin to strip', click: () => { void handlers.setPin({ itemId: target }); } },
          { type: 'separator' },
          { label: 'Delete…', click: () => sendCommand({ type: 'delete', kind: 'item', id: target }) },
        ];
      } else if (k === 'workspace') {
        template = [
          { label: 'Edit workspace…', click: () => sendCommand({ type: 'edit-workspace', id: target }) },
          { type: 'separator' },
          { label: 'Delete…', click: () => sendCommand({ type: 'delete', kind: 'workspace', id: target }) },
        ];
      } else {
        template = [
          { label: 'Rename group…', click: () => sendCommand({ type: 'edit-group', id: target }) },
          { type: 'separator' },
          { label: 'Delete…', click: () => sendCommand({ type: 'delete', kind: 'group', id: target }) },
        ];
      }
      Menu.buildFromTemplate(template).popup({ window: win });
      return { ok: true };
    },

    /** Native confirmation box (above the site views, unlike an HTML dialog). @param {unknown} options */
    async confirm(options) {
      const o = confirmArg(options);
      const res = await dialog.showMessageBox(win, {
        type: 'question',
        message: o.message,
        detail: o.detail,
        buttons: o.buttons,
        defaultId: 0,
        cancelId: o.cancelId,
        noLink: true,
      });
      return { response: res.response };
    },

    async pickProgram() {
      const res = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'cmd'] }, { name: 'All files', extensions: ['*'] }],
      });
      return { path: res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0] };
    },
  };

  /**
   * Register every handler on ipcMain. Only the UI window's own top frame may call.
   * @param {any} ipcMain
   */
  function register(ipcMain) {
    for (const [name, fn] of Object.entries(handlers)) {
      ipcMain.handle(`fruitery:${name}`, (/** @type {any} */ event, /** @type {unknown[]} */ ...args) => {
        const fromUi = event.sender === win.webContents && typeof event.senderFrame?.url === 'string' && event.senderFrame.url.startsWith(ctx.uiUrlPrefix);
        if (!fromUi) throw new Error('forbidden');
        return /** @type {Function} */ (fn)(...args);
      });
    }
  }

  /**
   * A site view gained keyboard focus: focus its pane in main's own layout (no round trip through the UI, so
   * no stale tree can come back, D131), then tell the UI as before.
   * @param {string} itemId
   */
  function siteFocused(itemId) {
    const wsId = store.device().activeWorkspaceId;
    const tree = wsId ? store.device().layouts[wsId] : undefined;
    const leaf = tree ? Layout.findItem(tree, itemId) : null;
    if (wsId && leaf) {
      store.setFocusedPane(wsId, leaf.paneId);
      broadcast();
    }
    sendCommand({ type: 'focus-item', itemId });
  }

  /** The window lost focus (wired by main.js). */
  function windowBlur() {
    returns.blur();
  }

  /** The window got focus: when an item was opened in Edge or as a program and the window was left since, offer the tick. */
  function windowFocus() {
    const itemId = returns.focus();
    if (itemId) sendCommand({ type: 'done-prompt', itemId });
  }

  return { handlers, register, broadcast, buildState, sendCommand, resolve, paneUrlFor, windowBlur, windowFocus, siteFocused };
}
