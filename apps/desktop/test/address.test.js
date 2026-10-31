// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress, addressErrorText, createClickDecider, wrapDotCom } from '../lib/address.js';

const ok = (/** @type {string} */ t) => {
  const r = normalizeAddress(t);
  assert.equal(r.ok, true, `${t} -> ${JSON.stringify(r)}`);
  return /** @type {{ok: true, url: string}} */ (r).url;
};
const bad = (/** @type {unknown} */ t, /** @type {string} */ error) => assert.deepEqual(normalizeAddress(t), { ok: false, error }, String(t));

test('a bare host gets https:// (with path, port and query kept)', () => {
  assert.equal(ok('example.com'), 'https://example.com/');
  assert.equal(ok('example.com/path?q=1#h'), 'https://example.com/path?q=1#h');
  assert.equal(ok('localhost:3000'), 'https://localhost:3000/');
  assert.equal(ok('127.0.0.1:8080/x'), 'https://127.0.0.1:8080/x');
  assert.equal(ok('www.Example.COM'), 'https://www.example.com/');
  assert.equal(ok('intranet'), 'https://intranet/');
});

test('http and https addresses are accepted as typed, trimmed and normalised', () => {
  assert.equal(ok('  http://example.com/a  '), 'http://example.com/a');
  assert.equal(ok('HTTPS://EXAMPLE.COM/A'), 'https://example.com/A');
  assert.equal(ok('http://localhost:8080'), 'http://localhost:8080/');
});

test('other schemes are refused whatever they look like', () => {
  for (const t of ['javascript:alert(1)', 'JavaScript:alert(1)', 'mailto:a@example.com', 'file:///C:/Windows/win.ini', 'ftp://example.com/x', 'data:text/html,hi', 'about:blank', 'chrome://settings', 'vbscript:x', 'view-source:https://example.com']) {
    bad(t, 'scheme');
  }
});

test('empty, blank, non-string, spaced and control-character input is refused; so is a bare scheme', () => {
  bad('', 'empty');
  bad('   ', 'empty');
  bad(undefined, 'empty');
  bad(42, 'empty');
  bad('a b.com', 'invalid');
  bad('example.com/a b', 'invalid');
  bad('example.com\u0000x', 'invalid');
  bad('https://', 'invalid');
  bad('http://', 'invalid');
  bad('x'.repeat(2049), 'too-long');
});

test('every refusal has a message', () => {
  for (const e of /** @type {const} */ (['empty', 'too-long', 'invalid', 'scheme'])) assert.ok(addressErrorText(e).length > 5);
});

test('wrapDotCom wraps the host as www.<host>.com (Ctrl+Enter), keeping a path/query/hash', () => {
  assert.equal(wrapDotCom('example'), 'www.example.com');
  assert.equal(wrapDotCom('example/path?q=1#h'), 'www.example.com/path?q=1#h');
  assert.equal(wrapDotCom('  example  '), 'www.example.com'); // trimmed
  // scheme is preserved and the host wrapped inside it
  assert.equal(wrapDotCom('http://example/a'), 'http://www.example.com/a');
  assert.equal(wrapDotCom('https://example'), 'https://www.example.com');
});

test('wrapDotCom is idempotent for an already-wrapped host and strips an existing www./.com before wrapping', () => {
  assert.equal(wrapDotCom('www.example.com'), 'www.example.com');
  assert.equal(wrapDotCom('www.example.com/x'), 'www.example.com/x');
  assert.equal(wrapDotCom('example.com'), 'www.example.com');
  assert.equal(wrapDotCom('www.example'), 'www.example.com');
  assert.equal(wrapDotCom('WWW.Example.COM'), 'www.Example.com'); // case of the core label is kept
});

test('wrapDotCom leaves input with no host token unchanged', () => {
  assert.equal(wrapDotCom(''), '');
  assert.equal(wrapDotCom('   '), '');
  assert.equal(wrapDotCom('http://'), 'http://'); // nothing after the scheme to wrap
  assert.equal(wrapDotCom('http:///path'), 'http:///path'); // host part is empty
  assert.equal(wrapDotCom(42), '');
});

/** A fake clock-driven timer. */
function fakeTimers() {
  /** @type {{fn: () => void, at: number, id: number, live: boolean}[]} */
  const timers = [];
  let now = 0;
  let nextId = 1;
  return {
    setTimer: (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
      const t = { fn, at: now + ms, id: nextId++, live: true };
      timers.push(t);
      return t.id;
    },
    clearTimer: (/** @type {number} */ id) => { const t = timers.find((x) => x.id === id); if (t) t.live = false; },
    advance(/** @type {number} */ ms) {
      now += ms;
      for (const t of timers) if (t.live && t.at <= now) { t.live = false; t.fn(); }
    },
  };
}

test('one click settles as single after the window; two clicks inside it are one double click and no single', () => {
  const ft = fakeTimers();
  /** @type {string[]} */ const log = [];
  const d = createClickDecider({ onSingle: (k) => log.push(`single:${k}`), onDouble: (k) => log.push(`double:${k}`), windowMs: 250, ...ft });
  d.click('p1');
  assert.equal(d.pendingKey(), 'p1');
  ft.advance(249);
  assert.deepEqual(log, []);
  ft.advance(1);
  assert.deepEqual(log, ['single:p1']);
  assert.equal(d.pendingKey(), null);
  d.click('p1');
  ft.advance(100);
  d.click('p1');
  ft.advance(1000);
  assert.deepEqual(log, ['single:p1', 'double:p1']);
});

test('a third click starts over; a click on another pane settles the first as single at once', () => {
  const ft = fakeTimers();
  /** @type {string[]} */ const log = [];
  const d = createClickDecider({ onSingle: (k) => log.push(`single:${k}`), onDouble: (k) => log.push(`double:${k}`), ...ft });
  d.click('p1');
  d.click('p1');
  d.click('p1');
  ft.advance(300);
  assert.deepEqual(log, ['double:p1', 'single:p1']);
  log.length = 0;
  d.click('p1');
  d.click('p2');
  assert.deepEqual(log, ['single:p1']);
  ft.advance(300);
  assert.deepEqual(log, ['single:p1', 'single:p2']);
});

test('cancel drops a pending click', () => {
  const ft = fakeTimers();
  /** @type {string[]} */ const log = [];
  const d = createClickDecider({ onSingle: (k) => log.push(k), onDouble: (k) => log.push(k), ...ft });
  d.click('p1');
  d.cancel();
  ft.advance(1000);
  assert.deepEqual(log, []);
  assert.equal(d.pendingKey(), null);
});
