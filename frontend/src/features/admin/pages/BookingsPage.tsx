import { useNavigate, Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { DataTable, Field, Input, Pagination, Select, type Column } from '@/components/ui';
import { adminApi, adminKeys, useAdminLookups, type BookingFilters } from '@/features/admin/api';
import { AdminPageHeader, FilterBar, StatusPill } from '@/features/admin/components/AdminUi';
import { idParam, useDebouncedFilter, useUrlFilters } from '@/features/admin/ops/useUrlFilters';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatTime } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { formatMoney } from '@/lib/money';
import type { AdminBookingRow, BookingStatus } from '@/types/api';

const PAGE_SIZE = 25;
const STATUSES: BookingStatus[] = ['HELD', 'PAYMENT_PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED'];
const DEFAULTS = { q: '', status: '', from: '', to: '', cinemaId: '' };

export default function BookingsPage() {
  useDocumentTitle('Bookings');
  const navigate = useNavigate();
  const { values, setFilters, page, setPage } = useUrlFilters(DEFAULTS);
  const [q, setQ] = useDebouncedFilter(values.q, (v) => setFilters({ q: v }));
  const lookups = useAdminLookups();

  const params: BookingFilters = {
    q: values.q.trim(),
    status: values.status,
    from: values.from,
    to: values.to,
    cinemaId: idParam(values.cinemaId),
    page,
    size: PAGE_SIZE,
  };
  const query = useQuery({
    queryKey: adminKeys.bookings(params),
    queryFn: () => adminApi.bookings(params),
    placeholderData: keepPreviousData,
  });

  const columns: Column<AdminBookingRow>[] = [
    {
      key: 'reference',
      header: 'Reference',
      cell: (r) => (
        <Link
          to={`/admin/bookings/${encodeURIComponent(r.reference)}`}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-[12.5px] font-semibold text-accent hover:underline"
        >
          {r.reference}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate">{r.customerName ?? <span className="text-subtle">Guest</span>}</div>
          {r.customerEmail && <div className="truncate text-xs text-subtle">{r.customerEmail}</div>}
        </div>
      ),
    },
    {
      key: 'show',
      header: 'Show',
      cell: (r) => (
        <div>
          <div className="font-medium">{r.movieTitle}</div>
          <div className="text-xs text-subtle">
            {r.cinemaName} · {formatDate(r.startsAt, r.timezone)}, {formatTime(r.startsAt, r.timezone)}
          </div>
        </div>
      ),
    },
    {
      key: 'seats',
      header: 'Seats',
      cell: (r) => <span className="text-muted">{r.seatLabels.join(', ') || '—'}</span>,
    },
    { key: 'total', header: 'Total', align: 'right', cell: (r) => <span className="tabular-nums">{formatMoney(r.totalMinor)}</span> },
    { key: 'status', header: 'Status', cell: (r) => <StatusPill status={r.status} /> },
    {
      key: 'created',
      header: 'Booked',
      cell: (r) => <span className="whitespace-nowrap text-xs tabular-nums text-muted">{formatDateTime(r.createdAt, r.timezone)}</span>,
    },
  ];

  const data = query.data;

  return (
    <>
      <AdminPageHeader title="Bookings" description="Search by reference, customer name or email." />
      <FilterBar>
        <Field label="Search">
          {({ id }) => (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <Input id={id} type="search" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference, name or email" />
            </div>
          )}
        </Field>
        <Field label="Status">
          {({ id }) => (
            <Select id={id} value={values.status} onChange={(e) => setFilters({ status: e.target.value })}>
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')}
                </option>
              ))}
            </Select>
          )}
        </Field>
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
        <Field label="From">
          {({ id }) => <Input id={id} type="date" value={values.from} onChange={(e) => setFilters({ from: e.target.value })} />}
        </Field>
        <Field label="To">
          {({ id }) => <Input id={id} type="date" value={values.to} min={values.from || undefined} onChange={(e) => setFilters({ to: e.target.value })} />}
        </Field>
      </FilterBar>

      <DataTable
        caption="Bookings"
        columns={columns}
        rows={data?.items}
        rowKey={(r) => r.reference}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        onRowClick={(r) => navigate(`/admin/bookings/${encodeURIComponent(r.reference)}`)}
        emptyTitle="No bookings found"
        emptyDescription="Try a different search or clear the filters."
        className={cn(query.isPlaceholderData && 'opacity-70 transition-opacity duration-200')}
      />
      {data && <Pagination className="mt-4" page={data.page} totalPages={data.totalPages} totalItems={data.totalItems} onChange={setPage} />}
    </>
  );
}
