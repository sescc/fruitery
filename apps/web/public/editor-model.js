// @ts-check
// Pure model behind the phone editor (no DOM, no clock, no randomness of its own): turns form values
// into stamped entities, moves siblings, and phrases validation errors. The phone form is a view
// over `Item`, not a new type. Desktop-only fields are never touched here (D89).

import { moveItem, reorder } from './core/index.js';

/** @typedef {import('./core/model.js').Workspace} Workspace */
/** @typedef {import('./core/model.js').Group} Group */
/** @typedef {import('./core/model.js').Item} Item */
/** @typedef {import('./core/schedule.js').Schedule} Schedule */
/** @typedef {{workspaces: Workspace[], groups: Group[], items: Item[]}} Entities */
/** @typedef {{field: string, code: string}} FieldError */

/**
 * The only item fields the phone may change. Everything else (program path, kind, open-in-Edge,
 * sleep time, user-agent preset, isolation, keep-logins, icon, order, ...) is preserved as is.
 */
export const PHONE_FIELDS = Object.freeze(['name', 'url', 'fallbackUrl', 'deepLink', 'workspaceId', 'groupId', 'schedule', 'resetTime', 'devices', 'notify', 'badge']);

/**
 * @param {string} prefix e.g. 'it'
 * @param {() => string} randomUUID injected (the app passes `crypto.randomUUID`)
 * @returns {string}
 */
export function newId(prefix, randomUUID) {
  return `${prefix}-${randomUUID()}`;
}

/**
 * `order` for a new last sibling.
 * @param {{order: number}[]} siblings
 * @returns {number}
 */
function lastOrder(siblings) {
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.order)) + 1;
}

/**
 * Live items sharing a workspace and group.
 * @param {Item[]} items
 * @param {string} workspaceId
 * @param {string | null} groupId
 * @param {string} [exceptId]
 * @returns {Item[]}
 */
function itemSiblings(items, workspaceId, groupId, exceptId) {
  return items.filter((i) => !i.deleted && i.id !== exceptId && i.workspaceId === workspaceId && (i.groupId ?? null) === (groupId ?? null));
}

/**
 * A new item with the phone's defaults, last among its siblings. Name and URL are left for the form.
 * @param {{items: Item[]}} snapshot
 * @param {{workspaceId: string, groupId?: string | null}} where
 * @param {number} nowMs
 * @param {string} id
 * @returns {Item}
 */
export function newItem(snapshot, where, nowMs, id) {
  const groupId = where.groupId ?? null;
  return {
    id,
    workspaceId: where.workspaceId,
    groupId,
    order: lastOrder(itemSiblings(snapshot.items, where.workspaceId, groupId)),
    name: '',
    icon: null,
    kind: 'web',
    url: null,
    appPath: null,
    fallbackUrl: null,
    devices: 'all',
    schedule: groupId === null ? null : { type: 'daily' },
    resetTime: '00:00',
    notify: false,
    badge: false,
    edge: { mode: 'inherit', profile: null },
    isolate: false,
    persistSessionCookies: true,
    sleepAfterMin: null,
    userAgent: { preset: 'default', custom: null },
    deepLink: null,
    updatedAt: nowMs,
    deleted: false,
  };
}

/**
 * @param {unknown} v
 * @returns {string | null} a trimmed string, or null when blank or not a string
 */
function textOrNull(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Apply form values to a copy of an item. Only `PHONE_FIELDS` present in `form` are copied, so every
 * desktop-only field survives (D89); `updatedAt` is stamped. Changing the workspace goes through core
 * `moveItem` (which clears the group unless the form also names one); an item that changes workspace
 * or group is placed last among its new siblings when `snapshot` is given.
 * @param {Item} item
 * @param {Record<string, unknown>} form values by field name (strings as typed; `schedule` a Schedule or null)
 * @param {number} nowMs
 * @param {{items: Item[]}} [snapshot] for placing a moved item last
 * @returns {Item} a new object; the input is not mutated
 */
export function applyForm(item, form, nowMs, snapshot) {
  let out = /** @type {Item} */ (structuredClone(item));
  const has = (/** @type {string} */ k) => Object.prototype.hasOwnProperty.call(form, k);

  if (has('name')) out.name = typeof form.name === 'string' ? form.name.trim() : '';
  if (has('url')) out.url = textOrNull(form.url);
  if (has('fallbackUrl')) out.fallbackUrl = textOrNull(form.fallbackUrl);
  if (has('deepLink')) out.deepLink = textOrNull(form.deepLink);
  if (has('schedule')) out.schedule = form.schedule ? /** @type {Schedule} */ (structuredClone(form.schedule)) : null;
  if (has('resetTime')) out.resetTime = /** @type {string} */ (form.resetTime);
  if (has('devices')) out.devices = /** @type {Item['devices']} */ (form.devices);
  if (has('notify')) out.notify = form.notify === true;
  if (has('badge')) out.badge = form.badge === true;

  const wasWorkspace = item.workspaceId;
  const wasGroup = item.groupId ?? null;
  if (has('workspaceId') && typeof form.workspaceId === 'string' && form.workspaceId !== wasWorkspace) {
    out = /** @type {Item} */ (moveItem(out, form.workspaceId, nowMs)); // clears the group
  }
  if (has('groupId')) out.groupId = textOrNull(form.groupId);

  const moved = out.workspaceId !== wasWorkspace || (out.groupId ?? null) !== wasGroup;
  if (moved && snapshot) out.order = lastOrder(itemSiblings(snapshot.items, out.workspaceId, out.groupId, out.id));
  out.updatedAt = nowMs;
  return out;
}

/**
 * The inverse of `applyForm`: form values for prefilling the item sheet.
 * @param {Item} item
 * @returns {{name: string, url: string, fallbackUrl: string, deepLink: string, workspaceId: string, groupId: string, schedule: Schedule | null, resetTime: string, devices: Item['devices'], notify: boolean, badge: boolean}}
 */
export function formFromItem(item) {
  return {
    name: item.name,
    url: item.url ?? '',
    fallbackUrl: item.fallbackUrl ?? '',
    deepLink: item.deepLink ?? '',
    workspaceId: item.workspaceId,
    groupId: item.groupId ?? '',
    schedule: item.schedule ? /** @type {Schedule} */ (structuredClone(item.schedule)) : null,
    resetTime: item.resetTime,
    devices: item.devices,
    notify: item.notify,
    badge: item.badge,
  };
}

/**
 * Build a schedule from the sheet's separate fields. `type` 'none' (or anything unknown) gives null.
 * Number fields arrive as typed strings or numbers.
 * @param {{type: string, weekday?: unknown, day?: unknown, n?: unknown, startDate?: unknown}} fields
 * @returns {Schedule | null}
 */
export function scheduleFromFields(fields) {
  const int = (/** @type {unknown} */ v) => (typeof v === 'number' ? v : Number(String(v ?? '').trim() === '' ? Number.NaN : v));
  switch (fields.type) {
    case 'daily':
      return { type: 'daily' };
    case 'weekly':
      return { type: 'weekly', weekday: int(fields.weekday) };
    case 'monthly':
      return { type: 'monthly', day: int(fields.day) };
    case 'everyNDays':
      return { type: 'everyNDays', n: int(fields.n), startDate: String(fields.startDate ?? '') };
    default:
      return null;
  }
}

/**
 * The sheet's fields for a schedule (the inverse of `scheduleFromFields`).
 * @param {Schedule | null} schedule
 * @returns {{type: string, weekday: number, day: number, n: number, startDate: string}}
 */
export function scheduleFields(schedule) {
  const base = { type: 'none', weekday: 1, day: 1, n: 2, startDate: '' };
  if (!schedule) return base;
  return { ...base, ...schedule };
}

/**
 * @param {Entities} snapshot
 * @param {'item' | 'group' | 'workspace'} kind
 * @param {string} id
 * @returns {{all: {id: string, order: number, updatedAt: number}[], siblings: {id: string, order: number, updatedAt: number}[]} | null}
 */
function siblingsOf(snapshot, kind, id) {
  if (kind === 'item') {
    const item = snapshot.items.find((i) => i.id === id && !i.deleted);
    return item ? { all: snapshot.items, siblings: itemSiblings(snapshot.items, item.workspaceId, item.groupId ?? null) } : null;
  }
  if (kind === 'group') {
    const group = snapshot.groups.find((g) => g.id === id && !g.deleted);
    return group ? { all: snapshot.groups, siblings: snapshot.groups.filter((g) => !g.deleted && g.workspaceId === group.workspaceId) } : null;
  }
  const ws = snapshot.workspaces.find((w) => w.id === id && !w.deleted);
  return ws ? { all: snapshot.workspaces, siblings: snapshot.workspaces.filter((w) => !w.deleted) } : null;
}

/**
 * Move an entity up (delta -1) or down (+1) among its siblings (items of the same workspace and
 * group, groups of the same workspace, or workspaces), using core `reorder`. Returns only the
 * entities whose `order` changed; moving past either end changes nothing.
 * @param {Entities} snapshot
 * @param {'item' | 'group' | 'workspace'} kind
 * @param {string} id
 * @param {number} delta
 * @param {number} nowMs
 * @returns {Entities}
 */
export function moveWithin(snapshot, kind, id, delta, nowMs) {
  /** @type {Entities} */
  const changed = { workspaces: [], groups: [], items: [] };
  const found = siblingsOf(snapshot, kind, id);
  if (!found) return changed;
  const sorted = [...found.siblings].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const from = sorted.findIndex((s) => s.id === id);
  const to = from + delta;
  if (!Number.isInteger(delta) || delta === 0 || to < 0 || to >= sorted.length) return changed;
  const key = kind === 'item' ? 'items' : kind === 'group' ? 'groups' : 'workspaces';
  for (const next of reorder(sorted, id, to, nowMs)) {
    const before = sorted.find((s) => s.id === next.id);
    if (before && before.order !== next.order) /** @type {any[]} */ (changed[key]).push(next);
  }
  return changed;
}

/**
 * @param {{groups: Group[]}} snapshot
 * @param {string} workspaceId
 * @param {string} name
 * @param {number} nowMs
 * @param {string} id
 * @returns {Group}
 */
export function newGroup(snapshot, workspaceId, name, nowMs, id) {
  const siblings = snapshot.groups.filter((g) => !g.deleted && g.workspaceId === workspaceId);
  return { id, workspaceId, name: name.trim(), order: lastOrder(siblings), collapsed: false, updatedAt: nowMs, deleted: false };
}

/**
 * A new workspace with the defaults the desktop uses (sleeps after 10 minutes, not opened in Edge).
 * @param {{workspaces: Workspace[]}} snapshot
 * @param {string} name
 * @param {number} nowMs
 * @param {string} id
 * @returns {Workspace}
 */
export function newWorkspace(snapshot, name, nowMs, id) {
  return {
    id,
    name: name.trim(),
    icon: null,
    order: lastOrder(snapshot.workspaces.filter((w) => !w.deleted)),
    sleepAfterMin: 10,
    openInEdge: false,
    ungroupedLabel: null,
    updatedAt: nowMs,
    deleted: false,
  };
}

/**
 * Where an item really belongs for display: its group when that group is live in its workspace,
 * otherwise "no group" (null), like the checklist and the editor list show it.
 * @param {Item} item
 * @param {Group[]} groups
 * @returns {string | null}
 */
function effectiveGroup(item, groups) {
  return item.groupId !== null && item.groupId !== undefined && groups.some((g) => !g.deleted && g.id === item.groupId && g.workspaceId === item.workspaceId) ? item.groupId : null;
}

/**
 * Plan a drag-and-drop reorder. `target.index` is the insertion position among the target's siblings
 * as displayed with the dragged entity taken out (0 = first). Items may be dropped into any live group
 * of their own workspace or into "no group" (`groupId: null`); groups only reorder within their
 * workspace. Uses core `reorder`, so orders are renumbered densely and only entities that changed are
 * returned, stamped with `nowMs`. A drop that leaves everything where it was, or an invalid drop
 * (unknown or deleted ids, a group of another workspace), returns no changes.
 * @param {Entities} snapshot
 * @param {{kind: 'item' | 'group', id: string}} drag
 * @param {{groupId?: string | null, index: number}} target
 * @param {number} nowMs
 * @returns {Entities}
 */
export function dropPlan(snapshot, drag, target, nowMs) {
  /** @type {Entities} */
  const none = { workspaces: [], groups: [], items: [] };
  /** @type {Entities} */
  const changed = { workspaces: [], groups: [], items: [] };
  const index = Number.isFinite(target.index) ? Math.trunc(target.index) : 0;
  /** @param {{id: string, order: number}[]} list */
  const sequence = (list) => [...list].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((e) => e.id);

  if (drag.kind === 'group') {
    const group = snapshot.groups.find((g) => g.id === drag.id && !g.deleted);
    if (!group) return none;
    const siblings = snapshot.groups.filter((g) => !g.deleted && g.workspaceId === group.workspaceId);
    const result = reorder(siblings, group.id, index, nowMs);
    if (sequence(result).join() === sequence(siblings).join()) return none;
    for (const next of result) if (next.order !== siblings.find((s) => s.id === next.id)?.order) changed.groups.push(next);
    return changed;
  }

  const item = snapshot.items.find((i) => i.id === drag.id && !i.deleted);
  if (!item) return none;
  const newGroup = target.groupId ?? null;
  if (newGroup !== null && !snapshot.groups.some((g) => !g.deleted && g.id === newGroup && g.workspaceId === item.workspaceId)) return none;
  const oldGroup = effectiveGroup(item, snapshot.groups);
  const siblings = snapshot.items.filter((i) => !i.deleted && i.id !== item.id && i.workspaceId === item.workspaceId && effectiveGroup(i, snapshot.groups) === newGroup);
  const moved = { ...structuredClone(item), groupId: newGroup };
  const result = reorder([...siblings, moved], item.id, index, nowMs);
  const groupChanged = oldGroup !== newGroup;
  if (!groupChanged && sequence(result).join() === sequence([...siblings, item]).join()) return none;
  for (const next of result) {
    const original = snapshot.items.find((i) => i.id === next.id);
    if (next.id === item.id) {
      if (groupChanged || next.order !== original?.order) changed.items.push({ ...next, groupId: newGroup, updatedAt: nowMs });
    } else if (next.order !== original?.order) {
      changed.items.push(next);
    }
  }
  return changed;
}
/**
 * A renamed copy (workspace or group), stamped.
 * @template {{name: string, updatedAt: number}} T
 * @param {T} entity
 * @param {string} name
 * @param {number} nowMs
 * @returns {T}
 */
export function rename(entity, name, nowMs) {
  return { ...structuredClone(entity), name: name.trim(), updatedAt: nowMs };
}

/**
 * Validation for the name of a group or workspace (items are checked by core `validateItem`).
 * @param {unknown} name
 * @returns {FieldError[]}
 */
export function checkName(name) {
  return typeof name === 'string' && name.trim() !== '' ? [] : [{ field: 'name', code: 'required' }];
}

const MESSAGES = /** @type {Record<string, string>} */ ({
  required: 'Required',
  'invalid-url': 'Must start with http:// or https://',
  'invalid-deep-link': 'Not a safe app link (e.g. intent://… or myapp://…; no javascript:/data:/file:)',
  'invalid-time': 'Use HH:MM, from 00:00 to 23:59',
  'invalid-date': 'Not a real date (use YYYY-MM-DD)',
  'invalid-value': 'Not an allowed value',
  'invalid-type': 'Wrong kind of value',
  'out-of-range': 'Out of range',
  'unknown-token': 'Unknown {placeholder}',
  'group-workspace-mismatch': 'That group belongs to another workspace',
  'group-not-found': 'That group no longer exists',
  'invalid-timezone': 'Unknown timezone',
});

/**
 * Short messages per form field. Accepts a list of `{field, code}` (client-side `validateItem`) or the
 * `details` of a 422 answer (`[{id, errors: [{field, code}]}]`). Several errors on one field are joined.
 * @param {FieldError[] | {id?: string, errors: FieldError[]}[] | null | undefined} errors
 * @returns {Record<string, string>}
 */
export function errorsByField(errors) {
  /** @type {FieldError[]} */
  const flat = [];
  for (const e of errors ?? []) {
    if (e && 'errors' in e && Array.isArray(e.errors)) flat.push(...e.errors);
    else if (e && 'field' in e) flat.push(e);
  }
  /** @type {Record<string, string[]>} */
  const grouped = {};
  for (const { field, code } of flat) {
    const message = MESSAGES[code] ?? 'Not accepted';
    (grouped[field] ??= []).includes(message) || grouped[field].push(message);
  }
  return Object.fromEntries(Object.entries(grouped).map(([f, m]) => [f, m.join('; ')]));
}

/**
 * A copy of a workspace with a new name and ungrouped label, stamped. A blank label becomes null
 * ("Default").
 * @param {Workspace} workspace
 * @param {{name: string, ungroupedLabel: string}} form
 * @param {number} nowMs
 * @returns {Workspace}
 */
export function renameWorkspace(workspace, form, nowMs) {
  const label = form.ungroupedLabel.trim();
  return { ...structuredClone(workspace), name: form.name.trim(), ungroupedLabel: label === '' ? null : label, updatedAt: nowMs };
}