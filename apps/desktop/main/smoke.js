// @ts-check
// Smoke mode (`npm run smoke -w apps/desktop`): an automated end-to-end run of the real app against a
// local HTTP server, with Edge / the default browser / native dialogs replaced by recording stubs.
// It checks the invariants (paths, sandbox, no reload on switch, sleep/wake, UA, cookies, permissions,
// popups, the IPC contract, the UI) and prints `SMOKE OK` when everything holds.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { args, dataDir, DISK_CACHE_BYTES } from './paths.js';
import { encodePng } from '../lib/icon.js';

export const CUSTOM_UA = 'FruiterySmokeAgent/1.0';

/** A solid green square PNG, `size` pixels. @param {number} size */
function smokePng(size) {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) px.set([40, 160, 70, 255], i * 4);
  return encodePng(size, size, px);
}

/** A 16x16 32-bit bitmap ICO (the common favicon.ico format, not a PNG inside). */
function smokeIcoBitmap() {
  const w = 16;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(w, 4);
  header.writeInt32LE(w * 2, 8); // height counts the AND mask too
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(w * w * 4);
  for (let i = 0; i < w * w; i++) pixels.set([200, 90, 30, 255], i * 4); // BGRA
  const mask = Buffer.alloc(w * 4); // 1 bit per pixel, rows padded to 4 bytes
  return icoFile(w, Buffer.concat([header, pixels, mask]));
}

/** An ICO whose single entry is a PNG. */
function smokeIcoWrappingPng() {
  return icoFile(32, smokePng(32));
}

/** @param {number} width @param {Buffer} data */
function icoFile(width, data) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(1, 4); // one image
  head[6] = width;
  head[7] = width;
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(data.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, data]);
}
/** @param {string} id @param {string} name */
const itemBase = (id, name) => ({
  id, name, icon: null, kind: 'web', appPath: null, fallbackUrl: null, devices: 'all', schedule: null, resetTime: '00:00',
  notify: false, badge: false, edge: { mode: 'inherit', profile: null }, isolate: false, persistSessionCookies: true,
  sleepAfterMin: null, userAgent: { preset: 'default', custom: null }, updatedAt: 0, deleted: false,
});

/**
 * Start the local server and build a seed that points at it. Called before the store opens.
 */
export async function prepareSmoke() {
  /** @type {{path: string, ua: string}[]} */
  const requests = [];
  const portFile = path.join(dataDir, 'smoke-port.json');
  let preferred = 0;
  try {
    preferred = JSON.parse(fs.readFileSync(portFile, 'utf8')).port;
  } catch {
    // first step
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    requests.push({ path: url.pathname, ua: String(req.headers['user-agent'] ?? '') });
    // site icons: a PNG, a bitmap ICO (what most sites serve), an ICO wrapping a PNG, and a "too large" image
    if (url.pathname === '/favicon.ico') {
      res.setHeader('Content-Type', 'image/x-icon');
      res.end(smokeIcoBitmap());
      return;
    }
    if (url.pathname === '/icons/wrapped.ico') {
      res.setHeader('Content-Type', 'image/x-icon');
      res.end(smokeIcoWrappingPng());
      return;
    }
    if (url.pathname.startsWith('/icons/') && url.pathname.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
      res.end(smokePng(48));
      return;
    }
    if (url.pathname === '/icons/huge.png') {
      res.setHeader('Content-Type', 'image/png');
      res.end(Buffer.concat([smokePng(8), Buffer.alloc(300 * 1024)]));
      return;
    }
    const name = url.pathname.split('/').pop() ?? 'page';
    const title = name === 'a1' ? '(3) Alpha one' : name;
    // a1 names a PNG icon, a2 the bitmap ICO, a3 nothing, any other page (including the front page `/`) a PNG
    const iconLink = name === 'a1' ? '<link rel="icon" href="/icons/a1.png">' : name === 'a2' ? '<link rel="icon" href="/favicon.ico">' : name === 'a3' ? '' : '<link rel="icon" href="/icons/other.png">';
    res.setHeader('Set-Cookie', `sid-${name}=v-${name}; Path=/; HttpOnly`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      `<!doctype html><title>${title}</title>${iconLink}<body style="margin:0;font:16px sans-serif"><div style="height:5000px">page ${name}<br><a id="lnk" href="/page/linked">a link</a> <span id="sel">some selectable text</span></div></body>`,
    );
  });
  const listen = (/** @type {number} */ port) =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(undefined); });
    });
  try {
    await listen(preferred);
  } catch {
    await listen(0);
  }
  const port = /** @type {any} */ (server.address()).port;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(portFile, JSON.stringify({ port }));

  const local = `http://127.0.0.1:${port}`;
  const host = `http://localhost:${port}`;
  const workspace = (/** @type {string} */ id, /** @type {string} */ name, /** @type {number} */ order, /** @type {number} */ sleepAfterMin) =>
    ({ id, name, icon: null, order, sleepAfterMin, openInEdge: false, updatedAt: 0, deleted: false });
  const seed = {
    workspaces: [workspace('ws-a', 'Alpha', 0, 10), workspace('ws-b', 'Beta', 1, 0)],
    groups: [{ id: 'g-a', workspaceId: 'ws-a', name: 'Checks', order: 0, collapsed: false, updatedAt: 0, deleted: false }],
    items: [
      { ...itemBase('a1', 'Alpha one'), workspaceId: 'ws-a', groupId: 'g-a', order: 0, url: `${local}/page/a1`, schedule: { type: 'daily' }, badge: true },
      { ...itemBase('a5', 'Alpha five'), workspaceId: 'ws-a', groupId: 'g-a', order: 1, url: `${local}/page/a5`, schedule: { type: 'daily' } },
      { ...itemBase('a2', 'Alpha two'), workspaceId: 'ws-a', groupId: null, order: 0, url: `${local}/page/a2`, userAgent: { preset: 'custom', custom: CUSTOM_UA } },
      { ...itemBase('a3', 'Alpha iso'), workspaceId: 'ws-a', groupId: null, order: 1, url: `${local}/page/a3`, isolate: true },
      { ...itemBase('a4', 'Alpha local'), workspaceId: 'ws-a', groupId: null, order: 2, url: `${host}/page/a4`, persistSessionCookies: false },
      { ...itemBase('b1', 'Beta one'), workspaceId: 'ws-b', groupId: null, order: 0, url: `${local}/page/b1` },
      { ...itemBase('b2', 'Beta two'), workspaceId: 'ws-b', groupId: null, order: 1, url: `${local}/page/b2`, sleepAfterMin: 1 },
      { ...itemBase('b3', 'Beta notify'), workspaceId: 'ws-b', groupId: null, order: 2, url: `${local}/page/b3`, notify: true },
    ],
    settings: { timezone: 'UTC', googleEmail: null, updatedAt: 0 },
  };

  /** @type {string[]} */ const external = [];
  /** @type {{file: string, args: string[], options: any}[]} */ const spawned = [];
  /** @type {any[]} */ const dialogCalls = [];
  /** @type {number[]} */ const dialogAnswers = [];
  /** @type {any[][]} */ const menus = [];
  /** @type {string[]} */ const clipboardWrites = [];
  /** @type {string[]} */ const programs = [];
  return {
    server,
    port,
    local,
    seedText: JSON.stringify(seed),
    requests,
    external,
    spawned,
    dialogCalls,
    dialogAnswers,
    menus,
    clipboardWrites,
    programs,
    menuStub: {
      buildFromTemplate: (/** @type {any[]} */ template) => {
        menus.push(template);
        return { popup: () => {} };
      },
    },
    clipboardStub: { writeText: (/** @type {string} */ text) => { clipboardWrites.push(text); } },
    shellStub: {
      openExternal: async (/** @type {string} */ u) => { external.push(u); },
      openPath: async (/** @type {string} */ p) => { programs.push(p); return ''; },
    },
    spawnStub: (/** @type {string} */ file, /** @type {string[]} */ a, /** @type {any} */ options) => {
      spawned.push({ file, args: a, options });
      return { on() {}, unref() {} };
    },
    dialogStub: {
      showMessageBox: async (/** @type {any} */ _win, /** @type {any} */ opts) => {
        dialogCalls.push(opts);
        return { response: dialogAnswers.shift() ?? opts.cancelId ?? 0 };
      },
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
  };
}

// ---------------------------------------------------------------------------------------------

/** @param {() => any} fn @param {string} label @param {number} [timeoutMs] */
async function waitFor(fn, label, timeoutMs = 12000) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch {
      v = false;
    }
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}

/**
 * Run the smoke checks.
 * @param {any} c  { smoke, app, win, store, views, api, sessions, dataDir, BrowserWindow, uiUrlPrefix, session, secrets, requestApi, sync }
 * @returns {Promise<number>} exit code
 */
export async function runSmoke(c) {
  const { smoke, app, win, store, views, api, session, secrets, requestApi, sync, engine } = c;
  /** @type {string[]} */ const failures = [];
  /** @param {string} name @param {unknown} cond @param {unknown} [detail] */
  const check = (name, cond, detail) => {
    if (cond) console.log(`  ok   ${name}`);
    else {
      failures.push(name);
      console.log(`  FAIL ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}`);
    }
  };
  /** @param {string} code */
  const ui = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (err) {
      /** @type {Error} */ (err).message += `  [in: ${String(code).slice(0, 160)}]`;
      throw err;
    }
  };
  /** @param {string} name */
  const shot = async (name) => {
    if (!args.shots) return;
    fs.mkdirSync(args.shots, { recursive: true });
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(args.shots, `${name}.png`), img.toPNG());
  };
  // errors and warnings of the app UI show up in the run's output
  win.webContents.on('console-message', (/** @type {any} */ e) => {
    const level = e?.level ?? '';
    if (level === 'error' || level === 'warning' || level === 2 || level === 3) console.log(`  [ui console ${level}] ${String(e?.message ?? '').slice(0, 300)}`);
  });
  win.webContents.on('preload-error', (/** @type {any} */ _e, /** @type {string} */ file, /** @type {Error} */ err) => console.log(`  [ui preload error] ${file}: ${err?.message}`));
  const ctx = { smoke, app, win, store, views, api, session, secrets, requestApi, sync, engine, check, ui, shot, waitFor, failures };

  try {
    console.log('[A] paths, window, UI bridge');
    await phaseA(ctx);
    if (args.smokeStep === 2) {
      console.log('[R] restart: persisted state');
      const { phaseRestart } = await import('./smoke-phases.js');
      await phaseRestart(ctx);
    } else {
      const phases = await import('./smoke-phases.js');
      console.log('[B] views: no reload on switch, sleep/wake, splits, UA, cookies, popups, permissions');
      await phases.phaseViews(ctx);
      console.log('[U] UI: seed rendered, split, Daily bar, Basket full');
      await phases.phaseUi(ctx);
      console.log('[P] polish: shortcuts, title and address field, page actions and menu, icons, tick circle, return toast');
      await phases.phasePolish(ctx);
      console.log('[I] IPC contract');
      await phases.phaseIpc(ctx);
      console.log('[S] sync settings: encrypted secret, HTTP seam, nothing leaks to the UI, the Sync section');
      await phases.phaseSync(ctx);
      console.log('[W] sync against the real Worker handler: connect, first sync, push/pull, offline, rejected entries, ticks, the chip');
      await phases.phaseWorker(ctx);
      console.log('[E] editor flows');
      await phases.phaseEditor(ctx);
    }
  } catch (err) {
    check(`run completed (${/** @type {Error} */ (err).message})`, false);
    console.error(err);
  }
  if (failures.length === 0) {
    console.log('SMOKE OK');
    return 0;
  }
  console.log(`SMOKE FAILED: ${failures.length} check(s)`);
  return 1;
}

/** @param {any} ctx */
async function phaseA(ctx) {
  const { app, win, check, ui, waitFor } = ctx;
  try {
    await waitFor(() => ui('window.__fruiteryUiReady === true'), 'UI ready');
  } catch (e) {
    check('UI loaded and ready', false, await ui('window.__fruiteryUiError ?? null'));
    throw e;
  }
  check('UI loaded and ready', true);
  check('UI imported core as an ES module (CSP default-src self, file://)', (await ui('window.__fruiteryCore')) === true);
  const dd = dataDir.toLowerCase();
  for (const name of ['userData', 'sessionData', 'logs', 'crashDumps', 'appData']) {
    check(`app path ${name} is inside the data folder`, app.getPath(name).toLowerCase().startsWith(dd), app.getPath(name));
  }
  check('data folder contains cache.json and device.json', fs.existsSync(path.join(dataDir, 'cache.json')) && fs.existsSync(path.join(dataDir, 'device.json')));
  const prefs = win.webContents.getLastWebPreferences();
  check('UI window: sandbox, contextIsolation on; nodeIntegration, webview off', prefs.sandbox === true && prefs.contextIsolation === true && !prefs.nodeIntegration && !prefs.webviewTag, prefs);
  check('UI has no require / process (no Node in the renderer)', (await ui("typeof require === 'undefined' && typeof process === 'undefined'")) === true);
  const bridge = await ui('Object.keys(window.fruitery).sort()');
  check(
    'preload bridge exposes the IPC contract',
    ['getState', 'onState', 'onCommand', 'onShortcut', 'show', 'setLayout', 'focusPane', 'setPaneRects', 'selectWorkspace', 'navigate', 'setOverlay', 'tick', 'untick', 'upsert', 'reorder', 'moveItem', 'remove', 'saveSettings', 'saveDevice', 'setPin', 'clearWebCache', 'openInEdge', 'contextMenu', 'confirm', 'pickProgram', 'copyAddress', 'navigateTo', 'openPageInEdge', 'getIcon', 'refreshIcon', 'syncStatus', 'syncConfigure', 'syncTest', 'syncDisconnect', 'syncDiscard', 'syncDismissTickNotice'].every((k) => bridge.includes(k)),
    bridge,
  );
  const csp = await ui("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content ?? ''");
  check("strict CSP present (default-src 'self', no unsafe-inline / unsafe-eval)", csp.includes("default-src 'self'") && !csp.includes('unsafe'), csp);
  check('disk-cache-size switch matches the configured cap', app.commandLine.getSwitchValue('disk-cache-size') === String(DISK_CACHE_BYTES), app.commandLine.getSwitchValue('disk-cache-size'));
  check('the UI window only navigates to its own file', win.webContents.getURL().startsWith('file:'), win.webContents.getURL());
}

