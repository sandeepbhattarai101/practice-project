import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CalendarClock, Clock, Film, Hourglass, Ticket, Undo2 } from 'lucide-react';
import { EmptyState, ErrorState, Field, LoadingRegion, ProgressBar, Select, Skeleton } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/api';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import type { AdminDashboard, DashboardTotals } from '@/types/api';
import { adminApi, adminKeys, useAdminLookups } from '../api';
import { AdminPageHeader, Panel } from '../components/AdminUi';
import { SalesChart } from './dashboard/SalesChart';

function TotalsTile({ label, totals }: { label: string; totals: DashboardTotals }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</p>
      <p className="mt-2 font-display text-[1.75rem] leading-none tabular-nums text-fg">{formatMoney(totals.revenueMinor)}</p>
      <p className="mt-2 text-xs text-muted">
        <span className="tabular-nums text-fg">{totals.tickets}</span> {totals.tickets === 1 ? 'ticket' : 'tickets'} ·{' '}
        <span className="tabular-nums text-fg">{totals.bookings}</span> {totals.bookings === 1 ? 'booking' : 'bookings'}
      </p>
    </div>
  );
}

function CountTile({ label, value, icon, to, hint }: { label: string; value: number; icon: ReactNode; to?: string; hint: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</p>
        <span className="text-subtle" aria-hidden>
          {icon}
        </span>
      </div>
      <p className="mt-2 font-display text-[1.75rem] leading-none tabular-nums text-fg">{value}</p>
      <p className="mt-2 text-xs text-muted">{hint}</p>
    </>
  );
  const cls = 'block rounded-lg border border-line bg-surface p-4';
  return to ? (
    <Link to={to} className={`${cls} transition-colors duration-200 hover:border-line-strong hover:bg-elevated`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function DashboardSkeleton() {
  return (
    <LoadingRegion label="Loading dashboard">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[108px] rounded-lg" />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Skeleton className="h-[300px] rounded-lg xl:col-span-2" />
        <Skeleton className="h-[300px] rounded-lg" />
      </div>
      <Skeleton className="mt-4 h-[260px] rounded-lg" />
    </LoadingRegion>
  );
}

function DashboardBody({ data }: { data: AdminDashboard }) {
  const topMax = data.topMovies.reduce((m, t) => Math.max(m, t.revenueMinor), 0);
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <TotalsTile label="Today" totals={data.today} />
        <TotalsTile label="Last 30 days" totals={data.last30Days} />
        <CountTile label="Active holds" value={data.activeHolds} icon={<Hourglass className="size-4" />} hint="Seats held, awaiting payment" />
        <CountTile
          label="Upcoming showtimes"
          value={data.upcomingShowtimes}
          icon={<CalendarClock className="size-4" />}
          to="/admin/showtimes"
          hint="Scheduled from now on"
        />
        <CountTile label="Pending refunds" value={data.pendingRefunds} icon={<Undo2 className="size-4" />} to="/admin/refunds" hint="Waiting to be processed" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Revenue by day" className="min-w-0 xl:col-span-2">
          {data.salesByDay.length === 0 ? (
            <EmptyState title="No sales yet" description="Daily revenue will appear here once bookings are confirmed." icon={<Ticket className="size-5" />} className="border-0 py-10" />
          ) : (
            <SalesChart data={data.salesByDay} />
          )}
        </Panel>
        <Panel title="Top movies" className="min-w-0">
          {data.topMovies.length === 0 ? (
            <EmptyState title="No movie sales" description="Your best-selling movies will be listed here." className="border-0 py-10" />
          ) : (
            <ol className="flex flex-col gap-3">
              {data.topMovies.map((m, i) => (
                <li key={`${m.title}-${i}`} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="w-4 shrink-0 text-xs tabular-nums text-subtle">{i + 1}</span>
                      <span className="truncate font-medium text-fg">{m.title}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-fg">{formatMoney(m.revenueMinor)}</span>
                  </div>
                  <div className="ml-6 mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-raised" aria-hidden>
                      <div className="h-full rounded-full bg-accent/70" style={{ width: `${topMax > 0 ? (m.revenueMinor / topMax) * 100 : 0}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs tabular-nums text-subtle">
                      {m.tickets} {m.tickets === 1 ? 'ticket' : 'tickets'}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <Panel title="Next showtimes" className="mt-4" actions={<Link to="/admin/showtimes" className="text-xs font-semibold text-accent hover:text-accent-strong">All showtimes</Link>}>
        {data.nextShowtimes.length === 0 ? (
          <EmptyState title="Nothing scheduled" description="Upcoming showtimes will appear here." icon={<Clock className="size-5" />} className="border-0 py-10" />
        ) : (
          <div className="-mx-4 -my-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Next showtimes with seats sold</caption>
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-subtle">
                  <th scope="col" className="px-4 py-2.5 text-left font-semibold">Starts</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-semibold">Movie</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-semibold">Cinema · screen</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-semibold">Sold</th>
                </tr>
              </thead>
              <tbody>
                {data.nextShowtimes.map((s) => (
                  <tr key={s.showtimeId} className="border-b border-line/60 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">{formatDateTime(s.startsAt)}</td>
                    <td className="px-4 py-2.5 font-medium text-fg">{s.movieTitle}</td>
                    <td className="px-4 py-2.5 text-muted">
                      {s.cinemaName} · {s.auditoriumName}
                    </td>
                    <td className="w-[220px] px-4 py-2.5">
                      <ProgressBar value={s.sold} max={s.capacity} label={`Seats sold for ${s.movieTitle} at ${formatDateTime(s.startsAt)}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

export default function DashboardPage() {
  useDocumentTitle('Dashboard');
  const user = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';
  const [cinemaId, setCinemaId] = useState<number | ''>('');
  const lookups = useAdminLookups();
  const scopedCinemaId = isAdmin ? cinemaId : '';
  const query = useQuery({
    queryKey: adminKeys.dashboard(scopedCinemaId),
    queryFn: () => adminApi.dashboard(scopedCinemaId),
    refetchInterval: 60_000,
  });

  const managedNames =
    !isAdmin && user && lookups.data
      ? lookups.data.cinemas.filter((c) => user.managedCinemaIds.includes(c.id)).map((c) => c.name)
      : [];

  return (
    <div>
      <AdminPageHeader
        eyebrow="Overview"
        title="Dashboard"
        description={
          isAdmin
            ? 'Sales and activity across your cinemas. Times are shown in Kathmandu time (Asia/Kathmandu).'
            : managedNames.length > 0
              ? `Sales and activity for ${managedNames.join(', ')}.`
              : 'Sales and activity for the cinemas you manage.'
        }
        actions={
          isAdmin && (
            <Field label="Cinema" className="w-56" labelHidden>
              {({ id }) => (
                <Select
                  id={id}
                  value={cinemaId === '' ? '' : String(cinemaId)}
                  onChange={(e) => setCinemaId(e.target.value === '' ? '' : Number(e.target.value))}
                  disabled={lookups.isLoading}
                >
                  <option value="">All cinemas</option>
                  {lookups.data?.cinemas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )
        }
      />
      {query.isPending ? (
        <DashboardSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} title="We could not load the dashboard" onRetry={() => query.refetch()} retrying={query.isFetching} />
      ) : (
        <div className={query.isFetching ? 'opacity-80 transition-opacity duration-200' : 'transition-opacity duration-200'}>
          <DashboardBody data={query.data} />
        </div>
      )}
      {lookups.isError && isAdmin && (
        <p className="mt-3 text-xs text-danger" role="alert">
          <Film className="mr-1 inline size-3" aria-hidden />
          The cinema list could not be loaded, so the dashboard shows all cinemas.
        </p>
      )}
    </div>
  );
}
