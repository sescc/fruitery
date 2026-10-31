// @ts-check
// Smoke phases (see smoke.js). Everything here drives the REAL app: the UI through its DOM and the
// preload bridge, the main process through its modules. Stubs replace Edge, the default browser and
// native dialogs; the sites are a local HTTP server.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { BrowserWindow, session as electronSession } from 'electron';
import { dataDir } from './paths.js';
import { CUSTOM_UA } from './smoke.js';
import * as Layout from '../lib/layout.js';

const sleepMs = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {any} ctx */
function helpers(ctx) {
  const { views, ui, store } = ctx;
  const br = (/** @type {string} */ expr) => ui(`window.fruitery.${expr}`);
  const wcOf = (/** @type {string} */ id) => views.entry(id)?.view?.webContents;
  const loaded = (/** @type {string} */ id) => {
    const e = views.entry(id);
    return Boolean(e && e.awake && e.attached && e.loads >= 1 && !e.loading);
  };
  const dom = (/** @type {string} */ expr) => ui(expr);
  const layoutOf = (/** @type {string} */ ws) => /** @type {any} */ (store.device().layouts[ws]);
  const paneOf = (/** @type {string} */ ws, /** @type {string} */ itemId) => Layout.findItem(layoutOf(ws), itemId)?.paneId ?? null;
  return { br, wcOf, loaded, dom, layoutOf, paneOf };
}

/** Views, sessions, popups, permissions (task 4.2 and the desktop-sessions scenarios). */
export async function phaseViews(/** @type {any} */ ctx) {
  const { smoke, views, store, ui, check, waitFor, win } = ctx;
  const { br, wcOf, loaded, layoutOf, paneOf } = helpers(ctx);

  // --- no reload on switch
  await br("selectWorkspace('ws-a')");
  const shown = await br("show('a1')");
  check('show(a1) opens it in a pane', shown.ok && shown.kind === 'pane', shown);
  await waitFor(() => loaded('a1'), 'a1 loaded');
  const e1 = views.entry('a1');
  const wc1 = e1.view.webContents;
  await wc1.executeJavaScript("window.__marker = 'm-1'; window.scrollTo(0, 600); 1");
  await waitFor(async () => (await wc1.executeJavaScript('window.scrollY')) === 600, 'a1 scrolled');
  const id1 = e1.wcId;
  const url1 = wc1.getURL();
  const loads1 = e1.loads;
  const sitePrefs = wc1.getLastWebPreferences();
  check('site view: sandbox and contextIsolation on, no Node, no preload (Law 1)', sitePrefs.sandbox === true && sitePrefs.contextIsolation === true && !sitePrefs.nodeIntegration && !sitePrefs.preload, { sandbox: sitePrefs.sandbox, ctx: sitePrefs.contextIsolation, node: sitePrefs.nodeIntegration, preload: sitePrefs.preload });
  check('site page cannot see window.fruitery, require or process', (await wc1.executeJavaScript("typeof window.fruitery === 'undefined' && typeof require === 'undefined' && typeof process === 'undefined'")) === true);
  check('badge from the page title "(3) Alpha one" is 3', views.badges().a1 === 3, views.badges());
  await waitFor(() => ui("document.querySelector('#rail .rail-badge')?.textContent === '3'"), 'rail badge');
  check('the rail icon of the workspace shows the badge total (3)', true);

  await br("selectWorkspace('ws-b')");
  await br("show('b1')");
  await waitFor(() => loaded('b1'), 'b1 loaded');
  check('a1 is detached but alive after switching away (hiddenSince set)', e1.awake && !e1.attached && e1.hiddenSince !== null);
  check('a1 JavaScript state survives while hidden', (await wc1.executeJavaScript('window.__marker')) === 'm-1');

  await br("selectWorkspace('ws-a')");
  await waitFor(() => views.entry('a1').attached, 'a1 re-attached');
  check('switch back: same webContents id', views.entry('a1').wcId === id1, [views.entry('a1').wcId, id1]);
  check('switch back: same URL', wc1.getURL() === url1);
  check('switch back: no new page load (did-finish-load count unchanged)', views.entry('a1').loads === loads1, [views.entry('a1').loads, loads1]);
  check('switch back: page state (marker) intact', (await wc1.executeJavaScript('window.__marker')) === 'm-1');
  check('switch back: scroll position intact (600)', (await wc1.executeJavaScript('window.scrollY')) === 600);

  // --- keyboard shortcuts while a site has focus
  wc1.focus();
  wc1.sendInputEvent({ type: 'keyDown', keyCode: '2', modifiers: ['control'] });
  wc1.sendInputEvent({ type: 'keyUp', keyCode: '2', modifiers: ['control'] });
  const ctrl2 = await waitFor(() => store.device().activeWorkspaceId === 'ws-b', 'Ctrl+2', 4000).then(() => true, () => false);
  check('Ctrl+2 from inside a site selects the second workspace', ctrl2, store.device().activeWorkspaceId);
  const wcB = wcOf('b1');
  wcB.focus();
  wcB.sendInputEvent({ type: 'keyDown', keyCode: '5', modifiers: ['control'] });
  wcB.sendInputEvent({ type: 'keyUp', keyCode: '5', modifiers: ['control'] });
  await sleepMs(500);
  check('Ctrl+5 with only 2 workspaces changes nothing', store.device().activeWorkspaceId === 'ws-b');
  wcB.sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers: ['control'] });
  wcB.sendInputEvent({ type: 'keyUp', keyCode: '1', modifiers: ['control'] });
  await waitFor(() => store.device().activeWorkspaceId === 'ws-a', 'Ctrl+1', 4000).catch(() => {});
  check('Ctrl+1 selects the first workspace', store.device().activeWorkspaceId === 'ws-a');
  await waitFor(() => views.entry('a1').attached, 'a1 attached again');

  // --- sleep and wake
  await br("selectWorkspace('ws-b')");
  await waitFor(() => !views.entry('a1').attached, 'a1 hidden');
  const due = await views.sleepTick(Date.now() + 11 * 60_000);
  check('sleep: a1 (Alpha, 10 min) is unloaded, b1 (Beta, never) is kept', due.includes('a1') && !due.includes('b1'), due);
  const asleep = views.entry('a1');
  check('sleep: a1 is asleep and remembers its URL and scroll position', !asleep.awake && asleep.url === url1 && asleep.scrollY >= 590, { awake: asleep.awake, url: asleep.url, y: asleep.scrollY });
  await br("selectWorkspace('ws-a')");
  await waitFor(() => views.entry('a1').awake && loaded('a1'), 'a1 woken');
  const woke = views.entry('a1');
  check('wake: a new webContents loads the last URL', woke.wcId !== id1 && woke.view.webContents.getURL() === url1, [woke.wcId, id1]);
  await waitFor(async () => (await woke.view.webContents.executeJavaScript('window.scrollY')) >= 590, 'scroll restored', 6000).catch(() => {});
  check('wake: the scroll position is restored', (await woke.view.webContents.executeJavaScript('window.scrollY')) >= 590);
  const stillVisible = await views.sleepTick(Date.now() + 999 * 60_000);
  check('a visible view never sleeps, however long', !stillVisible.includes('a1'), stillVisible);
  await br("selectWorkspace('ws-b')");
  await br("show('b2')");
  await waitFor(() => loaded('b2'), 'b2 loaded');
  await br("show('b1')");
  await waitFor(() => !views.entry('b2').attached, 'b2 hidden');
  const dueOverride = await views.sleepTick(Date.now() + 2 * 60_000);
  check('the item override (b2: 1 min) beats the workspace default (never)', dueOverride.length === 1 && dueOverride[0] === 'b2', dueOverride);

  // --- splits (max 4, same item twice, other workspace's item)
  await br("selectWorkspace('ws-a')");
  await br("show('a1')");
  for (const id of ['a2', 'a3', 'a4']) {
    const r = await br(`show('${id}', null, {split: {dir: 'row'}})`);
    check(`split: ${id} opens in a new pane`, r.ok && r.kind === 'pane', r);
  }
  await waitFor(() => ['a1', 'a2', 'a3', 'a4'].every(loaded), 'four panes loaded', 20000);
  check('four panes are shown, each with its own live view', Layout.leaves(layoutOf('ws-a')).length === 4);
  const fifth = await br("show('b3', null, {split: {dir: 'row'}})");
  check('a fifth pane is refused (max-panes)', fifth.ok === false && fifth.error === 'max-panes', fifth);
  ctx.api.sendCommand({ type: 'split', itemId: 'b3', dir: 'row' }); // what "Open in split" does: the UI must tell the owner
  await waitFor(() => ui("document.getElementById('toast').classList.contains('show') && document.getElementById('toast').textContent.includes('Up to 4 panes per workspace')"), 'the 4-pane toast', 4000).catch(() => {});
  check('a fifth split shows the visible toast "Up to 4 panes per workspace"', (await ui("document.getElementById('toast').classList.contains('show') && document.getElementById('toast').textContent")) === 'Up to 4 panes per workspace');
  const dupe = await br("show('a2', null, {split: {dir: 'col'}})");
  check('the same item twice focuses its existing pane', dupe.ok && dupe.paneId === paneOf('ws-a', 'a2') && Layout.leaves(layoutOf('ws-a')).length === 4, dupe);
  const rects = (await ui("[...document.querySelectorAll('.pane-body')].map(b => { const r = b.getBoundingClientRect(); return [b.dataset.pane, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })"));
  const boundsOk = rects.every((/** @type {any[]} */ [paneId, x, y, w, h]) => {
    const leaf = Layout.findPane(layoutOf('ws-a'), paneId);
    const b = leaf?.itemId ? views.entry(leaf.itemId)?.bounds : null;
    return b && Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1 && Math.abs(b.width - w) <= 1 && Math.abs(b.height - h) <= 1;
  });
  check('every native view sits exactly in its pane box', boundsOk, rects);

  // --- user agent (before the first load, per item) and cookies
  const uaA2 = smoke.requests.filter((/** @type {any} */ r) => r.path === '/page/a2').at(-1)?.ua;
  const uaA1 = smoke.requests.filter((/** @type {any} */ r) => r.path === '/page/a1').at(-1)?.ua;
  check('custom UA preset: the first request already carries it', uaA2 === CUSTOM_UA, uaA2);
  check('default preset: Electron\'s own UA', typeof uaA1 === 'string' && uaA1.includes('Electron/'), uaA1);
  check('navigator.userAgent matches the preset', (await wcOf('a2').executeJavaScript('navigator.userAgent')) === CUSTOM_UA);

  const shared = electronSession.fromPartition('persist:fruitery');
  const getCookie = async (/** @type {any} */ ses, /** @type {string} */ name) => (await ses.cookies.get({ name }))[0] ?? null;
  await waitFor(async () => (await getCookie(shared, 'sid-a1'))?.session === false, 'sid-a1 made persistent', 8000).catch(() => {});
  const c1 = await getCookie(shared, 'sid-a1');
  const in30 = (/** @type {any} */ c) => c && c.session === false && Math.abs(c.expirationDate - (Date.now() / 1000 + 30 * 86400)) < 3600;
  check('session cookie became persistent for ~30 days, as it was set', in30(c1), c1 && { session: c1.session, exp: c1.expirationDate });
  check('the converted cookie keeps httpOnly and host-only', c1 && c1.httpOnly === true && c1.hostOnly === true, c1 && { httpOnly: c1.httpOnly, hostOnly: c1.hostOnly, domain: c1.domain });
  const iso = electronSession.fromPartition('persist:fruitery-a3');
  await waitFor(async () => (await getCookie(iso, 'sid-a3'))?.session === false, 'isolated cookie persistent', 8000).catch(() => {});
  check('isolated item: its cookie lives in its own partition (persistent)', in30(await getCookie(iso, 'sid-a3')));
  check('isolated item: the cookie is not in the shared partition', (await getCookie(shared, 'sid-a3')) === null);
  await waitFor(async () => (await getCookie(shared, 'sid-a4')) !== null, 'sid-a4 set', 8000).catch(() => {});
  await sleepMs(600);
  const c4 = await getCookie(shared, 'sid-a4');
  check('extend-short-logins off: that site\'s session cookie stays a session cookie', c4 && c4.session === true, c4 && { session: c4.session });

  // --- popups and links
  const wcA2 = wcOf('a2');
  const winsBefore = BrowserWindow.getAllWindows().length;
  await wcA2.executeJavaScript("window.open('/popup', 'smokepop', 'width=400,height=300'); 1", true);
  await waitFor(() => BrowserWindow.getAllWindows().length === winsBefore + 1, 'popup window', 6000).catch(() => {});
  check('a sign-in style popup opens as an app window', BrowserWindow.getAllWindows().length === winsBefore + 1);
  await waitFor(() => smoke.requests.some((/** @type {any} */ r) => r.path === '/popup'), 'popup requested', 6000).catch(() => {});
  const popup = BrowserWindow.getAllWindows().find((w) => w !== win);
  check('the popup shares the item\'s session', popup && popup.webContents.session === wcA2.session);
  check('the popup request carries the item\'s UA', smoke.requests.filter((/** @type {any} */ r) => r.path === '/popup').at(-1)?.ua === CUSTOM_UA, smoke.requests.filter((/** @type {any} */ r) => r.path === '/popup').at(-1)?.ua);
  await waitFor(() => popup && !popup.webContents.isLoading(), 'popup loaded', 6000).catch(() => {});
  check('navigator.userAgent inside the popup matches the item\'s preset', popup && (await popup.webContents.executeJavaScript('navigator.userAgent')) === CUSTOM_UA, popup && (await popup.webContents.executeJavaScript('navigator.userAgent')));
  popup?.close();
  await sleepMs(300);
  // a default-preset popup stays exactly as the spike verified it: no override, no debugger
  const winsBeforeDefault = BrowserWindow.getAllWindows().length;
  await wcOf('a1').executeJavaScript("window.open('/popup-default', 'pd', 'width=300,height=300'); 1", true);
  await waitFor(() => BrowserWindow.getAllWindows().length === winsBeforeDefault + 1 && smoke.requests.some((/** @type {any} */ r) => r.path === '/popup-default'), 'default popup', 6000).catch(() => {});
  const defaultPopup = BrowserWindow.getAllWindows().find((w) => w !== win);
  const defaultPopupUa = smoke.requests.filter((/** @type {any} */ r) => r.path === '/popup-default').at(-1)?.ua ?? '';
  check('default preset popup: Electron\'s own UA, no UA override, no debugger attached', Boolean(defaultPopup) && defaultPopupUa.includes('Electron/') && views.popupUserAgent(defaultPopup.webContents.id) === null && defaultPopup.webContents.debugger.isAttached() === false, { ua: defaultPopupUa, attached: defaultPopup?.webContents.debugger.isAttached() });
  check('default preset popup still maps to its item (permissions resolve)', defaultPopup && views.itemIdOfWebContents(defaultPopup.webContents) === 'a1');
  defaultPopup?.close();
  await sleepMs(300);
  await wcA2.executeJavaScript("window.open('file:///C:/Windows/win.ini', 'filepop', 'width=300,height=300'); 1", true);
  await sleepMs(500);
  check('a file: popup opens nothing', BrowserWindow.getAllWindows().length === winsBefore);
  // popup routing (routePopup): a plain target=_blank link to another site goes to the default browser
  const plainUrl = `http://localhost:${smoke.port}/newtab`;
  await wcA2.executeJavaScript(`(() => { const a = document.createElement('a'); a.href = '${plainUrl}'; a.target = '_blank'; document.body.append(a); a.click(); a.remove(); return 1; })()`, true);
  await waitFor(() => smoke.external.includes(plainUrl), 'external link', 4000).catch(() => {});
  check('a plain target=_blank link to another site goes to the default browser (http only)', smoke.external.includes(plainUrl) && BrowserWindow.getAllWindows().length === winsBefore, smoke.external);
  await wcA2.executeJavaScript("window.open('file:///C:/Windows/win.ini', '_blank'); 1", true);
  await sleepMs(400);
  check('a file: new tab is denied: no window, nothing external', BrowserWindow.getAllWindows().length === winsBefore && smoke.external.every((/** @type {string} */ u) => !u.startsWith('file:')));
  // an about:blank window (script-opened sign-in) becomes an app window
  await wcA2.executeJavaScript("window.open('about:blank', 'blankpop', 'width=300,height=300'); 1", true);
  await waitFor(() => BrowserWindow.getAllWindows().length === winsBefore + 1, 'about:blank window', 4000).catch(() => {});
  check('window.open(about:blank) opens an app window', BrowserWindow.getAllWindows().length === winsBefore + 1);
  BrowserWindow.getAllWindows().find((w) => w !== win)?.close();
  await sleepMs(300);
  // a sign-in arriving as a new tab (no popup features) loads in the opener's own pane (same-pane)
  const externalBefore = smoke.external.length;
  const a2Requests = () => smoke.requests.filter((/** @type {any} */ r) => r.path === '/page/a2').length;
  const a2Home = () => waitFor(() => wcOf('a2') && wcOf('a2').getURL().includes('/page/a2') && loaded('a2'), 'a2 back home', 8000).catch(() => {});
  const a2Wc = wcOf('a2');
  await a2Wc.executeJavaScript(`window.open('${smoke.local}/oauth2/authorize?client_id=x&redirect_uri=y', '_blank'); 1`, true);
  await waitFor(() => a2Wc.getURL().includes('/oauth2/authorize'), 'same-pane sign-in', 6000).catch(() => {});
  await sleepMs(300);
  check('a sign-in arriving as a new tab loads in the opener\'s own pane: no window, nothing external', a2Wc.getURL().includes('/oauth2/authorize') && BrowserWindow.getAllWindows().length === winsBefore && smoke.external.length === externalBefore, { url: a2Wc.getURL(), external: smoke.external.slice(externalBefore) });
  check('... in the item\'s own view (same webContents) with its UA', views.entry('a2').view.webContents === a2Wc && smoke.requests.filter((/** @type {any} */ r) => r.path === '/oauth2/authorize').at(-1)?.ua === CUSTOM_UA);
  await br("navigate('a2', 'home')");
  await a2Home();
  // a sign-in popup (with window features) is an app window in the item's partition and UA; closing it reloads a stale opener
  const a2Before = a2Requests();
  await wcOf('a2').executeJavaScript(`window.open('${smoke.local}/oauth2/authorize?client_id=x&redirect_uri=y', 'ssopop', 'width=400,height=300'); 1`, true);
  await waitFor(() => BrowserWindow.getAllWindows().length === winsBefore + 1, 'sso window', 6000).catch(() => {});
  const sso = BrowserWindow.getAllWindows().find((w) => w !== win);
  check('a sign-in window.open with popup features opens an app window, not the default browser', Boolean(sso) && smoke.external.length === externalBefore, smoke.external.slice(externalBefore));
  check('... in the item\'s partition', sso && sso.webContents.session === wcOf('a2').session);
  sso?.close();
  await waitFor(() => a2Requests() > a2Before, 'opener reloaded', 6000).catch(() => {});
  check('closing a sign-in popup reloads an opener that did not move', a2Requests() > a2Before, [a2Requests(), a2Before]);
  await a2Home();
  // an auth URL on another host (not same-site) arriving as a new tab is the same pane too
  await wcOf('a2').executeJavaScript(`window.open('http://localhost:${smoke.port}/oauth2/authorize?client_id=x&redirect_uri=y', '_blank'); 1`, true);
  await waitFor(() => wcOf('a2').getURL().startsWith(`http://localhost:${smoke.port}/oauth2`), 'cross-site same-pane sign-in', 6000).catch(() => {});
  check('an auth-looking URL on another host loads in the same pane too', wcOf('a2').getURL().startsWith(`http://localhost:${smoke.port}/oauth2`) && BrowserWindow.getAllWindows().length === winsBefore && smoke.external.length === externalBefore);
  await br("navigate('a2', 'home')");
  await a2Home();
  check('no non-http address was ever passed to the default browser', smoke.external.every((/** @type {string} */ u) => /^https?:\/\//.test(u)));

  // --- a changed preset applies at the next load, never to the open page
  await br("upsert({items: [{id: 'a2', userAgent: {preset: 'firefox', custom: null}}]})");
  await sleepMs(200);
  check('preset changed while open: the open page keeps its identity', (await wcOf('a2').executeJavaScript('navigator.userAgent')) === CUSTOM_UA);
  const reqsBefore = smoke.requests.filter((/** @type {any} */ r) => r.path === '/page/a2').length;
  await br("navigate('a2', 'reload')");
  await waitFor(() => smoke.requests.filter((/** @type {any} */ r) => r.path === '/page/a2').length > reqsBefore && loaded('a2'), 'a2 reloaded', 8000).catch(() => {});
  const uaAfter = smoke.requests.filter((/** @type {any} */ r) => r.path === '/page/a2').at(-1)?.ua ?? '';
  check('the next reload uses the Firefox identity (request header)', uaAfter.includes('Firefox/'), uaAfter);
  check('... and navigator.userAgent', ((await wcOf('a2')?.executeJavaScript('navigator.userAgent')) ?? '').includes('Firefox/'));
  await br("upsert({items: [{id: 'a2', userAgent: {preset: 'custom', custom: 'FruiterySmokeAgent/1.0'}}]})");

  // --- permissions
  await waitFor(() => loaded('a2'), 'a2 loaded again');
  const notifyOff = await wcOf('a2').executeJavaScript('Notification.requestPermission()', true);
  check('notifications off: the request is denied', notifyOff === 'denied', notifyOff);
  await br("selectWorkspace('ws-b')");
  await br("show('b3')");
  await waitFor(() => loaded('b3'), 'b3 loaded');
  const notifyOn = await wcOf('b3').executeJavaScript('Notification.requestPermission()', true);
  check('notifications on: the request is granted', notifyOn === 'granted', notifyOn);
  const geo = await wcOf('b3').executeJavaScript("navigator.permissions.query({name: 'geolocation'}).then(p => p.state)", true);
  check('geolocation is denied', geo === 'denied', geo);

  // leave a clean layout for the next phases
  await br("selectWorkspace('ws-a')");
  await br("setLayout('ws-a', {type: 'leaf', paneId: 'p1', itemId: 'a1'}, 'p1')");
  await br("setLayout('ws-b', {type: 'leaf', paneId: 'p1', itemId: 'b1'}, 'p1')");
  await waitFor(() => loaded('a1'), 'a1 shown');
  void store;
}

/** The UI (task 5.1). */
export async function phaseUi(/** @type {any} */ ctx) {
  const { smoke, views, store, ui, check, waitFor, shot } = ctx;
  const { br, loaded, layoutOf } = helpers(ctx);
  const text = (/** @type {string} */ sel) => ui(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
  const click = (/** @type {string} */ expr) => ui(`(${expr})?.click()`);
  const buttonByText = (/** @type {string} */ scope, /** @type {string} */ label) => `[...document.querySelectorAll(${JSON.stringify(scope)})].find(b => b.textContent.trim() === ${JSON.stringify(label)} || b.title === ${JSON.stringify(label)})`;

  await br("selectWorkspace('ws-a')");
  await waitFor(() => ui("document.querySelector('#list .list-title')?.textContent === 'Alpha'"), 'list shows Alpha');
  await shot('01-seed-alpha');
  check('rail shows both workspaces', (await ui("document.querySelectorAll('#rail .rail-item').length")) === 2);
  check('the active workspace is marked in the rail', (await ui("document.querySelector('#rail .rail-item.active')?.getAttribute('aria-label')")) === 'Alpha');
  const heads = await ui("[...document.querySelectorAll('#list .section-head')].map(h => h.textContent.replace(/\\s+/g, ' ').trim())");
  check('list: group "Checks" with 0/2 progress, then "Default"', heads.length === 2 && heads[0].includes('Checks') && heads[0].includes('0/2') && heads[1].includes('Default'), heads);
  const names = await ui("[...document.querySelectorAll('#list .row .name')].map(n => n.textContent)");
  check('list: items in order (group first, then the ungrouped ones)', JSON.stringify(names) === JSON.stringify(['Alpha one', 'Alpha five', 'Alpha two', 'Alpha iso', 'Alpha local']), names);
  check('the item shown in the pane is highlighted', (await text('#list .row.active .name')) === 'Alpha one');
  check('Alpha (groups + ungrouped): no list text is "null" or "undefined"', !/\b(null|undefined)\b/.test(await ui("document.getElementById('list').innerText")) && (await ui("[...document.querySelectorAll('#list > *')].every(n => n.textContent.trim() !== 'null')")) === true);

  // workspace switch from the UI: nothing reloads
  const a1 = views.entry('a1');
  const before = { id: a1.wcId, loads: a1.loads, url: a1.view.webContents.getURL() };
  await click("document.querySelectorAll('#rail .rail-item')[1]");
  await waitFor(() => ui("document.querySelector('#list .list-title')?.textContent === 'Beta'"), 'Beta list');
  const noJunk = (/** @type {string} */ t) => !/\b(null|undefined)\b/.test(t);
  check('Beta (no groups): no header for the ungrouped items and no "null" anywhere in the list', (await ui("document.querySelectorAll('#list .section-head').length")) === 0 && noJunk(await ui("document.getElementById('list').innerText")), await ui("document.getElementById('list').innerText"));
  await click("document.querySelectorAll('#rail .rail-item')[0]");
  await waitFor(() => ui("document.querySelector('#list .list-title')?.textContent === 'Alpha'"), 'Alpha list');
  await waitFor(() => views.entry('a1').attached, 'a1 attached');
  const a1b = views.entry('a1');
  check('rail click: Beta then Alpha again, a1 not reloaded', a1b.wcId === before.id && a1b.loads === before.loads && a1b.view.webContents.getURL() === before.url);

  // 2-pane split
  const sp = await br("show('a2', null, {split: {dir: 'row'}})");
  await waitFor(() => loaded('a2') && loaded('a1'), 'two panes loaded');
  check('a 2-pane split is rendered', sp.ok && (await ui("document.querySelectorAll('#panes .pane').length")) === 2);
  await sleepMs(500);
  check('the divider is exactly 4px wide and panes sit beside it', (await ui("(() => { const d = document.querySelector('#panes .divider'); const r = d.getBoundingClientRect(); return Math.round(r.width) === 4; })()")) === true);
  await shot('02-split');
  await click(buttonByText('#panes .pane-head .icon-btn', 'Close pane'));
  await waitFor(async () => (await ui("document.querySelectorAll('#panes .pane').length")) === 1, 'pane closed');
  check('closing one of two panes leaves the other filling the area', Layout.leaves(layoutOf('ws-a')).length === 1);
  await waitFor(() => loaded('a1') || loaded('a2'), 'remaining pane loaded');
  await br("show('a1')");
  await waitFor(() => loaded('a1'), 'a1 shown again');

  // Daily bar (D119): Done and Next only, no prompt, Done moves straight on
  const toastState = () => ui("({show: document.getElementById('toast').classList.contains('show'), text: document.getElementById('toast').textContent})");
  const barButtons = () => ui("[...document.querySelectorAll('#panes .daily-bar button')].map(b => b.textContent)");
  smoke.dialogCalls.length = 0;
  check('Daily bar shows Done and Next for a scheduled item: no List button', JSON.stringify(await barButtons()) === JSON.stringify(['Done', 'Next']), await barButtons());
  // Next does not tick and never asks
  await click(buttonByText('#panes .daily-bar button', 'Next'));
  await waitFor(() => layoutOf('ws-a').itemId === 'a5', 'next item a5', 6000).catch(() => {});
  check('Next on an unticked check-in opens the next due item, ticks nothing and asks nothing', layoutOf('ws-a').itemId === 'a5' && !store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === 'a1') && smoke.dialogCalls.length === 0, layoutOf('ws-a'));
  await shot('03-next-a5');
  // Done ticks and moves on in the same pane
  await br("show('a1')");
  await waitFor(() => ui("document.querySelector('#panes .pane-titlebar')?.title.startsWith('Alpha one') === true && [...document.querySelectorAll('#panes .daily-bar button')].some(b => b.textContent === 'Done')"), 'a1 bar');
  await click(buttonByText('#panes .daily-bar button', 'Done'));
  await waitFor(() => layoutOf('ws-a').itemId === 'a5', 'Done moves on to a5', 6000).catch(() => {});
  check('Done ticks the item and the next due item (a5) opens in the same pane, with no prompt', store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === 'a1') && layoutOf('ws-a').itemId === 'a5' && smoke.dialogCalls.length === 0 && Layout.leaves(layoutOf('ws-a')).length === 1, layoutOf('ws-a'));
  check('the group progress becomes 1/2', (await ui("document.querySelector('#list .section-head .progress')?.textContent")) === '1/2');
  // Next with nothing else due
  await waitFor(() => ui("document.querySelector('#panes .pane-titlebar')?.title.startsWith('Alpha five') === true"), 'a5 shown');
  await click(buttonByText('#panes .daily-bar button', 'Next'));
  await waitFor(async () => (await toastState()).text === 'No more due items', 'no-more toast', 4000).catch(() => {});
  check('Next with no other due item says "No more due items" and changes nothing', (await toastState()).text === 'No more due items' && layoutOf('ws-a').itemId === 'a5' && !store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === 'a5'), await toastState());
  const callsNow = smoke.dialogCalls.length;
  ctx.win.webContents.send('fruitery:shortcut', { type: 'workspace', index: 1 });
  await waitFor(() => store.device().activeWorkspaceId === 'ws-b', 'workspace switch', 4000).catch(() => {});
  ctx.win.webContents.send('fruitery:shortcut', { type: 'workspace', index: 0 });
  await waitFor(() => store.device().activeWorkspaceId === 'ws-a', 'workspace switch back', 4000).catch(() => {});
  await waitFor(() => ui("document.querySelector('#list .list-title')?.textContent === 'Alpha'"), 'UI shows Alpha again', 4000).catch(() => {});
  check('switching workspace with an unticked check-in shown never prompts', smoke.dialogCalls.length === callsNow && !store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === 'a5'));
  // Ctrl+Tab cycles the items of the workspace without a prompt
  ctx.win.webContents.send('fruitery:shortcut', { type: 'item', delta: 1 });
  await waitFor(() => layoutOf('ws-a').itemId !== 'a5', 'Ctrl+Tab', 4000).catch(() => {});
  check('Ctrl+Tab shows the next item (no prompt)', layoutOf('ws-a').itemId === 'a2' && smoke.dialogCalls.length === callsNow, layoutOf('ws-a'));
  await br("show('a5')");
  await waitFor(() => ui("document.querySelector('#panes .pane-titlebar')?.title.startsWith('Alpha five') === true && [...document.querySelectorAll('#panes .daily-bar button')].some(b => b.textContent === 'Done')"), 'a5 bar');
  // Done on the last due item: ticked, "Basket full" toast, stays
  await click(buttonByText('#panes .daily-bar button', 'Done'));
  await waitFor(() => ui("document.querySelector('#list .basket')?.textContent ?? ''").then((t) => t.includes('Basket full')), 'Basket full', 6000).catch(() => {});
  check('Done on the last due item ticks it, says "Basket full 🧺" and stays on it', store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === 'a5') && (await toastState()).text === 'Basket full 🧺' && layoutOf('ws-a').itemId === 'a5', await toastState());
  check('all due items done: the list shows "Basket full 🧺"', (await text('#list .basket')) === 'Basket full 🧺', await text('#list .basket'));
  await shot('04-basket-full');
  // Undo
  await click(buttonByText('#panes .daily-bar button', 'Undo'));
  await waitFor(() => !store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === 'a5'), 'Undo', 4000).catch(() => {});
  check('Undo removes the tick', !store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === 'a5'));
  await waitFor(() => ui("[...document.querySelectorAll('#panes .daily-bar button')].some(b => b.textContent === 'Done')"), 'Done back');
  await click(buttonByText('#panes .daily-bar button', 'Done'));
  await waitFor(() => store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === 'a5'), 'a5 done again', 4000).catch(() => {});
  check('a5 is ticked again for the restart check (a1 and a5 are done)', ['a1', 'a5'].every((id) => store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === id)));
  // Not due section
  const startDate = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
  const up = await br(`upsert({items: [{id: 'f1', workspaceId: 'ws-a', name: 'Future check', kind: 'web', url: '${smoke.local}/page/f1', schedule: {type: 'everyNDays', n: 2, startDate: '${startDate}'}}]})`);
  check('upsert a not-yet-started schedule', up.ok, up);
  await waitFor(() => ui("document.querySelector('#list details.not-due summary')?.textContent === 'Not due (1)'"), 'Not due section');
  await click("document.querySelector('#list details.not-due summary')");
  check('Not due lists the item with its next date', (await ui("document.querySelector('#list details.not-due .next')?.textContent")) === `next ${startDate}`);
  await br("remove('item', 'f1')");

  // 8.2 the draggable border between the list and the panes
  await br("selectWorkspace('ws-a')");
  await br("show('a1')");
  await waitFor(() => loaded('a1'), 'a1 shown for the list divider');
  const railRight = await ui("document.getElementById('rail').getBoundingClientRect().right");
  const winW = await ui('innerWidth');
  const fire = (/** @type {string} */ type, /** @type {string} */ target, /** @type {number} */ x) =>
    ui(`${target}.dispatchEvent(new PointerEvent('${type}', {bubbles: true, clientX: ${x}, clientY: 300, button: 0, buttons: ${type === 'pointerup' || type === 'dblclick' ? 0 : 1}, pointerId: 1}))`);
  const divider = "document.getElementById('list-divider')";
  const listCssWidth = () => ui("Math.round(document.getElementById('list').getBoundingClientRect().width)");
  const bodyLeft = () => ui("Math.round(document.querySelector('#panes .pane-body').getBoundingClientRect().left)");
  /** Drag the divider to client x and release. */
  const dragTo = async (/** @type {number} */ x) => {
    await fire('pointerdown', divider, railRight + 270);
    await waitFor(() => views.isOverlay(), 'overlay on during the divider drag', 3000);
    await fire('pointermove', 'window', x);
    return async () => { await fire('pointerup', 'window', x); await waitFor(() => !views.isOverlay(), 'overlay off after the divider drag', 4000); };
  };
  check('the list starts at the default width (270)', (await listCssWidth()) === 270 && store.device().listWidth === 270, [await listCssWidth(), store.device().listWidth]);
  const release = await dragTo(railRight + 400);
  await waitFor(async () => (await listCssWidth()) === 400, 'list resized live', 3000).catch(() => {});
  check('dragging the divider: the list follows live', (await listCssWidth()) === 400, { css: await listCssWidth(), railRight, winW, stored: store.device().listWidth, var: await ui("document.documentElement.style.getPropertyValue('--list-width')") });
  const liveLeft = await bodyLeft();
  await waitFor(() => views.rects().some((/** @type {any} */ r) => r.itemId === 'a1' && Math.abs(r.x - liveLeft) <= 1), 'rects follow live', 3000).catch(() => {});
  check('... the pane rects are recomputed live while the views are off the window (overlay)', views.isOverlay() && views.rects().some((/** @type {any} */ r) => r.itemId === 'a1' && Math.abs(r.x - liveLeft) <= 1), views.rects());
  check('the storage is untouched until release', store.device().listWidth === 270);
  await release();
  check('on release the width is stored per PC (device.json)', store.device().listWidth === 400, store.device().listWidth);
  await waitFor(() => Math.abs((views.entry('a1').bounds?.x ?? -9) - liveLeft) <= 1, 'view re-attached at the new box', 3000).catch(() => {});
  check('on release the native view sits in the new pane box', views.entry('a1').attached && Math.abs((views.entry('a1').bounds?.x ?? -9) - liveLeft) <= 1, views.entry('a1').bounds);
  const rel2 = await dragTo(5);
  await rel2();
  check('dragged far left: clamped to 180', store.device().listWidth === 180 && (await listCssWidth()) === 180, store.device().listWidth);
  check('at the minimum list width the workspace title has the full width and the add buttons sit in the bottom bar inside the list, not over the title', (await ui(`(() => {
    const l = document.getElementById('list').getBoundingClientRect();
    const t = document.querySelector('#list .list-title').getBoundingClientRect();
    const b = [...document.querySelectorAll('#list .list-foot button')].map((x) => x.getBoundingClientRect());
    return t.width >= l.width - 24 && b.length === 2 && b.every((r) => r.right <= l.right && r.left >= l.left) && b.every((r) => r.top >= t.bottom);
  })()`)) === true);
  const rel3 = await dragTo(winW + 3000);
  await rel3();
  const maxWanted = Math.max(180, Math.min(600, winW - railRight - 320));
  check('dragged far right: clamped to 600 and the pane area keeps 320 px', store.device().listWidth === maxWanted && winW - railRight - (await listCssWidth()) >= 320, [store.device().listWidth, maxWanted]);
  await fire('dblclick', divider, railRight + 100);
  await waitFor(() => store.device().listWidth === 270, 'reset by double-click', 3000).catch(() => {});
  await waitFor(async () => (await listCssWidth()) === 270, 'list back to 270', 3000).catch(() => {});
  check('double-click resets the width to the default', store.device().listWidth === 270 && (await listCssWidth()) === 270, [store.device().listWidth, await listCssWidth()]);
  const keep = await dragTo(railRight + 333);
  await keep();
  check('the width left for the restart check is 333', store.device().listWidth === 333);
  await shot('09-list-width');
  void views;
}

/**
 * desktop-polish: icons, the pane title bar and address field, shortcuts, page actions and the page
 * menu, the tick circle and the return toast. Leaves the state as it found it (workspace Alpha, a1 in a
 * single pane, no extra live items).
 */
export async function phasePolish(/** @type {any} */ ctx) {
  const { smoke, views, store, ui, check, waitFor, win, api, shot } = ctx;
  const { br, wcOf, loaded, layoutOf } = helpers(ctx);
  const toastState = () => ui("({show: document.getElementById('toast').classList.contains('show'), text: document.getElementById('toast').textContent})");
  const reqCount = (/** @type {string} */ p) => smoke.requests.filter((/** @type {any} */ r) => r.path === p).length;
  const iconFile = (/** @type {string} */ id) => path.join(dataDir, 'icons', `${id}.png`);
  const pngWidth = (/** @type {string} */ file) => fs.readFileSync(file).readUInt32BE(16);
  const rev = async (/** @type {string} */ id) => ((await br('getState()')).iconRevs[id] ?? 0);
  const key = (/** @type {any} */ wc, /** @type {string} */ keyCode, /** @type {string[]} */ modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  const urlOf = (/** @type {string} */ id) => wcOf(id).getURL();
  const urlIs = (/** @type {string} */ id, /** @type {string} */ u) => waitFor(() => urlOf(id) === u && !wcOf(id).isLoading(), `${id} at ${u}`, 8000).then(() => true, () => false);
  const dialogOpen = () => ui("document.getElementById('dialog').open");
  const cancelDialog = async () => {
    await ui("document.querySelector('#dialog .form-actions button')?.click()");
    await waitFor(async () => !(await dialogOpen()), 'dialog cancelled', 4000);
    await waitFor(() => !views.isOverlay(), 'overlay released', 4000);
  };
  /** One pane showing a1: a plain layout change, then wait until the UI shows exactly one pane. */
  const resetSingle = async () => {
    await br("setLayout('ws-a', {type: 'leaf', paneId: 'p1', itemId: 'a1'}, 'p1')");
    await waitFor(async () => Layout.leaves(layoutOf('ws-a')).length === 1 && (await ui("document.querySelectorAll('#panes .pane').length")) === 1, 'one pane');
  };

  await br("selectWorkspace('ws-a')");
  await resetSingle();
  await waitFor(() => loaded('a1'), 'a1 shown');
  await waitFor(() => ui("document.querySelector('#list .list-title')?.textContent === 'Alpha'"), 'Alpha list');

  // ------------------------------------------------------------------ D131: a focus change never undoes a layout change
  // Main splits (show with a split), and before the UI has even been sent the new layout a site view gains focus.
  // The app used to answer that with its own, older, copy of the tree and undo the split.
  const splitRes = await br("show('a2', null, {split: {dir: 'row'}})");
  const a1Wc = wcOf('a1');
  a1Wc.emit('focus');
  await sleepMs(800);
  const paneA1 = Layout.findItem(layoutOf('ws-a'), 'a1')?.paneId;
  check('D131: a split made by main survives a site view gaining focus right after it (store)', splitRes.ok === true && Layout.leaves(layoutOf('ws-a')).length === 2 && Boolean(Layout.findItem(layoutOf('ws-a'), 'a2')), layoutOf('ws-a'));
  check('D131: the UI shows both panes too', (await ui("document.querySelectorAll('#panes .pane').length")) === 2);
  check('D131: the pane of the focused site is the focused one (set by main)', Boolean(paneA1) && store.device().focusedPaneByWorkspace['ws-a'] === paneA1, store.device().focusedPaneByWorkspace);
  const stale = await br("focusPane('ws-a', 'no-such-pane')");
  check('D131: focusPane with an unknown pane changes nothing', stale.error === 'pane-not-found' && Layout.leaves(layoutOf('ws-a')).length === 2 && store.device().focusedPaneByWorkspace['ws-a'] === paneA1, stale);
  const paneA2 = Layout.findItem(layoutOf('ws-a'), 'a2')?.paneId;
  await ui(`document.querySelector('#panes .pane-body[data-pane="${paneA2}"]')?.closest('.pane')?.querySelector('.pane-head')?.click()`);
  await waitFor(() => store.device().focusedPaneByWorkspace['ws-a'] === paneA2, 'clicking a pane header focuses it', 4000).catch(() => {});
  check('D131: clicking a pane header focuses it through focusPane, the layout untouched', store.device().focusedPaneByWorkspace['ws-a'] === paneA2 && Layout.leaves(layoutOf('ws-a')).length === 2, store.device().focusedPaneByWorkspace);
  // the other direction, the one that used to bite: the app shows two panes with the second focused; main collapses
  // them to one pane (a layout change from elsewhere) and a site view gains focus before the app has seen the new
  // layout. The app used to answer by saving its old two-pane tree, which brought the split back.
  await waitFor(async () => (await ui("document.querySelectorAll('#panes .pane').length")) === 2 && loaded('a2'), 'two panes shown and settled');
  await api.handlers.setLayout('ws-a', { type: 'leaf', paneId: 'p1', itemId: 'a1' }, 'p1');
  a1Wc.emit('focus');
  await sleepMs(800);
  check('D131: a layout change by main is not undone by the focus of a site view (store)', Layout.leaves(layoutOf('ws-a')).length === 1 && Layout.findItem(layoutOf('ws-a'), 'a1')?.paneId === 'p1', layoutOf('ws-a'));
  check('D131: and the UI shows the single pane', (await ui("document.querySelectorAll('#panes .pane').length")) === 1);
  await resetSingle();
  await waitFor(() => loaded('a1'), 'a1 shown after the D131 check');
  const a1Url = `${smoke.local}/page/a1`;
  const typedUrl = `${smoke.local}/page/typed`;
  const savedUrl = () => store.snapshot().items.find((/** @type {any} */ i) => i.id === 'a1').url;

  // ------------------------------------------------------------------ icons (D116)
  await waitFor(async () => (await rev('a1')) > 0, 'a1 icon captured', 10000).catch(() => {});
  check('icon captured when the item\'s own site loaded: saved as a 32 px PNG in data\\icons', (await rev('a1')) > 0 && fs.existsSync(iconFile('a1')) && pngWidth(iconFile('a1')) === 32, await rev('a1'));
  await waitFor(async () => (await rev('a2')) > 0, 'a2 icon captured', 10000).catch(() => {});
  check('a bitmap favicon.ico (not a PNG inside) is decoded as well', (await rev('a2')) > 0 && fs.existsSync(iconFile('a2')) && pngWidth(iconFile('a2')) === 32, await rev('a2'));
  check('getIcon returns the cached icon as a PNG data URL', String(await br("getIcon('a1')")).startsWith('data:image/png;base64,') && (await br("getIcon('b3-none')")) === null);
  await waitFor(() => ui("!!document.querySelector('#list .row[data-edit-id=\"a1\"] .icon img')"), 'icon drawn in the list', 5000).catch(() => {});
  check('the list shows the site icon for an item without a typed icon', (await ui("document.querySelector('#list .row[data-edit-id=\"a1\"] .icon img')?.src.startsWith('data:image/png') ?? false")) === true);
  await shot('10-icons');
  await br("upsert({items: [{id: 'a1', icon: '🍎'}]})");
  await waitFor(() => ui("document.querySelector('#list .row[data-edit-id=\"a1\"] .icon')?.textContent === '🍎'"), 'typed icon shown', 4000).catch(() => {});
  check('a typed emoji wins over the site icon', (await ui("document.querySelector('#list .row[data-edit-id=\"a1\"] .icon')?.textContent")) === '🍎' && (await ui("!document.querySelector('#list .row[data-edit-id=\"a1\"] .icon img')")) === true);
  await br("upsert({items: [{id: 'a1', icon: null}]})");
  await waitFor(() => ui("!!document.querySelector('#list .row[data-edit-id=\"a1\"] .icon img')"), 'site icon back', 4000).catch(() => {});

  const made = await br(`upsert({items: [{workspaceId: 'ws-a', name: 'Polish refresh', kind: 'web', url: '${smoke.local}/page/p3'}, {workspaceId: 'ws-a', name: 'Polish dead', kind: 'web', url: 'http://127.0.0.1:1/'}]})`);
  const [pRefresh, pDead] = made.ids.items;
  check('before "Refresh icon" an item that was never opened has no icon', (await rev(pRefresh)) === 0);
  const rr = await br(`refreshIcon('${pRefresh}')`);
  check('Refresh icon: an item never opened gets its icon from the front page\'s <link rel=icon> (one-off fetch)', rr.ok === true && rr.found === true && fs.existsSync(iconFile(pRefresh)) && pngWidth(iconFile(pRefresh)) === 32 && (await rev(pRefresh)) > 0, rr);
  const rd = await br(`refreshIcon('${pDead}')`);
  check('Refresh icon on an unreachable site finds nothing, leaves no icon and does not throw', rd.ok === true && rd.found === false && !fs.existsSync(iconFile(pDead)), rd);
  check('Refresh icon for an unknown item is refused', (await br("refreshIcon('no-such-item')")).ok === false);
  await waitFor(() => ui(`!!document.querySelector('#list .row[data-edit-id="${pDead}"]')`), 'the new item is listed', 5000);
  ctx.api.sendCommand({ type: 'edit-item', itemId: pDead });
  await waitFor(dialogOpen, 'item editor for Refresh icon');
  await ui("document.getElementById('f-icon').closest('.field').querySelector('button').click()");
  await waitFor(() => ui("document.getElementById('f-icon').closest('.field').querySelector('.action-result').textContent === 'No icon found for this site.'"), 'refresh result in the editor', 8000).catch(() => {});
  check('the editor\'s "Refresh icon" button reports "No icon found for this site." when there is none', (await ui("document.getElementById('f-icon').closest('.field').querySelector('.action-result').textContent")) === 'No icon found for this site.');
  await cancelDialog();
  ctx.api.sendCommand({ type: 'edit-item', itemId: pRefresh });
  await waitFor(dialogOpen, 'item editor for Refresh icon (found)');
  await ui("document.getElementById('f-icon').closest('.field').querySelector('button').click()");
  await waitFor(() => ui("document.getElementById('f-icon').closest('.field').querySelector('.action-result').textContent === 'Icon updated.'"), 'refresh result found', 8000).catch(() => {});
  check('... and "Icon updated." when it found one', (await ui("document.getElementById('f-icon').closest('.field').querySelector('.action-result').textContent")) === 'Icon updated.');
  await cancelDialog();
  await ui("document.querySelector('#list .list-foot button[title=\"Add item\"]').click()");
  await waitFor(dialogOpen, 'add item dialog');
  check('while adding a new item "Refresh icon" is unavailable', (await ui("document.getElementById('f-icon').closest('.field').querySelector('button').disabled")) === true);
  await cancelDialog();
  // a pane that has no loaded page has no address: the copy and Edge actions say so and do nothing
  smoke.clipboardWrites.length = 0;
  smoke.spawned.length = 0;
  const noCopy = await br(`copyAddress('${pRefresh}')`);
  const noEdge = await br(`openPageInEdge('${pRefresh}')`);
  check('copy and "open this page in Edge" with no loaded page answer "no address" and do nothing', noCopy.ok === false && noCopy.error === 'no-address' && noEdge.ok === false && noEdge.error === 'no-address' && smoke.clipboardWrites.length === 0 && smoke.spawned.length === 0, { noCopy, noEdge });
  await br(`remove('item', '${pRefresh}')`);
  await br(`remove('item', '${pDead}')`);
  check('deleting an item removes its icon file', !fs.existsSync(iconFile(pRefresh)));

  // ------------------------------------------------------------------ pane title bar
  const titleBar = "document.querySelector('#panes .pane.focused .pane-titlebar')";
  const addr = "document.querySelector('#panes .addr-input')";
  const clickTitle = (/** @type {number} */ n) => ui(`(() => { const t = ${titleBar}; for (let i = 0; i < ${n}; i++) t.click(); })()`);
  const setAddr = (/** @type {string} */ text) => ui(`(() => { const i = ${addr}; i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', {bubbles: true})); })()`);
  const pressInField = (/** @type {string} */ k) => ui(`${addr}.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(k)}, bubbles: true, cancelable: true}))`);
  const hasField = () => ui(`!!${addr}`);
  const openField = async () => {
    await clickTitle(2);
    await waitFor(hasField, 'address field', 3000);
  };

  check('the pane title shows the page title (not the item name)', (await ui("document.querySelector('#panes .pane-title')?.textContent")) === '(3) Alpha one', await ui("document.querySelector('#panes .pane-title')?.textContent"));
  smoke.clipboardWrites.length = 0;
  await clickTitle(1);
  await waitFor(() => smoke.clipboardWrites.length > 0, 'copy on single click', 3000).catch(() => {});
  const copied = await toastState();
  check('one click on the pane title copies the page address and shows it in a toast', smoke.clipboardWrites.length === 1 && smoke.clipboardWrites[0] === a1Url && copied.show && copied.text === a1Url, { writes: smoke.clipboardWrites, copied });
  check('the toast sits beside the item list, not over the pane area (native views would hide it)', (await ui(`(() => { const t = document.getElementById('toast').getBoundingClientRect(); const l = document.getElementById('list').getBoundingClientRect(); return t.left >= l.left && t.right <= l.right && t.width > 0; })()`)) === true);
  await waitFor(async () => !(await toastState()).show, 'copy toast fades', 3000).catch(() => {});
  check('... and fades after about a second', !(await toastState()).show);

  smoke.clipboardWrites.length = 0;
  await openField();
  await sleepMs(500);
  const field = await ui(`(() => { const i = ${addr}; return {value: i.value, all: i.selectionStart === 0 && i.selectionEnd === i.value.length, focused: document.activeElement === i}; })()`);
  check('a double click shows an address field with the current address selected, and does not copy', field.value === a1Url && field.all && field.focused && smoke.clipboardWrites.length === 0, field);

  const revBefore = await rev('a1');
  await setAddr(typedUrl);
  await pressInField('Enter');
  check('Enter loads the typed address in the same pane (same session, default identity)', await urlIs('a1', typedUrl));
  check('... the field closes and the saved address of the item is unchanged', !(await hasField()) && savedUrl() === a1Url, savedUrl());
  check('... with the item\'s own browser identity', (smoke.requests.filter((/** @type {any} */ r) => r.path === '/page/typed').at(-1)?.ua ?? '').includes('Electron/'));
  await waitFor(async () => (await rev('a1')) > revBefore, 'own-site page offers a new icon', 6000).catch(() => {});
  check('a page of the item\'s own site may refresh its icon', (await rev('a1')) > revBefore, [revBefore, await rev('a1')]);

  await openField();
  await setAddr('javascript:alert(1)');
  await pressInField('Enter');
  await waitFor(() => ui("!!document.querySelector('#panes .addr-error')"), 'error shown', 3000).catch(() => {});
  check('a non-web address keeps the field open with an error and loads nothing', (await hasField()) && /http/.test(await ui("document.querySelector('#panes .addr-error')?.textContent ?? ''")) && urlOf('a1') === typedUrl, await ui("document.querySelector('#panes .addr-error')?.textContent ?? ''"));
  check('... and what was typed is still there', (await ui(`${addr}?.value`)) === 'javascript:alert(1)');
  await pressInField('Escape');
  await waitFor(async () => !(await hasField()), 'field closed by Escape', 3000).catch(() => {});
  check('Escape returns to the title without navigating', !(await hasField()) && urlOf('a1') === typedUrl);

  await openField();
  await setAddr('half typed');
  await wcOf('a1').executeJavaScript("document.title = 'changed title'; 1");
  await waitFor(async () => (await br('getState()')).viewStates.a1.title === 'changed title', 'title update arrives', 4000).catch(() => {});
  await sleepMs(300);
  check('a page changing its title while typing does not disturb the field (text and focus kept)', (await ui(`(() => { const i = ${addr}; return !!i && i.value === 'half typed' && document.activeElement === i; })()`)) === true);
  const w0 = store.device().listWidth;
  await br(`saveDevice({listWidth: ${w0 === 300 ? 310 : 300}})`);
  await waitFor(() => ui("Math.round(document.getElementById('list').getBoundingClientRect().width) !== " + w0), 'list resized', 3000).catch(() => {});
  await sleepMs(300);
  check('a rebuild of the panes (the list width changed) keeps the typed text and the focus', (await ui(`(() => { const i = ${addr}; return !!i && i.value === 'half typed' && document.activeElement === i; })()`)) === true);
  await br(`saveDevice({listWidth: ${w0}})`);
  await sleepMs(200);
  // blur events are only dispatched in a focused document
  win.focus();
  win.webContents.focus();
  await waitFor(() => ui('document.hasFocus()'), 'the app UI has focus', 3000).catch(() => {});
  await ui(`${addr}?.blur()`);
  await waitFor(async () => !(await hasField()), 'blur closes the field', 3000).catch(() => {});
  check('leaving the field returns to the title', !(await hasField()) && urlOf('a1') === typedUrl);
  await wcOf('a1').executeJavaScript("document.title = 'typed'; 1");

  // other host typed into the field: the item's icon is not replaced
  const revOther = await rev('a1');
  await openField();
  await setAddr(`http://localhost:${smoke.port}/page/otherhost`);
  await pressInField('Enter');
  check('another site can be opened in the same pane', await urlIs('a1', `http://localhost:${smoke.port}/page/otherhost`));
  await sleepMs(1500);
  check('... but its icon never replaces the item\'s own (only the item\'s own site may)', (await rev('a1')) === revOther, [revOther, await rev('a1')]);
  await openField();
  await setAddr(typedUrl);
  await pressInField('Enter');
  await urlIs('a1', typedUrl);

  // ------------------------------------------------------------------ header buttons (at the typed page, not the saved address)
  smoke.clipboardWrites.length = 0;
  await ui("[...document.querySelectorAll('#panes .pane-head .icon-btn')].find((b) => b.title === 'Copy address').click()");
  await waitFor(() => smoke.clipboardWrites.length > 0, 'copy button', 3000).catch(() => {});
  check('the "Copy address" button copies the page\'s current address (not the saved one)', smoke.clipboardWrites[0] === typedUrl, smoke.clipboardWrites);
  smoke.spawned.length = 0;
  await br("saveDevice({edgeProfile: 'Profile 7'})");
  await ui("[...document.querySelectorAll('#panes .pane-head .icon-btn')].find((b) => b.title === 'Open this page in Edge').click()");
  await waitFor(() => smoke.spawned.length > 0, 'edge button', 3000).catch(() => {});
  check('"Open this page in Edge" opens the current page with this PC\'s profile, without a shell', smoke.spawned.length === 1 && JSON.stringify(smoke.spawned[0].args) === JSON.stringify(['--profile-directory=Profile 7', typedUrl]) && smoke.spawned[0].options.shell === false, smoke.spawned[0]);
  check('... and the pane stays where it was', urlOf('a1') === typedUrl && Layout.leaves(layoutOf('ws-a')).length === 1);
  await br("upsert({items: [{id: 'a1', edge: {mode: 'never', profile: 'Item P'}}]})");
  smoke.spawned.length = 0;
  await ui("[...document.querySelectorAll('#panes .pane-head .icon-btn')].find((b) => b.title === 'Open this page in Edge').click()");
  await waitFor(() => smoke.spawned.length > 0, 'edge button (item profile)', 3000).catch(() => {});
  check('... the item\'s own profile beats this PC\'s', smoke.spawned[0]?.args[0] === '--profile-directory=Item P', smoke.spawned[0]);
  await br("upsert({items: [{id: 'a1', edge: {mode: 'inherit', profile: null}}]})");
  await br('saveDevice({edgeProfile: null})');
  check('the pane header buttons carry their keys in the tooltips', JSON.stringify(await ui("[...document.querySelectorAll('#panes .pane-head .icon-btn')].map((b) => b.title).filter((t) => /\\(/.test(t))")) === JSON.stringify(['Back (Alt+Left)', 'Reload (F5)', 'Home page (F6)']));

  // ------------------------------------------------------------------ shortcuts: F5, F6, Alt+arrows, mouse side buttons
  const wc1 = wcOf('a1');
  wc1.focus();
  await br("saveDevice({edgeProfile: null})");
  const before5 = reqCount('/page/typed');
  key(wc1, 'F5');
  await waitFor(() => reqCount('/page/typed') > before5, 'F5 reload', 5000).catch(() => {});
  await sleepMs(400);
  check('F5 inside a site reloads that page (one request)', reqCount('/page/typed') === before5 + 1, [before5, reqCount('/page/typed')]);
  key(wc1, 'F6');
  check('F6 inside a site loads the item\'s saved address in the same pane', await urlIs('a1', a1Url));
  key(wc1, 'Left', ['alt']);
  check('Alt+Left goes back exactly one step', await urlIs('a1', typedUrl), urlOf('a1'));
  await sleepMs(300);
  key(wc1, 'Right', ['alt']);
  check('Alt+Right goes forward exactly one step', await urlIs('a1', a1Url), urlOf('a1'));
  const beforeUi = reqCount('/page/a1');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F5' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F5' });
  await waitFor(() => reqCount('/page/a1') > beforeUi, 'F5 from the app UI', 5000).catch(() => {});
  await sleepMs(400);
  check('F5 pressed in the app itself reloads the focused pane\'s page (and not the app)', reqCount('/page/a1') === beforeUi + 1 && (await ui('window.__fruiteryUiReady === true')) === true, [beforeUi, reqCount('/page/a1')]);
  win.emit('app-command', {}, 'browser-backward');
  check('the mouse back button / browser Back key (app-command) goes back one step in the focused pane', await urlIs('a1', typedUrl), urlOf('a1'));
  await sleepMs(300);
  win.emit('app-command', {}, 'browser-forward');
  check('the mouse forward button / browser Forward key goes forward one step', await urlIs('a1', a1Url), urlOf('a1'));
  win.emit('app-command', {}, 'browser-refresh');
  await sleepMs(300);
  check('other app commands are ignored', urlOf('a1') === a1Url);
  await ctx.api.handlers.contextMenu('item', 'a1');
  const itemMenu = smoke.menus.at(-1) ?? [];
  const editEntry = itemMenu.find((/** @type {any} */ e) => e.label === 'Edit…');
  check('the right-click menu of a list item shows F3 beside "Edit…" (display only)', editEntry?.accelerator === 'F3' && editEntry?.registerAccelerator === false, editEntry);
  check('the item menu offers "Pin to strip" when nothing is pinned', itemMenu.some((/** @type {any} */ e) => e.label === 'Pin to strip'));

  // ------------------------------------------------------------------ pinned-item strip (e.g. a time-tracking site)
  const pinRes = await br("setPin({itemId: 'a1'})");
  check('setPin accepts a live item', pinRes.ok === true && store.device().pinnedItemId === 'a1');
  check('setPin refuses an unknown item', (await br("setPin({itemId: 'no-such'})")).ok === false && store.device().pinnedItemId === 'a1');
  await waitFor(() => ui("!document.getElementById('pin-strip').hidden && !!document.querySelector('#pin-strip .pin-body[data-pane=\"__pin\"]')"), 'pin strip body shown', 4000).catch(() => {});
  check('the pin strip appears with a body once an item is pinned', (await ui("!document.getElementById('pin-strip').hidden")) === true);
  // the pinned item's view is attached and awake (a rect was reported and the view manager woke it)
  await waitFor(() => br("getState()").then((/** @type {any} */ s) => s.viewStates?.a1?.awake === true), 'pinned view awake', 5000).catch(() => {});
  check('the pinned item\'s view wakes in the strip', (await br('getState()')).viewStates?.a1?.awake === true);
  // collapse: the body goes away but the view is kept alive (still awake)
  await br('setPin({collapsed: true})');
  await waitFor(() => ui("document.getElementById('pin-strip').classList.contains('collapsed') && !document.querySelector('#pin-strip .pin-body')"), 'pin strip collapsed', 4000).catch(() => {});
  check('collapsing hides the body but keeps the item pinned and its view alive', store.device().pinnedCollapsed === true && (await br('getState()')).viewStates?.a1?.awake === true);
  // a pinned, collapsed item is never slept by the timer
  const slept = await ctx.views.sleepTick(Date.now() + 100000000);
  check('the pinned item is never unloaded by the sleep timer', !slept.includes('a1') && (await br('getState()')).viewStates?.a1?.awake === true, slept);
  // unpin via the menu entry
  await ctx.api.handlers.contextMenu('item', 'a1');
  const pinnedMenu = smoke.menus.at(-1) ?? [];
  check('the item menu offers "Unpin from strip" while pinned', pinnedMenu.some((/** @type {any} */ e) => e.label === 'Unpin from strip'));
  await br("setPin({itemId: null})");
  await waitFor(() => ui("document.getElementById('pin-strip').hidden"), 'pin strip hidden after unpin', 4000).catch(() => {});
  check('unpinning hides the strip', store.device().pinnedItemId === null && (await ui("document.getElementById('pin-strip').hidden")) === true);
  await br('setPin({collapsed: false})');

  // ------------------------------------------------------------------ disk cache cap + clear web cache
  check('the disk-cache cap is a device setting with the default', store.device().diskCacheMB === 200);
  check('saveDevice clamps the disk-cache cap to the safe range', (await br('saveDevice({diskCacheMB: 5})')).ok === true && store.device().diskCacheMB === 50 && (await br('saveDevice({diskCacheMB: 150})')).ok === true && store.device().diskCacheMB === 150);
  const cleared = await br('clearWebCache()');
  check('clearWebCache clears the live site sessions and keeps logins (cookies untouched)', cleared.ok === true && typeof cleared.cleared === 'number' && cleared.cleared >= 1, cleared);

  // ------------------------------------------------------------------ the page's right-click menu
  // A right click is only turned into a context menu when the page has a presented frame to hit-test; right after a
  // navigation or a layout change the first click can be dropped. So: a renderer round trip (one animation frame), a
  // mouse move, the click, and one retry. Points are kept inside the view's own size.
  const rightClick = async (/** @type {any} */ wc, /** @type {number} */ x, /** @type {number} */ y) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      smoke.menus.length = 0;
      const [w, h] = await wc.executeJavaScript('new Promise((r) => requestAnimationFrame(() => r([innerWidth, innerHeight])))');
      const px = Math.max(1, Math.min(x, w - 5));
      const py = Math.max(1, Math.min(y, h - 5));
      wc.sendInputEvent({ type: 'mouseMove', x: px, y: py });
      wc.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'right', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'right', clickCount: 1 });
      await waitFor(() => smoke.menus.length > 0, 'page menu', 2500).catch(() => {});
      if (smoke.menus.length > 0) break;
    }
    return smoke.menus.at(-1) ?? [];
  };  const labels = (/** @type {any[]} */ t) => t.filter((e) => e.label).map((e) => e.label);
  const entry = (/** @type {any[]} */ t, /** @type {string} */ label) => t.find((e) => e.label === label);
  const rectOf = async (/** @type {any} */ wc, /** @type {string} */ sel) => wc.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  const plain = await rightClick(wc1, 600, 300);
  check('right-click on the page: Back, Forward, Reload, Copy page address, Open page in Edge (no link or text entries)', JSON.stringify(labels(plain)) === JSON.stringify(['Back', 'Forward', 'Reload', 'Copy page address', 'Open page in Edge']), labels(plain));
  check('... Back is available (there is history), Forward is not (at the end), and the keys are shown', entry(plain, 'Back')?.enabled === true && entry(plain, 'Forward')?.enabled === false && entry(plain, 'Back')?.accelerator === 'Alt+Left' && entry(plain, 'Reload')?.accelerator === 'F5');
  smoke.clipboardWrites.length = 0;
  entry(plain, 'Copy page address')?.click();
  check('Copy page address copies the address of the page that raised the menu', smoke.clipboardWrites[0] === a1Url, smoke.clipboardWrites);
  const beforeMenuReload = reqCount('/page/a1');
  entry(plain, 'Reload')?.click();
  await waitFor(() => reqCount('/page/a1') > beforeMenuReload, 'menu reload', 5000).catch(() => {});
  check('Reload reloads the page', reqCount('/page/a1') === beforeMenuReload + 1);
  smoke.spawned.length = 0;
  entry(plain, 'Open page in Edge')?.click();
  await waitFor(() => smoke.spawned.length > 0, 'menu edge', 3000).catch(() => {});
  check('Open page in Edge opens that page', smoke.spawned.length === 1 && smoke.spawned[0].args.at(-1) === a1Url, smoke.spawned[0]);
  entry(plain, 'Back')?.click();
  check('Back from the menu goes back one step', await urlIs('a1', typedUrl), urlOf('a1'));
  await sleepMs(300);
  const onLink = await rightClick(wc1, ...(await rectOf(wc1, '#lnk')));
  check('right-click on a link adds "Copy link address" first', labels(onLink)[0] === 'Copy link address', labels(onLink));
  smoke.clipboardWrites.length = 0;
  entry(onLink, 'Copy link address')?.click();
  check('... which copies the link\'s address', smoke.clipboardWrites[0] === `${smoke.local}/page/linked`, smoke.clipboardWrites);
  check('Forward is now available after going back', entry(onLink, 'Forward')?.enabled === true);
  await wc1.executeJavaScript("(() => { const s = window.getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(document.getElementById('sel')); s.addRange(r); return 1; })()");
  const onSel = await rightClick(wc1, ...(await rectOf(wc1, '#sel')));
  check('right-click with selected text adds "Copy"', labels(onSel)[0] === 'Copy', labels(onSel));
  smoke.clipboardWrites.length = 0;
  entry(onSel, 'Copy')?.click();
  check('... which copies the selected text', smoke.clipboardWrites[0] === 'some selectable text', smoke.clipboardWrites);
  // the entries act on the page that raised the menu, even with two panes
  await br("show('a2', null, {split: {dir: 'row'}})");
  await waitFor(() => loaded('a2') && loaded('a1'), 'two panes');
  const a2Url = wcOf('a2').getURL();
  const onA2 = await rightClick(wcOf('a2'), 600, 300);
  smoke.clipboardWrites.length = 0;
  entry(onA2, 'Copy page address')?.click();
  check('with two panes the entries act on the page that raised the menu', smoke.clipboardWrites[0] === a2Url && a2Url !== urlOf('a1'), [smoke.clipboardWrites, a2Url]);
  // four panes: the Close button of every header stays visible
  for (const id of ['a3', 'a4']) await br(`show('${id}', null, {split: {dir: 'row'}})`);
  await waitFor(() => ['a1', 'a2', 'a3', 'a4'].every(loaded), 'four panes', 20000);
  await sleepMs(500);
  await shot('11-four-panes-header');
  const headGeometry = await ui(`[...document.querySelectorAll('#panes .pane')].map((p) => { const b = p.querySelector('.pane-head .icon-btn[title="Close pane"]'); const r = b && b.getBoundingClientRect(); const q = p.getBoundingClientRect(); return {pane: [Math.round(q.left), Math.round(q.right)], close: r ? [Math.round(r.left), Math.round(r.right), b.offsetWidth] : null, buttons: [...p.querySelectorAll('.pane-head .icon-btn')].filter((x) => x.offsetWidth > 0).length}; })`);
  check('in four panes every header still shows its Close button inside the pane', headGeometry.length === 4 && headGeometry.every((/** @type {any} */ g) => g.close && g.close[2] > 0 && g.close[1] <= g.pane[1] + 0.5 && g.close[0] >= g.pane[0]), headGeometry);
  await resetSingle();
  await br("navigate('a1', 'home')");
  await urlIs('a1', a1Url);

  // ------------------------------------------------------------------ the tick circle
  const dailyMade = await br(`upsert({items: [{workspaceId: 'ws-a', name: 'Polish daily', kind: 'web', url: '${smoke.local}/page/pd', schedule: {type: 'daily'}}]})`);
  const pd = dailyMade.ids.items[0];
  const circle = `document.querySelector('#list .row[data-edit-id="${pd}"] button.tick')`;
  await waitFor(() => ui(`!!${circle}`), 'tick circle', 4000).catch(() => {});
  check('a scheduled row shows its tick circle without hovering', (await ui(`(() => { const c = ${circle}; return !!c && c.offsetWidth > 0 && getComputedStyle(c).visibility === 'visible'; })()`)) === true);
  await ui(`${circle}.click()`);
  await waitFor(() => store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === pd), 'ticked by the circle', 4000).catch(() => {});
  check('clicking the circle ticks the item', store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === pd));
  check('... without opening it or changing the selection', layoutOf('ws-a').itemId === 'a1' && !views.entry(pd)?.awake && (await ui("document.querySelector('#list .row.active .name')?.textContent")) === 'Alpha one', { layout: layoutOf('ws-a'), awake: views.entry(pd)?.awake, active: await ui("document.querySelector('#list .row.active .name')?.textContent") });
  await waitFor(() => ui(`${circle}?.classList.contains('done') ?? false`), 'circle shows done', 4000).catch(() => {});
  await ui(`${circle}.click()`);
  await waitFor(() => !store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === pd), 'unticked by the circle', 4000).catch(() => {});
  check('clicking the circle of a done item unticks it', !store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === pd));
  await br(`remove('item', '${pd}')`);

  // ------------------------------------------------------------------ the return toast (D117)
  const mkEdge = async (/** @type {string} */ name, /** @type {any} */ schedule) =>
    (await br(`upsert({items: [{workspaceId: 'ws-a', name: ${JSON.stringify(name)}, kind: 'web', url: '${smoke.local}/page/edge-${name.replace(/\W/g, '')}', edge: {mode: 'always', profile: null}, schedule: ${JSON.stringify(schedule)}}]})`)).ids.items[0];
  const clearToast = () => ui("(() => { const t = document.getElementById('toast'); t.classList.remove('show'); t.textContent = ''; })()");
  const comeBack = () => { win.emit('blur'); win.emit('focus'); };
  const eDaily = await mkEdge('Edge daily', { type: 'daily' });
  const ePlain = await mkEdge('Edge plain', null);
  smoke.spawned.length = 0;
  await clearToast();
  const shown = await br(`show('${eDaily}')`);
  check('an item set to open in Edge opens in Edge, not in a pane', shown.ok && shown.kind === 'edge' && smoke.spawned.length === 1 && layoutOf('ws-a').itemId === 'a1', { shown, spawned: smoke.spawned.length, layout: layoutOf('ws-a') });
  win.emit('focus');
  await sleepMs(700);
  check('no message when the app was never left', !(await toastState()).show);
  comeBack();
  await waitFor(async () => (await toastState()).show, 'done toast', 4000).catch(() => {});
  const asked = await toastState();
  check('coming back after an Edge open asks "Done with Edge daily?" with a ✓ button', asked.show && asked.text.startsWith('Done with Edge daily?') && (await ui("document.querySelector('#toast button')?.textContent")) === '✓', asked);
  const askedAt = Date.now();
  await ui("document.querySelector('#toast button').click()");
  await waitFor(() => store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === eDaily), 'ticked from the toast', 4000).catch(() => {});
  check('pressing ✓ ticks the item', store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === eDaily));
  await clearToast();
  await waitFor(() => ui(`!!document.querySelector('#list .row[data-edit-id="${eDaily}"] .tick.done')`), 'the list shows the tick', 4000);
  await br(`show('${eDaily}')`);
  comeBack();
  await sleepMs(700);
  check('no message for an item that is already ticked', !(await toastState()).show, await toastState());
  await clearToast();
  await br(`show('${ePlain}')`);
  comeBack();
  await sleepMs(700);
  check('no message for an item without a schedule', !(await toastState()).show, await toastState());
  await br(`untick('${eDaily}')`);
  await waitFor(() => ui(`!!document.querySelector('#list .row[data-edit-id="${eDaily}"] .tick.due')`), 'the list shows it due again', 4000);
  await clearToast();
  smoke.spawned.length = 0;
  await ctx.api.handlers.contextMenu('item', eDaily);
  entry(smoke.menus.at(-1) ?? [], 'Open in Edge')?.click();
  await waitFor(() => smoke.spawned.length > 0, 'right-click Open in Edge', 3000).catch(() => {});
  comeBack();
  await waitFor(async () => (await toastState()).show, 'done toast after the menu entry', 4000).catch(() => {});
  const shownAt = Date.now();
  check('the right-click "Open in Edge" arms the message too', (await toastState()).text.startsWith('Done with Edge daily?'), await toastState());
  await waitFor(async () => !(await toastState()).show, 'done toast fades', 10000).catch(() => {});
  const shownFor = Date.now() - shownAt;
  check('the message fades by itself after about six seconds', shownFor > 4500 && shownFor < 9000 && !store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === eDaily), shownFor);
  void askedAt;
  await br(`remove('item', '${eDaily}')`);
  await br(`remove('item', '${ePlain}')`);

  // leave things as they were
  await br("selectWorkspace('ws-a')");
  await resetSingle();
  await waitFor(() => loaded('a1'), 'a1 shown again');
  void api;
}

/** The IPC contract and its safety rules (task 4.3). */
export async function phaseIpc(/** @type {any} */ ctx) {
  const { smoke, views, store, ui, check, waitFor, win, api } = ctx;
  const { br, loaded, layoutOf } = helpers(ctx);
  const rejects = async (/** @type {string} */ expr) => {
    try {
      await br(expr);
      return false;
    } catch {
      return true;
    }
  };

  // only the UI window's own frame may call
  /** @type {Record<string, Function>} */
  const registered = {};
  api.register({ handle: (/** @type {string} */ name, /** @type {Function} */ fn) => { registered[name] = fn; } });
  const uiEvent = { sender: win.webContents, senderFrame: { url: win.webContents.getURL() } };
  const siteEvent = { sender: views.entry('a1').view.webContents, senderFrame: { url: `${smoke.local}/page/a1` } };
  const wrongFrame = { sender: win.webContents, senderFrame: { url: 'https://example.com/' } };
  check('IPC: the UI frame is served', (await registered['fruitery:getState'](uiEvent)).snapshot.items.length > 0);
  const refused = async (/** @type {any} */ ev) => {
    try {
      await registered['fruitery:getState'](ev);
      return false;
    } catch {
      return true;
    }
  };
  check('IPC: a site view is refused', await refused(siteEvent));
  check('IPC: a foreign frame in the UI window is refused', await refused(wrongFrame));

  // a scripted sequence
  let st = await br('getState()');
  check('getState: snapshot, device, viewStates, badges, now', ['snapshot', 'device', 'viewStates', 'badges', 'now'].every((k) => k in st));
  await br("selectWorkspace('ws-b')");
  check('select workspace', (await br('getState()')).device.activeWorkspaceId === 'ws-b');
  const sh = await br("show('b1')");
  check('show an item', sh.ok && sh.kind === 'pane', sh);
  const sp = await br("show('b2', null, {split: {dir: 'col'}})");
  check('split from the contract', sp.ok && Layout.leaves(layoutOf('ws-b')).length === 2, sp);
  await waitFor(() => loaded('b1') && loaded('b2'), 'beta panes loaded');
  const t1 = await br("tick('a1')");
  check('tick of an already ticked item is idempotent (created: false)', t1.ok && t1.created === false, t1);
  const un = await br("untick('a1')");
  const t2 = await br("tick('a1')");
  check('untick then tick again creates one completion', un.removed === 1 && t2.created === true && store.snapshot().completions.filter((/** @type {any} */ c) => c.itemId === 'a1').length === 1, [un, t2]);
  const tBad = await br("tick('a2')");
  check('tick of an unscheduled item is an error', tBad.error === 'not-scheduled', tBad);
  const bad = await br("upsert({items: [{id: 'b1', url: ''}]})");
  check('upsert with an invalid item -> errors, nothing saved', Array.isArray(bad.errors) && bad.errors.some((/** @type {any} */ e) => e.field === 'url') && store.snapshot().items.find((/** @type {any} */ i) => i.id === 'b1').url !== '', bad);
  for (const u of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'ftp://example.com/x']) {
    const r = await br(`upsert({items: [{workspaceId: 'ws-b', name: 'Bad', kind: 'web', url: ${JSON.stringify(u)}}]})`);
    check(`upsert refuses a non-http address (${u.split(':')[0]})`, Array.isArray(r.errors), r);
  }
  const good = await br(`upsert({items: [{workspaceId: 'ws-b', name: 'Temp item', kind: 'web', url: '${smoke.local}/page/t1'}]})`);
  check('upsert a valid new item', good.ok && good.ids.items.length === 1, good);
  const tempId = good.ids.items[0];
  const ro = await br(`reorder('item', null, '${tempId}', 0)`);
  check('reorder', ro.ok && store.snapshot().items.find((/** @type {any} */ i) => i.id === tempId).order === 0, ro);
  const mv = await br(`moveItem('${tempId}', 'ws-a')`);
  check('moveItem keeps the id and goes to the other workspace', mv.ok && store.snapshot().items.find((/** @type {any} */ i) => i.id === tempId).workspaceId === 'ws-a', mv);
  const rm = await br(`remove('item', '${tempId}')`);
  check('remove is a tombstone (deleted: true, kept)', rm.ok && store.snapshot().items.find((/** @type {any} */ i) => i.id === tempId).deleted === true, rm);
  check('bad arguments are rejected: rects, navigate action, negative index, non-string id', (await rejects("setPaneRects('x')")) && (await rejects("navigate('b1', 'evil')")) && (await rejects("reorder('item', null, 'b1', -1)")) && (await rejects('tick(42)')) && (await rejects("remove('planet', 'x')")));

  // Edge: profile from the item, else the device; spawned without a shell; the pane stays
  smoke.spawned.length = 0;
  await br("upsert({items: [{id: 'b3', edge: {mode: 'always', profile: null}}]})");
  await br("saveDevice({edgeProfile: 'Profile 2'})");
  const layoutBefore = JSON.stringify(layoutOf('ws-b'));
  const e1 = await br("show('b3')");
  check('Edge item: opened through Edge, not in a pane', e1.ok && e1.kind === 'edge' && JSON.stringify(layoutOf('ws-b')) === layoutBefore, e1);
  check('Edge spawned with the device profile, one url argument, no shell', smoke.spawned.length === 1 && JSON.stringify(smoke.spawned[0].args) === JSON.stringify(['--profile-directory=Profile 2', `${smoke.local}/page/b3`]) && smoke.spawned[0].options.shell === false && smoke.spawned[0].options.detached === true, smoke.spawned[0]);
  await br("upsert({items: [{id: 'b3', edge: {mode: 'always', profile: 'Profile 9'}}]})");
  await br("show('b3')");
  check('the item profile beats the device profile', smoke.spawned[1]?.args[0] === '--profile-directory=Profile 9', smoke.spawned[1]);
  await br("saveDevice({edgeProfile: null})");
  await br("upsert({items: [{id: 'b3', edge: {mode: 'always', profile: null}}]})");
  await br("show('b3')");
  check('no profile anywhere: Edge\'s own default (no flag)', JSON.stringify(smoke.spawned[2]?.args) === JSON.stringify([`${smoke.local}/page/b3`]), smoke.spawned[2]);
  await br("upsert({items: [{id: 'b3', edge: {mode: 'inherit', profile: null}}]})");

  // blocked: missing Google email
  const g = await br(`upsert({items: [{workspaceId: 'ws-b', name: 'Needs email', kind: 'web', url: '${smoke.local}/page/g?u={googleEmail}'}]})`);
  const gid = g.ids.items[0];
  const blocked = await br(`show('${gid}')`);
  check('missing Google email: nothing opens, the reason is reported', blocked.ok === false && blocked.blocked === 'missing-google-email', blocked);
  const badEmail = await br("saveSettings({googleEmail: 'not an email'})");
  check('settings: an invalid email is rejected', Array.isArray(badEmail.errors));
  await br("saveSettings({googleEmail: 'smoke@example.com'})");
  const filled = await br(`show('${gid}')`);
  check('with the email set, the address is filled and opens in a pane', filled.ok && filled.kind === 'pane', filled);
  await waitFor(() => smoke.requests.some((/** @type {any} */ r) => r.path === '/page/g'), 'g requested', 8000).catch(() => {});
  await br(`remove('item', '${gid}')`);
  await br("saveSettings({googleEmail: null})");

  // native app item: a missing program falls back to its URL in a pane
  const app = await br(`upsert({items: [{workspaceId: 'ws-b', name: 'Native', kind: 'app', appPath: 'C:\\\\Definitely\\\\Missing\\\\thing.exe', fallbackUrl: '${smoke.local}/page/native'}]})`);
  const appId = app.ids.items[0];
  const fb = await br(`show('${appId}')`);
  check('missing program: the fallback address opens in a pane', fb.ok && fb.kind === 'pane', fb);
  await br(`remove('item', '${appId}')`);

  // D89: a program never approved on this PC starts only after the owner says so
  const exe = process.execPath;
  const exeJson = JSON.stringify(exe);
  check('programs: nothing is approved at first, and the list is not editable through saveDevice', store.device().approvedPrograms.length === 0 && (await br("saveDevice({approvedPrograms: ['C:\\\\x.exe']})")).ok === true && store.device().approvedPrograms.length === 0);
  const withFallback = await br(`upsert({items: [{workspaceId: 'ws-b', name: 'Prog', kind: 'app', appPath: ${exeJson}, fallbackUrl: '${smoke.local}/page/prog-fallback'}]})`);
  const noFallback = await br(`upsert({items: [{workspaceId: 'ws-b', name: 'Prog bare', kind: 'app', appPath: ${exeJson}}]})`);
  const progId = withFallback.ids.items[0];
  const bareId = noFallback.ids.items[0];
  smoke.programs.length = 0;
  smoke.dialogCalls.length = 0;
  smoke.dialogAnswers.push(0); // Start
  const p1 = await br(`show('${progId}')`);
  check('programs: the first launch asks "Start this program?" and shows the full path', smoke.dialogCalls.length === 1 && smoke.dialogCalls[0].message === 'Start this program?' && smoke.dialogCalls[0].detail === exe && smoke.dialogCalls[0].buttons.join('|') === 'Start|Don\u2019t start', smoke.dialogCalls[0]);
  check('programs: Start launches it and remembers the path', p1.ok === true && p1.kind === 'app' && smoke.programs.length === 1 && smoke.programs[0] === exe && store.device().approvedPrograms.includes(exe), [p1, smoke.programs]);
  const p2 = await br(`show('${progId}')`);
  check('programs: a second launch does not ask', p2.ok === true && smoke.dialogCalls.length === 1 && smoke.programs.length === 2, [p2, smoke.dialogCalls.length]);
  const p3 = await br(`show('${bareId}')`);
  check('programs: the same path on another item does not ask either', p3.ok === true && smoke.dialogCalls.length === 1 && smoke.programs.length === 3);
  store.updateDevice({ approvedPrograms: [] });
  smoke.dialogAnswers.push(1); // Don't start
  const p4 = await br(`show('${progId}')`);
  check('programs: Don\u2019t start opens the fallback address in a pane and launches nothing', p4.ok === true && p4.kind === 'pane' && smoke.programs.length === 3 && store.device().approvedPrograms.length === 0 && smoke.dialogCalls.length === 2, [p4, smoke.programs.length]);
  smoke.dialogAnswers.push(1);
  const p5 = await br(`show('${bareId}')`);
  check('programs: Don\u2019t start without a fallback opens nothing and says so', p5.ok === false && p5.declined === true && smoke.programs.length === 3 && smoke.dialogCalls.length === 3, p5);
  const p6 = await br(`show('${progId}', null, {split: {dir: 'row'}})`);
  check('programs: opening in a split shows the fallback in a pane and never asks or launches', p6.ok === true && p6.kind === 'pane' && smoke.dialogCalls.length === 3 && smoke.programs.length === 3, p6);
  await br(`remove('item', '${progId}')`);
  await br(`remove('item', '${bareId}')`);
  store.updateDevice({ approvedPrograms: [] });

  // openInEdge handler
  smoke.spawned.length = 0;
  const oe = await br("openInEdge('b1')");
  check('openInEdge handler spawns Edge for a web item', oe.ok && smoke.spawned.length === 1, oe);
  st = await br('getState()');
  check('device settings persisted (profile cleared)', st.device.edgeProfile === null);
  void ui;
}

/** Sync settings: the encrypted secret, the HTTP seam against a real local server, no leak to the UI, the Sync section of Settings. */
export async function phaseSync(/** @type {any} */ ctx) {
  const { smoke, views, store, ui, check, waitFor, secrets, sync, api } = ctx;
  const { br } = helpers(ctx);
  const dialogOpen = () => ui("document.getElementById('dialog').open");
  const setField = (/** @type {string} */ key, /** @type {unknown} */ value) =>
    ui(`(() => { const el = document.getElementById('f-${key}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles: true})); })()`);
  const press = async (/** @type {string} */ label) => {
    // a press while the previous action is still running would hit a disabled button
    await waitFor(() => ui(`[...document.querySelectorAll('#dialog .small-btn')].find((b) => b.textContent === ${JSON.stringify(label)}).disabled === false`), 'button ' + label + ' enabled', 6000);
    await ui(`[...document.querySelectorAll('#dialog .small-btn')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
  };
  const result = () => ui("document.querySelector('#dialog .action-result')?.textContent ?? ''");
  const SECRET = 'smoke-secret-9f3a7c1e5b2d';
  const CLIENT_ID = 'smoke-client-77aa.access';

  // --- the encrypted secret file (real safeStorage)
  check('sync: Windows secure storage is available', secrets.available() === true);
  check('sync: no secret is stored at first', secrets.loadSecret() === null);
  check('sync: a secret is saved', secrets.saveSecret(SECRET).ok === true && fs.existsSync(secrets.file));
  check('sync: it loads back', secrets.loadSecret() === SECRET);
  check('sync: the file holds encrypted bytes, not the secret', !fs.readFileSync(secrets.file).includes(Buffer.from(SECRET)));
  check('sync: the file is inside the data folder', secrets.file.toLowerCase().startsWith(dataDir.toLowerCase()));
  fs.writeFileSync(secrets.file, Buffer.from('not an encrypted secret'));
  check('sync: a corrupted secret file loads as null (like a data folder copied to another PC)', secrets.loadSecret() === null);
  store.updateDevice({ sync: { baseUrl: smoke.local, clientId: CLIENT_ID, expiresOn: '2027-01-01' } });
  const corruptStatus = await br('syncStatus()');
  check('sync: with a corrupted secret, syncStatus says configured but not connected', corruptStatus.configured === true && corruptStatus.connected === false && corruptStatus.status === 'not-connected', corruptStatus);
  const noKey = await br('syncTest()');
  check('sync: Test connection without a usable secret reports not-connected', noKey.ok === false && noKey.reason === 'not-connected', noKey);
  secrets.deleteSecret();
  store.updateDevice({ sync: { baseUrl: null, clientId: null, expiresOn: null } });
  check('sync: deleteSecret removes the file', !fs.existsSync(secrets.file));

  // --- a real local server: what the Worker would answer
  /** @type {{path: string, id: string | undefined, secret: string | undefined}[]} */
  const seen = [];
  let mode = 'ok';
  const server = http.createServer((req, res) => {
    seen.push({ path: String(req.url), id: /** @type {string | undefined} */ (req.headers['cf-access-client-id']), secret: /** @type {string | undefined} */ (req.headers['cf-access-client-secret']) });
    if (mode === 'redirect') {
      res.writeHead(302, { Location: 'https://login.example.com/' });
      res.end();
    } else if (mode === 'denied') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden', reason: 'service-token-not-allowed' }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ workspaces: [], groups: [], items: [], settings: {}, completions: [] }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  try {
    const bad = await br(`syncConfigure({baseUrl: 'http://example.com', clientId: '${CLIENT_ID}', secret: '${SECRET}', expiresOn: ''})`);
    check('sync: plain http to a real host is refused with a field error', bad.ok === false && bad.errors.some((/** @type {any} */ e) => e.field === 'baseUrl' && e.code === 'not-https'), bad);
    check('sync: a refused save stores nothing', secrets.loadSecret() === null && store.device().sync.baseUrl === null);
    let rejected = false;
    try {
      await br('syncConfigure(5)');
    } catch {
      rejected = true;
    }
    check('sync: a non-object argument is rejected by the IPC validation', rejected);
    const noSecret = await br(`syncConfigure({baseUrl: '${base}', clientId: '${CLIENT_ID}', secret: '', expiresOn: ''})`);
    check('sync: a blank secret with none stored is an error', noSecret.ok === false && noSecret.errors.some((/** @type {any} */ e) => e.field === 'secret' && e.code === 'required'), noSecret);

    const saved = await br(`syncConfigure({baseUrl: '${base}/', clientId: '${CLIENT_ID}', secret: '${SECRET}', expiresOn: '2027-01-01'})`);
    check('sync: a valid connection is saved', saved.ok === true, saved);
    check('sync: the secret is stored encrypted, the config in device.json without it', secrets.loadSecret() === SECRET && store.device().sync.baseUrl === base && !fs.readFileSync(path.join(dataDir, 'device.json'), 'utf8').includes(SECRET));
    const status = await br('syncStatus()');
    check('sync: syncStatus is connected and shows only the tail of the client id', status.connected === true && status.configured === true && status.clientIdTail === CLIENT_ID.slice(-4) && status.baseUrl === base && status.expiresOn === '2027-01-01' && status.status !== 'not-connected', status);

    // the sync engine may also be talking to this server now, so look at the request the test itself made
    const mark = seen.length;
    const ok = await br('syncTest()');
    const first = seen.slice(mark).find((s) => s.path === '/api/state');
    check('sync: Test connection succeeds against the local server', ok.ok === true, ok);
    check('sync: the key went out in the Access headers to /api/state', Boolean(first) && first.id === CLIENT_ID && first.secret === SECRET, first);
    mode = 'redirect';
    const refused = await br('syncTest()');
    check('sync: a redirect (Access refusing the key) is not followed and reads as "access-key-refused"', refused.ok === false && refused.reason === 'access-key-refused', refused);
    mode = 'denied';
    const denied = await br('syncTest()');
    check('sync: a 403 reports the server reason', denied.ok === false && denied.reason === 'service-token-not-allowed', denied);
    mode = 'ok';

    // --- nothing reaches the UI
    const uiState = await br('getState()');
    const allResults = JSON.stringify([saved, status, ok, refused, denied, noSecret, bad, uiState, api.buildState()]);
    check('sync: the secret is in no IPC result and no state sent to the UI', !allResults.includes(SECRET));
    check('sync: the full client id is not in the state either (only the tail via syncStatus)', !JSON.stringify(api.buildState()).includes(CLIENT_ID) && !('sync' in uiState.device));

    // --- the Sync section of Settings
    await ui("document.querySelector('#rail .rail-gear').click()");
    await waitFor(dialogOpen, 'settings dialog (sync)');
    check('sync: the native views are off the window while Settings is open', await waitFor(() => views.isOverlay(), 'overlay on', 3000).then(() => true, () => false));
    check('sync: the Sync section shows the setup guide path as text', (await ui("document.getElementById('dialog').textContent.includes('Setup guide: docs/desktop/general/sync-setup.md')")) === true);
    check('sync: the Worker address is prefilled', (await ui("document.getElementById('f-syncBaseUrl').value")) === base);
    check('sync: the secret field is a password field and never prefilled; it says "Stored"', (await ui("(() => { const e = document.getElementById('f-syncSecret'); return e.type === 'password' && e.value === '' && e.closest('.field').textContent.includes('Stored'); })()")) === true);
    check('sync: the client id is not prefilled either (only its tail is hinted)', (await ui(`(() => { const e = document.getElementById('f-syncClientId'); return e.value === '' && e.closest('.field').textContent.includes('${CLIENT_ID.slice(-4)}'); })()`)) === true);
    check('sync: the dialog has Test connection and Disconnect', (await ui("[...document.querySelectorAll('#dialog .small-btn')].map((b) => b.textContent).filter((t) => t === 'Test connection' || t === 'Disconnect').length")) === 2);
    await press('Test connection');
    await waitFor(async () => (await result()).includes('Connected'), 'test connection result', 6000).catch(() => {});
    check('sync: Test connection in the dialog reports "Connected"', (await result()).includes('Connected'), await result());
    await setField('syncExpiresOn', '2028-02-29');
    await press('Test connection');
    await waitFor(() => store.device().sync.expiresOn === '2028-02-29', 'expiry saved by Test', 6000).catch(() => {});
    check('sync: changing only the expiry (blank secret) keeps the stored secret', store.device().sync.expiresOn === '2028-02-29' && secrets.loadSecret() === SECRET && store.device().sync.clientId === CLIENT_ID);
    await setField('syncBaseUrl', 'http://example.com');
    await press('Test connection');
    await waitFor(() => ui("document.getElementById('f-syncBaseUrl').closest('.field').classList.contains('invalid')"), 'invalid address marked', 4000).catch(() => {});
    check('sync: a bad address is marked inline and nothing is saved', (await ui("document.getElementById('f-syncBaseUrl').closest('.field').textContent.includes('https://')")) === true && store.device().sync.baseUrl === base);
    await setField('syncBaseUrl', base);
    smoke.dialogCalls.length = 0;
    smoke.dialogAnswers.push(1); // Cancel
    await press('Disconnect');
    await waitFor(() => smoke.dialogCalls.length === 1, 'disconnect confirm', 4000);
    await new Promise((r) => setTimeout(r, 250));
    check('sync: Disconnect asks first; Cancel keeps the key', smoke.dialogCalls[0].message === 'Disconnect this PC from sync?' && secrets.loadSecret() === SECRET);
    smoke.dialogAnswers.push(0);
    await press('Disconnect');
    await waitFor(() => secrets.loadSecret() === null, 'secret deleted', 6000).catch(() => {});
    check('sync: Disconnect deletes the secret, clears the client id and expiry, keeps the address', secrets.loadSecret() === null && !fs.existsSync(secrets.file) && store.device().sync.clientId === null && store.device().sync.expiresOn === null && store.device().sync.baseUrl === base, store.device().sync);
    const after = await br('syncStatus()');
    check('sync: after Disconnect the status is not connected', after.connected === false && after.configured === false && after.status === 'not-connected' && after.clientIdTail === null, after);
    await ui("document.querySelector('#dialog .form-actions button').click()");
    await waitFor(async () => !(await dialogOpen()), 'settings closed (sync)', 4000);
    check('sync: the overlay is released after the Settings dialog closes', await waitFor(() => !views.isOverlay(), 'overlay off', 4000).then(() => true, () => false));
  } finally {
    server.close();
    server.closeAllConnections?.();
    secrets.deleteSecret();
    store.updateDevice({ sync: { baseUrl: null, clientId: null, expiresOn: null } });
  }
  const down = await sync.test();
  check('sync: once nothing is configured the test says not-connected without any request', down.ok === false && down.reason === 'not-connected');
}

/**
 * Sync against the REAL Worker handler (task 5.1): the Worker's request handler over a node:sqlite D1 with the
 * real migrations, behind a local http server (main/smoke-worker.js). Covers connecting through Settings, the
 * first connect (backup, newer local edits, current-period ticks), pull, push after the debounce, a direct D1
 * write seen after a focus, offline queueing and the restart of the server, a rejected entry in the Needs
 * attention panel, ticks through the API, ticking disabled offline, a corrupted secret file, the chip's
 * tooltips, and that the secret reaches no state broadcast.
 */
export async function phaseWorker(/** @type {any} */ ctx) {
  const { views, store, ui, check, waitFor, secrets, engine, api, win } = ctx;
  const { br, loaded } = helpers(ctx);
  const { enqueue } = await import('../lib/sync-plan.js');
  const CLIENT_ID = 'worker-client-5d2e.access';
  const SECRET = 'worker-secret-b81f40c7a3e9';
  const dialogOpen = () => ui("document.getElementById('dialog').open");
  const setField = (/** @type {string} */ key, /** @type {unknown} */ value) =>
    ui(`(() => { const el = document.getElementById('f-${key}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles: true})); })()`);
  const press = async (/** @type {string} */ label) => {
    await waitFor(() => ui(`[...document.querySelectorAll('#dialog .small-btn')].find((b) => b.textContent === ${JSON.stringify(label)})?.disabled === false`), `button ${label} enabled`, 6000);
    await ui(`[...document.querySelectorAll('#dialog .small-btn')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
  };
  const result = () => ui("document.querySelector('#dialog .action-result')?.textContent ?? ''");
  const chip = () => ui("(() => { const b = document.querySelector('#rail .rail-sync'); return b ? { title: b.title, badge: b.querySelector('.sync-badge')?.textContent ?? '' } : null; })()");
  const status = () => br('syncStatus()');
  const chipTitle = async () => (await chip())?.title ?? '';
  const utcDate = (/** @type {number} */ plusDays) => new Date(Date.now() + plusDays * 86_400_000).toISOString().slice(0, 10);

  // the UI keeps a copy of every state it is sent, to prove afterwards that no secret was in any of them
  await ui('window.__states = []; window.fruitery.onState((s) => { window.__states.push(JSON.stringify(s)); }); true');
  await br("selectWorkspace('ws-a')");

  // --- the "server": a copy of the current data plus one item that only the server has
  const snap = store.snapshot();
  const srvItem = { ...structuredClone(snap.items.find((/** @type {any} */ i) => i.id === 'a2')), id: 'wsync-srv', name: 'Wsync server item', order: 50, updatedAt: Date.now() - 5000 };
  // The Worker's sources are not part of the packaged app (it must stay lean): this phase runs from the repo only.
  // Anything that stops the sources from loading skips the phase with one line; it is not a failure.
  /** @type {any} */
  let worker;
  /** @type {any} */
  let startSmokeWorker;
  try {
    await import('../../web/src/api.js');
    await import('../../web/src/store.js');
    await import('../../web/test-support/d1-sqlite.js');
    ({ startSmokeWorker } = await import('./smoke-worker.js'));
  } catch (err) {
    const missing = /** @type {any} */ (err)?.code === 'ERR_MODULE_NOT_FOUND' || /** @type {any} */ (err)?.code === 'MODULE_NOT_FOUND' || /Cannot find module|ENOENT/.test(String(/** @type {Error} */ (err)?.message));
    if (missing) {
      console.log('  skip [W] real-Worker phase: Worker sources not packaged');
      return;
    }
    check(`worker: the Worker sources failed to load (${/** @type {Error} */ (err).message})`, false);
    return;
  }
  try {
    worker = await startSmokeWorker({
      clientId: CLIENT_ID,
      secret: SECRET,
      seed: { workspaces: structuredClone(snap.workspaces), groups: structuredClone(snap.groups), items: [...structuredClone(snap.items), srvItem], settings: structuredClone(snap.settings) },
    });
  } catch (err) {
    check(`worker: the Worker handler, node:sqlite and the migrations load inside Electron (${/** @type {Error} */ (err).message})`, false);
    return;
  }
  check('worker: the Worker handler, node:sqlite and the migrations load inside Electron', true);
  check('worker: the local data is UTC (the server\'s default), so periods agree', snap.settings.timezone === 'UTC', snap.settings.timezone);

  /** @type {string | null} */ let preId = null;
  /** @type {string | null} */ let tickId = null;
  try {
    // --- local-only edits made before connecting: a new scheduled item, ticked
    const pre = await br(`upsert({items: [{workspaceId: 'ws-a', name: 'Wsync pre', kind: 'web', url: '${worker.url}/page/wpre', schedule: {type: 'daily'}}]})`);
    preId = pre.ids.items[0];
    await br(`tick('${preId}')`);
    check('worker: before connecting nothing is queued (local-only mode)', store.outbox().length === 0 && worker.seen.length === 0);

    // --- 1. connect through Settings -> Sync, Test connection
    await ui("document.querySelector('#rail .rail-gear').click()");
    await waitFor(dialogOpen, 'settings (worker)');
    await setField('syncBaseUrl', worker.url);
    await setField('syncClientId', CLIENT_ID);
    await setField('syncSecret', SECRET);
    await press('Test connection');
    await waitFor(async () => (await result()).includes('Connected'), 'worker test connection', 10000).catch(() => {});
    check('worker: Settings -> Sync saves and "Test connection" reports Connected', (await result()).includes('Connected'), await result());
    check('worker: every request carried the Access key headers (client id and secret)', worker.seen.length > 0 && worker.seen.every((/** @type {any} */ s) => s.id === CLIENT_ID && s.secret === SECRET), worker.seen.slice(0, 3));
    check('worker: the Worker accepted the key (a service-token identity), no 403', worker.seen.every((/** @type {any} */ s) => s.status === 200), worker.seen.map((/** @type {any} */ s) => s.status));
    await ui("document.querySelector('#dialog .form-actions button').click()");
    await waitFor(async () => !(await dialogOpen()), 'settings closed (worker)', 4000);

    // --- 2. the first connect
    await waitFor(() => store.firstSyncDoneFor() === worker.url, 'first sync done', 20000).catch(() => {});
    check('worker: the first connect completed and is remembered for this address', store.firstSyncDoneFor() === worker.url, store.firstSyncDoneFor());
    const backups = fs.readdirSync(dataDir).filter((f) => f.startsWith('cache.pre-sync-'));
    check('worker: a backup of the cache was written before the first sync (it holds the pre-connect edit)', backups.some((f) => fs.readFileSync(path.join(dataDir, f), 'utf8').includes('Wsync pre')), backups);
    const preRow = await worker.row('SELECT name, deleted FROM items WHERE id = ?', preId);
    check('worker: the newer local edit (an item made before connecting) is in D1', preRow?.name === 'Wsync pre', preRow);
    const todayKey = utcDate(0);
    const preTick = await worker.row('SELECT period_key FROM completions WHERE item_id = ?', preId);
    check('worker: the current-period tick was posted (stored by the server for today)', preTick?.period_key === todayKey, preTick);
    const order = worker.seen.map((/** @type {any} */ s) => `${s.method} ${s.path.split('?')[0]}`);
    check('worker: first connect order is read, push, ticks, pull', order.indexOf('PUT /api/entities') > 0 && order.indexOf('POST /api/ticks') > order.indexOf('PUT /api/entities') && order.lastIndexOf('GET /api/state') > order.indexOf('POST /api/ticks'), order);
    let st = await status();
    check('worker: after the first sync the status is synced, with nothing pending or rejected', st.status === 'synced' && st.pending === 0 && st.rejected.length === 0 && typeof st.lastSyncAt === 'number', st);

    // --- 3. pull
    await waitFor(() => store.snapshot().items.some((/** @type {any} */ i) => i.id === 'wsync-srv' && !i.deleted), 'server item pulled', 6000).catch(() => {});
    check('worker: the pull brought in the item only the server had', store.snapshot().items.some((/** @type {any} */ i) => i.id === 'wsync-srv' && i.name === 'Wsync server item'));
    check('worker: the server\'s history replaced the local completions (the first-sync tick is there)', store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === preId && c.periodKey === todayKey));
    await waitFor(async () => (await chipTitle()).startsWith('Synced'), 'synced tooltip', 4000).catch(() => {});
    check('worker: the chip says "Synced <time>"', /^Synced \d/.test(await chipTitle()), await chip());

    // --- 4. an edit in the app reaches D1 after the debounce
    await br(`upsert({items: [{id: '${preId}', name: 'Wsync pre renamed'}]})`);
    await waitFor(async () => (await worker.row('SELECT name FROM items WHERE id = ?', preId))?.name === 'Wsync pre renamed', 'edit in D1', 9000).catch(() => {});
    check('worker: an edit made in the app is in D1 shortly after (1 s debounce)', (await worker.row('SELECT name FROM items WHERE id = ?', preId))?.name === 'Wsync pre renamed');
    await waitFor(async () => (await status()).pending === 0, 'queue empty', 6000).catch(() => {});
    check('worker: the queue is empty once the server confirmed it', store.outbox().length === 0);

    // --- 5. a direct write to D1 shows up after the window gets focus
    await worker.db.prepare('UPDATE items SET name = ?, updated_at = ? WHERE id = ?').bind('Wsync server renamed', Date.now() + 5000, 'wsync-srv').run();
    win.emit('focus');
    await waitFor(() => store.snapshot().items.find((/** @type {any} */ i) => i.id === 'wsync-srv')?.name === 'Wsync server renamed', 'direct D1 write pulled', 9000).catch(() => {});
    check('worker: a change written straight to D1 appears in the app after the window gains focus', store.snapshot().items.find((/** @type {any} */ i) => i.id === 'wsync-srv')?.name === 'Wsync server renamed');

    // --- 8. a tick through the API lands in D1 with the server clock
    const made = await br("upsert({items: [{workspaceId: 'ws-a', name: 'Wsync tick', kind: 'web', url: '" + worker.url + "/page/wtick', schedule: {type: 'daily'}}]})");
    tickId = made.ids.items[0];
    await waitFor(async () => Boolean(await worker.row('SELECT id FROM items WHERE id = ?', tickId)), 'tick item in D1', 9000);
    const t0 = Date.now();
    const ticked = await br(`tick('${tickId}')`);
    const t1 = Date.now();
    const trow = await worker.row('SELECT period_key, done_at FROM completions WHERE item_id = ?', tickId);
    check('worker: a tick goes through POST /api/ticks and is stored by the server', ticked.ok === true && trow?.period_key === todayKey, { ticked, trow });
    check('worker: its time is the server\'s clock when the request arrived', trow && trow.done_at >= t0 && trow.done_at <= t1 + 50, { trow, t0, t1 });
    check('worker: the returned completion is in the local data', store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === tickId && c.periodKey === todayKey));
    const unticked = await br(`untick('${tickId}')`);
    check('worker: untick goes through DELETE /api/ticks and removes it from D1', unticked.ok === true && (await worker.row('SELECT 1 AS x FROM completions WHERE item_id = ?', tickId)) === null, unticked);

    // --- 11a. chip: expiring
    const soon = utcDate(10);
    const cfg = await br(`syncConfigure({baseUrl: '${worker.url}', clientId: '', secret: '', expiresOn: '${soon}'})`);
    await waitFor(async () => (await status()).status === 'expiring:10', 'expiring:10', 8000).catch(() => {});
    check('worker: with an expiry 10 days ahead the status is expiring:10', cfg.ok === true && (await status()).status === 'expiring:10', await status());
    await waitFor(async () => (await chipTitle()).startsWith('Access key expires in 10 days'), 'expiring tooltip', 4000).catch(() => {});
    check('worker: the chip says "Access key expires in 10 days"', (await chipTitle()).startsWith('Access key expires in 10 days'), await chip());
    await br(`syncConfigure({baseUrl: '${worker.url}', clientId: '', secret: '', expiresOn: ''})`);
    await waitFor(async () => (await status()).status === 'synced', 'synced again', 8000).catch(() => {});

    // --- 6 + 9 + 11b. offline: the edit is kept, the status and chip say so, ticking is blocked
    await br(`show('${tickId}')`);
    await waitFor(() => loaded(tickId), 'tick item loaded', 10000).catch(() => {});
    await worker.stop();
    await br(`upsert({items: [{id: '${preId}', name: 'Wsync offline edit'}]})`);
    await waitFor(async () => (await status()).status === 'offline', 'offline status', 12000).catch(() => {});
    st = await status();
    check('worker: with the server stopped, the status is offline and the edit stays in the queue', st.status === 'offline' && st.pending >= 1 && store.outbox().some((/** @type {any} */ o) => o.entity.id === preId), st);
    await waitFor(async () => (await chipTitle()) .startsWith('Offline'), 'offline tooltip', 4000).catch(() => {});
    const offChip = await chip();
    check('worker: the chip says "Offline — edits and ticks are kept and sent later" and shows the waiting count', offChip?.title.startsWith('Offline — edits and ticks are kept and sent later') && Number(offChip.badge) >= 1, offChip);
    const offState = await br('getState()');
    check('worker: ticksEnabled stays true while offline (ticks are queued, not refused)', offState.ticksEnabled === true);
    check('worker: the list shows no "ticking needs a connection" notice offline', (await ui("!document.querySelector('#list .list-notice')")) === true);
    check('worker: the tick circles are not blocked offline', (await ui("(() => { const t = [...document.querySelectorAll('#list .row .tick')]; return t.length > 0 && t.every((b) => b.getAttribute('aria-disabled') !== 'true'); })()")) === true);
    await waitFor(() => ui("document.querySelector('.daily-bar .done-btn')?.disabled === false"), 'daily bar Done enabled', 4000).catch(() => {});
    check('worker: the Daily bar Done button is enabled offline', (await ui("document.querySelector('.daily-bar .done-btn')?.disabled")) === false);
    // tick offline through the real circle: it shows ticked and waiting, nothing reaches D1
    const rowTick = `document.querySelector('#list .row[data-edit-id="${tickId}"] .tick')`;
    const clickAt = Date.now();
    await ui(`${rowTick}.click()`);
    await waitFor(() => ui(`!!document.querySelector('#list .row[data-edit-id="${tickId}"] .tick.done.pending')`), 'ticked and pending', 5000).catch(() => {});
    check('worker: ticking offline shows the circle ticked and waiting to be sent (pending)', (await ui(`!!document.querySelector('#list .row[data-edit-id="${tickId}"] .tick.done.pending')`)) === true);
    check('worker: the tick waits in the queue, in the local data, and not in D1', store.tickOutbox().some((/** @type {any} */ o) => o.op === 'tick' && o.itemId === tickId) && store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === tickId) && (await worker.row('SELECT 1 AS x FROM completions WHERE item_id = ?', tickId)) === null);
    check('worker: the tooltip says it waits for a connection', (await ui(`document.querySelector('#list .row[data-edit-id="${tickId}"] .tick').title`)).startsWith('Waiting to be sent'));
    const cardBefore = worker.seen.length;
    await worker.start();
    await engine.trigger();
    const sentAt = Date.now();
    await waitFor(async () => (await worker.row('SELECT 1 AS x FROM completions WHERE item_id = ?', tickId)) !== null, 'offline tick in D1', 9000).catch(() => {});
    const offTick = await worker.row('SELECT period_key, done_at FROM completions WHERE item_id = ?', tickId);
    check('worker: when the server is back the offline tick is in D1, filed for today with the time it was made', offTick?.period_key === todayKey && offTick.done_at >= clickAt - 5000 && offTick.done_at <= clickAt + 5000, { offTick, clickAt });
    check('worker: and it was sent only after the restart (not before it)', offTick && sentAt >= clickAt);
    await waitFor(async () => store.tickOutbox().length === 0, 'tick queue empty', 6000).catch(() => {});
    await waitFor(() => ui(`!document.querySelector('#list .row[data-edit-id="${tickId}"] .tick.pending')`), 'pending marker gone', 5000).catch(() => {});
    check('worker: the queue is empty and the pending marker is gone once the server has it', store.tickOutbox().length === 0 && (await ui(`!document.querySelector('#list .row[data-edit-id="${tickId}"] .tick.pending')`)) === true);
    // an untick offline of a tick that is already on the server is queued and sent as the period
    await worker.stop();
    await br(`untick('${tickId}')`);
    check('worker: unticking offline removes the completion at once and queues the removal', store.tickOutbox().some((/** @type {any} */ o) => o.op === 'untick' && o.itemId === tickId) && !store.snapshot().completions.some((/** @type {any} */ c) => c.itemId === tickId));
    await worker.start();
    await engine.trigger();
    await waitFor(async () => (await worker.row('SELECT 1 AS x FROM completions WHERE item_id = ?', tickId)) === null, 'untick sent', 9000).catch(() => {});
    check('worker: the queued untick is sent as soon as the server is back and removes the tick from D1', (await worker.row('SELECT 1 AS x FROM completions WHERE item_id = ?', tickId)) === null && store.tickOutbox().length === 0);
    await waitFor(async () => (await worker.row('SELECT name FROM items WHERE id = ?', preId))?.name === 'Wsync offline edit', 'offline edit pushed', 9000).catch(() => {});
    check('worker: when the server is back the queued edit is pushed', (await worker.row('SELECT name FROM items WHERE id = ?', preId))?.name === 'Wsync offline edit');    st = await status();
    check('worker: the status returns to synced with an empty queue', st.status === 'synced' && st.pending === 0, st);
    check('worker: requests resumed after the restart', worker.seen.length > cardBefore);
    await waitFor(() => ui("!document.querySelector('#list .list-notice')"), 'notice gone', 4000).catch(() => {});
    check('worker: ticking works again (ticksEnabled, no notice)', (await br('getState()')).ticksEnabled === true && (await ui("!document.querySelector('#list .list-notice')")) === true);

    // --- 7. a rejected entry: marked, shown in Needs attention, discarded
    const base = structuredClone(store.snapshot().items.find((/** @type {any} */ i) => i.id === 'a2'));
    const bad = { ...base, id: 'wsync-bad', name: '   ', order: 60, updatedAt: Date.now() + 1000 };
    store.setOutbox(enqueue(store.outbox(), 'items', [bad]));
    await engine.trigger();
    await waitFor(async () => (await status()).rejected.length === 1, 'rejected entry', 9000).catch(() => {});
    st = await status();
    check('worker: the server\'s 422 marks the entry (name required) and it stays local', st.rejected.length === 1 && st.rejected[0].id === 'wsync-bad' && st.rejected[0].errors.some((/** @type {any} */ e) => e.field === 'name'), st.rejected);
    check('worker: the rejected entry was not stored in D1', (await worker.row('SELECT 1 AS x FROM items WHERE id = ?', 'wsync-bad')) === null);
    check('worker: the pull still happened (a refusal is not a sync error)', st.status === 'synced');
    await waitFor(async () => (await chipTitle()).includes('needs attention'), 'attention tooltip', 4000).catch(() => {});
    const attn = await chip();
    check('worker: the chip shows the count and says a change needs attention', attn?.badge === '1' && attn.title.includes('1 change needs attention'), attn);
    check('worker: native views are attached before the panel opens', loaded(tickId));
    await ui("document.querySelector('#rail .rail-sync').click()");
    await waitFor(dialogOpen, 'needs attention panel', 4000);
    await waitFor(() => views.isOverlay(), 'overlay on for the panel', 3000).catch(() => {});
    const panelText = await ui("document.getElementById('dialog').textContent");
    check('worker: the chip opens "Needs attention" naming the entry and the problem in words', panelText.includes('Needs attention') && panelText.includes('Item:') && panelText.includes('Name is required'), panelText);
    check('worker: the panel has Fix and Discard', (await ui("[...document.querySelectorAll('#dialog .small-btn')].map((b) => b.textContent).filter((t) => t === 'Fix' || t === 'Discard').length")) === 2);
    check('worker: the native site views are off the window while the panel is open', views.isOverlay() === true && !loaded(tickId));
    await press('Discard');
    await waitFor(async () => (await status()).rejected.length === 0, 'discarded', 9000).catch(() => {});
    await waitFor(async () => !(await dialogOpen()), 'panel closed after the last discard', 4000).catch(() => {});
    check('worker: Discard removes the entry and the panel closes by itself', (await status()).rejected.length === 0 && !(await dialogOpen()));
    check('worker: a change the server never had is gone from the app too', !store.snapshot().items.some((/** @type {any} */ i) => i.id === 'wsync-bad') && store.outbox().length === 0);
    check('worker: the site views come back after the panel closes', await waitFor(() => !views.isOverlay() && loaded(tickId), 'views back', 6000).then(() => true, () => false));

    // --- a waiting tick the server refuses (too old) is dropped and reported under Needs attention
    store.setTickOutbox([{ op: 'tick', itemId: preId, periodKey: utcDate(-3), doneAt: Date.now() - 72 * 3600000 }]);
    await engine.trigger();
    await waitFor(async () => (await status()).droppedTicks.length === 1, 'dropped tick notice', 9000).catch(() => {});
    st = await status();
    check('worker: the server refused the 72-hour-old tick (422 tick-too-old): dropped from the queue, kept as a notice', st.droppedTicks.length === 1 && st.droppedTicks[0].reason === 'tick-too-old' && store.tickOutbox().length === 0 && (await worker.row('SELECT 1 AS x FROM completions WHERE item_id = ? AND period_key = ?', preId, utcDate(-3))) === null, st.droppedTicks);
    check('worker: a refusal is not a sync error', st.status === 'synced');
    await waitFor(async () => (await chipTitle()).includes('needs attention'), 'dropped tick tooltip', 4000).catch(() => {});
    await ui("document.querySelector('#rail .rail-sync').click()");
    await waitFor(dialogOpen, 'needs attention panel (dropped tick)', 4000);
    const droppedText = await ui("document.getElementById('dialog').textContent");
    check('worker: Needs attention lists the dropped tick in words, with Dismiss', droppedText.includes('Tick dropped:') && droppedText.includes('more than 48 hours') && (await ui("[...document.querySelectorAll('#dialog .small-btn')].some((b) => b.textContent === 'Dismiss')")) === true, droppedText);
    await press('Dismiss');
    await waitFor(async () => (await status()).droppedTicks.length === 0, 'notice dismissed', 6000).catch(() => {});
    await waitFor(async () => !(await dialogOpen()), 'panel closed after the last dismissal', 4000).catch(() => {});
    check('worker: Dismiss removes the notice and the panel closes by itself', (await status()).droppedTicks.length === 0 && !(await dialogOpen()) && store.tickNotices().length === 0);
    await waitFor(() => !views.isOverlay() && loaded(tickId), 'views back after dismiss', 6000).catch(() => {});

    // --- an expired key can never send a tick: refused, with the right notice
    const lapsed = await br(`syncConfigure({baseUrl: '${worker.url}', clientId: '', secret: '', expiresOn: '${utcDate(-1)}'})`);
    await waitFor(async () => (await status()).status === 'expired', 'expired status', 8000).catch(() => {});
    const expiredTick = await br(`tick('${preId}')`);
    check('worker: with an expired key a tick is refused (ticks-need-connection) and nothing changes', lapsed.ok === true && expiredTick.error === 'ticks-need-connection' && store.tickOutbox().length === 0, expiredTick);
    await waitFor(() => ui("document.querySelector('#list .list-notice')?.textContent === 'Ticking needs a new access key'"), 'expired notice', 4000).catch(() => {});
    check('worker: the list says "Ticking needs a new access key" and the chip says the key expired', (await ui("document.querySelector('#list .list-notice')?.textContent ?? ''")) === 'Ticking needs a new access key' && (await chipTitle()).startsWith('Access key expired'), await chip());
    await br(`syncConfigure({baseUrl: '${worker.url}', clientId: '', secret: '', expiresOn: ''})`);
    await waitFor(async () => (await status()).status === 'synced', 'synced after the expiry is cleared', 8000).catch(() => {});
    // --- 10. a corrupted secret file
    const mark = worker.seen.length;
    fs.writeFileSync(secrets.file, Buffer.from('this is not an encrypted secret'));
    await engine.trigger();
    st = await status();
    check('worker: a corrupted secret file reads as not connected (configured, no secret)', st.status === 'not-connected' && st.configured === true && st.connected === false, st);
    check('worker: no request is made without a usable secret', worker.seen.length === mark);
    const gone = await br('getState()');
    check('worker: ticksEnabled is false and a tick is refused', gone.ticksEnabled === false && (await br(`tick('${tickId}')`)).error === 'ticks-need-connection');
    await waitFor(() => ui("document.querySelector('#list .list-notice')?.textContent === 'Ticking needs the access key'"), 'access key notice', 4000).catch(() => {});
    check('worker: the list says "Ticking needs the access key"', (await ui("document.querySelector('#list .list-notice')?.textContent ?? ''")) === 'Ticking needs the access key');
    await waitFor(async () => (await chipTitle()).startsWith('Not connected'), 'not connected tooltip', 4000).catch(() => {});
    check('worker: the chip says "Not connected — enter the access key in Settings → Sync"', (await chipTitle()) === 'Not connected — enter the access key in Settings → Sync', await chip());
    const again = await br(`syncConfigure({baseUrl: '${worker.url}', clientId: '', secret: '${SECRET}', expiresOn: ''})`);
    await waitFor(async () => (await status()).status === 'synced', 'reconnected', 9000).catch(() => {});
    check('worker: typing the secret again reconnects', again.ok === true && (await status()).status === 'synced', await status());

    // --- nothing secret in any state the UI was sent, nor in the files
    const states = /** @type {string[]} */ (await ui('window.__states'));
    check('worker: the UI received many state broadcasts during these flows', states.length > 10, states.length);
    check('worker: the secret is in none of them, nor the full client id', states.every((s) => !s.includes(SECRET) && !s.includes(CLIENT_ID)));
    check('worker: nor in the state built now', !JSON.stringify(api.buildState()).includes(SECRET) && !JSON.stringify(api.buildState()).includes(CLIENT_ID));
    check('worker: nor in device.json or cache.json', ['device.json', 'cache.json'].every((f) => !fs.readFileSync(path.join(dataDir, f), 'utf8').includes(SECRET)));
  } catch (err) {
    check(`worker: phase completed (${/** @type {Error} */ (err).message})`, false);
    console.error(err);
  } finally {
    // leave no trace for the later phases: delete what this phase made, disconnect, forget the address
    try {
      for (const id of [preId, tickId, 'wsync-srv']) if (id) await br(`remove('item', '${id}')`);
      await engine.trigger();
      await br('syncDisconnect()');
      // the editor phase expects Alpha one in the pane, as the earlier phases left it
      await br("selectWorkspace('ws-a')");
      await br("show('a1')");
      await waitFor(() => loaded('a1'), 'Alpha one back in its pane', 10000);
    } catch {
      // best effort
    }
    store.updateDevice({ sync: { baseUrl: null, clientId: null, expiresOn: null } });
    secrets.deleteSecret();
    await worker.stop();
  }
  check('worker: after cleanup this PC is not connected and holds no secret', !fs.existsSync(secrets.file) && store.device().sync.baseUrl === null && store.firstSyncDoneFor() === null);
  void sleepMs;
}

/** Editors (task 5.2). */
export async function phaseEditor(/** @type {any} */ ctx) {
  const { smoke, views, store, ui, check, waitFor, shot, win } = ctx;
  const { br, wcOf, loaded, layoutOf } = helpers(ctx);
  const dialogOpen = () => ui("document.getElementById('dialog').open");
  const setField = (/** @type {string} */ key, /** @type {unknown} */ value) =>
    ui(`(() => { const el = document.getElementById('f-${key}'); if (el.type === 'checkbox') el.checked = ${JSON.stringify(value)}; else el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', {bubbles: true})); })()`);
  const submit = () => ui("document.querySelector('#dialog form').requestSubmit()");
  const items = () => store.snapshot().items;
  const byName = (/** @type {string} */ n) => items().find((/** @type {any} */ i) => i.name === n && !i.deleted);

  await br("selectWorkspace('ws-a')");
  await waitFor(() => ui("document.querySelector('#list .list-title')?.textContent === 'Alpha'"), 'Alpha list');

  // F3 edits the entry that has focus (11.1)
  const dialogTitle = () => ui("document.querySelector('#dialog h2')?.textContent ?? null");
  const cancelDialog = async () => {
    await ui("document.querySelector('#dialog .form-actions button')?.click()");
    await waitFor(async () => !(await dialogOpen()), 'dialog cancelled', 4000);
    await waitFor(() => !views.isOverlay(), 'overlay released after cancel', 4000);
  };
  const f3 = async (/** @type {'ui' | 'site'} */ from) => {
    if (from === 'site') {
      const wc = wcOf('a1');
      wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'F3' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'F3' });
    } else {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F3' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F3' });
    }
  };
  await waitFor(() => loaded('a1'), 'a1 shown for F3');
  await f3('site');
  await waitFor(dialogOpen, 'F3 from a site', 4000).catch(() => {});
  check('F3 from inside a site opens the editor of the item shown in the pane', (await dialogTitle()) === 'Edit Alpha one', await dialogTitle());
  await cancelDialog();
  await ui("[...document.querySelectorAll('#list .section-head')].find((h) => h.textContent.includes('Checks')).focus()");
  await f3('ui');
  await waitFor(dialogOpen, 'F3 on a group row', 4000).catch(() => {});
  check('F3 on a focused group row opens the group editor', (await dialogTitle()) === 'Rename group' && (await ui("document.getElementById('f-name').value")) === 'Checks', await dialogTitle());
  await cancelDialog();
  await ui("[...document.querySelectorAll('#list .row')].find((r) => r.querySelector('.name').textContent === 'Alpha two').focus()");
  await f3('ui');
  await waitFor(dialogOpen, 'F3 on an item row', 4000).catch(() => {});
  check('F3 on a focused list row (not the pane item) opens that item', (await dialogTitle()) === 'Edit Alpha two', await dialogTitle());
  await cancelDialog();
  await ui("document.querySelectorAll('#rail .rail-item')[1].focus()");
  await f3('ui');
  await waitFor(dialogOpen, 'F3 on a rail entry', 4000).catch(() => {});
  check('F3 on a focused workspace rail entry opens the workspace editor', (await dialogTitle()) === 'Edit Beta', await dialogTitle());
  await cancelDialog();
  await ui('document.activeElement?.blur()');
  await f3('ui');
  await waitFor(dialogOpen, 'F3 with nothing focused in the UI', 4000).catch(() => {});
  check('F3 with no UI focus falls back to the pane item', (await dialogTitle()) === 'Edit Alpha one', await dialogTitle());
  await cancelDialog();
  await br("setLayout('ws-a', {type: 'leaf', paneId: 'p1', itemId: null}, 'p1')");
  await sleepMs(300);
  await ui('document.activeElement?.blur()');
  await f3('ui');
  await sleepMs(600);
  check('F3 with nothing selected does nothing', !(await dialogOpen()));
  await br("setLayout('ws-a', {type: 'leaf', paneId: 'p1', itemId: 'a1'}, 'p1')");
  await waitFor(() => loaded('a1'), 'a1 shown again after F3 tests');
  // add: an invalid save is rejected
  await ui("document.querySelector('#list .list-foot button[title=\"Add item\"]').click()");
  await waitFor(dialogOpen, 'item dialog');
  check('while a dialog is open the native views are taken off the window (overlay)', await waitFor(() => views.isOverlay(), 'overlay', 3000).then(() => true, () => false));
  await shot('05-item-editor');
  check('the item editor names the switch "Extend short logins" and explains it', (await ui("(() => { const f = document.getElementById('f-persistSessionCookies').closest('.field'); return f.textContent.includes('Extend short logins') && f.textContent.includes('Only affects logins a site would end when the app closes; a site\u2019s own long-lived logins are unaffected.'); })()")) === true);
  await setField('name', 'Smoke added');
  await submit();
  await sleepMs(300);
  const err = await ui("document.querySelector('#dialog .field.invalid .error')?.textContent ?? null");
  check('empty URL: the form shows the URL error and nothing is saved', err === 'Required' && !byName('Smoke added') && (await dialogOpen()), err);
  await setField('url', 'ftp://nope');
  await submit();
  await sleepMs(300);
  check('a non-http address is rejected inline', (await ui("document.querySelector('#dialog .field.invalid .error')?.textContent")) === 'Enter an http:// or https:// address' && !byName('Smoke added'));
  await setField('url', `${smoke.local}/page/added`);
  await setField('scheduleType', 'weekly');
  await setField('uaPreset', 'custom');
  await submit();
  await sleepMs(300);
  check('custom UA without a string is rejected inline', (await ui("document.getElementById('f-uaCustom').closest('.field').classList.contains('invalid')")) === true && !byName('Smoke added'));
  await setField('uaPreset', 'firefox');
  await setField('scheduleType', 'none');
  await submit();
  await waitFor(async () => !(await dialogOpen()), 'dialog closed');
  const added = byName('Smoke added');
  const listed = await waitFor(() => ui("[...document.querySelectorAll('#list .row .name')].some(n => n.textContent === 'Smoke added')"), 'new item listed', 4000).then(() => true, () => false);
  check('a valid item is saved and appears in the list', Boolean(added) && listed, added && added.id);
  check('the overlay is released after the dialog closes', await waitFor(() => !views.isOverlay(), 'overlay off', 3000).then(() => true, () => false));
  check('the UA preset was saved', added && added.userAgent.preset === 'firefox', added && added.userAgent);

  // edit + move to another workspace
  ctx.api.sendCommand({ type: 'edit-item', itemId: added.id });
  await waitFor(dialogOpen, 'edit dialog');
  check('the edit dialog shows the item\'s values', (await ui("document.getElementById('f-name').value")) === 'Smoke added' && (await ui("document.getElementById('f-uaPreset').value")) === 'firefox');
  await setField('name', 'Smoke edited');
  await setField('workspaceId', 'ws-b');
  await submit();
  await waitFor(async () => !(await dialogOpen()), 'edit closed');
  const edited = items().find((/** @type {any} */ i) => i.id === added.id);
  check('edited and moved: same id, new workspace, group cleared', edited.name === 'Smoke edited' && edited.workspaceId === 'ws-b' && edited.groupId === null, edited);

  // delete with confirmation
  smoke.dialogCalls.length = 0;
  smoke.dialogAnswers.push(1); // Cancel
  ctx.api.sendCommand({ type: 'delete', kind: 'item', id: added.id });
  await waitFor(() => smoke.dialogCalls.length === 1, 'delete confirm', 4000);
  await sleepMs(200);
  check('delete asks first; Cancel keeps the item', smoke.dialogCalls[0].message === 'Delete item "Smoke edited"?' && !items().find((/** @type {any} */ i) => i.id === added.id).deleted, smoke.dialogCalls[0]);
  smoke.dialogAnswers.push(0);
  ctx.api.sendCommand({ type: 'delete', kind: 'item', id: added.id });
  await waitFor(() => items().find((/** @type {any} */ i) => i.id === added.id).deleted === true, 'deleted', 4000);
  check('confirming deletes the item (tombstone)', true);

  // drag and drop: reorder inside "Other", and drop on a pane edge to split
  await br("selectWorkspace('ws-a')");
  await waitFor(() => ui("document.querySelector('#list .list-title')?.textContent === 'Alpha'"), 'Alpha list again');
  const dnd = (/** @type {string} */ srcName, /** @type {string} */ dstSel, /** @type {number} */ fx, /** @type {number} */ fy) =>
    ui(`(async () => {
      const src = [...document.querySelectorAll('#list .row')].find(r => r.querySelector('.name').textContent === ${JSON.stringify(srcName)});
      const dst = document.querySelector(${JSON.stringify(dstSel)}) ?? [...document.querySelectorAll('#list .row')].find(r => r.querySelector('.name').textContent === ${JSON.stringify(dstSel)});
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', {bubbles: true, dataTransfer: dt}));
      await new Promise(r => setTimeout(r, 80));
      const r = dst.getBoundingClientRect();
      const at = {bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width * ${fx}, clientY: r.top + r.height * ${fy}};
      dst.dispatchEvent(new DragEvent('dragover', at));
      dst.dispatchEvent(new DragEvent('drop', at));
      src.dispatchEvent(new DragEvent('dragend', {bubbles: true, dataTransfer: dt}));
      return true;
    })()`);
  const otherOrder = () => items().filter((/** @type {any} */ i) => i.workspaceId === 'ws-a' && i.groupId === null && !i.deleted).sort((/** @type {any} */ a, /** @type {any} */ b) => a.order - b.order).map((/** @type {any} */ i) => i.name);
  check('before the drag: Other = two, iso, local', JSON.stringify(otherOrder()) === JSON.stringify(['Alpha two', 'Alpha iso', 'Alpha local']), otherOrder());
  await dnd('Alpha local', 'Alpha two', 0.5, 0.1);
  await waitFor(() => otherOrder()[0] === 'Alpha local', 'reordered', 4000).catch(() => {});
  check('dragging the third item above the first makes it first', JSON.stringify(otherOrder()) === JSON.stringify(['Alpha local', 'Alpha two', 'Alpha iso']), otherOrder());
  check('the overlay is released after the drag', await waitFor(() => !views.isOverlay(), 'overlay off after drag', 3000).then(() => true, () => false));
  await br("show('a1')");
  await waitFor(() => loaded('a1'), 'a1 loaded');
  await dnd('Alpha iso', '#panes .pane-body', 0.95, 0.5);
  await waitFor(async () => (await ui("document.querySelectorAll('#panes .pane').length")) === 2, 'split by drop', 6000).catch(() => {});
  check('dropping an item on a pane\'s right edge splits it to the right', Layout.leaves(layoutOf('ws-a')).length === 2 && layoutOf('ws-a').dir === 'row' && layoutOf('ws-a').b.itemId === 'a3', layoutOf('ws-a'));
  await shot('06-drop-split');
  await br("setLayout('ws-a', {type: 'leaf', paneId: 'p1', itemId: 'a1'}, 'p1')");

  // groups and workspaces
  await ui("document.querySelector('#list .list-foot button[title=\"Add group\"]').click()");
  await waitFor(dialogOpen, 'group dialog');
  await setField('name', 'Smoke group');
  await submit();
  await waitFor(async () => !(await dialogOpen()), 'group dialog closed');
  const grp = store.snapshot().groups.find((/** @type {any} */ g) => g.name === 'Smoke group');
  check('a group is added to the active workspace', grp && grp.workspaceId === 'ws-a');
  await waitFor(() => ui("[...document.querySelectorAll('#list .section-head')].some(h => h.textContent.includes('Smoke group'))"), 'group listed', 4000);
  ctx.api.sendCommand({ type: 'edit-group', id: grp.id });
  await waitFor(dialogOpen, 'rename dialog');
  await setField('name', 'Smoke group 2');
  await submit();
  await waitFor(async () => !(await dialogOpen()), 'rename closed');
  check('a group is renamed', store.snapshot().groups.find((/** @type {any} */ g) => g.id === grp.id).name === 'Smoke group 2');
  smoke.dialogAnswers.push(0);
  ctx.api.sendCommand({ type: 'delete', kind: 'group', id: grp.id });
  await waitFor(() => store.snapshot().groups.find((/** @type {any} */ g) => g.id === grp.id).deleted === true, 'group deleted', 4000);
  check('a group is deleted after confirmation', true);

  // the name for items without a group (10.5): a label shows above them, over 40 characters is rejected inline, blank = Default
  ctx.api.sendCommand({ type: 'edit-workspace', id: 'ws-a' });
  await waitFor(dialogOpen, 'workspace edit dialog');
  const otherHead = () => ui("[...document.querySelectorAll('#list .section-head')].map((h) => h.textContent.replace(/\\s+/g, ' ').trim())");
  check('the workspace editor offers "Name for items without a group" (default placeholder)', (await ui("document.getElementById('f-ungroupedLabel').closest('.field').textContent.includes('Name for items without a group')")) === true);
  await setField('ungroupedLabel', 'x'.repeat(41));
  await submit();
  await sleepMs(300);
  check('a label over 40 characters is rejected inline and nothing is saved', (await dialogOpen()) && (await ui("document.getElementById('f-ungroupedLabel').closest('.field').classList.contains('invalid')")) === true && !store.snapshot().workspaces.find((/** @type {any} */ w) => w.id === 'ws-a').ungroupedLabel);
  await setField('ungroupedLabel', 'Loose ends');
  await submit();
  await waitFor(async () => !(await dialogOpen()), 'workspace edit closed');
  await waitFor(async () => (await otherHead()).some((/** @type {string} */ h) => h.includes('Loose ends')), 'label shown', 4000).catch(() => {});
  check('the ungrouped items are listed under the workspace label, not Default', (await otherHead()).some((/** @type {string} */ h) => h.includes('Loose ends')) && !(await otherHead()).some((/** @type {string} */ h) => h.includes('Default')), await otherHead());
  ctx.api.sendCommand({ type: 'edit-workspace', id: 'ws-a' });
  await waitFor(dialogOpen, 'workspace edit dialog again');
  await setField('ungroupedLabel', '');
  await submit();
  await waitFor(async () => !(await dialogOpen()), 'workspace edit closed again');
  await waitFor(async () => (await otherHead()).some((/** @type {string} */ h) => h.includes('Default')), 'default label shown', 4000).catch(() => {});
  check('a blank label goes back to Default', (await otherHead()).some((/** @type {string} */ h) => h.includes('Default')) && store.snapshot().workspaces.find((/** @type {any} */ w) => w.id === 'ws-a').ungroupedLabel === null);
  await ui("document.querySelector('#rail .rail-add').click()");
  await waitFor(dialogOpen, 'workspace dialog');
  await setField('name', 'Gamma');
  await setField('sleepAfterMin', 'x');
  await submit();
  await sleepMs(300);
  check('workspace: a non-numeric sleep time is rejected inline', (await dialogOpen()) && !store.snapshot().workspaces.some((/** @type {any} */ w) => w.name === 'Gamma'));
  await setField('sleepAfterMin', '5');
  await submit();
  await waitFor(async () => !(await dialogOpen()), 'workspace dialog closed');
  const gamma = store.snapshot().workspaces.find((/** @type {any} */ w) => w.name === 'Gamma');
  check('a workspace is added and selected', gamma && gamma.sleepAfterMin === 5 && store.device().activeWorkspaceId === gamma.id);
  await shot('07-three-workspaces');
  smoke.dialogAnswers.push(0);
  ctx.api.sendCommand({ type: 'delete', kind: 'workspace', id: gamma.id });
  await waitFor(() => store.snapshot().workspaces.find((/** @type {any} */ w) => w.id === gamma.id).deleted === true, 'workspace deleted', 4000);
  check('a workspace is deleted after confirmation (the last one is protected)', store.device().activeWorkspaceId !== gamma.id);
  const wsAdd = await br("upsert({workspaces: [{name: 'Gamma', sleepAfterMin: 5}]})");
  check('a workspace named Gamma exists again for the restart check', wsAdd.ok);

  // settings dialog
  await ui("document.querySelector('#rail .rail-gear').click()");
  await waitFor(dialogOpen, 'settings dialog');
  await setField('googleEmail', 'broken');
  await submit();
  await sleepMs(300);
  check('settings: an invalid email is rejected inline', (await dialogOpen()) && store.snapshot().settings.googleEmail === null);
  await setField('googleEmail', 'smoke@example.com');
  await setField('timezone', 'Asia/Tokyo');
  await setField('edgeProfile', 'Profile 4');
  await submit();
  await waitFor(async () => !(await dialogOpen()), 'settings closed');
  check('settings and device settings are saved', store.snapshot().settings.googleEmail === 'smoke@example.com' && store.snapshot().settings.timezone === 'Asia/Tokyo' && store.device().edgeProfile === 'Profile 4');
  await br("saveSettings({timezone: 'UTC'})");

  // leave a state for the restart check: Beta selected, a distinctive item shown
  const keep = await br(`upsert({items: [{workspaceId: 'ws-b', name: 'Smoke persisted', kind: 'web', url: '${smoke.local}/page/persisted'}]})`);
  await br("selectWorkspace('ws-b')");
  await br("setLayout('ws-b', {type: 'leaf', paneId: 'p1', itemId: null}, 'p1')");
  await br(`show('${keep.ids.items[0]}')`);
  await waitFor(() => loaded(keep.ids.items[0]), 'persisted item loaded');
  await sleepMs(1200); // device.json is written synchronously; give cookie flushes a moment
  void win;
}

/** Step 2 after a restart: the changes of step 1 persisted, selection restored. */
export async function phaseRestart(/** @type {any} */ ctx) {
  const { store, ui, check, waitFor, shot } = ctx;
  const { loaded, layoutOf } = helpers(ctx);
  const items = store.snapshot().items;
  const snap = store.snapshot();
  check('restart: Beta is the selected workspace', store.device().activeWorkspaceId === 'ws-b' && (await ui("document.querySelector('#list .list-title')?.textContent")) === 'Beta');
  const persisted = items.find((/** @type {any} */ i) => i.name === 'Smoke persisted');
  check('restart: the item added in step 1 exists', Boolean(persisted));
  check('restart: the last shown item is shown again', Boolean(persisted) && layoutOf('ws-b').itemId === persisted.id, layoutOf('ws-b'));
  await waitFor(() => loaded(persisted.id), 'restored item loads', 15000).catch(() => {});
  check('restart: its site is loaded in the pane', loaded(persisted.id));
  check('restart: the deleted item stays deleted (tombstone)', items.find((/** @type {any} */ i) => i.name === 'Smoke edited')?.deleted === true);
  check('restart: the reorder persisted (Alpha local first in Other)', items.filter((/** @type {any} */ i) => i.workspaceId === 'ws-a' && i.groupId === null && !i.deleted).sort((/** @type {any} */ a, /** @type {any} */ b) => a.order - b.order)[0].name === 'Alpha local');
  check('restart: a workspace added in step 1 is in the rail', (await ui("[...document.querySelectorAll('#rail .rail-item')].map(b => b.getAttribute('aria-label')).includes('Gamma')")) === true);
  check('restart: the deleted workspace and group stay deleted', snap.workspaces.some((/** @type {any} */ w) => w.name === 'Gamma' && w.deleted) && snap.groups.some((/** @type {any} */ g) => g.name === 'Smoke group 2' && g.deleted));
  check('restart: settings persisted (email, device Edge profile)', snap.settings.googleEmail === 'smoke@example.com' && store.device().edgeProfile === 'Profile 4');
  check('restart: today\'s ticks persisted (a1, a5)', ['a1', 'a5'].every((id) => snap.completions.some((/** @type {any} */ c) => c.itemId === id)));
  check('restart: the list width (333) persisted and is applied', store.device().listWidth === 333 && (await ui("Math.round(document.getElementById('list').getBoundingClientRect().width)")) === 333, store.device().listWidth);
  check('restart: the sync check left no secret file and no connection behind', !fs.existsSync(path.join(dataDir, 'sync-secret.bin')) && store.device().sync.baseUrl === null && store.device().sync.clientId === null);
  await ui("document.querySelectorAll('#rail .rail-item')[0].click()");
  await waitFor(() => ui("document.querySelector('#list .list-title')?.textContent === 'Alpha'"), 'Alpha list');
  check('restart: the Alpha workspace remembers its last shown item', Boolean(layoutOf('ws-a')) && layoutOf('ws-a').itemId === 'a1', layoutOf('ws-a'));
  // icons captured in step 1 are still there (per PC, in data\icons) and drawn in the list
  const iconState = await ui('window.fruitery.getState()');
  await waitFor(() => ui("!!document.querySelector('#list .row[data-edit-id=\"a1\"] .icon img')"), 'icon drawn after the restart', 6000).catch(() => {});
  check('restart: the site icon captured before is still saved and drawn in the list', (iconState.iconRevs.a1 ?? 0) > 0 && fs.existsSync(path.join(dataDir, 'icons', 'a1.png')) && (await ui("!!document.querySelector('#list .row[data-edit-id=\"a1\"] .icon img')")) === true, iconState.iconRevs);
  await shot('08-after-restart');
}
