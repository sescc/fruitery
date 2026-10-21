// @ts-check
// Shared fixtures for the core tests. Not part of the public API (not exported from index.js).

/**
 * Epoch ms of a wall-clock time in Asia/Tokyo (UTC+9, no DST).
 * @param {string} local e.g. '2026-10-12T15:00'
 * @returns {number}
 */
export function tokyo(local) {
  return Date.parse(`${local}:00+09:00`);
}

/**
 * Epoch ms of a UTC instant.
 * @param {string} iso e.g. '2026-10-11T17:30'
 * @returns {number}
 */
export function utc(iso) {
  return Date.parse(`${iso}:00Z`);
}

/**
 * Deterministic PRNG.
 * @param {number} seed
 * @returns {() => number} floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A valid web item; override any field.
 * @param {Record<string, unknown>} [overrides]
 * @returns {import('./model.js').Item}
 */
export function makeItem(overrides = {}) {
  return /** @type {import('./model.js').Item} */ ({
    id: 'it-1',
    workspaceId: 'ws-daily',
    groupId: null,
    order: 0,
    name: 'Daily rewards',
    icon: null,
    kind: 'web',
    url: 'https://rewards.example.com',
    appPath: null,
    fallbackUrl: null,
    devices: 'all',
    schedule: { type: 'daily' },
    resetTime: '00:00',
    notify: false,
    badge: false,
    edge: { mode: 'inherit', profile: null },
    isolate: false,
    persistSessionCookies: true,
    sleepAfterMin: null,
    updatedAt: 0,
    deleted: false,
    ...overrides,
  });
}

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {import('./model.js').Workspace}
 */
export function makeWorkspace(overrides = {}) {
  return /** @type {import('./model.js').Workspace} */ ({
    id: 'ws-daily',
    name: 'Daily',
    icon: null,
    order: 1,
    sleepAfterMin: 10,
    openInEdge: false,
    updatedAt: 0,
    deleted: false,
    ...overrides,
  });
}

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {import('./model.js').Group}
 */
export function makeGroup(overrides = {}) {
  return /** @type {import('./model.js').Group} */ ({
    id: 'g-1',
    workspaceId: 'ws-daily',
    name: 'Learning',
    order: 0,
    collapsed: false,
    updatedAt: 0,
    deleted: false,
    ...overrides,
  });
}
