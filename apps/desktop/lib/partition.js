// @ts-check
// Session partitions (D15, D52) and the cookie opt-out set (D37). Pure.

import { hostOfUrl } from './cookie-transform.js';

export const SHARED_PARTITION = 'persist:fruitery';

/**
 * @param {{id: string, isolate?: boolean}} item
 * @returns {string} `persist:fruitery-<id>` for an isolated item, else the shared partition
 */
export function partitionFor(item) {
  return item.isolate ? `persist:fruitery-${item.id}` : SHARED_PARTITION;
}

/**
 * Which cookies of a partition must NOT be made persistent.
 * - shared partition: cookies whose domain matches the host of a live, non-isolated item with
 *   `persistSessionCookies === false` (suffix rules, see `isOptedOut`);
 * - isolated partition: everything when that item's flag is off.
 * @param {string} partition
 * @param {{id: string, isolate?: boolean, persistSessionCookies?: boolean, url?: string | null, fallbackUrl?: string | null, deleted?: boolean}[]} items
 * @returns {{all: boolean, hosts: string[]}}
 */
export function optOutFor(partition, items) {
  if (partition !== SHARED_PARTITION) {
    const owner = items.find((i) => !i.deleted && partitionFor(i) === partition);
    return { all: owner !== undefined && owner.persistSessionCookies === false, hosts: [] };
  }
  /** @type {string[]} */
  const hosts = [];
  for (const i of items) {
    if (i.deleted || i.isolate || i.persistSessionCookies !== false) continue;
    for (const u of [i.url, i.fallbackUrl]) {
      const h = hostOfUrl(u);
      if (h && !hosts.includes(h)) hosts.push(h);
    }
  }
  return { all: false, hosts };
}
