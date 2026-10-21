// @ts-check
// URL placeholder expansion: {YYYY} {MM} {DD} from the local date, {googleEmail} from settings.

import { localParts } from './time.js';

/** Known placeholder names (without braces). */
export const TOKENS = Object.freeze(['YYYY', 'MM', 'DD', 'googleEmail']);

const TOKEN_RE = /\{([^{}]*)\}/g;

/**
 * All placeholder names appearing in a template, in order of first appearance, de-duplicated.
 * @param {string} template
 * @returns {string[]}
 */
export function findTokens(template) {
  /** @type {string[]} */
  const out = [];
  for (const m of template.matchAll(TOKEN_RE)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Placeholder names in a template that are not in `TOKENS`.
 * @param {string} template
 * @returns {string[]}
 */
export function unknownTokens(template) {
  return findTokens(template).filter((t) => !TOKENS.includes(t));
}

/**
 * Fill placeholders. Date tokens use the local date in `tz` (the reset time is ignored).
 * `{googleEmail}` is URL-encoded. A placeholder that cannot be filled is left verbatim and
 * reported: unknown names in `unknown`, an unconfigured `googleEmail` in `missing`.
 * The timezone is only consulted when a date token is present.
 * @param {string} template
 * @param {number} nowMs epoch ms
 * @param {string} tz IANA timezone name
 * @param {{googleEmail?: string | null} | null | undefined} settings
 * @returns {{url: string, unknown: string[], missing: string[]}}
 * @throws {RangeError} 'invalid-timezone' when a date token needs an unknown timezone
 */
export function expandUrl(template, nowMs, tz, settings) {
  /** @type {string[]} */
  const unknown = [];
  /** @type {string[]} */
  const missing = [];
  /** @type {string[] | null} */
  let dateParts = null;
  const url = template.replace(TOKEN_RE, (whole, name) => {
    if (name === 'YYYY' || name === 'MM' || name === 'DD') {
      dateParts ??= localParts(nowMs, tz).date.split('-');
      return name === 'YYYY' ? dateParts[0] : name === 'MM' ? dateParts[1] : dateParts[2];
    }
    if (name === 'googleEmail') {
      const email = settings?.googleEmail;
      if (typeof email === 'string' && email.trim() !== '') return encodeURIComponent(email.trim());
      if (!missing.includes(name)) missing.push(name);
      return whole;
    }
    if (!unknown.includes(name)) unknown.push(name);
    return whole;
  });
  return { url, unknown, missing };
}
