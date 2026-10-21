// @ts-check
// Image bytes -> a 32 px PNG, with Electron's nativeImage (D116). nativeImage decodes PNG and JPEG
// from memory; an ICO is read here: an embedded PNG entry is used directly, a bitmap entry goes
// through a temporary .ico file that Windows decodes. GIF, WebP and SVG are not decodable, so the
// caller falls back to the next candidate or to the letter.

import path from 'node:path';
import { ICON_PX, pickIcoEntry, sniffImage } from '../lib/favicon.js';

/**
 * @param {object} deps
 * @param {any} deps.nativeImage        Electron's nativeImage module
 * @param {Pick<typeof import('node:fs'), 'mkdirSync' | 'writeFileSync' | 'unlinkSync'>} deps.fs
 * @param {string} deps.tmpDir          a folder for the temporary .ico (inside the data folder)
 * @returns {(bytes: Uint8Array) => Promise<Uint8Array | null>}
 */
export function createConverter({ nativeImage, fs, tmpDir }) {
  let counter = 0;
  return async (bytes) => {
    const kind = sniffImage(bytes);
    /** @type {any} */
    let img = null;
    if (kind === 'png' || kind === 'jpeg') {
      img = nativeImage.createFromBuffer(Buffer.from(bytes));
    } else if (kind === 'ico') {
      const entry = pickIcoEntry(bytes);
      if (entry?.isPng) {
        img = nativeImage.createFromBuffer(Buffer.from(bytes.subarray(entry.offset, entry.offset + entry.size)));
      }
      if (!img || img.isEmpty()) {
        const tmp = path.join(tmpDir, `.decode-${process.pid}-${counter++}.ico`);
        try {
          fs.mkdirSync(tmpDir, { recursive: true });
          fs.writeFileSync(tmp, bytes);
          img = nativeImage.createFromPath(tmp);
        } finally {
          try {
            fs.unlinkSync(tmp);
          } catch {
            // already gone
          }
        }
      }
    }
    if (!img || img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (!(width > 0 && height > 0)) return null;
    const resized = img.resize(width >= height ? { width: ICON_PX, quality: 'best' } : { height: ICON_PX, quality: 'best' });
    const png = resized.toPNG();
    return png && png.length > 0 ? new Uint8Array(png) : null;
  };
}
