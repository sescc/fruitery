// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptIconUrl, decodeDataUrl, sniffImage, pickIcoEntry, parseIconLinks, isOwnSite, iconFileName, faviconIcoOf, MAX_ICON_BYTES } from '../lib/favicon.js';
import { encodePng } from '../lib/icon.js';

const png = () => new Uint8Array(encodePng(2, 2, new Uint8Array(16).fill(255)));

/** An ICO file with the given entries. data is the raw image bytes of each entry. */
function ico(/** @type {{width: number, data: Uint8Array}[]} */ entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach((e, i) => {
    const at = 6 + i * 16;
    head[at] = e.width >= 256 ? 0 : e.width;
    head[at + 1] = head[at];
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(e.data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += e.data.length;
  });
  return new Uint8Array(Buffer.concat([head, ...entries.map((e) => Buffer.from(e.data))]));
}

test('acceptIconUrl: http(s) and base64 image data URLs only', () => {
  assert.equal(acceptIconUrl('https://example.com/favicon.ico'), true);
  assert.equal(acceptIconUrl('http://example.com/i.png'), true);
  assert.equal(acceptIconUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(acceptIconUrl('data:image/x-icon;base64,AAABAA=='), true);
  for (const bad of ['javascript:alert(1)', 'file:///C:/x.png', 'ftp://example.com/x.ico', 'data:text/html;base64,PGI+', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png,%89PNG', '', 'x', 42, null, undefined]) {
    assert.equal(acceptIconUrl(bad), false, String(bad));
  }
  assert.equal(acceptIconUrl(`data:image/png;base64,${'A'.repeat(MAX_ICON_BYTES * 2)}`), false, 'an oversized data URL is refused before decoding');
});

test('decodeDataUrl returns the bytes, or null for anything else or an oversized image', () => {
  const p = png();
  const url = `data:image/png;base64,${Buffer.from(p).toString('base64')}`;
  assert.deepEqual([...(decodeDataUrl(url) ?? [])], [...p]);
  assert.equal(decodeDataUrl('https://example.com/a.png'), null);
  assert.equal(decodeDataUrl('data:image/png;base64,'), null);
});

test('sniffImage tells the formats by their first bytes', () => {
  assert.equal(sniffImage(png()), 'png');
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'jpeg');
  assert.equal(sniffImage(ico([{ width: 16, data: png() }])), 'ico');
  assert.equal(sniffImage(new TextEncoder().encode('GIF89a......')), 'gif');
  assert.equal(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'webp');
  assert.equal(sniffImage(new TextEncoder().encode('  <svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(sniffImage(new TextEncoder().encode('<?xml version="1.0"?><svg></svg>')), 'svg');
  assert.equal(sniffImage(new TextEncoder().encode('<!doctype html><html>')), 'unknown');
  assert.equal(sniffImage(new Uint8Array(0)), 'unknown');
  assert.equal(sniffImage(new Uint8Array([0, 0, 1, 0, 0, 0])), 'unknown', 'an ICO header with zero images is not an icon');
});

test('pickIcoEntry: the smallest entry that is at least 32 px wide, else the largest; an embedded PNG is flagged', () => {
  const file = ico([{ width: 16, data: png() }, { width: 48, data: new Uint8Array(40).fill(7) }, { width: 32, data: png() }, { width: 0, data: new Uint8Array(50).fill(9) }]);
  const e = pickIcoEntry(file);
  assert.equal(e?.width, 32);
  assert.equal(e?.isPng, true);
  assert.equal(pickIcoEntry(ico([{ width: 16, data: png() }, { width: 24, data: new Uint8Array(30).fill(1) }]))?.width, 24);
  const only256 = pickIcoEntry(ico([{ width: 0, data: new Uint8Array(30).fill(1) }]));
  assert.equal(only256?.width, 256);
  assert.equal(only256?.isPng, false);
});

test('pickIcoEntry: not an ICO, a truncated directory and entries pointing outside the file are refused', () => {
  assert.equal(pickIcoEntry(png()), null);
  assert.equal(pickIcoEntry(new Uint8Array([0, 0, 1, 0, 3, 0, 1, 2])), null);
  const file = ico([{ width: 16, data: png() }]);
  const broken = Buffer.from(file);
  broken.writeUInt32LE(9999, 6 + 12); // offset beyond the end
  assert.equal(pickIcoEntry(new Uint8Array(broken)), null);
});

test('parseIconLinks: icon links in order, resolved, deduplicated; svg, mask icons and non-icon links skipped', () => {
  const html = `<html><head>
    <link rel="stylesheet" href="/s.css">
    <link rel="icon" type="image/svg+xml" href="/i.svg">
    <link rel="shortcut icon" href="/fav.ico?v=2&amp;x=1">
    <LINK REL='icon' HREF='img/p.png' sizes="32x32">
    <link rel="apple-touch-icon" href="https://cdn.example.net/t.png">
    <link rel="mask-icon" href="/mask.svg">
    <link href="/late.ico" rel=icon>
    <link rel="icon" href="/fav.ico?v=2&x=1">
    <link rel="icon" href="javascript:alert(1)">
    <link rel="icon" href="">
  </head></html>`;
  assert.deepEqual(parseIconLinks(html, 'https://example.com/app/index.html'), [
    'https://example.com/fav.ico?v=2&x=1',
    'https://example.com/app/img/p.png',
    'https://cdn.example.net/t.png',
    'https://example.com/late.ico',
  ]);
  assert.deepEqual(parseIconLinks('', 'https://example.com/'), []);
  assert.deepEqual(parseIconLinks(html, 'file:///C:/x.html'), []);
});

test('isOwnSite: same host, www, or sub-domain of the other; a sign-in provider or a different site is not', () => {
  assert.equal(isOwnSite('https://example.com/a', 'https://example.com/b'), true);
  assert.equal(isOwnSite('https://www.example.com/', 'https://example.com/'), true);
  assert.equal(isOwnSite('https://app.example.com/', 'https://example.com/'), true);
  assert.equal(isOwnSite('https://example.com/', 'https://app.example.com/'), true);
  assert.equal(isOwnSite('https://accounts.google.com/', 'https://calendar.google.com/'), false);
  assert.equal(isOwnSite('https://accounts.example.net/', 'https://example.com/'), false);
  assert.equal(isOwnSite('https://evilexample.com/', 'https://example.com/'), false, 'a lookalike is not a sub-domain');
  assert.equal(isOwnSite('https://com/', 'https://example.com/'), false);
  assert.equal(isOwnSite('file:///C:/x', 'https://example.com/'), false);
  assert.equal(isOwnSite('https://example.com/', null), false);
  assert.equal(isOwnSite(undefined, undefined), false);
});

test('iconFileName: safe ids are used as they are; anything that could carry a path becomes a hash', () => {
  assert.equal(iconFileName('a1'), 'a1.png');
  assert.equal(iconFileName('3f2b8c1e-aaaa-bbbb-cccc-123456789abc'), '3f2b8c1e-aaaa-bbbb-cccc-123456789abc.png');
  for (const evil of ['..\\..\\x', '../x', 'a/b', 'a\\b', 'C:x', 'a.b', '', 'x'.repeat(65), 'a b', 'Ã¼']) {
    const n = iconFileName(evil);
    assert.match(n, /^h-[0-9a-f]{24}\.png$/, evil);
  }
  assert.notEqual(iconFileName('a/b'), iconFileName('a\\b'));
  assert.equal(iconFileName('a/b'), iconFileName('a/b'));
});

test('faviconIcoOf: the origin /favicon.ico, http(s) pages only', () => {
  assert.equal(faviconIcoOf('https://example.com/a/b?q=1'), 'https://example.com/favicon.ico');
  assert.equal(faviconIcoOf('http://localhost:8080/x'), 'http://localhost:8080/favicon.ico');
  assert.equal(faviconIcoOf('file:///x'), null);
});
