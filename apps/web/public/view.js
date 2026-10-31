// @ts-check
// Pure view model of the phone checklist (no DOM, no clock): a deduction from the snapshot and the
// current instant using the shared core. In the built app `./core/` is a copy of packages/core.

import { bucket, expandUrl, isUsableDeepLink, nextDue, periodKey, ungroupedLabelOf } from './core/index.js';

/** @typedef {import('./core/model.js').Workspace} Workspace */
/** @typedef {import('./core/model.js').Group} Group */
/** @typedef {import('./core/model.js').Item} Item */
/** @typedef {import('./core/model.js').Settings} Settings */
/** @typedef {import('./core/schedule.js').Completion} Completion */
/** @typedef {{workspaces: Workspace[], groups: Group[], items: Item[], settings?: Settings, completions: Completion[]}} Snapshot */
/** @typedef {{id: string, name: string, icon: string | null, iconUrl: string | null, bucket: 'due' | 'done' | 'notDue' | 'link', nextDue: string | null, href: string | null, hint: 'set-google-email' | null, webHref: string | null}} ItemView `bucket` 'link' = an unscheduled item (a link row, no tick); `href` is the open-target (a deep link when set), `webHref` the web escape-hatch shown only alongside a deep link */
/** @typedef {{id: string | null, name: string, progress: {done: number, total: number}, items: ItemView[]}} GroupView `progress` counts the check-ins only, never the link rows */
/** @typedef {{id: string, name: string, groups: GroupView[], notDue: ItemView[]}} WorkspaceView */

/**
 * @param {{order: number, id: string}} a
 * @param {{order: number, id: string}} b
 * @returns {number}
 */
function byOrder(a, b) {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The address to open for an item: web items use `url` (falling back to `fallbackUrl`), app items
 * use `fallbackUrl`; placeholders are filled for the current time. `hint` explains a missing link.
 * A usable `deepLink` (an installed-app target, phone only) takes over as the primary `href`; when
 * the item also has a web link that web link is returned as `webHref`, so the row can show a small
 * "↗ web" escape-hatch chip. Without a deep link `href` is the web link and `webHref` is null.
 * @param {Item} item
 * @param {number} nowMs
 * @param {Settings} settings
 * @returns {{href: string | null, hint: 'set-google-email' | null, webHref: string | null}}
 */
function linkOf(item, nowMs, settings) {
  const blank = (/** @type {string | null | undefined} */ s) => s === null || s === undefined || s.trim() === '';
  /** The expanded web open-target, or a hint when a token is missing/unknown. */
  const webOf = () => {
    const template = item.kind === 'app' ? item.fallbackUrl : blank(item.url) ? item.fallbackUrl : item.url;
    if (blank(template)) return { href: null, hint: /** @type {'set-google-email' | null} */ (null) };
    try {
      const r = expandUrl(/** @type {string} */ (template), nowMs, settings.timezone, settings);
      if (r.missing.includes('googleEmail')) return { href: null, hint: /** @type {const} */ ('set-google-email') };
      if (r.unknown.length > 0) return { href: null, hint: null };
      return { href: r.url, hint: null };
    } catch {
      return { href: null, hint: null };
    }
  };
  const web = webOf();
  // a deep link is validated defensively here: a bad stored value is ignored and the web link is used
  if (isUsableDeepLink(item.deepLink)) {
    return { href: /** @type {string} */ (item.deepLink), hint: null, webHref: web.href };
  }
  return { href: web.href, hint: web.hint, webHref: null };
}

/**
 * The icon of an item (D116): the emoji or letter typed in its Icon field, and the address of its site's
 * own icon (the origin of the item's address plus `/favicon.ico`), null unless that address is http(s).
 * The origin comes from the saved address as written (a placeholder can only change the path or the
 * query, never the host; an address that is not a valid URL as written has no icon).
 * @param {Item} item
 * @returns {{icon: string | null, iconUrl: string | null}}
 */
export function iconOf(item) {
  const typed = typeof item.icon === 'string' ? item.icon.trim() : '';
  const template = item.kind === 'app' ? item.fallbackUrl : typeof item.url === 'string' && item.url.trim() !== '' ? item.url : item.fallbackUrl;
  let iconUrl = null;
  if (typeof template === 'string') {
    try {
      const u = new URL(template.trim());
      // a placeholder such as {googleEmail} is not a host name (the URL parser would accept the braces)
      const plainHost = /^[a-z0-9.-]+$/i.test(u.hostname) || /^\[[0-9a-f:.]+\]$/i.test(u.hostname);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && plainHost) iconUrl = `${u.origin}/favicon.ico`;
    } catch {
      iconUrl = null;
    }
  }
  return { icon: typed === '' ? null : typed, iconUrl };
}

/**
 * The letter an item shows when it has no usable icon.
 * @param {string} name
 * @returns {string}
 */
export function letterOf(name) {
  const first = Array.from(String(name ?? '').trim())[0];
  return first ? first.toUpperCase() : '?';
}
/**
 * Build what the phone shows: live items visible on the phone, per workspace and group, in stored order.
 * Items with a schedule are check-ins: groups list the due and done ones (progress counts exactly these);
 * not-due ones collect in the workspace's `notDue` list. Items without a schedule are link rows
 * (`bucket: 'link'`) inside their own group, opened like check-ins and never counted anywhere. Items
 * without a live group form the last group, named by the workspace's ungrouped label (default "Default";
 * id null). Workspaces and groups with nothing to show are omitted; a group of only links is shown.
 * @param {Snapshot} snapshot
 * @param {number} nowMs
 * @returns {{workspaces: WorkspaceView[]}}
 */
export function buildView(snapshot, nowMs) {
  /** @type {Settings} */
  const settings = snapshot.settings ?? { timezone: 'UTC', googleEmail: null, updatedAt: 0 };
  const liveGroups = snapshot.groups.filter((g) => !g.deleted);
  /** @type {WorkspaceView[]} */
  const workspaces = [];

  for (const ws of [...snapshot.workspaces].filter((w) => !w.deleted).sort(byOrder)) {
    const items = snapshot.items
      .filter((i) => !i.deleted && i.workspaceId === ws.id && (i.devices === 'all' || i.devices === 'phone'))
      .sort(byOrder);
    /** @type {Map<string | null, ItemView[]>} */
    const byGroup = new Map();
    /** @type {ItemView[]} */
    const notDue = [];
    for (const item of items) {
      const isLink = !item.schedule;
      const b = isLink ? 'link' : /** @type {'due' | 'done' | 'notDue'} */ (bucket(item, snapshot.completions, nowMs, settings.timezone));
      const view = {
        id: item.id,
        name: item.name,
        ...iconOf(item),
        bucket: b,
        nextDue: isLink ? null : nextDue(item, snapshot.completions, nowMs, settings.timezone),
        ...linkOf(item, nowMs, settings),
      };
      if (b === 'notDue') {
        notDue.push(view);
        continue;
      }
      const group = item.groupId === null ? undefined : liveGroups.find((g) => g.id === item.groupId && g.workspaceId === ws.id);
      const key = group ? group.id : null;
      const list = byGroup.get(key);
      if (list) list.push(view);
      else byGroup.set(key, [view]);
    }

    /** @type {GroupView[]} */
    const groups = [];
    for (const g of liveGroups.filter((x) => x.workspaceId === ws.id).sort(byOrder)) {
      const list = byGroup.get(g.id);
      if (list) groups.push(groupView(g.id, g.name, list));
    }
    const other = byGroup.get(null);
    if (other) groups.push(groupView(null, ungroupedLabelOf(ws), other));

    if (groups.length > 0 || notDue.length > 0) workspaces.push({ id: ws.id, name: ws.name, groups, notDue });
  }
  return { workspaces };
}

/**
 * @param {string | null} id
 * @param {string} name
 * @param {ItemView[]} items
 * @returns {GroupView} progress over the check-ins only (link rows are not counted)
 */
function groupView(id, name, items) {
  const checkIns = items.filter((i) => i.bucket !== 'link');
  return { id, name, progress: { done: checkIns.filter((i) => i.bucket === 'done').length, total: checkIns.length }, items };
}

/**
 * Whole-day progress across every group.
 * @param {{workspaces: WorkspaceView[]}} view
 * @returns {{done: number, total: number, complete: boolean}} `complete` = something to do and all of it done
 */
export function dayProgress(view) {
  let done = 0;
  let total = 0;
  for (const w of view.workspaces) {
    for (const g of w.groups) {
      done += g.progress.done;
      total += g.progress.total;
    }
  }
  return { done, total, complete: total > 0 && done === total };
}

/**
 * A copy of the snapshot with the item ticked for its current period (optimistic update).
 * Unknown, deleted or unschedulable items return the snapshot unchanged.
 * @param {Snapshot} snapshot
 * @param {string} itemId
 * @param {number} nowMs
 * @returns {Snapshot}
 */
export function withTick(snapshot, itemId, nowMs) {
  const item = snapshot.items.find((i) => i.id === itemId);
  if (!item || item.deleted || !item.schedule) return snapshot;
  const pk = periodKey(item.schedule, nowMs, snapshot.settings?.timezone ?? 'UTC', item.resetTime);
  if (pk === null) return snapshot;
  const others = snapshot.completions.filter((c) => !(c.itemId === itemId && c.periodKey === pk));
  return { ...snapshot, completions: [...others, { itemId, periodKey: pk, doneAt: nowMs }] };
}

/**
 * A copy of the snapshot with the item's current-period tick removed (optimistic update).
 * @param {Snapshot} snapshot
 * @param {string} itemId
 * @param {number} nowMs
 * @returns {Snapshot}
 */
export function withoutTick(snapshot, itemId, nowMs) {
  const item = snapshot.items.find((i) => i.id === itemId);
  if (!item || !item.schedule) return snapshot;
  const pk = periodKey(item.schedule, nowMs, snapshot.settings?.timezone ?? 'UTC', item.resetTime);
  if (pk === null) return snapshot;
  return { ...snapshot, completions: snapshot.completions.filter((c) => !(c.itemId === itemId && c.periodKey === pk)) };
}

/** localStorage key under which the app keeps the last successfully loaded snapshot. */
export const SNAPSHOT_KEY = 'fruitery:lastSnapshot';

/**
 * The text stored for offline cold starts: only the snapshot data plus when it was saved.
 * @param {Snapshot} snapshot
 * @param {number} nowMs
 * @returns {string}
 */
export function serializeSnapshot(snapshot, nowMs) {
  const { workspaces, groups, items, settings, completions } = snapshot;
  return JSON.stringify({ savedAt: nowMs, snapshot: { workspaces, groups, items, settings, completions } });
}

/**
 * Parse text written by `serializeSnapshot`. Anything malformed or of the wrong shape (not JSON,
 * missing or non-numeric `savedAt`, an array field that is not an array, settings that are not an
 * object with a timezone) yields null, so a corrupt entry is simply ignored.
 * @param {string | null | undefined} text
 * @returns {{savedAt: number, snapshot: Snapshot} | null}
 */
export function restoreSnapshot(text) {
  if (typeof text !== 'string') return null;
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const s = data?.snapshot;
  if (!s || typeof s !== 'object' || typeof data.savedAt !== 'number' || !Number.isFinite(data.savedAt)) return null;
  for (const key of ['workspaces', 'groups', 'items', 'completions']) if (!Array.isArray(s[key])) return null;
  if (!s.settings || typeof s.settings !== 'object' || Array.isArray(s.settings) || typeof s.settings.timezone !== 'string') return null;
  return {
    savedAt: data.savedAt,
    snapshot: { workspaces: s.workspaces, groups: s.groups, items: s.items, settings: s.settings, completions: s.completions },
  };
}