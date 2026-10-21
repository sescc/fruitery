// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidD1Id, main, renderConfig } from '../../../scripts/wrangler-config.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TEMPLATE = readFileSync(join(REPO, 'apps', 'web', 'wrangler.toml'), 'utf8');
const ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** @param {(root: string) => void} fn a temp repo root holding a copy of the committed wrangler.toml */
function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'fruitery-wc-'));
  try {
    mkdirSync(join(root, 'apps', 'web'), { recursive: true });
    mkdirSync(join(root, 'config'), { recursive: true });
    cpSync(join(REPO, 'apps', 'web', 'wrangler.toml'), join(root, 'apps', 'web', 'wrangler.toml'));
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const outOf = (/** @type {string} */ root) => join(root, 'apps', 'web', '.local', 'wrangler.toml');

test('the committed template keeps the placeholder and no real id', () => {
  assert.ok(TEMPLATE.includes('database_id = "REPLACE_WITH_D1_ID"'));
});

test('renderConfig rewrites main, assets directory and migrations_dir to resolve from apps/web/.local', () => {
  const out = renderConfig(TEMPLATE, { d1DatabaseId: ID });
  assert.match(out, /^main = "\.\.\/src\/worker\.js"$/m);
  assert.match(out, /^directory = "\.\.\/dist"$/m);
  assert.match(out, /^migrations_dir = "\.\.\/migrations"$/m);
  assert.equal(out.includes('"src/worker.js"'), false);
  assert.equal(out.includes('"./dist"'), false);
  // everything else is untouched
  for (const line of ['name = "fruitery"', 'keep_vars = true', 'binding = "ASSETS"', 'run_worker_first = ["/api/*"]', 'binding = "DB"', 'database_name = "fruitery"']) {
    assert.ok(out.includes(line), line);
  }
});

test('renderConfig inserts the id and the placeholder is gone', () => {
  const out = renderConfig(TEMPLATE, { d1DatabaseId: ID });
  assert.match(out, new RegExp(`^database_id = "${ID}"$`, 'm'));
  assert.equal(out.includes('REPLACE_WITH_D1_ID'), false);
});

test('renderConfig rejects a malformed id and a template that lacks expected lines', () => {
  for (const bad of ['', 'not-a-uuid', ID.slice(1), `${ID}0`, '$&$&$&', ' ' + ID]) {
    assert.throws(() => renderConfig(TEMPLATE, { d1DatabaseId: bad }), /UUID/);
  }
  assert.throws(() => renderConfig(TEMPLATE.replace('REPLACE_WITH_D1_ID', 'x'), { d1DatabaseId: ID }), /placeholder/);
  assert.throws(() => renderConfig(TEMPLATE.replace('main = "src/worker.js"', 'main = "x.js"'), { d1DatabaseId: ID }), /main/);
});

test('isValidD1Id accepts UUIDs in either case only', () => {
  assert.equal(isValidD1Id(ID), true);
  assert.equal(isValidD1Id(ID.toUpperCase()), true);
  assert.equal(isValidD1Id(null), false);
  assert.equal(isValidD1Id(5), false);
});

test('main reads config/cloudflare.local.json and writes apps/web/.local/wrangler.toml', () => {
  withRoot((root) => {
    writeFileSync(join(root, 'config', 'cloudflare.local.json'), JSON.stringify({ d1DatabaseId: ID }));
    const { outPath } = main({ root, env: {} });
    assert.equal(outPath, outOf(root));
    const text = readFileSync(outPath, 'utf8');
    assert.ok(text.includes(`database_id = "${ID}"`));
    assert.ok(text.includes('main = "../src/worker.js"'));
  });
});

test('env D1_DATABASE_ID beats the file', () => {
  withRoot((root) => {
    writeFileSync(join(root, 'config', 'cloudflare.local.json'), JSON.stringify({ d1DatabaseId: ID }));
    main({ root, env: { D1_DATABASE_ID: OTHER_ID } });
    const text = readFileSync(outOf(root), 'utf8');
    assert.ok(text.includes(OTHER_ID));
    assert.equal(text.includes(ID), false);
  });
});

test('a blank env value falls back to the file', () => {
  withRoot((root) => {
    writeFileSync(join(root, 'config', 'cloudflare.local.json'), JSON.stringify({ d1DatabaseId: ID }));
    main({ root, env: { D1_DATABASE_ID: '  ' } });
    assert.ok(readFileSync(outOf(root), 'utf8').includes(ID));
  });
});

test('a missing id is an error naming both sources, and nothing is written', () => {
  withRoot((root) => {
    for (const setup of [() => {}, () => writeFileSync(join(root, 'config', 'cloudflare.local.json'), '{"d1DatabaseId": "  "}'), () => writeFileSync(join(root, 'config', 'cloudflare.local.json'), '{}')]) {
      setup();
      assert.throws(() => main({ root, env: {} }), (/** @type {Error} */ e) => /D1_DATABASE_ID/.test(e.message) && /cloudflare\.local\.json/.test(e.message));
    }
    assert.equal(existsSync(outOf(root)), false);
  });
});

test('a malformed id is an error naming both sources and never echoing the value', () => {
  withRoot((root) => {
    const secret = 'super-secret-not-a-uuid';
    for (const opts of [{ env: { D1_DATABASE_ID: secret } }, { env: {}, file: secret }]) {
      if (opts.file) writeFileSync(join(root, 'config', 'cloudflare.local.json'), JSON.stringify({ d1DatabaseId: opts.file }));
      assert.throws(() => main({ root, env: opts.env }), (/** @type {Error} */ e) => /UUID/.test(e.message) && /D1_DATABASE_ID/.test(e.message) && /cloudflare\.local\.json/.test(e.message) && !e.message.includes(secret));
    }
    assert.equal(existsSync(outOf(root)), false);
  });
});

test('invalid JSON in the local file is an error that does not echo its contents', () => {
  withRoot((root) => {
    writeFileSync(join(root, 'config', 'cloudflare.local.json'), '{ nope secret-value');
    assert.throws(() => main({ root, env: {} }), (/** @type {Error} */ e) => /not valid JSON/.test(e.message) && !e.message.includes('secret-value'));
  });
});

test('the output path is git-ignored and the personal files are never committed', () => {
  const ignore = readFileSync(join(REPO, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.ok(ignore.includes('apps/web/.local/'), '.gitignore must list apps/web/.local/');
  assert.ok(ignore.includes('config/*.local.json'), '.gitignore must list config/*.local.json');
  // the example is committed, with a placeholder id
  const example = JSON.parse(readFileSync(join(REPO, 'config', 'cloudflare.example.json'), 'utf8'));
  assert.equal(example.d1DatabaseId, '00000000-0000-0000-0000-000000000000');
});

test('both workflows generate the config from the D1_DATABASE_ID secret, pass it to wrangler and pin the wrangler version', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'apps', 'web', 'package.json'), 'utf8'));
  const version = String(pkg.devDependencies.wrangler).replace(/^[\^~]/, '');
  for (const name of ['deploy', 'migrate']) {
    const yml = readFileSync(join(REPO, '.github', 'workflows', `${name}.yml`), 'utf8');
    assert.ok(yml.includes('run: npm run wrangler:config'), `${name}: generates the config`);
    assert.ok(yml.includes('D1_DATABASE_ID: ${{ secrets.D1_DATABASE_ID }}'), `${name}: id from the secret`);
    assert.match(yml, /command: .*--config \.local\/wrangler\.toml/, `${name}: passes --config`);
    assert.ok(yml.includes(`wranglerVersion: "${version}"`), `${name}: wrangler pinned to ${version}`);
  }
});

test('the root scripts use the generated config for every remote wrangler command and the committed one for local', () => {
  const scripts = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts;
  for (const name of ['deploy:web', 'migrate:remote', 'seed:remote']) {
    assert.ok(scripts[name].includes('npm run wrangler:config'), name);
    assert.ok(scripts[name].includes('--config .local/wrangler.toml'), name);
  }
  assert.ok(scripts['deploy:web'].startsWith('npm run build:web'));
  for (const name of ['migrate:local', 'seed:local']) assert.equal(scripts[name].includes('--config'), false, name);
});