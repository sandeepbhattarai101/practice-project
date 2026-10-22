/**
 * Date/time helpers. Instants are always shown in the cinema/showtime timezone,
 * UK style: dates DD/MM/YYYY, times 12-hour like "6:30 PM".
 */

export const DEFAULT_TIMEZONE = 'Asia/Kathmandu';

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, ...options });
    formatterCache.set(key, f);
  }
  return f;
}

function toDate(value: string | Date | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function parts(value: string | Date | number, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const out: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const p of formatter(timeZone, options).formatToParts(toDate(value))) out[p.type] = p.value;
  return out;
}

/** Instant → "22/10/2026" in the given timezone. */
export function formatDate(value: string | Date | number, timeZone = DEFAULT_TIMEZONE): string {
  const p = parts(value, timeZone, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p.day}/${p.month}/${p.year}`;
}

/** Instant → "6:30 PM" in the given timezone. */
export function formatTime(value: string | Date | number, timeZone = DEFAULT_TIMEZONE): string {
  const p = parts(value, timeZone, { hour: 'numeric', minute: '2-digit', hour12: true });
  const period = (p.dayPeriod ?? '').toUpperCase().replace(/\./g, '');
  return `${p.hour}:${p.minute} ${period}`.trim();
}

/** Instant → "22/10/2026, 6:30 PM". */
export function formatDateTime(value: string | Date | number, timeZone = DEFAULT_TIMEZONE): string {
  return `${formatDate(value, timeZone)}, ${formatTime(value, timeZone)}`;
}

/** Instant → "Thu 22/10/2026" — weekday plus date, for headers. */
export function formatWeekdayDate(value: string | Date | number, timeZone = DEFAULT_TIMEZONE): string {
  const p = parts(value, timeZone, { weekday: 'short' });
  return `${p.weekday} ${formatDate(value, timeZone)}`;
}

/** Calendar date "2026-10-22" → "22/10/2026" (no timezone shift: it already is a calendar date). */
export function formatCalendarDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Calendar date → { weekday: "Thu", day: "22", month: "Oct" } for date strips. */
export function calendarDateParts(date: string): { weekday: string; day: string; month: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return { weekday: '', day: date, month: '' };
  const utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  const p = parts(utc, 'UTC', { weekday: 'short', day: 'numeric', month: 'short' });
  return { weekday: p.weekday ?? '', day: p.day ?? '', month: p.month ?? '' };
}

/** Today's calendar date ("YYYY-MM-DD") in the given timezone. */
export function todayInZone(timeZone = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return calendarDateInZone(now, timeZone);
}

/** The calendar date ("YYYY-MM-DD") of an instant in the given timezone. */
export function calendarDateInZone(value: string | Date | number, timeZone = DEFAULT_TIMEZONE): string {
  const p = parts(value, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Wall-clock time "HH:mm" (24h) of an instant in the given timezone — for form fields. */
export function wallTimeInZone(value: string | Date | number, timeZone = DEFAULT_TIMEZONE): string {
  const p = parts(value, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
}

/** Adds days to a calendar date string. */
export function addDays(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid calendar date: ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** Offset (ms) of `timeZone` from UTC at the given instant. Kathmandu → +5h45m. */
export function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const p = parts(instantMs, timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  const truncated = instantMs - (((instantMs % 1000) + 1000) % 1000);
  return asUtc - truncated;
}

/**
 * Converts a wall-clock date + time in `timeZone` to an ISO-8601 UTC instant.
 * `localToInstant('2026-10-22', '18:30', 'Asia/Kathmandu')` → `'2026-10-22T12:45:00Z'`.
 * Handles DST zones by re-checking the offset at the candidate instant.
 */
export function localToInstant(date: string, time: string, timeZone: string): string {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dm || !tm) throw new Error(`Invalid local date/time: ${date} ${time}`);
  const wallAsUtc = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  let guess = wallAsUtc - timeZoneOffsetMs(wallAsUtc, timeZone);
  const second = wallAsUtc - timeZoneOffsetMs(guess, timeZone);
  if (second !== guess) guess = second;
  return new Date(guess).toISOString().replace('.000Z', 'Z');
}

/** Milliseconds → "4:05" / "1:02:09" for countdowns. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 135 → "2h 15m" */
export function formatRuntime(minutes: number): string {
  if (!minutes || minutes < 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Formats an ICS UTC timestamp: 20261022T124500Z */
export function toIcsTimestamp(value: string | Date | number): string {
  return toDate(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
