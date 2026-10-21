// @ts-check
// Last-write-wins merging of entity snapshots. Pure; never mutates its input.

/** The fixed id under which the (id-less) Settings entity is keyed. */
export const SETTINGS_ID = 'settings';

/**
 * @param {unknown} v
 * @returns {string} JSON with object keys sorted recursively
 */
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = /** @type {Record<string, unknown>} */ (v);
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * @param {{id?: string}} e
 * @returns {string}
 */
function keyOf(e) {
  return typeof e.id === 'string' ? e.id : SETTINGS_ID;
}

/**
 * @param {{updatedAt?: number}} e
 * @returns {number}
 */
function stamp(e) {
  return Number.isFinite(e.updatedAt) ? /** @type {number} */ (e.updatedAt) : 0;
}

/**
 * Merge two snapshots of entities (workspaces, groups, items or settings). Per id the version with
 * the greater `updatedAt` wins; ties go to the greater canonical JSON (keys sorted), so the result
 * is total, deterministic, commutative, associative and idempotent. Tombstones (`deleted: true`)
 * are ordinary versions: they win only when newer. Entities without an `id` (Settings) are keyed
 * as `'settings'`. The result is sorted by id and may share object references with the inputs.
 * @template {{id?: string, updatedAt: number}} T
 * @param {T[]} a
 * @param {T[]} b
 * @returns {T[]}
 */
export function mergeLww(a, b) {
  /** @type {Map<string, {e: T, json: string | null}>} */
  const best = new Map();
  for (const e of [...a, ...b]) {
    const key = keyOf(e);
    const cur = best.get(key);
    if (!cur) {
      best.set(key, { e, json: null });
      continue;
    }
    const diff = stamp(e) - stamp(cur.e);
    if (diff > 0) {
      best.set(key, { e, json: null });
    } else if (diff === 0) {
      cur.json ??= canonicalJson(cur.e);
      const json = canonicalJson(e);
      if (json > cur.json) best.set(key, { e, json });
    }
  }
  return [...best.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, v]) => v.e);
}
