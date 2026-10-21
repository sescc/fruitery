// @ts-check
// Build the static assets of the web component into apps/web/dist (no bundler):
//   - copy apps/web/public/**                      (the PWA)
//   - copy packages/core/*.js to dist/core/        (minus *.test.js and fixtures.js)
//   - generate dist/icons/icon-192.png and icon-512.png (fruit basket, hand-encoded PNG)
//   - stamp dist/sw.js with a content-hash version and the core file list
// The output is deterministic: a second run produces byte-identical files.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DIST = join(ROOT, 'apps', 'web', 'dist');
const PUBLIC_DIR = join(ROOT, 'apps', 'web', 'public');
const CORE_DIR = join(ROOT, 'packages', 'core');

export const ICON_SIZES = Object.freeze([192, 512]);

// ----- icon: a fruit basket from simple shapes -----

/** @typedef {[number, number, number]} Rgb */

/** @type {Record<string, Rgb>} */
const PALETTE = {
  background: [0x3b, 0x8f, 0x5a],
  basket: [0xe3, 0xa8, 0x57],
  rim: [0xcf, 0x8f, 0x3d],
  weave: [0xb9, 0x79, 0x2f],
  fruit: [0xe5, 0x53, 0x3d],
  leaf: [0xbf, 0xe2, 0x7a],
  stem: [0x6b, 0x4a, 0x2b],
};

/**
 * Colour of the icon at a point of the unit square. Content stays inside the maskable safe zone
 * (a circle of radius 0.4 around the centre).
 * @param {number} x 0..1
 * @param {number} y 0..1
 * @returns {Rgb}
 */
function colourAt(x, y) {
  // rim: rounded rectangle x 0.20..0.80, y 0.52..0.585, corner radius 0.03
  {
    const r = 0.03;
    const cx = Math.min(Math.max(x, 0.2 + r), 0.8 - r);
    const cy = Math.min(Math.max(y, 0.52 + r), 0.585 - r);
    if (Math.hypot(x - cx, y - cy) <= r) return PALETTE.rim;
  }
  // body: trapezoid narrowing downwards, with a simple weave
  if (y >= 0.56 && y <= 0.82) {
    const half = 0.27 - 0.08 * ((y - 0.56) / 0.26);
    if (Math.abs(x - 0.5) <= half) {
      const onRow = Math.abs(y - 0.66) <= 0.008 || Math.abs(y - 0.74) <= 0.008;
      const onCol = [-0.1, 0, 0.1].some((d) => Math.abs(x - (0.5 + d)) <= 0.007);
      return onRow || onCol ? PALETTE.weave : PALETTE.basket;
    }
  }
  // leaf and stem
  if (Math.hypot(x - 0.58, y - 0.235) <= 0.04) return PALETTE.leaf;
  if (x >= 0.485 && x <= 0.515 && y >= 0.2 && y <= 0.27) return PALETTE.stem;
  // the fruit, partly hidden by the basket
  if (Math.hypot(x - 0.5, y - 0.4) <= 0.17) return PALETTE.fruit;
  return PALETTE.background;
}

/**
 * Render the icon as straight RGBA pixels, antialiased with 4x4 supersampling.
 * @param {number} size
 * @returns {Buffer}
 */
export function renderIcon(size) {
  const SS = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colourAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = SS * SS;
      const o = (py * size + px) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * @param {string} type 4 ASCII letters
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode RGBA pixels as a PNG (8-bit RGBA, no interlace, filter 0).
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgba
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ----- build -----

/**
 * @param {string} dir
 * @returns {string[]} files below dir, as sorted '/'-separated relative paths
 */
function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/** @param {string} name */
const isCoreRuntimeFile = (name) => name.endsWith('.js') && !name.endsWith('.test.js') && name !== 'fixtures.js';

/**
 * Build the assets.
 * @param {{outDir?: string}} [opts] output directory, default apps/web/dist
 * @returns {{outDir: string, version: string, files: string[]}}
 */
export function build(opts = {}) {
  const outDir = resolve(opts.outDir ?? DEFAULT_DIST);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  cpSync(PUBLIC_DIR, outDir, { recursive: true });

  mkdirSync(join(outDir, 'core'), { recursive: true });
  for (const name of readdirSync(CORE_DIR).filter(isCoreRuntimeFile).sort()) {
    cpSync(join(CORE_DIR, name), join(outDir, 'core', name));
  }

  mkdirSync(join(outDir, 'icons'), { recursive: true });
  for (const size of ICON_SIZES) {
    writeFileSync(join(outDir, 'icons', `icon-${size}.png`), encodePng(size, size, renderIcon(size)));
  }

  // version = hash of every file, with the service worker still in its unstamped template form
  const hash = createHash('sha256');
  for (const f of listFiles(outDir)) {
    hash.update(f).update('\0').update(readFileSync(join(outDir, f))).update('\0');
  }
  const version = hash.digest('hex').slice(0, 12);

  const swPath = join(outDir, 'sw.js');
  const extra = listFiles(join(outDir, 'core')).map((f) => `/core/${f}`);
  let sw = readFileSync(swPath, 'utf8');
  for (const marker of ["'__BUILD_VERSION__'", '/*__SHELL_EXTRA__*/ []']) {
    if (!sw.includes(marker)) throw new Error(`sw.js lacks the build marker ${marker}`);
  }
  sw = sw.replace("'__BUILD_VERSION__'", JSON.stringify(version)).replace('/*__SHELL_EXTRA__*/ []', JSON.stringify(extra));
  writeFileSync(swPath, sw);

  return { outDir, version, files: listFiles(outDir) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!existsSync(PUBLIC_DIR)) throw new Error('apps/web/public is missing');
  const r = build();
  console.log(`web build ${r.version}: ${r.files.length} files -> ${relative(ROOT, r.outDir)}`);
}
