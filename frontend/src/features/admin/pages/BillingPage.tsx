import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, adminKeys, type InvoiceFilters } from '../api';
import { AdminPageHeader, FilterBar } from '../components/AdminUi';
import { Badge, Button, DataTable, ErrorState, Field, Input, Pagination, Select, Skeleton, type Column } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks';
import type { Invoice, InvoiceKind } from '@/types/api';

const PAGE_SIZE = 25;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</p>
      <p className="mt-1.5 font-display text-2xl tabular-nums text-fg">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

export default function BillingPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const kindParam = params.get('kind');
  const kind: InvoiceKind | '' = kindParam === 'INVOICE' || kindParam === 'CREDIT_NOTE' ? kindParam : '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const q = params.get('q') ?? '';
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const [search, setSearch] = useState(q);
  const debounced = useDebouncedValue(search.trim(), 300);
  const [exporting, setExporting] = useState(false);
  useDocumentTitle('Billing');

  const set = (patch: Record<string, string>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace });
  };

  useEffect(() => {
    if (debounced !== q) set({ q: debounced }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced value
  }, [debounced]);

  const filters = { q: q || undefined, kind, from: from || undefined, to: to || undefined };
  const listParams: InvoiceFilters = { ...filters, page, size: PAGE_SIZE };
  const list = useQuery({ queryKey: adminKeys.invoices(listParams), queryFn: () => adminApi.invoices(listParams), placeholderData: keepPreviousData });
  const summary = useQuery({ queryKey: adminKeys.invoiceSummary(filters), queryFn: () => adminApi.invoiceSummary(filters), placeholderData: keepPreviousData });

  const exportCsv = async () => {
    setExporting(true);
    try {
      await adminApi.invoicesCsv(filters);
    } catch (e) {
      toast.error(`Export failed: ${errorMessage(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<Invoice>[] = [
    { key: 'number', header: 'Number', cell: (i) => <span className="font-mono text-[13px]">{i.number}</span> },
    {
      key: 'kind',
      header: 'Type',
      cell: (i) => <Badge tone={i.kind === 'CREDIT_NOTE' ? 'warning' : 'success'}>{i.kind === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice'}</Badge>,
    },
    { key: 'issued', header: 'Issued', cell: (i) => formatDate(i.issuedAt, i.timezone) },
    { key: 'booking', header: 'Booking', cell: (i) => <span className="font-mono text-[13px]">{i.bookingReference}</span> },
    { key: 'customer', header: 'Customer', cell: (i) => <span className="block max-w-[200px] truncate">{i.customer.name}</span> },
    { key: 'tax', header: 'Tax', align: 'right', cell: (i) => <span className="tabular-nums">{formatMoney(i.kind === 'CREDIT_NOTE' ? -i.taxMinor : i.taxMinor)}</span> },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (i) => <span className="font-semibold tabular-nums">{formatMoney(i.kind === 'CREDIT_NOTE' ? -i.totalMinor : i.totalMinor)}</span>,
    },
  ];

  const s = summary.data;

  return (
    <>
      <AdminPageHeader
        title="Billing"
        description="Tax invoices and credit notes. Issued documents cannot be changed."
        actions={
          <Button variant="secondary" onClick={exportCsv} loading={exporting}>
            <Download className="size-4" aria-hidden /> Export CSV
          </Button>
        }
      />

      {summary.error ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} compact className="mb-6" />
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {s ? (
            <>
              <Tile label="Invoiced" value={formatMoney(s.invoicedMinor)} hint={`${s.invoiceCount} ${s.invoiceCount === 1 ? 'invoice' : 'invoices'}`} />
              <Tile label="Credited" value={formatMoney(s.creditedMinor)} hint={`${s.creditNoteCount} ${s.creditNoteCount === 1 ? 'credit note' : 'credit notes'}`} />
              <Tile label="Net revenue" value={formatMoney(s.netMinor)} />
              <Tile label="Net tax" value={formatMoney(s.netTaxMinor)} />
            </>
          ) : (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[92px]" />)
          )}
        </div>
      )}

      <FilterBar>
        <Field label="Search">
          {({ id }) => <Input id={id} type="search" placeholder="Number, booking or customer" value={search} onChange={(e) => setSearch(e.target.value)} />}
        </Field>
        <Field label="Type">
          {({ id }) => (
            <Select id={id} value={kind} onChange={(e) => set({ kind: e.target.value })}>
              <option value="">All documents</option>
              <option value="INVOICE">Invoices</option>
              <option value="CREDIT_NOTE">Credit notes</option>
            </Select>
          )}
        </Field>
        <Field label="From">
          {({ id }) => <Input id={id} type="date" value={from} max={to || undefined} onChange={(e) => set({ from: e.target.value })} />}
        </Field>
        <Field label="To">
          {({ id }) => <Input id={id} type="date" value={to} min={from || undefined} onChange={(e) => set({ to: e.target.value })} />}
        </Field>
      </FilterBar>

      <DataTable
        caption="Invoice ledger"
        columns={columns}
        rows={list.data?.items}
        rowKey={(i) => i.number}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle="No documents"
        emptyDescription="Invoices are issued automatically when a booking is confirmed."
        onRowClick={(i) => navigate(`/admin/billing/${encodeURIComponent(i.number)}`)}
      />
      {list.data && (
        <Pagination
          className="mt-4"
          page={list.data.page}
          totalPages={list.data.totalPages}
          totalItems={list.data.totalItems}
          onChange={(p) => set({ page: p === 0 ? '' : String(p) })}
        />
      )}
    </>
  );
}
