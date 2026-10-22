import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarPlus, Pencil } from 'lucide-react';
import { Button, DataTable, Field, Input, Pagination, ProgressBar, Select, toast, type Column } from '@/components/ui';
import { adminApi, adminKeys, useAdminLookups, type ShowtimeFilters } from '@/features/admin/api';
import { AdminPageHeader, FilterBar, StatusPill } from '@/features/admin/components/AdminUi';
import { idParam, useUrlFilters } from '@/features/admin/ops/useUrlFilters';
import { CancelShowtimeDialog } from '@/features/admin/showtimes/CancelShowtimeDialog';
import { ShowtimeFormDialog } from '@/features/admin/showtimes/ShowtimeFormDialog';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { DEFAULT_TIMEZONE, formatDate, formatTime, todayInZone } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import type { AdminShowtime } from '@/types/api';

/**
 * The admin showtime row and the lookups carry no timezone, so times are shown and entered
 * in the platform default (Asia/Kathmandu). Every seeded cinema is in that zone.
 */
const TZ = DEFAULT_TIMEZONE;
const PAGE_SIZE = 25;

/** Showtime statuses are not enumerated by the contract; these are the values the UI offers. */
const STATUSES = ['SCHEDULED', 'CANCELLED', 'COMPLETED'];

export default function ShowtimesPage() {
  useDocumentTitle('Showtimes');
  const today = useMemo(() => todayInZone(TZ), []);
  const defaults = useMemo(() => ({ cinemaId: '', movieId: '', from: today, to: '', status: '' }), [today]);
  const { values, setFilters, page, setPage } = useUrlFilters(defaults);
  const lookups = useAdminLookups();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminShowtime | null>(null);
  const [cancelling, setCancelling] = useState<AdminShowtime | null>(null);

  const params: ShowtimeFilters = {
    cinemaId: idParam(values.cinemaId),
    movieId: idParam(values.movieId),
    from: values.from,
    to: values.to,
    status: values.status,
    page,
    size: PAGE_SIZE,
  };
  const query = useQuery({
    queryKey: adminKeys.showtimes(params),
    queryFn: () => adminApi.showtimes(params),
    placeholderData: keepPreviousData,
  });

  const sales = useMutation({
    mutationFn: ({ id, open }: { id: number; open: boolean }) => adminApi.setShowtimeSales(id, open),
    onSuccess: async (_data, vars) => {
      await queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'showtimes'] });
      toast.success(vars.open ? 'Sales opened' : 'Sales closed');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (row: AdminShowtime) => {
    setEditing(row);
    setFormOpen(true);
  };

  const columns: Column<AdminShowtime>[] = [
    {
      key: 'start',
      header: 'Starts',
      cell: (r) => (
        <div className="whitespace-nowrap tabular-nums">
          <div className="font-medium text-fg">{formatTime(r.startsAt, TZ)}</div>
          <div className="text-xs text-subtle">{formatDate(r.startsAt, TZ)}</div>
        </div>
      ),
    },
    { key: 'movie', header: 'Movie', cell: (r) => <span className="font-medium">{r.movie.title}</span> },
    {
      key: 'venue',
      header: 'Cinema / auditorium',
      cell: (r) => (
        <div>
          <div>{r.cinema.name}</div>
          <div className="text-xs text-subtle">{r.auditorium.name}</div>
        </div>
      ),
    },
    {
      key: 'format',
      header: 'Format',
      cell: (r) => (
        <div className="whitespace-nowrap">
          <span className="text-fg">{r.format}</span>
          <span className="text-subtle"> · {r.language}</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (r) => <StatusPill status={r.status} /> },
    {
      key: 'sales',
      header: 'Sales',
      cell: (r) => (
        <SalesSwitch
          checked={r.salesOpen}
          disabled={r.status === 'CANCELLED' || (sales.isPending && sales.variables?.id === r.id)}
          label={`Sales for ${r.movie.title} at ${formatTime(r.startsAt, TZ)} on ${formatDate(r.startsAt, TZ)}`}
          onChange={(open) => sales.mutate({ id: r.id, open })}
        />
      ),
    },
    {
      key: 'occupancy',
      header: 'Occupancy',
      cell: (r) => <ProgressBar value={r.sold} max={r.capacity} secondary={r.held} label={`${r.sold} sold, ${r.held} held of ${r.capacity}`} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) =>
        r.status === 'CANCELLED' ? null : (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => openEdit(r)} aria-label={`Edit ${r.movie.title} at ${formatTime(r.startsAt, TZ)}`}>
              <Pencil className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="hover:text-danger"
              onClick={() => setCancelling(r)}
              aria-label={`Cancel ${r.movie.title} at ${formatTime(r.startsAt, TZ)}`}
            >
              <Ban className="size-4" aria-hidden />
            </Button>
          </div>
        ),
    },
  ];

  const data = query.data;

  return (
    <>
      <AdminPageHeader
        title="Showtimes"
        description={`Schedule and manage screenings. Times are shown in ${TZ}.`}
        actions={
          <Button onClick={openCreate} leftIcon={<CalendarPlus className="size-4" aria-hidden />} disabled={!lookups.data}>
            Schedule
          </Button>
        }
      />
      <FilterBar>
        <Field label="Cinema">
          {({ id }) => (
            <Select id={id} value={values.cinemaId} onChange={(e) => setFilters({ cinemaId: e.target.value })}>
              <option value="">All cinemas</option>
              {lookups.data?.cinemas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Movie">
          {({ id }) => (
            <Select id={id} value={values.movieId} onChange={(e) => setFilters({ movieId: e.target.value })}>
              <option value="">All movies</option>
              {lookups.data?.movies.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="From">
          {({ id }) => <Input id={id} type="date" value={values.from} onChange={(e) => setFilters({ from: e.target.value })} />}
        </Field>
        <Field label="To">
          {({ id }) => <Input id={id} type="date" value={values.to} min={values.from || undefined} onChange={(e) => setFilters({ to: e.target.value })} />}
        </Field>
        <Field label="Status">
          {({ id }) => (
            <Select id={id} value={values.status} onChange={(e) => setFilters({ status: e.target.value })}>
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FilterBar>

      <DataTable
        caption="Showtimes"
        columns={columns}
        rows={data?.items}
        rowKey={(r) => r.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        emptyTitle="No showtimes match these filters"
        emptyDescription="Try a wider date range, or schedule new showtimes."
        className={cn(query.isPlaceholderData && 'opacity-70 transition-opacity duration-200')}
      />
      {data && <Pagination className="mt-4" page={data.page} totalPages={data.totalPages} totalItems={data.totalItems} onChange={setPage} />}

      <ShowtimeFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        lookups={lookups.data}
        editing={editing}
        timeZone={TZ}
        today={today}
      />
      <CancelShowtimeDialog showtime={cancelling} onClose={() => setCancelling(null)} timeZone={TZ} />
    </>
  );
}

function SalesSwitch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors duration-200',
          checked ? 'border-success/50 bg-success/25' : 'border-line-strong bg-raised',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-3.5 rounded-full transition-transform duration-200',
            checked ? 'translate-x-[18px] bg-success' : 'translate-x-0.5 bg-subtle',
          )}
        />
      </span>
      <span className={checked ? 'text-success' : 'text-subtle'}>{checked ? 'Open' : 'Closed'}</span>
    </button>
  );
}
