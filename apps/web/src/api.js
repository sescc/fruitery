// @ts-check
// HTTP routing for /api: authentication first, then JSON in/out with consistent status codes.
// Pure of ambient state: the clock and the JWKS fetcher come in through `deps`.

import { authorize } from './auth.js';
import { StoreError, getState, history, tick, untick, upsertEntities } from './store.js';

/** @typedef {{DB: any, TEAM_DOMAIN?: string, POLICY_AUD?: string, OWNER_EMAIL?: string, SERVICE_TOKEN_IDS?: string, DEV_NO_AUTH?: string}} Env */
/** @typedef {{now?: number, fetch?: typeof fetch, access?: import('./auth.js').AccessBinding, log?: (...args: unknown[]) => void}} Deps */

/**
 * JSON response, never cacheable.
 * @param {unknown} body
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 * @returns {Response}
 */
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

/**
 * @param {string} error
 * @param {number} status
 * @param {unknown} [details]
 * @param {Record<string, string>} [headers]
 * @returns {Response}
 */
function fail(error, status, details, headers) {
  return json(details === undefined ? { error } : { error, details }, status, headers);
}

/**
 * @param {Request} request
 * @returns {Promise<{ok: true, value: unknown} | {ok: false}>}
 */
async function readJson(request) {
  try {
    return { ok: true, value: JSON.parse(await request.text()) };
  } catch {
    return { ok: false };
  }
}

/**
 * Handle one request for the API.
 * @param {Request} request
 * @param {Env} env
 * @param {Deps} [deps]
 * @returns {Promise<Response>}
 */
export async function handle(request, env, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  if (path !== '/api' && !path.startsWith('/api/')) return fail('not-found', 404);

  // 403 before any data is touched; the reason is a code only (no email, token, audience or domain)
  const auth = await authorize(request, env, deps);
  if (!auth.ok) {
    (deps.log ?? console.log)('auth denied', auth.reason, { path: auth.path });
    return json({ error: 'forbidden', reason: auth.reason }, 403);
  }

  const nowMs = deps.now ?? Date.now();
  const method = request.method.toUpperCase();
  /** @param {string[]} allowed */
  const wrongMethod = (allowed) => fail('method-not-allowed', 405, undefined, { allow: allowed.join(', ') });

  try {
    if (path === '/api/state') {
      if (method !== 'GET') return wrongMethod(['GET']);
      return json(await getState(env.DB, nowMs, { since: url.searchParams.get('since') }));
    }

    if (path === '/api/entities') {
      if (method !== 'PUT') return wrongMethod(['PUT']);
      const body = await readJson(request);
      if (!body.ok) return fail('bad-json', 400);
      return json(await upsertEntities(env.DB, body.value));
    }

    if (path === '/api/ticks') {
      if (method !== 'POST') return wrongMethod(['POST']);
      const body = await readJson(request);
      if (!body.ok) return fail('bad-json', 400);
      const itemId = /** @type {any} */ (body.value)?.itemId;
      if (typeof itemId !== 'string' || itemId === '') return fail('bad-request', 400, [{ errors: [{ field: 'itemId', code: 'required' }] }]);
      return json(await tick(env.DB, itemId, nowMs, { doneAt: /** @type {any} */ (body.value).doneAt }));
    }

    if (path.startsWith('/api/ticks/')) {
      if (method !== 'DELETE') return wrongMethod(['DELETE']);
      let itemId;
      try {
        itemId = decodeURIComponent(path.slice('/api/ticks/'.length));
      } catch {
        return fail('bad-request', 400);
      }
      if (itemId === '' || itemId.includes('/')) return fail('not-found', 404);
      return json(await untick(env.DB, itemId, nowMs, { periodKey: url.searchParams.get('periodKey') }));
    }

    if (path === '/api/history') {
      if (method !== 'GET') return wrongMethod(['GET']);
      const itemId = url.searchParams.get('itemId');
      if (!itemId) return fail('bad-request', 400, [{ errors: [{ field: 'itemId', code: 'required' }] }]);
      return json(await history(env.DB, itemId));
    }

    return fail('not-found', 404);
  } catch (err) {
    if (err instanceof StoreError) return fail(err.code, err.status, err.details);
    console.error('api error', err);
    return fail('internal', 500);
  }
}
