// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandUrl, findTokens, unknownTokens, TOKENS } from './url-tokens.js';
import { tokyo, utc } from './fixtures.js';

const TOKYO = 'Asia/Tokyo';
const SHOP = 'https://example.com/shop/{YYYY}{MM}';
const GCAL = 'https://calendar.google.com/calendar/r?authuser={googleEmail}';

test('Monthly rotating URL: monthly shop opened on 2026-11-01 in Asia/Tokyo -> .../202611', () => {
  const r = expandUrl(SHOP, tokyo('2026-11-01T09:00'), TOKYO, { googleEmail: null });
  assert.deepEqual(r, { url: 'https://example.com/shop/202611', unknown: [], missing: [] });
});

test('Month rollover: 2026-10-31T16:30Z is already November in Tokyo -> 202611', () => {
  assert.equal(expandUrl(SHOP, utc('2026-10-31T16:30'), TOKYO, null).url, 'https://example.com/shop/202611');
  assert.equal(expandUrl(SHOP, utc('2026-10-31T14:59'), TOKYO, null).url, 'https://example.com/shop/202610');
});

test('{DD} is zero-padded and {YYYY}{MM}{DD} all expand', () => {
  assert.equal(expandUrl('x/{YYYY}-{MM}-{DD}', tokyo('2026-03-05T12:00'), TOKYO, null).url, 'x/2026-03-05');
  assert.equal(expandUrl('x/{DD}', tokyo('2026-12-25T12:00'), TOKYO, null).url, 'x/25');
});

test('Tokens ignore the reset time: expansion uses the plain local date', () => {
  // 01:00 local; with a 04:00 reset the effective day would be the previous day, but expandUrl has no reset time.
  assert.equal(expandUrl('{YYYY}{MM}{DD}', tokyo('2026-11-01T01:00'), TOKYO, null).url, '20261101');
});

test('Google account email from settings is URL-encoded', () => {
  const r = expandUrl(GCAL, tokyo('2026-10-12T09:00'), TOKYO, { googleEmail: 'me@example.com' });
  assert.deepEqual(r, { url: 'https://calendar.google.com/calendar/r?authuser=me%40example.com', unknown: [], missing: [] });
  assert.equal(expandUrl('{googleEmail}', 0, TOKYO, { googleEmail: 'a+b@x.org' }).url, 'a%2Bb%40x.org');
});

test('Google email not configured: placeholder left unchanged and reported as missing', () => {
  for (const settings of [{ googleEmail: null }, { googleEmail: '' }, {}, null, undefined]) {
    const r = expandUrl(GCAL, tokyo('2026-10-12T09:00'), TOKYO, settings);
    assert.deepEqual(r, { url: GCAL, unknown: [], missing: ['googleEmail'] });
  }
});

test('An unknown token is left verbatim and reported in unknown', () => {
  const r = expandUrl('https://x.test/{YYYY}/{foo}/{foo}/{Bar}', tokyo('2026-10-12T09:00'), TOKYO, null);
  assert.equal(r.url, 'https://x.test/2026/{foo}/{foo}/{Bar}');
  assert.deepEqual(r.unknown, ['foo', 'Bar']);
  assert.deepEqual(r.missing, []);
});

test('Token names are case-sensitive and empty braces are unknown', () => {
  const r = expandUrl('{yyyy}{}', tokyo('2026-10-12T09:00'), TOKYO, null);
  assert.equal(r.url, '{yyyy}{}');
  assert.deepEqual(r.unknown, ['yyyy', '']);
});

test('A URL without tokens is unchanged', () => {
  const url = 'https://rewards.example.com/?a=1&b=2#frag';
  assert.deepEqual(expandUrl(url, tokyo('2026-10-12T09:00'), TOKYO, null), { url, unknown: [], missing: [] });
});

test('Invalid timezone is rejected when a date token needs it', () => {
  assert.throws(() => expandUrl(SHOP, 0, 'Not/AZone', null), { name: 'RangeError', message: 'invalid-timezone' });
});

test('findTokens / unknownTokens list placeholders once, in order', () => {
  assert.deepEqual(findTokens('{a}{YYYY}{a}{b}'), ['a', 'YYYY', 'b']);
  assert.deepEqual(unknownTokens('{a}{YYYY}{a}{googleEmail}{b}'), ['a', 'b']);
  assert.deepEqual(unknownTokens('https://plain.test'), []);
  assert.deepEqual([...TOKENS], ['YYYY', 'MM', 'DD', 'googleEmail']);
});
