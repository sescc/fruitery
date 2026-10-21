// @ts-check
// What "open this item" means (D12, D17). Pure: effects live in main/open.js.

import { effectiveEdge, expandUrl } from '../../../packages/core/index.js';

/** @typedef {import('../../../packages/core/model.js').Item} Item */
/** @typedef {import('../../../packages/core/model.js').Workspace} Workspace */
/** @typedef {import('../../../packages/core/model.js').Settings} Settings */

/**
 * @typedef {{kind: 'blocked', reason: 'missing-google-email' | 'unknown-token' | 'no-url' | 'invalid-timezone', tokens?: string[]}
 *   | {kind: 'edge', url: string, profile: string | null}
 *   | {kind: 'app', path: string}
 *   | {kind: 'pane', url: string}} OpenAction
 */

/**
 * Only http and https addresses are ever opened (external browser, Edge, panes).
 * @param {unknown} url
 * @returns {boolean}
 */
export function isHttpUrl(url) {
  if (typeof url !== 'string' || url.length > 8192) return false;
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Decide how to open an item.
 * - A native app item whose program exists -> `app`; otherwise its fallback URL opens in a pane.
 * - A web item: the URL is expanded (date tokens in `settings.timezone`, the Google email); a
 *   missing email or an unknown token blocks the open; then `effectiveEdge` chooses Edge or a pane.
 * @param {Item} item
 * @param {Workspace} workspace the item's own workspace
 * @param {Settings} settings
 * @param {{edgeProfile: string | null}} device
 * @param {number} now epoch ms
 * @param {boolean} appExists whether `item.appPath` exists on this PC
 * @returns {OpenAction}
 */
export function resolveOpen(item, workspace, settings, device, now, appExists) {
  if (item.kind === 'app' && item.appPath && appExists) return { kind: 'app', path: item.appPath };
  const template = item.kind === 'app' ? item.fallbackUrl : item.url;
  if (typeof template !== 'string' || template.trim() === '') return { kind: 'blocked', reason: 'no-url' };
  let expanded;
  try {
    expanded = expandUrl(template, now, settings.timezone, settings);
  } catch {
    return { kind: 'blocked', reason: 'invalid-timezone' };
  }
  if (expanded.unknown.length > 0) return { kind: 'blocked', reason: 'unknown-token', tokens: expanded.unknown };
  if (expanded.missing.length > 0) return { kind: 'blocked', reason: 'missing-google-email', tokens: expanded.missing };
  if (!isHttpUrl(expanded.url)) return { kind: 'blocked', reason: 'no-url' };
  if (item.kind === 'web') {
    const edge = effectiveEdge(item, workspace, device.edgeProfile);
    if (edge.open) return { kind: 'edge', url: expanded.url, profile: edge.profile };
  }
  return { kind: 'pane', url: expanded.url };
}
