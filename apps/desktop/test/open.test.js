// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpener } from '../main/open.js';
import { parseArgs, resolveDataDir } from '../lib/args.js';
import { partitionFor, optOutFor, SHARED_PARTITION } from '../lib/partition.js';
import { shortcutFor } from '../lib/shortcuts.js';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files' };

function fake({ edgeExists = true } = {}) {
  /** @type {any[]} */ const spawned = [];
  /** @type {string[]} */ const external = [];
  /** @type {string[]} */ const paths = [];
  const opener = createOpener({
    spawn: (file, args, options) => {
      spawned.push({ file, args, options });
      return { on() {}, unref() {} };
    },
    existsSync: (p) => edgeExists && p === EDGE,
    env,
    shell: {
      openExternal: async (u) => { external.push(u); },
      openPath: async (p) => { paths.push(p); return p.includes('missing') ? 'not found' : ''; },
    },
  });
  return { opener, spawned, external, paths };
}

test('Edge is spawned without a shell, detached, with the profile flag before the url', async () => {
  const { opener, spawned } = fake();
  const r = await opener.openInEdge('https://example.com/a', 'Profile 2');
  assert.deepEqual(r, { ok: true, via: 'exe' });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].file, EDGE);
  assert.deepEqual(spawned[0].args, ['--profile-directory=Profile 2', 'https://example.com/a']);
  assert.equal(spawned[0].options.shell, false);
  assert.equal(spawned[0].options.detached, true);
  assert.equal(spawned[0].options.stdio, 'ignore');
});

test('a url containing & is passed as one argument, never through a shell', async () => {
  const { opener, spawned } = fake();
  const url = 'https://example.com/?a=1&b=2&calc.exe';
  await opener.openInEdge(url, null);
  assert.deepEqual(spawned[0].args, [url]);
  assert.equal(spawned[0].options.shell, false);
});

test('a blank profile means Edge\'s own default: no flag', async () => {
  const { opener, spawned } = fake();
  await opener.openInEdge('https://example.com/', null);
  assert.deepEqual(spawned[0].args, ['https://example.com/']);
});

test('without an Edge exe the microsoft-edge: protocol is used', async () => {
  const { opener, spawned, external } = fake({ edgeExists: false });
  const r = await opener.openInEdge('https://example.com/x', null);
  assert.deepEqual(r, { ok: true, via: 'protocol' });
  assert.equal(spawned.length, 0);
  assert.deepEqual(external, ['microsoft-edge:https://example.com/x']);
});

test('non-http(s) urls are never opened, by any route', async () => {
  const { opener, spawned, external } = fake();
  for (const bad of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-settings:', 'cmd /c calc', 'ftp://x.example/', 'microsoft-edge:https://x.example', '']) {
    assert.deepEqual(await opener.openInEdge(bad, null), { ok: false, reason: 'not-http' }, bad);
    assert.deepEqual(await opener.openExternal(bad), { ok: false }, bad);
  }
  assert.equal(spawned.length, 0);
  assert.equal(external.length, 0);
});

test('openExternal opens an http(s) link in the default browser', async () => {
  const { opener, external } = fake();
  assert.deepEqual(await opener.openExternal('https://example.com/new-tab'), { ok: true });
  assert.deepEqual(external, ['https://example.com/new-tab']);
});

test('a control character in the Edge profile is refused', async () => {
  const { opener, spawned } = fake();
  assert.deepEqual(await opener.openInEdge('https://example.com/', 'Pro\nfile'), { ok: false, reason: 'bad-profile' });
  assert.deepEqual(await opener.openInEdge('https://example.com/', 'x'.repeat(101)), { ok: false, reason: 'bad-profile' });
  assert.equal(spawned.length, 0);
});

test('openProgram reports a missing program', async () => {
  const { opener, paths } = fake();
  assert.deepEqual(await opener.openProgram('C:\\Apps\\thing.exe'), { ok: true });
  assert.deepEqual(await opener.openProgram('C:\\missing.exe'), { ok: false });
  assert.deepEqual(await opener.openProgram('  '), { ok: false });
  assert.equal(paths.length, 2);
});

test('parseArgs reads the flags and ignores the rest', () => {
  assert.deepEqual(parseArgs(['electron.exe', '.', '--smoke', '--hidden', '--no-local-seed', '--data-dir=D:\\x y', '--inspect=1']), {
    smoke: true, smokeStep: 1, shots: null, hidden: true, noLocalSeed: true, dataDir: 'D:\\x y',
  });
  assert.deepEqual(parseArgs([]), { smoke: false, smokeStep: 1, shots: null, hidden: false, noLocalSeed: false, dataDir: null });
  assert.equal(parseArgs(['--smoke-step=2']).smokeStep, 2);
  assert.equal(parseArgs(['--smoke-step=7']).smokeStep, 1);
  assert.equal(parseArgs(['--shots=D:\\shots']).shots, 'D:\\shots');
  assert.equal(parseArgs(['--data-dir=']).dataDir, null);
});

test('resolveDataDir: packaged -> next to the exe; dev -> apps/desktop/data; override wins', () => {
  assert.equal(resolveDataDir({ packaged: true, execPath: 'D:\\Apps\\Fruitery\\Fruitery.exe', appDir: 'X', override: null }), 'D:\\Apps\\Fruitery\\data');
  assert.equal(resolveDataDir({ packaged: false, execPath: 'E', appDir: 'D:\\repo\\apps\\desktop', override: null }), 'D:\\repo\\apps\\desktop\\data');
  assert.ok(resolveDataDir({ packaged: true, execPath: 'D:\\Apps\\F.exe', appDir: 'X', override: 'D:\\tmp\\smoke' }).endsWith('smoke'));
});

test('partitions: shared by default, isolated per item', () => {
  assert.equal(partitionFor({ id: 'a' }), SHARED_PARTITION);
  assert.equal(partitionFor({ id: 'a', isolate: false }), 'persist:fruitery');
  assert.equal(partitionFor({ id: 'a', isolate: true }), 'persist:fruitery-a');
});

test('opt-out: shared partition collects hosts of opted-out, non-isolated items only', () => {
  const items = [
    { id: '1', persistSessionCookies: true, url: 'https://keep.example.com/' },
    { id: '2', persistSessionCookies: false, url: 'https://www.private.example.org/x/{YYYY}' },
    { id: '3', persistSessionCookies: false, isolate: true, url: 'https://iso.example.net/' },
    { id: '4', persistSessionCookies: false, deleted: true, url: 'https://gone.example.net/' },
    { id: '5', persistSessionCookies: false, url: null, fallbackUrl: 'https://fb.example.io/' },
  ];
  assert.deepEqual(optOutFor(SHARED_PARTITION, items), { all: false, hosts: ['private.example.org', 'fb.example.io'] });
});

test('opt-out: an isolated partition is opted out as a whole by its own item\'s flag', () => {
  const items = [{ id: '3', persistSessionCookies: false, isolate: true }, { id: '6', persistSessionCookies: true, isolate: true }];
  assert.deepEqual(optOutFor('persist:fruitery-3', items), { all: true, hosts: [] });
  assert.deepEqual(optOutFor('persist:fruitery-6', items), { all: false, hosts: [] });
  assert.deepEqual(optOutFor('persist:fruitery-unknown', items), { all: false, hosts: [] });
});

test('shortcuts: Ctrl+1..9, Ctrl+Tab, Ctrl+Shift+Tab, F3; nothing else', () => {
  const k = (/** @type {any} */ o) => shortcutFor({ type: 'keyDown', control: true, ...o });
  assert.deepEqual(k({ key: '1' }), { type: 'workspace', index: 0 });
  assert.deepEqual(k({ key: '9' }), { type: 'workspace', index: 8 });
  assert.deepEqual(k({ key: 'Tab' }), { type: 'item', delta: 1 });
  assert.deepEqual(k({ key: 'Tab', shift: true }), { type: 'item', delta: -1 });
  assert.equal(k({ key: '0' }), null);
  assert.equal(k({ key: 'a' }), null);
  assert.equal(k({ key: '2', alt: true }), null);
  assert.equal(k({ key: '2', meta: true }), null);
  assert.equal(k({ key: '2', shift: true }), null);
  assert.equal(shortcutFor({ type: 'keyUp', control: true, key: '2' }), null);
  assert.equal(shortcutFor({ type: 'keyDown', control: false, key: '2' }), null);
  // F3 edits the focused entry; it must come from a plain key press
  assert.deepEqual(shortcutFor({ type: 'keyDown', key: 'F3' }), { type: 'edit', source: 'site' });
  assert.deepEqual(shortcutFor({ type: 'keyDown', key: 'F3' }, 'ui'), { type: 'edit', source: 'ui' });
  for (const mod of [{ control: true }, { alt: true }, { meta: true }, { shift: true }]) assert.equal(shortcutFor({ type: 'keyDown', key: 'F3', ...mod }), null, JSON.stringify(mod));
  assert.equal(shortcutFor({ type: 'keyUp', key: 'F3' }), null);
  assert.equal(shortcutFor({ type: 'keyDown', key: 'F4' }), null);
});
