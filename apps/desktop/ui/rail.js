// @ts-check
// The workspace rail: icons with a badge total, drag to reorder, right-click menu, "+", the sync status chip and settings.

import { h, renderIfChanged, captureEditFocus } from './dom.js';
import { badgeTotal } from '../lib/viewmodel.js';

/**
 * @param {HTMLElement} el
 * @param {any} ctx
 */
export function renderRail(el, ctx) {
  const workspaces = ctx.workspaces();
  const active = ctx.activeWorkspaceId();
  const items = workspaces.map((/** @type {any} */ w) => ({ id: w.id, name: w.name, icon: w.icon, badge: badgeTotal(ctx.snap(), w.id, ctx.state.badges) }));
  const sync = ctx.ui.syncLabel;
  renderIfChanged(el, [items, active, sync], () => {
    /** @param {DragEvent} e @param {HTMLElement} target */
    const half = (e, target) => {
      const r = target.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    };
    const clear = () => el.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    const buttons = items.map((/** @type {any} */ w, /** @type {number} */ index) => {
      const btn = h(
        'button',
        {
          class: `rail-item${w.id === active ? ' active' : ''}`,
          title: `${w.name}  (Ctrl+${index + 1})`,
          draggable: true,
          dataset: { editKind: 'workspace', editId: w.id },
          'aria-label': w.name,
          'aria-current': w.id === active ? 'true' : undefined,
          onclick: () => ctx.actions.selectWorkspace(w.id),
          oncontextmenu: (/** @type {Event} */ e) => { e.preventDefault(); ctx.api.contextMenu('workspace', w.id); },
          ondragstart: (/** @type {DragEvent} */ e) => {
            ctx.ui.drag = { kind: 'workspace', id: w.id };
            e.dataTransfer?.setData('text/x-fruitery-workspace', w.id);
          },
          ondragend: () => { ctx.ui.drag = null; clear(); },
          ondragover: (/** @type {DragEvent} */ e) => {
            if (ctx.ui.drag?.kind !== 'workspace' || ctx.ui.drag.id === w.id) return;
            e.preventDefault();
            clear();
            btn.classList.add(half(e, btn) === 'before' ? 'drop-before' : 'drop-after');
          },
          ondragleave: () => clear(),
          ondrop: async (/** @type {DragEvent} */ e) => {
            const drag = ctx.ui.drag;
            if (drag?.kind !== 'workspace' || drag.id === w.id) return;
            e.preventDefault();
            const pos = half(e, btn);
            clear();
            const others = items.filter((/** @type {any} */ x) => x.id !== drag.id);
            const at = others.findIndex((/** @type {any} */ x) => x.id === w.id) + (pos === 'after' ? 1 : 0);
            await ctx.api.reorder('workspace', null, drag.id, at);
          },
        },
        w.icon || (w.name.trim()[0] ?? '?').toUpperCase(),
        w.badge > 0 ? h('span', { class: 'rail-badge' }, w.badge > 99 ? '99+' : String(w.badge)) : null,
      );
      return btn;
    });
    const restoreFocus = captureEditFocus(el);
    el.replaceChildren(
      ...buttons,
      h('button', { class: 'rail-add', title: 'New workspace', 'aria-label': 'New workspace', onclick: () => ctx.actions.addWorkspace() }, '+'),
      h('div', { class: 'rail-spacer' }),
      // the sync status chip: its icon and colour say how sync is doing, the tooltip says it in words
      sync
        ? h(
            'button',
            { class: `rail-sync tone-${sync.tone}`, title: sync.tooltip, 'aria-label': sync.tooltip, onclick: () => ctx.actions.syncChip() },
            sync.icon,
            sync.badge > 0 ? h('span', { class: 'rail-badge sync-badge' }, sync.badge > 99 ? '99+' : String(sync.badge)) : null,
          )
        : null,
      h('button', { class: 'rail-gear', title: 'Settings', 'aria-label': 'Settings', onclick: () => ctx.actions.openSettings() }, '⚙'),
    );
    restoreFocus();
  });
}
