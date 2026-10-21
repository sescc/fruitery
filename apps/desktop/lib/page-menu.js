// @ts-check
// The page right-click menu and the Edge profile for "open this page in Edge" (D121). Pure: main turns
// the entries into a native menu and runs the matching action on the webContents that raised it.

import { effectiveEdge } from '../../../packages/core/index.js';
import { isHttpUrl } from './resolve-open.js';

/**
 * @typedef {{type: 'separator'} | {id: 'copy-text' | 'copy-link' | 'back' | 'forward' | 'reload' | 'copy-address' | 'open-edge', label: string, enabled: boolean, accelerator?: string}} MenuEntry
 */

/**
 * What the menu offers. Back and Forward are unavailable without history in that direction; the two
 * page-address entries are unavailable without a web address. "Copy link address" appears over an
 * http(s) link, "Copy" when text is selected.
 * @param {{canGoBack?: boolean, canGoForward?: boolean, pageUrl?: string | null, linkUrl?: string | null, selectionText?: string | null}} p
 * @returns {MenuEntry[]}
 */
export function pageMenuModel(p) {
  const hasAddress = isHttpUrl(p.pageUrl);
  /** @type {MenuEntry[]} */
  const out = [];
  const selection = typeof p.selectionText === 'string' && p.selectionText.trim() !== '';
  if (selection) out.push({ id: 'copy-text', label: 'Copy', enabled: true });
  if (isHttpUrl(p.linkUrl)) out.push({ id: 'copy-link', label: 'Copy link address', enabled: true });
  if (out.length > 0) out.push({ type: 'separator' });
  out.push({ id: 'back', label: 'Back', enabled: p.canGoBack === true, accelerator: 'Alt+Left' });
  out.push({ id: 'forward', label: 'Forward', enabled: p.canGoForward === true, accelerator: 'Alt+Right' });
  out.push({ id: 'reload', label: 'Reload', enabled: true, accelerator: 'F5' });
  out.push({ type: 'separator' });
  out.push({ id: 'copy-address', label: 'Copy page address', enabled: hasAddress });
  out.push({ id: 'open-edge', label: 'Open page in Edge', enabled: hasAddress });
  return out;
}

/**
 * The Edge profile for opening the current page: the item's own profile, else this PC's default,
 * else null (Edge's own default) - the same rule as opening the item in Edge.
 * @param {{edge: {mode: 'inherit' | 'never' | 'always', profile: string | null}}} item
 * @param {{edgeProfile: string | null}} device
 * @returns {string | null}
 */
export function pageEdgeProfile(item, device) {
  const r = effectiveEdge({ edge: { mode: 'always', profile: item.edge?.profile ?? null } }, { openInEdge: false }, device.edgeProfile);
  return r.profile;
}
