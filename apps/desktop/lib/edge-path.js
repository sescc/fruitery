// @ts-check
// Where Microsoft Edge lives, and its argument list. Pure (no fs access).

import path from 'node:path';

/**
 * Candidate msedge.exe paths from the environment, `%ProgramFiles(x86)%` first (Edge's usual place).
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function edgeCandidates(env) {
  /** @type {string[]} */
  const out = [];
  for (const key of ['ProgramFiles(x86)', 'ProgramFiles']) {
    const base = env[key];
    if (typeof base === 'string' && base !== '') {
      const p = path.win32.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

/**
 * Arguments for msedge.exe: an optional profile directory, then the URL. The caller must spawn
 * without a shell, so the URL is only ever one argument.
 * @param {string | null} profile
 * @param {string} url
 * @returns {string[]}
 */
export function edgeArgs(profile, url) {
  return [...(profile ? [`--profile-directory=${profile}`] : []), url];
}
