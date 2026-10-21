// @ts-check
// "Done with <name>?" (D117): remembers the item last opened outside a pane (Edge or a program) and
// says which item to ask about when the window comes back to the front. Pure state, injectable clock.

/** An entry older than this is forgotten. */
export const RETURN_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * @param {{now?: () => number, maxAgeMs?: number}} [deps]
 */
export function createReturnTracker({ now = Date.now, maxAgeMs = RETURN_MAX_AGE_MS } = {}) {
  /** @type {{itemId: string, at: number, blurred: boolean} | null} */
  let pending = null;
  return {
    /** An item was just opened outside a pane. @param {string} itemId */
    opened(itemId) {
      pending = { itemId, at: now(), blurred: false };
    },
    /** The window lost focus. */
    blur() {
      if (pending) pending.blurred = true;
    },
    /**
     * The window got focus. The item to ask about, once: only when the window really lost focus after
     * the open, and the open is not too old.
     * @returns {string | null}
     */
    focus() {
      const p = pending;
      if (!p) return null;
      if (now() - p.at > maxAgeMs) {
        pending = null;
        return null;
      }
      if (!p.blurred) return null;
      pending = null;
      return p.itemId;
    },
    clear() {
      pending = null;
    },
    pending: () => (pending ? { ...pending } : null),
  };
}
