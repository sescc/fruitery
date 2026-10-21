// @ts-check
// Phone checklist UI: fetches the snapshot, renders it with plain DOM APIs (text nodes only, never
// innerHTML), ticks optimistically through the API and reverts on failure. Data is always live.
// Local storage holds only (a) a reload guard in sessionStorage and (b) the last successfully
// loaded snapshot in localStorage, shown greyed out ("as of ...") when the app starts offline.
// A 403 from the API deletes that stored snapshot.

import { mergeLww } from './core/index.js';
import { createEditor } from './editor.js';
import { SNAPSHOT_KEY, buildView, dayProgress, letterOf, restoreSnapshot, serializeSnapshot, withTick, withoutTick } from './view.js';

/** @typedef {import('./view.js').Snapshot} Snapshot */
/** @typedef {import('./view.js').ItemView} ItemView */

const RELOAD_GUARD_KEY = 'fruitery:login-reload-at';
const RELOAD_GUARD_MS = 30_000;
const RENDER_EVERY_MS = 60_000;
const EDIT_NEEDS_CONNECTION = 'Editing needs a connection';

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const appEl = el('app');
const summaryEl = el('summary');
const offlineEl = el('offline');
const asOfEl = el('asof');
const toastEl = el('toast');
const editToggle = el('edit-toggle');

/** @type {Snapshot | null} last snapshot loaded from the server (or restored from storage) */
let snapshot = null;
/** @type {number | null} when `snapshot` was loaded from the server (epoch ms) */
let loadedAt = null;
/** False after a failed request while the browser believes it is online. */
let apiReachable = true;
/** Set when the server refused us in a way a reload cannot fix. */
let denied = false;
/** The API's reason code for a 403 (a code only, safe to show), if it gave one. */
let deniedReason = '';
/** True while the snapshot on screen is the stored copy from an earlier visit, not a fresh server answer. */
let fromStored = false;
/** Edit mode (needs a connection and a fresh snapshot). */
let editing = false;
/** @type {Set<string>} items with a request in flight */
const busy = new Set();
/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;

const isOffline = () => !navigator.onLine || !apiReachable;

/**
 * @param {string} tag
 * @param {Record<string, string> | null} attrs
 * @param {...(Node | string)} children
 * @returns {HTMLElement}
 */
function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

/** @param {string} message */
function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 5000);
}

/**
 * Reload into the Access login, at most once per 30 s so a broken login cannot loop.
 * @returns {boolean} whether a reload was started
 */
function reloadForLogin() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    return false; // no sessionStorage: never risk a reload loop
  }
  location.reload();
  return true;
}

/** @param {Response} res */
const looksLikeLogin = (res) => res.redirected || res.status === 401 || res.status === 403 || !(res.headers.get('content-type') ?? '').includes('json');

/**
 * A request failed while the browser says it is online: find out whether the Access session has
 * expired (the API answers with a redirect, which `redirect: 'manual'` exposes as opaque) or the
 * network/API is simply unreachable.
 */
async function diagnoseFailure() {
  if (!navigator.onLine) return;
  try {
    const probe = await fetch('/api/state', { redirect: 'manual', cache: 'no-store', credentials: 'same-origin' });
    if (probe.type === 'opaqueredirect' && reloadForLogin()) return;
  } catch {
    // network failure: fall through to offline
  }
  apiReachable = false;
}

/**
 * The reason code of a 403 that came from our own API (JSON body {error, reason}), else ''.
 * @param {Response} res
 * @returns {Promise<string>}
 */
async function denialReason(res) {
  if (res.status !== 403 || !(res.headers.get('content-type') ?? '').includes('json')) return '';
  try {
    const body = await res.clone().json();
    return typeof body?.reason === 'string' && /^[a-z.-]{1,40}$/.test(body.reason) ? body.reason : '';
  } catch {
    return '';
  }
}

/** Remember the current (server-confirmed) snapshot for offline cold starts. Storage may be unavailable or full: ignore. */
function saveSnapshot() {
  if (!snapshot) return;
  loadedAt = Date.now();
  try {
    localStorage.setItem(SNAPSHOT_KEY, serializeSnapshot(snapshot, loadedAt));
  } catch {
    // no storage: the app just has no offline cold start
  }
}

function clearStoredSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // nothing to clear
  }
}

/**
 * Show the stored snapshot when nothing is loaded yet.
 * @returns {boolean} whether one was restored
 */
function useStoredSnapshot() {
  if (snapshot) return false;
  let stored = null;
  try {
    stored = restoreSnapshot(localStorage.getItem(SNAPSHOT_KEY));
  } catch {
    // storage unavailable
  }
  if (!stored) return false;
  snapshot = stored.snapshot;
  loadedAt = stored.savedAt;
  fromStored = true;
  return true;
}

/**
 * The API said 403: this identity is not allowed. Forget everything stored and show only the denial.
 * @param {string} reason a reason code, or ''
 */
function showDenied(reason) {
  clearStoredSnapshot();
  snapshot = null;
  loadedAt = null;
  denied = true;
  deniedReason = reason;
}

/** Load the snapshot from the server and render. */
async function loadState() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' } });
    const reason = await denialReason(res);
    if (reason) {
      // our Worker refused this identity: a reload into the login cannot fix that, so say why
      showDenied(reason);
      render();
      return;
    }
    if (res.status === 403) clearStoredSnapshot();
    if (looksLikeLogin(res)) {
      if (!reloadForLogin()) showDenied('');
      render();
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    snapshot = /** @type {Snapshot} */ (await res.json());
    apiReachable = true;
    denied = false;
    deniedReason = '';
    fromStored = false;
    saveSnapshot();
  } catch {
    await diagnoseFailure();
    useStoredSnapshot(); // cold start offline (or the API is down): show the last loaded list, greyed
  }
  render();
}

/**
 * `PUT /api/entities` for the editor. Resolves with the status and JSON body; rejects when there is no
 * usable answer (network failure, or a login page instead of JSON).
 * @param {Record<string, unknown>} body
 * @returns {Promise<{status: number, json: any}>}
 */
async function putEntities(body) {
  const res = await fetch('/api/entities', {
    method: 'PUT',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 403) {
    showDenied(await denialReason(res));
    editing = false;
    render();
    return { status: 403, json: null };
  }
  if (looksLikeLogin(res)) throw new Error('session');
  return { status: res.status, json: await res.json() };
}

/**
 * Merge what the server stored (last-write-wins, as it decided) into memory, keep the offline copy
 * current (D81), and re-render.
 * @param {any} winners `{workspaces?, groups?, items?, settings?}` from `PUT /api/entities`
 */
function applyEntities(winners) {
  if (!snapshot) return;
  snapshot = {
    ...snapshot,
    workspaces: mergeLww(snapshot.workspaces, winners.workspaces ?? []),
    groups: mergeLww(snapshot.groups, winners.groups ?? []),
    items: mergeLww(snapshot.items, winners.items ?? []),
    settings: winners.settings ? mergeLww([snapshot.settings ?? winners.settings], [winners.settings])[0] : snapshot.settings,
  };
  saveSnapshot();
  render();
}

const editor = createEditor({
  snapshot: () => snapshot,
  put: putEntities,
  applyEntities,
  toast,
  confirm: (message) => window.confirm(message),
  networkFailed: () => {
    void diagnoseFailure().then(render);
  },
  now: () => Date.now(),
  randomUUID: () => crypto.randomUUID(),
});

/** Editing is only possible with a connection and a fresh snapshot (not the stored copy). */
const canEdit = () => snapshot !== null && !denied && !isOffline() && !fromStored;

/**
 * Tick or untick an item: optimistic, confirmed by the server's answer, reverted on failure.
 * @param {string} itemId
 * @param {boolean} wantDone
 */
async function toggle(itemId, wantDone) {
  if (!snapshot || isOffline() || busy.has(itemId)) return;
  const before = snapshot;
  const now = Date.now();
  snapshot = wantDone ? withTick(before, itemId, now) : withoutTick(before, itemId, now);
  busy.add(itemId);
  render();
  try {
    const res = await fetch(wantDone ? '/api/ticks' : `/api/ticks/${encodeURIComponent(itemId)}`, {
      method: wantDone ? 'POST' : 'DELETE',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(wantDone ? { 'content-type': 'application/json' } : {}) },
      body: wantDone ? JSON.stringify({ itemId }) : undefined,
    });
    if (res.status === 403) {
      showDenied(await denialReason(res));
      return;
    }
    if (looksLikeLogin(res)) throw new Error('session');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (wantDone && snapshot) {
      // the server decided the period and the time: use its answer
      snapshot = {
        ...snapshot,
        completions: [...snapshot.completions.filter((c) => !(c.itemId === body.itemId && c.periodKey === body.periodKey)), body],
      };
    }
    saveSnapshot();
  } catch (err) {
    // revert only this item's ticks to what they were
    if (snapshot) {
      snapshot = {
        ...snapshot,
        completions: [...snapshot.completions.filter((c) => c.itemId !== itemId), ...before.completions.filter((c) => c.itemId === itemId)],
      };
    }
    toast('Could not save that tick. It has been put back.');
    if (err instanceof TypeError || (err instanceof Error && err.message === 'session')) {
      await diagnoseFailure();
    }
  } finally {
    busy.delete(itemId);
    render();
  }
}

/**
 * 'YYYY-MM-DD' as a short local-looking date ("Mon, 12 Oct").
 * @param {string | null} date
 * @returns {string}
 */
function formatDay(date) {
  if (!date) return '';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** @type {Map<string, 'ok' | 'bad'>} icon addresses seen to load or to fail in this page (a re-render must not flash the letter or ask again) */
const iconSeen = new Map();

/**
 * The item's icon (D116): its typed emoji or letter; else the site's own icon, loaded lazily straight from the
 * site without a referrer, with the first letter underneath as the fallback while it loads or when it fails.
 * @param {{name: string, icon: string | null, iconUrl: string | null}} item
 * @returns {HTMLElement}
 */
function iconNode(item) {
  if (item.icon) return h('span', { class: 'icon text', 'aria-hidden': 'true' }, item.icon);
  const letter = h('span', { class: 'letter' }, letterOf(item.name));
  const wrap = h('span', { class: 'icon', 'aria-hidden': 'true' }, letter);
  const url = item.iconUrl;
  if (!url || iconSeen.get(url) === 'bad') return wrap;
  const img = document.createElement('img');
  img.alt = '';
  img.width = 24;
  img.height = 24;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('load', () => {
    if (img.naturalWidth > 0) {
      iconSeen.set(url, 'ok');
      wrap.classList.add('loaded');
    } else {
      iconSeen.set(url, 'bad');
      img.remove();
    }
  });
  img.addEventListener('error', () => {
    iconSeen.set(url, 'bad');
    img.remove();
  });
  if (iconSeen.get(url) === 'ok') wrap.classList.add('loaded');
  img.src = url;
  wrap.append(img);
  return wrap;
}
/**
 * @param {ItemView} item
 * @returns {HTMLElement}
 */
function nameNode(item) {
  if (item.href) {
    return h('a', { class: 'name', href: item.href, target: '_blank', rel: 'noopener noreferrer' }, item.name);
  }
  const node = h('span', { class: 'name' }, item.name);
  if (item.hint === 'set-google-email') {
    node.append(h('br', null), h('span', { class: 'hint' }, 'Set your Google email in settings to open this.'));
  }
  return node;
}

/**
 * @param {ItemView} item
 * @returns {HTMLElement}
 */
function itemNode(item) {
  if (item.bucket === 'link') {
    // an unscheduled item: a link marker where a check-in has its tick circle, and no tick (not counted anywhere)
    return h('li', { class: 'item link' }, h('span', { class: 'link-mark', 'aria-hidden': 'true' }, '↗'), iconNode(item), nameNode(item));
  }
  const checked = item.bucket === 'done';
  const input = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', 'data-item-id': item.id, 'aria-label': `Mark ${item.name} as done` }));
  input.checked = checked;
  input.disabled = isOffline() || busy.has(item.id);
  input.addEventListener('change', () => void toggle(item.id, input.checked));
  return h('li', { class: checked ? 'item done' : 'item' }, h('label', { class: 'check' }, input), iconNode(item), nameNode(item));
}

/**
 * @param {ItemView} item
 * @returns {HTMLElement}
 */
function notDueNode(item) {
  return h('li', { class: 'item' }, iconNode(item), nameNode(item), h('span', { class: 'next' }, `Next: ${formatDay(item.nextDue)}`));
}

/**
 * @param {number} ms epoch ms
 * @returns {string} local date and time, e.g. "14 Oct 2026, 09:30"
 */
function formatStamp(ms) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function render() {
  if (editor.isDragging()) return; // never rebuild the list under a finger that is dragging a row
  if (editing && !canEdit()) {
    editing = false; // went offline, or the stored copy is on screen; an open form stays so typed text is not lost
    toast(EDIT_NEEDS_CONNECTION);
  }
  offlineEl.hidden = !isOffline();
  asOfEl.hidden = true;
  editToggle.hidden = denied || snapshot === null;
  // aria-disabled (not disabled) so a tap still arrives and can explain itself with a toast
  editToggle.setAttribute('aria-disabled', String(!editing && !canEdit()));
  editToggle.title = canEdit() || editing ? (editing ? 'Done editing' : 'Edit') : EDIT_NEEDS_CONNECTION;
  editToggle.setAttribute('aria-pressed', String(editing));
  editToggle.classList.toggle('on', editing);
  appEl.classList.toggle('stale', isOffline() && snapshot !== null);
  const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.itemId : undefined;

  if (!snapshot) {
    summaryEl.textContent = '';
    const message = h('p', { class: denied ? 'empty error' : 'empty' }, denied ? 'Signed out or not allowed. Reload to sign in again.' : isOffline() ? 'No connection yet.' : 'Loading...');
    if (denied && deniedReason) message.append(h('br', null), h('small', null, `(reason: ${deniedReason})`));
    appEl.replaceChildren(message);
    return;
  }

  if (isOffline() && loadedAt !== null) {
    asOfEl.textContent = `as of ${formatStamp(loadedAt)}`;
    asOfEl.hidden = false;
  }
  if (editing) {
    summaryEl.textContent = 'Editing: changes save as you go';
    appEl.replaceChildren(...editor.renderEdit(snapshot));
    return;
  }
  const view = buildView(snapshot, Date.now());
  const progress = dayProgress(view);
  summaryEl.textContent = progress.complete ? 'Basket full \u{1F9FA}' : progress.total === 0 ? 'Nothing to pick today' : `${progress.done}/${progress.total} picked`;

  if (view.workspaces.length === 0) {
    appEl.replaceChildren(h('p', { class: 'empty' }, 'No checklist items on this device.'));
    return;
  }

  appEl.replaceChildren(
    ...view.workspaces.map((ws) => {
      const section = h('section', { class: 'workspace' }, h('h2', null, ws.name));
      for (const g of ws.groups) {
        section.append(
          h(
            'div',
            { class: 'group' },
            // a group of only links has no check-ins to count, so no progress figure
            h('h3', null, h('span', null, g.name), ...(g.progress.total > 0 ? [h('span', { class: 'progress' }, `${g.progress.done}/${g.progress.total}`)] : [])),
            h('ul', { class: 'items' }, ...g.items.map(itemNode)),
          ),
        );
      }
      if (ws.notDue.length > 0) {
        section.append(h('details', { class: 'notdue' }, h('summary', null, `Not due (${ws.notDue.length})`), h('ul', { class: 'items' }, ...ws.notDue.map(notDueNode))));
      }
      return section;
    }),
  );

  if (focusedId) /** @type {HTMLElement | null} */ (appEl.querySelector(`input[data-item-id="${CSS.escape(focusedId)}"]`))?.focus();
}

// ----- start -----

window.addEventListener('online', () => {
  apiReachable = true;
  void loadState();
});
window.addEventListener('offline', render);
editToggle.addEventListener('click', () => {
  if (editing) editing = false;
  else if (canEdit()) editing = true;
  else {
    toast(EDIT_NEEDS_CONNECTION);
    return;
  }
  editor.closeSheet();
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void loadState();
});
setInterval(render, RENDER_EVERY_MS);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // the app works without it; only the cached shell is lost
  });
}

// cold start without a connection: show the last loaded list straight away (greyed, ticking disabled)
if (!navigator.onLine) useStoredSnapshot();
render();
void loadState();
