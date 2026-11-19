/** Calendar and time-zone helpers (IANA zones, DST-safe, no dependencies). */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** YYYY-MM-DD plus `days` (may be negative). */
export function addDays(date: string, days: number): string {
  const m = DATE.exec(date);
  if (!m) throw new Error(`Invalid date ${date} (expected YYYY-MM-DD)`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds (e.g. +19 800 000 for IST). */
function offsetMs(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * The UTC instant of a local wall-clock time in `timeZone`. An ambiguous (repeated) time resolves to
 * its first occurrence; a time skipped by a DST jump resolves to one hour later (e.g. 02:30 → 03:30).
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const d = DATE.exec(date);
  const t = TIME.exec(time);
  if (!d) throw new Error(`Invalid date ${date} (expected YYYY-MM-DD)`);
  if (!t) throw new Error(`Invalid time ${time} (expected HH:MM)`);
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  const hour = 3_600_000;
  const offsets = new Set([-15, -10, -5, 0, 5, 10, 15].map((h) => offsetMs(timeZone, wall + h * hour)));
  const valid = [...offsets]
    .map((o) => wall - o)
    .filter((c) => c + offsetMs(timeZone, c) === wall)
    .sort((a, b) => a - b);
  if (valid.length) return new Date(valid[0]!);
  return new Date(wall - offsetMs(timeZone, wall - 15 * hour));
}
