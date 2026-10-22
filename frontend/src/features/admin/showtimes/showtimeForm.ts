import { z } from 'zod';
import { addDays, calendarDateInZone, localToInstant, wallTimeInZone } from '@/lib/dates';
import { paisaToRupees, rupeesToPaisa } from '@/lib/money';
import type { AdminLookups, AdminShowtime, BulkShowtimeInput, ShowtimeInput } from '@/types/api';

/** Upper bound on the dates one bulk request may cover, to catch a mistyped range. */
export const MAX_BULK_DATES = 92;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ScheduleMode = 'single' | 'bulk';

export interface PriceRow {
  categoryId: string;
  name: string;
  rupees: string;
}

/** Form state. Everything is a string so the input and output types of the schema match. */
export interface ShowtimeFormValues {
  mode: ScheduleMode;
  movieId: string;
  cinemaId: string;
  auditoriumId: string;
  /** Single mode: cinema-local calendar date and wall-clock time. */
  date: string;
  time: string;
  /** Bulk mode: an inclusive date range filtered by weekday, plus individually added dates. */
  rangeFrom: string;
  rangeTo: string;
  /** 0 = Sunday … 6 = Saturday, as strings. */
  weekdays: string[];
  extraDates: string[];
  times: string[];
  format: string;
  language: string;
  bufferMinutes: string;
  prices: PriceRow[];
}

export const WEEKDAYS: { value: string; label: string }[] = [
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
  { value: '0', label: 'Sun' },
];

export function emptyShowtimeForm(today: string): ShowtimeFormValues {
  return {
    mode: 'single',
    movieId: '',
    cinemaId: '',
    auditoriumId: '',
    date: today,
    time: '',
    rangeFrom: today,
    rangeTo: addDays(today, 6),
    weekdays: WEEKDAYS.map((w) => w.value),
    extraDates: [],
    times: [],
    format: '',
    language: '',
    bufferMinutes: '',
    prices: [],
  };
}

/** Day of week (0 = Sunday) of a calendar date, independent of the browser's timezone. */
export function weekdayOf(date: string): number {
  if (!DATE_RE.test(date)) throw new Error(`Invalid calendar date: ${date}`);
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Expands an inclusive date range filtered by weekdays, merged with individually chosen dates.
 * Returns sorted, de-duplicated `YYYY-MM-DD` strings. A blank or inverted range contributes nothing.
 */
export function expandBulkDates(from: string, to: string, weekdays: readonly (string | number)[], extra: readonly string[] = []): string[] {
  const out = new Set<string>();
  const days = new Set(weekdays.map((w) => Number(w)));
  if (DATE_RE.test(from) && DATE_RE.test(to) && from <= to) {
    let cursor = from;
    // Guard against an absurd range: stop one past the cap so validation can report it.
    for (let i = 0; cursor <= to && i <= MAX_BULK_DATES * 7; i++) {
      if (days.has(weekdayOf(cursor))) out.add(cursor);
      cursor = addDays(cursor, 1);
    }
  }
  for (const d of extra) if (DATE_RE.test(d)) out.add(d);
  return [...out].sort();
}

/** Normalises "9:05" / "09:05" to "09:05". Returns null for anything that is not a valid 24h time. */
export function normaliseTime(input: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const t = `${m[1].padStart(2, '0')}:${m[2]}`;
  return TIME_RE.test(t) ? t : null;
}

/** Adds a time chip, keeping the list sorted and unique. */
export function addTime(times: readonly string[], input: string): string[] {
  const t = normaliseTime(input);
  if (!t) return [...times];
  return [...new Set([...times, t])].sort();
}

const priceRow = z.object({
  categoryId: z.string(),
  name: z.string(),
  rupees: z
    .string()
    .trim()
    .min(1, 'Enter a price')
    .refine((v) => rupeesToPaisa(v) !== null, 'Enter an amount in rupees, e.g. 450 or 450.50'),
});

export const showtimeSchema = z
  .object({
    mode: z.enum(['single', 'bulk']),
    movieId: z.string().min(1, 'Choose a movie'),
    cinemaId: z.string().min(1, 'Choose a cinema'),
    auditoriumId: z.string().min(1, 'Choose an auditorium'),
    date: z.string(),
    time: z.string(),
    rangeFrom: z.string(),
    rangeTo: z.string(),
    weekdays: z.array(z.string()),
    extraDates: z.array(z.string()),
    times: z.array(z.string()),
    format: z.string().min(1, 'Choose a format'),
    language: z.string().min(1, 'Choose a language'),
    bufferMinutes: z
      .string()
      .trim()
      .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 240), 'Enter whole minutes between 0 and 240'),
    prices: z.array(priceRow).min(1, 'This auditorium has no seat categories to price'),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'single') {
      if (!DATE_RE.test(v.date)) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Choose a date' });
      if (!TIME_RE.test(v.time)) ctx.addIssue({ code: 'custom', path: ['time'], message: 'Choose a start time' });
      return;
    }
    if (v.rangeFrom && v.rangeTo && v.rangeFrom > v.rangeTo) {
      ctx.addIssue({ code: 'custom', path: ['rangeTo'], message: 'The end date must be on or after the start date' });
    }
    const dates = expandBulkDates(v.rangeFrom, v.rangeTo, v.weekdays, v.extraDates);
    if (dates.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['extraDates'], message: 'Choose at least one date' });
    } else if (dates.length > MAX_BULK_DATES) {
      ctx.addIssue({ code: 'custom', path: ['extraDates'], message: `Schedule at most ${MAX_BULK_DATES} dates at a time` });
    }
    if (v.times.length === 0 || v.times.some((t) => !TIME_RE.test(t))) {
      ctx.addIssue({ code: 'custom', path: ['times'], message: 'Add at least one start time' });
    }
  });

function paisaOrThrow(rupees: string): number {
  const p = rupeesToPaisa(rupees);
  if (p === null) throw new Error(`Invalid price: ${rupees}`);
  return p;
}

function common(values: ShowtimeFormValues) {
  const buffer = values.bufferMinutes.trim();
  return {
    movieId: Number(values.movieId),
    auditoriumId: Number(values.auditoriumId),
    format: values.format,
    language: values.language,
    ...(buffer === '' ? {} : { bufferMinutes: Number(buffer) }),
    prices: values.prices.map((p) => ({ categoryId: Number(p.categoryId), priceMinor: paisaOrThrow(p.rupees) })),
  };
}

/** Single showtime: the cinema-local date + time becomes an ISO instant. */
export function toShowtimeInput(values: ShowtimeFormValues, timeZone: string): ShowtimeInput {
  return { ...common(values), startsAt: localToInstant(values.date, values.time, timeZone) };
}

/** Bulk scheduling: dates × times, both cinema-local (the server combines them in the cinema's timezone). */
export function toBulkShowtimeInput(values: ShowtimeFormValues): BulkShowtimeInput {
  return {
    ...common(values),
    dates: expandBulkDates(values.rangeFrom, values.rangeTo, values.weekdays, values.extraDates),
    times: [...new Set(values.times.map((t) => normaliseTime(t)).filter((t): t is string => t !== null))].sort(),
  };
}

type LookupCinema = AdminLookups['cinemas'][number];
type LookupAuditorium = LookupCinema['auditoriums'][number];

/** Price rows for an auditorium's categories, keeping any amounts already entered for the same category. */
export function priceRowsFor(auditorium: LookupAuditorium | undefined, current: readonly PriceRow[] = []): PriceRow[] {
  if (!auditorium) return [];
  return auditorium.categories.map((c) => ({
    categoryId: String(c.id),
    name: c.name,
    rupees: current.find((p) => p.categoryId === String(c.id))?.rupees ?? '',
  }));
}

export function findAuditorium(lookups: AdminLookups | undefined, auditoriumId: number | string) {
  const id = Number(auditoriumId);
  for (const cinema of lookups?.cinemas ?? []) {
    const auditorium = cinema.auditoriums.find((a) => a.id === id);
    if (auditorium) return { cinema, auditorium };
  }
  return null;
}

/** Prefills the edit form from a list row (inverse conversions: instant → local date/time, paisa → rupees). */
export function showtimeToFormValues(row: AdminShowtime, lookups: AdminLookups | undefined, timeZone: string, today: string): ShowtimeFormValues {
  const found = findAuditorium(lookups, row.auditorium.id);
  const existing: PriceRow[] = row.prices.map((p) => ({ categoryId: String(p.categoryId), name: p.name, rupees: paisaToRupees(p.priceMinor) }));
  const prices = found ? priceRowsFor(found.auditorium, existing) : existing;
  return {
    ...emptyShowtimeForm(today),
    mode: 'single',
    movieId: String(row.movie.id),
    cinemaId: String(found?.cinema.id ?? row.cinema.id),
    auditoriumId: String(row.auditorium.id),
    date: calendarDateInZone(row.startsAt, timeZone),
    time: wallTimeInZone(row.startsAt, timeZone),
    format: row.format,
    language: row.language,
    prices,
  };
}
