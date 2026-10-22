import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { Button, DataTable, Dialog, Field, FormError, Input, Pagination, Select, Textarea, toast, type Column } from '@/components/ui';
import { adminApi, adminKeys } from '@/features/admin/api';
import { AdminPageHeader, FilterBar, StatusPill } from '@/features/admin/components/AdminUi';
import { providerLabel } from '@/features/admin/ops/payments';
import { useUrlFilters } from '@/features/admin/ops/useUrlFilters';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { DEFAULT_TIMEZONE, formatDateTime } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { formatMoney } from '@/lib/money';
import type { AdminRefund, RefundStatus } from '@/types/api';

const PAGE_SIZE = 25;
const STATUSES: RefundStatus[] = ['PENDING', 'PROCESSED', 'REJECTED'];
const DEFAULTS = { status: 'PENDING' };
const TZ = DEFAULT_TIMEZONE;

type Action = { kind: 'process' | 'reject'; refund: AdminRefund };

export default function RefundsPage() {
  useDocumentTitle('Refunds');
  const { values, setFilters, page, setPage } = useUrlFilters(DEFAULTS);
  const [action, setAction] = useState<Action | null>(null);

  const params = { status: values.status, page, size: PAGE_SIZE };
  const query = useQuery({
    queryKey: adminKeys.refunds(params),
    queryFn: () => adminApi.refunds(params),
    placeholderData: keepPreviousData,
  });

  const columns: Column<AdminRefund>[] = [
    {
      key: 'booking',
      header: 'Booking',
      cell: (r) => (
        <Link to={`/admin/bookings/${encodeURIComponent(r.bookingReference)}`} className="font-mono text-[12.5px] font-semibold text-accent hover:underline">
          {r.bookingReference}
        </Link>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums font-medium">{formatMoney(r.amountMinor)}</span> },
    { key: 'status', header: 'Status', cell: (r) => <StatusPill status={r.status} /> },
    { key: 'provider', header: 'Provider', cell: (r) => providerLabel(r.provider) },
    { key: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-2 max-w-[260px] text-muted">{r.reason ?? '—'}</span> },
    {
      key: 'ref',
      header: 'Provider ref. / notes',
      cell: (r) => (
        <div className="max-w-[220px] text-xs">
          {r.providerRef && <div className="font-mono text-fg">{r.providerRef}</div>}
          {r.notes && <div className="line-clamp-2 text-subtle">{r.notes}</div>}
          {!r.providerRef && !r.notes && <span className="text-subtle">—</span>}
        </div>
      ),
    },
    {
      key: 'dates',
      header: 'Requested',
      cell: (r) => (
        <div className="whitespace-nowrap text-xs tabular-nums text-muted">
          <div>{formatDateTime(r.createdAt, TZ)}</div>
          {r.processedAt && <div className="text-subtle">Done {formatDateTime(r.processedAt, TZ)}</div>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) =>
        r.status === 'PENDING' ? (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'process', refund: r })} leftIcon={<Check className="size-3.5" aria-hidden />}>
              Process
            </Button>
            <Button size="sm" variant="ghost" className="hover:text-danger" onClick={() => setAction({ kind: 'reject', refund: r })} leftIcon={<X className="size-3.5" aria-hidden />}>
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  const data = query.data;

  return (
    <>
      <AdminPageHeader title="Refunds" description="Pay refunds through the provider, then record them here." />
      <FilterBar className="lg:grid-cols-[minmax(160px,240px)]">
        <Field label="Status">
          {({ id }) => (
            <Select id={id} value={values.status} onChange={(e) => setFilters({ status: e.target.value })}>
              <option value="">All refunds</option>
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
        caption="Refunds"
        columns={columns}
        rows={data?.items}
        rowKey={(r) => r.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        emptyTitle={values.status === 'PENDING' ? 'No refunds waiting' : 'No refunds found'}
        emptyDescription={values.status === 'PENDING' ? 'The queue is clear.' : undefined}
        className={cn(query.isPlaceholderData && 'opacity-70 transition-opacity duration-200')}
      />
      {data && <Pagination className="mt-4" page={data.page} totalPages={data.totalPages} totalItems={data.totalItems} onChange={setPage} />}
      {action && <RefundActionDialog key={`${action.kind}-${action.refund.id}`} action={action} onClose={() => setAction(null)} />}
    </>
  );
}

function RefundActionDialog({ action, onClose }: { action: Action; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { kind, refund } = action;
  const [providerRef, setProviderRef] = useState('');
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: () => (kind === 'process' ? adminApi.processRefund(refund.id, providerRef.trim(), notes.trim()) : adminApi.rejectRefund(refund.id, notes.trim())),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'refunds'] }),
        queryClient.invalidateQueries({ queryKey: adminKeys.booking(refund.bookingReference) }),
      ]);
      toast.success(kind === 'process' ? 'Refund marked as processed' : 'Refund rejected');
      onClose();
    },
  });

  const refError = kind === 'process' && submitted && providerRef.trim() === '' ? 'Enter the reference the provider gave for the refund' : undefined;
  const notesError = kind === 'reject' && submitted && notes.trim().length < 3 ? 'Explain why the refund is rejected' : undefined;
  const serverField = (name: string) => (mutation.error instanceof ApiError ? mutation.error.fieldError(name) : undefined);

  const submit = () => {
    setSubmitted(true);
    if (kind === 'process' ? providerRef.trim() !== '' : notes.trim().length >= 3) mutation.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!mutation.isPending}
      role={kind === 'reject' ? 'alertdialog' : 'dialog'}
      title={kind === 'process' ? 'Record refund as processed' : 'Reject refund'}
      description={`${formatMoney(refund.amountMinor)} for booking ${refund.bookingReference}${refund.provider ? ` via ${providerLabel(refund.provider)}` : ''}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Back
          </Button>
          <Button variant={kind === 'reject' ? 'danger' : 'primary'} onClick={submit} loading={mutation.isPending}>
            {kind === 'process' ? 'Mark as processed' : 'Reject refund'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError message={mutation.error ? errorMessage(mutation.error) : null} />
        {kind === 'process' && (
          <Field label="Provider reference" required error={refError ?? serverField('providerRef')} hint="The refund transaction ID from eSewa, Khalti or the bank.">
            {({ id, describedBy, invalid }) => (
              <Input id={id} value={providerRef} onChange={(e) => setProviderRef(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="off" />
            )}
          </Field>
        )}
        <Field label="Notes" required={kind === 'reject'} error={notesError ?? serverField('notes')} hint={kind === 'process' ? 'Optional. Internal only.' : 'The customer may be told this reason.'}>
          {({ id, describedBy, invalid }) => (
            <Textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} maxLength={1000} />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
