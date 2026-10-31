// @ts-check
// The HTTP disk-cache cap (D43, revised). A per-PC value in device.json, clamped to a safe range.
// Lowering it only affects Chromium's HTTP/code cache, not cookies or site storage (logins stay).
// Pure: no Electron, no fs.

/** Default cap in MB (lowered from the original 500). */
export const DEFAULT_DISK_CACHE_MB = 200;
/** Smallest allowed cap in MB (below this, sites re-fetch too much). */
export const MIN_DISK_CACHE_MB = 50;
/** Largest allowed cap in MB. */
export const MAX_DISK_CACHE_MB = 1024;

/**
 * Clamp a disk-cache cap (MB) to the allowed range; non-numbers fall back to `fallback`.
 * @param {unknown} mb
 * @param {number} [fallback]
 * @returns {number} a whole number of MB in [MIN, MAX]
 */
export function clampDiskCacheMB(mb, fallback = DEFAULT_DISK_CACHE_MB) {
  const n = typeof mb === 'number' && Number.isFinite(mb) ? mb : fallback;
  return Math.min(MAX_DISK_CACHE_MB, Math.max(MIN_DISK_CACHE_MB, Math.round(n)));
}

/**
 * The cap in bytes for Chromium's `--disk-cache-size` switch.
 * @param {unknown} mb
 * @returns {number}
 */
export function diskCacheBytes(mb) {
  return clampDiskCacheMB(mb) * 1024 * 1024;
}
