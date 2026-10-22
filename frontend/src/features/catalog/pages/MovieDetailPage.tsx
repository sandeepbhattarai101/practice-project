import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { CalendarDays, Clapperboard, MapPin, Play } from 'lucide-react';
import { useCity } from '@/app/city';
import { useMovie, useMovieDates, useMovieShowtimes, useRelatedMovies } from '../api';
import { isApiError } from '@/lib/api';
import { formatCalendarDate, formatRuntime } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, CertificationBadge, DevDataBadge, EmptyState, ErrorState, Img, Skeleton } from '@/components/ui';
import { NotFoundPage } from '@/app/RouteError';
import { DateStrip, DateStripSkeleton } from '../components/DateStrip';
import { AvailabilityLegend, ShowtimeChip } from '../components/ShowtimeChip';
import { DirectionsLink } from '../components/CinemaCard';
import { MovieCard } from '../components/MovieCard';
import { Rail, SectionHeading } from '../components/Rail';
import { TrailerDialog } from '../components/TrailerDialog';
import type { CinemaShowtimes, MovieDetail } from '@/types/api';

function Showtimes({ movie }: { movie: MovieDetail }) {
  const { city } = useCity();
  const [params, setParams] = useSearchParams();
  // Every city's shows are listed (customers can book anywhere); the selected city comes first.
  const dates = useMovieDates(movie.slug, ALL_CITIES);
  const requested = params.get('date');
  const selected = dates.data?.includes(requested ?? '') ? requested : (dates.data?.[0] ?? null);
  const showtimes = useMovieShowtimes(movie.slug, ALL_CITIES, selected);
  const byCity = groupByCity(showtimes.data ?? [], city.slug);

  useEffect(() => {
    // Normalise ?date= to a bookable date without adding a history entry.
    if (dates.data && selected && requested !== selected && dates.data.length > 0) {
      const next = new URLSearchParams(params);
      next.set('date', selected);
      setParams(next, { replace: true });
    }
  }, [dates.data, selected, requested, params, setParams]);

  if (dates.error) return <ErrorState error={dates.error} onRetry={() => dates.refetch()} compact />;
  if (dates.isPending) {
    return (
      <div className="space-y-4">
        <DateStripSkeleton />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  if (dates.data.length === 0) {
    const upcoming = movie.showingStatus === 'UPCOMING';
    return (
      <EmptyState
        icon={<CalendarDays className="size-5" />}
        title={upcoming ? 'Coming soon' : 'No showtimes yet'}
        description={
          upcoming
            ? `${movie.title} releases on ${formatCalendarDate(movie.releaseDate)}. Bookings open once showtimes are scheduled.`
            : 'There are no bookable shows for this film at any of our cinemas right now. Check back soon.'
        }
      />
    );
  }

  const tz = showtimes.data?.[0]?.cinema.timezone ?? 'Asia/Kathmandu';
  return (
    <div className="space-y-5">
      <DateStrip
        dates={dates.data}
        value={selected}
        timezone={tz}
        onChange={(d) => {
          const next = new URLSearchParams(params);
          next.set('date', d);
          setParams(next, { replace: false, preventScrollReset: true });
        }}
      />
      <AvailabilityLegend />
      {showtimes.error ? (
        <ErrorState error={showtimes.error} onRetry={() => showtimes.refetch()} compact />
      ) : showtimes.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : showtimes.data.length === 0 ? (
        <EmptyState title="No shows on this date" description="Pick another date above." />
      ) : (
        <div className={`space-y-8 transition-opacity ${showtimes.isPlaceholderData ? 'opacity-60' : ''}`} aria-live="polite">
          {byCity.map((group) => (
            <section key={group.citySlug} aria-labelledby={`city-${group.citySlug}`}>
              <h3 id={`city-${group.citySlug}`} className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
                <MapPin className="size-3.5 text-accent" aria-hidden />
                {group.cityName}
                {group.citySlug === city.slug && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-accent">Your city</span>}
              </h3>
            <ul className="space-y-3">
              {group.items.map(({ cinema, showtimes: chips }) => (
                <li key={cinema.id} className="rounded-lg border border-line bg-surface p-4 sm:p-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="font-semibold text-fg">
                        <Link to={`/cinemas/${cinema.slug}`} className="hover:text-accent">
                          {cinema.name}
                        </Link>
                      </h4>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle">
                        <MapPin className="size-3" aria-hidden />
                        {cinema.address}
                      </p>
                    </div>
                    <DirectionsLink cinema={cinema} />
                  </div>
                  <ul className="flex flex-wrap gap-2" aria-label={`Showtimes at ${cinema.name}`}>
                    {chips.map((c) => (
                      <li key={c.id}>
                        <ShowtimeChip chip={c} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const ALL_CITIES = 'all';

/** Groups cinemas by city, the customer's selected city first, then alphabetically. */
function groupByCity(groups: CinemaShowtimes[], selectedCity: string) {
  const map = new Map<string, { citySlug: string; cityName: string; items: CinemaShowtimes[] }>();
  for (const g of groups) {
    const entry = map.get(g.cinema.citySlug) ?? { citySlug: g.cinema.citySlug, cityName: g.cinema.cityName, items: [] };
    entry.items.push(g);
    map.set(g.cinema.citySlug, entry);
  }
  return [...map.values()].sort((a, b) =>
    a.citySlug === selectedCity ? -1 : b.citySlug === selectedCity ? 1 : a.cityName.localeCompare(b.cityName));
}

function Related({ slug }: { slug: string }) {
  const { data } = useRelatedMovies(slug);
  if (!data || data.length === 0) return null;
  return (
    <section aria-labelledby="related-heading" className="mt-20">
      <SectionHeading id="related-heading" title="You might also like" />
      <Rail label="Related films">{data.map((m) => <MovieCard key={m.id} movie={m} />)}</Rail>
    </section>
  );
}

function DetailSkeleton() {
  return (
    <main id="main" aria-busy="true">
      <Skeleton className="-mt-16 h-[56vh] min-h-[420px] w-full rounded-none" />
      <div className="container-page -mt-40 flex gap-8">
        <Skeleton className="hidden aspect-[2/3] w-56 shrink-0 md:block" />
        <div className="flex-1 space-y-3 pt-20">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-24 w-full max-w-2xl" />
        </div>
      </div>
    </main>
  );
}

export default function MovieDetailPage() {
  const { slug = '' } = useParams();
  const movie = useMovie(slug);
  const [trailer, setTrailer] = useState(false);
  useDocumentTitle(movie.data?.title);

  if (movie.isPending) return <DetailSkeleton />;
  if (movie.error) {
    if (isApiError(movie.error) && movie.error.status === 404) return <NotFoundPage />;
    return (
      <main id="main" className="container-page py-16">
        <ErrorState error={movie.error} onRetry={() => movie.refetch()} />
      </main>
    );
  }
  const m = movie.data;
  const upcoming = m.showingStatus === 'UPCOMING';

  return (
    <main id="main">
      <section className="hero-grain relative -mt-16 h-[56vh] min-h-[420px] overflow-hidden">
        <Img src={m.backdropUrl} alt="" ratio="none" priority className="absolute inset-0 h-full w-full" />
        <div className="hero-vignette absolute inset-0" />
      </section>

      <div className="container-page relative -mt-48 sm:-mt-56">
        <div className="flex flex-col gap-8 md:flex-row">
          <Img src={m.posterUrl} alt={`${m.title} poster`} priority className="w-40 shrink-0 rounded-lg shadow-pop ring-1 ring-white/10 sm:w-52 md:w-60" />
          <div className="min-w-0 flex-1 md:pt-24">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {upcoming ? <span className="eyebrow text-accent">Coming {formatCalendarDate(m.releaseDate)}</span> : <span className="eyebrow text-accent">Now showing</span>}
              {m.isSampleData && <DevDataBadge />}
            </div>
            <h1 className="font-display text-4xl font-semibold leading-tight text-fg sm:text-5xl lg:text-6xl">{m.title}</h1>
            {m.tagline && <p className="mt-3 text-lg italic text-muted">{m.tagline}</p>}
            <dl className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
              <div className="flex items-center gap-2">
                <dt className="sr-only">Certificate</dt>
                <dd><CertificationBadge value={m.certification} /></dd>
              </div>
              <div>
                <dt className="sr-only">Runtime</dt>
                <dd>{formatRuntime(m.runtimeMinutes)}</dd>
              </div>
              <div>
                <dt className="sr-only">Release date</dt>
                <dd>{formatCalendarDate(m.releaseDate)}</dd>
              </div>
              <div>
                <dt className="sr-only">Genres</dt>
                <dd>{m.genres.join(', ')}</dd>
              </div>
              <div>
                <dt className="sr-only">Languages</dt>
                <dd>{m.languages.join(', ')}</dd>
              </div>
            </dl>
            {m.formats.length > 0 && (
              <p className="mt-4 flex flex-wrap gap-1.5" aria-label="Formats">
                {m.formats.map((f) => (
                  <span key={f} className="rounded-xs border border-line-strong px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-fg">{f}</span>
                ))}
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              {!upcoming && (
                <Button
                  size="lg"
                  onClick={() => {
                    document.getElementById('showtimes')?.scrollIntoView({ behavior: 'smooth' });
                    document.getElementById('showtimes-heading')?.focus({ preventScroll: true });
                  }}
                >
                  <Clapperboard className="size-4" aria-hidden /> Book tickets
                </Button>
              )}
              {m.trailerUrl && (
                <Button variant="secondary" size="lg" onClick={() => setTrailer(true)}>
                  <Play className="size-4 fill-current" aria-hidden /> Watch trailer
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-[1fr_340px]">
          <section id="showtimes" aria-labelledby="showtimes-heading" className="scroll-mt-24 order-2 lg:order-1">
            <h2 id="showtimes-heading" tabIndex={-1} className="mb-5 font-display text-2xl text-fg outline-none">
              Showtimes
            </h2>
            {m.isSampleData && (
              <p className="mb-4 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-sm text-muted">
                These showtimes are development data for testing the booking flow — they are not real screenings.
              </p>
            )}
            <Showtimes movie={m} />
          </section>

          <aside className="order-1 space-y-8 lg:order-2">
            <section aria-labelledby="synopsis-heading">
              <h2 id="synopsis-heading" className="eyebrow mb-2">Synopsis</h2>
              <p className="leading-relaxed text-muted">{m.synopsis}</p>
            </section>
            {m.director && (
              <section aria-labelledby="director-heading">
                <h2 id="director-heading" className="eyebrow mb-2">Director</h2>
                <p className="text-fg">{m.director}</p>
              </section>
            )}
            {m.cast.length > 0 && (
              <section aria-labelledby="cast-heading">
                <h2 id="cast-heading" className="eyebrow mb-3">Cast</h2>
                <ul className="space-y-2.5">
                  {m.cast.map((c, i) => (
                    <li key={`${c.name}-${i}`} className="flex items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-xs font-bold text-muted" aria-hidden>
                        {c.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('')}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-fg">{c.name}</span>
                        {c.character && <span className="block truncate text-xs text-subtle">as {c.character}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>

        <Related slug={m.slug} />
      </div>

      <TrailerDialog open={trailer} onClose={() => setTrailer(false)} title={m.title} url={m.trailerUrl} />
    </main>
  );
}
