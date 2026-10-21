// @ts-check
// Pure rules for the desktop icons (D116): which icon addresses are acceptable, what bytes an image
// is, which ICO entry to use, which `<link>` tags name icons, whether a page belongs to the item's own
// site, and the cache file name. No Electron, no network, no disk (main/icons.js does those).

import { createHash } from 'node:crypto';
import { isHttpUrl } from './resolve-open.js';

/** An icon larger than this (bytes) is refused. */
export const MAX_ICON_BYTES = 256 * 1024;
/** A download or page fetch that takes longer than this (ms) is abandoned. */
export const ICON_TIMEOUT_MS = 5000;
/** A page read for `<link rel=icon>` stops at this many bytes. */
export const MAX_PAGE_BYTES = 512 * 1024;
/** The cached icon is this many pixels square. */
export const ICON_PX = 32;
/** At most this many candidates are tried per capture. */
export const MAX_CANDIDATES = 3;

const DATA_MIME = /^data:(image\/(?:png|jpeg|jpg|x-icon|vnd\.microsoft\.icon|gif|webp));base64,([A-Za-z0-9+/=\s]*)$/i;

/**
 * Only http(s) icon addresses and base64 image data URLs are ever used.
 * @param {unknown} url
 * @returns {boolean}
 */
export function acceptIconUrl(url) {
  if (typeof url !== 'string') return false;
  if (isHttpUrl(url)) return true;
  return url.length <= Math.ceil((MAX_ICON_BYTES * 4) / 3) + 80 && DATA_MIME.test(url);
}

/**
 * The bytes of an accepted base64 image data URL.
 * @param {string} url
 * @returns {Uint8Array | null}
 */
export function decodeDataUrl(url) {
  const m = DATA_MIME.exec(url);
  if (!m) return null;
  try {
    const bytes = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
    return bytes.length > 0 && bytes.length <= MAX_ICON_BYTES ? new Uint8Array(bytes) : null;
  } catch {
    return null;
  }
}

/**
 * What an image file is, from its first bytes.
 * @param {Uint8Array} bytes
 * @returns {'png' | 'jpeg' | 'ico' | 'gif' | 'webp' | 'svg' | 'unknown'}
 */
export function sniffImage(bytes) {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 6 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && (b[4] | (b[5] << 8)) > 0) return 'ico';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  const head = Buffer.from(b.subarray(0, 256)).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return 'unknown';
}

/**
 * The ICO directory entry to use: the smallest one at least `wanted` pixels wide, else the largest.
 * @param {Uint8Array} bytes
 * @param {number} [wanted]
 * @returns {{offset: number, size: number, width: number, isPng: boolean} | null}
 */
export function pickIcoEntry(bytes, wanted = ICON_PX) {
  if (sniffImage(bytes) !== 'ico') return null;
  const count = bytes[4] | (bytes[5] << 8);
  /** @type {{offset: number, size: number, width: number, isPng: boolean}[]} */
  const entries = [];
  for (let i = 0; i < count && i < 64; i++) {
    const at = 6 + i * 16;
    if (at + 16 > bytes.length) break;
    const width = bytes[at] === 0 ? 256 : bytes[at];
    const size = (bytes[at + 8] | (bytes[at + 9] << 8) | (bytes[at + 10] << 16) | (bytes[at + 11] << 24)) >>> 0;
    const offset = (bytes[at + 12] | (bytes[at + 13] << 8) | (bytes[at + 14] << 16) | (bytes[at + 15] << 24)) >>> 0;
    if (size === 0 || offset + size > bytes.length) continue;
    const isPng = bytes[offset] === 0x89 && bytes[offset + 1] === 0x50 && bytes[offset + 2] === 0x4e && bytes[offset + 3] === 0x47;
    entries.push({ offset, size, width, isPng });
  }
  if (entries.length === 0) return null;
  const big = entries.filter((e) => e.width >= wanted).sort((a, b) => a.width - b.width);
  if (big.length > 0) return big[0];
  return entries.sort((a, b) => b.width - a.width)[0];
}

/**
 * Icon addresses named by the `<link>` tags of an HTML page, in document order, resolved against
 * the page address, deduplicated, accepted addresses only. SVG icons are skipped (they cannot be
 * decoded here), as are mask icons.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string[]}
 */
export function parseIconLinks(html, baseUrl) {
  /** @type {string[]} */
  const out = [];
  if (typeof html !== 'string' || !isHttpUrl(baseUrl)) return out;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (/** @type {string} */ name) => {
      const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
      return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
    };
    const rel = attr('rel').toLowerCase().split(/\s+/).filter(Boolean);
    if (!rel.includes('icon') && !rel.includes('apple-touch-icon')) continue;
    const type = attr('type').toLowerCase();
    const href = attr('href').trim().replace(/&amp;/g, '&');
    if (href === '' || type.includes('svg') || /\.svg(?:[?#]|$)/i.test(href)) continue;
    let resolved;
    try {
      resolved = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    if (acceptIconUrl(resolved) && !out.includes(resolved)) out.push(resolved);
    if (out.length >= 8) break;
  }
  return out;
}

/** @param {string} host @returns {string} */
const bareHost = (host) => host.toLowerCase().replace(/^www\./, '');

/**
 * Whether a page belongs to the item's own site: the same host (ignoring `www.`), or one is a
 * sub-domain of the other. A sign-in provider's page, an SSO redirect or a different site typed
 * into the address field does not, so it can never replace the item's icon.
 * @param {unknown} pageUrl
 * @param {unknown} homeUrl the item's saved address (placeholders already filled)
 * @returns {boolean}
 */
export function isOwnSite(pageUrl, homeUrl) {
  if (!isHttpUrl(pageUrl) || !isHttpUrl(homeUrl)) return false;
  const a = bareHost(new URL(/** @type {string} */ (pageUrl)).hostname);
  const b = bareHost(new URL(/** @type {string} */ (homeUrl)).hostname);
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.includes('.') && long.endsWith(`.${short}`);
}

/**
 * The file name of an item's icon in the icons folder. Ids made of letters, digits, `_` and `-` are used
 * as they are; any other id (which could carry a path) is replaced by a hash, so an id that arrives
 * through sync can never choose where a file is written.
 * @param {string} itemId
 * @returns {string}
 */
export function iconFileName(itemId) {
  if (/^[A-Za-z0-9_-]{1,64}$/.test(itemId)) return `${itemId}.png`;
  return `h-${createHash('sha1').update(String(itemId)).digest('hex').slice(0, 24)}.png`;
}

/**
 * The origin's own icon address, the last candidate when a page names none.
 * @param {string} pageUrl
 * @returns {string | null}
 */
export function faviconIcoOf(pageUrl) {
  if (!isHttpUrl(pageUrl)) return null;
  return `${new URL(pageUrl).origin}/favicon.ico`;
}
