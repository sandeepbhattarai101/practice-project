import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarPlus, CheckCircle2, Clock, CreditCard, FileText, Loader2, Mail, Printer, RotateCw, TimerOff, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { bookingApi, bookingKeys } from '../api';
import { LookupForm } from '../components/LookupForm';
import { PriceBreakdown } from '../components/PriceBreakdown';
import { ShowSummary } from '../components/ShowSummary';
import { useConfig } from '@/features/config/api';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, formatTime, formatWeekdayDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { downloadIcs } from '@/lib/ics';
import { assetUrl } from '@/lib/media';
import { useDocumentTitle, useNow } from '@/lib/hooks';
import { Badge, Button, ButtonLink, Dialog, ErrorState, Field, Img, Skeleton, Spinner, Textarea } from '@/components/ui';
import type { Booking } from '@/types/api';

const POLL_MS = 3000;

/** Invoices and credit notes issued for this booking, each linking to its printable page. */
function InvoicesSection({ booking }: { booking: Booking }) {
  const invoices = booking.invoices ?? [];
  if (invoices.length === 0) return null;
  return (
    <section className="print-hide mt-6 rounded-lg border border-line bg-surface p-5 text-left" aria-labelledby="invoices-heading">
      <h2 id="invoices-heading" className="mb-3 text-sm font-semibold text-fg">Receipts &amp; invoices</h2>
      <ul className="divide-y divide-line">
        {invoices.map((inv) => (
          <li key={inv.number}>
            <Link
              to={`/bookings/${booking.reference}/invoices/${encodeURIComponent(inv.number)}`}
              className="group flex items-center gap-3 py-3 text-sm"
            >
              <FileText className="size-4 shrink-0 text-subtle group-hover:text-accent" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-fg group-hover:text-accent">
                  {inv.kind === 'CREDIT_NOTE' ? 'Credit note' : 'Tax invoice'} <span className="font-mono font-normal">{inv.number}</span>
                </span>
                <span className="block text-xs text-subtle">Issued {formatDate(inv.issuedAt, booking.showtime.timezone)}</span>
              </span>
              <span className="tabular-nums text-fg">{inv.kind === 'CREDIT_NOTE' ? '−' : ''}{formatMoney(inv.totalMinor)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
const POLL_FOR_MS = 2 * 60 * 1000;

function TicketCard({ booking }: { booking: Booking }) {
  const s = booking.showtime;
  const tz = s.timezone;
  return (
    <article className="print-ticket relative overflow-hidden rounded-lg border border-line-strong bg-surface shadow-pop" aria-labelledby="ticket-title">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_0%_0%,rgb(245_181_68/0.1),transparent_50%)] print-hide" aria-hidden />
      <div className="relative grid md:grid-cols-[1fr_auto]">
        <div className="flex gap-5 p-6">
          <Img src={s.movie.posterUrl} alt="" className="hidden w-24 shrink-0 rounded-sm ring-1 ring-white/10 sm:block" />
          <div className="min-w-0">
            <p className="eyebrow print-muted">Admit {booking.items.length}</p>
            <h2 id="ticket-title" className="mt-1 font-display text-3xl leading-tight text-fg">{s.movie.title}</h2>
            <p className="mt-1 text-sm text-muted print-muted">{s.movie.certification} · {s.format} · {s.language}</p>
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              <div><dt className="eyebrow print-muted">Date</dt><dd className="mt-0.5 font-semibold text-fg">{formatWeekdayDate(s.startsAt, tz)}</dd></div>
              <div><dt className="eyebrow print-muted">Time</dt><dd className="mt-0.5 font-semibold text-fg">{formatTime(s.startsAt, tz)}</dd></div>
              <div><dt className="eyebrow print-muted">Screen</dt><dd className="mt-0.5 font-semibold text-fg">{s.auditorium.name}</dd></div>
              <div className="col-span-2 sm:col-span-3"><dt className="eyebrow print-muted">Cinema</dt><dd className="mt-0.5 font-semibold text-fg">{s.cinema.name}<span className="block text-xs font-normal text-subtle print-muted">{s.cinema.address}</span></dd></div>
              <div className="col-span-2"><dt className="eyebrow print-muted">Seats</dt><dd className="mt-0.5 font-semibold text-fg">{booking.items.map((i) => i.seatLabel).join(', ')}</dd></div>
              <div><dt className="eyebrow print-muted">Paid</dt><dd className="mt-0.5 font-semibold text-fg">{formatMoney(booking.pricing.totalMinor)}</dd></div>
            </dl>
          </div>
        </div>
        <div className="relative flex flex-col items-center justify-center gap-3 border-t border-dashed border-line-strong p-6 md:border-l md:border-t-0">
          <span className="absolute -left-3 -top-3 hidden size-6 rounded-full bg-canvas md:block print-hide" aria-hidden />
          <span className="absolute -bottom-3 -left-3 hidden size-6 rounded-full bg-canvas md:block print-hide" aria-hidden />
          {booking.ticket && (
            <>
              <div className="rounded-md bg-white p-2.5">
                <img src={assetUrl(booking.ticket.qrUrl)} alt={`Entry QR code for booking ${booking.reference}`} width={160} height={160} className="size-40" />
              </div>
              <p className="font-mono text-xs tracking-widest text-subtle print-muted">{booking.ticket.code}</p>
            </>
          )}
          <p className="text-center">
            <span className="eyebrow block print-muted">Booking reference</span>
            <span className="font-mono text-lg font-bold tracking-wider text-accent">{booking.reference}</span>
          </p>
        </div>
      </div>
    </article>
  );
}

function CancelSection({ booking }: { booking: Booking }) {
  const qc = useQueryClient();
  const config = useConfig();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => bookingApi.cancel(booking.reference, reason.trim() || undefined),
    onSuccess: (b) => {
      qc.setQueryData(bookingKeys.booking(b.reference), b);
      void qc.invalidateQueries({ queryKey: ['account'] });
      setOpen(false);
      toast.success('Your booking has been cancelled.');
    },
  });
  if (!booking.cancellable) {
    return (
      <p className="text-sm text-subtle">
        Bookings can be cancelled up to {config.cancellation.cutoffHours} hours before the show. This booking can no longer be cancelled online.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted">
        Plans changed? Cancel now and we'll refund <strong className="text-fg">{formatMoney(booking.cancellationRefundMinor)}</strong> to your original payment method.
      </p>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="shrink-0 hover:border-danger hover:text-danger">
        <Ban className="size-4" aria-hidden /> Cancel booking
      </Button>
      <Dialog
        open={open}
        onClose={() => !cancel.isPending && setOpen(false)}
        dismissible={!cancel.isPending}
        role="alertdialog"
        title="Cancel this booking?"
        description={`You'll receive a refund of ${formatMoney(booking.cancellationRefundMinor)}. Your seats will be released and your tickets will stop working.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={cancel.isPending}>Keep booking</Button>
            <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>Cancel and refund</Button>
          </>
        }
      >
        <Field label="Reason (optional)" error={cancel.error ? errorMessage(cancel.error) : undefined}>
          {({ id, describedBy }) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={describedBy} maxLength={500} />}
        </Field>
      </Dialog>
    </div>
  );
}

function ConfirmedView({ booking }: { booking: Booking }) {
  const resend = useMutation({
    mutationFn: () => bookingApi.resend(booking.reference),
    onSuccess: () => toast.success(`We've sent your tickets to ${booking.customer.email ?? 'your email'}.`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = booking.showtime;
  const addToCalendar = () =>
    downloadIcs(
      {
        uid: `${booking.reference}@practice-project`,
        title: `${s.movie.title} — ${s.cinema.name}`,
        start: s.startsAt,
        end: s.endsAt,
        location: `${s.cinema.name}, ${s.cinema.address}`,
        description: `Booking ${booking.reference}. ${s.auditorium.name}, seats ${booking.items.map((i) => i.seatLabel).join(', ')}.`,
      },
      `practice-project-${booking.reference}.ics`,
    );

  return (
    <>
      <div className="print-hide mb-8 text-center">
        <span className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-success/10 text-success ring-1 ring-success/30">
          <CheckCircle2 className="size-7" aria-hidden />
        </span>
        <h1 className="font-display text-4xl text-fg sm:text-5xl">You're all set</h1>
        <p className="mt-2 text-muted">
          Your tickets are confirmed{booking.customer.email ? ` and on their way to ${booking.customer.email}` : ''}. Show the QR code at the entrance.
        </p>
      </div>
      <TicketCard booking={booking} />
      {booking.checkedInAt && (
        <p className="print-hide mt-3 text-center text-sm text-subtle">Checked in at {formatDateTime(booking.checkedInAt, s.timezone)}.</p>
      )}
      <div className="print-hide mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print / Save as PDF</Button>
        <Button variant="secondary" onClick={() => resend.mutate()} loading={resend.isPending}><Mail className="size-4" aria-hidden /> Resend email</Button>
        <Button variant="secondary" onClick={addToCalendar}><CalendarPlus className="size-4" aria-hidden /> Add to calendar</Button>
      </div>
      <div className="print-hide mt-10 grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface p-5" aria-labelledby="receipt-heading">
          <h2 id="receipt-heading" className="mb-4 text-sm font-semibold text-fg">Receipt</h2>
          <PriceBreakdown booking={booking} />
          {booking.confirmedAt && <p className="mt-4 text-xs text-subtle">Paid {formatDateTime(booking.confirmedAt, s.timezone)}</p>}
        </section>
        <section className="rounded-lg border border-line bg-surface p-5" aria-labelledby="manage-heading">
          <h2 id="manage-heading" className="mb-4 text-sm font-semibold text-fg">Manage booking</h2>
          <CancelSection booking={booking} />
        </section>
      </div>
      <InvoicesSection booking={booking} />
    </>
  );
}

function StatusPanel({ icon, tone, title, children }: { icon: React.ReactNode; tone: 'info' | 'danger' | 'warning' | 'neutral'; title: string; children: React.ReactNode }) {
  const ring = { info: 'bg-info/10 text-info ring-info/30', danger: 'bg-danger/10 text-danger ring-danger/30', warning: 'bg-warning/10 text-warning ring-warning/30', neutral: 'bg-raised text-muted ring-line' }[tone];
  return (
    <div className="mx-auto max-w-xl text-center">
      <span className={`mx-auto mb-5 grid size-14 place-items-center rounded-full ring-1 ${ring}`}>{icon}</span>
      <h1 className="font-display text-3xl text-fg sm:text-4xl">{title}</h1>
      <div className="mt-3 space-y-4 text-muted">{children}</div>
    </div>
  );
}

function refundText(refund: Booking['refund']): string | null {
  if (!refund) return null;
  if (refund.status === 'PROCESSED') return `A refund of ${formatMoney(refund.amountMinor)} has been processed.`;
  if (refund.status === 'REJECTED') return `The refund of ${formatMoney(refund.amountMinor)} could not be processed. Please contact support.`;
  return `A refund of ${formatMoney(refund.amountMinor)} is being processed. It usually appears within a few working days.`;
}

export default function BookingPage() {
  const { reference = '' } = useParams();
  const [params] = useSearchParams();
  const paymentHint = params.get('payment');
  const qc = useQueryClient();
  const config = useConfig();
  const [pollStartedAt, setPollStartedAt] = useState<number | null>(null);
  const verifiedOnce = useRef(false);
  useDocumentTitle(`Booking ${reference}`);

  const booking = useQuery({
    queryKey: bookingKeys.booking(reference),
    queryFn: () => bookingApi.get(reference),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status !== 'PAYMENT_PENDING' || pollStartedAt === null) return false;
      return Date.now() - pollStartedAt < POLL_FOR_MS ? POLL_MS : false;
    },
  });

  const verify = useMutation({
    mutationFn: () => bookingApi.verifyPayment(reference),
    onSuccess: (b) => qc.setQueryData(bookingKeys.booking(reference), b),
  });

  const status = booking.data?.status;
  const { mutate: verifyMutate } = verify;
  useEffect(() => {
    if (status !== 'PAYMENT_PENDING') return;
    setPollStartedAt((t) => t ?? Date.now());
    if (!verifiedOnce.current) {
      verifiedOnce.current = true;
      verifyMutate();
    }
  }, [status, verifyMutate]);

  const now = useNow(5000, status === 'PAYMENT_PENDING');
  const pollingExpired = pollStartedAt !== null && now - pollStartedAt >= POLL_FOR_MS;

  let content: React.ReactNode;
  if (booking.isPending) {
    content = paymentHint ? (
      <StatusPanel icon={<Loader2 className="size-7 animate-spin" aria-hidden />} tone="info" title={paymentHint === 'success' || paymentHint === 'pending' ? 'Confirming your payment…' : 'Checking your booking…'}>
        <p role="status">Please wait a moment while we check with the payment provider.</p>
      </StatusPanel>
    ) : (
      <div className="space-y-4" aria-busy="true"><Skeleton className="mx-auto h-12 w-2/3" /><Skeleton className="h-72" /></div>
    );
  } else if (booking.error) {
    const e = booking.error;
    content =
      e instanceof ApiError && (e.status === 403 || e.status === 404 || e.status === 401) ? (
        <div className="mx-auto max-w-md">
          <h1 className="font-display text-3xl text-fg">Find your booking</h1>
          <p className="mt-2 text-muted">To view booking {reference}, confirm the email address you booked with.</p>
          <div className="mt-6 rounded-lg border border-line bg-surface p-6"><LookupForm defaultReference={reference} /></div>
        </div>
      ) : (
        <ErrorState error={e} onRetry={() => booking.refetch()} />
      );
  } else {
    const b = booking.data;
    const latest = b.payments[b.payments.length - 1];
    const summary = (
      <div className="mx-auto mt-10 max-w-2xl rounded-lg border border-line bg-surface p-5 text-left">
        <ShowSummary size="sm" show={{ movie: b.showtime.movie, cinemaName: b.showtime.cinema.name, cinemaSlug: b.showtime.cinema.slug, auditoriumName: b.showtime.auditorium.name, startsAt: b.showtime.startsAt, timezone: b.showtime.timezone, format: b.showtime.format, language: b.showtime.language }} />
        <p className="mt-4 text-sm text-muted">Seats {b.items.map((i) => i.seatLabel).join(', ')} · {formatMoney(b.pricing.totalMinor)} · <span className="font-mono">{b.reference}</span></p>
      </div>
    );

    switch (b.status) {
      case 'CONFIRMED':
        content = <ConfirmedView booking={b} />;
        break;
      case 'PAYMENT_PENDING':
        content = (
          <>
            <StatusPanel icon={<Clock className="size-7" aria-hidden />} tone="info" title="We're confirming your payment">
              <p role="status" aria-live="polite">
                {pollingExpired
                  ? 'This is taking longer than usual. Your seats stay reserved while we wait for the provider. If you were charged, your tickets will be confirmed — check again in a few minutes.'
                  : 'This usually takes a few seconds. You do not need to pay again.'}
              </p>
              <div className="flex justify-center gap-2">
                {!pollingExpired && <Spinner />}
                <Button variant="secondary" onClick={() => verify.mutate()} loading={verify.isPending || (booking.isFetching && !pollingExpired)}>
                  <RotateCw className="size-4" aria-hidden /> Check again
                </Button>
              </div>
              {verify.error && <p className="text-sm text-danger">{errorMessage(verify.error)}</p>}
              <p className="text-xs text-subtle">Questions? Email <a className="text-accent hover:underline" href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a> with reference {b.reference}.</p>
            </StatusPanel>
            {summary}
          </>
        );
        break;
      case 'HELD': {
        const failed = latest && (latest.status === 'FAILED' || latest.status === 'CANCELLED' || latest.status === 'EXPIRED');
        content = (
          <>
            <StatusPanel
              icon={failed ? <XCircle className="size-7" aria-hidden /> : <CreditCard className="size-7" aria-hidden />}
              tone={failed ? 'danger' : 'warning'}
              title={failed ? (latest.status === 'CANCELLED' ? 'Payment cancelled' : 'Payment unsuccessful') : 'Your seats are on hold'}
            >
              <p>
                {failed
                  ? `${latest.failureReason ?? 'The payment did not complete.'} You have not been charged. Your seats are still held until ${formatTime(b.holdExpiresAt, b.showtime.timezone)}.`
                  : `Complete payment before ${formatTime(b.holdExpiresAt, b.showtime.timezone)} to confirm your tickets.`}
              </p>
              <div className="flex justify-center"><ButtonLink to={`/checkout/${b.reference}`}>{failed ? 'Try payment again' : 'Continue to payment'}</ButtonLink></div>
            </StatusPanel>
            {summary}
          </>
        );
        break;
      }
      case 'EXPIRED':
      case 'CANCELLED': {
        const refund = refundText(b.refund);
        content = (
          <>
            <StatusPanel icon={b.status === 'EXPIRED' ? <TimerOff className="size-7" aria-hidden /> : <Ban className="size-7" aria-hidden />} tone="neutral" title={b.status === 'EXPIRED' ? 'This booking has expired' : 'This booking was cancelled'}>
              <p>
                {b.status === 'EXPIRED'
                  ? 'Payment was not completed in time, so the seats were released. You have not been charged.'
                  : `Cancelled${b.cancelledAt ? ` on ${formatDate(b.cancelledAt, b.showtime.timezone)}` : ''}${b.cancellationReason ? ` — ${b.cancellationReason}` : ''}.`}
              </p>
              {refund && (
                <p className="flex items-center justify-center gap-2">
                  {b.refund && <Badge tone={b.refund.status === 'PROCESSED' ? 'success' : b.refund.status === 'REJECTED' ? 'danger' : 'warning'}>{b.refund.status === 'PROCESSED' ? 'Refunded' : b.refund.status === 'REJECTED' ? 'Refund issue' : 'Refund pending'}</Badge>}
                  <span>{refund}</span>
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink to={`/movies/${b.showtime.movie.slug}`}>Book {b.showtime.movie.title} again</ButtonLink>
                <ButtonLink to="/movies" variant="secondary">Browse movies</ButtonLink>
              </div>
            </StatusPanel>
            {summary}
            <div className="mx-auto max-w-2xl"><InvoicesSection booking={b} /></div>
          </>
        );
        break;
      }
    }
  }

  return (
    <main id="main" className="container-page max-w-4xl py-12">
      {content}
      <p className="print-hide mt-12 text-center text-sm text-subtle">
        <Link to="/account/bookings" className="hover:text-fg">My bookings</Link>
        <span className="mx-2" aria-hidden>·</span>
        <Link to="/bookings/find" className="hover:text-fg">Find another booking</Link>
      </p>
    </main>
  );
}
