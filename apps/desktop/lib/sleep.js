// @ts-check
// Which hidden views are due to be unloaded (D30). Pure.

import { effectiveSleep } from '../../../packages/core/index.js';

/** @typedef {import('../../../packages/core/model.js').Item} Item */
/** @typedef {import('../../../packages/core/model.js').Workspace} Workspace */
/** @typedef {{itemId: string, awake: boolean, hiddenSince: number | null}} SleepView */

/**
 * Item ids to unload now: the view is awake, hidden (`hiddenSince` set), the effective sleep time
 * of the item's OWN workspace is positive (0 = never), and it has been hidden at least that long.
 * A visible view (`hiddenSince === null`) never sleeps, even when it is shown in another
 * workspace's split. An item or workspace that no longer exists is skipped (the caller destroys it).
 * @param {Iterable<SleepView>} views
 * @param {Item[]} items
 * @param {Workspace[]} workspaces
 * @param {number} now epoch ms
 * @returns {string[]}
 */
export function dueToSleep(views, items, workspaces, now) {
  /** @type {string[]} */
  const out = [];
  for (const v of views) {
    if (!v.awake || v.hiddenSince === null) continue;
    const item = items.find((i) => i.id === v.itemId && !i.deleted);
    if (!item) continue;
    const ws = workspaces.find((w) => w.id === item.workspaceId && !w.deleted);
    if (!ws) continue;
    const minutes = effectiveSleep(item, ws);
    if (!(minutes > 0)) continue;
    if (now - v.hiddenSince >= minutes * 60_000) out.push(v.itemId);
  }
  return out;
}
