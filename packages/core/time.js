// @ts-check
// Time helpers. Pure: only Intl and Date, no ambient clock. `nowMs` is always a parameter.
// Civil-date arithmetic works on 'YYYY-MM-DD' strings via Date.UTC, so DST never affects it.

/** @typedef {{date: string, minutes: number}} LocalParts */

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();

/**
 * @param {string} tz IANA timezone name
 * @returns {Intl.DateTimeFormat}
 */
function formatterFor(tz) {
  // Intl falls back to the ambient timezone for undefined: refuse that.
  if (typeof tz !== 'string' || tz === '') throw new RangeError('invalid-timezone');
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
    } catch {
      throw new RangeError('invalid-timezone');
    }
    formatters.set(tz, f);
  }
  return f;
}

/**
 * @param {number} n
 * @param {number} width
 */
function pad(n, width) {
  return String(n).padStart(width, '0');
}

/**
 * Format a civil date.
 * @param {number} y
 * @param {number} m 1..12
 * @param {number} d 1..31
 * @returns {string} 'YYYY-MM-DD'
 */
export function formatDate(y, m, d) {
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/**
 * Local wall-clock parts of an instant in a timezone.
 * @param {number} nowMs epoch ms
 * @param {string} tz IANA timezone name
 * @returns {LocalParts} `date` is 'YYYY-MM-DD', `minutes` is minutes since local midnight
 * @throws {RangeError} 'invalid-timezone' for an unknown timezone, 'invalid-instant' for a non-finite instant
 */
export function localParts(nowMs, tz) {
  const f = formatterFor(tz);
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) throw new RangeError('invalid-instant');
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of f.formatToParts(nowMs)) p[part.type] = part.value;
  const hour = Number(p.hour) % 24; // some runtimes print midnight as "24"
  return {
    date: formatDate(Number(p.year), Number(p.month), Number(p.day)),
    minutes: hour * 60 + Number(p.minute),
  };
}

/**
 * Parse 'HH:MM' (00:00..23:59) into minutes since midnight.
 * @param {unknown} s
 * @returns {number | null} null when malformed
 */
export function parseHHMM(s) {
  if (typeof s !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * @param {number} y
 * @returns {boolean}
 */
function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Number of days in a month.
 * @param {number} y
 * @param {number} m 1..12
 * @returns {number}
 * @throws {RangeError} 'invalid-month'
 */
export function daysInMonth(y, m) {
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new RangeError('invalid-month');
  if (m === 2) return isLeap(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/**
 * Is `s` a real calendar date written 'YYYY-MM-DD'?
 * @param {unknown} s
 * @returns {boolean}
 */
export function isValidDate(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

/**
 * Split a valid 'YYYY-MM-DD' into numbers.
 * @param {string} date
 * @returns {{y: number, m: number, d: number}}
 * @throws {RangeError} 'invalid-date'
 */
export function parseDate(date) {
  if (!isValidDate(date)) throw new RangeError('invalid-date');
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) };
}

/**
 * Days since 1970-01-01 of a civil date.
 * @param {string} date
 * @returns {number}
 */
function dayNumber(date) {
  const { y, m, d } = parseDate(date);
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return Math.round(t.getTime() / 86400000);
}

/**
 * Add (or subtract) whole days to a civil date.
 * @param {string} date 'YYYY-MM-DD'
 * @param {number} n integer
 * @returns {string} 'YYYY-MM-DD'
 * @throws {RangeError} 'invalid-date' | 'invalid-days'
 */
export function addDays(date, n) {
  if (!Number.isInteger(n)) throw new RangeError('invalid-days');
  const { y, m, d } = parseDate(date);
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d + n);
  return formatDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Whole days from `a` to `b` (positive when b is later).
 * @param {string} a 'YYYY-MM-DD'
 * @param {string} b 'YYYY-MM-DD'
 * @returns {number}
 */
export function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

/**
 * ISO weekday of a civil date.
 * @param {string} date 'YYYY-MM-DD'
 * @returns {number} 1 = Monday ... 7 = Sunday
 */
export function isoWeekday(date) {
  // 1970-01-01 was a Thursday (ISO 4).
  const n = dayNumber(date);
  return ((((n + 3) % 7) + 7) % 7) + 1;
}

/**
 * The effective day: the local date after subtracting the reset time. Before the reset time of
 * a civil day, the effective day is still the previous civil day.
 * @param {number} nowMs epoch ms
 * @param {string} tz IANA timezone name
 * @param {string} [resetTime] 'HH:MM', default '00:00'
 * @returns {string} 'YYYY-MM-DD'
 * @throws {RangeError} 'invalid-timezone' | 'invalid-instant' | 'invalid-reset-time'
 */
export function effectiveDay(nowMs, tz, resetTime = '00:00') {
  const reset = parseHHMM(resetTime);
  if (reset === null) throw new RangeError('invalid-reset-time');
  const { date, minutes } = localParts(nowMs, tz);
  return minutes < reset ? addDays(date, -1) : date;
}
