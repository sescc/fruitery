// @ts-check
// Sync planning for the desktop app: merging the server's state with local edits, the outbox of
// pending changes, the first-connect plan, and the status chip. Pure: no Electron, no fs, no clock
// (`nowMs` is a parameter). Never mutates its inputs.

import { SETTINGS_ID, daysBetween, isValidDate, localParts, mergeLww, periodKey } from '../../../packages/core/index.js';

/** @typedef {import('../../../packages/core/model.js').Workspace} Workspace */
/** @typedef {import('../../../packages/core/model.js').Group} Group */
/** @typedef {import('../../../packages/core/model.js').Item} Item */
/** @typedef {import('../../../packages/core/model.js').Settings} Settings */
/** @typedef {import('../../../packages/core/schedule.js').Completion} Completion */
/** @typedef {{workspaces: Workspace[], groups: Group[], items: Item[], settings: Settings, completions: Completion[]}} Snapshot */
/** The entity kinds exactly as `PUT /api/entities` names them (the keys of its request body). */
/** @typedef {'workspaces' | 'groups' | 'items' | 'settings'} Kind */
/** @typedef {{field: string, code: string}} FieldError */
/** @typedef {{kind: Kind, entity: any, error?: FieldError[]}} OutboxEntry */
/** @typedef {{workspaces?: any[], groups?: any[], items?: any[], settings?: any}} EntitiesBody */
/**
 * A tick or untick made while the Worker could not be reached, waiting to be sent (desktop-only, in cache.json).
 * `doneAt` is when the tick was made on the server's clock as last seen; `periodKey` is the period it was filed under locally.
 * @typedef {{op: 'tick', itemId: string, doneAt: number, periodKey: string} | {op: 'untick', itemId: string, periodKey: string}} TickOp
 */
/**
 * A tick or untick made while the Worker could not be reached, waiting to be sent (desktop-only, in cache.json).
 * doneAt is when the tick was made on the server's clock as last seen; periodKey is the period it was filed under locally.
 * @typedef {{op: 'tick', itemId: string, doneAt: number, periodKey: string} | {op: 'untick', itemId: string, periodKey: string}} TickOp
 */
/**
 * Everything `statusOf` needs. `expiresOn` is the access key's expiry date 'YYYY-MM-DD' (or null).
 * @typedef {{configured: boolean, hasSecret: boolean, inFlight: boolean, offline: boolean, lastError: string | null, expiresOn: string | null}} SyncState
 */

/** @type {readonly Kind[]} */
export const KINDS = Object.freeze(['workspaces', 'groups', 'items', 'settings']);
/** The key is "expiring" this many days ahead (and on the expiry day itself). */
export const EXPIRY_WARNING_DAYS = 14;
/** Most entities in one `PUT /api/entities` request. */
export const MAX_BATCH = 100;
/** Most waiting ticks and unticks kept (one per item and period, so it is never reached in practice). */
export const MAX_TICK_OPS = 500;
/** The `features` entry of `GET /api/state` that says the Worker files a tick under the time it is given. */
export const TICK_FEATURE = 'tick-done-at';

/**
 * @param {{id?: string}} e
 * @returns {string} the entity's id, or the fixed id of the (id-less) settings
 */
function idOf(e) {
  return typeof e.id === 'string' ? e.id : SETTINGS_ID;
}

/**
 * @param {{updatedAt?: number}} e
 * @returns {number}
 */
function stampOf(e) {
  return typeof e.updatedAt === 'number' && Number.isFinite(e.updatedAt) ? e.updatedAt : 0;
}

/**
 * @param {Kind} kind
 * @param {any} entity
 * @returns {string} key unique across kinds
 */
function keyOf(kind, entity) {
  return `${kind}\u0000${idOf(entity)}`;
}

/**
 * A snapshot's entities of one kind as a list (settings is a single entity).
 * @param {any} snap
 * @param {Kind} kind
 * @returns {any[]}
 */
function listOf(snap, kind) {
  const v = snap?.[kind];
  if (kind === 'settings') return v && typeof v === 'object' ? [v] : [];
  return Array.isArray(v) ? v : [];
}

/**
 * Merge the server's state with local edits that have not been confirmed yet.
 * Per kind the remote entities are the base; an outbox entity replaces the remote one only if it
 * wins under `mergeLww` (newer `updatedAt`, ties by core's tie-break), and an outbox entity the
 * server does not have is kept. Local entities that are neither remote nor in the outbox are dropped
 * (the server is the source of truth once synced). Completions come from the remote, with the waiting ticks
 * and unticks (`tickOps`) applied on top.
 * Tombstones are ordinary versions in both directions. Remote order is kept, outbox-only entities
 * follow in outbox order. The result may share entity objects with the inputs.
 * @param {Partial<Snapshot>} local the current local snapshot (only used when the remote has no settings)
 * @param {Partial<Snapshot>} remote the answer of `GET /api/state`
 * @param {OutboxEntry[]} outbox
 * @param {TickOp[]} [tickOps] waiting ticks and unticks, applied over the server's completions
 * @returns {Snapshot}
 */
export function mergeSnapshot(local, remote, outbox, tickOps = []) {
  /** @type {any} */
  const out = {};
  for (const kind of KINDS) {
    const base = listOf(remote, kind);
    const pending = outbox.filter((o) => o.kind === kind).map((o) => o.entity);
    /** @type {Map<string, any>} */
    const winners = new Map();
    for (const e of mergeLww(base, pending)) winners.set(idOf(e), e);
    /** @type {any[]} */
    const merged = [];
    const seen = new Set();
    for (const e of [...base, ...pending]) {
      const id = idOf(e);
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(winners.get(id));
    }
    if (kind === 'settings') {
      // a server without settings is not expected; keep the local ones rather than lose them
      out.settings = merged[0] ?? local.settings;
    } else {
      out[kind] = merged;
    }
  }
  out.completions = applyTickOps(Array.isArray(remote.completions) ? remote.completions : [], tickOps);
  return /** @type {Snapshot} */ (out);
}

/**
 * Add changed entities to the outbox. One entry per (kind, id): the newest version under
 * `mergeLww` is kept. An entry replaced by a newer version loses its old `error`; a version that
 * loses (older) or is identical changes nothing.
 * @param {OutboxEntry[]} outbox
 * @param {Kind} kind
 * @param {any[] | any} entities a list (or one entity, which is how settings come)
 * @returns {OutboxEntry[]} a new outbox
 */
export function enqueue(outbox, kind, entities) {
  /** @type {OutboxEntry[]} */
  const next = outbox.map((o) => ({ ...o }));
  /** @type {Map<string, number>} */
  const at = new Map(next.map((o, i) => [keyOf(o.kind, o.entity), i]));
  for (const incoming of Array.isArray(entities) ? entities : [entities]) {
    if (incoming === null || typeof incoming !== 'object') continue;
    const key = keyOf(kind, incoming);
    const i = at.get(key);
    if (i === undefined) {
      at.set(key, next.length);
      next.push({ kind, entity: structuredClone(incoming) });
      continue;
    }
    const [winner] = mergeLww([next[i].entity], [incoming]);
    if (winner === incoming) next[i] = { kind, entity: structuredClone(incoming) };
  }
  return next;
}

/**
 * The next request: entries without an error (at most `max`; workspaces, groups, items, then settings,
 * each in outbox order) grouped as the
 * `PUT /api/entities` body expects: `{workspaces?, groups?, items?, settings?}`. Kinds without
 * entries are left out; `settings` is the single entity.
 * @param {OutboxEntry[]} outbox
 * @param {number} [max]
 * @returns {EntitiesBody} an empty object when there is nothing to send
 */
export function sendable(outbox, max = MAX_BATCH) {
  /** @type {EntitiesBody} */
  const body = {};
  let n = 0;
  // workspaces and groups first, so a batch never holds an item whose group is only in a later batch
  for (const kind of KINDS) {
    for (const o of outbox) {
      if (o.kind !== kind) continue;
      if (n >= max) return body;
      if (o.error && o.error.length > 0) continue;
      if (kind === 'settings') body.settings = o.entity;
      else (body[kind] ??= []).push(o.entity);
      n += 1;
    }
  }
  return body;
}

/**
 * Keys of everything that was sent, from the request body or a list of outbox entries.
 * @param {EntitiesBody | OutboxEntry[]} sent
 * @returns {Set<string>}
 */
function sentKeys(sent) {
  const keys = new Set();
  if (Array.isArray(sent)) {
    for (const o of sent) keys.add(keyOf(o.kind, o.entity));
    return keys;
  }
  for (const kind of KINDS) for (const e of listOf(sent, kind)) keys.add(keyOf(kind, e));
  return keys;
}

/**
 * Update the outbox after one push.
 * - Success: `response` is the server's answer `{workspaces, groups, items, settings}` (the stored
 *   winners for the sent ids). A sent entry is removed when the stored version's `updatedAt` is at
 *   least the entry's; an entry edited again since sending (newer than the stored version) stays.
 *   A sent entry the response does not mention stays too.
 * - Rejection: `response` is the `{error, details: [{id?, errors: [{field, code}]}]}` body of a 422
 *   (or a 400 with the same shape). The server stored nothing, so every entry stays; the sent
 *   entries whose id is listed get that problem's errors. Sent entries not listed stay unmarked, and
 *   problems naming an id that was not sent are ignored.
 * @param {OutboxEntry[]} outbox
 * @param {EntitiesBody | OutboxEntry[]} sent what was sent: the request body from `sendable`, or its entries
 * @param {any} response
 * @returns {OutboxEntry[]} a new outbox
 */
export function afterPush(outbox, sent, response) {
  const keys = sentKeys(sent);
  if (response && typeof response.error === 'string' && Array.isArray(response.details)) {
    /** @type {Map<string, FieldError[]>} */
    const problems = new Map();
    for (const p of response.details) {
      if (!p || typeof p.id !== 'string' || !Array.isArray(p.errors)) continue;
      const errors = p.errors
        .filter((/** @type {any} */ e) => e && typeof e.field === 'string' && typeof e.code === 'string')
        .map((/** @type {any} */ e) => ({ field: e.field, code: e.code }));
      problems.set(p.id, [...(problems.get(p.id) ?? []), ...errors]);
    }
    return outbox.map((o) => {
      const errors = keys.has(keyOf(o.kind, o.entity)) ? problems.get(idOf(o.entity)) : undefined;
      return errors && errors.length > 0 ? { ...o, error: errors } : { ...o };
    });
  }
  /** @type {Map<string, number>} */
  const stored = new Map();
  for (const kind of KINDS) for (const e of listOf(response, kind)) stored.set(keyOf(kind, e), stampOf(e));
  return outbox
    .filter((o) => {
      const key = keyOf(o.kind, o.entity);
      if (!keys.has(key) || !stored.has(key)) return true;
      return stampOf(o.entity) > /** @type {number} */ (stored.get(key));
    })
    .map((o) => ({ ...o }));
}

/**
 * The plan for the first connect: local edits that are newer than the server (owner decision
 * 2026-10-20: keep newer local edits). Every local entity with `updatedAt > 0` that the server
 * lacks, or has with a strictly older `updatedAt`, goes to the outbox. Equal timestamps: the
 * remote wins, nothing is pushed. Untouched seed rows (`updatedAt` 0 or missing) are never pushed.
 * Settings follow the same rule.
 * @param {Partial<Snapshot>} local
 * @param {Partial<Snapshot>} remote
 * @returns {{outbox: OutboxEntry[]}}
 */
export function firstSyncPlan(local, remote) {
  /** @type {OutboxEntry[]} */
  let outbox = [];
  for (const kind of KINDS) {
    const remoteStamp = new Map(listOf(remote, kind).map((e) => [idOf(e), stampOf(e)]));
    const wanted = listOf(local, kind).filter((e) => {
      const t = stampOf(e);
      if (t <= 0) return false;
      const r = remoteStamp.get(idOf(e));
      return r === undefined || t > r;
    });
    outbox = enqueue(outbox, kind, wanted);
  }
  return { outbox };
}

/**
 * The completions to POST on the first connect: for each live scheduled item, its tick of the
 * current period only (the server then supplies the history). Unscheduled and deleted items, ticks
 * of past periods, ticks of unknown items, and items without a current period (an every-N-days
 * schedule not yet started, or an unusable schedule) give nothing. One completion per item (the
 * earliest `doneAt` if there are duplicates).
 * @param {Completion[]} localCompletions
 * @param {Item[]} items
 * @param {number} nowMs
 * @param {string} tz IANA timezone name
 * @returns {Completion[]}
 * @throws {RangeError} 'invalid-timezone' | 'invalid-instant'
 */
export function firstSyncTicks(localCompletions, items, nowMs, tz) {
  localParts(nowMs, tz); // fail loudly on a bad timezone or instant instead of returning nothing
  /** @type {Map<string, Item>} */
  const live = new Map();
  for (const item of items) if (!item.deleted && item.schedule) live.set(item.id, item);
  /** @type {Map<string, string | null>} */
  const current = new Map();
  /** @type {Map<string, Completion>} */
  const picked = new Map();
  for (const c of localCompletions) {
    const item = live.get(c.itemId);
    if (!item) continue;
    if (!current.has(item.id)) {
      let pk = null;
      try {
        pk = periodKey(item.schedule, nowMs, tz, item.resetTime);
      } catch {
        pk = null; // unusable schedule or reset time: nothing to send for this item
      }
      current.set(item.id, pk);
    }
    if (c.periodKey !== current.get(item.id)) continue;
    const prev = picked.get(item.id);
    if (!prev || c.doneAt < prev.doneAt) picked.set(item.id, c);
  }
  return [...picked.values()].map((c) => ({ ...c }));
}

/**
 * The sync status shown in the chip. First match wins:
 * 1. not configured, or no secret: `not-connected`
 * 2. today (the local date in `tz`) is after `expiresOn`: `expired`
 * 3. a last error: `error:<lastError>`
 * 4. offline: `offline`
 * 5. `expiresOn` is 0..14 days away: `expiring:<days>` (the expiry day itself is `expiring:0`)
 * 6. a sync in flight: `syncing`
 * 7. `synced`
 * Without a (valid) `expiresOn` no expiry check is made.
 * @param {SyncState} state
 * @param {number} nowMs
 * @param {string} tz IANA timezone name
 * @returns {string} 'not-connected' | 'expired' | 'error:<reason>' | 'offline' | 'expiring:<days>' | 'syncing' | 'synced'
 */
export function statusOf(state, nowMs, tz) {
  if (!state.configured || !state.hasSecret) return 'not-connected';
  /** @type {number | null} */
  let days = null;
  if (isValidDate(state.expiresOn)) days = daysBetween(localParts(nowMs, tz).date, /** @type {string} */ (state.expiresOn));
  if (days !== null && days < 0) return 'expired';
  if (state.lastError) return `error:${state.lastError}`;
  if (state.offline) return 'offline';
  if (days !== null && days <= EXPIRY_WARNING_DAYS) return `expiring:${days}`;
  if (state.inFlight) return 'syncing';
  return 'synced';
}

// ---------------------------------------------------------------------------------------------
// Ticks made without a connection

/**
 * @param {{itemId: string, periodKey: string}} a
 * @param {{itemId: string, periodKey: string}} b
 */
const sameTickKey = (a, b) => a.itemId === b.itemId && a.periodKey === b.periodKey;

/**
 * Add a waiting tick or untick. One op per (item, period):
 * - tick over a waiting tick: no change (the first time wins, as on the server);
 * - untick over a waiting tick: both disappear;
 * - tick over a waiting untick: the untick disappears and no tick is added (the server still has the completion);
 * - untick over a waiting untick: no change.
 * @param {TickOp[]} ops
 * @param {TickOp} op
 * @returns {TickOp[]} a new list
 */
export function enqueueTick(ops, op) {
  const same = ops.find((o) => sameTickKey(o, op));
  if (!same) return [...ops.map((o) => ({ ...o })), { ...op }];
  if (same.op === op.op) return ops.map((o) => ({ ...o }));
  return ops.filter((o) => o !== same).map((o) => ({ ...o }));
}

/**
 * Put waiting ticks and unticks over a list of completions: a waiting tick adds its completion when there is
 * none for that item and period, a waiting untick removes it. Pending is therefore deduced from the queue.
 * @param {Completion[]} completions
 * @param {TickOp[]} ops
 * @returns {Completion[]} a new list
 */
export function applyTickOps(completions, ops) {
  let out = completions.map((c) => ({ ...c }));
  for (const op of ops) {
    if (op.op === 'tick') {
      if (!out.some((c) => sameTickKey(c, op))) out.push({ itemId: op.itemId, periodKey: op.periodKey, doneAt: op.doneAt });
    } else {
      out = out.filter((c) => !sameTickKey(c, op));
    }
  }
  return out;
}

/** Why the server refuses a reported time or period; anything else it refuses with is just "refused". */
const TICK_REFUSALS = ['tick-too-old', 'tick-in-future', 'period-not-allowed'];

/**
 * What to do after sending one waiting op.
 * - Success: the op is removed.
 * - 422 with `tick-too-old` / `tick-in-future` / `period-not-allowed` (or any other 422, or a 400): the op is
 *   dropped and `dropped` carries the reason (the owner is told).
 * - 404 or 409 (the item is gone, unscheduled, or not tickable at that time): dropped silently.
 * - The connection failed (offline, denied, refused) or the server errored (5xx, ...): stop, keep the op.
 * @param {TickOp[]} ops the queue as it is now (it may have changed while the request ran)
 * @param {TickOp} op the op that was sent
 * @param {import('./sync-config.js').ApiResult} result
 * @returns {{ops: TickOp[], action: 'next' | 'stop', dropped: string | null, error: string | null}}
 *   `error` is set only for an HTTP failure worth showing (`http-<status>`)
 */
export function afterTickSend(ops, op, result) {
  const rest = ops.filter((o) => !(sameTickKey(o, op) && o.op === op.op)).map((o) => ({ ...o }));
  if (result.ok) return { ops: rest, action: 'next', dropped: null, error: null };
  if (result.kind === 'invalid') {
    const code = result.json && typeof result.json.error === 'string' ? result.json.error : '';
    return { ops: rest, action: 'next', dropped: TICK_REFUSALS.includes(code) ? code : 'refused', error: null };
  }
  if (result.kind === 'http') {
    if (result.status === 404 || result.status === 409) return { ops: rest, action: 'next', dropped: null, error: null };
    if (result.status === 400) return { ops: rest, action: 'next', dropped: 'refused', error: null };
    return { ops: ops.map((o) => ({ ...o })), action: 'stop', dropped: null, error: `http-${result.status}` };
  }
  return { ops: ops.map((o) => ({ ...o })), action: 'stop', dropped: null, error: null };
}

/**
 * Does the Worker's answer say it files a tick under the time it is given?
 * @param {unknown} features the `features` of `GET /api/state` (absent on an old Worker)
 * @returns {boolean}
 */
export function hasTickFeature(features) {
  return Array.isArray(features) && features.includes(TICK_FEATURE);
}