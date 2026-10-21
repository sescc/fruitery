// @ts-check
// Deletion rules shared by every client: what changes when an item, group or workspace is deleted.
// Pure: it returns the changed entities as new objects and never mutates its input.

/** @typedef {import('./model.js').Workspace} Workspace */
/** @typedef {import('./model.js').Group} Group */
/** @typedef {import('./model.js').Item} Item */
/** @typedef {{workspaces: Workspace[], groups: Group[], items: Item[]}} RemovalSnapshot */
/** @typedef {{workspaces: Workspace[], groups: Group[], items: Item[]}} RemovalChanges */

/**
 * Plan the deletion of one entity. Deletions are recorded as tombstones (`deleted: true`) so other
 * devices learn of them; every changed entity gets `updatedAt = nowMs`.
 * - item: only that item is marked deleted.
 * - group: the group is marked deleted; each of its live items stays but becomes ungrouped.
 * - workspace: the workspace, its live groups and its live items are marked deleted. Refused with
 *   `last-workspace` when it is the only live workspace.
 * Already-deleted entities are ignored when counting and are not changed again. An unknown or
 * already-deleted id (or an unknown kind) is `not-found`.
 * @param {RemovalSnapshot} snapshot
 * @param {'item' | 'group' | 'workspace'} kind
 * @param {string} id
 * @param {number} nowMs epoch ms
 * @returns {{changed: RemovalChanges} | {error: 'last-workspace' | 'not-found'}}
 */
export function removalPlan(snapshot, kind, id, nowMs) {
  /** @type {RemovalChanges} */
  const changed = { workspaces: [], groups: [], items: [] };
  /**
   * @template {{updatedAt: number}} T
   * @param {T} e
   * @param {Partial<T>} patch
   * @returns {T}
   */
  const stamped = (e, patch) => ({ ...structuredClone(e), ...patch, updatedAt: nowMs });

  if (kind === 'item') {
    const item = snapshot.items.find((i) => i.id === id && !i.deleted);
    if (!item) return { error: 'not-found' };
    changed.items.push(stamped(item, { deleted: true }));
  } else if (kind === 'group') {
    const group = snapshot.groups.find((g) => g.id === id && !g.deleted);
    if (!group) return { error: 'not-found' };
    changed.groups.push(stamped(group, { deleted: true }));
    for (const i of snapshot.items) if (i.groupId === id && !i.deleted) changed.items.push(stamped(i, { groupId: null }));
  } else if (kind === 'workspace') {
    const ws = snapshot.workspaces.find((w) => w.id === id && !w.deleted);
    if (!ws) return { error: 'not-found' };
    if (snapshot.workspaces.filter((w) => !w.deleted).length <= 1) return { error: 'last-workspace' };
    changed.workspaces.push(stamped(ws, { deleted: true }));
    for (const g of snapshot.groups) if (g.workspaceId === id && !g.deleted) changed.groups.push(stamped(g, { deleted: true }));
    for (const i of snapshot.items) if (i.workspaceId === id && !i.deleted) changed.items.push(stamped(i, { deleted: true }));
  } else {
    return { error: 'not-found' };
  }
  return { changed };
}
