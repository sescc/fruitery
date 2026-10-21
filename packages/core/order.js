// @ts-check
// Dense ordering of siblings. Pure; never mutates its input.

/**
 * Move one sibling to `toIndex` and renumber everyone 0..n-1.
 * - Siblings are sorted by `order` (ties by `id`) first.
 * - `toIndex` is clamped to 0..n-1 (n = number of siblings); non-integers are truncated, NaN -> 0.
 * - Entities whose `order` changed get `updatedAt = nowMs`; the rest are returned with the same values.
 * - An unknown id returns shallow copies in input order, unchanged.
 * @template {{id: string, order: number, updatedAt: number}} T
 * @param {T[]} siblings
 * @param {string} id the entity to move
 * @param {number} toIndex
 * @param {number} nowMs epoch ms
 * @returns {T[]} new objects, sorted by the new `order`
 */
export function reorder(siblings, id, toIndex, nowMs) {
  const moving = siblings.find((e) => e.id === id);
  if (!moving) return siblings.map((e) => ({ ...e }));
  const rest = siblings
    .filter((e) => e !== moving)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const at = Math.min(Math.max(Math.trunc(toIndex) || 0, 0), rest.length);
  rest.splice(at, 0, moving);
  return rest.map((e, i) => (e.order === i ? { ...e } : { ...e, order: i, updatedAt: nowMs }));
}
