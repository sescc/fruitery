// @ts-check
// Effects of "open": Edge, a native program, the default browser. No Electron import: `shell`,
// `spawn` and `existsSync` are injected, so the safety rules are unit tested.
//   - only http(s) URLs are ever opened;
//   - Edge is spawned WITHOUT a shell, so a URL containing & | ^ ... cannot inject a command.

import { edgeCandidates, edgeArgs } from '../lib/edge-path.js';
import { isHttpUrl } from '../lib/resolve-open.js';

/**
 * @typedef {object} OpenerDeps
 * @property {(file: string, args: string[], options: object) => {on: Function, unref: Function}} spawn
 * @property {(p: string) => boolean} existsSync
 * @property {Record<string, string | undefined>} env
 * @property {{openExternal: (url: string) => Promise<void>, openPath: (p: string) => Promise<string>}} shell
 */

/** @param {OpenerDeps} deps */
export function createOpener({ spawn, existsSync, env, shell }) {
  /**
   * Open a URL in Microsoft Edge with an optional profile directory.
   * @param {string} url
   * @param {string | null} profile
   * @returns {Promise<{ok: true, via: 'exe' | 'protocol'} | {ok: false, reason: 'not-http' | 'bad-profile' | 'failed'}>}
   */
  async function openInEdge(url, profile) {
    if (!isHttpUrl(url)) return { ok: false, reason: 'not-http' };
    if (profile !== null && (typeof profile !== 'string' || profile.length > 100 || /[\u0000-\u001f]/.test(profile))) {
      return { ok: false, reason: 'bad-profile' };
    }
    const exe = edgeCandidates(env).find((p) => existsSync(p));
    if (exe) {
      try {
        const child = spawn(exe, edgeArgs(profile, url), { shell: false, detached: true, stdio: 'ignore' });
        child.on('error', () => {});
        child.unref();
        return { ok: true, via: 'exe' };
      } catch {
        return { ok: false, reason: 'failed' };
      }
    }
    try {
      await shell.openExternal(`microsoft-edge:${url}`);
      return { ok: true, via: 'protocol' };
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }

  /**
   * Start a native program (or open a file) the owner configured on an item.
   * @param {string} programPath
   * @returns {Promise<{ok: boolean}>}
   */
  async function openProgram(programPath) {
    if (typeof programPath !== 'string' || programPath.trim() === '') return { ok: false };
    const err = await shell.openPath(programPath);
    return { ok: err === '' };
  }

  /**
   * Open a link in the system's default browser (site links that want a new tab).
   * @param {string} url
   * @returns {Promise<{ok: boolean}>}
   */
  async function openExternal(url) {
    if (!isHttpUrl(url)) return { ok: false };
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  return { openInEdge, openProgram, openExternal };
}
