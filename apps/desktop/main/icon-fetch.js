// @ts-check
// One bounded download for icons and for the page read by "Refresh icon" (D116): the item's own
// session, a timeout, and a byte cap enforced while reading (a big or endless body is never held).
// No Electron import: the session (anything with a WHATWG-style `fetch`) is passed in.

import { isHttpUrl } from '../lib/resolve-open.js';
import { ICON_TIMEOUT_MS, MAX_ICON_BYTES } from '../lib/favicon.js';

/**
 * @param {{fetch: (url: string, init?: object) => Promise<Response>}} ses
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.maxBytes]     the cap
 * @param {number} [options.timeoutMs]    covers connecting and reading
 * @param {boolean} [options.truncate]    true: stop at the cap and keep what was read; false: refuse a larger body
 * @returns {Promise<{bytes: Uint8Array, url: string} | null>} null on any failure, timeout, a non-2xx answer or a body over the cap
 */
export async function fetchLimited(ses, url, { maxBytes = MAX_ICON_BYTES, timeoutMs = ICON_TIMEOUT_MS, truncate = false } = {}) {
  if (!isHttpUrl(url)) return null;
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    const res = await ses.fetch(url, { signal, redirect: 'follow' });
    if (!res.ok || !res.body) return null;
    const finalUrl = typeof res.url === 'string' && res.url !== '' ? res.url : url;
    if (!isHttpUrl(finalUrl)) return null;
    const declared = Number(res.headers.get('content-length'));
    if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
      void res.body.cancel().catch(() => {});
      return null;
    }
    const reader = res.body.getReader();
    /** @type {Uint8Array[]} */
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        if (!truncate) {
          void reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(value.subarray(0, value.length - (total - maxBytes)));
        void reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
    return { bytes: new Uint8Array(Buffer.concat(chunks)), url: finalUrl };
  } catch {
    return null;
  }
}
