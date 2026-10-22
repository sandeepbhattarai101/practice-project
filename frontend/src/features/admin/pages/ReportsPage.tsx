import { useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button, DataTable, EmptyState, ErrorState, Field, Input, ProgressBar, Select, Skeleton, Tabs, toast, type Column } from '@/components/ui';
import { adminApi, adminKeys, useAdminLookups, type OccupancyParams, type SalesParams } from '@/features/admin/api';
import { AdminPageHeader, FilterBar } from '@/features/admin/components/AdminUi';
import { idParam, useUrlFilters } from '@/features/admin/ops/useUrlFilters';
import { useCurrentUser } from '@/features/auth/api';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDays, DEFAULT_TIMEZONE, formatCalendarDate, formatDateTime, todayInZone } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { formatMoney } from '@/lib/money';
import type { OccupancyReport, SalesReport, SalesRow } from '@/types/api';

type Tab = 'sales' | 'occupancy';
type GroupBy = SalesParams['groupBy'];
const GROUPS: { value: GroupBy; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'movie', label: 'Movie' },
  { value: 'cinema', label: 'Cinema' },
];

export default function ReportsPage() {
  useDocumentTitle('Reports');
  const user = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';
  const today = useMemo(() => todayInZone(DEFAULT_TIMEZONE), []);
  const defaults = useMemo(() => ({ tab: 'sales', from: addDays(today, -29), to: today, groupBy: 'day', cinemaId: '' }), [today]);
  const { values, setFilters } = useUrlFilters(defaults);
  const lookups = useAdminLookups();

  const tab: Tab = values.tab === 'occupancy' ? 'occupancy' : 'sales';
  const groupBy: GroupBy = GROUPS.some((g) => g.value === values.groupBy) ? (values.groupBy as GroupBy) : 'day';
  const rangeValid = /^\d{4}-\d{2}-\d{2}$/.test(values.from) && /^\d{4}-\d{2}-\d{2}$/.test(values.to) && values.from <= values.to;
  const cinemaId = idParam(values.cinemaId);

  const salesParams: SalesParams = { from: values.from, to: values.to, groupBy, cinemaId: isAdmin ? cinemaId : '' };
  const occupancyParams: OccupancyParams = { from: values.from, to: values.to, cinemaId };

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      if (tab === 'sales') await adminApi.salesCsv(salesParams);
      else await adminApi.occupancyCsv(occupancyParams);
    } catch (error) {
      toast.error(`The export failed: ${errorMessage(error)}`);
    } finally {
      setExporting(false);
    }
  };

  const showCinema = tab === 'occupancy' || isAdmin;

  return (
    <>
      <AdminPageHeader
        title="Reports"
        description="Dates are cinema-local calendar days, inclusive."
        actions={
          <Button variant="secondary" onClick={exportCsv} loading={exporting} disabled={!rangeValid} leftIcon={<Download className="size-4" aria-hidden />}>
            Export CSV
          </Button>
        }
      />
      <Tabs<Tab>
        idBase="reports"
        label="Report"
        value={tab}
        onChange={(t) => setFilters({ tab: t })}
        items={[
          { value: 'sales', label: 'Sales' },
          { value: 'occupancy', label: 'Occupancy' },
        ]}
        className="mb-4"
      />
      <div id="reports-panel" role="tabpanel" aria-labelledby={`reports-tab-${tab}`}>
        <FilterBar>
          <Field label="From" error={rangeValid ? undefined : 'Choose a valid range'}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="date" value={values.from} max={values.to || undefined} onChange={(e) => setFilters({ from: e.target.value })} aria-describedby={describedBy} aria-invalid={invalid} />
            )}
          </Field>
          <Field label="To">
            {({ id }) => <Input id={id} type="date" value={values.to} min={values.from || undefined} onChange={(e) => setFilters({ to: e.target.value })} />}
          </Field>
          {tab === 'sales' && (
            <Field label="Group by">
              {({ id }) => (
                <Select id={id} value={groupBy} onChange={(e) => setFilters({ groupBy: e.target.value })}>
                  {GROUPS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {showCinema && (
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
          )}
        </FilterBar>
        {!rangeValid ? (
          <EmptyState title="Choose a date range" description="The start date must be on or before the end date." />
        ) : tab === 'sales' ? (
          <SalesTable params={salesParams} />
        ) : (
          <OccupancyTable params={occupancyParams} />
        )}
      </div>
    </>
  );
}

const MONEY_COLUMNS: { key: keyof Pick<SalesRow, 'grossMinor' | 'discountMinor' | 'feeMinor' | 'taxMinor' | 'totalMinor'>; label: string }[] = [
  { key: 'grossMinor', label: 'Gross' },
  { key: 'discountMinor', label: 'Discounts' },
  { key: 'feeMinor', label: 'Fees' },
  { key: 'taxMinor', label: 'Tax' },
  { key: 'totalMinor', label: 'Total' },
];

function rowLabel(row: SalesRow, groupBy: GroupBy): string {
  if (groupBy === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(row.key)) return formatCalendarDate(row.key);
  return row.label || row.key;
}

function SalesTable({ params }: { params: SalesParams }) {
  const query = useQuery({ queryKey: adminKeys.sales(params), queryFn: () => adminApi.sales(params), placeholderData: keepPreviousData });
  const th = 'whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-subtle';
  const groupLabel = GROUPS.find((g) => g.value === params.groupBy)?.label ?? 'Group';

  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} compact />;

  const data: SalesReport | undefined = query.data;
  const cell = (children: ReactNode, className?: string, key?: string) => <td key={key} className={cn('px-3 py-2.5 text-right tabular-nums', className)}>{children}</td>;

  return (
    <div className={cn('overflow-x-auto rounded-lg border border-line bg-surface', query.isPlaceholderData && 'opacity-70 transition-opacity duration-200')}>
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <caption className="sr-only">Sales by {groupLabel.toLowerCase()}</caption>
        <thead>
          <tr className="border-b border-line bg-elevated/50">
            <th scope="col" className={cn(th, 'text-left')}>
              {groupLabel}
            </th>
            <th scope="col" className={cn(th, 'text-right')}>
              Bookings
            </th>
            <th scope="col" className={cn(th, 'text-right')}>
              Tickets
            </th>
            {MONEY_COLUMNS.map((c) => (
              <th key={c.key} scope="col" className={cn(th, 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody aria-busy={query.isPending || undefined}>
          {query.isPending &&
            Array.from({ length: 8 }, (_, i) => (
              <tr key={i} className="border-b border-line/60">
                {Array.from({ length: 8 }, (_, j) => (
                  <td key={j} className="px-3 py-3">
                    <Skeleton className={cn('h-4', j === 0 ? 'w-32' : 'ml-auto w-16')} />
                  </td>
                ))}
              </tr>
            ))}
          {data?.rows.map((r) => (
            <tr key={r.key} className="border-b border-line/60 last:border-0">
              <th scope="row" className="px-3 py-2.5 text-left font-medium text-fg">
                {rowLabel(r, params.groupBy)}
              </th>
              {cell(r.bookings)}
              {cell(r.tickets)}
              {MONEY_COLUMNS.map((c) =>
                cell(c.key === 'discountMinor' && r[c.key] > 0 ? `−${formatMoney(r[c.key])}` : formatMoney(r[c.key]), c.key === 'totalMinor' ? 'font-medium text-fg' : 'text-muted', c.key),
              )}
            </tr>
          ))}
        </tbody>
        {data && data.rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-line-strong bg-elevated/40 font-semibold">
              <th scope="row" className="px-3 py-3 text-left text-fg">
                Total
              </th>
              {cell(data.totals.bookings, 'text-fg')}
              {cell(data.totals.tickets, 'text-fg')}
              {MONEY_COLUMNS.map((c) =>
                cell(
                  c.key === 'discountMinor' && data.totals[c.key] > 0 ? `−${formatMoney(data.totals[c.key])}` : formatMoney(data.totals[c.key]),
                  c.key === 'totalMinor' ? 'text-accent' : 'text-fg',
                  c.key,
                ),
              )}
            </tr>
          </tfoot>
        )}
      </table>
      {data && data.rows.length === 0 && <EmptyState title="No sales in this period" description="Try a wider date range." className="m-4 border-0" />}
    </div>
  );
}

type OccupancyRow = OccupancyReport['rows'][number];

function OccupancyTable({ params }: { params: OccupancyParams }) {
  const query = useQuery({ queryKey: adminKeys.occupancy(params), queryFn: () => adminApi.occupancy(params), placeholderData: keepPreviousData });

  const columns: Column<OccupancyRow>[] = [
    {
      key: 'start',
      header: 'Show',
      cell: (r) => <span className="whitespace-nowrap tabular-nums">{formatDateTime(r.startsAt, DEFAULT_TIMEZONE)}</span>,
    },
    { key: 'movie', header: 'Movie', cell: (r) => <span className="font-medium">{r.movieTitle}</span> },
    {
      key: 'venue',
      header: 'Cinema / auditorium',
      cell: (r) => (
        <div>
          <div>{r.cinemaName}</div>
          <div className="text-xs text-subtle">{r.auditoriumName}</div>
        </div>
      ),
    },
    {
      key: 'occupancy',
      header: 'Sold',
      cell: (r) => <ProgressBar value={r.sold} max={r.capacity} label={`${r.sold} of ${r.capacity} seats sold`} />,
    },
    {
      key: 'percent',
      header: 'Occupancy',
      align: 'right',
      cell: (r) => <span className="font-medium tabular-nums">{Number.isFinite(r.occupancyPercent) ? `${r.occupancyPercent.toFixed(1).replace(/\.0$/, '')}%` : '—'}</span>,
    },
  ];

  const rows = query.data?.rows;
  const average = rows && rows.length > 0 ? rows.reduce((s, r) => s + r.sold, 0) / Math.max(1, rows.reduce((s, r) => s + r.capacity, 0)) : null;

  return (
    <>
      {average !== null && (
        <p className="mb-3 text-sm text-muted">
          {rows?.length} shows · overall <span className="font-semibold text-fg">{(average * 100).toFixed(1).replace(/\.0$/, '')}%</span> of seats sold
        </p>
      )}
      <DataTable
        caption="Occupancy by showtime"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.showtimeId}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        emptyTitle="No shows in this period"
        emptyDescription="Try a wider date range or another cinema."
        className={cn(query.isPlaceholderData && 'opacity-70 transition-opacity duration-200')}
      />
    </>
  );
}
