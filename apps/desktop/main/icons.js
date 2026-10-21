// @ts-check
// The per-PC icon cache (D116): `<data>\icons\<file>.png`, one 32 px PNG per item, never synced.
// Capturing is driven only by a site loading in its pane (`capture`) or by the owner pressing
// "Refresh icon" (`refresh`); nothing here runs in the background. Disk, network and image decoding are
// injected, so the rules are unit tested without Electron.

import path from 'node:path';
import { acceptIconUrl, decodeDataUrl, faviconIcoOf, iconFileName, parseIconLinks, MAX_CANDIDATES, MAX_PAGE_BYTES } from '../lib/favicon.js';
import { isHttpUrl } from '../lib/resolve-open.js';

/**
 * @param {object} deps
 * @param {string} deps.dir                                           the icons folder
 * @param {Pick<typeof import('node:fs'), 'existsSync' | 'mkdirSync' | 'readFileSync' | 'writeFileSync' | 'renameSync' | 'unlinkSync'>} deps.fs
 * @param {(ses: any, url: string, options?: object) => Promise<{bytes: Uint8Array, url: string} | null>} deps.fetch  bounded download (icon-fetch.js)
 * @param {(bytes: Uint8Array) => Promise<Uint8Array | null>} deps.convert  any supported image -> 32 px PNG, or null
 * @param {() => void} deps.onChange                                  a revision changed: tell the UI
 */
export function createIcons({ dir, fs, fetch, convert, onChange }) {
  /** @type {Map<string, number>} item id -> revision (0 = no icon) */
  const revs = new Map();
  /** @type {Map<string, string>} item id -> data URL of the current revision */
  const urls = new Map();
  /** @type {Map<string, string>} item id -> the candidate list last tried for it (this session) */
  const tried = new Map();
  /** @type {Set<string>} captures in flight */
  const running = new Set();

  /** @param {string} itemId */
  const fileOf = (itemId) => path.join(dir, iconFileName(itemId));

  /** @param {string} itemId @returns {number} */
  function rev(itemId) {
    let r = revs.get(itemId);
    if (r === undefined) {
      r = fs.existsSync(fileOf(itemId)) ? 1 : 0;
      revs.set(itemId, r);
    }
    return r;
  }

  /**
   * Try the candidates in order; the first one that downloads and decodes is saved.
   * @param {string} itemId
   * @param {string[]} candidates
   * @param {any} ses
   * @param {{force?: boolean, maxTries?: number}} [opts]
   * @returns {Promise<boolean>} whether an icon was saved
   */
  async function capture(itemId, candidates, ses, { force = false, maxTries = MAX_CANDIDATES } = {}) {
    const list = [...new Set(candidates.filter(acceptIconUrl))].slice(0, maxTries);
    if (list.length === 0) return false;
    const key = list.join('\n');
    if (!force && tried.get(itemId) === key) return false; // the same icons as the last navigation: nothing new to download
    if (running.has(itemId)) return false;
    tried.set(itemId, key);
    running.add(itemId);
    try {
      for (const url of list) {
        const bytes = url.startsWith('data:') ? decodeDataUrl(url) : (await fetch(ses, url))?.bytes ?? null;
        if (!bytes) continue;
        let png = null;
        try {
          png = await convert(bytes);
        } catch {
          png = null;
        }
        if (!png || png.length === 0) continue;
        fs.mkdirSync(dir, { recursive: true });
        const file = fileOf(itemId);
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, png);
        fs.renameSync(tmp, file);
        revs.set(itemId, (revs.get(itemId) ?? 0) + 1);
        urls.delete(itemId);
        onChange();
        return true;
      }
      return false;
    } catch {
      return false; // a full disk or a vanished folder leaves the letter in place
    } finally {
      running.delete(itemId);
    }
  }

  return {
    capture,
    rev,
    /** Revisions of the given items (0 = none); the UI fetches the image when a number changes. @param {string[]} ids */
    revisions(ids) {
      /** @type {Record<string, number>} */
      const out = {};
      for (const id of ids) {
        const r = rev(id);
        if (r > 0) out[id] = r;
      }
      return out;
    },
    /** The icon as a data URL, or null. @param {string} itemId @returns {string | null} */
    dataUrl(itemId) {
      if (rev(itemId) === 0) return null;
      const cached = urls.get(itemId);
      if (cached) return cached;
      try {
        const url = `data:image/png;base64,${Buffer.from(fs.readFileSync(fileOf(itemId))).toString('base64')}`;
        urls.set(itemId, url);
        return url;
      } catch {
        revs.set(itemId, 0);
        return null;
      }
    },
    /**
     * "Refresh icon": a one-off fetch started by the owner. The candidates are the page's current icon list
     * when the item's own site is loaded, otherwise the item's origin: the `<link rel=icon>` tags of its
     * front page, then `/favicon.ico`.
     * @param {string} itemId
     * @param {{pageIcons: string[], homeUrl: string | null, ses: any}} ctx
     * @returns {Promise<boolean>} whether an icon was saved
     */
    async refresh(itemId, { pageIcons, homeUrl, ses }) {
      /** @type {string[]} */
      let candidates = pageIcons.filter(acceptIconUrl);
      if (candidates.length === 0 && isHttpUrl(homeUrl)) {
        const origin = new URL(/** @type {string} */ (homeUrl)).origin;
        const page = await fetch(ses, `${origin}/`, { maxBytes: MAX_PAGE_BYTES, truncate: true });
        if (page) candidates = parseIconLinks(Buffer.from(page.bytes).toString('utf8'), page.url);
        const ico = faviconIcoOf(homeUrl);
        if (ico && !candidates.includes(ico)) candidates.push(ico);
      }
      return capture(itemId, candidates, ses, { force: true, maxTries: 6 });
    },
    /** Forget an item's icon (the item was deleted). @param {string} itemId */
    remove(itemId) {
      revs.set(itemId, 0);
      urls.delete(itemId);
      tried.delete(itemId);
      try {
        fs.unlinkSync(fileOf(itemId));
      } catch {
        // already gone
      }
    },
  };
}
