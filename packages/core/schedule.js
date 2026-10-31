// @ts-check
// Schedule semantics: periods, buckets and next-due dates. Pure; `nowMs` is a parameter.

import { addDays, daysBetween, daysInMonth, effectiveDay, formatDate, isoWeekday, isValidDate, parseDate } from './time.js';

/**
 * @typedef {{type: 'daily'}
 *   | {type: 'weekly', weekday: number}
 *   | {type: 'monthly', day: number}
 *   | {type: 'everyNDays', n: number, startDate: string}} Schedule
 */
/** @typedef {{itemId: string, periodKey: string, doneAt: number}} Completion */
/** @typedef {'due' | 'done' | 'notDue'} Bucket */

/** Largest allowed `everyNDays.n` (~10 years). Bounds the period maths and the server's completions scan. */
export const MAX_EVERY_N_DAYS = 3660;

/**
 * Validate a schedule's shape and ranges.
 * Codes: `invalid-value` (not an object / unknown type), `out-of-range` (weekday not 1-7, day not
 * 1-31, n not an integer >= 1), `invalid-date` (startDate not a real calendar date).
 * @param {unknown} schedule
 * @param {string} [prefix] field prefix, default 'schedule'
 * @returns {{field: string, code: string}[]}
 */
export function validateSchedule(schedule, prefix = 'schedule') {
  /** @type {{field: string, code: string}[]} */
  const errors = [];
  if (schedule === null || typeof schedule !== 'object') {
    errors.push({ field: prefix, code: 'invalid-value' });
    return errors;
  }
  const s = /** @type {Record<string, unknown>} */ (schedule);
  const inRange = (/** @type {unknown} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  switch (s.type) {
    case 'daily':
      break;
    case 'weekly':
      if (!inRange(s.weekday, 1, 7)) errors.push({ field: `${prefix}.weekday`, code: 'out-of-range' });
      break;
    case 'monthly':
      if (!inRange(s.day, 1, 31)) errors.push({ field: `${prefix}.day`, code: 'out-of-range' });
      break;
    case 'everyNDays':
      if (!inRange(s.n, 1, MAX_EVERY_N_DAYS)) errors.push({ field: `${prefix}.n`, code: 'out-of-range' });
      if (!isValidDate(s.startDate)) errors.push({ field: `${prefix}.startDate`, code: 'invalid-date' });
      break;
    default:
      errors.push({ field: `${prefix}.type`, code: 'invalid-value' });
  }
  return errors;
}

/**
 * @param {Schedule} schedule
 * @throws {RangeError} 'invalid-schedule'
 */
function assertSchedule(schedule) {
  if (validateSchedule(schedule).length > 0) throw new RangeError('invalid-schedule');
}

/**
 * The monthly period start for `day` in the given month, clamped to the month's last day.
 * @param {number} y
 * @param {number} m
 * @param {number} day
 * @returns {string}
 */
function clampedMonthDay(y, m, day) {
  return formatDate(y, m, Math.min(day, daysInMonth(y, m)));
}

/**
 * Current period key (the ISO date the current period started), or null when there is no schedule
 * or an everyNDays schedule has not started yet.
 * @param {Schedule | null | undefined} schedule
 * @param {number} nowMs epoch ms
 * @param {string} tz IANA timezone name
 * @param {string} [resetTime] 'HH:MM', default '00:00'
 * @returns {string | null} 'YYYY-MM-DD'
 * @throws {RangeError} 'invalid-timezone' | 'invalid-reset-time' | 'invalid-instant' | 'invalid-schedule'
 */
export function periodKey(schedule, nowMs, tz, resetTime = '00:00') {
  if (schedule === null || schedule === undefined) return null;
  assertSchedule(schedule);
  const d = effectiveDay(nowMs, tz, resetTime);
  switch (schedule.type) {
    case 'daily':
      return d;
    case 'weekly': {
      const back = (isoWeekday(d) - schedule.weekday + 7) % 7;
      return addDays(d, -back);
    }
    case 'monthly': {
      const { y, m } = parseDate(d);
      const start = clampedMonthDay(y, m, schedule.day);
      if (d >= start) return start;
      return m === 1 ? clampedMonthDay(y - 1, 12, schedule.day) : clampedMonthDay(y, m - 1, schedule.day);
    }
    case 'everyNDays': {
      const diff = daysBetween(schedule.startDate, d);
      if (diff < 0) return null;
      return addDays(schedule.startDate, schedule.n * Math.floor(diff / schedule.n));
    }
  }
}

/**
 * Start of the period after the one starting at `periodKey`. For monthly this is next month's
 * clamped day, computed from the period's month (so 31 -> 28 -> 31, no drift).
 * @param {Schedule} schedule
 * @param {string} periodKey 'YYYY-MM-DD' (a period start)
 * @returns {string} 'YYYY-MM-DD'
 * @throws {RangeError} 'invalid-schedule' | 'invalid-date'
 */
export function nextPeriodStart(schedule, periodKey) {
  assertSchedule(schedule);
  switch (schedule.type) {
    case 'daily':
      return addDays(periodKey, 1);
    case 'weekly':
      return addDays(periodKey, 7);
    case 'monthly': {
      const { y, m } = parseDate(periodKey);
      return m === 12 ? clampedMonthDay(y + 1, 1, schedule.day) : clampedMonthDay(y, m + 1, schedule.day);
    }
    case 'everyNDays':
      return addDays(periodKey, schedule.n);
  }
}

/**
 * Start of the period before the one starting at `periodKey`: the inverse of `nextPeriodStart`. For
 * monthly it is the previous month's clamped day; for every-N-days it is null before the start date.
 * @param {Schedule} schedule
 * @param {string} periodKey 'YYYY-MM-DD' (a period start)
 * @returns {string | null} 'YYYY-MM-DD', or null when there is no earlier period
 * @throws {RangeError} 'invalid-schedule' | 'invalid-date'
 */
export function previousPeriodStart(schedule, periodKey) {
  assertSchedule(schedule);
  switch (schedule.type) {
    case 'daily':
      return addDays(periodKey, -1);
    case 'weekly':
      return addDays(periodKey, -7);
    case 'monthly': {
      const { y, m } = parseDate(periodKey);
      return m === 1 ? clampedMonthDay(y - 1, 12, schedule.day) : clampedMonthDay(y, m - 1, schedule.day);
    }
    case 'everyNDays': {
      const prev = addDays(periodKey, -schedule.n);
      return daysBetween(schedule.startDate, prev) < 0 ? null : prev;
    }
  }
}

/**
 * The completion of `item` in period `pk`. If duplicates exist the earliest `doneAt` is used, so
 * the result does not depend on array order and a double tick counts once.
 * @param {{id: string}} item
 * @param {Completion[]} completions
 * @param {string} pk
 * @returns {Completion | null}
 */
function findCompletion(item, completions, pk) {
  /** @type {Completion | null} */
  let found = null;
  for (const c of completions) {
    if (c.itemId === item.id && c.periodKey === pk && (found === null || c.doneAt < found.doneAt)) found = c;
  }
  return found;
}

/**
 * Bucket of a scheduled item: 'due', 'done' (ticked today) or 'notDue' (not started, or ticked
 * on an earlier effective day). Items without a schedule have no bucket (null).
 * @param {{id: string, schedule: Schedule | null, resetTime: string}} item
 * @param {Completion[]} completions
 * @param {number} nowMs epoch ms
 * @param {string} tz IANA timezone name
 * @returns {Bucket | null}
 */
export function bucket(item, completions, nowMs, tz) {
  if (!item.schedule) return null;
  const reset = item.resetTime ?? '00:00';
  const pk = periodKey(item.schedule, nowMs, tz, reset);
  if (pk === null) return 'notDue';
  const c = findCompletion(item, completions, pk);
  if (!c) return 'due';
  return effectiveDay(c.doneAt, tz, reset) === effectiveDay(nowMs, tz, reset) ? 'done' : 'notDue';
}

/**
 * When the item is next due: today's effective day if due, the next period start if done or
 * waiting for the next period, its start date if the schedule has not started. Null without a schedule.
 * @param {{id: string, schedule: Schedule | null, resetTime: string}} item
 * @param {Completion[]} completions
 * @param {number} nowMs epoch ms
 * @param {string} tz IANA timezone name
 * @returns {string | null} 'YYYY-MM-DD'
 */
export function nextDue(item, completions, nowMs, tz) {
  if (!item.schedule) return null;
  const reset = item.resetTime ?? '00:00';
  const pk = periodKey(item.schedule, nowMs, tz, reset);
  if (pk === null) {
    // only everyNDays can be unstarted
    return item.schedule.type === 'everyNDays' ? item.schedule.startDate : null;
  }
  if (bucket(item, completions, nowMs, tz) === 'due') return effectiveDay(nowMs, tz, reset);
  return nextPeriodStart(item.schedule, pk);
}

/**
 * The item's completion streak in periods (pure).
 * - `current`: how many consecutive periods, ending at the latest *completable* one, were done. If
 *   the current period is not yet done, the walk starts at the period before it, so "not done yet
 *   today" never zeros a running streak; once the current period is done it is included.
 * - `longest`: the longest run of consecutive done periods anywhere in the item's history.
 * An item without a schedule, or with no completions, has `{current: 0, longest: 0}`. The walk is
 * bounded by the item's own completions (a missing period stops it), so it cannot run unbounded.
 * @param {{id: string, schedule: Schedule | null, resetTime: string}} item
 * @param {Completion[]} completions
 * @param {number} nowMs epoch ms
 * @param {string} tz IANA timezone name
 * @returns {{current: number, longest: number}}
 */
export function streak(item, completions, nowMs, tz) {
  if (!item.schedule) return { current: 0, longest: 0 };
  /** @type {Set<string>} the item's done period keys */
  const done = new Set();
  for (const c of completions) if (c.itemId === item.id) done.add(c.periodKey);
  if (done.size === 0) return { current: 0, longest: 0 };

  const schedule = item.schedule;
  const reset = item.resetTime ?? '00:00';
  const pk = periodKey(schedule, nowMs, tz, reset);

  // current: walk back from the current period (if done) or the one before it (so today-not-done
  // does not zero the streak), counting consecutive done periods until one is missing or there is none
  let current = 0;
  if (pk !== null) {
    /** @type {string | null} */
    let at = done.has(pk) ? pk : previousPeriodStart(schedule, pk);
    while (at !== null && done.has(at)) {
      current += 1;
      at = previousPeriodStart(schedule, at);
    }
  }

  // longest: for each done period that starts a run (its previous period is not done), count forward
  let longest = 0;
  for (const start of done) {
    const prev = previousPeriodStart(schedule, start);
    if (prev !== null && done.has(prev)) continue; // not the start of a run
    let run = 0;
    /** @type {string | null} */
    let at = start;
    while (at !== null && done.has(at)) {
      run += 1;
      at = nextPeriodStart(schedule, at);
    }
    if (run > longest) longest = run;
  }

  return { current, longest };
}
