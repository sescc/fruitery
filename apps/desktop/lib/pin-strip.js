// @ts-check
// Pure geometry for the pinned-item strip at the bottom of the item-list column (a time-tracking site, or any item
// the owner pins). The strip has a fixed header (always shown when an item is pinned) and, unless
// collapsed, a body of about `STRIP_BODY_PX` that hosts the pinned item's native view. The list
// content above it keeps at least `MIN_LIST_PX`; when the column is too short the body shrinks and,
// if there is no room at all, the body is dropped (header only). No DOM, no Electron.

/** Default body height of the strip (px). */
export const STRIP_BODY_PX = 200;
/** The strip header row height (px). */
export const STRIP_HEADER_PX = 30;
/** The list content above the strip never shrinks below this (px). */
export const MIN_LIST_PX = 160;
/** The body is dropped below this height (not worth showing a sliver). */
export const MIN_STRIP_BODY_PX = 80;

/**
 * Split a list column of height `columnPx` between the item list and the pinned strip.
 * @param {number} columnPx total height available in the list column (px)
 * @param {{ pinned: boolean, collapsed: boolean, bodyPx?: number }} opts
 * @returns {{ listHeight: number, headerHeight: number, bodyHeight: number }}
 *   `bodyHeight` 0 means no body is shown (collapsed, or no room). When `pinned` is false the whole
 *   column is the list (no header, no body).
 */
export function pinStripLayout(columnPx, opts) {
  const col = Number.isFinite(columnPx) && columnPx > 0 ? columnPx : 0;
  if (!opts.pinned) return { listHeight: col, headerHeight: 0, bodyHeight: 0 };
  const header = Math.min(STRIP_HEADER_PX, col);
  if (opts.collapsed) return { listHeight: Math.max(0, col - header), headerHeight: header, bodyHeight: 0 };
  const wanted = Math.max(0, Math.round(opts.bodyPx ?? STRIP_BODY_PX));
  // the body may take at most what is left after the header and the minimum list content
  const room = col - header - MIN_LIST_PX;
  const body = Math.min(wanted, Math.max(0, room));
  if (body < MIN_STRIP_BODY_PX) return { listHeight: Math.max(0, col - header), headerHeight: header, bodyHeight: 0 };
  return { listHeight: col - header - body, headerHeight: header, bodyHeight: body };
}
