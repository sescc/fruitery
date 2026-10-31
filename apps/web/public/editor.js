// @ts-check
// Phone editor UI: edit mode for items, groups, workspaces and settings. Builds the DOM with element
// APIs and textContent only (never innerHTML), so item names and URLs can never inject markup.
// Every save goes: form -> editor-model -> core validateItem -> PUT /api/entities -> merge the
// server's answer into memory (done by the host). Desktop-only fields are shown read-only and are
// preserved by `applyForm` (D89); the program path and item kind can never be changed from here.

import { removalPlan, ungroupedLabelOf, userAgentOf, validateItem, validateWorkspace } from './core/index.js';
import { applyForm, checkName, dropPlan, errorsByField, formFromItem, moveWithin, newGroup, newId, newItem, newWorkspace, rename, renameWorkspace, scheduleFields, scheduleFromFields } from './editor-model.js';

/** @typedef {import('./view.js').Snapshot} Snapshot */
/** @typedef {import('./core/model.js').Item} Item */
/** @typedef {import('./core/model.js').Group} Group */
/** @typedef {import('./core/model.js').Workspace} Workspace */
/**
 * What the editor needs from the app.
 * @typedef {object} EditorHost
 * @property {() => Snapshot | null} snapshot the current in-memory snapshot
 * @property {(body: Record<string, unknown>) => Promise<{status: number, json: any}>} put `PUT /api/entities`; rejects on a network failure
 * @property {(winners: any) => void} applyEntities merge the server's winners into memory, update the stored copy, re-render
 * @property {(message: string) => void} toast
 * @property {(message: string) => boolean} confirm
 * @property {() => void} networkFailed called after a request failed without an answer
 * @property {() => number} now epoch ms
 * @property {() => string} randomUUID
 */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SCHEDULE_LABELS = /** @type {const} */ ({ none: 'No schedule (a plain link)', daily: 'Every day', weekly: 'Every week', monthly: 'Every month', everyNDays: 'Every N days' });
const ICON = { edit: '✎', up: '↑', down: '↓', del: '\u{1F5D1}', gear: '⚙' };

/**
 * @param {string} tag
 * @param {Record<string, string> | null} [attrs]
 * @param {...(Node | string)} children
 * @returns {HTMLElement}
 */
function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

/**
 * @param {{order: number, id: string}} a
 * @param {{order: number, id: string}} b
 */
const byOrder = (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A short description of a schedule for the edit list.
 * @param {Item['schedule']} s
 * @returns {string}
 */
function describeSchedule(s) {
  if (!s) return 'link';
  switch (s.type) {
    case 'daily':
      return 'daily';
    case 'weekly':
      return `weekly, ${WEEKDAYS[s.weekday - 1] ?? '?'}`;
    case 'monthly':
      return `monthly, day ${s.day}`;
    case 'everyNDays':
      return `every ${s.n} days`;
  }
}

/**
 * A small icon button with an accessible name.
 * @param {string} glyph
 * @param {string} label
 * @param {() => void} onClick
 * @param {string} [cls] CSS classes (default the full-size button; arrows use the compact one)
 * @returns {HTMLElement}
 */
function iconButton(glyph, label, onClick, cls = 'icon-btn') {
  const b = h('button', { type: 'button', class: cls, 'aria-label': label, title: label }, glyph);
  b.addEventListener('click', onClick);
  return b;
}

/**
 * @param {string} label
 * @param {() => void} onClick
 * @param {string} [cls]
 * @returns {HTMLElement}
 */
function textButton(label, onClick, cls = 'text-btn') {
  const b = h('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
}

/**
 * A labelled form field with an inline error slot.
 * @param {string} label
 * @param {HTMLElement} control
 * @param {string} errorKey the field name an error for it carries
 * @returns {HTMLElement}
 */
function field(label, control, errorKey) {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, h('small', { class: 'error', 'data-error-for': errorKey, hidden: '' }));
}

/**
 * @param {Record<string, string>} attrs
 * @returns {HTMLInputElement}
 */
function input(attrs) {
  return /** @type {HTMLInputElement} */ (h('input', attrs));
}

/**
 * @param {[string, string][]} options value, label
 * @param {string} value
 * @returns {HTMLSelectElement}
 */
function select(options, value) {
  const el = /** @type {HTMLSelectElement} */ (h('select'));
  for (const [v, text] of options) el.append(h('option', { value: v }, text));
  el.value = value;
  return el;
}

/**
 * Show messages next to their fields. A key `schedule.xyz` shows under the schedule block, an unknown
 * key under the form.
 * @param {HTMLElement} root
 * @param {Record<string, string>} messages by field
 */
function showErrors(root, messages) {
  for (const slot of root.querySelectorAll('[data-error-for]')) {
    slot.textContent = '';
    /** @type {HTMLElement} */ (slot).hidden = true;
  }
  /** @type {Record<string, string[]>} */
  const placed = {};
  for (const [key, message] of Object.entries(messages)) {
    let target = key.startsWith('schedule') ? 'schedule' : key;
    if (!root.querySelector(`[data-error-for="${CSS.escape(target)}"]`)) target = 'form';
    (placed[target] ??= []).push(target === 'form' ? `${key}: ${message}` : message);
  }
  for (const [target, list] of Object.entries(placed)) {
    const slot = /** @type {HTMLElement | null} */ (root.querySelector(`[data-error-for="${CSS.escape(target)}"]`));
    if (slot) {
      slot.textContent = list.join('; ');
      slot.hidden = false;
    }
  }
}

/**
 * Create the editor.
 * @param {EditorHost} host
 */
export function createEditor(host) {
  /** @type {HTMLDialogElement} */
  const sheet = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'sheet' }));
  document.body.append(sheet);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.close(); // a tap on the backdrop
  });

  function closeSheet() {
    if (sheet.open) sheet.close();
  }

  /**
   * Open the sheet with a title and a form.
   * @param {string} title
   * @param {HTMLElement[]} body
   * @param {(form: HTMLFormElement) => Promise<void>} onSave called on Save; throw nothing, show errors itself
   * @param {string} [saveLabel]
   */
  function openSheet(title, body, onSave, saveLabel = 'Save') {
    const form = /** @type {HTMLFormElement} */ (h('form', { class: 'sheet-form', novalidate: '' }));
    const save = h('button', { type: 'submit', class: 'primary' }, saveLabel);
    form.append(
      h('h2', null, title),
      ...body,
      h('small', { class: 'error', 'data-error-for': 'form', hidden: '' }),
      h('div', { class: 'sheet-actions' }, textButton('Cancel', closeSheet), save),
    );
    let saving = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saving) return;
      saving = true;
      /** @type {HTMLButtonElement} */ (save).disabled = true;
      try {
        await onSave(form);
      } finally {
        saving = false;
        /** @type {HTMLButtonElement} */ (save).disabled = false;
      }
    });
    sheet.replaceChildren(form);
    if (!sheet.open) sheet.showModal();
    form.querySelector('input, select')?.focus();
  }

  /**
   * Send entities; on success merge the answer. Returns whether it was saved.
   * @param {Record<string, unknown>} body
   * @param {HTMLElement | null} [errorRoot] where to show 422 errors
   * @param {Record<string, number>} [sent] updatedAt by id, to notice a newer change from another device
   * @returns {Promise<boolean>}
   */
  async function save(body, errorRoot = null, sent = {}) {
    let result;
    try {
      result = await host.put(body);
    } catch {
      host.toast('Could not reach the server. Nothing was saved.');
      host.networkFailed();
      return false;
    }
    if (result.status === 403) {
      closeSheet(); // the app now shows the denial
      return false;
    }
    if (result.status === 422 || result.status === 400) {
      const messages = errorsByField(result.json?.details);
      if (errorRoot && Object.keys(messages).length > 0) showErrors(errorRoot, messages);
      else host.toast('The server did not accept that change.');
      return false;
    }
    if (result.status !== 200) {
      host.toast(`Could not save (HTTP ${result.status}). Nothing was changed.`);
      return false;
    }
    host.applyEntities(result.json);
    const losers = ['workspaces', 'groups', 'items'].flatMap((k) => (result.json?.[k] ?? []).filter((/** @type {any} */ e) => e.id in sent && e.updatedAt !== sent[e.id]));
    if (losers.length > 0) host.toast('A newer change from another device was kept instead of this one.');
    return true;
  }

  /**
   * @param {Snapshot} snap
   * @returns {Group[]}
   */
  const liveGroups = (snap) => snap.groups.filter((g) => !g.deleted);

  // ---------------------------------------------------------------- item sheet

  /**
   * @param {Item} base the item being edited, or a new one
   * @param {boolean} isNew
   */
  function openItemSheet(base, isNew) {
    const snap = host.snapshot();
    if (!snap) return;
    const form = formFromItem(base);
    const sched = scheduleFields(form.schedule);
    const live = snap.workspaces.filter((w) => !w.deleted).sort(byOrder);

    const name = input({ name: 'name', type: 'text', autocomplete: 'off', value: form.name });
    const url = input({ name: 'url', type: 'text', inputmode: 'url', autocapitalize: 'none', autocomplete: 'off', placeholder: 'https://', value: form.url });
    const fallback = input({ name: 'fallbackUrl', type: 'text', inputmode: 'url', autocapitalize: 'none', autocomplete: 'off', placeholder: 'https://', value: form.fallbackUrl });
    const deepLink = input({ name: 'deepLink', type: 'text', inputmode: 'url', autocapitalize: 'none', autocomplete: 'off', spellcheck: false, placeholder: 'intent://…  or  myapp://…', value: form.deepLink });
    const workspace = select(live.map((w) => [w.id, w.name]), form.workspaceId);
    const group = /** @type {HTMLSelectElement} */ (h('select', { name: 'groupId' }));
    const fillGroups = () => {
      group.replaceChildren(h('option', { value: '' }, `No group (${ungroupedLabelOf(live.find((w) => w.id === workspace.value))})`));
      for (const g of liveGroups(snap).filter((x) => x.workspaceId === workspace.value).sort(byOrder)) group.append(h('option', { value: g.id }, g.name));
      group.value = [...group.options].some((o) => o.value === form.groupId) ? form.groupId : '';
    };
    fillGroups();
    workspace.addEventListener('change', () => {
      form.groupId = '';
      fillGroups();
    });

    const type = select(Object.entries(SCHEDULE_LABELS), sched.type);
    const weekday = select(WEEKDAYS.map((d, i) => [String(i + 1), d]), String(sched.weekday));
    const day = input({ type: 'number', inputmode: 'numeric', min: '1', max: '31', value: String(sched.day) });
    const n = input({ type: 'number', inputmode: 'numeric', min: '1', value: String(sched.n) });
    const start = input({ type: 'date', value: sched.startDate });
    const parts = {
      weekly: field('Weekday', weekday, 'schedule'),
      monthly: field('Day of the month (31 = the last day of short months)', day, 'schedule'),
      everyNDays: h('div', null, field('Every N days', n, 'schedule'), field('Starting on', start, 'schedule')),
    };
    const syncSchedule = () => {
      for (const [k, el] of Object.entries(parts)) el.hidden = k !== type.value;
    };
    type.addEventListener('change', syncSchedule);
    syncSchedule();

    const reset = input({ name: 'resetTime', type: 'time', value: form.resetTime });
    const devices = select([['all', 'Phone and desktop'], ['phone', 'Phone only'], ['desktop', 'Desktop only']], form.devices);
    const notify = input({ type: 'checkbox' });
    notify.checked = form.notify;
    const badge = input({ type: 'checkbox' });
    badge.checked = form.badge;

    const isApp = base.kind === 'app';
    const body = [
      field('Name', name, 'name'),
      ...(isApp ? [] : [field('Web address', url, 'url')]),
      field(isApp ? 'Web address used on the phone' : 'Fallback web address (optional)', fallback, 'fallbackUrl'),
      field('App link on the phone (optional)', deepLink, 'deepLink'),
      field('Workspace', workspace, 'workspaceId'),
      field('Group', group, 'groupId'),
      field('Repeats', type, 'schedule'),
      parts.weekly,
      parts.monthly,
      parts.everyNDays,
      field('Day starts at', reset, 'resetTime'),
      field('Shown on', devices, 'devices'),
      h('label', { class: 'check-row' }, notify, h('span', null, 'Notifications (desktop)')),
      h('label', { class: 'check-row' }, badge, h('span', null, 'Unread badge (desktop)')),
      desktopSection(base, snap),
    ];

    openSheet(isNew ? 'Add item' : 'Edit item', body, async (formEl) => {
      const values = {
        name: name.value,
        ...(isApp ? {} : { url: url.value }),
        fallbackUrl: fallback.value,
        deepLink: deepLink.value,
        workspaceId: workspace.value,
        groupId: group.value,
        schedule: scheduleFromFields({ type: type.value, weekday: weekday.value, day: day.value, n: n.value, startDate: start.value }),
        resetTime: reset.value,
        devices: devices.value,
        notify: notify.checked,
        badge: badge.checked,
      };
      const now = host.now();
      const item = applyForm(base, values, now, snap);
      const errors = validateItem(item, { groups: liveGroups(snap) });
      if (errors.length > 0) {
        showErrors(formEl, errorsByField(errors));
        return;
      }
      showErrors(formEl, {});
      if (await save({ items: [item] }, formEl, { [item.id]: item.updatedAt })) closeSheet();
    });
  }

  /**
   * The read-only "Desktop settings" block: fields only the desktop app changes (D89).
   * @param {Item} item
   * @param {Snapshot} snap
   * @returns {HTMLElement}
   */
  function desktopSection(item, snap) {
    const ua = userAgentOf(item);
    const ws = snap.workspaces.find((w) => w.id === item.workspaceId);
    const edge = item.edge.mode === 'inherit' ? `workspace default (${ws?.openInEdge ? 'open in Edge' : 'in the app'})` : item.edge.mode === 'always' ? 'always open in Edge' : 'never open in Edge';
    const rows = /** @type {[string, string][]} */ ([
      ['Type', item.kind === 'app' ? 'Program' : 'Web page'],
      ...(item.kind === 'app' ? /** @type {[string, string][]} */ ([['Program path', item.appPath ?? '']]) : []),
      ['Open in Edge', edge],
      ['Sleep after', item.sleepAfterMin === null ? 'workspace default' : item.sleepAfterMin === 0 ? 'never' : `${item.sleepAfterMin} min`],
      ['Browser identity', ua.preset === 'custom' ? `custom (${ua.custom ?? ''})` : ua.preset],
      ['Isolated session', item.isolate ? 'yes' : 'no'],
      ['Keep logins', item.persistSessionCookies ? 'yes' : 'no'],
    ]);
    const dl = h('dl', { class: 'readonly' });
    for (const [k, v] of rows) dl.append(h('dt', null, k), h('dd', null, v));
    return h('details', { class: 'desktop-only' }, h('summary', null, 'Desktop settings (change on the PC)'), dl);
  }

  // ---------------------------------------------------------------- name sheet and settings sheet

  /**
   * Ask for a name (new or renamed group/workspace).
   * @param {string} title
   * @param {string} initial
   * @param {(name: string, formEl: HTMLElement) => Promise<boolean>} onSave resolves true when saved
   */
  function openNameSheet(title, initial, onSave) {
    const name = input({ name: 'name', type: 'text', autocomplete: 'off', value: initial });
    openSheet(title, [field('Name', name, 'name')], async (formEl) => {
      const errors = checkName(name.value);
      if (errors.length > 0) {
        showErrors(formEl, errorsByField(errors));
        return;
      }
      if (await onSave(name.value.trim(), formEl)) closeSheet();
    });
  }

  /** @param {string} workspaceId */
  function addGroup(workspaceId) {
    openNameSheet('Add group', '', async (name, formEl) => {
      const snap = host.snapshot();
      if (!snap) return false;
      const g = newGroup(snap, workspaceId, name, host.now(), newId('g', host.randomUUID));
      return save({ groups: [g] }, formEl);
    });
  }

  function addWorkspace() {
    openNameSheet('Add workspace', '', async (name, formEl) => {
      const snap = host.snapshot();
      if (!snap) return false;
      const w = newWorkspace(snap, name, host.now(), newId('ws', host.randomUUID));
      return save({ workspaces: [w] }, formEl);
    });
  }

  /**
   * @param {'group' | 'workspace'} kind
   * @param {Group | Workspace} entity
   */
  function renameEntity(kind, entity) {
    if (kind === 'workspace') {
      openWorkspaceSheet(/** @type {Workspace} */ (entity));
      return;
    }
    openNameSheet(kind === 'group' ? 'Rename group' : 'Rename workspace', entity.name, async (name, formEl) => {
      const renamed = rename(entity, name, host.now());
      return save(kind === 'group' ? { groups: [renamed] } : { workspaces: [renamed] }, formEl, { [renamed.id]: renamed.updatedAt });
    });
  }

  /**
   * Rename a workspace and set the name shown for its items without a group (D99).
   * @param {Workspace} ws
   */
  function openWorkspaceSheet(ws) {
    const name = input({ name: 'name', type: 'text', autocomplete: 'off', value: ws.name });
    const label = input({ name: 'ungroupedLabel', type: 'text', autocomplete: 'off', maxlength: '40', placeholder: 'Default', value: ws.ungroupedLabel ?? '' });
    openSheet('Rename workspace', [field('Name', name, 'name'), field('Name for items without a group', label, 'ungroupedLabel')], async (formEl) => {
      const next = renameWorkspace(ws, { name: name.value, ungroupedLabel: label.value }, host.now());
      const errors = validateWorkspace(next);
      if (errors.length > 0) {
        showErrors(formEl, errorsByField(errors));
        return;
      }
      showErrors(formEl, {});
      if (await save({ workspaces: [next] }, formEl, { [next.id]: next.updatedAt })) closeSheet();
    });
  }

  function openSettingsSheet() {
    const snap = host.snapshot();
    if (!snap) return;
    const current = snap.settings?.timezone ?? 'UTC';
    /** @type {string[]} */
    let zones = [];
    try {
      zones = /** @type {any} */ (Intl).supportedValuesOf('timeZone');
    } catch {
      // older engines: fall back to the current value and UTC
    }
    const all = [...new Set(['UTC', current, ...zones])];
    const tz = select(all.map((z) => [z, z]), current);
    const email = input({ name: 'googleEmail', type: 'text', inputmode: 'email', autocapitalize: 'none', autocomplete: 'off', value: snap.settings?.googleEmail ?? '' });
    openSheet('Settings', [field('Timezone', tz, 'timezone'), field('Google email (for {googleEmail} in web addresses)', email, 'googleEmail')], async (formEl) => {
      const googleEmail = email.value.trim();
      if (googleEmail !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(googleEmail)) {
        showErrors(formEl, { googleEmail: 'Not an allowed value' });
        return;
      }
      showErrors(formEl, {});
      const settings = { timezone: tz.value, googleEmail: googleEmail === '' ? null : googleEmail, updatedAt: host.now() };
      if (await save({ settings }, formEl)) closeSheet();
    });
  }

  // ---------------------------------------------------------------- deletes and moves

  /**
   * Confirm, plan with the shared core rules, then send the tombstones.
   * @param {'item' | 'group' | 'workspace'} kind
   * @param {string} id
   */
  async function remove(kind, id) {
    const snap = host.snapshot();
    if (!snap) return;
    const liveItems = snap.items.filter((i) => !i.deleted);
    let message = '';
    if (kind === 'item') {
      message = `Delete "${snap.items.find((i) => i.id === id)?.name ?? 'this item'}"?`;
    } else if (kind === 'group') {
      const g = snap.groups.find((x) => x.id === id);
      const count = liveItems.filter((i) => i.groupId === id).length;
      message = `Delete group "${g?.name ?? ''}"? Its ${count} item${count === 1 ? '' : 's'} will stay, without a group.`;
    } else {
      const w = snap.workspaces.find((x) => x.id === id);
      const count = liveItems.filter((i) => i.workspaceId === id).length;
      message = `Delete workspace "${w?.name ?? ''}" and its ${count} item${count === 1 ? '' : 's'}?`;
    }
    if (!host.confirm(message)) return;
    const plan = removalPlan(snap, kind, id, host.now());
    if ('error' in plan) {
      host.toast(plan.error === 'last-workspace' ? 'The last workspace cannot be deleted.' : 'That is already gone.');
      return;
    }
    await save(plan.changed);
  }

  /**
   * @param {'item' | 'group' | 'workspace'} kind
   * @param {string} id
   * @param {number} delta
   */
  async function move(kind, id, delta) {
    const snap = host.snapshot();
    if (!snap) return;
    const changed = moveWithin(snap, kind, id, delta, host.now());
    if (changed.workspaces.length + changed.groups.length + changed.items.length === 0) return;
    await save(changed);
  }

  // ---------------------------------------------------------------- drag and drop (press and hold)

  const HOLD_MS = 300;
  const MOVE_SLOP = 10;
  const EDGE = 70;

  /**
   * @type {null | {kind: 'item' | 'group', id: string, ws: string, row: HTMLElement, startX: number, startY: number, active: boolean, x: number, y: number, timer: ReturnType<typeof setTimeout> | undefined, scroller: ReturnType<typeof setInterval> | undefined, target: {groupId?: string | null, index: number} | null}}
   */
  let drag = null;
  /** @type {HTMLElement | null} */
  let dropLine = null;

  /**
   * Work out where a drop at (x, y) would land and where to draw the insertion line.
   * @param {number} y
   * @returns {{target: {groupId?: string | null, index: number}, line: {top: number, left: number, width: number}} | null}
   */
  function locate(y) {
    if (!drag) return null;
    const section = document.querySelector(`section.workspace[data-ws="${CSS.escape(drag.ws)}"]`);
    if (!section) return null;
    if (drag.kind === 'group') {
      const blocks = [...section.querySelectorAll('.group[data-group-id]')].filter((b) => /** @type {HTMLElement} */ (b).dataset.groupId !== drag?.id);
      const index = blocks.filter((b) => y > b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2).length;
      const ref = blocks[index] ?? blocks[blocks.length - 1];
      if (!ref) return null;
      const r = ref.getBoundingClientRect();
      return { target: { index }, line: { top: blocks[index] ? r.top - 4 : r.bottom + 4, left: r.left, width: r.width } };
    }
    const containers = [...section.querySelectorAll('.group[data-container]')];
    if (containers.length === 0) return null;
    // the block under the pointer, else the nearest one
    let best = containers[0];
    let bestDistance = Infinity;
    for (const c of containers) {
      const r = c.getBoundingClientRect();
      const distance = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (distance < bestDistance) {
        best = c;
        bestDistance = distance;
      }
    }
    const rows = [...best.querySelectorAll('li[data-item-id]')].filter((li) => /** @type {HTMLElement} */ (li).dataset.itemId !== drag?.id);
    const index = rows.filter((li) => y > li.getBoundingClientRect().top + li.getBoundingClientRect().height / 2).length;
    const list = best.querySelector('ul.items');
    const r = (rows[index] ?? rows[rows.length - 1] ?? list ?? best).getBoundingClientRect();
    const container = /** @type {HTMLElement} */ (best).dataset.container ?? '';
    return { target: { groupId: container === '' ? null : container, index }, line: { top: rows[index] ? r.top : r.bottom, left: r.left, width: r.width } };
  }

  function updateDrag() {
    if (!drag || !drag.active) return;
    drag.row.style.transform = `translateY(${drag.y - drag.startY}px)`;
    const found = locate(drag.y);
    drag.target = found?.target ?? null;
    if (!dropLine) {
      dropLine = h('div', { class: 'drop-line' });
      document.body.append(dropLine);
    }
    if (found) {
      dropLine.hidden = false;
      dropLine.style.top = `${found.line.top}px`;
      dropLine.style.left = `${found.line.left}px`;
      dropLine.style.width = `${found.line.width}px`;
    } else {
      dropLine.hidden = true;
    }
  }

  function endDrag() {
    if (!drag) return;
    clearTimeout(drag.timer);
    clearInterval(drag.scroller);
    drag.row.style.transform = '';
    drag.row.classList.remove('dragging');
    document.body.classList.remove('drag-active');
    dropLine?.remove();
    dropLine = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    document.removeEventListener('keydown', onKeyDown);
    drag = null;
  }

  /** @param {PointerEvent} e */
  function onPointerMove(e) {
    if (!drag) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > MOVE_SLOP) endDrag(); // moved before the hold: not a drag
      return;
    }
    e.preventDefault();
    updateDrag();
  }

  /** @param {PointerEvent} e */
  async function onPointerUp(e) {
    if (!drag) return;
    const d = drag;
    const wasActive = d.active;
    d.y = e.clientY;
    if (wasActive) updateDrag();
    const target = d.target;
    endDrag();
    if (!wasActive || !target) return;
    const snap = host.snapshot();
    if (!snap) return;
    const plan = dropPlan(snap, { kind: d.kind, id: d.id }, target, host.now());
    if (plan.workspaces.length + plan.groups.length + plan.items.length > 0) await save(plan);
  }

  function onPointerCancel() {
    endDrag();
  }

  /** @param {KeyboardEvent} e */
  function onKeyDown(e) {
    if (e.key === 'Escape') endDrag();
  }

  /**
   * A drag handle: press and hold (about 300 ms), then drag the row to its new place.
   * @param {'item' | 'group'} kind
   * @param {string} id
   * @param {string} workspaceId
   * @param {string} label
   * @param {HTMLElement} row the element that moves with the finger
   * @returns {HTMLElement}
   */
  function dragHandle(kind, id, workspaceId, label, row) {
    const handle = h('button', { type: 'button', class: 'drag-handle', 'aria-label': `Drag ${label} (press and hold)`, title: 'Press and hold to drag' }, '\u22EE\u22EE');
    handle.addEventListener('contextmenu', (e) => e.preventDefault());
    handle.addEventListener('pointerdown', (e) => {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { kind, id, ws: workspaceId, row, startX: e.clientX, startY: e.clientY, active: false, x: e.clientX, y: e.clientY, timer: undefined, scroller: undefined, target: null };
      const d = drag;
      d.timer = setTimeout(() => {
        d.active = true;
        row.classList.add('dragging');
        document.body.classList.add('drag-active');
        try {
          handle.setPointerCapture(e.pointerId);
        } catch {
          // synthetic or already-released pointers cannot be captured; document listeners still work
        }
        d.scroller = setInterval(() => {
          if (d.y < EDGE) window.scrollBy(0, -14);
          else if (d.y > window.innerHeight - EDGE) window.scrollBy(0, 14);
          updateDrag();
        }, 30);
        updateDrag();
      }, HOLD_MS);
      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerCancel);
      document.addEventListener('keydown', onKeyDown);
    });
    return handle;
  }

  // ---------------------------------------------------------------- the edit-mode list

  /** The compact, low-contrast ↑ ↓ buttons (still at least 32 px to tap). */
  const ARROW = 'icon-btn small';

  /**
   * @param {Item} item
   * @returns {HTMLElement}
   */
  function itemRow(item) {
    const hidden = item.devices === 'desktop' ? ' · desktop only' : '';
    const row = h('li', { class: 'item edit-row', 'data-item-id': item.id });
    row.append(
      dragHandle('item', item.id, item.workspaceId, item.name, row),
      h('span', { class: 'name' }, item.name, h('br'), h('small', { class: 'hint' }, `${describeSchedule(item.schedule)}${hidden}`)),
      iconButton(ICON.edit, `Edit ${item.name}`, () => openItemSheet(item, false)),
      iconButton(ICON.up, `Move ${item.name} up`, () => void move('item', item.id, -1), ARROW),
      iconButton(ICON.down, `Move ${item.name} down`, () => void move('item', item.id, 1), ARROW),
      iconButton(ICON.del, `Delete ${item.name}`, () => void remove('item', item.id)),
    );
    return row;
  }

  /**
   * The whole edit-mode page: every live workspace, group and item (also the ones the phone checklist
   * hides: desktop-only and unscheduled items), each with its controls.
   * @param {Snapshot} snap
   * @returns {HTMLElement[]}
   */
  function renderEdit(snap) {
    const workspaces = snap.workspaces.filter((w) => !w.deleted).sort(byOrder);
    const groups = liveGroups(snap);
    const items = snap.items.filter((i) => !i.deleted).sort(byOrder);
    /** @type {HTMLElement[]} */
    const out = [];

    for (const ws of workspaces) {
      const section = h('section', { class: 'workspace', 'data-ws': ws.id });
      const head = h('h2', { class: 'edit-head' }, h('span', { class: 'grow' }, ws.name));
      head.append(
        iconButton(ICON.edit, `Rename workspace ${ws.name}`, () => renameEntity('workspace', ws)),
        iconButton(ICON.up, `Move workspace ${ws.name} up`, () => void move('workspace', ws.id, -1), ARROW),
        iconButton(ICON.down, `Move workspace ${ws.name} down`, () => void move('workspace', ws.id, 1), ARROW),
      );
      if (workspaces.length > 1) head.append(iconButton(ICON.del, `Delete workspace ${ws.name}`, () => void remove('workspace', ws.id)));
      section.append(head);

      const wsGroups = groups.filter((g) => g.workspaceId === ws.id).sort(byOrder);
      const wsItems = items.filter((i) => i.workspaceId === ws.id);
      for (const g of wsGroups) {
        const block = h('div', { class: 'group', 'data-container': g.id, 'data-group-id': g.id });
        const gh = h('h3', { class: 'edit-head' }, dragHandle('group', g.id, ws.id, `group ${g.name}`, block), h('span', { class: 'grow' }, g.name));
        gh.append(
          iconButton(ICON.edit, `Rename group ${g.name}`, () => renameEntity('group', g)),
          iconButton(ICON.up, `Move group ${g.name} up`, () => void move('group', g.id, -1), ARROW),
          iconButton(ICON.down, `Move group ${g.name} down`, () => void move('group', g.id, 1), ARROW),
          iconButton(ICON.del, `Delete group ${g.name}`, () => void remove('group', g.id)),
        );
        block.append(
          gh,
          h('ul', { class: 'items' }, ...wsItems.filter((i) => i.groupId === g.id).map(itemRow)),
          textButton('+ item', () => openItemSheet(newItem(snap, { workspaceId: ws.id, groupId: g.id }, host.now(), newId('it', host.randomUUID)), true), 'text-btn add'),
        );
        section.append(block);
      }
      const groupIds = new Set(wsGroups.map((g) => g.id));
      const ungrouped = wsItems.filter((i) => i.groupId === null || !groupIds.has(i.groupId));
      section.append(
        h(
          'div',
          { class: 'group', 'data-container': '' },
          h('h3', { class: 'edit-head' }, h('span', { class: 'grow' }, ungroupedLabelOf(ws))),
          h('ul', { class: 'items' }, ...ungrouped.map(itemRow)),
          textButton('+ item', () => openItemSheet(newItem(snap, { workspaceId: ws.id }, host.now(), newId('it', host.randomUUID)), true), 'text-btn add'),
        ),
        textButton('+ group', () => addGroup(ws.id), 'text-btn add'),
      );
      out.push(section);
    }
    out.push(h('div', { class: 'edit-footer' }, textButton('+ workspace', addWorkspace, 'text-btn add'), textButton(`${ICON.gear} Settings`, openSettingsSheet, 'text-btn')));
    return out;
  }

  return { renderEdit, closeSheet, isDragging: () => drag?.active === true };
}