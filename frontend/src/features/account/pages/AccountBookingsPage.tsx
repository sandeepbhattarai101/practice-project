import { Link, useSearchParams } from 'react-router';
import { ChevronRight, Ticket } from 'lucide-react';
import { useMyBookings, type BookingScope } from '../api';
import { AccountNav } from './AccountPage';
import { Badge, ButtonLink, EmptyState, ErrorState, Img, Pagination, Skeleton, Tabs, type BadgeTone } from '@/components/ui';
import { formatTime, formatWeekdayDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { useDocumentTitle } from '@/lib/hooks';
import type { BookingStatus, BookingSummary } from '@/types/api';

const statusInfo: Record<BookingStatus, { label: string; tone: BadgeTone }> = {
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  HELD: { label: 'Awaiting payment', tone: 'warning' },
  PAYMENT_PENDING: { label: 'Payment pending', tone: 'info' },
  EXPIRED: { label: 'Expired', tone: 'outline' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
};

function BookingRow({ b }: { b: BookingSummary }) {
  const s = statusInfo[b.status];
  return (
    <li>
      <Link to={`/bookings/${b.reference}`} className="group flex items-center gap-4 rounded-lg border border-line bg-surface p-3 transition-colors hover:border-line-strong sm:p-4">
        <Img src={b.posterUrl} alt="" className="w-14 shrink-0 rounded-sm sm:w-16" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-fg group-hover:text-accent">{b.movieTitle}</h3>
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {formatWeekdayDate(b.startsAt, b.timezone)} · {formatTime(b.startsAt, b.timezone)} · {b.cinemaName}
          </p>
          <p className="mt-0.5 text-xs text-subtle">
            Seats {b.seatLabels.join(', ')} · {formatMoney(b.totalMinor)} · <span className="font-mono">{b.reference}</span>
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

export default function AccountBookingsPage() {
  const [params, setParams] = useSearchParams();
  const scope: BookingScope = params.get('scope') === 'past' ? 'past' : 'upcoming';
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const bookings = useMyBookings(scope, page);
  useDocumentTitle('My bookings');

  return (
    <main id="main" className="container-page max-w-3xl pt-10">
      <header className="mb-6">
        <p className="eyebrow mb-2">Account</p>
        <h1 className="font-display text-4xl text-fg">My bookings</h1>
      </header>
      <AccountNav />
      <Tabs
        idBase="scope"
        label="Bookings"
        items={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]}
        value={scope}
        onChange={(v) => setParams(v === 'upcoming' ? {} : { scope: v })}
        className="mb-6"
      />
      <section id="scope-panel" role="tabpanel" aria-labelledby={`scope-tab-${scope}`}>
        {bookings.error ? (
          <ErrorState error={bookings.error} onRetry={() => bookings.refetch()} />
        ) : bookings.isPending ? (
          <ul className="space-y-3">{Array.from({ length: 4 }, (_, i) => <li key={i}><Skeleton className="h-[104px]" /></li>)}</ul>
        ) : bookings.data.items.length === 0 ? (
          <EmptyState
            icon={<Ticket className="size-5" />}
            title={scope === 'upcoming' ? 'No upcoming bookings' : 'No past bookings yet'}
            description={scope === 'upcoming' ? 'When you book, your tickets appear here.' : 'Films you have seen with us will be listed here.'}
            action={<ButtonLink to="/movies" size="sm">Find a film</ButtonLink>}
          />
        ) : (
          <>
            <ul className={`space-y-3 transition-opacity ${bookings.isPlaceholderData ? 'opacity-60' : ''}`}>
              {bookings.data.items.map((b) => <BookingRow key={b.reference} b={b} />)}
            </ul>
            <Pagination
              className="mt-8"
              page={bookings.data.page}
              totalPages={bookings.data.totalPages}
              totalItems={bookings.data.totalItems}
              onChange={(p) => {
                const next = new URLSearchParams(params);
                if (p === 0) next.delete('page');
                else next.set('page', String(p));
                setParams(next);
              }}
            />
          </>
        )}
      </section>
    </main>
  );
}
