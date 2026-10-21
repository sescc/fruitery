// @ts-check
// A generated app icon (a small fruit) as PNG bytes, so no binary asset is committed. Pure.

import { deflateSync, crc32 } from 'node:zlib';

/**
 * @param {string} type
 * @param {Uint8Array} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, 8 + data.length);
  return out;
}

/**
 * Encode RGBA pixels as a PNG.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba width*height*4 bytes
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new RangeError('bad-pixel-buffer');
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A red fruit with a green leaf on a transparent background.
 * @param {number} size
 * @returns {Buffer} PNG bytes
 */
export function fruitIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size * 0.56;
  const r = size * 0.38;
  /** @param {number} x @param {number} y @param {number} red @param {number} green @param {number} blue @param {number} cover */
  const blend = (x, y, red, green, blue, cover) => {
    if (cover <= 0) return;
    const i = (y * size + x) * 4;
    const a = Math.min(1, cover);
    const prev = px[i + 3] / 255;
    const outA = a + prev * (1 - a);
    for (const [k, v] of [[0, red], [1, green], [2, blue]]) {
      px[i + k] = Math.round((v * a + px[i + k] * prev * (1 - a)) / (outA || 1));
    }
    px[i + 3] = Math.round(outA * 255);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px0 = x + 0.5;
      const py0 = y + 0.5;
      // body
      const d = Math.hypot(px0 - cx, py0 - cy);
      blend(x, y, 214, 48, 49, r - d + 0.5);
      // highlight
      const h = Math.hypot(px0 - (cx - r * 0.35), py0 - (cy - r * 0.35));
      blend(x, y, 255, 255, 255, (r * 0.22 - h + 0.5) * 0.35);
      // leaf: an ellipse tilted up-right from the top of the body
      const lx = px0 - (cx + r * 0.3);
      const ly = py0 - (cy - r * 1.05);
      const ex = (lx * 0.8 - ly * 0.6) / (r * 0.55);
      const ey = (lx * 0.6 + ly * 0.8) / (r * 0.22);
      blend(x, y, 46, 160, 67, (1 - Math.hypot(ex, ey)) * r * 0.22 + 0.5);
    }
  }
  return encodePng(size, size, px);
}
