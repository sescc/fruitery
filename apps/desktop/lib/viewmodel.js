// @ts-check
// View-model helpers for the UI (pure, so they are unit tested): what the item list shows, what
// "Next" means, which badge totals the rail shows, and the layout the UI falls back to.

import { bucket, nextDue, ungroupedLabelOf } from '../../../packages/core/index.js';
import { leaf } from './layout.js';

/** @typedef {import('../../../packages/core/model.js').Item} Item */
/** @typedef {import('../../../packages/core/model.js').Group} Group */
/** @typedef {import('../../../packages/core/model.js').Workspace} Workspace */
/** @typedef {import('../../../packages/core/schedule.js').Completion} Completion */
/** @typedef {'due' | 'done' | 'notDue' | null} Bucket */
/** @typedef {{item: Item, bucket: Bucket, nextDue: string | null}} Row */
/** @typedef {{id: string | null, name: string, collapsed: boolean, rows: Row[], done: number, total: number}} Section */
/** @typedef {{workspaces: Workspace[], groups: Group[], items: Item[], settings: {timezone: string}, completions: Completion[]}} Snapshot */

/** @template {{order: number, id: string}} T @param {T[]} list @returns {T[]} */
const byOrder = (list) => [...list].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Live workspaces in rail order.
 * @param {Snapshot} snap
 * @returns {Workspace[]}
 */
export function liveWorkspaces(snap) {
  return byOrder(snap.workspaces.filter((w) => !w.deleted));
}

/**
 * Items shown on this PC for a workspace (phone-only items are hidden), by order.
 * @param {Snapshot} snap
 * @param {string} workspaceId
 * @returns {Item[]}
 */
export function visibleItems(snap, workspaceId) {
  return byOrder(snap.items.filter((i) => !i.deleted && i.workspaceId === workspaceId && i.devices !== 'phone'));
}

/**
 * The item list of a workspace: sections (live groups in order, then the workspace's label (core `ungroupedLabelOf`, default "Default") for ungrouped items when named groups exist),
 * each with its due / done / unscheduled rows and "done/total" progress; items that are not due
 * today go to `notDue` with their next date (D29). `basketFull` is true when the workspace has
 * scheduled items, at least one is done today and none is still due.
 * @param {Snapshot} snap
 * @param {string} workspaceId
 * @param {number} now epoch ms
 * @returns {{sections: Section[], notDue: Row[], basketFull: boolean, order: string[]}}
 */
export function listModel(snap, workspaceId, now) {
  const tz = snap.settings.timezone;
  const items = visibleItems(snap, workspaceId);
  /** @type {Row[]} */
  const rows = items.map((item) => ({
    item,
    bucket: bucket(item, snap.completions, now, tz),
    nextDue: item.schedule ? nextDue(item, snap.completions, now, tz) : null,
  }));
  const groups = byOrder(snap.groups.filter((g) => !g.deleted && g.workspaceId === workspaceId));
  const groupIds = new Set(groups.map((g) => g.id));
  /** @type {Row[]} */
  const notDue = rows.filter((r) => r.bucket === 'notDue');
  const shown = rows.filter((r) => r.bucket !== 'notDue');
  /** @param {Row[]} rs */
  const progress = (rs) => {
    const scheduled = rs.filter((r) => r.bucket === 'due' || r.bucket === 'done');
    return { done: scheduled.filter((r) => r.bucket === 'done').length, total: scheduled.length };
  };
  /** @type {Section[]} */
  const sections = [];
  for (const g of groups) {
    const rs = shown.filter((r) => r.item.groupId === g.id);
    sections.push({ id: g.id, name: g.name, collapsed: g.collapsed === true, rows: rs, ...progress(rs) });
  }
  const loose = shown.filter((r) => r.item.groupId === null || r.item.groupId === undefined || !groupIds.has(r.item.groupId));
  // no header for ungrouped items when the workspace has no named group; otherwise the workspace's own label
  const ws = snap.workspaces.find((w) => w.id === workspaceId);
  if (loose.length > 0) sections.push({ id: null, name: groups.length > 0 ? ungroupedLabelOf(ws) : '', collapsed: false, rows: loose, ...progress(loose) });
  const all = progress(rows);
  const dueCount = rows.filter((r) => r.bucket === 'due').length;
  const order = [...sections.flatMap((s) => s.rows.map((r) => r.item.id)), ...notDue.map((r) => r.item.id)];
  return { sections, notDue, basketFull: all.total > 0 && dueCount === 0 && all.done > 0, order };
}

/**
 * The next due item after `currentId` in list order, wrapping around; null when nothing else is due.
 * @param {{sections: Section[]}} model
 * @param {string | null} currentId
 * @returns {string | null}
 */
export function nextDueId(model, currentId) {
  const dueIds = model.sections.flatMap((s) => s.rows.filter((r) => r.bucket === 'due').map((r) => r.item.id));
  const candidates = dueIds.filter((id) => id !== currentId);
  if (candidates.length === 0) return null;
  const flat = model.sections.flatMap((s) => s.rows.map((r) => r.item.id));
  const at = currentId === null ? -1 : flat.indexOf(currentId);
  if (at < 0) return candidates[0];
  const after = flat.slice(at + 1).find((id) => candidates.includes(id));
  return after ?? candidates[0];
}

/**
 * The item the Daily bar's Done / Next moves to: the next due item after `itemId` in the list order of
 * the item's own workspace (wrapping), never the item itself; null when nothing else is due or the item
 * is unknown.
 * @param {Snapshot} snap
 * @param {string} itemId
 * @param {number} now epoch ms
 * @returns {string | null}
 */
export function nextDueForItem(snap, itemId, now) {
  const item = snap.items.find((i) => i.id === itemId && !i.deleted);
  if (!item) return null;
  return nextDueId(listModel(snap, item.workspaceId, now), itemId);
}

/**
 * What the list shows as an item's icon (D116): the emoji or letter typed in the Icon field, else the
 * site's saved icon, else the first letter of the name.
 * @param {{name: string, icon?: string | null}} item
 * @param {boolean} hasSiteIcon
 * @returns {{kind: 'text', text: string} | {kind: 'image'} | {kind: 'letter', text: string}}
 */
export function iconChoice(item, hasSiteIcon) {
  const typed = typeof item.icon === 'string' ? item.icon.trim() : '';
  if (typed !== '') return { kind: 'text', text: typed };
  if (hasSiteIcon) return { kind: 'image' };
  const first = Array.from(String(item.name ?? '').trim())[0];
  return { kind: 'letter', text: first ? first.toUpperCase() : '?' };
}

/**
 * Whether "Done with <name>?" is worth asking after an item was opened elsewhere: only a scheduled item
 * that is still due.
 * @param {{schedule?: unknown} | null | undefined} item
 * @param {Bucket} bucketNow
 * @returns {boolean}
 */
export function shouldOfferTick(item, bucketNow) {
  return Boolean(item && item.schedule) && bucketNow === 'due';
}

/**
 * The next / previous id in a cycle (Ctrl+Tab); the first when the current one is not in the list.
 * @param {string[]} order
 * @param {string | null} currentId
 * @param {1 | -1} delta
 * @returns {string | null}
 */
export function cycle(order, currentId, delta) {
  if (order.length === 0) return null;
  const at = currentId === null ? -1 : order.indexOf(currentId);
  if (at < 0) return delta === 1 ? order[0] : order[order.length - 1];
  return order[(at + delta + order.length) % order.length];
}

/**
 * Sum of the title badges of a workspace's items.
 * @param {Snapshot} snap
 * @param {string} workspaceId
 * @param {Record<string, number>} badges item id -> count
 * @returns {number}
 */
export function badgeTotal(snap, workspaceId, badges) {
  let sum = 0;
  for (const i of snap.items) if (!i.deleted && i.workspaceId === workspaceId && i.badge) sum += badges[i.id] ?? 0;
  return sum;
}

/**
 * The layout of a workspace: the stored one, else a single pane showing the last shown item.
 * @param {{layouts: Record<string, import('./layout.js').Layout>, activeItemByWorkspace: Record<string, string>}} device
 * @param {string} workspaceId
 * @returns {import('./layout.js').Layout}
 */
export function layoutOrDefault(device, workspaceId) {
  return device.layouts[workspaceId] ?? leaf('p1', device.activeItemByWorkspace[workspaceId] ?? null);
}

/**
 * What F3 edits: the entry that has keyboard focus in the app UI (a list row, a group header or a
 * rail entry), if the key went to the UI; otherwise the item shown in the focused pane. Nothing
 * selected means nothing to edit.
 * @param {{kind: string, id: string} | null | undefined} focused the focused UI entry, if any
 * @param {string | null | undefined} paneItemId the item of the focused pane
 * @returns {{kind: 'item' | 'group' | 'workspace', id: string} | null}
 */
export function editTarget(focused, paneItemId) {
  if (focused && typeof focused.id === 'string' && focused.id !== '' && (focused.kind === 'item' || focused.kind === 'group' || focused.kind === 'workspace')) {
    return { kind: focused.kind, id: focused.id };
  }
  if (typeof paneItemId === 'string' && paneItemId !== '') return { kind: 'item', id: paneItemId };
  return null;
}
