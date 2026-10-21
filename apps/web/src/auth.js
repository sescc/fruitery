// @ts-check
// Cloudflare Access JWT validation with WebCrypto only (no dependencies). Fails closed.

/** @typedef {{email: string} | {serviceToken: string}} Identity the owner's email, or an allowed service token's client id */
/** @typedef {{email?: string, service_token_id?: string, common_name?: string}} AccessIdentity fields of `ctx.access.getIdentity()` that matter here (service-token fields unverified, see docs/web/general/service-tokens.md) */
/** @typedef {{getIdentity: () => Promise<AccessIdentity | undefined | null>}} AccessBinding Worker-level Access (ctx.access) */
/** @typedef {{now?: number, fetch?: typeof fetch, access?: AccessBinding}} AuthDeps */
/** @typedef {{TEAM_DOMAIN?: string, POLICY_AUD?: string, OWNER_EMAIL?: string, SERVICE_TOKEN_IDS?: string, DEV_NO_AUTH?: string}} AuthEnv */

const JWKS_TTL_MS = 10 * 60 * 1000;
const LEEWAY_S = 60;
const TOKEN_HEADER = 'Cf-Access-Jwt-Assertion';

const FORCED_REFRESH_MIN_MS = 60 * 1000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** @type {Map<string, {keys: JsonWebKey[], fetchedAt: number, lastForcedAt?: number}>} per team domain, module memory */
const jwksCache = new Map();

/** Forget cached signing keys (tests). */
export function clearJwksCache() {
  jwksCache.clear();
}

/**
 * @param {string} s base64url
 * @returns {Uint8Array}
 */
function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @param {string} s base64url of UTF-8 JSON
 * @returns {Record<string, any> | null}
 */
function decodeJson(s) {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Normalise a team domain to `https://host` without a trailing slash.
 * @param {string} domain
 * @returns {string}
 */
function normaliseDomain(domain) {
  const d = domain.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(d) ? d : `https://${d}`;
}

/**
 * Load the team's signing keys, using the 10-minute memory cache unless `force`.
 * @param {string} teamDomain normalised
 * @param {AuthDeps} deps
 * @param {boolean} force
 * @returns {Promise<{keys: JsonWebKey[], refreshed: boolean} | null>}
 */
async function loadKeys(teamDomain, deps, force) {
  const now = deps.now ?? Date.now();
  const cached = jwksCache.get(teamDomain);
  if (cached && !force && now - cached.fetchedAt < JWKS_TTL_MS) return { keys: cached.keys, refreshed: false };
  if (cached && force) {
    // forced refreshes (unknown kid) are rate-limited per team domain; failed attempts count too
    if (cached.lastForcedAt !== undefined && now - cached.lastForcedAt < FORCED_REFRESH_MIN_MS) {
      return { keys: cached.keys, refreshed: false };
    }
    cached.lastForcedAt = now;
  }
  try {
    const res = await (deps.fetch ?? fetch)(`${teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error('jwks-http');
    const body = /** @type {{keys?: JsonWebKey[]}} */ (await res.json());
    if (!Array.isArray(body.keys)) throw new Error('jwks-shape');
    jwksCache.set(teamDomain, { keys: body.keys, fetchedAt: now, lastForcedAt: cached?.lastForcedAt });
    return { keys: body.keys, refreshed: true };
  } catch {
    // keep using stale keys when the refresh fails; with none, fail closed
    return cached ? { keys: cached.keys, refreshed: false } : null;
  }
}

/**
 * Verify the RS256 signature of a compact JWT with a JWK.
 * @param {JsonWebKey} jwk
 * @param {string} signingInput `header.payload`
 * @param {Uint8Array} signature
 * @returns {Promise<boolean>}
 */
async function verifyRs256(jwk, signingInput, signature) {
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, /** @type {BufferSource} */ (signature), new TextEncoder().encode(signingInput));
  } catch {
    return false;
  }
}

/**
 * Why a request was denied. Codes only: they never carry an email, token, audience or domain.
 * @typedef {'no-credentials' | 'jwt-config-missing' | 'jwt-malformed' | 'jwt-unknown-key' | 'jwt-bad-signature'
 *   | 'jwt-expired' | 'jwt-not-yet-valid' | 'jwt-wrong-issuer' | 'jwt-wrong-audience' | 'email-mismatch'
 *   | 'owner-email-missing' | 'access-identity-error' | 'access-no-email'
 *   | 'service-token-not-allowed' | 'service-token-ids-missing'} DenyReason
 */
/** @typedef {'jwt' | 'ctx.access' | 'none'} AuthPath which credential was examined */
/** @typedef {{ok: true, identity: Identity} | {ok: false, reason: DenyReason, path: AuthPath}} AuthResult */

/**
 * The owner addresses: `OWNER_EMAIL` may hold several, comma-separated. Whitespace is trimmed,
 * case is ignored and empty entries are dropped.
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function parseOwners(value) {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '');
}

/**
 * The allowed service-token client ids: `SERVICE_TOKEN_IDS` is a comma-separated list. Whitespace is
 * trimmed and empty entries are dropped; ids are compared exactly (case-sensitive).
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function parseServiceTokenIds(value) {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * @param {DenyReason} reason
 * @param {AuthPath} path
 * @returns {AuthResult}
 */
const deny = (reason, path) => ({ ok: false, reason, path });

/**
 * @param {unknown} v
 * @returns {string} the value when it is a non-empty string, else ''
 */
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Decide an authenticated identity. An identity with an email is checked against the owner
 * addresses only; one without an email but with a service-token client id is checked against the
 * allowed token ids only, so neither list can ever admit the other kind.
 * @param {{email: string, serviceTokenId: string}} who email is already trimmed and lower-cased
 * @param {{owners: string[], tokenIds: string[]}} lists
 * @param {AuthPath} path
 * @returns {AuthResult}
 */
function decide(who, lists, path) {
  const { owners, tokenIds } = lists;
  if (who.email !== '') {
    if (owners.length === 0) return deny('owner-email-missing', path);
    return owners.includes(who.email) ? { ok: true, identity: { email: who.email } } : deny('email-mismatch', path);
  }
  if (who.serviceTokenId !== '') {
    if (tokenIds.length === 0) return deny('service-token-ids-missing', path);
    return tokenIds.includes(who.serviceTokenId) ? { ok: true, identity: { serviceToken: who.serviceTokenId } } : deny('service-token-not-allowed', path);
  }
  if (owners.length === 0) return deny('owner-email-missing', path);
  return deny(path === 'jwt' ? 'email-mismatch' : 'access-no-email', path);
}

/**
 * Validate a `Cf-Access-Jwt-Assertion` token: an RS256 token signed by one of the team's keys,
 * with `iss` = team domain, `aud` containing the policy AUD, unexpired (60 s leeway). Then either
 * its `email` equals (case-insensitively) one of the owner addresses, or, for a token without an
 * email, its `common_name` (the service token's client id) is in `SERVICE_TOKEN_IDS`.
 * Missing configuration is a denial.
 * @param {string} token
 * @param {AuthEnv} env
 * @param {AuthDeps} deps
 * @returns {Promise<AuthResult>}
 */
async function validateJwt(token, env, deps) {
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) return deny('jwt-config-missing', 'jwt');
  const owners = parseOwners(env.OWNER_EMAIL);
  const tokenIds = parseServiceTokenIds(env.SERVICE_TOKEN_IDS);
  // nothing could be admitted: refuse before any network call
  if (owners.length === 0 && tokenIds.length === 0) return deny('owner-email-missing', 'jwt');
  const teamDomain = normaliseDomain(env.TEAM_DOMAIN);
  const parts = token.split('.');
  if (parts.length !== 3) return deny('jwt-malformed', 'jwt');
  const [h, p, s] = parts;
  const header = decodeJson(h);
  const payload = decodeJson(p);
  if (!header || !payload || header.alg !== 'RS256' || typeof header.kid !== 'string') return deny('jwt-malformed', 'jwt');
  /** @type {Uint8Array} */
  let signature;
  try {
    signature = b64urlToBytes(s);
  } catch {
    return deny('jwt-malformed', 'jwt');
  }

  let loaded = await loadKeys(teamDomain, deps, false);
  if (!loaded) return deny('jwt-unknown-key', 'jwt'); // no signing keys could be obtained
  let jwk = loaded.keys.find((k) => /** @type {any} */ (k).kid === header.kid);
  if (!jwk && !loaded.refreshed) {
    loaded = await loadKeys(teamDomain, deps, true); // unknown kid: refetch once
    jwk = loaded?.keys.find((k) => /** @type {any} */ (k).kid === header.kid);
  }
  if (!jwk) return deny('jwt-unknown-key', 'jwt');
  if (!(await verifyRs256(jwk, `${h}.${p}`, signature))) return deny('jwt-bad-signature', 'jwt');

  const nowS = (deps.now ?? Date.now()) / 1000;
  if (typeof payload.exp !== 'number') return deny('jwt-malformed', 'jwt');
  if (nowS >= payload.exp + LEEWAY_S) return deny('jwt-expired', 'jwt');
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number') return deny('jwt-malformed', 'jwt');
    if (payload.nbf > nowS + LEEWAY_S) return deny('jwt-not-yet-valid', 'jwt');
  }
  if (typeof payload.iss !== 'string' || normaliseDomain(payload.iss) !== teamDomain) return deny('jwt-wrong-issuer', 'jwt');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.POLICY_AUD)) return deny('jwt-wrong-audience', 'jwt');
  const email = str(payload.email).trim().toLowerCase();
  const serviceTokenId = str(payload.service_token_id) || str(payload.common_name);
  return decide({ email, serviceTokenId }, { owners, tokenIds }, 'jwt');
}

/**
 * Decide whether a request may use the API, in this order:
 * 1. `DEV_NO_AUTH === "1"` bypasses everything, but only when the request's hostname is local
 *    (localhost, 127.0.0.1, ::1): a `DEV_NO_AUTH` that reaches a deployment is ignored.
 * 2. If the `Cf-Access-Jwt-Assertion` header is present it is validated (see `validateJwt`); a
 *    present-but-invalid header is denied and never falls through to step 3.
 * 3. Otherwise, if the Worker-level Access binding `deps.access` (`ctx.access`) exists, its
 *    `getIdentity()` email must equal one of the owner addresses (`OWNER_EMAIL`, comma-separated,
 *    case-insensitive), or, for an identity without an email, its service-token client id
 *    (`service_token_id`, else `common_name`) must be listed in `SERVICE_TOKEN_IDS` (comma-separated,
 *    exact match). `TEAM_DOMAIN` and `POLICY_AUD` are not needed on this path.
 * 4. Anything else is denied (`no-credentials`).
 * A denial carries a reason code (never a personal value) and the path that was examined.
 * @param {Request} request
 * @param {AuthEnv} env
 * @param {AuthDeps} [deps]
 * @returns {Promise<AuthResult>}
 */
export async function authorize(request, env, deps = {}) {
  if (env.DEV_NO_AUTH === '1' && LOCAL_HOSTS.has(new URL(request.url).hostname)) return { ok: true, identity: { email: 'dev@local' } };

  const token = request.headers.get(TOKEN_HEADER);
  if (token) return validateJwt(token, env, deps);

  if (deps.access) {
    const owners = parseOwners(env.OWNER_EMAIL);
    const tokenIds = parseServiceTokenIds(env.SERVICE_TOKEN_IDS);
    // nothing could be admitted: do not even ask for the identity
    if (owners.length === 0 && tokenIds.length === 0) return deny('owner-email-missing', 'ctx.access');
    /** @type {AccessIdentity | undefined | null} */
    let identity;
    try {
      identity = await deps.access.getIdentity();
    } catch {
      return deny('access-identity-error', 'ctx.access');
    }
    const email = str(identity?.email).trim().toLowerCase();
    // the service-token fields are unverified for Worker-level Access: the documented get-identity
    // field first, then common_name (only ever used when there is no email)
    const serviceTokenId = str(identity?.service_token_id) || str(identity?.common_name);
    return decide({ email, serviceTokenId }, { owners, tokenIds }, 'ctx.access');
  }
  return deny('no-credentials', 'none');
}

/**
 * `authorize` with the plain result shape: the identity, or null when denied.
 * @param {Request} request
 * @param {AuthEnv} env
 * @param {AuthDeps} [deps]
 * @returns {Promise<Identity | null>}
 */
export async function authenticate(request, env, deps = {}) {
  const r = await authorize(request, env, deps);
  return r.ok ? r.identity : null;
}