// @ts-check
// The one way the desktop talks to the Worker (design "Desktop: secrets"). The access key travels only in
// the CF-Access-Client-Id / CF-Access-Client-Secret headers of requests to the configured Worker address.
// Redirects are never followed: Access answers a refused key with a redirect to its login page.
// No Electron import: `fetch` is injected (main.js passes `net.fetch`), so this is testable.

import { validateBaseUrl, classifyResponse } from '../lib/sync-config.js';

/** @typedef {import('../lib/sync-config.js').ApiResult} ApiResult */

export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * @param {object} opts
 * @param {(url: string, init: any) => Promise<any>} opts.fetch
 * @param {boolean} opts.allowLocal  plain http to 127.0.0.1 / localhost / [::1] is allowed (smoke, development)
 * @param {number} [opts.timeoutMs]
 */
export function createRequestApi({ fetch, allowLocal, timeoutMs = REQUEST_TIMEOUT_MS }) {
  /**
   * @param {{baseUrl: string | null, clientId: string | null, secret: string | null}} key
   * @param {string} method
   * @param {string} path  starts with "/api/"
   * @param {unknown} [body]  sent as JSON when given
   * @returns {Promise<ApiResult>}
   */
  return async function requestApi(key, method, path, body) {
    const base = validateBaseUrl(key.baseUrl, { allowLocal });
    if (!base.ok || !key.clientId || !key.secret || typeof path !== 'string' || !path.startsWith('/api/')) {
      return { ok: false, kind: 'not-connected' };
    }
    /** @type {Record<string, string>} */
    const headers = {
      'CF-Access-Client-Id': key.clientId,
      'CF-Access-Client-Secret': key.secret,
      Accept: 'application/json',
    };
    /** @type {any} */
    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const ctl = new AbortController();
    init.signal = ctl.signal;
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base.value}${path}`, init);
      // an opaque redirect (a browser-style manual redirect) has status 0
      const status = res.type === 'opaqueredirect' ? 0 : Number(res.status);
      if (status === 0 || (status >= 300 && status < 400)) return classifyResponse(status, null);
      /** @type {any} */
      let json = null;
      try {
        json = JSON.parse(await res.text());
      } catch {
        json = null;
      }
      const result = classifyResponse(status, json);
      // a 2xx that is not JSON did not come from the Worker (a wrong address, a login page): not a success
      if (result.ok && json === null && status !== 204) return { ok: false, kind: 'http', status };
      return result;
    } catch (err) {
      // Electron's net.fetch rejects a redirect:'manual' request with 'Redirect was cancelled': Access answered with a redirect
      if (/redirect/i.test(String(/** @type {any} */ (err)?.message ?? err))) return classifyResponse(302, null);
      return { ok: false, kind: 'offline' };
    } finally {
      clearTimeout(timer);
    }
  };
}
