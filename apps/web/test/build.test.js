// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { inflateSync } from 'node:zlib';
import { build } from '../../../scripts/build-web.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @param {string} dir @returns {Map<string, Buffer>} */
function snapshotDir(dir) {
  /** @type {Map<string, Buffer>} */
  const out = new Map();
  /** @param {string} d */
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p).split(sep).join('/'), readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

/** @param {(dirs: {a: string, b: string}) => void} fn */
function withTmp(fn) {
  const base = mkdtempSync(join(tmpdir(), 'fruitery-build-'));
  try {
    fn({ a: join(base, 'a'), b: join(base, 'b') });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test('dist contains the PWA, the core modules (no tests or fixtures) and the icons', () => {
  withTmp(({ a }) => {
    const { files } = build({ outDir: a });
    for (const f of ['index.html', 'app.js', 'view.js', 'editor.js', 'editor-model.js', 'styles.css', 'sw.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'core/index.js', 'core/schedule.js', 'core/time.js', 'core/url-tokens.js', 'core/model.js', 'core/sync.js', 'core/seed.js', 'core/removal.js']) {
      assert.ok(files.includes(f), `missing ${f}`);
    }
    assert.equal(files.some((f) => f.endsWith('.test.js') || f === 'core/fixtures.js'), false);
    // the Worker source never ships as an asset
    assert.equal(files.some((f) => f.startsWith('src/') || f.startsWith('migrations/')), false);
  });
});

test('the PNG icons have valid signatures, sizes and decodable pixel data', () => {
  withTmp(({ a }) => {
    build({ outDir: a });
    for (const size of [192, 512]) {
      const png = readFileSync(join(a, 'icons', `icon-${size}.png`));
      assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
      assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
      assert.equal(png[24], 8); // bit depth
      assert.equal(png[25], 6); // RGBA
      assert.equal(png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND');
      // collect IDAT and inflate: filter byte + RGBA per row
      const idat = [];
      for (let o = 8; o < png.length; ) {
        const len = png.readUInt32BE(o);
        if (png.subarray(o + 4, o + 8).toString('ascii') === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
        o += 12 + len;
      }
      const raw = inflateSync(Buffer.concat(idat));
      assert.equal(raw.length, size * (size * 4 + 1));
      // corner pixel is the opaque background green, the centre is not
      assert.deepEqual([...raw.subarray(1, 5)], [0x3b, 0x8f, 0x5a, 255]);
      const centre = (Math.floor(size / 2) * (size * 4 + 1)) + 1 + Math.floor(size / 2) * 4;
      assert.notDeepEqual([...raw.subarray(centre, centre + 3)], [0x3b, 0x8f, 0x5a]);
    }
  });
});

test('the service worker is stamped with a content-hash version and the core file list', () => {
  withTmp(({ a }) => {
    const { version } = build({ outDir: a });
    const sw = readFileSync(join(a, 'sw.js'), 'utf8');
    assert.match(version, /^[0-9a-f]{12}$/);
    assert.ok(sw.includes(`const VERSION = "${version}";`));
    assert.equal(sw.includes('__BUILD_VERSION__'), false);
    assert.equal(sw.includes('__SHELL_EXTRA__'), false);
    assert.ok(sw.includes('"/core/index.js"'));
    assert.equal(sw.includes('.test.js'), false);
  });
});

test('a second run is byte-identical', () => {
  withTmp(({ a, b }) => {
    const first = build({ outDir: a });
    const second = build({ outDir: b });
    assert.equal(first.version, second.version);
    const x = snapshotDir(a);
    const y = snapshotDir(b);
    assert.deepEqual([...x.keys()], [...y.keys()]);
    for (const [name, bytes] of x) assert.ok(bytes.equals(/** @type {Buffer} */ (y.get(name))), `${name} differs`);
    // rebuilding in place also cleans and reproduces the same version
    assert.equal(build({ outDir: a }).version, first.version);
  });
});

test('the manifest names the app Fruitery and points at the built icons', () => {
  withTmp(({ a }) => {
    const { files } = build({ outDir: a });
    const m = JSON.parse(readFileSync(join(a, 'manifest.webmanifest'), 'utf8'));
    assert.equal(m.name, 'Fruitery');
    assert.equal(m.short_name, 'Fruitery');
    assert.equal(m.display, 'standalone');
    assert.equal(m.start_url, '/');
    for (const icon of m.icons) assert.ok(files.includes(icon.src.slice(1)), icon.src);
    const html = readFileSync(join(a, 'index.html'), 'utf8');
    assert.match(html, /<title>Fruitery<\/title>/);
    assert.match(html, /rel="manifest"[^>]*crossorigin="use-credentials"/);
  });
});

test('every module the app imports is shipped and precached by the service worker', () => {
  withTmp(({ a }) => {
    const { files } = build({ outDir: a });
    const sw = readFileSync(join(a, 'sw.js'), 'utf8');
    for (const f of files.filter((p) => p.endsWith('.js') && p !== 'sw.js')) {
      assert.ok(sw.includes(`/${f}`), `sw.js must precache /${f}`);
    }
    // relative imports between the shipped modules all resolve to shipped files
    for (const f of files.filter((p) => p.endsWith('.js'))) {
      const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '';
      for (const m of readFileSync(join(a, f), 'utf8').matchAll(/from '(\.[^']+)'/g)) {
        const target = new URL(m[1], `file:///${dir}`).pathname.slice(1);
        assert.ok(files.includes(target), `${f} imports ${m[1]}, which is not shipped`);
      }
    }
  });
});

test('the page restricts only images (img-src), and the worker keeps site icons in a cache of their own', () => {
  withTmp(({ a }) => {
    build({ outDir: a });
    const html = readFileSync(join(a, 'index.html'), 'utf8');
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];
    assert.equal(csp, "img-src 'self' https: data:", 'only images are restricted: nothing else about the page changes');
    const sw = readFileSync(join(a, 'sw.js'), 'utf8');
    assert.ok(sw.includes("'fruitery-icons'"), 'icons have their own cache');
    assert.ok(!sw.includes('fruitery-icons-') && sw.includes('`fruitery-shell-${VERSION}`'), 'the shell cache has its own versioned name');
    assert.ok(sw.includes("url.pathname === '/favicon.ico'"), 'only /favicon.ico is intercepted across origins');
  });
});
