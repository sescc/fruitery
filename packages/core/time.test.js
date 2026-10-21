// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localParts, effectiveDay, addDays, daysInMonth, isoWeekday, isValidDate, parseHHMM, parseDate, daysBetween } from './time.js';
import { tokyo, utc } from './fixtures.js';

const TOKYO = 'Asia/Tokyo';

test('Timezone governs the day boundary: 2026-10-11T17:30Z is 2026-10-12 in Asia/Tokyo', () => {
  assert.deepEqual(localParts(utc('2026-10-11T17:30'), TOKYO), { date: '2026-10-12', minutes: 150 });
  assert.equal(effectiveDay(utc('2026-10-11T17:30'), TOKYO), '2026-10-12');
  assert.equal(effectiveDay(utc('2026-10-11T14:59'), TOKYO), '2026-10-11');
  assert.equal(effectiveDay(utc('2026-10-11T15:00'), TOKYO), '2026-10-12');
});

test('localParts reports midnight as 00:00, not 24:00', () => {
  assert.deepEqual(localParts(tokyo('2026-10-12T00:00'), TOKYO), { date: '2026-10-12', minutes: 0 });
  assert.deepEqual(localParts(tokyo('2026-10-12T23:59'), TOKYO), { date: '2026-10-12', minutes: 23 * 60 + 59 });
});

test('localParts follows DST in zones that have it', () => {
  assert.deepEqual(localParts(utc('2026-03-08T06:59'), 'America/New_York'), { date: '2026-03-08', minutes: 60 + 59 });
  assert.deepEqual(localParts(utc('2026-03-08T07:00'), 'America/New_York'), { date: '2026-03-08', minutes: 180 });
});

test('Before the reset time counts as the previous day (reset 04:00 at 02:00)', () => {
  assert.equal(effectiveDay(tokyo('2026-10-12T02:00'), TOKYO, '04:00'), '2026-10-11');
  assert.equal(effectiveDay(tokyo('2026-10-12T03:59'), TOKYO, '04:00'), '2026-10-11');
  assert.equal(effectiveDay(tokyo('2026-10-12T04:00'), TOKYO, '04:00'), '2026-10-12');
  assert.equal(effectiveDay(tokyo('2026-10-12T02:00'), TOKYO), '2026-10-12');
});

test('reset time rolls the effective day across a month boundary', () => {
  assert.equal(effectiveDay(tokyo('2026-11-01T01:00'), TOKYO, '04:00'), '2026-10-31');
});

test('Invalid timezone is rejected with RangeError("invalid-timezone")', () => {
  assert.throws(() => localParts(0, 'Mars/Olympus'), { name: 'RangeError', message: 'invalid-timezone' });
  assert.throws(() => effectiveDay(0, 'Mars/Olympus'), { name: 'RangeError', message: 'invalid-timezone' });
});

test('A missing timezone never falls back to the ambient one', () => {
  // @ts-expect-error deliberately wrong argument
  assert.throws(() => localParts(0, undefined), { name: 'RangeError', message: 'invalid-timezone' });
  assert.throws(() => localParts(0, ''), { name: 'RangeError', message: 'invalid-timezone' });
});

test('A non-finite instant or a malformed reset time is rejected', () => {
  assert.throws(() => localParts(NaN, TOKYO), { name: 'RangeError', message: 'invalid-instant' });
  assert.throws(() => effectiveDay(0, TOKYO, '25:00'), { name: 'RangeError', message: 'invalid-reset-time' });
});

test('daysInMonth handles leap years and century rules', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
  assert.throws(() => daysInMonth(2026, 13), { name: 'RangeError' });
});

test('isValidDate accepts real calendar dates, including leap days', () => {
  assert.equal(isValidDate('2026-10-12'), true);
  assert.equal(isValidDate('2024-02-29'), true);
  assert.equal(isValidDate('2000-02-29'), true);
});

test('Invalid dates are rejected', () => {
  for (const bad of ['2026-02-29', '2100-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-10-00', '2026-1-1', '2026-10-12T00:00', 'abc', '', null, undefined, 20261012]) {
    assert.equal(isValidDate(bad), false, String(bad));
  }
  assert.throws(() => parseDate('2026-02-30'), { name: 'RangeError', message: 'invalid-date' });
  assert.throws(() => addDays('nope', 1), { name: 'RangeError', message: 'invalid-date' });
});

test('addDays moves across month, year and leap boundaries', () => {
  assert.equal(addDays('2026-10-12', 1), '2026-10-13');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-10-12', 0), '2026-10-12');
  assert.equal(addDays('2026-10-12', 400), '2027-11-16');
  assert.throws(() => addDays('2026-10-12', 1.5), { name: 'RangeError', message: 'invalid-days' });
});

test('daysBetween is signed', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-08'), 7);
  assert.equal(daysBetween('2026-10-08', '2026-10-01'), -7);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
});

test('isoWeekday: 1 = Monday ... 7 = Sunday', () => {
  assert.equal(isoWeekday('2026-10-12'), 1);
  assert.equal(isoWeekday('2026-10-15'), 4);
  assert.equal(isoWeekday('2026-10-17'), 6);
  assert.equal(isoWeekday('2026-10-18'), 7);
  assert.equal(isoWeekday('1970-01-01'), 4);
  assert.equal(isoWeekday('1969-12-31'), 3);
});

test('parseHHMM accepts 00:00..23:59 only', () => {
  assert.equal(parseHHMM('00:00'), 0);
  assert.equal(parseHHMM('04:00'), 240);
  assert.equal(parseHHMM('23:59'), 1439);
  for (const bad of ['24:00', '25:00', '12:60', '4:00', '04:0', '0400', '', 'ab:cd', null, undefined, 400]) {
    assert.equal(parseHHMM(bad), null, String(bad));
  }
});
