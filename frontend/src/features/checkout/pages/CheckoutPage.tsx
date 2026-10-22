import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Clock, Lock, LogIn, Tag, TimerOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { bookingApi, bookingKeys, useBooking, useShowtime } from '@/features/booking/api';
import { ShowSummary } from '@/features/booking/components/ShowSummary';
import { PriceBreakdown } from '@/features/booking/components/PriceBreakdown';
import { useConfig } from '@/features/config/api';
import { useCurrentUser } from '@/features/auth/api';
import { ApiError, errorMessage, isApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { getPaymentAttemptKey, rememberPaymentAttempt, resetFailedAttempts } from '@/lib/idempotency';
import { useDocumentTitle } from '@/lib/hooks';
import { followPaymentRedirect } from '../redirect';
import { Badge, Button, ButtonLink, Countdown, EmptyState, ErrorState, Field, FormError, Input, Skeleton, useConfirm } from '@/components/ui';
import { NotFoundPage } from '@/app/RouteError';
import { cn } from '@/lib/cn';
import type { Booking, ProviderCode, ProviderMode } from '@/types/api';

const customerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(120, 'That name is too long.'),
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  phone: z
    .string()
    .trim()
    .max(20, 'That phone number is too long.')
    .refine((v) => v === '' || /^[+\d][\d\s-]{6,}$/.test(v), 'Enter a valid phone number.'),
});
type CustomerValues = z.infer<typeof customerSchema>;

const modeLabel: Record<ProviderMode, string | null> = { TEST: 'Test mode', SIMULATOR: 'Simulator', LIVE: null };

function CouponForm({ booking }: { booking: Booking }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const setBooking = (b: Booking) => qc.setQueryData(bookingKeys.booking(b.reference), b);
  const apply = useMutation({
    mutationFn: () => bookingApi.applyCoupon(booking.reference, code.trim()),
    onSuccess: (b) => {
      setBooking(b);
      setCode('');
      setError(null);
      toast.success(`Code ${b.coupon?.code ?? ''} applied.`);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => bookingApi.removeCoupon(booking.reference),
    onSuccess: (b) => {
      setBooking(b);
      toast.success('Offer code removed.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (booking.coupon) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-success/40 bg-success/5 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold tracking-wider text-fg">{booking.coupon.code}</p>
            <p className="truncate text-xs text-muted">{booking.coupon.description}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => remove.mutate()} loading={remove.isPending} aria-label={`Remove code ${booking.coupon.code}`}>
          <X className="size-3.5" aria-hidden /> Remove
        </Button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) apply.mutate();
        else setError('Enter an offer code.');
      }}
      noValidate
    >
      <Field label="Offer code" error={error ?? undefined}>
        {({ id, describedBy, invalid }) => (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Tag className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <Input
                id={id}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError(null);
                }}
                placeholder="e.g. WELCOME10"
                autoComplete="off"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className="pl-9 font-mono uppercase tracking-wider"
              />
            </div>
            <Button type="submit" variant="secondary" loading={apply.isPending}>
              Apply
            </Button>
          </div>
        )}
      </Field>
    </form>
  );
}

function ExpiredHold({ booking }: { booking: Booking }) {
  return (
    <main id="main" className="container-page py-16">
      <EmptyState
        icon={<TimerOff className="size-5" />}
        title="Your seat hold has expired"
        description={`We held your seats for a limited time so others could book. ${booking.items.map((i) => i.seatLabel).join(', ')} ${booking.items.length === 1 ? 'has' : 'have'} been released.`}
        action={
          <>
            <ButtonLink to={`/book/${booking.showtime.id}`}>Choose seats again</ButtonLink>
            <ButtonLink to={`/movies/${booking.showtime.movie.slug}`} variant="secondary">
              Other showtimes
            </ButtonLink>
          </>
        }
      />
    </main>
  );
}

export default function CheckoutPage() {
  const { reference = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const config = useConfig();
  const user = useCurrentUser();
  const confirm = useConfirm();
  const booking = useBooking(reference);
  const showtime = useShowtime(booking.data?.showtime.id ?? Number.NaN);
  const [expired, setExpired] = useState(false);
  const [provider, setProvider] = useState<ProviderCode | null>(config.paymentProviders[0]?.code ?? null);
  const [payError, setPayError] = useState<string | null>(null);
  useDocumentTitle('Checkout');

  const b = booking.data;

  useEffect(() => {
    if (b) resetFailedAttempts(b.reference, b.payments);
  }, [b]);

  const defaults = useMemo<CustomerValues>(
    () => ({
      name: b?.customer.name ?? user?.fullName ?? '',
      email: b?.customer.email ?? user?.email ?? '',
      phone: b?.customer.phone ?? user?.phone ?? '',
    }),
    [b?.customer.name, b?.customer.email, b?.customer.phone, user],
  );
  const form = useForm<CustomerValues>({ resolver: zodResolver(customerSchema), defaultValues: defaults });
  const { reset, formState } = form;
  useEffect(() => {
    if (!formState.isDirty) reset(defaults);
  }, [defaults, reset, formState.isDirty]);

  const pay = useMutation({
    mutationFn: async (values: CustomerValues) => {
      if (!b || !provider) throw new Error('Choose a payment method.');
      const c = b.customer;
      if (c.name !== values.name || c.email !== values.email || (c.phone ?? '') !== values.phone) {
        const updated = await bookingApi.updateCustomer(b.reference, values);
        qc.setQueryData(bookingKeys.booking(b.reference), updated);
      }
      const key = getPaymentAttemptKey(b.reference, provider);
      const result = await bookingApi.startPayment(b.reference, provider, key);
      rememberPaymentAttempt(b.reference, provider, result.paymentId);
      return result;
    },
    onSuccess: (result) => followPaymentRedirect(result.redirect),
    onError: (error) => {
      if (isApiError(error)) {
        for (const f of error.fieldErrors) {
          if (f.field === 'name' || f.field === 'email' || f.field === 'phone') form.setError(f.field, { message: f.message });
        }
        if (error.code === 'HOLD_EXPIRED') {
          setExpired(true);
          void booking.refetch();
          return;
        }
        if (error.code === 'BOOKING_STATE') {
          void booking.refetch();
        }
      }
      setPayError(errorMessage(error));
    },
  });

  const release = useMutation({
    mutationFn: () => bookingApi.release(reference),
    onSuccess: () => {
      qc.removeQueries({ queryKey: bookingKeys.booking(reference) });
      if (b) void qc.invalidateQueries({ queryKey: bookingKeys.seats(b.showtime.id) });
      toast.success('Your booking was cancelled and the seats released.');
      navigate(b ? `/movies/${b.showtime.movie.slug}` : '/');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (booking.isPending) {
    return (
      <main id="main" className="container-page pt-8" aria-busy="true">
        <div className="mb-8 flex gap-4"><Skeleton className="h-28 w-20" /><div className="flex-1 space-y-2"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-4 w-2/3" /></div></div>
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]"><Skeleton className="h-96" /><Skeleton className="h-80" /></div>
      </main>
    );
  }
  if (booking.error) {
    const e = booking.error;
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
      return <Navigate to={`/bookings/find?ref=${encodeURIComponent(reference)}`} replace />;
    }
    return <main id="main" className="container-page py-16"><ErrorState error={e} onRetry={() => booking.refetch()} /></main>;
  }
  if (!b) return <NotFoundPage />;

  if (b.status === 'CONFIRMED' || b.status === 'PAYMENT_PENDING' || b.status === 'CANCELLED') {
    return <Navigate to={`/bookings/${b.reference}`} replace />;
  }
  if (b.status === 'EXPIRED' || expired) return <ExpiredHold booking={b} />;

  const latest = b.payments[b.payments.length - 1];
  const lastFailed = latest && (latest.status === 'FAILED' || latest.status === 'CANCELLED' || latest.status === 'EXPIRED');
  const total = formatMoney(b.pricing.totalMinor);
  const submit = form.handleSubmit((values) => {
    setPayError(null);
    pay.mutate(values);
  });

  const onCancel = async () => {
    const ok = await confirm({
      title: 'Cancel this booking?',
      description: 'Your seats will be released straight away for others to book.',
      confirmLabel: 'Cancel booking',
      cancelLabel: 'Keep my seats',
      tone: 'danger',
    });
    if (ok) release.mutate();
  };

  const payButton = (className?: string) => (
    <Button type="submit" form="checkout-form" size="lg" className={className} loading={pay.isPending} disabled={!provider}>
      <Lock className="size-4" aria-hidden /> Pay {total}
    </Button>
  );

  return (
    <main id="main" className="container-page pb-36 pt-8 lg:pb-16">
      <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <ShowSummary
          show={{
            movie: b.showtime.movie,
            cinemaName: b.showtime.cinema.name,
            cinemaSlug: b.showtime.cinema.slug,
            auditoriumName: b.showtime.auditorium.name,
            startsAt: b.showtime.startsAt,
            timezone: b.showtime.timezone,
            format: b.showtime.format,
            language: b.showtime.language,
            isSampleData: showtime.data?.movie.isSampleData,
          }}
        />
        <Countdown expiresAt={b.holdExpiresAt} onExpire={() => { setExpired(true); void booking.refetch(); }} className="shrink-0 md:min-w-[200px]" />
      </div>

      {lastFailed && (
        <div role="alert" className="mb-6 rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm">
          <p className="font-semibold text-fg">Your last payment did not go through</p>
          <p className="text-muted">{latest.failureReason ?? 'The payment was cancelled or declined.'} You have not been charged for it — you can try again below.</p>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {!user && (
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted">Have an account? Sign in to keep this booking with your tickets. Or carry on as a guest.</p>
              <ButtonLink to={`/login?next=${encodeURIComponent(location.pathname)}`} variant="outline" size="sm" className="shrink-0">
                <LogIn className="size-4" aria-hidden /> Sign in
              </ButtonLink>
            </div>
          )}

          <form id="checkout-form" onSubmit={submit} noValidate className="space-y-6">
            <section aria-labelledby="contact-heading" className="rounded-lg border border-line bg-surface p-5">
              <h2 id="contact-heading" className="mb-1 font-display text-xl text-fg">Your details</h2>
              <p className="mb-5 text-sm text-subtle">We'll email your tickets here.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" required error={form.formState.errors.name?.message} className="sm:col-span-2">
                  {({ id, describedBy, invalid }) => <Input id={id} autoComplete="name" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('name')} />}
                </Field>
                <Field label="Email" required error={form.formState.errors.email?.message}>
                  {({ id, describedBy, invalid }) => <Input id={id} type="email" autoComplete="email" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('email')} />}
                </Field>
                <Field label="Phone" error={form.formState.errors.phone?.message} hint="Optional — for updates about your show.">
                  {({ id, describedBy, invalid }) => <Input id={id} type="tel" autoComplete="tel" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('phone')} />}
                </Field>
              </div>
            </section>

            <fieldset className="rounded-lg border border-line bg-surface p-5">
              <legend className="sr-only">Payment method</legend>
              <h2 className="mb-4 font-display text-xl text-fg" aria-hidden>Payment method</h2>
              {config.paymentProviders.length === 0 ? (
                <p className="text-sm text-muted">Online payment is not available right now. Please try again later.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {config.paymentProviders.map((p) => {
                    const tag = modeLabel[p.mode];
                    const checked = provider === p.code;
                    return (
                      <label
                        key={p.code}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3.5 transition-colors duration-150 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                          checked ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong',
                        )}
                      >
                        <input type="radio" name="provider" value={p.code} checked={checked} onChange={() => setProvider(p.code)} className="sr-only" />
                        <span className={cn('grid size-4 shrink-0 place-items-center rounded-full border-2', checked ? 'border-accent' : 'border-line-strong')} aria-hidden>
                          {checked && <span className="size-1.5 rounded-full bg-accent" />}
                        </span>
                        <span className="flex-1 font-semibold text-fg">{p.name}</span>
                        {tag && <Badge tone={p.mode === 'SIMULATOR' ? 'info' : 'warning'}>{tag}</Badge>}
                      </label>
                    );
                  })}
                </div>
              )}
              <p className="mt-4 flex items-center gap-1.5 text-xs text-subtle">
                <Lock className="size-3" aria-hidden /> You'll be taken to the provider to pay securely, then brought back here.
              </p>
            </fieldset>
          </form>
        </div>

        <aside aria-labelledby="order-heading" className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <section className="rounded-lg border border-line bg-surface p-5">
            <h2 id="order-heading" className="mb-4 flex items-center justify-between text-sm font-semibold text-fg">
              Order summary <span className="font-mono text-xs font-normal text-subtle">{b.reference}</span>
            </h2>
            <PriceBreakdown booking={b} />
            <div className="mt-5 border-t border-line pt-5">
              <CouponForm booking={b} />
            </div>
            <div className="mt-5 hidden space-y-3 lg:block">
              <FormError message={payError} />
              {payButton('w-full')}
            </div>
          </section>
          <div className="flex items-center justify-between px-1 text-sm">
            <Link to={`/book/${b.showtime.id}`} className="text-muted hover:text-fg">Change seats</Link>
            <button type="button" onClick={onCancel} disabled={release.isPending} className="font-semibold text-danger hover:underline disabled:opacity-50">
              Cancel booking
            </button>
          </div>
          <p className="flex items-start gap-2 px-1 text-xs text-subtle">
            <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Cancel up to {config.cancellation.cutoffHours} hours before the show for a {config.cancellation.refundPercent}% refund.
          </p>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 backdrop-blur-md lg:hidden">
        <div className="container-page pb-safe pt-3">
          {payError && <div className="mb-2"><FormError message={payError} /></div>}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-subtle">{b.items.length} {b.items.length === 1 ? 'seat' : 'seats'} · {b.items.map((i) => i.seatLabel).join(', ')}</p>
              <p className="font-display text-xl text-fg">{total}</p>
            </div>
            {payButton()}
          </div>
        </div>
      </div>
    </main>
  );
}
