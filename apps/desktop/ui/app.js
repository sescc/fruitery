// @ts-check
// Fruitery UI: workspace rail + item list + panes (layout A, D9). The UI owns layout math; main owns
// the native site views and positions them in the pane boxes this UI reports.

import { bucket } from '../../../packages/core/index.js';
import { liveWorkspaces, listModel, nextDueForItem, cycle, layoutOrDefault, editTarget, shouldOfferTick } from '../lib/viewmodel.js';
import { normalizeAddress, addressErrorText, createClickDecider } from '../lib/address.js';
import * as Layout from '../lib/layout.js';
import { clampListWidth, DEFAULT_LIST_WIDTH } from '../lib/list-width.js';
import { renderRail } from './rail.js';
import { renderList } from './list.js';
import { renderPanes } from './panes.js';
import { openItemEditor, openWorkspaceEditor, openGroupEditor, openSettings } from './editor.js';
import { openPanel } from './dialogs.js';
import { h } from './dom.js';
import { syncLabel, createSyncingGate, tickNotice, describeRejected, describeDroppedTick, TICKS_HELD_TEXT } from '../lib/sync-label.js';

const api = /** @type {any} */ (window).fruitery;

/** @typedef {ReturnType<typeof makeCtx>} Ctx */

function makeCtx() {
  /** @type {any} */
  const ctx = {
    api,
    /** @type {any} */
    state: null,
    ui: {
      notDueOpen: false,
      /** @type {{kind: 'item' | 'group' | 'workspace', id: string} | null} */
      drag: null,
      /** @type {import('../lib/layout.js').Layout | null} */
      treeOverride: null,
      listDrag: false,
      lastRects: '',
      /** The pane whose title is being edited as an address (kept here, not in the DOM: the pane header is rebuilt on every state change). */
      /** @type {{paneId: string, itemId: string, text: string, error: string, fresh: boolean} | null} */
      addrEdit: null,
      /** @type {Map<string, {rev: number, url: string | null}>} item id -> site icon (data URL) fetched for that revision */
      iconCache: new Map(),
      /** @type {Set<string>} `<id>:<rev>` fetches in flight */
      iconPending: new Set(),
      /** What the sync chip shows now (computed at the start of every render). @type {import('../lib/sync-label.js').SyncLabel | null} */
      syncLabel: null,
      /** Redraws the open "Needs attention" panel, if any. @type {(() => void) | null} */
      panelRefresh: null,
    },
    /** @type {any} */
    actions: {},
  };

  ctx.snap = () => ctx.state.snapshot;
  ctx.workspaces = () => liveWorkspaces(ctx.snap());
  ctx.activeWorkspaceId = () => {
    const id = ctx.state.device.activeWorkspaceId;
    const all = ctx.workspaces();
    return all.some((/** @type {any} */ w) => w.id === id) ? id : (all[0]?.id ?? null);
  };
  ctx.activeWorkspace = () => ctx.workspaces().find((/** @type {any} */ w) => w.id === ctx.activeWorkspaceId()) ?? null;
  ctx.model = () => listModel(ctx.snap(), ctx.activeWorkspaceId(), ctx.state.now);
  ctx.itemById = (/** @type {string | null} */ id) => (id ? ctx.snap().items.find((/** @type {any} */ i) => i.id === id && !i.deleted) ?? null : null);
  ctx.tree = () => ctx.ui.treeOverride ?? layoutOrDefault(ctx.state.device, ctx.activeWorkspaceId());
  ctx.focusedPaneId = () => {
    const tree = ctx.tree();
    const f = ctx.state.device.focusedPaneByWorkspace[ctx.activeWorkspaceId()];
    return f && Layout.findPane(tree, f) ? f : Layout.leaves(tree)[0].paneId;
  };
  /** Why ticking is off right now (text for the list notice and the toast), or null when it works. */
  ctx.tickNotice = () => tickNotice(ctx.state.sync, ctx.state.ticksEnabled);
  ctx.bucketOf = (/** @type {any} */ item) => bucket(item, ctx.snap().completions, ctx.state.now, ctx.snap().settings.timezone);

  /**
   * A message beside the item list (native site views paint above the rest of the window, so a toast
   * anywhere else could be hidden behind a page). It fades out after `ms`.
   * @param {string} message
   * @param {{label: string, run: () => void} | null} [action]
   * @param {number} [ms] how long it stays (default 4 s, 7 s with a button)
   */
  ctx.toast = (message, action = null, ms = action ? 7000 : 4000) => {
    const el = /** @type {HTMLElement} */ (document.getElementById('toast'));
    el.replaceChildren(message);
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.setAttribute('aria-label', action.label === '✓' ? 'Mark done' : action.label);
      b.addEventListener('click', () => { el.classList.remove('show'); action.run(); });
      el.append(b);
    }
    el.classList.add('show');
    clearTimeout(/** @type {any} */ (ctx).toastTimer);
    ctx.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  };

  /**
   * An item's saved site icon as a data URL, or null. The state only carries a revision number per icon;
   * the image is fetched once per revision and the UI renders again when it arrives.
   * @param {string} itemId
   * @returns {string | null}
   */
  ctx.iconSrc = (itemId) => {
    const rev = ctx.state?.iconRevs?.[itemId] ?? 0;
    if (!rev) return null;
    const cached = ctx.ui.iconCache.get(itemId);
    if (cached && cached.rev === rev) return cached.url;
    const key = `${itemId}:${rev}`;
    if (!ctx.ui.iconPending.has(key)) {
      ctx.ui.iconPending.add(key);
      api.getIcon(itemId).then((/** @type {string | null} */ url) => {
        ctx.ui.iconCache.set(itemId, { rev, url: typeof url === 'string' ? url : null });
        ctx.ui.iconPending.delete(key);
        ctx.render();
      }).catch(() => ctx.ui.iconPending.delete(key));
    }
    return cached ? cached.url : null;
  };

  /** Changes whenever what the list shows for an item's icon changes (part of the list's render signature). @param {string} itemId */
  ctx.iconKey = (itemId) => `${ctx.state?.iconRevs?.[itemId] ?? 0}:${ctx.ui.iconCache.get(itemId)?.rev ?? 0}`;

  /** Persist a layout for the active workspace, focusing a pane. */
  ctx.setLayout = async (/** @type {import('../lib/layout.js').Layout} */ tree, /** @type {string | null} */ focus) => {
    ctx.ui.treeOverride = null;
    return api.setLayout(ctx.activeWorkspaceId(), tree, focus);
  };
  return ctx;
}

const ctx = makeCtx();

function openSettingsDialog() {
  return openSettings(ctx);
}

/** @param {any} res result of api.show */
function handleOpenResult(res) {
  if (res.ok) return true;
  if (res.blocked === 'missing-google-email') {
    ctx.toast('Set your Google email in Settings to open this item.', { label: 'Settings', run: openSettingsDialog });
  } else if (res.blocked === 'unknown-token') {
    ctx.toast(`This address uses an unknown placeholder${res.tokens?.length ? ` (${res.tokens.join(', ')})` : ''}. Edit the item.`);
  } else if (res.blocked === 'invalid-timezone') {
    ctx.toast('Check the timezone in Settings.', { label: 'Settings', run: openSettingsDialog });
  } else if (res.blocked) {
    ctx.toast('This item has no address to open. Edit the item.');
  } else if (res.error === 'max-panes') {
    ctx.toast('Up to 4 panes per workspace');
  } else if (res.kind === 'edge') {
    ctx.toast('Could not start Microsoft Edge.');
  } else if (res.declined) {
    ctx.toast('The program was not started.');
  } else if (res.kind === 'app') {
    ctx.toast('Could not start the program.');
  } else {
    ctx.toast('Could not open this item.');
  }
  return false;
}

const actions = ctx.actions;

actions.selectWorkspace = async (/** @type {string} */ id) => {
  ctx.ui.treeOverride = null;
  await api.selectWorkspace(id);
};

/**
 * @param {string} itemId
 * @param {string | null} [paneId]
 * @param {{split?: {dir: 'row' | 'col', side?: 'before' | 'after'}} | null} [opts]
 */
actions.showItem = async (itemId, paneId = null, opts = null) => {
  const res = await api.show(itemId, paneId, opts);
  return handleOpenResult(res);
};

/**
 * A tick the main process refused because ticking needs the Worker: say so, the same words as the list notice.
 * @param {any} res result of api.tick / api.untick
 * @returns {boolean} true when it was refused
 */
function tickRefused(res) {
  if (res?.error !== 'ticks-need-connection') return false;
  ctx.toast(tickNotice(ctx.state.sync, false) ?? 'Ticking needs a connection');
  return true;
}

actions.tick = async (/** @type {string} */ id) => { tickRefused(await api.tick(id)); };
actions.untick = async (/** @type {string} */ id) => { tickRefused(await api.untick(id)); };

actions.focusPane = async (/** @type {string} */ paneId) => {
  if (ctx.focusedPaneId() === paneId) return;
  // only ids go to main: a focus change never carries the UI's (possibly stale) tree (D131)
  await api.focusPane(ctx.activeWorkspaceId(), paneId);
};

/**
 * D119: Done ticks the item and moves straight on to the next due item of its workspace (list order), in
 * the same pane; with nothing else due it says "Basket full" and stays. No question is ever asked.
 * @param {string} paneId
 * @param {any} item
 */
async function markDoneAndAdvance(paneId, item) {
  const target = nextDueForItem(ctx.snap(), item.id, ctx.state.now);
  if (tickRefused(await api.tick(item.id))) return; // not ticked: stay on this item
  if (target) await actions.showItem(target, paneId);
  else ctx.toast('Basket full 🧺');
}
actions.done = markDoneAndAdvance;

/**
 * Next: the next due item, without ticking anything; "No more due items" when nothing else is due.
 * @param {string} paneId
 * @param {any} item
 */
async function showNextDue(paneId, item) {
  const target = nextDueForItem(ctx.snap(), item.id, ctx.state.now);
  if (!target) {
    ctx.toast('No more due items');
    return;
  }
  await actions.showItem(target, paneId);
}
actions.next = showNextDue;

/** Copy the address a pane shows (a single click on its title). @param {string} paneId */
actions.copyPaneAddress = async (paneId) => {
  const itemId = Layout.findPane(ctx.tree(), paneId)?.itemId;
  if (!itemId) return;
  const r = await api.copyAddress(itemId);
  if (r.ok) ctx.toast(r.url, null, 1000);
  else ctx.toast('No page address to copy yet', null, 2000);
};

/** Open the page a pane shows in Microsoft Edge. @param {string} itemId */
actions.openPageInEdge = async (itemId) => {
  const r = await api.openPageInEdge(itemId);
  if (r.ok) return;
  ctx.toast(r.error === 'no-address' ? 'No page address to open yet' : 'Could not start Microsoft Edge.', null, 3000);
};

/** A double click on a pane's title: show its address as an editable field. @param {string} paneId */
actions.editPaneAddress = (paneId) => {
  const itemId = Layout.findPane(ctx.tree(), paneId)?.itemId;
  if (!itemId) return;
  ctx.ui.addrEdit = { paneId, itemId, text: ctx.state.viewStates[itemId]?.url ?? '', error: '', fresh: true };
  ctx.render();
};

/** Back to the title without navigating (Escape, or leaving the field). */
actions.cancelAddressEdit = () => {
  if (!ctx.ui.addrEdit) return;
  ctx.ui.addrEdit = null;
  ctx.render();
};

/** Enter in the address field: load the address in the same pane, or show why not. */
async function submitAddress() {
  const edit = ctx.ui.addrEdit;
  if (!edit) return;
  const parsed = normalizeAddress(edit.text);
  if (!parsed.ok) {
    edit.error = addressErrorText(parsed.error);
    ctx.render();
    return;
  }
  const res = await api.navigateTo(edit.itemId, edit.text);
  if (ctx.ui.addrEdit !== edit) return;
  if (!res.ok) {
    edit.error = res.error === 'not-loaded' ? 'The page is not loaded yet' : addressErrorText(res.error);
    ctx.render();
    return;
  }
  ctx.ui.addrEdit = null;
  ctx.render();
}
actions.submitAddress = submitAddress;

/** Single click vs double click on a pane title; the state lives here because the header is rebuilt often. */
ctx.ui.titleClicks = createClickDecider({
  onSingle: (paneId) => void actions.copyPaneAddress(paneId),
  onDouble: (paneId) => actions.editPaneAddress(paneId),
});

actions.confirmDelete = async (/** @type {'workspace' | 'group' | 'item'} */ kind, /** @type {string} */ id) => {
  const snap = ctx.snap();
  const entity = (kind === 'workspace' ? snap.workspaces : kind === 'group' ? snap.groups : snap.items).find((/** @type {any} */ e) => e.id === id);
  if (!entity) return;
  const detail =
    kind === 'workspace' ? 'Its groups and items are deleted with it.' : kind === 'group' ? 'Its items stay, without a group.' : 'Its history is kept.';
  const r = await api.confirm({ message: `Delete ${kind} "${entity.name}"?`, detail, buttons: ['Delete', 'Cancel'], cancelId: 1 });
  if (r.response !== 0) return;
  const res = await api.remove(kind, id);
  if (res.error === 'last-workspace') ctx.toast('The last workspace cannot be deleted.');
};

actions.addItem = () => openItemEditor(ctx, null);
actions.editItem = (/** @type {string} */ id) => openItemEditor(ctx, id);
actions.addGroup = () => openGroupEditor(ctx, null);
actions.editGroup = (/** @type {string} */ id) => openGroupEditor(ctx, id);
actions.addWorkspace = () => openWorkspaceEditor(ctx, null);
actions.editWorkspace = (/** @type {string} */ id) => openWorkspaceEditor(ctx, id);
actions.openSettings = openSettingsDialog;
actions.openSyncSettings = () => openSettings(ctx, { section: 'sync' });

/**
 * "Fix" in the Needs attention list: open the editor of the rejected entity. Saving re-queues it, which
 * clears the mark; a change whose entity is gone can only be discarded.
 * @param {{kind: string, id: string | null}} r
 */
function fixRejected(r) {
  const snap = ctx.snap();
  if (r.kind === 'settings') return void openSettings(ctx);
  if (r.kind === 'items' && r.id && ctx.itemById(r.id)) return void actions.editItem(r.id);
  if (r.kind === 'groups' && r.id && snap.groups.some((/** @type {any} */ g) => g.id === r.id && !g.deleted)) return void actions.editGroup(r.id);
  if (r.kind === 'workspaces' && r.id && ctx.workspaces().some((/** @type {any} */ w) => w.id === r.id)) return void actions.editWorkspace(r.id);
  ctx.toast('This entry cannot be edited any more. Discard the change.');
}

/** Does anything need the owner's attention? Refused changes, dropped ticks, or a held tick queue. */
const needsAttention = () => Boolean(ctx.state.sync?.rejected?.length || ctx.state.sync?.droppedTicks?.length || ctx.state.sync?.ticksHeld);

/** What needs attention: changes the server refused (Fix / Discard), ticks it refused (Dismiss), and a held tick queue. */
actions.openAttention = () =>
  !needsAttention() ? undefined : openPanel(ctx, {
    title: 'Needs attention',
    build: (body, close) => {
      const draw = () => {
        if (!needsAttention()) {
          close();
          return;
        }
        const sync = ctx.state.sync ?? {};
        const rejected = sync.rejected ?? [];
        const dropped = sync.droppedTicks ?? [];
        body.replaceChildren(
          sync.ticksHeld ? h('div', { class: 'attention-row' }, h('div', { class: 'attention-title' }, 'Ticks are waiting'), h('div', { class: 'hint' }, TICKS_HELD_TEXT)) : null,
          ...dropped.map((/** @type {any} */ n) => {
            const d = describeDroppedTick(n);
            return h(
              'div',
              { class: 'attention-row' },
              h('div', { class: 'attention-title' }, d.title),
              h('ul', { class: 'attention-reasons' }, h('li', {}, d.reason)),
              h('div', { class: 'attention-actions' }, h('button', { type: 'button', class: 'small-btn', onclick: () => { void api.syncDismissTickNotice(n.id); } }, 'Dismiss')),
            );
          }),
          rejected.length > 0 ? h('div', { class: 'hint' }, 'The server refused these changes. They stay on this PC until you fix or discard them; nothing else is held back.') : null,
          ...rejected.map((/** @type {any} */ r) => {
            const d = describeRejected(r);
            return h(
              'div',
              { class: 'attention-row' },
              h('div', { class: 'attention-title' }, d.title),
              h('ul', { class: 'attention-reasons' }, ...d.reasons.map((reason) => h('li', {}, reason))),
              h(
                'div',
                { class: 'attention-actions' },
                h('button', { type: 'button', class: 'small-btn', onclick: () => { close(); fixRejected(r); } }, 'Fix'),
                h('button', {
                  type: 'button',
                  class: 'small-btn',
                  title: 'Drop this change and use the server’s version',
                  onclick: () => { void api.syncDiscard(r.kind, r.id); },
                }, 'Discard'),
              ),
            );
          }),
          h('div', { class: 'attention-actions' }, h('button', { type: 'button', class: 'small-btn', onclick: () => { close(); void actions.openSyncSettings(); } }, 'Sync settings…')),
        );
      };
      draw();
      return draw;
    },
  });
/** The sync chip: the refused changes when there are any, else the Sync settings. */
actions.syncChip = () => (ctx.ui.syncLabel?.attention ? actions.openAttention() : actions.openSyncSettings());

/** @param {any} cmd a command pushed by main (context menu, focus) */
function onCommand(cmd) {
  switch (cmd?.type) {
    case 'edit-item': return void actions.editItem(cmd.itemId);
    case 'edit-workspace': return void actions.editWorkspace(cmd.id);
    case 'edit-group': return void actions.editGroup(cmd.id);
    case 'delete': return void actions.confirmDelete(cmd.kind, cmd.id);
    case 'split': return void actions.showItem(cmd.itemId, null, { split: { dir: cmd.dir === 'col' ? 'col' : 'row', side: 'after' } });
    case 'focus-item': {
      const leaf = Layout.findItem(ctx.tree(), cmd.itemId);
      if (leaf) void actions.focusPane(leaf.paneId);
      return;
    }
    case 'open-failed':
      return void handleOpenResult({ ok: false, blocked: cmd.blocked });
    case 'done-prompt': {
      // D117: an item was opened in Edge or a program and the window is back in front. Ask only about a
      // scheduled item that is still due (checked now: it may have been ticked meanwhile).
      const item = ctx.itemById(cmd.itemId);
      if (!item || !shouldOfferTick(item, ctx.bucketOf(item))) return;
      ctx.toast(`Done with ${item.name}?`, { label: '✓', run: () => { void actions.tick(item.id); } }, 6000);
      return;
    }
    default:
  }
}

/** @param {any} s a shortcut from main (Ctrl+1..9, Ctrl+Tab) */
function onShortcut(s) {
  if (s?.type === 'workspace') {
    const ws = ctx.workspaces()[s.index];
    if (ws) void actions.selectWorkspace(ws.id);
  } else if (s?.type === 'edit') {
    // F3: edit the entry that has keyboard focus in the app UI (when the key went to the UI), else
    // the item shown in the focused pane; nothing selected, nothing happens
    if (/** @type {HTMLDialogElement} */ (document.getElementById('dialog')).open) return;
    const entry = s.source === 'ui' ? /** @type {HTMLElement | null} */ (document.activeElement?.closest?.('[data-edit-kind]') ?? null) : null;
    const focused = entry ? { kind: entry.dataset.editKind ?? '', id: entry.dataset.editId ?? '' } : null;
    const paneLeaf = Layout.findPane(ctx.tree(), ctx.focusedPaneId());
    const target = editTarget(focused, paneLeaf?.itemId ?? null);
    if (!target) return;
    if (target.kind === 'item') void actions.editItem(target.id);
    else if (target.kind === 'group') void actions.editGroup(target.id);
    else void actions.editWorkspace(target.id);
  } else if (s?.type === 'nav') {
    // Alt+arrows / mouse side buttons / F5 / F6 pressed in the app itself (or a window app command):
    // the focused pane's page. Keys pressed inside a site are handled in main for that site's own item.
    if (/** @type {HTMLDialogElement} */ (document.getElementById('dialog')).open) return;
    const itemId = Layout.findPane(ctx.tree(), ctx.focusedPaneId())?.itemId;
    if (itemId) void api.navigate(itemId, s.action);
  } else if (s?.type === 'item') {
    const focusedLeaf = Layout.findPane(ctx.tree(), ctx.focusedPaneId());
    const target = cycle(ctx.model().order, focusedLeaf?.itemId ?? null, s.delta === -1 ? -1 : 1);
    if (target) void actions.showItem(target);
  }
}

/** The width the list panel shows right now: the stored width, clamped to this window. */
function effectiveListWidth(/** @type {unknown} */ wanted) {
  const rail = document.getElementById('rail');
  return clampListWidth(wanted, window.innerWidth, rail ? rail.getBoundingClientRect().width : 56);
}

/** Apply the stored width (not while the divider is being dragged: the drag owns it). */
function applyListWidth() {
  if (ctx.ui.listDrag) return;
  document.documentElement.style.setProperty('--list-width', `${effectiveListWidth(ctx.state.device.listWidth)}px`);
}

/** The border between the list and the panes: drag to resize, double-click to reset (per PC, device.json). */
function wireListDivider() {
  const divider = /** @type {HTMLElement} */ (document.getElementById('list-divider'));
  const setWidth = (/** @type {number} */ w) => document.documentElement.style.setProperty('--list-width', `${w}px`);
  divider.addEventListener('dblclick', async () => {
    setWidth(effectiveListWidth(DEFAULT_LIST_WIDTH));
    ctx.render();
    await api.saveDevice({ listWidth: DEFAULT_LIST_WIDTH });
  });
  divider.addEventListener('pointerdown', (/** @type {PointerEvent} */ down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    ctx.ui.listDrag = true;
    divider.classList.add('dragging');
    api.setOverlay(true); // native site views would swallow the pointer over the pane area
    const railRight = /** @type {HTMLElement} */ (document.getElementById('rail')).getBoundingClientRect().right;
    let width = effectiveListWidth(ctx.state.device.listWidth);
    const move = (/** @type {PointerEvent} */ e) => {
      if (e.buttons === 0) return; // a hover (or a synthetic mouse move after a layout change), not the drag
      width = effectiveListWidth(e.clientX - railRight);
      setWidth(width);
      ctx.render(); // pane boxes follow live (main keeps the rects; the views come back on release)
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ctx.ui.listDrag = false;
      divider.classList.remove('dragging');
      ctx.render();
      await api.saveDevice({ listWidth: width });
      api.setOverlay(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

/**
 * What the sync chip shows. A "syncing" that lasts under half a second is not shown (the chip keeps the
 * last settled status), so the once-a-minute background flights do not flicker the chip; a longer one
 * shows as the "↻" state, and a timer redraws when that moment comes.
 */
const syncGate = createSyncingGate();
/** @type {ReturnType<typeof setTimeout> | null} */
let syncGateTimer = null;
function updateSyncDisplay() {
  const sync = ctx.state.sync ?? null;
  const now = Date.now();
  const shown = syncGate.apply(sync?.status ?? 'not-connected', now);
  ctx.ui.syncLabel = syncLabel(sync ? { ...sync, status: shown } : null);
  if (syncGateTimer) clearTimeout(syncGateTimer);
  syncGateTimer = null;
  const wait = syncGate.wait(now);
  if (wait !== null) syncGateTimer = setTimeout(() => ctx.render(), wait + 20);
}

let rendering = false;
function render() {
  if (!ctx.state || rendering) return;
  rendering = true;
  try {
    updateSyncDisplay();
    applyListWidth();
    renderRail(/** @type {HTMLElement} */ (document.getElementById('rail')), ctx);
    renderList(/** @type {HTMLElement} */ (document.getElementById('list')), ctx);
    renderPanes(/** @type {HTMLElement} */ (document.getElementById('panes')), ctx);
  } finally {
    rendering = false;
  }
}
ctx.render = render;

async function start() {
  ctx.state = await api.getState();
  api.onState((/** @type {any} */ s) => {
    ctx.state = s;
    render();
    ctx.ui.panelRefresh?.(); // an open "Needs attention" list follows the queue
  });
  wireListDivider();
  api.onCommand(onCommand);
  api.onShortcut(onShortcut);
  new ResizeObserver(() => {
    ctx.ui.lastRects = '';
    requestAnimationFrame(render);
  }).observe(/** @type {HTMLElement} */ (document.getElementById('panes')));
  // the day can change while the app sits idle
  setInterval(async () => {
    ctx.state = await api.getState();
    render();
  }, 60_000);
  render();
  /** @type {any} */ (window).__fruiteryUiReady = true;
}

/** @type {any} */ (window).__fruiteryCore = typeof bucket === 'function';
start().catch((err) => {
  console.error(err);
  /** @type {any} */ (window).__fruiteryUiError = String(err?.message ?? err);
});
