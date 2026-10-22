import { describe, expect, it } from 'vitest';
import {
  addDays,
  calendarDateInZone,
  calendarDateParts,
  formatCalendarDate,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatRuntime,
  formatTime,
  localToInstant,
  timeZoneOffsetMs,
  todayInZone,
  wallTimeInZone,
} from './dates';

const KTM = 'Asia/Kathmandu';

describe('formatting instants in the cinema timezone', () => {
  it('shows Kathmandu time (UTC+05:45)', () => {
    // 12:45 UTC is 18:30 in Kathmandu.
    expect(formatTime('2026-10-22T12:45:00Z', KTM)).toBe('6:30 PM');
    expect(formatDate('2026-10-22T12:45:00Z', KTM)).toBe('22/10/2026');
    expect(formatDateTime('2026-10-22T12:45:00Z', KTM)).toBe('22/10/2026, 6:30 PM');
  });

  it('crosses midnight correctly with the 45-minute offset', () => {
    // 18:30 UTC is 00:15 the next day in Kathmandu.
    expect(formatDate('2026-10-22T18:30:00Z', KTM)).toBe('23/10/2026');
    expect(formatTime('2026-10-22T18:30:00Z', KTM)).toBe('12:15 AM');
    expect(calendarDateInZone('2026-10-22T18:30:00Z', KTM)).toBe('2026-10-23');
    // 18:14 UTC is still 23:59 on the 22nd.
    expect(calendarDateInZone('2026-10-22T18:14:00Z', KTM)).toBe('2026-10-22');
  });

  it('honours offsets in the ISO string', () => {
    expect(formatTime('2026-10-22T18:30:00+05:45', KTM)).toBe('6:30 PM');
  });

  it('formats in other zones too', () => {
    expect(formatTime('2026-10-22T12:45:00Z', 'Europe/London')).toBe('1:45 PM'); // BST, UTC+1
    expect(formatTime('2026-12-22T12:45:00Z', 'Europe/London')).toBe('12:45 PM'); // GMT
    expect(formatDate('2026-01-05T00:00:00Z', 'UTC')).toBe('05/01/2026');
  });

  it('gives wall-clock times for form fields', () => {
    expect(wallTimeInZone('2026-10-22T12:45:00Z', KTM)).toBe('18:30');
    expect(wallTimeInZone('2026-10-22T18:15:00Z', KTM)).toBe('00:00');
  });

  it('computes today in a zone', () => {
    expect(todayInZone(KTM, new Date('2026-10-22T18:20:00Z'))).toBe('2026-10-23');
    expect(todayInZone('UTC', new Date('2026-10-22T18:20:00Z'))).toBe('2026-10-22');
  });
});

describe('timezone offset', () => {
  it('is +5h45m for Kathmandu', () => {
    expect(timeZoneOffsetMs(Date.UTC(2026, 9, 22, 12, 0), KTM)).toBe((5 * 60 + 45) * 60 * 1000);
  });
});

describe('localToInstant (admin showtime form)', () => {
  it('converts Kathmandu local time to a UTC instant', () => {
    expect(localToInstant('2026-10-22', '18:30', KTM)).toBe('2026-10-22T12:45:00Z');
    expect(localToInstant('2026-10-22', '09:00', KTM)).toBe('2026-10-22T03:15:00Z');
  });

  it('moves to the previous UTC day for early local times', () => {
    expect(localToInstant('2026-10-23', '00:15', KTM)).toBe('2026-10-22T18:30:00Z');
    expect(localToInstant('2026-01-01', '05:00', KTM)).toBe('2025-12-31T23:15:00Z');
  });

  it('round-trips with the display helpers', () => {
    const instant = localToInstant('2026-11-05', '21:45', KTM);
    expect(calendarDateInZone(instant, KTM)).toBe('2026-11-05');
    expect(wallTimeInZone(instant, KTM)).toBe('21:45');
  });

  it('handles daylight saving zones', () => {
    expect(localToInstant('2026-07-01', '19:00', 'Europe/London')).toBe('2026-07-01T18:00:00Z');
    expect(localToInstant('2026-12-01', '19:00', 'Europe/London')).toBe('2026-12-01T19:00:00Z');
  });

  it('rejects malformed input', () => {
    expect(() => localToInstant('22/10/2026', '18:30', KTM)).toThrow();
    expect(() => localToInstant('2026-10-22', '6:30 PM', KTM)).toThrow();
  });
});

describe('calendar date helpers', () => {
  it('formats YYYY-MM-DD as DD/MM/YYYY without shifting the day', () => {
    expect(formatCalendarDate('2026-10-22')).toBe('22/10/2026');
    expect(formatCalendarDate('2026-01-01')).toBe('01/01/2026');
  });

  it('splits dates for the date strip', () => {
    expect(calendarDateParts('2026-10-22')).toEqual({ weekday: 'Thu', day: '22', month: 'Oct' });
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('misc formatters', () => {
  it('formats countdowns', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(599_001)).toBe('10:00');
    expect(formatCountdown(3_725_000)).toBe('1:02:05');
    expect(formatCountdown(-500)).toBe('0:00');
  });

  it('formats runtimes', () => {
    expect(formatRuntime(135)).toBe('2h 15m');
    expect(formatRuntime(120)).toBe('2h');
    expect(formatRuntime(45)).toBe('45m');
  });
});
