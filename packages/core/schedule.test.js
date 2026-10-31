// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodKey, nextPeriodStart, previousPeriodStart, bucket, nextDue, streak, validateSchedule, MAX_EVERY_N_DAYS } from './schedule.js';
import { addDays, isoWeekday } from './time.js';
import { makeItem, tokyo, utc, mulberry32 } from './fixtures.js';

const TOKYO = 'Asia/Tokyo';

/** @param {string} itemId @param {string} pk @param {number} doneAt */
const tick = (itemId, pk, doneAt) => ({ itemId, periodKey: pk, doneAt });

// ---- Requirement: Cadences define periods ---------------------------------------------------

test('Daily period: evaluated 2026-10-12 15:00 -> period starts 2026-10-12', () => {
  assert.equal(periodKey({ type: 'daily' }, tokyo('2026-10-12T15:00'), TOKYO), '2026-10-12');
});

test('Weekly period: Monday item evaluated Thursday 2026-10-15 -> period started Monday 2026-10-12', () => {
  assert.equal(isoWeekday('2026-10-12'), 1);
  assert.equal(periodKey({ type: 'weekly', weekday: 1 }, tokyo('2026-10-15T09:00'), TOKYO), '2026-10-12');
});

test('Monthly day clamped in a short month: day 31 evaluated 2027-02-28 -> period started 2027-02-28', () => {
  assert.equal(periodKey({ type: 'monthly', day: 31 }, tokyo('2027-02-28T12:00'), TOKYO), '2027-02-28');
});

test('Monthly day not yet reached this month: day 15 evaluated 2026-10-10 -> period started 2026-09-15', () => {
  assert.equal(periodKey({ type: 'monthly', day: 15 }, tokyo('2026-10-10T12:00'), TOKYO), '2026-09-15');
});

test('Every-N-days anchored on the start date: every 3 days from 2026-10-01 evaluated 2026-10-08 -> 2026-10-07', () => {
  assert.equal(periodKey({ type: 'everyNDays', n: 3, startDate: '2026-10-01' }, tokyo('2026-10-08T12:00'), TOKYO), '2026-10-07');
});

test('Every-N-days before its start date: no period and next due on the start date', () => {
  const schedule = /** @type {const} */ ({ type: 'everyNDays', n: 3, startDate: '2026-10-20' });
  const now = tokyo('2026-10-12T12:00');
  assert.equal(periodKey(schedule, now, TOKYO), null);
  const item = makeItem({ schedule });
  assert.equal(bucket(item, [], now, TOKYO), 'notDue');
  assert.equal(nextDue(item, [], now, TOKYO), '2026-10-20');
});

test('Weekly boundaries for all 7 weekdays', () => {
  const monday = '2026-10-12';
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (let offset = 0; offset < 14; offset++) {
      const day = addDays(monday, offset);
      const pk = /** @type {string} */ (periodKey({ type: 'weekly', weekday }, tokyo(`${day}T10:00`), TOKYO));
      assert.equal(isoWeekday(pk), weekday, `${day} weekday ${weekday}`);
      assert.ok(pk <= day, `${pk} <= ${day}`);
      assert.ok(addDays(pk, 7) > day, `${day} is inside the week starting ${pk}`);
    }
  }
  // explicit edges: Sunday (7) item on Saturday vs Sunday
  assert.equal(periodKey({ type: 'weekly', weekday: 7 }, tokyo('2026-10-17T10:00'), TOKYO), '2026-10-11');
  assert.equal(periodKey({ type: 'weekly', weekday: 7 }, tokyo('2026-10-18T10:00'), TOKYO), '2026-10-18');
  // Monday item on Sunday still belongs to the week that began the previous Monday
  assert.equal(periodKey({ type: 'weekly', weekday: 1 }, tokyo('2026-10-18T23:59'), TOKYO), '2026-10-12');
  assert.equal(periodKey({ type: 'weekly', weekday: 1 }, tokyo('2026-10-19T00:00'), TOKYO), '2026-10-19');
});

test('Monthly clamping: day 29/30/31 across February (non-leap and leap) and April', () => {
  const at = (/** @type {number} */ day, /** @type {string} */ date) => periodKey({ type: 'monthly', day }, tokyo(`${date}T12:00`), TOKYO);
  // February 2027 (28 days)
  assert.equal(at(29, '2027-02-28'), '2027-02-28');
  assert.equal(at(30, '2027-02-28'), '2027-02-28');
  assert.equal(at(31, '2027-02-28'), '2027-02-28');
  assert.equal(at(31, '2027-02-27'), '2027-01-31');
  assert.equal(at(29, '2027-02-27'), '2027-01-29');
  assert.equal(at(30, '2027-03-01'), '2027-02-28');
  // February 2028 (leap, 29 days)
  assert.equal(at(29, '2028-02-29'), '2028-02-29');
  assert.equal(at(30, '2028-02-29'), '2028-02-29');
  assert.equal(at(31, '2028-02-29'), '2028-02-29');
  assert.equal(at(29, '2028-02-28'), '2028-01-29');
  assert.equal(at(31, '2028-02-28'), '2028-01-31');
  // April (30 days)
  assert.equal(at(30, '2026-04-30'), '2026-04-30');
  assert.equal(at(31, '2026-04-30'), '2026-04-30');
  assert.equal(at(31, '2026-04-29'), '2026-03-31');
  assert.equal(at(31, '2026-05-01'), '2026-04-30');
  // year rollover: January before the day -> previous December
  assert.equal(at(15, '2027-01-10'), '2026-12-15');
  assert.equal(at(31, '2027-01-30'), '2026-12-31');
});

test('The monthly sequence for day 31 is 01-31 -> 02-28 -> 03-31 (no drift)', () => {
  const schedule = /** @type {const} */ ({ type: 'monthly', day: 31 });
  assert.equal(nextPeriodStart(schedule, '2027-01-31'), '2027-02-28');
  assert.equal(nextPeriodStart(schedule, '2027-02-28'), '2027-03-31');
  assert.equal(nextPeriodStart(schedule, '2027-03-31'), '2027-04-30');
  assert.equal(nextPeriodStart(schedule, '2027-04-30'), '2027-05-31');
  assert.equal(nextPeriodStart(schedule, '2026-12-31'), '2027-01-31');
  assert.equal(nextPeriodStart(schedule, '2028-01-31'), '2028-02-29');
});

test('nextPeriodStart for daily, weekly and everyNDays', () => {
  assert.equal(nextPeriodStart({ type: 'daily' }, '2026-10-31'), '2026-11-01');
  assert.equal(nextPeriodStart({ type: 'weekly', weekday: 1 }, '2026-10-12'), '2026-10-19');
  assert.equal(nextPeriodStart({ type: 'everyNDays', n: 3, startDate: '2026-10-01' }, '2026-10-07'), '2026-10-10');
});

test('everyNDays with n=1 behaves like daily and n=7 like a weekly anchored on the start date', () => {
  const one = /** @type {const} */ ({ type: 'everyNDays', n: 1, startDate: '2026-10-01' });
  assert.equal(periodKey(one, tokyo('2026-10-01T00:00'), TOKYO), '2026-10-01');
  assert.equal(periodKey(one, tokyo('2026-10-12T15:00'), TOKYO), '2026-10-12');
  const seven = /** @type {const} */ ({ type: 'everyNDays', n: 7, startDate: '2026-10-01' });
  assert.equal(periodKey(seven, tokyo('2026-10-01T08:00'), TOKYO), '2026-10-01');
  assert.equal(periodKey(seven, tokyo('2026-10-07T23:59'), TOKYO), '2026-10-01');
  assert.equal(periodKey(seven, tokyo('2026-10-08T00:00'), TOKYO), '2026-10-08');
  assert.equal(periodKey(seven, tokyo('2026-10-14T12:00'), TOKYO), '2026-10-08');
  assert.equal(periodKey(seven, tokyo('2026-10-15T12:00'), TOKYO), '2026-10-15');
});

test('Every-N-days on its start date starts that very day', () => {
  assert.equal(periodKey({ type: 'everyNDays', n: 3, startDate: '2026-10-12' }, tokyo('2026-10-12T00:30'), TOKYO), '2026-10-12');
});

// ---- Requirement: Reset time and timezone decide the effective day --------------------------

test('Before the reset time counts as the previous day: daily reset 04:00 evaluated 02:00 on 2026-10-12 -> 2026-10-11', () => {
  assert.equal(periodKey({ type: 'daily' }, tokyo('2026-10-12T02:00'), TOKYO, '04:00'), '2026-10-11');
  assert.equal(periodKey({ type: 'daily' }, tokyo('2026-10-12T04:00'), TOKYO, '04:00'), '2026-10-12');
});

test('Timezone governs the day boundary: 2026-10-11T17:30Z in Asia/Tokyo -> 2026-10-12', () => {
  assert.equal(periodKey({ type: 'daily' }, utc('2026-10-11T17:30'), TOKYO), '2026-10-12');
});

test('Invalid timezone is rejected: periodKey, bucket and nextDue throw invalid-timezone', () => {
  const expected = { name: 'RangeError', message: 'invalid-timezone' };
  assert.throws(() => periodKey({ type: 'daily' }, 0, 'Not/AZone'), expected);
  assert.throws(() => bucket(makeItem(), [], 0, 'Not/AZone'), expected);
  assert.throws(() => nextDue(makeItem(), [], 0, 'Not/AZone'), expected);
});

test('Timezone setting changed: periodKey is recomputed, old completions keep their keys', () => {
  const now = utc('2026-10-11T17:30'); // 2026-10-12 in Tokyo, still 2026-10-11 in UTC
  const item = makeItem({ id: 'a' });
  const completions = [tick('a', '2026-10-11', utc('2026-10-11T10:00'))];
  assert.equal(periodKey({ type: 'daily' }, now, TOKYO), '2026-10-12');
  assert.equal(periodKey({ type: 'daily' }, now, 'UTC'), '2026-10-11');
  assert.equal(bucket(item, completions, now, TOKYO), 'due');
  assert.equal(bucket(item, completions, now, 'UTC'), 'done');
});

test('Invalid schedules are rejected rather than guessed', () => {
  const expected = { name: 'RangeError', message: 'invalid-schedule' };
  // @ts-expect-error deliberately invalid
  assert.throws(() => periodKey({ type: 'weekly', weekday: 8 }, 0, TOKYO), expected);
  assert.throws(() => periodKey({ type: 'everyNDays', n: 0, startDate: '2026-10-01' }, 0, TOKYO), expected);
  // @ts-expect-error deliberately invalid
  assert.throws(() => periodKey({ type: 'yearly' }, 0, TOKYO), expected);
  assert.throws(() => nextPeriodStart({ type: 'monthly', day: 0 }, '2026-10-01'), expected);
});

test('validateSchedule reports out-of-range fields with codes', () => {
  assert.deepEqual(validateSchedule({ type: 'daily' }), []);
  assert.deepEqual(validateSchedule({ type: 'weekly', weekday: 7 }), []);
  assert.deepEqual(validateSchedule({ type: 'weekly', weekday: 0 }), [{ field: 'schedule.weekday', code: 'out-of-range' }]);
  assert.deepEqual(validateSchedule({ type: 'monthly', day: 32 }), [{ field: 'schedule.day', code: 'out-of-range' }]);
  assert.deepEqual(validateSchedule({ type: 'everyNDays', n: 0, startDate: '2026-02-30' }), [
    { field: 'schedule.n', code: 'out-of-range' },
    { field: 'schedule.startDate', code: 'invalid-date' },
  ]);
  assert.deepEqual(validateSchedule({ type: 'bogus' }), [{ field: 'schedule.type', code: 'invalid-value' }]);
  assert.deepEqual(validateSchedule('daily'), [{ field: 'schedule', code: 'invalid-value' }]);
});

test('everyNDays.n is bounded by MAX_EVERY_N_DAYS: the max is valid, one beyond is out-of-range', () => {
  assert.equal(MAX_EVERY_N_DAYS, 3660);
  assert.deepEqual(validateSchedule({ type: 'everyNDays', n: MAX_EVERY_N_DAYS, startDate: '2026-10-01' }), []);
  assert.deepEqual(validateSchedule({ type: 'everyNDays', n: MAX_EVERY_N_DAYS + 1, startDate: '2026-10-01' }), [
    { field: 'schedule.n', code: 'out-of-range' },
  ]);
});

test('periodKey never decreases as time moves forward (hourly sweep over 400 days)', () => {
  const schedules = /** @type {import('./schedule.js').Schedule[]} */ ([
    { type: 'daily' },
    { type: 'weekly', weekday: 1 },
    { type: 'weekly', weekday: 7 },
    { type: 'monthly', day: 15 },
    { type: 'monthly', day: 31 },
    { type: 'everyNDays', n: 1, startDate: '2026-01-10' },
    { type: 'everyNDays', n: 7, startDate: '2026-02-01' },
    { type: 'everyNDays', n: 3, startDate: '2026-03-05' },
  ]);
  const start = utc('2026-01-01T00:00');
  for (const tz of [TOKYO, 'America/New_York']) {
    for (const resetTime of ['00:00', '04:00']) {
      for (const schedule of schedules) {
        /** @type {string | null} */
        let prev = null;
        for (let h = 0; h < 400 * 24; h++) {
          const cur = periodKey(schedule, start + h * 3600_000, tz, resetTime);
          if (prev !== null) {
            assert.ok(cur !== null && cur >= prev, `${JSON.stringify(schedule)} ${tz} ${resetTime} h=${h}: ${prev} -> ${cur}`);
          }
          prev = cur;
        }
      }
    }
  }
});

// ---- Requirement: Done is deduced from ticks in the current period --------------------------

test('Tick in the current period: daily item ticked for 2026-10-12, evaluated 2026-10-12 -> done', () => {
  const item = makeItem({ id: 'a' });
  const now = tokyo('2026-10-12T15:00');
  assert.equal(bucket(item, [tick('a', '2026-10-12', tokyo('2026-10-12T09:00'))], now, TOKYO), 'done');
});

test("Yesterday's tick does not carry over: daily item ticked only for 2026-10-11 -> due on 2026-10-12", () => {
  const item = makeItem({ id: 'a' });
  const now = tokyo('2026-10-12T15:00');
  assert.equal(bucket(item, [tick('a', '2026-10-11', tokyo('2026-10-11T09:00'))], now, TOKYO), 'due');
});

test("Another item's tick for the same period does not count", () => {
  const item = makeItem({ id: 'a' });
  assert.equal(bucket(item, [tick('b', '2026-10-12', tokyo('2026-10-12T09:00'))], tokyo('2026-10-12T15:00'), TOKYO), 'due');
});

test('Idempotent double tick: a duplicate completion row changes nothing', () => {
  const item = makeItem({ id: 'a' });
  const now = tokyo('2026-10-12T15:00');
  const once = [tick('a', '2026-10-12', tokyo('2026-10-12T09:00'))];
  const twice = [...once, tick('a', '2026-10-12', tokyo('2026-10-12T09:00')), tick('a', '2026-10-12', tokyo('2026-10-12T10:00'))];
  assert.equal(bucket(item, twice, now, TOKYO), bucket(item, once, now, TOKYO));
  assert.equal(nextDue(item, twice, now, TOKYO), nextDue(item, once, now, TOKYO));
  assert.equal(bucket(item, twice.slice().reverse(), now, TOKYO), 'done');
});

// ---- Requirement: Items are bucketed as due, done or not due --------------------------------

test('Weekly item on the day it was ticked -> done', () => {
  const item = makeItem({ id: 'w', schedule: { type: 'weekly', weekday: 1 } });
  const completions = [tick('w', '2026-10-12', tokyo('2026-10-12T09:00'))];
  assert.equal(bucket(item, completions, tokyo('2026-10-12T20:00'), TOKYO), 'done');
});

test('Weekly item later in the week -> notDue and next due 2026-10-19', () => {
  const item = makeItem({ id: 'w', schedule: { type: 'weekly', weekday: 1 } });
  const completions = [tick('w', '2026-10-12', tokyo('2026-10-12T09:00'))];
  const now = tokyo('2026-10-14T10:00');
  assert.equal(bucket(item, completions, now, TOKYO), 'notDue');
  assert.equal(nextDue(item, completions, now, TOKYO), '2026-10-19');
});

test('Weekly item ticked before its reset stays done until the next day, then is notDue', () => {
  const item = makeItem({ id: 'w', schedule: { type: 'weekly', weekday: 1 }, resetTime: '04:00' });
  // Tuesday 02:00 is still Monday's effective day
  const completions = [tick('w', '2026-10-12', tokyo('2026-10-13T02:00'))];
  assert.equal(bucket(item, completions, tokyo('2026-10-13T02:30'), TOKYO), 'done');
  assert.equal(bucket(item, completions, tokyo('2026-10-13T04:00'), TOKYO), 'notDue');
  assert.equal(nextDue(item, completions, tokyo('2026-10-13T04:00'), TOKYO), '2026-10-19');
});

test('Monday weekly item becomes due again when the next period starts', () => {
  const item = makeItem({ id: 'w', schedule: { type: 'weekly', weekday: 1 } });
  const completions = [tick('w', '2026-10-12', tokyo('2026-10-12T09:00'))];
  assert.equal(bucket(item, completions, tokyo('2026-10-19T00:30'), TOKYO), 'due');
});

test('Daily item ticked at 02:00 with reset 04:00 counts for the previous day', () => {
  const item = makeItem({ id: 'a', resetTime: '04:00' });
  const completions = [tick('a', '2026-10-11', tokyo('2026-10-12T02:00'))];
  assert.equal(bucket(item, completions, tokyo('2026-10-12T03:00'), TOKYO), 'done');
  assert.equal(bucket(item, completions, tokyo('2026-10-12T04:00'), TOKYO), 'due');
});

test('Unscheduled item: no bucket and no next due', () => {
  const item = makeItem({ schedule: null });
  assert.equal(bucket(item, [], tokyo('2026-10-12T15:00'), TOKYO), null);
  assert.equal(nextDue(item, [], tokyo('2026-10-12T15:00'), TOKYO), null);
  assert.equal(periodKey(null, tokyo('2026-10-12T15:00'), TOKYO), null);
});

test('A daily item ticked yesterday is due today and notDue is only for same-period completions', () => {
  const item = makeItem({ id: 'a' });
  const completions = [tick('a', '2026-10-11', tokyo('2026-10-11T09:00'))];
  assert.equal(bucket(item, completions, tokyo('2026-10-12T00:00'), TOKYO), 'due');
});

// ---- Requirement: Next due date --------------------------------------------------------------

test('Done monthly item: day 31 done for the period starting 2027-01-31, evaluated 2027-02-10 -> next due 2027-02-28', () => {
  const item = makeItem({ id: 'm', schedule: { type: 'monthly', day: 31 } });
  const completions = [tick('m', '2027-01-31', tokyo('2027-01-31T09:00'))];
  const now = tokyo('2027-02-10T12:00');
  assert.equal(bucket(item, completions, now, TOKYO), 'notDue');
  assert.equal(nextDue(item, completions, now, TOKYO), '2027-02-28');
});

test('Due item: daily item without a tick evaluated 2026-10-12 -> next due 2026-10-12', () => {
  const item = makeItem({ id: 'a' });
  assert.equal(nextDue(item, [], tokyo('2026-10-12T15:00'), TOKYO), '2026-10-12');
});

test('Due item before the reset time reports the effective day as next due', () => {
  const item = makeItem({ id: 'a', resetTime: '04:00' });
  assert.equal(nextDue(item, [], tokyo('2026-10-12T02:00'), TOKYO), '2026-10-11');
});

test('Done daily item is next due tomorrow', () => {
  const item = makeItem({ id: 'a' });
  const completions = [tick('a', '2026-10-12', tokyo('2026-10-12T09:00'))];
  assert.equal(nextDue(item, completions, tokyo('2026-10-12T15:00'), TOKYO), '2026-10-13');
});

test('Inputs are not mutated', () => {
  const item = makeItem({ id: 'a' });
  const completions = [tick('a', '2026-10-12', tokyo('2026-10-12T09:00'))];
  const itemCopy = structuredClone(item);
  const completionsCopy = structuredClone(completions);
  bucket(item, completions, tokyo('2026-10-12T15:00'), TOKYO);
  nextDue(item, completions, tokyo('2026-10-12T15:00'), TOKYO);
  assert.deepEqual(item, itemCopy);
  assert.deepEqual(completions, completionsCopy);
});

test('previousPeriodStart: daily, weekly, every-N-days (null before the start), monthly with clamping', () => {
  assert.equal(previousPeriodStart({ type: 'daily' }, '2026-03-01'), '2026-02-28');
  assert.equal(previousPeriodStart({ type: 'weekly', weekday: 1 }, '2026-10-12'), '2026-10-05');
  const every3 = { type: 'everyNDays', n: 3, startDate: '2026-10-01' };
  assert.equal(previousPeriodStart(every3, '2026-10-07'), '2026-10-04');
  assert.equal(previousPeriodStart(every3, '2026-10-04'), '2026-10-01');
  assert.equal(previousPeriodStart(every3, '2026-10-01'), null, 'nothing before the start date');
  const m31 = { type: 'monthly', day: 31 };
  assert.equal(previousPeriodStart(m31, '2027-03-31'), '2027-02-28');
  assert.equal(previousPeriodStart(m31, '2027-02-28'), '2027-01-31');
  assert.equal(previousPeriodStart(m31, '2027-01-31'), '2026-12-31');
  assert.equal(previousPeriodStart(m31, '2028-03-31'), '2028-02-29');
  assert.equal(previousPeriodStart(m31, '2027-05-31'), '2027-04-30');
  assert.throws(() => previousPeriodStart({ type: 'weekly', weekday: 9 }, '2026-10-12'), RangeError);
});

// ---- streak -------------------------------------------------------------------------------

test('streak: unscheduled item and empty history are zero', () => {
  assert.deepEqual(streak(makeItem({ schedule: null }), [], tokyo('2026-10-12T15:00'), TOKYO), { current: 0, longest: 0 });
  assert.deepEqual(streak(makeItem({ id: 'a' }), [], tokyo('2026-10-12T15:00'), TOKYO), { current: 0, longest: 0 });
});

test('streak daily: consecutive days build current; today not done does not zero it', () => {
  const item = makeItem({ id: 'a' }); // daily
  const now = tokyo('2026-10-12T15:00'); // current period 2026-10-12
  // done 10, 11 but not 12 yet: current counts back from the 11th -> 2
  const c2 = [tick('a', '2026-10-10', 1), tick('a', '2026-10-11', 2)];
  assert.deepEqual(streak(item, c2, now, TOKYO), { current: 2, longest: 2 });
  // also done today: current includes it -> 3
  const c3 = [...c2, tick('a', '2026-10-12', 3)];
  assert.deepEqual(streak(item, c3, now, TOKYO), { current: 3, longest: 3 });
});

test('streak daily: a gap breaks current but longest remembers the best past run', () => {
  const item = makeItem({ id: 'a' });
  const now = tokyo('2026-10-12T15:00');
  // a 4-day run 10-01..10-04, a gap, then 10-10, 10-11 (current, today not done)
  const c = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-10', '2026-10-11'].map((d, i) => tick('a', d, i + 1));
  assert.deepEqual(streak(item, c, now, TOKYO), { current: 2, longest: 4 });
  assert.ok(streak(item, c, now, TOKYO).longest >= streak(item, c, now, TOKYO).current);
});

test('streak daily: a break right before today gives current 0 but keeps longest', () => {
  const item = makeItem({ id: 'a' });
  const now = tokyo('2026-10-12T15:00');
  // done through 10-09 then nothing on 10-10, 10-11: the walk back from the 11th finds nothing done -> current 0
  const c = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((d, i) => tick('a', d, i + 1));
  assert.deepEqual(streak(item, c, now, TOKYO), { current: 0, longest: 5 });
});

test('streak weekly: consecutive weeks counted by the weekly period', () => {
  const item = makeItem({ id: 'w', schedule: { type: 'weekly', weekday: 1 } });
  const now = tokyo('2026-10-14T10:00'); // current week starts 2026-10-12, not done yet
  const c = [tick('w', '2026-09-28', 1), tick('w', '2026-10-05', 2)]; // the two prior Mondays
  assert.deepEqual(streak(item, c, now, TOKYO), { current: 2, longest: 2 });
});

test('streak monthly day 31: the clamped sequence chains without drift', () => {
  const item = makeItem({ id: 'm', schedule: { type: 'monthly', day: 31 } });
  const now = tokyo('2027-03-15T12:00'); // current period 2027-03-31, not done yet
  const c = [tick('m', '2026-12-31', 1), tick('m', '2027-01-31', 2), tick('m', '2027-02-28', 3)];
  assert.deepEqual(streak(item, c, now, TOKYO), { current: 3, longest: 3 });
});

test('streak everyNDays: counted by the n-day period, unaffected by unrelated items', () => {
  const item = makeItem({ id: 'e', schedule: { type: 'everyNDays', n: 3, startDate: '2026-10-01' } });
  const now = tokyo('2026-10-12T12:00'); // periods: 01,04,07,10 (current 10, not done)
  const c = [tick('e', '2026-10-04', 1), tick('e', '2026-10-07', 2), tick('other', '2026-10-10', 9)];
  assert.deepEqual(streak(item, c, now, TOKYO), { current: 2, longest: 2 });
});

test('streak: a duplicate completion counts once', () => {
  const item = makeItem({ id: 'a' });
  const now = tokyo('2026-10-12T15:00');
  const c = [tick('a', '2026-10-11', 1), tick('a', '2026-10-11', 2)];
  assert.deepEqual(streak(item, c, now, TOKYO), { current: 1, longest: 1 });
});

test('previousPeriodStart is the inverse of nextPeriodStart for every schedule type over 200 random periods', () => {
  const rnd = mulberry32(131);
  for (let i = 0; i < 200; i++) {
    const startDate = addDays('2025-01-01', Math.floor(rnd() * 700));
    const schedules = [
      { type: 'daily' },
      { type: 'weekly', weekday: 1 + Math.floor(rnd() * 7) },
      { type: 'monthly', day: 1 + Math.floor(rnd() * 31) },
      { type: 'everyNDays', n: 1 + Math.floor(rnd() * 20), startDate },
    ];
    for (const s of schedules) {
      const now = Date.UTC(2025, 0, 1) + Math.floor(rnd() * 900) * 86_400_000 + 3_600_000;
      const pk = periodKey(/** @type {any} */ (s), now, 'UTC');
      if (pk === null) continue;
      assert.equal(previousPeriodStart(/** @type {any} */ (s), nextPeriodStart(/** @type {any} */ (s), pk)), pk, JSON.stringify([s, pk]));
      const prev = previousPeriodStart(/** @type {any} */ (s), pk);
      if (prev !== null) assert.equal(nextPeriodStart(/** @type {any} */ (s), prev), pk, JSON.stringify([s, pk, prev]));
    }
  }
});