import { useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarPlus, Lock, Plus, X } from 'lucide-react';
import { Badge, Button, Checkbox, Dialog, Field, FormError, Input, Select, toast } from '@/components/ui';
import { adminApi, adminKeys } from '@/features/admin/api';
import { applyServerFieldErrors } from '@/features/admin/ops/shared';
import { errorMessage, isApiErrorCode } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatCalendarDate, formatDateTime } from '@/lib/dates';
import type { AdminLookups, AdminShowtime, BulkShowtimeResult } from '@/types/api';
import {
  addTime,
  expandBulkDates,
  findAuditorium,
  MAX_BULK_DATES,
  priceRowsFor,
  showtimeSchema,
  showtimeToFormValues,
  toBulkShowtimeInput,
  toShowtimeInput,
  WEEKDAYS,
  emptyShowtimeForm,
  type ShowtimeFormValues,
} from './showtimeForm';

const FIELD_NAMES = ['movieId', 'auditoriumId', 'date', 'time', 'format', 'language', 'bufferMinutes', 'times', 'extraDates'] as const;
const FIELD_MAP = { startsAt: 'time', dates: 'extraDates' } as const;

export function ShowtimeFormDialog({
  open,
  onClose,
  lookups,
  editing,
  timeZone,
  today,
}: {
  open: boolean;
  onClose: () => void;
  lookups: AdminLookups | undefined;
  /** The row being edited, or null to create. */
  editing: AdminShowtime | null;
  timeZone: string;
  today: string;
}) {
  if (!open) return null;
  return (
    <ShowtimeForm
      key={editing?.id ?? 'new'}
      onClose={onClose}
      lookups={lookups}
      editing={editing}
      timeZone={timeZone}
      today={today}
    />
  );
}

function ShowtimeForm({
  onClose,
  lookups,
  editing,
  timeZone,
  today,
}: {
  onClose: () => void;
  lookups: AdminLookups | undefined;
  editing: AdminShowtime | null;
  timeZone: string;
  today: string;
}) {
  const queryClient = useQueryClient();
  const defaultValues = useMemo(
    () => (editing ? showtimeToFormValues(editing, lookups, timeZone, today) : emptyShowtimeForm(today)),
    [editing, lookups, timeZone, today],
  );
  const form = useForm<ShowtimeFormValues>({ resolver: zodResolver(showtimeSchema), defaultValues });
  const { register, handleSubmit, watch, setValue, setError, formState, control, getValues } = form;
  const { errors } = formState;
  const prices = useFieldArray({ control, name: 'prices' });

  const [serverError, setServerError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkShowtimeResult | null>(null);
  const [timeDraft, setTimeDraft] = useState('');
  const [dateDraft, setDateDraft] = useState('');

  const mode = watch('mode');
  const movieId = watch('movieId');
  const cinemaId = watch('cinemaId');
  const auditoriumId = watch('auditoriumId');
  const times = watch('times');
  const extraDates = watch('extraDates');
  const rangeFrom = watch('rangeFrom');
  const rangeTo = watch('rangeTo');
  const weekdays = watch('weekdays');

  const movies = lookups?.movies ?? [];
  const cinemas = lookups?.cinemas ?? [];
  const movie = movies.find((m) => String(m.id) === movieId);
  const cinema = cinemas.find((c) => String(c.id) === cinemaId);
  const auditorium = cinema?.auditoriums.find((a) => String(a.id) === auditoriumId) ?? findAuditorium(lookups, auditoriumId)?.auditorium;
  const formats = auditorium?.formats ?? [];
  const languages = movie?.languages ?? [];

  const bulkDates = mode === 'bulk' ? expandBulkDates(rangeFrom, rangeTo, weekdays, extraDates) : [];
  const bulkCount = bulkDates.length * times.length;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'showtimes'] });

  const handleError = (error: unknown) => {
    if (isApiErrorCode(error, 'SHOWTIME_OVERLAP')) {
      setOverlap(error.message);
      setError('time', { type: 'server', message: 'This time overlaps another show in the auditorium' });
      return;
    }
    applyServerFieldErrors(error, setError, FIELD_NAMES, FIELD_MAP);
    setServerError(errorMessage(error));
  };

  const save = useMutation({
    mutationFn: (values: ShowtimeFormValues) => {
      const body = toShowtimeInput(values, timeZone);
      return editing ? adminApi.updateShowtime(editing.id, body) : adminApi.createShowtime(body);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(editing ? 'Showtime updated' : 'Showtime scheduled');
      onClose();
    },
    onError: handleError,
  });

  const bulk = useMutation({
    mutationFn: (values: ShowtimeFormValues) => adminApi.bulkShowtimes(toBulkShowtimeInput(values)),
    onSuccess: async (result) => {
      await invalidate();
      setBulkResult(result);
    },
    onError: handleError,
  });

  const pending = save.isPending || bulk.isPending;

  const onSubmit = handleSubmit((values) => {
    setServerError(null);
    setOverlap(null);
    if (values.mode === 'bulk') bulk.mutate(values);
    else save.mutate(values);
  });

  const movieField = register('movieId', {
    onChange: () => {
      const m = movies.find((x) => String(x.id) === getValues('movieId'));
      const langs = m?.languages ?? [];
      const current = getValues('language');
      if (!langs.includes(current)) setValue('language', langs.length === 1 ? langs[0] : '');
    },
  });
  const cinemaField = register('cinemaId', {
    onChange: () => {
      setValue('auditoriumId', '');
      setValue('format', '');
      prices.replace([]);
    },
  });
  const auditoriumField = register('auditoriumId', {
    onChange: () => {
      const c = cinemas.find((x) => String(x.id) === getValues('cinemaId'));
      const a = c?.auditoriums.find((x) => String(x.id) === getValues('auditoriumId'));
      prices.replace(priceRowsFor(a, getValues('prices')));
      const f = a?.formats ?? [];
      if (!f.includes(getValues('format'))) setValue('format', f.length === 1 ? f[0] : '');
    },
  });

  const addTimeChip = () => {
    const next = addTime(getValues('times'), timeDraft);
    if (next.length === getValues('times').length) return;
    setValue('times', next, { shouldValidate: formState.isSubmitted });
    setTimeDraft('');
  };
  const addDateChip = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDraft)) return;
    setValue('extraDates', [...new Set([...getValues('extraDates'), dateDraft])].sort(), { shouldValidate: formState.isSubmitted });
    setDateDraft('');
  };

  const locked = editing !== null && editing.sold > 0;
  const title = editing ? 'Edit showtime' : 'Schedule showtimes';

  if (bulkResult) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Bulk scheduling complete"
        size="lg"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <p className="text-sm text-fg">
          <span className="font-display text-2xl text-accent">{bulkResult.created}</span>{' '}
          {bulkResult.created === 1 ? 'showtime was' : 'showtimes were'} created.
        </p>
        {bulkResult.conflicts.length > 0 ? (
          <div className="mt-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-warning">
              <AlertTriangle className="size-4" aria-hidden />
              {bulkResult.conflicts.length} {bulkResult.conflicts.length === 1 ? 'slot was' : 'slots were'} skipped
            </h3>
            <ul className="mt-2 divide-y divide-line rounded-md border border-line">
              {bulkResult.conflicts.map((c) => (
                <li key={c.startsAt} className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-4">
                  <span className="shrink-0 tabular-nums text-fg">{formatDateTime(c.startsAt, timeZone)}</span>
                  <span className="text-muted">{c.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">There were no conflicts.</p>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!pending}
      title={title}
      description={`Times are local to the cinema (${timeZone}).`}
      variant="drawer-right"
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="showtime-form" loading={pending}>
            {editing ? 'Save changes' : mode === 'bulk' ? (bulkCount ? `Create ${bulkCount} showtimes` : 'Create showtimes') : 'Schedule showtime'}
          </Button>
        </>
      }
    >
      <form id="showtime-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {!editing && (
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-muted">Scheduling</legend>
            <div className="inline-flex rounded-md border border-line bg-canvas p-1" role="radiogroup" aria-label="Scheduling mode">
              {(['single', 'bulk'] as const).map((m) => (
                <label
                  key={m}
                  className={cn(
                    'cursor-pointer rounded-sm px-3 py-1.5 text-sm font-semibold transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                    mode === m ? 'bg-raised text-fg' : 'text-subtle hover:text-fg',
                  )}
                >
                  <input type="radio" value={m} {...register('mode')} className="sr-only" />
                  {m === 'single' ? 'Single showtime' : 'Bulk schedule'}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {editing && locked && (
          <div className="flex gap-2.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-fg">
            <Lock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p>
              {editing.sold} {editing.sold === 1 ? 'seat has' : 'seats have'} been sold, so the start time and auditorium are locked. The
              server will reject changes to them; prices, format and language can still be updated.
            </p>
          </div>
        )}

        {overlap && (
          <div role="alert" className="flex gap-2.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <div>
              <p className="font-semibold">This clashes with another show</p>
              <p className="mt-0.5 text-muted">{overlap}</p>
            </div>
          </div>
        )}
        <FormError message={overlap ? null : serverError} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Movie" required error={errors.movieId?.message}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...movieField}>
                <option value="">Choose a movie</option>
                {movies.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                    {m.status && m.status !== 'PUBLISHED' ? ` (${m.status.toLowerCase()})` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Cinema" required error={errors.cinemaId?.message}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...cinemaField}>
                <option value="">Choose a cinema</option>
                {cinemas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Auditorium" required error={errors.auditoriumId?.message}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} disabled={!cinema} {...auditoriumField}>
                <option value="">{cinema ? 'Choose an auditorium' : 'Choose a cinema first'}</option>
                {cinema?.auditoriums.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.formats.join(', ')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Format" required error={errors.format?.message} hint={auditorium ? undefined : 'Formats come from the auditorium'}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} disabled={!auditorium} {...register('format')}>
                <option value="">Choose a format</option>
                {formats.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Language" required error={errors.language?.message} hint={movie ? undefined : 'Languages come from the movie'}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} disabled={!movie} {...register('language')}>
                <option value="">Choose a language</option>
                {languages.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Cleaning buffer (minutes)" error={errors.bufferMinutes?.message} hint="Optional. Leave blank for the default.">
            {({ id, describedBy, invalid }) => (
              <Input id={id} inputMode="numeric" aria-describedby={describedBy} aria-invalid={invalid} {...register('bufferMinutes')} />
            )}
          </Field>
        </div>

        {mode === 'single' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Date" required error={errors.date?.message}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="date" aria-describedby={describedBy} aria-invalid={invalid} {...register('date')} />
              )}
            </Field>
            <Field label="Start time" required error={errors.time?.message}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="time" step={300} aria-describedby={describedBy} aria-invalid={invalid} {...register('time')} />
              )}
            </Field>
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded-lg border border-line bg-canvas/60 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="From" error={errors.rangeFrom?.message}>
                {({ id, describedBy, invalid }) => (
                  <Input id={id} type="date" aria-describedby={describedBy} aria-invalid={invalid} {...register('rangeFrom')} />
                )}
              </Field>
              <Field label="To" error={errors.rangeTo?.message}>
                {({ id, describedBy, invalid }) => (
                  <Input id={id} type="date" aria-describedby={describedBy} aria-invalid={invalid} {...register('rangeTo')} />
                )}
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium text-muted">On these days</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {WEEKDAYS.map((w) => (
                  <Checkbox key={w.value} label={w.label} value={w.value} {...register('weekdays')} />
                ))}
              </div>
            </fieldset>

            <div>
              <p className="mb-1.5 text-[13px] font-medium text-muted" id="extra-dates-label">
                Additional dates
              </p>
              <div className="flex gap-2">
                <Input
                  type="date"
                  aria-labelledby="extra-dates-label"
                  value={dateDraft}
                  onChange={(e) => setDateDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addDateChip();
                    }
                  }}
                  className="max-w-[200px]"
                />
                <Button variant="secondary" onClick={addDateChip} leftIcon={<CalendarPlus className="size-4" aria-hidden />} disabled={!dateDraft}>
                  Add date
                </Button>
              </div>
              {extraDates.length > 0 && (
                <ChipList
                  items={extraDates.map((d) => ({ value: d, label: formatCalendarDate(d) }))}
                  onRemove={(d) => setValue('extraDates', extraDates.filter((x) => x !== d))}
                  label="date"
                />
              )}
              {errors.extraDates?.message && <p className="mt-1.5 text-xs font-medium text-danger">{errors.extraDates.message}</p>}
            </div>

            <div>
              <p className="mb-1.5 text-[13px] font-medium text-muted" id="times-label">
                Start times <span className="text-accent" aria-hidden>*</span>
              </p>
              <div className="flex gap-2">
                <Input
                  type="time"
                  step={300}
                  aria-labelledby="times-label"
                  value={timeDraft}
                  onChange={(e) => setTimeDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTimeChip();
                    }
                  }}
                  className="max-w-[160px]"
                />
                <Button variant="secondary" onClick={addTimeChip} leftIcon={<Plus className="size-4" aria-hidden />} disabled={!timeDraft}>
                  Add time
                </Button>
              </div>
              {times.length > 0 && (
                <ChipList items={times.map((t) => ({ value: t, label: t }))} onRemove={(t) => setValue('times', times.filter((x) => x !== t))} label="time" />
              )}
              {errors.times?.message && <p className="mt-1.5 text-xs font-medium text-danger">{errors.times.message}</p>}
            </div>

            <p className="text-sm text-muted" aria-live="polite">
              {bulkDates.length} {bulkDates.length === 1 ? 'date' : 'dates'} × {times.length} {times.length === 1 ? 'time' : 'times'} ={' '}
              <span className="font-semibold text-fg">{bulkCount} showtimes</span>
              {bulkDates.length > MAX_BULK_DATES && <span className="text-danger"> (too many dates)</span>}
              {bulkDates.length > 0 && bulkDates.length <= 6 && (
                <span className="text-subtle"> · {bulkDates.map(formatCalendarDate).join(', ')}</span>
              )}
            </p>
          </div>
        )}

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-muted">
            Ticket prices <span className="text-subtle">(rupees, per seat category)</span>
          </legend>
          {prices.fields.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-sm text-subtle">
              {auditorium ? 'This auditorium has no seat categories yet. Set up its layout first.' : 'Choose an auditorium to set prices.'}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {prices.fields.map((p, i) => (
                <Field key={p.id} label={p.name} required error={errors.prices?.[i]?.rupees?.message}>
                  {({ id, describedBy, invalid }) => (
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-subtle">Rs.</span>
                      <Input
                        id={id}
                        inputMode="decimal"
                        className="pl-10 tabular-nums"
                        aria-describedby={describedBy}
                        aria-invalid={invalid}
                        {...register(`prices.${i}.rupees` as const)}
                      />
                    </div>
                  )}
                </Field>
              ))}
            </div>
          )}
          {errors.prices?.message && <p className="mt-1.5 text-xs font-medium text-danger">{errors.prices.message}</p>}
          {errors.prices?.root?.message && <p className="mt-1.5 text-xs font-medium text-danger">{errors.prices.root.message}</p>}
        </fieldset>

        {editing && (
          <p className="text-xs text-subtle">
            Currently <Badge tone="outline">{editing.status}</Badge> · {editing.sold} sold · {editing.held} held of {editing.capacity}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function ChipList({ items, onRemove, label }: { items: { value: string; label: string }[]; onRemove: (value: string) => void; label: string }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item.value} className="inline-flex h-7 items-center gap-1 rounded-sm border border-line-strong bg-raised pl-2.5 pr-1 text-[13px] tabular-nums text-fg">
          {item.label}
          <button
            type="button"
            onClick={() => onRemove(item.value)}
            className="grid size-5 place-items-center rounded-xs text-subtle transition-colors hover:bg-line-strong hover:text-fg"
            aria-label={`Remove ${label} ${item.label}`}
          >
            <X className="size-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
