import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { CalendarDays, MapPin, Phone } from 'lucide-react';
import { useCinema, useCinemaDates, useCinemaShowtimes } from '../api';
import { isApiError } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { CertificationBadge, DevDataBadge, EmptyState, ErrorState, Img, Skeleton } from '@/components/ui';
import { NotFoundPage } from '@/app/RouteError';
import { DateStrip, DateStripSkeleton } from '../components/DateStrip';
import { AvailabilityLegend, ShowtimeChip } from '../components/ShowtimeChip';
import { DirectionsLink, FacilityList } from '../components/CinemaCard';
import { movieMetaLine } from '../components/MovieCard';
import type { CinemaDetail } from '@/types/api';

function CinemaShowtimes({ cinema }: { cinema: CinemaDetail }) {
  const [params, setParams] = useSearchParams();
  const dates = useCinemaDates(cinema.slug);
  const requested = params.get('date');
  const selected = dates.data?.includes(requested ?? '') ? requested : (dates.data?.[0] ?? null);
  const showtimes = useCinemaShowtimes(cinema.slug, selected);

  useEffect(() => {
    if (dates.data && selected && requested !== selected) {
      const next = new URLSearchParams(params);
      next.set('date', selected);
      setParams(next, { replace: true });
    }
  }, [dates.data, selected, requested, params, setParams]);

  if (dates.error) return <ErrorState error={dates.error} onRetry={() => dates.refetch()} compact />;
  if (dates.isPending) return <div className="space-y-4"><DateStripSkeleton /><Skeleton className="h-40" /></div>;
  if (dates.data.length === 0) {
    return <EmptyState icon={<CalendarDays className="size-5" />} title="No upcoming shows" description="This cinema has no bookable showtimes scheduled yet." />;
  }

  return (
    <div className="space-y-5">
      <DateStrip
        dates={dates.data}
        value={selected}
        timezone={cinema.timezone}
        onChange={(d) => {
          const next = new URLSearchParams(params);
          next.set('date', d);
          setParams(next, { preventScrollReset: true });
        }}
      />
      <AvailabilityLegend />
      {showtimes.error ? (
        <ErrorState error={showtimes.error} onRetry={() => showtimes.refetch()} compact />
      ) : showtimes.isPending ? (
        <div className="space-y-3"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
      ) : showtimes.data.length === 0 ? (
        <EmptyState title="No shows on this date" description="Pick another date above." />
      ) : (
        <ul className={`space-y-3 transition-opacity ${showtimes.isPlaceholderData ? 'opacity-60' : ''}`}>
          {showtimes.data.map(({ movie, showtimes: chips }) => (
            <li key={movie.id} className="flex gap-4 rounded-lg border border-line bg-surface p-4">
              <Link to={`/movies/${movie.slug}`} className="w-16 shrink-0 sm:w-20" tabIndex={-1} aria-hidden>
                <Img src={movie.posterUrl} alt="" className="rounded-sm" />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-fg">
                    <Link to={`/movies/${movie.slug}`} className="hover:text-accent">{movie.title}</Link>
                  </h3>
                  <CertificationBadge value={movie.certification} />
                  {movie.isSampleData && <DevDataBadge />}
                </div>
                <p className="mt-0.5 text-xs text-subtle">{movieMetaLine(movie, 3)} · {movie.languages.join(', ')}</p>
                <ul className="mt-3 flex flex-wrap gap-2" aria-label={`Showtimes for ${movie.title}`}>
                  {chips.map((c) => <li key={c.id}><ShowtimeChip chip={c} /></li>)}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CinemaDetailPage() {
  const { slug = '' } = useParams();
  const cinema = useCinema(slug);
  useDocumentTitle(cinema.data?.name);

  if (cinema.isPending) {
    return (
      <main id="main" aria-busy="true">
        <Skeleton className="-mt-16 h-[44vh] min-h-[340px] w-full rounded-none" />
        <div className="container-page -mt-24 space-y-3">
          <Skeleton className="h-12 w-1/2" />
          <Skeleton className="h-5 w-1/3" />
        </div>
      </main>
    );
  }
  if (cinema.error) {
    if (isApiError(cinema.error) && cinema.error.status === 404) return <NotFoundPage />;
    return <main id="main" className="container-page py-16"><ErrorState error={cinema.error} onRetry={() => cinema.refetch()} /></main>;
  }
  const c = cinema.data;

  return (
    <main id="main">
      <section className="hero-grain relative -mt-16 h-[44vh] min-h-[340px] overflow-hidden">
        <Img src={c.imageUrl} alt="" ratio="none" priority className="absolute inset-0 h-full w-full" />
        <div className="hero-vignette absolute inset-0" />
        <div className="container-page relative flex h-full flex-col justify-end pb-10">
          <p className="eyebrow mb-2 text-accent">{c.cityName}</p>
          <h1 className="font-display text-4xl font-semibold text-fg sm:text-5xl">{c.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5"><MapPin className="size-4 text-subtle" aria-hidden />{c.address}</span>
            {c.phone && (
              <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 hover:text-fg">
                <Phone className="size-4 text-subtle" aria-hidden />{c.phone}
              </a>
            )}
            <DirectionsLink cinema={c} />
          </div>
        </div>
      </section>

      <div className="container-page mt-10 grid gap-12 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="cinema-showtimes" className="order-2 lg:order-1">
          <h2 id="cinema-showtimes" className="mb-5 font-display text-2xl text-fg">Showtimes</h2>
          <CinemaShowtimes cinema={c} />
        </section>
        <aside className="order-1 space-y-8 lg:order-2">
          {c.description && (
            <section aria-labelledby="about-heading">
              <h2 id="about-heading" className="eyebrow mb-2">About</h2>
              <p className="leading-relaxed text-muted">{c.description}</p>
            </section>
          )}
          {c.facilities.length > 0 && (
            <section aria-labelledby="facilities-heading">
              <h2 id="facilities-heading" className="eyebrow mb-3">Facilities</h2>
              <FacilityList facilities={c.facilities} />
            </section>
          )}
          {c.formats.length > 0 && (
            <section aria-labelledby="formats-heading">
              <h2 id="formats-heading" className="eyebrow mb-3">Formats</h2>
              <p className="flex flex-wrap gap-1.5">
                {c.formats.map((f) => <span key={f} className="rounded-xs border border-line-strong px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-fg">{f}</span>)}
              </p>
            </section>
          )}
          {c.auditoriums.length > 0 && (
            <section aria-labelledby="screens-heading">
              <h2 id="screens-heading" className="eyebrow mb-3">Screens</h2>
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                {c.auditoriums.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="font-semibold text-fg">{a.name}</span>
                    <span className="text-right text-xs text-subtle">{a.formats.join(' · ')} · {a.seatCount} seats</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
