import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, Pause, Play, Ticket } from 'lucide-react';
import type { MovieCard } from '@/types/api';
import { Button, ButtonLink, CertificationBadge, DevDataBadge } from '@/components/ui';
import { formatCalendarDate, formatRuntime } from '@/lib/dates';
import { usePrefersReducedMotion } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import { TrailerDialog } from './TrailerDialog';

const INTERVAL = 6000;
const VISIBLE_SIDE = 2; // posters shown either side of the active one

/** Signed distance from the active slide, wrapping around the ends (…, -2, -1, 0, 1, 2, …). */
function offsetFrom(i: number, active: number, count: number) {
  let d = i - active;
  if (d > count / 2) d -= count;
  if (d < -count / 2) d += count;
  return d;
}

/**
 * Cinema-style hero: a coverflow of posters on the right drives the banner. The active
 * poster's artwork, blurred and enlarged, becomes the backdrop, so every slide gets its own
 * colour mood even when only portrait artwork exists.
 */
export function PosterCarousel({ movies }: { movies: MovieCard[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [trailer, setTrailer] = useState<MovieCard | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const count = movies.length;
  const autoplay = count > 1 && !paused && !hovering && !reducedMotion && !trailer;

  const go = useCallback((i: number) => setIndex(((i % count) + count) % count), [count]);

  useEffect(() => {
    if (!autoplay) return;
    const id = setTimeout(() => go(index + 1), INTERVAL);
    return () => clearTimeout(id);
  }, [autoplay, index, go]);

  if (count === 0) return null;
  const current = movies[Math.min(index, count - 1)];
  const upcoming = current.showingStatus === 'UPCOMING';

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured films"
      className="relative isolate overflow-hidden"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(index - 1);
        if (e.key === 'ArrowRight') go(index + 1);
      }}
    >
      {/* Backdrops: one per film, cross-fading. */}
      <div className="absolute inset-0 -z-10 bg-bg" aria-hidden>
        {movies.map((m, i) => (
          <img
            key={m.id}
            src={m.posterUrl}
            alt=""
            loading={Math.abs(offsetFrom(i, index, count)) <= 1 ? 'eager' : 'lazy'}
            decoding="async"
            className={cn(
              'absolute inset-0 h-full w-full scale-125 object-cover blur-3xl saturate-150 transition-opacity duration-1000 ease-out',
              i === index ? 'opacity-55' : 'opacity-0',
            )}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-bg/30" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" />
        <div className="hero-grain absolute inset-0" />
      </div>

      <div className="container-page grid min-h-[640px] items-center gap-10 pb-16 pt-28 lg:h-[88vh] lg:max-h-[820px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pb-12">
        {/* Details of the active film */}
        <div
          key={current.id}
          role="group"
          aria-roledescription="slide"
          aria-label={`${index + 1} of ${count}: ${current.title}`}
          className="relative z-20 order-2 max-w-xl animate-pop-in lg:order-1"
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="eyebrow text-accent">{upcoming ? 'Coming soon' : 'Now showing'}</span>
            {current.isSampleData && <DevDataBadge />}
          </div>
          <h1 className="font-display text-4xl font-semibold leading-[1.03] text-fg sm:text-5xl xl:text-6xl">{current.title}</h1>
          {current.tagline && <p className="mt-4 text-base text-muted sm:text-lg">{current.tagline}</p>}
          <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
            <CertificationBadge value={current.certification} />
            <span>{formatRuntime(current.runtimeMinutes)}</span>
            <span aria-hidden className="text-subtle">·</span>
            <span>{current.languages.join(', ')}</span>
            {current.genres.length > 0 && (
              <>
                <span aria-hidden className="text-subtle">·</span>
                <span>{current.genres.slice(0, 3).join(', ')}</span>
              </>
            )}
          </p>
          <p className="mt-2 text-sm text-subtle">
            {upcoming ? `Releases ${formatCalendarDate(current.releaseDate)}` : `In cinemas since ${formatCalendarDate(current.releaseDate)}`}
            {current.formats.length > 0 && <> · {current.formats.join(' / ')}</>}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink to={`/movies/${current.slug}`} size="lg">
              <Ticket className="size-4" aria-hidden />
              {upcoming && current.formats.length === 0 ? 'View details' : 'Book tickets'}
            </ButtonLink>
            {current.trailerUrl && (
              <Button variant="secondary" size="lg" onClick={() => setTrailer(current)} className="bg-white/10 backdrop-blur-sm hover:bg-white/15">
                <Play className="size-4 fill-current" aria-hidden />
                Watch trailer
              </Button>
            )}
          </div>

          {count > 1 && (
            <div className="mt-10 flex items-center gap-4">
              <div className="flex items-center gap-1">
                <Button variant="secondary" size="icon-sm" onClick={() => go(index - 1)} aria-label="Previous film">
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <Button variant="secondary" size="icon-sm" onClick={() => go(index + 1)} aria-label="Next film">
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Resume slideshow' : 'Pause slideshow'}>
                  {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
                </Button>
              </div>
              <p className="text-sm tabular-nums text-subtle" aria-hidden>
                <span className="text-fg">{String(index + 1).padStart(2, '0')}</span> / {String(count).padStart(2, '0')}
              </p>
              <div className="h-[3px] flex-1 max-w-40 overflow-hidden rounded-full bg-white/10" aria-hidden>
                {/* Progress bar restarts on every slide change (keyed). */}
                <div
                  key={`${index}-${autoplay}`}
                  className={cn('h-full bg-accent', autoplay ? 'animate-[hero-progress_6s_linear_forwards]' : 'w-full opacity-40')}
                />
              </div>
            </div>
          )}
        </div>

        {/* Coverflow of posters */}
        <div className="relative order-1 mx-auto h-[340px] w-full max-w-[560px] sm:h-[420px] lg:order-2 lg:h-[500px]" role="group" aria-label="Choose a film">
          {movies.map((m, i) => {
            const d = offsetFrom(i, index, count);
            const distance = Math.abs(d);
            const hidden = distance > VISIBLE_SIDE;
            const active = d === 0;
            const style = {
              transform: `translateX(calc(-50% + ${d * 44}%)) scale(${1 - distance * 0.14}) rotateY(${d * -8}deg)`,
              zIndex: 10 - distance,
              opacity: hidden ? 0 : 1 - distance * 0.22,
            };
            const poster = (
              <img
                src={m.posterUrl}
                alt=""
                loading={distance <= 1 ? 'eager' : 'lazy'}
                decoding="async"
                className={cn('h-full w-full object-cover transition-[filter] duration-500', !active && 'brightness-[0.55] group-hover:brightness-75')}
              />
            );
            const frame = cn(
              'group absolute left-1/2 top-1/2 aspect-[2/3] h-full overflow-hidden rounded-lg bg-elevated shadow-2xl shadow-black/70 ring-1 ring-white/10 transition-[transform,opacity] duration-500 ease-out [transform-style:preserve-3d] motion-reduce:transition-none',
              active && 'ring-2 ring-accent/80',
              hidden && 'pointer-events-none',
            );
            // Wrapper does the vertical centring so the inline transform only handles the coverflow.
            return active ? (
              <Link key={m.id} to={`/movies/${m.slug}`} className={frame} style={{ ...style, transform: `translateY(-50%) ${style.transform}` }} aria-label={`${m.title}: view details and showtimes`}>
                {poster}
              </Link>
            ) : (
              <button
                key={m.id}
                type="button"
                onClick={() => go(i)}
                tabIndex={hidden ? -1 : 0}
                aria-hidden={hidden || undefined}
                aria-label={`Show ${m.title}`}
                className={frame}
                style={{ ...style, transform: `translateY(-50%) ${style.transform}` }}
              >
                {poster}
              </button>
            );
          })}
        </div>
      </div>

      <TrailerDialog open={trailer !== null} onClose={() => setTrailer(null)} title={trailer?.title ?? ''} url={trailer?.trailerUrl ?? null} />
    </section>
  );
}
