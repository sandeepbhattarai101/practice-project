import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCcw } from 'lucide-react';
import { Button, EmptyState, ErrorState, LoadingRegion, Skeleton, toast } from '@/components/ui';
import { adminApi, adminKeys } from '@/features/admin/api';
import { AdminPageHeader, DetailList, Panel, StatusPill, humanise } from '@/features/admin/components/AdminUi';
import { otherPaymentFields, paymentView, providerLabel } from '@/features/admin/ops/payments';
import { JsonDetails, Mono } from '@/features/admin/ops/shared';
import { errorMessage } from '@/lib/api';
import { DEFAULT_TIMEZONE, formatDateTime } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { formatMoney } from '@/lib/money';

const TZ = DEFAULT_TIMEZONE;

export default function PaymentDetailPage() {
  const { id: rawId = '' } = useParams();
  const id = Number.parseInt(rawId, 10);
  const valid = Number.isFinite(id) && id > 0;
  useDocumentTitle(`Payment #${rawId}`);
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: adminKeys.payment(id), queryFn: () => adminApi.payment(id), enabled: valid });

  const reconcile = useMutation({
    mutationFn: () => adminApi.reconcilePayment(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.payment(id) }),
        queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'payments'] }),
        queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'booking'] }),
      ]);
      toast.success('Payment reconciled with the gateway');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const back = (
    <Link to="/admin/payments" className="inline-flex items-center gap-1 text-subtle transition-colors hover:text-fg">
      <ArrowLeft className="size-3.5" aria-hidden /> Payments
    </Link>
  );

  if (!valid) {
    return (
      <>
        <AdminPageHeader eyebrow={back} title="Payment not found" />
        <EmptyState title="That is not a valid payment ID" action={<Link to="/admin/payments" className="text-accent hover:underline">Back to payments</Link>} />
      </>
    );
  }
  if (query.isPending) {
    return (
      <LoadingRegion label="Loading payment">
        <AdminPageHeader eyebrow={back} title={`Payment #${id}`} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Skeleton className="h-64" />
          <Skeleton className="h-80" />
        </div>
      </LoadingRegion>
    );
  }
  if (query.isError) {
    return (
      <>
        <AdminPageHeader eyebrow={back} title={`Payment #${id}`} />
        <ErrorState error={query.error} title="We could not load this payment" onRetry={() => query.refetch()} retrying={query.isFetching} />
      </>
    );
  }

  const p = query.data;
  const v = paymentView(p);
  const events = Array.isArray(p.events) ? [...p.events].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))) : [];
  const other = otherPaymentFields(p);

  return (
    <>
      <AdminPageHeader
        eyebrow={back}
        title={`Payment #${p.id}`}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusPill status={p.status} /> {providerLabel(p.provider)}
          </span>
        }
        actions={
          <Button
            variant="secondary"
            onClick={() => reconcile.mutate()}
            loading={reconcile.isPending}
            leftIcon={<RefreshCcw className="size-4" aria-hidden />}
            title="Ask the gateway for the latest status of this payment"
          >
            Reconcile
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel title="Details">
          <DetailList
            items={[
              { label: 'Amount', value: v.amountMinor === null ? '—' : formatMoney(v.amountMinor) },
              { label: 'Status', value: <StatusPill status={p.status} /> },
              { label: 'Provider', value: providerLabel(p.provider) },
              { label: 'Provider reference', value: v.providerRef ? <Mono>{v.providerRef}</Mono> : '—' },
              {
                label: 'Booking',
                value: v.bookingReference ? (
                  <Link to={`/admin/bookings/${encodeURIComponent(v.bookingReference)}`} className="font-mono text-[12.5px] text-accent hover:underline">
                    {v.bookingReference}
                  </Link>
                ) : (
                  '—'
                ),
              },
              { label: 'Created', value: v.createdAt ? formatDateTime(v.createdAt, TZ) : '—' },
              { label: 'Completed', value: v.completedAt ? formatDateTime(v.completedAt, TZ) : '—' },
              ...(v.failureReason ? [{ label: 'Failure reason', value: <span className="text-danger">{v.failureReason}</span> }] : []),
              ...other.map((o) => ({ label: humanise(o.key.replace(/([a-z])([A-Z])/g, '$1_$2')), value: o.value })),
            ]}
          />
        </Panel>
        <Panel title={`Event log (${events.length})`}>
          {events.length === 0 ? (
            <p className="text-sm text-subtle">No gateway events have been recorded for this payment.</p>
          ) : (
            <ol className="relative flex flex-col gap-4 border-l border-line pl-4">
              {events.map((e, i) => (
                <li key={`${e.createdAt}-${i}`} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-accent ring-4 ring-surface" aria-hidden />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-[12.5px] font-semibold text-fg">{e.eventType}</span>
                    <time dateTime={e.createdAt} className="text-xs tabular-nums text-subtle">
                      {formatDateTime(e.createdAt, TZ)}
                    </time>
                  </div>
                  <JsonDetails value={e.payload} summary="Payload" className="mt-1" />
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </>
  );
}
