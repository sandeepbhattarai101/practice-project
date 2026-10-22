import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { DataTable, Field, Input, Pagination, Select, type Column } from '@/components/ui';
import { adminApi, adminKeys } from '@/features/admin/api';
import { AdminPageHeader, FilterBar, StatusPill, humanise } from '@/features/admin/components/AdminUi';
import { paymentView, providerLabel } from '@/features/admin/ops/payments';
import { useDebouncedFilter, useUrlFilters } from '@/features/admin/ops/useUrlFilters';
import { cn } from '@/lib/cn';
import { DEFAULT_TIMEZONE, formatDateTime } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { formatMoney } from '@/lib/money';
import type { AdminPayment, PaymentStatus, ProviderCode } from '@/types/api';

const PAGE_SIZE = 25;
const STATUSES: PaymentStatus[] = ['INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'];
const PROVIDERS: ProviderCode[] = ['ESEWA', 'KHALTI', 'DEV_SANDBOX'];
const DEFAULTS = { q: '', status: '', provider: '' };


export default function PaymentsPage() {
  useDocumentTitle('Payments');
  const navigate = useNavigate();
  const { values, setFilters, page, setPage } = useUrlFilters(DEFAULTS);
  const [q, setQ] = useDebouncedFilter(values.q, (v) => setFilters({ q: v }));

  const params = { q: values.q.trim(), status: values.status, provider: values.provider, page, size: PAGE_SIZE };
  const query = useQuery({
    queryKey: adminKeys.payments(params),
    queryFn: () => adminApi.payments(params),
    placeholderData: keepPreviousData,
  });

  const columns: Column<AdminPayment>[] = [
    {
      key: 'id',
      header: 'Payment',
      cell: (r) => (
        <Link to={`/admin/payments/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12.5px] font-semibold text-accent hover:underline">
          #{r.id}
        </Link>
      ),
    },
    {
      key: 'booking',
      header: 'Booking',
      cell: (r) => {
        const ref = paymentView(r).bookingReference;
        return ref ? (
          <Link
            to={`/admin/bookings/${encodeURIComponent(ref)}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-[12.5px] text-fg hover:text-accent hover:underline"
          >
            {ref}
          </Link>
        ) : (
          <span className="text-subtle">—</span>
        );
      },
    },
    { key: 'provider', header: 'Provider', cell: (r) => providerLabel(r.provider) },
    { key: 'status', header: 'Status', cell: (r) => <StatusPill status={r.status} /> },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (r) => {
        const v = paymentView(r);
        return <span className="tabular-nums">{v.amountMinor === null ? '—' : formatMoney(v.amountMinor)}</span>;
      },
    },
    {
      key: 'providerRef',
      header: 'Provider ref.',
      cell: (r) => <span className="font-mono text-xs text-muted">{paymentView(r).providerRef ?? '—'}</span>,
    },
    {
      key: 'created',
      header: 'Created',
      cell: (r) => {
        const v = paymentView(r);
        return <span className="whitespace-nowrap text-xs tabular-nums text-muted">{v.createdAt ? formatDateTime(v.createdAt, DEFAULT_TIMEZONE) : '—'}</span>;
      },
    },
  ];

  const data = query.data;

  return (
    <>
      <AdminPageHeader title="Payments" description={`Gateway payments. Times in ${DEFAULT_TIMEZONE}.`} />
      <FilterBar>
        <Field label="Search">
          {({ id }) => (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <Input id={id} type="search" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Booking reference or provider ref." />
            </div>
          )}
        </Field>
        <Field label="Status">
          {({ id }) => (
            <Select id={id} value={values.status} onChange={(e) => setFilters({ status: e.target.value })}>
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanise(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Provider">
          {({ id }) => (
            <Select id={id} value={values.provider} onChange={(e) => setFilters({ provider: e.target.value })}>
              <option value="">All providers</option>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {providerLabel(p)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FilterBar>
      <DataTable
        caption="Payments"
        columns={columns}
        rows={data?.items}
        rowKey={(r) => r.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        onRowClick={(r) => navigate(`/admin/payments/${r.id}`)}
        emptyTitle="No payments found"
        emptyDescription="Try a different search or clear the filters."
        className={cn(query.isPlaceholderData && 'opacity-70 transition-opacity duration-200')}
      />
      {data && <Pagination className="mt-4" page={data.page} totalPages={data.totalPages} totalItems={data.totalItems} onChange={setPage} />}
    </>
  );
}
