// @ts-check
// Width of the item list panel (the draggable border between the list and the pane area). Pure.

export const DEFAULT_LIST_WIDTH = 270;
export const MIN_LIST_WIDTH = 180;
export const MAX_LIST_WIDTH = 600;
/** The pane area never gets narrower than this because of the list. */
export const MIN_PANES_WIDTH = 320;

/**
 * Clamp a wanted list width. The upper bound is 600 px, lowered so that the pane area keeps at
 * least 320 px in a window of `windowWidth` (rail included); it never goes below the 180 px minimum.
 * @param {unknown} wanted
 * @param {number} windowWidth
 * @param {number} railWidth
 * @returns {number} whole pixels
 */
export function clampListWidth(wanted, windowWidth, railWidth) {
  const w = typeof wanted === 'number' && Number.isFinite(wanted) ? wanted : DEFAULT_LIST_WIDTH;
  const room = Number.isFinite(windowWidth) && Number.isFinite(railWidth) ? windowWidth - railWidth - MIN_PANES_WIDTH : MAX_LIST_WIDTH;
  const max = Math.max(MIN_LIST_WIDTH, Math.min(MAX_LIST_WIDTH, Math.floor(room)));
  return Math.round(Math.min(max, Math.max(MIN_LIST_WIDTH, w)));
}

/**
 * Clean a stored value (the window size is unknown at load time): a finite number is rounded and
 * kept within 180..600, anything else gives `fallback`.
 * @param {unknown} v
 * @param {number} [fallback]
 * @returns {number}
 */
export function sanitizeListWidth(v, fallback = DEFAULT_LIST_WIDTH) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.round(Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, v)));
}
