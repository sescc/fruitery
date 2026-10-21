// @ts-check
// Where a window a site opens goes (D72, refined): an app window (same partition, UA, sandbox) for
// anything that looks like a sign-in, the default browser for ordinary links, nothing for the rest.
// Pure.

/**
 * Known identity / sign-in hosts, suffix-matched (`host === h` or a subdomain of `h`). A `paths`
 * list restricts the match to URLs whose path starts with one of them (at a `/` boundary).
 * @type {ReadonlyArray<{host: string, paths?: string[]}>}
 */
export const IDENTITY_HOSTS = Object.freeze([
  { host: 'accounts.google.com' },
  { host: 'accounts.youtube.com' },
  { host: 'appleid.apple.com' },
  { host: 'login.microsoftonline.com' },
  { host: 'login.live.com' },
  { host: 'login.microsoft.com' },
  { host: 'github.com', paths: ['/login'] },
  { host: 'discord.com', paths: ['/oauth2', '/login'] },
  { host: 'facebook.com', paths: ['/dialog/oauth', '/login'] },
  { host: 'twitter.com', paths: ['/oauth', '/i/oauth2'] },
  { host: 'x.com', paths: ['/oauth', '/i/oauth2'] },
  { host: 'auth0.com' },
  { host: 'okta.com' },
  { host: 'onelogin.com' },
]);

const AUTH_SEGMENTS = new Set(['oauth', 'oauth2', 'authorize', 'auth', 'sso', 'signin', 'sign-in', 'login', 'saml']);
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);

/**
 * @param {string} url
 * @returns {URL | null} only http(s) URLs
 */
function parseHttp(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '' ? u : null;
  } catch {
    return null;
  }
}

/**
 * Is this URL on a known identity provider (and, where listed, on its sign-in path)?
 * @param {string} url
 * @returns {boolean}
 */
export function isIdentityUrl(url) {
  const u = parseHttp(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  return IDENTITY_HOSTS.some((e) => {
    if (host !== e.host && !host.endsWith(`.${e.host}`)) return false;
    return !e.paths || e.paths.some((p) => path === p || path.startsWith(`${p}/`));
  });
}

/**
 * Does the path or query look like an authentication flow?
 * @param {string} url
 * @returns {boolean}
 */
export function looksLikeAuthFlow(url) {
  const u = parseHttp(url);
  if (!u) return false;
  if (u.pathname.toLowerCase().split('/').some((seg) => AUTH_SEGMENTS.has(seg))) return true;
  const names = new Set([...u.searchParams.keys()].map((k) => k.toLowerCase()));
  return (names.has('client_id') && names.has('redirect_uri')) || names.has('response_type') || names.has('samlrequest');
}

/**
 * Approximate registrable domain: the last two labels, or the last three under a two-letter country
 * TLD with a known second-level label (example.co.uk). IP addresses and single-label hosts are
 * their own domain.
 * @param {string} hostname
 * @returns {string}
 */
export function registrableDomain(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  const take = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/**
 * @param {string} url
 * @param {string | null | undefined} openerUrl
 * @returns {boolean} same registrable domain
 */
export function sameSite(url, openerUrl) {
  const a = parseHttp(url);
  const b = typeof openerUrl === 'string' ? parseHttp(openerUrl) : null;
  return a !== null && b !== null && registrableDomain(a.hostname) === registrableDomain(b.hostname);
}

/**
 * Route a window a site tries to open.
 * 1. not http(s) and not about:blank -> deny (about:blank is a script-opened sign-in window that
 *    navigates next, so it is an app window);
 * 2. `new-window` -> app window;
 * 3. a new tab that is a sign-in (a known identity host, an auth-looking URL, or same-site as the
 *    opener): as foreground-tab / background-tab it becomes the opener's own pane ('same-pane': in a
 *    normal browser that new tab would be the app itself); any other disposition -> app window;
 * 4. any other new tab -> the default browser.
 * @param {{url: string, disposition?: string, features?: string, frameName?: string, openerUrl?: string | null}} p
 * @returns {'same-pane' | 'app-window' | 'external' | 'deny'}
 */
export function routePopup({ url, disposition, openerUrl }) {
  if (typeof url !== 'string') return 'deny';
  if (url === 'about:blank') return 'app-window';
  if (!parseHttp(url)) return 'deny';
  if (disposition === 'new-window') return 'app-window';
  if (isIdentityUrl(url) || looksLikeAuthFlow(url) || sameSite(url, openerUrl)) {
    return disposition === 'foreground-tab' || disposition === 'background-tab' ? 'same-pane' : 'app-window';
  }
  return 'external';
}

/**
 * After an app-window popup closes (not a same-pane sign-in, which has no window): reload the opener
 * page when it is still on the same address as when the popup opened and the popup went through a
 * sign-in (best effort: the opener usually refreshes itself, but not always).
 * @param {{openerUrlBefore: string | null | undefined, openerUrlNow: string | null | undefined, visited: string[]}} p
 * @returns {boolean}
 */
export function shouldReloadOpener({ openerUrlBefore, openerUrlNow, visited }) {
  if (!openerUrlBefore || !openerUrlNow || openerUrlBefore !== openerUrlNow) return false;
  return visited.some((u) => isIdentityUrl(u) || looksLikeAuthFlow(u));
}
