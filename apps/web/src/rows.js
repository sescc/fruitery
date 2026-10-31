// @ts-check
// D1 row <-> core entity mapping. Rows mirror the core shapes 1:1 (booleans 0/1, schedule as JSON,
// edge as edge_mode/edge_profile, `order` as `ord` because ORDER is reserved in SQL).

/** @typedef {import('../../../packages/core/model.js').Workspace} Workspace */
/** @typedef {import('../../../packages/core/model.js').Group} Group */
/** @typedef {import('../../../packages/core/model.js').Item} Item */
/** @typedef {import('../../../packages/core/model.js').Settings} Settings */
/** @typedef {import('../../../packages/core/schedule.js').Completion} Completion */
/** @typedef {'workspace' | 'group' | 'item' | 'settings'} Kind */
/** @typedef {Record<string, string | number | null>} Row */

/** Table and ordered column list per entity kind. The first column is the primary key. */
export const TABLES = Object.freeze({
  workspace: { table: 'workspaces', columns: ['id', 'name', 'icon', 'ord', 'sleep_after_min', 'open_in_edge', 'ungrouped_label', 'updated_at', 'deleted'] },
  group: { table: 'groups', columns: ['id', 'workspace_id', 'name', 'ord', 'collapsed', 'updated_at', 'deleted'] },
  item: {
    table: 'items',
    columns: [
      'id', 'workspace_id', 'group_id', 'ord', 'name', 'icon', 'kind', 'url', 'app_path', 'fallback_url', 'devices',
      'schedule', 'reset_time', 'notify', 'badge', 'edge_mode', 'edge_profile', 'isolate', 'persist_session_cookies',
      'sleep_after_min', 'user_agent', 'deep_link', 'updated_at', 'deleted',
    ],
  },
  settings: { table: 'settings', columns: ['id', 'timezone', 'google_email', 'updated_at'] },
});

/**
 * The stored user-agent preference: NULL (or an unreadable value) means the default preset. A readable
 * value is returned as stored, unnormalised, so validation can still reject a bad preset.
 * @param {string | null | undefined} text
 * @returns {import('../../../packages/core/model.js').UserAgentPref}
 */
function decodeUserAgent(text) {
  if (text === null || text === undefined) return { preset: 'default', custom: null };
  try {
    const v = JSON.parse(text);
    if (v !== null && typeof v === 'object') return v;
  } catch {
    // fall through to the default
  }
  return { preset: 'default', custom: null };
}

/** @param {boolean} b */
const bit = (b) => (b ? 1 : 0);

/**
 * @param {Kind} kind
 * @param {any} e a core entity
 * @returns {Row}
 */
export function toRow(kind, e) {
  switch (kind) {
    case 'workspace':
      return {
        id: e.id, name: e.name, icon: e.icon ?? null, ord: e.order, sleep_after_min: e.sleepAfterMin,
        open_in_edge: bit(e.openInEdge), ungrouped_label: e.ungroupedLabel ?? null, updated_at: e.updatedAt, deleted: bit(e.deleted),
      };
    case 'group':
      return {
        id: e.id, workspace_id: e.workspaceId, name: e.name, ord: e.order, collapsed: bit(e.collapsed),
        updated_at: e.updatedAt, deleted: bit(e.deleted),
      };
    case 'item':
      return {
        id: e.id, workspace_id: e.workspaceId, group_id: e.groupId ?? null, ord: e.order, name: e.name,
        icon: e.icon ?? null, kind: e.kind, url: e.url ?? null, app_path: e.appPath ?? null,
        fallback_url: e.fallbackUrl ?? null, devices: e.devices,
        schedule: e.schedule === null || e.schedule === undefined ? null : JSON.stringify(e.schedule),
        reset_time: e.resetTime, notify: bit(e.notify), badge: bit(e.badge), edge_mode: e.edge.mode,
        edge_profile: e.edge.profile ?? null, isolate: bit(e.isolate),
        persist_session_cookies: bit(e.persistSessionCookies), sleep_after_min: e.sleepAfterMin ?? null,
        user_agent: e.userAgent === null || e.userAgent === undefined ? null : JSON.stringify(e.userAgent),
        deep_link: e.deepLink ?? null,
        updated_at: e.updatedAt, deleted: bit(e.deleted),
      };
    case 'settings':
      return { id: 'settings', timezone: e.timezone, google_email: e.googleEmail ?? null, updated_at: e.updatedAt };
  }
}

/**
 * @param {Kind} kind
 * @param {Record<string, any>} r a D1 row
 * @returns {any} a core entity (Workspace | Group | Item | Settings)
 */
export function fromRow(kind, r) {
  switch (kind) {
    case 'workspace':
      return /** @type {Workspace} */ ({
        id: r.id, name: r.name, icon: r.icon, order: r.ord, sleepAfterMin: r.sleep_after_min,
        openInEdge: r.open_in_edge === 1, ungroupedLabel: r.ungrouped_label ?? null, updatedAt: r.updated_at, deleted: r.deleted === 1,
      });
    case 'group':
      return /** @type {Group} */ ({
        id: r.id, workspaceId: r.workspace_id, name: r.name, order: r.ord, collapsed: r.collapsed === 1,
        updatedAt: r.updated_at, deleted: r.deleted === 1,
      });
    case 'item':
      return /** @type {Item} */ ({
        id: r.id, workspaceId: r.workspace_id, groupId: r.group_id, order: r.ord, name: r.name, icon: r.icon,
        kind: r.kind, url: r.url, appPath: r.app_path, fallbackUrl: r.fallback_url, devices: r.devices,
        schedule: r.schedule === null || r.schedule === undefined ? null : JSON.parse(r.schedule),
        resetTime: r.reset_time, notify: r.notify === 1, badge: r.badge === 1,
        edge: { mode: r.edge_mode, profile: r.edge_profile }, isolate: r.isolate === 1,
        persistSessionCookies: r.persist_session_cookies === 1, sleepAfterMin: r.sleep_after_min,
        userAgent: decodeUserAgent(r.user_agent), deepLink: r.deep_link ?? null, updatedAt: r.updated_at, deleted: r.deleted === 1,
      });
    case 'settings':
      return /** @type {Settings} */ ({ timezone: r.timezone, googleEmail: r.google_email, updatedAt: r.updated_at });
  }
}

/**
 * @param {Completion} c
 * @returns {Row}
 */
export function completionToRow(c) {
  return { item_id: c.itemId, period_key: c.periodKey, done_at: c.doneAt };
}

/**
 * @param {Record<string, any>} r
 * @returns {Completion}
 */
export function completionFromRow(r) {
  return { itemId: r.item_id, periodKey: r.period_key, doneAt: r.done_at };
}

/**
 * The upsert statement for a kind: insert, or overwrite every column when the id exists.
 * @param {Kind} kind
 * @returns {string}
 */
export function upsertSql(kind) {
  const { table, columns } = TABLES[kind];
  const sets = columns.slice(1).map((c) => `${c} = excluded.${c}`).join(', ');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${sets}`;
}

/**
 * Bind values of a row in the kind's column order.
 * @param {Kind} kind
 * @param {Row} row
 * @returns {(string | number | null)[]}
 */
export function rowValues(kind, row) {
  return TABLES[kind].columns.map((c) => row[c]);
}
