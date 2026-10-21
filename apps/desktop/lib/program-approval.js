// @ts-check
// D89: an item that came from another device must not silently start a program on this PC. The first time
// a given program path would start here, the owner is asked; approved paths are remembered per PC in
// device.json (`approvedPrograms`, never synced). Pure: the dialog and the launch live in main/ipc.js.

/** Longest program path that can be approved or remembered. */
export const MAX_PROGRAM_PATH = 1024;
/** At most this many approved paths are kept (the oldest are dropped). */
export const MAX_APPROVED = 500;

/**
 * The comparison form of a Windows path: slashes made backslashes, repeated backslashes collapsed (a
 * leading `\\` for network paths is kept), no trailing backslash, lower case.
 * @param {string} p
 * @returns {string}
 */
export function normalizeProgramPath(p) {
  let s = String(p).trim().replace(/\//g, '\\');
  const unc = s.startsWith('\\\\');
  s = s.replace(/\\{2,}/g, '\\');
  if (unc) s = `\\${s}`;
  if (s.length > 3 && s.endsWith('\\')) s = s.slice(0, -1);
  return s.toLowerCase();
}

/**
 * Clean `approvedPrograms` from whatever device.json holds: strings only, trimmed, not empty, not
 * longer than MAX_PROGRAM_PATH, no duplicates (same normalised path), at most MAX_APPROVED. Junk -> [].
 * @param {unknown} raw
 * @returns {string[]}
 */
export function sanitizeApprovedPrograms(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (s === '' || s.length > MAX_PROGRAM_PATH || /[\u0000-\u001f]/.test(s)) continue;
    const key = normalizeProgramPath(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(-MAX_APPROVED);
}

/**
 * Does starting this program need the owner's confirmation (it has not been approved on this PC)?
 * @param {string} programPath
 * @param {unknown} approved  the stored `approvedPrograms`
 * @returns {boolean}
 */
export function needsConfirm(programPath, approved) {
  if (typeof programPath !== 'string' || programPath.trim() === '') return true;
  const key = normalizeProgramPath(programPath);
  return !sanitizeApprovedPrograms(approved).some((a) => normalizeProgramPath(a) === key);
}

/**
 * The approved list with `programPath` added (unchanged when it is already there or cannot be stored).
 * @param {unknown} approved
 * @param {string} programPath
 * @returns {string[]}
 */
export function approveProgram(approved, programPath) {
  const list = sanitizeApprovedPrograms(approved);
  if (typeof programPath !== 'string') return list;
  return sanitizeApprovedPrograms([...list, programPath]);
}

/**
 * What to do after the question "Start this program?".
 * - Start -> launch;
 * - Don't start -> the item's fallback address in a pane when it has one, otherwise nothing.
 * @param {boolean} started  the owner chose Start
 * @param {boolean} hasFallback  the item has a fallback address
 * @returns {'launch' | 'fallback' | 'none'}
 */
export function afterAnswer(started, hasFallback) {
  if (started) return 'launch';
  return hasFallback ? 'fallback' : 'none';
}
