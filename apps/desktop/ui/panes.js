// @ts-check
// The pane area: split panes with headers, the Daily bar, dividers and drop zones. The UI computes
// the layout; after every render it reports each pane's content box to main, which places the
// native site views there.

import { h, renderIfChanged } from './dom.js';
import * as Layout from '../lib/layout.js';
import { wrapDotCom } from '../lib/address.js';

/** Show the best-ever streak beside the current one in the Daily bar. Flip to false to hide it. */
const SHOW_LONGEST = true;

/** Which part of a pane an item was dropped on. @param {number} fx 0..1 @param {number} fy 0..1 */
function zoneOf(fx, fy) {
  const m = Math.min(fx, 1 - fx, fy, 1 - fy);
  if (m > 0.25) return 'center';
  if (m === fx) return 'left';
  if (m === 1 - fx) return 'right';
  if (m === fy) return 'top';
  return 'bottom';
}

const ZONE_SPLIT = /** @type {const} */ ({
  left: { dir: 'row', side: 'before' },
  right: { dir: 'row', side: 'after' },
  top: { dir: 'col', side: 'before' },
  bottom: { dir: 'col', side: 'after' },
});

/**
 * The address field that replaces a pane's title after a double click. Its text lives in `edit` (UI
 * state), so rebuilding the pane header never loses what was typed. Enter loads it, Escape or leaving
 * the field goes back to the title.
 * @param {any} ctx
 * @param {{paneId: string, itemId: string, text: string, error: string}} edit
 * @returns {HTMLElement}
 */
function addressField(ctx, edit) {
  const input = /** @type {HTMLInputElement} */ (
    h('input', {
      class: `addr-input${edit.error ? ' invalid' : ''}`,
      type: 'text',
      value: edit.text,
      spellcheck: false,
      autocomplete: 'off',
      title: edit.error || 'Enter loads this address in this pane. Escape cancels.',
      'aria-label': 'Address',
      oninput: () => { edit.text = input.value; },
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          // Ctrl+Enter wraps the typed host as www.<host>.com (as in a browser), then loads it
          if (e.ctrlKey) {
            edit.text = wrapDotCom(edit.text);
            input.value = edit.text;
          }
          void ctx.actions.submitAddress();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          ctx.actions.cancelAddressEdit();
        }
      },
      onblur: () => {
        // leaving the field cancels; a blur caused by the header being rebuilt (the old field is detached) does not
        setTimeout(() => {
          if (ctx.ui.addrEdit === edit && input.isConnected && document.activeElement !== input) ctx.actions.cancelAddressEdit();
        }, 0);
      },
    })
  );
  return h('div', { class: 'addr-wrap' }, input, edit.error ? h('span', { class: 'addr-error', role: 'alert' }, edit.error) : null);
}

/**
 * After the panes were rebuilt with an open address field: give it keyboard focus. Fresh from a double
 * click the whole address is selected; after a rebuild the cursor goes to the end of what was typed.
 * @param {HTMLElement} el
 * @param {any} ctx
 */
function focusAddressField(el, ctx) {
  const edit = ctx.ui.addrEdit;
  const input = /** @type {HTMLInputElement | null} */ (el.querySelector('.addr-input'));
  if (!edit || !input) return;
  input.focus();
  if (edit.fresh !== false) {
    input.select();
    edit.fresh = false;
  } else {
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

/**
 * @param {HTMLElement} el
 * @param {any} ctx
 */
export function renderPanes(el, ctx) {
  const wsId = ctx.activeWorkspaceId();
  const width = el.clientWidth;
  const height = el.clientHeight;
  if (!wsId || width === 0 || height === 0) return;
  const tree = ctx.tree();
  const { panes, dividers } = Layout.rects(tree, { x: 0, y: 0, w: width, h: height });
  const focused = ctx.focusedPaneId();
  const single = panes.length === 1;

  /** @param {any} p */
  const infoOf = (p) => {
    const item = ctx.itemById(p.itemId);
    if (!item) return null;
    const vs = ctx.state.viewStates[item.id];
    return {
      id: item.id,
      name: item.name,
      scheduled: item.schedule !== null,
      bucket: item.schedule ? ctx.bucketOf(item) : null,
      streak: item.schedule ? ctx.streakOf(item) : null,
      next: item.schedule ? (ctx.model().notDue.find((/** @type {any} */ r) => r.item.id === item.id)?.nextDue ?? null) : null,
      awake: vs?.awake === true,
      loading: vs?.loading === true,
      title: vs?.title ?? '',
      url: vs?.url ?? null,
      canGoBack: vs?.canGoBack === true,
      tickNotice: ctx.tickNotice(),
      waiting: (ctx.state.pendingTickItems ?? []).includes(item.id),
    };
  };
  const infos = new Map(panes.map((/** @type {any} */ p) => [p.paneId, infoOf(p)]));
  const editing = ctx.ui.addrEdit;
  /**
   * What decides whether a pane is rebuilt. While its address field is open the page's own noise (title,
   * loading, history, address) is left out, so a page that keeps changing its title cannot destroy what the
   * owner is typing; the typed text itself is kept in the UI state, not in this signature.
   * @param {any} p
   */
  const sigInfo = (p) => {
    const info = infos.get(p.paneId);
    if (info && editing && editing.paneId === p.paneId) return { id: info.id, name: info.name, scheduled: info.scheduled, bucket: info.bucket, editing: editing.error };
    return info;
  };
  const sig = [wsId, width, height, focused, panes.map((/** @type {any} */ p) => [p.paneId, p.itemId, p.x, p.y, p.w, p.h, sigInfo(p)]), dividers.map((/** @type {any} */ d) => [d.x, d.y, d.w, d.h])];

  const rendered = renderIfChanged(el, sig, () => {
    /** @param {Layout.Layout} next @param {string | null} focus */
    const commit = (next, focus) => ctx.setLayout(next, focus);

    /** The streak chip for a scheduled pane: "🔥 N" (and "· best M" when enabled), or nothing at 0. @param {any} info */
    const streakChip = (info) => {
      const s = info.streak;
      if (!s || s.current <= 0) return null;
      const label = SHOW_LONGEST && s.longest > s.current ? `🔥 ${s.current} · best ${s.longest}` : `🔥 ${s.current}`;
      const title = SHOW_LONGEST ? `Current streak ${s.current}, best ${s.longest}` : `Current streak ${s.current}`;
      return h('span', { class: 'streak', title }, label);
    };

    /** @param {any} p @param {any} info */
    const dailyBar = (p, info) => {
      const item = ctx.itemById(info.id);
      return h(
        'div',
        { class: 'daily-bar' },
        info.bucket === 'done'
          ? h('button', { class: 'small-btn', title: info.tickNotice ?? undefined, disabled: Boolean(info.tickNotice), onclick: () => ctx.actions.untick(info.id) }, 'Undo')
          : h('button', { class: 'small-btn done-btn', title: info.tickNotice ?? 'Mark done and open the next due item', disabled: info.bucket === 'notDue' || Boolean(info.tickNotice), onclick: () => ctx.actions.done(p.paneId, item) }, 'Done'),
        h('button', { class: 'small-btn', title: 'Next due item', onclick: () => ctx.actions.next(p.paneId, item) }, 'Next'),
        streakChip(info),
        h('span', { class: 'status' }, info.bucket === 'done' ? (info.waiting ? 'Picked today (waiting to be sent)' : 'Picked today') : info.bucket === 'notDue' ? `Not due${info.next ? ` · next ${info.next}` : ''}` : 'Due today'),
      );
    };

    /** @param {any} p */
    const paneEl = (p) => {
      const info = infos.get(p.paneId);
      const body = h('div', { class: 'pane-body', dataset: { pane: p.paneId } },
        h('div', { class: 'pane-hint' }, info ? (info.awake ? '' : `Opening ${info.name}…`) : 'Choose an item from the list, or drop one here.'),
        h('div', { class: 'drop-indicator' }),
      );
      const indicator = /** @type {HTMLElement} */ (body.querySelector('.drop-indicator'));
      /** @param {DragEvent} e */
      const zoneFor = (e) => {
        const r = body.getBoundingClientRect();
        return zoneOf((e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height));
      };
      const showZone = (/** @type {string | null} */ zone) => {
        if (!zone) { indicator.style.display = 'none'; return; }
        const r = { left: ['0', '0', '50%', '100%'], right: ['50%', '0', '50%', '100%'], top: ['0', '0', '100%', '50%'], bottom: ['0', '50%', '100%', '50%'], center: ['0', '0', '100%', '100%'] }[/** @type {'left'} */ (zone)];
        Object.assign(indicator.style, { display: 'block', left: r[0], top: r[1], width: r[2], height: r[3] });
      };
      body.addEventListener('dragover', (e) => {
        if (ctx.ui.drag?.kind !== 'item') return;
        e.preventDefault();
        showZone(zoneFor(e));
      });
      body.addEventListener('dragleave', () => showZone(null));
      body.addEventListener('drop', async (e) => {
        const drag = ctx.ui.drag;
        if (drag?.kind !== 'item') return;
        e.preventDefault();
        const zone = zoneFor(e);
        showZone(null);
        if (zone === 'center') await ctx.actions.showItem(drag.id, p.paneId);
        else await ctx.actions.showItem(drag.id, p.paneId, { split: ZONE_SPLIT[/** @type {'left'} */ (zone)] });
      });

      /** @param {string} glyph @param {string} title @param {() => void} fn @param {boolean} [disabled] @param {string} [extra] extra class ("opt": hidden in a narrow pane) */
      const btn = (glyph, title, fn, disabled = false, extra = '') => h('button', { class: extra ? `icon-btn ${extra}` : 'icon-btn', title, 'aria-label': title, disabled, onclick: (/** @type {Event} */ e) => { e.stopPropagation(); fn(); } }, glyph);
      /** The page title (one click copies its address, a double click edits it), or the address field. */
      const titleArea = () => {
        if (!info) return h('span', { class: 'pane-title' }, 'Empty pane');
        const edit = ctx.ui.addrEdit;
        if (edit && edit.paneId === p.paneId && edit.itemId === info.id) return addressField(ctx, edit);
        const text = info.title && info.title.trim() !== '' ? info.title : info.name;
        return h(
          'div',
          {
            class: 'pane-titlebar',
            title: `${info.name}${info.url ? `\n${info.url}` : ''}\nClick: copy the address. Double-click: type an address.`,
            onclick: (/** @type {Event} */ e) => {
              e.stopPropagation();
              ctx.ui.titleClicks.click(p.paneId);
            },
          },
          h('span', { class: 'pane-title' }, text),
        );
      };
      const head = h(
        'div',
        { class: 'pane-head', onclick: () => ctx.actions.focusPane(p.paneId) },
        titleArea(),
        info?.loading ? h('span', { class: 'spinner', title: 'Loading' }) : null,
        info ? btn('‹', 'Back (Alt+Left)', () => ctx.api.navigate(info.id, 'back'), !info.canGoBack, 'opt2') : null,
        info ? btn('⟳', 'Reload (F5)', () => ctx.api.navigate(info.id, 'reload'), false, 'opt2') : null,
        info ? btn('⌂', 'Home page (F6)', () => ctx.api.navigate(info.id, 'home'), false, 'opt') : null,
        info ? btn('⧉', 'Copy address', () => ctx.actions.copyPaneAddress(p.paneId), false, 'opt2') : null,
        info ? btn('↗', 'Open this page in Edge', () => ctx.actions.openPageInEdge(info.id), false, 'opt2') : null,
        btn('◫', 'Split right', async () => {
          const r = Layout.split(tree, p.paneId, 'row', Layout.nextPaneId(tree), null);
          if ('error' in r) ctx.toast('Up to 4 panes per workspace');
          else if ('focus' in r) await ctx.actions.focusPane(r.focus);
          else await commit(r.tree, r.paneId);
        }, false, 'opt'),
        btn('⊟', 'Split down', async () => {
          const r = Layout.split(tree, p.paneId, 'col', Layout.nextPaneId(tree), null);
          if ('error' in r) ctx.toast('Up to 4 panes per workspace');
          else if ('focus' in r) await ctx.actions.focusPane(r.focus);
          else await commit(r.tree, r.paneId);
        }, false, 'opt'),
        btn('✕', 'Close pane', async () => {
          const r = Layout.close(tree, p.paneId);
          if ('tree' in r) await commit(r.tree, Layout.leaves(r.tree)[0].paneId);
        }, single),
      );
      return h(
        'section',
        {
          class: `pane${p.paneId === focused ? ' focused' : ''}`,
          dataset: { pane: p.paneId },
          style: { left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px` },
          onmousedown: () => ctx.actions.focusPane(p.paneId),
        },
        head,
        info?.scheduled ? dailyBar(p, info) : null,
        body,
      );
    };

    /** @param {any} d */
    const dividerEl = (d) => {
      const node = h('div', {
        class: `divider divider-${d.dir}`,
        style: { left: `${d.x}px`, top: `${d.y}px`, width: `${d.w}px`, height: `${d.h}px` },
        onpointerdown: (/** @type {PointerEvent} */ down) => {
          down.preventDefault();
          ctx.api.setOverlay(true); // views would swallow the pointer events
          const base = el.getBoundingClientRect();
          let latest = tree;
          const move = (/** @type {PointerEvent} */ e) => {
            const span = d.dir === 'row' ? d.parent.w - Layout.DIVIDER_PX : d.parent.h - Layout.DIVIDER_PX;
            const pos = d.dir === 'row' ? e.clientX - base.left - d.parent.x : e.clientY - base.top - d.parent.y;
            const r = Layout.resize(tree, d.path, (pos - Layout.DIVIDER_PX / 2) / Math.max(1, span));
            if ('tree' in r) {
              latest = r.tree;
              ctx.ui.treeOverride = r.tree;
              ctx.render();
            }
          };
          const up = async () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            await commit(latest, focused);
            ctx.api.setOverlay(false);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        },
      });
      return node;
    };

    el.replaceChildren(...panes.map(paneEl), ...dividers.map(dividerEl));
  });

  if (rendered && ctx.ui.addrEdit) focusAddressField(el, ctx);
  reportRects(el, ctx, tree);
}

/**
 * Tell main where each pane's content box is (window coordinates), once per change.
 * @param {HTMLElement} el
 * @param {any} ctx
 * @param {Layout.Layout} tree
 */
function reportRects(el, ctx, tree) {
  const pinId = ctx.state?.device?.pinnedItemId ?? null;
  const pinned = pinId && ctx.itemById(pinId) ? pinId : null;
  const list = Layout.leaves(tree).flatMap((leaf) => {
    const body = el.querySelector(`.pane-body[data-pane="${CSS.escape(leaf.paneId)}"]`);
    if (!body) return [];
    const r = body.getBoundingClientRect();
    // the pinned item lives in the strip, never in the pane grid: report its pane as empty
    const itemId = leaf.itemId && leaf.itemId !== pinned && ctx.itemById(leaf.itemId) ? leaf.itemId : null;
    return [{ paneId: leaf.paneId, itemId, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }];
  });
  // the pinned strip's body (when shown and not collapsed) hosts the pinned item's native view, placed
  // like a pane; it is reported under a reserved pane id so the view manager keeps it attached and awake
  const pinBody = pinned ? document.querySelector('#pin-strip .pin-body[data-pane="__pin"]') : null;
  if (pinBody) {
    const r = pinBody.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) list.push({ paneId: '__pin', itemId: pinned, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  }
  const json = JSON.stringify(list);
  if (json === ctx.ui.lastRects) return;
  ctx.ui.lastRects = json;
  ctx.api.setPaneRects(list);
}
