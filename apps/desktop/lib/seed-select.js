// @ts-check
// First-run seed selection: the personal seed (git-ignored) when it is valid, else the example.

import { validateItem } from '../../../packages/core/index.js';

/** @typedef {{workspaces: any[], groups: any[], items: any[], settings: any}} SeedData */

/**
 * Is the parsed JSON a usable seed? Every workspace/group/item must be well-formed, ids unique,
 * every item must pass `validateItem` (with the groups), and settings need a timezone.
 * @param {any} data
 * @returns {boolean}
 */
export function isValidSeed(data) {
  if (data === null || typeof data !== 'object') return false;
  const { workspaces, groups, items, settings } = data;
  if (!Array.isArray(workspaces) || !Array.isArray(groups) || !Array.isArray(items)) return false;
  if (workspaces.length === 0) return false;
  if (settings === null || typeof settings !== 'object' || typeof settings.timezone !== 'string' || settings.timezone === '') return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone });
  } catch {
    return false;
  }
  const ids = new Set();
  for (const e of [...workspaces, ...groups, ...items]) {
    if (e === null || typeof e !== 'object' || typeof e.id !== 'string' || e.id === '' || ids.has(e.id)) return false;
    ids.add(e.id);
  }
  const wsIds = new Set(workspaces.map((w) => w.id));
  for (const w of workspaces) {
    if (typeof w.name !== 'string' || w.name.trim() === '') return false;
    if (!Number.isInteger(w.sleepAfterMin) || w.sleepAfterMin < 0) return false;
  }
  for (const g of groups) {
    if (typeof g.name !== 'string' || g.name.trim() === '' || !wsIds.has(g.workspaceId)) return false;
  }
  for (const it of items) {
    if (!wsIds.has(it.workspaceId)) return false;
    if (validateItem(it, { groups }).length > 0) return false;
  }
  return true;
}

/**
 * @param {string | null} localJsonText contents of seed.local.json, or null when the file is absent
 * @param {SeedData} example the example SEED
 * @returns {{seed: SeedData, source: 'local' | 'example'}} a deep copy, safe to mutate
 */
export function selectSeed(localJsonText, example) {
  if (typeof localJsonText === 'string') {
    try {
      const parsed = JSON.parse(localJsonText);
      if (isValidSeed(parsed)) {
        return {
          seed: {
            workspaces: parsed.workspaces,
            groups: parsed.groups,
            items: parsed.items,
            settings: parsed.settings,
          },
          source: 'local',
        };
      }
    } catch {
      // fall through to the example
    }
  }
  return { seed: structuredClone(/** @type {SeedData} */ (example)), source: 'example' };
}
