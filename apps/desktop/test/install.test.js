// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, parseTo } from '../../../scripts/install-desktop.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fruitery-install-'));

/** A fake build folder. @param {string} version */
function build(version) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'Fruitery.exe'), `exe ${version}`);
  fs.mkdirSync(path.join(dir, 'resources'));
  fs.writeFileSync(path.join(dir, 'resources', `only-${version}.txt`), version);
  return dir;
}

test('a first install copies the build', () => {
  const to = path.join(tmp(), 'app');
  const r = install({ from: build('1'), to });
  assert.equal(fs.readFileSync(r.exe, 'utf8'), 'exe 1');
  assert.ok(fs.existsSync(path.join(to, 'resources', 'only-1.txt')));
});

test('a second install over it keeps data/ intact (marker file) and replaces the program files', () => {
  const to = tmp();
  install({ from: build('1'), to });
  fs.mkdirSync(path.join(to, 'data', 'profile'), { recursive: true });
  fs.writeFileSync(path.join(to, 'data', 'marker.txt'), 'keep me');
  fs.writeFileSync(path.join(to, 'data', 'profile', 'Cookies'), 'login');
  install({ from: build('2'), to });
  assert.equal(fs.readFileSync(path.join(to, 'data', 'marker.txt'), 'utf8'), 'keep me');
  assert.equal(fs.readFileSync(path.join(to, 'data', 'profile', 'Cookies'), 'utf8'), 'login');
  assert.equal(fs.readFileSync(path.join(to, 'Fruitery.exe'), 'utf8'), 'exe 2');
  assert.ok(!fs.existsSync(path.join(to, 'resources', 'only-1.txt')), 'stale files of the old version are removed');
  assert.ok(fs.existsSync(path.join(to, 'resources', 'only-2.txt')));
});

test('a build that contains a data/ folder never overwrites the target data', () => {
  const to = tmp();
  install({ from: build('1'), to });
  fs.mkdirSync(path.join(to, 'data'));
  fs.writeFileSync(path.join(to, 'data', 'marker.txt'), 'keep me');
  const from = build('2');
  fs.mkdirSync(path.join(from, 'data'));
  fs.writeFileSync(path.join(from, 'data', 'marker.txt'), 'from the build');
  install({ from, to });
  assert.equal(fs.readFileSync(path.join(to, 'data', 'marker.txt'), 'utf8'), 'keep me');
});

test('the personal seed is copied only when the target has none', () => {
  const to = tmp();
  const seed = path.join(tmp(), 'seed.local.json');
  fs.writeFileSync(seed, '{"a":1}');
  assert.equal(install({ from: build('1'), to, seedFrom: seed }).seeded, true);
  assert.equal(fs.readFileSync(path.join(to, 'seed.local.json'), 'utf8'), '{"a":1}');
  fs.writeFileSync(path.join(to, 'seed.local.json'), '{"edited":true}');
  assert.equal(install({ from: build('2'), to, seedFrom: seed }).seeded, false);
  assert.equal(fs.readFileSync(path.join(to, 'seed.local.json'), 'utf8'), '{"edited":true}');
  // no seed file at all is fine
  assert.equal(install({ from: build('1'), to: tmp(), seedFrom: path.join(tmp(), 'missing.json') }).seeded, false);
});

test('refuses a non-empty folder that is not an install, and a missing build', () => {
  const to = tmp();
  fs.writeFileSync(path.join(to, 'precious.txt'), 'do not delete');
  assert.throws(() => install({ from: build('1'), to }), /not empty/);
  assert.equal(fs.readFileSync(path.join(to, 'precious.txt'), 'utf8'), 'do not delete');
  assert.throws(() => install({ from: tmp(), to: tmp() }), /Nothing to install/);
});

test('parseTo reads --to <dir> and --to=<dir>', () => {
  assert.equal(parseTo(['--to', 'D:\\apps\\f']), 'D:\\apps\\f');
  assert.equal(parseTo(['--to=D:\\apps\\f']), 'D:\\apps\\f');
  assert.equal(parseTo([]), null);
  assert.equal(parseTo(['--to']), null);
  assert.equal(parseTo(['--to', '--other']), null);
});
