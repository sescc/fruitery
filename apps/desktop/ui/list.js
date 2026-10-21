// @ts-check
// The item list of the active workspace: groups with progress, items, the "Not due" section,
// "Basket full 🧺", drag to reorder (within and between groups), right-click menu.

import { h, renderIfChanged, captureEditFocus } from './dom.js';
import * as Layout from '../lib/layout.js';
import { iconChoice } from '../lib/viewmodel.js';

/**
 * @param {HTMLElement} el
 * @param {any} ctx
 */
export function renderList(el, ctx) {
  const ws = ctx.activeWorkspace();
  const model = ctx.model();
  const focusedLeaf = Layout.findPane(ctx.tree(), ctx.focusedPaneId());
  const activeItemId = focusedLeaf?.itemId ?? null;
  const badges = ctx.state.badges;
  const viewStates = ctx.state.viewStates;
  const pendingItems = new Set(ctx.state.pendingTickItems ?? []);
  const rowSig = (/** @type {any} */ r) => [r.item.id, r.item.name, r.item.icon, r.bucket, r.nextDue, badges[r.item.id] ?? 0, viewStates[r.item.id]?.awake === true, ctx.iconKey(r.item.id), pendingItems.has(r.item.id)];
  const tickNotice = ctx.tickNotice();
  const sig = [
    tickNotice,
    ws?.id,
    ws?.name,
    activeItemId,
    ctx.ui.notDueOpen,
    model.basketFull,
    model.sections.map((/** @type {any} */ s) => [s.id, s.name, s.collapsed, s.done, s.total, s.rows.map(rowSig)]),
    model.notDue.map(rowSig),
  ];
  renderIfChanged(el, sig, () => {
    if (!ws) {
      el.replaceChildren();
      return;
    }
    // a different workspace starts at the top
    if (/** @type {any} */ (el).__ws !== ws.id) {
      /** @type {any} */ (el).__ws = ws.id;
      const old = el.querySelector(':scope > .list-body');
      if (old) old.scrollTop = 0;
    }
    const clear = () => el.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-into'));
    /** @param {DragEvent} e @param {HTMLElement} target */
    const half = (e, target) => {
      const r = target.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    };
    /** Live items of one group of this workspace in stored order. @param {string | null} groupId */
    const siblings = (groupId) =>
      ctx.snap().items
        .filter((/** @type {any} */ i) => !i.deleted && i.workspaceId === ws.id && (i.groupId ?? null) === groupId)
        .sort((/** @type {any} */ a, /** @type {any} */ b) => a.order - b.order || (a.id < b.id ? -1 : 1));

    /**
     * The item's icon: its typed emoji or letter, else the site's saved icon, else the first letter (D116).
     * @param {any} item
     */
    const iconNode = (item) => {
      const src = ctx.iconSrc(item.id);
      const choice = iconChoice(item, src !== null);
      if (choice.kind === 'image' && src) return h('span', { class: 'icon' }, h('img', { src, alt: '', draggable: false }));
      return h('span', { class: 'icon' }, choice.kind === 'image' ? '' : choice.text);
    };

    /**
     * The always-visible tick circle: a click ticks a due item (or unticks a done one) without opening it.
     * @param {any} item
     * @param {'due' | 'done'} state
     */
    const tickButton = (item, state) =>
      h('button', {
        class: `tick ${state}${tickNotice ? ' blocked' : ''}${pendingItems.has(item.id) ? ' pending' : ''}`,
        type: 'button',
        draggable: false,
        // not `disabled`: a click on a disabled button could fall through to the row and open the item
        'aria-disabled': tickNotice ? 'true' : undefined,
        title: tickNotice ?? (pendingItems.has(item.id) ? 'Waiting to be sent when online. Click to undo it' : state === 'done' ? 'Picked today. Click to undo' : 'Mark done'),
        'aria-label': state === 'done' ? `Undo ${item.name}` : `Mark ${item.name} done`,
        onclick: (/** @type {Event} */ e) => {
          e.stopPropagation();
          if (tickNotice) ctx.toast(tickNotice);
          else if (state === 'done') void ctx.actions.untick(item.id);
          else void ctx.actions.tick(item.id);
        },
        onkeydown: (/** @type {KeyboardEvent} */ e) => e.stopPropagation(),
      });

    /** @param {any} row */
    const itemRow = (row) => {
      const item = row.item;
      const count = badges[item.id] ?? 0;
      const rowEl = h(
        'div',
        {
          class: `row${item.id === activeItemId ? ' active' : ''}${row.bucket === 'done' ? ' done' : ''}`,
          draggable: true,
          role: 'button',
          tabindex: 0,
          dataset: { editKind: 'item', editId: item.id },
          title: item.name,
          onclick: () => ctx.actions.showItem(item.id),
          onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter') ctx.actions.showItem(item.id); },
          oncontextmenu: (/** @type {Event} */ e) => { e.preventDefault(); ctx.api.contextMenu('item', item.id); },
          ondragstart: (/** @type {DragEvent} */ e) => {
            ctx.ui.drag = { kind: 'item', id: item.id };
            e.dataTransfer?.setData('text/x-fruitery-item', item.id);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            ctx.api.setOverlay(true); // native site views would swallow the drag over the panes
          },
          ondragend: () => { ctx.ui.drag = null; clear(); ctx.api.setOverlay(false); },
          ondragover: (/** @type {DragEvent} */ e) => {
            if (ctx.ui.drag?.kind !== 'item' || ctx.ui.drag.id === item.id) return;
            e.preventDefault();
            clear();
            rowEl.classList.add(half(e, rowEl) === 'before' ? 'drop-before' : 'drop-after');
          },
          ondragleave: () => clear(),
          ondrop: async (/** @type {DragEvent} */ e) => {
            const drag = ctx.ui.drag;
            if (drag?.kind !== 'item' || drag.id === item.id) return;
            e.preventDefault();
            e.stopPropagation();
            const pos = half(e, rowEl);
            clear();
            const parent = item.groupId ?? null;
            const others = siblings(parent).filter((/** @type {any} */ i) => i.id !== drag.id);
            const at = others.findIndex((/** @type {any} */ i) => i.id === item.id) + (pos === 'after' ? 1 : 0);
            await ctx.api.reorder('item', parent, drag.id, at);
          },
        },
        iconNode(item),
        h('span', { class: 'name' }, item.name),
        viewStates[item.id]?.awake ? h('span', { class: 'live', title: 'Loaded' }) : null,
        count > 0 ? h('span', { class: 'count' }, count > 99 ? '99+' : String(count)) : null,
        row.bucket === 'notDue' && row.nextDue ? h('span', { class: 'next' }, `next ${row.nextDue}`) : null,
        row.bucket === 'due' || row.bucket === 'done' ? tickButton(item, row.bucket) : null,
      );
      return rowEl;
    };

    /** @param {any} section */
    const sectionHead = (section) => {
      if (section.name === '') return null;
      const isGroup = section.id !== null;
      const head = h(
        'div',
        {
          class: 'section-head',
          draggable: isGroup,
          role: 'button',
          tabindex: 0,
          dataset: isGroup ? { editKind: 'group', editId: section.id } : undefined,
          'aria-expanded': String(!section.collapsed),
          onkeydown: (/** @type {KeyboardEvent} */ e) => {
            if (isGroup && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              ctx.api.upsert({ groups: [{ id: section.id, collapsed: !section.collapsed }] });
            }
          },
          onclick: () => { if (isGroup) ctx.api.upsert({ groups: [{ id: section.id, collapsed: !section.collapsed }] }); },
          oncontextmenu: (/** @type {Event} */ e) => { if (isGroup) { e.preventDefault(); ctx.api.contextMenu('group', section.id); } },
          ondragstart: (/** @type {DragEvent} */ e) => {
            if (!isGroup) return;
            ctx.ui.drag = { kind: 'group', id: section.id };
            e.dataTransfer?.setData('text/x-fruitery-group', section.id);
          },
          ondragend: () => { ctx.ui.drag = null; clear(); },
          ondragover: (/** @type {DragEvent} */ e) => {
            const drag = ctx.ui.drag;
            if (!drag) return;
            if (drag.kind === 'item') {
              e.preventDefault();
              clear();
              head.classList.add('drop-into');
            } else if (drag.kind === 'group' && isGroup && drag.id !== section.id) {
              e.preventDefault();
              clear();
              head.classList.add(half(e, head) === 'before' ? 'drop-before' : 'drop-after');
            }
          },
          ondragleave: () => clear(),
          ondrop: async (/** @type {DragEvent} */ e) => {
            const drag = ctx.ui.drag;
            if (!drag) return;
            if (drag.kind === 'item') {
              e.preventDefault();
              clear();
              await ctx.api.reorder('item', section.id, drag.id, 100000);
            } else if (drag.kind === 'group' && isGroup && drag.id !== section.id) {
              e.preventDefault();
              const pos = half(e, head);
              clear();
              const groups = ctx.snap().groups
                .filter((/** @type {any} */ g) => !g.deleted && g.workspaceId === ws.id && g.id !== drag.id)
                .sort((/** @type {any} */ a, /** @type {any} */ b) => a.order - b.order);
              const at = groups.findIndex((/** @type {any} */ g) => g.id === section.id) + (pos === 'after' ? 1 : 0);
              await ctx.api.reorder('group', ws.id, drag.id, at);
            }
          },
        },
        h('span', { class: 'twisty' }, isGroup ? (section.collapsed ? '▸' : '▾') : ''),
        h('span', {}, section.name),
        section.total > 0 ? h('span', { class: 'progress' }, `${section.done}/${section.total}`) : null,
      );
      return head;
    };

    /** @type {any[]} */
    const body = [];
    // ticking needs the Worker (the server's clock decides the day): say why the circles do nothing
    if (tickNotice) body.push(h('div', { class: 'list-notice', role: 'status' }, tickNotice));
    for (const section of model.sections) {
      // no header for the unnamed (ungrouped-only) section: replaceChildren would print a null as "null"
      const head = sectionHead(section);
      if (head) body.push(head);
      if (!section.collapsed) body.push(...section.rows.map(itemRow));
    }
    if (model.basketFull) body.push(h('div', { class: 'basket' }, 'Basket full 🧺'));
    if (model.notDue.length > 0) {
      body.push(
        h(
          'details',
          {
            class: 'not-due',
            open: ctx.ui.notDueOpen,
            ontoggle: (/** @type {Event} */ e) => { ctx.ui.notDueOpen = /** @type {HTMLDetailsElement} */ (e.currentTarget).open; },
          },
          h('summary', {}, `Not due (${model.notDue.length})`),
          ...model.notDue.map(itemRow),
        ),
      );
    }
    // The frame (title on top, scrolling body, add buttons in a bottom bar) is built once, so the
    // scroll position survives a re-render; only the title text and the body are replaced.
    let scroller = /** @type {HTMLElement | null} */ (el.querySelector(':scope > .list-body'));
    if (!scroller) {
      scroller = h('div', { class: 'list-body' });
      el.replaceChildren(
        h('div', { class: 'list-head' }, h('div', { class: 'list-title' })),
        scroller,
        h(
          'div',
          { class: 'list-foot' },
          h('button', { class: 'small-btn', title: 'Add item', onclick: () => ctx.actions.addItem() }, '+ Item'),
          h('button', { class: 'small-btn', title: 'Add group', onclick: () => ctx.actions.addGroup() }, '+ Group'),
        ),
      );
    }
    const title = /** @type {HTMLElement} */ (el.querySelector('.list-title'));
    title.textContent = ws.name;
    title.title = ws.name;
    const restoreFocus = captureEditFocus(el);
    scroller.replaceChildren(...body.filter((n) => n !== null && n !== undefined));
    restoreFocus();
  });
}
