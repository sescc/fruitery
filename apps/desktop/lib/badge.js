// @ts-check
// deriveBadge (D19, D42): a count at the start of a page title, like "(3) Inbox". Best effort.

/**
 * @param {unknown} title
 * @returns {number | null} the count, or null when the title has none
 */
export function deriveBadge(title) {
  if (typeof title !== 'string') return null;
  const m = /^\s*\((\d{1,9})\)/.exec(title);
  return m ? Number(m[1]) : null;
}
