// @ts-check
// Portable paths (D36, rule 5). IMPORT THIS FIRST in main.js: the redirects below run as import-time
// side effects, before any session or window exists, so nothing is ever written to %APPDATA% or
// %LOCALAPPDATA%. No other module may call `app.getPath` or touch a session while it is being imported.

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, resolveDataDir } from '../lib/args.js';
import { clampDiskCacheMB, DEFAULT_DISK_CACHE_MB } from '../lib/disk-cache.js';

export const args = parseArgs(process.argv);

/** apps/desktop (development) */
const appDir = path.resolve(import.meta.dirname, '..');

/** All app data: `<exeDir>\data` when packaged, `apps/desktop/data` in development. */
export const dataDir = resolveDataDir({ packaged: app.isPackaged, execPath: process.execPath, appDir, override: args.dataDir });

/** Chromium's own profile (cookies, local storage, caches) lives in a sub-folder. */
export const profileDir = path.join(dataDir, 'profile');

app.setPath('appData', dataDir);
app.setPath('userData', profileDir);
app.setPath('sessionData', profileDir);
app.setPath('logs', path.join(dataDir, 'logs'));
app.setPath('crashDumps', path.join(dataDir, 'crashDumps'));

/**
 * Disk cache cap (D43, revised): a per-PC `diskCacheMB` in device.json (default 200, clamped
 * 50..1024), read synchronously here because the switch must be set before any session exists.
 * A missing or corrupt file falls back to the default. Changing the value takes effect next launch.
 * Only Chromium's HTTP/code cache is capped; cookies and site storage are untouched.
 */
function readDiskCacheMB() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'device.json'), 'utf8'));
    return clampDiskCacheMB(raw && typeof raw === 'object' ? raw.diskCacheMB : undefined);
  } catch {
    return DEFAULT_DISK_CACHE_MB;
  }
}
export const DISK_CACHE_MB = readDiskCacheMB();
export const DISK_CACHE_BYTES = DISK_CACHE_MB * 1024 * 1024;
app.commandLine.appendSwitch('disk-cache-size', String(DISK_CACHE_BYTES));

/** Where the personal seed lives: next to the exe when packaged, in config/ in development. */
export const localSeedPath = app.isPackaged
  ? path.join(path.dirname(process.execPath), 'seed.local.json')
  : path.resolve(appDir, '..', '..', 'config', 'seed.local.json');
