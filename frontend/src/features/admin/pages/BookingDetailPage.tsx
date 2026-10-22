import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CheckCircle2, Mail } from 'lucide-react';
import {
  Button,
  Dialog,
  ErrorState,
  Field,
  FormError,
  Img,
  Input,
  LoadingRegion,
  Skeleton,
  Textarea,
  toast,
} from '@/components/ui';
import { adminApi, adminKeys } from '@/features/admin/api';
import { AdminPageHeader, DetailList, Panel, StatusPill, humanise } from '@/features/admin/components/AdminUi';
import { Mono } from '@/features/admin/ops/shared';
import { useConfig } from '@/features/config/api';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatRuntime } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { formatBasisPoints, formatMoney } from '@/lib/money';
import type { AdminBooking } from '@/types/api';

export default function BookingDetailPage() {
  const { reference = '' } = useParams();
  useDocumentTitle(`Booking ${reference}`);
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);

  const query = useQuery({ queryKey: adminKeys.booking(reference), queryFn: () => adminApi.booking(reference), enabled: reference !== '' });

  const resend = useMutation({
    mutationFn: () => adminApi.resendBooking(reference),
    onSuccess: () => toast.success('Ticket email sent again'),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const back = (
    <Link to="/admin/bookings" className="inline-flex items-center gap-1 text-subtle transition-colors hover:text-fg">
      <ArrowLeft className="size-3.5" aria-hidden /> Bookings
    </Link>
  );

  if (query.isPending) {
    return (
      <LoadingRegion label="Loading booking">
        <AdminPageHeader eyebrow={back} title={reference} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-40" />
            <Skeleton className="h-56" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-36" />
            <Skeleton className="h-48" />
          </div>
        </div>
      </LoadingRegion>
    );
  }
  if (query.isError) {
    return (
      <>
        <AdminPageHeader eyebrow={back} title={reference} />
        <ErrorState error={query.error} title="We could not load this booking" onRetry={() => query.refetch()} retrying={query.isFetching} />
      </>
    );
  }

  const b = query.data;
  const tz = b.showtime.timezone;
  const canCancel = b.status === 'HELD' || b.status === 'PAYMENT_PENDING' || b.status === 'CONFIRMED';

  return (
    <>
      <AdminPageHeader
        eyebrow={back}
        title={b.reference}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusPill status={b.status} />
            <span>Booked {formatDateTime(b.createdAt, tz)}</span>
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => resend.mutate()}
              loading={resend.isPending}
              disabled={b.status !== 'CONFIRMED'}
              leftIcon={<Mail className="size-4" aria-hidden />}
              title={b.status !== 'CONFIRMED' ? 'Only confirmed bookings have a ticket to send' : undefined}
            >
              Resend ticket
            </Button>
            {canCancel && (
              <Button variant="danger" onClick={() => setCancelOpen(true)} leftIcon={<Ban className="size-4" aria-hidden />}>
                Cancel booking
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Show">
            <div className="flex gap-4">
              <Img src={b.showtime.movie.posterUrl} alt="" ratio="poster" className="w-20 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-xl text-fg">{b.showtime.movie.title}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {[b.showtime.movie.certification, formatRuntime(b.showtime.movie.runtimeMinutes), b.showtime.format, b.showtime.language]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <div className="mt-4">
                  <DetailList
                    items={[
                      { label: 'Starts', value: formatDateTime(b.showtime.startsAt, tz) },
                      { label: 'Ends', value: formatDateTime(b.showtime.endsAt, tz) },
                      { label: 'Cinema', value: b.showtime.cinema.name },
                      { label: 'Auditorium', value: b.showtime.auditorium.name },
                      { label: 'Address', value: b.showtime.cinema.address },
                      { label: 'Showtime ID', value: <Mono>{b.showtime.id}</Mono> },
                    ]}
                  />
                </div>
              </div>
            </div>
          </Panel>

          <Panel title={`Seats (${b.items.length})`}>
            <table className="w-full text-sm">
              <caption className="sr-only">Seats and prices</caption>
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-subtle">
                  <th scope="col" className="pb-2 text-left font-semibold">
                    Seat
                  </th>
                  <th scope="col" className="pb-2 text-left font-semibold">
                    Category
                  </th>
                  <th scope="col" className="pb-2 text-right font-semibold">
                    Price
                  </th>
                </tr>
              </thead>
              <tbody>
                {b.items.map((i) => (
                  <tr key={i.seatId} className="border-t border-line/60">
                    <td className="py-2 font-semibold text-fg">{i.seatLabel}</td>
                    <td className="py-2 text-muted">{i.categoryName}</td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(i.priceMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PricingBreakdown booking={b} />
          </Panel>

          <Panel title={`Payments (${b.payments.length})`}>
            {b.payments.length === 0 ? (
              <p className="text-sm text-subtle">No payment has been started for this booking.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {b.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm first:pt-0 last:pb-0">
                    <Link to={`/admin/payments/${p.id}`} className="font-mono text-[12.5px] text-accent hover:underline">
                      #{p.id}
                    </Link>
                    <span className="text-fg">{humanise(p.provider)}</span>
                    <StatusPill status={p.status} />
                    <span className="tabular-nums">{formatMoney(p.amountMinor)}</span>
                    <span className="ml-auto text-xs tabular-nums text-subtle">
                      {formatDateTime(p.createdAt, tz)}
                      {p.completedAt ? ` → ${formatDateTime(p.completedAt, tz)}` : ''}
                    </span>
                    {p.failureReason && <p className="w-full text-xs text-danger">{p.failureReason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Customer">
            <DetailList
              items={[
                { label: 'Name', value: b.customer.name },
                { label: 'Email', value: b.customer.email },
                { label: 'Phone', value: b.customer.phone },
                { label: 'Account', value: b.userEmail ? `${b.userEmail}${b.userId ? ` (#${b.userId})` : ''}` : 'Guest checkout' },
              ]}
            />
          </Panel>

          <Panel title="Ticket">
            {b.ticket ? (
              <DetailList
                items={[
                  { label: 'Ticket code', value: <Mono className="text-accent">{b.ticket.code}</Mono> },
                  {
                    label: 'Checked in',
                    value: b.checkedInAt ? (
                      <span className="inline-flex items-center gap-1.5 text-success">
                        <CheckCircle2 className="size-3.5" aria-hidden /> {formatDateTime(b.checkedInAt, tz)}
                      </span>
                    ) : (
                      'Not yet'
                    ),
                  },
                ]}
              />
            ) : (
              <p className="text-sm text-subtle">A ticket is issued once the booking is confirmed.</p>
            )}
          </Panel>

          <Panel title="Timeline">
            <DetailList
              items={[
                { label: 'Created', value: formatDateTime(b.createdAt, tz) },
                { label: 'Hold expires', value: b.status === 'HELD' || b.status === 'PAYMENT_PENDING' ? formatDateTime(b.holdExpiresAt, tz) : '—' },
                { label: 'Confirmed', value: b.confirmedAt ? formatDateTime(b.confirmedAt, tz) : '—' },
                { label: 'Cancelled', value: b.cancelledAt ? formatDateTime(b.cancelledAt, tz) : '—' },
                ...(b.cancellationReason ? [{ label: 'Cancellation reason', value: b.cancellationReason }] : []),
              ]}
            />
          </Panel>

          <Panel title="Refund">
            {b.refund ? (
              <DetailList
                items={[
                  { label: 'Amount', value: formatMoney(b.refund.amountMinor) },
                  { label: 'Status', value: <StatusPill status={b.refund.status} /> },
                  { label: 'Requested', value: formatDateTime(b.refund.createdAt, tz) },
                  { label: 'Processed', value: b.refund.processedAt ? formatDateTime(b.refund.processedAt, tz) : '—' },
                ]}
              />
            ) : (
              <p className="text-sm text-subtle">
                No refund.{' '}
                {b.cancellable && b.status === 'CONFIRMED' && (
                  <>A customer cancellation now would refund {formatMoney(b.cancellationRefundMinor)}.</>
                )}
              </p>
            )}
          </Panel>
        </div>
      </div>

      <CancelBookingDialog open={cancelOpen} booking={b} onClose={() => setCancelOpen(false)} onCancelled={() => queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'bookings'] })} />
    </>
  );
}

function PricingBreakdown({ booking }: { booking: AdminBooking }) {
  const p = booking.pricing;
  const row = (label: string, value: string, className?: string) => (
    <div className={`flex justify-between gap-4 py-1 ${className ?? ''}`}>
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums text-fg">{value}</dd>
    </div>
  );
  return (
    <dl className="mt-4 border-t border-line pt-3 text-sm">
      {row('Subtotal', formatMoney(p.subtotalMinor))}
      {p.discountMinor > 0 &&
        row(booking.coupon ? `Discount (${booking.coupon.code}${booking.coupon.description ? ` — ${booking.coupon.description}` : ''})` : 'Discount', `−${formatMoney(p.discountMinor)}`)}
      {row('Service fee', formatMoney(p.feeMinor))}
      {row(`${p.taxLabel} (${formatBasisPoints(p.taxRateBasisPoints)})`, formatMoney(p.taxMinor))}
      <div className="mt-1 flex justify-between gap-4 border-t border-line pt-2 font-semibold">
        <dt className="text-fg">Total</dt>
        <dd className="tabular-nums text-accent">
          {formatMoney(p.totalMinor)} <span className="text-xs font-normal text-subtle">{p.currency}</span>
        </dd>
      </div>
      {booking.coupon && p.discountMinor === 0 && (
        <p className="mt-2 text-xs text-subtle">
          Coupon {booking.coupon.code} applied: {booking.coupon.description}
        </p>
      )}
    </dl>
  );
}

function CancelBookingDialog({
  open,
  booking,
  onClose,
  onCancelled,
}: {
  open: boolean;
  booking: AdminBooking;
  onClose: () => void;
  onCancelled: () => void;
}) {
  if (!open) return null;
  return <CancelBookingForm booking={booking} onClose={onClose} onCancelled={onCancelled} />;
}

function CancelBookingForm({ booking, onClose, onCancelled }: { booking: AdminBooking; onClose: () => void; onCancelled: () => void }) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [percent, setPercent] = useState(String(config.cancellation.refundPercent));
  const [submitted, setSubmitted] = useState(false);

  const pct = Number(percent);
  const percentValid = /^\d{1,3}$/.test(percent.trim()) && pct >= 0 && pct <= 100;
  const reasonValid = reason.trim().length >= 3;
  const paid = booking.status === 'CONFIRMED';
  const estimate = paid && percentValid ? Math.round((booking.pricing.totalMinor * pct) / 100) : 0;

  const cancel = useMutation({
    mutationFn: () => adminApi.cancelBooking(booking.reference, reason.trim(), pct),
    onSuccess: (updated) => {
      queryClient.setQueryData(adminKeys.booking(booking.reference), updated);
      onCancelled();
      queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'refunds'] });
      toast.success(`Booking ${booking.reference} cancelled`);
      onClose();
    },
  });

  const submit = () => {
    setSubmitted(true);
    if (reasonValid && percentValid) cancel.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!cancel.isPending}
      role="alertdialog"
      title={`Cancel booking ${booking.reference}?`}
      description="The seats are released immediately. This cannot be undone."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={cancel.isPending}>
            Keep booking
          </Button>
          <Button variant="danger" onClick={submit} loading={cancel.isPending}>
            Cancel booking
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError message={cancel.error ? errorMessage(cancel.error) : null} />
        <Field label="Reason" required error={submitted && !reasonValid ? 'Give a reason for the cancellation' : undefined}>
          {({ id, describedBy, invalid }) => (
            <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} maxLength={500} />
          )}
        </Field>
        <Field
          label="Refund (% of amount paid)"
          required
          error={submitted && !percentValid ? 'Enter a whole number from 0 to 100' : undefined}
          hint={
            paid
              ? `Default policy: ${config.cancellation.refundPercent}%. About ${formatMoney(estimate)} of ${formatMoney(booking.pricing.totalMinor)}; the server calculates the exact amount.`
              : 'This booking has not been paid, so nothing will be refunded.'
          }
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              className="max-w-[140px] tabular-nums"
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

