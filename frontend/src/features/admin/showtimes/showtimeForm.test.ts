import { describe, expect, it } from 'vitest';
import type { AdminLookups, AdminShowtime } from '@/types/api';
import {
  addTime,
  emptyShowtimeForm,
  expandBulkDates,
  normaliseTime,
  priceRowsFor,
  showtimeSchema,
  showtimeToFormValues,
  toBulkShowtimeInput,
  toShowtimeInput,
  weekdayOf,
  type ShowtimeFormValues,
} from './showtimeForm';

const TZ = 'Asia/Kathmandu';

const lookups: AdminLookups = {
  cities: [],
  cinemas: [
    {
      id: 3,
      name: 'Labim Mall',
      citySlug: 'kathmandu',
      auditoriums: [
        {
          id: 11,
          name: 'Audi 1',
          formats: ['2D', '3D'],
          categories: [
            { id: 21, code: 'STD', name: 'Standard' },
            { id: 22, code: 'VIP', name: 'Recliner' },
          ],
        },
      ],
    },
  ],
  movies: [{ id: 7, title: 'Kabaddi 5', languages: ['Nepali'], runtimeMinutes: 130, status: 'PUBLISHED' }],
};

function filled(overrides: Partial<ShowtimeFormValues> = {}): ShowtimeFormValues {
  return {
    ...emptyShowtimeForm('2026-10-22'),
    movieId: '7',
    cinemaId: '3',
    auditoriumId: '11',
    date: '2026-10-22',
    time: '18:30',
    format: '2D',
    language: 'Nepali',
    prices: [
      { categoryId: '21', name: 'Standard', rupees: '450' },
      { categoryId: '22', name: 'Recliner', rupees: '1,250.50' },
    ],
    ...overrides,
  };
}

describe('toShowtimeInput', () => {
  it('converts the Kathmandu wall-clock time (UTC+05:45) to a UTC instant', () => {
    expect(toShowtimeInput(filled(), TZ).startsAt).toBe('2026-10-22T12:45:00Z');
  });

  it('crosses midnight correctly for early local times', () => {
    expect(toShowtimeInput(filled({ date: '2026-10-23', time: '03:15' }), TZ).startsAt).toBe('2026-10-22T21:30:00Z');
  });

  it('maps ids to numbers and rupee prices to integer paisa', () => {
    const body = toShowtimeInput(filled(), TZ);
    expect(body).toEqual({
      movieId: 7,
      auditoriumId: 11,
      startsAt: '2026-10-22T12:45:00Z',
      format: '2D',
      language: 'Nepali',
      prices: [
        { categoryId: 21, priceMinor: 45000 },
        { categoryId: 22, priceMinor: 125050 },
      ],
    });
  });

  it('omits bufferMinutes when blank and sends it as a number otherwise', () => {
    expect(toShowtimeInput(filled(), TZ)).not.toHaveProperty('bufferMinutes');
    expect(toShowtimeInput(filled({ bufferMinutes: ' 20 ' }), TZ).bufferMinutes).toBe(20);
    expect(toShowtimeInput(filled({ bufferMinutes: '0' }), TZ).bufferMinutes).toBe(0);
  });
});

describe('bulk date expansion', () => {
  it('knows the weekday of a calendar date regardless of the browser timezone', () => {
    expect(weekdayOf('2026-10-22')).toBe(4); // Thursday
    expect(weekdayOf('2026-10-25')).toBe(0); // Sunday
  });

  it('expands a range filtered by weekdays, merged with extra dates, sorted and unique', () => {
    // 22/10/2026 (Thu) to 01/11/2026 (Sun), Fridays and Saturdays only
    expect(expandBulkDates('2026-10-22', '2026-11-01', ['5', '6'], ['2026-11-05', '2026-10-23'])).toEqual([
      '2026-10-23',
      '2026-10-24',
      '2026-10-30',
      '2026-10-31',
      '2026-11-05',
    ]);
  });

  it('returns only the extra dates when the range is blank or inverted', () => {
    expect(expandBulkDates('', '', ['1'], ['2026-12-01'])).toEqual(['2026-12-01']);
    expect(expandBulkDates('2026-10-30', '2026-10-01', ['0', '1', '2', '3', '4', '5', '6'])).toEqual([]);
  });

  it('builds the bulk payload with cinema-local dates and HH:mm times', () => {
    const body = toBulkShowtimeInput(
      filled({
        mode: 'bulk',
        rangeFrom: '2026-10-22',
        rangeTo: '2026-10-24',
        weekdays: ['0', '1', '2', '3', '4', '5', '6'],
        times: ['21:00', '9:30', '13:15', '21:00'],
      }),
    );
    expect(body.dates).toEqual(['2026-10-22', '2026-10-23', '2026-10-24']);
    expect(body.times).toEqual(['09:30', '13:15', '21:00']);
    expect(body).not.toHaveProperty('startsAt');
    expect(body.prices).toEqual([
      { categoryId: 21, priceMinor: 45000 },
      { categoryId: 22, priceMinor: 125050 },
    ]);
  });
});

describe('time chips', () => {
  it('normalises and validates times', () => {
    expect(normaliseTime('9:05')).toBe('09:05');
    expect(normaliseTime('24:00')).toBeNull();
    expect(normaliseTime('noon')).toBeNull();
  });

  it('adds times sorted and unique', () => {
    expect(addTime(['18:30'], '9:00')).toEqual(['09:00', '18:30']);
    expect(addTime(['18:30'], '18:30')).toEqual(['18:30']);
    expect(addTime(['18:30'], 'bad')).toEqual(['18:30']);
  });
});

describe('showtimeSchema', () => {
  it('accepts a complete single showtime', () => {
    expect(showtimeSchema.safeParse(filled()).success).toBe(true);
  });

  it('rejects invalid prices and a missing time', () => {
    const result = showtimeSchema.safeParse(
      filled({ time: '', prices: [{ categoryId: '21', name: 'Standard', rupees: '4.555' }] }),
    );
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('time');
    expect(paths).toContain('prices.0.rupees');
  });

  it('requires at least one date and time in bulk mode', () => {
    const result = showtimeSchema.safeParse(filled({ mode: 'bulk', rangeFrom: '', rangeTo: '', times: [] }));
    const paths = result.error?.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['extraDates', 'times']));
  });
});

describe('editing', () => {
  it('prefills from a row: instant → Kathmandu local date/time, paisa → rupees', () => {
    const row: AdminShowtime = {
      id: 99,
      startsAt: '2026-10-22T12:45:00Z',
      endsAt: '2026-10-22T15:05:00Z',
      format: '3D',
      language: 'Nepali',
      status: 'SCHEDULED',
      salesOpen: true,
      movie: { id: 7, title: 'Kabaddi 5' },
      cinema: { id: 3, name: 'Labim Mall' },
      auditorium: { id: 11, name: 'Audi 1' },
      sold: 4,
      held: 2,
      capacity: 120,
      prices: [{ categoryId: 22, name: 'Recliner', priceMinor: 125050 }],
    };
    const values = showtimeToFormValues(row, lookups, TZ, '2026-10-22');
    expect(values.date).toBe('2026-10-22');
    expect(values.time).toBe('18:30');
    expect(values.cinemaId).toBe('3');
    expect(values.prices).toEqual([
      { categoryId: '21', name: 'Standard', rupees: '' },
      { categoryId: '22', name: 'Recliner', rupees: '1250.50' },
    ]);
    // Round trip
    expect(toShowtimeInput({ ...values, prices: values.prices.map((p) => ({ ...p, rupees: p.rupees || '300' })) }, TZ).startsAt).toBe(
      row.startsAt,
    );
  });

  it('keeps entered prices when the auditorium changes to one with the same category', () => {
    const rows = priceRowsFor(lookups.cinemas[0].auditoriums[0], [{ categoryId: '21', name: 'Standard', rupees: '500' }]);
    expect(rows[0].rupees).toBe('500');
    expect(rows[1].rupees).toBe('');
  });
});
