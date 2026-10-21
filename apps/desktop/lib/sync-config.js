// @ts-check
// The sync connection settings (design "Desktop: secrets"): which Worker, which access key (client id),
// when the key expires. Pure: no Electron import, so it is unit tested. The client SECRET is not part of
// this config; it lives encrypted in its own file (main/secrets.js) and never reaches the UI.

import { isValidDate } from '../../../packages/core/time.js';

/** Longest accepted client id / secret. */
export const MAX_CREDENTIAL = 256;

/**
 * @typedef {object} SyncConfig
 * @property {string | null} baseUrl   the Worker address, no trailing slash
 * @property {string | null} clientId  the service token's client id
 * @property {string | null} expiresOn the key's expiry date, YYYY-MM-DD
 */
/** @typedef {{ok: true, value: string} | {ok: false, code: string}} FieldResult */
/** @typedef {{field: string, code: string}} FieldError */

/** @returns {SyncConfig} */
export function emptySyncConfig() {
  return { baseUrl: null, clientId: null, expiresOn: null };
}

/**
 * The Worker address: `https://host[:port]`, nothing else. Plain `http://` is refused except for the
 * local development hosts, and only when `allowLocal` (smoke / not packaged). Codes: required,
 * invalid-url, not-https, credentials, path, query-or-hash.
 * @param {unknown} url
 * @param {{allowLocal?: boolean}} [opts]
 * @returns {FieldResult} `value` is the normalised address (scheme + host + port, no trailing slash)
 */
export function validateBaseUrl(url, opts = {}) {
  if (url === null || url === undefined) return { ok: false, code: 'required' };
  if (typeof url !== 'string') return { ok: false, code: 'invalid-url' };
  const raw = url.trim();
  if (raw === '') return { ok: false, code: 'required' };
  if (/\s/.test(raw) || raw.length > 2000) return { ok: false, code: 'invalid-url' };
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (!scheme) return { ok: false, code: 'invalid-url' };
  const proto = scheme[1].toLowerCase();
  if (proto !== 'https' && proto !== 'http') return { ok: false, code: 'invalid-url' };
  if (raw.includes('@')) return { ok: false, code: 'credentials' };
  if (raw.includes('?') || raw.includes('#')) return { ok: false, code: 'query-or-hash' };
  /** @type {URL} */
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, code: 'invalid-url' };
  }
  if (u.hostname === '') return { ok: false, code: 'invalid-url' };
  if (u.username !== '' || u.password !== '') return { ok: false, code: 'credentials' };
  if (u.pathname !== '/') return { ok: false, code: 'path' };
  if (proto === 'http') {
    const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
    if (!(opts.allowLocal === true && local)) return { ok: false, code: 'not-https' };
  }
  return { ok: true, value: `${u.protocol}//${u.host}` };
}

/**
 * @param {unknown} v
 * @returns {FieldResult} the trimmed value
 */
function validateCredential(v) {
  if (typeof v !== 'string') return { ok: false, code: 'invalid-value' };
  const s = v.trim();
  if (s === '') return { ok: false, code: 'required' };
  if (/\s/.test(s)) return { ok: false, code: 'whitespace' };
  if (s.length > MAX_CREDENTIAL) return { ok: false, code: 'too-long' };
  return { ok: true, value: s };
}

/** @param {unknown} v @returns {FieldResult} */
export const validateClientId = (v) => validateCredential(v);

/** @param {unknown} v @returns {FieldResult} */
export const validateSecret = (v) => validateCredential(v);

/**
 * The key's expiry date. Blank is allowed (no expiry known): `value` is then ''.
 * @param {unknown} v
 * @returns {FieldResult}
 */
export function validateExpiresOn(v) {
  if (v === null || v === undefined) return { ok: true, value: '' };
  if (typeof v !== 'string') return { ok: false, code: 'invalid-value' };
  const s = v.trim();
  if (s === '') return { ok: true, value: '' };
  return isValidDate(s) ? { ok: true, value: s } : { ok: false, code: 'invalid-date' };
}

/**
 * A clean config from whatever device.json holds. Never throws; unusable parts become null. The
 * address is accepted in any form `validateBaseUrl` allows for local development (the connection
 * itself is checked again, with the real mode, wherever the key is used).
 * @param {unknown} raw
 * @returns {SyncConfig}
 */
export function sanitizeSyncConfig(raw) {
  const out = emptySyncConfig();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const b = validateBaseUrl(r.baseUrl, { allowLocal: true });
  if (b.ok) out.baseUrl = b.value;
  const c = validateClientId(r.clientId);
  if (c.ok) out.clientId = c.value;
  const e = validateExpiresOn(r.expiresOn);
  if (e.ok && e.value !== '') out.expiresOn = e.value;
  return out;
}

/** The last 4 characters of a client id: all the UI is told about it. @param {string | null} clientId */
export function clientIdTail(clientId) {
  return typeof clientId === 'string' && clientId !== '' ? clientId.slice(-4) : null;
}

/** Is there enough to try a connection (address and client id)? @param {SyncConfig} cfg */
export function isComplete(cfg) {
  return Boolean(cfg.baseUrl && cfg.clientId);
}

/**
 * Decide what a "Save" does with the four form values, without side effects.
 * - Blank client id / secret keep the stored ones, so the owner can change just the expiry.
 * - A new address or a new client id needs the secret typed again (a stored secret is never sent
 *   to a different place or paired with a different id behind the owner's back).
 * @param {unknown} input  `{baseUrl, clientId, secret, expiresOn}` (strings; anything else is invalid)
 * @param {{allowLocal: boolean, current: SyncConfig, hasSecret: boolean}} state
 * @returns {{ok: true, config: SyncConfig, secret: string | null} | {ok: false, errors: FieldError[]}}
 *   `secret: null` = keep the stored one
 */
export function planConfigure(input, state) {
  const i = input !== null && typeof input === 'object' ? /** @type {Record<string, unknown>} */ (input) : {};
  /** @type {FieldError[]} */
  const errors = [];
  const base = validateBaseUrl(i.baseUrl, { allowLocal: state.allowLocal });
  if (!base.ok) errors.push({ field: 'baseUrl', code: base.code });
  const expiry = validateExpiresOn(i.expiresOn);
  if (!expiry.ok) errors.push({ field: 'expiresOn', code: expiry.code });

  const typedId = typeof i.clientId === 'string' ? i.clientId.trim() : '';
  const typedSecret = typeof i.secret === 'string' ? i.secret.trim() : '';
  /** @type {string | null} */
  let clientId = null;
  if (typedId !== '') {
    const c = validateClientId(typedId);
    if (c.ok) clientId = c.value;
    else errors.push({ field: 'clientId', code: c.code });
  } else if (state.current.clientId) {
    clientId = state.current.clientId;
  } else {
    errors.push({ field: 'clientId', code: 'required' });
  }

  const baseChanged = base.ok && base.value !== state.current.baseUrl;
  const idChanged = clientId !== null && clientId !== state.current.clientId;
  /** @type {string | null} */
  let secret = null;
  if (typedSecret !== '') {
    const s = validateSecret(typedSecret);
    if (s.ok) secret = s.value;
    else errors.push({ field: 'secret', code: s.code });
  } else if (!state.hasSecret) {
    errors.push({ field: 'secret', code: 'required' });
  } else if (base.ok && clientId !== null && (baseChanged || idChanged)) {
    errors.push({ field: 'secret', code: 'retype-required' });
  }

  if (errors.length > 0 || !base.ok || !expiry.ok) return { ok: false, errors };
  return {
    ok: true,
    config: { baseUrl: base.value, clientId, expiresOn: expiry.value === '' ? null : expiry.value },
    secret,
  };
}

/**
 * @typedef {{ok: true, json: any}
 *   | {ok: false, kind: 'refused', reason: 'access-key-refused'}
 *   | {ok: false, kind: 'denied', reason: string}
 *   | {ok: false, kind: 'invalid', status: number, json: any}
 *   | {ok: false, kind: 'http', status: number}
 *   | {ok: false, kind: 'offline'}
 *   | {ok: false, kind: 'not-connected'}} ApiResult
 */

/**
 * Sort a Worker answer. A redirect (or an opaque redirect, status 0) or a 401 means Access refused the key.
 * Reasons are codes only.
 * @param {number} status
 * @param {any} json  the parsed body, or null when it was not JSON
 * @returns {ApiResult}
 */
export function classifyResponse(status, json) {
  // Access answers a wrong service token with a redirect to its login page, or with a plain 401
  if (status === 0 || status === 401 || (status >= 300 && status < 400)) return { ok: false, kind: 'refused', reason: 'access-key-refused' };
  if (status >= 200 && status < 300) return { ok: true, json };
  if (status === 403) {
    const reason = json && typeof json === 'object' && typeof json.reason === 'string' && json.reason !== '' ? json.reason : 'forbidden';
    return { ok: false, kind: 'denied', reason };
  }
  if (status === 422) return { ok: false, kind: 'invalid', status, json };
  return { ok: false, kind: 'http', status };
}

/**
 * One short code for a failed request (what the UI shows next to "Test connection").
 * @param {ApiResult} r  a result with `ok: false`
 * @returns {string}
 */
export function reasonOf(r) {
  if (r.ok) return 'ok';
  switch (r.kind) {
    case 'refused':
    case 'denied':
      return r.reason;
    case 'invalid':
    case 'http':
      return `http-${r.status}`;
    case 'offline':
      return 'offline';
    default:
      return 'not-connected';
  }
}
