// @ts-check
// Example dataset (decision D54): 2 workspaces, 3 groups, 11 items. It is a generic example only;
// personal data belongs in the git-ignored `config/seed.local.json` (same shape), which seeding
// tools prefer when present. All of it is editable in the apps.

/** @typedef {import('./model.js').Workspace} Workspace */
/** @typedef {import('./model.js').Group} Group */
/** @typedef {import('./model.js').Item} Item */
/** @typedef {import('./model.js').Settings} Settings */
/** @typedef {import('./schedule.js').Schedule} Schedule */

/**
 * @template T
 * @param {T} o
 * @returns {T}
 */
function deepFreeze(o) {
  if (o !== null && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

/**
 * @param {string} id
 * @param {string} name
 * @param {number} order
 * @param {number} sleepAfterMin
 * @returns {Workspace}
 */
function workspace(id, name, order, sleepAfterMin) {
  return { id, name, icon: null, order, sleepAfterMin, openInEdge: false, ungroupedLabel: null, updatedAt: 0, deleted: false };
}

/**
 * @param {string} id
 * @param {string} name
 * @param {number} order
 * @returns {Group}
 */
function group(id, name, order) {
  return { id, workspaceId: 'ws-daily', name, order, collapsed: false, updatedAt: 0, deleted: false };
}

/**
 * @typedef {[name: string, url: string, schedule: Schedule | null, devices?: 'all' | 'desktop' | 'phone']} Entry
 */

/**
 * Items of one parent (workspace + group), ordered as listed. Items with a schedule are daily-bar
 * check-ins (notify/badge off); items without one are plain productivity links (notify/badge on).
 * @param {string} workspaceId
 * @param {string | null} groupId
 * @param {Record<string, Entry>} entries id -> entry
 * @returns {Item[]}
 */
function items(workspaceId, groupId, entries) {
  return Object.entries(entries).map(([id, [name, url, schedule, devices]], order) => ({
    id,
    workspaceId,
    groupId,
    order,
    name,
    icon: null,
    kind: /** @type {const} */ ('web'),
    url,
    appPath: null,
    fallbackUrl: null,
    devices: devices ?? 'all',
    schedule,
    resetTime: '00:00',
    notify: schedule === null,
    badge: schedule === null,
    edge: { mode: /** @type {const} */ ('inherit'), profile: null },
    userAgent: { preset: /** @type {const} */ ('default'), custom: null },
    isolate: false,
    persistSessionCookies: true,
    sleepAfterMin: null,
    updatedAt: 0,
    deleted: false,
  }));
}

/**
 * The example dataset. Deeply frozen: copy before editing.
 * @type {{workspaces: Workspace[], groups: Group[], items: Item[], settings: Settings}}
 */
export const SEED = deepFreeze({
  workspaces: [workspace('ws-productivity', 'Productivity', 0, 0), workspace('ws-daily', 'Daily', 1, 10)],
  groups: [group('g-study', 'Study', 0), group('g-perks', 'Perks', 1), group('g-fun', 'Fun', 2)],
  items: [
    ...items('ws-productivity', null, {
      'it-gcal': ['Google Calendar', 'https://calendar.google.com/calendar/r?authuser={googleEmail}', null],
      'it-mail': ['Mail', 'https://mail.example.com', null],
      'it-tasks': ['Tasks', 'https://tasks.example.com/today', null],
      'it-notes': ['Notes', 'https://notes.example.org', null],
    }),
    ...items('ws-daily', 'g-study', {
      'it-language': ['Language practice', 'https://learn.example.org/daily', { type: 'daily' }],
      'it-coding': ['Coding lessons', 'https://code.example.org/learn', { type: 'daily' }],
    }),
    ...items('ws-daily', 'g-perks', {
      'it-rewards': ['Rewards', 'https://rewards.example.com', { type: 'daily' }],
      'it-monthly-shop': ['Monthly shop (example)', 'https://example.com/shop/{YYYY}{MM}', { type: 'monthly', day: 1 }],
    }),
    ...items('ws-daily', 'g-fun', {
      'it-word-game': ['Word game', 'https://games.example.net/word', { type: 'daily' }],
      'it-weekly-bonus': ['Weekly bonus (example)', 'https://example.com/bonus-weekly', { type: 'weekly', weekday: 1 }],
      'it-every-3-days': ['Every 3 days (example)', 'https://example.com/bonus', { type: 'everyNDays', n: 3, startDate: '2026-01-01' }, 'desktop'],
    }),
  ],
  settings: { timezone: 'UTC', googleEmail: null, updatedAt: 0 },
});
