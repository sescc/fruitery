// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createIcons } from '../main/icons.js';
import { fetchLimited } from '../main/icon-fetch.js';

const DIR = path.join('data', 'icons');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);

function setup({ fetchMap = /** @type {Record<string, any>} */ ({}), convertOk = (/** @type {Uint8Array} */ _b) => true, writeFails = false } = {}) {
  /** @type {Map<string, Uint8Array>} */ const files = new Map();
  const fs = /** @type {any} */ ({
    existsSync: (/** @type {string} */ p) => files.has(p),
    mkdirSync: () => {},
    readFileSync: (/** @type {string} */ p) => {
      const f = files.get(p);
      if (!f) throw new Error('ENOENT');
      return Buffer.from(f);
    },
    writeFileSync: (/** @type {string} */ p, /** @type {Uint8Array} */ b) => {
      if (writeFails) throw new Error('ENOSPC');
      files.set(p, b);
    },
    renameSync: (/** @type {string} */ a, /** @type {string} */ b) => {
      files.set(b, /** @type {Uint8Array} */ (files.get(a)));
      files.delete(a);
    },
    unlinkSync: (/** @type {string} */ p) => {
      if (!files.delete(p)) throw new Error('ENOENT');
    },
  });
  /** @type {string[]} */ const fetched = [];
  /** @type {number} */ let changes = 0;
  const icons = createIcons({
    dir: DIR,
    fs,
    fetch: async (_ses, url, options) => {
      fetched.push(url);
      const hit = fetchMap[url];
      return hit ? { bytes: hit.bytes ?? new Uint8Array([1, 2, 3]), url: hit.url ?? url } : null;
    },
    convert: async (bytes) => (convertOk(bytes) ? PNG : null),
    onChange: () => { changes += 1; },
  });
  return { icons, files, fetched, changes: () => changes };
}

test('capture saves the first candidate that downloads and decodes, bumps the revision and tells the UI', async () => {
  const t = setup({ fetchMap: { 'https://a.example.com/i.ico': {}, 'https://a.example.com/j.png': {} } });
  const ok = await t.icons.capture('a1', ['https://a.example.com/missing.ico', 'https://a.example.com/i.ico', 'https://a.example.com/j.png'], null);
  assert.equal(ok, true);
  assert.deepEqual(t.fetched, ['https://a.example.com/missing.ico', 'https://a.example.com/i.ico']);
  assert.equal(t.files.has(path.join(DIR, 'a1.png')), true);
  assert.equal(t.files.has(path.join(DIR, 'a1.png.tmp')), false);
  assert.equal(t.icons.rev('a1'), 1);
  assert.equal(t.changes(), 1);
  assert.match(t.icons.dataUrl('a1') ?? '', /^data:image\/png;base64,/);
  assert.deepEqual(t.icons.revisions(['a1', 'a2']), { a1: 1 });
});

test('an undecodable candidate is skipped; when none works nothing is saved and the UI is not told', async () => {
  const t = setup({ fetchMap: { 'https://a.example.com/i.svg': {}, 'https://a.example.com/i.gif': {} }, convertOk: () => false });
  assert.equal(await t.icons.capture('a1', ['https://a.example.com/i.svg', 'https://a.example.com/i.gif'], null), false);
  assert.equal(t.icons.rev('a1'), 0);
  assert.equal(t.icons.dataUrl('a1'), null);
  assert.equal(t.changes(), 0);
  assert.equal(t.files.size, 0);
});

test('the same candidate list as last time is not downloaded again; force (Refresh icon) downloads anyway', async () => {
  const t = setup({ fetchMap: { 'https://a.example.com/i.ico': {} } });
  const list = ['https://a.example.com/i.ico'];
  await t.icons.capture('a1', list, null);
  await t.icons.capture('a1', list, null);
  assert.equal(t.fetched.length, 1);
  await t.icons.capture('a1', list, null, { force: true });
  assert.equal(t.fetched.length, 2);
  assert.equal(t.icons.rev('a1'), 2);
  // a failure is not retried on every navigation either
  const f = setup();
  await f.icons.capture('a1', ['https://a.example.com/none.ico'], null);
  await f.icons.capture('a1', ['https://a.example.com/none.ico'], null);
  assert.equal(f.fetched.length, 1);
});

test('only acceptable addresses are tried, at most three; a data URL is decoded without any download', async () => {
  const t = setup({ fetchMap: { 'https://a.example.com/4.png': {} } });
  const bad = ['javascript:alert(1)', 'file:///C:/x.png', 'ftp://a.example.com/x.ico'];
  assert.equal(await t.icons.capture('a1', bad, null), false);
  assert.equal(t.fetched.length, 0);
  assert.equal(await t.icons.capture('a1', ['https://a.example.com/1.png', 'https://a.example.com/2.png', 'https://a.example.com/3.png', 'https://a.example.com/4.png'], null), false);
  assert.equal(t.fetched.length, 3, 'the fourth candidate is never tried');
  const d = setup();
  const url = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;
  assert.equal(await d.icons.capture('a2', [url], null), true);
  assert.equal(d.fetched.length, 0);
});

test('a write failure leaves the letter in place and does not throw', async () => {
  const t = setup({ fetchMap: { 'https://a.example.com/i.ico': {} }, writeFails: true });
  assert.equal(await t.icons.capture('a1', ['https://a.example.com/i.ico'], null), false);
  assert.equal(t.icons.rev('a1'), 0);
  assert.equal(t.changes(), 0);
});

test('an id that could carry a path is stored under a hashed name inside the icons folder', async () => {
  const t = setup({ fetchMap: { 'https://a.example.com/i.ico': {} } });
  await t.icons.capture('..\\..\\evil', ['https://a.example.com/i.ico'], null);
  const names = [...t.files.keys()];
  assert.equal(names.length, 1);
  assert.equal(path.dirname(names[0]), DIR);
  assert.match(path.basename(names[0]), /^h-[0-9a-f]{24}\.png$/);
});

test('an icon from an earlier run is found on disk, and remove forgets it', async () => {
  const t = setup();
  t.files.set(path.join(DIR, 'old.png'), PNG);
  assert.equal(t.icons.rev('old'), 1);
  assert.deepEqual(t.icons.revisions(['old', 'none']), { old: 1 });
  assert.ok(t.icons.dataUrl('old'));
  t.icons.remove('old');
  assert.equal(t.icons.rev('old'), 0);
  assert.equal(t.icons.dataUrl('old'), null);
  assert.equal(t.files.size, 0);
  t.icons.remove('never-had-one'); // no throw
});

test('refresh uses the loaded page\'s icons when it has them', async () => {
  const t = setup({ fetchMap: { 'https://a.example.com/page.png': {} } });
  assert.equal(await t.icons.refresh('a1', { pageIcons: ['https://a.example.com/page.png'], homeUrl: 'https://a.example.com/x', ses: null }), true);
  assert.deepEqual(t.fetched, ['https://a.example.com/page.png']);
});

test('refresh without a loaded page reads the origin front page for <link rel=icon>, then /favicon.ico', async () => {
  const html = '<link rel="icon" href="/assets/app.png"><link rel="shortcut icon" href="https://cdn.example.net/x.ico">';
  const t = setup({
    fetchMap: {
      'https://a.example.com/': { bytes: new TextEncoder().encode(html), url: 'https://a.example.com/' },
      'https://a.example.com/favicon.ico': {},
    },
    convertOk: (b) => b.length === 3, // only the 3-byte "images" decode; the HTML page itself is not an image
  });
  const ok = await t.icons.refresh('a1', { pageIcons: [], homeUrl: 'https://a.example.com/deep/path?x=1', ses: null });
  assert.equal(ok, true);
  assert.deepEqual(t.fetched, ['https://a.example.com/', 'https://a.example.com/assets/app.png', 'https://cdn.example.net/x.ico', 'https://a.example.com/favicon.ico']);
});

test('refresh with nothing found, no web address, or a failing front page reports false', async () => {
  const t = setup();
  assert.equal(await t.icons.refresh('a1', { pageIcons: [], homeUrl: 'https://a.example.com/', ses: null }), false);
  assert.equal(await t.icons.refresh('a1', { pageIcons: [], homeUrl: null, ses: null }), false);
  assert.equal(await t.icons.refresh('a1', { pageIcons: [], homeUrl: 'file:///C:/x', ses: null }), false);
  assert.equal(t.icons.rev('a1'), 0);
});

// ---------------------------------------------------------------- fetchLimited

/** @param {any} body @param {object} [init] */
const fakeSes = (body, init = {}, url = '') => ({
  fetch: async (/** @type {string} */ u, /** @type {any} */ _opts) => {
    const res = new Response(body, init);
    if (url) Object.defineProperty(res, 'url', { value: url });
    else Object.defineProperty(res, 'url', { value: u });
    return res;
  },
});

test('fetchLimited returns the bytes and the final address of a small answer', async () => {
  const r = await fetchLimited(fakeSes(new Uint8Array([1, 2, 3])), 'https://example.com/i.ico');
  assert.deepEqual([...(r?.bytes ?? [])], [1, 2, 3]);
  assert.equal(r?.url, 'https://example.com/i.ico');
});

test('fetchLimited refuses a declared or actual size over the cap, and keeps the first bytes when truncating', async () => {
  const big = new Uint8Array(300);
  assert.equal(await fetchLimited(fakeSes(big, { headers: { 'content-length': '300' } }), 'https://example.com/i.ico', { maxBytes: 100 }), null);
  assert.equal(await fetchLimited(fakeSes(big), 'https://example.com/i.ico', { maxBytes: 100 }), null, 'over the cap with no length header');
  const cut = await fetchLimited(fakeSes(big), 'https://example.com/', { maxBytes: 100, truncate: true });
  assert.equal(cut?.bytes.length, 100);
});

test('fetchLimited: a failing status, a non-web address, a non-web redirect target or an error is null', async () => {
  assert.equal(await fetchLimited(fakeSes('x', { status: 404 }), 'https://example.com/i.ico'), null);
  assert.equal(await fetchLimited(fakeSes('x'), 'file:///C:/x.ico'), null);
  assert.equal(await fetchLimited(fakeSes('x', {}, 'file:///C:/x.ico'), 'https://example.com/i.ico'), null);
  assert.equal(await fetchLimited({ fetch: async () => { throw new Error('offline'); } }, 'https://example.com/i.ico'), null);
});

test('fetchLimited gives up after the timeout', async () => {
  const hang = { fetch: (/** @type {string} */ _u, /** @type {any} */ opts) => new Promise((_resolve, reject) => { opts.signal.addEventListener('abort', () => reject(new Error('aborted'))); }) };
  const t0 = Date.now();
  assert.equal(await fetchLimited(/** @type {any} */ (hang), 'https://example.com/i.ico', { timeoutMs: 30 }), null);
  assert.ok(Date.now() - t0 < 2000);
});
