// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync, crc32 } from 'node:zlib';
import { encodePng, fruitIcon } from '../lib/icon.js';

test('encodePng writes a valid PNG: signature, IHDR, a decodable IDAT and correct CRCs', () => {
  const px = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]);
  const png = encodePng(2, 1, px);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let off = 8;
  /** @type {Buffer[]} */
  const idat = [];
  const types = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString('ascii');
    const data = png.subarray(off + 8, off + 8 + len);
    assert.equal(png.readUInt32BE(off + 8 + len), crc32(png.subarray(off + 4, off + 8 + len)) >>> 0, `crc of ${type}`);
    types.push(type);
    if (type === 'IHDR') {
      assert.equal(data.readUInt32BE(0), 2);
      assert.equal(data.readUInt32BE(4), 1);
    }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
  const raw = inflateSync(Buffer.concat(idat));
  assert.deepEqual([...raw], [0, 255, 0, 0, 255, 0, 255, 0, 128]);
});

test('encodePng rejects a pixel buffer of the wrong size', () => {
  assert.throws(() => encodePng(2, 2, new Uint8Array(3)), RangeError);
});

test('fruitIcon makes a PNG of the right size with an opaque centre and a transparent corner', () => {
  const png = fruitIcon(32);
  assert.equal(png.readUInt32BE(16), 32);
  assert.equal(png.readUInt32BE(20), 32);
  const idat = png.subarray(png.indexOf('IDAT') + 4, png.indexOf('IEND') - 8);
  const raw = inflateSync(idat);
  const px = (/** @type {number} */ x, /** @type {number} */ y) => raw.subarray(y * (32 * 4 + 1) + 1 + x * 4, y * (32 * 4 + 1) + 1 + x * 4 + 4);
  assert.equal(px(16, 18)[3], 255);
  assert.equal(px(0, 0)[3], 0);
});
