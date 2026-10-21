// @ts-check
// Install the built desktop folder into a target directory, keeping its data.
//
//   npm run install:desktop -- --to <dir>
//
// - copies apps/desktop/release/win-unpacked/* into <dir>;
// - NEVER touches <dir>/data (logins, cache.json, device.json) or an existing <dir>/seed.local.json;
// - copies config/seed.local.json to <dir>/seed.local.json only when the target has none;
// - replaces the previous program files, but only in a folder that already holds Fruitery.exe (or is
//   empty), so a wrongly typed --to can never wipe an unrelated folder.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const KEEP = new Set(['data', 'seed.local.json']);
const EXE = 'Fruitery.exe';

/**
 * @param {{from: string, to: string, seedFrom?: string | null, log?: (line: string) => void}} p
 * @returns {{exe: string, seeded: boolean}}
 */
export function install({ from, to, seedFrom = null, log = () => {} }) {
  if (!fs.existsSync(path.join(from, EXE))) {
    throw new Error(`Nothing to install: ${path.join(from, EXE)} is missing. Run "npm run package -w apps/desktop" first.`);
  }
  const target = path.resolve(to);
  if (path.resolve(from) === target) throw new Error('The target is the build folder itself.');
  fs.mkdirSync(target, { recursive: true });
  const existing = fs.readdirSync(target);
  const isInstall = existing.includes(EXE);
  const stray = existing.filter((n) => !KEEP.has(n));
  if (!isInstall && stray.length > 0) {
    throw new Error(`Refusing to install into ${target}: it is not empty and holds no ${EXE}.`);
  }
  if (isInstall) {
    for (const name of stray) {
      try {
        fs.rmSync(path.join(target, name), { recursive: true, force: true });
      } catch (err) {
        throw new Error(`Could not replace ${name}: close Fruitery first (${/** @type {Error} */ (err).message})`);
      }
    }
  }
  for (const name of fs.readdirSync(from)) {
    if (KEEP.has(name)) continue;
    fs.cpSync(path.join(from, name), path.join(target, name), { recursive: true });
  }
  let seeded = false;
  const seedTarget = path.join(target, 'seed.local.json');
  if (seedFrom && fs.existsSync(seedFrom) && !fs.existsSync(seedTarget)) {
    fs.copyFileSync(seedFrom, seedTarget);
    seeded = true;
  }
  log(`Installed to ${target}${seeded ? ' (personal seed copied)' : ''}`);
  return { exe: path.join(target, EXE), seeded };
}

/** @param {string[]} argv @returns {string | null} */
export function parseTo(argv) {
  const i = argv.findIndex((a) => a === '--to' || a.startsWith('--to='));
  if (i < 0) return null;
  const a = argv[i];
  const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[i + 1];
  return v && !v.startsWith('--') ? v : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(import.meta.dirname, '..');
  const to = parseTo(process.argv.slice(2));
  if (!to) {
    console.error('Usage: npm run install:desktop -- --to <target folder>');
    process.exit(2);
  }
  try {
    const { exe } = install({
      from: path.join(root, 'apps', 'desktop', 'release', 'win-unpacked'),
      to,
      seedFrom: path.join(root, 'config', 'seed.local.json'),
      log: console.log,
    });
    console.log(exe);
  } catch (err) {
    console.error(/** @type {Error} */ (err).message);
    process.exit(1);
  }
}
