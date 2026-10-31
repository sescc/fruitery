// @ts-check
// Data access and write rules over a D1-like database. Every function takes `db` (D1 binding or the
// node:sqlite stand-in) and an explicit `nowMs` where time matters; nothing reads the clock here.

import { addDays, effectiveDay, isValidDate, localParts, mergeLww, periodKey, previousPeriodStart, validateItem, validateWorkspace } from '../../../packages/core/index.js';
import { TABLES, completionFromRow, fromRow, rowValues, toRow, upsertSql } from './rows.js';

/** @typedef {import('./rows.js').Kind} Kind */
/** @typedef {import('../../../packages/core/model.js').Settings} Settings */
/** @typedef {import('../../../packages/core/schedule.js').Completion} Completion */
/** @typedef {{id?: string, errors: {field: string, code: string}[]}} Problem */

/** Maximum bound parameters per statement in D1 is 100; stay below. */
const CHUNK = 80;
const DEFAULT_SINCE_DAYS = 62;

/** @type {Settings} */
const DEFAULT_SETTINGS = Object.freeze({ timezone: 'UTC', googleEmail: null, updatedAt: 0 });

/** An expected failure that maps to an HTTP status. */
export class StoreError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {Problem[]} [details]
   */
  constructor(status, code, details) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {any} db
 * @returns {Promise<Settings | null>} the stored settings, or null on a database never given any
 */
async function loadSettingsRow(db) {
  const row = await db.prepare('SELECT * FROM settings WHERE id = ?').bind('settings').first();
  return row ? fromRow('settings', row) : null;
}

/**
 * @param {any} db
 * @returns {Promise<Settings>} the stored settings, or the UTC defaults
 */
async function loadSettings(db) {
  return (await loadSettingsRow(db)) ?? { ...DEFAULT_SETTINGS };
}

/**
 * @param {any} db
 * @param {Kind} kind
 * @param {string[]} ids
 * @returns {Promise<any[]>} stored entities with these ids
 */
async function loadByIds(db, kind, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const { results } = await db
      .prepare(`SELECT * FROM ${TABLES[kind].table} WHERE id IN (${part.map(() => '?').join(',')})`)
      .bind(...part)
      .all();
    out.push(...results.map((/** @type {any} */ r) => fromRow(kind, r)));
  }
  return out;
}

/**
 * @param {any} db
 * @param {'workspace' | 'group' | 'item'} kind
 * @returns {Promise<any[]>} every stored entity of the kind, tombstones included, in stored order
 */
async function loadAll(db, kind) {
  const { results } = await db.prepare(`SELECT * FROM ${TABLES[kind].table} ORDER BY ord, id`).all();
  return results.map((/** @type {any} */ r) => fromRow(kind, r));
}

/**
 * The snapshot every client starts from.
 * @param {any} db
 * @param {number} nowMs server time
 * @param {{since?: string | null}} [opts] `since` 'YYYY-MM-DD': only completions with period_key >= since
 * @returns {Promise<{workspaces: any[], groups: any[], items: any[], settings: Settings, completions: Completion[], serverNow: number, features: string[]}>}
 * @throws {StoreError} 400 when `since` is not a date
 */
export async function getState(db, nowMs, opts = {}) {
  if (opts.since !== undefined && opts.since !== null && !isValidDate(opts.since)) {
    throw new StoreError(400, 'bad-request', [{ errors: [{ field: 'since', code: 'invalid-date' }] }]);
  }
  const [workspaces, groups, items, settings] = await Promise.all([
    loadAll(db, 'workspace'),
    loadAll(db, 'group'),
    loadAll(db, 'item'),
    loadSettings(db),
  ]);
  let since = opts.since ?? null;
  if (since === null) {
    // the window is at least DEFAULT_SINCE_DAYS, widened to the largest everyNDays.n; that n is
    // bounded by core validateSchedule (MAX_EVERY_N_DAYS), so this scan can never grow without limit
    let maxN = 0;
    for (const it of items) if (it.schedule?.type === 'everyNDays') maxN = Math.max(maxN, it.schedule.n);
    since = addDays(effectiveDay(nowMs, settings.timezone), -Math.max(DEFAULT_SINCE_DAYS, maxN));
  }
  const { results } = await db
    .prepare('SELECT * FROM completions WHERE period_key >= ? ORDER BY period_key, item_id')
    .bind(since)
    .all();
  return { workspaces, groups, items, settings, completions: results.map(completionFromRow), serverNow: nowMs, features: [...FEATURES] };
}

// ---------------------------------------------------------------------------------------------
// Upsert

const isStr = (/** @type {unknown} */ v) => typeof v === 'string';
const isNum = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v);
const isBool = (/** @type {unknown} */ v) => typeof v === 'boolean';
const isObj = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nullable = (/** @type {(v: unknown) => boolean} */ f) => (/** @type {unknown} */ v) => v === null || v === undefined || f(v);

/** Field shape predicates per kind (id and updatedAt are checked for all but settings' id). */
const SHAPES = /** @type {Record<Kind, Record<string, (v: unknown) => boolean>>} */ ({
  workspace: { name: isStr, icon: nullable(isStr), order: isNum, sleepAfterMin: isNum, openInEdge: isBool, ungroupedLabel: nullable(isStr), deleted: isBool },
  group: { workspaceId: isStr, name: isStr, order: isNum, collapsed: isBool, deleted: isBool },
  item: {
    workspaceId: isStr, groupId: nullable(isStr), order: isNum, name: isStr, icon: nullable(isStr), kind: isStr,
    url: nullable(isStr), appPath: nullable(isStr), fallbackUrl: nullable(isStr), devices: isStr,
    schedule: nullable(isObj), resetTime: isStr, notify: isBool, badge: isBool,
    edge: (v) => isObj(v) && isStr(/** @type {any} */ (v).mode) && nullable(isStr)(/** @type {any} */ (v).profile),
    isolate: isBool, persistSessionCookies: isBool, sleepAfterMin: nullable(isNum), userAgent: nullable(isObj), deepLink: nullable(isStr), deleted: isBool,
  },
  settings: { timezone: isStr, googleEmail: nullable(isStr) },
});

/**
 * Shape-check one entity (structure only: values are validated afterwards).
 * @param {Kind} kind
 * @param {unknown} e
 * @returns {{field: string, code: string}[]}
 */
function shapeErrors(kind, e) {
  if (!isObj(e)) return [{ field: kind, code: 'invalid-type' }];
  const o = /** @type {Record<string, unknown>} */ (e);
  /** @type {{field: string, code: string}[]} */
  const errors = [];
  if (kind !== 'settings' && !(isStr(o.id) && o.id !== '')) errors.push({ field: 'id', code: 'invalid-type' });
  if (!isNum(o.updatedAt)) errors.push({ field: 'updatedAt', code: 'invalid-type' });
  for (const [field, ok] of Object.entries(SHAPES[kind])) if (!ok(o[field])) errors.push({ field, code: 'invalid-type' });
  return errors;
}

/**
 * Write the changed winners of a merge in one atomic batch.
 * @param {any} db
 * @param {{kind: Kind, entity: any}[]} changes
 */
async function writeChanges(db, changes) {
  if (changes.length === 0) return;
  await db.batch(changes.map(({ kind, entity }) => db.prepare(upsertSql(kind)).bind(...rowValues(kind, toRow(kind, entity)))));
}

/**
 * Last-write-wins upsert of workspaces, groups, items and settings.
 * Steps: shape-check (400), merge with the stored rows, validate every resulting live item with the
 * groups of stored and merged (422, nothing written), then write only the changed winners.
 * @param {any} db
 * @param {unknown} body `{workspaces?, groups?, items?, settings?}`
 * @returns {Promise<{workspaces: any[], groups: any[], items: any[], settings: Settings | null}>} the stored winners for the sent ids
 * @throws {StoreError} 400 bad shape, 422 invalid items or timezone
 */
export async function upsertEntities(db, body) {
  if (!isObj(body)) throw new StoreError(400, 'bad-request');
  const b = /** @type {Record<string, unknown>} */ (body);
  /** @type {Problem[]} */
  const shapeProblems = [];
  /** @type {Record<'workspace' | 'group' | 'item', any[]>} */
  const incoming = { workspace: [], group: [], item: [] };
  /** @type {Settings | null} */
  let incomingSettings = null;

  for (const [key, kind] of /** @type {const} */ ([['workspaces', 'workspace'], ['groups', 'group'], ['items', 'item']])) {
    const list = b[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      shapeProblems.push({ errors: [{ field: key, code: 'invalid-type' }] });
      continue;
    }
    for (const e of list) {
      const errors = shapeErrors(kind, e);
      if (errors.length > 0) shapeProblems.push({ id: isObj(e) && isStr(e.id) ? e.id : undefined, errors });
      else incoming[kind].push(fromRow(kind, toRow(kind, e))); // canonical form: drops unknown fields
    }
  }
  if (b.settings !== undefined && b.settings !== null) {
    const errors = shapeErrors('settings', b.settings);
    if (errors.length > 0) shapeProblems.push({ id: 'settings', errors });
    else incomingSettings = fromRow('settings', toRow('settings', b.settings));
  }
  if (shapeProblems.length > 0) throw new StoreError(400, 'bad-request', shapeProblems);



  // merge with the stored versions of the sent ids
  /** @type {Record<'workspace' | 'group' | 'item', any[]>} */
  const stored = {
    workspace: await loadByIds(db, 'workspace', incoming.workspace.map((e) => e.id)),
    group: await loadByIds(db, 'group', incoming.group.map((e) => e.id)),
    item: await loadByIds(db, 'item', incoming.item.map((e) => e.id)),
  };
  const merged = {
    workspace: mergeLww(stored.workspace, incoming.workspace),
    group: mergeLww(stored.group, incoming.group),
    item: mergeLww(stored.item, incoming.item),
  };
  const storedSettings = incomingSettings ? await loadSettingsRow(db) : null;
  const mergedSettings = incomingSettings ? mergeLww(storedSettings ? [storedSettings] : [], [incomingSettings]) : [];

  // validate everything that would result
  /** @type {Problem[]} */
  const problems = [];
  const groupsById = new Map((await loadAll(db, 'group')).map((g) => [g.id, g]));
  for (const g of merged.group) groupsById.set(g.id, g);
  const groups = [...groupsById.values()];
  for (const ws of merged.workspace) {
    if (ws.deleted) continue; // a tombstone must always be accepted
    const errors = validateWorkspace(ws);
    if (errors.length > 0) problems.push({ id: ws.id, errors });
  }
  for (const item of merged.item) {
    if (item.deleted) continue; // a tombstone must always be accepted
    const errors = validateItem(item, { groups });
    if (errors.length > 0) problems.push({ id: item.id, errors });
  }
  if (mergedSettings.length > 0) {
    try {
      localParts(0, mergedSettings[0].timezone);
    } catch {
      problems.push({ id: 'settings', errors: [{ field: 'timezone', code: 'invalid-timezone' }] });
    }
  }
  if (problems.length > 0) throw new StoreError(422, 'invalid', problems);

  // write only the winners that are not the stored version (mergeLww returns the input objects)
  /** @type {{kind: Kind, entity: any}[]} */
  const changes = [];
  for (const kind of /** @type {const} */ (['workspace', 'group', 'item'])) {
    for (const entity of merged[kind]) if (!stored[kind].includes(entity)) changes.push({ kind, entity });
  }
  for (const entity of mergedSettings) if (entity !== storedSettings) changes.push({ kind: 'settings', entity });
  await writeChanges(db, changes);

  return {
    workspaces: merged.workspace,
    groups: merged.group,
    items: merged.item,
    settings: mergedSettings[0] ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Ticks (the period is decided by the server clock, Law 1)

/** A tick may report a time at most this far ahead of the server's clock (clock skew). */
export const TICK_FUTURE_MS = 5 * 60_000;
/** ... and at most this far behind it. */
export const TICK_PAST_MS = 48 * 3_600_000;
/** The optional abilities this Worker reports in `GET /api/state` (`features`). */
export const FEATURES = Object.freeze(['tick-done-at']);

/**
 * Resolve an item and its period at an instant.
 * @param {any} db
 * @param {string} itemId
 * @param {number} nowMs the instant the period is computed for
 * @returns {Promise<{item: any, tz: string, pk: string | null}>}
 * @throws {StoreError} 404 unknown item
 */
async function currentPeriod(db, itemId, nowMs) {
  const row = await db.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first();
  if (!row) throw new StoreError(404, 'not-found');
  const item = fromRow('item', row);
  const { timezone } = await loadSettings(db);
  const pk = item.deleted || !item.schedule ? null : periodKey(item.schedule, nowMs, timezone, item.resetTime);
  return { item, tz: timezone, pk };
}

/**
 * Record a tick for the item's current period. Idempotent per (item, period): a repeat returns the
 * stored completion.
 * @param {any} db
 * @param {string} itemId
 * @param {number} nowMs server time
 * @param {{doneAt?: unknown}} [opts] `doneAt`: when the tick was made (epoch ms); the period is that instant's,
 *   and it must lie within [now - 48 h, now + 5 min]. Absent: the tick is made now.
 * @returns {Promise<Completion>}
 * @throws {StoreError} 400 `doneAt` not a number; 422 `tick-in-future` / `tick-too-old`; 404 unknown item;
 *   409 deleted, unscheduled, or an every-N-days item not yet started (at `doneAt`)
 */
export async function tick(db, itemId, nowMs, opts = {}) {
  let at = nowMs;
  if (opts.doneAt !== undefined && opts.doneAt !== null) {
    const d = opts.doneAt;
    if (typeof d !== 'number' || !Number.isFinite(d)) throw new StoreError(400, 'bad-request', [{ errors: [{ field: 'doneAt', code: 'invalid-type' }] }]);
    if (d > nowMs + TICK_FUTURE_MS) throw new StoreError(422, 'tick-in-future');
    if (d < nowMs - TICK_PAST_MS) throw new StoreError(422, 'tick-too-old');
    at = Math.trunc(d);
  }
  const { pk } = await currentPeriod(db, itemId, at);
  if (pk === null) throw new StoreError(409, 'not-tickable');
  await db
    .prepare('INSERT OR IGNORE INTO completions (item_id, period_key, done_at) VALUES (?, ?, ?)')
    .bind(itemId, pk, at)
    .run();
  const row = await db.prepare('SELECT * FROM completions WHERE item_id = ? AND period_key = ?').bind(itemId, pk).first();
  return completionFromRow(row);
}

/**
 * Remove the current period's tick; earlier periods' ticks stay.
 * @param {any} db
 * @param {string} itemId
 * @param {number} nowMs server time
 * @param {{periodKey?: unknown}} [opts] `periodKey`: remove that period's tick instead; only the current
 *   period or the one before it is allowed
 * @returns {Promise<{removed: number}>}
 * @throws {StoreError} 400 `periodKey` not a date; 404 unknown item; 422 `period-not-allowed`
 */
export async function untick(db, itemId, nowMs, opts = {}) {
  const wanted = opts.periodKey;
  if (wanted !== undefined && wanted !== null && !isValidDate(wanted)) {
    throw new StoreError(400, 'bad-request', [{ errors: [{ field: 'periodKey', code: 'invalid-date' }] }]);
  }
  const { item, pk: current } = await currentPeriod(db, itemId, nowMs);
  if (current === null) return { removed: 0 };
  let pk = current;
  if (wanted !== undefined && wanted !== null) {
    if (wanted !== current && wanted !== previousPeriodStart(item.schedule, current)) throw new StoreError(422, 'period-not-allowed');
    pk = /** @type {string} */ (wanted);
  }
  const res = await db.prepare('DELETE FROM completions WHERE item_id = ? AND period_key = ?').bind(itemId, pk).run();
  return { removed: res.meta.changes };
}

/**
 * All ticks of one item, newest first.
 * @param {any} db
 * @param {string} itemId
 * @returns {Promise<Completion[]>}
 */
export async function history(db, itemId) {
  const { results } = await db
    .prepare('SELECT * FROM completions WHERE item_id = ? ORDER BY period_key DESC')
    .bind(itemId)
    .all();
  return results.map(completionFromRow);
}