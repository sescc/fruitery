// @ts-check
// Fruitery desktop main process. paths.js MUST be the first import: it redirects every Electron
// data path into <exeDir>\data and sets the disk-cache switch before anything else can touch them.

import { args, dataDir, localSeedPath } from './paths.js';
import { app, BrowserWindow, Menu, ipcMain, dialog, shell, session, screen, nativeTheme, nativeImage, clipboard, safeStorage, net } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openStore } from './store.js';
import { createSessions } from './sessions.js';
import { createViews } from './views.js';
import { createOpener } from './open.js';
import { createApi } from './ipc.js';
import { createTray, applyAutostart, appIcon } from './tray.js';
import { createIcons } from './icons.js';
import { createConverter } from './icon-convert.js';
import { fetchLimited } from './icon-fetch.js';
import { createSecrets } from './secrets.js';
import { createRequestApi } from './sync-http.js';
import { createSyncSettings } from './sync-settings.js';
import { createSync } from './sync.js';
import { shortcutFor, appCommandAction } from '../lib/shortcuts.js';

const desktopDir = path.resolve(import.meta.dirname, '..');
const uiFile = path.join(desktopDir, 'ui', 'index.html');
const uiUrlPrefix = pathToFileURL(path.join(desktopDir, 'ui')).href;

/** @type {any} */
let win = null;
let quitting = false;
let cookiesFlushed = false;

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** @returns {string | null} */
function readLocalSeed() {
  if (args.noLocalSeed || args.smoke) return null;
  try {
    return fs.readFileSync(localSeedPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Saved bounds, if they still fall on a connected display.
 * @param {import('./store.js').DeviceSettings['windowBounds']} b
 */
function boundsOptions(b) {
  if (!b) return { width: 1280, height: 800 };
  /** @type {Record<string, number>} */
  const o = { width: b.width, height: b.height };
  if (typeof b.x === 'number' && typeof b.y === 'number') {
    const area = screen.getDisplayMatching({ x: b.x, y: b.y, width: b.width, height: b.height }).workArea;
    const inside = b.x < area.x + area.width - 80 && b.x + b.width > area.x + 80 && b.y >= area.y - 10 && b.y < area.y + area.height - 80;
    if (inside) {
      o.x = b.x;
      o.y = b.y;
    }
  }
  return o;
}

async function boot() {
  app.setAppUserModelId('app.fruitery.desktop');
  Menu.setApplicationMenu(null);

  /** @type {Awaited<ReturnType<typeof import('./smoke.js').prepareSmoke>> | null} */
  let smoke = null;
  if (args.smoke) {
    const { prepareSmoke } = await import('./smoke.js');
    smoke = await prepareSmoke();
  }

  const store = openStore(dataDir, { seedText: smoke ? smoke.seedText : readLocalSeed() });
  for (const note of store.notes()) console.warn(`[store] ${note}`);

  /** @type {ReturnType<typeof createViews> | null} */
  let views = null;
  /** @type {ReturnType<typeof createApi> | null} */
  let api = null;

  const sessions = createSessions({
    electronSession: session,
    getSnapshot: () => store.snapshot(),
    itemIdOfWebContents: (wc) => (views ? views.itemIdOfWebContents(wc) : null),
    popupUserAgent: (id) => (views ? views.popupUserAgent(id) : null),
  });

  // in smoke mode nothing real is launched: Edge, the default browser and native dialogs are stubs
  const opener = createOpener({
    spawn: /** @type {any} */ (smoke ? smoke.spawnStub : spawn),
    existsSync: smoke ? () => true : fs.existsSync,
    env: smoke ? { 'ProgramFiles(x86)': 'C:\\Smoke' } : process.env,
    shell: smoke ? smoke.shellStub : shell,
  });

  // D116: per-PC icon cache in <data>\icons; captured when a site loads, refreshed on request, never fetched in the background
  const iconsDir = path.join(dataDir, 'icons');
  const icons = createIcons({
    dir: iconsDir,
    fs,
    fetch: fetchLimited,
    convert: createConverter({ nativeImage, fs, tmpDir: iconsDir }),
    onChange: () => api?.broadcast(),
  });
  // sync access key: the secret is encrypted for this Windows user in <data>\sync-secret.bin and never reaches the UI;
  // plain http to a local address is accepted only in smoke / development
  const secrets = createSecrets({ dir: dataDir, safeStorage });
  const allowLocal = args.smoke || !app.isPackaged;
  const requestApi = createRequestApi({ fetch: (url, init) => net.fetch(url, init), allowLocal });
  // the sync engine: pushes and pulls on start, on focus, every minute and after edits; ticks go through the Worker when connected
  const engine = createSync({ store, secrets, requestApi, onChange: () => api?.broadcast() });
  const sync = createSyncSettings({ store, secrets, requestApi, allowLocal, engine });
  // in smoke mode the menu and the clipboard are recording stubs (a real popup would block, a real write would clobber the clipboard)
  const menuApi = smoke ? smoke.menuStub : Menu;
  const clipboardApi = smoke ? smoke.clipboardStub : clipboard;

  win = new BrowserWindow({
    ...boundsOptions(store.device().windowBounds),
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Fruitery',
    icon: appIcon(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1c20' : '#f4f5f7',
    webPreferences: {
      preload: path.join(desktopDir, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      session: sessions.uiSession(),
    },
  });
  const wc = win.webContents;
  // The UI is a closed shell: no navigation, no new windows, no webviews.
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (/** @type {any} */ e) => e.preventDefault());
  wc.on('will-attach-webview', (/** @type {any} */ e) => e.preventDefault());

  views = createViews({
    win,
    sessions,
    getSnapshot: () => store.snapshot(),
    paneUrlFor: (item) => (api ? api.paneUrlFor(item) : null),
    openExternal: (url) => { void opener.openExternal(url); },
    onChange: () => api?.broadcast(),
    onShortcut: (s) => { if (!win.isDestroyed()) win.webContents.send('fruitery:shortcut', s); },
    onFocusItem: (itemId) => api?.siteFocused(itemId),
    icons,
    Menu: menuApi,
    clipboard: clipboardApi,
    openPageInEdge: (itemId) => { void api?.handlers.openPageInEdge(itemId); },
  });

  api = createApi({
    win,
    store,
    views,
    opener,
    icons,
    sessions,
    sync,
    engine,
    applyAutostart,
    dialog: smoke ? smoke.dialogStub : dialog,
    Menu: menuApi,
    existsSync: fs.existsSync,
    meta: { packaged: app.isPackaged, version: app.getVersion() },
    uiUrlPrefix,
  });
  api.register(ipcMain);
  app.on('web-contents-created', (_e, created) => views?.adoptPopup(created));

  // shortcuts also work while the UI itself has focus
  wc.on('before-input-event', (/** @type {any} */ event, /** @type {any} */ input) => {
    const s = shortcutFor(input, 'ui');
    if (s) {
      event.preventDefault();
      wc.send('fruitery:shortcut', s);
    }
  });

  // the mouse's side buttons and the keyboard's browser Back / Forward keys arrive as app commands;
  // they act on the focused pane (the UI knows which it is)
  win.on('app-command', (/** @type {any} */ _e, /** @type {unknown} */ command) => {
    const action = appCommandAction(command);
    if (action && !win.isDestroyed()) win.webContents.send('fruitery:shortcut', { type: 'nav', action });
  });
  // D117: coming back to the window after an item was opened in Edge or a program
  win.on('blur', () => api?.windowBlur());
  win.on('focus', () => {
    api?.windowFocus();
    void engine.onFocus();
  });

  // close-to-tray (D16): closing hides, only Quit exits
  win.on('close', (/** @type {any} */ e) => {
    if (!quitting && !args.smoke && store.device().closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  /** @type {ReturnType<typeof setTimeout> | null} */
  let boundsTimer = null;
  const saveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized() || args.smoke) return;
      const b = win.getNormalBounds();
      store.updateDevice({ windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() } });
    }, 600);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  const trayHandle = args.smoke ? null : createTray({ win, showWindow, quit: () => app.quit() });
  applyAutostart(store.device().autostart);

  // sleep timer (D30)
  const sleepTimer = setInterval(() => { void views?.sleepTick(); }, 30_000);
  sleepTimer.unref();

  app.on('before-quit', (e) => {
    quitting = true;
    if (!cookiesFlushed) {
      e.preventDefault();
      cookiesFlushed = true;
      void sessions.flushAll().finally(() => {
        views?.closeAll();
        trayHandle?.destroy();
        app.quit();
      });
    }
  });

  win.once('ready-to-show', () => {
    const b = store.device().windowBounds;
    if (b?.maximized) win.maximize();
    if (!args.hidden || args.smoke) win.show();
  });
  await win.loadFile(uiFile);
  void engine.start(); // sync on start (does nothing while this PC is not connected)

  if (smoke) {
    const { runSmoke } = await import('./smoke.js');
    const code = await runSmoke({ smoke, app, win, store, views, api, sessions, dataDir, BrowserWindow, uiUrlPrefix, session, secrets, requestApi, sync, engine });
    quitting = true;
    cookiesFlushed = true;
    smoke.server.close();
    views.closeAll();
    app.exit(code);
  }
}

if (!app.requestSingleInstanceLock()) {
  // another copy is running: it shows its window (second-instance), this one exits
  app.exit(0);
} else {
  app.on('second-instance', () => showWindow());
  app.on('window-all-closed', () => {
    // stay in the tray; quitting is explicit
  });
  app.whenReady().then(boot).catch((err) => {
    console.error(err);
    app.exit(1);
  });
}
