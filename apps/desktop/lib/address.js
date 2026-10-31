// @ts-check
// The pane title bar's two pure decisions: what a typed address means, and whether a click is a
// single or a double click. No DOM, no Electron.

import { isHttpUrl } from './resolve-open.js';

const MAX_ADDRESS = 2048;

/**
 * Turn what the owner typed into an address to load. A bare host (`example.com/a`, `localhost:3000`)
 * gets `https://`; only http and https are ever accepted (no javascript:, file:, mailto:, data:, ...);
 * text with spaces or control characters is refused.
 * @param {unknown} text
 * @returns {{ok: true, url: string} | {ok: false, error: 'empty' | 'too-long' | 'invalid' | 'scheme'}}
 */
export function normalizeAddress(text) {
  if (typeof text !== 'string') return { ok: false, error: 'empty' };
  const t = text.trim();
  if (t === '') return { ok: false, error: 'empty' };
  if (t.length > MAX_ADDRESS) return { ok: false, error: 'too-long' };
  if (/[\s\u0000-\u001f\u007f]/.test(t)) return { ok: false, error: 'invalid' };
  /** @type {string} */
  let candidate;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(t);
  if (m) {
    const rest = t.slice(m[0].length);
    if (rest.startsWith('//')) {
      const scheme = m[1].toLowerCase();
      if (scheme !== 'http' && scheme !== 'https') return { ok: false, error: 'scheme' };
      candidate = t;
    } else if (/^\d{1,5}(?:[/?#]|$)/.test(rest)) {
      candidate = `https://${t}`; // `host:port`, not a scheme
    } else {
      return { ok: false, error: 'scheme' };
    }
  } else {
    candidate = `https://${t}`;
  }
  let href;
  try {
    href = new URL(candidate).href;
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (!isHttpUrl(href)) return { ok: false, error: 'invalid' };
  return { ok: true, url: href };
}

/**
 * Ctrl+Enter in the address field, as in Chrome/Edge: wrap the typed host as `www.<host>.com`,
 * keeping any path/query/hash. Trims a leading scheme and `www.` and a trailing `.com` on the host
 * token before wrapping, so the result is idempotent (`www.example.com` stays as is). Empty or
 * whitespace-only input, and input whose host part is empty, are returned unchanged.
 * @param {unknown} text
 * @returns {string} the wrapped address, or the input unchanged when there is nothing to wrap
 */
export function wrapDotCom(text) {
  if (typeof text !== 'string') return '';
  const t = text.trim();
  if (t === '') return t;
  // split off a leading http(s):// scheme (other schemes are left for normalizeAddress to reject)
  const schemeMatch = /^(https?:\/\/)/i.exec(t);
  const scheme = schemeMatch ? schemeMatch[1] : '';
  const afterScheme = t.slice(scheme.length);
  // the host token is everything up to the first / ? #; the rest is kept verbatim
  const sep = afterScheme.search(/[/?#]/);
  let host = sep === -1 ? afterScheme : afterScheme.slice(0, sep);
  const rest = sep === -1 ? '' : afterScheme.slice(sep);
  host = host.replace(/^www\./i, '').replace(/\.com$/i, '');
  if (host === '') return t; // nothing to wrap (e.g. "www.com", "http://")
  return `${scheme}www.${host}.com${rest}`;
}

/** @param {'empty' | 'too-long' | 'invalid' | 'scheme'} error */
export function addressErrorText(error) {
  if (error === 'scheme') return 'Only http:// and https:// addresses can be opened';
  if (error === 'empty') return 'Type a web address';
  if (error === 'too-long') return 'That address is too long';
  return 'That is not a valid web address';
}

/**
 * Tells a single click from a double click on the same target. A first click waits `windowMs`; a second
 * click on the same key inside the window is a double click (no single). A click on another key
 * settles the pending one as single at once. The state lives here, not in a DOM node, because the
 * pane header is rebuilt whenever the app state changes.
 * @param {object} deps
 * @param {(key: string) => void} deps.onSingle
 * @param {(key: string) => void} deps.onDouble
 * @param {number} [deps.windowMs]
 * @param {(fn: () => void, ms: number) => any} [deps.setTimer]
 * @param {(handle: any) => void} [deps.clearTimer]
 */
export function createClickDecider({ onSingle, onDouble, windowMs = 250, setTimer = setTimeout, clearTimer = clearTimeout }) {
  /** @type {{key: string, handle: any} | null} */
  let pending = null;
  return {
    /** @param {string} key */
    click(key) {
      if (pending && pending.key === key) {
        clearTimer(pending.handle);
        pending = null;
        onDouble(key);
        return;
      }
      if (pending) {
        clearTimer(pending.handle);
        const prev = pending.key;
        pending = null;
        onSingle(prev);
      }
      const entry = { key, handle: /** @type {any} */ (null) };
      entry.handle = setTimer(() => {
        if (pending === entry) {
          pending = null;
          onSingle(key);
        }
      }, windowMs);
      pending = entry;
    },
    /** The key waiting for its window to end, if any. */
    pendingKey: () => (pending ? pending.key : null),
    cancel() {
      if (pending) clearTimer(pending.handle);
      pending = null;
    },
  };
}
