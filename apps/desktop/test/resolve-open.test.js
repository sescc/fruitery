// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpen, isHttpUrl } from '../lib/resolve-open.js';
import { edgeCandidates, edgeArgs } from '../lib/edge-path.js';
import { needsConfirm } from '../lib/program-approval.js';

const NOW = Date.UTC(2026, 9, 31, 16, 30); // 2026-11-01 01:30 in Tokyo (UTC+9); Oct 31 in UTC
const settings = /** @type {any} */ ({ timezone: 'UTC', googleEmail: null, updatedAt: 0 });
const ws = (/** @type {boolean} */ openInEdge = false) => /** @type {any} */ ({ id: 'w', openInEdge });
/** @param {any} over */
const item = (over = {}) => /** @type {any} */ ({
  id: 'i', workspaceId: 'w', kind: 'web', url: 'https://example.com/x', appPath: null, fallbackUrl: null,
  edge: { mode: 'inherit', profile: null }, ...over,
});
const device = (/** @type {string | null} */ edgeProfile = null) => ({ edgeProfile });

test('a plain web item opens in a pane', () => {
  assert.deepEqual(resolveOpen(item(), ws(), settings, device(), NOW, false), { kind: 'pane', url: 'https://example.com/x' });
});

test('placeholders are expanded: date tokens use the settings timezone', () => {
  const it = item({ url: 'https://example.com/{YYYY}{MM}' });
  assert.deepEqual(resolveOpen(it, ws(), settings, device(), NOW, false), { kind: 'pane', url: 'https://example.com/202610' });
  const tokyo = { ...settings, timezone: 'Asia/Tokyo' };
  assert.deepEqual(resolveOpen(it, ws(), tokyo, device(), NOW, false), { kind: 'pane', url: 'https://example.com/202611' });
});

test('blocked: missing Google email, unknown token, no url, bad timezone', () => {
  const g = item({ url: 'https://calendar.example.com/?authuser={googleEmail}' });
  assert.deepEqual(resolveOpen(g, ws(), settings, device(), NOW, false), { kind: 'blocked', reason: 'missing-google-email', tokens: ['googleEmail'] });
  const withEmail = { ...settings, googleEmail: 'me@example.com' };
  assert.deepEqual(resolveOpen(g, ws(), withEmail, device(), NOW, false), { kind: 'pane', url: 'https://calendar.example.com/?authuser=me%40example.com' });
  const u = item({ url: 'https://example.com/{nope}' });
  assert.deepEqual(resolveOpen(u, ws(), settings, device(), NOW, false), { kind: 'blocked', reason: 'unknown-token', tokens: ['nope'] });
  assert.deepEqual(resolveOpen(item({ url: null }), ws(), settings, device(), NOW, false), { kind: 'blocked', reason: 'no-url' });
  assert.deepEqual(resolveOpen(item({ url: '  ' }), ws(), settings, device(), NOW, false), { kind: 'blocked', reason: 'no-url' });
  assert.deepEqual(resolveOpen(item({ url: 'https://example.com/{YYYY}' }), ws(), { ...settings, timezone: 'Nope/Zone' }, device(), NOW, false), { kind: 'blocked', reason: 'invalid-timezone' });
});

test('a non-http url never resolves to an open action', () => {
  assert.deepEqual(resolveOpen(item({ url: 'file:///C:/x' }), ws(), settings, device(), NOW, false), { kind: 'blocked', reason: 'no-url' });
  assert.deepEqual(resolveOpen(item({ url: 'javascript:alert(1)' }), ws(), settings, device(), NOW, false), { kind: 'blocked', reason: 'no-url' });
});

test('edge: item profile beats device profile; device profile when the item has none; none -> null', () => {
  const always = (/** @type {string | null} */ profile) => item({ edge: { mode: 'always', profile } });
  assert.deepEqual(resolveOpen(always('Profile 3'), ws(), settings, device('Profile 2'), NOW, false), { kind: 'edge', url: 'https://example.com/x', profile: 'Profile 3' });
  assert.deepEqual(resolveOpen(always(null), ws(), settings, device('Profile 2'), NOW, false), { kind: 'edge', url: 'https://example.com/x', profile: 'Profile 2' });
  assert.deepEqual(resolveOpen(always(null), ws(), settings, device(null), NOW, false), { kind: 'edge', url: 'https://example.com/x', profile: null });
});

test('edge: inherit follows the workspace, never wins over a workspace default', () => {
  assert.equal(resolveOpen(item(), ws(true), settings, device(), NOW, false).kind, 'edge');
  assert.equal(resolveOpen(item({ edge: { mode: 'never', profile: null } }), ws(true), settings, device(), NOW, false).kind, 'pane');
});

test('app: present program -> app; missing program -> its fallback url in a pane', () => {
  const app = item({ kind: 'app', url: null, appPath: 'C:\\Apps\\thing.exe', fallbackUrl: 'https://thing.example.com/learn' });
  assert.deepEqual(resolveOpen(app, ws(), settings, device(), NOW, true), { kind: 'app', path: 'C:\\Apps\\thing.exe' });
  assert.deepEqual(resolveOpen(app, ws(), settings, device(), NOW, false), { kind: 'pane', url: 'https://thing.example.com/learn' });
  // a missing program without a fallback has nothing to open
  assert.deepEqual(resolveOpen({ ...app, fallbackUrl: null }, ws(), settings, device(), NOW, false), { kind: 'blocked', reason: 'no-url' });
  // the fallback is a pane even when the workspace prefers Edge
  assert.equal(resolveOpen(app, ws(true), settings, device(), NOW, false).kind, 'pane');
});

test('isHttpUrl accepts only http(s) with a host', () => {
  assert.equal(isHttpUrl('https://example.com'), true);
  assert.equal(isHttpUrl('http://127.0.0.1:8787/x?y=1&z=2'), true);
  for (const bad of ['file:///x', 'ftp://example.com', 'javascript:1', 'microsoft-edge:https://x', 'about:blank', 'https://', '', null, undefined, 5, 'x'.repeat(9000)]) {
    assert.equal(isHttpUrl(bad), false, String(bad));
  }
});

test('edgeCandidates: Program Files (x86) first, then Program Files, from the env', () => {
  const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files' };
  assert.deepEqual(edgeCandidates(env), [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]);
  assert.deepEqual(edgeCandidates({ ProgramFiles: 'C:\\Program Files' }), ['C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']);
  assert.deepEqual(edgeCandidates({}), []);
  assert.deepEqual(edgeCandidates({ ProgramFiles: 'C:\\P', 'ProgramFiles(x86)': 'C:\\P' }).length, 1);
});

test('edgeArgs: the profile flag only when set; a url with & stays one argument', () => {
  assert.deepEqual(edgeArgs(null, 'https://a.example/?x=1&y=2'), ['https://a.example/?x=1&y=2']);
  assert.deepEqual(edgeArgs('Profile 2', 'https://a.example/'), ['--profile-directory=Profile 2', 'https://a.example/']);
});

test('D89: only an app action can need confirmation; a missing program is the plain fallback, with no question', () => {
  const app = item({ kind: 'app', url: null, appPath: 'C:\\Apps\\Tool.exe', fallbackUrl: 'https://example.com/web' });
  const present = resolveOpen(app, ws(), settings, device(), NOW, true);
  assert.deepEqual(present, { kind: 'app', path: 'C:\\Apps\\Tool.exe' });
  assert.equal(needsConfirm(present.kind === 'app' ? present.path : '', []), true);
  assert.equal(needsConfirm(present.kind === 'app' ? present.path : '', ['c:/apps/tool.exe']), false);
  const missing = resolveOpen(app, ws(), settings, device(), NOW, false);
  assert.deepEqual(missing, { kind: 'pane', url: 'https://example.com/web' }, 'no app action, so nothing to confirm');
  assert.equal(resolveOpen(item({ kind: 'app', url: null, appPath: 'C:\\Apps\\Tool.exe' }), ws(), settings, device(), NOW, false).kind, 'blocked', 'missing program and no fallback');
});