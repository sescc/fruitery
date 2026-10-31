// @ts-check
// The pinned-item strip at the bottom of the item-list column (e.g. a time-tracking site). The strip header is
// always shown while an item is pinned; its body hosts the pinned item's native view (placed by
// main from the rect panes.js reports). Collapsing hides the body without unpinning. The native
// view is attached by the view manager exactly like a pane, so nothing special happens here beyond
// drawing the DOM and reporting the body box.

import { h, renderIfChanged } from './dom.js';

/** The reserved "pane" id under which the pinned view's rect is reported to main. */
export const PIN_PANE_ID = '__pin';

/**
 * Draw the pin strip into `#pin-strip`.
 * @param {HTMLElement} el the #pin-strip element
 * @param {any} ctx
 */
export function renderPinStrip(el, ctx) {
  const id = ctx.state?.device?.pinnedItemId ?? null;
  const item = id ? ctx.itemById(id) : null;
  const collapsed = ctx.state?.device?.pinnedCollapsed === true;
  // when nothing is pinned (or the item is gone) the strip is hidden entirely
  el.hidden = !item;
  if (!item) {
    renderIfChanged(el, ['none'], () => el.replaceChildren());
    return;
  }
  const vs = ctx.state.viewStates?.[item.id];
  const sig = ['pin', item.id, item.name, collapsed, vs?.awake === true, vs?.loading === true];
  renderIfChanged(el, sig, () => {
    el.classList.toggle('collapsed', collapsed);
    const head = h(
      'div',
      { class: 'pin-head' },
      h('span', { 'aria-hidden': 'true' }, '📌'),
      h('span', { class: 'pin-title', title: item.name }, item.name),
      h('button', {
        class: 'icon-btn',
        title: collapsed ? 'Expand' : 'Collapse',
        'aria-label': collapsed ? 'Expand the pinned strip' : 'Collapse the pinned strip',
        onclick: () => ctx.actions.togglePinCollapsed(),
      }, collapsed ? '▸' : '▾'),
      h('button', {
        class: 'icon-btn',
        title: 'Unpin',
        'aria-label': 'Unpin',
        onclick: () => ctx.actions.unpinItem(),
      }, '✕'),
    );
    if (collapsed) {
      el.replaceChildren(head);
      return;
    }
    const body = h('div', { class: 'pin-body', dataset: { pane: PIN_PANE_ID } },
      h('div', { class: 'pane-hint' }, vs?.awake ? '' : `Opening ${item.name}…`),
    );
    el.replaceChildren(head, body);
  });
}
