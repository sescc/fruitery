// @ts-check
// Command-line flags and the portable data folder (D36). Pure.

import path from 'node:path';

/**
 * Flags understood by the app: `--smoke`, `--smoke-step=2`, `--shots=<dir>`, `--hidden`,
 * `--no-local-seed`, `--data-dir=<dir>`. Everything else (the app path, Chromium switches) is ignored.
 * @param {string[]} argv
 * @returns {{smoke: boolean, smokeStep: number, shots: string | null, hidden: boolean, noLocalSeed: boolean, dataDir: string | null}}
 */
export function parseArgs(argv) {
  /** @param {string} name @returns {string | null} */
  const value = (name) => {
    const a = argv.find((x) => x.startsWith(`${name}=`));
    const v = a ? a.slice(name.length + 1).trim() : '';
    return v === '' ? null : v;
  };
  const step = Number(value('--smoke-step'));
  return {
    smoke: argv.includes('--smoke'),
    smokeStep: step === 2 ? 2 : 1,
    shots: value('--shots'),
    hidden: argv.includes('--hidden'),
    noLocalSeed: argv.includes('--no-local-seed'),
    dataDir: value('--data-dir'),
  };
}

/**
 * Where all app data lives.
 * - an explicit `--data-dir` wins (used by the smoke test and for verification);
 * - packaged: `<dir of the exe>\data`;
 * - development: `<repo>\apps\desktop\data` (git-ignored).
 * @param {{packaged: boolean, execPath: string, appDir: string, override: string | null}} p
 * @returns {string}
 */
export function resolveDataDir({ packaged, execPath, appDir, override }) {
  if (override) return path.resolve(override);
  if (packaged) return path.join(path.dirname(execPath), 'data');
  return path.join(appDir, 'data');
}
