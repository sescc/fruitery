// @ts-check
// Data model typedefs and pure functions over Items: validation, defaults resolution, moving.

import { parseHHMM } from './time.js';
import { validateSchedule } from './schedule.js';
import { unknownTokens } from './url-tokens.js';

/** @typedef {import('./schedule.js').Schedule} Schedule */
/** @typedef {import('./schedule.js').Completion} Completion */

/**
 * @typedef {object} Workspace
 * @property {string} id
 * @property {string} name
 * @property {string | null} icon
 * @property {number} order
 * @property {number} sleepAfterMin int >= 0, 0 = never
 * @property {boolean} openInEdge default for items whose Edge mode is 'inherit'
 * @property {string | null} [ungroupedLabel] name shown for items without a group (at most 40 characters, not blank); absent or null = "Default" (see `ungroupedLabelOf`)
 * @property {number} updatedAt epoch ms
 * @property {boolean} deleted
 */

/**
 * @typedef {object} Group
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} name
 * @property {number} order
 * @property {boolean} collapsed
 * @property {number} updatedAt epoch ms
 * @property {boolean} deleted
 */

/** @typedef {{mode: 'inherit' | 'never' | 'always', profile: string | null}} EdgePref */

/** @typedef {{preset: 'default' | 'chrome' | 'firefox' | 'custom', custom: string | null}} UserAgentPref */

/**
 * @typedef {object} Item
 * @property {string} id
 * @property {string} workspaceId
 * @property {string | null} groupId
 * @property {number} order
 * @property {string} name
 * @property {string | null} icon
 * @property {'web' | 'app'} kind
 * @property {string | null} url
 * @property {string | null} appPath
 * @property {string | null} fallbackUrl
 * @property {'all' | 'desktop' | 'phone'} devices
 * @property {Schedule | null} schedule
 * @property {string} resetTime 'HH:MM'
 * @property {boolean} notify
 * @property {boolean} badge
 * @property {EdgePref} edge
 * @property {boolean} isolate
 * @property {boolean} persistSessionCookies
 * @property {number | null} sleepAfterMin int >= 0; null = inherit the workspace value
 * @property {UserAgentPref} [userAgent] desktop user-agent preset; absent = default (see userAgentOf)
 * @property {number} updatedAt epoch ms
 * @property {boolean} deleted
 */

/** @typedef {{timezone: string, googleEmail: string | null, updatedAt: number}} Settings */

/** @typedef {{field: string, code: string}} ValidationError */

const USER_AGENT_PRESETS = ['default', 'chrome', 'firefox', 'custom'];
const USER_AGENT_MAX = 512;
const UNGROUPED_LABEL_MAX = 40;
const DEFAULT_UNGROUPED_LABEL = 'Default';
const HTTP_URL_RE = /^https?:\/\/[^\s/?#]+\S*$/i;

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isHttpUrl(v) {
  return typeof v === 'string' && HTTP_URL_RE.test(v);
}

/**
 * Validate an item, collecting every problem (never throws, never mutates).
 *
 * Error codes (`{field, code}`):
 * - `required`: `name` empty/blank; `url` missing on a web item; `appPath` missing on an app item.
 * - `invalid-url`: `url` / `fallbackUrl` present but not an http(s) URL.
 * - `invalid-time`: `resetTime` is not a valid `HH:MM`.
 * - `out-of-range`: `schedule.weekday` not 1-7, `schedule.day` not 1-31, `schedule.n` not an
 *   integer >= 1, `sleepAfterMin` negative or not whole.
 * - `invalid-date`: `schedule.startDate` is not a real calendar date.
 * - `invalid-value`: `kind`, `devices`, `edge.mode`, `edge.profile`, `schedule.type` outside the
 *   allowed set; `schedule` / `edge` of the wrong shape.
 * - `userAgent.preset` `invalid-value` (unknown preset, or `userAgent` not an object), `userAgent.custom`
 *   `required` (custom preset with an empty string) or `out-of-range` (more than 512 characters).
 *   An absent or null `userAgent` is valid and means the default preset.
 * - `unknown-token`: `url` / `fallbackUrl` contains a `{placeholder}` that is not a known token.
 * - `group-workspace-mismatch`: `groupId` refers to a group of another workspace (field `groupId`).
 * - `group-not-found`: `groupId` is set, `groups` was supplied, and no group has that id.
 *
 * The group checks run only when `groups` is supplied.
 * @param {Partial<Item> | null | undefined} item
 * @param {{groups?: Group[]}} [context]
 * @returns {ValidationError[]}
 */
export function validateItem(item, context = {}) {
  /** @type {ValidationError[]} */
  const errors = [];
  if (item === null || typeof item !== 'object') {
    errors.push({ field: 'item', code: 'required' });
    return errors;
  }

  if (typeof item.name !== 'string' || item.name.trim() === '') errors.push({ field: 'name', code: 'required' });

  if (item.kind !== 'web' && item.kind !== 'app') errors.push({ field: 'kind', code: 'invalid-value' });

  if (item.kind === 'web' && isBlank(item.url)) errors.push({ field: 'url', code: 'required' });
  else if (!isBlank(item.url) && !isHttpUrl(item.url)) errors.push({ field: 'url', code: 'invalid-url' });

  if (item.kind === 'app' && isBlank(item.appPath)) errors.push({ field: 'appPath', code: 'required' });

  if (!isBlank(item.fallbackUrl) && !isHttpUrl(item.fallbackUrl)) errors.push({ field: 'fallbackUrl', code: 'invalid-url' });

  for (const field of /** @type {const} */ (['url', 'fallbackUrl'])) {
    const v = item[field];
    if (typeof v === 'string' && unknownTokens(v).length > 0) errors.push({ field, code: 'unknown-token' });
  }

  if (parseHHMM(item.resetTime) === null) errors.push({ field: 'resetTime', code: 'invalid-time' });

  if (item.schedule !== null && item.schedule !== undefined) errors.push(...validateSchedule(item.schedule));

  const sleep = item.sleepAfterMin;
  if (sleep !== null && sleep !== undefined && !(typeof sleep === 'number' && Number.isInteger(sleep) && sleep >= 0)) {
    errors.push({ field: 'sleepAfterMin', code: 'out-of-range' });
  }

  if (item.devices !== 'all' && item.devices !== 'desktop' && item.devices !== 'phone') {
    errors.push({ field: 'devices', code: 'invalid-value' });
  }

  const edge = item.edge;
  if (edge === null || typeof edge !== 'object') {
    errors.push({ field: 'edge.mode', code: 'invalid-value' });
  } else {
    if (edge.mode !== 'inherit' && edge.mode !== 'never' && edge.mode !== 'always') {
      errors.push({ field: 'edge.mode', code: 'invalid-value' });
    }
    if (edge.profile !== null && edge.profile !== undefined && typeof edge.profile !== 'string') {
      errors.push({ field: 'edge.profile', code: 'invalid-value' });
    }
  }

  const ua = item.userAgent;
  if (ua !== null && ua !== undefined) {
    if (typeof ua !== 'object' || Array.isArray(ua) || !USER_AGENT_PRESETS.includes(/** @type {string} */ (ua.preset))) {
      errors.push({ field: 'userAgent.preset', code: 'invalid-value' });
    } else if (ua.preset === 'custom') {
      if (typeof ua.custom !== 'string' || ua.custom.trim() === '') errors.push({ field: 'userAgent.custom', code: 'required' });
      else if (ua.custom.length > USER_AGENT_MAX) errors.push({ field: 'userAgent.custom', code: 'out-of-range' });
    }
  }

  if (item.groupId !== null && item.groupId !== undefined && context.groups) {
    const group = context.groups.find((g) => g.id === item.groupId);
    if (!group) errors.push({ field: 'groupId', code: 'group-not-found' });
    else if (group.workspaceId !== item.workspaceId) errors.push({ field: 'groupId', code: 'group-workspace-mismatch' });
  }

  return errors;
}

/**
 * Validate a workspace, collecting every problem (never throws, never mutates).
 * Codes (`{field, code}`): `name` `required` (blank); `ungroupedLabel` `invalid-value` (not a string),
 * `required` (set but blank) or `out-of-range` (more than 40 characters). An absent or null
 * `ungroupedLabel` is valid and means "Default".
 * @param {Partial<Workspace> | null | undefined} ws
 * @returns {ValidationError[]}
 */
export function validateWorkspace(ws) {
  /** @type {ValidationError[]} */
  const errors = [];
  if (ws === null || typeof ws !== 'object') return [{ field: 'workspace', code: 'required' }];
  if (typeof ws.name !== 'string' || ws.name.trim() === '') errors.push({ field: 'name', code: 'required' });
  const label = ws.ungroupedLabel;
  if (label !== null && label !== undefined) {
    if (typeof label !== 'string') errors.push({ field: 'ungroupedLabel', code: 'invalid-value' });
    else if (label.trim() === '') errors.push({ field: 'ungroupedLabel', code: 'required' });
    else if (label.trim().length > UNGROUPED_LABEL_MAX) errors.push({ field: 'ungroupedLabel', code: 'out-of-range' });
  }
  return errors;
}

/**
 * The name shown for a workspace's items without a group: its own label, else "Default".
 * @param {{ungroupedLabel?: string | null} | null | undefined} ws
 * @returns {string}
 */
export function ungroupedLabelOf(ws) {
  const label = ws?.ungroupedLabel;
  return typeof label === 'string' && label.trim() !== '' ? label.trim() : DEFAULT_UNGROUPED_LABEL;
}
/**
 * Effective sleep minutes: the item's own setting when present, otherwise its workspace's.
 * @param {Pick<Item, 'sleepAfterMin'>} item
 * @param {Pick<Workspace, 'sleepAfterMin'>} workspace
 * @returns {number} minutes; 0 = never sleeps
 */
export function effectiveSleep(item, workspace) {
  return item.sleepAfterMin ?? workspace.sleepAfterMin;
}

/**
 * Resolve "open in Edge" for an item. 'always' opens, 'never' does not, 'inherit' follows the
 * workspace default. The profile is the item's profile when set, otherwise the device default
 * profile, otherwise null (Edge's own default). When not opening in Edge the profile is null.
 * @param {Pick<Item, 'edge'>} item
 * @param {Pick<Workspace, 'openInEdge'>} workspace
 * @param {string | null | undefined} deviceDefaultProfile
 * @returns {{open: boolean, profile: string | null}}
 */
export function effectiveEdge(item, workspace, deviceDefaultProfile) {
  const mode = item.edge.mode;
  const open = mode === 'always' || (mode === 'inherit' && workspace.openInEdge === true);
  if (!open) return { open: false, profile: null };
  return { open: true, profile: item.edge.profile || deviceDefaultProfile || null };
}

/**
 * The item's user-agent preference; an item without one (or with an unusable one) uses the default.
 * @param {{userAgent?: UserAgentPref | null}} item
 * @returns {UserAgentPref} a new object
 */
export function userAgentOf(item) {
  const ua = item.userAgent;
  if (ua && typeof ua === 'object' && USER_AGENT_PRESETS.includes(ua.preset)) {
    return { preset: ua.preset, custom: typeof ua.custom === 'string' ? ua.custom : null };
  }
  return { preset: 'default', custom: null };
}

/**
 * Move an item to another workspace: same id (so its ticks still apply), group cleared,
 * `updatedAt` bumped. `order` is left as is: the caller places the item among its new siblings
 * (see `reorder`). Moving to the item's current workspace returns an unchanged copy.
 * @param {Item} item
 * @param {string} toWorkspaceId
 * @param {number} nowMs epoch ms
 * @returns {Item} a new object; the input is not mutated
 */
export function moveItem(item, toWorkspaceId, nowMs) {
  const ua = item.userAgent ? { userAgent: { ...item.userAgent } } : {};
  if (item.workspaceId === toWorkspaceId) return { ...item, edge: { ...item.edge }, ...ua };
  return { ...item, edge: { ...item.edge }, ...ua, workspaceId: toWorkspaceId, groupId: null, updatedAt: nowMs };
}
