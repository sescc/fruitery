// @ts-check
// Validation for an item's optional phone deep link (an Android intent: or custom-scheme target the
// phone opens instead of a web URL). Pure, never throws. The desktop never opens this; it is a
// phone-only open-target, so the rules here are the only gate. Kept deliberately strict: some
// exotic-but-valid intents are refused in exchange for never emitting a javascript:/data:/file:
// payload (D53/D89 spirit: synced data must not do something dangerous on a device).

/** Longest accepted deep link. */
export const MAX_DEEP_LINK = 2048;

/** Schemes that must never appear, as the deep link's own scheme or inside an intent fallback. */
const UNSAFE_SCHEMES = new Set(['javascript', 'data', 'file', 'blob', 'vbscript']);

/** A scheme token: a letter then letters/digits/`+`/`.`/`-`, as in RFC 3986. */
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/**
 * The scheme of a URL-ish string in lower case, or null when it has none.
 * @param {string} s
 * @returns {string | null}
 */
function schemeOf(s) {
  const m = SCHEME_RE.exec(s.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Pull the `S.browser_fallback_url` value out of an Android `intent://` string. Intent extras live
 * in the `#Intent;...;end` fragment as `key=value` pairs separated by `;`; the value is URL-encoded.
 * @param {string} s
 * @returns {string | null} the decoded fallback URL, or null when there is none
 */
function intentFallbackUrl(s) {
  const hash = s.indexOf('#');
  if (hash === -1) return null;
  for (const part of s.slice(hash + 1).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) !== 'S.browser_fallback_url') continue;
    try {
      return decodeURIComponent(part.slice(eq + 1));
    } catch {
      return part.slice(eq + 1);
    }
  }
  return null;
}

/**
 * Validate a deep link. Absent (null/undefined) is valid and means "no deep link". A present value
 * must be a non-blank string, at most `MAX_DEEP_LINK`, with no control characters or whitespace,
 * whose scheme is present and not one of the unsafe schemes; an `intent://` value whose
 * `S.browser_fallback_url` uses an unsafe scheme is refused too.
 * @param {unknown} value
 * @returns {{field: string, code: string}[]} empty when valid; otherwise one `invalid-deep-link`
 */
export function validateDeepLink(value) {
  if (value === null || value === undefined) return [];
  const bad = [{ field: 'deepLink', code: 'invalid-deep-link' }];
  if (typeof value !== 'string') return bad;
  const t = value.trim();
  if (t === '' || t.length > MAX_DEEP_LINK) return bad;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return bad; // no whitespace or control chars anywhere
  const scheme = schemeOf(t);
  if (scheme === null || UNSAFE_SCHEMES.has(scheme)) return bad;
  const fb = intentFallbackUrl(t);
  if (fb !== null) {
    const fbScheme = schemeOf(fb);
    if (fbScheme !== null && UNSAFE_SCHEMES.has(fbScheme)) return bad;
  }
  return [];
}

/**
 * Is this a deep link the phone should open? (A convenience over `validateDeepLink`.)
 * @param {unknown} value
 * @returns {boolean}
 */
export function isUsableDeepLink(value) {
  return typeof value === 'string' && value.trim() !== '' && validateDeepLink(value).length === 0;
}
