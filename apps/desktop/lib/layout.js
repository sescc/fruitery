// @ts-check
// Split-pane layout tree (D31). Pure: every function returns a new tree and never mutates.
// Leaf  {type:'leaf', paneId, itemId|null}
// Split {type:'split', dir:'row'|'col', ratio, a, b}   row = side by side (a left), col = stacked (a top)

/** @typedef {{type: 'leaf', paneId: string, itemId: string | null}} Leaf */
/** @typedef {{type: 'split', dir: 'row' | 'col', ratio: number, a: Layout, b: Layout}} Split */
/** @typedef {Leaf | Split} Layout */
/** @typedef {{x: number, y: number, w: number, h: number}} Box */
/** @typedef {Box & {paneId: string, itemId: string | null}} PaneRect */
/** @typedef {Box & {path: ('a' | 'b')[], dir: 'row' | 'col', parent: Box}} Divider */

export const MAX_PANES = 4;
export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;
export const DIVIDER_PX = 4;

/**
 * @param {string} paneId
 * @param {string | null} [itemId]
 * @returns {Leaf}
 */
export function leaf(paneId, itemId = null) {
  return { type: 'leaf', paneId, itemId };
}

/**
 * @param {Layout} tree
 * @returns {Leaf[]} the leaves, left/top first
 */
export function leaves(tree) {
  if (tree.type === 'leaf') return [tree];
  return [...leaves(tree.a), ...leaves(tree.b)];
}

/**
 * @param {Layout} tree
 * @param {string} paneId
 * @returns {Leaf | null}
 */
export function findPane(tree, paneId) {
  return leaves(tree).find((l) => l.paneId === paneId) ?? null;
}

/**
 * @param {Layout} tree
 * @param {string} itemId
 * @returns {Leaf | null}
 */
export function findItem(tree, itemId) {
  return leaves(tree).find((l) => l.itemId === itemId) ?? null;
}

/**
 * A pane id not used in the tree: p1, p2, ...
 * @param {Layout} tree
 * @returns {string}
 */
export function nextPaneId(tree) {
  const used = new Set(leaves(tree).map((l) => l.paneId));
  let n = 1;
  while (used.has(`p${n}`)) n++;
  return `p${n}`;
}

/**
 * @param {number} r
 * @returns {number}
 */
export function clampRatio(r) {
  if (typeof r !== 'number' || !Number.isFinite(r)) return 0.5;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
}

/**
 * Check the shape of a tree (also used on trees read from disk or the UI).
 * Rules: known node types, ratio 0.1..0.9, unique non-empty pane ids, string-or-null item ids, at
 * most 4 leaves, and an item in at most one leaf.
 * @param {unknown} tree
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validate(tree) {
  /** @type {Leaf[]} */
  const found = [];
  /** @param {unknown} n @param {number} depth @returns {string | null} */
  const walk = (n, depth) => {
    if (depth > 8 || n === null || typeof n !== 'object') return 'bad-node';
    const node = /** @type {Record<string, unknown>} */ (n);
    if (node.type === 'leaf') {
      if (typeof node.paneId !== 'string' || node.paneId === '') return 'bad-pane-id';
      if (node.itemId !== null && typeof node.itemId !== 'string') return 'bad-item-id';
      found.push(/** @type {Leaf} */ (node));
      return null;
    }
    if (node.type === 'split') {
      if (node.dir !== 'row' && node.dir !== 'col') return 'bad-dir';
      if (typeof node.ratio !== 'number' || !(node.ratio >= MIN_RATIO && node.ratio <= MAX_RATIO)) return 'bad-ratio';
      return walk(node.a, depth + 1) ?? walk(node.b, depth + 1);
    }
    return 'bad-node';
  };
  const err = walk(tree, 0);
  if (err) return { ok: false, error: err };
  if (found.length > MAX_PANES) return { ok: false, error: 'max-panes' };
  const ids = new Set();
  const items = new Set();
  for (const l of found) {
    if (ids.has(l.paneId)) return { ok: false, error: 'duplicate-pane-id' };
    ids.add(l.paneId);
    if (l.itemId !== null) {
      if (items.has(l.itemId)) return { ok: false, error: 'duplicate-item' };
      items.add(l.itemId);
    }
  }
  return { ok: true };
}

/**
 * @param {Layout} tree
 * @param {string} paneId
 * @param {(l: Leaf) => Layout} fn
 * @returns {Layout}
 */
function mapLeaf(tree, paneId, fn) {
  if (tree.type === 'leaf') return tree.paneId === paneId ? fn(tree) : tree;
  const a = mapLeaf(tree.a, paneId, fn);
  const b = mapLeaf(tree.b, paneId, fn);
  return a === tree.a && b === tree.b ? tree : { ...tree, a, b };
}

/**
 * Split a pane. The new pane shows `itemId` (or is empty). `side` says where the new pane goes:
 * 'after' = right/below (default), 'before' = left/above.
 * - An item already shown in another pane -> `{focus}` (no second copy, nothing changes).
 * - A 5th leaf -> `{error: 'max-panes'}`.
 * @param {Layout} tree
 * @param {string} paneId the pane to split
 * @param {'row' | 'col'} dir
 * @param {string} newPaneId
 * @param {string | null} itemId
 * @param {'before' | 'after'} [side]
 * @returns {{tree: Layout, paneId: string} | {focus: string} | {error: 'max-panes' | 'unknown-pane' | 'duplicate-pane-id'}}
 */
export function split(tree, paneId, dir, newPaneId, itemId, side = 'after') {
  const target = findPane(tree, paneId);
  if (!target) return { error: 'unknown-pane' };
  if (findPane(tree, newPaneId)) return { error: 'duplicate-pane-id' };
  if (itemId !== null) {
    const existing = findItem(tree, itemId);
    if (existing) return { focus: existing.paneId };
  }
  if (leaves(tree).length >= MAX_PANES) return { error: 'max-panes' };
  const fresh = leaf(newPaneId, itemId);
  const next = mapLeaf(tree, paneId, (l) => ({
    type: 'split',
    dir,
    ratio: 0.5,
    a: side === 'after' ? l : fresh,
    b: side === 'after' ? fresh : l,
  }));
  return { tree: next, paneId: newPaneId };
}

/**
 * Close a pane: its sibling takes the parent's place. The last leaf cannot be closed.
 * @param {Layout} tree
 * @param {string} paneId
 * @returns {{tree: Layout} | {error: 'last-pane' | 'unknown-pane'}}
 */
export function close(tree, paneId) {
  if (!findPane(tree, paneId)) return { error: 'unknown-pane' };
  if (tree.type === 'leaf') return { error: 'last-pane' };
  /** @param {Layout} n @returns {Layout} */
  const drop = (n) => {
    if (n.type === 'leaf') return n;
    if (n.a.type === 'leaf' && n.a.paneId === paneId) return n.b;
    if (n.b.type === 'leaf' && n.b.paneId === paneId) return n.a;
    return { ...n, a: drop(n.a), b: drop(n.b) };
  };
  return { tree: drop(tree) };
}

/**
 * Show an item in a pane. An item already shown in a different pane -> `{focus}` instead.
 * @param {Layout} tree
 * @param {string} paneId
 * @param {string | null} itemId
 * @returns {{tree: Layout} | {focus: string} | {error: 'unknown-pane'}}
 */
export function setItem(tree, paneId, itemId) {
  const target = findPane(tree, paneId);
  if (!target) return { error: 'unknown-pane' };
  if (itemId !== null) {
    const existing = findItem(tree, itemId);
    if (existing && existing.paneId !== paneId) return { focus: existing.paneId };
  }
  return { tree: mapLeaf(tree, paneId, (l) => ({ ...l, itemId })) };
}

/**
 * Set the ratio of the split at `path` (a/b steps from the root), clamped to 0.1..0.9.
 * @param {Layout} tree
 * @param {('a' | 'b')[]} path
 * @param {number} ratio
 * @returns {{tree: Layout} | {error: 'bad-path'}}
 */
export function resize(tree, path, ratio) {
  /** @param {Layout} n @param {number} i @returns {Layout | null} */
  const go = (n, i) => {
    if (n.type !== 'split') return null;
    if (i === path.length) return { ...n, ratio: clampRatio(ratio) };
    const key = path[i];
    if (key !== 'a' && key !== 'b') return null;
    const child = go(n[key], i + 1);
    return child ? { ...n, [key]: child } : null;
  };
  const next = go(tree, 0);
  return next ? { tree: next } : { error: 'bad-path' };
}

/**
 * Remove an item from every pane (it was deleted or can no longer be shown).
 * @param {Layout} tree
 * @param {(itemId: string) => boolean} keep
 * @returns {Layout}
 */
export function pruneItems(tree, keep) {
  if (tree.type === 'leaf') return tree.itemId !== null && !keep(tree.itemId) ? { ...tree, itemId: null } : tree;
  const a = pruneItems(tree.a, keep);
  const b = pruneItems(tree.b, keep);
  return a === tree.a && b === tree.b ? tree : { ...tree, a, b };
}

/**
 * Place the tree in a box. Dividers take `divider` px; panes share the rest, rounded so that the
 * pane sizes plus the divider always add up to the box exactly.
 * @param {Layout} tree
 * @param {Box} box
 * @param {number} [divider]
 * @returns {{panes: PaneRect[], dividers: Divider[]}}
 */
export function rects(tree, box, divider = DIVIDER_PX) {
  /** @type {PaneRect[]} */
  const panes = [];
  /** @type {Divider[]} */
  const dividers = [];
  /** @param {Layout} n @param {Box} b @param {('a' | 'b')[]} path */
  const walk = (n, b, path) => {
    if (n.type === 'leaf') {
      panes.push({ ...b, paneId: n.paneId, itemId: n.itemId });
      return;
    }
    if (n.dir === 'row') {
      const avail = Math.max(0, b.w - divider);
      const aw = Math.round(avail * n.ratio);
      const bw = avail - aw;
      walk(n.a, { x: b.x, y: b.y, w: aw, h: b.h }, [...path, 'a']);
      dividers.push({ x: b.x + aw, y: b.y, w: divider, h: b.h, path, dir: 'row', parent: b });
      walk(n.b, { x: b.x + aw + divider, y: b.y, w: bw, h: b.h }, [...path, 'b']);
    } else {
      const avail = Math.max(0, b.h - divider);
      const ah = Math.round(avail * n.ratio);
      const bh = avail - ah;
      walk(n.a, { x: b.x, y: b.y, w: b.w, h: ah }, [...path, 'a']);
      dividers.push({ x: b.x, y: b.y + ah, w: b.w, h: divider, path, dir: 'col', parent: b });
      walk(n.b, { x: b.x, y: b.y + ah + divider, w: b.w, h: bh }, [...path, 'b']);
    }
  };
  walk(tree, box, []);
  return { panes, dividers };
}
