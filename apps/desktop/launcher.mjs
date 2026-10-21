// @ts-check
// Launcher for the desktop app (D48). Electron downloads its binary lazily and reads only
// `electron_config_cache`, so the cache variables are set BEFORE electron is loaded, and every
// child process inherits them. Nothing is written to %LOCALAPPDATA%.
//
//   node launcher.mjs [app args]   run the app (dev), e.g. --smoke, --hidden, --data-dir=<dir>
//   node launcher.mjs --package    stage the app and build the portable `dir` target

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fruitIcon } from './lib/icon.js';

const here = import.meta.dirname;
const repoRoot = path.resolve(here, '..', '..');
const cacheDir = path.join(repoRoot, '.cache', 'electron');
mkdirSync(cacheDir, { recursive: true });
// Tools electron-builder downloads into the cache (e.g. its icon tool) are CommonJS; the repo's root
// package.json says "type": "module", which would otherwise apply to them. This stops the lookup.
const cacheRoot = path.dirname(cacheDir);
if (!existsSync(path.join(cacheRoot, 'package.json'))) writeFileSync(path.join(cacheRoot, 'package.json'), '{"private": true, "type": "commonjs"}\n');

// 1. Environment first (ESM hoists imports, so electron is only loaded below, via require).
process.env.electron_config_cache = cacheDir;
process.env.ELECTRON_CACHE = cacheDir;
process.env.ELECTRON_BUILDER_CACHE = cacheDir;
delete process.env.ELECTRON_RUN_AS_NODE;

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);

/** @returns {string} absolute path of electron.exe (downloads it into the cache on first use) */
function electronPath() {
  return require('electron');
}

/**
 * Copy the app into a staging folder that mirrors the repo layout (apps/desktop/*, packages/core/*)
 * so the relative imports of the dev tree keep working inside the asar. Test files are left out.
 * @param {string} stage
 */
function stageApp(stage) {
  rmSync(stage, { recursive: true, force: true });
  const desktopOut = path.join(stage, 'apps', 'desktop');
  const coreOut = path.join(stage, 'packages', 'core');
  mkdirSync(desktopOut, { recursive: true });
  mkdirSync(coreOut, { recursive: true });
  for (const dir of ['main', 'lib', 'ui']) cpSync(path.join(here, dir), path.join(desktopOut, dir), { recursive: true });
  cpSync(path.join(here, 'preload.cjs'), path.join(desktopOut, 'preload.cjs'));
  cpSync(path.join(here, 'package.json'), path.join(desktopOut, 'package.json'));
  const coreSrc = path.join(repoRoot, 'packages', 'core');
  for (const f of readdirSync(coreSrc)) {
    if (f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'fixtures.js') cpSync(path.join(coreSrc, f), path.join(coreOut, f));
  }
  cpSync(path.join(coreSrc, 'package.json'), path.join(coreOut, 'package.json'));
  // the generated app icon (no binary asset is committed)
  mkdirSync(path.join(stage, 'build'), { recursive: true });
  writeFileSync(path.join(stage, 'build', 'icon.png'), fruitIcon(256));
  const own = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));
  const electronVersion = JSON.parse(readFileSync(path.join(repoRoot, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  writeFileSync(
    path.join(stage, 'package.json'),
    JSON.stringify(
      {
        name: 'fruitery',
        productName: 'Fruitery',
        version: own.version,
        description: own.description,
        type: 'module',
        main: 'apps/desktop/main/main.js',
        author: 'Fruitery',
        devDependencies: { electron: electronVersion },
      },
      null,
      2,
    ) + '\n',
  );
}

if (argv.includes('--package')) {
  const exe = electronPath(); // make sure the binary is in node_modules/electron/dist
  const stage = path.join(repoRoot, '.cache', 'stage');
  stageApp(stage);
  const cli = path.join(repoRoot, 'node_modules', 'electron-builder', 'cli.js');
  const distDir = path.dirname(exe);
  const electronVersion = JSON.parse(readFileSync(path.join(repoRoot, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  const r = spawnSync(
    process.execPath,
    [cli, '--win', 'dir', '--x64', '--config', 'electron-builder.yml', `-c.electronDist=${distDir}`, `-c.electronVersion=${electronVersion}`, '--publish', 'never'],
    { cwd: here, stdio: 'inherit', env: process.env },
  );
  process.exit(r.status ?? 1);
}

const exe = electronPath();
if (!existsSync(exe)) {
  console.error('Electron binary not found at the expected location.');
  process.exit(1);
}
const appArgs = [...argv];
if (appArgs.includes('--smoke') && !appArgs.some((a) => a.startsWith('--data-dir='))) {
  // the smoke run never touches the real development data: it gets its own folder, wiped for step 1
  const smokeData = path.join(tmpdir(), 'fruitery-smoke-data');
  if (!appArgs.includes('--smoke-step=2')) rmSync(smokeData, { recursive: true, force: true });
  appArgs.push(`--data-dir=${smokeData}`);
}
const child = spawn(exe, [here, ...appArgs], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
