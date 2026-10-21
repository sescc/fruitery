// @ts-check
// Local store: cache.json (the snapshot, same shape as GET /api/state) and device.json (per-PC
// settings). No Electron import: the directory and the clock are parameters, so it is unit tested.
// Writes are atomic (tmp file + rename). A corrupt file is moved aside and the app falls back to the
// seed (or the device defaults); it never crashes.
// Ticks use the local clock for now; desktop-sync moves them to the server clock (D41).

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { periodKey, validateItem, validateWorkspace, reorder as reorderSiblings, moveItem as moveItemCore, removalPlan, SEED } from '../../../packages/core/index.js';
import { selectSeed } from '../lib/seed-select.js';
import * as Layout from '../lib/layout.js';
import { DEFAULT_LIST_WIDTH, sanitizeListWidth } from '../lib/list-width.js';
import { emptySyncConfig, isComplete, sanitizeSyncConfig } from '../lib/sync-config.js';
import { sanitizeApprovedPrograms } from '../lib/program-approval.js';
import { KINDS, MAX_TICK_OPS, enqueue, enqueueTick, mergeSnapshot } from '../lib/sync-plan.js';

/** @typedef {import('../../../packages/core/model.js').Workspace} Workspace */
/** @typedef {import('../../../packages/core/model.js').Group} Group */
/** @typedef {import('../../../packages/core/model.js').Item} Item */
/** @typedef {import('../../../packages/core/model.js').Settings} Settings */
/** @typedef {import('../../../packages/core/schedule.js').Completion} Completion */
/** @typedef {{workspaces: Workspace[], groups: Group[], items: Item[], settings: Settings, completions: Completion[]}} Snapshot */
/** @typedef {{x?: number, y?: number, width: number, height: number, maximized?: boolean}} WindowBounds */
/**
 * @typedef {object} DeviceSettings
 * @property {string | null} edgeProfile
 * @property {boolean} autostart
 * @property {boolean} closeToTray
 * @property {string | null} activeWorkspaceId
 * @property {Record<string, string>} activeItemByWorkspace
 * @property {Record<string, import('../lib/layout.js').Layout>} layouts
 * @property {Record<string, string>} focusedPaneByWorkspace
 * @property {WindowBounds | null} windowBounds
 * @property {number} listWidth width of the item list panel in px (180..600)
 * @property {import('../lib/sync-config.js').SyncConfig} sync which Worker and access key this PC syncs with (the secret is not here)
 * @property {string[]} approvedPrograms program paths the owner allowed to start on this PC (D89; never synced)
 */
/** @typedef {{kind: string, id: string | null, field: string, code: string}} EditError */
/** @typedef {import('../lib/sync-plan.js').OutboxEntry} OutboxEntry */
/** @typedef {import('../lib/sync-plan.js').TickOp} TickOp */
/** @typedef {{id: string, itemId: string, name: string, periodKey: string, reason: string, at: number}} TickNotice a waiting tick the server refused, until dismissed */

/** Most dropped-tick notices kept. */
const MAX_TICK_NOTICES = 20;

/**
 * Clean the waiting ticks read from cache.json (at most one op per item and period, at most MAX_TICK_OPS).
 * @param {unknown} raw
 * @returns {TickOp[]}
 */
function sanitizeTickOps(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {TickOp[]} */
  const out = [];
  const seen = new Set();
  for (const o of raw) {
    if (o === null || typeof o !== 'object' || typeof o.itemId !== 'string' || o.itemId === '' || typeof o.periodKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.periodKey)) continue;
    const key = o.itemId + '\u0000' + o.periodKey;
    if (seen.has(key) || out.length >= MAX_TICK_OPS) continue;
    if (o.op === 'tick' && typeof o.doneAt === 'number' && Number.isFinite(o.doneAt)) out.push({ op: 'tick', itemId: o.itemId, periodKey: o.periodKey, doneAt: o.doneAt });
    else if (o.op === 'untick') out.push({ op: 'untick', itemId: o.itemId, periodKey: o.periodKey });
    else continue;
    seen.add(key);
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {TickNotice[]}
 */
function sanitizeTickNotices(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {TickNotice[]} */
  const out = [];
  for (const n of raw) {
    if (n === null || typeof n !== 'object' || typeof n.id !== 'string' || n.id === '' || typeof n.itemId !== 'string' || typeof n.name !== 'string' || typeof n.periodKey !== 'string' || typeof n.reason !== 'string' || typeof n.at !== 'number') continue;
    out.push({ id: n.id, itemId: n.itemId, name: n.name.slice(0, 200), periodKey: n.periodKey, reason: n.reason, at: n.at });
  }
  return out.slice(-MAX_TICK_NOTICES);
}

/**
 * Clean the outbox read from cache.json: anything that is not a well-formed entry is dropped, so an
 * old cache (no outbox) or a damaged one loads as an empty or shorter list.
 * @param {unknown} raw
 * @returns {OutboxEntry[]}
 */
function sanitizeOutbox(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {OutboxEntry[]} */
  const out = [];
  for (const o of raw) {
    if (o === null || typeof o !== 'object') continue;
    if (!(/** @type {readonly string[]} */ (KINDS)).includes(o.kind) || o.entity === null || typeof o.entity !== 'object' || Array.isArray(o.entity)) continue;
    if (o.kind !== 'settings' && (typeof o.entity.id !== 'string' || o.entity.id === '')) continue;
    /** @type {OutboxEntry} */
    const entry = { kind: o.kind, entity: o.entity };
    if (Array.isArray(o.error)) {
      const errors = o.error.filter((/** @type {any} */ e) => e && typeof e.field === 'string' && typeof e.code === 'string').map((/** @type {any} */ e) => ({ field: e.field, code: e.code }));
      if (errors.length > 0) entry.error = errors;
    }
    out.push(entry);
  }
  return out;
}

const WORKSPACE_KEYS = ['id', 'name', 'icon', 'order', 'sleepAfterMin', 'openInEdge', 'ungroupedLabel', 'updatedAt', 'deleted'];
const GROUP_KEYS = ['id', 'workspaceId', 'name', 'order', 'collapsed', 'updatedAt', 'deleted'];
const ITEM_KEYS = [
  'id', 'workspaceId', 'groupId', 'order', 'name', 'icon', 'kind', 'url', 'appPath', 'fallbackUrl', 'devices', 'schedule',
  'resetTime', 'notify', 'badge', 'edge', 'isolate', 'persistSessionCookies', 'sleepAfterMin', 'userAgent', 'updatedAt', 'deleted',
];

/** @returns {DeviceSettings} */
export function deviceDefaults() {
  return {
    edgeProfile: null,
    autostart: false,
    closeToTray: true,
    activeWorkspaceId: null,
    activeItemByWorkspace: {},
    layouts: {},
    focusedPaneByWorkspace: {},
    windowBounds: null,
    listWidth: DEFAULT_LIST_WIDTH,
    sync: emptySyncConfig(),
    approvedPrograms: [],
  };
}

/**
 * @param {Record<string, any>} src
 * @param {string[]} keys
 * @returns {Record<string, any>}
 */
function pick(src, keys) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of keys) if (k in src && src[k] !== undefined) out[k] = src[k];
  return out;
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Fill the optional fields of an item that the example data leaves out.
 * @param {Record<string, any>} p
 * @returns {Record<string, any>}
 */
function itemDefaults(p) {
  return {
    groupId: null,
    icon: null,
    kind: 'web',
    url: null,
    appPath: null,
    fallbackUrl: null,
    devices: 'all',
    schedule: null,
    resetTime: '00:00',
    notify: false,
    badge: false,
    edge: { mode: 'inherit', profile: null },
    isolate: false,
    persistSessionCookies: true,
    sleepAfterMin: null,
    userAgent: { preset: 'default', custom: null },
    deleted: false,
    updatedAt: 0,
    ...p,
  };
}

/** @param {unknown} tz */
function validTimezone(tz) {
  if (typeof tz !== 'string' || tz === '') return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Open (or create) the store in `dir`.
 * @param {string} dir
 * @param {{now?: () => number, seedText?: string | null, example?: any, genId?: () => string}} [options]
 *   `seedText` is the content of the personal seed file (null/absent = none)
 */
export function openStore(dir, options = {}) {
  const now = options.now ?? Date.now;
  const genId = options.genId ?? (() => randomUUID().slice(0, 12));
  fs.mkdirSync(dir, { recursive: true });
  const cacheFile = path.join(dir, 'cache.json');
  const deviceFile = path.join(dir, 'device.json');

  /** @type {string[]} */
  const notes = [];

  /**
   * @param {string} file
   * @param {(data: any) => boolean} isValid
   * @returns {any | null} the parsed data, or null when the file is missing or was corrupt (moved aside)
   */
  function readJson(file, isValid) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
    try {
      const data = JSON.parse(text);
      if (isValid(data)) return data;
    } catch {
      // fall through: corrupt
    }
    const ext = path.extname(file);
    const aside = path.join(dir, `${path.basename(file, ext)}.corrupt-${now()}${ext}`);
    try {
      fs.renameSync(file, aside);
      notes.push(`moved ${path.basename(file)} aside to ${path.basename(aside)}`);
    } catch {
      notes.push(`could not move ${path.basename(file)} aside`);
    }
    return null;
  }

  /**
   * @param {string} file
   * @param {unknown} data
   */
  function writeJson(file, data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
    fs.renameSync(tmp, file);
  }

  /** @type {Snapshot} */
  let snap;
  /** Local changes the server has not confirmed yet (desktop-sync); kept in cache.json beside the snapshot. @type {OutboxEntry[]} */
  let outbox = [];
  /** The Worker address the first sync completed against (null = not yet). @type {string | null} */
  let firstSyncDoneFor = null;
  /** Ticks and unticks made without a connection, waiting to be sent (offline-ticks). Pending is deduced from this list. @type {TickOp[]} */
  let tickOutbox = [];
  /** Waiting ticks the server refused, shown until dismissed. @type {TickNotice[]} */
  let tickNotices = [];
  /** serverNow - localNow (ms) at the last pull: queued ticks are stamped with the server's clock as last seen. */
  let serverClockOffset = 0;
  /** @type {(() => void) | null} */
  let editListener = null;
  /** @returns {Snapshot & {outbox: OutboxEntry[], firstSyncDoneFor: string | null, tickOutbox: TickOp[], tickNotices: TickNotice[], serverClockOffset: number}} what cache.json holds */
  const cacheBody = () => ({ ...snap, outbox, firstSyncDoneFor, tickOutbox, tickNotices, serverClockOffset });
  /** @type {'cache' | 'local-seed' | 'example-seed'} */
  let origin = 'cache';
  const cached = readJson(
    cacheFile,
    (d) => isObject(d) && Array.isArray(d.workspaces) && Array.isArray(d.groups) && Array.isArray(d.items) && Array.isArray(d.completions) && isObject(d.settings) && typeof d.settings.timezone === 'string',
  );
  if (cached) {
    snap = {
      workspaces: cached.workspaces,
      groups: cached.groups,
      items: cached.items.map((/** @type {any} */ i) => /** @type {Item} */ (itemDefaults(i))),
      settings: cached.settings,
      completions: cached.completions,
    };
    outbox = sanitizeOutbox(cached.outbox);
    tickOutbox = sanitizeTickOps(cached.tickOutbox);
    tickNotices = sanitizeTickNotices(cached.tickNotices);
    serverClockOffset = typeof cached.serverClockOffset === 'number' && Number.isFinite(cached.serverClockOffset) ? Math.round(cached.serverClockOffset) : 0;
    firstSyncDoneFor = typeof cached.firstSyncDoneFor === 'string' && cached.firstSyncDoneFor !== '' ? cached.firstSyncDoneFor : null;
  } else {
    const { seed, source } = selectSeed(options.seedText ?? null, options.example ?? SEED);
    origin = source === 'local' ? 'local-seed' : 'example-seed';
    snap = {
      workspaces: seed.workspaces,
      groups: seed.groups,
      items: seed.items.map((/** @type {any} */ i) => /** @type {Item} */ (itemDefaults(i))),
      settings: { googleEmail: null, updatedAt: 0, ...seed.settings },
      completions: [],
    };
    writeJson(cacheFile, cacheBody());
  }

  /**
   * Clean device settings: well-typed values are taken from `raw`, anything unusable keeps the value
   * in `prev`, and references to things that no longer exist are dropped.
   * @param {any} raw
   * @param {DeviceSettings} [prev]
   * @returns {DeviceSettings}
   */
  function sanitizeDevice(raw, prev = deviceDefaults()) {
    const d = structuredClone(prev);
    const r = isObject(raw) ? raw : {};
    if (r.edgeProfile === null || (typeof r.edgeProfile === 'string' && r.edgeProfile.trim() === '')) d.edgeProfile = null;
    else if (typeof r.edgeProfile === 'string' && r.edgeProfile.length <= 100) d.edgeProfile = r.edgeProfile.trim();
    d.listWidth = sanitizeListWidth(r.listWidth, sanitizeListWidth(d.listWidth));
    if (isObject(r.sync)) d.sync = sanitizeSyncConfig(r.sync);
    else d.sync = sanitizeSyncConfig(d.sync);
    d.approvedPrograms = sanitizeApprovedPrograms(Array.isArray(r.approvedPrograms) ? r.approvedPrograms : d.approvedPrograms);
    if (typeof r.autostart === 'boolean') d.autostart = r.autostart;
    if (typeof r.closeToTray === 'boolean') d.closeToTray = r.closeToTray;
    const liveWs = new Set(snap.workspaces.filter((w) => !w.deleted).map((w) => w.id));
    const liveItems = new Set(snap.items.filter((i) => !i.deleted).map((i) => i.id));
    if (typeof r.activeWorkspaceId === 'string') d.activeWorkspaceId = r.activeWorkspaceId;
    if (isObject(r.activeItemByWorkspace)) d.activeItemByWorkspace = /** @type {any} */ (r.activeItemByWorkspace);
    if (isObject(r.layouts)) d.layouts = /** @type {any} */ (r.layouts);
    if (isObject(r.focusedPaneByWorkspace)) d.focusedPaneByWorkspace = /** @type {any} */ (r.focusedPaneByWorkspace);
    // drop references to things that no longer exist
    /** @type {Record<string, string>} */
    const items = {};
    for (const [k, v] of Object.entries(d.activeItemByWorkspace)) if (liveWs.has(k) && typeof v === 'string' && liveItems.has(v)) items[k] = v;
    d.activeItemByWorkspace = items;
    /** @type {Record<string, import('../lib/layout.js').Layout>} */
    const layouts = {};
    for (const [k, v] of Object.entries(d.layouts)) {
      if (liveWs.has(k) && Layout.validate(v).ok) layouts[k] = Layout.pruneItems(v, (id) => liveItems.has(id));
    }
    d.layouts = layouts;
    /** @type {Record<string, string>} */
    const panes = {};
    for (const [k, v] of Object.entries(d.focusedPaneByWorkspace)) {
      const tree = layouts[k];
      if (typeof v === 'string' && tree && Layout.findPane(tree, v)) panes[k] = v;
    }
    d.focusedPaneByWorkspace = panes;
    const b = r.windowBounds;
    if (b === null) d.windowBounds = null;
    else if (isObject(b) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width >= 400 && b.height >= 300) {
      d.windowBounds = { width: Math.round(b.width), height: Math.round(b.height) };
      if (Number.isFinite(b.x) && Number.isFinite(b.y)) {
        d.windowBounds.x = Math.round(b.x);
        d.windowBounds.y = Math.round(b.y);
      }
      if (b.maximized === true) d.windowBounds.maximized = true;
    }
    if (d.activeWorkspaceId === null || !liveWs.has(d.activeWorkspaceId)) {
      const first = snap.workspaces.filter((w) => !w.deleted).sort((a, b2) => a.order - b2.order)[0];
      d.activeWorkspaceId = first ? first.id : null;
    }
    return d;
  }

  /** @type {DeviceSettings} */
  let device = sanitizeDevice(readJson(deviceFile, (d) => isObject(d)));
  writeJson(deviceFile, device);

  function saveCache() {
    writeJson(cacheFile, cacheBody());
  }

  // ------------------------------------------------------------------ sync (desktop-sync)

  /** Does this PC sync (an address and a client id are set)? Local-only mode never queues anything. */
  const syncing = () => isComplete(device.sync);

  /**
   * Queue changed entities for the next push and poke the sync scheduler. No-op in local-only mode.
   * @param {{workspaces?: any[], groups?: any[], items?: any[], settings?: any}} changed
   */
  function queueChanges(changed) {
    if (!syncing()) return;
    for (const kind of KINDS) {
      const v = changed[kind];
      if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) continue;
      outbox = enqueue(outbox, kind, v);
    }
    saveCache();
    editListener?.();
  }

  /** @returns {Record<'workspaces' | 'groups' | 'items', Map<string, any>>} entities by id, to find later what an edit replaced */
  function refsOf() {
    return {
      workspaces: new Map(snap.workspaces.map((e) => [e.id, e])),
      groups: new Map(snap.groups.map((e) => [e.id, e])),
      items: new Map(snap.items.map((e) => [e.id, e])),
    };
  }

  /**
   * Queue every entity that is not the very object it was before (edits replace objects).
   * @param {ReturnType<typeof refsOf>} before
   */
  function queueReplaced(before) {
    if (!syncing()) return;
    queueChanges({
      workspaces: snap.workspaces.filter((e) => before.workspaces.get(e.id) !== e),
      groups: snap.groups.filter((e) => before.groups.get(e.id) !== e),
      items: snap.items.filter((e) => before.items.get(e.id) !== e),
    });
  }
  function saveDevice() {
    writeJson(deviceFile, device);
  }

  /** @returns {Workspace[]} */
  const liveWorkspaces = () => snap.workspaces.filter((w) => !w.deleted);

  /** Drop device references to things that no longer exist. */
  function cleanDevice() {
    device = sanitizeDevice(device, device);
    saveDevice();
  }

  // ------------------------------------------------------------------ ticks

  /**
   * @param {string} itemId
   * @returns {{ok: true, completion: Completion, created: boolean} | {error: 'not-found' | 'not-scheduled' | 'not-started'}}
   */
  function tick(itemId) {
    const item = snap.items.find((i) => i.id === itemId && !i.deleted);
    if (!item) return { error: 'not-found' };
    if (!item.schedule) return { error: 'not-scheduled' };
    const t = now();
    const pk = periodKey(item.schedule, t, snap.settings.timezone, item.resetTime);
    if (pk === null) return { error: 'not-started' };
    const existing = snap.completions.find((c) => c.itemId === itemId && c.periodKey === pk);
    if (existing) return { ok: true, completion: existing, created: false };
    const completion = { itemId, periodKey: pk, doneAt: t };
    snap.completions.push(completion);
    saveCache();
    return { ok: true, completion, created: true };
  }

  /**
   * @param {string} itemId
   * @returns {{ok: true, removed: number} | {error: 'not-found' | 'not-scheduled'}}
   */
  function untick(itemId) {
    const item = snap.items.find((i) => i.id === itemId && !i.deleted);
    if (!item) return { error: 'not-found' };
    if (!item.schedule) return { error: 'not-scheduled' };
    const pk = periodKey(item.schedule, now(), snap.settings.timezone, item.resetTime);
    const before = snap.completions.length;
    snap.completions = snap.completions.filter((c) => !(c.itemId === itemId && c.periodKey === pk));
    const removed = before - snap.completions.length;
    if (removed > 0) saveCache();
    return { ok: true, removed };
  }

  // ------------------------------------------------------------------ edits

  /**
   * @param {Workspace} w
   * @param {EditError[]} errors
   */
  function checkWorkspace(w, errors) {
    if (typeof w.name !== 'string' || w.name.trim() === '') errors.push({ kind: 'workspace', id: w.id, field: 'name', code: 'required' });
    if (!Number.isInteger(w.sleepAfterMin) || w.sleepAfterMin < 0) errors.push({ kind: 'workspace', id: w.id, field: 'sleepAfterMin', code: 'out-of-range' });
    if (typeof w.openInEdge !== 'boolean') errors.push({ kind: 'workspace', id: w.id, field: 'openInEdge', code: 'invalid-value' });
    if (w.icon !== null && typeof w.icon !== 'string') errors.push({ kind: 'workspace', id: w.id, field: 'icon', code: 'invalid-value' });
    // the label rules (at most 40 characters, a string) are core's
    for (const e of validateWorkspace(w)) if (e.field === 'ungroupedLabel') errors.push({ kind: 'workspace', id: w.id, field: e.field, code: e.code });
  }

  /**
   * @param {Group} g
   * @param {Workspace[]} liveWs
   * @param {EditError[]} errors
   */
  function checkGroup(g, liveWs, errors) {
    if (typeof g.name !== 'string' || g.name.trim() === '') errors.push({ kind: 'group', id: g.id, field: 'name', code: 'required' });
    if (!liveWs.some((w) => w.id === g.workspaceId)) errors.push({ kind: 'group', id: g.id, field: 'workspaceId', code: 'workspace-not-found' });
    if (typeof g.collapsed !== 'boolean') errors.push({ kind: 'group', id: g.id, field: 'collapsed', code: 'invalid-value' });
  }

  /**
   * Merge a partial snapshot onto the stored entities by id, stamp `updatedAt`, validate every
   * touched entity, and save only when all of them are valid. New entities get an id and are
   * appended among their siblings. `deleted` cannot be set here (use `remove`).
   * @param {{workspaces?: any[], groups?: any[], items?: any[], settings?: any}} patch
   * @returns {{ok: true, ids: {workspaces: string[], groups: string[], items: string[]}} | {errors: EditError[]}}
   */
  function upsert(patch) {
    /** @type {EditError[]} */
    const errors = [];
    if (!isObject(patch)) return { errors: [{ kind: 'request', id: null, field: 'patch', code: 'invalid-value' }] };
    const draft = {
      workspaces: structuredClone(snap.workspaces),
      groups: structuredClone(snap.groups),
      items: structuredClone(snap.items),
      settings: structuredClone(snap.settings),
    };
    const t = now();
    const ids = { workspaces: /** @type {string[]} */ ([]), groups: /** @type {string[]} */ ([]), items: /** @type {string[]} */ ([]) };
    /** @type {Workspace[]} */ const touchedWs = [];
    /** @type {Group[]} */ const touchedGroups = [];
    /** @type {Item[]} */ const touchedItems = [];

    for (const p of Array.isArray(patch.workspaces) ? patch.workspaces : []) {
      if (!isObject(p)) { errors.push({ kind: 'workspace', id: null, field: 'workspace', code: 'invalid-value' }); continue; }
      const id = typeof p.id === 'string' && p.id !== '' ? p.id : genId();
      const idx = draft.workspaces.findIndex((w) => w.id === id);
      if (idx >= 0 && draft.workspaces[idx].deleted) { errors.push({ kind: 'workspace', id, field: 'id', code: 'deleted' }); continue; }
      const base = idx >= 0 ? draft.workspaces[idx] : { icon: null, order: draft.workspaces.filter((w) => !w.deleted).length, sleepAfterMin: 10, openInEdge: false, ungroupedLabel: null };
      const merged = /** @type {Workspace} */ ({ ...base, ...pick(p, WORKSPACE_KEYS), id, deleted: false, updatedAt: t });
      // a blank label means the default (core ungroupedLabelOf)
      if (typeof merged.ungroupedLabel === 'string' && merged.ungroupedLabel.trim() === '') merged.ungroupedLabel = null;
      else if (typeof merged.ungroupedLabel === 'string') merged.ungroupedLabel = merged.ungroupedLabel.trim();
      if (idx >= 0) draft.workspaces[idx] = merged; else draft.workspaces.push(merged);
      touchedWs.push(merged);
      ids.workspaces.push(id);
    }
    for (const p of Array.isArray(patch.groups) ? patch.groups : []) {
      if (!isObject(p)) { errors.push({ kind: 'group', id: null, field: 'group', code: 'invalid-value' }); continue; }
      const id = typeof p.id === 'string' && p.id !== '' ? p.id : genId();
      const idx = draft.groups.findIndex((g) => g.id === id);
      if (idx >= 0 && draft.groups[idx].deleted) { errors.push({ kind: 'group', id, field: 'id', code: 'deleted' }); continue; }
      const wsId = p.workspaceId ?? (idx >= 0 ? draft.groups[idx].workspaceId : undefined);
      const base = idx >= 0 ? draft.groups[idx] : { collapsed: false, order: draft.groups.filter((g) => !g.deleted && g.workspaceId === wsId).length };
      const merged = /** @type {Group} */ ({ ...base, ...pick(p, GROUP_KEYS), id, deleted: false, updatedAt: t });
      if (idx >= 0) draft.groups[idx] = merged; else draft.groups.push(merged);
      touchedGroups.push(merged);
      ids.groups.push(id);
    }
    for (const p of Array.isArray(patch.items) ? patch.items : []) {
      if (!isObject(p)) { errors.push({ kind: 'item', id: null, field: 'item', code: 'invalid-value' }); continue; }
      const id = typeof p.id === 'string' && p.id !== '' ? p.id : genId();
      const idx = draft.items.findIndex((i) => i.id === id);
      if (idx >= 0 && draft.items[idx].deleted) { errors.push({ kind: 'item', id, field: 'id', code: 'deleted' }); continue; }
      let merged;
      if (idx >= 0) {
        merged = /** @type {Item} */ ({ ...draft.items[idx], ...pick(p, ITEM_KEYS), id, deleted: false, updatedAt: t });
      } else {
        const wsId = p.workspaceId;
        const order = draft.items.filter((i) => !i.deleted && i.workspaceId === wsId && (i.groupId ?? null) === (p.groupId ?? null)).length;
        merged = /** @type {Item} */ (itemDefaults({ order, ...pick(p, ITEM_KEYS), id, deleted: false, updatedAt: t }));
      }
      // moving to another workspace through an edit clears the group (like moveItem)
      if (idx >= 0 && merged.workspaceId !== draft.items[idx].workspaceId && !('groupId' in p)) merged.groupId = null;
      if (idx >= 0) draft.items[idx] = merged; else draft.items.push(merged);
      touchedItems.push(merged);
      ids.items.push(id);
    }

    if (patch.settings !== undefined) {
      if (!isObject(patch.settings)) {
        errors.push({ kind: 'settings', id: null, field: 'settings', code: 'invalid-value' });
      } else {
        const s = { ...draft.settings, ...pick(patch.settings, ['timezone', 'googleEmail']) };
        if (typeof s.googleEmail === 'string') s.googleEmail = s.googleEmail.trim() === '' ? null : s.googleEmail.trim();
        if (!validTimezone(s.timezone)) errors.push({ kind: 'settings', id: null, field: 'timezone', code: 'invalid-value' });
        if (s.googleEmail !== null && s.googleEmail !== undefined && (typeof s.googleEmail !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(s.googleEmail) || s.googleEmail.length > 254)) {
          errors.push({ kind: 'settings', id: null, field: 'googleEmail', code: 'invalid-value' });
        }
        draft.settings = { ...s, googleEmail: s.googleEmail ?? null, updatedAt: t };
      }
    }

    const liveWs = draft.workspaces.filter((w) => !w.deleted);
    const liveGroups = draft.groups.filter((g) => !g.deleted);
    for (const w of touchedWs) checkWorkspace(w, errors);
    for (const g of touchedGroups) checkGroup(g, liveWs, errors);
    for (const i of touchedItems) {
      if (!liveWs.some((w) => w.id === i.workspaceId)) errors.push({ kind: 'item', id: i.id, field: 'workspaceId', code: 'workspace-not-found' });
      for (const e of validateItem(i, { groups: liveGroups })) errors.push({ kind: 'item', id: i.id, field: e.field, code: e.code });
    }
    if (errors.length > 0) return { errors };

    snap.workspaces = draft.workspaces;
    snap.groups = draft.groups;
    snap.items = draft.items;
    snap.settings = draft.settings;
    saveCache();
    queueChanges({
      workspaces: snap.workspaces.filter((w) => ids.workspaces.includes(w.id)),
      groups: snap.groups.filter((g) => ids.groups.includes(g.id)),
      items: snap.items.filter((i) => ids.items.includes(i.id)),
      settings: patch.settings !== undefined ? snap.settings : undefined,
    });
    return { ok: true, ids };
  }

  /**
   * Tombstone an entity. A workspace takes its groups and items with it (the last live workspace
   * cannot be removed); a group sends its items to "no group"; an item only itself. Ticks stay.
   * @param {'workspace' | 'group' | 'item'} kind
   * @param {string} id
   * @returns {{ok: true} | {error: 'not-found' | 'last-workspace' | 'bad-kind'}}
   */
  function remove(kind, id) {
    if (kind !== 'workspace' && kind !== 'group' && kind !== 'item') return { error: 'bad-kind' };
    const plan = removalPlan(snap, kind, id, now()); // the shared rules (core), same as the phone
    if ('error' in plan) return { error: plan.error };
    const before = syncing() ? refsOf() : null;
    for (const key of /** @type {const} */ (['workspaces', 'groups', 'items'])) {
      /** @type {{id: string}[]} */
      const all = snap[key];
      for (const changed of plan.changed[key]) all[all.findIndex((e) => e.id === changed.id)] = changed;
    }
    saveCache();
    if (before) queueReplaced(before);
    cleanDevice();
    return { ok: true };
  }

  /**
   * Move one sibling to `toIndex` (dense renumbering via core `reorder`).
   * - workspace: `parentId` ignored;
   * - group: `parentId` is the workspace id;
   * - item: `parentId` is the target group id, or null for "no group"; the item first joins that
   *   group (it must belong to the item's workspace), then takes its place.
   * @param {'workspace' | 'group' | 'item'} kind
   * @param {string | null} parentId
   * @param {string} id
   * @param {number} toIndex
   * @returns {{ok: true} | {error: 'not-found' | 'bad-parent' | 'bad-kind' | 'bad-index'}}
   */
  function reorder(kind, parentId, id, toIndex) {
    if (typeof toIndex !== 'number' || !Number.isFinite(toIndex)) return { error: 'bad-index' };
    const before = syncing() ? refsOf() : null;
    const t = now();
    /** @template {{id: string, order: number, updatedAt: number}} T @param {T[]} all @param {T[]} siblings */
    const apply = (all, siblings) => {
      for (const n of reorderSiblings(siblings, id, toIndex, t)) {
        const idx = all.findIndex((e) => e.id === n.id);
        all[idx] = n;
      }
    };
    if (kind === 'workspace') {
      const sibs = liveWorkspaces();
      if (!sibs.some((w) => w.id === id)) return { error: 'not-found' };
      apply(snap.workspaces, sibs);
    } else if (kind === 'group') {
      const g = snap.groups.find((x) => x.id === id && !x.deleted);
      if (!g) return { error: 'not-found' };
      if (parentId !== g.workspaceId) return { error: 'bad-parent' };
      apply(snap.groups, snap.groups.filter((x) => !x.deleted && x.workspaceId === g.workspaceId));
    } else if (kind === 'item') {
      const idx = snap.items.findIndex((x) => x.id === id && !x.deleted);
      if (idx < 0) return { error: 'not-found' };
      const it = snap.items[idx];
      const target = parentId ?? null;
      if (target !== null) {
        const grp = snap.groups.find((x) => x.id === target && !x.deleted);
        if (!grp || grp.workspaceId !== it.workspaceId) return { error: 'bad-parent' };
      }
      if ((it.groupId ?? null) !== target) snap.items[idx] = { ...it, groupId: target, updatedAt: t };
      apply(snap.items, snap.items.filter((x) => !x.deleted && x.workspaceId === it.workspaceId && (x.groupId ?? null) === target));
    } else {
      return { error: 'bad-kind' };
    }
    saveCache();
    if (before) queueReplaced(before);
    return { ok: true };
  }

  /**
   * Move an item to another workspace: core `moveItem` (same id, group cleared), then last among
   * the target's ungrouped items.
   * @param {string} itemId
   * @param {string} toWorkspaceId
   * @returns {{ok: true} | {error: 'not-found' | 'workspace-not-found'}}
   */
  function moveItem(itemId, toWorkspaceId) {
    const idx = snap.items.findIndex((i) => i.id === itemId && !i.deleted);
    if (idx < 0) return { error: 'not-found' };
    if (!liveWorkspaces().some((w) => w.id === toWorkspaceId)) return { error: 'workspace-not-found' };
    const t = now();
    const moved = moveItemCore(snap.items[idx], toWorkspaceId, t);
    if (moved.workspaceId === snap.items[idx].workspaceId) return { ok: true };
    const before = syncing() ? refsOf() : null;
    snap.items[idx] = moved;
    const sibs = snap.items.filter((x) => !x.deleted && x.workspaceId === toWorkspaceId && (x.groupId ?? null) === null);
    for (const n of reorderSiblings(sibs, itemId, sibs.length, t)) {
      snap.items[snap.items.findIndex((e) => e.id === n.id)] = n;
    }
    saveCache();
    if (before) queueReplaced(before);
    cleanDevice();
    return { ok: true };
  }

  // ------------------------------------------------------------------ sync state (used by main/sync.js)

  /**
   * Make the server's state the local one, keeping unconfirmed local edits (`mergeSnapshot`). One
   * synchronous step, so edits made while the request was in flight (already in the outbox) are kept.
   * Written only when something changed.
   * @param {any} remote the body of GET /api/state
   * @returns {{ok: true, changed: boolean} | {error: 'bad-state'}}
   */
  function applyRemote(remote) {
    if (!isObject(remote) || !Array.isArray(remote.workspaces) || !Array.isArray(remote.groups) || !Array.isArray(remote.items) || !isObject(remote.settings) || typeof remote.settings.timezone !== 'string') {
      return { error: 'bad-state' };
    }
    let offsetChanged = false;
    if (typeof remote.serverNow === 'number' && Number.isFinite(remote.serverNow)) {
      const offset = Math.round(remote.serverNow - now());
      if (Math.abs(offset - serverClockOffset) > 2000) {
        serverClockOffset = offset;
        offsetChanged = true;
      }
    }
    const merged = mergeSnapshot(snap, remote, outbox, tickOutbox);
    const next = {
      workspaces: merged.workspaces,
      groups: merged.groups,
      items: merged.items.map((i) => /** @type {Item} */ (itemDefaults(i))),
      settings: { googleEmail: null, updatedAt: 0, ...merged.settings },
      completions: Array.isArray(remote.completions) ? merged.completions : snap.completions,
    };
    if (JSON.stringify(next) === JSON.stringify(snap)) {
      if (offsetChanged) saveCache();
      return { ok: true, changed: false };
    }
    snap = next;
    saveCache();
    cleanDevice();
    return { ok: true, changed: true };
  }

  // ---- ticks made without a connection (offline-ticks)

  /** The time a queued tick is stamped with: this PC's clock moved to the server's, as last seen. */
  const tickClock = () => now() + serverClockOffset;

  /**
   * Tick without a connection: the completion appears at once and the tick waits in the queue. The period is the
   * local one of the corrected time, with the synced timezone. Same answers as the local tick, plus `pending`.
   * @param {string} itemId
   * @returns {{ok: true, completion: Completion, created: boolean, pending: boolean} | {error: 'not-found' | 'not-scheduled' | 'not-started' | 'ticks-need-connection'}}
   */
  function queueTick(itemId) {
    const item = snap.items.find((i) => i.id === itemId && !i.deleted);
    if (!item) return { error: 'not-found' };
    if (!item.schedule) return { error: 'not-scheduled' };
    const at = tickClock();
    const pk = periodKey(item.schedule, at, snap.settings.timezone, item.resetTime);
    if (pk === null) return { error: 'not-started' };
    const isKey = (/** @type {{itemId: string, periodKey: string}} */ x) => x.itemId === itemId && x.periodKey === pk;
    const existing = snap.completions.find(isKey);
    if (existing) return { ok: true, completion: existing, created: false, pending: tickOutbox.some((o) => o.op === 'tick' && isKey(o)) };
    if (tickOutbox.length >= MAX_TICK_OPS && !tickOutbox.some(isKey)) return { error: 'ticks-need-connection' };
    const completion = { itemId, periodKey: pk, doneAt: at };
    snap.completions.push(completion);
    tickOutbox = enqueueTick(tickOutbox, { op: 'tick', itemId, periodKey: pk, doneAt: at });
    saveCache();
    editListener?.();
    return { ok: true, completion, created: true, pending: true };
  }

  /**
   * Untick without a connection: the completion of the current period disappears at once; the removal waits in the
   * queue (or cancels a waiting tick of the same period). Nothing to remove: nothing happens.
   * @param {string} itemId
   * @returns {{ok: true, removed: number, pending?: boolean} | {error: 'not-found' | 'not-scheduled'}}
   */
  function queueUntick(itemId) {
    const item = snap.items.find((i) => i.id === itemId && !i.deleted);
    if (!item) return { error: 'not-found' };
    if (!item.schedule) return { error: 'not-scheduled' };
    const pk = periodKey(item.schedule, tickClock(), snap.settings.timezone, item.resetTime);
    if (pk === null || !snap.completions.some((c) => c.itemId === itemId && c.periodKey === pk)) return { ok: true, removed: 0 };
    snap.completions = snap.completions.filter((c) => !(c.itemId === itemId && c.periodKey === pk));
    tickOutbox = enqueueTick(tickOutbox, { op: 'untick', itemId, periodKey: pk });
    saveCache();
    editListener?.();
    return { ok: true, removed: 1, pending: true };
  }

  /** @param {Omit<TickNotice, 'id'>} n a waiting tick the server refused */
  function addTickNotice(n) {
    tickNotices = [...tickNotices, { ...n, id: `${n.at}-${n.itemId}-${n.periodKey}-${tickNotices.length}` }].slice(-MAX_TICK_NOTICES);
    saveCache();
  }

  /** @param {string} id */
  function dismissTickNotice(id) {
    const next = tickNotices.filter((n) => n.id !== id);
    if (next.length === tickNotices.length) return false;
    tickNotices = next;
    saveCache();
    return true;
  }

  /**
   * Add a completion the server returned (a tick made through the API).
   * @param {Completion} c
   * @returns {boolean} false when the shape is wrong
   */
  function applyCompletion(c) {
    if (!isObject(c) || typeof c.itemId !== 'string' || typeof c.periodKey !== 'string' || typeof c.doneAt !== 'number') return false;
    if (!snap.completions.some((x) => x.itemId === c.itemId && x.periodKey === c.periodKey)) {
      snap.completions.push({ itemId: c.itemId, periodKey: c.periodKey, doneAt: c.doneAt });
      saveCache();
    }
    return true;
  }

  /**
   * Drop an item's completion of one period (an untick made through the API).
   * @param {string} itemId
   * @param {string} pk
   */
  function dropCompletion(itemId, pk) {
    const before = snap.completions.length;
    snap.completions = snap.completions.filter((c) => !(c.itemId === itemId && c.periodKey === pk));
    if (snap.completions.length !== before) saveCache();
  }

  /**
   * Keep a copy of cache.json as it is now, before the first sync can replace local data.
   * @returns {string | null} the file name, or null when it could not be written
   */
  function backupCache() {
    const file = path.join(dir, `cache.pre-sync-${now()}.json`);
    try {
      writeJson(file, cacheBody());
      return path.basename(file);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ device

  /**
   * Shallow-merge known device keys (sanitised). Map keys (`layouts`, ...) in a patch replace the
   * stored map; use `setLayout` / `setActive` for single entries.
   * @param {Partial<DeviceSettings>} patch
   * @returns {DeviceSettings}
   */
  function updateDevice(patch) {
    if (isObject(patch)) {
      const known = ['edgeProfile', 'autostart', 'closeToTray', 'activeWorkspaceId', 'activeItemByWorkspace', 'layouts', 'focusedPaneByWorkspace', 'windowBounds', 'listWidth', 'sync', 'approvedPrograms'];
      device = sanitizeDevice(pick(patch, known), device);
      saveDevice();
    }
    return device;
  }

  /**
   * @param {string} workspaceId
   * @param {unknown} tree
   * @param {string | null} focusedPaneId
   * @returns {{ok: true} | {error: 'bad-layout' | 'workspace-not-found'}}
   */
  function setLayout(workspaceId, tree, focusedPaneId) {
    if (!liveWorkspaces().some((w) => w.id === workspaceId)) return { error: 'workspace-not-found' };
    if (!Layout.validate(tree).ok) return { error: 'bad-layout' };
    const liveItems = new Set(snap.items.filter((i) => !i.deleted).map((i) => i.id));
    const clean = Layout.pruneItems(/** @type {any} */ (tree), (id) => liveItems.has(id));
    device.layouts[workspaceId] = clean;
    const pane = typeof focusedPaneId === 'string' && Layout.findPane(clean, focusedPaneId) ? focusedPaneId : Layout.leaves(clean)[0].paneId;
    device.focusedPaneByWorkspace[workspaceId] = pane;
    saveDevice();
    return { ok: true };
  }

  /**
   * Move the keyboard focus to another pane of the workspace's layout as main holds it. A focus change
   * never carries a tree (so it cannot undo a layout change made meanwhile, D131); the pane must be a leaf
   * of the stored layout, else nothing changes. Focusing the focused pane again writes nothing.
   * @param {string} workspaceId
   * @param {string} paneId
   * @returns {{ok: true} | {error: 'workspace-not-found' | 'pane-not-found'}}
   */
  function setFocusedPane(workspaceId, paneId) {
    if (!liveWorkspaces().some((w) => w.id === workspaceId)) return { error: 'workspace-not-found' };
    const tree = device.layouts[workspaceId] ?? Layout.leaf('p1', null); // no layout stored yet = the default single pane
    if (typeof paneId !== 'string' || !Layout.findPane(tree, paneId)) return { error: 'pane-not-found' };
    if (device.focusedPaneByWorkspace[workspaceId] === paneId) return { ok: true };
    device.focusedPaneByWorkspace[workspaceId] = paneId;
    saveDevice();
    return { ok: true };
  }

  /**
   * @param {string} workspaceId
   * @returns {{ok: true} | {error: 'workspace-not-found'}}
   */
  function setActiveWorkspace(workspaceId) {
    if (!liveWorkspaces().some((w) => w.id === workspaceId)) return { error: 'workspace-not-found' };
    device.activeWorkspaceId = workspaceId;
    saveDevice();
    return { ok: true };
  }

  /**
   * @param {string} workspaceId
   * @param {string} itemId
   */
  function setActiveItem(workspaceId, itemId) {
    if (!liveWorkspaces().some((w) => w.id === workspaceId)) return;
    if (!snap.items.some((i) => i.id === itemId && !i.deleted)) return;
    device.activeItemByWorkspace[workspaceId] = itemId;
    saveDevice();
  }

  return {
    dir,
    /** @returns {Snapshot} read-only view of the live snapshot */
    snapshot: () => snap,
    /** @returns {DeviceSettings} read-only view of the live device settings */
    device: () => device,
    origin: () => origin,
    notes: () => [...notes],
    tick,
    untick,
    upsert,
    remove,
    reorder,
    moveItem,
    /** @returns {OutboxEntry[]} the unconfirmed local changes (treat as read-only) */
    outbox: () => outbox,
    /** @param {OutboxEntry[]} next */
    setOutbox(next) {
      outbox = next;
      saveCache();
    },
    /** @returns {string | null} the Worker address the first sync completed against */
    firstSyncDoneFor: () => firstSyncDoneFor,
    /** @returns {TickOp[]} the ticks and unticks waiting to be sent (treat as read-only) */
    tickOutbox: () => tickOutbox,
    /** @param {TickOp[]} next */
    setTickOutbox(next) {
      tickOutbox = next;
      saveCache();
    },
    /** @returns {TickNotice[]} waiting ticks the server refused, oldest first */
    tickNotices: () => tickNotices,
    addTickNotice,
    dismissTickNotice,
    clearTickNotices() {
      tickNotices = [];
      saveCache();
    },
    /** @returns {number} ms to add to this PC's clock to get the server's, as of the last pull */
    serverClockOffset: () => serverClockOffset,
    queueTick,
    queueUntick,
    /** @param {string | null} baseUrl */
    setFirstSyncDoneFor(baseUrl) {
      firstSyncDoneFor = baseUrl;
      saveCache();
    },
    /** Register the function called after a local edit was queued for sync (the scheduler's debounce). @param {(() => void) | null} fn */
    setEditListener(fn) {
      editListener = fn;
    },
    applyRemote,
    applyCompletion,
    dropCompletion,
    backupCache,
    updateDevice,
    setLayout,
    setFocusedPane,
    setActiveWorkspace,
    setActiveItem,
  };
}
