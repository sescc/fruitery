// @ts-check
// Session cookies -> persistent cookies (D37), ported from the Electron spike
// (docs/desktop/general/spike-electron.md). Pure: the caller does the `cookies.set` and the flush.

export const COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * @typedef {object} CookieLike  the shape of an Electron `Cookie`
 * @property {string} name
 * @property {string} value
 * @property {string} domain
 * @property {boolean} [hostOnly]
 * @property {string} [path]
 * @property {boolean} [secure]
 * @property {boolean} [httpOnly]
 * @property {boolean} [session]
 * @property {number} [expirationDate]
 * @property {string} [sameSite]
 */

/**
 * @typedef {object} SetDetails  the details object for `cookies.set()`
 * @property {string} url
 * @property {string} name
 * @property {string} value
 * @property {string} [domain]
 * @property {string} path
 * @property {boolean} secure
 * @property {boolean} httpOnly
 * @property {number} expirationDate
 * @property {string} [sameSite]
 */

/**
 * Details to re-set a session cookie as a 30-day persistent one, or null when nothing needs to
 * change (already persistent, which also stops the re-set from looping, or malformed).
 * - attributes kept: name, value, path (default '/'), secure, httpOnly, sameSite when present;
 * - host-only cookies and `__Host-` cookies are set WITHOUT a domain, so they stay host-only;
 * - otherwise the original domain is passed through.
 * @param {CookieLike} cookie
 * @param {number} nowMs
 * @param {number} [ttlSeconds]
 * @returns {SetDetails | null}
 */
export function toPersistentDetails(cookie, nowMs, ttlSeconds = COOKIE_TTL_SECONDS) {
  if (!cookie || typeof cookie.name !== 'string' || cookie.name === '') return null;
  if (typeof cookie.domain !== 'string' || cookie.domain === '') return null;
  if (typeof cookie.expirationDate === 'number' || cookie.session === false) return null;
  const host = cookie.domain.replace(/^\./, '');
  const path = typeof cookie.path === 'string' && cookie.path.startsWith('/') ? cookie.path : '/';
  const secure = cookie.secure === true;
  /** @type {SetDetails} */
  const details = {
    url: `${secure ? 'https' : 'http'}://${host}${path}`,
    name: cookie.name,
    value: typeof cookie.value === 'string' ? cookie.value : '',
    path,
    secure,
    httpOnly: cookie.httpOnly === true,
    expirationDate: Math.floor(nowMs / 1000) + ttlSeconds,
  };
  if (typeof cookie.sameSite === 'string') details.sameSite = cookie.sameSite;
  if (cookie.hostOnly !== true && !cookie.name.startsWith('__Host-')) details.domain = cookie.domain;
  return details;
}

/**
 * Hostname of a URL, lower-case, without a leading `www.`; null when not parseable.
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function hostOfUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * Is a cookie domain covered by an opted-out item host? Suffix rules, `www.` stripped on both
 * sides: a cookie for `example.com`, `.example.com` or `sub.example.com` is covered by the host
 * `example.com` (or `www.example.com`). A parent-domain cookie (`.com`) or an unrelated domain is not.
 * @param {string} cookieDomain
 * @param {string[]} optOutHosts item hostnames (any case, `www.` optional)
 * @returns {boolean}
 */
export function isOptedOut(cookieDomain, optOutHosts) {
  if (typeof cookieDomain !== 'string' || cookieDomain === '') return false;
  const d = cookieDomain.replace(/^\./, '').toLowerCase().replace(/^www\./, '');
  for (const raw of optOutHosts) {
    if (typeof raw !== 'string' || raw === '') continue;
    const h = raw.toLowerCase().replace(/^\./, '').replace(/^www\./, '');
    if (h !== '' && (d === h || d.endsWith(`.${h}`))) return true;
  }
  return false;
}
